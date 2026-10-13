import assert from "node:assert/strict";
import test from "node:test";

import {createCreditCardPurchasePayloadSchema} from "../../cards/contracts";
import {
  confirmRecurringOccurrencePayloadSchema,
  createRecurringExpensePayloadSchema,
  retryRecurringOccurrencePayloadSchema,
  updateRecurringExpensePayloadSchema,
} from "../contracts";
import {
  RECURRING_MAX_CENTS,
  readAuthoritativeOccurrence,
  readAuthoritativeRecurringExpense,
} from "../model";
import {Timestamp} from "firebase-admin/firestore";

/**
 * Contratos das callables de Recorrentes (P4-B): estritos, centavos
 * inteiros, modo de execução explícito, destino coerente e nada
 * autoritativo vindo do cliente.
 */
const base = {
  workspaceId: "ws-1",
  idempotencyKey: "idem-recorrente-1",
  name: "Internet",
  type: "fixed_bill",
  description: null,
  amountCents: 9_990,
  frequency: "monthly",
  billingDay: 10,
  startDate: "2026-01-10",
  endDate: null,
  paymentMethod: "pix",
  executionMode: "automatic",
  cardId: null,
  cashAccountId: "acc-1",
  categoryId: "cat-despesa-utilidades",
  visual: {color: "#4f46e5", icon: "IconCloud", emoji: null},
  business: null,
};

const ok = (data: unknown) =>
  createRecurringExpensePayloadSchema.safeParse(data).success;

test("criação válida: caixa e cartão", () => {
  assert.equal(ok(base), true);
  assert.equal(ok({...base, paymentMethod: "credit_card", cardId: "card-1",
    cashAccountId: null}), true);
  assert.equal(ok({...base, frequency: "weekly", billingDay: null}), true);
  assert.equal(ok({...base, frequency: "biweekly", billingDay: null}), true);
});

test("criação exige categoryId; categoria em texto é recusada", () => {
  assert.equal(ok({...base, categoryId: undefined}), false, "sem categoryId");
  assert.equal(ok({...base, categoryId: ""}), false, "categoryId vazio");
  assert.equal(ok({...base, categoryId: "a/b"}), false, "categoryId caminho");
  assert.equal(ok({...base, category: "Utilidades"}), false,
    "category texto junto do ID");
  assert.equal(ok({...base, categoryId: undefined, category: "Utilidades"}),
    false, "category texto no lugar do ID");
});

test("criação recusa formatos inseguros e campos autoritativos", () => {
  for (const [label, data] of [
    ["valor em reais", {...base, amountCents: 99.9}],
    ["valor texto", {...base, amountCents: "9990"}],
    ["valor zero", {...base, amountCents: 0}],
    ["sem modo de execução", {...base, executionMode: undefined}],
    ["modo desconhecido", {...base, executionMode: "auto"}],
    ["frequência antiga", {...base, frequency: "mensal"}],
    ["mensal sem dia", {...base, billingDay: null}],
    ["semanal com dia", {...base, frequency: "weekly", billingDay: 3}],
    ["dia 32", {...base, billingDay: 32}],
    ["término antes do início", {...base, endDate: "2025-12-31"}],
    ["data inexistente", {...base, startDate: "2026-02-30"}],
    ["cartão sem cartão", {...base, paymentMethod: "credit_card",
      cashAccountId: null}],
    ["cartão com conta", {...base, paymentMethod: "credit_card",
      cardId: "card-1"}],
    ["caixa sem conta", {...base, cashAccountId: null}],
    ["caixa com cartão", {...base, cardId: "card-1"}],
    ["origem forjada", {...base, source: "recurring"}],
    ["estado forjado", {...base, status: "active"}],
    ["próximo vencimento forjado", {...base, nextDueDate: "2026-01-10"}],
    ["autor forjado", {...base, createdBy: "outro"}],
    ["Split", {...base, splitGroupIdOpcional: "g1"}],
    ["campo legado", {...base, valorPadrao: 99.9}],
    ["ícone com caminho", {...base, visual: {...base.visual, icon: "../x"}}],
    ["cor inválida", {...base, visual: {...base.visual, color: "red"}}],
  ] as const) {
    assert.equal(ok(data), false, label);
  }
});

