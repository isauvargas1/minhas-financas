import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";

import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {requireWorkspaceRole} from "../../creditCards/auth";
import {CreditCardApplicationError} from "../../creditCards/errors";
import {executeCreateGoal, executeRebuildGoalProgress, executeSaveGoalContribution} from "../../goals/operations";
import {
  executeCancelInvestmentRedemption,
  executeReverseInvestmentRedemption,
  executeSaveInvestmentRedemption,
} from "../operations";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (!enabled) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório para os testes de resgate.");
}
const WORKSPACE = "redemption-workspace-a";
const OTHER_WORKSPACE = "redemption-workspace-b";
const OWNER = "redemption-owner-a";
const OTHER_OWNER = "redemption-owner-b";

const getDb = () => {
  if (!admin.apps.length) {
    admin.initializeApp({projectId: process.env.GCLOUD_PROJECT || "minhas-financas-local"});
  }
  return admin.firestore();
};

const auth = (workspaceId = WORKSPACE, uid = OWNER): WorkspaceAuthorizationContext => ({
  workspaceId,
  uid,
  role: "owner",
});

const resetWorkspace = async (workspaceId: string, ownerId: string, type: "PF" | "PJ" = "PF") => {
  const db = getDb();
  await db.recursiveDelete(db.doc(`workspaces/${workspaceId}`));
  await db.doc(`workspaces/${workspaceId}`).set({ownerId, type, name: workspaceId});
  await db.doc(`workspaces/${workspaceId}/members/${ownerId}`).set({uid: ownerId, role: "owner", status: "active"});
};

const createGoalAndContribution = async (
  workspaceId: string,
  uid: string,
  prefix: string,
  value = 1000,
) => {
  const context = auth(workspaceId, uid);
  const goal = await executeCreateGoal(context, {
    workspaceId,
    idempotencyKey: `${prefix}-create-goal-0001`,
    goal: {
      name: "Meta com resgate",
      category: "patrimonio",
      status: "em_andamento",
      priority: "alta",
      targetAmount: 10_000,
      startDate: "2026-01-01",
      deadline: "2027-01-01",
      horizon: "curto",
      progressBasis: "net_contributions",
      visual: {color: "#6366f1", icon: "Target", progressBarType: "linear"},
    },
  });
  const contribution = await executeSaveGoalContribution(context, {
    workspaceId,
    idempotencyKey: `${prefix}-create-contribution-0001`,
    contribution: {
      goalId: String(goal.goalId),
      description: "Aporte de origem",
      category: "CDB",
      value,
      date: "2026-08-01",
      walletId: "wallet-a",
      isPaid: true,
    },
  });
  return {goalId: String(goal.goalId), contributionId: String(contribution.transactionId)};
};

const redemptionPayload = (
  sourceMovementId: string,
  idempotencyKey: string,
  status: "pending" | "settled",
  principal = 400,
) => ({
  workspaceId: WORKSPACE,
  idempotencyKey,
  correlationId: `corr-${idempotencyKey}`,
  redemption: {
    sourceMovementId,
    description: "Resgate compatível",
    principal,
    gain: 50,
    fees: 5,
    tax: 10,
    settlementDate: "2026-08-18",
    status,
  },
});

