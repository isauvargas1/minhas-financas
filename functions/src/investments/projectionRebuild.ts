import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import type {WorkspaceAuthorizationContext} from "../creditCards/auth";
import {CreditCardApplicationError} from "../creditCards/errors";
import {saoPauloDayKey, saoPauloMonthKey, saoPauloMonthStart} from "../shared/dateKeys";
import type {RebuildInvestmentProjectionsPayload} from "./contracts";
import {INVESTMENT_CALCULATION_VERSION} from "./domain";
import {
  assertWorkspaceDocument,
  authorizeInvestmentTransaction,
  completeInvestmentIdempotency,
  deterministicDocumentId,
  recordInvestmentEvent,
  reserveInvestmentIdempotency,
} from "./infrastructure";
import {addExact} from "./math";
import {recordInvestmentOperationMetric} from "./observability";
import {
  INVESTMENT_COLLECTIONS,
  investmentCollection,
  investmentDoc,
  investmentFirestore,
} from "./paths";
import {
  allocationDescriptors,
  allocationDocumentId,
  movementReportDeltas,
} from "./reporting";
import {investmentOperationRoles} from "./writeStrategy";

/**
 * Reconstrução das projeções acumuladas (M3.E).
 *
 * `investment_summaries/current`, `investment_report_periods` e
 * `investment_allocation_summaries` eram acumuladores `FieldValue.increment`
 * puros, sem nenhum caminho de reconstrução: um valor acumulado opaco, que a
 * skill `financial-domain-integrity` proíbe. Qualquer deriva — por defeito de
 * escrita incremental, por interrupção parcial ou por dado legado — era
 * permanente.
 *
 * Este motor usa a mesma máquina do rebuild de posição e meta: página com
 * cursor composto `{orderedAt, documentId}`, `cutoffAt` congelando a janela,
 * cerca de versão contra escrita concorrente, snapshot retomável em
 * `investment_snapshots/{rebuildId}` e publicação com valores absolutos —
 * nunca incrementos — de modo que reexecutar é idempotente.
 *
 * Fases: `positions` → `movements` → `publish` → `prune` → `completed`.
 */

const SNAPSHOT_KIND = "projection_rebuild" as const;

/**
 * Tetos explícitos. A skill proíbe truncamento silencioso: exceder o teto é
 * erro de domínio nomeando a dimensão, nunca um corte mudo.
 */
export const MAX_ALLOCATION_BUCKETS = 400;
export const MAX_REPORT_PERIODS = 240;

/**
 * Teto de escritas por transação. O limite do Firestore é 500; a publicação
 * escreve no máximo `pageSize` documentos de projeção (≤100) mais os
 * documentos fixos de snapshot, evento, métrica e idempotência.
 */
export const MAX_WRITES_PER_REBUILD_TRANSACTION = 110;

/** Snapshot, métrica, evento e chave de idempotência. */
const FIXED_WRITES_PER_REBUILD_TRANSACTION = 4;

/**
 * O teto era declarado e nunca referenciado: documentava uma invariante que
 * nada verificava. Se `pageSize` deixar de ser limitado a 100 no contrato, a
 * publicação passa a falhar aqui em vez de silenciosamente se aproximar do
 * limite de 500 escritas do Firestore.
 */
const assertPageWithinWriteBudget = (pageSize: number): void => {
  const worstCase = pageSize + FIXED_WRITES_PER_REBUILD_TRANSACTION;
  if (worstCase > MAX_WRITES_PER_REBUILD_TRANSACTION) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `Página de ${pageSize} excede o teto de ` +
        `${MAX_WRITES_PER_REBUILD_TRANSACTION} escritas por transação.`,
    );
  }
};

type RebuildPhase =
  | "positions"
  | "movements"
  | "publish"
  | "prune"
  | "completed";

interface Cursor {
  orderedAt: Timestamp;
  documentId: string;
}

interface SummaryTotals {
  positionCount: number;
  principalCents: number;
  currentValueCents: number;
  realizedGainCents: number;
  feesCents: number;
  taxCents: number;
  unrealizedAppreciationCents: number;
}

interface AllocationBucket {
  dimension: string;
  key: string;
  label: string;
  positionCount: number;
  principalCents: number;
  currentValueCents: number;
  realizedGainCents: number;
  feesCents: number;
  taxCents: number;
}

