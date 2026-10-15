import assert from "node:assert/strict";
import test from "node:test";

import {Timestamp} from "firebase-admin/firestore";

import {addDaysToDayKey} from "../../shared/dateKeys";
import {sha256} from "../../shared/hashing";
import {RETENTION_DAYS} from "../../shared/retention";
import {db} from "../../workspaces/testSupport/p1TestSupport";
import {runCreditCardInvoiceClosing} from "../closing";
import {invoiceIdFor} from "../model";
import {
  buy,
  cardEventsOf,
  createCard,
  entriesOf,
  invoicesOf,
  seedCardTenant,
  transactionsOf,
  type CardTenant,
} from "../testSupport/cardTestSupport";

/**
 * D-18-NOTIF — retenção dos eventos de notificação do cartão no Emulator.
 *
 * Fatura de 2014-01: fecha em 10/01 e vence em 20/01 (cartão com fechamento
 * dia 10 e vencimento dia 20). O Emulator não executa a política de TTL do
 * Firestore: onde um teste fala em expiração física, a exclusão é simulada
 * apagando o documento pelo Admin SDK, como o TTL faria.
 */

const DAY_MS = 86_400_000;
/** Prazo aprovado pelo usuário (D-18-NOTIF), independente da constante. */
const APPROVED_RETENTION_DAYS = 180;
const RETENTION_MS = APPROVED_RETENTION_DAYS * DAY_MS;

type Doc = Record<string, unknown>;

const notificationIdFor = (kind: string, invoiceId: string): string =>
  `cc${kind}_${sha256(`${kind}:${invoiceId}`).slice(0, 32)}`;

const eventsPath = (workspaceId: string) =>
  `workspaces/${workspaceId}/notifications`;

const statePath = (workspaceId: string, uid: string, id: string) =>
  `workspaces/${workspaceId}/notification_user_states/${uid}/` +
  `notification_entries/${id}`;

const notificationsOf = async (workspaceId: string): Promise<Doc[]> =>
  (await db().collection(eventsPath(workspaceId)).get()).docs
    .map((doc) => ({id: doc.id, ...doc.data()}));

const byTitle = (items: Doc[], title: string): Doc => {
  const found = items.find((item) => item.title === title);
  assert.ok(found, `notificação "${title}" ausente`);
  return found;
};

/** Contrato de retenção: createdAt ISO + expiresAt Timestamp, 180 dias. */
const assertRetentionContract = (item: Doc) => {
  assert.equal(typeof item.createdAt, "string");
  const createdMs = Date.parse(String(item.createdAt));
  assert.ok(Number.isFinite(createdMs), "createdAt é um ISO válido");
  assert.equal(new Date(createdMs).toISOString(), item.createdAt);
  assert.ok(item.expiresAt instanceof Timestamp,
    "expiresAt é Timestamp nativo");
  assert.equal(item.expiresAt.toMillis() - createdMs, RETENTION_MS,
    "expiresAt = createdAt + 180 dias exatos");
};

/** Cartão com uma compra à vista em 02/01/2014 (fatura 2014-01). */
const seedInvoice = async (t: CardTenant, name = "Cartão Retenção") => {
  const cardId = await createCard(t, {closingDay: 10, dueDay: 20, name});
  await buy(t, cardId, "2014-01-02", {totalCents: 25_000});
  return {cardId, invoiceId: invoiceIdFor(cardId, "2014-01")};
};

test("D-18 — fechamento grava expiresAt Timestamp e createdAt ISO, " +
  "180 dias exatos", async () => {
  assert.equal(RETENTION_DAYS.notifications, APPROVED_RETENTION_DAYS,
    "prazo aprovado (D-18-NOTIF)");
  const t = await seedCardTenant("PF", "nr-close");
  const {invoiceId} = await seedInvoice(t);
  const summary = await runCreditCardInvoiceClosing({today: "2014-01-12"});
  assert.equal(summary.failed, 0);
  const items = await notificationsOf(t.workspaceId);
  assert.equal(items.length, 1, "só o aviso de fechamento");
  const closed = byTitle(items, "Fatura fechada");
  assert.equal(closed.id, notificationIdFor("closed", invoiceId));
  assert.equal(closed.domainEventType, "invoice_closed");
  assertRetentionContract(closed);
  assert.equal("read" in closed, false, "sem estado privado no evento");
});

test("D-18 — vencimento próximo e atraso gravam o mesmo contrato de " +
  "retenção", async () => {
  const t = await seedCardTenant("PF", "nr-due");
  const {invoiceId} = await seedInvoice(t);
  await runCreditCardInvoiceClosing({today: "2014-01-18"});
  await runCreditCardInvoiceClosing({today: "2014-01-22"});
  const items = await notificationsOf(t.workspaceId);
  assert.equal(items.length, 3);
  const dueSoon = byTitle(items, "Fatura próxima do vencimento");
  const overdue = byTitle(items, "Fatura vencida");
  assert.equal(dueSoon.id, notificationIdFor("due", invoiceId));
  assert.equal(overdue.id, notificationIdFor("overdue", invoiceId));
  for (const item of items) assertRetentionContract(item);
});

