import assert from "node:assert/strict";
import test from "node:test";
import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../../creditCards/auth";
import {
  executeCreateInvestmentContribution,
  executeCreateInvestmentRedemptionV2,
  executeSettleInvestmentRedemption,
} from "../operationsV2";
import {executeRebuildInvestmentProjections} from "../projectionRebuild";
import {
  executeRecalculateGoalInvestmentProgress,
  executeRecalculateInvestmentPosition,
} from "../rebuild";

/**
 * Concorrência de reconstrução (INV-P3-002).
 *
 * `operationLease.ts` saiu junto com a migração legada, seu único adquirente.
 * O que restou segurando duas reconstruções simultâneas do mesmo workspace é o
 * par que já existia: **`expectedProjectionVersion`** — toda mutação publica
 * uma versão nova de projeção — e a **serialização transacional do Firestore**,
 * que põe `investment_summaries/current` (e, no caminho de meta, o documento da
 * própria meta) no conjunto de leitura de **toda** página.
 *
 * Este arquivo é a prova exigida antes do rollout. Ele executa duas
 * reconstruções concorrentes do mesmo workspace e exige que o estado final
 * seja **idêntico** ao que o caminho incremental publicou — que é a única
 * afirmação capaz de reprovar, de uma vez:
 *
 *   - dupla aplicação (os valores dobrariam);
 *   - perda de movimentos (os valores ficariam abaixo);
 *   - posições divergentes;
 *   - metas divergentes;
 *   - períodos duplicados (a contagem de documentos mudaria);
 *   - estado parcialmente publicado (algum documento ficaria fora do conjunto).
 *
 * A razão de o desenho bastar sem lease está escrita em
 * `docs/investments/INVESTMENTS_SINGLE_DOMAIN_FINALIZATION.md` §15: a
 * reconstrução **nunca incrementa**. Ela lê o ledger e publica valor absoluto.
 * Duas execuções sobre o mesmo ledger publicam o mesmo número; a única coisa
 * que precisa ser impedida é publicar sobre um ledger que mudou no meio, e é
 * exatamente isso que a cerca de versão impede.
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST é obrigatório.");
}

const PROJECT = process.env.GCLOUD_PROJECT ?? "minhas-financas-local";
const WORKSPACE = "rebuild-concurrency-workspace";
const OWNER = "rebuild-concurrency-owner";
const ACCOUNT = "rebuild-concurrency-account";
const ASSET_A = "rebuild-concurrency-asset-a";
const ASSET_B = "rebuild-concurrency-asset-b";
const GOAL = "rebuild-concurrency-goal";
const MAX_PAGES = 60;

const db = (): admin.firestore.Firestore => {
  if (!admin.apps.length) admin.initializeApp({projectId: PROJECT});
  return admin.firestore();
};

const auth = (): WorkspaceAuthorizationContext => ({
  workspaceId: WORKSPACE,
  uid: OWNER,
  role: "owner",
});

const at = (iso: string) => Timestamp.fromDate(new Date(iso));

const seedWorkspace = async (): Promise<void> => {
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
 * Ledger com relevo suficiente para a reconstrução ter o que errar: duas
 * posições, dois meses, uma meta vinculada e um resgate liquidado.
 */
const seedLedger = async (): Promise<void> => {
  await executeCreateInvestmentContribution(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "rebuild-conc-aporte-a-0001",
    correlationId: "corr-rebuild-conc-aporte-a",
    accountId: ACCOUNT, assetId: ASSET_A, goalId: GOAL,
    walletId: "wallet-a", description: "Aporte com meta",
    principalCents: 120_000, quantityMicros: 1_200_000,
    feesCents: 0, taxCents: 0,
    occurredAt: "2026-07-10T12:00:00.000Z",
  });
  await executeCreateInvestmentContribution(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "rebuild-conc-aporte-b-0001",
    correlationId: "corr-rebuild-conc-aporte-b",
    accountId: ACCOUNT, assetId: ASSET_B,
    walletId: "wallet-a", description: "Aporte sem meta",
    principalCents: 80_000, quantityMicros: 800_000,
    feesCents: 0, taxCents: 0,
    occurredAt: "2026-08-05T12:00:00.000Z",
  });
  const redemption = await executeCreateInvestmentRedemptionV2(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "rebuild-conc-resgate-0001",
    correlationId: "corr-rebuild-conc-resgate",
    accountId: ACCOUNT, assetId: ASSET_B,
    walletId: "wallet-a", description: "Resgate parcial",
    requestedPrincipalCents: 30_000,
    requestedQuantityMicros: 300_000,
    requestedAt: "2026-08-20T10:00:00.000Z",
    expectedSettlementAt: "2026-08-21T12:00:00.000Z",
  });
  await executeSettleInvestmentRedemption(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "rebuild-conc-liquidacao-0001",
    correlationId: "corr-rebuild-conc-liquidacao",
    movementId: String(redemption.movementId),
    settlement: {
      principalCents: 30_000,
      quantityMicros: 300_000,
      gainCents: 4_000,
      lossCents: 0,
      feesCents: 0,
      taxCents: 0,
    },
    settledAt: "2026-08-21T12:00:00.000Z",
  });
};

