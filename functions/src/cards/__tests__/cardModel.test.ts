import assert from "node:assert/strict";
import test from "node:test";

import {cashPeriodDeltaFor} from "../../cash/periods";
import {splitCentsEvenly} from "../../shared/money";
import {
  cardPaymentCashEffect,
  readCardPaymentCashEntry,
} from "../cashEffect";
import {
  createCreditCardInvoiceAdjustmentPayloadSchema,
  createCreditCardPayloadSchema,
  createCreditCardPurchasePayloadSchema,
  registerInvoicePaymentPayloadSchema,
  updateCreditCardPayloadSchema,
} from "../contracts";
import {
  CARD_MAX_INSTALLMENTS,
  addMonthsToMonthKey,
  clampedDayKey,
  closingDateOf,
  derivePaymentStatus,
  dueDateOf,
  firstOpenCompetence,
  isConsistentInvoiceState,
  isCycleEffectivelyClosed,
  isEntryAmountValid,
  isInvoiceOverdue,
  naturalCompetenceOf,
  placeInstallments,
} from "../model";

/**
 * P4-A (D-36) — regras puras do domínio de cartões: calendário de
 * fechamento/vencimento sem fuso, competência natural, publicação retroativa,
 * distribuição das parcelas pelo maior resto, estado de pagamento derivado,
 * atraso derivado, invariantes de fatura, contratos em centavos e efeito de
 * caixa do pagamento (liquidação, nunca despesa).
 */

test("calendário: dia ausente no mês usa o último dia, sem fuso", () => {
  assert.equal(clampedDayKey("2026-02", 31), "2026-02-28");
  assert.equal(clampedDayKey("2028-02", 30), "2028-02-29");
  assert.equal(clampedDayKey("2026-04", 31), "2026-04-30");
  assert.equal(clampedDayKey("2026-12", 31), "2026-12-31");
  assert.equal(addMonthsToMonthKey("2026-12", 1), "2027-01");
  assert.equal(addMonthsToMonthKey("2026-01", -1), "2025-12");
  assert.equal(addMonthsToMonthKey("2026-03", 59), "2031-02");
});

test("vencimento: primeiro dia de vencimento estritamente depois do " +
  "fechamento", () => {
  // Fecha 25, vence 5: vencimento no mês seguinte.
  assert.equal(closingDateOf("2026-03", 25), "2026-03-25");
  assert.equal(dueDateOf("2026-03", 25, 5), "2026-04-05");
  // Fecha 5, vence 15: mesmo mês.
  assert.equal(dueDateOf("2026-03", 5, 15), "2026-03-15");
  // Mesmo dia: vence no mês seguinte (nunca no dia do fechamento).
  assert.equal(dueDateOf("2026-03", 10, 10), "2026-04-10");
  // Fevereiro: fecha 30 → 28; vence 31 → 28 seria o mesmo dia → março.
  assert.equal(closingDateOf("2026-02", 30), "2026-02-28");
  assert.equal(dueDateOf("2026-02", 30, 31), "2026-03-31");
  // Dezembro vira o ano.
  assert.equal(dueDateOf("2026-12", 28, 8), "2027-01-08");
});

test("competência natural: compra no dia do fechamento vai para a seguinte",
  () => {
    assert.equal(naturalCompetenceOf("2026-03-24", 25), "2026-03");
    assert.equal(naturalCompetenceOf("2026-03-25", 25), "2026-04");
    assert.equal(naturalCompetenceOf("2026-03-31", 25), "2026-04");
    assert.equal(naturalCompetenceOf("2026-12-26", 25), "2027-01");
    // Fechamento 31 em fevereiro cai no dia 28.
    assert.equal(naturalCompetenceOf("2026-02-27", 31), "2026-02");
    assert.equal(naturalCompetenceOf("2026-02-28", 31), "2026-03");
    assert.equal(firstOpenCompetence("2026-03-10", 25), "2026-03");
  });

