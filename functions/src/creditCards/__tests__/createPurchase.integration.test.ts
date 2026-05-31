import assert from "node:assert/strict";
import test from "node:test";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "../createPurchase";

import type {
  CreateCreditCardPurchasePayload,
} from "../contracts";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-create-purchase-test";
const TEST_OWNER_ID = "user-credit-card-create-purchase-owner";
const TEST_CARD_ID = "card-credit-card-create-purchase-test";

test(
  "createCreditCardPurchase deve criar compra, parcelas, faturas, ledger, evento, auditoria e consumir limite",
  {
    skip: !process.env.FIRESTORE_EMULATOR_HOST,
  },
  async () => {
    const db = getIntegrationFirestore();

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);

    await seedCreditCardIntegrationWorkspace({
      workspaceId: TEST_WORKSPACE_ID,
      ownerId: TEST_OWNER_ID,
      cardId: TEST_CARD_ID,
    });

       const payload: CreateCreditCardPurchasePayload = {
      workspaceId: TEST_WORKSPACE_ID,
      cardId: TEST_CARD_ID,
      description: "Compra integração",
      categoryId: "category-integration",
      categorySnapshot: {
        id: "category-integration",
        label: "Integração",
        normalizedLabel: "integracao",
        icon: "tag",
        color: "#6366f1",
      },
      purchaseDate: "2026-04-05",
      totalAmount: 1200,
      installmentsCount: 3,
      amountType: "total",
      source: "manual",
      idempotencyKey: "integration-create-purchase-001",
      correlationId: "integration-create-purchase-test",
    };

       const result = await executeCreateCreditCardPurchase({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload,
    } as any) as CreateCreditCardPurchaseResult;

    assert.equal(result.success, true);
    assert.equal(result.installmentIds.length, 3);
    assert.equal(result.invoiceIds.length, 3);

    const purchaseSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_purchases/${result.purchaseId}`)
      .get();

    assert.equal(purchaseSnapshot.exists, true);
    assert.equal(purchaseSnapshot.data()?.workspaceId, TEST_WORKSPACE_ID);
    assert.equal(purchaseSnapshot.data()?.cardId, TEST_CARD_ID);
    assert.equal(purchaseSnapshot.data()?.description, "Compra integração");
    assert.equal(purchaseSnapshot.data()?.totalAmount, 1200);
    assert.equal(purchaseSnapshot.data()?.installmentsCount, 3);
    assert.equal(purchaseSnapshot.data()?.status, "active");

    const installmentsSnapshot = await db
      .collection(`workspaces/${TEST_WORKSPACE_ID}/credit_card_installments`)
      .where("purchaseId", "==", result.purchaseId)
      .get();

    assert.equal(installmentsSnapshot.size, 3);

    const installments = installmentsSnapshot.docs
      .map((documentSnapshot) => documentSnapshot.data())
      .sort((left, right) => left.installmentNumber - right.installmentNumber);

    assert.deepEqual(
      installments.map((installment) => installment.amount),
      [400, 400, 400],
    );

    assert.deepEqual(
      installments.map((installment) => installment.competenceMonth),
      ["2026-04", "2026-05", "2026-06"],
    );

    assert.deepEqual(
      installments.map((installment) => installment.invoiceId),
      [
        `${TEST_CARD_ID}_2026-04`,
        `${TEST_CARD_ID}_2026-05`,
        `${TEST_CARD_ID}_2026-06`,
      ],
    );

    const invoiceSnapshots = await Promise.all(
      result.invoiceIds.map((invoiceId) =>
        db.doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${invoiceId}`).get(),
      ),
    );

    assert.equal(invoiceSnapshots.every((snapshot) => snapshot.exists), true);

    const invoices = invoiceSnapshots
      .map((snapshot) => snapshot.data())
      .sort((left, right) => String(left?.competenceMonth).localeCompare(String(right?.competenceMonth)));

    assert.deepEqual(
      invoices.map((invoice) => invoice?.totalAmount),
      [400, 400, 400],
    );

    assert.deepEqual(
      invoices.map((invoice) => invoice?.remainingAmount),
      [400, 400, 400],
    );

    assert.deepEqual(
      invoices.map((invoice) => invoice?.itemsCount),
      [1, 1, 1],
    );

    const invoiceViewSnapshots = await Promise.all(
      result.invoiceIds.map((invoiceId) =>
        db.doc(`workspaces/${TEST_WORKSPACE_ID}/invoice_views/${invoiceId}`).get(),
      ),
    );

    assert.equal(invoiceViewSnapshots.every((snapshot) => snapshot.exists), true);

    const ledgerSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_ledger/${result.ledgerEntryId}`)
      .get();

       const ledgerData = ledgerSnapshot.data();

    assert.equal(ledgerSnapshot.exists, true);
    assert.equal(ledgerData?.direction, "consume");
    assert.equal(ledgerData?.amount, 1200);
    assert.equal(ledgerData?.sourceType, "purchase");
    assert.equal(ledgerData?.sourceId, result.purchaseId);

    const limitSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`)
      .get();

    assert.equal(limitSnapshot.exists, true);
    assert.equal(limitSnapshot.data()?.limitTotal, 5000);
    assert.equal(limitSnapshot.data()?.limitUsed, 1200);
    assert.equal(limitSnapshot.data()?.limitAvailable, 3800);

    const financialEventSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/financial_events/${result.eventId}`)
      .get();

    assert.equal(financialEventSnapshot.exists, true);
    assert.equal(financialEventSnapshot.data()?.eventType, "purchase_created");
    assert.equal(financialEventSnapshot.data()?.actorId, TEST_OWNER_ID);

    const auditLogSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_audit_logs/${result.eventId}_audit_purchase_created`)
      .get();

    assert.equal(auditLogSnapshot.exists, true);
    assert.equal(auditLogSnapshot.data()?.action, "purchase_created");
    assert.equal(auditLogSnapshot.data()?.actorId, TEST_OWNER_ID);
    assert.equal(auditLogSnapshot.data()?.purchaseId, result.purchaseId);

    const notificationSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/notifications/${result.eventId}_purchase_created`)
      .get();

    assert.equal(notificationSnapshot.exists, true);
    assert.equal(notificationSnapshot.data()?.source, "credit_card_domain_event");
    assert.equal(notificationSnapshot.data()?.domainEventId, result.eventId);
    assert.equal(notificationSnapshot.data()?.purchaseId, result.purchaseId);

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  },
);