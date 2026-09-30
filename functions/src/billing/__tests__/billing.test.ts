import assert from "node:assert/strict";
import test from "node:test";

import type Stripe from "stripe";

import {
  BILLING_CATALOG_VERSION,
  BILLING_POLICY,
  PLAN_IDS,
  catalogPlan,
  publicBillingCatalog,
} from "../catalog";
import {
  BillingConfigError,
  allowedReturnOrigins,
  isAllowedReturnUrl,
  planIdForPrice,
  readAllowedReturnOrigins,
  readPriceConfig,
  readStripeKeyConfig,
  readWebhookSecret,
} from "../config";
import {
  PAST_DUE_GRACE_MS,
  effectiveEntitlement,
  resolveEntitlement,
  type SubscriptionTerms,
} from "../entitlements";
import {
  EMPTY_BILLING_STATE,
  billingTransitions,
  deriveBillingState,
  paidPlanOf,
  selectCanonicalSubscription,
} from "../reconcile";
import {
  subscriptionSnapshotFromStripe,
  type SubscriptionSnapshot,
} from "../stripeGateway";
import {testBillingEnv} from "../testSupport/fakeStripe";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 29, 12);
const env = testBillingEnv();
const prices = readPriceConfig(env);

// ------------------------------------------------------------- catálogo

test("catálogo canônico versionado com os valores de D-08", () => {
  assert.equal(BILLING_CATALOG_VERSION, 1);
  assert.deepEqual([...PLAN_IDS], ["free", "pro", "business"]);
  assert.deepEqual(
    PLAN_IDS.map((planId) => catalogPlan(planId).amountCents),
    [0, 2990, 5990],
  );
  assert.deepEqual(catalogPlan("free").limits, {
    workspaces: 1,
    membersPerWorkspace: 2,
    transactionsPerMonth: 50,
    splitGroups: 2,
    aiCreditsPerMonth: 10,
  });
  assert.deepEqual(catalogPlan("pro").limits, {
    workspaces: 5,
    membersPerWorkspace: 10,
    transactionsPerMonth: 1000,
    splitGroups: 10,
    aiCreditsPerMonth: 150,
  });
  assert.deepEqual(catalogPlan("business").limits, {
    workspaces: 20,
    membersPerWorkspace: 50,
    transactionsPerMonth: 10000,
    splitGroups: 100,
    aiCreditsPerMonth: 750,
  });
  assert.equal(BILLING_POLICY.trialDays, 0);
  assert.equal(BILLING_POLICY.pastDueGraceDays, 7);
  assert.equal(BILLING_POLICY.currency, "brl");
});

test("catálogo: centavos inteiros, planos ordenados e nenhum falso " +
  "ilimitado", () => {
  let previousRank = -1;
  for (const planId of PLAN_IDS) {
    const plan = catalogPlan(planId);
    assert.ok(Number.isSafeInteger(plan.amountCents), planId);
    assert.equal(plan.interval, "month");
    assert.ok(plan.rank > previousRank, `ordem de ${planId}`);
    previousRank = plan.rank;
    for (const [key, value] of Object.entries(plan.limits)) {
      assert.ok(Number.isSafeInteger(value) && value > 0, `${planId}.${key}`);
      assert.ok(![999, 9999, 99999].includes(value), `${planId}.${key}`);
    }
  }
  assert.notEqual(catalogPlan("pro").amountCents,
    catalogPlan("business").amountCents);
  assert.throws(() => {
    (catalogPlan("pro") as {amountCents: number}).amountCents = 1;
  });
});

test("catálogo público não expõe priceId, ordem interna nem " +
  "configuração", () => {
  const catalog = publicBillingCatalog();
  assert.equal(catalog.catalogVersion, BILLING_CATALOG_VERSION);
  assert.equal(catalog.currency, "BRL");
  const serialized = JSON.stringify(catalog);
  assert.doesNotMatch(serialized, /price_|priceId|rank|sk_|whsec_/);
  for (const plan of catalog.plans) {
    assert.deepEqual(
      Object.keys(plan).sort(),
      ["amountCents", "interval", "limits", "name", "planId"],
    );
  }
});

