import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {
  assertActiveAccount,
  readPostingAccounts,
} from "../accounts/ledger";
import {
  CARD_ARCHIVED_MESSAGE,
  CARD_INCONSISTENT_MESSAGE,
  CARD_NOT_FOUND_MESSAGE,
} from "../cards/common";
import {cardsRef, readAuthoritativeCard} from "../cards/model";
import {ApplicationError} from "../shared/errors";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
  type ActorIdempotencyReservation,
} from "../shared/idempotency";
import {MONEY_CURRENCY} from "../shared/money";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import {
  IDEMPOTENCY_CONFLICT_MESSAGE,
  INTERNAL_MESSAGE,
  RECURRING_CONFLICT_MESSAGE,
  RECURRING_INCONSISTENT_MESSAGE,
  RECURRING_NOT_FOUND_MESSAGE,
  RECURRING_ROLES,
  assertCanManage,
  assertVersion,
  readIntentAnchor,
  reserveRecurringRateLimit,
  todayOf,
  type RecurringOperationOptions,
} from "./common";
import {
  contractIssues,
  type CreateRecurringExpensePayload,
  type RecurringLifecyclePayload,
  type UpdateRecurringExpensePayload,
} from "./contracts";
import {
  RECURRING_LIMIT_PER_WORKSPACE,
  RECURRING_SCHEMA_VERSION,
  appendRecurringEvent,
  contractSnapshot,
  readAuthoritativeRecurringExpense,
  recurringExpenseIdFor,
  recurringExpensesRef,
  recurringIntentIdFor,
  type AuthoritativeRecurringExpense,
  type RecurringBusinessDetails,
  type RecurringEventOperation,
  type RecurringStatus,
} from "./model";
import {addCivilDays, nextDueOnOrAfter, type ScheduleRule} from "./schedule";

/**
 * Ciclo de vida do contrato recorrente (P4-B, D-12).
 *
 * Cada operação é uma transação com releitura do papel (e da titularidade
 * de `member`), idempotência por ator, âncora durável da intenção, limite
 * operacional, evento append-only e, nas alterações, a versão lida
 * (`expectedUpdatedAt`).
 *
 * - Criação: valida cartão ativo (cartão de crédito) ou conta ativa do
 *   workspace (demais formas) e calcula o primeiro vencimento a partir de
 *   hoje — a geração não retroage para antes da criação.
 * - Edição: afeta só o futuro. Ocorrências, compras e lançamentos já gerados
 *   nunca são reescritos; mudar valor, frequência, dia, datas, forma de
 *   pagamento, modo, cartão ou conta recalcula o próximo vencimento.
 * - Pausa: interrompe a geração (vencimentos ainda não processados no
 *   momento da pausa não são gerados depois).
 * - Retomada: o primeiro vencimento elegível é o primeiro a partir do dia
 *   da retomada; o intervalo pausado não é recuperado.
 * - Cancelamento: terminal. Nada é apagado nem revertido, nada é gerado
 *   depois.
 */
export const CREATE_RECURRING_EXPENSE_OPERATION = "createRecurringExpense";
export const UPDATE_RECURRING_EXPENSE_OPERATION = "updateRecurringExpense";
export const PAUSE_RECURRING_EXPENSE_OPERATION = "pauseRecurringExpense";
export const RESUME_RECURRING_EXPENSE_OPERATION = "resumeRecurringExpense";
export const CANCEL_RECURRING_EXPENSE_OPERATION = "cancelRecurringExpense";

export const RECURRING_LIMIT_MESSAGE =
  "Este espaço de trabalho já tem o máximo de " +
  `${RECURRING_LIMIT_PER_WORKSPACE} despesas recorrentes.`;
export const BUSINESS_PJ_ONLY_MESSAGE =
  "Dados de empresa (fornecedor, centro de custo, contrato) só podem ser " +
  "informados em espaço PJ.";
export const NO_DUE_DATE_MESSAGE =
  "Não há vencimentos a partir de hoje até a data de término. Ajuste as " +
  "datas da recorrência.";
export const NOT_EDITABLE_MESSAGE =
  "Despesas recorrentes encerradas ou canceladas não podem ser alteradas.";
export const UNCHANGED_MESSAGE = "Nenhuma alteração para salvar.";
export const BACKLOG_MESSAGE =
  "Esta recorrência tem vencimentos anteriores ainda não processados. " +
  "Aguarde o processamento automático e tente novamente.";
export const ALREADY_PAUSED_MESSAGE = "Esta recorrência já está pausada.";
export const NOT_PAUSED_MESSAGE = "Esta recorrência não está pausada.";
export const NOT_ACTIVE_MESSAGE =
  "Só recorrências ativas podem ser pausadas.";
