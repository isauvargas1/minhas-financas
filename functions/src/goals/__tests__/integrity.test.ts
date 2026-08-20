import assert from "node:assert/strict";
import test from "node:test";

import {
  contributionMinorUnits,
  isSettledGoalContribution,
  toMinorUnits,
} from "../operations";

test("valores monetários de aporte usam centavos exatos", () => {
  assert.equal(toMinorUnits(0.01), 1);
  assert.equal(toMinorUnits(1234.56), 123456);
  assert.throws(() => toMinorUnits(10.001), /duas casas decimais/);
});

test("somente aporte liquidado participa do progresso", () => {
  const settled = {
    type: "investimento",
    goalId: "goal-real-firestore-id",
    isPaid: true,
    value: 10.25,
    valueCents: 1025,
  };
  assert.equal(isSettledGoalContribution(settled), true);
  assert.equal(contributionMinorUnits(settled), 1025);
  assert.equal(contributionMinorUnits({...settled, isPaid: false}), 0);
  assert.equal(contributionMinorUnits({...settled, type: "despesa"}), 0);
});
