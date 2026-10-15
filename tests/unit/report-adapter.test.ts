import assert from 'node:assert/strict';
import test from 'node:test';

import {
  alertTexts,
  blockViewOf,
  categoryDisplayName,
  toDashboardSummary,
  toReportSnapshot,
} from '../../src/modules/reports/adapter.ts';
import { formatBasisPoints, formatCents } from '../../src/modules/reports/format.ts';
import type {
  CardItem,
  CardsReport,
  CashReport,
  CategoryItem,
  DebtsReport,
  FinancialReport,
  InvestmentsReport,
  ReportAlert,
  ReportSectionResult,
  SeriesPoint,
} from '../../src/modules/reports/official.ts';

/** O formatador do Intl separa "R$" do número com NBSP; os textos comparam com espaço comum. */
const plain = (text: string | undefined): string => (text ?? '').replace(/ /g, ' ');

const ok = <T,>(data: T): ReportSectionResult<T> => ({ status: 'exact', data });
const without = <T,>(
  status: ReportSectionResult<T>['status'],
): ReportSectionResult<T> => ({ status, data: null });

const cash = (overrides: Partial<CashReport> = {}): CashReport => ({
  receiptsCents: 500_000,
  paymentsCents: 320_000,
  operationalResultCents: 180_000,
  financial: { incomeCents: 0, expenseCents: 0, resultCents: 0 },
  patrimonial: {
    investmentOutflowCents: 50_000,
    investmentInflowCents: 0,
    loanPrincipalInflowCents: 0,
    loanPrincipalOutflowCents: 0,
  },
  cardPaymentsCents: 90_000,
  netFlowCents: 40_000,
  transactionCount: 12,
  ...overrides,
});

const point = (month: string, partial = false): SeriesPoint => ({
  month,
  startDate: `${month}-01`,
  endDate: `${month}-28`,
  partial,
  receiptsCents: 100_000,
  paymentsCents: 60_000,
  operationalResultCents: 40_000,
  cardPaymentsCents: 10_000,
  netFlowCents: 25_000,
});

const cardItem = (overrides: Partial<CardItem> = {}): CardItem => ({
  cardId: 'card_1',
  name: 'Cartão Azul',
  status: 'active',
  limitTotalCents: 1_000_000,
  limitUsedCents: 400_000,
  limitAvailableCents: 600_000,
  utilizationBasisPoints: 4_000,
  currentInvoice: {
    invoiceId: 'inv_1',
    competenceMonth: '2026-10',
    dueDate: '2026-10-20',
    cycleStatus: 'open',
    paymentStatus: 'unpaid',
    payableCents: 150_000,
    effectivelyClosed: false,
  },
  outstandingCents: 400_000,
  futureCommittedCents: 250_000,
  overdueCents: 30_000,
  dueNext7Cents: 20_000,
  dueNext15Cents: 40_000,
  dueNext30Cents: 150_000,
  purchasesCents: 80_000,
  purchaseCount: 4,
  paidCents: 70_000,
  reversedCents: 5_000,
  openCreditCents: 0,
  ...overrides,
});

const cards = (overrides: Partial<CardsReport> = {}): CardsReport => ({
  purchases: { netCents: 80_000, count: 4 },
  payments: { paidCents: 70_000, reversedCents: 5_000, netCents: 65_000 },
  obligations: {
    openCyclesCents: 150_000,
    closedUnpaidCents: 250_000,
    overdueCents: 30_000,
    overdueCount: 2,
    partiallyPaidCount: 0,
    partiallyPaidRemainingCents: 0,
    dueNext7Cents: 20_000,
    dueNext15Cents: 40_000,
    dueNext30Cents: 150_000,
    totalOutstandingCents: 400_000,
    openCreditCents: 0,
  },
  limits: { totalCents: 1_000_000, usedCents: 400_000, availableCents: 600_000, utilizationBasisPoints: 4_000 },
  cards: [cardItem()],
  purchaseSeries: [
    { month: '2026-08', netCents: 30_000, count: 2 },
    { month: '2026-09', netCents: 50_000, count: 2 },
  ],
  purchaseSeriesStartMonth: null,
  ...overrides,
});

const debts = (overrides: Partial<DebtsReport> = {}): DebtsReport => ({
  loansBorrowed: { balanceCents: 700_000, count: 1, overdueBalanceCents: 0, overdueCount: 0 },
  loansLent: { balanceCents: 90_000, count: 1, overdueBalanceCents: 0, overdueCount: 0 },
  cardObligationsCents: 400_000,
  receivables: {
    openCents: 300_000,
    openCount: 5,
    overdueCents: 100_000,
    overdueCount: 2,
    dueNext30Cents: 120_000,
    receivedCents: 80_000,
    receivedCount: 3,
  },
  topClients: ok([
    { clientId: 'c1', name: 'Cliente A', amountCents: 200_000, shareBasisPoints: 6_667 },
    { clientId: 'c2', name: null, amountCents: 100_000, shareBasisPoints: 3_333 },
  ]),
  ...overrides,
});

const investments = (overrides: Partial<InvestmentsReport> = {}): InvestmentsReport => ({
  patrimony: { currentValueCents: 900_000, costCents: 800_000, unrealizedResultCents: 100_000 },
  flows: {
    contributionsCents: 60_000,
    redemptionsPrincipalCents: 10_000,
    netContributionsCents: 50_000,
    realizedGainCents: 3_000,
    realizedLossCents: 1_000,
    realizedResultCents: 2_000,
    feesCents: 0,
    taxCents: 500,
  },
  evolution: [
    { month: '2026-09', closingValueCents: 850_000 },
    { month: '2026-10', closingValueCents: 900_000 },
  ],
  reconciliationDifferenceCents: null,
  ...overrides,
});

const category = (overrides: Partial<CategoryItem> = {}): CategoryItem => ({
  categoryKey: 'catalog:cat_a',
  categoryId: 'cat_a',
  classification: 'catalog',
  name: 'Moradia',
  amountCents: 200_000,
  shareBasisPoints: 6_250,
  transactionCount: 3,
  ...overrides,
});

