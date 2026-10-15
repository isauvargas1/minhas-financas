import assert from "node:assert/strict";
import test from "node:test";

import {runCreditCardInvoiceClosing} from "../../cards/closing";
import {executeArchiveCreditCard} from "../../cards/cardOperations";
import {executeReverseInvoicePayment} from "../../cards/invoiceOperations";
import {
  dueDateOf,
  isCycleEffectivelyClosed,
  isInvoiceOverdue,
  readAuthoritativeInvoice,
  type AuthoritativeInvoice,
} from "../../cards/model";
import {executeRefundCreditCardPurchase} from "../../cards/purchaseOperations";
import {
  actorOf as cardActorOf,
  buy,
  cardVersion,
  clockAt,
  createCard,
  idempotencyKey,
  invoiceVersion,
  invoicesOf,
  pay,
  purchaseVersion,
  readCard,
  readInvoice,
  requestId,
} from "../../cards/testSupport/cardTestSupport";
import {saoPauloDayKey} from "../../shared/dateKeys";
import {db} from "../../workspaces/testSupport/p1TestSupport";
import type {CardItem, CardsReport} from "../contract";
import {executeGetFinancialReport} from "../report";
import {
  actorOf,
  exact,
  seedReportTenant,
  type ReportTenant,
} from "./reportSupport";

/**
 * P5-C1.1 — classificação das faturas do relatório de cartões, no Emulator,
 * pelas operações reais de cartões (compra, fechamento, pagamento, estorno,
 * arquivamento). Datas fixas: o "hoje" do relatório é o instante informado
 * (dia civil de São Paulo), nunca o relógio da máquina.
 *
 * Contrato: cada fatura com saldo pendente (unpaid|partial) cai em uma
 * classe só — atraso (fechada e vencimento antes de hoje), fatura atual (a de
 * menor vencimento e competência entre as demais) ou futuro (o resto) — e
 * atraso + atual + futuro = saldo pendente do cartão.
 *
 * Calendário-base dos cenários (fechamento dia 25, vencimento dia 5):
 * compra em 10/01 → competência 2026-01, fecha 25/01, vence 05/02; compra em
 * 01/03 → competência 2026-03, fecha 25/03, vence 05/04.
 */

db();

/** Meio-dia em São Paulo (15:00Z) do dia informado. */
const noon = (dayKey: string): Date => new Date(`${dayKey}T15:00:00.000Z`);

/**
 * Oráculo independente (P4-A): relê todas as faturas do workspace e refaz as
 * classes fatura a fatura com `isInvoiceOverdue` — atraso; entre as demais
 * pendentes, a de menor (vencimento, competência) é a atual; o resto é
 * futuro — e confere com o relatório. Todo cartão com saldo pendente tem de
 * estar na lista por cartão (inclusive o arquivado).
 */
const assertMatchesDomain = async (
  t: ReportTenant,
  data: CardsReport,
  today: string,
): Promise<void> => {
  const snapshot = await db()
    .collection(`workspaces/${t.workspaceId}/credit_card_invoices`).get();
  const pendingByCard = new Map<string, AuthoritativeInvoice[]>();
  const creditByCard = new Map<string, number>();
  for (const doc of snapshot.docs) {
    const invoice = readAuthoritativeInvoice(doc.id, doc.data(),
      t.workspaceId);
    assert.ok(invoice, `fatura ${doc.id} no schema da P4-A`);
    // M3: crédito ainda não transportado = total negativo de fatura aberta.
    if (invoice.cycleStatus === "open" && invoice.totalCents < 0) {
      creditByCard.set(invoice.cardId,
        (creditByCard.get(invoice.cardId) ?? 0) - invoice.totalCents);
    }
    if (invoice.paymentStatus === "paid") continue;
    const list = pendingByCard.get(invoice.cardId) ?? [];
    list.push(invoice);
    pendingByCard.set(invoice.cardId, list);
  }
  const total = (list: AuthoritativeInvoice[]) =>
    list.reduce((sum, invoice) => sum + invoice.remainingCents, 0);
  for (const cardId of pendingByCard.keys()) {
    assert.ok(data.cards.some((item) => item.cardId === cardId),
      `cartão ${cardId} com saldo pendente está na lista por cartão`);
  }
  for (const item of data.cards) {
    const pending = pendingByCard.get(item.cardId) ?? [];
    const overdue = pending.filter((invoice) =>
      isInvoiceOverdue(invoice, today));
    const rest = pending.filter((invoice) => !isInvoiceOverdue(invoice, today))
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate) ||
        left.competenceMonth.localeCompare(right.competenceMonth));
    assert.equal(item.overdueCents, total(overdue),
      `${item.name}: atraso = isInvoiceOverdue da P4-A`);
    assert.equal(item.currentInvoice?.invoiceId ?? null, rest[0]?.id ?? null,
      `${item.name}: atual = pendente fora de atraso de menor vencimento`);
    assert.equal(item.futureCommittedCents, total(rest.slice(1)),
      `${item.name}: futuro = demais pendentes fora de atraso`);
    assert.equal(item.outstandingCents, total(pending),
      `${item.name}: pendente`);
    assert.equal(item.currentInvoice?.effectivelyClosed ?? null,
      rest[0] ? isCycleEffectivelyClosed(rest[0], today) : null,
      `${item.name}: ciclo da próxima fatura a pagar (M2)`);
    assert.equal(item.openCreditCents, creditByCard.get(item.cardId) ?? 0,
      `${item.name}: crédito a transportar (M3)`);
  }
  assert.equal(data.obligations.openCreditCents,
    data.cards.reduce((sum, item) => sum + item.openCreditCents, 0),
    "crédito do bloco = Σ cartões (M3)");
};

