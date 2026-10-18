import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUSINESS_TYPE_LABELS,
  GOAL_CASH_REGIME_NOTE,
  GOAL_COST_CENTER_KPI_NOTE,
  GOAL_COST_CENTER_NOTE,
  buildGoalSubmission,
  buildInvestmentGoalOptionsPage,
  businessTypeNeedsCashNote,
  chunkKpiGoalIds,
  civilDateKey,
  emptyGoalFormState,
  formatBasisPoints,
  formatCents,
  formatCivilDate,
  formProgressSource,
  goalErrorView,
  goalHealthBadge,
  goalPaceStatus,
  goalProgressView,
  goalToFormState,
  kpiGoalIds,
  mapGoalDocument,
  mapManualProgressAudit,
  mergeGoalsById,
  monthlySuggestionCents,
  parseGoalKpiResults,
  parseGoalsOverview,
  parsePercentToBasisPoints,
  parseReaisToCents,
  ratioBasisPoints,
  type GoalFormState,
  type GoalKpiResult,
  type InvestmentGoalOptionsCursor,
} from '../../src/modules/goals/model.ts';
import { goalForecastLabel, goalTimelineEvents } from '../../src/modules/goals/timeline.ts';
import type { Goal } from '../../src/types.ts';

/**
 * P5-B — o frontend das metas lê um único formato (o contrato persistido),
 * escolhe UMA fonte de progresso por meta e nunca calcula progresso
 * financeiro. Módulo puro, sem React nem Firebase.
 */

const stamp = (iso: string) => ({toMillis: () => Date.parse(iso)});

const baseDoc = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Viagem',
  category: 'viagem',
  priority: 'alta',
  priorityRank: 3,
  status: 'em_andamento',
  startDate: '2026-01-01',
  deadline: '2026-12-31',
  horizon: 'curto',
  visual: {color: '#6366f1', icon: 'Target', progressBarType: 'linear'},
  progressSource: 'manual',
  targetAmountCents: 1_000_000,
  manualProgressCents: 250_000,
  manualProgressUpdatedAt: stamp('2026-03-10T15:00:00Z'),
  archived: false,
  revision: 2,
  createdAt: stamp('2026-01-01T10:00:00Z'),
  updatedAt: stamp('2026-03-10T15:00:00Z'),
  ...overrides,
});

const goalOf = (overrides: Record<string, unknown> = {}): Goal => {
  const goal = mapGoalDocument('g1', baseDoc(overrides));
  assert.ok(goal, 'documento de teste deve ser válido');
  return goal;
};

const investmentGoal = (overrides: Record<string, unknown> = {}) => goalOf({
  progressSource: 'investment',
  progressBasis: 'net_contributions',
  manualProgressCents: undefined,
  manualProgressUpdatedAt: undefined,
  ...overrides,
});

const kpiGoal = (businessType: string, overrides: Record<string, unknown> = {}) => goalOf({
  progressSource: 'business_kpi',
  businessType,
  period: 'mensal',
  manualProgressCents: undefined,
  manualProgressUpdatedAt: undefined,
  ...(businessType === 'margem'
    ? {targetAmountCents: undefined, targetBasisPoints: 2000}
    : {}),
  ...overrides,
});

// --- mapeamento -------------------------------------------------------------

test('mapeia o documento manual sem copiar campos removidos', () => {
  const goal = goalOf({
    targetAmount: 10_000,
    currentAmount: 999,
    currentAmountCents: 99_900,
    isAutomatic: true,
    investmentProgressCents: 5,
  });
  assert.equal(goal.progressSource, 'manual');
  assert.equal(goal.manualProgressCents, 250_000);
  assert.equal(goal.targetAmountCents, 1_000_000);
  assert.equal(goal.revision, 2);
  assert.equal(goal.manualProgressUpdatedAt, '2026-03-10T15:00:00.000Z');
  assert.equal(goal.investmentProgressCents, undefined);
  for (const removed of ['targetAmount', 'currentAmount', 'currentAmountCents', 'isAutomatic']) {
    assert.equal(removed in goal, false, removed);
  }
});

test('recusa documento fora do contrato, sem inferir de outro campo', () => {
  assert.equal(mapGoalDocument('g', baseDoc({manualProgressCents: undefined, currentAmountCents: 100})), null);
  assert.equal(mapGoalDocument('g', baseDoc({progressSource: undefined})), null);
  assert.equal(mapGoalDocument('g', baseDoc({targetAmountCents: undefined, targetAmount: 100})), null);
  assert.equal(mapGoalDocument('g', baseDoc({targetAmountCents: 10.5})), null);
  assert.equal(mapGoalDocument('g', baseDoc({revision: 0})), null);
  assert.equal(mapGoalDocument('g', baseDoc({priorityRank: 5})), null);
  assert.equal(mapGoalDocument('g', baseDoc({deadline: '2026-02-30'})), null);
  assert.equal(mapGoalDocument('', baseDoc()), null);
  assert.equal(mapGoalDocument('g', null), null);
  // Investimento exige a base; KPI exige tipo e (exceto caixa) período.
  assert.equal(mapGoalDocument('g', baseDoc({progressSource: 'investment'})), null);
  assert.equal(mapGoalDocument('g', baseDoc({progressSource: 'business_kpi', businessType: 'lucro'})), null);
  assert.equal(mapGoalDocument('g', baseDoc({progressSource: 'business_kpi', businessType: 'investimento', period: 'mensal'})), null);
});

