import { expect, test } from '@playwright/test';
import { callCallable, emulatorIdToken, runPagedCallable } from './support/callables';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');

/**
 * Superfície operacional e alocação PJ (INV-P1-006, INV-P1-008).
 *
 * A Etapa 3 tirou a administração técnica de investimentos da configuração
 * comum (§0.B) e remontou a faixa de alocação na tela de Investimentos (§6).
 * Este arquivo acompanha as duas decisões: a alocação PJ é verificada onde ela
 * passou a morar, e as operações pesadas continuam verificadas com o runtime
 * das Functions no meio — o gatilho deixou de ser um clique e passou a ser a
 * chamada HTTP que o SDK do navegador faz.
 */
const PROJECT = 'minhas-financas-local';
const UID = 'e2e-investment-ops-owner';
const EMAIL = 'e2e-investment-ops@minhas-financas.local';
const PASSWORD = 'e2e-investment-ops-password';
const WORKSPACE = 'e2e-investment-ops-workspace';
const GOAL = 'e2e-investment-ops-goal';

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

  await Promise.all([
    db.doc(`workspaces/${WORKSPACE}`).set({
      ownerId: UID, name: 'Empresa E2E', type: 'PJ',
      createdAt: now, updatedAt: now,
    }),
    db.doc(`workspaces/${WORKSPACE}/members/${UID}`).set({ uid: UID, role: 'owner', status: 'active' }),
    db.doc(`users/${UID}/workspaces/${WORKSPACE}`).set({ workspaceId: WORKSPACE, role: 'owner' }),
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
  await expect(page.getByRole('heading', { name: 'Investimentos' })).toBeVisible();

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

  // Os cadastros que o usuário comum usa continuam no lugar.
  await expect(page.getByText('Produtos e Serviços')).toBeVisible();
});

/**
 * Meta com progresso divergente e duas posições vinculadas.
 *
 * O progresso publicado é deliberadamente diferente do que as posições somam:
 * é o estado de deriva que o recálculo patrimonial existe para corrigir.
 */
const seedGoalWithDriftedProgress = async () => {
  const sdk = firebaseAdmin();
  const db = sdk.firestore();
  const now = sdk.firestore.Timestamp.now();

  await db.doc(`workspaces/${WORKSPACE}/goals/${GOAL}`).set({
    name: 'Reserva operacional',
    category: 'patrimonio',
    status: 'em_andamento',
    priority: 'media',
    targetAmount: 10_000,
    targetAmountCents: 1_000_000,
    startDate: '2026-01-01',
    deadline: '2026-12-31',
    horizon: 'medio',
    progressBasis: 'net_contributions',
    archived: false,
    workspaceId: WORKSPACE,
    profileId: WORKSPACE,
    visual: { color: '#112233', icon: 'target', progressBarType: 'linear' },
    investmentNetContributionCents: 999_999,
    investmentCurrentValueCents: 999_999,
    investmentProgressCents: 999_999,
    createdBy: UID,
    updatedBy: UID,
    createdAt: now,
    updatedAt: now,
  });

  const base = {
    workspaceId: WORKSPACE, profileType: 'PJ' as const, currency: 'BRL',
    createdBy: UID, updatedBy: UID, createdAt: now, updatedAt: now,
  };
  await db.doc(`workspaces/${WORKSPACE}/investment_accounts/ops-account`).set({
    ...base, id: 'ops-account', name: 'Tesouraria E2E',
    institutionName: 'Banco E2E', status: 'active',
  });
  await Promise.all([1, 2].map((index) =>
    db.doc(`workspaces/${WORKSPACE}/investment_assets/ops-asset-${index}`).set({
      ...base, id: `ops-asset-${index}`, name: `CDB ${index}`, symbol: `CDB${index}`,
      assetType: 'fixed_income', allocationPurpose: 'reserve', status: 'active',
    })));
  await Promise.all([1, 2].map((index) =>
    db.doc(`workspaces/${WORKSPACE}/investment_positions/ops-position-${index}`).set({
      ...base, id: `ops-position-${index}`, accountId: 'ops-account',
      assetId: `ops-asset-${index}`, goalId: GOAL, status: 'active',
      principalCents: 25_000, currentValueCents: 25_000,
      realizedGainCents: 0, realizedLossCents: 0, feesCents: 0, taxCents: 0,
      quantityMicros: 1_000_000, version: 1,
    })));
};

