import {expect, test} from '@playwright/test';
import {callCallable, emulatorIdToken} from './support/callables';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');
const PROJECT = 'minhas-financas-local';
const UID = 'e2e-investment-onboarding-owner';
const EMAIL = 'e2e-investment-onboarding@minhas-financas.local';
const PASSWORD = 'e2e-investment-onboarding-password';
const WORKSPACE = 'e2e-investment-onboarding-workspace';

const sdk = () => {
  process.env.GCLOUD_PROJECT = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin;
};

test.beforeEach(async () => {
  const firebaseAdmin = sdk();
  const db = firebaseAdmin.firestore();
  await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE}`));
  try {
    await firebaseAdmin.auth().deleteUser(UID);
  } catch (error) {
    if ((error as {code?: string}).code !== 'auth/user-not-found') throw error;
  }
  await firebaseAdmin.auth().createUser({uid: UID, email: EMAIL, password: PASSWORD, emailVerified: true});
  const now = firebaseAdmin.firestore.Timestamp.now();
  await Promise.all([
    // INV-P2-025 — o cadastro patrimonial só existe com o domínio ligado.
    db.doc(`workspaces/${WORKSPACE}`).set({
      ownerId: UID, name: 'Patrimônio PF', type: 'PF',
      createdAt: now, updatedAt: now,
    }),
    db.doc(`workspaces/${WORKSPACE}/members/${UID}`).set({uid: UID, role: 'owner', status: 'active'}),
    db.doc(`users/${UID}/workspaces/${WORKSPACE}`).set({workspaceId: WORKSPACE, role: 'owner'}),
    db.doc(`workspaces/${WORKSPACE}/investment_accounts/archived-account`).set({
      id: 'archived-account', workspaceId: WORKSPACE, profileType: 'PF', name: 'Conta encerrada',
      institutionName: 'Banco antigo', currency: 'BRL', status: 'archived', createdBy: UID,
      updatedBy: UID, createdAt: now, updatedAt: now,
    }),
  ]);
});

/**
 * Cadastro patrimonial, depois de sair da configuração comum (Etapa 3, §0.B).
 *
 * Semear padrões, criar conta e criar ativo eram roteiros de tela em
 * Configurações › Cadastros. A administração técnica deixou de ser montada
 * ali, e os roteiros de clique deixaram de descrever um caminho executável.
 *
 * As operações não perderam valor nem cobertura: elas continuam verificadas
 * com o runtime das Functions no meio, pela mesma chamada HTTP que o SDK do
 * navegador faz — e a interface passa a ser verificada pelo que ela precisa
 * garantir agora, que é a ausência daquele vocabulário na tela comum.
 */
test('preparar padrões PF não duplica cadastro existente', async ({request}) => {
  const db = sdk().firestore();
  const token = await emulatorIdToken(request, EMAIL, PASSWORD);

  const primeira = await callCallable(request, token, 'onboardInvestmentWorkspace', {
    workspaceId: WORKSPACE,
    idempotencyKey: 'e2e-onboarding-padroes-0001',
    correlationId: 'e2e-onboarding-padroes',
  });
  expect(primeira.status, primeira.errorMessage ?? '').toBe(200);

  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_accounts`)
      .where('status', '==', 'active').get()
  ).size, {timeout: 20_000}).toBe(1);
  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_assets`)
      .where('status', '==', 'active').get()
  ).size, {timeout: 20_000}).toBe(1);

  // A conta arquivada semeada continua no lugar: preparar padrões não apaga
  // histórico, e a conta nova não vira uma segunda conta ativa.
  expect((await db.collection(`workspaces/${WORKSPACE}/investment_accounts`).get()).size).toBe(2);

  // Repetir com outra chave não duplica: o preparo é convergente.
  const segunda = await callCallable(request, token, 'onboardInvestmentWorkspace', {
    workspaceId: WORKSPACE,
    idempotencyKey: 'e2e-onboarding-padroes-0002',
    correlationId: 'e2e-onboarding-padroes-repeticao',
  });
  expect(segunda.status, segunda.errorMessage ?? '').toBe(200);
  expect((await db.collection(`workspaces/${WORKSPACE}/investment_accounts`)
    .where('status', '==', 'active').get()).size).toBe(1);
  expect((await db.collection(`workspaces/${WORKSPACE}/investment_assets`)
    .where('status', '==', 'active').get()).size).toBe(1);
});

test('conta e ativo são criados, editados e inativados sem hard delete', async ({request}) => {
  const db = sdk().firestore();
  const token = await emulatorIdToken(request, EMAIL, PASSWORD);
  const conta = 'e2e-onboarding-conta';
  const ativo = 'e2e-onboarding-ativo';

  const criarConta = await callCallable(request, token, 'saveInvestmentAccount', {
    workspaceId: WORKSPACE,
    idempotencyKey: 'e2e-onboarding-conta-0001',
    correlationId: 'e2e-onboarding-conta-criar',
    accountId: conta,
    name: 'Conta Cadastros E2E',
    institutionName: 'Corretora Cadastros',
  });
  expect(criarConta.status, criarConta.errorMessage ?? '').toBe(200);
  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_accounts`)
      .where('name', '==', 'Conta Cadastros E2E').get()
  ).size, {timeout: 20_000}).toBe(1);

  // Editar a mesma conta atualiza o registro, não cria um segundo.
  const editar = await callCallable(request, token, 'saveInvestmentAccount', {
    workspaceId: WORKSPACE,
    idempotencyKey: 'e2e-onboarding-conta-0002',
    correlationId: 'e2e-onboarding-conta-editar',
    accountId: conta,
    name: 'Conta Cadastros E2E',
    institutionName: 'Corretora Renomeada',
  });
  expect(editar.status, editar.errorMessage ?? '').toBe(200);
  expect((await db.collection(`workspaces/${WORKSPACE}/investment_accounts`)
    .where('name', '==', 'Conta Cadastros E2E').get()).size).toBe(1);

  // Inativar preserva o documento: `archived`, nunca exclusão.
  const inativar = await callCallable(request, token, 'archiveInvestmentAccount', {
    workspaceId: WORKSPACE,
    idempotencyKey: 'e2e-onboarding-conta-0003',
    correlationId: 'e2e-onboarding-conta-inativar',
    accountId: conta,
    reason: 'Conta encerrada pelo teste de ponta a ponta.',
  });
  expect(inativar.status, inativar.errorMessage ?? '').toBe(200);
  const arquivada = await db.doc(`workspaces/${WORKSPACE}/investment_accounts/${conta}`).get();
  expect(arquivada.exists).toBe(true);
  expect(arquivada.data()?.status).toBe('archived');
  expect(arquivada.data()?.institutionName).toBe('Corretora Renomeada');

  // Ativo usa o mesmo cadastro, com finalidade explícita.
  const criarAtivo = await callCallable(request, token, 'saveInvestmentAsset', {
    workspaceId: WORKSPACE,
    idempotencyKey: 'e2e-onboarding-ativo-0001',
    correlationId: 'e2e-onboarding-ativo-criar',
    assetId: ativo,
    name: 'Tesouro Cadastros E2E',
    symbol: 'TESOURO',
    assetType: 'fixed_income',
    allocationPurpose: 'retirement',
  });
  expect(criarAtivo.status, criarAtivo.errorMessage ?? '').toBe(200);
  await expect.poll(async () => (
    await db.doc(`workspaces/${WORKSPACE}/investment_assets/${ativo}`).get()
  ).data()?.allocationPurpose, {timeout: 20_000}).toBe('retirement');
});

