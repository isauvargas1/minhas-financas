import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";
import Stripe from "stripe";

import type {AuditSnapshot} from "../shared/audit";
import type {OperationLogger} from "../shared/logger";
import {RETENTION_DAYS, expiresInDays} from "../shared/retention";
import {appendBillingEvent, type BillingEventType} from "./audit";
import {BILLING_CATALOG_VERSION} from "./catalog";
import type {PriceConfig} from "./config";
import {
  billingAccountRef,
  billingCustomerRef,
  billingWebhookEventRef,
  isLiveSubscriptionStatus,
  type BillingAccountDocument,
} from "./model";
import {
  anomalyDetails,
  billingTransitions,
  deriveBillingState,
  selectCanonicalSubscription,
  type BillingAnomaly,
  type BillingState,
} from "./reconcile";
import type {StripeGateway, SubscriptionSnapshot} from "./stripeGateway";

/**
 * Processamento do webhook do Stripe (P2A, PR-BILL-01, PR-BILL-05,
 * PR-BILL-06).
 *
 * 1. Assinatura obrigatória sobre o **raw body** com o segredo do endpoint;
 *    sem assinatura ou inválida ⇒ 400 sem efeito. Evento de outro modo
 *    (test × live) ⇒ 400 sem efeito: é configuração errada, e a falha fica
 *    visível no Stripe até ser corrigida.
 * 2. Idempotência: `billing_webhook_events/{event.id}` é lido e criado na
 *    mesma transação que aplica o efeito. Evento repetido ⇒ 200 sem efeito.
 * 3. Ordem: o conteúdo do evento nunca é aplicado. Dentro da transação que lê
 *    a conta, as assinaturas do customer são relidas no Stripe e o estado
 *    atual é gravado. Uma transação só confirma se ninguém gravou a conta
 *    depois da leitura dela, e cada transação sempre grava a conta; então um
 *    commit posterior sempre carrega uma leitura do Stripe posterior — evento
 *    antigo entregue tarde não regride o estado.
 * 4. O titular vem do vínculo `billing_customers/{customer}` gravado pelo
 *    servidor, conferido com `stripeCustomerId` da conta e com a metadata
 *    gravada no checkout. Divergência é rejeitada e registrada.
 * 5. 2xx só depois do commit; falha transitória ⇒ 500 e o Stripe reentrega.
 *
 * Reembolso e disputa são registrados na trilha, sem mudar entitlement: quem
 * decide acesso é o estado da assinatura.
 */
export interface WebhookDependencies {
  gateway: StripeGateway;
  webhookSecret: string;
  prices: PriceConfig;
  livemode: boolean;
  now: () => number;
  log: OperationLogger;
}

export interface WebhookRequest {
  method: string;
  rawBody: Buffer | undefined;
  signature: string | undefined;
}

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

export type WebhookOutcome =
  | "applied"
  | "recorded"
  | "ignored"
  | "rejected"
  | "duplicate";

interface AuditIntent {
  type: BillingEventType;
  details: AuditSnapshot;
}

type EventRoute =
  | {
    kind: "subscription";
    customerId: string | null;
    subscriptionId: string | null;
    ownerHints: string[];
    checkoutSessionId: string | null;
    audit: AuditIntent | null;
  }
  | {
    kind: "charge";
    customerId: string | null;
    chargeId: string | null;
    audit: AuditIntent;
  }
  | {kind: "ignored"; reason: string};

const idOf = (value: unknown): string | null => {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object") {
    const id = (value as {id?: unknown}).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
};

const hint = (value: unknown): string[] =>
  typeof value === "string" && value.length > 0 ? [value] : [];

const invoiceSubscription = (invoice: Stripe.Invoice) =>
  invoice.parent?.subscription_details ?? null;

const invoiceRoute = (
  invoice: Stripe.Invoice,
  audit: AuditIntent | null,
): EventRoute => {
  const details = invoiceSubscription(invoice);
  return {
    kind: "subscription",
    customerId: idOf(invoice.customer),
    subscriptionId: idOf(details?.subscription),
    ownerHints: hint(details?.metadata?.billingOwnerUid),
    checkoutSessionId: null,
    audit,
  };
};