test("pending, liquidação, parcial, total, replay, meta e estorno reconciliam", async () => {
  await resetWorkspace(WORKSPACE, OWNER);
  const {goalId, contributionId} = await createGoalAndContribution(WORKSPACE, OWNER, "redemption-main");

  const pending = await executeSaveInvestmentRedemption(
    auth(), redemptionPayload(contributionId, "redemption-pending-0001", "pending"),
  );
  assert.equal(pending.netCashCents, 43_500);
  let source = await getDb().doc(`workspaces/${WORKSPACE}/transactions/${contributionId}`).get();
  let goal = await getDb().doc(`workspaces/${WORKSPACE}/goals/${goalId}`).get();
  assert.equal(source.data()?.redeemedPrincipalCents, 0);
  assert.equal(goal.data()?.currentAmountCents, 100_000);

  const settledPayload = {
    ...redemptionPayload(contributionId, "redemption-settle-0001", "settled"),
    transactionId: String(pending.transactionId),
  };
  const settled = await executeSaveInvestmentRedemption(auth(), settledPayload);
  assert.deepEqual(await executeSaveInvestmentRedemption(auth(), settledPayload), settled);
  await assert.rejects(
    () => executeSaveInvestmentRedemption(auth(), {
      ...settledPayload,
      redemption: {...settledPayload.redemption, principal: 399},
    }),
    (error: unknown) => error instanceof CreditCardApplicationError && error.code === "idempotency_conflict",
  );
  source = await getDb().doc(`workspaces/${WORKSPACE}/transactions/${contributionId}`).get();
  goal = await getDb().doc(`workspaces/${WORKSPACE}/goals/${goalId}`).get();
  const settledDocument = await getDb().doc(`workspaces/${WORKSPACE}/transactions/${pending.transactionId}`).get();
  assert.equal(source.data()?.remainingPrincipalCents, 60_000);
  assert.equal(goal.data()?.currentAmountCents, 60_000);
  assert.equal(settledDocument.data()?.valueCents, 43_500);
  assert.equal(settledDocument.data()?.investmentMetadata.principalCents, 40_000);
  assert.equal(settledDocument.data()?.investmentMetadata.currency, "BRL");
  assert.equal(settledDocument.data()?.investmentMetadata.gainCents, 5_000);
  assert.equal(settledDocument.data()?.investmentMetadata.feesCents, 500);
  assert.equal(settledDocument.data()?.investmentMetadata.taxCents, 1_000);
  assert.equal(settledDocument.data()?.settlementDate instanceof admin.firestore.Timestamp, true);

  const total = await executeSaveInvestmentRedemption(auth(), {
    ...redemptionPayload(contributionId, "redemption-total-0001", "settled", 600),
    redemption: {
      ...redemptionPayload(contributionId, "unused-total-key", "settled", 600).redemption,
      gain: 0,
      fees: 0,
      tax: 0,
    },
  });
  assert.equal(total.remainingPrincipalCents, 0);
  await assert.rejects(
    () => executeSaveInvestmentRedemption(
      auth(), redemptionPayload(contributionId, "redemption-overdraw-0001", "settled", 1),
    ),
    (error: unknown) => error instanceof CreditCardApplicationError && error.code === "domain_precondition_failed",
  );

  const reversalPayload = {
    workspaceId: WORKSPACE,
    idempotencyKey: "redemption-reversal-0001",
    correlationId: "corr-redemption-reversal-0001",
    transactionId: String(total.transactionId),
    reversalDate: "2026-08-19",
    reason: "Correção operacional",
  };
  const reversal = await executeReverseInvestmentRedemption(auth(), reversalPayload);
  assert.deepEqual(await executeReverseInvestmentRedemption(auth(), reversalPayload), reversal);
  const rebuilt = await executeRebuildGoalProgress(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "redemption-rebuild-0001",
    goalId,
    reason: "Reconciliação independente após estorno",
    pageSize: 300,
  });
  assert.equal(rebuilt.currentAmount, 600);
  source = await getDb().doc(`workspaces/${WORKSPACE}/transactions/${contributionId}`).get();
  assert.equal(source.data()?.remainingPrincipalCents, 60_000);

  const pendingToCancel = await executeSaveInvestmentRedemption(
    auth(), redemptionPayload(contributionId, "redemption-cancel-create-0001", "pending", 100),
  );
  const cancelPayload = {
    workspaceId: WORKSPACE,
    idempotencyKey: "redemption-cancel-0001",
    correlationId: "corr-redemption-cancel-0001",
    transactionId: String(pendingToCancel.transactionId),
    reason: "Solicitação cancelada",
  };
  const cancelled = await executeCancelInvestmentRedemption(auth(), cancelPayload);
  assert.deepEqual(await executeCancelInvestmentRedemption(auth(), cancelPayload), cancelled);
  goal = await getDb().doc(`workspaces/${WORKSPACE}/goals/${goalId}`).get();
  assert.equal(goal.data()?.currentAmountCents, 60_000);
});

