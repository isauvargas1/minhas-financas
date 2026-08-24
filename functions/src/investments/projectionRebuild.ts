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
import {addExact, currentValueForPosition} from "./math";
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
 * ## Fases
 *
 * `positions` → `timeline` → `publish` → `prune_allocations` →
 * `prune_periods` → `completed`.
 *
 * ## Valorações no fluxo (INV-P1-005)
 *
 * A fase `timeline` substituiu a antiga `movements`, que percorria **apenas**
 * movimentos. Como uma valoração altera o patrimônio sem gerar movimento,
 * publicar a partir de movimentos apagaria toda a variação de marcação a
 * mercado — e por isso a reconstrução simplesmente **se recusava a rodar** em
 * qualquer workspace com valoração, deixando sem reparo exatamente os
 * workspaces que marcam a mercado.
 *
 * A `timeline` percorre **uma posição por vez**, mesclando cronologicamente os
 * movimentos liquidados e as valorações daquela posição, e mantendo o estado
 * corrente `(quantidade, custo, preço unitário)`. Cada evento produz
 * `valor depois − valor antes`, que é exatamente o `currentValueDeltaCents`
 * que o caminho incremental grava. A soma telescopa: o fechamento
 * reconstruído bate centavo a centavo com o incremental.
 *
 * Processar posição a posição, e não um fluxo global, é o que mantém o estado
 * de trabalho **O(1)** em vez de O(posições) — o snapshot não pode crescer sem
 * teto dentro de um documento (INV-P2-040).
 */

const SNAPSHOT_KIND = "projection_rebuild" as const;

/**
 * Tetos explícitos. A skill proíbe truncamento silencioso: exceder o teto é
 * erro de domínio nomeando a dimensão, nunca um corte mudo.
 */
export const MAX_ALLOCATION_BUCKETS = 400;
export const MAX_REPORT_PERIODS = 240;

/**
 * Teto de baldes diários acumulados no snapshot (INV-P2-040).
 *
 * O estado de trabalho da reconstrução vive num único documento do Firestore,
 * que tem limite rígido de 1 MiB. Períodos e alocações já tinham teto; o mapa
 * `daily` não tinha nenhum, e ele é o único componente que cresce com o
 * **tempo de uso** do workspace em vez de com a estrutura dele: um dia com
 * movimento vira uma entrada de nove campos.
 *
 * 2.000 dias com movimento correspondem a mais de cinco anos de atividade
 * diária ininterrupta e ocupam da ordem de 400 KiB, deixando folga larga para
 * períodos, alocações e metadados. Atingir o teto é erro de domínio nomeando a
 * dimensão — nunca truncamento silencioso da série diária.
 */
export const MAX_DAILY_BUCKETS = 2_000;

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
  | "timeline"
  | "publish"
  | "prune_allocations"
  | "prune_periods"
  | "completed";

/**
 * Estado corrente de **uma** posição durante a fase `timeline`.
 *
 * `unitPriceMicros` nulo significa "ainda sem valoração": nesse regime o valor
 * da posição é o próprio custo, exatamente como `currentValueForPosition`
 * decide no caminho incremental.
 */
interface TimelineCarry {
  quantityMicros: number;
  principalCents: number;
  unitPriceMicros: number | null;
}

interface TimelineState {
  /** Última posição concluída; a varredura retoma depois dela. */
  positionCursor?: string;
  /** Posição em processamento, quando a página anterior não a concluiu. */
  positionId?: string;
  movementCursor?: Cursor;
  valuationCursor?: Cursor;
  carry: TimelineCarry;
}

/**
 * Serialização do estado da linha do tempo.
 *
 * Campos ausentes viram `null` **explícito**, nunca omissão. O snapshot é
 * gravado com `{merge: true}`, e num merge um mapa aninhado é combinado campo
 * a campo: omitir `positionId` e `movementCursor` ao concluir uma posição
 * deixava os valores da página anterior sobreviverem, e a reconstrução
 * reprocessava a mesma posição a partir de um cursor obsoleto, para sempre.
 * `undefined` também não serve — o Firestore o rejeita.
 */
