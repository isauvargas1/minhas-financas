import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {ApplicationError} from "../../shared/errors";
import {
  handleTransactionWrite,
  type TransactionWriteEvent,
} from "../../triggers/transactions";
import {db, uniqueId} from "../../workspaces/testSupport/p1TestSupport";
import {
  cashPeriodDeltaFor,
  cashPeriodKeyFor,
  cashProjectionStateRef,
  cashWritePlanFor,
  emptyCashPeriodDelta,
  mergeCashDayDeltas,
  readCashCategoryDays,
  readCashDayDeltas,
  readCashProjectionState,
  type CashDayDeltas,
  type CashPeriodDelta,
} from "../periods";
import {
  CASH_REBUILD_CONTRACT_VIOLATION_MESSAGE,
  CASH_REBUILD_STATE_IDS,
  executeRebuildCashPeriods,
  type RebuildOptions,
} from "../rebuild";

/**
 * Reconstrução com cerca de corte (P3-B, D-38).
 *
 * A verdade é sempre o ledger: ao fim de cada cenário, depois de entregues
 * todos os eventos, a projeção publicada precisa ser igual à soma recalculada
 * dos documentos de `transactions`. Cada cenário fixa uma ordem entre leitura
 * de página, escrita no ledger, entrega do gatilho, avanço do checkpoint e
 * publicação.
 */
db();

const ACTOR = "operador-sintetico";

interface Book {
  workspaceId: string;
  ref: (id: string) => admin.firestore.DocumentReference;
}

const book = (): Book => {
  const workspaceId = uniqueId("cash-fence-ws");
  return {
    workspaceId,
    ref: (id) => db().doc(`workspaces/${workspaceId}/transactions/${id}`),
  };
};

const entry = (
  date: string,
  valueCents: number,
  type: "receita" | "despesa" = "receita",
): Record<string, unknown> => ({
  type,
  description: "Lançamento sintético",
  category: "Teste",
  valueCents,
  date,
  isPaid: true,
  userId: "uid-sintetico",
});

/** Escreve no ledger e devolve o evento que o Eventarc entregaria. */
const write = async (
  target: Book,
  id: string,
  data: Record<string, unknown> | null,
): Promise<TransactionWriteEvent> => {
  const ref = target.ref(id);
  const before = await ref.get();
  const result = data === null ? await ref.delete() : await ref.set(data);
  return {
    eventId: uniqueId(`evt-${id}`),
    workspaceId: target.workspaceId,
    transactionId: id,
    eventTime: result.writeTime,
    before: before.exists ? before.data() : undefined,
    after: data === null ? undefined : data,
    beforeCreateTime: before.exists ? before.createTime : undefined,
  };
};

/** Histórico sem gatilho entregue (anterior à projeção, ou perdido). */
const seed = async (
  target: Book,
  rows: Array<[string, string, number, ("receita" | "despesa")?]>,
) => {
  for (const [id, date, cents, type] of rows) {
    await target.ref(id).set(entry(date, cents, type));
  }
};

type Totals = Record<string, ReturnType<typeof compact>>;

const compact = (delta: CashPeriodDelta) => ({
  incomeCents: delta.incomeCents,
  expenseCents: delta.expenseCents,
  netCents: delta.netCents,
  transactionCount: delta.transactionCount,
});

const isEmpty = (delta: ReturnType<typeof compact>) =>
  Object.values(delta).every((value) => value === 0);

/** Soma recalculada do ledger inteiro: a verdade. */
const truth = async (target: Book): Promise<Totals> => {
  const snapshot = await db()
    .collection(`workspaces/${target.workspaceId}/transactions`).get();
  const sums: Record<string, CashPeriodDelta> = {};
  for (const doc of snapshot.docs) {
    const key = cashPeriodKeyFor(doc.data());
    if (!key) continue;
    const delta = cashPeriodDeltaFor(doc.data());
    const bucket = sums[key] ?? emptyCashPeriodDelta();
    bucket.incomeCents += delta.incomeCents;
    bucket.expenseCents += delta.expenseCents;
    bucket.netCents += delta.netCents;
    bucket.transactionCount += delta.transactionCount;
    sums[key] = bucket;
  }
  const result: Totals = {};
  for (const [key, delta] of Object.entries(sums)) {
    if (!isEmpty(compact(delta))) result[key] = compact(delta);
  }
  return result;
};

