import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedReturnOrigins,
  allowedStripePriceIds,
  isAllowedReturnUrl,
} from "../billing";

// INV-P2-038 — `priceId` e `returnUrl` vinham do cliente sem validação
// nenhuma: o primeiro ia direto para `stripe.checkout.sessions.create` e o
// segundo virava `success_url`/`cancel_url`.

test("allowlist de preço é vazia quando não configurada — falha fechada", () => {
  const previous = process.env.STRIPE_ALLOWED_PRICE_IDS;
  delete process.env.STRIPE_ALLOWED_PRICE_IDS;
  try {
    assert.deepEqual(allowedStripePriceIds(), []);
  } finally {
    if (previous === undefined) delete process.env.STRIPE_ALLOWED_PRICE_IDS;
    else process.env.STRIPE_ALLOWED_PRICE_IDS = previous;
  }
});

test("allowlist de preço aceita lista separada por vírgula e ignora espaços", () => {
  const previous = process.env.STRIPE_ALLOWED_PRICE_IDS;
  process.env.STRIPE_ALLOWED_PRICE_IDS = " price_pro_mensal , price_pro_anual ,";
  try {
    assert.deepEqual(allowedStripePriceIds(), [
      "price_pro_mensal",
      "price_pro_anual",
    ]);
  } finally {
    if (previous === undefined) delete process.env.STRIPE_ALLOWED_PRICE_IDS;
    else process.env.STRIPE_ALLOWED_PRICE_IDS = previous;
  }
});

test("origens de retorno vêm da configuração e toleram barra final", () => {
  const previous = process.env.APP_ALLOWED_ORIGINS;
  process.env.APP_ALLOWED_ORIGINS = "https://app.exemplo.com.br/, https://exemplo.com.br";
  try {
    assert.deepEqual(allowedReturnOrigins(), [
      "https://app.exemplo.com.br",
      "https://exemplo.com.br",
    ]);
  } finally {
    if (previous === undefined) delete process.env.APP_ALLOWED_ORIGINS;
    else process.env.APP_ALLOWED_ORIGINS = previous;
  }
});

test("returnUrl é comparado por origem, nunca por prefixo", () => {
  const allowed = ["https://app.exemplo.com.br"];

  assert.equal(
    isAllowedReturnUrl("https://app.exemplo.com.br/billing", allowed),
    true,
  );

  // O caso que um `startsWith` deixaria passar.
  assert.equal(
    isAllowedReturnUrl("https://app.exemplo.com.br.atacante.io/", allowed),
    false,
  );
  assert.equal(
    isAllowedReturnUrl("https://atacante.io/app.exemplo.com.br", allowed),
    false,
  );
  assert.equal(isAllowedReturnUrl("http://app.exemplo.com.br", allowed), false);
  assert.equal(isAllowedReturnUrl("nao-e-url", allowed), false);
  assert.equal(
    isAllowedReturnUrl("javascript:alert(1)", allowed),
    false,
  );
});

test("sem origens configuradas, nenhum returnUrl é aceito", () => {
  assert.equal(isAllowedReturnUrl("https://app.exemplo.com.br", []), false);
});

test("localhost é aceito apenas quando explicitamente configurado", () => {
  assert.equal(
    isAllowedReturnUrl("http://localhost:5173", ["http://localhost:5173"]),
    true,
  );
  assert.equal(
    isAllowedReturnUrl("http://localhost:5173", ["https://app.exemplo.com.br"]),
    false,
  );
});
