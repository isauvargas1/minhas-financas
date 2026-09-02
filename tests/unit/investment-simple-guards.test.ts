import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync, readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

import {toSimpleInvestmentRow} from '../../src/modules/investments/simple/rows.ts';
import {simpleRowActions} from '../../src/modules/investments/simple/permissions.ts';
import {
  safeInvestmentError,
  simpleInvestmentError,
} from '../../src/modules/investments/errors.ts';
import type {InvestmentMovement} from '../../src/modules/investments/types.ts';

/**
 * RBAC, tradução de erro e guardas de regressão da Etapa 2 (§11, §15 e §16.F).
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

const row = (overrides: Partial<InvestmentMovement>) =>
  toSimpleInvestmentRow(movement(overrides));

// ---------------------------------------------------------------------------
// E. RBAC
// ---------------------------------------------------------------------------

test('membro liquida, edita e cancela um aporte pendente', () => {
  const actions = simpleRowActions(row({status: 'pending'}), {
    role: 'member', redeemable: false,
  });
  assert.deepEqual(actions, ['settleContribution', 'edit', 'cancel']);
});

test('membro confirma o recebimento de uma retirada pendente', () => {
  const actions = simpleRowActions(
    row({operation: 'redemption', status: 'pending'}),
    {role: 'member', redeemable: true},
  );
  assert.deepEqual(actions, ['settleWithdrawal', 'cancel']);
});

test('desfazer lançamento é de owner e admin, nunca de member', () => {
  const liquidado = row({});
  assert.deepEqual(
    simpleRowActions(liquidado, {role: 'member', redeemable: true}),
    ['withdraw'],
  );
  assert.deepEqual(
    simpleRowActions(liquidado, {role: 'admin', redeemable: true}),
    ['withdraw', 'undo'],
  );
  assert.deepEqual(
    simpleRowActions(liquidado, {role: 'owner', redeemable: false}),
    ['undo'],
  );
});

test('viewer e papel ausente não veem ação nenhuma', () => {
  for (const role of ['viewer', undefined] as const) {
    assert.deepEqual(simpleRowActions(row({}), {role, redeemable: true}), []);
    assert.deepEqual(simpleRowActions(row({status: 'pending'}), {role, redeemable: true}), []);
  }
});

test('retirar só aparece quando o investimento tem capital retirável', () => {
  const liquidado = row({});
  assert.equal(
    simpleRowActions(liquidado, {role: 'owner', redeemable: false}).includes('withdraw'),
    false,
  );
  assert.equal(
    simpleRowActions(liquidado, {role: 'owner', redeemable: true}).includes('withdraw'),
    true,
  );
});

test('aporte pendente nunca oferece retirada — ainda não há posição', () => {
  const actions = simpleRowActions(row({status: 'pending'}), {
    role: 'owner', redeemable: false,
  });
  assert.equal(actions.includes('withdraw'), false);
});

test('cancelado e desfeito não têm ação', () => {
  assert.deepEqual(
    simpleRowActions(row({status: 'cancelled'}), {role: 'owner', redeemable: true}),
    [],
  );
  assert.deepEqual(
    simpleRowActions(row({reversedByMovementId: 'r'}), {role: 'owner', redeemable: true}),
    [],
  );
});

test('a retirada não repete o botão de retirar da própria posição', () => {
  const recebida = row({operation: 'redemption', status: 'settled'});
  assert.equal(
    simpleRowActions(recebida, {role: 'owner', redeemable: true}).includes('withdraw'),
    false,
  );
});

// ---------------------------------------------------------------------------
// §15 — nada técnico chega ao usuário
// ---------------------------------------------------------------------------

test('permissão negada vira frase em pt-BR, sem código do Firebase', () => {
  const message = simpleInvestmentError({
    code: 'functions/permission-denied',
    message: 'FirebaseError: permission-denied',
  });
  assert.equal(message, 'Você não tem permissão para concluir esta ação.');
});

test('erro desconhecido não vaza mensagem técnica', () => {
  const message = simpleInvestmentError(new Error('quantityMicros inválido em positionId acc__ast'));
  assert.equal(message, 'Não foi possível concluir a operação. Tente novamente.');
});

test('retirada acima do capital orienta o campo de rendimento', () => {
  const message = simpleInvestmentError({
    code: 'functions/failed-precondition',
    message: 'O capital retirado supera o capital investido disponível neste investimento. ' +
      'Se parte do valor é rendimento, informe quanto: o sistema não estima rentabilidade.',
  });
  assert.match(message, /Mais detalhes/);
  assert.match(message, /rendimento/i);
});

test('ativo do regime antigo é explicado sem jargão técnico', () => {
  const message = simpleInvestmentError({
    code: 'functions/failed-precondition',
    message: 'Este investimento é controlado por quantidade. Use o resgate ' +
      'detalhado, que recebe quantidade e resultado realizado.',
  });
  assert.doesNotMatch(message, /quantidade|resgate detalhado|resultado realizado/i);
  assert.match(message, /cadastro avançado/i);
});

test('nenhuma tradução expõe termo interno do domínio', () => {
  const proibidos = /trackingMode|quantityMicros|positionId|accountId|assetId|idempotencyKey|permission-denied|FirebaseError/;
  const amostras: unknown[] = [
    {code: 'functions/permission-denied', message: 'FirebaseError'},
    {code: 'functions/unauthenticated', message: 'x'},
    {code: 'functions/invalid-argument', message: 'x'},
    {code: 'functions/internal', message: 'x'},
    new Error('boom'),
  ];
  amostras.forEach((sample) => {
    assert.doesNotMatch(simpleInvestmentError(sample), proibidos);
    assert.doesNotMatch(safeInvestmentError(sample), proibidos);
  });
});

// ---------------------------------------------------------------------------
// F. Regressão estrutural
// ---------------------------------------------------------------------------

const gitFiles = (...patterns: string[]) =>
  execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', ...patterns],
    {encoding: 'utf8'},
  )
    .split('\n')
    .filter(Boolean)
    .filter((path) => existsSync(path));

const sourceFiles = gitFiles('src/**/*.ts', 'src/**/*.tsx');

