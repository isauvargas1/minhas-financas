import assert from "node:assert/strict";
import test from "node:test";

import {
  requireFirestoreEmulator,
  seedActiveAccount,
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import type {WorkspaceRole} from "../../shared/workspaceAuth";
import {
  changeWorkspaceMemberRole,
  leaveWorkspace,
  removeWorkspaceMember,
  updateWorkspaceSettings,
} from "../callables";
import {
  executeChangeWorkspaceMemberRole,
  executeRemoveWorkspaceMember,
} from "../memberships";
import {canChangeRole, canRemove, MANAGEABLE_ROLES} from "../rbac";
import {
  call,
  db,
  expectHttpsError,
  indexOf,
  memberOf,
  membershipEvents,
  uniqueId,
} from "../testSupport/p1TestSupport";

requireFirestoreEmulator();

const ALL_ROLES: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

const account = async (prefix: string): Promise<string> => {
  const uid = uniqueId(prefix);
  await seedActiveAccount(uid);
  return uid;
};

/** Workspace com um ator do papel pedido (o owner é sempre semeado). */
const workspaceWithActor = async (actorRole: WorkspaceRole) => {
  const workspaceId = uniqueId("ws-mem");
  const owner = await account("owner");
  await seedWorkspace({workspaceId, ownerId: owner});
  let actor = owner;
  if (actorRole !== "owner") {
    actor = await account(actorRole);
    await seedMember(workspaceId, actor, actorRole);
  }
  return {workspaceId, owner, actor};
};

const addTarget = async (workspaceId: string, role: WorkspaceRole) => {
  const uid = await account(`target-${role}`);
  await seedMember(workspaceId, uid, role);
  return uid;
};

test("changeWorkspaceMemberRole segue a matriz D-04 para toda combinação", async () => {
  for (const actorRole of ALL_ROLES) {
    const {workspaceId, actor} = await workspaceWithActor(actorRole);
    for (const from of ["admin", "member", "viewer"] as const) {
      for (const to of MANAGEABLE_ROLES) {
        const target = await addTarget(workspaceId, from);
        const promise = call(changeWorkspaceMemberRole, actor, {
          workspaceId,
          memberId: target,
          role: to,
        });
        if (canChangeRole(actorRole, from, to)) {
          await promise;
          assert.equal((await memberOf(workspaceId, target))?.role, to,
            `${actorRole}: ${from}→${to}`);
        } else {
          await expectHttpsError(promise, "permission-denied");
          assert.equal((await memberOf(workspaceId, target))?.role, from,
            `${actorRole}: ${from}→${to} deveria ser negado`);
        }
      }
    }
  }
});

test("matriz esperada: admin não gere admin; member e viewer não gerem", () => {
  assert.equal(canChangeRole("owner", "admin", "member"), true);
  assert.equal(canChangeRole("owner", "viewer", "admin"), true);
  assert.equal(canChangeRole("admin", "member", "viewer"), true);
  assert.equal(canChangeRole("admin", "member", "admin"), false);
  assert.equal(canChangeRole("admin", "admin", "member"), false);
  assert.equal(canChangeRole("member", "viewer", "member"), false);
  assert.equal(canRemove("admin", "admin"), false);
  assert.equal(canRemove("owner", "admin"), true);
  assert.equal(canRemove("owner", "owner"), false);
});

test("ninguém altera o próprio papel nem o do owner", async () => {
  const {workspaceId, owner, actor: adminUid} = await workspaceWithActor("admin");
  await expectHttpsError(
    call(changeWorkspaceMemberRole, adminUid, {
      workspaceId,
      memberId: adminUid,
      role: "member",
    }),
    "permission-denied",
  );
  await expectHttpsError(
    call(changeWorkspaceMemberRole, owner, {
      workspaceId,
      memberId: owner,
      role: "admin",
    }),
    "permission-denied",
  );
  await expectHttpsError(
    call(changeWorkspaceMemberRole, adminUid, {
      workspaceId,
      memberId: owner,
      role: "viewer",
    }),
    "permission-denied",
  );
  // `owner` não é papel atribuível por troca de papel.
  await expectHttpsError(
    call(changeWorkspaceMemberRole, owner, {
      workspaceId,
      memberId: adminUid,
      role: "owner",
    }),
    "invalid-argument",
  );
  assert.equal((await memberOf(workspaceId, owner))?.role, "owner");
  assert.equal((await memberOf(workspaceId, adminUid))?.role, "admin");
});

test("troca de papel audita exatamente uma vez e no-op não audita", async () => {
  const {workspaceId, owner} = await workspaceWithActor("owner");
  const target = await addTarget(workspaceId, "member");
  await call(changeWorkspaceMemberRole, owner, {
    workspaceId,
    memberId: target,
    role: "admin",
  });
  const noop = await call<{changed: boolean}>(changeWorkspaceMemberRole, owner, {
    workspaceId,
    memberId: target,
    role: "admin",
  });
  assert.equal(noop.changed, false);
  const events = await membershipEvents(workspaceId, "member.role_changed");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].before, {role: "member"});
  assert.deepEqual(events[0].after, {role: "admin"});
  assert.equal(events[0].actorId, owner);
  assert.equal(events[0].targetId, target);
  assert.ok(events[0].requestId);
  assert.ok(events[0].createdAt);
});

