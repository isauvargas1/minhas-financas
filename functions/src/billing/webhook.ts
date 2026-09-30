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
  billingReconciliationLeaseRef,
  billingWebhookEventRef,
  isLiveSubscriptionStatus,
  type BillingAccountDocument,
  type ReconciliationLeaseDocument,
  type WebhookReceiptStatus,
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
 * PR-BILL-06; protocolo em fases de P2A.1).
 *
 * 1. Assinatura obrigatória sobre o **raw body** com o segredo do endpoint;
 *    sem assinatura ou inválida ⇒ 400 sem efeito. Evento de outro modo
 *    (test × live) ⇒ 400 sem efeito: é configuração errada, e a falha fica
 *    visível no Stripe até ser corrigida.
 * 2. **Nenhuma chamada ao Stripe dentro de transação do Firestore.** O SDK
 *    repete o callback da transação e seguraria a conta durante o I/O
 *    externo. A reconciliação roda em fases:
 *    a. *claim* (transação curta): recibo `billing_webhook_events/{event.id}`,
 *       vínculo do customer, conta e lease do titular. Recibo `processed` ⇒
 *       200 sem efeito. Evento que não precisa do Stripe (ignorado,
 *       rejeitado, reembolso e disputa) termina aqui, com recibo `processed`.
 *       Os demais adquirem o lease (geração nova, com validade) e deixam o
 *       recibo em `processing`, que nunca vale como processado.
 *    b. Fora de transação, as assinaturas do customer são relidas no Stripe.
 *    c. *commit* (transação curta): relê recibo, conta e lease e só aplica se
 *       a geração ainda for a adquirida. Estado derivado da leitura, trilha,
 *       recibo `processed` e liberação do lease vão no mesmo commit.
 * 3. Ordem: o conteúdo do evento nunca é aplicado; o estado vem sempre da
 *    leitura atual do Stripe. A geração é um fencing token: cada aquisição a
 *    incrementa e o commit exige a sua, então os commits seguem a ordem das
 *    leituras — um evento antigo, ou uma leitura que atrasou, nunca
 *    sobrescreve uma mais nova. Quem encontra o lease válido com outro evento
 *    espera com backoff curto e tenta de novo; esgotadas as esperas, responde
 *    500 e o Stripe reentrega. Contenção nunca vira sucesso.
 * 4. Recuperação: erro no Stripe ou no commit libera o lease e mantém o
 *    recibo `processing` (500, reentrega imediata possível). Uma queda do
 *    processo deixa lease e recibo `processing`; o lease vence em
 *    `RECONCILIATION_LEASE_MS` e a reentrega assume com geração nova. Se o
 *    processo antigo voltar, o commit dele é recusado pela geração.
 * 5. O titular vem do vínculo `billing_customers/{customer}` gravado pelo
 *    servidor, conferido com `stripeCustomerId` da conta e com a metadata
 *    gravada no checkout. Divergência é rejeitada e registrada.
 * 6. 2xx só com o efeito já persistido (commit desta entrega ou recibo
 *    `processed` de uma anterior).
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
  /**
   * Esperas entre tentativas quando o lease do titular está com outro evento
   * ou a geração foi superada. Padrão: `RECONCILIATION_BACKOFF_MS`.
   */
  contentionBackoffMs?: readonly number[];
}

/**
 * Validade do lease: cobre o tempo máximo de uma execução do webhook (60 s,
 * `STRIPE_WEBHOOK_OPTIONS`). Vencido, outro evento pode assumir; a geração
 * impede que o dono antigo aplique uma leitura velha depois disso.
 */
export const RECONCILIATION_LEASE_MS = 60_000;

/**
 * Esperas por um lease ocupado (cerca de 8,5 s no total, bem abaixo do tempo
 * da função). Esgotadas, a entrega responde 500 e o Stripe reentrega.
 */
export const RECONCILIATION_BACKOFF_MS: readonly number[] = [
  50, 100, 200, 400, 800, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000, 1_000,
];

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

/** Resultado gravado no recibo `processed` (repetição não é gravada). */
type ReceiptOutcome = Exclude<WebhookOutcome, "duplicate">;

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

