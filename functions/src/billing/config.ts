import {ApplicationError} from "../shared/errors";
import {PAID_PLAN_IDS, type PaidPlanId} from "./catalog";

/**
 * Configuração de billing por ambiente (P2A, PR-BILL-05).
 *
 * Tudo vem do Secret Manager do próprio projeto, montado pela declaração
 * `secrets` de cada função (`callables.ts`, `webhooks/stripe.ts`); nada fica
 * no código nem no bundle. Não existe valor padrão: configuração ausente,
 * vazia ou fora do formato **falha fechada** — o checkout recusa, o portal
 * recusa e o webhook responde 500 sem processar.
 *
 * Os formatos exigem o comprimento real das credenciais do Stripe, o que
 * recusa também valores de exemplo como os antigos `sk_test_placeholder` e
 * `whsec_placeholder`: um segredo de webhook adivinhável deixaria qualquer um
 * forjar eventos com assinatura "válida".
 */
export const STRIPE_SECRET_KEY = "STRIPE_SECRET_KEY";
export const STRIPE_WEBHOOK_SECRET = "STRIPE_WEBHOOK_SECRET";
export const APP_ALLOWED_ORIGINS = "APP_ALLOWED_ORIGINS";

/** Price do Stripe de cada plano pago, por ambiente. */
export const STRIPE_PRICE_SECRETS: Readonly<Record<PaidPlanId, string>> = {
  pro: "STRIPE_PRICE_PRO_MONTHLY",
  business: "STRIPE_PRICE_BUSINESS_MONTHLY",
};

const PRICE_SECRETS = PAID_PLAN_IDS.map((planId) =>
  STRIPE_PRICE_SECRETS[planId]);

/** Segredos que cada função declara (e só eles são montados). */
export const CHECKOUT_SECRETS: readonly string[] = [
  STRIPE_SECRET_KEY,
  ...PRICE_SECRETS,
  APP_ALLOWED_ORIGINS,
];
export const PORTAL_SECRETS: readonly string[] = [
  STRIPE_SECRET_KEY,
  APP_ALLOWED_ORIGINS,
];
export const WEBHOOK_SECRETS: readonly string[] = [
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  ...PRICE_SECRETS,
];

const SECRET_KEY_PATTERN = /^(sk|rk)_(test|live)_[A-Za-z0-9]{24,}$/;
const WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9+/=_-]{24,}$/;
const PRICE_ID_PATTERN = /^price_[A-Za-z0-9]{8,}$/;

/** Configuração ausente ou inválida; carrega só os **nomes**, nunca valores. */
export class BillingConfigError extends Error {
  readonly names: readonly string[];

  constructor(names: readonly string[]) {
    super(`Configuração de billing ausente ou inválida: ${names.join(", ")}`);
    this.name = "BillingConfigError";
    this.names = names;
  }
}

type Env = Record<string, string | undefined>;

const raw = (env: Env, name: string): string => (env[name] ?? "").trim();

export interface StripeKeyConfig {
  secretKey: string;
  /** Chave live ⇒ só eventos e preços live são aceitos. */
  livemode: boolean;
}

export const readStripeKeyConfig = (
  env: Env = process.env,
): StripeKeyConfig => {
  const secretKey = raw(env, STRIPE_SECRET_KEY);
  if (!SECRET_KEY_PATTERN.test(secretKey)) {
    throw new BillingConfigError([STRIPE_SECRET_KEY]);
  }
  return {secretKey, livemode: /^(sk|rk)_live_/.test(secretKey)};
};

export const readWebhookSecret = (env: Env = process.env): string => {
  const secret = raw(env, STRIPE_WEBHOOK_SECRET);
  if (!WEBHOOK_SECRET_PATTERN.test(secret)) {
    throw new BillingConfigError([STRIPE_WEBHOOK_SECRET]);
  }
  return secret;
};

export type PriceConfig = Readonly<Record<PaidPlanId, string>>;

/**
 * `planId → priceId` do ambiente. Cada plano pago precisa do próprio Price:
 * Pro e Business com o mesmo ID (C02) é configuração inválida.
 */
export const readPriceConfig = (env: Env = process.env): PriceConfig => {
  const invalid = PAID_PLAN_IDS
    .filter((planId) =>
      !PRICE_ID_PATTERN.test(raw(env, STRIPE_PRICE_SECRETS[planId])))
    .map((planId) => STRIPE_PRICE_SECRETS[planId]);
  if (invalid.length > 0) throw new BillingConfigError(invalid);
  const prices = Object.fromEntries(PAID_PLAN_IDS.map((planId) =>
    [planId, raw(env, STRIPE_PRICE_SECRETS[planId])])) as Record<
    PaidPlanId,
    string
  >;
  if (new Set(Object.values(prices)).size !== PAID_PLAN_IDS.length) {
    throw new BillingConfigError(PRICE_SECRETS);
  }
  return Object.freeze(prices);
};

/**
 * Plano de um Price do Stripe. Único caminho de concessão: preço fora da
 * configuração do ambiente não corresponde a plano nenhum.
 */
export const planIdForPrice = (
  priceId: string | null | undefined,
  prices: PriceConfig,
): PaidPlanId | null =>
  PAID_PLAN_IDS.find((planId) => prices[planId] === priceId) ?? null;

/**
 * Origens para as quais checkout e portal devolvem o usuário (INV-P2-038).
 * Sem allowlist, o retorno podia levar a vítima a um host do atacante com a
 * aparência de continuidade do fluxo de pagamento.
 */
export const allowedReturnOrigins = (env: Env = process.env): string[] =>
  (env[APP_ALLOWED_ORIGINS] ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter((entry) => entry.length > 0);

export const isAllowedReturnUrl = (
  returnUrl: string,
  allowedOrigins: readonly string[],
): boolean => {
  if (allowedOrigins.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(returnUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    return false;
  }
  // Comparação por origem completa, nunca por `startsWith` da URL inteira:
  // `https://app.exemplo.com.br.atacante.io` passaria num prefixo.
  return allowedOrigins.includes(parsed.origin);
};

/** Origens obrigatórias: lista vazia também é configuração ausente. */
export const readAllowedReturnOrigins = (env: Env = process.env): string[] => {
  const origins = allowedReturnOrigins(env);
  if (origins.length === 0) throw new BillingConfigError([APP_ALLOWED_ORIGINS]);
  return origins;
};

export const BILLING_UNAVAILABLE_MESSAGE =
  "Cobrança indisponível no momento. Tente novamente mais tarde.";

export const billingUnavailableError = (): ApplicationError =>
  new ApplicationError(
    "domain_precondition_failed",
    BILLING_UNAVAILABLE_MESSAGE,
  );

export const invalidReturnUrlError = (): ApplicationError =>
  new ApplicationError("invalid_payload", "Endereço de retorno inválido.");
