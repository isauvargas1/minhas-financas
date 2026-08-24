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
  if (enabled) {
    await Promise.all([
      db.doc(`workspaces/${WORKSPACE}/investment_summaries/current`).set({
        id: 'current', workspaceId: WORKSPACE, profileType: 'PF', currency: 'BRL',
        positionCount: 1, principalCents: 100_000, currentValueCents: 110_000,
        realizedGainCents: 2_000, unrealizedAppreciationCents: 10_000,
        feesCents: 500, taxCents: 300, updatedAt: now, updatedBy: UID,
      }),
      db.doc(`workspaces/${WORKSPACE}/investment_report_periods/2026-08`).set({
        id: '2026-08', workspaceId: WORKSPACE, profileType: 'PF', currency: 'BRL',
        period: '2026-08', periodStart: now, contributionCents: 100_000,
        redemptionPrincipalCents: 0, realizedGainCents: 0, feesCents: 500,
        taxCents: 300, costDeltaCents: 100_000, currentValueDeltaCents: 110_000,
        cashDeltaCents: -100_800, settledMovementCount: 1,
        closingCurrentValueCents: 110_000,
        updatedAt: now, updatedBy: UID,
      }),
      db.doc(`workspaces/${WORKSPACE}/investment_allocation_summaries/purpose-unassigned`).set({
        id: 'purpose-unassigned', workspaceId: WORKSPACE, profileType: 'PF',
        currency: 'BRL', dimension: 'purpose', key: 'unassigned',
        label: 'Não classificado', positionCount: 1, principalCents: 100_000,
        currentValueCents: 110_000, realizedGainCents: 2_000,
        feesCents: 500, taxCents: 300, updatedAt: now, updatedBy: UID,
      }),
    ]);
  }
};

