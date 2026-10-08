import * as admin from "firebase-admin";
import {FieldPath, FieldValue} from "firebase-admin/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";

import {saoPauloDayKey} from "../shared/dateKeys";
import {createOperationLogger} from "../shared/logger";
import {SCHEDULED_FUNCTION_OPTIONS} from "../shared/runtimeOptions";
import {
  LOANS_COLLECTION,
  LOAN_SCHEMA_VERSION,
  LOAN_STATUS_SYSTEM_ACTOR,
  appendLoanEvent,
  financialSnapshot,
  readAuthoritativeLoan,
} from "./model";
import {deriveLoanStatus} from "./schedule";

/**
 * Atualização temporal do atraso de empréstimos (D-13, P3-G).
 *
 * O status é derivado em toda operação; sem operação, a passagem do tempo
 * precisa marcar `overdue`. Cada contrato autoritativo ativo guarda
 * `overdueFrom` (primeiro dia em atraso se nada mais for pago), então a
 * rotina lê **só** os contratos que já deveriam estar em atraso:
 *
 *   collectionGroup("loans")
 *     where schemaVersion == 1, status == "active", overdueFrom <= hoje
 *     orderBy overdueFrom, __name__   (índice de grupo declarado)
 *
 * Paginada por cursor (200 por página, até 25 páginas por execução); o que
 * sobrar fica para a execução seguinte (`truncated`). Cada contrato é
 * reavaliado numa transação que relê o documento e só escreve se o status
 * derivado mudou — idempotente: reexecutar no mesmo dia não grava nada. O
 * evento `loan.status_refreshed` tem ID derivado da revisão, então uma
 * repetição da mesma transação não duplica a trilha. Legado (sem
 * `schemaVersion`) nunca entra na consulta.
 */
export const LOAN_STATUS_PAGE_SIZE = 200;
export const LOAN_STATUS_MAX_PAGES = 25;

export interface LoanStatusRefreshSummary {
  today: string;
  scanned: number;
  updated: number;
  unchanged: number;
  failed: number;
  truncated: boolean;
}

const refreshOne = async (
  ref: admin.firestore.DocumentReference,
  today: string,
  requestId: string,
): Promise<boolean> => {
  const workspaceId = ref.parent.parent?.id;
  if (!workspaceId) return false;
  return admin.firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const loan = readAuthoritativeLoan(ref.id, snapshot.data(), workspaceId);
    if (!loan || loan.status !== "active") return false;
    const derived = deriveLoanStatus({
      cancelled: false,
      balanceCents: loan.balanceCents,
      totalPrincipalSettledCents: loan.totalPrincipalSettledCents,
      schedule: loan.schedule,
      today,
    });
    if (
      derived.status === loan.status &&
      derived.overdueFrom === loan.overdueFrom
    ) {
      return false;
    }
    const revision = loan.revision + 1;
    const before = {
      principalCents: loan.principalCents,
      balanceCents: loan.balanceCents,
      totalPrincipalSettledCents: loan.totalPrincipalSettledCents,
      totalInterestSettledCents: loan.totalInterestSettledCents,
      activePaymentCount: loan.activePaymentCount,
      status: loan.status,
    };
    transaction.update(ref, {
      status: derived.status,
      overdueFrom: derived.overdueFrom,
      revision,
      updatedBy: LOAN_STATUS_SYSTEM_ACTOR,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendLoanEvent(transaction, {
      workspaceId,
      loanId: loan.id,
      operation: "loan.status_refreshed",
      targetKey: `${loan.id}:${revision}`,
      actorId: LOAN_STATUS_SYSTEM_ACTOR,
      actorRole: null,
      profileType: loan.profileType,
      intentId: null,
      requestHash: null,
      requestId,
      correlationId: null,
      movementId: null,
      before: financialSnapshot(before),
      after: financialSnapshot({...before, status: derived.status}),
      reason: null,
      revision,
    });
    return true;
  });
};

export const runLoanStatusRefresh = async (options: {
  today?: string;
  pageSize?: number;
  maxPages?: number;
  requestId?: string;
} = {}): Promise<LoanStatusRefreshSummary> => {
  const today = options.today ?? saoPauloDayKey();
  const pageSize = options.pageSize ?? LOAN_STATUS_PAGE_SIZE;
  const maxPages = options.maxPages ?? LOAN_STATUS_MAX_PAGES;
  const requestId = options.requestId ?? `loan-status-${today}`;
  const log = createOperationLogger({operation: "processLoanStatusRefresh"});
  const summary: LoanStatusRefreshSummary = {
    today, scanned: 0, updated: 0, unchanged: 0, failed: 0, truncated: true,
  };
  let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    let query = admin.firestore()
      .collectionGroup(LOANS_COLLECTION)
      .where("schemaVersion", "==", LOAN_SCHEMA_VERSION)
      .where("status", "==", "active")
      .where("overdueFrom", "<=", today)
      .orderBy("overdueFrom", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      summary.scanned += 1;
      try {
        if (await refreshOne(doc.ref, today, requestId)) summary.updated += 1;
        else summary.unchanged += 1;
      } catch (error) {
        summary.failed += 1;
        // Só identificadores: nada da contraparte entra no log.
        log.error("loan_status_refresh_failed", error, {
          workspaceId: doc.ref.parent.parent?.id ?? null,
          loanId: doc.id,
        });
      }
    }
    if (snapshot.size < pageSize) {
      summary.truncated = false;
      break;
    }
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
  log.info("loan_status_refresh_completed", {...summary});
  return summary;
};

export const processLoanStatusRefresh = onSchedule(
  {
    ...SCHEDULED_FUNCTION_OPTIONS,
    schedule: "every day 06:30",
    timeZone: "America/Sao_Paulo",
  },
  async () => {
    await runLoanStatusRefresh();
  },
);
