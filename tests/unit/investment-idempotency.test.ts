import assert from 'node:assert/strict';
import test from 'node:test';

import {
  intentDigest,
  investmentIdempotencyKey,
  newIntentNonce,
} from '../../src/modules/investments/persistence/intent.ts';

// INV-P1-004 — o gerador anterior chamava `crypto.randomUUID()` dentro do
// `mutationFn`: chave nova por invocação. Retry e duplo clique viravam
// operações novas, e toda a idempotência do backend ficava inalcançável.

const aporte = {
  workspaceId: 'ws-1',
  accountId: 'acc-1',
  assetId: 'ast-1',
  description: 'Aporte mensal',
  principalCents: 100_000,
  quantityMicros: 1_000_000,
  feesCents: 0,
  taxCents: 0,
  occurredAt: '2026-08-24T12:00:00.000Z',
};

test('duplo clique no mesmo formulário produz uma única chave', () => {
  const nonce = newIntentNonce();
  const primeiro = investmentIdempotencyKey('createInvestmentContribution', nonce, aporte);
  const segundo = investmentIdempotencyKey('createInvestmentContribution', nonce, aporte);
  assert.equal(primeiro, segundo);
});

test('retry de rede e timeout mantêm a chave, porque nada volátil entra nela', () => {
  const nonce = newIntentNonce();
  const tentativas = Array.from({length: 5}, () =>
    investmentIdempotencyKey('createInvestmentContribution', nonce, aporte));
  assert.equal(new Set(tentativas).size, 1);
});

test('ordem das chaves do payload não altera a identidade da intenção', () => {
  const nonce = newIntentNonce();
  const reordenado = {
    occurredAt: aporte.occurredAt,
    taxCents: aporte.taxCents,
    feesCents: aporte.feesCents,
    quantityMicros: aporte.quantityMicros,
    principalCents: aporte.principalCents,
    description: aporte.description,
    assetId: aporte.assetId,
    accountId: aporte.accountId,
    workspaceId: aporte.workspaceId,
  };
  assert.equal(
    investmentIdempotencyKey('createInvestmentContribution', nonce, aporte),
    investmentIdempotencyKey('createInvestmentContribution', nonce, reordenado),
  );
});

test('corrigir um valor depois de um erro é intenção nova, não conflito', () => {
  // Mesma chave com payload diferente faria o backend responder
  // `idempotency_conflict`: a correção precisa gerar chave nova.
  const nonce = newIntentNonce();
  assert.notEqual(
    investmentIdempotencyKey('createInvestmentContribution', nonce, aporte),
    investmentIdempotencyKey('createInvestmentContribution', nonce, {
      ...aporte,
      principalCents: 150_000,
    }),
  );
});

test('fechar e reabrir o formulário permite repetir um aporte idêntico', () => {
  // Dois aportes deliberadamente iguais no mesmo dia continuam possíveis: o
  // nonce é mintado na abertura do formulário.
  assert.notEqual(
    investmentIdempotencyKey('createInvestmentContribution', newIntentNonce(), aporte),
    investmentIdempotencyKey('createInvestmentContribution', newIntentNonce(), aporte),
  );
});

test('a mesma intenção em operações diferentes tem chaves diferentes', () => {
  const nonce = newIntentNonce();
  assert.notEqual(
    investmentIdempotencyKey('createInvestmentContribution', nonce, aporte),
    investmentIdempotencyKey('createInvestmentRedemption', nonce, aporte),
  );
});

test('a chave carrega operação e nonce em texto legível, para diagnóstico', () => {
  const key = investmentIdempotencyKey('settleInvestmentRedemption', 'nonce123', aporte);
  assert.match(key, /^investment-ui:settleInvestmentRedemption:nonce123:[a-z0-9]+$/);
});

test('digest distingue valores próximos e campos ausentes de campos zerados', () => {
  assert.notEqual(intentDigest({principalCents: 100_000}), intentDigest({principalCents: 100_001}));
  assert.notEqual(intentDigest({feesCents: 0}), intentDigest({}));
  assert.equal(intentDigest({a: undefined, b: 1}), intentDigest({b: 1}));
});

test('nonce é único a cada abertura', () => {
  const nonces = new Set(Array.from({length: 1000}, () => newIntentNonce()));
  assert.equal(nonces.size, 1000);
});
