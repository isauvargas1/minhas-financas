import assert from "node:assert/strict";
import test from "node:test";

import {
  LoanScheduleError,
  addMonthsToDayKey,
  buildLoanSchedule,
  deriveLoanStatus,
  monthlyRateFraction,
  pricePaymentCents,
  roundHalfUp,
  type LoanInterestTerms,
} from "../schedule";

/**
 * P3-G — motor de amortização (D-13). Os vetores esperados vêm de uma
 * implementação independente em `decimal.Decimal` (Python, precisão 80,
 * ROUND_HALF_UP), não deste código; os valores de referência da Price
 * coincidem com as tabelas usuais (R$ 10.000 a 1% a.m. em 12 meses:
 * prestação de R$ 888,49).
 */

const sum = (values: number[]) =>
  values.reduce((total, value) => total + value, 0);

const schedule = (
  principalCents: number,
  installments: number,
  interest: LoanInterestTerms,
  firstDueDate = "2026-11-10",
) => buildLoanSchedule({principalCents, installments, firstDueDate, interest});

const percentage = (
  ratePpm: number,
  amortization: "price" | "sac" | "simple",
  ratePeriod: "monthly" | "annual" = "monthly",
): LoanInterestTerms =>
  ({type: "percentage", ratePpm, ratePeriod, amortization});

test("P3-G — arredondamento meio para cima e taxa racional", () => {
  assert.equal(roundHalfUp(BigInt(5), BigInt(10)), BigInt(1));
  assert.equal(roundHalfUp(BigInt(4), BigInt(10)), BigInt(0));
  assert.equal(roundHalfUp(BigInt(15), BigInt(10)), BigInt(2));
  assert.equal(roundHalfUp(BigInt(921_151 * 10_000), BigInt(1_000_000)),
    BigInt(9_212));
  assert.throws(() => roundHalfUp(BigInt(-1), BigInt(10)), LoanScheduleError);
  // Anual nominal → mensal proporcional, sem arredondar a taxa.
  assert.deepEqual(monthlyRateFraction(250_000, "annual"),
    {num: BigInt(250_000), den: BigInt(12_000_000)});
  assert.deepEqual(monthlyRateFraction(19_900, "monthly"),
    {num: BigInt(19_900), den: BigInt(1_000_000)});
});

test("P3-G — Price: prestação, juros sobre o saldo e última " +
  "parcela exata", () => {
  assert.equal(
    pricePaymentCents(1_000_000, 12, monthlyRateFraction(10_000, "monthly")),
    BigInt(88_849),
  );
  const plan = schedule(1_000_000, 12, percentage(10_000, "price"));
  const items = plan.installments;
  assert.equal(items.length, 12);
  assert.deepEqual(
    [items[0].principalCents, items[0].interestCents, items[0].totalCents],
    [78_849, 10_000, 88_849],
  );
  assert.deepEqual(
    [items[1].principalCents, items[1].interestCents],
    [79_637, 9_212],
  );
  // Última: amortiza o saldo restante exato (resíduo de arredondamento).
  assert.deepEqual(
    [items[11].principalCents, items[11].interestCents, items[11].totalCents],
    [87_967, 880, 88_847],
  );
  assert.equal(sum(items.map((item) => item.principalCents)), 1_000_000);
  assert.equal(plan.totalInterestCents, 66_186);
  // Prestações intermediárias constantes.
  for (const item of items.slice(0, 11)) assert.equal(item.totalCents, 88_849);

  // Taxa anual nominal de 12% = 1% ao mês proporcional: mesmo cronograma.
  assert.deepEqual(
    schedule(1_000_000, 12, percentage(120_000, "price", "annual")),
    plan,
  );

  const other = schedule(500_000, 24, percentage(19_900, "price"));
  assert.deepEqual(
    [other.installments[0].principalCents, other.installments[0].interestCents],
    [16_456, 9_950],
  );
  assert.deepEqual(
    [other.installments[23].principalCents,
      other.installments[23].interestCents],
    [25_880, 515],
  );
  assert.equal(other.totalInterestCents, 133_733);
});

