import assert from "node:assert/strict";
import test from "node:test";

import {
  CARD_LIMIT_PER_WORKSPACE,
  addMonthsToMonthKey,
  dueDateOf,
} from "../../cards/model";
import {addDaysToDayKey} from "../../shared/dateKeys";
import {DUE_WINDOW_LIMIT} from "../cards";

/**
 * Teto da lista de vencimentos do relatório de cartões (P5-C1.1): faturas
 * que vencem de hoje a hoje + 30 (31 dias). O teto precisa cobrir o pior
 * caso de todos os cartões, senão o bloco fica indisponível sem motivo.
 */

/** Maior número de vencimentos de um cartão numa janela de 31 dias. */
const worstWindowOf = (closingDay: number, dueDay: number): number => {
  const dues: string[] = [];
  for (let offset = 0; offset < 60; offset += 1) {
    dues.push(dueDateOf(addMonthsToMonthKey("2026-01", offset), closingDay,
      dueDay));
  }
  dues.sort();
  let worst = 0;
  for (let first = 0; first < dues.length; first += 1) {
    const end = addDaysToDayKey(dues[first], 30);
    let count = 0;
    for (let next = first; next < dues.length && dues[next] <= end;
      next += 1) {
      count += 1;
    }
    worst = Math.max(worst, count);
  }
  return worst;
};

test("fechamento 28 e vencimento 31: três faturas vencem em 31 dias", () => {
  const today = "2026-03-31";
  const end = addDaysToDayKey(today, 30);
  const inWindow = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]
    .map((month) => dueDateOf(month, 28, 31))
    .filter((due) => due >= today && due <= end);
  assert.deepEqual(inWindow, ["2026-03-31", "2026-03-31", "2026-04-30"]);
});

test("pior caso em 5 anos, todos os dias de fechamento e vencimento: três " +
  "por cartão, e o teto cobre o limite de cartões", () => {
  let worst = 0;
  for (let closingDay = 1; closingDay <= 31; closingDay += 1) {
    for (let dueDay = 1; dueDay <= 31; dueDay += 1) {
      worst = Math.max(worst, worstWindowOf(closingDay, dueDay));
    }
  }
  assert.equal(worst, 3);
  assert.ok(DUE_WINDOW_LIMIT >= worst * CARD_LIMIT_PER_WORKSPACE,
    `teto ${DUE_WINDOW_LIMIT} < ${worst} × ${CARD_LIMIT_PER_WORKSPACE}`);
});