const report = (overrides: Partial<FinancialReport> = {}): FinancialReport => ({
  schemaVersion: 1,
  workspaceType: 'PF',
  generatedAt: '2026-10-09T15:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  currency: 'BRL',
  referenceDate: '2026-10-09',
  period: {
    range: { kind: 'preset', preset: '30d' },
    startDate: '2026-09-10',
    endDate: '2026-10-09',
    boundaries: 'inclusive',
    dayCount: 30,
    future: false,
  },
  permissions: { investments: true },
  accounts: ok({ totalBalanceCents: 1_234_56, accountCount: 2, negativeAccountCount: 0 }),
  cash: ok(cash()),
  kpis: ok({ operationalMarginBasisPoints: 3_600, netContributionRateBasisPoints: 1_000, netContributionRateReason: null }),
  series: ok({ granularity: 'month' as const, sparse: false, points: [point('2026-09'), point('2026-10', true)] }),
  categories: ok({
    expense: [
      category(),
      category({ categoryKey: 'uncategorized', categoryId: null, classification: 'uncategorized', name: null, amountCents: 60_000, shareBasisPoints: 1_875 }),
      category({ categoryKey: 'receivables', categoryId: null, classification: 'receivables', name: null, amountCents: 40_000, shareBasisPoints: 1_250 }),
      category({ categoryKey: 'split', categoryId: null, classification: 'split', name: null, amountCents: 20_000, shareBasisPoints: 625 }),
      category({ categoryKey: 'catalog:gone', categoryId: 'gone', name: null, amountCents: 0, shareBasisPoints: 0 }),
    ],
    income: [],
  }),
  cards: ok(cards()),
  debts: ok(debts()),
  investments: ok(investments()),
  alerts: ok({ items: [] }),
  ...overrides,
});

const adapt = (dto: FinancialReport, type: 'PF' | 'PJ' = dto.workspaceType) => toReportSnapshot(dto, type);
const kpi = (dto: FinancialReport, id: string, type: 'PF' | 'PJ' = dto.workspaceType) =>
  adapt(dto, type).snapshot.kpis.find((item) => item.id === id);

test('P5-C1 — formatação: centavos em R$ e pontos-base em % pt-BR', () => {
  assert.equal(plain(formatCents(123_456)), 'R$ 1.234,56');
  assert.equal(plain(formatCents(0)), 'R$ 0,00');
  assert.equal(plain(formatCents(-5)), '-R$ 0,05');
  assert.equal(formatBasisPoints(1_234), '12,34%');
  assert.equal(formatBasisPoints(-250), '-2,50%');
  assert.equal(formatBasisPoints(0), '0,00%');
  assert.equal(formatBasisPoints(15_000), '150,00%');
  assert.equal(formatBasisPoints(5), '0,05%');
});

test('P5-C1 — KPIs PF: ids mantidos, resultado operacional e taxa de aportes líquidos', () => {
  const { snapshot } = adapt(report());
  assert.deepEqual(snapshot.kpis.map((item) => item.id), [
    'kpi-income', 'kpi-expenses', 'kpi-investments', 'kpi-balance', 'kpi-net-contribution-rate',
  ]);
  assert.equal(snapshot.kpis.some((item) => item.id === 'kpi-savings'), false);
  assert.equal(plain(kpi(report(), 'kpi-income')?.formattedValue), 'R$ 5.000,00');
  assert.equal(plain(kpi(report(), 'kpi-expenses')?.formattedValue), 'R$ 3.200,00');
  assert.equal(plain(kpi(report(), 'kpi-investments')?.formattedValue), 'R$ 600,00');
  const balance = kpi(report(), 'kpi-balance');
  assert.equal(balance?.label, 'Resultado operacional');
  assert.equal(plain(balance?.formattedValue), 'R$ 1.800,00');
  assert.equal(plain(balance?.description), 'Fluxo líquido total: R$ 400,00');
  const rate = kpi(report(), 'kpi-net-contribution-rate');
  assert.equal(rate?.label, 'Taxa de Aportes Líquidos');
  assert.equal(rate?.formattedValue, '10,00%');
  assert.equal(snapshot.workspaceType, 'PF');
  assert.equal(snapshot.periodLabel, 'Últimos 30 dias');
});

test('P5-C1 — KPIs PJ (D-37.4): caixa operacional, sem lucro, faturamento nem limiar de 15%', () => {
  const dto = report({ workspaceType: 'PJ' });
  const { snapshot } = adapt(dto);
  assert.deepEqual(snapshot.kpis.map((item) => item.id), [
    'kpi-gross-revenue', 'kpi-profit-margin', 'kpi-receivables-total', 'kpi-debt-total',
  ]);
  assert.equal(snapshot.kpis[0].label, 'Recebimentos operacionais realizados');
  assert.equal(plain(snapshot.kpis[0].formattedValue), 'R$ 5.000,00');
  assert.equal(snapshot.kpis[1].label, 'Margem operacional de caixa');
  assert.equal(snapshot.kpis[1].formattedValue, '36,00%');
  assert.equal(
    plain(snapshot.kpis[1].description),
    'Resultado operacional de caixa: R$ 1.800,00 · Pagamentos operacionais realizados: R$ 3.200,00',
  );
  assert.equal(plain(snapshot.kpis[2].formattedValue), 'R$ 3.000,00');
  assert.equal(plain(snapshot.kpis[3].formattedValue), 'R$ 7.000,00');
  for (const item of snapshot.kpis) {
    assert.equal(item.trend === 'up' || item.trend === 'down', false, item.id);
  }
  const text = JSON.stringify(snapshot.kpis).toLowerCase();
  for (const forbidden of ['lucro', 'ebitda', 'faturamento', 'net-profit']) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.equal(snapshot.workspaceType, 'PJ');
});

