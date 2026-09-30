import assert from "node:assert/strict";
import test from "node:test";

import {FieldValue} from "firebase-admin/firestore";

import {
  requireFirestoreEmulator,
  seedActiveAccount,
  seedPaidPlan,
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {
  archiveWorkspace,
  createWorkspace,
  updateWorkspaceSettings,
} from "../callables";
import {INDEX_SYNC_PAGE_SIZE, syncWorkspaceIndexEntries} from "../indexSync";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  indexOf,
  memberOf,
  membershipEvents,
  staleAuthTime,
  uniqueId,
} from "../testSupport/p1TestSupport";

requireFirestoreEmulator();

const VALID_CNPJ = "11.222.333/0001-81";

const account = async (prefix: string): Promise<string> => {
  const uid = uniqueId(prefix);
  await seedActiveAccount(uid);
  return uid;
};

/** Workspace com owner, admin, member e viewer ativos. */
const team = async (type: "PF" | "PJ" = "PJ") => {
  const workspaceId = uniqueId("ws");
  const [owner, adminUid, member, viewer] = await Promise.all([
    account("owner"), account("admin"), account("member"), account("viewer"),
  ]);
  await seedWorkspace({workspaceId, ownerId: owner, type});
  await Promise.all([
    seedMember(workspaceId, adminUid, "admin"),
    seedMember(workspaceId, member, "member"),
    seedMember(workspaceId, viewer, "viewer"),
  ]);
  return {workspaceId, owner, admin: adminUid, member, viewer};
};

test("createWorkspace cria PF e PJ com owner, índice e auditoria", async () => {
  const uid = await account("creator");
  // Dois workspaces próprios: acima do Free (P2B.1).
  await seedPaidPlan(uid, "pro");
  for (const type of ["PF", "PJ"] as const) {
    const result = await call<{workspaceId: string}>(createWorkspace, uid, {
      type,
      name: `  Espaço ${type}  `,
      ...(type === "PJ" ? {cnpj: "11222333000181"} : {}),
      idempotencyKey: idempotencyKey(),
    });
    const workspace = (await db().doc(`workspaces/${result.workspaceId}`).get())
      .data();
    assert.equal(workspace?.type, type);
    assert.equal(workspace?.name, `Espaço ${type}`);
    assert.equal(workspace?.ownerId, uid);
    assert.equal(workspace?.status, "active");
    assert.equal(workspace?.cnpj, type === "PJ" ? VALID_CNPJ : null);
    assert.equal((await memberOf(result.workspaceId, uid))?.role, "owner");
    assert.equal((await indexOf(uid, result.workspaceId))?.type, type);
    assert.equal(
      (await membershipEvents(result.workspaceId, "workspace.created")).length,
      1,
    );
  }
});

test("createWorkspace valida tipo, CNPJ e payload estrito", async () => {
  const uid = await account("creator-invalid");
  const base = {name: "Empresa", idempotencyKey: idempotencyKey()};
  await expectHttpsError(
    call(createWorkspace, uid, {...base, type: "PX"}),
    "invalid-argument",
  );
  await expectHttpsError(
    call(createWorkspace, uid, {...base, type: "PJ", cnpj: "11.222.333/0001-82"}),
    "invalid-argument",
    {message: "CNPJ inválido."},
  );
  await expectHttpsError(
    call(createWorkspace, uid, {...base, type: "PJ", cnpj: "00000000000000"}),
    "invalid-argument",
  );
  await expectHttpsError(
    call(createWorkspace, uid, {...base, type: "PF", cnpj: VALID_CNPJ}),
    "invalid-argument",
  );
  for (const extra of [
    {ownerId: "outro"}, {currency: "USD"}, {status: "archived"}, {role: "owner"},
  ]) {
    await expectHttpsError(
      call(createWorkspace, uid, {...base, type: "PF", ...extra}),
      "invalid-argument",
    );
  }
  await expectHttpsError(
    call(createWorkspace, uid, {...base, type: "PF", name: "   "}),
    "invalid-argument",
  );
  const owned = await db().collection("workspaces")
    .where("ownerId", "==", uid).get();
  assert.equal(owned.size, 0);
});

test("CNPJ não é único entre workspaces (D-22)", async () => {
  const [first, second] = await Promise.all([
    account("cnpj-a"),
    account("cnpj-b"),
  ]);
  for (const uid of [first, second]) {
    await call(createWorkspace, uid, {
      type: "PJ",
      name: "Filial",
      cnpj: VALID_CNPJ,
      idempotencyKey: idempotencyKey(),
    });
  }
});

