import * as admin from "firebase-admin";
import Stripe from "stripe";
import {z} from "zod";

import {defineCallable} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {reserveUserRateLimit} from "../shared/rateLimit";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import {
  assertActiveAccountSnapshot,
  userProfileRef,
} from "../shared/workspaceAuth";

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

/**
 * Checkout de assinatura: operação do **usuário**, sem workspace.
 *
 * Sem `workspaceRoles`, o wrapper do kernel exige autenticação, a política de
 * token e perfil `users/{uid}` ativo — conta suspensa não abre checkout.
 */
export const createCheckoutSession = defineCallable({
  operation: CHECKOUT_RATE_LIMIT.operation,
  schema: checkoutSchema,
  runtime: {
    ...DOMAIN_CALLABLE_OPTIONS,
    /*
     * As três precisam ser **declaradas**, não só existirem no projeto.
     *
     * `STRIPE_ALLOWED_PRICE_IDS` e `APP_ALLOWED_ORIGINS` eram lidas de
     * `process.env` sem constar aqui. O Cloud Functions só monta no ambiente
     * da função os segredos que a função declara, então provisioná-las (que é
     * o que o checklist de implantação manda fazer) não as tornava visíveis:
     * as duas listas chegariam vazias em produção, e o código falha fechado
     * quando estão vazias — nenhum preço seria aceito e nenhum `returnUrl`
     * seria válido. O checkout do plano pago ficaria inoperante, com
     * aparência de recusa deliberada.
     */
    secrets: [
      "STRIPE_SECRET_KEY",
      "STRIPE_ALLOWED_PRICE_IDS",
      "APP_ALLOWED_ORIGINS",
    ],
  },
  handler: async ({caller, payload}) => {
    const {priceId, returnUrl} = payload;

    const priceIds = allowedStripePriceIds();
    if (priceIds.length === 0) {
      console.error("billing_price_allowlist_missing");
      throw new ApplicationError(
        "domain_precondition_failed",
        "Cobrança indisponível no momento. Tente novamente mais tarde.",
      );
    }
    if (!priceIds.includes(priceId)) {
      throw new ApplicationError("invalid_payload", "Plano indisponível.");
    }

    if (!isAllowedReturnUrl(returnUrl, allowedReturnOrigins())) {
      throw new ApplicationError(
        "invalid_payload",
        "Endereço de retorno inválido.",
      );
    }

    // O limite vive sob o próprio usuário: checkout não tem workspace. O
    // perfil é relido na mesma transação: uma suspensão entre a pré-checagem
    // e o consumo do limite recusa o checkout.
    const actorId = caller.uid;
    await admin.firestore().runTransaction(async (transaction) => {
      assertActiveAccountSnapshot(
        await transaction.get(userProfileRef(actorId)),
      );
      const rateLimit = await reserveUserRateLimit(
        transaction,
        actorId,
        CHECKOUT_RATE_LIMIT,
      );
      rateLimit.commit();
    });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: caller.email ?? undefined,
      line_items: [{price: priceId, quantity: 1}],
      success_url: `${returnUrl}?billing=success`,
      cancel_url: `${returnUrl}?billing=canceled`,
      metadata: {userId: caller.uid, priceId},
    });

    return {url: session.url};
  },
});
