import {onSchedule} from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

import {
  cardFinancialEventDoc,
  creditCardInvoiceViewDoc,
  getFirestore,
} from "../creditCards/adminPaths";

import {
  enqueueCreditCardDomainNotifications,
} from "../creditCards/domainNotifications";

interface InvoiceData {
  id?: string;
  workspaceId?: string;
  cardId?: string;
  competenceMonth?: string;
  closingDate?: string;
  dueDate?: string;
  status?: string;
  totalAmount?: number;
  paidAmount?: number;
  remainingAmount?: number;
  itemsCount?: number;
}

const DUE_SOON_DAYS = 3;

const ACTIVE_INVOICE_STATUSES = [
  "open",
  "closed",
  "partial_paid",
  "overdue",
];

const SYSTEM_ACTOR_ID = "system:credit-card-invoice-automation";

const normalizeIsoDate = (value: string): string => value.slice(0, 10);

const getSaoPauloTodayIsoDate = (): string => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(new Date());
};

const addDaysToIsoDate = (
  isoDate: string,
  days: number
): string => {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));

  return date.toISOString().slice(0, 10);
};

const diffInCalendarDays = (
  fromIsoDate: string,
  toIsoDate: string
): number => {
  const [fromYear, fromMonth, fromDay] = fromIsoDate.split("-").map(Number);
  const [toYear, toMonth, toDay] = toIsoDate.split("-").map(Number);

  const fromDate = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toDate = Date.UTC(toYear, toMonth - 1, toDay);

  return Math.round((toDate - fromDate) / 86400000);
};

const normalizeMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const buildInvoiceEventPayload = (
  invoice: InvoiceData,
  dueDate: string,
  daysUntilDue: number
): Record<string, unknown> => ({
  dueDate,
  daysUntilDue,
  competenceMonth: invoice.competenceMonth,
  status: invoice.status,
  totalAmount: normalizeMoney(Number(invoice.totalAmount ?? 0)),
  paidAmount: normalizeMoney(Number(invoice.paidAmount ?? 0)),
  remainingAmount: normalizeMoney(Number(invoice.remainingAmount ?? 0)),
  itemsCount: Number(invoice.itemsCount ?? 0),
});

const getWorkspaceIdFromInvoiceSnapshot = (
  invoiceSnapshot: admin.firestore.QueryDocumentSnapshot
): string | null => {
  const workspaceRef = invoiceSnapshot.ref.parent.parent;

  return workspaceRef?.id ?? null;
};

const registerProcessingFailure = async (
  invoiceSnapshot: admin.firestore.QueryDocumentSnapshot,
  invoice: InvoiceData,
  todayIsoDate: string,
  error: unknown
): Promise<void> => {
  const db = getFirestore();
  const workspaceId = invoice.workspaceId ||
    getWorkspaceIdFromInvoiceSnapshot(invoiceSnapshot);
  const cardId = invoice.cardId;
  const invoiceId = invoice.id || invoiceSnapshot.id;

  if (!workspaceId || !cardId) {
    console.error(
      "Falha ao registrar processing_failure: workspaceId/cardId ausente.",
      {invoiceId, workspaceId, cardId, error: getErrorMessage(error)}
    );
    return;
  }

  const eventId = `${invoiceId}_processing_failure_${todayIsoDate}`;

  await db.runTransaction(async (transaction) => {
    const eventRef = cardFinancialEventDoc(workspaceId, eventId);
    const eventSnapshot = await transaction.get(eventRef);

    if (eventSnapshot.exists) {
      return;
    }

    const payload = {
      operation: "processCreditCardInvoiceOperationalAlerts",
      invoiceId,
      errorMessage: getErrorMessage(error),
      occurredAt: todayIsoDate,
    };

    transaction.set(eventRef, {
      id: eventId,
      workspaceId,
      cardId,
      invoiceId,
      eventType: "processing_failure",
      payload,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      actorId: SYSTEM_ACTOR_ID,
    });

    enqueueCreditCardDomainNotifications(transaction, {
      id: eventId,
      workspaceId,
      cardId,
      invoiceId,
      eventType: "processing_failure",
      payload,
      actorId: SYSTEM_ACTOR_ID,
    });
  });
};

