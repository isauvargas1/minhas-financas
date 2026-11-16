import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASIS_DIVERGENCE_RETRIES,
  INITIAL_BASIS_FAILURE_STATE,
  basisIncomeOf,
  basisRefreshAfter,
  divergenceRefresh,
  incomeDiverges,
  incomeSignature,
  projectedIncomeOf,
  sameIncome,
  type BasisFailureState,
} from '../../src/modules/reports/basisRefresh.ts';

/**
 * P5-F.1 — atualização das bases de relatório de longa duração (decisões
 * puras de `src/modules/reports/basisRefresh.ts`, aplicadas pelos ganchos de
 * `hooks.ts`): só a receita projetada relê a base; cada divergência pede no
 * máximo duas releituras; falhas param o agendador, que volta a reler quando
 * a projeção muda; nada relê sem motivo.
 */

const WINDOW = ['2026-08', '2026-09', '2026-10'];

test('divergência: só a receita da janela importa; mês sem documento vale 0', () => {
  const basis = { '2026-08': 100_000, '2026-09': 120_000, '2026-10': 0 };
  assert.equal(incomeDiverges({ '2026-08': 100_000, '2026-09': 120_000 }, basis, WINDOW), false, 'outubro sem documento = 0');
  assert.equal(incomeDiverges({ '2026-08': 100_000, '2026-09': 120_000, '2026-10': 50_000 }, basis, WINDOW), true, 'receita retroativa em outubro');
  assert.equal(incomeDiverges({ '2026-08': 100_000, '2026-09': 70_000 }, basis, WINDOW), true, 'receita anulada em setembro');
  assert.equal(incomeDiverges({ '2026-07': 999, '2026-08': 100_000, '2026-09': 120_000 }, basis, WINDOW), false, 'mês fora da janela não conta');
  // Uma despesa muda o documento mensal, mas não `incomeCents`: a projeção lida é a mesma.
  const withExpense = projectedIncomeOf([
    { id: '2026-08', incomeCents: 100_000 },
    { id: '2026-09', incomeCents: 120_000 },
  ]);
  assert.equal(incomeDiverges(withExpense, basis, WINDOW), false);
});

test('projeção e base por mês: só inteiros seguros; o mês avulso entra na base', () => {
  assert.deepEqual(projectedIncomeOf([
    { id: '2026-08', incomeCents: 100_000 },
    { id: '2026-09', incomeCents: '120000' },
    { id: '2026-10', incomeCents: 1.5 },
    { id: '2026-11', incomeCents: undefined },
  ]), { '2026-08': 100_000 });
  assert.deepEqual(basisIncomeOf(
    [{ month: '2026-01', receiptsCents: 10 }, { month: '2026-02', receiptsCents: 20 }],
    { month: '2025-12', receiptsCents: 5 },
  ), { '2025-12': 5, '2026-01': 10, '2026-02': 20 });
  assert.deepEqual(basisIncomeOf([], null), {});
});