test('P5-C1 — estados do caixa nunca viram "R$ 0,00": indisponível e reconstrução', () => {
  const cases: Array<[ReportSectionResult<CashReport>['status'], string]> = [
    ['unavailable', 'Indisponível no momento.'],
    ['rebuild_needed', 'Aguardando reconstrução dos totais.'],
  ];
  for (const [status, message] of cases) {
    const dto = report({ cash: without(status), kpis: without('rebuild_needed'), series: without(status) });
    const { snapshot, view } = adapt(dto);
    assert.equal(view.blocks.cash.hasNumbers, false, status);
    assert.equal(view.blocks.cash.message, message, status);
    for (const id of ['kpi-income', 'kpi-expenses', 'kpi-balance']) {
      const item = snapshot.kpis.find((entry) => entry.id === id);
      assert.equal(item?.value, null, `${status} ${id}`);
      assert.equal(item?.formattedValue, '—', `${status} ${id}`);
      assert.equal(item?.description, message, `${status} ${id}`);
    }
    assert.equal(snapshot.cashFlow.length, 0, status);
    assert.equal(view.cashFlowRows.length, 0, status);
    assert.equal(
      JSON.stringify(snapshot.kpis.filter((item) => item.id !== 'kpi-investments')).includes('R$'),
      false,
      status,
    );
    const dashboard = toDashboardSummary(dto);
    assert.equal(dashboard.income.cents, null, status);
    assert.equal(dashboard.income.message, message, status);
    assert.equal(dashboard.chart, null, status);
    assert.equal(dashboard.chartMessage, message, status);
  }
});

test('P5-C1 — zero verdadeiro é número válido; lista vazia tem texto próprio', () => {
  const dto = report({
    cash: { status: 'zero', data: cash({ receiptsCents: 0, paymentsCents: 0, operationalResultCents: 0, netFlowCents: 0, cardPaymentsCents: 0 }) },
    kpis: ok({ operationalMarginBasisPoints: null, netContributionRateBasisPoints: null, netContributionRateReason: 'no_receipts' }),
    series: { status: 'zero', data: { granularity: 'month', sparse: false, points: [] } },
    categories: { status: 'zero', data: { expense: [], income: [] } },
  });
  const { snapshot, view } = adapt(dto);
  assert.equal(plain(kpi(dto, 'kpi-income')?.formattedValue), 'R$ 0,00');
  assert.equal(view.blocks.cash.hasNumbers, true);
  assert.equal(snapshot.expenseCategories.length, 0);
  assert.equal(view.blocks.categories.hasNumbers, true);
  // Sem recebimentos: a taxa fica indisponível (nunca 0,00%).
  const rate = kpi(dto, 'kpi-net-contribution-rate');
  assert.equal(rate?.formattedValue, '—');
  assert.equal(rate?.description, 'Indisponível: sem recebimentos no período.');
  assert.equal(snapshot.cashFlow.length, 0);
});

test('P5-C1 — truncado e amostra mantêm os números com nota de cobertura', () => {
  const truncated = report({ cash: { status: 'truncated', data: cash() } });
  const { snapshot, view } = adapt(truncated);
  assert.equal(view.blocks.cash.hasNumbers, true);
  assert.equal(view.blocks.cash.note, 'Parcial: limite de leitura atingido.');
  assert.match(plain(snapshot.kpis[0].description), /Parcial: limite de leitura atingido\./);
  assert.equal(plain(snapshot.kpis[0].formattedValue), 'R$ 5.000,00');

  const sample = report({ debts: { status: 'sample', data: debts({ topClients: { status: 'sample', data: debts().topClients.data } }) } });
  const sampled = adapt(sample, 'PJ');
  assert.equal(sampled.view.blocks.debts.status, 'sample');
  assert.equal(sampled.view.blocks.topClients.note, 'Ranking calculado sobre os 500 vencimentos mais recentes.');
  assert.equal(sampled.view.topClientsNote, 'Ranking calculado sobre os 500 vencimentos mais recentes.');
  assert.equal(sampled.snapshot.topClients?.length, 2);

  // Bloco "truncado/amostra" sem dados não vira número.
  assert.equal(blockViewOf({ status: 'truncated', data: null }).hasNumbers, false);
  assert.equal(blockViewOf({ status: 'sample', data: null }).message, 'Indisponível no momento.');
});

test('P5-C1 — taxa de aportes indisponível diz o motivo do servidor (sem recebimentos × investimentos)', () => {
  const noReceipts = adapt(report({
    kpis: ok({ operationalMarginBasisPoints: null, netContributionRateBasisPoints: null, netContributionRateReason: 'no_receipts' }),
  })).snapshot.kpis.find((item) => item.id === 'kpi-net-contribution-rate');
  assert.equal(noReceipts?.formattedValue, '—');
  assert.equal(noReceipts?.description, 'Indisponível: sem recebimentos no período.');
  // Investimentos aguardando reconstrução: o motivo é o bloco, não a base.
  const rebuild = adapt(report({
    investments: without('rebuild_needed'),
    kpis: ok({ operationalMarginBasisPoints: 3_600, netContributionRateBasisPoints: null, netContributionRateReason: 'investments_unavailable' }),
  })).snapshot.kpis;
  const rate = rebuild.find((item) => item.id === 'kpi-net-contribution-rate');
  assert.equal(rate?.value, null);
  assert.equal(rate?.description, 'Aguardando reconstrução dos totais.');
  const investmentsKpi = rebuild.find((item) => item.id === 'kpi-investments');
  assert.equal(investmentsKpi?.formattedValue, '—');
  assert.equal(investmentsKpi?.description, 'Aguardando reconstrução dos totais.');
  // Bloco de investimentos não pedido (ex.: widget): texto próprio, nunca "sem recebimentos".
  const widget = adapt(report({
    investments: { status: 'not_requested', data: null },
    kpis: ok({ operationalMarginBasisPoints: 3_600, netContributionRateBasisPoints: null, netContributionRateReason: 'investments_unavailable' }),
  })).snapshot.kpis.find((item) => item.id === 'kpi-net-contribution-rate');
  assert.equal(widget?.description, 'Indisponível: dados de investimentos indisponíveis no momento.');
});

