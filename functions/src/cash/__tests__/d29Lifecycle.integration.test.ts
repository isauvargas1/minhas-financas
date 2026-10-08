import assert from "node:assert/strict";
import test from "node:test";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {CASH_EVENTS_COLLECTION} from "../../shared/audit";
import {formatIsoInstant} from "../../shared/commitTime";
import {
  saoPauloDayKey,
  saoPauloMonthKey,
  saoPauloMonthStart,
} from "../../shared/dateKeys";
import {sha256} from "../../shared/hashing";
import {
  defaultAccountOf,
  seedActiveAccount,
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {
  handleTransactionWrite,
  type TransactionWriteEvent,
} from "../../triggers/transactions";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  confirmCashTransaction,
  createCashTransaction,
  updateCashTransaction,
  voidCashTransaction,
} from "../callables";
import type {CreateCashTransactionPayload} from "../contracts";
import {executeCreateCashTransaction} from "../createTransaction";
import {
  ALREADY_CONFIRMED_MESSAGE,
  CONFIRMED_STAYS_CONFIRMED_MESSAGE,
  CONFIRM_THROUGH_CONFIRMATION_MESSAGE,
  RECEIPT_PAYMENT_METHOD_MESSAGE,
  executeConfirmCashTransaction,
} from "../mutateTransaction";
import {cashPeriodDeltaFor, cashPeriodKeyFor} from "../periods";
import {executeRebuildCashPeriods} from "../rebuild";

/**
 * P3-F — D-29: lançamentos manuais pendentes e agendados, confirmação e a
 * regra única do caixa realizado, de ponta a ponta no Emulator.
 *
 * As callables rodam pelo caminho do runtime. A projeção é conferida
 * entregando ao gatilho real (`handleTransactionWrite`) o antes e o depois de
 * cada escrita, e comparando com a soma recalculada do ledger.
 */
db();

interface Tenant {
  workspaceId: string;
  owner: string;
  admin: string;
  member: string;
  otherMember: string;
  viewer: string;
}

const seedTenant = async (): Promise<Tenant> => {
  const tenant: Tenant = {
    workspaceId: uniqueId("d29-ws"),
    owner: uniqueId("d29-owner"),
    admin: uniqueId("d29-admin"),
    member: uniqueId("d29-member"),
    otherMember: uniqueId("d29-member-b"),
    viewer: uniqueId("d29-viewer"),
  };
  for (const uid of [
    tenant.owner, tenant.admin, tenant.member, tenant.otherMember,
    tenant.viewer,
  ]) {
    await seedActiveAccount(uid);
  }
  await seedWorkspace({workspaceId: tenant.workspaceId, ownerId: tenant.owner});
  await seedMember(tenant.workspaceId, tenant.admin, "admin");
  await seedMember(tenant.workspaceId, tenant.member, "member");
  await seedMember(tenant.workspaceId, tenant.otherMember, "member");
  await seedMember(tenant.workspaceId, tenant.viewer, "viewer");
  return tenant;
};

const today = saoPauloDayKey();
const shiftDays = (dayKey: string, days: number): string => {
  const date = new Date(`${dayKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const yesterday = shiftDays(today, -1);
const inTwoWeeks = shiftDays(today, 14);

const entryRef = (workspaceId: string, id: string) =>
  db().doc(`workspaces/${workspaceId}/transactions/${id}`);

const read = async (workspaceId: string, id: string) =>
  (await entryRef(workspaceId, id).get()).data() ?? {};

const versionOf = async (workspaceId: string, id: string) => {
  const updatedAt = (await read(workspaceId, id)).updatedAt;
  return updatedAt instanceof Timestamp ? formatIsoInstant(updatedAt) : null;
};

const events = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/${CASH_EVENTS_COLLECTION}`)
    .get()).docs.map((doc) => doc.data());

const mutationEvents = async (workspaceId: string) =>
  (await events(workspaceId)).filter((event) =>
    event.operation !== "cash_entry.created");

const quotaRef = (workspaceId: string, monthKey = saoPauloMonthKey()) =>
  db().doc(`workspaces/${workspaceId}/quota_state/transactions_${monthKey}`);

