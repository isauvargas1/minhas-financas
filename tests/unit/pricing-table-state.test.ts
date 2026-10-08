import assert from 'node:assert/strict';
import test from 'node:test';

import { planCardState, type PlanCardInput } from '../../src/modules/billing/pricingTableState.ts';

/*
 * V-04 (UX-H1): estado dos botões da tabela de planos.
 * - carregamento só no botão acionado, com os demais pagos bloqueados;
 * - destaque do plano pago em vigor, lido do entitlement canônico;
 * - estados de conta sem confiança (carregando/erro) sem ação nem destaque.
 */
const base = (overrides: Partial<PlanCardInput>): PlanCardInput => ({
  planId: 'pro',
  accountStatus: 'ready',
  accountEntitlement: { planId: 'free', status: 'free' },
  canManage: false,
  isLoading: false,
  pendingPlanId: null,
  ...overrides,
});

test('checkout em andamento: só o botão acionado mostra o carregamento', () => {
  const business = planCardState(base({ planId: 'business', isLoading: true, pendingPlanId: 'business' }));
  const pro = planCardState(base({ planId: 'pro', isLoading: true, pendingPlanId: 'business' }));
  assert.equal(business.showSpinner, true);
  assert.equal(pro.showSpinner, false);
  assert.equal(pro.label, 'Fazer Upgrade');
});

test('checkout em andamento: todos os botões pagos ficam bloqueados (sem operação simultânea)', () => {
  for (const planId of ['pro', 'business'] as const) {
    assert.equal(planCardState(base({ planId, isLoading: true, pendingPlanId: 'pro' })).disabled, true, planId);
  }
  assert.equal(planCardState(base({ planId: 'free', isLoading: true, pendingPlanId: 'pro' })).disabled, true);
});

test('sem ação em andamento: botões pagos habilitados e sem carregamento', () => {
  const pro = planCardState(base({}));
  assert.deepEqual(pro, { disabled: false, showSpinner: false, label: 'Fazer Upgrade', isCurrentPaidPlan: false });
});

test('conta Free: o card Free é o atual e nenhum plano pago recebe destaque', () => {
  assert.equal(planCardState(base({ planId: 'free' })).label, 'Plano Atual');
  assert.equal(planCardState(base({ planId: 'free' })).disabled, true);
  for (const planId of ['pro', 'business'] as const) {
    assert.equal(planCardState(base({ planId })).isCurrentPaidPlan, false, planId);
  }
});

test('assinatura ativa: destaca só o plano em vigor; os pagos levam ao portal', () => {
  const entitlement = { planId: 'pro', status: 'active' } as const;
  const pro = planCardState(base({ planId: 'pro', canManage: true, accountEntitlement: entitlement }));
  const business = planCardState(base({ planId: 'business', canManage: true, accountEntitlement: entitlement }));
  const free = planCardState(base({ planId: 'free', canManage: true, accountEntitlement: entitlement }));
  assert.equal(pro.isCurrentPaidPlan, true);
  assert.equal(pro.label, 'Gerenciar assinatura');
  assert.equal(business.isCurrentPaidPlan, false);
  assert.equal(business.label, 'Gerenciar assinatura');
  assert.equal(free.label, 'Plano Gratuito');
});

test('past_due em carência: o plano segue em vigor e destacado; fora da carência, não', () => {
  const grace = planCardState(base({
    planId: 'business', canManage: true, accountEntitlement: { planId: 'business', status: 'grace' },
  }));
  assert.equal(grace.isCurrentPaidPlan, true);
  // `displayEntitlement` rebaixa para Free quando a carência venceu.
  const expired = planCardState(base({
    planId: 'business', canManage: true, accountEntitlement: { planId: 'free', status: 'restricted' },
  }));
  assert.equal(expired.isCurrentPaidPlan, false);
  assert.equal(expired.label, 'Gerenciar assinatura');
});

test('conta carregando: botões pagos bloqueados com carregamento, sem destaque', () => {
  const entitlement = { planId: 'pro', status: 'active' } as const;
  for (const planId of ['pro', 'business'] as const) {
    const state = planCardState(base({ planId, accountStatus: 'loading', accountEntitlement: entitlement }));
    assert.equal(state.disabled, true, planId);
    assert.equal(state.showSpinner, true, planId);
    assert.equal(state.isCurrentPaidPlan, false, planId);
  }
  assert.equal(planCardState(base({ planId: 'free', accountStatus: 'loading' })).label, 'Plano Gratuito');
});

test('conta sem estado confiável (erro): nada habilitado, nada destacado, sem carregamento', () => {
  const entitlement = { planId: 'pro', status: 'active' } as const;
  for (const planId of ['free', 'pro', 'business'] as const) {
    const state = planCardState(base({ planId, accountStatus: 'error', accountEntitlement: entitlement }));
    assert.equal(state.disabled, true, planId);
    assert.equal(state.showSpinner, false, planId);
    assert.equal(state.isCurrentPaidPlan, false, planId);
  }
});
