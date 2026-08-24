import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

import {
  cardFinancialEventDoc,
  creditCardOperationalMetricDoc,
} from "./adminPaths";

import {
  enqueueCreditCardDomainNotifications,
} from "./domainNotifications";
import { saoPauloDayKey } from "../shared/dateKeys";

import type {
  CreditCardBackendWriteOperation,
} from "./writeStrategy";

import {
  CreditCardApplicationError,
} from "./errors";

export type CreditCardObservedOperation =
  | "purchase_created"
  | "purchase_updated"
  | "purchase_cancelled"
  | "invoice_closed"
  | "invoice_reopened"
  | "invoice_payment_posted"
  | "invoice_payment_reversed"
  | "card_invoices_rebuilt"
  | "card_limit_recalculated"
  | "legacy_installments_migrated";

export type CreditCardObservedStatus = "success" | "failure";

export interface RecordCreditCardOperationMetricInput {
  workspaceId: string;
  operation: CreditCardObservedOperation;
  status?: CreditCardObservedStatus;
  actorId?: string;
  cardId?: string;
  invoiceId?: string;
  purchaseId?: string;
  paymentId?: string;
  amount?: number;
  correlationId?: string;
  idempotencyKey?: string;
}

const getSaoPauloDateKey = (): string => saoPauloDayKey();

const sanitizeMetricIdPart = (value: string): string =>
  value.replace(/[^\w-]/g, "_");

const stripUndefinedValues = (
  value: Record<string, unknown>
): admin.firestore.DocumentData =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );

export const recordCreditCardOperationMetric = (
  transaction: admin.firestore.Transaction,
  input: RecordCreditCardOperationMetricInput
): void => {
  const status = input.status ?? "success";
  const dateKey = getSaoPauloDateKey();
  const metricId = sanitizeMetricIdPart(`${dateKey}_${input.operation}_${status}`);
  const metricRef = creditCardOperationalMetricDoc(input.workspaceId, metricId);

  const metricData: Record<string, unknown> = {
    id: metricId,
    workspaceId: input.workspaceId,
    date: dateKey,
    domain: "credit_card",
    operation: input.operation,
    status,
        count: FieldValue.increment(1),
    lastActorId: input.actorId,
    lastCardId: input.cardId,
    lastInvoiceId: input.invoiceId,
    lastPurchaseId: input.purchaseId,
    lastPaymentId: input.paymentId,
    lastCorrelationId: input.correlationId,
    lastIdempotencyKey: input.idempotencyKey,
        updatedAt: FieldValue.serverTimestamp(),
  };

  if (typeof input.amount === "number" && Number.isFinite(input.amount)) {
       metricData.amountTotal = FieldValue.increment(input.amount);
  }

  transaction.set(metricRef, stripUndefinedValues(metricData), {merge: true});
};

const OPERATION_METRIC_MAP: Record<
  CreditCardBackendWriteOperation,
  CreditCardObservedOperation
> = {
  createCreditCardPurchase: "purchase_created",
  updateCreditCardPurchase: "purchase_updated",
  cancelCreditCardPurchase: "purchase_cancelled",
  closeCreditCardInvoice: "invoice_closed",
  reopenCreditCardInvoice: "invoice_reopened",
  registerCreditCardInvoicePayment: "invoice_payment_posted",
  reverseCreditCardInvoicePayment: "invoice_payment_reversed",
  recalculateCardLimit: "card_limit_recalculated",
  rebuildCardInvoicesForCard: "card_invoices_rebuilt",
  migrateLegacyInstallmentsToInvoiceDomain: "legacy_installments_migrated",
};
const sanitizeEventIdPart = (value: string): string =>
  value.replace(/[^\w-]/g, "_");

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ?
    value as Record<string, unknown> :
    undefined;

    const removeUndefinedFields = <T extends Record<string, unknown>>(
  value: T
): Partial<T> =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as Partial<T>;

const getStringValue = (
  value: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  const fieldValue = value?.[key];

  return typeof fieldValue === "string" && fieldValue.trim() ?
    fieldValue.trim() :
    undefined;
};

