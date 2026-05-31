import * as admin from "firebase-admin";

import type {
  CreditCardCallableExecutionContext,
} from "./callable";

import type {
  ReverseCreditCardInvoicePaymentPayload,
} from "./contracts";

import {
  cardFinancialEventDoc,
  cardLimitLedgerDoc,
  cardLimitSnapshotDoc,
  creditCardInvoiceDoc,
  creditCardInvoicePaymentDoc,
  creditCardInvoiceViewDoc,
  getFirestore,
  workspaceDoc,
} from "./adminPaths";

import {
  CreditCardApplicationError,
} from "./errors";

import {
  markIdempotencyKeyCompleted,
  reserveIdempotencyKey,
} from "./idempotency";

import {
  recordCreditCardOperationMetric,
} from "./observability";

import {
  enqueueCreditCardDomainNotifications,
} from "./domainNotifications";

import {
  recordCreditCardAuditLog,
} from "./auditLogs";

export interface ReverseCreditCardInvoicePaymentResult {
  success: true;
  paymentId: string;
  invoiceId: string;
  ledgerEntryId: string;
  eventId: string;
  cashReversalTransactionId?: string;
  invoice: {
    id: string;
    status: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
  };
  limitSnapshot: {
    cardId: string;
    limitTotal: number;
    limitUsed: number;
    limitAvailable: number;
  };
}

interface PaymentData {
  id?: string;
  workspaceId?: string;
  cardId?: string;
  invoiceId?: string;
  paymentDate?: string;
  amount?: number;
  walletId?: string;
  cashAccountId?: string;
  paymentMethod?: string;
  status?: string;
  cashTransactionId?: string;
}

interface InvoiceData {
  id?: string;
  workspaceId?: string;
  cardId?: string;
  competenceMonth?: string;
  dueDate?: string;
  status?: string;
  totalAmount?: number;
  paidAmount?: number;
  remainingAmount?: number;
}

interface LimitSnapshotData {
  workspaceId?: string;
  cardId?: string;
  limitTotal?: number;
  limitUsed?: number;
  limitAvailable?: number;
}

const normalizeMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (
    Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null
  );

const stripUndefinedValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedValues);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefinedValues(entryValue)])
  );
};

const toFirestoreData = (
  data: Record<string, unknown>
): admin.firestore.DocumentData =>
  stripUndefinedValues(data) as admin.firestore.DocumentData;

const derivePaymentStatus = (
  totalAmount: number,
  paidAmount: number
): "unpaid" | "partial" | "paid" | "overpaid" => {
  if (totalAmount <= 0) return "paid";
  if (paidAmount <= 0) return "unpaid";
  if (paidAmount < totalAmount) return "partial";
  if (paidAmount === totalAmount) return "paid";

  return "overpaid";
};

const deriveInvoiceStatusAfterReversal = (
  totalAmount: number,
  paidAmount: number
): "open" | "partial_paid" | "paid" => {
  const remainingAmount = normalizeMoney(totalAmount - paidAmount);

  if (remainingAmount <= 0) return "paid";
  if (paidAmount > 0) return "partial_paid";

  return "open";
};

const shouldCreateCashReversalTransaction = (
  paymentMethod?: string
): boolean => paymentMethod !== "manual_adjustment";

const buildResult = (
  paymentId: string,
  invoiceId: string,
  ledgerEntryId: string,
  eventId: string,
  cashReversalTransactionId: string | undefined,
  cardId: string,
  invoiceStatus: string,
  totalAmount: number,
  paidAmount: number,
  remainingAmount: number,
  limitTotal: number,
  limitUsed: number,
  limitAvailable: number
): ReverseCreditCardInvoicePaymentResult => ({
  success: true,
  paymentId,
  invoiceId,
  ledgerEntryId,
  eventId,
  cashReversalTransactionId,
  invoice: {
    id: invoiceId,
    status: invoiceStatus,
    totalAmount,
    paidAmount,
    remainingAmount,
  },
  limitSnapshot: {
    cardId,
    limitTotal,
    limitUsed,
    limitAvailable,
  },
});

