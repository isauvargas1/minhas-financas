import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SIMPLE_SORT,
  EMPTY_SIMPLE_FILTERS,
  SIMPLE_GOAL_NONE,
  simpleGoalOptions,
  simpleMovementQueryFilter,
  SIMPLE_STATUS_LABEL,
  filterSimpleInvestmentRows,
  hasActiveSimpleFilters,
  isListableSimpleMovement,
  simpleCategoryOptions,
  simpleGoalLabel,
  sortSimpleInvestmentRows,
  toSimpleInvestmentRow,
  toSimpleInvestmentRows,
} from '../../src/modules/investments/simple/rows.ts';
import type {InvestmentMovement} from '../../src/modules/investments/types.ts';

/**
 * Leitura simples do ledger (Etapa 2, §6 e §7).
 *
 * O que estes testes protegem é a promessa central da etapa: um aporte
 * pendente — que ainda não tem posição — precisa aparecer na tela como
 * qualquer outro lançamento, e um lançamento cancelado precisa aparecer como
 * cancelado, nunca como investimento ativo.
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
  quantityMicros: 1_000_000_000,
  institutionName: 'BTG',
  className: 'Aposentadoria',
  typeName: 'Renda fixa',
  typeId: 'cat-rf',
  occurredAt: new Date('2026-08-10T12:00:00.000Z') as unknown as InvestmentMovement['occurredAt'],
  ...overrides,
}) as InvestmentMovement;

test('aporte liquidado vira linha depositada e efetiva', () => {
  const row = toSimpleInvestmentRow(movement({}));
  assert.equal(row.kind, 'contribution');
  assert.equal(row.status, 'deposited');
  assert.equal(SIMPLE_STATUS_LABEL[row.status], 'Depositado');
  assert.equal(row.effective, true);
  assert.equal(row.valueCents, 100_000);
});

test('aporte pendente aparece na lista mesmo sem posição gravada', () => {
  const row = toSimpleInvestmentRow(movement({status: 'pending'}));
  assert.equal(row.status, 'pending');
  assert.equal(SIMPLE_STATUS_LABEL[row.status], 'Pendente');
  // Não é capital efetivo, mas é uma linha visível como qualquer outra.
  assert.equal(row.effective, false);
  assert.equal(row.positionId, 'acc__ast');
});

test('retirada pendente e recebida usam os rótulos do §7', () => {
  const pendente = toSimpleInvestmentRow(
    movement({operation: 'redemption', status: 'pending'}),
  );
  assert.equal(pendente.kind, 'withdrawal');
  assert.equal(SIMPLE_STATUS_LABEL[pendente.status], 'Aguardando recebimento');

  const recebida = toSimpleInvestmentRow(
    movement({operation: 'redemption', status: 'settled'}),
  );
  assert.equal(SIMPLE_STATUS_LABEL[recebida.status], 'Recebido');
  assert.equal(recebida.effective, true);
});

test('valor da retirada soma capital e rendimento; capital fica separado', () => {
  const row = toSimpleInvestmentRow(movement({
    operation: 'redemption',
    principalCents: 100_000,
    gainCents: 15_000,
  }));
  assert.equal(row.valueCents, 115_000);
  assert.equal(row.principalCents, 100_000);
});

test('cancelado e desfeito nunca são efetivos', () => {
  const cancelado = toSimpleInvestmentRow(movement({status: 'cancelled'}));
  assert.equal(SIMPLE_STATUS_LABEL[cancelado.status], 'Cancelado');
  assert.equal(cancelado.effective, false);

  const desfeito = toSimpleInvestmentRow(movement({reversedByMovementId: 'rev-1'}));
  assert.equal(SIMPLE_STATUS_LABEL[desfeito.status], 'Desfeito');
  assert.equal(desfeito.effective, false);
});

test('estorno, vínculo e desvínculo de meta não viram linha', () => {
  assert.equal(isListableSimpleMovement({operation: 'contribution'}), true);
  assert.equal(isListableSimpleMovement({operation: 'redemption'}), true);
  assert.equal(isListableSimpleMovement({operation: 'reversal'}), false);
  assert.equal(isListableSimpleMovement({operation: 'goal_link'}), false);
  assert.equal(isListableSimpleMovement({operation: 'goal_unlink'}), false);

  const rows = toSimpleInvestmentRows([
    movement({id: 'a'}),
    movement({id: 'b', operation: 'reversal'}),
    movement({id: 'c', operation: 'goal_link'}),
  ]);
  assert.deepEqual(rows.map((row) => row.id), ['a']);
});

test('instituição, carteira e categoria vêm da fotografia, sem leitura extra', () => {
  const row = toSimpleInvestmentRow(movement({}));
  assert.equal(row.institution, 'BTG');
  assert.equal(row.portfolio, 'Aposentadoria');
  assert.equal(row.category, 'Renda fixa');
  assert.equal(row.categoryId, 'cat-rf');
});

test('movimento sem fotografia degrada para vazio, sem quebrar a linha', () => {
  const row = toSimpleInvestmentRow(movement({
    institutionName: undefined,
    className: undefined,
    typeName: undefined,
    typeId: undefined,
  }));
  assert.equal(row.institution, '');
  assert.equal(row.portfolio, '');
  assert.equal(row.category, '');
  assert.equal(row.categoryId, undefined);
});

test('busca cobre descrição, instituição, carteira, status e tipo de lançamento', () => {
  const rows = toSimpleInvestmentRows([
    movement({id: 'a', description: 'Tesouro'}),
    movement({id: 'b', description: 'CDB', institutionName: 'XP', status: 'pending'}),
  ]);
  const names = new Map<string, string>();
  const busca = (search: string) =>
    filterSimpleInvestmentRows(rows, {...EMPTY_SIMPLE_FILTERS, search}, names)
      .map((row) => row.id);

  assert.deepEqual(busca('tesouro'), ['a']);
  assert.deepEqual(busca('xp'), ['b']);
  assert.deepEqual(busca('aposentadoria'), ['a', 'b']);
  assert.deepEqual(busca('pendente'), ['b']);
  assert.deepEqual(busca('aporte'), ['a', 'b']);
});

test('filtro de status separa depositado de pendente', () => {
  const rows = toSimpleInvestmentRows([
    movement({id: 'a'}),
    movement({id: 'b', status: 'pending'}),
  ]);
  const names = new Map<string, string>();
  assert.deepEqual(
    filterSimpleInvestmentRows(rows, {...EMPTY_SIMPLE_FILTERS, status: 'pending'}, names)
      .map((row) => row.id),
    ['b'],
  );
});

test('meta da linha usa o nome vivo e denuncia meta removida', () => {
  const names = new Map([['g1', 'Viagem']]);
  const semMeta = toSimpleInvestmentRow(movement({}));
  const comMeta = toSimpleInvestmentRow(movement({goalId: 'g1'}));
  const metaMorta = toSimpleInvestmentRow(movement({goalId: 'g9'}));
  assert.equal(simpleGoalLabel(semMeta, names), 'Sem meta');
  assert.equal(simpleGoalLabel(comMeta, names), 'Viagem');
  assert.equal(simpleGoalLabel(metaMorta, names), 'Meta removida');
});

test('ordenação padrão é por data decrescente', () => {
  const rows = toSimpleInvestmentRows([
    movement({
      id: 'antigo',
      occurredAt: new Date('2026-01-01T12:00:00.000Z') as never,
    }),
    movement({
      id: 'novo',
      occurredAt: new Date('2026-08-01T12:00:00.000Z') as never,
    }),
  ]);
  assert.deepEqual(
    sortSimpleInvestmentRows(rows, DEFAULT_SIMPLE_SORT).map((row) => row.id),
    ['novo', 'antigo'],
  );
});

test('opções de categoria saem das linhas carregadas, sem duplicata', () => {
  const rows = toSimpleInvestmentRows([
    movement({id: 'a', typeName: 'Ações'}),
    movement({id: 'b', typeName: 'Ações'}),
    movement({id: 'c', typeName: 'Renda fixa'}),
    movement({id: 'd', typeName: undefined}),
  ]);
  assert.deepEqual(simpleCategoryOptions(rows), ['Ações', 'Renda fixa']);
});

test('chip de limpar filtros só aparece quando há filtro ativo', () => {
  assert.equal(hasActiveSimpleFilters(EMPTY_SIMPLE_FILTERS), false);
  assert.equal(hasActiveSimpleFilters({...EMPTY_SIMPLE_FILTERS, search: 'x'}), true);
  assert.equal(hasActiveSimpleFilters({...EMPTY_SIMPLE_FILTERS, status: 'pending'}), true);
});

// ---------------------------------------------------------------------------
// Recorte no servidor (Etapa 3, §0.C)
// ---------------------------------------------------------------------------

test('cada estado da tela vira o par indexado que a consulta aceita', () => {
  /*
   * As quatro combinações abaixo são exatamente as cobertas por índice já
   * existente em `firestore.indexes.json` — `status+operation+occurredAt` e
   * `status+occurredAt`. Nenhum índice novo foi criado para isto.
   */
  const filtro = (status: string) =>
    simpleMovementQueryFilter({ ...EMPTY_SIMPLE_FILTERS, status });
  assert.deepEqual(filtro('deposited'), { status: 'settled', operation: 'contribution' });
  assert.deepEqual(filtro('pending'), { status: 'pending', operation: 'contribution' });
  assert.deepEqual(filtro('awaiting'), { status: 'pending', operation: 'redemption' });
  assert.deepEqual(filtro('received'), { status: 'settled', operation: 'redemption' });
  assert.deepEqual(filtro('cancelled'), { status: 'cancelled' });
});

