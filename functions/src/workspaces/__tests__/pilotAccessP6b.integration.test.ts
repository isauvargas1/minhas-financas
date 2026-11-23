import assert from "node:assert/strict";
import test from "node:test";

import * as firebaseAdminFirestore from "firebase-admin/firestore";
import {FieldValue} from "firebase-admin/firestore";

import {
  requireFirestoreEmulator,
  seedActiveAccount,
  seedMember,
  seedWorkspace,
  testEmailFor,
} from "../../shared/testSupport/kernelTestSupport";
import type {CallerIdentity} from "../../shared/callable";
import {isApplicationError} from "../../shared/errors";
import {
  reassertWorkspaceActor,
  requireActiveAccount,
  resolveWorkspaceActor,
} from "../../shared/workspaceAuth";
import {getAccountUsage, getWorkspaceEntitlement} from "../../billing/callables";
import {createCashTransaction} from "../../cash/callables";
import {
  DEFAULT_EXPENSE_CATEGORY_ID,
  seedDefaultCategories,
} from "../../settingsCatalog/testSupport/categorySeeds";
import {createWorkspace, updateWorkspaceSettings} from "../callables";
import {executeBootstrapAccount} from "../lifecycle";
import {PILOT_ACCESS_COLLECTION, pilotAccessDocId} from "../pilotAccess";
import {PLATFORM_AUDIT_COLLECTION} from "../suspension";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  uniqueId,
} from "../testSupport/p1TestSupport";

requireFirestoreEmulator();

/*
 * P6-B (gate G0) — a autorização de acesso do piloto é do perfil.
 *
 * Uma conta ativa só opera se `users/{uid}.accessStatus == "granted"`, gravado
 * só pelo `bootstrapAccount` na mesma transação que valida e vincula o convite.
 * Conta anterior à P6-B (perfil ativo sem o campo) e conta revogada são
 * recusadas em toda callable com `pilot_access_required`, mesmo com membership
 * ativo e ID token vigente, sem alterar nenhum dado. Os testes informam o modo
 * `invite_only` explicitamente, porque aqui o projeto é o do Emulator (que
 * abre o acesso).
 */
const GRANTED = "granted";
const REVOKED = "revoked";

const callerFor = (uid: string, overrides: Partial<CallerIdentity> = {}): CallerIdentity => ({
  uid,
  email: testEmailFor(uid),
  emailVerified: true,
  authTime: Math.floor(Date.now() / 1000),
  signInProvider: "google.com",
  displayName: "Pessoa de Teste",
  photoURL: null,
  ...overrides,
});

const inviteRef = (email: string) =>
  db().collection(PILOT_ACCESS_COLLECTION).doc(pilotAccessDocId(email));

const invite = async (email: string, extra: Record<string, unknown> = {}) =>
  inviteRef(email).set({email, status: "active", ...extra});

const inviteOf = async (email: string) => (await inviteRef(email).get());

const refusedForPilot = async (promise: Promise<unknown>) => {
  await assert.rejects(promise, (error: unknown) =>
    isApplicationError(error) && error.code === "pilot_access_required");
};

const refusedHttps = (promise: Promise<unknown>) =>
  expectHttpsError(promise, "permission-denied", {reason: "pilot_access_required"});

const profileOf = async (uid: string) => (await db().doc(`users/${uid}`).get());

const grantedEvents = async (uid: string) =>
  (await db().collection(PLATFORM_AUDIT_COLLECTION)
    .where("operation", "==", "account.access_granted")
    .where("targetId", "==", uid)
    .get()).docs;

const ownedWorkspaces = async (uid: string) =>
  (await db().collection("workspaces").where("ownerId", "==", uid).get()).docs;

const indexEntries = async (uid: string) =>
  (await db().collection(`users/${uid}/workspaces`).get()).docs;

const ACCESS_FIELDS = ["accessStatus", "accessSource", "accessInviteId", "accessGrantedAt"] as const;

