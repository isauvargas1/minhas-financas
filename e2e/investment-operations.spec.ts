import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');

/**
 * Superfície operacional e alocação PJ (INV-P1-006, INV-P1-008).
 *
 * Antes desta tela não existia procedimento executável para colocar um
 * workspace legado em produção nem para reverter: as nove callables críticas
 * só eram invocáveis por teste de integração. E ligar a flag apagava do
 * produto o diagnóstico contábil de alocação, que é o principal valor do
 * módulo em PJ.
 */

const PROJECT = 'minhas-financas-local';
const UID = 'e2e-investment-ops-owner';
const EMAIL = 'e2e-investment-ops@minhas-financas.local';
const PASSWORD = 'e2e-investment-ops-password';
const WORKSPACE = 'e2e-investment-ops-workspace';

const firebaseAdmin = () => {
  process.env.GCLOUD_PROJECT = PROJECT;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
  return admin;
};

/** Workspace PJ com histórico legado de investimento e a flag desligada. */
const seedLegacyWorkspace = async () => {
  const sdk = firebaseAdmin();
  const db = sdk.firestore();
  await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE}`));
  try { await sdk.auth().deleteUser(UID); } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  await sdk.auth().createUser({ uid: UID, email: EMAIL, password: PASSWORD, emailVerified: true });
  const now = sdk.firestore.Timestamp.now();
  const at = (iso: string) => sdk.firestore.Timestamp.fromDate(new Date(iso));

  await Promise.all([
    db.doc(`workspaces/${WORKSPACE}`).set({
      ownerId: UID, name: 'Empresa E2E', type: 'PJ',
      features: { investmentsV2: { enabled: false } },
      createdAt: now, updatedAt: now,
    }),
    db.doc(`workspaces/${WORKSPACE}/members/${UID}`).set({ uid: UID, role: 'owner', status: 'active' }),
    db.doc(`users/${UID}/workspaces/${WORKSPACE}`).set({ workspaceId: WORKSPACE, role: 'owner' }),
    db.doc(`workspaces/${WORKSPACE}/transactions/legacy-1`).set({
      type: 'investimento', description: 'Aplicação legada 1', category: 'CDB',
      value: 2_000, valueCents: 200_000, date: '2026-06-10',
      transactionDate: at('2026-06-10T15:00:00.000Z'),
      isPaid: true, userId: UID, workspaceId: WORKSPACE,
    }),
    db.doc(`workspaces/${WORKSPACE}/transactions/legacy-2`).set({
      type: 'investimento', description: 'Aplicação legada 2', category: 'CDB',
      value: 1_000, valueCents: 100_000, date: '2026-07-10',
      transactionDate: at('2026-07-10T15:00:00.000Z'),
      isPaid: true, userId: UID, workspaceId: WORKSPACE,
    }),
  ]);
};

const login = async (page: import('@playwright/test').Page) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
};

const openOperations = async (page: import('@playwright/test').Page) => {
  await page.getByText('Configurações', { exact: true }).first().click();
  await page.getByRole('heading', { name: 'Cadastros', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operação do domínio patrimonial' })).toBeVisible();
};

/** Executa uma ação do painel operacional informando o motivo obrigatório. */
const runAction = async (
  page: import('@playwright/test').Page,
  button: string,
  reason: string,
  extra?: { migrationId?: string },
) => {
  await page.getByRole('button', { name: button }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  if (extra?.migrationId) {
    await page.getByLabel('Identificador do lote de migração').fill(extra.migrationId);
  }
  await page.getByLabel('Motivo').fill(reason);
  await page.getByRole('dialog').getByRole('button', { name: button }).click();
};

test('migração pela superfície: simular, aplicar, conferir e habilitar', async ({ page }) => {
  await seedLegacyWorkspace();
  const db = firebaseAdmin().firestore();
  await login(page);
  await openOperations(page);

  await expect(page.getByText(/domínio patrimonial desligado/)).toBeVisible();
  await expect(page.getByText(/Há histórico legado de investimentos/)).toBeVisible();

  // 1. Simulação: nada é gravado no domínio.
  await runAction(page, 'Simular migração', 'Conferência antes de migrar');
  await expect(page.getByText(/Simular migração do histórico legado: concluída/)).toBeVisible({ timeout: 60_000 });
  expect((await db.collection(`workspaces/${WORKSPACE}/investment_movements`).get()).size).toBe(0);
  await expect(page.getByText('Linhas varridas')).toBeVisible();

  // 2. Aplicação real — o lote é separado do de simulação (INV-P1-003).
  await runAction(page, 'Aplicar migração', 'Migração para o domínio patrimonial');
  await expect(page.getByText(/Aplicar migração do histórico legado: concluída/)).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_movements`).get()
  ).size).toBe(2);

  // 3. Reconciliação verde, exibida antes de ligar a flag.
  await runAction(page, 'Conferir agora', 'Conferência de reconciliação');
  await expect(page.getByText(/Conferir reconciliação: concluída/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Principal no histórico legado')).toBeVisible();
  await expect(page.getByText('R$ 3.000,00').first()).toBeVisible();

  // 4. Habilitação da flag.
  await runAction(page, 'Habilitar domínio patrimonial', 'Rollout controlado');
  await expect(page.getByText(/Habilitar o domínio patrimonial \(flag V2\): concluída/)).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (
    await db.doc(`workspaces/${WORKSPACE}`).get()
  ).data()?.features?.investmentsV2?.enabled).toBe(true);
});

