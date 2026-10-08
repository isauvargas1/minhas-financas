import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import {MONEY_CURRENCY} from "../shared/money";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {
  AggregateBook,
  writeGroup,
  writeParticipantBalances,
} from "./aggregates";
import {readGroupParticipants} from "./billOperations";
import {
  commitSplitCashFact,
  commitSplitCashReversal,
  prepareSplitCashFact,
  prepareSplitCashReversal,
} from "./cash";
import {
  REIMBURSEMENT_CONFLICT_MESSAGE,
  REIMBURSEMENT_INCONSISTENT_MESSAGE,
  REIMBURSEMENT_NOT_FOUND_MESSAGE,
  SPLIT_ACTOR_ROLES,
  SPLIT_FINANCIAL_RATE_LIMIT,
  assertGroupActive,
  assertNotFuture,
  assertVersion,
  beginSplitMutation,
  correlationOf,
  finishSplitMutation,
  isWorkspaceAdmin,
  loadGroupAccess,
  reserveSplitRateLimit,
  splitIds,
  type GroupAccess,
  type SplitMutationResult,
  type SplitMutationStart,
  type SplitOperationOptions,
} from "./common";
import type {
  CreateSplitReimbursementPayload,
  PaySplitReimbursementPayload,
  RejectSplitReimbursementPayload,
  ReimbursementActionPayload,
} from "./contracts";
import {
  SPLIT_LIMITS,
  SPLIT_SCHEMA_VERSION,
  appendSplitEvent,
  isOpenReimbursement,
  readAuthoritativeReimbursement,
  reimbursementSnapshot,
  splitParticipantsRef,
  splitReimbursementCashTransactionIdFor,
  splitReimbursementIdFor,
  splitReimbursementsRef,
  type AuthoritativeSplitParticipant,
  type AuthoritativeSplitReimbursement,
  type SplitEventOperation,
  type SplitReimbursementStatus,
} from "./model";

/**
 * Reembolso PJ (P4-C, §21–§25): só em grupos `reimbursement` (espaços PJ).
 *
 * `requested` → `approved` → `paid`; `requested`/`approved` → `rejected`;
 * `requested` (pelo solicitante) ou `requested`/`approved` (owner/admin) →
 * `cancelled`; `paid` → `approved` pelo estorno do pagamento.
 *
 * - pedir: membro só para si (o próprio participante no grupo); owner/admin
 *   para qualquer participante ativo, inclusive externo;
 * - aprovar, rejeitar, pagar e estornar: só owner/admin do workspace;
 * - pagar é integral: no mesmo commit, o reembolso vai a `paid`, nasce a
 *   despesa confirmada no Caixa (P3) na conta escolhida, a conta é movida
 *   (P3-J) e o vínculo fica no reembolso; a descrição do lançamento é
 *   genérica, sem nada do solicitante;
 * - estornar: compensa o lançamento na mesma conta, volta a `approved`; um
 *   segundo estorno é recusado (não está mais pago), e o replay da mesma
 *   chave devolve o resultado original.
 */
export const CREATE_SPLIT_REIMBURSEMENT_OPERATION = "createSplitReimbursement";
export const APPROVE_SPLIT_REIMBURSEMENT_OPERATION =
  "approveSplitReimbursement";
export const REJECT_SPLIT_REIMBURSEMENT_OPERATION = "rejectSplitReimbursement";
export const CANCEL_SPLIT_REIMBURSEMENT_OPERATION = "cancelSplitReimbursement";
export const PAY_SPLIT_REIMBURSEMENT_OPERATION = "paySplitReimbursement";
export const REVERSE_REIMBURSEMENT_PAYMENT_OPERATION =
  "reverseReimbursementPayment";

export const REIMBURSEMENT_PAYMENT_DESCRIPTION = "Reembolso de despesa";
export const REIMBURSEMENT_REVERSAL_DESCRIPTION =
  "Estorno: reembolso de despesa";

