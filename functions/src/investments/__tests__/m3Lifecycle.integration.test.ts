import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {CreditCardApplicationError} from "../../creditCards/errors";
import {investmentPositionId} from "../infrastructure";
import {recordInvestmentCallableFailureSafely} from "../observability";
import {
  executeCancelInvestmentMovement,
  executeCreateInvestmentContribution,
  executeCreateInvestmentRedemptionV2,
  executeRecordInvestmentValuation,
  executeRegisterInvestmentImportBatch,
  executeSettleInvestmentRedemption,
} from "../operationsV2";
import {executeRebuildInvestmentProjections} from "../projectionRebuild";
import {allocationDocumentId} from "../reporting";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST é obrigatório para os testes do M3.",
  );
}

const PROJECT = process.env.GCLOUD_PROJECT ?? "minhas-financas-local";
const WORKSPACE = "investment-m3-workspace";
const OWNER = "investment-m3-owner";
const MEMBER = "investment-m3-member";
const ACCOUNT = "investment-m3-account";
const ASSET = "investment-m3-asset";
const GOAL = "investment-m3-goal";

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const auth = (
  uid = OWNER,
  role: WorkspaceAuthorizationContext["role"] = "owner",
): WorkspaceAuthorizationContext => ({workspaceId: WORKSPACE, uid, role});

const seed = async (progressBasis = "net_contributions"): Promise<void> => {
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
  const now = Timestamp.fromDate(new Date("2026-08-01T00:00:00.000Z"));
  await db().doc(`workspaces/${WORKSPACE}`).set({
    ownerId: OWNER,
    type: "PF",
    currency: "BRL",
    name: WORKSPACE,
  });
  await db()
    .doc(`workspaces/${WORKSPACE}/members/${OWNER}`)
    .set({uid: OWNER, role: "owner", status: "active"});
  await db()
    .doc(`workspaces/${WORKSPACE}/members/${MEMBER}`)
    .set({uid: MEMBER, role: "member", status: "active"});
  await db()
    .doc(`workspaces/${WORKSPACE}/investment_accounts/${ACCOUNT}`)
    .set({
      id: ACCOUNT,
      workspaceId: WORKSPACE,
      profileType: "PF",
      name: "Conta M3",
      institutionName: "Instituição M3",
      currency: "BRL",
      status: "active",
      createdBy: "seed",
      updatedBy: "seed",
      createdAt: now,
      updatedAt: now,
    });
  await db().doc(`workspaces/${WORKSPACE}/investment_assets/${ASSET}`).set({
    id: ASSET,
    workspaceId: WORKSPACE,
    profileType: "PF",
    name: "Ativo M3",
    symbol: "M3",
    assetType: "fixed_income",
    allocationPurpose: "unassigned",
    currency: "BRL",
    status: "active",
    createdBy: "seed",
    updatedBy: "seed",
    createdAt: now,
    updatedAt: now,
  });
  await db().doc(`workspaces/${WORKSPACE}/goals/${GOAL}`).set({
    id: GOAL,
    workspaceId: WORKSPACE,
    name: "Meta M3",
    progressBasis,
    investmentNetContributionCents: 0,
    investmentCurrentValueCents: 0,
    investmentProgressCents: 0,
    investmentProjectionVersion: 0,
  });
};

const contribution = (
  idempotencyKey: string,
  overrides: Record<string, unknown> = {},
) => ({
  workspaceId: WORKSPACE,
  idempotencyKey,
  correlationId: `corr-${idempotencyKey}`,
  accountId: ACCOUNT,
  assetId: ASSET,
  goalId: GOAL,
  walletId: "wallet-m3",
  description: "Aporte M3",
  principalCents: 100_000,
  quantityMicros: 1_000_000,
  feesCents: 0,
  taxCents: 0,
  occurredAt: "2026-08-10T15:00:00.000Z",
  ...overrides,
});

const redemption = (idempotencyKey: string) => ({
  workspaceId: WORKSPACE,
  idempotencyKey,
  correlationId: `corr-${idempotencyKey}`,
  accountId: ACCOUNT,
  assetId: ASSET,
  walletId: "wallet-m3",
  description: "Resgate M3",
  requestedPrincipalCents: 40_000,
  requestedQuantityMicros: 400_000,
  requestedAt: "2026-08-15T15:00:00.000Z",
  expectedSettlementAt: "2026-08-18T15:00:00.000Z",
});