/** Simula uma conta anterior à P6-B: perfil ativo, sem nenhum campo de autorização. */
const stripAccess = async (uid: string) => {
  await db().doc(`users/${uid}`).update({
    accessStatus: FieldValue.delete(),
    accessSource: FieldValue.delete(),
    accessInviteId: FieldValue.delete(),
    accessGrantedAt: FieldValue.delete(),
  });
  const profile = await profileOf(uid);
  for (const field of ACCESS_FIELDS) assert.equal(profile.get(field), undefined, field);
};

/** Conta com workspace, membership owner, categorias e a conta de caixa padrão (perfil autorizado). */
const seedOwner = async (uid: string, workspaceId = uniqueId("ws-p6b")) => {
  await seedActiveAccount(uid);
  await seedWorkspace({workspaceId, ownerId: uid});
  await seedDefaultCategories(workspaceId);
  return workspaceId;
};

const seedOldAccount = async (uid: string) => {
  const workspaceId = await seedOwner(uid);
  await stripAccess(uid);
  return workspaceId;
};

const cashPayload = (workspaceId: string, overrides: Record<string, unknown> = {}) => ({
  workspaceId,
  cashAccountId: `acc_${workspaceId}`,
  idempotencyKey: idempotencyKey(),
  type: "despesa",
  description: "Almoço de domingo",
  categoryId: DEFAULT_EXPENSE_CATEGORY_ID,
  amountCents: 4_550,
  date: "2026-09-15",
  ...overrides,
});

const defaultCashAccountOf = async (workspaceId: string): Promise<string> => {
  const accounts = await db().collection(`workspaces/${workspaceId}/cash_accounts`).limit(1).get();
  assert.equal(accounts.size, 1, "conta de caixa padrão semeada");
  return accounts.docs[0].id;
};

const createTransaction = async (uid: string, workspaceId: string, overrides: Record<string, unknown> = {}) =>
  call(createCashTransaction, uid, cashPayload(workspaceId, {
    cashAccountId: await defaultCashAccountOf(workspaceId),
    ...overrides,
  }));

