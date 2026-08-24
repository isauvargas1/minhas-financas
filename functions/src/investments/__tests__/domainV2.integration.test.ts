import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {CreditCardApplicationError} from "../../creditCards/errors";
import {
  deterministicDocumentId,
  investmentPositionId,
  sha256,
} from "../infrastructure";
import {
  executeArchiveInvestmentAccount,
  executeArchiveInvestmentAsset,
  executeCreateInvestmentContribution,
  executeCreateInvestmentRedemptionV2,
  executeLinkInvestmentToGoal,
  executeReverseInvestmentMovement,
  executeSettleInvestmentRedemption,
  executeSaveInvestmentAccount,
  executeSaveInvestmentAsset,
  executeUnlinkInvestmentFromGoal,
} from "../operationsV2";
import {
  executeRecalculateGoalInvestmentProgress,
  executeRecalculateInvestmentPosition,
} from "../rebuild";
import {executeOnboardInvestmentWorkspace} from "../onboarding";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST é obrigatório para os testes do domínio M3.",
  );
}

const PROJECT = process.env.GCLOUD_PROJECT ?? "minhas-financas-local";
const WORKSPACE_A = "investment-v2-workspace-a";
const WORKSPACE_B = "investment-v2-workspace-b";
const OWNER_A = "investment-v2-owner-a";
const OWNER_B = "investment-v2-owner-b";
const ADMIN_A = "investment-v2-admin-a";
const MEMBER_A = "investment-v2-member-a";
const VIEWER_A = "investment-v2-viewer-a";
const REMOVED_A = "investment-v2-removed-a";
const ACCOUNT = "investment-account-a";
const ASSET = "investment-asset-a";
const SECOND_ACCOUNT = "investment-account-second";
const SECOND_ASSET = "investment-asset-second";
const GOAL = "investment-goal-a";

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const auth = (
  workspaceId = WORKSPACE_A,
  uid = OWNER_A,
  role: WorkspaceAuthorizationContext["role"] = "owner",
): WorkspaceAuthorizationContext => ({workspaceId, uid, role});

const seedWorkspace = async (
  workspaceId: string,
  ownerId: string,
  profileType: "PF" | "PJ" = "PF",
): Promise<void> => {
  await db().recursiveDelete(db().doc(`workspaces/${workspaceId}`));
  await db().doc(`workspaces/${workspaceId}`).set({
    ownerId,
    type: profileType,
    currency: "BRL",
    name: workspaceId,
  });
  await db().doc(`workspaces/${workspaceId}/members/${ownerId}`).set({
    uid: ownerId,
    role: "owner",
    status: "active",
  });
};

const seedMember = async (
  workspaceId: string,
  uid: string,
  role: "admin" | "member" | "viewer",
  status = "active",
): Promise<void> => {
  await db()
    .doc(`workspaces/${workspaceId}/members/${uid}`)
    .set({uid, role, status});
};

const seedCatalog = async (
  workspaceId: string,
  profileType: "PF" | "PJ",
  accountId = ACCOUNT,
  assetId = ASSET,
): Promise<void> => {
  const now = Timestamp.fromDate(new Date("2026-08-01T00:00:00.000Z"));
  await Promise.all([
    db().doc(`workspaces/${workspaceId}/investment_accounts/${accountId}`).set({
      id: accountId,
      workspaceId,
      profileType,
      name: "Conta de investimentos",
      institutionName: "Instituição de teste",
      currency: "BRL",
      status: "active",
      createdBy: "seed",
      updatedBy: "seed",
      createdAt: now,
      updatedAt: now,
    }),
    db().doc(`workspaces/${workspaceId}/investment_assets/${assetId}`).set({
      id: assetId,
      workspaceId,
      profileType,
      name: "Ativo de teste",
      symbol: "TEST",
      assetType: "fixed_income",
      currency: "BRL",
      status: "active",
      createdBy: "seed",
      updatedBy: "seed",
      createdAt: now,
      updatedAt: now,
    }),
  ]);
};

const seedGoal = async (
  workspaceId = WORKSPACE_A,
  goalId = GOAL,
): Promise<void> => {
  await db().doc(`workspaces/${workspaceId}/goals/${goalId}`).set({
    id: goalId,
    workspaceId,
    name: "Meta de investimentos",
    progressBasis: "net_contributions",
    investmentNetContributionCents: 0,
    investmentCurrentValueCents: 0,
    investmentProgressCents: 0,
    investmentProjectionVersion: 0,
  });
};

const contributionPayload = (
  idempotencyKey: string,
  overrides: Partial<{
    workspaceId: string;
    accountId: string;
    assetId: string;
    goalId: string;
    principalCents: number;
    quantityMicros: number;
  }> = {},
) => ({
  workspaceId: overrides.workspaceId ?? WORKSPACE_A,
  idempotencyKey,
  correlationId: `corr-${idempotencyKey}`,
  accountId: overrides.accountId ?? ACCOUNT,
  assetId: overrides.assetId ?? ASSET,
  ...(overrides.goalId ? {goalId: overrides.goalId} : {}),
  walletId: "wallet-a",
  description: "Aporte no domínio oficial",
  principalCents: overrides.principalCents ?? 100_000,
  quantityMicros: overrides.quantityMicros ?? 1_000_000,
  feesCents: 0,
  taxCents: 0,
  occurredAt: "2026-08-10T12:00:00.000Z",
});

