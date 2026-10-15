import * as admin from "firebase-admin";
import {AggregateField, FieldPath} from "firebase-admin/firestore";

import {
  CARD_INVOICES_COLLECTION,
  CARD_LIMIT_PER_WORKSPACE,
  CARD_PAYMENTS_COLLECTION,
  CARD_PURCHASES_COLLECTION,
  CREDIT_CARDS_COLLECTION,
  isCycleEffectivelyClosed,
  readAuthoritativeCard,
  readAuthoritativeInvoice,
  type AuthoritativeCard,
  type AuthoritativeInvoice,
} from "../cards/model";
import {addDaysToDayKey} from "../shared/dateKeys";
import {addExact, ratioBasisPoints, subtractExact} from "./formulas";
import type {
  CardInvoiceRef,
  CardItem,
  CardsReport,
  ReportSectionResult,
} from "./contract";
import type {WindowMonth} from "./window";

/**
 * Cartões no relatório (P5-C1, D-37.3), duas visões que nunca se somam:
 *
 * - **consumo/obrigações**: compras pela data da compra (líquidas de
 *   estorno), faturas abertas (ciclo corrente e parcelas futuras), fechadas
 *   a pagar, vencidas (fechada + saldo + vencimento antes de hoje, nunca
 *   gravado), parcialmente pagas e a vencer em 7/15/30 dias;
 * - **caixa**: pagamentos de fatura na janela (saída de caixa, nunca segunda
 *   despesa).
 *
 * Tudo por agregações do servidor (`sum`/`count`, que leem entradas de
 * índice) e consultas limitadas por construção — nenhuma lista truncada é
 * apresentada como o futuro inteiro. Limite de cartão nunca entra em saldo.
 *
 * Por cartão (P5-C1.1), cada fatura com saldo pendente cai em uma classe só:
 * **atraso** (fechada, vencimento antes de hoje — `isInvoiceOverdue` da
 * P4-A), **fatura atual** (entre as demais, a de menor vencimento e
 * competência: a fechada aguardando pagamento ou, sem ela, a aberta com
 * saldo de menor vencimento — o ciclo corrente ou, se ele não tiver saldo,
 * a primeira seguinte com saldo, como uma parcela) e **futuro** (as outras).
 * Atraso + atual + futuro = saldo pendente do cartão, e Σ dos cartões = os
 * agregados de obrigações do bloco: lista de cartões, obrigações e classes
 * lidas numa só transação somente leitura (instantâneo único). Todo cartão é
 * classificado; o arquivado entra na lista por cartão só com saldo pendente
 * (a P4-A aceita estornar pagamento de cartão arquivado).
 */

const db = () => admin.firestore();

const OPEN_STATUSES = ["unpaid", "partial"];

/** Meses máximos da série de compras por mês. */
export const MAX_PURCHASE_SERIES_MONTHS = 36;

/**
 * Faturas que vencem em 31 dias (hoje + 30): no máximo três por cartão. O
 * vencimento é mensal (datas distintas a 28 dias ou mais), mas no mês curto
 * duas competências podem vencer no mesmo dia — fechamento 28 e vencimento
 * 31: fevereiro e março vencem em 31/03 e abril em 30/04 (`dueDateOf`) —,
 * então o teto cobre todos os cartões por construção.
 */
export const DUE_WINDOW_LIMIT = 3 * CARD_LIMIT_PER_WORKSPACE;

const collection = (workspaceId: string, name: string) =>
  db().collection(`workspaces/${workspaceId}/${name}`);

const sumAndCount = (field: string) => ({
  sum: AggregateField.sum(field),
  count: AggregateField.count(),
});

const safeSum = (
  data: {sum: number | null; count: number},
  field: string,
): {sum: number; count: number} => {
  const sum = Number(data.sum ?? 0);
  if (!Number.isSafeInteger(sum)) {
    throw new Error(`soma fora da faixa segura: ${field}`);
  }
  return {sum: sum || 0, count: data.count ?? 0};
};