// ------------------------------------------------------------- configuração

test("configuração ausente falha fechada, sem valor padrão", () => {
  assert.throws(() => readStripeKeyConfig({}), BillingConfigError);
  assert.throws(() => readWebhookSecret({}), BillingConfigError);
  assert.throws(() => readPriceConfig({}), (error: unknown) =>
    error instanceof BillingConfigError &&
    error.names.includes("STRIPE_PRICE_PRO_MONTHLY") &&
    error.names.includes("STRIPE_PRICE_BUSINESS_MONTHLY"));
  assert.throws(() => readAllowedReturnOrigins({}), BillingConfigError);
  assert.throws(
    () => readPriceConfig({...env, STRIPE_PRICE_BUSINESS_MONTHLY: " "}),
    BillingConfigError,
  );
});

test("placeholders antigos e valores fora do formato são recusados", () => {
  for (const secretKey of [
    "sk_test_placeholder",
    "pk_test_51AbCdEfGhIjKlMnOpQrStUvWxYz",
    "segredo",
  ]) {
    assert.throws(
      () => readStripeKeyConfig({STRIPE_SECRET_KEY: secretKey}),
      BillingConfigError,
      secretKey,
    );
  }
  assert.throws(
    () => readWebhookSecret({STRIPE_WEBHOOK_SECRET: "whsec_placeholder"}),
    BillingConfigError,
  );
  assert.throws(
    () => readPriceConfig({...env, STRIPE_PRICE_PRO_MONTHLY: "prod_123456789"}),
    BillingConfigError,
  );
});

test("Pro e Business com o mesmo Price é configuração inválida (C02)", () => {
  assert.throws(() => readPriceConfig({
    STRIPE_PRICE_PRO_MONTHLY: "price_1TAyyCJvdLQmRJDshibLb4QF",
    STRIPE_PRICE_BUSINESS_MONTHLY: "price_1TAyyCJvdLQmRJDshibLb4QF",
  }), BillingConfigError);
});

test("modo da chave define o modo esperado dos eventos", () => {
  assert.equal(readStripeKeyConfig(env).livemode, false);
  assert.equal(readStripeKeyConfig({
    STRIPE_SECRET_KEY: `rk_live_${"A".repeat(30)}`,
  }).livemode, true);
});

test("Price → plano só pela configuração do ambiente", () => {
  assert.equal(planIdForPrice(prices.pro, prices), "pro");
  assert.equal(planIdForPrice(prices.business, prices), "business");
  assert.equal(planIdForPrice("price_desconhecido123", prices), null);
  assert.equal(planIdForPrice(null, prices), null);
});

test("returnUrl é comparado por origem, nunca por prefixo", () => {
  const allowed = ["https://app.exemplo.com.br"];
  assert.equal(
    isAllowedReturnUrl("https://app.exemplo.com.br/billing", allowed),
    true,
  );
  assert.equal(
    isAllowedReturnUrl("https://app.exemplo.com.br.atacante.io/", allowed),
    false,
  );
  assert.equal(
    isAllowedReturnUrl("https://atacante.io/app.exemplo.com.br", allowed),
    false,
  );
  assert.equal(isAllowedReturnUrl("http://app.exemplo.com.br", allowed), false);
  assert.equal(isAllowedReturnUrl("nao-e-url", allowed), false);
  assert.equal(isAllowedReturnUrl("javascript:alert(1)", allowed), false);
  assert.equal(isAllowedReturnUrl("https://app.exemplo.com.br", []), false);
  assert.equal(
    isAllowedReturnUrl("http://localhost:5173", ["http://localhost:5173"]),
    true,
  );
  assert.equal(
    isAllowedReturnUrl("http://localhost:5173", allowed),
    false,
  );
  assert.deepEqual(
    allowedReturnOrigins(
      {APP_ALLOWED_ORIGINS: " https://a.test/ ,https://b.test"}),
    ["https://a.test", "https://b.test"],
  );
});

// ------------------------------------------------------------- entitlement