test("parcelas: maior resto com soma exata; sobra nos primeiros centavos",
  () => {
    assert.deepEqual(splitCentsEvenly(10_000, 3), [3334, 3333, 3333]);
    assert.deepEqual(splitCentsEvenly(100, 7), [15, 15, 14, 14, 14, 14, 14]);
    for (const [total, count] of [[1, 1], [59, 59], [999_999, 60],
      [100_000_000_001, 60], [12_345, 12]]) {
      const parts = splitCentsEvenly(total, count);
      assert.equal(parts.length, count);
      assert.equal(parts.reduce((sum, part) => sum + part, 0), total);
      assert.ok(Math.max(...parts) - Math.min(...parts) <= 1);
      assert.ok(parts.every((part) => Number.isSafeInteger(part) && part >= 1));
    }
  });

test("D-36 retroativa: parcelas de competência fechada vão para a primeira " +
  "aberta; a data da compra não muda", () => {
  const placements = placeInstallments({
    purchaseDate: "2026-01-10",
    amountsCents: splitCentsEvenly(30_001, 4),
    closingDay: 25,
    today: "2026-03-20",
  });
  assert.deepEqual(placements.map((p) => p.naturalCompetence),
    ["2026-01", "2026-02", "2026-03", "2026-04"]);
  assert.deepEqual(placements.map((p) => p.competenceMonth),
    ["2026-03", "2026-03", "2026-03", "2026-04"]);
  assert.deepEqual(placements.map((p) => p.amountCents),
    [7501, 7500, 7500, 7500]);
  // Compra de hoje: tudo na competência natural.
  const current = placeInstallments({
    purchaseDate: "2026-03-20",
    amountsCents: [100, 100],
    closingDay: 25,
    today: "2026-03-20",
  });
  assert.deepEqual(current.map((p) => p.competenceMonth),
    ["2026-03", "2026-04"]);
  assert.ok(current.every((p) => p.competenceMonth === p.naturalCompetence));
  // No dia do fechamento a competência corrente já fechou.
  const onClosing = placeInstallments({
    purchaseDate: "2026-03-25",
    amountsCents: [100],
    closingDay: 25,
    today: "2026-03-25",
  });
  assert.equal(onClosing[0].competenceMonth, "2026-04");
});

test("estados separados: pagamento derivado, ciclo efetivo e atraso nunca " +
  "persistido", () => {
  assert.equal(derivePaymentStatus(10_000, 0), "unpaid");
  assert.equal(derivePaymentStatus(10_000, 4_000), "partial");
  assert.equal(derivePaymentStatus(10_000, 10_000), "paid");
  assert.equal(derivePaymentStatus(0, 0), "paid");
  assert.equal(derivePaymentStatus(-500, 0), "paid");
  const open = {cycleStatus: "open" as const, closingDate: "2026-03-25"};
  assert.equal(isCycleEffectivelyClosed(open, "2026-03-24"), false);
  assert.equal(isCycleEffectivelyClosed(open, "2026-03-25"), true);
  assert.equal(isCycleEffectivelyClosed(
    {cycleStatus: "closed", closingDate: "2026-03-25"}, "2026-03-01"), true);
  const closed = {
    cycleStatus: "closed" as const,
    remainingCents: 100,
    dueDate: "2026-04-05",
  };
  assert.equal(isInvoiceOverdue(closed, "2026-04-05"), false);
  assert.equal(isInvoiceOverdue(closed, "2026-04-06"), true);
  assert.equal(isInvoiceOverdue({...closed, remainingCents: 0}, "2026-05-01"),
    false, "paga continua paga, sem atraso");
  assert.equal(isInvoiceOverdue({...closed, cycleStatus: "open"},
    "2026-05-01"), false);
});