test('margem usa pontos-base como alvo e recusa valor em centavos', () => {
  const margin = kpiGoal('margem');
  assert.equal(margin.targetBasisPoints, 2000);
  assert.equal(margin.targetAmountCents, undefined);
  assert.equal(mapGoalDocument('g', baseDoc({
    progressSource: 'business_kpi', businessType: 'margem', period: 'mensal',
    targetAmountCents: undefined,
  })), null);
  assert.equal(mapGoalDocument('g', baseDoc({
    progressSource: 'business_kpi', businessType: 'margem', period: 'mensal',
    targetAmountCents: undefined, targetBasisPoints: 10_001,
  })), null);
});

test('caixa_minimo não tem período; investimento PJ aceita businessType investimento', () => {
  const cash = mapGoalDocument('g', baseDoc({
    progressSource: 'business_kpi', businessType: 'caixa_minimo', manualProgressCents: undefined,
  }));
  assert.equal(cash?.period, undefined);
  const pj = investmentGoal({businessType: 'investimento'});
  assert.equal(pj.businessType, 'investimento');
});

// --- progresso: uma fonte, sem fallback -------------------------------------

test('manual usa só manualProgressCents', () => {
  const view = goalProgressView(goalOf(), {status: 'error'});
  assert.equal(view.state, 'ready');
  if (view.state !== 'ready') return;
  assert.equal(view.value, 250_000);
  assert.equal(view.percentBasisPoints, 2500);
  assert.equal(view.valueText, formatCents(250_000));
});

test('investimento usa investmentProgressCents; ausente vale zero, sem recuo', () => {
  const published = goalProgressView(investmentGoal({investmentProgressCents: 75_000}));
  assert.equal(published.state === 'ready' && published.value, 75_000);
  const none = goalProgressView(investmentGoal({manualProgressCents: 999_999}));
  assert.equal(none.state === 'ready' && none.value, 0);
  // A base escolhida não troca o campo lido: o backend já publica na base certa.
  const current = goalProgressView(investmentGoal({
    progressBasis: 'current_value',
    investmentProgressCents: 300,
    investmentNetContributionCents: 100,
    investmentCurrentValueCents: 300,
  }));
  assert.equal(current.state === 'ready' && current.value, 300);
});

const lucroResult = (valueCents: number): GoalKpiResult => ({
  goalId: 'g1', status: 'ok', businessType: 'lucro', unit: 'cents', valueCents,
  window: {startDate: '2026-10-01', endDate: '2026-10-31'},
  components: {receiptsCents: 0, expensesCents: 0},
});

test('indicador PJ: carregando, erro, indisponível e resultado', () => {
  const goal = kpiGoal('lucro');
  assert.equal(goalProgressView(goal).state, 'loading');
  assert.equal(goalProgressView(goal, {status: 'loading'}).state, 'loading');
  assert.equal(goalProgressView(goal, {status: 'error'}).state, 'error');
  const unavailable = goalProgressView(goal, {
    goalId: 'g1', status: 'unavailable', reason: 'x', message: 'Sem dados no período.',
  });
  assert.deepEqual(unavailable, {state: 'unavailable', message: 'Sem dados no período.'});
  const ready = goalProgressView(goal, lucroResult(500_000));
  assert.equal(ready.state === 'ready' && ready.percentBasisPoints, 5000);
  assert.equal(ready.state === 'ready' && ready.window?.endDate, '2026-10-31');
  // Resultado de outra meta ou de outro indicador não é aceito.
  assert.equal(goalProgressView(goal, {...lucroResult(1), goalId: 'outra'}).state, 'error');
  assert.equal(goalProgressView(kpiGoal('faturamento'), lucroResult(1)).state, 'error');
});

test('lucro negativo: percentual negativo, barra em zero', () => {
  const view = goalProgressView(kpiGoal('lucro'), lucroResult(-100_000));
  assert.equal(view.state, 'ready');
  if (view.state !== 'ready') return;
  assert.equal(view.percentBasisPoints, -1000);
  assert.equal(view.barBasisPoints, 0);
  assert.equal(view.reached, false);
});

test('margem: valor e alvo em pontos-base exibidos como percentual pt-BR', () => {
  const view = goalProgressView(kpiGoal('margem'), {
    goalId: 'g1', status: 'ok', businessType: 'margem', unit: 'basis_points',
    valueBasisPoints: 1234, window: {startDate: '2026-10-01', endDate: '2026-10-31'},
    components: {receiptsCents: 100, expensesCents: 50},
  });
  assert.equal(view.state, 'ready');
  if (view.state !== 'ready') return;
  assert.equal(view.valueText, '12,34%');
  assert.equal(view.targetText, '20,00%');
  assert.equal(view.percentBasisPoints, 6170);
});

test('limite de despesas: acima do alvo é ruim e nunca "atingido"', () => {
  const goal = kpiGoal('reducao_custos');
  const over = goalProgressView(goal, {...lucroResult(1_200_000), businessType: 'reducao_custos'} as GoalKpiResult);
  assert.equal(over.state === 'ready' && over.overLimit, true);
  assert.equal(over.state === 'ready' && over.achieved, false);
  assert.equal(over.state === 'ready' && over.reached, true);
  assert.equal(over.state === 'ready' && over.barBasisPoints, 10_000);
});

test('percentuais usam inteiros: denominador zero e valores grandes', () => {
  assert.equal(ratioBasisPoints(10, 0), 0);
  assert.equal(ratioBasisPoints(10, -5), 0);
  assert.equal(ratioBasisPoints(1, 3), 3333);
  assert.equal(ratioBasisPoints(10_000_000_000_000, 10_000_000_000_000), 10_000);
  assert.equal(ratioBasisPoints(9_999_999_999_999, 10_000_000_000_000), 9999);
  assert.equal(ratioBasisPoints(2.5, 10), 0);
});

