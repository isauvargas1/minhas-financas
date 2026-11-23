import assert from "node:assert/strict";
import test from "node:test";
import * as firebaseAdminFirestore from "firebase-admin/firestore";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {
  RETRY_GIVE_UP_AGE_SECONDS,
  handleTransactionWrite,
  type TransactionWriteEvent,
} from "../../triggers/transactions";
import {db, uniqueId} from "../../workspaces/testSupport/p1TestSupport";
import {
  applyCashPeriodWriteOnce,
  cashPeriodEventKey,
  cashProjectionStateRef,
  readCashProjectionState,
} from "../periods";
import {
  MAX_MARK_PENDING,
  cashProjectionMarkRef,
  markViewOf,
  otherMarkSlot,
  readMarkDoc,
  transactionFingerprint,
  type MarkView,
} from "../projectionMarks";
import {executeRebuildCashPeriods, type RebuildOptions} from "../rebuild";

/**
 * P5-F.1-R3 (B03) — marcas de aplicação no Emulator: a marca muda na mesma
 * transação do delta, a cadeia de conteúdo cobre ordem, reentrega,
 * concorrência, falhas, mudança de mês, anulação e exclusão, e a
 * reconstrução recupera uma marca `broken` pela âncora da geração nova.
 *
 * Em cada cenário há um lançamento por workspace, então a parte dele na
 * projeção é a receita dos meses: a conferência é independente da marca.
 */
db();

const ACTOR = "operador-sintetico";

interface Book {
  workspaceId: string;
  ref: (id: string) => firebaseAdminFirestore.DocumentReference;
}

const book = (): Book => {
  const workspaceId = uniqueId("cash-marks-ws");
  return {
    workspaceId,
    ref: (id) => db().doc(`workspaces/${workspaceId}/transactions/${id}`),
  };
};

const income = (date: string, valueCents: number, extra = {}) => ({
  type: "receita",
  description: "Lançamento sintético",
  category: "Teste",
  valueCents,
  date,
  isPaid: true,
  userId: "uid-sintetico",
  ...extra,
});

/** Escreve no ledger e devolve o evento como o gatilho o recebe. */
const write = async (
  target: Book,
  id: string,
  data: Record<string, unknown> | null,
): Promise<TransactionWriteEvent> => {
  const ref = target.ref(id);
  const before = await ref.get();
  const result = data === null ? await ref.delete() : await ref.set(data);
  const after = data === null ? undefined : (await ref.get()).data();
  return {
    eventId: uniqueId(`evt-${id}`),
    workspaceId: target.workspaceId,
    transactionId: id,
    eventTime: result.writeTime,
    before: before.exists ? before.data() : undefined,
    after,
    beforeCreateTime: before.exists ? before.createTime : undefined,
    beforeUpdateTime: before.exists ? before.updateTime : undefined,
  };
};

const deliver = (event: TransactionWriteEvent) =>
  handleTransactionWrite(event);

const monthIncome = async (target: Book, period: string) =>
  ((await db().doc(
    `workspaces/${target.workspaceId}/cash_report_periods/${period}`,
  ).get()).data()?.incomeCents ?? 0) as number;

const monthDoc = async (target: Book, period: string) =>
  (await db().doc(
    `workspaces/${target.workspaceId}/cash_report_periods/${period}`,
  ).get()).data();

/** Visão da marca na geração vigente, como o cliente a escolheria. */
const view = async (target: Book, id: string): Promise<MarkView> => {
  const state = readCashProjectionState(
    await cashProjectionStateRef(target.workspaceId).get());
  const mark = await cashProjectionMarkRef(target.workspaceId, id).get();
  return markViewOf(readMarkDoc(mark.data()), {
    id: state.categoryGeneration,
    cutoff: state.baselineCutoff,
    slot: state.markSlot,
    role: "published",
  });
};

const aliveAs = (data: Record<string, unknown> | undefined) =>
  ({k: "alive", fp: transactionFingerprint(data ?? {})});

const assertClean = (
  current: MarkView,
  node: unknown,
  label: string,
): void => {
  assert.equal(current.kind, "rooted", `${label}: ${JSON.stringify(current)}`);
  if (current.kind !== "rooted") return;
  assert.deepEqual(current.node, node, label);
  assert.equal(current.pending.length, 0, `${label}: sem pendência`);
};