test('"Desfeitos" não desce para o servidor', () => {
  // O estado vem de `reversedByMovementId`, que é presença de campo e não
  // igualdade: filtrar isso no Firestore exigiria outro modelo de dados.
  assert.deepEqual(
    simpleMovementQueryFilter({ ...EMPTY_SIMPLE_FILTERS, status: 'undone' }),
    {},
  );
});

test('a meta desce para o servidor quando é o único recorte', () => {
  assert.deepEqual(
    simpleMovementQueryFilter({ ...EMPTY_SIMPLE_FILTERS, goal: 'goal-7' }),
    { goalId: 'goal-7' },
  );
});

test('meta e estado juntos não viram consulta sem índice', () => {
  /*
   * Combinar `goalId` com `status` exigiria um índice composto novo para uma
   * consulta que nenhuma tela faz. O recorte que desce é o do estado; a meta é
   * refinada sobre a página, e o teto de leitura continua o mesmo.
   */
  assert.deepEqual(
    simpleMovementQueryFilter({ ...EMPTY_SIMPLE_FILTERS, goal: 'goal-7', status: 'deposited' }),
    { status: 'settled', operation: 'contribution' },
  );
});

test('"Sem meta" não desce para o servidor', () => {
  // Firestore não expressa "campo ausente" em igualdade; o recorte fica na
  // página, que é o mesmo critério já anunciado na tela.
  assert.deepEqual(
    simpleMovementQueryFilter({ ...EMPTY_SIMPLE_FILTERS, goal: SIMPLE_GOAL_NONE }),
    {},
  );
});