const doc = (path: string) => db().doc(`workspaces/${WORKSPACE}/${path}`);

const countCollection = async (name: string): Promise<number> =>
  (await db().collection(`workspaces/${WORKSPACE}/${name}`).get()).size;

/** Executa todas as páginas do rebuild de projeções até concluir. */
const runProjectionRebuild = async (
  correlationId: string,
  pageSize = 50,
): Promise<Record<string, unknown>> => {
  let last: Record<string, unknown> = {};
  for (let page = 0; page < 50; page += 1) {
    last = await executeRebuildInvestmentProjections(auth(), {
      workspaceId: WORKSPACE,
      idempotencyKey: `${correlationId}-page-${page}-000000`,
      correlationId,
      pageSize,
      reason: "Reconstrução de teste",
    });
    if (last.completed === true) return last;
  }
  throw new Error("Rebuild de projeções não concluiu.");
};

test("cancelar pendente não move posição, meta nem caixa", async () => {
  await seed();
  await executeCreateInvestmentContribution(auth(), contribution("m3-cancel-contrib-0001"));
  const pending = await executeCreateInvestmentRedemptionV2(
    auth(),
    redemption("m3-cancel-redemption-0001"),
  );
  const movementId = String(pending.movementId);
  const positionId = investmentPositionId(ACCOUNT, ASSET);

  const positionBefore = (await doc(`investment_positions/${positionId}`).get()).data();
  const goalBefore = (await doc(`goals/${GOAL}`).get()).data();
  const summaryBefore = (await doc("investment_summaries/current").get()).data();

  const cancelPayload = {
    workspaceId: WORKSPACE,
    idempotencyKey: "m3-cancel-movement-0001",
    correlationId: "corr-m3-cancel-movement",
    movementId,
    occurredAt: "2026-08-16T15:00:00.000Z",
    reason: "Pedido desfeito pelo usuário",
  };
  const cancelled = await executeCancelInvestmentMovement(auth(), cancelPayload);
  assert.equal(cancelled.status, "cancelled");

  const movement = (await doc(`investment_movements/${movementId}`).get()).data();
  assert.equal(movement?.status, "cancelled");
  assert.equal(movement?.cancelledBy, OWNER);
  assert.ok(movement?.cancelledAt, "Cancelamento precisa registrar o instante.");
  assert.equal(movement?.cancellationReason, cancelPayload.reason);
  // Histórico preservado: o documento continua existindo com os deltas zerados.
  assert.equal(movement?.principalDeltaCents, 0);
  assert.equal(movement?.cashDeltaCents, 0);

  const positionAfter = (await doc(`investment_positions/${positionId}`).get()).data();
  const goalAfter = (await doc(`goals/${GOAL}`).get()).data();
  const summaryAfter = (await doc("investment_summaries/current").get()).data();
  assert.equal(positionAfter?.principalCents, positionBefore?.principalCents);
  assert.equal(positionAfter?.version, positionBefore?.version);
  assert.equal(
    goalAfter?.investmentNetContributionCents,
    goalBefore?.investmentNetContributionCents,
  );
  assert.equal(summaryAfter?.principalCents, summaryBefore?.principalCents);

  const mirror = (await doc(`transactions/${movement?.transactionId}`).get()).data();
  assert.equal(mirror?.isPaid, false);
  assert.equal(mirror?.investmentMetadata?.status, "cancelled");
  assert.equal(mirror?.investmentMetadata?.cashImpact, "none");
  assert.equal(mirror?.investmentMetadata?.investmentImpact, "none");

  // Replay devolve o mesmo resultado e não grava de novo.
  assert.deepEqual(
    await executeCancelInvestmentMovement(auth(), cancelPayload),
    cancelled,
  );

  // Cancelar de novo, com outra chave, é negado.
  await assert.rejects(
    () =>
      executeCancelInvestmentMovement(auth(), {
        ...cancelPayload,
        idempotencyKey: "m3-cancel-movement-0002",
        correlationId: "corr-m3-cancel-movement-2",
      }),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      error.code === "domain_precondition_failed",
  );
});

