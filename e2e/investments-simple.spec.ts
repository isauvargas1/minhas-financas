import { expect, test, type Page } from '@playwright/test';
import { createRequire } from 'node:module';

/**
 * Fluxo simples de Investimentos (Etapa 2, §17).
 *
 * Percorre em runtime o roteiro completo: abrir Investimentos, criar um
 * investimento pendente, confirmar o depósito, criar um já depositado, retirar
 * sem receber, confirmar o recebimento, e checar a responsividade básica.
 *
 * Toda escrita passa pelas callables do modo simples. O teste confere o
 * **ledger** depois de cada passo, e não só a tela: uma interface que mostra
 * "Depositado" sem movimento liquidado seria pior que uma que não mostra nada.
 */

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');

const PROJECT = 'minhas-financas-local';
const UID = 'e2e-investments-simple-owner';
const EMAIL = 'e2e-investments-simple@minhas-financas.local';
const PASSWORD = 'e2e-investments-simple-password';
const WORKSPACE = 'e2e-investments-simple-workspace';

const CARTEIRA = 'catalog-class-reserva';
const INSTITUICAO = 'catalog-institution-btg';
/*
 * Categoria do investimento: catálogo genérico `category` com
 * `transactionSubtype: "investimento"` — Configurações › Cadastros ›
 * Categorias › Investimentos, a fonte única desde a unificação.
 */
const CATEGORIA = 'catalog-category-renda-fixa';

const sdk = () => {
  process.env.GCLOUD_PROJECT = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  return admin;
};

const catalogo = (
  id: string,
  group: string,
  name: string,
  normalizedName: string,
  sortOrder: number,
  transactionSubtype?: string,
) => ({
  id,
  workspaceId: WORKSPACE,
  group,
  name,
  normalizedName,
  ...(transactionSubtype ? { transactionSubtype } : {}),
  dedupeKey: `${group}::${transactionSubtype ?? 'all'}::both::${normalizedName}`,
  workspaceScope: 'both',
  sortOrder,
  status: 'active',
  createdBy: UID,
  updatedBy: UID,
});

