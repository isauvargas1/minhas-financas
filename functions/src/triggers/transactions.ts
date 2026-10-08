import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {onDocumentWritten} from "firebase-functions/v2/firestore";

import {
  applyCashPeriodWriteOnce,
  cashPeriodEventKey,
  recordCashProjectionIssue,
  type CashPeriodEventOutcomeKind,
} from "../cash/periods";
import {parseIsoInstant} from "../shared/commitTime";
import {isContentionAbortedError} from "../shared/errors";
import {createOperationLogger} from "../shared/logger";
import {TRANSACTION_WRITE_TRIGGER_OPTIONS} from "../shared/runtimeOptions";

const db = () => admin.firestore();

/**
 * Retenção da trilha de atividade (INV-P2-041).
 *
 * `activity_logs` cresce a cada escrita e nunca era purgado. Um ano cobre
 * qualquer investigação operacional realista; o fato financeiro em si vive na
 * transação, que é preservada para sempre.
 */
const ACTIVITY_LOG_RETENTION_DAYS = 365;

/**
 * Política de retry do gatilho de caixa (P3-B, D-38).
 *
 * O gatilho é implantado com `retry: true`
 * (`TRANSACTION_WRITE_TRIGGER_OPTIONS`): o Eventarc reentrega o evento quando
 * a execução termina com erro, com backoff exponencial de 10 a 600 s, por até
 * 24 horas na 2ª geração. Depois disso o evento é descartado sem executar
 * código nenhum.
 *
 * Por isso, uma falha transitória que persiste até perto do fim da janela
 * deixa de ser relançada: a divergência é registrada no estado da projeção
 * (`needsRebuild`) e a execução termina. Assim a perda nunca é silenciosa:
 * fica um registro durável para a reconciliação, em vez de um descarte que
 * ninguém vê.
 */
export const RETRY_GIVE_UP_AGE_SECONDS = 23 * 60 * 60;

/**
 * Códigos gRPC que o Firestore usa para falha passageira: a mesma operação
 * repetida pode dar certo.
 *
 * - 1 CANCELLED, 2 UNKNOWN, 4 DEADLINE_EXCEEDED, 8 RESOURCE_EXHAUSTED,
 *   10 ABORTED, 13 INTERNAL e 14 UNAVAILABLE.
 * - 6 ALREADY_EXISTS só aparece aqui quando outra entrega do mesmo evento
 *   criou a marca entre a leitura e o commit. A nova tentativa encontra a
 *   marca e termina sem somar nada.
 */
const TRANSIENT_GRPC_CODES = new Set([1, 2, 4, 6, 8, 10, 13, 14]);
const TRANSIENT_STRING_CODES = new Set([
  "cancelled",
  "unknown",
  "deadline-exceeded",
  "already-exists",
  "resource-exhausted",
  "aborted",
  "internal",
  "unavailable",
]);

export type ProjectionErrorClass = "transient" | "permanent";

/**
 * Separa a falha que vale a pena repetir da que não vale.
 *
 * Passageira: os códigos acima e a transação invalidada por contenção
 * (`isContentionAbortedError`). Permanente: todo o resto, inclusive erro sem
 * código (defeito de programa ou dado que nenhuma repetição corrige). Erro
 * permanente não é engolido: é registrado como divergência a reconciliar.
 */
export const classifyProjectionError = (
  error: unknown,
): ProjectionErrorClass => {
  if (isContentionAbortedError(error)) return "transient";
  if (typeof error !== "object" || error === null) return "permanent";
  const code = (error as {code?: unknown}).code;
  if (typeof code === "number" && TRANSIENT_GRPC_CODES.has(code)) {
    return "transient";
  }
  if (typeof code === "string" && TRANSIENT_STRING_CODES.has(code)) {
    return "transient";
  }
  return "permanent";
};

/** Código estável para log: nunca a mensagem, que pode carregar dados. */
const errorCodeOf = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return "unknown";
  const code = (error as {code?: unknown}).code;
  if (typeof code === "number" || typeof code === "string") return String(code);
  return error instanceof Error ? error.name : "unknown";
};

/**
 * Converte o `time` do CloudEvent em `Timestamp` sem perder microssegundos.
 *
 * `new Date(iso)` truncaria em milissegundos, e um evento poderia empatar com
 * o corte da reconstrução que o sucede no mesmo milissegundo.
 */
export const parseCloudEventTime = (value: string): Timestamp =>
  parseIsoInstant(value);

const getSignedBalanceValue = (data?: admin.firestore.DocumentData) => {
  if (!data) return 0;
  const numericValue = Number(data.value || 0);
  if (data.type === "despesa" || data.type === "parcelado") {
    return -numericValue;
  }
  if (data.type === "investimento") {
    const metadata = data.investmentMetadata;
    if (
      metadata &&
      metadata.status !== "settled" &&
      metadata.status !== "reversed"
    ) {
      return 0;
    }
    if (metadata?.cashImpact === "inflow") return numericValue;
    if (metadata?.cashImpact === "none") return 0;
    return -numericValue;
  }
  return numericValue;
};