const serializeTimeline = (
  timeline: TimelineState,
): Record<string, unknown> => ({
  carry: timeline.carry,
  positionCursor: timeline.positionCursor ?? null,
  positionId: timeline.positionId ?? null,
  movementCursor: timeline.movementCursor ?? null,
  valuationCursor: timeline.valuationCursor ?? null,
});

const emptyCarry = (): TimelineCarry => ({
  quantityMicros: 0,
  principalCents: 0,
  unitPriceMicros: null,
});

const carryValueCents = (carry: TimelineCarry): number =>
  currentValueForPosition(
    carry.quantityMicros,
    carry.principalCents,
    carry.unitPriceMicros ?? undefined,
  );

/**
 * Teto de reinícios por cerca de versão (INV-P2-018).
 *
 * Antes, qualquer mutação concorrente abortava a reconstrução em definitivo:
 * não havia caminho de reset do snapshot, e num workspace ativo o reparo podia
 * nunca concluir. Agora a reconstrução reinicia sozinha sobre a versão nova.
 * O teto existe para que um workspace sob escrita contínua falhe com
 * diagnóstico em vez de reiniciar para sempre.
 */
export const MAX_REBUILD_RESTARTS = 10;

interface Cursor {
  orderedAt: Timestamp;
  documentId: string;
}

interface SummaryTotals {
  positionCount: number;
  principalCents: number;
  currentValueCents: number;
  realizedGainCents: number;
  realizedLossCents: number;
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
  realizedLossCents: number;
  feesCents: number;
  taxCents: number;
}

interface PeriodBucket {
  contributionCents: number;
  redemptionPrincipalCents: number;
  realizedGainCents: number;
  realizedLossCents: number;
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
  realizedLossCents: 0,
  feesCents: 0,
  taxCents: 0,
  unrealizedAppreciationCents: 0,
});

const emptyPeriodBucket = (): PeriodBucket => ({
  contributionCents: 0,
  redemptionPrincipalCents: 0,
  realizedGainCents: 0,
  realizedLossCents: 0,
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
  realizedLossCents: 0,
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
  timeline: TimelineState;
  processedPositions: number;
  processedMovements: number;
  processedValuations: number;
  publishedCount: number;
  prunedCount: number;
  prunedPeriodCount: number;
  restartCount: number;
  expectedProjectionVersion: number;
  /** Deriva medida na publicação; preservada até o fim da execução. */
  drift?: Record<string, number>;
  summary: SummaryTotals;
  allocations: Record<string, AllocationBucket>;
  periods: Record<string, PeriodBucket>;
}

const readCursor = (value: unknown): Cursor | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const raw = value as {orderedAt?: unknown; documentId?: unknown};
  if (!(raw.orderedAt instanceof Timestamp)) return undefined;
  return {orderedAt: raw.orderedAt, documentId: String(raw.documentId ?? "")};
};

const readTimelineState = (value: unknown): TimelineState => {
  if (typeof value !== "object" || value === null) return {carry: emptyCarry()};
  const raw = value as Record<string, unknown>;
  const carry = (raw.carry ?? {}) as Record<string, unknown>;
  return {
    ...(typeof raw.positionCursor === "string" && raw.positionCursor ?
      {positionCursor: raw.positionCursor} :
      {}),
    ...(typeof raw.positionId === "string" && raw.positionId ?
      {positionId: raw.positionId} :
      {}),
    ...(readCursor(raw.movementCursor) ?
      {movementCursor: readCursor(raw.movementCursor)} :
      {}),
    ...(readCursor(raw.valuationCursor) ?
      {valuationCursor: readCursor(raw.valuationCursor)} :
      {}),
    carry: {
      quantityMicros: integerOrZero(carry.quantityMicros),
      principalCents: integerOrZero(carry.principalCents),
      unitPriceMicros: Number.isSafeInteger(carry.unitPriceMicros) ?
        (carry.unitPriceMicros as number) :
        null,
    },
  };
};

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
    timeline: readTimelineState(data.timeline),
    processedPositions: integerOrZero(data.processedPositions),
    processedMovements: integerOrZero(data.processedMovements),
    processedValuations: integerOrZero(data.processedValuations),
    publishedCount: integerOrZero(data.publishedCount),
    prunedCount: integerOrZero(data.prunedCount),
    prunedPeriodCount: integerOrZero(data.prunedPeriodCount),
    restartCount: integerOrZero(data.restartCount),
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
  const realizedLossCents = integerOrZero(position.realizedLossCents);
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
  state.summary.realizedLossCents = addExact(
    state.summary.realizedLossCents,
    realizedLossCents,
    "realizedLossCents",
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
      realizedLossCents: 0,
      feesCents: 0,
      taxCents: 0,
    };
    bucket.label = descriptor.label;
    bucket.positionCount += exposed ? 1 : 0;
    bucket.principalCents += principalCents;
    bucket.currentValueCents += currentValueCents;
    bucket.realizedGainCents += realizedGainCents;
    bucket.realizedLossCents += realizedLossCents;
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

