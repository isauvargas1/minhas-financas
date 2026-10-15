import assert from "node:assert/strict";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {formatIsoInstant, parseIsoInstant} from "../../shared/commitTime";
import {addDaysToDayKey, saoPauloDayKey} from "../../shared/dateKeys";
import {
  updateCashTransactionPayloadSchema,
  voidCashTransactionPayloadSchema,
} from "../contracts";
import {
  classifyCashEntryEligibility,
  PROTECTED_LINK_KEYS,
} from "../eligibility";

/**
 * Contratos da correção e da anulação e classificação de elegibilidade
 * (P3-C, D-35). Tudo que é autoritativo ou ambíguo precisa ser recusado antes
 * de qualquer leitura no Firestore.
 */
const WS = "ws-contrato";

const update = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: WS,
  idempotencyKey: "idem-edicao-0001",
  transactionId: "cash_abc",
  expectedUpdatedAt: "2026-09-15T12:00:00.123456Z",
  reason: "Valor digitado errado",
  entry: {
    type: "receita",
    description: "Salário",
    categoryId: "cat-receita-salario",
    amountCents: 620_000,
    date: "2026-09-15",
    cashAccountId: "acc_contrato",
  },
  ...overrides,
});

const voidPayload = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: WS,
  idempotencyKey: "idem-anulacao-01",
  transactionId: "cash_abc",
  expectedUpdatedAt: null,
  reason: "Lançado em duplicidade",
  ...overrides,
});

const updateOk = (payload: unknown) =>
  updateCashTransactionPayloadSchema.safeParse(payload).success;
const voidOk = (payload: unknown) =>
  voidCashTransactionPayloadSchema.safeParse(payload).success;

test("P3-C — contrato de correção aceita o estado completo e o motivo", () => {
  assert.ok(updateOk(update()));
  assert.ok(updateOk(update({expectedUpdatedAt: null})));
  assert.ok(updateOk(update({correlationId: "corr-ui-1"})));
  assert.ok(updateOk(update({
    entry: {
      type: "despesa",
      description: "Mercado",
      categoryId: "cat-despesa-casa",
      amountCents: 1,
      date: saoPauloDayKey(),
      expenseType: "Variável",
      paymentMethod: "Pix",
      supplier: "Fornecedor",
      costCenter: "Loja",
      cashAccountId: "acc_contrato",
    },
  })));
  const parsed = updateCashTransactionPayloadSchema.parse(update({
    reason: "  Ajuste  ",
  }));
  assert.equal(parsed.reason, "Ajuste");
});

test("P3-C — contrato de correção recusa autoridade, vínculo e lixo", () => {
  for (const [field, value] of [
    ["userId", "outro"],
    ["role", "owner"],
    ["createdBy", "x"],
    ["updatedAt", "2026-09-15T12:00:00Z"],
    ["cashEntry", {}],
    ["valueCents", 1],
    ["voidedAt", "x"],
    ["document", {}],
  ] as const) {
    assert.equal(updateOk(update({[field]: value})), false, `topo ${field}`);
  }
  for (const [field, value] of [
    ["valueCents", 1],
    ["value", 10],
    ["userId", "outro"],
    ["isPaid", false],
    ["source", "manual"],
    ["installments", 1],
    ["walletId", "w1"],
    ["profileType", "PJ"],
    ...PROTECTED_LINK_KEYS.map((key) => [key, "x"] as const),
  ] as const) {
    const entry = {...update().entry, [field]: value};
    assert.equal(updateOk(update({entry})), false, `entry ${field}`);
  }
  for (const entry of [
    {...update().entry, type: "investimento"},
    {...update().entry, type: "parcelado"},
    {...update().entry, amountCents: 0},
    {...update().entry, amountCents: 10.5},
    {...update().entry, amountCents: "100"},
    {...update().entry, date: addDaysToDayKey(saoPauloDayKey(), 1)},
    {...update().entry, date: "2026-02-30"},
    {...update().entry, expenseType: "Fixa"},
  ]) {
    assert.equal(updateOk(update({entry})), false, JSON.stringify(entry));
  }
  for (const overrides of [
    {reason: ""},
    {reason: "   "},
    {reason: "x".repeat(301)},
    {reason: undefined},
    {expectedUpdatedAt: undefined},
    {expectedUpdatedAt: "ontem"},
    {expectedUpdatedAt: "2026-09-15"},
    {expectedUpdatedAt: 1726401600000},
    {transactionId: "a/b"},
    {transactionId: ""},
    {workspaceId: "__x__"},
    {idempotencyKey: "curta"},
    {entry: undefined},
  ]) {
    assert.equal(
      updateOk({...update(), ...overrides}),
      false,
      JSON.stringify(overrides),
    );
  }
});

