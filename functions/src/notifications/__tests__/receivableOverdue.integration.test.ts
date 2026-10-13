import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import test, {mock} from "node:test";

// Módulo cru (sem a namespace de getters do `import * as`), para o mock
// substituir `write` onde o logger estruturado o procura.
import functionsLogger = require("firebase-functions/logger");

import * as admin from "firebase-admin";
import {Query, Timestamp} from "firebase-admin/firestore";

import {assertLedgerConsistent} from
  "../../accounts/testSupport/accountTestSupport";
import {shiftDays} from "../../loans/testSupport/loanTestSupport";
import {saoPauloDayKey} from "../../shared/dateKeys";
import {
  PII,
  PII_VALUES,
  cancel,
  cancelPayload,
  editReceivable,
  newReceivable,
  receivablePayload,
  receivableRef,
  receivableUpdatePayload,
  receive,
  receivePayload,
  reverse,
  reversePayload,
  seedClient,
  seedReceivableTenant,
  type Tenant,
} from "../../receivables/testSupport/receivableTestSupport";
import {db, uniqueId} from "../../workspaces/testSupport/p1TestSupport";
import {buildNotificationDocument} from "../builder";
import {notificationIdFor} from "../ids";
import {
  RECEIVABLE_OVERDUE_OPERATION,
  processReceivableOverdueNotifications,
  receivableOverdueNotification,
  runReceivableOverdueNotifications,
  type ReceivableOverdueFaults,
  type ReceivableOverdueItemRef,
  type ReceivableOverdueSummary,
} from "../producers/receivables";
import {
  APPROVED_RETENTION_MS,
  DAY_MS,
  assertDomainUntouched,
  assertOnlyContractFields,
  assertRetention,
  domainSnapshot,
  notificationRef,
  notificationsOfType,
  overdueDeliveryRef,
  overdueQueueRef,
  sleep,
  type Doc,
} from "../testSupport/notificationTestSupport";

/**
 * P5-D2.1 — avisos de recebível vencido sem limite de dias, com trabalho
 * pendente durável, confirmação por episódio e recuperação de falhas.
 *
 * Relógio controlado: o "hoje" da rotina é `DAY` (dia civil de São Paulo) e
 * o instante de criação dos avisos é `NOW`, nunca o relógio real. `DAY` fica
 * 4 anos à frente do dia real: as operações de domínio (relógio real)
 * enfileiram todos os vencimentos dos testes como futuros, então o dia em
 * que ficam devidos é sempre o seguinte ao vencimento, em qualquer data em
 * que a suíte rode (dentro do teto de 10 anos do vencimento). Os
 * recebíveis vêm das operações reais do domínio (callables), que enfileiram
 * o trabalho na mesma transação; só os cenários de volume semeiam documentos
 * diretamente (instrumentação), no mesmo formato do domínio.
 *
 * A fila é um grupo de coleções do Emulator inteiro: os testes que comparam
 * contadores globais esvaziam antes o que estiver devido (`drain`), e os
 * demais comparam conjuntos de IDs por workspace.
 *
 * LIMITES DO EMULATOR. O Emulator não executa TTL: a expiração é simulada
 * apagando o aviso pelo Admin SDK. Ele não exige índices: a declaração é
 * verificada estaticamente (§17).
 */

db();

const DAY = shiftDays(saoPauloDayKey(), 1460);
const NOW = Date.parse(`${DAY}T09:00:00-03:00`);
const day = (offset: number) => shiftDays(DAY, offset);
const br = (dayKey: string) => dayKey.split("-").reverse().join("/");

const RECEIVABLE_PII = [PII.name, "Consultoria de outubro", ...PII_VALUES];

type RunOptions = Parameters<typeof runReceivableOverdueNotifications>[0];

const run = (options: RunOptions = {}) =>
  runReceivableOverdueNotifications({today: DAY, nowMs: NOW, ...options});

/** Esvazia o que estiver devido em `today` (de qualquer suíte). */
const drain = async (today = DAY) => {
  for (let round = 0; round < 10; round += 1) {
    const summary = await run({today});
    if (summary.scanned === 0) return;
  }
  assert.fail(`a fila não esvaziou em ${today}`);
};

const newTenant = async (prefix: string) => {
  const t = await seedReceivableTenant(prefix);
  return {t, clientId: await seedClient(t)};
};

const openReceivable = async (
  t: Tenant,
  clientId: string,
  dueDate: string,
  amountCents = 100_000,
  uid = t.owner,
) => String((await newReceivable(uid, receivablePayload(t.workspaceId,
  clientId, {dueDate, amountCents}))).receivableId);

const noticeIdOf = (workspaceId: string, receivableId: string,
  dueDate: string) => notificationIdFor({
  workspaceId, domain: "receivable", entityId: receivableId,
  eventType: "receivable_overdue", episode: dueDate,
});

const overdueNotices = (workspaceId: string) =>
  notificationsOfType(workspaceId, "receivable_overdue");

const noticesOf = async (workspaceId: string, receivableId: string) =>
  (await overdueNotices(workspaceId))
    .filter((item) => item.receivableId === receivableId);

const notifiedIds = async (workspaceId: string) =>
  new Set((await overdueNotices(workspaceId))
    .map((item) => String(item.receivableId)));

const queueOf = async (workspaceId: string, receivableId: string) =>
  (await overdueQueueRef(workspaceId, receivableId).get()).data();

const deliveryOf = async (workspaceId: string, notificationId: string) =>
  (await overdueDeliveryRef(workspaceId, notificationId).get()).data();

const deliveriesOf = async (workspaceId: string) =>
  (await db().collection(
    `workspaces/${workspaceId}/receivable_overdue_deliveries`).get()).docs;

const queueItemsOf = async (workspaceId: string) =>
  (await db().collection(
    `workspaces/${workspaceId}/receivable_overdue_queue`).get()).docs;

/** Aviso com o contrato inteiro, textos escritos à mão. */
const expectNotice = (
  item: Doc,
  expected: {
    workspaceId: string;
    receivableId: string;
    dueDate: string;
    detectedOn: string;
    createdAtMs: number;
  },
) => {
  assertOnlyContractFields(item, "receivable_overdue");
  assert.equal(item.id, noticeIdOf(expected.workspaceId,
    expected.receivableId, expected.dueDate));
  assert.match(String(item.id), /^rc_[0-9a-f]{32}$/);
  assert.equal(item.workspaceId, expected.workspaceId);
  assert.equal(item.title, "Recebível vencido");
  assert.equal(item.message, "Foi identificado atraso em " +
    `${br(expected.detectedOn)} em um recebível com vencimento em ` +
    `${br(expected.dueDate)}, que tinha saldo a receber.`);
  assert.equal(item.type, "warning");
  assert.equal(item.link, "clients_receivables");
  assert.equal(item.actionLabel, "Ver recebíveis");
  assert.equal(item.source, "receivable");
  assert.equal(item.domain, "receivable");
  assert.equal(item.domainEventType, "receivable_overdue");
  assert.equal(item.receivableId, expected.receivableId);
  assert.equal(item.createdAt, new Date(expected.createdAtMs).toISOString());
  assertRetention(item);
  assertNoWords(item, RECEIVABLE_PII);
};

/** Nenhuma palavra proibida em nenhum valor (Timestamps em ISO). */
const assertNoWords = (value: unknown, words: string[]) => {
  const text = JSON.stringify(value, (_key, inner) =>
    inner instanceof Timestamp ? inner.toDate().toISOString() : inner);
  for (const word of words) {
    assert.ok(!text.toLowerCase().includes(word.toLowerCase()),
      `sem "${word}"`);
  }
};

/** Confirmação do episódio: campos exatos, só identificadores e datas. */
const expectDelivery = async (
  workspaceId: string,
  receivableId: string,
  dueDate: string,
  origin: "published" | "reconciled" = "published",
) => {
  const notificationId = noticeIdOf(workspaceId, receivableId, dueDate);
  const data = await deliveryOf(workspaceId, notificationId);
  assert.ok(data, `confirmação de ${receivableId}/${dueDate}`);
  assert.deepEqual(Object.keys(data).sort(), ["deliveredAt", "episode",
    "notificationId", "origin", "receivableId", "runId", "schemaVersion",
    "workspaceId"]);
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.workspaceId, workspaceId);
  assert.equal(data.receivableId, receivableId);
  assert.equal(data.episode, dueDate);
  assert.equal(data.notificationId, notificationId);
  assert.equal(data.origin, origin);
  assert.ok(data.deliveredAt instanceof Timestamp);
  assert.ok(!("expiresAt" in data), "a confirmação não expira");
  assertNoWords(data, RECEIVABLE_PII);
  return data;
};

/** Falha injetada só para os recebíveis indicados. */
const failFor = (
  stage: keyof ReceivableOverdueFaults,
  receivableIds: Iterable<string>,
  error: () => Error = () => Object.assign(
    new Error("falha injetada"), {code: 14}),
): ReceivableOverdueFaults => {
  const targets = new Set(receivableIds);
  return {
    [stage]: (item: ReceivableOverdueItemRef) => {
      if (targets.has(item.receivableId)) throw error();
    },
  };
};

/** Falha sem código gRPC: não transitória (`unknown`), o SDK não repete. */
const permanent = () => new Error("falha injetada");

type LogEntry = Record<string, unknown>;

const captureLogs = async <T>(
  body: () => Promise<T>,
): Promise<{result: T; logs: LogEntry[]}> => {
  const logs: LogEntry[] = [];
  const spy = mock.method(functionsLogger, "write", (entry: LogEntry) => {
    logs.push(entry);
  });
  try {
    return {result: await body(), logs};
  } finally {
    spy.mock.restore();
  }
};

const ZERO_COUNTERS = {
  scanned: 0, published: 0, alreadyDelivered: 0, reconciled: 0, closed: 0,
  rescheduled: 0, invalid: 0, gone: 0, failed: 0, persistentFailures: 0,
  retriedSameDay: 0, retryNotRecorded: 0, deferred: 0, throttled: 0,
};

const countersOf = (summary: ReceivableOverdueSummary) => ({
  scanned: summary.scanned,
  published: summary.published,
  alreadyDelivered: summary.alreadyDelivered,
  reconciled: summary.reconciled,
  closed: summary.closed,
  rescheduled: summary.rescheduled,
  invalid: summary.invalid,
  gone: summary.gone,
  failed: summary.failed,
  persistentFailures: summary.persistentFailures,
  retriedSameDay: summary.retriedSameDay,
  retryNotRecorded: summary.retryNotRecorded,
  deferred: summary.deferred,
  throttled: summary.throttled,
});

// ============================================================ §15 funcional

