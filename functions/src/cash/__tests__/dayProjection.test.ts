import assert from "node:assert/strict";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {
  CASH_DELTA_FIELDS,
  CATEGORY_KEY_RECEIVABLES,
  CATEGORY_KEY_SPLIT,
  CATEGORY_KEY_UNCATEGORIZED,
  CashContractViolationError,
  cashDayKeyFor,
  cashDaysMatchMonth,
  cashPeriodDeltaFor,
  cashPlanPeriods,
  cashPeriodDeltasFor,
  cashPeriodKeyFor,
  cashWritePlanFor,
  categoryGenerationsFor,
  readCashDayDeltas,
  sumCashDayDeltas,
  transactionValueCents,
  type CashPeriodDelta,
  type CashProjectionState,
  type CashWritePlan,
} from "../periods";
import {CASH_ENTRY_MAX_CENTS} from "../contracts";

/**
 * P5-C1 (D-37.7, D-37.8) — plano de escrita do gatilho: o detalhe diário e
 * por categoria sai do mesmo par antes/depois que o total do mês, no fuso
 * oficial, e a soma dos dias fecha com o mês em todos os campos.
 */

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

const manual = (overrides: Record<string, unknown> = {}) => ({
  type: "despesa",
  description: "Lançamento",
  category: "Alimentação",
  categoryId: "cat_alimentacao",
  valueCents: 10_000,
  date: "2026-08-10",
  isPaid: true,
  ...overrides,
});

const monthDaysOf = (plan: CashWritePlan, period: string) =>
  plan.days[period] ?? {};

/** Σ dias = mês em todos os campos, para todo mês do plano. */
const assertParity = (plan: CashWritePlan) => {
  for (const [period, delta] of Object.entries(plan.months)) {
    assert.ok(cashDaysMatchMonth(monthDaysOf(plan, period), delta),
      `paridade de ${period}`);
  }
  // Mês só com mudança diária (dia movido no mesmo mês): os dias somam zero
  // em todos os campos, e o mês é escrito mesmo com total inalterado.
  for (const period of cashPlanPeriods(plan)) {
    if (!plan.months[period]) {
      assert.ok(cashDaysMatchMonth(monthDaysOf(plan, period),
        cashPeriodDeltaFor(undefined)), `dias de ${period} somam zero`);
    }
  }
};

const categoryTotals = (plan: CashWritePlan) => {
  let income = 0;
  let expense = 0;
  for (const entry of Object.values(plan.categories)) {
    income += entry.totals.incomeCents;
    expense += entry.totals.expenseCents;
  }
  return {income, expense};
};

const assertCategoryParity = (plan: CashWritePlan) => {
  const months = Object.values(plan.months);
  const income = months.reduce((sum, delta) => sum + delta.incomeCents, 0);
  const expense = months.reduce((sum, delta) => sum + delta.expenseCents, 0);
  assert.deepEqual(categoryTotals(plan), {income, expense},
    "Σ categorias = receita e despesa operacionais");
};

test("o dia civil é exatamente `date`: mês, ano e bissexto", () => {
  for (const day of [
    "2026-03-31", "2026-04-01", "2026-12-31", "2027-01-01",
    "2026-02-28", "2027-02-28", "2028-02-28", "2028-02-29", "2028-03-01",
  ]) {
    assert.equal(cashDayKeyFor({date: day}), day, day);
    assert.equal(cashPeriodKeyFor({date: day}), day.slice(0, 7), day);
  }
});

test("`transactionDate` remanescente é ignorado: só `date` decide", () => {
  // O instante (01/04 02:59 UTC = 31/03 23:59 BRT) e os instantes de outros
  // dias nunca competem com `date`.
  for (const stray of [
    at("2026-04-01T02:59:00.000Z"),
    at("2026-04-01T03:00:00.000Z"),
    at("2027-01-01T02:59:59.000Z"),
    at("2020-06-15T12:00:00.000Z"),
    "2026-05-05",
  ]) {
    const data = {date: "2026-03-31", transactionDate: stray};
    assert.equal(cashDayKeyFor(data), "2026-03-31");
    assert.equal(cashPeriodKeyFor(data), "2026-03");
  }
});

