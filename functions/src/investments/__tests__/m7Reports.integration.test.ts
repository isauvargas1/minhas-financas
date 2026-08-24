import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {
  executeCreateInvestmentContribution,
  executeCreateInvestmentRedemptionV2,
  executeReverseInvestmentMovement,
  executeSettleInvestmentRedemption,
} from "../operationsV2";
import type {InvestmentAllocationDimension} from "../reporting";
import {allocationDocumentId} from "../reporting";
import {executeRebuildInvestmentProjections} from "../projectionRebuild";
import {executeRecordInvestmentValuation} from "../operationsV2";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST é obrigatório para os testes de relatório do M7.",
  );
}

const PROJECT = process.env.GCLOUD_PROJECT ?? "minhas-financas-local";
const WORKSPACE = "investment-m7-workspace";
const OWNER = "investment-m7-owner";
const ACCOUNT = "investment-m7-account";
const ASSET = "investment-m7-asset";
const GOAL = "investment-m7-goal";

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const auth = (): WorkspaceAuthorizationContext => ({
  workspaceId: WORKSPACE,
  uid: OWNER,
  role: "owner",
});

const doc = (path: string) => db().doc(`workspaces/${WORKSPACE}/${path}`);

const seed = async (profileType: "PF" | "PJ" = "PF"): Promise<void> => {
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
  const now = Timestamp.fromDate(new Date("2026-08-01T00:00:00.000Z"));
  await db().doc(`workspaces/${WORKSPACE}`).set({
    ownerId: OWNER, type: profileType, currency: "BRL", name: WORKSPACE,
  });
  await db().doc(`workspaces/${WORKSPACE}/members/${OWNER}`)
    .set({uid: OWNER, role: "owner", status: "active"});
  await doc(`investment_accounts/${ACCOUNT}`).set({
    id: ACCOUNT, workspaceId: WORKSPACE, profileType, name: "Corretora M7",
    institutionName: "Instituição M7", currency: "BRL", status: "active",
    createdBy: "seed", updatedBy: "seed", createdAt: now, updatedAt: now,
  });
  await doc(`investment_assets/${ASSET}`).set({
    id: ASSET, workspaceId: WORKSPACE, profileType, name: "Ativo M7",
    symbol: "M7", assetType: "fixed_income",
    allocationPurpose: profileType === "PJ" ? "reserve" : "unassigned",
    currency: "BRL", status: "active",
    createdBy: "seed", updatedBy: "seed", createdAt: now, updatedAt: now,
  });
  await doc(`goals/${GOAL}`).set({
    id: GOAL, workspaceId: WORKSPACE, name: "Meta M7",
    progressBasis: "net_contributions",
    investmentNetContributionCents: 0, investmentCurrentValueCents: 0,
    investmentProgressCents: 0, investmentProjectionVersion: 0,
  });
};

const contribution = (key: string, overrides: Record<string, unknown> = {}) => ({
  workspaceId: WORKSPACE,
  idempotencyKey: key,
  correlationId: `corr-${key}`,
  accountId: ACCOUNT,
  assetId: ASSET,
  description: "Aporte M7",
  principalCents: 100_000,
  quantityMicros: 1_000_000,
  feesCents: 0,
  taxCents: 0,
  occurredAt: "2026-08-10T15:00:00.000Z",
  ...overrides,
});

const bucket = async (dimension: InvestmentAllocationDimension, key: string) =>
  (await doc(
    `investment_allocation_summaries/${allocationDocumentId({dimension, key})}`,
  ).get()).data();

