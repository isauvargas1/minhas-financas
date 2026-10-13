import { expect, test, type Locator, type Page } from '@playwright/test';

import { adminSdk, seedOwnedWorkspace } from './support/workspaceSeed';

/**
 * P5-B.1 — metas de investimento além da centésima.
 *
 * O seletor de metas do aporte carregava no máximo 100 metas (4 páginas) e
 * parava: a 101ª em diante não podia ser vinculada, e uma posição ligada a ela
 * aparecia como "Meta removida" e caía em "Sem Meta Definida". Agora o seletor
 * pagina por cursor ("Carregar mais metas"), sem teto e sem carregar tudo, e as
 * metas referenciadas por posições são resolvidas por ID.
 *
 * Aqui, com 205 metas de investimento ativas, o usuário vincula aportes à
 * 101ª, à 125ª e à 201ª; os movimentos saem com o `goalId` certo e, depois de
 * recarregar (só a 1ª página em cache), os cards e o filtro nomeiam as metas.
 */
test.use({ timezoneId: 'America/Sao_Paulo' });

const PASSWORD = 'e2e-goal-options-password';
const OWNER = { uid: 'e2e-goal-options-owner', email: 'e2e-goal-options-owner@minhas-financas.local' };
const WORKSPACE = 'e2e-goal-options-ws';
const GOAL_COUNT = 205;

const goalId = (index: number) => `goal-${String(index).padStart(3, '0')}`;
const goalName = (index: number) => `Meta ${String(index).padStart(3, '0')}`;

const catalogEntry = (
  id: string, group: string, name: string, normalizedName: string, transactionSubtype?: string,
) => ({
  id,
  workspaceId: WORKSPACE,
  group,
  name,
  normalizedName,
  ...(transactionSubtype ? { transactionSubtype } : {}),
  dedupeKey: `${group}::${transactionSubtype ?? 'all'}::both::${normalizedName}`,
  workspaceScope: 'both',
  sortOrder: 1,
  status: 'active',
  createdBy: OWNER.uid,
  updatedBy: OWNER.uid,
});

