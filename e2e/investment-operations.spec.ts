import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');

/**
 * Superfície operacional e alocação PJ (INV-P1-006, INV-P1-008).
 *
 * Antes desta tela as callables de reconstrução e backfill só eram invocáveis
 * por teste de integração: quem opera o workspace não tinha caminho executável
 * para corrigir deriva. E o diagnóstico contábil de alocação, principal valor
 * do módulo em PJ, não tinha superfície no domínio patrimonial.
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
) => {
  await page.getByRole('button', { name: button }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Motivo').fill(reason);
  await page.getByRole('dialog').getByRole('button', { name: button }).click();
};

test('alocação PJ distingue reserva, aplicação, reinvestimento e imobilizado', async ({ page }) => {
  await seedWorkspace();
  const sdk = firebaseAdmin();
  const db = sdk.firestore();
  const now = sdk.firestore.Timestamp.now();

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
  await seedWorkspace();
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
  await seedWorkspace();
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


/**
 * Meta com progresso divergente e dois aportes vinculados.
 *
 * O progresso publicado na meta é deliberadamente diferente do que as posições
 * vinculadas somam: é o estado de deriva que o recálculo patrimonial existe
 * para corrigir.
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
    // Progresso derivado, fora de sincronia com as posições abaixo.
    investmentNetContributionCents: 999_999,
    investmentCurrentValueCents: 999_999,
    investmentProgressCents: 999_999,
    createdBy: UID,
    updatedBy: UID,
    createdAt: now,
    updatedAt: now,
  });

  // Conta, ativo e duas posições vinculadas à meta: a soma correta é 50.000.
  await db.doc(`workspaces/${WORKSPACE}/investment_accounts/ops-account`).set({
    id: 'ops-account', workspaceId: WORKSPACE, profileType: 'PJ',
    name: 'Tesouraria E2E', institutionName: 'Banco E2E', currency: 'BRL',
    status: 'active', createdBy: UID, updatedBy: UID, createdAt: now, updatedAt: now,
  });
  await db.doc(`workspaces/${WORKSPACE}/investment_assets/ops-asset`).set({
    id: 'ops-asset', workspaceId: WORKSPACE, profileType: 'PJ',
    name: 'CDB E2E', symbol: 'CDB', assetType: 'fixed_income',
    allocationPurpose: 'reserve', currency: 'BRL', status: 'active',
    createdBy: UID, updatedBy: UID, createdAt: now, updatedAt: now,
  });
  await Promise.all([['pos-1', 30_000], ['pos-2', 20_000]].map(([id, principal]) =>
    db.doc(`workspaces/${WORKSPACE}/investment_positions/${id}`).set({
      id, workspaceId: WORKSPACE, profileType: 'PJ', currency: 'BRL',
      accountId: 'ops-account', assetId: 'ops-asset', goalId: GOAL,
      status: 'active', principalCents: principal, currentValueCents: principal,
      realizedGainCents: 0, realizedLossCents: 0, feesCents: 0, taxCents: 0,
      quantityMicros: 1_000_000, version: 1,
      createdBy: UID, updatedBy: UID, createdAt: now, updatedAt: now,
    })));
};

/**
 * Recálculo do progresso patrimonial de uma meta pela área operacional.
 *
 * `recalculateGoalInvestmentProgress` existia no backend sem **nenhum**
 * chamador no cliente: uma meta com progresso divergente das posições não tinha
 * caminho de volta para quem opera o workspace.
 */
