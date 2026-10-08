import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
  type ActorIdempotencyReservation,
} from "../shared/idempotency";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import {
  INTERNAL_MESSAGE,
  OCCURRENCE_INCONSISTENT_MESSAGE,
  OCCURRENCE_NOT_FOUND_MESSAGE,
  RECURRING_INCONSISTENT_MESSAGE,
  RECURRING_ROLES,
  assertCanManage,
  readIntentAnchor,
  reserveRecurringRateLimit,
  todayOf,
  type RecurringOperationOptions,
} from "./common";
import type {
  ConfirmRecurringOccurrencePayload,
  IgnoreRecurringOccurrencePayload,
  RetryRecurringOccurrencePayload,
} from "./contracts";
import {
  commitFact,
  prepareFact,
  type CashSettlement,
  type FactTarget,
} from "./facts";
import {
  appendRecurringEvent,
  occurrenceSnapshot,
  readAuthoritativeOccurrence,
  readAuthoritativeRecurringExpense,
  recurringExpensesRef,
  recurringIntentIdFor,
  recurringOccurrencesRef,
  type AuthoritativeOccurrence,
  type AuthoritativeRecurringExpense,
  type RecurringEventOperation,
} from "./model";

/**
 * Ações do usuário sobre uma ocorrência já alcançada (P4-B).
 *
 * - Confirmar (`awaiting_confirmation` → `generated`): cartão cria a compra
 *   P4-A `source = recurring`; fora do cartão, o usuário escolhe gerar o
 *   lançamento pendente ou registrá-lo como pago agora (valor real, conta e
 *   data efetiva), sempre pelo domínio P3.
 * - Ignorar (`awaiting_confirmation` ou `attention_required` → `ignored`):
 *   terminal, sem fato.
 * - Tentar de novo (`attention_required` → `generated`): depois da correção
 *   (cartão reativado, limite, conta reativada) ou apontando outro cartão ou
 *   outra conta do mesmo destino. Persistindo o impedimento, o erro de
 *   domínio volta ao usuário e nada é gravado.
 *
 * Toda ação relê o papel e o contrato (titularidade de `member`) na
 * transação, é idempotente por ator, tem âncora durável e evento, e produz
 * no máximo um fato por ocorrência: o estado da ocorrência é a guarda, e o
 * fato tem ID determinístico pela ocorrência. Recorrência cancelada não gera
 * mais nada: suas ocorrências abertas só podem ser ignoradas.
 */
export const CONFIRM_RECURRING_OCCURRENCE_OPERATION =
  "confirmRecurringOccurrence";
export const IGNORE_RECURRING_OCCURRENCE_OPERATION =
  "ignoreRecurringOccurrence";
export const RETRY_RECURRING_OCCURRENCE_OPERATION =
  "retryRecurringOccurrence";

export const OCCURRENCE_NOT_AWAITING_MESSAGE =
  "Esta ocorrência não está aguardando confirmação.";
export const OCCURRENCE_NOT_ATTENTION_MESSAGE =
  "Esta ocorrência não está aguardando nova tentativa.";
export const OCCURRENCE_ALREADY_RESOLVED_MESSAGE =
  "Esta ocorrência já foi resolvida.";
export const CANCELLED_CONTRACT_MESSAGE =
  "Esta recorrência foi cancelada: suas ocorrências em aberto só podem ser " +
  "ignoradas.";
export const CASH_FIELDS_ON_CARD_MESSAGE =
  "Ocorrência de cartão: não informe conta, forma de registro nem data de " +
  "pagamento.";
export const SETTLEMENT_REQUIRED_MESSAGE =
  "Escolha se a despesa será gerada como pendente ou registrada como paga.";
export const CARD_ON_CASH_MESSAGE =
  "Esta ocorrência é do Caixa: informe uma conta, não um cartão.";
export const ACCOUNT_ON_CARD_MESSAGE =
  "Esta ocorrência é de cartão: informe um cartão, não uma conta.";

const db = () => admin.firestore();

export interface OccurrenceMutationResult {
  occurrenceId: string;
  recurringExpenseId: string;
  replayed: boolean;
  [key: string]: unknown;
}

const replayResult = (
  stored: Record<string, unknown>,
): OccurrenceMutationResult => {
  if (typeof stored.occurrenceId !== "string") {
    throw new ApplicationError("internal", INTERNAL_MESSAGE);
  }
  return {...(stored as OccurrenceMutationResult), replayed: true};
};

