import {randomUUID} from "node:crypto";
import * as admin from "firebase-admin";
import {FieldPath, FieldValue, Timestamp} from "firebase-admin/firestore";
import {z} from "zod";

import {defineCallable} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {reserveRateLimit} from "../shared/rateLimit";
import {HEAVY_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import {
  CashContractViolationError,
  CASH_CATEGORY_FIELDS,
  CASH_CATEGORY_YEARS_COLLECTION,
  CASH_DELTA_FIELDS,
  CASH_PERIODS_COLLECTION,
  CASH_PERIOD_EVENTS_COLLECTION,
  CASH_PERIOD_SCHEMA_VERSION,
  CASH_PROJECTION_STATE_ID,
  addCashPeriodDelta,
  cashDaysMatchMonth,
  cashPeriodRef,
  cashProjectionStateRef,
  cashWritePlanFor,
  compareCommitTimes,
  emptyCashPeriodDelta,
  mergeCashDayDeltas,
  normalizeCashCategoryDelta,
  normalizeCashPeriodDelta,
  readCashCategoryDays,
  readCashDayDeltas,
  readCashProjectionState,
  writeCashCategoryYear,
  type CashCategoryWrite,
  type CashDayDeltas,
  type CashPeriodDelta,
  type CashProjectionState,
} from "./periods";
import {saoPauloMonthStart} from "../shared/dateKeys";
import * as functionsLogger from "firebase-functions/logger";
import {RETENTION_DAYS} from "../shared/retention";

/**
 * Reconstrução da projeção mensal de caixa (INV-P1-011; cerca em P3-B, D-38).
 *
 * A projeção é mantida por delta pelo gatilho de transações, e todo acumulador
 * precisa de caminho de reconstrução — a alternativa é um número opaco que
 * ninguém consegue conferir. Esta rotina recalcula os períodos a partir do
 * próprio ledger de transações e publica **valores absolutos**.
 *
 * É também o caminho de reparo quando a projeção precisa ser recalculada do
 * zero (por exemplo, depois de `needsRebuild`). Paginada e retomável por
 * cursor, como as demais operações pesadas: um tenant grande não cabe numa
 * transação nem numa invocação.
 *
 * ## Cerca de corte (P3-B)
 *
 * Enquanto a varredura anda, o ledger continua recebendo escritas dos
 * produtores do backend, e o gatilho continua somando deltas.
 * Publicar o acumulado por cima, sem cerca, perdia o delta de quem mudou uma
 * página já lida e somava duas vezes o evento entregue depois da publicação.
 *
 * O corte é o instante de commit do checkpoint (`cutoff`, gravado com
 * `serverTimestamp`). A base publicada contém **exatamente** as escritas com
 * commit `<= cutoff`:
 * - documento com `createTime > cutoff` não existia no corte: é ignorado, e o
 *   gatilho o soma como evento posterior;
 * - documento com `createTime <= cutoff < updateTime` mudou depois do corte e
 *   o estado no corte não pode mais ser lido: a reconstrução **recomeça** com
 *   um corte novo (falha controlada, nada é publicado);
 * - documento com `updateTime <= cutoff` está no estado do corte e entra.
 *
 * Na publicação, numa única transação: soma os deltas das marcas de entrega
 * com commit `> cutoff` já aplicadas (`cash_period_events`), grava os meses e
 * zera os órfãos, e registra o corte no estado da projeção
 * (`projection_state`). Daí em diante o gatilho ignora eventos com commit
 * `<= cutoff` (já estão na base) e soma os posteriores. A transação lê todos
 * os meses que grava e o estado que o gatilho lê: uma entrega concorrente é
 * serializada antes ou depois da publicação, nunca no meio.
 *
 * Exclusão física de documento que existia no corte, com commit depois dele,
 * é ambígua (a varredura pode ou não tê-lo visto): antes da publicação, faz a
 * reconstrução recomeçar; depois, o gatilho não soma e liga `needsRebuild`.
 * O produto não apaga transações (Rules `delete: false`, INV-P2-032).
 *
 * ## Dias e categorias (P5-C1, D-37.7/37.8)
 *
 * O mês publicado leva o detalhe diário (`days`) no mesmo documento: a
 * publicação grava total e dias juntos, e confere Σ dias = total antes de
 * escrever. Os dias acumulados pela varredura não cabem no checkpoint (600
 * meses × 31 dias), então vivem em shards por mês
 * (`cash_rebuild_shards/{rebuildId}__m__{AAAA-MM}`), incrementados na mesma
 * transação que avança o cursor — a página entra uma vez ou não entra.
 *
 * A projeção por categoria (`cash_category_years`) não cabe num commit
 * atômico; por isso é **por geração**. O checkpoint novo registra no estado
 * da projeção a geração em preparação (`categoryStaging`, com o mesmo corte):
 * a varredura incrementa a preparada com a base no corte e o gatilho a
 * alimenta com todo evento posterior ao corte (além da vigente). A
 * publicação troca a geração vigente pela preparada no mesmo commit dos
 * meses — o leitor vê a geração anterior inteira ou a nova inteira, nunca
 * uma mistura. Gerações descartadas (a anterior, ou uma preparação
 * abandonada por recomeço) vão para `categoryGarbage` e são apagadas aos
 * poucos pelas invocações seguintes.
 */

const payloadSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
  idempotencyKey: z.string().trim().min(8).max(200),
  correlationId: z.string().trim().min(3).max(200),
  pageSize: z.number().int().min(1).max(500).default(300),
  reason: z.string().trim().min(3).max(500),
  /*
   * Simulação: percorre o ledger e devolve os totais **sem publicar**.
   *
   * Um backfill que só existe em modo "aplicar" obriga a descobrir o resultado
   * depois de já o ter escrito. Com a simulação, o operador compara os totais
   * calculados com o saldo que o workspace exibia antes de tocar em qualquer
   * documento — que é a conferência que o runbook de staging exige antes de
   * aplicar em cima de dados reais.
   *
   * A simulação usa um checkpoint separado: simular não pode consumir o
   * checkpoint da execução real, nem o contrário.
   */
  dryRun: z.boolean().default(false),
}).strict();


type Payload = z.infer<typeof payloadSchema>;

const emptyTotals = emptyCashPeriodDelta;

const REBUILD_STATE_ID = "cash_periods_rebuild";
const DRY_RUN_STATE_ID = "cash_periods_rebuild_dry_run";

const rebuildStateRef = (
  workspaceId: string,
  dryRun = false,
): admin.firestore.DocumentReference =>
  admin.firestore().doc(
    `workspaces/${workspaceId}/${CASH_PERIODS_COLLECTION}/` +
      `${dryRun ? DRY_RUN_STATE_ID : REBUILD_STATE_ID}`,
  );

/**
 * Documentos de estado da reconstrução, que não são períodos.
 *
 * O de execução real e o da simulação ficam fora de qualquer soma de
 * períodos. Nenhum deles tem `periodStart`, então também não entram na
 * consulta ordenada do relatório (`readAllMonths`).
 */
export const CASH_REBUILD_STATE_IDS = [
  REBUILD_STATE_ID,
  DRY_RUN_STATE_ID,
] as const;

const isRebuildState = (id: string): boolean =>
  (CASH_REBUILD_STATE_IDS as readonly string[]).includes(id);

/** Teto de períodos: o acumulado vive num documento de até 1 MiB. */
export const MAX_CASH_PERIODS = 600;