test("removeWorkspaceMember segue a matriz e é lógica", async () => {
  for (const actorRole of ALL_ROLES) {
    const {workspaceId, actor} = await workspaceWithActor(actorRole);
    for (const targetRole of ["admin", "member", "viewer"] as const) {
      const target = await addTarget(workspaceId, targetRole);
      const promise = call(removeWorkspaceMember, actor, {
        workspaceId,
        memberId: target,
      });
      if (canRemove(actorRole, targetRole)) {
        await promise;
        const member = await memberOf(workspaceId, target);
        assert.equal(member?.status, "removed", "remoção lógica");
        assert.equal(member?.removedBy, actor);
        assert.equal((await indexOf(target, workspaceId))?.status, "removed");
      } else {
        await expectHttpsError(promise, "permission-denied");
        assert.equal((await memberOf(workspaceId, target))?.status, "active");
      }
    }
  }
});

test("owner não é removível, não sai e ninguém se remove por remoção", async () => {
  const {workspaceId, owner, actor: adminUid} = await workspaceWithActor("admin");
  await expectHttpsError(
    call(removeWorkspaceMember, adminUid, {workspaceId, memberId: owner}),
    "permission-denied",
  );
  await expectHttpsError(
    call(removeWorkspaceMember, owner, {workspaceId, memberId: owner}),
    "permission-denied",
  );
  await expectHttpsError(
    call(leaveWorkspace, owner, {workspaceId}),
    "permission-denied",
    {message: /Transfira a titularidade/},
  );
  assert.equal((await memberOf(workspaceId, owner))?.status, "active");
  assert.equal((await memberOf(workspaceId, owner))?.role, "owner");
});

test("membro removido perde o acesso na chamada seguinte", async () => {
  const {workspaceId, owner, actor: adminUid} = await workspaceWithActor("admin");
  await call(removeWorkspaceMember, owner, {workspaceId, memberId: adminUid});
  await expectHttpsError(
    call(updateWorkspaceSettings, adminUid, {workspaceId, name: "Depois"}),
    "permission-denied",
  );
  const repeated = await call<{changed: boolean}>(removeWorkspaceMember, owner, {
    workspaceId,
    memberId: adminUid,
  });
  assert.equal(repeated.changed, false);
  assert.equal(
    (await membershipEvents(workspaceId, "member.removed")).length,
    1,
  );
});

test("leaveWorkspace: admin, member e viewer saem; repetir é no-op", async () => {
  for (const role of ["admin", "member", "viewer"] as const) {
    const {workspaceId, actor} = await workspaceWithActor(role);
    await call(leaveWorkspace, actor, {workspaceId});
    const member = await memberOf(workspaceId, actor);
    assert.equal(member?.status, "removed");
    assert.equal(member?.removedBy, actor);
    assert.equal((await indexOf(actor, workspaceId))?.status, "removed");
    const again = await call<{changed: boolean}>(leaveWorkspace, actor, {
      workspaceId,
    });
    assert.equal(again.changed, false);
    assert.equal(
      (await membershipEvents(workspaceId, "member.left")).length,
      1,
    );
  }
});

