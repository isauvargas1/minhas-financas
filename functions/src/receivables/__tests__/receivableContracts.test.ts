import assert from "node:assert/strict";
import test from "node:test";

import {classifyCashEntryEligibility} from "../../cash/eligibility";
import {
  cashPeriodDeltaFor,
  CashContractViolationError,
} from "../../cash/periods";
import {addDaysToDayKey, saoPauloDayKey} from "../../shared/dateKeys";
import {
  readReceivableCashEntry,
  receiptCashCents,
  receivableCashEffect,
} from "../cashEffect";
import {
  createClientPayloadSchema,
  createReceivablePayloadSchema,
  receiveReceivablePayloadSchema,
  updateClientPayloadSchema,
  updateReceivablePayloadSchema,
} from "../contracts";
import {
  balanceOf,
  deriveReceivableStatus,
  isConsistentReceivableState,
  isReceivableOverdue,
  receivableCashEntryFor,
  receivableCashMirrorDocument,
  type ReceivableFinancialState,
} from "../model";

/**
 * P3-I — contratos estritos, invariantes D-39, atraso derivado e efeito de
 * caixa do espelho de recebimento, sem Emulator.
 */

const today = saoPauloDayKey();
const version = "2026-10-05T12:00:00.123456789Z";

const messages = (result: {success: boolean; error?: {issues: Array<{
  path: PropertyKey[]; message: string;
}>}}) => result.success ? [] :
  (result.error?.issues ?? []).map((issue) =>
    `${issue.path.join(".")}: ${issue.message}`);

const expectRefused = (
  schema: {safeParse: (value: unknown) => {success: boolean}},
  cases: Array<[Record<string, unknown>, RegExp]>,
) => {
  for (const [payload, pattern] of cases) {
    const result = schema.safeParse(payload) as Parameters<typeof messages>[0];
    assert.equal(result.success, false, JSON.stringify(payload));
    assert.ok(messages(result).some((message) => pattern.test(message)),
      `${JSON.stringify(payload)} → ${JSON.stringify(messages(result))}`);
  }
};

test("P3-I — cliente: nome obrigatório, dados pessoais normalizados, " +
  "estrito", () => {
  const base = {workspaceId: "ws", idempotencyKey: "intent-client-00000001",
    name: "  Comercial Exemplo  "};
  const parsed = createClientPayloadSchema.parse({...base,
    document: "529.982.247-25", email: " Contato@Exemplo.COM ",
    phone: "(11) 98765-4321", notes: "Linha 1\nLinha 2"});
  assert.equal(parsed.name, "Comercial Exemplo");
  assert.equal(parsed.document, "52998224725");
  assert.equal(parsed.email, "contato@exemplo.com");
  assert.equal(parsed.notes, "Linha 1\nLinha 2");
  expectRefused(createClientPayloadSchema, [
    [{...base, name: "   "}, /Nome: valor obrigatório/],
    [{...base, name: "x".repeat(121)}, /Nome: até 120/],
    [{...base, document: "529.982.247-24"}, /document/],
    [{...base, email: "sem-arroba"}, /E-mail: inválido/],
    [{...base, phone: "1234"}, /Telefone/],
    [{...base, phone: "abc-defg-hijk"}, /Telefone/],
    [{...base, address: "Rua\u0007"}, /Endereço: inválido/],
    [{...base, notes: "x".repeat(1001)}, /Observações: até 1000/],
    // Nada autoritativo vem do cliente; nem os campos do modelo antigo.
    [{...base, status: "archived"}, /status/],
    [{...base, createdBy: "u"}, /createdBy/],
    [{...base, clientId: "cli_x"}, /clientId/],
    [{...base, cnpj: "11222333000181"}, /cnpj/],
    [{...base, description: "x"}, /description/],
  ]);

  const update = {workspaceId: "ws", idempotencyKey: "intent-client-00000002",
    clientId: "cli_x", expectedUpdatedAt: version};
  assert.ok(updateClientPayloadSchema.safeParse({...update,
    changes: {email: null, notes: null, name: "Outro"}}).success);
  for (const changes of [{}, {name: null}, {status: "archived"},
    {document: "123"}, {createdBy: "u"}]) {
    assert.equal(updateClientPayloadSchema.safeParse({...update, changes})
      .success, false, JSON.stringify(changes));
  }
  assert.equal(updateClientPayloadSchema.safeParse({...update,
    expectedUpdatedAt: "ontem", changes: {name: "x"}}).success, false);
});

