import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import type {WorkspaceActor, WorkspaceRole} from "../shared/workspaceAuth";
import {
  AggregateBook,
  writeGroup,
  writeParticipantBalances,
  type BillState,
} from "./aggregates";
import {readGroupParticipants} from "./billOperations";
import {
  BILL_INCONSISTENT_MESSAGE,
  BILL_NOT_FOUND_MESSAGE,
  SHARE_CONFLICT_MESSAGE,
  SHARE_INCONSISTENT_MESSAGE,
  SHARE_NOT_FOUND_MESSAGE,
  SPLIT_ACTOR_ROLES,
  SPLIT_FINANCIAL_RATE_LIMIT,
  assertGroupActive,
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
  ForgiveSplitSharePayload,
  ShareActionPayload,
} from "./contracts";
import {
  appendSplitEvent,
  readAuthoritativeBill,
  readAuthoritativeShare,
  remainingOf,
  splitBillsRef,
  splitParticipantsRef,
  splitSharesRef,
  type AuthoritativeSplitBill,
  type AuthoritativeSplitParticipant,
  type AuthoritativeSplitShare,
  type SplitEventOperation,
  type SplitShareSettledVia,
  type SplitShareStatus,
} from "./model";

/**
 * Quitação, estorno e perdão de rateios (P4-C, §12–§15).
 *
 * São fatos do domínio Split: registrar o recebimento não movimenta o Caixa
 * (o dinheiro pode ter sido acertado por fora); o fato financeiro do título
 * é o pagamento original. A quitação é integral (o rateio em aberto vai a
 * `settled` pelo devido inteiro); o estorno a reabre; o perdão é terminal.
 *
 * Quem pode: registrar e estornar recebimento — o usuário pagador (no
 * grupo), o dono do grupo ou owner/admin do workspace; perdoar — o dono do
 * grupo ou owner/admin. Nunca quem deve (o devedor não declara a própria
 * dívida paga) e nunca um visualizador. Com pagador externo, só o dono do
 * grupo ou owner/admin.
 */
export const SETTLE_SPLIT_SHARE_OPERATION = "settleSplitShare";
export const REVERSE_SPLIT_SHARE_SETTLEMENT_OPERATION =
  "reverseSplitShareSettlement";
export const FORGIVE_SPLIT_SHARE_OPERATION = "forgiveSplitShare";

export const SHARE_NOT_OPEN_MESSAGE = "Este rateio não está em aberto.";
export const SHARE_NOT_SETTLED_MESSAGE =
  "Só um recebimento registrado pode ser estornado.";
export const SHARE_DEBTOR_DENIED_MESSAGE =
  "Quem deve não pode registrar, estornar nem perdoar o próprio rateio.";
export const SHARE_SETTLE_DENIED_MESSAGE =
  "Só quem pagou o título, o dono do grupo ou um administrador do espaço " +
  "pode registrar ou estornar o recebimento.";
export const SHARE_FORGIVE_DENIED_MESSAGE =
  "Só o dono do grupo ou um administrador do espaço pode perdoar um rateio.";
export const SHARE_BILL_VOIDED_MESSAGE = "Este título foi anulado.";

const db = () => admin.firestore();

interface LoadedShare {
  start: SplitMutationStart;
  access: GroupAccess;
  shareRef: admin.firestore.DocumentReference;
  share: AuthoritativeSplitShare;
  billRef: admin.firestore.DocumentReference;
  bill: AuthoritativeSplitBill;
  participants: Map<string, AuthoritativeSplitParticipant>;
  debtor: AuthoritativeSplitParticipant;
}

/**
 * Fase de leitura comum: rateio, título, grupo (ativo), devedor e pagador,
 * papel do ator relido, recusa ao devedor e versão do rateio.
 */
const loadShare = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  payload: ShareActionPayload,
  operation: string,
  eventOperation: SplitEventOperation,
): Promise<{replay: SplitMutationResult} | {loaded: LoadedShare}> => {
  const start = await beginSplitMutation(transaction, actor, {
    operation,
    eventOperation,
    roles: SPLIT_ACTOR_ROLES,
    payload,
  });
  if ("replay" in start) return {replay: start.replay};
  const shareRef = splitSharesRef(actor.workspaceId).doc(payload.shareId);
  const shareSnapshot = await transaction.get(shareRef);
  if (!shareSnapshot.exists) {
    throw new ApplicationError("not_found", SHARE_NOT_FOUND_MESSAGE);
  }
  const share = readAuthoritativeShare(shareSnapshot.id, shareSnapshot.data(),
    actor.workspaceId);
  if (!share) {
    throw new ApplicationError("domain_precondition_failed",
      SHARE_INCONSISTENT_MESSAGE);
  }
  const billRef = splitBillsRef(actor.workspaceId).doc(share.billId);
  const billSnapshot = await transaction.get(billRef);
  if (!billSnapshot.exists) {
    throw new ApplicationError("not_found", BILL_NOT_FOUND_MESSAGE);
  }
  const bill = readAuthoritativeBill(billSnapshot.id, billSnapshot.data(),
    actor.workspaceId);
  if (!bill || bill.groupId !== share.groupId) {
    throw new ApplicationError("domain_precondition_failed",
      BILL_INCONSISTENT_MESSAGE);
  }
  const access = await loadGroupAccess(transaction, actor, bill.groupId);
  assertGroupActive(access.group);
  if (bill.status === "voided" || share.status === "voided") {
    throw new ApplicationError("domain_precondition_failed",
      SHARE_BILL_VOIDED_MESSAGE);
  }
  if (!bill.participantIds.includes(share.participantId)) {
    throw new ApplicationError("domain_precondition_failed",
      SHARE_INCONSISTENT_MESSAGE);
  }
  const participants = await readGroupParticipants(transaction,
    actor.workspaceId, bill.groupId,
    [share.participantId, bill.payerParticipantId]);
  const debtor = participants.get(share.participantId) as
    AuthoritativeSplitParticipant;
  if (debtor.userId !== null && debtor.userId === actor.uid) {
    throw new ApplicationError("permission_denied",
      SHARE_DEBTOR_DENIED_MESSAGE);
  }
  assertVersion(share.updatedAt, payload.expectedUpdatedAt,
    SHARE_CONFLICT_MESSAGE);
  return {loaded: {start, access, shareRef, share, billRef, bill,
    participants, debtor}};
};

