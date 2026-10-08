import assert from "node:assert/strict";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {CASH_EVENTS_COLLECTION} from "../../shared/audit";
import {saoPauloMonthKey} from "../../shared/dateKeys";
import {
  defaultAccountOf,
  seedActiveAccount,
  seedMember,
  seedPaidPlan,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {
  handleTransactionWrite,
  type TransactionWriteEvent,
} from "../../triggers/transactions";
import {
  call,
  db,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {importCashTransactions} from "../callables";
import type {ImportCashTransactionsResult} from "../contracts";
import {cashPeriodDeltaFor, cashPeriodKeyFor} from "../periods";

/**
 * Importação em rajada (P3-E): lotes simultâneos de dois atores e a entrega
 * concorrente dos eventos ao documento mensal da projeção.
 *
 * O limite operacional (12 lotes a cada 10 minutos por ator) limita o volume
 * médio, não a simultaneidade: os 12 lotes daqui chegam juntos. As entregas
 * do gatilho rodam com paralelismo 20, o `maxInstances` do gatilho real (a
 * 256 MiB cada instância atende uma entrega por vez). Entrega que falha é
 * entregue de novo, como faz o Eventarc com `retry: true`; o lote recusado
 * por contenção é reenviado com a **mesma** chave, como manda o contrato.
 */
db();

const BATCHES_PER_ACTOR = 6;
const LINES_PER_BATCH = 50;
const DELIVERY_PARALLELISM = 20;
const MAX_ROUNDS = 10;

const lineFor = (actor: number, batch: number, index: number) => ({
  lineId: `a${actor}-b${batch}-l${index}`,
  type: index % 3 === 0 ? "receita" : "despesa",
  description: `Linha ${index}`,
  category: index % 3 === 0 ? "Salário" : "Casa",
  amountCents: 1_000 + actor * 100_000 + batch * 1_000 + index,
  date: `2026-0${7 + (index % 3)}-1${index % 9}`,
});

/** Executa com paralelismo fixo; devolve o que falhou. */
const runPool = async <T>(
  items: T[],
  parallelism: number,
  run: (item: T) => Promise<unknown>,
): Promise<T[]> => {
  const failed: T[] = [];
  let next = 0;
  await Promise.all(Array.from({length: parallelism}, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      try {
        await run(item);
      } catch {
        failed.push(item);
      }
    }
  }));
  return failed;
};

