import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import type {PostingAccounts} from "../accounts/ledger";
import {cardsRef} from "../cards/model";
import {
  commitCardPurchase,
  commitCardPurchaseReversal,
  prepareCardPurchase,
  prepareCardPurchaseReversal,
  type PreparedCardPurchase,
  type PreparedCardPurchaseReversal,
} from "../cards/purchaseOperations";
import {ApplicationError} from "../shared/errors";
import {MONEY_CURRENCY} from "../shared/money";
import {
  workspaceMemberRef,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import {
  AggregateBook,
  categoryBucketFor,
  writeGroup,
  writeParticipantBalances,
  type BillState,
  type ShareState,
} from "./aggregates";
import {
  SplitAllocationError,
  allocateShares,
  type AllocatedShare,
} from "./allocation";
import {
  commitSplitCashFact,
  commitSplitCashReversal,
  prepareSplitCashFact,
  prepareSplitCashReversal,
  type PreparedSplitCashReversal,
} from "./cash";
import {
  BILL_CONFLICT_MESSAGE,
  BILL_INCONSISTENT_MESSAGE,
  BILL_NOT_FOUND_MESSAGE,
  PARTICIPANT_NOT_FOUND_MESSAGE,
  SHARE_INCONSISTENT_MESSAGE,
  SPLIT_ACTOR_ROLES,
  SPLIT_FINANCIAL_RATE_LIMIT,
  assertCanWriteInGroup,
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
  todayOf,
  type GroupAccess,
  type SplitMutationResult,
  type SplitMutationStart,
  type SplitOperationOptions,
} from "./common";
import type {
  CreateSplitBillPayload,
  SplitBillTerms,
  UpdateSplitBillPayload,
  VoidSplitBillPayload,
} from "./contracts";
import {
  SPLIT_LIMITS,
  SPLIT_SCHEMA_VERSION,
  appendSplitEvent,
  areTermsLocked,
  billSnapshot,
  hasFinancialFact,
  readAuthoritativeBill,
  readAuthoritativeParticipant,
  readAuthoritativeShare,
  splitBillCardPurchaseIdFor,
  splitBillCashTransactionIdFor,
  splitBillIdFor,
  splitBillsRef,
  splitParticipantsRef,
  splitShareIdFor,
  splitSharesRef,
  type AuthoritativeSplitBill,
  type AuthoritativeSplitParticipant,
  type AuthoritativeSplitShare,
  type SplitShareSettledVia,
  type SplitShareStatus,
} from "./model";

/**
 * Títulos de rateio (P4-C, §10–§12, §16–§20).
 *
 * Criação atômica (§18): título, rateios, agregados do grupo e dos
 * participantes, fato financeiro (Caixa P3-J ou Cartão P4-A), evento e
 * recibo da chave no mesmo commit. O rateio vem de `allocateShares` (Σ
 * rateios = valor do título por construção); a parte do próprio pagador
 * nasce quitada (`payer_self`) e a parte zero nasce resolvida (`zero`).
 *
 * Edição (§19, PR-SPLIT-06): descrição e categoria sempre (título não
 * anulado); os termos financeiros só enquanto nenhum rateio foi quitado por
 * terceiro ou perdoado e não há fato financeiro — os rateios são
 * atualizados no lugar (um por participante), os de quem saiu viram
 * `voided`. Depois disso, mudar valores é anular e lançar de novo.
 *
 * Anulação (§20): nada é apagado. Recusada com quitação registrada (estorne
 * antes) ou com perdão (terminal). Caixa: lançamento compensatório na mesma
 * conta e com a data do fato. Cartão: cancelamento se todas as parcelas
 * estão em faturas abertas; estorno com crédito na fatura aberta se alguma
 * já foi faturada.
 */
export const CREATE_SPLIT_BILL_OPERATION = "createSplitBill";
export const UPDATE_SPLIT_BILL_OPERATION = "updateSplitBill";
export const VOID_SPLIT_BILL_OPERATION = "voidSplitBill";

export const BILL_REIMBURSEMENT_GROUP_MESSAGE =
  "Este grupo é de reembolso: registre um pedido de reembolso em vez de um " +
  "título.";
export const BILL_LIMIT_MESSAGE =
  `Este grupo atingiu o limite de ${SPLIT_LIMITS.openBillsPerGroup} ` +
  "títulos em aberto.";
export const BILL_PARTICIPANT_NOT_ELIGIBLE_MESSAGE =
  "O pagador e os participantes precisam estar ativos no grupo, como dono " +
  "ou participante.";
export const EXTERNAL_PAYER_INTEGRATION_MESSAGE =
  "Quando quem pagou é um participante externo, o título não é lançado no " +
  "Caixa nem no Cartão.";
export const INTEGRATION_ACTOR_MESSAGE =
  "Só o próprio pagador ou um administrador do espaço pode lançar o " +
  "pagamento no Caixa ou no Cartão.";
export const PAYER_NOT_MEMBER_MESSAGE =
  "O pagador precisa ser membro ativo deste espaço para o lançamento no " +
  "Caixa ou no Cartão.";
export const BILL_VOIDED_MESSAGE =
  "Este título foi anulado e não pode ser alterado.";
export const BILL_TERMS_LOCKED_MESSAGE =
  "Este título já tem quitação, perdão ou lançamento no Caixa ou no " +
  "Cartão: só a descrição e a categoria podem mudar. Para mudar valores, " +
  "anule o título e lance de novo.";
export const BILL_UNCHANGED_MESSAGE = "Nenhuma alteração para salvar.";
export const BILL_EDIT_DENIED_MESSAGE =
  "Só quem lançou o título, o pagador, o dono do grupo ou um administrador " +
  "do espaço pode fazer isso.";
export const BILL_VOID_FACT_DENIED_MESSAGE =
  "Este título tem lançamento no Caixa ou no Cartão: só o pagador ou um " +
  "administrador do espaço pode anulá-lo.";
export const BILL_ALREADY_VOIDED_MESSAGE = "Este título já foi anulado.";
export const BILL_HAS_SETTLEMENTS_MESSAGE =
  "Este título tem recebimentos registrados. Estorne-os antes de anular.";
export const BILL_HAS_FORGIVEN_MESSAGE =
  "Este título tem rateio perdoado e não pode mais ser anulado.";

const db = () => admin.firestore();

// ------------------------------------------------------------ leituras

const readBill = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  billId: string,
): Promise<{billRef: admin.firestore.DocumentReference;
  bill: AuthoritativeSplitBill}> => {
  const billRef = splitBillsRef(workspaceId).doc(billId);
  const snapshot = await transaction.get(billRef);
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", BILL_NOT_FOUND_MESSAGE);
  }
  const bill = readAuthoritativeBill(snapshot.id, snapshot.data(),
    workspaceId);
  if (!bill) {
    throw new ApplicationError("domain_precondition_failed",
      BILL_INCONSISTENT_MESSAGE, {ineligible: "inconsistent_bill"});
  }
  return {billRef, bill};
};