test('P5-C1 — viewer (D-15): fluxos, taxa e card do Dashboard exibidos; patrimônio "Sem permissão", sem zero', () => {
  const dto = report({
    permissions: { investments: false },
    investments: ok(investments({ patrimony: null, reconciliationDifferenceCents: null })),
  });
  const { snapshot, view } = adapt(dto);
  const investmentsKpi = snapshot.kpis.find((item) => item.id === 'kpi-investments');
  assert.equal(investmentsKpi?.formattedValue, formatCents(dto.investments.data!.flows.contributionsCents));
  const rate = snapshot.kpis.find((item) => item.id === 'kpi-net-contribution-rate');
  assert.notEqual(rate?.value, null);
  assert.equal(snapshot.investmentOverview?.currentValue, null);
  assert.equal(snapshot.investmentOverview?.cost, null);
  assert.equal(snapshot.investmentOverview?.unrealizedGain, null);
  assert.equal(snapshot.investmentOverview?.contributions, dto.investments.data!.flows.contributionsCents / 100);
  assert.equal(view.investmentsPermitted, false);
  assert.equal(view.blocks.investments.hasNumbers, true);
  assert.equal(view.investmentNote, 'Sem permissão para ver o patrimônio investido.');
  const dashboard = toDashboardSummary(dto);
  assert.equal(dashboard.investments.cents, dto.investments.data!.flows.contributionsCents);
  assert.ok(dashboard.chart?.some((item) => item.name === 'Investimentos'));
});

test('P5-C1 — série com mais de 12 meses: tabela mostra os 12 mais recentes com nota; gráfico, todos', () => {
  const months = Array.from({ length: 14 }, (_, index) => {
    const total = 2025 * 12 + 9 + index; // 2025-09 … 2026-10
    const year = Math.floor((total - 1) / 12);
    const month = ((total - 1) % 12) + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
  });
  const dto = report({
    series: ok({ granularity: 'month' as const, sparse: false, points: months.map((month, index) => point(month, index === 13)) }),
  });
  const { snapshot, view } = adapt(dto);
  assert.equal(snapshot.cashFlow.length, 14);
  assert.equal(snapshot.cashFlow[0].month, '2026-10');
  assert.equal(snapshot.cashFlow[0].partial, true);
  assert.equal(view.cashFlowRows.length, 12);
  assert.equal(view.cashFlowRows[0].month, '2026-10');
  assert.equal(view.cashFlowRows[11].month, months[2]);
  assert.equal(view.cashFlowNote, 'Exibindo os 12 meses mais recentes do período.');
  // Resultado da tabela é o resultado operacional (sem taxa de poupança).
  assert.equal(view.cashFlowRows[0].operationalResult, 400);
  assert.equal('savingsRate' in view.cashFlowRows[0], false);

  const short = adapt(report()).view;
  assert.equal(short.cashFlowNote, null);
  assert.equal(short.cashFlowRows.length, 2);
});

test('P5-C1 — categorias: nome do catálogo, rótulos fixos e categoria removida', () => {
  const { snapshot } = adapt(report());
  assert.deepEqual(snapshot.expenseCategories.map((item) => item.categoryName), [
    'Moradia', 'Sem categoria', 'Recebimentos de clientes', 'Divisão de contas', 'Categoria removida',
  ]);
  assert.equal(snapshot.expenseCategories[0].percentageOfTotal, 62.5);
  assert.equal(snapshot.expenseCategories[0].totalAmount, 2000);
  assert.equal(snapshot.expenseCategories[0].categoryId, 'cat_a');
  assert.equal(categoryDisplayName(category({ name: ' ' })), 'Categoria removida');
  const nullShare = adapt(report({
    categories: ok({ expense: [category({ shareBasisPoints: null })], income: [] }),
  })).snapshot.expenseCategories[0];
  assert.equal(nullShare.percentageOfTotal, null);
});

test('P5-C1 — cartões e dívidas: do bloco de cartões e de empréstimos tomados', () => {
  const { snapshot, view } = adapt(report());
  const profile = snapshot.debtProfile;
  assert.equal(profile.totalCreditCardDebt, 4000);
  assert.equal(profile.totalLoans, 7000);
  assert.equal(profile.creditCardLimitUsed, 4000);
  assert.equal(profile.creditCardTotalLimit, 10000);
  assert.equal(profile.creditCardAvailableLimit, 6000);
  assert.equal(profile.creditCardOpenInvoiceBalance, 1500);
  assert.equal(profile.creditCardFutureCommittedBalance, 2500);
  assert.equal(profile.creditCardOverdueAmount, 300);
  assert.equal(profile.creditCardDueNext30Days, 1500);
  assert.equal(profile.utilizationRate, 40);
  assert.equal('riskLevel' in profile, false);
  const [indicator] = snapshot.creditCardIndicators;
  assert.equal(indicator.cardName, 'Cartão Azul');
  assert.equal(indicator.openInvoiceBalance, 1500);
  assert.equal(indicator.utilizationRate, 40);
  assert.equal(indicator.currentInvoiceDueDate, '2026-10-20');
  assert.equal(indicator.currentInvoiceStatus, 'open');
  assert.equal(indicator.registeredPaymentsAmount, 700);
  assert.equal(indicator.reversedPaymentsAmount, 50);
  assert.equal(view.cardsNote, 'Compras no cartão aparecem na visão de consumo; o pagamento da fatura é a saída de caixa.');

  const views = snapshot.creditCardExpenseReportViews;
  assert.deepEqual(views.purchaseCompetence.map((item) => item.period), ['2026-09', '2026-08']);
  assert.equal(views.purchaseCompetence[0].amount, 500);
  assert.equal(views.purchaseCompetence[0].count, 2);
  // Pagamento da fatura vem da série de caixa; contagem não existe nesse recorte.
  assert.deepEqual(views.invoicePaymentDate.map((item) => item.period), ['2026-10', '2026-09']);
  assert.equal(views.invoicePaymentDate[0].amount, 100);
  assert.equal(views.invoicePaymentDate[0].count, null);
  assert.equal(views.cardAnalytics[0].paidAmount, 650);
  assert.equal(views.cardAnalytics[0].openInvoiceBalance, 1500);
  assert.equal(views.cardAnalytics[0].purchaseCount, 4);

  // Sem limite: utilização nula, nunca 0%.
  const noLimit = adapt(report({
    cards: ok(cards({
      limits: { totalCents: 0, usedCents: 0, availableCents: 0, utilizationBasisPoints: null },
      cards: [cardItem({ limitTotalCents: 0, limitUsedCents: 0, limitAvailableCents: 0, utilizationBasisPoints: null, currentInvoice: null })],
    })),
  })).snapshot;
  assert.equal(noLimit.debtProfile.utilizationRate, null);
  assert.equal(noLimit.creditCardIndicators[0].utilizationRate, null);
  assert.equal(noLimit.creditCardIndicators[0].currentInvoiceId, undefined);
  assert.equal(noLimit.creditCardIndicators[0].openInvoiceBalance, null);

  // Série de compras limitada a 36 meses recebe nota.
  const limited = adapt(report({ cards: ok(cards({ purchaseSeriesStartMonth: '2023-11' })) })).view;
  assert.match(limited.purchaseSeriesNote ?? '', /^Compras exibidas a partir de /);
});

