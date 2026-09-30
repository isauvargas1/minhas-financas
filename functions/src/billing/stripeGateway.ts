import Stripe from "stripe";

import {
  STRIPE_SUBSCRIPTION_STATUSES,
  type StripeSubscriptionStatus,
} from "./model";

/**
 * Adaptador do Stripe (P2A).
 *
 * O domínio de billing só conversa com o Stripe por esta interface, com
 * objetos já normalizados (`*Snapshot`). A implementação real envolve o SDK;
 * os testes usam um adaptador falso em memória (`testSupport/fakeStripe.ts`),
 * sem rede e sem credenciais.
 *
 * Versão da API fixada e igual à do endpoint configurado no Stripe (E-06):
 * nela, o período corrente fica no item da assinatura e a assinatura da
 * fatura em `invoice.parent.subscription_details`.
 */
export const STRIPE_API_VERSION = "2026-02-25.clover" as const;

export interface PriceSnapshot {
  id: string;
  active: boolean;
  type: string;
  /** Moeda em minúsculas, como o Stripe devolve (`brl`). */
  currency: string;
  unitAmount: number | null;
  recurringInterval: string | null;
  recurringIntervalCount: number | null;
  livemode: boolean;
}

export interface SubscriptionItemSnapshot {
  priceId: string | null;
  quantity: number;
  /** Segundos desde a época. */
  currentPeriodEnd: number | null;
}

export interface SubscriptionSnapshot {
  id: string;
  customerId: string | null;
  status: StripeSubscriptionStatus;
  /** Segundos desde a época. */
  created: number;
  /** `subscription_data.metadata.billingOwnerUid` gravado pelo checkout. */
  metadataOwnerUid: string | null;
  items: SubscriptionItemSnapshot[];
  cancelAtPeriodEnd: boolean;
  /** Segundos desde a época. */
  cancelAt: number | null;
  /**
   * Finalização da fatura mais recente (segundos): âncora do grace period
   * quando a assinatura está `past_due`.
   */
  latestInvoiceFinalizedAt: number | null;
  livemode: boolean;
}

export interface CheckoutSessionSnapshot {
  id: string;
  status: "open" | "complete" | "expired" | null;
  url: string | null;
  subscriptionId: string | null;
  /** `metadata.checkoutRequestId` gravado pelo checkout. */
  checkoutRequestId: string | null;
  /** Segundos desde a época. */
  expiresAt: number | null;
}

export interface CreateCheckoutSessionInput {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  /** Segundos desde a época. */
  expiresAt: number;
  billingOwnerUid: string;
  planId: string;
  catalogVersion: number;
  checkoutRequestId: string;
}

export interface StripeGateway {
  retrievePrice(priceId: string): Promise<PriceSnapshot>;
  createCustomer(
    input: {billingOwnerUid: string; email: string | null},
    idempotencyKey: string,
  ): Promise<{id: string}>;
  listOpenCheckoutSessions(
    customerId: string,
  ): Promise<CheckoutSessionSnapshot[]>;
  /**
   * Expira a sessão se ainda estiver aberta; devolve o estado final. Não
   * lança quando a sessão já foi concluída ou expirada.
   */
  expireCheckoutSession(sessionId: string): Promise<CheckoutSessionSnapshot>;
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
    idempotencyKey: string,
  ): Promise<CheckoutSessionSnapshot>;
  listSubscriptions(customerId: string): Promise<SubscriptionSnapshot[]>;
  retrieveSubscription(
    subscriptionId: string,
  ): Promise<SubscriptionSnapshot | null>;
  createPortalSession(
    input: {customerId: string; returnUrl: string},
  ): Promise<{url: string}>;
  retrieveChargeCustomerId(chargeId: string): Promise<string | null>;
}

const idOf = (
  value: string | {id: string} | null | undefined,
): string | null => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id;
  }
  return null;
};

