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
