import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {
  applyCashPeriodWriteOnce,
  cashPeriodEventKey,
} from "../../cash/periods";
import {
  executeCreateInvestmentContribution,
  executeCreateInvestmentRedemptionV2,
  executeLinkInvestmentToGoal,
  executeReverseInvestmentMovement,
  executeSettleInvestmentRedemption,
  executeUnlinkInvestmentFromGoal,
} from "../operationsV2";
import {executeRecalculateGoalInvestmentProgress} from "../rebuild";

/**
 * Fonte única do progresso patrimonial da meta.
 *
 * A grandeza tem **um** produtor: `investment_movements` altera a posição, e a
 * mesma transação do ledger aplica a variação na meta por
 * `operationsV2.updateGoalProjection`. O espelho de caixa gravado em
 * `transactions` carrega `goalId` — e é justamente por carregar que ele já foi,
 * historicamente, uma segunda fonte: `onTransactionWrite` recompunha o
 * progresso a partir dele, e cada aporte contava duas vezes.
 *
 * Este arquivo prova a assimetria que fecha o assunto:
 *
 *   movimento  → progresso da meta
 *   transação  → **nada** na meta
 *
 * e fecha com a reconciliação oficial (`recalculateGoalInvestmentProgress`)
 * concordando com o caminho incremental — que é a prova de que nenhuma das
 * operações contou em dobro pelo caminho.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório.");
}

const PROJECT = process.env.GCLOUD_PROJECT ?? "minhas-financas-local";
const WORKSPACE = "goal-single-source-workspace";
const OWNER = "goal-single-source-owner";
const ACCOUNT = "goal-single-source-account";
const ASSET_A = "goal-single-source-asset-a";
const ASSET_B = "goal-single-source-asset-b";
const GOAL = "goal-single-source-goal";

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const auth = (): WorkspaceAuthorizationContext => ({
  workspaceId: WORKSPACE, uid: OWNER, role: "owner",
});

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

const goalData = async () =>
  (await db().doc(`workspaces/${WORKSPACE}/goals/${GOAL}`).get()).data();

const progresso = async () => {
  const meta = await goalData();
  return [
    Number(meta?.investmentNetContributionCents ?? 0),
    Number(meta?.investmentCurrentValueCents ?? 0),
    Number(meta?.investmentProgressCents ?? 0),
  ] as const;
};

const periodo = async (chave: string) =>
  (await db().doc(
    `workspaces/${WORKSPACE}/cash_report_periods/${chave}`,
  ).get()).data();

const seed = async (): Promise<void> => {
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
  await db().doc(`workspaces/${WORKSPACE}`).set({
    ownerId: OWNER, type: "PF", currency: "BRL", name: WORKSPACE,
  });
  await db().doc(`workspaces/${WORKSPACE}/members/${OWNER}`).set({
    uid: OWNER, role: "owner", status: "active",
  });
  const now = at("2026-08-01T00:00:00.000Z");
  await db().doc(`workspaces/${WORKSPACE}/investment_accounts/${ACCOUNT}`).set({
    id: ACCOUNT, workspaceId: WORKSPACE, profileType: "PF",
    name: "Corretora", institutionName: "Instituição de teste",
    currency: "BRL", status: "active",
    createdBy: "seed", updatedBy: "seed", createdAt: now, updatedAt: now,
  });
  await Promise.all([ASSET_A, ASSET_B].map((assetId, index) =>
    db().doc(`workspaces/${WORKSPACE}/investment_assets/${assetId}`).set({
      id: assetId, workspaceId: WORKSPACE, profileType: "PF",
      name: `Ativo ${index + 1}`, symbol: `AT${index + 1}`,
      assetType: "fixed_income", currency: "BRL", status: "active",
      createdBy: "seed", updatedBy: "seed", createdAt: now, updatedAt: now,
    })));
  await db().doc(`workspaces/${WORKSPACE}/goals/${GOAL}`).set({
    id: GOAL, workspaceId: WORKSPACE, name: "Meta patrimonial",
    progressBasis: "net_contributions",
    investmentNetContributionCents: 0,
    investmentCurrentValueCents: 0,
    investmentProgressCents: 0,
    investmentProjectionVersion: 0,
  });
};

/**
 * Entrega do gatilho de transações sobre o espelho de caixa, exatamente como
 * `onTransactionWrite` a executa. É o caminho que **não** pode tocar a meta.
 */
