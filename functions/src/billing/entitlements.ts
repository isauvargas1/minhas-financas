import {
  BILLING_POLICY,
  isPlanId,
  planLimits,
  type PaidPlanId,
  type PlanId,
  type PlanLimits,
} from "./catalog";
import type {EntitlementStatus, SubscriptionStatus} from "./model";

/**
 * Mapeamento puro assinatura → entitlement (P2A, D-08).
 *
 * Sem I/O e sem relógio implícito: o instante é sempre parâmetro. É a única
 * regra de concessão do backend; a interface só exibe o resultado.
 *
 * - sem assinatura, `canceled`, `incomplete_expired` → Free;
 * - `active`, `trialing` → plano do Price (Free após o fim agendado);
 * - `past_due` → plano pago até `graceUntil`; depois restrito;
 * - `unpaid`, `paused` → restrito (limites do Free);
 * - `incomplete` → pendente (limites do Free).
 *
 * Price desconhecido nunca concede plano pago. Perder o entitlement nunca
 * apaga nem esconde dados: só muda os limites de novas operações.
 */
export interface EntitlementDecision {
  planId: PlanId;
  entitlementStatus: EntitlementStatus;
}

export interface SubscriptionTerms {
  status: SubscriptionStatus;
  /** Plano do Price reconhecido; `null` sem assinatura ou Price estranho. */
  paidPlanId: PaidPlanId | null;
  currentPeriodEndMs: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAtMs: number | null;
  /** Fim do grace period (`past_due`); `null` fora dele. */
  graceUntilMs: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const PAST_DUE_GRACE_MS = BILLING_POLICY.pastDueGraceDays * DAY_MS;

const FREE: EntitlementDecision = {planId: "free", entitlementStatus: "free"};
const RESTRICTED: EntitlementDecision = {
  planId: "free",
  entitlementStatus: "restricted",
};
const PENDING: EntitlementDecision = {
  planId: "free",
  entitlementStatus: "pending",
};

/** Grace period de `past_due` contado a partir da cobrança que falhou. */
export const graceUntilFrom = (pastDueSinceMs: number): number =>
  pastDueSinceMs + PAST_DUE_GRACE_MS;

/**
 * Fim agendado do acesso pago: `cancel_at` ou, com `cancel_at_period_end`,
 * o fim do período corrente. `null` quando nada está agendado.
 */
export const paidAccessEndMs = (terms: {
  cancelAt: number | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
}): number | null =>
  terms.cancelAt ?? (terms.cancelAtPeriodEnd ? terms.currentPeriodEnd : null);

export const resolveEntitlement = (
  terms: SubscriptionTerms,
  nowMs: number,
): EntitlementDecision => {
  const accessEnd = paidAccessEndMs({
    cancelAt: terms.cancelAtMs,
    cancelAtPeriodEnd: terms.cancelAtPeriodEnd,
    currentPeriodEnd: terms.currentPeriodEndMs,
  });
  const accessEnded = accessEnd !== null && nowMs >= accessEnd;
  switch (terms.status) {
  case "active":
  case "trialing":
    if (!terms.paidPlanId || accessEnded) return FREE;
    return {planId: terms.paidPlanId, entitlementStatus: "active"};
  case "past_due":
    if (accessEnded) return FREE;
    if (
      !terms.paidPlanId ||
      terms.graceUntilMs === null ||
      nowMs >= terms.graceUntilMs
    ) {
      return RESTRICTED;
    }
    return {planId: terms.paidPlanId, entitlementStatus: "grace"};
  case "unpaid":
  case "paused":
    return RESTRICTED;
  case "incomplete":
    return PENDING;
  case "none":
  case "canceled":
  case "incomplete_expired":
    return FREE;
  default: {
    // Status que o Stripe venha a criar: nada é concedido até ser mapeado.
    const unknown: never = terms.status;
    void unknown;
    return RESTRICTED;
  }
  }
};

/** Campos da conta canônica usados na reavaliação. */
export interface StoredEntitlement {
  planId: unknown;
  entitlementStatus: unknown;
  graceUntilMs: number | null;
  currentPeriodEndMs: number | null;
  cancelAtPeriodEnd: boolean;
  cancelAtMs: number | null;
}

/**
 * Entitlement efetivo **agora** a partir do estado gravado.
 *
 * O grace period e o cancelamento no fim do período vencem sem evento novo
 * do Stripe; o valor gravado vale só até esses instantes. Quem decide acesso
 * (P2B em diante) chama esta função com o relógio do servidor.
 */
export const effectiveEntitlement = (
  stored: StoredEntitlement,
  nowMs: number,
): EntitlementDecision => {
  if (!isPlanId(stored.planId)) return FREE;
  const status = stored.entitlementStatus;
  if (status === "grace") {
    if (stored.graceUntilMs === null || nowMs >= stored.graceUntilMs) {
      return RESTRICTED;
    }
  } else if (status !== "active") {
    if (status === "restricted") return RESTRICTED;
    if (status === "pending") return PENDING;
    return FREE;
  }
  if (stored.planId === "free") return FREE;
  const accessEnd = paidAccessEndMs({
    cancelAt: stored.cancelAtMs,
    cancelAtPeriodEnd: stored.cancelAtPeriodEnd,
    currentPeriodEnd: stored.currentPeriodEndMs,
  });
  if (accessEnd !== null && nowMs >= accessEnd) return FREE;
  return {planId: stored.planId, entitlementStatus: status};
};

/** Limites do entitlement efetivo (API consumida pela quota de P2B). */
export const effectiveLimits = (
  stored: StoredEntitlement,
  nowMs: number,
): PlanLimits => planLimits(effectiveEntitlement(stored, nowMs).planId);
