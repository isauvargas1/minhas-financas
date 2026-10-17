import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {
  RETRY_GIVE_UP_AGE_SECONDS,
  classifyProjectionError,
  parseCloudEventTime,
} from "../../triggers/transactions";
import {RETENTION_DAYS} from "../../shared/retention";
import {
  cashPeriodDeltasFor,
  compareCommitTimes,
  emptyCashPeriodDelta,
  type CashPeriodDelta,
} from "../periods";

/** Delta completo (P3-G: campos de empréstimos valem zero aqui). */
const delta = (fields: Partial<CashPeriodDelta>): CashPeriodDelta =>
  ({...emptyCashPeriodDelta(), ...fields});

/**
 * Peças puras da projeção de caixa (P3-B): classificação de falha do
 * gatilho, hora do evento com microssegundos e deltas por período.
 */

const receita = (date: string, valueCents: number) => ({
  type: "receita",
  valueCents,
  date,
});

test("P3-B — falha passageira é relançada; permanente não", () => {
  for (const code of [1, 2, 4, 6, 8, 10, 13, 14]) {
    assert.equal(classifyProjectionError({code}), "transient", `gRPC ${code}`);
  }
  for (const code of ["aborted", "unavailable", "deadline-exceeded"]) {
    assert.equal(classifyProjectionError({code}), "transient", code);
  }
  // Transação invalidada por contenção (Emulator e produção).
  assert.equal(classifyProjectionError({
    code: 3,
    message: "Transaction is invalid or closed.",
  }), "transient");
  for (const error of [
    {code: 3, message: "Property value is not a valid number."},
    {code: 5},
    {code: 7},
    {code: 9},
    {code: "permission-denied"},
    new TypeError("defeito"),
    new Error("sem código"),
    "texto",
    null,
  ]) {
    assert.equal(
      classifyProjectionError(error),
      "permanent",
      JSON.stringify(error),
    );
  }
});

test("P3-B — a janela de desistência fica antes das 24 h do Eventarc", () => {
  assert.ok(RETRY_GIVE_UP_AGE_SECONDS < 24 * 60 * 60);
  // Uma hora de folga cobre o backoff máximo (600 s) de várias tentativas.
  assert.ok(24 * 60 * 60 - RETRY_GIVE_UP_AGE_SECONDS >= 6 * 600);
});

test("P3-B — hora do evento preserva microssegundos e fuso", () => {
  const parsed = parseCloudEventTime("2026-10-03T12:34:56.123456Z");
  assert.equal(parsed.seconds, Date.parse("2026-10-03T12:34:56Z") / 1000);
  assert.equal(parsed.nanoseconds, 123_456_000);
  const offset = parseCloudEventTime("2026-10-03T09:34:56.5-03:00");
  assert.equal(offset.seconds, parsed.seconds);
  assert.equal(offset.nanoseconds, 500_000_000);
  assert.equal(parseCloudEventTime("2026-10-03T12:34:56Z").nanoseconds, 0);
  for (const invalid of ["", "2026-10-03", "ontem", "2026-13-45T00:00:00Z"]) {
    assert.throws(() => parseCloudEventTime(invalid), invalid);
  }
});

test("P3-B — ordem de commit compara nanossegundos", () => {
  const base = new Timestamp(100, 500);
  assert.equal(compareCommitTimes(base, new Timestamp(100, 500)), 0);
  assert.ok(compareCommitTimes(base, new Timestamp(100, 501)) < 0);
  assert.ok(compareCommitTimes(base, new Timestamp(99, 999_999_999)) > 0);
  // `toMillis` empataria estes dois; a cerca não pode empatar.
  const a = new Timestamp(100, 1_000);
  const b = new Timestamp(100, 2_000);
  assert.equal(a.toMillis(), b.toMillis());
  assert.ok(compareCommitTimes(a, b) < 0);
});

test("P3-B — deltas por período: criação, edição, troca de mês e baixa", () => {
  const agosto = receita("2026-08-10", 10_000);
  assert.deepEqual(cashPeriodDeltasFor(undefined, agosto), {
    "2026-08": delta({
      incomeCents: 10_000, expenseCents: 0, investmentOutflowCents: 0,
      netCents: 10_000, transactionCount: 1,
    }),
  });
  // Edição no mesmo mês: um único delta combinado.
  assert.deepEqual(
    cashPeriodDeltasFor(agosto, receita("2026-08-20", 12_500)),
    {
      "2026-08": delta({
        incomeCents: 2_500, expenseCents: 0, investmentOutflowCents: 0,
        netCents: 2_500, transactionCount: 0,
      }),
    },
  );
  // Troca de mês: sai de um período e entra no outro.
  assert.deepEqual(
    cashPeriodDeltasFor(agosto, receita("2026-09-01", 10_000)),
    {
      "2026-08": delta({
        incomeCents: -10_000, expenseCents: 0, investmentOutflowCents: 0,
        netCents: -10_000, transactionCount: -1,
      }),
      "2026-09": delta({
        incomeCents: 10_000, expenseCents: 0, investmentOutflowCents: 0,
        netCents: 10_000, transactionCount: 1,
      }),
    },
  );
  // Baixa lógica: o documento permanece, o efeito sai.
  const baixa = cashPeriodDeltasFor(agosto, {...agosto, voidedAt: "x"});
  assert.deepEqual(baixa, {
    "2026-08": delta({
      incomeCents: -10_000, expenseCents: 0, investmentOutflowCents: 0,
      netCents: -10_000, transactionCount: -1,
    }),
  });
  // Nenhum `-0` no resultado.
  for (const value of Object.values(baixa["2026-08"])) {
    assert.equal(Object.is(value, -0), false);
  }
  // Escrita sem efeito de caixa não gera período.
  assert.deepEqual(cashPeriodDeltasFor(agosto, {...agosto, category: "y"}), {});
});

test("P3-B — marcas de entrega e limites têm TTL versionado", () => {
  assert.equal(RETENTION_DAYS.cashPeriodEvents, 90);
  assert.equal(RETENTION_DAYS.rateLimits, 2);
  // lib/cash/__tests__ → raiz do repositório.
  const indexes = JSON.parse(readFileSync(
    resolve(__dirname, "../../../../firestore.indexes.json"),
    "utf8",
  )) as {fieldOverrides: Array<Record<string, unknown>>};
  for (const group of ["cash_period_events", "rate_limits"]) {
    assert.deepEqual(
      indexes.fieldOverrides.filter((entry) => entry.collectionGroup === group),
      [{
        collectionGroup: group,
        fieldPath: "expiresAt",
        ttl: true,
        indexes: [],
      }],
      group,
    );
  }
});
