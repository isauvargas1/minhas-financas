import assert from "node:assert/strict";
import test from "node:test";

import {
  executeCloseCreditCardInvoice,
  type CloseCreditCardInvoiceResult,
} from "../closeInvoice";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "../createPurchase";

import {
  executeReopenCreditCardInvoice,
  type ReopenCreditCardInvoiceResult,
} from "../reopenInvoice";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-close-reopen-test";
const TEST_OWNER_ID = "user-credit-card-close-reopen-owner";
const TEST_CARD_ID = "card-credit-card-close-reopen-test";

type FirestoreRecord = Record<string, unknown> & {id: string};

const listCollectionRecords = async (
  collectionPath: string
): Promise<FirestoreRecord[]> => {
  const db = getIntegrationFirestore();
  const snapshot = await db.collection(collectionPath).get();

  return snapshot.docs.map((documentSnapshot) => ({
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  }));
};

const findSuccessMetric = (
  metrics: FirestoreRecord[],
  operation: string
): FirestoreRecord => {
  const metric = metrics.find(
    (item) => item.operation === operation && item.status === "success"
  );

  assert.ok(metric, `Métrica não encontrada para ${operation}.`);

  return metric;
};

test(
  "closeCreditCardInvoice deve fechar fatura sem baixar caixa e reopenCreditCardInvoice deve reabrir sob regra restrita",
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
        description: "Compra para fechar fatura",
        categoryId: "category-close-reopen-test",
        categorySnapshot: {
          id: "category-close-reopen-test",
          label: "Fechamento",
          normalizedLabel: "fechamento",
          icon: "tag",
          color: "#6366f1",
        },
        purchaseDate: "2026-04-05",
        totalAmount: 100,
        installmentsCount: 1,
        amountType: "total",
        source: "manual",
        idempotencyKey: "integration-close-reopen-create-001",
        correlationId: "integration-close-reopen-create",
      },
    } as any) as CreateCreditCardPurchaseResult;

    const invoiceId = purchaseResult.invoiceIds[0];

    const closeResult = await executeCloseCreditCardInvoice({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        invoiceId,
        closedAt: "2026-04-10",
        idempotencyKey: "integration-close-invoice-001",
        correlationId: "integration-close-invoice",
      },
    } as any) as CloseCreditCardInvoiceResult;

    assert.equal(closeResult.success, true);
    assert.equal(closeResult.invoiceId, invoiceId);
    assert.equal(closeResult.invoice.status, "closed");
    assert.equal(closeResult.invoice.totalAmount, 100);
    assert.equal(closeResult.invoice.paidAmount, 0);
    assert.equal(closeResult.invoice.remainingAmount, 100);
    assert.equal(closeResult.invoice.itemsCount, 1);

    const closedInvoiceSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${invoiceId}`)
      .get();

    assert.equal(closedInvoiceSnapshot.exists, true);
    assert.equal(closedInvoiceSnapshot.data()?.status, "closed");
    assert.equal(closedInvoiceSnapshot.data()?.closedAt, "2026-04-10");
    assert.equal(closedInvoiceSnapshot.data()?.totalAmount, 100);
    assert.equal(closedInvoiceSnapshot.data()?.paidAmount, 0);
    assert.equal(closedInvoiceSnapshot.data()?.remainingAmount, 100);

    assert.equal(await db.collection(`workspaces/${TEST_WORKSPACE_ID}/transactions`).get().then((snapshot) => snapshot.size), 0);

    const closeEventSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/financial_events/${closeResult.eventId}`)
      .get();

    assert.equal(closeEventSnapshot.exists, true);
    assert.equal(closeEventSnapshot.data()?.eventType, "invoice_closed");
    assert.equal(closeEventSnapshot.data()?.actorId, TEST_OWNER_ID);
    assert.equal(closeEventSnapshot.data()?.invoiceId, invoiceId);

    const closeAuditSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_audit_logs/${closeResult.eventId}_audit_invoice_closed`)
      .get();

    assert.equal(closeAuditSnapshot.exists, true);
    assert.equal(closeAuditSnapshot.data()?.action, "invoice_closed");
    assert.equal(closeAuditSnapshot.data()?.actorId, TEST_OWNER_ID);
    assert.equal(closeAuditSnapshot.data()?.invoiceId, invoiceId);

    const reopenResult = await executeReopenCreditCardInvoice({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        invoiceId,
        reason: "Teste de reabertura de fatura sem pagamento",
        policy: "block_if_paid",
        idempotencyKey: "integration-reopen-invoice-001",
        correlationId: "integration-reopen-invoice",
      },
    } as any) as ReopenCreditCardInvoiceResult;

    assert.equal(reopenResult.success, true);
    assert.equal(reopenResult.invoiceId, invoiceId);
    assert.equal(reopenResult.invoice.status, "open");
    assert.equal(reopenResult.invoice.totalAmount, 100);
    assert.equal(reopenResult.invoice.paidAmount, 0);
    assert.equal(reopenResult.invoice.remainingAmount, 100);

    const reopenedInvoiceSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${invoiceId}`)
      .get();

    assert.equal(reopenedInvoiceSnapshot.data()?.status, "open");
    assert.equal(reopenedInvoiceSnapshot.data()?.closedAt, null);
    assert.equal(reopenedInvoiceSnapshot.data()?.reopenReason, "Teste de reabertura de fatura sem pagamento");
    assert.equal(reopenedInvoiceSnapshot.data()?.reopenedBy, TEST_OWNER_ID);

    assert.equal(await db.collection(`workspaces/${TEST_WORKSPACE_ID}/transactions`).get().then((snapshot) => snapshot.size), 0);

    const reopenEventSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/financial_events/${reopenResult.eventId}`)
      .get();

    assert.equal(reopenEventSnapshot.exists, true);
    assert.equal(reopenEventSnapshot.data()?.eventType, "invoice_reopened");
    assert.equal(reopenEventSnapshot.data()?.actorId, TEST_OWNER_ID);
    assert.equal(reopenEventSnapshot.data()?.invoiceId, invoiceId);

    const reopenAuditSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_audit_logs/${reopenResult.eventId}_audit_invoice_reopened`)
      .get();

    assert.equal(reopenAuditSnapshot.exists, true);
    assert.equal(reopenAuditSnapshot.data()?.action, "invoice_reopened");
    assert.equal(reopenAuditSnapshot.data()?.actorId, TEST_OWNER_ID);
    assert.equal(reopenAuditSnapshot.data()?.invoiceId, invoiceId);
    assert.equal(reopenAuditSnapshot.data()?.reason, "Teste de reabertura de fatura sem pagamento");

    const metrics = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/credit_card_operational_metrics`
    );

    const closeMetric = findSuccessMetric(metrics, "invoice_closed");
    assert.equal(closeMetric.count, 1);
    assert.equal(closeMetric.amountTotal, 100);
    assert.equal(closeMetric.lastActorId, TEST_OWNER_ID);
    assert.equal(closeMetric.lastCardId, TEST_CARD_ID);
    assert.equal(closeMetric.lastInvoiceId, invoiceId);
    assert.equal(closeMetric.lastCorrelationId, "integration-close-invoice");

    const reopenMetric = findSuccessMetric(metrics, "invoice_reopened");
    assert.equal(reopenMetric.count, 1);
    assert.equal(reopenMetric.amountTotal, 100);
    assert.equal(reopenMetric.lastActorId, TEST_OWNER_ID);
    assert.equal(reopenMetric.lastCardId, TEST_CARD_ID);
    assert.equal(reopenMetric.lastInvoiceId, invoiceId);
    assert.equal(reopenMetric.lastCorrelationId, "integration-reopen-invoice");

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  }
);