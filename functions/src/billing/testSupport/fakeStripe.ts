import {randomUUID} from "node:crypto";

import Stripe from "stripe";

import type {PriceConfig} from "../config";
import type {StripeSubscriptionStatus} from "../model";
import type {
  CheckoutSessionSnapshot,
  CreateCheckoutSessionInput,
  PriceSnapshot,
  StripeGateway,
  SubscriptionSnapshot,
} from "../stripeGateway";

/**
 * Stripe em memória para os testes de billing (somente testes; fora dos
 * exports e do upload de deploy). Sem rede e sem credenciais.
 *
 * Simula o que o domínio depende do Stripe: idempotência por
 * `Idempotency-Key` (mesma chave ⇒ mesmo objeto), sessões que só expiram
 * enquanto abertas, conclusão de sessão criando assinatura e leitura sempre
 * do estado atual.
 */
const randomToken = (length: number): string => {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let index = 0; index < length; index += 1) {
    token += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return token;
};

/** Configuração de teste gerada a cada suíte (não é credencial). */
export const testBillingEnv = () => {
  const pro = `price_pro${randomToken(16)}`;
  const business = `price_business${randomToken(16)}`;
  return {
    STRIPE_SECRET_KEY: `sk_test_${randomToken(32)}`,
    STRIPE_WEBHOOK_SECRET: `whsec_${randomToken(32)}`,
    STRIPE_PRICE_PRO_MONTHLY: pro,
    STRIPE_PRICE_BUSINESS_MONTHLY: business,
    APP_ALLOWED_ORIGINS: "https://app.minhas-financas.test",
  };
};

export interface FakeCall {
  method: string;
  idempotencyKey?: string;
  args?: unknown;
}

export class FakeStripe implements StripeGateway {
  readonly calls: FakeCall[] = [];
  readonly prices = new Map<string, PriceSnapshot>();
  readonly customers = new Map<string, {id: string; billingOwnerUid: string}>();
  readonly sessions = new Map<string, CheckoutSessionSnapshot & {
    customerId: string;
    priceId: string;
    billingOwnerUid: string;
    planId: string;
  }>();
  readonly subscriptions = new Map<string, SubscriptionSnapshot>();
  readonly charges = new Map<string, string>();
  private readonly idempotent = new Map<string, unknown>();
  /** Falha injetada por método (uma vez). */
  readonly failNext = new Set<string>();

  constructor(readonly livemode = false) {}

  /** Cadastra os Prices do catálogo com os valores reais do plano. */
  seedCatalogPrices(prices: PriceConfig): void {
    this.prices.set(prices.pro, this.price(prices.pro, 2990));
    this.prices.set(prices.business, this.price(prices.business, 5990));
  }

  price(id: string, unitAmount: number): PriceSnapshot {
    return {
      id,
      active: true,
      type: "recurring",
      currency: "brl",
      unitAmount,
      recurringInterval: "month",
      recurringIntervalCount: 1,
      livemode: this.livemode,
    };
  }

  count(method: string): number {
    return this.calls.filter((call) => call.method === method).length;
  }

  private maybeFail(method: string): void {
    if (this.failNext.delete(method)) {
      throw new Error(`falha injetada em ${method}`);
    }
  }

  private once<T>(key: string, create: () => T): T {
    if (this.idempotent.has(key)) return this.idempotent.get(key) as T;
    const value = create();
    this.idempotent.set(key, value);
    return value;
  }

  async retrievePrice(priceId: string): Promise<PriceSnapshot> {
    this.calls.push({method: "retrievePrice", args: priceId});
    this.maybeFail("retrievePrice");
    const price = this.prices.get(priceId);
    if (!price) throw new Error("No such price");
    return {...price};
  }

  async createCustomer(
    input: {billingOwnerUid: string; email: string | null},
    idempotencyKey: string,
  ): Promise<{id: string}> {
    this.calls.push({method: "createCustomer", idempotencyKey, args: input});
    this.maybeFail("createCustomer");
    return this.once(`customer:${idempotencyKey}`, () => {
      const id = `cus_${randomToken(14)}`;
      this.customers.set(id, {id, billingOwnerUid: input.billingOwnerUid});
      return {id};
    });
  }

  async listOpenCheckoutSessions(
    customerId: string,
  ): Promise<CheckoutSessionSnapshot[]> {
    this.calls.push({method: "listOpenCheckoutSessions", args: customerId});
    return [...this.sessions.values()]
      .filter((entry) =>
        entry.customerId === customerId && entry.status === "open")
      .map((entry) => this.sessionSnapshot(entry.id));
  }

