/**
 * Tipos cliente do billing canônico (P2A).
 *
 * O servidor é a autoridade sobre plano, catálogo e assinatura. Estes tipos
 * descrevem só o que a interface lê: o catálogo devolvido por
 * `getBillingCatalog` e a visão de `billing_accounts/{uid}` com os
 * `Timestamp` já convertidos em `Date`.
 */
export type PlanId = 'free' | 'pro' | 'business';
export type PaidPlanId = Exclude<PlanId, 'free'>;

export type EntitlementStatus = 'free' | 'active' | 'grace' | 'restricted' | 'pending';

export type SubscriptionStatus =
  | 'none'
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'unpaid'
  | 'canceled'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export interface PlanLimits {
  workspaces: number;
  membersPerWorkspace: number;
  transactionsPerMonth: number;
  splitGroups: number;
  aiCreditsPerMonth: number;
}

export type PlanLimitKey = keyof PlanLimits;

export interface BillingPlan {
  planId: PlanId;
  name: string;
  /** Preço mensal em centavos inteiros. */
  amountCents: number;
  interval: 'month';
  limits: PlanLimits;
}

export interface BillingCatalog {
  catalogVersion: number;
  currency: 'BRL';
  plans: BillingPlan[];
}

/** Visão cliente de `billing_accounts/{uid}`: só o que a interface usa. */
export interface BillingAccount {
  planId: PlanId;
  entitlementStatus: EntitlementStatus;
  subscriptionStatus: SubscriptionStatus;
  graceUntil: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | null;
  /** `true` quando já existe cliente no provedor de pagamento. */
  hasCustomer: boolean;
}

export interface DisplayEntitlement {
  planId: PlanId;
  status: EntitlementStatus;
}