test(
  "aporte, resgate pending/settled e estorno reconciliam sem dupla contagem",
  async () => {
    await seedWorkspace(WORKSPACE_A, OWNER_A);
    await Promise.all([seedCatalog(WORKSPACE_A, "PF"), seedGoal()]);
    const contributionInput = contributionPayload("m3-contribution-main-0001", {
      goalId: GOAL,
    });
    const contribution = await executeCreateInvestmentContribution(
      auth(),
      contributionInput,
    );
    assert.deepEqual(
      await executeCreateInvestmentContribution(auth(), contributionInput),
      contribution,
    );
    const positionId = String(contribution.positionId);
    let position = await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_positions/${positionId}`)
      .get();
    let goal = await db().doc(`workspaces/${WORKSPACE_A}/goals/${GOAL}`).get();
    assert.equal(position.data()?.principalCents, 100_000);
    assert.equal(position.data()?.currentValueCents, 100_000);
    assert.equal(goal.data()?.investmentNetContributionCents, 100_000);
    let summary = await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_summaries/current`)
      .get();
    assert.equal(summary.data()?.principalCents, 100_000);
    assert.equal(summary.data()?.currentValueCents, 100_000);
    let reportPeriod = await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_report_periods/2026-08`)
      .get();
    assert.equal(reportPeriod.data()?.contributionCents, 100_000);
    assert.equal(
      reportPeriod.data()?.daily?.["2026-08-10"]?.contributionCents,
      100_000,
    );
    assert.equal(reportPeriod.data()?.redemptionPrincipalCents, 0);
    assert.equal(reportPeriod.data()?.settledMovementCount, 1);

    const pendingInput = {
      workspaceId: WORKSPACE_A,
      idempotencyKey: "m3-redemption-pending-0001",
      correlationId: "corr-m3-redemption-pending-0001",
      accountId: ACCOUNT,
      assetId: ASSET,
      walletId: "wallet-a",
      description: "Resgate parcial oficial",
      requestedPrincipalCents: 40_000,
      requestedQuantityMicros: 400_000,
      requestedAt: "2026-08-18T10:00:00.000Z",
      expectedSettlementAt: "2026-08-19T12:00:00.000Z",
    };
    const pending = await executeCreateInvestmentRedemptionV2(
      auth(),
      pendingInput,
    );
    position = await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_positions/${positionId}`)
      .get();
    goal = await db().doc(`workspaces/${WORKSPACE_A}/goals/${GOAL}`).get();
    assert.equal(position.data()?.principalCents, 100_000);
    assert.equal(goal.data()?.investmentNetContributionCents, 100_000);
    summary = await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_summaries/current`)
      .get();
    assert.equal(summary.data()?.principalCents, 100_000);
    reportPeriod = await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_report_periods/2026-08`)
      .get();
    assert.equal(reportPeriod.data()?.settledMovementCount, 1);
    const pendingProjection = await db()
      .doc(`workspaces/${WORKSPACE_A}/transactions/${pending.transactionId}`)
      .get();
    assert.equal(pendingProjection.data()?.isPaid, false);
    assert.equal(
      pendingProjection.data()?.investmentMetadata.cashImpact,
      "none",
    );

    const settlementInput = {
      workspaceId: WORKSPACE_A,
      idempotencyKey: "m3-redemption-settle-0001",
      correlationId: "corr-m3-redemption-settle-0001",
      movementId: String(pending.movementId),
      settlement: {
        principalCents: 40_000,
        quantityMicros: 400_000,
        gainCents: 5_000,
        lossCents: 0,
        feesCents: 500,
        taxCents: 1_000,
      },
      settledAt: "2026-08-19T12:00:00.000Z",
    };
    const settled = await executeSettleInvestmentRedemption(
      auth(),
      settlementInput,
    );
    assert.deepEqual(
      await executeSettleInvestmentRedemption(auth(), settlementInput),
      settled,
    );
    position = await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_positions/${positionId}`)
      .get();
    goal = await db().doc(`workspaces/${WORKSPACE_A}/goals/${GOAL}`).get();
    assert.equal(settled.cashDeltaCents, 43_500);
    assert.equal(position.data()?.principalCents, 60_000);
    assert.equal(position.data()?.realizedGainCents, 5_000);
    assert.equal(position.data()?.feesCents, 500);
    assert.equal(position.data()?.taxCents, 1_000);
    assert.equal(goal.data()?.investmentNetContributionCents, 60_000);
    summary = await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_summaries/current`)
      .get();
    assert.equal(summary.data()?.principalCents, 60_000);
    assert.equal(summary.data()?.realizedGainCents, 5_000);
    reportPeriod = await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_report_periods/2026-08`)
      .get();
    assert.equal(reportPeriod.data()?.redemptionPrincipalCents, 40_000);
    assert.equal(reportPeriod.data()?.realizedGainCents, 5_000);
    assert.equal(reportPeriod.data()?.feesCents, 500);
    assert.equal(reportPeriod.data()?.taxCents, 1_000);
    const settledProjection = await db()
      .doc(`workspaces/${WORKSPACE_A}/transactions/${pending.transactionId}`)
      .get();
    assert.equal(settledProjection.data()?.valueCents, 43_500);
    assert.equal(settledProjection.data()?.type, "investimento");
    assert.equal(settledProjection.data()?.investmentMetadata.gainCents, 5_000);

    const reversalInput = {
      workspaceId: WORKSPACE_A,
      idempotencyKey: "m3-redemption-reverse-0001",
      correlationId: "corr-m3-redemption-reverse-0001",
      movementId: String(pending.movementId),
      reversedAt: "2026-08-20T12:00:00.000Z",
      reason: "Liquidação informada incorretamente",
    };
    const reversal = await executeReverseInvestmentMovement(
      auth(),
      reversalInput,
    );
    assert.deepEqual(
      await executeReverseInvestmentMovement(auth(), reversalInput),
      reversal,
    );
    position = await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_positions/${positionId}`)
      .get();
    goal = await db().doc(`workspaces/${WORKSPACE_A}/goals/${GOAL}`).get();
    assert.equal(position.data()?.principalCents, 100_000);
    assert.equal(position.data()?.realizedGainCents, 0);
    assert.equal(position.data()?.feesCents, 0);
    assert.equal(position.data()?.taxCents, 0);
    assert.equal(goal.data()?.investmentNetContributionCents, 100_000);
    summary = await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_summaries/current`)
      .get();
    assert.equal(summary.data()?.principalCents, 100_000);
    assert.equal(summary.data()?.realizedGainCents, 0);
    reportPeriod = await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_report_periods/2026-08`)
      .get();
    assert.equal(reportPeriod.data()?.contributionCents, 100_000);
    assert.equal(reportPeriod.data()?.redemptionPrincipalCents, 0);
    assert.equal(reportPeriod.data()?.realizedGainCents, 0);
    assert.equal(reportPeriod.data()?.feesCents, 0);
    assert.equal(reportPeriod.data()?.taxCents, 0);
    assert.equal(
      reportPeriod.data()?.daily?.["2026-08-19"]
        ?.redemptionPrincipalCents,
      40_000,
    );
    assert.equal(
      reportPeriod.data()?.daily?.["2026-08-20"]
        ?.redemptionPrincipalCents,
      -40_000,
    );
    assert.equal(reportPeriod.data()?.costDeltaCents, 100_000);
    assert.equal(reportPeriod.data()?.currentValueDeltaCents, 100_000);
    assert.equal(reportPeriod.data()?.cashDeltaCents, -100_000);
    const goalAllocation = await db().collection(
      `workspaces/${WORKSPACE_A}/investment_allocation_summaries`,
    ).where("dimension", "==", "goal").where("key", "==", GOAL).get();
    assert.equal(goalAllocation.size, 1);
    assert.equal(goalAllocation.docs[0].data().currentValueCents, 100_000);
    const settledMovements = await db()
      .collection(`workspaces/${WORKSPACE_A}/investment_movements`)
      .where("status", "==", "settled")
      .get();
    const reconstructedPrincipal = settledMovements.docs.reduce(
      (total, document) =>
        total + Number(document.data().principalDeltaCents ?? 0),
      0,
    );
    assert.equal(reconstructedPrincipal, 100_000);
    await assert.rejects(
      () =>
        executeReverseInvestmentMovement(auth(), {
          ...reversalInput,
          idempotencyKey: "m3-redemption-reverse-again-0001",
          correlationId: "corr-m3-redemption-reverse-again-0001",
        }),
      (error: unknown) =>
        error instanceof CreditCardApplicationError &&
      error.code === "domain_precondition_failed",
    );
  },
);