  async expireCheckoutSession(
    sessionId: string,
  ): Promise<CheckoutSessionSnapshot> {
    this.calls.push({method: "expireCheckoutSession", args: sessionId});
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("No such checkout session");
    if (session.status === "open") session.status = "expired";
    return this.sessionSnapshot(sessionId);
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
    idempotencyKey: string,
  ): Promise<CheckoutSessionSnapshot> {
    this.calls.push({
      method: "createCheckoutSession",
      idempotencyKey,
      args: input,
    });
    this.maybeFail("createCheckoutSession");
    const id = this.once(`session:${idempotencyKey}`, () => {
      const sessionId = `cs_test_${randomToken(20)}`;
      this.sessions.set(sessionId, {
        id: sessionId,
        status: "open",
        url: `https://checkout.stripe.test/c/pay/${sessionId}`,
        subscriptionId: null,
        checkoutRequestId: input.checkoutRequestId,
        expiresAt: input.expiresAt,
        customerId: input.customerId,
        priceId: input.priceId,
        billingOwnerUid: input.billingOwnerUid,
        planId: input.planId,
      });
      return sessionId;
    });
    return this.sessionSnapshot(id);
  }

  private sessionSnapshot(id: string): CheckoutSessionSnapshot {
    const session = this.sessions.get(id);
    if (!session) throw new Error("No such checkout session");
    return {
      id: session.id,
      status: session.status,
      url: session.status === "open" ? session.url : null,
      subscriptionId: session.subscriptionId,
      checkoutRequestId: session.checkoutRequestId,
      expiresAt: session.expiresAt,
    };
  }

  /** O cliente paga a sessão: só sessão aberta vira assinatura. */
  completeCheckoutSession(
    sessionId: string,
    status: StripeSubscriptionStatus = "active",
  ): SubscriptionSnapshot {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("No such checkout session");
    if (session.status !== "open") {
      throw new Error(`sessão ${session.status} não pode ser concluída`);
    }
    session.status = "complete";
    const subscription = this.addSubscription({
      customerId: session.customerId,
      priceId: session.priceId,
      status,
      metadataOwnerUid: session.billingOwnerUid,
    });
    session.subscriptionId = subscription.id;
    return subscription;
  }

  addSubscription(input: {
    customerId: string;
    priceId: string | null;
    status?: StripeSubscriptionStatus;
    metadataOwnerUid?: string | null;
    created?: number;
    currentPeriodEnd?: number;
    items?: SubscriptionSnapshot["items"];
  }): SubscriptionSnapshot {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const subscription: SubscriptionSnapshot = {
      id: `sub_${randomToken(14)}`,
      customerId: input.customerId,
      status: input.status ?? "active",
      created: input.created ?? nowSeconds,
      metadataOwnerUid: input.metadataOwnerUid ?? null,
      items: input.items ?? [{
        priceId: input.priceId,
        quantity: 1,
        currentPeriodEnd: input.currentPeriodEnd ?? nowSeconds + 30 * 86400,
      }],
      cancelAtPeriodEnd: false,
      cancelAt: null,
      latestInvoiceFinalizedAt: nowSeconds,
      livemode: this.livemode,
    };
    this.subscriptions.set(subscription.id, subscription);
    return subscription;
  }

  updateSubscription(
    id: string,
    patch: Partial<SubscriptionSnapshot>,
  ): SubscriptionSnapshot {
    const current = this.subscriptions.get(id);
    if (!current) throw new Error("No such subscription");
    const next = {...current, ...patch};
    this.subscriptions.set(id, next);
    return next;
  }

  async listSubscriptions(customerId: string): Promise<SubscriptionSnapshot[]> {
    this.calls.push({method: "listSubscriptions", args: customerId});
    this.maybeFail("listSubscriptions");
    return [...this.subscriptions.values()]
      .filter((entry) => entry.customerId === customerId)
      .map((entry) => structuredClone(entry));
  }

  async retrieveSubscription(
    subscriptionId: string,
  ): Promise<SubscriptionSnapshot | null> {
    this.calls.push({method: "retrieveSubscription", args: subscriptionId});
    const found = this.subscriptions.get(subscriptionId);
    return found ? structuredClone(found) : null;
  }

  async createPortalSession(
    input: {customerId: string; returnUrl: string},
  ): Promise<{url: string}> {
    this.calls.push({method: "createPortalSession", args: input});
    return {url: `https://billing.stripe.test/p/session/${randomUUID()}`};
  }

  async retrieveChargeCustomerId(chargeId: string): Promise<string | null> {
    this.calls.push({method: "retrieveChargeCustomerId", args: chargeId});
    return this.charges.get(chargeId) ?? null;
  }
}

/**
 * Evento assinado localmente com o segredo de teste, exatamente como o
 * Stripe o entregaria (`generateTestHeaderString`). Sem rede.
 */
export const signedStripeEvent = (
  secret: string,
  input: {
    id?: string;
    type: string;
    object: Record<string, unknown>;
    created?: number;
    livemode?: boolean;
  },
): {rawBody: Buffer; signature: string; id: string} => {
  const id = input.id ?? `evt_${randomToken(20)}`;
  const payload = JSON.stringify({
    id,
    object: "event",
    api_version: "2026-02-25.clover",
    created: input.created ?? Math.floor(Date.now() / 1000),
    livemode: input.livemode ?? false,
    pending_webhooks: 1,
    request: {id: null, idempotency_key: null},
    type: input.type,
    data: {object: input.object},
  });
  const signature = Stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  });
  return {rawBody: Buffer.from(payload), signature, id};
};
