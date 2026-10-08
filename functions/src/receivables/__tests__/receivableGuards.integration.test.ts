import assert from "node:assert/strict";
import test, {mock} from "node:test";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

// Módulo cru (sem a namespace de getters do `import * as`), para o mock
// substituir `write` onde o logger do kernel o procura.
import functionsLogger = require("firebase-functions/logger");

import {formatIsoInstant} from "../../shared/commitTime";
import {rateLimitDocumentId} from "../../shared/rateLimit";
import {
  defaultAccountOf,
  seedActiveAccount,
  seedMember,
} from "../../shared/testSupport/kernelTestSupport";
import type {WorkspaceActor} from "../../shared/workspaceAuth";
import {
  db,
  expectHttpsError,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {today} from "../../loans/testSupport/loanTestSupport";
import {
  CLIENT_NOT_FOUND_MESSAGE,
  INCONSISTENT_CLIENT_MESSAGE,
  executeCreateClient,
  executeUpdateClient,
} from "../clientOperations";
import {
  CLIENT_MUTATION_RATE_LIMIT,
  IDEMPOTENCY_CONFLICT_MESSAGE,
  RECEIVABLE_MUTATION_RATE_LIMIT,
} from "../common";
import {
  createClientPayloadSchema,
  updateClientPayloadSchema,
  type CancelReceivablePayload,
  type CreateReceivablePayload,
  type ReceiveReceivablePayload,
  type ReverseReceivableReceiptPayload,
} from "../contracts";
import {
  INCONSISTENT_RECEIVABLE_MESSAGE,
  MEMBER_RECEIVABLE_OWNERSHIP_MESSAGE,
  RECEIPT_ABOVE_BALANCE_MESSAGE,
  RECEIVABLE_CLIENT_NOT_FOUND_MESSAGE,
  RECEIVABLE_MOVEMENT_NOT_FOUND_MESSAGE,
  RECEIVABLE_NOT_FOUND_MESSAGE,
  executeCancelReceivable,
  executeCreateReceivable,
  executeReceiveReceivable,
  executeReverseReceivableReceipt,
} from "../operations";
import {
  PII,
  PII_VALUES,
  archive,
  archivePayload,
  cancel,
  cancelPayload,
  clientPayload,
  clientPrivateRef,
  clientRef,
  clientUpdatePayload,
  countOf,
  editClient,
  editReceivable,
  listOf,
  newClient,
  newReceivable,
  read,
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
} from "../testSupport/receivableTestSupport";

/**
 * P3-I — autorização, isolamento, idempotência, concorrência, falha antes e
 * depois do commit, limite operacional, falha fechada
 * fora do schema e ausência de dados pessoais em respostas e logs.
 */
db();

const piiIn = (value: unknown): string | undefined => {
  const text = JSON.stringify(value);
  return PII_VALUES.find((pii) => text.includes(pii));
};

const expireKeys = async (uid: string) => {
  const keys = await db().collection(`users/${uid}/idempotency_keys`).get();
  await Promise.all(keys.docs.map((doc) => doc.ref.delete()));
};

const actorOf = (tenant: Tenant, role: "owner" | "admin" | "member" =
"owner"): WorkspaceActor => ({
  uid: tenant[role],
  workspaceId: tenant.workspaceId,
  role,
});

const injected = {
  beforeCommit: () => {
    throw new Error("falha injetada");
  },
};

type Settled<T> = PromiseSettledResult<T>;
const fulfilledOf = <T>(outcomes: Settled<T>[]): T[] => outcomes
  .filter((o): o is PromiseFulfilledResult<T> => o.status === "fulfilled")
  .map((o) => o.value);
const rejectionCodes = <T>(outcomes: Settled<T>[]): string[] => outcomes
  .filter((o): o is PromiseRejectedResult => o.status === "rejected")
  .map((o) => String((o.reason as {code?: string}).code));

/** Invariante D-39 relida do documento persistido. */
const assertReceivableInvariant = (data: Record<string, unknown>) => {
  const amount = data.amountCents as number;
  const principal = data.principalReceivedCents as number;
  const discount = data.discountGrantedCents as number;
  const balance = data.balanceCents as number;
  assert.equal(balance, amount - principal - discount, "saldo");
  assert.ok(balance >= 0, "saldo não negativo");
  if (data.status === "cancelled") {
    assert.equal(data.activeReceiptCount, 0, "cancelado sem recebimento");
  } else {
    assert.equal(data.status === "received", balance === 0, "quitado");
  }
};

// ---------------------------------------------------------------------- RBAC

test("P3-I — RBAC do cadastro: só owner e admin criam, editam e arquivam; " +
  "member e viewer recusados sem escrita", async () => {
  const tenant = await seedReceivableTenant("rcv-rbac-c");
  const ws = tenant.workspaceId;
  for (const uid of [tenant.member, tenant.viewer]) {
    await expectHttpsError(newClient(uid, clientPayload(ws)),
      "permission-denied");
  }
  const created = await newClient(tenant.admin, clientPayload(ws));
  const before = await read(clientRef(ws, created.clientId));
  for (const uid of [tenant.member, tenant.otherMember, tenant.viewer]) {
    await expectHttpsError(editClient(uid, await clientUpdatePayload(ws,
      created.clientId, {name: "Alterado por quem não pode"})),
    "permission-denied");
    await expectHttpsError(archive(uid,
      await archivePayload(ws, created.clientId)), "permission-denied");
  }
  assert.deepEqual(await read(clientRef(ws, created.clientId)), before);

  const edited = await editClient(tenant.owner, await clientUpdatePayload(ws,
    created.clientId, {phone: "(11) 3333-4444"}));
  assert.equal(edited.changed, true);
  const archived = await archive(tenant.admin,
    await archivePayload(ws, created.clientId));
  assert.equal(archived.status, "archived");
  const roles = (await listOf(ws, "client_events"))
    .map((event) => event.actorRole).sort();
  assert.deepEqual(roles, ["admin", "admin", "owner"]);
  assert.equal(await countOf(ws, "clients"), 1);
});

test("P3-I — RBAC dos recebíveis: viewer só lê; member administra só o que " +
  "criou; owner e admin administram todos", async () => {
  const tenant = await seedReceivableTenant("rcv-rbac-r");
  const ws = tenant.workspaceId;
  const clientId = await seedClient(tenant);
  await expectHttpsError(newReceivable(tenant.viewer,
    receivablePayload(ws, clientId)), "permission-denied");
  const own = await newReceivable(tenant.member,
    receivablePayload(ws, clientId));
  const stored = await read(receivableRef(ws, own.receivableId));
  // `createdBy` vem da autenticação, nunca do payload.
  assert.equal(stored.createdBy, tenant.member);

  const memberPaid = await receive(tenant.member,
    await receivePayload(ws, own.receivableId));
  assert.equal(memberPaid.balanceCents, 60_000);
  const snapshot = await read(receivableRef(ws, own.receivableId));

  // Outro member: nenhuma operação sobre o recebível alheio.
  for (const attempt of [
    async () => editReceivable(tenant.otherMember, await
    receivableUpdatePayload(ws, own.receivableId, {description: "Invasão"})),
    async () => receive(tenant.otherMember,
      await receivePayload(ws, own.receivableId)),
    async () => reverse(tenant.otherMember, await reversePayload(ws,
      own.receivableId, memberPaid.movementId as string)),
    async () => cancel(tenant.otherMember,
      await cancelPayload(ws, own.receivableId)),
  ]) {
    await expectHttpsError(attempt(), "permission-denied",
      {message: MEMBER_RECEIVABLE_OWNERSHIP_MESSAGE});
  }
  // Viewer: recusado já pelo papel.
  await expectHttpsError(receive(tenant.viewer,
    await receivePayload(ws, own.receivableId)), "permission-denied");
  await expectHttpsError(cancel(tenant.viewer,
    await cancelPayload(ws, own.receivableId)), "permission-denied");
  assert.deepEqual(await read(receivableRef(ws, own.receivableId)), snapshot);

  // Admin e owner administram o recebível do member.
  const adminPaid = await receive(tenant.admin,
    await receivePayload(ws, own.receivableId, {principalCents: 10_000}));
  assert.equal(adminPaid.balanceCents, 50_000);
  const ownerReversed = await reverse(tenant.owner, await reversePayload(ws,
    own.receivableId, adminPaid.movementId as string));
  assert.equal(ownerReversed.balanceCents, 60_000);
  const roles = (await listOf(ws, "receivable_events"))
    .map((event) => event.actorRole).sort();
  assert.deepEqual(roles, ["admin", "member", "member", "owner"]);
  assert.equal(await countOf(ws, "receivable_movements"), 3);
});

test("P3-I — movimento de outro recebível no mesmo workspace: recusado, " +
  "inclusive para o member dono do recebível informado", async () => {
  const tenant = await seedReceivableTenant("rcv-idor");
  const ws = tenant.workspaceId;
  const clientId = await seedClient(tenant);
  const mine = await newReceivable(tenant.member,
    receivablePayload(ws, clientId));
  const theirs = await newReceivable(tenant.otherMember,
    receivablePayload(ws, clientId));
  const theirReceipt = await receive(tenant.otherMember,
    await receivePayload(ws, theirs.receivableId));
  await receive(tenant.member, await receivePayload(ws, mine.receivableId));
  const before = await read(receivableRef(ws, theirs.receivableId));
  for (const uid of [tenant.member, tenant.owner]) {
    await expectHttpsError(reverse(uid, await reversePayload(ws,
      mine.receivableId, theirReceipt.movementId as string)),
    "not-found", {message: RECEIVABLE_MOVEMENT_NOT_FOUND_MESSAGE});
  }
  assert.deepEqual(await read(receivableRef(ws, theirs.receivableId)), before);
  assert.equal((await read(receivableRef(ws, mine.receivableId))).balanceCents,
    60_000);
  assert.equal(await countOf(ws, "receivable_movements"), 2);
  assert.equal(await countOf(ws, "transactions"), 2);
});

// -------------------------------------------------------------- isolamento

test("P3-I — nenhum tenant opera cliente ou recebível do outro, nos dois " +
  "sentidos", async () => {
  const a = await seedReceivableTenant("rcv-xa");
  const b = await seedReceivableTenant("rcv-xb");
  const seed = async (tenant: Tenant) => {
    const clientId = await seedClient(tenant);
    const {receivableId} = await newReceivable(tenant.owner,
      receivablePayload(tenant.workspaceId, clientId));
    const {movementId} = await receive(tenant.owner,
      await receivePayload(tenant.workspaceId, receivableId));
    return {clientId, receivableId, movementId: movementId as string};
  };
  const seeded = new Map([[a.workspaceId, await seed(a)],
    [b.workspaceId, await seed(b)]]);

  for (const [attacker, victim] of [[a, b], [b, a]] as const) {
    const target = seeded.get(victim.workspaceId);
    assert.ok(target);
    const vws = victim.workspaceId;
    const own = {workspaceId: attacker.workspaceId};
    const snapshots = async () => Promise.all([
      read(clientRef(vws, target.clientId)),
      read(clientPrivateRef(vws, target.clientId)),
      read(receivableRef(vws, target.receivableId)),
    ]);
    const before = await snapshots();

    // Pelo workspace da vítima: não é membro.
    await expectHttpsError(editClient(attacker.owner, await
    clientUpdatePayload(vws, target.clientId, {name: "Invasão"})),
    "permission-denied");
    await expectHttpsError(receive(attacker.owner,
      await receivePayload(vws, target.receivableId)), "permission-denied");
    await expectHttpsError(newReceivable(attacker.owner,
      receivablePayload(vws, target.clientId)), "permission-denied");

    // Pelo próprio workspace com o ID alheio: não existe ali.
    await expectHttpsError(editClient(attacker.owner, {...(await
    clientUpdatePayload(vws, target.clientId, {name: "Invasão"})), ...own}),
    "not-found", {message: CLIENT_NOT_FOUND_MESSAGE});
    await expectHttpsError(archive(attacker.owner, {...(await
    archivePayload(vws, target.clientId)), ...own}),
    "not-found", {message: CLIENT_NOT_FOUND_MESSAGE});
    await expectHttpsError(newReceivable(attacker.owner,
      receivablePayload(attacker.workspaceId, target.clientId)),
    "not-found", {message: RECEIVABLE_CLIENT_NOT_FOUND_MESSAGE});
    for (const attempt of [
      async () => receive(attacker.owner, {...(await
      receivePayload(vws, target.receivableId)), ...own}),
      async () => editReceivable(attacker.owner, {...(await
      receivableUpdatePayload(vws, target.receivableId,
        {description: "Invasão"})), ...own}),
      async () => reverse(attacker.owner, {...(await reversePayload(vws,
        target.receivableId, target.movementId)), ...own}),
      async () => cancel(attacker.owner, {...(await
      cancelPayload(vws, target.receivableId)), ...own}),
    ]) {
      await expectHttpsError(attempt(), "not-found",
        {message: RECEIVABLE_NOT_FOUND_MESSAGE});
    }
    assert.deepEqual(await snapshots(), before);
  }
  for (const tenant of [a, b]) {
    assert.equal(await countOf(tenant.workspaceId, "client_events"), 1);
    assert.equal(await countOf(tenant.workspaceId, "receivable_events"), 2);
    assert.equal(await countOf(tenant.workspaceId, "transactions"), 1);
  }
});

test("P3-I — conta suspensa, membership removido e workspace arquivado são " +
  "recusados", async () => {
  const tenant = await seedReceivableTenant("rcv-lock");
  const ws = tenant.workspaceId;
  const clientId = await seedClient(tenant);
  const {receivableId} = await newReceivable(tenant.member,
    receivablePayload(ws, clientId));
  const payment = await receivePayload(ws, receivableId);

  await seedActiveAccount(tenant.member, {status: "suspended"});
  await expectHttpsError(receive(tenant.member, payment), "permission-denied");
  await expectHttpsError(newReceivable(tenant.member,
    receivablePayload(ws, clientId)), "permission-denied");
  await seedActiveAccount(tenant.member);
  await seedActiveAccount(tenant.admin, {status: "suspended"});
  await expectHttpsError(newClient(tenant.admin, clientPayload(ws)),
    "permission-denied");
  await seedActiveAccount(tenant.admin);

  await seedMember(ws, tenant.member, "member", "removed");
  await expectHttpsError(receive(tenant.member, payment), "permission-denied");
  await seedMember(ws, tenant.member, "member");
  await seedMember(ws, tenant.admin, "admin", "removed");
  await expectHttpsError(editClient(tenant.admin, await clientUpdatePayload(ws,
    clientId, {name: "Sem acesso"})), "permission-denied");
  await seedMember(ws, tenant.admin, "admin");

  await db().doc(`workspaces/${ws}`).update({status: "archived"});
  await expectHttpsError(newClient(tenant.owner, clientPayload(ws)),
    "failed-precondition");
  await expectHttpsError(receive(tenant.owner,
    await receivePayload(ws, receivableId)), "failed-precondition");
  await expectHttpsError(cancel(tenant.owner,
    await cancelPayload(ws, receivableId)), "failed-precondition");
  await db().doc(`workspaces/${ws}`).update({status: "active"});

  const fresh = await read(receivableRef(ws, receivableId));
  assert.equal(fresh.balanceCents, 100_000);
  assert.equal(fresh.status, "open");
  assert.equal(await countOf(ws, "receivable_movements"), 0);
  assert.equal(await countOf(ws, "clients"), 1);
});

// ------------------------------------------------------------ idempotência

test("P3-I — idempotência: replay, conflito da mesma chave e âncora durável " +
  "depois da expiração, em todas as mutações", async () => {
  const tenant = await seedReceivableTenant("rcv-idem");
  const ws = tenant.workspaceId;
  const uid = tenant.owner;

  // Cliente: a âncora é o evento de criação (privado), não o cadastro.
  const intent = clientPayload(ws);
  const created = await newClient(uid, intent);
  await expireKeys(uid);
  assert.deepEqual(await newClient(uid, intent),
    {clientId: created.clientId, replayed: true});
  await expectHttpsError(newClient(uid, {...intent, name: "Outro"}),
    "failed-precondition", {message: IDEMPOTENCY_CONFLICT_MESSAGE});
  assert.equal(await countOf(ws, "clients"), 1);

  const edit = await clientUpdatePayload(ws, created.clientId,
    {notes: "Nova observação"});
  assert.equal((await editClient(uid, edit)).replayed, false);
  await expireKeys(uid);
  assert.deepEqual(await editClient(uid, edit),
    {clientId: created.clientId, changed: true, replayed: true});

  // Recebível: criação ancorada no próprio documento.
  const creation = receivablePayload(ws, created.clientId);
  const first = await newReceivable(uid, creation);
  assert.equal((await newReceivable(uid, creation)).replayed, true);
  await expireKeys(uid);
  assert.deepEqual(await newReceivable(uid, creation),
    {receivableId: first.receivableId, replayed: true});
  await expectHttpsError(newReceivable(uid, {...creation, amountCents: 1}),
    "failed-precondition", {message: IDEMPOTENCY_CONFLICT_MESSAGE});
  const other = await newReceivable(uid,
    receivablePayload(ws, created.clientId));

  // Recebimento: replay, conflito, expiração e mesma chave em outro.
  const payment = await receivePayload(ws, first.receivableId);
  const paid = await receive(uid, payment);
  const again = await receive(uid, payment);
  assert.deepEqual([again.replayed, again.movementId],
    [true, paid.movementId]);
  await expectHttpsError(receive(uid, {...payment, principalCents: 1}),
    "failed-precondition", {message: IDEMPOTENCY_CONFLICT_MESSAGE});
  await expireKeys(uid);
  const afterExpiry = await receive(uid, payment);
  assert.deepEqual([afterExpiry.replayed, afterExpiry.movementId],
    [true, paid.movementId]);
  await expectHttpsError(receive(uid, {
    ...(await receivePayload(ws, other.receivableId)),
    idempotencyKey: payment.idempotencyKey,
  }), "failed-precondition", {message: IDEMPOTENCY_CONFLICT_MESSAGE});

  // Estorno e cancelamento: o mesmo depois da expiração.
  const reversal = await reversePayload(ws, first.receivableId,
    paid.movementId as string);
  const reversed = await reverse(uid, reversal);
  await expireKeys(uid);
  const reversedAgain = await reverse(uid, reversal);
  assert.deepEqual([reversedAgain.replayed, reversedAgain.movementId],
    [true, reversed.movementId]);
  const cancellation = await cancelPayload(ws, other.receivableId);
  await cancel(uid, cancellation);
  await expireKeys(uid);
  assert.equal((await cancel(uid, cancellation)).replayed, true);

  // Arquivamento: o mesmo depois da expiração.
  const spare = await seedClient(tenant, {name: "Cliente Avulso"});
  const archival = await archivePayload(ws, spare);
  await archive(uid, archival);
  await expireKeys(uid);
  assert.deepEqual(await archive(uid, archival),
    {clientId: spare, status: "archived", replayed: true});

  // Um único efeito de cada.
  assert.equal(await countOf(ws, "receivables"), 2);
  assert.equal(await countOf(ws, "receivable_movements"), 2);
  assert.equal(await countOf(ws, "transactions"), 2);
  const firstState = await read(receivableRef(ws, first.receivableId));
  assert.equal(firstState.balanceCents, 100_000);
  assertReceivableInvariant(firstState);
  assert.equal((await read(receivableRef(ws, other.receivableId))).status,
    "cancelled");
});

test("P3-I — mesma intenção concorrente: um único cliente, um único " +
  "recebível e um único recebimento", async () => {
  const tenant = await seedReceivableTenant("rcv-idem-race");
  const ws = tenant.workspaceId;
  const clientIntent = clientPayload(ws);
  const clients = await Promise.allSettled(Array.from({length: 4}, () =>
    newClient(tenant.owner, clientIntent)));
  const clientWins = fulfilledOf(clients);
  assert.ok(clientWins.length >= 1);
  assert.equal(new Set(clientWins.map((r) => r.clientId)).size, 1);
  assert.equal(clientWins.filter((r) => !r.replayed).length, 1);
  assert.equal(await countOf(ws, "clients"), 1);
  assert.equal(await countOf(ws, "client_events"), 1);

  const clientId = clientWins[0].clientId;
  const receivableIntent = receivablePayload(ws, clientId);
  const receivables = await Promise.allSettled(Array.from({length: 4}, () =>
    newReceivable(tenant.member, receivableIntent)));
  const receivableWins = fulfilledOf(receivables);
  assert.equal(receivableWins.filter((r) => !r.replayed).length, 1);
  assert.equal(await countOf(ws, "receivables"), 1);

  const receivableId = receivableWins[0].receivableId;
  const payment = await receivePayload(ws, receivableId);
  const receipts = await Promise.allSettled(Array.from({length: 4}, () =>
    receive(tenant.member, payment)));
  const receiptWins = fulfilledOf(receipts);
  assert.equal(receiptWins.filter((r) => !r.replayed).length, 1);
  assert.equal(new Set(receiptWins.map((r) => r.movementId)).size, 1);
  assert.equal(await countOf(ws, "receivable_movements"), 1);
  assert.equal(await countOf(ws, "transactions"), 1);
  assert.equal((await read(receivableRef(ws, receivableId))).balanceCents,
    60_000);
});

// ------------------------------------------------------------- concorrência

test("P3-I — concorrência: recebimentos simultâneos não passam do saldo; " +
  "recebimento × cancelamento e recebimento × valor sem atualização " +
  "perdida", async () => {
  const tenant = await seedReceivableTenant("rcv-race");
  const ws = tenant.workspaceId;
  const clientId = await seedClient(tenant);

  // Quatro recebimentos de R$ 400 sobre saldo de R$ 1.000, mesma versão.
  const {receivableId} = await newReceivable(tenant.owner,
    receivablePayload(ws, clientId));
  const payments = await Promise.all(Array.from({length: 4}, () =>
    receivePayload(ws, receivableId)));
  const outcomes = await Promise.allSettled(payments.map((payload) =>
    receive(tenant.owner, payload)));
  assert.equal(fulfilledOf(outcomes).length, 1);
  assert.deepEqual([...new Set(rejectionCodes(outcomes))], ["aborted"]);
  const raced = await read(receivableRef(ws, receivableId));
  assert.equal(raced.balanceCents, 60_000);
  assertReceivableInvariant(raced);
  assert.equal(await countOf(ws, "receivable_movements"), 1);
  assert.equal(await countOf(ws, "transactions"), 1);

  // Em sequência, cada um com a versão nova: o que passaria do saldo é
  // recusado; o saldo nunca fica negativo.
  await receive(tenant.owner, await receivePayload(ws, receivableId));
  await expectHttpsError(receive(tenant.owner,
    await receivePayload(ws, receivableId)), "failed-precondition",
  {message: RECEIPT_ABOVE_BALANCE_MESSAGE});
  const drained = await read(receivableRef(ws, receivableId));
  assert.equal(drained.balanceCents, 20_000);
  assertReceivableInvariant(drained);

  // Recebimento × cancelamento: exatamente um vence; nunca cancelado com
  // recebimento ativo.
  for (let round = 0; round < 3; round += 1) {
    const {receivableId: id} = await newReceivable(tenant.owner,
      receivablePayload(ws, clientId));
    const [payment, cancellation] = await Promise.all([
      receivePayload(ws, id), cancelPayload(ws, id)]);
    const race = await Promise.allSettled([
      receive(tenant.owner, payment), cancel(tenant.admin, cancellation)]);
    assert.equal(fulfilledOf(race as Settled<unknown>[]).length, 1);
    const state = await read(receivableRef(ws, id));
    assertReceivableInvariant(state);
    const movements = (await listOf(ws, "receivable_movements"))
      .filter((movement) => movement.receivableId === id);
    assert.equal(movements.length, state.status === "cancelled" ? 0 : 1);
  }

  // Recebimento × alteração do valor: sem atualização perdida.
  for (let round = 0; round < 3; round += 1) {
    const {receivableId: id} = await newReceivable(tenant.owner,
      receivablePayload(ws, clientId));
    const [payment, edit] = await Promise.all([
      receivePayload(ws, id, {principalCents: 80_000}),
      receivableUpdatePayload(ws, id, {amountCents: 50_000})]);
    const race = await Promise.allSettled([
      receive(tenant.owner, payment), editReceivable(tenant.admin, edit)]);
    assert.equal(fulfilledOf(race as Settled<unknown>[]).length, 1);
    const state = await read(receivableRef(ws, id));
    assertReceivableInvariant(state);
    assert.ok(
      (state.amountCents === 100_000 && state.balanceCents === 20_000) ||
      (state.amountCents === 50_000 && state.balanceCents === 50_000),
      `estado vencedor inesperado: ${JSON.stringify(state)}`);
  }
});

test("P3-I — concorrência: arquivar o cliente × criar recebível nunca deixa " +
  "cliente arquivado com recebível em aberto", async () => {
  const tenant = await seedReceivableTenant("rcv-race-archive");
  const ws = tenant.workspaceId;
  for (let round = 0; round < 5; round += 1) {
    const clientId = await seedClient(tenant, {name: `Cliente ${round}`});
    const archival = await archivePayload(ws, clientId);
    const race = await Promise.allSettled([
      archive(tenant.admin, archival),
      newReceivable(tenant.member, receivablePayload(ws, clientId)),
    ]);
    assert.equal(fulfilledOf(race as Settled<unknown>[]).length, 1,
      JSON.stringify(rejectionCodes(race as Settled<unknown>[])));
    const client = await read(clientRef(ws, clientId));
    const open = (await listOf(ws, "receivables")).filter((receivable) =>
      receivable.clientId === clientId && receivable.status === "open");
    assert.equal(client.status === "archived" && open.length > 0, false);
  }
});

// ----------------------------------------------- falha antes/depois do commit

test("P3-I — falha antes do commit não deixa nada; reenvio depois do commit " +
  "não duplica", async () => {
  const tenant = await seedReceivableTenant("rcv-fault");
  const ws = tenant.workspaceId;
  const owner = actorOf(tenant);
  const keysOf = async () =>
    (await db().collection(`users/${tenant.owner}/idempotency_keys`).get())
      .size;

  const clientIntent = createClientPayloadSchema.parse(clientPayload(ws));
  await assert.rejects(executeCreateClient(owner, clientIntent, "r1",
    injected), /falha injetada/);
  for (const collection of ["clients", "client_private", "client_events",
    "rate_limits"]) {
    assert.equal(await countOf(ws, collection), 0, collection);
  }
  assert.equal(await keysOf(), 0);
  const {clientId} = await executeCreateClient(owner, clientIntent, "r2");
  // Resposta perdida depois do commit: o reenvio é replay.
  assert.equal((await executeCreateClient(owner, clientIntent, "r3"))
    .replayed, true);
  assert.equal(await countOf(ws, "clients"), 1);

  const privateBefore = await read(clientPrivateRef(ws, clientId));
  const edit = updateClientPayloadSchema.parse(await clientUpdatePayload(ws,
    clientId, {email: "outro@cliente.example"}));
  await assert.rejects(executeUpdateClient(owner, edit, "r4", injected),
    /falha injetada/);
  assert.deepEqual(await read(clientPrivateRef(ws, clientId)), privateBefore);
  assert.equal(await countOf(ws, "client_events"), 1);

  const creation = receivablePayload(ws, clientId) as CreateReceivablePayload;
  await assert.rejects(executeCreateReceivable(owner, creation, "r5",
    injected), /falha injetada/);
  assert.equal(await countOf(ws, "receivables"), 0);
  const {receivableId} = await executeCreateReceivable(owner, creation, "r6");
  assert.equal((await executeCreateReceivable(owner, creation, "r7"))
    .replayed, true);

  const payment = await receivePayload(ws, receivableId) as
    ReceiveReceivablePayload;
  await assert.rejects(executeReceiveReceivable(owner, payment, "r8",
    injected), /falha injetada/);
  const untouched = await read(receivableRef(ws, receivableId));
  assert.equal(untouched.balanceCents, 100_000);
  assert.equal(await countOf(ws, "receivable_movements"), 0);
  assert.equal(await countOf(ws, "transactions"), 0);
  const paid = await executeReceiveReceivable(owner, payment, "r9");
  assert.equal(paid.balanceCents, 60_000);
  const retried = await executeReceiveReceivable(owner, payment, "r10");
  assert.deepEqual([retried.replayed, retried.movementId],
    [true, paid.movementId]);
  await expireKeys(tenant.owner);
  assert.equal((await executeReceiveReceivable(owner, payment, "r11"))
    .movementId, paid.movementId);
  assert.equal(await countOf(ws, "receivable_movements"), 1);
  assert.equal(await countOf(ws, "transactions"), 1);

  const reversal = await reversePayload(ws, receivableId,
    paid.movementId as string) as ReverseReceivableReceiptPayload;
  await assert.rejects(executeReverseReceivableReceipt(owner, reversal, "r12",
    injected), /falha injetada/);
  assert.equal((await read(receivableRef(ws, receivableId))).balanceCents,
    60_000);
  assert.equal(await countOf(ws, "transactions"), 1);
  await executeReverseReceivableReceipt(owner, reversal, "r13");
  assert.equal((await executeReverseReceivableReceipt(owner, reversal,
    "r14")).replayed, true);
  assert.equal(await countOf(ws, "transactions"), 2);

  const cancellation = await cancelPayload(ws, receivableId) as
    CancelReceivablePayload;
  await assert.rejects(executeCancelReceivable(owner, cancellation, "r15",
    injected), /falha injetada/);
  assert.equal((await read(receivableRef(ws, receivableId))).status, "open");
  await executeCancelReceivable(owner, cancellation, "r16");
  assert.equal((await executeCancelReceivable(owner, cancellation, "r17"))
    .replayed, true);
  const final = await read(receivableRef(ws, receivableId));
  assert.equal(final.status, "cancelled");
  assertReceivableInvariant(final);
  assert.equal(await countOf(ws, "receivable_events"), 4);
});

// ------------------------------------------- limite operacional e congelamento

test("P3-I — limite operacional: recusa sem gravar; replay não " +
  "consome", async () => {
  const tenant = await seedReceivableTenant("rcv-rate");
  const ws = tenant.workspaceId;
  const intent = clientPayload(ws);
  const {clientId} = await newClient(tenant.owner, intent);
  const clientCounter = db().doc(`workspaces/${ws}/rate_limits/` +
    rateLimitDocumentId(CLIENT_MUTATION_RATE_LIMIT, tenant.owner));
  assert.equal((await clientCounter.get()).get("count"), 1);
  await clientCounter.update({count: CLIENT_MUTATION_RATE_LIMIT.limit});
  await expectHttpsError(newClient(tenant.owner, clientPayload(ws)),
    "failed-precondition", {message: /Muitas solicitações/});
  assert.equal(await countOf(ws, "clients"), 1);
  assert.equal((await newClient(tenant.owner, intent)).replayed, true);
  assert.equal((await clientCounter.get()).get("count"),
    CLIENT_MUTATION_RATE_LIMIT.limit);

  // O limite de recebíveis é separado do de cadastro.
  const {receivableId} = await newReceivable(tenant.owner,
    receivablePayload(ws, clientId));
  const receivableCounter = db().doc(`workspaces/${ws}/rate_limits/` +
    rateLimitDocumentId(RECEIVABLE_MUTATION_RATE_LIMIT, tenant.owner));
  await receivableCounter.update({count: RECEIVABLE_MUTATION_RATE_LIMIT.limit});
  const error = await expectHttpsError(receive(tenant.owner,
    await receivePayload(ws, receivableId)), "failed-precondition",
  {message: /Muitas solicitações/});
  assert.ok(Number((error.details as Record<string, unknown>)
    ?.retryAfterSeconds) > 0);
  assert.equal((await read(receivableRef(ws, receivableId))).balanceCents,
    100_000);
  assert.equal(await countOf(ws, "transactions"), 0);
});

test("P3-I — fora do schema autoritativo: falha fechada, mesmo para o " +
  "owner, sem alterar nada", async () => {
  const tenant = await seedReceivableTenant("rcv-schema");
  const ws = tenant.workspaceId;
  const clientId = await seedClient(tenant);
  const seedOpen = async () => (await newReceivable(tenant.owner,
    receivablePayload(ws, clientId))).receivableId;
  // Cada corrupção no próprio documento (o ID confere): só ela decide.
  const withoutMark = await seedOpen();
  const brokenBalance = await seedOpen();
  const persistedOverdue = await seedOpen();
  const brokenReceived = await seedOpen();
  await receivableRef(ws, withoutMark).update({
    schemaVersion: FieldValue.delete()});
  await receivableRef(ws, brokenBalance).update({balanceCents: 99_999});
  await receivableRef(ws, persistedOverdue).update({status: "overdue"});
  await receivableRef(ws, brokenReceived).update({status: "received"});
  // Formato do modelo substituído: valor em reais e `overdue` persistido.
  await db().doc(`workspaces/${ws}/receivables/modelo-antigo`).set({clientId,
    description: "X", value: 100.5, status: "overdue", dueDate: today(),
    updatedAt: Timestamp.now()});
  const ids = [withoutMark, brokenBalance, persistedOverdue, brokenReceived,
    "modelo-antigo"];
  const snapshots = new Map(await Promise.all(ids.map(async (id) =>
    [id, await read(receivableRef(ws, id))] as const)));

  for (const id of ids) {
    const version = formatIsoInstant(
      (await receivableRef(ws, id).get()).get("updatedAt"));
    for (const uid of [tenant.owner, tenant.admin]) {
      const base = {workspaceId: ws, receivableId: id,
        expectedUpdatedAt: version};
      for (const attempt of [
        () => receive(uid, {...base, idempotencyKey: idempotencyKey(),
          principalCents: 100, interestCents: 0, penaltyCents: 0,
          discountCents: 0, paymentDate: today(),
          cashAccountId: defaultAccountOf(ws)}),
        () => cancel(uid, {...base, idempotencyKey: idempotencyKey(),
          reason: "Teste de falha fechada"}),
        () => editReceivable(uid, {...base, idempotencyKey: idempotencyKey(),
          changes: {description: "Consertado?"}}),
      ]) {
        const error = await expectHttpsError(attempt(), "failed-precondition",
          {message: INCONSISTENT_RECEIVABLE_MESSAGE});
        assert.equal((error.details as Record<string, unknown>)?.ineligible,
          "inconsistent");
      }
    }
    assert.deepEqual(await read(receivableRef(ws, id)), snapshots.get(id));
  }

  // Cliente no formato antigo (CNPJ no documento compartilhado, `inactive`):
  // nem editado, nem arquivado, nem usado para novo recebível.
  await db().doc(`workspaces/${ws}/clients/antigo`).set({name: "Antigo",
    cnpj: PII.document, email: PII.email, status: "inactive",
    updatedAt: Timestamp.now()});
  const legacyVersion = formatIsoInstant(
    (await clientRef(ws, "antigo").get()).get("updatedAt"));
  await expectHttpsError(editClient(tenant.owner, {workspaceId: ws,
    idempotencyKey: idempotencyKey(), clientId: "antigo",
    expectedUpdatedAt: legacyVersion, changes: {name: "Novo"}}),
  "failed-precondition", {message: INCONSISTENT_CLIENT_MESSAGE});
  await expectHttpsError(archive(tenant.owner, {workspaceId: ws,
    idempotencyKey: idempotencyKey(), clientId: "antigo",
    expectedUpdatedAt: legacyVersion}),
  "failed-precondition", {message: INCONSISTENT_CLIENT_MESSAGE});
  await expectHttpsError(newReceivable(tenant.owner,
    receivablePayload(ws, "antigo")), "not-found",
  {message: RECEIVABLE_CLIENT_NOT_FOUND_MESSAGE});
  assert.equal(await countOf(ws, "receivable_movements"), 0);
  assert.equal(await countOf(ws, "client_events"), 1);
});

// ------------------------------------------------------------ privacidade

test("P3-I — privacidade: respostas, logs, eventos, espelhos e recebíveis " +
  "sem dados pessoais do cliente", async () => {
  const tenant = await seedReceivableTenant("rcv-pii");
  const ws = tenant.workspaceId;
  const entries: Record<string, unknown>[] = [];
  const responses: unknown[] = [];
  const spy = mock.method(functionsLogger, "write",
    (entry: Record<string, unknown>) => {
      entries.push(entry);
    });
  let clientId = "";
  let receivableId = "";
  try {
    const created = await newClient(tenant.owner, clientPayload(ws));
    clientId = created.clientId;
    responses.push(created);
    responses.push(await editClient(tenant.admin, await clientUpdatePayload(
      ws, clientId, {address: `${PII.address}, sala 2`, phone: PII.phone,
        notes: `${PII.notes} (revisado)`})));
    // Recusas também não podem ecoar os valores enviados.
    await expectHttpsError(newClient(tenant.member, clientPayload(ws)),
      "permission-denied");
    await expectHttpsError(newClient(tenant.owner,
      clientPayload(ws, {unexpected: true})), "invalid-argument");
    await expectHttpsError(newClient(tenant.owner,
      clientPayload(ws, {document: "11.222.333/0001-82"})),
    "invalid-argument");
    const receivable = await newReceivable(tenant.member,
      receivablePayload(ws, clientId));
    receivableId = receivable.receivableId;
    responses.push(receivable);
    const paid = await receive(tenant.member, await receivePayload(ws,
      receivableId, {principalCents: 90_000, discountCents: 10_000}));
    responses.push(paid);
    responses.push(await reverse(tenant.member, await reversePayload(ws,
      receivableId, paid.movementId as string)));
  } finally {
    spy.mock.restore();
  }
  assert.ok(entries.some((entry) => entry.event === "callable.end"));
  assert.equal(piiIn(entries), undefined, "logs sem dados pessoais");
  assert.equal(JSON.stringify(entries).includes(PII.name), false,
    "logs só com IDs");
  assert.equal(piiIn(responses), undefined, "respostas sem dados pessoais");

  for (const collection of ["clients", "client_events", "receivables",
    "receivable_movements", "receivable_events", "transactions"]) {
    assert.equal(piiIn(await listOf(ws, collection)), undefined, collection);
  }
  // O nome é compartilhado só no cadastro: não é copiado para recebível,
  // movimento, evento ou espelho no caixa.
  for (const collection of ["client_events", "receivables",
    "receivable_movements", "receivable_events", "transactions"]) {
    assert.equal(JSON.stringify(await listOf(ws, collection))
      .includes(PII.name), false, collection);
  }
  const shared = await read(clientRef(ws, clientId));
  assert.equal(Object.keys(shared).includes("requestHash"), false);
  assert.equal(piiIn(shared), undefined);
});
