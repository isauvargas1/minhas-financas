import * as admin from "firebase-admin";
import {AggregateField, FieldValue} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import {INTERNAL_MESSAGE, INVOICE_INCONSISTENT_MESSAGE} from "./common";
import {
  carryoverEntryIdFor,
  entriesRef,
  entryDocument,
  firstOpenCompetence,
  invoiceCreateDocument,
  invoiceIdFor,
  invoiceStatePatch,
  invoicesRef,
  isCycleEffectivelyClosed,
  isConsistentInvoiceState,
  derivePaymentStatus,
  newInvoiceState,
  readAuthoritativeInvoice,
  type AuthoritativeInvoice,
  type InvoiceFinancialState,
} from "./model";

/**
 * Conjunto de faturas de um cartão tocadas por uma operação.
 *
 * O Firestore exige todas as leituras antes de qualquer escrita na
 * transação; o livro separa as fases: `load` lê (e prepara as faturas que
 * ainda não existem, com as datas do cadastro atual), os métodos de
 * lançamento só alteram o estado em memória e `write` grava cada fatura
 * alterada (criação ou atualização), sempre com os campos derivados juntos.
 */
export interface InvoiceCardContext {
  workspaceId: string;
  cardId: string;
  closingDay: number;
  dueDay: number;
}

export interface InvoiceSlot {
  id: string;
  competenceMonth: string;
  ref: admin.firestore.DocumentReference;
  closingDate: string;
  dueDate: string;
  /** Estado relido (ou o da fatura nova, vazia). */
  before: InvoiceFinancialState;
  /** Estado de trabalho; gravado em `write` se diferente. */
  next: InvoiceFinancialState;
  exists: boolean;
  revision: number;
  /** Campos extras do fechamento. */
  closePatch: admin.firestore.UpdateData<admin.firestore.DocumentData> | null;
  touched: boolean;
}

const stateOf = (invoice: AuthoritativeInvoice): InvoiceFinancialState => ({
  cycleStatus: invoice.cycleStatus,
  totalCents: invoice.totalCents,
  paidCents: invoice.paidCents,
  activeEntryCount: invoice.activeEntryCount,
});

export class InvoiceBook {
  private readonly slots = new Map<string, InvoiceSlot>();

  constructor(
    private readonly transaction: admin.firestore.Transaction,
    readonly card: InvoiceCardContext,
    readonly today: string,
  ) {}