const terms = (patch: Partial<SubscriptionTerms>): SubscriptionTerms => ({
  status: "active",
  paidPlanId: "pro",
  currentPeriodEndMs: NOW + 20 * DAY,
  cancelAtPeriodEnd: false,
  cancelAtMs: null,
  graceUntilMs: null,
  ...patch,
});

test("sem assinatura paga → Free", () => {
  assert.deepEqual(
    resolveEntitlement(terms({status: "none", paidPlanId: null}), NOW),
    {planId: "free", entitlementStatus: "free"},
  );
});

test("active e trialing concedem o plano do Price; Pro e Business " +
  "distintos", () => {
  assert.deepEqual(resolveEntitlement(terms({}), NOW),
    {planId: "pro", entitlementStatus: "active"});
  assert.deepEqual(resolveEntitlement(terms({paidPlanId: "business"}), NOW),
    {planId: "business", entitlementStatus: "active"});
  assert.deepEqual(resolveEntitlement(terms({status: "trialing"}), NOW),
    {planId: "pro", entitlementStatus: "active"});
});

test("Price desconhecido nunca concede plano pago", () => {
  assert.deepEqual(resolveEntitlement(terms({paidPlanId: null}), NOW),
    {planId: "free", entitlementStatus: "free"});
  assert.deepEqual(
    resolveEntitlement(terms({status: "past_due", paidPlanId: null,
      graceUntilMs: NOW + DAY}), NOW),
    {planId: "free", entitlementStatus: "restricted"},
  );
});

test("past_due mantém o plano dentro do grace e restringe depois", () => {
  const graceUntilMs = NOW + 3 * DAY;
  assert.deepEqual(
    resolveEntitlement(terms({status: "past_due", graceUntilMs}), NOW),
    {planId: "pro", entitlementStatus: "grace"},
  );
  assert.deepEqual(
    resolveEntitlement(terms({status: "past_due", graceUntilMs}),
      graceUntilMs),
    {planId: "free", entitlementStatus: "restricted"},
  );
  assert.deepEqual(
    resolveEntitlement(terms({status: "past_due", graceUntilMs: null}), NOW),
    {planId: "free", entitlementStatus: "restricted"},
  );
  assert.equal(PAST_DUE_GRACE_MS, 7 * DAY);
});

test("cancel_at_period_end mantém o plano até currentPeriodEnd", () => {
  const end = NOW + 5 * DAY;
  const canceling = terms({cancelAtPeriodEnd: true, currentPeriodEndMs: end});
  assert.deepEqual(resolveEntitlement(canceling, end - 1),
    {planId: "pro", entitlementStatus: "active"});
  assert.deepEqual(resolveEntitlement(canceling, end),
    {planId: "free", entitlementStatus: "free"});
  const cancelAt = terms({cancelAtMs: NOW + DAY});
  assert.deepEqual(resolveEntitlement(cancelAt, NOW + DAY),
    {planId: "free", entitlementStatus: "free"});
});

test("canceled, unpaid, incomplete, incomplete_expired e paused sem plano " +
  "pago", () => {
  const cases: Array<[SubscriptionTerms["status"], string]> = [
    ["canceled", "free"],
    ["incomplete_expired", "free"],
    ["unpaid", "restricted"],
    ["paused", "restricted"],
    ["incomplete", "pending"],
  ];
  for (const [status, entitlementStatus] of cases) {
    assert.deepEqual(
      resolveEntitlement(terms({status, paidPlanId: "business"}), NOW),
      {planId: "free", entitlementStatus},
      status,
    );
  }
});

