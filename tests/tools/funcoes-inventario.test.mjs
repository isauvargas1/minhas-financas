import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {inventarioDasFuncoes, onlyComFuncoes, planoDasFuncoes} from '../../tools/deploy/funcoes.mjs';

/**
 * P6-A: composição da primeira publicação das Functions contra o build real (`functions/lib`, compilado antes no
 * verify:fast). Prova quais funções dependem de segredo e que, sem nenhum segredo registrado (o estado do primeiro
 * deploy), a IA e o Stripe ficam de fora e o resto, inclusive o bootstrap com o gate do piloto, é publicado.
 */
const inventario = inventarioDasFuncoes();
const comSegredo = Object.fromEntries(inventario.filter((f) => f.segredos.length > 0).map((f) => [f.nome, f.segredos]));

test('só a IA e o Stripe declaram segredo, com os nomes esperados', () => {
  assert.deepEqual(comSegredo, {
    analyzeFinancialQuestion: ['GOOGLE_AI_API_KEY'],
    createBillingPortalSession: ['APP_ALLOWED_ORIGINS', 'STRIPE_SECRET_KEY'],
    createCheckoutSession: ['APP_ALLOWED_ORIGINS', 'STRIPE_PRICE_BUSINESS_MONTHLY', 'STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_SECRET_KEY'],
    extractTransactionFromContent: ['GOOGLE_AI_API_KEY'],
    stripeWebhook: ['STRIPE_PRICE_BUSINESS_MONTHLY', 'STRIPE_PRICE_PRO_MONTHLY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  });
});

test('sem segredo registrado: as 5 ficam de fora, o resto vai, e o bootstrap do piloto está incluído', () => {
  const plano = planoDasFuncoes(inventario, []);
  assert.deepEqual(plano.excluidas.map((f) => f.nome).sort(), Object.keys(comSegredo).sort());
  assert.equal(plano.incluidas.length, inventario.length - 5);
  for (const essencial of ['bootstrapAccount', 'getWorkspaceEntitlement', 'getFinancialReport']) {
    assert.ok(plano.incluidas.includes(essencial), essencial);
  }
  const {only} = onlyComFuncoes({onlyBase: 'functions', funcoes: 'todas', plano});
  assert.ok(!/analyzeFinancialQuestion|extractTransactionFromContent|stripeWebhook|createCheckoutSession|createBillingPortalSession/.test(only));
  assert.equal(only.split(',').length, plano.incluidas.length);
});

test('todo segredo declarado está documentado no FIREBASE_PRODUCTION.md (§8)', () => {
  const doc = readFileSync(new URL('../../docs/production/FIREBASE_PRODUCTION.md', import.meta.url), 'utf8');
  for (const nome of new Set(Object.values(comSegredo).flat())) assert.ok(doc.includes(`\`${nome}\``), nome);
});
