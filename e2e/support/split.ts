import { expect, type APIRequestContext, type Page } from '@playwright/test';

import { callCallable } from './callables';
import { db, intentKey, today, tokenOf } from './loans';

/**
 * Apoio dos E2E da Divisão de contas (P4-C, D-14), só no Emulator (Auth,
 * Firestore e Functions reais, sem mocks). O arranjo usa as mesmas callables
 * que a interface (`createSplitGroup`, `addWorkspaceSplitParticipant`,
 * `addExternalSplitParticipant`, `createSplitBill`,
 * `createSplitReimbursement`); a verificação lê pelo Admin SDK. Nada é
 * gravado à mão nas coleções do domínio.
 */
type Doc = Record<string, any> & { id: string };

const listOf = async (workspaceId: string, collection: string): Promise<Doc[]> =>
  (await db().collection(`workspaces/${workspaceId}/${collection}`).get())
    .docs.map((entry) => ({ id: entry.id, ...entry.data() }));

export const splitGroupsOf = (workspaceId: string) => listOf(workspaceId, 'split_groups');
export const splitParticipantsOf = (workspaceId: string) => listOf(workspaceId, 'split_participants');
export const splitBillsOf = (workspaceId: string) => listOf(workspaceId, 'split_bills');
export const splitSharesOf = (workspaceId: string) => listOf(workspaceId, 'split_shares');
export const splitReimbursementsOf = (workspaceId: string) => listOf(workspaceId, 'split_reimbursements');

export const splitDoc = async (workspaceId: string, collection: string, id: string): Promise<Doc> => {
  const snapshot = await db().doc(`workspaces/${workspaceId}/${collection}/${id}`).get();
  expect(snapshot.exists, `${collection}/${id}`).toBe(true);
  return { id: snapshot.id, ...snapshot.data() };
};

export const openSplit = async (page: Page, type: 'PF' | 'PJ' = 'PF') => {
  await page.getByRole('link', { name: type === 'PJ' ? /Rateios & Reembolsos/ : /Dividir Gastos/ }).first().click();
  await expect(page.getByRole('heading', {
    name: type === 'PJ' ? 'Rateios & Reembolsos' : 'Divisão de Contas', level: 2,
  })).toBeVisible({ timeout: 20_000 });
};

/** Abre o grupo pelo cartão da lista e espera o cabeçalho do detalhe. */
export const openSplitGroup = async (page: Page, name: string) => {
  await page.getByRole('heading', { name, level: 3 }).first().click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible({ timeout: 20_000 });
};

const invoke = async (
  request: APIRequestContext,
  email: string,
  name: string,
  data: Record<string, unknown>,
): Promise<Record<string, any>> => {
  const outcome = await callCallable(request, await tokenOf(request, email), name, {
    idempotencyKey: intentKey(`split-${name}`),
    ...data,
  });
  expect(outcome.status, `${name}: ${outcome.errorMessage ?? ''}`).toBe(200);
  return outcome.result as Record<string, any>;
};

export const VISUAL = { color: '#6366f1', icon: 'Users', emoji: null };

export const createSplitGroupByApi = async (
  request: APIRequestContext,
  email: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ groupId: string; ownerParticipantId: string }> => {
  const result = await invoke(request, email, 'createSplitGroup', {
    workspaceId, name: 'Grupo Arranjo', description: null, groupType: 'temporary', businessMode: 'split',
    visual: VISUAL, ...overrides,
  });
  const group = await splitDoc(workspaceId, 'split_groups', result.groupId);
  return { groupId: result.groupId, ownerParticipantId: group.ownerParticipantId };
};

export const addSplitMemberByApi = async (
  request: APIRequestContext,
  email: string,
  workspaceId: string,
  groupId: string,
  userId: string,
  role: 'participant' | 'viewer' = 'participant',
): Promise<string> => (await invoke(request, email, 'addWorkspaceSplitParticipant', {
  workspaceId, groupId, userId, role,
})).participantId;

export const addSplitExternalByApi = async (
  request: APIRequestContext,
  email: string,
  workspaceId: string,
  groupId: string,
  displayName: string,
): Promise<string> => (await invoke(request, email, 'addExternalSplitParticipant', {
  workspaceId, groupId, displayName,
})).participantId;

export const createSplitBillByApi = async (
  request: APIRequestContext,
  email: string,
  workspaceId: string,
  groupId: string,
  payerParticipantId: string,
  participantIds: string[],
  overrides: Record<string, unknown> = {},
): Promise<string> => (await invoke(request, email, 'createSplitBill', {
  workspaceId, groupId, description: 'Conta Arranjo', category: 'Alimentação', amountCents: 9_000,
  expenseDate: today(), payerParticipantId, allocationMethod: 'equal',
  participants: participantIds.map((participantId) => ({ participantId })),
  financialIntegration: 'none', cashAccountId: null, cardId: null, installmentsCount: null, ...overrides,
})).billId;

export const sharesOfBill = async (workspaceId: string, billId: string): Promise<Doc[]> =>
  (await splitSharesOf(workspaceId)).filter((share) => share.billId === billId && share.status !== 'voided');
