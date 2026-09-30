import type {OperationLogger} from "../shared/logger";
import {defineCallable} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {WORKSPACE_ROLES} from "../shared/workspaceAuth";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import {publicBillingCatalog} from "./catalog";
import {executeCreateCheckoutSession} from "./checkout";
import {
  BillingConfigError,
  CHECKOUT_SECRETS,
  PORTAL_SECRETS,
  billingUnavailableError,
  readAllowedReturnOrigins,
  readPriceConfig,
  readStripeKeyConfig,
} from "./config";
import {
  createBillingPortalSessionPayloadSchema,
  createCheckoutSessionPayloadSchema,
  getAccountUsagePayloadSchema,
  getBillingCatalogPayloadSchema,
  getWorkspaceEntitlementPayloadSchema,
} from "./contracts";
import {executeCreateBillingPortalSession} from "./portal";
import {createStripeGateway} from "./stripeGateway";
import {
  executeGetAccountUsage,
  executeGetWorkspaceEntitlement,
} from "./workspaceEntitlement";

/**
 * Callables de billing (P2A). Operações do **titular**, sem workspace: o
 * wrapper exige autenticação, política de token e conta ativa; o domínio
 * relê a conta dentro da própria transação.
 *
 * A configuração é lida a cada chamada e falha fechada com mensagem pt-BR;
 * o log registra só os **nomes** ausentes.
 */
const INTERNAL_MESSAGE =
  "Não foi possível consultar o plano agora. Tente novamente em instantes.";

const withBillingConfig = <T>(log: OperationLogger, read: () => T): T => {
  try {
    return read();
  } catch (error) {
    if (error instanceof BillingConfigError) {
      log.error("billing.config_missing", error, {
        names: error.names.join(","),
      });
      throw billingUnavailableError();
    }
    throw error;
  }
};

export const getBillingCatalog = defineCallable({
  operation: "getBillingCatalog",
  schema: getBillingCatalogPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  handler: async () => publicBillingCatalog(),
});

export const createCheckoutSession = defineCallable({
  operation: "createCheckoutSession",
  schema: createCheckoutSessionPayloadSchema,
  runtime: {...DOMAIN_CALLABLE_OPTIONS, secrets: [...CHECKOUT_SECRETS]},
  handler: async ({caller, payload, requestId, log}) => {
    const deps = withBillingConfig(log, () => {
      const key = readStripeKeyConfig();
      return {
        gateway: createStripeGateway(key.secretKey),
        prices: readPriceConfig(),
        livemode: key.livemode,
        allowedOrigins: readAllowedReturnOrigins(),
        now: () => Date.now(),
      };
    });
    return executeCreateCheckoutSession(deps, {
      caller,
      payload,
      requestId,
      log,
    });
  },
});

export const createBillingPortalSession = defineCallable({
  operation: "createBillingPortalSession",
  schema: createBillingPortalSessionPayloadSchema,
  runtime: {...DOMAIN_CALLABLE_OPTIONS, secrets: [...PORTAL_SECRETS]},
  handler: async ({caller, payload, log}) => {
    const deps = withBillingConfig(log, () => ({
      gateway: createStripeGateway(readStripeKeyConfig().secretKey),
      allowedOrigins: readAllowedReturnOrigins(),
    }));
    return executeCreateBillingPortalSession(deps, {caller, payload, log});
  },
});

/**
 * Entitlement do workspace pelo plano do owner (P2B.1, PR-BILL-07): qualquer
 * membro ativo, inclusive `viewer`. Somente leitura, sem segredo.
 */
export const getWorkspaceEntitlement = defineCallable({
  operation: "getWorkspaceEntitlement",
  schema: getWorkspaceEntitlementPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: WORKSPACE_ROLES,
  handler: async ({actor}) => {
    if (!actor) throw new ApplicationError("internal", INTERNAL_MESSAGE);
    return executeGetWorkspaceEntitlement(actor);
  },
});

/** Uso da própria conta (workspaces próprios ativos). Somente leitura. */
export const getAccountUsage = defineCallable({
  operation: "getAccountUsage",
  schema: getAccountUsagePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  handler: async ({caller}) => executeGetAccountUsage(caller.uid),
});