/** Lançamento fora do contrato de `transactions` (P5-C2): nada publicado. */
export const CASH_REBUILD_CONTRACT_VIOLATION_MESSAGE =
  "A reconstrução do fluxo de caixa encontrou um lançamento com dados " +
  "inválidos e foi interrompida. Nenhum total foi alterado.";

/**
 * Escritas de um commit do Firestore (transação ou lote): 500.
 *
 * A publicação grava os meses, zera os órfãos, atualiza o estado e apaga o
 * checkpoint num **único** commit — dividir em lotes deixaria o painel ver um
 * saldo intermediário. Acima do teto, recusa antes de escrever qualquer coisa.
 */
export const FIRESTORE_MAX_WRITES_PER_COMMIT = 500;

/**
 * Teto de bytes da publicação (P5-C1). Um commit do Firestore aceita até
 * 10 MiB; com o detalhe diário, 600 meses cheios ficam perto de 7 MiB. Acima
 * da folga, recusa antes de escrever (estimativa conservadora).
 */
export const MAX_PUBLISH_BYTES = 9 * 1024 * 1024;

/** Eventos posteriores ao corte que uma publicação soma (leituras). */
export const MAX_POST_CUTOFF_EVENTS = 200;

/**
 * Idade máxima de uma reconstrução em andamento: depois disso recomeça.
 *
 * As marcas de entrega que a publicação soma expiram em 90 dias; uma janela
 * curta mantém poucas marcas para ler e afasta qualquer risco de TTL.
 */
export const MAX_REBUILD_AGE_SECONDS = 24 * 60 * 60;

/** Shards da reconstrução (dias por mês; categorias da simulação). */
export const CASH_REBUILD_SHARDS_COLLECTION = "cash_rebuild_shards";

/**
 * Orçamento de uma página (P5-C1): documentos tocados (shards de dias e
 * categorias) e transformações por documento num commit (o Firestore aceita
 * 500 por documento). A página é cortada antes de passar de qualquer um; o
 * cursor para no último lançamento incluído e a próxima invocação continua.
 */
export const MAX_PAGE_TOUCHED_DOCS = 400;
export const MAX_TRANSFORMS_PER_DOC = 450;

/** Gerações descartadas pendentes de limpeza (ver `categoryGarbage`). */
export const MAX_CATEGORY_GARBAGE = 8;

/** Documentos apagados por rodada de limpeza. */
export const CLEANUP_BATCH_SIZE = 400;

/** Formato do checkpoint: 2 = corte com geração de categoria (P5-C1). */
const CHECKPOINT_SCHEMA_VERSION = 2;

export const CATEGORY_GARBAGE_FULL_MESSAGE =
  "A limpeza de reconstruções anteriores ainda está em andamento. " +
  "Execute novamente para continuar.";

export type RebuildRestartReason =
  | "ledger_changed_during_rebuild"
  | "delete_during_rebuild"
  | "too_many_concurrent_changes"
  | "stale_checkpoint"
  | "category_staging_changed";

interface Checkpoint {
  rebuildId: string;
  cutoff: Timestamp;
  cursor: string | null;
  processed: number;
  periods: Record<string, CashPeriodDelta>;
  restarts: number;
  /** A varredura terminou; falta publicar (ou concluir a simulação). */
  scanComplete: boolean;
}

const readCheckpoint = (
  snapshot: admin.firestore.DocumentSnapshot,
): Checkpoint | null => {
  const data = snapshot.data();
  if (
    !data ||
    data.schemaVersion !== CHECKPOINT_SCHEMA_VERSION ||
    typeof data.rebuildId !== "string" ||
    !(data.cutoff instanceof Timestamp)
  ) {
    return null;
  }
  return {
    rebuildId: data.rebuildId,
    cutoff: data.cutoff,
    cursor: typeof data.cursor === "string" ? data.cursor : null,
    processed: Number.isSafeInteger(data.processed) ?
      (data.processed as number) :
      0,
    periods: (data.periods ?? {}) as Record<string, CashPeriodDelta>,
    restarts: Number.isSafeInteger(data.restarts) ?
      (data.restarts as number) :
      0,
    scanComplete: data.scanComplete === true,
  };
};

const isStale = (checkpoint: Checkpoint): boolean =>
  Date.now() - checkpoint.cutoff.toMillis() > MAX_REBUILD_AGE_SECONDS * 1000;

/** Checkpoint novo: o corte é o commit desta própria escrita. */
const newCheckpointData = (
  workspaceId: string,
  actorId: string,
  dryRun: boolean,
  rebuildId: string,
  restarts: number,
  reason: RebuildRestartReason | null,
): admin.firestore.DocumentData => ({
  id: dryRun ? DRY_RUN_STATE_ID : REBUILD_STATE_ID,
  workspaceId,
  kind: "cash_periods_rebuild",
  schemaVersion: CHECKPOINT_SCHEMA_VERSION,
  dryRun,
  status: "running",
  rebuildId,
  cutoff: FieldValue.serverTimestamp(),
  cursor: null,
  processed: 0,
  periods: {},
  scanComplete: false,
  restarts,
  lastRestartReason: reason,
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: actorId,
});

/**
 * Patch do estado que registra a geração de categoria em preparação (só na
 * execução real). O corte é o mesmo `serverTimestamp` do checkpoint escrito
 * no mesmo commit. A preparação anterior, se havia, vira descarte.
 */
const stagingPatch = (
  workspaceId: string,
  state: CashProjectionState,
  rebuildId: string,
): admin.firestore.DocumentData => {
  const garbage = [...state.categoryGarbage];
  const previous = state.categoryStaging?.generation;
  if (
    previous &&
    previous !== state.categoryGeneration &&
    !garbage.includes(previous)
  ) {
    garbage.push(previous);
  }
  if (garbage.length > MAX_CATEGORY_GARBAGE) {
    throw new ApplicationError(
      "domain_precondition_failed",
      CATEGORY_GARBAGE_FULL_MESSAGE,
    );
  }
  return {
    id: CASH_PROJECTION_STATE_ID,
    workspaceId,
    kind: "cash_projection_state",
    categoryStaging: {
      generation: rebuildId,
      cutoff: FieldValue.serverTimestamp(),
    },
    categoryGarbage: garbage,
    updatedAt: FieldValue.serverTimestamp(),
  };
};

/**
 * Escreve um checkpoint novo e, na execução real, a geração em preparação.
 * Uma escrita só, no mesmo commit: o corte do checkpoint e o da preparação
 * são o mesmo instante.
 */
const writeNewCheckpoint = (
  transaction: admin.firestore.Transaction,
  ref: admin.firestore.DocumentReference,
  state: CashProjectionState,
  workspaceId: string,
  actorId: string,
  dryRun: boolean,
  restarts: number,
  reason: RebuildRestartReason | null,
): void => {
  const rebuildId = randomUUID();
  if (!dryRun) {
    transaction.set(
      cashProjectionStateRef(workspaceId),
      stagingPatch(workspaceId, state, rebuildId),
      {merge: true},
    );
  }
  transaction.set(ref, newCheckpointData(
    workspaceId, actorId, dryRun, rebuildId, restarts, reason,
  ));
};

/**
 * Checkpoint em andamento, ou um novo. Checkpoint anterior à cerca (sem
 * `rebuildId`/`cutoff`), de formato anterior ou velho demais é substituído:
 * recomeçar é seguro, porque nada é publicado antes da última página.
 */