interface PeriodBucket {
  contributionCents: number;
  redemptionPrincipalCents: number;
  realizedGainCents: number;
  feesCents: number;
  taxCents: number;
  costDeltaCents: number;
  currentValueDeltaCents: number;
  cashDeltaCents: number;
  settledMovementCount: number;
  daily: Record<string, PeriodDailyBucket>;
}

type PeriodDailyBucket = Omit<PeriodBucket, "daily">;

const emptySummary = (): SummaryTotals => ({
  positionCount: 0,
  principalCents: 0,
  currentValueCents: 0,
  realizedGainCents: 0,
  feesCents: 0,
  taxCents: 0,
  unrealizedAppreciationCents: 0,
});

const emptyPeriodBucket = (): PeriodBucket => ({
  contributionCents: 0,
  redemptionPrincipalCents: 0,
  realizedGainCents: 0,
  feesCents: 0,
  taxCents: 0,
  costDeltaCents: 0,
  currentValueDeltaCents: 0,
  cashDeltaCents: 0,
  settledMovementCount: 0,
  daily: {},
});

const emptyDailyBucket = (): PeriodDailyBucket => ({
  contributionCents: 0,
  redemptionPrincipalCents: 0,
  realizedGainCents: 0,
  feesCents: 0,
  taxCents: 0,
  costDeltaCents: 0,
  currentValueDeltaCents: 0,
  cashDeltaCents: 0,
  settledMovementCount: 0,
});

const integerOrZero = (value: unknown): number =>
  Number.isSafeInteger(value) ? (value as number) : 0;

interface RebuildState {
  phase: RebuildPhase;
  cutoffAt: Timestamp;
  cursor?: Cursor;
  processedPositions: number;
  processedMovements: number;
  publishedCount: number;
  prunedCount: number;
  expectedProjectionVersion: number;
  /** Deriva medida na publicação; preservada até o fim da execução. */
  drift?: Record<string, number>;
  summary: SummaryTotals;
  allocations: Record<string, AllocationBucket>;
  periods: Record<string, PeriodBucket>;
}

const readState = (
  snapshot: admin.firestore.DocumentSnapshot,
): RebuildState | undefined => {
  if (!snapshot.exists) return undefined;
  const data = snapshot.data() ?? {};
  return {
    phase: (data.phase ?? "positions") as RebuildPhase,
    cutoffAt: data.cutoffAt as Timestamp,
    cursor: data.cursor ?
      {
        orderedAt: data.cursor.orderedAt as Timestamp,
        documentId: String(data.cursor.documentId),
      } :
      undefined,
    processedPositions: integerOrZero(data.processedPositions),
    processedMovements: integerOrZero(data.processedMovements),
    publishedCount: integerOrZero(data.publishedCount),
    prunedCount: integerOrZero(data.prunedCount),
    expectedProjectionVersion: integerOrZero(data.expectedProjectionVersion),
    drift: (data.drift as Record<string, number> | undefined) ?? undefined,
    summary: {...emptySummary(), ...(data.summary ?? {})},
    allocations: (data.allocations ?? {}) as Record<string, AllocationBucket>,
    periods: (data.periods ?? {}) as Record<string, PeriodBucket>,
  };
};

const assertSnapshotContext = (
  snapshot: admin.firestore.DocumentSnapshot,
  workspaceId: string,
  correlationId: string,
  actorId: string,
  pageSize: number,
): void => {
  if (!snapshot.exists) return;
  const data = assertWorkspaceDocument(
    snapshot,
    workspaceId,
    "Reconstrução de projeções",
  );
  if (
    data.kind !== SNAPSHOT_KIND ||
    data.correlationId !== correlationId ||
    data.createdBy !== actorId ||
    data.pageSize !== pageSize
  ) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "A reconstrução informada pertence a outro contexto de execução.",
    );
  }
  if (data.status === "completed") {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "Esta reconstrução já foi concluída.",
    );
  }
};

const summaryRef = (
  workspaceId: string,
): admin.firestore.DocumentReference =>
  investmentDoc(workspaceId, INVESTMENT_COLLECTIONS.summaries, "current");

