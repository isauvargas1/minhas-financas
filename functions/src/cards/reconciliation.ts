import * as admin from "firebase-admin";
import {AggregateField} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import {createOperationLogger} from "../shared/logger";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import {
  CARD_ADMIN_ROLES,
  CARD_INCONSISTENT_MESSAGE,
  CARD_NOT_FOUND_MESSAGE,
  CARD_RECONCILIATION_RATE_LIMIT,
  INVOICE_INCONSISTENT_MESSAGE,
  reserveCardRateLimit,
} from "./common";
import type {
  RebuildCardInvoicesPayload,
  RecalculateCardLimitPayload,
} from "./contracts";
import {readInvoiceEntryTotals} from "./invoices";
import {
  appendCardEvent,
  cardLimitPatch,
  cardLimitSnapshot,
  cardsRef,
  entriesRef,
  invoiceSnapshot,
  invoiceStatePatch,
  invoicesRef,
  limitLedgerRef,
  paymentsRef,
  readAuthoritativeCard,
  readAuthoritativeInvoice,
  type AuthoritativeCard,
  type InvoiceFinancialState,
} from "./model";

/**
 * Reconciliação do domínio de cartões (P4-A). Só backend, só owner/admin,
 * idempotente: as fontes são os fatos imutáveis (lançamentos, pagamentos e o
 * livro do limite); o que se repara são apenas campos derivados.
 *
 * - `recalculateCardLimit`: o limite usado tem duas reconstruções
 *   independentes — a soma do livro do limite e a soma dos lançamentos ativos
 *   menos os pagamentos líquidos. Se as duas concordam e o cartão diverge, o
 *   derivado é reparado (com evento); se as duas discordam entre si, nada é
 *   alterado: o relatório e o log apontam a divergência para incidente.
 * - `rebuildCardInvoicesForCard`: paginado por competência; recalcula total,
 *   pago e quantidade de cada fatura pela soma dos fatos. Fatura aberta com
 *   derivado divergente é reparada; fatura fechada nunca é reescrita — a
 *   divergência só é relatada.
 */
export const RECALCULATE_CARD_LIMIT_OPERATION = "recalculateCardLimit";
export const REBUILD_CARD_INVOICES_OPERATION = "rebuildCardInvoicesForCard";
export const REBUILD_INVOICES_DEFAULT_PAGE_SIZE = 25;

const db = () => admin.firestore();

const sumOf = async (
  transaction: admin.firestore.Transaction,
  query: admin.firestore.Query,
): Promise<number> => {
  const snapshot = await transaction.get(
    query.aggregate({total: AggregateField.sum("amountCents")}));
  const total = snapshot.data().total ?? 0;
  if (!Number.isSafeInteger(total)) {
    throw new ApplicationError("internal", CARD_INCONSISTENT_MESSAGE);
  }
  return total || 0;
};