test('nenhuma tela grava investimento direto em transactions', () => {
  /*
   * O baseline gravava o aporte como um documento de `transactions` com
   * `type: 'investimento'`. O domínio autoritativo tornou `transactions` um
   * espelho de caixa escrito **só** pelo backend, e as Rules recusam a escrita
   * do cliente.
   *
   * A guarda cruza duas evidências em vez de procurar o literal sozinho:
   * `type: 'investimento'` também aparece em semente de categoria e em
   * transação falsa de pré-visualização de tema, que não gravam nada. O que
   * caracteriza a escrita antiga é o literal **junto** da API de escrita de
   * transações — e reconstruir aquele caminho exige as duas coisas no mesmo
   * arquivo.
   */
  const writeApi = /useCreateTransaction|useUpdateTransaction|useCreateTransactionsBatch|createTransactionsBatch|createTransaction\(|updateTransaction\(/;
  const offenders = sourceFiles.filter((file) => {
    const content = readFileSync(file, 'utf8');
    return /type:\s*['"]investimento['"]/.test(content) && writeApi.test(content);
  });
  assert.deepEqual(offenders, [], `Escrita direta reintroduzida em: ${offenders.join(', ')}`);
});

test('a aba de investimento do modal não ressuscitou a escrita antiga', () => {
  /*
   * A aba voltou como ponto de entrada; a arquitetura antiga, não. O que o
   * baseline fazia era montar campos de investimento **dentro** do formulário
   * comum e gravar um documento de `transactions` com `type: 'investimento'`.
   * Hoje a aba monta `SimpleInvestmentForm`, cujo destino é
   * `createSimpleInvestment`, e o submit comum tem guarda explícita.
   */
  const modal = readFileSync('src/components/TransactionModal.tsx', 'utf8');
  assert.doesNotMatch(modal, /transactionData\.isPaid = isDeposited/);
  assert.doesNotMatch(modal, /type:\s*['"]investimento['"]/);
  assert.match(modal, /<SimpleInvestmentForm/);
  assert.match(
    modal,
    /const handleSubmit = async \(e: FormEvent\) => \{[\s\S]{0,400}?if \(activeTab === 'investimento'\) return;/,
  );
  // Nenhum ramo de campos de investimento dentro do formulário comum: o
  // `renderFields` cobre parcelado, receita e despesa, e devolve nulo no resto.
  const inicio = modal.indexOf('const renderFields =');
  const renderFields = modal.slice(inicio, modal.indexOf('        return null;\n    };', inicio));
  assert.ok(renderFields.length > 0);
  assert.doesNotMatch(renderFields, /activeTab === 'investimento'/);
});

test('a tela simples só chama as callables do modo simples', () => {
  const permitidas = new Set([
    'createSimpleInvestment',
    'settleInvestmentContribution',
    'withdrawSimpleInvestment',
    'settleSimpleWithdrawal',
    'cancelInvestmentMovement',
    'reverseInvestmentMovement',
    // Etapa 3, §2.C/§2.D — vínculo retroativo de meta. São as operações
    // autoritativas do domínio, não escrita de tela: a posição continua sendo
    // movida pelo backend, e a interface só declara a intenção.
    'linkInvestmentToGoal',
    'changeInvestmentGoal',
    'unlinkInvestmentFromGoal',
  ]);
  const chamadas = new Set<string>();
  gitFiles('src/modules/investments/simple/**/*.ts', 'src/modules/investments/simple/**/*.tsx')
    .forEach((file) => {
      const content = readFileSync(file, 'utf8');
      for (const match of content.matchAll(/callable:\s*'([A-Za-z]+)'|name:\s*'([A-Za-z]+)'/g)) {
        const name = match[1] ?? match[2];
        if (name) chamadas.add(name);
      }
    });
  const intrusas = [...chamadas].filter((name) => !permitidas.has(name));
  assert.deepEqual(intrusas, [], `Callable fora do modo simples: ${intrusas.join(', ')}`);
});

test('a interface simples não monta identificador técnico do domínio', () => {
  const proibidos = /quantityMicros|unitPriceMicros|assetType|trackingMode/;
  const offenders = gitFiles(
    'src/modules/investments/simple/**/*.ts',
    'src/modules/investments/simple/**/*.tsx',
  ).filter((file) => proibidos.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});

const arquivosSimples = () => gitFiles(
  'src/modules/investments/simple/**/*.ts',
  'src/modules/investments/simple/**/*.tsx',
);

test('a listagem de movimentos não resolve nome por linha', () => {
  /*
   * §6: a tabela não pode fazer N+1 para instituição, carteira, categoria ou
   * descrição — eles vêm da fotografia que a Etapa 1 grava no movimento.
   */
  ['src/modules/investments/simple/rows.ts', 'src/modules/investments/simple/summary.ts']
    .forEach((file) => {
      const content = readFileSync(file, 'utf8');
      assert.doesNotMatch(content, /resolveInvestment|getDoc\(/, `${file} resolve nome por linha`);
    });
});

test('nenhuma resolução de nome acontece uma por linha', () => {
  /*
   * A Etapa 3 trouxe uma resolução de nome legítima: o seletor de "Vincular
   * Existente" precisa do nome do ativo, e a posição não guarda rótulo nenhum.
   * O que continua proibido é resolver **por linha** — a chamada tem de receber
   * a coleção inteira e resolver em bloco, por `documentId() in`.
   */
  arquivosSimples().forEach((file) => {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /getDoc\(/, `${file} lê documento avulso`);
    for (const match of content.matchAll(/resolveInvestment\w*Names\(([\s\S]{0,240}?)\)\s*;/g)) {
      assert.match(
        match[1],
        /\.map\(|ids\b|Array\.from/,
        `${file} resolve nome fora de bloco: ${match[0]}`,
      );
    }
  });
});

test('a leitura simples não faz consulta crua ao Firestore', () => {
  // Nenhuma consulta pode escapar do teto que as Rules impõem (`limit` ≤ 100):
  // tudo passa pela camada de leitura, que já carrega `limit` e cursor.
  const consultaCrua = /getDocs\(|collection\(/;
  arquivosSimples().forEach((file) => {
    const content = readFileSync(file, 'utf8');
    assert.doesNotMatch(content, consultaCrua, `${file} consulta Firestore direto`);
  });
});

// ---------------------------------------------------------------------------
// G. Experiência final da Etapa 3 (§0.A, §0.B, §3.B, §7 e §11.H)
// ---------------------------------------------------------------------------

test('a tabela de investimentos não marca retirada com sinal de entrada', () => {
  /*
   * §0.A — dentro de Investimentos a moldura é o dinheiro investido: aporte
   * aumenta, retirada reduz. O "+" da retirada descrevia o caixa, e nesta tela
   * dizia o contrário do que aconteceu.
   */
  const view = readFileSync(
    'src/modules/investments/simple/components/SimpleInvestmentsView.tsx', 'utf8',
  );
  assert.doesNotMatch(view, /'withdrawal'\s*\?\s*'\+'/);
  assert.match(view, /row\.kind === 'withdrawal' \? '−' : '\+'/);
});

test('a busca da tela declara que cobre o que já foi carregado', () => {
  // §0.C — a busca por texto é da página carregada. Não dizê-lo faria "não
  // encontrei" parecer "não existe".
  const view = readFileSync(
    'src/modules/investments/simple/components/SimpleInvestmentsView.tsx', 'utf8',
  );
  assert.match(view, /A busca por texto procura nos lançamentos já carregados/);
});

test('a administração técnica de investimentos saiu de Configurações', () => {
  /*
   * §0.B — os componentes continuam íntegros no repositório; o que não pode
   * voltar é o ponto de montagem na configuração comum.
   */
  const settings = readFileSync('src/components/SettingsView.tsx', 'utf8');
  assert.doesNotMatch(settings, /<InvestmentOnboardingCard/);
  assert.doesNotMatch(settings, /<InvestmentRegistrySection/);
  assert.doesNotMatch(settings, /<InvestmentOperationsPanel/);
  // E continuam existindo, para não virar remoção disfarçada de simplificação.
  assert.ok(existsSync('src/modules/investments/components/InvestmentOperationsPanel.tsx'));
  assert.ok(existsSync('src/modules/investments/components/InvestmentRegistrySection.tsx'));
  assert.ok(existsSync('src/modules/investments/components/InvestmentOnboardingCard.tsx'));
});

test('a navegação comum não monta tela nem painel profissional', () => {
  /*
   * §3.B e §7 — nem a tela patrimonial com abas, nem o painel de patrimônio no
   * Dashboard. Os dois continuam no repositório e fora do caminho cotidiano.
   */
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.doesNotMatch(app, /<InvestmentsPortfolioView/);
  assert.doesNotMatch(app, /<InvestmentDashboardOverview/);
  assert.ok(existsSync('src/modules/investments/components/InvestmentsPortfolioView.tsx'));
  assert.ok(existsSync('src/modules/investments/components/InvestmentDashboardOverview.tsx'));
});

test('a faixa de alocação é PF ou PJ, nunca as duas', () => {
  // §6 — PF e PJ não se misturam, e o que decide é o perfil do workspace.
  const band = readFileSync(
    'src/modules/investments/simple/components/AllocationPanels.tsx', 'utf8',
  );
  assert.match(band, /profileType === 'PJ'\s*\n?\s*\?\s*<BusinessInvestmentAllocationPanel/);
  const view = readFileSync(
    'src/modules/investments/simple/components/SimpleInvestmentsView.tsx', 'utf8',
  );
  assert.match(view, /<InvestmentAllocationBand workspaceId={workspaceId} profileType={profileType} \/>/);
});

test('a meta abre o formulário simples, sem criar transação', () => {
  /*
   * §2.A — "Novo Aporte" dentro da meta abre `NewInvestmentModal` com a meta
   * travada. O destino é `createSimpleInvestment`; nenhuma transação é escrita
   * aqui, e nenhuma navegação exige uma segunda seleção manual.
   */
  const goal = readFileSync('src/components/GoalDetailsView.tsx', 'utf8');
  assert.match(goal, /<NewInvestmentModal/);
  assert.match(goal, /goalLocked/);
  assert.match(goal, /<LinkGoalInvestmentsModal/);
  assert.doesNotMatch(goal, /useCreateTransaction|createTransaction\(/);
});

test('a página de movimentos continua vindo do leitor paginado do domínio', () => {
  const api = readFileSync('src/modules/investments/simple/api.ts', 'utf8');
  assert.match(api, /listInvestmentMovements\(/);
  assert.match(api, /resolveInvestmentPositions\(/);
  assert.match(api, /getNextPageParam/);
});
