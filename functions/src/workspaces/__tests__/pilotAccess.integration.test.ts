import assert from "node:assert/strict";
import test from "node:test";

import {
  requireFirestoreEmulator,
  seedActiveAccount,
  testEmailFor,
} from "../../shared/testSupport/kernelTestSupport";
import type {CallerIdentity} from "../../shared/callable";
import {isApplicationError} from "../../shared/errors";
import {ownershipQuotaRef} from "../../billing/quota";
import {executeBootstrapAccount} from "../lifecycle";
import {PILOT_ACCESS_COLLECTION, pilotAccessDocId} from "../pilotAccess";
import {db, uniqueId} from "../testSupport/p1TestSupport";

requireFirestoreEmulator();

/*
 * P6-A (gate G0): fora do Emulator, uma conta nova só é inicializada com o
 * convite do piloto. Os testes informam o modo `invite_only` explicitamente,
 * porque aqui o projeto é o do Emulator (que abre o acesso).
 */
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

const invite = async (email: string, status = "active") =>
  db().collection(PILOT_ACCESS_COLLECTION).doc(pilotAccessDocId(email)).set({email, status});

const nothingCreated = async (uid: string) => {
  const [profile, index] = await Promise.all([
    db().doc(`users/${uid}`).get(),
    db().collection(`users/${uid}/workspaces`).limit(1).get(),
  ]);
  assert.equal(profile.exists, false, "perfil não pode ser criado");
  assert.equal(index.empty, true, "nenhum workspace pode ser criado");
};

const refusedForPilot = async (promise: Promise<unknown>) => {
  await assert.rejects(promise, (error: unknown) =>
    isApplicationError(error) && error.code === "pilot_access_required");
};

test("conta nova sem convite é recusada e nada é criado", async () => {
  const uid = uniqueId("piloto-sem-convite");
  await refusedForPilot(executeBootstrapAccount(callerFor(uid), uniqueId("req"), "invite_only"));
  await nothingCreated(uid);
});

test("convite revogado ou e-mail não verificado não inicializam a conta", async () => {
  const revogado = uniqueId("piloto-revogado");
  await invite(testEmailFor(revogado), "revoked");
  await refusedForPilot(executeBootstrapAccount(callerFor(revogado), uniqueId("req"), "invite_only"));
  await nothingCreated(revogado);

  const naoVerificado = uniqueId("piloto-nao-verificado");
  await invite(testEmailFor(naoVerificado));
  await refusedForPilot(executeBootstrapAccount(
    callerFor(naoVerificado, {emailVerified: false}), uniqueId("req"), "invite_only"));
  await nothingCreated(naoVerificado);

  const semEmail = uniqueId("piloto-sem-email");
  await refusedForPilot(executeBootstrapAccount(callerFor(semEmail, {email: null}), uniqueId("req"), "invite_only"));
  await nothingCreated(semEmail);
});

test("convite de outro e-mail não serve", async () => {
  const uid = uniqueId("piloto-outro");
  await invite(`outra-${testEmailFor(uid)}`);
  await refusedForPilot(executeBootstrapAccount(callerFor(uid), uniqueId("req"), "invite_only"));
  await nothingCreated(uid);
});

test("convite ativo inicializa a conta, sem diferenciar maiúsculas", async () => {
  const uid = uniqueId("piloto-convidado");
  await invite(testEmailFor(uid));
  const result = await executeBootstrapAccount(
    callerFor(uid, {email: testEmailFor(uid).toUpperCase()}), uniqueId("req"), "invite_only");
  assert.equal(result.created, true);
  assert.equal((await db().doc(`users/${uid}`).get()).get("status"), "active");
});

test("conta já autorizada continua entrando sem reler o convite (a revogação marca o perfil)", async () => {
  const uid = uniqueId("piloto-ativa");
  // `seedActiveAccount` semeia o perfil autorizado (P6-B), como o bootstrap.
  await seedActiveAccount(uid);
  const primeira = await executeBootstrapAccount(callerFor(uid), uniqueId("req"), "open_emulator");
  assert.ok(primeira.workspaceId || primeira.created === false);
  const repetida = await executeBootstrapAccount(callerFor(uid), uniqueId("req"), "invite_only");
  assert.equal(repetida.created, false);
});

test("no Emulator o acesso é aberto (E2E e desenvolvimento)", async () => {
  const uid = uniqueId("piloto-emulador");
  const result = await executeBootstrapAccount(callerFor(uid), uniqueId("req"), "open_emulator");
  assert.equal(result.created, true);
});

test("o convite fica vinculado à conta no bootstrap e não serve a outra conta (uso único)", async () => {
  const uid = uniqueId("piloto-vinculo");
  const email = testEmailFor(uid);
  await invite(email);
  const result = await executeBootstrapAccount(callerFor(uid), uniqueId("req"), "invite_only");
  assert.equal(result.created, true);
  const entry = await db().collection(PILOT_ACCESS_COLLECTION).doc(pilotAccessDocId(email)).get();
  assert.equal(entry.get("uid"), uid);
  assert.ok(entry.get("usadoEm"), "usadoEm gravado no mesmo commit");

  // Outra conta com o mesmo e-mail (a primeira trocou de e-mail): o convite já tem dono.
  const outra = uniqueId("piloto-vinculo-outra");
  await refusedForPilot(executeBootstrapAccount(callerFor(outra, {email}), uniqueId("req"), "invite_only"));
  await nothingCreated(outra);
  assert.equal((await db().collection(PILOT_ACCESS_COLLECTION).doc(pilotAccessDocId(email)).get()).get("uid"), uid);
});

test("bootstrap recusado por cota ou erro posterior não consome o convite (mesma transação)", async () => {
  const uid = uniqueId("piloto-atomico");
  const email = testEmailFor(uid);
  await invite(email);
  // Perfil inexistente, mas estado de cota de titularidade ilegível: o bootstrap falha depois do convite.
  await ownershipQuotaRef(uid).set({activeOwnedWorkspaces: 1, schemaVersion: -1});
  await assert.rejects(executeBootstrapAccount(callerFor(uid), uniqueId("req"), "invite_only"));
  const entry = await db().collection(PILOT_ACCESS_COLLECTION).doc(pilotAccessDocId(email)).get();
  assert.equal(entry.get("uid"), undefined, "nenhum vínculo sem o commit do bootstrap");
});

test("conta suspensa continua recusada como suspensa, com ou sem convite (MT-3)", async () => {
  const uid = uniqueId("piloto-suspensa");
  await seedActiveAccount(uid, {status: "suspended"});
  await invite(testEmailFor(uid), "revoked");
  await assert.rejects(
    executeBootstrapAccount(callerFor(uid), uniqueId("req"), "invite_only"),
    (error: unknown) => isApplicationError(error) && error.code === "account_suspended");
});
