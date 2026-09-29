import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { callCallable, emulatorIdToken } from './support/callables';
import { adminSdk, issueInviteTokenForE2E } from './support/workspaceSeed';

/**
 * P1 — conta, workspaces e membros de ponta a ponta, com duas contas reais no
 * Emulator (Auth, Firestore e Functions).
 *
 * 1. O primeiro login prepara a conta pelo backend (`bootstrapAccount`), e o
 *    logout não deixa nada da conta anterior para a próxima — nem no cache em
 *    memória (sem recarregar a página), nem no armazenamento local.
 * 2. Convite pela tela, aceite pelo convidado (token obtido pelo seam de
 *    teste, fora do bundle), troca de papel e remoção pela tela, e perda de
 *    acesso comprovada no servidor e na lista de workspaces.
 */

const PASSWORD = 'e2e-password-123456';

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

const createUser = async (uid: string, email: string, emailVerified = true) => {
  await adminSdk().auth().createUser({ uid, email, password: PASSWORD, emailVerified });
};

const login = async (page: Page, email: string) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(email)}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({
    timeout: 45_000,
  });
};

const workspaceIndex = async (uid: string) =>
  (await adminSdk().firestore().collection(`users/${uid}/workspaces`).get()).docs;

const tokenFor = (request: APIRequestContext, email: string) =>
  emulatorIdToken(request, email, PASSWORD);

test.beforeEach(async () => {
  await resetEmulatorData();
});

test('primeiro login prepara a conta no backend e o logout não vaza dados para a próxima conta', async ({ page }) => {
  const a = { uid: 'e2e-p1-account-a', email: 'e2e-p1-account-a@minhas-financas.local' };
  const b = { uid: 'e2e-p1-account-b', email: 'e2e-p1-account-b@minhas-financas.local' };
  // E-mail não verificado: o bootstrap não o exige (D-06).
  await createUser(a.uid, a.email, false);
  await createUser(b.uid, b.email, false);

  await login(page, a.email);

  const db = adminSdk().firestore();
  const profileA = await db.doc(`users/${a.uid}`).get();
  expect(profileA.get('status')).toBe('active');
  const indexA = await workspaceIndex(a.uid);
  expect(indexA).toHaveLength(1);
  const workspaceA = indexA[0].id;
  expect(indexA[0].get('role')).toBeUndefined();
  const memberA = await db.doc(`workspaces/${workspaceA}/members/${a.uid}`).get();
  expect(memberA.get('role')).toBe('owner');
  expect((await db.doc(`workspaces/${workspaceA}`).get()).get('name')).toBe('Meu Espaço Pessoal');

  // Dado exclusivo de A, visível para A.
  const now = new Date();
  await db.doc(`workspaces/${workspaceA}/transactions/p1-exclusiva-a`).set({
    userId: a.uid, workspaceId: workspaceA, profileId: workspaceA, isPaid: true,
    type: 'receita', description: 'Receita exclusiva da conta A', category: 'Salário',
    value: 4321, date: now.toISOString().slice(0, 10), transactionDate: now,
    createdAt: now, updatedAt: now,
  });
  await page.reload();
  await expect(page.getByText('Receita exclusiva da conta A').first()).toBeVisible({ timeout: 30_000 });
  await page.evaluate((workspaceId) => {
    localStorage.setItem(`finance_ai_chat_history_${workspaceId}`, JSON.stringify([
      { id: '1', type: 'user', text: 'pergunta privada de A', timestamp: new Date().toISOString() },
    ]));
  }, workspaceA);
  expect(await page.evaluate((uid) => localStorage.getItem(`lastWorkspaceId_${uid}`), a.uid))
    .toBe(workspaceA);

  /*
   * B vai entrar na MESMA página, sem recarregar. A tela de login lê o e-mail
   * de teste da URL quando é montada — o que acontece no logout —, então a URL
   * passa a apontar para B antes de sair; trocá-la depois não chegaria ao
   * botão já renderizado, e o login repetiria A.
   */
  const url = new URL(page.url());
  url.searchParams.set('e2eEmail', b.email);
  await page.evaluate((next) => window.history.replaceState(null, '', next), url.toString());

  // Logout pela tela.
  await page.getByText('Sair', { exact: true }).first().click();
  await expect(page.getByTestId('e2e-login-button')).toBeVisible();
  const leftovers = await page.evaluate(() => Object.keys(localStorage).filter((key) =>
    key.startsWith('lastWorkspaceId_') || key.startsWith('finance_ai_chat_history_') ||
    key.startsWith('app_chat_')));
  expect(leftovers).toEqual([]);

  // B entra sem recarregar: o cache em memória de A não pode reaparecer.
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('Receita exclusiva da conta A')).toHaveCount(0);

  const indexB = await workspaceIndex(b.uid);
  expect(indexB).toHaveLength(1);
  expect(indexB[0].id).not.toBe(workspaceA);
  expect(await db.doc(`workspaces/${workspaceA}/members/${b.uid}`).get().then((s) => s.exists))
    .toBe(false);
});

