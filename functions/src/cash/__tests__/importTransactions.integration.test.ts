import assert from "node:assert/strict";
import test from "node:test";
import {
  FieldValue,
  Timestamp,
  type DocumentData,
} from "firebase-admin/firestore";

import {
  TRANSACTIONS_QUOTA_EXHAUSTED_MESSAGE,
} from "../../billing/quota";
import {CASH_EVENTS_COLLECTION} from "../../shared/audit";
import {formatIsoInstant} from "../../shared/commitTime";
import {saoPauloMonthKey} from "../../shared/dateKeys";
import {rateLimitDocumentId} from "../../shared/rateLimit";
import {
  defaultAccountOf,
  seedActiveAccount,
  seedMember,
  seedPaidPlan,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {handleTransactionWrite} from "../../triggers/transactions";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  importCashTransactions,
  updateCashTransaction,
  voidCashTransaction,
} from "../callables";
import {
  CASH_IMPORT_MAX_ITEMS,
  importCashTransactionsPayloadSchema,
  type ImportCashTransactionsResult,
} from "../contracts";
import {
  CASH_IMPORT_RATE_LIMIT,
  IMPORT_LINE_CONFLICT_MESSAGE,
  executeImportCashTransactions,
} from "../importTransactions";
import {cashPeriodDeltaFor, cashPeriodKeyFor} from "../periods";

/**
 * Importação autoritativa em lotes (P3-D, D-40) contra o Emulator.
 */
db();

const tenant = async (
  options: {plan?: "free" | "pro"; type?: "PF" | "PJ"} = {},
) => {
  const workspaceId = uniqueId("imp-ws");
  const owner = uniqueId("imp-owner");
  const member = uniqueId("imp-member");
  const viewer = uniqueId("imp-viewer");
  for (const uid of [owner, member, viewer]) await seedActiveAccount(uid);
  // A conta semeada nasce no Free; o padrão aqui é Pro (1.000 por mês).
  if (options.plan !== "free") await seedPaidPlan(owner, "pro");
  await seedWorkspace({workspaceId, ownerId: owner, type: options.type});
  await seedMember(workspaceId, member, "member");
  await seedMember(workspaceId, viewer, "viewer");
  return {workspaceId, owner, member, viewer};
};

const month = () => saoPauloMonthKey();

const monthRef = (workspaceId: string) =>
  db().doc(`workspaces/${workspaceId}/quota_state/transactions_${month()}`);

const setUsed = (workspaceId: string, used: number) =>
  monthRef(workspaceId).set({
    workspaceId,
    monthKey: month(),
    used,
    schemaVersion: 1,
    updatedAt: FieldValue.serverTimestamp(),
  });

const usedOf = async (workspaceId: string) =>
  (await monthRef(workspaceId).get()).get("used") as number | undefined;

const line = (index: number, overrides: Record<string, unknown> = {}) => ({
  lineId: `linha-${index}`,
  type: index % 2 === 0 ? "receita" : "despesa",
  description: `Linha ${index}`,
  category: index % 2 === 0 ? "Salário" : "Casa",
  amountCents: 1_000 + index,
  date: "2026-09-0" + String((index % 9) + 1),
  ...overrides,
});

const lines = (from: number, to: number) =>
  Array.from({length: to - from + 1}, (_, offset) => line(from + offset));

const batch = (
  workspaceId: string,
  importId: string,
  items: Array<Record<string, unknown>>,
  key = idempotencyKey(),
) => ({
  workspaceId,
  idempotencyKey: key,
  importId,
  cashAccountId: defaultAccountOf(workspaceId),
  items,
});

const run = (uid: string, data: Record<string, unknown>) =>
  call<ImportCashTransactionsResult>(importCashTransactions, uid, data);

const ledger = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/transactions`).get())
    .docs.map((doc): DocumentData => ({id: doc.id, ...doc.data()}));

const createdEvents = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/${CASH_EVENTS_COLLECTION}`)
    .get()).docs.map((doc) => doc.data())
    .filter((event) => event.operation === "cash_entry.created");