const sumOf = async (
  query: admin.firestore.Query,
  field: string,
): Promise<{sum: number; count: number}> =>
  safeSum((await query.aggregate(sumAndCount(field)).get()).data(), field);

/** Mesma agregação, lida dentro da transação (instantâneo do bloco). */
const sumIn = async (
  transaction: admin.firestore.Transaction,
  query: admin.firestore.Query,
  field: string,
): Promise<{sum: number; count: number}> => safeSum(
  (await transaction.get(query.aggregate(sumAndCount(field)))).data(), field);

/**
 * Compras da visão de consumo (D-37.3), já líquidas de estorno: o estorno
 * muda a compra para `refunded` (`cards/purchaseOperations.ts`) e as
 * consultas só leem `status == "active"`, cujo `refundedCents` é sempre 0.
 * Uma agregação (soma + contagem) sobre o índice `(filtros…, totalCents)`.
 */
const purchaseNet = async (
  query: admin.firestore.Query,
): Promise<{netCents: number; count: number}> => {
  const total = await sumOf(query, "totalCents");
  return {netCents: total.sum, count: total.count};
};

interface DueInvoice {
  cardId: string;
  dueDate: string;
  remainingCents: number;
}

/** Classes do saldo pendente de um cartão (atraso + atual + futuro). */
interface CardClassification {
  outstandingCents: number;
  overdueCents: number;
  current: AuthoritativeInvoice | null;
  futureCents: number;
  /**
   * Crédito ainda não transportado (M3): Σ de `-totalCents` das faturas
   * abertas com total negativo. A P4-A o leva para a fatura aberta seguinte
   * no fechamento; até lá não abate nada e fica fora das classes.
   */
  openCreditCents: number;
}

/** Próxima obrigação: menor vencimento; no empate, competência mais antiga. */
const isEarlier = (
  left: AuthoritativeInvoice,
  right: AuthoritativeInvoice,
): boolean => left.dueDate < right.dueDate ||
  (left.dueDate === right.dueDate &&
    left.competenceMonth < right.competenceMonth);

/**
 * Classifica o saldo pendente de um cartão dentro de uma transação somente
 * leitura (instantâneo único): pendente, atraso e as duas candidatas à
 * fatura atual — a fechada ainda não vencida e a aberta, cada uma a de menor
 * (vencimento, competência). A aberta cujo fechamento já chegou antes da
 * rotina é candidata como fatura atual (a P4-A a trata como fechada e
 * pagável, nunca como vencida). `null` quando um documento está fora do
 * schema ou os componentes não fecham com o pendente.
 */
const classifyCard = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  cardId: string,
  today: string,
): Promise<CardClassification | "invalid" | "parity"> => {
  const pending = collection(workspaceId, CARD_INVOICES_COLLECTION)
    .where("cardId", "==", cardId)
    .where("paymentStatus", "in", OPEN_STATUSES);
  const remainingOf = async (query: admin.firestore.Query) =>
    (await sumIn(transaction, query, "remainingCents")).sum;
  const nextOf = (query: admin.firestore.Query) => transaction.get(
    query.orderBy("dueDate").orderBy("competenceMonth").limit(1));
  const [outstandingCents, overdueCents, nextClosed, nextOpen, credit] =
    await Promise.all([
      remainingOf(pending),
      remainingOf(pending.where("cycleStatus", "==", "closed")
        .where("dueDate", "<", today)),
      nextOf(pending.where("cycleStatus", "==", "closed")
        .where("dueDate", ">=", today)),
      nextOf(pending.where("cycleStatus", "==", "open")),
      sumIn(transaction, collection(workspaceId, CARD_INVOICES_COLLECTION)
        .where("cardId", "==", cardId)
        .where("cycleStatus", "==", "open")
        .where("totalCents", "<", 0), "totalCents"),
    ]);
  let current: AuthoritativeInvoice | null = null;
  for (const doc of [...nextClosed.docs, ...nextOpen.docs]) {
    const invoice = readAuthoritativeInvoice(doc.id, doc.data(), workspaceId);
    if (!invoice) return "invalid";
    if (!current || isEarlier(invoice, current)) current = invoice;
  }
  const notOverdueCents = subtractExact(outstandingCents, overdueCents);
  const futureCents =
    subtractExact(notOverdueCents, current?.remainingCents ?? 0);
  if (notOverdueCents < 0 || futureCents < 0 ||
    (current === null && notOverdueCents !== 0) || credit.sum > 0) {
    return "parity";
  }
  return {outstandingCents, overdueCents, current, futureCents,
    openCreditCents: -credit.sum || 0};
};