interface Retrato {
  summary: Record<string, unknown> | undefined;
  positions: Array<[string, number, number]>;
  periods: Array<[string, number, number, number]>;
  allocations: Array<[string, number, number]>;
  goal: [number, number, number];
  movementCount: number;
}

/** Estado publicado, na forma em que uma divergência salta aos olhos. */
const retrato = async (): Promise<Retrato> => {
  const root = `workspaces/${WORKSPACE}`;
  const [summary, positions, periods, allocations, goal, movements] =
    await Promise.all([
      db().doc(`${root}/investment_summaries/current`).get(),
      db().collection(`${root}/investment_positions`)
        .orderBy(admin.firestore.FieldPath.documentId()).get(),
      db().collection(`${root}/investment_report_periods`)
        .orderBy(admin.firestore.FieldPath.documentId()).get(),
      db().collection(`${root}/investment_allocation_summaries`)
        .orderBy(admin.firestore.FieldPath.documentId()).get(),
      db().doc(`${root}/goals/${GOAL}`).get(),
      db().collection(`${root}/investment_movements`).get(),
    ]);
  const s = summary.data() ?? {};
  return {
    summary: {
      principalCents: s.principalCents,
      currentValueCents: s.currentValueCents,
      realizedGainCents: s.realizedGainCents,
      realizedLossCents: s.realizedLossCents,
      positionCount: s.positionCount,
    },
    positions: positions.docs.map((entry) => [
      entry.id,
      Number(entry.data().principalCents ?? 0),
      Number(entry.data().currentValueCents ?? 0),
    ]),
    periods: periods.docs.map((entry) => [
      entry.id,
      Number(entry.data().contributionCents ?? 0),
      Number(entry.data().redemptionPrincipalCents ?? 0),
      Number(entry.data().closingCurrentValueCents ?? 0),
    ]),
    allocations: allocations.docs.map((entry) => [
      entry.id,
      Number(entry.data().principalCents ?? 0),
      Number(entry.data().currentValueCents ?? 0),
    ]),
    goal: [
      Number(goal.data()?.investmentNetContributionCents ?? 0),
      Number(goal.data()?.investmentCurrentValueCents ?? 0),
      Number(goal.data()?.investmentProgressCents ?? 0),
    ],
    movementCount: movements.size,
  };
};

interface Execucao {
  pages: number;
  completed: boolean;
  restartCount: number;
  erro?: string;
}

/** Repagina uma reconstrução como a superfície operacional o faz. */
const dirigirReconstrucao = async (
  correlationId: string,
  pageSize: number,
): Promise<Execucao> => {
  const execucao: Execucao = {pages: 0, completed: false, restartCount: 0};
  let rebuildId: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    try {
      const resultado = await executeRebuildInvestmentProjections(auth(), {
        workspaceId: WORKSPACE,
        pageSize,
        reason: "Reconstrução concorrente",
        ...(rebuildId ? {rebuildId} : {}),
        idempotencyKey: `${correlationId}-page-${page}`,
        correlationId,
      });
      execucao.pages += 1;
      if (typeof resultado.rebuildId === "string") {
        rebuildId = resultado.rebuildId;
      }
      execucao.restartCount = Number(resultado.restartCount ?? 0);
      if (resultado.completed === true) {
        execucao.completed = true;
        break;
      }
    } catch (erro) {
      execucao.erro = erro instanceof Error ? erro.message : String(erro);
      break;
    }
  }
  return execucao;
};