test("`date` ausente ou fora do formato lança violação de contrato", () => {
  const invalid: unknown[] = [
    undefined, null, "", "2026-02-30", "2026-13-01", "2026-8-1",
    "2027-02-29", "2026-08-10T00:00:00Z", " 2026-08-10", 20260810,
    at("2026-08-10T15:00:00.000Z"), new Date("2026-08-10T15:00:00.000Z"),
  ];
  for (const date of invalid) {
    assert.throws(() => cashDayKeyFor({date}), (error: unknown) =>
      error instanceof CashContractViolationError && error.field === "date",
    String(date));
    assert.throws(() => cashPeriodKeyFor({date}), CashContractViolationError);
  }
  // Sem `date`, `transactionDate` não salva o documento (sem fallback).
  assert.throws(() => cashDayKeyFor(
    {transactionDate: at("2026-08-10T15:00:00.000Z")}),
  CashContractViolationError);
  assert.throws(() => cashDayKeyFor({}), CashContractViolationError);
});

test("criação: dia, mês e categoria no mesmo plano, com paridade", () => {
  const plan = cashWritePlanFor(undefined, manual());
  assert.deepEqual(Object.keys(plan.months), ["2026-08"]);
  assert.deepEqual(plan.days["2026-08"], {
    "10": {expenseCents: 10_000, netCents: -10_000, transactionCount: 1},
  });
  assert.deepEqual(Object.keys(plan.categories), ["2026__cat_alimentacao"]);
  assert.deepEqual(plan.categories["2026__cat_alimentacao"].days,
    {"0810": {expenseCents: 10_000, expenseCount: 1}});
  assertParity(plan);
  assertCategoryParity(plan);
  // O total do mês é o mesmo do cálculo mensal anterior.
  assert.deepEqual(plan.months, cashPeriodDeltasFor(undefined, manual()));
});

test("correção de valor, dia, mês, ano e categoria sai de um lugar e entra " +
  "no outro", () => {
  const before = manual();
  const scenarios: Array<[string, Record<string, unknown>]> = [
    ["valor", {valueCents: 12_500}],
    ["dia", {date: "2026-08-20"}],
    ["mês", {date: "2026-09-01"}],
    ["ano", {date: "2027-01-02"}],
    ["categoria", {categoryId: "cat_moradia", category: "Moradia"}],
    ["tipo", {type: "receita", categoryId: "cat_salario"}],
  ];
  for (const [label, change] of scenarios) {
    const after = manual(change);
    const plan = cashWritePlanFor(before, after);
    assertParity(plan);
    assertCategoryParity(plan);
    assert.deepEqual(plan.months, cashPeriodDeltasFor(before, after), label);
  }
  // Troca de dia no mesmo mês: o mês não muda, os dias sim.
  const dayMove = cashWritePlanFor(before, manual({date: "2026-08-20"}));
  assert.deepEqual(dayMove.months, {}, "total do mês inalterado");
  assert.deepEqual(cashPlanPeriods(dayMove), ["2026-08"],
    "o mês é escrito para receber os dias");
  assert.deepEqual(dayMove.days["2026-08"], {
    "10": {expenseCents: -10_000, netCents: 10_000, transactionCount: -1},
    "20": {expenseCents: 10_000, netCents: -10_000, transactionCount: 1},
  });
  // Troca de categoria: o caixa não muda, as categorias sim.
  const categoryMove = cashWritePlanFor(before,
    manual({categoryId: "cat_moradia", category: "Moradia"}));
  assert.deepEqual(categoryMove.months, {});
  assert.deepEqual(categoryMove.days, {});
  assert.equal(
    categoryMove.categories["2026__cat_alimentacao"].totals.expenseCents,
    -10_000);
  assert.equal(categoryMove.categories["2026__cat_moradia"].totals.expenseCents,
    10_000);
  // Renomear (só o retrato do nome) não move nada.
  assert.deepEqual(cashWritePlanFor(before, manual({category: "Comida"})),
    {months: {}, days: {}, categories: {}});
});

