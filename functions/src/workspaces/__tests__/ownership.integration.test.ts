import assert from "node:assert/strict";
import test from "node:test";

import {
  requireFirestoreEmulator,
  seedActiveAccount,
  seedMember,
  seedPaidPlan,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {
  changeWorkspaceMemberRole,
  leaveWorkspace,
  transferWorkspaceOwnership,
} from "../callables";
import {
  activeOwners,
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  memberOf,
  membershipEvents,
  staleAuthTime,
  uniqueId,
} from "../testSupport/p1TestSupport";

requireFirestoreEmulator();

const account = async (prefix: string): Promise<string> => {
  const uid = uniqueId(prefix);
  await seedActiveAccount(uid);
  return uid;
};

const team = async () => {
  const workspaceId = uniqueId("ws-own");
  const [owner, adminUid, member, viewer] = await Promise.all([
    account("owner"), account("admin"), account("member"), account("viewer"),
  ]);
  // Quatro membros ativos: qualquer destino da transferência precisa de um
  // plano que os comporte (P2B.1). A capacidade é testada em billing.
  await Promise.all([owner, adminUid, member, viewer]
    .map((uid) => seedPaidPlan(uid, "pro")));
  await seedWorkspace({workspaceId, ownerId: owner});
  await Promise.all([
    seedMember(workspaceId, adminUid, "admin"),
    seedMember(workspaceId, member, "member"),
    seedMember(workspaceId, viewer, "viewer"),
  ]);
  return {workspaceId, owner, admin: adminUid, member, viewer};
};

const transfer = (actor: string, workspaceId: string, newOwnerId: string,
  key = idempotencyKey(), overrides = {}) =>
  call(transferWorkspaceOwnership, actor, {
    workspaceId,
    newOwnerId,
    idempotencyKey: key,
  }, overrides);

test("transferência: destino vira owner, origem vira admin, ownerId espelha", async () => {
  const {workspaceId, owner, member} = await team();
  await transfer(owner, workspaceId, member);
  assert.equal((await memberOf(workspaceId, member))?.role, "owner");
  assert.equal((await memberOf(workspaceId, owner))?.role, "admin");
  assert.equal(
    (await db().doc(`workspaces/${workspaceId}`).get()).get("ownerId"),
    member,
  );
  assert.deepEqual(await activeOwners(workspaceId), [member]);
  const events = await membershipEvents(workspaceId, "ownership.transferred");
  assert.equal(events.length, 1);
  assert.equal(events[0].before.ownerId, owner);
  assert.equal(events[0].after.ownerId, member);

  // A antiga origem, agora admin, não transfere mais.
  await expectHttpsError(
    transfer(owner, workspaceId, owner),
    "permission-denied",
  );
});

test("transferência: só o owner, com login recente e e-mail verificado", async () => {
  const {workspaceId, owner, admin, member} = await team();
  await expectHttpsError(
    transfer(admin, workspaceId, member),
    "permission-denied",
  );
  await expectHttpsError(
    transfer(member, workspaceId, admin),
    "permission-denied",
  );
  await expectHttpsError(
    transfer(owner, workspaceId, member, idempotencyKey(), {
      auth_time: staleAuthTime(),
    }),
    "failed-precondition",
    {reason: "recent_login_required"},
  );
  await expectHttpsError(
    transfer(owner, workspaceId, member, idempotencyKey(), {
      email_verified: false,
    }),
    "permission-denied",
    {reason: "email_not_verified"},
  );
  assert.deepEqual(await activeOwners(workspaceId), [owner]);
});

test("transferência: destino precisa ser membro ativo com conta ativa", async () => {
  const {workspaceId, owner, member} = await team();
  const outsider = await account("outsider");
  await expectHttpsError(
    transfer(owner, workspaceId, outsider),
    "failed-precondition",
  );
  const removed = await account("removed");
  await seedMember(workspaceId, removed, "member", "removed");
  await expectHttpsError(
    transfer(owner, workspaceId, removed),
    "failed-precondition",
  );
  await db().doc(`users/${member}`).update({status: "suspended"});
  await expectHttpsError(
    transfer(owner, workspaceId, member),
    "failed-precondition",
  );
  await expectHttpsError(
    transfer(owner, workspaceId, owner),
    "invalid-argument",
  );
  assert.deepEqual(await activeOwners(workspaceId), [owner]);
  assert.equal(
    (await membershipEvents(workspaceId, "ownership.transferred")).length,
    0,
  );
});

test("transferência repetida com a mesma chave devolve o resultado salvo", async () => {
  const {workspaceId, owner, admin} = await team();
  const key = idempotencyKey();
  const first = await transfer(owner, workspaceId, admin, key);
  const replay = await transfer(owner, workspaceId, admin, key);
  assert.deepEqual(replay, first);
  assert.equal(
    (await membershipEvents(workspaceId, "ownership.transferred")).length,
    1,
  );
});

test("duas transferências concorrentes mantêm exatamente um owner", async () => {
  for (let round = 0; round < 3; round += 1) {
    const {workspaceId, owner, admin, member} = await team();
    const outcomes = await Promise.allSettled([
      transfer(owner, workspaceId, admin),
      transfer(owner, workspaceId, member),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === "fulfilled");
    assert.equal(fulfilled.length, 1, "só uma transferência vence");
    const owners = await activeOwners(workspaceId);
    assert.equal(owners.length, 1, "nunca zero nem dois owners");
    assert.ok([admin, member].includes(owners[0]));
    assert.equal(
      (await db().doc(`workspaces/${workspaceId}`).get()).get("ownerId"),
      owners[0],
    );
    assert.equal((await memberOf(workspaceId, owner))?.role, "admin");
    assert.equal(
      (await membershipEvents(workspaceId, "ownership.transferred")).length,
      1,
    );
  }
});

test("o owner não sai nem é rebaixado sem transferência; depois dela, sai", async () => {
  const {workspaceId, owner, admin} = await team();
  await expectHttpsError(
    call(leaveWorkspace, owner, {workspaceId}),
    "permission-denied",
  );
  await expectHttpsError(
    call(changeWorkspaceMemberRole, admin, {
      workspaceId,
      memberId: owner,
      role: "member",
    }),
    "permission-denied",
  );
  await transfer(owner, workspaceId, admin);
  await call(leaveWorkspace, owner, {workspaceId});
  assert.equal((await memberOf(workspaceId, owner))?.status, "removed");
  assert.deepEqual(await activeOwners(workspaceId), [admin]);
});
