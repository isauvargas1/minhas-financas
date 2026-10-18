import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCategoryOptions,
  buildCreateSimpleInvestmentInput,
  buildGoalSelectOptions,
  buildWithdrawSimpleInvestmentInput,
  dateInputToInstant,
  dateInputValue,
  emptyNewInvestmentForm,
  emptyWithdrawForm,
  formatCentsInput,
  CONTRIBUTION_ACCOUNT_MESSAGE,
  isValidDateInput,
  maskCurrencyInput,
  parseCurrencyInput,
  SELECTED_CATEGORY_FALLBACK_LABEL,
  SELECTED_GOAL_FALLBACK_LABEL,
  validateNewInvestment,
  validateWithdraw,
  WITHDRAWAL_ACCOUNT_MESSAGE,
} from '../../src/modules/investments/simple/form.ts';

/**
 * Formulários simples (Etapa 2, §4, §8 e §9).
 *
 * O ponto que estes testes fixam é o contrato do payload: a interface **não**
 * monta conta de investimento, ativo, quantidade, preço, tipo técnico nem
 * posição, e a única pergunta que decide efeito financeiro é "já foi
 * depositado / já foi recebido". Quando a resposta é Sim, a conta do Caixa
 * (`cashAccountId`, D-30) viaja junto — e só nesse caso.
 */

const CONTA = 'conta-corrente';

const AGORA = new Date('2026-08-31T15:30:00.000-03:00');

test('máscara de moeda entra pela direita, em centavos', () => {
  assert.equal(parseCurrencyInput(''), 0);
  assert.equal(parseCurrencyInput('1'), 1);
  assert.equal(parseCurrencyInput('123'), 123);
  assert.equal(parseCurrencyInput('R$ 1.234,56'), 123_456);
  assert.equal(formatCentsInput(123_456), '1.234,56');
  assert.equal(maskCurrencyInput('123456'), '1.234,56');
  assert.equal(maskCurrencyInput('abc'), '');
});

test('data do campo vira meio-dia local, para nenhum fuso mudar o dia', () => {
  const instante = dateInputToInstant('2026-08-10', AGORA);
  assert.equal(new Date(instante).getDate(), 10);
  assert.equal(isValidDateInput('2026-08-10'), true);
  assert.equal(isValidDateInput('10/08/2026'), false);
  assert.equal(isValidDateInput(''), false);
});

test('data de hoje antes do meio-dia não é enviada como futuro', () => {
  // A liquidação recusa data futura com tolerância de cinco minutos. Meio-dia
  // de hoje seria futuro às 9h e derrubaria um "Confirmar depósito" legítimo.
  const manha = new Date('2026-08-31T09:00:00.000-03:00');
  const instante = dateInputToInstant(dateInputValue(manha), manha);
  assert.ok(new Date(instante).getTime() <= manha.getTime());
});

test('data futura escolhida de propósito continua futura', () => {
  const instante = dateInputToInstant('2026-12-24', AGORA);
  assert.ok(new Date(instante).getTime() > AGORA.getTime());
});

test('novo investimento exige carteira, instituição, descrição, categoria, valor e conta de origem', () => {
  const errors = validateNewInvestment(emptyNewInvestmentForm(AGORA));
  assert.deepEqual(Object.keys(errors).sort(), [
    'amount', 'cashAccountId', 'classId', 'description', 'institutionId', 'typeId',
  ]);
  assert.equal(errors.cashAccountId, CONTRIBUTION_ACCOUNT_MESSAGE);
  // Pendente não pede conta: ela é escolhida na confirmação do depósito.
  const pendente = validateNewInvestment({ ...emptyNewInvestmentForm(AGORA), deposited: false });
  assert.equal('cashAccountId' in pendente, false);
});

test('meta é opcional: formulário sem meta é válido', () => {
  const form = {
    ...emptyNewInvestmentForm(AGORA),
    classId: 'carteira-1',
    institutionId: 'btg',
    typeId: 'renda-fixa',
    description: 'CDB 120% CDI',
    amount: maskCurrencyInput('100000'),
    cashAccountId: CONTA,
  };
  assert.deepEqual(validateNewInvestment(form), {});
  const payload = buildCreateSimpleInvestmentInput(form, AGORA);
  assert.equal('goalId' in payload, false);
});

test('meta escolhida viaja como goalId', () => {
  const form = {
    ...emptyNewInvestmentForm(AGORA, 'meta-viagem'),
    classId: 'carteira-1',
    institutionId: 'btg',
    typeId: 'renda-fixa',
    description: 'CDB',
    amount: maskCurrencyInput('50000'),
  };
  assert.equal(buildCreateSimpleInvestmentInput(form, AGORA).goalId, 'meta-viagem');
});

