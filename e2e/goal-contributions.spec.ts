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
      description: 'Validação do aporte legado',
      category: 'reserva_emergencia',
      status: 'em_andamento',
      priority: 'alta',
      targetAmount: 1000,
      targetAmountCents: 100000,
      currentAmount: 0,
      currentAmountCents: 0,
      netContributionCents: 0,
      progressBasis: 'net_contributions',
      startDate: '2026-01-01',
      deadline: '2027-01-01',
      horizon: 'curto',
      isAutomatic: false,
      visual: {color: '#6366f1', icon: 'Target', progressBarType: 'linear'},
      createdAt: now,
      updatedAt: now,
    }),
    db.doc(`workspaces/${WORKSPACE_ID}/transactions/retroactive-e2e-id`).set({
      type: 'investimento',
      description: 'Aporte retroativo E2E',
      category: 'CDB',
      value: 50,
      valueCents: 5000,
      date: '2026-07-01',
      isPaid: true,
      userId: OWNER_UID,
      workspaceId: WORKSPACE_ID,
      profileId: WORKSPACE_ID,
    }),
    db.doc(`workspaces/${WORKSPACE_ID}/transactions/pending-e2e-id`).set({
      type: 'investimento',
      description: 'Aporte pendente E2E',
      category: 'CDB',
      value: 900,
      valueCents: 90000,
      date: '2026-09-01',
      isPaid: false,
      userId: OWNER_UID,
      workspaceId: WORKSPACE_ID,
      profileId: WORKSPACE_ID,
    }),
  ]);
};

test.beforeEach(async () => {
  await seed();
});

test('vínculo retroativo, pending, aporte pré-vinculado, retry visual e seed idempotente', async ({page}) => {
  const db = getAdmin().firestore();
  await page.goto(`/?e2eEmail=${encodeURIComponent(OWNER_EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({timeout: 30_000});

  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE_ID}/settings_catalog`).where('group', '==', 'wallet').get()
  ).size).toBeGreaterThan(0);
  expect((await db.collection('workspaces').where('ownerId', '==', OWNER_UID).get()).size).toBe(1);

  await page.getByText('Metas', {exact: true}).first().click();
  await page.getByText('Meta M1 E2E', {exact: true}).first().click();
  await page.getByRole('button', {name: 'Vincular Existente'}).click();
  await page.getByText('Aporte retroativo E2E', {exact: true}).click();
  await page.getByText('Aporte pendente E2E', {exact: true}).click();
  await page.getByRole('button', {name: 'Salvar Alterações'}).click();

  await expect.poll(async () => (
    await db.doc(`workspaces/${WORKSPACE_ID}/goals/${GOAL_ID}`).get()
  ).data()?.currentAmount).toBe(50);

  await page.getByRole('button', {name: 'Novo Aporte'}).click();
  await expect(page.getByLabel('Vincular a uma Meta?')).toHaveValue(GOAL_ID);
  await page.getByLabel(/Selecione a Carteira/).selectOption({label: 'Carteira Principal'});
  await page.getByLabel(/Descrição/).fill('Aporte pré-vinculado E2E');
  await page.getByLabel(/Categoria/).selectOption({label: 'CDB'});
  await page.getByLabel(/Valor Investido/).fill('100.25');
  await page.getByLabel('Data do depósito').fill('2026-08-17');
  await page.getByRole('button', {name: 'Revisar e Adicionar Investimento'}).click();

  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE_ID}/transactions`)
      .where('description', '==', 'Aporte pré-vinculado E2E').get()
  ).size).toBe(1);
  await expect.poll(async () => (
    await db.doc(`workspaces/${WORKSPACE_ID}/goals/${GOAL_ID}`).get()
  ).data()?.currentAmount).toBe(150.25);

  await page.reload();
  await expect(page.getByText('Saldo Atual')).toBeVisible({timeout: 30_000});
  expect((await db.collection('workspaces').where('ownerId', '==', OWNER_UID).get()).size).toBe(1);
  expect((await db.collection(`workspaces/${WORKSPACE_ID}/transactions`)
    .where('description', '==', 'Aporte pré-vinculado E2E').get()).size).toBe(1);
});
