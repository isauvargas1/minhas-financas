import assert from 'node:assert/strict';
import test from 'node:test';

import { buildInvestmentOverview } from '../../src/modules/reports/investments.ts';
import { mapGoalDocument } from '../../src/modules/goals/projection.ts';
import type { OfficialInvestmentReportData } from '../../src/modules/investments/types.ts';
import type { Goal } from '../../src/types.ts';

const timestamp = { toDate: () => new Date('2026-08-01T00:00:00.000Z') } as never;

const reportData = (): OfficialInvestmentReportData => ({
  summary: {
    id: 'current', workspaceId: 'workspace-a', positionCount: 1,
    principalCents: 80_000, currentValueCents: 80_000,
    realizedGainCents: 5_000, unrealizedAppreciationCents: 0,
    feesCents: 500, taxCents: 1_000, updatedAt: timestamp,
  },
  periods: [
    {
      id: '2026-07', workspaceId: 'workspace-a', period: '2026-07',
      contributionCents: 100_000, redemptionPrincipalCents: 0,
      realizedGainCents: 0, feesCents: 0, taxCents: 0,
      costDeltaCents: 100_000, currentValueDeltaCents: 100_000,
      closingCurrentValueCents: 100_000,
      cashDeltaCents: -100_000, settledMovementCount: 1, periodStart: timestamp,
    },
    {
      id: '2026-08', workspaceId: 'workspace-a', period: '2026-08',
      contributionCents: 0, redemptionPrincipalCents: 20_000,
      realizedGainCents: 5_000, feesCents: 500, taxCents: 1_000,
      costDeltaCents: -20_000, currentValueDeltaCents: -20_000,
      closingCurrentValueCents: 80_000,
      cashDeltaCents: 23_500, settledMovementCount: 1, periodStart: timestamp,
    },
  ],
  allocations: {
    goal: [{ id: 'goal', workspaceId: 'workspace-a', dimension: 'goal', key: 'unassigned', label: 'Sem meta', positionCount: 1, principalCents: 80_000, currentValueCents: 80_000, realizedGainCents: 5_000, feesCents: 500, taxCents: 1_000 }],
    purpose: [{ id: 'purpose', workspaceId: 'workspace-a', dimension: 'purpose', key: 'unassigned', label: 'Não classificado', positionCount: 1, principalCents: 80_000, currentValueCents: 80_000, realizedGainCents: 5_000, feesCents: 500, taxCents: 1_000 }],
  },
  periodsTruncated: false,
  truncatedDimensions: [],
});

test('reconcilia períodos e não trata principal resgatado como renda', () => {
  const overview = buildInvestmentOverview(reportData(), 'all');
  assert.ok(overview);
  assert.equal(overview.currentValue, 800);
  assert.equal(overview.redeemedPrincipal, 200);
  assert.equal(overview.realizedGain, 50);
  assert.equal(overview.investmentIncome, 35);
  assert.equal(overview.redemptionNet, 235);
  assert.equal(overview.reconciliationDifference, 0);
  assert.deepEqual(overview.evolution.map((item) => item.currentValue), [1000, 800]);
});

test('PF sem meta permanece não classificado e PJ usa finalidade explícita', () => {
  const data = reportData();
  data.allocations.purpose = [
    { ...data.allocations.purpose![0], key: 'reserve', label: 'Reserva' },
    { ...data.allocations.purpose![0], id: 'application', key: 'financial_application', label: 'Aplicação financeira', currentValueCents: 0 },
    { ...data.allocations.purpose![0], id: 'reinvestment', key: 'reinvestment', label: 'Reinvestimento', currentValueCents: 0 },
    { ...data.allocations.purpose![0], id: 'fixed', key: 'fixed_asset', label: 'Imobilizado', currentValueCents: 0 },
  ];
  const overview = buildInvestmentOverview(data, 'all')!;
  assert.equal(overview.allocations.find((entry) => entry.dimension === 'goal')?.items[0].label, 'Sem meta');
  assert.deepEqual(
    overview.allocations.find((entry) => entry.dimension === 'purpose')?.items.map((item) => item.label),
    ['Reserva', 'Aplicação financeira', 'Reinvestimento', 'Imobilizado'],
  );
});

