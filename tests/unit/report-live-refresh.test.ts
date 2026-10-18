import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIVE_REFRESH_BURST,
  LIVE_REFRESH_COALESCE_MS,
  LIVE_REFRESH_REFILL_MS,
  createLiveRefreshScheduler,
  type LiveRefreshClock,
} from '../../src/modules/reports/liveRefresh.ts';

/** Relógio falso: o tempo só anda quando o teste manda. */
const fakeClock = () => {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const clock: LiveRefreshClock = {
    now: () => now,
    setTimer: (run, ms) => {
      nextId += 1;
      timers.set(nextId, { at: now + ms, run });
      return nextId;
    },
    clearTimer: (handle) => { timers.delete(handle as number); },
  };
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].run();
    }
    now = target;
  };
  return { clock, advance, pending: () => timers.size, now: () => now };
};

const setup = () => {
  const time = fakeClock();
  const refreshes: number[] = [];
  const scheduler = createLiveRefreshScheduler(() => refreshes.push(time.clock.now()), time.clock);
  return { ...time, refreshes, scheduler };
};

test('P5-C1 — rajada de mudanças vira uma releitura, 2 s depois da última', () => {
  const { scheduler, advance, refreshes } = setup();
  for (let index = 0; index < 10; index += 1) {
    scheduler.notify();
    advance(100);
  }
  assert.deepEqual(refreshes, []);
  advance(LIVE_REFRESH_COALESCE_MS);
  assert.equal(refreshes.length, 1);
  assert.equal(refreshes[0], 900 + LIVE_REFRESH_COALESCE_MS);
});

test('P5-C1 — uso normal: cada mudança espaçada relê em 2 s, até o tamanho da rajada', () => {
  const { scheduler, advance, refreshes } = setup();
  for (let index = 0; index < LIVE_REFRESH_BURST; index += 1) {
    scheduler.notify();
    advance(LIVE_REFRESH_COALESCE_MS + 10);
  }
  assert.equal(refreshes.length, LIVE_REFRESH_BURST);
  refreshes.forEach((at, index) => {
    assert.equal(at, index * (LIVE_REFRESH_COALESCE_MS + 10) + LIVE_REFRESH_COALESCE_MS);
  });
});

test('P5-C1 — sem orçamento, a releitura espera a reposição e não se perde', () => {
  const { scheduler, advance, refreshes, now } = setup();
  // Mudanças espaçadas de 2 s até uma delas não reler mais na hora.
  let count = 0;
  for (let index = 0; index < 4 * LIVE_REFRESH_BURST; index += 1) {
    scheduler.notify();
    advance(LIVE_REFRESH_COALESCE_MS);
    if (refreshes.length === count) break;
    count = refreshes.length;
  }
  assert.ok(count >= LIVE_REFRESH_BURST, `${count} releituras antes de esgotar`);
  assert.ok(count <= LIVE_REFRESH_BURST + 2, `${count} releituras: a rajada não limita`);
  const nextRefill = (Math.floor(now() / LIVE_REFRESH_REFILL_MS) + 1) * LIVE_REFRESH_REFILL_MS;
  advance(nextRefill - now() - 1);
  assert.equal(refreshes.length, count, 'sem orçamento: ainda não relê');
  advance(1);
  assert.equal(refreshes.length, count + 1, 'relê na reposição seguinte');
  assert.equal(refreshes[refreshes.length - 1], nextRefill);
});

test('P5-C1 — escrita contínua por 1 hora: no máximo 100 releituras e uma por minuto depois da rajada', () => {
  const { scheduler, advance, refreshes } = setup();
  const hour = 60 * 60 * 1000;
  for (let elapsed = 0; elapsed < hour; elapsed += 5_000) {
    scheduler.notify();
    advance(5_000);
  }
  const maximum = LIVE_REFRESH_BURST + hour / LIVE_REFRESH_REFILL_MS;
  assert.ok(refreshes.length <= maximum, `${refreshes.length} releituras > ${maximum}`);
  assert.ok(refreshes.length * 2 < 300, 'Dashboard (duas chamadas) abaixo do limite de 300/h');
  // Frescor: depois da rajada, nunca mais de ~1 minuto sem reler.
  const gaps = refreshes.slice(1).map((at, index) => at - refreshes[index]);
  assert.ok(Math.max(...gaps) <= LIVE_REFRESH_REFILL_MS + LIVE_REFRESH_COALESCE_MS + 5_000,
    `intervalo máximo ${Math.max(...gaps)} ms`);
});

test('P5-C1 — cancelar descarta a releitura pendente', () => {
  const { scheduler, advance, refreshes, pending } = setup();
  scheduler.notify();
  scheduler.cancel();
  assert.equal(pending(), 0);
  advance(10 * LIVE_REFRESH_COALESCE_MS);
  assert.deepEqual(refreshes, []);
  scheduler.notify();
  advance(LIVE_REFRESH_COALESCE_MS);
  assert.equal(refreshes.length, 1, 'continua funcionando depois de cancelar');
});

test('P5-C1 — inatividade longa não acumula orçamento além da rajada', () => {
  const { scheduler, advance, refreshes } = setup();
  advance(24 * 60 * 60 * 1000);
  const start = refreshes.length;
  // 60 mudanças espaçadas de 2 s (2 minutos): a rajada e no máximo 2 reposições.
  for (let index = 0; index < 60; index += 1) {
    scheduler.notify();
    advance(LIVE_REFRESH_COALESCE_MS);
  }
  assert.ok(refreshes.length - start <= LIVE_REFRESH_BURST + 2,
    `${refreshes.length - start} releituras em 2 minutos depois de um dia parado`);
});