test("D-18 — IDs determinísticos e sem duplicidade: reexecução no mesmo " +
  "dia e no dia seguinte não altera createdAt nem expiresAt", async () => {
  const t = await seedCardTenant("PF", "nr-idem");
  const {invoiceId} = await seedInvoice(t);
  await runCreditCardInvoiceClosing({today: "2014-01-18"});
  const before = await notificationsOf(t.workspaceId);
  assert.equal(before.length, 2, "fechada e próxima do vencimento");
  assert.deepEqual(
    before.map((item) => item.id).sort(),
    [notificationIdFor("closed", invoiceId),
      notificationIdFor("due", invoiceId)].sort());
  // Garante que um segundo instante de relógio seria distinguível.
  await new Promise((resolve) => setTimeout(resolve, 25));
  await runCreditCardInvoiceClosing({today: "2014-01-18"});
  await runCreditCardInvoiceClosing({today: "2014-01-19"});
  const after = await notificationsOf(t.workspaceId);
  assert.equal(after.length, 2, "nenhum documento novo");
  for (const item of before) {
    const same = after.find((other) => other.id === item.id);
    assert.ok(same, `${String(item.id)} permanece`);
    assert.equal(same.createdAt, item.createdAt, "createdAt inalterado");
    assert.ok((same.expiresAt as Timestamp).isEqual(item.expiresAt as
      Timestamp), "expiresAt inalterado (retry não prorroga)");
    assert.deepEqual(same, item, "documento inteiro inalterado");
  }
});

test("D-18 — fechamento com aviso já existente: a transação não regrava " +
  "o evento nem prorroga a retenção, e a fatura fecha", async () => {
  const t = await seedCardTenant("PF", "nr-exists");
  const {cardId, invoiceId} = await seedInvoice(t);
  const id = notificationIdFor("closed", invoiceId);
  const seededCreatedMs = Date.parse("2013-12-01T10:00:00.000Z");
  const seeded = {
    id,
    workspaceId: t.workspaceId,
    title: "Fatura fechada",
    message: "semente",
    createdAt: new Date(seededCreatedMs).toISOString(),
    expiresAt: Timestamp.fromMillis(seededCreatedMs + RETENTION_MS),
  };
  await db().doc(`${eventsPath(t.workspaceId)}/${id}`).set(seeded);
  const summary = await runCreditCardInvoiceClosing({today: "2014-01-12"});
  assert.equal(summary.failed, 0);
  const invoices = (await invoicesOf(t.workspaceId, cardId)) as Doc[];
  assert.equal(invoices.length, 1);
  assert.equal(invoices[0].cycleStatus, "closed", "a fatura fechou");
  const stored = (await db().doc(`${eventsPath(t.workspaceId)}/${id}`).get())
    .data();
  assert.deepEqual(stored, seeded, "evento existente intocado");
});

test("D-18 — fechamentos concorrentes criam um único aviso, com " +
  "expiresAt de 180 dias do próprio createdAt", async () => {
  const t = await seedCardTenant("PF", "nr-conc");
  await seedInvoice(t);
  const [a, b] = await Promise.all([
    runCreditCardInvoiceClosing({today: "2014-01-12", requestId: "nr-a"}),
    runCreditCardInvoiceClosing({today: "2014-01-12", requestId: "nr-b"}),
  ]);
  assert.equal(a.failed + b.failed, 0);
  const items = await notificationsOf(t.workspaceId);
  assert.equal(items.length, 1);
  assertRetentionContract(items[0]);
});

test("D-18 — estado privado 'excluída' (semeado via Admin) não reaparece: " +
  "o produtor repetido não toca o estado nem o evento", async () => {
  const t = await seedCardTenant("PF", "nr-deleted");
  await seedInvoice(t);
  await runCreditCardInvoiceClosing({today: "2014-01-18"});
  const events = await notificationsOf(t.workspaceId);
  assert.equal(events.length, 2);
  const states = new Map<string, Doc>();
  for (const event of events) {
    const state = {
      deleted: true,
      deletedAt: Timestamp.now(),
      expiresAt: event.expiresAt as Timestamp,
    };
    await db().doc(statePath(t.workspaceId, t.member, String(event.id)))
      .set(state);
    states.set(String(event.id), state);
  }
  await runCreditCardInvoiceClosing({today: "2014-01-18"});
  await runCreditCardInvoiceClosing({today: "2014-01-19"});
  const eventsAfter = await notificationsOf(t.workspaceId);
  assert.deepEqual(eventsAfter, events, "eventos não recriados nem alterados");
  for (const [id, state] of states) {
    const stored = (await db().doc(statePath(t.workspaceId, t.member, id))
      .get()).data();
    assert.deepEqual(stored, state, `estado de ${id} intocado`);
  }
  const entries = await db().collection(
    `workspaces/${t.workspaceId}/notification_user_states/${t.member}/` +
    "notification_entries").get();
  assert.equal(entries.size, states.size, "nenhum estado novo criado");
});

