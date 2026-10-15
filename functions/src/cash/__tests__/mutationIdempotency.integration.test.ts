import assert from "node:assert/strict";
import test from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {CASH_EVENTS_COLLECTION} from "../../shared/audit";
import {formatIsoInstant} from "../../shared/commitTime";
import {sha256} from "../../shared/hashing";
import {
  defaultAccountOf,
  seedActiveAccount,
  seedMember,
  seedPaidPlan,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {
  DEFAULT_INCOME_CATEGORY_ID,
  seedDefaultCategories,
} from "../../settingsCatalog/testSupport/categorySeeds";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  createCashTransaction,
  updateCashTransaction,
  voidCashTransaction,
} from "../callables";

/**
 * Idempotência da correção e da anulação (P3-C) ao longo da retenção da
 * chave (P3-D).
 *
 * Contrato: a chave de idempotência é do **ator** e identifica **uma**
 * intenção de **uma** operação (`updateCashTransaction` ou
 * `voidCashTransaction`). Enquanto o recibo do ator existe (90 dias), ele
 * decide: mesmo conteúdo → replay; qualquer outro conteúdo (outro
 * lançamento, outro workspace, outro motivo) → conflito. Depois da
 * expiração, a âncora é a trilha append-only `cash_events`: o evento da
 * intenção existe em algum workspace e só o mesmo conteúdo é replay.
 *
 * Correção sem mudança não grava evento (não há efeito a proteger). Depois da
 * expiração ela é reavaliada: se o lançamento continua igual, devolve de novo
 * `changed: false` sem gravar; se mudou desde a versão lida, é conflito de
 * versão. Em nenhum caso há efeito duplicado.
 */
db();

const UPDATE = "updateCashTransaction";
const VOID = "voidCashTransaction";

const tenant = async () => {
  const workspaceId = uniqueId("idem-ws");
  const owner = uniqueId("idem-owner");
  const admin = uniqueId("idem-admin");
  await seedActiveAccount(owner);
  await seedActiveAccount(admin);
  await seedPaidPlan(owner, "pro");
  await seedWorkspace({workspaceId, ownerId: owner});
  await seedMember(workspaceId, admin, "admin");
  await seedDefaultCategories(workspaceId);
  return {workspaceId, owner, admin};
};

const read = async (workspaceId: string, id: string) =>
  (await db().doc(`workspaces/${workspaceId}/transactions/${id}`).get())
    .data() ?? {};

const versionOf = async (workspaceId: string, id: string) => {
  const updatedAt = (await read(workspaceId, id)).updatedAt;
  return updatedAt instanceof Timestamp ? formatIsoInstant(updatedAt) : null;
};

const create = async (uid: string, workspaceId: string, amount = 10_000) =>
  (await call<{transactionId: string}>(createCashTransaction, uid, {
    workspaceId,
    cashAccountId: defaultAccountOf(workspaceId),
    idempotencyKey: idempotencyKey(),
    type: "receita",
    description: "Receita",
    categoryId: DEFAULT_INCOME_CATEGORY_ID,
    amountCents: amount,
    date: "2026-09-10",
  })).transactionId;

const editPayload = async (
  workspaceId: string,
  transactionId: string,
  key: string,
  amountCents: number,
  reason = "Correção do valor",
) => ({
  workspaceId,
  idempotencyKey: key,
  transactionId,
  expectedUpdatedAt: await versionOf(workspaceId, transactionId),
  reason,
  entry: {
    cashAccountId: defaultAccountOf(workspaceId),
    type: "receita",
    description: "Receita",
    categoryId: DEFAULT_INCOME_CATEGORY_ID,
    amountCents,
    date: "2026-09-10",
  },
});

const voidPayload = async (
  workspaceId: string,
  transactionId: string,
  key: string,
) => ({
  workspaceId,
  idempotencyKey: key,
  transactionId,
  expectedUpdatedAt: await versionOf(workspaceId, transactionId),
  reason: "Lançado em duplicidade",
});

interface Outcome {
  transactionId: string;
  replayed: boolean;
  changed?: boolean;
  revision: number;
}

const edit = (uid: string, data: Record<string, unknown>) =>
  call<Outcome>(updateCashTransaction, uid, data);
const annul = (uid: string, data: Record<string, unknown>) =>
  call<Outcome>(voidCashTransaction, uid, data);

/** Simula a expiração (TTL) do recibo do ator. */
const expire = (uid: string, operation: string, key: string) =>
  db().doc(
    `users/${uid}/idempotency_keys/${operation}_` +
      sha256(`${uid}:${key}`).slice(0, 32),
  ).delete();