type SubscriptionRoute = Extract<EventRoute, {kind: "subscription"}>;

const idOf =(value: unknown): string | null => {
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

const webhookAnchor = (uid: string, event: Stripe.Event) => ({
  billingOwnerUid: uid,
  source: "stripe_webhook" as const,
  requestId: null,
  stripeEventId: event.id,
  stripeEventType: event.type,
});

const PROCESSING: WebhookReceiptStatus = "processing";
const PROCESSED: WebhookReceiptStatus = "processed";

const isProcessedReceipt = (
  receipt: admin.firestore.DocumentSnapshot,
): boolean => receipt.exists && receipt.get("status") === PROCESSED;

const receiptIdentity = (event: Stripe.Event) => ({
  id: event.id,
  type: event.type,
  livemode: event.livemode,
  stripeCreatedAt: Timestamp.fromMillis(event.created * 1000),
  expiresAt: expiresInDays(RETENTION_DAYS.billingWebhookEvents),
});

/** Recibo final, sem payload; substitui o `processing`, se houver. */
const writeProcessedReceipt = (
  transaction: admin.firestore.Transaction,
  event: Stripe.Event,
  fields: {
    billingOwnerUid: string | null;
    outcome: ReceiptOutcome;
    reason: string | null;
  },
): void => {
  transaction.set(billingWebhookEventRef(event.id), {
    ...receiptIdentity(event),
    ...fields,
    status: PROCESSED,
    processedAt: FieldValue.serverTimestamp(),
  });
};

const releasedLease = () => ({
  holderEventId: null,
  leaseExpiresAt: null,
  updatedAt: FieldValue.serverTimestamp(),
});

interface ReconciliationClaim {
  uid: string;
  customerId: string;
  generation: number;
}

type ClaimResult =
  | {kind: "done"; outcome: WebhookOutcome}
  | {kind: "busy"}
  | {kind: "claimed"; route: SubscriptionRoute; claim: ReconciliationClaim};

type CommitResult =
  | {kind: "done"; outcome: "applied" | "duplicate"}
  | {kind: "superseded"};

/**
 * Fase *claim* (transação curta, sem I/O externo). Conclui o que não
 * depende do Stripe; para assinatura, adquire o lease do titular e marca o
 * recibo `processing`.
 */
const claimStripeEvent = (
  deps: WebhookDependencies,
  event: Stripe.Event,
  route: EventRoute,
  customerId: string | null,
): Promise<ClaimResult> =>
  db().runTransaction(async (transaction): Promise<ClaimResult> => {
    const receiptRef = billingWebhookEventRef(event.id);
    if (isProcessedReceipt(await transaction.get(receiptRef))) {
      return {kind: "done", outcome: "duplicate"};
    }
    const finish = (
      outcome: ReceiptOutcome,
      billingOwnerUid: string | null,
      reason: string | null,
    ): ClaimResult => {
      writeProcessedReceipt(transaction, event, {
        billingOwnerUid,
        outcome,
        reason,
      });
      return {kind: "done", outcome};
    };

    if (route.kind === "ignored") return finish("ignored", null, route.reason);
    if (!customerId) return finish("ignored", null, "without_customer");

    const mapping = await transaction.get(billingCustomerRef(customerId));
    const uid = mapping.get("billingOwnerUid");
    if (!mapping.exists || typeof uid !== "string" || uid === "") {
      deps.log.error("billing_webhook.unknown_customer", null);
      return finish("rejected", null, "unknown_customer");
    }
    const leaseRef = billingReconciliationLeaseRef(uid);
    const [accountSnapshot, leaseSnapshot] = await transaction.getAll(
      billingAccountRef(uid),
      leaseRef,
    );
    const account = accountSnapshot.data() as
      BillingAccountDocument | undefined;
    if (!account || account.stripeCustomerId !== customerId) {
      deps.log.error("billing_webhook.owner_mismatch", null);
      return finish("rejected", null, "owner_mismatch");
    }

    const anchor = webhookAnchor(uid, event);
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
      return finish("rejected", uid, "owner_mismatch");
    }

    if (route.kind === "charge") {
      appendBillingEvent(transaction, {
        ...anchor,
        type: route.audit.type,
        before: null,
        after: null,
        details: route.audit.details,
      });
      return finish("recorded", uid, null);
    }

    const now = deps.now();
    const lease = leaseSnapshot.data() as
      ReconciliationLeaseDocument | undefined;
    if (
      lease?.holderEventId &&
      lease.leaseExpiresAt &&
      lease.leaseExpiresAt.toMillis() > now
    ) {
      // Outra reconciliação válida em andamento (inclusive outra entrega
      // deste mesmo evento): nada é gravado; a entrega espera e tenta de novo.
      return {kind: "busy"};
    }
    if (lease?.holderEventId) {
      // Lease vencido de uma tentativa que caiu ou travou. A geração nova
      // recusa o commit dela, se ainda acontecer.
      deps.log.warn("billing_webhook.lease_taken_over", {
        generation: lease.generation,
      });
    }
    const generation = (lease?.generation ?? 0) + 1;
    transaction.set(leaseRef, {
      billingOwnerUid: uid,
      generation,
      holderEventId: event.id,
      leaseExpiresAt: Timestamp.fromMillis(now + RECONCILIATION_LEASE_MS),
      acquiredAt: Timestamp.fromMillis(now),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.set(receiptRef, {
      ...receiptIdentity(event),
      billingOwnerUid: uid,
      status: PROCESSING,
      outcome: null,
      reason: null,
      processedAt: null,
      generation,
      claimedAt: FieldValue.serverTimestamp(),
    });
    return {kind: "claimed", route, claim: {uid, customerId, generation}};
  });

/** Leitura do estado atual no Stripe — sempre fora de transação. */
const readStripeSubscriptions = async (
  gateway: StripeGateway,
  customerId: string,
  subscriptionId: string | null,
): Promise<SubscriptionSnapshot[]> => {
  const listed = await gateway.listSubscriptions(customerId);
  const referenced = subscriptionId ?
    await gateway.retrieveSubscription(subscriptionId) :
    null;
  return mergeSubscriptions(listed, referenced);
};

/** Estado da conta derivado da leitura do Stripe (puro). */
const planReconciliation = (
  deps: WebhookDependencies,
  account: BillingAccountDocument,
  claim: ReconciliationClaim,
  route: SubscriptionRoute,
  subscriptions: readonly SubscriptionSnapshot[],
) => {
  const anomalies: BillingAnomaly[] = [];
  const owned: SubscriptionSnapshot[] = [];
  for (const entry of subscriptions) {
    const belongs = entry.customerId === claim.customerId &&
      (entry.metadataOwnerUid === null || entry.metadataOwnerUid === claim.uid);
    if (belongs) {
      owned.push(entry);
    } else {
      anomalies.push({kind: "foreign_subscription", subscriptionId: entry.id});
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
  return {previous, next, anomalies, clearLock};
};

/**
 * Fase *commit* (transação curta, sem I/O externo). Só aplica se o lease
 * ainda for desta entrega, na mesma geração.
 */
const commitReconciliation = (
  deps: WebhookDependencies,
  event: Stripe.Event,
  route: SubscriptionRoute,
  claim: ReconciliationClaim,
  subscriptions: readonly SubscriptionSnapshot[],
): Promise<CommitResult> =>
  db().runTransaction(async (transaction): Promise<CommitResult> => {
    const accountRef = billingAccountRef(claim.uid);
    const leaseRef = billingReconciliationLeaseRef(claim.uid);
    const [receipt, accountSnapshot, leaseSnapshot] = await transaction.getAll(
      billingWebhookEventRef(event.id),
      accountRef,
      leaseRef,
    );
    if (isProcessedReceipt(receipt)) {
      return {kind: "done", outcome: "duplicate"};
    }
    const lease = leaseSnapshot.data() as
      ReconciliationLeaseDocument | undefined;
    if (
      lease?.generation !== claim.generation ||
      lease.holderEventId !== event.id
    ) {
      // Outro evento assumiu o lease depois desta leitura do Stripe: aplicá-la
      // agora poderia sobrescrever um estado lido mais tarde.
      return {kind: "superseded"};
    }
    const account = accountSnapshot.data() as
      BillingAccountDocument | undefined;
    if (!account || account.stripeCustomerId !== claim.customerId) {
      // A conta mudou entre as fases: devolve o lease e reavalia no claim.
      transaction.update(leaseRef, releasedLease());
      return {kind: "superseded"};
    }

    const {previous, next, anomalies, clearLock} = planReconciliation(
      deps,
      account,
      claim,
      route,
      subscriptions,
    );
    const anchor = webhookAnchor(claim.uid, event);
    transaction.update(accountRef, {
      ...stateFields(next),
      catalogVersion: BILLING_CATALOG_VERSION,
      ...(clearLock ? {pendingCheckout: null} : {}),
      lastStripeEventId: event.id,
      lastStripeEventType: event.type,
      stripeSyncedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(leaseRef, releasedLease());
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
    writeProcessedReceipt(transaction, event, {
      billingOwnerUid: claim.uid,
      outcome: "applied",
      reason: null,
    });
    return {kind: "done", outcome: "applied"};
  });

/** Devolve o lease desta entrega (mesma geração); o recibo segue pendente. */
const releaseReconciliationLease = (
  event: Stripe.Event,
  claim: ReconciliationClaim,
): Promise<void> =>
  db().runTransaction(async (transaction) => {
    const leaseRef = billingReconciliationLeaseRef(claim.uid);
    const lease = (await transaction.get(leaseRef)).data() as
      ReconciliationLeaseDocument | undefined;
    if (
      lease?.generation === claim.generation &&
      lease.holderEventId === event.id
    ) {
      transaction.update(leaseRef, releasedLease());
    }
  });

/** Leitura no Stripe e commit; falha antes do commit devolve o lease. */
const reconcileClaim = async (
  deps: WebhookDependencies,
  event: Stripe.Event,
  route: SubscriptionRoute,
  claim: ReconciliationClaim,
): Promise<CommitResult> => {
  try {
    const subscriptions = await readStripeSubscriptions(
      deps.gateway,
      claim.customerId,
      route.subscriptionId,
    );
    return await commitReconciliation(
      deps,
      event,
      route,
      claim,
      subscriptions,
    );
  } catch (error) {
    // Sem commit: a reentrega não precisa esperar a validade do lease.
    try {
      await releaseReconciliationLease(event, claim);
    } catch (releaseError) {
      deps.log.error("billing_webhook.lease_release_failed", releaseError);
    }
    throw error;
  }
};

/** Lease ocupado ou geração superada até o fim das esperas. */
class ReconciliationContentionError extends Error {
  constructor() {
    super("Reconciliação do titular ocupada.");
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const applyStripeEvent = async (
  deps: WebhookDependencies,
  event: Stripe.Event,
): Promise<WebhookOutcome> => {
  const route = routeStripeEvent(event);

  // Disputa não traz o customer: resolve pela cobrança, fora de transação e
  // só se o evento ainda não foi processado.
  let customerId = route.kind === "ignored" ? null : route.customerId;
  if (route.kind === "charge" && !customerId && route.chargeId) {
    if (isProcessedReceipt(await billingWebhookEventRef(event.id).get())) {
      return "duplicate";
    }
    customerId = await deps.gateway.retrieveChargeCustomerId(route.chargeId);
  }

  const backoff = deps.contentionBackoffMs ?? RECONCILIATION_BACKOFF_MS;
  for (let attempt = 0; ; attempt += 1) {
    const claimed = await claimStripeEvent(deps, event, route, customerId);
    if (claimed.kind === "done") return claimed.outcome;
    if (claimed.kind === "claimed") {
      const committed = await reconcileClaim(
        deps,
        event,
        claimed.route,
        claimed.claim,
      );
      if (committed.kind === "done") return committed.outcome;
      deps.log.warn("billing_webhook.superseded", {
        generation: claimed.claim.generation,
      });
    }
    if (attempt >= backoff.length) throw new ReconciliationContentionError();
    await sleep(backoff[attempt]);
  }
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
    if (error instanceof ReconciliationContentionError) {
      log.warn("billing_webhook.contention");
    } else {
      log.error("billing_webhook.failed", error);
    }
    return {
      status: 500,
      body: {error: "Falha temporária ao processar o evento."},
    };
  }
};