export const ALREADY_CANCELLED_MESSAGE = "Esta recorrência já foi cancelada.";
export const ALREADY_ENDED_MESSAGE =
  "Esta recorrência já foi encerrada pela data de término.";

const db = () => admin.firestore();

export interface RecurringMutationResult {
  recurringExpenseId: string;
  replayed: boolean;
  [key: string]: unknown;
}

const replayResult = (
  stored: Record<string, unknown>,
): RecurringMutationResult => {
  if (typeof stored.recurringExpenseId !== "string") {
    throw new ApplicationError("internal", INTERNAL_MESSAGE);
  }
  return {...(stored as RecurringMutationResult), replayed: true};
};

/** Cartão do contrato: existe no workspace, no schema e ativo. */
const assertActiveCard = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  cardId: string,
): Promise<void> => {
  const snapshot = await transaction.get(cardsRef(workspaceId).doc(cardId));
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", CARD_NOT_FOUND_MESSAGE);
  }
  const card = readAuthoritativeCard(snapshot.id, snapshot.data(), workspaceId);
  if (!card) {
    throw new ApplicationError("domain_precondition_failed",
      CARD_INCONSISTENT_MESSAGE);
  }
  if (card.status !== "active") {
    throw new ApplicationError("domain_precondition_failed",
      CARD_ARCHIVED_MESSAGE);
  }
};

/** Destino padrão do contrato: cartão ativo ou conta ativa do workspace. */
const assertActiveTarget = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  target: {cardId: string | null; cashAccountId: string | null},
): Promise<void> => {
  if (target.cardId !== null) {
    await assertActiveCard(transaction, workspaceId, target.cardId);
    return;
  }
  const accountId = target.cashAccountId as string;
  const accounts = await readPostingAccounts(transaction, workspaceId,
    [accountId]);
  assertActiveAccount(accounts.get(accountId) as
    Parameters<typeof assertActiveAccount>[0]);
};

const assertBusinessAllowed = (
  workspace: admin.firestore.DocumentData,
  business: RecurringBusinessDetails | null,
): void => {
  if (business !== null && workspace.type !== "PJ") {
    throw new ApplicationError("invalid_payload", BUSINESS_PJ_ONLY_MESSAGE);
  }
};

/** Primeiro vencimento a partir de `from` (inclusive), ou recusa. */
const firstDueFrom = (rule: ScheduleRule, from: string): string => {
  const next = nextDueOnOrAfter(rule, from);
  if (next === null) {
    throw new ApplicationError("domain_precondition_failed",
      NO_DUE_DATE_MESSAGE);
  }
  return next;
};

/** Dia a partir do qual o futuro do contrato começa. */
const futureStart = (
  today: string,
  lastProcessedDueDate: string | null,
): string => {
  if (lastProcessedDueDate === null) return today;
  const afterLast = addCivilDays(lastProcessedDueDate, 1);
  return afterLast > today ? afterLast : today;
};

// ------------------------------------------------------------------ criação

