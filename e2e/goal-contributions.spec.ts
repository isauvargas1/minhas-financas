import {expect, test} from '@playwright/test';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');

const PROJECT_ID = 'minhas-financas-local';
const PASSWORD = 'e2e-password-123456';
const OWNER_UID = 'e2e-owner-goal-m1';
const OWNER_EMAIL = 'e2e-owner-goal-m1@minhas-financas.local';
const WORKSPACE_ID = 'workspace-e2e-goal-m1';
const GOAL_ID = 'goal-firestore-string-id';

const getAdmin = () => {
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT_ID});
  return admin;
};

const seed = async () => {
  const firebaseAdmin = getAdmin();
  const db = firebaseAdmin.firestore();
  const workspaceRef = db.doc(`workspaces/${WORKSPACE_ID}`);
  await db.recursiveDelete(workspaceRef);
  try {
    await firebaseAdmin.auth().deleteUser(OWNER_UID);
  } catch (error) {
    if ((error as {code?: string}).code !== 'auth/user-not-found') throw error;
  }
  await firebaseAdmin.auth().createUser({
    uid: OWNER_UID,
    email: OWNER_EMAIL,
    password: PASSWORD,
    emailVerified: true,
  });
  const now = admin.firestore.FieldValue.serverTimestamp();
  await workspaceRef.set({
    ownerId: OWNER_UID,
    userId: OWNER_UID,
    name: 'Workspace Meta M1',
    type: 'PF',
    themeColor: '#4f46e5',
    createdAt: now,
    updatedAt: now,
  });
  await Promise.all([
    db.doc(`workspaces/${WORKSPACE_ID}/members/${OWNER_UID}`).set({
      uid: OWNER_UID,
      email: OWNER_EMAIL,
      role: 'owner',
      status: 'active',
      joinedAt: now,
    }),
    db.doc(`users/${OWNER_UID}/workspaces/${WORKSPACE_ID}`).set({
      workspaceId: WORKSPACE_ID,
      role: 'owner',
      createdAt: now,
      updatedAt: now,
    }),
    db.doc(`workspaces/${WORKSPACE_ID}/goals/${GOAL_ID}`).set({
      workspaceId: WORKSPACE_ID,
      profileId: WORKSPACE_ID,
      name: 'Meta M1 E2E',
      description: 'Validação do aporte patrimonial',
      category: 'reserva_emergencia',
      status: 'em_andamento',
      priority: 'alta',
      targetAmount: 1000,
      targetAmountCents: 100000,
      currentAmount: 0,
      currentAmountCents: 0,
      progressBasis: 'net_contributions',
      startDate: '2026-01-01',
      deadline: '2027-01-01',
      horizon: 'curto',
      isAutomatic: false,
      visual: {color: '#6366f1', icon: 'Target', progressBarType: 'linear'},
      createdAt: now,
      updatedAt: now,
    }),
    // Conta e ativo ativos: aportar exige os dois, e é isso que o onboarding
    // prepara. Nenhuma transação de investimento é semeada — o caixa desse tipo
    // passa a existir só como espelho do ledger.
    db.doc(`workspaces/${WORKSPACE_ID}/investment_accounts/goal-e2e-account`).set({
      id: 'goal-e2e-account', workspaceId: WORKSPACE_ID, profileType: 'PF',
      name: 'Corretora Meta E2E', institutionName: 'Instituição E2E',
      currency: 'BRL', status: 'active',
      createdBy: OWNER_UID, updatedBy: OWNER_UID, createdAt: now, updatedAt: now,
    }),
    db.doc(`workspaces/${WORKSPACE_ID}/investment_assets/goal-e2e-asset`).set({
      id: 'goal-e2e-asset', workspaceId: WORKSPACE_ID, profileType: 'PF',
      name: 'CDB Meta E2E', symbol: 'CDB', assetType: 'fixed_income',
      allocationPurpose: 'retirement', currency: 'BRL', status: 'active',
      createdBy: OWNER_UID, updatedBy: OWNER_UID, createdAt: now, updatedAt: now,
    }),
    // Cadastros do formulário simples: carteira, instituição e categoria.
    ...[
      ['goal-e2e-class', 'investment_class', 'Reserva de emergência', 'reserva de emergencia', ''],
      ['goal-e2e-institution', 'investment_institution', 'BTG', 'btg', ''],
      // Categoria: catálogo genérico, subtipo investimento.
      ['goal-e2e-category', 'category', 'Renda fixa', 'renda fixa', 'investimento'],
    ].map(([id, group, name, normalizedName, transactionSubtype]) =>
      db.doc(`workspaces/${WORKSPACE_ID}/settings_catalog/${id}`).set({
        id, workspaceId: WORKSPACE_ID, group, name, normalizedName,
        ...(transactionSubtype ? { transactionSubtype } : {}),
        dedupeKey: `${group}::${transactionSubtype || 'all'}::both::${normalizedName}`,
        workspaceScope: 'both', sortOrder: 1, status: 'active',
        createdBy: OWNER_UID, updatedBy: OWNER_UID, createdAt: now, updatedAt: now,
      })),
  ]);
};

