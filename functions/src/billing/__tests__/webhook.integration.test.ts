import assert from "node:assert/strict";
import test from "node:test";

import {db, uniqueId} from "../../workspaces/testSupport/p1TestSupport";
import {stripeWebhook} from "../../webhooks/stripe";
import {processStripeWebhook} from "../webhook";
import {signedStripeEvent} from "../testSupport/fakeStripe";
import {
  billingAccount,
  billingEvents,
  billingHarness,
  invoiceEventObject,
  reconciliationLease,
  subscribedUser,
  subscriptionEventObject,
  type BillingHarness,
} from "../testSupport/billingTestSupport";

/**
 * Webhook do Stripe (P2A) no Emulator: eventos assinados localmente com
 * `generateTestHeaderString` e Stripe falso — sem rede, sem credenciais. As
 * asserções são sobre o estado persistido.
 */
const DAY = 24 * 60 * 60 * 1000;

const receipt = async (eventId: string) =>
  (await db().doc(`billing_webhook_events/${eventId}`).get()).data();

const subscriptionEvent = (
  harness: BillingHarness,
  user: {uid: string; customerId: string; subscriptionId: string},
  type = "customer.subscription.updated",
  extra: {created?: number; status?: string} = {},
) => harness.deliver({
  type,
  created: extra.created,
  object: subscriptionEventObject(
    user.subscriptionId, user.customerId, user.uid, extra.status),
});

// ------------------------------------------------------------- autenticação

test("assinatura ausente ou inválida é recusada sem efeito", async () => {
  const harness = billingHarness();
  const signed = signedStripeEvent(harness.webhookDeps.webhookSecret, {
    type: "customer.subscription.updated",
    object: {id: "sub_x", object: "subscription", customer: "cus_x"},
  });
  const forged = signedStripeEvent(`whsec_${"x".repeat(32)}`, {
    id: signed.id,
    type: "customer.subscription.updated",
    object: {id: "sub_x", object: "subscription", customer: "cus_x"},
  });
  for (const request of [
    {method: "POST", rawBody: signed.rawBody, signature: undefined},
    {method: "POST", rawBody: forged.rawBody, signature: forged.signature},
    {method: "POST", rawBody: Buffer.from("{\"id\":\"evt_outro\"}"),
      signature: signed.signature},
  ]) {
    const response = await processStripeWebhook(harness.webhookDeps, request);
    assert.equal(response.status, 400);
    assert.doesNotMatch(JSON.stringify(response.body), /No signatures|whsec/);
  }
  assert.equal((await processStripeWebhook(harness.webhookDeps, {
    method: "GET", rawBody: signed.rawBody, signature: signed.signature,
  })).status, 405);
  assert.equal(await receipt(signed.id), undefined);
  assert.equal(harness.stripe.calls.length, 0);
});

test("endpoint real sem segredo responde 500 sem processar", async () => {
  for (const name of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) {
    assert.equal(process.env[name], undefined);
  }
  const harness = billingHarness();
  const signed = signedStripeEvent(harness.webhookDeps.webhookSecret, {
    type: "invoice.paid",
    object: {id: "in_x", object: "invoice"},
  });
  const response = {code: 0, body: undefined as unknown};
  const res = {
    status(code: number) {
      response.code = code;
      return res;
    },
    json(body: unknown) {
      response.body = body;
      return res;
    },
  };
  await (stripeWebhook as unknown as (req: unknown, res: unknown) =>
    Promise<void>)({
    method: "POST",
    headers: {"stripe-signature": signed.signature},
    rawBody: signed.rawBody,
  }, res);
  assert.equal(response.code, 500);
  assert.equal(await receipt(signed.id), undefined);
});

test("evento de outro modo (live em ambiente test) é recusado", async () => {
  const harness = billingHarness();
  const response = await harness.deliver({
    type: "customer.subscription.updated",
    livemode: true,
    object: {id: "sub_x", object: "subscription", customer: "cus_x"},
  });
  assert.equal(response.status, 400);
  assert.equal(await receipt(response.id), undefined);
});

// ------------------------------------------------------------- ciclo de vida

test("checkout concluído vincula a assinatura e concede o plano do " +
  "Price", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness, "business");
  const account = await billingAccount(user.uid);
  assert.equal(account.planId, "business");
  assert.equal(account.entitlementStatus, "active");
  assert.equal(account.subscriptionStatus, "active");
  assert.equal(account.stripeSubscriptionId, user.subscriptionId);
  assert.equal(account.stripePriceId,
    harness.env.STRIPE_PRICE_BUSINESS_MONTHLY);
  assert.ok(account.currentPeriodEnd);
  assert.equal(account.pendingCheckout, null);
  assert.equal(account.lastStripeEventId, user.completedEventId);
  assert.equal((await receipt(user.completedEventId))?.outcome, "applied");
  const types = (await billingEvents(user.uid)).map((event) => event.type);
  assert.ok(types.includes("subscription.linked"));
  assert.ok(types.includes("billing.state_changed"));
});

