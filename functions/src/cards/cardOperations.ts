import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
} from "../shared/idempotency";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import {
  CARD_ADMIN_ROLES,
  CARD_CONFLICT_MESSAGE,
  CARD_INCONSISTENT_MESSAGE,
  CARD_NOT_FOUND_MESSAGE,
  IDEMPOTENCY_CONFLICT_MESSAGE,
  INTERNAL_MESSAGE,
  assertVersion,
  findCardIntentAnchor,
  formatBrl,
  reserveCardRateLimit,
  todayOf,
  type CardOperationOptions,
} from "./common";
import type {
  ArchiveCreditCardPayload,
  CardMutationResult,
  CardVisualInput,
  CreateCreditCardPayload,
  ReactivateCreditCardPayload,
  UpdateCreditCardPayload,
} from "./contracts";
import {
  CARD_LIMIT_PER_WORKSPACE,
  appendCardEvent,
  cardDocument,
  cardIdFor,
  cardIntentIdFor,
  cardLimitSnapshot,
  cardsRef,
  closingDateOf,
  dueDateOf,
  invoicesRef,
  readAuthoritativeCard,
  readAuthoritativeInvoice,
  type AuthoritativeCard,
  type CardEventOperation,
  type CardProfile,
  type CardVisual,
} from "./model";

/**
 * Cadastro e ciclo de vida do cartão (P4-A).
 *
 * Só owner e admin; tudo numa transação que relê a autorização, reserva a
 * idempotência, confere a âncora durável da intenção, relê o cartão e a
 * versão informada pelo cliente e grava cartão, evento, idempotência e
 * limite operacional no mesmo commit. Não existe exclusão: o cartão é
 * arquivado (e pode ser reativado); arquivado continua visível no histórico
 * e não aceita compra nova.
 */
export const CREATE_CREDIT_CARD_OPERATION = "createCreditCard";
export const UPDATE_CREDIT_CARD_OPERATION = "updateCreditCard";
export const ARCHIVE_CREDIT_CARD_OPERATION = "archiveCreditCard";
export const REACTIVATE_CREDIT_CARD_OPERATION = "reactivateCreditCard";

export const CARD_LIMIT_PER_WORKSPACE_MESSAGE =
  `Este espaço de trabalho já tem o máximo de ${CARD_LIMIT_PER_WORKSPACE} ` +
  "cartões (ativos e arquivados).";
export const CARD_UNCHANGED_MESSAGE = "Nenhuma alteração para salvar.";
export const CARD_ALREADY_ARCHIVED_MESSAGE = "Este cartão já está arquivado.";
export const CARD_ALREADY_ACTIVE_MESSAGE = "Este cartão já está ativo.";
export const CARD_CYCLE_LOCKED_MESSAGE =
  "Não é possível alterar o dia de fechamento ou de vencimento enquanto " +
  "houver faturas abertas com lançamentos. Aguarde o fechamento ou estorne " +
  "as compras dessas faturas.";
export const CARD_ARCHIVE_OPEN_ENTRIES_MESSAGE =
  "Não é possível arquivar: há compras com parcelas em faturas abertas ou " +
  "futuras.";
export const CARD_ARCHIVE_UNPAID_MESSAGE =
  "Não é possível arquivar: há fatura fechada com saldo a pagar.";

/** Faturas abertas lidas para as checagens de ciclo (teto por cartão). */
const OPEN_INVOICE_SCAN_LIMIT = 100;

const db = () => admin.firestore();

const replayResult = (stored: Record<string, unknown>): CardMutationResult => {
  if (typeof stored.cardId !== "string") {
    throw new ApplicationError("internal", INTERNAL_MESSAGE);
  }
  return {...(stored as CardMutationResult), replayed: true};
};

const visualOf = (input: CardVisualInput): CardVisual => ({
  bgType: input.bgType,
  bgColor: input.bgColor,
  bgGradientColor: input.bgGradientColor ?? null,
  bgImage: input.bgImage ?? null,
  textColor: input.textColor,
  showName: input.showName,
  showBrand: input.showBrand,
  showLogo: input.showLogo,
});

/** Texto opcional: vazio vale `null` (o contrato normaliza; aqui reforça). */
const optionalText = (value: string | null | undefined): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const OPTIONAL_TEXT_KEYS = new Set<string>([
  "observations",
  "responsiblePerson",
  "recommendedUse",
  "defaultCostCenter",
]);

