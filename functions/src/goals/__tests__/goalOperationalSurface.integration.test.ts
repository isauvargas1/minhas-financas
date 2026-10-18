import assert from "node:assert/strict";
import test from "node:test";

import * as goalCallables from "../callables";
import {GOAL_OPERATION_ROLES} from "../callables";

/**
 * Superfície operacional das metas: toda callable de meta declara papel na
 * matriz. O recálculo patrimonial (`recalculateGoalInvestmentProgress`) saiu
 * com a superfície profissional de investimentos (D-15, P4-D): o progresso
 * patrimonial da meta é aplicado pelo próprio movimento, na mesma transação.
 * P5-B (D-31.5): owner, admin e member gerenciam; viewer só chama as duas
 * leituras (contagem do painel e indicadores PJ), que não escrevem nada.
 */

const WRITES = [
  "archiveGoal",
  "createGoal",
  "setGoalStatus",
  "updateGoal",
  "updateGoalManualProgress",
];
const READS = ["getGoalKpiProgress", "getGoalsOverview"];

test("toda callable de meta declara papel na matriz, e viewer não escreve", () => {
  assert.deepEqual(
    Object.keys(GOAL_OPERATION_ROLES).sort(),
    [...WRITES, ...READS].sort(),
  );
  for (const operation of WRITES) {
    assert.deepEqual(
      [...GOAL_OPERATION_ROLES[operation as keyof typeof GOAL_OPERATION_ROLES]],
      ["owner", "admin", "member"],
      operation,
    );
  }
  for (const operation of READS) {
    assert.deepEqual(
      [...GOAL_OPERATION_ROLES[operation as keyof typeof GOAL_OPERATION_ROLES]],
      ["owner", "admin", "member", "viewer"],
      operation,
    );
  }

  // Nenhuma callable de meta exportada pode ficar fora da matriz: sem isto, a
  // próxima operação nasceria com papel decidido no ponto de construção e
  // invisível para qualquer teste.
  const exported = Object.entries(goalCallables)
    .filter(([, value]) =>
      Boolean(value) &&
      (typeof value === "object" || typeof value === "function") &&
      "__endpoint" in (value as Record<string, unknown>))
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exported, Object.keys(GOAL_OPERATION_ROLES).sort());
});
