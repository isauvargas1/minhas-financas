import assert from "node:assert/strict";
import test from "node:test";

import {ApplicationError} from "../../shared/errors";
import {seedActiveAccount} from "../../shared/testSupport/kernelTestSupport";
import {bootstrapAccount} from "../../workspaces/callables";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  createBillingPortalSession,
  createCheckoutSession,
  getBillingCatalog,
} from "../callables";
import {
  CHECKOUT_RATE_LIMIT,
  executeCreateCheckoutSession,
} from "../checkout";
import {executeCreateBillingPortalSession} from "../portal";
import {
  billingAccount,
  billingEvents,
  billingHarness,
  bootstrapUser,
  callerFor,
  silentLogger,
  type BillingHarness,
} from "../testSupport/billingTestSupport";

/**
 * Checkout, Customer Portal e bootstrap de billing (P2A) no Emulator, com o
 * Stripe falso: sem rede e sem credenciais.
 */
const returnUrl = (harness: BillingHarness) =>
  `${harness.env.APP_ALLOWED_ORIGINS}/app`;

const checkout = (
  harness: BillingHarness,
  uid: string,
  planId: "pro" | "business" = "pro",
  key = idempotencyKey(),
) => executeCreateCheckoutSession(harness.checkoutDeps, {
  caller: callerFor(uid),
  payload: {planId, returnUrl: returnUrl(harness), idempotencyKey: key},
  requestId: uniqueId("req"),
  log: silentLogger(),
});

const rejectsWith = async (
  promise: Promise<unknown>,
  code: string,
  reason?: string,
) => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApplicationError, String(error));
    assert.equal(error.code, code, error.message);
    if (reason) assert.equal(error.details?.reason, reason);
    return true;
  });
};

const openSessionsOf = (harness: BillingHarness, customerId: string) =>
  [...harness.stripe.sessions.values()].filter((session) =>
    session.customerId === customerId && session.status === "open");

// ------------------------------------------------------------- bootstrap

test("bootstrap cria billing Free válido, idempotente e sob concorrência", async () => {
  const uid = uniqueId("bill-boot");
  await Promise.all([
    call(bootstrapAccount, uid, {}),
    call(bootstrapAccount, uid, {}),
    call(bootstrapAccount, uid, {}),
  ]);
  const account = await billingAccount(uid);
  assert.equal(account.billingOwnerUid, uid);
  assert.equal(account.planId, "free");
  assert.equal(account.entitlementStatus, "free");
  assert.equal(account.subscriptionStatus, "none");
  assert.equal(account.catalogVersion, 1);
  assert.equal(account.stripeCustomerId, null);
  assert.ok(account.createdAt);

  // Estado existente nunca é sobrescrito por um novo bootstrap.
  await db().doc(`billing_accounts/${uid}`).update({planId: "pro"});
  await call(bootstrapAccount, uid, {});
  assert.equal((await billingAccount(uid)).planId, "pro");

  // O plano não vive mais no perfil.
  const profile = (await db().doc(`users/${uid}`).get()).data() ?? {};
  assert.equal("planId" in profile, false);
  assert.equal("isPro" in profile, false);
});

test("conta anterior ao billing recebe o Free no próximo bootstrap", async () => {
  const uid = uniqueId("bill-heal");
  await bootstrapUser(uid);
  await db().doc(`billing_accounts/${uid}`).delete();
  await call(bootstrapAccount, uid, {});
  assert.equal((await billingAccount(uid)).planId, "free");
});

// ------------------------------------------------------------- contrato

test("checkout recebe planId e nunca priceId", async () => {
  const uid = uniqueId("bill-contract");
  await bootstrapUser(uid);
  await expectHttpsError(call(createCheckoutSession, uid, {
    priceId: "price_1TAyyCJvdLQmRJDshibLb4QF",
    returnUrl: "https://app.minhas-financas.test",
    idempotencyKey: idempotencyKey(),
  }), "invalid-argument");
  await expectHttpsError(call(createCheckoutSession, uid, {
    planId: "pro",
    priceId: "price_1TAyyCJvdLQmRJDshibLb4QF",
    returnUrl: "https://app.minhas-financas.test",
    idempotencyKey: idempotencyKey(),
  }), "invalid-argument");
  await expectHttpsError(call(createCheckoutSession, uid, {
    planId: "free",
    returnUrl: "https://app.minhas-financas.test",
    idempotencyKey: idempotencyKey(),
  }), "invalid-argument");
});