test('alvo atingido é diferente do status alcancada', () => {
  const reachedButActive = goalOf({manualProgressCents: 1_000_000});
  const view = goalProgressView(reachedButActive);
  assert.equal(view.state === 'ready' && view.achieved, true);
  assert.equal(reachedButActive.status, 'em_andamento');
  assert.equal(goalHealthBadge(reachedButActive, view, '2026-06-01'), 'target_reached');

  const doneBelowTarget = goalOf({status: 'alcancada', manualProgressCents: 100});
  const doneView = goalProgressView(doneBelowTarget);
  assert.equal(doneView.state === 'ready' && doneView.achieved, false);
  assert.equal(goalHealthBadge(doneBelowTarget, doneView, '2026-06-01'), 'completed');
});

test('metas KPI da página e lotes de até 25', () => {
  const goals = [goalOf(), kpiGoal('lucro', {}), investmentGoal()];
  assert.deepEqual(kpiGoalIds(goals), ['g1']);
  const ids = Array.from({length: 60}, (_, index) => `g${index}`);
  assert.deepEqual(chunkKpiGoalIds(ids).map((chunk) => chunk.length), [25, 25, 10]);
  assert.deepEqual(chunkKpiGoalIds([]), []);
});

// --- ritmo e datas civis ----------------------------------------------------

test('data civil de São Paulo vira o mês às 03:00 UTC, não à meia-noite UTC', () => {
  assert.equal(civilDateKey(new Date('2026-11-01T02:59:59Z')), '2026-10-31');
  assert.equal(civilDateKey(new Date('2026-11-01T03:00:00Z')), '2026-11-01');
  assert.equal(civilDateKey(new Date('2027-01-01T01:00:00Z')), '2026-12-31');
  assert.equal(formatCivilDate('2026-10-09'), '09/10/2026');
  assert.equal(formatCivilDate('2026-13-09'), '—');
  assert.equal(formatCivilDate(undefined), '—');
});

test('ritmo da meta em pontos-base e dias civis', () => {
  // 2026-01-01 a 2026-12-31 (364 dias); em 2026-07-02 passaram 182 dias (50%).
  const onTrack = goalOf({manualProgressCents: 500_000});
  assert.equal(goalPaceStatus(onTrack, goalProgressView(onTrack), '2026-07-02'), 'on_track');
  const slow = goalOf({manualProgressCents: 400_000});
  assert.equal(goalPaceStatus(slow, goalProgressView(slow), '2026-07-02'), 'warning');
  const late = goalOf({manualProgressCents: 100_000});
  assert.equal(goalPaceStatus(late, goalProgressView(late), '2026-07-02'), 'off_track');
  assert.equal(goalHealthBadge(late, goalProgressView(late), '2026-07-02'), 'late');
  assert.equal(goalHealthBadge(slow, goalProgressView(slow), '2026-07-02'), 'warning');
  assert.equal(goalHealthBadge(onTrack, goalProgressView(onTrack), '2025-12-31'), null);
});

test('no prazo final o ritmo vira concluída ou perdida', () => {
  const hit = goalOf({manualProgressCents: 1_000_000});
  assert.equal(goalPaceStatus(hit, goalProgressView(hit), '2026-12-31'), 'completed');
  const miss = goalOf({manualProgressCents: 999_999});
  assert.equal(goalPaceStatus(miss, goalProgressView(miss), '2026-12-31'), 'missed');
  // Virada de mês em São Paulo: 31/12 às 22h local ainda não é o prazo seguinte.
  assert.equal(goalPaceStatus(miss, goalProgressView(miss), civilDateKey(new Date('2027-01-01T01:00:00Z'))), 'missed');
  const paused = goalOf({status: 'pausada'});
  assert.equal(goalPaceStatus(paused, goalProgressView(paused), '2026-07-02'), 'neutral');
});

test('limite de despesas no prazo final: cumprida dentro do limite, perdida acima', () => {
  const goal = kpiGoal('reducao_custos', {startDate: '2026-10-01', deadline: '2026-10-31'});
  const result = (valueCents: number): GoalKpiResult =>
    ({...lucroResult(valueCents), businessType: 'reducao_custos'} as GoalKpiResult);
  const target = goal.targetAmountCents ?? 0;
  assert.ok(target > 0);
  // Dentro do limite (inclusive igual ao limite) é cumprida; nunca "atingida".
  assert.equal(goalPaceStatus(goal, goalProgressView(goal, result(target - 1)), '2026-10-31'), 'completed');
  assert.equal(goalPaceStatus(goal, goalProgressView(goal, result(target)), '2026-10-31'), 'completed');
  assert.equal(goalPaceStatus(goal, goalProgressView(goal, result(target + 1)), '2026-10-31'), 'missed');
});

test('limite de despesas acima do ritmo é fora do ritmo', () => {
  const goal = kpiGoal('reducao_custos', {startDate: '2026-10-01', deadline: '2026-10-31'});
  const result = (valueCents: number): GoalKpiResult =>
    ({...lucroResult(valueCents), businessType: 'reducao_custos'} as GoalKpiResult);
  // 15 de 30 dias = 50%: consumo de 70% já passa de 50% + 10 pontos.
  assert.equal(goalPaceStatus(goal, goalProgressView(goal, result(700_000)), '2026-10-16'), 'off_track_high');
  assert.equal(goalPaceStatus(goal, goalProgressView(goal, result(550_000)), '2026-10-16'), 'on_track');
});