const transactionCount = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/transactions`).get()).size;

/** Estado do tenant e da conta, para provar que uma recusa não alterou nada. */
const stateOf = async (uid: string, workspaceId: string): Promise<string> => {
  const documents: Array<[string, unknown]> = [];
  const collect = async (ref: firebaseAdminFirestore.DocumentReference) => {
    const snapshot = await ref.get();
    documents.push([ref.path, snapshot.exists ? snapshot.data() : null]);
    for (const subcollection of await ref.listCollections()) {
      for (const entry of (await subcollection.get()).docs) await collect(entry.ref);
    }
  };
  await collect(db().doc(`workspaces/${workspaceId}`));
  await collect(db().doc(`users/${uid}`));
  await collect(db().doc(`billing_accounts/${uid}`));
  documents.sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(documents);
};

test("conta antiga (perfil ativo sem accessStatus) é recusada em toda callable e nada é alterado", async () => {
  const uid = uniqueId("p6b-antiga");
  const workspaceId = await seedOldAccount(uid);
  const before = await stateOf(uid, workspaceId);

  // Leitura de dados de workspace.
  await refusedHttps(call(getWorkspaceEntitlement, uid, {workspaceId}));
  // Escrita financeira.
  await refusedHttps(createTransaction(uid, workspaceId));
  // Escrita de workspace.
  await refusedHttps(call(updateWorkspaceSettings, uid, {workspaceId, name: "Outro nome"}));
  // Sem workspace.
  await refusedHttps(call(createWorkspace, uid, {
    type: "PF", name: "Segundo", idempotencyKey: idempotencyKey(),
  }));
  await refusedHttps(call(getAccountUsage, uid, {}));

  // O kernel recusa antes das callables.
  await refusedForPilot(requireActiveAccount(uid));
  await refusedForPilot(resolveWorkspaceActor(uid, workspaceId, ["owner"]));
  await refusedForPilot(db().runTransaction((transaction) =>
    reassertWorkspaceActor(transaction, {uid, workspaceId}, ["owner"])));

  assert.equal(await stateOf(uid, workspaceId), before, "nenhum dado alterado");
  assert.equal(await transactionCount(workspaceId), 0);
  assert.equal((await ownedWorkspaces(uid)).length, 1);
});

test("conta antiga sem convite: o bootstrap é recusado e nada muda", async () => {
  const uid = uniqueId("p6b-antiga-sem-convite");
  const workspaceId = await seedOldAccount(uid);
  const before = await stateOf(uid, workspaceId);

  await refusedForPilot(executeBootstrapAccount(callerFor(uid), uniqueId("req"), "invite_only"));

  const profile = await profileOf(uid);
  assert.equal(profile.get("accessStatus"), undefined, "perfil continua sem accessStatus");
  assert.equal((await ownedWorkspaces(uid)).length, 1, "nenhum workspace novo");
  assert.equal((await indexEntries(uid)).length, 1);
  assert.equal((await grantedEvents(uid)).length, 0, "nenhum evento account.access_granted");
  assert.equal(await stateOf(uid, workspaceId), before);
  await refusedHttps(call(getWorkspaceEntitlement, uid, {workspaceId}));
});

test("conta antiga com convite ativo e e-mail verificado: o bootstrap autoriza, vincula o convite e audita", async () => {
  const owner = uniqueId("p6b-antiga-convite");
  const viewer = uniqueId("p6b-antiga-leitor");
  const workspaceId = await seedOldAccount(owner);
  await seedActiveAccount(viewer, {accessStatus: GRANTED});
  await seedMember(workspaceId, viewer, "viewer");
  const email = testEmailFor(owner);
  await invite(email);
  const workspacesBefore = (await ownedWorkspaces(owner)).length;

  const result = await executeBootstrapAccount(callerFor(owner), uniqueId("req"), "invite_only");
  assert.equal(result.created, false, "conta antiga reaproveita o workspace que já tem");
  assert.equal(result.workspaceId, null);

  const profile = await profileOf(owner);
  assert.equal(profile.get("accessStatus"), GRANTED);
  assert.equal(profile.get("accessSource"), "pilot_invite");
  assert.equal(profile.get("accessInviteId"), pilotAccessDocId(email));
  assert.ok(profile.get("accessGrantedAt"), "accessGrantedAt gravado");
  assert.equal(profile.get("status"), "active");

  const entry = await inviteOf(email);
  assert.equal(entry.get("uid"), owner);
  assert.ok(entry.get("usadoEm"), "usadoEm gravado no mesmo commit");

  const events = await grantedEvents(owner);
  assert.equal(events.length, 1);
  const event = events[0].data();
  assert.equal(event.actorId, owner);
  assert.equal(event.targetId, owner);
  assert.deepEqual(event.before, {accessStatus: null});
  assert.equal(event.after.accessStatus, GRANTED);
  assert.equal(event.after.accessSource, "pilot_invite");
  assert.equal(event.after.accessInviteId, pilotAccessDocId(email));
  assert.equal(JSON.stringify(event).toLowerCase().includes(email.toLowerCase()), false,
    "o evento de auditoria não carrega o e-mail");

  // As callables voltam a funcionar conforme o papel.
  assert.equal((await ownedWorkspaces(owner)).length, workspacesBefore, "nenhum workspace novo");
  await call(getWorkspaceEntitlement, owner, {workspaceId});
  await createTransaction(owner, workspaceId);
  assert.equal(await transactionCount(workspaceId), 1);
  await call(getWorkspaceEntitlement, viewer, {workspaceId});
  await expectHttpsError(createTransaction(viewer, workspaceId), "permission-denied", {message: "Seu papel neste espaço de trabalho não permite esta operação."});
  assert.equal(await transactionCount(workspaceId), 1, "o leitor não escreveu");
});

test("repetir o bootstrap é idempotente: sem evento, sem workspace, sem mudar accessGrantedAt nem usadoEm", async () => {
  const uid = uniqueId("p6b-idempotente");
  const workspaceId = await seedOldAccount(uid);
  const email = testEmailFor(uid);
  await invite(email);
  await executeBootstrapAccount(callerFor(uid), uniqueId("req"), "invite_only");
  const profile = await profileOf(uid);
  const entry = await inviteOf(email);

  // O convite deixa de valer: conta já autorizada não relê o convite.
  await inviteRef(email).update({status: REVOKED});
  const repeated = await executeBootstrapAccount(callerFor(uid), uniqueId("req"), "invite_only");
  assert.equal(repeated.created, false);

  const after = await profileOf(uid);
  assert.equal(after.get("accessStatus"), GRANTED);
  assert.ok((after.get("accessGrantedAt") as firebaseAdminFirestore.Timestamp)
    .isEqual(profile.get("accessGrantedAt") as firebaseAdminFirestore.Timestamp), "accessGrantedAt não muda");
  assert.ok((await inviteOf(email)).get("usadoEm").isEqual(entry.get("usadoEm")), "usadoEm não muda");
  assert.equal((await grantedEvents(uid)).length, 1, "nenhum evento novo");
  assert.equal((await ownedWorkspaces(uid)).length, 1);
  assert.equal((await indexEntries(uid)).length, 1);
  await call(getWorkspaceEntitlement, uid, {workspaceId});
});

test("segundo uid com o mesmo e-mail e convite é recusado, nada é criado e o convite fica com o primeiro", async () => {
  const primeiro = uniqueId("p6b-primeiro");
  const email = testEmailFor(primeiro);
  await invite(email);
  await executeBootstrapAccount(callerFor(primeiro), uniqueId("req"), "invite_only");
  const winnerEvents = (await grantedEvents(primeiro)).length;

  const segundo = uniqueId("p6b-segundo");
  await refusedForPilot(executeBootstrapAccount(callerFor(segundo, {email}), uniqueId("req"), "invite_only"));
  assert.equal((await profileOf(segundo)).exists, false);
  assert.equal((await indexEntries(segundo)).length, 0);
  assert.equal((await ownedWorkspaces(segundo)).length, 0);
  assert.equal((await grantedEvents(segundo)).length, 0);
  assert.equal((await inviteOf(email)).get("uid"), primeiro);
  assert.equal((await grantedEvents(primeiro)).length, winnerEvents);

  // Mesmo se o segundo uid for uma conta antiga já existente.
  const antigo = uniqueId("p6b-segundo-antigo");
  const workspaceId = await seedOldAccount(antigo);
  await db().doc(`users/${antigo}`).update({email});
  await refusedForPilot(executeBootstrapAccount(callerFor(antigo, {email}), uniqueId("req"), "invite_only"));
  assert.equal((await profileOf(antigo)).get("accessStatus"), undefined);
  assert.equal((await grantedEvents(antigo)).length, 0);
  assert.equal((await inviteOf(email)).get("uid"), primeiro);
  await refusedHttps(call(getWorkspaceEntitlement, antigo, {workspaceId}));
});

test("e-mail não verificado, convite revogado e ausência de perfil e de convite não escrevem nada", async () => {
  const naoVerificado = uniqueId("p6b-nao-verificado");
  await invite(testEmailFor(naoVerificado));
  await refusedForPilot(executeBootstrapAccount(
    callerFor(naoVerificado, {emailVerified: false}), uniqueId("req"), "invite_only"));
  assert.equal((await profileOf(naoVerificado)).exists, false);
  assert.equal((await inviteOf(testEmailFor(naoVerificado))).get("uid"), undefined, "convite não vinculado");

  const antigoNaoVerificado = uniqueId("p6b-antigo-nao-verificado");
  const workspaceId = await seedOldAccount(antigoNaoVerificado);
  await invite(testEmailFor(antigoNaoVerificado));
  const before = await stateOf(antigoNaoVerificado, workspaceId);
  await refusedForPilot(executeBootstrapAccount(
    callerFor(antigoNaoVerificado, {emailVerified: false}), uniqueId("req"), "invite_only"));
  assert.equal(await stateOf(antigoNaoVerificado, workspaceId), before);
  assert.equal((await grantedEvents(antigoNaoVerificado)).length, 0);

  const revogado = uniqueId("p6b-convite-revogado");
  await invite(testEmailFor(revogado), {status: REVOKED});
  await refusedForPilot(executeBootstrapAccount(callerFor(revogado), uniqueId("req"), "invite_only"));
  assert.equal((await profileOf(revogado)).exists, false);
  assert.equal((await indexEntries(revogado)).length, 0);
  assert.equal((await inviteOf(testEmailFor(revogado))).get("uid"), undefined);

  const semNada = uniqueId("p6b-sem-nada");
  await refusedForPilot(executeBootstrapAccount(callerFor(semNada), uniqueId("req"), "invite_only"));
  assert.equal((await profileOf(semNada)).exists, false);
  assert.equal((await indexEntries(semNada)).length, 0);
  assert.equal((await ownedWorkspaces(semNada)).length, 0);
  assert.equal((await grantedEvents(semNada)).length, 0);
  assert.equal((await db().doc(`billing_accounts/${semNada}`).get()).exists, false);
});

test("concorrência: duas chamadas simultâneas do mesmo uid criam um workspace, um evento e um vínculo", async () => {
  const uid = uniqueId("p6b-concorrente");
  const email = testEmailFor(uid);
  await invite(email);

  const results = await Promise.allSettled([
    executeBootstrapAccount(callerFor(uid), uniqueId("req-a"), "invite_only"),
    executeBootstrapAccount(callerFor(uid), uniqueId("req-b"), "invite_only"),
  ]);
  for (const result of results) {
    assert.equal(result.status, "fulfilled", result.status === "rejected" ? String(result.reason) : "");
  }
  const created = results.filter((result) =>
    result.status === "fulfilled" && result.value.created === true);
  assert.equal(created.length, 1, "só uma chamada cria");

  assert.equal((await ownedWorkspaces(uid)).length, 1);
  assert.equal((await indexEntries(uid)).length, 1);
  assert.equal((await grantedEvents(uid)).length, 1);
  assert.equal((await inviteOf(email)).get("uid"), uid);
  assert.equal((await profileOf(uid)).get("accessStatus"), GRANTED);
});

test("concorrência: dois uids com o mesmo e-mail e convite — exatamente um é autorizado", async () => {
  const a = uniqueId("p6b-corrida-a");
  const b = uniqueId("p6b-corrida-b");
  const email = testEmailFor(a);
  await invite(email);

  const results = await Promise.allSettled([
    executeBootstrapAccount(callerFor(a), uniqueId("req-a"), "invite_only"),
    executeBootstrapAccount(callerFor(b, {email}), uniqueId("req-b"), "invite_only"),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1, "exatamente um autorizado");
  assert.equal(rejected.length, 1);
  const reason = (rejected[0] as PromiseRejectedResult).reason;
  assert.ok(isApplicationError(reason) && reason.code === "pilot_access_required", String(reason));

  const winner = results[0].status === "fulfilled" ? a : b;
  const loser = winner === a ? b : a;
  assert.equal((await inviteOf(email)).get("uid"), winner);
  assert.equal((await profileOf(winner)).get("accessStatus"), GRANTED);
  assert.equal((await profileOf(loser)).exists, false);
  assert.equal((await ownedWorkspaces(winner)).length, 1);
  assert.equal((await ownedWorkspaces(loser)).length, 0);
  assert.equal((await grantedEvents(winner)).length, 1);
  assert.equal((await grantedEvents(loser)).length, 0);
});

test("troca de e-mail: a conta autorizada continua autorizada e o convite segue com o uid original", async () => {
  const uid = uniqueId("p6b-troca-email");
  const email = testEmailFor(uid);
  await invite(email);
  const first = await executeBootstrapAccount(callerFor(uid), uniqueId("req"), "invite_only");
  assert.equal(first.created, true);
  const workspaceId = first.workspaceId as string;
  const novoEmail = `novo-${email}`;

  const again = await executeBootstrapAccount(
    callerFor(uid, {email: novoEmail}), uniqueId("req"), "invite_only");
  assert.equal(again.created, false);

  const profile = await profileOf(uid);
  assert.equal(profile.get("accessStatus"), GRANTED);
  assert.equal(profile.get("email"), novoEmail);
  assert.equal((await inviteOf(email)).get("uid"), uid, "o convite segue vinculado ao uid original");
  assert.equal((await inviteOf(novoEmail)).exists, false);
  assert.equal((await grantedEvents(uid)).length, 1, "nenhum evento novo");
  assert.equal((await ownedWorkspaces(uid)).length, 1);
  await call(getWorkspaceEntitlement, uid, {workspaceId}, {email: novoEmail});
});

test("revogação com ID token vigente: a mesma identidade é recusada em leitura e escrita e os dados ficam idênticos", async () => {
  const uid = uniqueId("p6b-revogada");
  const workspaceId = await seedOwner(uid);
  const email = testEmailFor(uid);
  await invite(email, {uid});
  await createTransaction(uid, workspaceId);
  await call(getWorkspaceEntitlement, uid, {workspaceId});
  const before = await stateOf(uid, workspaceId);

  // Commit da revogação (a ferramenta grava o perfil e revoga o convite).
  await db().doc(`users/${uid}`).update({accessStatus: REVOKED});
  await inviteRef(email).update({status: REVOKED});

  await refusedHttps(call(getWorkspaceEntitlement, uid, {workspaceId}));
  await refusedHttps(createTransaction(uid, workspaceId));
  await refusedHttps(call(updateWorkspaceSettings, uid, {workspaceId, name: "Depois da revogação"}));
  await refusedHttps(call(getAccountUsage, uid, {}));
  await refusedForPilot(resolveWorkspaceActor(uid, workspaceId, ["owner"]));
  assert.equal(await transactionCount(workspaceId), 1);

  // O bootstrap também recusa: convite revogado em `invite_only` e perfil revogado em `open_emulator`.
  await refusedForPilot(executeBootstrapAccount(callerFor(uid), uniqueId("req"), "invite_only"));
  await refusedForPilot(executeBootstrapAccount(callerFor(uid), uniqueId("req"), "open_emulator"));

  const profile = await profileOf(uid);
  assert.equal(profile.get("accessStatus"), REVOKED);
  assert.equal((await grantedEvents(uid)).length, 0);
  assert.equal((await ownedWorkspaces(uid)).length, 1);
  const expected = JSON.parse(before) as Array<[string, unknown]>;
  const current = JSON.parse(await stateOf(uid, workspaceId)) as Array<[string, unknown]>;
  const strip = (entries: Array<[string, unknown]>) => entries.map(([path, data]) => {
    if (path !== `users/${uid}`) return [path, data];
    // Só `accessStatus` mudou, por escolha do teste (a revogação).
    const rest = {...(data as Record<string, unknown>)};
    delete rest.accessStatus;
    return [path, rest];
  });
  assert.deepEqual(strip(current), strip(expected), "dados financeiros idênticos");
});

test("reentrada: perfil revogado e ativo com convite reativado do mesmo uid é reautorizado; suspenso continua suspenso", async () => {
  const uid = uniqueId("p6b-reentrada");
  const workspaceId = await seedOwner(uid);
  const email = testEmailFor(uid);
  await invite(email, {uid});
  await db().doc(`users/${uid}`).update({accessStatus: REVOKED});
  await refusedHttps(call(getWorkspaceEntitlement, uid, {workspaceId}));

  const result = await executeBootstrapAccount(callerFor(uid), uniqueId("req"), "invite_only");
  assert.equal(result.created, false);
  const profile = await profileOf(uid);
  assert.equal(profile.get("accessStatus"), GRANTED);
  assert.equal(profile.get("accessSource"), "pilot_invite");
  assert.equal((await inviteOf(email)).get("uid"), uid);
  const events = await grantedEvents(uid);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].get("before"), {accessStatus: REVOKED});
  await call(getWorkspaceEntitlement, uid, {workspaceId});
  await createTransaction(uid, workspaceId);

  // Perfil suspenso: o status vence, com ou sem convite ativo.
  const suspenso = uniqueId("p6b-reentrada-suspensa");
  await seedActiveAccount(suspenso, {accessStatus: REVOKED, status: "suspended"});
  await invite(testEmailFor(suspenso), {uid: suspenso});
  await assert.rejects(
    executeBootstrapAccount(callerFor(suspenso), uniqueId("req"), "invite_only"),
    (error: unknown) => isApplicationError(error) && error.code === "account_suspended");
  const suspensoProfile = await profileOf(suspenso);
  assert.equal(suspensoProfile.get("status"), "suspended");
  assert.equal(suspensoProfile.get("accessStatus"), REVOKED);
  assert.equal((await grantedEvents(suspenso)).length, 0);
});

test("A×B: duas contas autorizadas em workspaces distintos; A é recusada no workspace de B", async () => {
  const a = uniqueId("p6b-tenant-a");
  const b = uniqueId("p6b-tenant-b");
  const workspaceA = await seedOwner(a);
  const workspaceB = await seedOwner(b);
  await call(getWorkspaceEntitlement, a, {workspaceId: workspaceA});
  await call(getWorkspaceEntitlement, b, {workspaceId: workspaceB});
  await createTransaction(a, workspaceA);
  await createTransaction(b, workspaceB);
  const before = await stateOf(b, workspaceB);

  await expectHttpsError(call(getWorkspaceEntitlement, a, {workspaceId: workspaceB}),
    "permission-denied", {message: "Você não tem acesso a este espaço de trabalho."});
  await expectHttpsError(createTransaction(a, workspaceB),
    "permission-denied", {message: "Você não tem acesso a este espaço de trabalho."});
  await expectHttpsError(call(updateWorkspaceSettings, a, {workspaceId: workspaceB, name: "Invadido"}),
    "permission-denied", {message: "Você não tem acesso a este espaço de trabalho."});
  assert.equal(await stateOf(b, workspaceB), before, "workspace de B intacto");
  assert.equal(await transactionCount(workspaceA), 1);
  assert.equal(await transactionCount(workspaceB), 1);
});

test("no Emulator (open_emulator) a conta antiga é autorizada sem convite, com origem emulator", async () => {
  const uid = uniqueId("p6b-emulador");
  const workspaceId = await seedOldAccount(uid);
  await refusedHttps(call(getWorkspaceEntitlement, uid, {workspaceId}));

  const result = await executeBootstrapAccount(callerFor(uid), uniqueId("req"), "open_emulator");
  assert.equal(result.created, false);
  const profile = await profileOf(uid);
  assert.equal(profile.get("accessStatus"), GRANTED);
  assert.equal(profile.get("accessSource"), "emulator");
  assert.equal(profile.get("accessInviteId"), null);
  assert.ok(profile.get("accessGrantedAt"));
  const events = await grantedEvents(uid);
  assert.equal(events.length, 1);
  assert.equal(events[0].get("after.accessSource"), "emulator");
  assert.equal(events[0].get("after.accessInviteId"), null);
  assert.equal((await inviteOf(testEmailFor(uid))).exists, false, "nenhum convite é criado");
  assert.equal((await ownedWorkspaces(uid)).length, 1);
  await call(getWorkspaceEntitlement, uid, {workspaceId});
  await createTransaction(uid, workspaceId);
});