test('P5-C1.1 — cartão sem próxima fatura a pagar: valor nulo, nunca 0 fingindo fatura', () => {
  const withInvoice = cardItem({ cardId: 'card_a', name: 'Cartão A' });
  const withoutInvoice = cardItem({
    cardId: 'card_b',
    name: 'Cartão B',
    currentInvoice: null,
    outstandingCents: 200_000,
    futureCommittedCents: 200_000,
    overdueCents: 0,
  });
  const { snapshot } = adapt(report({ cards: ok(cards({ cards: [withInvoice, withoutInvoice] })) }));
  const [first, second] = snapshot.creditCardIndicators;
  assert.equal(first.openInvoiceBalance, 1500);
  assert.equal(second.openInvoiceBalance, null);
  assert.equal(second.futureCommittedBalance, 2000);
  assert.equal(second.overdueAmount, 0);
  assert.equal(second.currentInvoiceId, undefined);
  const analytics = snapshot.creditCardExpenseReportViews.cardAnalytics;
  assert.equal(analytics[0].openInvoiceBalance, 1500);
  assert.equal(analytics[1].openInvoiceBalance, null);
  // O total soma só os cartões com próxima fatura a pagar (o sem fatura contribui 0).
  assert.equal(snapshot.debtProfile.creditCardOpenInvoiceBalance, 1500);
  assert.equal(snapshot.debtProfile.creditCardFutureCommittedBalance, 4500);
});

test('P5-C1.1 — atraso, próxima fatura a pagar e futuro são classes disjuntas que somam o saldo pendente', () => {
  const card = cardItem({
    currentInvoice: {
      invoiceId: 'inv_current',
      competenceMonth: '2026-10',
      dueDate: '2026-10-20',
      cycleStatus: 'closed',
      paymentStatus: 'unpaid',
      payableCents: 30_000,
      effectivelyClosed: true,
    },
    overdueCents: 10_000,
    futureCommittedCents: 20_000,
    outstandingCents: 60_000,
  });
  const { snapshot } = adapt(report({ cards: ok(cards({ cards: [card] })) }));
  const [indicator] = snapshot.creditCardIndicators;
  assert.equal(indicator.openInvoiceBalance, 300);
  assert.equal(indicator.futureCommittedBalance, 200);
  assert.equal(indicator.overdueAmount, 100);
  assert.equal(indicator.currentInvoiceStatus, 'unpaid');
  assert.equal(((indicator.openInvoiceBalance ?? 0) + indicator.futureCommittedBalance + indicator.overdueAmount) * 100, card.outstandingCents);
  const [analytic] = snapshot.creditCardExpenseReportViews.cardAnalytics;
  assert.equal(analytic.openInvoiceBalance, 300);
  assert.equal(analytic.futureCommittedBalance, 200);
  assert.equal(analytic.overdueAmount, 100);
});

test('P5-C1.1 — cartão arquivado com saldo: nos indicadores, com atraso e sem utilização; fora da visão por cartão', () => {
  const active = cardItem({ cardId: 'card_a', name: 'Cartão A' });
  const archived = cardItem({
    cardId: 'card_z',
    name: 'Cartão Arquivado',
    status: 'archived',
    utilizationBasisPoints: null,
    currentInvoice: null,
    outstandingCents: 5_000,
    futureCommittedCents: 0,
    overdueCents: 5_000,
  });
  const { snapshot } = adapt(report({ cards: ok(cards({ cards: [active, archived] })) }));
  const indicator = snapshot.creditCardIndicators.find((card) => card.cardId === 'card_z');
  assert.ok(indicator);
  assert.equal(indicator.status, 'archived');
  assert.equal(indicator.overdueAmount, 50);
  assert.equal(indicator.openInvoiceBalance, null);
  assert.equal(indicator.utilizationRate, null);
  assert.deepEqual(snapshot.creditCardExpenseReportViews.cardAnalytics.map((card) => card.cardId), ['card_a']);
});

test('P5-C1 — bloco de cartões sem número não gera valores exibíveis', () => {
  for (const status of ['unavailable', 'rebuild_needed'] as const) {
    const { snapshot, view } = adapt(report({ cards: without(status) }));
    assert.equal(view.blocks.cards.hasNumbers, false, status);
    assert.equal(snapshot.creditCardIndicators.length, 0, status);
    assert.equal(snapshot.debtProfile.utilizationRate, null, status);
    assert.equal(snapshot.creditCardExpenseReportViews.purchaseCompetence.length, 0, status);
    assert.equal(snapshot.creditCardExpenseReportViews.cardAnalytics.length, 0, status);
  }
});