test("P3-G — SAC: amortização constante pelo maior resto, juros " +
  "decrescentes", () => {
  const plan = schedule(1_000_000, 3, percentage(20_000, "sac"));
  assert.deepEqual(
    plan.installments.map((item) => [item.principalCents, item.interestCents]),
    [[333_334, 20_000], [333_333, 13_333], [333_333, 6_667]],
  );
  assert.equal(plan.totalInterestCents, 40_000);
  const totals = plan.installments.map((item) => item.totalCents);
  assert.ok(totals[0] > totals[1] && totals[1] > totals[2]);

  // Anual nominal de 10% → 10%/12 ao mês, sem arredondar a taxa.
  assert.deepEqual(
    schedule(1_200_000, 2, percentage(100_000, "sac", "annual")).installments
      .map((item) => [item.principalCents, item.interestCents]),
    [[600_000, 10_000], [600_000, 5_000]],
  );
  // 25% a.a. sobre R$ 1.000: 2.083 centavos (a taxa arredondada para 2,08%
  // daria 2.080 — a conversão não pode arredondar antes do valor).
  assert.equal(
    schedule(100_000, 1, percentage(250_000, "sac", "annual"))
      .installments[0].interestCents,
    2_083,
  );
});

test("P3-G — simples: juros sobre o principal original, sem juros " +
  "sobre juros", () => {
  const plan = schedule(100_000, 3, percentage(15_000, "simple"));
  assert.deepEqual(
    plan.installments.map((item) => [item.principalCents, item.interestCents]),
    [[33_334, 1_500], [33_333, 1_500], [33_333, 1_500]],
  );
  assert.equal(plan.totalInterestCents, 4_500);
  // Total arredondado uma vez e dividido pelo maior resto: 1.001 em 3.
  const remainder = schedule(100_100, 3, percentage(3_333, "simple"));
  assert.equal(remainder.totalInterestCents, 1_001);
  assert.deepEqual(
    remainder.installments.map((item) => item.interestCents),
    [334, 334, 333],
  );
});

test("P3-G — juros fixos e sem juros: maior resto, nenhum centavo " +
  "a mais ou a menos", () => {
  const fixed = schedule(100_001, 4,
    {type: "fixed", totalInterestCents: 10_002});
  assert.deepEqual(
    fixed.installments.map((item) => [item.principalCents, item.interestCents]),
    [[25_001, 2_501], [25_000, 2_501], [25_000, 2_500], [25_000, 2_500]],
  );
  assert.equal(fixed.totalInterestCents, 10_002);
  const none = schedule(1_000, 3, {type: "none"});
  assert.deepEqual(
    none.installments.map((item) => [item.principalCents, item.interestCents]),
    [[334, 0], [333, 0], [333, 0]],
  );
  assert.equal(none.totalInterestCents, 0);
  // Parcela única.
  assert.deepEqual(schedule(7, 1, {type: "none"}).installments[0],
    {number: 1, dueDate: "2026-11-10", principalCents: 7, interestCents: 0,
      totalCents: 7});
});

test("P3-G — invariantes em escala: 360 parcelas, valor máximo, " +
  "todos os modelos", () => {
  const models: LoanInterestTerms[] = [
    {type: "none"},
    {type: "fixed", totalInterestCents: 99_999_999_999},
    percentage(10_000, "price"),
    percentage(999_999, "price"),
    percentage(10_000, "sac"),
    percentage(1_000_000, "simple", "annual"),
  ];
  for (const model of models) {
    for (const [principal, count] of [
      [100_000_000_000, 360], [1, 1], [360, 360], [1_000_003, 7],
    ]) {
      const plan = schedule(principal, count, model);
      assert.equal(plan.installments.length, count);
      assert.equal(
        sum(plan.installments.map((item) => item.principalCents)),
        principal,
        `${JSON.stringify(model)} ${principal}/${count}`,
      );
      assert.equal(
        sum(plan.installments.map((item) => item.interestCents)),
        plan.totalInterestCents,
      );
      for (const item of plan.installments) {
        assert.ok(Number.isSafeInteger(item.principalCents) &&
          item.principalCents >= 0);
        assert.ok(Number.isSafeInteger(item.interestCents) &&
          item.interestCents >= 0);
        assert.equal(item.totalCents, item.principalCents + item.interestCents);
      }
    }
  }
  const big = schedule(100_000_000_000, 360, percentage(10_000, "price"));
  assert.deepEqual(
    [big.installments[0].totalCents, big.installments[359].principalCents,
      big.installments[359].interestCents],
    [1_028_612_597, 1_018_428_048, 10_184_280],
  );
});

