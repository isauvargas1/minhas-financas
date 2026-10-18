import assert from "node:assert/strict";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {saoPauloDayKey} from "../../shared/dateKeys";
import {
  CASH_ENTRY_MAX_DUE_YEARS,
  cashImportItemSchema,
  confirmCashTransactionPayloadSchema,
  createCashTransactionPayloadSchema,
  maxDueDayKey,
  settlementOf,
  updateCashTransactionPayloadSchema,
} from "../contracts";
import {
  CashContractViolationError,
  cashPeriodDeltaFor,
  cashPeriodDeltasFor,
  isUnsettledCashEntry,
  emptyCashPeriodDelta,
  type CashPeriodDelta,
} from "../periods";

/** Delta completo (P3-G: campos de empréstimos valem zero aqui). */
const delta = (fields: Partial<CashPeriodDelta>): CashPeriodDelta =>
  ({...emptyCashPeriodDelta(), ...fields});

/**
 * P3-F — D-29: contratos de pendente, agendado e confirmação, e a regra única
 * do caixa realizado na projeção mensal.
 */

const WS = "ws-d29";
const KEY = "intent-d29-0000000001";
const today = saoPauloDayKey();
const shiftDays = (dayKey: string, days: number): string => {
  const date = new Date(`${dayKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const tomorrow = shiftDays(today, 1);
const yesterday = shiftDays(today, -1);

const base = {
  workspaceId: WS,
  idempotencyKey: KEY,
  cashAccountId: "acc_d29",
  type: "despesa" as const,
  description: "Aluguel",
  categoryId: "cat-despesa-moradia",
  amountCents: 150_000,
};

const issuesOf = (result: {success: boolean; error?: {issues: Array<{
  path: PropertyKey[]; message: string;
}>}}) => result.success ? [] : (result.error?.issues ?? []).map((issue) =>
  `${issue.path.join(".")}: ${issue.message}`);

test("P3-F — criação: confirmado com data até hoje; pendente com vencimento " +
  "", () => {
  // Confirmado (explícito ou padrão), data até hoje.
  for (const payload of [
    {...base, date: today},
    {...base, status: "confirmed", date: yesterday},
  ]) {
    const parsed = createCashTransactionPayloadSchema.safeParse(payload);
    assert.ok(parsed.success, JSON.stringify(issuesOf(parsed)));
    assert.equal(settlementOf(parsed.data).status, "confirmed");
  }
  // Pendente: vencido, de hoje ou agendado (futuro).
  for (const dueDate of [yesterday, today, tomorrow, "2030-12-31"]) {
    const parsed = createCashTransactionPayloadSchema.safeParse({
      ...base, status: "pending", dueDate,
    });
    assert.ok(parsed.success, JSON.stringify(issuesOf(parsed)));
    assert.deepEqual(settlementOf(parsed.data), {status: "pending", dueDate});
  }
  // Receita pendente também.
  assert.ok(createCashTransactionPayloadSchema.safeParse({
    ...base, type: "receita", status: "pending", dueDate: tomorrow,
  }).success);
});

test("P3-F — combinações inválidas de estado e datas são recusadas em pt-BR " +
  "", () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{...base, date: tomorrow}, /confirmado não pode ter data futura/],
    [{...base, status: "confirmed", date: tomorrow}, /data futura/],
    [{...base}, /Data: obrigatória para lançamento confirmado/],
    [{...base, date: today, dueDate: tomorrow},
      /Vencimento: só em lançamento pendente/],
    [{...base, status: "pending"}, /Vencimento: obrigatório/],
    [{...base, status: "pending", dueDate: tomorrow, date: today},
      /pendente não tem data efetiva/],
    [{...base, status: "pending", dueDate: "2026-02-30"}, /data existente/],
    [{...base, status: "pending", dueDate: "1999-12-31"}, /anterior a 2000/],
    [{...base, status: "pending", dueDate: shiftDays(maxDueDayKey(), 1)},
      new RegExp(`${CASH_ENTRY_MAX_DUE_YEARS} anos à frente`)],
    [{...base, status: "agendado", dueDate: tomorrow}, /status/],
    // `isPaid` nunca vem do cliente.
    [{...base, date: today, isPaid: false}, /isPaid/],
  ];
  for (const [payload, expected] of cases) {
    const result = createCashTransactionPayloadSchema.safeParse(payload);
    assert.equal(result.success, false, JSON.stringify(payload));
    assert.ok(
      issuesOf(result).some((issue) => expected.test(issue)),
      `${JSON.stringify(payload)} → ${JSON.stringify(issuesOf(result))}`,
    );
  }
  // O limite de 10 anos é exato.
  assert.ok(createCashTransactionPayloadSchema.safeParse({
    ...base, status: "pending", dueDate: maxDueDayKey(),
  }).success);
});

test("P3-F — correção leva o estado atual; importação só confirmado", () => {
  const mutation = {
    workspaceId: WS, idempotencyKey: KEY, transactionId: "cash_x",
    expectedUpdatedAt: null, reason: "Ajuste",
  };
  const {workspaceId: _w, idempotencyKey: _k, ...entry} = base;
  void _w; void _k;
  assert.ok(updateCashTransactionPayloadSchema.safeParse({
    ...mutation, entry: {...entry, status: "pending", dueDate: tomorrow},
  }).success);
  assert.ok(updateCashTransactionPayloadSchema.safeParse({
    ...mutation, entry: {...entry, date: today},
  }).success);
  assert.equal(updateCashTransactionPayloadSchema.safeParse({
    ...mutation, entry: {...entry, status: "pending", date: today},
  }).success, false);
  // P3-J (D-30): a correção exige a conta no estado completo.
  const {cashAccountId: _a, ...withoutAccount} = entry;
  void _a;
  assert.equal(updateCashTransactionPayloadSchema.safeParse({
    ...mutation, entry: {...withoutAccount, date: today},
  }).success, false);
  // Importação: só data efetiva; estado e vencimento não existem ali. A
  // conta é do lote, não da linha.
  const line = {lineId: "l1", ...withoutAccount, date: today};
  assert.equal(cashImportItemSchema.safeParse({...line,
    cashAccountId: "acc_d29"}).success, false);
  assert.ok(cashImportItemSchema.safeParse(line).success);
  for (const extra of [{status: "pending"}, {dueDate: tomorrow}]) {
    assert.equal(cashImportItemSchema.safeParse({...line, ...extra}).success,
      false, JSON.stringify(extra));
  }
  assert.equal(
    cashImportItemSchema.safeParse({...line, date: tomorrow}).success,
    false,
  );
});

test("P5-C1 — correção exige categoryId; importação aceita sem ele", () => {
  const mutation = {
    workspaceId: WS, idempotencyKey: KEY, transactionId: "cash_x",
    expectedUpdatedAt: null, reason: "Ajuste",
  };
  const {workspaceId: _w, idempotencyKey: _k, ...entry} = base;
  void _w; void _k;
  const full = {...entry, date: today};
  const update = (candidate: Record<string, unknown>) =>
    updateCashTransactionPayloadSchema.safeParse(
      {...mutation, entry: candidate}).success;
  assert.ok(update(full));
  assert.equal(update({...full, categoryId: undefined}), false);
  assert.equal(update({...full, categoryId: "a/b"}), false);
  assert.equal(update({...full, category: "Moradia"}), false);

  const {categoryId: _c, cashAccountId: _a, ...rest} = entry;
  void _c; void _a;
  const line = {lineId: "l1", ...rest, date: today};
  assert.ok(cashImportItemSchema.safeParse(line).success);
  assert.ok(cashImportItemSchema.safeParse(
    {...line, categoryId: base.categoryId}).success);
  assert.equal(cashImportItemSchema.safeParse(
    {...line, category: "Moradia"}).success, false);
  assert.equal(cashImportItemSchema.safeParse(
    {...line, categoryId: "a/b"}).success, false);
});

test("P3-F — confirmação: data efetiva até hoje e valor liquidado", () => {
  const confirm = {
    workspaceId: WS, idempotencyKey: KEY, transactionId: "cash_x",
    expectedUpdatedAt: "2026-10-04T12:00:00.123456789Z",
    date: today, amountCents: 151_234,
  };
  assert.ok(confirmCashTransactionPayloadSchema.safeParse(confirm).success);
  assert.ok(confirmCashTransactionPayloadSchema.safeParse({
    ...confirm, paymentMethod: "Pix",
  }).success);
  // P3-J (D-30): a conta da liquidação é opcional (vale a registrada).
  assert.ok(confirmCashTransactionPayloadSchema.safeParse({
    ...confirm, cashAccountId: "acc_d29",
  }).success);
  assert.equal(confirmCashTransactionPayloadSchema.safeParse({
    ...confirm, cashAccountId: "contas/acc_d29",
  }).success, false);
  const refused: Array<[Record<string, unknown>, RegExp]> = [
    [{...confirm, date: tomorrow}, /data futura/],
    [{...confirm, amountCents: 0}, /maior que zero/],
    [{...confirm, amountCents: 10.5}, /centavos inteiros/],
    [{...confirm, reason: "x"}, /reason/],
    [{...confirm, dueDate: today}, /dueDate/],
    [{...confirm, isPaid: true}, /isPaid/],
  ];
  for (const [payload, expected] of refused) {
    const result = confirmCashTransactionPayloadSchema.safeParse(payload);
    assert.equal(result.success, false, JSON.stringify(payload));
    assert.ok(issuesOf(result).some((issue) => expected.test(issue)),
      JSON.stringify(issuesOf(result)));
  }
});

const entry = (overrides: Record<string, unknown>) => ({
  type: "despesa",
  valueCents: 150_000,
  date: "2026-10-20",
  isPaid: true,
  cashEntry: {origin: "manual", status: "confirmed"},
  ...overrides,
});

test("P3-F — caixa realizado: pendente e agendado não movem o caixa", () => {
  const zero = delta({
    incomeCents: 0, expenseCents: 0, investmentOutflowCents: 0, netCents: 0,
    transactionCount: 0,
  });
  const pending = entry({
    isPaid: false, dueDate: "2026-10-20",
    cashEntry: {origin: "manual", status: "pending"},
  });
  assert.equal(isUnsettledCashEntry(pending), true);
  assert.deepEqual(cashPeriodDeltaFor(pending), zero);
  // Receita pendente, pendente explícito (`isPaid: false`) e marca pendente
  // sozinha.
  assert.deepEqual(cashPeriodDeltaFor({...pending, type: "receita"}), zero);
  assert.deepEqual(cashPeriodDeltaFor({
    type: "despesa", valueCents: 9_900, isPaid: false, date: "2026-10-01",
  }), zero);
  assert.deepEqual(cashPeriodDeltaFor(entry({
    cashEntry: {origin: "manual", status: "pending"},
  })), zero);
  // Confirmados movem.
  assert.equal(cashPeriodDeltaFor(entry({})).netCents, -150_000);
  assert.equal(cashPeriodDeltaFor(entry({type: "receita"})).netCents, 150_000);
  // Sem `isPaid`: continua realizado (sem prova de pendência).
  assert.equal(cashPeriodDeltaFor({
    type: "receita", valueCents: 1_000, date: "2026-10-01",
  }).netCents, 1_000);
  // Pendente com valor fora do contrato não vira zero em silêncio.
  assert.throws(() => cashPeriodDeltaFor({
    type: "despesa", isPaid: false, date: "2026-10-01",
  }), CashContractViolationError);
});

test("P3-F — confirmação no mês seguinte entra no mês da data efetiva", () => {
  const pending = entry({
    isPaid: false, date: "2026-10-28", dueDate: "2026-10-28",
    cashEntry: {origin: "manual", status: "pending"},
  });
  const confirmed = entry({
    date: "2026-11-03", dueDate: "2026-10-28",
    valueCents: 151_000,
  });
  // Criar o pendente: nada.
  assert.deepEqual(cashPeriodDeltasFor(undefined, pending), {});
  // Confirmar: só o mês efetivo, com o valor liquidado.
  assert.deepEqual(cashPeriodDeltasFor(pending, confirmed), {
    "2026-11": delta({
      incomeCents: 0, expenseCents: 151_000, investmentOutflowCents: 0,
      netCents: -151_000, transactionCount: 1,
    }),
  });
  // Corrigir a data efetiva: sai de um mês e entra no outro.
  const moved = {...confirmed, date: "2026-10-31"};
  assert.deepEqual(cashPeriodDeltasFor(confirmed, moved), {
    "2026-11": delta({
      incomeCents: 0, expenseCents: -151_000, investmentOutflowCents: 0,
      netCents: 151_000, transactionCount: -1,
    }),
    "2026-10": delta({
      incomeCents: 0, expenseCents: 151_000, investmentOutflowCents: 0,
      netCents: -151_000, transactionCount: 1,
    }),
  });
  // Anular o confirmado devolve; anular o pendente não tem o que devolver.
  assert.equal(cashPeriodDeltasFor(confirmed, {...confirmed,
    voidedAt: Timestamp.now()})["2026-11"].netCents, 151_000);
  assert.deepEqual(cashPeriodDeltasFor(pending, {...pending,
    voidedAt: Timestamp.now()}), {});
  // Corrigir valor e vencimento do pendente: nada no realizado.
  assert.deepEqual(cashPeriodDeltasFor(pending, {...pending,
    valueCents: 2, dueDate: "2026-12-01", date: "2026-12-01"}), {});
});

test("P3-F — contratos de cartões e investimentos preservados", () => {
  // Parcela de cartão: vive em `credit_card_purchases` (P4); `parcelado` em
  // `transactions` é violação de contrato, pendente ou não, nunca despesa.
  for (const isPaid of [false, true]) {
    assert.throws(() => cashPeriodDeltaFor({
      type: "parcelado", valueCents: 10_000, isPaid, date: "2026-10-10",
    }), (error: unknown) => error instanceof CashContractViolationError &&
      error.field === "type");
  }
  // Anulado vale zero antes de qualquer leitura de contrato.
  assert.deepEqual(cashPeriodDeltaFor({
    type: "parcelado", valueCents: 10_000, voidedAt: Timestamp.now(),
  }), cashPeriodDeltaFor(undefined));
  // Investimento (P4-D): decide a marca `investmentEntry`, não `isPaid`.
  const investmentEntry = {
    domainVersion: 1, movementId: "mov-1", operation: "contribution",
    reversal: false, reversalOf: null, status: "settled",
    principalCents: 5_000, gainCents: 0, amountCents: 5_000, currency: "BRL",
  };
  assert.equal(cashPeriodDeltaFor({
    type: "investimento", valueCents: 5_000, isPaid: false, investmentEntry,
    date: "2026-10-10",
  }).netCents, -5_000);
  assert.equal(cashPeriodDeltaFor({
    type: "investimento", valueCents: 5_000, isPaid: true,
    investmentEntry: {...investmentEntry, status: "pending"},
    date: "2026-10-10",
  }).netCents, 0);
  // Sem marca válida: fora do contrato, violação (sem fallback, sem zero).
  assert.throws(() => cashPeriodDeltaFor({
    type: "investimento", valueCents: 5_000, isPaid: true,
    date: "2026-10-10",
  }), (error: unknown) => error instanceof CashContractViolationError &&
    error.field === "type");
  assert.throws(() => cashPeriodDeltaFor({
    type: "investimento", valueCents: 5_000, isPaid: true,
    investmentEntry: {}, date: "2026-10-10",
  }), (error: unknown) => error instanceof CashContractViolationError &&
    error.field === "marker");
});
