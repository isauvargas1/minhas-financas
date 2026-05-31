import assert from "node:assert/strict";
import test from "node:test";

import {
  applyInvoicePaymentState,
  applyPaymentLimitRestore,
  applyPaymentReversalLimitConsume,
  reverseInvoicePaymentState,
} from "../testSupport/paymentLifecycle";

test("pagamento parcial deve baixar saldo e manter fatura como parcial", () => {
  const invoice = applyInvoicePaymentState(
    {
      totalAmount: 1000,
      paidAmount: 0,
      remainingAmount: 1000,
      status: "closed",
    },
    300,
  );

  assert.equal(invoice.paidAmount, 300);
  assert.equal(invoice.remainingAmount, 700);
  assert.equal(invoice.status, "partial_paid");
});

test("pagamento total deve zerar saldo e marcar fatura como paga", () => {
  const invoice = applyInvoicePaymentState(
    {
      totalAmount: 1000,
      paidAmount: 400,
      remainingAmount: 600,
      status: "partial_paid",
    },
    600,
  );

  assert.equal(invoice.paidAmount, 1000);
  assert.equal(invoice.remainingAmount, 0);
  assert.equal(invoice.status, "paid");
});

test("pagamento maior que saldo deve ser bloqueado", () => {
  assert.throws(
    () =>
      applyInvoicePaymentState(
        {
          totalAmount: 1000,
          paidAmount: 200,
          remainingAmount: 800,
          status: "partial_paid",
        },
        801,
      ),
    /Pagamento maior que o saldo da fatura/,
  );
});

test("pagamento em fatura paga deve ser bloqueado", () => {
  assert.throws(
    () =>
      applyInvoicePaymentState(
        {
          totalAmount: 1000,
          paidAmount: 1000,
          remainingAmount: 0,
          status: "paid",
        },
        100,
      ),
    /Fatura não aceita novo pagamento neste estado/,
  );
});

test("estorno total de pagamento parcial deve reabrir fatura", () => {
  const invoice = reverseInvoicePaymentState(
    {
      totalAmount: 1000,
      paidAmount: 300,
      remainingAmount: 700,
      status: "partial_paid",
    },
    300,
  );

  assert.equal(invoice.paidAmount, 0);
  assert.equal(invoice.remainingAmount, 1000);
  assert.equal(invoice.status, "open");
});

test("estorno parcial de fatura paga deve deixar fatura parcial", () => {
  const invoice = reverseInvoicePaymentState(
    {
      totalAmount: 1000,
      paidAmount: 1000,
      remainingAmount: 0,
      status: "paid",
    },
    250,
  );

  assert.equal(invoice.paidAmount, 750);
  assert.equal(invoice.remainingAmount, 250);
  assert.equal(invoice.status, "partial_paid");
});

test("estorno maior que valor pago deve ser bloqueado", () => {
  assert.throws(
    () =>
      reverseInvoicePaymentState(
        {
          totalAmount: 1000,
          paidAmount: 200,
          remainingAmount: 800,
          status: "partial_paid",
        },
        201,
      ),
    /Estorno maior que o valor pago da fatura/,
  );
});

test("pagamento deve recompor limite proporcionalmente ao valor pago", () => {
  const snapshot = applyPaymentLimitRestore(
    {
      limitTotal: 5000,
      limitUsed: 1200,
      limitAvailable: 3800,
    },
    300,
  );

  assert.equal(snapshot.limitUsed, 900);
  assert.equal(snapshot.limitAvailable, 4100);
});

test("estorno deve consumir novamente limite no valor estornado", () => {
  const snapshot = applyPaymentReversalLimitConsume(
    {
      limitTotal: 5000,
      limitUsed: 900,
      limitAvailable: 4100,
    },
    300,
  );

  assert.equal(snapshot.limitUsed, 1200);
  assert.equal(snapshot.limitAvailable, 3800);
});

test("valores inválidos devem ser bloqueados em operações financeiras", () => {
  assert.throws(
    () =>
      applyInvoicePaymentState(
        {
          totalAmount: 1000,
          paidAmount: 0,
          remainingAmount: 1000,
          status: "closed",
        },
        0,
      ),
    /Valor inválido para operação financeira/,
  );

  assert.throws(
    () =>
      applyPaymentLimitRestore(
        {
          limitTotal: 5000,
          limitUsed: 1200,
          limitAvailable: 3800,
        },
        -10,
      ),
    /Valor inválido para operação financeira/,
  );
});