/** Projeção publicada, sem os documentos de estado e sem meses zerados. */
const projected = async (target: Book): Promise<Totals> => {
  const snapshot = await db()
    .collection(`workspaces/${target.workspaceId}/cash_report_periods`).get();
  const result: Totals = {};
  for (const doc of snapshot.docs) {
    const stateIds = CASH_REBUILD_STATE_IDS as readonly string[];
    if (stateIds.includes(doc.id)) continue;
    const data = doc.data() as CashPeriodDelta;
    const delta = compact({
      ...emptyCashPeriodDelta(),
      incomeCents: data.incomeCents ?? 0,
      expenseCents: data.expenseCents ?? 0,
      investmentOutflowCents: 0,
      netCents: data.netCents ?? 0,
      transactionCount: data.transactionCount ?? 0,
    });
    if (!isEmpty(delta)) result[doc.id] = delta;
  }
  return result;
};

/**
 * P5-C1: o detalhe diário de cada mês e a projeção por categoria (geração
 * vigente) também precisam ser iguais ao ledger recalculado.
 */
type DayView = Record<string, CashDayDeltas>;
type CategoryView = Record<string, {
  incomeCents: number; expenseCents: number;
  incomeCount: number; expenseCount: number;
  days: Record<string, Record<string, number>>;
}>;

const truthDetail = async (
  target: Book,
): Promise<{days: DayView; categories: CategoryView}> => {
  const snapshot = await db()
    .collection(`workspaces/${target.workspaceId}/transactions`).get();
  const days: DayView = {};
  const categories: CategoryView = {};
  for (const doc of snapshot.docs) {
    const plan = cashWritePlanFor(undefined, doc.data());
    for (const [period, monthDays] of Object.entries(plan.days)) {
      mergeCashDayDeltas(days[period] ?? (days[period] = {}), monthDays);
    }
    for (const [key, entry] of Object.entries(plan.categories)) {
      const bucket = categories[key] ?? (categories[key] = {
        incomeCents: 0, expenseCents: 0, incomeCount: 0, expenseCount: 0,
        days: {},
      });
      bucket.incomeCents += entry.totals.incomeCents;
      bucket.expenseCents += entry.totals.expenseCents;
      bucket.incomeCount += entry.totals.incomeCount;
      bucket.expenseCount += entry.totals.expenseCount;
      for (const [mmdd, delta] of Object.entries(entry.days)) {
        const day = bucket.days[mmdd] ?? (bucket.days[mmdd] = {});
        for (const [field, value] of Object.entries(delta)) {
          day[field] = (day[field] ?? 0) + (value as number);
        }
      }
    }
  }
  return {days: cleanDays(days), categories: cleanCategories(categories)};
};

const cleanDays = (view: DayView): DayView => {
  const result: DayView = {};
  for (const [period, monthDays] of Object.entries(view)) {
    const clean: CashDayDeltas = {};
    mergeCashDayDeltas(clean, monthDays);
    if (Object.keys(clean).length > 0) result[period] = clean;
  }
  return result;
};

const cleanCategories = (view: CategoryView): CategoryView => {
  const result: CategoryView = {};
  for (const [key, entry] of Object.entries(view)) {
    const days: Record<string, Record<string, number>> = {};
    for (const [mmdd, delta] of Object.entries(entry.days)) {
      const clean = Object.fromEntries(
        Object.entries(delta).filter(([, value]) => value !== 0));
      if (Object.keys(clean).length > 0) days[mmdd] = clean;
    }
    if (
      entry.incomeCents !== 0 || entry.expenseCents !== 0 ||
      entry.incomeCount !== 0 || entry.expenseCount !== 0 ||
      Object.keys(days).length > 0
    ) {
      result[key] = {...entry, days};
    }
  }
  return result;
};

const projectedDetail = async (
  target: Book,
): Promise<{days: DayView; categories: CategoryView}> => {
  const months = await db()
    .collection(`workspaces/${target.workspaceId}/cash_report_periods`).get();
  const days: DayView = {};
  for (const doc of months.docs) {
    if ((CASH_REBUILD_STATE_IDS as readonly string[]).includes(doc.id)) {
      continue;
    }
    days[doc.id] = readCashDayDeltas(doc.data().days);
  }
  const generation = readCashProjectionState(
    await cashProjectionStateRef(target.workspaceId).get(),
  ).categoryGeneration;
  const years = await db()
    .collection(`workspaces/${target.workspaceId}/cash_category_years`)
    .where("generation", "==", generation).get();
  const categories: CategoryView = {};
  for (const doc of years.docs) {
    const data = doc.data();
    categories[doc.id.slice(generation.length + 2)] = {
      incomeCents: data.incomeCents ?? 0,
      expenseCents: data.expenseCents ?? 0,
      incomeCount: data.incomeCount ?? 0,
      expenseCount: data.expenseCount ?? 0,
      days: readCashCategoryDays(data.days) as Record<
        string, Record<string, number>>,
    };
  }
  return {days: cleanDays(days), categories: cleanCategories(categories)};
};

