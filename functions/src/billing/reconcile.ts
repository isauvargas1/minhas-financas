import type {AuditSnapshot} from "../shared/audit";
import type {BillingEventType} from "./audit";
import {catalogPlan, type PaidPlanId, type PlanId} from "./catalog";
import {planIdForPrice, type PriceConfig} from "./config";
import {
  PAST_DUE_GRACE_MS,
  graceUntilFrom,
  paidAccessEndMs,
  resolveEntitlement,
} from "./entitlements";
import {
  isLiveSubscriptionStatus,
  type EntitlementStatus,
  type SubscriptionStatus,
} from "./model";
import type {SubscriptionSnapshot} from "./stripeGateway";

/**
 * Reconciliação pura: assinaturas do customer no Stripe → estado canônico.
 *
 * O webhook não aplica o conteúdo do evento. Ele relê no Stripe, dentro da
 * transação que lê a conta, as assinaturas atuais do customer e grava o
 * resultado desta função. Um evento antigo entregue depois de um novo apenas
 * dispara uma nova leitura do estado atual: nunca regride a conta.
 */
export interface BillingState {
  planId: PlanId;
  entitlementStatus: EntitlementStatus;
  subscriptionStatus: SubscriptionStatus;
  graceUntilMs: number | null;
  currentPeriodEndMs: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAtMs: number | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
}

export type BillingAnomaly =
  | {kind: "multiple_live_subscriptions"; subscriptionIds: string[]}
  | {kind: "unrecognized_price"; subscriptionId: string; priceId: string | null}
  | {kind: "unexpected_items"; subscriptionId: string; itemCount: number}
  | {kind: "foreign_subscription"; subscriptionId: string};

export const EMPTY_BILLING_STATE: BillingState = Object.freeze({
  planId: "free",
  entitlementStatus: "free",
  subscriptionStatus: "none",
  graceUntilMs: null,
  currentPeriodEndMs: null,
  cancelAtPeriodEnd: false,
  cancelAtMs: null,
  stripeSubscriptionId: null,
  stripePriceId: null,
}) as BillingState;

/**
 * Plano de uma assinatura. Concede plano só com exatamente um item, de
 * quantidade 1, cujo Price é o do plano no catálogo do ambiente. Metadata,
 * nome de produto ou valor nunca decidem o plano.
 */
export const paidPlanOf = (
  subscription: SubscriptionSnapshot,
  prices: PriceConfig,
): {
  planId: PaidPlanId | null;
  priceId: string | null;
  anomaly: BillingAnomaly | null;
} => {
  const first = subscription.items[0];
  if (subscription.items.length !== 1 || first.quantity !== 1) {
    return {
      planId: null,
      priceId: first?.priceId ?? null,
      anomaly: {
        kind: "unexpected_items",
        subscriptionId: subscription.id,
        itemCount: subscription.items.length,
      },
    };
  }
  const planId = planIdForPrice(first.priceId, prices);
  return {
    planId,
    priceId: first.priceId,
    anomaly: planId ? null : {
      kind: "unrecognized_price",
      subscriptionId: subscription.id,
      priceId: first.priceId,
    },
  };
};

const STATUS_PRIORITY: Record<string, number> = {
  active: 5,
  trialing: 5,
  past_due: 4,
  unpaid: 3,
  paused: 2,
  incomplete: 1,
};

/**
 * Assinatura canônica do titular: a viva de maior prioridade (em dia >
 * grace > inadimplente > pendente), depois o plano mais alto e a mais
 * recente. Sem assinatura viva, a mais recente encerrada. Mais de uma viva é
 * anomalia registrada — o checkout impede, mas o Stripe pode tê-la por
 * operação manual.
 */