test.beforeEach(async () => {
  await seed();
});

/**
 * Financiar uma meta é criar um movimento patrimonial vinculado a ela.
 *
 * Não existe aporte em meta como lançamento de transação: o progresso vem de
 * `investmentProgressCents`, publicado a partir das posições, e o caixa aparece
 * pelo espelho que o ledger projeta. A Etapa 3 fecha o caminho pela interface —
 * o aporte nasce **dentro** da meta, com a meta já travada, e o vínculo
 * retroativo deixou de ser um botão morto.
 */
test('aporte nascido na meta publica progresso e projeta caixa uma vez', async ({page}) => {
  const db = getAdmin().firestore();
  await page.goto(`/?e2eEmail=${encodeURIComponent(OWNER_EMAIL)}&e2ePassword=${PASSWORD}`);
  await page.getByTestId('e2e-login-button').click();
  await expect(page.getByText('Saldo Atual')).toBeVisible({timeout: 30_000});

  await expect.poll(async () => (
    await db.collection(`workspaces/${WORKSPACE_ID}/settings_catalog`).where('group', '==', 'wallet').get()
  ).size).toBeGreaterThan(0);

  // Abrir a meta e aportar de dentro dela, sem passar por outra tela.
  await page.getByText('Metas', {exact: true}).first().click();
  await page.getByText('Meta M1 E2E', {exact: true}).first().click();
  await expect(page.getByRole('heading', {name: 'Histórico de investimentos'})).toBeVisible();

  // O vínculo retroativo existe de novo, e agora opera de verdade (§2.C).
  await expect(page.getByRole('button', {name: 'Vincular Existente'})).toBeVisible();

  await page.getByRole('button', {name: 'Novo Aporte'}).click();
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  // A meta vem escolhida e travada: nenhum aporte cai em outra meta por engano.
  await expect(dialogo.getByLabel('Meta', {exact: true})).toBeDisabled();
  await dialogo.getByLabel('Carteira de investimento').selectOption({label: 'Reserva de emergência'});
  await dialogo.getByLabel('Instituição').selectOption({label: 'BTG'});
  await dialogo.getByLabel('Descrição').fill('Aporte vinculado E2E');
  await dialogo.getByLabel('Categoria').selectOption({label: 'Renda fixa'});
  await dialogo.getByLabel('Valor do investimento').fill('15025');
  await dialogo.getByRole('radio', {name: 'Sim'}).check();
  await dialogo.getByRole('button', {name: 'Salvar'}).click();
  await expect(dialogo).toHaveCount(0);

  // O progresso publicado na meta é o do domínio patrimonial.
  await expect.poll(async () => (
    await db.doc(`workspaces/${WORKSPACE_ID}/goals/${GOAL_ID}`).get()
  ).data()?.investmentProgressCents, {timeout: 30_000}).toBe(15_025);

  // Um único espelho de caixa, com a saída do aporte — e nenhuma despesa.
  const espelhos = await db.collection(`workspaces/${WORKSPACE_ID}/transactions`)
    .where('investmentMetadata.investmentOperation', '==', 'contribution').get();
  expect(espelhos.size).toBe(1);
  expect(espelhos.docs[0].data().investmentMetadata.cashImpact).toBe('outflow');
  expect(espelhos.docs[0].data().type).toBe('investimento');

  // O histórico da meta traz o movimento, no vocabulário do usuário.
  await expect(page.getByText('Aporte vinculado E2E')).toBeVisible();
  await expect(page.getByRole('cell', {name: 'Aporte depositado', exact: true})).toBeVisible();
});
