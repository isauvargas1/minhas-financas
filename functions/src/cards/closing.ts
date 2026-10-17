import * as admin from "firebase-admin";
import {FieldPath} from "firebase-admin/firestore";
import {onSchedule} from "firebase-functions/v2/scheduler";

import {addDaysToDayKey, saoPauloDayKey} from "../shared/dateKeys";
import {isAlreadyExistsError} from "../shared/errors";
import {sha256} from "../shared/hashing";
import {createOperationLogger} from "../shared/logger";
import {SCHEDULED_FUNCTION_OPTIONS} from "../shared/runtimeOptions";
import {workspaceRef} from "../shared/workspaceAuth";
import {buildNotificationDocument} from "../notifications/builder";
import {NotificationContractError} from "../notifications/contract";
import {formatBrl} from "./common";
import {appendInvoiceClosedEvent} from "./invoiceOperations";
import {
  InvoiceBook,
  applyInvoiceClose,
  prepareInvoiceClose,
} from "./invoices";
import {
  CARD_INVOICES_COLLECTION,
  CARD_SCHEMA_VERSION,
  CARD_SYSTEM_ACTOR,
  cardsRef,
  readAuthoritativeCard,
  readAuthoritativeInvoice,
} from "./model";

/**
 * Fechamento automático de faturas e alertas de vencimento (P4-A, D-36,
 * PR-CC-04).
 *
 * 1. Fechamento: lê **só** as faturas que já deveriam estar fechadas
 *
 *      collectionGroup("credit_card_invoices")
 *        where schemaVersion == 1, cycleStatus == "open", closingDate <= hoje
 *        orderBy closingDate, __name__   (índice de grupo declarado)
 *
 *    com cursor estável (`startAfter` no último documento da página), 200 por
 *    página e até 25 páginas por execução; o que sobrar fica para a próxima
 *    execução (`truncated`, nunca truncamento silencioso). Cada fatura fecha
 *    numa transação que relê a fatura e o cartão, confirma que continua
 *    aberta e elegível, recalcula o total pela soma dos lançamentos ativos e
 *    transporta crédito negativo para a primeira fatura aberta. Idempotente:
 *    fatura já fechada é pulada; reexecutar no mesmo dia não grava nada.
 * 2. Alertas: faturas fechadas com saldo que vencem nos próximos 3 dias e as
 *    vencidas nos últimos 7 dias recebem uma notificação cada, com ID
 *    determinístico (criada uma única vez; o "lida" do usuário não volta).
 *    O atraso continua derivado: nada de `overdue` é gravado na fatura.
 *
 * Métricas no log, sem PII: contagens, transportes, divergências e corte.
 */
export const CARD_CLOSING_OPERATION = "processCreditCardInvoiceClosing";
export const CARD_CLOSING_PAGE_SIZE = 200;
export const CARD_CLOSING_MAX_PAGES = 25;
export const CARD_DUE_SOON_DAYS = 3;
export const CARD_OVERDUE_ALERT_DAYS = 7;

export interface CardClosingSummary {
  today: string;
  scanned: number;
  closed: number;
  skipped: number;
  failed: number;
  carryovers: number;
  driftDetected: number;
  truncated: boolean;
  dueSoonNotified: number;
  overdueNotified: number;
  alertsScanned: number;
  alertsTruncated: boolean;
}

type CloseOutcome =
  | {status: "skipped"}
  | {status: "closed"; carryover: boolean; drift: boolean};

const monthLabel = (competence: string): string =>
  `${competence.slice(5, 7)}/${competence.slice(0, 4)}`;

const dayLabel = (dayKey: string): string =>
  `${dayKey.slice(8, 10)}/${dayKey.slice(5, 7)}/${dayKey.slice(0, 4)}`;

const notificationIdFor = (kind: string, invoiceId: string): string =>
  `cc${kind}_${sha256(`${kind}:${invoiceId}`).slice(0, 32)}`;

/**
 * Documento do aviso de cartão. Passa pelo builder único das notificações
 * (P5-D2), que valida o contrato e lança `NotificationContractError` se o
 * texto ou os identificadores não couberem nele; o formato do documento e o
 * ID `cc<tipo>_<hash>` (D-36) continuam os mesmos.
 */
const notificationDocument = (input: {
  id: string;
  workspaceId: string;
  title: string;
  message: string;
  type: "credit_card" | "warning" | "error";
  cardId: string;
  invoiceId: string;
  kind: "invoice_closed" | "invoice_due_soon" | "invoice_overdue";
  /** Instante de criação, capturado uma única vez por documento. */
  createdAtMs: number;
}): admin.firestore.DocumentData => buildNotificationDocument({
  id: input.id,
  workspaceId: input.workspaceId,
  eventType: input.kind,
  title: input.title,
  message: input.message,
  type: input.type,
  link: "cards",
  createdAtMs: input.createdAtMs,
  entity: {cardId: input.cardId, invoiceId: input.invoiceId},
});