const rebuild = (
  target: Book,
  options: RebuildOptions = {},
) => executeRebuildCashPeriods(target.workspaceId, ACTOR, {
  workspaceId: target.workspaceId,
  idempotencyKey: "rebuild-key-marks",
  correlationId: "corr-rebuild-marks",
  reason: "teste sintético das marcas",
  pageSize: 3,
  dryRun: false,
}, options);

const rebuildToEnd = async (target: Book, options: RebuildOptions = {}) => {
  for (let call = 0; call < 40; call += 1) {
    const result = await rebuild(target, options);
    if (result.completed === true) return result;
  }
  assert.fail("a reconstrução não concluiu");
};

test("criação, edições, edição sem efeito, anulação, mudança de mês " +
  "retroativa e exclusão: a marca acompanha cada conteúdo aplicado",
async () => {
  const target = book();
  const e1 = await write(target, "t1", income("2026-10-05", 10_000));
  await deliver(e1);
  assertClean(await view(target, "t1"), aliveAs(e1.after), "criação");
  const generation = (await monthDoc(target, "2026-10"))?.projectionGeneration;
  assert.deepEqual(generation, {id: "g0", cutoff: null}, "etiqueta g0");

  const e2 = await write(target, "t1", income("2026-10-05", 30_000));
  await deliver(e2);
  assertClean(await view(target, "t1"), aliveAs(e2.after), "edição de valor");
  assert.equal(await monthIncome(target, "2026-10"), 30_000);

  const before = (await monthDoc(target, "2026-10"))?.updatedAt;
  const e3 = await write(target, "t1",
    income("2026-10-05", 30_000, {description: "só a descrição"}));
  await deliver(e3);
  assertClean(await view(target, "t1"), aliveAs(e3.after),
    "edição sem efeito avança a marca");
  assert.deepEqual((await monthDoc(target, "2026-10"))?.updatedAt, before,
    "edição sem efeito não grava o mês");

  const e4 = await write(target, "t1", income("2025-11-20", 30_000));
  await deliver(e4);
  assertClean(await view(target, "t1"), aliveAs(e4.after),
    "mudança de mês retroativa");
  assert.equal(await monthIncome(target, "2026-10"), 0);
  assert.equal(await monthIncome(target, "2025-11"), 30_000);

  const voided = {...e4.after, voidedAt: Timestamp.now(),
    cashEntry: {status: "voided"}};
  const e5 = await write(target, "t1", voided);
  await deliver(e5);
  assertClean(await view(target, "t1"), aliveAs(e5.after), "anulação");
  assert.equal(await monthIncome(target, "2025-11"), 0);

  const e6 = await write(target, "t1", null);
  await deliver(e6);
  assertClean(await view(target, "t1"), {k: "deleted"}, "exclusão física");
});

test("evento posterior entregue antes do anterior: pendente, sem prova, " +
  "e absorvido quando o anterior chega", async () => {
  const target = book();
  const e1 = await write(target, "t1", income("2026-03-05", 10_000));
  const e2 = await write(target, "t1", income("2026-02-10", 10_000));
  const e3 = await write(target, "t1", income("2026-02-10", 30_000));
  await deliver(e1);
  await deliver(e3);
  const pending = await view(target, "t1");
  assert.equal(pending.kind, "rooted");
  assert.equal(pending.kind === "rooted" && pending.pending.length, 1);
  assert.deepEqual(pending.kind === "rooted" && pending.node, aliveAs(e1.after),
    "o nó continua no conteúdo de e1: nada prova e3");
  // A projeção tem e1 + delta(e3), que não é o efeito de nenhum conteúdo.
  assert.equal(await monthIncome(target, "2026-03"), 10_000);
  assert.equal(await monthIncome(target, "2026-02"), 20_000);
  await deliver(e2);
  assertClean(await view(target, "t1"), aliveAs(e3.after), "cadeia fechada");
  assert.equal(await monthIncome(target, "2026-03"), 0);
  assert.equal(await monthIncome(target, "2026-02"), 30_000);
});