test("CRUD seguro de conta e ativo é privilegiado, auditável e idempotente", async () => {
  await seedWorkspace(WORKSPACE_A, OWNER_A);
  await Promise.all([
    seedMember(WORKSPACE_A, ADMIN_A, "admin"),
    seedMember(WORKSPACE_A, MEMBER_A, "member"),
  ]);
  const accountInput = {
    workspaceId: WORKSPACE_A,
    idempotencyKey: "m5-save-account-0001",
    correlationId: "corr-m5-save-account-0001",
    name: "Conta patrimonial",
    institutionName: "Instituição Segura",
  };
  const createdAccount = await executeSaveInvestmentAccount(
    auth(WORKSPACE_A, ADMIN_A, "admin"), accountInput,
  );
  assert.deepEqual(
    await executeSaveInvestmentAccount(auth(WORKSPACE_A, ADMIN_A, "admin"), accountInput),
    createdAccount,
  );
  await assert.rejects(() => executeSaveInvestmentAccount(
    auth(WORKSPACE_A, MEMBER_A, "member"),
    {...accountInput, idempotencyKey: "m5-member-account-0001", correlationId: "corr-m5-member-account-0001"},
  ));
  const assetInput = {
    workspaceId: WORKSPACE_A,
    idempotencyKey: "m5-save-asset-0001",
    correlationId: "corr-m5-save-asset-0001",
    name: "Tesouro Selic",
    symbol: "SELIC",
    assetType: "fixed_income" as const,
  };
  const createdAsset = await executeSaveInvestmentAsset(auth(), assetInput);
  assert.equal((await db().doc(
    `workspaces/${WORKSPACE_A}/investment_assets/${createdAsset.entityId}`,
  ).get()).data()?.currency, "BRL");
  const events = await db().collection(
    `workspaces/${WORKSPACE_A}/investment_event_logs`,
  ).where("correlationId", "in", [accountInput.correlationId, assetInput.correlationId]).get();
  assert.equal(events.size, 2);
});

