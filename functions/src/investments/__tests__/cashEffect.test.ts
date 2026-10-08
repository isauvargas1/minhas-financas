import assert from "node:assert/strict";
import test from "node:test";

import {cashPeriodDeltaFor} from "../../cash/periods";
import {
  INVESTMENT_CASH_ENTRY_VERSION,
  investmentCashEffect,
  readInvestmentCashEntry,
  type InvestmentCashEntry,
} from "../cashEffect";

/**
 * Espelho de caixa de investimento (D-15, P4-D): a marca `investmentEntry`
 * decide a classificação, e nenhuma outra coisa — nem `type`, nem `value`,
 * nem metadado antigo.
 */

const entry = (
  overrides: Partial<InvestmentCashEntry> = {},
): InvestmentCashEntry => ({
  domainVersion: INVESTMENT_CASH_ENTRY_VERSION,
  movementId: "mov-1",
  operation: "contribution",
  reversal: false,
  reversalOf: null,
  status: "settled",
  principalCents: 10_000,
  gainCents: 0,
  amountCents: 10_000,
  currency: "BRL",
  ...overrides,
});

const mirror = (value: unknown) => ({
  type: "investimento",
  valueCents: 10_000,
  value: 100,
  date: "2026-10-10",
  isPaid: true,
  investmentEntry: value,
});

test("aporte liquidado sai como investimento; estorno compensa", () => {
  assert.deepEqual(investmentCashEffect(entry()), {
    investmentOutflowCents: 10_000,
    investmentInflowCents: 0,
    financialIncomeCents: 0,
    netCents: -10_000,
  });
  const reversal = entry({reversal: true, reversalOf: "mov-0"});
  assert.deepEqual(investmentCashEffect(reversal), {
    investmentOutflowCents: -10_000,
    investmentInflowCents: 0,
    financialIncomeCents: 0,
    netCents: 10_000,
  });
});

test("retirada recebida: principal volta ao caixa, rendimento é resultado financeiro", () => {
  const redemption = entry({
    operation: "redemption", principalCents: 10_000, gainCents: 1_500,
    amountCents: 11_500,
  });
  const effect = investmentCashEffect(redemption);
  assert.deepEqual(effect, {
    investmentOutflowCents: 0,
    investmentInflowCents: 10_000,
    financialIncomeCents: 1_500,
    netCents: 11_500,
  });
  const delta = cashPeriodDeltaFor(mirror(redemption));
  // Principal não é receita operacional.
  assert.equal(delta.incomeCents, 0);
  assert.equal(delta.investmentInflowCents, 10_000);
  assert.equal(delta.financialIncomeCents, 1_500);
  assert.equal(delta.netCents, 11_500);
  assert.equal(delta.transactionCount, 1);
  // O estorno da retirada compensa todos os campos.
  const reversal = cashPeriodDeltaFor(mirror({
    ...redemption, reversal: true, reversalOf: "mov-0",
  }));
  assert.equal(reversal.investmentInflowCents, -10_000);
  assert.equal(reversal.financialIncomeCents, -1_500);
  assert.equal(reversal.netCents, -11_500);
});

test("pendente e cancelado não movem caixa", () => {
  for (const status of ["pending", "cancelled"] as const) {
    assert.equal(investmentCashEffect(entry({status})).netCents, 0);
    const delta = cashPeriodDeltaFor(mirror(entry({status})));
    assert.equal(delta.netCents, 0);
    assert.equal(delta.investmentOutflowCents, 0);
    assert.equal(delta.transactionCount, 0);
  }
});

test("documento investimento sem marca válida está fora do contrato (PR-INV-01)", () => {
  // Sem marca: não é aporte, não move caixa, não usa `value`.
  for (const forged of [
    {type: "investimento", value: 100, valueCents: 10_000, date: "2026-10-10"},
    {...mirror(undefined), investmentMetadata: {
      status: "settled", cashImpact: "outflow", investmentOperation: "contribution",
    }},
    mirror({}),
    mirror(entry({domainVersion: 99})),
    mirror(entry({amountCents: 10_001})),
    mirror(entry({gainCents: 1, amountCents: 10_001})),
    mirror(entry({reversal: true, reversalOf: null})),
    mirror(entry({reversal: true, reversalOf: "mov-0", status: "pending"})),
    mirror(entry({principalCents: -1, amountCents: -1})),
    mirror(entry({principalCents: 10.5, amountCents: 10.5})),
  ]) {
    const delta = cashPeriodDeltaFor(forged);
    assert.equal(delta.netCents, 0, JSON.stringify(forged));
    assert.equal(delta.investmentOutflowCents, 0);
    assert.equal(delta.transactionCount, 0);
  }
  assert.equal(readInvestmentCashEntry({}), null);
  assert.equal(readInvestmentCashEntry(null), null);
  // A marca só vale no tipo `investimento`.
  const delta = cashPeriodDeltaFor({...mirror(entry()), type: "despesa"});
  assert.equal(delta.netCents, 0);
  assert.equal(delta.expenseCents, 0);
});
