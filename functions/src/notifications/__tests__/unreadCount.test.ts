import assert from "node:assert/strict";
import test from "node:test";

import {unreadFromCounts} from "../unreadCount";

/**
 * P5-D2 — diferença entre as duas agregações. Resultado fora do invariante
 * (estados além dos eventos, número inválido) vira `null`: nunca zero,
 * nunca um número limitado.
 */

test("unreadFromCounts: 0/0 é zero verdadeiro", () => {
  assert.equal(unreadFromCounts(0, 0), 0);
});

test("unreadFromCounts: 5 eventos e 2 estados são 3 não lidas", () => {
  assert.equal(unreadFromCounts(5, 2), 3);
});

test("unreadFromCounts: todos marcados dá zero (5/5)", () => {
  assert.equal(unreadFromCounts(5, 5), 0);
});

test("unreadFromCounts: mais estados que eventos viola o invariante " +
  "(2/5 → null), nunca zero", () => {
  assert.equal(unreadFromCounts(2, 5), null);
  assert.equal(unreadFromCounts(0, 1), null);
});

test("unreadFromCounts: fracionário, NaN, infinito e negativo → null", () => {
  for (const [events, states] of [
    [5.5, 2], [5, 2.5], [Number.NaN, 0], [0, Number.NaN],
    [Number.POSITIVE_INFINITY, 1], [5, Number.POSITIVE_INFINITY],
    [-1, 0], [3, -1], [-3, -1],
  ]) {
    assert.equal(unreadFromCounts(events, states), null,
      `${events}/${states}`);
  }
});

test("unreadFromCounts: valores acima do inteiro seguro → null", () => {
  assert.equal(unreadFromCounts(Number.MAX_SAFE_INTEGER + 2, 1), null);
});

test("unreadFromCounts: contagens grandes e exatas", () => {
  assert.equal(unreadFromCounts(1_000_001, 1_000_000), 1);
});