test("invariantes da fatura: aberta sem pagamento, fechada sem total " +
  "negativo, restante e estado derivados", () => {
  const valid = {
    cycleStatus: "closed" as const,
    paymentStatus: "partial" as const,
    totalCents: 10_000,
    paidCents: 4_000,
    remainingCents: 6_000,
    activeEntryCount: 2,
  };
  assert.equal(isConsistentInvoiceState(valid), true);
  assert.equal(isConsistentInvoiceState({...valid, remainingCents: 5_999}),
    false);
  assert.equal(isConsistentInvoiceState({...valid, paymentStatus: "paid"}),
    false);
  assert.equal(isConsistentInvoiceState({...valid, totalCents: 10_000.5}),
    false);
  assert.equal(isConsistentInvoiceState({...valid, cycleStatus: "open"}),
    false, "fatura aberta não aceita pagamento");
  assert.equal(isConsistentInvoiceState({
    cycleStatus: "open", paymentStatus: "paid", totalCents: -300,
    paidCents: 0, remainingCents: -300, activeEntryCount: 1,
  }), true, "aberta pode ficar com crédito");
  assert.equal(isConsistentInvoiceState({
    cycleStatus: "closed", paymentStatus: "paid", totalCents: -300,
    paidCents: 0, remainingCents: -300, activeEntryCount: 1,
  }), false, "fechada nunca fica negativa (o crédito é transportado)");
  assert.equal(isEntryAmountValid("installment", 1), true);
  assert.equal(isEntryAmountValid("installment", -1), false);
  assert.equal(isEntryAmountValid("refund_credit", -1), true);
  assert.equal(isEntryAmountValid("refund_credit", 1), false);
  assert.equal(isEntryAmountValid("adjustment", -1), true);
  assert.equal(isEntryAmountValid("adjustment", 0), false);
  assert.equal(isEntryAmountValid("installment", 0.5), false);
});

const VISUAL = {
  bgType: "color",
  bgColor: "#1e293b",
  textColor: "white",
  showName: true,
  showBrand: true,
  showLogo: true,
};

test("contratos: centavos inteiros, teto de parcelas, origem nunca vem do " +
  "cliente", () => {
  const base = {
    workspaceId: "ws-1",
    idempotencyKey: "idem-12345678",
    cardId: "card_x",
    description: "Notebook",
    category: "Equipamentos",
    purchaseDate: "2026-01-10",
    totalCents: 10_000,
    installmentsCount: 3,
  };
  assert.equal(createCreditCardPurchasePayloadSchema.safeParse(base).success,
    true);
  for (const bad of [
    {totalCents: 100.5},
    {totalCents: 0},
    {installmentsCount: CARD_MAX_INSTALLMENTS + 1},
    {installmentsCount: 0},
    {installmentsCount: 2.5},
    {totalCents: 2, installmentsCount: 3},
    {source: "manual"},
    {source: "migration"},
    {amountType: "total"},
    {totalAmount: 100},
    {purchaseDate: "2999-01-01"},
  ]) {
    assert.equal(createCreditCardPurchasePayloadSchema
      .safeParse({...base, ...bad}).success, false, JSON.stringify(bad));
  }
  assert.equal(createCreditCardPurchasePayloadSchema.safeParse(
    {...base, installmentsCount: CARD_MAX_INSTALLMENTS, totalCents: 6000})
    .success, true);
});

test("contratos do cartão: limite em centavos, sem limite usado e com " +
  "imagem só https", () => {
  const base = {
    workspaceId: "ws-1",
    idempotencyKey: "idem-12345678",
    name: "Cartão",
    brand: "Visa",
    closingDay: 25,
    dueDay: 5,
    limitTotalCents: 500_000,
    visual: VISUAL,
  };
  assert.equal(createCreditCardPayloadSchema.safeParse(base).success, true);
  for (const bad of [
    {limitTotalCents: 5000.25},
    {limitTotal: 5000},
    {limitUsedCents: 0},
    {status: "active"},
    {closingDay: 32},
    {brand: "Diners"},
    {visual: {...VISUAL, bgImage: "javascript:alert(1)"}},
    {visual: {...VISUAL, bgImage: "https://x.test/a.png)"}},
    {visual: {...VISUAL, bgColor: "red"}},
  ]) {
    assert.equal(createCreditCardPayloadSchema.safeParse({...base, ...bad})
      .success, false, JSON.stringify(bad));
  }
  assert.equal(updateCreditCardPayloadSchema.safeParse({
    workspaceId: "ws-1",
    idempotencyKey: "idem-12345678",
    cardId: "card_x",
    expectedUpdatedAt: "2026-03-10T12:00:00.000000000Z",
    changes: {limitUsedCents: 0},
  }).success, false, "limite usado nunca é editável");
});