const assertConsistent = async (target: Book, label: string) => {
  assert.deepEqual(await projected(target), await truth(target), label);
  const [actual, expected] = await Promise.all([
    projectedDetail(target), truthDetail(target),
  ]);
  assert.deepEqual(actual.days, expected.days, `${label} (dias)`);
  assert.deepEqual(actual.categories, expected.categories,
    `${label} (categorias)`);
};

const state = async (target: Book) =>
  (await cashProjectionStateRef(target.workspaceId).get()).data();

/**
 * Nenhuma publicação no estado da projeção: sem corte, sem publicação e a
 * geração de categorias inicial. Desde a P5-C1 o checkpoint real registra a
 * geração em preparação (`categoryStaging`) no próprio estado — isso não é
 * publicação: o leitor só usa `categoryGeneration` e os meses.
 */
const assertNothingPublished = async (
  target: Book,
  label: string,
  rebuildId?: unknown,
) => {
  const current = await state(target);
  assert.equal(current?.baselineCutoff, undefined, `${label}: sem corte`);
  assert.equal(current?.lastPublishedAt, undefined, `${label}: sem publicação`);
  assert.equal(current?.baselineRebuildId, undefined, `${label}: sem base`);
  assert.equal(current?.categoryGeneration, undefined,
    `${label}: geração de categorias inicial`);
  if (rebuildId !== undefined) {
    assert.equal(current?.categoryStaging?.generation, rebuildId,
      `${label}: preparação da execução em andamento`);
  }
};

const checkpoint = async (target: Book, dryRun = false) =>
  (await db()
    .doc(
      `workspaces/${target.workspaceId}/cash_report_periods/` +
        (dryRun ? "cash_periods_rebuild_dry_run" : "cash_periods_rebuild"),
    )
    .get()).data();

const rebuild = (
  target: Book,
  overrides: {pageSize?: number; dryRun?: boolean} = {},
  options: RebuildOptions = {},
) => executeRebuildCashPeriods(target.workspaceId, ACTOR, {
  workspaceId: target.workspaceId,
  idempotencyKey: "rebuild-key-0001",
  correlationId: "corr-rebuild",
  reason: "teste sintético",
  pageSize: overrides.pageSize ?? 3,
  dryRun: overrides.dryRun ?? false,
}, options);

/** Laço do operador: chama até concluir (teto para não girar à toa). */
const rebuildToEnd = async (
  target: Book,
  overrides: {pageSize?: number; dryRun?: boolean} = {},
  options: RebuildOptions = {},
) => {
  const results: Record<string, unknown>[] = [];
  for (let call = 0; call < 60; call += 1) {
    const result = await rebuild(target, overrides, options);
    results.push(result);
    if (result.completed === true) return results;
  }
  assert.fail("a reconstrução não concluiu em 60 chamadas");
};

const ids = (count: number, prefix = "a") =>
  Array.from({length: count}, (_, index) =>
    `${prefix}${String(index + 1).padStart(2, "0")}`);

// ------------------------------------------------------------ base e cursor

test("P3-B — execução inicial publica a base e o corte", async () => {
  const target = book();
  await seed(target, [
    ["a01", "2026-06-10", 1_000], ["a02", "2026-06-20", 2_000, "despesa"],
    ["a03", "2026-07-05", 3_000], ["a04", "2026-07-25", 4_000],
    ["a05", "2026-08-01", 5_000, "despesa"], ["a06", "2026-08-31", 6_000],
    ["a07", "2026-08-15", 7_000],
  ]);
  // Mês com resíduo de uma projeção antiga sem lastro no ledger.
  await db()
    .doc(`workspaces/${target.workspaceId}/cash_report_periods/2025-01`)
    .set({incomeCents: 999, netCents: 999, transactionCount: 9});

  const results = await rebuildToEnd(target);
  assert.equal(results.length, 3, "7 documentos em páginas de 3");
  const final = results[results.length - 1];
  assert.equal(final.processed, 7);
  assert.equal(final.orphans, 1);
  await assertConsistent(target, "base publicada igual ao ledger");
  const zeroed = (await db()
    .doc(`workspaces/${target.workspaceId}/cash_report_periods/2025-01`)
    .get()).data();
  assert.equal(zeroed?.incomeCents, 0, "órfão zerado");

  const fence = await state(target);
  assert.ok(fence?.baselineCutoff instanceof Timestamp);
  assert.ok(fence?.lastPublishedAt instanceof Timestamp);
  assert.ok(
    fence.lastPublishedAt.toMillis() >= fence.baselineCutoff.toMillis(),
  );
  assert.equal(fence.needsRebuild, false);
  assert.equal(await checkpoint(target), undefined, "checkpoint removido");
});

