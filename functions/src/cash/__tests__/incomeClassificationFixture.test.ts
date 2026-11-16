import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";

import {cashPeriodDeltaFor} from "../periods";

/**
 * Fixture compartilhada com o espelho de receita do cliente
 * (`tests/fixtures/cash-income-classification.json`): para cada documento,
 * o `incomeCents` da projeção de caixa é o esperado. O teste do cliente
 * confere o mesmo valor no espelho, então os dois lados não divergem.
 */

interface FixtureCase {
  name: string;
  kind: string;
  incomeCents: number;
  data: Record<string, unknown>;
}

// lib/cash/__tests__ → raiz do repositório.
const FIXTURE = resolve(
  __dirname,
  "../../../../tests/fixtures/cash-income-classification.json",
);
const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
  cases: FixtureCase[];
};

test("P5-F.1 — fixture de receita: incomeCents oficial por documento", () => {
  assert.ok(fixture.cases.length >= 12, "fixture completa");
  for (const item of fixture.cases) {
    const delta = cashPeriodDeltaFor(item.data);
    assert.equal(delta.incomeCents, item.incomeCents, item.name);
  }
});

test("P5-F.1 — fixture de receita: cobre cada natureza do espelho", () => {
  const kinds = new Set(fixture.cases.map((item) => item.kind));
  for (const kind of ["income", "pending", "voided", "expense", "receivable",
    "receivable_reversal", "loan", "card_payment", "split", "investment"]) {
    assert.ok(kinds.has(kind), kind);
  }
});