export const executeCreateRecurringExpense = async (
  actor: WorkspaceActor,
  payload: CreateRecurringExpensePayload,
  requestId: string,
  options: RecurringOperationOptions = {},
): Promise<RecurringMutationResult> =>
  db().runTransaction(async (transaction) => {
    const {workspace, role} = await reassertWorkspaceActor(
      transaction, actor, RECURRING_ROLES);
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: CREATE_RECURRING_EXPENSE_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload: payload as unknown as Record<string, unknown>,
    });
    if (reservation.replay) return replayResult(reservation.replay);

    const recurringExpenseId = recurringExpenseIdFor(actor.workspaceId,
      actor.uid, payload.idempotencyKey);
    const contractRef = recurringExpensesRef(actor.workspaceId)
      .doc(recurringExpenseId);
    const existing = await transaction.get(contractRef);
    if (existing.exists) {
      // Âncora durável: o próprio contrato no ID `(workspace, ator, chave)`.
      if (
        existing.get("requestHash") === reservation.requestHash &&
        existing.get("createdBy") === actor.uid
      ) {
        return {recurringExpenseId, replayed: true};
      }
      throw new ApplicationError("idempotency_conflict",
        IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    assertBusinessAllowed(workspace, payload.business);
    await assertActiveTarget(transaction, actor.workspaceId, payload);
    const count = (await transaction.get(
      recurringExpensesRef(actor.workspaceId).count())).data().count;
    if (count >= RECURRING_LIMIT_PER_WORKSPACE) {
      throw new ApplicationError("domain_precondition_failed",
        RECURRING_LIMIT_MESSAGE);
    }
    const today = todayOf(options);
    const rule: ScheduleRule = {
      frequency: payload.frequency,
      billingDay: payload.billingDay,
      startDate: payload.startDate,
      endDate: payload.endDate,
    };
    const nextDueDate = firstDueFrom(rule, today);
    const rateLimit = await reserveRecurringRateLimit(transaction, actor);

    const intentId = recurringIntentIdFor(actor.uid, payload.idempotencyKey);
    const document = {
      id: recurringExpenseId,
      schemaVersion: RECURRING_SCHEMA_VERSION,
      workspaceId: actor.workspaceId,
      name: payload.name,
      type: payload.type,
      description: payload.description,
      amountCents: payload.amountCents,
      currency: MONEY_CURRENCY,
      frequency: payload.frequency,
      billingDay: payload.billingDay,
      startDate: payload.startDate,
      endDate: payload.endDate,
      paymentMethod: payload.paymentMethod,
      executionMode: payload.executionMode,
      cardId: payload.cardId,
      cashAccountId: payload.cashAccountId,
      category: payload.category,
      status: "active" as RecurringStatus,
      nextDueDate,
      lastProcessedDueDate: null,
      openOccurrenceCount: 0,
      visual: payload.visual,
      business: payload.business,
      pausedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      endedAt: null,
      intentId,
      requestHash: reservation.requestHash,
      revision: 1,
      createdBy: actor.uid,
      updatedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    transaction.create(contractRef, document);
    appendRecurringEvent(transaction, {
      workspaceId: actor.workspaceId,
      recurringExpenseId,
      occurrenceId: null,
      operation: "recurring.created",
      targetKey: recurringExpenseId,
      actorId: actor.uid,
      actorRole: role,
      intentId,
      requestHash: reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      before: null,
      after: contractSnapshot(document),
    });
    const result = {recurringExpenseId, nextDueDate};
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: CREATE_RECURRING_EXPENSE_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ---------------------------------------------------- carregamento comum

interface LoadedContract {
  role: WorkspaceRole;
  workspace: admin.firestore.DocumentData;
  reservation: ActorIdempotencyReservation;
  intentId: string;
  contractRef: admin.firestore.DocumentReference;
  contract: AuthoritativeRecurringExpense;
}

/**
 * Fase de leitura comum às alterações: papel relido, recibo da chave,
 * âncora durável da intenção, contrato no schema, titularidade de `member`
 * e versão lida.
 */
const loadContractForMutation = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  payload: {
    recurringExpenseId: string;
    idempotencyKey: string;
    expectedUpdatedAt: string;
  },
  operation: string,
  eventOperation: RecurringEventOperation,
): Promise<{replay: RecurringMutationResult} | {loaded: LoadedContract}> => {
  const {workspace, role} = await reassertWorkspaceActor(
    transaction, actor, RECURRING_ROLES);
  const reservation = await reserveActorIdempotency(transaction, {
    uid: actor.uid,
    operation,
    idempotencyKey: payload.idempotencyKey,
    payload: payload as unknown as Record<string, unknown>,
  });
  if (reservation.replay) return {replay: replayResult(reservation.replay)};
  const intentId = recurringIntentIdFor(actor.uid, payload.idempotencyKey);
  const anchor = await readIntentAnchor(transaction, actor.workspaceId,
    eventOperation, intentId, reservation);
  if (anchor) {
    return {replay: {recurringExpenseId: anchor.recurringExpenseId,
      replayed: true}};
  }
  const contractRef = recurringExpensesRef(actor.workspaceId)
    .doc(payload.recurringExpenseId);
  const snapshot = await transaction.get(contractRef);
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", RECURRING_NOT_FOUND_MESSAGE);
  }
  const contract = readAuthoritativeRecurringExpense(snapshot.id,
    snapshot.data(), actor.workspaceId);
  if (!contract) {
    throw new ApplicationError("domain_precondition_failed",
      RECURRING_INCONSISTENT_MESSAGE);
  }
  assertCanManage(role, actor, contract.createdBy);
  assertVersion(contract.updatedAt, payload.expectedUpdatedAt,
    RECURRING_CONFLICT_MESSAGE);
  return {
    loaded: {role, workspace, reservation, intentId, contractRef, contract},
  };
};

/** Escritas comuns: evento, conclusão da chave e limite. */
const finishMutation = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  loaded: LoadedContract,
  input: {
    operation: string;
    eventOperation: RecurringEventOperation;
    requestId: string;
    correlationId: string | null;
    before: AuthoritativeRecurringExpense;
    after: Parameters<typeof contractSnapshot>[0];
    changedFields?: string[];
    reason?: string | null;
    result: Record<string, unknown>;
  },
  rateLimit: {commit: () => void},
): void => {
  appendRecurringEvent(transaction, {
    workspaceId: actor.workspaceId,
    recurringExpenseId: loaded.contract.id,
    occurrenceId: null,
    operation: input.eventOperation,
    targetKey: loaded.intentId,
    actorId: actor.uid,
    actorRole: loaded.role,
    intentId: loaded.intentId,
    requestHash: loaded.reservation.requestHash,
    requestId: input.requestId,
    correlationId: input.correlationId,
    before: contractSnapshot(input.before),
    after: contractSnapshot(input.after),
    changedFields: input.changedFields,
    reason: input.reason ?? null,
  });
  completeActorIdempotency(transaction, loaded.reservation, {
    uid: actor.uid,
    operation: input.operation,
    workspaceId: actor.workspaceId,
    requestId: input.requestId,
    result: input.result,
  });
  rateLimit.commit();
};