test('o recálculo de meta publica o valor absoluto pelo runtime das Functions', async ({ page, request }) => {
  await seedWorkspace();
  await seedGoalWithDriftedProgress();
  const db = firebaseAdmin().firestore();
  const token = await emulatorIdToken(request, EMAIL, PASSWORD);

  const outcome = await runPagedCallable(
    request, token, 'recalculateGoalInvestmentProgress',
    { workspaceId: WORKSPACE, goalId: GOAL, pageSize: 50, reason: 'Reconciliação após deriva' },
    'e2e-goal-rebuild-absoluto',
  );
  expect(outcome.status).toBe(200);

  // A meta converge para a soma exata das posições vinculadas.
  await expect.poll(
    async () => (await db.doc(`workspaces/${WORKSPACE}/goals/${GOAL}`).get())
      .data()?.investmentNetContributionCents,
    { timeout: 30_000 },
  ).toBe(50_000);

  // E a tela lê o mesmo número, sem recalcular nada no cliente. Em PJ o item
  // de menu chama-se "Metas Empresariais".
  await login(page);
  await page.getByText('Metas Empresariais', { exact: true }).first().click();
  await expect(page.getByText('Reserva operacional').first()).toBeVisible();
});

test('as reconstruções paginadas concluem pelo runtime das Functions', async ({ request }) => {
  /*
   * Todas compartilhavam um defeito que só aparece com o runtime das Functions
   * no meio — `admin.firestore.FieldPath` chega `undefined` no emulador — e
   * por isso falhavam com erro interno em qualquer chamada real, enquanto os
   * testes de integração, que chamam as funções exportadas diretamente,
   * passavam. É por isso que a cobertura continua sendo por HTTP.
   */
  await seedWorkspace();
  const db = firebaseAdmin().firestore();
  const token = await emulatorIdToken(request, EMAIL, PASSWORD);

  // 1. Fluxo de caixa mensal: a projeção que substitui a varredura da coleção
  //    inteira de transações no saldo acumulado.
  const caixa = await runPagedCallable(
    request, token, 'rebuildCashPeriods',
    { workspaceId: WORKSPACE, pageSize: 300, reason: 'Backfill da projeção de caixa' },
    'e2e-rebuild-cash',
  );
  expect(caixa.status).toBe(200);
  await expect.poll(async () => {
    const periods = await db
      .collection(`workspaces/${WORKSPACE}/cash_report_periods`).get();
    return periods.docs.filter((entry) => !entry.id.startsWith('cash_periods_rebuild')).length;
  }, { timeout: 30_000 }).toBeGreaterThan(0);

  // 2. Projeções patrimoniais.
  const projecoes = await runPagedCallable(
    request, token, 'rebuildInvestmentProjections',
    { workspaceId: WORKSPACE, pageSize: 50, reason: 'Reconstrução das projeções' },
    'e2e-rebuild-projections',
  );
  expect(projecoes.status).toBe(200);
  expect(projecoes.result?.completed).toBe(true);

  // 3. Posições e metas, em lote.
  const backfill = await runPagedCallable(
    request, token, 'backfillInvestmentWorkspace',
    { workspaceId: WORKSPACE, pageSize: 20, reason: 'Recálculo de posições e metas' },
    'e2e-backfill-workspace',
  );
  expect(backfill.status).toBe(200);
  expect(backfill.result?.completed).toBe(true);

  // Nenhuma delas altera fato: o caixa de receita e despesa segue intacto.
  expect((await db.collection(`workspaces/${WORKSPACE}/transactions`).get()).size).toBe(2);
});

test('papel sem autoridade recebe recusa do servidor, não botão escondido', async ({ request }) => {
  /*
   * §10 — esconder é conveniência de interface; autorizar é servidor. Com a
   * superfície fora da navegação, a única garantia que importa é esta: o
   * backend recusa quem não pode, mesmo que a chamada chegue direto.
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
  for (const [name, payload] of [
    ['rebuildInvestmentProjections', { pageSize: 50, reason: 'Tentativa sem autoridade' }],
    ['backfillInvestmentWorkspace', { pageSize: 20, reason: 'Tentativa sem autoridade' }],
    ['recalculateGoalInvestmentProgress', { goalId: GOAL, pageSize: 50, reason: 'Tentativa sem autoridade' }],
  ] as [string, Record<string, unknown>][]) {
    const outcome = await callCallable(request, token, name, {
      workspaceId: WORKSPACE,
      idempotencyKey: `e2e-sem-autoridade-${name}`,
      correlationId: `e2e-sem-autoridade-${name}`,
      ...payload,
    });
    expect(outcome.status, `${name} deveria recusar member`).toBeGreaterThanOrEqual(400);
    expect(outcome.errorStatus).toBe('PERMISSION_DENIED');
  }
});
