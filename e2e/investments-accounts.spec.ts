import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  accountMovementsOf,
  balanceOf,
  createAccountByApi,
  expectLedgerConsistent,
} from './support/accounts';
import { callCallable, emulatorIdToken } from './support/callables';
import { db, intentKey } from './support/loans';
import {
  defaultCashAccountIdFor,
  saoPauloMonthKey,
  seedAccountProfile,
  seedMembership,
  seedOwnedWorkspace,
} from './support/workspaceSeed';

/**
 * Investimentos × contas do Caixa (D-15 + D-30, P4-D), contra o Emulator.
 *
 * O aporte depositado sai de uma conta escolhida e a retirada recebida entra
 * numa conta escolhida — no mesmo commit do fato patrimonial. Pendente não
 * move conta; desfazer compensa na conta original; cancelar um pendente não
 * move nada. O teste confere o saldo e o extrato da conta (ledger P3-J), não
 * só a tela. Escrita sempre pela interface ou pelas callables reais; o Admin
 * SDK só semeia identidade e catálogo e lê o resultado.
 */

const PASSWORD = 'e2e-investments-accounts-password';
const OWNER = { uid: 'e2e-inv-acc-owner', email: 'e2e-inv-acc-owner@minhas-financas.local' };
const MEMBER = { uid: 'e2e-inv-acc-member', email: 'e2e-inv-acc-member@minhas-financas.local' };
const VIEWER = { uid: 'e2e-inv-acc-viewer', email: 'e2e-inv-acc-viewer@minhas-financas.local' };
const OTHER = { uid: 'e2e-inv-acc-other', email: 'e2e-inv-acc-other@minhas-financas.local' };
const WORKSPACE = 'e2e-investments-accounts-workspace';
const OTHER_WORKSPACE = 'e2e-investments-accounts-other';

const CLASS = 'inv-acc-class-reserva';
const INSTITUTION = 'inv-acc-institution-btg';
const CATEGORY = 'inv-acc-category-renda-fixa';
const MAIN_ACCOUNT = defaultCashAccountIdFor(WORKSPACE);

const catalogItem = (workspaceId: string, id: string, group: string, name: string, subtype?: string) => {
  const normalizedName = name.toLowerCase();
  return {
    id, workspaceId, group, name, normalizedName,
    ...(subtype ? { transactionSubtype: subtype } : {}),
    dedupeKey: `${group}::${subtype ?? 'all'}::both::${normalizedName}`,
    workspaceScope: 'both', sortOrder: 1, status: 'active',
    createdBy: OWNER.uid, updatedBy: OWNER.uid,
    createdAt: new Date(), updatedAt: new Date(),
  };
};

const resetUser = async (user: { uid: string; email: string }) => {
  const auth = (await import('./support/workspaceSeed')).adminSdk().auth();
  try {
    await auth.deleteUser(user.uid);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  await auth.createUser({ uid: user.uid, email: user.email, password: PASSWORD, emailVerified: true });
};

test.beforeEach(async () => {
  for (const ws of [WORKSPACE, OTHER_WORKSPACE]) await db().recursiveDelete(db().doc(`workspaces/${ws}`));
  for (const user of [OWNER, MEMBER, VIEWER, OTHER]) await resetUser(user);
  await seedOwnedWorkspace({ ...OWNER, workspaceId: WORKSPACE, name: 'Patrimônio com contas', type: 'PF' });
  await seedOwnedWorkspace({ ...OTHER, workspaceId: OTHER_WORKSPACE, name: 'Outro espaço', type: 'PF' });
  for (const [user, role] of [[MEMBER, 'member'], [VIEWER, 'viewer']] as const) {
    await seedAccountProfile(user);
    await seedMembership({ workspaceId: WORKSPACE, uid: user.uid, email: user.email, role,
      name: 'Patrimônio com contas', type: 'PF' });
  }
  await Promise.all([
    db().doc(`workspaces/${WORKSPACE}/settings_catalog/${CLASS}`)
      .set(catalogItem(WORKSPACE, CLASS, 'investment_class', 'Reserva de emergência')),
    db().doc(`workspaces/${WORKSPACE}/settings_catalog/${INSTITUTION}`)
      .set(catalogItem(WORKSPACE, INSTITUTION, 'investment_institution', 'BTG')),
    db().doc(`workspaces/${WORKSPACE}/settings_catalog/${CATEGORY}`)
      .set(catalogItem(WORKSPACE, CATEGORY, 'category', 'Renda fixa', 'investimento')),
  ]);
});

const login = async (page: Page, email: string) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(email)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({ timeout: 30_000 });
};

