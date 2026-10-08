import { expect, test, type Page, type Request } from '@playwright/test';

import { callCallable, emulatorIdToken } from './support/callables';
import {
  adminSdk,
  defaultCashAccountIdFor,
  removeTransactionsQuotaAnchor,
  saoPauloMonthKey,
  seedAccountProfile,
  seedMembership,
  seedOwnedWorkspace,
  seedTransactionsQuotaUsage,
  transactionsQuotaMonthPath,
} from './support/workspaceSeed';

/**
 * P3-E — caixa manual pela interface, de ponta a ponta no Emulator (Auth,
 * Firestore e Functions reais).
 *
 * O formulário de receita/despesa confirmada passou a criar, corrigir e anular
 * pelas callables autoritativas. Aqui se prova pela tela, com o backend real:
 *
 * 1. criação: centavos exatos, um envio por intenção (duplo envio vira um
 *    lançamento), resultado incerto reenviado com a mesma chave sem duplicar,
 *    quota +1 uma única vez; despesa pendente também passa pela callable
 *    (P3-F, D-29): estado pendente, sem mover o caixa, consumindo a quota na
 *    criação;
 * 2. correção com motivo e versão completa (nanossegundos); conflito quando
 *    outra operação mudou o lançamento; anulação com justificativa que tira o
 *    lançamento da tela e mantém o histórico;
 * 3. quota do backend: esgotada desabilita a criação com orientação distinta
 *    para titular e membro (e o backend recusa de qualquer forma); espaço sem
 *    contador inicializado não bloqueia a tela, mas o backend falha fechado;
 *    a troca de espaço não vaza lançamentos;
 * 4. perda de acesso entre abrir o formulário e salvar: recusa em pt-BR.
 *
 * O fuso do navegador é o de São Paulo, o mesmo do backend: "hoje" na tela é
 * "hoje" no servidor, a qualquer hora do dia.
 */

test.use({ timezoneId: 'America/Sao_Paulo' });

const PASSWORD = 'e2e-password-123456';
const OWNER = { uid: 'e2e-p3e-owner', email: 'e2e-p3e-owner@minhas-financas.local' };
const MEMBER = { uid: 'e2e-p3e-member', email: 'e2e-p3e-member@minhas-financas.local' };
const WS_MAIN = { id: 'e2e-p3e-main', name: 'Caixa Principal E2E' };
const WS_OTHER = { id: 'e2e-p3e-other', name: 'Caixa Secundário E2E' };
const FREE_MONTHLY_LIMIT = 50;

const CATALOG = {
  incomeType: 'Salário Fixo E2E',
  incomeCategory: 'Salário E2E',
  expenseType: 'Fixa E2E',
  expenseCategory: 'Moradia E2E',
  paymentMethod: 'Pix E2E',
  product: 'Aluguel E2E',
};

const db = () => adminSdk().firestore();

const saoPauloToday = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const resetEmulatorData = async () => {
  const sdk = adminSdk();
  const users = await sdk.auth().listUsers(1000);
  if (users.users.length > 0) {
    await sdk.auth().deleteUsers(users.users.map((user) => user.uid));
  }
  const collections = await sdk.firestore().listCollections();
  await Promise.all(collections.map((collection) => sdk.firestore().recursiveDelete(collection)));
};

const normalize = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

const seedCatalog = async (workspaceId: string) => {
  const now = new Date();
  const items: Array<[string, string, string, string?]> = [
    ['p3e-income-type', 'income_type', CATALOG.incomeType],
    ['p3e-income-category', 'category', CATALOG.incomeCategory, 'receita'],
    ['p3e-expense-type', 'expense_type', CATALOG.expenseType],
    ['p3e-expense-category', 'category', CATALOG.expenseCategory, 'despesa'],
    ['p3e-payment', 'payment_method', CATALOG.paymentMethod],
    ['p3e-product', 'product_service', CATALOG.product],
  ];
  await Promise.all(items.map(([id, group, name, transactionSubtype]) => {
    const normalizedName = normalize(name);
    return db().doc(`workspaces/${workspaceId}/settings_catalog/${id}`).set({
      id, workspaceId, group, name, normalizedName,
      ...(transactionSubtype ? { transactionSubtype } : {}),
      dedupeKey: `${group}::${transactionSubtype ?? 'all'}::both::${normalizedName}`,
      workspaceScope: 'both', sortOrder: 1, status: 'active',
      createdBy: OWNER.uid, updatedBy: OWNER.uid, createdAt: now, updatedAt: now,
    });
  }));
};

const seed = async () => {
  await resetEmulatorData();
  await Promise.all([OWNER, MEMBER].map((user) => adminSdk().auth().createUser({
    uid: user.uid, email: user.email, password: PASSWORD, emailVerified: true,
  })));
  // O principal entra primeiro na listagem (ordem por `joinedAt`).
  await seedOwnedWorkspace({
    ...OWNER, workspaceId: WS_MAIN.id, name: WS_MAIN.name, type: 'PF',
    joinedAt: new Date('2026-01-01T12:00:00Z'),
  });
  await seedOwnedWorkspace({
    ...OWNER, workspaceId: WS_OTHER.id, name: WS_OTHER.name, type: 'PF',
    joinedAt: new Date('2026-02-01T12:00:00Z'),
  });
  await seedAccountProfile(MEMBER);
  await seedMembership({
    workspaceId: WS_MAIN.id, uid: MEMBER.uid, email: MEMBER.email, role: 'member',
    name: WS_MAIN.name, type: 'PF',
  });
  await Promise.all([seedCatalog(WS_MAIN.id), seedCatalog(WS_OTHER.id)]);
};

const login = async (page: Page, email: string) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(email)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
};

const transactionsWhere = async (workspaceId: string, description: string) =>
  (await db().collection(`workspaces/${workspaceId}/transactions`)
    .where('description', '==', description).get()).docs;

const quotaUsed = async (workspaceId: string): Promise<number | undefined> =>
  (await db().doc(transactionsQuotaMonthPath(workspaceId, saoPauloMonthKey())).get()).get('used');

const isCallablePost = (request: Request, name: string) =>
  request.method() === 'POST' && request.url().endsWith(`/${name}`);

const callableBody = (request: Request): Record<string, unknown> =>
  (JSON.parse(request.postData() ?? '{}') as { data: Record<string, unknown> }).data;

const transactionDialog = (page: Page) =>
  page.getByRole('dialog').filter({ has: page.locator('#transaction-modal-title') });

const fillIncome = async (page: Page, description: string, amount: string) => {
  const form = transactionDialog(page).locator('form');
  await expect(form.locator('select').nth(1)).toContainText(CATALOG.incomeCategory, { timeout: 20_000 });
  await form.locator('select').nth(0).selectOption({ label: CATALOG.incomeType });
  await form.locator('select').nth(1).selectOption({ label: CATALOG.incomeCategory });
  await form.locator('input[type="number"]').fill(amount);
  await form.getByPlaceholder('Ex: Cliente XYZ, Reembolso Empresa...').fill(description);
  await form.locator('input[type="date"]').fill(saoPauloToday());
  return form;
};

const openNewTransaction = async (page: Page) => {
  await page.getByRole('button', { name: /Nova Transação/i }).first().click();
  await expect(transactionDialog(page)).toBeVisible();
};

/** Lançamento confirmado criado pelo backend real, como outra sessão faria. */
const createIncomeThroughBackend = async (
  request: Parameters<typeof emulatorIdToken>[0],
  description: string,
  amountCents: number,
) => {
  const token = await emulatorIdToken(request, OWNER.email, PASSWORD);
  const outcome = await callCallable(request, token, 'createCashTransaction', {
    workspaceId: WS_MAIN.id,
    idempotencyKey: `e2e-p3e-${description.replace(/\W+/g, '-')}`,
    cashAccountId: defaultCashAccountIdFor(WS_MAIN.id),
    type: 'receita',
    description,
    category: CATALOG.incomeCategory,
    incomeType: CATALOG.incomeType,
    amountCents,
    date: saoPauloToday(),
  });
  expect(outcome.status, JSON.stringify(outcome)).toBe(200);
  return { token, transactionId: String(outcome.result?.transactionId) };
};

const openIncomeList = async (page: Page) => {
  await page.getByRole('button', { name: /^Receitas\s+R\$/i }).click();
  await expect(page.getByRole('button', { name: /Nova Transação/i }).first()).toBeVisible();
};

