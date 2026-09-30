import assert from "node:assert/strict";
import test from "node:test";

import {Timestamp} from "firebase-admin/firestore";

import {
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {WORKSPACE_ACCESS_DENIED_MESSAGE} from "../../shared/workspaceAuth";
import {
  changeWorkspaceMemberRole,
  leaveWorkspace,
  removeWorkspaceMember,
  revokeWorkspaceInvite,
  transferWorkspaceOwnership,
} from "../../workspaces/callables";
import {
  call,
  db,
  expectHttpsError,
  memberOf,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {getAccountUsage, getWorkspaceEntitlement} from "../callables";
import {planLimits} from "../catalog";
import {
  MAX_PENDING_RESERVATIONS,
  QUOTA_STATE_UNAVAILABLE_MESSAGE,
} from "../quota";
import {
  DAY_MS,
  accept,
  account,
  downgradeToFree,
  expectQuotaExceeded,
  expireInvite,
  inviteAccount,
  inviteEmail,
  membershipQuota,
  setBilling,
  settle,
} from "../testSupport/quotaTestSupport";

/**
 * P2B.1 — quota de membros por workspace (owner incluído), reservas de
 * convite e entitlement público do workspace pelo plano do owner.
 */

const email = () => `${uniqueId("conv")}@quota.test`;

/** Workspace de `owner` com `members` ativos (papel `member`). */
const workspaceOf = async (owner: string, members: string[] = []) => {
  const workspaceId = uniqueId("q-mws");
  await seedWorkspace({workspaceId, ownerId: owner});
  for (const uid of members) await seedMember(workspaceId, uid, "member");
  return workspaceId;
};

test("owner conta como membro; convite reserva a vaga; acima do limite é " +
  "negado", async () => {
  const owner = await account("q-m-owner");
  const workspaceId = await workspaceOf(owner);
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 1, reservations: []});

  const {inviteId} = await inviteEmail(owner, workspaceId, email());
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 1, reservations: [inviteId]});
  const stored = (await db()
    .doc(`workspaces/${workspaceId}/quota_state/membership`).get())
    .get(`pendingReservations.${inviteId}`) as Timestamp;
  const invite = await db()
    .doc(`workspaces/${workspaceId}/invites/${inviteId}`).get();
  assert.equal(stored.toMillis(), (invite.get("expiresAt") as Timestamp)
    .toMillis(), "reserva vence com o convite");

  await expectQuotaExceeded(inviteEmail(owner, workspaceId, email()), {
    resource: "membersPerWorkspace", planId: "free", limit: 2, used: 2,
  });
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 1, reservations: [inviteId]});
  // A recusa não cria convite.
  const pending = await db()
    .collection(`workspaces/${workspaceId}/invites`)
    .where("status", "==", "pending").get();
  assert.equal(pending.size, 1);
});

test("substituir o convite do mesmo e-mail não ocupa vaga extra", async () => {
  const owner = await account("q-m-owner");
  const workspaceId = await workspaceOf(owner);
  const address = email();
  const first = await inviteEmail(owner, workspaceId, address);
  const second = await inviteEmail(owner, workspaceId, address, "viewer");
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 1, reservations: [second.inviteId]});
  assert.equal((await db()
    .doc(`workspaces/${workspaceId}/invites/${first.inviteId}`).get())
    .get("status"), "revoked");
});

test("revogar libera a vaga; repetir a revogação não mexe na " +
  "contagem", async () => {
  const owner = await account("q-m-owner");
  const workspaceId = await workspaceOf(owner);
  const {inviteId} = await inviteEmail(owner, workspaceId, email());
  await call(revokeWorkspaceInvite, owner, {workspaceId, inviteId});
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 1, reservations: []});
  const again = await call<{changed: boolean}>(revokeWorkspaceInvite, owner,
    {workspaceId, inviteId});
  assert.equal(again.changed, false);
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 1, reservations: []});
  await inviteEmail(owner, workspaceId, email());
});