test("P3-B — retomada: cada chamada avança uma página", async () => {
  const target = book();
  await seed(target, ids(8).map((id, index) =>
    [id, `2026-0${(index % 3) + 6}-10`, (index + 1) * 100] as
      [string, string, number]));

  const first = await rebuild(target);
  assert.deepEqual(
    {completed: first.completed, processed: first.processed},
    {completed: false, processed: 3},
  );
  const afterFirst = await checkpoint(target);
  assert.equal(afterFirst?.cursor, "a03");
  const cutoff = afterFirst?.cutoff as Timestamp;

  const second = await rebuild(target);
  assert.equal(second.processed, 6);
  const afterSecond = await checkpoint(target);
  assert.equal(afterSecond?.cursor, "a06");
  assert.ok(afterSecond?.cutoff.isEqual(cutoff), "o corte não muda");
  assert.equal(afterSecond?.rebuildId, afterFirst?.rebuildId);

  const third = await rebuild(target);
  assert.equal(third.completed, true);
  assert.equal(third.processed, 8);
  await assertConsistent(target, "retomada correta");
  assert.ok((await state(target))?.baselineCutoff.isEqual(cutoff));
});

test("P3-B — simulação não publica e não toca na execução real", async () => {
  const target = book();
  await seed(target, ids(5).map((id, index) =>
    [id, "2026-08-10", (index + 1) * 1_000] as [string, string, number]));
  // Projeção divergente de propósito: a simulação não pode corrigi-la.
  const stale = {incomeCents: 1, netCents: 1, transactionCount: 1};
  await db()
    .doc(`workspaces/${target.workspaceId}/cash_report_periods/2026-08`)
    .set(stale);

  const realStep = await rebuild(target, {pageSize: 2});
  assert.equal(realStep.completed, false);
  const realCheckpoint = await checkpoint(target);
  const realState = await state(target);
  await assertNothingPublished(target, "execução real em andamento",
    realCheckpoint?.rebuildId);

  const dry = await rebuildToEnd(target, {pageSize: 2, dryRun: true});
  const dryFinal = dry[dry.length - 1];
  assert.equal(dryFinal.dryRun, true);
  assert.deepEqual(dryFinal.reconciliation, {
    ...emptyCashPeriodDelta(),
    incomeCents: 15_000, expenseCents: 0, investmentOutflowCents: 0,
    netCents: 15_000, transactionCount: 5, periodCount: 1,
  });
  // Nada publicado, estado e checkpoint real intactos.
  const after = (await db()
    .doc(`workspaces/${target.workspaceId}/cash_report_periods/2026-08`)
    .get()).data();
  assert.equal(after?.incomeCents, 1);
  assert.deepEqual(await state(target), realState,
    "simulação não toca no estado");
  assert.deepEqual(await checkpoint(target), realCheckpoint);
  assert.equal(await checkpoint(target, true), undefined);

  await rebuildToEnd(target, {pageSize: 2});
  await assertConsistent(target, "a execução real termina correta");
});

test("P3-B — repetida é idempotente e avança o corte", async () => {
  const target = book();
  await seed(target, [
    ["a01", "2026-08-10", 1_000], ["a02", "2026-09-10", 2_000, "despesa"],
  ]);
  await rebuildToEnd(target);
  const firstCutoff = (await state(target))?.baselineCutoff as Timestamp;
  const first = await projected(target);
  await rebuildToEnd(target);
  assert.deepEqual(await projected(target), first);
  const secondCutoff = (await state(target))?.baselineCutoff as Timestamp;
  assert.ok(secondCutoff.toMillis() >= firstCutoff.toMillis());
  assert.equal(secondCutoff.isEqual(firstCutoff), false);
  await assertConsistent(target, "repetição sem duplicar");
});

// ------------------------------------ mudanças no ledger durante a varredura

test("P3-B — criação na varredura, gatilho antes", async () => {
  const target = book();
  await seed(target, ids(5).map((id) =>
    [id, "2026-08-10", 1_000] as [string, string, number]));
  await rebuild(target); // lê a01..a03
  // Novo documento numa posição ainda não lida (a04 < a99 < b..) e outro
  // numa posição já lida (a00): ambos criados depois do corte.
  const ahead = await write(target, "a99", entry("2026-08-20", 500));
  const behind = await write(target, "a00", entry("2026-09-02", 700));
  assert.equal((await handleTransactionWrite(ahead)).projection, "applied");
  assert.equal((await handleTransactionWrite(behind)).projection, "applied");

  const results = await rebuildToEnd(target);
  const final = results[results.length - 1];
  assert.equal(final.postCutoffEvents, 2, "a publicação soma as duas marcas");
  await assertConsistent(target, "criações depois do corte entram uma vez");
});

