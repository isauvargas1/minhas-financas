import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";

import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {
  GOAL_CONTRIBUTIONS_SCAN_LIMIT,
  executeArchiveGoal,
  executeCreateGoal,
  executeRebuildGoalProgress,
  executeSaveGoalContribution,
} from "../operations";

/**
 * Meta acima do teto de varredura em transação (NEW-06).
 *
 * O teto existe porque uma transação do Firestore não pode somar o histórico
 * inteiro. O que **não** pode acontecer é a meta virar um beco sem saída:
 * antes, acima do teto o aporte era recusado, o arquivamento era recusado, o
 * gatilho lançava, e a rotina de reconstrução citada no erro tinha o mesmo
 * teto — não havia caminho de volta.
 *
 * Este teste semeia o histórico logo acima do teto e exige três coisas: o
 * aporte continua sendo aceito, a meta continua podendo ser arquivada, e a
 * reconstrução paginada publica o valor absoluto correto.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório.");
}

const WORKSPACE = "goal-progress-scale";
const OWNER = "goal-scale-owner";

const getDb = () => {
  if (!admin.apps.length) {
    admin.initializeApp({projectId: process.env.GCLOUD_PROJECT || "minhas-financas-local"});
  }
  return admin.firestore();
};

const auth = (): WorkspaceAuthorizationContext => ({
  workspaceId: WORKSPACE, uid: OWNER, role: "owner",
});

/** Um centavo por aporte: a soma esperada é a própria contagem. */
const CONTRIBUTION_CENTS = 1;
const SEEDED = GOAL_CONTRIBUTIONS_SCAN_LIMIT + 1;

const seedContributions = async (goalId: string) => {
  const db = getDb();
  const collection = db.collection(`workspaces/${WORKSPACE}/transactions`);
  for (let start = 0; start < SEEDED; start += 400) {
    const batch = db.batch();
    for (let index = start; index < Math.min(start + 400, SEEDED); index += 1) {
      batch.set(collection.doc(`seed-${String(index).padStart(6, "0")}`), {
        type: "investimento",
        description: `Aporte ${index}`,
        category: "CDB",
        value: CONTRIBUTION_CENTS / 100,
        valueCents: CONTRIBUTION_CENTS,
        date: "2026-01-05",
        isPaid: true,
        goalId,
        userId: OWNER,
        workspaceId: WORKSPACE,
      });
    }
    await batch.commit();
  }
};

test("meta acima do teto de varredura continua operável e reconciliável", async () => {
  const db = getDb();
  await db.recursiveDelete(db.doc(`workspaces/${WORKSPACE}`));
  const now = admin.firestore.Timestamp.now();
  await db.doc(`workspaces/${WORKSPACE}`).set({
    ownerId: OWNER, type: "PF", name: WORKSPACE, createdAt: now, updatedAt: now,
  });
  await db.doc(`workspaces/${WORKSPACE}/members/${OWNER}`).set({
    uid: OWNER, role: "owner", status: "active",
  });

  const created = await executeCreateGoal(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "scale-create-goal-0001",
    goal: {
      name: "Meta com histórico longo",
      description: "Histórico acima do teto de varredura",
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
  const goalId = String(created.goalId);
  await seedContributions(goalId);

  // A meta parte do valor já publicado: é a base do delta acima do teto.
  const goalRef = db.doc(`workspaces/${WORKSPACE}/goals/${goalId}`);
  await goalRef.update({netContributionCents: SEEDED * CONTRIBUTION_CENTS});

  // 1. O aporte continua sendo aceito e soma exatamente o próprio valor.
  const contribution = await executeSaveGoalContribution(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "scale-save-contribution-0001",
    contribution: {
      goalId,
      description: "Aporte acima do teto",
      category: "CDB",
      value: 10,
      date: "2026-02-01",
      isPaid: true,
    },
  });
  assert.equal(contribution.success, true);
  assert.equal(
    (await goalRef.get()).data()?.netContributionCents,
    SEEDED * CONTRIBUTION_CENTS + 1_000,
  );

  // 2. A reconstrução paginada publica o valor absoluto, somando tudo.
  const rebuilt = await executeRebuildGoalProgress(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "scale-rebuild-0001",
    goalId,
    reason: "Reconciliação após histórico longo",
    pageSize: 300,
  });
  assert.equal(rebuilt.contributionCount, SEEDED + 1);
  assert.equal(
    (await goalRef.get()).data()?.netContributionCents,
    SEEDED * CONTRIBUTION_CENTS + 1_000,
  );

  // Reexecutar publica o mesmo valor: a soma é absoluta, não incremental.
  await executeRebuildGoalProgress(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "scale-rebuild-0002",
    goalId,
    reason: "Reconciliação repetida",
    pageSize: 500,
  });
  assert.equal(
    (await goalRef.get()).data()?.netContributionCents,
    SEEDED * CONTRIBUTION_CENTS + 1_000,
  );

  // 3. Arquivar não depende do tamanho do histórico.
  const archived = await executeArchiveGoal(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "scale-archive-0001",
    goalId,
    reason: "Encerrada após reconciliação",
  });
  assert.equal(archived.success, true);
  assert.equal(archived.historyTruncated, true);
  assert.equal(archived.historyCount, GOAL_CONTRIBUTIONS_SCAN_LIMIT);
  assert.equal((await goalRef.get()).data()?.archived, true);
});