test("cancelar movimento liquidado é negado; liquidado exige estorno", async () => {
  await seed();
  const created = await executeCreateInvestmentContribution(
    auth(),
    contribution("m3-cancel-settled-0001"),
  );
  await assert.rejects(
    () =>
      executeCancelInvestmentMovement(auth(), {
        workspaceId: WORKSPACE,
        idempotencyKey: "m3-cancel-settled-attempt-0001",
        correlationId: "corr-m3-cancel-settled",
        movementId: String(created.movementId),
        occurredAt: "2026-08-11T15:00:00.000Z",
        reason: "Tentativa indevida",
      }),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      error.code === "domain_precondition_failed",
  );
  const movement = (
    await doc(`investment_movements/${created.movementId}`).get()
  ).data();
  assert.equal(movement?.status, "settled");
});

test("cancelamento concorrente aplica efeito único", async () => {
  await seed();
  await executeCreateInvestmentContribution(auth(), contribution("m3-conc-contrib-0001"));
  const pending = await executeCreateInvestmentRedemptionV2(
    auth(),
    redemption("m3-conc-redemption-0001"),
  );
  const payload = {
    workspaceId: WORKSPACE,
    idempotencyKey: "m3-conc-cancel-0001",
    correlationId: "corr-m3-conc-cancel",
    movementId: String(pending.movementId),
    occurredAt: "2026-08-16T15:00:00.000Z",
    reason: "Cancelamento concorrente",
  };
  const results = await Promise.allSettled([
    executeCancelInvestmentMovement(auth(), payload),
    executeCancelInvestmentMovement(auth(), payload),
  ]);
  const fulfilled = results.filter((entry) => entry.status === "fulfilled");
  assert.ok(fulfilled.length >= 1, "Ao menos uma execução precisa concluir.");
  const movement = (
    await doc(`investment_movements/${pending.movementId}`).get()
  ).data();
  assert.equal(movement?.status, "cancelled");
});

test("valoração altera patrimônio e nunca o caixa", async () => {
  await seed("current_value");
  await executeCreateInvestmentContribution(auth(), contribution("m3-val-contrib-0001"));
  const positionId = investmentPositionId(ACCOUNT, ASSET);
  const transactionsBefore = await countCollection("transactions");
  const goalBefore = (await doc(`goals/${GOAL}`).get()).data();

  const payload = {
    workspaceId: WORKSPACE,
    idempotencyKey: "m3-valuation-0001",
    correlationId: "corr-m3-valuation",
    accountId: ACCOUNT,
    assetId: ASSET,
    // 1 unidade a R$ 1.100,00 (micros de moeda).
    unitPriceMicros: 1_100_000_000,
    source: "manual" as const,
    effectiveAt: "2026-08-20T15:00:00.000Z",
    reason: "Marcação a mercado mensal",
  };
  const result = await executeRecordInvestmentValuation(auth(), payload);
  assert.equal(result.currentValueCents, 110_000);
  assert.equal(result.currentValueDeltaCents, 10_000);
  assert.equal(result.unrealizedAppreciationCents, 10_000);

  const position = (await doc(`investment_positions/${positionId}`).get()).data();
  assert.equal(position?.currentValueCents, 110_000);
  assert.equal(position?.principalCents, 100_000, "Custo não muda na valoração.");
  assert.equal(position?.unrealizedAppreciationCents, 10_000);
  assert.equal(position?.valuationUnitPriceMicros, 1_100_000_000);

  const summary = (await doc("investment_summaries/current").get()).data();
  assert.equal(summary?.currentValueCents, 110_000);
  assert.equal(summary?.principalCents, 100_000);

  // Nenhum documento de caixa foi criado ou alterado.
  assert.equal(await countCollection("transactions"), transactionsBefore);

  const goal = (await doc(`goals/${GOAL}`).get()).data();
  assert.equal(
    goal?.investmentNetContributionCents,
    goalBefore?.investmentNetContributionCents,
    "Valoração não altera aporte líquido.",
  );
  assert.equal(goal?.investmentCurrentValueCents, 110_000);
  assert.equal(goal?.investmentProgressCents, 110_000);

  const valuation = (
    await doc(`investment_valuations/${result.valuationId}`).get()
  ).data();
  assert.equal(valuation?.unitPriceMicros, 1_100_000_000);
  assert.equal(valuation?.source, "manual");
  assert.equal(valuation?.currency, "BRL");

  // Replay não duplica.
  assert.deepEqual(
    await executeRecordInvestmentValuation(auth(), payload),
    result,
  );
  assert.equal(await countCollection("investment_valuations"), 1);
});