const cardsAt = async (
  t: ReportTenant,
  instant: Date,
): Promise<CardsReport> => {
  const data = exact((await executeGetFinancialReport(
    actorOf(t),
    {
      workspaceId: t.workspaceId,
      range: {kind: "preset", preset: "30d"},
      sections: ["cards"],
    },
    instant)).cards, "cartões");
  await assertMatchesDomain(t, data, saoPauloDayKey(instant));
  return data;
};

const itemOf = (data: CardsReport, cardId: string): CardItem => {
  const item = data.cards.find((card) => card.cardId === cardId);
  assert.ok(item, `cartão ${cardId} no relatório`);
  return item;
};

const currentOf = (item: CardItem): number =>
  item.currentInvoice?.payableCents ?? 0;

/** Atraso + fatura atual + futuro = saldo pendente do cartão. */
const assertCardParity = (item: CardItem): void => {
  assert.equal(
    item.overdueCents + currentOf(item) + item.futureCommittedCents,
    item.outstandingCents,
    "atraso + atual + futuro = pendente do cartão");
};

/** Σ por cartão das classes e do pendente = agregados do bloco. */
const assertBlockParity = (data: CardsReport): void => {
  let outstanding = 0;
  let overdue = 0;
  for (const item of data.cards) {
    assertCardParity(item);
    outstanding += item.outstandingCents;
    overdue += item.overdueCents;
  }
  assert.equal(outstanding, data.obligations.totalOutstandingCents,
    "Σ pendente dos cartões = obligations.totalOutstandingCents");
  assert.equal(overdue, data.obligations.overdueCents,
    "Σ atraso dos cartões = obligations.overdueCents");
  assert.equal(
    data.obligations.openCyclesCents + data.obligations.closedUnpaidCents,
    data.obligations.totalOutstandingCents,
    "abertos + fechadas = total pendente");
};

// ---------------------------------------------------------------- cenários

test("00 adversarial: vencida 100, corrente 300 e futura 200 no mesmo " +
  "cartão — a atual não é a vencida", async () => {
  const t = await seedReportTenant("PF", "cls00");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-01-10", {totalCents: 10_000});
  await runCreditCardInvoiceClosing({today: "2026-02-26"});
  await buy(t, cardId, "2026-03-01", {totalCents: 10_000});
  await buy(t, cardId, "2026-03-02", {totalCents: 40_000,
    installmentsCount: 2});

  const data = await cardsAt(t, noon("2026-03-10"));
  const item = itemOf(data, cardId);
  assert.equal(item.overdueCents, 10_000);
  assert.ok(item.currentInvoice, "há fatura atual");
  assert.equal(item.currentInvoice.payableCents, 30_000);
  assert.equal(item.currentInvoice.competenceMonth, "2026-03");
  assert.equal(item.currentInvoice.dueDate, "2026-04-05");
  assert.equal(item.currentInvoice.cycleStatus, "open");
  assert.notEqual(item.currentInvoice.competenceMonth, "2026-01",
    "a atual não é a vencida");
  assert.notEqual(item.currentInvoice.dueDate, "2026-02-05");
  assert.equal(item.futureCommittedCents, 20_000);
  assert.equal(item.outstandingCents, 60_000);
  assertCardParity(item);
  assert.equal(data.obligations.overdueCount, 1);
  assert.equal(data.obligations.overdueCents, 10_000);
  assert.equal(data.obligations.closedUnpaidCents, 10_000);
  assert.equal(data.obligations.openCyclesCents, 50_000);
  assert.equal(data.obligations.totalOutstandingCents, 60_000);
  assertBlockParity(data);
});

test("01 apenas uma fatura corrente (aberta)", async () => {
  const t = await seedReportTenant("PF", "cls01");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-01", {totalCents: 15_000});

  const data = await cardsAt(t, noon("2026-03-10"));
  const item = itemOf(data, cardId);
  assert.equal(item.overdueCents, 0);
  assert.equal(item.currentInvoice?.payableCents, 15_000);
  assert.equal(item.currentInvoice?.competenceMonth, "2026-03");
  assert.equal(item.currentInvoice?.cycleStatus, "open");
  assert.equal(item.futureCommittedCents, 0);
  assert.equal(item.outstandingCents, 15_000);
  assert.equal(data.obligations.overdueCount, 0);
  assert.equal(data.obligations.openCyclesCents, 15_000);
  assert.equal(data.obligations.closedUnpaidCents, 0);
  assert.equal(data.obligations.partiallyPaidCount, 0);
  assertBlockParity(data);
});

test("02 fatura anterior vencida mais a corrente", async () => {
  const t = await seedReportTenant("PF", "cls02");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-01-10", {totalCents: 10_000});
  await runCreditCardInvoiceClosing({today: "2026-02-26"});
  await buy(t, cardId, "2026-03-01", {totalCents: 25_000});

  const data = await cardsAt(t, noon("2026-03-10"));
  const item = itemOf(data, cardId);
  assert.equal(item.overdueCents, 10_000);
  assert.equal(item.currentInvoice?.payableCents, 25_000);
  assert.equal(item.currentInvoice?.competenceMonth, "2026-03");
  assert.equal(item.futureCommittedCents, 0);
  assert.equal(item.outstandingCents, 35_000);
  assertCardParity(item);
  assert.equal(data.obligations.overdueCount, 1);
  assert.equal(data.obligations.closedUnpaidCents, 10_000);
  assert.equal(data.obligations.openCyclesCents, 25_000);
  assertBlockParity(data);
});