const getNumberValue = (
  value: Record<string, unknown> | undefined,
  key: string
): number | undefined => {
  const fieldValue = value?.[key];

  return typeof fieldValue === "number" && Number.isFinite(fieldValue) ?
    fieldValue :
    undefined;
};

const getFailureCode = (error: unknown): string => {
  if (error instanceof CreditCardApplicationError) {
    return error.code;
  }

  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as {code?: unknown}).code;

    return typeof code === "string" ? code : "unknown";
  }

  return "unknown";
};

const getFailureMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Falha ao processar operação crítica de cartão.";
};

const buildFailureEventId = (
  operation: CreditCardBackendWriteOperation,
  payload: Record<string, unknown> | undefined
): string => {
  const base =
    getStringValue(payload, "correlationId") ||
    getStringValue(payload, "idempotencyKey") ||
    `${operation}_${Date.now()}`;

  return sanitizeEventIdPart(`processing_failure_${operation}_${base}`);
};

export const recordCreditCardCallableFailure = async (
  operation: CreditCardBackendWriteOperation,
  requestData: unknown,
  actorId: string | undefined,
  error: unknown
): Promise<void> => {
  const payload = asRecord(requestData);
  const workspaceId = getStringValue(payload, "workspaceId");

  if (!workspaceId) {
    console.error("Falha crítica de cartão sem workspaceId rastreável.", {
      operation,
      actorId,
      errorCode: getFailureCode(error),
      errorMessage: getFailureMessage(error),
    });
    return;
  }

  const observedOperation = OPERATION_METRIC_MAP[operation];
  const cardId = getStringValue(payload, "cardId");
  const invoiceId = getStringValue(payload, "invoiceId");
  const purchaseId = getStringValue(payload, "purchaseId");
  const paymentId = getStringValue(payload, "paymentId");
  const amount =
    getNumberValue(payload, "amount") ??
    getNumberValue(payload, "totalAmount");
  const correlationId = getStringValue(payload, "correlationId");
  const idempotencyKey = getStringValue(payload, "idempotencyKey");
  const eventId = buildFailureEventId(operation, payload);
  const errorCode = getFailureCode(error);
  const errorMessage = getFailureMessage(error);

  await admin.firestore().runTransaction(async (transaction) => {
    recordCreditCardOperationMetric(transaction, {
      workspaceId,
      operation: observedOperation,
      status: "failure",
      actorId,
      cardId,
      invoiceId,
      purchaseId,
      paymentId,
      amount,
      correlationId,
      idempotencyKey,
    });

     const eventPayload = removeUndefinedFields({
    operation,
    errorCode,
    errorMessage,
    amount,
    correlationId,
    idempotencyKey,
  });

       transaction.set(
      cardFinancialEventDoc(workspaceId, eventId),
      removeUndefinedFields({
        id: eventId,
        workspaceId,
        eventType: "processing_failure",
        cardId,
        invoiceId,
        purchaseId,
        paymentId,
        payload: eventPayload,
        actorId,
        correlationId,
        idempotencyKey,
          createdAt: FieldValue.serverTimestamp(),
      })
    );

     const notificationEvent = {
      id: eventId,
      workspaceId,
      eventType: "processing_failure" as const,
      payload: eventPayload,
      ...(cardId ? {cardId} : {}),
      ...(invoiceId ? {invoiceId} : {}),
      ...(purchaseId ? {purchaseId} : {}),
      ...(paymentId ? {paymentId} : {}),
      ...(actorId ? {actorId} : {}),
    };

    enqueueCreditCardDomainNotifications(transaction, notificationEvent);
  });
};

export const recordCreditCardCallableFailureSafely = async (
  operation: CreditCardBackendWriteOperation,
  requestData: unknown,
  actorId: string | undefined,
  error: unknown
): Promise<void> => {
  try {
    await recordCreditCardCallableFailure(
      operation,
      requestData,
      actorId,
      error
    );
  } catch (observabilityError) {
    console.error("Falha ao registrar observabilidade de erro do cartão.", {
      operation,
      actorId,
      observabilityError,
    });
  }
};