test("reentrega e entregas simultâneas: um delta, uma mudança de marca",
  async () => {
    const target = book();
    const e1 = await write(target, "t1", income("2026-04-05", 7_000));
    await Promise.all(Array.from({length: 6}, () => deliver(e1)));
    assertClean(await view(target, "t1"), aliveAs(e1.after), "6 em paralelo");
    assert.equal(await monthIncome(target, "2026-04"), 7_000);
    const mark = (await cashProjectionMarkRef(target.workspaceId, "t1").get())
      .updateTime;
    const again = await deliver(e1);
    assert.equal(again.projection, "duplicate");
    assert.deepEqual(
      (await cashProjectionMarkRef(target.workspaceId, "t1").get()).updateTime,
      mark, "reentrega não reescreve a marca");
    // Lançamentos diferentes do mesmo mês, em paralelo.
    const events = await Promise.all(["t2", "t3", "t4"].map((id, index) =>
      write(target, id, income("2026-04-06", 1_000 * (index + 1)))));
    await Promise.all(events.map(deliver));
    for (const event of events) {
      assertClean(await view(target, event.transactionId),
        aliveAs(event.after), event.transactionId);
    }
    assert.equal(await monthIncome(target, "2026-04"), 13_000);
  });

test("falha dentro da transação não muda marca nem projeção; falha depois " +
  "do commit não duplica", async () => {
  const target = book();
  const e1 = await write(target, "t1", income("2026-05-05", 5_000));
  await assert.rejects(handleTransactionWrite(e1, {
    insideProjection: () => {
      throw Object.assign(new Error("indisponível"), {code: 14});
    },
  }));
  assert.equal((await cashProjectionMarkRef(target.workspaceId, "t1").get())
    .exists, false, "sem marca");
  assert.equal(await monthIncome(target, "2026-05"), 0, "sem delta");
  await assert.rejects(handleTransactionWrite(e1, {
    beforeActivityLog: () => {
      throw Object.assign(new Error("indisponível"), {code: 14});
    },
  }));
  assertClean(await view(target, "t1"), aliveAs(e1.after),
    "commit da projeção e da marca juntos");
  const retry = await deliver(e1);
  assert.equal(retry.projection, "duplicate");
  assert.equal(await monthIncome(target, "2026-05"), 5_000);
});

test("janela de retry esgotada: o delta perdido deixa a cadeia sem prova; " +
  "a reconstrução recupera", async () => {
  const target = book();
  const e1 = await write(target, "t1", income("2026-06-05", 1_000));
  await deliver(e1);
  const e2 = await write(target, "t1", income("2026-06-05", 2_000));
  const lost = await handleTransactionWrite(e2, {
    insideProjection: () => {
      throw Object.assign(new Error("indisponível"), {code: 14});
    },
    now: () => e2.eventTime.toMillis() + (RETRY_GIVE_UP_AGE_SECONDS + 5) * 1000,
  });
  assert.equal(lost.projection, "failed_recorded");
  const e3 = await write(target, "t1", income("2026-06-05", 3_000));
  await deliver(e3);
  const stuck = await view(target, "t1");
  assert.equal(stuck.kind === "rooted" && stuck.pending.length, 1,
    "e3 pendente: o predecessor nunca chega");
  let state = readCashProjectionState(
    await cashProjectionStateRef(target.workspaceId).get());
  assert.equal(state.needsRebuild, true);
  await rebuildToEnd(target);
  state = readCashProjectionState(
    await cashProjectionStateRef(target.workspaceId).get());
  assert.equal(state.needsRebuild, false);
  assert.equal(state.markSlot, "b", "a geração nova está na outra posição");
  assertClean(await view(target, "t1"), aliveAs(e3.after),
    "âncora da geração nova");
  assert.equal(await monthIncome(target, "2026-06"), 3_000);
  assert.deepEqual((await monthDoc(target, "2026-06"))?.projectionGeneration,
    {id: state.categoryGeneration, cutoff: state.baselineCutoff});
});

