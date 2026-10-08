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
  /**
   * Quota mensal de lançamentos **deste** workspace, do contador do backend
   * (P3-E, D-40). Ausente em respostas antigas; nunca é contada no cliente.
   */
  transactionsQuota?: WorkspaceTransactionsQuota;
  /**
   * Grupos de divisão ativos **deste** workspace (P4-C, quota `splitGroups`),
   * do contador do backend. Nunca contada no cliente.
   */
  splitGroupsQuota?: WorkspaceSplitGroupsQuota;
}

/** `available`: contador confiável; `unavailable`: uso desconhecido (não zero). */
export interface WorkspaceSplitGroupsQuota {
  status: 'available' | 'unavailable';
  limit: number;
  /** Só para o titular. */
  used: number | null;
  /** Só para o titular. */
  remaining: number | null;
  /** Para todos os papéis, só com `status: available`. */
  exhausted: boolean | null;
}

/**
 * `available`: contador confiável. `not_initialized`: espaço anterior ao
 * contador. `unavailable`: estado incoerente. Nos dois últimos o uso é
 * desconhecido, nunca zero.
 */
export type TransactionsQuotaStatus = 'available' | 'not_initialized' | 'unavailable';

export interface WorkspaceTransactionsQuota {
  status: TransactionsQuotaStatus;
  /** Mês de referência (`YYYY-MM`, America/Sao_Paulo). */
  periodKey: string;
  limit: number;
  /** Só para o titular. */
  used: number | null;
  /** Só para o titular. */
  remaining: number | null;
  /** Para todos os papéis, quando o uso é conhecido. */
  exhausted: boolean | null;
}

/** Uso da conta do usuário (`getAccountUsage`). */
export interface AccountUsage {
  /** Workspaces ativos dos quais o usuário é owner. */
  activeOwnedWorkspaces: number;
  /**
   * Créditos de IA do próprio pool no mês (P2B.2), pelo plano efetivo da
   * própria conta. Ainda sem superfície na interface ("Meu Plano").
   */
  aiCreditsUsed: number;
  aiCreditsLimit: number;
  aiCreditsRemaining: number;
  /** Mês do contador (`YYYY-MM`, America/Sao_Paulo). */
  aiPeriodKey: string;
}

/**
 * Limite da conta (plano do usuário). Os limites do workspace (plano do
 * owner) são decididos e contados no servidor; a interface só lê o estado
 * que o entitlement traz (`transactionsQuota`, `splitGroupsQuota`).
 */
export type AccountLimitKey = Extract<PlanLimitKey, 'workspaces'>;

export interface DisplayEntitlement {
  planId: PlanId;
  status: EntitlementStatus;
}