test('P5-C1 — recebíveis e clientes (PJ): em dia, em atraso e recebido', () => {
  const { snapshot } = adapt(report({ workspaceType: 'PJ' }));
  assert.deepEqual(snapshot.receivablesStatus?.map((item) => [item.status, item.count, item.totalValue]), [
    ['Em dia', 3, 2000],
    ['Recebido', 3, 800],
    ['Em atraso', 2, 1000],
  ]);
  assert.deepEqual(snapshot.topClients?.map((item) => [item.clientName, item.totalValue, item.percentage]), [
    ['Cliente A', 2000, 66.67],
    ['Cliente', 1000, 33.33],
  ]);
  // PF não recebe indicadores de recebíveis.
  const personal = adapt(report()).snapshot;
  assert.equal(personal.receivablesStatus, undefined);
  assert.equal(personal.topClients, undefined);
  // Dívida bancária também no PF (acabou o zero fixo).
  assert.equal(personal.debtProfile.totalLoans, 7000);
  // Bloco de dívidas indisponível: nada de recebíveis nem de dívida zerada.
  const unavailable = adapt(report({ workspaceType: 'PJ', debts: without('unavailable') }));
  assert.equal(unavailable.snapshot.receivablesStatus, undefined);
  assert.equal(unavailable.view.blocks.topClients.message, 'Indisponível no momento.');
  assert.equal(unavailable.snapshot.kpis.find((item) => item.id === 'kpi-debt-total')?.formattedValue, '—');
});

test('P5-C1 — investimentos: patrimônio, fluxos e evolução em reais de exibição', () => {
  const { snapshot, view } = adapt(report({
    investments: ok(investments({ reconciliationDifferenceCents: 1_500 })),
  }));
  const overview = snapshot.investmentOverview;
  assert.ok(overview);
  assert.equal(overview.currentValue, 9000);
  assert.equal(overview.contributions, 600);
  assert.equal(overview.redeemedPrincipal, 100);
  assert.equal(overview.realizedResult, 20);
  assert.equal(overview.taxes, 5);
  assert.deepEqual(overview.evolution, [
    { period: '2026-09', currentValue: 8500 },
    { period: '2026-10', currentValue: 9000 },
  ]);
  assert.match(plain(view.investmentNote ?? ''), /R\$ 15,00/);
  assert.equal(adapt(report()).view.investmentNote, null);
  const rebuilding = adapt(report({ investments: without('rebuild_needed') })).view;
  assert.equal(rebuilding.blocks.investments.message, 'Aguardando reconstrução dos totais.');
});

test('P5-C1 — alertas objetivos com texto em pt-BR por código (sem persistência)', () => {
  const items: ReportAlert[] = [
    { code: 'overdue_card_invoices', severity: 'critical', values: { overdueCents: 123_456, overdueCount: 2 } },
    { code: 'negative_account_balance', severity: 'warning', values: { totalBalanceCents: -5_000, negativeAccountCount: 1 } },
    { code: 'negative_operational_result', severity: 'warning', values: { operationalResultCents: -100, receiptsCents: 900, paymentsCents: 1_000 } },
    { code: 'card_invoices_due_soon', severity: 'info', values: { dueNext7Cents: 20_000 } },
    { code: 'overdue_borrowed_loans', severity: 'critical', values: { overdueBalanceCents: 8_000, overdueCount: 1 } },
    { code: 'overdue_receivables', severity: 'warning', values: { overdueCents: 7_000, overdueCount: 3 } },
    { code: 'insufficient_base', severity: 'info', values: { receiptsCents: 0 } },
    { code: 'projection_rebuild_needed', severity: 'warning', values: {} },
  ];
  const { snapshot } = adapt(report({ alerts: ok({ items }) }));
  assert.equal(snapshot.alerts.length, 8);
  const byId = Object.fromEntries(snapshot.alerts.map((alert) => [alert.id, alert]));
  assert.equal(plain(byId.overdue_card_invoices.message), '2 faturas vencidas somam R$ 1.234,56.');
  assert.equal(byId.overdue_card_invoices.severity, 'critical');
  assert.equal(plain(byId.negative_account_balance.message), '1 conta está com saldo negativo. Saldo total das contas: -R$ 50,00.');
  assert.match(plain(byId.negative_operational_result.message), /pagamentos operacionais \(R\$ 10,00\) superaram .*\(R\$ 9,00\)/);
  assert.match(plain(byId.card_invoices_due_soon.message), /R\$ 200,00/);
  assert.match(plain(byId.overdue_borrowed_loans.message), /1 empréstimo tomado está em atraso.*R\$ 80,00/);
  assert.match(plain(byId.overdue_receivables.message), /3 recebíveis estão em atraso.*R\$ 70,00/);
  assert.match(byId.insufficient_base.message, /recebimentos/);
  assert.match(byId.projection_rebuild_needed.message, /reconstrução/);
  for (const alert of snapshot.alerts) {
    assert.equal(alert.createdAt, '2026-10-09T15:00:00.000Z');
    assert.equal(/[a-z]+_[a-z_]+/.test(`${alert.title} ${alert.message}`), false, alert.id);
  }
  // Valor ausente nunca vira R$ 0,00 no texto; código desconhecido tem texto neutro.
  assert.equal(alertTexts({ code: 'overdue_card_invoices', severity: 'critical', values: {} }).message, 'Há faturas de cartão vencidas.');
  assert.equal(alertTexts({ code: 'novo' as never, severity: 'info', values: {} }).title, 'Alerta financeiro');
  // Alertas indisponíveis não afirmam "nenhum alerta".
  const unavailable = adapt(report({ alerts: without('unavailable') }));
  assert.equal(unavailable.snapshot.alerts.length, 0);
  assert.equal(unavailable.view.blocks.alerts.hasNumbers, false);
  assert.equal(unavailable.snapshot.coverage?.alerts.message, 'Indisponível no momento.');
});