test("configuração ausente falha fechada no checkout e no portal", async () => {
  const uid = uniqueId("bill-noconfig");
  await bootstrapUser(uid);
  for (const name of [
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_PRO_MONTHLY",
    "STRIPE_PRICE_BUSINESS_MONTHLY",
    "APP_ALLOWED_ORIGINS",
  ]) {
    assert.equal(process.env[name], undefined, `${name} vazou para o teste`);
  }
  await expectHttpsError(call(createCheckoutSession, uid, {
    planId: "pro",
    returnUrl: "https://app.minhas-financas.test",
    idempotencyKey: idempotencyKey(),
  }), "failed-precondition", {
    message: "Cobrança indisponível no momento. Tente novamente mais tarde.",
  });
  await expectHttpsError(call(createBillingPortalSession, uid, {
    returnUrl: "https://app.minhas-financas.test",
  }), "failed-precondition", {
    message: "Cobrança indisponível no momento. Tente novamente mais tarde.",
  });
  const account = await billingAccount(uid);
  assert.equal(account.pendingCheckout, null);
  assert.equal(account.stripeCustomerId, null);
});

test("catálogo público é servido pelo backend", async () => {
  const uid = uniqueId("bill-catalog");
  await bootstrapUser(uid);
  const catalog = await call<{plans: Array<Record<string, unknown>>}>(
    getBillingCatalog, uid, {});
  assert.deepEqual(catalog.plans.map((plan) => plan.amountCents),
    [0, 2990, 5990]);
  assert.doesNotMatch(JSON.stringify(catalog), /price_|priceId/);
});

// ------------------------------------------------------------- checkout

test("checkout cria sessão para o customer canônico sem conceder plano", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-happy");
  await bootstrapUser(uid);
  const key = idempotencyKey();
  const result = await checkout(harness, uid, "business", key);
  assert.match(result.url, /^https:\/\/checkout\.stripe\.test\//);

  const account = await billingAccount(uid);
  assert.equal(account.planId, "free", "checkout não concede plano");
  assert.equal(account.subscriptionStatus, "none");
  assert.ok(account.stripeCustomerId);
  assert.equal(account.pendingCheckout?.state, "open");
  assert.equal(account.pendingCheckout?.planId, "business");
  const mapping = await db()
    .doc(`billing_customers/${account.stripeCustomerId}`).get();
  assert.equal(mapping.get("billingOwnerUid"), uid);

  const created = harness.stripe.calls
    .find((entry) => entry.method === "createCheckoutSession");
  const input = created?.args as Record<string, unknown>;
  assert.equal(input.priceId, harness.env.STRIPE_PRICE_BUSINESS_MONTHLY);
  assert.equal(input.customerId, account.stripeCustomerId);
  assert.equal(input.billingOwnerUid, uid);
  assert.equal(input.successUrl,
    `${harness.env.APP_ALLOWED_ORIGINS}/app?billing=success`);
  assert.match(created?.idempotencyKey ?? "", /^billing-checkout-[0-9a-f]{40}-\d+$/);
  assert.match(
    harness.stripe.calls.find((entry) => entry.method === "createCustomer")
      ?.idempotencyKey ?? "",
    /^billing-customer-[0-9a-f]{40}$/,
  );

  const events = await billingEvents(uid, "checkout.created");
  assert.equal(events.length, 1);
  assert.equal(events[0].details.planId, "business");
  assert.doesNotMatch(JSON.stringify(events[0]), /https:|@/);
});

test("mesma chave de idempotência devolve a mesma sessão", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-replay");
  await bootstrapUser(uid);
  const key = idempotencyKey();
  const first = await checkout(harness, uid, "pro", key);
  const second = await checkout(harness, uid, "pro", key);
  assert.equal(second.url, first.url);
  assert.equal(harness.stripe.count("createCheckoutSession"), 1);
  await rejectsWith(checkout(harness, uid, "business", key),
    "idempotency_conflict");
});

