import assert from 'node:assert/strict';
import test from 'node:test';

import type { Transaction } from '../../src/types.ts';
import { normalizeTransactionData } from '../../src/modules/transactions/contract.ts';
import { transactionAmount } from '../../src/modules/transactions/amount.ts';
import { saoPauloMonthsAgo } from '../../src/modules/transactions/cashEntry.ts';
import {
  isUnsettledEntry,
  transactionCashImpactCents,
} from '../../src/modules/investments/semantics.ts';

/*
 * P5-C2 — contrato do documento `transactions` no cliente: só `valueCents`
 * inteiro e `date` civil; documento fora do contrato é excluído (nunca vira
 * R$ 0,00) e não há leitura de `value`, `transactionDate` ou `parcelado`.
 */

const valid = (overrides: Record<string, unknown> = {}) => ({
  type: 'despesa',
  description: 'Mercado',
  category: 'Alimentação',
  valueCents: 4_550,
  date: '2026-10-05',
  isPaid: true,
  ...overrides,
});

test('documento no contrato vira transação com os campos conhecidos', () => {
  const tx = normalizeTransactionData('t1', valid(), 'ws-1');
  assert.ok(tx);
  assert.equal(tx.id, 't1');
  assert.equal(tx.valueCents, 4_550);
  assert.equal(tx.date, '2026-10-05');
  assert.equal(tx.type, 'despesa');
  assert.equal(tx.workspaceId, 'ws-1');
  assert.equal(normalizeTransactionData('t2', valid({ valueCents: 0 }))?.valueCents, 0);
  assert.equal(normalizeTransactionData('t3', valid({ type: 'receita' }))?.type, 'receita');
  const investment = valid({
    type: 'investimento', valueCents: 70_000,
    investmentEntry: { status: 'settled', operation: 'contribution', amountCents: 70_000 },
  });
  assert.equal(normalizeTransactionData('t4', investment)?.type, 'investimento');
});

test('tipo coerente com a marca e valor no teto, como no backend: senão excluído', () => {
  // `investimento` sem a marca, ou com valor diferente do da marca.
  assert.equal(normalizeTransactionData('a', valid({ type: 'investimento' })), null);
  assert.equal(normalizeTransactionData('b', valid({
    type: 'investimento', valueCents: 70_001,
    investmentEntry: { status: 'settled', amountCents: 70_000 },
  })), null);
  // Marca de investimento em receita/despesa.
  assert.equal(normalizeTransactionData('c', valid({
    investmentEntry: { status: 'settled', amountCents: 4_550 },
  })), null);
  // `investimento` com marca de outro domínio.
  assert.equal(normalizeTransactionData('d', valid({
    type: 'investimento', valueCents: 70_000, loanEntry: {},
    investmentEntry: { status: 'settled', amountCents: 70_000 },
  })), null);
  // Receita e despesa até o teto da entrada de caixa (R$ 1 bilhão).
  assert.equal(normalizeTransactionData('e', valid({ valueCents: 100_000_000_000 }))?.valueCents,
    100_000_000_000);
  assert.equal(normalizeTransactionData('f', valid({ valueCents: 100_000_000_001 })), null);
  // Espelhos de empréstimo, fatura, recebível e divisão seguem como receita/despesa.
  for (const marker of ['loanEntry', 'creditCardPaymentEntry', 'receivableEntry', 'splitEntry']) {
    assert.ok(normalizeTransactionData('g', valid({ [marker]: {} })), marker);
  }
});

test('valueCents ausente, float, negativo, texto ou não seguro: excluído', () => {
  const data = valid();
  delete (data as Record<string, unknown>).valueCents;
  assert.equal(normalizeTransactionData('a', data), null);
  for (const bad of [45.5, -1, NaN, Infinity, '4550', null, 2 ** 53]) {
    assert.equal(normalizeTransactionData('b', valid({ valueCents: bad })), null, String(bad));
  }
});