/**
 * Correção de pendente: o antecessor viaja no payload da criação.
 *
 * Cancelar o pendente e criar o substituto em duas chamadas deixava um estado
 * parcial alcançável — pendente cancelado, substituto recusado — e o usuário
 * perdia o lançamento. O formulário passa a declarar qual pendente está sendo
 * substituído, e o domínio resolve as duas metades na mesma transação.
 */
test('correção de pendente declara o movimento substituído', () => {
  const base = {
    ...emptyNewInvestmentForm(AGORA),
    classId: 'c', institutionId: 'i', typeId: 't',
    description: 'CDB corrigido', amount: maskCurrencyInput('25000'),
    deposited: false,
  };

  // Lançamento novo: o campo simplesmente não existe no payload.
  assert.equal('replacesMovementId' in buildCreateSimpleInvestmentInput(base, AGORA), false);
  assert.equal(
    'replacesMovementId' in buildCreateSimpleInvestmentInput(base, AGORA, ''), false,
    'string vazia virou substituição',
  );

  // Correção: viaja o identificador do pendente, e nada mais muda.
  const correcao = buildCreateSimpleInvestmentInput(base, AGORA, 'mov-antigo');
  assert.equal(correcao.replacesMovementId, 'mov-antigo');
  assert.equal(correcao.settled, false);
  assert.deepEqual(
    {...correcao, replacesMovementId: undefined},
    {...buildCreateSimpleInvestmentInput(base, AGORA), replacesMovementId: undefined},
    'a substituição alterou algum outro campo do payload',
  );
});

test('depositado Sim cria liquidado com a conta de origem; Não cria pendente sem conta', () => {
  const base = {
    ...emptyNewInvestmentForm(AGORA),
    classId: 'c', institutionId: 'i', typeId: 't',
    description: 'Aporte', amount: maskCurrencyInput('20000'),
    cashAccountId: CONTA,
  };
  const liquidado = buildCreateSimpleInvestmentInput({...base, deposited: true}, AGORA);
  assert.equal(liquidado.settled, true);
  assert.equal(liquidado.cashAccountId, CONTA);
  // A conta escolhida antes de trocar para "Não" não vaza para o pendente.
  const pendente = buildCreateSimpleInvestmentInput({...base, deposited: false}, AGORA);
  assert.equal(pendente.settled, false);
  assert.equal('cashAccountId' in pendente, false);
});

test('payload de novo investimento não carrega nada técnico', () => {
  const payload = buildCreateSimpleInvestmentInput({
    ...emptyNewInvestmentForm(AGORA),
    classId: 'c', institutionId: 'i', typeId: 't',
    description: '  Tesouro Selic  ', amount: maskCurrencyInput('123456'),
    cashAccountId: CONTA,
  }, AGORA);
  assert.deepEqual(Object.keys(payload).sort(), [
    'cashAccountId', 'classId', 'description', 'institutionId', 'occurredAt', 'settled',
    'typeId', 'valueCents',
  ]);
  assert.equal(payload.description, 'Tesouro Selic');
  assert.equal(payload.valueCents, 123_456);
});

test('retirada sem rendimento não envia gainCents', () => {
  const form = {...emptyWithdrawForm(AGORA), amount: maskCurrencyInput('50000'), cashAccountId: CONTA};
  const payload = buildWithdrawSimpleInvestmentInput(form, 'pos-1', AGORA);
  assert.equal('gainCents' in payload, false);
  assert.equal(payload.valueCents, 50_000);
  assert.equal(payload.received, true);
  assert.equal(payload.positionId, 'pos-1');
  assert.equal(payload.cashAccountId, CONTA);
});

test('retirada recebida exige conta de destino; pendente não leva conta', () => {
  const recebida = {...emptyWithdrawForm(AGORA), amount: maskCurrencyInput('50000')};
  assert.equal(validateWithdraw(recebida).cashAccountId, WITHDRAWAL_ACCOUNT_MESSAGE);
  assert.deepEqual(validateWithdraw({...recebida, cashAccountId: CONTA}), {});
  const pendente = {...recebida, received: false, cashAccountId: CONTA};
  assert.deepEqual(validateWithdraw({...pendente, cashAccountId: ''}), {});
  assert.equal('cashAccountId' in buildWithdrawSimpleInvestmentInput(pendente, 'pos-1', AGORA), false);
});

test('retirada com rendimento envia gainCents explicitamente', () => {
  const form = {
    ...emptyWithdrawForm(AGORA),
    amount: maskCurrencyInput('115000'),
    gain: maskCurrencyInput('15000'),
  };
  const payload = buildWithdrawSimpleInvestmentInput(form, 'pos-1', AGORA);
  assert.equal(payload.valueCents, 115_000);
  assert.equal(payload.gainCents, 15_000);
});

