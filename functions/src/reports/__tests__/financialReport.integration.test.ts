import assert from "node:assert/strict";
import test from "node:test";

import {executeCreateCashTransfer} from "../../accounts/transfers";
import {createCashTransferPayloadSchema} from "../../accounts/contracts";
import {runCreditCardInvoiceClosing} from "../../cards/closing";
import {executeCancelCreditCardPurchase} from "../../cards/purchaseOperations";
import {
  buy,
  clockAt,
  createCard,
  purchaseVersion,
  requestId as cardRequestId,
  pay as payInvoice,
} from "../../cards/testSupport/cardTestSupport";
import {
  cashDaysMatchMonth,
  cashProjectionStateRef,
  normalizeCashPeriodDelta,
  readCashDayDeltas,
} from "../../cash/periods";
import {executeGetGoalKpiProgress} from "../../goals/kpi";
import {
  create as createLoan,
  createPayload as loanPayload,
  pay as payLoan,
  payPayload as loanPaymentPayload,
} from "../../loans/testSupport/loanTestSupport";
import {
  newReceivable,
  receivablePayload,
  receive,
  receivePayload,
  clientRef,
  seedClient,
} from "../../receivables/testSupport/receivableTestSupport";
import {seedCategory} from "../../settingsCatalog/testSupport/categorySeeds";
import {handleTransactionWrite} from "../../triggers/transactions";
import {db, idempotencyKey} from "../../workspaces/testSupport/p1TestSupport";
import {
  actorOf,
  confirmEntry,
  createAccount,
  createEntry,
  daysAgo,
  exact,
  month,
  openingBalancesOf,
  preset,
  report,
  seedReportTenant,
  sync,
  today,
  updateEntry,
  voidEntry,
  type ReportTenant,
} from "./reportSupport";

/**
 * P5-C1 — integridade do relatório financeiro autoritativo (D-37), no
 * Emulator, pelos executores reais dos domínios e pelo gatilho real de
 * caixa. Cada cenário confere o número contra a fonte oficial ou contra uma
 * identidade independente (saldo das contas, ledger, metas PJ).
 */

db();

const monthOf = (day: string) => day.slice(0, 7);

const storedMonth = async (tenant: ReportTenant, period: string) =>
  (await db()
    .doc(`workspaces/${tenant.workspaceId}/cash_report_periods/${period}`)
    .get()).data();

const assertMonthParity = async (tenant: ReportTenant, period: string) => {
  const data = await storedMonth(tenant, period);
  assert.ok(data, `mês ${period} existe`);
  assert.equal(data.schemaVersion, 5);
  assert.ok(cashDaysMatchMonth(readCashDayDeltas(data.days),
    normalizeCashPeriodDelta(data)), `Σ dias = mês (${period})`);
};

// ------------------------------------------------------- 1. saldo e caixa

test("01 Saldo Atual = saldos iniciais + movimentos; não depende da faixa",
  async () => {
    const t = await seedReportTenant("PF", "rpt01");
    await createAccount(t, "Banco", 100_000);
    await createEntry(t, {type: "receita", amountCents: 50_000});
    await createEntry(t, {type: "despesa", amountCents: 20_000});
    await sync(t.workspaceId);
    for (const range of [preset("7d"), preset("12m"), preset("all"),
      month(monthOf(today()))]) {
      const r = await report(t, range);
      const accounts = exact(r.accounts, "contas");
      assert.equal(accounts.totalBalanceCents, 130_000,
        "100.000 inicial + 50.000 − 20.000");
      assert.equal(accounts.accountCount, 2);
    }
    const cash = exact((await report(t, preset("30d"))).cash, "caixa");
    assert.equal(cash.receiptsCents, 50_000, "saldo inicial não é receita");
    assert.equal(cash.paymentsCents, 20_000);
    assert.equal(cash.netFlowCents, 30_000);
  });

