import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMoneyEquals,
  calculateAvailableLimit,
  calculateNetLimitConsumption,
  calculatePostedPaymentsAmount,
  sumAmounts,
} from "../testSupport/domainConsistency";

test("soma das parcelas deve ser igual ao total da compra", () => {
  const purchaseTotalAmount = 1200;
  const installments = [
    {amount: 400},
    {amount: 400},
    {amount: 400},
  ];

  assertMoneyEquals(
    sumAmounts(installments),
    purchaseTotalAmount,
    "A soma das parcelas deve fechar com o total da compra",
  );
});

test("soma dos itens deve ser igual ao total da fatura", () => {
  const invoiceTotalAmount = 850.75;
  const invoiceItems = [
    {amount: 250.25},
    {amount: 300.25},
    {amount: 300.25},
  ];

  assertMoneyEquals(
    sumAmounts(invoiceItems),
    invoiceTotalAmount,
    "A soma dos itens deve fechar com o total da fatura",
  );
});

test("soma dos pagamentos postados deve ser igual ao paidAmount", () => {
  const invoicePaidAmount = 700;
  const payments = [
    {amount: 500, status: "posted"},
    {amount: 200, status: "posted"},
    {amount: 200, status: "reversed"},
  ];

  assertMoneyEquals(
    calculatePostedPaymentsAmount(payments),
    invoicePaidAmount,
    "A soma dos pagamentos válidos deve fechar com o paidAmount",
  );
});

test("limite disponível deve ser limite total menos consumo líquido", () => {
  const limitTotal = 5000;
  const ledgerEntries = [
    {amount: 1200, direction: "consume"},
    {amount: 300, direction: "restore"},
    {amount: 200, direction: "consume"},
  ];

  assert.equal(calculateNetLimitConsumption(ledgerEntries), 1100);
  assert.equal(calculateAvailableLimit(limitTotal, ledgerEntries), 3900);
});

test("normalização deve evitar divergência por centavos em parcelas fracionadas", () => {
  const purchaseTotalAmount = 100;
  const installments = [
    {amount: 33.33},
    {amount: 33.33},
    {amount: 33.34},
  ];

  assertMoneyEquals(
    sumAmounts(installments),
    purchaseTotalAmount,
    "Parcelas com centavos ajustados devem fechar com o total",
  );
});
