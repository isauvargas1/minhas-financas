import assert from 'node:assert/strict';
import test from 'node:test';

import { goalProgressView, mapGoalDocument } from '../../src/modules/goals/model.ts';

test('progresso da meta de investimentos vem só da projeção patrimonial, sem recuo', () => {
  // P5-B (D-31.2): uma fonte por meta. O documento persistido é o do backend;
  // nenhum campo removido (`currentAmount`, `targetAmount`) é lido.
  const persisted = {
    name: 'Reserva',
    category: 'outro',
    status: 'em_andamento',
    priority: 'media',
    priorityRank: 2,
    progressSource: 'investment',
    progressBasis: 'net_contributions',
    targetAmountCents: 1_000_000,
    investmentNetContributionCents: 75_000,
    investmentCurrentValueCents: 80_000,
    investmentProgressCents: 75_000,
    startDate: '2026-01-01',
    deadline: '2026-12-31',
    horizon: 'curto',
    archived: false,
    revision: 1,
    visual: {color: '#4f46e5', icon: 'target', progressBarType: 'linear'},
  };
  const goal = mapGoalDocument('goal-a', persisted);
  assert.ok(goal);
  const view = goalProgressView(goal);
  assert.equal(view.state === 'ready' && view.value, 75_000);

  // Meta que ainda não recebeu movimento: progresso zero, nunca um valor
  // informado à mão como recuo.
  const {investmentProgressCents: _semProjecao, ...semProjecao} = persisted;
  const fresh = mapGoalDocument('goal-a', {...semProjecao, currentAmount: 250});
  assert.ok(fresh);
  const freshView = goalProgressView(fresh);
  assert.equal(freshView.state === 'ready' && freshView.value, 0);

  // Documento no formato anterior (sem fonte declarada) não vira meta.
  assert.equal(mapGoalDocument('goal-b', {
    name: 'Antiga', category: 'outro', status: 'em_andamento', priority: 'media',
    targetAmount: 10_000, currentAmount: 250, startDate: '2026-01-01',
    deadline: '2026-12-31', horizon: 'curto',
    visual: {color: '#4f46e5', icon: 'target', progressBarType: 'linear'},
  }), null);
});
