import assert from "node:assert/strict";
import test from "node:test";

import {Timestamp} from "firebase-admin/firestore";

import {
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {
  archiveWorkspace,
  bootstrapAccount,
  createWorkspace,
  revokeWorkspaceInvite,
  transferWorkspaceOwnership,
} from "../../workspaces/callables";
import {
  activeOwners,
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  memberOf,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {QUOTA_STATE_UNAVAILABLE_MESSAGE} from "../quota";
import {
  DAY_MS,
  account,
  activeOwnedWorkspaces,
  downgradeToFree,
  expectQuotaExceeded,
  inviteEmail,
  membershipQuota,
  ownedCount,
  setBilling,
  setOwnedCount,
  settle,
} from "../testSupport/quotaTestSupport";

/**
 * P2B.1 — quota de workspaces próprios e transferência de ownership.
 *
 * O contador `activeOwnedWorkspaces` do titular é lido e gravado na mesma
 * transação de bootstrap, criação, arquivamento e transferência; o limite é
 * o do entitlement efetivo do titular no relógio do servidor.
 */

const create = (uid: string, key = idempotencyKey()) =>
  call<{workspaceId: string}>(createWorkspace, uid, {
    type: "PJ",
    name: "Espaço de quota",
    idempotencyKey: key,
  });

const archive = (uid: string, workspaceId: string) =>
  call<{alreadyArchived: boolean}>(archiveWorkspace, uid, {workspaceId});

test("Free nasce com 1 workspace e 1 membro contados e não cria o " +
  "segundo", async () => {
  const uid = uniqueId("q-free");
  const boot = await call<{workspaceId: string}>(bootstrapAccount, uid, {});
  assert.equal(await ownedCount(uid), 1);
  assert.deepEqual(await membershipQuota(boot.workspaceId),
    {activeMembers: 1, reservations: []});
  const ownership = (await db()
    .doc(`billing_accounts/${uid}/quota_state/ownership`).get()).data();
  assert.equal(ownership?.billingOwnerUid, uid);
  assert.equal(ownership?.schemaVersion, 1);

  await expectQuotaExceeded(create(uid), {
    resource: "workspaces", planId: "free", limit: 1, used: 1,
  });
  assert.equal(await ownedCount(uid), 1);
  assert.equal(await activeOwnedWorkspaces(uid), 1);
});

test("primeira preparação concorrente conta um único workspace", async () => {
  const uid = uniqueId("q-boot-race");
  const results = await Promise.all(Array.from({length: 4},
    () => call<{created: boolean; workspaceId: string | null}>(
      bootstrapAccount, uid, {})));
  const created = results.filter((result) => result.created);
  assert.equal(created.length, 1);
  assert.equal(await ownedCount(uid), 1);
  assert.deepEqual(await membershipQuota(created[0].workspaceId as string),
    {activeMembers: 1, reservations: []});
});

test("Pro cria até 5 e Business até 20 workspaces próprios", async () => {
  const pro = await account("q-pro", "pro");
  for (let index = 0; index < 5; index += 1) await create(pro);
  await expectQuotaExceeded(create(pro), {
    resource: "workspaces", planId: "pro", limit: 5, used: 5,
  });
  assert.equal(await ownedCount(pro), 5);
  assert.equal(await activeOwnedWorkspaces(pro), 5);

  // Business: o contador no penúltimo slot (19) equivale a 19 criações.
  const business = await account("q-biz", "business");
  await setOwnedCount(business, 19);
  const {workspaceId} = await create(business);
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 1, reservations: []});
  await expectQuotaExceeded(create(business), {
    resource: "workspaces", planId: "business", limit: 20, used: 20,
  });
  assert.equal(await ownedCount(business), 20);
});

test("criações concorrentes no último slot: exatamente uma vence", async () => {
  for (let round = 0; round < 2; round += 1) {
    const uid = await account("q-race");
    const {fulfilled, rejectedCodes} = await settle(
      Array.from({length: 4}, () => create(uid)),
    );
    assert.equal(fulfilled, 1, "uma única criação no último slot");
    assert.deepEqual(new Set(rejectedCodes), new Set(["resource-exhausted"]));
    assert.equal(await ownedCount(uid), 1);
    assert.equal(await activeOwnedWorkspaces(uid), 1);
  }
});

test("replay de createWorkspace não incrementa de novo", async () => {
  const uid = await account("q-replay", "pro");
  const key = idempotencyKey();
  const first = await create(uid, key);
  const second = await create(uid, key);
  assert.equal(second.workspaceId, first.workspaceId);
  assert.equal(await ownedCount(uid), 1);
  // Replay concorrente também não soma.
  const racingKey = idempotencyKey();
  await settle([create(uid, racingKey), create(uid, racingKey)]);
  assert.equal(await ownedCount(uid), 2);
  assert.equal(await activeOwnedWorkspaces(uid), 2);
});

