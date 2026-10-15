import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {
  handleTransactionWrite,
  RETRY_GIVE_UP_AGE_SECONDS,
  type TransactionWriteEvent,
} from "../../triggers/transactions";
import {db, uniqueId} from "../../workspaces/testSupport/p1TestSupport";
import {
  cashPeriodEventKey,
  cashProjectionStateRef,
} from "../periods";

/**
 * Recuperação do gatilho de caixa (P3-B, D-38).
 *
 * O gatilho real roda no Eventarc, fora desta suíte. Aqui a mesma função que
 * ele chama (`handleTransactionWrite`) recebe o evento como o wrapper o
 * monta: documento antes e depois e o **instante de commit** da escrita
 * (`WriteResult.writeTime`). As falhas são injetadas nos pontos exatos que o
 * contrato cobre; uma falha relançada é o que faz o Eventarc reentregar.
 */
db();

const transient = (code = 14) =>
  Object.assign(new Error("indisponível"), {code});

interface Ledger {
  workspaceId: string;
  ref: (id: string) => admin.firestore.DocumentReference;
}

const ledger = (): Ledger => {
  const workspaceId = uniqueId("cash-recovery-ws");
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

/**
 * Grava no ledger e devolve o evento que o Eventarc entregaria, com o
 * instante de commit real da escrita.
 */
const write = async (
  book: Ledger,
  id: string,
  data: Record<string, unknown> | null,
): Promise<TransactionWriteEvent> => {
  const ref = book.ref(id);
  const before = await ref.get();
  const result = data === null ? await ref.delete() : await ref.set(data);
  return {
    eventId: uniqueId(`evt-${id}`),
    workspaceId: book.workspaceId,
    transactionId: id,
    eventTime: result.writeTime,
    before: before.exists ? before.data() : undefined,
    after: data === null ? undefined : data,
    beforeCreateTime: before.exists ? before.createTime : undefined,
  };
};

const period = async (book: Ledger, key: string) =>
  (await db()
    .doc(`workspaces/${book.workspaceId}/cash_report_periods/${key}`)
    .get()).data();

const marker = async (book: Ledger, eventId: string) =>
  (await db()
    .doc(
      `workspaces/${book.workspaceId}/cash_period_events/` +
        cashPeriodEventKey(eventId),
    )
    .get()).data();

const activityLog = async (book: Ledger, eventId: string) =>
  (await db()
    .doc(
      `workspaces/${book.workspaceId}/activity_logs/transaction_` +
        cashPeriodEventKey(eventId),
    )
    .get()).data();

const projectionState = async (book: Ledger) =>
  (await cashProjectionStateRef(book.workspaceId).get()).data();

const totals = (data: admin.firestore.DocumentData | undefined) => ({
  incomeCents: data?.incomeCents ?? 0,
  expenseCents: data?.expenseCents ?? 0,
  netCents: data?.netCents ?? 0,
  transactionCount: data?.transactionCount ?? 0,
});

test("P3-B — criar, editar, mudar de mês e baixar: uma vez", async () => {
  const book = ledger();
  const created = await write(book, "tx-1", entry("2026-08-10", 10_000));
  assert.equal((await handleTransactionWrite(created)).projection, "applied");
  assert.deepEqual(totals(await period(book, "2026-08")), {
    incomeCents: 10_000, expenseCents: 0, netCents: 10_000,
    transactionCount: 1,
  });

  const edited = await write(book, "tx-1", entry("2026-08-12", 12_500));
  await handleTransactionWrite(edited);
  assert.equal((await period(book, "2026-08"))?.incomeCents, 12_500);
  assert.equal((await period(book, "2026-08"))?.transactionCount, 1);

  const moved = await write(book, "tx-1", entry("2026-09-01", 12_500));
  await handleTransactionWrite(moved);
  assert.deepEqual(totals(await period(book, "2026-08")), {
    incomeCents: 0, expenseCents: 0, netCents: 0, transactionCount: 0,
  });
  assert.equal((await period(book, "2026-09"))?.incomeCents, 12_500);

  const voided = await write(book, "tx-1", {
    ...entry("2026-09-01", 12_500),
    voidedAt: Timestamp.now(),
  });
  await handleTransactionWrite(voided);
  assert.deepEqual(totals(await period(book, "2026-09")), {
    incomeCents: 0, expenseCents: 0, netCents: 0, transactionCount: 0,
  });

  // A marca guarda o commit e os deltas que a reconstrução soma.
  const movedMarker = await marker(book, moved.eventId);
  assert.equal(movedMarker?.outcome, "applied");
  assert.ok(movedMarker?.eventTime.isEqual(moved.eventTime));
  assert.deepEqual(movedMarker?.periods, ["2026-08", "2026-09"]);
  assert.equal(movedMarker?.deltas["2026-08"].incomeCents, -12_500);
  assert.equal(movedMarker?.deltas["2026-09"].incomeCents, 12_500);
  // A trilha registra cada escrita.
  for (const event of [created, edited, moved, voided]) {
    assert.equal((await activityLog(book, event.eventId))?.entityId, "tx-1");
  }
});

test("P3-B — reentrega e entregas simultâneas: uma vez", async () => {
  const book = ledger();
  const first = await write(book, "tx-1", entry("2026-08-10", 7_000));
  assert.equal((await handleTransactionWrite(first)).projection, "applied");
  assert.equal((await handleTransactionWrite(first)).projection, "duplicate");

  const second = await write(book, "tx-2", entry("2026-08-11", 3_000));
  const outcomes = await Promise.all(
    Array.from({length: 6}, () => handleTransactionWrite(second)),
  );
  assert.equal(
    outcomes.filter((outcome) => outcome.projection === "applied").length,
    1,
  );
  assert.ok(outcomes.every((outcome) =>
    outcome.projection === "applied" || outcome.projection === "duplicate"));
  assert.equal((await period(book, "2026-08"))?.incomeCents, 10_000);
  assert.equal((await period(book, "2026-08"))?.transactionCount, 2);
});

test("P3-B — falha antes da projeção: relança e reaplica", async () => {
  const book = ledger();
  const event = await write(book, "tx-1", entry("2026-08-10", 5_000));
  await assert.rejects(
    handleTransactionWrite(event, {
      beforeProjection: () => {
        throw transient();
      },
    }),
    (error: {code?: number}) => error.code === 14,
  );
  assert.equal(await period(book, "2026-08"), undefined);
  assert.equal(await marker(book, event.eventId), undefined);
  assert.equal(await activityLog(book, event.eventId), undefined);

  assert.equal((await handleTransactionWrite(event)).projection, "applied");
  assert.equal((await period(book, "2026-08"))?.incomeCents, 5_000);
});

test("P3-B — falha na transação: nada gravado, relança", async () => {
  const book = ledger();
  const event = await write(book, "tx-1", entry("2026-08-10", 5_000));
  await assert.rejects(
    handleTransactionWrite(event, {
      insideProjection: () => {
        throw transient(13);
      },
    }),
  );
  // Período e marca são da mesma transação: nenhum dos dois existe.
  assert.equal(await period(book, "2026-08"), undefined);
  assert.equal(await marker(book, event.eventId), undefined);

  assert.equal((await handleTransactionWrite(event)).projection, "applied");
  assert.equal((await period(book, "2026-08"))?.incomeCents, 5_000);
});

test("P3-B — commit feito e falha depois: não soma de novo", async () => {
  const book = ledger();
  const event = await write(book, "tx-1", entry("2026-08-10", 5_000));
  // Commit concluído e resposta perdida: a execução termina com erro.
  await assert.rejects(handleTransactionWrite(event, {
    afterProjection: () => {
      throw transient(4);
    },
  }));
  assert.equal((await period(book, "2026-08"))?.incomeCents, 5_000);
  assert.equal((await marker(book, event.eventId))?.outcome, "applied");
  assert.equal(await activityLog(book, event.eventId), undefined);

  // Falha na escrita da trilha operacional, já com a projeção aplicada.
  await assert.rejects(handleTransactionWrite(event, {
    beforeActivityLog: () => {
      throw transient(14);
    },
  }));
  assert.equal((await period(book, "2026-08"))?.incomeCents, 5_000);

  const retry = await handleTransactionWrite(event);
  assert.deepEqual(retry, {projection: "duplicate", activityLogged: true});
  assert.equal((await period(book, "2026-08"))?.incomeCents, 5_000);
  assert.equal((await period(book, "2026-08"))?.transactionCount, 1);
  assert.equal((await activityLog(book, event.eventId))?.entityId, "tx-1");
});

test("P3-B — falha permanente: registra e não relança", async () => {
  const book = ledger();
  const event = await write(book, "tx-1", entry("2026-08-10", 5_000));
  const result = await handleTransactionWrite(event, {
    insideProjection: () => {
      throw new TypeError("defeito sintético");
    },
  });
  assert.deepEqual(result, {
    projection: "failed_recorded",
    activityLogged: false,
  });
  assert.equal(await period(book, "2026-08"), undefined);
  assert.equal(await marker(book, event.eventId), undefined);
  const state = await projectionState(book);
  assert.equal(state?.needsRebuild, true);
  assert.equal(state?.issueCount, 1);
  assert.equal(state?.lastIssueCode, "permanent_failure");
  assert.equal(state?.lastIssueTransactionId, "tx-1");
  assert.ok(state?.issueMaxEventTime.isEqual(event.eventTime));
  // Só os campos do estado: nada de valor, descrição ou categoria. Lista
  // exata, e não busca de texto: o hash e os nanossegundos dos Timestamps
  // podem conter quaisquer dígitos.
  assert.deepEqual(Object.keys(state ?? {}).sort(), [
    "id", "issueCount", "issueMaxEventTime", "kind", "lastIssueAt",
    "lastIssueCode", "lastIssueTransactionId", "needsRebuild", "updatedAt",
    "workspaceId",
  ]);
});

test("P3-B — passageira no fim da janela: registra", async () => {
  const book = ledger();
  const event = await write(book, "tx-1", entry("2026-08-10", 5_000));
  const late = () =>
    event.eventTime.toMillis() + (RETRY_GIVE_UP_AGE_SECONDS + 1) * 1000;
  const result = await handleTransactionWrite(event, {
    now: late,
    beforeProjection: () => {
      throw transient(14);
    },
  });
  assert.equal(result.projection, "failed_recorded");
  const state = await projectionState(book);
  assert.equal(state?.needsRebuild, true);
  assert.equal(state?.lastIssueCode, "retry_window_exhausted");

  // Dentro da janela, a mesma falha continua sendo relançada.
  const other = await write(book, "tx-2", entry("2026-08-11", 1_000));
  await assert.rejects(handleTransactionWrite(other, {
    beforeProjection: () => {
      throw transient(14);
    },
  }));
  assert.equal((await projectionState(book))?.issueCount, 1);
});

test("P3-B — falha só na trilha não marca o caixa", async () => {
  const book = ledger();
  const event = await write(book, "tx-1", entry("2026-08-10", 5_000));
  const result = await handleTransactionWrite(event, {
    beforeActivityLog: () => {
      throw new Error("trilha indisponível de forma permanente");
    },
  });
  assert.deepEqual(result, {projection: "applied", activityLogged: false});
  assert.equal((await period(book, "2026-08"))?.incomeCents, 5_000);
  assert.equal(await projectionState(book), undefined);
});

/**
 * P5-C2 — documento fora do contrato único (`valueCents` + `date`): nunca vira
 * R$ 0,00 nem some em silêncio. O gatilho não aplica nada, não grava marca de
 * entrega e deixa a projeção marcada para reconstrução com um código próprio.
 */
test("P5-C2 — documento fora do contrato: contract_violation, nada aplicado",
  async () => {
    const valid = entry("2026-08-10", 10_000);
    // Firestore recusa `undefined`: o campo ausente é omitido de verdade.
    const sem = (...campos: string[]): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(valid).filter(([campo]) => !campos.includes(campo)));
    const semCentavos = sem("valueCents");
    const casos: Array<[string, Record<string, unknown>]> = [
      // Legado em reais, sem `valueCents`: não é lido.
      ["só value em reais", {...semCentavos, value: 100}],
      ["sem valor algum", semCentavos],
      ["valueCents decimal", {...valid, valueCents: 10.5}],
      ["valueCents negativo", {...valid, valueCents: -10_000}],
      ["valueCents texto", {...valid, valueCents: "10000"}],
      ["valueCents acima do teto seguro",
        {...valid, valueCents: 9_007_199_254_740_992}],
      ["parcelado", {...valid, type: "parcelado"}],
      ["tipo desconhecido", {...valid, type: "transferencia"}],
      ["investimento sem marca", {...valid, type: "investimento"}],
      ["marca ilegível", {...valid, loanEntry: {}}],
      ["sem date", sem("date")],
      ["date impossível", {...valid, date: "2026-02-30"}],
      ["date com instante", {...valid, date: "2026-08-10T15:00:00.000Z"}],
      // `transactionDate` não substitui `date`.
      ["só transactionDate", {
        ...sem("date"),
        transactionDate: Timestamp.fromDate(new Date("2026-08-10T15:00:00Z")),
      }],
    ];
    for (const [label, data] of casos) {
      const book = ledger();
      const event = await write(book, "tx-1", data);
      const result = await handleTransactionWrite(event);
      assert.deepEqual(result, {
        projection: "failed_recorded",
        activityLogged: false,
      }, label);
      assert.equal(await period(book, "2026-08"), undefined, label);
      assert.equal(await marker(book, event.eventId), undefined, label);
      assert.equal(await activityLog(book, event.eventId), undefined, label);
      const state = await projectionState(book);
      assert.equal(state?.needsRebuild, true, label);
      assert.equal(state?.issueCount, 1, label);
      assert.equal(state?.lastIssueCode, "contract_violation", label);
      assert.equal(state?.lastIssueTransactionId, "tx-1", label);
      assert.ok(state?.issueMaxEventTime.isEqual(event.eventTime), label);
    }
  });

