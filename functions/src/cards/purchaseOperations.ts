import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
  type ActorIdempotencyReservation,
} from "../shared/idempotency";
import {splitCentsEvenly} from "../shared/money";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import {
  CARD_ADMIN_ROLES,
  CARD_ARCHIVED_MESSAGE,
  CARD_INCONSISTENT_MESSAGE,
  CARD_NOT_FOUND_MESSAGE,
  CARD_PURCHASE_ROLES,
  IDEMPOTENCY_CONFLICT_MESSAGE,
  INTERNAL_MESSAGE,
  PURCHASE_CONFLICT_MESSAGE,
  PURCHASE_INCONSISTENT_MESSAGE,
  PURCHASE_LIMIT_INSUFFICIENT_MESSAGE,
  PURCHASE_NOT_FOUND_MESSAGE,
  assertVersion,
  findCardIntentAnchor,
  reserveCardRateLimit,
  todayOf,
  type CardOperationOptions,
} from "./common";
import type {
  CancelCreditCardPurchasePayload,
  CreateCreditCardPurchasePayload,
  RefundCreditCardPurchasePayload,
  UpdateCreditCardPurchasePayload,
} from "./contracts";
import {InvoiceBook} from "./invoices";
import {postCardLimit} from "./limit";
import {
  appendCardEvent,
  cardIntentIdFor,
  cardLimitSnapshot,
  cardsRef,
  entriesRef,
  entryCancelPatch,
  entryDocument,
  firstOpenCompetence,
  installmentEntryIdFor,
  placeInstallments,
  purchaseIdFor,
  purchasesRef,
  readAuthoritativeCard,
  readAuthoritativeEntry,
  readAuthoritativePurchase,
  refundEntryIdFor,
  CARD_SCHEMA_VERSION,
  type AuthoritativeCard,
  type AuthoritativeEntry,
  type AuthoritativePurchase,
  type CardEventOperation,
  type InstallmentPlacement,
  type PurchaseDetails,
} from "./model";

/**
 * Compras de cartão (P4-A, D-36).
 *
 * O backend é a única autoridade da compra: o cliente informa o valor total
 * em centavos, as parcelas, a data, o cartão e a descrição; a distribuição
 * (maior resto: a soma das parcelas é exatamente o total), a publicação nas
 * faturas, a origem (`manual`) e a reserva do limite são decididas aqui, numa
 * única transação com compra, parcelas, faturas, livro do limite, evento e
 * idempotência.
 *
 * - Compra retroativa: a data da compra é mantida; parcela cuja competência
 *   natural já fechou vai para a primeira fatura aberta.
 * - Cancelamento: só com todas as parcelas em faturas abertas; as parcelas
 *   são canceladas logicamente e o limite volta.
 * - Estorno: com alguma parcela em fatura fechada; as parcelas abertas são
 *   canceladas, o já faturado vira um crédito imutável na primeira fatura
 *   aberta, ligado à compra, e o limite volta pelo total da compra.
 * - Edição: descritivos a qualquer momento da compra ativa; financeiros só com
 *   todas as parcelas em faturas abertas (senão, estorno).
 *
 * Compras de cartão não consomem a quota `transactionsPerMonth` (D-40).
 */
export const CREATE_CREDIT_CARD_PURCHASE_OPERATION = "createCreditCardPurchase";
export const UPDATE_CREDIT_CARD_PURCHASE_OPERATION = "updateCreditCardPurchase";
export const CANCEL_CREDIT_CARD_PURCHASE_OPERATION = "cancelCreditCardPurchase";
export const REFUND_CREDIT_CARD_PURCHASE_OPERATION = "refundCreditCardPurchase";

export const PURCHASE_FUTURE_DATE_MESSAGE =
  "Data da compra: não pode ser futura.";
export const PURCHASE_ALREADY_CANCELLED_MESSAGE =
  "Esta compra já foi cancelada.";
export const PURCHASE_ALREADY_REFUNDED_MESSAGE =
  "Esta compra já foi estornada.";
export const PURCHASE_HAS_CLOSED_INSTALLMENTS_MESSAGE =
  "Esta compra já tem parcelas em fatura fechada e não pode ser cancelada. " +
  "Use “Estornar compra”, que lança um crédito na fatura aberta.";
export const PURCHASE_ALL_OPEN_MESSAGE =
  "Todas as parcelas desta compra estão em faturas abertas: use “Cancelar " +
  "compra”.";
export const PURCHASE_FINANCIAL_LOCKED_MESSAGE =
  "Esta compra já tem parcelas em fatura fechada: valor, data e parcelas não " +
  "podem mais ser alterados. Para desfazê-la, use “Estornar compra”.";
export const PURCHASE_GENERATED_FINANCIAL_LOCKED_MESSAGE =
  "Esta compra foi gerada por uma despesa recorrente: valor, data e " +
  "parcelas não podem ser alterados. Para desfazê-la, cancele ou estorne a " +
  "compra.";
export const PURCHASE_NOT_EDITABLE_MESSAGE =
  "Compras canceladas ou estornadas não podem ser editadas.";
export const PURCHASE_UNCHANGED_MESSAGE = "Nenhuma alteração para salvar.";
export const PURCHASE_SPLIT_MANAGED_MESSAGE =
  "Esta compra foi lançada pela Divisão de contas: altere ou anule o " +
  "título no grupo.";
