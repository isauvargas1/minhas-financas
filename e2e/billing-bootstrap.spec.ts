import { expect, test, type Page } from '@playwright/test';

import { adminSdk } from './support/workspaceSeed';

/**
 * P2A.1 — o billing só é lido depois do bootstrap da conta, de ponta a ponta
 * no Emulator (Auth, Firestore e Functions).
 *
 * A resposta de `bootstrapAccount` é retida de propósito, abrindo a janela da
 * corrida entre o Auth e o bootstrap: nenhuma leitura de
 * `billing_accounts/{uid}` (canal do Firestore) nem chamada de
 * `getBillingCatalog` pode sair antes dela. Depois, o Free aparece sem
 * recarregar a página, o listener canônico reflete o backend e a troca
 * A → logout → B não reaproveita o billing de A.
 */

const PASSWORD = 'e2e-password-123456';
const BOOTSTRAP_HOLD_MS = 2_000;
const BILLING_READ_ERROR = 'Falha ao ler a conta de cobrança';

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

interface BillingTraffic {
  bootstrapAnsweredAt: number[];
  catalogRequestedAt: number[];
  billingReadsAt: Map<string, number[]>;
  billingErrorsAt: number[];
}

const decodeBody = (body: string): string => {
  try {
    return decodeURIComponent(body.replace(/\+/g, ' '));
  } catch {
    return body;
  }
};

/** Retém a resposta do bootstrap e registra catálogo e leituras de billing. */
const watchBillingTraffic = async (page: Page): Promise<BillingTraffic> => {
  const traffic: BillingTraffic = {
    bootstrapAnsweredAt: [],
    catalogRequestedAt: [],
    billingReadsAt: new Map(),
    billingErrorsAt: [],
  };
  await page.route('**/bootstrapAccount', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, BOOTSTRAP_HOLD_MS));
    traffic.bootstrapAnsweredAt.push(Date.now());
    await route.fulfill({ response });
  });
  page.on('request', (request) => {
    const url = request.url();
    if (request.method() === 'POST' && url.includes('/getBillingCatalog')) {
      traffic.catalogRequestedAt.push(Date.now());
    }
    // Alvos de listen/leitura do Firestore viajam no corpo dos POSTs do canal.
    if (url.includes(':8080/') && request.method() === 'POST') {
      const body = decodeBody(request.postData() ?? '');
      for (const match of body.matchAll(/billing_accounts\/([\w-]+)/g)) {
        const reads = traffic.billingReadsAt.get(match[1]) ?? [];
        reads.push(Date.now());
        traffic.billingReadsAt.set(match[1], reads);
      }
    }
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes(BILLING_READ_ERROR)) {
      traffic.billingErrorsAt.push(Date.now());
    }
  });
  return traffic;
};

const expectDashboard = async (page: Page) => {
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first()).toBeVisible({
    timeout: 45_000,
  });
};

const openPlans = async (page: Page) => {
  await page.getByText('Meu Plano', { exact: true }).first().click();
  await expect(page.getByText('Planos e Assinaturas')).toBeVisible();
};

/** Nenhuma leitura de billing nem catálogo antes da resposta do bootstrap. */
const expectBillingAfterBootstrap = (
  traffic: BillingTraffic,
  uid: string,
  since: number,
  { expectCatalogRequest }: { expectCatalogRequest: boolean },
) => {
  const answered = traffic.bootstrapAnsweredAt.filter((at) => at >= since);
  expect(answered.length, 'bootstrap respondido').toBeGreaterThan(0);
  const bootstrapDone = Math.min(...answered);
  const reads = (traffic.billingReadsAt.get(uid) ?? []).filter((at) => at >= since);
  expect(reads.length, 'listener canônico ativo').toBeGreaterThan(0);
  expect(Math.min(...reads), 'leitura de billing antes do bootstrap')
    .toBeGreaterThanOrEqual(bootstrapDone);
  const catalog = traffic.catalogRequestedAt.filter((at) => at >= since);
  if (expectCatalogRequest) expect(catalog.length, 'catálogo pedido').toBeGreaterThan(0);
  for (const at of catalog) {
    expect(at, 'catálogo antes do bootstrap').toBeGreaterThanOrEqual(bootstrapDone);
  }
};

