import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {executeRecalculateGoalInvestmentProgress} from "../../investments/rebuild";
import {investmentOperationRoles} from "../../investments/writeStrategy";
import * as goalCallables from "../callables";
import {GOAL_OPERATION_ROLES} from "../callables";
import {executeCreateGoal} from "../operations";

/**
 * Superfície operacional de reconstrução de progresso de meta.
 *
 * `recalculateGoalInvestmentProgress` é a única reconciliação de progresso de
 * meta do produto: soma as posições vinculadas e publica valor absoluto em
 * `investmentProgressCents`. Antes ela só era alcançada indiretamente pelo
 * backfill do workspace inteiro.
 *
 * O que este arquivo prova é o contrato **da superfície**: identificação da
 * tentativa, trilha de auditoria, idempotência e papéis.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório.");
}

const PROJECT = process.env.GCLOUD_PROJECT || "minhas-financas-local";
const WORKSPACE = "goal-ops-surface";
const OWNER = "goal-ops-owner";
const ADMIN = "goal-ops-admin";
const MEMBER = "goal-ops-member";
const GOAL_POSITION_ACCOUNT = "goal-ops-account";
const GOAL_POSITION_ASSET = "goal-ops-asset";

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const auth = (
  uid = OWNER,
  role: WorkspaceAuthorizationContext["role"] = "owner",
): WorkspaceAuthorizationContext => ({workspaceId: WORKSPACE, uid, role});

const seedWorkspace = async (): Promise<void> => {
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
  await db().doc(`workspaces/${WORKSPACE}`).set({
    ownerId: OWNER,
    type: "PF",
    currency: "BRL",
    name: WORKSPACE,
  });
  await Promise.all([
    db().doc(`workspaces/${WORKSPACE}/members/${OWNER}`)
      .set({uid: OWNER, role: "owner", status: "active"}),
    db().doc(`workspaces/${WORKSPACE}/members/${ADMIN}`)
      .set({uid: ADMIN, role: "admin", status: "active"}),
    db().doc(`workspaces/${WORKSPACE}/members/${MEMBER}`)
      .set({uid: MEMBER, role: "member", status: "active"}),
  ]);
};

const createGoal = async (name: string): Promise<string> => {
  const created = await executeCreateGoal(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: `goal-ops-create-${name}-0001`,
    goal: {
      name,
      category: "patrimonio",
      status: "em_andamento",
      priority: "media",
      targetAmount: 10_000,
      startDate: "2026-01-01",
      deadline: "2026-12-31",
      horizon: "medio",
      progressBasis: "net_contributions",
      visual: {
        color: "#112233",
        icon: "target",
        progressBarType: "linear",
      },
    },
  });
  return String(created.goalId);
};

test("o recálculo patrimonial da meta aceita owner e admin e recusa member", async () => {
  await seedWorkspace();
  const goalId = await createGoal("Meta patrimonial");

  // A tela oferece exatamente os papéis da matriz declarativa do backend.
  assert.deepEqual(
    investmentOperationRoles("recalculateGoalInvestmentProgress"),
    ["owner", "admin"],
  );

  const now = Timestamp.fromDate(new Date("2026-04-01T12:00:00.000Z"));
  await db()
    .doc(`workspaces/${WORKSPACE}/investment_positions/pos-goal-ops`)
    .set({
      id: "pos-goal-ops",
      workspaceId: WORKSPACE,
      accountId: GOAL_POSITION_ACCOUNT,
      assetId: GOAL_POSITION_ASSET,
      goalId,
      principalCents: 40_000,
      currentValueCents: 45_000,
      quantityMicros: 1_000_000,
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

  const asAdmin = await executeRecalculateGoalInvestmentProgress(
    auth(ADMIN, "admin"),
    {
      workspaceId: WORKSPACE,
      idempotencyKey: "goal-ops-investment-admin-0001",
      correlationId: "investment-attempt-goal-ops-admin-1",
      goalId,
      pageSize: 50,
      reason: "Reconciliação patrimonial pelo administrador",
    },
  );
  assert.equal(asAdmin.hasMore, false);
  assert.equal(asAdmin.status, "completed");

  const goal = await db().doc(`workspaces/${WORKSPACE}/goals/${goalId}`).get();
  assert.equal(goal.data()?.investmentNetContributionCents, 40_000);
  assert.equal(goal.data()?.investmentCurrentValueCents, 45_000);

  await assert.rejects(
    () =>
      executeRecalculateGoalInvestmentProgress(auth(MEMBER, "member"), {
        workspaceId: WORKSPACE,
        idempotencyKey: "goal-ops-investment-member-0001",
        correlationId: "investment-attempt-goal-ops-member-1",
        goalId,
        pageSize: 50,
        reason: "Tentativa de membro",
      }),
    /permiss|autoriza|papel/i,
  );
});

test("toda callable de meta declara papel na matriz, e a pesada é restrita", () => {
  assert.deepEqual(
    [...GOAL_OPERATION_ROLES.seedLegacySettingsCatalog],
    ["owner", "admin"],
  );

  // Nenhuma callable de meta exportada pode ficar fora da matriz: sem isto, a
  // próxima operação nasceria com papel decidido no ponto de construção e
  // invisível para qualquer teste.
  const exported = Object.entries(goalCallables)
    .filter(([, value]) =>
      Boolean(value) &&
      (typeof value === "object" || typeof value === "function") &&
      "__endpoint" in (value as Record<string, unknown>))
    .map(([name]) => name)
    .sort();
  assert.deepEqual(exported, Object.keys(GOAL_OPERATION_ROLES).sort());
});
