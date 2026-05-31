import * as admin from "firebase-admin";
import assert from "node:assert/strict";
import test from "node:test";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "../createPurchase";

import {
  executeRebuildCardInvoicesForCard,
  type RebuildCardInvoicesForCardResult,
} from "../rebuildInvoices";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-rebuild-test";
const TEST_OWNER_ID = "user-credit-card-rebuild-owner";
const TEST_CARD_ID = "card-credit-card-rebuild-test";

type FirestoreRecord = Record<string, unknown> & {id: string};

const listCollectionRecords = async (
  collectionPath: string,
): Promise<FirestoreRecord[]> => {
  const db = getIntegrationFirestore();
  const snapshot = await db.collection(collectionPath).get();

  return snapshot.docs.map((documentSnapshot) => ({
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  }));
};

test(
  "rebuildCardInvoicesForCard deve reconstruir faturas, corrigir parcelas e cancelar projeções obsoletas",
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

    const purchaseResult = await executeCreateCreditCardPurchase({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        description: "Compra para rebuild",
        categoryId: "category-rebuild-test",
        categorySnapshot: {
          id: "category-rebuild-test",
          label: "Rebuild",
          normalizedLabel: "rebuild",
          icon: "tag",
          color: "#6366f1",
        },
        purchaseDate: "2026-04-05",
        totalAmount: 1200,
        installmentsCount: 3,
        amountType: "total",
        source: "manual",
        idempotencyKey: "integration-rebuild-purchase-001",
        correlationId: "integration-rebuild-purchase",
      },
    } as any) as CreateCreditCardPurchaseResult;

    assert.equal(purchaseResult.success, true);
    assert.equal(purchaseResult.installmentIds.length, 3);
    assert.deepEqual(
      purchaseResult.invoiceIds,
      [
        `${TEST_CARD_ID}_2026-04`,
        `${TEST_CARD_ID}_2026-05`,
        `${TEST_CARD_ID}_2026-06`,
      ],
    );

    const secondInstallmentId = purchaseResult.installmentIds[1];
    const corruptedInvoiceId = `${TEST_CARD_ID}_2026-05`;
    const obsoleteInvoiceId = `${TEST_CARD_ID}_2026-12`;
    const now = admin.firestore.FieldValue.serverTimestamp();

    await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_installments/${secondInstallmentId}`)
      .set(
        {
          invoiceId: "wrong_invoice_id",
          status: "projected",
          dueDate: "2026-05-01",
          updatedAt: now,
        },
        {merge: true},
      );

    await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${corruptedInvoiceId}`)
      .set(
        {
          totalAmount: 999,
          paidAmount: 0,
          remainingAmount: 999,
          itemsCount: 99,
          status: "open",
          updatedAt: now,
        },
        {merge: true},
      );

    await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/invoice_views/${corruptedInvoiceId}`)
      .set(
        {
          totalAmount: 999,
          paidAmount: 0,
          remainingAmount: 999,
          itemsCount: 99,
          status: "open",
          updatedAt: now,
        },
        {merge: true},
      );

    await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${obsoleteInvoiceId}`)
      .set({
        id: obsoleteInvoiceId,
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        competenceMonth: "2026-12",
        closingDate: "2026-12-10",
        dueDate: "2026-12-20",
        status: "open",
        totalAmount: 123,
        paidAmount: 0,
        remainingAmount: 123,
        itemsCount: 1,
        paymentStatusDerived: "unpaid",
        generatedAt: now,
        updatedAt: now,
      });

    await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/invoice_views/${obsoleteInvoiceId}`)
      .set({
        id: obsoleteInvoiceId,
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        competenceMonth: "2026-12",
        dueDate: "2026-12-20",
        status: "open",
        totalAmount: 123,
        paidAmount: 0,
        remainingAmount: 123,
        updatedAt: now,
      });

    const rebuildResult = await executeRebuildCardInvoicesForCard({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        fromCompetenceMonth: "2026-04",
        toCompetenceMonth: "2026-12",
        reason: "Teste de integração de rebuild",
        idempotencyKey: "integration-rebuild-invoices-001",
        correlationId: "integration-rebuild-invoices",
      },
    } as any) as RebuildCardInvoicesForCardResult;

    assert.equal(rebuildResult.success, true);
    assert.equal(rebuildResult.cardId, TEST_CARD_ID);
    assert.equal(rebuildResult.inspectedInstallmentsCount, 3);
    assert.equal(rebuildResult.updatedInstallmentIds.includes(secondInstallmentId), true);
    assert.equal(rebuildResult.cancelledInvoiceIds.includes(obsoleteInvoiceId), true);

    assert.deepEqual(
      [...rebuildResult.rebuiltInvoiceIds].sort(),
      [
        `${TEST_CARD_ID}_2026-04`,
        `${TEST_CARD_ID}_2026-05`,
        `${TEST_CARD_ID}_2026-06`,
      ],
    );

    const correctedInstallmentSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_installments/${secondInstallmentId}`)
      .get();

    assert.equal(correctedInstallmentSnapshot.exists, true);
    assert.equal(correctedInstallmentSnapshot.data()?.invoiceId, corruptedInvoiceId);
    assert.equal(correctedInstallmentSnapshot.data()?.status, "invoiced");
    assert.equal(correctedInstallmentSnapshot.data()?.dueDate, "2026-05-20");

    const rebuiltInvoiceSnapshots = await Promise.all(
      rebuildResult.rebuiltInvoiceIds.map((invoiceId) =>
        db.doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${invoiceId}`).get(),
      ),
    );

    const rebuiltInvoices = rebuiltInvoiceSnapshots
      .map((snapshot) => ({
        id: snapshot.id,
        ...snapshot.data(),
      })) as FirestoreRecord[];

    assert.equal(rebuiltInvoices.every((invoice) => invoice.status === "open"), true);
    assert.equal(rebuiltInvoices.every((invoice) => invoice.totalAmount === 400), true);
    assert.equal(rebuiltInvoices.every((invoice) => invoice.remainingAmount === 400), true);
    assert.equal(rebuiltInvoices.every((invoice) => invoice.itemsCount === 1), true);

    const rebuiltInvoiceViewSnapshots = await Promise.all(
      rebuildResult.rebuiltInvoiceIds.map((invoiceId) =>
        db.doc(`workspaces/${TEST_WORKSPACE_ID}/invoice_views/${invoiceId}`).get(),
      ),
    );

    assert.equal(
      rebuiltInvoiceViewSnapshots.every((snapshot) => snapshot.data()?.totalAmount === 400),
      true,
    );
    assert.equal(
      rebuiltInvoiceViewSnapshots.every((snapshot) => snapshot.data()?.remainingAmount === 400),
      true,
    );

    const obsoleteInvoiceSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${obsoleteInvoiceId}`)
      .get();

    assert.equal(obsoleteInvoiceSnapshot.exists, true);
    assert.equal(obsoleteInvoiceSnapshot.data()?.status, "cancelled");
    assert.equal(obsoleteInvoiceSnapshot.data()?.totalAmount, 0);
    assert.equal(obsoleteInvoiceSnapshot.data()?.remainingAmount, 0);
    assert.equal(obsoleteInvoiceSnapshot.data()?.itemsCount, 0);

    const obsoleteInvoiceViewSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/invoice_views/${obsoleteInvoiceId}`)
      .get();

    assert.equal(obsoleteInvoiceViewSnapshot.exists, true);
    assert.equal(obsoleteInvoiceViewSnapshot.data()?.status, "cancelled");
    assert.equal(obsoleteInvoiceViewSnapshot.data()?.totalAmount, 0);
    assert.equal(obsoleteInvoiceViewSnapshot.data()?.remainingAmount, 0);

    const financialEventSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/financial_events/${rebuildResult.eventId}`)
      .get();

    assert.equal(financialEventSnapshot.exists, true);
    assert.equal(financialEventSnapshot.data()?.eventType, "reconciliation_warning");
    assert.equal(financialEventSnapshot.data()?.actorId, TEST_OWNER_ID);
    assert.equal(financialEventSnapshot.data()?.cardId, TEST_CARD_ID);

    const auditLogSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_audit_logs/${rebuildResult.eventId}_audit_card_invoices_rebuilt`)
      .get();

    assert.equal(auditLogSnapshot.exists, true);
    assert.equal(auditLogSnapshot.data()?.action, "card_invoices_rebuilt");
    assert.equal(auditLogSnapshot.data()?.actorId, TEST_OWNER_ID);
    assert.equal(auditLogSnapshot.data()?.cardId, TEST_CARD_ID);
    assert.equal(auditLogSnapshot.data()?.reason, "Teste de integração de rebuild");

    const notifications = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/notifications`,
    );

    const rebuildNotifications = notifications.filter(
      (notification) =>
        notification.domainEventType === "reconciliation_warning" &&
        notification.cardId === TEST_CARD_ID,
    );

    assert.equal(rebuildNotifications.length, 1);
    assert.equal(rebuildNotifications[0].source, "credit_card_domain_event");
    assert.equal(rebuildNotifications[0].domainEventId, rebuildResult.eventId);

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  },
);