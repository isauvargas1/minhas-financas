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
import {
  boundedFailureEventId,
  idempotencyKeyDigest,
  safeErrorMessage,
} from "../shared/observabilityKeys";

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
  /**
   * Chave de idempotência crua. Persistida **sempre** como digest
   * (INV-P2-039): a coleção de métricas é legível por qualquer membro do
   * workspace, e quem conhece a chave transforma uma operação nova em replay.
   */
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
    lastIdempotencyKeyHash: idempotencyKeyDigest(input.idempotencyKey),
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

const getFailureMessage = (error: unknown): string =>
  safeErrorMessage(error, "Falha ao processar operação crítica de cartão.");

/**
 * ID do evento de falha com cardinalidade limitada.
 *
 * Antes derivava do `correlationId`, que é livre e muda a cada tentativa: cada
 * chamada criava um documento novo em `financial_events`, sem teto
 * (INV-P2-039). Agora a identidade é a intenção — a chave de idempotência
 * quando existe, senão um balde por operação, ator e dia.
 */
const buildFailureEventId = (
  operation: CreditCardBackendWriteOperation,
  payload: Record<string, unknown> | undefined,
  actorId: string | undefined
): string =>
  boundedFailureEventId({
    operation: `processing_failure_${operation}`,
    idempotencyKey: getStringValue(payload, "idempotencyKey"),
    actorId,
    dayKey: getSaoPauloDateKey(),
  });

/**
 * Registra a falha de uma callable de cartão.
 *
 * `authorizedWorkspaceId` é preenchido **apenas** depois que
 * `requireWorkspaceRole` devolveu — e é a única origem do workspace usado
 * aqui. Ler `workspaceId` do `request.data` cru era o vetor INV-P0-001: este
 * caminho roda no `catch` que também captura `unauthenticated` e
 * `workspace_role_denied`, então um chamador **sem token** conseguia gravar
 * métricas, eventos financeiros e notificações no workspace de outro tenant,
 * com `amount`, `errorMessage` e `correlationId` sob controle dele e sem teto
 * de documentos. Sem autorização, a falha vira log sanitizado e nada é
 * escrito.
 */
export const recordCreditCardCallableFailure = async (
  operation: CreditCardBackendWriteOperation,
  requestData: unknown,
  actorId: string | undefined,
  error: unknown,
  authorizedWorkspaceId: string | undefined
): Promise<void> => {
  const payload = asRecord(requestData);

  if (!authorizedWorkspaceId) {
    // Sem workspace autorizado não há destino legítimo para a escrita. O log
    // não repete payload nem valor monetário: só o suficiente para investigar.
    console.error("credit_card_callable_failure_unauthorized", {
      operation,
      actorId: actorId ?? "anonymous",
      errorCode: getFailureCode(error),
    });
    return;
  }

  const workspaceId = authorizedWorkspaceId;

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
  const eventId = buildFailureEventId(operation, payload, actorId);
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

    const idempotencyKeyHash = idempotencyKeyDigest(idempotencyKey);
    const eventPayload = removeUndefinedFields({
      operation,
      errorCode,
      errorMessage,
      amount,
      correlationId,
      idempotencyKeyHash,
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
        idempotencyKeyHash,
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
  error: unknown,
  authorizedWorkspaceId: string | undefined
): Promise<void> => {
  try {
    await recordCreditCardCallableFailure(
      operation,
      requestData,
      actorId,
      error,
      authorizedWorkspaceId
    );
  } catch (observabilityError) {
    // Log sanitizado: serializar o objeto de erro cru vazava payload, valor
    // monetário e identificador de pessoa para o Cloud Logging (INV-P2-036).
    console.error("credit_card_callable_failure_observability_error", {
      operation,
      actorId: actorId ?? "anonymous",
      errorCode: getFailureCode(observabilityError),
    });
  }
};