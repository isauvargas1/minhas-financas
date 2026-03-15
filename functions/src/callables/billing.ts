import {onCall, HttpsError} from "firebase-functions/v2/https";
import Stripe from "stripe";

const stripeKey = process.env.STRIPE_SECRET_KEY || "sk_test_placeholder";
const stripe = new Stripe(stripeKey, {
  apiVersion: "2026-02-25.clover",
});

export const createCheckoutSession = onCall({
  secrets: ["STRIPE_SECRET_KEY"],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sessão não iniciada");
  }

  // Recebe o URL da aplicação (ou usa um fallback)
  const returnUrl = request.data.returnUrl || "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    mode: "subscription",
    customer_email: request.auth.token.email,
    line_items: [
      {
        price: request.data.priceId,
        quantity: 1,
      },
    ],
    // Agora usa o URL dinâmico!
    success_url: `${returnUrl}?billing=success`,
    cancel_url: `${returnUrl}?billing=canceled`,
    metadata: {userId: request.auth.uid},
  });

  return {url: session.url};
});