const bucketsFor = (
  state: RebuildState,
  effectiveAt: Timestamp,
): {period: PeriodBucket; daily: PeriodDailyBucket; monthKey: string; dayKey: string} => {
  const monthKey = saoPauloMonthKey(effectiveAt.toDate());
  const dayKey = saoPauloDayKey(effectiveAt.toDate());
  const period = state.periods[monthKey] ?? emptyPeriodBucket();
  period.daily = period.daily ?? {};
  const daily = period.daily[dayKey] ?? emptyDailyBucket();
  return {period, daily, monthKey, dayKey};
};

const commitBuckets = (
  state: RebuildState,
  monthKey: string,
  dayKey: string,
  period: PeriodBucket,
  daily: PeriodDailyBucket,
): void => {
  period.daily[dayKey] = daily;
  state.periods[monthKey] = period;
  if (Object.keys(state.periods).length > MAX_REPORT_PERIODS) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `A reconstrução excedeu o teto de ${MAX_REPORT_PERIODS} períodos ` +
        "mensais. Nenhum dado foi truncado.",
    );
  }
  const dailyCount = Object.values(state.periods).reduce(
    (total, bucket) => total + Object.keys(bucket.daily ?? {}).length,
    0,
  );
  if (dailyCount > MAX_DAILY_BUCKETS) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `A reconstrução excedeu o teto de ${MAX_DAILY_BUCKETS} dias com ` +
        "movimento acumulados no checkpoint, que é o limite de tamanho do " +
        "documento de estado. Nenhum dado foi truncado.",
    );
  }
};