// ------------------------------------------------------------ lote válido

test("P3-D — lote válido: cada linha uma vez, auditada e contada", async () => {
  const t = await tenant({type: "PJ"});
  const importId = uniqueId("arquivo");
  const items = [
    line(1, {supplier: "Fornecedor", costCenter: "Loja", paymentMethod: "Pix"}),
    line(2, {incomeType: "Fixa"}),
    line(3),
  ];
  const result = await run(t.member, batch(t.workspaceId, importId, items));
  assert.equal(result.created, 3);
  assert.equal(result.alreadyImported, 0);
  assert.equal(result.replayed, false);
  assert.equal(result.periodKey, month());
  assert.equal(result.message, "3 lançamentos importados.");
  assert.deepEqual(result.items.map((item) => item.status),
    ["created", "created", "created"]);
  assert.equal(await usedOf(t.workspaceId), 3);

  const entries = await ledger(t.workspaceId);
  assert.equal(entries.length, 3);
  const first = entries.find((entry) =>
    entry.id === result.items[0].transactionId);
  assert.ok(first);
  assert.equal(first.valueCents, 1_001);
  assert.equal(first.value, 10.01);
  assert.equal(first.userId, t.member);
  assert.equal(first.isPaid, true);
  assert.equal(first.profileType, "PJ");
  assert.equal(first.supplier, "Fornecedor");
  assert.equal(first.cashEntry.origin, "manual");
  assert.equal(first.cashEntry.channel, "import");
  assert.equal(first.cashEntry.quotaPeriod, month());
  assert.match(first.cashEntry.importRef, /^[0-9a-f]{32}$/);
  assert.equal("lineId" in first, false);
  const events = await createdEvents(t.workspaceId);
  assert.equal(events.length, 3);
  assert.ok(events.every((event) => event.channel === "import" &&
    event.actorId === t.member && event.actorRole === "member"));
});

// --------------------------------------------------------------- contrato

test("P3-D — lote vazio, excessivo, inválido ou forjado: nada", async () => {
  const t = await tenant();
  const importId = uniqueId("arquivo");
  const invalid: Array<[string, Array<Record<string, unknown>>]> = [
    ["vazio", []],
    ["excessivo", lines(1, CASH_IMPORT_MAX_ITEMS + 1)],
    ["valor fracionado", [line(1), line(2, {amountCents: 10.5})]],
    ["valor zero", [line(1, {amountCents: 0})]],
    ["data futura", [line(1, {date: "2999-01-01"})]],
    ["linha repetida", [line(1), line(1)]],
    ["linha sem identificador", [{...line(1), lineId: ""}]],
    ["parcelado de cartão", [line(1, {type: "parcelado", cardId: "c1"})]],
    ["vínculo forjado", [line(1, {loanId: "loan-1"})]],
    ["autor forjado", [line(1, {userId: t.owner})]],
    ["centavos autoritativos", [line(1, {valueCents: 1})]],
    ["pendente", [line(1, {isPaid: false})]],
    ["parcelas", [line(1, {installments: 3})]],
  ];
  for (const [label, items] of invalid) {
    await expectHttpsError(
      run(t.owner, batch(t.workspaceId, importId, items)),
      "invalid-argument",
    ).catch((error) => {
      throw new Error(`${label}: ${String(error)}`);
    });
  }
  // A linha inválida é apontada pelo caminho do issue.
  const error = await expectHttpsError(
    run(t.owner, batch(t.workspaceId, importId,
      [line(1), line(2), line(3, {amountCents: 10.5})])),
    "invalid-argument",
  );
  const issues = (error.details as {issues: Array<{path: unknown[]}>}).issues;
  assert.deepEqual(issues[0].path.slice(0, 3), ["items", 2, "amountCents"]);
  // PF não aceita fornecedor: o lote inteiro é recusado, com a linha.
  const pj = await expectHttpsError(
    run(t.owner, batch(t.workspaceId, importId,
      [line(1), line(2, {supplier: "Fornecedor"})])),
    "invalid-argument",
  );
  assert.equal((pj.details as {lineId?: string}).lineId, "linha-2");
  assert.equal((await ledger(t.workspaceId)).length, 0);
  assert.equal(await usedOf(t.workspaceId), undefined);
});

