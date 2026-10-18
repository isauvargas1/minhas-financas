import assert from "node:assert/strict";
import test from "node:test";

import {
  getFinancialReportPayloadSchema,
} from "../contract";
import {
  addExact,
  marginBasisPoints,
  netContributionRateBasisPoints,
  ratioBasisPoints,
} from "../formulas";
import {
  dayCountBetween,
  resolveReportWindow,
  windowMonths,
} from "../window";

/**
 * P5-C1 (D-37.7) — janelas civis do relatório em America/Sao_Paulo, pontas
 * inclusivas, e fórmulas compartilhadas em pontos-base (BigInt).
 */

const preset = (value: "7d" | "30d" | "90d" | "12m" | "ytd" | "all") =>
  ({kind: "preset" as const, preset: value});

test("7, 30 e 90 dias são exatamente 7, 30 e 90 datas civis, contando hoje",
  () => {
    for (const [value, days, start] of [
      ["7d", 7, "2026-10-03"],
      ["30d", 30, "2026-09-10"],
      ["90d", 90, "2026-07-12"],
    ] as const) {
      const {period, months} = resolveReportWindow(preset(value),
        "2026-10-09");
      assert.equal(period.startDate, start, value);
      assert.equal(period.endDate, "2026-10-09", value);
      assert.equal(period.dayCount, days, value);
      assert.equal(period.boundaries, "inclusive");
      assert.equal(dayCountBetween(start, "2026-10-09"), days);
      const covered = months.reduce((sum, slice) =>
        sum + dayCountBetween(slice.startDate, slice.endDate), 0);
      assert.equal(covered, days, `${value}: recortes cobrem a janela`);
    }
  });

test("virada de mês e de ano: 7 dias em 2 de janeiro alcançam dezembro", () => {
  const {period, months} = resolveReportWindow(preset("7d"), "2027-01-02");
  assert.equal(period.startDate, "2026-12-27");
  assert.deepEqual(months.map((slice) => [slice.month, slice.startDate,
    slice.endDate, slice.full]), [
    ["2026-12", "2026-12-27", "2026-12-31", false],
    ["2027-01", "2027-01-01", "2027-01-02", false],
  ]);
});

test("fevereiro e ano bissexto: 30 dias até 1º de março", () => {
  // 2028: fevereiro tem 29 dias, então 29 dias de fevereiro + 1º de março.
  const leap = resolveReportWindow(preset("30d"), "2028-03-01");
  assert.equal(leap.period.startDate, "2028-02-01");
  assert.deepEqual(leap.months.map((slice) => [slice.month, slice.full]),
    [["2028-02", true], ["2028-03", false]],
    "fevereiro de 2028 inteiro (29 dias)");
  assert.equal(leap.months[0].endDate, "2028-02-29");
  // 2027: fevereiro tem 28 dias, a janela começa em 31 de janeiro.
  const common = resolveReportWindow(preset("30d"), "2027-03-01");
  assert.equal(common.period.startDate, "2027-01-31");
  assert.deepEqual(common.months.map((slice) => slice.full),
    [false, true, false]);
  assert.equal(common.months[1].endDate, "2027-02-28");
});

test("12 meses: o mês corrente e os 11 anteriores inteiros", () => {
  const {period, months} = resolveReportWindow(preset("12m"), "2026-10-09");
  assert.equal(period.startDate, "2025-11-01");
  assert.equal(months.length, 12);
  assert.ok(months.slice(0, 11).every((slice) => slice.full));
  assert.equal(months[11].full, false, "mês corrente até hoje");
  const january = resolveReportWindow(preset("12m"), "2027-01-15");
  assert.equal(january.period.startDate, "2026-02-01");
});

test("ano corrente: 1º de janeiro até hoje", () => {
  const {period, months} = resolveReportWindow(preset("ytd"), "2026-10-09");
  assert.equal(period.startDate, "2026-01-01");
  assert.equal(months.length, 10);
  const newYear = resolveReportWindow(preset("ytd"), "2027-01-01");
  assert.equal(newYear.period.dayCount, 1);
});