test("02 conta negativa entra com sinal e gera alerta objetivo", async () => {
  const t = await seedReportTenant("PF", "rpt02");
  await createEntry(t, {type: "despesa", amountCents: 35_000});
  await sync(t.workspaceId);
  const r = await report(t, preset("30d"));
  const accounts = exact(r.accounts, "contas");
  assert.equal(accounts.totalBalanceCents, -35_000);
  assert.equal(accounts.negativeAccountCount, 1);
  const alert = exact(r.alerts, "alertas").items
    .find((item) => item.code === "negative_account_balance");
  assert.equal(alert?.severity, "critical");
  assert.equal(alert?.values.totalBalanceCents, -35_000);
  const negativeResult = exact(r.alerts, "alertas").items
    .find((item) => item.code === "negative_operational_result");
  assert.equal(negativeResult?.values.operationalResultCents, -35_000);
});

test("03 pendente e agendado não entram; confirmação entra na data efetiva",
  async () => {
    const t = await seedReportTenant("PF", "rpt03");
    const pending = await createEntry(t, {type: "despesa", amountCents: 9_000,
      dueDate: daysAgo(-10)});
    await createEntry(t, {type: "despesa", amountCents: 4_000,
      dueDate: daysAgo(3)});
    await sync(t.workspaceId);
    let cash = exact((await report(t, preset("30d"))).cash, "caixa");
    assert.equal(cash.paymentsCents, 0, "pendente e vencido não pagos");
    await confirmEntry(t, pending, daysAgo(1), 8_500);
    await sync(t.workspaceId);
    cash = exact((await report(t, preset("7d"))).cash, "caixa");
    assert.equal(cash.paymentsCents, 8_500, "valor e data efetivos");
    await assertMonthParity(t, monthOf(daysAgo(1)));
  });

test("04 anulação e correção de valor: saem e ajustam sem resíduo",
  async () => {
    const t = await seedReportTenant("PF", "rpt04");
    const a = await createEntry(t, {type: "receita", amountCents: 10_000});
    const b = await createEntry(t, {type: "receita", amountCents: 20_000});
    await sync(t.workspaceId);
    await voidEntry(t, a);
    await updateEntry(t, b, {amountCents: 25_000});
    await sync(t.workspaceId);
    const r = await report(t, preset("7d"));
    assert.equal(exact(r.cash, "caixa").receiptsCents, 25_000);
    assert.equal(exact(r.cash, "caixa").transactionCount, 1);
    const categories = exact(r.categories, "categorias");
    assert.deepEqual(categories.income.map((item) =>
      [item.categoryId, item.amountCents]), [[t.incomeCategoryId, 25_000]]);
    await assertMonthParity(t, monthOf(today()));
  });

test("05 troca de dia no mesmo mês move o detalhe diário (7 dias exatos)",
  async () => {
    const t = await seedReportTenant("PF", "rpt05");
    const id = await createEntry(t, {type: "despesa", amountCents: 7_700,
      date: daysAgo(20)});
    await sync(t.workspaceId);
    assert.equal(exact((await report(t, preset("7d"))).cash, "caixa")
      .paymentsCents, 0);
    await updateEntry(t, id, {date: daysAgo(3)});
    await sync(t.workspaceId);
    const cash = exact((await report(t, preset("7d"))).cash, "caixa");
    assert.equal(cash.paymentsCents, 7_700, "agora dentro dos 7 dias");
    for (const period of new Set([monthOf(daysAgo(20)),
      monthOf(daysAgo(3))])) {
      await assertMonthParity(t, period);
    }
    const days = readCashDayDeltas(
      (await storedMonth(t, monthOf(daysAgo(20))))?.days);
    assert.equal(days[daysAgo(20).slice(8)], undefined,
      "o dia antigo ficou sem o lançamento");
  });

test("06 troca de mês e de categoria preservam a paridade", async () => {
  const t = await seedReportTenant("PF", "rpt06");
  const moradia = await seedCategory(t.workspaceId,
    {name: "Moradia", subtype: "despesa"});
  const lastMonth = `${monthOf(daysAgo(40))}-15`;
  const id = await createEntry(t, {type: "despesa", amountCents: 3_000,
    date: lastMonth});
  await sync(t.workspaceId);
  await updateEntry(t, id, {date: today(), categoryId: moradia});
  await sync(t.workspaceId);
  const old = exact((await report(t, month(monthOf(lastMonth)))).cash,
    "mês anterior");
  assert.equal(old.paymentsCents, 0);
  const current = await report(t, month(monthOf(today())));
  assert.equal(exact(current.cash, "mês atual").paymentsCents, 3_000);
  const categories = exact(current.categories, "categorias").expense;
  assert.deepEqual(categories.map((item) => [item.categoryId, item.name,
    item.amountCents]), [[moradia, "Moradia", 3_000]]);
  await assertMonthParity(t, monthOf(lastMonth));
  await assertMonthParity(t, monthOf(today()));
});