test("P5-D2.1 §15.1 cadastrados já vencidos há 1, 7, 8, 30, 180 e 400 " +
  "dias: um aviso por recebível, sem limite de dias, com confirmação e sem " +
  "dado pessoal", async () => {
  await drain();
  const {t, clientId} = await newTenant("p21a");
  const offsets = [1, 7, 8, 30, 180, 400];
  const ids = new Map<string, string>();
  for (const offset of offsets) {
    ids.set(await openReceivable(t, clientId, day(-offset)), day(-offset));
  }
  for (const [receivableId, dueDate] of ids) {
    const item = await queueOf(t.workspaceId, receivableId);
    assert.ok(item, "a criação enfileira na mesma transação");
    assert.equal(item.runAfterDay, shiftDays(dueDate, 1));
    assert.equal(item.dueDate, dueDate);
    assert.equal(item.attempts, 0);
  }
  const summary = await run();
  assert.deepEqual(countersOf(summary), {...ZERO_COUNTERS, scanned: 6,
    published: 6});
  assert.equal(summary.outcome, "drained");
  assert.equal(summary.pendingDueAtEnd, 0);
  const notices = await overdueNotices(t.workspaceId);
  assert.equal(notices.length, 6);
  for (const [receivableId, dueDate] of ids) {
    const [notice] = notices.filter((item) =>
      item.receivableId === receivableId);
    expectNotice(notice, {workspaceId: t.workspaceId, receivableId, dueDate,
      detectedOn: DAY, createdAtMs: NOW});
    await expectDelivery(t.workspaceId, receivableId, dueDate);
    assert.equal(await queueOf(t.workspaceId, receivableId), undefined,
      "entregue, o trabalho sai da fila");
  }
});

test("P5-D2.1 §15.2 vence hoje e vence no futuro não avisam; vencem sem " +
  "nenhuma escrita e avisam no dia seguinte ao vencimento", async () => {
  const {t, clientId} = await newTenant("p21b");
  const dueToday = await openReceivable(t, clientId, DAY);
  const future = await openReceivable(t, clientId, day(5));
  await run();
  assert.deepEqual(await overdueNotices(t.workspaceId), []);
  assert.equal((await queueOf(t.workspaceId, dueToday))?.runAfterDay, day(1));
  assert.equal((await queueOf(t.workspaceId, future))?.runAfterDay, day(6));

  await run({today: day(1), nowMs: NOW + DAY_MS});
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set([dueToday]));
  expectNotice((await noticesOf(t.workspaceId, dueToday))[0], {
    workspaceId: t.workspaceId, receivableId: dueToday, dueDate: DAY,
    detectedOn: day(1), createdAtMs: NOW + DAY_MS});

  await run({today: day(5), nowMs: NOW + 5 * DAY_MS});
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set([dueToday]),
    "no dia do vencimento ainda não está vencido");
  await run({today: day(6), nowMs: NOW + 6 * DAY_MS});
  assert.deepEqual(await notifiedIds(t.workspaceId),
    new Set([dueToday, future]));
  expectNotice((await noticesOf(t.workspaceId, future))[0], {
    workspaceId: t.workspaceId, receivableId: future, dueDate: day(5),
    detectedOn: day(6), createdAtMs: NOW + 6 * DAY_MS});
});

test("P5-D2.1 §15.3 parcialmente recebido avisa uma vez; outro recebimento " +
  "parcial depois do aviso não reabre o trabalho nem duplica", async () => {
  const {t, clientId} = await newTenant("p21c");
  const id = await openReceivable(t, clientId, day(-3));
  const first = await receive(t.owner, await receivePayload(t.workspaceId, id,
    {principalCents: 30_000}));
  assert.equal(first.status, "open");
  assert.ok(await queueOf(t.workspaceId, id), "parcial mantém o trabalho");
  await run();
  assert.equal((await noticesOf(t.workspaceId, id)).length, 1);
  const second = await receive(t.owner, await receivePayload(t.workspaceId,
    id, {principalCents: 30_000}));
  assert.equal(second.status, "open");
  assert.equal(second.balanceCents, 40_000);
  assert.equal(await queueOf(t.workspaceId, id), undefined,
    "o recebimento parcial não escreve na fila");
  await run({today: day(1), nowMs: NOW + DAY_MS});
  const notices = await noticesOf(t.workspaceId, id);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].createdAt, new Date(NOW).toISOString());
  assert.equal((await deliveriesOf(t.workspaceId)).length, 1);
});

test("P5-D2.1 §15.4 quitado, cancelado e com saldo zerado por desconto não " +
  "avisam: o trabalho sai da fila na mesma transação", async () => {
  const {t, clientId} = await newTenant("p21d");
  const paid = await openReceivable(t, clientId, day(-2));
  const cancelled = await openReceivable(t, clientId, day(-2));
  const discounted = await openReceivable(t, clientId, day(-2));
  assert.equal((await receive(t.owner, await receivePayload(t.workspaceId,
    paid, {principalCents: 100_000}))).status, "received");
  assert.equal((await cancel(t.owner, await cancelPayload(t.workspaceId,
    cancelled))).status, "cancelled");
  const zero = await receive(t.owner, await receivePayload(t.workspaceId,
    discounted, {principalCents: 0, discountCents: 100_000}));
  assert.equal(zero.status, "received");
  assert.equal(zero.balanceCents, 0);
  for (const id of [paid, cancelled, discounted]) {
    assert.equal(await queueOf(t.workspaceId, id), undefined);
  }
  await run();
  assert.deepEqual(await overdueNotices(t.workspaceId), []);
  assert.deepEqual(await deliveriesOf(t.workspaceId), []);
});

test("P5-D2.1 §15.5 vencimento futuro alterado para o passado: o novo " +
  "episódio avisa com a nova data", async () => {
  const {t, clientId} = await newTenant("p21e");
  const id = await openReceivable(t, clientId, day(10));
  await run();
  assert.deepEqual(await overdueNotices(t.workspaceId), []);
  await editReceivable(t.owner, await receivableUpdatePayload(t.workspaceId,
    id, {dueDate: day(-3)}));
  assert.equal((await queueOf(t.workspaceId, id))?.runAfterDay, day(-2));
  await run();
  const notices = await noticesOf(t.workspaceId, id);
  assert.equal(notices.length, 1);
  expectNotice(notices[0], {workspaceId: t.workspaceId, receivableId: id,
    dueDate: day(-3), detectedOn: DAY, createdAtMs: NOW});
});

test("P5-D2.1 §15.6 vencimento passado alterado para o futuro antes do " +
  "aviso: o episódio anterior não emite; o novo emite quando vencer",
async () => {
  const {t, clientId} = await newTenant("p21f");
  const id = await openReceivable(t, clientId, day(-3));
  await editReceivable(t.owner, await receivableUpdatePayload(t.workspaceId,
    id, {dueDate: day(4)}));
  await run();
  assert.deepEqual(await overdueNotices(t.workspaceId), []);
  assert.equal((await queueOf(t.workspaceId, id))?.dueDate, day(4));
  await run({today: day(5), nowMs: NOW + 5 * DAY_MS});
  const notices = await noticesOf(t.workspaceId, id);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].id, noticeIdOf(t.workspaceId, id, day(4)));
  assert.equal(await deliveryOf(t.workspaceId,
    noticeIdOf(t.workspaceId, id, day(-3))), undefined);
});

test("P5-D2.1 §15.7 passado → outro passado depois do aviso abre novo " +
  "episódio; restaurar a data já avisada não reemite", async () => {
  const {t, clientId} = await newTenant("p21g");
  const id = await openReceivable(t, clientId, day(-10));
  await run();
  await editReceivable(t.owner, await receivableUpdatePayload(t.workspaceId,
    id, {dueDate: day(-5)}));
  await run();
  assert.deepEqual(new Set((await noticesOf(t.workspaceId, id))
    .map((item) => item.id)), new Set([noticeIdOf(t.workspaceId, id, day(-10)),
    noticeIdOf(t.workspaceId, id, day(-5))]));
  await editReceivable(t.owner, await receivableUpdatePayload(t.workspaceId,
    id, {dueDate: day(-10)}));
  assert.equal((await queueOf(t.workspaceId, id))?.dueDate, day(-10),
    "o domínio reenfileira a data restaurada");
  const summary = await run();
  assert.ok(summary.alreadyDelivered >= 1);
  assert.equal((await noticesOf(t.workspaceId, id)).length, 2,
    "a confirmação do episódio restaurado impede o terceiro aviso");
  assert.equal(await queueOf(t.workspaceId, id), undefined);
  await expectDelivery(t.workspaceId, id, day(-10));
  await expectDelivery(t.workspaceId, id, day(-5));
});

test("P5-D2.1 §15.8 estorno que reabre: sem confirmação do episódio, emite; " +
  "com confirmação, não duplica", async () => {
  const {t, clientId} = await newTenant("p21h");
  const id = await openReceivable(t, clientId, day(-4));
  const paid = await receive(t.owner, await receivePayload(t.workspaceId, id,
    {principalCents: 100_000}));
  assert.equal(await queueOf(t.workspaceId, id), undefined);
  await reverse(t.owner, await reversePayload(t.workspaceId, id,
    String(paid.movementId)));
  assert.equal((await queueOf(t.workspaceId, id))?.dueDate, day(-4),
    "o estorno devolve o trabalho");
  await run();
  assert.equal((await noticesOf(t.workspaceId, id)).length, 1,
    "sem confirmação: emite");

  const again = await receive(t.owner, await receivePayload(t.workspaceId, id,
    {principalCents: 100_000}));
  await reverse(t.owner, await reversePayload(t.workspaceId, id,
    String(again.movementId)));
  assert.ok(await queueOf(t.workspaceId, id));
  await run({today: day(2), nowMs: NOW + 2 * DAY_MS});
  const notices = await noticesOf(t.workspaceId, id);
  assert.equal(notices.length, 1, "com confirmação: não duplica");
  assert.equal(notices[0].createdAt, new Date(NOW).toISOString());
  assert.equal(await queueOf(t.workspaceId, id), undefined);
});

test("P5-D2.1 §15.9 reexecução no mesmo dia e repetição do Scheduler (o " +
  "mesmo runId) não duplicam nem regravam o aviso", async () => {
  await drain();
  const {t, clientId} = await newTenant("p21i");
  const id = await openReceivable(t, clientId, day(-2));
  const runId = `receivable-overdue-${DAY}T12:00:00.000Z`;
  const first = await run({runId});
  assert.equal(first.published, 1);
  const original = await noticesOf(t.workspaceId, id);
  const delivery = await expectDelivery(t.workspaceId, id, day(-2));
  assert.equal(delivery.runId, runId);
  const repeated = await run({runId, nowMs: NOW + 60_000});
  assert.deepEqual(countersOf(repeated), ZERO_COUNTERS);
  assert.equal(repeated.outcome, "idle");
  const later = await run({nowMs: NOW + 3_600_000});
  assert.equal(later.published, 0);
  assert.deepEqual(await noticesOf(t.workspaceId, id), original);
});