test('cada divergência pede no máximo duas releituras; projeção nova recomeça a conta', () => {
  const basis = { '2026-08': 100_000, '2026-09': 120_000, '2026-10': 0 };
  const projected = { '2026-08': 100_000, '2026-09': 120_000, '2026-10': 50_000 };
  const attempts = new Map<string, number>();
  for (let round = 1; round <= BASIS_DIVERGENCE_RETRIES; round += 1) {
    const decision = divergenceRefresh(projected, basis, WINDOW, attempts);
    assert.equal(decision.refresh, true, `releitura ${round}`);
    assert.equal(decision.attempts, round);
    attempts.set(decision.signature as string, decision.attempts);
  }
  // A base continua diferente da mesma projeção (corrida esgotada): nada mais é pedido.
  assert.equal(divergenceRefresh(projected, basis, WINDOW, attempts).refresh, false);
  // Projeção nova (outra receita): nova divergência, nova conta.
  const next = { ...projected, '2026-10': 80_000 };
  assert.notEqual(incomeSignature(next, WINDOW), incomeSignature(projected, WINDOW));
  assert.equal(divergenceRefresh(next, basis, WINDOW, attempts).refresh, true);
  // Base igual à projeção, ou ainda sem uma das duas: nada a fazer.
  assert.equal(divergenceRefresh(projected, projected, WINDOW, new Map()).refresh, false);
  assert.equal(divergenceRefresh(null, basis, WINDOW, new Map()).refresh, false, 'projeção ainda não chegou');
  assert.equal(divergenceRefresh(projected, null, WINDOW, new Map()).refresh, false, 'base ainda carregando');
  assert.equal(divergenceRefresh(projected, basis, [], new Map()).refresh, false, 'sem janela');
  // Convergência (a base alcançou a projeção): quem chama zera as contagens; um estado que volte
  // depois pede releitura de novo. Sem uma das duas, ou divergindo, não há convergência.
  assert.equal(divergenceRefresh(projected, projected, WINDOW, attempts).converged, true);
  assert.equal(divergenceRefresh(projected, basis, WINDOW, attempts).converged, false);
  assert.equal(divergenceRefresh(null, basis, WINDOW, attempts).converged, false);
  assert.equal(divergenceRefresh(projected, null, WINDOW, attempts).converged, false);
});

test('falhas: cada uma conta uma vez, o agendador para no teto e volta com dados novos', () => {
  const limit = 2;
  let state: BasisFailureState = INITIAL_BASIS_FAILURE_STATE;
  // Base lida em t=100 e invalidada: relê.
  let decision = basisRefreshAfter(state, { dataUpdatedAt: 100, errorUpdatedAt: 0 }, limit);
  assert.equal(decision.notify, true);
  state = decision.state;
  // 1ª falha (t=200): relê de novo.
  decision = basisRefreshAfter(state, { dataUpdatedAt: 100, errorUpdatedAt: 200 }, limit);
  assert.deepEqual([decision.notify, decision.state.failures], [true, 1]);
  state = decision.state;
  // O mesmo erro observado de novo (dois observadores, outro render) não conta duas vezes.
  decision = basisRefreshAfter(state, { dataUpdatedAt: 100, errorUpdatedAt: 200 }, limit);
  assert.deepEqual([decision.notify, decision.state.failures], [true, 1]);
  state = decision.state;
  // 2ª falha: para (sem releitura indefinida).
  decision = basisRefreshAfter(state, { dataUpdatedAt: 100, errorUpdatedAt: 300 }, limit);
  assert.deepEqual([decision.notify, decision.state.failures], [false, 2]);
  state = decision.state;
  // A escuta das projeções zera as falhas quando a receita muda: volta a reler.
  state = { ...state, failures: 0 };
  decision = basisRefreshAfter(state, { dataUpdatedAt: 100, errorUpdatedAt: 300 }, limit);
  assert.equal(decision.notify, true);
  // Uma leitura bem-sucedida (dados novos) também zera.
  decision = basisRefreshAfter({ dataUpdatedAt: 100, errorUpdatedAt: 300, failures: 2 }, { dataUpdatedAt: 400, errorUpdatedAt: 300 }, limit);
  assert.deepEqual([decision.notify, decision.state.failures, decision.state.dataUpdatedAt], [true, 0, 400]);
});

test('mesma receita por mês: todos os meses que a base traz, inclusive os de fora da janela e o mês avulso', () => {
  const base = {'2026-07': 100_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000};
  assert.equal(sameIncome(base, {...base}), true);
  assert.equal(sameIncome(base, {...base, '2026-07': 60_000}), false, 'julho mudou fora da janela de agosto a outubro');
  assert.equal(sameIncome(base, {...base, '2025-11': 90_000}), false, 'o mês avulso entrou (janela de 12 meses)');
  const {['2026-07']: _july, ...withoutJuly} = base;
  assert.equal(sameIncome(base, withoutJuly), false, 'um mês a menos');
  assert.equal(sameIncome({'2026-10': 0}, {}), false, 'mês com 0 não é mês ausente');
  assert.equal(sameIncome({}, {}), true);
});