test("P3-D — viewer, não membro e outro workspace não importam", async () => {
  const t = await tenant();
  const other = await tenant();
  const importId = uniqueId("arquivo");
  await expectHttpsError(
    run(t.viewer, batch(t.workspaceId, importId, [line(1)])),
    "permission-denied",
  );
  await expectHttpsError(
    run(other.owner, batch(t.workspaceId, importId, [line(1)])),
    "permission-denied",
  );
  await expectHttpsError(
    run(null as unknown as string, batch(t.workspaceId, importId, [line(1)])),
    "unauthenticated",
  );
  // O outro sentido: quem é do primeiro workspace não importa no segundo.
  await expectHttpsError(
    run(t.owner, batch(other.workspaceId, importId, [line(1)])),
    "permission-denied",
  );
  assert.equal((await ledger(t.workspaceId)).length, 0);
  assert.equal((await ledger(other.workspaceId)).length, 0);
});

test("P3-D — removido, suspenso, arquivado, revogado: recusa", async () => {
  const t = await tenant();
  const importId = uniqueId("arquivo");
  await seedMember(t.workspaceId, t.member, "member", "removed");
  await expectHttpsError(
    run(t.member, batch(t.workspaceId, importId, [line(1)])),
    "permission-denied",
  );
  await seedMember(t.workspaceId, t.member, "member");
  await db().doc(`users/${t.member}`).update({status: "suspended"});
  await expectHttpsError(
    run(t.member, batch(t.workspaceId, importId, [line(1)])),
    "permission-denied",
    {reason: "account_suspended"},
  );
  await db().doc(`users/${t.member}`).update({status: "active"});
  // Revogado depois da pré-checagem: a releitura na transação recusa.
  const payload = importCashTransactionsPayloadSchema.parse(
    batch(t.workspaceId, importId, [line(1)]),
  );
  await seedMember(t.workspaceId, t.member, "viewer");
  await assert.rejects(
    executeImportCashTransactions(
      {uid: t.member, workspaceId: t.workspaceId, role: "member"},
      payload,
      "req-rebaixado",
    ),
    (error: {code?: string}) => error.code === "workspace_role_denied",
  );
  await db().doc(`workspaces/${t.workspaceId}`).update({status: "archived"});
  await expectHttpsError(
    run(t.owner, batch(t.workspaceId, importId, [line(1)])),
    "failed-precondition",
    {reason: "workspace_archived"},
  );
  assert.equal((await ledger(t.workspaceId)).length, 0);
  assert.equal(await usedOf(t.workspaceId), undefined);
});

// ------------------------------------------------------------------ quota

test("P3-D — quota insuficiente para o lote: nenhuma linha", async () => {
  const t = await tenant({plan: "free"});
  await setUsed(t.workspaceId, 48);
  const importId = uniqueId("arquivo");
  const error = await expectHttpsError(
    run(t.owner, batch(t.workspaceId, importId, lines(1, 3))),
    "resource-exhausted",
    {message: TRANSACTIONS_QUOTA_EXHAUSTED_MESSAGE},
  );
  assert.deepEqual(
    {...(error.details as Record<string, unknown>)},
    {
      resource: "transactionsPerMonth", planId: "free", limit: 50, used: 48,
      periodKey: month(), requested: 3,
    },
  );
  assert.equal((await ledger(t.workspaceId)).length, 0);
  assert.equal(await usedOf(t.workspaceId), 48);
  // Duas linhas cabem.
  const ok = await run(t.owner, batch(t.workspaceId, importId, lines(1, 2)));
  assert.equal(ok.created, 2);
  assert.equal(await usedOf(t.workspaceId), 50);
});

