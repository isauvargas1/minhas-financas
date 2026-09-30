import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";

import {db} from "../../workspaces/testSupport/p1TestSupport";
import type {BillingAccountDocument} from "../model";
import {executeCreateBillingPortalSession} from "../portal";
import {signedStripeEvent} from "../testSupport/fakeStripe";
import {insideTransaction} from "../testSupport/transactionProbe";
import {
  billingAccount,
  billingEvents,
  billingHarness,
  callerFor,
  invoiceEventObject,
  reconciliationLease,
  silentLogger,
  subscribedUser,
  subscriptionEventObject,
  webhookReceipt,
  type BillingHarness,
} from "../testSupport/billingTestSupport";
import {
  RECONCILIATION_LEASE_MS,
  processStripeWebhook,
  type WebhookDependencies,
} from "../webhook";

/**
 * Protocolo em fases do webhook (P2A.1) no Emulator, com Stripe falso — sem
 * rede e sem credenciais. Nenhuma chamada ao Stripe acontece dentro de
 * transação do Firestore (a sonda de `transactionProbe.ts` recusa e registra),
 * e o lease com geração mantém idempotência, ordem e recuperação.
 *
 * As intercalações são determinísticas: `stripe.hold` retém uma chamada
 * (Stripe lento, processo travado ou queda) até o teste liberá-la, e o
 * vencimento do lease usa o relógio injetado.
 */
const DAY_SECONDS = 24 * 60 * 60;