const seed = async () => {
  const sdk = adminSdk();
  const db = sdk.firestore();
  await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE}`));
  try {
    await sdk.auth().deleteUser(OWNER.uid);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  await sdk.auth().createUser({ uid: OWNER.uid, email: OWNER.email, password: PASSWORD, emailVerified: true });
  await seedOwnedWorkspace({
    uid: OWNER.uid, email: OWNER.email, workspaceId: WORKSPACE, name: 'Metas em Escala', type: 'PF',
  });
  const now = sdk.firestore.Timestamp.now();
  const stamps = { createdAt: now, updatedAt: now };
  await Promise.all([
    db.doc(`workspaces/${WORKSPACE}/settings_catalog/opt-class`).set({
      ...catalogEntry('opt-class', 'investment_class', 'Reserva de emergência', 'reserva de emergencia'), ...stamps,
    }),
    db.doc(`workspaces/${WORKSPACE}/settings_catalog/opt-institution`).set({
      ...catalogEntry('opt-institution', 'investment_institution', 'BTG', 'btg'), ...stamps,
    }),
    db.doc(`workspaces/${WORKSPACE}/settings_catalog/opt-category`).set({
      ...catalogEntry('opt-category', 'category', 'Renda fixa', 'renda fixa', 'investimento'), ...stamps,
    }),
  ]);
  // Metas de investimento no formato autoritativo (o que `createGoal` grava).
  const batch = db.batch();
  for (let index = 1; index <= GOAL_COUNT; index += 1) {
    batch.set(db.doc(`workspaces/${WORKSPACE}/goals/${goalId(index)}`), {
      workspaceId: WORKSPACE,
      name: goalName(index),
      category: 'patrimonio',
      priority: 'media',
      priorityRank: 2,
      status: 'em_andamento',
      startDate: '2026-01-01',
      deadline: '2027-12-31',
      horizon: 'medio',
      progressSource: 'investment',
      progressBasis: 'net_contributions',
      targetAmountCents: 1_000_000,
      investmentNetContributionCents: 0,
      investmentCurrentValueCents: 0,
      investmentProgressCents: 0,
      archived: false,
      revision: 1,
      visual: { color: '#6366f1', icon: 'Target', progressBarType: 'linear' },
      createdBy: OWNER.uid,
      updatedBy: OWNER.uid,
      createdAt: now,
      updatedAt: now,
      statusUpdatedAt: now,
    });
  }
  await batch.commit();
};

const openInvestments = async (page: Page) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(OWNER.email)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
  await page.getByText('Investimentos', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Investimentos', exact: true })).toBeVisible();
};

/** Pede páginas ao seletor até a meta aparecer como opção; devolve quantas foram pedidas. */
const loadUntilOption = async (dialog: Locator, name: string): Promise<number> => {
  const select = dialog.getByLabel('Meta (opcional)');
  let clicks = 0;
  while ((await select.locator('option', { hasText: name }).count()) === 0) {
    const more = dialog.getByRole('button', { name: 'Carregar mais metas' });
    await expect(more, `${name}: o seletor parou antes de chegar à meta`).toBeEnabled();
    const before = await select.locator('option').count();
    await more.click();
    clicks += 1;
    // Espera a página pedida chegar antes de decidir se precisa de outra.
    await expect.poll(() => select.locator('option').count(), `${name}: página ${clicks} não chegou`)
      .toBeGreaterThan(before);
    expect(clicks, `${name}: paginação não termina`).toBeLessThan(20);
  }
  return clicks;
};

const contributeTo = async (page: Page, index: number, description: string) => {
  await page.getByRole('button', { name: 'Novo investimento' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const select = dialog.getByLabel('Meta (opcional)');
  await loadUntilOption(dialog, goalName(index));
  await select.selectOption({ label: goalName(index) });
  await expect(select).toHaveValue(goalId(index));
  await dialog.getByLabel('Carteira de investimentos').selectOption({ label: 'Reserva de emergência' });
  await dialog.getByLabel('Instituição').selectOption({ label: 'BTG' });
  await dialog.getByLabel('Descrição').fill(description);
  await dialog.getByLabel('Categoria').selectOption({ label: 'Renda fixa' });
  await dialog.getByLabel('Valor do investimento').fill('50000');
  // A meta escolhida continua selecionada depois de preencher o resto.
  await expect(select).toHaveValue(goalId(index));
  await dialog.getByRole('radio', { name: 'Sim' }).check();
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog).toHaveCount(0);
};

const movementsOf = async (goal: string) => {
  const snapshot = await adminSdk().firestore()
    .collection(`workspaces/${WORKSPACE}/investment_movements`)
    .where('goalId', '==', goal).get();
  return snapshot.docs.map((entry) => entry.data())
    .filter((movement) => movement.operation === 'contribution');
};

test.describe('P5-B.1 — metas de investimento além da centésima', () => {
  test.beforeEach(seed);

  test('o seletor pagina sem teto: aportes vinculados à 101ª, à 125ª e à 201ª meta', async ({ page }) => {
    await openInvestments(page);

    // Primeira página: 25 metas e o convite para carregar mais (nada além disso é lido).
    await page.getByRole('button', { name: 'Novo investimento' }).click();
    const first = page.getByRole('dialog');
    const select = first.getByLabel('Meta (opcional)');
    await expect(select.locator('option', { hasText: goalName(25) })).toHaveCount(1);
    await expect(select.locator('option', { hasText: goalName(26) })).toHaveCount(0);
    await expect(first.getByText('Mostrando 25 metas; carregue mais para ver as demais.')).toBeVisible();
    // A 101ª exige 4 páginas a mais (o antigo teto de 100 parava aqui).
    expect(await loadUntilOption(first, goalName(101))).toBe(4);
    // Depois da última página o botão some: 205 metas, todas alcançáveis.
    await loadUntilOption(first, goalName(GOAL_COUNT));
    await expect(first.getByRole('button', { name: 'Carregar mais metas' })).toHaveCount(0);
    await expect(select.locator('option')).toHaveCount(GOAL_COUNT + 1);
    await first.getByRole('button', { name: 'Fechar' }).click();
    await expect(first).toHaveCount(0);

    await contributeTo(page, 101, 'Aporte meta 101');
    await contributeTo(page, 125, 'Aporte meta 125');
    await contributeTo(page, 201, 'Aporte meta 201');

    for (const [index, description] of [[101, 'Aporte meta 101'], [125, 'Aporte meta 125'], [201, 'Aporte meta 201']] as const) {
      await expect.poll(async () => (await movementsOf(goalId(index))).length, `${description}`).toBe(1);
      const [movement] = await movementsOf(goalId(index));
      expect(movement.description).toBe(description);
      expect(movement.principalCents).toBe(50_000);
      expect(movement.status).toBe('settled');
    }
  });

  test('posição de meta fora da 1ª página é nomeada por ID no card e no filtro', async ({ page }) => {
    await openInvestments(page);
    await contributeTo(page, 150, 'Aporte meta 150');
    await expect.poll(async () => (await movementsOf(goalId(150))).length).toBe(1);

    // Recarregar zera o cache: só a 1ª página do seletor (metas 001–025) é lida.
    await page.reload();
    await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
    await page.getByText('Investimentos', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Investimentos', exact: true })).toBeVisible();

    // O card da alocação usa o nome resolvido por ID, não "Sem Meta Definida".
    await expect(page.getByText(goalName(150), { exact: true }).first()).toBeVisible();
    const filter = page.locator('#simple-filter-goal');
    await expect(filter.locator('option', { hasText: goalName(150) })).toHaveCount(1);
    await expect(filter.locator('option', { hasText: 'Meta removida' })).toHaveCount(0);
  });
});