export const executeReverseCreditCardInvoicePayment = async (
  context: CreditCardCallableExecutionContext<
    ReverseCreditCardInvoicePaymentPayload
  >
): Promise<ReverseCreditCardInvoicePaymentResult | Record<string, unknown>> => {
  const { payload, auth } = context;
  const db = getFirestore();
  const operation = "reverseCreditCardInvoicePayment";

  return db.runTransaction(async (transaction) => {
    const workspaceId = payload.workspaceId;
    const paymentRef = creditCardInvoicePaymentDoc(
      workspaceId,
      payload.paymentId
    );
    const invoiceRef = creditCardInvoiceDoc(workspaceId, payload.invoiceId);
    const limitSnapshotRef = cardLimitSnapshotDoc(
      workspaceId,
      payload.cardId
    );

    const [
      paymentSnapshot,
      invoiceSnapshot,
      limitSnapshot,
    ] = await Promise.all([
      transaction.get(paymentRef),
      transaction.get(invoiceRef),
      transaction.get(limitSnapshotRef),
    ]);

    if (!paymentSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Pagamento de fatura não encontrado.",
        { paymentId: payload.paymentId }
      );
    }

    if (!invoiceSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Fatura não encontrada.",
        { invoiceId: payload.invoiceId }
      );
    }

    if (!limitSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Snapshot de limite do cartão não encontrado.",
        { cardId: payload.cardId }
      );
    }

    const paymentData = paymentSnapshot.data() as PaymentData | undefined;
    const invoiceData = invoiceSnapshot.data() as InvoiceData | undefined;
    const limitSnapshotData = limitSnapshot.data() as
      LimitSnapshotData | undefined;

    if (!paymentData || !invoiceData || !limitSnapshotData) {
      throw new CreditCardApplicationError(
        "internal",
        "Dados necessários para estorno não foram carregados.",
        {
          paymentId: payload.paymentId,
          invoiceId: payload.invoiceId,
          cardId: payload.cardId,
        }
      );
    }

    if (paymentData.workspaceId !== workspaceId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "O pagamento não pertence ao workspace informado.",
        { paymentId: payload.paymentId }
      );
    }

    if (paymentData.invoiceId !== payload.invoiceId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "O pagamento não pertence à fatura informada.",
        { paymentId: payload.paymentId, invoiceId: payload.invoiceId }
      );
    }

    if (paymentData.cardId !== payload.cardId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "O pagamento não pertence ao cartão informado.",
        { paymentId: payload.paymentId, cardId: payload.cardId }
      );
    }

    if (invoiceData.workspaceId !== workspaceId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A fatura não pertence ao workspace informado.",
        { invoiceId: payload.invoiceId }
      );
    }

    if (invoiceData.cardId !== payload.cardId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A fatura não pertence ao cartão informado.",
        { invoiceId: payload.invoiceId, cardId: payload.cardId }
      );
    }

    const idempotency = await reserveIdempotencyKey(transaction, {
      workspaceId,
      operation,
      idempotencyKey: payload.idempotencyKey,
      requestPayload: payload,
    });

    if (idempotency.replayResult) {
      return idempotency.replayResult;
    }

    if (paymentData.status === "reversed") {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Este pagamento já foi estornado.",
        { paymentId: payload.paymentId }
      );
    }

    if (paymentData.status !== "posted") {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Somente pagamentos postados podem ser estornados.",
        { paymentId: payload.paymentId, status: paymentData.status }
      );
    }

    const paymentAmount = normalizeMoney(Number(paymentData.amount ?? 0));

    if (paymentAmount <= 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "O pagamento possui valor inválido para estorno.",
        { paymentId: payload.paymentId, amount: paymentData.amount }
      );
    }

    const totalAmount = normalizeMoney(Number(invoiceData.totalAmount ?? 0));
    const currentPaidAmount = normalizeMoney(
      Number(invoiceData.paidAmount ?? 0)
    );

    if (paymentAmount > currentPaidAmount) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "O valor do estorno não pode exceder o valor pago da fatura.",
        {
          paymentId: payload.paymentId,
          paymentAmount,
          currentPaidAmount,
        }
      );
    }

    const newPaidAmount = normalizeMoney(currentPaidAmount - paymentAmount);
    const newRemainingAmount = normalizeMoney(totalAmount - newPaidAmount);
    const newInvoiceStatus = deriveInvoiceStatusAfterReversal(
      totalAmount,
      newPaidAmount
    );
    const paymentStatusDerived = derivePaymentStatus(
      totalAmount,
      newPaidAmount
    );
    const limitTotal = normalizeMoney(
      Number(limitSnapshotData.limitTotal ?? 0)
    );
    const currentLimitUsed = normalizeMoney(
      Number(limitSnapshotData.limitUsed ?? 0)
    );
    const newLimitUsed = normalizeMoney(currentLimitUsed + paymentAmount);
    const newLimitAvailable = normalizeMoney(limitTotal - newLimitUsed);
    const ledgerEntryId = `${payload.paymentId}_payment_reversal`;
    const eventId = `${payload.paymentId}_invoice_payment_reversed`;
    const cashReversalTransactionRef = shouldCreateCashReversalTransaction(
      paymentData.paymentMethod
    ) ?
      workspaceDoc(workspaceId).collection("transactions").doc() :
      undefined;
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    transaction.update(paymentRef, toFirestoreData({
      status: "reversed",
      reversedBy: auth.uid,
      reversedAt: payload.reversedAt,
      reversalReason: payload.reason,
      cashReversalTransactionId: cashReversalTransactionRef?.id,
      updatedAt: serverTimestamp,
    }));

    transaction.update(invoiceRef, toFirestoreData({
      paidAmount: newPaidAmount,
      remainingAmount: newRemainingAmount,
      status: newInvoiceStatus,
      paymentStatusDerived,
      updatedAt: serverTimestamp,
    }));

    transaction.set(
      creditCardInvoiceViewDoc(workspaceId, payload.invoiceId),
      toFirestoreData({
        id: payload.invoiceId,
        workspaceId,
        cardId: payload.cardId,
        competenceMonth: invoiceData.competenceMonth,
        dueDate: invoiceData.dueDate,
        status: newInvoiceStatus,
        totalAmount,
        paidAmount: newPaidAmount,
        remainingAmount: newRemainingAmount,
        updatedAt: serverTimestamp,
      }),
      { merge: true }
    );

    transaction.set(cardLimitLedgerDoc(workspaceId, ledgerEntryId), {
      id: ledgerEntryId,
      workspaceId,
      cardId: payload.cardId,
      sourceType: "reversal",
      sourceId: payload.paymentId,
      direction: "consume",
      amount: paymentAmount,
      balanceAfter: newLimitAvailable,
      createdAt: serverTimestamp,
      actorId: auth.uid,
      idempotencyKey: payload.idempotencyKey,
    });

    transaction.set(limitSnapshotRef, toFirestoreData({
      workspaceId,
      cardId: payload.cardId,
      limitTotal,
      limitUsed: newLimitUsed,
      limitAvailable: newLimitAvailable,
      updatedAt: serverTimestamp,
    }));

    if (cashReversalTransactionRef) {
      transaction.set(cashReversalTransactionRef, toFirestoreData({
        id: cashReversalTransactionRef.id,
        workspaceId,
        profileId: workspaceId,
        userId: auth.uid,
        type: "receita",
        description: `Estorno de pagamento de fatura ${payload.invoiceId}`,
        category: "Estorno de Pagamento de Cartão",
        value: paymentAmount,
        date: payload.reversedAt,
        isPaid: true,
        cardId: payload.cardId,
        paymentMethod: paymentData.paymentMethod,
        walletId: paymentData.walletId,
        cashAccountId: paymentData.cashAccountId,
        creditCardInvoiceId: payload.invoiceId,
        creditCardInvoicePaymentId: payload.paymentId,
        source: "credit_card_invoice_payment_reversal",
        createdAt: serverTimestamp,
        updatedAt: serverTimestamp,
      }));
    }

    const eventPayload = {
      amount: paymentAmount,
      reversedAt: payload.reversedAt,
      reason: payload.reason,
      paidAmount: newPaidAmount,
      remainingAmount: newRemainingAmount,
      cashReversalTransactionId: cashReversalTransactionRef?.id,
      originalCashTransactionId: paymentData.cashTransactionId,
    };

    transaction.set(cardFinancialEventDoc(workspaceId, eventId), toFirestoreData({
      id: eventId,
      workspaceId,
      cardId: payload.cardId,
      eventType: "invoice_payment_reversed",
      invoiceId: payload.invoiceId,
      paymentId: payload.paymentId,
      ledgerEntryId,
      payload: eventPayload,
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
      createdAt: serverTimestamp,
      actorId: auth.uid,
    }));

    enqueueCreditCardDomainNotifications(transaction, {
      id: eventId,
      workspaceId,
      cardId: payload.cardId,
      invoiceId: payload.invoiceId,
      paymentId: payload.paymentId,
      ledgerEntryId,
      eventType: "invoice_payment_reversed",
      payload: eventPayload,
      actorId: auth.uid,
    });

    recordCreditCardAuditLog(transaction, {
      workspaceId,
      action: "invoice_payment_reversed",
      actorId: auth.uid,
      entityType: "payment",
      entityId: payload.paymentId,
      cardId: payload.cardId,
      invoiceId: payload.invoiceId,
      paymentId: payload.paymentId,
      ledgerEntryId,
      domainEventId: eventId,
      reason: payload.reason,
      idempotencyKey: payload.idempotencyKey,
      correlationId: payload.correlationId,
      details: eventPayload,
    });

    recordCreditCardOperationMetric(transaction, {
  workspaceId,
  operation: "invoice_payment_reversed",
  actorId: auth.uid,
  cardId: payload.cardId,
  invoiceId: payload.invoiceId,
  paymentId: payload.paymentId,
  amount: paymentAmount,
  correlationId: payload.correlationId,
  idempotencyKey: payload.idempotencyKey,
});

    const result = buildResult(
      payload.paymentId,
      payload.invoiceId,
      ledgerEntryId,
      eventId,
      cashReversalTransactionRef?.id,
      payload.cardId,
      newInvoiceStatus,
      totalAmount,
      newPaidAmount,
      newRemainingAmount,
      limitTotal,
      newLimitUsed,
      newLimitAvailable
    );

    markIdempotencyKeyCompleted(
      transaction,
      idempotency.ref,
      result as unknown as Record<string, unknown>
    );

    return result;
  });
};