test("07 renomear a categoria muda o nome, nunca a identidade", async () => {
  const t = await seedReportTenant("PF", "rpt07");
  await createEntry(t, {type: "despesa", amountCents: 1_500});
  await sync(t.workspaceId);
  await seedCategory(t.workspaceId, {name: "Mercado", subtype: "despesa",
    id: t.expenseCategoryId});
  const item = exact((await report(t, preset("7d"))).categories,
    "categorias").expense[0];
  assert.equal(item.categoryId, t.expenseCategoryId);
  assert.equal(item.name, "Mercado");
  assert.equal(item.classification, "catalog");
  assert.equal(item.shareBasisPoints, 10_000);
});

// ----------------------------------------------------------- 2. janelas

test("08 7, 30 e 90 dias: bordas inclusivas exatas", async () => {
  const t = await seedReportTenant("PF", "rpt08");
  for (const [days, cents] of [[0, 1], [6, 10], [7, 100], [29, 1_000],
    [30, 10_000], [89, 100_000], [90, 1_000_000]] as const) {
    await createEntry(t, {type: "receita", amountCents: cents,
      date: daysAgo(days)});
  }
  await sync(t.workspaceId);
  const receipts = async (value: "7d" | "30d" | "90d") =>
    exact((await report(t, preset(value))).cash, value).receiptsCents;
  assert.equal(await receipts("7d"), 11, "hoje e hoje−6; hoje−7 fora");
  assert.equal(await receipts("30d"), 1_111, "hoje−29 dentro; hoje−30 fora");
  assert.equal(await receipts("90d"), 111_111, "hoje−89 dentro; hoje−90 fora");
  const period = (await report(t, preset("30d"))).period;
  assert.equal(period.startDate, daysAgo(29));
  assert.equal(period.endDate, today());
  assert.equal(period.dayCount, 30);
});

test("09 12 meses, ano corrente e mês: meses inteiros pelo total", async () => {
  const t = await seedReportTenant("PF", "rpt09");
  const year = today().slice(0, 4);
  const firstOfYear = `${year}-01-01`;
  const twelveStart = (await report(t, preset("12m"))).period
    .startDate as string;
  await createEntry(t, {type: "despesa", amountCents: 100, date: firstOfYear});
  await createEntry(t, {type: "despesa", amountCents: 10, date: twelveStart});
  const beforeTwelve = daysAgo(Math.round((Date.parse(today()) -
    Date.parse(twelveStart)) / 86_400_000) + 1);
  await createEntry(t, {type: "despesa", amountCents: 1, date: beforeTwelve});
  await sync(t.workspaceId);
  const twelve = exact((await report(t, preset("12m"))).cash, "12m");
  const expectedTwelve = 10 + (firstOfYear >= twelveStart ? 100 : 0);
  assert.equal(twelve.paymentsCents, expectedTwelve);
  const ytd = exact((await report(t, preset("ytd"))).cash, "ytd");
  const expectedYtd = 100 + (twelveStart >= firstOfYear ? 10 : 0) +
    (beforeTwelve >= firstOfYear ? 1 : 0);
  assert.equal(ytd.paymentsCents, expectedYtd);
  const series = exact((await report(t, preset("12m"))).series, "série");
  assert.equal(series.points.length, 12);
  const [y, m] = today().split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  assert.equal(series.points[11].partial,
    Number(today().slice(8)) !== lastDay, "mês corrente parcial até hoje");
  assert.ok(series.points.slice(0, 11).every((point) => !point.partial));
  assert.equal(series.points.reduce((sum, point) =>
    sum + point.paymentsCents, 0), expectedTwelve, "Σ série = total");
});

