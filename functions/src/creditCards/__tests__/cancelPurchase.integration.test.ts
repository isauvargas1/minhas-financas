import assert from "node:assert/strict";
import test from "node:test";

import {
  executeCancelCreditCardPurchase,
  type CancelCreditCardPurchaseResult,
} from "../cancelPurchase";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "../createPurchase";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-cancel-purchase-test";
const TEST_OWNER_ID = "user-credit-card-cancel-purchase-owner";
const TEST_CARD_ID = "card-credit-card-cancel-purchase-test";

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

const sumField = (
  records: FirestoreRecord[],
  field: string,
): number =>
  records.reduce((sum, record) => {
    const value = record[field];

    return sum + (typeof value === "number" ? value : 0);
  }, 0);

test(
  "cancelCreditCardPurchase deve cancelar compra, parcelas, faturas abertas e recompor limite",
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
        description: "Compra para cancelamento",
        categoryId: "category-cancel-test",
        categorySnapshot: {
          id: "category-cancel-test",
          label: "Cancelamento",
          normalizedLabel: "cancelamento",
          icon: "tag",
          color: "#6366f1",
        },
        purchaseDate: "2026-04-05",
        totalAmount: 1200,
        installmentsCount: 3,
        amountType: "total",
        source: "manual",
        idempotencyKey: "integration-cancel-purchase-create-001",
        correlationId: "integration-cancel-purchase-create",
      },
    } as any) as CreateCreditCardPurchaseResult;

    assert.equal(purchaseResult.success, true);
    assert.equal(purchaseResult.installmentIds.length, 3);
    assert.equal(purchaseResult.invoiceIds.length, 3);

    const limitAfterPurchaseSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`)
      .get();

    assert.equal(limitAfterPurchaseSnapshot.data()?.limitUsed, 1200);
    assert.equal(limitAfterPurchaseSnapshot.data()?.limitAvailable, 3800);

    const cancellationResult = await executeCancelCreditCardPurchase({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        purchaseId: purchaseResult.purchaseId,
        reason: "Teste de integração de cancelamento",
        policy: "block_if_invoice_paid",
        idempotencyKey: "integration-cancel-purchase-001",
        correlationId: "integration-cancel-purchase",
      },
    } as any) as CancelCreditCardPurchaseResult;

    assert.equal(cancellationResult.success, true);
    assert.equal(cancellationResult.purchaseId, purchaseResult.purchaseId);
    assert.equal(cancellationResult.cancelledInstallmentIds.length, 3);
    assert.equal(cancellationResult.affectedInvoiceIds.length, 3);
    assert.equal(cancellationResult.limitSnapshot.limitUsed, 0);
    assert.equal(cancellationResult.limitSnapshot.limitAvailable, 5000);

    const purchaseAfterCancellationSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_purchases/${purchaseResult.purchaseId}`)
      .get();

    assert.equal(purchaseAfterCancellationSnapshot.exists, true);
    assert.equal(purchaseAfterCancellationSnapshot.data()?.status, "cancelled");
    assert.equal(
      purchaseAfterCancellationSnapshot.data()?.cancellationReason,
      "Teste de integração de cancelamento",
    );
    assert.equal(purchaseAfterCancellationSnapshot.data()?.updatedBy, TEST_OWNER_ID);

    const installments = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/credit_card_installments`,
    );

    const cancelledInstallments = installments.filter(
      (installment) => installment.purchaseId === purchaseResult.purchaseId,
    );

    assert.equal(cancelledInstallments.length, 3);
    assert.equal(
      cancelledInstallments.every((installment) => installment.status === "cancelled"),
      true,
    );
    assert.equal(sumField(cancelledInstallments, "amount"), 1200);

    const invoiceSnapshots = await Promise.all(
      purchaseResult.invoiceIds.map((invoiceId) =>
        db.doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${invoiceId}`).get(),
      ),
    );

    assert.equal(invoiceSnapshots.every((snapshot) => snapshot.exists), true);

    const invoices = invoiceSnapshots.map((snapshot) => ({
      id: snapshot.id,
      ...snapshot.data(),
    })) as FirestoreRecord[];

    assert.equal(
      invoices.every((invoice) => invoice.status === "cancelled"),
      true,
    );
    assert.equal(
      invoices.every((invoice) => invoice.totalAmount === 0),
      true,
    );
    assert.equal(
      invoices.every((invoice) => invoice.remainingAmount === 0),
      true,
    );
    assert.equal(
      invoices.every((invoice) => invoice.itemsCount === 0),
      true,
    );

    const invoiceViewSnapshots = await Promise.all(
      purchaseResult.invoiceIds.map((invoiceId) =>
        db.doc(`workspaces/${TEST_WORKSPACE_ID}/invoice_views/${invoiceId}`).get(),
      ),
    );

    assert.equal(invoiceViewSnapshots.every((snapshot) => snapshot.exists), true);
    assert.equal(
      invoiceViewSnapshots.every((snapshot) => snapshot.data()?.status === "cancelled"),
      true,
    );
    assert.equal(
      invoiceViewSnapshots.every((snapshot) => snapshot.data()?.totalAmount === 0),
      true,
    );

    const limitAfterCancellationSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`)
      .get();

    assert.equal(limitAfterCancellationSnapshot.exists, true);
    assert.equal(limitAfterCancellationSnapshot.data()?.limitTotal, 5000);
    assert.equal(limitAfterCancellationSnapshot.data()?.limitUsed, 0);
    assert.equal(limitAfterCancellationSnapshot.data()?.limitAvailable, 5000);

    const ledgerSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_ledger/${cancellationResult.ledgerEntryId}`)
      .get();

    assert.equal(ledgerSnapshot.exists, true);
    assert.equal(ledgerSnapshot.data()?.direction, "restore");
    assert.equal(ledgerSnapshot.data()?.sourceType, "reversal");
    assert.equal(ledgerSnapshot.data()?.sourceId, purchaseResult.purchaseId);
    assert.equal(ledgerSnapshot.data()?.amount, 1200);
    assert.equal(ledgerSnapshot.data()?.actorId, TEST_OWNER_ID);
    assert.equal(
      ledgerSnapshot.data()?.idempotencyKey,
      "integration-cancel-purchase-001",
    );

    const financialEventSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/financial_events/${cancellationResult.eventId}`)
      .get();

    assert.equal(financialEventSnapshot.exists, true);
    assert.equal(financialEventSnapshot.data()?.eventType, "purchase_cancelled");
    assert.equal(financialEventSnapshot.data()?.purchaseId, purchaseResult.purchaseId);
    assert.equal(financialEventSnapshot.data()?.ledgerEntryId, cancellationResult.ledgerEntryId);
    assert.equal(financialEventSnapshot.data()?.actorId, TEST_OWNER_ID);

    const auditLogSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_audit_logs/${cancellationResult.eventId}_audit_purchase_cancelled`)
      .get();

    assert.equal(auditLogSnapshot.exists, true);
    assert.equal(auditLogSnapshot.data()?.action, "purchase_cancelled");
    assert.equal(auditLogSnapshot.data()?.actorId, TEST_OWNER_ID);
    assert.equal(auditLogSnapshot.data()?.purchaseId, purchaseResult.purchaseId);
    assert.equal(
      auditLogSnapshot.data()?.reason,
      "Teste de integração de cancelamento",
    );
    assert.equal(auditLogSnapshot.data()?.policy, "block_if_invoice_paid");

    const transactions = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/transactions`,
    );

    assert.equal(transactions.length, 0);

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  },
);