const usedOf = async (workspaceId: string, monthKey?: string) =>
  Number((await quotaRef(workspaceId, monthKey).get()).get("used") ?? 0);

interface CreateResult {transactionId: string; replayed: boolean}
interface MutationResult {
  transactionId: string;
  replayed: boolean;
  revision: number;
  changed?: boolean;
}

/** Como o SDK serializa: chave com `undefined` não viaja. */
const json = (data: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(data)) as Record<string, unknown>;

const createEntry = (
  uid: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
) => call<CreateResult>(createCashTransaction, uid, json({
  workspaceId,
  cashAccountId: defaultAccountOf(workspaceId),
  idempotencyKey: idempotencyKey(),
  type: "despesa",
  description: "Aluguel de outubro",
  category: "Moradia",
  amountCents: 180_000,
  status: "pending",
  dueDate: inTwoWeeks,
  expenseType: "Fixa",
  paymentMethod: "Boleto",
  ...overrides,
}));

const confirmPayload = async (
  workspaceId: string,
  transactionId: string,
  extra: Record<string, unknown> = {},
) => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  transactionId,
  expectedUpdatedAt: await versionOf(workspaceId, transactionId),
  date: yesterday,
  amountCents: 181_500,
  ...extra,
});

const confirm = (uid: string, data: Record<string, unknown>) =>
  call<MutationResult>(confirmCashTransaction, uid, data);

const voidPayload = async (
  workspaceId: string,
  transactionId: string,
  extra: Record<string, unknown> = {},
) => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  transactionId,
  expectedUpdatedAt: await versionOf(workspaceId, transactionId),
  reason: "Compromisso cancelado",
  ...extra,
});

const annul = (uid: string, data: Record<string, unknown>) =>
  call<MutationResult>(voidCashTransaction, uid, data);

const updatePayload = async (
  workspaceId: string,
  transactionId: string,
  entry: Record<string, unknown>,
) => json({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  transactionId,
  expectedUpdatedAt: await versionOf(workspaceId, transactionId),
  reason: "Valor do boleto corrigido",
  entry: {
    cashAccountId: defaultAccountOf(workspaceId),
    type: "despesa",
    description: "Aluguel de outubro",
    category: "Moradia",
    amountCents: 180_000,
    expenseType: "Fixa",
    paymentMethod: "Boleto",
    status: "pending",
    dueDate: inTwoWeeks,
    ...entry,
  },
});

const edit = (uid: string, data: Record<string, unknown>) =>
  call<MutationResult>(updateCashTransaction, uid, data);

/** Executa a escrita e entrega ao gatilho real o antes e o depois. */
const deliver = async (
  workspaceId: string,
  id: string,
  action: () => Promise<unknown>,
) => {
  const before = await entryRef(workspaceId, id).get();
  const result = await action();
  const after = await entryRef(workspaceId, id).get();
  assert.ok(after.updateTime);
  const event: TransactionWriteEvent = {
    eventId: uniqueId(`evt-${id}`),
    workspaceId,
    transactionId: id,
    eventTime: after.updateTime,
    before: before.exists ? before.data() : undefined,
    after: after.data(),
    beforeCreateTime: before.exists ? before.createTime : undefined,
  };
  await handleTransactionWrite(event);
  return result;
};