test('sugestão mensal em centavos inteiros', () => {
  assert.equal(monthlySuggestionCents(1_200_000, 0, '2027-01-15', '2026-01-10'), 100_000);
  assert.equal(monthlySuggestionCents(1_000_000, 1_000_000, '2027-01-15', '2026-01-10'), 0);
  assert.equal(monthlySuggestionCents(1_000_000, 0, '2026-01-30', '2026-01-10'), 1_000_000);
  assert.equal(monthlySuggestionCents(1_000_000, 0, 'invalida', '2026-01-10'), 0);
});

// --- formatação e entrada ---------------------------------------------------

test('formata centavos e pontos-base em pt-BR', () => {
  assert.match(formatCents(123_456), /^R\$\s1\.234,56$/);
  assert.match(formatCents(-100), /1,00$/);
  assert.equal(formatBasisPoints(1234), '12,34%');
  assert.equal(formatBasisPoints(10_000), '100,00%');
  assert.equal(formatBasisPoints(5), '0,05%');
  assert.equal(formatBasisPoints(-250), '-2,50%');
});

test('rótulos dos indicadores são os do contrato', () => {
  assert.deepEqual(BUSINESS_TYPE_LABELS, {
    faturamento: 'Recebimentos operacionais realizados',
    lucro: 'Resultado operacional de caixa',
    margem: 'Margem operacional de caixa',
    caixa_minimo: 'Saldo disponível em contas',
    reducao_custos: 'Limite de despesas operacionais',
    investimento: 'Investimento',
  });
  assert.equal(GOAL_CASH_REGIME_NOTE, 'Regime de caixa; compras no cartão de crédito não entram.');
  assert.equal(businessTypeNeedsCashNote('lucro'), true);
  assert.equal(businessTypeNeedsCashNote('margem'), true);
  assert.equal(businessTypeNeedsCashNote('reducao_custos'), true);
  assert.equal(businessTypeNeedsCashNote('faturamento'), false);
  assert.equal(businessTypeNeedsCashNote('caixa_minimo'), false);
});

test('reais viram centavos por dígitos e recusam o inválido', () => {
  assert.equal(parseReaisToCents('1500'), 150_000);
  assert.equal(parseReaisToCents('1.500,00'), 150_000);
  assert.equal(parseReaisToCents('R$ 1.500,5'), 150_050);
  assert.equal(parseReaisToCents('0,01'), 1);
  assert.equal(parseReaisToCents('19.99'), 1999);
  assert.equal(parseReaisToCents('1.234'), 123_400);
  assert.equal(parseReaisToCents('0,10'), 10);
  assert.equal(parseReaisToCents('0', {allowZero: true}), 0);
  assert.equal(parseReaisToCents('0'), null);
  assert.equal(parseReaisToCents('10,555'), null);
  assert.equal(parseReaisToCents('0,001'), null);
  assert.equal(parseReaisToCents('-10'), null);
  assert.equal(parseReaisToCents('1e3'), null);
  assert.equal(parseReaisToCents(''), null);
  assert.equal(parseReaisToCents('abc'), null);
  assert.equal(parseReaisToCents('1.50.00'), null);
  assert.equal(parseReaisToCents('100000000000,00'), 10_000_000_000_000);
  assert.equal(parseReaisToCents('100000000000,01'), null);
  assert.equal(parseReaisToCents('99999999999999999999'), null);
  // Sem erro de ponto flutuante: 1,15 e 0,29 não viram 114 / 28 centavos.
  assert.equal(parseReaisToCents('1,15'), 115);
  assert.equal(parseReaisToCents('0,29'), 29);
  assert.equal(parseReaisToCents('100000000000'), 10_000_000_000_000);
});

test('percentual vira pontos-base entre 0,01% e 100%', () => {
  assert.equal(parsePercentToBasisPoints('12,34'), 1234);
  assert.equal(parsePercentToBasisPoints('12.5%'), 1250);
  assert.equal(parsePercentToBasisPoints('100'), 10_000);
  assert.equal(parsePercentToBasisPoints('0,01'), 1);
  assert.equal(parsePercentToBasisPoints('0'), null);
  assert.equal(parsePercentToBasisPoints('100,01'), null);
  assert.equal(parsePercentToBasisPoints('101'), null);
  assert.equal(parsePercentToBasisPoints('1,234'), null);
  assert.equal(parsePercentToBasisPoints('-5'), null);
  assert.equal(parsePercentToBasisPoints('abc'), null);
});

// --- respostas das callables -----------------------------------------------

test('resumo de metas e indicadores são validados', () => {
  const overview = parseGoalsOverview({
    activeCount: 7,
    byStatus: {em_andamento: 4, alcancada: 1, pausada: 1, cancelada: 1},
  });
  assert.equal(overview.byStatus.alcancada, 1);
  assert.throws(() => parseGoalsOverview({activeCount: 1}));
  assert.throws(() => parseGoalsOverview({activeCount: 1, byStatus: {em_andamento: 1}}));

  const results = parseGoalKpiResults({results: [
    {goalId: 'a', status: 'ok', businessType: 'caixa_minimo', unit: 'cents', valueCents: 5, asOf: '2026-10-09T12:00:00.000Z'},
    {goalId: 'b', status: 'unavailable', reason: 'sem_conta', message: 'Cadastre uma conta.'},
    {goalId: 'c', status: 'ok', businessType: 'lucro', unit: 'cents', valueCents: -5,
      window: {startDate: '2026-10-01', endDate: '2026-10-31'}, components: {receiptsCents: 1, expensesCents: 6}},
  ]});
  assert.equal(results.length, 3);
  assert.throws(() => parseGoalKpiResults({results: [{goalId: 'a', status: 'ok', businessType: 'lucro', unit: 'cents', valueCents: 1.5}]}));
  assert.throws(() => parseGoalKpiResults({}));
});