test("P3-C — anulação exige motivo e não aceita estado novo", () => {
  assert.ok(voidOk(voidPayload()));
  assert.ok(voidOk(voidPayload({
    expectedUpdatedAt: "2026-09-15T12:00:00Z",
  })));
  for (const overrides of [
    {reason: ""},
    {reason: undefined},
    {entry: update().entry},
    {voidedBy: "outro"},
    {voidedAt: "2026-09-15T12:00:00Z"},
    {amountCents: 1},
    {expectedUpdatedAt: "x"},
  ]) {
    assert.equal(
      voidOk({...voidPayload(), ...overrides}),
      false,
      JSON.stringify(overrides),
    );
  }
});

test("P3-C — versão ISO preserva nanossegundos ida e volta", () => {
  const original = new Timestamp(1_790_000_000, 123_456_789);
  const text = formatIsoInstant(original);
  assert.equal(text, "2026-09-21T14:13:20.123456789Z");
  assert.ok(parseIsoInstant(text).isEqual(original));
});

const cashEntryDoc = (overrides: Record<string, unknown> = {}) => ({
  type: "receita",
  description: "Salário",
  category: "Salário",
  valueCents: 620_000,
  date: "2026-09-15",
  isPaid: true,
  userId: "uid-autor",
  workspaceId: WS,
  profileId: WS,
  profileType: "PF",
  cashAccountId: "acc_contrato",
  cashEntry: {
    domainVersion: 1, origin: "manual", status: "confirmed",
    currency: "BRL", requestHash: "h".repeat(64),
    accountMovementId: "acm_aplicado",
  },
  ...overrides,
});

const codeOf = (data: Record<string, unknown>) => {
  const result = classifyCashEntryEligibility(data, WS);
  return result.eligible ? "eligible" : result.code;
};

test("P3-C — elegível: só o lançamento do Caixa com a marca do backend", () => {
  assert.deepEqual(classifyCashEntryEligibility(cashEntryDoc(), WS), {
    eligible: true, type: "receita", status: "confirmed",
    amountCents: 620_000, date: "2026-09-15", dueDate: null, revision: 1,
    cashAccountId: "acc_contrato", accountMovementId: "acm_aplicado",
  });
  assert.equal(
    (classifyCashEntryEligibility(cashEntryDoc({
      cashEntry: {...cashEntryDoc().cashEntry, revision: 4},
    }), WS) as {revision: number}).revision,
    4,
  );
  // Pendente criado pela callable; e confirmado vindo de pendente, com o
  // vencimento preservado.
  assert.deepEqual(classifyCashEntryEligibility(cashEntryDoc({
    isPaid: false, date: "2026-11-05", dueDate: "2026-11-05",
    cashEntry: {...cashEntryDoc().cashEntry, status: "pending",
      accountMovementId: null},
  }), WS), {
    eligible: true, type: "receita", status: "pending",
    amountCents: 620_000, date: "2026-11-05", dueDate: "2026-11-05",
    revision: 1, cashAccountId: "acc_contrato", accountMovementId: null,
  });
  // P3-J (D-30): sem conta, ou confirmado sem movimento em vigor, ou
  // pendente com movimento, é `ambiguous_account` — falha fechada.
  for (const [label, doc] of [
    ["sem conta", cashEntryDoc({cashAccountId: undefined})],
    ["conta vazia", cashEntryDoc({cashAccountId: ""})],
    ["confirmado sem movimento", cashEntryDoc({
      cashEntry: {...cashEntryDoc().cashEntry, accountMovementId: null}})],
    ["pendente com movimento", cashEntryDoc({
      isPaid: false, date: "2026-11-05", dueDate: "2026-11-05",
      cashEntry: {...cashEntryDoc().cashEntry, status: "pending"}})],
  ] as const) {
    assert.equal(codeOf(doc as Record<string, unknown>),
      "ambiguous_account", label);
  }
  assert.equal((classifyCashEntryEligibility(cashEntryDoc({
    dueDate: "2026-09-10",
  }), WS) as {dueDate: string}).dueDate, "2026-09-10");
  // P4-B: lançamento gerado por Recorrentes, com o vínculo da ocorrência, é
  // do Caixa como outro qualquer (pagar o pendente é a confirmação).
  assert.equal(codeOf(cashEntryDoc({
    cashEntry: {...cashEntryDoc().cashEntry, origin: "recurring"},
    recurringEntry: {
      domainVersion: 1, recurringExpenseId: "rec-1", occurrenceId: "occ-1",
    },
  })), "eligible");
});