test('recálculo patrimonial de meta publica o valor absoluto das posições', async ({ page }) => {
  await seedWorkspace();
  await seedGoalWithDriftedProgress();
  const db = firebaseAdmin().firestore();
  await login(page);
  await openOperations(page);

  await page.getByRole('button', { name: 'Recalcular progresso patrimonial' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();

  // Impacto declarado antes da confirmação, em pt-BR.
  await expect(
    page.getByText('Corrige deriva entre o progresso publicado na meta e as posições do domínio patrimonial.'),
  ).toBeVisible();

  // Sem meta escolhida e sem motivo, a confirmação fica travada.
  const confirm = page.getByRole('dialog')
    .getByRole('button', { name: 'Recalcular progresso patrimonial' });
  await expect(confirm).toBeDisabled();

  await page.getByLabel('Meta').selectOption(GOAL);
  await page.getByLabel('Motivo').fill('Reconciliação após deriva');
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(
    page.getByText(/Recalcular o progresso patrimonial de uma meta: concluída/),
  ).toBeVisible({ timeout: 60_000 });

  // O valor publicado passa a ser a soma exata das posições vinculadas.
  await expect.poll(
    async () => (await db.doc(`workspaces/${WORKSPACE}/goals/${GOAL}`).get())
      .data()?.investmentNetContributionCents,
    { timeout: 30_000 },
  ).toBe(50_000);
});

/**
 * O administrador recebe a ação corretiva de meta e **só** ela.
 *
 * O backend aceita `owner` e `admin` no recálculo de meta e apenas `owner` na
 * reconstrução de projeções e no backfill. A tela precisa refletir a mesma
 * matriz: mais restritiva deixaria o administrador sem caminho executável para
 * a operação que ele pode fazer; mais permissiva ofereceria um botão que
 * termina em recusa.
 */
test('administrador vê a ação corretiva de meta e não vê as do proprietário', async ({ page }) => {
  await seedWorkspace();
  await seedGoalWithDriftedProgress();
  const db = firebaseAdmin().firestore();
  await db.doc(`workspaces/${WORKSPACE}/members/${UID}`).set(
    { uid: UID, role: 'admin', status: 'active' },
    { merge: true },
  );
  await db.doc(`workspaces/${WORKSPACE}`).set({ ownerId: 'outro-dono' }, { merge: true });
  await db.doc(`users/${UID}/workspaces/${WORKSPACE}`).set(
    { workspaceId: WORKSPACE, role: 'admin' },
    { merge: true },
  );

  await login(page);
  await openOperations(page);

  await expect(
    page.getByRole('button', { name: 'Recalcular progresso patrimonial' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconstruir projeções' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Recalcular', exact: true })).toHaveCount(0);
  await expect(
    page.getByText(/A reconstrução de projeções e o backfill são restritos ao proprietário/),
  ).toBeVisible();

  // E a ação oferecida de fato executa para o administrador.
  await page.getByRole('button', { name: 'Recalcular progresso patrimonial' }).first().click();
  await page.getByLabel('Meta').selectOption(GOAL);
  await page.getByLabel('Motivo').fill('Reconciliação pelo administrador');
  await page.getByRole('dialog')
    .getByRole('button', { name: 'Recalcular progresso patrimonial' }).click();
  await expect(
    page.getByText(/Recalcular o progresso patrimonial de uma meta: concluída/),
  ).toBeVisible({ timeout: 60_000 });
  await expect.poll(
    async () => (await db.doc(`workspaces/${WORKSPACE}/goals/${GOAL}`).get())
      .data()?.investmentNetContributionCents,
    { timeout: 30_000 },
  ).toBe(50_000);
});


/**
 * As operações paginadas por `documentId()` do painel, de ponta a ponta.
 *
 * Nenhuma delas era exercitada por E2E. Todas compartilhavam um defeito que só
 * aparece com o runtime de Functions no meio — `admin.firestore.FieldPath`
 * chega `undefined` no emulador — e por isso falhavam com erro interno em
 * qualquer chamada real, enquanto os testes de integração, que chamam as
 * funções exportadas diretamente, passavam.
 *
 * Este teste existe para que o caminho que o operador usa seja o caminho
 * verificado.
 */
test('as reconstruções paginadas do painel concluem pela superfície', async ({ page }) => {
  await seedWorkspace();
  const db = firebaseAdmin().firestore();
  await login(page);
  await openOperations(page);

  // 1. Fluxo de caixa mensal: é o backfill da projeção que substitui a
  //    varredura da coleção inteira de transações no saldo acumulado.
  await runAction(page, 'Reconstruir fluxo de caixa', 'Backfill da projeção de caixa');
  await expect(
    page.getByText(/Reconstruir o fluxo de caixa mensal: concluída/),
  ).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => {
    const periods = await db
      .collection(`workspaces/${WORKSPACE}/cash_report_periods`)
      .get();
    return periods.docs.filter((entry) => !entry.id.startsWith('cash_periods_rebuild')).length;
  }, { timeout: 30_000 }).toBeGreaterThan(0);

  // 2. Projeções patrimoniais.
  await runAction(page, 'Reconstruir projeções', 'Reconstrução das projeções');
  await expect(
    page.getByText(/Reconstruir projeções: concluída/),
  ).toBeVisible({ timeout: 60_000 });

  // 3. Posições e metas, em lote.
  await runAction(page, 'Recalcular', 'Recálculo de posições e metas');
  await expect(
    page.getByText(/Recalcular posições e metas: concluída/),
  ).toBeVisible({ timeout: 60_000 });

  // Nenhuma delas altera fato: o caixa de receita e despesa segue intacto.
  const transactions = await db
    .collection(`workspaces/${WORKSPACE}/transactions`).get();
  expect(transactions.size).toBe(2);
});
