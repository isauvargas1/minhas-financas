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
  CASH_DELTA_FIELDS,
  CASH_PERIODS_COLLECTION,
  CASH_PERIOD_EVENTS_COLLECTION,
  CASH_PERIOD_SCHEMA_VERSION,
  addCashPeriodDelta,
  cashPeriodDeltaFor,
  cashPeriodKeyFor,
  cashPeriodRef,
  cashProjectionStateRef,
  compareCommitTimes,
  emptyCashPeriodDelta,
  normalizeCashPeriodDelta,
  readCashProjectionState,
  type CashPeriodDelta,
} from "./periods";
import {saoPauloMonthStart} from "../shared/dateKeys";

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
 * `listCashPeriods` no cliente já descarta o de execução real pelo ID; a
 * simulação acrescenta um segundo, e ambos precisam ficar de fora de qualquer
 * soma de saldo. Nenhum deles tem `periodStart`, então também não entram na
 * consulta ordenada do cliente.
 */
export const CASH_REBUILD_STATE_IDS = [
  REBUILD_STATE_ID,
  DRY_RUN_STATE_ID,
] as const;

const isRebuildState = (id: string): boolean =>
  (CASH_REBUILD_STATE_IDS as readonly string[]).includes(id);

/** Teto de períodos: o acumulado vive num documento de até 1 MiB. */
export const MAX_CASH_PERIODS = 600;

/**
 * Escritas de um commit do Firestore (transação ou lote): 500.
 *
 * A publicação grava os meses, zera os órfãos, atualiza o estado e apaga o
 * checkpoint num **único** commit — dividir em lotes deixaria o painel ver um
 * saldo intermediário. Acima do teto, recusa antes de escrever qualquer coisa.
 */
export const FIRESTORE_MAX_WRITES_PER_COMMIT = 500;

/** Eventos posteriores ao corte que uma publicação soma (leituras). */
export const MAX_POST_CUTOFF_EVENTS = 200;

/**
 * Idade máxima de uma reconstrução em andamento: depois disso recomeça.
 *
 * As marcas de entrega que a publicação soma expiram em 90 dias; uma janela
 * curta mantém poucas marcas para ler e afasta qualquer risco de TTL.
 */
export const MAX_REBUILD_AGE_SECONDS = 24 * 60 * 60;

export type RebuildRestartReason =
  | "ledger_changed_during_rebuild"
  | "delete_during_rebuild"
  | "too_many_concurrent_changes"
  | "stale_checkpoint";

interface Checkpoint {
  rebuildId: string;
  cutoff: Timestamp;
  cursor: string | null;
  processed: number;
  periods: Record<string, CashPeriodDelta>;
  restarts: number;
}

const readCheckpoint = (
  snapshot: admin.firestore.DocumentSnapshot,
): Checkpoint | null => {
  const data = snapshot.data();
  if (
    !data ||
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
  };
};

const isStale = (checkpoint: Checkpoint): boolean =>
  Date.now() - checkpoint.cutoff.toMillis() > MAX_REBUILD_AGE_SECONDS * 1000;

/** Checkpoint novo: o corte é o commit desta própria escrita. */
const newCheckpointData = (
  workspaceId: string,
  actorId: string,
  dryRun: boolean,
  restarts: number,
  reason: RebuildRestartReason | null,
): admin.firestore.DocumentData => ({
  id: dryRun ? DRY_RUN_STATE_ID : REBUILD_STATE_ID,
  workspaceId,
  kind: "cash_periods_rebuild",
  dryRun,
  status: "running",
  rebuildId: randomUUID(),
  cutoff: FieldValue.serverTimestamp(),
  cursor: null,
  processed: 0,
  periods: {},
  restarts,
  lastRestartReason: reason,
  updatedAt: FieldValue.serverTimestamp(),
  updatedBy: actorId,
});

/**
 * Checkpoint em andamento, ou um novo. Checkpoint anterior à cerca (sem
 * `rebuildId`/`cutoff`) ou velho demais é substituído: recomeçar é seguro,
 * porque nada é publicado antes da última página.
 */
