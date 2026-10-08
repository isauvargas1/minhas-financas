import { expect, type APIRequestContext, type Page, type Request } from '@playwright/test';

import { defaultCashAccountIdFor } from './workspaceSeed';
import { callCallable } from './callables';
import { db, intentKey, today } from './loans';

/**
 * Apoio dos E2E de clientes e recebíveis (P3-I), só no Emulator (Auth,
 * Firestore e Functions reais). A interface usa as callables `createClient`,
 * `updateClient`, `archiveClient`, `createReceivable`, `updateReceivable`,
 * `receiveReceivable`, `reverseReceivableReceipt` e `cancelReceivable`; os
 * testes leem o resultado pelo Admin SDK, sem escrever nas coleções do
 * domínio por fora (exceto a troca de papel de um membro, que é o cenário de
 * perda de autorização).
 */
type Doc = Record<string, any> & { id: string };

export const openClientsReceivables = async (page: Page) => {
  await page.getByRole('link', { name: /Clientes & Recebíveis/ }).click();
  await expect(page.getByRole('heading', { name: 'Clientes & Recebíveis' })).toBeVisible({ timeout: 20_000 });
};

export const openClientsTab = async (page: Page) => {
  await page.getByRole('button', { name: 'Clientes', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'Documento' })).toBeVisible();
};

export const receivableRow = (page: Page, description: string) =>
  page.getByRole('row').filter({ has: page.getByRole('cell', { name: description, exact: true }) });

export const clientRow = (page: Page, name: string) =>
  page.getByRole('row').filter({ hasText: name });

export const listOf = async (workspaceId: string, collection: string): Promise<Doc[]> =>
  (await db().collection(`workspaces/${workspaceId}/${collection}`).get())
    .docs.map((doc) => ({ id: doc.id, ...doc.data() }));

export const docOf = async (workspaceId: string, collection: string, id: string): Promise<Record<string, any>> =>
  (await db().doc(`workspaces/${workspaceId}/${collection}/${id}`).get()).data() ?? {};

export const receivableByDescription = async (workspaceId: string, description: string): Promise<Doc> => {
  const found = (await listOf(workspaceId, 'receivables')).find((entry) => entry.description === description);
  expect(found, description).toBeTruthy();
  return found!;
};

export const movementsOfReceivable = async (workspaceId: string, receivableId: string): Promise<Doc[]> =>
  (await db().collection(`workspaces/${workspaceId}/receivable_movements`)
    .where('receivableId', '==', receivableId).get())
    .docs.map((doc) => ({ id: doc.id, ...doc.data() }));

/** Versão (`updatedAt`) no formato ISO com nanossegundos das callables. */
export const versionOf = (data: Record<string, any>): string => {
  const iso = data.updatedAt.toDate().toISOString();
  return `${iso.slice(0, 19)}.${String(data.updatedAt.nanoseconds).padStart(9, '0')}Z`;
};

const ok = (outcome: { status: number; result?: Record<string, unknown> }, label: string) => {
  expect(outcome.status, `${label}: ${JSON.stringify(outcome)}`).toBe(200);
  return outcome.result ?? {};
};

/** Preparação pela callable real (a tela é testada à parte). */
export const createClientByApi = async (
  request: APIRequestContext, token: string, workspaceId: string, overrides: Record<string, unknown> = {},
): Promise<string> => String(ok(await callCallable(request, token, 'createClient', {
  workspaceId, idempotencyKey: intentKey('client'), name: 'Cliente Preparado', ...overrides,
}), 'createClient').clientId);

export const createReceivableByApi = async (
  request: APIRequestContext, token: string, workspaceId: string, clientId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> => String(ok(await callCallable(request, token, 'createReceivable', {
  workspaceId, idempotencyKey: intentKey('receivable'), clientId, description: 'Recebível Preparado',
  amountCents: 100_000, dueDate: today(), ...overrides,
}), 'createReceivable').receivableId);

export const receiveByApi = async (
  request: APIRequestContext, token: string, workspaceId: string, receivableId: string,
  amounts: Partial<Record<'principalCents' | 'interestCents' | 'penaltyCents' | 'discountCents', number>>,
): Promise<string> => {
  const current = await docOf(workspaceId, 'receivables', receivableId);
  return String(ok(await callCallable(request, token, 'receiveReceivable', {
    workspaceId, idempotencyKey: intentKey('receive'), receivableId, expectedUpdatedAt: versionOf(current),
    principalCents: 0, interestCents: 0, penaltyCents: 0, discountCents: 0, paymentDate: today(),
    ...amounts,
    // P3-J (D-30): a conta acompanha o dinheiro; só desconto não a informa.
    ...((amounts.principalCents ?? 0) + (amounts.interestCents ?? 0) + (amounts.penaltyCents ?? 0) > 0
      ? { cashAccountId: defaultCashAccountIdFor(workspaceId) } : {}),
  }), 'receiveReceivable').movementId);
};

export const cancelByApi = async (
  request: APIRequestContext, token: string, workspaceId: string, receivableId: string,
) => {
  const current = await docOf(workspaceId, 'receivables', receivableId);
  ok(await callCallable(request, token, 'cancelReceivable', {
    workspaceId, idempotencyKey: intentKey('cancel'), receivableId,
    expectedUpdatedAt: versionOf(current), reason: 'Preparação do teste',
  }), 'cancelReceivable');
};

/**
 * Pedidos do navegador ao Firestore que citam `client_private`: o canal de
 * leitura do SDK leva o caminho da consulta no corpo. Member e viewer não
 * podem gerar nenhum (a interface nem pede os dados pessoais).
 */
const safeDecode = (text: string): string => {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
};

export const privateDataRequests = (page: Page): Request[] => {
  const seen: Request[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!/:8080\//.test(url) && !url.includes('firestore')) return;
    const body = `${url}\n${request.postData() ?? ''}`;
    if (body.includes('client_private') || safeDecode(body).includes('client_private')) seen.push(request);
  });
  return seen;
};