export const REIMBURSEMENT_SPLIT_GROUP_MESSAGE =
  "Este grupo é de rateio: lance um título em vez de um pedido de reembolso.";
export const REIMBURSEMENT_SELF_ONLY_MESSAGE =
  "Membros só podem pedir reembolso para si mesmos.";
export const REIMBURSEMENT_REQUESTER_NOT_ELIGIBLE_MESSAGE =
  "Quem pede o reembolso precisa estar ativo no grupo, como dono ou " +
  "participante.";
export const REIMBURSEMENT_ADMIN_ONLY_MESSAGE =
  "Só um administrador do espaço pode aprovar, rejeitar, pagar ou estornar " +
  "reembolsos.";
export const REIMBURSEMENT_LIMIT_MESSAGE =
  `Este grupo atingiu o limite de ${SPLIT_LIMITS.openBillsPerGroup} ` +
  "reembolsos em aberto.";
export const REIMBURSEMENT_NOT_REQUESTED_MESSAGE =
  "Só um pedido aguardando aprovação pode ser aprovado.";
export const REIMBURSEMENT_NOT_REJECTABLE_MESSAGE =
  "Só pedidos aguardando aprovação ou aprovados podem ser rejeitados.";
export const REIMBURSEMENT_NOT_CANCELLABLE_MESSAGE =
  "Este pedido não pode mais ser cancelado.";
export const REIMBURSEMENT_CANCEL_DENIED_MESSAGE =
  "Só quem pediu (enquanto aguarda aprovação) ou um administrador do espaço " +
  "pode cancelar o pedido.";
export const REIMBURSEMENT_NOT_APPROVED_MESSAGE =
  "Só um reembolso aprovado pode ser pago.";
export const REIMBURSEMENT_NOT_PAID_MESSAGE =
  "Só um reembolso pago pode ter o pagamento estornado.";

const db = () => admin.firestore();

const reimbursementState = (status: SplitReimbursementStatus) =>
  isOpenReimbursement(status) ? "open" as const :
    status === "paid" ? "paid" as const : "closed" as const;

// ------------------------------------------------------------------ pedido