/** Participantes do grupo, relidos de uma vez (ausente ou de outro: 404). */
export const readGroupParticipants = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  groupId: string,
  ids: Iterable<string>,
): Promise<Map<string, AuthoritativeSplitParticipant>> => {
  const unique = [...new Set(ids)];
  const map = new Map<string, AuthoritativeSplitParticipant>();
  if (unique.length === 0) return map;
  const snapshots = await transaction.getAll(
    ...unique.map((id) => splitParticipantsRef(workspaceId).doc(id)));
  snapshots.forEach((snapshot) => {
    const participant = snapshot.exists ?
      readAuthoritativeParticipant(snapshot.id, snapshot.data(),
        workspaceId) :
      null;
    if (!participant || participant.groupId !== groupId) {
      throw new ApplicationError("not_found", PARTICIPANT_NOT_FOUND_MESSAGE);
    }
    map.set(participant.id, participant);
  });
  return map;
};

/** Rateios do título por participante (`null`: ainda não existe). */
export const readBillShares = async (
  transaction: admin.firestore.Transaction,
  bill: Pick<AuthoritativeSplitBill, "id" | "workspaceId" | "groupId">,
  participantIds: Iterable<string>,
): Promise<Map<string, AuthoritativeSplitShare | null>> => {
  const unique = [...new Set(participantIds)];
  const map = new Map<string, AuthoritativeSplitShare | null>();
  if (unique.length === 0) return map;
  const snapshots = await transaction.getAll(...unique.map((participantId) =>
    splitSharesRef(bill.workspaceId).doc(
      splitShareIdFor(bill.workspaceId, bill.id, participantId))));
  snapshots.forEach((snapshot, index) => {
    const participantId = unique[index];
    if (!snapshot.exists) {
      map.set(participantId, null);
      return;
    }
    const share = readAuthoritativeShare(snapshot.id, snapshot.data(),
      bill.workspaceId);
    if (
      !share || share.billId !== bill.id || share.groupId !== bill.groupId ||
      share.participantId !== participantId
    ) {
      throw new ApplicationError("domain_precondition_failed",
        SHARE_INCONSISTENT_MESSAGE);
    }
    map.set(participantId, share);
  });
  return map;
};

/** Rateios vigentes (dos participantes atuais): todos precisam existir. */
const currentShares = (
  bill: AuthoritativeSplitBill,
  shares: Map<string, AuthoritativeSplitShare | null>,
): AuthoritativeSplitShare[] => bill.participantIds.map((participantId) => {
  const share = shares.get(participantId);
  if (!share || share.status === "voided") {
    throw new ApplicationError("domain_precondition_failed",
      SHARE_INCONSISTENT_MESSAGE);
  }
  return share;
});

// -------------------------------------------------------- termos e rateio