const rowOf = (page: Page, description: string) =>
  page.locator('tr').filter({ hasText: description });

test.beforeEach(async () => {
  await seed();
});

test('criação confirmada passa pela callable: duplo envio e reenvio incerto não duplicam', async ({ page }) => {
  await login(page, OWNER.email);
  const posts: Request[] = [];
  page.on('request', (request) => {
    if (isCallablePost(request, 'createCashTransaction')) posts.push(request);
  });

  // 1. Duplo envio do mesmo formulário: um envio, um lançamento.
  await openNewTransaction(page);
  const form = await fillIncome(page, 'Receita P3-E duplo envio', '1234.56');
  await form.evaluate((element) => {
    const formElement = element as HTMLFormElement;
    formElement.requestSubmit();
    formElement.requestSubmit();
  });
  await expect(transactionDialog(page)).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText('Transação salva!').first()).toBeVisible();
  expect(posts).toHaveLength(1);
  const payload = callableBody(posts[0]);
  expect(payload).toMatchObject({
    workspaceId: WS_MAIN.id, type: 'receita', amountCents: 123456, date: saoPauloToday(),
    description: 'Receita P3-E duplo envio', incomeType: CATALOG.incomeType,
  });
  // Nada de campo vazio, PJ ou legado no contrato estrito.
  for (const key of ['value', 'supplier', 'costCenter', 'isPaid', 'displaySnapshots']) {
    expect(payload).not.toHaveProperty(key);
  }
  const created = await transactionsWhere(WS_MAIN.id, 'Receita P3-E duplo envio');
  expect(created).toHaveLength(1);
  // O ID é o do servidor: nenhum documento local paralelo.
  const response = await posts[0].response();
  expect((await response?.json())?.result?.transactionId).toBe(created[0].id);
  expect(created[0].get('valueCents')).toBe(123456);
  expect(created[0].get('cashEntry')).toMatchObject({ origin: 'manual', status: 'confirmed' });
  expect(await quotaUsed(WS_MAIN.id)).toBe(1);

  // 2. Resultado incerto: o servidor grava, a resposta se perde. O reenvio do
  //    mesmo conteúdo usa a mesma chave e não duplica nem consome de novo.
  let dropped = false;
  await page.route('**/createCashTransaction', async (route) => {
    if (route.request().method() !== 'POST' || dropped) {
      await route.continue();
      return;
    }
    dropped = true;
    await route.fetch();
    await route.abort('connectionreset');
  });
  await openNewTransaction(page);
  await fillIncome(page, 'Receita P3-E incerta', '10.05');
  const submit = transactionDialog(page).getByRole('button', { name: /Revisar e Adicionar Receita/i });
  await submit.click();
  await expect(transactionDialog(page).getByRole('alert'))
    .toHaveText(/Não foi possível confirmar a operação.*não duplica/);
  await expect(transactionDialog(page)).toBeVisible();
  expect(await transactionsWhere(WS_MAIN.id, 'Receita P3-E incerta')).toHaveLength(1);
  await submit.click();
  await expect(transactionDialog(page)).toBeHidden({ timeout: 30_000 });
  expect(posts).toHaveLength(3);
  expect(callableBody(posts[2]).idempotencyKey).toBe(callableBody(posts[1]).idempotencyKey);
  expect(callableBody(posts[1]).idempotencyKey).not.toBe(callableBody(posts[0]).idempotencyKey);
  const uncertain = await transactionsWhere(WS_MAIN.id, 'Receita P3-E incerta');
  expect(uncertain).toHaveLength(1);
  expect(uncertain[0].get('valueCents')).toBe(1005);
  expect(await quotaUsed(WS_MAIN.id)).toBe(2);

  // 3. Despesa pendente (P3-F, D-29): pela callable, com estado pendente e o
  //    vencimento; consome a quota na criação.
  await openNewTransaction(page);
  const dialog = transactionDialog(page);
  await dialog.getByRole('button', { name: /^Despesa$/ }).click();
  const expenseForm = dialog.locator('form');
  await expect(expenseForm.locator('select').nth(1)).toContainText(CATALOG.expenseCategory, { timeout: 20_000 });
  await expenseForm.locator('select').nth(0).selectOption({ label: CATALOG.expenseType });
  await expenseForm.locator('select').nth(1).selectOption({ label: CATALOG.expenseCategory });
  await expenseForm.getByPlaceholder('Ex: Conta de Luz, Manutenção...').fill(CATALOG.product);
  await expenseForm.locator('input[type="number"]').fill('200');
  await expenseForm.locator('select').nth(2).selectOption({ label: CATALOG.paymentMethod });
  await expenseForm.getByLabel('Não', { exact: true }).check();
  await expenseForm.locator('input[type="date"]').fill(saoPauloToday());
  await dialog.getByRole('button', { name: /Revisar e Adicionar Despesa/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect.poll(async () => (await transactionsWhere(WS_MAIN.id, CATALOG.product)).length).toBe(1);
  const pending = (await transactionsWhere(WS_MAIN.id, CATALOG.product))[0];
  expect(pending.get('isPaid')).toBe(false);
  expect(pending.get('dueDate')).toBe(saoPauloToday());
  expect(pending.get('cashEntry')).toMatchObject({ origin: 'manual', status: 'pending' });
  expect(posts).toHaveLength(4);
  expect(callableBody(posts[3])).toMatchObject({ status: 'pending', dueDate: saoPauloToday() });
  expect(callableBody(posts[3])).not.toHaveProperty('date');
  expect(await quotaUsed(WS_MAIN.id)).toBe(3);
});

test('correção leva motivo e versão completa; conflito orienta; anulação sai da tela', async ({ page, request }) => {
  const { token, transactionId } = await createIncomeThroughBackend(request, 'Receita P3-E corrigir', 10_000);
  const entryRef = db().doc(`workspaces/${WS_MAIN.id}/transactions/${transactionId}`);

  await login(page, OWNER.email);
  await openIncomeList(page);
  await rowOf(page, 'Receita P3-E corrigir').getByRole('button', { name: 'Editar' }).click();
  const dialog = transactionDialog(page);
  await expect(dialog.getByRole('heading', { name: 'Editar Transação' })).toBeVisible();
  const reason = dialog.getByLabel(/Motivo da correção/);
  await expect(reason).toBeVisible();

  // Outra operação corrige o lançamento depois que o formulário abriu.
  const before = await entryRef.get();
  const concurrent = await callCallable(request, token, 'updateCashTransaction', {
    workspaceId: WS_MAIN.id,
    idempotencyKey: 'e2e-p3e-concorrente',
    transactionId,
    expectedUpdatedAt: before.get('updatedAt').toDate().toISOString().replace(
      /\.\d{3}Z$/,
      `.${String(before.get('updatedAt').nanoseconds).padStart(9, '0')}Z`,
    ),
    reason: 'Correção concorrente',
    entry: {
      type: 'receita', description: 'Receita P3-E corrigir', category: CATALOG.incomeCategory,
      incomeType: CATALOG.incomeType, amountCents: 11_000, date: saoPauloToday(),
      cashAccountId: defaultCashAccountIdFor(WS_MAIN.id),
    },
  });
  expect(concurrent.status, JSON.stringify(concurrent)).toBe(200);

  const form = dialog.locator('form');
  await form.locator('input[type="number"]').fill('150.25');
  await reason.fill('Valor digitado errado');
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/alterado por outra operação/);
  expect((await entryRef.get()).get('valueCents')).toBe(11_000);

  // Com a versão atual, a correção passa e leva o `updatedAt` com
  // nanossegundos (com a precisão do `Date` ela seria sempre conflito).
  await page.reload();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
  await openIncomeList(page);
  const updates: Request[] = [];
  page.on('request', (sent) => {
    if (isCallablePost(sent, 'updateCashTransaction')) updates.push(sent);
  });
  await rowOf(page, 'Receita P3-E corrigir').getByRole('button', { name: 'Editar' }).click();
  await dialog.locator('form input[type="number"]').fill('150.25');
  // Sem motivo o formulário não sai (D-35).
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click();
  expect(updates).toHaveLength(0);
  await dialog.getByLabel(/Motivo da correção/).fill('Valor digitado errado');
  await dialog.getByRole('button', { name: 'Salvar Alterações' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText('Atualizado!').first()).toBeVisible();
  expect(updates).toHaveLength(1);
  const updateBody = callableBody(updates[0]);
  expect(updateBody.expectedUpdatedAt).toMatch(/\.\d{9}Z$/);
  expect(updateBody).toMatchObject({ transactionId, reason: 'Valor digitado errado' });
  expect((await entryRef.get()).get('valueCents')).toBe(15_025);
  const updatedEvents = await db().collection(`workspaces/${WS_MAIN.id}/cash_events`)
    .where('transactionId', '==', transactionId).where('operation', '==', 'cash_entry.updated').get();
  expect(updatedEvents.docs.map((event) => event.get('reason')).sort())
    .toEqual(['Correção concorrente', 'Valor digitado errado']);

  // Anulação: confirmação com justificativa; sai da tela depois da resposta.
  await rowOf(page, 'Receita P3-E corrigir').getByRole('button', { name: 'Deletar' }).click();
  const voidDialog = page.getByRole('dialog').filter({ hasText: 'Anular lançamento' });
  const confirm = voidDialog.getByRole('button', { name: 'Confirmar anulação' });
  await expect(confirm).toBeDisabled();
  await voidDialog.getByLabel('Motivo da anulação').fill('Lançado em duplicidade');
  await confirm.click();
  // O aviso de sucesso é efêmero (3 s, compartilhado com o aviso anterior):
  // a prova é o estado — o diálogo fecha só depois da resposta do servidor e
  // a linha sai da lista recarregada.
  await expect(voidDialog).toBeHidden({ timeout: 30_000 });
  await expect(rowOf(page, 'Receita P3-E corrigir')).toHaveCount(0);
  const voided = await entryRef.get();
  expect(voided.exists).toBe(true);
  expect(voided.get('voidedAt')).toBeTruthy();
  expect(voided.get('voidReason')).toBe('Lançado em duplicidade');
  expect(voided.get('cashEntry')).toMatchObject({ status: 'voided' });
});

const switchToSecondPersonalWorkspace = async (page: Page) => {
  // O menu da conta rotula todo espaço PF como "Pessoal", na ordem da
  // listagem (`joinedAt`): o segundo é o secundário.
  await page.getByRole('button', { name: 'Abrir menu da conta' }).click();
  await page.getByRole('button', { name: 'Pessoal', exact: true }).nth(1).click();
  await expect.poll(() => page.evaluate(
    (uid) => localStorage.getItem(`lastWorkspaceId_${uid}`), OWNER.uid,
  )).toBe(WS_OTHER.id);
};

test('quota esgotada: titular orientado ao upgrade e backend recusa mesmo assim', async ({ page, request }) => {
  await seedTransactionsQuotaUsage(WS_MAIN.id, FREE_MONTHLY_LIMIT);
  await login(page, OWNER.email);
  await expect(page.getByRole('button', { name: /Nova Transação/i }).first())
    .toBeDisabled({ timeout: 20_000 });
  await expect(page.getByText('Limite mensal atingido.').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Upgrade!' }).first()).toBeVisible();

  // A tela é só orientação: o backend recusa de qualquer forma.
  const token = await emulatorIdToken(request, OWNER.email, PASSWORD);
  const view = await callCallable(request, token, 'getWorkspaceEntitlement', { workspaceId: WS_MAIN.id });
  expect(view.result?.transactionsQuota).toMatchObject({
    status: 'available', periodKey: saoPauloMonthKey(), limit: FREE_MONTHLY_LIMIT,
    used: FREE_MONTHLY_LIMIT, remaining: 0, exhausted: true,
  });
  const refused = await callCallable(request, token, 'createCashTransaction', {
    workspaceId: WS_MAIN.id, idempotencyKey: 'e2e-p3e-quota-esgotada', type: 'receita',
    cashAccountId: defaultCashAccountIdFor(WS_MAIN.id),
    description: 'Além do limite', category: CATALOG.incomeCategory, amountCents: 100,
    date: saoPauloToday(),
  });
  expect(refused.errorStatus).toBe('RESOURCE_EXHAUSTED');
  expect(refused.errorMessage).toMatch(/Faça upgrade em Meu Plano/);
  expect(await transactionsWhere(WS_MAIN.id, 'Além do limite')).toHaveLength(0);
  expect(await quotaUsed(WS_MAIN.id)).toBe(FREE_MONTHLY_LIMIT);
});

test('quota esgotada para membro: orientação ao titular, sem o uso exato', async ({ page, request }) => {
  await seedTransactionsQuotaUsage(WS_MAIN.id, FREE_MONTHLY_LIMIT);
  await login(page, MEMBER.email);
  await expect(page.getByRole('button', { name: /Nova Transação/i }).first())
    .toBeDisabled({ timeout: 20_000 });
  await expect(page.getByText(/Peça ao titular do espaço\./).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Upgrade!' })).toHaveCount(0);

  const token = await emulatorIdToken(request, MEMBER.email, PASSWORD);
  const view = await callCallable(request, token, 'getWorkspaceEntitlement', { workspaceId: WS_MAIN.id });
  expect(view.result?.transactionsQuota).toMatchObject({
    status: 'available', limit: FREE_MONTHLY_LIMIT, used: null, remaining: null, exhausted: true,
  });
  const refused = await callCallable(request, token, 'createCashTransaction', {
    workspaceId: WS_MAIN.id, idempotencyKey: 'e2e-p3e-quota-membro', type: 'receita',
    cashAccountId: defaultCashAccountIdFor(WS_MAIN.id),
    description: 'Além do limite (membro)', category: CATALOG.incomeCategory, amountCents: 100,
    date: saoPauloToday(),
  });
  expect(refused.errorStatus).toBe('RESOURCE_EXHAUSTED');
  expect(refused.errorMessage).toMatch(/Fale com o titular do espaço/);
});

test('espaço sem contador: tela não bloqueia, backend falha fechado e a troca não vaza lançamentos', async ({ page, request }) => {
  await createIncomeThroughBackend(request, 'Receita só do principal', 7_700);
  await removeTransactionsQuotaAnchor(WS_OTHER.id);
  await login(page, OWNER.email);
  await expect(page.getByText('Receita só do principal').first()).toBeVisible({ timeout: 30_000 });

  await switchToSecondPersonalWorkspace(page);
  await expect(page.getByText('Receita só do principal')).toHaveCount(0, { timeout: 20_000 });
  // Estado desconhecido não é zero nem bloqueio na tela.
  await expect(page.getByRole('button', { name: /Nova Transação/i }).first()).toBeEnabled();
  await expect(page.getByText('Limite mensal atingido.')).toHaveCount(0);
  const token = await emulatorIdToken(request, OWNER.email, PASSWORD);
  const view = await callCallable(request, token, 'getWorkspaceEntitlement', { workspaceId: WS_OTHER.id });
  expect(view.result?.transactionsQuota).toMatchObject({
    status: 'not_initialized', used: null, remaining: null, exhausted: null,
  });

  // A criação pela tela chega ao backend, que falha fechado sem a âncora.
  await openNewTransaction(page);
  await fillIncome(page, 'Receita sem contador', '25.00');
  await transactionDialog(page).getByRole('button', { name: /Revisar e Adicionar Receita/i }).click();
  await expect(transactionDialog(page).getByRole('alert'))
    .toHaveText('Não foi possível verificar os limites do plano. Tente novamente em instantes.');
  expect(await transactionsWhere(WS_OTHER.id, 'Receita sem contador')).toHaveLength(0);
  expect(await transactionsWhere(WS_MAIN.id, 'Receita sem contador')).toHaveLength(0);
});

test('perda de acesso entre abrir o formulário e salvar é recusada em pt-BR', async ({ page }) => {
  await login(page, MEMBER.email);
  await openNewTransaction(page);
  await fillIncome(page, 'Receita após remoção', '42.00');

  // O titular remove o membro antes do envio. A membership é a única fonte
  // de papel no servidor (P1); é ela que a autorização relê.
  await db().doc(`workspaces/${WS_MAIN.id}/members/${MEMBER.uid}`).update({
    status: 'removed', removedAt: new Date(), removedBy: OWNER.uid, updatedAt: new Date(),
  });

  await transactionDialog(page)
    .getByRole('button', { name: /Revisar e Adicionar Receita/i }).click();
  await expect(transactionDialog(page).getByRole('alert'))
    .toHaveText('Você não tem acesso a este espaço de trabalho.', { timeout: 30_000 });
  expect(await transactionsWhere(WS_MAIN.id, 'Receita após remoção')).toHaveLength(0);
  expect(await quotaUsed(WS_MAIN.id)).toBeUndefined();
});