/** Classifica o evento; nenhuma decisão de plano sai daqui. */
export const routeStripeEvent = (event: Stripe.Event): EventRoute => {
  switch (event.type) {
  case "checkout.session.completed": {
    const session = event.data.object;
    if (session.mode !== "subscription") {
      return {kind: "ignored", reason: "checkout_not_subscription"};
    }
    return {
      kind: "subscription",
      customerId: idOf(session.customer),
      subscriptionId: idOf(session.subscription),
      ownerHints: [
        ...hint(session.client_reference_id),
        ...hint(session.metadata?.billingOwnerUid),
      ],
      checkoutSessionId: session.id,
      audit: null,
    };
  }
  case "customer.subscription.created":
  case "customer.subscription.updated":
  case "customer.subscription.deleted":
  case "customer.subscription.paused":
  case "customer.subscription.resumed": {
    const subscription = event.data.object;
    return {
      kind: "subscription",
      customerId: idOf(subscription.customer),
      subscriptionId: subscription.id,
      ownerHints: hint(subscription.metadata?.billingOwnerUid),
      checkoutSessionId: null,
      audit: null,
    };
  }
  case "invoice.paid": {
    const invoice = event.data.object;
    return invoiceRoute(invoice, {
      type: "payment.succeeded",
      details: {
        stripeInvoiceId: invoice.id ?? null,
        amountPaidCents: invoice.amount_paid,
        currency: invoice.currency,
        billingReason: invoice.billing_reason ?? null,
      },
    });
  }
  case "invoice.payment_succeeded":
    // Mesmo pagamento de `invoice.paid`: só reconcilia, sem auditar duas vezes.
    return invoiceRoute(event.data.object, null);
  case "invoice.payment_failed": {
    const invoice = event.data.object;
    return invoiceRoute(invoice, {
      type: "payment.failed",
      details: {
        stripeInvoiceId: invoice.id ?? null,
        amountDueCents: invoice.amount_due,
        currency: invoice.currency,
        attemptCount: invoice.attempt_count,
      },
    });
  }
  case "invoice.payment_action_required": {
    const invoice = event.data.object;
    return invoiceRoute(invoice, {
      type: "payment.action_required",
      details: {stripeInvoiceId: invoice.id ?? null},
    });
  }
  case "charge.refunded": {
    const charge = event.data.object;
    return {
      kind: "charge",
      customerId: idOf(charge.customer),
      chargeId: charge.id,
      audit: {
        type: "refund.received",
        details: {
          stripeChargeId: charge.id,
          amountRefundedCents: charge.amount_refunded,
          currency: charge.currency,
          fullyRefunded: charge.refunded,
        },
      },
    };
  }
  case "charge.dispute.created":
  case "charge.dispute.closed": {
    const dispute = event.data.object;
    return {
      kind: "charge",
      customerId: null,
      chargeId: idOf(dispute.charge),
      audit: {
        type: event.type === "charge.dispute.created" ?
          "dispute.received" :
          "dispute.closed",
        details: {
          stripeDisputeId: dispute.id,
          stripeChargeId: idOf(dispute.charge),
          amountCents: dispute.amount,
          currency: dispute.currency,
          reason: dispute.reason,
          status: dispute.status,
        },
      },
    };
  }
  default:
    return {kind: "ignored", reason: "unhandled_type"};
  }
};

const db = () => admin.firestore();

const millis = (value: Timestamp | null | undefined): number | null =>
  value ? value.toMillis() : null;

const timestamp = (ms: number | null): Timestamp | null =>
  ms === null ? null : Timestamp.fromMillis(ms);

const storedState = (account: BillingAccountDocument): BillingState => ({
  planId: account.planId,
  entitlementStatus: account.entitlementStatus,
  subscriptionStatus: account.subscriptionStatus,
  graceUntilMs: millis(account.graceUntil),
  currentPeriodEndMs: millis(account.currentPeriodEnd),
  cancelAtPeriodEnd: account.cancelAtPeriodEnd === true,
  cancelAtMs: millis(account.cancelAt),
  stripeSubscriptionId: account.stripeSubscriptionId,
  stripePriceId: account.stripePriceId,
});

