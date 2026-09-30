import assert from "node:assert/strict";
import test from "node:test";

import Stripe from "stripe";

import {
  MAX_SUBSCRIPTIONS_PER_CUSTOMER,
  createStripeGateway,
} from "../stripeGateway";
import {testBillingEnv} from "../testSupport/fakeStripe";

/**
 * Gateway real do Stripe (SDK) com um `fetch` falso: exercita a paginação da
 * listagem de assinaturas sem rede e sem credenciais (P2A.1).
 */
const CUSTOMER = "cus_paginado";

const subscriptionJson = (index: number) => ({
  id: `sub_${index}`,
  object: "subscription",
  customer: CUSTOMER,
  status: "canceled",
  created: 1_700_000_000 - index,
  metadata: {},
  items: {
    object: "list",
    data: [{
      id: `si_${index}`,
      object: "subscription_item",
      price: {id: "price_paginado", object: "price"},
      quantity: 1,
      current_period_end: 1_700_086_400 - index,
    }],
  },
  cancel_at_period_end: false,
  cancel_at: null,
  latest_invoice: null,
  livemode: false,
});

/** API de listagem paginada (mais recentes primeiro), como a do Stripe. */
const pagedStripeApi = (total: number) => {
  const requests: URL[] = [];
  const fetchFn = async (input: string | URL): Promise<Response> => {
    const url = new URL(String(input));
    requests.push(url);
    const after = url.searchParams.get("starting_after");
    const start = after === null ? 0 : Number(after.slice("sub_".length)) + 1;
    const end = Math.min(start + Number(url.searchParams.get("limit")), total);
    const data = Array.from({length: end - start},
      (_, offset) => subscriptionJson(start + offset));
    return new Response(JSON.stringify({
      object: "list",
      url: "/v1/subscriptions",
      has_more: end < total,
      data,
    }), {status: 200, headers: {"Content-Type": "application/json"}});
  };
  const gateway = createStripeGateway(testBillingEnv().STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(fetchFn),
  });
  return {gateway, requests};
};

test("listSubscriptions lê todas as páginas com os mesmos " +
  "parâmetros", async () => {
  const {gateway, requests} = pagedStripeApi(250);
  const subscriptions = await gateway.listSubscriptions(CUSTOMER);
  assert.equal(subscriptions.length, 250);
  assert.deepEqual(subscriptions.map((entry) => entry.id).slice(98, 102),
    ["sub_98", "sub_99", "sub_100", "sub_101"]);
  assert.equal(requests.length, 3);
  for (const url of requests) {
    assert.equal(url.pathname, "/v1/subscriptions");
    assert.equal(url.searchParams.get("customer"), CUSTOMER);
    assert.equal(url.searchParams.get("status"), "all");
    assert.equal(url.searchParams.get("limit"), "100");
    assert.equal(url.searchParams.get("expand[0]"), "data.latest_invoice");
  }
  assert.deepEqual(
    requests.map((url) => url.searchParams.get("starting_after")),
    [null, "sub_99", "sub_199"]);
});

test("listSubscriptions acima do teto falha fechada em vez de " +
  "truncar", async () => {
  const {gateway, requests} = pagedStripeApi(
    MAX_SUBSCRIPTIONS_PER_CUSTOMER + 200);
  await assert.rejects(gateway.listSubscriptions(CUSTOMER), /teto de leitura/);
  // Para de paginar ao passar do teto.
  assert.equal(requests.length,
    Math.ceil((MAX_SUBSCRIPTIONS_PER_CUSTOMER + 1) / 100));
});