test("marca broken por limite de pendências: registrada sem needsRebuild, " +
  "cada delta entregue aplicado, e recuperada pela reconstrução", async () => {
  const target = book();
  const first = await write(target, "t1", income("2026-07-01", 100));
  // O predecessor de todas as outras nunca é entregue.
  const skipped = await write(target, "t1", income("2026-07-01", 101));
  void skipped;
  const later: TransactionWriteEvent[] = [];
  for (let i = 0; i <= MAX_MARK_PENDING; i += 1) {
    later.push(await write(target, "t1", income("2026-07-01", 200 + i)));
  }
  await deliver(first);
  for (const event of later) await deliver(event);
  assert.deepEqual(await view(target, "t1"),
    {kind: "broken", code: "pending_overflow"});
  let state = readCashProjectionState(
    await cashProjectionStateRef(target.workspaceId).get());
  assert.equal(state.markRecoveryNeeded, true);
  assert.equal(state.needsRebuild, false, "a projeção não é divergente");
  await rebuildToEnd(target);
  state = readCashProjectionState(
    await cashProjectionStateRef(target.workspaceId).get());
  assert.equal(state.markRecoveryNeeded, false, "o corte cobre o incidente");
  const current = (await target.ref("t1").get()).data();
  assertClean(await view(target, "t1"), aliveAs(current), "recuperada");
  assert.equal(await monthIncome(target, "2026-07"), 200 + MAX_MARK_PENDING);
});

test("incidente de marca depois do corte, durante a preparação: a " +
  "publicação mantém o registro e a reconstrução seguinte o desliga",
async () => {
  const target = book();
  const stateRef = cashProjectionStateRef(target.workspaceId);
  const e0 = await write(target, "t1", income("2026-09-05", 1_000));
  await deliver(e0);
  const held: {skipped?: TransactionWriteEvent} = {};
  const result = await rebuild(target, {
    faults: {
      afterPageRead: async () => {
        if (held.skipped) return;
        // Depois do corte: o predecessor (skipped) só chega depois da
        // publicação; as seguintes estouram o teto de pendências nas duas
        // gerações (a vigente e a preparada).
        held.skipped = await write(target, "t1", income("2026-09-05", 1_001));
        const later: TransactionWriteEvent[] = [];
        for (let i = 0; i <= MAX_MARK_PENDING; i += 1) {
          later.push(
            await write(target, "t1", income("2026-09-05", 2_000 + i)));
        }
        for (const event of later) await deliver(event);
      },
    },
  });
  assert.equal(result.completed, true, JSON.stringify(result));
  const published = readCashProjectionState(await stateRef.get());
  assert.ok(published.baselineCutoff, "publicada");
  assert.equal(published.markRecoveryNeeded, true,
    "o incidente é posterior ao corte: a geração nova também o tem");
  assert.deepEqual(await view(target, "t1"),
    {kind: "broken", code: "pending_overflow"});
  // O predecessor chega depois da publicação: o delta entra, a cadeia segue
  // quebrada e não há registro novo.
  const count = published.markIssueCount;
  await deliver(held.skipped as TransactionWriteEvent);
  assert.equal(readCashProjectionState(await stateRef.get()).markIssueCount,
    count);
  assert.equal(await monthIncome(target, "2026-09"), 2_000 + MAX_MARK_PENDING);
  // A reconstrução seguinte tem corte depois do incidente.
  await rebuildToEnd(target);
  const recovered = readCashProjectionState(await stateRef.get());
  assert.equal(recovered.markRecoveryNeeded, false,
    "o corte cobre o incidente");
  const current = (await target.ref("t1").get()).data();
  assertClean(await view(target, "t1"), aliveAs(current), "recuperada");
  assert.equal(await monthIncome(target, "2026-09"), 2_000 + MAX_MARK_PENDING);
});

