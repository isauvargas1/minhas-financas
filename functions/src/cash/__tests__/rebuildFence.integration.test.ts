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
  emptyCashPeriodDelta,
  type CashPeriodDelta,
} from "../periods";
import {
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
  value: valueCents / 100,
  date,
  transactionDate: Timestamp.fromDate(new Date(`${date}T15:00:00.000Z`)),
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

const assertConsistent = async (target: Book, label: string) =>
  assert.deepEqual(await projected(target), await truth(target), label);

const state = async (target: Book) =>
  (await cashProjectionStateRef(target.workspaceId).get()).data();

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
  assert.equal(await state(target), undefined);
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
  assert.equal(await state(target), undefined, "nada publicado");

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
  assert.equal(await state(target), undefined, "estado intacto");
  assert.ok(await checkpoint(target), "checkpoint preservado para retomar");

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
  assert.equal(await state(target), undefined);
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

test("P3-B — limite real: 500 escritas sim, 501 não", async () => {
  const atLimit = book();
  await seedMonths(atLimit, 498); // 498 meses + estado + checkpoint = 500
  const published = await rebuild(atLimit, {pageSize: 500});
  assert.equal(published.completed, true);
  assert.equal(published.periods, 498);
  await assertConsistent(atLimit, "498 meses num commit");

  const overLimit = book();
  await seedMonths(overLimit, 499);
  await assert.rejects(
    rebuild(overLimit, {pageSize: 500}),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.details?.requiredWrites === 501 &&
      error.details?.writeLimit === 500,
  );
  assert.deepEqual(await projected(overLimit), {}, "nada publicado");
});

test("P3-B — checkpoint suporta 500 meses e recusa passar de 600", async () => {
  const target = book();
  await seedMonths(target, 601);
  const first = await rebuild(target, {pageSize: 500});
  assert.equal(first.completed, false);
  const stored = (await checkpoint(target))?.periods ?? {};
  assert.equal(Object.keys(stored).length, 500);
  await assert.rejects(
    rebuild(target, {pageSize: 500}),
    (error: unknown) =>
      error instanceof ApplicationError &&
      /excedeu 600 períodos/.test(error.message),
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