test("P3-B — edição de documento não lido recomeça", async () => {
  const target = book();
  await seed(target, ids(6).map((id) =>
    [id, "2026-08-10", 1_000] as [string, string, number]));
  await rebuild(target); // lê a01..a03
  const firstCheckpoint = await checkpoint(target);
  const edit = await write(target, "a05", entry("2026-08-10", 4_000));
  await handleTransactionWrite(edit);

  const next = await rebuild(target);
  assert.deepEqual(
    {restarted: next.restarted, reason: next.reason},
    {restarted: true, reason: "ledger_changed_during_rebuild"},
  );
  const restarted = await checkpoint(target);
  assert.notEqual(restarted?.rebuildId, firstCheckpoint?.rebuildId);
  assert.equal(restarted?.cursor, null);
  assert.equal(restarted?.restarts, 1);
  await assertNothingPublished(target, "nada publicado", restarted?.rebuildId);
  assert.deepEqual((await state(target))?.categoryGarbage,
    [firstCheckpoint?.rebuildId], "preparação abandonada vai para descarte");

  await rebuildToEnd(target);
  await assertConsistent(target, "corte novo, base correta");
});

test("P3-B — edição de página lida, gatilho antes", async () => {
  const target = book();
  await seed(target, ids(5).map((id) =>
    [id, "2026-08-10", 1_000] as [string, string, number]));
  await rebuild(target); // lê a01..a03
  const edit = await write(target, "a02", entry("2026-09-15", 2_500));
  await handleTransactionWrite(edit); // aplicado na projeção viva

  const results = await rebuildToEnd(target);
  assert.equal(results[results.length - 1].postCutoffEvents, 1);
  await assertConsistent(target, "edição lida antes não se perde");
});

test("P3-B — edição de página lida, gatilho depois", async () => {
  const target = book();
  await seed(target, ids(5).map((id) =>
    [id, "2026-08-10", 1_000] as [string, string, number]));
  await rebuild(target); // lê a01..a03
  const edit = await write(target, "a01", entry("2026-08-10", 9_000));
  // O gatilho ainda não chegou quando a reconstrução publica.
  await rebuildToEnd(target);
  assert.notDeepEqual(await projected(target), await truth(target));

  assert.equal((await handleTransactionWrite(edit)).projection, "applied");
  await assertConsistent(target, "o evento posterior soma sobre a base");
});

test("P3-B — evento anterior ao corte, tardio, não soma", async () => {
  const target = book();
  // Escrita cujo gatilho atrasou: a varredura já a vê no ledger.
  const late = await write(target, "a01", entry("2026-08-10", 3_000));
  const early = await write(target, "a02", entry("2026-08-11", 2_000));
  // Uma entrega chega antes da reconstrução e vai para a projeção viva.
  await handleTransactionWrite(early);
  await rebuildToEnd(target);
  await assertConsistent(target, "base publicada");

  const outcome = await handleTransactionWrite(late);
  assert.equal(outcome.projection, "covered_by_rebuild");
  // A reentrega da entrega antiga também não soma.
  assert.equal((await handleTransactionWrite(early)).projection, "duplicate");
  await assertConsistent(target, "sem dupla contagem depois da publicação");
});

// --------------------------------------------------------------- concorrência

test("P3-B — duas execuções concorrentes, consistentes", async () => {
  const target = book();
  await seed(target, ids(10).map((id, index) =>
    [id, `2026-0${(index % 4) + 5}-10`, (index + 1) * 100] as
      [string, string, number]));
  const [left, right] = await Promise.all([
    rebuildToEnd(target, {pageSize: 2}),
    rebuildToEnd(target, {pageSize: 2}),
  ]);
  const all = [...left, ...right];
  assert.ok(all.some((result) => result.completed === true));
  // Quem perdeu a disputa por uma página recebeu `concurrent`, sem escrever.
  assert.ok(all.every((result) =>
    result.completed === true || result.concurrent === true ||
    typeof result.processed === "number"));
  await assertConsistent(target, "execuções concorrentes não somam em dobro");
  assert.equal(await checkpoint(target), undefined);
});

test("P3-B — publicação concorrente com entregas do gatilho", async () => {
  for (let round = 0; round < 3; round += 1) {
    const target = book();
    await seed(target, ids(4).map((id) =>
      [id, "2026-08-10", 1_000] as [string, string, number]));
    await rebuild(target); // lê a01..a03; falta a última página
    const edit = await write(target, "a01", entry("2026-08-10", 1_700));
    const created = await write(target, "b01", entry("2026-09-01", 900));
    const moved = await write(target, "a02", entry("2026-10-01", 1_000));
    const deliveries = [edit, created, moved].map((event) =>
      handleTransactionWrite(event));
    // Ordens diferentes por rodada: a publicação disputa com as entregas.
    const publication = round === 0 ?
      rebuild(target) :
      new Promise((resolve) => setTimeout(resolve, round * 15))
        .then(() => rebuild(target));
    const [published] = await Promise.all([publication, ...deliveries]);
    // Se a disputa fez a publicação recomeçar, o operador conclui; se ela
    // publicou, a conferência é feita sobre essa publicação, sem outra.
    if ((published as Record<string, unknown>).completed !== true) {
      await rebuildToEnd(target);
    }
    await assertConsistent(target, `rodada ${round}`);
  }
});

