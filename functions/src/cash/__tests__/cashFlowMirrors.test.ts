import assert from "node:assert/strict";
import test from "node:test";

import {
  addCashPeriodDelta,
  CashContractViolationError,
  cashPeriodDeltasFor,
  emptyCashPeriodDelta,
  type CashPeriodDelta,
} from "../periods";

/**
 * P5-C1 — a classificação do caixa realizado por conjunto de fatos vem
 * exclusivamente da projeção do backend (`cashPeriodDeltaFor` /
 * `cashPeriodDeltasFor`). Estes testes provam, sobre a soma dos deltas de
 * um mesmo mês, as regras que o Dashboard antigo calculava no navegador:
 * espelhos de domínio no saldo e fora de receita/despesa operacionais.
 */

const OCTOBER = "2026-10";

const doc = (overrides: Record<string, unknown>) => ({
  description: "Lançamento",
  category: "Geral",
  date: "2026-10-05",
  isPaid: true,
  ...overrides,
});

/** Soma o efeito de cada documento criado no mês, como o gatilho faz. */
const flowOf = (docs: Record<string, unknown>[]): CashPeriodDelta =>
  docs.reduce<CashPeriodDelta>((total, data) => {
    const deltas = cashPeriodDeltasFor(undefined, data);
    return addCashPeriodDelta(total,
      deltas[OCTOBER] ?? emptyCashPeriodDelta());
  }, emptyCashPeriodDelta());

const salary = doc({
  type: "receita", description: "Salário", valueCents: 500_000,
});

test("empréstimo recebido e parcela paga movem o saldo, sem inflar receita " +
  "nem despesa", () => {
  const borrowed = doc({
    type: "receita", valueCents: 1_000_000,
    loanEntry: {domainVersion: 1, loanId: "l1", loanMovementId: "lmv_1",
      loanType: "borrow", kind: "disbursement", reversal: false,
      principalCents: 1_000_000, interestCents: 0, currency: "BRL"},
  });
  const payment = doc({
    type: "despesa", valueCents: 110_000,
    loanEntry: {domainVersion: 1, loanId: "l1", loanMovementId: "lmv_2",
      loanType: "borrow", kind: "payment", reversal: false,
      principalCents: 100_000, interestCents: 10_000, currency: "BRL"},
  });
  const flow = flowOf([borrowed, payment, salary]);
  assert.equal(flow.incomeCents, 500_000);
  assert.equal(flow.expenseCents, 0);
  // +10.000 − 1.100 + 5.000.
  assert.equal(flow.netCents, 1_390_000);
  assert.equal(flow.loanPrincipalInflowCents, 1_000_000);
  assert.equal(flow.loanPrincipalOutflowCents, 100_000);
  assert.equal(flow.financialExpenseCents, 10_000);
});

test("pagamento de fatura move o saldo, fora de despesa; o estorno, fora de " +
  "receita", () => {
  const payment = doc({
    type: "despesa", valueCents: 30_000,
    creditCardPaymentEntry: {domainVersion: 1, cardId: "c1", invoiceId: "i1",
      paymentId: "p1", kind: "invoice_payment", reversal: false,
      amountCents: 30_000, currency: "BRL"},
  });
  const reversal = doc({
    type: "receita", valueCents: 10_000,
    creditCardPaymentEntry: {domainVersion: 1, cardId: "c1", invoiceId: "i1",
      paymentId: "p2", kind: "invoice_payment", reversal: true,
      reversalOf: "p1", amountCents: 10_000, currency: "BRL"},
  });
  const purchaseLikeExpense = doc({
    type: "despesa", valueCents: 5_000,
  });
  const flow = flowOf([payment, reversal, purchaseLikeExpense]);
  assert.equal(flow.expenseCents, 5_000,
    "o pagamento de fatura não entra em despesas");
  assert.equal(flow.incomeCents, 0,
    "o estorno do pagamento não entra em receitas");
  assert.equal(flow.creditCardPaymentCents, 20_000);
  assert.equal(flow.netCents, -30_000 + 10_000 - 5_000, "mas move o saldo");
});