const allocate = (terms: SplitBillTerms): AllocatedShare[] => {
  try {
    return allocateShares({
      amountCents: terms.amountCents,
      method: terms.allocationMethod,
      participants: terms.participants,
    });
  } catch (error) {
    if (error instanceof SplitAllocationError) {
      throw new ApplicationError("invalid_payload", error.message);
    }
    throw error;
  }
};

/** Pagador e devedores: ativos no grupo, com papel `owner`/`participant`. */
const assertEligibleParties = (
  participants: Map<string, AuthoritativeSplitParticipant>,
  ids: Iterable<string>,
): void => {
  for (const id of ids) {
    const participant = participants.get(id);
    if (
      !participant || participant.status !== "active" ||
      participant.role === "viewer"
    ) {
      throw new ApplicationError("domain_precondition_failed",
        BILL_PARTICIPANT_NOT_ELIGIBLE_MESSAGE, {participantId: id});
    }
  }
};

interface PlannedShare {
  participantId: string;
  isPayerShare: boolean;
  weightBps: number | null;
  amountDueCents: number;
  status: SplitShareStatus;
  amountSettledCents: number;
  settledVia: SplitShareSettledVia | null;
}

/**
 * Estado inicial de cada rateio: o do pagador quitado, o de valor zero
 * resolvido, os demais em aberto.
 */
const planShares = (
  allocation: readonly AllocatedShare[],
  payerParticipantId: string,
): PlannedShare[] => allocation.map((share) => {
  const isPayerShare = share.participantId === payerParticipantId;
  if (isPayerShare || share.amountDueCents === 0) {
    return {
      ...share,
      isPayerShare,
      status: "settled",
      amountSettledCents: share.amountDueCents,
      settledVia: isPayerShare ? "payer_self" : "zero",
    };
  }
  return {...share, isPayerShare, status: "open", amountSettledCents: 0,
    settledVia: null};
});

const shareStateOf = (share: Pick<AuthoritativeSplitShare, "participantId" |
  "status" | "amountDueCents" | "amountSettledCents">): ShareState => ({
  participantId: share.participantId,
  status: share.status,
  amountDueCents: share.amountDueCents,
  amountSettledCents: share.amountSettledCents,
});

const billStateOf = (bill: Pick<AuthoritativeSplitBill, "status" |
  "amountCents" | "payerParticipantId" | "categoryBucket">): BillState => ({
  status: bill.status,
  amountCents: bill.amountCents,
  payerParticipantId: bill.payerParticipantId,
  categoryBucket: bill.categoryBucket,
});

/** Contadores e estado do título derivados dos rateios vigentes. */
const deriveBillStatus = (shares: readonly PlannedShare[]) => {
  const open = shares.filter((share) => share.status === "open");
  const outstandingCents = open.reduce((sum, share) =>
    sum + share.amountDueCents - share.amountSettledCents, 0);
  return {
    status: open.length > 0 ? "open" as const : "settled" as const,
    shareCount: shares.length,
    openShareCount: open.length,
    outstandingCents,
  };
};

const shareTermsFields = (
  share: PlannedShare,
  termsRevision: number,
  actorUid: string,
) => ({
  isPayerShare: share.isPayerShare,
  weightBps: share.weightBps,
  amountDueCents: share.amountDueCents,
  amountSettledCents: share.amountSettledCents,
  currency: MONEY_CURRENCY,
  status: share.status,
  settledVia: share.settledVia,
  settledBy: null,
  settledAt: null,
  forgivenBy: null,
  forgivenAt: null,
  forgivenReason: null,
  termsRevision,
  updatedBy: actorUid,
  updatedAt: FieldValue.serverTimestamp(),
});

