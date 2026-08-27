import * as admin from "firebase-admin";
import {FieldPath, FieldValue, Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../creditCards/auth";
import {CreditCardApplicationError} from "../creditCards/errors";
import type {BackfillInvestmentWorkspacePayload} from "./contracts";
import {INVESTMENT_CALCULATION_VERSION} from "./domain";
import {
  authorizeInvestmentTransaction,
  profileTypeFromWorkspace,
  sha256,
} from "./infrastructure";
import {investmentOperationRoles} from "./writeStrategy";
import {
  INVESTMENT_COLLECTIONS,
  investmentCollection,
  investmentDoc,
  investmentFirestore,
  investmentWorkspaceRef,
} from "./paths";
import {executeRebuildInvestmentProjections} from "./projectionRebuild";
import {
  executeRecalculateGoalInvestmentProgress,
  executeRecalculateInvestmentPosition,
} from "./rebuild";

/**
 * Backfill operacional por workspace (M3.E).
 *
 * Reconstruir as projeções de um workspace inteiro exigia chamar uma callable
 * por entidade: nenhuma rotina percorria o workspace. Este orquestrador fecha
 * essa lacuna reutilizando as máquinas de rebuild já existentes — não é um
 * segundo motor de reconstrução.
 *
 * Ordem obrigatória: posições a partir do ledger, depois metas a partir das
 * posições, depois as projeções acumuladas. Inverter a ordem publicaria um
 * resumo derivado de posições ainda defasadas.
 *
 * Cada chamada processa **uma página** de alvos e devolve o cursor; a rotina é
 * retomável e idempotente por página.
 */

const SNAPSHOT_KIND = "workspace_backfill" as const;

/** Teto de páginas internas por alvo; evita laço infinito em caso de defeito. */
const MAX_PAGES_PER_TARGET = 200;

type BackfillPhase = "positions" | "goals" | "projections" | "completed";

interface BackfillState {
  phase: BackfillPhase;
  cursor?: string;
  processedPositions: number;
  processedGoals: number;
  goalIds: string[];
  goalIndex: number;
  projectionCalls: number;
}

const integerOrZero = (value: unknown): number =>
  Number.isSafeInteger(value) ? (value as number) : 0;

/**
 * Chave derivada determinística por alvo e página. O executor aninhado exige
 * chave de idempotência própria; reutilizar a chave do backfill faria a
 * segunda página devolver o replay da primeira e o rebuild nunca avançaria.
 */
const derivedKey = (
  baseKey: string,
  kind: string,
  targetId: string,
  iteration: number,
): string => `bf_${sha256(`${baseKey}:${kind}:${targetId}:${iteration}`)}`;

const readState = (
  snapshot: admin.firestore.DocumentSnapshot,
): BackfillState => {
  const data = snapshot.data() ?? {};
  return {
    phase: (data.phase ?? "positions") as BackfillPhase,
    cursor: typeof data.cursor === "string" ? data.cursor : undefined,
    processedPositions: integerOrZero(data.processedPositions),
    processedGoals: integerOrZero(data.processedGoals),
    goalIds: Array.isArray(data.goalIds) ? (data.goalIds as string[]) : [],
    goalIndex: integerOrZero(data.goalIndex),
    projectionCalls: integerOrZero(data.projectionCalls),
  };
};

/**
 * Executa todas as páginas internas de um rebuild até concluir.
 *
 * O critério é `hasMore === false`, e não `completed`: o recálculo de posição
 * e o de progresso de meta devolvem `hasMore`/`status`, nunca `completed` —
 * quem devolve `completed` é o rebuild de projeções. Com o
 * critério errado a primeira página concluía o alvo e marcava o snapshot como
 * `completed`, e a segunda volta do laço batia em "Esta reconstrução já foi
 * concluída". O defeito só era alcançável num workspace que tivesse posição ou
 * meta a reconstruir, e nenhuma suíte exercitava esse caso.
 */
const runToCompletion = async (
  run: (idempotencyKey: string) => Promise<Record<string, unknown>>,
  baseKey: string,
  kind: string,
  targetId: string,
): Promise<void> => {
  for (let page = 0; page < MAX_PAGES_PER_TARGET; page += 1) {
    const result = await run(derivedKey(baseKey, kind, targetId, page));
    if (result.hasMore === false || result.completed === true) return;
  }
  throw new CreditCardApplicationError(
    "domain_precondition_failed",
    `A reconstrução de ${kind} ${targetId} excedeu ` +
      `${MAX_PAGES_PER_TARGET} páginas.`,
  );
};

export const executeBackfillInvestmentWorkspace = async (
  auth: WorkspaceAuthorizationContext,
  payload: BackfillInvestmentWorkspacePayload,
): Promise<Record<string, unknown>> => {
  const backfillId =
    payload.backfillId ??
    `bf_${sha256(`${auth.workspaceId}:${payload.correlationId}`).slice(0, 36)}`;
  const snapshotRef = investmentDoc(
    auth.workspaceId,
    INVESTMENT_COLLECTIONS.snapshots,
    backfillId,
  );
  const workspaceSnapshot = await investmentWorkspaceRef(auth.workspaceId).get();
  if (!workspaceSnapshot.exists) {
    throw new CreditCardApplicationError(
      "workspace_not_found",
      "Workspace não encontrado.",
    );
  }
  const profileType = profileTypeFromWorkspace(workspaceSnapshot.data() ?? {});
  const snapshotDoc = await snapshotRef.get();
  if (snapshotDoc.exists) {
    const data = snapshotDoc.data() ?? {};
    if (data.workspaceId !== auth.workspaceId || data.kind !== SNAPSHOT_KIND) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "O identificador de backfill pertence a outra execução.",
      );
    }
    if (data.status === "completed") {
      return {
        success: true,
        backfillId,
        phase: "completed",
        completed: true,
        processedPositions: integerOrZero(data.processedPositions),
        processedGoals: integerOrZero(data.processedGoals),
      };
    }
  }
  // M4.F — cerca de execução. O backfill roda fora de transação; sem isto,
  // duas invocações concorrentes com o mesmo `backfillId` intercalavam,
  // sobrescreviam o cursor e reprocessavam páginas. A reserva é feita por
  // transação curta sobre o próprio snapshot, com prazo de expiração para não
  // travar o backfill se um processo morrer no meio.
  const leaseMs = 10 * 60 * 1000;
  /*
   * O lease identifica a **execução**, não a página.
   *
   * Com `idempotencyKey` no token, cada página levava um token diferente e a
   * própria execução era recusada a partir da segunda página
   * ("já existe uma execução de backfill em andamento") — e a chave *precisa*
   * variar por página, senão a reserva de idempotência devolve a página 1 como
   * replay para sempre. As duas exigências só coexistem se o lease se ancorar
   * no `correlationId`, que é estável dentro de uma execução e novo entre
   * execuções, que é exatamente o que o lease quer distinguir.
   */
  const leaseToken = `${auth.uid}:${payload.correlationId}`;
  await investmentFirestore().runTransaction(async (transaction) => {
    // INV-P3-052 — o papel é revalidado **dentro** da transação, como nas
    // demais operações do domínio. O wrapper da callable já autorizou, mas o
    // backfill é longo: uma revogação de papel entre a autorização e a reserva
    // do lease deixava a execução seguir com privilégio que já não existe.
    await authorizeInvestmentTransaction(
      transaction,
      auth,
      investmentOperationRoles("backfillInvestmentWorkspace"),
    );
    const current = await transaction.get(snapshotRef);
    const data = current.data() ?? {};
    const heldBy = data.leaseToken;
    const heldUntil = (data.leaseUntil as Timestamp | undefined)?.toMillis() ?? 0;
    if (
      current.exists &&
      typeof heldBy === "string" &&
      heldBy !== leaseToken &&
      heldUntil > Date.now()
    ) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Já existe uma execução de backfill em andamento para este workspace.",
      );
    }
    transaction.set(
      snapshotRef,
      {
        leaseToken,
        leaseUntil: Timestamp.fromMillis(Date.now() + leaseMs),
      },
      {merge: true},
    );
  });

  const state = snapshotDoc.exists ?
    readState(snapshotDoc) :
    {
      phase: "positions" as BackfillPhase,
      processedPositions: 0,
      processedGoals: 0,
      goalIds: [],
      goalIndex: 0,
      projectionCalls: 0,
    };

  let drift: unknown;
  if (state.phase === "positions") {
    await backfillPositionsPage(auth, payload, state);
  } else if (state.phase === "goals") {
    await backfillGoalsPage(auth, payload, state);
  } else if (state.phase === "projections") {
    drift = await backfillProjections(auth, payload, state);
  }

  const completed = state.phase === "completed";
  await snapshotRef.set(
    {
      id: backfillId,
      workspaceId: auth.workspaceId,
      profileType,
      kind: SNAPSHOT_KIND,
      targetId: auth.workspaceId,
      status: completed ? "completed" : "running",
      phase: state.phase,
      // Campos exigidos pelo contrato de snapshot; o backfill não acumula
      // totais próprios, quem os reconstrói é o rebuild de projeções.
      cutoffAt: snapshotDoc.exists ?
        (snapshotDoc.data()?.cutoffAt as Timestamp) :
        Timestamp.now(),
      processedCount: state.processedPositions + state.processedGoals,
      expectedProjectionVersion: 0,
      totals: {
        quantityMicros: 0,
        principalCents: 0,
        realizedGainCents: 0,
        feesCents: 0,
        taxCents: 0,
        netContributionCents: 0,
        currentValueCents: 0,
      },
      ...(state.cursor ? {cursor: state.cursor} : {cursor: FieldValue.delete()}),
      processedPositions: state.processedPositions,
      processedGoals: state.processedGoals,
      goalIds: state.goalIds,
      goalIndex: state.goalIndex,
      projectionCalls: state.projectionCalls,
      pageSize: payload.pageSize,
      calculationVersion: INVESTMENT_CALCULATION_VERSION,
      correlationId: payload.correlationId,
      createdBy: auth.uid,
      createdAt: snapshotDoc.exists ?
        (snapshotDoc.data()?.createdAt as Timestamp) :
        FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      leaseToken: completed ? FieldValue.delete() : leaseToken,
      leaseUntil: completed ?
        FieldValue.delete() :
        Timestamp.fromMillis(Date.now() + leaseMs),
      ...(completed ? {completedAt: FieldValue.serverTimestamp()} : {}),
    },
    {merge: true},
  );

  return {
    success: true,
    backfillId,
    phase: state.phase,
    completed,
    processedPositions: state.processedPositions,
    processedGoals: state.processedGoals,
    ...(drift ? {drift} : {}),
  };
};

