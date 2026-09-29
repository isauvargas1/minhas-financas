import assert from "node:assert/strict";
import test from "node:test";

import * as admin from "firebase-admin";
import {Transaction} from "firebase-admin/firestore";

import {
  requireFirestoreEmulator,
  seedActiveAccount,
  testEmailFor,
} from "../../shared/testSupport/kernelTestSupport";
import {
  archiveWorkspace,
  bootstrapAccount,
  leaveWorkspace,
  updateWorkspaceSettings,
} from "../callables";
import {executeBootstrapAccount} from "../lifecycle";
import {PERSONAL_WORKSPACE_NAME} from "../model";
import {suspendAccount, PLATFORM_AUDIT_COLLECTION} from "../suspension";
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

interface BootstrapResult {
  created: boolean;
  workspaceId: string | null;
}

const indexEntries = async (uid: string) =>
  (await db().collection(`users/${uid}/workspaces`).get()).docs;

test("bootstrapAccount exige autenticação e provedor Google", async () => {
  await expectHttpsError(call(bootstrapAccount, null, {}), "unauthenticated");
  const uid = uniqueId("boot-provider");
  await expectHttpsError(
    call(bootstrapAccount, uid, {}, {sign_in_provider: "password"}),
    "unauthenticated",
  );
  await expectHttpsError(
    call(bootstrapAccount, uid, {}, {sign_in_provider: "anonymous"}),
    "unauthenticated",
  );
  assert.equal((await db().doc(`users/${uid}`).get()).exists, false);
});

test("bootstrapAccount cria perfil, workspace pessoal, owner, " +
  "índice e auditoria", async () => {
  const uid = uniqueId("boot-new");
  // E-mail não verificado é aceito aqui (D-06); a identidade vem do token.
  const result = await call<BootstrapResult>(bootstrapAccount, uid, {}, {
    email_verified: false,
  });
  assert.equal(result.created, true);
  assert.ok(result.workspaceId);
  const workspaceId = result.workspaceId as string;

  const profile = (await db().doc(`users/${uid}`).get()).data();
  assert.ok(profile);
  assert.deepEqual(Object.keys(profile).sort(), [
    "createdAt", "displayName", "email", "photoURL", "status", "uid",
    "updatedAt",
  ]);
  assert.equal(profile.uid, uid);
  assert.equal(profile.email, testEmailFor(uid));
  assert.equal(profile.status, "active");

  const workspace = (await db().doc(`workspaces/${workspaceId}`).get()).data();
  assert.equal(workspace?.type, "PF");
  assert.equal(workspace?.name, PERSONAL_WORKSPACE_NAME);
  assert.equal(workspace?.status, "active");
  assert.equal(workspace?.ownerId, uid);
  assert.equal(workspace?.currency, "BRL");

  const member = await memberOf(workspaceId, uid);
  assert.equal(member?.role, "owner");
  assert.equal(member?.status, "active");
  assert.equal(member?.email, testEmailFor(uid));

  const index = await indexOf(uid, workspaceId);
  assert.equal(index?.status, "active");
  assert.equal(index?.workspaceStatus, "active");
  assert.equal(index?.name, PERSONAL_WORKSPACE_NAME);
  assert.equal(index?.type, "PF");
  assert.equal("role" in (index ?? {}), false, "o índice não guarda papel");

  assert.equal(
    (await membershipEvents(workspaceId, "account.bootstrapped")).length,
    1,
  );
  assert.equal(
    (await membershipEvents(workspaceId, "workspace.created")).length,
    1,
  );
});

test("bootstrapAccount repetido é leitura pura: nada é duplicado", async () => {
  const uid = uniqueId("boot-replay");
  const first = await call<BootstrapResult>(bootstrapAccount, uid, {});
  const second = await call<BootstrapResult>(bootstrapAccount, uid, {});
  assert.equal(first.created, true);
  assert.deepEqual(second, {created: false, workspaceId: null});
  assert.equal((await indexEntries(uid)).length, 1);
  const workspaceId = first.workspaceId as string;
  assert.equal((await membershipEvents(workspaceId)).length, 2);
});

test("bootstrapAccount concorrente cria exatamente um de cada", async () => {
  const uid = uniqueId("boot-race");
  const results = await Promise.all(
    Array.from({length: 5}, () => call<BootstrapResult>(bootstrapAccount, uid, {})),
  );
  assert.equal(results.filter((result) => result.created).length, 1);
  const entries = await indexEntries(uid);
  assert.equal(entries.length, 1, "um único workspace no índice");
  const workspaceId = entries[0].id;
  const owned = await db().collection("workspaces")
    .where("ownerId", "==", uid).get();
  assert.equal(owned.size, 1, "um único workspace criado");
  const members = await db().collection(`workspaces/${workspaceId}/members`)
    .get();
  assert.equal(members.size, 1);
  assert.equal(
    (await membershipEvents(workspaceId, "account.bootstrapped")).length,
    1,
  );
});

test("bootstrapAccount recusa payload com campos do cliente", async () => {
  const uid = uniqueId("boot-strict");
  await expectHttpsError(
    call(bootstrapAccount, uid, {ownerId: "outro", email: "x@y.z"}),
    "invalid-argument",
  );
  assert.equal((await db().doc(`users/${uid}`).get()).exists, false);
});

