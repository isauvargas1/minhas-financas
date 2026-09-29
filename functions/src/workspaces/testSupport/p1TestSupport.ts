import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";

import * as admin from "firebase-admin";
import {HttpsError} from "firebase-functions/v2/https";

import {
  callableRequest,
  requireFirestoreEmulator,
  type TestTokenOverrides,
} from "../../shared/testSupport/kernelTestSupport";

/**
 * Suporte comum das suítes de integração de P1 (somente testes).
 *
 * As suítes rodam em processos paralelos contra o mesmo Emulator, então
 * nenhuma limpa o banco: cada teste usa IDs únicos.
 */
export const db = (): admin.firestore.Firestore => requireFirestoreEmulator();

export const uniqueId = (prefix: string): string =>
  `${prefix}-${randomUUID().slice(0, 8)}`;

export const idempotencyKey = (): string => `idem-${randomUUID()}`;

interface RunnableCallable {
  run: (request: unknown) => unknown;
}

/** Invoca a callable exportada pelo mesmo caminho do runtime (`.run`). */
export const call = async <T = Record<string, unknown>>(
  fn: unknown,
  uid: string | null,
  data: unknown,
  overrides: TestTokenOverrides = {},
): Promise<T> =>
  await (fn as RunnableCallable).run(
    callableRequest(uid, data as Record<string, unknown>, overrides),
  ) as T;

export const expectHttpsError = async (
  promise: Promise<unknown>,
  code: string,
  expected: {reason?: string; message?: string | RegExp} = {},
): Promise<HttpsError> => {
  try {
    await promise;
  } catch (error) {
    assert.ok(
      error instanceof HttpsError,
      `erro não mapeado: ${String(error)}`,
    );
    assert.equal(error.code, code, `código: ${error.message}`);
    const details = error.details as Record<string, unknown> | undefined;
    if (expected.reason) assert.equal(details?.reason, expected.reason);
    if (typeof expected.message === "string") {
      assert.equal(error.message, expected.message);
    } else if (expected.message) {
      assert.match(error.message, expected.message);
    }
    return error;
  }
  assert.fail(`esperava HttpsError ${code}`);
};

export const membershipEvents = async (
  workspaceId: string,
  operation?: string,
): Promise<admin.firestore.DocumentData[]> => {
  const snapshot = await db()
    .collection(`workspaces/${workspaceId}/membership_events`).get();
  return snapshot.docs
    .map((doc) => doc.data())
    .filter((event) => !operation || event.operation === operation);
};

export const memberOf = async (workspaceId: string, uid: string) =>
  (await db().doc(`workspaces/${workspaceId}/members/${uid}`).get()).data();

export const indexOf = async (uid: string, workspaceId: string) =>
  (await db().doc(`users/${uid}/workspaces/${workspaceId}`).get()).data();

export const activeOwners = async (workspaceId: string): Promise<string[]> => {
  const snapshot = await db()
    .collection(`workspaces/${workspaceId}/members`)
    .where("role", "==", "owner")
    .where("status", "==", "active")
    .get();
  return snapshot.docs.map((doc) => doc.id);
};

/** Segundos desde a época para `auth_time` antigo (fora da janela recente). */
export const staleAuthTime = (): number =>
  Math.floor(Date.now() / 1000) - 60 * 60;
