import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";

import {
  recurringCardPurchaseIdFor,
  recurringCashTransactionIdFor,
  recurringOccurrenceIdFor,
} from "../model";
import {
  RECURRING_FREQUENCIES,
  addCivilDays,
  civilDaysBetween,
  daysInMonth,
  dueDateAt,
  dueDatesBetween,
  nextDueAfter,
  nextDueOnOrAfter,
  type ScheduleRule,
} from "../schedule";

/**
 * Agenda D-12 (P4-B) sem Firestore: vetores escritos à mão (os mesmos do
 * frontend), propriedades de não-deriva e a identidade das ocorrências.
 */
interface Vectors {
  sequences: {
    name: string; rule: ScheduleRule; from: string; to: string; limit: number;
    expected: string[];
  }[];
  nextOnOrAfter: {name: string; rule: ScheduleRule; day: string;
    expected: string | null}[];
}

// lib/recurring/__tests__ → raiz do repositório.
const vectors = JSON.parse(readFileSync(resolve(__dirname,
  "../../../../tests/fixtures/recurring-schedule-vectors.json"), "utf8")) as
  Vectors;

test("vetores independentes: sequências de vencimentos", () => {
  assert.ok(vectors.sequences.length >= 20);
  for (const vector of vectors.sequences) {
    assert.deepEqual(
      dueDatesBetween(vector.rule, vector.from, vector.to, vector.limit),
      vector.expected, vector.name);
  }
});

test("vetores independentes: próximo vencimento a partir de um dia", () => {
  for (const vector of vectors.nextOnOrAfter) {
    assert.equal(nextDueOnOrAfter(vector.rule, vector.day), vector.expected,
      vector.name);
  }
});

test("mensal e mais longas: cada vencimento é o dia-âncora limitado ao " +
  "mês", () => {
  for (const frequency of ["monthly", "bimonthly", "quarterly", "semiannual",
    "annual"] as const) {
    for (let billingDay = 1; billingDay <= 31; billingDay += 1) {
      const rule: ScheduleRule = {frequency, billingDay,
        startDate: "2027-11-15", endDate: null};
      let previous = "";
      for (let n = 0; n < 30; n += 1) {
        const due = dueDateAt(rule, n);
        const [year, month, day] = due.split("-").map(Number);
        // Sem deriva: o dia é sempre min(âncora, último dia do mês).
        assert.equal(day, Math.min(billingDay, daysInMonth(year, month)),
          `${frequency} dia ${billingDay} n=${n}`);
        assert.ok(due > previous, "estritamente crescente");
        previous = due;
      }
    }
  }
});

test("semanal e quinzenal: passo fixo de 7 e 15 dias corridos", () => {
  for (const [frequency, step] of [["weekly", 7], ["biweekly", 15]] as const) {
    const rule: ScheduleRule = {frequency, billingDay: null,
      startDate: "2027-12-29", endDate: null};
    for (let n = 1; n < 120; n += 1) {
      assert.equal(civilDaysBetween(dueDateAt(rule, n - 1), dueDateAt(rule, n)),
        step);
    }
  }
});

test("próximo vencimento: o menor vencimento ≥ dia, para toda " +
  "frequência", () => {
  for (const frequency of RECURRING_FREQUENCIES) {
    const monthly = !["weekly", "biweekly"].includes(frequency);
    for (const billingDay of monthly ? [1, 15, 28, 29, 30, 31] : [null]) {
      const rule: ScheduleRule = {frequency, billingDay,
        startDate: "2027-01-31", endDate: null};
      const all = dueDatesBetween(rule, "2027-01-01", "2032-12-31", 1_000);
      for (let day = "2027-01-01"; day <= "2030-06-30";
        day = addCivilDays(day, 3)) {
        const expected = all.find((due) => due >= day) ?? null;
        assert.equal(nextDueOnOrAfter(rule, day), expected,
          `${frequency}/${billingDay} em ${day}`);
        const after = all.find((due) => due > day) ?? null;
        assert.equal(nextDueAfter(rule, day), after);
      }
    }
  }
});

test("término exclui e ano bissexto existe", () => {
  const rule: ScheduleRule = {frequency: "monthly", billingDay: 29,
    startDate: "2028-01-29", endDate: "2028-02-29"};
  assert.deepEqual(dueDatesBetween(rule, "2028-01-01", "2028-12-31", 10),
    ["2028-01-29", "2028-02-29"]);
  assert.equal(nextDueAfter(rule, "2028-02-29"), null);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(addCivilDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addCivilDays("2027-12-31", 1), "2028-01-01");
});

test("identidade da ocorrência: contrato + data civil completa", () => {
  const rule: ScheduleRule = {frequency: "weekly", billingDay: null,
    startDate: "2026-03-02", endDate: null};
  const march = dueDatesBetween(rule, "2026-03-01", "2026-03-31", 10);
  assert.equal(march.length, 5);
  const ids = march.map((due) =>
    recurringOccurrenceIdFor("ws-a", "rec_1", due));
  // Cinco vencimentos na mesma competência: cinco ocorrências distintas.
  assert.equal(new Set(ids).size, 5);
  for (const id of ids) assert.match(id, /^rocc_[0-9a-f]{40}$/);
  // Determinística e isolada por workspace e por contrato.
  assert.equal(recurringOccurrenceIdFor("ws-a", "rec_1", "2026-03-02"), ids[0]);
  assert.notEqual(recurringOccurrenceIdFor("ws-b", "rec_1", "2026-03-02"),
    ids[0]);
  assert.notEqual(recurringOccurrenceIdFor("ws-a", "rec_2", "2026-03-02"),
    ids[0]);
  // Um fato por ocorrência e por domínio, com IDs determinísticos.
  assert.match(recurringCashTransactionIdFor("ws-a", ids[0]),
    /^cash_[0-9a-f]{40}$/);
  assert.match(recurringCardPurchaseIdFor("ws-a", ids[0]),
    /^ccp_[0-9a-f]{40}$/);
  assert.notEqual(recurringCashTransactionIdFor("ws-a", ids[0]),
    recurringCashTransactionIdFor("ws-a", ids[1]));
  assert.notEqual(recurringCashTransactionIdFor("ws-a", ids[0]),
    recurringCashTransactionIdFor("ws-b", ids[0]));
});

test("quinzenal: duas ou três ocorrências distintas no mesmo mês", () => {
  const rule: ScheduleRule = {frequency: "biweekly", billingDay: null,
    startDate: "2026-01-01", endDate: null};
  const january = dueDatesBetween(rule, "2026-01-01", "2026-01-31", 10);
  const march = dueDatesBetween(rule, "2026-03-01", "2026-03-31", 10);
  assert.deepEqual(january, ["2026-01-01", "2026-01-16", "2026-01-31"]);
  assert.deepEqual(march, ["2026-03-02", "2026-03-17"]);
  assert.equal(new Set(january.map((due) =>
    recurringOccurrenceIdFor("ws", "rec", due))).size, 3);
});

test("regra inválida é recusada", () => {
  assert.throws(() => dueDateAt({frequency: "monthly", billingDay: null,
    startDate: "2026-01-01", endDate: null}, 0));
  assert.throws(() => dueDateAt({frequency: "monthly", billingDay: 32,
    startDate: "2026-01-01", endDate: null}, 0));
  assert.throws(() => dueDateAt({frequency: "weekly", billingDay: null,
    startDate: "2026-02-30", endDate: null}, 0));
});