test("pendente não move; confirmação entra na data efetiva; anulação sai",
  () => {
    const pending = manual({isPaid: false, date: "2026-08-30",
      dueDate: "2026-08-30", cashEntry: {status: "pending"}});
    assert.deepEqual(cashWritePlanFor(undefined, pending),
      {months: {}, days: {}, categories: {}});
    const confirmed = manual({date: "2026-09-02",
      cashEntry: {status: "confirmed"}});
    const confirm = cashWritePlanFor(pending, confirmed);
    assert.deepEqual(Object.keys(confirm.days["2026-09"]), ["02"]);
    assert.equal(confirm.days["2026-08"], undefined);
    assertParity(confirm);
    const voided = cashWritePlanFor(confirmed,
      {...confirmed, voidedAt: Timestamp.now()});
    assert.deepEqual(voided.days["2026-09"], {
      "02": {expenseCents: -10_000, netCents: 10_000, transactionCount: -1},
    });
    assertCategoryParity(voided);
  });

test("estorno e reentrega: a soma de criar e desfazer é zero", () => {
  const entry = manual();
  const created = cashWritePlanFor(undefined, entry);
  const removed = cashWritePlanFor(entry, undefined);
  for (const [period, delta] of Object.entries(created.months)) {
    for (const field of CASH_DELTA_FIELDS) {
      assert.equal((delta[field] + removed.months[period][field]) || 0, 0);
    }
  }
});

/** Espelhos de domínio no formato que o backend grava. */
const mirrors = {
  loanBorrowDisbursement: {
    type: "receita", valueCents: 500_000, date: "2026-08-05",
    loanEntry: {domainVersion: 1, loanId: "l1", loanMovementId: "m1",
      loanType: "borrow", kind: "disbursement", reversal: false,
      principalCents: 500_000, interestCents: 0, currency: "BRL"},
  },
  loanBorrowPayment: {
    type: "despesa", valueCents: 45_000, date: "2026-08-06",
    loanEntry: {domainVersion: 1, loanId: "l1", loanMovementId: "m2",
      loanType: "borrow", kind: "payment", reversal: false,
      principalCents: 40_000, interestCents: 5_000, currency: "BRL"},
  },
  cardPayment: {
    type: "despesa", valueCents: 30_000, date: "2026-08-07",
    creditCardPaymentEntry: {domainVersion: 1, cardId: "c1", invoiceId: "i1",
      paymentId: "p1", kind: "invoice_payment", reversal: false,
      amountCents: 30_000, currency: "BRL"},
  },
  receivable: {
    type: "receita", valueCents: 81_500, date: "2026-08-08",
    receivableEntry: {domainVersion: 1, receivableId: "r1",
      receivableMovementId: "rm1", clientId: "cl1", kind: "receipt",
      reversal: false, principalCents: 80_000, interestCents: 1_000,
      penaltyCents: 500, discountCents: 0, currency: "BRL"},
  },
  split: {
    type: "despesa", valueCents: 12_000, date: "2026-08-09",
    splitEntry: {domainVersion: 1, kind: "bill_expense", groupId: "g1",
      billId: "b1", reimbursementId: null, reversal: false, reversalOf: null,
      amountCents: 12_000, currency: "BRL"},
  },
  contribution: {
    type: "investimento", valueCents: 70_000, date: "2026-08-11",
    investmentEntry: {domainVersion: 1, movementId: "im1",
      operation: "contribution", reversal: false, reversalOf: null,
      status: "settled", principalCents: 70_000, gainCents: 0,
      amountCents: 70_000, currency: "BRL"},
  },
  redemption: {
    type: "investimento", valueCents: 22_500, date: "2026-08-12",
    investmentEntry: {domainVersion: 1, movementId: "im2",
      operation: "redemption", reversal: false, reversalOf: null,
      status: "settled", principalCents: 20_000, gainCents: 2_500,
      amountCents: 22_500, currency: "BRL"},
  },
};