test("valor no teto aceito; um centavo acima recusado na criação, edição " +
  "e confirmação", () => {
  assert.equal(ok({...base, amountCents: RECURRING_MAX_CENTS}), true);
  assert.equal(ok({...base, amountCents: RECURRING_MAX_CENTS + 1}), false);
  const update = (amountCents: number) =>
    updateRecurringExpensePayloadSchema.safeParse({
      workspaceId: "ws-1", idempotencyKey: "idem-recorrente-teto",
      recurringExpenseId: "rec_1",
      expectedUpdatedAt: "2026-10-06T12:00:00.000000000Z",
      changes: {amountCents},
    }).success;
  assert.equal(update(RECURRING_MAX_CENTS), true);
  assert.equal(update(RECURRING_MAX_CENTS + 1), false);
  const confirm = (amountCents: number) =>
    confirmRecurringOccurrencePayloadSchema.safeParse({
      workspaceId: "ws-1", idempotencyKey: "idem-recorrente-teto-2",
      occurrenceId: "rocc_1", amountCents,
    }).success;
  assert.equal(confirm(RECURRING_MAX_CENTS), true);
  assert.equal(confirm(RECURRING_MAX_CENTS + 1), false);
});

test("edição: só campos do contrato, versão obrigatória, motivo " +
  "opcional", () => {
  const update = (data: Record<string, unknown>) =>
    updateRecurringExpensePayloadSchema.safeParse({
      workspaceId: "ws-1", idempotencyKey: "idem-recorrente-2",
      recurringExpenseId: "rec_1",
      expectedUpdatedAt: "2026-10-06T12:00:00.000000000Z", ...data,
    }).success;
  assert.equal(update({changes: {amountCents: 12_000}}), true);
  assert.equal(update({changes: {amountCents: 12_000}, reason: "Reajuste"}),
    true);
  assert.equal(update({changes: {categoryId: "cat-despesa-outra"}}), true);
  assert.equal(update({changes: {category: "Outra"}}), false);
  assert.equal(update({changes: {}}), false);
  assert.equal(update({changes: {status: "paused"}}), false);
  assert.equal(update({changes: {nextDueDate: "2026-11-10"}}), false);
  assert.equal(update({changes: {amountCents: 120.5}}), false);
  assert.equal(update({changes: {adjustments: []}}), false);
  assert.equal(updateRecurringExpensePayloadSchema.safeParse({
    workspaceId: "ws-1", idempotencyKey: "idem-recorrente-2",
    recurringExpenseId: "rec_1", changes: {amountCents: 1},
  }).success, false, "sem versão");
});

test("confirmação: pago exige data; data só com pago; valor em " +
  "centavos", () => {
  const confirm = (data: Record<string, unknown>) =>
    confirmRecurringOccurrencePayloadSchema.safeParse({
      workspaceId: "ws-1", idempotencyKey: "idem-recorrente-3",
      occurrenceId: "rocc_1", ...data,
    }).success;
  assert.equal(confirm({}), true);
  assert.equal(confirm({amountCents: 10_500}), true);
  assert.equal(confirm({settlement: "pending", cashAccountId: "acc-2"}), true);
  assert.equal(confirm({settlement: "paid", paidDate: "2026-01-10"}), true);
  assert.equal(confirm({settlement: "paid"}), false);
  assert.equal(confirm({settlement: "pending", paidDate: "2026-01-10"}),
    false);
  assert.equal(confirm({settlement: "paid", paidDate: "2999-01-10"}), false);
  assert.equal(confirm({amountCents: 105.5}), false);
  assert.equal(confirm({source: "recurring"}), false);
  assert.equal(retryRecurringOccurrencePayloadSchema.safeParse({
    workspaceId: "ws-1", idempotencyKey: "idem-recorrente-4",
    occurrenceId: "rocc_1", cardId: "c", cashAccountId: "a",
  }).success, false, "cartão e conta juntos");
});

