import { expect, test, type Page } from '@playwright/test';

import {
  adminSdk,
  defaultCashAccountIdFor,
  saoPauloMonthKey,
  seedAccountProfile,
  seedMembership,
  seedOwnedWorkspace,
  seedWorkspaceDocument,
} from './support/workspaceSeed';

/**
 * P5-B (D-31) — Metas de ponta a ponta no Emulator.
 *
 * Toda meta tem uma única fonte de progresso (`manual`, `investment` ou
 * `business_kpi`) e toda escrita passa pelas callables do backend. Aqui o que
 * se prova, pela interface e pelo documento persistido:
 *
 * - meta manual: criação, atualização do valor acumulado, edição, status e
 *   arquivamento, sem lançamento, sem movimento de conta e com `revision`;
 * - arquivamento recusado com investimento vinculado e liberado ao desvincular;
 * - lista paginada (25 por página) com contadores do servidor;
 * - indicadores PJ calculados no servidor a partir de `incomeCents`/`expenseCents`;
 * - isolamento por workspace, viewer somente leitura, estado vazio e
 *   formulário desatualizado.
 */
test.use({ timezoneId: 'America/Sao_Paulo' });

const PASSWORD = 'e2e-password-123456';
const OWNER = { uid: 'e2e-goals-p5b-owner', email: 'e2e-goals-p5b-owner@minhas-financas.local' };
const VIEWER = { uid: 'e2e-goals-p5b-viewer', email: 'e2e-goals-p5b-viewer@minhas-financas.local' };
const PF_WS = 'e2e-goals-p5b-pf';
const PJ_WS = 'e2e-goals-p5b-pj';
const PJ_NAME = 'Empresa Metas P5B';

const resetEmulatorData = async () => {
  const sdk = adminSdk();
  const users = await sdk.auth().listUsers(1000);
  if (users.users.length > 0) {
    await sdk.auth().deleteUsers(users.users.map((user) => user.uid));
  }
  const db = sdk.firestore();
  const collections = await db.listCollections();
  await Promise.all(collections.map((collection) => db.recursiveDelete(collection)));
};

const createUser = async (user: { uid: string; email: string }) => {
  await adminSdk().auth().createUser({
    uid: user.uid, email: user.email, password: PASSWORD, emailVerified: true,
  });
};

interface SeedOptions {
  /** Cria também a empresa (PJ) do mesmo dono, entrando depois do pessoal. */
  pj?: boolean;
  /** Cadastra o viewer como membro do workspace pessoal. */
  viewer?: boolean;
  /** Cadastros que o formulário simples de investimento exige. */
  investmentCatalog?: boolean;
}

const seedTenant = async (options: SeedOptions = {}) => {
  await resetEmulatorData();
  await createUser(OWNER);
  await seedOwnedWorkspace({
    uid: OWNER.uid, email: OWNER.email, workspaceId: PF_WS, name: 'Pessoal Metas P5B',
    type: 'PF', joinedAt: new Date('2026-01-01T12:00:00.000Z'),
  });
  if (options.pj) {
    await seedWorkspaceDocument({
      workspaceId: PJ_WS, ownerId: OWNER.uid, name: PJ_NAME, type: 'PJ',
    });
    await seedMembership({
      workspaceId: PJ_WS, uid: OWNER.uid, email: OWNER.email, role: 'owner',
      name: PJ_NAME, type: 'PJ', joinedAt: new Date('2026-01-02T12:00:00.000Z'),
    });
  }
  if (options.viewer) {
    await createUser(VIEWER);
    await seedAccountProfile(VIEWER);
    await seedMembership({
      workspaceId: PF_WS, uid: VIEWER.uid, email: VIEWER.email, role: 'viewer',
      name: 'Pessoal Metas P5B', type: 'PF', joinedAt: new Date('2026-01-03T12:00:00.000Z'),
    });
  }
  if (options.investmentCatalog) {
    const db = adminSdk().firestore();
    const stamp = adminSdk().firestore.FieldValue.serverTimestamp();
    await Promise.all([
      ['p5b-class', 'investment_class', 'Reserva de emergência', 'reserva de emergencia', ''],
      ['p5b-institution', 'investment_institution', 'BTG', 'btg', ''],
      ['p5b-category', 'category', 'Renda fixa', 'renda fixa', 'investimento'],
    ].map(([id, group, name, normalizedName, transactionSubtype]) =>
      db.doc(`workspaces/${PF_WS}/settings_catalog/${id}`).set({
        id, workspaceId: PF_WS, group, name, normalizedName,
        ...(transactionSubtype ? { transactionSubtype } : {}),
        dedupeKey: `${group}::${transactionSubtype || 'all'}::both::${normalizedName}`,
        workspaceScope: 'both', sortOrder: 1, status: 'active',
        createdBy: OWNER.uid, updatedBy: OWNER.uid, createdAt: stamp, updatedAt: stamp,
      })));
  }
};