/**
 * Identidade do fluxo líquido (D-37.2): receitas − despesas + resultado
 * financeiro + entradas − saídas patrimoniais − pagamento de fatura.
 */
const identity = (delta: CashPeriodDelta): number =>
  delta.incomeCents - delta.expenseCents +
  delta.financialIncomeCents - delta.financialExpenseCents +
  delta.investmentInflowCents - delta.investmentOutflowCents +
  delta.loanPrincipalInflowCents - delta.loanPrincipalOutflowCents -
  delta.creditCardPaymentCents;

test("identidade do fluxo líquido vale para todo tipo de fato", () => {
  for (const [label, doc] of Object.entries(mirrors)) {
    const delta = cashPeriodDeltaFor(doc);
    assert.notEqual(delta.netCents, 0, `${label}: move o caixa`);
    assert.equal(identity(delta), delta.netCents, label);
  }
  for (const doc of [manual(), manual({type: "receita"})]) {
    const delta = cashPeriodDeltaFor(doc);
    assert.equal(identity(delta), delta.netCents);
  }
});

test("classificação: só receita e despesa operacionais entram em categoria",
  () => {
    const keys = (doc: Record<string, unknown>) =>
      Object.values(cashWritePlanFor(undefined, doc).categories)
        .map((entry) => [entry.categoryKey, entry.classification]);
    assert.deepEqual(keys(mirrors.loanBorrowDisbursement), [],
      "principal de empréstimo não é receita");
    assert.deepEqual(keys(mirrors.loanBorrowPayment), []);
    assert.deepEqual(keys(mirrors.cardPayment), [],
      "pagamento de fatura não é despesa");
    assert.deepEqual(keys(mirrors.contribution), [], "aporte não é despesa");
    assert.deepEqual(keys(mirrors.redemption), []);
    assert.deepEqual(keys(mirrors.receivable),
      [[CATEGORY_KEY_RECEIVABLES, "receivables"]]);
    assert.deepEqual(keys(mirrors.split), [[CATEGORY_KEY_SPLIT, "split"]]);
    assert.deepEqual(keys(manual({categoryId: undefined})),
      [[CATEGORY_KEY_UNCATEGORIZED, "uncategorized"]]);
    // Texto nunca vira chave; ID com barra ou reservado não é aceito.
    assert.deepEqual(keys(manual({categoryId: "a/b"})),
      [[CATEGORY_KEY_UNCATEGORIZED, "uncategorized"]]);
    assert.deepEqual(keys(manual({categoryId: CATEGORY_KEY_SPLIT})),
      [[CATEGORY_KEY_UNCATEGORIZED, "uncategorized"]]);
    // Recebível: só o principal é receita operacional da categoria.
    const receivable = Object.values(
      cashWritePlanFor(undefined, mirrors.receivable).categories)[0];
    assert.equal(receivable.totals.incomeCents, 80_000);
    for (const doc of Object.values(mirrors)) {
      assertParity(cashWritePlanFor(undefined, doc));
      assertCategoryParity(cashWritePlanFor(undefined, doc));
    }
  });

test("leitura do detalhe diário: chave e campo inválidos não entram", () => {
  const days = readCashDayDeltas({
    "01": {incomeCents: 100, netCents: 100, transactionCount: 1},
    "32": {incomeCents: 999},
    "1": {incomeCents: 999},
    "02": {incomeCents: 1.5, netCents: 0},
  });
  assert.deepEqual(days, {
    "01": {incomeCents: 100, netCents: 100, transactionCount: 1},
  });
  assert.equal(sumCashDayDeltas(days).incomeCents, 100);
});