test("entitlement gravado é reavaliado no relógio do servidor", () => {
  const stored = {
    planId: "pro",
    entitlementStatus: "grace",
    graceUntilMs: NOW + DAY,
    currentPeriodEndMs: NOW + 20 * DAY,
    cancelAtPeriodEnd: false,
    cancelAtMs: null,
  };
  assert.deepEqual(effectiveEntitlement(stored, NOW),
    {planId: "pro", entitlementStatus: "grace"});
  assert.deepEqual(effectiveEntitlement(stored, NOW + DAY),
    {planId: "free", entitlementStatus: "restricted"});
  const canceling = {
    ...stored,
    entitlementStatus: "active",
    graceUntilMs: null,
    cancelAtPeriodEnd: true,
  };
  assert.deepEqual(effectiveEntitlement(canceling, NOW + 19 * DAY),
    {planId: "pro", entitlementStatus: "active"});
  assert.deepEqual(effectiveEntitlement(canceling, NOW + 20 * DAY),
    {planId: "free", entitlementStatus: "free"});
  assert.deepEqual(
    effectiveEntitlement({...canceling, planId: "enterprise"}, NOW),
    {planId: "free", entitlementStatus: "free"},
  );
});

// ------------------------------------------------------------- reconciliação

let sequence = 0;
const subscription = (
  patch: Partial<SubscriptionSnapshot> & {priceId?: string | null},
): SubscriptionSnapshot => {
  sequence += 1;
  const {priceId, ...rest} = patch;
  return {
    id: `sub_${sequence}`,
    customerId: "cus_1",
    status: "active",
    created: 1_000 + sequence,
    metadataOwnerUid: "uid-1",
    items: [{
      priceId: priceId === undefined ? prices.pro : priceId,
      quantity: 1,
      currentPeriodEnd: Math.floor((NOW + 20 * DAY) / 1000),
    }],
    cancelAtPeriodEnd: false,
    cancelAt: null,
    latestInvoiceFinalizedAt: Math.floor((NOW - DAY) / 1000),
    livemode: false,
    ...rest,
  };
};

const noPrevious = {
  subscriptionStatus: "none" as const,
  stripeSubscriptionId: null,
  graceUntilMs: null,
};

test("webhook nunca concede Business a partir de Price Pro", () => {
  const pro = subscription({
    priceId: prices.pro,
    metadataOwnerUid: "uid-1",
  });
  assert.equal(paidPlanOf(pro, prices).planId, "pro");
  const {state} = deriveBillingState(pro, noPrevious, prices, NOW);
  assert.equal(state.planId, "pro");
  assert.equal(state.stripePriceId, prices.pro);
  const business = deriveBillingState(
    subscription({priceId: prices.business}), noPrevious, prices, NOW);
  assert.equal(business.state.planId, "business");
});

test("Price desconhecido ou itens inesperados viram anomalia sem plano " +
  "pago", () => {
  const unknown = deriveBillingState(
    subscription({priceId: "price_outro12345678"}), noPrevious, prices, NOW);
  assert.equal(unknown.state.planId, "free");
  assert.equal(unknown.anomalies[0]?.kind, "unrecognized_price");
  const twoItems = subscription({});
  twoItems.items.push({...twoItems.items[0], priceId: prices.business});
  const multiple = deriveBillingState(twoItems, noPrevious, prices, NOW);
  assert.equal(multiple.state.planId, "free");
  assert.equal(multiple.anomalies[0]?.kind, "unexpected_items");
  const quantity = subscription({});
  quantity.items[0].quantity = 3;
  assert.equal(deriveBillingState(quantity, noPrevious, prices, NOW)
    .state.planId, "free");
});

test("assinatura canônica: viva antes de encerrada; duplicidade " +
  "apontada", () => {
  const oldCanceled = subscription({status: "canceled", created: 5_000});
  const live = subscription({status: "active", created: 10});
  const {canonical, duplicates} =
    selectCanonicalSubscription([oldCanceled, live], prices);
  assert.equal(canonical?.id, live.id);
  assert.deepEqual(duplicates, []);

  const incomplete = subscription({status: "incomplete", created: 9_000});
  const both = selectCanonicalSubscription([incomplete, live], prices);
  assert.equal(both.canonical?.id, live.id);
  assert.deepEqual(both.duplicates, [incomplete.id]);

  const ended = selectCanonicalSubscription(
    [oldCanceled, subscription({status: "incomplete_expired", created: 1})],
    prices,
  );
  assert.equal(ended.canonical?.id, oldCanceled.id);
  assert.equal(selectCanonicalSubscription([], prices).canonical, null);
});