test("valoração exige papel privilegiado", async () => {
  await seed();
  await executeCreateInvestmentContribution(auth(), contribution("m3-val-rbac-0001"));
  await assert.rejects(
    () =>
      executeRecordInvestmentValuation(auth(MEMBER, "member"), {
        workspaceId: WORKSPACE,
        idempotencyKey: "m3-valuation-rbac-0001",
        correlationId: "corr-m3-valuation-rbac",
        accountId: ACCOUNT,
        assetId: ASSET,
        unitPriceMicros: 1_100_000_000,
        source: "manual",
        effectiveAt: "2026-08-20T15:00:00.000Z",
        reason: "Tentativa de member",
      }),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      error.code === "workspace_role_denied",
  );
});

test("corte de período usa America/Sao_Paulo, não UTC", async () => {
  await seed();
  // 23:30 BRT de 31/08/2026 é 02:30Z de 01/09/2026.
  await executeCreateInvestmentContribution(
    auth(),
    contribution("m3-timezone-0001", {
      occurredAt: "2026-09-01T02:30:00.000Z",
    }),
  );
  const august = await doc("investment_report_periods/2026-08").get();
  const september = await doc("investment_report_periods/2026-09").get();
  assert.ok(august.exists, "O aporte precisa cair no mês local de agosto.");
  assert.equal(september.exists, false, "Não pode vazar para setembro UTC.");
  assert.equal(august.data()?.contributionCents, 100_000);
  assert.ok(
    august.data()?.daily?.["2026-08-31"],
    "O balde diário precisa ser 31/08 no horário de Brasília.",
  );

  const movements = await db()
    .collection(`workspaces/${WORKSPACE}/investment_movements`)
    .get();
  const mirrorId = movements.docs[0].data().transactionId;
  const mirror = (await doc(`transactions/${mirrorId}`).get()).data();
  assert.equal(mirror?.date, "2026-08-31");
});

test("rebuild de projeções bate com o ledger e corrige deriva", async () => {
  await seed();
  await executeCreateInvestmentContribution(auth(), contribution("m3-rebuild-c1-0001"));
  await executeCreateInvestmentContribution(
    auth(),
    contribution("m3-rebuild-c2-0001", {
      principalCents: 50_000,
      quantityMicros: 500_000,
      occurredAt: "2026-08-12T15:00:00.000Z",
    }),
  );
  const pending = await executeCreateInvestmentRedemptionV2(
    auth(),
    redemption("m3-rebuild-r1-0001"),
  );
  await executeSettleInvestmentRedemption(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "m3-rebuild-settle-0001",
    correlationId: "corr-m3-rebuild-settle",
    movementId: String(pending.movementId),
    settledAt: "2026-08-18T15:00:00.000Z",
    settlement: {
      principalCents: 40_000,
      quantityMicros: 400_000,
      gainCents: 5_000,
      feesCents: 100,
      taxCents: 200,
    },
  });

  const expected = (await doc("investment_summaries/current").get()).data();

  // Injeta deriva: acumulador incremental corrompido, sem lastro no ledger.
  await doc("investment_summaries/current").set(
    {principalCents: (expected?.principalCents ?? 0) + 999},
    {merge: true},
  );

  const result = await runProjectionRebuild("corr-m3-rebuild-projections", 2);
  assert.equal(result.completed, true);
  const drift = result.drift as Record<string, number>;
  assert.equal(
    drift.principalCents,
    -999,
    "A deriva injetada precisa ser detectada e reportada.",
  );

  const rebuilt = (await doc("investment_summaries/current").get()).data();
  assert.equal(rebuilt?.principalCents, expected?.principalCents);
  assert.equal(rebuilt?.currentValueCents, expected?.currentValueCents);
  assert.equal(rebuilt?.realizedGainCents, expected?.realizedGainCents);
  assert.equal(rebuilt?.feesCents, expected?.feesCents);
  assert.equal(rebuilt?.taxCents, expected?.taxCents);

  // A soma da dimensão `account` reconcilia com o resumo.
  const accountBucket = (
    await doc(
      "investment_allocation_summaries/" +
        allocationDocumentId({dimension: "account", key: ACCOUNT}),
    ).get()
  ).data();
  assert.equal(accountBucket?.principalCents, rebuilt?.principalCents);
  assert.equal(accountBucket?.currentValueCents, rebuilt?.currentValueCents);

  // Período mensal reconstruído separa principal de ganho.
  const period = (await doc("investment_report_periods/2026-08").get()).data();
  assert.equal(period?.contributionCents, 150_000);
  assert.equal(period?.redemptionPrincipalCents, 40_000);
  assert.equal(period?.realizedGainCents, 5_000);
  assert.equal(period?.feesCents, 100);
  assert.equal(period?.taxCents, 200);
  assert.equal(period?.settledMovementCount, 3);
});