const ensureCheckpoint = async (
  ref: admin.firestore.DocumentReference,
  workspaceId: string,
  actorId: string,
  dryRun: boolean,
): Promise<Checkpoint> => {
  await admin.firestore().runTransaction(async (transaction) => {
    const current = readCheckpoint(await transaction.get(ref));
    if (current && !isStale(current)) return;
    transaction.set(ref, newCheckpointData(
      workspaceId,
      actorId,
      dryRun,
      current ? current.restarts + 1 : 0,
      current ? "stale_checkpoint" : null,
    ));
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
    const current = readCheckpoint(await transaction.get(ref));
    if (!sameCheckpoint(current, expected)) return false;
    transaction.set(ref, newCheckpointData(
      workspaceId,
      actorId,
      dryRun,
      current.restarts + 1,
      reason,
    ));
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

const DIVERGENCE_SAMPLE_LIMIT = 24;

const DELTA_FIELDS = CASH_DELTA_FIELDS;

const storedTotalsOf = (
  data: admin.firestore.DocumentData,
): CashPeriodDelta => normalizeCashPeriodDelta(data);

/**
 * Divergência entre a projeção gravada e a reconstruída do ledger (P3-F).
 *
 * É o procedimento de reconciliação da simulação: depois da mudança de regra
 * de D-29 (pendente e agendado não movem o caixa realizado), uma projeção
 * produzida pela regra anterior aparece aqui, mês a mês, antes de qualquer
 * publicação. Leitura limitada aos 600 meses mais os dois checkpoints; acima
 * disso, recusa, nunca trunca. Retrato da simulação, sem trava: uma entrega
 * concorrente do gatilho pode aparecer como divergência transitória.
 */
const divergenceOf = async (
  workspaceId: string,
  rebuilt: Record<string, CashPeriodDelta>,
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
  for (const doc of stored.docs) {
    if (isRebuildState(doc.id)) continue;
    storedByPeriod[doc.id] = storedTotalsOf(doc.data());
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
  }
  return {
    divergentPeriods,
    storedNetCents,
    rebuiltNetCents,
    netDifferenceCents: storedNetCents - rebuiltNetCents,
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
  restartReason: RebuildRestartReason | null;
}

/**
 * Deltas dos eventos posteriores ao corte que o gatilho já aplicou.
 *
 * - Mais eventos do que o teto: recomeça (muitas mudanças concorrentes).
 * - Exclusão de documento que existia no corte: recomeça (ambígua).
 * - Só as marcas `applied` somam; as demais não moveram a projeção.
 */
const summarizePostCutoffEvents = (
  docs: admin.firestore.QueryDocumentSnapshot[],
  cutoff: Timestamp,
): PostCutoffSummary => {
  const summary: PostCutoffSummary = {
    count: docs.length,
    deltas: {},
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

export const executeRebuildCashPeriods = async (
  workspaceId: string,
  actorId: string,
  payload: Payload,
  options: RebuildOptions = {},
): Promise<Record<string, unknown>> => {
  const db = admin.firestore();
  const ref = rebuildStateRef(workspaceId, payload.dryRun);
  const checkpoint = await ensureCheckpoint(
    ref,
    workspaceId,
    actorId,
    payload.dryRun,
  );
  const {cutoff} = checkpoint;

  let query = db
    .collection(`workspaces/${workspaceId}/transactions`)
    .orderBy(FieldPath.documentId())
    .limit(payload.pageSize);
  if (checkpoint.cursor) query = query.startAfter(checkpoint.cursor);
  const page = await query.get();
  await options.faults?.afterPageRead?.();

  const accumulated = cloneTotals(checkpoint.periods);
  let skippedAfterCutoff = 0;
  for (const entry of page.docs) {
    if (compareCommitTimes(entry.createTime, cutoff) > 0) {
      // Criado depois do corte: entra pelo gatilho, como evento posterior.
      skippedAfterCutoff += 1;
      continue;
    }
    if (compareCommitTimes(entry.updateTime, cutoff) > 0) {
      // Mudou depois do corte e o estado no corte não pode mais ser lido.
      const reason = "ledger_changed_during_rebuild";
      const restarted = await restartCheckpoint(
        ref, checkpoint, workspaceId, actorId, payload.dryRun, reason,
      );
      return restartedResult(payload.dryRun, restarted, reason);
    }
    const period = cashPeriodKeyFor(entry.data());
    if (!period) continue;
    addInto(accumulated, period, cashPeriodDeltaFor(entry.data()));
  }

  // Teto explícito: a acumulação vive num documento, que tem limite de 1 MiB.
  // Um workspace com mais de 600 meses de histórico é impossível na prática;
  // atingir o teto é erro nomeado, nunca truncamento silencioso.
  if (Object.keys(accumulated).length > MAX_CASH_PERIODS) {
    throw new ApplicationError(
      "domain_precondition_failed",
      "A reconstrução do fluxo de caixa excedeu 600 períodos mensais. " +
        "Nenhum dado foi truncado.",
    );
  }

  const completed = page.size < payload.pageSize;
  const lastId = page.docs[page.docs.length - 1]?.id;
  const processed = checkpoint.processed + page.size;

  if (!completed) {
    const advanced = await db.runTransaction(async (transaction) => {
      const current = readCheckpoint(await transaction.get(ref));
      if (!sameCheckpoint(current, checkpoint)) return false;
      transaction.update(ref, {
        cursor: lastId ?? checkpoint.cursor,
        processed,
        periods: accumulated,
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
    return {
      success: true,
      completed: false,
      dryRun: payload.dryRun,
      processed,
      periods: Object.keys(accumulated).length,
      skippedAfterCutoff,
    };
  }

  /*
   * Simulação concluída: devolve a conferência do que a publicação gravaria
   * agora (base no corte + eventos posteriores já aplicados) e **não**
   * publica nada. Usa checkpoint próprio e nunca toca nos períodos nem no
   * estado da projeção.
   */
  if (payload.dryRun) {
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
    const totals = cloneTotals(accumulated);
    for (const [period, delta] of Object.entries(events.deltas)) {
      addInto(totals, period, delta);
    }
    const divergence = await divergenceOf(workspaceId, totals);
    const finished = await db.runTransaction(async (transaction) => {
      const current = readCheckpoint(await transaction.get(ref));
      if (!sameCheckpoint(current, checkpoint)) return false;
      transaction.delete(ref);
      return true;
    });
    if (!finished) {
      return {success: true, completed: false, dryRun: true, concurrent: true};
    }
    return {
      success: true,
      completed: true,
      dryRun: true,
      processed,
      periods: Object.keys(totals).length,
      postCutoffEvents: events.count,
      reconciliation: reconciliationOf(totals),
      divergence,
    };
  }

  return publishRebuild(
    workspaceId,
    actorId,
    checkpoint,
    accumulated,
    processed,
    options,
  );
};

/**
 * Publicação atômica da reconstrução (última página).
 *
 * Uma transação lê o checkpoint, o estado da projeção, as marcas posteriores
 * ao corte e **todos** os meses que vai gravar (os existentes pela consulta da
 * coleção, os novos por leitura direta), e só então escreve. Por isso uma
 * entrega concorrente do gatilho, que lê o estado e escreve meses, fica
 * serializada antes (e a publicação soma a marca dela) ou depois (e ela se
 * soma sobre a base publicada), nunca no meio.
 *
 * Recusa explícita, sem nenhuma escrita, quando a publicação passaria do teto
 * de um commit atômico.
 */
const publishRebuild = async (
  workspaceId: string,
  actorId: string,
  checkpoint: Checkpoint,
  accumulated: Record<string, CashPeriodDelta>,
  processed: number,
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
    if (!sameCheckpoint(current, checkpoint)) {
      return {kind: "concurrent" as const};
    }
    const state = readCashProjectionState(stateSnapshot);
    if (
      state.baselineCutoff &&
      compareCommitTimes(state.baselineCutoff, cutoff) >= 0
    ) {
      // Uma reconstrução com corte igual ou mais novo já publicou: publicar
      // esta regrediria a base.
      transaction.delete(ref);
      return {kind: "superseded" as const};
    }

    const events = summarizePostCutoffEvents(
      (await transaction.get(postCutoffEventsQuery(workspaceId, cutoff))).docs,
      cutoff,
    );
    if (events.restartReason) {
      transaction.set(ref, newCheckpointData(
        workspaceId,
        actorId,
        false,
        current.restarts + 1,
        events.restartReason,
      ));
      return {kind: "restarted" as const, reason: events.restartReason};
    }
    const totals = cloneTotals(accumulated);
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

    for (const [period, periodTotals] of Object.entries(totals)) {
      transaction.set(cashPeriodRef(workspaceId, period), {
        id: period,
        workspaceId,
        period,
        periodStart: Timestamp.fromDate(saoPauloMonthStart(period)),
        ...periodTotals,
        schemaVersion: CASH_PERIOD_SCHEMA_VERSION,
        rebuildId: checkpoint.rebuildId,
        rebuiltAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: actorId,
      });
    }
    // Órfãos: meses que existiam por uma execução anterior e não têm mais
    // lastro no ledger.
    for (const period of orphans) {
      transaction.set(cashPeriodRef(workspaceId, period), {
        ...emptyTotals(),
        rebuildId: checkpoint.rebuildId,
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
      baselineRebuildId: checkpoint.rebuildId,
      // Resolve para o commit desta transação.
      lastPublishedAt: FieldValue.serverTimestamp(),
      // Só um corte que cubra o último incidente garante a projeção.
      needsRebuild: state.issueMaxEventTime !== null &&
        compareCommitTimes(state.issueMaxEventTime, cutoff) > 0,
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
  return {
    success: true,
    completed: true,
    dryRun: false,
    processed,
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