export const executeCreateSplitReimbursement = async (
  actor: WorkspaceActor,
  payload: CreateSplitReimbursementPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: CREATE_SPLIT_REIMBURSEMENT_OPERATION,
      eventOperation: "split.reimbursement_requested",
      roles: SPLIT_ACTOR_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    const access = await loadGroupAccess(transaction, actor, payload.groupId);
    const {group} = access;
    assertGroupActive(group);
    if (group.businessMode !== "reimbursement") {
      throw new ApplicationError("domain_precondition_failed",
        REIMBURSEMENT_SPLIT_GROUP_MESSAGE);
    }
    if (
      !isWorkspaceAdmin(start.role) &&
      payload.requesterParticipantId !== access.actorParticipantId
    ) {
      throw new ApplicationError("permission_denied",
        REIMBURSEMENT_SELF_ONLY_MESSAGE);
    }
    assertNotFuture(payload.expenseDate, options);
    if (group.counters.openReimbursementCount >=
      SPLIT_LIMITS.openBillsPerGroup) {
      throw new ApplicationError("domain_precondition_failed",
        REIMBURSEMENT_LIMIT_MESSAGE);
    }
    const participants = await readGroupParticipants(transaction,
      actor.workspaceId, group.id, [payload.requesterParticipantId]);
    const requester = participants.get(payload.requesterParticipantId) as
      AuthoritativeSplitParticipant;
    if (requester.status !== "active" || requester.role === "viewer") {
      throw new ApplicationError("domain_precondition_failed",
        REIMBURSEMENT_REQUESTER_NOT_ELIGIBLE_MESSAGE);
    }
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_FINANCIAL_RATE_LIMIT);

    const reimbursementId = splitReimbursementIdFor(actor.workspaceId,
      start.intentId);
    transaction.create(
      splitReimbursementsRef(actor.workspaceId).doc(reimbursementId), {
        id: reimbursementId,
        schemaVersion: SPLIT_SCHEMA_VERSION,
        workspaceId: actor.workspaceId,
        groupId: group.id,
        requesterParticipantId: requester.id,
        requesterUserId: requester.userId,
        description: payload.description,
        category: payload.category,
        amountCents: payload.amountCents,
        currency: MONEY_CURRENCY,
        expenseDate: payload.expenseDate,
        status: "requested",
        createdBy: actor.uid,
        approvedBy: null,
        approvedAt: null,
        rejectedBy: null,
        rejectedAt: null,
        rejectionReason: null,
        cancelledBy: null,
        cancelledAt: null,
        paidBy: null,
        paidAt: null,
        cashAccountId: null,
        cashTransactionId: null,
        accountMovementId: null,
        paymentDate: null,
        paymentSequence: 0,
        lastReversalTransactionId: null,
        intentId: start.intentId,
        requestHash: start.reservation.requestHash,
        revision: 1,
        updatedBy: actor.uid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    const book = new AggregateBook();
    book.addReimbursement({requesterParticipantId: requester.id,
      amountCents: payload.amountCents, state: "open"}, 1);
    writeGroup(transaction, access.groupRef, group, book.group, actor.uid);
    writeParticipantBalances(transaction,
      (id) => splitParticipantsRef(actor.workspaceId).doc(id),
      participants, book, actor.uid);
    appendSplitEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "split.reimbursement_requested",
      targetKey: start.intentId,
      groupId: group.id,
      participantId: requester.id,
      reimbursementId,
      actorId: actor.uid,
      actorRole: start.role,
      intentId: start.intentId,
      requestHash: start.reservation.requestHash,
      requestId,
      correlationId: correlationOf(payload),
      amountCents: payload.amountCents,
      before: null,
      after: reimbursementSnapshot({status: "requested",
        amountCents: payload.amountCents, paymentSequence: 0}),
    });
    return finishSplitMutation(transaction, actor, {
      start,
      operation: CREATE_SPLIT_REIMBURSEMENT_OPERATION,
      requestId,
      ids: splitIds({groupId: group.id, participantId: requester.id,
        reimbursementId}),
      rateLimit,
      options,
    });
  });

// -------------------------------------------------- carregamento comum

interface LoadedReimbursement {
  start: SplitMutationStart;
  access: GroupAccess;
  ref: admin.firestore.DocumentReference;
  reimbursement: AuthoritativeSplitReimbursement;
  participants: Map<string, AuthoritativeSplitParticipant>;
}

const loadReimbursement = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  payload: ReimbursementActionPayload,
  operation: string,
  eventOperation: SplitEventOperation,
): Promise<{replay: SplitMutationResult} | {loaded: LoadedReimbursement}> => {
  const start = await beginSplitMutation(transaction, actor, {
    operation,
    eventOperation,
    roles: SPLIT_ACTOR_ROLES,
    payload,
  });
  if ("replay" in start) return {replay: start.replay};
  const ref = splitReimbursementsRef(actor.workspaceId)
    .doc(payload.reimbursementId);
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", REIMBURSEMENT_NOT_FOUND_MESSAGE);
  }
  const reimbursement = readAuthoritativeReimbursement(snapshot.id,
    snapshot.data(), actor.workspaceId);
  if (!reimbursement) {
    throw new ApplicationError("domain_precondition_failed",
      REIMBURSEMENT_INCONSISTENT_MESSAGE);
  }
  const access = await loadGroupAccess(transaction, actor,
    reimbursement.groupId);
  assertGroupActive(access.group);
  if (access.group.businessMode !== "reimbursement") {
    throw new ApplicationError("domain_precondition_failed",
      REIMBURSEMENT_INCONSISTENT_MESSAGE);
  }
  const participants = await readGroupParticipants(transaction,
    actor.workspaceId, reimbursement.groupId,
    [reimbursement.requesterParticipantId]);
  return {loaded: {start, access, ref, reimbursement, participants}};
};