test.beforeEach(async () => {
  const firebaseAdmin = sdk();
  const db = firebaseAdmin.firestore();
  await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE}`));
  try {
    await firebaseAdmin.auth().deleteUser(UID);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  await firebaseAdmin.auth().createUser({
    uid: UID, email: EMAIL, password: PASSWORD, emailVerified: true,
  });
  const now = firebaseAdmin.firestore.Timestamp.now();
  const stamps = { createdAt: now, updatedAt: now };
  await Promise.all([
    db.doc(`workspaces/${WORKSPACE}`).set({
      ownerId: UID, name: 'Patrimônio Simples', type: 'PF', ...stamps,
    }),
    db.doc(`workspaces/${WORKSPACE}/members/${UID}`).set({
      uid: UID, role: 'owner', status: 'active',
    }),
    db.doc(`users/${UID}/workspaces/${WORKSPACE}`).set({
      workspaceId: WORKSPACE, role: 'owner',
    }),
    db.doc(`workspaces/${WORKSPACE}/settings_catalog/${CARTEIRA}`).set({
      ...catalogo(CARTEIRA, 'investment_class', 'Reserva de emergência', 'reserva de emergencia', 1),
      ...stamps,
    }),
    db.doc(`workspaces/${WORKSPACE}/settings_catalog/${INSTITUICAO}`).set({
      ...catalogo(INSTITUICAO, 'investment_institution', 'BTG', 'btg', 1),
      ...stamps,
    }),
    db.doc(`workspaces/${WORKSPACE}/settings_catalog/${CATEGORIA}`).set({
      ...catalogo(CATEGORIA, 'category', 'Renda fixa', 'renda fixa', 1, 'investimento'),
      ...stamps,
    }),
  ]);
});

const abrirPainel = async (page: Page) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
};

const abrirInvestimentos = async (page: Page) => {
  await abrirPainel(page);
  await page.getByText('Investimentos', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Investimentos' })).toBeVisible();
};

const movimentos = async () => {
  const snapshot = await sdk().firestore()
    .collection(`workspaces/${WORKSPACE}/investment_movements`).get();
  return snapshot.docs.map((entry) => entry.data());
};

const preencherNovoInvestimento = async (
  page: Page,
  { descricao, valor, depositado }: { descricao: string; valor: string; depositado: boolean },
) => {
  await page.getByRole('button', { name: 'Novo investimento' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await dialogo.getByLabel('Carteira de investimento').selectOption({ label: 'Reserva de emergência' });
  await dialogo.getByLabel('Instituição').selectOption({ label: 'BTG' });
  await dialogo.getByLabel('Descrição').fill(descricao);
  await dialogo.getByLabel('Categoria').selectOption({ label: 'Renda fixa' });
  await dialogo.getByLabel('Valor do investimento').fill(valor);
  await dialogo.getByRole('radio', { name: depositado ? 'Sim' : 'Não' }).check();
  await dialogo.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialogo).toHaveCount(0);
};

test('o formulário simples pede exatamente os campos do fluxo comum', async ({ page }) => {
  await abrirInvestimentos(page);
  await page.getByRole('button', { name: 'Novo investimento' }).click();
  const dialogo = page.getByRole('dialog');

  // Ordem e rótulos do §4, em pt-BR e sem termo técnico.
  await expect(dialogo.getByLabel('Meta (opcional)')).toBeVisible();
  await expect(dialogo.getByLabel('Carteira de investimento')).toBeVisible();
  await expect(dialogo.getByLabel('Instituição')).toBeVisible();
  await expect(dialogo.getByLabel('Descrição')).toBeVisible();
  await expect(dialogo.getByLabel('Categoria')).toBeVisible();
  await expect(dialogo.getByLabel('Valor do investimento')).toBeVisible();
  await expect(dialogo.getByText('Esse valor já foi depositado?')).toBeVisible();

  // As opções vêm dos grupos certos do catálogo.
  await expect(dialogo.getByLabel('Carteira de investimento')).toContainText('Reserva de emergência');
  await expect(dialogo.getByLabel('Instituição')).toContainText('BTG');
  await expect(dialogo.getByLabel('Categoria')).toContainText('Renda fixa');

  // Meta é opcional e começa sem meta.
  await expect(dialogo.getByLabel('Meta (opcional)')).toHaveValue('');

  // Nada de quantidade, preço unitário ou regime de acompanhamento.
  for (const termo of ['Quantidade', 'Preço unitário', 'Preço médio', 'Tipo de ativo']) {
    await expect(dialogo.getByText(termo, { exact: true })).toHaveCount(0);
  }
});

test('pendente aparece na lista, é confirmado e vira depositado', async ({ page }) => {
  await abrirInvestimentos(page);

  await preencherNovoInvestimento(page, {
    descricao: 'CDB do teste', valor: '150000', depositado: false,
  });

  // Aparece mesmo sem posição: a lista é do ledger, não das posições.
  const linha = page.getByRole('row').filter({ hasText: 'CDB do teste' });
  await expect(linha).toBeVisible();
  await expect(linha.getByText('Pendente', { exact: true })).toBeVisible();
  await expect(linha.getByText('Aporte', { exact: true })).toBeVisible();
  await expect.poll(async () => (await movimentos()).length).toBe(1);
  expect((await movimentos())[0].status).toBe('pending');
  expect((await movimentos())[0].cashDeltaCents).toBe(0);
  expect((await sdk().firestore()
    .collection(`workspaces/${WORKSPACE}/investment_positions`).get()).size).toBe(0);

  await linha.getByRole('button', { name: /Confirmar depósito/ }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole('button', { name: 'Confirmar depósito' }).click();
  await expect(dialogo).toHaveCount(0);

  await expect(linha.getByText('Depositado', { exact: true })).toBeVisible();
  // Uma contribuição só: liquidar não cria um segundo fato financeiro.
  await expect.poll(async () => (await movimentos()).length).toBe(1);
  expect((await movimentos())[0].status).toBe('settled');
  await expect.poll(async () => (await sdk().firestore()
    .collection(`workspaces/${WORKSPACE}/investment_positions`).get()).size).toBe(1);
});

test('investimento depositado é retirado e o recebimento é confirmado', async ({ page }) => {
  await abrirInvestimentos(page);

  await preencherNovoInvestimento(page, {
    descricao: 'Tesouro Selic', valor: '200000', depositado: true,
  });
  const aporte = page.getByRole('row').filter({ hasText: 'Tesouro Selic' });
  await expect(aporte.getByText('Depositado', { exact: true })).toBeVisible();

  // Retirada pendente: o dinheiro ainda não chegou.
  await aporte.getByRole('button', { name: /Retirar investimento/ }).click();
  const retirada = page.getByRole('dialog');
  await expect(retirada).toBeVisible();
  await expect(retirada.getByText('Tesouro Selic')).toBeVisible();
  await retirada.getByLabel('Valor da retirada').fill('50000');
  await retirada.getByRole('radio', { name: 'Não' }).check();
  // O rendimento é opcional e mora atrás de "Mais detalhes".
  await expect(retirada.getByText('Mais detalhes')).toBeVisible();
  await expect(retirada.getByLabel('Rendimento incluído na retirada')).toBeHidden();
  await retirada.getByRole('button', { name: 'Confirmar retirada' }).click();
  await expect(retirada).toHaveCount(0);

  const linhaRetirada = page.getByRole('row').filter({ hasText: 'Retirada' });
  await expect(linhaRetirada.getByText('Aguardando recebimento', { exact: true })).toBeVisible();
  await expect.poll(async () => (await movimentos())
    .filter((movimento) => movimento.operation === 'redemption').length).toBe(1);
  expect((await movimentos()).find((m) => m.operation === 'redemption')?.status).toBe('pending');

  await linhaRetirada.getByRole('button', { name: /Confirmar recebimento/ }).click();
  const confirmacao = page.getByRole('dialog');
  await expect(confirmacao).toBeVisible();
  // Nada de perguntar de novo valor, rendimento, carteira ou categoria.
  await expect(confirmacao.getByLabel('Valor da retirada')).toHaveCount(0);
  await expect(confirmacao.getByLabel('Rendimento incluído na retirada')).toHaveCount(0);
  await confirmacao.getByRole('button', { name: 'Confirmar recebimento' }).click();
  await expect(confirmacao).toHaveCount(0);

  await expect(linhaRetirada.getByText('Recebido', { exact: true })).toBeVisible();
  await expect.poll(async () => (await movimentos())
    .find((movimento) => movimento.operation === 'redemption')?.status).toBe('settled');
  // O capital aplicado caiu de R$ 2.000,00 para R$ 1.500,00.
  await expect.poll(async () => {
    const posicoes = await sdk().firestore()
      .collection(`workspaces/${WORKSPACE}/investment_positions`).get();
    return posicoes.docs[0]?.get('principalCents');
  }).toBe(150_000);
});

test('cancelar um pendente preserva o histórico e não vira investimento ativo', async ({ page }) => {
  await abrirInvestimentos(page);
  await preencherNovoInvestimento(page, {
    descricao: 'CDB a cancelar', valor: '80000', depositado: false,
  });

  const linha = page.getByRole('row').filter({ hasText: 'CDB a cancelar' });
  await linha.getByRole('button', { name: /Cancelar lançamento/ }).click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByRole('button', { name: 'Cancelar lançamento' }).click();
  await expect(dialogo).toHaveCount(0);

  await expect(linha.getByText('Cancelado', { exact: true })).toBeVisible();
  // Nada foi apagado, e nada virou posição.
  await expect.poll(async () => (await movimentos()).length).toBe(1);
  expect((await movimentos())[0].status).toBe('cancelled');
  expect((await sdk().firestore()
    .collection(`workspaces/${WORKSPACE}/investment_positions`).get()).size).toBe(0);
  // E o lançamento cancelado não oferece mais ação nenhuma.
  await expect(linha.getByRole('button', { name: /Confirmar depósito/ })).toHaveCount(0);
});

test('editar um pendente cancela a intenção anterior e abre outra', async ({ page }) => {
  await abrirInvestimentos(page);
  await preencherNovoInvestimento(page, {
    descricao: 'CDB com valor errado', valor: '10000', depositado: false,
  });

  const linha = page.getByRole('row').filter({ hasText: 'CDB com valor errado' });
  await linha.getByRole('button', { name: /Editar/ }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  // O formulário reabre com a intenção original, não em branco.
  await expect(dialogo.getByLabel('Descrição')).toHaveValue('CDB com valor errado');
  await expect(dialogo.getByLabel('Valor do investimento')).toHaveValue('100,00');
  await expect(dialogo.getByLabel('Carteira de investimento')).toHaveValue(CARTEIRA);
  await expect(dialogo.getByLabel('Instituição')).toHaveValue(INSTITUICAO);
  await expect(dialogo.getByLabel('Categoria')).toHaveValue(CATEGORIA);

  await dialogo.getByLabel('Descrição').fill('CDB corrigido');
  await dialogo.getByLabel('Valor do investimento').fill('250000');
  await dialogo.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialogo).toHaveCount(0);

  // O histórico guarda os dois: o cancelado e o novo. Nada foi apagado.
  await expect(page.getByRole('row').filter({ hasText: 'CDB corrigido' })
    .getByText('Pendente', { exact: true })).toBeVisible();
  await expect(linha.getByText('Cancelado', { exact: true })).toBeVisible();
  await expect.poll(async () => (await movimentos()).length).toBe(2);
  const estados = (await movimentos()).map((movimento) => movimento.status).sort();
  expect(estados).toEqual(['cancelled', 'pending']);
});

test('owner desfaz um lançamento depositado sem hard delete', async ({ page }) => {
  await abrirInvestimentos(page);
  await preencherNovoInvestimento(page, {
    descricao: 'CDB para desfazer', valor: '120000', depositado: true,
  });

  const linha = page.getByRole('row').filter({ hasText: 'CDB para desfazer' });
  await expect(linha.getByText('Depositado', { exact: true })).toBeVisible();

  await linha.getByRole('button', { name: /Desfazer lançamento/ }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  // A palavra técnica do domínio nunca aparece para o usuário.
  await expect(dialogo.getByText(/estorno|reversal/i)).toHaveCount(0);
  await dialogo.getByRole('button', { name: 'Desfazer lançamento' }).click();
  await expect(dialogo).toHaveCount(0);

  await expect(linha.getByText('Desfeito', { exact: true })).toBeVisible();
  // O lançamento original continua gravado; o estorno é um movimento à parte.
  await expect.poll(async () => (await movimentos()).length).toBe(2);
  const original = (await movimentos()).find((movimento) => movimento.operation === 'contribution');
  expect(original?.status).toBe('settled');
  expect(typeof original?.reversedByMovementId).toBe('string');
  // E o movimento de estorno não vira uma linha própria na tela.
  await expect(page.getByRole('row').filter({ hasText: 'CDB para desfazer' })).toHaveCount(1);
});

test('a tela responde em viewport de celular', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await abrirInvestimentos(page);
  await expect(page.getByRole('button', { name: 'Novo investimento' })).toBeVisible();
  await expect(page.getByLabel('Busca rápida')).toBeVisible();
  // A tabela rola dentro do próprio contêiner; a página não estoura na horizontal.
  const estouro = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(estouro).toBeLessThanOrEqual(1);
});


/*
 * O aporte lançado pelo botão global do painel (§17).
 *
 * "Nova Transação" é onde a pessoa procura lançar qualquer coisa, e a aba de
 * investimento devolve o mesmo formulário simples da tela de Investimentos. O
 * teste confere o **ledger**: o destino continua sendo `createSimpleInvestment`,
 * e nenhuma transação é escrita pelo cliente.
 */
test('"Nova Transação" registra o aporte pelo ledger simples, e não por transações', async ({ page }) => {
  await abrirPainel(page);

  await page.getByRole('button', { name: 'Nova Transação' }).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole('button', { name: 'Investimento', exact: true }).click();

  // Os catálogos são os mesmos três grupos do formulário da tela específica.
  await dialogo.getByLabel('Carteira de investimento').selectOption({ label: 'Reserva de emergência' });
  await dialogo.getByLabel('Instituição').selectOption({ label: 'BTG' });
  await dialogo.getByLabel('Descrição').fill('CDB pelo painel');
  await dialogo.getByLabel('Categoria').selectOption({ label: 'Renda fixa' });
  await dialogo.getByLabel('Valor do investimento').fill('120000');
  await dialogo.getByRole('radio', { name: 'Não' }).check();
  await dialogo.getByRole('button', { name: 'Salvar' }).click();

  // A modal principal fecha e o aviso é o da própria aplicação.
  await expect(dialogo).toHaveCount(0);
  await expect(page.getByText('Investimento registrado como pendente.')).toBeVisible();

  // Um movimento no ledger, pendente, sem posição e sem tocar o caixa.
  await expect.poll(async () => (await movimentos()).length).toBe(1);
  const movimento = (await movimentos())[0];
  expect(movimento.description).toBe('CDB pelo painel');
  expect(movimento.operation).toBe('contribution');
  expect(movimento.status).toBe('pending');
  expect(movimento.cashDeltaCents).toBe(0);
  expect((await sdk().firestore()
    .collection(`workspaces/${WORKSPACE}/investment_positions`).get()).size).toBe(0);

  // E o mesmo lançamento aparece na tela de Investimentos: um domínio só.
  await page.getByText('Investimentos', { exact: true }).first().click();
  await expect(page.getByRole('row').filter({ hasText: 'CDB pelo painel' })).toBeVisible();
});


/*
 * Fonte única da categoria de investimento.
 *
 * Havia dois cadastros de categoria de investimento na experiência comum,
 * ambos semeados no primeiro acesso do workspace, e só um deles chegava a
 * algum formulário. O que este teste percorre em runtime é o resultado da
 * unificação: a pessoa cadastra a categoria uma vez, no mesmo lugar em que
 * cadastra as de receita e despesa, e ela aparece nos **dois** pontos de
 * entrada de investimento — sem que a de receita vaze para nenhum deles.
 */

const CATEGORIA_SMOKE = 'SMOKE Categoria Investimento';
const CATEGORIA_RECEITA_SMOKE = 'SMOKE Categoria Receita';

const abrirCadastros = async (page: Page) => {
  await page.getByText('Configurações', { exact: true }).first().click();
  await page.getByRole('heading', { name: 'Cadastros', exact: true }).click();
};

const criarCategoria = async (page: Page, aba: string, nome: string) => {
  const painel = page.getByRole('main');
  await painel.getByText('Categorias', { exact: true }).first().click();
  await painel.getByRole('button', { name: aba, exact: true }).click();
  await painel.getByRole('button', { name: 'Novo cadastro' }).first().click();

  /*
   * A modal de Cadastros é um portal sem `role="dialog"`; o campo e o botão
   * de confirmação só existem nela, então o escopo da página já é preciso.
   */
  const nomeDoCadastro = page.getByPlaceholder(
    'Ex.: Cartão corporativo, Fornecedor A, Alimentação...',
  );
  await expect(nomeDoCadastro).toBeVisible();
  await nomeDoCadastro.fill(nome);
  await page.getByRole('button', { name: 'Criar cadastro' }).click();
  await expect(page.getByRole('button', { name: 'Criar cadastro' })).toHaveCount(0);
  await expect(painel.getByText(nome, { exact: true }).first()).toBeVisible();
};

/** Confere as opções do seletor de categoria do formulário simples. */
const conferirCategorias = async (dialogo: ReturnType<Page['getByRole']>) => {
  const categoria = dialogo.getByLabel('Categoria');
  await expect(
    categoria.getByRole('option', { name: CATEGORIA_SMOKE }),
  ).toHaveCount(1);
  // A categoria de receita existe no mesmo grupo `category` e não é oferecida
  // aqui: o recorte é por subtipo, não por grupo.
  await expect(
    categoria.getByRole('option', { name: CATEGORIA_RECEITA_SMOKE }),
  ).toHaveCount(0);
};

test('a categoria cadastrada uma vez alimenta os dois pontos de entrada', async ({ page }) => {
  /*
   * Uma jornada só, de propósito: o ponto do teste é que a **mesma** categoria
   * criada uma vez aparece nos dois formulários, e verificar isso em testes
   * separados exigiria criá-la duas vezes — o que deixaria de provar o que
   * importa. A jornada passa por Configurações, cria dois cadastros e abre
   * dois formulários, e por isso pede mais que o teto padrão de 45 segundos.
   */
  test.setTimeout(120_000);
  await abrirPainel(page);
  await abrirCadastros(page);

  const painel = page.getByRole('main');

  // Cenário 4 — a experiência comum tem só os cadastros decididos.
  for (const titulo of [
    'Categorias', 'Carteiras', 'Carteiras de investimento', 'Instituições',
  ]) {
    await expect(painel.getByText(titulo, { exact: true }).first()).toBeVisible();
  }
  for (const titulo of [
    'Categorias de investimento', 'Risco', 'Liquidez', 'Indexadores',
    'Estratégias',
  ]) {
    await expect(painel.getByText(titulo, { exact: true })).toHaveCount(0);
  }

  // Cenário 1 — a categoria nasce em Categorias › Investimentos...
  await criarCategoria(page, 'Investimentos', CATEGORIA_SMOKE);
  // ...e uma categoria de receita é criada para provar que ela não vaza.
  await criarCategoria(page, 'Receitas', CATEGORIA_RECEITA_SMOKE);

  /*
   * Sair de Cadastros antes de navegar.
   *
   * Dentro de Configurações existe uma aba "Investimentos" — a do subtipo de
   * categoria —, e ela é o primeiro texto exato com esse nome na página. A
   * navegação do menu lateral só fica inequívoca depois de deixar a tela.
   */
  await page.getByText('Dashboard', { exact: true }).first().click();
  await expect(page.getByText('Saldo Atual')).toBeVisible();

  // Cenário 2 e 3 — a aba Investimento de "Nova Transação".
  await page.getByRole('button', { name: 'Nova Transação' }).click();
  const modalTransacao = page.getByRole('dialog');
  await expect(modalTransacao).toBeVisible();
  await modalTransacao.getByRole('button', { name: 'Investimento', exact: true }).click();
  await conferirCategorias(modalTransacao);

  /*
   * E a categoria de receita continua servindo à aba de Receita, intacta.
   *
   * O seletor da aba comum não tem `label`/`for` — é a marcação do baseline,
   * que esta etapa não toca —, então a opção é buscada pelo papel dentro da
   * própria modal, onde ela só existe no seletor de categoria.
   */
  await modalTransacao.getByRole('button', { name: 'Receita', exact: true }).click();
  await expect(
    modalTransacao.getByRole('option', { name: CATEGORIA_RECEITA_SMOKE }),
  ).toHaveCount(1);
  await modalTransacao.getByRole('button', { name: 'Fechar' }).first().click();
  await expect(modalTransacao).toHaveCount(0);

  /*
   * Cenário 1 e 3 — o formulário específico de Investimentos, mesma fonte.
   *
   * A navegação é pelo menu lateral, e não por `abrirInvestimentos`: aquele
   * ajudante recarrega a página e refaz o login, e a sessão desta jornada já
   * está aberta.
   */
  await page.getByText('Investimentos', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Investimentos' })).toBeVisible();
  await page.getByRole('button', { name: 'Novo investimento' }).click();
  const modalInvestimento = page.getByRole('dialog');
  await expect(modalInvestimento).toBeVisible();
  await conferirCategorias(modalInvestimento);
  // O rótulo da carteira patrimonial não se confunde com carteira de caixa, e
  // nenhum campo de caixa foi acrescentado ao formulário.
  await expect(modalInvestimento.getByLabel('Carteira de investimento')).toBeVisible();
  await expect(
    modalInvestimento.getByText(/carteira de caixa|conta de origem/i),
  ).toHaveCount(0);
});