export type TransactionWriteAction = "CREATE" | "UPDATE" | "DELETE";

/** Entrega do gatilho, já extraída do CloudEvent. */
export interface TransactionWriteEvent {
  eventId: string;
  workspaceId: string;
  transactionId: string;
  /** Instante de commit da escrita de origem. */
  eventTime: Timestamp;
  before?: admin.firestore.DocumentData;
  after?: admin.firestore.DocumentData;
  /** `createTime` do documento antes da escrita (UPDATE e DELETE). */
  beforeCreateTime?: Timestamp;
}

/**
 * Pontos de injeção de falha, só para os testes de recuperação.
 *
 * O gatilho implantado não passa nenhum: o parâmetro existe para provar, no
 * Emulator, o comportamento em cada ponto de falha (antes da projeção, dentro
 * da transação, depois do commit, antes da trilha).
 */
export interface TransactionWriteFaults {
  beforeProjection?: () => void;
  insideProjection?: () => void;
  afterProjection?: () => void;
  beforeActivityLog?: () => void;
  /** Relógio do teste, para simular a idade do evento. */
  now?: () => number;
}

export interface TransactionWriteResult {
  projection: CashPeriodEventOutcomeKind | "failed_recorded";
  activityLogged: boolean;
}

const actionOf = (event: TransactionWriteEvent): TransactionWriteAction =>
  !event.before ? "CREATE" : !event.after ? "DELETE" : "UPDATE";

/*
 * Trilha de atividade enxuta.
 *
 * A versão anterior gravava `before` e `after` **completos** de toda
 * transação: uma segunda cópia integral do conteúdo financeiro numa coleção
 * legível por qualquer membro do workspace — custo de escrita dobrado e
 * exposição desnecessária de dados que já vivem no documento de origem, que
 * não é apagado (INV-P2-032).
 *
 * O que a trilha precisa responder é quem mudou o quê e qual foi o efeito em
 * caixa. Os campos alterados ficam nomeados; os valores ficam no documento de
 * origem, referenciado por `entityId`.
 *
 * O ID vem da chave da entrega e a escrita substitui o documento inteiro: a
 * nova tentativa depois de uma falha regrava o mesmo registro, sem duplicar.
 */
const writeActivityLog = async (
  event: TransactionWriteEvent,
  eventKey: string,
  action: TransactionWriteAction,
): Promise<void> => {
  const beforeData = event.before;
  const afterData = event.after;
  const description =
    afterData?.description ?? beforeData?.description ?? "Transação";
  const changedFields = Array.from(new Set([
    ...Object.keys(beforeData ?? {}),
    ...Object.keys(afterData ?? {}),
  ])).filter((field) => {
    const before = JSON.stringify((beforeData ?? {})[field] ?? null);
    const after = JSON.stringify((afterData ?? {})[field] ?? null);
    return before !== after;
  }).slice(0, 40);
  const verb = action === "CREATE" ? "criada" :
    action === "DELETE" ? "excluída" : "atualizada";

  const logPath =
    `workspaces/${event.workspaceId}/activity_logs/transaction_${eventKey}`;
  await db()
    .doc(logPath)
    .set({
      eventId: event.eventId,
      entity: "transaction",
      entityId: event.transactionId,
      action,
      userId: afterData?.userId || beforeData?.userId || "sistema",
      description: `Transação "${description}" ${verb}.`,
      timestamp: FieldValue.serverTimestamp(),
      // Retenção: `expiresAt` é o campo que a política de TTL do projeto usa.
      // Trilha operacional não é fato financeiro; o fato permanece na própria
      // transação, que nunca é apagada.
      expiresAt: Timestamp.fromMillis(
        Date.now() + ACTIVITY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      ),
      details: {
        changedFields,
        type: afterData?.type ?? beforeData?.type ?? null,
        balanceBefore: getSignedBalanceValue(beforeData),
        balanceAfter: getSignedBalanceValue(afterData),
      },
    }, {merge: false});
};

/**
 * Processa uma entrega do gatilho de transações.
 *
 * 1. **Projeção** (INV-P1-011, INV-P3-001, P3-B): delta mensal aplicado uma
 *    única vez por entrega, na mesma transação da marca, respeitando a cerca
 *    da reconstrução (`applyCashPeriodWriteOnce`).
 * 2. **Trilha operacional** (`activity_logs`), depois do commit e idempotente
 *    pelo ID.
 *
 * Falhas:
 * - passageira, dentro da janela de retry: registrada em log e **relançada**,
 *   para o Eventarc reentregar. A nova tentativa encontra a marca se o commit
 *   já tinha acontecido e não soma de novo;
 * - permanente, ou passageira perto do fim da janela, na **projeção**:
 *   registrada no estado da projeção (`needsRebuild`) e encerrada. Se nem o
 *   registro for possível, a falha original é relançada;
 * - permanente na **trilha**, com a projeção já aplicada: só log de erro. O
 *   caixa está correto e a trilha é operacional.
 *
 * Nenhum log leva valor, descrição ou categoria: só IDs, ação, resultado,
 * código de erro e idade do evento.
 *
 * O gatilho da projeção do produto não faz o progresso patrimonial da meta:
 * `goals` só recebe `goalId` numa transação pelo espelho de caixa que o
 * domínio patrimonial grava (`operationsV2.writeCashProjection`), e o
 * progresso correspondente já foi aplicado na mesma transação do ledger por
 * `updateGoalProjection`. A reconciliação é
 * `recalculateGoalInvestmentProgress`.
 */