test("paridade dias × mês recusa divergência em qualquer campo, inclusive a " +
  "contagem de lançamentos", () => {
  const days = {
    "03": {incomeCents: 100, netCents: 100, transactionCount: 1},
    "09": {expenseCents: 40, netCents: -40, transactionCount: 1},
  };
  const month: CashPeriodDelta = {
    ...cashPeriodDeltaFor(undefined),
    incomeCents: 100, expenseCents: 40, netCents: 60, transactionCount: 2,
  };
  assert.equal(cashDaysMatchMonth(days, month), true, "controle: Σ dias = mês");
  for (const field of CASH_DELTA_FIELDS) {
    assert.equal(
      cashDaysMatchMonth(days, {...month, [field]: month[field] + 1}),
      false, `${field} divergente deve exigir reconstrução`);
  }
});

test("gerações de categoria alimentadas pelo evento (vigente e preparada)",
  () => {
    const state: CashProjectionState = {
      baselineCutoff: null, baselineRebuildId: null, lastPublishedAt: null,
      needsRebuild: false, issueCount: 0, issueMaxEventTime: null,
      categoryGeneration: "g0",
      categoryStaging: {generation: "r1", cutoff: at("2026-08-10T12:00:00Z")},
      categoryGarbage: [],
    };
    assert.deepEqual(categoryGenerationsFor(state,
      at("2026-08-10T11:59:59Z")), ["g0"], "antes do corte: base cobre");
    assert.deepEqual(categoryGenerationsFor(state,
      at("2026-08-10T12:00:00Z")), ["g0"], "no corte: base cobre");
    assert.deepEqual(categoryGenerationsFor(state,
      at("2026-08-10T12:00:01Z")), ["g0", "r1"], "depois do corte: as duas");
    assert.deepEqual(categoryGenerationsFor({...state, categoryStaging: null},
      at("2026-08-10T12:00:01Z")), ["g0"]);
  });

// ------------------------------------------------- contrato único (P5-C2)

const violationOn = (field: string) => (error: unknown): boolean =>
  error instanceof CashContractViolationError && error.field === field;

test("fora do contrato lança violação: nunca efeito zero silencioso", () => {
  const entry = mirrors.contribution.investmentEntry;
  // `parcelado` não existe em `transactions` (a compra vive em cartões).
  assert.throws(() => cashPeriodDeltaFor(manual({type: "parcelado"})),
    violationOn("type"));
  assert.throws(() => cashPeriodDeltaFor(manual({type: "transferencia"})),
    violationOn("type"));
  assert.throws(() => cashPeriodDeltaFor(manual({type: undefined})),
    violationOn("type"));
  // Investimento sem a marca; marca em outro tipo.
  assert.throws(() => cashPeriodDeltaFor(manual({type: "investimento"})),
    violationOn("type"));
  assert.throws(() => cashPeriodDeltaFor(manual({investmentEntry: entry})),
    violationOn("type"));
  assert.throws(() => cashPeriodDeltaFor(manual({
    type: "receita", investmentEntry: entry,
  })), violationOn("type"));
  // Marca de domínio ilegível, em cada domínio.
  for (const key of ["loanEntry", "creditCardPaymentEntry", "receivableEntry",
    "splitEntry", "investmentEntry"]) {
    for (const bad of [{}, null, "x", 7]) {
      assert.throws(() => cashPeriodDeltaFor(manual({[key]: bad})),
        violationOn("marker"), `${key}=${JSON.stringify(bad)}`);
    }
  }
  // `valueCents` ausente, só `value` em reais, float, negativo, texto, NaN,
  // Infinity e acima do teto seguro.
  const withoutCents: Record<string, unknown> = manual();
  delete withoutCents.valueCents;
  assert.throws(() => cashPeriodDeltaFor(withoutCents),
    violationOn("valueCents"));
  assert.throws(() => cashPeriodDeltaFor({...withoutCents, value: 100}),
    violationOn("valueCents"));
  for (const valueCents of [10.5, -1, -10_000, "10000", null, NaN, Infinity,
    9_007_199_254_740_992]) {
    assert.throws(() => cashPeriodDeltaFor(manual({valueCents})),
      violationOn("valueCents"), String(valueCents));
    assert.throws(() => transactionValueCents({valueCents}),
      violationOn("valueCents"));
  }
  // `value` em reais nunca vira centavos: com `valueCents` válido, é ignorado.
  assert.equal(cashPeriodDeltaFor(manual({value: 999})).netCents, -10_000);
  // `date` inválido é violação no plano e na chave de todo documento não
  // anulado, com efeito ou não (o pendente inclusive).
  assert.throws(() => cashWritePlanFor(undefined, manual({date: "2026-02-30"})),
    violationOn("date"));
  for (const date of ["2026-02-30", undefined, 20261010]) {
    const pendente = manual({isPaid: false, cashEntry: {status: "pending"},
      date});
    assert.throws(() => cashWritePlanFor(undefined, pendente),
      violationOn("date"), `pendente com date ${String(date)}`);
    assert.throws(() => cashPeriodDeltasFor(pendente, undefined),
      violationOn("date"));
  }
  assert.throws(() => cashPeriodDeltasFor(undefined, manual({date: undefined})),
    violationOn("date"));
  assert.throws(() => cashPeriodDeltasFor(manual({date: 20260810}), undefined),
    violationOn("date"));
  // Violação em `before` ou em `after` falha o par inteiro.
  assert.throws(() => cashWritePlanFor(manual({type: "parcelado"}), manual()),
    CashContractViolationError);
  assert.throws(() => cashWritePlanFor(manual(), manual({type: "parcelado"})),
    CashContractViolationError);
});