test("10 mês futuro: nada realizado; tudo: do primeiro mês com dado",
  async () => {
    const t = await seedReportTenant("PF", "rpt10");
    const oldDay = `${monthOf(daysAgo(400))}-10`;
    await createEntry(t, {type: "receita", amountCents: 500, date: oldDay});
    await createEntry(t, {type: "receita", amountCents: 50});
    await sync(t.workspaceId);
    const future = await report(t, month("2099-01"));
    assert.equal(future.period.future, true);
    assert.equal(future.cash.status, "zero");
    const all = await report(t, preset("all"));
    assert.equal(all.period.startDate, `${monthOf(oldDay)}-01`);
    assert.equal(exact(all.cash, "tudo").receiptsCents, 550);
    const series = exact(all.series, "série");
    assert.equal(series.sparse, false);
    assert.equal(series.points.reduce((sum, point) =>
      sum + point.receiptsCents, 0), 550);
  });

// --------------------------------------------- 3. domínios e duas visões

test("11 cartão: pagamento de fatura é saída de caixa, não despesa; compra " +
  "fica na visão de consumo", async () => {
  const t = await seedReportTenant("PF", "rpt11");
  const cardId = await createCard(t);
  // Compra antiga: a fatura fecha pelo job e é paga hoje (visão de caixa).
  await buy(t, cardId, daysAgo(45), {totalCents: 30_000});
  await runCreditCardInvoiceClosing({today: today()});
  const closed = (await db()
    .collection(`workspaces/${t.workspaceId}/credit_card_invoices`)
    .where("cardId", "==", cardId).where("cycleStatus", "==", "closed")
    .get()).docs[0];
  assert.ok(closed, "fatura da compra antiga fechada");
  // Compra recente: fica na fatura aberta (visão de consumo).
  await buy(t, cardId, daysAgo(2), {totalCents: 10_000});
  await sync(t.workspaceId);
  let r = await report(t, preset("30d"));
  assert.equal(exact(r.cash, "caixa").paymentsCents, 0,
    "compra não é despesa de caixa");
  let cards = exact(r.cards, "cartões");
  assert.equal(cards.purchases.netCents, 10_000, "só a compra dos 30 dias");
  assert.equal(cards.obligations.totalOutstandingCents, 40_000);
  assert.equal(cards.cards[0].outstandingCents, 40_000);
  assert.equal(cards.limits.totalCents, 500_000);
  // Utilização agregada calculada no servidor (pontos-base).
  assert.equal(cards.limits.utilizationBasisPoints,
    Math.round(cards.limits.usedCents * 10_000 / cards.limits.totalCents));
  assert.ok(cards.limits.usedCents > 0);
  // Limite de cartão nunca vira saldo.
  assert.equal(exact(r.accounts, "contas").totalBalanceCents, 0);
  await payInvoice(t, cardId, closed.get("competenceMonth"), today(), 30_000);
  await sync(t.workspaceId);
  r = await report(t, preset("30d"));
  const cash = exact(r.cash, "caixa");
  assert.equal(cash.paymentsCents, 0, "pagamento não é segunda despesa");
  assert.equal(cash.cardPaymentsCents, 30_000);
  assert.equal(cash.netFlowCents, -30_000);
  cards = exact(r.cards, "cartões");
  assert.equal(cards.payments.netCents, 30_000,
    "pagamentos do domínio = caixa");
  assert.equal(cards.obligations.closedUnpaidCents, 0);
  assert.equal(cards.obligations.totalOutstandingCents, 10_000);
  assert.equal(exact(r.categories, "categorias").expense.length, 0);
});