// ------------------------------------------------------------------ edição

/** Campos que mudam agenda, valor ou destino: recalculam o vencimento. */
const SCHEDULE_FIELDS = [
  "amountCents", "frequency", "billingDay", "startDate", "endDate",
  "paymentMethod", "executionMode", "cardId", "cashAccountId",
] as const;

const DESCRIPTIVE_FIELDS = [
  "name", "type", "description", "category", "visual", "business",
] as const;

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const executeUpdateRecurringExpense = async (
  actor: WorkspaceActor,
  payload: UpdateRecurringExpensePayload,
  requestId: string,
  options: RecurringOperationOptions = {},
): Promise<RecurringMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadContractForMutation(transaction, actor, payload,
      UPDATE_RECURRING_EXPENSE_OPERATION, "recurring.updated");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {contract} = loaded;
    if (contract.status === "ended" || contract.status === "cancelled") {
      throw new ApplicationError("domain_precondition_failed",
        NOT_EDITABLE_MESSAGE);
    }
    const {changes} = payload;
    const next = {...contract};
    const changedFields: string[] = [];
    for (const key of [...SCHEDULE_FIELDS, ...DESCRIPTIVE_FIELDS]) {
      const value = changes[key];
      if (value === undefined || sameValue(value, contract[key])) continue;
      (next as Record<string, unknown>)[key] = value;
      changedFields.push(key);
    }
    if (changedFields.length === 0) {
      throw new ApplicationError("domain_precondition_failed",
        UNCHANGED_MESSAGE);
    }
    const issues = contractIssues(next);
    if (issues.length > 0) {
      throw new ApplicationError("invalid_payload", issues[0].message);
    }
    assertBusinessAllowed(loaded.workspace, next.business);
    const today = todayOf(options);
    const scheduleChanged = changedFields.some((field) =>
      (SCHEDULE_FIELDS as readonly string[]).includes(field));
    if (
      scheduleChanged &&
      contract.status === "active" &&
      (contract.nextDueDate as string) < today
    ) {
      throw new ApplicationError("domain_precondition_failed",
        BACKLOG_MESSAGE);
    }
    const targetChanged = ["paymentMethod", "cardId", "cashAccountId"]
      .some((field) => changedFields.includes(field));
    if (targetChanged) {
      await assertActiveTarget(transaction, actor.workspaceId, next);
    }
    let nextDueDate = contract.nextDueDate;
    if (scheduleChanged && contract.status === "active") {
      nextDueDate = firstDueFrom(next,
        futureStart(today, contract.lastProcessedDueDate));
    }
    const rateLimit = await reserveRecurringRateLimit(transaction, actor);

    const patch: Record<string, unknown> = {};
    for (const field of changedFields) {
      patch[field] = (next as Record<string, unknown>)[field];
    }
    transaction.update(loaded.contractRef, {
      ...patch,
      nextDueDate,
      revision: contract.revision + 1,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = {
      recurringExpenseId: contract.id,
      nextDueDate,
      revision: contract.revision + 1,
    };
    finishMutation(transaction, actor, loaded, {
      operation: UPDATE_RECURRING_EXPENSE_OPERATION,
      eventOperation: "recurring.updated",
      requestId,
      correlationId: payload.correlationId ?? null,
      before: contract,
      after: {...next, nextDueDate},
      changedFields,
      reason: payload.reason ?? null,
      result,
    }, rateLimit);
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ------------------------------------------------------------ ciclo de vida

const assertLifecycle = (
  contract: AuthoritativeRecurringExpense,
  allowed: readonly RecurringStatus[],
  messageFor: Partial<Record<RecurringStatus, string>>,
): void => {
  if (allowed.includes(contract.status)) return;
  throw new ApplicationError("domain_precondition_failed",
    messageFor[contract.status] ?? NOT_EDITABLE_MESSAGE);
};

export const executePauseRecurringExpense = async (
  actor: WorkspaceActor,
  payload: RecurringLifecyclePayload,
  requestId: string,
  options: RecurringOperationOptions = {},
): Promise<RecurringMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadContractForMutation(transaction, actor, payload,
      PAUSE_RECURRING_EXPENSE_OPERATION, "recurring.paused");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {contract} = loaded;
    assertLifecycle(contract, ["active"], {
      paused: ALREADY_PAUSED_MESSAGE,
      cancelled: ALREADY_CANCELLED_MESSAGE,
      ended: ALREADY_ENDED_MESSAGE,
    });
    const rateLimit = await reserveRecurringRateLimit(transaction, actor);
    transaction.update(loaded.contractRef, {
      status: "paused",
      nextDueDate: null,
      pausedAt: FieldValue.serverTimestamp(),
      revision: contract.revision + 1,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = {recurringExpenseId: contract.id, status: "paused"};
    finishMutation(transaction, actor, loaded, {
      operation: PAUSE_RECURRING_EXPENSE_OPERATION,
      eventOperation: "recurring.paused",
      requestId,
      correlationId: payload.correlationId ?? null,
      before: contract,
      after: {...contract, status: "paused", nextDueDate: null},
      result,
    }, rateLimit);
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

export const executeResumeRecurringExpense = async (
  actor: WorkspaceActor,
  payload: RecurringLifecyclePayload,
  requestId: string,
  options: RecurringOperationOptions = {},
): Promise<RecurringMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadContractForMutation(transaction, actor, payload,
      RESUME_RECURRING_EXPENSE_OPERATION, "recurring.resumed");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {contract} = loaded;
    assertLifecycle(contract, ["paused"], {
      active: NOT_PAUSED_MESSAGE,
      cancelled: ALREADY_CANCELLED_MESSAGE,
      ended: ALREADY_ENDED_MESSAGE,
    });
    // Sem recuperar o intervalo pausado: o primeiro vencimento a partir de
    // hoje (e depois do último processado). Término já passado encerra.
    const today = todayOf(options);
    const nextDueDate = nextDueOnOrAfter(contract,
      futureStart(today, contract.lastProcessedDueDate));
    const status: RecurringStatus = nextDueDate === null ? "ended" : "active";
    const rateLimit = await reserveRecurringRateLimit(transaction, actor);
    transaction.update(loaded.contractRef, {
      status,
      nextDueDate,
      pausedAt: null,
      ...(status === "ended" ? {endedAt: FieldValue.serverTimestamp()} : {}),
      revision: contract.revision + 1,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = {recurringExpenseId: contract.id, status, nextDueDate};
    finishMutation(transaction, actor, loaded, {
      operation: RESUME_RECURRING_EXPENSE_OPERATION,
      eventOperation: "recurring.resumed",
      requestId,
      correlationId: payload.correlationId ?? null,
      before: contract,
      after: {...contract, status, nextDueDate},
      result,
    }, rateLimit);
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

export const executeCancelRecurringExpense = async (
  actor: WorkspaceActor,
  payload: RecurringLifecyclePayload,
  requestId: string,
  options: RecurringOperationOptions = {},
): Promise<RecurringMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadContractForMutation(transaction, actor, payload,
      CANCEL_RECURRING_EXPENSE_OPERATION, "recurring.cancelled");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {contract} = loaded;
    assertLifecycle(contract, ["active", "paused"], {
      cancelled: ALREADY_CANCELLED_MESSAGE,
      ended: ALREADY_ENDED_MESSAGE,
    });
    const rateLimit = await reserveRecurringRateLimit(transaction, actor);
    transaction.update(loaded.contractRef, {
      status: "cancelled",
      nextDueDate: null,
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: actor.uid,
      revision: contract.revision + 1,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = {recurringExpenseId: contract.id, status: "cancelled"};
    finishMutation(transaction, actor, loaded, {
      operation: CANCEL_RECURRING_EXPENSE_OPERATION,
      eventOperation: "recurring.cancelled",
      requestId,
      correlationId: payload.correlationId ?? null,
      before: contract,
      after: {...contract, status: "cancelled", nextDueDate: null},
      result,
    }, rateLimit);
    options.beforeCommit?.();
    return {...result, replayed: false};
  });