const accumulatePosition = (
  state: RebuildState,
  position: admin.firestore.DocumentData,
  account: admin.firestore.DocumentData | undefined,
  asset: admin.firestore.DocumentData | undefined,
  goalName: string | undefined,
): void => {
  const principalCents = integerOrZero(position.principalCents);
  const currentValueCents = integerOrZero(position.currentValueCents);
  const realizedGainCents = integerOrZero(position.realizedGainCents);
  const feesCents = integerOrZero(position.feesCents);
  const taxCents = integerOrZero(position.taxCents);
  const quantityMicros = integerOrZero(position.quantityMicros);
  const exposed =
    quantityMicros !== 0 || principalCents !== 0 || currentValueCents !== 0;

  state.summary.positionCount += exposed ? 1 : 0;
  state.summary.principalCents = addExact(
    state.summary.principalCents,
    principalCents,
    "principalCents",
  );
  state.summary.currentValueCents = addExact(
    state.summary.currentValueCents,
    currentValueCents,
    "currentValueCents",
  );
  state.summary.realizedGainCents = addExact(
    state.summary.realizedGainCents,
    realizedGainCents,
    "realizedGainCents",
  );
  state.summary.feesCents = addExact(
    state.summary.feesCents,
    feesCents,
    "feesCents",
  );
  state.summary.taxCents = addExact(state.summary.taxCents, taxCents, "taxCents");
  state.summary.unrealizedAppreciationCents = addExact(
    state.summary.unrealizedAppreciationCents,
    currentValueCents - principalCents,
    "unrealizedAppreciationCents",
  );

  if (!account || !asset) return;
  const goalId =
    typeof position.goalId === "string" ? position.goalId : undefined;
  for (const descriptor of allocationDescriptors(
    account,
    asset,
    goalId,
    goalName,
  )) {
    const id = allocationDocumentId(descriptor);
    const bucket = state.allocations[id] ?? {
      dimension: descriptor.dimension,
      key: descriptor.key,
      label: descriptor.label,
      positionCount: 0,
      principalCents: 0,
      currentValueCents: 0,
      realizedGainCents: 0,
      feesCents: 0,
      taxCents: 0,
    };
    bucket.label = descriptor.label;
    bucket.positionCount += exposed ? 1 : 0;
    bucket.principalCents += principalCents;
    bucket.currentValueCents += currentValueCents;
    bucket.realizedGainCents += realizedGainCents;
    bucket.feesCents += feesCents;
    bucket.taxCents += taxCents;
    state.allocations[id] = bucket;
  }
  if (Object.keys(state.allocations).length > MAX_ALLOCATION_BUCKETS) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `A reconstrução excedeu o teto de ${MAX_ALLOCATION_BUCKETS} faixas de ` +
        "alocação. Nenhum dado foi truncado; reduza o escopo do workspace ou " +
        "eleve o teto explicitamente.",
    );
  }
};

const accumulateMovement = (
  state: RebuildState,
  movement: admin.firestore.DocumentData,
): void => {
  const operation = String(movement.operation);
  if (operation === "goal_link" || operation === "goal_unlink") return;
  const effectiveAt =
    (movement.settlementAt as Timestamp | undefined) ??
    (movement.occurredAt as Timestamp);
  const deltas = movementReportDeltas({
    operation: operation as "contribution" | "redemption" | "reversal",
    reversalOfOperation:
      operation === "reversal" ?
        ((movement.reversalOfOperation as
          | "contribution"
          | "redemption"
          | undefined) ?? reversalOriginOf(movement)) :
        undefined,
    principalCents: integerOrZero(movement.principalCents),
    gainCents: integerOrZero(movement.gainCents),
    feesCents: integerOrZero(movement.feesCents),
    taxCents: integerOrZero(movement.taxCents),
    // Delta patrimonial do próprio movimento. Documentos anteriores a este
    // campo caem para o delta de principal, que é o efeito patrimonial na
    // ausência de valoração — preserva compatibilidade histórica.
    currentValueDeltaCents: Number.isSafeInteger(movement.currentValueDeltaCents) ?
      (movement.currentValueDeltaCents as number) :
      integerOrZero(movement.principalDeltaCents),
    cashDeltaCents: integerOrZero(movement.cashDeltaCents),
  });
  const monthKey = saoPauloMonthKey(effectiveAt.toDate());
  const dayKey = saoPauloDayKey(effectiveAt.toDate());
  const period = state.periods[monthKey] ?? emptyPeriodBucket();
  period.daily = period.daily ?? {};
  const daily = period.daily[dayKey] ?? emptyDailyBucket();
  for (const field of [
    "contributionCents",
    "redemptionPrincipalCents",
    "realizedGainCents",
    "feesCents",
    "taxCents",
    "costDeltaCents",
    "currentValueDeltaCents",
    "cashDeltaCents",
  ] as const) {
    period[field] += deltas[field];
    daily[field] += deltas[field];
  }
  // Diferente do acumulador incremental, aqui o contador respeita o sinal:
  // um aporte estornado deixa contagem zero, não dois.
  const signedCount = operation === "reversal" ? -1 : 1;
  period.settledMovementCount += signedCount;
  daily.settledMovementCount += signedCount;
  period.daily[dayKey] = daily;
  state.periods[monthKey] = period;
  if (Object.keys(state.periods).length > MAX_REPORT_PERIODS) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `A reconstrução excedeu o teto de ${MAX_REPORT_PERIODS} períodos ` +
        "mensais. Nenhum dado foi truncado.",
    );
  }
};

