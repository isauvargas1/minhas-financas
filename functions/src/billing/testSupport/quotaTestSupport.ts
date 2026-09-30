import assert from "node:assert/strict";

import {Timestamp} from "firebase-admin/firestore";
import {HttpsError} from "firebase-functions/v2/https";

import {
  requireFirestoreEmulator,
  seedActiveAccount,
  seedPaidPlan,
  testEmailFor,
} from "../../shared/testSupport/kernelTestSupport";
import {
  acceptWorkspaceInvite,
  inviteWorkspaceMember,
} from "../../workspaces/callables";
import {
  issueTestInviteToken,
} from "../../workspaces/testSupport/inviteTokenSeam";
import {
  call,
  db,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import type {PlanId} from "../catalog";
import {QUOTA_EXCEEDED_MESSAGE} from "../quota";

/**
 * Suporte das suítes de quota de P2B.1 (somente testes, Emulator).
 *
 * O estado de quota é lido direto pelo Admin SDK para as asserções; as
 * mutações passam pelas callables exportadas (`.run`), o mesmo caminho do
 * runtime. Onde a suíte precisa de um estado que só o tempo ou o webhook
 * produziriam (grace vencido, downgrade, contador no penúltimo slot), ele é
 * gravado no billing/quota como o backend o gravaria.
 */
requireFirestoreEmulator();

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Conta ativa semeada, Free por padrão (0 workspaces próprios). */
export const account = async (
  prefix: string,
  plan: PlanId = "free",
): Promise<string> => {
  const uid = uniqueId(prefix);
  await seedActiveAccount(uid);
  if (plan !== "free") await seedPaidPlan(uid, plan);
  return uid;
};

/** Grava campos do billing como o webhook/reavaliação os deixaria. */
export const setBilling = async (
  uid: string,
  fields: Record<string, unknown>,
): Promise<void> => {
  await db().doc(`billing_accounts/${uid}`).update(fields);
};

export const downgradeToFree = (uid: string) =>
  setBilling(uid, {
    planId: "free",
    entitlementStatus: "free",
    subscriptionStatus: "canceled",
  });

export const ownedCount = async (uid: string): Promise<number | undefined> =>
  (await db().doc(`billing_accounts/${uid}/quota_state/ownership`).get())
    .get("activeOwnedWorkspaces");

export const setOwnedCount = async (uid: string, value: number) => {
  await db().doc(`billing_accounts/${uid}/quota_state/ownership`)
    .update({activeOwnedWorkspaces: value});
};

export interface MembershipQuotaView {
  activeMembers: number;
  reservations: string[];
}

export const membershipQuota = async (
  workspaceId: string,
): Promise<MembershipQuotaView> => {
  const data = (await db()
    .doc(`workspaces/${workspaceId}/quota_state/membership`).get()).data();
  assert.ok(data, "quota de membros ausente");
  return {
    activeMembers: data.activeMembers,
    reservations: Object.keys(data.pendingReservations ?? {}).sort(),
  };
};

/** Workspaces ativos com `ownerId` do usuário (conferência, só no teste). */
export const activeOwnedWorkspaces = async (uid: string): Promise<number> =>
  (await db().collection("workspaces")
    .where("ownerId", "==", uid)
    .where("status", "==", "active")
    .count().get()).data().count;

export const inviteEmail = (
  actor: string,
  workspaceId: string,
  email: string,
  role: "admin" | "member" | "viewer" = "member",
) => call<{inviteId: string; expiresAt: string}>(inviteWorkspaceMember, actor, {
  workspaceId,
  email,
  role,
  idempotencyKey: idempotencyKey(),
});

/** Convida a conta `invitee` pelo e-mail do token dela e emite o token. */
export const inviteAccount = async (
  actor: string,
  workspaceId: string,
  invitee: string,
): Promise<{inviteId: string; token: string}> => {
  const {inviteId} = await inviteEmail(
    actor,
    workspaceId,
    testEmailFor(invitee),
  );
  return {inviteId, token: await issueTestInviteToken(workspaceId, inviteId)};
};

export const accept = (invitee: string, token: string) =>
  call<{workspaceId: string; role: string; replay: boolean}>(
    acceptWorkspaceInvite,
    invitee,
    {token},
  );

/** Vence convite e reserva juntos (mesmo `expiresAt`), como o tempo faria. */
export const expireInvite = async (workspaceId: string, inviteId: string) => {
  const past = Timestamp.fromMillis(Date.now() - 60_000);
  await db().doc(`workspaces/${workspaceId}/invites/${inviteId}`)
    .update({expiresAt: past});
  await db().doc(`workspaces/${workspaceId}/quota_state/membership`)
    .update({[`pendingReservations.${inviteId}`]: past});
};

/**
 * Recusa por quota: `resource-exhausted`, mensagem pública e só os detalhes
 * permitidos (nunca uid do owner, IDs do Stripe ou estado interno).
 */
export const expectQuotaExceeded = async (
  promise: Promise<unknown>,
  expected: {resource: string; planId?: string; limit?: number; used?: number},
): Promise<HttpsError> => {
  try {
    await promise;
  } catch (error) {
    assert.ok(
      error instanceof HttpsError,
      `erro não mapeado: ${String(error)}`,
    );
    assert.equal(error.code, "resource-exhausted", error.message);
    const details = error.details as Record<string, unknown>;
    assert.equal(details.resource, expected.resource);
    if (expected.planId === undefined) {
      assert.deepEqual(Object.keys(details), ["resource"]);
    } else {
      assert.equal(error.message, QUOTA_EXCEEDED_MESSAGE);
      assert.deepEqual(Object.keys(details).sort(),
        ["limit", "planId", "resource", "used"]);
      assert.equal(details.planId, expected.planId);
      if (expected.limit !== undefined) {
        assert.equal(details.limit, expected.limit);
      }
      if (expected.used !== undefined) {
        assert.equal(details.used, expected.used);
      }
    }
    const serialized = JSON.stringify(error.toJSON());
    assert.doesNotMatch(serialized, /cus_|sub_|price_|billingOwnerUid|grace/i);
    return error;
  }
  assert.fail("esperava quota_exceeded");
};

/** Resultados de chamadas concorrentes: vencedoras e códigos das perdedoras. */
export const settle = async (calls: Promise<unknown>[]) => {
  const outcomes = await Promise.allSettled(calls);
  return {
    fulfilled: outcomes.filter((outcome) => outcome.status === "fulfilled")
      .length,
    rejectedCodes: outcomes
      .filter((outcome): outcome is PromiseRejectedResult =>
        outcome.status === "rejected")
      .map((outcome) => (outcome.reason as {code?: string}).code),
  };
};