test("evento repetido não reaplica efeito e responde sucesso", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  const eventsBefore = (await billingEvents(user.uid)).length;
  const invoice = invoiceEventObject(user.subscriptionId, user.customerId,
    user.uid);
  const signed = signedStripeEvent(harness.webhookDeps.webhookSecret, {
    type: "invoice.paid",
    object: invoice,
  });
  const deliver = () => processStripeWebhook(harness.webhookDeps, {
    method: "POST", rawBody: signed.rawBody, signature: signed.signature,
  });
  const responses = await Promise.all([deliver(), deliver()]);
  responses.push(await deliver());
  assert.deepEqual(responses.map((response) => response.status),
    [200, 200, 200]);
  assert.equal((await billingEvents(user.uid, "payment.succeeded")).length, 1);
  assert.equal((await billingEvents(user.uid)).length, eventsBefore + 1);
  const stored = await receipt(signed.id);
  assert.equal(stored?.status, "processed");
  assert.equal(stored?.outcome, "applied");
  assert.equal(stored?.billingOwnerUid, user.uid);
  assert.ok(stored?.expiresAt);
  assert.deepEqual(Object.keys(stored ?? {}).sort(), [
    "billingOwnerUid", "expiresAt", "id", "livemode", "outcome",
    "processedAt", "reason", "status", "stripeCreatedAt", "type",
  ], "o recibo não guarda payload");
});

test("evento fora de ordem não regride o estado", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  const base = Math.floor(Date.now() / 1000);
  // Estado atual no Stripe: assinatura encerrada.
  harness.stripe.updateSubscription(user.subscriptionId, {status: "canceled"});
  const deleted = await subscriptionEvent(harness, user,
    "customer.subscription.deleted", {created: base + 60, status: "canceled"});
  assert.equal(deleted.status, 200);
  // Evento antigo (anterior ao cancelamento) chega depois, dizendo "active".
  const stale = await subscriptionEvent(harness, user,
    "customer.subscription.updated", {created: base - 60, status: "active"});
  assert.equal(stale.status, 200);
  const account = await billingAccount(user.uid);
  assert.equal(account.subscriptionStatus, "canceled");
  assert.equal(account.planId, "free");
  assert.equal(account.entitlementStatus, "free");
  assert.equal((await receipt(stale.id))?.outcome, "applied");
  assert.equal((await billingEvents(user.uid, "subscription.canceled")).length,
    1);
});

test("eventos concorrentes do mesmo titular convergem para o estado " +
  "atual", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  harness.stripe.updateSubscription(user.subscriptionId, {
    items: [{
      priceId: harness.env.STRIPE_PRICE_BUSINESS_MONTHLY,
      quantity: 1,
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 86400,
    }],
  });
  const responses = await Promise.all([
    subscriptionEvent(harness, user),
    harness.deliver({
      type: "invoice.paid",
      object: invoiceEventObject(user.subscriptionId, user.customerId,
        user.uid),
    }),
    subscriptionEvent(harness, user),
  ]);
  assert.deepEqual(responses.map((response) => response.status),
    [200, 200, 200]);
  const account = await billingAccount(user.uid);
  assert.equal(account.planId, "business");
  assert.equal(account.entitlementStatus, "active");
});

test("upgrade pelo portal para Business é refletido; Price Pro nunca vira " +
  "Business", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness, "pro");
  // Metadata dizendo "business" não concede nada: só o Price decide.
  harness.stripe.updateSubscription(user.subscriptionId, {
    metadataOwnerUid: user.uid,
  });
  await harness.deliver({
    type: "customer.subscription.updated",
    object: {
      ...subscriptionEventObject(user.subscriptionId, user.customerId,
        user.uid),
      metadata: {billingOwnerUid: user.uid, planId: "business"},
    },
  });
  assert.equal((await billingAccount(user.uid)).planId, "pro");

  harness.stripe.updateSubscription(user.subscriptionId, {
    items: [{
      priceId: harness.env.STRIPE_PRICE_BUSINESS_MONTHLY,
      quantity: 1,
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 86400,
    }],
  });
  await subscriptionEvent(harness, user);
  assert.equal((await billingAccount(user.uid)).planId, "business");

  // Downgrade pelo portal: o plano segue o Price vigente, sem apagar nada.
  harness.stripe.updateSubscription(user.subscriptionId, {
    items: [{
      priceId: harness.env.STRIPE_PRICE_PRO_MONTHLY,
      quantity: 1,
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 30 * 86400,
    }],
  });
  await subscriptionEvent(harness, user);
  const downgraded = await billingAccount(user.uid);
  assert.equal(downgraded.planId, "pro");
  assert.equal(downgraded.stripePriceId, harness.env.STRIPE_PRICE_PRO_MONTHLY);
  const downgrade = (await billingEvents(user.uid, "billing.state_changed"))
    .find((event) => event.before?.planId === "business");
  assert.equal(downgrade?.after?.planId, "pro");
});