test("createWorkspace exige e-mail verificado e conta ativa", async () => {
  const uid = await account("creator-unverified");
  await expectHttpsError(
    call(createWorkspace, uid, {
      type: "PF",
      name: "X",
      idempotencyKey: idempotencyKey(),
    }, {email_verified: false}),
    "permission-denied",
    {reason: "email_not_verified"},
  );
  const noProfile = uniqueId("no-profile");
  await expectHttpsError(
    call(createWorkspace, noProfile, {
      type: "PF",
      name: "X",
      idempotencyKey: idempotencyKey(),
    }),
    "failed-precondition",
    {reason: "account_not_initialized"},
  );
});

test("createWorkspace é idempotente pela chave e recusa conflito", async () => {
  const uid = await account("creator-idem");
  const key = idempotencyKey();
  const payload = {type: "PF", name: "Único", idempotencyKey: key};
  // As duas disputam o documento da reserva; a perdedora é repetida pelo
  // Firestore e encontra o resultado gravado (replay).
  const [first, second] = await Promise.all([
    call<{workspaceId: string}>(createWorkspace, uid, payload),
    call<{workspaceId: string}>(createWorkspace, uid, payload),
  ]);
  assert.equal(first.workspaceId, second.workspaceId);
  const replay = await call<{workspaceId: string}>(createWorkspace, uid, payload);
  assert.equal(replay.workspaceId, first.workspaceId);
  const owned = await db().collection("workspaces")
    .where("ownerId", "==", uid).get();
  assert.equal(owned.size, 1);
  await expectHttpsError(
    call(createWorkspace, uid, {...payload, name: "Outro nome"}),
    "failed-precondition",
  );
});

test("updateWorkspaceSettings: owner e admin editam; member, viewer e estranhos não", async () => {
  const {workspaceId, owner, admin, member, viewer} = await team();
  await call(updateWorkspaceSettings, owner, {workspaceId, name: "Novo nome"});
  await call(updateWorkspaceSettings, admin, {
    workspaceId,
    themeColor: "#ABCDEF",
    alertPreferences: {
      billing: false,
      accountsPayable: true,
      delinquency: true,
      lowMargin: true,
    },
  });
  const workspace = (await db().doc(`workspaces/${workspaceId}`).get()).data();
  assert.equal(workspace?.name, "Novo nome");
  assert.equal(workspace?.themeColor, "#abcdef");
  assert.equal(workspace?.alertPreferences.lowMargin, true);
  assert.equal((await indexOf(owner, workspaceId))?.name, "Novo nome");

  for (const uid of [member, viewer]) {
    await expectHttpsError(
      call(updateWorkspaceSettings, uid, {workspaceId, name: "Hack"}),
      "permission-denied",
    );
  }
  const outsider = await account("outsider");
  const other = uniqueId("ws-b");
  await seedWorkspace({workspaceId: other, ownerId: outsider});
  await expectHttpsError(
    call(updateWorkspaceSettings, outsider, {workspaceId, name: "Hack"}),
    "permission-denied",
  );
  await expectHttpsError(
    call(updateWorkspaceSettings, owner, {workspaceId: other, name: "Hack"}),
    "permission-denied",
  );
  assert.equal(
    (await db().doc(`workspaces/${workspaceId}`).get()).get("name"),
    "Novo nome",
  );
  assert.equal(
    (await membershipEvents(workspaceId, "workspace.settings_updated")).length,
    2,
  );
});

test("updateWorkspaceSettings: allowlist estrita e CNPJ validado", async () => {
  const {workspaceId, owner} = await team("PJ");
  for (const extra of [
    {ownerId: "x"}, {type: "PF"}, {status: "archived"}, {currency: "USD"},
    {planId: "pro"}, {members: []},
  ]) {
    await expectHttpsError(
      call(updateWorkspaceSettings, owner, {workspaceId, ...extra}),
      "invalid-argument",
    );
  }
  await expectHttpsError(
    call(updateWorkspaceSettings, owner, {workspaceId, cnpj: "123"}),
    "invalid-argument",
  );
  await expectHttpsError(
    call(updateWorkspaceSettings, owner, {workspaceId: "a/b", name: "x"}),
    "invalid-argument",
  );
  await call(updateWorkspaceSettings, owner, {workspaceId, cnpj: VALID_CNPJ});
  assert.equal(
    (await db().doc(`workspaces/${workspaceId}`).get()).get("cnpj"),
    VALID_CNPJ,
  );
  // Sem mudança real: nenhuma auditoria nova.
  const before = (await membershipEvents(workspaceId)).length;
  const result = await call<{updated: boolean}>(updateWorkspaceSettings, owner, {
    workspaceId,
    cnpj: "11222333000181",
  });
  assert.equal(result.updated, false);
  assert.equal((await membershipEvents(workspaceId)).length, before);
  const events = await membershipEvents(workspaceId, "workspace.settings_updated");
  assert.equal(JSON.stringify(events).includes("0001-81"), false,
    "a auditoria não copia o CNPJ");
});