test('histórico do progresso manual mapeia só entradas válidas', () => {
  const entry = mapManualProgressAudit('a1', {
    details: {beforeCents: 100, afterCents: 250},
    timestamp: stamp('2026-05-02T12:00:00Z'),
    actorId: 'u1',
  });
  assert.deepEqual(entry, {
    id: 'a1', beforeCents: 100, afterCents: 250, timestamp: '2026-05-02T12:00:00.000Z', actorId: 'u1',
  });
  assert.equal(mapManualProgressAudit('a2', {details: {beforeCents: -1, afterCents: 2}, timestamp: stamp('2026-05-02T12:00:00Z')}), null);
  assert.equal(mapManualProgressAudit('a3', {details: {beforeCents: 1, afterCents: 2}}), null);
});

test('erros do backend viram mensagens em pt-BR', () => {
  const linked = goalErrorView({
    code: 'functions/failed-precondition',
    message: 'Esta meta tem investimentos vinculados. Desvincule ou transfira os investimentos para outra meta antes de arquivá-la.',
  });
  assert.equal(linked.kind, 'precondition');
  assert.match(linked.message, /investimentos vinculados/);
  const stale = goalErrorView({code: 'functions/aborted', message: 'A meta foi alterada desde que você a abriu. Recarregue e tente de novo.'});
  assert.equal(stale.kind, 'conflict');
  assert.equal(stale.refresh, true);
  assert.match(stale.message, /Recarregue/);
  assert.equal(goalErrorView({code: 'functions/invalid-argument', message: 'INVALID_ARGUMENT', details: {issues: [{message: 'O valor deve ser maior que zero.'}]}}).message, 'O valor deve ser maior que zero.');
  assert.equal(goalErrorView({code: 'functions/permission-denied'}).kind, 'forbidden');
  const sdk = goalErrorView({code: 'functions/internal', message: 'internal'});
  assert.match(sdk.message, /Não foi possível confirmar/);
  assert.equal(goalErrorView(new Error('rede')).kind, 'uncertain');
});

// --- formulário -> payload --------------------------------------------------

const pfForm = (overrides: Partial<GoalFormState> = {}): GoalFormState => ({
  ...emptyGoalFormState('PF', '2026-10-09'),
  name: ' Viagem ',
  target: '10.000,00',
  ...overrides,
});

test('criação de meta de investimento por aportes não envia valor manual nem status oculto', () => {
  const result = buildGoalSubmission(pfForm(), 'PF');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.submission.kind, 'create');
  if (result.submission.kind !== 'create') return;
  assert.equal(result.submission.status, 'em_andamento');
  assert.equal(result.submission.manualProgressCents, undefined);
  assert.deepEqual(result.submission.goal, {
    name: 'Viagem',
    category: 'outro',
    priority: 'media',
    startDate: '2026-10-09',
    deadline: '2027-10-09',
    horizon: 'curto',
    progressSource: 'investment',
    progressBasis: 'net_contributions',
    targetAmountCents: 1_000_000,
    visual: {color: '#6366f1', icon: 'Target', progressBarType: 'linear'},
  });
});

test('valor atual da posição envia progressBasis current_value', () => {
  const result = buildGoalSubmission(pfForm({measure: 'current_value'}), 'PF');
  assert.equal(result.ok && result.submission.goal.progressBasis, 'current_value');
});

test('meta manual exige o valor já acumulado (zero vale) e o envia em centavos', () => {
  const missing = buildGoalSubmission(pfForm({measure: 'manual', manual: ''}), 'PF');
  assert.equal(missing.ok, false);
  if (missing.ok === false) assert.match(missing.errors.manual ?? '', /valor já acumulado/);
  const fraction = buildGoalSubmission(pfForm({measure: 'manual', manual: '10,555'}), 'PF');
  assert.equal(fraction.ok, false);
  const zero = buildGoalSubmission(pfForm({measure: 'manual', manual: '0'}), 'PF');
  assert.equal(zero.ok && zero.submission.kind === 'create' && zero.submission.manualProgressCents, 0);
  const some = buildGoalSubmission(pfForm({measure: 'manual', manual: '1.234,56'}), 'PF');
  assert.equal(some.ok && some.submission.kind === 'create' && some.submission.manualProgressCents, 123_456);
  assert.equal(some.ok && some.submission.goal.progressSource, 'manual');
  assert.equal(some.ok && some.submission.goal.progressBasis, undefined);
  assert.equal(some.ok && some.submission.goal.businessType, undefined);
});

test('valida nome, alvo, datas e período', () => {
  const bad = buildGoalSubmission(pfForm({
    name: '  ', target: '0', startDate: '2026-10-09', deadline: '2026-10-08',
  }), 'PF');
  assert.equal(bad.ok, false);
  if (bad.ok === false) {
    assert.ok(bad.errors.name);
    assert.ok(bad.errors.target);
    assert.match(bad.errors.deadline ?? '', /igual ou posterior/);
  }
  assert.equal(buildGoalSubmission(pfForm({deadline: '2026-02-30'}), 'PF').ok, false);
  assert.equal(buildGoalSubmission(pfForm({target: '10,999'}), 'PF').ok, false);
  assert.equal(buildGoalSubmission(pfForm({target: '-5'}), 'PF').ok, false);
});