test("P3-B — entrega iniciada dentro da publicação é serializada", async () => {
  const target = book();
  // Sem projeção viva: o mês da publicação ainda não existe como documento.
  await seed(target, ids(4).map((id) =>
    [id, "2026-08-10", 1_000] as [string, string, number]));
  await rebuild(target); // lê a01..a03
  const edit = await write(target, "a01", entry("2026-08-10", 4_000));
  let delivery: Promise<unknown> | undefined;
  const result = await rebuild(target, {}, {
    faults: {
      // Com as leituras e escritas da publicação feitas, a entrega começa e
      // tenta gravar o mesmo mês. Meio segundo basta para ela commitar se nada
      // a segurasse.
      beforePublishCommit: async () => {
        delivery ??= handleTransactionWrite(edit);
        await Promise.race([
          delivery,
          new Promise((resolve) => setTimeout(resolve, 500)),
        ]);
      },
    },
  });
  await delivery;
  if (result.completed !== true) await rebuildToEnd(target);
  await assertConsistent(target, "nenhum delta apagado pela publicação");
});

test("P3-B — corte superado por base nova não publica", async () => {
  const target = book();
  await seed(target, ids(4).map((id) =>
    [id, "2026-08-10", 1_000] as [string, string, number]));
  await rebuild(target);
  // Outra publicação, com corte posterior, já gravou o estado.
  await cashProjectionStateRef(target.workspaceId).set({
    baselineCutoff: Timestamp.now(),
    lastPublishedAt: Timestamp.now(),
  });
  const before = await projected(target);
  const result = await rebuild(target);
  assert.equal(result.superseded, true);
  assert.deepEqual(await projected(target), before, "nada regrediu");
  assert.equal(await checkpoint(target), undefined);
});

// ------------------------------------------------------- falhas e limites

test("P3-B — falha durante a publicação não deixa estado parcial", async () => {
  const target = book();
  await seed(target, [
    ["a01", "2026-08-10", 1_000], ["a02", "2026-09-10", 2_000],
  ]);
  await db()
    .doc(`workspaces/${target.workspaceId}/cash_report_periods/2026-08`)
    .set({incomeCents: 5, netCents: 5, transactionCount: 1});
  const before = await projected(target);

  await assert.rejects(rebuild(target, {}, {
    faults: {
      beforePublishCommit: () => {
        throw new Error("falha sintética na publicação");
      },
    },
  }));
  assert.deepEqual(await projected(target), before, "nenhum mês mudou");
  const kept = await checkpoint(target);
  await assertNothingPublished(target, "estado intacto", kept?.rebuildId);
  assert.ok(kept, "checkpoint preservado para retomar");

  await rebuildToEnd(target);
  await assertConsistent(target, "a nova tentativa publica tudo");
});

test("P3-B — acima do teto de escritas recusa sem efeito", async () => {
  const target = book();
  await seed(target, ["06", "07", "08", "09"].map((month, index) =>
    [`a0${index}`, `2026-${month}-10`, 1_000] as [string, string, number]));
  await assert.rejects(
    rebuild(target, {pageSize: 10}, {publishWriteBudget: 5}),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === "domain_precondition_failed" &&
      error.details?.requiredWrites === 6,
  );
  assert.deepEqual(await projected(target), {});
  await assertNothingPublished(target, "recusa sem efeito",
    (await checkpoint(target))?.rebuildId);
  // Com orçamento suficiente, a mesma execução publica.
  await rebuild(target, {pageSize: 10}, {publishWriteBudget: 6});
  await assertConsistent(target, "publicado dentro do teto");
});

/** Um lançamento por mês a partir de jan/1980. */
const monthlyRows = (count: number) =>
  Array.from({length: count}, (_, index) => {
    const year = 1980 + Math.floor(index / 12);
    const month = String((index % 12) + 1).padStart(2, "0");
    return {
      id: `m${String(index).padStart(4, "0")}`,
      date: `${year}-${month}-15`,
    };
  });

const seedMonths = async (target: Book, count: number) => {
  const rows = monthlyRows(count);
  for (let start = 0; start < rows.length; start += 400) {
    const batch = db().batch();
    for (const row of rows.slice(start, start + 400)) {
      batch.set(target.ref(row.id), entry(row.date, 100));
    }
    await batch.commit();
  }
};

