import assert from 'node:assert/strict';
import test from 'node:test';

import type {Transaction, TransactionInvestmentEntry} from '../../src/types.ts';
import {
  investmentCashEffectOf,
  investmentEntryOf,
  investmentOutflowCentsOf,
  isInvestmentRedemption,
  summarizeCashFlow,
  transactionCashImpactCents,
} from '../../src/modules/investments/semantics.ts';
import {
  investmentMonthKey,
  monthContributionCents,
} from '../../src/modules/investments/dashboard.ts';

/*
 * Espelho de caixa de investimento (D-15, P4-D): a marca backend-only
 * `investmentEntry` decide o efeito, com a mesma regra do backend
 * (`functions/src/investments/cashEffect.ts`). Patrimônio e meta não são
 * lidos daqui.
 */

const entry = (
  overrides: Partial<TransactionInvestmentEntry> = {},
): TransactionInvestmentEntry => ({
  domainVersion: 1,
  movementId: 'mov-1',
  operation: 'contribution',
  reversal: false,
  reversalOf: null,
  status: 'settled',
  principalCents: 100_000,
  gainCents: 0,
  amountCents: 100_000,
  currency: 'BRL',
  ...overrides,
});

const mirror = (
  investmentEntry: unknown,
  extra: Partial<Transaction> = {},
): Transaction => ({
  id: `investment_${Math.random().toString(36).slice(2)}`,
  type: 'investimento',
  description: 'CDB',
  category: 'Investimentos',
  value: 1_000,
  valueCents: 100_000,
  date: '2026-08-18',
  isPaid: true,
  investmentEntry: investmentEntry as TransactionInvestmentEntry,
  ...extra,
});

const redemption = entry({
  operation: 'redemption', principalCents: 40_000, gainCents: 3_500, amountCents: 43_500,
});

test('pendente e cancelado não movem caixa', () => {
  for (const status of ['pending', 'cancelled'] as const) {
    for (const base of [entry(), redemption]) {
      const transaction = mirror({ ...base, status }, { isPaid: false });
      assert.equal(transactionCashImpactCents(transaction), 0);
      assert.equal(investmentOutflowCentsOf(transaction), 0);
      assert.deepEqual(investmentCashEffectOf(transaction), {
        investmentOutflowCents: 0, investmentInflowCents: 0,
        financialIncomeCents: 0, netCents: 0,
      });
    }
  }
});

test('aporte liquidado sai do caixa como investimento, sem virar despesa', () => {
  const contribution = mirror(entry());
  assert.equal(transactionCashImpactCents(contribution), -100_000);
  assert.equal(investmentOutflowCentsOf(contribution), 100_000);
  const summary = summarizeCashFlow([contribution]);
  assert.equal(summary.income, 0);
  assert.equal(summary.expenses, 0);
  assert.equal(summary.balance, -1_000);
});

test('retirada recebida volta ao caixa: principal e rendimento, nunca receita operacional', () => {
  const transaction = mirror(redemption, { value: 435, valueCents: 43_500 });
  assert.deepEqual(investmentCashEffectOf(transaction), {
    investmentOutflowCents: 0,
    investmentInflowCents: 40_000,
    financialIncomeCents: 3_500,
    netCents: 43_500,
  });
  assert.equal(isInvestmentRedemption(transaction), true);
  assert.equal(investmentOutflowCentsOf(transaction), 0);
  const summary = summarizeCashFlow([mirror(entry()), transaction]);
  assert.equal(summary.income, 0);
  assert.equal(summary.expenses, 0);
  // −1.000 do aporte + 435 da retirada.
  assert.equal(summary.balance, -565);
});

test('estorno compensa o efeito do original, nos dois sentidos', () => {
  for (const original of [entry(), redemption]) {
    const reversal = mirror({ ...original, movementId: 'mov-2', reversal: true, reversalOf: 'mov-1' });
    const fact = mirror(original);
    assert.equal(transactionCashImpactCents(fact) + transactionCashImpactCents(reversal), 0);
    assert.equal(investmentOutflowCentsOf(fact) + investmentOutflowCentsOf(reversal), 0);
    const a = investmentCashEffectOf(fact);
    const b = investmentCashEffectOf(reversal);
    assert.equal(a.investmentInflowCents + b.investmentInflowCents, 0);
    assert.equal(a.financialIncomeCents + b.financialIncomeCents, 0);
    // O estorno de uma retirada não é uma nova retirada.
    assert.equal(isInvestmentRedemption(reversal), false);
  }
});