const backfillPositionsPage = async (
  auth: WorkspaceAuthorizationContext,
  payload: BackfillInvestmentWorkspacePayload,
  state: BackfillState,
): Promise<void> => {
  let query = investmentCollection(
    auth.workspaceId,
    INVESTMENT_COLLECTIONS.positions,
  )
    .orderBy(FieldPath.documentId(), "asc")
    .limit(payload.pageSize + 1);
  if (state.cursor) query = query.startAfter(state.cursor);
  const page = await query.get();
  const docs = page.docs.slice(0, payload.pageSize);
  const hasMore = page.size > payload.pageSize;

  for (const doc of docs) {
    const position = doc.data();
    const accountId = String(position.accountId);
    const assetId = String(position.assetId);
    await runToCompletion(
      (idempotencyKey) =>
        executeRecalculateInvestmentPosition(auth, {
          workspaceId: auth.workspaceId,
          idempotencyKey,
          correlationId: payload.correlationId,
          accountId,
          assetId,
          pageSize: payload.pageSize,
          reason: payload.reason,
        }),
      payload.idempotencyKey,
      "position",
      doc.id,
    );
    state.processedPositions += 1;
    const goalId = position.goalId;
    if (typeof goalId === "string" && !state.goalIds.includes(goalId)) {
      state.goalIds.push(goalId);
    }
  }
  state.cursor = docs.length ? docs[docs.length - 1].id : state.cursor;
  if (!hasMore) {
    state.phase = "goals";
    state.cursor = undefined;
  }
};

