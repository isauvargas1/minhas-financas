import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";

import {requireWorkspaceRole} from "../../creditCards/auth";
import {CreditCardApplicationError} from "../../creditCards/errors";
import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {
  executeArchiveGoal,
  executeCreateGoal,
  executeRebuildGoalProgress,
  executeSaveGoalContribution,
  executeSeedLegacySettingsCatalog,
  executeSetGoalTransactionLinks,
} from "../operations";

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (!enabled) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório para os testes de integridade de metas.");
}
const PF_WORKSPACE = "goal-integrity-pf";
const PJ_WORKSPACE = "goal-integrity-pj";
const OTHER_WORKSPACE = "goal-integrity-other";
const OWNER_A = "goal-owner-a";
const OWNER_B = "goal-owner-b";

const getDb = () => {
  if (!admin.apps.length) {
    admin.initializeApp({projectId: process.env.GCLOUD_PROJECT || "minhas-financas-local"});
  }
  return admin.firestore();
};

const authContext = (
  workspaceId: string,
  uid: string,
  role: "owner" | "admin" | "member" = "owner",
): WorkspaceAuthorizationContext => ({workspaceId, uid, role});

const seedWorkspace = async (workspaceId: string, ownerId: string, type: "PF" | "PJ") => {
  const db = getDb();
  const now = admin.firestore.Timestamp.now();
  await db.doc(`workspaces/${workspaceId}`).set({ownerId, type, name: workspaceId, createdAt: now, updatedAt: now});
  await db.doc(`workspaces/${workspaceId}/members/${ownerId}`).set({uid: ownerId, role: "owner", status: "active"});
};

const resetWorkspace = async (workspaceId: string) => {
  const ref = getDb().doc(`workspaces/${workspaceId}`);
  await getDb().recursiveDelete(ref);
};

const goalPayload = (workspaceId: string, idempotencyKey: string) => ({
  workspaceId,
  idempotencyKey,
  goal: {
    name: "Reserva verificável",
    description: "Meta de teste",
    category: "reserva_emergencia" as const,
    status: "em_andamento" as const,
    priority: "alta" as const,
    targetAmount: 10000,
    startDate: "2026-01-01",
    deadline: "2027-01-01",
    horizon: "curto" as const,
    progressBasis: "net_contributions" as const,
    visual: {color: "#6366f1", icon: "Target", progressBarType: "linear" as const},
  },
});

test("aporte pré-vinculado, vínculo retroativo, pending, retry, concorrência e arquivamento", async () => {
  await resetWorkspace(PF_WORKSPACE);
  await seedWorkspace(PF_WORKSPACE, OWNER_A, "PF");
  const auth = authContext(PF_WORKSPACE, OWNER_A);
  const created = await executeCreateGoal(auth, goalPayload(PF_WORKSPACE, "create-goal-integration-0001"));
  const goalId = String(created.goalId);
  assert.match(goalId, /^[A-Za-z0-9]{20}$/, "a identidade deve ser o ID real gerado pelo Firestore");

  const prelinkedPayload = {
    workspaceId: PF_WORKSPACE,
    idempotencyKey: "save-prelinked-contribution-0001",
    contribution: {
      goalId,
      description: "Aporte liquidado",
      category: "CDB",
      value: 100.25,
      date: "2026-08-01",
      walletId: "wallet-firestore-string-id",
      isPaid: true,
    },
  };
  const first = await executeSaveGoalContribution(auth, prelinkedPayload);
  const replay = await executeSaveGoalContribution(auth, prelinkedPayload);
  assert.deepEqual(replay, first);
  const edited = await executeSaveGoalContribution(auth, {
    ...prelinkedPayload,
    idempotencyKey: "edit-prelinked-contribution-0001",
    transactionId: String(first.transactionId),
    contribution: {...prelinkedPayload.contribution, value: 120.25},
  });
  assert.equal(edited.currentAmount, 120.25);

  const pending = await executeSaveGoalContribution(auth, {
    workspaceId: PF_WORKSPACE,
    idempotencyKey: "save-pending-contribution-0001",
    contribution: {
      goalId,
      description: "Aporte pendente",
      category: "Tesouro Direto",
      value: 900,
      date: "2026-08-02",
      isPaid: false,
    },
  });
  assert.equal(pending.currentAmount, 120.25);

  const retroRef = getDb().doc(`workspaces/${PF_WORKSPACE}/transactions/retroactive-string-id`);
  await retroRef.set({
    type: "investimento",
    description: "Aporte retroativo",
    category: "CDB",
    value: 50.1,
    valueCents: 5010,
    date: "2026-07-01",
    isPaid: true,
    userId: OWNER_A,
    workspaceId: PF_WORKSPACE,
  });
  const linked = await executeSetGoalTransactionLinks(auth, {
    workspaceId: PF_WORKSPACE,
    idempotencyKey: "retroactive-link-integration-0001",
    goalId,
    transactionIds: [String(first.transactionId), String(pending.transactionId), retroRef.id],
  });
  assert.equal(linked.currentAmount, 170.35);

  await Promise.all([
    executeSaveGoalContribution(auth, {
      workspaceId: PF_WORKSPACE,
      idempotencyKey: "concurrent-contribution-a-0001",
      contribution: {goalId, description: "Concorrente A", category: "CDB", value: 10, date: "2026-08-03", isPaid: true},
    }),
    executeSaveGoalContribution(auth, {
      workspaceId: PF_WORKSPACE,
      idempotencyKey: "concurrent-contribution-b-0001",
      contribution: {goalId, description: "Concorrente B", category: "CDB", value: 20, date: "2026-08-03", isPaid: true},
    }),
  ]);
  const rebuilt = await executeRebuildGoalProgress(auth, {
    workspaceId: PF_WORKSPACE,
    idempotencyKey: "rebuild-after-concurrency-0001",
    goalId,
    reason: "Reconciliação do teste de concorrência",
  });
  assert.equal(rebuilt.currentAmount, 200.35);

  await executeSetGoalTransactionLinks(auth, {
    workspaceId: PF_WORKSPACE,
    idempotencyKey: "unlink-retroactive-integration-0001",
    goalId,
    transactionIds: [String(first.transactionId), String(pending.transactionId)],
  });
  const unlinkedGoal = await getDb().doc(`workspaces/${PF_WORKSPACE}/goals/${goalId}`).get();
  assert.equal(unlinkedGoal.data()?.currentAmount, 120.25);

  await executeArchiveGoal(auth, {
    workspaceId: PF_WORKSPACE,
    idempotencyKey: "archive-goal-history-0001",
    goalId,
    reason: "Encerramento de teste com histórico",
  });
  const archivedGoal = await getDb().doc(`workspaces/${PF_WORKSPACE}/goals/${goalId}`).get();
  assert.equal(archivedGoal.exists, true);
  assert.equal(archivedGoal.data()?.archived, true);
  assert.equal((await getDb().doc(`workspaces/${PF_WORKSPACE}/transactions/${first.transactionId}`).get()).exists, true);

  const currentValueGoal = await executeCreateGoal(auth, {
    ...goalPayload(PF_WORKSPACE, "create-current-value-goal-0001"),
    goal: {
      ...goalPayload(PF_WORKSPACE, "ignored-current-value-key").goal,
      name: "Meta por valor atual",
      progressBasis: "current_value",
      currentValue: 321.45,
    },
  });
  const currentValueGoalId = String(currentValueGoal.goalId);
  const currentValueContribution = await executeSaveGoalContribution(auth, {
    workspaceId: PF_WORKSPACE,
    idempotencyKey: "current-value-contribution-0001",
    contribution: {
      goalId: currentValueGoalId,
      description: "Aporte sem alterar valor atual",
      category: "CDB",
      value: 500,
      date: "2026-08-04",
      isPaid: true,
    },
  });
  assert.equal(currentValueContribution.currentAmount, 321.45);
});