const pjForm = (overrides: Partial<GoalFormState> = {}): GoalFormState => ({
  ...emptyGoalFormState('PJ', '2026-10-09'),
  name: 'Faturar mais',
  target: '50.000,00',
  costCenter: ' Comercial ',
  ...overrides,
});

test('PJ: indicador com período, centro de custo e sem base de investimento', () => {
  const result = buildGoalSubmission(pjForm({businessType: 'lucro', period: 'trimestral'}), 'PJ');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const {goal} = result.submission;
  assert.equal(goal.progressSource, 'business_kpi');
  assert.equal(goal.businessType, 'lucro');
  assert.equal(goal.period, 'trimestral');
  assert.equal(goal.costCenter, 'Comercial');
  assert.equal(goal.progressBasis, undefined);
  assert.equal(goal.targetAmountCents, 5_000_000);
  assert.equal(result.submission.kind === 'create' && result.submission.manualProgressCents, undefined);
});

test('PJ: caixa_minimo não envia período', () => {
  const result = buildGoalSubmission(pjForm({businessType: 'caixa_minimo', period: 'anual'}), 'PJ');
  assert.equal(result.ok && result.submission.goal.period, undefined);
  assert.equal(result.ok && result.submission.goal.businessType, 'caixa_minimo');
});

test('PJ: margem envia pontos-base e nenhum valor em centavos', () => {
  const result = buildGoalSubmission(pjForm({businessType: 'margem', target: '15,5'}), 'PJ');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.submission.goal.targetBasisPoints, 1550);
  assert.equal(result.submission.goal.targetAmountCents, undefined);
  assert.equal(buildGoalSubmission(pjForm({businessType: 'margem', target: '120'}), 'PJ').ok, false);
});

test('PJ: investimentos usam fonte investment, tipo investimento e aportes líquidos', () => {
  const result = buildGoalSubmission(pjForm({businessType: 'investimento', period: 'anual'}), 'PJ');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const {goal} = result.submission;
  assert.equal(goal.progressSource, 'investment');
  assert.equal(goal.businessType, 'investimento');
  assert.equal(goal.progressBasis, 'net_contributions');
  assert.equal(goal.period, undefined);
});

test('edição envia expectedRevision e não envia status nem valor manual', () => {
  const manual = goalOf();
  const form = {...goalToFormState(manual, 'PF'), name: 'Viagem 2027'};
  assert.equal(form.manual, '2.500,00');
  const result = buildGoalSubmission(form, 'PF', manual);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(
    {kind: result.submission.kind, rev: result.submission.kind === 'update' && result.submission.expectedRevision},
    {kind: 'update', rev: 2},
  );
  assert.equal('manualProgressCents' in result.submission, false);
  assert.equal('status' in result.submission, false);
  assert.equal(result.submission.goal.name, 'Viagem 2027');
});

test('troca de modalidade: para manual exige o valor inicial; de manual para investimento não envia', () => {
  const invest = investmentGoal();
  const toManualForm = {...goalToFormState(invest, 'PF'), measure: 'manual' as const, manual: ''};
  const missing = buildGoalSubmission(toManualForm, 'PF', invest);
  assert.equal(missing.ok, false);
  const ok = buildGoalSubmission({...toManualForm, manual: '300,00'}, 'PF', invest);
  assert.equal(ok.ok, true);
  if (!ok.ok) return;
  assert.equal(ok.submission.kind === 'update' && ok.submission.manualProgressCents, 30_000);
  assert.equal(ok.submission.goal.progressSource, 'manual');

  const manual = goalOf();
  const toInvest = buildGoalSubmission({...goalToFormState(manual, 'PF'), measure: 'net_contributions'}, 'PF', manual);
  assert.equal(toInvest.ok, true);
  if (!toInvest.ok) return;
  assert.equal('manualProgressCents' in toInvest.submission, false);
  assert.equal(toInvest.submission.goal.progressSource, 'investment');
});

// --- P5-B.1: meta manual também em PJ ---------------------------------------

test('PJ: "Valor informado" cria meta manual sem indicador, sem base e com o valor em centavos', () => {
  const state = pjForm({measure: 'manual', manual: '0', period: 'trimestral', businessType: 'lucro'});
  assert.equal(formProgressSource(state, 'PJ'), 'manual');
  const result = buildGoalSubmission(state, 'PJ');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.submission.kind, 'create');
  if (result.submission.kind !== 'create') return;
  assert.equal(result.submission.manualProgressCents, 0, 'zero vale como valor inicial');
  const {goal} = result.submission;
  assert.equal(goal.progressSource, 'manual');
  assert.equal('businessType' in goal, false, 'meta manual não envia indicador');
  assert.equal('progressBasis' in goal, false, 'meta manual não envia base patrimonial');
  assert.equal('period' in goal, false, 'meta manual não envia período');
  assert.equal(goal.costCenter, 'Comercial', 'centro de custo segue como metadado');
  assert.equal(goal.targetAmountCents, 5_000_000);
  assert.equal(goal.targetBasisPoints, undefined);

  const some = buildGoalSubmission(pjForm({measure: 'manual', manual: '12.345,67'}), 'PJ');
  assert.equal(some.ok && some.submission.kind === 'create' && some.submission.manualProgressCents, 1_234_567);
  const missing = buildGoalSubmission(pjForm({measure: 'manual', manual: ''}), 'PJ');
  assert.equal(missing.ok, false, 'valor inicial obrigatório na meta manual PJ');
  const fraction = buildGoalSubmission(pjForm({measure: 'manual', manual: '1,234'}), 'PJ');
  assert.equal(fraction.ok, false, 'fração de centavo recusada');
  // A margem manual não existe: o alvo da meta manual é sempre em reais.
  const marginLeftover = buildGoalSubmission(
    pjForm({measure: 'manual', manual: '10,00', businessType: 'margem', target: '15,5'}), 'PJ',
  );
  assert.equal(marginLeftover.ok && marginLeftover.submission.goal.targetAmountCents, 1_550);
  assert.equal(marginLeftover.ok && marginLeftover.submission.goal.targetBasisPoints, undefined);
});