test("chamadas concorrentes com a mesma chave usam a mesma chave no Stripe", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-samekey");
  await bootstrapUser(uid);
  const key = idempotencyKey();
  const results = await Promise.allSettled([
    checkout(harness, uid, "pro", key),
    checkout(harness, uid, "pro", key),
  ]);
  const urls = results
    .filter((entry): entry is PromiseFulfilledResult<{url: string}> =>
      entry.status === "fulfilled")
    .map((entry) => entry.value.url);
  assert.ok(urls.length >= 1);
  assert.equal(new Set(urls).size, 1);
  const keys = new Set(harness.stripe.calls
    .filter((entry) => entry.method === "createCheckoutSession")
    .map((entry) => entry.idempotencyKey));
  assert.equal(keys.size, 1, "uma única chave idempotente no Stripe");
  assert.equal(harness.stripe.sessions.size, 1);
});

test("checkouts concorrentes com chaves diferentes não criam duas assinaturas", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-race");
  await bootstrapUser(uid);
  // Customer já existente: o lock é o que serializa a corrida.
  await checkout(harness, uid, "pro");
  const customerId = (await billingAccount(uid)).stripeCustomerId as string;

  const results = await Promise.allSettled(
    Array.from({length: 4}, () => checkout(harness, uid, "pro")),
  );
  assert.ok(results.some((entry) => entry.status === "fulfilled"));
  for (const entry of results) {
    if (entry.status === "rejected") {
      assert.ok(entry.reason instanceof ApplicationError);
      assert.equal(entry.reason.code, "domain_precondition_failed");
    }
  }
  // Só uma sessão pode ser paga; as demais foram expiradas no Stripe.
  const open = openSessionsOf(harness, customerId);
  assert.equal(open.length, 1);
  harness.stripe.completeCheckoutSession(open[0].id);
  for (const session of harness.stripe.sessions.values()) {
    if (session.id === open[0].id) continue;
    assert.throws(() => harness.stripe.completeCheckoutSession(session.id));
  }
  const live = [...harness.stripe.subscriptions.values()]
    .filter((entry) => entry.customerId === customerId);
  assert.equal(live.length, 1);
  assert.equal(harness.stripe.count("createCustomer"), 1);
});

test("customer é reutilizado em checkouts seguintes", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-reuse");
  await bootstrapUser(uid);
  await checkout(harness, uid, "pro");
  const customerId = (await billingAccount(uid)).stripeCustomerId;
  // Assinatura anterior encerrada: novo checkout é permitido.
  await db().doc(`billing_accounts/${uid}`).update({
    subscriptionStatus: "canceled",
  });
  await checkout(harness, uid, "business");
  assert.equal((await billingAccount(uid)).stripeCustomerId, customerId);
  assert.equal(harness.stripe.count("createCustomer"), 1);
  const inputs = harness.stripe.calls
    .filter((entry) => entry.method === "createCheckoutSession")
    .map((entry) => (entry.args as {customerId: string}).customerId);
  assert.deepEqual(inputs, [customerId, customerId]);
});

test("titular com assinatura paga não abre segundo checkout", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-paid");
  await bootstrapUser(uid);
  for (const status of ["active", "past_due", "unpaid", "incomplete"]) {
    await db().doc(`billing_accounts/${uid}`).update({
      subscriptionStatus: status,
    });
    await rejectsWith(checkout(harness, uid, "business"), "already_exists",
      "billing_subscription_exists");
  }
  assert.equal(harness.stripe.count("createCheckoutSession"), 0);
});

test("assinatura viva no Stripe ainda não refletida bloqueia o checkout", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-lag");
  await bootstrapUser(uid);
  const first = await checkout(harness, uid, "pro");
  const account = await billingAccount(uid);
  const sessionId = account.pendingCheckout?.sessionId as string;
  assert.ok(first.url.includes(sessionId));
  // Pago no Stripe; o webhook ainda não chegou.
  harness.stripe.completeCheckoutSession(sessionId);
  await rejectsWith(checkout(harness, uid, "business"), "already_exists",
    "billing_subscription_exists");
  assert.equal(harness.stripe.count("createCheckoutSession"), 1);
  assert.equal((await billingAccount(uid)).pendingCheckout?.sessionId,
    sessionId, "o lock da sessão paga continua");
});

test("sessão anterior aberta é expirada antes de abrir outra", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-expire");
  await bootstrapUser(uid);
  await checkout(harness, uid, "pro");
  const previous = (await billingAccount(uid)).pendingCheckout?.sessionId as
    string;
  await checkout(harness, uid, "business");
  assert.equal(harness.stripe.sessions.get(previous)?.status, "expired");
  assert.throws(() => harness.stripe.completeCheckoutSession(previous));
});