const createDelivered = async (
  uid: string,
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> => {
  const created = await createEntry(uid, workspaceId, overrides);
  const after = await entryRef(workspaceId, created.transactionId).get();
  await handleTransactionWrite({
    eventId: uniqueId(`evt-${created.transactionId}`),
    workspaceId,
    transactionId: created.transactionId,
    eventTime: after.updateTime as Timestamp,
    before: undefined,
    after: after.data(),
  });
  return created.transactionId;
};

type Totals = Record<string, {net: number; count: number}>;

const truth = async (workspaceId: string): Promise<Totals> => {
  const snapshot = await db()
    .collection(`workspaces/${workspaceId}/transactions`).get();
  const totals: Totals = {};
  for (const doc of snapshot.docs) {
    const key = cashPeriodKeyFor(doc.data());
    const delta = cashPeriodDeltaFor(doc.data());
    if (!key || (!delta.netCents && !delta.transactionCount)) continue;
    const bucket = totals[key] ?? {net: 0, count: 0};
    bucket.net += delta.netCents;
    bucket.count += delta.transactionCount;
    totals[key] = bucket;
  }
  return totals;
};

const projected = async (workspaceId: string): Promise<Totals> => {
  const snapshot = await db()
    .collection(`workspaces/${workspaceId}/cash_report_periods`).get();
  const totals: Totals = {};
  for (const doc of snapshot.docs) {
    if (doc.id.startsWith("cash_periods_rebuild")) continue;
    const net = Number(doc.get("netCents") ?? 0);
    const count = Number(doc.get("transactionCount") ?? 0);
    if (net || count) totals[doc.id] = {net, count};
  }
  return totals;
};

// ------------------------------------------------------------- criação

test("P3-F — pendente e agendado: registrados sem mover o caixa realizado " +
  "", async () => {
  const tenant = await seedTenant();
  const scheduled = await createDelivered(tenant.member, tenant.workspaceId);
  // Receita a receber já vencida: continua pendente, sem crédito.
  const overdue = await createDelivered(tenant.member, tenant.workspaceId, {
    type: "receita", description: "Consultoria de setembro",
    category: "Serviços", amountCents: 90_000, dueDate: yesterday,
    expenseType: undefined, paymentMethod: undefined, incomeType: "Serviço",
  });

  const doc = await read(tenant.workspaceId, scheduled);
  assert.equal(doc.isPaid, false);
  assert.equal(doc.dueDate, inTwoWeeks);
  assert.equal(doc.date, inTwoWeeks, "data de referência = vencimento");
  assert.equal(doc.valueCents, 180_000);
  assert.equal(doc.cashEntry.status, "pending");
  assert.equal(doc.cashEntry.origin, "manual");
  assert.equal(doc.cashEntry.quotaPeriod, saoPauloMonthKey());
  assert.equal((await read(tenant.workspaceId, overdue)).isPaid, false);

  // Cada criação consome uma unidade da quota, no mês da criação (D-40).
  assert.equal(await usedOf(tenant.workspaceId), 2);
  // Trilha com o estado inicial.
  const created = (await events(tenant.workspaceId))
    .filter((event) => event.operation === "cash_entry.created");
  assert.deepEqual(created.map((event) => event.entryStatus),
    ["pending", "pending"]);
  // Nenhum débito ou crédito prematuro, nem para o vencido.
  assert.deepEqual(await projected(tenant.workspaceId), {});
  assert.deepEqual(await truth(tenant.workspaceId), {});
});

test("P3-F — confirmação: data efetiva, valor liquidado, vencimento " +
  "preservado", async () => {
  const tenant = await seedTenant();
  const id = await createDelivered(tenant.member, tenant.workspaceId);
  const payload = await confirmPayload(tenant.workspaceId, id, {
    paymentMethod: "Pix",
  });
  const result = await deliver(tenant.workspaceId, id,
    () => confirm(tenant.member, payload)) as MutationResult;
  assert.equal(result.replayed, false);
  assert.equal(result.revision, 2);

  const doc = await read(tenant.workspaceId, id);
  assert.equal(doc.isPaid, true);
  assert.equal(doc.date, yesterday, "data efetiva");
  assert.equal(doc.dueDate, inTwoWeeks, "vencimento preservado");
  assert.equal(doc.valueCents, 181_500);
  assert.equal(doc.value, 1815);
  assert.equal(doc.paymentMethod, "Pix");
  assert.equal(doc.cashEntry.status, "confirmed");
  assert.equal(doc.cashEntry.confirmedBy, tenant.member);
  assert.ok(doc.cashEntry.confirmedAt instanceof Timestamp);
  assert.equal(doc.cashEntry.revision, 2);
  assert.equal(doc.userId, tenant.member, "autoria intacta");

  // Confirmar não consome outra unidade.
  assert.equal(await usedOf(tenant.workspaceId), 1);

  const [event] = await mutationEvents(tenant.workspaceId);
  assert.equal(event.operation, "cash_entry.confirmed");
  assert.equal(event.reason, null);
  assert.deepEqual(event.before, {
    status: "pending", amountCents: 180_000, type: "despesa",
    date: inTwoWeeks, dueDate: inTwoWeeks,
    cashAccountId: defaultAccountOf(tenant.workspaceId),
  });
  assert.deepEqual(event.after, {
    status: "confirmed", amountCents: 181_500, type: "despesa",
    date: yesterday, dueDate: inTwoWeeks,
    cashAccountId: defaultAccountOf(tenant.workspaceId),
  });
  assert.deepEqual(event.changedFields,
    ["status", "amountCents", "date", "paymentMethod"]);

  // O caixa realizado mostra a saída no mês da data efetiva, uma vez.
  const month = saoPauloMonthKey(new Date(`${yesterday}T15:00:00.000Z`));
  assert.deepEqual(await projected(tenant.workspaceId),
    {[month]: {net: -181_500, count: 1}});
  assert.deepEqual(await projected(tenant.workspaceId),
    await truth(tenant.workspaceId));
});

test("P3-F — pendente criado num mês e confirmado no seguinte", async () => {
  const tenant = await seedTenant();
  const currentMonth = saoPauloMonthKey();
  const previousStart = saoPauloMonthStart(currentMonth);
  previousStart.setUTCDate(previousStart.getUTCDate() - 20);
  const previousMonth = saoPauloMonthKey(previousStart);
  // O contador já existia no mês anterior.
  await db().doc(`workspaces/${tenant.workspaceId}/quota_state/transactions`)
    .update({trackingSince: previousMonth});

  const dueDate = saoPauloDayKey(previousStart);
  const created = await executeCreateCashTransaction(
    {uid: tenant.member, workspaceId: tenant.workspaceId, role: "member"},
    {
      workspaceId: tenant.workspaceId,
      cashAccountId: defaultAccountOf(tenant.workspaceId),
      idempotencyKey: idempotencyKey(),
      type: "despesa",
      description: "Conta de luz",
      category: "Moradia",
      amountCents: 21_000,
      status: "pending",
      dueDate,
    } as CreateCashTransactionPayload,
    uniqueId("req"),
    {now: () => previousStart.getTime()},
  );
  const id = created.transactionId;
  assert.equal((await read(tenant.workspaceId, id)).cashEntry.quotaPeriod,
    previousMonth);
  assert.equal(await usedOf(tenant.workspaceId, previousMonth), 1);
  assert.equal(await usedOf(tenant.workspaceId, currentMonth), 0);

  // Confirmado hoje (mês seguinte): nada de quota em mês nenhum; o caixa
  // entra no mês da data efetiva, não no do vencimento.
  await deliver(tenant.workspaceId, id, async () => confirm(tenant.member,
    await confirmPayload(tenant.workspaceId, id, {
      date: today, amountCents: 21_000,
    })));
  assert.equal(await usedOf(tenant.workspaceId, previousMonth), 1);
  assert.equal(await usedOf(tenant.workspaceId, currentMonth), 0);
  const doc = await read(tenant.workspaceId, id);
  assert.equal(doc.dueDate, dueDate);
  assert.equal(doc.date, today);
  assert.deepEqual(await projected(tenant.workspaceId),
    {[currentMonth]: {net: -21_000, count: 1}});
});

// ------------------------------------------------------- idempotência

test("P3-F — confirmar duas vezes nunca liquida duas vezes", async () => {
  const tenant = await seedTenant();
  const id = await createDelivered(tenant.member, tenant.workspaceId);
  const payload = await confirmPayload(tenant.workspaceId, id);
  const first = await deliver(tenant.workspaceId, id,
    () => confirm(tenant.member, payload)) as MutationResult;
  const afterFirst = await read(tenant.workspaceId, id);

  // Reenvio da mesma intenção (resposta perdida): replay, nada novo.
  const replay = await confirm(tenant.member, payload);
  assert.deepEqual(replay, {...first, replayed: true});
  assert.deepEqual(await read(tenant.workspaceId, id), afterFirst);

  // Intenção nova com a versão atual: já confirmado.
  const again = await expectHttpsError(confirm(tenant.member,
    await confirmPayload(tenant.workspaceId, id)), "failed-precondition");
  assert.equal(again.message, ALREADY_CONFIRMED_MESSAGE);
  // Intenção nova com a versão velha: conflito, sem gravar.
  await expectHttpsError(confirm(tenant.member, {
    ...payload, idempotencyKey: idempotencyKey(),
  }), "aborted");

  assert.equal((await mutationEvents(tenant.workspaceId)).length, 1);
  assert.deepEqual(await read(tenant.workspaceId, id), afterFirst);
  assert.deepEqual(await projected(tenant.workspaceId),
    await truth(tenant.workspaceId));
  assert.equal(await usedOf(tenant.workspaceId), 1);
});

test("P3-F — confirmação e anulação concorrentes: só uma vence", async () => {
  const tenant = await seedTenant();
  for (let round = 0; round < 3; round += 1) {
    const id = await createDelivered(tenant.member, tenant.workspaceId);
    const [confirmData, voidData] = await Promise.all([
      confirmPayload(tenant.workspaceId, id),
      voidPayload(tenant.workspaceId, id),
    ]);
    const outcomes = await Promise.allSettled([
      confirm(tenant.member, confirmData),
      annul(tenant.member, voidData),
    ]);
    const won = outcomes.filter((outcome) => outcome.status === "fulfilled");
    assert.equal(won.length, 1, JSON.stringify(outcomes));
    const doc = await read(tenant.workspaceId, id);
    const voided = doc.voidedAt instanceof Timestamp;
    assert.equal(doc.cashEntry.status, voided ? "voided" : "confirmed");
    assert.equal(doc.isPaid, !voided, "anulado do pendente segue não pago");
    const ofEntry = (await mutationEvents(tenant.workspaceId))
      .filter((event) => event.transactionId === id);
    assert.equal(ofEntry.length, 1);
  }
});

test("P3-F — falha antes do commit não deixa nada; reenvio aplica uma vez " +
  "", async () => {
  const tenant = await seedTenant();
  const id = await createDelivered(tenant.member, tenant.workspaceId);
  const before = await read(tenant.workspaceId, id);
  const payload = await confirmPayload(tenant.workspaceId, id);
  await assert.rejects(executeConfirmCashTransaction(
    {uid: tenant.member, workspaceId: tenant.workspaceId, role: "member"},
    payload as Parameters<typeof executeConfirmCashTransaction>[1],
    uniqueId("req"),
    {beforeCommit: () => {
      throw new Error("falha injetada antes do commit");
    }},
  ), /falha injetada/);
  assert.deepEqual(await read(tenant.workspaceId, id), before);
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 0);
  const keyDoc = await db().doc(
    `users/${tenant.member}/idempotency_keys/confirmCashTransaction_` +
      sha256(`${tenant.member}:${payload.idempotencyKey}`).slice(0, 32),
  ).get();
  assert.equal(keyDoc.exists, false);

  // Resultado incerto: o mesmo pedido, reenviado, liquida uma única vez.
  await confirm(tenant.member, payload);
  await confirm(tenant.member, payload);
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 1);
});

