import assert from "node:assert/strict";
import test from "node:test";

import {addDaysToDayKey, saoPauloDayKey} from "../../shared/dateKeys";
import {
  CASH_ENTRY_MAX_CENTS,
  createCashTransactionPayloadSchema,
} from "../contracts";
import {cashTransactionId} from "../createTransaction";

/**
 * Contrato da criação de lançamento manual confirmado (P3-A).
 *
 * O schema é a primeira barreira: tudo que é autoritativo ou vínculo de outro
 * domínio precisa ser recusado aqui, antes de qualquer leitura.
 */
const receita = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: "ws-contrato",
  idempotencyKey: "idem-contrato-0001",
  cashAccountId: "acc_contrato",
  type: "receita",
  description: "Salário",
  category: "Salário",
  amountCents: 620_000,
  date: "2026-09-15",
  ...overrides,
});

const despesa = (overrides: Record<string, unknown> = {}) => ({
  ...receita({type: "despesa", description: "Mercado", category: "Casa"}),
  ...overrides,
});

const accepts = (payload: unknown) =>
  createCashTransactionPayloadSchema.parse(payload);

const rejects = (payload: unknown, label: string) =>
  assert.equal(
    createCashTransactionPayloadSchema.safeParse(payload).success,
    false,
    label,
  );

test("P3-A — receita e despesa válidas, com texto normalizado", () => {
  const parsedIncome = accepts(receita({
    description: "  Salário de setembro  ",
    incomeType: "Fixa",
  }));
  assert.equal(parsedIncome.description, "Salário de setembro");
  assert.equal(parsedIncome.type, "receita");

  const parsedExpense = accepts(despesa({
    expenseType: "Variável",
    paymentMethod: "Pix",
    supplier: "Mercado Central",
    costCenter: "Operação",
  }));
  assert.equal(parsedExpense.type, "despesa");
  assert.equal(parsedExpense.amountCents, 620_000);
});

test("P3-A — valor só em centavos inteiros, positivo e até o teto", () => {
  accepts(receita({amountCents: 1}));
  accepts(receita({amountCents: CASH_ENTRY_MAX_CENTS}));
  for (const amountCents of [
    0,
    -0,
    -1,
    10.5,
    0.1 + 0.2,
    "1000",
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    CASH_ENTRY_MAX_CENTS + 1,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    rejects(receita({amountCents}), `amountCents ${String(amountCents)}`);
  }
  rejects({...receita(), amountCents: undefined}, "amountCents ausente");
});

test("P3-A — data civil existente, de 2000 até hoje em São Paulo", () => {
  const today = saoPauloDayKey();
  accepts(receita({date: today}));
  accepts(receita({date: "2000-01-01"}));
  accepts(receita({date: "2024-02-29"}));
  for (const date of [
    addDaysToDayKey(today, 1),
    "1999-12-31",
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2026-9-15",
    "15/09/2026",
    "2026-09-15T12:00:00.000Z",
    "",
    20260915,
  ]) {
    rejects(receita({date}), `date ${String(date)}`);
  }
});

test("P3-A — campos autoritativos e vínculos alheios são recusados", () => {
  for (const [field, value] of [
    ["value", 6200],
    ["valueCents", 620_000],
    ["userId", "outro-usuario"],
    ["role", "owner"],
    ["profileId", "outro-workspace"],
    ["profileType", "PJ"],
    ["isPaid", false],
    ["currency", "USD"],
    ["transactionDate", "2026-09-15"],
    ["status", "pending"],
    ["goalId", "goal-1"],
    ["cardId", "card-1"],
    ["walletId", "wallet-1"],
    ["loanId", "loan-1"],
    ["loanMovementId", "loan-mov-1"],
    ["receivableId", "rec-1"],
    ["clientId", "cli-1"],
    ["installments", 2],
    ["currentInstallment", 1],
    ["source", "credit_card_invoice_payment"],
    ["creditCardInvoiceId", "inv-1"],
    ["creditCardInvoicePaymentId", "pay-1"],
    ["creditCardCompatibility", {source: "credit_card_invoice"}],
    ["investmentMetadata", {status: "settled"}],
    ["cashEntry", {origin: "manual"}],
    ["voidedAt", "2026-09-15"],
    ["createdBy", "backend"],
    ["displaySnapshots", {}],
    ["correlationId", "corr-1"],
  ] as const) {
    rejects(receita({[field]: value}), `campo ${field}`);
    rejects(despesa({[field]: value}), `campo ${field} (despesa)`);
  }
});

test("P3-A — só receita e despesa, cada uma com seus campos", () => {
  for (const type of [
    "investimento",
    "parcelado",
    "transferencia",
    "RECEITA",
    "",
    undefined,
  ]) {
    rejects(receita({type}), `tipo ${String(type)}`);
  }
  rejects(receita({expenseType: "Fixa"}), "expenseType em receita");
  rejects(receita({paymentMethod: "Pix"}), "paymentMethod em receita");
  rejects(despesa({incomeType: "Fixa"}), "incomeType em despesa");
});

test("P3-A — textos obrigatórios, com teto e sem controle", () => {
  for (const [field, value] of [
    ["description", ""],
    ["description", "   "],
    ["description", "x".repeat(301)],
    ["description", "Mercado\u0000"],
    ["category", ""],
    ["category", "x".repeat(121)],
    ["category", "Casa\nNova"],
    ["supplier", "x".repeat(201)],
    ["costCenter", ""],
    ["description", 123],
  ] as const) {
    rejects(despesa({[field]: value}), `${field} ${JSON.stringify(value)}`);
  }
  accepts(despesa({description: "x".repeat(300), category: "y".repeat(120)}));
  rejects({...despesa(), description: undefined}, "descrição ausente");
  rejects({...despesa(), category: undefined}, "categoria ausente");
});

test("P3-A — workspace e chave validados como caminho", () => {
  for (const [field, value] of [
    ["workspaceId", ""],
    ["workspaceId", "a/b"],
    ["workspaceId", "__x__"],
    ["idempotencyKey", "curta"],
    ["idempotencyKey", " idem-com-espaco "],
  ] as const) {
    rejects(receita({[field]: value}), `${field} ${value}`);
  }
  rejects({...receita(), idempotencyKey: undefined}, "chave ausente");
  rejects({...receita(), workspaceId: undefined}, "workspace ausente");
});

test("P3-A — ID determinístico por workspace, ator e chave", () => {
  const id = cashTransactionId("ws-a", "uid-a", "idem-0001-chave");
  assert.match(id, /^cash_[0-9a-f]{40}$/);
  assert.equal(id, cashTransactionId("ws-a", "uid-a", "idem-0001-chave"));
  assert.notEqual(id, cashTransactionId("ws-b", "uid-a", "idem-0001-chave"));
  assert.notEqual(id, cashTransactionId("ws-a", "uid-b", "idem-0001-chave"));
  assert.notEqual(id, cashTransactionId("ws-a", "uid-a", "idem-0002-chave"));
});