// --------------------------------------------- idempotência e retomada

test("P3-D — repetição do lote e conflito de chave", async () => {
  const t = await tenant();
  const importId = uniqueId("arquivo");
  const data = batch(t.workspaceId, importId, lines(1, 4));
  const first = await run(t.owner, data);
  const replay = await run(t.owner, data);
  assert.deepEqual(replay, {...first, replayed: true});
  assert.equal(await usedOf(t.workspaceId), 4);
  assert.equal((await createdEvents(t.workspaceId)).length, 4);
  await expectHttpsError(
    run(t.owner, {...data, items: lines(1, 5)}),
    "failed-precondition",
    {message: "Esta chave de idempotência já foi usada com outros dados."},
  );
  assert.equal((await ledger(t.workspaceId)).length, 4);
});

test("P3-D — lotes sobrepostos: só as linhas novas contam", async () => {
  const t = await tenant();
  const importId = uniqueId("arquivo");
  await run(t.owner, batch(t.workspaceId, importId, lines(1, 3)));
  const second = await run(t.owner,
    batch(t.workspaceId, importId, lines(2, 5)));
  assert.equal(second.created, 2);
  assert.equal(second.alreadyImported, 2);
  assert.equal(second.message,
    "2 lançamentos importados; 2 já estavam registrados.");
  assert.deepEqual(second.items.map((item) => item.status), [
    "already_imported", "already_imported", "created", "created",
  ]);
  assert.equal(await usedOf(t.workspaceId), 5);
  // Tudo já importado: nada novo, nenhuma unidade.
  const again = await run(t.owner, batch(t.workspaceId, importId, lines(1, 5)));
  assert.equal(again.created, 0);
  assert.equal(again.periodKey, null);
  assert.equal(again.message,
    "Nenhum lançamento novo: 5 já estavam registrados.");
  assert.equal(await usedOf(t.workspaceId), 5);
  // Mesma linha com outro conteúdo: o lote inteiro é recusado.
  const conflict = await expectHttpsError(
    run(t.owner, batch(t.workspaceId, importId,
      [line(6), line(3, {amountCents: 99})])),
    "failed-precondition",
    {message: IMPORT_LINE_CONFLICT_MESSAGE},
  );
  assert.equal((conflict.details as {lineId?: string}).lineId, "linha-3");
  assert.equal((await ledger(t.workspaceId)).length, 5);
  // Outra importação (outro `importId`) é outra identidade.
  const fresh = await run(t.owner,
    batch(t.workspaceId, uniqueId("arquivo"), lines(1, 2)));
  assert.equal(fresh.created, 2);
  assert.equal(await usedOf(t.workspaceId), 7);
});

test("P3-D — retomada segura: arquivo em lotes, um falha", async () => {
  const t = await tenant();
  const importId = uniqueId("arquivo-grande");
  const actor = {
    uid: t.owner, workspaceId: t.workspaceId, role: "owner" as const,
  };
  const parts = [lines(1, 50), lines(51, 100), lines(101, 120)];
  const keys = parts.map(() => idempotencyKey());
  const parse = (index: number) => importCashTransactionsPayloadSchema.parse(
    batch(t.workspaceId, importId, parts[index], keys[index]),
  );
  await executeImportCashTransactions(actor, parse(0), "req-1");
  await assert.rejects(executeImportCashTransactions(actor, parse(1), "req-2", {
    beforeCommit: () => {
      throw new Error("queda sintética no meio da importação");
    },
  }));
  // Atomicidade por lote: o lote 1 inteiro valeu; o lote 2, nada.
  assert.equal((await ledger(t.workspaceId)).length, 50);
  assert.equal(await usedOf(t.workspaceId), 50);
  await executeImportCashTransactions(actor, parse(1), "req-2b");
  await executeImportCashTransactions(actor, parse(2), "req-3");
  assert.equal((await ledger(t.workspaceId)).length, 120);
  assert.equal(await usedOf(t.workspaceId), 120);
  // Reenviar tudo com chaves novas não duplica nem consome.
  for (const part of parts) {
    const result = await run(t.owner, batch(t.workspaceId, importId, part));
    assert.equal(result.created, 0);
  }
  assert.equal((await ledger(t.workspaceId)).length, 120);
  assert.equal(await usedOf(t.workspaceId), 120);
  assert.equal((await createdEvents(t.workspaceId)).length, 120);
});