const profileOf = (payload: CreateCreditCardPayload): CardProfile => ({
  name: payload.name,
  brand: payload.brand,
  closingDay: payload.closingDay,
  dueDay: payload.dueDay,
  bestDay: payload.bestDay ?? null,
  observations: optionalText(payload.observations),
  responsiblePerson: optionalText(payload.responsiblePerson),
  recommendedUse: optionalText(payload.recommendedUse),
  defaultCostCenter: optionalText(payload.defaultCostCenter),
  visual: visualOf(payload.visual),
});

// ------------------------------------------------------------------ criação

export const executeCreateCreditCard = async (
  actor: WorkspaceActor,
  payload: CreateCreditCardPayload,
  requestId: string,
  options: CardOperationOptions = {},
): Promise<CardMutationResult> =>
  db().runTransaction(async (transaction) => {
    const {role} = await reassertWorkspaceActor(
      transaction, actor, CARD_ADMIN_ROLES);
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: CREATE_CREDIT_CARD_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload: payload as unknown as Record<string, unknown>,
    });
    if (reservation.replay) return replayResult(reservation.replay);

    const cardId = cardIdFor(actor.workspaceId, actor.uid,
      payload.idempotencyKey);
    const intentId = cardIntentIdFor(actor.uid, payload.idempotencyKey);
    const ref = cardsRef(actor.workspaceId).doc(cardId);
    const existing = await transaction.get(ref);
    if (existing.exists) {
      // Âncora durável: o próprio cartão no ID `(workspace, ator, chave)`.
      if (
        existing.get("requestHash") === reservation.requestHash &&
        existing.get("createdBy") === actor.uid
      ) {
        return {cardId, replayed: true};
      }
      throw new ApplicationError("idempotency_conflict",
        IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    const count = (await transaction.get(
      cardsRef(actor.workspaceId).count())).data().count;
    if (count >= CARD_LIMIT_PER_WORKSPACE) {
      throw new ApplicationError("domain_precondition_failed",
        CARD_LIMIT_PER_WORKSPACE_MESSAGE);
    }
    const rateLimit = await reserveCardRateLimit(transaction, actor);

    transaction.create(ref, cardDocument({
      id: cardId,
      workspaceId: actor.workspaceId,
      profile: profileOf(payload),
      limitTotalCents: payload.limitTotalCents,
      actorUid: actor.uid,
      intentId,
      requestHash: reservation.requestHash,
    }));
    appendCardEvent(transaction, {
      workspaceId: actor.workspaceId,
      cardId,
      operation: "credit_card.created",
      targetKey: cardId,
      actorId: actor.uid,
      actorRole: role,
      intentId,
      requestHash: reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      before: null,
      after: {
        ...cardLimitSnapshot({
          status: "active",
          limitTotalCents: payload.limitTotalCents,
          limitUsedCents: 0,
        }),
        closingDay: payload.closingDay,
        dueDay: payload.dueDay,
      },
    });
    const result = {cardId};
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: CREATE_CREDIT_CARD_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ---------------------------------------------------- carregamento comum

interface LoadedCard {
  role: WorkspaceActor["role"];
  reservation: Awaited<ReturnType<typeof reserveActorIdempotency>>;
  intentId: string;
  ref: admin.firestore.DocumentReference;
  card: AuthoritativeCard;
}

const loadCardForMutation = async (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  payload: {
    cardId: string;
    idempotencyKey: string;
    expectedUpdatedAt: string;
  },
  operation: string,
  eventOperation: CardEventOperation,
): Promise<{replay: CardMutationResult} | {loaded: LoadedCard}> => {
  const {role} = await reassertWorkspaceActor(
    transaction, actor, CARD_ADMIN_ROLES);
  const reservation = await reserveActorIdempotency(transaction, {
    uid: actor.uid,
    operation,
    idempotencyKey: payload.idempotencyKey,
    payload: payload as unknown as Record<string, unknown>,
  });
  if (reservation.replay) return {replay: replayResult(reservation.replay)};
  const intentId = cardIntentIdFor(actor.uid, payload.idempotencyKey);
  const ref = cardsRef(actor.workspaceId).doc(payload.cardId);
  const snapshot = await transaction.get(ref);
  const anchor = await findCardIntentAnchor(
    transaction, intentId, eventOperation);
  if (anchor) {
    if (
      anchor.get("requestHash") !== reservation.requestHash ||
      anchor.get("actorId") !== actor.uid ||
      anchor.get("workspaceId") !== actor.workspaceId ||
      anchor.get("cardId") !== payload.cardId
    ) {
      throw new ApplicationError("idempotency_conflict",
        IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    return {replay: {cardId: payload.cardId, replayed: true}};
  }
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", CARD_NOT_FOUND_MESSAGE);
  }
  const card = readAuthoritativeCard(
    snapshot.id, snapshot.data(), actor.workspaceId);
  if (!card) {
    throw new ApplicationError("domain_precondition_failed",
      CARD_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
  }
  assertVersion(card.updatedAt, payload.expectedUpdatedAt,
    CARD_CONFLICT_MESSAGE);
  return {loaded: {role, reservation, intentId, ref, card}};
};

/** Faturas abertas do cartão (para as checagens de ciclo e arquivamento). */
const readOpenInvoices = async (
  transaction: admin.firestore.Transaction,
  card: AuthoritativeCard,
) => {
  const snapshot = await transaction.get(
    invoicesRef(card.workspaceId)
      .where("cardId", "==", card.id)
      .where("cycleStatus", "==", "open")
      .limit(OPEN_INVOICE_SCAN_LIMIT),
  );
  return snapshot.docs.map((doc) => {
    const invoice = readAuthoritativeInvoice(
      doc.id, doc.data(), card.workspaceId);
    if (!invoice) {
      throw new ApplicationError("domain_precondition_failed",
        CARD_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
    }
    return {ref: doc.ref, invoice};
  });
};

// ------------------------------------------------------------------- edição

const PROFILE_KEYS = [
  "name",
  "brand",
  "closingDay",
  "dueDay",
  "bestDay",
  "observations",
  "responsiblePerson",
  "recommendedUse",
  "defaultCostCenter",
  "visual",
] as const;

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

export const executeUpdateCreditCard = async (
  actor: WorkspaceActor,
  payload: UpdateCreditCardPayload,
  requestId: string,
  options: CardOperationOptions = {},
): Promise<CardMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadCardForMutation(transaction, actor, payload,
      UPDATE_CREDIT_CARD_OPERATION, "credit_card.updated");
    if ("replay" in outcome) return {...outcome.replay, changed: true};
    const {loaded} = outcome;
    const {card} = loaded;

    const patch: Record<string, unknown> = {};
    const changedFields: string[] = [];
    for (const key of PROFILE_KEYS) {
      const raw = payload.changes[key];
      if (raw === undefined) continue;
      const value = key === "visual" ?
        visualOf(raw as CardVisualInput) :
        OPTIONAL_TEXT_KEYS.has(key) ?
          optionalText(raw as string | null) :
          raw;
      if (!sameValue(value, card[key])) {
        patch[key] = value;
        changedFields.push(key);
      }
    }
    const nextLimitTotal = payload.changes.limitTotalCents;
    const limitChanged = nextLimitTotal !== undefined &&
      nextLimitTotal !== card.limitTotalCents;
    if (limitChanged) changedFields.push("limitTotalCents");
    if (changedFields.length === 0) {
      throw new ApplicationError("domain_precondition_failed",
        CARD_UNCHANGED_MESSAGE);
    }
    if (limitChanged && (nextLimitTotal as number) < card.limitUsedCents) {
      throw new ApplicationError("domain_precondition_failed",
        "O limite total não pode ficar abaixo do limite já utilizado " +
        `(${formatBrl(card.limitUsedCents)}).`);
    }

    // Fechamento/vencimento: as faturas abertas guardam as datas calculadas
    // na criação. Com lançamento, mudar as datas reescreveria a fatura que o
    // usuário já vê; sem lançamento, as vazias passam às datas novas.
    const closingDay = (patch.closingDay as number | undefined) ??
      card.closingDay;
    const dueDay = (patch.dueDay as number | undefined) ?? card.dueDay;
    const cycleChanged = closingDay !== card.closingDay ||
      dueDay !== card.dueDay;
    const openInvoices = cycleChanged ?
      await readOpenInvoices(transaction, card) :
      [];
    if (openInvoices.some(({invoice}) =>
      invoice.activeEntryCount > 0 || invoice.totalCents !== 0)) {
      throw new ApplicationError("domain_precondition_failed",
        CARD_CYCLE_LOCKED_MESSAGE);
    }
    const rateLimit = await reserveCardRateLimit(transaction, actor);

    const revision = card.revision + 1;
    transaction.update(loaded.ref, {
      ...patch,
      ...(limitChanged ? {
        limitTotalCents: nextLimitTotal,
        limitAvailableCents: (nextLimitTotal as number) - card.limitUsedCents,
        limitUpdatedAt: FieldValue.serverTimestamp(),
      } : {}),
      revision,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const {ref, invoice} of openInvoices) {
      transaction.update(ref, {
        closingDate: closingDateOf(invoice.competenceMonth, closingDay),
        dueDate: dueDateOf(invoice.competenceMonth, closingDay, dueDay),
        revision: invoice.revision + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    const limitAfter = limitChanged ? nextLimitTotal as number :
      card.limitTotalCents;
    appendCardEvent(transaction, {
      workspaceId: actor.workspaceId,
      cardId: card.id,
      operation: "credit_card.updated",
      targetKey: loaded.intentId,
      actorId: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      before: {...cardLimitSnapshot(card), closingDay: card.closingDay,
        dueDay: card.dueDay},
      after: {
        ...cardLimitSnapshot({...card, limitTotalCents: limitAfter}),
        closingDay,
        dueDay,
      },
      changedFields,
    });
    const result = {cardId: card.id, changed: true};
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: UPDATE_CREDIT_CARD_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ------------------------------------------------------------ arquivamento

export const executeArchiveCreditCard = async (
  actor: WorkspaceActor,
  payload: ArchiveCreditCardPayload,
  requestId: string,
  options: CardOperationOptions = {},
): Promise<CardMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadCardForMutation(transaction, actor, payload,
      ARCHIVE_CREDIT_CARD_OPERATION, "credit_card.archived");
    if ("replay" in outcome) {
      return {...outcome.replay, status: "archived"};
    }
    const {loaded} = outcome;
    const {card} = loaded;
    if (card.status === "archived") {
      throw new ApplicationError("domain_precondition_failed",
        CARD_ALREADY_ARCHIVED_MESSAGE);
    }
    if (card.limitUsedCents > 0) {
      throw new ApplicationError("domain_precondition_failed",
        "Não é possível arquivar: o cartão tem saldo devedor de " +
        `${formatBrl(card.limitUsedCents)}. Quite as faturas antes.`);
    }
    if (card.limitUsedCents < 0) {
      throw new ApplicationError("domain_precondition_failed",
        "Não é possível arquivar: o cartão tem crédito a favor de " +
        `${formatBrl(-card.limitUsedCents)} ainda não utilizado.`);
    }
    const openInvoices = await readOpenInvoices(transaction, card);
    if (openInvoices.some(({invoice}) => invoice.activeEntryCount > 0)) {
      throw new ApplicationError("domain_precondition_failed",
        CARD_ARCHIVE_OPEN_ENTRIES_MESSAGE);
    }
    const unpaid = await transaction.get(
      invoicesRef(card.workspaceId)
        .where("cardId", "==", card.id)
        .where("cycleStatus", "==", "closed")
        .where("paymentStatus", "in", ["unpaid", "partial"])
        .limit(1),
    );
    if (!unpaid.empty) {
      throw new ApplicationError("domain_precondition_failed",
        CARD_ARCHIVE_UNPAID_MESSAGE);
    }
    const rateLimit = await reserveCardRateLimit(transaction, actor);
    const revision = card.revision + 1;
    transaction.update(loaded.ref, {
      status: "archived",
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: actor.uid,
      archivedOn: todayOf(options),
      revision,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendCardEvent(transaction, {
      workspaceId: actor.workspaceId,
      cardId: card.id,
      operation: "credit_card.archived",
      targetKey: loaded.intentId,
      actorId: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      before: cardLimitSnapshot(card),
      after: cardLimitSnapshot({...card, status: "archived"}),
    });
    const result = {cardId: card.id, status: "archived"};
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: ARCHIVE_CREDIT_CARD_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

export const executeReactivateCreditCard = async (
  actor: WorkspaceActor,
  payload: ReactivateCreditCardPayload,
  requestId: string,
  options: CardOperationOptions = {},
): Promise<CardMutationResult> =>
  db().runTransaction(async (transaction) => {
    const outcome = await loadCardForMutation(transaction, actor, payload,
      REACTIVATE_CREDIT_CARD_OPERATION, "credit_card.reactivated");
    if ("replay" in outcome) return {...outcome.replay, status: "active"};
    const {loaded} = outcome;
    const {card} = loaded;
    if (card.status === "active") {
      throw new ApplicationError("domain_precondition_failed",
        CARD_ALREADY_ACTIVE_MESSAGE);
    }
    const rateLimit = await reserveCardRateLimit(transaction, actor);
    transaction.update(loaded.ref, {
      status: "active",
      archivedAt: null,
      archivedBy: null,
      archivedOn: null,
      revision: card.revision + 1,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendCardEvent(transaction, {
      workspaceId: actor.workspaceId,
      cardId: card.id,
      operation: "credit_card.reactivated",
      targetKey: loaded.intentId,
      actorId: actor.uid,
      actorRole: loaded.role,
      intentId: loaded.intentId,
      requestHash: loaded.reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      before: cardLimitSnapshot(card),
      after: cardLimitSnapshot({...card, status: "active"}),
    });
    const result = {cardId: card.id, status: "active"};
    completeActorIdempotency(transaction, loaded.reservation, {
      uid: actor.uid,
      operation: REACTIVATE_CREDIT_CARD_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });
