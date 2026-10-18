import { expect, test, type Page, type Request } from '@playwright/test';

import { callCallable, emulatorIdToken } from './support/callables';
import {
  adminSdk,
  defaultCashAccountIdFor,
  saoPauloMonthKey,
  seedOwnedWorkspace,
  transactionsQuotaMonthPath,
} from './support/workspaceSeed';

/**
 * P3-F — D-29 pela interface, de ponta a ponta no Emulator (Auth, Firestore
 * e Functions reais).
 *
 * 1. Receita a receber, receita agendada e despesa a pagar, criadas pela
 *    tela, ficam pendentes: nenhum crédito ou débito no caixa realizado, uma
 *    unidade de quota cada. (Vencido e virada de mês: suíte de integração.)
 * 2. Confirmar pela edição: a data do formulário vira a data efetiva, o valor
 *    liquidado é gravado, o vencimento fica preservado, a quota não muda, e
 *    o dashboard passa a mostrar a saída.
 * 3. Recusas locais em pt-BR, sem chamar o backend: confirmação com mudança
 *    descritiva e lançamento pago com data futura.
 *
 * Fuso do navegador = São Paulo, o mesmo do backend.
 */

test.use({ timezoneId: 'America/Sao_Paulo' });

const PASSWORD = 'e2e-password-123456';
const OWNER = { uid: 'e2e-p3f-owner', email: 'e2e-p3f-owner@minhas-financas.local' };
const WS = { id: 'e2e-p3f-main', name: 'Caixa Pendentes E2E' };

const CATALOG = {
  incomeType: 'Serviço E2E',
  incomeCategory: 'Consultoria E2E',
  expenseType: 'Fixa E2E',
  expenseCategory: 'Moradia E2E',
  otherExpenseCategory: 'Lazer E2E',
  paymentMethod: 'Boleto E2E',
  otherPaymentMethod: 'Pix E2E',
  product: 'Condomínio E2E',
};

const db = () => adminSdk().firestore();

const dayKey = (offsetDays = 0): string => {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
};
const today = () => dayKey(0);
const brDate = (key: string) => key.split('-').reverse().join('/');

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

const seed = async () => {
  await resetEmulatorData();
  // P5-C1: o Dashboard lê a projeção do caixa; as exclusões da limpeza anterior
  // são processadas depois e, com o mesmo ID, cairiam no teste seguinte.
  WS.id = `e2e-p3f-main-${Date.now().toString(36)}`;
  await adminSdk().auth().createUser({
    uid: OWNER.uid, email: OWNER.email, password: PASSWORD, emailVerified: true,
  });
  await seedOwnedWorkspace({ ...OWNER, workspaceId: WS.id, name: WS.name, type: 'PF' });
  const now = new Date();
  const items: Array<[string, string, string, string?]> = [
    ['p3f-income-type', 'income_type', CATALOG.incomeType],
    ['p3f-income-category', 'category', CATALOG.incomeCategory, 'receita'],
    ['p3f-expense-type', 'expense_type', CATALOG.expenseType],
    ['p3f-expense-category', 'category', CATALOG.expenseCategory, 'despesa'],
    ['p3f-expense-category-2', 'category', CATALOG.otherExpenseCategory, 'despesa'],
    ['p3f-payment', 'payment_method', CATALOG.paymentMethod],
    ['p3f-payment-2', 'payment_method', CATALOG.otherPaymentMethod],
    ['p3f-product', 'product_service', CATALOG.product],
  ];
  await Promise.all(items.map(([id, group, name, transactionSubtype]) => {
    const normalizedName = normalize(name);
    return db().doc(`workspaces/${WS.id}/settings_catalog/${id}`).set({
      id, schemaVersion: 1, workspaceId: WS.id, group, name, normalizedName,
      ...(transactionSubtype ? { transactionSubtype } : {}),
      dedupeKey: `${group}::${transactionSubtype ?? 'all'}::both::${normalizedName}`,
      workspaceScope: 'both', sortOrder: 1, status: 'active',
      createdBy: OWNER.uid, updatedBy: OWNER.uid, createdAt: now, updatedAt: now,
    });
  }));
};

const login = async (page: Page) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(OWNER.email)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual').first()).toBeVisible({ timeout: 45_000 });
};

const transactionDialog = (page: Page) =>
  page.getByRole('dialog').filter({ has: page.locator('#transaction-modal-title') });

const byDescription = async (description: string) =>
  (await db().collection(`workspaces/${WS.id}/transactions`)
    .where('description', '==', description).get()).docs;

const quotaUsed = async (): Promise<number> =>
  Number((await db().doc(transactionsQuotaMonthPath(WS.id, saoPauloMonthKey())).get())
    .get('used') ?? 0);

