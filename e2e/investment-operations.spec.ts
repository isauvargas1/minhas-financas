import { expect, test } from '@playwright/test';
import { callCallable, emulatorIdToken, runPagedCallable } from './support/callables';
import { createRequire } from 'node:module';
import { seedOwnedWorkspace } from './support/workspaceSeed';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');

/**
 * Superfície operacional e alocação PJ (INV-P1-006, INV-P1-008; D-15, P4-D).
 *
 * A faixa de alocação PJ é verificada onde mora (tela de Investimentos). A
 * administração técnica, o onboarding, a valoração, a importação e as
 * reconstruções/backfill de investimentos não existem mais (D-15): o teste
 * prova pelo runtime das Functions que essas callables não estão expostas, e
 * que a reconstrução de caixa (`rebuildCashPeriods`) continua concluindo.
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

/** Workspace PJ novo, sem campo `features` e sem preparo nenhum. */
const seedWorkspace = async () => {
  const sdk = firebaseAdmin();
  const db = sdk.firestore();
  await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE}`));
  try { await sdk.auth().deleteUser(UID); } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  await sdk.auth().createUser({ uid: UID, email: EMAIL, password: PASSWORD, emailVerified: true });
  const now = sdk.firestore.Timestamp.now();
  const at = (iso: string) => sdk.firestore.Timestamp.fromDate(new Date(iso));

  await seedOwnedWorkspace({
    uid: UID, email: EMAIL, workspaceId: WORKSPACE, name: 'Empresa E2E', type: 'PJ',
  });
  await Promise.all([
    // Caixa de receita e despesa: continua sendo domínio de `transactions`.
    db.doc(`workspaces/${WORKSPACE}/transactions/caixa-1`).set({
      type: 'receita', description: 'Faturamento do mês', category: 'Serviços',
      value: 2_000, valueCents: 200_000, date: '2026-06-10',
      transactionDate: at('2026-06-10T15:00:00.000Z'),
      isPaid: true, userId: UID, workspaceId: WORKSPACE,
    }),
    db.doc(`workspaces/${WORKSPACE}/transactions/caixa-2`).set({
      type: 'despesa', description: 'Aluguel', category: 'Moradia',
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

/**
 * Alocação PJ, no lugar onde ela passou a morar (Etapa 3, §6 e §7).
 *
 * O baseline exibia `BusinessAllocationAnalysis` acima da tabela de
 * investimentos, classificando por nome de categoria de transação. A faixa
 * volta ao mesmo lugar visual, com a fonte trocada: os cortes que o backend
 * projeta a partir das posições liquidadas.
 */
test('a faixa de alocação PJ aparece na tela de Investimentos', async ({ page }) => {
  await seedWorkspace();
  const sdk = firebaseAdmin();
  const db = sdk.firestore();
  const now = sdk.firestore.Timestamp.now();

  await db.doc(`workspaces/${WORKSPACE}/investment_summaries/current`).set({
    id: 'current', workspaceId: WORKSPACE, profileType: 'PJ', currency: 'BRL',
    positionCount: 3, principalCents: 400_000, currentValueCents: 400_000,
    realizedGainCents: 0, unrealizedAppreciationCents: 0,
    feesCents: 0, taxCents: 0, updatedAt: now, updatedBy: UID,
  });

  const corte = (
    id: string, dimension: string, key: string, label: string, cents: number,
  ) => db.doc(`workspaces/${WORKSPACE}/investment_allocation_summaries/${id}`).set({
    id, workspaceId: WORKSPACE, profileType: 'PJ', currency: 'BRL',
    dimension, key, label, positionCount: 1,
    principalCents: cents, currentValueCents: cents,
    realizedGainCents: 0, feesCents: 0, taxCents: 0,
    updatedAt: now, updatedBy: UID,
  });
  // Carteiras semeadas para PJ pelo onboarding do domínio.
  await Promise.all([
    corte('class-caixa', 'class', 'cls-caixa', 'Caixa e liquidez', 200_000),
    corte('class-reserva', 'class', 'cls-reserva', 'Reserva operacional', 120_000),
    corte('class-expansao', 'class', 'cls-expansao', 'Expansão', 80_000),
    corte('purpose-reserve', 'purpose', 'reserve', 'Reserva', 200_000),
    corte('purpose-unassigned', 'purpose', 'unassigned', 'Não classificado', 200_000),
  ]);

  await login(page);
  await page.getByText('Investimentos', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Investimentos', exact: true })).toBeVisible();

  const faixa = page.getByRole('region', { name: 'Alocação do capital da empresa' });
  await expect(faixa).toBeVisible();
  await expect(faixa.getByText('Caixa e liquidez')).toBeVisible();
  await expect(faixa.getByText('Reserva operacional')).toBeVisible();
  await expect(faixa.getByText('Expansão')).toBeVisible();
  // 200.000 de 400.000 = 50,0%, sobre o resumo autoritativo.
  await expect(faixa.getByText('50.0%').first()).toBeVisible();

  // Finalidade contábil só aparece porque há finalidade declarada.
  await expect(faixa.getByText('Por finalidade contábil')).toBeVisible();
  await expect(faixa.getByText('Reserva', { exact: true })).toBeVisible();

  // A faixa PF não aparece num workspace PJ, e nenhuma aba profissional voltou.
  await expect(
    page.getByRole('heading', { name: 'Distribuição dos investimentos' }),
  ).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Alocação' })).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Alocação contábil do patrimônio' }),
  ).toHaveCount(0);
});

test('a administração técnica não aparece em Configurações para nenhum papel', async ({ page }) => {
  /*
   * §0.B — a experiência comum volta a ser equivalente à do ZIP. Contas e
   * ativos técnicos, semeadura de padrões e painel operacional continuam no
   * repositório e continuam com as mesmas regras de papel; o que saiu é o
   * ponto de montagem. Nem o proprietário os encontra em Cadastros.
   */
  await seedWorkspace();
  await login(page);
  await page.getByText('Configurações', { exact: true }).first().click();
  await page.getByRole('heading', { name: 'Cadastros', exact: true }).click();

  for (const titulo of [
    'Operação do domínio patrimonial',
    'Cadastros patrimoniais',
  ]) {
    await expect(page.getByRole('heading', { name: titulo })).toHaveCount(0);
  }
  await expect(page.getByText('Administração técnica de investimentos')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preparar padrões de investimentos' })).toHaveCount(0);

  // Os cadastros que o usuário comum usa continuam no lugar: carteira de
  // investimentos e instituição, e a categoria em `Categorias` › Investimentos
  // (a segunda fonte, `investment_type`, saiu com a D-15).
  await expect(page.getByText('Produtos e Serviços')).toBeVisible();
  for (const grupo of ['Carteiras de investimento', 'Instituições']) {
    await expect(page.getByText(grupo).first()).toBeVisible();
  }
  await expect(page.getByText('Categorias', { exact: true }).first()).toBeVisible();
  for (const removido of ['Categorias de investimento', 'Risco', 'Liquidez', 'Indexadores', 'Estratégias']) {
    await expect(page.getByText(removido, { exact: true })).toHaveCount(0);
  }
});

test('a reconstrução do caixa conclui pelo runtime das Functions', async ({ request }) => {
  /*
   * A reconstrução por cursor compartilhava um defeito que só aparece com o
   * runtime das Functions no meio — `admin.firestore.FieldPath` chega
   * `undefined` no emulador —, por isso a cobertura continua sendo por HTTP.
   */
  await seedWorkspace();
  const db = firebaseAdmin().firestore();
  const token = await emulatorIdToken(request, EMAIL, PASSWORD);

  const caixa = await runPagedCallable(
    request, token, 'rebuildCashPeriods',
    { workspaceId: WORKSPACE, pageSize: 300, reason: 'Reconstrução da projeção de caixa' },
    'e2e-rebuild-cash',
  );
  expect(caixa.status).toBe(200);
  await expect.poll(async () => {
    const periods = await db
      .collection(`workspaces/${WORKSPACE}/cash_report_periods`).get();
    return periods.docs.filter((entry) => !entry.id.startsWith('cash_periods_rebuild')).length;
  }, { timeout: 30_000 }).toBeGreaterThan(0);

  // Reconstruir não altera fato: os lançamentos seguem intactos.
  expect((await db.collection(`workspaces/${WORKSPACE}/transactions`).get()).size).toBe(2);
});

/** Callables removidas na D-15 (P4-D): não fazem parte do deploy. */
const REMOVED_INVESTMENT_CALLABLES = [
  'onboardInvestmentWorkspace',
  'createInvestmentContribution',
  'createInvestmentRedemption',
  'settleInvestmentRedemption',
  'saveInvestmentAccount',
  'archiveInvestmentAccount',
  'saveInvestmentAsset',
  'archiveInvestmentAsset',
  'recordInvestmentValuation',
  'registerInvestmentImportBatch',
  'recalculateInvestmentPosition',
  'recalculateGoalInvestmentProgress',
  'rebuildInvestmentProjections',
  'backfillInvestmentWorkspace',
];

test('as callables da experiência profissional não existem no runtime', async ({ request }) => {
  await seedWorkspace();
  const token = await emulatorIdToken(request, EMAIL, PASSWORD);
  for (const name of REMOVED_INVESTMENT_CALLABLES) {
    const outcome = await callCallable(request, token, name, {
      workspaceId: WORKSPACE,
      idempotencyKey: `e2e-removida-${name}`.slice(0, 64),
      correlationId: `e2e-removida-${name}`.slice(0, 64),
    });
    // Função inexistente no emulador: 404, nunca execução.
    expect(outcome.status, `${name} ainda responde`).toBe(404);
  }
});

test('papel sem autoridade recebe recusa do servidor, não botão escondido', async ({ request }) => {
  /*
   * §10 — esconder é conveniência de interface; autorizar é servidor. Desfazer
   * lançamento é de owner/admin: o member recebe recusa mesmo chamando direto.
   */
  await seedWorkspace();
  const db = firebaseAdmin().firestore();
  await db.doc(`workspaces/${WORKSPACE}/members/${UID}`).set(
    { uid: UID, role: 'member', status: 'active' }, { merge: true },
  );
  await db.doc(`workspaces/${WORKSPACE}`).set({ ownerId: 'outro-dono' }, { merge: true });
  // Espelho mentindo: diz `owner`, a membership real diz `member`. A checagem
  // não pode depender do documento que o próprio usuário escreve.
  await db.doc(`users/${UID}/workspaces/${WORKSPACE}`).set(
    { workspaceId: WORKSPACE, role: 'owner' }, { merge: true },
  );

  const token = await emulatorIdToken(request, EMAIL, PASSWORD);
  const outcome = await callCallable(request, token, 'reverseInvestmentMovement', {
    workspaceId: WORKSPACE,
    idempotencyKey: 'e2e-sem-autoridade-reverse-0001',
    correlationId: 'e2e-sem-autoridade-reverse',
    movementId: 'movimento-qualquer',
    reversedAt: new Date().toISOString(),
    reason: 'Tentativa sem autoridade',
  });
  expect(outcome.status, 'reverseInvestmentMovement deveria recusar member').toBeGreaterThanOrEqual(400);
  expect(outcome.errorStatus).toBe('PERMISSION_DENIED');
  expect(await db.collection(`workspaces/${WORKSPACE}/investment_movements`).count().get()
    .then((snapshot) => snapshot.data().count)).toBe(0);
});