/**
 * Chama a reconstrução até ela concluir ou falhar. Desde a P5-C1 a página é
 * cortada pelo orçamento de documentos tocados por commit (shards de dias e
 * categorias), então um ledger com um lançamento por mês avança em mais de
 * uma chamada mesmo com páginas de 500.
 */
const rebuildUntilSettled = async (
  target: Book,
  overrides: {pageSize?: number} = {},
): Promise<{result?: Record<string, unknown>; error?: unknown;
  maxStoredPeriods: number}> => {
  let maxStoredPeriods = 0;
  for (let call = 0; call < 20; call += 1) {
    try {
      const result = await rebuild(target, overrides);
      const stored = (await checkpoint(target))?.periods ?? {};
      maxStoredPeriods = Math.max(maxStoredPeriods, Object.keys(stored).length);
      if (result.completed === true) return {result, maxStoredPeriods};
    } catch (error) {
      return {error, maxStoredPeriods};
    }
  }
  assert.fail("a reconstrução não terminou em 20 chamadas");
};

test("P3-B — limite real: 500 escritas sim, 501 não", async () => {
  const atLimit = book();
  await seedMonths(atLimit, 498); // 498 meses + estado + checkpoint = 500
  const published = await rebuildUntilSettled(atLimit, {pageSize: 500});
  assert.equal(published.error, undefined);
  assert.equal(published.result?.completed, true);
  assert.equal(published.result?.periods, 498);
  await assertConsistent(atLimit, "498 meses num commit");

  const overLimit = book();
  await seedMonths(overLimit, 499);
  const refused = await rebuildUntilSettled(overLimit, {pageSize: 500});
  assert.ok(
    refused.error instanceof ApplicationError &&
      refused.error.details?.requiredWrites === 501 &&
      refused.error.details?.writeLimit === 500,
    "501 escritas recusadas",
  );
  assert.deepEqual(await projected(overLimit), {}, "nada publicado");
});

test("P3-B — checkpoint suporta 500 meses e recusa passar de 600", async () => {
  const target = book();
  await seedMonths(target, 601);
  // Páginas de 250 cabem no orçamento do commit: 250 e 500 meses no
  // checkpoint; a terceira página passaria de 600 e é recusada.
  const outcome = await rebuildUntilSettled(target, {pageSize: 250});
  assert.equal(outcome.maxStoredPeriods, 500,
    `checkpoint chegou a ${outcome.maxStoredPeriods} meses`);
  assert.ok(
    outcome.error instanceof ApplicationError &&
      /excedeu 600 períodos/.test(outcome.error.message),
    "acima de 600 meses é recusado",
  );
  assert.deepEqual(await projected(target), {});
});

// ------------------------------------------------------ exclusões e incidentes

test("P3-B — exclusão na varredura recomeça", async () => {
  const target = book();
  await seed(target, ids(5).map((id) =>
    [id, "2026-08-10", 1_000] as [string, string, number]));
  await rebuild(target); // lê a01..a03
  const removal = await write(target, "a05", null);
  await handleTransactionWrite(removal);

  const next = await rebuild(target);
  assert.deepEqual(
    {restarted: next.restarted, reason: next.reason},
    {restarted: true, reason: "delete_during_rebuild"},
  );
  await rebuildToEnd(target);
  await assertConsistent(target, "corte novo depois da exclusão");
});

test("P3-B — exclusão pendente liga needsRebuild", async () => {
  const target = book();
  await seed(target, ids(5).map((id) =>
    [id, "2026-08-10", 1_000] as [string, string, number]));
  await rebuild(target); // lê a01..a03
  // Exclusão de documento já lido, com o gatilho atrasado.
  const removal = await write(target, "a02", null);
  await rebuildToEnd(target);

  const outcome = await handleTransactionWrite(removal);
  assert.equal(outcome.projection, "ambiguous_delete");
  const flagged = await state(target);
  assert.equal(flagged?.needsRebuild, true);
  assert.equal(flagged?.lastIssueCode, "ambiguous_delete");

  // A reconciliação corrige e desliga o sinal.
  await rebuildToEnd(target);
  await assertConsistent(target, "reconstrução posterior corrige");
  assert.equal((await state(target))?.needsRebuild, false);

  // Ordem oposta: excluído antes de a varredura chegar a ele. A base já não
  // o contém; somar a exclusão agora subtrairia duas vezes.
  const other = book();
  await seed(other, ids(5).map((id) =>
    [id, "2026-08-10", 1_000] as [string, string, number]));
  await rebuild(other); // lê a01..a03
  const unseen = await write(other, "a05", null);
  await rebuildToEnd(other);
  await assertConsistent(other, "a base não contém o excluído");
  assert.equal(
    (await handleTransactionWrite(unseen)).projection,
    "ambiguous_delete",
  );
  await assertConsistent(other, "a exclusão ambígua não subtrai de novo");
  assert.equal((await state(other))?.needsRebuild, true);
});