const callablePosts = (page: Page, name: string): Request[] => {
  const posts: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(`/${name}`)) posts.push(request);
  });
  return posts;
};

const bodyOf = (request: Request): Record<string, unknown> =>
  (JSON.parse(request.postData() ?? '{}') as { data: Record<string, unknown> }).data;

const summaryCard = (page: Page, title: 'Receitas' | 'Despesas') =>
  page.getByRole('button', { name: new RegExp(`^${title}\\s+R\\$`) });

const fillExpense = async (page: Page, input: { amount: string; date: string; paid: boolean }) => {
  const dialog = transactionDialog(page);
  await dialog.getByRole('button', { name: /^Despesa$/ }).click();
  const form = dialog.locator('form');
  await expect(form.locator('select').nth(1)).toContainText(CATALOG.expenseCategory, { timeout: 20_000 });
  await form.locator('select').nth(0).selectOption({ label: CATALOG.expenseType });
  await form.locator('select').nth(1).selectOption({ label: CATALOG.expenseCategory });
  await form.getByPlaceholder('Ex: Conta de Luz, Manutenção...').fill(CATALOG.product);
  await form.locator('input[type="number"]').fill(input.amount);
  await form.locator('select').nth(2).selectOption({ label: CATALOG.paymentMethod });
  await form.getByRole('radiogroup', { name: 'Essa despesa já foi paga?' })
    .getByRole('radio', { name: input.paid ? 'Sim' : 'Não' }).check();
  await form.locator('input[type="date"]').fill(input.date);
  return dialog;
};

test.beforeEach(async () => {
  await seed();
});