/**
 * Nenhum listener de billing morre com erro durante a sessão: um listener do
 * usuário anterior ainda vivo, ou uma leitura antes do bootstrap, seria negado
 * pelas Rules e cairia aqui. O logout (troca de credencial no SDK) fica fora
 * da janela: é a desmontagem da sessão anterior.
 */
const expectNoBillingErrors = (traffic: BillingTraffic, from: number, until: number) => {
  expect(traffic.billingErrorsAt.filter((at) => at >= from && at < until), 'erro de leitura de billing')
    .toEqual([]);
};

/** A tela de login lê o e-mail de teste da URL ao montar (no logout). */
const logoutTo = async (page: Page, nextEmail: string) => {
  const url = new URL(page.url());
  url.searchParams.set('e2eEmail', nextEmail);
  await page.evaluate((next) => window.history.replaceState(null, '', next), url.toString());
  await page.getByText('Sair', { exact: true }).first().click();
  await expect(page.getByTestId('e2e-login-button')).toBeVisible();
};

test.beforeEach(async () => {
  await resetEmulatorData();
});

test('billing só é lido depois do bootstrap: primeiro login, conta existente e troca de conta', async ({ page }) => {
  test.setTimeout(150_000);
  const a = { uid: 'e2e-p2a1-account-a', email: 'e2e-p2a1-account-a@minhas-financas.local' };
  const b = { uid: 'e2e-p2a1-account-b', email: 'e2e-p2a1-account-b@minhas-financas.local' };
  for (const user of [a, b]) {
    await adminSdk().auth().createUser({
      uid: user.uid, email: user.email, password: PASSWORD, emailVerified: true,
    });
  }
  const db = adminSdk().firestore();
  expect((await db.doc(`users/${a.uid}`).get()).exists).toBe(false);
  const traffic = await watchBillingTraffic(page);

  // 1. Primeiro login de A (sem `users/{uid}` nem billing): nada de billing
  // antes do bootstrap; o Free aparece sem recarregar, com o catálogo.
  await page.goto(`/?e2eEmail=${encodeURIComponent(a.email)}`);
  let since = Date.now();
  await page.getByTestId('e2e-login-button').click();
  await expectDashboard(page);
  await openPlans(page);
  await expect(page.getByRole('button', { name: 'Plano Atual' })).toBeVisible();
  await expect(page.getByText(/R\$\s*29,90/).first()).toBeVisible();
  await expect(page.getByText(/R\$\s*59,90/).first()).toBeVisible();
  expect((await db.doc(`billing_accounts/${a.uid}`).get()).get('planId')).toBe('free');
  expectBillingAfterBootstrap(traffic, a.uid, since, { expectCatalogRequest: true });

  // O listener canônico segue vivo: o estado gravado pelo backend chega à
  // tela sem recarregar.
  await db.doc(`billing_accounts/${a.uid}`).update({
    planId: 'pro',
    entitlementStatus: 'active',
    subscriptionStatus: 'active',
    stripeCustomerId: 'cus_e2e_p2a1_a',
    stripeSubscriptionId: 'sub_e2e_p2a1_a',
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  await expect(page.getByRole('button', { name: 'Gerenciar assinatura' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Plano Gratuito' })).toBeVisible();

  expectNoBillingErrors(traffic, since, Date.now());

  // 2. A → logout → B (conta nova) na mesma página: nenhuma leitura de B
  // antes do bootstrap de B, nenhum listener de A vivo e nada do plano de A.
  await logoutTo(page, b.email);
  since = Date.now();
  await page.getByTestId('e2e-login-button').click();
  await expectDashboard(page);
  await openPlans(page);
  await expect(page.getByRole('button', { name: 'Plano Atual' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gerenciar assinatura' })).toHaveCount(0);
  expectBillingAfterBootstrap(traffic, b.uid, since, { expectCatalogRequest: true });
  expectNoBillingErrors(traffic, since, Date.now());

  // 3. A volta (conta já preparada): o billing de A continua funcionando e
  // também só é lido depois do bootstrap.
  await logoutTo(page, a.email);
  since = Date.now();
  await page.getByTestId('e2e-login-button').click();
  await expectDashboard(page);
  await openPlans(page);
  await expect(page.getByRole('button', { name: 'Gerenciar assinatura' }).first()).toBeVisible();
  expectBillingAfterBootstrap(traffic, a.uid, since, { expectCatalogRequest: false });
  expectNoBillingErrors(traffic, since, Date.now());
});
