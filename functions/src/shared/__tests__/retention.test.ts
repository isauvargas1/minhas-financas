import assert from "node:assert/strict";
import test from "node:test";

import {RETENTION_DAYS, expiresAfterDays} from "../retention";

const DAY_MS = 86_400_000;

test("D-18 — a retenção de notificações é de 180 dias exatos", () => {
  assert.equal(RETENTION_DAYS.notifications, 180);
  const from = Date.parse("2026-03-10T15:00:00.000Z");
  assert.equal(
    expiresAfterDays(from, RETENTION_DAYS.notifications).toMillis() - from,
    180 * DAY_MS);
  assert.equal(180 * DAY_MS, 15_552_000_000);
});

test("D-18 — expiresAfterDays parte de um instante fixo, sem relógio", () => {
  const from = Date.parse("2026-03-10T15:00:00.123Z");
  const expiresAt = expiresAfterDays(from, 180);
  assert.equal(expiresAt.toMillis(), from + 180 * DAY_MS);
  assert.equal(expiresAt.toDate().toISOString(), "2026-09-06T15:00:00.123Z");
  assert.equal(expiresAfterDays(from, 0).toMillis(), from);
});

test("D-18 — limite exato: 179 e 180 dias atrás, e 181 dias atrás", () => {
  const nowMs = Date.parse("2026-10-11T12:00:00.000Z");
  const created = (daysAgo: number): number => nowMs - daysAgo * DAY_MS;
  const expiry = (daysAgo: number) => expiresAfterDays(
    created(daysAgo), RETENTION_DAYS.notifications);
  // O instante de expiração gravado: criado há 179 dias vence daqui a um
  // dia; há 180, vence agora; há 181, venceu ontem. A regra de visibilidade
  // (`expiresAt <= agora` some) é testada no modelo do frontend e nas Rules.
  assert.equal(expiry(179).toMillis(), nowMs + DAY_MS, "179 dias: vence amanhã");
  assert.equal(expiry(180).toMillis(), nowMs, "180 dias exatos: vence agora");
  assert.equal(expiry(181).toMillis(), nowMs - DAY_MS, "181 dias: venceu ontem");
  assert.ok(expiry(180).toMillis() > nowMs - 1, "1 ms antes do limite ainda vigente");
});

test("D-18 — fim de mês e virada de ano usam dias corridos de 24 horas", () => {
  const endOfJanuary = Date.parse("2026-01-31T12:00:00.000Z");
  assert.equal(
    expiresAfterDays(endOfJanuary, 180).toDate().toISOString(),
    "2026-07-30T12:00:00.000Z");
  const newYear = Date.parse("2026-12-31T23:59:59.999Z");
  assert.equal(
    expiresAfterDays(newYear, 180).toDate().toISOString(),
    "2027-06-29T23:59:59.999Z");
  const leapYear = Date.parse("2027-12-31T10:00:00.000Z");
  assert.equal(
    expiresAfterDays(leapYear, 180).toDate().toISOString(),
    "2028-06-28T10:00:00.000Z");
});

test("D-18 — dois eventos com o mesmo instante têm o mesmo expiresAt", () => {
  const from = Date.parse("2026-05-20T09:30:00.000Z");
  const first = expiresAfterDays(from, RETENTION_DAYS.notifications);
  const second = expiresAfterDays(from, RETENTION_DAYS.notifications);
  assert.equal(first.toMillis(), second.toMillis());
  assert.ok(first.isEqual(second));
  assert.notEqual(
    expiresAfterDays(from + 1, RETENTION_DAYS.notifications).toMillis(),
    first.toMillis());
});
