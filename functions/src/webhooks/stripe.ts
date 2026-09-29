import {randomUUID} from "node:crypto";
import {onRequest} from "firebase-functions/v2/https";

import {
  BillingConfigError,
  WEBHOOK_SECRETS,
  readPriceConfig,
  readStripeKeyConfig,
  readWebhookSecret,
} from "../billing/config";
import {createStripeGateway} from "../billing/stripeGateway";
import {processStripeWebhook} from "../billing/webhook";
import {createOperationLogger, traceFieldFromHeader} from "../shared/logger";
import {STRIPE_WEBHOOK_OPTIONS} from "../shared/runtimeOptions";

const headerOf = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * Endpoint do webhook do Stripe (P2A). Chamado só pelo Stripe: sem CORS e
 * autenticado pela assinatura sobre o raw body (`billing/webhook.ts`).
 *
 * Configuração ausente ou inválida responde 500 sem processar nada — nunca
 * há segredo padrão. O Stripe reentrega depois que o segredo for corrigido.
 */
export const stripeWebhook = onRequest({
  ...STRIPE_WEBHOOK_OPTIONS,
  secrets: [...WEBHOOK_SECRETS],
}, async (req, res) => {
  const log = createOperationLogger({
    operation: "stripeWebhook",
    requestId: randomUUID(),
    actorId: null,
    workspaceId: null,
    actorRole: null,
    ...traceFieldFromHeader(headerOf(req.headers["x-cloud-trace-context"])),
  });
  let config;
  try {
    const key = readStripeKeyConfig();
    config = {
      key,
      webhookSecret: readWebhookSecret(),
      prices: readPriceConfig(),
    };
  } catch (error) {
    if (!(error instanceof BillingConfigError)) throw error;
    log.error("billing.config_missing", error, {names: error.names.join(",")});
    res.status(500).json({error: "Configuração de cobrança indisponível."});
    return;
  }
  const response = await processStripeWebhook({
    gateway: createStripeGateway(config.key.secretKey),
    webhookSecret: config.webhookSecret,
    prices: config.prices,
    livemode: config.key.livemode,
    now: () => Date.now(),
    log,
  }, {
    method: req.method,
    rawBody: req.rawBody,
    signature: headerOf(req.headers["stripe-signature"]),
  });
  res.status(response.status).json(response.body);
});
