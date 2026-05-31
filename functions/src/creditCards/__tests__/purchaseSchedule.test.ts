import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInvoiceDrafts,
  buildPurchaseInstallments,
  calculateFirstInvoiceCompetence,
  calculateInstallmentAmounts,
} from "../createPurchase";

test("compra até o dia de fechamento deve cair na competência do mês da compra", () => {
  assert.equal(
    calculateFirstInvoiceCompetence("2026-04-10", 10),
    "2026-04",
  );
});

test("compra após o dia de fechamento deve cair na próxima competência", () => {
  assert.equal(
    calculateFirstInvoiceCompetence("2026-04-11", 10),
    "2026-05",
  );
});

test("competência deve virar o ano corretamente", () => {
  assert.equal(
    calculateFirstInvoiceCompetence("2026-12-28", 10),
    "2027-01",
  );
});

test("parcelas devem ajustar centavos na última parcela", () => {
  assert.deepEqual(
    calculateInstallmentAmounts(100, 3),
    [33.33, 33.33, 33.34],
  );
});

test("compra à vista no cartão deve gerar uma única parcela", () => {
  const installments = buildPurchaseInstallments(
    "workspace-test",
    "purchase-test",
    "card-test",
    250,
    1,
    "2026-05",
    10,
  );

  assert.equal(installments.length, 1);
  assert.equal(installments[0].amount, 250);
  assert.equal(installments[0].installmentNumber, 1);
  assert.equal(installments[0].installmentsCount, 1);
  assert.equal(installments[0].competenceMonth, "2026-05");
  assert.equal(installments[0].invoiceId, "card-test_2026-05");
  assert.equal(installments[0].dueDate, "2026-05-10");
});

test("compra parcelada deve alocar parcelas em competências sequenciais", () => {
  const installments = buildPurchaseInstallments(
    "workspace-test",
    "purchase-test",
    "card-test",
    600,
    3,
    "2026-05",
    10,
  );

  assert.equal(installments.length, 3);

  assert.deepEqual(
    installments.map((installment) => installment.competenceMonth),
    ["2026-05", "2026-06", "2026-07"],
  );

  assert.deepEqual(
    installments.map((installment) => installment.invoiceId),
    [
      "card-test_2026-05",
      "card-test_2026-06",
      "card-test_2026-07",
    ],
  );
});

test("datas de vencimento devem respeitar último dia de meses curtos", () => {
  const installments = buildPurchaseInstallments(
    "workspace-test",
    "purchase-test",
    "card-test",
    200,
    2,
    "2026-02",
    31,
  );

  assert.deepEqual(
    installments.map((installment) => installment.dueDate),
    ["2026-02-28", "2026-03-31"],
  );
});

test("faturas devem agrupar parcelas por competência", () => {
  const installments = buildPurchaseInstallments(
    "workspace-test",
    "purchase-test",
    "card-test",
    300,
    3,
    "2026-05",
    10,
  );

  const invoices = buildInvoiceDrafts(
    "card-test",
    installments,
    5,
    10,
  );

  assert.equal(invoices.length, 3);

  assert.deepEqual(
    invoices.map((invoice) => invoice.id),
    [
      "card-test_2026-05",
      "card-test_2026-06",
      "card-test_2026-07",
    ],
  );

  assert.deepEqual(
    invoices.map((invoice) => invoice.totalAmount),
    [100, 100, 100],
  );

  assert.deepEqual(
    invoices.map((invoice) => invoice.itemsCount),
    [1, 1, 1],
  );
});

test("fechamento e vencimento da fatura devem usar dia seguro do mês", () => {
  const installments = buildPurchaseInstallments(
    "workspace-test",
    "purchase-test",
    "card-test",
    100,
    1,
    "2026-02",
    31,
  );

  const invoices = buildInvoiceDrafts(
    "card-test",
    installments,
    31,
    31,
  );

  assert.equal(invoices[0].closingDate, "2026-02-28");
  assert.equal(invoices[0].dueDate, "2026-02-28");
});