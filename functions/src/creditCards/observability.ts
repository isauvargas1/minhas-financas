import * as admin from "firebase-admin";

import {
  creditCardOperationalMetricDoc,
} from "./adminPaths";

export type CreditCardObservedOperation =
  | "purchase_created"
  | "purchase_cancelled"
  | "invoice_payment_posted"
  | "invoice_payment_reversed"
  | "card_invoices_rebuilt"
  | "card_limit_recalculated";

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

const getSaoPauloDateKey = (): string => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(new Date());
};

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
    count: admin.firestore.FieldValue.increment(1),
    lastActorId: input.actorId,
    lastCardId: input.cardId,
    lastInvoiceId: input.invoiceId,
    lastPurchaseId: input.purchaseId,
    lastPaymentId: input.paymentId,
    lastCorrelationId: input.correlationId,
    lastIdempotencyKey: input.idempotencyKey,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (typeof input.amount === "number" && Number.isFinite(input.amount)) {
    metricData.amountTotal = admin.firestore.FieldValue.increment(input.amount);
  }

  transaction.set(metricRef, stripUndefinedValues(metricData), {merge: true});
};