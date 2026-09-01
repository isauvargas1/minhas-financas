import assert from 'node:assert/strict';
import test from 'node:test';

import {
  toGoalHistoryRow,
  toGoalHistoryRows,
} from '../../src/modules/investments/simple/goalHistory.ts';
import type { InvestmentMovement } from '../../src/modules/investments/types.ts';

/**
 * Histórico de investimentos da meta (Etapa 3, §2.B, §2.E e §11.A/C).
 *
 * Duas coisas ficam fixadas aqui. A primeira é de linguagem: nenhuma operação
 * técnica do domínio — `redemption`, `goal_unlink`, `settled` — chega à tela.
 * A segunda é financeira: o sinal da linha vem de
 * `goalNetContributionDeltaCents`, o número que o backend aplicou no progresso,
 * e não da operação. Deduzir o sinal no cliente é o que fazia resgate, estorno
 * e desvínculo aparecerem como mais um aporte positivo.
 */

const movement = (overrides: Partial<InvestmentMovement>): InvestmentMovement => ({
  id: 'mov-1',
  workspaceId: 'ws',
  accountId: 'acc',
  assetId: 'ast',
  positionId: 'acc__ast',
  operation: 'contribution',
  status: 'settled',
  description: 'Tesouro Selic 2029',
  principalCents: 100_000,
  gainCents: 0,
  feesCents: 0,
  taxCents: 0,
  quantityMicros: 0,
  goalId: 'goal-1',
  goalNetContributionDeltaCents: 100_000,
  occurredAt: new Date('2026-08-10T12:00:00.000Z') as unknown as InvestmentMovement['occurredAt'],
  ...overrides,
}) as InvestmentMovement;

test('aporte liquidado soma uma vez, com rótulo de usuário', () => {
  const row = toGoalHistoryRow(movement({}));
  assert.equal(row.kind, 'contribution_settled');
  assert.equal(row.label, 'Aporte depositado');
  assert.equal(row.impactCents, 100_000);
  assert.equal(row.effective, true);
});

test('aporte pendente não move o progresso e não mostra sinal', () => {
  const row = toGoalHistoryRow(movement({
    status: 'pending',
    goalNetContributionDeltaCents: 0,
  }));
  assert.equal(row.label, 'Aporte pendente');
  assert.equal(row.impactCents, 0);
  assert.equal(row.effective, false);
  // O valor do lançamento continua legível, para a linha não virar "R$ 0,00".
  assert.equal(row.valueCents, 100_000);
});

test('retirada aguardando recebimento também não move o progresso', () => {
  const row = toGoalHistoryRow(movement({
    operation: 'redemption',
    status: 'pending',
    goalNetContributionDeltaCents: 0,
  }));
  assert.equal(row.label, 'Retirada aguardando recebimento');
  assert.equal(row.effective, false);
  assert.equal(row.impactCents, 0);
});

test('retirada recebida reduz o progresso pelo capital, não pelo total sacado', () => {
  /*
   * R$ 400 de capital mais R$ 50 de rendimento saem da conta do usuário, mas
   * só o capital tinha sido aporte. Somar o rendimento aqui faria a meta perder
   * mais do que recebeu.
   */
  const row = toGoalHistoryRow(movement({
    operation: 'redemption',
    principalCents: 40_000,
    gainCents: 5_000,
    goalNetContributionDeltaCents: -40_000,
  }));
  assert.equal(row.label, 'Retirada recebida');
  assert.equal(row.impactCents, -40_000);
  assert.equal(row.valueCents, 45_000);
  assert.equal(row.effective, true);
});

test('rendimento retirado não vira aporte negativo extra', () => {
  const row = toGoalHistoryRow(movement({
    operation: 'redemption',
    principalCents: 0,
    gainCents: 5_000,
    goalNetContributionDeltaCents: 0,
  }));
  assert.equal(row.impactCents, 0);
});

test('lançamento cancelado aparece como cancelado, sem efeito', () => {
  const row = toGoalHistoryRow(movement({
    status: 'cancelled',
    goalNetContributionDeltaCents: 0,
  }));
  assert.equal(row.label, 'Cancelado');
  assert.equal(row.effective, false);
});

test('lançamento estornado aparece como desfeito', () => {
  const row = toGoalHistoryRow(movement({ reversedByMovementId: 'mov-2' }));
  assert.equal(row.label, 'Desfeito');
  assert.equal(row.effective, false);
});

test('vínculo e desvínculo têm rótulo de usuário e sinal do backend', () => {
  const linked = toGoalHistoryRow(movement({
    operation: 'goal_link',
    principalCents: 0,
    goalNetContributionDeltaCents: 80_000,
  }));
  assert.equal(linked.label, 'Vinculado à meta');
  assert.equal(linked.impactCents, 80_000);

  const unlinked = toGoalHistoryRow(movement({
    operation: 'goal_unlink',
    principalCents: 0,
    goalNetContributionDeltaCents: -80_000,
  }));
  assert.equal(unlinked.label, 'Removido da meta');
  assert.equal(unlinked.impactCents, -80_000);
});

test('nenhum rótulo técnico do domínio chega à tela', () => {
  const rows = toGoalHistoryRows([
    movement({ id: 'a' }),
    movement({ id: 'b', operation: 'redemption', goalNetContributionDeltaCents: -1 }),
    movement({ id: 'c', operation: 'goal_link' }),
    movement({ id: 'd', operation: 'goal_unlink' }),
    movement({ id: 'e', operation: 'reversal' }),
    movement({ id: 'f', status: 'pending', goalNetContributionDeltaCents: 0 }),
  ]);
  const proibidos = ['contribution', 'redemption', 'reversal', 'goal_link', 'goal_unlink', 'settled', 'pending'];
  rows.forEach((row) => {
    proibidos.forEach((termo) => {
      assert.equal(
        row.label.toLowerCase().includes(termo),
        false,
        `rótulo "${row.label}" expõe o termo técnico "${termo}"`,
      );
    });
  });
  assert.equal(rows.length, 6);
});

test('delta ausente é tratado como zero, sem NaN no progresso', () => {
  const row = toGoalHistoryRow(movement({ goalNetContributionDeltaCents: undefined }));
  assert.equal(row.impactCents, 0);
  assert.equal(Number.isNaN(row.impactCents), false);
});