test("aporte que já nasce vinculado a meta alimenta todas as dimensões", async () => {
  await seed();
  // Este é exatamente o caso que o defeito descartava: a posição nasce com
  // meta, então a chave da dimensão `goal` muda de `unassigned` para o ID da
  // meta ao mesmo tempo em que o dinheiro entra. O ramo de dimensões
  // alteradas devolvia cedo para as outras sete, que ficavam zeradas.
  await executeCreateInvestmentContribution(
    auth(),
    contribution("m7-linked-contribution-0001", {goalId: GOAL}),
  );

  const summary = (await doc("investment_summaries/current").get()).data();
  assert.equal(summary?.principalCents, 100_000);

  for (const [dimension, key] of [
    ["account", ACCOUNT],
    ["asset", ASSET],
    ["class", "fixed_income"],
    ["goal", GOAL],
    ["purpose", "unassigned"],
  ] as Array<[InvestmentAllocationDimension, string]>) {
    const entry = await bucket(dimension, key);
    assert.equal(
      entry?.principalCents,
      summary?.principalCents,
      `A dimensão ${dimension} precisa fechar com o resumo.`,
    );
    assert.equal(entry?.currentValueCents, summary?.currentValueCents, dimension);
    assert.equal(entry?.positionCount, 1, dimension);
  }
});

test("estorno zera a contagem de movimentos do período", async () => {
  await seed();
  const created = await executeCreateInvestmentContribution(
    auth(),
    contribution("m7-count-contribution-0001"),
  );
  let period = (await doc("investment_report_periods/2026-08").get()).data();
  assert.equal(period?.settledMovementCount, 1);
  assert.equal(period?.contributionCents, 100_000);

  await executeReverseInvestmentMovement(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "m7-count-reversal-0001",
    correlationId: "corr-m7-count-reversal",
    movementId: String(created.movementId),
    reversedAt: "2026-08-11T15:00:00.000Z",
    reason: "Estorno para provar a compensação da contagem",
  });

  period = (await doc("investment_report_periods/2026-08").get()).data();
  assert.equal(
    period?.settledMovementCount,
    0,
    "Aporte e estorno precisam se anular na contagem do período.",
  );
  assert.equal(period?.contributionCents, 0);
  assert.equal(period?.costDeltaCents, 0);
});

test("principal resgatado entra como principal e nunca como ganho", async () => {
  await seed();
  await executeCreateInvestmentContribution(
    auth(),
    contribution("m7-redemption-contribution-0001"),
  );
  const pending = await executeCreateInvestmentRedemptionV2(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "m7-redemption-request-0001",
    correlationId: "corr-m7-redemption-request",
    accountId: ACCOUNT,
    assetId: ASSET,
    description: "Resgate M7",
    requestedPrincipalCents: 40_000,
    requestedQuantityMicros: 400_000,
    requestedAt: "2026-08-15T15:00:00.000Z",
  });
  await executeSettleInvestmentRedemption(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "m7-redemption-settle-0001",
    correlationId: "corr-m7-redemption-settle",
    movementId: String(pending.movementId),
    settledAt: "2026-08-18T15:00:00.000Z",
    settlement: {
      principalCents: 40_000,
      quantityMicros: 400_000,
      gainCents: 5_000,
      lossCents: 0,
      feesCents: 100,
      taxCents: 200,
    },
  });

  const period = (await doc("investment_report_periods/2026-08").get()).data();
  // Principal resgatado tem campo próprio e não contamina aporte nem ganho.
  assert.equal(period?.redemptionPrincipalCents, 40_000);
  assert.equal(period?.realizedGainCents, 5_000);
  assert.equal(period?.contributionCents, 100_000);
  // Custo cai só pelo principal; o ganho não altera custo.
  assert.equal(period?.costDeltaCents, 100_000 - 40_000);
  // Caixa é (principal + ganho) − (taxas + imposto), separado do patrimônio.
  assert.equal(period?.cashDeltaCents, -100_000 + (45_000 - 300));

  const position = (
    await db().collection(`workspaces/${WORKSPACE}/investment_positions`).get()
  ).docs[0].data();
  assert.equal(position.principalCents, 60_000);
  assert.equal(position.realizedGainCents, 5_000);
  assert.equal(position.feesCents, 100);
  assert.equal(position.taxCents, 200);
});

test("PJ classifica a finalidade sem recair em aposentadoria", async () => {
  await seed("PJ");
  await executeCreateInvestmentContribution(
    auth(),
    contribution("m7-pj-contribution-0001"),
  );
  const reserve = await bucket("purpose", "reserve");
  assert.equal(reserve?.principalCents, 100_000);
  assert.equal(reserve?.label, "Reserva");
  // Nenhuma finalidade de PF é criada num workspace PJ.
  for (const key of ["retirement", "goal"]) {
    assert.equal(
      (await bucket("purpose", key)) ?? undefined,
      undefined,
      `PJ não pode criar a finalidade ${key}.`,
    );
  }
});