const openInvestments = async (page: Page) => {
  await page.getByText('Investimentos', { exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Investimentos', exact: true })).toBeVisible();
};

const fillNewInvestment = async (page: Page, description: string, amount: string, deposited: boolean) => {
  await page.getByRole('button', { name: 'Novo investimento' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Carteira de investimentos').selectOption({ label: 'Reserva de emergência' });
  await dialog.getByLabel('Instituição').selectOption({ label: 'BTG' });
  await dialog.getByLabel('Descrição').fill(description);
  await dialog.getByLabel('Categoria').selectOption({ label: 'Renda fixa' });
  await dialog.getByLabel('Valor do investimento').fill(amount);
  await dialog.getByRole('radio', { name: deposited ? 'Sim' : 'Não' }).check();
  return dialog;
};

const movementsOf = async () => (await db().collection(`workspaces/${WORKSPACE}/investment_movements`).get())
  .docs.map((doc) => ({ id: doc.id, ...doc.data() }) as Record<string, any>);

const investmentAccountMovements = async () =>
  (await accountMovementsOf(WORKSPACE)).filter((movement) => movement.sourceDomain === 'investment');

const createByApi = (
  request: APIRequestContext,
  token: string,
  overrides: Record<string, unknown> = {},
) => callCallable(request, token, 'createSimpleInvestment', {
  workspaceId: WORKSPACE,
  idempotencyKey: intentKey('inv-acc'),
  correlationId: intentKey('inv-acc-corr'),
  institutionId: INSTITUTION,
  classId: CLASS,
  typeId: CATEGORY,
  description: 'Aporte pela API',
  valueCents: 10_000,
  settled: true,
  occurredAt: new Date().toISOString(),
  cashAccountId: MAIN_ACCOUNT,
  ...overrides,
});

test('com duas contas, o aporte depositado exige a conta de origem e move só ela', async ({ page, request }) => {
  const token = await emulatorIdToken(request, OWNER.email, PASSWORD);
  const checking = await createAccountByApi(request, token, WORKSPACE, 'Conta corrente');
  await login(page, OWNER.email);
  await openInvestments(page);

  const dialog = await fillNewInvestment(page, 'CDB pela conta corrente', '100000', true);
  // Duas contas ativas: nada vem escolhido, e salvar sem conta é recusado na tela.
  const account = dialog.getByLabel('Conta de origem');
  await expect(account).toHaveValue('');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog.getByText('Escolha a conta de origem do dinheiro.')).toBeVisible();
  expect(await movementsOf()).toHaveLength(0);

  await account.selectOption({ label: 'Conta corrente' });
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog).toHaveCount(0);

  await expect.poll(async () => balanceOf(WORKSPACE, checking), { timeout: 20_000 }).toBe(-100_000);
  expect(await balanceOf(WORKSPACE, MAIN_ACCOUNT)).toBe(0);
  const [movement] = await movementsOf();
  expect(movement.status).toBe('settled');
  expect(movement.cashAccountId).toBe(checking);
  const [accountMovement] = await investmentAccountMovements();
  expect(accountMovement.id).toBe(movement.accountMovementId);
  expect(accountMovement.kind).toBe('investment');
  expect(accountMovement.amountCents).toBe(-100_000);
  // O espelho de caixa tem o mesmo efeito do movimento de conta.
  const mirror = (await db().collection(`workspaces/${WORKSPACE}/transactions`)
    .where('investmentEntry.movementId', '==', movement.id).get()).docs[0].data();
  expect(mirror.cashAccountId).toBe(checking);
  expect(mirror.accountMovementId).toBe(accountMovement.id);
  expect(mirror.investmentEntry.amountCents).toBe(100_000);
  await expectLedgerConsistent(WORKSPACE);
});

test('pendente não move conta; confirmar, retirar, desfazer e cancelar movem a conta certa', async ({ page, request }) => {
  const token = await emulatorIdToken(request, OWNER.email, PASSWORD);
  const checking = await createAccountByApi(request, token, WORKSPACE, 'Conta corrente');
  await login(page, OWNER.email);
  await openInvestments(page);

  // 1. Pendente: sem campo de conta e sem efeito em conta alguma.
  const dialog = await fillNewInvestment(page, 'Tesouro pendente', '50000', false);
  await expect(dialog.getByLabel('Conta de origem')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog).toHaveCount(0);
  const pendingRow = page.getByRole('row').filter({ hasText: 'Tesouro pendente' });
  await expect(pendingRow.getByText('Pendente', { exact: true })).toBeVisible();
  expect(await investmentAccountMovements()).toHaveLength(0);

  // 2. Confirmar o depósito pede a conta de origem.
  await pendingRow.getByRole('button', { name: /Confirmar depósito/ }).click();
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Confirmar depósito' }).click();
  await expect(confirm.getByText('Escolha a conta de origem do dinheiro.')).toBeVisible();
  await confirm.getByLabel('Conta de origem').selectOption({ label: 'Carteira principal' });
  await confirm.getByRole('button', { name: 'Confirmar depósito' }).click();
  await expect(confirm).toHaveCount(0);
  await expect.poll(async () => balanceOf(WORKSPACE, MAIN_ACCOUNT), { timeout: 20_000 }).toBe(-50_000);
  expect(await balanceOf(WORKSPACE, checking)).toBe(0);

  // 3. Retirada recebida entra na conta de destino escolhida.
  const settledRow = page.getByRole('row')
    .filter({ hasText: 'Tesouro pendente' }).filter({ hasText: 'Aporte' });
  await expect(settledRow.getByText('Depositado', { exact: true })).toBeVisible();
  await settledRow.getByRole('button', { name: /Retirar investimento/ }).click();
  const withdraw = page.getByRole('dialog');
  await withdraw.getByLabel('Valor da retirada').fill('20000');
  await withdraw.getByLabel('Conta de destino').selectOption({ label: 'Conta corrente' });
  await withdraw.getByRole('button', { name: 'Confirmar retirada' }).click();
  await expect(withdraw).toHaveCount(0);
  await expect.poll(async () => balanceOf(WORKSPACE, checking), { timeout: 20_000 }).toBe(20_000);

  // 4. Desfazer a retirada (owner): a compensação é na conta original, informada.
  const withdrawalRow = page.getByRole('row').filter({ hasText: 'Retirada' })
    .filter({ has: page.getByText('Recebido', { exact: true }) });
  await withdrawalRow.getByRole('button', { name: /Desfazer lançamento/ }).click();
  const undo = page.getByRole('dialog');
  await expect(undo.getByText('O valor sai novamente da conta Conta corrente.')).toBeVisible();
  await expect(undo.getByLabel('Conta de destino')).toHaveCount(0);
  await undo.getByRole('button', { name: 'Desfazer lançamento' }).click();
  await expect(undo).toHaveCount(0);
  await expect.poll(async () => balanceOf(WORKSPACE, checking), { timeout: 20_000 }).toBe(0);

  // 5. Retirada pendente cancelada: nenhuma conta se move.
  const before = await investmentAccountMovements();
  await settledRow.getByRole('button', { name: /Retirar investimento/ }).click();
  const pendingWithdraw = page.getByRole('dialog');
  await pendingWithdraw.getByLabel('Valor da retirada').fill('10000');
  await pendingWithdraw.getByRole('radio', { name: 'Não' }).check();
  await expect(pendingWithdraw.getByLabel('Conta de destino')).toHaveCount(0);
  await pendingWithdraw.getByRole('button', { name: 'Confirmar retirada' }).click();
  await expect(pendingWithdraw).toHaveCount(0);
  const pendingWithdrawalRow = page.getByRole('row')
    .filter({ has: page.getByText('Aguardando recebimento', { exact: true }) });
  await pendingWithdrawalRow.getByRole('button', { name: /Cancelar lançamento/ }).click();
  const cancel = page.getByRole('dialog');
  await cancel.getByRole('button', { name: 'Cancelar lançamento' }).click();
  await expect(cancel).toHaveCount(0);
  await expect(page.getByText('Cancelado', { exact: true }).first()).toBeVisible();
  expect((await investmentAccountMovements()).length).toBe(before.length);

  expect(await balanceOf(WORKSPACE, MAIN_ACCOUNT)).toBe(-50_000);
  expect(await balanceOf(WORKSPACE, checking)).toBe(0);
  const balances = await expectLedgerConsistent(WORKSPACE);
  expect(balances['Carteira principal']).toBe(-50_000);
  // Saldo negativo é permitido pelo ledger (só o teto absoluto é recusado).
  expect(balances['Carteira principal']).toBeLessThan(0);
});

test('duplo clique em "Confirmar depósito" liquida uma vez e move a conta uma vez', async ({ page }) => {
  await login(page, OWNER.email);
  await openInvestments(page);
  const dialog = await fillNewInvestment(page, 'Aporte com duplo envio', '30000', false);
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialog).toHaveCount(0);

  const row = page.getByRole('row').filter({ hasText: 'Aporte com duplo envio' });
  await row.getByRole('button', { name: /Confirmar depósito/ }).click();
  const confirm = page.getByRole('dialog');
  // Conta única: já vem escolhida.
  await expect(confirm.getByLabel('Conta de origem')).toHaveValue(MAIN_ACCOUNT);
  const button = await confirm.getByRole('button', { name: 'Confirmar depósito' }).elementHandle();
  expect(button).not.toBeNull();
  await button!.evaluate((node) => {
    (node as HTMLButtonElement).click();
    (node as HTMLButtonElement).click();
  });
  await expect(confirm).toHaveCount(0);
  await expect.poll(async () => balanceOf(WORKSPACE, MAIN_ACCOUNT), { timeout: 20_000 }).toBe(-30_000);
  expect(await investmentAccountMovements()).toHaveLength(1);
  expect((await movementsOf()).filter((movement) => movement.status === 'settled')).toHaveLength(1);
});

test('servidor decide papel, workspace e conta: member, viewer, outro tenant e conta arquivada', async ({ page, request }) => {
  const ownerToken = await emulatorIdToken(request, OWNER.email, PASSWORD);
  const memberToken = await emulatorIdToken(request, MEMBER.email, PASSWORD);
  const viewerToken = await emulatorIdToken(request, VIEWER.email, PASSWORD);
  const otherToken = await emulatorIdToken(request, OTHER.email, PASSWORD);

  // Member registra aporte depositado (move a conta), mas não desfaz.
  const created = await createByApi(request, memberToken);
  expect(created.status, created.errorMessage ?? '').toBe(200);
  expect(await balanceOf(WORKSPACE, MAIN_ACCOUNT)).toBe(-10_000);
  const movementId = String(created.result?.movementId);
  const undo = await callCallable(request, memberToken, 'reverseInvestmentMovement', {
    workspaceId: WORKSPACE, idempotencyKey: intentKey('inv-acc-undo'),
    correlationId: intentKey('inv-acc-undo-corr'), movementId,
    reversedAt: new Date().toISOString(), reason: 'Member tentando desfazer',
  });
  expect(undo.errorStatus).toBe('PERMISSION_DENIED');

  // Viewer não escreve.
  const viewer = await createByApi(request, viewerToken);
  expect(viewer.errorStatus).toBe('PERMISSION_DENIED');

  // Perda de autorização na mesma sessão: o token continua válido, a
  // membership removida pelo backend nega na hora.
  await db().doc(`workspaces/${WORKSPACE}/members/${MEMBER.uid}`).update({ status: 'removed' });
  const revoked = await createByApi(request, memberToken);
  expect(revoked.errorStatus).toBe('PERMISSION_DENIED');

  // Outro tenant: nem no workspace alheio, nem com a conta alheia.
  const foreign = await createByApi(request, otherToken);
  expect(foreign.errorStatus).toBe('PERMISSION_DENIED');
  const foreignAccount = await createByApi(request, ownerToken, {
    cashAccountId: defaultCashAccountIdFor(OTHER_WORKSPACE),
  });
  expect(foreignAccount.status).toBeGreaterThanOrEqual(400);
  expect(foreignAccount.errorMessage).toBe('Conta não encontrada.');

  // Conta arquivada não aceita o aporte.
  const spare = await createAccountByApi(request, ownerToken, WORKSPACE, 'Conta reserva');
  const spareDoc = await db().doc(`workspaces/${WORKSPACE}/cash_accounts/${spare}`).get();
  const updatedAt = spareDoc.get('updatedAt') as { seconds: number; nanoseconds: number };
  const version = `${new Date(updatedAt.seconds * 1000).toISOString().slice(0, 19)}.` +
    `${String(updatedAt.nanoseconds).padStart(9, '0')}Z`;
  const archived = await callCallable(request, ownerToken, 'archiveCashAccount', {
    workspaceId: WORKSPACE, idempotencyKey: intentKey('inv-acc-archive'), accountId: spare,
    expectedUpdatedAt: version,
  });
  expect(archived.status, archived.errorMessage ?? '').toBe(200);
  const onArchived = await createByApi(request, ownerToken, { cashAccountId: spare });
  expect(onArchived.errorStatus).toBe('FAILED_PRECONDITION');
  expect(onArchived.errorMessage).toMatch(/^A conta selecionada está arquivada/);

  // Pendente com conta: recusado (a conta é escolhida na confirmação).
  const pendingWithAccount = await createByApi(request, ownerToken, { settled: false });
  expect(pendingWithAccount.errorStatus).toBe('INVALID_ARGUMENT');

  // Nada além do aporte do member mexeu nas contas.
  expect(await investmentAccountMovements()).toHaveLength(1);
  expect(await balanceOf(WORKSPACE, spare)).toBe(0);
  await expectLedgerConsistent(WORKSPACE);

  // O viewer lê o card do dashboard pela projeção oficial do mês.
  await login(page, VIEWER.email);
  const card = page.getByRole('button')
    .filter({ has: page.getByRole('heading', { name: 'Investimentos', exact: true }) });
  await expect(card.getByText('R$ 100,00')).toBeVisible({ timeout: 20_000 });
  const period = await db().doc(`workspaces/${WORKSPACE}/investment_report_periods/${saoPauloMonthKey()}`).get();
  expect(period.get('contributionCents')).toBe(10_000);
});