test('PJ: indicador e investimentos continuam disponíveis fora do "Valor informado"', () => {
  assert.equal(formProgressSource(pjForm({businessType: 'faturamento'}), 'PJ'), 'business_kpi');
  assert.equal(formProgressSource(pjForm({businessType: 'investimento'}), 'PJ'), 'investment');
  assert.equal(formProgressSource(pfForm({measure: 'manual'}), 'PF'), 'manual');
  assert.equal(formProgressSource(pfForm({measure: 'current_value'}), 'PF'), 'investment');
});

test('PJ: edição de meta manual mantém a fonte e não reenvia o valor nem o indicador', () => {
  const manual = goalOf({costCenter: 'Operações'});
  const form = goalToFormState(manual, 'PJ');
  assert.equal(form.measure, 'manual');
  assert.equal(formProgressSource(form, 'PJ'), 'manual');
  const result = buildGoalSubmission({...form, name: 'Reserva da empresa'}, 'PJ', manual);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.submission.kind, 'update');
  assert.equal('manualProgressCents' in result.submission, false);
  assert.equal(result.submission.goal.progressSource, 'manual');
  assert.equal('businessType' in result.submission.goal, false);
  assert.equal(result.submission.goal.costCenter, 'Operações');
});

test('PJ: troca de modalidade separa as autoridades (indicador ↔ manual)', () => {
  const kpi = kpiGoal('faturamento', {period: 'mensal'});
  const toManual = {...goalToFormState(kpi, 'PJ'), measure: 'manual' as const, manual: ''};
  assert.equal(buildGoalSubmission(toManual, 'PJ', kpi).ok, false, 'trocar para manual exige valor novo');
  const switched = buildGoalSubmission({...toManual, manual: '800,00'}, 'PJ', kpi);
  assert.equal(switched.ok, true);
  if (!switched.ok) return;
  assert.equal(switched.submission.kind === 'update' && switched.submission.manualProgressCents, 80_000);
  assert.equal(switched.submission.goal.progressSource, 'manual');
  assert.equal('businessType' in switched.submission.goal, false);
  assert.equal('period' in switched.submission.goal, false);

  const manual = goalOf();
  const back = buildGoalSubmission(
    {...goalToFormState(manual, 'PJ'), measure: 'net_contributions', businessType: 'lucro', period: 'anual'},
    'PJ', manual,
  );
  assert.equal(back.ok, true);
  if (!back.ok) return;
  assert.equal('manualProgressCents' in back.submission, false, 'indicador não leva valor manual');
  assert.equal(back.submission.goal.progressSource, 'business_kpi');
  assert.equal(back.submission.goal.businessType, 'lucro');
  assert.equal(back.submission.goal.period, 'anual');
});

test('centro de custo é informativo e declara que o indicador usa os valores gerais', () => {
  assert.match(GOAL_COST_CENTER_NOTE, /^Informativo/);
  assert.match(GOAL_COST_CENTER_NOTE, /não filtra/);
  assert.match(GOAL_COST_CENTER_NOTE, /valores gerais/);
  assert.match(GOAL_COST_CENTER_KPI_NOTE, /informativo/);
  assert.match(GOAL_COST_CENTER_KPI_NOTE, /valores gerais da empresa/);
});

// --- P5-B.1: metas de investimento sem teto fixo -----------------------------

const PAGE = 25;
const investmentDoc = (index: number) => ({
  id: `goal-${String(index).padStart(3, '0')}`,
  data: baseDoc({
    name: `Meta ${String(index).padStart(3, '0')}`,
    progressSource: 'investment',
    progressBasis: 'net_contributions',
    manualProgressCents: undefined,
    manualProgressUpdatedAt: undefined,
  }),
});