const assertAdmin = (loaded: LoadedReimbursement): void => {
  if (!isWorkspaceAdmin(loaded.start.role)) {
    throw new ApplicationError("permission_denied",
      REIMBURSEMENT_ADMIN_ONLY_MESSAGE);
  }
};

/**
 * Escritas comuns de uma transição: reembolso, agregados pela diferença,
 * evento e recibo.
 */
const applyTransition = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  loaded: LoadedReimbursement,
  next: {status: SplitReimbursementStatus; paymentSequence: number;
    fields: Record<string, unknown>},
  input: {
    operation: string;
    eventOperation: SplitEventOperation;
    requestId: string;
    payload: ReimbursementActionPayload;
    rateLimit: {commit(): void};
    options: SplitOperationOptions;
  },
): SplitMutationResult => {
  const {reimbursement, access} = loaded;
  transaction.update(loaded.ref, {
    status: next.status,
    paymentSequence: next.paymentSequence,
    ...next.fields,
    revision: reimbursement.revision + 1,
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const before = reimbursementState(reimbursement.status);
  const after = reimbursementState(next.status);
  if (before !== after) {
    const book = new AggregateBook();
    const base = {requesterParticipantId: reimbursement.requesterParticipantId,
      amountCents: reimbursement.amountCents};
    book.addReimbursement({...base, state: before}, -1);
    book.addReimbursement({...base, state: after}, 1);
    writeGroup(transaction, access.groupRef, access.group, book.group,
      actor.uid);
    writeParticipantBalances(transaction,
      (id) => splitParticipantsRef(actor.workspaceId).doc(id),
      loaded.participants, book, actor.uid);
  }
  appendSplitEvent(transaction, {
    workspaceId: actor.workspaceId,
    operation: input.eventOperation,
    targetKey: loaded.start.intentId,
    groupId: reimbursement.groupId,
    participantId: reimbursement.requesterParticipantId,
    reimbursementId: reimbursement.id,
    actorId: actor.uid,
    actorRole: loaded.start.role,
    intentId: loaded.start.intentId,
    requestHash: loaded.start.reservation.requestHash,
    requestId: input.requestId,
    correlationId: correlationOf(input.payload),
    amountCents: reimbursement.amountCents,
    before: reimbursementSnapshot(reimbursement),
    after: reimbursementSnapshot({status: next.status,
      amountCents: reimbursement.amountCents,
      paymentSequence: next.paymentSequence}),
  });
  return finishSplitMutation(transaction, actor, {
    start: loaded.start,
    operation: input.operation,
    requestId: input.requestId,
    ids: splitIds({groupId: reimbursement.groupId,
      participantId: reimbursement.requesterParticipantId,
      reimbursementId: reimbursement.id}),
    rateLimit: input.rateLimit,
    options: input.options,
  });
};

// ------------------------------------ aprovação, rejeição e cancelamento

export const executeApproveSplitReimbursement = async (
  actor: WorkspaceActor,
  payload: ReimbursementActionPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadReimbursement(transaction, actor, payload,
      APPROVE_SPLIT_REIMBURSEMENT_OPERATION, "split.reimbursement_approved");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    assertAdmin(loaded);
    if (loaded.reimbursement.status !== "requested") {
      throw new ApplicationError("domain_precondition_failed",
        REIMBURSEMENT_NOT_REQUESTED_MESSAGE);
    }
    assertVersion(loaded.reimbursement.updatedAt, payload.expectedUpdatedAt,
      REIMBURSEMENT_CONFLICT_MESSAGE);
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_FINANCIAL_RATE_LIMIT);
    return applyTransition(transaction, actor, loaded, {
      status: "approved",
      paymentSequence: loaded.reimbursement.paymentSequence,
      fields: {approvedBy: actor.uid,
        approvedAt: FieldValue.serverTimestamp()},
    }, {
      operation: APPROVE_SPLIT_REIMBURSEMENT_OPERATION,
      eventOperation: "split.reimbursement_approved",
      requestId, payload, rateLimit, options,
    });
  });