test("seed legado PF/PJ é idempotente e preserva workspaces existentes", async () => {
  await Promise.all([resetWorkspace(PF_WORKSPACE), resetWorkspace(PJ_WORKSPACE)]);
  await Promise.all([
    seedWorkspace(PF_WORKSPACE, OWNER_A, "PF"),
    seedWorkspace(PJ_WORKSPACE, OWNER_B, "PJ"),
  ]);
  const pfAuth = authContext(PF_WORKSPACE, OWNER_A);
  const pjAuth = authContext(PJ_WORKSPACE, OWNER_B);
  const pfSeed = await executeSeedLegacySettingsCatalog(pfAuth, {
    workspaceId: PF_WORKSPACE,
    idempotencyKey: "seed-legacy-catalog-pf-0001",
  });
  const pfReplay = await executeSeedLegacySettingsCatalog(pfAuth, {
    workspaceId: PF_WORKSPACE,
    idempotencyKey: "seed-legacy-catalog-pf-0001",
  });
  assert.deepEqual(pfReplay, pfSeed);
  await executeSeedLegacySettingsCatalog(pjAuth, {
    workspaceId: PJ_WORKSPACE,
    idempotencyKey: "seed-legacy-catalog-pj-0001",
  });
  assert.equal((await getDb().collection("workspaces").get()).docs.some((item) => item.id === PF_WORKSPACE), true);
  assert.equal((await getDb().collection("workspaces").get()).docs.some((item) => item.id === PJ_WORKSPACE), true);
  const pfCostCenters = await getDb().collection(`workspaces/${PF_WORKSPACE}/settings_catalog`).where("group", "==", "cost_center").get();
  const pjCostCenters = await getDb().collection(`workspaces/${PJ_WORKSPACE}/settings_catalog`).where("group", "==", "cost_center").get();
  assert.equal(pfCostCenters.empty, true);
  assert.equal(pjCostCenters.size, 3);
});

test("RBAC rejeita acesso cruzado nos dois sentidos", async () => {
  await Promise.all([resetWorkspace(PF_WORKSPACE), resetWorkspace(OTHER_WORKSPACE)]);
  await Promise.all([
    seedWorkspace(PF_WORKSPACE, OWNER_A, "PF"),
    seedWorkspace(OTHER_WORKSPACE, OWNER_B, "PF"),
  ]);
  const request = (uid: string, workspaceId: string) => ({auth: {uid, token: {}}, data: {workspaceId}} as any);
  const denied = (uid: string, workspaceId: string) => assert.rejects(
    () => requireWorkspaceRole(request(uid, workspaceId), workspaceId, ["owner", "admin", "member"]),
    (error: unknown) => error instanceof CreditCardApplicationError && error.code === "workspace_membership_required",
  );
  await denied(OWNER_A, OTHER_WORKSPACE);
  await denied(OWNER_B, PF_WORKSPACE);
});
