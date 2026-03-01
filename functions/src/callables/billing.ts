import {onCall, HttpsError} from "firebase-functions/v2/https";
import Stripe from "stripe";

const stripeKey = process.env.STRIPE_SECRET_KEY || "sk_test_placeholder";
const stripe = new Stripe(stripeKey, {
  apiVersion: "2026-02-25.clover" as any,
});

export const createCheckoutSession = onCall({
  secrets: ["STRIPE_SECRET_KEY"],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login necessário");
  }

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
    success_url: "https://seu-app.com/billing?success=true",
    cancel_url: "https://seu-app.com/billing?canceled=true",
    metadata: {userId: request.auth.uid},
  });

  return {url: session.url};
});
