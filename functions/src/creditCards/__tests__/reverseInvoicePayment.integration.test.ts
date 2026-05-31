import assert from "node:assert/strict";
import test from "node:test";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "../createPurchase";

import {
  executeRegisterCreditCardInvoicePayment,
  type RegisterCreditCardInvoicePaymentResult,
} from "../registerInvoicePayment";

import {
  executeReverseCreditCardInvoicePayment,
  type ReverseCreditCardInvoicePaymentResult,
} from "../reverseInvoicePayment";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-reversal-test";
const TEST_OWNER_ID = "user-credit-card-reversal-owner";
const TEST_CARD_ID = "card-credit-card-reversal-test";

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
  "reverseCreditCardInvoicePayment deve reabrir fatura, reverter caixa e consumir limite novamente",
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
        description: "Compra para estorno",
        categoryId: "category-reversal-test",
        categorySnapshot: {
          id: "category-reversal-test",
          label: "Estorno",
          normalizedLabel: "estorno",
          icon: "tag",
          color: "#6366f1",
        },
        purchaseDate: "2026-04-05",
        totalAmount: 1200,
        installmentsCount: 3,
        amountType: "total",
        source: "manual",
        idempotencyKey: "integration-reversal-purchase-001",
        correlationId: "integration-reversal-purchase",
      },
    } as any) as CreateCreditCardPurchaseResult;

    assert.equal(purchaseResult.success, true);

    const invoiceId = `${TEST_CARD_ID}_2026-04`;

    const paymentResult = await executeRegisterCreditCardInvoicePayment({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        invoiceId,
        paymentDate: "2026-04-20",
        amount: 400,
        paymentMethod: "external",
        idempotencyKey: "integration-reversal-payment-001",
        correlationId: "integration-reversal-payment",
      },
    } as any) as RegisterCreditCardInvoicePaymentResult;

    assert.equal(paymentResult.success, true);
    assert.equal(paymentResult.invoice.status, "paid");
    assert.equal(paymentResult.invoice.paidAmount, 400);
    assert.equal(paymentResult.invoice.remainingAmount, 0);

    const limitAfterPaymentSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`)
      .get();

    assert.equal(limitAfterPaymentSnapshot.data()?.limitUsed, 800);
    assert.equal(limitAfterPaymentSnapshot.data()?.limitAvailable, 4200);

    const reversalResult = await executeReverseCreditCardInvoicePayment({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        invoiceId,
        paymentId: paymentResult.paymentId,
        reversedAt: "2026-04-22",
        reason: "Teste de integração de estorno",
        idempotencyKey: "integration-reversal-payment-reversal-001",
        correlationId: "integration-reversal-payment-reversal",
      },
    } as any) as ReverseCreditCardInvoicePaymentResult;

    assert.equal(reversalResult.success, true);
    assert.equal(reversalResult.paymentId, paymentResult.paymentId);
    assert.equal(reversalResult.invoiceId, invoiceId);
    assert.equal(reversalResult.invoice.status, "open");
    assert.equal(reversalResult.invoice.paidAmount, 0);
    assert.equal(reversalResult.invoice.remainingAmount, 400);

    const paymentAfterReversalSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoice_payments/${paymentResult.paymentId}`)
      .get();

    assert.equal(paymentAfterReversalSnapshot.exists, true);
    assert.equal(paymentAfterReversalSnapshot.data()?.status, "reversed");
    assert.equal(paymentAfterReversalSnapshot.data()?.reversedBy, TEST_OWNER_ID);
    assert.equal(
      paymentAfterReversalSnapshot.data()?.reversalReason,
      "Teste de integração de estorno",
    );
    assert.equal(
      typeof paymentAfterReversalSnapshot.data()?.cashReversalTransactionId,
      "string",
    );

    const invoiceAfterReversalSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${invoiceId}`)
      .get();

    assert.equal(invoiceAfterReversalSnapshot.data()?.paidAmount, 0);
    assert.equal(invoiceAfterReversalSnapshot.data()?.remainingAmount, 400);
    assert.equal(invoiceAfterReversalSnapshot.data()?.status, "open");
    assert.equal(invoiceAfterReversalSnapshot.data()?.paymentStatusDerived, "unpaid");

    const invoiceViewAfterReversalSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/invoice_views/${invoiceId}`)
      .get();

    assert.equal(invoiceViewAfterReversalSnapshot.exists, true);
    assert.equal(invoiceViewAfterReversalSnapshot.data()?.paidAmount, 0);
    assert.equal(invoiceViewAfterReversalSnapshot.data()?.remainingAmount, 400);
    assert.equal(invoiceViewAfterReversalSnapshot.data()?.status, "open");

    const limitAfterReversalSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`)
      .get();

    assert.equal(limitAfterReversalSnapshot.data()?.limitTotal, 5000);
    assert.equal(limitAfterReversalSnapshot.data()?.limitUsed, 1200);
    assert.equal(limitAfterReversalSnapshot.data()?.limitAvailable, 3800);

    const ledgerEntries = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/card_limit_ledger`,
    );

    const reversalLedgerEntries = ledgerEntries.filter(
      (entry) =>
        entry.direction === "consume" &&
        entry.sourceType === "reversal" &&
        entry.sourceId === paymentResult.paymentId,
    );

    assert.equal(reversalLedgerEntries.length, 1);
    assert.equal(sumField(reversalLedgerEntries, "amount"), 400);
    assert.equal(reversalLedgerEntries[0].actorId, TEST_OWNER_ID);
    assert.equal(
      reversalLedgerEntries[0].idempotencyKey,
      "integration-reversal-payment-reversal-001",
    );

    const transactions = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/transactions`,
    );

    const paymentCashTransactions = transactions.filter(
      (transaction) =>
        transaction.source === "credit_card_invoice_payment" &&
        transaction.creditCardInvoiceId === invoiceId,
    );

    const reversalCashTransactions = transactions.filter(
      (transaction) =>
        transaction.source === "credit_card_invoice_payment_reversal" &&
        transaction.creditCardInvoiceId === invoiceId &&
        transaction.creditCardInvoicePaymentId === paymentResult.paymentId,
    );

    assert.equal(paymentCashTransactions.length, 1);
    assert.equal(paymentCashTransactions[0].type, "despesa");
    assert.equal(paymentCashTransactions[0].value, 400);

    assert.equal(reversalCashTransactions.length, 1);
    assert.equal(reversalCashTransactions[0].type, "receita");
    assert.equal(reversalCashTransactions[0].value, 400);

    const financialEvents = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/financial_events`,
    );

    const reversalEvents = financialEvents.filter(
      (event) =>
        event.eventType === "invoice_payment_reversed" &&
        event.invoiceId === invoiceId &&
        event.paymentId === paymentResult.paymentId,
    );

    assert.equal(reversalEvents.length, 1);
    assert.equal(reversalEvents[0].actorId, TEST_OWNER_ID);
    assert.equal(reversalEvents[0].ledgerEntryId, reversalResult.ledgerEntryId);

    const auditLogs = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/credit_card_audit_logs`,
    );

    const reversalAuditLogs = auditLogs.filter(
      (auditLog) =>
        auditLog.action === "invoice_payment_reversed" &&
        auditLog.invoiceId === invoiceId &&
        auditLog.paymentId === paymentResult.paymentId,
    );

    assert.equal(reversalAuditLogs.length, 1);
    assert.equal(reversalAuditLogs[0].actorId, TEST_OWNER_ID);
    assert.equal(reversalAuditLogs[0].reason, "Teste de integração de estorno");

    const notifications = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/notifications`,
    );

    const reversalNotifications = notifications.filter(
      (notification) =>
        notification.domainEventType === "invoice_payment_reversed" &&
        notification.invoiceId === invoiceId &&
        notification.paymentId === paymentResult.paymentId,
    );

    assert.equal(reversalNotifications.length, 1);
    assert.equal(reversalNotifications[0].source, "credit_card_domain_event");

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  },
);