export const handleTransactionWrite = async (
  event: TransactionWriteEvent,
  faults: TransactionWriteFaults = {},
): Promise<TransactionWriteResult> => {
  const eventKey = cashPeriodEventKey(event.eventId);
  const action = actionOf(event);
  const log = createOperationLogger({
    operation: "onTransactionWrite",
    requestId: eventKey,
    workspaceId: event.workspaceId,
    transactionId: event.transactionId,
    action,
  });
  const ageSeconds = () => Math.max(
    0,
    Math.floor(((faults.now?.() ?? Date.now()) -
      event.eventTime.toMillis()) / 1000),
  );

  let projection: CashPeriodEventOutcomeKind;
  try {
    faults.beforeProjection?.();
    const outcome = await db().runTransaction(async (transaction) => {
      const result = await applyCashPeriodWriteOnce(
        transaction,
        event.workspaceId,
        eventKey,
        event.before,
        event.after,
        {
          transactionId: event.transactionId,
          action,
          eventTime: event.eventTime,
          beforeCreateTime: event.beforeCreateTime,
        },
      );
      faults.insideProjection?.();
      return result;
    });
    projection = outcome.outcome;
    log.info("cash_projection.processed", {
      outcome: outcome.outcome,
      periodCount: outcome.periods.length,
      ageSeconds: ageSeconds(),
    });
    if (outcome.outcome === "ambiguous_delete") {
      log.error("cash_projection.needs_rebuild", null, {
        reason: "ambiguous_delete",
      });
    }
  } catch (error) {
    const errorClass = classifyProjectionError(error);
    const age = ageSeconds();
    const fields = {errorCode: errorCodeOf(error), errorClass, ageSeconds: age};
    if (errorClass === "transient" && age < RETRY_GIVE_UP_AGE_SECONDS) {
      log.warn("cash_projection.retry", fields);
      throw error;
    }
    log.error("cash_projection.failed", error, fields);
    try {
      await recordCashProjectionIssue(event.workspaceId, {
        code: errorClass === "transient" ?
          "retry_window_exhausted" :
          "permanent_failure",
        eventTime: event.eventTime,
        transactionId: event.transactionId,
      });
    } catch (recordError) {
      log.error("cash_projection.issue_record_failed", recordError, {
        errorCode: errorCodeOf(recordError),
      });
      throw error;
    }
    log.error("cash_projection.needs_rebuild", null, {
      reason: errorClass === "transient" ?
        "retry_window_exhausted" :
        "permanent_failure",
    });
    return {projection: "failed_recorded", activityLogged: false};
  }

  try {
    faults.afterProjection?.();
    faults.beforeActivityLog?.();
    await writeActivityLog(event, eventKey, action);
  } catch (error) {
    const errorClass = classifyProjectionError(error);
    const age = ageSeconds();
    const fields = {errorCode: errorCodeOf(error), errorClass, ageSeconds: age};
    if (errorClass === "transient" && age < RETRY_GIVE_UP_AGE_SECONDS) {
      log.warn("activity_log.retry", fields);
      throw error;
    }
    log.error("activity_log.failed", error, fields);
    return {projection, activityLogged: false};
  }
  return {projection, activityLogged: true};
};

export const onTransactionWrite = onDocumentWritten(
  {
    ...TRANSACTION_WRITE_TRIGGER_OPTIONS,
    document: "workspaces/{workspaceId}/transactions/{transactionId}",
  },
  async (event) => {
    if (!event.data) return;
    const {workspaceId, transactionId} = event.params;
    const {before, after} = event.data;
    // Criação e alteração: `updateTime` é o commit exato da escrita. Exclusão
    // não tem `after`; a hora do evento é o commit da exclusão.
    let eventTime: Timestamp;
    try {
      eventTime = after.exists && after.updateTime ?
        after.updateTime :
        parseCloudEventTime(event.time);
    } catch (error) {
      // Sem instante de commit não há como situar o evento frente à cerca da
      // reconstrução: nada é somado e a projeção fica marcada para
      // reconciliação, com o instante atual como limite conservador.
      createOperationLogger({
        operation: "onTransactionWrite",
        workspaceId,
        transactionId,
      }).error("cash_projection.failed", error, {errorCode: "event_time"});
      await recordCashProjectionIssue(workspaceId, {
        code: "permanent_failure",
        eventTime: Timestamp.now(),
        transactionId,
      });
      return;
    }
    await handleTransactionWrite({
      eventId: event.id,
      workspaceId,
      transactionId,
      eventTime,
      before: before.exists ? before.data() : undefined,
      after: after.exists ? after.data() : undefined,
      beforeCreateTime: before.exists ? before.createTime : undefined,
    });
  },
);