export const executeRejectSplitReimbursement = async (
  actor: WorkspaceActor,
  payload: RejectSplitReimbursementPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadReimbursement(transaction, actor, payload,
      REJECT_SPLIT_REIMBURSEMENT_OPERATION, "split.reimbursement_rejected");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    assertAdmin(loaded);
    if (!isOpenReimbursement(loaded.reimbursement.status)) {
      throw new ApplicationError("domain_precondition_failed",
        REIMBURSEMENT_NOT_REJECTABLE_MESSAGE);
    }
    assertVersion(loaded.reimbursement.updatedAt, payload.expectedUpdatedAt,
      REIMBURSEMENT_CONFLICT_MESSAGE);
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_FINANCIAL_RATE_LIMIT);
    // O motivo fica só no reembolso: a trilha não guarda texto livre (§29).
    return applyTransition(transaction, actor, loaded, {
      status: "rejected",
      paymentSequence: loaded.reimbursement.paymentSequence,
      fields: {rejectedBy: actor.uid,
        rejectedAt: FieldValue.serverTimestamp(),
        rejectionReason: payload.reason ?? null},
    }, {
      operation: REJECT_SPLIT_REIMBURSEMENT_OPERATION,
      eventOperation: "split.reimbursement_rejected",
      requestId, payload, rateLimit, options,
    });
  });

export const executeCancelSplitReimbursement = async (
  actor: WorkspaceActor,
  payload: ReimbursementActionPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadReimbursement(transaction, actor, payload,
      CANCEL_SPLIT_REIMBURSEMENT_OPERATION, "split.reimbursement_cancelled");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {reimbursement} = loaded;
    if (!isOpenReimbursement(reimbursement.status)) {
      throw new ApplicationError("domain_precondition_failed",
        REIMBURSEMENT_NOT_CANCELLABLE_MESSAGE);
    }
    const ownRequest = reimbursement.requesterUserId !== null &&
      reimbursement.requesterUserId === actor.uid &&
      reimbursement.requesterParticipantId ===
        loaded.access.actorParticipantId;
    if (
      !isWorkspaceAdmin(loaded.start.role) &&
      !(ownRequest && reimbursement.status === "requested")
    ) {
      throw new ApplicationError("permission_denied",
        REIMBURSEMENT_CANCEL_DENIED_MESSAGE);
    }
    assertVersion(reimbursement.updatedAt, payload.expectedUpdatedAt,
      REIMBURSEMENT_CONFLICT_MESSAGE);
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_FINANCIAL_RATE_LIMIT);
    return applyTransition(transaction, actor, loaded, {
      status: "cancelled",
      paymentSequence: reimbursement.paymentSequence,
      fields: {cancelledBy: actor.uid,
        cancelledAt: FieldValue.serverTimestamp()},
    }, {
      operation: CANCEL_SPLIT_REIMBURSEMENT_OPERATION,
      eventOperation: "split.reimbursement_cancelled",
      requestId, payload, rateLimit, options,
    });
  });

// ---------------------------------------------------------------- pagamento

