import assert from "node:assert/strict";
import test from "node:test";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "../createPurchase";

import {
  executeRegisterCreditCardInvoicePayment,
} from "../registerInvoicePayment";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-payment-test";
const TEST_OWNER_ID = "user-credit-card-payment-owner";
const TEST_CARD_ID = "card-credit-card-payment-test";

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
  "registerCreditCardInvoicePayment deve permitir pagamento parcial e total com recomposição de limite",
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
        description: "Compra para pagamento",
        categoryId: "category-payment-test",
        categorySnapshot: {
          id: "category-payment-test",
          label: "Pagamento",
          normalizedLabel: "pagamento",
          icon: "tag",
          color: "#6366f1",
        },
        purchaseDate: "2026-04-05",
        totalAmount: 1200,
        installmentsCount: 3,
        amountType: "total",
        source: "manual",
        idempotencyKey: "integration-payment-purchase-001",
        correlationId: "integration-payment-purchase",
      },
    } as any) as CreateCreditCardPurchaseResult;

    assert.equal(purchaseResult.success, true);

    const invoiceId = `${TEST_CARD_ID}_2026-04`;

    const invoiceBeforePaymentSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${invoiceId}`)
      .get();

    assert.equal(invoiceBeforePaymentSnapshot.exists, true);
    assert.equal(invoiceBeforePaymentSnapshot.data()?.totalAmount, 400);
    assert.equal(invoiceBeforePaymentSnapshot.data()?.remainingAmount, 400);
    assert.equal(invoiceBeforePaymentSnapshot.data()?.paidAmount, 0);

    await executeRegisterCreditCardInvoicePayment({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        invoiceId,
        paymentDate: "2026-04-20",
        amount: 250,
        paymentMethod: "external",
        idempotencyKey: "integration-payment-partial-001",
        correlationId: "integration-payment-partial",
      },
    } as any);

    const invoiceAfterPartialPaymentSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${invoiceId}`)
      .get();

    assert.equal(invoiceAfterPartialPaymentSnapshot.data()?.paidAmount, 250);
    assert.equal(invoiceAfterPartialPaymentSnapshot.data()?.remainingAmount, 150);
    assert.equal(invoiceAfterPartialPaymentSnapshot.data()?.status, "partial_paid");

    const limitAfterPartialPaymentSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`)
      .get();

    assert.equal(limitAfterPartialPaymentSnapshot.data()?.limitTotal, 5000);
    assert.equal(limitAfterPartialPaymentSnapshot.data()?.limitUsed, 950);
    assert.equal(limitAfterPartialPaymentSnapshot.data()?.limitAvailable, 4050);

    await executeRegisterCreditCardInvoicePayment({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        invoiceId,
        paymentDate: "2026-04-21",
        amount: 150,
        paymentMethod: "external",
        idempotencyKey: "integration-payment-total-001",
        correlationId: "integration-payment-total",
      },
    } as any);

    const invoiceAfterTotalPaymentSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${invoiceId}`)
      .get();

    assert.equal(invoiceAfterTotalPaymentSnapshot.data()?.paidAmount, 400);
    assert.equal(invoiceAfterTotalPaymentSnapshot.data()?.remainingAmount, 0);
    assert.equal(invoiceAfterTotalPaymentSnapshot.data()?.status, "paid");

    const invoiceViewAfterPaymentSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/invoice_views/${invoiceId}`)
      .get();

    assert.equal(invoiceViewAfterPaymentSnapshot.exists, true);
    assert.equal(invoiceViewAfterPaymentSnapshot.data()?.paidAmount, 400);
    assert.equal(invoiceViewAfterPaymentSnapshot.data()?.remainingAmount, 0);
    assert.equal(invoiceViewAfterPaymentSnapshot.data()?.status, "paid");

    const limitAfterTotalPaymentSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`)
      .get();

    assert.equal(limitAfterTotalPaymentSnapshot.data()?.limitTotal, 5000);
    assert.equal(limitAfterTotalPaymentSnapshot.data()?.limitUsed, 800);
    assert.equal(limitAfterTotalPaymentSnapshot.data()?.limitAvailable, 4200);

    const payments = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/credit_card_invoice_payments`,
    );

    const invoicePayments = payments.filter(
      (payment) => payment.invoiceId === invoiceId,
    );

    assert.equal(invoicePayments.length, 2);
    assert.equal(sumField(invoicePayments, "amount"), 400);
    assert.equal(
      invoicePayments.every((payment) => payment.status === "posted"),
      true,
    );

    const ledgerEntries = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/card_limit_ledger`,
    );

    const restoreLedgerEntries = ledgerEntries.filter(
      (entry) =>
        entry.direction === "restore" &&
        entry.sourceType === "payment",
    );

    assert.equal(restoreLedgerEntries.length, 2);
    assert.equal(sumField(restoreLedgerEntries, "amount"), 400);
    assert.equal(
      restoreLedgerEntries.every((entry) => typeof entry.sourceId === "string"),
      true,
    );

    const transactions = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/transactions`,
    );

    const paymentCashTransactions = transactions.filter(
      (transaction) =>
        transaction.source === "credit_card_invoice_payment" &&
        transaction.creditCardInvoiceId === invoiceId,
    );

    assert.equal(paymentCashTransactions.length, 2);
    assert.equal(sumField(paymentCashTransactions, "value"), 400);
    assert.equal(
      paymentCashTransactions.every((transaction) => transaction.type === "despesa"),
      true,
    );

    const financialEvents = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/financial_events`,
    );

    const paymentEvents = financialEvents.filter(
      (event) =>
        event.eventType === "invoice_payment_posted" &&
        event.invoiceId === invoiceId,
    );

    assert.equal(paymentEvents.length, 2);
    assert.equal(
      paymentEvents.every((event) => event.actorId === TEST_OWNER_ID),
      true,
    );

    const auditLogs = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/credit_card_audit_logs`,
    );

    const paymentAuditLogs = auditLogs.filter(
      (auditLog) =>
        auditLog.action === "invoice_payment_registered" &&
        auditLog.invoiceId === invoiceId,
    );

    assert.equal(paymentAuditLogs.length, 2);
    assert.equal(
      paymentAuditLogs.every((auditLog) => auditLog.actorId === TEST_OWNER_ID),
      true,
    );

    const notifications = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/notifications`,
    );

    const paymentNotifications = notifications.filter(
      (notification) =>
        notification.domainEventType === "invoice_payment_posted" &&
        notification.invoiceId === invoiceId,
    );

    assert.equal(paymentNotifications.length, 2);

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  },
);