test(
  "duas reconstruções simultâneas do mesmo workspace convergem no mesmo estado",
  async () => {
    await seedWorkspace();
    await seedLedger();

    // Referência: o que o caminho incremental publicou movimento a movimento.
    // Uma reconstrução correta reproduz exatamente estes números.
    const esperado = await retrato();
    assert.equal(esperado.positions.length, 2);
    assert.equal(esperado.movementCount, 3, "3 movimentos no ledger");
    assert.equal(
      esperado.goal[0], 120_000, "a meta recebeu o aporte vinculado");

    // Tamanhos de página diferentes de propósito: as duas execuções chegam à
    // fase de publicação em instantes distintos, que é quando a disputa
    // acontece.
    const [primeira, segunda] = await Promise.all([
      dirigirReconstrucao("corr-rebuild-conc-a-0001", 1),
      dirigirReconstrucao("corr-rebuild-conc-b-0001", 2),
    ]);

    assert.ok(
      primeira.completed || segunda.completed,
      "ao menos uma das execuções concorrentes precisa concluir: " +
        `A=${JSON.stringify(primeira)} B=${JSON.stringify(segunda)}`,
    );

    // Quem não concluiu só pode ter parado por motivo **nomeado** — reinício
    // esgotado ou contexto de execução alheio. Falha fechada, nunca silêncio.
    for (const execucao of [primeira, segunda]) {
      if (execucao.erro) {
        assert.match(
          execucao.erro,
          /reiniciou|outro contexto|já foi concluída|em andamento/i,
          `motivo de parada precisa ser nomeado: ${execucao.erro}`,
        );
      }
    }

    const obtido = await retrato();

    // Nenhum movimento foi perdido nem duplicado: a reconstrução lê o ledger,
    // nunca escreve nele.
    assert.equal(obtido.movementCount, esperado.movementCount);
    // Posições, períodos, alocações e resumo idênticos ao caminho incremental.
    assert.deepEqual(
      obtido.positions, esperado.positions, "posições divergiram");
    assert.deepEqual(obtido.summary, esperado.summary, "resumo divergiu");
    assert.deepEqual(
      obtido.allocations, esperado.allocations, "alocações divergiram");
    assert.deepEqual(obtido.goal, esperado.goal, "meta divergiu");

    // Períodos: mesmos meses, mesmos valores, e nenhum documento a mais. Um
    // período duplicado apareceria aqui como chave extra.
    assert.deepEqual(
      obtido.periods.map(([id]) => id),
      esperado.periods.map(([id]) => id),
      "a série mensal ganhou ou perdeu período",
    );
    assert.deepEqual(obtido.periods, esperado.periods, "períodos divergiram");

    // E o estado publicado é completo: nenhuma execução deixou metade no ar.
    const executando = await db()
      .collection(`workspaces/${WORKSPACE}/investment_snapshots`)
      .where("status", "==", "running")
      .get();
    for (const snapshot of executando.docs) {
      // Um snapshot ainda `running` é retomável por construção: ele guarda
      // fase, cursor e a versão de projeção que esperava encontrar.
      assert.ok(snapshot.data().phase, "snapshot retomável precisa de fase");
      assert.equal(typeof snapshot.data().expectedProjectionVersion, "number");
    }
  },
);

test(
  "reconstrução de posição concorrente não incrementa o resumo duas vezes",
  async () => {
    await seedWorkspace();
    await seedLedger();

    const antes = await retrato();

    const chamada = (sufixo: string) =>
      executeRecalculateInvestmentPosition(auth(), {
        workspaceId: WORKSPACE,
        idempotencyKey: `rebuild-conc-posicao-${sufixo}-0001`,
        correlationId: `corr-rebuild-conc-posicao-${sufixo}`,
        accountId: ACCOUNT,
        assetId: ASSET_A,
        pageSize: 50,
        reason: "Reconstrução de posição concorrente",
      });

    // Duas execuções simultâneas sobre a **mesma** posição. O resumo é mantido
    // por `FieldValue.increment` do delta lido na própria transação: se as duas
    // lessem o mesmo estado anterior e ambas comitassem, o resumo dobraria.
    const resultados = await Promise.allSettled([
      chamada("a"),
      chamada("b"),
    ]);
    assert.ok(
      resultados.some((r) => r.status === "fulfilled"),
      "ao menos uma reconstrução de posição precisa concluir",
    );
    for (const resultado of resultados) {
      if (resultado.status === "rejected") {
        assert.match(
          String(resultado.reason?.message ?? resultado.reason),
          /reconstrução|concluída|contexto|andamento/i,
        );
      }
    }

    const depois = await retrato();
    assert.deepEqual(depois.summary, antes.summary, "o resumo foi duplicado");
    assert.deepEqual(depois.positions, antes.positions, "a posição divergiu");
  },
);