test("P3-I — recebível: centavos inteiros, vencimento futuro permitido, " +
  "nenhum campo autoritativo", () => {
  const base = {workspaceId: "ws", idempotencyKey: "intent-rcv-0000000001",
    clientId: "cli_x", description: "Consultoria", amountCents: 100_000,
    dueDate: addDaysToDayKey(today, 90)};
  assert.ok(createReceivablePayloadSchema.safeParse(base).success);
  assert.ok(createReceivablePayloadSchema.safeParse({...base,
    dueDate: "2001-01-01", category: "Serviços"}).success, "vencido");
  expectRefused(createReceivablePayloadSchema, [
    [{...base, amountCents: 1000.5}, /centavos inteiros/],
    [{...base, amountCents: 0}, /maior que zero/],
    [{...base, amountCents: 100_000_000_001}, /máximo/],
    [{...base, dueDate: "2026-02-30"}, /data existente/],
    [{...base, dueDate: "1999-12-31"}, /anterior a 2000/],
    [{...base, dueDate: addDaysToDayKey(today, 3660 + 366)}, /10 anos/],
    [{...base, value: 1000}, /value/],
    [{...base, status: "pending"}, /status/],
    [{...base, balanceCents: 1}, /balanceCents/],
    [{...base, paymentDate: today}, /paymentDate/],
    [{...base, createdBy: "u"}, /createdBy/],
  ]);

  const update = {workspaceId: "ws", idempotencyKey: "intent-rcv-0000000002",
    receivableId: "rcv_x", expectedUpdatedAt: version};
  assert.ok(updateReceivablePayloadSchema.safeParse({...update,
    changes: {category: null, dueDate: today, amountCents: 50_000}}).success);
  for (const changes of [{}, {description: null}, {status: "received"},
    {balanceCents: 0}, {principalReceivedCents: 1}, {clientId: "cli_y"},
    {updatedAt: version}, {amountCents: -1}]) {
    assert.equal(updateReceivablePayloadSchema.safeParse({...update, changes})
      .success, false, JSON.stringify(changes));
  }
});

test("P3-I — recebimento: componentes explícitos, algum efeito, data não " +
  "futura", () => {
  const base = {workspaceId: "ws", idempotencyKey: "intent-rcv-0000000003",
    receivableId: "rcv_x", expectedUpdatedAt: version, principalCents: 90_000,
    interestCents: 0, penaltyCents: 0, discountCents: 10_000,
    paymentDate: today, cashAccountId: "acc_recebimento"};
  assert.ok(receiveReceivablePayloadSchema.safeParse(base).success);
  for (const only of [{principalCents: 1}, {interestCents: 1},
    {penaltyCents: 1}]) {
    assert.ok(receiveReceivablePayloadSchema.safeParse({...base,
      principalCents: 0, discountCents: 0, ...only}).success,
    JSON.stringify(only));
  }
  // P3-J (D-30): só desconto não move conta e não a informa; com dinheiro,
  // a conta é obrigatória.
  const {cashAccountId: _account, ...noAccount} = base;
  void _account;
  assert.ok(receiveReceivablePayloadSchema.safeParse({...noAccount,
    principalCents: 0, discountCents: 1}).success, "só desconto");
  expectRefused(receiveReceivablePayloadSchema, [
    [noAccount, /informe a conta/],
    [{...base, principalCents: 0, discountCents: 1}, /só com desconto/],
  ]);
  expectRefused(receiveReceivablePayloadSchema, [
    [{...base, principalCents: 0, discountCents: 0}, /maior que zero/],
    [{...base, principalCents: -1}, /não pode ser negativo/],
    [{...base, interestCents: 0.1}, /centavos inteiros/],
    [{...base, paymentDate: addDaysToDayKey(today, 1)}, /não pode ser futura/],
    [{...base, principalCents: 60_000_000_000,
      interestCents: 60_000_000_000}, /máximo/],
    [{...base, amountCents: 1}, /amountCents/],
    [{...base, status: "paid"}, /status/],
    [{...base, value: 900}, /value/],
  ]);
  const {penaltyCents: _penalty, ...missing} = base;
  void _penalty;
  assert.equal(receiveReceivablePayloadSchema.safeParse(missing).success,
    false, "componente omitido");
});