test("Price do ambiente divergente do catálogo falha fechado", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-mismatch");
  await bootstrapUser(uid);
  harness.stripe.prices.set(
    harness.env.STRIPE_PRICE_PRO_MONTHLY,
    harness.stripe.price(harness.env.STRIPE_PRICE_PRO_MONTHLY, 1990),
  );
  await rejectsWith(checkout(harness, uid, "pro"), "domain_precondition_failed");
  // Price live num ambiente de teste (ou o contrário) também é recusado.
  harness.stripe.prices.set(harness.env.STRIPE_PRICE_BUSINESS_MONTHLY, {
    ...harness.stripe.price(harness.env.STRIPE_PRICE_BUSINESS_MONTHLY, 5990),
    livemode: true,
  });
  await rejectsWith(checkout(harness, uid, "business"),
    "domain_precondition_failed");
  harness.stripe.prices.delete(harness.env.STRIPE_PRICE_BUSINESS_MONTHLY);
  await rejectsWith(checkout(harness, uid, "business"),
    "domain_precondition_failed");
  assert.equal(harness.stripe.count("createCheckoutSession"), 0);
  assert.equal((await billingAccount(uid)).pendingCheckout, null);
});

test("returnUrl fora da allowlist é recusado", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-return");
  await bootstrapUser(uid);
  await rejectsWith(executeCreateCheckoutSession(harness.checkoutDeps, {
    caller: callerFor(uid),
    payload: {
      planId: "pro",
      returnUrl: "https://app.minhas-financas.test.atacante.io/",
      idempotencyKey: idempotencyKey(),
    },
    requestId: uniqueId("req"),
    log: silentLogger(),
  }), "invalid_payload");
});

test("falha no Stripe libera o lock e não deixa estado parcial", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-fail");
  await bootstrapUser(uid);
  harness.stripe.failNext.add("createCheckoutSession");
  await assert.rejects(checkout(harness, uid, "pro"));
  assert.equal((await billingAccount(uid)).pendingCheckout, null);
  await checkout(harness, uid, "pro");
  assert.equal((await billingAccount(uid)).pendingCheckout?.state, "open");
});

test("conta suspensa não abre checkout nem portal", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-suspended");
  await bootstrapUser(uid);
  await seedActiveAccount(uid, {status: "suspended"});
  await rejectsWith(checkout(harness, uid, "pro"), "account_suspended");
});

test("rate limit do checkout é por titular", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-rate");
  await bootstrapUser(uid);
  for (let index = 0; index < CHECKOUT_RATE_LIMIT.limit; index += 1) {
    await checkout(harness, uid, "pro");
  }
  await rejectsWith(checkout(harness, uid, "pro"), "domain_precondition_failed");
});

// ------------------------------------------------------------- portal

const portal = (
  harness: BillingHarness,
  uid: string,
  url = returnUrl(harness),
) => executeCreateBillingPortalSession({
  gateway: harness.stripe,
  allowedOrigins: [harness.env.APP_ALLOWED_ORIGINS],
}, {
  caller: callerFor(uid),
  payload: {returnUrl: url},
  log: silentLogger(),
});

test("portal sem customer é recusado com mensagem pt-BR", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-portal-none");
  await bootstrapUser(uid);
  await assert.rejects(portal(harness, uid), (error: unknown) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.code, "domain_precondition_failed");
    assert.equal(error.message,
      "Você ainda não tem uma assinatura para gerenciar.");
    return true;
  });
  assert.equal(harness.stripe.count("createPortalSession"), 0);
});

test("portal válido abre para o customer do próprio titular", async () => {
  const harness = billingHarness();
  const uid = uniqueId("bill-portal");
  const other = uniqueId("bill-portal-other");
  await bootstrapUser(uid);
  await bootstrapUser(other);
  await checkout(harness, uid, "pro");
  await checkout(harness, other, "pro");
  const customerId = (await billingAccount(uid)).stripeCustomerId;
  const result = await portal(harness, uid);
  assert.match(result.url, /^https:\/\/billing\.stripe\.test\//);
  const input = harness.stripe.calls
    .filter((entry) => entry.method === "createPortalSession")
    .map((entry) => entry.args as {customerId: string; returnUrl: string});
  assert.deepEqual(input, [{customerId, returnUrl: returnUrl(harness)}]);
  await rejectsWith(portal(harness, uid, "https://atacante.io/"),
    "invalid_payload");
});
