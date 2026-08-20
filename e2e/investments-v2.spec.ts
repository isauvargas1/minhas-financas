import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');
const PROJECT = 'minhas-financas-local';
const UID = 'e2e-investments-v2-owner';
const EMAIL = 'e2e-investments-v2@minhas-financas.local';
const PASSWORD = 'e2e-investments-v2-password';
const WORKSPACE = 'e2e-investments-v2-workspace';

const firebaseAdmin = () => {
  process.env.GCLOUD_PROJECT = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  return admin;
};

const seed = async (enabled: boolean) => {
  const sdk = firebaseAdmin();
  const db = sdk.firestore();
  await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE}`));
  try { await sdk.auth().deleteUser(UID); } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  await sdk.auth().createUser({ uid: UID, email: EMAIL, password: PASSWORD, emailVerified: true });
  const now = sdk.firestore.Timestamp.now();
  await Promise.all([
    db.doc(`workspaces/${WORKSPACE}`).set({
      ownerId: UID, name: 'Patrimônio E2E', type: 'PF',
      features: { investmentsV2: { enabled } }, createdAt: now, updatedAt: now,
    }),
    db.doc(`workspaces/${WORKSPACE}/members/${UID}`).set({ uid: UID, role: 'owner', status: 'active' }),
    db.doc(`users/${UID}/workspaces/${WORKSPACE}`).set({ workspaceId: WORKSPACE, role: 'owner' }),
  ]);
};

const login = async (page: import('@playwright/test').Page) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
  await page.getByText('Investimentos', { exact: true }).first().click();
};

test('flag desligada preserva a experiência legada', async ({ page }) => {
  await seed(false);
  await login(page);
  await expect(page.getByRole('button', { name: 'Nova Transação' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Patrimônio e investimentos' })).toHaveCount(0);
});

test('flag ligada exibe V2 responsiva e cria conta somente via callable', async ({ page }) => {
  await seed(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Patrimônio e investimentos' })).toBeVisible();
  await page.getByRole('tab', { name: 'Contas' }).click();
  await expect(page.getByText('Nenhuma conta encontrada para este filtro.')).toBeVisible();
  await page.getByRole('button', { name: 'Nova conta' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Nome da conta').fill('Conta E2E');
  await page.getByLabel('Instituição').fill('Instituição E2E');
  await page.getByRole('button', { name: 'Salvar conta' }).click();
  await expect(page.getByRole('status')).toContainText('sucesso');
  await expect.poll(async () => (
    await firebaseAdmin().firestore().collection(
      `workspaces/${WORKSPACE}/investment_accounts`,
    ).where('name', '==', 'Conta E2E').get()
  ).size).toBe(1);
  await expect(page.getByText('Conta E2E')).toBeVisible();
});