test("past_due mantém o plano no grace e restringe depois; pagamento " +
  "regulariza", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  const failedAt = harness.clock.now;
  harness.stripe.updateSubscription(user.subscriptionId, {
    status: "past_due",
    latestInvoiceFinalizedAt: Math.floor(failedAt / 1000),
  });
  await harness.deliver({
    type: "invoice.payment_failed",
    object: invoiceEventObject(user.subscriptionId, user.customerId, user.uid,
      {attempt_count: 1}),
  });
  let account = await billingAccount(user.uid);
  assert.equal(account.planId, "pro");
  assert.equal(account.entitlementStatus, "grace");
  assert.equal(account.subscriptionStatus, "past_due");
  assert.equal(account.graceUntil?.toMillis(),
    Math.floor(failedAt / 1000) * 1000 + 7 * DAY);
  assert.equal((await billingEvents(user.uid, "grace.started")).length, 1);
  assert.equal((await billingEvents(user.uid, "payment.failed")).length, 1);

  // Nova tentativa falha depois do grace: restrito, dados preservados.
  harness.clock.now = failedAt + 8 * DAY;
  await harness.deliver({
    type: "invoice.payment_failed",
    object: invoiceEventObject(user.subscriptionId, user.customerId, user.uid,
      {attempt_count: 2}),
  });
  account = await billingAccount(user.uid);
  assert.equal(account.planId, "free");
  assert.equal(account.entitlementStatus, "restricted");
  assert.equal((await billingEvents(user.uid, "grace.ended")).length, 1);

  harness.stripe.updateSubscription(user.subscriptionId, {status: "active"});
  await harness.deliver({
    type: "invoice.paid",
    object: invoiceEventObject(user.subscriptionId, user.customerId, user.uid),
  });
  account = await billingAccount(user.uid);
  assert.equal(account.planId, "pro");
  assert.equal(account.entitlementStatus, "active");
  assert.equal(account.graceUntil, null);
});

test("cancel_at_period_end mantém o plano até o fim do período", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  const periodEnd = Math.floor(harness.clock.now / 1000) + 10 * 86400;
  harness.stripe.updateSubscription(user.subscriptionId, {
    cancelAtPeriodEnd: true,
    items: [{priceId: harness.env.STRIPE_PRICE_PRO_MONTHLY, quantity: 1,
      currentPeriodEnd: periodEnd}],
  });
  await subscriptionEvent(harness, user);
  let account = await billingAccount(user.uid);
  assert.equal(account.planId, "pro");
  assert.equal(account.cancelAtPeriodEnd, true);
  assert.equal((await billingEvents(user.uid, "cancellation.scheduled")).length,
    1);

  // Reativação antes do fim desfaz o agendamento.
  harness.stripe.updateSubscription(user.subscriptionId, {
    cancelAtPeriodEnd: false,
  });
  await subscriptionEvent(harness, user);
  assert.equal((await billingEvents(user.uid, "cancellation.reverted")).length,
    1);

  harness.stripe.updateSubscription(user.subscriptionId, {
    cancelAtPeriodEnd: true,
  });
  harness.clock.now = periodEnd * 1000;
  await subscriptionEvent(harness, user);
  account = await billingAccount(user.uid);
  assert.equal(account.planId, "free", "acesso pago termina no fim do período");

  harness.stripe.updateSubscription(user.subscriptionId, {status: "canceled"});
  await subscriptionEvent(harness, user, "customer.subscription.deleted");
  account = await billingAccount(user.uid);
  assert.equal(account.subscriptionStatus, "canceled");
  assert.equal(account.planId, "free");
});

test("unpaid, incomplete e canceled não concedem plano pago", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness, "business");
  const cases: Array<[string, string]> = [
    ["unpaid", "restricted"],
    ["incomplete", "pending"],
    ["incomplete_expired", "free"],
    ["canceled", "free"],
  ];
  for (const [status, entitlementStatus] of cases) {
    harness.stripe.updateSubscription(user.subscriptionId, {
      status: status as never,
    });
    await subscriptionEvent(harness, user);
    const account = await billingAccount(user.uid);
    assert.equal(account.planId, "free", status);
    assert.equal(account.entitlementStatus, entitlementStatus, status);
    assert.equal(account.subscriptionStatus, status);
  }
});