test("reserva vencida não ocupa vaga e sai do mapa na operação " +
  "seguinte", async () => {
  const owner = await account("q-m-owner");
  const workspaceId = await workspaceOf(owner);
  const expired = await inviteEmail(owner, workspaceId, email());
  await expireInvite(workspaceId, expired.inviteId);
  const fresh = await inviteEmail(owner, workspaceId, email());
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 1, reservations: [fresh.inviteId]});
});

test("aceite converte a reserva em membro sem aumentar a " +
  "ocupação", async () => {
  const owner = await account("q-m-owner");
  const invitee = await account("q-m-guest");
  const workspaceId = await workspaceOf(owner);
  const {inviteId, token} = await inviteAccount(owner, workspaceId, invitee);
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 1, reservations: [inviteId]});
  await accept(invitee, token);
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 2, reservations: []});
  // Replay do aceite não conta de novo.
  const replay = await accept(invitee, token);
  assert.equal(replay.replay, true);
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 2, reservations: []});
});

test("downgrade entre convite e aceite: aceite negado, nada é " +
  "apagado", async () => {
  const owner = await account("q-m-owner", "pro");
  const existing = await account("q-m-existing");
  const invitee = await account("q-m-late");
  const workspaceId = await workspaceOf(owner, [existing]);
  const {inviteId, token} = await inviteAccount(owner, workspaceId, invitee);
  await downgradeToFree(owner);
  await expectQuotaExceeded(accept(invitee, token), {
    resource: "membersPerWorkspace", planId: "free", limit: 2, used: 2,
  });
  assert.equal(await memberOf(workspaceId, invitee), undefined);
  assert.equal((await memberOf(workspaceId, existing))?.status, "active");
  assert.equal((await db()
    .doc(`workspaces/${workspaceId}/invites/${inviteId}`).get())
    .get("status"), "pending");
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 2, reservations: [inviteId]});
});

test("remoção e saída liberam a vaga; replay não decrementa de " +
  "novo", async () => {
  const owner = await account("q-m-owner");
  const removed = await account("q-m-removed");
  const workspaceId = await workspaceOf(owner, [removed]);
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 2, reservations: []});
  await expectQuotaExceeded(inviteEmail(owner, workspaceId, email()),
    {resource: "membersPerWorkspace", planId: "free", used: 2});

  await call(removeWorkspaceMember, owner, {workspaceId, memberId: removed});
  await call(removeWorkspaceMember, owner, {workspaceId, memberId: removed});
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 1, reservations: []});

  const leaver = await account("q-m-leaver");
  await seedMember(workspaceId, leaver, "viewer");
  assert.equal((await membershipQuota(workspaceId)).activeMembers, 2);
  await call(leaveWorkspace, leaver, {workspaceId});
  await call(leaveWorkspace, leaver, {workspaceId});
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 1, reservations: []});
  await inviteEmail(owner, workspaceId, email());
});

test("troca de papel não altera a quota", async () => {
  const owner = await account("q-m-owner");
  const member = await account("q-m-role");
  const workspaceId = await workspaceOf(owner, [member]);
  await call(changeWorkspaceMemberRole, owner,
    {workspaceId, memberId: member, role: "viewer"});
  assert.deepEqual(await membershipQuota(workspaceId),
    {activeMembers: 2, reservations: []});
});

test("convites concorrentes no último slot: um só reserva", async () => {
  for (let round = 0; round < 2; round += 1) {
    const owner = await account("q-m-race");
    const workspaceId = await workspaceOf(owner);
    const {fulfilled, rejectedCodes} = await settle(
      Array.from({length: 3}, () => inviteEmail(owner, workspaceId, email())),
    );
    assert.equal(fulfilled, 1);
    assert.deepEqual(new Set(rejectedCodes), new Set(["resource-exhausted"]));
    const quota = await membershipQuota(workspaceId);
    assert.equal(quota.activeMembers, 1);
    assert.equal(quota.reservations.length, 1);
  }
});