/**
 * O movimento compensatório carrega a operação original no próprio documento;
 * quando ausente, deduz-se pelo sinal do principal.
 */
const reversalOriginOf = (
  movement: admin.firestore.DocumentData,
): "contribution" | "redemption" =>
  integerOrZero(movement.principalDeltaCents) < 0 ?
    "contribution" :
    "redemption";

export const executeRebuildInvestmentProjections = async (
  auth: WorkspaceAuthorizationContext,
  payload: RebuildInvestmentProjectionsPayload,
): Promise<Record<string, unknown>> => {
  const operation = "rebuildInvestmentProjections" as const;
  const rebuildId =
    payload.rebuildId ??
    deterministicDocumentId(
      "projection-rebuild",
      auth.uid,
      auth.workspaceId,
      payload.correlationId,
    );
  assertPageWithinWriteBudget(payload.pageSize);
  return investmentFirestore().runTransaction(async (transaction) => {
    const authorization = await authorizeInvestmentTransaction(
      transaction,
      auth,
      investmentOperationRoles(operation),
    );
    const reservation = await reserveInvestmentIdempotency(
      transaction,
      auth,
      operation,
      payload.idempotencyKey,
      payload.correlationId,
      payload,
    );
    if (reservation.replay) return reservation.replay;

    const snapshotRef = investmentDoc(
      auth.workspaceId,
      INVESTMENT_COLLECTIONS.snapshots,
      rebuildId,
    );
    const snapshotDoc = await transaction.get(snapshotRef);
    assertSnapshotContext(
      snapshotDoc,
      auth.workspaceId,
      payload.correlationId,
      auth.uid,
      payload.pageSize,
    );
    const summaryDoc = await transaction.get(summaryRef(auth.workspaceId));
    const liveProjectionVersion = integerOrZero(
      summaryDoc.data()?.projectionVersion,
    );
    const state: RebuildState = readState(snapshotDoc) ?? {
      phase: "positions",
      cutoffAt: Timestamp.now(),
      processedPositions: 0,
      processedMovements: 0,
      publishedCount: 0,
      prunedCount: 0,
      expectedProjectionVersion: liveProjectionVersion,
      summary: emptySummary(),
      allocations: {},
      periods: {},
    };
    // Cerca contra escrita concorrente: qualquer mutação publica uma nova
    // versão de projeção e invalida a reconstrução em andamento.
    if (state.expectedProjectionVersion !== liveProjectionVersion) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "As projeções mudaram durante a reconstrução.",
      );
    }

    // A série mensal só é reconstrutível a partir de movimentos enquanto não
    // houver valoração no workspace. Uma valoração altera o patrimônio sem
    // gerar movimento, e reconstruir isso exige repassar movimentos e
    // valorações em ordem cronológica, mantendo quantidade e preço por
    // posição — trabalho que este motor ainda não faz. Publicar assim
    // apagaria silenciosamente todo delta de valoração já acumulado, e faria
    // o resumo (que inclui valoração, via posição) divergir do fechamento do
    // último mês de forma permanente. Falha fechado em vez de corromper.
    if (state.phase === "positions" && !state.cursor) {
      const anyValuation = await transaction.get(
        investmentCollection(
          auth.workspaceId,
          INVESTMENT_COLLECTIONS.valuations,
        ).limit(1),
      );
      if (!anyValuation.empty) {
        throw new CreditCardApplicationError(
          "domain_precondition_failed",
          "Este workspace possui valorações registradas, e a reconstrução da " +
            "série mensal ainda não repassa valorações. Reconstruir agora " +
            "descartaria a variação patrimonial de marcação a mercado.",
        );
      }
    }
    if (state.phase === "positions") {
      await accumulatePositionsPage(transaction, auth.workspaceId, state, payload.pageSize);
    } else if (state.phase === "movements") {
      await accumulateMovementsPage(transaction, auth.workspaceId, state, payload.pageSize);
    } else if (state.phase === "publish") {
      publishPage(
        transaction,
        auth.workspaceId,
        authorization.profileType,
        auth.uid,
        state,
        payload.pageSize,
        summaryDoc,
      );
    } else if (state.phase === "prune") {
      await prunePage(
        transaction,
        auth.workspaceId,
        auth.uid,
        state,
        payload.pageSize,
      );
    }

    const completed = state.phase === "completed";
    transaction.set(
      snapshotRef,
      {
        id: rebuildId,
        workspaceId: auth.workspaceId,
        profileType: authorization.profileType,
        kind: SNAPSHOT_KIND,
        targetId: auth.workspaceId,
        status: completed ? "completed" : "running",
        phase: state.phase,
        cutoffAt: state.cutoffAt,
        ...(state.cursor ? {cursor: state.cursor} : {cursor: FieldValue.delete()}),
        processedPositions: state.processedPositions,
        processedMovements: state.processedMovements,
        processedCount: state.processedPositions + state.processedMovements,
        publishedCount: state.publishedCount,
        prunedCount: state.prunedCount,
        expectedProjectionVersion: state.expectedProjectionVersion,
        ...(state.drift ? {drift: state.drift} : {}),
        summary: state.summary,
        allocations: state.allocations,
        periods: state.periods,
        totals: {
          quantityMicros: 0,
          principalCents: state.summary.principalCents,
          realizedGainCents: state.summary.realizedGainCents,
          feesCents: state.summary.feesCents,
          taxCents: state.summary.taxCents,
          netContributionCents: state.summary.principalCents,
          currentValueCents: state.summary.currentValueCents,
        },
        pageSize: payload.pageSize,
        calculationVersion: INVESTMENT_CALCULATION_VERSION,
        correlationId: payload.correlationId,
        createdBy: auth.uid,
        createdAt: snapshotDoc.exists ?
          (snapshotDoc.data()?.createdAt as Timestamp) :
          FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(completed ? {completedAt: FieldValue.serverTimestamp()} : {}),
      },
      {merge: true},
    );

    const result: Record<string, unknown> = {
      success: true,
      rebuildId,
      phase: state.phase,
      completed,
      processedPositions: state.processedPositions,
      processedMovements: state.processedMovements,
      publishedCount: state.publishedCount,
      prunedCount: state.prunedCount,
      allocationBuckets: Object.keys(state.allocations).length,
      reportPeriods: Object.keys(state.periods).length,
      ...(state.drift ? {drift: state.drift} : {}),
    };
    recordInvestmentOperationMetric(transaction, {
      workspaceId: auth.workspaceId,
      operation,
      actorId: auth.uid,
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
    });
    recordInvestmentEvent(
      transaction,
      auth,
      authorization.role,
      authorization.profileType,
      operation,
      reservation,
      payload.correlationId,
      "snapshot",
      rebuildId,
      {phase: state.phase, completed, ...(state.drift ? {drift: state.drift} : {})},
    );
    completeInvestmentIdempotency(
      transaction,
      auth,
      operation,
      payload.correlationId,
      reservation,
      result,
    );
    return result;
  });
};