test("reconstrução com eventos posteriores ao corte, atrasados de antes do " +
  "corte, reentrega e posterior fora de ordem", async () => {
  const target = book();
  const e1 = await write(target, "t1", income("2026-08-05", 1_000));
  await deliver(e1);
  const pre = await write(target, "t1", income("2026-08-05", 1_500));
  // Uma chamada: checkpoint (corte), página, âncora e publicação.
  const held: {post?: TransactionWriteEvent} = {};
  const result = await rebuild(target, {
    faults: {
      afterPageRead: async () => {
        if (held.post) return;
        // Escrita depois do corte, entregue antes do commit da página.
        held.post = await write(target, "t1", income("2026-08-05", 2_000));
        await deliver(held.post);
      },
    },
  });
  assert.equal(result.completed, true, JSON.stringify(result));
  const post = held.post as TransactionWriteEvent;
  const state = readCashProjectionState(
    await cashProjectionStateRef(target.workspaceId).get());
  assert.ok(state.baselineCutoff, "publicada");
  // O evento de antes do corte chega atrasado: coberto, não mexe em nada.
  const late = await deliver(pre);
  assert.equal(late.projection, "covered_by_rebuild");
  assertClean(await view(target, "t1"), aliveAs(post.after),
    "cadeia da preparação com raiz no corte e a âncora conferida");
  assert.equal(await monthIncome(target, "2026-08"), 2_000);
  // Reentrega depois da reconstrução.
  assert.equal((await deliver(post)).projection, "duplicate");
  // Posterior entregue antes do predecessor, já na geração nova.
  const a = await write(target, "t1", income("2026-08-05", 3_000));
  const b = await write(target, "t1", income("2026-08-05", 4_000));
  await deliver(b);
  const waiting = await view(target, "t1");
  assert.equal(waiting.kind === "rooted" && waiting.pending.length, 1);
  await deliver(a);
  assertClean(await view(target, "t1"), aliveAs(b.after), "geração nova");
  assert.equal(await monthIncome(target, "2026-08"), 4_000);
  // Os deltas depois da publicação mantêm a etiqueta da geração vigente.
  const tag = (await monthDoc(target, "2026-08"))?.projectionGeneration;
  assert.equal(tag?.id, state.categoryGeneration, JSON.stringify(tag));
  assert.ok(state.baselineCutoff && tag?.cutoff?.isEqual(state.baselineCutoff),
    "corte da geração vigente na etiqueta");
});

test("entrega com commit depois do corte que leu o estado antes do " +
  "checkpoint: a publicação recomeça e a geração seguinte a cobre",
async () => {
  const target = book();
  const e1 = await write(target, "t1", income("2026-08-05", 1_000));
  await deliver(e1);
  const stateRef = cashProjectionStateRef(target.workspaceId);
  const held: {gap?: TransactionWriteEvent} = {};
  const first = await rebuild(target, {
    faults: {
      afterPageRead: async () => {
        if (held.gap) return;
        // No Emulator, o corte (`serverTimestamp`) fica alguns milissegundos
        // antes do commit do checkpoint: uma escrita nesse intervalo pode ser
        // entregue com o estado de antes dele. A entrega é reproduzida sem a
        // geração preparada no estado e, depois, o estado volta.
        const saved = (await stateRef.get()).data() as Record<string, unknown>;
        await stateRef.update({categoryStaging: FieldValue.delete()});
        held.gap = await write(target, "t2", income("2026-08-06", 500));
        const outcome = await deliver(held.gap);
        assert.equal(outcome.projection, "applied");
        await stateRef.set(saved);
      },
    },
  });
  assert.deepEqual(
    {completed: first.completed, reason: first.reason},
    {completed: false, reason: "post_cutoff_event_missed_staging"},
    JSON.stringify(first));
  // Nada foi publicado: a geração vigente continua a inicial.
  const between = readCashProjectionState(await stateRef.get());
  assert.equal(between.baselineCutoff, null);
  assert.equal(await monthIncome(target, "2026-08"), 1_500);
  // O recomeço tem corte depois do commit de t2: a varredura o ancora.
  await rebuildToEnd(target);
  const published = readCashProjectionState(await stateRef.get());
  assert.ok(published.baselineCutoff, "publicada");
  assertClean(await view(target, "t1"), aliveAs(e1.after), "t1 na base");
  assertClean(await view(target, "t2"),
    aliveAs((held.gap as TransactionWriteEvent).after), "t2 na base nova");
  assert.equal(await monthIncome(target, "2026-08"), 1_500);
});