test("P5-D2.1 §15.10 retry de falha não transitória: a 1ª volta na " +
  "próxima execução do mesmo dia; a 2ª empurra para o dia seguinte",
async () => {
  await drain();
  const {t, clientId} = await newTenant("p21j");
  const sameDay = await openReceivable(t, clientId, day(-2));
  const nextDay = await openReceivable(t, clientId, day(-2));
  const r1 = await run({faults: failFor("beforeTransaction",
    [sameDay, nextDay], permanent)});
  assert.equal(r1.failed, 2);
  assert.equal(r1.outcome, "recoverable_failures");
  for (const id of [sameDay, nextDay]) {
    const item = await queueOf(t.workspaceId, id);
    assert.equal(item?.attempts, 1);
    assert.equal(item?.lastErrorCode, "unknown");
    assert.ok(item?.lastAttemptAt instanceof Timestamp);
    assert.equal(item?.runAfterDay, day(-1), "1ª falha: continua devido");
  }
  const r2 = await run({faults: failFor("beforeTransaction", [nextDay],
    permanent)});
  assert.equal(r2.published, 1);
  assert.equal(r2.failed, 1);
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set([sameDay]),
    "retry no mesmo dia");
  const pushed = await queueOf(t.workspaceId, nextDay);
  assert.equal(pushed?.attempts, 2);
  assert.equal(pushed?.runAfterDay, day(1), "2ª falha: dia seguinte");
  const r3 = await run();
  assert.equal(r3.scanned, 0, "não devido no mesmo dia");
  await run({today: day(1), nowMs: NOW + DAY_MS});
  assert.deepEqual(await notifiedIds(t.workspaceId),
    new Set([sameDay, nextDay]), "retry no dia seguinte");
  expectNotice((await noticesOf(t.workspaceId, nextDay))[0], {
    workspaceId: t.workspaceId, receivableId: nextDay, dueDate: day(-2),
    detectedOn: day(1), createdAtMs: NOW + DAY_MS});
});

test("P5-D2.1 §15.11 / §16.1 falha depois da consulta, durante a " +
  "publicação (antes do commit) e por tempo esgotado: nada parcial, tudo " +
  "recuperável", async () => {
  const {t, clientId} = await newTenant("p21k");
  const afterQuery = await openReceivable(t, clientId, day(-2));
  const duringPublish = await openReceivable(t, clientId, day(-2));
  const timedOut = await openReceivable(t, clientId, day(-2));
  await run({faults: {
    ...failFor("beforeTransaction", [afterQuery]),
    beforeCommit: (item) => {
      if (item.receivableId === duringPublish) {
        throw Object.assign(new Error("indisponível"), {code: 14});
      }
      if (item.receivableId === timedOut) {
        throw Object.assign(new Error("deadline"), {code: 4});
      }
    },
  }});
  for (const [id, code] of [[afterQuery, "unavailable"],
    [duringPublish, "unavailable"], [timedOut, "timeout"]]) {
    assert.equal((await queueOf(t.workspaceId, id))?.lastErrorCode, code);
  }
  for (const id of [afterQuery, duringPublish, timedOut]) {
    assert.deepEqual(await noticesOf(t.workspaceId, id), [],
      "nenhum aviso sem confirmação");
    assert.equal(await deliveryOf(t.workspaceId,
      noticeIdOf(t.workspaceId, id, day(-2))), undefined,
    "nenhuma confirmação sem aviso");
    assert.equal((await queueOf(t.workspaceId, id))?.attempts, 1);
  }
  await run();
  assert.deepEqual(await notifiedIds(t.workspaceId),
    new Set([afterQuery, duringPublish, timedOut]));
  for (const id of [afterQuery, duringPublish, timedOut]) {
    await expectDelivery(t.workspaceId, id, day(-2));
    assert.equal(await queueOf(t.workspaceId, id), undefined);
  }
});

test("P5-D2.1 §15.12 a falha de um item não perde nem atrasa os " +
  "demais", async () => {
  const {t, clientId} = await newTenant("p21l");
  const ids = [];
  for (let index = 0; index < 6; index += 1) {
    ids.push(await openReceivable(t, clientId, day(-(index + 1))));
  }
  const broken = ids[2];
  await run({faults: failFor("beforeCommit", [broken])});
  assert.deepEqual(await notifiedIds(t.workspaceId),
    new Set(ids.filter((id) => id !== broken)));
  assert.equal((await queueOf(t.workspaceId, broken))?.attempts, 1);
});

test("P5-D2.1 §15.13 falha persistente: nunca descartada, sinalizada a " +
  "partir da 5ª tentativa, com backoff limitado, e recupera", async () => {
  await drain(day(40));
  const {t, clientId} = await newTenant("p21m");
  const id = await openReceivable(t, clientId, day(-2));
  const faults = failFor("beforeTransaction", [id], permanent);
  const schedule: Array<[string, number, string]> = [
    // [dia da execução, tentativas depois dela, próximo dia]
    [DAY, 1, day(-1)],
    [DAY, 2, day(1)],
    [day(1), 3, day(3)],
    [day(3), 4, day(7)],
    [day(7), 5, day(14)],
    [day(14), 6, day(21)],
    [day(21), 7, day(28)],
  ];
  const warnings: LogEntry[] = [];
  for (const [today, attempts, next] of schedule) {
    const {result, logs} = await captureLogs(() => run({today, faults}));
    assert.equal(result.failed, 1, `${today}: falhou`);
    assert.equal(result.persistentFailures, attempts >= 5 ? 1 : 0);
    const item = await queueOf(t.workspaceId, id);
    assert.ok(item, "nunca descartado");
    assert.equal(item.attempts, attempts);
    assert.equal(item.runAfterDay, next);
    assert.equal(item.dueDate, day(-2), "o episódio não muda");
    warnings.push(...logs.filter((entry) =>
      entry.event === "receivable_overdue_persistent_failure"));
  }
  assert.equal(warnings.length, 3, "5ª, 6ª e 7ª tentativas sinalizadas");
  for (const entry of warnings) {
    assert.equal(entry.severity, "WARNING");
    assert.equal(entry.receivableId, id);
    assert.equal(entry.workspaceId, t.workspaceId);
    assert.equal(entry.errorCode, "unknown");
    assertNoWords(entry, RECEIVABLE_PII);
  }
  await run({today: day(27)});
  assert.deepEqual(await overdueNotices(t.workspaceId), [],
    "fora do dia da próxima tentativa, não reprocessa");
  await run({today: day(28), nowMs: NOW + 28 * DAY_MS});
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set([id]),
    "recupera quando a falha some");
  assert.equal(await queueOf(t.workspaceId, id), undefined);
});

test("P5-D2.1 §15.10b falha transitória (indisponibilidade): volta a cada " +
  "execução horária nas 6 primeiras tentativas e depois todo dia, sem " +
  "adiar dias depois da recuperação", async () => {
  await drain(day(3));
  const {t, clientId} = await newTenant("p21j2");
  const id = await openReceivable(t, clientId, day(-2));
  const faults = failFor("beforeTransaction", [id]);
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await run({faults});
    const item = await queueOf(t.workspaceId, id);
    assert.deepEqual([item?.attempts, item?.lastErrorCode, item?.runAfterDay],
      [attempt, "unavailable", day(-1)], `tentativa ${attempt}: devido`);
  }
  await run({faults});
  assert.equal((await queueOf(t.workspaceId, id))?.runAfterDay, day(1),
    "7ª: dia seguinte");
  assert.equal((await run()).scanned, 0);
  await run({today: day(1), faults});
  const item = await queueOf(t.workspaceId, id);
  assert.deepEqual([item?.attempts, item?.runAfterDay], [8, day(2)],
    "depois, um dia por vez (nunca 7)");
  await run({today: day(2), nowMs: NOW + 2 * DAY_MS});
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set([id]));
});

test("P5-D2.1 §15.23 vencimento retroativo não fura a fila: entra no dia " +
  "do enfileiramento, atrás de quem ficou devido antes (relógio real do " +
  "domínio)", async () => {
  const realToday = saoPauloDayKey();
  await drain(realToday);
  const {t, clientId} = await newTenant("p21fifo");
  const waiting = await openReceivable(t, clientId, shiftDays(realToday, -4));
  // Enfileirado antes de vencer: ficou devido há 3 dias e ainda espera.
  await overdueQueueRef(t.workspaceId, waiting)
    .update({runAfterDay: shiftDays(realToday, -3)});
  const before = saoPauloDayKey();
  const retro = await openReceivable(t, clientId, "2000-01-01");
  const after = saoPauloDayKey();
  const item = await queueOf(t.workspaceId, retro);
  assert.ok([before, after].includes(String(item?.runAfterDay)),
    `devido no dia do enfileiramento, não em 2000-01-02: ${item?.runAfterDay}`);
  // O dia da execução é o do enfileiramento (imune à virada da meia-noite).
  const runDay = String(item?.runAfterDay);
  const first = await run({today: runDay, nowMs: Date.now(), pageSize: 1,
    maxPages: 1});
  assert.equal(first.published, 1);
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set([waiting]),
    "com capacidade para um, vai primeiro quem esperava há mais tempo");
  await run({today: runDay, nowMs: Date.now()});
  assert.deepEqual(await notifiedIds(t.workspaceId),
    new Set([waiting, retro]));
});

test("P5-D2.1 §15.24 falha da contagem final não vira erro estrutural: o " +
  "trabalho fica feito, o total pendente fica nulo e sai um WARN",
async () => {
  await drain();
  const {t, clientId} = await newTenant("p21cnt");
  const id = await openReceivable(t, clientId, day(-2));
  const spy = mock.method(Query.prototype, "count");
  spy.mock.mockImplementationOnce((() => ({
    get: () => Promise.reject(Object.assign(new Error("deadline"), {code: 4})),
  })) as never);
  let captured: {result: ReceivableOverdueSummary; logs: LogEntry[]};
  try {
    captured = await captureLogs(() => run());
  } finally {
    spy.mock.restore();
  }
  const {result, logs} = captured;
  assert.deepEqual([result.published, result.pendingDueAtEnd, result.backlog,
    result.outcome], [1, null, null, "drained"],
  "sem contagem e sem pressão de capacidade: backlog desconhecido");
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set([id]));
  const [warn] = logs.filter((entry) =>
    entry.event === "receivable_overdue_pending_count_failed");
  assert.equal(warn?.severity, "WARNING");
  assert.equal(warn?.errorCode, "timeout");
  assert.equal(logs.filter((entry) =>
    entry.event === "receivable_overdue_notifications_structural_error")
    .length, 0);
});

