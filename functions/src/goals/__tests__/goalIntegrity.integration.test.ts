import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";

import {requireWorkspaceRole} from "../../creditCards/auth";
import {CreditCardApplicationError} from "../../creditCards/errors";
import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {
  executeArchiveGoal,
  executeCreateGoal,
  executeSeedLegacySettingsCatalog,
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

/*
 * Arquivamento de meta sem varredura de `transactions`.
 *
 * A versão anterior lia até 2.001 aportes legados por arquivamento só para
 * registrar quantos eram. O progresso patrimonial já é publicado na própria
 * meta por `updateGoalProjection`, a partir das posições: é ele que a trilha
 * de auditoria passa a guardar, sem custo de leitura e sem tocar em caixa.
 */
test("arquivar preserva o histórico e registra o progresso patrimonial", async () => {
  await resetWorkspace(PF_WORKSPACE);
  await seedWorkspace(PF_WORKSPACE, OWNER_A, "PF");
  const auth = authContext(PF_WORKSPACE, OWNER_A);
  const created = await executeCreateGoal(auth, goalPayload(PF_WORKSPACE, "goal-archive-0000001"));
  const goalId = String(created.goalId);

  // Progresso publicado pelo domínio patrimonial, como faria um aporte.
  await getDb().doc(`workspaces/${PF_WORKSPACE}/goals/${goalId}`).update({
    investmentProgressCents: 250_000,
  });

  const archived = await executeArchiveGoal(auth, {
    workspaceId: PF_WORKSPACE,
    idempotencyKey: "goal-archive-0000002",
    goalId,
    reason: "Meta concluída no teste",
  });
  assert.equal(archived.archivedProgressCents, 250_000);

  const goal = await getDb().doc(`workspaces/${PF_WORKSPACE}/goals/${goalId}`).get();
  assert.equal(goal.exists, true, "arquivar nunca apaga o documento da meta");
  assert.equal(goal.data()?.archived, true);
  assert.equal(goal.data()?.status, "cancelada");
  assert.equal(goal.data()?.investmentProgressCents, 250_000);

  // Repetir a mesma intenção é replay, não um segundo arquivamento.
  const replay = await executeArchiveGoal(auth, {
    workspaceId: PF_WORKSPACE,
    idempotencyKey: "goal-archive-0000002",
    goalId,
    reason: "Meta concluída no teste",
  });
  assert.deepEqual(replay, archived);
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