const processInvoiceDueSoon = async (
  invoiceSnapshot: admin.firestore.QueryDocumentSnapshot,
  invoice: InvoiceData,
  workspaceId: string,
  todayIsoDate: string,
  dueDate: string,
  daysUntilDue: number
): Promise<void> => {
  const db = getFirestore();
  const invoiceId = invoice.id || invoiceSnapshot.id;
  const cardId = invoice.cardId;

  if (!cardId) return;

  const eventId = `${invoiceId}_invoice_due_soon_${dueDate}_d${daysUntilDue}`;

  await db.runTransaction(async (transaction) => {
    const eventRef = cardFinancialEventDoc(workspaceId, eventId);
    const eventSnapshot = await transaction.get(eventRef);

    if (eventSnapshot.exists) {
      return;
    }

    const payload = buildInvoiceEventPayload(
      invoice,
      dueDate,
      daysUntilDue
    );

    transaction.set(eventRef, {
      id: eventId,
      workspaceId,
      cardId,
      invoiceId,
      eventType: "invoice_due_soon",
      payload: {
        ...payload,
        processedAt: todayIsoDate,
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      actorId: SYSTEM_ACTOR_ID,
    });

    enqueueCreditCardDomainNotifications(transaction, {
      id: eventId,
      workspaceId,
      cardId,
      invoiceId,
      eventType: "invoice_due_soon",
      payload,
      actorId: SYSTEM_ACTOR_ID,
    });
  });
};

const processInvoiceOverdue = async (
  invoiceSnapshot: admin.firestore.QueryDocumentSnapshot,
  invoice: InvoiceData,
  workspaceId: string,
  todayIsoDate: string,
  dueDate: string,
  daysUntilDue: number
): Promise<void> => {
  const db = getFirestore();
  const invoiceId = invoice.id || invoiceSnapshot.id;
  const cardId = invoice.cardId;

  if (!cardId) return;

  const eventId = `${invoiceId}_invoice_overdue`;
  const invoiceRef = invoiceSnapshot.ref;

  await db.runTransaction(async (transaction) => {
    const eventRef = cardFinancialEventDoc(workspaceId, eventId);
    const eventSnapshot = await transaction.get(eventRef);
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    if (invoice.status !== "overdue") {
      transaction.update(invoiceRef, {
        status: "overdue",
        updatedAt: serverTimestamp,
      });

      transaction.set(
        creditCardInvoiceViewDoc(workspaceId, invoiceId),
        {
          id: invoiceId,
          workspaceId,
          cardId,
          competenceMonth: invoice.competenceMonth,
          dueDate,
          status: "overdue",
          totalAmount: normalizeMoney(Number(invoice.totalAmount ?? 0)),
          paidAmount: normalizeMoney(Number(invoice.paidAmount ?? 0)),
          remainingAmount: normalizeMoney(Number(invoice.remainingAmount ?? 0)),
          updatedAt: serverTimestamp,
        },
        {merge: true}
      );
    }

    if (eventSnapshot.exists) {
      return;
    }

    const payload = buildInvoiceEventPayload(
      invoice,
      dueDate,
      daysUntilDue
    );

    transaction.set(eventRef, {
      id: eventId,
      workspaceId,
      cardId,
      invoiceId,
      eventType: "invoice_overdue",
      payload: {
        ...payload,
        previousStatus: invoice.status,
        processedAt: todayIsoDate,
      },
      createdAt: serverTimestamp,
      actorId: SYSTEM_ACTOR_ID,
    });

    enqueueCreditCardDomainNotifications(transaction, {
      id: eventId,
      workspaceId,
      cardId,
      invoiceId,
      eventType: "invoice_overdue",
      payload,
      actorId: SYSTEM_ACTOR_ID,
    });
  });
};

export const processCreditCardInvoiceOperationalAlerts = onSchedule(
  {
    schedule: "every day 07:00",
    timeZone: "America/Sao_Paulo",
  },
  async () => {
    const db = getFirestore();
    const todayIsoDate = getSaoPauloTodayIsoDate();
    const windowEndIsoDate = addDaysToIsoDate(todayIsoDate, DUE_SOON_DAYS);

    const snapshot = await db
      .collectionGroup("credit_card_invoices")
      .where("status", "in", ACTIVE_INVOICE_STATUSES)
      .where("dueDate", "<=", windowEndIsoDate)
      .orderBy("dueDate", "asc")
      .get();

    if (snapshot.empty) {
      console.log("Nenhuma fatura para alertas operacionais de cartão.");
      return;
    }

    let processedCount = 0;
    let failedCount = 0;

    for (const invoiceSnapshot of snapshot.docs) {
      const invoice = {
        id: invoiceSnapshot.id,
        ...invoiceSnapshot.data(),
      } as InvoiceData;

      try {
        const workspaceId = invoice.workspaceId ||
          getWorkspaceIdFromInvoiceSnapshot(invoiceSnapshot);
        const dueDate = invoice.dueDate ? normalizeIsoDate(invoice.dueDate) : null;
        const remainingAmount = normalizeMoney(Number(invoice.remainingAmount ?? 0));

        if (
          !workspaceId ||
          !invoice.cardId ||
          !dueDate ||
          remainingAmount <= 0 ||
          invoice.status === "paid" ||
          invoice.status === "cancelled"
        ) {
          continue;
        }

        const daysUntilDue = diffInCalendarDays(todayIsoDate, dueDate);

        if (daysUntilDue < 0) {
          await processInvoiceOverdue(
            invoiceSnapshot,
            invoice,
            workspaceId,
            todayIsoDate,
            dueDate,
            daysUntilDue
          );
          processedCount++;
          continue;
        }

        if (daysUntilDue <= DUE_SOON_DAYS) {
          await processInvoiceDueSoon(
            invoiceSnapshot,
            invoice,
            workspaceId,
            todayIsoDate,
            dueDate,
            daysUntilDue
          );
          processedCount++;
        }
      } catch (error) {
        failedCount++;
        console.error(
          "Falha ao processar alerta operacional de fatura.",
          {
            invoiceId: invoiceSnapshot.id,
            error: getErrorMessage(error),
          }
        );

        await registerProcessingFailure(
          invoiceSnapshot,
          invoice,
          todayIsoDate,
          error
        );
      }
    }

    console.log(
      `Alertas operacionais de fatura processados. Sucesso: ${processedCount}. Falhas: ${failedCount}.`
    );
  }
);