test("onboarding PF/PJ é owner-only, idempotente e não duplica cadastros", async () => {
  await seedWorkspace(WORKSPACE_A, OWNER_A, "PF");
  await seedMember(WORKSPACE_A, ADMIN_A, "admin");
  const legacyDedupeKey = "investment_type::all::both::renda fixa";
  await db().doc(`workspaces/${WORKSPACE_A}/settings_catalog/legacy-fixed-income`).set({
    workspaceId: WORKSPACE_A,
    group: "investment_type",
    name: "Renda fixa",
    normalizedName: "renda fixa",
    dedupeKey: legacyDedupeKey,
    workspaceScope: "both",
    sortOrder: 10,
    status: "active",
    createdBy: OWNER_A,
    updatedBy: OWNER_A,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  const pfInput = {
    workspaceId: WORKSPACE_A,
    idempotencyKey: "m6-onboarding-pf-0001",
    correlationId: "corr-m6-onboarding-pf-0001",
  };
  const first = await executeOnboardInvestmentWorkspace(auth(), pfInput);
  assert.deepEqual(await executeOnboardInvestmentWorkspace(auth(), pfInput), first);
  assert.equal(first.createdAccount, true);
  assert.equal(first.createdAsset, true);
  assert.equal((await db().collection(`workspaces/${WORKSPACE_A}/investment_accounts`).get()).size, 1);
  assert.equal((await db().collection(`workspaces/${WORKSPACE_A}/investment_assets`).get()).size, 1);
  assert.equal((await db().collection(`workspaces/${WORKSPACE_A}/settings_catalog`)
    .where("dedupeKey", "==", legacyDedupeKey).get()).size, 1);
  assert.equal((await db().doc(
    `workspaces/${WORKSPACE_A}/settings_catalog_uniques/${legacyDedupeKey}`,
  ).get()).data()?.catalogItemId, "legacy-fixed-income");
  const pfClasses = await db().collection(`workspaces/${WORKSPACE_A}/settings_catalog`)
    .where("group", "==", "investment_class").get();
  assert.ok(pfClasses.size > 0);
  assert.ok(pfClasses.docs.every((entry) => entry.data().workspaceScope === "PF"));
  await assert.rejects(() => executeOnboardInvestmentWorkspace(
    auth(WORKSPACE_A, ADMIN_A, "admin"),
    {...pfInput, idempotencyKey: "m6-onboarding-admin-0001", correlationId: "corr-m6-onboarding-admin-0001"},
  ));
  await assert.rejects(() => executeOnboardInvestmentWorkspace(
    auth(WORKSPACE_A, OWNER_A, "owner"),
    {...pfInput, workspaceId: WORKSPACE_B, idempotencyKey: "m6-onboarding-forged-0001", correlationId: "corr-m6-onboarding-forged-0001"},
  ));

  await seedWorkspace(WORKSPACE_B, OWNER_B, "PJ");
  await seedCatalog(WORKSPACE_B, "PJ");
  const pj = await executeOnboardInvestmentWorkspace(auth(WORKSPACE_B, OWNER_B), {
    workspaceId: WORKSPACE_B,
    idempotencyKey: "m6-onboarding-pj-0001",
    correlationId: "corr-m6-onboarding-pj-0001",
  });
  assert.equal(pj.createdAccount, false);
  assert.equal(pj.createdAsset, false);
  assert.equal((await db().collection(`workspaces/${WORKSPACE_B}/investment_accounts`).get()).size, 1);
  assert.equal((await db().collection(`workspaces/${WORKSPACE_B}/investment_assets`).get()).size, 1);
  const pjStrategies = await db().collection(`workspaces/${WORKSPACE_B}/settings_catalog`)
    .where("group", "==", "investment_strategy").get();
  assert.ok(pjStrategies.size > 0);
  assert.ok(pjStrategies.docs.every((entry) => entry.data().workspaceScope === "PJ"));
  const pjAssetInput = {
    workspaceId: WORKSPACE_B,
    idempotencyKey: "m7-save-pj-asset-0001",
    correlationId: "corr-m7-save-pj-asset-0001",
    name: "Reserva empresarial",
    assetType: "fixed_income" as const,
    allocationPurpose: "reserve" as const,
  };
  const pjAsset = await executeSaveInvestmentAsset(
    auth(WORKSPACE_B, OWNER_B),
    pjAssetInput,
  );
  assert.equal((await db().doc(
    `workspaces/${WORKSPACE_B}/investment_assets/${pjAsset.entityId}`,
  ).get()).data()?.allocationPurpose, "reserve");
  await assert.rejects(() => executeSaveInvestmentAsset(
    auth(WORKSPACE_B, OWNER_B),
    {
      ...pjAssetInput,
      idempotencyKey: "m7-save-pj-invalid-0001",
      correlationId: "corr-m7-save-pj-invalid-0001",
      allocationPurpose: "retirement",
    },
  ));
});

test("concorrência, falha atômica e retry não excedem a posição", async () => {
  await seedWorkspace(WORKSPACE_A, OWNER_A);
  await seedCatalog(WORKSPACE_A, "PF");
  await executeCreateInvestmentContribution(
    auth(),
    contributionPayload("m3-concurrency-contribution-0001", {
      principalCents: 50_000,
      quantityMicros: 500_000,
    }),
  );
  const pendingResults = await Promise.all([
    executeCreateInvestmentRedemptionV2(auth(), {
      workspaceId: WORKSPACE_A,
      idempotencyKey: "m3-concurrency-pending-a-0001",
      correlationId: "corr-m3-concurrency-pending-a-0001",
      accountId: ACCOUNT,
      assetId: ASSET,
      description: "Resgate concorrente A",
      requestedPrincipalCents: 30_000,
      requestedQuantityMicros: 300_000,
      requestedAt: "2026-08-18T10:00:00.000Z",
    }),
    executeCreateInvestmentRedemptionV2(auth(), {
      workspaceId: WORKSPACE_A,
      idempotencyKey: "m3-concurrency-pending-b-0001",
      correlationId: "corr-m3-concurrency-pending-b-0001",
      accountId: ACCOUNT,
      assetId: ASSET,
      description: "Resgate concorrente B",
      requestedPrincipalCents: 30_000,
      requestedQuantityMicros: 300_000,
      requestedAt: "2026-08-18T10:00:01.000Z",
    }),
  ]);
  const settle = (movementId: string, suffix: string) =>
    executeSettleInvestmentRedemption(auth(), {
      workspaceId: WORKSPACE_A,
      idempotencyKey: `m3-concurrency-settle-${suffix}-0001`,
      correlationId: `corr-m3-concurrency-settle-${suffix}-0001`,
      movementId,
      settlement: {
        principalCents: 30_000,
        quantityMicros: 300_000,
        gainCents: 0,
        lossCents: 0,
        feesCents: 0,
        taxCents: 0,
      },
      settledAt: "2026-08-19T12:00:00.000Z",
    });
  const outcomes = await Promise.allSettled([
    settle(String(pendingResults[0].movementId), "a"),
    settle(String(pendingResults[1].movementId), "b"),
  ]);
  assert.equal(
    outcomes.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    outcomes.filter((result) => result.status === "rejected").length,
    1,
  );
  const positionId = investmentPositionId(ACCOUNT, ASSET);
  let position = await db()
    .doc(`workspaces/${WORKSPACE_A}/investment_positions/${positionId}`)
    .get();
  assert.equal(position.data()?.principalCents, 20_000);

  const pendingFailure =
    pendingResults.find((candidate) => {
      const fulfilled = outcomes.find(
        (outcome) => outcome.status === "fulfilled",
      );
      return (
        candidate.movementId !==
        (fulfilled?.status === "fulfilled" ?
          fulfilled.value.movementId :
          undefined)
      );
    }) ?? pendingResults[1];
  const failureKey = "m3-partial-failure-settle-0001";
  const invalidSettlement = {
    workspaceId: WORKSPACE_A,
    idempotencyKey: failureKey,
    correlationId: "corr-m3-partial-failure-settle-0001",
    movementId: String(pendingFailure.movementId),
    settlement: {
      principalCents: 30_001,
      quantityMicros: 300_000,
      gainCents: 0,
      lossCents: 0,
      feesCents: 0,
      taxCents: 0,
    },
    settledAt: "2026-08-20T12:00:00.000Z",
  };
  await assert.rejects(() =>
    executeSettleInvestmentRedemption(auth(), invalidSettlement),
  );
  const idempotencyHash = sha256(`${OWNER_A}:${failureKey}`).slice(0, 32);
  const idempotencyId = `settleInvestmentRedemption_${idempotencyHash}`;
  const idempotencyPath =
    `workspaces/${WORKSPACE_A}/investment_idempotency_keys/${idempotencyId}`;
  assert.equal(
    (
      await db()
        .doc(idempotencyPath)
        .get()
    ).exists,
    false,
  );
  position = await db()
    .doc(`workspaces/${WORKSPACE_A}/investment_positions/${positionId}`)
    .get();
  assert.equal(position.data()?.principalCents, 20_000);
  const recoveredSettlement = {
    ...invalidSettlement,
    settlement: {
      ...invalidSettlement.settlement,
      principalCents: 20_000,
      quantityMicros: 200_000,
    },
  };
  const recovered = await executeSettleInvestmentRedemption(
    auth(),
    recoveredSettlement,
  );
  assert.deepEqual(
    await executeSettleInvestmentRedemption(auth(), recoveredSettlement),
    recovered,
  );
  position = await db()
    .doc(`workspaces/${WORKSPACE_A}/investment_positions/${positionId}`)
    .get();
  assert.equal(position.data()?.principalCents, 0);
});

test(
  "vínculo, rebuild paginado, valuation e arquivos preservam histórico",
  async () => {
    await seedWorkspace(WORKSPACE_A, OWNER_A);
    await Promise.all([
      seedCatalog(WORKSPACE_A, "PF"),
      seedCatalog(WORKSPACE_A, "PF", SECOND_ACCOUNT, SECOND_ASSET),
      seedGoal(),
    ]);
    const contribution = await executeCreateInvestmentContribution(
      auth(),
      contributionPayload("m3-rebuild-contribution-0001", {
        principalCents: 100_000,
        quantityMicros: 1_000_000,
      }),
    );
    const linkInput = {
      workspaceId: WORKSPACE_A,
      idempotencyKey: "m3-link-goal-0001",
      correlationId: "corr-m3-link-goal-0001",
      accountId: ACCOUNT,
      assetId: ASSET,
      goalId: GOAL,
      occurredAt: "2026-08-11T12:00:00.000Z",
      reason: "Planejamento patrimonial",
    };
    const linked = await executeLinkInvestmentToGoal(auth(), linkInput);
    assert.deepEqual(
      await executeLinkInvestmentToGoal(auth(), linkInput),
      linked,
    );
    let goal = await db().doc(`workspaces/${WORKSPACE_A}/goals/${GOAL}`).get();
    assert.equal(goal.data()?.investmentNetContributionCents, 100_000);
    const valuationAt = Timestamp.fromDate(
      new Date("2026-08-15T12:00:00.000Z"),
    );
    await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_valuations/valuation-a`)
      .set({
        id: "valuation-a",
        workspaceId: WORKSPACE_A,
        profileType: "PF",
        accountId: ACCOUNT,
        assetId: ASSET,
        currency: "BRL",
        unitPriceMicros: 1_200_000_000,
        source: "manual",
        effectiveAt: valuationAt,
        correlationId: "valuation-seed-a",
        createdBy: OWNER_A,
        createdAt: valuationAt,
      });
    const positionId = String(contribution.positionId);
    await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_positions/${positionId}`)
      .update({
        principalCents: 1,
        currentValueCents: 1,
      });
    const firstPage = await executeRecalculateInvestmentPosition(auth(), {
      workspaceId: WORKSPACE_A,
      idempotencyKey: "m3-position-rebuild-page-0001",
      correlationId: "corr-m3-position-rebuild-0001",
      accountId: ACCOUNT,
      assetId: ASSET,
      pageSize: 1,
      reason: "Reconciliação da posição",
    });
    assert.equal(firstPage.hasMore, true);
    const secondPage = await executeRecalculateInvestmentPosition(auth(), {
      workspaceId: WORKSPACE_A,
      idempotencyKey: "m3-position-rebuild-page-0002",
      correlationId: "corr-m3-position-rebuild-0001",
      rebuildId: String(firstPage.rebuildId),
      accountId: ACCOUNT,
      assetId: ASSET,
      pageSize: 1,
      reason: "Reconciliação da posição",
    });
    assert.equal(secondPage.status, "completed");
    const rebuiltPosition = await db()
      .doc(`workspaces/${WORKSPACE_A}/investment_positions/${positionId}`)
      .get();
    assert.equal(rebuiltPosition.data()?.principalCents, 100_000);
    assert.equal(rebuiltPosition.data()?.currentValueCents, 120_000);
    assert.equal(rebuiltPosition.data()?.unrealizedAppreciationCents, 20_000);
    assert.equal(rebuiltPosition.data()?.valuationId, "valuation-a");
    const transactionsAfterValuation = await db()
      .collection(`workspaces/${WORKSPACE_A}/transactions`)
      .get();
    assert.equal(transactionsAfterValuation.size, 1);
    goal = await db().doc(`workspaces/${WORKSPACE_A}/goals/${GOAL}`).get();
    assert.equal(goal.data()?.investmentProjectionDirty, true);

    await executeCreateInvestmentContribution(
      auth(),
      contributionPayload("m3-rebuild-second-position-0001", {
        accountId: SECOND_ACCOUNT,
        assetId: SECOND_ASSET,
        goalId: GOAL,
        principalCents: 20_000,
        quantityMicros: 1_000_000,
      }),
    );
    goal = await db().doc(`workspaces/${WORKSPACE_A}/goals/${GOAL}`).get();
    assert.equal(goal.data()?.investmentProjectionDirty, true);

    const goalRebuildFirst = await executeRecalculateGoalInvestmentProgress(
      auth(),
      {
        workspaceId: WORKSPACE_A,
        idempotencyKey: "m3-goal-rebuild-page-0001",
        correlationId: "corr-m3-goal-rebuild-0001",
        goalId: GOAL,
        pageSize: 1,
        reason: "Reconciliação da meta",
      },
    );
    assert.equal(goalRebuildFirst.status, "running");
    const goalRebuild = await executeRecalculateGoalInvestmentProgress(auth(), {
      workspaceId: WORKSPACE_A,
      idempotencyKey: "m3-goal-rebuild-page-0002",
      correlationId: "corr-m3-goal-rebuild-0001",
      rebuildId: String(goalRebuildFirst.rebuildId),
      goalId: GOAL,
      pageSize: 1,
      reason: "Reconciliação da meta",
    });
    assert.equal(goalRebuild.status, "completed");
    goal = await db().doc(`workspaces/${WORKSPACE_A}/goals/${GOAL}`).get();
    assert.equal(goal.data()?.investmentNetContributionCents, 120_000);
    assert.equal(goal.data()?.investmentCurrentValueCents, 140_000);
    assert.equal(goal.data()?.investmentProjectionDirty, false);

    const unlinkInput = {
      workspaceId: WORKSPACE_A,
      idempotencyKey: "m3-unlink-goal-0001",
      correlationId: "corr-m3-unlink-goal-0001",
      accountId: ACCOUNT,
      assetId: ASSET,
      goalId: GOAL,
      occurredAt: "2026-08-21T12:00:00.000Z",
      reason: "Reorganização do planejamento",
    };
    await executeUnlinkInvestmentFromGoal(auth(), unlinkInput);
    goal = await db().doc(`workspaces/${WORKSPACE_A}/goals/${GOAL}`).get();
    assert.equal(goal.data()?.investmentNetContributionCents, 20_000);
    assert.equal(goal.data()?.investmentCurrentValueCents, 20_000);
    assert.equal(
      (
        await db()
          .doc(`workspaces/${WORKSPACE_A}/investment_positions/${positionId}`)
          .get()
      ).data()?.goalId,
      undefined,
    );

    const archiveAccountInput = {
      workspaceId: WORKSPACE_A,
      idempotencyKey: "m3-archive-account-0001",
      correlationId: "corr-m3-archive-account-0001",
      accountId: ACCOUNT,
      reason: "Conta encerrada na instituição",
    };
    const archiveAssetInput = {
      workspaceId: WORKSPACE_A,
      idempotencyKey: "m3-archive-asset-0001",
      correlationId: "corr-m3-archive-asset-0001",
      assetId: ASSET,
      reason: "Ativo não recebe novos aportes",
    };
    await Promise.all([
      executeArchiveInvestmentAccount(auth(), archiveAccountInput),
      executeArchiveInvestmentAsset(auth(), archiveAssetInput),
    ]);
    assert.equal(
      (
        await db()
          .doc(`workspaces/${WORKSPACE_A}/investment_accounts/${ACCOUNT}`)
          .get()
      ).data()?.status,
      "archived",
    );
    assert.equal(
      (
        await db()
          .doc(`workspaces/${WORKSPACE_A}/investment_assets/${ASSET}`)
          .get()
      ).data()?.status,
      "archived",
    );
    const linkedMovementPath =
      `workspaces/${WORKSPACE_A}/investment_movements/${linked.movementId}`;
    assert.equal(
      (
        await db()
          .doc(linkedMovementPath)
          .get()
      ).exists,
      true,
    );
  },
);

test(
  "RBAC transacional, isolamento bidirecional e PF/PJ são explícitos",
  async () => {
    await Promise.all([
      seedWorkspace(WORKSPACE_A, OWNER_A, "PF"),
      seedWorkspace(WORKSPACE_B, OWNER_B, "PJ"),
    ]);
    await Promise.all([
      seedCatalog(WORKSPACE_A, "PF"),
      seedCatalog(WORKSPACE_B, "PJ"),
      seedMember(WORKSPACE_A, ADMIN_A, "admin"),
      seedMember(WORKSPACE_A, MEMBER_A, "member"),
      seedMember(WORKSPACE_A, VIEWER_A, "viewer"),
      seedMember(WORKSPACE_A, REMOVED_A, "member", "removed"),
    ]);
    const memberContribution = await executeCreateInvestmentContribution(
      auth(WORKSPACE_A, MEMBER_A, "member"),
      contributionPayload("m3-rbac-member-contribution-0001", {
        principalCents: 10_000,
      }),
    );
    assert.ok(memberContribution.movementId);
    await assert.rejects(
      () =>
        executeCreateInvestmentContribution(
          auth(WORKSPACE_A, VIEWER_A, "owner"),
          contributionPayload("m3-rbac-viewer-forged-0001", {
            principalCents: 1_000,
          }),
        ),
      (error: unknown) =>
        error instanceof CreditCardApplicationError &&
      error.code === "workspace_role_denied",
    );
    await assert.rejects(
      () =>
        executeCreateInvestmentContribution(
          auth(WORKSPACE_A, REMOVED_A, "owner"),
          contributionPayload("m3-rbac-removed-forged-0001", {
            principalCents: 1_000,
          }),
        ),
      (error: unknown) =>
        error instanceof CreditCardApplicationError &&
      error.code === "workspace_membership_required",
    );
    await assert.rejects(
      () =>
        executeCreateInvestmentContribution(
          auth(WORKSPACE_A, OWNER_B, "owner"),
          contributionPayload("m3-rbac-cross-a-from-b-0001", {
            principalCents: 1_000,
          }),
        ),
      (error: unknown) =>
        error instanceof CreditCardApplicationError &&
      error.code === "workspace_membership_required",
    );
    await assert.rejects(
      () =>
        executeCreateInvestmentContribution(
          auth(WORKSPACE_B, OWNER_A, "owner"),
          contributionPayload("m3-rbac-cross-b-from-a-0001", {
            workspaceId: WORKSPACE_B,
            principalCents: 1_000,
          }),
        ),
      (error: unknown) =>
        error instanceof CreditCardApplicationError &&
      error.code === "workspace_membership_required",
    );
    await assert.rejects(
      () =>
        executeCreateInvestmentContribution(
          auth(WORKSPACE_A, OWNER_A),
          contributionPayload("m3-rbac-path-payload-mismatch-0001", {
            workspaceId: WORKSPACE_B,
            principalCents: 1_000,
          }),
        ),
      (error: unknown) =>
        error instanceof CreditCardApplicationError &&
      error.code === "permission_denied",
    );
    const pj = await executeCreateInvestmentContribution(
      auth(WORKSPACE_B, OWNER_B),
      contributionPayload("m3-pj-contribution-0001", {
        workspaceId: WORKSPACE_B,
        principalCents: 20_000,
      }),
    );
    const pjMovement = await db()
      .doc(`workspaces/${WORKSPACE_B}/investment_movements/${pj.movementId}`)
      .get();
    assert.equal(pjMovement.data()?.profileType, "PJ");
    const crossTenantMovementPath =
      `workspaces/${WORKSPACE_A}/investment_movements/${pj.movementId}`;
    assert.equal(
      (
        await db()
          .doc(crossTenantMovementPath)
          .get()
      ).exists,
      false,
    );
    await assert.rejects(
      () =>
        executeArchiveInvestmentAccount(auth(WORKSPACE_A, MEMBER_A, "member"), {
          workspaceId: WORKSPACE_A,
          idempotencyKey: "m3-rbac-member-archive-0001",
          correlationId: "corr-m3-rbac-member-archive-0001",
          accountId: ACCOUNT,
          reason: "Tentativa sem privilégio",
        }),
      (error: unknown) =>
        error instanceof CreditCardApplicationError &&
      error.code === "workspace_role_denied",
    );
    const deterministic = deterministicDocumentId(
      "createInvestmentContribution",
      MEMBER_A,
      "m3-rbac-member-contribution-0001",
    );
    assert.equal(deterministic, memberContribution.movementId);
  },
);

// INV-P1-009 — resgate com prejuízo.
//
// Antes, não havia campo para perda realizada. Um resgate integral abaixo do
// custo só podia ser lançado reduzindo o `principalCents` da liquidação: a
// quantidade zerava, o custo remanescente ficava na posição sem quantidade que
// o sustentasse, e esse principal fantasma entrava no patrimônio e nas 8
// faixas de alocação. O rebuild reproduzia o mesmo valor, porque soma os
// mesmos deltas do ledger — erro irrecuperável por reconstrução.

const settleRedemption = async (
  movementId: string,
  suffix: string,
  settlement: {
    principalCents: number;
    quantityMicros: number;
    gainCents: number;
    lossCents: number;
    feesCents: number;
    taxCents: number;
  },
) =>
  executeSettleInvestmentRedemption(auth(), {
    workspaceId: WORKSPACE_A,
    idempotencyKey: `m9-loss-settle-${suffix}-0001`,
    correlationId: `corr-m9-loss-settle-${suffix}-0001`,
    movementId,
    settlement,
    settledAt: "2026-08-19T12:00:00.000Z",
  });

const requestRedemption = async (
  suffix: string,
  principalCents: number,
  quantityMicros: number,
) =>
  executeCreateInvestmentRedemptionV2(auth(), {
    workspaceId: WORKSPACE_A,
    idempotencyKey: `m9-loss-request-${suffix}-0001`,
    correlationId: `corr-m9-loss-request-${suffix}-0001`,
    accountId: ACCOUNT,
    assetId: ASSET,
    description: "Resgate abaixo do custo",
    requestedPrincipalCents: principalCents,
    requestedQuantityMicros: quantityMicros,
    requestedAt: "2026-08-18T10:00:00.000Z",
  });

const positionDocument = async () =>
  (await db()
    .doc(
      `workspaces/${WORKSPACE_A}/investment_positions/` +
        investmentPositionId(ACCOUNT, ASSET),
    )
    .get()).data();

test("resgate integral abaixo do custo zera a posição sem principal fantasma", async () => {
  await seedWorkspace(WORKSPACE_A, OWNER_A);
  await seedCatalog(WORKSPACE_A, "PF");
  await executeCreateInvestmentContribution(
    auth(),
    contributionPayload("m9-loss-contribution-0001", {
      principalCents: 100_000,
      quantityMicros: 100_000_000,
    }),
  );

  const pending = await requestRedemption("total", 100_000, 100_000_000);
  const settled = await settleRedemption(
    String(pending.movementId),
    "total",
    {
      // Custo integral retirado da posição; a diferença até o caixa recebido
      // (R$ 800,00) é perda realizada, não redução de custo.
      principalCents: 100_000,
      quantityMicros: 100_000_000,
      gainCents: 0,
      lossCents: 20_000,
      feesCents: 0,
      taxCents: 0,
    },
  );

  assert.equal(settled.cashDeltaCents, 80_000);
  assert.equal(settled.remainingPrincipalCents, 0);
  assert.equal(settled.realizedLossCents, 20_000);
  assert.equal(settled.realizedResultCents, -20_000);

  const position = await positionDocument();
  assert.equal(position?.quantityMicros, 0);
  assert.equal(position?.principalCents, 0, "sem quantidade não há custo");
  assert.equal(position?.currentValueCents, 0, "sem patrimônio fantasma");
  assert.equal(position?.realizedLossCents, 20_000);

  const summary = (await db()
    .doc(`workspaces/${WORKSPACE_A}/investment_summaries/current`)
    .get()).data();
  assert.equal(summary?.currentValueCents, 0);
  assert.equal(summary?.principalCents, 0);
  assert.equal(summary?.realizedLossCents, 20_000);

  // Reconstrução do ledger devolve exatamente o mesmo estado.
  const rebuild = await executeRecalculateInvestmentPosition(auth(), {
    workspaceId: WORKSPACE_A,
    idempotencyKey: "m9-loss-rebuild-0001",
    correlationId: "corr-m9-loss-rebuild-0001",
    accountId: ACCOUNT,
    assetId: ASSET,
    pageSize: 50,
    reason: "Reconstrução após resgate com prejuízo",
  });
  assert.equal(rebuild.status, "completed");
  const rebuilt = await positionDocument();
  assert.equal(rebuilt?.quantityMicros, 0);
  assert.equal(rebuilt?.principalCents, 0);
  assert.equal(rebuilt?.realizedLossCents, 20_000);
  assert.equal(rebuilt?.currentValueCents, 0);
});

test("o caminho que criava principal fantasma passa a ser recusado", async () => {
  await seedWorkspace(WORKSPACE_A, OWNER_A);
  await seedCatalog(WORKSPACE_A, "PF");
  await executeCreateInvestmentContribution(
    auth(),
    contributionPayload("m9-phantom-contribution-0001", {
      principalCents: 100_000,
      quantityMicros: 100_000_000,
    }),
  );
  const pending = await requestRedemption("phantom", 100_000, 100_000_000);

  // Exatamente a reprodução da auditoria: quantidade integral, custo reduzido.
  await assert.rejects(
    () => settleRedemption(String(pending.movementId), "phantom", {
      principalCents: 80_000,
      quantityMicros: 100_000_000,
      gainCents: 0,
      lossCents: 0,
      feesCents: 0,
      taxCents: 0,
    }),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      error.code === "domain_precondition_failed",
  );

  const position = await positionDocument();
  assert.equal(position?.quantityMicros, 100_000_000);
  assert.equal(position?.principalCents, 100_000);
});

test("resgate parcial com prejuízo mantém custo proporcional e caixa correto", async () => {
  await seedWorkspace(WORKSPACE_A, OWNER_A);
  await seedCatalog(WORKSPACE_A, "PF");
  await executeCreateInvestmentContribution(
    auth(),
    contributionPayload("m9-partial-contribution-0001", {
      principalCents: 100_000,
      quantityMicros: 100_000_000,
    }),
  );
  const pending = await requestRedemption("partial", 40_000, 40_000_000);
  const settled = await settleRedemption(String(pending.movementId), "partial", {
    principalCents: 40_000,
    quantityMicros: 40_000_000,
    gainCents: 0,
    lossCents: 5_000,
    feesCents: 1_000,
    taxCents: 0,
  });

  // 40.000 de custo − 5.000 de perda − 1.000 de taxa.
  assert.equal(settled.cashDeltaCents, 34_000);
  const position = await positionDocument();
  assert.equal(position?.quantityMicros, 60_000_000);
  assert.equal(position?.principalCents, 60_000);
  assert.equal(position?.realizedLossCents, 5_000);
  assert.equal(position?.realizedGainCents, 0);
});

test("estorno de resgate com prejuízo devolve custo e anula a perda", async () => {
  await seedWorkspace(WORKSPACE_A, OWNER_A);
  await seedCatalog(WORKSPACE_A, "PF");
  await executeCreateInvestmentContribution(
    auth(),
    contributionPayload("m9-reversal-contribution-0001", {
      principalCents: 100_000,
      quantityMicros: 100_000_000,
    }),
  );
  const pending = await requestRedemption("reversal", 100_000, 100_000_000);
  const settled = await settleRedemption(String(pending.movementId), "reversal", {
    principalCents: 100_000,
    quantityMicros: 100_000_000,
    gainCents: 0,
    lossCents: 20_000,
    feesCents: 0,
    taxCents: 0,
  });
  assert.equal(settled.realizedLossCents, 20_000);

  await executeReverseInvestmentMovement(auth(), {
    workspaceId: WORKSPACE_A,
    idempotencyKey: "m9-reversal-0001",
    correlationId: "corr-m9-reversal-0001",
    movementId: String(pending.movementId),
    reversedAt: "2026-08-21T12:00:00.000Z",
    reason: "Resgate lançado por engano",
  });

  const position = await positionDocument();
  assert.equal(position?.quantityMicros, 100_000_000);
  assert.equal(position?.principalCents, 100_000);
  assert.equal(position?.realizedLossCents, 0, "a perda é anulada pelo estorno");
  assert.equal(position?.currentValueCents, 100_000);
});

test("ganho e perda no mesmo movimento são recusados", async () => {
  await seedWorkspace(WORKSPACE_A, OWNER_A);
  await seedCatalog(WORKSPACE_A, "PF");
  await executeCreateInvestmentContribution(
    auth(),
    contributionPayload("m9-both-contribution-0001", {
      principalCents: 100_000,
      quantityMicros: 100_000_000,
    }),
  );
  const pending = await requestRedemption("both", 50_000, 50_000_000);
  await assert.rejects(
    () => settleRedemption(String(pending.movementId), "both", {
      principalCents: 50_000,
      quantityMicros: 50_000_000,
      gainCents: 1_000,
      lossCents: 1_000,
      feesCents: 0,
      taxCents: 0,
    }),
  );
});