// ------------------------------------------------------------ concorrência

test("P3-D — lotes concorrentes sobrepostos: a união, uma vez", async () => {
  const t = await tenant();
  const importId = uniqueId("arquivo");
  const outcomes = await Promise.allSettled([
    run(t.owner, batch(t.workspaceId, importId, lines(1, 6))),
    run(t.owner, batch(t.workspaceId, importId, lines(4, 9))),
    run(t.member, batch(t.workspaceId, importId, lines(1, 3))),
  ]);
  const fulfilled: ImportCashTransactionsResult[] = [];
  for (const outcome of outcomes) {
    if (outcome.status === "fulfilled") {
      fulfilled.push(outcome.value);
    } else {
      // Só a contenção esgotada é aceitável; nenhuma recusa de conteúdo.
      assert.equal((outcome.reason as {code?: string}).code, "aborted");
    }
  }
  assert.ok(fulfilled.length >= 1);
  // Invariante: cada linha existe uma vez e foi contada uma vez. As linhas
  // do membro são outra identidade (o ator entra no ID).
  const entries = await ledger(t.workspaceId);
  const created = fulfilled.reduce((sum, result) => sum + result.created, 0);
  assert.equal(entries.length, created);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, created);
  assert.equal(await usedOf(t.workspaceId), created);
  const ownerLines = new Set(outcomes.slice(0, 2).flatMap((outcome, i) =>
    outcome.status === "fulfilled" ?
      (i === 0 ? lines(1, 6) : lines(4, 9)).map((item) => item.lineId) :
      []));
  assert.equal(
    entries.filter((entry) => entry.userId === t.owner).length,
    ownerLines.size,
  );
});