test("11b tudo: começa na primeira compra no cartão, mesmo sem lançamento " +
  "de caixa; compras nunca viram zero forçado", async () => {
  const t = await seedReportTenant("PF", "rpt11b");
  const cardId = await createCard(t);
  await buy(t, cardId, daysAgo(70), {totalCents: 25_000});
  await buy(t, cardId, daysAgo(1), {totalCents: 5_000});
  // Compra cancelada (fatura aberta) sai da visão de consumo: só compras
  // `active` entram; cancelamento e estorno mudam o status.
  const cancelled = await buy(t, cardId, daysAgo(3), {totalCents: 7_000});
  await executeCancelCreditCardPurchase(actorOf(t), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    purchaseId: cancelled.purchaseId,
    expectedUpdatedAt: await purchaseVersion(t.workspaceId,
      cancelled.purchaseId),
  }, cardRequestId(), clockAt(today()));
  // Nenhum lançamento de caixa: o primeiro mês vem do domínio de cartões.
  const r = await report(t, preset("all"));
  assert.equal(r.period.startDate, `${daysAgo(70).slice(0, 7)}-01`);
  const cards = exact(r.cards, "cartões");
  assert.equal(cards.purchases.netCents, 30_000,
    "todas as compras ativas; a cancelada fica fora");
  assert.equal(cards.purchases.count, 2);
  assert.equal(cards.cards[0].purchasesCents, 30_000);
  const series = cards.purchaseSeries.reduce((sum, point) =>
    sum + point.netCents, 0);
  assert.equal(series, 30_000, "série de compras cobre o período");
  // O caixa continua zero verdadeiro (nenhum fato de caixa).
  assert.equal(r.cash.status, "zero");
});

test("12 fatura vencida: fechada, com saldo e vencimento passado", async () => {
  const t = await seedReportTenant("PF", "rpt12");
  const cardId = await createCard(t);
  await buy(t, cardId, daysAgo(75), {totalCents: 12_000});
  await runCreditCardInvoiceClosing({today: today()});
  const r = await report(t, preset("30d"));
  const obligations = exact(r.cards, "cartões").obligations;
  assert.equal(obligations.overdueCount, 1);
  assert.equal(obligations.overdueCents, 12_000);
  assert.equal(obligations.closedUnpaidCents, 12_000);
  const alert = exact(r.alerts, "alertas").items
    .find((item) => item.code === "overdue_card_invoices");
  assert.equal(alert?.values.overdueCents, 12_000);
  assert.equal(exact(r.debts, "dívidas").cardObligationsCents, 12_000,
    "obrigação de cartão contada uma vez nas dívidas");
});

test("13 empréstimo tomado: principal fora da receita; dívida = saldo; " +
  "juros no resultado financeiro", async () => {
  const t = await seedReportTenant("PF", "rpt13");
  const created = await createLoan(t.owner, loanPayload(t.workspaceId,
    {principalCents: 300_000}));
  await sync(t.workspaceId);
  let r = await report(t, preset("30d"));
  let cash = exact(r.cash, "caixa");
  assert.equal(cash.receiptsCents, 0, "principal não é receita operacional");
  assert.equal(cash.patrimonial.loanPrincipalInflowCents, 300_000);
  assert.equal(exact(r.debts, "dívidas").loansBorrowed.balanceCents, 300_000);
  assert.equal(exact(r.debts, "dívidas").topClients.status, "not_requested",
    "PF não lê a amostra do ranking de clientes");
  const loanId = (created as {loanId: string}).loanId;
  await payLoan(t.owner, await loanPaymentPayload(t.workspaceId, loanId,
    {principalCents: 100_000, interestCents: 10_000}));
  await sync(t.workspaceId);
  r = await report(t, preset("30d"));
  cash = exact(r.cash, "caixa");
  assert.equal(cash.paymentsCents, 0, "amortização não é despesa");
  assert.equal(cash.patrimonial.loanPrincipalOutflowCents, 100_000);
  assert.equal(cash.financial.expenseCents, 10_000);
  assert.equal(exact(r.debts, "dívidas").loansBorrowed.balanceCents, 200_000);
  assert.equal(exact(r.debts, "dívidas").loansLent.balanceCents, 0);
});