test("P4-D — documento sem a marca do Caixa não é adotado", () => {
  // O caminho direto do cliente acabou (Rules) e a adoção `legacy_manual`
  // saiu com ele: receita/despesa sem `cashEntry` — o formato que o cliente
  // gravava — é recusada, e a origem `legacy_manual` não é reconhecida.
  const {cashEntry: _marker, valueCents: _cents, cashAccountId: _account,
    ...plain} = cashEntryDoc();
  void _marker; void _cents; void _account;
  for (const data of [
    plain,
    {...plain, source: "manual"},
    {...plain, isPaid: false},
    {...plain, valueCents: 15_050},
  ]) {
    assert.equal(codeOf(data), "unsupported_origin", JSON.stringify(data));
  }
  assert.equal(codeOf(cashEntryDoc({
    cashEntry: {...cashEntryDoc().cashEntry, origin: "legacy_manual"},
  })), "unsupported_origin");
});

test("P3-C — outros domínios e formatos ambíguos são recusados", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["workspace_mismatch", cashEntryDoc({workspaceId: "outro"})],
    ["workspace_mismatch", cashEntryDoc({profileId: "pf"})],
    ["voided", cashEntryDoc({voidedAt: Timestamp.now()})],
    ["voided", cashEntryDoc({
      cashEntry: {...cashEntryDoc().cashEntry, status: "voided"},
    })],
    ["unsupported_type", cashEntryDoc({type: "investimento"})],
    ["unsupported_type", cashEntryDoc({type: "parcelado"})],
    ["linked_to_other_domain", cashEntryDoc({cardId: "card-1"})],
    ["linked_to_other_domain", cashEntryDoc({loanId: "loan-1"})],
    // P4-A: o espelho de pagamento de fatura é vínculo protegido.
    ["linked_to_other_domain", cashEntryDoc({creditCardPaymentEntry: {}})],
    ["linked_to_other_domain", cashEntryDoc({investmentEntry: {}})],
    ["linked_to_other_domain", cashEntryDoc({splitEntry: {}})],
    ["linked_to_other_domain", cashEntryDoc({receivableEntry: {}})],
    ["linked_to_other_domain", cashEntryDoc({loanEntry: {}})],
    // P4-B: o vínculo `recurringEntry` só vale com a origem `recurring`, e a
    // origem `recurring` exige o vínculo.
    ["unsupported_origin", cashEntryDoc({
      recurringEntry: {
        domainVersion: 1, recurringExpenseId: "rec-1", occurrenceId: "occ-1",
      },
    })],
    ["unsupported_origin", cashEntryDoc({
      cashEntry: {...cashEntryDoc().cashEntry, origin: "recurring"},
    })],
    ["unsupported_origin", cashEntryDoc({
      cashEntry: {...cashEntryDoc().cashEntry, origin: "recurring"},
      recurringEntry: {domainVersion: 1, recurringExpenseId: "rec-1"},
    })],
    ["unsupported_origin", cashEntryDoc({
      cashEntry: {...cashEntryDoc().cashEntry, origin: "import"},
    })],
    ["unsupported_origin", cashEntryDoc({
      cashEntry: {...cashEntryDoc().cashEntry, currency: "USD"},
    })],
    ["invalid_author", cashEntryDoc({userId: ""})],
    ["invalid_author", cashEntryDoc({userId: 42})],
    // Estado e `isPaid` divergentes, ou vencimento incoerente: escritor
    // desconhecido.
    ["ambiguous_payment_state", cashEntryDoc({isPaid: false})],
    ["ambiguous_payment_state", cashEntryDoc({isPaid: undefined})],
    ["ambiguous_payment_state", cashEntryDoc({
      cashEntry: {...cashEntryDoc().cashEntry, status: "pending"},
    })],
    ["ambiguous_date", cashEntryDoc({
      isPaid: false, dueDate: "2026-09-20",
      cashEntry: {...cashEntryDoc().cashEntry, status: "pending"},
    })],
    ["ambiguous_date", cashEntryDoc({dueDate: "15/09/2026"})],
    ["ambiguous_date", cashEntryDoc({date: "15/09/2026"})],
    ["ambiguous_value", cashEntryDoc({valueCents: 10.5})],
    ["ambiguous_value", cashEntryDoc({valueCents: 0})],
    ["ambiguous_value", cashEntryDoc({valueCents: undefined})],
  ];
  for (const [expected, data] of cases) {
    assert.equal(codeOf(data), expected, JSON.stringify(data));
  }
});
