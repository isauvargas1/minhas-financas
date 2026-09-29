import test from "node:test";
import assert from "node:assert/strict";

import {
  addDaysToDayKey,
  isDayKey,
  saoPauloDayKey,
  saoPauloDayStart,
  saoPauloMonthKey,
  saoPauloMonthStart,
  utcAnchoredDayKey,
} from "../dateKeys";

test("movimento noturno em BRT permanece no dia local, não no dia UTC", () => {
  // 23:30 BRT de 31/08/2026 é 02:30Z de 01/09/2026.
  const late = new Date("2026-09-01T02:30:00.000Z");
  assert.equal(late.toISOString().slice(0, 10), "2026-09-01");
  assert.equal(saoPauloDayKey(late), "2026-08-31");
});

test("virada de mês noturna permanece no mês local", () => {
  const late = new Date("2026-09-01T02:30:00.000Z");
  assert.equal(late.toISOString().slice(0, 7), "2026-09");
  assert.equal(saoPauloMonthKey(late), "2026-08");
});

test("instantes diurnos coincidem com a leitura UTC", () => {
  const midday = new Date("2026-08-23T15:00:00.000Z");
  assert.equal(saoPauloDayKey(midday), "2026-08-23");
  assert.equal(saoPauloMonthKey(midday), "2026-08");
});

test("início do dia é 03:00Z fora do horário de verão", () => {
  assert.equal(
    saoPauloDayStart("2026-08-01").toISOString(),
    "2026-08-01T03:00:00.000Z",
  );
  assert.equal(saoPauloDayKey(saoPauloDayStart("2026-08-01")), "2026-08-01");
});

test("início do dia pertence ao dia e o milissegundo anterior não", () => {
  for (const day of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
    const start = saoPauloDayStart(day);
    assert.equal(saoPauloDayKey(start), day);
    assert.notEqual(saoPauloDayKey(new Date(start.getTime() - 1)), day);
  }
});

test("entrada do horário de verão sem meia-noite local resolve para a 1h", () => {
  // Em 04/11/2018 o relógio saltou de 00:00 para 01:00 em São Paulo.
  const start = saoPauloDayStart("2018-11-04");
  assert.equal(saoPauloDayKey(start), "2018-11-04");
  assert.equal(start.toISOString(), "2018-11-04T03:00:00.000Z");
  assert.notEqual(saoPauloDayKey(new Date(start.getTime() - 1)), "2018-11-04");
});

test("saída do horário de verão mantém a primeira hora do dia", () => {
  // Em 17/02/2019 o relógio voltou de 00:00 para 23:00 do dia anterior.
  const start = saoPauloDayStart("2019-02-17");
  assert.equal(saoPauloDayKey(start), "2019-02-17");
  assert.notEqual(saoPauloDayKey(new Date(start.getTime() - 1)), "2019-02-17");
});

test("início do mês usa o fuso local, não a meia-noite UTC", () => {
  assert.equal(
    saoPauloMonthStart("2026-09").toISOString(),
    "2026-09-01T03:00:00.000Z",
  );
  assert.equal(saoPauloMonthKey(saoPauloMonthStart("2026-09")), "2026-09");
});

test("chaves malformadas são rejeitadas", () => {
  assert.throws(() => saoPauloDayStart("2026-8-1"));
  assert.throws(() => saoPauloMonthStart("2026-13"));
  assert.throws(() => saoPauloMonthStart("2026-09-01"));
});

test("instantes UTC que mudam o dia civil brasileiro", () => {
  const cases: Array<[string, string, string]> = [
    ["2026-03-01T02:59:59.999Z", "2026-02-28", "2026-02"],
    ["2026-03-01T03:00:00.000Z", "2026-03-01", "2026-03"],
    ["2026-01-01T02:30:00.000Z", "2025-12-31", "2025-12"],
    ["2026-01-01T03:00:00.000Z", "2026-01-01", "2026-01"],
    ["2024-03-01T02:59:59.999Z", "2024-02-29", "2024-02"],
    ["2024-02-29T03:00:00.000Z", "2024-02-29", "2024-02"],
  ];
  for (const [instant, day, month] of cases) {
    assert.equal(saoPauloDayKey(new Date(instant)), day, instant);
    assert.equal(saoPauloMonthKey(new Date(instant)), month, instant);
  }
});