/** Grava os rateios planejados (cria ou atualiza no lugar). */
const writePlannedShares = (
  transaction: admin.firestore.Transaction,
  input: {
    workspaceId: string;
    groupId: string;
    billId: string;
    planned: readonly PlannedShare[];
    existing: Map<string, AuthoritativeSplitShare | null>;
    termsRevision: number;
    actorUid: string;
  },
): void => {
  for (const share of input.planned) {
    const id = splitShareIdFor(input.workspaceId, input.billId,
      share.participantId);
    const ref = splitSharesRef(input.workspaceId).doc(id);
    const fields = shareTermsFields(share, input.termsRevision,
      input.actorUid);
    const current = input.existing.get(share.participantId) ?? null;
    if (current) {
      transaction.update(ref, {...fields, revision: current.revision + 1});
    } else {
      transaction.create(ref, {
        id,
        schemaVersion: SPLIT_SCHEMA_VERSION,
        workspaceId: input.workspaceId,
        groupId: input.groupId,
        billId: input.billId,
        participantId: share.participantId,
        ...fields,
        revision: 1,
        createdBy: input.actorUid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  }
};

// --------------------------------------------------------- fato financeiro

type PreparedFact =
  | {kind: "none"}
  | {kind: "cash"; accounts: PostingAccounts; cashAccountId: string;
      transactionId: string}
  | {kind: "card"; prepared: PreparedCardPurchase; purchaseId: string};

/**
 * Fase de leitura do fato (§16, §17): pagador externo não integra; a
 * integração é lançada pelo próprio pagador (membro) ou por owner/admin do
 * workspace, e o pagador precisa seguir membro ativo.
 */
const prepareBillFact = async (
  transaction: admin.firestore.Transaction,
  input: {
    actor: WorkspaceActor;
    role: WorkspaceRole;
    billId: string;
    terms: SplitBillTerms;
    payer: AuthoritativeSplitParticipant;
    options: SplitOperationOptions;
  },
): Promise<PreparedFact> => {
  const {actor, terms, payer} = input;
  if (terms.financialIntegration === "none") return {kind: "none"};
  if (payer.kind === "external" || payer.userId === null) {
    throw new ApplicationError("domain_precondition_failed",
      EXTERNAL_PAYER_INTEGRATION_MESSAGE);
  }
  if (payer.userId !== actor.uid) {
    if (!isWorkspaceAdmin(input.role)) {
      throw new ApplicationError("permission_denied",
        INTEGRATION_ACTOR_MESSAGE);
    }
    const member = await transaction.get(
      workspaceMemberRef(actor.workspaceId, payer.userId));
    const memberRole = member.get("role");
    if (
      !member.exists || member.get("status") !== "active" ||
      !(SPLIT_ACTOR_ROLES as readonly unknown[]).includes(memberRole)
    ) {
      throw new ApplicationError("domain_precondition_failed",
        PAYER_NOT_MEMBER_MESSAGE);
    }
  }
  if (terms.financialIntegration === "cash") {
    const cashAccountId = terms.cashAccountId as string;
    const accounts = await prepareSplitCashFact(transaction, actor.workspaceId,
      cashAccountId);
    return {
      kind: "cash",
      accounts,
      cashAccountId,
      transactionId: splitBillCashTransactionIdFor(actor.workspaceId,
        input.billId, "apply"),
    };
  }
  const cardSnapshot = await transaction.get(
    cardsRef(actor.workspaceId).doc(terms.cardId as string));
  const prepared = await prepareCardPurchase(transaction, {
    workspaceId: actor.workspaceId,
    cardSnapshot,
    totalCents: terms.amountCents,
    installmentsCount: terms.installmentsCount as number,
    purchaseDate: terms.expenseDate,
    today: todayOf(input.options),
  });
  return {
    kind: "card",
    prepared,
    purchaseId: splitBillCardPurchaseIdFor(actor.workspaceId, input.billId),
  };
};

const factLinks = (fact: PreparedFact) => ({
  cashAccountId: fact.kind === "cash" ? fact.cashAccountId : null,
  cashTransactionId: fact.kind === "cash" ? fact.transactionId : null,
  cardId: fact.kind === "card" ? fact.prepared.card.id : null,
  purchaseId: fact.kind === "card" ? fact.purchaseId : null,
  installmentsCount: fact.kind === "card" ?
    fact.prepared.installmentsCount : null,
});

/** Fase de escrita do fato, no commit do título. */
const commitBillFact = (
  transaction: admin.firestore.Transaction,
  fact: PreparedFact,
  input: {
    actor: WorkspaceActor;
    start: SplitMutationStart;
    groupId: string;
    billId: string;
    payerUserId: string | null;
    description: string;
    category: string;
    amountCents: number;
    expenseDate: string;
    operation: string;
    requestId: string;
    correlationId: string | null;
  },
): void => {
  if (fact.kind === "none") return;
  const payerUserId = input.payerUserId as string;
  if (fact.kind === "cash") {
    commitSplitCashFact(transaction, fact.accounts, {
      transactionId: fact.transactionId,
      workspaceId: input.actor.workspaceId,
      actorUid: input.actor.uid,
      ownerUid: payerUserId,
      profileType: input.start.workspace.type === "PJ" ? "PJ" : "PF",
      cashAccountId: fact.cashAccountId,
      date: input.expenseDate,
      description: input.description,
      category: input.category,
      kind: "bill_expense",
      groupId: input.groupId,
      billId: input.billId,
      reimbursementId: null,
      amountCents: input.amountCents,
      operation: input.operation,
      requestId: input.requestId,
    });
    return;
  }
  commitCardPurchase(transaction, fact.prepared, {
    purchaseId: fact.purchaseId,
    workspaceId: input.actor.workspaceId,
    details: {
      description: input.description,
      category: input.category,
      supplier: null,
      costCenter: null,
    },
    origin: {source: "split", splitGroupId: input.groupId,
      splitBillId: input.billId},
    // Responsável pela compra: o pagador.
    createdBy: payerUserId,
    actorId: input.actor.uid,
    actorRole: input.start.role,
    intentId: input.start.intentId,
    requestHash: input.start.reservation.requestHash,
    operation: input.operation,
    requestId: input.requestId,
    correlationId: input.correlationId,
  });
};

// ------------------------------------------------------------------ criação

export const executeCreateSplitBill = async (
  actor: WorkspaceActor,
  payload: CreateSplitBillPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: CREATE_SPLIT_BILL_OPERATION,
      eventOperation: "split.bill_created",
      roles: SPLIT_ACTOR_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    const access = await loadGroupAccess(transaction, actor, payload.groupId);
    const {group} = access;
    assertGroupActive(group);
    if (group.businessMode !== "split") {
      throw new ApplicationError("domain_precondition_failed",
        BILL_REIMBURSEMENT_GROUP_MESSAGE);
    }
    assertCanWriteInGroup(start.role, access);
    assertNotFuture(payload.expenseDate, options);
    if (group.counters.openBillCount >= SPLIT_LIMITS.openBillsPerGroup) {
      throw new ApplicationError("domain_precondition_failed",
        BILL_LIMIT_MESSAGE);
    }
    const allocation = allocate(payload);
    const partyIds = [payload.payerParticipantId,
      ...allocation.map((share) => share.participantId)];
    const participants = await readGroupParticipants(transaction,
      actor.workspaceId, group.id, partyIds);
    assertEligibleParties(participants, partyIds);
    const payer = participants.get(payload.payerParticipantId) as
      AuthoritativeSplitParticipant;
    const billId = splitBillIdFor(actor.workspaceId, start.intentId);
    const fact = await prepareBillFact(transaction, {
      actor, role: start.role, billId, terms: payload, payer, options,
    });
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_FINANCIAL_RATE_LIMIT);

    const planned = planShares(allocation, payer.id);
    const derived = deriveBillStatus(planned);
    const categoryBucket = categoryBucketFor(group, payload.category);
    writePlannedShares(transaction, {
      workspaceId: actor.workspaceId,
      groupId: group.id,
      billId,
      planned,
      existing: new Map(),
      termsRevision: 1,
      actorUid: actor.uid,
    });
    const links = factLinks(fact);
    const bill = {
      status: derived.status,
      amountCents: payload.amountCents,
      allocationMethod: payload.allocationMethod,
      financialIntegration: payload.financialIntegration,
      shareCount: derived.shareCount,
      openShareCount: derived.openShareCount,
      resolvedShareCount: 0,
      outstandingCents: derived.outstandingCents,
      termsRevision: 1,
    };
    transaction.create(splitBillsRef(actor.workspaceId).doc(billId), {
      id: billId,
      schemaVersion: SPLIT_SCHEMA_VERSION,
      workspaceId: actor.workspaceId,
      groupId: group.id,
      description: payload.description,
      category: payload.category,
      categoryBucket,
      amountCents: payload.amountCents,
      currency: MONEY_CURRENCY,
      expenseDate: payload.expenseDate,
      payerParticipantId: payer.id,
      payerUserId: payer.userId,
      allocationMethod: payload.allocationMethod,
      participantIds: planned.map((share) => share.participantId),
      financialIntegration: payload.financialIntegration,
      ...links,
      status: derived.status,
      shareCount: derived.shareCount,
      openShareCount: derived.openShareCount,
      resolvedShareCount: 0,
      outstandingCents: derived.outstandingCents,
      termsRevision: 1,
      createdBy: actor.uid,
      intentId: start.intentId,
      requestHash: start.reservation.requestHash,
      revision: 1,
      voidedAt: null,
      voidedBy: null,
      reversalTransactionId: null,
      cardReversalMode: null,
      updatedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const book = new AggregateBook();
    book.addBill({status: derived.status, amountCents: payload.amountCents,
      payerParticipantId: payer.id, categoryBucket},
    planned.map(shareStateOf), 1);
    writeGroup(transaction, access.groupRef, group, book.group, actor.uid);
    writeParticipantBalances(transaction,
      (id) => splitParticipantsRef(actor.workspaceId).doc(id),
      participants, book, actor.uid);
    commitBillFact(transaction, fact, {
      actor,
      start,
      groupId: group.id,
      billId,
      payerUserId: payer.userId,
      description: payload.description,
      category: payload.category,
      amountCents: payload.amountCents,
      expenseDate: payload.expenseDate,
      operation: CREATE_SPLIT_BILL_OPERATION,
      requestId,
      correlationId: correlationOf(payload),
    });
    appendSplitEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "split.bill_created",
      targetKey: start.intentId,
      groupId: group.id,
      billId,
      participantId: payer.id,
      actorId: actor.uid,
      actorRole: start.role,
      intentId: start.intentId,
      requestHash: start.reservation.requestHash,
      requestId,
      correlationId: correlationOf(payload),
      amountCents: payload.amountCents,
      before: null,
      after: billSnapshot(bill),
    });
    return finishSplitMutation(transaction, actor, {
      start,
      operation: CREATE_SPLIT_BILL_OPERATION,
      requestId,
      ids: splitIds({groupId: group.id, billId}),
      rateLimit,
      options,
    });
  });

// ----------------------------------------------- permissões sobre o título

const activeGroupRole = (access: GroupAccess) =>
  access.actorParticipant?.status === "active" ?
    access.actorParticipant.role : null;

/**
 * Editar (e anular título sem fato): quem lançou, o pagador, o dono do grupo
 * ou owner/admin do workspace. Quem lançou e o pagador precisam seguir no
 * grupo como dono ou participante.
 */
const canEditBill = (
  actor: WorkspaceActor,
  role: WorkspaceRole,
  access: GroupAccess,
  bill: AuthoritativeSplitBill,
): boolean => {
  if (isWorkspaceAdmin(role)) return true;
  const groupRole = activeGroupRole(access);
  if (groupRole === "owner") return true;
  return groupRole === "participant" &&
    (bill.createdBy === actor.uid || bill.payerUserId === actor.uid);
};

/** Anular título com fato: só o pagador (no grupo) ou owner/admin. */
const canVoidBillWithFact = (
  actor: WorkspaceActor,
  role: WorkspaceRole,
  access: GroupAccess,
  bill: AuthoritativeSplitBill,
): boolean => {
  if (isWorkspaceAdmin(role)) return true;
  const groupRole = activeGroupRole(access);
  return (groupRole === "owner" || groupRole === "participant") &&
    bill.payerUserId === actor.uid;
};

// ------------------------------------------------------------------- edição

/** Termos atuais iguais aos pedidos (mesmo rateio e mesmo destino). */
const sameTerms = (
  bill: AuthoritativeSplitBill,
  shares: readonly AuthoritativeSplitShare[],
  terms: SplitBillTerms,
  allocation: readonly AllocatedShare[],
): boolean => {
  if (
    bill.amountCents !== terms.amountCents ||
    bill.expenseDate !== terms.expenseDate ||
    bill.payerParticipantId !== terms.payerParticipantId ||
    bill.allocationMethod !== terms.allocationMethod ||
    bill.financialIntegration !== terms.financialIntegration ||
    bill.cashAccountId !== terms.cashAccountId ||
    bill.cardId !== terms.cardId ||
    bill.installmentsCount !== terms.installmentsCount ||
    allocation.length !== shares.length
  ) {
    return false;
  }
  const byParticipant = new Map(shares.map((share) =>
    [share.participantId, share]));
  return allocation.every((share) => {
    const current = byParticipant.get(share.participantId);
    return current !== undefined &&
      current.amountDueCents === share.amountDueCents &&
      current.weightBps === share.weightBps;
  });
};

export const executeUpdateSplitBill = async (
  actor: WorkspaceActor,
  payload: UpdateSplitBillPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: UPDATE_SPLIT_BILL_OPERATION,
      eventOperation: "split.bill_updated",
      roles: SPLIT_ACTOR_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    const {billRef, bill} = await readBill(transaction, actor.workspaceId,
      payload.billId);
    const access = await loadGroupAccess(transaction, actor, bill.groupId);
    const {group} = access;
    assertGroupActive(group);
    if (bill.status === "voided") {
      throw new ApplicationError("domain_precondition_failed",
        BILL_VOIDED_MESSAGE);
    }
    if (!canEditBill(actor, start.role, access, bill)) {
      throw new ApplicationError("permission_denied",
        BILL_EDIT_DENIED_MESSAGE);
    }
    assertVersion(bill.updatedAt, payload.expectedUpdatedAt,
      BILL_CONFLICT_MESSAGE);

    const changedFields: string[] = [];
    const description = payload.metadata?.description ?? bill.description;
    if (description !== bill.description) changedFields.push("description");
    const category = payload.metadata?.category ?? bill.category;
    const categoryBucket = category === bill.category ?
      bill.categoryBucket : categoryBucketFor(group, category);
    if (category !== bill.category) changedFields.push("category");

    // Termos: só quando mudam de fato e o título ainda os aceita.
    const terms = payload.terms;
    let allocation: AllocatedShare[] | null = null;
    let shares = new Map<string, AuthoritativeSplitShare | null>();
    let before: AuthoritativeSplitShare[] = [];
    let participants = new Map<string, AuthoritativeSplitParticipant>();
    let fact: PreparedFact = {kind: "none"};
    if (terms) {
      const proposed = allocate(terms);
      shares = await readBillShares(transaction, bill,
        [...bill.participantIds,
          ...proposed.map((share) => share.participantId)]);
      before = currentShares(bill, shares);
      if (!sameTerms(bill, before, terms, proposed)) {
        if (areTermsLocked(bill)) {
          throw new ApplicationError("domain_precondition_failed",
            BILL_TERMS_LOCKED_MESSAGE);
        }
        assertNotFuture(terms.expenseDate, options);
        allocation = proposed;
        changedFields.push("terms");
      }
    }
    if (changedFields.length === 0) {
      throw new ApplicationError("domain_precondition_failed",
        BILL_UNCHANGED_MESSAGE);
    }
    if (allocation && terms) {
      const newParties = [terms.payerParticipantId,
        ...allocation.map((share) => share.participantId)];
      participants = await readGroupParticipants(transaction,
        actor.workspaceId, group.id,
        [bill.payerParticipantId, ...bill.participantIds, ...newParties]);
      assertEligibleParties(participants, newParties);
      fact = await prepareBillFact(transaction, {
        actor,
        role: start.role,
        billId: bill.id,
        terms,
        payer: participants.get(terms.payerParticipantId) as
          AuthoritativeSplitParticipant,
        options,
      });
    }
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_FINANCIAL_RATE_LIMIT);

    const book = new AggregateBook();
    const beforeState = billStateOf(bill);
    let patch: Record<string, unknown> = {description, category,
      categoryBucket};
    let after = bill;
    if (allocation && terms) {
      const payer = participants.get(terms.payerParticipantId) as
        AuthoritativeSplitParticipant;
      const planned = planShares(allocation, payer.id);
      const derived = deriveBillStatus(planned);
      const termsRevision = bill.termsRevision + 1;
      writePlannedShares(transaction, {
        workspaceId: actor.workspaceId,
        groupId: group.id,
        billId: bill.id,
        planned,
        existing: shares,
        termsRevision,
        actorUid: actor.uid,
      });
      // Quem saiu do rateio: o rateio fica, anulado (nunca apagado).
      const kept = new Set(planned.map((share) => share.participantId));
      for (const share of before) {
        if (kept.has(share.participantId)) continue;
        transaction.update(splitSharesRef(actor.workspaceId).doc(share.id), {
          status: "voided",
          termsRevision,
          revision: share.revision + 1,
          updatedBy: actor.uid,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      book.addBill(beforeState, before.map(shareStateOf), -1);
      book.addBill({status: derived.status, amountCents: terms.amountCents,
        payerParticipantId: payer.id, categoryBucket},
      planned.map(shareStateOf), 1);
      const links = factLinks(fact);
      patch = {
        ...patch,
        amountCents: terms.amountCents,
        expenseDate: terms.expenseDate,
        payerParticipantId: payer.id,
        payerUserId: payer.userId,
        allocationMethod: terms.allocationMethod,
        participantIds: planned.map((share) => share.participantId),
        financialIntegration: terms.financialIntegration,
        ...links,
        status: derived.status,
        shareCount: derived.shareCount,
        openShareCount: derived.openShareCount,
        outstandingCents: derived.outstandingCents,
        termsRevision,
      };
      after = {
        ...bill,
        amountCents: terms.amountCents,
        allocationMethod: terms.allocationMethod,
        financialIntegration: terms.financialIntegration,
        status: derived.status,
        shareCount: derived.shareCount,
        openShareCount: derived.openShareCount,
        outstandingCents: derived.outstandingCents,
        termsRevision,
      };
    } else if (categoryBucket !== bill.categoryBucket) {
      book.addBillPart(beforeState, -1);
      book.addBillPart({...beforeState, categoryBucket}, 1);
    }
    transaction.update(billRef, {
      ...patch,
      revision: bill.revision + 1,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    writeGroup(transaction, access.groupRef, group, book.group, actor.uid);
    writeParticipantBalances(transaction,
      (id) => splitParticipantsRef(actor.workspaceId).doc(id),
      participants, book, actor.uid);
    if (allocation && terms) {
      commitBillFact(transaction, fact, {
        actor,
        start,
        groupId: group.id,
        billId: bill.id,
        payerUserId: (participants.get(terms.payerParticipantId) as
          AuthoritativeSplitParticipant).userId,
        description,
        category,
        amountCents: terms.amountCents,
        expenseDate: terms.expenseDate,
        operation: UPDATE_SPLIT_BILL_OPERATION,
        requestId,
        correlationId: correlationOf(payload),
      });
    }
    appendSplitEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "split.bill_updated",
      targetKey: start.intentId,
      groupId: group.id,
      billId: bill.id,
      actorId: actor.uid,
      actorRole: start.role,
      intentId: start.intentId,
      requestHash: start.reservation.requestHash,
      requestId,
      correlationId: correlationOf(payload),
      amountCents: after.amountCents,
      changedFields,
      before: billSnapshot(bill),
      after: billSnapshot(after),
    });
    return finishSplitMutation(transaction, actor, {
      start,
      operation: UPDATE_SPLIT_BILL_OPERATION,
      requestId,
      ids: splitIds({groupId: group.id, billId: bill.id}),
      rateLimit,
      options,
    });
  });

// ---------------------------------------------------------------- anulação

type PreparedReversal =
  | {kind: "none"}
  | {kind: "cash"; prepared: PreparedSplitCashReversal; transactionId: string}
  | {kind: "card"; prepared: PreparedCardPurchaseReversal};

export const executeVoidSplitBill = async (
  actor: WorkspaceActor,
  payload: VoidSplitBillPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: VOID_SPLIT_BILL_OPERATION,
      eventOperation: "split.bill_voided",
      roles: SPLIT_ACTOR_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    const {billRef, bill} = await readBill(transaction, actor.workspaceId,
      payload.billId);
    const access = await loadGroupAccess(transaction, actor, bill.groupId);
    const {group} = access;
    assertGroupActive(group);
    if (bill.status === "voided") {
      throw new ApplicationError("domain_precondition_failed",
        BILL_ALREADY_VOIDED_MESSAGE);
    }
    const withFact = hasFinancialFact(bill);
    if (withFact ?
      !canVoidBillWithFact(actor, start.role, access, bill) :
      !canEditBill(actor, start.role, access, bill)) {
      throw new ApplicationError("permission_denied", withFact ?
        BILL_VOID_FACT_DENIED_MESSAGE : BILL_EDIT_DENIED_MESSAGE);
    }
    assertVersion(bill.updatedAt, payload.expectedUpdatedAt,
      BILL_CONFLICT_MESSAGE);
    const shares = currentShares(bill,
      await readBillShares(transaction, bill, bill.participantIds));
    if (shares.some((share) => share.status === "forgiven")) {
      throw new ApplicationError("domain_precondition_failed",
        BILL_HAS_FORGIVEN_MESSAGE, {ineligible: "forgiven_share"});
    }
    if (shares.some((share) => share.settledVia === "settlement")) {
      throw new ApplicationError("domain_precondition_failed",
        BILL_HAS_SETTLEMENTS_MESSAGE, {ineligible: "settled_share"});
    }
    const participants = await readGroupParticipants(transaction,
      actor.workspaceId, group.id,
      [bill.payerParticipantId, ...bill.participantIds]);
    let reversal: PreparedReversal = {kind: "none"};
    if (bill.financialIntegration === "cash") {
      reversal = {
        kind: "cash",
        prepared: await prepareSplitCashReversal(transaction, {
          workspaceId: actor.workspaceId,
          originalTransactionId: bill.cashTransactionId as string,
          expected: {kind: "bill_expense", groupId: group.id,
            billId: bill.id, reimbursementId: null},
        }),
        transactionId: splitBillCashTransactionIdFor(actor.workspaceId,
          bill.id, "reversal"),
      };
    } else if (bill.financialIntegration === "card") {
      reversal = {
        kind: "card",
        prepared: await prepareCardPurchaseReversal(transaction, {
          workspaceId: actor.workspaceId,
          purchaseId: bill.purchaseId as string,
          splitGroupId: group.id,
          splitBillId: bill.id,
          today: todayOf(options),
        }),
      };
    }
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_FINANCIAL_RATE_LIMIT);

    for (const share of shares) {
      transaction.update(splitSharesRef(actor.workspaceId).doc(share.id), {
        status: "voided",
        revision: share.revision + 1,
        updatedBy: actor.uid,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const book = new AggregateBook();
    book.addBill(billStateOf(bill), shares.map(shareStateOf), -1);
    writeGroup(transaction, access.groupRef, group, book.group, actor.uid);
    writeParticipantBalances(transaction,
      (id) => splitParticipantsRef(actor.workspaceId).doc(id),
      participants, book, actor.uid);
    let cardReversalMode: "cancel" | "refund" | null = null;
    if (reversal.kind === "cash") {
      commitSplitCashReversal(transaction, reversal.prepared, {
        reversalTransactionId: reversal.transactionId,
        workspaceId: actor.workspaceId,
        actorUid: actor.uid,
        ownerUid: bill.payerUserId as string,
        profileType: start.workspace.type === "PJ" ? "PJ" : "PF",
        description: `Estorno: ${bill.description}`,
        operation: VOID_SPLIT_BILL_OPERATION,
        requestId,
      });
    } else if (reversal.kind === "card") {
      cardReversalMode = commitCardPurchaseReversal(transaction,
        reversal.prepared, {
          actorUid: actor.uid,
          actorRole: start.role,
          intentId: start.intentId,
          requestHash: start.reservation.requestHash,
          operation: VOID_SPLIT_BILL_OPERATION,
          requestId,
          correlationId: correlationOf(payload),
        }).mode;
    }
    transaction.update(billRef, {
      status: "voided",
      openShareCount: 0,
      outstandingCents: 0,
      voidedAt: FieldValue.serverTimestamp(),
      voidedBy: actor.uid,
      reversalTransactionId: reversal.kind === "cash" ?
        reversal.transactionId : null,
      cardReversalMode,
      revision: bill.revision + 1,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendSplitEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "split.bill_voided",
      targetKey: start.intentId,
      groupId: group.id,
      billId: bill.id,
      actorId: actor.uid,
      actorRole: start.role,
      intentId: start.intentId,
      requestHash: start.reservation.requestHash,
      requestId,
      correlationId: correlationOf(payload),
      amountCents: bill.amountCents,
      before: billSnapshot(bill),
      after: {
        ...billSnapshot({...bill, status: "voided", openShareCount: 0,
          outstandingCents: 0}),
        cardReversalMode,
      },
    });
    return finishSplitMutation(transaction, actor, {
      start,
      operation: VOID_SPLIT_BILL_OPERATION,
      requestId,
      ids: splitIds({groupId: group.id, billId: bill.id}),
      rateLimit,
      options,
    });
  });