/** Conta e ativo ativos, para exercitar aporte e resgate pela interface. */
const seedCatalog = async () => {
  const sdk = firebaseAdmin();
  const db = sdk.firestore();
  const now = sdk.firestore.Timestamp.now();
  await Promise.all([
    db.doc(`workspaces/${WORKSPACE}/investment_accounts/e2e-account`).set({
      id: 'e2e-account', workspaceId: WORKSPACE, profileType: 'PF',
      name: 'Corretora E2E', institutionName: 'Instituição E2E', currency: 'BRL',
      status: 'active', createdBy: UID, updatedBy: UID, createdAt: now, updatedAt: now,
    }),
    db.doc(`workspaces/${WORKSPACE}/investment_assets/e2e-asset`).set({
      id: 'e2e-asset', workspaceId: WORKSPACE, profileType: 'PF',
      name: 'CDB E2E', symbol: 'CDB', assetType: 'fixed_income',
      allocationPurpose: 'unassigned', currency: 'BRL', status: 'active',
      createdBy: UID, updatedBy: UID, createdAt: now, updatedAt: now,
    }),
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
  await expect(page.getByText('Operação concluída com sucesso.')).toBeVisible();
  await expect.poll(async () => (
    await firebaseAdmin().firestore().collection(
      `workspaces/${WORKSPACE}/investment_accounts`,
    ).where('name', '==', 'Conta E2E').get()
  ).size).toBe(1);
  await expect(page.getByText('Conta E2E')).toBeVisible();
});

test('V2 apresenta patrimônio no dashboard e relatório oficial sem misturar caixa', async ({ page }) => {
  await seed(true);
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Patrimônio de investimentos' })).toBeVisible();
  await expect(page.locator('article').filter({ hasText: 'Patrimônio atual' })
    .getByText('R$ 1.100,00')).toBeVisible();
  await page.getByText('Relatórios', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Patrimônio de investimentos' })).toBeVisible();
  await expect(page.getByText('Principal resgatado')).toBeVisible();
  await expect(page.getByText('Renda de investimento')).toBeVisible();
  await expect(page.getByText('Não classificado')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Evolução patrimonial' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Gráficos' }).click();
  await expect(page.getByRole('heading', { name: 'Evolução patrimonial' })).toBeVisible();
});

test('pedido de resgate pendente pode ser cancelado sem tocar caixa nem posição', async ({ page }) => {
  await seed(true);
  await seedCatalog();
  await login(page);
  await expect(page.getByRole('heading', { name: 'Patrimônio e investimentos' })).toBeVisible();

  // Aporte pela interface, exclusivamente via callable.
  await page.getByRole('button', { name: 'Novo aporte' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByLabel('Conta').selectOption({ label: 'Corretora E2E' });
  await page.getByRole('dialog').getByLabel('Ativo').selectOption({ label: 'CDB E2E' });
  await page.getByLabel('Descrição').fill('Aporte E2E');
  await page.getByLabel('Valor principal (R$)').fill('1000');
  await page.getByLabel('Quantidade').fill('1');
  await page.getByRole('button', { name: 'Confirmar aporte' }).click();
  await expect(page.getByText('Operação concluída com sucesso.')).toBeVisible();

  // Solicita resgate parcial a partir da posição.
  await page.getByRole('tab', { name: 'Ativos e posições' }).click();
  await expect(page.getByRole('button', { name: 'Resgatar' })).toBeVisible();
  await page.getByRole('button', { name: 'Resgatar' }).click();
  await page.getByLabel('Principal a resgatar (R$)').fill('400');
  await page.getByLabel('Quantidade a resgatar').fill('0.4');
  await page.getByRole('button', { name: 'Solicitar resgate' }).click();
  await expect(page.getByText('Operação concluída com sucesso.')).toBeVisible();

  const db = firebaseAdmin().firestore();
  const readPosition = async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_positions`).get()
  ).docs[0]?.data();
  // O pedido pendente não pode ter alterado o principal da posição.
  await expect.poll(async () => (await readPosition())?.principalCents ?? 0).toBe(100_000);
  const positionBefore = await readPosition();

  // O pendente aparece como tal e oferece cancelamento.
  await page.getByRole('tab', { name: 'Movimentações' }).click();
  const pending = page.locator('article').filter({ hasText: 'Resgate de investimento' });
  await expect(pending).toContainText('Pendente');
  await expect(pending.getByRole('button', { name: 'Liquidar' })).toBeVisible();
  await pending.getByRole('button', { name: 'Cancelar pedido' }).click();
  await page.getByLabel('Motivo do cancelamento').fill('Pedido desfeito no teste E2E');
  await page.getByRole('button', { name: 'Confirmar cancelamento' }).click();
  await expect(page.getByText('Operação concluída com sucesso.')).toBeVisible();

  // Passa a exibir Cancelada e deixa de oferecer liquidação.
  const cancelled = page.locator('article').filter({ hasText: 'Resgate de investimento' });
  await expect(cancelled).toContainText('Cancelada');
  await expect(cancelled.getByRole('button', { name: 'Liquidar' })).toHaveCount(0);
  await expect(cancelled.getByRole('button', { name: 'Cancelar pedido' })).toHaveCount(0);

  // Nem caixa, nem posição, nem meta foram tocados pelo cancelamento.
  const positionAfter = await readPosition();
  expect(positionAfter?.principalCents).toBe(positionBefore?.principalCents);
  expect(positionAfter?.version).toBe(positionBefore?.version);
  const movement = (await db.collection(`workspaces/${WORKSPACE}/investment_movements`)
    .where('operation', '==', 'redemption').get()).docs[0].data();
  expect(movement.status).toBe('cancelled');
  expect(movement.cashDeltaCents).toBe(0);
  expect(movement.principalDeltaCents).toBe(0);
  expect(movement.cancellationReason).toBe('Pedido desfeito no teste E2E');

  // O filtro de canceladas encontra o registro preservado.
  await page.getByLabel('Situação').selectOption('cancelled');
  await expect(page.locator('article').filter({ hasText: 'Resgate de investimento' })).toBeVisible();
  await page.getByLabel('Situação').selectOption('pending');
  await expect(page.getByText('Nenhuma movimentação encontrada para estes filtros.')).toBeVisible();
});

/** Login sem navegar para Investimentos: o lançamento global fica no painel. */
const loginToDashboard = async (page: import('@playwright/test').Page) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
};

test('flag ligada fecha a trilha legada no lançamento de transação', async ({ page }) => {
  // Com V2 ativa os relatórios leem só as projeções, mas o fluxo de caixa
  // continua somando `transactions`. Um aporte lançado pela trilha legada
  // sairia do caixa e nunca chegaria ao patrimônio — as Rules e as callables
  // recusam, e a interface precisa explicar em vez de deixar o usuário
  // esbarrar num erro de permissão.
  await seed(true);
  await loginToDashboard(page);
  await page.getByRole('button', { name: 'Nova Transação' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await expect(page.getByRole('button', { name: 'Receita', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Despesa', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Investimento', exact: true })).toHaveCount(0);
});

test('flag desligada mantém a aba de investimento no lançamento', async ({ page }) => {
  await seed(false);
  await loginToDashboard(page);
  await page.getByRole('button', { name: 'Nova Transação' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Investimento', exact: true })).toBeVisible();
});