test("isDayKey valida calendário e ano bissexto", () => {
  for (const valid of [
    "2024-02-29",
    "2000-02-29",
    "2026-12-31",
    "2026-01-01",
    "2026-04-30",
  ]) {
    assert.equal(isDayKey(valid), true, valid);
  }
  for (const invalid of [
    "2023-02-29",
    "1900-02-29",
    "2026-02-30",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "2026-1-01",
    "2026-01-1",
    " 2026-01-01",
    "2026-01-01T00:00",
    "2026/01/01",
    "",
    20260101,
    null,
    undefined,
    new Date("2026-01-01T12:00:00.000Z"),
  ]) {
    assert.equal(isDayKey(invalid), false, String(invalid));
  }
});

test("addDaysToDayKey atravessa bissexto, fim de ano e dias negativos", () => {
  const cases: Array<[string, number, string]> = [
    ["2024-02-28", 1, "2024-02-29"],
    ["2024-02-29", 1, "2024-03-01"],
    ["2023-02-28", 1, "2023-03-01"],
    ["2024-03-01", -1, "2024-02-29"],
    ["2023-03-01", -1, "2023-02-28"],
    ["2025-12-31", 1, "2026-01-01"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2026-01-15", -30, "2025-12-16"],
    ["2024-01-01", 365, "2024-12-31"],
    ["2025-01-01", 365, "2026-01-01"],
    ["2026-08-31", 0, "2026-08-31"],
    ["2026-01-31", 31, "2026-03-03"],
  ];
  for (const [day, days, expected] of cases) {
    assert.equal(addDaysToDayKey(day, days), expected, `${day} ${days}`);
  }
});

test("addDaysToDayKey recusa chave inexistente e passo não inteiro", () => {
  assert.throws(() => addDaysToDayKey("2023-02-29", 1));
  assert.throws(() => addDaysToDayKey("2026-13-01", 1));
  assert.throws(() => addDaysToDayKey("2026-01-01", 1.5));
  assert.throws(() => addDaysToDayKey("2026-01-01", Number.NaN));
  assert.throws(() =>
    addDaysToDayKey("2026-01-01", Number.POSITIVE_INFINITY));
});

test("utcAnchoredDayKey lê os campos UTC, sem fuso do processo", () => {
  assert.equal(
    utcAnchoredDayKey(new Date(Date.UTC(2026, 0, 1))),
    "2026-01-01",
  );
  assert.equal(
    utcAnchoredDayKey(new Date(Date.UTC(2024, 1, 29))),
    "2024-02-29",
  );
  // O mesmo instante é 28/02 em São Paulo e 01/03 ancorado em UTC.
  const lateNight = new Date("2026-03-01T02:59:59.999Z");
  assert.equal(utcAnchoredDayKey(lateNight), "2026-03-01");
  assert.equal(saoPauloDayKey(lateNight), "2026-02-28");
  assert.equal(
    utcAnchoredDayKey(new Date("2026-12-31T23:59:59.999Z")),
    "2026-12-31",
  );
});

test("chaves de dia não dependem do TZ do processo", () => {
  const instants = [
    "2026-03-01T02:59:59.999Z",
    "2026-01-01T02:30:00.000Z",
    "2026-12-31T23:59:59.999Z",
    "2024-02-29T12:00:00.000Z",
  ].map((value) => new Date(value));
  const snapshot = () => instants.map((instant) => [
    utcAnchoredDayKey(instant),
    saoPauloDayKey(instant),
    saoPauloMonthKey(instant),
    saoPauloDayStart(saoPauloDayKey(instant)).toISOString(),
  ].join("|"));
  const originalTz = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const reference = snapshot();
    const zones = ["Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Tokyo"];
    for (const zone of zones) {
      process.env.TZ = zone;
      assert.deepEqual(snapshot(), reference, zone);
    }
  } finally {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  }
});

test("saoPauloDayStart pertence ao dia e o ms anterior ao dia anterior", () => {
  for (const day of [
    "2024-02-29",
    "2024-03-01",
    "2023-03-01",
    "2025-12-31",
    "2026-01-01",
    "2026-03-01",
  ]) {
    const start = saoPauloDayStart(day);
    assert.equal(saoPauloDayKey(start), day, day);
    assert.equal(
      saoPauloDayKey(new Date(start.getTime() - 1)),
      addDaysToDayKey(day, -1),
      day,
    );
  }
  assert.equal(
    saoPauloDayStart("2024-02-29").toISOString(),
    "2024-02-29T03:00:00.000Z",
  );
});