test("muitas edições depois do corte, entregues antes do commit da página: " +
  "a raiz no estado do corte evita o teto de pendências", async () => {
  const target = book();
  const e1 = await write(target, "t1", income("2026-08-05", 1_000));
  await deliver(e1);
  const held: {last?: TransactionWriteEvent} = {};
  const edits = MAX_MARK_PENDING + 1;
  const result = await rebuild(target, {
    faults: {
      afterPageRead: async () => {
        if (held.last) return;
        // A página já leu t1 no estado do corte; as edições seguintes chegam
        // antes de a âncora ser gravada.
        for (let index = 1; index <= edits; index += 1) {
          held.last = await write(target, "t1",
            income("2026-08-05", 1_000 + index));
          await deliver(held.last);
        }
      },
    },
  });
  assert.equal(result.completed, true, JSON.stringify(result));
  assertClean(await view(target, "t1"),
    aliveAs((held.last as TransactionWriteEvent).after),
    "a cadeia começa no estado do corte e absorve cada edição");
  assert.equal(await monthIncome(target, "2026-08"), 1_000 + edits);
});

test("lançamento sem histórico de marca (anterior às marcas): sem prova até " +
  "a reconstrução, que o ancora", async () => {
  const target = book();
  await target.ref("t1").set(income("2026-09-05", 9_000)); // sem gatilho
  const e2 = await write(target, "t1", income("2026-09-05", 9_500));
  await deliver(e2);
  const legacy = await view(target, "t1");
  assert.equal(legacy.kind === "rooted" && legacy.pending.length, 1,
    "o predecessor nunca foi visto: pendente");
  await rebuildToEnd(target);
  assertClean(await view(target, "t1"), aliveAs(e2.after), "ancorado");
  assert.equal(await monthIncome(target, "2026-09"), 9_500);
});

test("lançamento apagado: depois da reconstrução, fora da base e com parte " +
  "zero", async () => {
  const target = book();
  const e1 = await write(target, "t1", income("2026-09-10", 4_000));
  await deliver(e1);
  const keep = await write(target, "t2", income("2026-01-10", 1));
  await deliver(keep);
  const gone = await write(target, "t1", null);
  await deliver(gone);
  await rebuildToEnd(target);
  assertClean(await view(target, "t1"), {k: "absent"}, "fora da base");
  // Mês órfão zerado e etiquetado com a geração nova.
  const orphan = await monthDoc(target, "2026-09");
  const state = readCashProjectionState(
    await cashProjectionStateRef(target.workspaceId).get());
  assert.equal(orphan?.incomeCents, 0);
  assert.deepEqual(orphan?.projectionGeneration,
    {id: state.categoryGeneration, cutoff: state.baselineCutoff});
});

test("recriação com o mesmo id depois do corte, com a varredura já tendo " +
  "lido o antigo: conflito vira broken, nunca prova falsa", async () => {
  const target = book();
  const e1 = await write(target, "t1", income("2026-10-01", 1_000));
  await deliver(e1);
  const held: {
    gone?: TransactionWriteEvent;
    recreated?: TransactionWriteEvent;
  } = {};
  const result = await rebuild(target, {
    faults: {
      afterPageRead: async () => {
        if (held.recreated) return;
        held.gone = await write(target, "t1", null); // o evento atrasa
        held.recreated = await write(target, "t1", income("2026-10-01", 5_000));
        await deliver(held.recreated); // a criação chega antes da página
      },
    },
  });
  assert.equal(result.completed, true, JSON.stringify(result));
  const final = await view(target, "t1");
  assert.equal(final.kind, "broken",
    "a âncora do antigo e a criação do novo conflitam: " +
      JSON.stringify(final));
  // Um evento sobre a visão em conflito grava a cadeia quebrada e registra a
  // recuperação (até aqui o conflito só aparecia na visão).
  const stateRef = cashProjectionStateRef(target.workspaceId);
  assert.equal(readCashProjectionState(await stateRef.get()).markIssueCount, 0);
  const edit = await write(target, "t1", income("2026-10-01", 6_000));
  assert.equal((await deliver(edit)).projection, "applied");
  const flagged = readCashProjectionState(await stateRef.get());
  assert.equal(flagged.markRecoveryNeeded, true, "recuperação registrada");
  assert.equal(flagged.markIssueCount, 1);
  assert.equal((await view(target, "t1")).kind, "broken");
  // Outro evento sobre a cadeia já gravada quebrada não registra de novo.
  const again = await write(target, "t1", income("2026-10-01", 6_500));
  await deliver(again);
  assert.equal(
    readCashProjectionState(await stateRef.get()).markIssueCount, 1);
  // A exclusão atrasada chega depois da publicação: ambígua, needsRebuild.
  const gone = await deliver(held.gone as TransactionWriteEvent);
  assert.equal(gone.projection, "ambiguous_delete");
  // A reconstrução seguinte recupera a prova do estado atual e, com o corte
  // depois do incidente, desliga o registro.
  await rebuildToEnd(target);
  assertClean(await view(target, "t1"), aliveAs(again.after), "recuperada");
  assert.equal(await monthIncome(target, "2026-10"), 6_500);
  assert.equal(
    readCashProjectionState(await stateRef.get()).markRecoveryNeeded, false);
});