const backfillGoalsPage = async (
  auth: WorkspaceAuthorizationContext,
  payload: BackfillInvestmentWorkspacePayload,
  state: BackfillState,
): Promise<void> => {
  const slice = state.goalIds.slice(
    state.goalIndex,
    state.goalIndex + payload.pageSize,
  );
  for (const goalId of slice) {
    await runToCompletion(
      (idempotencyKey) =>
        executeRecalculateGoalInvestmentProgress(auth, {
          workspaceId: auth.workspaceId,
          idempotencyKey,
          correlationId: payload.correlationId,
          goalId,
          pageSize: payload.pageSize,
          reason: payload.reason,
        }),
      payload.idempotencyKey,
      "goal",
      goalId,
    );
    state.processedGoals += 1;
    state.goalIndex += 1;
  }
  if (state.goalIndex >= state.goalIds.length) {
    state.phase = "projections";
  }
};

const backfillProjections = async (
  auth: WorkspaceAuthorizationContext,
  payload: BackfillInvestmentWorkspacePayload,
  state: BackfillState,
): Promise<unknown> => {
  let drift: unknown;
  for (let page = 0; page < MAX_PAGES_PER_TARGET; page += 1) {
    const result = await executeRebuildInvestmentProjections(auth, {
      workspaceId: auth.workspaceId,
      idempotencyKey: derivedKey(
        payload.idempotencyKey,
        "projections",
        auth.workspaceId,
        state.projectionCalls,
      ),
      correlationId: payload.correlationId,
      pageSize: payload.pageSize,
      reason: payload.reason,
    });
    state.projectionCalls += 1;
    if (result.drift) drift = result.drift;
    if (result.completed === true) {
      state.phase = "completed";
      return drift;
    }
  }
  throw new CreditCardApplicationError(
    "domain_precondition_failed",
    "A reconstrução de projeções excedeu o teto de páginas.",
  );
};

/** Exposto para teste: o backfill nunca lê `investment_summaries` como fonte. */
export const backfillFirestore = investmentFirestore;
