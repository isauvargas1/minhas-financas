import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {CreditCardApplicationError} from "../../creditCards/errors";
import {consumeRateLimit, rateLimitDocumentId} from "../rateLimit";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST é obrigatório para os testes de limite.",
  );
}

const PROJECT = process.env.GCLOUD_PROJECT ?? "minhas-financas-local";
const WORKSPACE = "rate-limit-workspace";
const OTHER_WORKSPACE = "rate-limit-workspace-b";
const ACTOR = "rate-limit-actor";
const OTHER_ACTOR = "rate-limit-actor-b";

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const policy = {operation: "testOperation", limit: 3, windowSeconds: 60};

/**
 * `consumeRateLimit` verifica na fase de leitura e devolve o gravador do
 * contador, que precisa ser chamado na fase de escrita — o Firestore exige
 * todas as leituras antes de qualquer escrita numa transação.
 */
const consume = (workspaceId = WORKSPACE, actorId = ACTOR) =>
  db().runTransaction(async (transaction) => {
    const reservation = await consumeRateLimit(
      transaction,
      workspaceId,
      actorId,
      policy,
    );
    reservation.commit();
    return reservation;
  });

const reset = async (): Promise<void> => {
  await Promise.all([
    db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`)),
    db().recursiveDelete(db().doc(`workspaces/${OTHER_WORKSPACE}`)),
  ]);
};

test("consome o limite e nega ao atingir o teto", async () => {
  await reset();
  for (let attempt = 1; attempt <= policy.limit; attempt += 1) {
    const result = await consume();
    assert.equal(result.remaining, policy.limit - attempt);
  }
  await assert.rejects(
    () => consume(),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      error.code === "domain_precondition_failed" &&
      /muitas solicitações/i.test(error.message),
  );
});

test("o limite é isolado por ator e por workspace", async () => {
  await reset();
  for (let attempt = 0; attempt < policy.limit; attempt += 1) await consume();
  await assert.rejects(() => consume());

  // Outro ator no mesmo workspace começa do zero.
  const otherActor = await consume(WORKSPACE, OTHER_ACTOR);
  assert.equal(otherActor.remaining, policy.limit - 1);
  // O mesmo ator em outro workspace também.
  const otherWorkspace = await consume(OTHER_WORKSPACE, ACTOR);
  assert.equal(otherWorkspace.remaining, policy.limit - 1);
});

test("a janela expira e a contagem reinicia", async () => {
  await reset();
  for (let attempt = 0; attempt < policy.limit; attempt += 1) await consume();
  await assert.rejects(() => consume());

  // Envelhece a janela além do seu tamanho, em vez de esperar em tempo real.
  const ref = db().doc(
    `workspaces/${WORKSPACE}/rate_limits/` +
      rateLimitDocumentId(policy, ACTOR),
  );
  await ref.update({
    windowStart: Timestamp.fromMillis(
      Date.now() - (policy.windowSeconds + 1) * 1000,
    ),
  });

  const afterWindow = await consume();
  assert.equal(
    afterWindow.remaining,
    policy.limit - 1,
    "Janela expirada precisa reiniciar a contagem.",
  );
  const stored = (await ref.get()).data();
  assert.equal(stored?.count, 1);
});

test("chamadas concorrentes não ultrapassam o teto", async () => {
  await reset();
  // Seis tentativas simultâneas contra um teto de três: a transação serializa
  // no documento, então no máximo três podem passar.
  const results = await Promise.allSettled(
    Array.from({length: 6}, () => consume()),
  );
  const accepted = results.filter((entry) => entry.status === "fulfilled");
  assert.ok(
    accepted.length <= policy.limit,
    `Aceitou ${accepted.length} chamadas com teto de ${policy.limit}.`,
  );
  const stored = (
    await db()
      .doc(
        `workspaces/${WORKSPACE}/rate_limits/` +
          rateLimitDocumentId(policy, ACTOR),
      )
      .get()
  ).data();
  assert.ok(
    Number(stored?.count) <= policy.limit,
    "A contagem persistida não pode ultrapassar o teto.",
  );
});

test("o documento de limite não guarda conteúdo da requisição", async () => {
  await reset();
  await consume();
  const stored = (
    await db()
      .doc(
        `workspaces/${WORKSPACE}/rate_limits/` +
          rateLimitDocumentId(policy, ACTOR),
      )
      .get()
  ).data();
  assert.deepEqual(
    Object.keys(stored ?? {}).sort(),
    [
      "actorId", "count", "date", "id", "limit", "operation",
      "updatedAt", "windowSeconds", "windowStart", "workspaceId",
    ],
    "O contador guarda só metadados de controle, nunca payload.",
  );
});
