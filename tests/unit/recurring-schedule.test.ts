import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import * as frontend from '../../src/modules/recurring/schedule.ts';
import * as backend from '../../functions/src/recurring/schedule.ts';

/**
 * P4-B (D-12) — a agenda da tela produz exatamente a sequência do backend.
 *
 * 1. Os dois lados contra os mesmos vetores escritos à mão
 *    (`tests/fixtures/recurring-schedule-vectors.json`), não gerados por
 *    nenhuma das implementações.
 * 2. Os dois lados um contra o outro, numa varredura de todas as
 *    frequências, dias de cobrança 1–31, inícios espalhados por anos comuns
 *    e bissextos e dias de consulta ao longo de vários anos.
 */
type Rule = frontend.ScheduleRule;
interface Vectors {
  sequences: { name: string; rule: Rule; from: string; to: string; limit: number; expected: string[] }[];
  nextOnOrAfter: { name: string; rule: Rule; day: string; expected: string | null }[];
}

const vectors = JSON.parse(readFileSync('tests/fixtures/recurring-schedule-vectors.json', 'utf8')) as Vectors;

test('P4-B — frontend e backend batem com os vetores independentes', () => {
  for (const side of [frontend, backend]) {
    for (const vector of vectors.sequences) {
      assert.deepEqual(side.dueDatesBetween(vector.rule, vector.from, vector.to, vector.limit),
        vector.expected, vector.name);
    }
    for (const vector of vectors.nextOnOrAfter) {
      assert.equal(side.nextDueOnOrAfter(vector.rule, vector.day), vector.expected, vector.name);
    }
  }
});

test('P4-B — frontend e backend produzem a mesma sequência em toda a varredura', () => {
  let compared = 0;
  const starts = ['2027-01-31', '2027-02-28', '2028-02-29', '2028-12-30', '2029-07-15'];
  for (const frequency of frontend.RECURRING_FREQUENCIES) {
    const monthly = frontend.usesBillingDay(frequency);
    const billingDays = monthly ? Array.from({ length: 31 }, (_, index) => index + 1) : [null];
    for (const billingDay of billingDays) {
      for (const startDate of starts) {
        const rule: Rule = { frequency, billingDay, startDate, endDate: null };
        const front = frontend.dueDatesBetween(rule, '2027-01-01', '2031-12-31', 300);
        const back = backend.dueDatesBetween(rule, '2027-01-01', '2031-12-31', 300);
        assert.deepEqual(front, back, `${frequency}/${billingDay}/${startDate}`);
        for (let day = '2027-01-01'; day <= '2031-06-30'; day = frontend.addCivilDays(day, 37)) {
          assert.equal(frontend.nextDueOnOrAfter(rule, day), backend.nextDueOnOrAfter(rule, day));
          compared += 1;
        }
      }
    }
  }
  assert.ok(compared > 5_000, `comparações: ${compared}`);
});

test('P4-B — agenda civil pura, sem `Date` nem `setMonth`', () => {
  for (const file of ['src/modules/recurring/schedule.ts', 'functions/src/recurring/schedule.ts']) {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\bnew Date\b|\bDate\.(UTC|now|parse)\b|setMonth|setDate|toISOString|getTimezoneOffset/,
      file);
  }
});