const state = (
  overrides: Partial<ReceivableFinancialState> = {},
): ReceivableFinancialState => ({
  amountCents: 100_000,
  principalReceivedCents: 0,
  discountGrantedCents: 0,
  interestReceivedCents: 0,
  penaltyReceivedCents: 0,
  balanceCents: 100_000,
  activeReceiptCount: 0,
  status: "open",
  ...overrides,
});

test("P3-I — invariantes D-39: saldo, status derivado, cancelado terminal",
  () => {
    assert.equal(balanceOf(state({principalReceivedCents: 90_000,
      discountGrantedCents: 10_000})), 0);
    assert.equal(deriveReceivableStatus(false, 1), "open");
    assert.equal(deriveReceivableStatus(false, 0), "received");
    assert.equal(deriveReceivableStatus(true, 0), "cancelled");
    assert.equal(deriveReceivableStatus(true, 5), "cancelled");

    assert.ok(isConsistentReceivableState(state()));
    assert.ok(isConsistentReceivableState(state({principalReceivedCents:
      90_000, discountGrantedCents: 10_000, interestReceivedCents: 500,
    balanceCents: 0, activeReceiptCount: 1, status: "received"})));
    assert.ok(isConsistentReceivableState(state({status: "cancelled"})));
    for (const broken of [
      state({balanceCents: 99_999}),
      state({balanceCents: 0}),
      state({principalReceivedCents: 100_000, balanceCents: 0}),
      state({principalReceivedCents: 60_000, discountGrantedCents: 50_000,
        balanceCents: -10_000}),
      state({status: "overdue" as never}),
      state({status: "pending" as never}),
      state({status: "paid" as never}),
      state({status: "cancelled", activeReceiptCount: 1,
        principalReceivedCents: 1, balanceCents: 99_999}),
      state({amountCents: 1000.5, balanceCents: 1000.5}),
      state({amountCents: 0, balanceCents: 0}),
    ]) {
      assert.equal(isConsistentReceivableState(broken), false,
        JSON.stringify(broken));
    }
  });

test("P3-I — atraso derivado: só em aberto com vencimento antes de hoje " +
  "(datas civis, sem fuso)", () => {
  const due = (dueDate: string, status: ReceivableFinancialState["status"] =
  "open") => ({status, dueDate});
  assert.equal(isReceivableOverdue(due("2026-10-04"), "2026-10-05"), true);
  assert.equal(isReceivableOverdue(due("2026-10-05"), "2026-10-05"), false,
    "vence hoje: ainda em dia");
  assert.equal(isReceivableOverdue(due("2026-10-06"), "2026-10-05"), false);
  assert.equal(isReceivableOverdue(due("2026-10-04", "received"),
    "2026-10-05"), false);
  assert.equal(isReceivableOverdue(due("2026-10-04", "cancelled"),
    "2026-10-05"), false);
  // Virada de ano e de mês por comparação lexicográfica de `YYYY-MM-DD`.
  assert.equal(isReceivableOverdue(due("2025-12-31"), "2026-01-01"), true);
});

