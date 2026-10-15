import assert from "node:assert/strict";
import test from "node:test";

import {classifyCashEntryEligibility} from "../../cash/eligibility";
import {
  cashPeriodDeltaFor,
  CashContractViolationError,
} from "../../cash/periods";
import {saoPauloDayKey} from "../../shared/dateKeys";
import {loanCashEffect, readLoanCashEntry} from "../cashEffect";
import {
  cnpjCpfSchema,
  createLoanPayloadSchema,
  registerLoanPaymentPayloadSchema,
  updateLoanMetadataPayloadSchema,
} from "../contracts";
import {loanCashEntryFor, loanCashMirrorDocument} from "../model";

/**
 * P3-G — contratos estritos e efeito de caixa do espelho de empréstimo
 * (D-13), sem Emulator.
 */

const today = saoPauloDayKey();
const base = {
  workspaceId: "ws-loans",
  idempotencyKey: "intent-loan-000000001",
  type: "borrow",
  personName: "Banco Exemplo",
  principalCents: 300_000,
  cashAccountId: "acc_emprestimo",
  startDate: today,
  firstDueDate: today,
  installments: 3,
  interest: {type: "none"},
};

const messages = (result: {success: boolean; error?: {issues: Array<{
  path: PropertyKey[]; message: string;
}>}}) => result.success ? [] :
  (result.error?.issues ?? []).map((issue) =>
    `${issue.path.join(".")}: ${issue.message}`);

test("P3-G — CPF e CNPJ: dígitos verificadores, pontuação removida", () => {
  assert.equal(cnpjCpfSchema.parse("11.222.333/0001-81"), "11222333000181");
  assert.equal(cnpjCpfSchema.parse("529.982.247-25"), "52998224725");
  for (const invalid of ["11.222.333/0001-82", "529.982.247-24",
    "111.111.111-11", "123", "abc", "1122233300018"]) {
    assert.equal(cnpjCpfSchema.safeParse(invalid).success, false, invalid);
  }
});

test("P3-G — criação: estrita, centavos inteiros, taxa inteira, datas", () => {
  assert.ok(createLoanPayloadSchema.safeParse(base).success);
  // P3-J (D-30): a conta do principal é obrigatória.
  const {cashAccountId: _account, ...noAccount} = base;
  void _account;
  assert.equal(createLoanPayloadSchema.safeParse(noAccount).success, false);
  assert.ok(createLoanPayloadSchema.safeParse({...base, interest: {
    type: "percentage", ratePpm: 19_900, ratePeriod: "annual",
    amortization: "simple",
  }}).success);
  const refused: Array<[Record<string, unknown>, RegExp]> = [
    [{...base, principalCents: 1.5}, /centavos inteiros/],
    [{...base, principalCents: 0}, /maior que zero/],
    [{...base, interest: {type: "percentage", ratePpm: 1.25,
      ratePeriod: "monthly", amortization: "price"}}, /partes por milhão/],
    [{...base, interest: {type: "percentage", ratePpm: 10_000,
      ratePeriod: "monthly"}}, /amortization/],
    [{...base, interest: {type: "fixed"}}, /totalInterestCents/],
    [{...base, interest: {type: "none", totalInterestCents: 5}}, /interest/],
    [{...base, startDate: "2999-01-01"}, /não pode ser futura/],
    [{...base, firstDueDate: "2001-01-01"}, /anterior à contratação/],
    [{...base, installments: 0}, /ao menos 1/],
    [{...base, installments: 361}, /até 360/],
    [{...base, principalCents: 2}, /1 centavo por parcela/],
    [{...base, currentBalance: 3000}, /currentBalance/],
    [{...base, principalValue: 3000}, /principalValue/],
    [{...base, createdBy: "x"}, /createdBy/],
    [{...base, loanId: "x"}, /loanId/],
    [{...base, type: "transfer"}, /type/],
  ];
  for (const [payload, pattern] of refused) {
    const result = createLoanPayloadSchema.safeParse(payload);
    assert.equal(result.success, false, JSON.stringify(payload));
    assert.ok(messages(result).some((message) => pattern.test(message)),
      `${JSON.stringify(payload)} → ${JSON.stringify(messages(result))}`);
  }
});