test("anulado e pendente valem zero; só o pendente exige valor válido", () => {
  const anulado = {voidedAt: Timestamp.now()};
  // Baixa lógica: nada é avaliado, nem o que seria violação.
  for (const data of [
    manual({...anulado, type: "parcelado"}),
    manual({...anulado, type: "investimento"}),
    manual({...anulado, valueCents: 10.5}),
    manual({...anulado, valueCents: undefined, date: "2026-02-30"}),
    manual({...anulado, loanEntry: {}}),
    manual({...anulado, investmentEntry: {}}),
  ]) {
    assert.deepEqual(cashPeriodDeltaFor(data), cashPeriodDeltaFor(undefined));
    assert.deepEqual(cashWritePlanFor(undefined, data),
      {months: {}, days: {}, categories: {}});
  }
  // Anulado com `date` inválido não lança nem no `before` nem no `after`.
  assert.deepEqual(
    cashWritePlanFor(manual({...anulado, date: "2026-13-01"}),
      manual({...anulado, date: undefined})),
    {months: {}, days: {}, categories: {}});
  // Pendente com valor válido vale zero, mesmo com `date` irrelevante.
  const pendente = manual({isPaid: false, cashEntry: {status: "pending"}});
  assert.deepEqual(cashPeriodDeltaFor(pendente), cashPeriodDeltaFor(undefined));
  assert.deepEqual(cashWritePlanFor(undefined, pendente),
    {months: {}, days: {}, categories: {}});
  assert.deepEqual(cashPeriodDeltaFor(manual({isPaid: false, type: "receita"})),
    cashPeriodDeltaFor(undefined));
  // Pendente com `valueCents` inválido ainda é violação (não vira zero).
  for (const valueCents of [undefined, 10.5, -1, "10"]) {
    assert.throws(() => cashPeriodDeltaFor(manual({isPaid: false, valueCents})),
      violationOn("valueCents"), String(valueCents));
  }
  // Pendente de tipo desconhecido também é violação.
  assert.throws(() => cashPeriodDeltaFor(manual({isPaid: false,
    type: "parcelado"})), violationOn("type"));
  // Investimento pendente/cancelado continua zero por regra do domínio.
  const entry = mirrors.contribution.investmentEntry;
  for (const status of ["pending", "cancelled"]) {
    assert.deepEqual(
      cashPeriodDeltaFor({...mirrors.contribution,
        investmentEntry: {...entry, status}}),
      cashPeriodDeltaFor(undefined), status);
  }
});

