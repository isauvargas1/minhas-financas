import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

import type {
  CreditCardCallableExecutionContext,
} from "./callable";

import type {
  ReopenCreditCardInvoicePayload,
} from "./contracts";

import {
  CREDIT_CARD_ADMIN_COLLECTIONS,
  cardFinancialEventDoc,
  creditCardInvoiceDoc,
  creditCardInvoiceViewDoc,
  getFirestore,
  workspaceCollection,
} from "./adminPaths";

import {
  CreditCardApplicationError,
} from "./errors";

import {
  markIdempotencyKeyCompleted,
  reserveIdempotencyKey,
} from "./idempotency";

import {
  recordCreditCardAuditLog,
} from "./auditLogs";

import {
  recordCreditCardOperationMetric,
} from "./observability";

export interface ReopenCreditCardInvoiceResult {
  success: true;
  invoiceId: string;
  eventId: string;
  invoice: {
    id: string;
    status: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
  };
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

interface PaymentData {
  id?: string;
  workspaceId?: string;
  cardId?: string;
  invoiceId?: string;
  status?: string;
  amount?: number;
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

const buildResult = (
  invoiceId: string,
  eventId: string,
  totalAmount: number,
  paidAmount: number,
  remainingAmount: number
): ReopenCreditCardInvoiceResult => ({
  success: true,
  invoiceId,
  eventId,
  invoice: {
    id: invoiceId,
    status: "open",
    totalAmount,
    paidAmount,
    remainingAmount,
  },
});

export const executeReopenCreditCardInvoice = async (
  context: CreditCardCallableExecutionContext<ReopenCreditCardInvoicePayload>
): Promise<ReopenCreditCardInvoiceResult | Record<string, unknown>> => {
  const {payload, auth} = context;
  const db = getFirestore();
  const operation = "reopenCreditCardInvoice";

  return db.runTransaction(async (transaction) => {
    const workspaceId = payload.workspaceId;
    const invoiceRef = creditCardInvoiceDoc(workspaceId, payload.invoiceId);
    const paymentsQuery = workspaceCollection(
      workspaceId,
      CREDIT_CARD_ADMIN_COLLECTIONS.invoicePayments
    ).where("invoiceId", "==", payload.invoiceId);

    const [
      invoiceSnapshot,
      paymentsSnapshot,
    ] = await Promise.all([
      transaction.get(invoiceRef),
      transaction.get(paymentsQuery),
    ]);

    if (!invoiceSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Fatura não encontrada.",
        {invoiceId: payload.invoiceId}
      );
    }

    const invoiceData = invoiceSnapshot.data() as InvoiceData | undefined;

    if (!invoiceData) {
      throw new CreditCardApplicationError(
        "internal",
        "Fatura existente sem dados carregados.",
        {invoiceId: payload.invoiceId}
      );
    }

    const payments = paymentsSnapshot.docs.map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    })) as PaymentData[];

    const idempotency = await reserveIdempotencyKey(transaction, {
      workspaceId,
      operation,
      idempotencyKey: payload.idempotencyKey,
      requestPayload: payload,
    });

    if (idempotency.replayResult) {
      return idempotency.replayResult;
    }

    if (invoiceData.workspaceId !== workspaceId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A fatura não pertence ao workspace informado.",
        {invoiceId: payload.invoiceId}
      );
    }

    if (invoiceData.cardId !== payload.cardId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A fatura não pertence ao cartão informado.",
        {invoiceId: payload.invoiceId, cardId: payload.cardId}
      );
    }

    if (invoiceData.status !== "closed") {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Somente faturas fechadas podem ser reabertas nesta política.",
        {
          invoiceId: payload.invoiceId,
          status: invoiceData.status,
          policy: payload.policy,
        }
      );
    }

    const invalidPayment = payments.find((payment) =>
      payment.workspaceId !== workspaceId ||
      payment.cardId !== payload.cardId ||
      payment.invoiceId !== payload.invoiceId
    );

    if (invalidPayment) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Pagamentos da fatura precisam pertencer ao mesmo workspace e cartão.",
        {paymentId: invalidPayment.id}
      );
    }

    if (payments.length > 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Não é permitido reabrir fatura com pagamentos registrados.",
        {
          invoiceId: payload.invoiceId,
          paymentsCount: payments.length,
          policy: payload.policy,
        }
      );
    }

    const totalAmount = normalizeMoney(Number(invoiceData.totalAmount ?? 0));
    const paidAmount = normalizeMoney(Number(invoiceData.paidAmount ?? 0));
    const remainingAmount = normalizeMoney(
      Number(invoiceData.remainingAmount ?? totalAmount - paidAmount)
    );

    if (paidAmount > 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Não é permitido reabrir fatura com valor pago.",
        {
          invoiceId: payload.invoiceId,
          paidAmount,
        }
      );
    }

    const eventId = `${payload.invoiceId}_invoice_reopened`;
    const serverTimestamp = FieldValue.serverTimestamp();

    transaction.update(invoiceRef, toFirestoreData({
      status: "open",
      reopenedAt: serverTimestamp,
      reopenReason: payload.reason,
      reopenedBy: auth.uid,
      closedAt: null,
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
        status: "open",
        totalAmount,
        paidAmount,
        remainingAmount,
        updatedAt: serverTimestamp,
      }),
      {merge: true}
    );

    transaction.set(cardFinancialEventDoc(workspaceId, eventId), toFirestoreData({
      id: eventId,
      workspaceId,
      cardId: payload.cardId,
      eventType: "invoice_reopened",
      invoiceId: payload.invoiceId,
      payload: {
        reason: payload.reason,
        policy: payload.policy,
        previousStatus: invoiceData.status,
        totalAmount,
        paidAmount,
        remainingAmount,
      },
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
      createdAt: serverTimestamp,
      actorId: auth.uid,
    }));

    recordCreditCardAuditLog(transaction, {
      workspaceId,
      action: "invoice_reopened",
      actorId: auth.uid,
      entityType: "invoice",
      entityId: payload.invoiceId,
      cardId: payload.cardId,
      invoiceId: payload.invoiceId,
      domainEventId: eventId,
      reason: payload.reason,
      policy: payload.policy,
      idempotencyKey: payload.idempotencyKey,
      correlationId: payload.correlationId,
      details: {
        previousStatus: invoiceData.status,
        totalAmount,
        paidAmount,
        remainingAmount,
      },
    });

        recordCreditCardOperationMetric(transaction, {
      workspaceId,
      operation: "invoice_reopened",
      actorId: auth.uid,
      cardId: payload.cardId,
      invoiceId: payload.invoiceId,
      amount: totalAmount,
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
    });

    const result = buildResult(
      payload.invoiceId,
      eventId,
      totalAmount,
      paidAmount,
      remainingAmount
    );

    markIdempotencyKeyCompleted(
      transaction,
      idempotency.ref,
      result as unknown as Record<string, unknown>
    );

    return result;
  });
};