test("falha no meio do bootstrap não deixa estado parcial", async () => {
  const uid = uniqueId("boot-fault");
  const originalCreate = Transaction.prototype.create;
  let creates = 0;
  // Injeção de falha: a terceira criação da transação (depois do perfil e do
  // workspace) falha. O commit não acontece; nada pode ter sido gravado.
  const faulty = {
    create(this: Transaction, ...args: Parameters<typeof originalCreate>) {
      creates += 1;
      if (creates === 3) throw new Error("falha injetada");
      return originalCreate.apply(this, args);
    },
  };
  Transaction.prototype.create = faulty.create as typeof originalCreate;
  try {
    await assert.rejects(executeBootstrapAccount({
      uid,
      email: testEmailFor(uid),
      emailVerified: true,
      authTime: null,
      signInProvider: "google.com",
      displayName: null,
      photoURL: null,
    }, "request-fault"), /falha injetada/);
  } finally {
    Transaction.prototype.create = originalCreate;
  }
  assert.equal((await db().doc(`users/${uid}`).get()).exists, false);
  assert.equal((await indexEntries(uid)).length, 0);
  const owned = await db().collection("workspaces")
    .where("ownerId", "==", uid).get();
  assert.equal(owned.size, 0);
});

test("conta sem nenhum workspace ativo recebe um novo espaço pessoal", async () => {
  const uid = uniqueId("boot-heal");
  const first = await call<BootstrapResult>(bootstrapAccount, uid, {});
  await call(archiveWorkspace, uid, {workspaceId: first.workspaceId});
  const healed = await call<BootstrapResult>(bootstrapAccount, uid, {});
  assert.equal(healed.created, true);
  assert.notEqual(healed.workspaceId, first.workspaceId);
  const events = await membershipEvents(
    healed.workspaceId as string,
    "workspace.created",
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, "personal_workspace_restored");
  assert.equal(
    (await membershipEvents(healed.workspaceId as string, "account.bootstrapped"))
      .length,
    0,
  );
});

test("perfil sem status é inicializado e preserva campos do backend", async () => {
  // P2A: o plano não vive mais no perfil (o webhook não cria `users/{uid}`);
  // o que se preserva aqui é campo server-owned que não vem do token.
  const uid = uniqueId("boot-nostatus");
  await db().doc(`users/${uid}`).set({isAdmin: true});
  const result = await call<BootstrapResult>(bootstrapAccount, uid, {});
  assert.equal(result.created, true);
  const profile = (await db().doc(`users/${uid}`).get()).data();
  assert.equal(profile?.status, "active");
  assert.equal(profile?.isAdmin, true, "campos do backend são preservados");
  assert.equal(profile?.planId, undefined);
  const billing = (await db().doc(`billing_accounts/${uid}`).get()).data();
  assert.equal(billing?.planId, "free");
});

test("conta suspensa é recusada e nada é criado", async () => {
  const uid = uniqueId("boot-suspended");
  await seedActiveAccount(uid, {status: "suspended"});
  await expectHttpsError(
    call(bootstrapAccount, uid, {}),
    "permission-denied",
    {reason: "account_suspended"},
  );
  assert.equal((await indexEntries(uid)).length, 0);
});

test("suspensão: status, Auth desativado, sessões revogadas e auditoria", async () => {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    throw new Error("FIREBASE_AUTH_EMULATOR_HOST é obrigatório.");
  }
  const uid = uniqueId("suspend");
  await admin.auth().createUser({uid, email: testEmailFor(uid)});
  const {workspaceId} = await call<BootstrapResult>(bootstrapAccount, uid, {});

  const before = await admin.auth().getUser(uid);
  const first = await suspendAccount({
    uid,
    actorId: "platform-operator",
    reason: "Teste de suspensão",
    requestId: "req-suspend-1",
  });
  assert.equal(first.changed, true);

  const profile = (await db().doc(`users/${uid}`).get()).data();
  assert.equal(profile?.status, "suspended");
  assert.equal(profile?.suspendedBy, "platform-operator");
  const user = await admin.auth().getUser(uid);
  assert.equal(user.disabled, true);
  assert.ok(user.tokensValidAfterTime);
  assert.ok(
    new Date(user.tokensValidAfterTime as string).getTime() >=
      new Date(before.metadata.creationTime).getTime(),
  );
  const audits = await db().collection(PLATFORM_AUDIT_COLLECTION)
    .where("targetId", "==", uid).get();
  assert.equal(audits.size, 1);
  assert.equal(audits.docs[0].get("operation"), "account.suspended");

  // Toda callable recusa a conta suspensa, mesmo com ID token ainda válido.
  await expectHttpsError(
    call(updateWorkspaceSettings, uid, {workspaceId, name: "Outro"}),
    "permission-denied",
    {reason: "account_suspended"},
  );
  await expectHttpsError(
    call(leaveWorkspace, uid, {workspaceId}),
    "permission-denied",
    {reason: "account_suspended"},
  );
  await expectHttpsError(
    call(bootstrapAccount, uid, {}),
    "permission-denied",
    {reason: "account_suspended"},
  );

  // Repetir é seguro: sem segunda auditoria, Auth continua desativado.
  const second = await suspendAccount({
    uid,
    actorId: "platform-operator",
    reason: "Teste de suspensão",
    requestId: "req-suspend-2",
  });
  assert.equal(second.changed, false);
  const auditsAfter = await db().collection(PLATFORM_AUDIT_COLLECTION)
    .where("targetId", "==", uid).get();
  assert.equal(auditsAfter.size, 1);
});
