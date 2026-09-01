import assert from 'node:assert/strict';
import test from 'node:test';

import {toSimpleInvestmentRows} from '../../src/modules/investments/simple/rows.ts';
import {
  buildSimpleGoalCards,
  summarizeSimpleInvestmentChips,
} from '../../src/modules/investments/simple/summary.ts';
import type {
  InvestmentAllocationSummary,
  InvestmentMovement,
} from '../../src/modules/investments/types.ts';

/**
 * Invariantes financeiras dos cards e chips (Etapa 2, §12).
 *
 * O layout é o do baseline; a aritmética não pode ser. Estes testes fixam as
 * quatro invariantes: pendente não é capital investido, retirada não aumenta
 * aporte, cancelado não entra em total nenhum e rendimento retirado não reduz
 * capital — porque rendimento nunca foi aporte.
 */

const movement = (overrides: Partial<InvestmentMovement>): InvestmentMovement => ({
  id: 'mov',
  workspaceId: 'ws',
  accountId: 'acc',
  assetId: 'ast',
  positionId: 'pos',
  operation: 'contribution',
  status: 'settled',
  description: 'Aporte',
  principalCents: 100_000,
  gainCents: 0,
  feesCents: 0,
  taxCents: 0,
  quantityMicros: 0,
  occurredAt: new Date('2026-08-10T12:00:00.000Z') as never,
  ...overrides,
}) as InvestmentMovement;

test('pendente não conta como capital efetivamente investido', () => {
  const chips = summarizeSimpleInvestmentChips(toSimpleInvestmentRows([
    movement({id: 'a'}),
    movement({id: 'b', status: 'pending'}),
  ]));
  assert.equal(chips.contributionCents, 100_000);
  assert.equal(chips.depositedCount, 1);
});

test('retirada tem chip próprio e não aumenta o total de aportes', () => {
  const chips = summarizeSimpleInvestmentChips(toSimpleInvestmentRows([
    movement({id: 'a'}),
    movement({id: 'b', operation: 'redemption', principalCents: 40_000, gainCents: 5_000}),
  ]));
  assert.equal(chips.contributionCents, 100_000);
  assert.equal(chips.withdrawalCents, 45_000);
});

test('cancelado e desfeito não poluem os totais', () => {
  const chips = summarizeSimpleInvestmentChips(toSimpleInvestmentRows([
    movement({id: 'a'}),
    movement({id: 'b', status: 'cancelled', principalCents: 999_999}),
    movement({id: 'c', reversedByMovementId: 'rev', principalCents: 888_888}),
  ]));
  assert.equal(chips.contributionCents, 100_000);
  assert.equal(chips.withdrawalCents, 0);
  assert.equal(chips.depositedCount, 1);
});

test('aporte médio ignora pendente e cancelado', () => {
  const chips = summarizeSimpleInvestmentChips(toSimpleInvestmentRows([
    movement({id: 'a', principalCents: 100_000}),
    movement({id: 'b', principalCents: 200_000}),
    movement({id: 'c', principalCents: 900_000, status: 'pending'}),
  ]));
  assert.equal(chips.averageContributionCents, 150_000);
});

test('sem aporte efetivo, a média é zero e não NaN', () => {
  const chips = summarizeSimpleInvestmentChips(toSimpleInvestmentRows([
    movement({id: 'a', status: 'pending'}),
  ]));
  assert.equal(chips.averageContributionCents, 0);
});

/**
 * Faixa da projeção `investment_allocation_summaries` no corte `goal`.
 *
 * É o documento que o backend mantém por delta a partir das posições — só o
 * liquidado chega aqui, e é essa propriedade que dispensa os cards de
 * reclassificar pendente, cancelado ou estornado no cliente.
 */
const faixa = (
  key: string,
  principalCents: number,
): InvestmentAllocationSummary => ({
  id: `goal_${key}`,
  workspaceId: 'ws',
  dimension: 'goal',
  key,
  label: key === 'unassigned' ? 'Sem meta' : 'Meta vinculada',
  positionCount: 1,
  principalCents,
  currentValueCents: principalCents,
  realizedGainCents: 0,
  realizedLossCents: 0,
  feesCents: 0,
  taxCents: 0,
});

test('card "Sem Meta Definida" existe mesmo sem lançamento', () => {
  const cards = buildSimpleGoalCards([], []);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].name, 'Sem Meta Definida');
  assert.equal(cards[0].totalCents, 0);
});

test('card de meta mostra o capital aplicado da projeção', () => {
  const cards = buildSimpleGoalCards(
    [faixa('g1', 70_000)],
    [{id: 'g1', name: 'Viagem'}],
  );
  const viagem = cards.find((card) => card.goalId === 'g1');
  // 100.000 aportados menos 30.000 de capital retirado. O rendimento saiu no
  // caixa, mas nunca foi aporte: subtraí-lo apagaria capital que não existiu —
  // e a projeção já acumula só o custo.
  assert.equal(viagem?.totalCents, 70_000);
});

test('faixa sem meta alimenta o card "Sem Meta Definida"', () => {
  const cards = buildSimpleGoalCards(
    [faixa('unassigned', 40_000), faixa('g1', 60_000)],
    [{id: 'g1', name: 'Viagem'}],
  );
  assert.equal(cards[0].goalId, null);
  assert.equal(cards[0].totalCents, 40_000);
  assert.equal(cards[1].totalCents, 60_000);
});

test('faixa de meta arquivada cai no card sem meta', () => {
  const cards = buildSimpleGoalCards(
    [faixa('fantasma', 100_000)],
    [{id: 'g1', name: 'Viagem'}],
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0].goalId, null);
  assert.equal(cards[0].totalCents, 100_000);
});

/**
 * A regressão que motivou a troca de fonte (P3 — cards sob filtro de estado).
 *
 * O filtro "Pendentes" desce ao servidor: a página do ledger volta sem nenhum
 * movimento liquidado. Enquanto os cards somavam essas linhas, todo card ia a
 * R$ 0,00 e afirmava que não havia investimento na meta. A projeção não é
 * estreitada por filtro nenhum, então os chips acompanham o recorte e os cards
 * continuam descrevendo a carteira.
 */
test('filtro de estado esvazia os chips, nunca os cards', () => {
  const carteira = [faixa('g1', 100_000)];
  const paginaSoPendentes = toSimpleInvestmentRows([
    movement({id: 'p', goalId: 'g1', status: 'pending', principalCents: 500_000}),
  ]);

  const chips = summarizeSimpleInvestmentChips(paginaSoPendentes);
  assert.equal(chips.contributionCents, 0, 'o chip deve seguir o recorte');

  const cards = buildSimpleGoalCards(carteira, [{id: 'g1', name: 'Viagem'}]);
  assert.equal(
    cards.find((card) => card.goalId === 'g1')?.totalCents,
    100_000,
    'o card zerou por causa do filtro da tabela',
  );
});