const entregarGatilho = async (
  eventId: string,
  transactionId: string,
  before: admin.firestore.DocumentData | undefined,
  after: admin.firestore.DocumentData | undefined,
) => db().runTransaction((tx) =>
  applyCashPeriodWriteOnce(
    tx,
    WORKSPACE,
    cashPeriodEventKey(eventId),
    before,
    after,
    {transactionId, action: !before ? "CREATE" : !after ? "DELETE" : "UPDATE"},
  ));

const espelhoDe = async (transactionId: string) =>
  (await db().doc(
    `workspaces/${WORKSPACE}/transactions/${transactionId}`,
  ).get()).data();

test(
  "o movimento move a meta; a projeção de caixa não a move de novo",
  async () => {
    await seed();

    // --- aporte vinculado ---------------------------------------------------
    const aporte = await executeCreateInvestmentContribution(auth(), {
      workspaceId: WORKSPACE,
      idempotencyKey: "goal-fonte-aporte-0001",
      correlationId: "corr-goal-fonte-aporte",
      accountId: ACCOUNT, assetId: ASSET_A, goalId: GOAL,
      walletId: "wallet-a", description: "Aporte vinculado à meta",
      principalCents: 100_000, quantityMicros: 1_000_000,
      feesCents: 0, taxCents: 0,
      occurredAt: "2026-08-10T12:00:00.000Z",
    });
    assert.deepEqual(await progresso(), [100_000, 100_000, 100_000]);

    // O espelho existe, carrega `goalId` e é o documento que o gatilho vê.
    const transactionId = String(aporte.transactionId);
    const espelho = await espelhoDe(transactionId);
    assert.equal(espelho?.type, "investimento");
    assert.equal(espelho?.goalId, GOAL);
    assert.equal(espelho?.investmentMetadata?.cashImpact, "outflow");

    // --- o gatilho de caixa não é uma segunda fonte -------------------------
    const antes = await progresso();
    await entregarGatilho(
      "evt-goal-fonte-0001", transactionId, undefined, espelho);
    assert.deepEqual(
      await progresso(),
      antes,
      "a entrega do espelho não pode mexer no progresso da meta",
    );
    // E o caixa recebeu o aporte exatamente uma vez, mesmo com reentrega.
    assert.equal((await periodo("2026-08"))?.investmentOutflowCents, 100_000);
    await entregarGatilho(
      "evt-goal-fonte-0001", transactionId, undefined, espelho);
    assert.equal((await periodo("2026-08"))?.investmentOutflowCents, 100_000);
    assert.deepEqual(await progresso(), antes);

    // --- vínculo de uma posição existente -----------------------------------
    const livre = await executeCreateInvestmentContribution(auth(), {
      workspaceId: WORKSPACE,
      idempotencyKey: "goal-fonte-aporte-livre-0001",
      correlationId: "corr-goal-fonte-aporte-livre",
      accountId: ACCOUNT, assetId: ASSET_B,
      walletId: "wallet-a", description: "Aporte sem meta",
      principalCents: 40_000, quantityMicros: 400_000,
      feesCents: 0, taxCents: 0,
      occurredAt: "2026-08-12T12:00:00.000Z",
    });
    assert.deepEqual(await progresso(), [100_000, 100_000, 100_000]);

    // O espelho do segundo aporte é entregue como qualquer outro: ele soma no
    // caixa e, por não ter meta, não tinha o que somar na meta.
    await entregarGatilho(
      "evt-goal-fonte-livre-0001",
      String(livre.transactionId),
      undefined,
      await espelhoDe(String(livre.transactionId)),
    );
    assert.equal((await periodo("2026-08"))?.investmentOutflowCents, 140_000);
    assert.deepEqual(await progresso(), [100_000, 100_000, 100_000]);

    await executeLinkInvestmentToGoal(auth(), {
      workspaceId: WORKSPACE,
      idempotencyKey: "goal-fonte-vincular-0001",
      correlationId: "corr-goal-fonte-vincular",
      accountId: ACCOUNT, assetId: ASSET_B, goalId: GOAL,
      occurredAt: "2026-08-13T12:00:00.000Z",
      reason: "Passa a compor a meta",
    });
    assert.deepEqual(await progresso(), [140_000, 140_000, 140_000]);

    // Vincular não escreve espelho de caixa: o caixa continua nos dois
    // aportes já entregues, e só neles.
    assert.equal(
      (await periodo("2026-08"))?.investmentOutflowCents,
      140_000,
      "vincular à meta não pode mover caixa",
    );

    // --- desvínculo ---------------------------------------------------------
    await executeUnlinkInvestmentFromGoal(auth(), {
      workspaceId: WORKSPACE,
      idempotencyKey: "goal-fonte-desvincular-0001",
      correlationId: "corr-goal-fonte-desvincular",
      accountId: ACCOUNT, assetId: ASSET_B, goalId: GOAL,
      occurredAt: "2026-08-14T12:00:00.000Z",
      reason: "Sai do planejamento da meta",
    });
    assert.deepEqual(await progresso(), [100_000, 100_000, 100_000]);

    // --- resgate liquidado reduz o progresso --------------------------------
    const resgate = await executeCreateInvestmentRedemptionV2(auth(), {
      workspaceId: WORKSPACE,
      idempotencyKey: "goal-fonte-resgate-0001",
      correlationId: "corr-goal-fonte-resgate",
      accountId: ACCOUNT, assetId: ASSET_A,
      walletId: "wallet-a", description: "Resgate parcial",
      requestedPrincipalCents: 30_000,
      requestedQuantityMicros: 300_000,
      requestedAt: "2026-08-18T10:00:00.000Z",
      expectedSettlementAt: "2026-08-19T12:00:00.000Z",
    });
    // Pedido pendente não é fato consumado: a meta não se move.
    assert.deepEqual(await progresso(), [100_000, 100_000, 100_000]);

    await executeSettleInvestmentRedemption(auth(), {
      workspaceId: WORKSPACE,
      idempotencyKey: "goal-fonte-liquidacao-0001",
      correlationId: "corr-goal-fonte-liquidacao",
      movementId: String(resgate.movementId),
      settlement: {
        principalCents: 30_000, quantityMicros: 300_000,
        gainCents: 5_000, lossCents: 0, feesCents: 0, taxCents: 0,
      },
      settledAt: "2026-08-19T12:00:00.000Z",
    });
    const aposResgate = await progresso();
    assert.equal(aposResgate[0], 70_000, "o resgate reduz o principal da meta");

    // O espelho do resgate passou de pendente a liquidado: uma alteração, que
    // o gatilho entrega como UPDATE. Continua sem tocar a meta.
    const espelhoResgate = await espelhoDe(String(resgate.transactionId));
    assert.equal(espelhoResgate?.investmentMetadata?.status, "settled");
    await entregarGatilho(
      "evt-goal-fonte-0002",
      String(resgate.transactionId),
      {...espelhoResgate, investmentMetadata: {
        ...espelhoResgate?.investmentMetadata, status: "pending",
        cashImpact: "none",
      }},
      espelhoResgate,
    );
    assert.deepEqual(
      await progresso(),
      aposResgate,
      "a liquidação entregue pelo gatilho não pode mexer na meta",
    );

    // --- reversão restaura --------------------------------------------------
    await executeReverseInvestmentMovement(auth(), {
      workspaceId: WORKSPACE,
      idempotencyKey: "goal-fonte-estorno-0001",
      correlationId: "corr-goal-fonte-estorno",
      movementId: String(resgate.movementId),
      reversedAt: "2026-08-22T12:00:00.000Z",
      reason: "Resgate lançado por engano",
    });
    assert.equal(
      (await progresso())[0],
      100_000,
      "a reversão restaura o principal da meta",
    );

    // --- nenhuma dupla contagem, conferida pela reconciliação oficial -------
    const incremental = await progresso();
    const reconciliacao =
      await executeRecalculateGoalInvestmentProgress(auth(), {
      workspaceId: WORKSPACE,
      idempotencyKey: "goal-fonte-reconciliacao-0001",
      correlationId: "corr-goal-fonte-reconciliacao",
      goalId: GOAL,
      pageSize: 50,
      reason: "Conferência da fonte única",
    });
    assert.equal(reconciliacao.status, "completed");
    assert.equal(
      reconciliacao.netContributionCents,
      incremental[0],
      "a reconciliação a partir das posições precisa bater com o incremental",
    );

    // E o número é exatamente a soma das posições vinculadas — nem o dobro,
    // nem metade.
    const vinculadas = await db()
      .collection(`workspaces/${WORKSPACE}/investment_positions`)
      .where("goalId", "==", GOAL)
      .get();
    const soma = vinculadas.docs.reduce(
      (total, posicao) => total + Number(posicao.data().principalCents ?? 0),
      0,
    );
    assert.equal((await progresso())[0], soma);
    assert.equal((await goalData())?.investmentProjectionDirty, false);
  },
);