// -------------------------------------------------------- transições

test("P3-F — correção do pendente: valor e vencimento, sem mudar o estado " +
  "", async () => {
  const tenant = await seedTenant();
  const id = await createDelivered(tenant.member, tenant.workspaceId);
  const newDue = shiftDays(today, 30);
  await deliver(tenant.workspaceId, id, async () => edit(tenant.member,
    await updatePayload(tenant.workspaceId, id, {
      amountCents: 185_000, dueDate: newDue,
    })));
  const doc = await read(tenant.workspaceId, id);
  assert.equal(doc.isPaid, false);
  assert.equal(doc.valueCents, 185_000);
  assert.equal(doc.dueDate, newDue);
  assert.equal(doc.date, newDue);
  assert.equal(doc.cashEntry.status, "pending");
  const [event] = await mutationEvents(tenant.workspaceId);
  assert.deepEqual(event.changedFields, ["amountCents", "date", "dueDate"]);
  assert.equal(event.before.status, "pending");
  assert.equal(event.after.status, "pending");
  assert.deepEqual(await projected(tenant.workspaceId), {});
  assert.equal(await usedOf(tenant.workspaceId), 1, "correção não consome");

  // A correção não confirma...
  const asConfirmed = await expectHttpsError(edit(tenant.member,
    await updatePayload(tenant.workspaceId, id, {
      status: "confirmed", dueDate: undefined, date: today,
    })), "failed-precondition");
  assert.equal(asConfirmed.message, CONFIRM_THROUGH_CONFIRMATION_MESSAGE);

  // ...e o confirmado não volta a pendente.
  await deliver(tenant.workspaceId, id, async () => confirm(tenant.member,
    await confirmPayload(tenant.workspaceId, id)));
  const back = await expectHttpsError(edit(tenant.member,
    await updatePayload(tenant.workspaceId, id, {})), "failed-precondition");
  assert.equal(back.message, CONFIRMED_STAYS_CONFIRMED_MESSAGE);

  // Correção do confirmado: data efetiva e valor; o vencimento fica.
  await deliver(tenant.workspaceId, id, async () => edit(tenant.member,
    await updatePayload(tenant.workspaceId, id, {
      status: undefined, dueDate: undefined, date: today, amountCents: 182_000,
    })));
  const corrected = await read(tenant.workspaceId, id);
  assert.equal(corrected.date, today);
  assert.equal(corrected.dueDate, newDue);
  assert.equal(corrected.valueCents, 182_000);
  assert.deepEqual(await projected(tenant.workspaceId),
    await truth(tenant.workspaceId));
});