test("P3-E — rajada: lotes simultâneos e projeção sem perda nem duplicação",
  async () => {
    const workspaceId = uniqueId("burst-ws");
    const owner = uniqueId("burst-owner");
    const admin = uniqueId("burst-admin");
    await seedActiveAccount(owner);
    await seedActiveAccount(admin);
    await seedPaidPlan(owner, "business");
    await seedWorkspace({workspaceId, ownerId: owner});
    await seedMember(workspaceId, admin, "admin");

    const batches = [owner, admin].flatMap((uid, actor) =>
      Array.from({length: BATCHES_PER_ACTOR}, (_, batch) => ({
        uid,
        data: {
          workspaceId,
          cashAccountId: defaultAccountOf(workspaceId),
          idempotencyKey: idempotencyKey(),
          importId: `arquivo-${actor}-${workspaceId}`,
          items: Array.from({length: LINES_PER_BATCH},
            (__, index) => lineFor(actor, batch, index)),
        },
      })));

    // 1. Os 12 lotes chegam juntos. Recusa por contenção é reenviada com a
    // mesma chave; qualquer outra recusa é falha do teste.
    const results = new Map<number, ImportCashTransactionsResult>();
    let pending = batches.map((_, index) => index);
    let importRounds = 0;
    const contended: number[] = [];
    while (pending.length > 0) {
      assert.ok(importRounds < MAX_ROUNDS, "rajada não convergiu");
      importRounds += 1;
      const outcomes = await Promise.allSettled(pending.map((index) =>
        call<ImportCashTransactionsResult>(
          importCashTransactions, batches[index].uid, batches[index].data,
        )));
      const retry: number[] = [];
      outcomes.forEach((outcome, position) => {
        const index = pending[position];
        if (outcome.status === "fulfilled") {
          results.set(index, outcome.value);
          return;
        }
        assert.equal((outcome.reason as {code?: string}).code, "aborted",
          String(outcome.reason));
        retry.push(index);
      });
      contended.push(retry.length);
      pending = retry;
    }
    const total = batches.length * LINES_PER_BATCH;
    const created = [...results.values()]
      .reduce((sum, result) => sum + result.created, 0);
    assert.equal(created, total);
    const ledger = await db()
      .collection(`workspaces/${workspaceId}/transactions`).get();
    assert.equal(ledger.size, total, "nenhuma linha perdida ou duplicada");
    const quota = await db().doc(
      `workspaces/${workspaceId}/quota_state/transactions_` +
        saoPauloMonthKey(),
    ).get();
    assert.equal(quota.get("used"), total, "quota consumida uma vez por linha");
    const events = await db()
      .collection(`workspaces/${workspaceId}/${CASH_EVENTS_COLLECTION}`)
      .get();
    assert.equal(events.size, total);

    // 2. Cada criação é entregue duas vezes ao gatilho real, com paralelismo
    // 20; as entregas que falham voltam na rodada seguinte.
    const deliveries: TransactionWriteEvent[] = ledger.docs.flatMap((doc) => {
      const event: TransactionWriteEvent = {
        eventId: `evt-${doc.id}`,
        workspaceId,
        transactionId: doc.id,
        eventTime: doc.updateTime as Timestamp,
        after: doc.data(),
      };
      return [event, event];
    });
    let toDeliver = deliveries;
    const failuresPerRound: number[] = [];
    const started = Date.now();
    while (toDeliver.length > 0) {
      assert.ok(failuresPerRound.length < MAX_ROUNDS,
        "entregas não convergiram");
      toDeliver = await runPool(toDeliver, DELIVERY_PARALLELISM,
        (event) => handleTransactionWrite(event));
      failuresPerRound.push(toDeliver.length);
    }
    const elapsedMs = Date.now() - started;

    // 3. Projeção igual à soma recalculada do ledger, mês a mês.
    const truth: Record<string, number[]> = {};
    for (const doc of ledger.docs) {
      const key = cashPeriodKeyFor(doc.data()) as string;
      const delta = cashPeriodDeltaFor(doc.data());
      const bucket = truth[key] ?? [0, 0, 0];
      truth[key] = [
        bucket[0] + delta.incomeCents,
        bucket[1] + delta.expenseCents,
        bucket[2] + delta.transactionCount,
      ];
    }
    const periods = (await db()
      .collection(`workspaces/${workspaceId}/cash_report_periods`).get()).docs
      .filter((doc) => !doc.id.startsWith("cash_periods_rebuild"))
      .map((doc) => [doc.id, doc.get("incomeCents"), doc.get("expenseCents"),
        doc.get("transactionCount")]);
    assert.deepEqual(
      periods.sort(),
      Object.entries(truth).map(([key, value]) => [key, ...value]).sort(),
    );
    assert.equal(
      periods.reduce((sum, period) => sum + (period[3] as number), 0),
      total,
      "cada lançamento contado uma vez na projeção",
    );

    // Métrica da capacidade testada, registrada na documentação da P3-E.
    console.log(JSON.stringify({
      metric: "p3e_import_burst",
      batches: batches.length,
      lines: total,
      importRounds,
      contendedBatchesPerRound: contended,
      deliveries: deliveries.length,
      deliveryParallelism: DELIVERY_PARALLELISM,
      deliveryFailuresPerRound: failuresPerRound,
      deliveryElapsedMs: elapsedMs,
      months: Object.keys(truth).length,
    }));
  });