test('P5-C1 — leitura dos indicadores: texto objetivo, sem IA nem limiar', () => {
  assert.equal(adapt(report()).view.insight,
    'Aportes líquidos de 10,00% dos recebimentos operacionais no período.');
  assert.equal(adapt(report({ workspaceType: 'PJ' })).view.insight,
    'Margem operacional de caixa de 36,00% no período.');
  const negative = adapt(report({ kpis: ok({ operationalMarginBasisPoints: -1_250, netContributionRateBasisPoints: -300, netContributionRateReason: null }) })).view.insight;
  assert.equal(negative, 'Aportes líquidos de -3,00% dos recebimentos operacionais no período.');
  const unavailable = adapt(report({ workspaceType: 'PJ', kpis: ok({ operationalMarginBasisPoints: null, netContributionRateBasisPoints: null, netContributionRateReason: 'no_receipts' }) })).view.insight;
  assert.equal(unavailable, 'Margem operacional de caixa: Indisponível: sem recebimentos no período.');
  assert.equal(/IA|15%|saudáve/.test(adapt(report()).view.insight), false);
});

test('P5-C1 — Dashboard: saldo em contas, receitas, despesas, aportes e faturas de cartão', () => {
  const summary = toDashboardSummary(report());
  assert.deepEqual(
    [summary.balance.cents, summary.income.cents, summary.expenses.cents, summary.investments.cents],
    [123_456, 500_000, 320_000, 60_000],
  );
  assert.deepEqual(summary.chart, [
    { name: 'Receitas', kind: 'income', value: 5000 },
    { name: 'Despesas', kind: 'expense', value: 3200 },
    { name: 'Investimentos', kind: 'investment', value: 600 },
    { name: 'Faturas de cartão', kind: 'cardPayment', value: 900 },
  ]);
  assert.equal(summary.chartMessage, null);
  assert.equal(JSON.stringify(summary.chart).includes('Parcelad'), false);

  // Saldo indisponível não vira R$ 0,00 e não derruba os demais cards.
  const partial = toDashboardSummary(report({ accounts: without('unavailable') }));
  assert.equal(partial.balance.cents, null);
  assert.equal(partial.balance.message, 'Indisponível no momento.');
  assert.equal(partial.income.cents, 500_000);

  // Carregando / erro técnico: nenhum número.
  const loading = toDashboardSummary(undefined);
  assert.equal(loading.balance.cents, null);
  assert.equal(loading.balance.message, 'Carregando…');
  const failed = toDashboardSummary(undefined, 'Não foi possível carregar o relatório. Tente novamente.');
  assert.equal(failed.income.message, 'Não foi possível carregar o relatório. Tente novamente.');
  assert.equal(failed.chart, null);
});

test('P5-C1 — o cliente não recalcula: valores do adaptador são os do DTO', () => {
  const dto = report({ cash: ok(cash({ receiptsCents: 1, paymentsCents: 999_999, operationalResultCents: 12_345 })) });
  const { snapshot } = adapt(dto);
  // O resultado exibido é o entregue pelo servidor, ainda que não bata com receitas − despesas.
  assert.equal(plain(snapshot.kpis.find((item) => item.id === 'kpi-balance')?.formattedValue), 'R$ 123,45');
  assert.equal(snapshot.kpis.find((item) => item.id === 'kpi-balance')?.trend, 'up');
});

test('P5-C2 M2 — ciclo aberto vem do servidor: só aberta e não efetivamente fechada', () => {
  const invoice = (cycleStatus: 'open' | 'closed', effectivelyClosed: boolean) => ({
    invoiceId: 'inv', competenceMonth: '2026-10', dueDate: '2026-10-20',
    cycleStatus, paymentStatus: 'unpaid' as const, payableCents: 10_000, effectivelyClosed,
  });
  const openCycle = cardItem({ cardId: 'a', currentInvoice: invoice('open', false) });
  const openButClosed = cardItem({ cardId: 'b', currentInvoice: invoice('open', true) });
  const closed = cardItem({ cardId: 'c', currentInvoice: invoice('closed', true) });
  const none = cardItem({ cardId: 'd', currentInvoice: null });
  const { snapshot } = adapt(report({ cards: ok(cards({ cards: [openCycle, openButClosed, closed, none] })) }));
  assert.deepEqual(
    snapshot.creditCardIndicators.map((card) => card.currentInvoiceOpenCycle),
    [true, false, false, undefined],
  );
  // O valor autoritativo e o status continuam os do servidor.
  assert.equal(snapshot.creditCardIndicators[1].openInvoiceBalance, 100);
  assert.equal(snapshot.creditCardIndicators[1].currentInvoiceStatus, 'open');
});

test('P5-C2 M3 — crédito de fatura aberta é exposto sem alterar atual, futuro, atraso nem pendente', () => {
  const withCredit = cardItem({ cardId: 'a', openCreditCents: 12_345 });
  const plainCard = cardItem({ cardId: 'b', name: 'Cartão B' });
  const base = adapt(report({ cards: ok(cards({ cards: [cardItem({ cardId: 'a' }), cardItem({ cardId: 'b', name: 'Cartão B' })] })) }));
  const credited = adapt(report({
    cards: ok(cards({
      cards: [withCredit, plainCard],
      obligations: { ...cards().obligations, openCreditCents: 12_345 },
    })),
  }));
  assert.equal(credited.snapshot.creditCardIndicators[0].openCreditAmount, 123.45);
  assert.equal(credited.snapshot.creditCardIndicators[1].openCreditAmount, 0);
  assert.equal(credited.snapshot.debtProfile.creditCardOpenCreditAmount, 123.45);
  assert.equal(base.snapshot.debtProfile.creditCardOpenCreditAmount, 0);
  const strip = (profile: typeof base.snapshot.debtProfile) => ({
    ...profile,
    creditCardOpenCreditAmount: 0,
    creditCardIndicators: profile.creditCardIndicators.map((card) => ({ ...card, openCreditAmount: 0 })),
  });
  assert.deepEqual(strip(credited.snapshot.debtProfile), strip(base.snapshot.debtProfile));
  assert.deepEqual(
    credited.snapshot.creditCardExpenseReportViews,
    base.snapshot.creditCardExpenseReportViews,
  );
});