test("P3-F — anulação do pendente; anulado não confirma nem corrige " +
  "", async () => {
  const tenant = await seedTenant();
  const id = await createDelivered(tenant.member, tenant.workspaceId);
  await deliver(tenant.workspaceId, id, async () => annul(tenant.member,
    await voidPayload(tenant.workspaceId, id)));
  const doc = await read(tenant.workspaceId, id);
  assert.ok(doc.voidedAt instanceof Timestamp);
  assert.equal(doc.cashEntry.status, "voided");
  assert.equal(doc.voidReason, "Compromisso cancelado");
  assert.equal(doc.dueDate, inTwoWeeks, "histórico preservado");
  const [event] = await mutationEvents(tenant.workspaceId);
  assert.equal(event.before.status, "pending");
  assert.equal(event.after, null);

  // Cada tentativa só começa quando a anterior já foi tratada: nenhuma
  // rejeição fica sem handler enquanto o payload seguinte é montado.
  for (const attempt of [
    async () => confirm(tenant.member,
      await confirmPayload(tenant.workspaceId, id)),
    async () => edit(tenant.member,
      await updatePayload(tenant.workspaceId, id, {})),
  ]) {
    const error = await expectHttpsError(attempt(), "failed-precondition");
    assert.match(error.message, /anulado/);
  }
  assert.deepEqual(await projected(tenant.workspaceId), {});
  assert.equal(await usedOf(tenant.workspaceId), 1, "anulação não devolve");
});

