import { expect, test } from '@playwright/test';

import { adminSdk, seedAccountProfile } from './support/workspaceSeed';

/**
 * P1 — listas de espaços e de membros paginadas por cursor, sem truncar.
 *
 * O seletor lê 50 espaços por página e a tela de membros, 200 (o teto das
 * Rules). Acima disso a próxima página é oferecida — e só então: abaixo do
 * teto, nenhum controle novo aparece e a interface fica como antes.
 */
const UID = 'e2e-p1-pager';
const EMAIL = 'e2e-p1-pager@minhas-financas.local';
const PASSWORD = 'e2e-p1-pager-password';
const WORKSPACES = 51;
const MEMBERS = 201;
const wsId = (index: number) => `e2e-pager-ws-${String(index).padStart(3, '0')}`;
const wsName = (index: number) => `Empresa Paginada ${String(index).padStart(3, '0')}`;

test.beforeAll(async () => {
  const sdk = adminSdk();
  const db = sdk.firestore();
  try {
    await sdk.auth().deleteUser(UID);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  await sdk.auth().createUser({ uid: UID, email: EMAIL, password: PASSWORD, emailVerified: true });
  await db.recursiveDelete(db.collection(`users/${UID}/workspaces`));
  await seedAccountProfile({ uid: UID, email: EMAIL });

  const at = (index: number) => sdk.firestore.Timestamp.fromMillis(Date.UTC(2026, 0, 1) + index * 1000);
  const writer = db.bulkWriter();
  for (let index = 0; index < WORKSPACES; index += 1) {
    const workspaceId = wsId(index);
    await db.recursiveDelete(db.doc(`workspaces/${workspaceId}`));
    writer.set(db.doc(`workspaces/${workspaceId}`), {
      name: wsName(index), type: 'PJ', ownerId: UID, status: 'active', currency: 'BRL',
      cnpj: null, createdBy: UID, createdAt: at(index), updatedAt: at(index),
    });
    writer.set(db.doc(`workspaces/${workspaceId}/members/${UID}`), {
      uid: UID, role: 'owner', status: 'active', email: EMAIL, displayName: EMAIL,
      photoURL: null, invitedBy: null, joinedAt: at(index), updatedAt: at(index),
      removedAt: null, removedBy: null,
    });
    writer.set(db.doc(`users/${UID}/workspaces/${workspaceId}`), {
      workspaceId, status: 'active', name: wsName(index), type: 'PJ',
      workspaceStatus: 'active', joinedAt: at(index), updatedAt: at(index),
    });
  }
  // O primeiro espaço (aberto ao entrar) tem mais membros que uma página.
  for (let index = 1; index < MEMBERS; index += 1) {
    const uid = `e2e-pager-member-${String(index).padStart(3, '0')}`;
    writer.set(db.doc(`workspaces/${wsId(0)}/members/${uid}`), {
      uid, role: 'viewer', status: 'active', email: `${uid}@minhas-financas.local`,
      displayName: `Membro ${String(index).padStart(3, '0')}`, photoURL: null,
      invitedBy: UID, joinedAt: at(index), updatedAt: at(index), removedAt: null, removedBy: null,
    });
  }
  await writer.close();
});

test('seletor e membros oferecem a próxima página e não escondem ninguém', async ({ page }) => {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    `lastWorkspaceId_${UID}`, wsId(0),
  ]);
  await page.goto(`/?e2eEmail=${encodeURIComponent(EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });

  // Seletor: 50 na primeira página; o 51º só depois de pedir a próxima.
  await page.getByText('Olá, Usuário').click();
  const loadMoreWorkspaces = page.getByRole('button', { name: 'Carregar mais espaços' });
  await expect(loadMoreWorkspaces).toBeVisible();
  await expect(page.getByRole('button', { name: wsName(49) })).toBeVisible();
  await expect(page.getByRole('button', { name: wsName(50) })).toHaveCount(0);
  await loadMoreWorkspaces.click();
  await expect(page.getByRole('button', { name: wsName(50) })).toBeVisible();
  await expect(loadMoreWorkspaces).toHaveCount(0);
  // Fecha o menu como o usuário faz: clicando fora (no fundo transparente).
  await page.locator('div.fixed.inset-0.z-30').click({ position: { x: 5, y: 5 } });

  // Membros: 200 na primeira página, com a contagem indicando que há mais.
  await page.getByText('Configurações', { exact: true }).first().click();
  await page.getByText('Membros da Equipe', { exact: true }).click();
  await expect(page.getByText('Membros Atuais (200+)')).toBeVisible();
  await expect(page.getByText(`Membro ${String(MEMBERS - 1).padStart(3, '0')}`)).toHaveCount(0);
  await page.getByRole('button', { name: 'Carregar mais membros' }).click();
  await expect(page.getByText(`Membros Atuais (${MEMBERS})`)).toBeVisible();
  await expect(page.getByText(`Membro ${String(MEMBERS - 1).padStart(3, '0')}`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Carregar mais membros' })).toHaveCount(0);
});