test("14 recebível: principal é receita (classificação explícita), juros " +
  "financeiros; aberto não é dívida", async () => {
  const t = await seedReportTenant("PJ", "rpt14");
  const client = await seedClient(t);
  const open = await newReceivable(t.owner, receivablePayload(t.workspaceId,
    client, {amountCents: 100_000}));
  const receivableId = (open as {receivableId: string}).receivableId;
  await receive(t.owner, await receivePayload(t.workspaceId, receivableId,
    {principalCents: 40_000, interestCents: 2_000}));
  await sync(t.workspaceId);
  const r = await report(t, preset("30d"));
  const cash = exact(r.cash, "caixa");
  assert.equal(cash.receiptsCents, 40_000);
  assert.equal(cash.financial.incomeCents, 2_000);
  const income = exact(r.categories, "categorias").income;
  assert.deepEqual(income.map((item) => [item.categoryKey,
    item.classification, item.amountCents]),
  [["dominio_recebiveis", "receivables", 40_000]]);
  const debts = exact(r.debts, "dívidas");
  assert.equal(debts.receivables.openCents, 60_000);
  assert.equal(debts.loansBorrowed.balanceCents, 0, "recebível não é dívida");
  // Ranking PJ por amostra: valor do recebível por cliente, participação em
  // pontos-base e nome lido do cadastro (por ID, não por texto).
  const ranking = exact(debts.topClients, "ranking de clientes");
  const clientName = (await clientRef(t.workspaceId, client).get()).get("name");
  assert.deepEqual(ranking, [{clientId: client, name: clientName,
    amountCents: 100_000, shareBasisPoints: 10_000}]);
});

test("15 transferência entre contas não é fluxo; saldo total inalterado",
  async () => {
    const t = await seedReportTenant("PF", "rpt15");
    const savings = await createAccount(t, "Poupança", 0);
    await createEntry(t, {type: "receita", amountCents: 80_000});
    await executeCreateCashTransfer(actorOf(t),
      createCashTransferPayloadSchema.parse({
        workspaceId: t.workspaceId,
        idempotencyKey: idempotencyKey(),
        sourceAccountId: t.accountId,
        destinationAccountId: savings,
        amountCents: 30_000,
        date: today(),
      }), "req-rpt15");
    await sync(t.workspaceId);
    const r = await report(t, preset("7d"));
    assert.equal(exact(r.accounts, "contas").totalBalanceCents, 80_000);
    const cash = exact(r.cash, "caixa");
    assert.equal(cash.netFlowCents, 80_000, "transferência não move o total");
    assert.equal(cash.paymentsCents, 0);
  });

test("16 reconciliação: Σ saldos − Σ saldos iniciais = fluxo líquido de " +
  "\"tudo\"; identidade dos componentes", async () => {
  const t = await seedReportTenant("PF", "rpt16");
  await createAccount(t, "Banco", 250_000);
  await createEntry(t, {type: "receita", amountCents: 70_000,
    date: daysAgo(50)});
  await createEntry(t, {type: "despesa", amountCents: 12_345});
  const created = await createLoan(t.owner, loanPayload(t.workspaceId,
    {principalCents: 90_000}));
  await payLoan(t.owner, await loanPaymentPayload(t.workspaceId,
    (created as {loanId: string}).loanId,
    {principalCents: 30_000, interestCents: 1_000}));
  await sync(t.workspaceId);
  const r = await report(t, preset("all"));
  const cash = exact(r.cash, "caixa");
  const accounts = exact(r.accounts, "contas");
  assert.equal(accounts.totalBalanceCents -
    await openingBalancesOf(t.workspaceId), cash.netFlowCents);
  const identity = cash.receiptsCents - cash.paymentsCents +
    cash.financial.resultCents +
    (cash.patrimonial.investmentInflowCents ?? 0) -
    (cash.patrimonial.investmentOutflowCents ?? 0) +
    cash.patrimonial.loanPrincipalInflowCents -
    cash.patrimonial.loanPrincipalOutflowCents - cash.cardPaymentsCents;
  assert.equal(identity, cash.netFlowCents);
});

// ------------------------------------------------------- 4. indicadores

test("17 PJ: margem operacional de caixa em pontos-base; sem recebimentos " +
  "é indisponível", async () => {
  const t = await seedReportTenant("PJ", "rpt17");
  let kpis = exact((await report(t, preset("30d"))).kpis, "kpis");
  assert.equal(kpis.operationalMarginBasisPoints, null);
  await createEntry(t, {type: "receita", amountCents: 90_000});
  await createEntry(t, {type: "despesa", amountCents: 20_000});
  // Entrada não operacional (principal de empréstimo): muda o fluxo líquido
  // total, nunca a margem operacional (D-37.4).
  await createLoan(t.owner, loanPayload(t.workspaceId,
    {principalCents: 300_000}));
  await sync(t.workspaceId);
  const r = await report(t, preset("30d"));
  kpis = exact(r.kpis, "kpis");
  assert.equal(kpis.operationalMarginBasisPoints, 7_778, "70.000 ÷ 90.000");
  const cash = exact(r.cash, "caixa");
  assert.equal(cash.operationalResultCents, 70_000);
  assert.equal(cash.netFlowCents, 370_000,
    "o principal entra só no fluxo total");
  assert.equal(r.workspaceType, "PJ");
});