test("arquivar libera o slot; repetir o arquivamento não " +
  "decrementa", async () => {
  const uid = uniqueId("q-archive");
  const boot = await call<{workspaceId: string}>(bootstrapAccount, uid, {});
  const first = await archive(uid, boot.workspaceId);
  assert.equal(first.alreadyArchived, false);
  assert.equal(await ownedCount(uid), 0);
  const again = await archive(uid, boot.workspaceId);
  assert.equal(again.alreadyArchived, true);
  assert.equal(await ownedCount(uid), 0);
  // O estado de quota do workspace arquivado não é apagado.
  assert.deepEqual(await membershipQuota(boot.workspaceId),
    {activeMembers: 1, reservations: []});

  await create(uid);
  assert.equal(await ownedCount(uid), 1);
});

test("downgrade com excedente preserva os dados e só bloqueia " +
  "criação", async () => {
  const uid = await account("q-down", "pro");
  const ids: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    ids.push((await create(uid)).workspaceId);
  }
  await downgradeToFree(uid);
  await expectQuotaExceeded(create(uid), {
    resource: "workspaces", planId: "free", limit: 1, used: 3,
  });
  for (const workspaceId of ids) {
    const workspace = await db().doc(`workspaces/${workspaceId}`).get();
    assert.equal(workspace.get("status"), "active", "nada é arquivado");
    assert.equal((await memberOf(workspaceId, uid))?.role, "owner");
  }
  // Arquivar para reduzir o excesso é sempre permitido.
  await archive(uid, ids[0]);
  assert.equal(await ownedCount(uid), 2);
  await expectQuotaExceeded(create(uid), {
    resource: "workspaces", planId: "free", limit: 1, used: 2,
  });
});

test("grace usa o limite pago; grace e cancelamento vencidos voltam ao " +
  "Free", async () => {
  const uid = await account("q-grace", "pro");
  await create(uid);
  await setBilling(uid, {
    entitlementStatus: "grace",
    subscriptionStatus: "past_due",
    graceUntil: Timestamp.fromMillis(Date.now() + DAY_MS),
  });
  await create(uid);
  assert.equal(await ownedCount(uid), 2);

  // O documento ainda diz `grace`/`pro`, mas o prazo passou sem webhook.
  await setBilling(uid, {graceUntil: Timestamp.fromMillis(Date.now() - 1000)});
  await expectQuotaExceeded(create(uid), {
    resource: "workspaces", planId: "free", limit: 1, used: 2,
  });

  // Cancelamento no fim do período já vencido, ainda gravado como ativo.
  await setBilling(uid, {
    entitlementStatus: "active",
    subscriptionStatus: "active",
    graceUntil: null,
    cancelAtPeriodEnd: true,
    currentPeriodEnd: Timestamp.fromMillis(Date.now() - 1000),
  });
  await expectQuotaExceeded(create(uid), {
    resource: "workspaces", planId: "free", limit: 1, used: 2,
  });
  assert.equal(await ownedCount(uid), 2);
});

test("estado de quota ausente falha fechado, sem criar nada", async () => {
  const uid = await account("q-missing", "pro");
  await db().doc(`billing_accounts/${uid}/quota_state/ownership`).delete();
  await expectHttpsError(create(uid), "internal",
    {message: QUOTA_STATE_UNAVAILABLE_MESSAGE});
  assert.equal(await activeOwnedWorkspaces(uid), 0);
  // Conta ativa sem estado de quota: o bootstrap não restaura em silêncio.
  await expectHttpsError(call(bootstrapAccount, uid, {}), "internal");
  assert.equal(await activeOwnedWorkspaces(uid), 0);

  // Billing ausente também falha fechado.
  const other = await account("q-nobilling", "pro");
  await db().doc(`billing_accounts/${other}`).delete();
  await expectHttpsError(create(other), "internal");
  assert.equal(await ownedCount(other), 0);
});

test("bootstrap restaura o pessoal consumindo um slot, uma única " +
  "vez", async () => {
  const uid = uniqueId("q-heal");
  const boot = await call<{workspaceId: string}>(bootstrapAccount, uid, {});
  await archive(uid, boot.workspaceId);
  assert.equal(await ownedCount(uid), 0);
  const results = await Promise.all(Array.from({length: 3},
    () => call<{created: boolean}>(bootstrapAccount, uid, {})));
  assert.equal(results.filter((result) => result.created).length, 1);
  assert.equal(await ownedCount(uid), 1);
  assert.equal(await activeOwnedWorkspaces(uid), 1);
});

// ---------------------------------------------------------------------------
// Transferência de ownership
// ---------------------------------------------------------------------------

const transfer = (
  actor: string,
  workspaceId: string,
  newOwnerId: string,
  key = idempotencyKey(),
) => call(transferWorkspaceOwnership, actor, {
  workspaceId,
  newOwnerId,
  idempotencyKey: key,
});

/** Workspace de `owner` com `others` como membros ativos. */
const ownedWorkspace = async (owner: string, others: string[] = []) => {
  const workspaceId = uniqueId("q-ws");
  await seedWorkspace({workspaceId, ownerId: owner});
  for (const uid of others) await seedMember(workspaceId, uid, "member");
  return workspaceId;
};