const readCardOrFail = (
  snapshot: admin.firestore.DocumentSnapshot,
  workspaceId: string,
): AuthoritativeCard => {
  if (!snapshot.exists) {
    throw new ApplicationError("not_found", CARD_NOT_FOUND_MESSAGE);
  }
  const card = readAuthoritativeCard(snapshot.id, snapshot.data(), workspaceId);
  if (!card) {
    throw new ApplicationError("domain_precondition_failed",
      CARD_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
  }
  return card;
};

export interface CardLimitReport {
  cardId: string;
  storedLimitUsedCents: number;
  ledgerLimitUsedCents: number;
  factsLimitUsedCents: number;
  sourcesAgree: boolean;
  consistent: boolean;
  repaired: boolean;
}

export const executeRecalculateCardLimit = async (
  actor: WorkspaceActor,
  payload: RecalculateCardLimitPayload,
  requestId: string,
): Promise<CardLimitReport> => {
  const log = createOperationLogger({
    operation: RECALCULATE_CARD_LIMIT_OPERATION,
    workspaceId: actor.workspaceId,
    cardId: payload.cardId,
    requestId,
  });
  const report = await db().runTransaction(async (transaction) => {
    const {role} = await reassertWorkspaceActor(
      transaction, actor, CARD_ADMIN_ROLES);
    const cardRef = cardsRef(actor.workspaceId).doc(payload.cardId);
    const card = readCardOrFail(await transaction.get(cardRef),
      actor.workspaceId);
    const ledger = await sumOf(transaction,
      limitLedgerRef(actor.workspaceId).where("cardId", "==", card.id));
    const entries = await sumOf(transaction,
      entriesRef(actor.workspaceId)
        .where("cardId", "==", card.id)
        .where("status", "==", "active"));
    const payments = await sumOf(transaction,
      paymentsRef(actor.workspaceId)
        .where("cardId", "==", card.id)
        .where("kind", "==", "payment"));
    const reversals = await sumOf(transaction,
      paymentsRef(actor.workspaceId)
        .where("cardId", "==", card.id)
        .where("kind", "==", "reversal"));
    const facts = entries - (payments - reversals);
    const rateLimit = await reserveCardRateLimit(transaction, actor,
      CARD_RECONCILIATION_RATE_LIMIT);
    const sourcesAgree = ledger === facts;
    const consistent = sourcesAgree && card.limitUsedCents === ledger;
    const repaired = sourcesAgree && !consistent;
    if (repaired) {
      transaction.update(cardRef, cardLimitPatch(card, ledger));
    }
    if (!consistent) {
      appendCardEvent(transaction, {
        workspaceId: actor.workspaceId,
        cardId: card.id,
        operation: "credit_card.limit_recalculated",
        targetKey: requestId,
        actorId: actor.uid,
        actorRole: role,
        intentId: null,
        requestHash: null,
        requestId,
        correlationId: payload.correlationId ?? null,
        amountCents: repaired ? ledger - card.limitUsedCents : null,
        before: cardLimitSnapshot(card),
        after: {
          ...cardLimitSnapshot(repaired ?
            {...card, limitUsedCents: ledger} : card),
          ledgerLimitUsedCents: ledger,
          factsLimitUsedCents: facts,
          outcome: repaired ? "repaired" : "sources_diverge",
        },
      });
    }
    rateLimit.commit();
    return {
      cardId: card.id,
      storedLimitUsedCents: card.limitUsedCents,
      ledgerLimitUsedCents: ledger,
      factsLimitUsedCents: facts,
      sourcesAgree,
      consistent,
      repaired,
    };
  });
  if (!report.sourcesAgree) {
    log.error("credit_card_limit_sources_diverge", null, {
      ledgerLimitUsedCents: report.ledgerLimitUsedCents,
      factsLimitUsedCents: report.factsLimitUsedCents,
    });
  } else if (report.repaired) {
    log.warn("credit_card_limit_repaired", {
      storedLimitUsedCents: report.storedLimitUsedCents,
      ledgerLimitUsedCents: report.ledgerLimitUsedCents,
    });
  }
  log.info("credit_card_limit_recalculated", {
    consistent: report.consistent,
    repaired: report.repaired,
  });
  return report;
};

// ------------------------------------------------------- reconstrução

export type InvoiceRebuildStatus = "consistent" | "repaired" | "divergent";

export interface InvoiceRebuildItem {
  invoiceId: string;
  competenceMonth: string;
  cycleStatus: string;
  status: InvoiceRebuildStatus;
  stored: {totalCents: number; paidCents: number; activeEntryCount: number};
  recomputed: {totalCents: number; paidCents: number; activeEntryCount: number};
}

export interface InvoiceRebuildReport {
  cardId: string;
  processed: number;
  consistent: number;
  repaired: number;
  divergent: number;
  items: InvoiceRebuildItem[];
  /** Próxima página (competência exclusiva) ou `null` no fim. */
  nextCursor: string | null;
}

const rebuildOne = async (
  actor: WorkspaceActor,
  ref: admin.firestore.DocumentReference,
  cardId: string,
  requestId: string,
  correlationId: string | null,
): Promise<InvoiceRebuildItem> =>
  db().runTransaction(async (transaction) => {
    const {role} = await reassertWorkspaceActor(
      transaction, actor, CARD_ADMIN_ROLES);
    const snapshot = await transaction.get(ref);
    const invoice = readAuthoritativeInvoice(
      snapshot.id, snapshot.data(), actor.workspaceId);
    if (!invoice || invoice.cardId !== cardId) {
      throw new ApplicationError("domain_precondition_failed",
        INVOICE_INCONSISTENT_MESSAGE, {ineligible: "inconsistent"});
    }
    const totals = await readInvoiceEntryTotals(
      transaction, actor.workspaceId, invoice.id);
    const paid = await sumOf(transaction,
      paymentsRef(actor.workspaceId)
        .where("invoiceId", "==", invoice.id)
        .where("kind", "==", "payment"));
    const reversed = await sumOf(transaction,
      paymentsRef(actor.workspaceId)
        .where("invoiceId", "==", invoice.id)
        .where("kind", "==", "reversal"));
    const stored = {
      totalCents: invoice.totalCents,
      paidCents: invoice.paidCents,
      activeEntryCount: invoice.activeEntryCount,
    };
    const recomputed = {
      totalCents: totals.totalCents,
      paidCents: paid - reversed,
      activeEntryCount: totals.count,
    };
    const base = {
      invoiceId: invoice.id,
      competenceMonth: invoice.competenceMonth,
      cycleStatus: invoice.cycleStatus,
      stored,
      recomputed,
    };
    if (
      stored.totalCents === recomputed.totalCents &&
      stored.paidCents === recomputed.paidCents &&
      stored.activeEntryCount === recomputed.activeEntryCount
    ) {
      return {...base, status: "consistent" as const};
    }
    // Fatura fechada nunca é reescrita: a divergência vai para o relatório.
    if (invoice.cycleStatus === "closed" || recomputed.paidCents !== 0) {
      return {...base, status: "divergent" as const};
    }
    const before: InvoiceFinancialState = {
      cycleStatus: invoice.cycleStatus,
      ...stored,
    };
    const after: InvoiceFinancialState = {
      cycleStatus: invoice.cycleStatus,
      ...recomputed,
    };
    transaction.update(ref, invoiceStatePatch(after, invoice.revision + 1));
    appendCardEvent(transaction, {
      workspaceId: actor.workspaceId,
      cardId,
      operation: "credit_card.invoice_rebuilt",
      targetKey: `${invoice.id}:${invoice.revision}`,
      actorId: actor.uid,
      actorRole: role,
      intentId: null,
      requestHash: null,
      requestId,
      correlationId,
      invoiceId: invoice.id,
      amountCents: recomputed.totalCents - stored.totalCents,
      before: invoiceSnapshot(before),
      after: invoiceSnapshot(after),
    });
    return {...base, status: "repaired" as const};
  });

export const executeRebuildCardInvoices = async (
  actor: WorkspaceActor,
  payload: RebuildCardInvoicesPayload,
  requestId: string,
): Promise<InvoiceRebuildReport> => {
  const log = createOperationLogger({
    operation: REBUILD_CARD_INVOICES_OPERATION,
    workspaceId: actor.workspaceId,
    cardId: payload.cardId,
    requestId,
  });
  // Autorização, cartão e limite operacional numa transação curta; cada
  // fatura é recalculada na sua própria transação (que relê o papel).
  await db().runTransaction(async (transaction) => {
    await reassertWorkspaceActor(transaction, actor, CARD_ADMIN_ROLES);
    readCardOrFail(
      await transaction.get(cardsRef(actor.workspaceId).doc(payload.cardId)),
      actor.workspaceId);
    const rateLimit = await reserveCardRateLimit(transaction, actor,
      CARD_RECONCILIATION_RATE_LIMIT);
    rateLimit.commit();
  });
  const pageSize = payload.pageSize ?? REBUILD_INVOICES_DEFAULT_PAGE_SIZE;
  let query = invoicesRef(actor.workspaceId)
    .where("cardId", "==", payload.cardId)
    .orderBy("competenceMonth", "asc")
    .limit(pageSize);
  if (payload.cursor) query = query.startAfter(payload.cursor);
  const page = await query.get();
  const items: InvoiceRebuildItem[] = [];
  for (const doc of page.docs) {
    items.push(await rebuildOne(actor, doc.ref, payload.cardId, requestId,
      payload.correlationId ?? null));
  }
  const report: InvoiceRebuildReport = {
    cardId: payload.cardId,
    processed: items.length,
    consistent: items.filter((item) => item.status === "consistent").length,
    repaired: items.filter((item) => item.status === "repaired").length,
    divergent: items.filter((item) => item.status === "divergent").length,
    items,
    nextCursor: page.size === pageSize ?
      String(page.docs[page.docs.length - 1].get("competenceMonth")) :
      null,
  };
  if (report.divergent > 0) {
    log.error("credit_card_invoice_divergent", null, {
      divergent: report.divergent,
    });
  }
  log.info("credit_card_invoices_rebuilt", {
    processed: report.processed,
    repaired: report.repaired,
    divergent: report.divergent,
    hasMore: report.nextCursor !== null,
  });
  return report;
};