test("18 Metas PJ (anual) e relatório (ano corrente) reconciliam", async () => {
  const t = await seedReportTenant("PJ", "rpt18");
  await createEntry(t, {type: "receita", amountCents: 150_000});
  await createEntry(t, {type: "despesa", amountCents: 45_000});
  await sync(t.workspaceId);
  const year = today().slice(0, 4);
  const goals = db().collection(`workspaces/${t.workspaceId}/goals`);
  for (const [id, businessType] of [["g-fat", "faturamento"],
    ["g-lucro", "lucro"], ["g-margem", "margem"]] as const) {
    await goals.doc(id).set({workspaceId: t.workspaceId,
      progressSource: "business_kpi", businessType, period: "anual",
      startDate: `${year}-01-01`, deadline: `${year}-12-31`});
  }
  const {results} = await executeGetGoalKpiProgress(actorOf(t),
    {workspaceId: t.workspaceId, goalIds: ["g-fat", "g-lucro", "g-margem"]});
  const r = await report(t, preset("ytd"));
  const cash = exact(r.cash, "caixa");
  const byId = Object.fromEntries(results.map((result) =>
    [result.goalId, result]));
  assert.equal((byId["g-fat"] as {valueCents: number}).valueCents,
    cash.receiptsCents);
  assert.equal((byId["g-lucro"] as {valueCents: number}).valueCents,
    cash.operationalResultCents);
  assert.equal((byId["g-margem"] as {valueBasisPoints: number})
    .valueBasisPoints, exact(r.kpis, "kpis").operationalMarginBasisPoints);
});

test("19 projeção marcada para reconstrução: nenhum número de caixa",
  async () => {
    const t = await seedReportTenant("PF", "rpt19");
    await createEntry(t, {type: "receita", amountCents: 1_000});
    await sync(t.workspaceId);
    await cashProjectionStateRef(t.workspaceId).set({needsRebuild: true},
      {merge: true});
    const r = await report(t, preset("30d"));
    for (const section of [r.cash, r.kpis, r.series, r.categories]) {
      assert.equal(section.status, "rebuild_needed");
      assert.equal(section.data, null);
    }
    assert.ok(exact(r.alerts, "alertas").items
      .some((item) => item.code === "projection_rebuild_needed"));
    // Saldo das contas não depende da projeção.
    assert.equal(exact(r.accounts, "contas").totalBalanceCents, 1_000);
  });

test("20 mês sem detalhe diário (versão anterior) ou com soma divergente: " +
  "aguardando reconstrução", async () => {
  const t = await seedReportTenant("PF", "rpt20");
  const period = monthOf(today());
  const ref = db()
    .doc(`workspaces/${t.workspaceId}/cash_report_periods/${period}`);
  await ref.set({incomeCents: 5_000, netCents: 5_000, transactionCount: 1,
    schemaVersion: 4});
  assert.equal((await report(t, preset("7d"))).cash.status, "rebuild_needed");
  await ref.set({incomeCents: 5_000, netCents: 5_000, transactionCount: 1,
    schemaVersion: 5,
    days: {[today().slice(8)]: {incomeCents: 4_000, netCents: 4_000,
      transactionCount: 1}}});
  assert.equal((await report(t, preset("7d"))).cash.status, "rebuild_needed");
});