test("P5-D2.1 §15.25 recebível fora do contrato na 5ª tentativa emite o " +
  "mesmo WARN de falha persistente; o backlog é sinalizado mesmo quando o " +
  "desfecho é de falha", async () => {
  await drain(day(1));
  const {t, clientId} = await newTenant("p21inv5");
  const bad = await openReceivable(t, clientId, day(-5));
  await receivableRef(t.workspaceId, bad).update({balanceCents: 3});
  await overdueQueueRef(t.workspaceId, bad).update({attempts: 4});
  await openReceivable(t, clientId, day(-3));
  await openReceivable(t, clientId, day(-3));
  const {result, logs} = await captureLogs(() =>
    run({pageSize: 1, maxPages: 1}));
  assert.deepEqual([result.invalid, result.persistentFailures,
    result.budgetExhausted, result.pendingDueAtEnd, result.backlog,
    result.outcome], [1, 1, true, 2, true, "recoverable_failures"]);
  const [warn] = logs.filter((entry) =>
    entry.event === "receivable_overdue_persistent_failure");
  assert.deepEqual([warn?.severity, warn?.receivableId, warn?.errorCode,
    warn?.attempts], ["WARNING", bad, "receivable_invalid", 5]);
  assert.equal((await queueOf(t.workspaceId, bad))?.runAfterDay, day(7));
});

test("P5-D2.1 §15.26 parada rígida: itens não iniciados depois do limite " +
  "ficam devidos para a execução seguinte, sem tentativa registrada",
async () => {
  await drain();
  const {t, clientId} = await newTenant("p21hard");
  const ids = [await openReceivable(t, clientId, day(-2)),
    await openReceivable(t, clientId, day(-3)),
    await openReceivable(t, clientId, day(-4))];
  const stopped = await run({hardStopMs: 0});
  assert.deepEqual([stopped.scanned, stopped.published, stopped.deferred,
    stopped.budgetExhausted, stopped.pendingDueAtEnd, stopped.outcome],
  [3, 0, 3, true, 3, "backlog"]);
  for (const id of ids) {
    assert.equal((await queueOf(t.workspaceId, id))?.attempts, 0);
  }
  await run();
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set(ids));
});

test("P5-D2.1 §15.27 cancelado durante o processamento: a transação relê " +
  "o item e o recebível e não publica", async () => {
  const {t, clientId} = await newTenant("p21canc");
  const id = await openReceivable(t, clientId, day(-3));
  await run({faults: {
    beforeTransaction: async (item) => {
      if (item.receivableId !== id) return;
      await cancel(t.owner, await cancelPayload(t.workspaceId, id));
    },
  }});
  assert.deepEqual(await overdueNotices(t.workspaceId), []);
  assert.deepEqual(await deliveriesOf(t.workspaceId), []);
  assert.equal(await queueOf(t.workspaceId, id), undefined);
});

test("P5-D2.1 §15.28 recebido, vencimento editado e estorno: o episódio " +
  "reaberto é o do vencimento novo", async () => {
  const {t, clientId} = await newTenant("p21redit");
  const id = await openReceivable(t, clientId, day(-10));
  const paid = await receive(t.owner, await receivePayload(t.workspaceId, id,
    {principalCents: 100_000}));
  await editReceivable(t.owner, await receivableUpdatePayload(t.workspaceId,
    id, {dueDate: day(-4)}));
  assert.equal(await queueOf(t.workspaceId, id), undefined,
    "recebido: a edição não enfileira");
  await reverse(t.owner, await reversePayload(t.workspaceId, id,
    String(paid.movementId)));
  assert.equal((await queueOf(t.workspaceId, id))?.dueDate, day(-4));
  await run();
  const notices = await noticesOf(t.workspaceId, id);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].id, noticeIdOf(t.workspaceId, id, day(-4)));
});

test("P5-D2.1 §15.29 estorno de recebimento parcial (aberto → aberto) " +
  "depois do aviso: não reescreve a fila nem duplica", async () => {
  const {t, clientId} = await newTenant("p21rpart");
  const id = await openReceivable(t, clientId, day(-3));
  await run();
  const partial = await receive(t.owner, await receivePayload(t.workspaceId,
    id, {principalCents: 20_000}));
  const reversed = await reverse(t.owner, await reversePayload(t.workspaceId,
    id, String(partial.movementId)));
  assert.equal(reversed.status, "open");
  assert.equal(await queueOf(t.workspaceId, id), undefined);
  await run({today: day(1), nowMs: NOW + DAY_MS});
  assert.equal((await noticesOf(t.workspaceId, id)).length, 1);
});

test("P5-D2.1 §15.30 edição só da descrição com o item em backoff: o " +
  "trabalho e as tentativas ficam como estão", async () => {
  const {t, clientId} = await newTenant("p21desc");
  const id = await openReceivable(t, clientId, day(-3));
  await run({faults: failFor("beforeTransaction", [id], permanent)});
  const before = await overdueQueueRef(t.workspaceId, id).get();
  await editReceivable(t.owner, await receivableUpdatePayload(t.workspaceId,
    id, {description: "Consultoria de novembro"}));
  const after = await overdueQueueRef(t.workspaceId, id).get();
  assert.equal(after.get("attempts"), 1);
  assert.equal(after.get("lastErrorCode"), "unknown");
  assert.ok(after.updateTime?.isEqual(before.updateTime as Timestamp),
    "nenhuma escrita no item");
});

test("P5-D2.1 §15.31 vencimento editado para hoje: não avisa hoje; avisa " +
  "no dia seguinte, com o vencimento novo", async () => {
  const {t, clientId} = await newTenant("p21today");
  const id = await openReceivable(t, clientId, day(-5));
  await editReceivable(t.owner, await receivableUpdatePayload(t.workspaceId,
    id, {dueDate: DAY}));
  await run();
  assert.deepEqual(await overdueNotices(t.workspaceId), []);
  await run({today: day(1), nowMs: NOW + DAY_MS});
  assert.equal((await noticesOf(t.workspaceId, id))[0]?.id,
    noticeIdOf(t.workspaceId, id, DAY));
});

test("P5-D2.1 §15.32 replay idempotente da criação depois do aviso não " +
  "reenfileira nem duplica", async () => {
  const {t, clientId} = await newTenant("p21replay");
  const payload = receivablePayload(t.workspaceId, clientId,
    {dueDate: day(-2), amountCents: 100_000});
  const created = await newReceivable(t.owner, payload);
  await run();
  assert.equal((await noticesOf(t.workspaceId,
    String(created.receivableId))).length, 1);
  const replay = await newReceivable(t.owner, payload);
  assert.equal(replay.replayed, true);
  assert.equal(replay.receivableId, created.receivableId);
  assert.equal(await queueOf(t.workspaceId, String(created.receivableId)),
    undefined);
  await run({today: day(1), nowMs: NOW + DAY_MS});
  assert.equal((await noticesOf(t.workspaceId,
    String(created.receivableId))).length, 1);
});

test("P5-D2.1 §15.33 item devido de recebível que ainda não venceu (vence " +
  "hoje ou no futuro): a transação reagenda e nunca publica", async () => {
  const {t, clientId} = await newTenant("p21resch");
  const dueToday = await openReceivable(t, clientId, DAY);
  const future = await openReceivable(t, clientId, day(3));
  // Item devido antes da hora (estado inconsistente simulado).
  for (const id of [dueToday, future]) {
    await overdueQueueRef(t.workspaceId, id).update({runAfterDay: day(-3)});
  }
  const summary = await run();
  assert.ok(summary.rescheduled >= 2);
  assert.deepEqual(await overdueNotices(t.workspaceId), []);
  assert.equal((await queueOf(t.workspaceId, dueToday))?.runAfterDay, day(1));
  assert.equal((await queueOf(t.workspaceId, future))?.runAfterDay, day(4));
});

test("P5-D2.1 §15.26b parada rígida no meio da página: o item em curso " +
  "termina; os que não começaram ficam devidos", async () => {
  await drain();
  const {t, clientId} = await newTenant("p21hard2");
  const ids = [await openReceivable(t, clientId, day(-4)),
    await openReceivable(t, clientId, day(-3)),
    await openReceivable(t, clientId, day(-2))];
  let first = true;
  // Margem larga: o limite conta desde o início da execução, inclusive a
  // primeira consulta, que no Emulator cheio pode levar centenas de ms.
  const summary = await run({concurrency: 1, hardStopMs: 2_000, faults: {
    beforeTransaction: async () => {
      if (!first) return;
      first = false;
      await sleep(2_500);
    },
  }});
  assert.deepEqual([summary.published, summary.deferred,
    summary.budgetExhausted, summary.pendingDueAtEnd, summary.backlog,
    summary.outcome], [1, 2, true, 2, true, "backlog"]);
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set([ids[0]]),
    "o mais antigo, já iniciado, foi concluído");
  await run();
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set(ids));
});

test("P5-D2.1 §15.35 justiça entre workspaces em duas passadas: na 1ª, " +
  "a cota (esgotada, o cursor salta o resto do workspace no mesmo dia sem " +
  "lê-lo) atende o outro workspace antes do excedente; na 2ª, o tempo que " +
  "sobra atende o excedente na mesma execução", async () => {
  await drain();
  const {t: a, clientId: ca} = await newTenant("p21fairA");
  const {t: b, clientId: cb} = await newTenant("p21fairB");
  const heavy: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    heavy.push(await openReceivable(a, ca, day(-10)));
  }
  const light = [await openReceivable(b, cb, day(-3)),
    await openReceivable(b, cb, day(-2))];
  const order: string[] = [];
  const r1 = await run({workspaceShare: 2, pageSize: 3, faults: {
    beforeTransaction: (item) => {
      order.push(item.receivableId);
    },
  }});
  assert.equal(order.length, 7, "cada item uma única vez");
  assert.deepEqual(new Set(order.slice(0, 4).filter((id) =>
    light.includes(id))), new Set(light),
  "o workspace leve é atendido na 1ª passada, antes do excedente do pesado");
  assert.ok(order.slice(4).every((id) => heavy.includes(id)),
    "o excedente do pesado só na 2ª passada");
  // 1ª passada: A1, A2, A3 (cota; A3 lido além dela) → salto → B1, B2.
  // 2ª passada: A3, A4, A5 → página vazia.
  assert.deepEqual([r1.published, r1.throttled, r1.pages,
    r1.pendingDueAtEnd, r1.budgetExhausted, r1.backlog, r1.outcome],
  [7, 1, 4, 0, false, false, "drained"],
  "só 1 item de A lido além da cota na 1ª passada (salto)");
  assert.deepEqual(await notifiedIds(a.workspaceId), new Set(heavy));
  assert.deepEqual(await notifiedIds(b.workspaceId), new Set(light));
  assert.equal((await overdueNotices(a.workspaceId)).length, 5);
  assert.equal((await run()).scanned, 0);
});