test("PF sem meta fica sem meta e não classificado", async () => {
  await seed("PF");
  await executeCreateInvestmentContribution(
    auth(),
    contribution("m7-pf-contribution-0001"),
  );
  const goalBucket = await bucket("goal", "unassigned");
  assert.equal(goalBucket?.label, "Sem meta");
  assert.equal(goalBucket?.principalCents, 100_000);
  const purposeBucket = await bucket("purpose", "unassigned");
  assert.equal(purposeBucket?.label, "Não classificado");
  // Aposentadoria só existe se o ativo tiver sido classificado assim.
  assert.equal((await bucket("purpose", "retirement")) ?? undefined, undefined);
});

/** Executa todas as páginas do rebuild de projeções até concluir. */
const runProjectionRebuild = async (
  correlationId: string,
  pageSize = 50,
): Promise<Record<string, unknown>> => {
  for (let page = 0; page < 200; page += 1) {
    const result = await executeRebuildInvestmentProjections(auth(), {
      workspaceId: WORKSPACE,
      idempotencyKey: `${correlationId}-page-${page}-000000`,
      correlationId,
      pageSize,
      reason: "Reconstrução da série mensal",
    });
    if (result.completed === true) return result;
  }
  throw new Error("Rebuild não concluiu.");
};

const periodDoc = async (period: string) =>
  (await doc(`investment_report_periods/${period}`).get()).data();

test("fechamento acumula ao longo de meses e não parte do patrimônio atual", async () => {
  await seed();
  await executeCreateInvestmentContribution(auth(), contribution("m7-close-m1-0001", {
    principalCents: 100_000, quantityMicros: 1_000_000,
    occurredAt: "2026-06-10T15:00:00.000Z",
  }));
  await executeCreateInvestmentContribution(auth(), contribution("m7-close-m2-0001", {
    principalCents: 50_000, quantityMicros: 500_000,
    occurredAt: "2026-07-10T15:00:00.000Z",
  }));
  await executeCreateInvestmentContribution(auth(), contribution("m7-close-m3-0001", {
    principalCents: 25_000, quantityMicros: 250_000,
    occurredAt: "2026-08-10T15:00:00.000Z",
  }));

  // Cada mês fecha com o acumulado até ali, e não com o total de hoje.
  assert.equal((await periodDoc("2026-06"))?.closingCurrentValueCents, 100_000);
  assert.equal((await periodDoc("2026-07"))?.closingCurrentValueCents, 150_000);
  assert.equal((await periodDoc("2026-08"))?.closingCurrentValueCents, 175_000);

  // Reconciliação: o fechamento do último mês bate com o estado atual.
  const summary = (await doc("investment_summaries/current").get()).data();
  assert.equal(summary?.currentValueCents, 175_000);
});

test("janela truncada não altera o fechamento de nenhum mês", async () => {
  await seed();
  for (const [key, month] of [
    ["m7-window-1", "2026-05"], ["m7-window-2", "2026-06"],
    ["m7-window-3", "2026-07"], ["m7-window-4", "2026-08"],
  ] as Array<[string, string]>) {
    await executeCreateInvestmentContribution(auth(), contribution(`${key}-0001`, {
      principalCents: 10_000, quantityMicros: 100_000,
      occurredAt: `${month}-10T15:00:00.000Z`,
    }));
  }
  // O fechamento é propriedade do documento do mês: ler só os dois últimos
  // meses não muda o valor de nenhum deles.
  const all = await db()
    .collection(`workspaces/${WORKSPACE}/investment_report_periods`)
    .orderBy("period", "asc").get();
  assert.deepEqual(
    all.docs.map((entry) => entry.data().closingCurrentValueCents),
    [10_000, 20_000, 30_000, 40_000],
  );
  const lastTwo = await db()
    .collection(`workspaces/${WORKSPACE}/investment_report_periods`)
    .orderBy("period", "desc").limit(2).get();
  assert.deepEqual(
    lastTwo.docs.map((entry) => entry.data().closingCurrentValueCents).reverse(),
    [30_000, 40_000],
    "A janela consultada não pode influenciar o fechamento gravado.",
  );
});

