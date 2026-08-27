import {onRequest} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import Stripe from "stripe";

import {allowedStripePriceIds} from "../callables/billing";
import {FUNCTIONS_REGION} from "../shared/runtimeOptions";

const stripeKey = process.env.STRIPE_SECRET_KEY || "sk_test_placeholder";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "whsec_placeholder";

const stripe = new Stripe(stripeKey, {
  apiVersion: "2026-02-25.clover",
});

/**
 * Preços presentes na sessão paga.
 *
 * A sessão em si não traz os itens: é preciso expandi-los. Sem isso o webhook
 * concedia `pro` para **qualquer** `checkout.session.completed`, sem conferir
 * o que foi pago (INV-P2-038).
 */
const paidPriceIds = async (sessionId: string): Promise<string[]> => {
  const lineItems = await stripe.checkout.sessions.listLineItems(sessionId, {
    limit: 100,
  });
  return lineItems.data
    .map((item) => item.price?.id)
    .filter((id): id is string => typeof id === "string");
};

export const stripeWebhook = onRequest({
  region: FUNCTIONS_REGION,
  // O webhook também consulta a allowlist de preço antes de conceder o plano
  // (`stripe.ts:75`), então precisa declará-la para que ela seja montada.
  secrets: [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_ALLOWED_PRICE_IDS",
  ],
  cors: true,
}, async (req, res) => {
  const sig = req.headers["stripe-signature"];

  if (!sig) {
    res.status(400).send("No signature found");
    return;
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
  } catch (err) {
    const error = err as Error;
    console.error(`Webhook Error: ${error.message}`);
    res.status(400).send(`Webhook Error: ${error.message}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.userId;

    if (!userId) {
      console.error("stripe_webhook_session_without_user", {
        sessionId: session.id,
      });
      res.json({received: true});
      return;
    }

    if (session.payment_status !== "paid") {
      console.warn("stripe_webhook_session_not_paid", {
        sessionId: session.id,
        paymentStatus: session.payment_status,
      });
      res.json({received: true});
      return;
    }

    const allowed = allowedStripePriceIds();
    const paidPrices = await paidPriceIds(session.id);
    const grantsPro =
      allowed.length > 0 && paidPrices.some((id) => allowed.includes(id));

    if (!grantsPro) {
      console.error("stripe_webhook_price_not_entitled", {
        sessionId: session.id,
        allowlistConfigured: allowed.length > 0,
      });
      res.json({received: true});
      return;
    }

    // `users/{uid}` é server-owned nestes campos: as Rules negam a escrita do
    // cliente (INV-P1-013) e o Admin SDK aqui é a única fonte de entitlement.
    await admin.firestore().collection("users").doc(userId).set({
      planId: "pro",
      isPro: true,
      stripeCustomerId:
        typeof session.customer === "string" ? session.customer : null,
      stripeSubscriptionId:
        typeof session.subscription === "string" ? session.subscription : null,
      stripePriceId: paidPrices[0] ?? null,
      subscriptionStatus: "active",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  }

  res.json({received: true});
});