test('feature flag preserva valor legado e ativa a projeção oficial da meta', () => {
  // Fixture completa: o `as` anterior escondia campos obrigatórios ausentes e
  // um `category` que nem existe no enum ('outros' em vez de 'outro').
  const goal: Omit<Goal, 'id'> & { investmentProgressCents: number } = {
    name: 'Reserva',
    category: 'outro',
    status: 'em_andamento',
    priority: 'media',
    targetAmount: 10_000,
    currentAmount: 250,
    investmentProgressCents: 75_000,
    startDate: '2026-01-01',
    deadline: '2026-12-31',
    horizon: 'curto',
    visual: {color: '#4f46e5', icon: 'target', progressBarType: 'linear'},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  assert.equal(mapGoalDocument('goal-a', goal, false).currentAmount, 250);
  assert.equal(mapGoalDocument('goal-a', goal, true).currentAmount, 750);
});

test('filtros em dias usam buckets diários sem incluir valores anteriores', () => {
  const data = reportData();
  const recent = new Date();
  recent.setUTCDate(recent.getUTCDate() - 2);
  const old = new Date();
  old.setUTCDate(old.getUTCDate() - 40);
  data.periods = [{
    ...data.periods[0],
    period: recent.toISOString().slice(0, 7),
    contributionCents: 30_000,
    daily: {
      [old.toISOString().slice(0, 10)]: {
        contributionCents: 10_000, redemptionPrincipalCents: 0,
        realizedGainCents: 0, feesCents: 0, taxCents: 0,
        costDeltaCents: 10_000, currentValueDeltaCents: 10_000,
        cashDeltaCents: -10_000, settledMovementCount: 1,
      },
      [recent.toISOString().slice(0, 10)]: {
        contributionCents: 20_000, redemptionPrincipalCents: 0,
        realizedGainCents: 0, feesCents: 0, taxCents: 0,
        costDeltaCents: 20_000, currentValueDeltaCents: 20_000,
        cashDeltaCents: -20_000, settledMovementCount: 1,
      },
    },
  }];
  assert.equal(buildInvestmentOverview(data, '30d')?.contributions, 200);
});

test('janela de sete dias inclui hoje e os seis dias anteriores', () => {
  const data = reportData();
  const included = new Date();
  included.setUTCDate(included.getUTCDate() - 6);
  const excluded = new Date();
  excluded.setUTCDate(excluded.getUTCDate() - 7);
  data.periods = [{
    ...data.periods[0],
    period: included.toISOString().slice(0, 7),
    contributionCents: 30_000,
    daily: {
      [excluded.toISOString().slice(0, 10)]: {
        contributionCents: 10_000, redemptionPrincipalCents: 0,
        realizedGainCents: 0, feesCents: 0, taxCents: 0,
        costDeltaCents: 10_000, currentValueDeltaCents: 10_000,
        cashDeltaCents: -10_000, settledMovementCount: 1,
      },
      [included.toISOString().slice(0, 10)]: {
        contributionCents: 20_000, redemptionPrincipalCents: 0,
        realizedGainCents: 0, feesCents: 0, taxCents: 0,
        costDeltaCents: 20_000, currentValueDeltaCents: 20_000,
        cashDeltaCents: -20_000, settledMovementCount: 1,
      },
    },
  }];
  assert.equal(buildInvestmentOverview(data, '7d')?.contributions, 200);
});

test('a evolução lê o fechamento do período, não o patrimônio atual', () => {
  // Mesma série, mas com o patrimônio atual deslocado: se a evolução ainda
  // partisse do resumo e subtraísse deltas, os pontos mudariam junto. Lendo o
  // fechamento materializado, eles não mudam.
  const data = reportData();
  data.summary!.currentValueCents = 999_999;
  const overview = buildInvestmentOverview(data, 'all');
  assert.deepEqual(overview!.evolution.map((item) => item.currentValue), [1000, 800]);
});

test('janela sem os meses anteriores não distorce os pontos exibidos', () => {
  // Só o mês mais recente foi carregado. O ponto exibido continua sendo o
  // fechamento daquele mês, e não o total atual atribuído a ele.
  const data = reportData();
  data.periods = data.periods.slice(-1);
  data.periodsTruncated = true;
  const overview = buildInvestmentOverview(data, 'all');
  assert.deepEqual(overview!.evolution.map((item) => item.currentValue), [800]);
});

test('período histórico sem fechamento é omitido e sinalizado', () => {
  // Documentos gravados antes do campo existir continuam legíveis: apenas não
  // entram na série, e a interface avisa que ela precisa de reconstrução.
  const data = reportData();
  data.periods = data.periods.map((period) => {
    const {closingCurrentValueCents: _omitted, ...rest} = period;
    return rest as typeof period;
  });
  const overview = buildInvestmentOverview(data, 'all');
  assert.equal(overview!.evolution.length, 0);
  assert.equal(overview!.evolutionUnavailable, true);
});

// INV-P1-009 — perda realizada no relatório.

test('perda realizada reduz o resultado, sem virar ganho negativo', () => {
  const data = reportData();
  data.periods[1] = {
    ...data.periods[1],
    realizedGainCents: 0,
    realizedLossCents: 3_000,
    feesCents: 0,
    taxCents: 0,
    cashDeltaCents: 17_000,
  };
  const overview = buildInvestmentOverview(data, 'all');
  assert.ok(overview);
  assert.equal(overview.realizedGain, 0, 'ganho segue não-negativo');
  assert.equal(overview.realizedLoss, 30);
  assert.equal(overview.realizedResult, -30, 'resultado realizado carrega o sinal');
  // Resgate bruto = principal resgatado + resultado realizado.
  assert.equal(overview.redemptionGross, 200 - 30);
  assert.equal(overview.redemptionNet, 170);
  assert.equal(overview.investmentIncome, -30);
});

test('ganho e perda em meses distintos somam com o sinal correto', () => {
  const data = reportData();
  data.periods[0] = {
    ...data.periods[0],
    redemptionPrincipalCents: 10_000,
    realizedGainCents: 4_000,
  };
  data.periods[1] = {
    ...data.periods[1],
    realizedGainCents: 0,
    realizedLossCents: 1_000,
  };
  const overview = buildInvestmentOverview(data, 'all');
  assert.ok(overview);
  assert.equal(overview.realizedGain, 40);
  assert.equal(overview.realizedLoss, 10);
  assert.equal(overview.realizedResult, 30);
});

test('período sem o campo de perda é tratado como perda zero', () => {
  const overview = buildInvestmentOverview(reportData(), 'all');
  assert.ok(overview);
  assert.equal(overview.realizedLoss, 0);
  assert.equal(overview.realizedResult, overview.realizedGain);
});