test("resgate e valoração deslocam o fechamento do mês correspondente", async () => {
  await seed();
  await executeCreateInvestmentContribution(auth(), contribution("m7-cv-contrib-0001", {
    occurredAt: "2026-07-10T15:00:00.000Z",
  }));
  assert.equal((await periodDoc("2026-07"))?.closingCurrentValueCents, 100_000);

  const pending = await executeCreateInvestmentRedemptionV2(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "m7-cv-redemption-0001",
    correlationId: "corr-m7-cv-redemption",
    accountId: ACCOUNT, assetId: ASSET, description: "Resgate",
    requestedPrincipalCents: 40_000, requestedQuantityMicros: 400_000,
    requestedAt: "2026-08-05T15:00:00.000Z",
  });
  await executeSettleInvestmentRedemption(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "m7-cv-settle-0001",
    correlationId: "corr-m7-cv-settle",
    movementId: String(pending.movementId),
    settledAt: "2026-08-06T15:00:00.000Z",
    settlement: {
      principalCents: 40_000, quantityMicros: 400_000,
      gainCents: 0, lossCents: 0, feesCents: 0, taxCents: 0,
    },
  });
  assert.equal((await periodDoc("2026-07"))?.closingCurrentValueCents, 100_000);
  assert.equal((await periodDoc("2026-08"))?.closingCurrentValueCents, 60_000);

  // Valoração altera patrimônio sem caixa e desloca só o fechamento do mês.
  await executeRecordInvestmentValuation(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "m7-cv-valuation-0001",
    correlationId: "corr-m7-cv-valuation",
    accountId: ACCOUNT, assetId: ASSET,
    unitPriceMicros: 1_200_000_000,
    source: "manual",
    effectiveAt: "2026-08-20T15:00:00.000Z",
    reason: "Marcação a mercado",
  });
  const august = await periodDoc("2026-08");
  assert.equal(august?.cashDeltaCents, 40_000, "Valoração não move caixa.");
  const summary = (await doc("investment_summaries/current").get()).data();
  assert.equal(august?.closingCurrentValueCents, summary?.currentValueCents);
});

test("rebuild recalcula fechamentos e reexecutar não altera o resultado", async () => {
  await seed();
  await executeCreateInvestmentContribution(auth(), contribution("m7-rb-m1-0001", {
    principalCents: 70_000, quantityMicros: 700_000,
    occurredAt: "2026-06-10T15:00:00.000Z",
  }));
  await executeCreateInvestmentContribution(auth(), contribution("m7-rb-m2-0001", {
    principalCents: 30_000, quantityMicros: 300_000,
    occurredAt: "2026-08-10T15:00:00.000Z",
  }));

  // Corrompe os fechamentos para provar que o rebuild os recalcula.
  await doc("investment_report_periods/2026-06")
    .set({closingCurrentValueCents: 999_999}, {merge: true});
  await doc("investment_report_periods/2026-08")
    .set({closingCurrentValueCents: -1}, {merge: true});

  await runProjectionRebuild("corr-m7-rebuild-closings", 2);
  assert.equal((await periodDoc("2026-06"))?.closingCurrentValueCents, 70_000);
  assert.equal((await periodDoc("2026-08"))?.closingCurrentValueCents, 100_000);

  // Idempotente e seguro para retry: reexecutar devolve os mesmos valores.
  await runProjectionRebuild("corr-m7-rebuild-closings-again", 2);
  assert.equal((await periodDoc("2026-06"))?.closingCurrentValueCents, 70_000);
  assert.equal((await periodDoc("2026-08"))?.closingCurrentValueCents, 100_000);

  // Reconciliação com a fonte oficial: último fechamento == estado atual.
  const summary = (await doc("investment_summaries/current").get()).data();
  assert.equal(summary?.currentValueCents, 100_000);
});