/**
 * Aviso aceito pelo contrato, ou `null` com o erro registrado só com IDs.
 * Um aviso inválido nunca impede o fechamento financeiro nem a varredura.
 */
const safeNotificationDocument = (
  input: Parameters<typeof notificationDocument>[0],
): admin.firestore.DocumentData | null => {
  try {
    return notificationDocument(input);
  } catch (error) {
    if (!(error instanceof NotificationContractError)) throw error;
    createOperationLogger({operation: CARD_CLOSING_OPERATION}).error(
      "credit_card_notification_contract_violation", error, {
        workspaceId: input.workspaceId,
        invoiceId: input.invoiceId,
        cardId: input.cardId,
        notificationId: input.id,
        reason: error.reason,
      });
    return null;
  }
};

const closeOne = async (
  ref: admin.firestore.DocumentReference,
  today: string,
  requestId: string,
): Promise<CloseOutcome> => {
  const workspaceId = ref.parent.parent?.id;
  if (!workspaceId) return {status: "skipped"};
  return admin.firestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const invoice = readAuthoritativeInvoice(
      snapshot.id, snapshot.data(), workspaceId);
    if (!invoice) throw new Error("fatura fora do schema autoritativo");
    // Relida: outra execução (ou um pagamento) pode ter fechado antes.
    if (invoice.cycleStatus !== "open" || today < invoice.closingDate) {
      return {status: "skipped"} as CloseOutcome;
    }
    const card = readAuthoritativeCard(invoice.cardId,
      (await transaction.get(cardsRef(workspaceId).doc(invoice.cardId)))
        .data(),
      workspaceId);
    if (!card) throw new Error("cartão fora do schema autoritativo");
    // Leitura antes de qualquer escrita da transação. O aviso é criado só se
    // ausente: um retry nunca prorroga a retenção nem reabre o evento.
    const notificationId = notificationIdFor("closed", invoice.id);
    const notificationRef = workspaceRef(workspaceId)
      .collection("notifications").doc(notificationId);
    const notificationExists = (await transaction.get(notificationRef)).exists;
    const book = new InvoiceBook(transaction, {
      workspaceId,
      cardId: card.id,
      closingDay: card.closingDay,
      dueDay: card.dueDay,
    }, today);
    await book.load([invoice.competenceMonth]);
    const plan = await prepareInvoiceClose(transaction, book,
      invoice.competenceMonth);
    if (!plan) return {status: "skipped"} as CloseOutcome;
    const slot = book.slot(invoice.competenceMonth);
    const before = {...slot.before};
    applyInvoiceClose(transaction, book, plan, {
      actorUid: CARD_SYSTEM_ACTOR,
      operation: CARD_CLOSING_OPERATION,
      requestId,
    });
    book.write();
    appendInvoiceClosedEvent(transaction, {
      book,
      plan,
      before,
      after: {...slot.next},
      actorId: CARD_SYSTEM_ACTOR,
      actorRole: null,
      requestId,
    });
    // O total vem do fechamento já aplicado (`slot.next`). O builder não
    // lança aqui: aviso fora do contrato vira `null`, registrado, e a fatura
    // fecha sem ele — o aviso nunca impede o fechamento financeiro.
    const notification = notificationExists ? null : safeNotificationDocument({
      id: notificationId,
      workspaceId,
      title: "Fatura fechada",
      message: `A fatura de ${monthLabel(invoice.competenceMonth)} do ` +
        `cartão ${card.name} fechou em ${formatBrl(slot.next.totalCents)}, ` +
        `com vencimento em ${dayLabel(invoice.dueDate)}.`,
      type: "credit_card",
      cardId: card.id,
      invoiceId: invoice.id,
      kind: "invoice_closed",
      createdAtMs: Date.now(),
    });
    if (notification) transaction.create(notificationRef, notification);
    return {
      status: "closed",
      carryover: plan.carryover !== null,
      drift: plan.driftCents !== 0,
    } as CloseOutcome;
  });
};

const invoiceGroup = () =>
  admin.firestore().collectionGroup(CARD_INVOICES_COLLECTION);