test("tudo: do primeiro mês com dado até hoje; sem dado, janela vazia", () => {
  const all = resolveReportWindow(preset("all"), "2026-10-09", "2019-05");
  assert.equal(all.period.startDate, "2019-05-01");
  assert.equal(all.months[0].full, true);
  const empty = resolveReportWindow(preset("all"), "2026-10-09", null);
  assert.equal(empty.period.startDate, null);
  assert.equal(empty.period.dayCount, 0);
  assert.deepEqual(empty.months, []);
});

test("mês do painel: passado inteiro, corrente até hoje, futuro sem dias",
  () => {
    const past = resolveReportWindow({kind: "month", month: "2026-02"},
      "2026-10-09");
    assert.deepEqual([past.period.startDate, past.period.endDate,
      past.period.dayCount, past.months[0].full],
    ["2026-02-01", "2026-02-28", 28, true]);
    const current = resolveReportWindow({kind: "month", month: "2026-10"},
      "2026-10-09");
    assert.deepEqual([current.period.endDate, current.period.dayCount,
      current.months[0].full], ["2026-10-09", 9, false]);
    const future = resolveReportWindow({kind: "month", month: "2026-11"},
      "2026-10-09");
    assert.equal(future.period.future, true);
    assert.equal(future.period.dayCount, 0);
    assert.deepEqual(future.months, []);
  });

test("recortes mensais: mês inteiro só quando cobre do dia 1 ao último", () => {
  assert.deepEqual(windowMonths("2026-01-01", "2026-03-31")
    .map((slice) => slice.full), [true, true, true]);
  assert.deepEqual(windowMonths("2026-01-02", "2026-03-30")
    .map((slice) => slice.full), [false, true, false]);
  assert.deepEqual(windowMonths("2026-03-31", "2026-03-30"), []);
});

test("contrato de entrada estrito: faixa, mês e blocos", () => {
  const ok = getFinancialReportPayloadSchema.safeParse({
    workspaceId: "ws", range: {kind: "month", month: "2026-02"},
    sections: ["cash", "kpis"],
  });
  assert.equal(ok.success, true);
  for (const payload of [
    {workspaceId: "ws", range: {kind: "preset", preset: "1y"}},
    {workspaceId: "ws", range: {kind: "month", month: "2026-13"}},
    {workspaceId: "ws", range: {kind: "preset", preset: "7d"},
      sections: ["cash", "cash"]},
    {workspaceId: "ws", range: {kind: "preset", preset: "7d"}, role: "owner"},
    {workspaceId: "a/b", range: {kind: "preset", preset: "7d"}},
  ]) {
    assert.equal(getFinancialReportPayloadSchema.safeParse(payload).success,
      false, JSON.stringify(payload));
  }
});

test("pontos-base em BigInt: meio para longe do zero, sem float", () => {
  assert.equal(ratioBasisPoints(1, 3), 3_333);
  assert.equal(ratioBasisPoints(2, 3), 6_667);
  assert.equal(ratioBasisPoints(-2, 3), -6_667);
  assert.equal(ratioBasisPoints(1, 20_000), 1);
  assert.equal(ratioBasisPoints(-1, 20_000), -1);
  assert.equal(ratioBasisPoints(1, 20_001), 0);
  // Valores grandes não perdem precisão (o produto passa de 2^53).
  assert.equal(ratioBasisPoints(900_719_925_474_099, 900_719_925_474_099),
    10_000);
});

test("denominador zero ou negativo é indisponível, nunca 0/NaN/Infinity",
  () => {
    for (const denominator of [0, -1]) {
      assert.equal(ratioBasisPoints(100, denominator), null);
      assert.equal(marginBasisPoints(100, denominator), null);
      assert.equal(netContributionRateBasisPoints(10, 0, denominator), null);
    }
    assert.equal(ratioBasisPoints(Number.NaN, 10), null);
  });

test("margem operacional e taxa de aportes líquidos (D-37.4, D-37.5)", () => {
  assert.equal(marginBasisPoints(70_000 - 20_000, 70_000), 7_143);
  assert.equal(marginBasisPoints(-30_000, 70_000), -4_286);
  // Taxa negativa (retirou mais do que aportou) e acima de 100%.
  assert.equal(netContributionRateBasisPoints(10_000, 30_000, 100_000),
    -2_000);
  assert.equal(netContributionRateBasisPoints(250_000, 0, 100_000), 25_000);
  assert.throws(() => addExact(Number.MAX_SAFE_INTEGER, 1));
});