test("reembolso e disputa são registrados sem mudar o " +
  "entitlement", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  harness.stripe.charges.set("ch_disputed", user.customerId);
  const refund = await harness.deliver({
    type: "charge.refunded",
    object: {id: "ch_refunded", object: "charge", customer: user.customerId,
      amount_refunded: 2990, currency: "brl", refunded: true},
  });
  const dispute = await harness.deliver({
    type: "charge.dispute.created",
    object: {id: "dp_1", object: "dispute", charge: "ch_disputed",
      amount: 2990, currency: "brl", reason: "fraudulent",
      status: "needs_response"},
  });
  assert.equal(refund.status, 200);
  assert.equal(dispute.status, 200);
  assert.equal((await receipt(refund.id))?.outcome, "recorded");
  assert.equal((await receipt(dispute.id))?.outcome, "recorded");
  const [refunded] = await billingEvents(user.uid, "refund.received");
  assert.equal(refunded.details.amountRefundedCents, 2990);
  assert.equal((await billingEvents(user.uid, "dispute.received")).length, 1);
  const account = await billingAccount(user.uid);
  assert.equal(account.planId, "pro");
  assert.equal(account.entitlementStatus, "active");
});

test("customer desconhecido ou titular divergente é rejeitado e " +
  "registrado", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  const unknown = await harness.deliver({
    type: "customer.subscription.updated",
    object: subscriptionEventObject("sub_estranho", "cus_desconhecido",
      user.uid),
  });
  assert.equal(unknown.status, 200);
  assert.equal((await receipt(unknown.id))?.outcome, "rejected");
  assert.equal((await receipt(unknown.id))?.reason, "unknown_customer");

  const forged = await harness.deliver({
    type: "customer.subscription.updated",
    object: subscriptionEventObject(user.subscriptionId, user.customerId,
      uniqueId("outro-titular")),
  });
  assert.equal((await receipt(forged.id))?.reason, "owner_mismatch");
  assert.equal((await billingEvents(user.uid, "anomaly.detected")).length, 1);
  assert.equal((await billingAccount(user.uid)).planId, "pro");
});

test("assinatura com Price desconhecido não concede plano e gera " +
  "anomalia", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  harness.stripe.updateSubscription(user.subscriptionId, {
    items: [{priceId: "price_naoconfigurado123", quantity: 1,
      currentPeriodEnd: Math.floor(Date.now() / 1000) + 86400}],
  });
  await subscriptionEvent(harness, user);
  const account = await billingAccount(user.uid);
  assert.equal(account.planId, "free");
  const anomalies = await billingEvents(user.uid, "anomaly.detected");
  assert.equal(anomalies[0]?.details.kind, "unrecognized_price");
});

test("evento não tratado é registrado como ignorado", async () => {
  const harness = billingHarness();
  const response = await harness.deliver({
    type: "customer.created",
    object: {id: "cus_novo", object: "customer"},
  });
  assert.equal(response.status, 200);
  assert.equal((await receipt(response.id))?.outcome, "ignored");
  assert.equal(harness.stripe.calls.length, 0);
});

test("falha transitória do Stripe responde 500 e o reenvio " +
  "aplica", async () => {
  const harness = billingHarness();
  const user = await subscribedUser(harness);
  harness.stripe.updateSubscription(user.subscriptionId, {status: "canceled"});
  harness.stripe.failNext.add("listSubscriptions");
  const signed = signedStripeEvent(harness.webhookDeps.webhookSecret, {
    type: "customer.subscription.deleted",
    object: subscriptionEventObject(user.subscriptionId, user.customerId,
      user.uid, "canceled"),
  });
  const request = {
    method: "POST", rawBody: signed.rawBody, signature: signed.signature,
  };
  assert.equal((await processStripeWebhook(harness.webhookDeps, request))
    .status, 500);
  // A falha não conclui o evento: recibo `processing`, sem resultado, e o
  // lease devolvido para a reentrega não esperar a validade.
  const pending = await receipt(signed.id);
  assert.equal(pending?.status, "processing");
  assert.equal(pending?.outcome, null);
  assert.equal(pending?.processedAt, null);
  assert.equal((await reconciliationLease(user.uid))?.holderEventId, null);
  assert.equal((await billingAccount(user.uid)).planId, "pro");
  assert.equal((await processStripeWebhook(harness.webhookDeps, request))
    .status, 200);
  assert.equal((await receipt(signed.id))?.status, "processed");
  assert.equal((await billingAccount(user.uid)).planId, "free");
});