test("archiveWorkspace: só owner, com e-mail verificado e login recente", async () => {
  const {workspaceId, owner, admin} = await team();
  await expectHttpsError(
    call(archiveWorkspace, admin, {workspaceId}),
    "permission-denied",
  );
  await expectHttpsError(
    call(archiveWorkspace, owner, {workspaceId}, {auth_time: staleAuthTime()}),
    "failed-precondition",
    {reason: "recent_login_required"},
  );
  await expectHttpsError(
    call(archiveWorkspace, owner, {workspaceId}, {email_verified: false}),
    "permission-denied",
    {reason: "email_not_verified"},
  );
  const first = await call<{alreadyArchived: boolean}>(archiveWorkspace, owner, {
    workspaceId,
  });
  assert.equal(first.alreadyArchived, false);
  const replay = await call<{alreadyArchived: boolean}>(archiveWorkspace, owner, {
    workspaceId,
  });
  assert.equal(replay.alreadyArchived, true);

  const workspace = await db().doc(`workspaces/${workspaceId}`).get();
  assert.ok(workspace.exists, "arquivar nunca apaga");
  assert.equal(workspace.get("status"), "archived");
  assert.equal(workspace.get("archivedBy"), owner);
  assert.equal(
    (await membershipEvents(workspaceId, "workspace.archived")).length,
    1,
  );
  assert.equal(
    (await indexOf(owner, workspaceId))?.workspaceStatus,
    "archived",
  );

  // Workspace arquivado recusa qualquer operação.
  await expectHttpsError(
    call(updateWorkspaceSettings, owner, {workspaceId, name: "Volta"}),
    "failed-precondition",
    {reason: "workspace_archived"},
  );
});

test("gatilho do índice propaga nome e arquivamento a todos os membros, por página", async () => {
  const {workspaceId, owner, admin} = await team();
  const extra = INDEX_SYNC_PAGE_SIZE + 5;
  const writer = db().bulkWriter();
  const uids = Array.from({length: extra}, (_, index) => `bulk-${workspaceId}-${index}`);
  for (const uid of uids) {
    writer.set(db().doc(`workspaces/${workspaceId}/members/${uid}`), {
      uid, role: "viewer", status: "active", joinedAt: FieldValue.serverTimestamp(),
    });
    writer.set(db().doc(`users/${uid}/workspaces/${workspaceId}`), {
      workspaceId, status: "active", name: "antigo", type: "PJ",
      workspaceStatus: "active",
    });
  }
  const removed = await account("removed");
  await seedMember(workspaceId, removed, "member", "removed");
  await writer.close();

  await call(updateWorkspaceSettings, owner, {workspaceId, name: "Renomeado"});
  const result = await syncWorkspaceIndexEntries(workspaceId);
  assert.equal(result.pages, 2);
  assert.equal(result.updated, extra + 4);
  for (const uid of [admin, uids[0], uids[extra - 1]]) {
    assert.equal((await indexOf(uid, workspaceId))?.name, "Renomeado");
  }
  // Membro removido não é tocado nem ressuscitado.
  const removedIndex = await indexOf(removed, workspaceId);
  assert.equal(removedIndex?.status, "removed");
  assert.notEqual(removedIndex?.name, "Renomeado");

  await call(archiveWorkspace, owner, {workspaceId});
  await syncWorkspaceIndexEntries(workspaceId);
  assert.equal(
    (await indexOf(admin, workspaceId))?.workspaceStatus,
    "archived",
  );
  // Idempotente: repetir não muda nada.
  await syncWorkspaceIndexEntries(workspaceId);
  assert.equal(
    (await indexOf(uids[3], workspaceId))?.workspaceStatus,
    "archived",
  );
});