test("P5-D2.1 §15.37 a 2ª passada não repete o que a execução já tratou: " +
  "a falha da 1ª passada é registrada uma única vez", async () => {
  await drain();
  const {t: a, clientId: ca} = await newTenant("p21passA");
  const {t: b, clientId: cb} = await newTenant("p21passB");
  const failing = [await openReceivable(a, ca, day(-5)),
    await openReceivable(a, ca, day(-4))];
  const other = await openReceivable(b, cb, day(-3));
  const calls = new Map<string, number>();
  const summary = await run({workspaceShare: 1, faults: {
    beforeTransaction: (item) => {
      calls.set(item.receivableId, (calls.get(item.receivableId) ?? 0) + 1);
      if (failing.includes(item.receivableId)) throw permanent();
    },
  }});
  // 1ª passada: o 1º de A falha, o 2º excede a cota, B publica.
  // 2ª passada: o 1º de A (já tratado) é saltado; o 2º falha.
  assert.deepEqual([...calls.values()], [1, 1, 1],
    "nenhum item tentado duas vezes na mesma execução");
  assert.deepEqual([summary.published, summary.failed, summary.throttled,
    summary.retriedSameDay, summary.pendingDueAtEnd, summary.backlog,
    summary.outcome], [1, 2, 1, 2, 2, false, "recoverable_failures"]);
  for (const id of failing) {
    assert.equal((await queueOf(a.workspaceId, id))?.attempts, 1);
  }
  assert.deepEqual(await notifiedIds(b.workspaceId), new Set([other]));
});

test("P5-D2.1 §15.38 sem tempo, a 2ª passada não começa: o excedente da " +
  "cota fica devido e a execução sinaliza backlog", async () => {
  await drain();
  const {t: a, clientId: ca} = await newTenant("p21slowA");
  const {t: b, clientId: cb} = await newTenant("p21slowB");
  const heavy = [await openReceivable(a, ca, day(-6)),
    await openReceivable(a, ca, day(-5)),
    await openReceivable(a, ca, day(-4))];
  const light = await openReceivable(b, cb, day(-3));
  let first = true;
  const summary = await run({workspaceShare: 1, concurrency: 1,
    timeBudgetMs: 200, faults: {
      beforeTransaction: async () => {
        if (!first) return;
        first = false;
        await sleep(300);
      },
    }});
  assert.deepEqual([summary.published, summary.throttled, summary.pages,
    summary.budgetExhausted, summary.pendingDueAtEnd, summary.backlog,
    summary.outcome], [2, 2, 1, true, 2, true, "backlog"]);
  assert.equal((await notifiedIds(a.workspaceId)).size, 1);
  assert.deepEqual(await notifiedIds(b.workspaceId), new Set([light]));
  const next = await run();
  assert.equal(next.published, 2);
  assert.deepEqual(await notifiedIds(a.workspaceId), new Set(heavy));
});

test("P5-D2.1 §15.39 salto exatamente na fronteira da página (a cota " +
  "termina no último item da página): a 2ª passada ainda atende o " +
  "excedente saltado sem leitura", async () => {
  await drain();
  const {t, clientId} = await newTenant("p21edge");
  const ids: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    ids.push(await openReceivable(t, clientId, day(-7)));
  }
  // 1ª passada: página 1 = 2 itens (cota) → salto → página vazia.
  // 2ª passada: 2 + 1 itens.
  const summary = await run({workspaceShare: 2, pageSize: 2});
  assert.deepEqual([summary.published, summary.throttled, summary.pages,
    summary.pendingDueAtEnd, summary.budgetExhausted, summary.backlog,
    summary.outcome], [5, 0, 4, 0, false, false, "drained"]);
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set(ids));
});

test("P5-D2.1 §15.40 o salto da cota vale só para o resto do workspace " +
  "naquele dia: outro workspace no mesmo dia e o mesmo workspace num dia " +
  "posterior não são saltados", async () => {
  await drain();
  // IDs de workspace `${prefixo}-ws-…`: A antes de B na ordem por caminho.
  const {t: a, clientId: ca} = await newTenant("p21sameA");
  const {t: b, clientId: cb} = await newTenant("p21sameB");
  const sameDay = [await openReceivable(a, ca, day(-10)),
    await openReceivable(a, ca, day(-10)),
    await openReceivable(a, ca, day(-10))];
  const laterDay = await openReceivable(a, ca, day(-5));
  const other = [await openReceivable(b, cb, day(-10)),
    await openReceivable(b, cb, day(-10))];
  const order: string[] = [];
  const summary = await run({workspaceShare: 2, pageSize: 2, faults: {
    beforeTransaction: (item) => {
      order.push(item.receivableId);
    },
  }});
  // 1ª passada: 2 de A no dia D → salto (A, D) → os 2 de B no dia D →
  // A no dia D+5 lido além da cota. 2ª passada: o 3º de A em D e o de D+5.
  assert.equal(order.length, 6, "cada item uma única vez");
  assert.deepEqual(new Set(order.slice(2, 4)), new Set(other),
    "B, no mesmo dia, não é saltado com A");
  assert.deepEqual(new Set(order.slice(4)),
    new Set([...sameDay.filter((id) => !order.slice(0, 2).includes(id)),
      laterDay]), "o excedente de A só na 2ª passada");
  assert.deepEqual([summary.published, summary.throttled, summary.pages,
    summary.pendingDueAtEnd, summary.backlog, summary.outcome],
  [6, 1, 5, 0, false, "drained"],
  "o item de A no dia posterior é lido (não saltado) e fica para a 2ª");
  assert.deepEqual(await notifiedIds(a.workspaceId),
    new Set([...sameDay, laterDay]));
  assert.deepEqual(await notifiedIds(b.workspaceId), new Set(other));
});

test("P5-D2.1 §15.41 contagem final falha com o orçamento esgotado: o " +
  "backlog é afirmado, não desconhecido", async () => {
  await drain();
  const {t, clientId} = await newTenant("p21cnt2");
  const ids = [await openReceivable(t, clientId, day(-3)),
    await openReceivable(t, clientId, day(-2))];
  const spy = mock.method(Query.prototype, "count");
  spy.mock.mockImplementationOnce((() => ({
    get: () => Promise.reject(Object.assign(new Error("deadline"), {code: 4})),
  })) as never);
  let summary: ReceivableOverdueSummary;
  try {
    summary = await run({pageSize: 1, maxPages: 1});
  } finally {
    spy.mock.restore();
  }
  assert.deepEqual([summary.published, summary.budgetExhausted,
    summary.pendingDueAtEnd, summary.backlog, summary.outcome],
  [1, true, null, true, "backlog"]);
  await run();
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set(ids));
});

test("P5-D2.1 §15.36 backlog só com sobra real: uma falha transitória que " +
  "volta na execução seguinte não é backlog", async () => {
  await drain();
  const {t, clientId} = await newTenant("p21bkl");
  const id = await openReceivable(t, clientId, day(-2));
  const summary = await run({faults: failFor("beforeTransaction", [id])});
  assert.deepEqual([summary.failed, summary.retriedSameDay,
    summary.pendingDueAtEnd, summary.backlog, summary.outcome],
  [1, 1, 1, false, "recoverable_failures"]);
});

test("P5-D2.1 §15.34 invariante de cobertura: depois de qualquer sequência " +
  "de operações de domínio, todo recebível aberto com saldo tem trabalho " +
  "para o vencimento atual ou a confirmação desse episódio, e nenhum " +
  "fechado tem trabalho pendente", async () => {
  const {t, clientId} = await newTenant("p21inv");
  const assertCoverage = async (label: string) => {
    const docs = (await db().collection(
      `workspaces/${t.workspaceId}/receivables`).get()).docs;
    assert.ok(docs.length >= 8);
    for (const doc of docs) {
      const {status, balanceCents, dueDate} = doc.data();
      const item = await queueOf(t.workspaceId, doc.id);
      if (status === "open" && balanceCents > 0) {
        const delivered = await deliveryOf(t.workspaceId,
          noticeIdOf(t.workspaceId, doc.id, dueDate));
        assert.ok(item?.dueDate === dueDate || delivered,
          `${label}: ${doc.id} aberto sem trabalho nem confirmação`);
      } else {
        assert.equal(item, undefined, `${label}: ${doc.id} fechado na fila`);
      }
    }
  };
  const ids = {
    future: await openReceivable(t, clientId, day(30)),
    past: await openReceivable(t, clientId, day(-30)),
    today: await openReceivable(t, clientId, DAY),
    moved: await openReceivable(t, clientId, day(20)),
    partial: await openReceivable(t, clientId, day(-5)),
    paid: await openReceivable(t, clientId, day(-6)),
    reopened: await openReceivable(t, clientId, day(-7)),
    cancelled: await openReceivable(t, clientId, day(-8)),
    amount: await openReceivable(t, clientId, day(-9)),
  };
  await assertCoverage("criação");
  await editReceivable(t.owner, await receivableUpdatePayload(t.workspaceId,
    ids.moved, {dueDate: day(-4)}));
  await receive(t.owner, await receivePayload(t.workspaceId, ids.partial,
    {principalCents: 10_000}));
  await receive(t.owner, await receivePayload(t.workspaceId, ids.paid,
    {principalCents: 100_000}));
  const reopened = await receive(t.owner, await receivePayload(t.workspaceId,
    ids.reopened, {principalCents: 100_000}));
  await reverse(t.owner, await reversePayload(t.workspaceId, ids.reopened,
    String(reopened.movementId)));
  await cancel(t.owner, await cancelPayload(t.workspaceId, ids.cancelled));
  await editReceivable(t.owner, await receivableUpdatePayload(t.workspaceId,
    ids.amount, {amountCents: 150_000, description: "Outra descrição"}));
  await assertCoverage("mutações");
  await run();
  await assertCoverage("depois da rotina");
  await editReceivable(t.owner, await receivableUpdatePayload(t.workspaceId,
    ids.past, {dueDate: day(10)}));
  await receive(t.owner, await receivePayload(t.workspaceId, ids.partial,
    {principalCents: 10_000}));
  await assertCoverage("depois do aviso");
});

test("P5-D2.1 §15.14 vencimento editado com o item já lido pela consulta: " +
  "a transação usa o vencimento atual e não emite o episódio antigo",
async () => {
  const {t, clientId} = await newTenant("p21n");
  const id = await openReceivable(t, clientId, day(-3));
  const summary = await run({faults: {
    beforeTransaction: async (item) => {
      if (item.receivableId !== id) return;
      await editReceivable(t.owner, await receivableUpdatePayload(
        t.workspaceId, id, {dueDate: day(6)}));
    },
  }});
  assert.equal(summary.failed, 0);
  assert.deepEqual(await overdueNotices(t.workspaceId), []);
  const item = await queueOf(t.workspaceId, id);
  assert.equal(item?.dueDate, day(6));
  assert.equal(item?.runAfterDay, day(7));
});

test("P5-D2.1 §15.15 quitado durante o processamento: a transação relê o " +
  "item e o recebível e não publica", async () => {
  const {t, clientId} = await newTenant("p21o");
  const id = await openReceivable(t, clientId, day(-3));
  await run({faults: {
    beforeTransaction: async (item) => {
      if (item.receivableId !== id) return;
      await receive(t.owner, await receivePayload(t.workspaceId, id,
        {principalCents: 100_000}));
    },
  }});
  assert.deepEqual(await overdueNotices(t.workspaceId), []);
  assert.deepEqual(await deliveriesOf(t.workspaceId), []);
  assert.equal(await queueOf(t.workspaceId, id), undefined);
});