test("P3-F — forma de pagamento só na confirmação de despesa", async () => {
  const tenant = await seedTenant();
  const income = await createDelivered(tenant.member, tenant.workspaceId, {
    type: "receita", category: "Serviços", expenseType: undefined,
    paymentMethod: undefined,
  });
  const error = await expectHttpsError(confirm(tenant.member,
    await confirmPayload(tenant.workspaceId, income, {paymentMethod: "Pix"})),
  "invalid-argument");
  assert.equal(error.message, RECEIPT_PAYMENT_METHOD_MESSAGE);
  // Sem forma de pagamento, a receita confirma.
  await confirm(tenant.member,
    await confirmPayload(tenant.workspaceId, income));
  assert.equal((await read(tenant.workspaceId, income)).isPaid, true);
});

// --------------------------------------------- autorização e isolamento

test("P3-F — RBAC: member só os seus, viewer não, removido e suspenso não " +
  "", async () => {
  const tenant = await seedTenant();
  const own = await createDelivered(tenant.member, tenant.workspaceId);
  const other = await createDelivered(tenant.otherMember, tenant.workspaceId);

  await expectHttpsError(confirm(tenant.member,
    await confirmPayload(tenant.workspaceId, other)), "permission-denied");
  await expectHttpsError(confirm(tenant.viewer,
    await confirmPayload(tenant.workspaceId, own)), "permission-denied");
  await expectHttpsError(call(createCashTransaction, tenant.viewer, {
    workspaceId: tenant.workspaceId, idempotencyKey: idempotencyKey(),
    cashAccountId: defaultAccountOf(tenant.workspaceId),
    type: "despesa", description: "x", category: "y", amountCents: 1,
    status: "pending", dueDate: inTwoWeeks,
  }), "permission-denied");

  await seedMember(tenant.workspaceId, tenant.member, "member", "removed");
  await expectHttpsError(confirm(tenant.member,
    await confirmPayload(tenant.workspaceId, own)), "permission-denied");
  await seedMember(tenant.workspaceId, tenant.member, "member");
  await db().doc(`users/${tenant.member}`).update({status: "suspended"});
  await expectHttpsError(confirm(tenant.member,
    await confirmPayload(tenant.workspaceId, own)), "permission-denied",
  {reason: "account_suspended"});
  await db().doc(`users/${tenant.member}`).update({status: "active"});

  // Owner e admin atuam sobre lançamentos do workspace.
  await confirm(tenant.admin, await confirmPayload(tenant.workspaceId, own));
  await confirm(tenant.owner, await confirmPayload(tenant.workspaceId, other));
  assert.deepEqual(
    (await mutationEvents(tenant.workspaceId))
      .map((event) => `${event.actorRole}:${event.operation}`).sort(),
    ["admin:cash_entry.confirmed", "owner:cash_entry.confirmed"],
  );

  await db().doc(`workspaces/${tenant.workspaceId}`)
    .update({status: "archived"});
  await expectHttpsError(createEntry(tenant.owner, tenant.workspaceId),
    "failed-precondition", {reason: "workspace_archived"});
});

