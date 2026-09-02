import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCategoryOptions,
  buildCreateSimpleInvestmentInput,
  buildWithdrawSimpleInvestmentInput,
  dateInputToInstant,
  dateInputValue,
  emptyNewInvestmentForm,
  emptyWithdrawForm,
  formatCentsInput,
  isValidDateInput,
  LEGACY_CATEGORY_FALLBACK_LABEL,
  maskCurrencyInput,
  parseCurrencyInput,
  validateNewInvestment,
  validateWithdraw,
} from '../../src/modules/investments/simple/form.ts';

/**
 * Formulários simples (Etapa 2, §4, §8 e §9).
 *
 * O ponto que estes testes fixam é o contrato do payload: a interface **não**
 * monta conta, ativo, quantidade, preço, tipo técnico nem posição, e a única
 * pergunta que decide efeito financeiro é "já foi depositado / já foi
 * recebido".
 */

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

test('novo investimento exige carteira, instituição, descrição, categoria e valor', () => {
  const errors = validateNewInvestment(emptyNewInvestmentForm(AGORA));
  assert.deepEqual(Object.keys(errors).sort(), [
    'amount', 'classId', 'description', 'institutionId', 'typeId',
  ]);
});

test('meta é opcional: formulário sem meta é válido', () => {
  const form = {
    ...emptyNewInvestmentForm(AGORA),
    classId: 'carteira-1',
    institutionId: 'btg',
    typeId: 'renda-fixa',
    description: 'CDB 120% CDI',
    amount: maskCurrencyInput('100000'),
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

test('depositado Sim cria liquidado; depositado Não cria pendente', () => {
  const base = {
    ...emptyNewInvestmentForm(AGORA),
    classId: 'c', institutionId: 'i', typeId: 't',
    description: 'Aporte', amount: maskCurrencyInput('20000'),
  };
  assert.equal(buildCreateSimpleInvestmentInput({...base, deposited: true}, AGORA).settled, true);
  assert.equal(buildCreateSimpleInvestmentInput({...base, deposited: false}, AGORA).settled, false);
});

test('payload de novo investimento não carrega nada técnico', () => {
  const payload = buildCreateSimpleInvestmentInput({
    ...emptyNewInvestmentForm(AGORA),
    classId: 'c', institutionId: 'i', typeId: 't',
    description: '  Tesouro Selic  ', amount: maskCurrencyInput('123456'),
  }, AGORA);
  assert.deepEqual(Object.keys(payload).sort(), [
    'classId', 'description', 'institutionId', 'occurredAt', 'settled', 'typeId', 'valueCents',
  ]);
  assert.equal(payload.description, 'Tesouro Selic');
  assert.equal(payload.valueCents, 123_456);
});

test('retirada sem rendimento não envia gainCents', () => {
  const form = {...emptyWithdrawForm(AGORA), amount: maskCurrencyInput('50000')};
  const payload = buildWithdrawSimpleInvestmentInput(form, 'pos-1', AGORA);
  assert.equal('gainCents' in payload, false);
  assert.equal(payload.valueCents, 50_000);
  assert.equal(payload.received, true);
  assert.equal(payload.positionId, 'pos-1');
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
// Categoria — fonte única, com compatibilidade do tamanho exato do problema
// ---------------------------------------------------------------------------

/**
 * O cadastro visível é `category` + `transactionSubtype: "investimento"`. O
 * que a função recebe já é esse recorte; o que ela decide é o que fazer com
 * um identificador selecionado que não está nele.
 */
const CADASTRO_ATUAL = [
  {id: 'legacy_acoes', name: 'Ações'},
  {id: 'legacy_cdb', name: 'CDB'},
  {id: 'custom-cripto', name: 'Cripto'},
];

test('as opções da categoria são exatamente o cadastro atual', () => {
  assert.deepEqual(buildCategoryOptions(CADASTRO_ATUAL, ''), [
    {value: 'legacy_acoes', label: 'Ações'},
    {value: 'legacy_cdb', label: 'CDB'},
    {value: 'custom-cripto', label: 'Cripto'},
  ]);
  // Um item do cadastro já selecionado não é duplicado.
  assert.deepEqual(
    buildCategoryOptions(CADASTRO_ATUAL, 'legacy_cdb').map((o) => o.value),
    ['legacy_acoes', 'legacy_cdb', 'custom-cripto'],
  );
  // Catálogo ainda carregando: nada é inventado.
  assert.deepEqual(buildCategoryOptions(undefined, ''), []);
});

test('pendente legado preserva a própria categoria, e só ela', () => {
  const opcoes = buildCategoryOptions(
    CADASTRO_ATUAL, 'investment_default_antigo', 'Renda fixa',
  );
  assert.deepEqual(opcoes[0], {
    value: 'investment_default_antigo', label: 'Renda fixa',
  });
  // Uma opção de compatibilidade, nunca o catálogo antigo inteiro.
  assert.equal(opcoes.length, CADASTRO_ATUAL.length + 1);
  assert.deepEqual(
    opcoes.slice(1).map((o) => o.value),
    ['legacy_acoes', 'legacy_cdb', 'custom-cripto'],
  );
});

test('sem rótulo fotografado, a opção legada ainda é identificável', () => {
  const semNome = buildCategoryOptions(CADASTRO_ATUAL, 'id-orfao');
  assert.equal(semNome[0].label, LEGACY_CATEGORY_FALLBACK_LABEL);
  const nomeVazio = buildCategoryOptions(CADASTRO_ATUAL, 'id-orfao', '   ');
  assert.equal(nomeVazio[0].label, LEGACY_CATEGORY_FALLBACK_LABEL);
});

test('escolher uma categoria do cadastro atual encerra a compatibilidade', () => {
  // O usuário estava no item legado...
  const antes = buildCategoryOptions(
    CADASTRO_ATUAL, 'investment_default_antigo', 'Renda fixa',
  );
  assert.equal(antes.length, 4);
  // ...e escolheu uma categoria da lista. A opção antiga some, e não há
  // caminho de volta ao cadastro que saiu da experiência comum.
  const depois = buildCategoryOptions(
    CADASTRO_ATUAL, 'legacy_acoes', 'Renda fixa',
  );
  assert.equal(depois.length, 3);
  assert.equal(
    depois.some((o) => o.value === 'investment_default_antigo'), false,
  );
});

test('a compatibilidade não usa rótulo para reconhecer o item', () => {
  /*
   * Um item legado chamado "Ações" e uma categoria atual chamada "Ações" são
   * documentos diferentes. A função não os funde: a identidade é o ID.
   */
  const opcoes = buildCategoryOptions(CADASTRO_ATUAL, 'investment_default_x', 'Ações');
  assert.equal(opcoes.length, 4);
  assert.equal(opcoes[0].value, 'investment_default_x');
  assert.equal(opcoes[1].value, 'legacy_acoes');
});