const firestore = () => adminSdk().firestore();
const Timestamp = () => adminSdk().firestore.Timestamp;
const goalRef = (workspaceId: string, goalId: string) =>
  firestore().doc(`workspaces/${workspaceId}/goals/${goalId}`);
const goalData = async (workspaceId: string, goalId: string) =>
  (await goalRef(workspaceId, goalId).get()).data();

/** Documento de meta no formato autoritativo (o que o backend grava). */
const goalDocument = (workspaceId: string, name: string, extra: Record<string, unknown>) => {
  const now = Timestamp().now();
  return {
    workspaceId,
    name,
    category: 'outro',
    priority: 'media',
    priorityRank: 2,
    status: 'em_andamento',
    startDate: '2026-01-01',
    deadline: '2027-12-31',
    horizon: 'medio',
    archived: false,
    revision: 1,
    visual: { color: '#6366f1', icon: 'Target', progressBarType: 'linear' },
    createdBy: OWNER.uid,
    updatedBy: OWNER.uid,
    createdAt: now,
    updatedAt: now,
    statusUpdatedAt: now,
    ...extra,
  };
};

const seedManualGoal = async (
  workspaceId: string,
  goalId: string,
  name: string,
  options: { progressCents?: number; targetCents?: number; status?: string; createdAtMillis?: number } = {},
) => {
  const document = goalDocument(workspaceId, name, {
    progressSource: 'manual',
    manualProgressCents: options.progressCents ?? 50_000,
    manualProgressUpdatedAt: Timestamp().now(),
    targetAmountCents: options.targetCents ?? 1_000_000,
    status: options.status ?? 'em_andamento',
    ...(options.createdAtMillis ? { createdAt: Timestamp().fromMillis(options.createdAtMillis) } : {}),
  });
  await goalRef(workspaceId, goalId).set(document);
};

const seedInvestmentGoal = async (workspaceId: string, goalId: string, name: string) => {
  await goalRef(workspaceId, goalId).set(goalDocument(workspaceId, name, {
    category: 'reserva_emergencia',
    priority: 'alta',
    priorityRank: 3,
    horizon: 'curto',
    progressSource: 'investment',
    progressBasis: 'net_contributions',
    targetAmountCents: 100_000,
    investmentNetContributionCents: 0,
    investmentCurrentValueCents: 0,
    investmentProgressCents: 0,
  }));
};

const seedKpiGoal = async (
  workspaceId: string,
  goalId: string,
  name: string,
  extra: Record<string, unknown>,
) => {
  await goalRef(workspaceId, goalId).set(goalDocument(workspaceId, name, {
    category: 'patrimonio',
    priority: 'alta',
    priorityRank: 3,
    progressSource: 'business_kpi',
    period: 'mensal',
    ...extra,
  }));
};

const login = async (page: Page, email: string) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(email)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
};

const openGoals = async (page: Page, label = 'Metas') => {
  await page.getByText(label, { exact: true }).first().click();
};

const goalHeading = (page: Page, name: string) =>
  page.getByRole('heading', { name, level: 3, exact: true });

/** Cartão da meta na lista (raiz clicável que contém o título). */
const goalCard = (page: Page, name: string) =>
  goalHeading(page, name).locator('xpath=ancestor::div[contains(@class,"cursor-pointer")][1]');

const openGoal = async (page: Page, name: string) => {
  await openGoals(page);
  await goalHeading(page, name).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
};

/** Contador "Total Metas" (PF), que vem do servidor e não da página carregada. */
const totalGoalsCounter = (page: Page) =>
  page.getByText('Total Metas', { exact: true }).locator('xpath=..').locator('p');

const statusButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.describe('Metas P5-B', () => {
  test('meta manual: cria, mostra valores exatos e atualiza o valor acumulado sem lançamento', async ({ page }) => {
    await seedTenant();
    await login(page, OWNER.email);
    await openGoals(page);

    await page.getByRole('button', { name: 'Nova Meta' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Nome da Meta').fill('Viagem Manual E2E');
    await dialog.getByLabel('Como medir o progresso').selectOption({ label: 'Informado por mim' });
    await dialog.getByLabel('Valor já acumulado (R$)').fill('1.234,56');
    await dialog.getByLabel('Valor Objetivo (R$)').fill('10.000,00');
    await dialog.getByRole('button', { name: 'Criar Meta' }).click();
    await expect(dialog).toHaveCount(0);

    // A lista mostra reais inteiros nos cartões; o contador vem do servidor.
    const card = goalCard(page, 'Viagem Manual E2E');
    await expect(card).toBeVisible();
    await expect(card).toContainText('R$ 1.235');
    await expect(card).toContainText('R$ 10.000');
    await expect(totalGoalsCounter(page)).toHaveText('1');

    const created = await firestore().collection(`workspaces/${PF_WS}/goals`)
      .where('name', '==', 'Viagem Manual E2E').get();
    expect(created.size).toBe(1);
    const goalId = created.docs[0].id;
    expect(created.docs[0].data()).toMatchObject({
      progressSource: 'manual',
      manualProgressCents: 123_456,
      targetAmountCents: 1_000_000,
      revision: 1,
      archived: false,
      status: 'em_andamento',
      priorityRank: 2,
    });
    expect(created.docs[0].data()).not.toHaveProperty('progressBasis');

    // Detalhe: valores exatos, em centavos.
    await goalHeading(page, 'Viagem Manual E2E').click();
    await expect(page.getByRole('heading', { name: 'Viagem Manual E2E', level: 1 })).toBeVisible();
    await expect(page.getByText(/R\$\s*1\.234,56\s*\/\s*R\$\s*10\.000,00/)).toBeVisible();

    await page.getByRole('button', { name: 'Atualizar valor acumulado' }).click();
    await page.getByLabel('Novo valor acumulado (R$)').fill('2.000,00');
    await page.getByRole('button', { name: 'Salvar valor' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Valor acumulado atualizado.' })).toBeVisible();
    await expect(page.getByText(/R\$\s*2\.000,00\s*\/\s*R\$\s*10\.000,00/)).toBeVisible();

    await expect.poll(async () => (await goalData(PF_WS, goalId))?.manualProgressCents).toBe(200_000);
    const updated = await goalData(PF_WS, goalId);
    expect(updated?.revision).toBe(2);
    expect(updated?.targetAmountCents).toBe(1_000_000);

    // O histórico do owner traz antes e depois.
    const history = page.getByRole('list', { name: 'Histórico de atualizações do valor acumulado' });
    await expect(history).toContainText('R$ 1.234,56');
    await expect(history).toContainText('R$ 2.000,00');

    // Meta manual não cria lançamento, não move conta e não toca investimentos.
    expect((await firestore().collection(`workspaces/${PF_WS}/transactions`).get()).size).toBe(0);
    expect((await firestore().collection(`workspaces/${PF_WS}/cash_account_movements`).get()).size).toBe(0);
    expect((await firestore().collection(`workspaces/${PF_WS}/investment_movements`).get()).size).toBe(0);
    const account = await firestore()
      .doc(`workspaces/${PF_WS}/cash_accounts/${defaultCashAccountIdFor(PF_WS)}`).get();
    expect(account.data()?.balanceCents).toBe(0);
  });

  test('editar a meta renomeia, incrementa a revisão e preserva o valor manual', async ({ page }) => {
    await seedTenant();
    await seedManualGoal(PF_WS, 'goal-edit', 'Meta Para Editar', { progressCents: 77_700 });
    await login(page, OWNER.email);
    await openGoal(page, 'Meta Para Editar');

    await page.getByRole('button', { name: 'Editar meta' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Editar Meta' })).toBeVisible();
    // O valor acumulado não é editável no formulário: só pela página da meta.
    await expect(dialog.getByText('Para alterar o valor acumulado, use "Atualizar valor acumulado"')).toBeVisible();
    await expect(dialog.getByLabel('Valor já acumulado (R$)')).toHaveCount(0);
    await dialog.getByLabel('Nome da Meta').fill('Meta Renomeada E2E');
    await dialog.getByRole('button', { name: 'Salvar Alterações' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(page.getByRole('heading', { name: 'Meta Renomeada E2E', level: 1 })).toBeVisible();
    await expect.poll(async () => (await goalData(PF_WS, 'goal-edit'))?.name).toBe('Meta Renomeada E2E');
    const edited = await goalData(PF_WS, 'goal-edit');
    expect(edited?.revision).toBe(2);
    expect(edited?.manualProgressCents).toBe(77_700);
    expect(edited?.status).toBe('em_andamento');
    await expect(page.getByText(/R\$\s*777,00\s*\/\s*R\$\s*10\.000,00/)).toBeVisible();

    await page.getByRole('button', { name: 'Voltar' }).click();
    await expect(goalHeading(page, 'Meta Renomeada E2E')).toBeVisible();
    await expect(goalHeading(page, 'Meta Para Editar')).toHaveCount(0);
  });

  test('status: pausar persiste (inclusive após recarregar), retomar e concluir', async ({ page }) => {
    await seedTenant();
    await seedManualGoal(PF_WS, 'goal-status', 'Meta de Status');
    await login(page, OWNER.email);
    await openGoal(page, 'Meta de Status');

    await statusButton(page, 'Pausar').click();
    await expect(statusButton(page, 'Pausada')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await goalData(PF_WS, 'goal-status'))?.status).toBe('pausada');
    // Mudar o status não altera a revisão nem o progresso informado.
    expect((await goalData(PF_WS, 'goal-status'))?.revision).toBe(1);
    expect((await goalData(PF_WS, 'goal-status'))?.manualProgressCents).toBe(50_000);

    await page.reload();
    await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
    await openGoals(page);
    await expect(goalCard(page, 'Meta de Status').getByText('PAUSADA', { exact: true })).toBeVisible();
    await goalHeading(page, 'Meta de Status').click();
    await expect(statusButton(page, 'Pausada')).toHaveAttribute('aria-pressed', 'true');

    await statusButton(page, 'Retomar').click();
    await expect(statusButton(page, 'Em Andamento')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await goalData(PF_WS, 'goal-status'))?.status).toBe('em_andamento');

    await statusButton(page, 'Concluir').click();
    await expect(statusButton(page, 'Concluída')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await goalData(PF_WS, 'goal-status'))?.status).toBe('alcancada');

    await page.getByRole('button', { name: 'Voltar' }).click();
    const card = goalCard(page, 'Meta de Status');
    await expect(card.getByText('CONCLUÍDA', { exact: true })).toBeVisible();
    // Concluída (status) não é alvo atingido (progresso): 500 de 10.000.
    await expect(card.getByText('ALVO ATINGIDO', { exact: true })).toHaveCount(0);
  });

  test('alvo atingido pelo progresso não vira status concluída', async ({ page }) => {
    await seedTenant();
    await seedManualGoal(PF_WS, 'goal-reached', 'Meta no Alvo', {
      progressCents: 1_000_000, targetCents: 1_000_000,
    });
    await login(page, OWNER.email);
    await openGoals(page);

    const card = goalCard(page, 'Meta no Alvo');
    await expect(card.getByText('ALVO ATINGIDO', { exact: true })).toBeVisible();
    await expect(card.getByText('CONCLUÍDA', { exact: true })).toHaveCount(0);

    await goalHeading(page, 'Meta no Alvo').click();
    await expect(page.getByText('Alvo atingido!', { exact: true })).toBeVisible();
    await expect(statusButton(page, 'Em Andamento')).toHaveAttribute('aria-pressed', 'true');
    expect((await goalData(PF_WS, 'goal-reached'))?.status).toBe('em_andamento');
  });

  test('arquivar meta sem vínculos: sai da lista, o documento permanece e o status é preservado', async ({ page }) => {
    await seedTenant();
    await seedManualGoal(PF_WS, 'goal-archive', 'Meta Para Arquivar', { status: 'pausada' });
    page.on('dialog', (dialog) => void dialog.accept());
    await login(page, OWNER.email);
    await openGoal(page, 'Meta Para Arquivar');

    await page.getByRole('button', { name: 'Arquivar meta' }).click();
    // Volta para a lista, já sem a meta e com o estado vazio.
    await expect(page.getByText('Nenhuma meta encontrada.')).toBeVisible();
    await expect(goalHeading(page, 'Meta Para Arquivar')).toHaveCount(0);
    await expect(totalGoalsCounter(page)).toHaveText('0');

    const archived = await goalData(PF_WS, 'goal-archive');
    expect(archived).toBeDefined();
    expect(archived?.archived).toBe(true);
    // Arquivar não é cancelar: o status de evolução fica como estava.
    expect(archived?.status).toBe('pausada');
    expect(archived?.revision).toBe(2);
    expect(archived?.archiveReason).toBe('Arquivada pelo usuário');
    expect(archived?.archivedBy).toBe(OWNER.uid);
  });

  test('meta com investimento vinculado recusa arquivar; ao desvincular, arquiva', async ({ page }) => {
    await seedTenant({ investmentCatalog: true });
    await seedInvestmentGoal(PF_WS, 'goal-linked', 'Meta Com Investimento');
    page.on('dialog', (dialog) => void dialog.accept());
    await login(page, OWNER.email);
    await openGoal(page, 'Meta Com Investimento');

    // Aporte nascido na meta cria a posição vinculada.
    await page.getByRole('button', { name: 'Novo Aporte' }).click();
    const aporte = page.getByRole('dialog');
    await expect(aporte).toBeVisible();
    await aporte.getByLabel('Carteira de investimentos').selectOption({ label: 'Reserva de emergência' });
    await aporte.getByLabel('Instituição').selectOption({ label: 'BTG' });
    await aporte.getByLabel('Descrição').fill('Aporte da meta arquivável');
    await aporte.getByLabel('Categoria').selectOption({ label: 'Renda fixa' });
    await aporte.getByLabel('Valor do investimento').fill('15025');
    await aporte.getByRole('radio', { name: 'Sim' }).check();
    await aporte.getByRole('button', { name: 'Salvar' }).click();
    await expect(aporte).toHaveCount(0);
    await expect.poll(async () => (await goalData(PF_WS, 'goal-linked'))?.investmentProgressCents,
      { timeout: 30_000 }).toBe(15_025);

    // Arquivar é recusado pelo backend, com a mensagem em pt-BR e o caminho de saída.
    await page.getByRole('button', { name: 'Arquivar meta' }).click();
    const banner = page.getByRole('alert').filter({ hasText: 'investimentos vinculados' });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Desvincule ou transfira');
    await expect(banner).toContainText('Vincular Existente');
    await expect(page.getByRole('heading', { name: 'Meta Com Investimento', level: 1 })).toBeVisible();
    const stillActive = await goalData(PF_WS, 'goal-linked');
    expect(stillActive?.archived).toBe(false);
    expect(stillActive?.revision).toBe(1);

    // Desvincula pelo caminho existente.
    await page.getByRole('button', { name: 'Vincular Existente' }).click();
    const vinculos = page.getByRole('dialog');
    await expect(vinculos.getByRole('heading', { name: 'Investimentos da meta' })).toBeVisible();
    await vinculos.getByRole('button', { name: 'Remover da meta' }).click();
    await expect.poll(async () => (await goalData(PF_WS, 'goal-linked'))?.investmentProgressCents,
      { timeout: 30_000 }).toBe(0);
    // O modal só fecha com a operação concluída (não aceita fechar em curso).
    await expect(page.getByRole('status').filter({ hasText: 'Investimento removido da meta.' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(vinculos).toHaveCount(0);

    await page.getByRole('button', { name: 'Arquivar meta' }).click();
    await expect(page.getByText('Nenhuma meta encontrada.')).toBeVisible();
    await expect.poll(async () => (await goalData(PF_WS, 'goal-linked'))?.archived).toBe(true);
    expect((await goalData(PF_WS, 'goal-linked'))?.status).toBe('em_andamento');

    // Nada foi apagado: o vínculo e o desvínculo ficam no ledger.
    const operations = (await firestore().collection(`workspaces/${PF_WS}/investment_movements`).get())
      .docs.map((entry) => entry.get('operation'));
    expect(operations).toContain('contribution');
    expect(operations).toContain('goal_unlink');
  });

  test('lista paginada: 25 por página, "Carregar mais metas" sem duplicar, contador do servidor', async ({ page }) => {
    await seedTenant();
    const base = Date.now() - 3_600_000;
    const writer = firestore().batch();
    for (let index = 1; index <= 30; index += 1) {
      const label = String(index).padStart(2, '0');
      writer.set(goalRef(PF_WS, `goal-page-${label}`), goalDocument(PF_WS, `Meta Paginada ${label}`, {
        progressSource: 'manual',
        manualProgressCents: index * 100,
        manualProgressUpdatedAt: Timestamp().now(),
        targetAmountCents: 1_000_000,
        createdAt: Timestamp().fromMillis(base + index * 1_000),
      }));
    }
    await writer.commit();

    await login(page, OWNER.email);
    await openGoals(page);

    const headings = page.getByRole('heading', { level: 3, name: /^Meta Paginada \d{2}$/ });
    await expect(headings).toHaveCount(25);
    // O contador é do servidor: 30 mesmo com 25 cartões carregados.
    await expect(totalGoalsCounter(page)).toHaveText('30');
    const more = page.getByRole('button', { name: 'Carregar mais metas' });
    await expect(more).toBeVisible();
    // Mais novas primeiro: 30 … 06 na primeira página.
    await expect(headings.first()).toHaveText('Meta Paginada 30');
    await expect(headings.last()).toHaveText('Meta Paginada 06');

    await more.click();
    await expect(headings).toHaveCount(30);
    await expect(more).toHaveCount(0);
    const names = await headings.allTextContents();
    expect(new Set(names).size).toBe(30);
    await expect(totalGoalsCounter(page)).toHaveText('30');
  });

  test('PJ: "Valor informado" cria meta manual, atualiza o valor, edita e arquiva sem lançamento', async ({ page }) => {
    await seedTenant({ pj: true });
    page.on('dialog', (dialog) => void dialog.accept());
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
      `lastWorkspaceId_${OWNER.uid}`, PJ_WS,
    ]);
    await login(page, OWNER.email);
    await openGoals(page, 'Metas Empresariais');

    await page.getByRole('button', { name: 'Nova Meta' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Nova Meta Empresarial' })).toBeVisible();
    const manualTile = dialog.getByRole('button', { name: /valor informado/i });
    await manualTile.click();
    await expect(manualTile).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByRole('button', { name: /recebimentos operacionais realizados/i }))
      .toHaveAttribute('aria-pressed', 'false');
    // Meta manual não tem período de indicador; o centro de custo é informativo.
    await expect(dialog.getByLabel('Período de Apuração')).toHaveCount(0);
    await expect(dialog.getByText('Informativo: não filtra os indicadores automáticos, que usam os valores gerais da empresa.'))
      .toBeVisible();
    await dialog.getByLabel('Nome da Meta').fill('Reserva PJ Manual');
    await dialog.getByLabel('Centro de Custo (Opcional)').fill('Comercial');
    await dialog.getByLabel('Valor já acumulado (R$)').fill('0');
    await dialog.getByLabel('Valor Alvo (R$)').fill('50.000,00');
    await dialog.getByRole('button', { name: 'Salvar Meta' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(goalHeading(page, 'Reserva PJ Manual')).toBeVisible();
    const created = await firestore().collection(`workspaces/${PJ_WS}/goals`)
      .where('name', '==', 'Reserva PJ Manual').get();
    expect(created.size).toBe(1);
    const goalId = created.docs[0].id;
    const data = created.docs[0].data();
    expect(data).toMatchObject({
      workspaceId: PJ_WS,
      progressSource: 'manual',
      manualProgressCents: 0,
      targetAmountCents: 5_000_000,
      costCenter: 'Comercial',
      archived: false,
      revision: 1,
    });
    for (const field of ['businessType', 'progressBasis', 'period', 'targetBasisPoints']) {
      expect(data, field).not.toHaveProperty(field);
    }

    // Detalhe PJ: valor manual atualizado pela callable, com centro de custo informativo.
    await goalHeading(page, 'Reserva PJ Manual').click();
    await expect(page.getByRole('heading', { name: 'Reserva PJ Manual', level: 1 })).toBeVisible();
    await expect(page.getByText('Centro de custo: Comercial')).toBeVisible();
    await page.getByRole('button', { name: 'Atualizar valor acumulado' }).click();
    await page.getByLabel('Novo valor acumulado (R$)').fill('2.500,00');
    await page.getByRole('button', { name: 'Salvar valor' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Valor acumulado atualizado.' })).toBeVisible();
    await expect.poll(async () => (await goalData(PJ_WS, goalId))?.manualProgressCents).toBe(250_000);
    expect((await goalData(PJ_WS, goalId))?.revision).toBe(2);

    // Edição no formulário PJ mantém a modalidade e não reenvia o valor.
    await page.getByRole('button', { name: 'Editar meta' }).first().click();
    const edit = page.getByRole('dialog');
    await expect(edit.getByRole('heading', { name: 'Editar Meta' })).toBeVisible();
    await expect(edit.getByRole('button', { name: /valor informado/i })).toHaveAttribute('aria-pressed', 'true');
    await expect(edit.getByLabel('Valor já acumulado (R$)')).toHaveCount(0);
    await expect(edit.getByText('Para alterar o valor acumulado, use "Atualizar valor acumulado"')).toBeVisible();
    await edit.getByLabel('Nome da Meta').fill('Reserva PJ Renomeada');
    await edit.getByRole('button', { name: 'Salvar Meta' }).click();
    await expect(edit).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Reserva PJ Renomeada', level: 1 })).toBeVisible();
    await expect.poll(async () => (await goalData(PJ_WS, goalId))?.revision).toBe(3);
    const edited = await goalData(PJ_WS, goalId);
    expect(edited).toMatchObject({ name: 'Reserva PJ Renomeada', progressSource: 'manual', manualProgressCents: 250_000 });
    expect(edited).not.toHaveProperty('businessType');

    await page.getByRole('button', { name: 'Arquivar meta' }).first().click();
    await expect(goalHeading(page, 'Reserva PJ Renomeada')).toHaveCount(0);
    await expect.poll(async () => (await goalData(PJ_WS, goalId))?.archived).toBe(true);
    expect((await goalData(PJ_WS, goalId))?.status).toBe('em_andamento');

    // Nenhum lançamento, movimento de conta ou aporte no ciclo da meta manual PJ.
    for (const collection of ['transactions', 'cash_account_movements', 'investment_movements', 'investment_positions']) {
      expect((await firestore().collection(`workspaces/${PJ_WS}/${collection}`).get()).size, collection).toBe(0);
    }
  });

  test('PJ: centro de custo de um indicador é informativo (valores gerais da empresa)', async ({ page }) => {
    await seedTenant({ pj: true });
    await seedKpiGoal(PJ_WS, 'kpi-cc', 'Faturamento Comercial', {
      businessType: 'faturamento', targetAmountCents: 200_000, costCenter: 'Comercial',
    });
    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
      `lastWorkspaceId_${OWNER.uid}`, PJ_WS,
    ]);
    await login(page, OWNER.email);
    await openGoals(page, 'Metas Empresariais');
    await goalHeading(page, 'Faturamento Comercial').click();
    await expect(page.getByRole('heading', { name: 'Faturamento Comercial', level: 1 })).toBeVisible();
    await expect(page.getByText('Centro de custo: Comercial')).toBeVisible();
    await expect(page.getByText(
      'O centro de custo é informativo: este indicador usa os valores gerais da empresa, sem filtrar por centro de custo.',
    )).toBeVisible();
  });

  test('PJ: faturamento usa só os recebimentos operacionais realizados do servidor', async ({ page }) => {
    await seedTenant({ pj: true });
    await seedKpiGoal(PJ_WS, 'kpi-faturamento', 'Faturar no mês', {
      businessType: 'faturamento', targetAmountCents: 200_000,
    });
    await seedKpiGoal(PJ_WS, 'kpi-lucro', 'Resultado do mês', {
      businessType: 'lucro', targetAmountCents: 100_000,
    });
    const month = saoPauloMonthKey();
    // Campos fora do operacional não podem entrar no indicador.
    await firestore().doc(`workspaces/${PJ_WS}/cash_report_periods/${month}`).set({
      id: month, workspaceId: PJ_WS, period: month,
      periodStart: Timestamp().fromDate(new Date(`${month}-01T03:00:00.000Z`)),
      incomeCents: 123_456,
      expenseCents: 50_000,
      loanPrincipalInflowCents: 700_000,
      loanPrincipalOutflowCents: 650_000,
      creditCardPaymentCents: 800_000,
      investmentOutflowCents: 900_000,
      investmentInflowCents: 910_000,
      financialIncomeCents: 600_000,
      financialExpenseCents: 610_000,
      netCents: 123_456 - 50_000,
      transactionCount: 4,
      updatedAt: Timestamp().now(),
    });

    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
      `lastWorkspaceId_${OWNER.uid}`, PJ_WS,
    ]);
    await login(page, OWNER.email);
    await openGoals(page, 'Metas Empresariais');

    const faturamento = goalCard(page, 'Faturar no mês');
    await expect(faturamento).toBeVisible();
    await expect(faturamento.getByText('Recebimentos operacionais realizados', { exact: true })).toBeVisible();
    await expect(faturamento).toContainText('R$ 1.235');
    await expect(faturamento).toContainText('R$ 2.000');
    for (const proibido of ['R$ 8.000', 'R$ 9.000', 'R$ 7.000', 'R$ 6.000', 'R$ 8.235', 'R$ 1.735']) {
      await expect(faturamento).not.toContainText(proibido);
    }

    // Resultado = recebimentos − despesas operacionais (R$ 734,56 → R$ 735).
    const lucro = goalCard(page, 'Resultado do mês');
    await expect(lucro.getByText('Resultado operacional de caixa', { exact: true })).toBeVisible();
    await expect(lucro).toContainText('R$ 735');

    await goalHeading(page, 'Faturar no mês').click();
    await expect(page.getByRole('heading', { name: 'Faturar no mês', level: 1 })).toBeVisible();
    await expect(page.getByText('R$ 1.234,56', { exact: true })).toBeVisible();
    await expect(page.getByText('R$ 2.000,00', { exact: true })).toBeVisible();
    await expect(page.getByText(/Empresa\s*•\s*Recebimentos operacionais realizados/)).toBeVisible();
    await expect(page.getByText('Período Vigente')).toBeVisible();

    // O progresso do indicador nunca é persistido na meta.
    const persisted = await goalData(PJ_WS, 'kpi-faturamento');
    for (const campo of ['manualProgressCents', 'investmentProgressCents', 'currentAmountCents']) {
      expect(persisted).not.toHaveProperty(campo);
    }
  });

  test('PJ: margem sem recebimentos mostra a mensagem de indisponível do servidor', async ({ page }) => {
    await seedTenant({ pj: true });
    await seedKpiGoal(PJ_WS, 'kpi-margem', 'Margem do mês', {
      businessType: 'margem', targetBasisPoints: 2_000,
    });

    await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
      `lastWorkspaceId_${OWNER.uid}`, PJ_WS,
    ]);
    await login(page, OWNER.email);
    await openGoals(page, 'Metas Empresariais');

    const card = goalCard(page, 'Margem do mês');
    await expect(card).toBeVisible();
    await expect(card.getByText('Margem operacional de caixa', { exact: true })).toBeVisible();
    await expect(card).toContainText('Sem recebimentos operacionais no período: a margem não pode ser calculada.');
    // Meta de margem tem alvo em percentual, não em reais.
    await expect(card).toContainText('20,00%');

    await goalHeading(page, 'Margem do mês').click();
    await expect(page.getByRole('status').filter({
      hasText: 'Sem recebimentos operacionais no período: a margem não pode ser calculada.',
    })).toBeVisible();
    await expect(page.getByText('Regime de caixa; compras no cartão de crédito não entram.')).toBeVisible();
  });

  test('trocar entre PF e PJ mostra só as metas do workspace ativo', async ({ page }) => {
    await seedTenant({ pj: true });
    await seedManualGoal(PF_WS, 'goal-pessoal', 'Meta Pessoal E2E');
    await seedKpiGoal(PJ_WS, 'goal-empresa', 'Meta Empresa E2E', {
      businessType: 'faturamento', targetAmountCents: 500_000,
    });
    await login(page, OWNER.email);

    await openGoals(page);
    await expect(goalHeading(page, 'Meta Pessoal E2E')).toBeVisible();
    await expect(goalHeading(page, 'Meta Empresa E2E')).toHaveCount(0);

    await page.getByText('Olá, Usuário').click();
    await page.getByRole('button', { name: PJ_NAME }).click();
    await expect(page.getByText('Finanças da Empresa')).toBeVisible();
    await openGoals(page, 'Metas Empresariais');
    await expect(goalHeading(page, 'Meta Empresa E2E')).toBeVisible();
    await expect(goalHeading(page, 'Meta Pessoal E2E')).toHaveCount(0);

    await page.getByText('Olá, Usuário').click();
    await page.getByRole('button', { name: 'Pessoal', exact: true }).click();
    await openGoals(page);
    await expect(goalHeading(page, 'Meta Pessoal E2E')).toBeVisible();
    await expect(goalHeading(page, 'Meta Empresa E2E')).toHaveCount(0);
  });

  test('viewer vê lista e detalhe, mas não altera status nem atualiza o valor acumulado', async ({ page }) => {
    await seedTenant({ viewer: true });
    await seedManualGoal(PF_WS, 'goal-viewer', 'Meta do Viewer');
    await login(page, VIEWER.email);
    await openGoal(page, 'Meta do Viewer');

    await expect(page.getByText(/R\$\s*500,00\s*\/\s*R\$\s*10\.000,00/)).toBeVisible();
    await expect(page.getByText(/Atualizado em \d{2}\/\d{2}\/\d{4}/)).toBeVisible();
    // Somente leitura: sem o botão de atualizar o valor acumulado.
    await expect(page.getByRole('button', { name: 'Atualizar valor acumulado' })).toHaveCount(0);
    // O histórico de atualizações é só de owner/admin.
    await expect(page.getByRole('list', { name: 'Histórico de atualizações do valor acumulado' })).toHaveCount(0);

    await statusButton(page, 'Pausar').click();
    const banner = page.getByRole('alert').filter({ hasText: 'Seu papel neste espaço de trabalho não permite esta operação.' });
    await expect(banner).toBeVisible();
    await expect(statusButton(page, 'Em Andamento')).toHaveAttribute('aria-pressed', 'true');
    const persisted = await goalData(PF_WS, 'goal-viewer');
    expect(persisted?.status).toBe('em_andamento');
    expect(persisted?.revision).toBe(1);
  });

  test('workspace sem metas mostra o estado vazio', async ({ page }) => {
    await seedTenant();
    await login(page, OWNER.email);
    await openGoals(page);

    await expect(page.getByText('Nenhuma meta encontrada.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Criar minha primeira meta' })).toBeVisible();
    await expect(totalGoalsCounter(page)).toHaveText('0');
    await expect(page.getByRole('button', { name: 'Carregar mais metas' })).toHaveCount(0);
    expect((await firestore().collection(`workspaces/${PF_WS}/goals`).get()).size).toBe(0);
  });

  test('formulário desatualizado: outra sessão alterou a meta e o salvamento pede para recarregar', async ({ page }) => {
    await seedTenant();
    await seedManualGoal(PF_WS, 'goal-stale', 'Meta Desatualizada');
    await login(page, OWNER.email);
    await openGoal(page, 'Meta Desatualizada');

    await page.getByRole('button', { name: 'Editar meta' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Editar Meta' })).toBeVisible();
    await expect(dialog.getByLabel('Nome da Meta')).toHaveValue('Meta Desatualizada');

    // Outra sessão edita a meta depois que o formulário abriu.
    await goalRef(PF_WS, 'goal-stale').update({ revision: 2, name: 'Meta da Outra Sessão' });

    await dialog.getByLabel('Nome da Meta').fill('Minha Edição Antiga');
    await dialog.getByRole('button', { name: 'Salvar Alterações' }).click();

    const alert = dialog.getByRole('alert');
    await expect(alert).toContainText('A meta foi alterada desde que você a abriu');
    await expect(alert).toContainText('Recarregue');
    // A edição desatualizada não foi aplicada.
    const persisted = await goalData(PF_WS, 'goal-stale');
    expect(persisted?.name).toBe('Meta da Outra Sessão');
    expect(persisted?.revision).toBe(2);
  });
});