test("P3-G — cronograma: datas civis mensais, fim de mês e ano " +
  "bissexto", () => {
  assert.equal(addMonthsToDayKey("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonthsToDayKey("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonthsToDayKey("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonthsToDayKey("2026-01-31", 2), "2026-03-31");
  assert.equal(addMonthsToDayKey("2026-05-31", 13), "2027-06-30");
  const plan = schedule(300, 3, {type: "none"}, "2026-01-31");
  assert.deepEqual(plan.installments.map((item) => item.dueDate),
    ["2026-01-31", "2026-02-28", "2026-03-31"]);
  assert.equal(plan.maturityDate, "2026-03-31");
  assert.equal(plan.installments[0].number, 1);
  assert.equal(plan.installments[2].number, 3);
});

test("P3-G — entradas inválidas falham alto", () => {
  for (const input of [
    {principalCents: 0, installments: 1},
    {principalCents: 10.5, installments: 1},
    {principalCents: 100, installments: 0},
    {principalCents: 100, installments: 361},
    // Menos de um centavo de principal por parcela.
    {principalCents: 359, installments: 360},
  ]) {
    assert.throws(() => buildLoanSchedule({...input, firstDueDate: "2026-01-01",
      interest: {type: "none"}}), LoanScheduleError);
  }
  assert.throws(() => schedule(100, 1, percentage(0, "price")),
    LoanScheduleError);
  assert.throws(() => schedule(100, 1, percentage(1_000_001, "price")),
    LoanScheduleError);
  assert.throws(() => schedule(100, 1, {type: "fixed", totalInterestCents: 0}),
    LoanScheduleError);
  assert.throws(() => schedule(100, 1, {type: "none"}, "2026-02-30"),
    LoanScheduleError);
});

test("P3-G — status derivado: pago, cancelado, em dia e em atraso", () => {
  const plan = [
    {dueDate: "2026-10-10", principalCents: 400},
    {dueDate: "2026-11-10", principalCents: 300},
    {dueDate: "2026-12-10", principalCents: 300},
  ];
  const base = {cancelled: false, schedule: plan};
  assert.deepEqual(deriveLoanStatus({...base, balanceCents: 1_000,
    totalPrincipalSettledCents: 0, today: "2026-10-10"}),
  {status: "active", overdueFrom: "2026-10-11"});
  // Venceu ontem e nada foi pago: atraso.
  assert.deepEqual(deriveLoanStatus({...base, balanceCents: 1_000,
    totalPrincipalSettledCents: 0, today: "2026-10-11"}),
  {status: "overdue", overdueFrom: "2026-10-11"});
  // Primeira parcela coberta: em dia até a segunda vencer.
  assert.deepEqual(deriveLoanStatus({...base, balanceCents: 600,
    totalPrincipalSettledCents: 400, today: "2026-11-10"}),
  {status: "active", overdueFrom: "2026-11-11"});
  // Pagamento parcial do principal não evita o atraso.
  assert.equal(deriveLoanStatus({...base, balanceCents: 601,
    totalPrincipalSettledCents: 399, today: "2026-10-11"}).status, "overdue");
  // Antecipação adia o atraso.
  assert.deepEqual(deriveLoanStatus({...base, balanceCents: 300,
    totalPrincipalSettledCents: 700, today: "2026-12-01"}),
  {status: "active", overdueFrom: "2026-12-11"});
  assert.deepEqual(deriveLoanStatus({...base, balanceCents: 0,
    totalPrincipalSettledCents: 1_000, today: "2027-12-01"}),
  {status: "paid", overdueFrom: null});
  assert.deepEqual(deriveLoanStatus({...base, cancelled: true,
    balanceCents: 1_000,
    totalPrincipalSettledCents: 0, today: "2027-12-01"}),
  {status: "cancelled", overdueFrom: null});
  assert.throws(() => deriveLoanStatus({...base, balanceCents: 1,
    totalPrincipalSettledCents: 1_000, today: "2027-12-01"}),
  LoanScheduleError);
});