test("correção retroativa de `date` move dia, mês e ano; Σ dias = mês", () => {
  const cases: Array<[string, string, string[], string[]]> = [
    // [antes, depois, meses tocados, anos tocados]
    ["2026-12-31", "2027-01-02", ["2026-12", "2027-01"], ["2026", "2027"]],
    ["2026-08-31", "2026-09-01", ["2026-08", "2026-09"], ["2026"]],
    ["2028-02-29", "2028-03-01", ["2028-02", "2028-03"], ["2028"]],
    ["2026-08-10", "2026-08-20", [], ["2026"]],
  ];
  for (const [from, to, months, years] of cases) {
    const before = manual({date: from});
    const after = manual({date: to});
    const plan = cashWritePlanFor(before, after);
    assertParity(plan);
    assertCategoryParity(plan);
    assert.deepEqual(Object.keys(plan.months).sort(), months, `${from}→${to}`);
    assert.deepEqual(plan.months, cashPeriodDeltasFor(before, after));
    assert.deepEqual(cashPlanPeriods(plan),
      [...new Set([from.slice(0, 7), to.slice(0, 7)])].sort());
    // O dia de origem perde o lançamento; o de destino o ganha.
    const out = {expenseCents: -10_000, netCents: 10_000, transactionCount: -1};
    const into = {expenseCents: 10_000, netCents: -10_000, transactionCount: 1};
    assert.deepEqual(plan.days[from.slice(0, 7)]?.[from.slice(8, 10)], out);
    assert.deepEqual(plan.days[to.slice(0, 7)]?.[to.slice(8, 10)], into);
    // Categoria: sai do ano/dia de origem, entra no de destino.
    const key = (year: string) => `${year}__cat_alimentacao`;
    const mmdd = (day: string) => day.slice(5, 7) + day.slice(8, 10);
    assert.deepEqual(Object.keys(plan.categories).sort(), years.map(key));
    assert.deepEqual(plan.categories[key(from.slice(0, 4))].days[mmdd(from)],
      {expenseCents: -10_000, expenseCount: -1});
    assert.deepEqual(plan.categories[key(to.slice(0, 4))].days[mmdd(to)],
      {expenseCents: 10_000, expenseCount: 1});
    if (years.length === 1) {
      assert.equal(plan.categories[key(years[0])].totals.expenseCents, 0,
        "mesmo ano: o total da categoria-ano não muda");
    }
  }
  // Dezembro → janeiro: cada mês fecha por si e o total do plano é zero.
  const move = cashWritePlanFor(manual({date: "2026-12-31"}),
    manual({date: "2027-01-02"}));
  assert.equal(move.months["2026-12"].netCents, 10_000);
  assert.equal(move.months["2026-12"].transactionCount, -1);
  assert.equal(move.months["2027-01"].netCents, -10_000);
  assert.equal(move.months["2027-01"].transactionCount, 1);
  assert.equal(
    Object.values(move.months).reduce((sum, delta) => sum + delta.netCents, 0),
    0);
});