test("aceites concorrentes no último slot não passam do limite", async () => {
  for (let round = 0; round < 2; round += 1) {
    const owner = await account("q-m-accept", "pro");
    const [first, second] = [
      await account("q-m-a"), await account("q-m-b"),
    ];
    const workspaceId = await workspaceOf(owner);
    const a = await inviteAccount(owner, workspaceId, first);
    const b = await inviteAccount(owner, workspaceId, second);
    // Duas reservas vigentes, uma única vaga no plano atual.
    await downgradeToFree(owner);
    const {fulfilled, rejectedCodes} = await settle([
      accept(first, a.token),
      accept(second, b.token),
    ]);
    assert.equal(fulfilled, 1);
    assert.deepEqual(rejectedCodes, ["resource-exhausted"]);
    const quota = await membershipQuota(workspaceId);
    assert.equal(quota.activeMembers, 2);
    assert.equal(quota.reservations.length, 1, "a reserva perdedora segue");
    const active = await db().collection(`workspaces/${workspaceId}/members`)
      .where("status", "==", "active").count().get();
    assert.equal(active.data().count, 2);
  }
});

test("estado de quota do workspace ausente ou incoerente falha " +
  "fechado", async () => {
  const owner = await account("q-m-missing");
  const workspaceId = await workspaceOf(owner);
  await db().doc(`workspaces/${workspaceId}/quota_state/membership`).delete();
  await expectHttpsError(inviteEmail(owner, workspaceId, email()), "internal",
    {message: QUOTA_STATE_UNAVAILABLE_MESSAGE});
  const invites = await db().collection(`workspaces/${workspaceId}/invites`)
    .get();
  assert.equal(invites.size, 0);

  // `ownerId` sem membership owner ativo: sem adivinhar outro owner.
  const other = await account("q-m-owner");
  const stray = await workspaceOf(other);
  await db().doc(`workspaces/${stray}`).update({ownerId: "alguem-sem-vinculo"});
  await expectHttpsError(inviteEmail(other, stray, email()), "internal");
  await expectHttpsError(
    call(getWorkspaceEntitlement, other, {workspaceId: stray}), "internal");
});

test("mapa de reservas é limitado pelo maior plano do catálogo", () => {
  assert.equal(MAX_PENDING_RESERVATIONS, planLimits("business")
    .membersPerWorkspace);
});

// ---------------------------------------------------------------------------
// Entitlement público do workspace
// ---------------------------------------------------------------------------

const entitlementOf = (uid: string, workspaceId: string) =>
  call<Record<string, unknown>>(getWorkspaceEntitlement, uid, {workspaceId});

test("entitlement do workspace é o plano do owner para qualquer " +
  "membro", async () => {
  for (const plan of ["free", "pro", "business"] as const) {
    const owner = await account(`q-e-${plan}`, plan);
    const workspaceId = await workspaceOf(owner);
    const result = await entitlementOf(owner, workspaceId);
    assert.deepEqual(result, {
      catalogVersion: 1,
      planId: plan,
      entitlementStatus: plan === "free" ? "free" : "active",
      limits: {...planLimits(plan)},
    });
  }

  // Membro Free num workspace Business vê Business; owner Business num
  // workspace de outro owner Free vê Free; viewer consulta.
  const businessOwner = await account("q-e-biz", "business");
  const freeMember = await account("q-e-freemember");
  const businessWs = await workspaceOf(businessOwner, [freeMember]);
  assert.equal((await entitlementOf(freeMember, businessWs)).planId,
    "business");

  const freeOwner = await account("q-e-freeowner");
  const freeWs = await workspaceOf(freeOwner);
  await seedMember(freeWs, businessOwner, "viewer");
  const seen = await entitlementOf(businessOwner, freeWs);
  assert.equal(seen.planId, "free");
  assert.deepEqual(seen.limits, {...planLimits("free")});

  const serialized = JSON.stringify(seen);
  assert.deepEqual(Object.keys(seen).sort(),
    ["catalogVersion", "entitlementStatus", "limits", "planId"]);
  assert.ok(!serialized.includes(freeOwner), "sem uid do owner");
  assert.doesNotMatch(serialized, /cus_|sub_|price_|stripe|grace/i);
});