test('PR-INV-01 — investimento sem marca válida está fora do contrato e não tem efeito', () => {
  const forged: Transaction[] = [
    // Só o tipo e `value`: antes contava como aporte pelo valor de apresentação.
    mirror(undefined),
    // Metadado do modelo anterior: não é lido.
    {
      ...mirror(undefined),
      investmentMetadata: { status: 'settled', cashImpact: 'outflow', investmentOperation: 'contribution' },
    } as unknown as Transaction,
    mirror({}),
    mirror({ ...entry(), domainVersion: 2 }),
    mirror({ ...entry(), amountCents: 100_001 }),
    mirror({ ...entry(), gainCents: 1, amountCents: 100_001 }),
    mirror({ ...entry(), amountCents: 0, principalCents: 0 }),
    mirror({ ...entry(), reversal: true, reversalOf: null }),
    mirror({ ...entry(), reversal: true, reversalOf: 'mov-0', status: 'pending' }),
    mirror({ ...entry(), principalCents: 10.5, amountCents: 10.5 }),
    mirror({ ...entry(), currency: 'USD' }),
  ];
  for (const transaction of forged) {
    assert.equal(investmentEntryOf(transaction), null, JSON.stringify(transaction.investmentEntry));
    assert.equal(transactionCashImpactCents(transaction), 0);
    assert.equal(investmentOutflowCentsOf(transaction), 0);
  }
  const summary = summarizeCashFlow(forged);
  assert.deepEqual(summary, { income: 0, expenses: 0, balance: 0 });
  // A marca só vale no tipo `investimento`.
  assert.equal(investmentEntryOf({ ...mirror(entry()), type: 'despesa' }), null);
});

test('card do dashboard — aporte do mês vem da projeção mensal do domínio', () => {
  assert.equal(investmentMonthKey(new Date(2026, 0, 31)), '2026-01');
  assert.equal(investmentMonthKey(new Date(2026, 9, 1)), '2026-10');
  assert.equal(investmentMonthKey(new Date(2026, 11, 15)), '2026-12');
  assert.equal(monthContributionCents({ contributionCents: 150_000 }), 150_000);
  // Estorno desconta no mês do estorno: a projeção pode zerar.
  assert.equal(monthContributionCents({ contributionCents: 0 }), 0);
  // Estorno em mês sem aporte: o líquido oficial é negativo e é o exibido.
  assert.equal(monthContributionCents({ contributionCents: -50_000 }), -50_000);
  // Mês sem documento vale zero; valor fora de inteiro seguro não é exibido.
  assert.equal(monthContributionCents(null), 0);
  assert.equal(monthContributionCents(undefined), 0);
  assert.equal(monthContributionCents({ contributionCents: 10.5 }), 0);
  assert.equal(monthContributionCents({ contributionCents: Number.NaN }), 0);
});

test('P3-G — espelho de empréstimo move o saldo, mas não é receita nem despesa operacional', () => {
  const mirror = (
    type: 'receita' | 'despesa',
    valueCents: number,
    kind: string,
  ): Transaction => ({
    id: `loancash-${kind}-${type}`,
    type,
    description: kind === 'disbursement' ? 'Empréstimo recebido' : 'Pagamento de empréstimo',
    category: 'Empréstimos',
    value: valueCents / 100,
    valueCents,
    date: '2026-10-05',
    isPaid: true,
    loanEntry: { loanId: 'loan-a', loanMovementId: `lmv-${kind}`, kind },
  });
  const borrowed = mirror('receita', 1_000_000, 'disbursement');
  const payment = mirror('despesa', 110_000, 'payment');
  const salary = {
    id: 'salary', type: 'receita', description: 'Salário', category: 'Salário',
    value: 5_000, valueCents: 500_000, date: '2026-10-05', isPaid: true,
  } as Transaction;
  const summary = summarizeCashFlow([borrowed, payment, salary]);
  // Principal recebido e parcela paga não inflam receitas nem despesas.
  assert.equal(summary.income, 5_000);
  assert.equal(summary.expenses, 0);
  // O saldo inclui todos os fluxos: +10.000 − 1.100 + 5.000.
  assert.equal(transactionCashImpactCents(borrowed), 1_000_000);
  assert.equal(transactionCashImpactCents(payment), -110_000);
  assert.equal(summary.balance, 13_900);
});