export const MEMBER_PURCHASE_OWNERSHIP_MESSAGE =
  "Membros só podem editar as compras que criaram.";
export const INSTALLMENT_FLOOR_MESSAGE =
  "Valor da compra: cada parcela precisa ter ao menos R$ 0,01.";

const db = () => admin.firestore();

export interface PurchaseMutationResult {
  purchaseId: string;
  cardId: string;
  replayed: boolean;
  [key: string]: unknown;
}

const replayResult = (
  stored: Record<string, unknown>,
): PurchaseMutationResult => {
  if (typeof stored.purchaseId !== "string") {
    throw new ApplicationError("internal", INTERNAL_MESSAGE);
  }
  return {...(stored as PurchaseMutationResult), replayed: true};
};

const readCardOrFail = (
  snapshot: admin.firestore.DocumentSnapshot,
  workspaceId: string,
): AuthoritativeCard => {
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", CARD_NOT_FOUND_MESSAGE);
  }
  const card = readAuthoritativeCard(snapshot.id, snapshot.data(), workspaceId);
  if (!card) {
    throw new ApplicationError("domain_precondition_failed",
      CARD_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
  }
  return card;
};

/** Escreve as parcelas de uma revisão financeira e as soma nas faturas. */
const writeInstallments = (
  transaction: admin.firestore.Transaction,
  book: InvoiceBook,
  input: {
    purchaseId: string;
    revision: number;
    placements: readonly InstallmentPlacement[];
    actorUid: string;
    operation: string;
    requestId: string;
  },
): void => {
  for (const placement of input.placements) {
    const id = installmentEntryIdFor(input.purchaseId, input.revision,
      placement.installmentNumber);
    book.applyEntry(placement.competenceMonth, placement.amountCents, 1);
    transaction.create(entriesRef(book.card.workspaceId).doc(id),
      entryDocument({
        id,
        workspaceId: book.card.workspaceId,
        cardId: book.card.cardId,
        competenceMonth: placement.competenceMonth,
        kind: "installment",
        amountCents: placement.amountCents,
        purchaseId: input.purchaseId,
        installmentNumber: placement.installmentNumber,
        installmentsCount: input.placements.length,
        naturalCompetence: placement.naturalCompetence,
        requestedCompetence: null,
        sourceInvoiceId: null,
        reason: null,
        actorUid: input.actorUid,
        operation: input.operation,
        requestId: input.requestId,
      }));
  }
};


/** Parcelas pela regra do maior resto, publicadas pela regra de D-36. */
const placementsFor = (input: {
  totalCents: number;
  installmentsCount: number;
  purchaseDate: string;
  card: AuthoritativeCard;
  today: string;
}): InstallmentPlacement[] => {
  if (input.purchaseDate > input.today) {
    throw new ApplicationError("domain_precondition_failed",
      PURCHASE_FUTURE_DATE_MESSAGE);
  }
  if (input.totalCents < input.installmentsCount) {
    throw new ApplicationError("domain_precondition_failed",
      INSTALLMENT_FLOOR_MESSAGE);
  }
  return placeInstallments({
    purchaseDate: input.purchaseDate,
    amountsCents: splitCentsEvenly(input.totalCents, input.installmentsCount),
    closingDay: input.card.closingDay,
    today: input.today,
  });
};

const purchaseSnapshot = (purchase: {
  status: string;
  totalCents: number;
  installmentsCount: number;
  refundedCents: number;
}) => ({
  status: purchase.status,
  totalCents: purchase.totalCents,
  installmentsCount: purchase.installmentsCount,
  refundedCents: purchase.refundedCents,
});

// ------------------------------------------------------------------ criação

/**
 * Compra preparada: cartão relido, parcelas distribuídas e publicadas,
 * faturas carregadas e limite conferido — só leituras e decisões, na fase de
 * leitura da transação. Usada pela compra manual e pela geração de
 * Recorrentes (P4-B); nenhum outro domínio repete distribuição, publicação,
 * retroatividade ou reserva de limite.
 */
export interface PreparedCardPurchase {
  card: AuthoritativeCard;
  placements: InstallmentPlacement[];
  book: InvoiceBook;
  totalCents: number;
  installmentsCount: number;
  purchaseDate: string;
}

export const prepareCardPurchase = async (
  transaction: admin.firestore.Transaction,
  input: {
    workspaceId: string;
    cardSnapshot: admin.firestore.DocumentSnapshot;
    totalCents: number;
    installmentsCount: number;
    purchaseDate: string;
    today: string;
  },
): Promise<PreparedCardPurchase> => {
  const card = readCardOrFail(input.cardSnapshot, input.workspaceId);
  if (card.status !== "active") {
    throw new ApplicationError("domain_precondition_failed",
      CARD_ARCHIVED_MESSAGE, {ineligible: "archived_card"});
  }
  const placements = placementsFor({
    totalCents: input.totalCents,
    installmentsCount: input.installmentsCount,
    purchaseDate: input.purchaseDate,
    card,
    today: input.today,
  });
  const book = new InvoiceBook(transaction, {
    workspaceId: input.workspaceId,
    cardId: card.id,
    closingDay: card.closingDay,
    dueDay: card.dueDay,
  }, input.today);
  await book.load(placements.map((placement) => placement.competenceMonth));
  // Reserva coerente do limite: relida na transação; o último centavo
  // disputado por duas compras é decidido pela serialização do cartão.
  if (input.totalCents > card.limitAvailableCents) {
    throw new ApplicationError("domain_precondition_failed",
      PURCHASE_LIMIT_INSUFFICIENT_MESSAGE,
      {
        availableCents: Math.max(card.limitAvailableCents, 0),
        ineligible: "limit_insufficient",
      });
  }
  return {
    card,
    placements,
    book,
    totalCents: input.totalCents,
    installmentsCount: input.installmentsCount,
    purchaseDate: input.purchaseDate,
  };
};