test("P5-D2.1 §15.15b item obsoleto na fila de um recebível já quitado: " +
  "a revalidação na transação encerra o trabalho sem publicar", async () => {
  const {t, clientId} = await newTenant("p21o2");
  const id = await openReceivable(t, clientId, day(-3));
  const stale = (await overdueQueueRef(t.workspaceId, id).get()).data();
  assert.ok(stale);
  await receive(t.owner, await receivePayload(t.workspaceId, id,
    {principalCents: 100_000}));
  assert.equal(await queueOf(t.workspaceId, id), undefined);
  // Estado inconsistente simulado: o item volta sem passar pelo domínio.
  await overdueQueueRef(t.workspaceId, id).set(stale);
  const summary = await run();
  assert.ok(summary.closed >= 1);
  assert.deepEqual(await overdueNotices(t.workspaceId), []);
  assert.deepEqual(await deliveriesOf(t.workspaceId), []);
  assert.equal(await queueOf(t.workspaceId, id), undefined);
});

test("P5-D2.1 §15.14b falha depois de o domínio regravar o item (novo " +
  "episódio): o registro da falha, com pré-condição de versão, não " +
  "sobrescreve o trabalho novo", async () => {
  const {t, clientId} = await newTenant("p21n2");
  const id = await openReceivable(t, clientId, day(-3));
  const summary = await run({faults: {
    beforeTransaction: async (item) => {
      if (item.receivableId !== id) return;
      await editReceivable(t.owner, await receivableUpdatePayload(
        t.workspaceId, id, {dueDate: day(-6)}));
      throw Object.assign(new Error("falha injetada"), {code: 14});
    },
  }});
  assert.equal(summary.failed, 1);
  assert.equal(summary.retryNotRecorded, 1);
  const item = await queueOf(t.workspaceId, id);
  assert.deepEqual([item?.dueDate, item?.runAfterDay, item?.attempts,
    item?.lastErrorCode], [day(-6), day(-5), 0, null],
  "o episódio regravado pelo domínio fica intacto");
  await run();
  assert.equal((await noticesOf(t.workspaceId, id))[0]?.id,
    noticeIdOf(t.workspaceId, id, day(-6)));
});

test("P5-D2.1 §15.22 dia civil de São Paulo, sem offset fixo: às 22h30 do " +
  "dia D (01h30 UTC de D+1) o vencimento de D ainda não atrasou; à 00h30 " +
  "de D+1 atrasou", async () => {
  const {t, clientId} = await newTenant("p21sp");
  const id = await openReceivable(t, clientId, DAY);
  const evening = Date.parse(`${day(1)}T01:30:00Z`);
  const r1 = await runReceivableOverdueNotifications({nowMs: evening});
  assert.equal(r1.today, DAY, "dia civil de São Paulo, não o de UTC");
  assert.deepEqual(await overdueNotices(t.workspaceId), []);
  const midnight = Date.parse(`${day(1)}T03:30:00Z`);
  const r2 = await runReceivableOverdueNotifications({nowMs: midnight});
  assert.equal(r2.today, day(1));
  const [notice] = await noticesOf(t.workspaceId, id);
  expectNotice(notice, {workspaceId: t.workspaceId, receivableId: id,
    dueDate: DAY, detectedOn: day(1), createdAtMs: midnight});
});

test("P5-D2.1 §15.16 backlog acima do orçamento: cada execução avança, os " +
  "mais antigos primeiro, e a seguinte retoma sem cursor persistido",
async () => {
  await drain();
  const {t, clientId} = await newTenant("p21p");
  const byAge = [];
  for (const offset of [50, 40, 30, 20, 10]) {
    byAge.push(await openReceivable(t, clientId, day(-offset)));
  }
  const budget = {pageSize: 2, maxPages: 1};
  const r1 = await run(budget);
  assert.deepEqual([r1.published, r1.budgetExhausted, r1.pendingDueAtEnd,
    r1.outcome], [2, true, 3, "backlog"]);
  assert.deepEqual(await notifiedIds(t.workspaceId),
    new Set(byAge.slice(0, 2)), "os dois vencimentos mais antigos");
  const r2 = await run(budget);
  assert.deepEqual([r2.published, r2.pendingDueAtEnd, r2.outcome],
    [2, 1, "backlog"]);
  const r3 = await run(budget);
  assert.deepEqual([r3.published, r3.budgetExhausted, r3.pendingDueAtEnd,
    r3.outcome], [1, false, 0, "drained"]);
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set(byAge));
  assert.equal((await overdueNotices(t.workspaceId)).length, 5,
    "nenhum reprocessado");
  assert.equal(r1.published + r2.published + r3.published, 5);
});

test("P5-D2.1 §15.16b orçamento de tempo: a primeira página sempre roda; " +
  "esgotado o tempo, a execução para de iniciar páginas e sinaliza backlog",
async () => {
  await drain();
  const {t, clientId} = await newTenant("p21p2");
  for (const offset of [9, 8, 7]) {
    await openReceivable(t, clientId, day(-offset));
  }
  const summary = await run({pageSize: 1, timeBudgetMs: 0});
  assert.deepEqual([summary.pages, summary.published, summary.budgetExhausted,
    summary.pendingDueAtEnd, summary.outcome], [1, 1, true, 2, "backlog"]);
  await run();
  assert.equal((await overdueNotices(t.workspaceId)).length, 3);
});

test("P5-D2.1 §15.17 item da fila malformado (estado de controle " +
  "inválido): o caminho manda; o conteúdo não desvia o aviso para outro " +
  "workspace nem para outro episódio", async () => {
  const {t: a, clientId} = await newTenant("p21qa");
  const {t: b} = await newTenant("p21qb");
  const id = await openReceivable(a, clientId, day(-4));
  await overdueQueueRef(a.workspaceId, id).update({
    schemaVersion: 99,
    workspaceId: b.workspaceId,
    receivableId: "outro-recebivel",
    dueDate: "lixo",
    attempts: "muitas",
  });
  const summary = await run();
  assert.equal(summary.failed, 0);
  const notices = await noticesOf(a.workspaceId, id);
  assert.equal(notices.length, 1);
  expectNotice(notices[0], {workspaceId: a.workspaceId, receivableId: id,
    dueDate: day(-4), detectedOn: DAY, createdAtMs: NOW});
  assert.deepEqual(await overdueNotices(b.workspaceId), []);
  assert.deepEqual(await deliveriesOf(b.workspaceId), []);
});

test("P5-D2.1 §15.18 trabalho inserido antes do cursor da execução fica " +
  "para a seguinte, sem se perder", async () => {
  await drain();
  const {t, clientId} = await newTenant("p21r");
  const ids = [
    await openReceivable(t, clientId, day(-5)),
    await openReceivable(t, clientId, day(-4)),
    await openReceivable(t, clientId, day(-3)),
  ];
  let inserted = "";
  const summary = await run({pageSize: 1, maxPages: 10, faults: {
    beforeTransaction: async (item) => {
      if (item.receivableId !== ids[0] || inserted) return;
      inserted = await openReceivable(t, clientId, day(-30));
    },
  }});
  assert.ok(inserted);
  assert.equal(summary.published, 3);
  assert.equal(summary.pendingDueAtEnd, 1);
  assert.equal(summary.outcome, "backlog");
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set(ids));
  const next = await run();
  assert.equal(next.published, 1);
  assert.deepEqual(await notifiedIds(t.workspaceId),
    new Set([...ids, inserted]));
});

test("P5-D2.1 §15.19 recebível fora do contrato: não publica, segue " +
  "recuperável com backoff e publica depois de corrigido; recebível " +
  "ausente encerra o trabalho", async () => {
  await drain(day(1));
  const {t, clientId} = await newTenant("p21s");
  const invalid = await openReceivable(t, clientId, day(-2));
  const missing = await openReceivable(t, clientId, day(-2));
  const original = (await receivableRef(t.workspaceId, invalid).get()).data();
  assert.ok(original);
  await receivableRef(t.workspaceId, invalid).update({balanceCents: 1});
  await receivableRef(t.workspaceId, missing).delete();

  const r1 = await run();
  assert.equal(r1.invalid, 1);
  assert.equal(r1.closed, 1);
  assert.equal(r1.outcome, "recoverable_failures");
  assert.deepEqual(await overdueNotices(t.workspaceId), []);
  assert.equal(await queueOf(t.workspaceId, missing), undefined);
  const kept = await queueOf(t.workspaceId, invalid);
  assert.equal(kept?.attempts, 1);
  assert.equal(kept?.lastErrorCode, "receivable_invalid");
  assert.equal(kept?.runAfterDay, day(-1));
  await run();
  assert.equal((await queueOf(t.workspaceId, invalid))?.runAfterDay, day(1));

  await receivableRef(t.workspaceId, invalid).set(original);
  await run({today: day(1), nowMs: NOW + DAY_MS});
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set([invalid]));
  assert.equal(await queueOf(t.workspaceId, invalid), undefined);
});

test("P5-D2.1 §15.20 workspace arquivado: o fato ocorreu e o aviso é " +
  "publicado (precedente de recorrentes; leitura pelas Rules da D-18)",
async () => {
  const {t, clientId} = await newTenant("p21t");
  const id = await openReceivable(t, clientId, day(-2));
  await db().doc(`workspaces/${t.workspaceId}`).update({status: "archived"});
  await run();
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set([id]));
  await expectDelivery(t.workspaceId, id, day(-2));
});

test("P5-D2.1 §15.21 isolamento A/B: o item na fila de B que aponta para um " +
  "recebível de A não lê A nem publica em lugar nenhum", async () => {
  const {t: a, clientId} = await newTenant("p21ua");
  const {t: b} = await newTenant("p21ub");
  const id = await openReceivable(a, clientId, day(-2));
  const forged = (await overdueQueueRef(a.workspaceId, id).get()).data();
  assert.ok(forged);
  await overdueQueueRef(b.workspaceId, id).set({...forged,
    workspaceId: a.workspaceId});
  await overdueQueueRef(a.workspaceId, id).delete();
  const summary = await run();
  assert.ok(summary.closed >= 1, "em B, o recebível não existe");
  assert.deepEqual(await overdueNotices(a.workspaceId), []);
  assert.deepEqual(await overdueNotices(b.workspaceId), []);
  assert.deepEqual(await deliveriesOf(a.workspaceId), []);
  assert.deepEqual(await deliveriesOf(b.workspaceId), []);
  assert.deepEqual(await queueItemsOf(b.workspaceId), []);
});