const accumulateMovement = (
  state: RebuildState,
  movement: admin.firestore.DocumentData,
  effectiveAt: Timestamp,
  currentValueDeltaCents: number,
): void => {
  const operation = String(movement.operation);
  // Vínculo e desvínculo de meta não têm componente financeira: movem a
  // posição entre faixas da dimensão `goal`, e nada mais.
  if (operation === "goal_link" || operation === "goal_unlink") return;
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
    lossCents: integerOrZero(movement.lossCents),
    feesCents: integerOrZero(movement.feesCents),
    taxCents: integerOrZero(movement.taxCents),
    // O efeito patrimonial vem da linha do tempo reconstruída, não do campo
    // gravado no movimento: é o que permite que valorações entrem na mesma
    // série sem depender de um delta materializado que elas não têm
    // (INV-P1-005).
    currentValueDeltaCents,
    cashDeltaCents: integerOrZero(movement.cashDeltaCents),
  });
  const {period, daily, monthKey, dayKey} = bucketsFor(state, effectiveAt);
  for (const field of [
    "contributionCents",
    "redemptionPrincipalCents",
    "realizedGainCents",
    "realizedLossCents",
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
  commitBuckets(state, monthKey, dayKey, period, daily);
};

/**
 * Uma valoração move **apenas** patrimônio: não é aporte, não é resgate, não é
 * resultado realizado e não gera caixa. É exatamente o que
 * `writeInvestmentValuationPeriod` faz no caminho incremental.
 */
const accumulateValuation = (
  state: RebuildState,
  effectiveAt: Timestamp,
  currentValueDeltaCents: number,
): void => {
  if (currentValueDeltaCents === 0) return;
  const {period, daily, monthKey, dayKey} = bucketsFor(state, effectiveAt);
  period.currentValueDeltaCents += currentValueDeltaCents;
  daily.currentValueDeltaCents += currentValueDeltaCents;
  commitBuckets(state, monthKey, dayKey, period, daily);
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
    const freshState = (
      expectedProjectionVersion: number,
      restartCount: number,
    ): RebuildState => ({
      phase: "positions",
      cutoffAt: Timestamp.now(),
      timeline: {carry: emptyCarry()},
      processedPositions: 0,
      processedMovements: 0,
      processedValuations: 0,
      publishedCount: 0,
      prunedCount: 0,
      prunedPeriodCount: 0,
      restartCount,
      expectedProjectionVersion,
      summary: emptySummary(),
      allocations: {},
      periods: {},
    });

    let state: RebuildState =
      readState(snapshotDoc) ?? freshState(liveProjectionVersion, 0);
    // Cerca contra escrita concorrente (INV-P2-018).
    //
    // Qualquer mutação publica uma nova versão de projeção e invalida a
    // acumulação em andamento — continuar publicaria um retrato inconsistente.
    // Antes isso abortava a reconstrução em definitivo, sem caminho de reset
    // do snapshot: num workspace ativo o único reparo de deriva podia nunca
    // concluir. Agora a execução **reinicia** sobre a versão nova, com
    // `cutoffAt` novo, e o operador só vê erro se o workspace estiver sob
    // escrita contínua a ponto de esgotar o teto de reinícios.
    if (state.expectedProjectionVersion !== liveProjectionVersion) {
      if (state.restartCount >= MAX_REBUILD_RESTARTS) {
        throw new CreditCardApplicationError(
          "domain_precondition_failed",
          `A reconstrução reiniciou ${MAX_REBUILD_RESTARTS} vezes por escrita ` +
            "concorrente e não conseguiu concluir. Repita em uma janela de " +
            "menor movimento.",
        );
      }
      state = freshState(liveProjectionVersion, state.restartCount + 1);
    }

    if (state.phase === "positions") {
      await accumulatePositionsPage(transaction, auth.workspaceId, state, payload.pageSize);
    } else if (state.phase === "timeline") {
      await accumulateTimelinePage(
        transaction,
        auth.workspaceId,
        state,
        payload.pageSize,
      );
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
    } else if (state.phase === "prune_allocations") {
      await pruneAllocationsPage(
        transaction,
        auth.workspaceId,
        auth.uid,
        state,
        payload.pageSize,
      );
    } else if (state.phase === "prune_periods") {
      await prunePeriodsPage(
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
        // O Firestore rejeita `undefined`: os cursores da linha do tempo são
        // opcionais e precisam sair do documento em vez de ir como undefined.
        timeline: serializeTimeline(state.timeline),
        processedPositions: state.processedPositions,
        processedMovements: state.processedMovements,
        processedValuations: state.processedValuations,
        processedCount:
          state.processedPositions +
          state.processedMovements +
          state.processedValuations,
        publishedCount: state.publishedCount,
        prunedCount: state.prunedCount,
        prunedPeriodCount: state.prunedPeriodCount,
        restartCount: state.restartCount,
        expectedProjectionVersion: state.expectedProjectionVersion,
        ...(state.drift ? {drift: state.drift} : {}),
        summary: state.summary,
        allocations: state.allocations,
        periods: state.periods,
        totals: {
          quantityMicros: 0,
          principalCents: state.summary.principalCents,
          realizedGainCents: state.summary.realizedGainCents,
          realizedLossCents: state.summary.realizedLossCents,
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
      processedValuations: state.processedValuations,
      publishedCount: state.publishedCount,
      prunedCount: state.prunedCount,
      prunedPeriodCount: state.prunedPeriodCount,
      restartCount: state.restartCount,
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
    state.phase = "timeline";
    state.cursor = undefined;
  }
};

/**
 * Uma página da fase `timeline`: percorre posições, e dentro de cada posição
 * mescla movimentos liquidados e valorações em ordem cronológica.
 *
 * O evento é o que muda o estado da posição; o efeito patrimonial de cada
 * evento é `valor depois − valor antes`, atribuído ao mês e ao dia do próprio
 * evento. Movimentos produzem, além disso, as componentes de aporte, resgate,
 * resultado realizado, taxas, imposto e caixa.
 *
 * A mescla usa uma **marca d'água**: só consome eventos cujo instante seja
 * menor ou igual ao próximo item ainda não lido do outro fluxo. Sem isso, um
 * resgate solicitado num mês e liquidado em outro poderia ser aplicado fora de
 * ordem em relação a uma valoração intermediária, e a atribuição mensal sairia
 * errada — o total final continuaria certo, mas a série mensal, não.
 */
const accumulateTimelinePage = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  state: RebuildState,
  pageSize: number,
): Promise<void> => {
  const timeline = state.timeline;

  if (!timeline.positionId) {
    let positionQuery = investmentCollection(
      workspaceId,
      INVESTMENT_COLLECTIONS.positions,
    )
      .orderBy(admin.firestore.FieldPath.documentId(), "asc")
      .limit(1);
    if (timeline.positionCursor) {
      positionQuery = positionQuery.startAfter(timeline.positionCursor);
    }
    const nextPosition = await transaction.get(positionQuery);
    if (nextPosition.empty) {
      state.phase = "publish";
      state.cursor = undefined;
      return;
    }
    timeline.positionId = nextPosition.docs[0].id;
    timeline.movementCursor = undefined;
    timeline.valuationCursor = undefined;
    timeline.carry = emptyCarry();
  }

  const positionDoc = await transaction.get(
    investmentDoc(workspaceId, INVESTMENT_COLLECTIONS.positions, timeline.positionId),
  );
  const position = positionDoc.data();
  if (!position) {
    // Posição sumiu entre páginas (não há hard delete no domínio, mas a
    // varredura precisa ser total): segue para a próxima.
    timeline.positionCursor = timeline.positionId;
    timeline.positionId = undefined;
    return;
  }
  const accountId = String(position.accountId);
  const assetId = String(position.assetId);

  let movementQuery = investmentCollection(
    workspaceId,
    INVESTMENT_COLLECTIONS.movements,
  )
    .where("accountId", "==", accountId)
    .where("assetId", "==", assetId)
    .where("status", "==", "settled")
    .where("settlementAt", "<=", state.cutoffAt)
    .orderBy("settlementAt", "asc")
    .orderBy(admin.firestore.FieldPath.documentId(), "asc")
    .limit(pageSize + 1);
  if (timeline.movementCursor) {
    movementQuery = movementQuery.startAfter(
      timeline.movementCursor.orderedAt,
      timeline.movementCursor.documentId,
    );
  }

  let valuationQuery = investmentCollection(
    workspaceId,
    INVESTMENT_COLLECTIONS.valuations,
  )
    .where("accountId", "==", accountId)
    .where("assetId", "==", assetId)
    .where("effectiveAt", "<=", state.cutoffAt)
    .orderBy("effectiveAt", "asc")
    .orderBy(admin.firestore.FieldPath.documentId(), "asc")
    .limit(pageSize + 1);
  if (timeline.valuationCursor) {
    valuationQuery = valuationQuery.startAfter(
      timeline.valuationCursor.orderedAt,
      timeline.valuationCursor.documentId,
    );
  }

  const [movementPage, valuationPage] = await Promise.all([
    transaction.get(movementQuery),
    transaction.get(valuationQuery),
  ]);

  const movementDocs = movementPage.docs.slice(0, pageSize);
  const valuationDocs = valuationPage.docs.slice(0, pageSize);
  const movementsHaveMore = movementPage.size > pageSize;
  const valuationsHaveMore = valuationPage.size > pageSize;

  // Marca d'água: além dela, a ordem entre os dois fluxos é desconhecida.
  const lastMovement = movementDocs[movementDocs.length - 1];
  const lastValuation = valuationDocs[valuationDocs.length - 1];
  const movementWatermark = movementsHaveMore && lastMovement ?
    (lastMovement.data().settlementAt as Timestamp).toMillis() :
    Number.POSITIVE_INFINITY;
  const valuationWatermark = valuationsHaveMore && lastValuation ?
    (lastValuation.data().effectiveAt as Timestamp).toMillis() :
    Number.POSITIVE_INFINITY;
  const watermark = Math.min(movementWatermark, valuationWatermark);

  interface TimelineEvent {
    kind: "movement" | "valuation";
    at: Timestamp;
    documentId: string;
    data: admin.firestore.DocumentData;
  }

  const events: TimelineEvent[] = [
    ...movementDocs.map((doc) => ({
      kind: "movement" as const,
      at: doc.data().settlementAt as Timestamp,
      documentId: doc.id,
      data: doc.data(),
    })),
    ...valuationDocs.map((doc) => ({
      kind: "valuation" as const,
      at: doc.data().effectiveAt as Timestamp,
      documentId: doc.id,
      data: doc.data(),
    })),
  ]
    .filter((event) => event.at.toMillis() <= watermark)
    .sort((left, right) => {
      const delta = left.at.toMillis() - right.at.toMillis();
      if (delta !== 0) return delta;
      // Desempate estável: valoração depois do movimento do mesmo instante,
      // como no caminho incremental (a valoração marca a posição já alterada).
      if (left.kind !== right.kind) return left.kind === "movement" ? -1 : 1;
      return left.documentId.localeCompare(right.documentId);
    })
    .slice(0, pageSize);

  for (const event of events) {
    const valueBefore = carryValueCents(timeline.carry);
    if (event.kind === "movement") {
      timeline.carry.quantityMicros = addExact(
        timeline.carry.quantityMicros,
        integerOrZero(event.data.quantityDeltaMicros),
        "quantityMicros",
      );
      timeline.carry.principalCents = addExact(
        timeline.carry.principalCents,
        integerOrZero(event.data.principalDeltaCents),
        "principalCents",
      );
    } else {
      timeline.carry.unitPriceMicros = integerOrZero(
        event.data.unitPriceMicros,
      );
    }
    const valueAfter = carryValueCents(timeline.carry);
    const currentValueDeltaCents = addExact(
      valueAfter,
      -valueBefore,
      "currentValueDeltaCents",
    );

    if (event.kind === "movement") {
      accumulateMovement(state, event.data, event.at, currentValueDeltaCents);
      state.processedMovements += 1;
      timeline.movementCursor = {orderedAt: event.at, documentId: event.documentId};
    } else {
      accumulateValuation(state, event.at, currentValueDeltaCents);
      state.processedValuations += 1;
      timeline.valuationCursor = {
        orderedAt: event.at,
        documentId: event.documentId,
      };
    }
  }

  const consumedMovements = events.filter((e) => e.kind === "movement").length;
  const consumedValuations = events.length - consumedMovements;
  const positionDone =
    !movementsHaveMore &&
    !valuationsHaveMore &&
    consumedMovements === movementDocs.length &&
    consumedValuations === valuationDocs.length;

  if (positionDone) {
    timeline.positionCursor = timeline.positionId;
    timeline.positionId = undefined;
    timeline.movementCursor = undefined;
    timeline.valuationCursor = undefined;
    timeline.carry = emptyCarry();
  } else if (events.length === 0) {
    // Nem um evento consumido com fluxos ainda abertos significaria laço
    // infinito. Só acontece se `pageSize` for insuficiente para a marca
    // d'água — falha explícita em vez de girar em falso.
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "A reconstrução não conseguiu avançar na linha do tempo da posição " +
        `${timeline.positionId}. Aumente o tamanho da página.`,
    );
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
  // Série mensal **densa** entre o primeiro e o último mês com evento.
  //
  // Sem isto, um mês sem movimento nem valoração ficava fora da série e o
  // fechamento cumulativo pulava — e um mês que existia por uma reconstrução
  // anterior, mas perdeu o lastro no ledger, mantinha fechamento obsoleto
  // (INV-P2-015). Com a série densa, um mês sem evento herda o fechamento do
  // anterior, que é o valor correto.
  const periodEntries = fillPeriodGaps(state.periods).sort(
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
          realizedLossCents: bucket.realizedLossCents,
          feesCents: bucket.feesCents,
          taxCents: bucket.taxCents,
          rebuiltAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorId,
        },
        // Sobrescrita total, não `merge`. A reconstrução calcula **todos** os
        // campos do documento; mesclar deixaria sobreviver chave de execução
        // anterior sem lastro no ledger.
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
          realizedLossCents: bucket.realizedLossCents,
          feesCents: bucket.feesCents,
          taxCents: bucket.taxCents,
          costDeltaCents: bucket.costDeltaCents,
          currentValueDeltaCents: bucket.currentValueDeltaCents,
          cashDeltaCents: bucket.cashDeltaCents,
          settledMovementCount: bucket.settledMovementCount,
          closingCurrentValueCents: closingByPeriod.get(entry.id) ?? 0,
          // Mapa `daily` **substituído**, não mesclado: com `merge: true` as
          // chaves de dia de uma execução anterior sobreviviam e a série
          // diária divergia do total mensal (INV-P2-015).
          daily: bucket.daily ?? {},
          rebuiltAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          updatedBy: actorId,
        },
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
    realizedLossCents:
      state.summary.realizedLossCents -
      integerOrZero(previous.realizedLossCents),
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
  state.phase = "prune_allocations";
  state.cursor = undefined;
};

/**
 * Preenche os meses sem evento entre o primeiro e o último mês com evento.
 *
 * O fechamento patrimonial é cumulativo: um mês ausente da série faz o gráfico
 * saltar, e um mês que existe no Firestore mas não no ledger mantém fechamento
 * obsoleto. Densificar resolve os dois — o mês sem evento herda o fechamento
 * do anterior, que é exatamente o valor correto.
 */
const fillPeriodGaps = (
  periods: Record<string, PeriodBucket>,
): Array<[string, PeriodBucket]> => {
  const keys = Object.keys(periods).sort();
  if (keys.length === 0) return [];
  const dense: Array<[string, PeriodBucket]> = [];
  const [firstYear, firstMonth] = keys[0].split("-").map(Number);
  const last = keys[keys.length - 1];
  let year = firstYear;
  let month = firstMonth;
  for (let guard = 0; guard <= MAX_REPORT_PERIODS; guard += 1) {
    const key = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    dense.push([key, periods[key] ?? emptyPeriodBucket()]);
    if (key === last) return dense;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  throw new CreditCardApplicationError(
    "domain_precondition_failed",
    `A série densa excedeu ${MAX_REPORT_PERIODS} períodos mensais. ` +
      "Nenhum dado foi truncado.",
  );
};

/**
 * Zera documentos de projeção que sobreviveram a uma reconstrução anterior e
 * não têm mais lastro no ledger. Não há hard delete: o documento permanece
 * com valores zerados e `rebuiltAt`, preservando o histórico de existência.
 */
const pruneAllocationsPage = async (
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
        realizedLossCents: 0,
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
    state.phase = "prune_periods";
    state.cursor = undefined;
  }
};

/**
 * Poda de períodos órfãos (INV-P2-015).
 *
 * A fase de prune anterior varria **apenas** `investment_allocation_summaries`.
 * Um mês sem lastro no ledger — porque o único movimento daquele mês foi
 * estornado, por exemplo — mantinha fechamento obsoleto para sempre, e a
 * reconstrução, que existe justamente para eliminar deriva, o preservava.
 *
 * O documento não é apagado: histórico financeiro não sofre hard delete. Ele
 * é zerado, inclusive o mapa `daily` e o fechamento, e marcado com `rebuiltAt`.
 */
const prunePeriodsPage = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  actorId: string,
  state: RebuildState,
  pageSize: number,
): Promise<void> => {
  let query = investmentCollection(
    workspaceId,
    INVESTMENT_COLLECTIONS.reportPeriods,
  )
    .orderBy(admin.firestore.FieldPath.documentId(), "asc")
    .limit(pageSize + 1);
  if (state.cursor) {
    query = query.startAfter(state.cursor.documentId);
  }
  const page = await transaction.get(query);
  const docs = page.docs.slice(0, pageSize);
  const hasMore = page.size > pageSize;
  const published = new Set(
    fillPeriodGaps(state.periods).map(([key]) => key),
  );
  for (const doc of docs) {
    if (published.has(doc.id)) continue;
    transaction.set(
      doc.ref,
      {
        contributionCents: 0,
        redemptionPrincipalCents: 0,
        realizedGainCents: 0,
        realizedLossCents: 0,
        feesCents: 0,
        taxCents: 0,
        costDeltaCents: 0,
        currentValueDeltaCents: 0,
        cashDeltaCents: 0,
        settledMovementCount: 0,
        closingCurrentValueCents: 0,
        daily: {},
        rebuiltAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      },
      {merge: true},
    );
    state.prunedPeriodCount += 1;
  }
  const last = docs[docs.length - 1];
  state.cursor = last ?
    {orderedAt: state.cutoffAt, documentId: last.id} :
    state.cursor;
  if (!hasMore) {
    state.phase = "completed";
    state.cursor = undefined;
  }
};
