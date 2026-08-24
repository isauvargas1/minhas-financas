import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import Stripe from "stripe";
import {z} from "zod";

import {consumeUserRateLimit} from "../shared/rateLimit";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";

const stripeKey = process.env.STRIPE_SECRET_KEY || "sk_test_placeholder";
const stripe = new Stripe(stripeKey, {
  apiVersion: "2026-02-25.clover",
});

const checkoutSchema = z.object({
  priceId: z.string().min(1).max(255),
  returnUrl: z.string().min(1).max(2048),
}).strict();

/**
 * Preços aceitos no checkout (INV-P2-038).
 *
 * Sem allowlist, `priceId` vinha do cliente e ia direto para
 * `stripe.checkout.sessions.create`: qualquer preço da conta Stripe — de
 * teste, descontinuado, de centavos — podia ser cobrado e, como o webhook
 * concedia `pro` para **qualquer** `checkout.session.completed`, o plano pago
 * saía por qualquer valor.
 *
 * Configurado por variável de ambiente porque o ID muda entre projeto de
 * teste e de produção. Ausente ⇒ falha fechada com mensagem em pt-BR.
 */
export const allowedStripePriceIds = (): string[] =>
  (process.env.STRIPE_ALLOWED_PRICE_IDS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

/**
 * Origens para as quais o checkout pode devolver o usuário (INV-P2-038).
 *
 * `returnUrl` ia sem validação para `success_url`/`cancel_url`: um atacante
 * fazia a vítima concluir um checkout legítimo e ser redirecionada para um
 * host controlado por ele, com a aparência de continuidade do fluxo de
 * pagamento.
 */
export const allowedReturnOrigins = (): string[] =>
  (process.env.APP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter((entry) => entry.length > 0);

export const isAllowedReturnUrl = (
  returnUrl: string,
  allowedOrigins: string[],
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

const CHECKOUT_RATE_LIMIT = {
  operation: "createCheckoutSession",
  limit: 10,
  windowSeconds: 60 * 60,
};

export const createCheckoutSession = onCall({
  ...DOMAIN_CALLABLE_OPTIONS,
  secrets: ["STRIPE_SECRET_KEY"],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sessão não iniciada");
  }

  const parsed = checkoutSchema.safeParse(request.data);
  if (!parsed.success) {
    throw new HttpsError(
      "invalid-argument",
      "Dados de checkout inválidos.",
    );
  }
  const {priceId, returnUrl} = parsed.data;

  const priceIds = allowedStripePriceIds();
  if (priceIds.length === 0) {
    console.error("billing_price_allowlist_missing");
    throw new HttpsError(
      "failed-precondition",
      "Cobrança indisponível no momento. Tente novamente mais tarde.",
    );
  }
  if (!priceIds.includes(priceId)) {
    throw new HttpsError("invalid-argument", "Plano indisponível.");
  }

  if (!isAllowedReturnUrl(returnUrl, allowedReturnOrigins())) {
    throw new HttpsError("invalid-argument", "Endereço de retorno inválido.");
  }

  // O limite vive sob o próprio usuário: checkout não tem workspace.
  const actorId = request.auth.uid;
  await admin.firestore().runTransaction(async (transaction) => {
    const rateLimit = await consumeUserRateLimit(
      transaction,
      actorId,
      CHECKOUT_RATE_LIMIT,
    );
    rateLimit.commit();
  });

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "subscription",
    customer_email: request.auth.token.email,
    line_items: [{price: priceId, quantity: 1}],
    success_url: `${returnUrl}?billing=success`,
    cancel_url: `${returnUrl}?billing=canceled`,
    metadata: {userId: request.auth.uid, priceId},
  });

  return {url: session.url};
});