test('convite, aceite, troca de papel, remoção e perda de acesso entre duas contas', async ({ page, request }) => {
  const owner = { uid: 'e2e-p1-owner', email: 'e2e-p1-owner@minhas-financas.local' };
  const invitee = { uid: 'e2e-p1-invitee', email: 'e2e-p1-invitee@minhas-financas.local' };
  await createUser(owner.uid, owner.email);
  await createUser(invitee.uid, invitee.email);
  const db = adminSdk().firestore();

  // Conta do owner e uma empresa, pelas callables reais.
  const ownerToken = await tokenFor(request, owner.email);
  expect((await callCallable(request, ownerToken, 'bootstrapAccount', {})).status).toBe(200);
  const created = await callCallable(request, ownerToken, 'createWorkspace', {
    type: 'PJ', name: 'Empresa Convite E2E', idempotencyKey: 'e2e-p1-create-company',
  });
  expect(created.status, created.errorMessage).toBe(200);
  const workspaceId = String(created.result?.workspaceId);

  // O workspace sai do backend já provisionado, antes de qualquer tela abri-lo:
  // catálogo geral (com centros de custo, por ser PJ) e padrões de investimento.
  const catalog = await db.collection(`workspaces/${workspaceId}/settings_catalog`).get();
  expect(catalog.docs.filter((doc) => doc.get('group') === 'cost_center')).toHaveLength(3);
  expect(catalog.docs.some((doc) => doc.get('group') === 'wallet')).toBe(true);
  expect((await db.collection(`workspaces/${workspaceId}/investment_accounts`)
    .where('status', '==', 'active').get()).size).toBe(1);

  // O owner abre a empresa e convida pela tela.
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    `lastWorkspaceId_${owner.uid}`, workspaceId,
  ]);
  await login(page, owner.email);
  await expect(page.getByText('Empresa Convite E2E').first()).toBeVisible();
  await page.getByText('Configurações', { exact: true }).first().click();
  await page.getByText('Membros da Equipe', { exact: true }).click();
  await expect(page.getByText('Membros e Permissões')).toBeVisible();
  await page.getByPlaceholder('email@exemplo.com').fill(invitee.email);
  await page.getByRole('button', { name: 'Convidar' }).click();
  await expect(page.getByText(`Convite registrado para ${invitee.email}.`)).toBeVisible();
  // Sem e-mail transacional (E-11), nenhuma tela afirma que houve envio.
  await expect(page.getByText(/e-mail enviado|enviamos/i)).toHaveCount(0);

  const invites = await db.collection(`workspaces/${workspaceId}/invites`)
    .where('emailNormalized', '==', invitee.email).get();
  expect(invites.size).toBe(1);
  expect(invites.docs[0].get('status')).toBe('pending');
  expect(invites.docs[0].get('role')).toBe('viewer');
  expect(await db.doc(`workspaces/${workspaceId}/members/${invitee.uid}`).get().then((s) => s.exists))
    .toBe(false);

  // O convidado aceita com a própria conta.
  const inviteToken = await issueInviteTokenForE2E(workspaceId, invites.docs[0].id);
  const inviteeToken = await tokenFor(request, invitee.email);
  expect((await callCallable(request, inviteeToken, 'bootstrapAccount', {})).status).toBe(200);
  const accepted = await callCallable(request, inviteeToken, 'acceptWorkspaceInvite', {
    token: inviteToken,
  });
  expect(accepted.status, accepted.errorMessage).toBe(200);
  expect(accepted.result?.role).toBe('viewer');

  // Viewer é somente leitura no servidor.
  const viewerEdit = await callCallable(request, inviteeToken, 'updateWorkspaceSettings', {
    workspaceId, name: 'Tentativa do viewer',
  });
  expect(viewerEdit.errorStatus).toBe('PERMISSION_DENIED');

  // O owner promove pela tela (a lista é relida ao reabrir).
  await page.reload();
  await page.getByText('Configurações', { exact: true }).first().click();
  await page.getByText('Membros da Equipe', { exact: true }).click();
  const inviteeRow = page.locator('div', { hasText: invitee.email }).filter({
    has: page.locator('select'),
  }).last();
  await expect(inviteeRow.locator('select')).toHaveValue('viewer');
  await inviteeRow.locator('select').selectOption('admin');
  await expect.poll(async () =>
    (await db.doc(`workspaces/${workspaceId}/members/${invitee.uid}`).get()).get('role'))
    .toBe('admin');

  const adminEdit = await callCallable(request, inviteeToken, 'updateWorkspaceSettings', {
    workspaceId, name: 'Empresa Convite E2E',
  });
  expect(adminEdit.status, adminEdit.errorMessage).toBe(200);

  // O owner remove pela tela: remoção lógica.
  page.once('dialog', (dialog) => void dialog.accept());
  await inviteeRow.getByTitle('Remover acesso').click();
  await expect.poll(async () =>
    (await db.doc(`workspaces/${workspaceId}/members/${invitee.uid}`).get()).get('status'))
    .toBe('removed');
  expect((await db.doc(`users/${invitee.uid}/workspaces/${workspaceId}`).get()).get('status'))
    .toBe('removed');

  // Perda de acesso: o servidor recusa e a empresa some da lista do convidado.
  const afterRemoval = await callCallable(request, inviteeToken, 'updateWorkspaceSettings', {
    workspaceId, name: 'Depois da remoção',
  });
  expect(afterRemoval.errorStatus).toBe('PERMISSION_DENIED');

  // Fecha a janela de membros (o botão de fechar fica no cabeçalho dela) antes
  // de sair pela barra lateral, que ela cobre.
  await page.getByRole('heading', { name: 'Membros e Permissões' })
    .locator('xpath=../..').getByRole('button').click();
  await expect(page.getByText('Membros e Permissões')).toHaveCount(0);
  await page.getByText('Sair', { exact: true }).first().click();
  await expect(page.getByTestId('e2e-login-button')).toBeVisible();
  await login(page, invitee.email);
  // A lista de workspaces fica no menu da conta: abre-se a lista para que a
  // ausência da empresa seja verificada nela, e não numa tela sem a lista.
  await page.getByText('Olá, Usuário').click();
  await expect(page.getByText('Perfis Financeiros')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pessoal', exact: true })).toBeVisible();
  await expect(page.getByText('Empresa Convite E2E')).toHaveCount(0);

  const events = await db.collection(`workspaces/${workspaceId}/membership_events`).get();
  const operations = events.docs.map((event) => event.get('operation')).sort();
  expect(operations).toEqual([
    'invite.accepted',
    'invite.created',
    'member.removed',
    'member.role_changed',
    'workspace.created',
  ]);
});