const mutationEvents = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/${CASH_EVENTS_COLLECTION}`)
    .get()).docs.map((doc) => doc.data())
    .filter((event) => event.operation !== "cash_entry.created");

const KEY_CONFLICT =
  "Esta chave de idempotência já foi usada com outros dados.";

test("P3-D — mesma chave e conteúdo após a expiração: replay", async () => {
  const {workspaceId, owner} = await tenant();
  const id = await create(owner, workspaceId);
  const key = idempotencyKey();
  const payload = await editPayload(workspaceId, id, key, 12_000);
  const first = await edit(owner, payload);
  const state = await read(workspaceId, id);
  await expire(owner, UPDATE, key);
  assert.deepEqual(await edit(owner, payload), {...first, replayed: true});
  // A anulação tem o mesmo contrato.
  const voidKey = idempotencyKey();
  const voidData = await voidPayload(workspaceId, id, voidKey);
  const voided = await annul(owner, voidData);
  await expire(owner, VOID, voidKey);
  assert.deepEqual(await annul(owner, voidData), {...voided, replayed: true});
  const final = await read(workspaceId, id);
  assert.equal(final.valueCents, 12_000);
  assert.equal(final.cashEntry.revision, 3);
  assert.ok(state.updatedAt instanceof Timestamp);
  assert.equal((await mutationEvents(workspaceId)).length, 2);
});

test("P3-D — mesma chave, outro conteúdo no lançamento: conflito", async () => {
  const {workspaceId, owner} = await tenant();
  const id = await create(owner, workspaceId);
  const key = idempotencyKey();
  const payload = await editPayload(workspaceId, id, key, 12_000);
  await edit(owner, payload);
  for (const expired of [false, true]) {
    if (expired) await expire(owner, UPDATE, key);
    await expectHttpsError(
      edit(owner, {...payload, entry: {...payload.entry, amountCents: 1}}),
      "failed-precondition",
      {message: KEY_CONFLICT},
    );
  }
  assert.equal((await read(workspaceId, id)).valueCents, 12_000);
  assert.equal((await mutationEvents(workspaceId)).length, 1);
});

test("P3-D — mesma chave em outro lançamento: conflito sempre", async () => {
  const {workspaceId, owner} = await tenant();
  const first = await create(owner, workspaceId);
  const second = await create(owner, workspaceId, 20_000);
  const key = idempotencyKey();
  await edit(owner, await editPayload(workspaceId, first, key, 12_000));
  const reuse = await editPayload(workspaceId, second, key, 12_000);
  await expectHttpsError(edit(owner, reuse), "failed-precondition",
    {message: KEY_CONFLICT});
  await expire(owner, UPDATE, key);
  await expectHttpsError(edit(owner, reuse), "failed-precondition",
    {message: KEY_CONFLICT});
  assert.equal((await read(workspaceId, second)).valueCents, 20_000);

  // Anulação: a mesma chave não anula um segundo lançamento.
  const voidKey = idempotencyKey();
  await annul(owner, await voidPayload(workspaceId, first, voidKey));
  await expire(owner, VOID, voidKey);
  await expectHttpsError(
    annul(owner, await voidPayload(workspaceId, second, voidKey)),
    "failed-precondition",
    {message: KEY_CONFLICT},
  );
  assert.equal((await read(workspaceId, second)).voidedAt, undefined);
  assert.equal((await mutationEvents(workspaceId)).length, 2);
});

test("P3-D — mesma chave em outro workspace: conflito sempre", async () => {
  const a = await tenant();
  const b = await tenant();
  // O owner de A também é admin de B.
  await seedMember(b.workspaceId, a.owner, "admin");
  const inA = await create(a.owner, a.workspaceId);
  const inB = await create(b.owner, b.workspaceId, 30_000);
  const key = idempotencyKey();
  await edit(a.owner, await editPayload(a.workspaceId, inA, key, 12_000));
  const reuse = await editPayload(b.workspaceId, inB, key, 12_000);
  await expectHttpsError(edit(a.owner, reuse), "failed-precondition",
    {message: KEY_CONFLICT});
  await expire(a.owner, UPDATE, key);
  await expectHttpsError(edit(a.owner, reuse), "failed-precondition",
    {message: KEY_CONFLICT});
  assert.equal((await read(b.workspaceId, inB)).valueCents, 30_000);
  assert.equal((await mutationEvents(b.workspaceId)).length, 0);
  assert.equal((await mutationEvents(a.workspaceId)).length, 1);
});

test("P3-D — correção sem mudança após a expiração: sem efeito", async () => {
  const {workspaceId, owner, admin} = await tenant();
  const id = await create(owner, workspaceId);
  const key = idempotencyKey();
  const noop = await editPayload(workspaceId, id, key, 10_000);
  const first = await edit(owner, noop);
  assert.deepEqual(first, {
    transactionId: id, replayed: false, changed: false, revision: 1,
  });
  const before = await read(workspaceId, id);
  // Com o recibo: replay.
  assert.deepEqual(await edit(owner, noop), {...first, replayed: true});
  // Sem o recibo e com o lançamento igual: a mesma resposta, sem escrita.
  await expire(owner, UPDATE, key);
  assert.deepEqual(await edit(owner, noop), first);
  assert.ok((await read(workspaceId, id)).updatedAt.isEqual(before.updatedAt));
  // Sem o recibo e com o lançamento alterado por outra pessoa: conflito de
  // versão, nunca sobrescrita.
  await expire(owner, UPDATE, key);
  await edit(admin,
    await editPayload(workspaceId, id, idempotencyKey(), 15_000));
  await expectHttpsError(edit(owner, noop), "aborted");
  assert.equal((await read(workspaceId, id)).valueCents, 15_000);
  assert.equal((await mutationEvents(workspaceId)).length, 1);
});

test("P3-D — concorrência na mesma chave: um efeito, um evento", async () => {
  const {workspaceId, owner} = await tenant();
  const first = await create(owner, workspaceId);
  const second = await create(owner, workspaceId, 20_000);

  // Mesmo conteúdo em paralelo: uma aplica, a outra é replay ou conflito de
  // processamento — nunca duas aplicações.
  const key = idempotencyKey();
  const payload = await editPayload(workspaceId, first, key, 11_000);
  const same = await Promise.allSettled([
    edit(owner, payload), edit(owner, payload), edit(owner, payload),
  ]);
  const applied = same.filter((outcome) =>
    outcome.status === "fulfilled" && outcome.value.replayed === false);
  assert.equal(applied.length, 1);
  assert.equal((await mutationEvents(workspaceId)).length, 1);

  // A mesma chave para lançamentos diferentes em paralelo: só um aplica.
  const other = idempotencyKey();
  const race = await Promise.allSettled([
    edit(owner, await editPayload(workspaceId, first, other, 13_000)),
    edit(owner, await editPayload(workspaceId, second, other, 13_000)),
  ]);
  assert.equal(
    race.filter((outcome) => outcome.status === "fulfilled").length,
    1,
  );
  assert.equal((await mutationEvents(workspaceId)).length, 2);

  // Depois da expiração: o replay legítimo e as reutilizações indevidas em
  // paralelo. Só a trilha responde; nada é gravado.
  await expire(owner, UPDATE, key);
  const settled = await Promise.allSettled([
    edit(owner, payload),
    edit(owner, {...payload, transactionId: second}),
    edit(owner, {...payload, reason: "Outro motivo"}),
  ]);
  assert.equal(settled[0].status, "fulfilled");
  assert.equal((settled[0] as PromiseFulfilledResult<Outcome>).value.replayed,
    true);
  for (const outcome of settled.slice(1)) {
    assert.equal(outcome.status, "rejected");
  }
  assert.equal((await mutationEvents(workspaceId)).length, 2);
  const values = [
    (await read(workspaceId, first)).valueCents,
    (await read(workspaceId, second)).valueCents,
  ];
  assert.ok(values.includes(13_000));
});

test("P3-D — âncoras de criação e histórico preservados", async () => {
  const {workspaceId, owner} = await tenant();
  const id = await create(owner, workspaceId);
  const created = await read(workspaceId, id);
  const key = idempotencyKey();
  await edit(owner, await editPayload(workspaceId, id, key, 12_000));
  await expire(owner, UPDATE, key);
  await edit(owner,
    await editPayload(workspaceId, id, idempotencyKey(), 13_000));
  const entry = await read(workspaceId, id);
  assert.equal(entry.cashEntry.requestHash, created.cashEntry.requestHash);
  assert.equal(entry.cashEntry.quotaPeriod, created.cashEntry.quotaPeriod);
  assert.ok(entry.createdAt.isEqual(created.createdAt));
  const all = (await db()
    .collection(`workspaces/${workspaceId}/${CASH_EVENTS_COLLECTION}`).get())
    .docs.map((doc) => doc.data().operation).sort();
  assert.deepEqual(all, [
    "cash_entry.created", "cash_entry.updated", "cash_entry.updated",
  ]);
});