test("20b categorias divergentes do caixa (com paridade interna): " +
  "aguardando reconstrução, nunca números incoerentes", async () => {
  const t = await seedReportTenant("PF", "rpt20b");
  await createEntry(t, {type: "despesa", amountCents: 3_000});
  await sync(t.workspaceId);
  const before = await report(t, preset("7d"));
  assert.equal(exact(before.categories, "categorias").expense[0].amountCents,
    3_000);
  // Documento de categoria íntegro por dentro (Σ dias = total), mas com
  // valor diferente do caixa: a conferência categoria × caixa precisa pegar.
  const day = today();
  const ref = db().doc(`workspaces/${t.workspaceId}/cash_category_years/` +
    `g0__${day.slice(0, 4)}__${t.expenseCategoryId}`);
  const mmdd = day.slice(5, 7) + day.slice(8, 10);
  await ref.update({
    expenseCents: 4_000,
    [`days.${mmdd}.expenseCents`]: 4_000,
  });
  const after = await report(t, preset("7d"));
  assert.equal(after.categories.status, "rebuild_needed");
  assert.equal(after.categories.reason, "category_cash_parity");
  assert.equal(after.categories.data, null);
  // O caixa continua exato: a divergência é só da projeção por categoria.
  assert.equal(exact(after.cash, "caixa").paymentsCents, 3_000);
});

test("21 base insuficiente: taxa e margem indisponíveis, nunca zero",
  async () => {
    const t = await seedReportTenant("PF", "rpt21");
    await createEntry(t, {type: "despesa", amountCents: 1_000});
    await sync(t.workspaceId);
    const r = await report(t, preset("30d"));
    const kpis = exact(r.kpis, "kpis");
    assert.equal(kpis.operationalMarginBasisPoints, null);
    assert.equal(kpis.netContributionRateBasisPoints, null);
    assert.equal(kpis.netContributionRateReason, "no_receipts",
      "o motivo é a base, não os investimentos");
    assert.ok(exact(r.alerts, "alertas").items
      .some((item) => item.code === "insufficient_base"));
  });

test("22 réplica do mesmo evento não soma duas vezes", async () => {
  const t = await seedReportTenant("PF", "rpt22");
  await createEntry(t, {type: "receita", amountCents: 2_000});
  const doc = (await db()
    .collection(`workspaces/${t.workspaceId}/transactions`).get()).docs[0];
  const event = {
    eventId: `evt-replay-${t.workspaceId}`,
    workspaceId: t.workspaceId,
    transactionId: doc.id,
    eventTime: doc.updateTime,
    before: undefined,
    after: doc.data(),
  };
  await handleTransactionWrite(event);
  await handleTransactionWrite(event);
  const r = await report(t, preset("7d"));
  assert.equal(exact(r.cash, "caixa").receiptsCents, 2_000);
  assert.equal(exact(r.categories, "categorias").income[0].amountCents,
    2_000);
});

test("23 escritas concorrentes: totais, dias e categorias fecham com o " +
  "ledger", async () => {
  const t = await seedReportTenant("PF", "rpt23");
  const amounts = Array.from({length: 12}, (_, index) => (index + 1) * 100);
  await Promise.all(amounts.map((amountCents, index) => createEntry(t, {
    type: index % 2 === 0 ? "receita" : "despesa", amountCents,
    date: daysAgo(index % 5),
  })));
  const docs = (await db()
    .collection(`workspaces/${t.workspaceId}/transactions`).get()).docs;
  await Promise.all(docs.map((doc) => handleTransactionWrite({
    eventId: `evt-conc-${doc.id}`,
    workspaceId: t.workspaceId,
    transactionId: doc.id,
    eventTime: doc.updateTime,
    before: undefined,
    after: doc.data(),
  })));
  const r = await report(t, preset("7d"));
  const cash = exact(r.cash, "caixa");
  const receipts = amounts.filter((_, index) => index % 2 === 0)
    .reduce((sum, value) => sum + value, 0);
  const payments = amounts.filter((_, index) => index % 2 === 1)
    .reduce((sum, value) => sum + value, 0);
  assert.equal(cash.receiptsCents, receipts);
  assert.equal(cash.paymentsCents, payments);
  assert.equal(exact(r.accounts, "contas").totalBalanceCents,
    receipts - payments);
  for (const period of new Set(Array.from({length: 5},
    (_, index) => monthOf(daysAgo(index))))) {
    await assertMonthParity(t, period);
  }
  assert.equal(r.categories.status, "exact");
});
