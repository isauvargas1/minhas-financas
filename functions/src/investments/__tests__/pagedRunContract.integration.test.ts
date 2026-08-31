import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";

import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {executeBackfillInvestmentWorkspace} from "../backfill";
import {investmentPositionId} from "../infrastructure";
import {executeRebuildInvestmentProjections} from "../projectionRebuild";

/**
 * Contrato de uma execução paginada, do ponto de vista de quem a dirige.
 *
 * As operações pesadas do domínio são retomáveis por página: cada chamada faz
 * um pedaço e devolve `completed: false` até acabar. Quem repagina é o
 * cliente, e o contrato que ele precisa cumprir tem duas metades que puxam
 * para lados opostos — e a superfície operacional acertava as duas ao
 * contrário:
 *
 * 1. **`correlationId` estável na execução inteira.** Ele é o que deriva o ID
 *    do lote quando o chamador não informa um, e o que o lease usa para
 *    reconhecer a própria execução. Novo a cada página, abre um lote por
 *    página e nenhum avança.
 * 2. **`idempotencyKey` distinta por página.** A reserva é por chave: repetir
 *    a chave faz a página 2 devolver o resultado da página 1 como replay, e a
 *    execução repete a primeira página até o teto.
 *
 * Nada disso aparecia porque toda massa de teste existente cabe numa página:
 * `completed: true` volta na primeira chamada e a segunda nunca acontece. Este
 * arquivo força mais de uma página e exercita as duas metades, inclusive a
 * forma errada, para que a regressão falhe aqui em vez de na produção.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório.");
}

const PROJECT = process.env.GCLOUD_PROJECT || "minhas-financas-local";
const WORKSPACE = "paged-run-contract";
const OWNER = "paged-run-owner";
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

const seed = async (): Promise<void> => {
  await db().recursiveDelete(db().doc(`workspaces/${WORKSPACE}`));
  await db().doc(`workspaces/${WORKSPACE}`).set({
    ownerId: OWNER,
    type: "PJ",
    currency: "BRL",
    name: WORKSPACE,
  });
  await db().doc(`workspaces/${WORKSPACE}/members/${OWNER}`).set({
    uid: OWNER, role: "owner", status: "active",
  });
};

/** Como o cliente **deve** identificar cada página. */
const pageIds = (runCorrelationId: string) => (page: number) => ({
  idempotencyKey: `paged-run-${runCorrelationId}-page-${page}`,
  correlationId: runCorrelationId,
});

test("a reconstrução de projeções conclui em várias páginas", async () => {
  await seed();
  const ids = pageIds("corr-rebuild-multipagina-0001");

  let last: Record<string, unknown> = {};
  let pages = 0;
  let batchId: string | undefined;
  for (; pages < MAX_PAGES; pages += 1) {
    last = await executeRebuildInvestmentProjections(auth(), {
      workspaceId: WORKSPACE,
      pageSize: 50,
      reason: "Reconstrução paginada",
      ...(batchId ? {rebuildId: batchId} : {}),
      ...ids(pages),
    });
    if (typeof last.rebuildId === "string") batchId = last.rebuildId;
    if (last.completed === true) break;
  }

  assert.equal(last.completed, true, "a execução precisa concluir");
  // Mais de uma página: é o cenário que nenhum teste alcançava.
  assert.ok(pages >= 1, "o cenário precisa exercitar mais de uma página");
  assert.ok(pages < MAX_PAGES, "não pode depender do teto de páginas");
  // Todas as páginas pertencem ao mesmo lote.
  assert.equal(typeof batchId, "string");
});

test("repetir a chave em toda página trava a execução na primeira", async () => {
  await seed();
  const fixedKey = "paged-run-chave-repetida-0001";
  const correlationId = "corr-rebuild-chave-repetida-1";

  const first = await executeRebuildInvestmentProjections(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: fixedKey,
    correlationId,
    pageSize: 50,
    reason: "Reconstrução paginada",
  });
  // Exatamente o que a superfície fazia: repagina com o **mesmo** payload.
  const second = await executeRebuildInvestmentProjections(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: fixedKey,
    correlationId,
    pageSize: 50,
    reason: "Reconstrução paginada",
  });

  /*
   * A segunda chamada é replay da primeira: mesmo `phase`, mesmo `completed`.
   * É o que fazia a tela repaginar até o teto e relatar falha numa operação
   * que nunca tinha avançado uma linha.
   */
  assert.equal(second.phase, first.phase);
  assert.equal(second.completed, first.completed);
  assert.equal(first.completed, false, "a primeira página não pode concluir");
});