test("recebível: só o principal é receita; juros e multa entram no saldo; " +
  "o estorno desfaz o recebimento sem virar despesa", () => {
  const receipt = doc({
    type: "receita", valueCents: 92_000,
    receivableEntry: {domainVersion: 1, receivableId: "r1",
      receivableMovementId: "rmv_1", clientId: "cli_1", kind: "receipt",
      reversal: false, principalCents: 90_000, interestCents: 1_500,
      penaltyCents: 500, discountCents: 10_000, currency: "BRL"},
  });
  const reversal = doc({
    type: "despesa", valueCents: 92_000,
    receivableEntry: {domainVersion: 1, receivableId: "r1",
      receivableMovementId: "rmv_2", clientId: "cli_1", kind: "receipt",
      reversal: true, reversalOf: "rmv_1", principalCents: 90_000,
      interestCents: 1_500, penaltyCents: 500, discountCents: 10_000,
      currency: "BRL"},
  });
  const sale = doc({
    type: "receita", description: "Venda", valueCents: 10_000,
  });
  const received = flowOf([receipt, sale]);
  assert.equal(received.incomeCents, 100_000, "principal + venda");
  assert.equal(received.expenseCents, 0);
  assert.equal(received.financialIncomeCents, 2_000);
  assert.equal(received.netCents, 102_000,
    "o caixa recebe principal + juros + multa");
  const undone = flowOf([receipt, reversal, sale]);
  assert.equal(undone.incomeCents, 10_000);
  assert.equal(undone.expenseCents, 0, "estorno não é despesa");
  assert.equal(undone.netCents, 10_000);
});

test("divisão de contas: o título é despesa; a compensação anula a despesa " +
  "com sinal, sem virar receita", () => {
  const income = doc({
    type: "receita", description: "Salário", valueCents: 100_000,
  });
  const expense = doc({
    type: "despesa", valueCents: 9_000,
    splitEntry: {domainVersion: 1, kind: "bill_expense", groupId: "g1",
      billId: "b1", reimbursementId: null, reversal: false, reversalOf: null,
      amountCents: 9_000, currency: "BRL"},
  });
  const compensation = doc({
    type: "receita", valueCents: 9_000,
    splitEntry: {domainVersion: 1, kind: "bill_expense", groupId: "g1",
      billId: "b1", reimbursementId: null, reversal: true,
      reversalOf: "scash_1", amountCents: 9_000, currency: "BRL"},
  });
  const before = flowOf([income, expense]);
  assert.equal(before.incomeCents, 100_000);
  assert.equal(before.expenseCents, 9_000);
  assert.equal(before.netCents, 91_000);
  const after = flowOf([income, expense, compensation]);
  assert.equal(after.incomeCents, 100_000, "compensação não é receita");
  assert.equal(after.expenseCents, 0);
  assert.equal(after.netCents, 100_000);
});

test("pendente fica fora do realizado: receitas, despesas e saldo", () => {
  const pendingExpense = doc({
    type: "despesa", valueCents: 10_000, isPaid: false,
  });
  const pendingIncome = doc({
    type: "receita", valueCents: 30_000, isPaid: false,
  });
  const paidExpense = doc({
    type: "despesa", valueCents: 4_000,
  });
  const legacyIncome = doc({
    type: "receita", valueCents: 50_000, isPaid: undefined,
  });
  const flow = flowOf([pendingExpense, pendingIncome, paidExpense,
    legacyIncome]);
  assert.equal(flow.incomeCents, 50_000, "receita a receber não entra");
  assert.equal(flow.expenseCents, 4_000, "despesa a pagar não entra");
  assert.equal(flow.netCents, 50_000 - 4_000);
  assert.equal(flow.transactionCount, 2);
});

test("investimento: aporte e retirada movem só o saldo; nunca são receita " +
  "nem despesa operacional", () => {
  const contribution = doc({
    type: "investimento", valueCents: 100_000,
    investmentEntry: {domainVersion: 1, movementId: "im1",
      operation: "contribution", reversal: false, reversalOf: null,
      status: "settled", principalCents: 100_000, gainCents: 0,
      amountCents: 100_000, currency: "BRL"},
  });
  const redemption = doc({
    type: "investimento", valueCents: 43_500,
    investmentEntry: {domainVersion: 1, movementId: "im2",
      operation: "redemption", reversal: false, reversalOf: null,
      status: "settled", principalCents: 40_000, gainCents: 3_500,
      amountCents: 43_500, currency: "BRL"},
  });
  const onlyContribution = flowOf([contribution]);
  assert.equal(onlyContribution.incomeCents, 0);
  assert.equal(onlyContribution.expenseCents, 0);
  assert.equal(onlyContribution.investmentOutflowCents, 100_000);
  assert.equal(onlyContribution.netCents, -100_000);
  const both = flowOf([contribution, redemption]);
  assert.equal(both.incomeCents, 0);
  assert.equal(both.expenseCents, 0);
  // −1.000 do aporte + 435 da retirada.
  assert.equal(both.netCents, -56_500);
  // Sem marca válida: fora do contrato, é violação (nunca zero silencioso).
  for (const forged of [
    doc({type: "investimento", valueCents: 100_000}),
    doc({type: "investimento", valueCents: 100_000,
      investmentEntry: {domainVersion: 2}}),
  ]) {
    assert.throws(() => flowOf([forged]), CashContractViolationError);
  }
});