test("contratos de pagamento e ajuste: conta obrigatória, sem carteira nem " +
  "pagamento por ajuste", () => {
  const payment = {
    workspaceId: "ws-1",
    idempotencyKey: "idem-12345678",
    cardId: "card_x",
    invoiceId: "card_x_2026-03",
    cashAccountId: "acc_x",
    amountCents: 10_000,
    paymentDate: "2026-03-26",
    expectedUpdatedAt: "2026-03-10T12:00:00.000000000Z",
  };
  assert.equal(registerInvoicePaymentPayloadSchema.safeParse(payment).success,
    true);
  const {cashAccountId: _omit, ...withoutAccount} = payment;
  void _omit;
  for (const bad of [
    withoutAccount,
    {...payment, walletId: "w1"},
    {...payment, paymentMethod: "manual_adjustment"},
    {...payment, amountCents: 99.9},
  ]) {
    assert.equal(registerInvoicePaymentPayloadSchema.safeParse(bad).success,
      false, JSON.stringify(bad));
  }
  const adjustment = {
    workspaceId: "ws-1",
    idempotencyKey: "idem-12345678",
    cardId: "card_x",
    competenceMonth: "2026-03",
    amountCents: -1_500,
    reason: "Tarifa cobrada indevidamente",
  };
  assert.equal(createCreditCardInvoiceAdjustmentPayloadSchema
    .safeParse(adjustment).success, true);
  for (const bad of [
    {amountCents: 0},
    {reason: "x"},
    {competenceMonth: "2026-13"},
    {amountCents: 10.5},
  ]) {
    assert.equal(createCreditCardInvoiceAdjustmentPayloadSchema
      .safeParse({...adjustment, ...bad}).success, false, JSON.stringify(bad));
  }
});

test("pagamento de fatura na projeção: liquidação do cartão, nunca despesa; " +
  "fato + estorno somam zero", () => {
  const entry = {
    domainVersion: 1,
    cardId: "card_x",
    invoiceId: "card_x_2026-03",
    paymentId: "ccpay_1",
    kind: "invoice_payment",
    reversal: false,
    amountCents: 12_345,
    currency: "BRL",
  };
  const parsed = readCardPaymentCashEntry(entry);
  assert.ok(parsed);
  assert.deepEqual(cardPaymentCashEffect(parsed),
    {creditCardPaymentCents: 12_345, netCents: -12_345});
  const mirror = {
    type: "despesa",
    value: 123.45,
    valueCents: 12_345,
    date: "2026-03-26",
    isPaid: true,
    creditCardPaymentEntry: entry,
  };
  const delta = cashPeriodDeltaFor(mirror);
  assert.equal(delta.expenseCents, 0, "pagamento de fatura não é despesa");
  assert.equal(delta.incomeCents, 0);
  assert.equal(delta.creditCardPaymentCents, 12_345);
  assert.equal(delta.netCents, -12_345);
  const reversal = cashPeriodDeltaFor({
    ...mirror,
    type: "receita",
    creditCardPaymentEntry: {...entry, reversal: true, reversalOf: "ccpay_1",
      paymentId: "ccpay_2"},
  });
  assert.equal(reversal.incomeCents, 0, "estorno não é receita");
  assert.equal(delta.creditCardPaymentCents + reversal.creditCardPaymentCents,
    0);
  assert.equal(delta.netCents + reversal.netCents, 0);
  // Marca malformada não conta (falha fechada), nem como despesa comum.
  assert.equal(cashPeriodDeltaFor({...mirror,
    creditCardPaymentEntry: {...entry, amountCents: 1.5}}).netCents, 0);
  assert.equal(readCardPaymentCashEntry({...entry, reversal: true}), null,
    "estorno sem vínculo ao original é recusado");
});