test("03 duas faturas vencidas mais a corrente", async () => {
  const t = await seedReportTenant("PF", "cls03");
  const cardId = await createCard(t);
  // Dezembro vence em 05/01/2026 e janeiro em 05/02/2026.
  await buy(t, cardId, "2025-12-10", {totalCents: 5_000});
  await buy(t, cardId, "2026-01-10", {totalCents: 10_000});
  await runCreditCardInvoiceClosing({today: "2026-02-26"});
  await buy(t, cardId, "2026-03-01", {totalCents: 25_000});

  const data = await cardsAt(t, noon("2026-03-10"));
  const item = itemOf(data, cardId);
  assert.equal(item.overdueCents, 15_000);
  assert.equal(item.currentInvoice?.payableCents, 25_000);
  assert.equal(item.currentInvoice?.competenceMonth, "2026-03");
  assert.equal(item.futureCommittedCents, 0);
  assert.equal(item.outstandingCents, 40_000);
  assertCardParity(item);
  assert.equal(data.obligations.overdueCount, 2);
  assert.equal(data.obligations.overdueCents, 15_000);
  assert.equal(data.obligations.closedUnpaidCents, 15_000);
  assert.equal(data.obligations.openCyclesCents, 25_000);
  assertBlockParity(data);
});

test("04 fatura corrente fechada e parcialmente paga: é a atual pelo " +
  "restante; o ciclo aberto seguinte é futuro", async () => {
  const t = await seedReportTenant("PF", "cls04");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-10", {totalCents: 30_000});
  await runCreditCardInvoiceClosing({today: "2026-03-26"});
  await pay(t, cardId, "2026-03", "2026-03-27", 12_000);
  await buy(t, cardId, "2026-03-28", {totalCents: 8_000});

  const data = await cardsAt(t, noon("2026-03-30"));
  const item = itemOf(data, cardId);
  assert.equal(item.overdueCents, 0);
  assert.ok(item.currentInvoice, "há fatura atual");
  assert.equal(item.currentInvoice.competenceMonth, "2026-03");
  assert.equal(item.currentInvoice.cycleStatus, "closed");
  assert.equal(item.currentInvoice.paymentStatus, "partial");
  assert.equal(item.currentInvoice.dueDate, "2026-04-05");
  assert.equal(item.currentInvoice.payableCents, 18_000);
  assert.equal(item.futureCommittedCents, 8_000);
  assert.equal(item.outstandingCents, 26_000);
  assertCardParity(item);
  assert.equal(data.obligations.partiallyPaidCount, 1);
  assert.equal(data.obligations.partiallyPaidRemainingCents, 18_000);
  assert.equal(data.obligations.closedUnpaidCents, 18_000);
  assert.equal(data.obligations.openCyclesCents, 8_000);
  assertBlockParity(data);
});

test("05 só parcelas futuras: sem fatura própria no ciclo corrente, a atual " +
  "é a parcela mais próxima não vencida", async () => {
  // O modelo só materializa fatura quando há lançamento: não existe fatura
  // "vazia" no ciclo corrente. Com a fatura fechada (março) quitada, restam
  // as parcelas de abril e maio, ambas abertas; a de menor vencimento
  // (05/05) é a atual e a seguinte (05/06) é futuro.
  const t = await seedReportTenant("PF", "cls05");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-10", {totalCents: 30_000,
    installmentsCount: 3});
  await runCreditCardInvoiceClosing({today: "2026-03-26"});
  await pay(t, cardId, "2026-03", "2026-03-27", 10_000);

  const data = await cardsAt(t, noon("2026-03-30"));
  const item = itemOf(data, cardId);
  assert.equal(item.overdueCents, 0);
  assert.ok(item.currentInvoice, "há fatura atual");
  assert.equal(item.currentInvoice.competenceMonth, "2026-04");
  assert.equal(item.currentInvoice.dueDate, "2026-05-05");
  assert.equal(item.currentInvoice.cycleStatus, "open");
  assert.equal(item.currentInvoice.payableCents, 10_000);
  assert.equal(item.futureCommittedCents, 10_000);
  assert.equal(item.outstandingCents, 20_000);
  assertCardParity(item);
  assert.equal(data.obligations.closedUnpaidCents, 0);
  assert.equal(data.obligations.openCyclesCents, 20_000);
  assertBlockParity(data);
});

test("06 todas as faturas pagas: sem atual, sem futuro, sem atraso",
  async () => {
    const t = await seedReportTenant("PF", "cls06");
    const cardId = await createCard(t);
    await buy(t, cardId, "2026-01-10", {totalCents: 10_000});
    await buy(t, cardId, "2026-02-10", {totalCents: 20_000});
    await runCreditCardInvoiceClosing({today: "2026-03-01"});
    await pay(t, cardId, "2026-01", "2026-03-02", 10_000);
    await pay(t, cardId, "2026-02", "2026-03-02", 20_000);

    const data = await cardsAt(t, noon("2026-03-10"));
    const item = itemOf(data, cardId);
    assert.equal(item.currentInvoice, null);
    assert.equal(item.futureCommittedCents, 0);
    assert.equal(item.overdueCents, 0);
    assert.equal(item.outstandingCents, 0);
    assert.equal(data.obligations.totalOutstandingCents, 0);
    assert.equal(data.obligations.overdueCount, 0);
    assert.equal(data.obligations.partiallyPaidCount, 0);
    assertBlockParity(data);
  });

test("07 cartão sem fatura: sem atual e todas as classes zeradas",
  async () => {
    const t = await seedReportTenant("PF", "cls07");
    const cardId = await createCard(t);

    const data = await cardsAt(t, noon("2026-03-10"));
    const item = itemOf(data, cardId);
    assert.equal(item.currentInvoice, null);
    assert.equal(item.futureCommittedCents, 0);
    assert.equal(item.overdueCents, 0);
    assert.equal(item.outstandingCents, 0);
    assert.equal(data.obligations.totalOutstandingCents, 0);
    assertBlockParity(data);
  });

const reversePayment = async (
  t: ReportTenant,
  cardId: string,
  competence: string,
  paymentId: string,
  today: string,
) => executeReverseInvoicePayment(cardActorOf(t, t.owner), {
  workspaceId: t.workspaceId,
  idempotencyKey: idempotencyKey(),
  paymentId,
  expectedUpdatedAt: await invoiceVersion(t.workspaceId, cardId, competence),
}, requestId(), clockAt(today));

