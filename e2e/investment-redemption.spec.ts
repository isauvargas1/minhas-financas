import {expect, test} from '@playwright/test';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');

const PROJECT_ID = 'minhas-financas-local';
const PASSWORD = 'e2e-password-123456';
const OWNER_UID = 'e2e-owner-redemption-m2';
const OWNER_EMAIL = 'e2e-owner-redemption-m2@minhas-financas.local';
const WORKSPACE_ID = 'workspace-e2e-redemption-m2';
const GOAL_ID = 'goal-redemption-e2e-id';
const SOURCE_ID = 'source-contribution-e2e-id';

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
  await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE_ID}`));
  try {
    await firebaseAdmin.auth().deleteUser(OWNER_UID);
  } catch (error) {
    if ((error as {code?: string}).code !== 'auth/user-not-found') throw error;
  }
  await firebaseAdmin.auth().createUser({uid: OWNER_UID, email: OWNER_EMAIL, password: PASSWORD, emailVerified: true});
  const timestamp = admin.firestore.FieldValue.serverTimestamp();
  await db.doc(`workspaces/${WORKSPACE_ID}`).set({
    ownerId: OWNER_UID, userId: OWNER_UID, name: 'Workspace Resgate M2', type: 'PF',
    createdAt: timestamp, updatedAt: timestamp,
  });
  await Promise.all([
    db.doc(`workspaces/${WORKSPACE_ID}/members/${OWNER_UID}`).set({uid: OWNER_UID, role: 'owner', status: 'active'}),
    db.doc(`users/${OWNER_UID}/workspaces/${WORKSPACE_ID}`).set({workspaceId: WORKSPACE_ID, role: 'owner'}),
    db.doc(`workspaces/${WORKSPACE_ID}/goals/${GOAL_ID}`).set({
      workspaceId: WORKSPACE_ID, profileId: WORKSPACE_ID, name: 'Meta Resgate M2',
      category: 'patrimonio', status: 'em_andamento', priority: 'alta', targetAmount: 2000,
      targetAmountCents: 200000, currentAmount: 1000, currentAmountCents: 100000,
      netContributionCents: 100000, progressBasis: 'net_contributions', startDate: '2026-01-01',
      deadline: '2027-01-01', horizon: 'curto', visual: {color: '#6366f1', icon: 'Target', progressBarType: 'linear'},
      createdAt: timestamp, updatedAt: timestamp,
    }),
    db.doc(`workspaces/${WORKSPACE_ID}/transactions/${SOURCE_ID}`).set({
      type: 'investimento', description: 'CDB de origem E2E', category: 'CDB', value: 1000,
      valueCents: 100000, date: '2026-08-01', isPaid: true, goalId: GOAL_ID,
      workspaceId: WORKSPACE_ID, profileId: WORKSPACE_ID, userId: OWNER_UID,
      redeemedPrincipalCents: 0, remainingPrincipalCents: 100000,
      investmentMetadata: {
        currency: 'BRL',
        investmentOperation: 'contribution', cashImpact: 'outflow', investmentImpact: 'increase',
        principalCents: 100000, gainCents: 0, feesCents: 0, taxCents: 0,
        status: 'settled', sourceMovementId: SOURCE_ID, idempotencyKey: 'seed-contribution-e2e-0001',
      },
      createdAt: timestamp, updatedAt: timestamp,
    }),
  ]);
};

test.beforeEach(seed);

test('resgate pendente não afeta meta e liquidação reduz somente o principal', async ({page}) => {
  const db = getAdmin().firestore();
  await page.goto(`/?e2eEmail=${encodeURIComponent(OWNER_EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({timeout: 30_000});

  await page.getByText('Investimentos', {exact: true}).first().click();
  await page.getByRole('button', {name: 'Nova Transação'}).click();
  await page.getByLabel('Operação').selectOption('redemption');
  await page.getByLabel(/Investimento de origem/).selectOption(SOURCE_ID);
  await page.getByLabel(/Descrição/).fill('Resgate parcial E2E');
  await page.getByLabel('Principal resgatado (R$)').fill('100');
  await page.getByLabel('Rendimento realizado (R$)').fill('20');
  await page.getByLabel('Taxas (R$)').fill('2');
  await page.getByLabel('Impostos (R$)').fill('3');
  await page.getByLabel('Pendente').check();
  await page.getByLabel('Data prevista').fill('2026-08-18');
  await page.getByRole('button', {name: 'Registrar Resgate'}).click();

  const redemptionQuery = db.collection(`workspaces/${WORKSPACE_ID}/transactions`)
    .where('description', '==', 'Resgate parcial E2E');
  await expect.poll(async () => (await redemptionQuery.get()).size).toBe(1);
  expect((await db.doc(`workspaces/${WORKSPACE_ID}/goals/${GOAL_ID}`).get()).data()?.currentAmountCents).toBe(100000);
  const pending = (await redemptionQuery.get()).docs[0];
  expect(pending.data().investmentMetadata.status).toBe('pending');

  await page.getByRole('row').filter({hasText: 'Resgate parcial E2E'}).getByRole('button', {name: 'Editar'}).click();
  await page.getByLabel('Liquidado').check();
  await page.getByRole('button', {name: 'Salvar Alterações'}).click();

  await expect.poll(async () => (
    await db.doc(`workspaces/${WORKSPACE_ID}/goals/${GOAL_ID}`).get()
  ).data()?.currentAmountCents).toBe(90000);
  const settled = await db.doc(`workspaces/${WORKSPACE_ID}/transactions/${pending.id}`).get();
  expect(settled.data()?.investmentMetadata.status).toBe('settled');
  expect(settled.data()?.valueCents).toBe(11500);
  expect(settled.data()?.investmentMetadata.principalCents).toBe(10000);
  expect((await redemptionQuery.get()).size).toBe(1);
});
