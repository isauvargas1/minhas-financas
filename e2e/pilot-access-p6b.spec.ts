import { expect, test, type Page } from '@playwright/test';

import { adminSdk } from './support/workspaceSeed';

/**
 * P6-B — autorização do piloto no perfil, de ponta a ponta no Emulator (Auth, Firestore e Functions).
 *
 * No Emulator o bootstrap autoriza sem convite (`accessSource: 'emulator'`); a recusa por falta de convite em
 * `invite_only` é coberta pela integração (`pilotAccessP6b.integration.test.ts`) e pelas Rules
 * (`pilot-access-p6b.rules.integration.test.mjs`). Aqui fica o que só o navegador prova: a revogação gravada no
 * perfil (o mesmo commit que `tools/piloto/acesso-piloto.mjs revogar` faz) nega a próxima leitura com a sessão e o
 * ID token ainda vigentes, o novo login mostra a recusa do piloto em pt-BR, e nada do histórico é apagado.
 */

const PASSWORD = 'e2e-piloto-p6b-senha';
const PILOT_MESSAGE =
  'O FênixGran está em piloto fechado e este acesso ainda não foi liberado. Peça um convite ao responsável pelo piloto.';

interface Persona {
  uid: string;
  email: string;
}

const persona = (suffix: string): Persona => ({
  uid: `e2e-piloto-p6b-${suffix}`,
  email: `e2e-piloto-p6b-${suffix}@minhas-financas.local`,
});

/** Conta sintética limpa; `bootstrapAccount` prepara o resto no login. */
const resetPersona = async ({ uid, email }: Persona) => {
  const sdk = adminSdk();
  try {
    await sdk.auth().deleteUser(uid);
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
  }
  const db = sdk.firestore();
  await Promise.all([
    db.recursiveDelete(db.doc(`users/${uid}`)),
    db.recursiveDelete(db.doc(`billing_accounts/${uid}`)),
  ]);
  await sdk.auth().createUser({ uid, email, password: PASSWORD, emailVerified: true });
};

const login = async (page: Page, { email }: Persona) => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(email)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
};

const openPlans = async (page: Page) => {
  await page.getByText('Meu Plano', { exact: true }).first().click();
  await expect(page.getByText('Planos e Assinaturas')).toBeVisible();
};

/** Workspace pessoal criado pelo bootstrap, pelo índice do usuário (só leitura administrativa do Emulator). */
const personalWorkspaceId = async (uid: string): Promise<string> => {
  const index = await adminSdk().firestore().collection(`users/${uid}/workspaces`).limit(2).get();
  expect(index.size).toBe(1);
  return index.docs[0].id;
};

test('revogação no perfil: a sessão aberta perde a leitura na mudança seguinte e o novo login mostra a recusa, sem apagar nada', async ({ page }) => {
  test.setTimeout(120_000);
  const user = persona('revogada');
  await resetPersona(user);
  const db = adminSdk().firestore();

  await login(page, user);
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({ timeout: 45_000 });
  const profile = await db.doc(`users/${user.uid}`).get();
  expect(profile.get('accessStatus')).toBe('granted');
  expect(profile.get('accessSource')).toBe('emulator');
  const workspaceId = await personalWorkspaceId(user.uid);
  const membersBefore = (await db.collection(`workspaces/${workspaceId}/members`).get()).size;
  const accountsBefore = (await db.collection(`workspaces/${workspaceId}/accounts`).get()).size;

  await openPlans(page);
  await expect(page.getByRole('button', { name: 'Plano Atual' })).toBeVisible();

  // Revogação (mesmo efeito do commit de `acesso-piloto.mjs revogar` no perfil): a sessão e o ID token continuam
  // válidos, mas as Rules negam a próxima leitura do listener do billing.
  await db.doc(`users/${user.uid}`).update({ accessStatus: 'revoked', accessRevokedAt: new Date(), updatedAt: new Date() });
  await db.doc(`billing_accounts/${user.uid}`).update({ updatedAt: new Date() });
  await expect(page.getByRole('alert').filter({ hasText: 'Não foi possível carregar sua assinatura' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plano Atual' })).toHaveCount(0);

  // Novo carregamento: o bootstrap recusa o perfil revogado (também no Emulator) e a tela mostra a mensagem do
  // backend, sem dados do workspace.
  await page.reload();
  await expect(page.getByText(PILOT_MESSAGE)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i)).toHaveCount(0);

  // Nada foi apagado nem reativado.
  const after = await db.doc(`users/${user.uid}`).get();
  expect(after.get('accessStatus')).toBe('revoked');
  expect(after.get('status')).toBe('active');
  expect((await db.doc(`workspaces/${workspaceId}`).get()).exists).toBe(true);
  expect((await db.collection(`workspaces/${workspaceId}/members`).get()).size).toBe(membersBefore);
  expect((await db.collection(`workspaces/${workspaceId}/accounts`).get()).size).toBe(accountsBefore);
});
