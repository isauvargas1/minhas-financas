import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAllocationView,
  hasExplicitPurpose,
} from '../../src/modules/investments/simple/allocation.ts';
import type {
  InvestmentAllocationSummary,
  InvestmentSummary,
} from '../../src/modules/investments/types.ts';

/**
 * Alocação PF e PJ (Etapa 3, §5, §6 e §11.F/G).
 *
 * O que estes testes protegem é justamente o que a versão do baseline errava:
 * ela classificava por nome de categoria de transação e jogava investimento
 * sem meta em "Aposentadoria". Aqui a fonte é a projeção do domínio, o balde é
 * o `key` do catálogo, e quando não há patrimônio a faixa diz que não há — em
 * vez de inventar 100% em algum lugar.
 */

const summary = (overrides: Partial<InvestmentSummary> = {}): InvestmentSummary => ({
  id: 'current',
  workspaceId: 'ws',
  profileType: 'PF',
  currency: 'BRL',
  positionCount: 2,
  principalCents: 100_000,
  currentValueCents: 100_000,
  realizedGainCents: 0,
  feesCents: 0,
  taxCents: 0,
  unrealizedAppreciationCents: 0,
  ...overrides,
}) as InvestmentSummary;

const slice = (
  key: string,
  label: string,
  currentValueCents: number,
  principalCents = currentValueCents,
): InvestmentAllocationSummary => ({
  id: `class_${key}`,
  workspaceId: 'ws',
  dimension: 'class',
  key,
  label,
  positionCount: 1,
  principalCents,
  currentValueCents,
  realizedGainCents: 0,
  feesCents: 0,
  taxCents: 0,
});

test('a distribuição usa o patrimônio liquidado do resumo como denominador', () => {
  const view = buildAllocationView(summary(), [
    slice('cls-reserva', 'Reserva de emergência', 75_000),
    slice('cls-aposentadoria', 'Aposentadoria', 25_000),
  ]);
  assert.equal(view.empty, false);
  assert.equal(view.totalCents, 100_000);
  assert.deepEqual(
    view.buckets.map((bucket) => [bucket.key, Number(bucket.percentage.toFixed(1))]),
    [['cls-reserva', 75], ['cls-aposentadoria', 25]],
  );
});

test('o balde é o identificador do catálogo, não o rótulo', () => {
  // Duas carteiras renomeadas para o mesmo texto continuam sendo duas: quem
  // decide é o `key`, e comparar rótulo faria as duas colapsarem numa só.
  const view = buildAllocationView(summary(), [
    slice('cls-a', 'Reserva', 60_000),
    slice('cls-b', 'Reserva', 40_000),
  ]);
  assert.deepEqual(view.buckets.map((bucket) => bucket.key), ['cls-a', 'cls-b']);
});

test('retirada liquidada reduz o balde e o total, sem apagar a carteira', () => {
  // Depois de retirar R$ 400 de uma reserva de R$ 750, a projeção do domínio
  // já chega decrementada: a faixa apenas reflete o novo estado.
  const view = buildAllocationView(summary({ currentValueCents: 60_000, principalCents: 60_000 }), [
    slice('cls-reserva', 'Reserva de emergência', 35_000),
    slice('cls-aposentadoria', 'Aposentadoria', 25_000),
  ]);
  assert.equal(view.totalCents, 60_000);
  assert.equal(view.buckets[0].currentValueCents, 35_000);
  assert.equal(Number(view.buckets[0].percentage.toFixed(1)), 58.3);
});

test('carteira zerada some da faixa em vez de aparecer com 0%', () => {
  const view = buildAllocationView(summary({ currentValueCents: 40_000, principalCents: 40_000 }), [
    slice('cls-reserva', 'Reserva de emergência', 40_000),
    slice('cls-vazia', 'Carteira encerrada', 0),
  ]);
  assert.deepEqual(view.buckets.map((bucket) => bucket.key), ['cls-reserva']);
});

test('sem patrimônio liquidado a faixa fica vazia, sem porcentagem inventada', () => {
  // Aporte pendente não vira posição e não entra no resumo: o total é zero, e
  // a única coisa verdadeira a dizer é que ainda não há distribuição.
  const view = buildAllocationView(
    summary({ currentValueCents: 0, principalCents: 0, positionCount: 0 }),
    [],
  );
  assert.equal(view.empty, true);
  assert.deepEqual(view.buckets, []);
});

test('sem resumo publicado a faixa também fica vazia', () => {
  const view = buildAllocationView(null, [slice('cls-a', 'Reserva', 10_000)]);
  assert.equal(view.empty, true);
  assert.equal(view.totalCents, 0);
});

test('investimento sem meta não é somado a nenhuma carteira presumida', () => {
  /*
   * O corte por meta traz "Sem meta" como balde próprio, com o `key`
   * `unassigned` que o backend publica. O baseline somava esse capital em
   * "Aposentadoria" — uma afirmação sobre a intenção do usuário que ninguém
   * fez. Aqui ele continua sendo o que é.
   */
  const view = buildAllocationView(summary(), [
    { ...slice('unassigned', 'Sem meta', 70_000), dimension: 'goal' },
    { ...slice('goal-1', 'Reserva de emergência', 30_000), dimension: 'goal' },
  ]);
  assert.equal(view.buckets[0].label, 'Sem meta');
  assert.equal(
    view.buckets.some((bucket) => bucket.label === 'Aposentadoria'),
    false,
  );
});

test('a cauda além do teto vira Outros e fecha o total', () => {
  const items = Array.from({ length: 8 }, (_, index) =>
    slice(`cls-${index}`, `Carteira ${index}`, 10_000));
  const view = buildAllocationView(
    summary({ currentValueCents: 80_000, principalCents: 80_000 }), items,
  );
  assert.equal(view.truncated, true);
  const last = view.buckets.at(-1)!;
  assert.equal(last.label, 'Outros');
  assert.equal(last.currentValueCents, 30_000);
  assert.equal(
    Math.round(view.buckets.reduce((total, bucket) => total + bucket.percentage, 0)),
    100,
  );
});

test('PJ só mostra finalidade contábil quando alguém a declarou', () => {
  /*
   * No modo simples todo ativo nasce "Não classificado". Uma faixa inteira
   * repetindo isso sugeriria que a empresa classificou o capital — e forçar o
   * investimento em "reserva" ou "reinvestimento" seria pior ainda.
   */
  const naoClassificado = [{ ...slice('unassigned', 'Não classificado', 100_000), dimension: 'purpose' as const }];
  assert.equal(hasExplicitPurpose(naoClassificado), false);

  const classificado = [
    { ...slice('unassigned', 'Não classificado', 40_000), dimension: 'purpose' as const },
    { ...slice('reserve', 'Reserva', 60_000), dimension: 'purpose' as const },
  ];
  assert.equal(hasExplicitPurpose(classificado), true);
});

test('finalidade sem valor não conta como declarada', () => {
  const items = [{ ...slice('reserve', 'Reserva', 0), dimension: 'purpose' as const }];
  assert.equal(hasExplicitPurpose(items), false);
});
