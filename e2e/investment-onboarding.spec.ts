import {expect, test} from '@playwright/test';
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
    db.doc(`workspaces/${WORKSPACE}`).set({ownerId: UID, name: 'Patrimônio PF', type: 'PF', createdAt: now, updatedAt: now}),
    db.doc(`workspaces/${WORKSPACE}/members/${UID}`).set({uid: UID, role: 'owner', status: 'active'}),
    db.doc(`users/${UID}/workspaces/${WORKSPACE}`).set({workspaceId: WORKSPACE, role: 'owner'}),
    db.doc(`workspaces/${WORKSPACE}/investment_accounts/archived-account`).set({
      id: 'archived-account', workspaceId: WORKSPACE, profileType: 'PF', name: 'Conta encerrada',
      institutionName: 'Banco antigo', currency: 'BRL', status: 'archived', createdBy: UID,
      updatedBy: UID, createdAt: now, updatedAt: now,
    }),
  ]);
});

test('owner prepara defaults PF sem duplicar e preserva a tela atual de Cadastros', async ({page}) => {
  const db = sdk().firestore();
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({timeout: 30_000});

  await page.getByText('Configurações', {exact: true}).first().click();
  await page.getByRole('heading', {name: 'Cadastros', exact: true}).click();
  await expect(page.getByRole('heading', {name: 'Cadastros patrimoniais'})).toBeVisible();
  await expect(page.getByText(/Carteiras de caixa continuam nos cadastros gerais/)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Preparar padrões de investimentos'})).toBeVisible();
  await expect(page.getByText('Produtos e Serviços')).toBeVisible();

  await page.getByRole('button', {name: 'Preparar padrões de investimentos'}).click();
  await expect(page.getByText(/preparados com sucesso, sem duplicar/)).toBeVisible();
  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_accounts`).where('status', '==', 'active').get()
  ).size).toBe(1);
  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_assets`).where('status', '==', 'active').get()
  ).size).toBe(1);
  expect((await db.collection(`workspaces/${WORKSPACE}/investment_accounts`).get()).size).toBe(2);
  expect((await db.collection(`workspaces/${WORKSPACE}/investment_assets`).get()).size).toBe(1);
});

test('Cadastros gerencia conta e ativo de investimento sem tocar carteiras de caixa', async ({page}) => {
  const db = sdk().firestore();
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({timeout: 30_000});
  await page.getByText('Configurações', {exact: true}).first().click();
  await page.getByRole('heading', {name: 'Cadastros', exact: true}).click();

  const registry = page.locator('section[aria-labelledby="investment-registry-title"]');
  await expect(registry).toBeVisible();
  // Carteira e conta de investimento permanecem conceitos distintos.
  await expect(registry.getByText(/separados das carteiras de caixa/)).toBeVisible();
  // Cadastros legados continuam na tela.
  await expect(page.getByText('Produtos e Serviços')).toBeVisible();

  // Cria conta a partir de Cadastros, exclusivamente via callable.
  await registry.getByRole('button', {name: 'Nova conta'}).click();
  await page.getByLabel('Nome da conta').fill('Conta Cadastros E2E');
  await page.getByLabel('Instituição').fill('Corretora Cadastros');
  await page.getByRole('button', {name: 'Salvar conta'}).click();
  await expect(registry.getByText('Cadastro patrimonial atualizado com sucesso.')).toBeVisible();
  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_accounts`)
      .where('name', '==', 'Conta Cadastros E2E').get()
  ).size).toBe(1);
  await expect(registry.getByText('Conta Cadastros E2E')).toBeVisible();

  // Edita a mesma conta: o registro é atualizado, não duplicado.
  await registry.locator('li').filter({hasText: 'Conta Cadastros E2E'})
    .getByRole('button', {name: 'Editar'}).click();
  await page.getByLabel('Instituição').fill('Corretora Renomeada');
  await page.getByRole('button', {name: 'Salvar conta'}).click();
  await expect(registry.getByText('Corretora Renomeada')).toBeVisible();
  expect((await db.collection(`workspaces/${WORKSPACE}/investment_accounts`)
    .where('name', '==', 'Conta Cadastros E2E').get()).size).toBe(1);

  // Inativa preservando histórico: some de Ativas e aparece em Inativas.
  await registry.locator('li').filter({hasText: 'Conta Cadastros E2E'})
    .getByRole('button', {name: 'Inativar'}).click();
  await expect(page.getByRole('heading', {name: 'Inativar conta de investimento'})).toBeVisible();
  await page.getByRole('button', {name: 'Confirmar inativação'}).click();
  // Fonte da verdade: a inativação precisa ter chegado ao Firestore.
  await expect.poll(async () => {
    const snapshot = await db.collection(`workspaces/${WORKSPACE}/investment_accounts`)
      .where('name', '==', 'Conta Cadastros E2E').get();
    return snapshot.docs[0]?.data().status ?? '';
  }, {timeout: 25_000}).toBe('archived');
  await expect(registry.getByText('Conta Cadastros E2E')).toHaveCount(0);
  await registry.getByLabel('Situação do cadastro patrimonial').selectOption('archived');
  await expect(registry.getByText('Conta Cadastros E2E')).toBeVisible();
  await expect(registry.getByText('Conta encerrada')).toBeVisible();
  const archived = await db.collection(`workspaces/${WORKSPACE}/investment_accounts`)
    .where('name', '==', 'Conta Cadastros E2E').get();
  expect(archived.docs[0].data().status).toBe('archived');
  expect(archived.docs[0].data().institutionName).toBe('Corretora Renomeada');

  // Ativos usam o mesmo cadastro, com finalidade PF.
  await registry.getByRole('tab', {name: 'Ativos'}).click();
  await registry.getByLabel('Situação do cadastro patrimonial').selectOption('active');
  await registry.getByRole('button', {name: 'Novo ativo'}).click();
  await page.getByLabel('Nome do ativo').fill('Tesouro Cadastros E2E');
  await page.getByLabel('Finalidade').selectOption('retirement');
  await page.getByRole('button', {name: 'Salvar ativo'}).click();
  await expect.poll(async () => {
    const snapshot = await db.collection(`workspaces/${WORKSPACE}/investment_assets`)
      .where('name', '==', 'Tesouro Cadastros E2E').get();
    return snapshot.docs[0]?.data().allocationPurpose ?? '';
  }, {timeout: 20_000}).toBe('retirement');
  await expect(registry.getByText('Tesouro Cadastros E2E')).toBeVisible();
});
