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

/**
 * Entitlement do workspace (`getWorkspaceEntitlement`): plano do owner
 * avaliado pelo servidor, sem nenhum dado de cobrança do owner.
 */
export interface WorkspaceEntitlement {
  catalogVersion: number;
  planId: PlanId;
  entitlementStatus: EntitlementStatus;
  limits: PlanLimits;
}

/** Uso da conta do usuário (`getAccountUsage`). */
export interface AccountUsage {
  /** Workspaces ativos dos quais o usuário é owner. */
  activeOwnedWorkspaces: number;
}

/** Limites da conta (plano do usuário) e do workspace (plano do owner). */
export type AccountLimitKey = Extract<PlanLimitKey, 'workspaces'>;
export type WorkspaceLimitKey = Exclude<PlanLimitKey, 'workspaces'>;

export interface DisplayEntitlement {
  planId: PlanId;
  status: EntitlementStatus;
}