test('retirada só de rendimento é representável', () => {
  const form = {
    ...emptyWithdrawForm(AGORA),
    amount: maskCurrencyInput('9000'),
    gain: maskCurrencyInput('9000'),
    cashAccountId: CONTA,
  };
  assert.deepEqual(validateWithdraw(form), {});
  const payload = buildWithdrawSimpleInvestmentInput(form, 'pos-1', AGORA);
  assert.equal(payload.valueCents, payload.gainCents);
});

test('recebido Não cria retirada pendente', () => {
  const form = {
    ...emptyWithdrawForm(AGORA),
    amount: maskCurrencyInput('30000'),
    received: false,
  };
  assert.equal(buildWithdrawSimpleInvestmentInput(form, 'pos-1', AGORA).received, false);
});

test('rendimento maior que o total é recusado antes de sair da tela', () => {
  const form = {
    ...emptyWithdrawForm(AGORA),
    amount: maskCurrencyInput('10000'),
    gain: maskCurrencyInput('20000'),
  };
  assert.match(validateWithdraw(form).gain ?? '', /não pode ser maior/i);
});

test('valor zero é recusado nos dois formulários', () => {
  assert.match(validateWithdraw(emptyWithdrawForm(AGORA)).amount ?? '', /maior que zero/i);
  assert.match(
    validateNewInvestment(emptyNewInvestmentForm(AGORA)).amount ?? '',
    /maior que zero/i,
  );
});

// ---------------------------------------------------------------------------
// A. Duplo submit protegido (§16.A)
// ---------------------------------------------------------------------------

test('duplo submit da mesma intenção produz uma chave só', async () => {
  const {investmentIdempotencyKey} = await import(
    '../../src/modules/investments/persistence/intent.ts'
  );
  const form = {
    ...emptyNewInvestmentForm(AGORA),
    classId: 'c', institutionId: 'i', typeId: 't',
    description: 'Aporte', amount: maskCurrencyInput('100000'),
  };
  // `occurredAt` é congelado na primeira tentativa pelo `useFinancialIntent`,
  // então as duas montagens do payload são idênticas — é isso que faz o
  // segundo clique ser replay de idempotência, e não um segundo aporte.
  const primeiro = buildCreateSimpleInvestmentInput(form, AGORA);
  const segundo = buildCreateSimpleInvestmentInput(form, AGORA);
  assert.deepEqual(primeiro, segundo);

  const nonce = 'nonce-do-formulario-aberto';
  assert.equal(
    investmentIdempotencyKey('createSimpleInvestment', nonce, primeiro),
    investmentIdempotencyKey('createSimpleInvestment', nonce, segundo),
  );
});

test('corrigir o valor depois de um erro é uma intenção diferente', async () => {
  const {investmentIdempotencyKey} = await import(
    '../../src/modules/investments/persistence/intent.ts'
  );
  const base = {
    ...emptyNewInvestmentForm(AGORA),
    classId: 'c', institutionId: 'i', typeId: 't', description: 'Aporte',
  };
  const nonce = 'mesmo-formulario';
  const chave = (valor: string) => investmentIdempotencyKey(
    'createSimpleInvestment',
    nonce,
    buildCreateSimpleInvestmentInput({...base, amount: maskCurrencyInput(valor)}, AGORA),
  );
  // Mesma chave devolveria `idempotency_conflict` para um fato diferente.
  assert.notEqual(chave('100000'), chave('200000'));
});

test('retirada repetida na mesma intenção também converge para uma chave', async () => {
  const {investmentIdempotencyKey} = await import(
    '../../src/modules/investments/persistence/intent.ts'
  );
  const form = {...emptyWithdrawForm(AGORA), amount: maskCurrencyInput('50000')};
  const nonce = 'retirada-aberta';
  const chave = () => investmentIdempotencyKey(
    'withdrawSimpleInvestment',
    nonce,
    buildWithdrawSimpleInvestmentInput(form, 'pos-1', AGORA),
  );
  assert.equal(chave(), chave());
});


// ---------------------------------------------------------------------------
// Categoria — fonte única; exceção do tamanho de um identificador inativado
// ---------------------------------------------------------------------------

/**
 * O cadastro visível é `category` + `transactionSubtype: "investimento"`. O
 * que a função recebe já é esse recorte (só itens ativos); o que ela decide é
 * o que fazer com o identificador já selecionado que foi inativado depois do
 * lançamento — a correção de um pendente cuja categoria saiu da lista.
 */
const CADASTRO_ATUAL = [
  {id: 'cat-acoes', name: 'Ações'},
  {id: 'cat-cdb', name: 'CDB'},
  {id: 'custom-cripto', name: 'Cripto'},
];

