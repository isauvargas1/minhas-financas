/**
 * Catálogo comercial canônico (P2A, D-08).
 *
 * Única definição de planos, preços e limites do produto. O frontend recebe
 * a projeção pública por `getBillingCatalog` e nunca decide preço, limite ou
 * `priceId`; o `priceId` do Stripe varia por ambiente e vem da configuração do
 * projeto (`config.ts`), nunca deste arquivo nem do bundle.
 *
 * Valores monetários em centavos inteiros de BRL (D-16, D-34). Não existe
 * limite "ilimitado": todo plano tem teto numérico explícito.
 *
 * Mudar preço ou limite exige nova versão (`BILLING_CATALOG_VERSION`) e, no
 * Stripe, um novo Price (Prices são imutáveis). A regra para assinantes
 * existentes é decisão comercial registrada em BILLING_ENTITLEMENTS.md.
 */
export const BILLING_CATALOG_VERSION = 1;

export const PLAN_IDS = ["free", "pro", "business"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export const PAID_PLAN_IDS = ["pro", "business"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

export interface PlanLimits {
  /** Workspaces ativos dos quais o titular da assinatura é owner (D-01). */
  workspaces: number;
  /** Membros ativos por workspace, incluindo o owner. */
  membersPerWorkspace: number;
  /** Lançamentos por mês civil. */
  transactionsPerMonth: number;
  /** Grupos de divisão de contas. */
  splitGroups: number;
  /** Créditos de IA por mês civil, independentes de provedor (D-11). */
  aiCreditsPerMonth: number;
}

export interface CatalogPlan {
  planId: PlanId;
  /** Nome exibido ao usuário (pt-BR). */
  name: string;
  /** Preço mensal em centavos de BRL. */
  amountCents: number;
  interval: "month";
  /** Ordem comercial: maior = plano superior. */
  rank: number;
  limits: PlanLimits;
}

/** Política comercial da primeira oferta (D-08). */
export const BILLING_POLICY = {
  currency: "brl",
  /** Cobrança mensal; sem trial: o plano Free substitui o trial. */
  interval: "month",
  trialDays: 0,
  /** `past_due` mantém o plano pago por 7 dias a partir da cobrança falha. */
  pastDueGraceDays: 7,
  /** Cancelamento sempre no fim do período já pago. */
  cancellation: "period_end",
} as const;

const PLANS: Readonly<Record<PlanId, CatalogPlan>> = Object.freeze({
  free: Object.freeze({
    planId: "free",
    name: "Gratuito",
    amountCents: 0,
    interval: "month",
    rank: 0,
    limits: Object.freeze({
      workspaces: 1,
      membersPerWorkspace: 2,
      transactionsPerMonth: 50,
      splitGroups: 2,
      aiCreditsPerMonth: 10,
    }),
  }),
  pro: Object.freeze({
    planId: "pro",
    name: "Pro",
    amountCents: 2990,
    interval: "month",
    rank: 1,
    limits: Object.freeze({
      workspaces: 5,
      membersPerWorkspace: 10,
      transactionsPerMonth: 1000,
      splitGroups: 10,
      aiCreditsPerMonth: 150,
    }),
  }),
  business: Object.freeze({
    planId: "business",
    name: "Business",
    amountCents: 5990,
    interval: "month",
    rank: 2,
    limits: Object.freeze({
      workspaces: 20,
      membersPerWorkspace: 50,
      transactionsPerMonth: 10000,
      splitGroups: 100,
      aiCreditsPerMonth: 750,
    }),
  }),
}) as Readonly<Record<PlanId, CatalogPlan>>;

export const isPlanId = (value: unknown): value is PlanId =>
  typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);

export const isPaidPlanId = (value: unknown): value is PaidPlanId =>
  typeof value === "string" &&
  (PAID_PLAN_IDS as readonly string[]).includes(value);

export const catalogPlan = (planId: PlanId): CatalogPlan => PLANS[planId];

export const planLimits = (planId: PlanId): PlanLimits => PLANS[planId].limits;

export interface PublicCatalogPlan {
  planId: PlanId;
  name: string;
  amountCents: number;
  interval: "month";
  limits: PlanLimits;
}

export interface PublicBillingCatalog {
  catalogVersion: number;
  currency: "BRL";
  plans: PublicCatalogPlan[];
}

/**
 * Projeção pública entregue à interface: nome, preço, intervalo e limites.
 * Sem `priceId`, `rank` ou qualquer configuração de ambiente.
 */
export const publicBillingCatalog = (): PublicBillingCatalog => ({
  catalogVersion: BILLING_CATALOG_VERSION,
  currency: "BRL",
  plans: PLAN_IDS.map((planId) => {
    const plan = PLANS[planId];
    return {
      planId: plan.planId,
      name: plan.name,
      amountCents: plan.amountCents,
      interval: plan.interval,
      limits: {...plan.limits},
    };
  }),
});
