import {expect, test} from '@playwright/test';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');

const PROJECT_ID = 'minhas-financas-local';
const PASSWORD = 'e2e-password-123456';
const OWNER_UID = 'e2e-owner-goal-m1';
const OWNER_EMAIL = 'e2e-owner-goal-m1@minhas-financas.local';
const WORKSPACE_ID = 'workspace-e2e-goal-m1';
const GOAL_ID = 'goal-firestore-string-id';

const getAdmin = () => {
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT_ID});
  return admin;
};

const seed = async () => {
  const firebaseAdmin = getAdmin();
  const db = firebaseAdmin.firestore();
  const workspaceRef = db.doc(`workspaces/${WORKSPACE_ID}`);
  await db.recursiveDelete(workspaceRef);
  try {
    await firebaseAdmin.auth().deleteUser(OWNER_UID);
  } catch (error) {
    if ((error as {code?: string}).code !== 'auth/user-not-found') throw error;
  }
  await firebaseAdmin.auth().createUser({
    uid: OWNER_UID,
    email: OWNER_EMAIL,
    password: PASSWORD,
    emailVerified: true,
  });
  const now = admin.firestore.FieldValue.serverTimestamp();
  await workspaceRef.set({
    ownerId: OWNER_UID,
    userId: OWNER_UID,
    name: 'Workspace Meta M1',
    type: 'PF',
    themeColor: '#4f46e5',
    createdAt: now,
    updatedAt: now,
  });
  await Promise.all([
    db.doc(`workspaces/${WORKSPACE_ID}/members/${OWNER_UID}`).set({
      uid: OWNER_UID,
      email: OWNER_EMAIL,
      role: 'owner',
      status: 'active',
      joinedAt: now,
    }),
    db.doc(`users/${OWNER_UID}/workspaces/${WORKSPACE_ID}`).set({
      workspaceId: WORKSPACE_ID,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    }),
    db.doc(`workspaces/${WORKSPACE_ID}/goals/${GOAL_ID}`).set({
      workspaceId: WORKSPACE_ID,
      profileId: WORKSPACE_ID,
      name: 'Meta M1 E2E',
      description: 'Validação do aporte patrimonial',
      category: 'reserva_emergencia',
      status: 'em_andamento',
      priority: 'alta',
      targetAmount: 1000,
      targetAmountCents: 100000,
      currentAmount: 0,
      currentAmountCents: 0,
      progressBasis: 'net_contributions',
      startDate: '2026-01-01',
      deadline: '2027-01-01',
      horizon: 'curto',
      isAutomatic: false,
      visual: {color: '#6366f1', icon: 'Target', progressBarType: 'linear'},
      createdAt: now,
      updatedAt: now,
    }),
    // Conta e ativo ativos: aportar exige os dois, e é isso que o onboarding
    // prepara. Nenhuma transação de investimento é semeada — o caixa desse tipo
    // passa a existir só como espelho do ledger.
    db.doc(`workspaces/${WORKSPACE_ID}/investment_accounts/goal-e2e-account`).set({
      id: 'goal-e2e-account', workspaceId: WORKSPACE_ID, profileType: 'PF',
      name: 'Corretora Meta E2E', institutionName: 'Instituição E2E',
      currency: 'BRL', status: 'active',
      createdBy: OWNER_UID, updatedBy: OWNER_UID, createdAt: now, updatedAt: now,
    }),
    db.doc(`workspaces/${WORKSPACE_ID}/investment_assets/goal-e2e-asset`).set({
      id: 'goal-e2e-asset', workspaceId: WORKSPACE_ID, profileType: 'PF',
      name: 'CDB Meta E2E', symbol: 'CDB', assetType: 'fixed_income',
      allocationPurpose: 'retirement', currency: 'BRL', status: 'active',
      createdBy: OWNER_UID, updatedBy: OWNER_UID, createdAt: now, updatedAt: now,
    }),
  ]);
};

test.beforeEach(async () => {
  await seed();
});

/**
 * Financiar uma meta é criar um movimento patrimonial vinculado a ela.
 *
 * Não existe mais aporte em meta como lançamento de transação: o progresso da
 * meta vem de `investmentProgressCents`, publicado a partir das posições, e o
 * caixa aparece pelo espelho que o ledger projeta. Este teste prova o caminho
 * inteiro pela interface — aporte vinculado, progresso na meta, histórico na
 * meta e espelho de caixa único.
 */
test('aporte vinculado à meta publica progresso e projeta caixa uma vez', async ({page}) => {
  const db = getAdmin().firestore();
  await page.goto(`/?e2eEmail=${encodeURIComponent(OWNER_EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({timeout: 30_000});

  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE_ID}/settings_catalog`).where('group', '==', 'wallet').get()
  ).size).toBeGreaterThan(0);

  // Aporte pela tela patrimonial, já vinculado à meta.
  await page.getByText('Investimentos', {exact: true}).first().click();
  await expect(page.getByRole('heading', {name: 'Patrimônio e investimentos'})).toBeVisible();
  await page.getByRole('button', {name: 'Novo aporte'}).click();
  await page.getByRole('dialog').getByLabel('Conta').selectOption({label: 'Corretora Meta E2E'});
  await page.getByRole('dialog').getByLabel('Ativo').selectOption({label: 'CDB Meta E2E'});
  await page.getByRole('dialog').getByLabel('Meta (opcional)').selectOption(GOAL_ID);
  await page.getByLabel('Descrição').fill('Aporte vinculado E2E');
  await page.getByLabel('Valor principal (R$)').fill('150.25');
  await page.getByLabel('Quantidade').fill('1');
  await page.getByRole('button', {name: 'Confirmar aporte'}).click();
  await expect(page.getByText('Operação concluída com sucesso.')).toBeVisible();

  // O progresso publicado na meta é o do domínio patrimonial.
  await expect.poll(async () => (
    await db.doc(`workspaces/${WORKSPACE_ID}/goals/${GOAL_ID}`).get()
  ).data()?.investmentProgressCents, {timeout: 30_000}).toBe(15_025);

  // Um único espelho de caixa, com a saída do aporte.
  const espelhos = await db.collection(`workspaces/${WORKSPACE_ID}/transactions`)
    .where('investmentMetadata.investmentOperation', '==', 'contribution').get();
  expect(espelhos.size).toBe(1);
  expect(espelhos.docs[0].data().investmentMetadata.cashImpact).toBe('outflow');

  // A meta exibe o valor e o histórico traz o movimento, rotulado como aporte.
  await page.getByText('Metas', {exact: true}).first().click();
  await page.getByText('Meta M1 E2E', {exact: true}).first().click();
  await expect(page.getByText('Aporte vinculado E2E')).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Histórico da Meta'})).toBeVisible();

  // O vínculo retroativo por transação não existe mais.
  await expect(page.getByRole('button', {name: 'Vincular Existente'})).toHaveCount(0);
});