test("grace conta da fatura que falhou e não avança no mesmo episódio", () => {
  const failedAt = NOW - 2 * DAY;
  const pastDue = subscription({
    status: "past_due",
    latestInvoiceFinalizedAt: Math.floor(failedAt / 1000),
  });
  const first = deriveBillingState(pastDue, noPrevious, prices, NOW);
  assert.equal(first.state.graceUntilMs, failedAt + 7 * DAY);
  assert.equal(first.state.entitlementStatus, "grace");

  // Fatura seguinte também falha: a âncora do episódio é preservada.
  const later = {...pastDue,
    latestInvoiceFinalizedAt: Math.floor((NOW + 30 * DAY) / 1000)};
  const second = deriveBillingState(later, {
    subscriptionStatus: "past_due",
    stripeSubscriptionId: pastDue.id,
    graceUntilMs: first.state.graceUntilMs,
  }, prices, NOW + 31 * DAY);
  assert.equal(second.state.graceUntilMs, failedAt + 7 * DAY);
  assert.equal(second.state.entitlementStatus, "restricted");
  assert.equal(second.state.planId, "free");
});

test("transições auditadas: vínculo, grace, cancelamento e reversão", () => {
  const active = deriveBillingState(subscription({}), noPrevious, prices, NOW)
    .state;
  const linked = billingTransitions(EMPTY_BILLING_STATE, active)
    .map((entry) => entry.type);
  assert.deepEqual(linked, ["subscription.linked", "billing.state_changed"]);

  const grace = {...active, subscriptionStatus: "past_due" as const,
    entitlementStatus: "grace" as const, graceUntilMs: NOW + DAY};
  assert.deepEqual(billingTransitions(active, grace).map((e) => e.type),
    ["billing.state_changed", "grace.started"]);
  assert.deepEqual(billingTransitions(grace, active).map((e) => e.type),
    ["billing.state_changed", "grace.ended"]);

  const canceling = {...active, cancelAtPeriodEnd: true};
  assert.deepEqual(billingTransitions(active, canceling).map((e) => e.type),
    ["cancellation.scheduled"]);
  assert.deepEqual(billingTransitions(canceling, active).map((e) => e.type),
    ["cancellation.reverted"]);

  const canceled = {...active, subscriptionStatus: "canceled" as const,
    planId: "free" as const, entitlementStatus: "free" as const};
  assert.deepEqual(billingTransitions(active, canceled).map((e) => e.type),
    ["billing.state_changed", "subscription.canceled"]);
  assert.deepEqual(billingTransitions(active, active), []);
});

test("assinatura do SDK (API 2026-02-25.clover) é normalizada", () => {
  const raw = {
    id: "sub_123",
    object: "subscription",
    customer: "cus_123",
    status: "past_due",
    created: 1_700_000_000,
    livemode: false,
    metadata: {billingOwnerUid: "uid-9"},
    cancel_at_period_end: true,
    cancel_at: 1_800_000_000,
    items: {data: [{
      price: {id: "price_abc12345"},
      quantity: 1,
      current_period_end: 1_790_000_000,
    }]},
    latest_invoice: {
      id: "in_1",
      created: 1_750_000_000,
      status_transitions: {finalized_at: 1_750_003_600},
    },
  } as unknown as Stripe.Subscription;
  assert.deepEqual(subscriptionSnapshotFromStripe(raw), {
    id: "sub_123",
    customerId: "cus_123",
    status: "past_due",
    created: 1_700_000_000,
    metadataOwnerUid: "uid-9",
    items: [{priceId: "price_abc12345", quantity: 1,
      currentPeriodEnd: 1_790_000_000}],
    cancelAtPeriodEnd: true,
    cancelAt: 1_800_000_000,
    latestInvoiceFinalizedAt: 1_750_003_600,
    livemode: false,
  });
  const unknownStatus = subscriptionSnapshotFromStripe(
    {...raw, status: "novo_status"} as unknown as Stripe.Subscription);
  assert.equal(unknownStatus.status, "incomplete");
});