const accumulatePositionsPage = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  state: RebuildState,
  pageSize: number,
): Promise<void> => {
  let query = investmentCollection(workspaceId, INVESTMENT_COLLECTIONS.positions)
    .where("updatedAt", "<=", state.cutoffAt)
    .orderBy("updatedAt", "asc")
    .orderBy(admin.firestore.FieldPath.documentId(), "asc")
    .limit(pageSize + 1);
  if (state.cursor) {
    query = query.startAfter(state.cursor.orderedAt, state.cursor.documentId);
  }
  const page = await transaction.get(query);
  const docs = page.docs.slice(0, pageSize);
  const hasMore = page.size > pageSize;

  // Conta e ativo repetem-se muito entre posições da mesma página. Sem cache,
  // uma página de 100 posições custava 200 leituras extras, sequenciais.
  const accounts = new Map<string, admin.firestore.DocumentData | undefined>();
  const assets = new Map<string, admin.firestore.DocumentData | undefined>();
  const readCached = async (
    cache: Map<string, admin.firestore.DocumentData | undefined>,
    collectionName: typeof INVESTMENT_COLLECTIONS.accounts |
      typeof INVESTMENT_COLLECTIONS.assets,
    id: string,
  ): Promise<admin.firestore.DocumentData | undefined> => {
    if (cache.has(id)) return cache.get(id);
    const snapshot = await transaction.get(
      investmentDoc(workspaceId, collectionName, id),
    );
    cache.set(id, snapshot.data());
    return snapshot.data();
  };

  for (const doc of docs) {
    const position = doc.data();
    const account = await readCached(
      accounts,
      INVESTMENT_COLLECTIONS.accounts,
      String(position.accountId),
    );
    const asset = await readCached(
      assets,
      INVESTMENT_COLLECTIONS.assets,
      String(position.assetId),
    );
    accumulatePosition(state, position, account, asset, undefined);
    state.processedPositions += 1;
  }
  const last = docs[docs.length - 1];
  state.cursor = last ?
    {orderedAt: last.data().updatedAt as Timestamp, documentId: last.id} :
    state.cursor;
  if (!hasMore) {
    state.phase = "movements";
    state.cursor = undefined;
  }
};