test('value em reais não substitui valueCents ausente', () => {
  const data = valid({ value: 45.5 });
  delete (data as Record<string, unknown>).valueCents;
  assert.equal(normalizeTransactionData('a', data), null);
});

test('date inválida ou ausente: excluído; transactionDate não é fallback', () => {
  for (const bad of ['2026-02-30', '2026-13-01', '05/10/2026', '2026-10-05T10:00:00Z', '', null, 20261005]) {
    assert.equal(normalizeTransactionData('a', valid({ date: bad })), null, String(bad));
  }
  const data = valid({ transactionDate: '2026-10-05' });
  delete (data as Record<string, unknown>).date;
  assert.equal(normalizeTransactionData('a', data), null);
});

test('type fora de receita/despesa/investimento (inclusive parcelado): excluído', () => {
  for (const bad of ['parcelado', 'transferencia', '', undefined, 1]) {
    assert.equal(normalizeTransactionData('a', valid({ type: bad })), null, String(bad));
  }
});

test('campos legados do documento não chegam à transação', () => {
  const tx = normalizeTransactionData('a', valid({
    value: 999, transactionDate: '2020-01-01', installments: 3, currentInstallment: 1,
  }));
  assert.ok(tx);
  assert.equal(tx.valueCents, 4_550);
  assert.equal(tx.date, '2026-10-05');
  for (const legacy of ['value', 'transactionDate', 'installments', 'currentInstallment']) {
    assert.equal(legacy in tx, false, legacy);
  }
});

test('helper de apresentação deriva reais de valueCents', () => {
  assert.equal(transactionAmount({ valueCents: 4_550 }), 45.5);
  assert.equal(transactionAmount({ valueCents: 0 }), 0);
  assert.equal(transactionAmount({ valueCents: 100_005 }), 1000.05);
});

test('impacto de caixa vem só de valueCents, sem fallback em reais', () => {
  const tx = (overrides: Partial<Transaction>): Transaction => ({
    id: 'x', type: 'despesa', description: 'd', category: 'c',
    valueCents: 12_345, date: '2026-10-01', isPaid: true, ...overrides,
  });
  assert.equal(transactionCashImpactCents(tx({})), -12_345);
  assert.equal(transactionCashImpactCents(tx({ type: 'receita' })), 12_345);
  assert.equal(transactionCashImpactCents(tx({ isPaid: false })), 0);
  assert.equal(transactionCashImpactCents(tx({ type: 'receita', isPaid: false })), 0);
  // `value` legado (reais) é ignorado mesmo se presente em objeto fora do tipo.
  const withLegacyValue = { ...tx({}), value: 999 } as Transaction;
  assert.equal(transactionCashImpactCents(withLegacyValue), -12_345);
  // `parcelado` não é transação persistida: sem ramo de caixa próprio.
  const parcelado = { ...tx({}), type: 'parcelado' } as unknown as Transaction;
  assert.equal(transactionCashImpactCents(parcelado), 0);
  assert.equal(isUnsettledEntry({ ...parcelado, isPaid: false }), false);
});

test('início da janela é o dia civil de São Paulo, sem deslocamento UTC', () => {
  // 23h30 de 10/10 em Brasília já é 11/10 em UTC.
  const lateNight = new Date('2026-10-11T02:30:00.000Z');
  assert.equal(saoPauloMonthsAgo(12, lateNight), '2025-10-10');
  assert.equal(saoPauloMonthsAgo(0, lateNight), '2026-10-10');
  // Dia limitado ao fim do mês e virada de ano.
  assert.equal(saoPauloMonthsAgo(1, new Date('2026-03-31T15:00:00.000Z')), '2026-02-28');
  assert.equal(saoPauloMonthsAgo(1, new Date('2026-01-15T15:00:00.000Z')), '2025-12-15');
  assert.equal(saoPauloMonthsAgo(1, new Date('2024-03-31T15:00:00.000Z')), '2024-02-29');
});
