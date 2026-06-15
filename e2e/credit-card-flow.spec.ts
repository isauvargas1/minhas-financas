import { expect, Page, test } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const admin = require('../functions/node_modules/firebase-admin') as typeof import('../functions/node_modules/firebase-admin');

const PROJECT_ID = 'minhas-financas-local';
const E2E_PASSWORD = 'e2e-password-123456';

const OWNER_UID = 'e2e-owner-credit-card';
const ADMIN_UID = 'e2e-admin-credit-card';
const MEMBER_UID = 'e2e-member-credit-card';

const OWNER_EMAIL = 'e2e-owner-credit-card@minhas-financas.local';
const ADMIN_EMAIL = 'e2e-admin-credit-card@minhas-financas.local';
const MEMBER_EMAIL = 'e2e-member-credit-card@minhas-financas.local';

const WORKSPACE_ID = 'workspace-e2e-credit-card-domain';
const CARD_PERMISSION_ID = 'card-e2e-permission';
const CARD_PERMISSION_NAME = 'Cartão Permissão E2E';

type FirebaseAdmin = typeof admin;

interface SeedUserInput {
  uid: string;
  email: string;
  role: 'owner' | 'admin' | 'member';
}

interface CreatedCardReference {
  id: string;
  name: string;
}

interface PurchaseInput {
  cardId: string;
  description: string;
  amount: string;
  installments: string;
}

const configureEmulatorEnvironment = () => {
  process.env.GCLOUD_PROJECT = PROJECT_ID;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
};

const getAdmin = (): FirebaseAdmin => {
  configureEmulatorEnvironment();

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: PROJECT_ID,
    });
  }

  return admin;
};

const getDb = () => getAdmin().firestore();

const resetEmulatorData = async (): Promise<void> => {
  const initializedAdmin = getAdmin();
  const db = initializedAdmin.firestore();

  const users = await initializedAdmin.auth().listUsers(1000);

  if (users.users.length > 0) {
    await initializedAdmin.auth().deleteUsers(users.users.map((user) => user.uid));
  }

  const collections = await db.listCollections();

  await Promise.all(
    collections.map((collectionRef: FirebaseFirestore.CollectionReference) =>
      db.recursiveDelete(collectionRef)
    )
  );
};

const createAuthUser = async ({ uid, email }: Pick<SeedUserInput, 'uid' | 'email'>): Promise<void> => {
  await getAdmin().auth().createUser({
    uid,
    email,
    password: E2E_PASSWORD,
    emailVerified: true,
  });
};

const seedWorkspaceMembership = async ({ uid, email, role }: SeedUserInput): Promise<void> => {
  const db = getDb();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await Promise.all([
    db.doc(`workspaces/${WORKSPACE_ID}/members/${uid}`).set({
      uid,
      email,
      displayName: email,
      role,
      status: 'active',
      joinedAt: now,
    }),
    db.doc(`users/${uid}/workspaces/${WORKSPACE_ID}`).set({
      workspaceId: WORKSPACE_ID,
      role,
      createdAt: now,
      updatedAt: now,
    }),
  ]);
};