const accumulateMovementsPage = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  state: RebuildState,
  pageSize: number,
): Promise<void> => {
  let query = investmentCollection(workspaceId, INVESTMENT_COLLECTIONS.movements)
    .where("status", "==", "settled")
    .where("occurredAt", "<=", state.cutoffAt)
    .orderBy("occurredAt", "asc")
    .orderBy(admin.firestore.FieldPath.documentId(), "asc")
    .limit(pageSize + 1);
  if (state.cursor) {
    query = query.startAfter(state.cursor.orderedAt, state.cursor.documentId);
  }
  const page = await transaction.get(query);
  const docs = page.docs.slice(0, pageSize);
  const hasMore = page.size > pageSize;
  for (const doc of docs) {
    accumulateMovement(state, doc.data());
    state.processedMovements += 1;
  }
  const last = docs[docs.length - 1];
  state.cursor = last ?
    {orderedAt: last.data().occurredAt as Timestamp, documentId: last.id} :
    state.cursor;
  if (!hasMore) {
    state.phase = "publish";
    state.cursor = undefined;
  }
};

/**
 * Publica valores **absolutos**. Reexecutar a mesma página é idempotente e
 * não duplica; é isso que torna a retomada segura.
 */
const publishPage = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  profileType: "PF" | "PJ",
  actorId: string,
  state: RebuildState,
  pageSize: number,
  summaryDoc: admin.firestore.DocumentSnapshot,
): void => {
  // Ordenação explícita: o fatiamento por índice depende de as entradas virem
  // sempre na mesma ordem entre páginas, e os mapas fazem ida e volta pelo
  // documento de snapshot. Não depender da ordem de chaves do Firestore.
  const allocationEntries = Object.entries(state.allocations).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const periodEntries = Object.entries(state.periods).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  // Fechamento patrimonial por mês, recalculado deterministicamente a partir
  // da própria série: soma cumulativa dos deltas em ordem cronológica. Nunca
  // parte do patrimônio atual, e por isso independe da janela consultada.
  const closingByPeriod = new Map<string, number>();
  let runningCurrentValueCents = 0;
  for (const [periodKey, periodBucket] of periodEntries) {
    runningCurrentValueCents = addExact(
      runningCurrentValueCents,
      periodBucket.currentValueDeltaCents,
      "closingCurrentValueCents",
    );
    closingByPeriod.set(periodKey, runningCurrentValueCents);
  }
  const pending = [
    ...allocationEntries.map(([id, bucket]) => ({kind: "allocation" as const, id, bucket})),
    ...periodEntries.map(([id, bucket]) => ({kind: "period" as const, id, bucket})),
  ].slice(state.publishedCount, state.publishedCount + pageSize);

  for (const entry of pending) {
    if (entry.kind === "allocation") {
      const bucket = entry.bucket as AllocationBucket;
      transaction.set(
        investmentDoc(
          workspaceId,
          INVESTMENT_COLLECTIONS.allocationSummaries,
          entry.id,
        ),
        {
          id: entry.id,
          workspaceId,
          profileType,
          currency: "BRL",
          dimension: bucket.dimension,
          key: bucket.key,
          label: bucket.label,
          positionCount: bucket.positionCount,
          principalCents: bucket.principalCents,
          currentValueCents: bucket.currentValueCents,
          realizedGainCents: bucket.realizedGainCents,
          feesCents: bucket.feesCents,
          taxCents: bucket.taxCents,
          rebuiltAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorId,
        },
        {merge: true},
      );
    } else {
      const bucket = entry.bucket as PeriodBucket;
      transaction.set(
        investmentDoc(
          workspaceId,
          INVESTMENT_COLLECTIONS.reportPeriods,
          entry.id,
        ),
        {
          id: entry.id,
          workspaceId,
          profileType,
          currency: "BRL",
          period: entry.id,
          periodStart: Timestamp.fromDate(saoPauloMonthStart(entry.id)),
          contributionCents: bucket.contributionCents,
          redemptionPrincipalCents: bucket.redemptionPrincipalCents,
          realizedGainCents: bucket.realizedGainCents,
          feesCents: bucket.feesCents,
          taxCents: bucket.taxCents,
          costDeltaCents: bucket.costDeltaCents,
          currentValueDeltaCents: bucket.currentValueDeltaCents,
          cashDeltaCents: bucket.cashDeltaCents,
          settledMovementCount: bucket.settledMovementCount,
          closingCurrentValueCents: closingByPeriod.get(entry.id) ?? 0,
          daily: bucket.daily ?? {},
          rebuiltAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorId,
        },
        {merge: true},
      );
    }
    state.publishedCount += 1;
  }

  const total = allocationEntries.length + periodEntries.length;
  if (state.publishedCount < total) return;

  // Última página da publicação: resumo absoluto + deriva medida.
  const previous = summaryDoc.data() ?? {};
  const drift = {
    positionCount:
      state.summary.positionCount - integerOrZero(previous.positionCount),
    principalCents:
      state.summary.principalCents - integerOrZero(previous.principalCents),
    currentValueCents:
      state.summary.currentValueCents -
      integerOrZero(previous.currentValueCents),
    realizedGainCents:
      state.summary.realizedGainCents -
      integerOrZero(previous.realizedGainCents),
    feesCents: state.summary.feesCents - integerOrZero(previous.feesCents),
    taxCents: state.summary.taxCents - integerOrZero(previous.taxCents),
    unrealizedAppreciationCents:
      state.summary.unrealizedAppreciationCents -
      integerOrZero(previous.unrealizedAppreciationCents),
  };
  transaction.set(
    summaryRef(workspaceId),
    {
      id: "current",
      workspaceId,
      profileType,
      currency: "BRL",
      ...state.summary,
      projectionVersion: state.expectedProjectionVersion + 1,
      rebuiltAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: actorId,
    },
    {merge: true},
  );
  state.expectedProjectionVersion += 1;
  state.drift = drift;
  state.phase = "prune";
  state.cursor = undefined;
};