const ensureCheckpoint = async (
  ref: admin.firestore.DocumentReference,
  workspaceId: string,
  actorId: string,
  dryRun: boolean,
): Promise<Checkpoint> => {
  await admin.firestore().runTransaction(async (transaction) => {
    const [checkpointSnapshot, stateSnapshot] = await transaction.getAll(
      ref,
      cashProjectionStateRef(workspaceId),
    );
    const current = readCheckpoint(checkpointSnapshot);
    if (current && !isStale(current)) return;
    writeNewCheckpoint(
      transaction,
      ref,
      readCashProjectionState(stateSnapshot),
      workspaceId,
      actorId,
      dryRun,
      current ? current.restarts + 1 : 0,
      current ? "stale_checkpoint" : null,
    );
  });
  // Lido depois do commit: o corte já é o instante resolvido.
  const checkpoint = readCheckpoint(await ref.get());
  if (!checkpoint) {
    throw new ApplicationError(
      "concurrent_update",
      "A reconstrução foi alterada por outra execução. Tente novamente.",
    );
  }
  return checkpoint;
};

/** Mesmo checkpoint (execução e posição) que esta invocação leu. */
const sameCheckpoint = (
  current: Checkpoint | null,
  expected: Checkpoint,
): current is Checkpoint =>
  current !== null &&
  current.rebuildId === expected.rebuildId &&
  current.cursor === expected.cursor;

/**
 * Recomeça a partir de um estado consistente: checkpoint novo, com corte
 * novo, sem nada publicado. Se outra execução já mexeu no checkpoint, não
 * escreve nada.
 */
const restartCheckpoint = async (
  ref: admin.firestore.DocumentReference,
  expected: Checkpoint,
  workspaceId: string,
  actorId: string,
  dryRun: boolean,
  reason: RebuildRestartReason,
): Promise<boolean> =>
  admin.firestore().runTransaction(async (transaction) => {
    const [checkpointSnapshot, stateSnapshot] = await transaction.getAll(
      ref,
      cashProjectionStateRef(workspaceId),
    );
    const current = readCheckpoint(checkpointSnapshot);
    if (!sameCheckpoint(current, expected)) return false;
    writeNewCheckpoint(
      transaction,
      ref,
      readCashProjectionState(stateSnapshot),
      workspaceId,
      actorId,
      dryRun,
      current.restarts + 1,
      reason,
    );
    return true;
  });

const addInto = (
  target: Record<string, CashPeriodDelta>,
  period: string,
  delta: CashPeriodDelta,
): void => {
  // Campo ausente vale zero (`normalizeCashPeriodDelta`).
  target[period] = addCashPeriodDelta(
    target[period] ?? emptyTotals(),
    normalizeCashPeriodDelta(delta),
  );
};

const cloneTotals = (
  totals: Record<string, CashPeriodDelta>,
): Record<string, CashPeriodDelta> => {
  const copy: Record<string, CashPeriodDelta> = {};
  for (const [period, delta] of Object.entries(totals)) {
    addInto(copy, period, delta);
  }
  return copy;
};

const addDaysInto = (
  target: Record<string, CashDayDeltas>,
  period: string,
  days: CashDayDeltas,
): void => {
  const month = target[period] ?? (target[period] = {});
  mergeCashDayDeltas(month, days);
};

// ------------------------------------------------------------------ shards

const shardExpiry = (cutoff: Timestamp): Timestamp =>
  Timestamp.fromMillis(
    cutoff.toMillis() + RETENTION_DAYS.cashRebuildShards * 24 * 60 * 60 * 1000,
  );

const monthShardId = (rebuildId: string, period: string): string =>
  `${rebuildId}__m__${period}`;

const categoryShardId = (
  rebuildId: string,
  year: string,
  categoryKey: string,
): string => `${rebuildId}__c__${year}__${categoryKey}`;

const shardsRef = (workspaceId: string) =>
  admin.firestore().collection(
    `workspaces/${workspaceId}/${CASH_REBUILD_SHARDS_COLLECTION}`,
  );

const incrementsOf = (
  delta: Partial<Record<string, number>>,
): Record<string, FieldValue> => Object.fromEntries(
  Object.entries(delta).map(([field, value]) =>
    [field, FieldValue.increment(value as number)]),
);