  /** Relê as competências pedidas que ainda não estão no livro. */
  async load(competences: readonly string[]): Promise<void> {
    const missing = Array.from(new Set(competences))
      .filter((competence) => !this.slots.has(competence));
    if (missing.length === 0) return;
    const refs = missing.map((competence) =>
      invoicesRef(this.card.workspaceId)
        .doc(invoiceIdFor(this.card.cardId, competence)));
    const snapshots = await this.transaction.getAll(...refs);
    snapshots.forEach((snapshot, index) => {
      const competence = missing[index];
      if (snapshot.exists) {
        const invoice = readAuthoritativeInvoice(
          snapshot.id, snapshot.data(), this.card.workspaceId);
        if (!invoice || invoice.cardId !== this.card.cardId ||
          invoice.competenceMonth !== competence) {
          throw new ApplicationError("domain_precondition_failed",
            INVOICE_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
        }
        this.slots.set(competence, {
          id: invoice.id,
          competenceMonth: competence,
          ref: snapshot.ref,
          closingDate: invoice.closingDate,
          dueDate: invoice.dueDate,
          before: stateOf(invoice),
          next: stateOf(invoice),
          exists: true,
          revision: invoice.revision,
          closePatch: null,
          touched: false,
        });
        return;
      }
      const base = newInvoiceState({
        workspaceId: this.card.workspaceId,
        cardId: this.card.cardId,
        competenceMonth: competence,
        closingDay: this.card.closingDay,
        dueDay: this.card.dueDay,
      });
      const empty: InvoiceFinancialState = {
        cycleStatus: "open",
        totalCents: 0,
        paidCents: 0,
        activeEntryCount: 0,
      };
      this.slots.set(competence, {
        id: base.id,
        competenceMonth: competence,
        ref: snapshot.ref,
        closingDate: base.closingDate,
        dueDate: base.dueDate,
        before: {...empty},
        next: {...empty},
        exists: false,
        revision: 0,
        closePatch: null,
        touched: false,
      });
    });
  }

  slot(competence: string): InvoiceSlot {
    const slot = this.slots.get(competence);
    if (!slot) throw new ApplicationError("internal", INTERNAL_MESSAGE);
    return slot;
  }

  isEffectivelyClosed(competence: string): boolean {
    const slot = this.slot(competence);
    return isCycleEffectivelyClosed(
      {cycleStatus: slot.next.cycleStatus, closingDate: slot.closingDate},
      this.today);
  }

  /**
   * Garante que a competência aceita lançamento novo: aberta e antes do
   * fechamento. Nenhuma fatura fechada recebe lançamento (D-36); chegar
   * aqui com uma é inconsistência, nunca um caso a contornar.
   */
  assertWritable(competence: string): void {
    if (this.isEffectivelyClosed(competence)) {
      throw new ApplicationError("internal", INTERNAL_MESSAGE);
    }
  }

  /** Soma (ou remove, com sinal) um lançamento ativo na fatura aberta. */
  applyEntry(competence: string, amountCents: number, countDelta: 1 | -1) {
    this.assertWritable(competence);
    const slot = this.slot(competence);
    slot.next = {
      ...slot.next,
      totalCents: slot.next.totalCents + amountCents,
      activeEntryCount: slot.next.activeEntryCount + countDelta,
    };
    slot.touched = true;
  }

  /** Pagamento (positivo) ou estorno (negativo) em fatura fechada. */
  applyPayment(competence: string, amountCents: number): void {
    const slot = this.slot(competence);
    if (slot.next.cycleStatus !== "closed") {
      throw new ApplicationError("internal", INTERNAL_MESSAGE);
    }
    slot.next = {...slot.next, paidCents: slot.next.paidCents + amountCents};
    slot.touched = true;
  }

  touchedSlots(): InvoiceSlot[] {
    return Array.from(this.slots.values()).filter((slot) => slot.touched);
  }

  /** Grava as faturas alteradas; recusa qualquer estado fora do invariante. */
  write(): void {
    for (const slot of this.touchedSlots()) {
      const state = slot.next;
      if (!isConsistentInvoiceState({
        ...state,
        remainingCents: state.totalCents - state.paidCents,
        paymentStatus: derivePaymentStatus(state.totalCents, state.paidCents),
      })) {
        throw new ApplicationError("internal", INVOICE_INCONSISTENT_MESSAGE);
      }
      if (slot.exists) {
        this.transaction.update(slot.ref, {
          ...invoiceStatePatch(state, slot.revision + 1),
          ...(slot.closePatch ?? {}),
        });
      } else {
        const base = newInvoiceState({
          workspaceId: this.card.workspaceId,
          cardId: this.card.cardId,
          competenceMonth: slot.competenceMonth,
          closingDay: this.card.closingDay,
          dueDay: this.card.dueDay,
        });
        this.transaction.create(slot.ref, {
          ...invoiceCreateDocument(base, state),
          ...(slot.closePatch ?? {}),
        });
      }
    }
  }
}

// --------------------------------------------------------------- fechamento

export interface InvoiceClosePlan {
  competence: string;
  invoiceId: string;
  /** Soma relida dos lançamentos ativos, a fonte do total. */
  recomputedTotalCents: number;
  recomputedEntryCount: number;
  /** Diferença entre o total gravado e o relido (esperado: zero). */
  driftCents: number;
  /** Crédito transportado para a primeira fatura aberta, se houver. */
  carryover: {targetCompetence: string; amountCents: number} | null;
}

/**
 * Soma relida dos lançamentos ativos de uma fatura, numa agregação dentro
 * da transação (sem ler os documentos um a um).
 */
export const readInvoiceEntryTotals = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  invoiceId: string,
): Promise<{totalCents: number; count: number}> => {
  const snapshot = await transaction.get(
    entriesRef(workspaceId)
      .where("invoiceId", "==", invoiceId)
      .where("status", "==", "active")
      .aggregate({
        total: AggregateField.sum("amountCents"),
        count: AggregateField.count(),
      }),
  );
  const total = snapshot.data().total ?? 0;
  const count = snapshot.data().count;
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(count)) {
    throw new ApplicationError("internal", INVOICE_INCONSISTENT_MESSAGE);
  }
  return {totalCents: total || 0, count};
};

