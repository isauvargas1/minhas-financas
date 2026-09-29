import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";

import {ApplicationError} from "../errors";
import {
  requireFirestoreEmulator,
  seedActiveAccount,
  seedMember,
  seedWorkspace,
} from "../testSupport/kernelTestSupport";
import {
  reassertWorkspaceActor,
  resolveWorkspaceActor,
  WORKSPACE_ACCESS_DENIED_MESSAGE,
  WORKSPACE_ROLE_CHANGED_MESSAGE,
  type WorkspaceRole,
} from "../workspaceAuth";

const db = requireFirestoreEmulator();
const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

const expectCode = async (
  promise: Promise<unknown>,
  code: string,
  message?: string,
) => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApplicationError, String(error));
    assert.equal(error.code, code);
    if (message) assert.equal(error.message, message);
    assert.equal(error.details, undefined, "a recusa não expõe papel");
    return true;
  });
};

const ALL: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];

const tenant = async () => {
  const workspaceId = id("ws-auth");
  const owner = id("owner");
  const viewer = id("viewer");
  await Promise.all([seedActiveAccount(owner), seedActiveAccount(viewer)]);
  await seedWorkspace({workspaceId, ownerId: owner});
  await seedMember(workspaceId, viewer, "viewer");
  return {workspaceId, owner, viewer};
};

test("membership ativo resolve o papel persistido, inclusive viewer", async () => {
  const {workspaceId, owner, viewer} = await tenant();
  assert.deepEqual(
    await resolveWorkspaceActor(owner, workspaceId, ALL),
    {uid: owner, workspaceId, role: "owner"},
  );
  assert.equal(
    (await resolveWorkspaceActor(viewer, workspaceId, ALL)).role,
    "viewer",
  );
  await expectCode(
    resolveWorkspaceActor(viewer, workspaceId, ["owner", "admin", "member"]),
    "workspace_role_denied",
  );
});

test("tenant A não acessa B e não descobre se B existe", async () => {
  const a = await tenant();
  const b = await tenant();
  await expectCode(
    resolveWorkspaceActor(a.owner, b.workspaceId, ALL),
    "workspace_membership_required",
    WORKSPACE_ACCESS_DENIED_MESSAGE,
  );
  await expectCode(
    resolveWorkspaceActor(b.owner, a.workspaceId, ALL),
    "workspace_membership_required",
    WORKSPACE_ACCESS_DENIED_MESSAGE,
  );
  // Workspace inexistente: mesma resposta que o de outro tenant.
  await expectCode(
    resolveWorkspaceActor(a.owner, id("nao-existe"), ALL),
    "workspace_membership_required",
    WORKSPACE_ACCESS_DENIED_MESSAGE,
  );
});

test("ownerId sem membership não autoriza (sem fallback)", async () => {
  const workspaceId = id("ws-ownerid");
  const uid = id("ownerid-only");
  await seedActiveAccount(uid);
  await db.doc(`workspaces/${workspaceId}`).set({
    name: "Sem membership",
    type: "PF",
    ownerId: uid,
    status: "active",
  });
  await expectCode(
    resolveWorkspaceActor(uid, workspaceId, ALL),
    "workspace_membership_required",
  );
  // Membership inativo do ownerId também não autoriza.
  await seedMember(workspaceId, uid, "owner", "removed");
  await expectCode(
    resolveWorkspaceActor(uid, workspaceId, ALL),
    "workspace_membership_required",
  );
});

test("membro removido, conta suspensa, sem perfil e workspace arquivado", async () => {
  const {workspaceId, owner, viewer} = await tenant();
  await db.doc(`workspaces/${workspaceId}/members/${viewer}`)
    .update({status: "removed"});
  await expectCode(
    resolveWorkspaceActor(viewer, workspaceId, ALL),
    "workspace_membership_required",
  );

  const noProfile = id("no-profile");
  await seedMember(workspaceId, noProfile, "member");
  await expectCode(
    resolveWorkspaceActor(noProfile, workspaceId, ALL),
    "account_not_initialized",
  );

  await db.doc(`users/${owner}`).update({status: "suspended"});
  await expectCode(resolveWorkspaceActor(owner, workspaceId, ALL), "account_suspended");
  await db.doc(`users/${owner}`).update({status: "active"});

  await db.doc(`workspaces/${workspaceId}`).update({status: "archived"});
  await expectCode(resolveWorkspaceActor(owner, workspaceId, ALL), "workspace_archived");
});

test("IDs com barra, vazios ou reservados são recusados antes da leitura", async () => {
  const {workspaceId, owner} = await tenant();
  for (const forged of [
    `${workspaceId}/members/${owner}`, "", " ", ".", "..", "__x__",
  ]) {
    await expectCode(resolveWorkspaceActor(owner, forged, ALL), "invalid_payload");
  }
  await expectCode(
    resolveWorkspaceActor(`${owner}/x`, workspaceId, ALL),
    "invalid_payload",
  );
});

test("releitura transacional detecta rebaixamento e remoção", async () => {
  const {workspaceId, owner} = await tenant();
  const adminUid = id("admin");
  await seedActiveAccount(adminUid);
  await seedMember(workspaceId, adminUid, "admin");
  const actor = await resolveWorkspaceActor(adminUid, workspaceId, ALL);

  await db.doc(`workspaces/${workspaceId}/members/${adminUid}`)
    .update({role: "member"});
  await expectCode(
    db.runTransaction((transaction) => reassertWorkspaceActor(transaction, actor)),
    "workspace_role_denied",
    WORKSPACE_ROLE_CHANGED_MESSAGE,
  );
  await db.doc(`workspaces/${workspaceId}/members/${adminUid}`)
    .update({role: "admin", status: "removed"});
  await expectCode(
    db.runTransaction((transaction) => reassertWorkspaceActor(transaction, actor)),
    "workspace_membership_required",
  );
  const ownerActor = await resolveWorkspaceActor(owner, workspaceId, ALL);
  const reread = await db.runTransaction((transaction) =>
    reassertWorkspaceActor(transaction, ownerActor, ["owner"]));
  assert.equal(reread.role, "owner");
  assert.equal(reread.workspace.status, "active");
});