interface LoadedOccurrence {
  role: WorkspaceRole;
  workspace: admin.firestore.DocumentData;
  reservation: ActorIdempotencyReservation;
  intentId: string;
  occurrenceRef: admin.firestore.DocumentReference;
  occurrence: AuthoritativeOccurrence;
  contractRef: admin.firestore.DocumentReference;
  contract: AuthoritativeRecurringExpense;
}

const loadOccurrenceForAction = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  payload: {occurrenceId: string; idempotencyKey: string},
  operation: string,
  eventOperation: RecurringEventOperation,
): Promise<{replay: OccurrenceMutationResult} | {loaded: LoadedOccurrence}> => {
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
    return {replay: {
      occurrenceId: anchor.occurrenceId ?? payload.occurrenceId,
      recurringExpenseId: anchor.recurringExpenseId,
      replayed: true,
    }};
  }
  const occurrenceRef = recurringOccurrencesRef(actor.workspaceId)
    .doc(payload.occurrenceId);
  const occurrenceDoc = await transaction.get(occurrenceRef);
  if (!occurrenceDoc.exists) {
    throw new ApplicationError("not_found", OCCURRENCE_NOT_FOUND_MESSAGE);
  }
  const occurrence = readAuthoritativeOccurrence(occurrenceDoc.id,
    occurrenceDoc.data(), actor.workspaceId);
  if (!occurrence) {
    throw new ApplicationError("domain_precondition_failed",
      OCCURRENCE_INCONSISTENT_MESSAGE);
  }
  const contractRef = recurringExpensesRef(actor.workspaceId)
    .doc(occurrence.recurringExpenseId);
  const contractDoc = await transaction.get(contractRef);
  const contract = readAuthoritativeRecurringExpense(contractDoc.id,
    contractDoc.data(), actor.workspaceId);
  if (!contract) {
    throw new ApplicationError("domain_precondition_failed",
      RECURRING_INCONSISTENT_MESSAGE);
  }
  assertCanManage(role, actor, contract.createdBy);
  return {loaded: {role, workspace, reservation, intentId, occurrenceRef,
    occurrence, contractRef, contract}};
};

const assertStatus = (
  occurrence: AuthoritativeOccurrence,
  allowed: readonly AuthoritativeOccurrence["status"][],
  message: string,
): void => {
  if (allowed.includes(occurrence.status)) return;
  throw new ApplicationError("domain_precondition_failed",
    occurrence.status === "generated" || occurrence.status === "ignored" ?
      OCCURRENCE_ALREADY_RESOLVED_MESSAGE : message);
};

