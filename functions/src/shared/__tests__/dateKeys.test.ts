import test from "node:test";
import assert from "node:assert/strict";

import {
  saoPauloDayKey,
  saoPauloDayStart,
  saoPauloMonthKey,
  saoPauloMonthStart,
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