test("P5-D2.1 §10 deduplicação depois do TTL: aviso apagado 181 dias " +
  "depois, recebível ainda aberto e trabalho reaberto não reemitem; a " +
  "antiguidade do vencimento não bloqueia outro recebível", async () => {
  const {t, clientId} = await newTenant("p21v");
  const id = await openReceivable(t, clientId, day(-2));
  await run();
  const [notice] = await noticesOf(t.workspaceId, id);
  assert.equal(Date.parse(String(notice.createdAt)) + APPROVED_RETENTION_MS,
    (notice.expiresAt as Timestamp).toMillis());
  // TTL simulado: o Emulator não executa a política.
  await notificationRef(t.workspaceId, String(notice.id)).delete();
  // O trabalho volta por uma escrita legítima: vencimento alterado e
  // restaurado.
  await editReceivable(t.owner, await receivableUpdatePayload(t.workspaceId,
    id, {dueDate: day(200)}));
  await editReceivable(t.owner, await receivableUpdatePayload(t.workspaceId,
    id, {dueDate: day(-2)}));
  assert.ok(await queueOf(t.workspaceId, id));
  const ancient = await openReceivable(t, clientId, day(-400));
  const later = NOW + 181 * DAY_MS;
  const summary = await run({today: day(181), nowMs: later});
  assert.ok(summary.alreadyDelivered >= 1);
  assert.deepEqual(await noticesOf(t.workspaceId, id), [],
    "a confirmação durável impede a reemissão");
  await expectDelivery(t.workspaceId, id, day(-2));
  assert.equal(await queueOf(t.workspaceId, id), undefined);
  const [old] = await noticesOf(t.workspaceId, ancient);
  expectNotice(old, {workspaceId: t.workspaceId, receivableId: ancient,
    dueDate: day(-400), detectedOn: day(181), createdAtMs: later});
});

test("P5-D2.1 §14 o aviso não toca o domínio financeiro: recebíveis, " +
  "movimentos, caixa, contas e auditoria ficam idênticos", async () => {
  const {t, clientId} = await newTenant("p21w");
  const id = await openReceivable(t, clientId, day(-6));
  await receive(t.owner, await receivePayload(t.workspaceId, id,
    {principalCents: 25_000}));
  await openReceivable(t, clientId, day(-1));
  const before = await domainSnapshot(t.workspaceId);
  assert.ok(before.size > 5);
  await run();
  await run({today: day(3), nowMs: NOW + 3 * DAY_MS});
  assertDomainUntouched(before, await domainSnapshot(t.workspaceId));
  await assertLedgerConsistent(t.workspaceId);
  assert.equal((await overdueNotices(t.workspaceId)).length, 2);
});

// ======================================================= §16 adversariais

test("P5-D2.1 §16.2 resposta perdida depois do commit: aviso e " +
  "confirmação já existem; a próxima execução não duplica", async () => {
  await drain();
  const {t, clientId} = await newTenant("p21x");
  const id = await openReceivable(t, clientId, day(-2));
  const lost = await run({faults: failFor("afterCommit", [id])});
  assert.equal(lost.failed, 1);
  assert.equal(lost.retryNotRecorded, 1,
    "o item já saiu: o registro da falha não regrava nada");
  const notices = await noticesOf(t.workspaceId, id);
  assert.equal(notices.length, 1);
  await expectDelivery(t.workspaceId, id, day(-2));
  assert.equal(await queueOf(t.workspaceId, id), undefined);
  const next = await run({nowMs: NOW + 60_000});
  assert.deepEqual(countersOf(next), ZERO_COUNTERS);
  await run({today: day(1), nowMs: NOW + DAY_MS});
  assert.deepEqual(await noticesOf(t.workspaceId, id), notices);
});

test("P5-D2.1 §16.3 dois workers simultâneos: uma publicação e uma " +
  "confirmação por recebível, sem efeito financeiro e sem prorrogar o TTL",
async () => {
  await drain();
  const tenants = [await newTenant("p21ya"), await newTenant("p21yb")];
  const expected = new Map<string, Set<string>>();
  for (const {t, clientId} of tenants) {
    const ids = new Set<string>();
    for (let index = 0; index < 15; index += 1) {
      ids.add(await openReceivable(t, clientId, day(-(index + 1))));
    }
    expected.set(t.workspaceId, ids);
  }
  const before = await domainSnapshot(tenants[0].t.workspaceId);
  const {result: runs, logs} = await captureLogs(() => Promise.all([
    run({runId: "worker-a"}),
    run({runId: "worker-b"}),
  ]));
  assert.equal(runs[0].failed + runs[1].failed, 0);
  assert.equal(runs[0].published + runs[1].published, 30,
    "cada item publicado por exatamente um worker");
  assert.equal(logs.filter((entry) =>
    entry.event === "notification_published").length, 30);
  for (const [workspaceId, ids] of expected) {
    assert.deepEqual(await notifiedIds(workspaceId), ids);
    assert.equal((await overdueNotices(workspaceId)).length, ids.size);
    assert.equal((await deliveriesOf(workspaceId)).length, ids.size);
    assert.deepEqual(await queueItemsOf(workspaceId), []);
  }
  assertDomainUntouched(before,
    await domainSnapshot(tenants[0].t.workspaceId));
  const snapshot = await overdueNotices(tenants[1].t.workspaceId);
  await Promise.all([
    run({today: day(9), nowMs: NOW + 9 * DAY_MS}),
    run({today: day(9), nowMs: NOW + 9 * DAY_MS}),
  ]);
  assert.deepEqual(await overdueNotices(tenants[1].t.workspaceId), snapshot,
    "createdAt e expiresAt da primeira publicação");
});

test("P5-D2.1 §16.3b corrida real entre a rotina e quitações: nunca aviso " +
  "sem confirmação nem confirmação sem aviso; quitado não fica na fila",
async () => {
  await drain();
  const {t, clientId} = await newTenant("p21race");
  const ids: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    ids.push(await openReceivable(t, clientId, day(-(index + 2))));
  }
  const payloads = await Promise.all(ids.map((id) =>
    receivePayload(t.workspaceId, id, {principalCents: 100_000})));
  const [, ...receipts] = await Promise.allSettled([
    run({concurrency: 4}),
    ...payloads.map((payload) => receive(t.owner, payload)),
  ]);
  for (const [index, id] of ids.entries()) {
    const [notice] = await noticesOf(t.workspaceId, id);
    const delivery = await deliveryOf(t.workspaceId,
      noticeIdOf(t.workspaceId, id, day(-(index + 2))));
    assert.equal(Boolean(notice), Boolean(delivery),
      `${id}: aviso e confirmação andam juntos`);
    const status = (await receivableRef(t.workspaceId, id).get())
      .get("status");
    const queued = await queueOf(t.workspaceId, id);
    if (status === "received") {
      assert.equal(queued, undefined, `${id}: quitado sai da fila`);
    } else {
      assert.equal(receipts[index].status, "rejected");
      assert.ok(delivery || queued, `${id}: aberto, publicado ou na fila`);
    }
  }
});

/** Backlog semeado no formato do domínio (instrumentação de volume). */
const seedBacklog = async (
  t: Tenant,
  template: admin.firestore.DocumentData,
  count: number,
  dueDateOf: (index: number) => string,
) => {
  const ids: string[] = [];
  for (let start = 0; start < count; start += 200) {
    const batch = db().batch();
    for (let index = start; index < Math.min(count, start + 200); index += 1) {
      const id = uniqueId(`bk${index}`);
      const dueDate = dueDateOf(index);
      batch.set(receivableRef(t.workspaceId, id),
        {...template, id, dueDate});
      batch.set(overdueQueueRef(t.workspaceId, id), {
        schemaVersion: 1, workspaceId: t.workspaceId, receivableId: id,
        dueDate, runAfterDay: shiftDays(dueDate, 1), attempts: 0,
        lastErrorCode: null, lastAttemptAt: null,
        updatedAt: Timestamp.now(),
      });
      ids.push(id);
    }
    await batch.commit();
  }
  return ids;
};

test("P5-D2.1 §16.4 backlog multi-workspace acima da capacidade: rodadas " +
  "até esvaziar, conjunto exato de IDs, defeituosos não bloqueiam novos e " +
  "concluídos não são reprocessados", async () => {
  await drain(day(1));
  const tenants = [await newTenant("p21za"), await newTenant("p21zb"),
    await newTenant("p21zc")];
  const expected = new Map<string, Set<string>>();
  for (const [position, {t, clientId}] of tenants.entries()) {
    const seed = await openReceivable(t, clientId, day(-1));
    const template = (await receivableRef(t.workspaceId, seed).get()).data();
    assert.ok(template);
    const ids = await seedBacklog(t, template, 400, (index) =>
      day(-(2 + ((index * 7 + position) % 900))));
    expected.set(t.workspaceId, new Set([seed, ...ids]));
  }
  // Defeituosos com os vencimentos mais antigos: na frente da fila.
  const broken = new Set<string>();
  const {t: bt, clientId: bc} = tenants[0];
  for (let index = 0; index < 5; index += 1) {
    const id = await openReceivable(bt, bc, day(-(2000 + index)));
    await receivableRef(bt.workspaceId, id).update({balanceCents: 7});
    broken.add(id);
  }
  const total = [...expected.values()]
    .reduce((sum, ids) => sum + ids.size, 0);
  assert.equal(total, 1203);
  const budget = {pageSize: 100, maxPages: 5};
  const runs: ReceivableOverdueSummary[] = [await run(budget)];
  assert.equal(runs[0].published, 495, "defeituosos não bloqueiam a página");
  assert.equal(runs[0].invalid, 5);
  assert.equal(runs[0].budgetExhausted, true);
  assert.equal(runs[0].outcome, "recoverable_failures");
  // Um recebível novo, criado com o backlog ainda grande, entra na fila.
  const fresh = await openReceivable(tenants[1].t, tenants[1].clientId,
    day(-1));
  expected.get(tenants[1].t.workspaceId)?.add(fresh);
  for (let round = 0; round < 6; round += 1) {
    const summary = await run(budget);
    runs.push(summary);
    if (summary.pendingDueAtEnd === 0) break;
  }
  const last = runs[runs.length - 1];
  assert.equal(last.pendingDueAtEnd, 0, "a fila esvaziou");
  assert.ok(runs.every((summary) => summary.published <= 500));
  assert.equal(runs.reduce((sum, summary) => sum + summary.published, 0),
    total + 1, "cada item publicado uma única vez");
  for (const [workspaceId, ids] of expected) {
    assert.deepEqual(await notifiedIds(workspaceId), ids,
      "conjunto exato de IDs, não só a contagem");
    assert.equal((await overdueNotices(workspaceId)).length, ids.size);
    assert.equal((await deliveriesOf(workspaceId)).length, ids.size);
  }
  for (const id of broken) {
    const item = await queueOf(bt.workspaceId, id);
    assert.equal(item?.lastErrorCode, "receivable_invalid", "não descartado");
    assert.equal(item?.attempts, 2);
    assert.equal(item?.runAfterDay, day(1));
  }
});