export const selectCanonicalSubscription = (
  subscriptions: readonly SubscriptionSnapshot[],
  prices: PriceConfig,
): {canonical: SubscriptionSnapshot | null; duplicates: string[]} => {
  const rank = (entry: SubscriptionSnapshot): number => {
    const planId = paidPlanOf(entry, prices).planId;
    return planId ? catalogPlan(planId).rank : -1;
  };
  const byRecency = (a: SubscriptionSnapshot, b: SubscriptionSnapshot) =>
    b.created - a.created || a.id.localeCompare(b.id);
  const live = subscriptions.filter((entry) =>
    isLiveSubscriptionStatus(entry.status));
  if (live.length > 0) {
    const ordered = [...live].sort((a, b) =>
      (STATUS_PRIORITY[b.status] ?? 0) - (STATUS_PRIORITY[a.status] ?? 0) ||
      rank(b) - rank(a) ||
      byRecency(a, b));
    return {
      canonical: ordered[0],
      duplicates: ordered.slice(1).map((entry) => entry.id),
    };
  }
  const ordered = [...subscriptions].sort(byRecency);
  return {canonical: ordered[0] ?? null, duplicates: []};
};

export interface PreviousBillingState {
  subscriptionStatus: SubscriptionStatus;
  stripeSubscriptionId: string | null;
  graceUntilMs: number | null;
}

/**
 * Deriva o estado da conta. O grace period de `past_due` conta da
 * finalização da fatura que falhou; num mesmo episódio de inadimplência da
 * mesma assinatura, a âncora nunca avança (não se ganha grace novo a cada
 * fatura).
 */
export const deriveBillingState = (
  canonical: SubscriptionSnapshot | null,
  previous: PreviousBillingState,
  prices: PriceConfig,
  nowMs: number,
): {state: BillingState; anomalies: BillingAnomaly[]} => {
  if (!canonical) return {state: {...EMPTY_BILLING_STATE}, anomalies: []};
  const {planId: paidPlanId, priceId, anomaly} = paidPlanOf(canonical, prices);
  const periodEnd = canonical.items[0]?.currentPeriodEnd ?? null;
  const currentPeriodEndMs = periodEnd === null ? null : periodEnd * 1000;
  const cancelAtMs = canonical.cancelAt === null ?
    null :
    canonical.cancelAt * 1000;

  let graceUntilMs: number | null = null;
  if (canonical.status === "past_due") {
    const invoiceAnchorMs = canonical.latestInvoiceFinalizedAt === null ?
      null :
      canonical.latestInvoiceFinalizedAt * 1000;
    const sameEpisode = previous.subscriptionStatus === "past_due" &&
      previous.stripeSubscriptionId === canonical.id &&
      previous.graceUntilMs !== null;
    const previousAnchorMs = sameEpisode && previous.graceUntilMs !== null ?
      previous.graceUntilMs - PAST_DUE_GRACE_MS :
      null;
    const anchors = [invoiceAnchorMs, previousAnchorMs]
      .filter((value): value is number => value !== null);
    graceUntilMs = graceUntilFrom(
      anchors.length > 0 ? Math.min(...anchors) : nowMs,
    );
  }

  const decision = resolveEntitlement({
    status: canonical.status,
    paidPlanId,
    currentPeriodEndMs,
    cancelAtPeriodEnd: canonical.cancelAtPeriodEnd,
    cancelAtMs,
    graceUntilMs,
  }, nowMs);
  return {
    state: {
      planId: decision.planId,
      entitlementStatus: decision.entitlementStatus,
      subscriptionStatus: canonical.status,
      graceUntilMs,
      currentPeriodEndMs,
      cancelAtPeriodEnd: canonical.cancelAtPeriodEnd,
      cancelAtMs,
      stripeSubscriptionId: canonical.id,
      stripePriceId: priceId,
    },
    anomalies: anomaly && isLiveSubscriptionStatus(canonical.status) ?
      [anomaly] :
      [],
  };
};

export interface BillingTransition {
  type: BillingEventType;
  before: AuditSnapshot | null;
  after: AuditSnapshot | null;
  details: AuditSnapshot | null;
}

const isoOrNull = (ms: number | null): string | null =>
  ms === null ? null : new Date(ms).toISOString();