test("falha entre a preparação e a publicação: a geração vigente fica " +
  "intacta e a seguinte usa a mesma posição de preparação", async () => {
  const target = book();
  const e1 = await write(target, "t1", income("2026-11-05", 1_000));
  await deliver(e1);
  await assert.rejects(rebuildToEnd(target, {
    faults: {
      beforePublishCommit: () => {
        throw new Error("falha sintética antes do commit");
      },
    },
  }));
  let state = readCashProjectionState(
    await cashProjectionStateRef(target.workspaceId).get());
  assert.equal(state.categoryGeneration, "g0", "nada publicado");
  assert.equal(state.markSlot, "a");
  assertClean(await view(target, "t1"), aliveAs(e1.after), "g0 intacta");
  const anchors = (await cashProjectionMarkRef(target.workspaceId, "t1").get())
    .data()?.anchors;
  assert.ok(anchors?.b, "âncora da preparação na posição b");
  assert.equal(anchors?.a, undefined);
  await rebuildToEnd(target);
  state = readCashProjectionState(
    await cashProjectionStateRef(target.workspaceId).get());
  assert.equal(state.markSlot, "b");
  assertClean(await view(target, "t1"), aliveAs(e1.after), "publicada");
});

test("poda (L-PRI-02): a marca regravada guarda só a geração vigente e a " +
  "preparada; a âncora da preparada sobrevive às entregas da preparação",
async () => {
  const target = book();
  await deliver(await write(target, "t1", income("2026-08-05", 1_000)));
  await deliver(await write(target, "t2", income("2026-08-06", 500)));
  // Edição de antes do corte, entregue só no meio da preparação.
  const late = await write(target, "t1", income("2026-08-05", 1_200));
  const stateOf = async () => readCashProjectionState(
    await cashProjectionStateRef(target.workspaceId).get());
  const markOf = async (id: string) => readMarkDoc(
    (await cashProjectionMarkRef(target.workspaceId, id).get()).data());
  const before = await stateOf();
  const stagingSlot = otherMarkSlot(before.markSlot);
  let staging: string | null = null;
  const options: RebuildOptions = {faults: {afterPageRead: async () => {
    if (staging !== null) return;
    const generation = (await stateOf()).categoryStaging?.generation;
    // Espera a página que já ancorou t1 na posição preparada.
    if (!generation ||
      (await markOf("t1")).anchors[stagingSlot]?.g !== generation) return;
    staging = generation;
    assert.equal((await deliver(late)).projection, "applied");
    const mark = await markOf("t1");
    assert.equal(mark.anchors[stagingSlot]?.g, generation,
      "a âncora da preparada sobrevive à regravação");
    assert.equal(mark.chains[before.markSlot]?.g, before.categoryGeneration,
      "a cadeia da vigente segue na marca");
  }}};
  for (let call = 0; call < 40; call += 1) {
    const result = await executeRebuildCashPeriods(target.workspaceId, ACTOR, {
      workspaceId: target.workspaceId,
      idempotencyKey: "rebuild-key-poda",
      correlationId: "corr-rebuild-poda",
      reason: "teste sintético da poda",
      pageSize: 1,
      dryRun: false,
    }, options);
    if (result.completed === true) break;
  }
  assert.ok(staging, "a entrega aconteceu durante a preparação");
  const published = await stateOf();
  assert.equal(published.categoryGeneration, staging);
  assert.equal(published.markSlot, stagingSlot);
  assertClean(await view(target, "t1"), aliveAs(late.after), "publicada");
  // Até a próxima regravação, a posição superada continua em t1.
  assert.equal((await markOf("t1")).chains[before.markSlot]?.g,
    before.categoryGeneration);
  // A regravação seguinte tira as componentes da geração superada.
  const next = await write(target, "t1", income("2026-08-05", 1_300));
  assert.equal((await deliver(next)).projection, "applied");
  const stored = (await cashProjectionMarkRef(target.workspaceId, "t1").get())
    .data();
  assert.deepEqual(Object.keys(stored?.anchors ?? {}), [stagingSlot]);
  assert.deepEqual(Object.keys(stored?.chains ?? {}), [stagingSlot]);
  assertClean(await view(target, "t1"), aliveAs(next.after),
    "geração vigente depois da poda");
  assert.equal(await monthIncome(target, "2026-08"), 1_300 + 500);
  // Segunda reconstrução: a âncora da geração superada também sai.
  await rebuildToEnd(target);
  assert.equal((await stateOf()).markSlot, before.markSlot);
  const twoAnchors = (await cashProjectionMarkRef(target.workspaceId, "t1")
    .get()).data();
  assert.deepEqual(Object.keys(twoAnchors?.anchors ?? {}).sort(), ["a", "b"]);
  const last = await write(target, "t1", income("2026-08-05", 1_400));
  assert.equal((await deliver(last)).projection, "applied");
  const final = (await cashProjectionMarkRef(target.workspaceId, "t1").get())
    .data();
  assert.deepEqual(Object.keys(final?.anchors ?? {}), [before.markSlot]);
  assert.deepEqual(Object.keys(final?.chains ?? {}), [before.markSlot]);
  assertClean(await view(target, "t1"), aliveAs(last.after),
    "segunda geração depois da poda");
  assert.equal(await monthIncome(target, "2026-08"), 1_400 + 500);
});

