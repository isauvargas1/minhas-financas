import { expect, test, type Page, type Request, type Route } from '@playwright/test';

import { adminSdk } from './support/workspaceSeed';

/**
 * P2C-H2 — checkout e portal pela interface, com a fronteira do Stripe
 * simulada.
 *
 * Tudo é real no Emulator (Auth, `bootstrapAccount`, catálogo, listener do
 * documento canônico `billing_accounts/{uid}` e Rules), exceto a fronteira do
 * provedor: as duas callables que dependem do Stripe são interceptadas na rede
 * do navegador para devolver a URL de uma sessão simulada (ou uma falha), e os
 * destinos de redirecionamento são páginas falsas. Assim o teste prova o
 * contrato da interface — nome da callable, payload (só `planId`, nunca preço
 * do provedor), carregamento, erro e redirecionamento — sem credencial nem
 * rede. A integração do backend com o Stripe falso continua nas suítes de
 * `functions/src/billing/__tests__`; uma não substitui a outra.
 *
 * Um teste não intercepta nada: sem configuração do Stripe no Emulator, a
 * callable real falha fechada e a tela mostra a mensagem do backend.
 */

const PASSWORD = 'e2e-billing-checkout-password';
const ORIGIN = 'http://127.0.0.1:5173';
const CHECKOUT_HOST = 'https://checkout.stripe.test';
const PORTAL_HOST = 'https://billing.stripe.test';

interface Persona {
  uid: string;
  email: string;
}

const persona = (suffix: string): Persona => ({
  uid: `e2e-billing-${suffix}`,
  email: `e2e-billing-${suffix}@minhas-financas.local`,
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
  await expect(page.getByText(/Transações Recentes|Saldo Atual/i).first())
    .toBeVisible({ timeout: 45_000 });
};

const openPlans = async (page: Page) => {
  await page.getByText('Meu Plano', { exact: true }).first().click();
  await expect(page.getByText('Planos e Assinaturas')).toBeVisible();
};

/** Card do plano pelo título do catálogo. */
const planCard = (page: Page, name: string) =>
  page.locator('div.shadow-sm.divide-y').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });

/** Região da tela de planos (alertas da própria tela). */
const plansView = (page: Page) =>
  page.locator('div.py-12').filter({
    has: page.getByRole('heading', { name: 'Planos e Assinaturas' }),
  });

/** Assinatura gerenciável, como o webhook a deixaria (dados sintéticos). */
const seedActiveSubscription = async (uid: string) => {
  await adminSdk().firestore().doc(`billing_accounts/${uid}`).update({
    planId: 'pro',
    entitlementStatus: 'active',
    subscriptionStatus: 'active',
    stripeCustomerId: `cus_e2e_${uid}`,
    stripeSubscriptionId: `sub_e2e_${uid}`,
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
};

interface CallableCall {
  data: Record<string, unknown>;
}

type Reply = (
  | { kind: 'result'; result: Record<string, unknown> }
  | { kind: 'error'; status: number; body?: Record<string, unknown> }
) & {
  /** Retém esta resposta até ser liberada (observa o carregamento). */
  hold?: Promise<void>;
};

/**
 * Intercepta uma callable do Emulator de Functions e responde como o
 * protocolo de callable responderia (`{result}` ou `{error}`), registrando o
 * payload. O preflight CORS segue para o Emulator real.
 */
const interceptCallable = async (
  page: Page,
  name: string,
  replies: Reply[],
) => {
  const calls: CallableCall[] = [];
  await page.route(`**/southamerica-east1/${name}`, async (route: Route, request: Request) => {
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    calls.push(JSON.parse(request.postData() ?? '{}') as CallableCall);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (reply.hold) await reply.hold;
    const headers = {
      'access-control-allow-origin': request.headers().origin ?? ORIGIN,
      'content-type': 'application/json',
    };
    if (reply.kind === 'result') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ result: reply.result }) });
    } else {
      await route.fulfill({
        status: reply.status,
        headers,
        body: reply.body ? JSON.stringify(reply.body) : '',
      });
    }
  });
  return calls;
};