test("P5-C2 — escrita fora do contrato não altera a projeção já publicada",
  async () => {
    const book = ledger();
    const created = await write(book, "tx-1", entry("2026-08-10", 10_000));
    assert.equal((await handleTransactionWrite(created)).projection, "applied");
    const before = totals(await period(book, "2026-08"));
    assert.equal(await projectionState(book), undefined);

    // Alteração válida → inválida: o efeito anterior permanece e a projeção
    // fica marcada; a escrita inválida não é somada nem parcialmente.
    const {valueCents: _cents, ...semCentavos} = entry("2026-09-01", 99_999);
    void _cents;
    const broken = await write(book, "tx-1", {...semCentavos, value: 999.99});
    const result = await handleTransactionWrite(broken);
    assert.equal(result.projection, "failed_recorded");
    assert.deepEqual(totals(await period(book, "2026-08")), before);
    assert.equal(await period(book, "2026-09"), undefined);
    assert.equal(await marker(book, broken.eventId), undefined);
    const state = await projectionState(book);
    assert.equal(state?.needsRebuild, true);
    assert.equal(state?.lastIssueCode, "contract_violation");

    // Documento inválido que sai (exclusão) também é registrado, sem efeito.
    const removed = await write(book, "tx-1", null);
    assert.equal((await handleTransactionWrite(removed)).projection,
      "failed_recorded");
    assert.deepEqual(totals(await period(book, "2026-08")), before);
    assert.equal((await projectionState(book))?.issueCount, 2);
  });