const metadataString = (
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): string | null => {
  const value = metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

const isSubscriptionStatus = (
  value: string,
): value is StripeSubscriptionStatus =>
  (STRIPE_SUBSCRIPTION_STATUSES as readonly string[]).includes(value);

/** Normaliza a assinatura do SDK (formato da API fixada). */
export const subscriptionSnapshotFromStripe = (
  subscription: Stripe.Subscription,
): SubscriptionSnapshot => {
  const latestInvoice = subscription.latest_invoice;
  const invoiceAnchor = latestInvoice && typeof latestInvoice === "object" ?
    latestInvoice.status_transitions?.finalized_at ?? latestInvoice.created :
    null;
  return {
    id: subscription.id,
    customerId: idOf(subscription.customer),
    // Status fora da lista conhecida é tratado como `incomplete`: nada é
    // concedido até o mapeamento existir.
    status: isSubscriptionStatus(subscription.status) ?
      subscription.status :
      "incomplete",
    created: subscription.created,
    metadataOwnerUid: metadataString(subscription.metadata, "billingOwnerUid"),
    items: subscription.items.data.map((item) => ({
      priceId: idOf(item.price),
      quantity: item.quantity ?? 1,
      currentPeriodEnd: item.current_period_end ?? null,
    })),
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
    cancelAt: subscription.cancel_at ?? null,
    latestInvoiceFinalizedAt: invoiceAnchor ?? null,
    livemode: subscription.livemode === true,
  };
};

export const checkoutSessionSnapshotFromStripe = (
  session: Stripe.Checkout.Session,
): CheckoutSessionSnapshot => ({
  id: session.id,
  status: session.status ?? null,
  url: session.url ?? null,
  subscriptionId: idOf(session.subscription),
  checkoutRequestId: metadataString(session.metadata, "checkoutRequestId"),
  expiresAt: session.expires_at ?? null,
});

const isStripeError = (error: unknown): error is Stripe.errors.StripeError =>
  error instanceof Stripe.errors.StripeError;

/**
 * Teto de assinaturas lidas por customer. O checkout impede duplicidade, então
 * passar disso só acontece por operação manual no Stripe; acima do teto a
 * leitura falha fechada (500 e reentrega) em vez de decidir o plano com uma
 * lista incompleta.
 */
export const MAX_SUBSCRIPTIONS_PER_CUSTOMER = 500;

export interface StripeGatewayOptions {
  /** Somente testes: cliente HTTP falso, sem rede. */
  httpClient?: Stripe.HttpClient;
}

/**
 * Implementação real. O cliente é criado sob demanda por quem já validou a
 * chave (`config.ts`); nunca no carregamento do módulo e nunca com valor
 * padrão.
 */
export const createStripeGateway = (
  secretKey: string,
  options: StripeGatewayOptions = {},
): StripeGateway => {
  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
    ...(options.httpClient ? {httpClient: options.httpClient} : {}),
  });

  const retrieveSession = async (
    sessionId: string,
  ): Promise<CheckoutSessionSnapshot> =>
    checkoutSessionSnapshotFromStripe(
      await stripe.checkout.sessions.retrieve(sessionId),
    );

  return {
    async retrievePrice(priceId) {
      const price = await stripe.prices.retrieve(priceId);
      return {
        id: price.id,
        active: price.active,
        type: price.type,
        currency: price.currency,
        unitAmount: price.unit_amount ?? null,
        recurringInterval: price.recurring?.interval ?? null,
        recurringIntervalCount: price.recurring?.interval_count ?? null,
        livemode: price.livemode,
      };
    },

    async createCustomer(input, idempotencyKey) {
      const customer = await stripe.customers.create({
        ...(input.email ? {email: input.email} : {}),
        preferred_locales: ["pt-BR"],
        metadata: {billingOwnerUid: input.billingOwnerUid},
      }, {idempotencyKey});
      return {id: customer.id};
    },

    async listOpenCheckoutSessions(customerId) {
      const page = await stripe.checkout.sessions.list({
        customer: customerId,
        status: "open",
        limit: 100,
      });
      return page.data.map(checkoutSessionSnapshotFromStripe);
    },

    async expireCheckoutSession(sessionId) {
      try {
        return checkoutSessionSnapshotFromStripe(
          await stripe.checkout.sessions.expire(sessionId),
        );
      } catch (error) {
        // Só sessões `open` expiram; qualquer outra resposta é conferida
        // relendo a sessão, que diz se ela foi concluída ou já expirou.
        if (
          isStripeError(error) &&
          error.type === "StripeInvalidRequestError"
        ) {
          return retrieveSession(sessionId);
        }
        throw error;
      }
    },

    async createCheckoutSession(input, idempotencyKey) {
      const metadata = {
        billingOwnerUid: input.billingOwnerUid,
        planId: input.planId,
        catalogVersion: String(input.catalogVersion),
        checkoutRequestId: input.checkoutRequestId,
      };
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: input.customerId,
        client_reference_id: input.billingOwnerUid,
        line_items: [{price: input.priceId, quantity: 1}],
        payment_method_types: ["card"],
        locale: "pt-BR",
        expires_at: input.expiresAt,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        metadata,
        subscription_data: {
          metadata: {
            billingOwnerUid: input.billingOwnerUid,
            planId: input.planId,
          },
        },
      }, {idempotencyKey});
      return checkoutSessionSnapshotFromStripe(session);
    },

    async listSubscriptions(customerId) {
      // Todas as páginas, não só a primeira: uma assinatura viva além dos
      // 100 mais recentes mudaria a assinatura canônica.
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
        expand: ["data.latest_invoice"],
      }).autoPagingToArray({limit: MAX_SUBSCRIPTIONS_PER_CUSTOMER + 1});
      if (subscriptions.length > MAX_SUBSCRIPTIONS_PER_CUSTOMER) {
        throw new Error("Customer com assinaturas acima do teto de leitura.");
      }
      return subscriptions.map(subscriptionSnapshotFromStripe);
    },

    async retrieveSubscription(subscriptionId) {
      try {
        return subscriptionSnapshotFromStripe(
          await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ["latest_invoice"],
          }),
        );
      } catch (error) {
        if (isStripeError(error) && error.statusCode === 404) return null;
        throw error;
      }
    },

    async createPortalSession(input) {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
        locale: "pt-BR",
      });
      return {url: session.url};
    },

    async retrieveChargeCustomerId(chargeId) {
      const charge = await stripe.charges.retrieve(chargeId);
      return idOf(charge.customer);
    },
  };
};