const assertUnchanged = async (input: {
  workspaceId: string;
  owner: string;
  target: string;
  ownerCount: number;
  targetCount: number;
}) => {
  assert.deepEqual(await activeOwners(input.workspaceId), [input.owner]);
  assert.equal((await memberOf(input.workspaceId, input.target))?.role,
    "member");
  assert.equal(
    (await db().doc(`workspaces/${input.workspaceId}`).get()).get("ownerId"),
    input.owner,
  );
  assert.equal(await ownedCount(input.owner), input.ownerCount);
  assert.equal(await ownedCount(input.target), input.targetCount);
};

test("transferência: destino com capacidade recebe; contadores " +
  "trocam", async () => {
  const owner = await account("q-t-owner");
  const target = await account("q-t-target", "pro");
  const workspaceId = await ownedWorkspace(owner, [target]);
  assert.equal(await ownedCount(owner), 1);
  await transfer(owner, workspaceId, target);
  assert.deepEqual(await activeOwners(workspaceId), [target]);
  assert.equal(await ownedCount(owner), 0);
  assert.equal(await ownedCount(target), 1);
  // Membros não mudam com a troca de papéis.
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 2, reservations: []});
});

test("transferência: destino sem slot de workspace é recusado sem " +
  "efeito", async () => {
  const owner = await account("q-t-owner");
  const target = await account("q-t-full");
  await ownedWorkspace(target);
  const workspaceId = await ownedWorkspace(owner, [target]);
  await expectQuotaExceeded(transfer(owner, workspaceId, target),
    {resource: "workspaces"});
  await assertUnchanged({
    workspaceId, owner, target, ownerCount: 1, targetCount: 1,
  });
});

test("transferência: destino sem capacidade de membros (reservas " +
  "contam)", async () => {
  const owner = await account("q-t-owner", "business");
  const target = await account("q-t-small");
  const workspaceId = await ownedWorkspace(owner, [target]);
  // 2 ativos + 1 reserva > 2 do Free do destino.
  const {inviteId} = await inviteEmail(owner, workspaceId,
    `${uniqueId("x")}@quota.test`);
  await expectQuotaExceeded(transfer(owner, workspaceId, target),
    {resource: "membersPerWorkspace"});
  await assertUnchanged({
    workspaceId, owner, target, ownerCount: 1, targetCount: 0,
  });
  // Sem a reserva, a ocupação cabe e a mesma transferência passa.
  await call(revokeWorkspaceInvite, owner, {workspaceId, inviteId});
  await transfer(owner, workspaceId, target);
  assert.deepEqual(await activeOwners(workspaceId), [target]);
  assert.equal(await ownedCount(target), 1);
  assert.equal(await ownedCount(owner), 0);
});

test("transferência: origem acima da quota ainda transfere para " +
  "fora", async () => {
  const owner = await account("q-t-over", "pro");
  const target = await account("q-t-dest", "pro");
  await ownedWorkspace(owner);
  const workspaceId = await ownedWorkspace(owner, [target]);
  await downgradeToFree(owner);
  assert.equal(await ownedCount(owner), 2);
  await transfer(owner, workspaceId, target);
  assert.equal(await ownedCount(owner), 1);
  assert.equal(await ownedCount(target), 1);
});

test("transferências concorrentes: um owner e contadores " +
  "coerentes", async () => {
  for (let round = 0; round < 2; round += 1) {
    const owner = await account("q-t-race", "pro");
    const first = await account("q-t-a", "pro");
    const second = await account("q-t-b", "pro");
    const workspaceId = await ownedWorkspace(owner, [first, second]);
    const {fulfilled, rejectedCodes} = await settle([
      transfer(owner, workspaceId, first),
      transfer(owner, workspaceId, second),
    ]);
    assert.equal(fulfilled, 1, "só uma transferência vence");
    // A perdedora relê a origem já rebaixada e é recusada; sob carga, o lock
    // pessimista pode esgotar as tentativas da transação (ABORTED ⇒
    // `internal`), sempre sem efeito parcial — os contadores abaixo provam.
    assert.equal(rejectedCodes.length, 1);
    const loserCode = String(rejectedCodes[0]);
    assert.ok(["permission-denied", "internal"].includes(loserCode), loserCode);
    const owners = await activeOwners(workspaceId);
    assert.equal(owners.length, 1);
    const winner = owners[0];
    const loser = winner === first ? second : first;
    assert.equal(await ownedCount(owner), 0);
    assert.equal(await ownedCount(winner), 1);
    assert.equal(await ownedCount(loser), 0);
  }
});

test("transferência: destino no último slot, concorrendo com criação " +
  "própria", async () => {
  const owner = await account("q-t-owner", "pro");
  const target = await account("q-t-slot");
  const workspaceId = await ownedWorkspace(owner, [target]);
  // O destino (Free, 0 próprios) cria e recebe ao mesmo tempo: só um cabe.
  const {fulfilled, rejectedCodes} = await settle([
    transfer(owner, workspaceId, target),
    create(target),
  ]);
  assert.equal(fulfilled, 1);
  assert.deepEqual(rejectedCodes, ["resource-exhausted"]);
  assert.equal(await ownedCount(target), 1);
  assert.equal(await activeOwnedWorkspaces(target), 1);
});