/** Escritas comuns: ocorrência, contador, evento, chave e limite. */
const finishAction = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  loaded: LoadedOccurrence,
  input: {
    patch: Record<string, unknown>;
    after: AuthoritativeOccurrence;
    operation: string;
    eventOperation: RecurringEventOperation;
    requestId: string;
    correlationId: string | null;
    result: Record<string, unknown>;
  },
  rateLimit: {commit: () => void},
): void => {
  transaction.update(loaded.occurrenceRef, {
    ...input.patch,
    resolvedBy: actor.uid,
    updatedBy: actor.uid,
    lastRequestId: input.requestId,
    revision: loaded.occurrence.revision + 1,
    updatedAt: FieldValue.serverTimestamp(),
  });
  // A ocorrência deixa de pedir ação: o contador do contrato desce.
  transaction.update(loaded.contractRef, {
    openOccurrenceCount: FieldValue.increment(-1),
  });
  appendRecurringEvent(transaction, {
    workspaceId: actor.workspaceId,
    recurringExpenseId: loaded.contract.id,
    occurrenceId: loaded.occurrence.id,
    operation: input.eventOperation,
    targetKey: loaded.intentId,
    actorId: actor.uid,
    actorRole: loaded.role,
    intentId: loaded.intentId,
    requestHash: loaded.reservation.requestHash,
    requestId: input.requestId,
    correlationId: input.correlationId,
    before: occurrenceSnapshot(loaded.occurrence),
    after: occurrenceSnapshot(input.after),
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

const profileTypeOf = (workspace: admin.firestore.DocumentData) =>
  workspace.type === "PJ" ? "PJ" as const : "PF" as const;

// --------------------------------------------------------------- confirmar

export const executeConfirmRecurringOccurrence = async (
  actor: WorkspaceActor,
  payload: ConfirmRecurringOccurrencePayload,
  requestId: string,
  options: RecurringOperationOptions = {},
): Promise<OccurrenceMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadOccurrenceForAction(transaction, actor, payload,
      CONFIRM_RECURRING_OCCURRENCE_OPERATION,
      "recurring.occurrence_confirmed");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {occurrence, contract} = loaded;
    assertStatus(occurrence, ["awaiting_confirmation"],
      OCCURRENCE_NOT_AWAITING_MESSAGE);
    if (contract.status === "cancelled") {
      throw new ApplicationError("domain_precondition_failed",
        CANCELLED_CONTRACT_MESSAGE);
    }
    let target: FactTarget;
    let settlement: CashSettlement = {status: "pending"};
    if (occurrence.targetDomain === "card") {
      if (
        payload.settlement !== undefined ||
        payload.cashAccountId !== undefined ||
        payload.paidDate !== undefined
      ) {
        throw new ApplicationError("invalid_payload",
          CASH_FIELDS_ON_CARD_MESSAGE);
      }
      target = {domain: "card", cardId: occurrence.cardId as string};
    } else {
      if (payload.settlement === undefined) {
        throw new ApplicationError("invalid_payload",
          SETTLEMENT_REQUIRED_MESSAGE);
      }
      target = {
        domain: "cash",
        cashAccountId: payload.cashAccountId ??
          occurrence.cashAccountId as string,
      };
      settlement = payload.settlement === "paid" ?
        {status: "paid", paidDate: payload.paidDate as string} :
        {status: "pending"};
    }
    const amountCents = payload.amountCents ?? occurrence.plannedAmountCents;
    // Ação do usuário: impedimento de domínio volta como erro em pt-BR.
    const plan = await prepareFact(transaction, {
      workspaceId: actor.workspaceId,
      target,
      amountCents,
      dueDate: occurrence.dueDate,
      today: todayOf(options),
      settlement,
      impedimentsAsAttention: false,
    });
    if (plan.kind === "attention") {
      throw new ApplicationError("internal", INTERNAL_MESSAGE);
    }
    const rateLimit = await reserveRecurringRateLimit(transaction, actor);

    const fact = commitFact(transaction, plan, {
      workspaceId: actor.workspaceId,
      profileType: profileTypeOf(loaded.workspace),
      contract,
      occurrenceId: occurrence.id,
      dueDate: occurrence.dueDate,
      amountCents,
      actorId: actor.uid,
      actorRole: loaded.role,
      requestHash: loaded.reservation.requestHash,
      operation: CONFIRM_RECURRING_OCCURRENCE_OPERATION,
      requestId,
      correlationId: payload.correlationId ?? null,
    });
    const cashAccountId = target.domain === "cash" ?
      target.cashAccountId : occurrence.cashAccountId;
    const after: AuthoritativeOccurrence = {
      ...occurrence,
      status: "generated",
      actualAmountCents: amountCents,
      cashAccountId,
      cashTransactionId: fact.cashTransactionId,
      cardPurchaseId: fact.cardPurchaseId,
    };
    const result = {
      occurrenceId: occurrence.id,
      recurringExpenseId: contract.id,
      status: "generated",
      cashTransactionId: fact.cashTransactionId,
      cardPurchaseId: fact.cardPurchaseId,
    };
    finishAction(transaction, actor, loaded, {
      patch: {
        status: "generated",
        actualAmountCents: amountCents,
        cashAccountId,
        cashTransactionId: fact.cashTransactionId,
        cardPurchaseId: fact.cardPurchaseId,
        settlement: target.domain === "cash" ?
          (settlement.status === "paid" ? "paid" : "pending") : null,
      },
      after,
      operation: CONFIRM_RECURRING_OCCURRENCE_OPERATION,
      eventOperation: "recurring.occurrence_confirmed",
      requestId,
      correlationId: payload.correlationId ?? null,
      result,
    }, rateLimit);
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ----------------------------------------------------------------- ignorar

export const executeIgnoreRecurringOccurrence = async (
  actor: WorkspaceActor,
  payload: IgnoreRecurringOccurrencePayload,
  requestId: string,
  options: RecurringOperationOptions = {},
): Promise<OccurrenceMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadOccurrenceForAction(transaction, actor, payload,
      IGNORE_RECURRING_OCCURRENCE_OPERATION, "recurring.occurrence_ignored");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {occurrence, contract} = loaded;
    assertStatus(occurrence, ["awaiting_confirmation", "attention_required"],
      OCCURRENCE_ALREADY_RESOLVED_MESSAGE);
    const rateLimit = await reserveRecurringRateLimit(transaction, actor);
    const after: AuthoritativeOccurrence = {
      ...occurrence,
      status: "ignored",
      attentionCode: null,
    };
    const result = {
      occurrenceId: occurrence.id,
      recurringExpenseId: contract.id,
      status: "ignored",
    };
    finishAction(transaction, actor, loaded, {
      patch: {status: "ignored", attentionCode: null},
      after,
      operation: IGNORE_RECURRING_OCCURRENCE_OPERATION,
      eventOperation: "recurring.occurrence_ignored",
      requestId,
      correlationId: payload.correlationId ?? null,
      result,
    }, rateLimit);
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ---------------------------------------------------------- tentar de novo

export const executeRetryRecurringOccurrence = async (
  actor: WorkspaceActor,
  payload: RetryRecurringOccurrencePayload,
  requestId: string,
  options: RecurringOperationOptions = {},
): Promise<OccurrenceMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadOccurrenceForAction(transaction, actor, payload,
      RETRY_RECURRING_OCCURRENCE_OPERATION, "recurring.occurrence_retried");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {occurrence, contract} = loaded;
    assertStatus(occurrence, ["attention_required"],
      OCCURRENCE_NOT_ATTENTION_MESSAGE);
    if (contract.status === "cancelled") {
      throw new ApplicationError("domain_precondition_failed",
        CANCELLED_CONTRACT_MESSAGE);
    }
    let target: FactTarget;
    if (occurrence.targetDomain === "card") {
      if (payload.cashAccountId !== undefined) {
        throw new ApplicationError("invalid_payload", ACCOUNT_ON_CARD_MESSAGE);
      }
      target = {domain: "card",
        cardId: payload.cardId ?? occurrence.cardId as string};
    } else {
      if (payload.cardId !== undefined) {
        throw new ApplicationError("invalid_payload", CARD_ON_CASH_MESSAGE);
      }
      target = {domain: "cash", cashAccountId:
        payload.cashAccountId ?? occurrence.cashAccountId as string};
    }
    // Nova tentativa da geração automática, agora pelo usuário: o
    // lançamento de caixa nasce pendente, como na geração automática.
    const plan = await prepareFact(transaction, {
      workspaceId: actor.workspaceId,
      target,
      amountCents: occurrence.plannedAmountCents,
      dueDate: occurrence.dueDate,
      today: todayOf(options),
      settlement: {status: "pending"},
      impedimentsAsAttention: false,
    });
    if (plan.kind === "attention") {
      throw new ApplicationError("internal", INTERNAL_MESSAGE);
    }
    const rateLimit = await reserveRecurringRateLimit(transaction, actor);
    const fact = commitFact(transaction, plan, {
      workspaceId: actor.workspaceId,
      profileType: profileTypeOf(loaded.workspace),
      contract,
      occurrenceId: occurrence.id,
      dueDate: occurrence.dueDate,
      amountCents: occurrence.plannedAmountCents,
      actorId: actor.uid,
      actorRole: loaded.role,
      requestHash: loaded.reservation.requestHash,
      operation: RETRY_RECURRING_OCCURRENCE_OPERATION,
      requestId,
      correlationId: payload.correlationId ?? null,
    });
    const cardId = target.domain === "card" ? target.cardId : null;
    const cashAccountId = target.domain === "cash" ?
      target.cashAccountId : null;
    const after: AuthoritativeOccurrence = {
      ...occurrence,
      status: "generated",
      actualAmountCents: occurrence.plannedAmountCents,
      attentionCode: null,
      cardId,
      cashAccountId,
      cashTransactionId: fact.cashTransactionId,
      cardPurchaseId: fact.cardPurchaseId,
    };
    const result = {
      occurrenceId: occurrence.id,
      recurringExpenseId: contract.id,
      status: "generated",
      cashTransactionId: fact.cashTransactionId,
      cardPurchaseId: fact.cardPurchaseId,
    };
    finishAction(transaction, actor, loaded, {
      patch: {
        status: "generated",
        actualAmountCents: occurrence.plannedAmountCents,
        attentionCode: null,
        cardId,
        cashAccountId,
        cashTransactionId: fact.cashTransactionId,
        cardPurchaseId: fact.cardPurchaseId,
        settlement: fact.cashTransactionId ? "pending" : null,
      },
      after,
      operation: RETRY_RECURRING_OCCURRENCE_OPERATION,
      eventOperation: "recurring.occurrence_retried",
      requestId,
      correlationId: payload.correlationId ?? null,
      result,
    }, rateLimit);
    options.beforeCommit?.();
    return {...result, replayed: false};
  });