test("08 cartão arquivado: sem saldo fica fora da lista; com saldo (estorno " +
  "de pagamento depois do arquivamento, aceito pela P4-A) aparece marcado e " +
  "fecha com o bloco", async () => {
  const t = await seedReportTenant("PF", "cls08");
  const kept = await createCard(t, {name: "Ativo"});
  const archived = await createCard(t, {name: "Arquivado"});
  // O arquivado tem histórico, mas quitado (a operação exige zero saldo).
  await buy(t, archived, "2026-01-10", {totalCents: 9_000});
  await runCreditCardInvoiceClosing({today: "2026-01-26"});
  const payment = await pay(t, archived, "2026-01", "2026-01-27", 9_000);
  await executeArchiveCreditCard(cardActorOf(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId: archived,
    expectedUpdatedAt: await cardVersion(t.workspaceId, archived),
  }, requestId(), clockAt("2026-01-28"));
  assert.equal((await readCard(t.workspaceId, archived)).status, "archived");
  await buy(t, kept, "2026-03-01", {totalCents: 15_000});

  let data = await cardsAt(t, noon("2026-03-10"));
  assert.equal(data.cards.length, 1);
  assert.equal(data.cards.some((item) => item.cardId === archived), false);
  const item = itemOf(data, kept);
  assert.equal(item.outstandingCents, 15_000);
  assert.equal(item.currentInvoice?.payableCents, 15_000);
  assert.equal(data.obligations.totalOutstandingCents, 15_000);
  assert.equal(data.obligations.overdueCents, 0);
  assertBlockParity(data);

  // Estorno do pagamento com o cartão já arquivado: janeiro (vence 05/02)
  // volta a dever e está em atraso. O arquivado entra na lista por cartão,
  // sem utilização de limite, e o bloco continua fechando.
  await reversePayment(t, archived, "2026-01", String(payment.paymentId),
    "2026-03-11");
  data = await cardsAt(t, noon("2026-03-12"));
  assert.equal(data.cards.length, 2);
  const archivedItem = itemOf(data, archived);
  assert.equal(archivedItem.status, "archived");
  assert.equal(archivedItem.overdueCents, 9_000);
  assert.equal(archivedItem.currentInvoice, null);
  assert.equal(archivedItem.futureCommittedCents, 0);
  assert.equal(archivedItem.outstandingCents, 9_000);
  assert.equal(archivedItem.utilizationBasisPoints, null,
    "limite de cartão arquivado fora de uso");
  assert.equal(data.obligations.overdueCents, 9_000);
  assert.equal(data.obligations.totalOutstandingCents, 24_000);
  assert.equal(data.limits.totalCents, (await readCard(t.workspaceId,
    kept)).limitTotalCents, "limites só dos cartões ativos");
  assertBlockParity(data);
});

test("09 estorno de compra faturada: o saldo cai e as classes refletem",
  async () => {
    const t = await seedReportTenant("PF", "cls09");
    const cardId = await createCard(t);
    const bought = await buy(t, cardId, "2026-01-10", {totalCents: 40_000,
      installmentsCount: 2});
    await runCreditCardInvoiceClosing({today: "2026-01-26"});

    // Antes: janeiro fechada (atual) e fevereiro aberta (futuro).
    let data = await cardsAt(t, noon("2026-01-28"));
    let item = itemOf(data, cardId);
    assert.equal(item.currentInvoice?.competenceMonth, "2026-01");
    assert.equal(item.currentInvoice?.payableCents, 20_000);
    assert.equal(item.futureCommittedCents, 20_000);
    assert.equal(item.outstandingCents, 40_000);
    assertBlockParity(data);

    // O estorno cancela a parcela aberta (fevereiro) e lança o crédito da
    // parcela já faturada em fevereiro; a fatura fechada de janeiro segue
    // devida (o crédito só a abate depois, no transporte do fechamento).
    await executeRefundCreditCardPurchase(cardActorOf(t, t.owner), {
      workspaceId: t.workspaceId,
      idempotencyKey: idempotencyKey(),
      purchaseId: bought.purchaseId,
      expectedUpdatedAt: await purchaseVersion(t.workspaceId,
        bought.purchaseId),
    }, requestId(), clockAt("2026-01-29"));
    const february = await readInvoice(t.workspaceId, cardId, "2026-02");
    assert.equal(february.totalCents, -20_000);
    assert.equal(february.paymentStatus, "paid");

    data = await cardsAt(t, noon("2026-01-30"));
    item = itemOf(data, cardId);
    assert.equal(item.currentInvoice?.competenceMonth, "2026-01");
    assert.equal(item.currentInvoice?.payableCents, 20_000);
    assert.equal(item.futureCommittedCents, 0, "fevereiro sem saldo");
    assert.equal(item.overdueCents, 0);
    assert.equal(item.outstandingCents, 20_000, "o saldo caiu de 40.000");
    assertBlockParity(data);

    // Depois do vencimento de janeiro (05/02), o saldo remanescente é atraso.
    data = await cardsAt(t, noon("2026-02-10"));
    item = itemOf(data, cardId);
    assert.equal(item.overdueCents, 20_000);
    assert.equal(item.currentInvoice, null, "fevereiro tem crédito");
    assert.equal(item.futureCommittedCents, 0);
    assert.equal(item.outstandingCents, 20_000);
    assertBlockParity(data);
  });

test("10 estorno de pagamento de fatura vencida: o saldo volta ao atraso",
  async () => {
    const t = await seedReportTenant("PF", "cls10");
    const cardId = await createCard(t);
    await buy(t, cardId, "2026-01-10", {totalCents: 10_000});
    await runCreditCardInvoiceClosing({today: "2026-01-26"});
    const payment = await pay(t, cardId, "2026-01", "2026-02-01", 10_000);

    let data = await cardsAt(t, noon("2026-02-10"));
    let item = itemOf(data, cardId);
    assert.equal(item.outstandingCents, 0, "paga: nada pendente");
    assert.equal(item.currentInvoice, null);
    assert.equal(item.overdueCents, 0);
    assertBlockParity(data);

    await reversePayment(t, cardId, "2026-01", String(payment.paymentId),
      "2026-02-11");
    data = await cardsAt(t, noon("2026-02-12"));
    item = itemOf(data, cardId);
    assert.equal(item.overdueCents, 10_000, "vence em 05/02: volta ao atraso");
    assert.equal(item.currentInvoice, null, "a atual nunca é a vencida");
    assert.equal(item.futureCommittedCents, 0);
    assert.equal(item.outstandingCents, 10_000);
    assert.equal(data.obligations.overdueCount, 1);
    assertBlockParity(data);
  });