/*
 * A experiência comum de Cadastros, depois da Etapa 3.
 *
 * Antes o cadastro patrimonial dividia a tela com o catálogo do produto; a
 * Etapa 2 o recolheu atrás de um `<details>`; a Etapa 3 tirou o ponto de
 * montagem. O que precisa aparecer ali são os cadastros que o usuário comum
 * usa — carteira, instituição e categoria de investimento —, e é isso que este
 * teste passa a garantir.
 */
test('Cadastros mostra os cadastros de investimento do usuário comum', async ({page}) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({timeout: 30_000});

  await page.getByText('Configurações', {exact: true}).first().click();
  await page.getByRole('heading', {name: 'Cadastros', exact: true}).click();

  await expect(page.getByText('Produtos e Serviços')).toBeVisible();
  for (const grupo of [
    'Carteiras de investimento', 'Instituições', 'Categorias de investimento',
  ]) {
    await expect(page.getByText(grupo).first()).toBeVisible();
  }

  // E nada da administração técnica (§0.B).
  await expect(page.getByRole('heading', {name: 'Cadastros patrimoniais'})).toHaveCount(0);
  await expect(page.getByRole('heading', {name: 'Operação do domínio patrimonial'})).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Preparar padrões de investimentos'})).toHaveCount(0);
});
