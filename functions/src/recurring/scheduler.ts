import * as admin from "firebase-admin";
import {FieldPath} from "firebase-admin/firestore";

import {saoPauloDayKey} from "../shared/dateKeys";
import {createOperationLogger} from "../shared/logger";
import {
  RECURRING_GENERATION_OPERATION,
  processDueOccurrence,
} from "./generation";
import {
  RECURRING_EXPENSES_COLLECTION,
  RECURRING_SCHEMA_VERSION,
} from "./model";

/**
 * Geração diária das ocorrências recorrentes (P4-B, D-12, PR-REC-01).
 *
 * Lê **só** os contratos com vencimento alcançado:
 *
 *   collectionGroup("recurring_expenses")
 *     where schemaVersion == 1, status == "active", nextDueDate <= hoje
 *     orderBy nextDueDate, __name__   (índice de grupo declarado)
 *
 * com cursor estável (`startAfter` no último documento da página), páginas
 * de 200 e até 25 páginas por execução. Cada contrato processa até
 * `RECURRING_MAX_DUE_PER_CONTRACT` vencimentos por execução (recuperação de
 * execuções perdidas, do mais antigo para o mais novo), um por transação,
 * relendo o contrato a cada passo; o que sobrar — páginas além do teto,
 * vencimentos além do teto por contrato ou por workspace — fica para a
 * próxima execução, que retoma de forma determinística pelo próprio
 * `nextDueDate` (`truncated` e `backlog`, nunca corte silencioso).
 *
 * Limites operacionais (a geração não consome a quota `transactionsPerMonth`,
 * D-40): vencimentos por contrato e por workspace em cada execução.
 *
 * Métricas no log, sem PII: contagens, códigos de atenção e corte.
 */
export const RECURRING_PAGE_SIZE = 200;
export const RECURRING_MAX_PAGES = 25;
export const RECURRING_MAX_DUE_PER_CONTRACT = 12;
export const RECURRING_MAX_DUE_PER_WORKSPACE = 500;

export interface RecurringGenerationSummary {
  today: string;
  scanned: number;
  processed: number;
  generated: number;
  awaitingConfirmation: number;
  attentionRequired: number;
  ended: number;
  skipped: number;
  failed: number;
  /** Contratos que ainda têm vencimento alcançado ao fim da execução. */
  backlog: number;
  truncated: boolean;
  attentionCodes: Record<string, number>;
}

/** Resumo achatado para o log (códigos de atenção como contagens). */
const logFieldsOf = (summary: RecurringGenerationSummary) => {
  const {attentionCodes, ...counts} = summary;
  const fields: Record<string, string | number | boolean> = {...counts};
  for (const [code, count] of Object.entries(attentionCodes)) {
    fields[`attention_${code}`] = count;
  }
  return fields;
};

export const runRecurringGeneration = async (options: {
  today?: string;
  pageSize?: number;
  maxPages?: number;
  maxDuePerContract?: number;
  maxDuePerWorkspace?: number;
  requestId?: string;
  /** Só para os testes: falha com as escritas enfileiradas, antes do commit. */
  beforeCommit?: () => void;
} = {}): Promise<RecurringGenerationSummary> => {
  const today = options.today ?? saoPauloDayKey();
  const pageSize = options.pageSize ?? RECURRING_PAGE_SIZE;
  const maxPages = options.maxPages ?? RECURRING_MAX_PAGES;
  const maxDuePerContract =
    options.maxDuePerContract ?? RECURRING_MAX_DUE_PER_CONTRACT;
  const maxDuePerWorkspace =
    options.maxDuePerWorkspace ?? RECURRING_MAX_DUE_PER_WORKSPACE;
  const requestId = options.requestId ?? `recurring-generation-${today}`;
  const log = createOperationLogger({
    operation: RECURRING_GENERATION_OPERATION,
    requestId,
  });
  const summary: RecurringGenerationSummary = {
    today,
    scanned: 0,
    processed: 0,
    generated: 0,
    awaitingConfirmation: 0,
    attentionRequired: 0,
    ended: 0,
    skipped: 0,
    failed: 0,
    backlog: 0,
    truncated: true,
    attentionCodes: {},
  };
  const perWorkspace = new Map<string, number>();
  // Um contrato que ainda tem vencimento alcançado depois do teto reaparece
  // adiante na mesma varredura (o `nextDueDate` dele avançou): é atendido
  // uma vez por execução.
  const visited = new Set<string>();
  let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    let query = admin.firestore()
      .collectionGroup(RECURRING_EXPENSES_COLLECTION)
      .where("schemaVersion", "==", RECURRING_SCHEMA_VERSION)
      .where("status", "==", "active")
      .where("nextDueDate", "<=", today)
      .orderBy("nextDueDate", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      if (visited.has(doc.ref.path)) continue;
      visited.add(doc.ref.path);
      summary.scanned += 1;
      const workspaceId = doc.ref.parent.parent?.id ?? "";
      let expected = doc.get("nextDueDate") as string | null;
      let steps = 0;
      try {
        while (expected !== null && expected <= today) {
          const used = perWorkspace.get(workspaceId) ?? 0;
          if (steps >= maxDuePerContract || used >= maxDuePerWorkspace) {
            summary.backlog += 1;
            break;
          }
          const outcome = await processDueOccurrence(doc.ref, expected, today,
            requestId, {beforeCommit: options.beforeCommit});
          if (outcome.status === "skipped") {
            summary.skipped += 1;
            break;
          }
          steps += 1;
          perWorkspace.set(workspaceId, used + 1);
          summary.processed += 1;
          if (outcome.occurrenceStatus === "generated") summary.generated += 1;
          if (outcome.occurrenceStatus === "awaiting_confirmation") {
            summary.awaitingConfirmation += 1;
          }
          if (outcome.occurrenceStatus === "attention_required") {
            summary.attentionRequired += 1;
            const code = outcome.attentionCode ?? "unknown";
            summary.attentionCodes[code] =
              (summary.attentionCodes[code] ?? 0) + 1;
          }
          if (outcome.ended) summary.ended += 1;
          expected = outcome.nextDueDate;
        }
      } catch (error) {
        summary.failed += 1;
        // Só identificadores: nada de nome, descrição ou valor no log.
        log.error("recurring_due_failed", error, {
          workspaceId: workspaceId || null,
          recurringExpenseId: doc.id,
        });
      }
    }
    if (snapshot.size < pageSize) {
      summary.truncated = false;
      break;
    }
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
  if (
    summary.failed > 0 ||
    summary.attentionRequired > 0 ||
    summary.backlog > 0 ||
    summary.truncated
  ) {
    log.warn("recurring_generation_attention", logFieldsOf(summary));
  }
  log.info("recurring_generation_completed", logFieldsOf(summary));
  return summary;
};