const createIncome = async (page: Page, description: string, dueDate: string) => {
  await page.getByRole('button', { name: /Nova Transação/i }).first().click();
  const dialog = transactionDialog(page);
  const form = dialog.locator('form');
  await expect(form.locator('select').nth(1)).toContainText(CATALOG.incomeCategory, { timeout: 20_000 });
  await form.locator('select').nth(0).selectOption({ label: CATALOG.incomeType });
  await form.locator('select').nth(1).selectOption({ label: CATALOG.incomeCategory });
  await form.locator('input[type="number"]').fill('1200');
  await form.getByPlaceholder('Ex: Cliente XYZ, Reembolso Empresa...').fill(description);
  const received = form.getByRole('radiogroup', { name: 'Essa receita já foi recebida?' });
  await received.getByRole('radio', { name: 'Não' }).check();
  await expect(form.getByLabel(/Quando deve ser recebida\?/)).toBeVisible();
  await form.locator('input[type="date"]').fill(dueDate);
  await dialog.getByRole('button', { name: /Revisar e Adicionar Receita/i }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
};

test('pendente e agendado não movem o caixa; confirmar grava data efetiva e preserva o vencimento', async ({ page }) => {
  await login(page);
  const creates = callablePosts(page, 'createCashTransaction');
  const confirms = callablePosts(page, 'confirmCashTransaction');

  // Receita a receber hoje e outra agendada para daqui a 40 dias.
  await createIncome(page, 'Receita P3-F a receber', today());
  await createIncome(page, 'Receita P3-F agendada', dayKey(40));
  expect(bodyOf(creates[0])).toMatchObject({ type: 'receita', status: 'pending', dueDate: today() });
  expect(bodyOf(creates[1])).toMatchObject({ type: 'receita', status: 'pending', dueDate: dayKey(40) });
  for (const description of ['Receita P3-F a receber', 'Receita P3-F agendada']) {
    const [income] = await byDescription(description);
    expect(income.get('isPaid')).toBe(false);
    expect(income.get('cashEntry')).toMatchObject({ status: 'pending' });
  }

  // Despesa a pagar hoje.
  await page.getByRole('button', { name: /Nova Transação/i }).first().click();
  const expenseDialog = await fillExpense(page, { amount: '200', date: today(), paid: false });
  await expenseDialog.getByRole('button', { name: /Revisar e Adicionar Despesa/i }).click();
  await expect(expenseDialog).toBeHidden({ timeout: 30_000 });
  expect(bodyOf(creates[2])).toMatchObject({ type: 'despesa', status: 'pending', dueDate: today() });
  expect(await quotaUsed()).toBe(3);

  // Nenhum crédito nem débito prematuro no caixa realizado do mês (pela
  // regra anterior, a receita a receber já contaria).
  await expect(summaryCard(page, 'Receitas')).toHaveAccessibleName(/R\$\s*0,00/);
  await expect(summaryCard(page, 'Despesas')).toHaveAccessibleName(/R\$\s*0,00/);

  // Lista de receitas: a receita a receber aparece como pendente.
  await summaryCard(page, 'Receitas').click();
  await expect(page.locator('tr').filter({ hasText: 'Receita P3-F a receber' })
    .getByText('Pendente')).toBeVisible();
  await page.getByRole('button', { name: 'Voltar ao dashboard' }).click();

  // Confirmar a despesa pela edição.
  await summaryCard(page, 'Despesas').click();
  const row = page.locator('tr').filter({ hasText: CATALOG.product });
  await expect(row.getByText('Pendente')).toBeVisible();
  await row.getByRole('button', { name: 'Editar' }).click();
  const editDialog = transactionDialog(page);
  // Pendente que segue pendente: correção, com motivo.
  await expect(editDialog.getByLabel(/Motivo da correção/)).toBeVisible();
  await editDialog.locator('form').getByLabel('Sim', { exact: true }).check();
  // Marcado como pago: confirmação — sem motivo, com o vencimento à vista.
  await expect(editDialog.getByLabel(/Motivo da correção/)).toHaveCount(0);
  await expect(editDialog.getByText(`Vencimento: ${brDate(today())}. Informe a data em que foi paga.`)).toBeVisible();
  await editDialog.locator('form input[type="number"]').fill('205.50');
  await editDialog.locator('form input[type="date"]').fill(today());
  await editDialog.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(editDialog).toBeHidden({ timeout: 30_000 });

  expect(confirms).toHaveLength(1);
  const confirmation = bodyOf(confirms[0]);
  expect(confirmation).toMatchObject({ date: today(), amountCents: 20_550 });
  expect(String(confirmation.expectedUpdatedAt)).toMatch(/\.\d{9}Z$/);
  expect(confirmation).not.toHaveProperty('reason');
  const [expense] = await byDescription(CATALOG.product);
  expect(expense.get('isPaid')).toBe(true);
  expect(expense.get('date')).toBe(today());
  expect(expense.get('dueDate')).toBe(today());
  expect(expense.get('valueCents')).toBe(20_550);
  expect(expense.get('cashEntry')).toMatchObject({ status: 'confirmed' });
  expect(await quotaUsed()).toBe(3);

  // O dashboard passa a mostrar a saída realizada; as receitas pendentes não.
  await page.getByRole('button', { name: 'Voltar ao dashboard' }).click();
  await expect(summaryCard(page, 'Despesas')).toHaveAccessibleName(/R\$\s*205,50/);
  await expect(summaryCard(page, 'Receitas')).toHaveAccessibleName(/R\$\s*0,00/);
});

test('recusas locais: confirmação com mudança descritiva e pago com data futura', async ({ page, request }) => {
  const token = await emulatorIdToken(request, OWNER.email, PASSWORD);
  const created = await callCallable(request, token, 'createCashTransaction', {
    workspaceId: WS.id, idempotencyKey: 'e2e-p3f-pendente-0001', type: 'despesa',
    cashAccountId: defaultCashAccountIdFor(WS.id),
    description: CATALOG.product, categoryId: 'p3f-expense-category',
    expenseType: CATALOG.expenseType, paymentMethod: CATALOG.paymentMethod,
    amountCents: 30_000, status: 'pending', dueDate: today(),
  });
  expect(created.status, JSON.stringify(created)).toBe(200);
  await login(page);
  const creates = callablePosts(page, 'createCashTransaction');
  const confirms = callablePosts(page, 'confirmCashTransaction');

  await summaryCard(page, 'Despesas').click();
  await page.locator('tr').filter({ hasText: CATALOG.product })
    .getByRole('button', { name: 'Editar' }).click();
  const dialog = transactionDialog(page);
  const form = dialog.locator('form');
  await form.getByLabel('Sim', { exact: true }).check();
  await form.locator('select').nth(1).selectOption({ label: CATALOG.otherExpenseCategory });
  await form.locator('input[type="date"]').fill(today());
  await dialog.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(/Para confirmar, altere só valor, data e forma de pagamento/);
  expect(confirms).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Fechar' }).click();
  const [stillPending] = await byDescription(CATALOG.product);
  expect(stillPending.get('isPaid')).toBe(false);

  // Despesa "paga" com data futura: erro de preenchimento, não agendamento.
  await page.getByRole('button', { name: 'Voltar ao dashboard' }).click();
  await page.getByRole('button', { name: /Nova Transação/i }).first().click();
  const futureDialog = await fillExpense(page, { amount: '50', date: dayKey(3), paid: true });
  await futureDialog.getByRole('button', { name: /Revisar e Adicionar Despesa/i }).click();
  await expect(futureDialog.getByRole('alert'))
    .toHaveText('Lançamento pago ou recebido não pode ter data futura. Para agendar, marque como não pago.');
  expect(creates).toHaveLength(0);
  expect(await byDescription(CATALOG.product)).toHaveLength(1);
});
