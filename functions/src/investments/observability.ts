import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";
import type {CallableRequest} from "firebase-functions/v2/https";

import {saoPauloDayKey} from "../shared/dateKeys";
import {RETENTION_DAYS, expiresInDays} from "../shared/retention";
import {
  boundedFailureEventId,
  idempotencyKeyDigest,
  safeErrorMessage,
} from "../shared/observabilityKeys";
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
  /**
   * Chave de idempotência crua. Persistida **sempre** como digest
   * (INV-P2-039): `investment_operational_metrics` é legível por qualquer
   * membro do workspace, e quem conhece a chave transforma uma operação nova
   * em replay da anterior.
   */
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
/**
 * Fragmentos do contador diário (INV-P2-017).
 *
 * A métrica operacional era o quarto documento singleton escrito por **toda**
 * mutação do domínio, e o único dos quatro que não é lido pelo produto: é
 * observabilidade agregada, não número que o usuário vê. Sem fragmentação, um
 * workspace com aportes concorrentes disputava esse documento sem nenhum
 * ganho de consistência em troca.
 *
 * Os demais três — resumo, período do mês e faixas de alocação — permanecem no
 * mesmo limite atômico da mutação, e isso é deliberado: são exatamente os
 * números que a tela mostra logo depois da operação, e a exatidão entre fato e
 * projeção que o domínio exige depende de eles serem publicados no mesmo
 * commit.
 */
export const METRIC_SHARDS = 10;

/** Fragmento pseudoaleatório. Distribuição uniforme basta; ordem não importa. */
const metricShard = (): number => Math.floor(Math.random() * METRIC_SHARDS);

export const recordInvestmentOperationMetric = (
  transaction: admin.firestore.Transaction,
  input: RecordInvestmentOperationMetricInput,
): void => {
  const status = input.status ?? "success";
  const dateKey = saoPauloDayKey();
  const metricId = sanitizeMetricIdPart(
    `${dateKey}_${input.operation}_${status}_s${metricShard()}`,
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
    // O fragmento é parte da identidade do documento; a leitura agregada soma
    // os fragmentos do mesmo dia, operação e status.
    shardOf: sanitizeMetricIdPart(`${dateKey}_${input.operation}_${status}`),
    count: FieldValue.increment(1),
    lastActorId: input.actorId,
    lastAccountId: input.accountId,
    lastAssetId: input.assetId,
    lastMovementId: input.movementId,
    lastGoalId: input.goalId,
    lastCorrelationId: input.correlationId,
    lastIdempotencyKeyHash: idempotencyKeyDigest(input.idempotencyKey),
    lastErrorCode: input.errorCode,
    updatedAt: FieldValue.serverTimestamp(),
    // Retenção (INV-P2-041): métrica operacional agregada, não fato
    // financeiro. O fato vive em `investment_movements`, que nunca expira.
    expiresAt: expiresInDays(RETENTION_DAYS.operationalMetrics),
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
  // O ID vinha do `correlationId`, que é livre e muda a cada tentativa: cada
  // retry criava um documento novo em `investment_event_logs`, sem teto
  // (INV-P2-039). A identidade passa a ser a intenção financeira.
  const eventId = boundedFailureEventId({
    operation,
    idempotencyKey,
    actorId,
    dayKey: saoPauloDayKey(),
  });
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
        idempotencyKeyHash: idempotencyKeyDigest(idempotencyKey),
        outcome: "failed",
        details: stripUndefined({
          errorCode,
          message: safeErrorMessage(error, "Falha ao processar operação."),
        }),
        occurredAt: FieldValue.serverTimestamp(),
        expiresAt: expiresInDays(RETENTION_DAYS.eventLogs),
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