test('P5-C2 L8 — truncado por fontes parciais ganha nota própria; indisponível nunca mostra o motivo', () => {
  const partial = blockViewOf({ status: 'truncated', reason: 'partial_sources', data: debts() });
  assert.equal(partial.hasNumbers, true);
  assert.equal(partial.status, 'truncated');
  assert.equal(partial.note, 'Parcial: alguns dados estão indisponíveis.');
  // Outro motivo de truncamento mantém o texto de limite de leitura.
  assert.equal(
    blockViewOf({ status: 'truncated', reason: 'read_limit', data: debts() }).note,
    'Parcial: limite de leitura atingido.',
  );

  const transient = blockViewOf<CardsReport>({
    status: 'unavailable', reason: 'temporarily_unavailable', data: null,
  });
  assert.equal(transient.hasNumbers, false);
  assert.equal(transient.message, 'Indisponível no momento. Tente novamente em instantes.');
  assert.equal(JSON.stringify(transient).includes('temporarily_unavailable'), false);

  const { snapshot, view } = adapt(report({
    cards: { status: 'unavailable', reason: 'temporarily_unavailable', data: null },
    debts: { status: 'truncated', reason: 'partial_sources', data: debts({ cardObligationsCents: null }) },
  }));
  assert.equal(view.blocks.cards.hasNumbers, false);
  assert.equal(view.blocks.cards.message, 'Indisponível no momento. Tente novamente em instantes.');
  assert.equal(view.blocks.debts.note, 'Parcial: alguns dados estão indisponíveis.');
  assert.equal(snapshot.creditCardIndicators.length, 0);
  assert.equal(snapshot.debtProfile.totalLoans, 7000);
});

test('D-18 L-5 — indisponível distingue falha passageira, dado inconsistente e limite da consulta', () => {
  const messageOf = (reason?: string) =>
    blockViewOf<CardsReport>({ status: 'unavailable', ...(reason ? { reason } : {}), data: null }).message;
  // Só a falha passageira diz "no momento" e convida a tentar de novo.
  assert.equal(messageOf('temporarily_unavailable'), 'Indisponível no momento. Tente novamente em instantes.');
  for (const reason of ['invoice_document_invalid', 'invoice_classification_parity', 'card_document_invalid', 'balance_out_of_range']) {
    assert.equal(messageOf(reason), 'Indisponível: há dados inconsistentes que impedem o cálculo.', reason);
  }
  for (const reason of ['card_limit_exceeded', 'due_window_exceeded', 'too_many_periods']) {
    assert.equal(messageOf(reason), 'Indisponível: o volume de dados excede o limite desta consulta.', reason);
  }
  // Sem motivo, motivo desconhecido ou herdado do protótipo: texto neutro, sem o código.
  for (const reason of [undefined, 'novo_motivo', 'toString', '__proto__']) {
    const message = messageOf(reason);
    assert.equal(message, 'Indisponível no momento.', String(reason));
  }
  // Reconstrução e permissão continuam com os próprios textos.
  assert.equal(blockViewOf({ status: 'rebuild_needed', reason: 'projection_parity', data: null }).message,
    'Aguardando reconstrução dos totais.');
  // Nenhum motivo técnico chega ao texto.
  for (const reason of ['temporarily_unavailable', 'invoice_document_invalid', 'card_limit_exceeded']) {
    assert.equal(/[a-z]+_[a-z_]+/.test(messageOf(reason) ?? ''), false, reason);
  }
  // Na tela: cartões com dado inconsistente não dizem "no momento".
  const { view } = adapt(report({
    cards: { status: 'unavailable', reason: 'invoice_document_invalid', data: null },
    debts: { status: 'truncated', reason: 'partial_sources', data: debts({ cardObligationsCents: null }) },
  }));
  assert.equal(view.blocks.cards.message, 'Indisponível: há dados inconsistentes que impedem o cálculo.');
  assert.equal(view.blocks.debts.note, 'Parcial: alguns dados estão indisponíveis.');
});

test('P5-C2 L5 — atraso de cartões arquivados fica fora da tabela por cartão e é somado para a nota', () => {
  const active = cardItem({ cardId: 'a', name: 'Cartão A', overdueCents: 30_000 });
  const archivedOne = cardItem({
    cardId: 'z1', name: 'Arquivado 1', status: 'archived', currentInvoice: null,
    utilizationBasisPoints: null, outstandingCents: 5_000, futureCommittedCents: 0, overdueCents: 5_000,
  });
  const archivedTwo = cardItem({
    cardId: 'z2', name: 'Arquivado 2', status: 'archived', currentInvoice: null,
    utilizationBasisPoints: null, outstandingCents: 2_550, futureCommittedCents: 0, overdueCents: 2_550,
  });
  const { snapshot } = adapt(report({ cards: ok(cards({ cards: [active, archivedOne, archivedTwo] })) }));
  assert.deepEqual(snapshot.creditCardExpenseReportViews.cardAnalytics.map((card) => card.cardId), ['a']);
  assert.equal(snapshot.creditCardExpenseReportViews.cardAnalytics[0].overdueAmount, 300);
  assert.equal(snapshot.debtProfile.creditCardArchivedOverdueAmount, 75.5);

  const noArchived = adapt(report({ cards: ok(cards()) })).snapshot;
  assert.equal(noArchived.debtProfile.creditCardArchivedOverdueAmount, 0);
});