test('rollback pela superfície reverte a migração e permite remigrar', async ({ page }) => {
  await seedLegacyWorkspace();
  const db = firebaseAdmin().firestore();
  await login(page);
  await openOperations(page);

  await runAction(page, 'Aplicar migração', 'Migração inicial');
  await expect(page.getByText(/Aplicar migração do histórico legado: concluída/)).toBeVisible({ timeout: 60_000 });

  const applied = (await db.collection(`workspaces/${WORKSPACE}/investment_snapshots`)
    .where('kind', '==', 'legacy_migration').get()).docs
    .find((entry) => entry.data().dryRun !== true);
  expect(applied).toBeTruthy();

  await runAction(page, 'Reverter migração', 'Reversão para reparo', {
    migrationId: applied!.id,
  });
  await expect(page.getByText(/Reverter a migração aplicada: concluída/)).toBeVisible({ timeout: 60_000 });

  // Compensações emitidas, histórico preservado e posição zerada.
  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE}/investment_movements`)
      .where('operation', '==', 'reversal').get()
  ).size).toBe(2);
  const positions = await db.collection(`workspaces/${WORKSPACE}/investment_positions`).get();
  expect(positions.docs.every((entry) => (entry.data().principalCents ?? 0) === 0)).toBe(true);
  expect((await db.doc(`workspaces/${WORKSPACE}`).get()).data()?.features?.investmentsV2?.enabled).toBe(false);

  // Remigração pelo caminho padrão volta a reconstruir o patrimônio.
  await runAction(page, 'Aplicar migração', 'Remigração após reparo');
  await expect(page.getByText(/Aplicar migração do histórico legado: concluída/)).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => {
    const docs = await db.collection(`workspaces/${WORKSPACE}/investment_positions`).get();
    return docs.docs.reduce((total, entry) => total + (entry.data().principalCents ?? 0), 0);
  }).toBe(300_000);
});

test('alocação PJ distingue reserva, aplicação, reinvestimento e imobilizado', async ({ page }) => {
  await seedLegacyWorkspace();
  const sdk = firebaseAdmin();
  const db = sdk.firestore();
  const now = sdk.firestore.Timestamp.now();

  await db.doc(`workspaces/${WORKSPACE}`).set(
    { features: { investmentsV2: { enabled: true } } },
    { merge: true },
  );
  await db.doc(`workspaces/${WORKSPACE}/investment_summaries/current`).set({
    id: 'current', workspaceId: WORKSPACE, profileType: 'PJ', currency: 'BRL',
    positionCount: 4, principalCents: 400_000, currentValueCents: 400_000,
    realizedGainCents: 0, unrealizedAppreciationCents: 0,
    feesCents: 0, taxCents: 0, updatedAt: now, updatedBy: UID,
  });
  const purposes: Array<[string, string, number]> = [
    ['reserve', 'Reserva', 200_000],
    ['financial_application', 'Aplicação financeira', 100_000],
    ['reinvestment', 'Reinvestimento', 60_000],
    ['fixed_asset', 'Imobilizado', 40_000],
  ];
  await Promise.all(purposes.map(([key, label, cents]) =>
    db.doc(`workspaces/${WORKSPACE}/investment_allocation_summaries/purpose-${key}`).set({
      id: `purpose-${key}`, workspaceId: WORKSPACE, profileType: 'PJ', currency: 'BRL',
      dimension: 'purpose', key, label, positionCount: 1,
      principalCents: cents, currentValueCents: cents,
      realizedGainCents: 0, feesCents: 0, taxCents: 0,
      updatedAt: now, updatedBy: UID,
    })));

  await login(page);
  await page.getByText('Investimentos', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Patrimônio e investimentos' })).toBeVisible();
  await page.getByRole('tab', { name: 'Alocação' }).click();

  await expect(page.getByRole('heading', { name: 'Alocação contábil do patrimônio' })).toBeVisible();
  await expect(page.getByText('Por finalidade contábil')).toBeVisible();
  for (const [, label] of purposes) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  // Reserva é metade do patrimônio: R$ 2.000,00 de R$ 4.000,00.
  await expect(page.getByText('R$ 2.000,00 · 50.0%')).toBeVisible();
});

test('membro não vê a área operacional', async ({ page }) => {
  await seedLegacyWorkspace();
  const db = firebaseAdmin().firestore();
  await db.doc(`workspaces/${WORKSPACE}/members/${UID}`).set(
    { uid: UID, role: 'member', status: 'active' },
    { merge: true },
  );
  await db.doc(`workspaces/${WORKSPACE}`).set({ ownerId: 'outro-dono' }, { merge: true });
  // O espelho de leitura acompanha a membership real.
  await db.doc(`users/${UID}/workspaces/${WORKSPACE}`).set(
    { workspaceId: WORKSPACE, role: 'member' },
    { merge: true },
  );

  await login(page);
  await page.getByText('Configurações', { exact: true }).first().click();
  await page.getByRole('heading', { name: 'Cadastros', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operação do domínio patrimonial' })).toHaveCount(0);
});

// A checagem de papel não pode depender do espelho que o próprio usuário
// escreve: `users/{uid}/workspaces/{id}.role` é conveniência de leitura, e a
// fonte de verdade é `workspaces/{id}/members/{uid}`.
test('espelho de papel forjado não abre a área operacional', async ({ page }) => {
  await seedLegacyWorkspace();
  const db = firebaseAdmin().firestore();
  await db.doc(`workspaces/${WORKSPACE}/members/${UID}`).set(
    { uid: UID, role: 'member', status: 'active' },
    { merge: true },
  );
  await db.doc(`workspaces/${WORKSPACE}`).set({ ownerId: 'outro-dono' }, { merge: true });
  // Espelho mentindo: diz `owner`, a membership real diz `member`.
  await db.doc(`users/${UID}/workspaces/${WORKSPACE}`).set(
    { workspaceId: WORKSPACE, role: 'owner' },
    { merge: true },
  );

  await login(page);
  await page.getByText('Configurações', { exact: true }).first().click();
  await page.getByRole('heading', { name: 'Cadastros', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operação do domínio patrimonial' })).toHaveCount(0);
});