/** Destino simulado do provedor: uma página falsa, sem rede. */
const fakeDestination = async (page: Page, host: string, title: string) => {
  await page.route(`${host}/**`, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html lang="pt-BR"><body><h1>${title}</h1></body></html>`,
  }));
};

/** Registra chamadas reais (não interceptadas) de uma callable. */
const countRequests = (page: Page, name: string) => {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith(`/${name}`)) seen.push(request.url());
  });
  return seen;
};

test('conta Free: o upgrade envia só o planId, trata a falha e redireciona ao checkout simulado', async ({ page }) => {
  test.setTimeout(120_000);
  const user = persona('free');
  await resetPersona(user);
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const portalCalls = countRequests(page, 'createBillingPortalSession');
  const checkoutCalls = await interceptCallable(page, 'createCheckoutSession', [
    // 1ª tentativa: HTTP 429 da plataforma, sem corpo do backend.
    { kind: 'error', status: 429 },
    // 2ª tentativa: recusa de negócio do backend, com mensagem pt-BR.
    {
      kind: 'error',
      status: 400,
      body: {
        error: {
          status: 'FAILED_PRECONDITION',
          message: 'Já existe um pagamento sendo preparado. Aguarde alguns segundos e tente novamente.',
        },
      },
    },
    // 3ª tentativa: sessão criada; a resposta fica retida até a conferência.
    { kind: 'result', result: { url: `${CHECKOUT_HOST}/c/pay/cs_test_e2e_business` }, hold: held },
  ]);
  await fakeDestination(page, CHECKOUT_HOST, 'Checkout simulado');

  await login(page, user);
  await openPlans(page);
  await expect(page.getByRole('button', { name: 'Plano Atual' })).toBeVisible();
  const pro = planCard(page, 'Pro').getByRole('button', { name: 'Fazer Upgrade' });
  const business = planCard(page, 'Business').getByRole('button', { name: 'Fazer Upgrade' });
  await expect(pro).toBeEnabled();
  await expect(business).toBeEnabled();
  // Conta Free: nenhum plano pago aparece como contratado.
  await expect(plansView(page).locator('[aria-current="true"]')).toHaveCount(0);

  // Falha da plataforma: mensagem genérica em pt-BR, nunca o código cru.
  await pro.click();
  const alert = plansView(page).getByRole('alert');
  await expect(alert).toHaveText('Não foi possível iniciar o pagamento. Tente novamente.');
  await expect(page.getByText('resource-exhausted')).toHaveCount(0);

  // Recusa do backend: a mensagem dele, como veio.
  await pro.click();
  await expect(alert).toHaveText(
    'Já existe um pagamento sendo preparado. Aguarde alguns segundos e tente novamente.',
  );

  // Sucesso pelo Business, com a resposta retida e clique duplo: um único
  // pedido, carregamento só no botão acionado e os demais travados.
  const sending = page.waitForRequest((request) =>
    request.method() === 'POST' && request.url().endsWith('/createCheckoutSession'));
  await business.dblclick();
  await sending;
  await expect(planCard(page, 'Business').getByRole('button')).toBeDisabled();
  await expect(planCard(page, 'Pro').getByRole('button')).toBeDisabled();
  await expect(planCard(page, 'Business').getByLabel('Carregando')).toBeVisible();
  await expect(planCard(page, 'Pro').getByLabel('Carregando')).toHaveCount(0);
  await expect(planCard(page, 'Pro').getByRole('button')).toHaveText('Fazer Upgrade');
  // O bloqueio também aparece: botão pago desabilitado com opacidade reduzida.
  await expect(planCard(page, 'Pro').getByRole('button')).toHaveCSS('opacity', '0.6');
  await expect(plansView(page).getByRole('alert')).toHaveCount(0);
  release();
  await page.waitForURL(`${CHECKOUT_HOST}/**`);
  await expect(page.getByRole('heading', { name: 'Checkout simulado' })).toBeVisible();
  expect(page.url()).toBe(`${CHECKOUT_HOST}/c/pay/cs_test_e2e_business`);

  // Contrato: callable de checkout, um plano por clique, nenhum preço do
  // provedor e uma chave de idempotência nova por intenção.
  expect(checkoutCalls.map((call) => call.data.planId)).toEqual(['pro', 'pro', 'business']);
  for (const call of checkoutCalls) {
    expect(Object.keys(call.data).sort()).toEqual(['idempotencyKey', 'planId', 'returnUrl']);
    expect(call.data.returnUrl).toBe(ORIGIN);
    expect(typeof call.data.idempotencyKey).toBe('string');
    expect(JSON.stringify(call)).not.toMatch(/price_|priceId/);
  }
  expect(new Set(checkoutCalls.map((call) => call.data.idempotencyKey)).size).toBe(3);
  expect(portalCalls).toEqual([]);
});

test('assinante: "Gerenciar assinatura" abre o portal simulado e nunca inicia checkout', async ({ page }) => {
  test.setTimeout(120_000);
  const user = persona('subscriber');
  await resetPersona(user);
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const checkoutCalls = countRequests(page, 'createCheckoutSession');
  const portalCalls = await interceptCallable(page, 'createBillingPortalSession', [
    {
      kind: 'error',
      status: 400,
      body: {
        error: {
          status: 'FAILED_PRECONDITION',
          message: 'Você ainda não tem uma assinatura para gerenciar.',
          details: { reason: 'billing_customer_missing' },
        },
      },
    },
    { kind: 'result', result: { url: `${PORTAL_HOST}/p/session/test_e2e_portal` }, hold: held },
  ]);
  await fakeDestination(page, PORTAL_HOST, 'Portal simulado');

  await login(page, user);
  await seedActiveSubscription(user.uid);
  await openPlans(page);
  // Assinatura gerenciável: os dois planos pagos levam ao portal; não há
  // caminho de contratação para uma segunda assinatura.
  const manage = page.getByRole('button', { name: 'Gerenciar assinatura' });
  await expect(manage).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Fazer Upgrade' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Plano Gratuito' })).toBeDisabled();
  // O plano em vigor (Pro ativo no documento canônico) é o único destacado.
  await expect(planCard(page, 'Pro')).toHaveAttribute('aria-current', 'true');
  await expect(planCard(page, 'Pro').getByText('Plano atual', { exact: true })).toBeVisible();
  await expect(planCard(page, 'Business')).not.toHaveAttribute('aria-current', 'true');
  await expect(plansView(page).getByText('Plano atual', { exact: true })).toHaveCount(1);

  await manage.first().click();
  await expect(plansView(page).getByRole('alert')).toHaveText('Você ainda não tem uma assinatura para gerenciar.');

  // Resposta do portal retida: carregamento só no botão acionado (Business).
  await manage.last().click();
  await expect(planCard(page, 'Business').getByLabel('Carregando')).toBeVisible();
  await expect(planCard(page, 'Pro').getByLabel('Carregando')).toHaveCount(0);
  await expect(planCard(page, 'Pro').getByRole('button')).toBeDisabled();
  release();
  await page.waitForURL(`${PORTAL_HOST}/**`);
  await expect(page.getByRole('heading', { name: 'Portal simulado' })).toBeVisible();

  expect(portalCalls).toHaveLength(2);
  for (const call of portalCalls) {
    expect(call.data).toEqual({ returnUrl: ORIGIN });
  }
  expect(checkoutCalls).toEqual([]);
});

test('conta sem estado confiável: falha de leitura do documento canônico bloqueia contratação e gestão', async ({ page }) => {
  /*
   * O estado "carregando" (antes do primeiro snapshot) não é isolável aqui:
   * reter o pedido do listener no canal do Firestore segura também as demais
   * leituras do app (o WebChannel serializa os pedidos) e o app autenticado
   * nem monta. Esse estado tem guarda no teste do cliente
   * (`tests/unit/billing-client.test.ts`). Este teste exercita o mesmo bloqueio
   * (`accountStatus !== 'ready'`) pelo caminho real: as Rules passam a negar
   * a leitura do documento canônico e o listener falha.
   */
  test.setTimeout(120_000);
  const user = persona('not-ready');
  await resetPersona(user);
  const checkoutCalls = countRequests(page, 'createCheckoutSession');
  const portalCalls = countRequests(page, 'createBillingPortalSession');

  await login(page, user);
  await openPlans(page);
  await expect(page.getByRole('button', { name: 'Plano Atual' })).toBeVisible();
  await expect(planCard(page, 'Pro').getByRole('button', { name: 'Fazer Upgrade' })).toBeEnabled();

  // Conta suspensa no meio da sessão (dado sintético): as Rules negam a
  // leitura de `billing_accounts/{uid}` e o listener falha na próxima mudança.
  const db = adminSdk().firestore();
  await db.doc(`users/${user.uid}`).update({ status: 'suspended' });
  await db.doc(`billing_accounts/${user.uid}`).update({ updatedAt: new Date() });
  await expect(plansView(page).getByRole('alert')).toHaveText(
    'Não foi possível carregar sua assinatura. Atualize a página para tentar novamente.',
  );
  const pro = planCard(page, 'Pro').getByRole('button');
  const business = planCard(page, 'Business').getByRole('button');
  await expect(pro).toBeDisabled();
  await expect(business).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Plano Atual' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Gerenciar assinatura' })).toHaveCount(0);
  // O botão desabilitado não dispara nada, nem com clique forçado.
  await pro.click({ force: true });
  await business.click({ force: true });

  expect(checkoutCalls).toEqual([]);
  expect(portalCalls).toEqual([]);
});

test('sem configuração do Stripe, a callable real falha fechada e a tela mostra a mensagem do backend', async ({ page }) => {
  test.setTimeout(120_000);
  const user = persona('fail-closed');
  await resetPersona(user);
  const navigations: string[] = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });

  await login(page, user);
  await openPlans(page);
  const response = page.waitForResponse((res) =>
    res.request().method() === 'POST' && res.url().endsWith('/createCheckoutSession'));
  await planCard(page, 'Pro').getByRole('button', { name: 'Fazer Upgrade' }).click();
  const answered = await response;
  expect(answered.status()).toBe(400);
  expect(JSON.parse(answered.request().postData() ?? '{}').data.planId).toBe('pro');
  await expect(plansView(page).getByRole('alert')).toHaveText(
    'Cobrança indisponível no momento. Tente novamente mais tarde.',
  );
  // Nada de redirecionamento: a página continua na aplicação.
  expect(navigations.every((url) => url.startsWith(ORIGIN))).toBe(true);
  const billing = await adminSdk().firestore().doc(`billing_accounts/${user.uid}`).get();
  expect(billing.get('planId')).toBe('free');
  expect(billing.get('stripeCustomerId') ?? null).toBeNull();
});