export const readCardsSection = async (input: {
  workspaceId: string;
  today: string;
  startDate: string | null;
  endDate: string;
  months: readonly WindowMonth[];
}): Promise<ReportSectionResult<CardsReport>> => {
  const {workspaceId, today} = input;
  const invoices = collection(workspaceId, CARD_INVOICES_COLLECTION);
  const purchases = collection(workspaceId, CARD_PURCHASES_COLLECTION);
  const payments = collection(workspaceId, CARD_PAYMENTS_COLLECTION);
  const withBalance = invoices.where("paymentStatus", "in", OPEN_STATUSES);
  const in7 = addDaysToDayKey(today, 7);
  const in15 = addDaysToDayKey(today, 15);
  const in30 = addDaysToDayKey(today, 30);
  const hasWindow = input.startDate !== null;
  const start = input.startDate ?? input.endDate;

  // Lista de cartões, obrigações e classes de cada cartão no mesmo
  // instantâneo: Σ das classes por cartão confere com os agregados do bloco.
  const readObligations = db().runTransaction(async (transaction) => {
    const cardsSnapshot = await transaction.get(
      collection(workspaceId, CREDIT_CARDS_COLLECTION)
        .limit(CARD_LIMIT_PER_WORKSPACE + 1));
    if (cardsSnapshot.size > CARD_LIMIT_PER_WORKSPACE) {
      return "card_limit_exceeded" as const;
    }
    const cards: AuthoritativeCard[] = [];
    for (const doc of cardsSnapshot.docs) {
      const card = readAuthoritativeCard(doc.id, doc.data(), workspaceId);
      if (!card) return "card_document_invalid" as const;
      cards.push(card);
    }
    const [openCycles, closedUnpaid, overdue, partial, dueSoon, classified] =
      await Promise.all([
        sumIn(transaction, withBalance.where("cycleStatus", "==", "open"),
          "remainingCents"),
        sumIn(transaction, withBalance.where("cycleStatus", "==", "closed"),
          "remainingCents"),
        sumIn(transaction, withBalance.where("cycleStatus", "==", "closed")
          .where("dueDate", "<", today), "remainingCents"),
        sumIn(transaction, invoices.where("paymentStatus", "==", "partial"),
          "remainingCents"),
        transaction.get(withBalance.where("dueDate", ">=", today)
          .where("dueDate", "<=", in30)
          .orderBy("dueDate").orderBy(FieldPath.documentId())
          .limit(DUE_WINDOW_LIMIT + 1)),
        Promise.all(cards.map((card) =>
          classifyCard(transaction, workspaceId, card.id, today))),
      ]);
    return {cards, openCycles, closedUnpaid, overdue, partial, dueSoon,
      classified};
  }, {readOnly: true});

  const [read, purchasesTotal, paid, reversed] = await Promise.all([
    readObligations,
    hasWindow ?
      purchaseNet(purchases.where("status", "==", "active")
        .where("purchaseDate", ">=", start)
        .where("purchaseDate", "<=", input.endDate)) :
      Promise.resolve({netCents: 0, count: 0}),
    hasWindow ?
      sumOf(payments.where("kind", "==", "payment")
        .where("paymentDate", ">=", start)
        .where("paymentDate", "<=", input.endDate), "amountCents") :
      Promise.resolve({sum: 0, count: 0}),
    hasWindow ?
      sumOf(payments.where("kind", "==", "reversal")
        .where("paymentDate", ">=", start)
        .where("paymentDate", "<=", input.endDate), "amountCents") :
      Promise.resolve({sum: 0, count: 0}),
  ]);
  if (typeof read === "string") {
    return {status: "unavailable", reason: read, data: null};
  }
  const {cards, openCycles, closedUnpaid, overdue, partial, dueSoon} = read;
  if (dueSoon.size > DUE_WINDOW_LIMIT) {
    return {status: "unavailable", reason: "due_window_exceeded", data: null};
  }
  const due: DueInvoice[] = [];
  for (const doc of dueSoon.docs) {
    const invoice = readAuthoritativeInvoice(doc.id, doc.data(), workspaceId);
    if (!invoice) {
      return {status: "unavailable", reason: "invoice_document_invalid",
        data: null};
    }
    due.push({
      cardId: invoice.cardId,
      dueDate: invoice.dueDate,
      remainingCents: invoice.remainingCents,
    });
  }
  const dueBetween = (cardId: string | null, end: string): number =>
    due.filter((invoice) =>
      (cardId === null || invoice.cardId === cardId) && invoice.dueDate <= end)
      .reduce((sum, invoice) => addExact(sum, invoice.remainingCents), 0);

  if (read.classified.includes("invalid")) {
    return {status: "unavailable", reason: "invoice_document_invalid",
      data: null};
  }
  if (read.classified.includes("parity")) {
    return {status: "unavailable", reason: "invoice_classification_parity",
      data: null};
  }
  const classified = read.classified as CardClassification[];
  // Paridade do bloco: Σ pendente e Σ atraso dos cartões = agregados. Falha
  // com fatura de cartão inexistente ou fora dos ciclos (dado inconsistente).
  const totalOf = (pick: (classes: CardClassification) => number) =>
    classified.reduce((sum, classes) => addExact(sum, pick(classes)), 0);
  const totalOutstandingCents = addExact(openCycles.sum, closedUnpaid.sum);
  if (totalOf((classes) => classes.outstandingCents) !==
    totalOutstandingCents ||
    totalOf((classes) => classes.overdueCents) !== overdue.sum) {
    return {status: "unavailable", reason: "invoice_classification_parity",
      data: null};
  }
  const active = cards.filter((card) => card.status === "active");
  // Por cartão: os ativos e os arquivados com saldo pendente.
  const listed = cards
    .map((card, index) => ({card, classes: classified[index]}))
    .filter(({card, classes}) =>
      card.status === "active" || classes.outstandingCents > 0);

  const perCard = await Promise.all(listed.map(async ({card, classes}) => {
    const [cardPurchases, cardPaid, cardReversed] = await Promise.all([
      hasWindow ?
        purchaseNet(purchases.where("cardId", "==", card.id)
          .where("status", "==", "active")
          .where("purchaseDate", ">=", start)
          .where("purchaseDate", "<=", input.endDate)) :
        Promise.resolve({netCents: 0, count: 0}),
      hasWindow ?
        sumOf(payments.where("cardId", "==", card.id)
          .where("kind", "==", "payment")
          .where("paymentDate", ">=", start)
          .where("paymentDate", "<=", input.endDate), "amountCents") :
        Promise.resolve({sum: 0, count: 0}),
      hasWindow ?
        sumOf(payments.where("cardId", "==", card.id)
          .where("kind", "==", "reversal")
          .where("paymentDate", ">=", start)
          .where("paymentDate", "<=", input.endDate), "amountCents") :
        Promise.resolve({sum: 0, count: 0}),
    ]);
    const currentInvoice = classes.current;
    const ref: CardInvoiceRef | null = currentInvoice ? {
      invoiceId: currentInvoice.id,
      competenceMonth: currentInvoice.competenceMonth,
      dueDate: currentInvoice.dueDate,
      cycleStatus: currentInvoice.cycleStatus,
      paymentStatus: currentInvoice.paymentStatus,
      payableCents: currentInvoice.remainingCents,
      effectivelyClosed: isCycleEffectivelyClosed(currentInvoice, today),
    } : null;
    const item: CardItem = {
      cardId: card.id,
      name: card.name,
      status: card.status,
      limitTotalCents: card.limitTotalCents,
      limitUsedCents: card.limitUsedCents,
      limitAvailableCents: card.limitAvailableCents,
      // Arquivado: limite fora de uso, sem utilização.
      utilizationBasisPoints: card.status === "active" ?
        ratioBasisPoints(card.limitUsedCents, card.limitTotalCents) :
        null,
      currentInvoice: ref,
      outstandingCents: classes.outstandingCents,
      futureCommittedCents: classes.futureCents,
      overdueCents: classes.overdueCents,
      openCreditCents: classes.openCreditCents,
      dueNext7Cents: dueBetween(card.id, in7),
      dueNext15Cents: dueBetween(card.id, in15),
      dueNext30Cents: dueBetween(card.id, in30),
      purchasesCents: cardPurchases.netCents,
      purchaseCount: cardPurchases.count,
      paidCents: cardPaid.sum,
      reversedCents: cardReversed.sum,
    };
    return item;
  }));

  const seriesMonths = input.months.slice(-MAX_PURCHASE_SERIES_MONTHS);
  const purchaseSeries = await Promise.all(seriesMonths.map(async (slice) => {
    const net = await purchaseNet(purchases.where("status", "==", "active")
      .where("purchaseDate", ">=", slice.startDate)
      .where("purchaseDate", "<=", slice.endDate));
    return {month: slice.month, netCents: net.netCents, count: net.count};
  }));

  const limitTotals = active.reduce((sum, card) => ({
    totalCents: addExact(sum.totalCents, card.limitTotalCents),
    usedCents: addExact(sum.usedCents, card.limitUsedCents),
    availableCents: addExact(sum.availableCents, card.limitAvailableCents),
  }), {totalCents: 0, usedCents: 0, availableCents: 0});
  const limits: CardsReport["limits"] = {
    ...limitTotals,
    utilizationBasisPoints:
      ratioBasisPoints(limitTotals.usedCents, limitTotals.totalCents),
  };

  const data: CardsReport = {
    purchases: {netCents: purchasesTotal.netCents, count: purchasesTotal.count},
    payments: {
      paidCents: paid.sum,
      reversedCents: reversed.sum,
      netCents: subtractExact(paid.sum, reversed.sum),
    },
    obligations: {
      openCyclesCents: openCycles.sum,
      closedUnpaidCents: closedUnpaid.sum,
      overdueCents: overdue.sum,
      overdueCount: overdue.count,
      partiallyPaidCount: partial.count,
      partiallyPaidRemainingCents: partial.sum,
      dueNext7Cents: dueBetween(null, in7),
      dueNext15Cents: dueBetween(null, in15),
      dueNext30Cents: dueBetween(null, in30),
      totalOutstandingCents,
      openCreditCents: totalOf((classes) => classes.openCreditCents),
    },
    limits,
    cards: perCard,
    purchaseSeries,
    purchaseSeriesStartMonth:
      seriesMonths.length < input.months.length ?
        seriesMonths[0]?.month ?? null :
        null,
  };
  const empty = cards.length === 0 &&
    data.obligations.totalOutstandingCents === 0 &&
    data.purchases.count === 0 && paid.count === 0 && reversed.count === 0;
  return {status: empty ? "zero" : "exact", data};
};