test("10b estorno de pagamento de fatura ainda não vencida: volta a ser a " +
  "atual", async () => {
  const t = await seedReportTenant("PF", "cls10b");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-10", {totalCents: 20_000});
  await runCreditCardInvoiceClosing({today: "2026-03-26"});
  const payment = await pay(t, cardId, "2026-03", "2026-03-27", 20_000);

  let data = await cardsAt(t, noon("2026-03-30"));
  let item = itemOf(data, cardId);
  assert.equal(item.outstandingCents, 0);
  assert.equal(item.currentInvoice, null);
  assertBlockParity(data);

  await reversePayment(t, cardId, "2026-03", String(payment.paymentId),
    "2026-03-28");
  data = await cardsAt(t, noon("2026-03-30"));
  item = itemOf(data, cardId);
  assert.equal(item.overdueCents, 0);
  assert.equal(item.currentInvoice?.payableCents, 20_000);
  assert.equal(item.currentInvoice?.competenceMonth, "2026-03");
  assert.equal(item.currentInvoice?.paymentStatus, "unpaid");
  assert.equal(item.futureCommittedCents, 0);
  assert.equal(item.outstandingCents, 20_000);
  assertBlockParity(data);
});

test("11 mesmo vencimento: o modelo permite empate (fevereiro curto com " +
  "fechamento 28 e vencimento 29–31); a competência mais antiga é a atual",
async () => {
  // Laço sobre todos os pares fechamento/vencimento (dia 1–31) em três anos
  // (com bissexto): o vencimento nunca decresce de um mês para o seguinte e
  // o empate existe apenas por fevereiro curto, nunca entre meses cheios.
  const ties = new Set<string>();
  const months: string[] = [];
  for (const year of [2026, 2027, 2028]) {
    for (let month = 1; month <= 12; month++) {
      months.push(`${year}-${String(month).padStart(2, "0")}`);
    }
  }
  for (let closing = 1; closing <= 31; closing++) {
    for (let due = 1; due <= 31; due++) {
      for (let index = 0; index + 1 < months.length; index++) {
        const first = dueDateOf(months[index], closing, due);
        const second = dueDateOf(months[index + 1], closing, due);
        assert.ok(first <= second, "vencimentos nunca decrescem " +
          `(${closing}/${due} ${months[index]})`);
        if (first === second) ties.add(`${closing}/${due}`);
      }
    }
  }
  assert.ok(ties.has("28/29"), "fechamento 28 e vencimento 29 empatam");
  assert.equal(dueDateOf("2027-02", 28, 29), "2027-03-29");
  assert.equal(dueDateOf("2027-03", 28, 29), "2027-03-29");

  // Cartão 28/29: as competências 2027-02 e 2027-03 vencem em 29/03/2027.
  const t = await seedReportTenant("PF", "cls11");
  const cardId = await createCard(t, {closingDay: 28, dueDay: 29});
  // Março é lançada primeiro: o desempate não depende da ordem de criação.
  await buy(t, cardId, "2027-03-10", {totalCents: 20_000});
  await buy(t, cardId, "2027-02-10", {totalCents: 10_000});
  const february = await readInvoice(t.workspaceId, cardId, "2027-02");
  const march = await readInvoice(t.workspaceId, cardId, "2027-03");
  assert.equal(february.dueDate, "2027-03-29");
  assert.equal(march.dueDate, "2027-03-29");
  assert.equal((await invoicesOf(t.workspaceId, cardId)).length, 2);

  // Antes do fechamento automático: ambas abertas, empate por competência.
  let data = await cardsAt(t, noon("2027-03-10"));
  let item = itemOf(data, cardId);
  assert.equal(item.currentInvoice?.competenceMonth, "2027-02");
  assert.equal(item.currentInvoice?.dueDate, "2027-03-29");
  assert.equal(item.currentInvoice?.payableCents, 10_000);
  assert.equal(item.futureCommittedCents, 20_000);
  assert.equal(item.outstandingCents, 30_000);
  assertBlockParity(data);

  // Fevereiro fechada e março aberta, mesmo vencimento: ainda fevereiro.
  await runCreditCardInvoiceClosing({today: "2027-03-01"});
  data = await cardsAt(t, noon("2027-03-10"));
  item = itemOf(data, cardId);
  assert.equal(item.currentInvoice?.competenceMonth, "2027-02");
  assert.equal(item.currentInvoice?.cycleStatus, "closed");
  assert.equal(item.currentInvoice?.payableCents, 10_000);
  assert.equal(item.futureCommittedCents, 20_000);
  assert.equal(item.overdueCents, 0);
  assert.equal(item.outstandingCents, 30_000);
  assert.equal(data.obligations.closedUnpaidCents, 10_000);
  assert.equal(data.obligations.openCyclesCents, 20_000);
  assertBlockParity(data);
});