/** Origem gravada pela primitiva: a callable manual nunca escolhe outra. */
export type CardPurchaseOrigin =
  | {source: "manual"}
  | {source: "recurring"; recurringExpenseId: string; occurrenceId: string}
  | {source: "split"; splitGroupId: string; splitBillId: string};

/**
 * Escritas da compra preparada (fase de escrita): parcelas, faturas,
 * documento da compra, livro do limite e evento — no mesmo commit de quem
 * chamou. `createdBy` é o responsável pela compra (o ator na manual; o
 * responsável pelo contrato na recorrente); `actorId` é quem executou.
 */
export const commitCardPurchase = (
  transaction: admin.firestore.Transaction,
  prepared: PreparedCardPurchase,
  input: {
    purchaseId: string;
    workspaceId: string;
    details: PurchaseDetails;
    origin: CardPurchaseOrigin;
    createdBy: string;
    actorId: string;
    actorRole: WorkspaceRole | null;
    intentId: string | null;
    requestHash: string;
    operation: string;
    requestId: string;
    correlationId: string | null;
  },
): {firstCompetence: string; retroactive: boolean} => {
  const {card, placements, book} = prepared;
  const purchaseRef = purchasesRef(input.workspaceId).doc(input.purchaseId);
  writeInstallments(transaction, book, {
    purchaseId: input.purchaseId,
    revision: 1,
    placements,
    actorUid: input.actorId,
    operation: input.operation,
    requestId: input.requestId,
  });
  book.write();
  const retroactive = placements.some((placement) =>
    placement.competenceMonth !== placement.naturalCompetence);
  const recurring = input.origin.source === "recurring" ? input.origin : null;
  const split = input.origin.source === "split" ? input.origin : null;
  transaction.create(purchaseRef, {
    id: input.purchaseId,
    schemaVersion: CARD_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    cardId: card.id,
    description: input.details.description,
    category: input.details.category,
    supplier: input.details.supplier,
    costCenter: input.details.costCenter,
    purchaseDate: prepared.purchaseDate,
    totalCents: prepared.totalCents,
    installmentsCount: prepared.installmentsCount,
    installmentRevision: 1,
    firstCompetence: placements[0].competenceMonth,
    lastCompetence: placements[placements.length - 1].competenceMonth,
    retroactive,
    status: "active",
    source: input.origin.source,
    recurringExpenseId: recurring?.recurringExpenseId ?? null,
    recurringOccurrenceId: recurring?.occurrenceId ?? null,
    splitGroupId: split?.splitGroupId ?? null,
    splitBillId: split?.splitBillId ?? null,
    refundedCents: 0,
    refundEntryId: null,
    cancelledAt: null,
    cancelledBy: null,
    refundedAt: null,
    refundedBy: null,
    intentId: input.intentId,
    requestHash: input.requestHash,
    revision: 1,
    createdBy: input.createdBy,
    updatedBy: input.actorId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  const limitUsedAfter = postCardLimit(transaction, card, {
    kind: "purchase",
    amountCents: prepared.totalCents,
    sourceKey: `${input.purchaseId}:purchase`,
    sourceId: input.purchaseId,
    actorUid: input.actorId,
    operation: input.operation,
    requestId: input.requestId,
  });
  appendCardEvent(transaction, {
    workspaceId: input.workspaceId,
    cardId: card.id,
    operation: "credit_card.purchase_created",
    targetKey: input.purchaseId,
    actorId: input.actorId,
    actorRole: input.actorRole,
    intentId: input.intentId,
    requestHash: input.requestHash,
    requestId: input.requestId,
    correlationId: input.correlationId,
    purchaseId: input.purchaseId,
    amountCents: prepared.totalCents,
    before: cardLimitSnapshot(card),
    after: {
      ...cardLimitSnapshot({...card, limitUsedCents: limitUsedAfter}),
      installmentsCount: prepared.installmentsCount,
      firstCompetence: placements[0].competenceMonth,
      retroactive: retroactive ? 1 : 0,
      source: input.origin.source,
    },
  });
  return {firstCompetence: placements[0].competenceMonth, retroactive};
};

export const executeCreateCreditCardPurchase = async (
  actor: WorkspaceActor,
  payload: CreateCreditCardPurchasePayload,
  requestId: string,
  options: CardOperationOptions = {},
): Promise<PurchaseMutationResult> =>
  db().runTransaction(async (transaction) => {
    const {role} = await reassertWorkspaceActor(
      transaction, actor, CARD_PURCHASE_ROLES);
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: CREATE_CREDIT_CARD_PURCHASE_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload: payload as unknown as Record<string, unknown>,
    });
    if (reservation.replay) return replayResult(reservation.replay);

    const purchaseId = purchaseIdFor(actor.workspaceId, actor.uid,
      payload.idempotencyKey);
    const intentId = cardIntentIdFor(actor.uid, payload.idempotencyKey);
    const purchaseRef = purchasesRef(actor.workspaceId).doc(purchaseId);
    const [purchaseSnapshotDoc, cardSnapshot] = await transaction.getAll(
      purchaseRef, cardsRef(actor.workspaceId).doc(payload.cardId));
    if (purchaseSnapshotDoc.exists) {
      // Âncora durável: a própria compra no ID `(workspace, ator, chave)`.
      if (
        purchaseSnapshotDoc.get("requestHash") === reservation.requestHash &&
        purchaseSnapshotDoc.get("createdBy") === actor.uid
      ) {
        return {
          purchaseId,
          cardId: String(purchaseSnapshotDoc.get("cardId")),
          replayed: true,
        };
      }
      throw new ApplicationError("idempotency_conflict",
        IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    const prepared = await prepareCardPurchase(transaction, {
      workspaceId: actor.workspaceId,
      cardSnapshot,
      totalCents: payload.totalCents,
      installmentsCount: payload.installmentsCount,
      purchaseDate: payload.purchaseDate,
      today: todayOf(options),
    });
    const rateLimit = await reserveCardRateLimit(transaction, actor);

    const {firstCompetence, retroactive} = commitCardPurchase(
      transaction, prepared, {
        purchaseId,
        workspaceId: actor.workspaceId,
        details: {
          description: payload.description,
          category: payload.category,
          supplier: payload.supplier ?? null,
          costCenter: payload.costCenter ?? null,
        },
        // A compra manual é sempre `manual`: o cliente não escolhe a origem.
        origin: {source: "manual"},
        createdBy: actor.uid,
        actorId: actor.uid,
        actorRole: role,
        intentId,
        requestHash: reservation.requestHash,
        operation: CREATE_CREDIT_CARD_PURCHASE_OPERATION,
        requestId,
        correlationId: payload.correlationId ?? null,
      });
    const result = {
      purchaseId,
      cardId: prepared.card.id,
      installmentsCount: payload.installmentsCount,
      firstCompetence,
      retroactive,
    };
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: CREATE_CREDIT_CARD_PURCHASE_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ---------------------------------------------------- carregamento comum

interface LoadedPurchase {
  role: WorkspaceRole;
  reservation: ActorIdempotencyReservation;
  intentId: string;
  purchaseRef: admin.firestore.DocumentReference;
  purchase: AuthoritativePurchase;
  card: AuthoritativeCard;
}

const loadPurchaseForMutation = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  payload: {
    purchaseId: string;
    idempotencyKey: string;
    expectedUpdatedAt: string;
  },
  operation: string,
  eventOperation: CardEventOperation,
  roles: readonly WorkspaceRole[],
): Promise<{replay: PurchaseMutationResult} | {loaded: LoadedPurchase}> => {
  const {role} = await reassertWorkspaceActor(transaction, actor, roles);
  const reservation = await reserveActorIdempotency(transaction, {
    uid: actor.uid,
    operation,
    idempotencyKey: payload.idempotencyKey,
    payload: payload as unknown as Record<string, unknown>,
  });
  if (reservation.replay) return {replay: replayResult(reservation.replay)};
  const intentId = cardIntentIdFor(actor.uid, payload.idempotencyKey);
  const purchaseRef = purchasesRef(actor.workspaceId).doc(payload.purchaseId);
  const snapshot = await transaction.get(purchaseRef);
  const anchor = await findCardIntentAnchor(
    transaction, intentId, eventOperation);
  if (anchor) {
    if (
      anchor.get("requestHash") !== reservation.requestHash ||
      anchor.get("actorId") !== actor.uid ||
      anchor.get("workspaceId") !== actor.workspaceId ||
      anchor.get("purchaseId") !== payload.purchaseId
    ) {
      throw new ApplicationError("idempotency_conflict",
        IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    return {
      replay: {
        purchaseId: payload.purchaseId,
        cardId: String(anchor.get("cardId")),
        replayed: true,
      },
    };
  }
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", PURCHASE_NOT_FOUND_MESSAGE);
  }
  const purchase = readAuthoritativePurchase(
    snapshot.id, snapshot.data(), actor.workspaceId);
  if (!purchase) {
    throw new ApplicationError("domain_precondition_failed",
      PURCHASE_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
  }
  if (role === "member" && purchase.createdBy !== actor.uid) {
    throw new ApplicationError("workspace_role_denied",
      MEMBER_PURCHASE_OWNERSHIP_MESSAGE);
  }
  assertVersion(purchase.updatedAt, payload.expectedUpdatedAt,
    PURCHASE_CONFLICT_MESSAGE);
  const card = readCardOrFail(
    await transaction.get(cardsRef(actor.workspaceId).doc(purchase.cardId)),
    actor.workspaceId);
  return {
    loaded: {role, reservation, intentId, purchaseRef, purchase, card},
  };
};

type LoadedEntry = AuthoritativeEntry & {
  ref: admin.firestore.DocumentReference;
};

/** Parcelas vigentes da compra (revisão financeira atual), relidas. */
const readActiveInstallments = async (
  transaction: admin.firestore.Transaction,
  purchase: AuthoritativePurchase,
): Promise<LoadedEntry[]> => {
  const refs = Array.from({length: purchase.installmentsCount}, (_, index) =>
    entriesRef(purchase.workspaceId).doc(installmentEntryIdFor(
      purchase.id, purchase.installmentRevision, index + 1)));
  const snapshots = await transaction.getAll(...refs);
  return snapshots.map((snapshot) => {
    const entry = readAuthoritativeEntry(
      snapshot.id, snapshot.data(), purchase.workspaceId);
    if (
      !entry ||
      entry.kind !== "installment" ||
      entry.status !== "active" ||
      entry.purchaseId !== purchase.id ||
      entry.cardId !== purchase.cardId
    ) {
      throw new ApplicationError("domain_precondition_failed",
        PURCHASE_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
    }
    return {...entry, ref: snapshot.ref};
  });
};

const assertActivePurchase = (purchase: AuthoritativePurchase): void => {
  if (purchase.status === "cancelled") {
    throw new ApplicationError("domain_precondition_failed",
      PURCHASE_ALREADY_CANCELLED_MESSAGE);
  }
  if (purchase.status === "refunded") {
    throw new ApplicationError("domain_precondition_failed",
      PURCHASE_ALREADY_REFUNDED_MESSAGE);
  }
};

const bookFor = (
  transaction: admin.firestore.Transaction,
  card: AuthoritativeCard,
  today: string,
) => new InvoiceBook(transaction, {
  workspaceId: card.workspaceId,
  cardId: card.id,
  closingDay: card.closingDay,
  dueDay: card.dueDay,
}, today);

// ------------------------------------------------- cancelamento e estorno

/** Contexto de escrita comum ao cancelamento e ao estorno. */
interface ReversalWriteContext {
  purchaseRef: admin.firestore.DocumentReference;
  purchase: AuthoritativePurchase;
  card: AuthoritativeCard;
  book: InvoiceBook;
  actorUid: string;
  actorRole: WorkspaceRole;
  intentId: string | null;
  requestHash: string;
  operation: string;
  requestId: string;
  correlationId: string | null;
}

/**
 * Cancelamento (todas as parcelas em faturas abertas): parcelas canceladas,
 * faturas recalculadas, compra `cancelled`, limite restituído e evento.
 */
const writeCancellation = (
  transaction: admin.firestore.Transaction,
  context: ReversalWriteContext,
  installments: readonly LoadedEntry[],
): number => {
  const {purchase, card, book} = context;
  let cancelledCents = 0;
  for (const entry of installments) {
    book.applyEntry(entry.competenceMonth, -entry.amountCents, -1);
    transaction.update(entry.ref, entryCancelPatch(context.actorUid));
    cancelledCents += entry.amountCents;
  }
  if (cancelledCents !== purchase.totalCents) {
    throw new ApplicationError("domain_precondition_failed",
      PURCHASE_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
  }
  book.write();
  transaction.update(context.purchaseRef, {
    status: "cancelled",
    cancelledAt: FieldValue.serverTimestamp(),
    cancelledBy: context.actorUid,
    revision: purchase.revision + 1,
    updatedBy: context.actorUid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const limitUsedAfter = postCardLimit(transaction, card, {
    kind: "purchase_cancel",
    amountCents: -cancelledCents,
    sourceKey: `${purchase.id}:cancel`,
    sourceId: purchase.id,
    actorUid: context.actorUid,
    operation: context.operation,
    requestId: context.requestId,
  });
  appendCardEvent(transaction, {
    workspaceId: purchase.workspaceId,
    cardId: card.id,
    operation: "credit_card.purchase_cancelled",
    targetKey: purchase.id,
    actorId: context.actorUid,
    actorRole: context.actorRole,
    intentId: context.intentId,
    requestHash: context.requestHash,
    requestId: context.requestId,
    correlationId: context.correlationId,
    purchaseId: purchase.id,
    amountCents: cancelledCents,
    before: {...purchaseSnapshot(purchase), ...cardLimitSnapshot(card)},
    after: {
      ...purchaseSnapshot({...purchase, status: "cancelled"}),
      ...cardLimitSnapshot({...card, limitUsedCents: limitUsedAfter}),
    },
  });
  return cancelledCents;
};

/**
 * Estorno (já há parcela faturada): parcelas abertas canceladas; o já
 * faturado nunca é reescrito e vira crédito na primeira fatura aberta;
 * compra `refunded`, limite restituído e evento.
 */
const writeRefund = (
  transaction: admin.firestore.Transaction,
  context: ReversalWriteContext,
  split: {open: readonly LoadedEntry[]; billedCents: number;
    target: string},
): void => {
  const {purchase, card, book} = context;
  for (const entry of split.open) {
    book.applyEntry(entry.competenceMonth, -entry.amountCents, -1);
    transaction.update(entry.ref, entryCancelPatch(context.actorUid));
  }
  const refundEntryId = refundEntryIdFor(purchase.id);
  book.applyEntry(split.target, -split.billedCents, 1);
  transaction.create(entriesRef(purchase.workspaceId).doc(refundEntryId),
    entryDocument({
      id: refundEntryId,
      workspaceId: purchase.workspaceId,
      cardId: card.id,
      competenceMonth: split.target,
      kind: "refund_credit",
      amountCents: -split.billedCents,
      purchaseId: purchase.id,
      installmentNumber: null,
      installmentsCount: null,
      naturalCompetence: null,
      requestedCompetence: null,
      sourceInvoiceId: null,
      reason: null,
      actorUid: context.actorUid,
      operation: context.operation,
      requestId: context.requestId,
    }));
  book.write();
  transaction.update(context.purchaseRef, {
    status: "refunded",
    refundedCents: split.billedCents,
    refundEntryId,
    refundCompetence: split.target,
    refundedAt: FieldValue.serverTimestamp(),
    refundedBy: context.actorUid,
    revision: purchase.revision + 1,
    updatedBy: context.actorUid,
    updatedAt: FieldValue.serverTimestamp(),
  });
  const limitUsedAfter = postCardLimit(transaction, card, {
    kind: "purchase_refund",
    amountCents: -purchase.totalCents,
    sourceKey: `${purchase.id}:refund`,
    sourceId: purchase.id,
    actorUid: context.actorUid,
    operation: context.operation,
    requestId: context.requestId,
  });
  appendCardEvent(transaction, {
    workspaceId: purchase.workspaceId,
    cardId: card.id,
    operation: "credit_card.purchase_refunded",
    targetKey: purchase.id,
    actorId: context.actorUid,
    actorRole: context.actorRole,
    intentId: context.intentId,
    requestHash: context.requestHash,
    requestId: context.requestId,
    correlationId: context.correlationId,
    purchaseId: purchase.id,
    entryId: refundEntryId,
    amountCents: split.billedCents,
    before: {...purchaseSnapshot(purchase), ...cardLimitSnapshot(card)},
    after: {
      ...purchaseSnapshot({
        ...purchase,
        status: "refunded",
        refundedCents: split.billedCents,
      }),
      ...cardLimitSnapshot({...card, limitUsedCents: limitUsedAfter}),
      refundCompetence: split.target,
    },
  });
};

/** Separa as parcelas vigentes em faturadas e abertas (fase de leitura). */
const loadRefundSplit = async (
  transaction: admin.firestore.Transaction,
  purchase: AuthoritativePurchase,
  card: AuthoritativeCard,
  installments: readonly LoadedEntry[],
  today: string,
) => {
  const target = firstOpenCompetence(today, card.closingDay);
  const book = bookFor(transaction, card, today);
  await book.load([
    ...installments.map((entry) => entry.competenceMonth),
    target,
  ]);
  const billed = installments.filter((entry) =>
    book.isEffectivelyClosed(entry.competenceMonth));
  const open = installments.filter((entry) =>
    !book.isEffectivelyClosed(entry.competenceMonth));
  const billedCents = billed.reduce((sum, entry) => sum + entry.amountCents,
    0);
  const openCents = open.reduce((sum, entry) => sum + entry.amountCents, 0);
  if (billedCents + openCents !== purchase.totalCents) {
    throw new ApplicationError("domain_precondition_failed",
      PURCHASE_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
  }
  return {book, target, billed, open, billedCents, openCents};
};

/**
 * A compra da Divisão de contas segue o título: só é alterada (descrição e
 * categoria) ou desfeita (anulação) pelas operações do grupo.
 */
const assertNotSplitManaged = (purchase: AuthoritativePurchase): void => {
  if (purchase.source === "split") {
    throw new ApplicationError("domain_precondition_failed",
      PURCHASE_SPLIT_MANAGED_MESSAGE, {ineligible: "split_managed"});
  }
};

export const executeCancelCreditCardPurchase = async (
  actor: WorkspaceActor,
  payload: CancelCreditCardPurchasePayload,
  requestId: string,
  options: CardOperationOptions = {},
): Promise<PurchaseMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadPurchaseForMutation(transaction, actor, payload,
      CANCEL_CREDIT_CARD_PURCHASE_OPERATION, "credit_card.purchase_cancelled",
      CARD_ADMIN_ROLES);
    if ("replay" in outcome) return {...outcome.replay, status: "cancelled"};
    const {loaded} = outcome;
    const {purchase, card} = loaded;
    assertActivePurchase(purchase);
    assertNotSplitManaged(purchase);
    const installments = await readActiveInstallments(transaction, purchase);
    const book = bookFor(transaction, card, todayOf(options));
    await book.load(installments.map((entry) => entry.competenceMonth));
    if (installments.some((entry) =>
      book.isEffectivelyClosed(entry.competenceMonth))) {
      throw new ApplicationError("domain_precondition_failed",
        PURCHASE_HAS_CLOSED_INSTALLMENTS_MESSAGE);
    }
    const rateLimit = await reserveCardRateLimit(transaction, actor);

    const cancelledCents = writeCancellation(transaction, {
      purchaseRef: loaded.purchaseRef,
      purchase,
      card,
      book,
      actorUid: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      operation: CANCEL_CREDIT_CARD_PURCHASE_OPERATION,
      requestId,
      correlationId: payload.correlationId ?? null,
    }, installments);
    const result = {
      purchaseId: purchase.id,
      cardId: card.id,
      status: "cancelled",
      restoredLimitCents: cancelledCents,
    };
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: CANCEL_CREDIT_CARD_PURCHASE_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

export const executeRefundCreditCardPurchase = async (
  actor: WorkspaceActor,
  payload: RefundCreditCardPurchasePayload,
  requestId: string,
  options: CardOperationOptions = {},
): Promise<PurchaseMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadPurchaseForMutation(transaction, actor, payload,
      REFUND_CREDIT_CARD_PURCHASE_OPERATION, "credit_card.purchase_refunded",
      CARD_ADMIN_ROLES);
    if ("replay" in outcome) return {...outcome.replay, status: "refunded"};
    const {loaded} = outcome;
    const {purchase, card} = loaded;
    assertActivePurchase(purchase);
    assertNotSplitManaged(purchase);
    const installments = await readActiveInstallments(transaction, purchase);
    const loadedSplit = await loadRefundSplit(transaction, purchase, card,
      installments, todayOf(options));
    if (loadedSplit.billed.length === 0) {
      throw new ApplicationError("domain_precondition_failed",
        PURCHASE_ALL_OPEN_MESSAGE);
    }
    const rateLimit = await reserveCardRateLimit(transaction, actor);

    writeRefund(transaction, {
      purchaseRef: loaded.purchaseRef,
      purchase,
      card,
      book: loadedSplit.book,
      actorUid: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      operation: REFUND_CREDIT_CARD_PURCHASE_OPERATION,
      requestId,
      correlationId: payload.correlationId ?? null,
    }, loadedSplit);
    const result = {
      purchaseId: purchase.id,
      cardId: card.id,
      status: "refunded",
      refundedCents: loadedSplit.billedCents,
      cancelledOpenCents: loadedSplit.openCents,
      refundCompetence: loadedSplit.target,
    };
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: REFUND_CREDIT_CARD_PURCHASE_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ----------------------------------- reversão server-only (Divisão de contas)

export interface PreparedCardPurchaseReversal {
  mode: "cancel" | "refund";
  purchaseRef: admin.firestore.DocumentReference;
  purchase: AuthoritativePurchase;
  card: AuthoritativeCard;
  book: InvoiceBook;
  installments: LoadedEntry[];
  open: LoadedEntry[];
  billedCents: number;
  openCents: number;
  target: string;
}

/**
 * Fase de leitura da reversão de uma compra gerada pela Divisão de contas
 * (anulação do título, P4-C). Pelas regras de P4-A: com todas as parcelas em
 * faturas abertas, cancelamento; com parcela já faturada, estorno com crédito
 * na primeira fatura aberta (fatura fechada nunca é alterada).
 */
export const prepareCardPurchaseReversal = async (
  transaction: admin.firestore.Transaction,
  input: {
    workspaceId: string;
    purchaseId: string;
    splitGroupId: string;
    splitBillId: string;
    today: string;
  },
): Promise<PreparedCardPurchaseReversal> => {
  const purchaseRef = purchasesRef(input.workspaceId).doc(input.purchaseId);
  const snapshot = await transaction.get(purchaseRef);
  const data = snapshot.data();
  const purchase = readAuthoritativePurchase(snapshot.id, data,
    input.workspaceId);
  if (
    !purchase || purchase.source !== "split" ||
    data?.splitGroupId !== input.splitGroupId ||
    data?.splitBillId !== input.splitBillId
  ) {
    throw new ApplicationError("domain_precondition_failed",
      PURCHASE_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
  }
  assertActivePurchase(purchase);
  const card = readCardOrFail(
    await transaction.get(cardsRef(input.workspaceId).doc(purchase.cardId)),
    input.workspaceId);
  const installments = await readActiveInstallments(transaction, purchase);
  const loadedSplit = await loadRefundSplit(transaction, purchase, card,
    installments, input.today);
  return {
    mode: loadedSplit.billed.length === 0 ? "cancel" : "refund",
    purchaseRef,
    purchase,
    card,
    book: loadedSplit.book,
    installments,
    open: loadedSplit.open,
    billedCents: loadedSplit.billedCents,
    openCents: loadedSplit.openCents,
    target: loadedSplit.target,
  };
};

/** Fase de escrita da reversão preparada, no commit de quem chamou. */
export const commitCardPurchaseReversal = (
  transaction: admin.firestore.Transaction,
  prepared: PreparedCardPurchaseReversal,
  input: {
    actorUid: string;
    actorRole: WorkspaceRole;
    intentId: string;
    requestHash: string;
    operation: string;
    requestId: string;
    correlationId: string | null;
  },
): {mode: "cancel" | "refund"; refundedCents: number;
  cancelledOpenCents: number} => {
  const context: ReversalWriteContext = {
    purchaseRef: prepared.purchaseRef,
    purchase: prepared.purchase,
    card: prepared.card,
    book: prepared.book,
    ...input,
  };
  if (prepared.mode === "cancel") {
    const cancelled = writeCancellation(transaction, context,
      prepared.installments);
    return {mode: "cancel", refundedCents: 0, cancelledOpenCents: cancelled};
  }
  writeRefund(transaction, context, prepared);
  return {
    mode: "refund",
    refundedCents: prepared.billedCents,
    cancelledOpenCents: prepared.openCents,
  };
};

// ------------------------------------------------------------------- edição

const DETAIL_KEYS = ["description", "category", "supplier", "costCenter"] as
  const;

export const executeUpdateCreditCardPurchase = async (
  actor: WorkspaceActor,
  payload: UpdateCreditCardPurchasePayload,
  requestId: string,
  options: CardOperationOptions = {},
): Promise<PurchaseMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadPurchaseForMutation(transaction, actor, payload,
      UPDATE_CREDIT_CARD_PURCHASE_OPERATION, "credit_card.purchase_updated",
      CARD_PURCHASE_ROLES);
    if ("replay" in outcome) return {...outcome.replay, changed: true};
    const {loaded} = outcome;
    const {purchase, card} = loaded;
    if (purchase.status !== "active") {
      throw new ApplicationError("domain_precondition_failed",
        PURCHASE_NOT_EDITABLE_MESSAGE);
    }
    assertNotSplitManaged(purchase);
    const {changes} = payload;
    const detailPatch: Record<string, string | null> = {};
    const changedFields: string[] = [];
    for (const key of DETAIL_KEYS) {
      const value = changes[key];
      if (value === undefined || value === purchase[key]) continue;
      detailPatch[key] = value;
      changedFields.push(key);
    }
    const nextDate = changes.purchaseDate ?? purchase.purchaseDate;
    const nextTotal = changes.totalCents ?? purchase.totalCents;
    const nextCount = changes.installmentsCount ?? purchase.installmentsCount;
    if (nextDate !== purchase.purchaseDate) changedFields.push("purchaseDate");
    if (nextTotal !== purchase.totalCents) changedFields.push("totalCents");
    if (nextCount !== purchase.installmentsCount) {
      changedFields.push("installmentsCount");
    }
    const financial = nextDate !== purchase.purchaseDate ||
      nextTotal !== purchase.totalCents ||
      nextCount !== purchase.installmentsCount;
    if (changedFields.length === 0) {
      throw new ApplicationError("domain_precondition_failed",
        PURCHASE_UNCHANGED_MESSAGE);
    }
    // P4-B: a compra gerada por uma ocorrência de Recorrentes é uma cobrança
    // única ligada àquele vencimento; valor, data e parcelas ficam como
    // gerados (desfazer é cancelar ou estornar).
    if (financial && purchase.source !== "manual") {
      throw new ApplicationError("domain_precondition_failed",
        PURCHASE_GENERATED_FINANCIAL_LOCKED_MESSAGE);
    }

    const today = todayOf(options);
    const book = bookFor(transaction, card, today);
    let current: Awaited<ReturnType<typeof readActiveInstallments>> = [];
    let placements: InstallmentPlacement[] = [];
    const delta = nextTotal - purchase.totalCents;
    if (financial) {
      if (card.status !== "active") {
        throw new ApplicationError("domain_precondition_failed",
          CARD_ARCHIVED_MESSAGE);
      }
      current = await readActiveInstallments(transaction, purchase);
      await book.load(current.map((entry) => entry.competenceMonth));
      if (current.some((entry) =>
        book.isEffectivelyClosed(entry.competenceMonth))) {
        throw new ApplicationError("domain_precondition_failed",
          PURCHASE_FINANCIAL_LOCKED_MESSAGE);
      }
      placements = placementsFor({
        totalCents: nextTotal,
        installmentsCount: nextCount,
        purchaseDate: nextDate,
        card,
        today,
      });
      await book.load(placements.map((placement) =>
        placement.competenceMonth));
      if (delta > card.limitAvailableCents) {
        throw new ApplicationError("domain_precondition_failed",
          PURCHASE_LIMIT_INSUFFICIENT_MESSAGE,
          {availableCents: Math.max(card.limitAvailableCents, 0)});
      }
    }
    const rateLimit = await reserveCardRateLimit(transaction, actor);

    const installmentRevision = financial ?
      purchase.installmentRevision + 1 :
      purchase.installmentRevision;
    let limitUsedAfter = card.limitUsedCents;
    if (financial) {
      for (const entry of current) {
        book.applyEntry(entry.competenceMonth, -entry.amountCents, -1);
        transaction.update(entry.ref, entryCancelPatch(actor.uid));
      }
      writeInstallments(transaction, book, {
        purchaseId: purchase.id,
        revision: installmentRevision,
        placements,
        actorUid: actor.uid,
        operation: UPDATE_CREDIT_CARD_PURCHASE_OPERATION,
        requestId,
      });
      book.write();
      limitUsedAfter = postCardLimit(transaction, card, {
        kind: "purchase_update",
        amountCents: delta,
        sourceKey: `${purchase.id}:update:${installmentRevision}`,
        sourceId: purchase.id,
        actorUid: actor.uid,
        operation: UPDATE_CREDIT_CARD_PURCHASE_OPERATION,
        requestId,
      });
    }
    transaction.update(loaded.purchaseRef, {
      ...detailPatch,
      ...(financial ? {
        purchaseDate: nextDate,
        totalCents: nextTotal,
        installmentsCount: nextCount,
        installmentRevision,
        firstCompetence: placements[0].competenceMonth,
        lastCompetence: placements[placements.length - 1].competenceMonth,
        retroactive: placements.some((placement) =>
          placement.competenceMonth !== placement.naturalCompetence),
      } : {}),
      revision: purchase.revision + 1,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendCardEvent(transaction, {
      workspaceId: actor.workspaceId,
      cardId: card.id,
      operation: "credit_card.purchase_updated",
      targetKey: loaded.intentId,
      actorId: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      purchaseId: purchase.id,
      amountCents: financial ? delta : null,
      before: {...purchaseSnapshot(purchase), ...cardLimitSnapshot(card)},
      after: {
        ...purchaseSnapshot({
          ...purchase,
          totalCents: nextTotal,
          installmentsCount: nextCount,
        }),
        ...cardLimitSnapshot({...card, limitUsedCents: limitUsedAfter}),
      },
      changedFields,
    });
    const result = {
      purchaseId: purchase.id,
      cardId: card.id,
      changed: true,
      financial,
    };
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: UPDATE_CREDIT_CARD_PURCHASE_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });
