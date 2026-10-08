import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {
  postAccountMovements,
  readPostedMovement,
  readPostingAccounts,
  reversalOfMovement,
} from "../accounts/ledger";
import {creditCardPaymentAccountMovementIdFor} from "../accounts/model";
import {ApplicationError} from "../shared/errors";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
} from "../shared/idempotency";
import {
  reassertWorkspaceActor,
  workspaceRef,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import {cardPaymentCashMirrorDocument} from "./cashEffect";
import {
  CARD_ADMIN_ROLES,
  CARD_ARCHIVED_MESSAGE,
  CARD_INCONSISTENT_MESSAGE,
  CARD_NOT_FOUND_MESSAGE,
  IDEMPOTENCY_CONFLICT_MESSAGE,
  INTERNAL_MESSAGE,
  INVOICE_CONFLICT_MESSAGE,
  INVOICE_INCONSISTENT_MESSAGE,
  INVOICE_NOT_FOUND_MESSAGE,
  LIMIT_INSUFFICIENT_MESSAGE,
  assertVersion,
  findCardIntentAnchor,
  formatBrl,
  profileTypeOf,
  reserveCardRateLimit,
  todayOf,
  type CardOperationOptions,
} from "./common";
import type {
  CreateCreditCardInvoiceAdjustmentPayload,
  RegisterInvoicePaymentPayload,
  ReverseInvoicePaymentPayload,
} from "./contracts";
import {
  InvoiceBook,
  applyInvoiceClose,
  prepareInvoiceClose,
  type InvoiceClosePlan,
} from "./invoices";
import {postCardLimit} from "./limit";
import {
  CARD_MAX_INSTALLMENTS,
  adjustmentEntryIdFor,
  appendCardEvent,
  cardIntentIdFor,
  cardLimitSnapshot,
  cardsRef,
  entriesRef,
  entryDocument,
  firstOpenCompetence,
  invoiceIdFor,
  invoiceSnapshot,
  invoicesRef,
  monthsBetween,
  paymentCashTransactionIdFor,
  paymentDocument,
  paymentIdFor,
  paymentReversalIdFor,
  paymentsRef,
  readAuthoritativeCard,
  readAuthoritativeInvoice,
  readAuthoritativePayment,
  type AuthoritativeCard,
  type AuthoritativeInvoice,
  type InvoiceFinancialState,
} from "./model";

/**
 * Faturas: pagamento, estorno de pagamento e ajuste manual (P4-A, D-36).
 *
 * - Pagamento: só de fatura com o ciclo fechado (inclusive antes do
 *   vencimento); fatura aberta não aceita pagamento. Parcial permitido, nunca
 *   acima do saldo. Exige a conta de origem (D-30): no mesmo commit gravam
 *   pagamento, fatura, livro do limite, movimento da conta, espelho de caixa
 *   (liquidação do cartão, nunca despesa operacional), evento e idempotência.
 *   Se a data de fechamento já chegou e o fechamento automático ainda não
 *   rodou, a própria operação fecha a fatura antes de pagar.
 * - Estorno de pagamento: compensação na mesma conta do pagamento (o
 *   cliente não a escolhe), fatura restaurada, limite consumido de novo; o
 *   pagamento original nunca é apagado nem editado (só recebe o vínculo
 *   `reversedBy`).
 * - Ajuste manual: owner/admin, valor com sinal e motivo. Em competência
 *   fechada, a compensação vai para a primeira fatura aberta. Nunca deixa o
 *   saldo do cartão negativo nem o limite disponível negativo. Não é
 *   pagamento.
 */
export const REGISTER_INVOICE_PAYMENT_OPERATION = "registerInvoicePayment";
export const REVERSE_INVOICE_PAYMENT_OPERATION = "reverseInvoicePayment";
export const CREATE_INVOICE_ADJUSTMENT_OPERATION =
  "createCreditCardInvoiceAdjustment";

export const INVOICE_OPEN_PAYMENT_MESSAGE =
  "A fatura ainda está aberta: o pagamento só é aceito depois do fechamento.";
export const INVOICE_NOTHING_TO_PAY_MESSAGE =
  "Esta fatura não tem saldo a pagar.";
export const PAYMENT_FUTURE_DATE_MESSAGE =
  "Data do pagamento: não pode ser futura.";
export const PAYMENT_NOT_FOUND_MESSAGE = "Pagamento não encontrado.";
export const PAYMENT_INCONSISTENT_MESSAGE =
  "Este pagamento tem dados inconsistentes e não pode ser estornado.";
export const PAYMENT_NOT_REVERSIBLE_MESSAGE =
  "Somente pagamentos podem ser estornados.";
export const PAYMENT_ALREADY_REVERSED_MESSAGE =
  "Este pagamento já foi estornado.";
export const PAYMENT_REVERSAL_LIMIT_MESSAGE =
  "O estorno deixaria o limite disponível do cartão negativo. Libere limite " +
  "antes de estornar este pagamento.";
export const ADJUSTMENT_COMPETENCE_TOO_FAR_MESSAGE =
  "Competência do ajuste: muito distante da fatura atual.";

const db = () => admin.firestore();

export interface InvoiceMutationResult {
  cardId: string;
  invoiceId: string;
  replayed: boolean;
  [key: string]: unknown;
}

const replayResult = (
  stored: Record<string, unknown>,
): InvoiceMutationResult => {
  if (typeof stored.cardId !== "string" ||
    typeof stored.invoiceId !== "string") {
    throw new ApplicationError("internal", INTERNAL_MESSAGE);
  }
  return {...(stored as InvoiceMutationResult), replayed: true};
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

const readInvoiceOrFail = (
  snapshot: admin.firestore.DocumentSnapshot,
  workspaceId: string,
  cardId: string,
): AuthoritativeInvoice => {
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", INVOICE_NOT_FOUND_MESSAGE);
  }
  const invoice = readAuthoritativeInvoice(
    snapshot.id, snapshot.data(), workspaceId);
  if (!invoice) {
    throw new ApplicationError("domain_precondition_failed",
      INVOICE_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
  }
  if (invoice.cardId !== cardId) {
    throw new ApplicationError("not_found", INVOICE_NOT_FOUND_MESSAGE);
  }
  return invoice;
};

const formatDayKey = (dayKey: string): string =>
  `${dayKey.slice(8, 10)}/${dayKey.slice(5, 7)}/${dayKey.slice(0, 4)}`;

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

/** Evento do fechamento feito dentro de uma operação (ou pela rotina). */
export const appendInvoiceClosedEvent = (
  transaction: admin.firestore.Transaction,
  input: {
    book: InvoiceBook;
    plan: InvoiceClosePlan;
    before: InvoiceFinancialState;
    after: InvoiceFinancialState;
    actorId: string;
    actorRole: WorkspaceActor["role"] | null;
    requestId: string;
  },
): void => {
  appendCardEvent(transaction, {
    workspaceId: input.book.card.workspaceId,
    cardId: input.book.card.cardId,
    operation: "credit_card.invoice_closed",
    // Uma fatura fecha uma única vez: o ID deriva da própria fatura.
    targetKey: input.plan.invoiceId,
    actorId: input.actorId,
    actorRole: input.actorRole,
    intentId: null,
    requestHash: null,
    requestId: input.requestId,
    correlationId: null,
    invoiceId: input.plan.invoiceId,
    amountCents: input.after.totalCents,
    before: invoiceSnapshot(input.before),
    after: {
      ...invoiceSnapshot(input.after),
      driftCents: input.plan.driftCents,
      carryoverOutCents: input.plan.carryover?.amountCents ?? 0,
      carryoverCompetence: input.plan.carryover?.targetCompetence ?? null,
    },
  });
};

// ---------------------------------------------------------------- pagamento

export const executeRegisterInvoicePayment = async (
  actor: WorkspaceActor,
  payload: RegisterInvoicePaymentPayload,
  requestId: string,
  options: CardOperationOptions = {},
): Promise<InvoiceMutationResult> =>
  db().runTransaction(async (transaction) => {
    const {workspace, role} = await reassertWorkspaceActor(
      transaction, actor, CARD_ADMIN_ROLES);
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: REGISTER_INVOICE_PAYMENT_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload: payload as unknown as Record<string, unknown>,
    });
    if (reservation.replay) return replayResult(reservation.replay);

    const paymentId = paymentIdFor(actor.workspaceId, actor.uid,
      payload.idempotencyKey);
    const intentId = cardIntentIdFor(actor.uid, payload.idempotencyKey);
    const paymentRef = paymentsRef(actor.workspaceId).doc(paymentId);
    const [paymentSnapshot, cardSnapshot, invoiceSnapshotDoc] =
      await transaction.getAll(
        paymentRef,
        cardsRef(actor.workspaceId).doc(payload.cardId),
        invoicesRef(actor.workspaceId).doc(payload.invoiceId),
      );
    if (paymentSnapshot.exists) {
      // Âncora durável: o próprio pagamento no ID `(workspace, ator, chave)`.
      if (
        paymentSnapshot.get("requestHash") === reservation.requestHash &&
        paymentSnapshot.get("createdBy") === actor.uid
      ) {
        return {
          paymentId,
          cardId: String(paymentSnapshot.get("cardId")),
          invoiceId: String(paymentSnapshot.get("invoiceId")),
          replayed: true,
        };
      }
      throw new ApplicationError("idempotency_conflict",
        IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    const card = readCardOrFail(cardSnapshot, actor.workspaceId);
    const invoice = readInvoiceOrFail(invoiceSnapshotDoc, actor.workspaceId,
      card.id);
    assertVersion(invoice.updatedAt, payload.expectedUpdatedAt,
      INVOICE_CONFLICT_MESSAGE);
    const today = todayOf(options);
    const book = bookFor(transaction, card, today);
    await book.load([invoice.competenceMonth]);
    if (!book.isEffectivelyClosed(invoice.competenceMonth)) {
      throw new ApplicationError("domain_precondition_failed",
        INVOICE_OPEN_PAYMENT_MESSAGE);
    }
    // Fechamento tardio: a data chegou e a rotina ainda não fechou.
    const closePlan = invoice.cycleStatus === "open" ?
      await prepareInvoiceClose(transaction, book, invoice.competenceMonth) :
      null;
    if (invoice.cycleStatus === "open" && !closePlan) {
      throw new ApplicationError("internal", INTERNAL_MESSAGE);
    }
    if (payload.paymentDate > today) {
      throw new ApplicationError("domain_precondition_failed",
        PAYMENT_FUTURE_DATE_MESSAGE);
    }
    if (payload.paymentDate < invoice.closingDate) {
      throw new ApplicationError("domain_precondition_failed",
        "Data do pagamento: não pode ser anterior ao fechamento da fatura " +
        `(${formatDayKey(invoice.closingDate)}).`);
    }
    const remainingCents = closePlan ?
      Math.max(closePlan.recomputedTotalCents, 0) :
      invoice.remainingCents;
    if (remainingCents <= 0) {
      throw new ApplicationError("domain_precondition_failed",
        INVOICE_NOTHING_TO_PAY_MESSAGE);
    }
    if (payload.amountCents > remainingCents) {
      throw new ApplicationError("domain_precondition_failed",
        "O valor do pagamento é maior que o saldo da fatura " +
        `(${formatBrl(remainingCents)}).`);
    }
    const accounts = await readPostingAccounts(transaction, actor.workspaceId,
      [payload.cashAccountId]);
    const rateLimit = await reserveCardRateLimit(transaction, actor);

    const slot = book.slot(invoice.competenceMonth);
    const before = {...slot.before};
    if (closePlan) {
      applyInvoiceClose(transaction, book, closePlan, {
        actorUid: actor.uid,
        operation: REGISTER_INVOICE_PAYMENT_OPERATION,
        requestId,
      });
      appendInvoiceClosedEvent(transaction, {
        book,
        plan: closePlan,
        before,
        after: {...slot.next},
        actorId: actor.uid,
        actorRole: role,
        requestId,
      });
    }
    const closed = {...slot.next};
    book.applyPayment(invoice.competenceMonth, payload.amountCents);
    book.write();

    const accountMovementId = creditCardPaymentAccountMovementIdFor(paymentId);
    const cashTransactionId = paymentCashTransactionIdFor(paymentId);
    postAccountMovements(transaction, accounts, [{
      id: accountMovementId,
      accountId: payload.cashAccountId,
      kind: "credit_card_payment",
      amountCents: -payload.amountCents,
      effectiveDate: payload.paymentDate,
      sourceDomain: "credit_card",
      sourceId: invoice.id,
      sourceFactId: paymentId,
      reversalOf: null,
    }], {
      workspaceId: actor.workspaceId,
      actorUid: actor.uid,
      operation: REGISTER_INVOICE_PAYMENT_OPERATION,
      requestId,
    });
    transaction.create(
      workspaceRef(actor.workspaceId).collection("transactions")
        .doc(cashTransactionId),
      cardPaymentCashMirrorDocument({
        workspaceId: actor.workspaceId,
        profileType: profileTypeOf(workspace),
        actorUid: actor.uid,
        date: payload.paymentDate,
        cashAccountId: payload.cashAccountId,
        entry: {
          domainVersion: 1,
          cardId: card.id,
          invoiceId: invoice.id,
          paymentId,
          kind: "invoice_payment",
          reversal: false,
          amountCents: payload.amountCents,
          currency: "BRL",
        },
      }),
    );
    transaction.create(paymentRef, paymentDocument({
      id: paymentId,
      workspaceId: actor.workspaceId,
      cardId: card.id,
      invoiceId: invoice.id,
      competenceMonth: invoice.competenceMonth,
      kind: "payment",
      amountCents: payload.amountCents,
      paymentDate: payload.paymentDate,
      cashAccountId: payload.cashAccountId,
      accountMovementId,
      cashTransactionId,
      reversalOf: null,
      actorUid: actor.uid,
      intentId,
      requestHash: reservation.requestHash,
      requestId,
    }));
    const limitUsedAfter = postCardLimit(transaction, card, {
      kind: "payment",
      amountCents: -payload.amountCents,
      sourceKey: `${paymentId}:payment`,
      sourceId: paymentId,
      actorUid: actor.uid,
      operation: REGISTER_INVOICE_PAYMENT_OPERATION,
      requestId,
    });
    appendCardEvent(transaction, {
      workspaceId: actor.workspaceId,
      cardId: card.id,
      operation: "credit_card.payment_registered",
      targetKey: paymentId,
      actorId: actor.uid,
      actorRole: role,
      intentId,
      requestHash: reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      invoiceId: invoice.id,
      paymentId,
      amountCents: payload.amountCents,
      before: {...invoiceSnapshot(closed), ...cardLimitSnapshot(card)},
      after: {
        ...invoiceSnapshot(slot.next),
        ...cardLimitSnapshot({...card, limitUsedCents: limitUsedAfter}),
      },
    });
    const result = {
      paymentId,
      cardId: card.id,
      invoiceId: invoice.id,
      cashTransactionId,
      accountMovementId,
      paymentStatus: invoiceSnapshot(slot.next).paymentStatus,
      remainingCents: slot.next.totalCents - slot.next.paidCents,
    };
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: REGISTER_INVOICE_PAYMENT_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// ---------------------------------------------------- estorno de pagamento

export const executeReverseInvoicePayment = async (
  actor: WorkspaceActor,
  payload: ReverseInvoicePaymentPayload,
  requestId: string,
  options: CardOperationOptions = {},
): Promise<InvoiceMutationResult> =>
  db().runTransaction(async (transaction) => {
    const {workspace, role} = await reassertWorkspaceActor(
      transaction, actor, CARD_ADMIN_ROLES);
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: REVERSE_INVOICE_PAYMENT_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload: payload as unknown as Record<string, unknown>,
    });
    if (reservation.replay) return replayResult(reservation.replay);
    const intentId = cardIntentIdFor(actor.uid, payload.idempotencyKey);
    const paymentRef = paymentsRef(actor.workspaceId).doc(payload.paymentId);
    const paymentSnapshot = await transaction.get(paymentRef);
    const anchor = await findCardIntentAnchor(
      transaction, intentId, "credit_card.payment_reversed");
    if (anchor) {
      if (
        anchor.get("requestHash") !== reservation.requestHash ||
        anchor.get("actorId") !== actor.uid ||
        anchor.get("workspaceId") !== actor.workspaceId ||
        anchor.get("paymentId") !== payload.paymentId
      ) {
        throw new ApplicationError("idempotency_conflict",
          IDEMPOTENCY_CONFLICT_MESSAGE);
      }
      return {
        paymentId: paymentReversalIdFor(payload.paymentId),
        reversedPaymentId: payload.paymentId,
        cardId: String(anchor.get("cardId")),
        invoiceId: String(anchor.get("invoiceId")),
        replayed: true,
      };
    }
    if (!paymentSnapshot.exists) {
      throw new ApplicationError("not_found", PAYMENT_NOT_FOUND_MESSAGE);
    }
    const payment = readAuthoritativePayment(
      paymentSnapshot.id, paymentSnapshot.data(), actor.workspaceId);
    if (!payment) {
      throw new ApplicationError("domain_precondition_failed",
        PAYMENT_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
    }
    if (payment.kind !== "payment") {
      throw new ApplicationError("domain_precondition_failed",
        PAYMENT_NOT_REVERSIBLE_MESSAGE);
    }
    if (payment.reversedBy !== null) {
      throw new ApplicationError("domain_precondition_failed",
        PAYMENT_ALREADY_REVERSED_MESSAGE);
    }
    const [cardSnapshot, invoiceSnapshotDoc] = await transaction.getAll(
      cardsRef(actor.workspaceId).doc(payment.cardId),
      invoicesRef(actor.workspaceId).doc(payment.invoiceId),
    );
    const card = readCardOrFail(cardSnapshot, actor.workspaceId);
    const invoice = readInvoiceOrFail(invoiceSnapshotDoc, actor.workspaceId,
      card.id);
    assertVersion(invoice.updatedAt, payload.expectedUpdatedAt,
      INVOICE_CONFLICT_MESSAGE);
    if (invoice.cycleStatus !== "closed" ||
      invoice.paidCents < payment.amountCents) {
      throw new ApplicationError("domain_precondition_failed",
        INVOICE_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
    }
    // A conta é a do pagamento original (D-30); o cliente não a escolhe.
    const accountMovement = await readPostedMovement(transaction,
      actor.workspaceId, payment.accountMovementId,
      {accountId: payment.cashAccountId, sourceId: invoice.id});
    if (
      accountMovement.amountCents !== -payment.amountCents ||
      accountMovement.sourceFactId !== payment.id
    ) {
      throw new ApplicationError("internal", INTERNAL_MESSAGE);
    }
    const accounts = await readPostingAccounts(transaction, actor.workspaceId,
      [accountMovement.accountId]);
    if (payment.amountCents > card.limitAvailableCents) {
      throw new ApplicationError("domain_precondition_failed",
        PAYMENT_REVERSAL_LIMIT_MESSAGE);
    }
    const book = bookFor(transaction, card, todayOf(options));
    await book.load([invoice.competenceMonth]);
    const rateLimit = await reserveCardRateLimit(transaction, actor);

    const slot = book.slot(invoice.competenceMonth);
    book.applyPayment(invoice.competenceMonth, -payment.amountCents);
    book.write();
    const reversalId = paymentReversalIdFor(payment.id);
    const reversalMovementId =
      creditCardPaymentAccountMovementIdFor(reversalId);
    const cashTransactionId = paymentCashTransactionIdFor(reversalId);
    postAccountMovements(transaction, accounts, [reversalOfMovement(
      accountMovement, reversalMovementId, reversalId)], {
      workspaceId: actor.workspaceId,
      actorUid: actor.uid,
      operation: REVERSE_INVOICE_PAYMENT_OPERATION,
      requestId,
    });
    // O estorno corrige o fato: mesmo dia civil do pagamento, para que o mês
    // do pagamento some zero na projeção.
    transaction.create(
      workspaceRef(actor.workspaceId).collection("transactions")
        .doc(cashTransactionId),
      cardPaymentCashMirrorDocument({
        workspaceId: actor.workspaceId,
        profileType: profileTypeOf(workspace),
        actorUid: actor.uid,
        date: payment.paymentDate,
        cashAccountId: payment.cashAccountId,
        entry: {
          domainVersion: 1,
          cardId: card.id,
          invoiceId: invoice.id,
          paymentId: reversalId,
          kind: "invoice_payment",
          reversal: true,
          amountCents: payment.amountCents,
          currency: "BRL",
          reversalOf: payment.id,
        },
      }),
    );
    transaction.create(paymentsRef(actor.workspaceId).doc(reversalId),
      paymentDocument({
        id: reversalId,
        workspaceId: actor.workspaceId,
        cardId: card.id,
        invoiceId: invoice.id,
        competenceMonth: invoice.competenceMonth,
        kind: "reversal",
        amountCents: payment.amountCents,
        paymentDate: payment.paymentDate,
        cashAccountId: payment.cashAccountId,
        accountMovementId: reversalMovementId,
        cashTransactionId,
        reversalOf: payment.id,
        actorUid: actor.uid,
        intentId,
        requestHash: reservation.requestHash,
        requestId,
      }));
    transaction.update(paymentRef, {
      reversedBy: reversalId,
      reversedAt: FieldValue.serverTimestamp(),
    });
    const limitUsedAfter = postCardLimit(transaction, card, {
      kind: "payment_reversal",
      amountCents: payment.amountCents,
      sourceKey: `${payment.id}:reversal`,
      sourceId: reversalId,
      actorUid: actor.uid,
      operation: REVERSE_INVOICE_PAYMENT_OPERATION,
      requestId,
    });
    appendCardEvent(transaction, {
      workspaceId: actor.workspaceId,
      cardId: card.id,
      operation: "credit_card.payment_reversed",
      targetKey: payment.id,
      actorId: actor.uid,
      actorRole: role,
      intentId,
      requestHash: reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      invoiceId: invoice.id,
      paymentId: payment.id,
      amountCents: payment.amountCents,
      before: {...invoiceSnapshot(slot.before), ...cardLimitSnapshot(card)},
      after: {
        ...invoiceSnapshot(slot.next),
        ...cardLimitSnapshot({...card, limitUsedCents: limitUsedAfter}),
      },
    });
    const result = {
      paymentId: reversalId,
      reversedPaymentId: payment.id,
      cardId: card.id,
      invoiceId: invoice.id,
      cashTransactionId,
      paymentStatus: invoiceSnapshot(slot.next).paymentStatus,
      remainingCents: slot.next.totalCents - slot.next.paidCents,
    };
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: REVERSE_INVOICE_PAYMENT_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });

// -------------------------------------------------------------- ajuste manual

export const executeCreateInvoiceAdjustment = async (
  actor: WorkspaceActor,
  payload: CreateCreditCardInvoiceAdjustmentPayload,
  requestId: string,
  options: CardOperationOptions = {},
): Promise<InvoiceMutationResult> =>
  db().runTransaction(async (transaction) => {
    const {role} = await reassertWorkspaceActor(
      transaction, actor, CARD_ADMIN_ROLES);
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: CREATE_INVOICE_ADJUSTMENT_OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload: payload as unknown as Record<string, unknown>,
    });
    if (reservation.replay) return replayResult(reservation.replay);
    const entryId = adjustmentEntryIdFor(actor.workspaceId, actor.uid,
      payload.idempotencyKey);
    const intentId = cardIntentIdFor(actor.uid, payload.idempotencyKey);
    const entryRef = entriesRef(actor.workspaceId).doc(entryId);
    const [entrySnapshot, cardSnapshot] = await transaction.getAll(
      entryRef, cardsRef(actor.workspaceId).doc(payload.cardId));
    if (entrySnapshot.exists) {
      // Âncora durável: o próprio lançamento no ID `(workspace, ator, chave)`.
      if (
        entrySnapshot.get("requestHash") === reservation.requestHash &&
        entrySnapshot.get("createdBy") === actor.uid
      ) {
        return {
          entryId,
          cardId: String(entrySnapshot.get("cardId")),
          invoiceId: String(entrySnapshot.get("invoiceId")),
          replayed: true,
        };
      }
      throw new ApplicationError("idempotency_conflict",
        IDEMPOTENCY_CONFLICT_MESSAGE);
    }
    const card = readCardOrFail(cardSnapshot, actor.workspaceId);
    if (card.status !== "active") {
      throw new ApplicationError("domain_precondition_failed",
        CARD_ARCHIVED_MESSAGE);
    }
    const today = todayOf(options);
    const firstOpen = firstOpenCompetence(today, card.closingDay);
    if (monthsBetween(firstOpen, payload.competenceMonth) >
      CARD_MAX_INSTALLMENTS) {
      throw new ApplicationError("domain_precondition_failed",
        ADJUSTMENT_COMPETENCE_TOO_FAR_MESSAGE);
    }
    const book = bookFor(transaction, card, today);
    await book.load([payload.competenceMonth, firstOpen]);
    // Fatura fechada nunca é reescrita: a compensação vai para a primeira
    // fatura aberta, com a competência pedida registrada no lançamento.
    const compensated = book.isEffectivelyClosed(payload.competenceMonth);
    const target = compensated ? firstOpen : payload.competenceMonth;
    if (payload.amountCents > 0 &&
      payload.amountCents > card.limitAvailableCents) {
      throw new ApplicationError("domain_precondition_failed",
        LIMIT_INSUFFICIENT_MESSAGE,
        {availableCents: Math.max(card.limitAvailableCents, 0)});
    }
    if (payload.amountCents < 0 &&
      card.limitUsedCents + payload.amountCents < 0) {
      throw new ApplicationError("domain_precondition_failed",
        "O ajuste deixaria o saldo do cartão negativo (saldo atual: " +
        `${formatBrl(Math.max(card.limitUsedCents, 0))}).`);
    }
    const rateLimit = await reserveCardRateLimit(transaction, actor);

    const slot = book.slot(target);
    book.applyEntry(target, payload.amountCents, 1);
    book.write();
    transaction.create(entryRef, {
      ...entryDocument({
        id: entryId,
        workspaceId: actor.workspaceId,
        cardId: card.id,
        competenceMonth: target,
        kind: "adjustment",
        amountCents: payload.amountCents,
        purchaseId: null,
        installmentNumber: null,
        installmentsCount: null,
        naturalCompetence: null,
        requestedCompetence: payload.competenceMonth,
        sourceInvoiceId: null,
        reason: payload.reason,
        actorUid: actor.uid,
        operation: CREATE_INVOICE_ADJUSTMENT_OPERATION,
        requestId,
      }),
      intentId,
      requestHash: reservation.requestHash,
    });
    const limitUsedAfter = postCardLimit(transaction, card, {
      kind: "adjustment",
      amountCents: payload.amountCents,
      sourceKey: `${entryId}:adjustment`,
      sourceId: entryId,
      actorUid: actor.uid,
      operation: CREATE_INVOICE_ADJUSTMENT_OPERATION,
      requestId,
    });
    const invoiceId = invoiceIdFor(card.id, target);
    appendCardEvent(transaction, {
      workspaceId: actor.workspaceId,
      cardId: card.id,
      operation: "credit_card.adjustment_created",
      targetKey: entryId,
      actorId: actor.uid,
      actorRole: role,
      intentId,
      requestHash: reservation.requestHash,
      requestId,
      correlationId: payload.correlationId ?? null,
      invoiceId,
      entryId,
      amountCents: payload.amountCents,
      before: {...invoiceSnapshot(slot.before), ...cardLimitSnapshot(card)},
      after: {
        ...invoiceSnapshot(slot.next),
        ...cardLimitSnapshot({...card, limitUsedCents: limitUsedAfter}),
        requestedCompetence: payload.competenceMonth,
        competenceMonth: target,
        compensated: compensated ? 1 : 0,
      },
    });
    const result = {
      entryId,
      cardId: card.id,
      invoiceId,
      competenceMonth: target,
      compensated,
    };
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: CREATE_INVOICE_ADJUSTMENT_OPERATION,
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    rateLimit.commit();
    options.beforeCommit?.();
    return {...result, replayed: false};
  });