test("lançamento retroativo corrige o fechamento dos meses posteriores", async () => {
  await seed();
  await executeCreateInvestmentContribution(auth(), contribution("m7-back-m2-0001", {
    principalCents: 40_000, quantityMicros: 400_000,
    occurredAt: "2026-08-10T15:00:00.000Z",
  }));
  assert.equal((await periodDoc("2026-08"))?.closingCurrentValueCents, 40_000);

  // Aporte com data anterior: o mês antigo passa a existir e o posterior é
  // deslocado, em vez de ficar com um fechamento defasado.
  await executeCreateInvestmentContribution(auth(), contribution("m7-back-m1-0001", {
    principalCents: 10_000, quantityMicros: 100_000,
    occurredAt: "2026-06-10T15:00:00.000Z",
  }));
  assert.equal((await periodDoc("2026-06"))?.closingCurrentValueCents, 10_000);
  assert.equal((await periodDoc("2026-08"))?.closingCurrentValueCents, 50_000);

  const summary = (await doc("investment_summaries/current").get()).data();
  assert.equal(summary?.currentValueCents, 50_000);
});

// INV-P1-005 — a reconstrução recusava rodar em qualquer workspace com
// valoração, deixando sem reparo de deriva exatamente os workspaces que marcam
// a mercado. A fase `timeline` mescla movimentos e valorações por posição, em
// ordem cronológica, e reproduz o caminho incremental centavo a centavo.

test("rebuild com valorações reproduz o caminho incremental e é idempotente", async () => {
  await seed();

  // Junho: aporte. Julho: valoração para cima. Agosto: aporte e nova valoração.
  await executeCreateInvestmentContribution(auth(), contribution("m7-val-c1-0001", {
    principalCents: 100_000, quantityMicros: 1_000_000,
    occurredAt: "2026-06-10T15:00:00.000Z",
  }));
  await executeRecordInvestmentValuation(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "m7-val-v1-0001",
    correlationId: "corr-m7-val-v1",
    accountId: ACCOUNT, assetId: ASSET,
    unitPriceMicros: 120_000_000,
    source: "manual",
    effectiveAt: "2026-07-15T15:00:00.000Z",
    reason: "Marcação a mercado",
  });
  await executeCreateInvestmentContribution(auth(), contribution("m7-val-c2-0001", {
    principalCents: 50_000, quantityMicros: 500_000,
    occurredAt: "2026-08-10T15:00:00.000Z",
  }));
  await executeRecordInvestmentValuation(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "m7-val-v2-0001",
    correlationId: "corr-m7-val-v2",
    accountId: ACCOUNT, assetId: ASSET,
    unitPriceMicros: 90_000_000,
    source: "manual",
    effectiveAt: "2026-08-20T15:00:00.000Z",
    reason: "Marcação a mercado",
  });

  const incremental = {
    "2026-06": await periodDoc("2026-06"),
    "2026-07": await periodDoc("2026-07"),
    "2026-08": await periodDoc("2026-08"),
  };
  const incrementalSummary = (await doc("investment_summaries/current").get()).data();

  // Página pequena de propósito: exercita a retomada dentro da linha do tempo
  // de uma mesma posição, com valorações entre movimentos.
  await runProjectionRebuild("corr-m7-val-rebuild", 2);

  for (const period of ["2026-06", "2026-07", "2026-08"] as const) {
    const rebuilt = await periodDoc(period);
    const before = incremental[period];
    assert.equal(
      rebuilt?.currentValueDeltaCents,
      before?.currentValueDeltaCents,
      `Delta patrimonial de ${period} precisa bater com o incremental.`,
    );
    assert.equal(
      rebuilt?.closingCurrentValueCents,
      before?.closingCurrentValueCents,
      `Fechamento de ${period} precisa bater com o incremental.`,
    );
    assert.equal(rebuilt?.contributionCents, before?.contributionCents);
    assert.equal(rebuilt?.realizedGainCents, before?.realizedGainCents);
  }

  const rebuiltSummary = (await doc("investment_summaries/current").get()).data();
  assert.equal(rebuiltSummary?.currentValueCents, incrementalSummary?.currentValueCents);
  assert.equal(rebuiltSummary?.principalCents, incrementalSummary?.principalCents);

  // Fechamento do último mês reconcilia com o patrimônio do resumo.
  assert.equal(
    (await periodDoc("2026-08"))?.closingCurrentValueCents,
    rebuiltSummary?.currentValueCents,
  );

  // Reexecutar não altera nada: a publicação é de valores absolutos.
  await runProjectionRebuild("corr-m7-val-rebuild-again", 2);
  for (const period of ["2026-06", "2026-07", "2026-08"] as const) {
    const again = await periodDoc(period);
    assert.equal(again?.closingCurrentValueCents, incremental[period]?.closingCurrentValueCents);
    assert.equal(again?.currentValueDeltaCents, incremental[period]?.currentValueDeltaCents);
  }
});