/** Consulta em memória: ordem por nome e ID, `startAfter(cursor)`, `limit(PAGE + 1)`. */
const fakeOptionsQuery = (
  store: readonly {id: string; data: Record<string, unknown>}[],
  cursor?: InvestmentGoalOptionsCursor,
) => {
  const sorted = [...store].sort((a, b) => {
    const na = String(a.data.name);
    const nb = String(b.data.name);
    return na !== nb ? (na < nb ? -1 : 1) : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
  const after = cursor
    ? sorted.filter((entry) => {
      const name = String(entry.data.name);
      return name > cursor.name || (name === cursor.name && entry.id > cursor.id);
    })
    : sorted;
  return after.slice(0, PAGE + 1);
};

test('seletor de metas de investimento: 210 metas por cursor, sem teto, alcançam a 101ª, a 125ª e a 201ª', () => {
  const store = Array.from({length: 210}, (_, i) => investmentDoc(i + 1));
  const seen: string[] = [];
  let cursor: InvestmentGoalOptionsCursor | undefined;
  let pages = 0;
  for (;;) {
    const page = buildInvestmentGoalOptionsPage(fakeOptionsQuery(store, cursor), PAGE);
    pages += 1;
    assert.ok(page.goals.length <= PAGE, 'cada página tem no máximo 25');
    assert.deepEqual(page.invalidIds, []);
    seen.push(...page.goals.map((goal) => goal.name));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
    assert.ok(pages < 50, 'paginação termina');
  }
  assert.equal(pages, 9);
  assert.equal(seen.length, 210, 'nenhum teto corta a lista');
  assert.equal(new Set(seen).size, 210, 'sem repetição entre páginas');
  for (const position of [101, 125, 201, 210]) {
    assert.equal(seen[position - 1], `Meta ${String(position).padStart(3, '0')}`, `${position}ª meta alcançável`);
  }
});

test('página do seletor: a sonda decide a próxima página e documento fora do contrato não some com o cursor', () => {
  const exact = buildInvestmentGoalOptionsPage(Array.from({length: PAGE}, (_, i) => investmentDoc(i + 1)), PAGE);
  assert.equal(exact.goals.length, PAGE);
  assert.equal(exact.nextCursor, null, '25 exatas: sem próxima página');
  const withProbe = buildInvestmentGoalOptionsPage(Array.from({length: PAGE + 1}, (_, i) => investmentDoc(i + 1)), PAGE);
  assert.equal(withProbe.goals.length, PAGE, 'a sonda não é exibida');
  assert.deepEqual(withProbe.nextCursor, {name: 'Meta 025', id: 'goal-025'});
  const broken = [
    ...Array.from({length: PAGE - 1}, (_, i) => investmentDoc(i + 1)),
    {id: 'goal-bad', data: {name: 'Meta 999', progressSource: 'investment'}},
    investmentDoc(26),
  ];
  const page = buildInvestmentGoalOptionsPage(broken, PAGE);
  assert.deepEqual(page.invalidIds, ['goal-bad']);
  assert.deepEqual(page.nextCursor, {name: 'Meta 999', id: 'goal-bad'}, 'cursor avança mesmo sobre documento inválido');
});

test('metas carregadas e resolvidas por ID se juntam sem repetir, na ordem das páginas', () => {
  const a = goalOf({name: 'A'});
  const b = {...goalOf({name: 'B'}), id: 'g2'};
  const c = {...goalOf({name: 'C'}), id: 'g3'};
  assert.deepEqual(mergeGoalsById([a, b], [b, c]).map((goal) => goal.id), ['g1', 'g2', 'g3']);
  assert.deepEqual(mergeGoalsById([a]).map((goal) => goal.id), ['g1']);
  assert.deepEqual(mergeGoalsById([], [c, c]).map((goal) => goal.id), ['g3']);
});

test('edição preserva a imagem de capa e o tipo de barra da meta', () => {
  const goal = goalOf({visual: {color: '#111111', icon: 'Car', coverImage: 'https://x/y.png', progressBarType: 'circular'}});
  const result = buildGoalSubmission(goalToFormState(goal, 'PF'), 'PF', goal);
  assert.equal(result.ok && result.submission.goal.visual.coverImage, 'https://x/y.png');
  assert.equal(result.ok && result.submission.goal.visual.progressBarType, 'circular');
});

test('formulário de edição de margem mostra percentual', () => {
  assert.equal(goalToFormState(kpiGoal('margem'), 'PJ').target, '20');
  assert.equal(goalToFormState(goalOf(), 'PF').target, '10.000,00');
});

// --- linha do tempo e previsão ---------------------------------------------

test('linha do tempo separa marcos, aporte grande e conclusão', () => {
  const events = goalTimelineEvents({
    startDate: '2026-01-01', status: 'em_andamento', targetCents: 100_000, progressCents: 100_000, achieved: true,
  }, [
    {dateKey: '2026-02-01', impactCents: 30_000},
    {dateKey: '2026-03-01', impactCents: 70_000},
  ], '2026-04-01');
  const titles = events.map((event) => event.title);
  assert.ok(titles.includes('Alcançou 25%'));
  assert.ok(titles.includes('Alcançou 100%'));
  assert.ok(titles.includes('Grande Aporte'));
  assert.equal(titles.includes('Meta Concluída! 🎉'), false);
  assert.equal(events[events.length - 1].title, 'Meta Criada');

  const concluded = goalTimelineEvents({
    startDate: '2026-01-01', status: 'alcancada', statusUpdatedAt: '2026-05-10T12:00:00.000Z',
    targetCents: 100_000, progressCents: 10, achieved: false,
  }, [], '2026-06-01');
  assert.equal(concluded[0].title, 'Meta Concluída! 🎉');
  assert.equal(concluded[0].date, '2026-05-10');
});

test('previsão usa a média dos últimos 6 meses em centavos', () => {
  const movements = [
    {dateKey: '2026-09-05', impactCents: 100_000},
    {dateKey: '2026-10-05', impactCents: 100_000},
  ];
  assert.match(goalForecastLabel(movements, 200_000, '2026-10-09') ?? '', /dezembro de 2026/);
  assert.equal(goalForecastLabel(movements.slice(0, 1), 200_000, '2026-10-09'), null);
  assert.equal(goalForecastLabel(movements, 0, '2026-10-09'), null);
  assert.equal(goalForecastLabel(movements, 100_000_000, '2026-10-09'), '> 10 anos');
  assert.equal(goalForecastLabel([
    {dateKey: '2026-09-05', impactCents: -100_000},
    {dateKey: '2026-10-05', impactCents: 100_000},
  ], 1000, '2026-10-09'), null);
});