test("D-18 — isolamento: eventos de workspaces diferentes são " +
  "independentes, mesmo com ID já ocupado em outro workspace", async () => {
  const a = await seedCardTenant("PF", "nr-iso-a");
  const b = await seedCardTenant("PF", "nr-iso-b");
  const invoiceA = await seedInvoice(a, "Cartão A");
  const invoiceB = await seedInvoice(b, "Cartão B");
  // Um evento com o mesmo ID do aviso de A, semeado no workspace B.
  const sharedId = notificationIdFor("closed", invoiceA.invoiceId);
  const sentinel = {
    id: sharedId,
    workspaceId: b.workspaceId,
    title: "Semente de B",
    createdAt: "2013-12-01T10:00:00.000Z",
    expiresAt: Timestamp.fromMillis(Date.parse("2013-12-01T10:00:00.000Z") +
      RETENTION_MS),
  };
  await db().doc(`${eventsPath(b.workspaceId)}/${sharedId}`).set(sentinel);
  await runCreditCardInvoiceClosing({today: "2014-01-12"});

  const itemsA = await notificationsOf(a.workspaceId);
  assert.equal(itemsA.length, 1);
  assert.equal(itemsA[0].id, sharedId);
  assert.equal(itemsA[0].workspaceId, a.workspaceId);
  assert.equal(itemsA[0].invoiceId, invoiceA.invoiceId);
  assertRetentionContract(itemsA[0]);

  const itemsB = await notificationsOf(b.workspaceId);
  assert.equal(itemsB.length, 2, "a semente e o aviso próprio de B");
  assert.deepEqual(
    await db().doc(`${eventsPath(b.workspaceId)}/${sharedId}`).get()
      .then((doc) => doc.data()),
    sentinel, "o evento de A não tocou o ID homônimo em B");
  const ownB = byTitle(itemsB, "Fatura fechada");
  assert.equal(ownB.id, notificationIdFor("closed", invoiceB.invoiceId));
  assert.equal(ownB.workspaceId, b.workspaceId);
  assertRetentionContract(ownB);
});

test("D-18 — estados privados (lido/arquivado/excluído) não alteram " +
  "nenhum dado financeiro", async () => {
  const t = await seedCardTenant("PF", "nr-fin");
  const {cardId} = await seedInvoice(t);
  await runCreditCardInvoiceClosing({today: "2014-01-18"});
  const snapshot = async () => ({
    invoices: await invoicesOf(t.workspaceId, cardId),
    entries: await entriesOf(t.workspaceId, cardId),
    cardEvents: await cardEventsOf(t.workspaceId, cardId),
    transactions: await transactionsOf(t.workspaceId),
    purchases: (await db().collection(
      `workspaces/${t.workspaceId}/credit_card_purchases`).get()).docs
      .map((doc) => ({id: doc.id, ...doc.data()})),
  });
  const before = await snapshot();
  assert.ok(before.invoices.length > 0);
  assert.ok(before.entries.length > 0);
  assert.ok(before.purchases.length > 0);
  assert.ok(before.cardEvents.length > 0);

  const events = await notificationsOf(t.workspaceId);
  const marks = [
    {read: true, readAt: Timestamp.now()},
    {dismissed: true, dismissedAt: Timestamp.now()},
    {deleted: true, deletedAt: Timestamp.now()},
  ];
  for (const [index, event] of events.entries()) {
    await db().doc(statePath(t.workspaceId, t.admin, String(event.id))).set({
      ...marks[index % marks.length],
      expiresAt: event.expiresAt as Timestamp,
    });
  }
  await runCreditCardInvoiceClosing({today: "2014-01-18"});
  assert.deepEqual(await snapshot(), before,
    "faturas, compras, lançamentos, transações e eventos idênticos");
});

test("D-18 — após 180 dias o job não reemite o aviso de vencimento nem " +
  "de atraso (o Emulator não executa TTL: a exclusão física é simulada " +
  "pelo Admin SDK)", async () => {
  const t = await seedCardTenant("PF", "nr-window");
  await seedInvoice(t);
  await runCreditCardInvoiceClosing({today: "2014-01-18"});
  await runCreditCardInvoiceClosing({today: "2014-01-22"});
  const events = await notificationsOf(t.workspaceId);
  assert.equal(events.length, 3);
  // Simula a remoção física do TTL.
  for (const event of events) {
    await db().doc(`${eventsPath(t.workspaceId)}/${String(event.id)}`)
      .delete();
  }
  assert.equal((await notificationsOf(t.workspaceId)).length, 0);
  const later = addDaysToDayKey("2014-01-18", APPROVED_RETENTION_DAYS + 1);
  const summary = await runCreditCardInvoiceClosing({today: later});
  assert.equal(summary.failed, 0);
  assert.equal((await notificationsOf(t.workspaceId)).length, 0,
    "fora das janelas de 3 e 7 dias: nada reemitido");
});