/** Detalhe diário de um mês acumulado pela varredura (incremento). */
const writeMonthShard = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  checkpoint: Checkpoint,
  period: string,
  days: CashDayDeltas,
): void => {
  transaction.set(
    shardsRef(workspaceId).doc(monthShardId(checkpoint.rebuildId, period)),
    {
      workspaceId,
      rebuildId: checkpoint.rebuildId,
      kind: "month_days",
      period,
      days: Object.fromEntries(Object.entries(days).map(([dd, delta]) =>
        [dd, incrementsOf(delta)])),
      expiresAt: shardExpiry(checkpoint.cutoff),
      updatedAt: FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
};

/** Categoria-ano da simulação (nunca publicada). */
const writeCategoryShard = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  checkpoint: Checkpoint,
  entry: CashCategoryWrite,
): void => {
  transaction.set(
    shardsRef(workspaceId).doc(categoryShardId(
      checkpoint.rebuildId, entry.year, entry.categoryKey,
    )),
    {
      workspaceId,
      rebuildId: checkpoint.rebuildId,
      kind: "category_year",
      year: entry.year,
      categoryKey: entry.categoryKey,
      categoryId: entry.categoryId,
      classification: entry.classification,
      ...incrementsOf(entry.totals as unknown as Record<string, number>),
      days: Object.fromEntries(Object.entries(entry.days).map(
        ([mmdd, delta]) => [mmdd, incrementsOf(delta)])),
      expiresAt: shardExpiry(checkpoint.cutoff),
      updatedAt: FieldValue.serverTimestamp(),
    },
    {merge: true},
  );
};

/** Documentos de uma coleção cujo ID começa com `prefix`, em ordem de ID. */
const prefixQuery = (
  collection: admin.firestore.CollectionReference,
  prefix: string,
  limit: number,
): admin.firestore.Query => collection
  .orderBy(FieldPath.documentId())
  .startAt(prefix)
  .endAt(`${prefix}`)
  .limit(limit);

const deleteByPrefix = async (
  collection: admin.firestore.CollectionReference,
  prefix: string,
  limit: number,
): Promise<number> => {
  const snapshot = await prefixQuery(collection, prefix, limit).get();
  if (snapshot.empty) return 0;
  const batch = admin.firestore().batch();
  for (const doc of snapshot.docs) batch.delete(doc.ref);
  await batch.commit();
  return snapshot.size;
};

const categoryYearsRef = (workspaceId: string) =>
  admin.firestore().collection(
    `workspaces/${workspaceId}/${CASH_CATEGORY_YEARS_COLLECTION}`,
  );

/**
 * Limpeza das gerações descartadas, uma rodada limitada por invocação.
 *
 * Nunca apaga a geração vigente nem a preparada (a lista de descarte só
 * recebe gerações que deixaram de ser as duas, e os IDs são únicos). Uma
 * geração some da lista só depois de não restar nenhum documento dela.
 */
/** Lotes de limpeza logo após a publicação (até 10 × 400 documentos). */
export const POST_PUBLISH_CLEANUP_BATCHES = 10;

export const cleanupCategoryGarbage = async (
  workspaceId: string,
  budget: number = CLEANUP_BATCH_SIZE,
): Promise<{deleted: number; pending: number}> => {
  const stateRef = cashProjectionStateRef(workspaceId);
  const state = readCashProjectionState(await stateRef.get());
  let deleted = 0;
  for (const generation of state.categoryGarbage) {
    if (
      generation === state.categoryGeneration ||
      generation === state.categoryStaging?.generation
    ) {
      continue;
    }
    if (deleted >= budget) break;
    const removed = await deleteByPrefix(
      categoryYearsRef(workspaceId), `${generation}__`, budget - deleted,
    );
    deleted += removed;
    if (removed < budget) {
      const leftover = await prefixQuery(
        categoryYearsRef(workspaceId), `${generation}__`, 1,
      ).get();
      if (leftover.empty) {
        await stateRef.set({
          categoryGarbage: FieldValue.arrayRemove(generation),
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
      }
    }
  }
  const after = readCashProjectionState(await stateRef.get());
  return {deleted, pending: after.categoryGarbage.length};
};

/** Shards de uma reconstrução encerrada (a TTL cobre o que sobrar). */
const cleanupShards = async (
  workspaceId: string,
  rebuildId: string,
): Promise<void> => {
  for (let round = 0; round < 3; round += 1) {
    const removed = await deleteByPrefix(
      shardsRef(workspaceId), `${rebuildId}__`, CLEANUP_BATCH_SIZE,
    );
    if (removed < CLEANUP_BATCH_SIZE) return;
  }
};

/**
 * Limpeza é manutenção, não parte da publicação: falhar aqui não desfaz nem
 * bloqueia nada já publicado; o que sobrar fica para a próxima invocação
 * (gerações) ou para a TTL (shards). A falha é registrada.
 */
const bestEffort = async (
  label: string,
  workspaceId: string,
  run: () => Promise<unknown>,
): Promise<void> => {
  try {
    await run();
  } catch (error) {
    functionsLogger.warn("cash_rebuild_cleanup_failed", {
      operation: "rebuildCashPeriods",
      step: label,
      workspaceId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
};

// ------------------------------------------------------------------ página

interface PageWork {
  consumed: number;
  lastId: string | undefined;
  cut: boolean;
  restart: RebuildRestartReason | null;
  skippedAfterCutoff: number;
  months: Record<string, CashPeriodDelta>;
  days: Record<string, CashDayDeltas>;
  categories: Record<string, CashCategoryWrite>;
}

/** Caminhos de campo distintos por documento tocado (orçamento). */
type TouchedFields = Map<string, Set<string>>;

const touch = (
  touched: TouchedFields,
  doc: string,
  paths: string[],
): Set<string> => {
  const existing = touched.get(doc);
  const next = new Set(existing ?? []);
  for (const path of paths) next.add(path);
  return next;
};

/**
 * Processa uma página do ledger respeitando a cerca de corte e o orçamento
 * do commit. Um lançamento sozinho sempre cabe (no máximo um shard de mês e
 * uma categoria-ano, com poucos campos), então toda página avança.
 */
/**
 * Documento fora do contrato único achado na varredura (P5-C2): leva o ID e o
 * campo para o log operacional, nunca para a resposta.
 */
class RebuildContractViolation extends Error {
  constructor(
    readonly transactionId: string,
    readonly field: CashContractViolationError["field"],
  ) {
    super(`transação fora do contrato: ${field}`);
    this.name = "RebuildContractViolation";
  }
}

const processPage = (
  docs: admin.firestore.QueryDocumentSnapshot[],
  cutoff: Timestamp,
): PageWork => {
  const work: PageWork = {
    consumed: 0,
    lastId: undefined,
    cut: false,
    restart: null,
    skippedAfterCutoff: 0,
    months: {},
    days: {},
    categories: {},
  };
  const touched: TouchedFields = new Map();
  for (const entry of docs) {
    if (compareCommitTimes(entry.createTime, cutoff) > 0) {
      // Criado depois do corte: entra pelo gatilho, como evento posterior.
      work.skippedAfterCutoff += 1;
      work.consumed += 1;
      work.lastId = entry.id;
      continue;
    }
    if (compareCommitTimes(entry.updateTime, cutoff) > 0) {
      // Mudou depois do corte e o estado no corte não pode mais ser lido.
      work.restart = "ledger_changed_during_rebuild";
      return work;
    }
    let plan: ReturnType<typeof cashWritePlanFor>;
    try {
      plan = cashWritePlanFor(undefined, entry.data());
    } catch (error) {
      if (error instanceof CashContractViolationError) {
        throw new RebuildContractViolation(entry.id, error.field);
      }
      throw error;
    }
    const proposed: Array<[string, Set<string>]> = [];
    for (const [period, days] of Object.entries(plan.days)) {
      const paths = Object.entries(days).flatMap(([dd, delta]) =>
        Object.keys(delta).map((field) => `${dd}.${field}`));
      proposed.push([`m:${period}`, touch(touched, `m:${period}`, paths)]);
    }
    for (const [key, category] of Object.entries(plan.categories)) {
      const paths = [
        ...CASH_CATEGORY_FIELDS,
        ...Object.entries(category.days).flatMap(([mmdd, delta]) =>
          Object.keys(delta).map((field) => `${mmdd}.${field}`)),
      ];
      proposed.push([`c:${key}`, touch(touched, `c:${key}`, paths)]);
    }
    const docCount = new Set([
      ...touched.keys(),
      ...proposed.map(([doc]) => doc),
    ]).size;
    const overBudget = docCount > MAX_PAGE_TOUCHED_DOCS ||
      proposed.some(([, paths]) => paths.size > MAX_TRANSFORMS_PER_DOC);
    if (overBudget && work.consumed > 0) {
      work.cut = true;
      return work;
    }
    for (const [doc, paths] of proposed) touched.set(doc, paths);
    for (const [period, delta] of Object.entries(plan.months)) {
      addInto(work.months, period, delta);
    }
    for (const [period, days] of Object.entries(plan.days)) {
      addDaysInto(work.days, period, days);
    }
    for (const [key, category] of Object.entries(plan.categories)) {
      const current = work.categories[key];
      if (!current) {
        work.categories[key] = {
          ...category,
          totals: {...category.totals},
          days: Object.fromEntries(Object.entries(category.days)
            .map(([mmdd, delta]) => [mmdd, {...delta}])),
        };
        continue;
      }
      for (const field of CASH_CATEGORY_FIELDS) {
        current.totals[field] =
          current.totals[field] + category.totals[field] || 0;
      }
      for (const [mmdd, delta] of Object.entries(category.days)) {
        const day = current.days[mmdd] ?? (current.days[mmdd] = {});
        for (const field of CASH_CATEGORY_FIELDS) {
          const sum = (day[field] ?? 0) + (delta[field] ?? 0) || 0;
          if (sum === 0) delete day[field];
          else day[field] = sum;
        }
      }
    }
    work.consumed += 1;
    work.lastId = entry.id;
  }
  return work;
};

// ------------------------------------------------------------- divergência

const DIVERGENCE_SAMPLE_LIMIT = 24;

const DELTA_FIELDS = CASH_DELTA_FIELDS;

const storedTotalsOf = (
  data: admin.firestore.DocumentData,
): CashPeriodDelta => normalizeCashPeriodDelta(data);

const sameDays = (left: CashDayDeltas, right: CashDayDeltas): boolean => {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const dd of keys) {
    const a = normalizeCashPeriodDelta(left[dd]);
    const b = normalizeCashPeriodDelta(right[dd]);
    if (DELTA_FIELDS.some((field) => a[field] !== b[field])) return false;
  }
  return true;
};

/**
 * Divergência entre a projeção gravada e a reconstruída do ledger (P3-F).
 *
 * É o procedimento de reconciliação da simulação: depois da mudança de regra
 * de D-29 (pendente e agendado não movem o caixa realizado), uma projeção
 * produzida pela regra anterior aparece aqui, mês a mês, antes de qualquer
 * publicação. Leitura limitada aos 600 meses mais os dois checkpoints; acima
 * disso, recusa, nunca trunca. Retrato da simulação, sem trava: uma entrega
 * concorrente do gatilho pode aparecer como divergência transitória.
 *
 * P5-C1: compara também o detalhe diário (`divergentDayPeriods`).
 */
const divergenceOf = async (
  workspaceId: string,
  rebuilt: Record<string, CashPeriodDelta>,
  rebuiltDays: Record<string, CashDayDeltas>,
) => {
  const maxDocs = MAX_CASH_PERIODS + CASH_REBUILD_STATE_IDS.length;
  const stored = await admin.firestore()
    .collection(`workspaces/${workspaceId}/${CASH_PERIODS_COLLECTION}`)
    .limit(maxDocs + 1)
    .get();
  if (stored.size > maxDocs) {
    throw new ApplicationError(
      "domain_precondition_failed",
      "A projeção do fluxo de caixa excede 600 períodos mensais. " +
        "Nenhum dado foi alterado.",
    );
  }
  const storedByPeriod: Record<string, CashPeriodDelta> = {};
  const storedDays: Record<string, CashDayDeltas> = {};
  for (const doc of stored.docs) {
    if (isRebuildState(doc.id)) continue;
    storedByPeriod[doc.id] = storedTotalsOf(doc.data());
    storedDays[doc.id] = readCashDayDeltas(doc.data().days);
  }
  const periods = [...new Set([
    ...Object.keys(storedByPeriod),
    ...Object.keys(rebuilt),
  ])].sort();
  const sample: Array<{
    period: string;
    stored: CashPeriodDelta;
    rebuilt: CashPeriodDelta;
  }> = [];
  let divergentPeriods = 0;
  let divergentDayPeriods = 0;
  let storedNetCents = 0;
  let rebuiltNetCents = 0;
  for (const period of periods) {
    const before = storedByPeriod[period] ?? emptyTotals();
    const after = rebuilt[period] ?? emptyTotals();
    storedNetCents += before.netCents;
    rebuiltNetCents += after.netCents;
    if (DELTA_FIELDS.some((field) => before[field] !== after[field])) {
      divergentPeriods += 1;
      if (sample.length < DIVERGENCE_SAMPLE_LIMIT) {
        sample.push({period, stored: before, rebuilt: after});
      }
    }
    if (!sameDays(storedDays[period] ?? {}, rebuiltDays[period] ?? {})) {
      divergentDayPeriods += 1;
    }
  }
  return {
    divergentPeriods,
    divergentDayPeriods,
    storedNetCents,
    rebuiltNetCents,
    netDifferenceCents: storedNetCents - rebuiltNetCents,
    sample,
  };
};

/** Teto de leitura da comparação de categorias na simulação. */
export const MAX_CATEGORY_DIVERGENCE_DOCS = 5000;

interface CategoryYearSnapshot {
  totals: ReturnType<typeof normalizeCashCategoryDelta>;
  days: ReturnType<typeof readCashCategoryDays>;
}

const categorySnapshotOf = (
  data: admin.firestore.DocumentData,
): CategoryYearSnapshot => ({
  totals: normalizeCashCategoryDelta(data),
  days: readCashCategoryDays(data.days),
});

const sameCategory = (
  left: CategoryYearSnapshot | undefined,
  right: CategoryYearSnapshot | undefined,
): boolean => {
  const a = left ?? {totals: normalizeCashCategoryDelta(undefined), days: {}};
  const b = right ?? {totals: normalizeCashCategoryDelta(undefined), days: {}};
  const differs = CASH_CATEGORY_FIELDS.some((field) =>
    a.totals[field] !== b.totals[field]);
  if (differs) return false;
  const keys = new Set([...Object.keys(a.days), ...Object.keys(b.days)]);
  for (const mmdd of keys) {
    const x = normalizeCashCategoryDelta(a.days[mmdd]);
    const y = normalizeCashCategoryDelta(b.days[mmdd]);
    if (CASH_CATEGORY_FIELDS.some((field) => x[field] !== y[field])) {
      return false;
    }
  }
  return true;
};

/**
 * Divergência da projeção por categoria (P5-C1): a geração vigente contra a
 * acumulada pela simulação. Acima do teto de leitura, não compara (nunca
 * compara parcialmente).
 */
const categoryDivergenceOf = async (
  workspaceId: string,
  generation: string,
  rebuildId: string,
) => {
  const [stored, rebuilt] = await Promise.all([
    prefixQuery(categoryYearsRef(workspaceId), `${generation}__`,
      MAX_CATEGORY_DIVERGENCE_DOCS + 1).get(),
    prefixQuery(shardsRef(workspaceId), `${rebuildId}__c__`,
      MAX_CATEGORY_DIVERGENCE_DOCS + 1).get(),
  ]);
  if (
    stored.size > MAX_CATEGORY_DIVERGENCE_DOCS ||
    rebuilt.size > MAX_CATEGORY_DIVERGENCE_DOCS
  ) {
    return {checked: false as const, generation};
  }
  const storedByKey = new Map<string, CategoryYearSnapshot>();
  for (const doc of stored.docs) {
    storedByKey.set(doc.id.slice(generation.length + 2),
      categorySnapshotOf(doc.data()));
  }
  const rebuiltByKey = new Map<string, CategoryYearSnapshot>();
  for (const doc of rebuilt.docs) {
    rebuiltByKey.set(doc.id.slice(rebuildId.length + 5),
      categorySnapshotOf(doc.data()));
  }
  const keys = [...new Set([...storedByKey.keys(), ...rebuiltByKey.keys()])]
    .sort();
  const sample: string[] = [];
  let divergentCategoryYears = 0;
  for (const key of keys) {
    if (!sameCategory(storedByKey.get(key), rebuiltByKey.get(key))) {
      divergentCategoryYears += 1;
      if (sample.length < DIVERGENCE_SAMPLE_LIMIT) sample.push(key);
    }
  }
  return {
    checked: true as const,
    generation,
    categoryYears: keys.length,
    divergentCategoryYears,
    sample,
  };
};

/** Soma dos períodos acumulados — a conferência que o operador compara. */
const reconciliationOf = (
  accumulated: Record<string, CashPeriodDelta>,
): CashPeriodDelta & {periodCount: number} => {
  let sum = emptyTotals();
  let periodCount = 0;
  for (const totals of Object.values(accumulated)) {
    sum = addCashPeriodDelta(sum, totals);
    periodCount += 1;
  }
  return {...sum, periodCount};
};

/** Marcas de entrega com commit depois do corte, em ordem. */
const postCutoffEventsQuery = (
  workspaceId: string,
  cutoff: Timestamp,
): admin.firestore.Query =>
  admin.firestore()
    .collection(
      `workspaces/${workspaceId}/${CASH_PERIOD_EVENTS_COLLECTION}`,
    )
    .where("eventTime", ">", cutoff)
    .orderBy("eventTime")
    .limit(MAX_POST_CUTOFF_EVENTS + 1);

interface PostCutoffSummary {
  count: number;
  deltas: Record<string, CashPeriodDelta>;
  dayDeltas: Record<string, CashDayDeltas>;
  restartReason: RebuildRestartReason | null;
}

/**
 * Deltas dos eventos posteriores ao corte que o gatilho já aplicou.
 *
 * - Mais eventos do que o teto: recomeça (muitas mudanças concorrentes).
 * - Exclusão de documento que existia no corte: recomeça (ambígua).
 * - Só as marcas `applied` somam; as demais não moveram a projeção.
 * - P5-C1: soma também o detalhe diário (`dayDeltas`) da mesma marca.
 */
const summarizePostCutoffEvents = (
  docs: admin.firestore.QueryDocumentSnapshot[],
  cutoff: Timestamp,
): PostCutoffSummary => {
  const summary: PostCutoffSummary = {
    count: docs.length,
    deltas: {},
    dayDeltas: {},
    restartReason: null,
  };
  if (docs.length > MAX_POST_CUTOFF_EVENTS) {
    summary.restartReason = "too_many_concurrent_changes";
    return summary;
  }
  for (const doc of docs) {
    const data = doc.data();
    const beforeCreateTime = data.beforeCreateTime instanceof Timestamp ?
      data.beforeCreateTime :
      null;
    if (
      data.action === "DELETE" &&
      (!beforeCreateTime || compareCommitTimes(beforeCreateTime, cutoff) <= 0)
    ) {
      summary.restartReason = "delete_during_rebuild";
      return summary;
    }
    if (data.outcome !== "applied") continue;
    const deltas = (data.deltas ?? {}) as Record<string, CashPeriodDelta>;
    for (const [period, delta] of Object.entries(deltas)) {
      addInto(summary.deltas, period, delta);
    }
    const dayDeltas = (data.dayDeltas ?? {}) as Record<string, unknown>;
    for (const [period, days] of Object.entries(dayDeltas)) {
      addDaysInto(summary.dayDeltas, period, readCashDayDeltas(days));
      // Mudança só de dia dentro do mês: o total não muda, mas o mês entra
      // no conjunto publicado para receber os dias.
      addInto(summary.deltas, period, emptyTotals());
    }
  }
  return summary;
};

/** Pontos de injeção de falha e limites reduzidos, só para os testes. */
export interface RebuildOptions {
  /** Teto de escritas da publicação; padrão: o limite do Firestore. */
  publishWriteBudget?: number;
  faults?: {
    /** Depois de ler a página, antes de avançar o checkpoint. */
    afterPageRead?: () => Promise<void> | void;
    /** Com as escritas da publicação enfileiradas, antes do commit. */
    beforePublishCommit?: () => void | Promise<void>;
  };
}

const restartedResult = (
  dryRun: boolean,
  restarted: boolean,
  reason: RebuildRestartReason,
): Record<string, unknown> => restarted ?
  {success: true, completed: false, dryRun, restarted: true, reason} :
  {success: true, completed: false, dryRun, concurrent: true};

/** Detalhe diário acumulado nos shards dos meses informados. */
const readMonthShards = async (
  read: (
    ...refs: admin.firestore.DocumentReference[]
  ) => Promise<admin.firestore.DocumentSnapshot[]>,
  workspaceId: string,
  rebuildId: string,
  periods: string[],
): Promise<Record<string, CashDayDeltas>> => {
  const days: Record<string, CashDayDeltas> = {};
  if (periods.length === 0) return days;
  const snapshots = await read(...periods.map((period) =>
    shardsRef(workspaceId).doc(monthShardId(rebuildId, period))));
  snapshots.forEach((snapshot, index) => {
    days[periods[index]] = snapshot.exists ?
      readCashDayDeltas(snapshot.data()?.days) :
      {};
  });
  return days;
};

export const executeRebuildCashPeriods = async (
  workspaceId: string,
  actorId: string,
  payload: Payload,
  options: RebuildOptions = {},
): Promise<Record<string, unknown>> => {
  const db = admin.firestore();
  if (!payload.dryRun) {
    // Abre espaço na lista de descarte antes de qualquer troca de geração.
    await bestEffort("category_garbage_before", workspaceId,
      () => cleanupCategoryGarbage(workspaceId));
  }
  const ref = rebuildStateRef(workspaceId, payload.dryRun);
  let checkpoint = await ensureCheckpoint(
    ref,
    workspaceId,
    actorId,
    payload.dryRun,
  );
  const {cutoff} = checkpoint;

  if (!checkpoint.scanComplete) {
    let query = db
      .collection(`workspaces/${workspaceId}/transactions`)
      .orderBy(FieldPath.documentId())
      .limit(payload.pageSize);
    if (checkpoint.cursor) query = query.startAfter(checkpoint.cursor);
    const page = await query.get();
    await options.faults?.afterPageRead?.();

    let work: ReturnType<typeof processPage>;
    try {
      work = processPage(page.docs, cutoff);
    } catch (error) {
      // Documento fora do contrato único (P5-C2): a reconstrução para sem
      // publicar nada, em vez de contar o lançamento como zero. O log leva o
      // ID e o campo, para localizar o documento (restore, escrita antiga).
      if (error instanceof RebuildContractViolation) {
        functionsLogger.error("cash_rebuild_contract_violation", {
          workspaceId,
          transactionId: error.transactionId,
          field: error.field,
        });
        throw new ApplicationError(
          "domain_precondition_failed",
          CASH_REBUILD_CONTRACT_VIOLATION_MESSAGE,
        );
      }
      throw error;
    }
    if (work.restart) {
      const restarted = await restartCheckpoint(
        ref, checkpoint, workspaceId, actorId, payload.dryRun, work.restart,
      );
      return restartedResult(payload.dryRun, restarted, work.restart);
    }

    const accumulated = cloneTotals(checkpoint.periods);
    for (const [period, delta] of Object.entries(work.months)) {
      addInto(accumulated, period, delta);
    }
    // Teto explícito: a acumulação vive num documento, que tem limite de 1
    // MiB. Um workspace com mais de 600 meses de histórico é impossível na
    // prática; atingir o teto é erro nomeado, nunca truncamento silencioso.
    if (Object.keys(accumulated).length > MAX_CASH_PERIODS) {
      throw new ApplicationError(
        "domain_precondition_failed",
        "A reconstrução do fluxo de caixa excedeu 600 períodos mensais. " +
          "Nenhum dado foi truncado.",
      );
    }

    const scanComplete = !work.cut && page.size < payload.pageSize;
    const processed = checkpoint.processed + work.consumed;
    const cursor = work.lastId ?? checkpoint.cursor;
    const current = checkpoint;
    // A página entra inteira (cursor, totais, dias e categorias) ou não
    // entra: um retry depois de perder a resposta encontra o cursor novo e
    // não soma de novo.
    const advanced = await db.runTransaction(async (transaction) => {
      const stored = readCheckpoint(await transaction.get(ref));
      if (!sameCheckpoint(stored, current)) return false;
      for (const [period, days] of Object.entries(work.days)) {
        writeMonthShard(transaction, workspaceId, current, period, days);
      }
      for (const entry of Object.values(work.categories)) {
        if (payload.dryRun) {
          writeCategoryShard(transaction, workspaceId, current, entry);
        } else {
          writeCashCategoryYear(transaction, workspaceId, current.rebuildId,
            entry);
        }
      }
      transaction.update(ref, {
        cursor,
        processed,
        periods: accumulated,
        scanComplete,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      });
      return true;
    });
    if (!advanced) {
      return {
        success: true,
        completed: false,
        dryRun: payload.dryRun,
        concurrent: true,
      };
    }
    if (!scanComplete) {
      return {
        success: true,
        completed: false,
        dryRun: payload.dryRun,
        processed,
        periods: Object.keys(accumulated).length,
        skippedAfterCutoff: work.skippedAfterCutoff,
      };
    }
    checkpoint = {
      ...checkpoint,
      cursor,
      processed,
      periods: accumulated,
      scanComplete: true,
    };
  }

  /*
   * Simulação concluída: devolve a conferência do que a publicação gravaria
   * agora (base no corte + eventos posteriores já aplicados) e **não**
   * publica nada. Usa checkpoint próprio e nunca toca nos períodos nem no
   * estado da projeção.
   */
  if (payload.dryRun) {
    return finishDryRun(workspaceId, actorId, ref, checkpoint);
  }

  return publishRebuild(workspaceId, actorId, checkpoint, options);
};

const finishDryRun = async (
  workspaceId: string,
  actorId: string,
  ref: admin.firestore.DocumentReference,
  checkpoint: Checkpoint,
): Promise<Record<string, unknown>> => {
  const db = admin.firestore();
  const {cutoff} = checkpoint;
  const events = summarizePostCutoffEvents(
    (await postCutoffEventsQuery(workspaceId, cutoff).get()).docs,
    cutoff,
  );
  if (events.restartReason) {
    const restarted = await restartCheckpoint(
      ref, checkpoint, workspaceId, actorId, true, events.restartReason,
    );
    return restartedResult(true, restarted, events.restartReason);
  }
  const totals = cloneTotals(checkpoint.periods);
  for (const [period, delta] of Object.entries(events.deltas)) {
    addInto(totals, period, delta);
  }
  const days = await readMonthShards(
    (...refs) => db.getAll(...refs), workspaceId, checkpoint.rebuildId,
    Object.keys(totals),
  );
  for (const [period, eventDays] of Object.entries(events.dayDeltas)) {
    addDaysInto(days, period, eventDays);
  }
  const state = readCashProjectionState(
    await cashProjectionStateRef(workspaceId).get(),
  );
  const divergence = await divergenceOf(workspaceId, totals, days);
  // Os acumuladores de categoria da simulação cobrem só a base (até o
  // corte); a geração vigente já inclui os eventos posteriores. Com eventos
  // depois do corte, comparar as duas acusaria divergência falsa: a
  // conferência de categorias fica marcada como não verificada.
  const categoryDivergence = events.count > 0 ?
    {
      checked: false as const,
      generation: state.categoryGeneration,
      reason: "post_cutoff_events" as const,
    } :
    await categoryDivergenceOf(
      workspaceId, state.categoryGeneration, checkpoint.rebuildId,
    );
  const finished = await db.runTransaction(async (transaction) => {
    const current = readCheckpoint(await transaction.get(ref));
    if (!current || current.rebuildId !== checkpoint.rebuildId) return false;
    transaction.delete(ref);
    return true;
  });
  if (!finished) {
    return {success: true, completed: false, dryRun: true, concurrent: true};
  }
  await bestEffort("dry_run_shards", workspaceId,
    () => cleanupShards(workspaceId, checkpoint.rebuildId));
  return {
    success: true,
    completed: true,
    dryRun: true,
    processed: checkpoint.processed,
    periods: Object.keys(totals).length,
    postCutoffEvents: events.count,
    reconciliation: reconciliationOf(totals),
    divergence,
    categoryDivergence,
  };
};

/** Estimativa conservadora do tamanho de um documento publicado. */
const estimatedBytes = (data: Record<string, unknown>): number =>
  JSON.stringify(data).length + 256;

/**
 * Publicação atômica da reconstrução (depois da última página).
 *
 * Uma transação lê o checkpoint, o estado da projeção, as marcas posteriores
 * ao corte, os shards de dias e **todos** os meses que vai gravar (os
 * existentes pela consulta da coleção, os novos por leitura direta), e só
 * então escreve. Por isso uma entrega concorrente do gatilho, que lê o estado
 * e escreve meses, fica serializada antes (e a publicação soma a marca dela)
 * ou depois (e ela se soma sobre a base publicada), nunca no meio.
 *
 * No mesmo commit, troca a geração vigente da projeção por categoria pela
 * preparada por esta reconstrução (P5-C1).
 *
 * Recusa explícita, sem nenhuma escrita, quando a publicação passaria do teto
 * de um commit atômico (escritas ou bytes) ou quando a soma dos dias não
 * fecha com o total de algum mês.
 */
const publishRebuild = async (
  workspaceId: string,
  actorId: string,
  checkpoint: Checkpoint,
  options: RebuildOptions,
): Promise<Record<string, unknown>> => {
  const db = admin.firestore();
  const ref = rebuildStateRef(workspaceId);
  const stateRef = cashProjectionStateRef(workspaceId);
  const budget = options.publishWriteBudget ?? FIRESTORE_MAX_WRITES_PER_COMMIT;
  const {cutoff} = checkpoint;

  const outcome = await db.runTransaction(async (transaction) => {
    const [checkpointSnapshot, stateSnapshot] = await transaction.getAll(
      ref,
      stateRef,
    );
    const current = readCheckpoint(checkpointSnapshot);
    if (
      !current ||
      current.rebuildId !== checkpoint.rebuildId ||
      !current.scanComplete
    ) {
      return {kind: "concurrent" as const};
    }
    const state = readCashProjectionState(stateSnapshot);
    if (
      state.baselineCutoff &&
      compareCommitTimes(state.baselineCutoff, cutoff) >= 0
    ) {
      // Uma reconstrução com corte igual ou mais novo já publicou: publicar
      // esta regrediria a base. A preparação desta execução vira descarte.
      if (state.categoryStaging?.generation === current.rebuildId) {
        transaction.set(stateRef, {
          categoryStaging: FieldValue.delete(),
          categoryGarbage: FieldValue.arrayUnion(current.rebuildId),
          updatedAt: FieldValue.serverTimestamp(),
        }, {merge: true});
      }
      transaction.delete(ref);
      return {kind: "superseded" as const};
    }
    if (state.categoryStaging?.generation !== current.rebuildId) {
      // A geração preparada não é mais a desta reconstrução: os eventos
      // posteriores ao corte podem não tê-la alimentado. Recomeça.
      writeNewCheckpoint(transaction, ref, state, workspaceId, actorId, false,
        current.restarts + 1, "category_staging_changed");
      return {
        kind: "restarted" as const,
        reason: "category_staging_changed" as const,
      };
    }

    const events = summarizePostCutoffEvents(
      (await transaction.get(postCutoffEventsQuery(workspaceId, cutoff))).docs,
      cutoff,
    );
    if (events.restartReason) {
      writeNewCheckpoint(transaction, ref, state, workspaceId, actorId, false,
        current.restarts + 1, events.restartReason);
      return {kind: "restarted" as const, reason: events.restartReason};
    }
    const totals = cloneTotals(current.periods);
    for (const [period, delta] of Object.entries(events.deltas)) {
      addInto(totals, period, delta);
    }
    if (Object.keys(totals).length > MAX_CASH_PERIODS) {
      throw new ApplicationError(
        "domain_precondition_failed",
        "A reconstrução do fluxo de caixa excedeu 600 períodos mensais. " +
          "Nenhum dado foi truncado.",
      );
    }

    // Leitura limitada: 600 meses mais os dois checkpoints. Passar disso é
    // recusado, nunca truncado.
    const maxDocs = MAX_CASH_PERIODS + CASH_REBUILD_STATE_IDS.length;
    const existing = await transaction.get(
      db.collection(`workspaces/${workspaceId}/${CASH_PERIODS_COLLECTION}`)
        .limit(maxDocs + 1),
    );
    if (existing.size > maxDocs) {
      throw new ApplicationError(
        "domain_precondition_failed",
        "A projeção do fluxo de caixa excede 600 períodos mensais. " +
          "Nenhum dado foi alterado.",
      );
    }
    const existingPeriods = existing.docs
      .map((doc) => doc.id)
      .filter((id) => !isRebuildState(id));
    const known = new Set(existingPeriods);
    const fresh = Object.keys(totals).filter((period) => !known.has(period));
    if (fresh.length > 0) {
      // Meses ainda inexistentes também entram no conjunto lido: um gatilho
      // que os crie agora conflita com esta transação em vez de ser apagado.
      await transaction.getAll(
        ...fresh.map((period) => cashPeriodRef(workspaceId, period)),
      );
    }
    const days = await readMonthShards(
      (...refs) => transaction.getAll(...refs), workspaceId,
      current.rebuildId, Object.keys(totals),
    );
    for (const [period, eventDays] of Object.entries(events.dayDeltas)) {
      addDaysInto(days, period, eventDays);
    }
    const unbalanced = Object.keys(totals).filter((period) =>
      !cashDaysMatchMonth(days[period] ?? {}, totals[period]));
    const orphanDays = Object.keys(days).filter((period) =>
      !totals[period] && Object.keys(days[period]).length > 0);
    if (unbalanced.length > 0 || orphanDays.length > 0) {
      throw new ApplicationError(
        "internal",
        "A reconstrução do fluxo de caixa não fechou a soma diária com o " +
          "total do mês. Nenhum dado foi alterado.",
        {periods: [...unbalanced, ...orphanDays].slice(0, 12).join(",")},
      );
    }
    const orphans = existingPeriods.filter((period) => !totals[period]);
    const writes = Object.keys(totals).length + orphans.length + 2;
    if (writes > budget) {
      throw new ApplicationError(
        "domain_precondition_failed",
        "A publicação da reconstrução exigiria mais escritas do que um " +
          "commit atômico do Firestore permite. Nenhum dado foi alterado.",
        {requiredWrites: writes, writeLimit: budget},
      );
    }
    const monthDocs = Object.entries(totals).map(([period, periodTotals]) => ({
      period,
      data: {
        id: period,
        workspaceId,
        period,
        ...periodTotals,
        days: days[period] ?? {},
      },
    }));
    const bytes = monthDocs.reduce(
      (sum, doc) => sum + estimatedBytes(doc.data), 0);
    if (bytes > MAX_PUBLISH_BYTES) {
      throw new ApplicationError(
        "domain_precondition_failed",
        "A publicação da reconstrução excederia o tamanho de um commit " +
          "atômico do Firestore. Nenhum dado foi alterado.",
        {estimatedBytes: bytes, byteLimit: MAX_PUBLISH_BYTES},
      );
    }
    const garbage = [...state.categoryGarbage];
    if (
      state.categoryGeneration !== current.rebuildId &&
      !garbage.includes(state.categoryGeneration)
    ) {
      garbage.push(state.categoryGeneration);
    }
    if (garbage.length > MAX_CATEGORY_GARBAGE) {
      throw new ApplicationError(
        "domain_precondition_failed",
        CATEGORY_GARBAGE_FULL_MESSAGE,
      );
    }

    for (const {period, data} of monthDocs) {
      transaction.set(cashPeriodRef(workspaceId, period), {
        ...data,
        periodStart: Timestamp.fromDate(saoPauloMonthStart(period)),
        schemaVersion: CASH_PERIOD_SCHEMA_VERSION,
        rebuildId: current.rebuildId,
        rebuiltAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      });
    }
    // Órfãos: meses que existiam por uma execução anterior e não têm mais
    // lastro no ledger. Zerados com os dias, na versão atual.
    for (const period of orphans) {
      transaction.set(cashPeriodRef(workspaceId, period), {
        ...emptyTotals(),
        days: FieldValue.delete(),
        schemaVersion: CASH_PERIOD_SCHEMA_VERSION,
        rebuildId: current.rebuildId,
        rebuiltAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      }, {merge: true});
    }
    transaction.set(stateRef, {
      id: stateRef.id,
      workspaceId,
      kind: "cash_projection_state",
      baselineCutoff: cutoff,
      baselineRebuildId: current.rebuildId,
      // Resolve para o commit desta transação.
      lastPublishedAt: FieldValue.serverTimestamp(),
      // Só um corte que cubra o último incidente garante a projeção.
      needsRebuild: state.issueMaxEventTime !== null &&
        compareCommitTimes(state.issueMaxEventTime, cutoff) > 0,
      // P5-C1: a geração preparada passa a ser a vigente, no mesmo commit.
      categoryGeneration: current.rebuildId,
      categoryStaging: FieldValue.delete(),
      categoryGarbage: garbage,
      updatedAt: FieldValue.serverTimestamp(),
    }, {merge: true});
    transaction.delete(ref);
    await options.faults?.beforePublishCommit?.();
    return {
      kind: "published" as const,
      totals,
      orphans: orphans.length,
      postCutoffEvents: events.count,
    };
  });

  if (outcome.kind === "concurrent") {
    return {success: true, completed: false, dryRun: false, concurrent: true};
  }
  if (outcome.kind === "superseded") {
    return {success: true, completed: false, dryRun: false, superseded: true};
  }
  if (outcome.kind === "restarted") {
    return restartedResult(false, true, outcome.reason);
  }
  await bestEffort("published_shards", workspaceId,
    () => cleanupShards(workspaceId, checkpoint.rebuildId));
  // Sem TTL nas gerações descartadas: a limpeza continua aqui, em lotes,
  // até esvaziar ou atingir o teto da invocação (o resto sai nas próximas).
  await bestEffort("category_garbage_after", workspaceId, async () => {
    for (let batch = 0; batch < POST_PUBLISH_CLEANUP_BATCHES; batch += 1) {
      const {deleted, pending} = await cleanupCategoryGarbage(workspaceId);
      if (pending === 0 || deleted === 0) break;
    }
  });
  return {
    success: true,
    completed: true,
    dryRun: false,
    processed: checkpoint.processed,
    periods: Object.keys(outcome.totals).length,
    orphans: outcome.orphans,
    postCutoffEvents: outcome.postCutoffEvents,
    reconciliation: reconciliationOf(outcome.totals),
  };
};

const RATE_LIMIT = {
  operation: "rebuildCashPeriods",
  limit: 100,
  windowSeconds: 60 * 60,
};

/** Reconstrução é operação administrativa do workspace. */
export const CASH_REBUILD_ROLES: readonly WorkspaceRole[] = ["owner", "admin"];

/** Com `workspaceRoles`, o kernel sempre entrega o ator resolvido. */
const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new Error("cash_rebuild_without_actor");
  return actor;
};

export const rebuildCashPeriods = defineCallable({
  operation: RATE_LIMIT.operation,
  schema: payloadSchema,
  runtime: HEAVY_CALLABLE_OPTIONS,
  workspaceRoles: CASH_REBUILD_ROLES,
  handler: async ({actor: resolved, payload}) => {
    const actor = requireActor(resolved);
    await admin.firestore().runTransaction(async (transaction) => {
      // Autorização relida na fase de leitura, antes de consumir o limite:
      // quem foi removido ou rebaixado depois da pré-checagem não reconstrói.
      await reassertWorkspaceActor(transaction, actor);
      const reservation = await reserveRateLimit(
        transaction,
        actor.workspaceId,
        actor.uid,
        RATE_LIMIT,
      );
      reservation.commit();
    });
    return executeRebuildCashPeriods(actor.workspaceId, actor.uid, payload);
  },
});