test("rebuild reexecutado não duplica e é retomável por páginas", async () => {
  await seed();
  await executeCreateInvestmentContribution(auth(), contribution("m3-resume-c1-0001"));
  await executeCreateInvestmentContribution(
    auth(),
    contribution("m3-resume-c2-0001", {
      principalCents: 30_000,
      quantityMicros: 300_000,
      occurredAt: "2026-08-12T15:00:00.000Z",
    }),
  );

  // pageSize 1 força várias páginas e prova a retomada pelo snapshot.
  const first = await runProjectionRebuild("corr-m3-resume-a", 1);
  assert.equal(first.completed, true);
  const afterFirst = (await doc("investment_summaries/current").get()).data();

  const second = await runProjectionRebuild("corr-m3-resume-b", 1);
  assert.equal(second.completed, true);
  const afterSecond = (await doc("investment_summaries/current").get()).data();

  assert.equal(afterSecond?.principalCents, afterFirst?.principalCents);
  assert.equal(afterSecond?.currentValueCents, afterFirst?.currentValueCents);
  assert.equal(afterSecond?.positionCount, afterFirst?.positionCount);
  assert.equal(
    (second.drift as Record<string, number>).principalCents,
    0,
    "Sem mutação entre execuções, a deriva precisa ser zero.",
  );
});

test("lote de importação registra procedência e avança contador", async () => {
  await seed();
  const batch = await executeRegisterInvestmentImportBatch(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "m3-import-batch-0001",
    correlationId: "corr-m3-import-batch",
    source: "extrato-corretora-2026-08.csv",
    status: "running",
    processedCount: 0,
    failedCount: 0,
    reason: "Importação mensal",
  });
  const batchId = String(batch.batchId);

  await executeCreateInvestmentContribution(
    auth(),
    contribution("m3-import-contrib-0001", {importBatchId: batchId}),
  );
  const stored = (await doc(`investment_import_batches/${batchId}`).get()).data();
  assert.equal(stored?.status, "running");
  assert.equal(stored?.processedCount, 1);
  assert.equal(stored?.profileType, "PF");

  const movements = await db()
    .collection(`workspaces/${WORKSPACE}/investment_movements`)
    .get();
  assert.equal(movements.docs[0].data().importBatchId, batchId);

  await executeRegisterInvestmentImportBatch(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "m3-import-batch-0002",
    correlationId: "corr-m3-import-batch-2",
    batchId,
    source: "extrato-corretora-2026-08.csv",
    status: "completed",
    processedCount: 1,
    failedCount: 0,
    reason: "Encerramento do lote",
  });

  // Lote concluído não aceita novos aportes.
  await assert.rejects(
    () =>
      executeCreateInvestmentContribution(
        auth(),
        contribution("m3-import-contrib-0002", {importBatchId: batchId}),
      ),
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      error.code === "domain_precondition_failed",
  );
});

