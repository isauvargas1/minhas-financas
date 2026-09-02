import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync, readFileSync} from 'node:fs';

import {
  SETTINGS_CATALOG_SECTION_LIST,
  listCommonSettingsCatalogSections,
  isCommonSettingsCatalogSection,
} from '../../src/modules/settings-catalog/presentation.ts';
import {SETTINGS_CATALOG_GROUP_CONFIG} from '../../src/modules/settings-catalog/constants.ts';
import {buildCreateSimpleInvestmentInput} from '../../src/modules/investments/simple/form.ts';

/**
 * Ponto de entrada de investimento em "Nova Transação" e recorte comum de
 * Configurações › Cadastros.
 *
 * O repositório não tem runner de componente, e inventar um seria trocar a
 * suíte por uma dependência nova. O que é lógica pura — quais seções o
 * catálogo comum oferece — é testado de verdade, importando o módulo; o que é
 * fiação de JSX é testado por contrato sobre a fonte, no mesmo formato das
 * guardas que a Etapa 2 já usa.
 */

const modal = readFileSync('src/components/TransactionModal.tsx', 'utf8');
const form = readFileSync(
  'src/modules/investments/simple/components/SimpleInvestmentForm.tsx', 'utf8',
);
const wrapper = readFileSync(
  'src/modules/investments/simple/components/NewInvestmentModal.tsx', 'utf8',
);

// ---------------------------------------------------------------------------
// A. A aba existe na criação
// ---------------------------------------------------------------------------

test('A. "Nova Transação" oferece Investimento entre Despesa e Cartão', () => {
  assert.match(
    modal,
    /return \['receita', 'despesa', 'investimento', 'parcelado'\];/,
    'o conjunto padrão de tipos não oferece investimento',
  );

  const ordem = ['receita', 'despesa', 'investimento', 'parcelado']
    .map((tipo) => modal.indexOf(`handleTabChange('${tipo}')`));
  assert.ok(ordem.every((posicao) => posicao > 0), 'falta uma das quatro abas');
  assert.deepEqual(
    [...ordem].sort((a, b) => a - b), ordem,
    'a ordem visual não é Receita, Despesa, Investimento, Cartão',
  );
  assert.match(modal, /className=\{tabClasses\('investimento'\)\}[\s\S]{0,200}>\s*Investimento\s*<\/button>/);
});