const entry = (overrides: Partial<Parameters<
  typeof receivableCashEntryFor>[0]> = {}) => receivableCashEntryFor({
  receivableId: "rcv_x", movementId: "rmv_1", clientId: "cli_x",
  reversal: false, reversalOf: null, principalCents: 90_000,
  interestCents: 1_500, penaltyCents: 500, discountCents: 10_000,
  ...overrides,
});

test("P3-I — efeito de caixa: principal operacional, juros e multa " +
  "financeiros, desconto fora do caixa, estorno simétrico", () => {
  assert.equal(receiptCashCents(entry()), 92_000);
  assert.deepEqual(receivableCashEffect(entry()), {
    incomeCents: 90_000, financialIncomeCents: 2_000, netCents: 92_000,
  });
  const reversed = receivableCashEffect(entry({reversal: true,
    reversalOf: "rmv_1"}));
  assert.deepEqual(reversed, {
    incomeCents: -90_000, financialIncomeCents: -2_000, netCents: -92_000,
  });
  // `-0` não aparece.
  const onlyInterest = receivableCashEffect(entry({principalCents: 0,
    penaltyCents: 0, discountCents: 0, reversal: true, reversalOf: "rmv_1"}));
  assert.equal(Object.is(onlyInterest.incomeCents, -0), false);
});

test("P3-I — projeção: o espelho decide por `receivableEntry`; marca " +
  "inválida não conta; não consome a quota manual", () => {
  const mirror = receivableCashMirrorDocument({workspaceId: "ws",
    actorUid: "u1", date: "2026-10-05", entry: entry(),
    cashAccountId: "acc_1"});
  assert.equal(mirror.type, "receita");
  assert.equal(mirror.valueCents, 92_000, "desconto não entra no caixa");
  assert.equal(mirror.description, "Recebimento de recebível");
  assert.equal(JSON.stringify(mirror).includes("cli_x"), true,
    "só o ID do cliente, nunca nome ou documento");
  const delta = cashPeriodDeltaFor(mirror);
  assert.equal(delta.incomeCents, 90_000);
  assert.equal(delta.financialIncomeCents, 2_000);
  assert.equal(delta.expenseCents, 0);
  assert.equal(delta.netCents, 92_000);
  assert.equal(delta.transactionCount, 1);

  const reversal = receivableCashMirrorDocument({workspaceId: "ws",
    actorUid: "u1", date: "2026-10-06",
    entry: entry({reversal: true, reversalOf: "rmv_1"}),
    cashAccountId: "acc_1"});
  assert.equal(reversal.type, "despesa");
  const back = cashPeriodDeltaFor(reversal);
  assert.equal(back.expenseCents, 0, "estorno não é despesa operacional");
  assert.equal(back.incomeCents + delta.incomeCents, 0);
  assert.equal(back.netCents + delta.netCents, 0);

  for (const forged of [
    {...entry(), domainVersion: 2},
    {...entry(), principalCents: 1.5},
    {...entry(), discountCents: -1},
    {...entry(), kind: "settlement"},
    {...entry(), currency: "USD"},
    {...entry(), reversal: true},
    {...entry(), principalCents: 0, interestCents: 0, penaltyCents: 0},
    {...entry(), clientId: ""},
    "receivable",
  ]) {
    assert.equal(readReceivableCashEntry(forged), null, JSON.stringify(forged));
    assert.throws(() => cashPeriodDeltaFor({...mirror,
      receivableEntry: forged}), CashContractViolationError);
  }
  assert.equal(cashPeriodDeltaFor({...mirror, voidedAt: "x"}).netCents, 0);
  assert.equal(classifyCashEntryEligibility(mirror, "ws").eligible, false);
  // Sem a marca, o mesmo documento seria receita operacional de R$ 920.
  const {receivableEntry: _marker, ...plain} = mirror;
  void _marker;
  assert.equal(cashPeriodDeltaFor(plain).incomeCents, 92_000);
});
