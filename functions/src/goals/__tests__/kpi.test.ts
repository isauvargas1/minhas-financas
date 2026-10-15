import assert from "node:assert/strict";
import test from "node:test";

import {saoPauloDayKey} from "../../shared/dateKeys";
import {
  evaluateGoalKpi,
  kpiWindowFor,
  marginBasisPoints,
  MAX_KPI_MONTHS,
  sumPeriods,
  type PeriodTotals,
} from "../kpi";

/**
 * Indicadores PJ (D-31.3) sem Emulator: janela civil de São Paulo, margem em
 * pontos-base com aritmética inteira e a escolha de componentes por tipo.
 * A exclusão de pendentes, empréstimos, fatura e investimentos é provada de
 * ponta a ponta em `goalsP5b.integration.test.ts`.
 */

const window = (period: string, today: string, startDate = "2026-01-01",
  deadline = "2026-12-31") => kpiWindowFor(
  {period: period as never, startDate, deadline}, today,
);

test("períodos civis correntes: mensal, trimestral, semestral e anual", () => {
  const cases: [string, string, string, string, number][] = [
    ["mensal", "2026-02-14", "2026-02-01", "2026-02-28", 1],
    ["mensal", "2024-02-14", "2024-02-01", "2024-02-29", 1],
    ["trimestral", "2026-05-31", "2026-04-01", "2026-06-30", 3],
    ["trimestral", "2026-12-01", "2026-10-01", "2026-12-31", 3],
    ["semestral", "2026-06-30", "2026-01-01", "2026-06-30", 6],
    ["semestral", "2026-07-01", "2026-07-01", "2026-12-31", 6],
    ["anual", "2026-03-03", "2026-01-01", "2026-12-31", 12],
  ];
  for (const [period, today, start, end, months] of cases) {
    const result = window(period, today);
    assert.ok(result.ok, `${period} ${today}`);
    assert.equal(result.window.startDate, start, `${period} ${today}`);
    assert.equal(result.window.endDate, end, `${period} ${today}`);
    assert.equal(result.window.months.length, months);
  }
  const semester = window("semestral", "2026-09-09");
  assert.ok(semester.ok);
  assert.deepEqual(semester.window.months,
    ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
});

test("a virada do mês segue America/Sao_Paulo, não UTC", () => {
  // 02:30 UTC de 1º de setembro ainda é 31 de agosto em São Paulo.
  const today = saoPauloDayKey(new Date("2026-09-01T02:30:00.000Z"));
  assert.equal(today, "2026-08-31");
  const result = window("mensal", today);
  assert.ok(result.ok);
  assert.deepEqual(result.window.months, ["2026-08"]);
});

test("período personalizado: só meses inteiros, até 36 meses", () => {
  const aligned = window("custom", "2026-09-09", "2026-02-01", "2026-04-30");
  assert.ok(aligned.ok);
  assert.deepEqual(aligned.window.months, ["2026-02", "2026-03", "2026-04"]);
  const leap = window("custom", "2026-09-09", "2024-01-01", "2024-02-29");
  assert.ok(leap.ok);
  for (const [start, end] of [
    ["2026-02-02", "2026-04-30"], ["2026-02-01", "2026-04-29"],
    ["2026-02-15", "2026-02-20"], ["2025-01-01", "2025-02-28T"],
  ]) {
    const partial = window("custom", "2026-09-09", start, end);
    assert.equal(partial.ok, false, `${start}..${end}`);
    assert.equal(!partial.ok && partial.reason,
      "custom_period_not_month_aligned");
  }
  const exactly36 = window("custom", "2026-09-09", "2024-01-01", "2026-12-31");
  assert.ok(exactly36.ok);
  assert.equal(exactly36.window.months.length, MAX_KPI_MONTHS);
  const tooLong = window("custom", "2026-09-09", "2024-01-01", "2027-01-31");
  assert.equal(!tooLong.ok && tooLong.reason, "period_too_long");
  const missing = window(undefined as never, "2026-09-09");
  assert.equal(!missing.ok && missing.reason, "period_missing");
});

test("margem em pontos-base: inteira, meio-para-longe-do-zero", () => {
  assert.equal(marginBasisPoints(70_000, 90_000), 7_778);
  assert.equal(marginBasisPoints(1, 3), 3_333);
  assert.equal(marginBasisPoints(2, 3), 6_667);
  assert.equal(marginBasisPoints(-1, 3), -3_333);
  assert.equal(marginBasisPoints(-2, 3), -6_667);
  assert.equal(marginBasisPoints(1, 20_000), 1, "0,5 pb arredonda para 1");
  assert.equal(marginBasisPoints(-1, 20_000), -1, "simétrico no negativo");
  assert.equal(marginBasisPoints(1, 20_001), 0);
  assert.equal(marginBasisPoints(0, 5), 0);
  assert.equal(marginBasisPoints(5, 5), 10_000);
  assert.equal(marginBasisPoints(-15, 5), -30_000,
    "prejuízo maior que receita");
  // Denominador zero ou negativo: margem indefinida, nunca Infinity/NaN.
  assert.equal(marginBasisPoints(100, 0), null);
  assert.equal(marginBasisPoints(-100, 0), null);
  assert.equal(marginBasisPoints(100, -50), null);
  // Valores grandes sem perda (BigInt): R$ 10 bi de resultado.
  assert.equal(
    marginBasisPoints(1_000_000_000_000, 3_000_000_000_000), 3_333,
  );
});

test("soma exata dos meses; estouro de inteiro seguro falha", () => {
  const periods = new Map<string, PeriodTotals>([
    ["2026-01", {incomeCents: 100, expenseCents: 40}],
    ["2026-02", {incomeCents: 50, expenseCents: 70}],
  ]);
  assert.deepEqual(sumPeriods(["2026-01", "2026-02", "2026-03"], periods),
    {receiptsCents: 150, expensesCents: 110});
  const huge = new Map<string, PeriodTotals>([
    ["2026-01", {incomeCents: Number.MAX_SAFE_INTEGER, expenseCents: 0}],
    ["2026-02", {incomeCents: 1, expenseCents: 0}],
  ]);
  assert.throws(() => sumPeriods(["2026-01", "2026-02"], huge));
});

test("cada indicador lê só os componentes do seu tipo", () => {
  const periods = new Map<string, PeriodTotals>([
    ["2026-09", {incomeCents: 90_000, expenseCents: 120_000}],
    ["2026-08", {incomeCents: 999_999, expenseCents: 999_999}],
  ]);
  const context = {
    todayKey: "2026-09-15", periods, accountsBalanceCents: -2_500,
    asOf: "2026-09-15T12:00:00.000Z",
  };
  const goal = (businessType: string, extra = {}) => ({
    progressSource: "business_kpi", businessType, period: "mensal",
    startDate: "2026-01-01", deadline: "2026-12-31", ...extra,
  });
  const revenue = evaluateGoalKpi("a", goal("faturamento"), context);
  assert.equal(revenue.status === "ok" && "valueCents" in revenue &&
    revenue.valueCents, 90_000);
  const result = evaluateGoalKpi("b", goal("lucro"), context);
  assert.equal(result.status === "ok" && "valueCents" in result &&
    result.valueCents, -30_000, "resultado negativo preservado");
  const costs = evaluateGoalKpi("c", goal("reducao_custos"), context);
  assert.equal(costs.status === "ok" && "valueCents" in costs &&
    costs.valueCents, 120_000, "limite de despesas = despesas do período");
  const margin = evaluateGoalKpi("d", goal("margem"), context);
  assert.equal(margin.status === "ok" && margin.businessType === "margem" &&
    margin.valueBasisPoints, -3_333);
  const cash = evaluateGoalKpi("e", goal("caixa_minimo", {period: undefined}),
    context);
  assert.deepEqual(cash, {
    goalId: "e", status: "ok", businessType: "caixa_minimo", unit: "cents",
    valueCents: -2_500, asOf: "2026-09-15T12:00:00.000Z",
  });
  // A janela é a do período: agosto não entra no mensal de setembro.
  assert.equal(revenue.status === "ok" && "window" in revenue &&
    revenue.window.startDate, "2026-09-01");

  const noReceipts = evaluateGoalKpi("f", goal("margem"), {
    ...context, periods: new Map(),
  });
  assert.equal(noReceipts.status, "unavailable");
  assert.equal(noReceipts.status === "unavailable" && noReceipts.reason,
    "no_receipts");
  const noAccounts = evaluateGoalKpi("g", goal("caixa_minimo"),
    {...context, accountsBalanceCents: null});
  assert.equal(noAccounts.status, "unavailable");
});

test("projeção em reconstrução e margem fora do intervalo: indisponível",
  () => {
    const goal = (businessType: string, extra = {}) => ({
      progressSource: "business_kpi", businessType, period: "mensal",
      startDate: "2026-01-01", deadline: "2026-12-31", ...extra,
    });
    const base = {
      todayKey: "2026-09-15", accountsBalanceCents: 10, asOf: "x",
      periods: new Map<string, PeriodTotals>([
        ["2026-09", {incomeCents: 1, expenseCents: 9_000_000_000_000_000}],
      ]),
    };
    const margin = evaluateGoalKpi("m", goal("margem"), base);
    assert.equal(margin.status === "unavailable" && margin.reason,
      "margin_out_of_range");
    const stale = {...base, periodsNeedRebuild: true};
    for (const type of ["faturamento", "lucro", "margem", "reducao_custos"]) {
      const result = evaluateGoalKpi(type, goal(type), stale);
      assert.equal(result.status === "unavailable" && result.reason,
        "projection_needs_rebuild", type);
    }
    const cash = evaluateGoalKpi("c", goal("caixa_minimo", {period: undefined}),
      stale);
    assert.equal(cash.status, "ok", "saldo das contas não depende da projeção");
  });

test("meta que não é indicador PJ não recebe valor calculado", () => {
  const context = {
    todayKey: "2026-09-15", periods: new Map(), accountsBalanceCents: 0,
    asOf: "x",
  };
  for (const goal of [
    undefined,
    {progressSource: "manual"},
    {progressSource: "investment", businessType: "investimento"},
    {progressSource: "business_kpi", businessType: "investimento"},
    {progressSource: "business_kpi", businessType: "inventado"},
  ]) {
    const result = evaluateGoalKpi("x", goal, context);
    assert.equal(result.status, "unavailable", JSON.stringify(goal));
  }
  const custom = evaluateGoalKpi("y", {
    progressSource: "business_kpi", businessType: "faturamento",
    period: "custom", startDate: "2026-02-10", deadline: "2026-03-31",
  }, context);
  assert.equal(custom.status === "unavailable" && custom.reason,
    "custom_period_not_month_aligned");
});