const activeGroupRole = (access: GroupAccess) =>
  access.actorParticipant?.status === "active" ?
    access.actorParticipant.role : null;

/** Registrar/estornar recebimento: pagador (no grupo), dono ou admin. */
const canSettle = (
  actor: WorkspaceActor,
  role: WorkspaceRole,
  access: GroupAccess,
  bill: AuthoritativeSplitBill,
): boolean => {
  if (isWorkspaceAdmin(role)) return true;
  const groupRole = activeGroupRole(access);
  if (groupRole === "owner") return true;
  return groupRole === "participant" && bill.payerUserId !== null &&
    bill.payerUserId === actor.uid;
};

const canForgive = (role: WorkspaceRole, access: GroupAccess): boolean =>
  isWorkspaceAdmin(role) || activeGroupRole(access) === "owner";

interface ShareTransition {
  status: SplitShareStatus;
  amountSettledCents: number;
  settledVia: SplitShareSettledVia | null;
  /** Variação de rateios resolvidos por terceiro (quitação ou perdão). */
  resolvedDelta: 1 | -1;
  fields: Record<string, unknown>;
}

/**
 * Aplica a transição do rateio: grava rateio e título, refaz os agregados
 * pela diferença e anexa o evento.
 */
const applyTransition = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  loaded: LoadedShare,
  transition: ShareTransition,
  input: {
    operation: string;
    eventOperation: SplitEventOperation;
    requestId: string;
    payload: ShareActionPayload;
    rateLimit: {commit(): void};
    options: SplitOperationOptions;
  },
): SplitMutationResult => {
  const {share, bill, access} = loaded;
  const afterShare = {
    ...share,
    status: transition.status,
    amountSettledCents: transition.amountSettledCents,
    settledVia: transition.settledVia,
  };
  const remainingBefore = remainingOf(share);
  const remainingAfter = remainingOf(afterShare);
  const openShareCount = bill.openShareCount +
    (afterShare.status === "open" ? 1 : 0) - (share.status === "open" ? 1 : 0);
  const outstandingCents = bill.outstandingCents - remainingBefore +
    remainingAfter;
  const status = openShareCount > 0 ? "open" as const : "settled" as const;
  const resolvedShareCount = bill.resolvedShareCount + transition.resolvedDelta;
  if (
    openShareCount < 0 || outstandingCents < 0 || resolvedShareCount < 0 ||
    (openShareCount === 0) !== (outstandingCents === 0)
  ) {
    throw new ApplicationError("domain_precondition_failed",
      BILL_INCONSISTENT_MESSAGE);
  }
  transaction.update(loaded.shareRef, {
    status: transition.status,
    amountSettledCents: transition.amountSettledCents,
    settledVia: transition.settledVia,
    ...transition.fields,
    revision: share.revision + 1,
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  transaction.update(loaded.billRef, {
    status,
    openShareCount,
    outstandingCents,
    resolvedShareCount,
    revision: bill.revision + 1,
    updatedBy: actor.uid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const book = new AggregateBook();
  book.addSharePart(bill.payerParticipantId, share, -1);
  book.addSharePart(bill.payerParticipantId, afterShare, 1);
  if (status !== bill.status) {
    const billState: BillState = {
      status: bill.status,
      amountCents: bill.amountCents,
      payerParticipantId: bill.payerParticipantId,
      categoryBucket: bill.categoryBucket,
    };
    book.addBillPart(billState, -1);
    book.addBillPart({...billState, status}, 1);
  }
  writeGroup(transaction, access.groupRef, access.group, book.group,
    actor.uid);
  writeParticipantBalances(transaction,
    (id) => splitParticipantsRef(actor.workspaceId).doc(id),
    loaded.participants, book, actor.uid);
  const snapshot = (value: typeof share) => ({
    status: value.status,
    amountDueCents: value.amountDueCents,
    amountSettledCents: value.amountSettledCents,
    settledVia: value.settledVia,
    billStatus: value === share ? bill.status : status,
    billOutstandingCents: value === share ? bill.outstandingCents :
      outstandingCents,
  });
  appendSplitEvent(transaction, {
    workspaceId: actor.workspaceId,
    operation: input.eventOperation,
    targetKey: loaded.start.intentId,
    groupId: bill.groupId,
    billId: bill.id,
    shareId: share.id,
    participantId: share.participantId,
    actorId: actor.uid,
    actorRole: loaded.start.role,
    intentId: loaded.start.intentId,
    requestHash: loaded.start.reservation.requestHash,
    requestId: input.requestId,
    correlationId: correlationOf(input.payload),
    amountCents: Math.max(remainingBefore, remainingAfter),
    before: snapshot(share),
    after: snapshot(afterShare),
  });
  return finishSplitMutation(transaction, actor, {
    start: loaded.start,
    operation: input.operation,
    requestId: input.requestId,
    ids: splitIds({groupId: bill.groupId, billId: bill.id,
      shareId: share.id, participantId: share.participantId}),
    rateLimit: input.rateLimit,
    options: input.options,
  });
};

// ---------------------------------------------------------------- quitação

export const executeSettleSplitShare = async (
  actor: WorkspaceActor,
  payload: ShareActionPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadShare(transaction, actor, payload,
      SETTLE_SPLIT_SHARE_OPERATION, "split.share_settled");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    if (!canSettle(actor, loaded.start.role, loaded.access, loaded.bill)) {
      throw new ApplicationError("permission_denied",
        SHARE_SETTLE_DENIED_MESSAGE);
    }
    if (loaded.share.status !== "open") {
      throw new ApplicationError("domain_precondition_failed",
        SHARE_NOT_OPEN_MESSAGE);
    }
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_FINANCIAL_RATE_LIMIT);
    return applyTransition(transaction, actor, loaded, {
      status: "settled",
      amountSettledCents: loaded.share.amountDueCents,
      settledVia: "settlement",
      resolvedDelta: 1,
      fields: {
        settledBy: actor.uid,
        settledAt: FieldValue.serverTimestamp(),
      },
    }, {
      operation: SETTLE_SPLIT_SHARE_OPERATION,
      eventOperation: "split.share_settled",
      requestId,
      payload,
      rateLimit,
      options,
    });
  });

export const executeReverseSplitShareSettlement = async (
  actor: WorkspaceActor,
  payload: ShareActionPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadShare(transaction, actor, payload,
      REVERSE_SPLIT_SHARE_SETTLEMENT_OPERATION,
      "split.share_settlement_reversed");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    if (!canSettle(actor, loaded.start.role, loaded.access, loaded.bill)) {
      throw new ApplicationError("permission_denied",
        SHARE_SETTLE_DENIED_MESSAGE);
    }
    if (
      loaded.share.status !== "settled" ||
      loaded.share.settledVia !== "settlement"
    ) {
      throw new ApplicationError("domain_precondition_failed",
        SHARE_NOT_SETTLED_MESSAGE);
    }
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_FINANCIAL_RATE_LIMIT);
    return applyTransition(transaction, actor, loaded, {
      status: "open",
      amountSettledCents: 0,
      settledVia: null,
      resolvedDelta: -1,
      fields: {settledBy: null, settledAt: null},
    }, {
      operation: REVERSE_SPLIT_SHARE_SETTLEMENT_OPERATION,
      eventOperation: "split.share_settlement_reversed",
      requestId,
      payload,
      rateLimit,
      options,
    });
  });