test('as opções da categoria são exatamente o cadastro atual', () => {
  assert.deepEqual(buildCategoryOptions(CADASTRO_ATUAL, ''), [
    {value: 'cat-acoes', label: 'Ações'},
    {value: 'cat-cdb', label: 'CDB'},
    {value: 'custom-cripto', label: 'Cripto'},
  ]);
  // Um item do cadastro já selecionado não é duplicado.
  assert.deepEqual(
    buildCategoryOptions(CADASTRO_ATUAL, 'cat-cdb').map((o) => o.value),
    ['cat-acoes', 'cat-cdb', 'custom-cripto'],
  );
  // Catálogo ainda carregando: nada é inventado.
  assert.deepEqual(buildCategoryOptions(undefined, ''), []);
});

test('categoria inativada depois do lançamento continua selecionada, e só ela', () => {
  const opcoes = buildCategoryOptions(CADASTRO_ATUAL, 'cat-inativada', 'Renda fixa');
  assert.deepEqual(opcoes[0], {value: 'cat-inativada', label: 'Renda fixa'});
  // Uma opção a mais, nunca outro cadastro inteiro.
  assert.equal(opcoes.length, CADASTRO_ATUAL.length + 1);
  assert.deepEqual(
    opcoes.slice(1).map((o) => o.value),
    ['cat-acoes', 'cat-cdb', 'custom-cripto'],
  );
});

test('sem rótulo fotografado, a categoria selecionada ainda é identificável', () => {
  const semNome = buildCategoryOptions(CADASTRO_ATUAL, 'id-orfao');
  assert.equal(semNome[0].label, SELECTED_CATEGORY_FALLBACK_LABEL);
  const nomeVazio = buildCategoryOptions(CADASTRO_ATUAL, 'id-orfao', '   ');
  assert.equal(nomeVazio[0].label, SELECTED_CATEGORY_FALLBACK_LABEL);
});

test('escolher uma categoria do cadastro atual faz a opção inativada sumir', () => {
  const antes = buildCategoryOptions(CADASTRO_ATUAL, 'cat-inativada', 'Renda fixa');
  assert.equal(antes.length, 4);
  const depois = buildCategoryOptions(CADASTRO_ATUAL, 'cat-acoes', 'Renda fixa');
  assert.equal(depois.length, 3);
  assert.equal(depois.some((o) => o.value === 'cat-inativada'), false);
});

test('a categoria é reconhecida por identificador, nunca por rótulo', () => {
  /*
   * Um item inativado chamado "Ações" e uma categoria ativa chamada "Ações"
   * são documentos diferentes. A função não os funde: a identidade é o ID.
   */
  const opcoes = buildCategoryOptions(CADASTRO_ATUAL, 'cat-acoes-antiga', 'Ações');
  assert.equal(opcoes.length, 4);
  assert.equal(opcoes[0].value, 'cat-acoes-antiga');
  assert.equal(opcoes[1].value, 'cat-acoes');
});

// --- P5-B.1: seletor de meta sem teto fixo ------------------------------------

const goalSource = (id: string, name: string, status = 'em_andamento', emoji?: string) => ({
  id, name, status, ...(emoji ? {visual: {emoji}} : {}),
});

test('seletor de meta: só metas em andamento, com emoji no rótulo', () => {
  const options = buildGoalSelectOptions([
    goalSource('g1', 'Reserva', 'em_andamento', '🏦'),
    goalSource('g2', 'Pausada', 'pausada'),
    goalSource('g3', 'Viagem'),
  ], '');
  assert.deepEqual(options, [
    {value: 'g1', label: '🏦 Reserva'},
    {value: 'g3', label: 'Viagem'},
  ]);
});

test('seletor de meta: a meta selecionada nunca some, mesmo fora das páginas carregadas', () => {
  // Resolvida por ID (a 150ª meta, por exemplo): aparece com o nome.
  const resolved = buildGoalSelectOptions([goalSource('g1', 'Reserva'), goalSource('g150', 'Meta 150')], 'g150');
  assert.deepEqual(resolved.map((option) => option.value), ['g1', 'g150']);
  // Selecionada e pausada: continua visível para não virar "Sem meta" no campo.
  const paused = buildGoalSelectOptions([goalSource('g2', 'Pausada', 'pausada')], 'g2');
  assert.deepEqual(paused, [{value: 'g2', label: 'Pausada'}]);
  // Ainda sem resolver: opção provisória com o mesmo valor, nunca vazio.
  const pending = buildGoalSelectOptions([goalSource('g1', 'Reserva')], 'g201');
  assert.deepEqual(pending.at(-1), {value: 'g201', label: SELECTED_GOAL_FALLBACK_LABEL});
  assert.equal(SELECTED_GOAL_FALLBACK_LABEL, 'Meta selecionada');
  // Sem seleção, nenhuma opção extra.
  assert.equal(buildGoalSelectOptions([goalSource('g1', 'Reserva')], '').length, 1);
});