test("tenant A não gere membros de B, e B não gere A", async () => {
  const a = await workspaceWithActor("owner");
  const b = await workspaceWithActor("owner");
  const targetA = await addTarget(a.workspaceId, "member");
  const targetB = await addTarget(b.workspaceId, "member");
  await expectHttpsError(
    call(removeWorkspaceMember, a.owner, {
      workspaceId: b.workspaceId,
      memberId: targetB,
    }),
    "permission-denied",
  );
  await expectHttpsError(
    call(changeWorkspaceMemberRole, b.owner, {
      workspaceId: a.workspaceId,
      memberId: targetA,
      role: "viewer",
    }),
    "permission-denied",
  );
  // Alvo de outro tenant, workspace do próprio ator: o alvo não existe aqui.
  await expectHttpsError(
    call(removeWorkspaceMember, a.owner, {
      workspaceId: a.workspaceId,
      memberId: targetB,
    }),
    "not-found",
  );
  assert.equal((await memberOf(b.workspaceId, targetB))?.status, "active");
  assert.equal((await memberOf(a.workspaceId, targetA))?.role, "member");
});

test("papel forjado e workspaceId com barra são recusados", async () => {
  const {workspaceId, actor: memberUid} = await workspaceWithActor("member");
  const target = await addTarget(workspaceId, "viewer");
  await expectHttpsError(
    call(removeWorkspaceMember, memberUid, {
      workspaceId,
      memberId: target,
      role: "owner",
    }),
    "invalid-argument",
  );
  await expectHttpsError(
    call(removeWorkspaceMember, memberUid, {
      workspaceId,
      memberId: target,
      actorRole: "owner",
    }),
    "invalid-argument",
  );
  for (const forged of [
    `${workspaceId}/members/${memberUid}`,
    "../outro",
    " ",
    "",
    "__reserved__",
  ]) {
    await expectHttpsError(
      call(removeWorkspaceMember, memberUid, {
        workspaceId: forged,
        memberId: target,
      }),
      "invalid-argument",
    );
  }
  await expectHttpsError(
    call(removeWorkspaceMember, memberUid, {
      workspaceId,
      memberId: `${target}/x`,
    }),
    "invalid-argument",
  );
  assert.equal((await memberOf(workspaceId, target))?.status, "active");
});

test("ator rebaixado ou removido entre a pré-checagem e a transação é recusado", async () => {
  const {workspaceId, actor: adminUid} = await workspaceWithActor("admin");
  const target = await addTarget(workspaceId, "member");
  const staleActor = {uid: adminUid, workspaceId, role: "admin" as const};

  // Rebaixado depois de a pré-checagem ter visto `admin`.
  await db().doc(`workspaces/${workspaceId}/members/${adminUid}`)
    .update({role: "viewer"});
  await assert.rejects(
    executeRemoveWorkspaceMember(staleActor, target, "req-stale-1"),
    (error: {code?: string}) => error.code === "workspace_role_denied",
  );
  assert.equal((await memberOf(workspaceId, target))?.status, "active");

  // Removido depois da pré-checagem.
  await db().doc(`workspaces/${workspaceId}/members/${adminUid}`)
    .update({role: "admin", status: "removed"});
  await assert.rejects(
    executeChangeWorkspaceMemberRole(staleActor, target, "viewer", "req-stale-2"),
    (error: {code?: string}) => error.code === "workspace_membership_required",
  );
  assert.equal((await memberOf(workspaceId, target))?.role, "member");
  assert.equal(
    (await membershipEvents(workspaceId, "member.removed")).length,
    0,
  );
});

test("trocas de papel concorrentes terminam num estado coerente e auditado", async () => {
  const {workspaceId, owner} = await workspaceWithActor("owner");
  const adminUid = await addTarget(workspaceId, "admin");
  const target = await addTarget(workspaceId, "member");
  const outcomes = await Promise.allSettled([
    call(changeWorkspaceMemberRole, owner, {
      workspaceId,
      memberId: target,
      role: "viewer",
    }),
    call(changeWorkspaceMemberRole, adminUid, {
      workspaceId,
      memberId: target,
      role: "viewer",
    }),
    call(removeWorkspaceMember, owner, {workspaceId, memberId: adminUid}),
  ]);
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      assert.equal(
        (outcome.reason as {code?: string}).code,
        "permission-denied",
      );
    }
  }
  const member = await memberOf(workspaceId, target);
  assert.equal(member?.role, "viewer");
  const changes = await membershipEvents(workspaceId, "member.role_changed");
  assert.equal(changes.length, 1, "uma única mudança efetiva auditada");
});