test("falha de callable deixa métrica e evento de falha", async () => {
  await seed();
  const request = {
    data: {
      workspaceId: WORKSPACE,
      correlationId: "corr-m3-failure-observability",
      idempotencyKey: "m3-failure-observability-0001",
      principalCents: 1_234,
    },
    auth: {uid: OWNER, token: {}},
    rawRequest: {},
  } as never;
  await recordInvestmentCallableFailureSafely(
    "createInvestmentContribution",
    request,
    new CreditCardApplicationError(
      "domain_precondition_failed",
      "Falha simulada para observabilidade.",
    ),
    WORKSPACE,
  );

  const metrics = await db()
    .collection(`workspaces/${WORKSPACE}/investment_operational_metrics`)
    .where("status", "==", "failure")
    .get();
  assert.equal(metrics.size, 1);
  const metric = metrics.docs[0].data();
  assert.equal(metric.count, 1);
  assert.equal(metric.domain, "investment");
  assert.equal(metric.operation, "createInvestmentContribution");
  assert.equal(metric.lastCorrelationId, "corr-m3-failure-observability");
  assert.equal(metric.lastErrorCode, "domain_precondition_failed");

  const events = await db()
    .collection(`workspaces/${WORKSPACE}/investment_event_logs`)
    .where("outcome", "==", "failed")
    .get();
  assert.equal(events.size, 1);
  assert.equal(events.docs[0].data().operation, "createInvestmentContribution");
});

test("operação bem-sucedida registra métrica de sucesso", async () => {
  await seed();
  await executeCreateInvestmentContribution(auth(), contribution("m3-metric-0001"));
  const pending = await executeCreateInvestmentRedemptionV2(
    auth(),
    redemption("m3-metric-redemption-0001"),
  );
  await executeCancelInvestmentMovement(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "m3-metric-cancel-0001",
    correlationId: "corr-m3-metric-cancel",
    movementId: String(pending.movementId),
    occurredAt: "2026-08-16T15:00:00.000Z",
    reason: "Cancelamento observado",
  });
  for (const operation of [
    "createInvestmentContribution",
    "createInvestmentRedemption",
    "cancelInvestmentMovement",
  ]) {
    const metrics = await db()
      .collection(`workspaces/${WORKSPACE}/investment_operational_metrics`)
      .where("operation", "==", operation)
      .get();
    assert.equal(metrics.size, 1, `Métrica ausente para ${operation}.`);
    assert.equal(metrics.docs[0].data().status, "success", operation);
    assert.equal(metrics.docs[0].data().count, 1, operation);
    assert.equal(metrics.docs[0].data().domain, "investment", operation);
  }
});

test("falha sem autorização não grava no domínio de outro workspace", async () => {
  await seed();
  const victim = "m3-observability-tenant-vitima";
  await db().recursiveDelete(db().doc(`workspaces/${victim}`));
  await db().doc(`workspaces/${victim}`).set({
    ownerId: "dono-legitimo", type: "PF", currency: "BRL", name: victim,
  });

  // Exatamente o que o `catch` da callable faz quando `requireWorkspaceRole`
  // recusa: sem autenticação e apontando para um workspace alheio. Antes, o
  // `workspaceId` vinha do payload cru e este caminho criava documentos no
  // tenant da vítima, um por `correlationId`.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await recordInvestmentCallableFailureSafely(
      "createInvestmentContribution",
      {
        data: {
          workspaceId: victim,
          correlationId: `intruso-${attempt}`,
          idempotencyKey: `intruso-${attempt}`,
          principalCents: 99_999_999,
        },
        rawRequest: {},
      } as never,
      new CreditCardApplicationError(
        "unauthenticated",
        "Usuário não autenticado.",
      ),
      undefined,
    );
  }

  const events = await db()
    .collection(`workspaces/${victim}/investment_event_logs`).get();
  const metrics = await db()
    .collection(`workspaces/${victim}/investment_operational_metrics`).get();
  assert.equal(events.size, 0, "Evento gravado em workspace alheio.");
  assert.equal(metrics.size, 0, "Métrica gravada em workspace alheio.");
});