/**
 * Fase de leitura do fechamento (D-36): a fatura precisa estar aberta e com
 * a data de fechamento alcançada; o total é recalculado da soma dos
 * lançamentos ativos (relida na transação, sem update perdido) e um total
 * negativo — crédito a favor — é transportado para a primeira fatura aberta.
 * Devolve `null` se a fatura não é elegível (já fechada ou antes da data).
 */
export const prepareInvoiceClose = async (
  transaction: admin.firestore.Transaction,
  book: InvoiceBook,
  competence: string,
): Promise<InvoiceClosePlan | null> => {
  const slot = book.slot(competence);
  if (!slot.exists || slot.next.cycleStatus !== "open" ||
    book.today < slot.closingDate) {
    return null;
  }
  if (slot.next.paidCents !== 0) {
    throw new ApplicationError("internal", INVOICE_INCONSISTENT_MESSAGE);
  }
  const totals = await readInvoiceEntryTotals(
    transaction, book.card.workspaceId, slot.id);
  let carryover: InvoiceClosePlan["carryover"] = null;
  if (totals.totalCents < 0) {
    const target = firstOpenCompetence(book.today, book.card.closingDay);
    await book.load([target]);
    book.assertWritable(target);
    carryover = {targetCompetence: target, amountCents: -totals.totalCents};
  }
  return {
    competence,
    invoiceId: slot.id,
    recomputedTotalCents: totals.totalCents,
    recomputedEntryCount: totals.count,
    driftCents: slot.next.totalCents - totals.totalCents,
    carryover,
  };
};

/**
 * Fase de escrita do fechamento: total relido, transporte do crédito (par de
 * lançamentos que soma zero, sem efeito no limite) e ciclo `closed`. O estado
 * do pagamento é o derivado; uma fatura de total zero fecha paga.
 */
export const applyInvoiceClose = (
  transaction: admin.firestore.Transaction,
  book: InvoiceBook,
  plan: InvoiceClosePlan,
  context: {actorUid: string; operation: string; requestId: string},
): void => {
  const slot = book.slot(plan.competence);
  let totalCents = plan.recomputedTotalCents;
  let entryCount = plan.recomputedEntryCount;
  if (plan.carryover) {
    const {targetCompetence, amountCents} = plan.carryover;
    const outId = carryoverEntryIdFor(plan.invoiceId, "out");
    const inId = carryoverEntryIdFor(plan.invoiceId, "in");
    const common = {
      workspaceId: book.card.workspaceId,
      cardId: book.card.cardId,
      purchaseId: null,
      installmentNumber: null,
      installmentsCount: null,
      naturalCompetence: null,
      requestedCompetence: null,
      sourceInvoiceId: plan.invoiceId,
      reason: null,
      actorUid: context.actorUid,
      operation: context.operation,
      requestId: context.requestId,
    };
    transaction.create(entriesRef(book.card.workspaceId).doc(outId),
      entryDocument({
        ...common,
        id: outId,
        competenceMonth: plan.competence,
        kind: "carryover_out",
        amountCents,
      }));
    transaction.create(entriesRef(book.card.workspaceId).doc(inId),
      entryDocument({
        ...common,
        id: inId,
        competenceMonth: targetCompetence,
        kind: "carryover_in",
        amountCents: -amountCents,
      }));
    book.applyEntry(targetCompetence, -amountCents, 1);
    totalCents += amountCents;
    entryCount += 1;
  }
  slot.next = {
    cycleStatus: "closed",
    totalCents,
    paidCents: 0,
    activeEntryCount: entryCount,
  };
  slot.closePatch = {
    closedAt: FieldValue.serverTimestamp(),
    closedBy: context.actorUid,
    carryoverOutCents: plan.carryover?.amountCents ?? 0,
  };
  slot.touched = true;
};