const summary = (state: BillingState): AuditSnapshot => ({
  planId: state.planId,
  entitlementStatus: state.entitlementStatus,
  subscriptionStatus: state.subscriptionStatus,
  stripeSubscriptionId: state.stripeSubscriptionId,
  stripePriceId: state.stripePriceId,
});

const cancellationEndMs = (state: BillingState): number | null =>
  paidAccessEndMs({
    cancelAt: state.cancelAtMs,
    cancelAtPeriodEnd: state.cancelAtPeriodEnd,
    currentPeriodEnd: state.currentPeriodEndMs,
  });

/** Mudanças relevantes entre dois estados, na ordem em que são auditadas. */
export const billingTransitions = (
  previous: BillingState,
  next: BillingState,
): BillingTransition[] => {
  const transitions: BillingTransition[] = [];
  if (
    next.stripeSubscriptionId !== null &&
    next.stripeSubscriptionId !== previous.stripeSubscriptionId
  ) {
    transitions.push({
      type: "subscription.linked",
      before: {stripeSubscriptionId: previous.stripeSubscriptionId},
      after: {
        stripeSubscriptionId: next.stripeSubscriptionId,
        subscriptionStatus: next.subscriptionStatus,
      },
      details: null,
    });
  }
  if (
    previous.planId !== next.planId ||
    previous.entitlementStatus !== next.entitlementStatus ||
    previous.subscriptionStatus !== next.subscriptionStatus ||
    previous.stripePriceId !== next.stripePriceId
  ) {
    transitions.push({
      type: "billing.state_changed",
      before: summary(previous),
      after: summary(next),
      details: null,
    });
  }
  if (
    next.entitlementStatus === "grace" &&
    previous.entitlementStatus !== "grace"
  ) {
    transitions.push({
      type: "grace.started",
      before: null,
      after: null,
      details: {graceUntil: isoOrNull(next.graceUntilMs)},
    });
  }
  if (
    previous.entitlementStatus === "grace" &&
    next.entitlementStatus !== "grace"
  ) {
    transitions.push({
      type: "grace.ended",
      before: null,
      after: null,
      details: {outcome: next.entitlementStatus},
    });
  }
  const previousEnd = cancellationEndMs(previous);
  const nextEnd = cancellationEndMs(next);
  const sameSubscription =
    previous.stripeSubscriptionId === next.stripeSubscriptionId;
  if (
    nextEnd !== null &&
    (previousEnd === null || !sameSubscription) &&
    isLiveSubscriptionStatus(next.subscriptionStatus)
  ) {
    transitions.push({
      type: "cancellation.scheduled",
      before: null,
      after: null,
      details: {effectiveAt: isoOrNull(nextEnd)},
    });
  }
  if (
    previousEnd !== null &&
    nextEnd === null &&
    sameSubscription &&
    isLiveSubscriptionStatus(next.subscriptionStatus)
  ) {
    transitions.push({
      type: "cancellation.reverted",
      before: null,
      after: null,
      details: null,
    });
  }
  if (
    next.subscriptionStatus === "canceled" &&
    (previous.subscriptionStatus !== "canceled" || !sameSubscription)
  ) {
    transitions.push({
      type: "subscription.canceled",
      before: null,
      after: null,
      details: {stripeSubscriptionId: next.stripeSubscriptionId},
    });
  }
  return transitions;
};

export const anomalyDetails = (anomaly: BillingAnomaly): AuditSnapshot => {
  switch (anomaly.kind) {
  case "multiple_live_subscriptions":
    return {
      kind: anomaly.kind,
      stripeSubscriptionIds: anomaly.subscriptionIds.join(","),
    };
  case "unrecognized_price":
    return {
      kind: anomaly.kind,
      stripeSubscriptionId: anomaly.subscriptionId,
      stripePriceId: anomaly.priceId,
    };
  case "unexpected_items":
    return {
      kind: anomaly.kind,
      stripeSubscriptionId: anomaly.subscriptionId,
      itemCount: anomaly.itemCount,
    };
  case "foreign_subscription":
    return {kind: anomaly.kind, stripeSubscriptionId: anomaly.subscriptionId};
  }
};