/** Fatura que vence em `dueDate`: não é atraso no dia, é no dia seguinte. */
const assertDueBoundary = async (input: {
  prefix: string;
  closingDay: number;
  dueDay: number;
  purchaseDay: string;
  closingRun: string;
  competence: string;
  dueDate: string;
  lastDayInstant: string;
  nextDayInstant: string;
}): Promise<void> => {
  const t = await seedReportTenant("PF", input.prefix);
  const cardId = await createCard(t, {
    closingDay: input.closingDay,
    dueDay: input.dueDay,
  });
  await buy(t, cardId, input.purchaseDay, {totalCents: 7_000});
  await runCreditCardInvoiceClosing({today: input.closingRun});
  const invoice = await readInvoice(t.workspaceId, cardId, input.competence);
  assert.equal(invoice.dueDate, input.dueDate);
  assert.equal(invoice.cycleStatus, "closed");

  let data = await cardsAt(t, new Date(input.lastDayInstant));
  let item = itemOf(data, cardId);
  assert.equal(item.overdueCents, 0, "no dia do vencimento não é atraso");
  assert.equal(item.currentInvoice?.payableCents, 7_000);
  assert.equal(item.currentInvoice?.dueDate, input.dueDate);
  assert.equal(item.outstandingCents, 7_000);
  assert.equal(data.obligations.overdueCount, 0);
  assertBlockParity(data);

  data = await cardsAt(t, new Date(input.nextDayInstant));
  item = itemOf(data, cardId);
  assert.equal(item.overdueCents, 7_000, "no dia seguinte é atraso");
  assert.equal(item.currentInvoice, null);
  assert.equal(item.futureCommittedCents, 0);
  assert.equal(item.outstandingCents, 7_000);
  assert.equal(data.obligations.overdueCount, 1);
  assertBlockParity(data);
};

test("12 virada de ano e de mês em São Paulo: vence em 31/12 e em 28/02",
  async () => {
    // 23:59 BRT de 31/12/2026 já é 01/01/2027 em UTC (02:59Z): vale o dia
    // civil de São Paulo, nunca o de UTC.
    await assertDueBoundary({
      prefix: "cls12a",
      closingDay: 25,
      dueDay: 31,
      purchaseDay: "2026-12-10",
      closingRun: "2026-12-26",
      competence: "2026-12",
      dueDate: "2026-12-31",
      lastDayInstant: "2027-01-01T02:59:00.000Z",
      nextDayInstant: "2027-01-01T03:01:00.000Z",
    });
    await assertDueBoundary({
      prefix: "cls12b",
      closingDay: 20,
      dueDay: 28,
      purchaseDay: "2027-02-10",
      closingRun: "2027-02-21",
      competence: "2027-02",
      dueDate: "2027-02-28",
      lastDayInstant: "2027-03-01T02:59:00.000Z",
      nextDayInstant: "2027-03-01T03:01:00.000Z",
    });
  });

test("13 paridade com dois cartões: Σ pendente e Σ atraso por cartão = " +
  "agregados do bloco", async () => {
  const t = await seedReportTenant("PF", "cls13");
  const first = await createCard(t, {name: "Cartão A"});
  const second = await createCard(t, {name: "Cartão B", closingDay: 10,
    dueDay: 20});
  // A: janeiro vencida 100, março corrente 100 + 200, abril futura 200.
  await buy(t, first, "2026-01-10", {totalCents: 10_000});
  // B: janeiro (fecha 10/01, vence 20/01) vencida 80.
  await buy(t, second, "2026-01-05", {totalCents: 8_000});
  await runCreditCardInvoiceClosing({today: "2026-02-26"});
  await buy(t, first, "2026-03-01", {totalCents: 10_000});
  await buy(t, first, "2026-03-02", {totalCents: 40_000,
    installmentsCount: 2});
  // B: março (fecha 10/03 = hoje, ainda "aberta" para a rotina) 60 + 30,
  // abril 30 e maio 30. Fatura aberta nunca é atraso (a P4-A só atrasa
  // fatura fechada); março é a atual de B.
  await buy(t, second, "2026-03-02", {totalCents: 6_000});
  await buy(t, second, "2026-03-03", {totalCents: 9_000,
    installmentsCount: 3});

  const data = await cardsAt(t, noon("2026-03-10"));
  const a = itemOf(data, first);
  const b = itemOf(data, second);
  assert.equal(a.overdueCents, 10_000);
  assert.equal(a.currentInvoice?.payableCents, 30_000);
  assert.equal(a.futureCommittedCents, 20_000);
  assert.equal(a.outstandingCents, 60_000);
  assert.equal(b.overdueCents, 8_000);
  assert.equal(b.currentInvoice?.competenceMonth, "2026-03");
  assert.equal(b.currentInvoice?.dueDate, "2026-03-20");
  assert.equal(b.currentInvoice?.payableCents, 9_000);
  assert.equal(b.futureCommittedCents, 6_000);
  assert.equal(b.outstandingCents, 23_000);
  assert.equal(a.outstandingCents + b.outstandingCents, 83_000);
  assert.equal(data.obligations.totalOutstandingCents, 83_000);
  assert.equal(data.obligations.overdueCents, 18_000);
  assert.equal(data.obligations.overdueCount, 2);
  assert.equal(data.obligations.closedUnpaidCents, 18_000);
  assert.equal(data.obligations.openCyclesCents, 65_000);
  assertBlockParity(data);
});

// ------------------------------------------------- dados inconsistentes

const reportAt = (t: ReportTenant, instant: Date) =>
  executeGetFinancialReport(actorOf(t), {
    workspaceId: t.workspaceId,
    range: {kind: "preset", preset: "30d"},
    sections: ["cards"],
  }, instant);

/** Documento de fatura gravado à mão, fora do schema da P4-A, de propósito. */
const seedRawInvoice = (
  t: ReportTenant,
  cardId: string,
  competence: string,
  fields: Record<string, unknown>,
) => db().doc(`workspaces/${t.workspaceId}/credit_card_invoices/` +
  `${cardId}_${competence}`).set({
  workspaceId: t.workspaceId,
  cardId,
  competenceMonth: competence,
  cycleStatus: "open",
  paymentStatus: "unpaid",
  ...fields,
});