test("P3-F — nenhum tenant confirma o pendente do outro", async () => {
  const a = await seedTenant();
  const b = await seedTenant();
  // Nos dois sentidos: B contra o pendente de A e A contra o de B.
  for (const [victim, attacker] of [[a, b], [b, a]]) {
    const id = await createDelivered(victim.member, victim.workspaceId);
    const before = await read(victim.workspaceId, id);
    // Pelo próprio workspace: o ID não existe lá.
    await expectHttpsError(confirm(attacker.owner, {
      ...(await confirmPayload(victim.workspaceId, id)),
      workspaceId: attacker.workspaceId,
    }), "not-found");
    // Pelo workspace alheio: não é membro.
    await expectHttpsError(confirm(attacker.owner,
      await confirmPayload(victim.workspaceId, id)), "permission-denied");
    assert.deepEqual(await read(victim.workspaceId, id), before);
  }
  assert.equal((await mutationEvents(a.workspaceId)).length, 0);
  assert.equal((await mutationEvents(b.workspaceId)).length, 0);
});

// ------------------------------------------------------------ quota

test("P3-F — quota: pendente consome na criação; confirmação não", async () => {
  const tenant = await seedTenant();
  const id = await createDelivered(tenant.member, tenant.workspaceId);
  // Free: 50 por mês. Esgotado, nenhum pendente ou agendado novo.
  await quotaRef(tenant.workspaceId).update({used: 50});
  await expectHttpsError(createEntry(tenant.member, tenant.workspaceId),
    "resource-exhausted");
  await expectHttpsError(createEntry(tenant.member, tenant.workspaceId, {
    status: "confirmed", dueDate: undefined, date: today,
  }), "resource-exhausted");
  // O compromisso já registrado ainda confirma: não consome outra unidade.
  await confirm(tenant.member, await confirmPayload(tenant.workspaceId, id));
  assert.equal(await usedOf(tenant.workspaceId), 50);
});

// ------------------------------------------------- sem a marca do Caixa

/**
 * P4-D: o cliente não grava `transactions` e a adoção `legacy_manual` saiu.
 * Um documento sem `cashEntry` — o formato do caminho direto antigo — não é
 * lançamento do Caixa: nenhuma callable o confirma, corrige ou anula.
 */