/** Faturas fechadas com saldo e vencimento na janela, por página. */
const notifyDueWindow = async (input: {
  kind: "due" | "overdue";
  from: string;
  to: string;
  today: string;
  pageSize: number;
  maxPages: number;
  summary: CardClosingSummary;
  cardNames: Map<string, string | null>;
}): Promise<void> => {
  let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
  for (let page = 0; page < input.maxPages; page += 1) {
    let query = invoiceGroup()
      .where("schemaVersion", "==", CARD_SCHEMA_VERSION)
      .where("cycleStatus", "==", "closed")
      .where("paymentStatus", "in", ["unpaid", "partial"])
      .where("dueDate", ">=", input.from)
      .where("dueDate", "<=", input.to)
      .orderBy("dueDate", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .limit(input.pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      input.summary.alertsScanned += 1;
      const workspaceId = doc.ref.parent.parent?.id;
      if (!workspaceId) continue;
      const invoice = readAuthoritativeInvoice(doc.id, doc.data(), workspaceId);
      if (!invoice || invoice.remainingCents <= 0) continue;
      const cardKey = `${workspaceId}/${invoice.cardId}`;
      if (!input.cardNames.has(cardKey)) {
        const card = readAuthoritativeCard(invoice.cardId,
          (await cardsRef(workspaceId).doc(invoice.cardId).get()).data(),
          workspaceId);
        input.cardNames.set(cardKey, card?.name ?? null);
      }
      const cardName = input.cardNames.get(cardKey);
      if (!cardName) continue;
      const id = notificationIdFor(input.kind, invoice.id);
      const overdue = input.kind === "overdue";
      const document = safeNotificationDocument({
        id,
        workspaceId,
        title: overdue ? "Fatura vencida" : "Fatura próxima do vencimento",
        message: `A fatura de ${monthLabel(invoice.competenceMonth)} do ` +
          `cartão ${cardName} ${overdue ? "venceu" : "vence"} em ` +
          `${dayLabel(invoice.dueDate)}, com saldo de ` +
          `${formatBrl(invoice.remainingCents)}.`,
        type: overdue ? "error" : "warning",
        cardId: invoice.cardId,
        invoiceId: invoice.id,
        kind: overdue ? "invoice_overdue" : "invoice_due_soon",
        createdAtMs: Date.now(),
      });
      // Aviso fora do contrato: registrado e ignorado; segue para a próxima.
      if (!document) continue;
      try {
        await workspaceRef(workspaceId).collection("notifications").doc(id)
          .create(document);
        if (overdue) input.summary.overdueNotified += 1;
        else input.summary.dueSoonNotified += 1;
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
      }
    }
    if (snapshot.size < input.pageSize) return;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
  input.summary.alertsTruncated = true;
};

export const runCreditCardInvoiceClosing = async (options: {
  today?: string;
  pageSize?: number;
  maxPages?: number;
  requestId?: string;
} = {}): Promise<CardClosingSummary> => {
  const today = options.today ?? saoPauloDayKey();
  const pageSize = options.pageSize ?? CARD_CLOSING_PAGE_SIZE;
  const maxPages = options.maxPages ?? CARD_CLOSING_MAX_PAGES;
  const requestId = options.requestId ?? `credit-card-closing-${today}`;
  const log = createOperationLogger({operation: CARD_CLOSING_OPERATION});
  const summary: CardClosingSummary = {
    today,
    scanned: 0,
    closed: 0,
    skipped: 0,
    failed: 0,
    carryovers: 0,
    driftDetected: 0,
    truncated: true,
    dueSoonNotified: 0,
    overdueNotified: 0,
    alertsScanned: 0,
    alertsTruncated: false,
  };
  let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    let query = invoiceGroup()
      .where("schemaVersion", "==", CARD_SCHEMA_VERSION)
      .where("cycleStatus", "==", "open")
      .where("closingDate", "<=", today)
      .orderBy("closingDate", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      summary.scanned += 1;
      try {
        const outcome = await closeOne(doc.ref, today, requestId);
        if (outcome.status === "closed") {
          summary.closed += 1;
          if (outcome.carryover) summary.carryovers += 1;
          if (outcome.drift) summary.driftDetected += 1;
        } else {
          summary.skipped += 1;
        }
      } catch (error) {
        summary.failed += 1;
        // Só identificadores: nada de nome, descrição ou valor no log.
        log.error("credit_card_invoice_close_failed", error, {
          workspaceId: doc.ref.parent.parent?.id ?? null,
          invoiceId: doc.id,
        });
      }
    }
    if (snapshot.size < pageSize) {
      summary.truncated = false;
      break;
    }
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
  const cardNames = new Map<string, string | null>();
  try {
    await notifyDueWindow({
      kind: "due",
      from: today,
      to: addDaysToDayKey(today, CARD_DUE_SOON_DAYS),
      today,
      pageSize,
      maxPages,
      summary,
      cardNames,
    });
    await notifyDueWindow({
      kind: "overdue",
      from: addDaysToDayKey(today, -CARD_OVERDUE_ALERT_DAYS),
      to: addDaysToDayKey(today, -1),
      today,
      pageSize,
      maxPages,
      summary,
      cardNames,
    });
  } catch (error) {
    log.error("credit_card_invoice_alerts_failed", error, {});
  }
  if (summary.driftDetected > 0 || summary.failed > 0) {
    log.warn("credit_card_invoice_closing_attention", {...summary});
  }
  log.info("credit_card_invoice_closing_completed", {...summary});
  return summary;
};

export const processCreditCardInvoiceClosing = onSchedule(
  {
    ...SCHEDULED_FUNCTION_OPTIONS,
    schedule: "every day 00:15",
    timeZone: "America/Sao_Paulo",
  },
  async (event) => {
    await runCreditCardInvoiceClosing({
      requestId: `credit-card-closing-${event.scheduleTime}`,
    });
  },
);