test(
  "reconstrução de meta concorrente publica progresso exato e não dobrado",
  async () => {
    await seedWorkspace();
    await seedLedger();

    const antes = await retrato();
    const chamada = (sufixo: string) =>
      executeRecalculateGoalInvestmentProgress(auth(), {
        workspaceId: WORKSPACE,
        idempotencyKey: `rebuild-conc-meta-${sufixo}-0001`,
        correlationId: `corr-rebuild-conc-meta-${sufixo}`,
        goalId: GOAL,
        pageSize: 50,
        reason: "Reconstrução de meta concorrente",
      });

    const resultados = await Promise.allSettled([chamada("a"), chamada("b")]);
    assert.ok(
      resultados.some((r) => r.status === "fulfilled"),
      "ao menos uma reconstrução de meta precisa concluir",
    );
    for (const resultado of resultados) {
      if (resultado.status === "rejected") {
        // Fail-closed em pt-BR: a cerca de versão da meta recusa publicar
        // sobre um estado que mudou no meio.
        assert.match(
          String(resultado.reason?.message ?? resultado.reason),
          /projeção da meta mudou|nova reconstrução/i,
        );
      }
    }

    const meta = await db()
      .doc(`workspaces/${WORKSPACE}/goals/${GOAL}`)
      .get();
    // O progresso é a soma das posições vinculadas — nunca o dobro dela.
    const vinculadas = await db()
      .collection(`workspaces/${WORKSPACE}/investment_positions`)
      .where("goalId", "==", GOAL)
      .get();
    const somaPrincipal = vinculadas.docs.reduce(
      (total, posicao) => total + Number(posicao.data().principalCents ?? 0),
      0,
    );
    assert.equal(meta.data()?.investmentNetContributionCents, somaPrincipal);
    assert.equal(meta.data()?.investmentProgressCents, somaPrincipal);
    assert.equal(somaPrincipal, antes.goal[0], "o vínculo não mudou de valor");
    assert.equal(meta.data()?.investmentProjectionDirty, false);
  },
);

/**
 * Reinício por escrita concorrente (INV-P3-002).
 *
 * A cerca de versão manda a reconstrução **reiniciar** quando o workspace
 * recebe uma mutação no meio da execução. Este é o caminho que a disputa entre
 * duas reconstruções também percorre, e aqui ele é forçado de propósito — sem
 * depender de escalonamento — porque foi nele que o defeito estava:
 *
 * o snapshot era gravado em `merge`, e `allocations`/`periods` são mapas de
 * chaves abertas. Gravar o mapa vazio do estado reiniciado não apagava chave
 * nenhuma; a página seguinte relia as faixas da tentativa anterior e acumulava
 * as mesmas posições por cima. O principal por faixa de alocação e por período
 * saía publicado em **dobro**, enquanto o resumo — mapa de chaves fixas, todas
 * reescritas com zero — continuava certo, e por isso a conferência de total
 * fechava e nada acusava a divergência.
 */
test("reinício no meio da reconstrução não duplica faixa nem período", async () => {
  await seedWorkspace();
  await seedLedger();

  const correlationId = "corr-rebuild-reinicio-0001";
  let rebuildId: string | undefined;
  let ultima: Record<string, unknown> = {};

  const pagina = async (indice: number) => {
    ultima = await executeRebuildInvestmentProjections(auth(), {
      workspaceId: WORKSPACE,
      pageSize: 1,
      reason: "Reconstrução interrompida por escrita",
      ...(rebuildId ? {rebuildId} : {}),
      idempotencyKey: `${correlationId}-page-${indice}`,
      correlationId,
    });
    if (typeof ultima.rebuildId === "string") rebuildId = ultima.rebuildId;
    return ultima;
  };

  // Acumula o suficiente para haver estado a reiniciar.
  for (let indice = 0; indice < 4; indice += 1) {
    if ((await pagina(indice)).completed === true) break;
  }
  assert.notEqual(
    ultima.completed, true, "o cenário precisa de execução em curso");

  // Escrita concorrente: publica uma versão nova de projeção e obriga o
  // reinício na próxima página.
  await executeCreateInvestmentContribution(auth(), {
    workspaceId: WORKSPACE,
    idempotencyKey: "rebuild-conc-aporte-intruso-0001",
    correlationId: "corr-rebuild-conc-aporte-intruso",
    accountId: ACCOUNT, assetId: ASSET_A,
    walletId: "wallet-a", description: "Aporte durante a reconstrução",
    principalCents: 25_000, quantityMicros: 250_000,
    feesCents: 0, taxCents: 0,
    occurredAt: "2026-08-25T12:00:00.000Z",
  });

  // Referência **depois** da mutação: é neste estado que a reconstrução
  // reiniciada tem de fechar.
  const esperado = await retrato();

  for (let indice = 4; indice < MAX_PAGES; indice += 1) {
    if ((await pagina(indice)).completed === true) break;
  }
  assert.equal(ultima.completed, true, "a reconstrução precisa concluir");
  assert.ok(
    Number(ultima.restartCount ?? 0) >= 1,
    "o cenário precisa ter exercitado ao menos um reinício",
  );

  const obtido = await retrato();
  assert.deepEqual(obtido.summary, esperado.summary, "resumo divergiu");
  assert.deepEqual(obtido.positions, esperado.positions, "posições divergiram");
  assert.deepEqual(
    obtido.allocations,
    esperado.allocations,
    "faixas de alocação duplicadas pelo reinício",
  );
  assert.deepEqual(
    obtido.periods,
    esperado.periods,
    "períodos duplicados pelo reinício",
  );
  assert.deepEqual(obtido.goal, esperado.goal, "meta divergiu");
  assert.equal(obtido.movementCount, esperado.movementCount);
});