type User = Awaited<ReturnType<typeof subscribedUser>>;

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const eventId = (label: string) =>
  `evt_${label}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

/** Evento assinado uma vez; a mesma entrega pode ser repetida. */
const signedDelivery = (
  harness: BillingHarness,
  input: {type: string; object: Record<string, unknown>; created?: number},
) => {
  const signed = signedStripeEvent(harness.webhookDeps.webhookSecret, {
    ...input,
    id: eventId(input.type.replace(/\W/g, "_")),
  });
  return {
    id: signed.id,
    send: (overrides: Partial<WebhookDependencies> = {}) =>
      processStripeWebhook({...harness.webhookDeps, ...overrides}, {
        method: "POST",
        rawBody: signed.rawBody,
        signature: signed.signature,
      }),
  };
};

const subscriptionUpdate = (
  harness: BillingHarness,
  user: User,
  type = "customer.subscription.updated",
  extra: {status?: string; created?: number} = {},
) => signedDelivery(harness, {
  type,
  created: extra.created,
  object: subscriptionEventObject(
    user.subscriptionId, user.customerId, user.uid, extra.status),
});

const invoicePaid = (harness: BillingHarness, user: User) =>
  signedDelivery(harness, {
    type: "invoice.paid",
    object: invoiceEventObject(user.subscriptionId, user.customerId, user.uid),
  });

const businessItems = (harness: BillingHarness) => [{
  priceId: harness.env.STRIPE_PRICE_BUSINESS_MONTHLY,
  quantity: 1,
  currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * DAY_SECONDS,
}];

/** Estado de billing da conta, sem carimbos de tempo. */
const billingState = (account: BillingAccountDocument) => ({
  planId: account.planId,
  entitlementStatus: account.entitlementStatus,
  subscriptionStatus: account.subscriptionStatus,
  stripeSubscriptionId: account.stripeSubscriptionId,
  stripePriceId: account.stripePriceId,
  cancelAtPeriodEnd: account.cancelAtPeriodEnd,
});

const leaseGeneration = async (uid: string): Promise<number> =>
  (await reconciliationLease(uid))?.generation ?? 0;

const assertProcessed = async (id: string, outcome = "applied") => {
  const stored = await webhookReceipt(id);
  assert.equal(stored?.status, "processed", id);
  assert.equal(stored?.outcome, outcome, id);
};

// ------------------------------------------------------------------ sonda

test("sonda: chamada ao Stripe dentro de transação é recusada e " +
  "registrada", async () => {
  const harness = billingHarness();
  assert.equal(insideTransaction(), false);
  await assert.rejects(
    db().runTransaction(async () => {
      assert.equal(insideTransaction(), true);
      await harness.stripe.listSubscriptions("cus_sonda");
    }),
    /dentro de transação/,
  );
  assert.deepEqual(harness.stripe.transactionViolations, ["listSubscriptions"]);
  assert.equal(insideTransaction(), false);
});

test("nenhuma chamada ao Stripe acontece dentro de transação em checkout, " +
  "portal e webhook", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  await executeCreateBillingPortalSession({
    gateway: harness.stripe,
    allowedOrigins: [harness.env.APP_ALLOWED_ORIGINS],
  }, {
    caller: callerFor(user.uid),
    payload: {returnUrl: harness.env.APP_ALLOWED_ORIGINS},
    log: silentLogger(),
  });
  harness.stripe.charges.set("ch_sonda", user.customerId);
  for (const delivery of [
    invoicePaid(harness, user),
    subscriptionUpdate(harness, user),
    signedDelivery(harness, {
      type: "charge.dispute.created",
      object: {id: "dp_sonda", object: "dispute", charge: "ch_sonda",
        amount: 2990, currency: "brl", reason: "fraudulent",
        status: "needs_response"},
    }),
    signedDelivery(harness, {
      type: "customer.created",
      object: {id: "cus_sonda", object: "customer"},
    }),
  ]) {
    assert.equal((await delivery.send()).status, 200);
  }
  const methods = new Set(harness.stripe.calls.map((call) => call.method));
  for (const method of [
    "retrievePrice", "createCustomer", "listSubscriptions",
    "listOpenCheckoutSessions", "createCheckoutSession",
    "retrieveSubscription", "createPortalSession", "retrieveChargeCustomerId",
  ]) {
    assert.ok(methods.has(method), `${method} não foi exercitado`);
  }
  assert.deepEqual(harness.stripe.transactionViolations, []);
});

// ------------------------------------------------------------ concorrência

test("Stripe lento: nenhuma transação fica aberta e outro evento do titular " +
  "espera o lease", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  const before = await billingAccount(user.uid);
  const generation = await leaseGeneration(user.uid);
  harness.stripe.updateSubscription(user.subscriptionId, {
    items: businessItems(harness),
  });

  const slow = harness.stripe.hold("listSubscriptions");
  const upgrade = subscriptionUpdate(harness, user);
  let upgradeAnswered = false;
  const upgrading = upgrade.send().then((response) => {
    upgradeAnswered = true;
    return response;
  });
  await slow.reached;

  // Com o Stripe lento: sem resposta, recibo `processing`, lease com o evento
  // e conta intacta.
  assert.equal(upgradeAnswered, false);
  assert.equal((await webhookReceipt(upgrade.id))?.status, "processing");
  const held = await reconciliationLease(user.uid);
  assert.equal(held?.holderEventId, upgrade.id);
  assert.equal(held?.generation, generation + 1);
  assert.deepEqual(billingState(await billingAccount(user.uid)),
    billingState(before));

  // Nenhuma transação do titular fica presa pela chamada externa.
  const portal = await executeCreateBillingPortalSession({
    gateway: harness.stripe,
    allowedOrigins: [harness.env.APP_ALLOWED_ORIGINS],
  }, {
    caller: callerFor(user.uid),
    payload: {returnUrl: harness.env.APP_ALLOWED_ORIGINS},
    log: silentLogger(),
  });
  assert.match(portal.url, /^https:\/\/billing\.stripe\.test\//);

  // Outro evento do mesmo titular não aplica estado concorrente: espera.
  const paid = invoicePaid(harness, user);
  let paidAnswered = false;
  const paying = paid.send().then((response) => {
    paidAnswered = true;
    return response;
  });
  await delay(300);
  assert.equal(paidAnswered, false);
  assert.equal(await webhookReceipt(paid.id), undefined);
  assert.equal((await reconciliationLease(user.uid))?.holderEventId,
    upgrade.id);

  slow.release();
  const [upgraded, paidResponse] = await Promise.all([upgrading, paying]);
  assert.equal(upgraded.status, 200);
  assert.equal(paidResponse.status, 200);
  assert.equal((await billingAccount(user.uid)).planId, "business");
  await assertProcessed(upgrade.id);
  await assertProcessed(paid.id);
  const released = await reconciliationLease(user.uid);
  assert.equal(released?.holderEventId, null);
  assert.equal(released?.generation, generation + 2);
  assert.equal((await billingEvents(user.uid, "payment.succeeded")).length, 1);
  assert.deepEqual(harness.stripe.transactionViolations, []);
});

test("duas entregas simultâneas do mesmo evento aplicam um único " +
  "efeito", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  const generation = await leaseGeneration(user.uid);
  const reads = harness.stripe.count("listSubscriptions");
  const paid = invoicePaid(harness, user);

  const slow = harness.stripe.hold("listSubscriptions");
  const first = paid.send();
  await slow.reached;
  const second = paid.send();
  await delay(300);
  // A segunda entrega não lê o Stripe nem assume o lease: espera a primeira.
  assert.equal(harness.stripe.count("listSubscriptions"), reads + 1);
  assert.equal(await leaseGeneration(user.uid), generation + 1);

  slow.release();
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  assert.equal(harness.stripe.count("listSubscriptions"), reads + 1);
  assert.equal((await billingEvents(user.uid, "payment.succeeded")).length, 1);
  await assertProcessed(paid.id);
  assert.equal(await leaseGeneration(user.uid), generation + 1);
});

test("dois eventos diferentes simultâneos do titular são serializados e " +
  "convergem", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  const generation = await leaseGeneration(user.uid);
  harness.stripe.updateSubscription(user.subscriptionId, {
    cancelAtPeriodEnd: true,
  });
  const updated = subscriptionUpdate(harness, user);
  const paid = invoicePaid(harness, user);

  const responses = await Promise.all([updated.send(), paid.send()]);
  assert.deepEqual(responses.map((response) => response.status), [200, 200]);
  const account = await billingAccount(user.uid);
  assert.equal(account.planId, "pro");
  assert.equal(account.cancelAtPeriodEnd, true);
  await assertProcessed(updated.id);
  await assertProcessed(paid.id);
  // Um lease por evento, em sequência; nenhum commit foi superado.
  const lease = await reconciliationLease(user.uid);
  assert.equal(lease?.generation, generation + 2);
  assert.equal(lease?.holderEventId, null);
  assert.equal(
    (await billingEvents(user.uid, "cancellation.scheduled")).length, 1);
  assert.equal((await billingEvents(user.uid, "payment.succeeded")).length, 1);
});

test("evento antigo com leitura atrasada não sobrescreve o estado do evento " +
  "novo", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  const generation = await leaseGeneration(user.uid);
  const base = Math.floor(harness.clock.now / 1000);

  // O evento antigo lê o Stripe com a assinatura ativa e a resposta atrasa.
  const stale = harness.stripe.hold("retrieveSubscription", "afterRead");
  const old = subscriptionUpdate(harness, user,
    "customer.subscription.updated", {created: base - 60, status: "active"});
  const oldDelivery = old.send();
  await stale.reached;

  // O Stripe encerra a assinatura e o lease do evento antigo vence: o evento
  // novo assume com geração nova e aplica o estado atual.
  harness.stripe.updateSubscription(user.subscriptionId, {status: "canceled"});
  harness.clock.now += RECONCILIATION_LEASE_MS + 1;
  const deleted = subscriptionUpdate(harness, user,
    "customer.subscription.deleted", {created: base + 60, status: "canceled"});
  assert.equal((await deleted.send()).status, 200);
  let account = await billingAccount(user.uid);
  assert.equal(account.subscriptionStatus, "canceled");
  assert.equal(account.planId, "free");

  // A leitura velha chega: o commit é recusado pela geração, e o evento
  // antigo é reconciliado de novo com o estado atual.
  stale.release();
  assert.equal((await oldDelivery).status, 200);
  account = await billingAccount(user.uid);
  assert.equal(account.subscriptionStatus, "canceled");
  assert.equal(account.planId, "free");
  assert.equal(account.entitlementStatus, "free");
  assert.equal(account.lastStripeEventId, old.id);
  await assertProcessed(old.id);
  await assertProcessed(deleted.id);
  assert.equal(
    (await billingEvents(user.uid, "subscription.canceled")).length, 1);
  const regressions = (await billingEvents(user.uid, "billing.state_changed"))
    .filter((event) => event.before?.subscriptionStatus === "canceled");
  assert.deepEqual(regressions, []);
  // Antigo, novo (assumiu o lease vencido) e antigo outra vez.
  const lease = await reconciliationLease(user.uid);
  assert.equal(lease?.generation, generation + 3);
  assert.equal(lease?.holderEventId, null);
});

// ------------------------------------------------------------ recuperação

test("queda após o lease e antes do Stripe: contenção responde 500 e o lease " +
  "vencido é assumido", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  const generation = await leaseGeneration(user.uid);
  harness.stripe.updateSubscription(user.subscriptionId, {status: "canceled"});
  const deleted = subscriptionUpdate(harness, user,
    "customer.subscription.deleted", {status: "canceled"});

  // O processo trava antes de ler o Stripe (queda simulada).
  const crashed = harness.stripe.hold("listSubscriptions");
  const zombie = deleted.send();
  await crashed.reached;
  const reads = harness.stripe.count("listSubscriptions");
  assert.equal((await webhookReceipt(deleted.id))?.status, "processing");

  // Reentrega com o lease ainda válido: contenção não vira sucesso.
  const contended = await deleted.send({contentionBackoffMs: [10, 10]});
  assert.equal(contended.status, 500);
  assert.equal((await webhookReceipt(deleted.id))?.status, "processing");
  assert.equal(harness.stripe.count("listSubscriptions"), reads);
  assert.equal((await billingAccount(user.uid)).planId, "pro");

  // O lease vence: a reentrega recupera o recibo `processing` com geração
  // nova e conclui.
  harness.clock.now += RECONCILIATION_LEASE_MS + 1;
  assert.equal((await deleted.send()).status, 200);
  const account = await billingAccount(user.uid);
  assert.equal(account.planId, "free");
  assert.equal(account.subscriptionStatus, "canceled");
  await assertProcessed(deleted.id);
  let lease = await reconciliationLease(user.uid);
  assert.equal(lease?.generation, generation + 2);
  assert.equal(lease?.holderEventId, null);
  const events = (await billingEvents(user.uid)).length;

  // O processo antigo volta: encontra o recibo `processed` e nada reaplica.
  crashed.release();
  assert.equal((await zombie).status, 200);
  assert.equal((await billingEvents(user.uid)).length, events);
  assert.equal(
    (await billingEvents(user.uid, "subscription.canceled")).length, 1);
  lease = await reconciliationLease(user.uid);
  assert.equal(lease?.generation, generation + 2);
});

test("queda após ler o Stripe e antes do commit: a leitura antiga é recusada " +
  "pela geração", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  const generation = await leaseGeneration(user.uid);
  const updated = subscriptionUpdate(harness, user);

  // Lê o Stripe (plano Pro) e trava antes do commit.
  const crashed = harness.stripe.hold("retrieveSubscription", "afterRead");
  const zombie = updated.send();
  await crashed.reached;
  assert.equal((await webhookReceipt(updated.id))?.status, "processing");

  // Depois da leitura, o titular passa a Business no Stripe; o lease vence e
  // a reentrega do mesmo evento aplica o estado atual.
  harness.stripe.updateSubscription(user.subscriptionId, {
    items: businessItems(harness),
  });
  harness.clock.now += RECONCILIATION_LEASE_MS + 1;
  assert.equal((await updated.send()).status, 200);
  assert.equal((await billingAccount(user.uid)).planId, "business");
  await assertProcessed(updated.id);
  const changes = (await billingEvents(user.uid, "billing.state_changed"))
    .length;

  // A leitura antiga (Pro) chega depois e é descartada.
  crashed.release();
  assert.equal((await zombie).status, 200);
  const account = await billingAccount(user.uid);
  assert.equal(account.planId, "business");
  assert.equal(account.stripePriceId,
    harness.env.STRIPE_PRICE_BUSINESS_MONTHLY);
  assert.equal(
    (await billingEvents(user.uid, "billing.state_changed")).length, changes);
  const lease = await reconciliationLease(user.uid);
  assert.equal(lease?.generation, generation + 2);
  assert.equal(lease?.holderEventId, null);
});

test("erro do Stripe não conclui o evento, devolve o lease e a reentrega " +
  "imediata aplica", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  const generation = await leaseGeneration(user.uid);
  harness.stripe.updateSubscription(user.subscriptionId, {status: "canceled"});
  const deleted = subscriptionUpdate(harness, user,
    "customer.subscription.deleted", {status: "canceled"});

  const methods = ["listSubscriptions", "retrieveSubscription"];
  for (const [index, method] of methods.entries()) {
    harness.stripe.failNext.add(method);
    assert.equal((await deleted.send()).status, 500, method);
    const pending = await webhookReceipt(deleted.id);
    assert.equal(pending?.status, "processing", method);
    assert.equal(pending?.outcome, null, method);
    assert.equal(pending?.processedAt, null, method);
    const lease = await reconciliationLease(user.uid);
    assert.equal(lease?.holderEventId, null, method);
    assert.equal(lease?.generation, generation + index + 1, method);
    const account = await billingAccount(user.uid);
    assert.equal(account.planId, "pro", method);
    assert.equal(account.subscriptionStatus, "active", method);
  }
  assert.equal(
    (await billingEvents(user.uid, "subscription.canceled")).length, 0);

  // Sem esperar a validade do lease (relógio parado): a reentrega aplica.
  assert.equal((await deleted.send()).status, 200);
  await assertProcessed(deleted.id);
  const account = await billingAccount(user.uid);
  assert.equal(account.planId, "free");
  assert.equal(account.subscriptionStatus, "canceled");
  const lease = await reconciliationLease(user.uid);
  assert.equal(lease?.generation, generation + 3);
  assert.equal(lease?.holderEventId, null);
});

test("recibo processed é idempotente: sem Stripe, sem lease e sem " +
  "escrita", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  const paid = invoicePaid(harness, user);
  assert.equal((await paid.send()).status, 200);
  const receiptBefore = await webhookReceipt(paid.id);
  const accountBefore = await billingAccount(user.uid);
  const leaseBefore = await reconciliationLease(user.uid);
  const eventsBefore = (await billingEvents(user.uid)).length;
  const calls = harness.stripe.calls.length;

  const responses = await Promise.all([paid.send(), paid.send()]);
  responses.push(await paid.send());
  assert.deepEqual(responses.map((response) => response.status),
    [200, 200, 200]);
  assert.equal(harness.stripe.calls.length, calls);
  assert.deepEqual(await webhookReceipt(paid.id), receiptBefore);
  assert.deepEqual(await reconciliationLease(user.uid), leaseBefore);
  assert.ok((await billingAccount(user.uid)).updatedAt
    .isEqual(accountBefore.updatedAt));
  assert.equal((await billingEvents(user.uid)).length, eventsBefore);
});