// ------------------------------------------------------------------- perdão

export const executeForgiveSplitShare = async (
  actor: WorkspaceActor,
  payload: ForgiveSplitSharePayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadShare(transaction, actor, payload,
      FORGIVE_SPLIT_SHARE_OPERATION, "split.share_forgiven");
    if ("replay" in outcome) return outcome.replay;
    const {loaded} = outcome;
    if (!canForgive(loaded.start.role, loaded.access)) {
      throw new ApplicationError("permission_denied",
        SHARE_FORGIVE_DENIED_MESSAGE);
    }
    if (loaded.share.status !== "open") {
      throw new ApplicationError("domain_precondition_failed",
        SHARE_NOT_OPEN_MESSAGE);
    }
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_FINANCIAL_RATE_LIMIT);
    // O motivo fica só no rateio: a trilha não guarda texto livre (§29).
    return applyTransition(transaction, actor, loaded, {
      status: "forgiven",
      amountSettledCents: 0,
      settledVia: null,
      resolvedDelta: 1,
      fields: {
        forgivenBy: actor.uid,
        forgivenAt: FieldValue.serverTimestamp(),
        forgivenReason: payload.reason,
      },
    }, {
      operation: FORGIVE_SPLIT_SHARE_OPERATION,
      eventOperation: "split.share_forgiven",
      requestId,
      payload,
      rateLimit,
      options,
    });
  });