test('o filtro de meta compara identificador, não rótulo', () => {
  /*
   * Duas metas com o mesmo nome colapsavam numa opção só quando o valor era o
   * rótulo — e um aporte da meta errada aparecia no filtro da outra.
   */
  const rows = toSimpleInvestmentRows([
    movement({ id: 'a', goalId: 'goal-1' }),
    movement({ id: 'b', goalId: 'goal-2' }),
    movement({ id: 'c' }),
  ]);
  const nomes = new Map([['goal-1', 'Reserva'], ['goal-2', 'Reserva']]);
  const opcoes = simpleGoalOptions(rows, nomes);
  assert.deepEqual(opcoes.map((option) => option.value).sort(), ['goal-1', 'goal-2', 'sem-meta']);

  const filtradas = filterSimpleInvestmentRows(
    rows, { ...EMPTY_SIMPLE_FILTERS, goal: 'goal-1' }, nomes,
  );
  assert.deepEqual(filtradas.map((row) => row.id), ['a']);
});

test('o filtro "Sem meta" seleciona só o que não tem vínculo', () => {
  const rows = toSimpleInvestmentRows([
    movement({ id: 'a', goalId: 'goal-1' }),
    movement({ id: 'c' }),
  ]);
  const filtradas = filterSimpleInvestmentRows(
    rows, { ...EMPTY_SIMPLE_FILTERS, goal: SIMPLE_GOAL_NONE }, new Map(),
  );
  assert.deepEqual(filtradas.map((row) => row.id), ['c']);
});