test("P5-D2.1 §16.5 aviso publicado sem confirmação (rotina da P5-D2) é " +
  "reconciliado: grava só a confirmação, sem duplicar nem regravar",
async () => {
  const {t, clientId} = await newTenant("p21aa");
  const id = await openReceivable(t, clientId, day(-3));
  const legacyMs = NOW - 2 * DAY_MS;
  const legacy = buildNotificationDocument(receivableOverdueNotification({
    workspaceId: t.workspaceId, receivableId: id, dueDate: day(-3),
    today: day(-2), createdAtMs: legacyMs,
  }));
  await notificationRef(t.workspaceId, legacy.id).create(legacy);
  const before = await noticesOf(t.workspaceId, id);
  const summary = await run();
  assert.ok(summary.reconciled >= 1);
  assert.deepEqual(await noticesOf(t.workspaceId, id), before,
    "o aviso anterior fica como está");
  await expectDelivery(t.workspaceId, id, day(-3), "reconciled");
  assert.equal(await queueOf(t.workspaceId, id), undefined);
});

// ================================================= §11 custo e §18 sinais

test("P5-D2.1 §11 custo instrumentado por item e execução sem " +
  "pendências", async () => {
  await drain(day(2));
  const {t, clientId} = await newTenant("p21ab");
  const delivered = await openReceivable(t, clientId, day(-4));
  await run({today: day(2)});
  assert.deepEqual(await notifiedIds(t.workspaceId), new Set([delivered]));
  const paid = await receive(t.owner, await receivePayload(t.workspaceId,
    delivered, {principalCents: 100_000}));
  await reverse(t.owner, await reversePayload(t.workspaceId, delivered,
    String(paid.movementId)));
  assert.ok(await queueOf(t.workspaceId, delivered), "reaberto: na fila");
  const published = [await openReceivable(t, clientId, day(-2)),
    await openReceivable(t, clientId, day(-3))];
  const failing = await openReceivable(t, clientId, day(-7));

  const tx = admin.firestore.Transaction.prototype;
  const spies = {
    getAll: mock.method(tx, "getAll"),
    create: mock.method(tx, "create"),
    update: mock.method(tx, "update"),
    delete: mock.method(tx, "delete"),
    query: mock.method(Query.prototype, "get"),
  };
  let summary: ReceivableOverdueSummary;
  try {
    // Falha não transitória (sem código gRPC): o SDK não repete a transação.
    summary = await run({today: day(2), faults: failFor("beforeCommit",
      [failing], () => new Error("falha injetada"))});
  } finally {
    for (const spy of Object.values(spies)) spy.mock.restore();
  }
  assert.deepEqual(countersOf(summary), {...ZERO_COUNTERS, scanned: 4,
    published: 2, alreadyDelivered: 1, failed: 1, retriedSameDay: 1});
  // Cada item: 2 leituras em lote (item + recebível; confirmação + aviso),
  // todas antes de qualquer escrita.
  assert.equal(spies.getAll.mock.callCount(), 4 * 2);
  assert.equal(spies.getAll.mock.calls
    .reduce((sum, call) => sum + call.arguments.length, 0), 4 * 4);
  // Publicação: aviso + confirmação. O item que falhou também as enfileirou
  // antes do commit abortado (nada gravado).
  assert.equal(spies.create.mock.callCount(), 2 * 2 + 2);
  // Remoção da fila: 2 publicados + 1 já entregue + 1 abortado.
  assert.equal(spies.delete.mock.callCount(), 4);
  assert.equal(spies.update.mock.callCount(), 0,
    "a falha é registrada fora da transação, com pré-condição de versão");
  assert.equal(spies.query.mock.callCount(), 1, "uma página");
  assert.equal((await queueOf(t.workspaceId, failing))?.attempts, 1);
  assert.equal((await queueOf(t.workspaceId, failing))?.lastErrorCode,
    "unknown");
  assert.deepEqual(await notifiedIds(t.workspaceId),
    new Set([delivered, ...published]));

  // Falha transitória (UNAVAILABLE) dentro da transação: o próprio SDK a
  // repete na mesma execução (até 5 tentativas, cada uma com as 2 leituras
  // em lote) e só então a rotina registra uma tentativa com backoff.
  const transient = await openReceivable(t, clientId, day(-8));
  const retrySpy = mock.method(tx, "getAll");
  let retried: ReceivableOverdueSummary;
  try {
    retried = await run({today: day(2),
      faults: failFor("beforeCommit", [transient])});
  } finally {
    retrySpy.mock.restore();
  }
  const ofTransient = retrySpy.mock.calls.filter((call) =>
    String((call.arguments[0] as {path?: string}).path)
      .endsWith(`/${transient}`));
  assert.equal(ofTransient.length, 5, "5 tentativas do SDK");
  assert.equal(retried.failed, 1);
  assert.equal(retried.published, 1,
    "o item que falhou na execução anterior volta e publica");
  assert.ok((await notifiedIds(t.workspaceId)).has(failing));
  assert.equal((await queueOf(t.workspaceId, transient))?.attempts, 1);
  assert.equal((await queueOf(t.workspaceId, transient))?.lastErrorCode,
    "unavailable");

  // Execução sem pendências: 1 consulta vazia e 1 contagem agregada.
  await drain(day(2));
  const querySpy = mock.method(Query.prototype, "get");
  const txSpy = mock.method(tx, "getAll");
  let idle: ReceivableOverdueSummary;
  try {
    idle = await run({today: day(2)});
  } finally {
    querySpy.mock.restore();
    txSpy.mock.restore();
  }
  assert.deepEqual(countersOf(idle), ZERO_COUNTERS);
  assert.deepEqual([idle.outcome, idle.pages, idle.pendingDueAtEnd,
    idle.budgetExhausted], ["idle", 1, 0, false]);
  assert.equal(querySpy.mock.callCount(), 1);
  assert.equal(txSpy.mock.callCount(), 0, "nenhuma transação");
});

test("P5-D2.1 §18 sinais: runId, contadores e desfecho em todo log, sem " +
  "dado pessoal; erro estrutural registrado e relançado sem tocar a fila",
async () => {
  await drain();
  const {t, clientId} = await newTenant("p21ac");
  const ok = await openReceivable(t, clientId, day(-2));
  const failing = await openReceivable(t, clientId, day(-3));
  const runId = `receivable-overdue-${DAY}T13:00:00.000Z`;
  const {result, logs} = await captureLogs(() => run({runId,
    faults: failFor("beforeTransaction", [failing])}));
  assert.equal(result.outcome, "recoverable_failures");
  const ours = logs.filter((entry) =>
    entry.operation === RECEIVABLE_OVERDUE_OPERATION);
  assert.equal(ours.length, logs.length, "todo log é da operação");
  for (const entry of ours) {
    assert.equal(entry.runId, runId);
    assertNoWords(entry, RECEIVABLE_PII);
  }
  const byEvent = (event: string) => ours.filter((entry) =>
    entry.event === event);
  const [completed] = byEvent("receivable_overdue_notifications_completed");
  assert.equal(completed.severity, "INFO");
  for (const field of ["scanned", "published", "alreadyDelivered",
    "reconciled", "closed", "rescheduled", "invalid", "gone", "failed",
    "persistentFailures", "retriedSameDay", "retryNotRecorded", "pages",
    "deferred", "throttled", "budgetExhausted", "pendingDueAtEnd", "backlog",
    "durationMs", "outcome", "today"]) {
    assert.ok(field in completed, `resumo com ${field}`);
  }
  assert.equal(completed.outcome, "recoverable_failures");
  assert.equal(completed.published, 1);
  assert.equal(completed.failed, 1);
  const [attention] = byEvent("receivable_overdue_notifications_attention");
  assert.equal(attention.severity, "WARNING");
  const [failed] = byEvent("receivable_overdue_item_failed");
  assert.equal(failed.severity, "ERROR");
  assert.deepEqual([failed.workspaceId, failed.receivableId, failed.errorCode,
    failed.attempts], [t.workspaceId, failing, "unavailable", 1]);
  const [published] = byEvent("notification_published");
  assert.equal(published.notificationId, noticeIdOf(t.workspaceId, ok,
    day(-2)));

  // Erro estrutural: a consulta da fila falha.
  const pending = await openReceivable(t, clientId, day(-4));
  const spy = mock.method(Query.prototype, "get");
  spy.mock.mockImplementationOnce(() =>
    Promise.reject(Object.assign(new Error("índice ausente"), {code: 9})));
  let structural: LogEntry[] = [];
  try {
    structural = (await captureLogs(async () => {
      await assert.rejects(run({runId}), /índice ausente/);
    })).logs;
  } finally {
    spy.mock.restore();
  }
  const [error] = structural.filter((entry) =>
    entry.event === "receivable_overdue_notifications_structural_error");
  assert.equal(error.severity, "ERROR");
  assert.equal(error.outcome, "structural_error");
  assert.equal(error.runId, runId);
  assert.equal((await queueOf(t.workspaceId, pending))?.attempts, 0,
    "a fila fica intacta");
  await run({faults: failFor("beforeTransaction", [failing])});
  assert.ok((await notifiedIds(t.workspaceId)).has(pending));
});

test("P5-D2.1 §17 declaração: índice de grupo de runAfterDay na fila, sem " +
  "TTL nas estruturas de controle, sem o índice de grupo de receivables e " +
  "agenda horária em São Paulo", () => {
  const file = path.resolve(__dirname, "..", "..", "..", "..",
    "firestore.indexes.json");
  const config = JSON.parse(readFileSync(file, "utf8")) as {
    indexes: Array<{collectionGroup: string; queryScope: string}>;
    fieldOverrides: Array<{
      collectionGroup: string;
      fieldPath: string;
      ttl?: boolean;
      indexes: Array<{order?: string; queryScope?: string}>;
    }>;
  };
  const queue = config.fieldOverrides.filter((item) =>
    item.collectionGroup === "receivable_overdue_queue");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].fieldPath, "runAfterDay");
  assert.ok(!queue[0].ttl);
  assert.ok(queue[0].indexes.some((index) => index.order === "ASCENDING" &&
    index.queryScope === "COLLECTION_GROUP"));
  assert.deepEqual(config.fieldOverrides.filter((item) =>
    item.collectionGroup === "receivable_overdue_deliveries"), [],
  "a confirmação não tem TTL nem índice próprio");
  assert.deepEqual(config.indexes.filter((index) =>
    index.collectionGroup === "receivables" &&
    index.queryScope === "COLLECTION_GROUP"), [],
  "a varredura de recebíveis da P5-D2 saiu com o seu índice");
  const endpoint = (processReceivableOverdueNotifications as unknown as {
    __endpoint: {scheduleTrigger: {schedule: string; timeZone: string}};
  }).__endpoint;
  assert.equal(endpoint.scheduleTrigger.schedule, "every 60 minutes");
  assert.equal(endpoint.scheduleTrigger.timeZone, "America/Sao_Paulo");
});