test("a compra manual de cartão nunca aceita origem do cliente", () => {
  const purchase = {
    workspaceId: "ws-1", idempotencyKey: "idem-compra-1", cardId: "card-1",
    description: "Notebook", category: "Equipamentos",
    purchaseDate: "2026-01-10", totalCents: 1_000, installmentsCount: 1,
  };
  assert.equal(createCreditCardPurchasePayloadSchema.safeParse(purchase)
    .success, true);
  for (const source of ["recurring", "manual", "split"]) {
    assert.equal(createCreditCardPurchasePayloadSchema.safeParse(
      {...purchase, source}).success, false, source);
  }
});

const stored = {
  id: "rec_1", schemaVersion: 1, workspaceId: "ws-1", name: "Internet",
  type: "fixed_bill", description: null, amountCents: 9_990, currency: "BRL",
  frequency: "monthly", billingDay: 10, startDate: "2026-01-10",
  endDate: null, paymentMethod: "pix", executionMode: "automatic",
  cardId: null, cashAccountId: "acc-1",
  categoryId: "cat-despesa-utilidades", category: "Utilidades",
  status: "active", nextDueDate: "2026-02-10", lastProcessedDueDate: null,
  openOccurrenceCount: 0, visual: {color: "#4f46e5", icon: "Bolt", emoji: null},
  business: null, createdBy: "uid-1", revision: 1, requestHash: "h",
  updatedAt: Timestamp.now(),
};

test("leitor do contrato: só o schema autoritativo e coerente", () => {
  assert.ok(readAuthoritativeRecurringExpense("rec_1", stored, "ws-1"));
  for (const [label, data] of [
    ["outro workspace", {...stored, workspaceId: "ws-2"}],
    ["legado", {...stored, schemaVersion: undefined, valorPadrao: 99.9}],
    ["reais", {...stored, amountCents: 99.9}],
    ["ativo sem vencimento", {...stored, nextDueDate: null}],
    ["pausado com vencimento", {...stored, status: "paused"}],
    ["sem categoryId", {...stored, categoryId: undefined}],
    ["sem nome da categoria", {...stored, category: undefined}],
    ["caixa sem conta", {...stored, cashAccountId: null}],
    ["cartão com conta", {...stored, paymentMethod: "credit_card",
      cardId: "card-1"}],
    ["semanal com dia", {...stored, frequency: "weekly"}],
    ["término antes do início", {...stored, endDate: "2025-01-01"}],
  ] as const) {
    assert.equal(readAuthoritativeRecurringExpense("rec_1", data, "ws-1"), null,
      label);
  }
});

const occurrence = {
  schemaVersion: 1, workspaceId: "ws-1", recurringExpenseId: "rec_1",
  dueDate: "2026-02-10", competenceMonth: "2026-02", plannedAmountCents: 9_990,
  actualAmountCents: 9_990, currency: "BRL", status: "generated",
  targetDomain: "cash", executionMode: "automatic", cardId: null,
  cashAccountId: "acc-1", cashTransactionId: "cash_1", cardPurchaseId: null,
  attentionCode: null, revision: 1, updatedAt: Timestamp.now(),
};

test("leitor da ocorrência: um fato só quando gerada, código só na " +
  "atenção", () => {
  assert.ok(readAuthoritativeOccurrence("rocc_1", occurrence, "ws-1"));
  for (const [label, data] of [
    ["gerada sem fato", {...occurrence, cashTransactionId: null}],
    ["fato no domínio errado", {...occurrence, cardPurchaseId: "ccp_1"}],
    ["aguardando com fato", {...occurrence, status: "awaiting_confirmation"}],
    ["atenção sem código", {...occurrence, status: "attention_required",
      cashTransactionId: null}],
    ["código fora da atenção", {...occurrence, attentionCode: "card_archived"}],
    ["competência incoerente", {...occurrence, competenceMonth: "2026-03"}],
  ] as const) {
    assert.equal(readAuthoritativeOccurrence("rocc_1", data, "ws-1"), null,
      label);
  }
});