/**
 * Zera documentos de projeção que sobreviveram a uma reconstrução anterior e
 * não têm mais lastro no ledger. Não há hard delete: o documento permanece
 * com valores zerados e `rebuiltAt`, preservando o histórico de existência.
 */
const prunePage = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  actorId: string,
  state: RebuildState,
  pageSize: number,
): Promise<void> => {
  let query = investmentCollection(
    workspaceId,
    INVESTMENT_COLLECTIONS.allocationSummaries,
  )
    .orderBy(admin.firestore.FieldPath.documentId(), "asc")
    .limit(pageSize + 1);
  if (state.cursor) {
    query = query.startAfter(state.cursor.documentId);
  }
  const page = await transaction.get(query);
  const docs = page.docs.slice(0, pageSize);
  const hasMore = page.size > pageSize;
  for (const doc of docs) {
    if (state.allocations[doc.id]) continue;
    transaction.set(
      doc.ref,
      {
        positionCount: 0,
        principalCents: 0,
        currentValueCents: 0,
        realizedGainCents: 0,
        feesCents: 0,
        taxCents: 0,
        rebuiltAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      },
      {merge: true},
    );
    state.prunedCount += 1;
  }
  const last = docs[docs.length - 1];
  // A fase de prune ordena só por `__name__`; o cursor carrega apenas o ID.
  state.cursor = last ?
    {orderedAt: state.cutoffAt, documentId: last.id} :
    state.cursor;
  if (!hasMore) {
    state.phase = "completed";
    state.cursor = undefined;
  }
};