export const executePaySplitReimbursement = async (
  actor: WorkspaceActor,
  payload: PaySplitReimbursementPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadReimbursement(transaction, actor, payload,
      PAY_SPLIT_REIMBURSEMENT_OPERATION, "split.reimbursement_paid");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {reimbursement} = loaded;
    assertAdmin(loaded);
    if (reimbursement.status !== "approved") {
      throw new ApplicationError("domain_precondition_failed",
        REIMBURSEMENT_NOT_APPROVED_MESSAGE);
    }
    assertVersion(reimbursement.updatedAt, payload.expectedUpdatedAt,
      REIMBURSEMENT_CONFLICT_MESSAGE);
    assertNotFuture(payload.paymentDate, options);
    const accounts = await prepareSplitCashFact(transaction, actor.workspaceId,
      payload.cashAccountId);
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_FINANCIAL_RATE_LIMIT);
    const paymentSequence = reimbursement.paymentSequence + 1;
    const cashTransactionId = splitReimbursementCashTransactionIdFor(
      actor.workspaceId, reimbursement.id, "payment", paymentSequence);
    const {accountMovementId} = commitSplitCashFact(transaction, accounts, {
      transactionId: cashTransactionId,
      workspaceId: actor.workspaceId,
      actorUid: actor.uid,
      ownerUid: actor.uid,
      profileType: loaded.start.workspace.type === "PJ" ? "PJ" : "PF",
      cashAccountId: payload.cashAccountId,
      date: payload.paymentDate,
      description: REIMBURSEMENT_PAYMENT_DESCRIPTION,
      category: reimbursement.category,
      kind: "reimbursement_payment",
      groupId: reimbursement.groupId,
      billId: null,
      reimbursementId: reimbursement.id,
      amountCents: reimbursement.amountCents,
      operation: PAY_SPLIT_REIMBURSEMENT_OPERATION,
      requestId,
    });
    return applyTransition(transaction, actor, loaded, {
      status: "paid",
      paymentSequence,
      fields: {
        paidBy: actor.uid,
        paidAt: FieldValue.serverTimestamp(),
        cashAccountId: payload.cashAccountId,
        cashTransactionId,
        accountMovementId,
        paymentDate: payload.paymentDate,
      },
    }, {
      operation: PAY_SPLIT_REIMBURSEMENT_OPERATION,
      eventOperation: "split.reimbursement_paid",
      requestId, payload, rateLimit, options,
    });
  });

export const executeReverseReimbursementPayment = async (
  actor: WorkspaceActor,
  payload: ReimbursementActionPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadReimbursement(transaction, actor, payload,
      REVERSE_REIMBURSEMENT_PAYMENT_OPERATION,
      "split.reimbursement_payment_reversed");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    const {reimbursement} = loaded;
    assertAdmin(loaded);
    if (reimbursement.status !== "paid") {
      throw new ApplicationError("domain_precondition_failed",
        REIMBURSEMENT_NOT_PAID_MESSAGE);
    }
    assertVersion(reimbursement.updatedAt, payload.expectedUpdatedAt,
      REIMBURSEMENT_CONFLICT_MESSAGE);
    const prepared = await prepareSplitCashReversal(transaction, {
      workspaceId: actor.workspaceId,
      originalTransactionId: reimbursement.cashTransactionId as string,
      expected: {kind: "reimbursement_payment",
        groupId: reimbursement.groupId, billId: null,
        reimbursementId: reimbursement.id},
    });
    if (prepared.entry.amountCents !== reimbursement.amountCents) {
      throw new ApplicationError("domain_precondition_failed",
        REIMBURSEMENT_INCONSISTENT_MESSAGE);
    }
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_FINANCIAL_RATE_LIMIT);
    const reversalTransactionId = splitReimbursementCashTransactionIdFor(
      actor.workspaceId, reimbursement.id, "reversal",
      reimbursement.paymentSequence);
    commitSplitCashReversal(transaction, prepared, {
      reversalTransactionId,
      workspaceId: actor.workspaceId,
      actorUid: actor.uid,
      ownerUid: actor.uid,
      profileType: loaded.start.workspace.type === "PJ" ? "PJ" : "PF",
      description: REIMBURSEMENT_REVERSAL_DESCRIPTION,
      operation: REVERSE_REIMBURSEMENT_PAYMENT_OPERATION,
      requestId,
    });
    return applyTransition(transaction, actor, loaded, {
      status: "approved",
      paymentSequence: reimbursement.paymentSequence,
      fields: {
        paidBy: null,
        paidAt: null,
        cashAccountId: null,
        cashTransactionId: null,
        accountMovementId: null,
        paymentDate: null,
        lastReversalTransactionId: reversalTransactionId,
        lastReversedBy: actor.uid,
        lastReversedAt: FieldValue.serverTimestamp(),
      },
    }, {
      operation: REVERSE_REIMBURSEMENT_PAYMENT_OPERATION,
      eventOperation: "split.reimbursement_payment_reversed",
      requestId, payload, rateLimit, options,
    });
  });