test("entitlement segue o owner depois da transferência de " +
  "ownership", async () => {
  const owner = await account("q-e-from", "business");
  const target = await account("q-e-to", "pro");
  const workspaceId = await workspaceOf(owner, [target]);
  assert.equal((await entitlementOf(target, workspaceId)).planId, "business");
  await call(transferWorkspaceOwnership, owner, {
    workspaceId, newOwnerId: target, idempotencyKey: `idem-${uniqueId("t")}`,
  });
  assert.equal((await entitlementOf(owner, workspaceId)).planId, "pro");
});

test("não membro e workspace inexistente recebem a mesma recusa", async () => {
  const owner = await account("q-e-owner", "business");
  const stranger = await account("q-e-stranger");
  const workspaceId = await workspaceOf(owner);
  const foreign = await expectHttpsError(entitlementOf(stranger, workspaceId),
    "permission-denied", {message: WORKSPACE_ACCESS_DENIED_MESSAGE});
  const missing = await expectHttpsError(
    entitlementOf(stranger, uniqueId("nao-existe")),
    "permission-denied", {message: WORKSPACE_ACCESS_DENIED_MESSAGE});
  assert.deepEqual(foreign.details, missing.details);

  const removed = await account("q-e-removed");
  await seedMember(workspaceId, removed, "member", "removed");
  await expectHttpsError(entitlementOf(removed, workspaceId),
    "permission-denied");
});

test("grace e cancelamento vencidos são reavaliados no servidor", async () => {
  const owner = await account("q-e-grace", "pro");
  const workspaceId = await workspaceOf(owner);
  await setBilling(owner, {
    entitlementStatus: "grace",
    subscriptionStatus: "past_due",
    graceUntil: Timestamp.fromMillis(Date.now() + DAY_MS),
    stripeCustomerId: "cus_quota_test",
    stripeSubscriptionId: "sub_quota_test",
  });
  const inGrace = await entitlementOf(owner, workspaceId);
  assert.equal(inGrace.planId, "pro");
  assert.equal(inGrace.entitlementStatus, "grace");
  assert.doesNotMatch(JSON.stringify(inGrace), /cus_|sub_|graceUntil/);

  await setBilling(owner, {graceUntil: Timestamp.fromMillis(Date.now() - 1)});
  const expired = await entitlementOf(owner, workspaceId);
  assert.equal(expired.planId, "free");
  assert.equal(expired.entitlementStatus, "restricted");

  await setBilling(owner, {
    entitlementStatus: "active",
    subscriptionStatus: "active",
    graceUntil: null,
    cancelAtPeriodEnd: true,
    currentPeriodEnd: Timestamp.fromMillis(Date.now() - 1),
  });
  const canceled = await entitlementOf(owner, workspaceId);
  assert.equal(canceled.planId, "free");
  assert.equal(canceled.entitlementStatus, "free");
});

test("uso da conta: só o próprio contador de workspaces", async () => {
  const uid = await account("q-u");
  assert.deepEqual(await call(getAccountUsage, uid, {}),
    {activeOwnedWorkspaces: 0});
  await workspaceOf(uid);
  assert.deepEqual(await call(getAccountUsage, uid, {}),
    {activeOwnedWorkspaces: 1});
  await expectHttpsError(call(getAccountUsage, uid, {uid: "outro"}),
    "invalid-argument");
  await expectHttpsError(call(getAccountUsage, null, {}), "unauthenticated");
});
