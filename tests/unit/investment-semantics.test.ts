import assert from 'node:assert/strict';
import test from 'node:test';

import type {Transaction} from '../../src/types.ts';
import {
  contributionAllocationCents,
  goalInvestmentImpactCents,
  realizedInvestmentGainCents,
  summarizeLegacyCashFlow,
  transactionCashImpactCents,
} from '../../src/modules/investments/semantics.ts';

const movement = (
  investmentOperation: 'contribution' | 'redemption' | 'redemption_reversal',
  status: 'pending' | 'settled' | 'cancelled' | 'reversed',
  cashImpact: 'none' | 'inflow' | 'outflow',
  principalCents: number,
  valueCents: number,
): Transaction => ({
  id: `${investmentOperation}-${status}`,
  type: 'investimento',
  description: investmentOperation,
  category: 'CDB',
  value: valueCents / 100,
  valueCents,
  date: '2026-08-18',
  goalId: 'goal-a',
  isPaid: status === 'settled' || status === 'reversed',
  investmentMetadata: {
    currency: 'BRL',
    investmentOperation,
    cashImpact,
    investmentImpact: investmentOperation === 'redemption' ? 'decrease' : 'increase',
    principalCents,
    gainCents: investmentOperation === 'contribution' ? 0 : 2_000,
    feesCents: investmentOperation === 'contribution' ? 0 : 200,
    taxCents: investmentOperation === 'contribution' ? 0 : 300,
    settlementDate: '2026-08-18',
    status,
    sourceMovementId: 'source-a',
    idempotencyKey: `key-${investmentOperation}-${status}-0001`,
  },
});

test('pending não afeta caixa, meta ou alocação', () => {
  const pending = movement('redemption', 'pending', 'none', 10_000, 11_500);
  assert.equal(transactionCashImpactCents(pending), 0);
  assert.equal(goalInvestmentImpactCents(pending), 0);
  assert.equal(contributionAllocationCents(pending), 0);
  assert.equal(realizedInvestmentGainCents(pending), 0);
});

test('resgate liquidado entra no caixa, reduz meta pelo principal e não vira receita ou aporte', () => {
  const contribution = movement('contribution', 'settled', 'outflow', 100_000, 100_000);
  const redemption = movement('redemption', 'settled', 'inflow', 40_000, 43_500);
  const summary = summarizeLegacyCashFlow([contribution, redemption]);
  assert.equal(transactionCashImpactCents(redemption), 43_500);
  assert.equal(goalInvestmentImpactCents(redemption), -40_000);
  assert.equal(realizedInvestmentGainCents(redemption), 2_000);
  assert.equal(contributionAllocationCents(redemption), 0);
  assert.equal(summary.income, 0);
  assert.equal(summary.expenses, 0);
  assert.equal(summary.investments, 1_000);
  assert.equal(summary.balance, -565);
});

test('estorno compensa caixa e meta sem criar novo aporte de alocação', () => {
  const redemption = movement('redemption', 'reversed', 'inflow', 40_000, 43_500);
  const reversal = movement('redemption_reversal', 'settled', 'outflow', 40_000, 43_500);
  assert.equal(transactionCashImpactCents(redemption) + transactionCashImpactCents(reversal), 0);
  assert.equal(goalInvestmentImpactCents(redemption) + goalInvestmentImpactCents(reversal), 0);
  assert.equal(contributionAllocationCents(redemption) + contributionAllocationCents(reversal), 0);
  assert.equal(realizedInvestmentGainCents(redemption) + realizedInvestmentGainCents(reversal), 0);
});