const seedWorkspace = async (): Promise<void> => {
  const db = getDb();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.doc(`workspaces/${WORKSPACE_ID}`).set({
    name: 'Workspace E2E Cartão',
    type: 'PF',
    userId: OWNER_UID,
    ownerId: OWNER_UID,
    themeColor: '#4f46e5',
    currency: 'BRL',
    createdAt: now,
    updatedAt: now,
  });

  await Promise.all([
    createAuthUser({ uid: OWNER_UID, email: OWNER_EMAIL }),
    createAuthUser({ uid: ADMIN_UID, email: ADMIN_EMAIL }),
    createAuthUser({ uid: MEMBER_UID, email: MEMBER_EMAIL }),
  ]);

  await Promise.all([
    seedWorkspaceMembership({ uid: OWNER_UID, email: OWNER_EMAIL, role: 'owner' }),
    seedWorkspaceMembership({ uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin' }),
    seedWorkspaceMembership({ uid: MEMBER_UID, email: MEMBER_EMAIL, role: 'member' }),
  ]);
};

const seedPermissionCard = async (): Promise<void> => {
  const db = getDb();
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.doc(`workspaces/${WORKSPACE_ID}/credit_cards/${CARD_PERMISSION_ID}`).set({
    workspaceId: WORKSPACE_ID,
    name: CARD_PERMISSION_NAME,
    brand: 'Visa',
    status: 'active',
    limitTotal: 5000,
    closingDay: 1,
    dueDay: 10,
    visual: {
      bgType: 'color',
      bgColor: '#1e293b',
      bgGradientColor: '#3b82f6',
      bgImage: '',
      textColor: 'white',
      showName: true,
      showBrand: true,
      showLogo: true,
    },
    createdAt: now,
    updatedAt: now,
  });
};

const waitUntil = async <T>(
  callback: () => Promise<T | undefined>,
  message: string,
  timeoutMs = 30_000
): Promise<T> => {
  const startedAt = Date.now();
  let lastResult: T | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    lastResult = await callback();

    if (lastResult) {
      return lastResult;
    }

    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  throw new Error(message);
};

const findWorkspaceCollectionDoc = async <T extends FirebaseFirestore.DocumentData>(
  collectionName: string,
  predicate: (data: T, id: string) => boolean
): Promise<{ id: string; data: T } | undefined> => {
  const snapshot = await getDb()
    .collection(`workspaces/${WORKSPACE_ID}/${collectionName}`)
    .get();

  const found = snapshot.docs.find((documentSnapshot) =>
    predicate(documentSnapshot.data() as T, documentSnapshot.id)
  );

  if (!found) {
    return undefined;
  }

  return {
    id: found.id,
    data: found.data() as T,
  };
};

const loginAs = async (page: Page, email: string): Promise<void> => {
  await page.goto(`/?e2eEmail=${encodeURIComponent(email)}&e2ePassword=${encodeURIComponent(E2E_PASSWORD)}`);

  await page.getByTestId('e2e-login-button').click();

  await expect(page.getByText(/Transações Recentes|Saldo Atual|Dashboard/i).first()).toBeVisible({
    timeout: 30_000,
  });
};

const navigateBySidebar = async (page: Page, name: RegExp): Promise<void> => {
  await page.getByRole('link', { name }).click();
};

const createCardThroughUi = async (page: Page, cardName: string): Promise<CreatedCardReference> => {
  await navigateBySidebar(page, /Cartões de Crédito|Cartões Corporativos/i);

  await page.getByRole('button', { name: /Novo Cartão/i }).click();

  const cardForm = page.locator('form#cardForm');

  await cardForm.getByPlaceholder('Ex: Nubank Empresarial').fill(cardName);
  await cardForm.locator('input[type="number"]').nth(0).fill('5000');
  await cardForm.locator('input[type="number"]').nth(1).fill('1');
  await cardForm.locator('input[type="number"]').nth(2).fill('10');

  await page.getByRole('button', { name: 'Salvar Cartão' }).click();

  await expect(page.getByText(cardName).first()).toBeVisible({
    timeout: 20_000,
  });

  const cardDoc = await waitUntil(
    () =>
      findWorkspaceCollectionDoc<{ name?: string }>(
        'credit_cards',
        (data) => data.name === cardName
      ),
    `Cartão ${cardName} não foi persistido no Firestore Emulator.`
  );

  return {
    id: cardDoc.id,
    name: cardName,
  };
};

const createCreditCardPurchaseThroughUi = async (
  page: Page,
  input: PurchaseInput
): Promise<void> => {
  await navigateBySidebar(page, /Dashboard/i);

  await page.getByRole('button', { name: /Nova Transação/i }).click();
  await page.getByRole('button', { name: /^Cartão$/i }).click();

  const transactionForm = page.locator('form').last();

  await transactionForm.locator('select').nth(0).selectOption(input.cardId);
  await transactionForm.getByRole('combobox').fill(input.description);
  await transactionForm.getByRole('combobox').press('Enter');
  await transactionForm.locator('select').nth(1).selectOption({ label: 'Alimentação' });
  await transactionForm.locator('input[type="number"]').nth(0).fill(input.amount);
  await transactionForm.locator('input[type="number"]').nth(1).fill(input.installments);

  await page.getByRole('button', { name: /Revisar e Adicionar Parcelado/i }).click();

  await expect(page.getByText(/parcela\(s\) geradas na fatura/i)).toBeVisible({
    timeout: 30_000,
  });

  await waitUntil(
    () =>
      findWorkspaceCollectionDoc<{ description?: string }>(
        'credit_card_purchases',
        (data) => data.description === input.description
      ),
    `Compra ${input.description} não foi persistida no domínio de cartão.`
  );
};

const openCardDetails = async (page: Page, cardName: string): Promise<void> => {
  await navigateBySidebar(page, /Cartões de Crédito|Cartões Corporativos/i);

  await page.getByText(cardName).first().click();

  await expect(page.getByText('Detalhes do Cartão')).toBeVisible({
    timeout: 20_000,
  });
};

const openInvoiceDetailsByIndex = async (page: Page, index: number): Promise<void> => {
  await page.getByRole('button', { name: /Ver detalhes da fatura/i }).nth(index).click();

  await expect(page.getByText('Detalhe da fatura')).toBeVisible({
    timeout: 20_000,
  });
};

test.describe('Fluxos E2E do domínio de cartão', () => {
  test.beforeEach(async () => {
    await resetEmulatorData();
    await seedWorkspace();
  });

  test('owner executa compra, pagamento, estorno, cancelamento e valida relatórios sem saída imediata', async ({ page }) => {
    await loginAs(page, OWNER_EMAIL);

    const card = await createCardThroughUi(page, 'Cartão Fluxo E2E');

    await createCreditCardPurchaseThroughUi(page, {
      cardId: card.id,
      description: 'Compra cancelável E2E',
      amount: '50',
      installments: '1',
    });

    await openCardDetails(page, card.name);
    await openInvoiceDetailsByIndex(page, 0);

    page.once('dialog', async (dialog) => {
      await dialog.accept('Cancelamento E2E');
    });

    await page.getByRole('button', { name: /Cancelar compra/i }).first().click();

    await waitUntil(
      () =>
        findWorkspaceCollectionDoc<{ description?: string; status?: string }>(
          'credit_card_purchases',
          (data) => data.description === 'Compra cancelável E2E' && data.status === 'cancelled'
        ),
      'Cancelamento de compra não foi refletido no domínio.'
    );

    await page.getByLabel('Fechar detalhe da fatura').click();
    await page.getByRole('button', { name: /Fechar detalhe/i }).click().catch(() => undefined);

    await createCreditCardPurchaseThroughUi(page, {
      cardId: card.id,
      description: 'Compra à vista E2E',
      amount: '100',
      installments: '1',
    });

    await createCreditCardPurchaseThroughUi(page, {
      cardId: card.id,
      description: 'Compra parcelada E2E',
      amount: '300',
      installments: '3',
    });

    await expect(
      page.getByRole('button', { name: /Despesas\s+R\$\s*0,00/i })
    ).toBeVisible({
      timeout: 20_000,
    });

    await navigateBySidebar(page, /Relatórios/i);

    await expect(page.getByText(/Indicadores de Cartão de Crédito/i)).toBeVisible({
      timeout: 30_000,
    });

    await expect(page.getByText(card.name).first()).toBeVisible({
      timeout: 30_000,
    });

    await openCardDetails(page, card.name);
    await expect(page.getByText(/Fatura/i).first()).toBeVisible();

    await page.getByRole('button', { name: /Pagar total/i }).first().click();
    await page.getByRole('button', { name: /Confirmar pagamento/i }).click();

    await waitUntil(
      () =>
        findWorkspaceCollectionDoc<{ status?: string; paidAmount?: number }>(
          'credit_card_invoices',
          (data) => data.status === 'paid' && Number(data.paidAmount || 0) > 0
        ),
      'Pagamento total não marcou a fatura como paga.'
    );

    await openInvoiceDetailsByIndex(page, 1);

    await page.getByRole('button', { name: /Pagamento parcial/i }).click();

    const paymentModal = page.getByText('Pagamento de fatura').locator('xpath=ancestor::div[contains(@class, "rounded-2xl")]');

    await paymentModal.locator('input[type="number"]').fill('40');
    await paymentModal.getByRole('button', { name: /Confirmar pagamento/i }).click();

    await waitUntil(
      () =>
        findWorkspaceCollectionDoc<{ status?: string; paidAmount?: number; remainingAmount?: number }>(
          'credit_card_invoices',
          (data) =>
            data.status === 'partial_paid' &&
            Number(data.paidAmount || 0) === 40 &&
            Number(data.remainingAmount || 0) > 0
        ),
      'Pagamento parcial não deixou a fatura como partial_paid.'
    );

    await expect(page.getByRole('button', { name: /Estornar/i })).toBeVisible({
      timeout: 30_000,
    });

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.getByRole('button', { name: /Estornar/i }).click();

    await waitUntil(
      () =>
        findWorkspaceCollectionDoc<{ status?: string }>(
          'credit_card_invoice_payments',
          (data) => data.status === 'reversed'
        ),
      'Estorno não atualizou o pagamento para reversed.'
    );
  });

  test('member não visualiza ações administrativas do domínio de cartão', async ({ page }) => {
    await seedPermissionCard();

    await loginAs(page, MEMBER_EMAIL);

    await openCardDetails(page, CARD_PERMISSION_NAME);

    await expect(page.getByText('Administração')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Recalcular limite/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Rebuild de faturas/i })).toHaveCount(0);
  });

  test('admin visualiza ações administrativas permitidas do domínio de cartão', async ({ page }) => {
    await seedPermissionCard();

    await loginAs(page, ADMIN_EMAIL);

    await openCardDetails(page, CARD_PERMISSION_NAME);

    await expect(page.getByText('Administração')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('button', { name: /Recalcular limite/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Rebuild de faturas/i })).toBeVisible();
  });
});