const stateFields = (state: BillingState) => ({
  planId: state.planId,
  entitlementStatus: state.entitlementStatus,
  subscriptionStatus: state.subscriptionStatus,
  graceUntil: timestamp(state.graceUntilMs),
  currentPeriodEnd: timestamp(state.currentPeriodEndMs),
  cancelAtPeriodEnd: state.cancelAtPeriodEnd,
  cancelAt: timestamp(state.cancelAtMs),
  stripeSubscriptionId: state.stripeSubscriptionId,
  stripePriceId: state.stripePriceId,
});

/** A versão relida por ID é a mais fresca: substitui a da listagem. */
const mergeSubscriptions = (
  listed: readonly SubscriptionSnapshot[],
  referenced: SubscriptionSnapshot | null,
): SubscriptionSnapshot[] => {
  if (!referenced) return [...listed];
  return [
    ...listed.filter((entry) => entry.id !== referenced.id),
    referenced,
  ];
};

const applyStripeEvent = async (
  deps: WebhookDependencies,
  event: Stripe.Event,
): Promise<WebhookOutcome> => {
  const route = routeStripeEvent(event);
  const receiptRef = billingWebhookEventRef(event.id);

  // Disputa não traz o customer: resolve pela cobrança, leitura idempotente
  // feita só se o evento ainda não foi processado.
  let customerId = route.kind === "ignored" ? null : route.customerId;
  if (route.kind === "charge" && !customerId && route.chargeId) {
    if ((await receiptRef.get()).exists) return "duplicate";
    customerId = await deps.gateway.retrieveChargeCustomerId(route.chargeId);
  }

  return db().runTransaction(async (transaction) => {
    if ((await transaction.get(receiptRef)).exists) return "duplicate";
    const writeReceipt = (fields: {
      billingOwnerUid: string | null;
      outcome: WebhookOutcome;
      reason: string | null;
    }) => transaction.create(receiptRef, {
      id: event.id,
      type: event.type,
      livemode: event.livemode,
      stripeCreatedAt: Timestamp.fromMillis(event.created * 1000),
      ...fields,
      processedAt: FieldValue.serverTimestamp(),
      expiresAt: expiresInDays(RETENTION_DAYS.billingWebhookEvents),
    });

    if (route.kind === "ignored") {
      writeReceipt({
        billingOwnerUid: null,
        outcome: "ignored",
        reason: route.reason,
      });
      return "ignored";
    }
    if (!customerId) {
      writeReceipt({
        billingOwnerUid: null,
        outcome: "ignored",
        reason: "without_customer",
      });
      return "ignored";
    }

    const mapping = await transaction.get(billingCustomerRef(customerId));
    const uid = mapping.get("billingOwnerUid");
    if (!mapping.exists || typeof uid !== "string" || uid === "") {
      deps.log.error("billing_webhook.unknown_customer", null);
      writeReceipt({
        billingOwnerUid: null,
        outcome: "rejected",
        reason: "unknown_customer",
      });
      return "rejected";
    }
    const accountRef = billingAccountRef(uid);
    const account = (await transaction.get(accountRef)).data() as
      BillingAccountDocument | undefined;
    if (!account || account.stripeCustomerId !== customerId) {
      deps.log.error("billing_webhook.owner_mismatch", null);
      writeReceipt({
        billingOwnerUid: null,
        outcome: "rejected",
        reason: "owner_mismatch",
      });
      return "rejected";
    }

    const anchor = {
      billingOwnerUid: uid,
      source: "stripe_webhook" as const,
      requestId: null,
      stripeEventId: event.id,
      stripeEventType: event.type,
    };

    if (route.kind === "subscription" &&
      route.ownerHints.some((ownerHint) => ownerHint !== uid)) {
      deps.log.error("billing_webhook.owner_mismatch", null);
      appendBillingEvent(transaction, {
        ...anchor,
        type: "anomaly.detected",
        before: null,
        after: null,
        details: {kind: "owner_metadata_mismatch"},
      });
      writeReceipt({
        billingOwnerUid: uid,
        outcome: "rejected",
        reason: "owner_mismatch",
      });
      return "rejected";
    }

    if (route.kind === "charge") {
      appendBillingEvent(transaction, {
        ...anchor,
        type: route.audit.type,
        before: null,
        after: null,
        details: route.audit.details,
      });
      writeReceipt({billingOwnerUid: uid, outcome: "recorded", reason: null});
      return "recorded";
    }

    // Estado atual no Stripe, relido dentro da transação (ver item 3).
    const listed = await deps.gateway.listSubscriptions(customerId);
    const referenced = route.subscriptionId ?
      await deps.gateway.retrieveSubscription(route.subscriptionId) :
      null;
    const anomalies: BillingAnomaly[] = [];
    const owned: SubscriptionSnapshot[] = [];
    for (const entry of mergeSubscriptions(listed, referenced)) {
      const belongs = entry.customerId === customerId &&
        (entry.metadataOwnerUid === null || entry.metadataOwnerUid === uid);
      if (belongs) {
        owned.push(entry);
      } else {
        anomalies.push({
          kind: "foreign_subscription",
          subscriptionId: entry.id,
        });
      }
    }
    const {canonical, duplicates} = selectCanonicalSubscription(
      owned,
      deps.prices,
    );
    if (duplicates.length > 0 && canonical) {
      anomalies.push({
        kind: "multiple_live_subscriptions",
        subscriptionIds: [canonical.id, ...duplicates],
      });
    }
    const previous = storedState(account);
    const derived = deriveBillingState(canonical, {
      subscriptionStatus: previous.subscriptionStatus,
      stripeSubscriptionId: previous.stripeSubscriptionId,
      graceUntilMs: previous.graceUntilMs,
    }, deps.prices, deps.now());
    anomalies.push(...derived.anomalies);
    const next = derived.state;

    const lock = account.pendingCheckout;
    const clearLock = lock !== null && lock !== undefined && (
      (route.checkoutSessionId !== null &&
        lock.sessionId === route.checkoutSessionId) ||
      isLiveSubscriptionStatus(next.subscriptionStatus)
    );
    // Sempre grava a conta: é o que serializa eventos do mesmo titular.
    transaction.update(accountRef, {
      ...stateFields(next),
      catalogVersion: BILLING_CATALOG_VERSION,
      ...(clearLock ? {pendingCheckout: null} : {}),
      lastStripeEventId: event.id,
      lastStripeEventType: event.type,
      stripeSyncedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    for (const transition of billingTransitions(previous, next)) {
      appendBillingEvent(transaction, {...anchor, ...transition});
    }
    if (route.audit) {
      appendBillingEvent(transaction, {
        ...anchor,
        type: route.audit.type,
        before: null,
        after: null,
        details: route.audit.details,
      });
    }
    anomalies.forEach((anomaly, index) => {
      deps.log.error("billing_webhook.anomaly", null, {kind: anomaly.kind});
      appendBillingEvent(transaction, {
        ...anchor,
        type: "anomaly.detected",
        before: null,
        after: null,
        details: anomalyDetails(anomaly),
        discriminator: String(index),
      });
    });
    writeReceipt({billingOwnerUid: uid, outcome: "applied", reason: null});
    return "applied";
  });
};

export const processStripeWebhook = async (
  deps: WebhookDependencies,
  request: WebhookRequest,
): Promise<WebhookResponse> => {
  if (request.method !== "POST") {
    return {status: 405, body: {error: "Método não permitido."}};
  }
  if (!request.signature || !request.rawBody) {
    deps.log.warn("billing_webhook.signature_missing");
    return {status: 400, body: {error: "Assinatura ausente."}};
  }
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(
      request.rawBody,
      request.signature,
      deps.webhookSecret,
    );
  } catch {
    // Nunca ecoa a mensagem do SDK: não há o que ensinar a quem forja.
    deps.log.warn("billing_webhook.signature_invalid");
    return {status: 400, body: {error: "Assinatura inválida."}};
  }
  const log = deps.log.with({
    stripeEventId: event.id,
    stripeEventType: event.type,
  });
  if (event.livemode !== deps.livemode) {
    log.error("billing_webhook.livemode_mismatch", null);
    return {status: 400, body: {error: "Evento de outro ambiente."}};
  }
  try {
    const outcome = await applyStripeEvent({...deps, log}, event);
    log.info("billing_webhook.processed", {outcome});
    return {status: 200, body: {received: true}};
  } catch (error) {
    log.error("billing_webhook.failed", error);
    return {
      status: 500,
      body: {error: "Falha temporária ao processar o evento."},
    };
  }
};