test("P5-C2 — anulado e pendente fora do contrato de valor/data", async () => {
  // Anulado: vale zero, mesmo com dado inválido; nada é registrado.
  const book = ledger();
  const voided = await write(book, "tx-1", {
    ...entry("2026-08-10", 10_000),
    valueCents: 10.5, date: "2026-02-30", type: "parcelado",
    voidedAt: Timestamp.now(),
  });
  assert.equal((await handleTransactionWrite(voided)).projection, "applied");
  assert.equal(await projectionState(book), undefined);
  assert.equal(await period(book, "2026-08"), undefined);

  // Pendente com valor válido: zero e aplicado (sem período tocado).
  const pending = await write(book, "tx-2", {
    ...entry("2026-08-10", 10_000), isPaid: false,
    cashEntry: {status: "pending"},
  });
  assert.equal((await handleTransactionWrite(pending)).projection, "applied");
  assert.equal(await projectionState(book), undefined);
  assert.equal(await period(book, "2026-08"), undefined);

  // Pendente com `valueCents` inválido: violação, não zero.
  const badPending = await write(book, "tx-3", {
    ...entry("2026-08-10", 10.5), isPaid: false,
    cashEntry: {status: "pending"},
  });
  assert.equal((await handleTransactionWrite(badPending)).projection,
    "failed_recorded");
  assert.equal((await projectionState(book))?.lastIssueCode,
    "contract_violation");
});
