import assert from "node:assert/strict";

import type {CallerIdentity} from "../../shared/callable";
import type {OperationLogger} from "../../shared/logger";
import {testEmailFor} from "../../shared/testSupport/kernelTestSupport";
import {bootstrapAccount} from "../../workspaces/callables";
import {
  call,
  db,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {executeCreateCheckoutSession} from "../checkout";
import type {CheckoutDependencies} from "../checkout";
import {readPriceConfig, readWebhookSecret} from "../config";
import type {
  BillingAccountDocument,
  ReconciliationLeaseDocument,
} from "../model";
import type {WebhookDependencies} from "../webhook";
import {processStripeWebhook} from "../webhook";
import {FakeStripe, signedStripeEvent, testBillingEnv} from "./fakeStripe";
import {installTransactionProbe} from "./transactionProbe";

/**
 * Suporte das suítes de integração de billing (somente testes). Exige o
 * Emulator já no carregamento: as callables usam o Admin SDK inicializado.
 * A sonda de transação vale para todas as suítes que usam este suporte:
 * chamada ao Stripe falso de dentro de transação falha o teste.
 */
installTransactionProbe(db());

export const silentLogger = (): OperationLogger => {
  const logger: OperationLogger = {
    context: {},
    with: () => logger,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger;
};

export const callerFor = (uid: string): CallerIdentity => ({
  uid,
  email: testEmailFor(uid),
  emailVerified: true,
  authTime: Math.floor(Date.now() / 1000),
  signInProvider: "google.com",
  displayName: null,
  photoURL: null,
});

/** Conta real criada pelo `bootstrapAccount` (perfil + billing Free). */
export const bootstrapUser = async (uid: string): Promise<void> => {
  await call(bootstrapAccount, uid, {});
};

export const billingAccount = async (
  uid: string,
): Promise<BillingAccountDocument> =>
  (await db().doc(`billing_accounts/${uid}`).get())
    .data() as BillingAccountDocument;

export const billingEvents = async (uid: string, type?: string) =>
  (await db().collection(`billing_accounts/${uid}/billing_events`).get())
    .docs.map((doc) => doc.data())
    .filter((event) => !type || event.type === type);

export const webhookReceipt = async (eventId: string) =>
  (await db().doc(`billing_webhook_events/${eventId}`).get()).data();

export const reconciliationLease = async (
  uid: string,
): Promise<ReconciliationLeaseDocument | undefined> =>
  (await db().doc(`billing_accounts/${uid}/billing_sync/reconciliation`)
    .get()).data() as ReconciliationLeaseDocument | undefined;

export interface BillingHarness {
  env: ReturnType<typeof testBillingEnv>;
  stripe: FakeStripe;
  clock: {now: number};
  checkoutDeps: CheckoutDependencies;
  webhookDeps: WebhookDependencies;
  deliver: (input: {
    type: string;
    object: Record<string, unknown>;
    id?: string;
    created?: number;
    livemode?: boolean;
  }) => Promise<{status: number; id: string}>;
}

export const billingHarness = (): BillingHarness => {
  const env = testBillingEnv();
  const prices = readPriceConfig(env);
  const stripe = new FakeStripe();
  stripe.seedCatalogPrices(prices);
  const clock = {now: Date.now()};
  const webhookDeps: WebhookDependencies = {
    gateway: stripe,
    webhookSecret: readWebhookSecret(env),
    prices,
    livemode: false,
    now: () => clock.now,
    log: silentLogger(),
  };
  return {
    env,
    stripe,
    clock,
    checkoutDeps: {
      gateway: stripe,
      prices,
      livemode: false,
      allowedOrigins: [env.APP_ALLOWED_ORIGINS],
      now: () => clock.now,
    },
    webhookDeps,
    deliver: async (input) => {
      const signed = signedStripeEvent(webhookDeps.webhookSecret, input);
      const response = await processStripeWebhook(webhookDeps, {
        method: "POST",
        rawBody: signed.rawBody,
        signature: signed.signature,
      });
      return {status: response.status, id: signed.id};
    },
  };
};

/** Objeto de assinatura como chega no evento (só o que o roteador lê). */
export const subscriptionEventObject = (
  subscriptionId: string,
  customerId: string,
  ownerUid: string,
  status = "active",
) => ({
  id: subscriptionId,
  object: "subscription",
  customer: customerId,
  status,
  metadata: {billingOwnerUid: ownerUid},
  items: {object: "list", data: []},
});

export const invoiceEventObject = (
  subscriptionId: string,
  customerId: string,
  ownerUid: string,
  patch: Record<string, unknown> = {},
) => ({
  id: `in_${subscriptionId.slice(4)}`,
  object: "invoice",
  customer: customerId,
  amount_paid: 2990,
  amount_due: 2990,
  currency: "brl",
  attempt_count: 1,
  billing_reason: "subscription_cycle",
  parent: {
    type: "subscription_details",
    subscription_details: {
      subscription: subscriptionId,
      metadata: {billingOwnerUid: ownerUid},
    },
  },
  ...patch,
});

export const checkoutSessionEventObject = (
  sessionId: string,
  customerId: string,
  subscriptionId: string,
  ownerUid: string,
) => ({
  id: sessionId,
  object: "checkout.session",
  mode: "subscription",
  customer: customerId,
  subscription: subscriptionId,
  client_reference_id: ownerUid,
  payment_status: "paid",
  metadata: {billingOwnerUid: ownerUid},
});

/** Titular com checkout concluído no Stripe e o evento de conclusão. */
export const subscribedUser = async (
  harness: BillingHarness,
  planId: "pro" | "business" = "pro",
) => {
  const uid = uniqueId("wh");
  await bootstrapUser(uid);
  await executeCreateCheckoutSession(harness.checkoutDeps, {
    caller: callerFor(uid),
    payload: {
      planId,
      returnUrl: harness.env.APP_ALLOWED_ORIGINS,
      idempotencyKey: idempotencyKey(),
    },
    requestId: uniqueId("req"),
    log: silentLogger(),
  });
  const account = await billingAccount(uid);
  const customerId = account.stripeCustomerId as string;
  const sessionId = account.pendingCheckout?.sessionId as string;
  const subscription = harness.stripe.completeCheckoutSession(sessionId);
  const completed = await harness.deliver({
    type: "checkout.session.completed",
    object: checkoutSessionEventObject(
      sessionId, customerId, subscription.id, uid),
  });
  assert.equal(completed.status, 200);
  return {uid, customerId, sessionId, subscriptionId: subscription.id,
    completedEventId: completed.id};
};
