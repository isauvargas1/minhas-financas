import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { callCallable } from './callables';
import { db, intentKey, today } from './loans';

/**
 * Apoio dos E2E de contas/carteiras e transferências (P3-J, D-30), só no
 * Emulator (Auth, Firestore e Functions reais). A interface usa as callables
 * `createCashAccount`, `updateCashAccount`, `archiveCashAccount`,
 * `reactivateCashAccount`, `createCashTransfer` e `reverseCashTransfer`; os
 * testes leem o resultado pelo Admin SDK e nunca escrevem em `cash_accounts`,
 * `cash_account_movements` ou `cash_transfers` por fora.
 */
type Doc = Record<string, any> & { id: string };

export const openCashAccounts = async (page: Page) => {
  await page.getByText('Configurações', { exact: true }).first().click();
  await page.getByText('Contas e carteiras', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Contas e carteiras', level: 2 })).toBeVisible({ timeout: 20_000 });
};

export const accountRow = (page: Page, name: string) =>
  page.getByTestId('account-row').filter({ has: page.getByText(name, { exact: true }) });

export const transferRow = (page: Page, text: string) =>
  page.getByTestId('transfer-row').filter({ hasText: text });

const listOf = async (workspaceId: string, collection: string): Promise<Doc[]> =>
  (await db().collection(`workspaces/${workspaceId}/${collection}`).get())
    .docs.map((doc) => ({ id: doc.id, ...doc.data() }));

export const accountsOf = (workspaceId: string) => listOf(workspaceId, 'cash_accounts');
export const transfersOf = (workspaceId: string) => listOf(workspaceId, 'cash_transfers');
export const accountMovementsOf = (workspaceId: string) => listOf(workspaceId, 'cash_account_movements');

export const accountByName = async (workspaceId: string, name: string): Promise<Doc> => {
  const found = (await accountsOf(workspaceId)).find((account) => account.name === name);
  expect(found, name).toBeTruthy();
  return found!;
};

export const balanceOf = async (workspaceId: string, accountId: string): Promise<number> =>
  Number((await db().doc(`workspaces/${workspaceId}/cash_accounts/${accountId}`).get()).get('balanceCents'));

export const movementsOfAccount = async (workspaceId: string, accountId: string): Promise<Doc[]> =>
  (await accountMovementsOf(workspaceId)).filter((movement) => movement.accountId === accountId);

/**
 * Prova do livro-razão: em cada conta, o saldo gravado é a soma exata dos
 * movimentos dela (centavos inteiros); nenhum movimento aponta para conta
 * inexistente. Devolve o saldo por nome de conta.
 */
export const expectLedgerConsistent = async (workspaceId: string): Promise<Record<string, number>> => {
  const accounts = await accountsOf(workspaceId);
  const movements = await accountMovementsOf(workspaceId);
  const ids = new Set(accounts.map((account) => account.id));
  for (const movement of movements) {
    expect(ids.has(movement.accountId), `movimento órfão ${movement.id}`).toBe(true);
    expect(Number.isSafeInteger(movement.amountCents) && movement.amountCents !== 0, movement.id).toBe(true);
  }
  const balances: Record<string, number> = {};
  for (const account of accounts) {
    const sum = movements.filter((movement) => movement.accountId === account.id)
      .reduce((total, movement) => total + movement.amountCents, 0);
    expect(account.balanceCents, `saldo ≠ soma dos movimentos em ${account.name}`).toBe(sum);
    balances[account.name] = account.balanceCents;
  }
  return balances;
};

const ok = (outcome: { status: number; result?: Record<string, unknown> }, label: string) => {
  expect(outcome.status, `${label}: ${JSON.stringify(outcome)}`).toBe(200);
  return outcome.result ?? {};
};

/** Criação pela callable real (atalho de preparação; a tela é testada à parte). */
export const createAccountByApi = async (
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Promise<string> => String(ok(await callCallable(request, token, 'createCashAccount', {
  workspaceId, idempotencyKey: intentKey('account'), name, accountType: 'checking', ...overrides,
}), 'createCashAccount').accountId);

export const transferByApi = async (
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  sourceAccountId: string,
  destinationAccountId: string,
  amountCents: number,
): Promise<string> => String(ok(await callCallable(request, token, 'createCashTransfer', {
  workspaceId, idempotencyKey: intentKey('transfer'), sourceAccountId, destinationAccountId,
  amountCents, date: today(),
}), 'createCashTransfer').transferId);