test("14 componentes que não fecham com o pendente (dado inconsistente): " +
  "bloco indisponível, nunca números incoerentes", async () => {
  const t = await seedReportTenant("PF", "cls14");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-01", {totalCents: 10_000});
  // Fatura posterior, fora do schema (saldo negativo marcado como "unpaid"):
  // entra na soma do pendente, mas não é candidata à fatura atual.
  await seedRawInvoice(t, cardId, "2026-07", {
    schemaVersion: 1, closingDate: "2026-07-25", dueDate: "2026-08-05",
    totalCents: -50_000, paidCents: 0, remainingCents: -50_000,
  });
  const r = await reportAt(t, noon("2026-03-10"));
  assert.equal(r.cards.status, "unavailable");
  assert.equal(r.cards.reason, "invoice_classification_parity");
  assert.equal(r.cards.data, null);
});

test("15 candidata à fatura atual fora do schema: bloco indisponível",
  async () => {
    const t = await seedReportTenant("PF", "cls15");
    const cardId = await createCard(t);
    // Única fatura pendente do cartão, além da janela de 30 dias de
    // vencimentos, com versão de schema desconhecida.
    await seedRawInvoice(t, cardId, "2026-09", {
      schemaVersion: 0, closingDate: "2026-09-25", dueDate: "2026-10-05",
      totalCents: 5_000, paidCents: 0, remainingCents: 5_000,
    });
    const r = await reportAt(t, noon("2026-03-10"));
    assert.equal(r.cards.status, "unavailable");
    assert.equal(r.cards.reason, "invoice_document_invalid");
    assert.equal(r.cards.data, null);
  });

test("16 fatura pendente fora dos ciclos (cycleStatus inválido): o bloco não " +
  "fecha com os agregados e fica indisponível, nunca vira futuro em silêncio",
async () => {
  const t = await seedReportTenant("PF", "cls16");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-01", {totalCents: 10_000});
  // Saldo positivo, fora da janela de vencimentos e sem ser candidata: só a
  // paridade do bloco (Σ cartões × abertos + fechadas) a apanha.
  await seedRawInvoice(t, cardId, "2026-07", {
    schemaVersion: 1, cycleStatus: "closing", closingDate: "2026-07-25",
    dueDate: "2026-08-05", totalCents: 7_000, paidCents: 0,
    remainingCents: 7_000,
  });
  const r = await reportAt(t, noon("2026-03-10"));
  assert.equal(r.cards.status, "unavailable");
  assert.equal(r.cards.reason, "invoice_classification_parity");
  assert.equal(r.cards.data, null);
});

test("17 fatura pendente de cartão inexistente: obrigações sem cartão não " +
  "fecham com a lista por cartão e o bloco fica indisponível", async () => {
  const t = await seedReportTenant("PF", "cls17");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-01", {totalCents: 10_000});
  await seedRawInvoice(t, "cartao-inexistente", "2026-07", {
    schemaVersion: 1, closingDate: "2026-07-25", dueDate: "2026-08-05",
    totalCents: 7_000, paidCents: 0, remainingCents: 7_000,
  });
  const r = await reportAt(t, noon("2026-03-10"));
  assert.equal(r.cards.status, "unavailable");
  assert.equal(r.cards.reason, "invoice_classification_parity");
  assert.equal(r.cards.data, null);
});

test("18 concorrência: relatório lido junto com pagamentos sucessivos — " +
  "toda leitura fecha por cartão e com o bloco (instantâneo único)",
async () => {
  const t = await seedReportTenant("PF", "cls18");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-01-10", {totalCents: 30_000,
    installmentsCount: 3});
  await runCreditCardInvoiceClosing({today: "2026-01-26"});
  const instant = noon("2026-01-28");
  const writer = (async () => {
    for (const amountCents of [4_000, 3_000, 3_000]) {
      await pay(t, cardId, "2026-01", "2026-01-27", amountCents);
    }
  })();
  const readers = Promise.all(Array.from({length: 6}, () =>
    reportAt(t, instant)));
  const [, readings] = await Promise.all([writer, readers]);
  for (const reading of readings) {
    const data = exact(reading.cards, "cartões (leitura concorrente)");
    assertBlockParity(data);
    assert.equal(itemOf(data, cardId).futureCommittedCents, 20_000,
      "fevereiro e março seguem no futuro em toda leitura");
  }
  // Depois das escritas: janeiro quitado, o oráculo da P4-A confere.
  const data = await cardsAt(t, instant);
  const item = itemOf(data, cardId);
  assert.equal(item.currentInvoice?.competenceMonth, "2026-02");
  assert.equal(item.futureCommittedCents, 10_000);
  assert.equal(item.outstandingCents, 20_000);
  assertBlockParity(data);
});

// ------------------------------------------------- M3 (P5-C2): crédito

test("M3-01 crédito em fatura aberta: informado à parte, sem abater a " +
  "próxima fatura a pagar nem o futuro, sem mexer no limite", async () => {
  const t = await seedReportTenant("PF", "m3a");
  const cardId = await createCard(t);
  const bought = await buy(t, cardId, "2026-01-10", {totalCents: 40_000,
    installmentsCount: 2});
  await runCreditCardInvoiceClosing({today: "2026-01-26"});
  await executeRefundCreditCardPurchase(cardActorOf(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    purchaseId: bought.purchaseId,
    expectedUpdatedAt: await purchaseVersion(t.workspaceId, bought.purchaseId),
  }, requestId(), clockAt("2026-01-29"));
  const limitBefore = (await readCard(t.workspaceId, cardId)).limitUsedCents;

  const data = await cardsAt(t, noon("2026-01-30"));
  const item = itemOf(data, cardId);
  assert.equal(item.openCreditCents, 20_000, "fevereiro com R$ 200 de crédito");
  assert.equal(data.obligations.openCreditCents, 20_000);
  assert.equal(item.currentInvoice?.competenceMonth, "2026-01");
  assert.equal(item.currentInvoice?.payableCents, 20_000,
    "janeiro segue devido: o crédito só abate no fechamento");
  assert.equal(item.currentInvoice?.effectivelyClosed, true);
  assert.equal(item.futureCommittedCents, 0);
  assert.equal(item.outstandingCents, 20_000);
  assert.equal(data.obligations.totalOutstandingCents, 20_000,
    "o crédito não é pagamento nem reduz o pendente");
  assert.equal((await readCard(t.workspaceId, cardId)).limitUsedCents,
    limitBefore, "o relatório não mexe no limite");
  assertBlockParity(data);
});