test("valor no teto do produto é aceito; um centavo acima lança violação", () => {
  // Teto da entrada de todo produtor de receita e despesa.
  const max = CASH_ENTRY_MAX_CENTS;
  const despesa = manual({valueCents: max});
  assert.equal(transactionValueCents(despesa), max);
  const delta = cashPeriodDeltaFor(despesa);
  assert.equal(delta.expenseCents, max);
  assert.equal(delta.netCents, -max);
  const receita = cashPeriodDeltaFor(
    manual({type: "receita", valueCents: max}));
  assert.equal(receita.incomeCents, max);
  assert.equal(receita.netCents, max);
  // Zero é valor válido (sem efeito monetário, mas o lançamento conta).
  assert.equal(cashPeriodDeltaFor(manual({valueCents: 0})).transactionCount, 1);
  // Plano: criar e desfazer o valor máximo fecha em zero, sem perder precisão.
  const created = cashWritePlanFor(undefined, despesa);
  assert.equal(created.months["2026-08"].expenseCents, max);
  assertParity(created);
  assert.deepEqual(cashWritePlanFor(despesa, despesa),
    {months: {}, days: {}, categories: {}});
  // Acima do teto: violação de `valueCents`, em qualquer ponto de entrada,
  // inclusive no teto seguro do JavaScript e nos espelhos com marca.
  for (const valueCents of [max + 1, Number.MAX_SAFE_INTEGER]) {
    const above = manual({valueCents});
    assert.throws(() => transactionValueCents(above), violationOn("valueCents"));
    assert.throws(() => cashPeriodDeltaFor(above), violationOn("valueCents"));
    assert.throws(() => cashWritePlanFor(undefined, above),
      violationOn("valueCents"));
    assert.throws(() => cashPeriodDeltaFor({...mirrors.cardPayment,
      valueCents}), violationOn("valueCents"));
  }
  // Espelho de investimento: o teto é o do movimento, e o valor é o da marca.
  const big = 9_000_000_000_000;
  const entry = mirrors.contribution.investmentEntry;
  assert.equal(cashPeriodDeltaFor({...mirrors.contribution, valueCents: big,
    investmentEntry: {...entry, principalCents: big, amountCents: big}})
    .investmentOutflowCents, big);
});

test("documento com marca de domínio também segue o contrato: tipo " +
  "coerente com a marca e valor válido (nunca efeito sem validação)", () => {
  const operational = [mirrors.loanBorrowPayment, mirrors.cardPayment,
    mirrors.receivable, mirrors.split];
  for (const mirror of operational) {
    for (const type of ["parcelado", "investimento", undefined]) {
      assert.throws(() => cashPeriodDeltaFor({...mirror, type}),
        violationOn("type"), `${Object.keys(mirror).join()} ${String(type)}`);
    }
    for (const valueCents of [undefined, 10.5, -1, "10"]) {
      assert.throws(() => cashPeriodDeltaFor({...mirror, valueCents}),
        violationOn("valueCents"), String(valueCents));
    }
  }
  // Investimento: `valueCents` ausente, inválido ou diferente da marca.
  for (const valueCents of [undefined, 10.5, 69_999, 70_001]) {
    assert.throws(() => cashPeriodDeltaFor({...mirrors.contribution,
      valueCents}), violationOn("valueCents"), String(valueCents));
  }
  // Anulado continua sem avaliação.
  assert.deepEqual(cashPeriodDeltaFor({...mirrors.split, type: "parcelado",
    valueCents: undefined, voidedAt: Timestamp.now()}),
  cashPeriodDeltaFor(undefined));
});

test("mudar só o `transactionDate` remanescente não gera delta", () => {
  const before = manual({transactionDate: at("2026-08-10T15:00:00.000Z")});
  const after = manual({transactionDate: at("2026-09-20T15:00:00.000Z")});
  assert.deepEqual(cashPeriodDeltasFor(before, after), {});
  assert.deepEqual(cashWritePlanFor(before, after),
    {months: {}, days: {}, categories: {}});
  // Aparecer ou sumir o campo também não move nada.
  assert.deepEqual(cashPeriodDeltasFor(manual(), after), {});
  assert.deepEqual(cashWritePlanFor(before, manual()),
    {months: {}, days: {}, categories: {}});
  // Controle: mudar `date` com o mesmo `transactionDate` move o caixa.
  const moved = cashWritePlanFor(before, manual({date: "2026-09-20",
    transactionDate: at("2026-08-10T15:00:00.000Z")}));
  assert.deepEqual(Object.keys(moved.months).sort(), ["2026-08", "2026-09"]);
});
