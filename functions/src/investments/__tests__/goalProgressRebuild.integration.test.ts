import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";

import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {executeRecalculateGoalInvestmentProgress} from "../rebuild";
import {investmentPositionId} from "../infrastructure";

/**
 * Recálculo do progresso patrimonial de uma meta (Etapa 3, §2.E).
 *
 * Esta cobertura existia só por E2E, dirigindo o painel operacional pela tela
 * de Configurações. A Etapa 3 tirou aquela superfície da navegação comum
 * (§0.B), e o roteiro de interface deixou de ser executável — mas o invariante
 * que ele protegia não mudou de valor, então ele desce para a camada onde
 * continua exercitável de ponta a ponta, com o emulador no meio.
 *
 * O que fica fixado:
 *
 * - o recálculo publica o **valor absoluto** das posições vinculadas, e não um
 *   delta somado ao número anterior — uma meta em deriva precisa convergir
 *   para a soma real, não afastar-se mais dela;
 * - a execução é paginada e retomável, com a mesma identidade por página que o
 *   contrato de execução paginada exige;
 * - repetir a chamada com a mesma chave não move a meta duas vezes.
 */

const PROJECT = process.env.GCLOUD_PROJECT ?? "minhas-financas-local";
const WORKSPACE = "ws-goal-progress-rebuild";
const OWNER = "owner-goal-progress-rebuild";
const GOAL = "meta-em-deriva";
const ACCOUNT = "conta-rebuild";
const MAX_PAGES = 40;

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const auth = (): WorkspaceAuthorizationContext => ({
  workspaceId: WORKSPACE,
  uid: OWNER,
  role: "owner",
});

/**
 * Meta com progresso deliberadamente fora de sincronia com as posições.
 *
 * As duas posições vinculadas somam 50.000 centavos; a meta declara 999.999. É
 * o estado de deriva que o recálculo existe para corrigir.
 */
const seed = async (): Promise<void> => {
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
  const now = admin.firestore.Timestamp.now();
  const base = {
    workspaceId: WORKSPACE, profileType: "PF" as const, currency: "BRL",
    createdBy: OWNER, updatedBy: OWNER, createdAt: now, updatedAt: now,
  };

  await db().doc(`workspaces/${WORKSPACE}`).set({
    ownerId: OWNER, type: "PF", currency: "BRL", name: WORKSPACE,
  });
  await db().doc(`workspaces/${WORKSPACE}/members/${OWNER}`).set({
    uid: OWNER, role: "owner", status: "active",
  });

  await db().doc(`workspaces/${WORKSPACE}/goals/${GOAL}`).set({
    ...base,
    id: GOAL,
    name: "Reserva de emergência",
    category: "patrimonio",
    status: "em_andamento",
    priority: "media",
    targetAmount: 10_000,
    targetAmountCents: 1_000_000,
    startDate: "2026-01-01",
    deadline: "2026-12-31",
    horizon: "medio",
    progressBasis: "net_contributions",
    archived: false,
    profileId: WORKSPACE,
    visual: {color: "#112233", icon: "target", progressBarType: "linear"},
    investmentNetContributionCents: 999_999,
    investmentCurrentValueCents: 999_999,
    investmentProgressCents: 999_999,
  });

  await db().doc(`workspaces/${WORKSPACE}/investment_accounts/${ACCOUNT}`).set({
    ...base, id: ACCOUNT, name: "Corretora", institutionName: "Banco",
    status: "active",
  });

  await Promise.all([1, 2].map((index) =>
    db().doc(`workspaces/${WORKSPACE}/investment_assets/ativo-${index}`).set({
      ...base, id: `ativo-${index}`, name: `CDB ${index}`, symbol: `CDB${index}`,
      assetType: "fixed_income", allocationPurpose: "unassigned", status: "active",
    })));

  await Promise.all([1, 2].map((index) => {
    const id = investmentPositionId(ACCOUNT, `ativo-${index}`);
    return db().doc(`workspaces/${WORKSPACE}/investment_positions/${id}`).set({
      ...base, id, accountId: ACCOUNT, assetId: `ativo-${index}`,
      goalId: GOAL, status: "active",
      principalCents: 25_000, currentValueCents: 25_000,
      realizedGainCents: 0, realizedLossCents: 0, feesCents: 0, taxCents: 0,
      quantityMicros: 1_000_000, version: 1,
    });
  }));
};

const run = async (correlationId: string): Promise<Record<string, unknown>> => {
  let last: Record<string, unknown> = {};
  for (let page = 0; page < MAX_PAGES; page += 1) {
    last = await executeRecalculateGoalInvestmentProgress(auth(), {
      workspaceId: WORKSPACE,
      goalId: GOAL,
      pageSize: 1,
      reason: "Reconciliação após deriva",
      idempotencyKey: `goal-rebuild-${correlationId}-page-${page}`,
      correlationId,
    });
    // A reconstrução de meta devolve `hasMore`, não `completed`: assumir o
    // segundo faria a repaginação continuar depois do fim e receber
    // "Esta reconstrução já foi concluída." na página seguinte.
    if (last.hasMore === false || last.completed === true) break;
  }
  return last;
};

const goalDoc = async () =>
  (await db().doc(`workspaces/${WORKSPACE}/goals/${GOAL}`).get()).data();

test("o recálculo publica o valor absoluto das posições vinculadas", async () => {
  await seed();
  const result = await run("corr-goal-rebuild-absoluto");

  assert.equal(result.hasMore, false, "o recálculo precisa concluir");

  const goal = await goalDoc();
  assert.equal(goal?.investmentNetContributionCents, 50_000);
  assert.equal(goal?.investmentCurrentValueCents, 50_000);
  // `progressBasis: net_contributions` publica a soma de aportes líquidos.
  assert.equal(goal?.investmentProgressCents, 50_000);
});

test("a execução atravessa mais de uma página com pageSize pequeno", async () => {
  await seed();
  let pages = 0;
  let last: Record<string, unknown> = {};
  const correlationId = "corr-goal-rebuild-paginado";
  for (; pages < MAX_PAGES; pages += 1) {
    last = await executeRecalculateGoalInvestmentProgress(auth(), {
      workspaceId: WORKSPACE,
      goalId: GOAL,
      pageSize: 1,
      reason: "Reconciliação paginada",
      idempotencyKey: `goal-rebuild-${correlationId}-page-${pages}`,
      correlationId,
    });
    if (last.hasMore === false) break;
  }
  assert.equal(last.hasMore, false);
  assert.ok(pages > 0, "duas posições com pageSize 1 exigem mais de uma página");
  assert.equal((await goalDoc())?.investmentProgressCents, 50_000);
});

test("repetir a chamada não soma o progresso duas vezes", async () => {
  /*
   * O recálculo é absoluto por construção, e a reserva de idempotência devolve
   * a mesma resposta para a mesma chave. As duas proteções juntas são o que
   * impede um retry de dobrar a meta.
   */
  await seed();
  await run("corr-goal-rebuild-repeticao");
  assert.equal((await goalDoc())?.investmentProgressCents, 50_000);

  await executeRecalculateGoalInvestmentProgress(auth(), {
    workspaceId: WORKSPACE,
    goalId: GOAL,
    pageSize: 1,
    reason: "Reconciliação após deriva",
    idempotencyKey: "goal-rebuild-corr-goal-rebuild-repeticao-page-0",
    correlationId: "corr-goal-rebuild-repeticao",
  });
  assert.equal((await goalDoc())?.investmentProgressCents, 50_000);
});
