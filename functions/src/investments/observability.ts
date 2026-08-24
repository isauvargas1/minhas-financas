import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import type {CallableRequest} from "firebase-functions/v2/https";

import {saoPauloDayKey} from "../shared/dateKeys";
import type {InvestmentBackendOperation} from "./infrastructure";
import {INVESTMENT_COLLECTIONS, investmentDoc, investmentFirestore} from "./paths";

/**
 * Observabilidade operacional do domínio de investimentos.
 *
 * Espelha `creditCards/observability.ts`: métrica diária por operação e
 * status, mais um registro de falha. Antes do M3 uma callable de investimento
 * que falhava não deixava métrica, evento nem rastro algum — o erro virava
 * `HttpsError` e desaparecia.
 *
 * A chave diária usa `America/Sao_Paulo` (helper compartilhado), e não UTC.
 */

export type InvestmentOperationStatus = "success" | "failure";

export interface RecordInvestmentOperationMetricInput {
  workspaceId: string;
  operation: InvestmentBackendOperation;
  status?: InvestmentOperationStatus;
  actorId?: string;
  accountId?: string;
  assetId?: string;
  movementId?: string;
  goalId?: string;
  amountCents?: number;
  correlationId?: string;
  idempotencyKey?: string;
  errorCode?: string;
}

const sanitizeMetricIdPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_");

const stripUndefined = (
  value: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );

/**
 * Métrica diária agregada. Deve ser chamada dentro da transação da operação,
 * no mesmo limite atômico da mutação crítica.
 */
export const recordInvestmentOperationMetric = (
  transaction: admin.firestore.Transaction,
  input: RecordInvestmentOperationMetricInput,
): void => {
  const status = input.status ?? "success";
  const dateKey = saoPauloDayKey();
  const metricId = sanitizeMetricIdPart(
    `${dateKey}_${input.operation}_${status}`,
  );
  const metricRef = investmentDoc(
    input.workspaceId,
    INVESTMENT_COLLECTIONS.operationalMetrics,
    metricId,
  );
  const metricData: Record<string, unknown> = {
    id: metricId,
    workspaceId: input.workspaceId,
    date: dateKey,
    domain: "investment",
    operation: input.operation,
    status,
    count: FieldValue.increment(1),
    lastActorId: input.actorId,
    lastAccountId: input.accountId,
    lastAssetId: input.assetId,
    lastMovementId: input.movementId,
    lastGoalId: input.goalId,
    lastCorrelationId: input.correlationId,
    lastIdempotencyKey: input.idempotencyKey,
    lastErrorCode: input.errorCode,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (
    typeof input.amountCents === "number" &&
    Number.isFinite(input.amountCents)
  ) {
    metricData.amountCents = FieldValue.increment(input.amountCents);
  }
  transaction.set(metricRef, stripUndefined(metricData), {merge: true});
};

const readString = (
  source: Record<string, unknown> | undefined,
  key: string,
): string | undefined => {
  const value = source?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const readNumber = (
  source: Record<string, unknown> | undefined,
  key: string,
): number | undefined => {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ?
    value :
    undefined;
};

const errorCodeOf = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const code = (error as {code?: unknown}).code;
    if (typeof code === "string") return code;
    if (typeof code === "number") return String(code);
  }
  return "unknown";
};

/**
 * Registra a falha de uma callable em transação própria, depois que a
 * transação de negócio já abortou.
 *
 * O `workspaceId` vem do contexto **já autorizado**, nunca do `request.data`
 * cru. Lendo do payload, qualquer chamador — inclusive não autenticado, já que
 * este caminho roda no `catch` que também captura `unauthenticated` e
 * `workspace_role_denied` — escrevia em `investment_event_logs` e
 * `investment_operational_metrics` de um workspace alheio, com `eventId`
 * derivado do próprio `correlationId` e, portanto, sem teto de documentos.
 * Sem autorização, a falha vira apenas log sanitizado.
 */
export const recordInvestmentCallableFailure = async (
  operation: InvestmentBackendOperation,
  request: CallableRequest,
  error: unknown,
  authorizedWorkspaceId: string | undefined,
): Promise<void> => {
  const data =
    typeof request.data === "object" && request.data !== null ?
      (request.data as Record<string, unknown>) :
      undefined;
  if (!authorizedWorkspaceId) {
    console.error("investment_callable_failure_unauthorized", {
      operation,
      actorId: request.auth?.uid ?? "anonymous",
      errorCode: errorCodeOf(error),
    });
    return;
  }
  const workspaceId = authorizedWorkspaceId;
  const actorId = request.auth?.uid;
  const correlationId = readString(data, "correlationId");
  const idempotencyKey = readString(data, "idempotencyKey");
  const errorCode = errorCodeOf(error);
  const eventId = sanitizeMetricIdPart(
    `failure_${operation}_${correlationId ?? idempotencyKey ?? "unknown"}`,
  );
  await investmentFirestore().runTransaction(async (transaction) => {
    recordInvestmentOperationMetric(transaction, {
      workspaceId,
      operation,
      status: "failure",
      actorId,
      accountId: readString(data, "accountId"),
      assetId: readString(data, "assetId"),
      movementId: readString(data, "movementId"),
      goalId: readString(data, "goalId"),
      amountCents: readNumber(data, "principalCents"),
      correlationId,
      idempotencyKey,
      errorCode,
    });
    transaction.set(
      investmentDoc(
        workspaceId,
        INVESTMENT_COLLECTIONS.eventLogs,
        eventId,
      ),
      stripUndefined({
        id: eventId,
        workspaceId,
        actorId,
        operation,
        entityType: "operation",
        entityId: operation,
        correlationId,
        idempotencyKeyId: idempotencyKey,
        outcome: "failed",
        details: stripUndefined({
          errorCode,
          message:
            error instanceof Error ? error.message.slice(0, 500) : undefined,
        }),
        occurredAt: FieldValue.serverTimestamp(),
      }),
      {merge: true},
    );
  });
};

/**
 * Observabilidade nunca pode mascarar o erro de domínio: qualquer falha aqui
 * vira log e é engolida.
 */
export const recordInvestmentCallableFailureSafely = async (
  operation: InvestmentBackendOperation,
  request: CallableRequest,
  error: unknown,
  authorizedWorkspaceId: string | undefined,
): Promise<void> => {
  try {
    await recordInvestmentCallableFailure(
      operation,
      request,
      error,
      authorizedWorkspaceId,
    );
  } catch (observabilityError) {
    // Log sanitizado: o objeto de erro cru pode carregar payload, valor
    // monetário ou identificador de pessoa vindos do request. Só sai o código.
    console.error("investment_callable_failure_observability_error", {
      operation,
      errorCode: errorCodeOf(observabilityError),
    });
  }
};
