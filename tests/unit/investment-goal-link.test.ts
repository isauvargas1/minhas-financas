import assert from 'node:assert/strict';
import test from 'node:test';

import {
  availableGoalLinkCandidates,
  buildGoalLinkCall,
  buildGoalUnlinkCall,
  canManageGoalLinks,
  isLinkableInvestment,
  linkedGoalInvestments,
  toGoalLinkCandidates,
} from '../../src/modules/investments/simple/goalLink.ts';
import type { InvestmentPosition } from '../../src/modules/investments/types.ts';

/**
 * Vínculo retroativo de investimento à meta (Etapa 3, §2.C, §2.D e §11.B).
 *
 * O baseline tinha o botão "Vincular Existente" ligado a `() => {}`. O que
 * estes testes fixam é o contrato do que ele passou a fazer: quem é candidato,
 * quem não é, e qual operação autoritativa cada caso usa — vincular nunca é a
 * mesma chamada que trocar de meta.
 */

const position = (overrides: Partial<InvestmentPosition> = {}): InvestmentPosition => ({
  id: 'pos-1',
  workspaceId: 'ws-a',
  accountId: 'acc-1',
  assetId: 'ast-1',
  status: 'active',
  quantityMicros: 1_000_000,
  principalCents: 100_000,
  currentValueCents: 100_000,
  realizedGainCents: 0,
  unrealizedAppreciationCents: 0,
  ...overrides,
}) as InvestmentPosition;

const names = new Map([['ast-1', 'Tesouro Selic 2029'], ['ast-2', 'CDB BTG']]);

test('investimento sem meta é candidato disponível', () => {
  const [candidate] = toGoalLinkCandidates([position()], 'goal-1', names);
  assert.equal(candidate.bucket, 'available');
  assert.equal(candidate.name, 'Tesouro Selic 2029');
  assert.equal(candidate.accountId, 'acc-1');
  assert.equal(candidate.assetId, 'ast-1');
});

test('investimento já vinculado à mesma meta não é oferecido para vincular', () => {
  const candidates = toGoalLinkCandidates([position({ goalId: 'goal-1' })], 'goal-1', names);
  assert.equal(candidates[0].bucket, 'linked');
  assert.deepEqual(availableGoalLinkCandidates(candidates), []);
  assert.equal(linkedGoalInvestments(candidates).length, 1);
});

test('investimento de outra meta aparece, mas marcado como troca', () => {
  const candidates = toGoalLinkCandidates([position({ goalId: 'goal-2' })], 'goal-1', names);
  assert.equal(candidates[0].bucket, 'other_goal');
  assert.equal(availableGoalLinkCandidates(candidates).length, 1);
});

test('posição arquivada e posição sem capital não são candidatas', () => {
  // A primeira é histórico encerrado; a segunda é o ativo técnico do
  // onboarding, ou um investimento inteiramente retirado. Nenhum dos dois é
  // "um investimento" para quem abre a meta.
  assert.equal(isLinkableInvestment(position({ status: 'archived' })), false);
  assert.equal(
    isLinkableInvestment(position({ principalCents: 0, currentValueCents: 0 })),
    false,
  );
  const candidates = toGoalLinkCandidates(
    [
      position({ id: 'pos-1', status: 'archived' }),
      position({ id: 'pos-2', principalCents: 0, currentValueCents: 0 }),
      position({ id: 'pos-3' }),
    ],
    'goal-1',
    names,
  );
  assert.deepEqual(candidates.map((candidate) => candidate.positionId), ['pos-3']);
});

test('posição valorizada sem custo continua candidata', () => {
  // Retirar todo o principal e manter valorização é raro, mas não é motivo
  // para o investimento sumir da lista da meta.
  assert.equal(
    isLinkableInvestment(position({ principalCents: 0, currentValueCents: 5_000 })),
    true,
  );
});

test('vincular sem meta anterior usa linkInvestmentToGoal', () => {
  const [candidate] = toGoalLinkCandidates([position()], 'goal-1', names);
  const call = buildGoalLinkCall(candidate, 'goal-1', '2026-09-01T12:00:00.000Z', 'Motivo');
  assert.equal(call.name, 'linkInvestmentToGoal');
  assert.deepEqual(call.payload, {
    accountId: 'acc-1',
    assetId: 'ast-1',
    goalId: 'goal-1',
    occurredAt: '2026-09-01T12:00:00.000Z',
    reason: 'Motivo',
  });
});

test('trocar de meta usa changeInvestmentGoal com a meta anterior', () => {
  /*
   * `linkInvestmentToGoal` sobre uma posição já vinculada é recusado pelo
   * domínio ("A posição já está vinculada a uma meta."). Sem `previousGoalId`,
   * a meta antiga ficaria com o capital que perdeu.
   */
  const [candidate] = toGoalLinkCandidates([position({ goalId: 'goal-2' })], 'goal-1', names);
  const call = buildGoalLinkCall(candidate, 'goal-1', '2026-09-01T12:00:00.000Z', 'Motivo');
  assert.equal(call.name, 'changeInvestmentGoal');
  assert.equal(call.payload.previousGoalId, 'goal-2');
  assert.equal(call.payload.goalId, 'goal-1');
});

test('remover da meta usa unlinkInvestmentFromGoal, nunca exclusão', () => {
  const [candidate] = toGoalLinkCandidates([position({ goalId: 'goal-1' })], 'goal-1', names);
  const call = buildGoalUnlinkCall(candidate, 'goal-1', '2026-09-01T12:00:00.000Z', 'Motivo');
  assert.equal(call.name, 'unlinkInvestmentFromGoal');
  assert.equal(call.payload.goalId, 'goal-1');
});

test('a matriz de papéis espelha a do backend', () => {
  // owner/admin/member movem vínculo; viewer e desconhecido não veem a ação
  // habilitada — e o backend continua revalidando de qualquer forma.
  assert.equal(canManageGoalLinks('owner'), true);
  assert.equal(canManageGoalLinks('admin'), true);
  assert.equal(canManageGoalLinks('member'), true);
  assert.equal(canManageGoalLinks('viewer'), false);
  assert.equal(canManageGoalLinks(undefined), false);
});

test('a lista de candidatos não inventa nome para posição sem ativo resolvido', () => {
  const [candidate] = toGoalLinkCandidates([position({ assetId: 'ast-desconhecido' })], 'goal-1', names);
  assert.equal(candidate.name, 'Investimento sem nome');
});