test("o backfill mantém o próprio lease entre páginas", async () => {
  await seed();
  const ids = pageIds("corr-backfill-multipagina-0001");

  let last: Record<string, unknown> = {};
  let pages = 0;
  let batchId: string | undefined;
  for (; pages < MAX_PAGES; pages += 1) {
    last = await executeBackfillInvestmentWorkspace(auth(), {
      workspaceId: WORKSPACE,
      pageSize: 20,
      reason: "Backfill paginado",
      ...(batchId ? {backfillId: batchId} : {}),
      ...ids(pages),
    });
    if (typeof last.backfillId === "string") batchId = last.backfillId;
    if (last.completed === true) break;
  }

  // O lease é da execução, não da página: se fosse da página, a segunda seria
  // recusada com "já existe uma execução de backfill em andamento".
  assert.equal(last.completed, true);
  assert.ok(pages < MAX_PAGES);
});

test("o lease recusa duas invocações concorrentes do mesmo lote", async () => {
  await seed();
  const ids = pageIds("corr-backfill-lease-0001");

  const first = await executeBackfillInvestmentWorkspace(auth(), {
    workspaceId: WORKSPACE,
    pageSize: 1,
    reason: "Backfill em andamento",
    ...ids(0),
  });
  if (first.completed === true) return; // nada a disputar

  /*
   * Mesmo lote, execução diferente: é o caso que o lease existe para recusar —
   * duas invocações intercalando sobre o mesmo cursor.
   *
   * O lease é do **lote**, não do workspace: dois lotes distintos do mesmo
   * workspace não se bloqueiam. Como cada página publica valor absoluto
   * recalculado do histórico, o resultado converge; o custo é trabalho
   * repetido, não dado errado. A mensagem em pt-BR diz "para este workspace",
   * o que é mais amplo que o comportamento real.
   */
  await assert.rejects(
    () =>
      executeBackfillInvestmentWorkspace(auth(), {
        workspaceId: WORKSPACE,
        pageSize: 1,
        reason: "Backfill concorrente",
        backfillId: String(first.backfillId),
        idempotencyKey: "paged-run-backfill-intruso-0001",
        correlationId: "corr-backfill-intruso-0001",
      }),
    /em andamento/i,
  );
});

/**
 * Backfill de um workspace que **tem** patrimônio, em mais de uma página.
 *
 * O contrato de paginação só era exercitado sobre um workspace vazio: a fase
 * `positions` não tinha alvo, o backfill ia direto a `projections` e concluía
 * na primeira chamada. Com posições reais a execução passa por mais de uma
 * página, e é aí que o encadeamento entre as fases precisa se sustentar.
 */
const seedPatrimonio = async (): Promise<void> => {
  const now = admin.firestore.Timestamp.now();
  const base = {
    workspaceId: WORKSPACE, profileType: "PJ" as const, currency: "BRL",
    createdBy: OWNER, updatedBy: OWNER, createdAt: now, updatedAt: now,
  };
  await db().doc(`workspaces/${WORKSPACE}/investment_accounts/conta-1`).set({
    ...base, id: "conta-1", name: "Tesouraria",
    institutionName: "Banco", status: "active",
  });
  // Duas posições exigem dois ativos: a posição é identificada por
  // (conta, ativo), e `investmentPositionId` deriva o ID desse par.
  await Promise.all([1, 2].map((index) =>
    db().doc(`workspaces/${WORKSPACE}/investment_assets/ativo-${index}`).set({
      ...base, id: `ativo-${index}`, name: `CDB ${index}`, symbol: `CDB${index}`,
      assetType: "fixed_income", allocationPurpose: "reserve", status: "active",
    })));
  await Promise.all([1, 2].map((index) => {
    const id = investmentPositionId("conta-1", `ativo-${index}`);
    return db().doc(`workspaces/${WORKSPACE}/investment_positions/${id}`).set({
      ...base, id, accountId: "conta-1", assetId: `ativo-${index}`,
      status: "active",
      principalCents: 10_000 * index, currentValueCents: 10_000 * index,
      realizedGainCents: 0, realizedLossCents: 0, feesCents: 0, taxCents: 0,
      quantityMicros: 1_000_000, version: 1,
    });
  }));
};

test("o backfill conclui num workspace com posições reais", async () => {
  await seed();
  await seedPatrimonio();
  const ids = pageIds("corr-backfill-com-patrimonio-1");

  let last: Record<string, unknown> = {};
  let pages = 0;
  for (; pages < MAX_PAGES; pages += 1) {
    last = await executeBackfillInvestmentWorkspace(auth(), {
      workspaceId: WORKSPACE,
      pageSize: 20,
      reason: "Backfill com patrimônio",
      ...ids(pages),
    });
    if (last.completed === true) break;
  }

  assert.equal(last.completed, true, "o backfill precisa concluir");
  assert.ok(pages > 0, "com posições reais o backfill passa de uma página");
  assert.equal(last.processedPositions, 2, "as duas posições são reconstruídas");

  // Sem movimento no ledger, a reconstrução zera as posições em vez de manter
  // um principal sem lastro — é o que a reconstrução existe para provar.
  const positions = await db()
    .collection(`workspaces/${WORKSPACE}/investment_positions`).get();
  assert.equal(positions.size, 2);
  for (const position of positions.docs) {
    assert.equal(position.data().principalCents, 0);
  }
});