test("corrida entre a âncora da página e a regravação da marca pelo " +
  "gatilho: o isolamento da transação preserva as duas (F-02)", async () => {
  const target = book();
  await deliver(await write(target, "t1", income("2026-08-05", 1_000)));
  const stagingSlot = otherMarkSlot(
    readCashProjectionState(
      await cashProjectionStateRef(target.workspaceId).get()).markSlot);
  let post: TransactionWriteEvent | undefined;
  let trigger: Promise<unknown> | undefined;
  let attempts = 0;
  let result = await rebuild(target, {faults: {afterPageRead: async () => {
    if (trigger) return;
    // Escrita depois do corte. A transação do corpo do gatilho lê a marca
    // (ainda sem a âncora) e fica aberta, antes do commit, enquanto a página
    // tenta gravar a âncora com merge, sem ler a marca.
    const event = await write(target, "t1", income("2026-08-05", 2_000));
    post = event;
    let reached: () => void = () => undefined;
    const inside = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    trigger = db().runTransaction(async (transaction) => {
      attempts += 1;
      const outcome = await applyCashPeriodWriteOnce(transaction,
        event.workspaceId, cashPeriodEventKey(event.eventId), event.before,
        event.after, {
          transactionId: event.transactionId,
          action: "UPDATE",
          eventTime: event.eventTime,
          beforeCreateTime: event.beforeCreateTime,
          beforeUpdateTime: event.beforeUpdateTime,
        });
      reached();
      await gate;
      return outcome;
    });
    await inside;
    setTimeout(release, 500);
  }}});
  assert.ok(trigger && post, "a corrida aconteceu");
  await trigger;
  const first = JSON.stringify(result);
  for (let call = 0; result.completed !== true && call < 40; call += 1) {
    result = await rebuild(target);
  }
  assert.equal(result.completed, true, JSON.stringify(result));
  const state = readCashProjectionState(
    await cashProjectionStateRef(target.workspaceId).get());
  assert.equal(state.markSlot, stagingSlot, "publicada");
  const stored = (await cashProjectionMarkRef(target.workspaceId, "t1").get())
    .data();
  assert.equal(stored?.anchors?.[stagingSlot]?.g, state.categoryGeneration,
    `a âncora sobreviveu (tentativas do gatilho: ${attempts})`);
  assertClean(await view(target, "t1"), aliveAs(post?.after),
    "a cadeia confere a âncora e o conteúdo posterior ao corte");
  assert.equal(await monthIncome(target, "2026-08"), 2_000);
  console.log(`[F-02] tentativas da transação do gatilho: ${attempts}; ` +
    `primeira chamada da reconstrução: ${first}`);
});