test("P3-G — liquidação: principal e juros separados, total positivo", () => {
  const payment = {
    workspaceId: "ws", idempotencyKey: "intent-pay-0000000001",
    loanId: "loan_x", expectedUpdatedAt: "2026-10-05T12:00:00.123456789Z",
    cashAccountId: "acc_emprestimo",
    date: today, principalCents: 100_000, interestCents: 10_000,
  };
  assert.ok(registerLoanPaymentPayloadSchema.safeParse(payment).success);
  const {cashAccountId: _payAccount, ...paymentNoAccount} = payment;
  void _payAccount;
  assert.equal(registerLoanPaymentPayloadSchema.safeParse(paymentNoAccount)
    .success, false, "liquidação sem conta");
  assert.ok(registerLoanPaymentPayloadSchema.safeParse({...payment,
    principalCents: 0}).success, "só juros");
  for (const invalid of [
    {principalCents: 0, interestCents: 0},
    {principalCents: -1},
    {interestCents: 0.5},
    {expectedUpdatedAt: null},
    {date: "2999-01-01"},
    {amountCents: 1},
    {balanceCents: 0},
    {status: "paid"},
  ]) {
    assert.equal(registerLoanPaymentPayloadSchema.safeParse({...payment,
      ...invalid}).success, false, JSON.stringify(invalid));
  }
  const metadata = {
    workspaceId: "ws", idempotencyKey: "intent-meta-000000001",
    loanId: "loan_x", expectedUpdatedAt: "2026-10-05T12:00:00Z",
  };
  assert.ok(updateLoanMetadataPayloadSchema.safeParse({...metadata,
    changes: {description: null, personName: "Outro"}}).success);
  for (const changes of [{}, {principalCents: 1}, {personName: null},
    {status: "paid"}, {interest: {type: "none"}}]) {
    assert.equal(updateLoanMetadataPayloadSchema.safeParse({...metadata,
      changes}).success, false, JSON.stringify(changes));
  }
});

const entry = (overrides: Partial<Parameters<typeof loanCashEntryFor>[0]>) =>
  loanCashEntryFor({
    loanId: "loan_x", movementId: "lmv_1", loanType: "borrow",
    kind: "payment", reversal: false, reversalOf: null,
    principalCents: 100_000, interestCents: 10_000, ...overrides,
  });

test("P3-G — efeito de caixa: principal fora do operacional, juros " +
  "financeiros, estorno simétrico", () => {
  assert.deepEqual(loanCashEffect(entry({kind: "disbursement",
    interestCents: 0})), {
    loanPrincipalInflowCents: 100_000, loanPrincipalOutflowCents: 0,
    financialIncomeCents: 0, financialExpenseCents: 0, netCents: 100_000,
  });
  assert.deepEqual(loanCashEffect(entry({loanType: "lend",
    kind: "disbursement", interestCents: 0})).netCents, -100_000);
  assert.deepEqual(loanCashEffect(entry({})), {
    loanPrincipalInflowCents: 0, loanPrincipalOutflowCents: 100_000,
    financialIncomeCents: 0, financialExpenseCents: 10_000, netCents: -110_000,
  });
  assert.deepEqual(loanCashEffect(entry({loanType: "lend"})), {
    loanPrincipalInflowCents: 100_000, loanPrincipalOutflowCents: 0,
    financialIncomeCents: 10_000, financialExpenseCents: 0, netCents: 110_000,
  });
  for (const original of [entry({}), entry({loanType: "lend"}),
    entry({kind: "disbursement", interestCents: 0})]) {
    const reversed = loanCashEffect({...original, reversal: true,
      reversalOf: "lmv_0"});
    const effect = loanCashEffect(original);
    for (const [field, value] of Object.entries(effect)) {
      assert.equal(value + reversed[field as keyof typeof reversed], 0, field);
      assert.equal(Object.is(reversed[field as keyof typeof reversed], -0),
        false);
    }
  }
});

test("P3-G — projeção: o espelho decide por `loanEntry`; marca inválida não " +
  "conta", () => {
  const mirror = loanCashMirrorDocument({
    workspaceId: "ws", profileType: "PF", actorUid: "u1", date: "2026-10-05",
    entry: entry({}), cashAccountId: "acc_1",
  });
  assert.equal(mirror.type, "despesa");
  assert.equal(mirror.valueCents, 110_000);
  assert.equal(mirror.description, "Pagamento de empréstimo");
  const delta = cashPeriodDeltaFor(mirror);
  assert.equal(delta.expenseCents, 0, "juros não são despesa operacional");
  assert.equal(delta.incomeCents, 0);
  assert.equal(delta.loanPrincipalOutflowCents, 100_000);
  assert.equal(delta.financialExpenseCents, 10_000);
  assert.equal(delta.netCents, -110_000);
  assert.equal(delta.transactionCount, 1);
  // Baixa lógica: nenhum efeito. Marcas forjadas ou incompletas: violação.
  assert.equal(cashPeriodDeltaFor({...mirror, voidedAt: "x"}).netCents, 0);
  for (const forged of [
    {...entry({}), domainVersion: 2},
    {...entry({}), principalCents: 1.5},
    {...entry({}), principalCents: -1},
    {...entry({}), kind: "adjustment"},
    {...entry({kind: "disbursement"}), interestCents: 5},
    {...entry({}), reversal: true},
    {...entry({}), principalCents: 0, interestCents: 0},
    "loan",
  ]) {
    assert.equal(readLoanCashEntry(forged), null, JSON.stringify(forged));
    assert.throws(() => cashPeriodDeltaFor({...mirror, loanEntry: forged}),
      CashContractViolationError);
  }
  // Espelho não é corrigível pelo caixa manual.
  assert.equal(classifyCashEntryEligibility(mirror, "ws").eligible, false);
  // Sem a marca, o mesmo documento seria despesa operacional comum.
  const {loanEntry: _marker, ...plain} = mirror;
  void _marker;
  assert.equal(cashPeriodDeltaFor(plain).expenseCents, 110_000);
});