test("P3-D — lotes concorrentes nas últimas unidades", async () => {
  const t = await tenant({plan: "free"});
  await setUsed(t.workspaceId, 46);
  const outcomes = await Promise.allSettled([
    run(t.owner, batch(t.workspaceId, uniqueId("a"), lines(1, 3))),
    run(t.member, batch(t.workspaceId, uniqueId("b"), lines(1, 3))),
  ]);
  assert.equal(
    outcomes.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  const rejected = outcomes.find((outcome) => outcome.status === "rejected") as
    PromiseRejectedResult;
  assert.ok(["resource-exhausted", "aborted"]
    .includes((rejected.reason as {code?: string}).code ?? ""));
  assert.equal(await usedOf(t.workspaceId), 49);
  assert.equal((await ledger(t.workspaceId)).length, 3);
});

// ------------------------------------------------------- vida do lançamento

test("P3-D — linha importada: corrigível, anulável, sem consumo", async () => {
  const t = await tenant();
  const result = await run(t.owner,
    batch(t.workspaceId, uniqueId("arquivo"), [line(2)]));
  const transactionId = result.items[0].transactionId;
  const version = async () => formatIsoInstant((await db()
    .doc(`workspaces/${t.workspaceId}/transactions/${transactionId}`).get())
    .get("updatedAt") as Timestamp);
  await call(updateCashTransaction, t.owner, {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId,
    expectedUpdatedAt: await version(),
    reason: "Valor importado errado",
    entry: {
      cashAccountId: defaultAccountOf(t.workspaceId),
      type: "receita", description: "Linha 2", category: "Salário",
      amountCents: 5_000, date: "2026-09-03",
    },
  });
  await call(voidCashTransaction, t.owner, {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId,
    expectedUpdatedAt: await version(),
    reason: "Linha duplicada no arquivo",
  });
  assert.equal(await usedOf(t.workspaceId), 1);
  const entry = (await ledger(t.workspaceId))[0];
  assert.equal(entry.cashEntry.status, "voided");
  assert.equal(entry.cashEntry.channel, "import");
});

test("P3-D — limite da importação: replay passa no teto", async () => {
  const t = await tenant();
  const importId = uniqueId("arquivo");
  const data = batch(t.workspaceId, importId, lines(1, 2));
  const first = await run(t.owner, data);
  const limitRef = db().doc(
    `workspaces/${t.workspaceId}/rate_limits/` +
      rateLimitDocumentId(CASH_IMPORT_RATE_LIMIT, t.owner),
  );
  assert.equal((await limitRef.get()).get("count"), 1);
  await limitRef.update({count: CASH_IMPORT_RATE_LIMIT.limit});
  await expectHttpsError(
    run(t.owner, batch(t.workspaceId, importId, lines(3, 4))),
    "failed-precondition",
    {message: /Muitas solicitações em pouco tempo/},
  );
  assert.deepEqual(await run(t.owner, data), {...first, replayed: true});
  assert.equal((await limitRef.get()).get("count"),
    CASH_IMPORT_RATE_LIMIT.limit);
  assert.equal(await usedOf(t.workspaceId), 2);
  assert.equal((await ledger(t.workspaceId)).length, 2);
});

test("P3-D — linhas importadas entram na projeção mensal uma vez", async () => {
  const t = await tenant();
  const importId = uniqueId("arquivo");
  const items = [
    line(1, {date: "2026-08-31", amountCents: 12_345}),
    line(2, {date: "2026-09-01", amountCents: 50_000}),
    line(3, {date: "2026-09-15", amountCents: 1_001}),
  ];
  const result = await run(t.owner, batch(t.workspaceId, importId, items));
  // Cada linha é uma escrita no ledger: o gatilho real recebe uma entrega
  // por linha, e a reentrega não soma de novo.
  for (const {transactionId} of result.items) {
    const doc = await db()
      .doc(`workspaces/${t.workspaceId}/transactions/${transactionId}`).get();
    const event = {
      eventId: uniqueId(`evt-${transactionId}`),
      workspaceId: t.workspaceId,
      transactionId,
      eventTime: doc.updateTime as Timestamp,
      after: doc.data(),
    };
    await handleTransactionWrite(event);
    await handleTransactionWrite(event);
  }
  const periods = (await db()
    .collection(`workspaces/${t.workspaceId}/cash_report_periods`).get()).docs
    .filter((doc) => !doc.id.startsWith("cash_periods_rebuild"))
    .map((doc) => [doc.id, doc.get("incomeCents"), doc.get("expenseCents"),
      doc.get("transactionCount")]);
  assert.deepEqual(periods.sort(), [
    ["2026-08", 0, 12_345, 1],
    ["2026-09", 50_000, 1_001, 2],
  ]);
  // A mesma soma recalculada do ledger.
  const truth: Record<string, number[]> = {};
  for (const entry of await ledger(t.workspaceId)) {
    const key = cashPeriodKeyFor(entry) as string;
    const delta = cashPeriodDeltaFor(entry);
    const bucket = truth[key] ?? [0, 0, 0];
    truth[key] = [
      bucket[0] + delta.incomeCents,
      bucket[1] + delta.expenseCents,
      bucket[2] + delta.transactionCount,
    ];
  }
  assert.deepEqual(
    Object.entries(truth).map(([key, value]) => [key, ...value]).sort(),
    periods.sort(),
  );
});