test('A. a edição não ganha Investimento como alternativa', () => {
  // O tipo permitido de uma transação em edição continua sendo o dela.
  assert.match(
    modal,
    /if \(isEditing && transactionToEdit\) \{\s*return \[transactionToEdit\.type\];\s*\}/,
  );
  // E a faixa de abas continua fora do modo de edição.
  assert.match(modal, /\{!isEditing && resolvedAllowedTypes\.length > 1 && \(/);
});

// ---------------------------------------------------------------------------
// B. O aporte não passa pelo submit de transação comum
// ---------------------------------------------------------------------------

test('B. a aba de investimento não alcança o submit de transação', () => {
  // Guarda explícita no início do submit comum.
  assert.match(
    modal,
    /const handleSubmit = async \(e: FormEvent\) => \{[\s\S]{0,400}?if \(activeTab === 'investimento'\) return;/,
  );

  // E o formulário comum — com `onAddTransaction`, `onAddTransactions` e
  // `transactionData` — nem chega a ser renderizado na aba de investimento.
  assert.match(
    modal,
    /\{activeTab === 'investimento' \? \([\s\S]{0,600}?<SimpleInvestmentForm[\s\S]{0,600}?\) : \(\s*<form onSubmit=\{handleSubmit\}>/,
  );

  // Nenhum `<form>` aninhado: o formulário simples traz o seu próprio.
  assert.equal((modal.match(/<form /g) ?? []).length, 1);
  assert.equal((form.match(/<form /g) ?? []).length, 1);
});

test('B. o modal de transações continua sem escrever investimento em transactions', () => {
  assert.doesNotMatch(modal, /type:\s*['"]investimento['"]/);
  assert.doesNotMatch(
    modal,
    /activeTab === 'investimento'[\s\S]{0,200}?onAddTransactions?\(/,
  );
});

test('B. trocar de aba não submete nada nem prepara o formulário comum', () => {
  const trecho = modal.slice(
    modal.indexOf('const handleTabChange'),
    modal.indexOf('// --- AI LOGIC: Common Form Pre-filler ---'),
  );

  // A aba de investimento sai do handler antes de qualquer preparo do
  // formulário comum — a saída vem antes da primeira escrita de estado dele.
  const ramo = trecho.indexOf("if (newTab === 'investimento')");
  assert.ok(ramo > 0, 'a troca para investimento não tem saída própria');
  assert.match(trecho.slice(ramo), /return;/);
  assert.ok(
    trecho.indexOf('setCategory(') > ramo,
    'o formulário comum é preparado antes da saída da aba de investimento',
  );

  // Um envio de aporte em curso não perde o próprio formulário por uma troca
  // de aba.
  assert.match(trecho, /if \(investmentPendingRef\.current\) return;/);

  // A troca de aba só mexe em estado local; nenhuma chamada de escrita ali.
  assert.doesNotMatch(trecho, /onAddTransaction|onUpdateTransaction|mutateAsync/);
});

// ---------------------------------------------------------------------------
// C. O destino é o domínio autoritativo
// ---------------------------------------------------------------------------

test('C. o formulário compartilhado grava por createSimpleInvestment', () => {
  assert.match(form, /useSimpleInvestmentMutation\(workspaceId\)/);
  assert.match(form, /name: 'createSimpleInvestment'/);
  assert.match(
    form,
    /buildCreateSimpleInvestmentInput\(\s*form, new Date\(intent\.occurredAt\(\)\), editing\?\.movementId,\s*\)/,
  );
  assert.match(form, /useFinancialIntent\(/);
  // Nada de transações, em nenhuma direção.
  assert.doesNotMatch(form, /onAddTransaction|useCreateTransaction|transactionData/);
});

test('C. a aba entrega workspace, metas e feedback da aplicação', () => {
  assert.match(modal, /workspaceId=\{activeWorkspace\.id\}/);
  assert.match(modal, /goals=\{goals\}/);
  // Fecha a modal principal e usa o `showNotification` do App, sem toast novo.
  assert.match(modal, /onClose=\{onClose\}/);
  assert.match(modal, /onSuccess=\{\(message\) => onInvestmentSuccess\?\.\(message\)\}/);
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /onInvestmentSuccess=\{showNotification\}/);
});

test('C. a moldura não fecha por cima de um aporte em curso', () => {
  /*
   * Quem fecha a modal comum é a moldura — X, fundo e Escape —, e o botão do
   * formulário simples não alcança nenhum dos três. Sem trava, fechar durante
   * a chamada desmonta o formulário e leva o erro junto.
   */
  assert.match(modal, /onPendingChange=\{setInvestmentPending\}/);
  assert.match(modal, /const requestClose = \(\) => \{\s*if \(investmentPendingRef\.current\) return;\s*onClose\(\);/);
  assert.match(modal, /onClick=\{requestClose\}[\s\S]{0,200}?aria-label="Fechar"/);
  assert.match(modal, /className="fixed inset-0[^"]*"\s+onClick=\{requestClose\}/);
  assert.match(modal, /if \(event\.key === 'Escape'\) requestClose\(\);/);
});

test('C. resultado de IA que chega tarde não atropela a aba de investimento', () => {
  /*
   * Voz e imagem preenchem só o formulário comum. A captura é do componente,
   * não do painel: esconder o painel não a interrompe, e o resultado chamaria
   * `applyAIData`, que troca de aba e desmontaria o aporte meio preenchido.
   */
  assert.match(
    modal,
    /const applyAIData = \(data: any\) => \{[\s\S]{0,700}?if \(activeTabRef\.current === 'investimento'\) return;/,
  );
  assert.match(
    modal,
    /if \(newTab === 'investimento'\) \{[\s\S]{0,600}?recognitionRef\.current\?\.stop\(\);/,
  );
});

// ---------------------------------------------------------------------------
// D. Um formulário só
// ---------------------------------------------------------------------------

test('D. a tela de Investimentos usa exatamente o mesmo componente', () => {
  assert.ok(existsSync('src/modules/investments/simple/components/SimpleInvestmentForm.tsx'));
  assert.match(wrapper, /import SimpleInvestmentForm/);
  assert.match(wrapper, /<SimpleInvestmentForm/);
  assert.match(modal, /import SimpleInvestmentForm from '\.\.\/modules\/investments\/simple\/components\/SimpleInvestmentForm\.tsx';/);

  // O wrapper é só moldura: nenhum campo, nenhuma validação, nenhuma callable.
  for (const duplicado of [
    /validateNewInvestment/, /buildCreateSimpleInvestmentInput/,
    /useSimpleInvestmentMutation/, /useSettingsCatalogGroup/, /useSettingsCatalog\(/,
    /name: 'createSimpleInvestment'/, /<SelectField/, /<CurrencyField/,
  ]) {
    assert.doesNotMatch(wrapper, duplicado, `NewInvestmentModal duplica ${duplicado}`);
  }
  assert.match(wrapper, /<SimpleModal/);
  assert.match(wrapper, /title=\{editing \? 'Editar investimento' : 'Novo investimento'\}/);
});

test('D. a experiência de Investimentos mantém campos, rótulos e edição pendente', () => {
  for (const rotulo of [
    /label="Carteira de investimento"/, /label="Instituição"/, /label="Categoria"/,
    /label="Valor do investimento"/, /legend="Esse valor já foi depositado\?"/,
    /Meta \(opcional\)/,
  ]) {
    assert.match(form, rotulo);
  }
  // Correção de pendente: cancelar o anterior e criar o substituto é uma
  // operação só, declarada ao domínio — não duas chamadas encadeadas aqui.
  assert.match(form, /editing\?\.movementId/);
  assert.doesNotMatch(form, /name: 'cancelInvestmentMovement'/);
  assert.match(form, /goalLocked/);
  // O `id` padrão é o do baseline; cada ponto de montagem usa o seu.
  assert.match(form, /idPrefix = 'simple'/);
  assert.match(modal, /idPrefix="transaction-investment"/);
  // E o contrato de edição pendente continua exportado de onde a tela o lê.
  assert.match(wrapper, /export type \{ EditingInvestment \}/);
  const view = readFileSync(
    'src/modules/investments/simple/components/SimpleInvestmentsView.tsx', 'utf8',
  );
  assert.match(view, /import NewInvestmentModal, \{ type EditingInvestment \} from '\.\/NewInvestmentModal'/);
});

test('D. a correção de pendente não tem estado parcial no cliente', () => {
  /*
   * O caminho anterior cancelava o pendente e só então criava o substituto,
   * em duas callables. Entre uma e outra existia um estado alcançável — o
   * pendente cancelado, o substituto recusado — em que o usuário perdia o
   * lançamento por ter tentado corrigir a descrição. A substituição passou a
   * ser uma chamada só, resolvida numa transação do domínio.
   */
  assert.doesNotMatch(form, /previousCancelled/);
  assert.doesNotMatch(form, /pendente anterior já foi cancelado/);
  assert.doesNotMatch(form, /cancelInvestmentMovement/);

  // Exatamente uma chamada de escrita no submit, e ela leva o antecessor.
  assert.equal((form.match(/mutation\.mutateAsync\(/g) ?? []).length, 1);
  assert.match(
    form,
    /buildCreateSimpleInvestmentInput\([\s\S]{0,120}?editing\?\.movementId/,
  );

  // E o payload montado declara o pendente substituído com esse nome.
  const payload = buildCreateSimpleInvestmentInput({
    goalId: '', classId: 'c', institutionId: 'i', description: 'd',
    typeId: 't', amount: '100', deposited: false, date: '2026-08-10',
  }, new Date('2026-08-10T15:00:00.000Z'), 'mov-antigo');
  assert.equal(payload.replacesMovementId, 'mov-antigo');
});

// ---------------------------------------------------------------------------
// E, F e G. Cadastros comuns e domínio técnico
// ---------------------------------------------------------------------------

const comuns = (tipo: 'PF' | 'PJ' = 'PF') =>
  listCommonSettingsCatalogSections(tipo).map((section) => section.shortTitle);

test('E. os cadastros do dia a dia estão na lista comum', () => {
  for (const tipo of ['PF', 'PJ'] as const) {
    for (const titulo of [
      'Categorias', 'Carteiras', 'Carteiras de investimento', 'Instituições',
    ]) {
      assert.ok(comuns(tipo).includes(titulo), `${titulo} sumiu de Cadastros (${tipo})`);
    }
  }
});

test('E. "Carteiras" e "Carteiras de investimento" continuam separadas', () => {
  const caixa = SETTINGS_CATALOG_SECTION_LIST.find((s) => s.key === 'wallets');
  const patrimonio = SETTINGS_CATALOG_SECTION_LIST.find((s) => s.key === 'investmentClasses');
  assert.equal(caixa?.group, 'wallet');
  assert.equal(caixa?.shortTitle, 'Carteiras');
  assert.equal(caixa?.title, 'Carteiras de caixa');
  assert.equal(patrimonio?.group, 'investment_class');
  assert.equal(patrimonio?.shortTitle, 'Carteiras de investimento');
  assert.notEqual(caixa?.group, patrimonio?.group);
});

test('F. os cadastros técnicos e o histórico saíram da lista comum', () => {
  for (const tipo of ['PF', 'PJ'] as const) {
    for (const titulo of [
      'Risco', 'Liquidez', 'Indexadores', 'Estratégias',
      // Cadastro **anterior** de categoria de investimento. Continua definido
      // e legível; deixou de ser oferecido, porque era a segunda fonte.
      'Categorias de investimento',
    ]) {
      assert.equal(
        comuns(tipo).includes(titulo), false,
        `${titulo} continua em Cadastros (${tipo})`,
      );
    }
  }
});

test('F. a tela não decide visibilidade por string solta', () => {
  const settings = readFileSync('src/components/SettingsView.tsx', 'utf8');
  for (const titulo of ['Risco', 'Liquidez', 'Indexadores', 'Estratégias']) {
    assert.doesNotMatch(settings, new RegExp(`['"\`]${titulo}['"\`]\\s*(?:!==|===)`));
  }
  const hook = readFileSync('src/modules/settings-catalog/useSettingsCatalogScreen.ts', 'utf8');
  assert.match(hook, /listCommonSettingsCatalogSections\(activeWorkspace\.type\)/);
});

test('G. os grupos fora da navegação comum continuam definidos', () => {
  const tecnicos = [
    ['investmentTypes', 'investment_type'],
    ['investmentRisks', 'investment_risk'],
    ['investmentLiquidity', 'investment_liquidity'],
    ['investmentIndexers', 'investment_indexer'],
    ['investmentStrategies', 'investment_strategy'],
  ] as const;

  for (const [key, group] of tecnicos) {
    const section = SETTINGS_CATALOG_SECTION_LIST.find((s) => s.key === key);
    assert.ok(section, `${key} foi removida do domínio`);
    assert.equal(section?.group, group);
    assert.equal(section?.audience, 'advanced');
    assert.equal(isCommonSettingsCatalogSection(section!), false);
    assert.ok(SETTINGS_CATALOG_GROUP_CONFIG[group], `${group} saiu de constants.ts`);
  }

  // Esconder não encolhe o domínio: a lista completa segue com as catorze.
  assert.equal(SETTINGS_CATALOG_SECTION_LIST.length, 14);
});

// ---------------------------------------------------------------------------
// I. Categoria: uma fonte só, nos dois pontos de entrada
// ---------------------------------------------------------------------------

/**
 * Havia dois cadastros de categoria de investimento na experiência comum,
 * ambos semeados no primeiro acesso do workspace, e só um deles chegava a
 * algum formulário. O que estes testes fixam é que sobrou um — e que ele é o
 * mesmo caminho por onde já passam receita, despesa e parcelado.
 *
 * A regra de compatibilidade em si é função pura e está provada de verdade em
 * `investment-simple-form.test.ts`; aqui o que se verifica é a fiação.
 */

test('I. o formulário lê a categoria de Categorias › Investimentos', () => {
  assert.match(
    form,
    /useSettingsCatalog\(\{\s*group: 'category',\s*transactionSubtype: 'investimento',\s*\}\)/,
  );
  // A leitura é a consulta já cacheada do catálogo, recortada em memória:
  // nenhuma consulta nova por causa desta tela.
  assert.match(form, /import \{\s*useSettingsCatalog,\s*useSettingsCatalogGroup,\s*\} from '\.\.\/\.\.\/\.\.\/settings-catalog\/hooks'/);
  // E o empty state manda para o lugar certo.
  assert.match(form, /Configurações › Cadastros › Categorias › Investimentos/);
  assert.doesNotMatch(form, /Cadastros › Categorias de investimento/);
});

test('I. o cadastro anterior não é uma segunda fonte de criação', () => {
  // Nenhum formulário do modo simples lê mais o grupo histórico.
  assert.doesNotMatch(form, /useSettingsCatalogGroup\('investment_type'\)/);
  assert.doesNotMatch(form, /'investment_type'/);
  // Carteira e instituição continuam nos grupos próprios — a unificação é da
  // categoria, e de mais nada.
  assert.match(form, /useSettingsCatalogGroup\('investment_class'\)/);
  assert.match(form, /useSettingsCatalogGroup\('investment_institution'\)/);
});

test('I. os dois pontos de entrada compartilham a mesma leitura', () => {
  /*
   * Não há o que sincronizar: a aba de "Nova Transação" e o modal de
   * Investimentos montam o **mesmo** componente, e a leitura de catálogo
   * existe uma vez só dentro dele. Uma categoria criada em Configurações
   * aparece nos dois porque é literalmente a mesma consulta.
   */
  assert.equal((form.match(/useSettingsCatalog\(\{/g) ?? []).length, 1);
  for (const ponto of [modal, wrapper]) {
    assert.match(ponto, /<SimpleInvestmentForm/);
    assert.doesNotMatch(ponto, /useSettingsCatalog/);
    assert.doesNotMatch(ponto, /transactionSubtype: 'investimento'/);
  }
});

test('I. o pendente legado reabre com a própria categoria', () => {
  // O contrato de edição carrega o rótulo fotografado no movimento...
  assert.match(form, /typeName\?: string;/);
  // ...e a decisão sobre as opções é a função pura, não uma regra inline.
  assert.match(
    form,
    /buildCategoryOptions\(categories\.data, form\.typeId, editing\?\.typeName\)/,
  );
  // A listagem entrega esse rótulo a partir do próprio movimento, sem
  // consultar o catálogo por nome.
  const view = readFileSync(
    'src/modules/investments/simple/components/SimpleInvestmentsView.tsx', 'utf8',
  );
  assert.match(view, /typeName: row\.category,/);
});

test('I. o rótulo da carteira não se confunde com carteira de caixa', () => {
  assert.match(form, /label="Carteira de investimento"/);
  assert.doesNotMatch(form, /label="Carteira"/);
  // O identificador técnico não mudou junto com o rótulo.
  assert.match(form, /useSettingsCatalogGroup\('investment_class'\)/);
});

/** Só o código: um comentário que explica a ausência não é uma ocorrência. */
const semComentarios = (fonte: string) => fonte
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('I. nenhum fluxo simples pede carteira de caixa', () => {
  const proibidos = /walletId|sourceWallet|destinationWallet|cashWallet|cashAccount/;
  const arquivos = [
    'src/modules/investments/simple/form.ts',
    'src/modules/investments/simple/api.ts',
    'src/modules/investments/simple/components/SimpleInvestmentForm.tsx',
    'src/modules/investments/simple/components/WithdrawInvestmentModal.tsx',
    'src/modules/investments/simple/components/ConfirmMovementModal.tsx',
  ];
  for (const arquivo of arquivos) {
    const conteudo = semComentarios(readFileSync(arquivo, 'utf8'));
    assert.doesNotMatch(conteudo, proibidos, `${arquivo} pede carteira de caixa`);
  }
  // E o payload montado pelo formulário continua sem o campo.
  const payload = readFileSync(
    'src/modules/investments/simple/form.ts', 'utf8',
  ).slice(0, 0) + JSON.stringify(Object.keys(
    buildCreateSimpleInvestmentInput({
      goalId: '', classId: 'c', institutionId: 'i', description: 'd',
      typeId: 't', amount: '100', deposited: true, date: '2026-08-10',
    }, new Date('2026-08-10T15:00:00.000Z')),
  ));
  assert.doesNotMatch(payload, /wallet/i);
});

test('I. Cadastros comuns mostram exatamente a experiência decidida', () => {
  for (const tipo of ['PF', 'PJ'] as const) {
    const lista = comuns(tipo);
    for (const titulo of [
      'Categorias', 'Carteiras', 'Carteiras de investimento', 'Instituições',
    ]) {
      assert.ok(lista.includes(titulo), `${titulo} sumiu de Cadastros (${tipo})`);
    }
    for (const titulo of [
      'Categorias de investimento', 'Risco', 'Liquidez', 'Indexadores',
      'Estratégias',
    ]) {
      assert.equal(
        lista.includes(titulo), false,
        `${titulo} continua em Cadastros (${tipo})`,
      );
    }
  }
  // "Categorias" oferece as quatro abas, e Investimentos é uma delas.
  const categorias = SETTINGS_CATALOG_SECTION_LIST.find((s) => s.key === 'categories');
  assert.equal(categorias?.group, 'category');
  assert.equal(categorias?.supportsTransactionSubtype, true);
  assert.deepEqual(
    SETTINGS_CATALOG_GROUP_CONFIG.category.allowedTransactionSubtypes,
    ['receita', 'despesa', 'investimento', 'parcelado'],
  );
});

// ---------------------------------------------------------------------------
// H. Receita, despesa e cartão inalterados
// ---------------------------------------------------------------------------

test('H. receita, despesa e cartão seguem no formulário comum', () => {
  for (const ramo of [
    /if \(activeTab === 'receita'\) \{/,
    /if \(activeTab === 'despesa'\) \{/,
    /if \(activeTab === 'parcelado'\) \{/,
  ]) {
    assert.match(modal, ramo);
  }
  // Os destinos de escrita das três continuam onde estavam.
  assert.match(modal, /await onAddCreditCardPurchase\(\{/);
  assert.match(modal, /onAddTransactions\(newTransactions\)/);
  assert.match(modal, /else await onAddTransaction\(transactionData as Omit<Transaction, 'id'>\)/);
});

test('H. a IA continua ligada só ao formulário que ela sabe preencher', () => {
  // Escanear comprovante e falar transação seguem intactos nas outras abas...
  assert.match(modal, /extractTransactionFromContent/);
  assert.match(modal, /\['receita', 'despesa', 'parcelado'\]\.includes\(data\.type\)/);
  // ...e o painel some enquanto a aba de investimento está ativa.
  assert.match(modal, /\{!isEditing && activeTab !== 'investimento' && \(/);
});