test("rebuild poda período órfão e substitui o mapa diário", async () => {
  await seed();
  await executeCreateInvestmentContribution(auth(), contribution("m7-prune-c1-0001", {
    principalCents: 40_000, quantityMicros: 400_000,
    occurredAt: "2026-08-10T15:00:00.000Z",
  }));

  // Período sem lastro nenhum no ledger, como sobreviveria de uma execução
  // anterior, e uma chave de dia obsoleta no mês legítimo (INV-P2-015).
  await doc("investment_report_periods/2026-03").set({
    id: "2026-03", workspaceId: WORKSPACE, profileType: "PF", currency: "BRL",
    period: "2026-03",
    periodStart: admin.firestore.Timestamp.fromDate(new Date("2026-03-01T03:00:00.000Z")),
    contributionCents: 999_999, redemptionPrincipalCents: 0,
    realizedGainCents: 0, feesCents: 0, taxCents: 0, costDeltaCents: 999_999,
    currentValueDeltaCents: 999_999, cashDeltaCents: -999_999,
    settledMovementCount: 1, closingCurrentValueCents: 999_999,
    daily: {"2026-03-01": {contributionCents: 999_999}},
    updatedAt: admin.firestore.FieldValue.serverTimestamp(), updatedBy: "teste",
  });
  await doc("investment_report_periods/2026-08").update({
    "daily.2026-08-01": {contributionCents: 777_777},
  });

  await runProjectionRebuild("corr-m7-prune-rebuild", 20);

  const orphan = await periodDoc("2026-03");
  assert.equal(orphan?.contributionCents, 0);
  assert.equal(orphan?.closingCurrentValueCents, 0);
  assert.deepEqual(orphan?.daily, {});

  const august = await periodDoc("2026-08");
  assert.equal(august?.contributionCents, 40_000);
  // O dia inventado desapareceu: o mapa é substituído, não mesclado.
  assert.equal((august?.daily as Record<string, unknown>)["2026-08-01"], undefined);
  assert.ok((august?.daily as Record<string, unknown>)["2026-08-10"]);
});

test("período legado sem fechamento é semeado com a base cumulativa", async () => {
  await seed();
  await executeCreateInvestmentContribution(auth(), contribution("m7-legacy-m1-0001", {
    principalCents: 30_000, quantityMicros: 300_000,
    occurredAt: "2026-06-10T15:00:00.000Z",
  }));
  await executeCreateInvestmentContribution(auth(), contribution("m7-legacy-m2-0001", {
    principalCents: 20_000, quantityMicros: 200_000,
    occurredAt: "2026-07-10T15:00:00.000Z",
  }));
  // Simula documento anterior ao campo: mantém o delta do mês e remove o
  // fechamento, como estaria um período gravado antes desta versão.
  await doc("investment_report_periods/2026-07").update({
    closingCurrentValueCents: admin.firestore.FieldValue.delete(),
  });

  await executeCreateInvestmentContribution(auth(), contribution("m7-legacy-m2b-0001", {
    principalCents: 10_000, quantityMicros: 100_000,
    occurredAt: "2026-07-20T15:00:00.000Z",
  }));

  // 30.000 de junho + 20.000 e 10.000 de julho.
  assert.equal((await periodDoc("2026-07"))?.closingCurrentValueCents, 60_000);
  const summary = (await doc("investment_summaries/current").get()).data();
  assert.equal(summary?.currentValueCents, 60_000);
});