test("M3-02 sem crédito: zero verdadeiro; a fatura do ciclo aberto vem " +
  "marcada como não fechada", async () => {
  const t = await seedReportTenant("PF", "m3b");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-01", {totalCents: 9_000});
  const data = await cardsAt(t, noon("2026-03-10"));
  const item = itemOf(data, cardId);
  assert.equal(item.openCreditCents, 0);
  assert.equal(data.obligations.openCreditCents, 0);
  assert.equal(item.currentInvoice?.cycleStatus, "open");
  assert.equal(item.currentInvoice?.effectivelyClosed, false,
    "ciclo aberto que ainda recebe compras");
  assertBlockParity(data);
});

test("M3-03 crédito maior que as compras do ciclo; o fechamento o transporta " +
  "uma única vez (reexecução idempotente) e a compra seguinte o consome",
async () => {
  const t = await seedReportTenant("PF", "m3c");
  const cardId = await createCard(t);
  const bought = await buy(t, cardId, "2026-01-10", {totalCents: 40_000,
    installmentsCount: 2});
  await runCreditCardInvoiceClosing({today: "2026-01-26"});
  await buy(t, cardId, "2026-02-01", {totalCents: 5_000});
  await executeRefundCreditCardPurchase(cardActorOf(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    purchaseId: bought.purchaseId,
    expectedUpdatedAt: await purchaseVersion(t.workspaceId, bought.purchaseId),
  }, requestId(), clockAt("2026-02-02"));
  assert.equal((await readInvoice(t.workspaceId, cardId, "2026-02"))
    .totalCents, -15_000);

  let data = await cardsAt(t, noon("2026-02-03"));
  let item = itemOf(data, cardId);
  assert.equal(item.openCreditCents, 15_000,
    "crédito de R$ 150, maior que a compra de R$ 50 do ciclo");
  assert.equal(item.overdueCents, 0);
  assert.equal(item.currentInvoice?.competenceMonth, "2026-01");
  assertBlockParity(data);

  await runCreditCardInvoiceClosing({today: "2026-02-26"});
  const afterFirst = await cardsAt(t, noon("2026-02-27"));
  await runCreditCardInvoiceClosing({today: "2026-02-26"});
  data = await cardsAt(t, noon("2026-02-27"));
  assert.deepEqual(data, afterFirst, "fechar de novo não transporta de novo");
  item = itemOf(data, cardId);
  assert.equal((await readInvoice(t.workspaceId, cardId, "2026-02"))
    .cycleStatus, "closed");
  assert.equal((await readInvoice(t.workspaceId, cardId, "2026-03"))
    .totalCents, -15_000, "o crédito foi para março, uma vez");
  assert.equal(item.openCreditCents, 15_000, "agora em março, sem duplicar");
  assert.equal(item.overdueCents, 20_000, "janeiro venceu em 05/02");
  assertBlockParity(data);

  await buy(t, cardId, "2026-03-01", {totalCents: 30_000});
  data = await cardsAt(t, noon("2026-03-02"));
  item = itemOf(data, cardId);
  assert.equal(item.openCreditCents, 0, "a compra consumiu o crédito");
  assert.equal(item.currentInvoice?.competenceMonth, "2026-03");
  assert.equal(item.currentInvoice?.payableCents, 15_000,
    "março: R$ 300 − R$ 150 de crédito transportado");
  assertBlockParity(data);
});

test("M3-04 duas faturas abertas com crédito (dois cartões) e um cartão " +
  "arquivado com obrigação: o crédito do bloco é a soma, sem dupla contagem",
async () => {
  const t = await seedReportTenant("PF", "m3d");
  const first = await createCard(t, {name: "Crédito A"});
  const second = await createCard(t, {name: "Crédito B"});
  const archived = await createCard(t, {name: "Arquivado"});
  for (const [cardId, cents] of [[first, 40_000], [second, 60_000]] as const) {
    const bought = await buy(t, cardId, "2026-01-10", {totalCents: cents,
      installmentsCount: 2});
    await runCreditCardInvoiceClosing({today: "2026-01-26"});
    await executeRefundCreditCardPurchase(cardActorOf(t, t.owner), {
      workspaceId: t.workspaceId,
      idempotencyKey: idempotencyKey(),
      purchaseId: bought.purchaseId,
      expectedUpdatedAt: await purchaseVersion(t.workspaceId,
        bought.purchaseId),
    }, requestId(), clockAt("2026-01-29"));
  }
  await buy(t, archived, "2026-01-10", {totalCents: 9_000});
  await runCreditCardInvoiceClosing({today: "2026-01-26"});
  const payment = await pay(t, archived, "2026-01", "2026-01-27", 9_000);
  await executeArchiveCreditCard(cardActorOf(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId: archived,
    expectedUpdatedAt: await cardVersion(t.workspaceId, archived),
  }, requestId(), clockAt("2026-01-28"));
  await reversePayment(t, archived, "2026-01", String(payment.paymentId),
    "2026-01-29");

  const data = await cardsAt(t, noon("2026-01-30"));
  assert.equal(itemOf(data, first).openCreditCents, 20_000);
  assert.equal(itemOf(data, second).openCreditCents, 30_000);
  assert.equal(itemOf(data, archived).openCreditCents, 0);
  assert.equal(itemOf(data, archived).outstandingCents, 9_000);
  assert.equal(data.obligations.openCreditCents, 50_000);
  assertBlockParity(data);
});