test("resgates concorrentes não excedem saldo nem duplicam efeito", async () => {
  await resetWorkspace(WORKSPACE, OWNER);
  const {goalId, contributionId} = await createGoalAndContribution(WORKSPACE, OWNER, "redemption-race", 500);
  const outcomes = await Promise.allSettled([
    executeSaveInvestmentRedemption(
      auth(), redemptionPayload(contributionId, "redemption-race-a-0001", "settled", 300),
    ),
    executeSaveInvestmentRedemption(
      auth(), redemptionPayload(contributionId, "redemption-race-b-0001", "settled", 300),
    ),
  ]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
  const source = await getDb().doc(`workspaces/${WORKSPACE}/transactions/${contributionId}`).get();
  const goal = await getDb().doc(`workspaces/${WORKSPACE}/goals/${goalId}`).get();
  assert.equal(source.data()?.redeemedPrincipalCents, 30_000);
  assert.equal(source.data()?.remainingPrincipalCents, 20_000);
  assert.equal(goal.data()?.currentAmountCents, 20_000);
});

test("meta por valor atual reduz o valor bruto e mantém principal separado", async () => {
  await resetWorkspace(WORKSPACE, OWNER);
  const context = auth();
  const goal = await executeCreateGoal(context, {
    workspaceId: WORKSPACE,
    idempotencyKey: "redemption-current-value-goal-0001",
    goal: {
      name: "Patrimônio atual",
      category: "patrimonio",
      status: "em_andamento",
      priority: "alta",
      targetAmount: 2_000,
      currentValue: 1_000,
      startDate: "2026-01-01",
      deadline: "2027-01-01",
      horizon: "curto",
      progressBasis: "current_value",
      visual: {color: "#6366f1", icon: "Target", progressBarType: "linear"},
    },
  });
  const contribution = await executeSaveGoalContribution(context, {
    workspaceId: WORKSPACE,
    idempotencyKey: "redemption-current-value-contribution-0001",
    contribution: {
      goalId: String(goal.goalId), description: "Origem por valor atual", category: "CDB",
      value: 1_000, date: "2026-08-01", isPaid: true,
    },
  });
  await executeSaveInvestmentRedemption(context, redemptionPayload(
    String(contribution.transactionId),
    "redemption-current-value-settled-0001",
    "settled",
    100,
  ));
  const persistedGoal = await getDb().doc(`workspaces/${WORKSPACE}/goals/${goal.goalId}`).get();
  assert.equal(persistedGoal.data()?.netContributionCents, 90_000);
  assert.equal(persistedGoal.data()?.currentValueCents, 85_000);
  assert.equal(persistedGoal.data()?.currentAmountCents, 85_000);
});

test("origem é resolvida somente no workspace autorizado e mantém contexto PF/PJ", async () => {
  await Promise.all([
    resetWorkspace(WORKSPACE, OWNER, "PF"),
    resetWorkspace(OTHER_WORKSPACE, OTHER_OWNER, "PJ"),
  ]);
  const a = await createGoalAndContribution(WORKSPACE, OWNER, "redemption-tenant-a", 100);
  const b = await createGoalAndContribution(OTHER_WORKSPACE, OTHER_OWNER, "redemption-tenant-b", 100);
  await getDb().doc(`workspaces/${OTHER_WORKSPACE}/transactions/${b.contributionId}`).update({
    costCenter: "Financeiro",
  });
  await assert.rejects(
    () => executeSaveInvestmentRedemption(
      auth(), redemptionPayload(b.contributionId, "redemption-cross-tenant-0001", "settled", 10),
    ),
    (error: unknown) => error instanceof CreditCardApplicationError &&
      (error.code === "domain_precondition_failed" || error.code === "not_found"),
  );
  await assert.rejects(
    () => executeSaveInvestmentRedemption(
      auth(OTHER_WORKSPACE, OTHER_OWNER),
      {
        ...redemptionPayload(a.contributionId, "redemption-cross-tenant-0002", "settled", 10),
        workspaceId: OTHER_WORKSPACE,
      },
    ),
    (error: unknown) => error instanceof CreditCardApplicationError &&
      (error.code === "domain_precondition_failed" || error.code === "not_found"),
  );
  const pjResult = await executeSaveInvestmentRedemption(
    auth(OTHER_WORKSPACE, OTHER_OWNER),
    {
      ...redemptionPayload(b.contributionId, "redemption-pj-0001", "settled", 10),
      workspaceId: OTHER_WORKSPACE,
    },
  );
  const pjDocument = await getDb().doc(
    `workspaces/${OTHER_WORKSPACE}/transactions/${pjResult.transactionId}`,
  ).get();
  assert.equal(pjDocument.data()?.profileType, "PJ");
  assert.equal(pjDocument.data()?.costCenter, "Financeiro");
  assert.equal((await getDb().doc(`workspaces/${WORKSPACE}/transactions/${a.contributionId}`).get()).data()?.remainingPrincipalCents, 10_000);
});

test("RBAC aceita owner/admin/member ativos e rejeita removido e outro tenant", async () => {
  await Promise.all([
    resetWorkspace(WORKSPACE, OWNER, "PF"),
    resetWorkspace(OTHER_WORKSPACE, OTHER_OWNER, "PF"),
  ]);
  const adminId = "redemption-admin-a";
  const memberId = "redemption-member-a";
  const removedId = "redemption-removed-a";
  await Promise.all([
    getDb().doc(`workspaces/${WORKSPACE}/members/${adminId}`).set({uid: adminId, role: "admin", status: "active"}),
    getDb().doc(`workspaces/${WORKSPACE}/members/${memberId}`).set({uid: memberId, role: "member", status: "active"}),
    getDb().doc(`workspaces/${WORKSPACE}/members/${removedId}`).set({uid: removedId, role: "member", status: "removed"}),
  ]);
  const request = (uid: string, workspaceId: string) => ({auth: {uid, token: {}}, data: {workspaceId}} as any);
  for (const uid of [OWNER, adminId, memberId]) {
    const context = await requireWorkspaceRole(
      request(uid, WORKSPACE), WORKSPACE, ["owner", "admin", "member"],
    );
    assert.equal(context.workspaceId, WORKSPACE);
  }
  await assert.rejects(
    () => requireWorkspaceRole(request(removedId, WORKSPACE), WORKSPACE, ["owner", "admin", "member"]),
    (error: unknown) => error instanceof CreditCardApplicationError && error.code === "workspace_membership_required",
  );
  await assert.rejects(
    () => requireWorkspaceRole(request(OTHER_OWNER, WORKSPACE), WORKSPACE, ["owner", "admin", "member"]),
    (error: unknown) => error instanceof CreditCardApplicationError && error.code === "workspace_membership_required",
  );
});