const seedUnmarked = async (
  workspaceId: string,
  userId: string,
  overrides: Record<string, unknown>,
): Promise<string> => {
  const ref = db().collection(`workspaces/${workspaceId}/transactions`).doc();
  const date = String(overrides.date ?? "2026-08-20");
  await ref.set({
    type: "despesa",
    description: "Conta de água",
    category: "Moradia",
    value: 95.4,
    date,
    transactionDate: Timestamp.fromDate(new Date(`${date}T12:00:00.000Z`)),
    paymentMethod: "Boleto",
    expenseType: "Fixa",
    source: "manual",
    userId,
    workspaceId,
    profileId: workspaceId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    ...overrides,
  });
  return ref.id;
};

test("P4-D — documento sem a marca do Caixa não é confirmado, corrigido " +
  "nem anulado", async () => {
  const tenant = await seedTenant();
  const account = defaultAccountOf(tenant.workspaceId);
  const accountRef = db().doc(
    `workspaces/${tenant.workspaceId}/cash_accounts/${account}`);
  const balanceBefore = (await accountRef.get()).get("balanceCents");
  for (const overrides of [
    {isPaid: false},
    {isPaid: true},
    {type: "receita"},
  ]) {
    const id = await seedUnmarked(tenant.workspaceId, tenant.member, overrides);
    const before = await read(tenant.workspaceId, id);
    for (const attempt of [
      async () => confirm(tenant.member, await confirmPayload(
        tenant.workspaceId, id, {amountCents: 9_540, cashAccountId: account})),
      async () => edit(tenant.member,
        await updatePayload(tenant.workspaceId, id, {amountCents: 1})),
      async () => annul(tenant.member,
        await voidPayload(tenant.workspaceId, id)),
    ]) {
      const error = await expectHttpsError(attempt(), "failed-precondition");
      assert.deepEqual(error.details, {ineligible: "unsupported_origin"},
        JSON.stringify(overrides));
    }
    assert.deepEqual(await read(tenant.workspaceId, id), before);
  }
  assert.equal((await mutationEvents(tenant.workspaceId)).length, 0);
  assert.equal((await accountRef.get()).get("balanceCents"), balanceBefore);
});

// ------------------------------------------------------- reconciliação

test("P3-F — projeção pela regra antiga: simulação mostra, reconstrução " +
  "corrige", async () => {
  const tenant = await seedTenant();
  const confirmed = await createDelivered(tenant.member, tenant.workspaceId, {
    status: "confirmed", dueDate: undefined, date: today, amountCents: 50_000,
  });
  const pending = await createDelivered(tenant.member, tenant.workspaceId, {
    dueDate: today, amountCents: 30_000,
  });
  assert.ok(confirmed && pending);
  const month = saoPauloMonthKey();
  // A regra anterior à P3-F somava a despesa pendente como saída.
  const periods = `workspaces/${tenant.workspaceId}/cash_report_periods`;
  await db().doc(`${periods}/${month}`)
    .update({
      expenseCents: FieldValue.increment(30_000),
      netCents: FieldValue.increment(-30_000),
      transactionCount: FieldValue.increment(1),
    });

  const rebuild = (dryRun: boolean, label: string) =>
    executeRebuildCashPeriods(tenant.workspaceId, tenant.owner, {
      workspaceId: tenant.workspaceId,
      idempotencyKey: `d29-rebuild-${label}-${uniqueId("k")}`,
      correlationId: "corr-d29-rebuild",
      pageSize: 50,
      reason: "Reconciliação D-29",
      dryRun,
    });
  const simulated = await rebuild(true, "dry");
  assert.equal(simulated.completed, true);
  const divergence = simulated.divergence as {
    divergentPeriods: number; netDifferenceCents: number;
    sample: Array<{period: string}>;
  };
  assert.equal(divergence.divergentPeriods, 1);
  assert.equal(divergence.netDifferenceCents, -30_000);
  assert.equal(divergence.sample[0].period, month);

  const published = await rebuild(false, "real");
  assert.equal(published.completed, true);
  assert.deepEqual(await projected(tenant.workspaceId),
    {[month]: {net: -50_000, count: 1}});
  const after = await rebuild(true, "dry-after");
  assert.equal((after.divergence as {divergentPeriods: number})
    .divergentPeriods, 0);
});