test("P3-B — incidente só é coberto por corte posterior a ele", async () => {
  const target = book();
  await seed(target, [["a01", "2026-08-10", 1_000]]);
  const failed = await write(target, "a02", entry("2026-08-11", 2_000));
  await handleTransactionWrite(failed, {
    insideProjection: () => {
      throw new TypeError("defeito sintético");
    },
  });
  assert.equal((await state(target))?.needsRebuild, true);
  await rebuildToEnd(target);
  assert.equal((await state(target))?.needsRebuild, false);
  await assertConsistent(target, "a base cobre o evento perdido");

  // Incidente posterior ao corte publicado mantém o sinal ligado.
  const later = await write(target, "a03", entry("2026-08-12", 500));
  await handleTransactionWrite(later, {
    insideProjection: () => {
      throw new TypeError("defeito sintético");
    },
  });
  assert.equal((await state(target))?.needsRebuild, true);
});

// ------------------------------------------------- contrato único (P5-C2)

test("P5-C2 — documento fora do contrato: gatilho marca, reconstrução " +
  "recusa e não publica; corrigido, publica", async () => {
  const target = book();
  await seed(target, ids(4).map((id) =>
    [id, "2026-08-10", 1_000] as [string, string, number]));
  await rebuildToEnd(target);
  await assertConsistent(target, "base inicial");
  const base = await projected(target);
  const publishedAt = (await state(target))?.lastPublishedAt;
  assert.ok(publishedAt, "base publicada");

  // Documento gravado pelo Admin SDK fora do contrato (`parcelado` legado).
  const forged = await write(target, "a05", {
    ...entry("2026-08-10", 5_000), type: "parcelado",
  });
  assert.equal((await handleTransactionWrite(forged)).projection,
    "failed_recorded");
  const flagged = await state(target);
  assert.equal(flagged?.needsRebuild, true);
  assert.equal(flagged?.lastIssueCode, "contract_violation");
  assert.equal(flagged?.lastIssueTransactionId, "a05");
  assert.deepEqual(await projected(target), base, "gatilho não aplicou nada");

  // A reconstrução recusa, com mensagem fixa em pt-BR e sem dado do documento.
  const refused = await rebuildUntilSettled(target);
  assert.equal(refused.result, undefined);
  assert.ok(
    refused.error instanceof ApplicationError &&
      refused.error.code === "domain_precondition_failed" &&
      refused.error.message === CASH_REBUILD_CONTRACT_VIOLATION_MESSAGE,
    "recusada por violação de contrato",
  );
  assert.deepEqual(await projected(target), base, "nenhum total mudou");
  const after = await state(target);
  assert.equal(after?.needsRebuild, true, "o sinal continua ligado");
  assert.ok(after?.lastPublishedAt.isEqual(publishedAt), "sem nova publicação");

  // Corrigido o documento (dentro do contrato), a reconstrução publica e
  // desliga o sinal. O gatilho do `before` inválido também é registrado.
  const fixed = await write(target, "a05", entry("2026-08-10", 5_000));
  await handleTransactionWrite(fixed);
  await rebuildToEnd(target);
  await assertConsistent(target, "reconstrução após a correção");
  assert.equal((await projected(target))["2026-08"].incomeCents, 9_000);
  assert.equal((await state(target))?.needsRebuild, false);
});

test("P5-C2 — documento sem valueCents ou sem date também recusa publicar",
  async () => {
    for (const [label, mutate] of [
      ["só value em reais", (data: Record<string, unknown>) => {
        delete data.valueCents;
        data.value = 10;
      }],
      ["valueCents decimal", (data: Record<string, unknown>) => {
        data.valueCents = 10.5;
      }],
      ["sem date", (data: Record<string, unknown>) => {
        delete data.date;
        data.transactionDate = Timestamp.fromDate(
          new Date("2026-08-10T15:00:00.000Z"));
      }],
    ] as const) {
      const target = book();
      await seed(target, ids(2).map((id) =>
        [id, "2026-08-10", 1_000] as [string, string, number]));
      const broken = entry("2026-08-10", 1_000);
      mutate(broken);
      await target.ref("a03").set(broken);

      const refused = await rebuildUntilSettled(target);
      assert.ok(
        refused.error instanceof ApplicationError &&
          refused.error.message === CASH_REBUILD_CONTRACT_VIOLATION_MESSAGE,
        label,
      );
      assert.deepEqual(await projected(target), {}, `${label}: nada publicado`);
      await assertNothingPublished(target, label);
    }
  });
