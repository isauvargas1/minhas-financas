import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {
  compareInvestmentProjections,
  inspectWorkspaceDrift,
} from "../investmentDrift";

/**
 * Detecção agendada de deriva (INV-P2-019).
 *
 * A deriva só era medida **durante** um rebuild, e o rebuild só roda quando
 * alguém o dispara: uma divergência entre o ledger e as projeções podia
 * persistir indefinidamente sem ninguém saber.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório.");
}

const PROJECT = process.env.GCLOUD_PROJECT ?? "minhas-financas-local";
const WORKSPACE = "drift-scan-workspace";
const OWNER = "drift-scan-owner";

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const now = () => Timestamp.now();

const seed = async (summaryOverrides: Record<string, number> = {}) => {
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
  await db().doc(`workspaces/${WORKSPACE}`).set({
    ownerId: OWNER, type: "PF", name: "Drift", currency: "BRL",
  });
  // Duas posições somando 150.000 de principal e de valor atual.
  for (const [id, principal] of [["p1", 100_000], ["p2", 50_000]] as const) {
    await db().doc(`workspaces/${WORKSPACE}/investment_positions/${id}`).set({
      id, workspaceId: WORKSPACE, profileType: "PF", accountId: "acc",
      assetId: `ast-${id}`, currency: "BRL", status: "active",
      quantityMicros: principal * 10, principalCents: principal,
      realizedGainCents: 0, realizedLossCents: 0, feesCents: 0, taxCents: 0,
      currentValueCents: principal, unrealizedAppreciationCents: 0,
      calculationVersion: "investment-v2-cents-micros-half-up",
      version: 1, createdAt: now(), updatedAt: now(), updatedBy: OWNER,
    });
  }
  await db().doc(`workspaces/${WORKSPACE}/investment_summaries/current`).set({
    id: "current", workspaceId: WORKSPACE, profileType: "PF", currency: "BRL",
    positionCount: 2, principalCents: 150_000, currentValueCents: 150_000,
    realizedGainCents: 0, realizedLossCents: 0, feesCents: 0, taxCents: 0,
    unrealizedAppreciationCents: 0, updatedAt: now(), updatedBy: OWNER,
    ...summaryOverrides,
  });
  await db().doc(`workspaces/${WORKSPACE}/investment_report_periods/2026-08`).set({
    id: "2026-08", workspaceId: WORKSPACE, profileType: "PF", currency: "BRL",
    period: "2026-08", periodStart: now(),
    contributionCents: 150_000, redemptionPrincipalCents: 0,
    realizedGainCents: 0, realizedLossCents: 0, feesCents: 0, taxCents: 0,
    costDeltaCents: 150_000, currentValueDeltaCents: 150_000,
    cashDeltaCents: -150_000, settledMovementCount: 2,
    closingCurrentValueCents: 150_000,
    updatedAt: now(), updatedBy: OWNER,
  });
};

const report = async () => {
  const snapshot = await db()
    .collection(`workspaces/${WORKSPACE}/investment_drift_reports`)
    .get();
  return snapshot.docs[0]?.data();
};

test("a regra de comparação aponta cada grandeza divergente por nome", () => {
  const totals = {
    positionCount: 2, principalCents: 150_000, currentValueCents: 150_000,
    realizedGainCents: 0, realizedLossCents: 0, feesCents: 0, taxCents: 0,
  };
  assert.deepEqual(
    compareInvestmentProjections(totals, {
      positionCount: 2, principalCents: 150_000, currentValueCents: 150_000,
      realizedGainCents: 0, realizedLossCents: 0, feesCents: 0, taxCents: 0,
    }, 150_000),
    [],
  );

  const findings = compareInvestmentProjections(totals, {
    positionCount: 3, principalCents: 149_000, currentValueCents: 150_000,
    realizedGainCents: 0, realizedLossCents: 0, feesCents: 0, taxCents: 0,
  }, 150_000);
  assert.deepEqual(
    findings.map((finding) => finding.kind).sort(),
    ["position_count", "principal"],
  );
  assert.equal(
    findings.find((finding) => finding.kind === "principal")?.differenceCents,
    1_000,
  );
});

test("workspace íntegro é registrado como limpo", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  await seed();
  const result = await inspectWorkspaceDrift(WORKSPACE, "corr-drift-clean");
  assert.deepEqual(result.findings, []);

  const registered = await report();
  assert.equal(registered?.status, "clean");
  assert.equal(registered?.findingCount, 0);
  assert.equal(registered?.workspaceId, WORKSPACE);
  assert.equal(registered?.correlationId, "corr-drift-clean");
  assert.ok(registered?.detectedAt, "O registro precisa carregar o instante.");
  // Retenção: relatório operacional não é fato financeiro.
  assert.ok(registered?.expiresAt, "O registro precisa carregar a expiração.");
});

test("deriva injetada no resumo é detectada e registrada com magnitude", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  // Resumo inflado em R$ 9,99 sem lastro nas posições.
  await seed({principalCents: 150_999});
  const result = await inspectWorkspaceDrift(WORKSPACE, "corr-drift-injected");

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].kind, "principal");
  assert.equal(result.findings[0].differenceCents, -999);

  const registered = await report();
  assert.equal(registered?.status, "drift_detected");
  assert.equal(registered?.findingCount, 1);
  assert.equal(registered?.maxDifferenceCents, 999);
  assert.deepEqual(
    (registered?.findings as Array<Record<string, unknown>>).map((f) => f.kind),
    ["principal"],
  );
});

test("divergência entre fechamento e resumo é detectada", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  await seed();
  // A série diz que o mês fechou em 140.000; o resumo diz 150.000.
  await db().doc(`workspaces/${WORKSPACE}/investment_report_periods/2026-08`)
    .update({closingCurrentValueCents: 140_000});

  const result = await inspectWorkspaceDrift(WORKSPACE, "corr-drift-closing");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].kind, "closing_vs_summary");
  assert.equal(result.findings[0].differenceCents, 10_000);
});

test("o registro não carrega dado de pessoa nem lançamento individual", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  await seed({principalCents: 150_999});
  await inspectWorkspaceDrift(WORKSPACE, "corr-drift-privacy");
  const registered = await report();

  const keys = Object.keys(registered ?? {}).sort();
  assert.deepEqual(keys, [
    "correlationId", "date", "detectedAt", "expiresAt", "findingCount",
    "findings", "id", "maxDifferenceCents", "positionsInspected", "status",
    "workspaceId",
  ]);
  // Cada achado carrega tipo e magnitude, e nada além disso.
  for (const finding of registered?.findings as Array<Record<string, unknown>>) {
    assert.deepEqual(Object.keys(finding).sort(), ["differenceCents", "kind"]);
  }
});

test("workspace sem resumo não gera registro nem falso positivo", {
  skip: !process.env.FIRESTORE_EMULATOR_HOST,
}, async () => {
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
  await db().doc(`workspaces/${WORKSPACE}`).set({
    ownerId: OWNER, type: "PF", name: "Drift", currency: "BRL",
  });

  const result = await inspectWorkspaceDrift(WORKSPACE, "corr-drift-empty");
  assert.deepEqual(result.findings, []);
  assert.equal(await report(), undefined);

  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
});
