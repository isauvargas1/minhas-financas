import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

import type {
  CreditCardCallableExecutionContext,
} from "./callable";

import type {
  RebuildCardInvoicesForCardPayload,
} from "./contracts";

import {
  CREDIT_CARD_ADMIN_COLLECTIONS,
  cardFinancialEventDoc,
  creditCardInstallmentDoc,
  creditCardInvoiceDoc,
  creditCardInvoiceViewDoc,
  creditCardDoc,
  getFirestore,
  workspaceCollection,
} from "./adminPaths";

import {
  CreditCardApplicationError,
} from "./errors";

import {
  markIdempotencyKeyCompleted,
  reserveIdempotencyKey,
} from "./idempotency";

import {
  recordCreditCardOperationMetric,
} from "./observability";

import {
  enqueueCreditCardDomainNotifications,
} from "./domainNotifications";

import {
  recordCreditCardAuditLog,
} from "./auditLogs";

export interface RebuildCardInvoicesForCardResult {
  success: true;
  cardId: string;
  eventId: string;
  rebuiltInvoiceIds: string[];
  cancelledInvoiceIds: string[];
  updatedInstallmentIds: string[];
  inspectedInstallmentsCount: number;
}

interface CreditCardData {
  id?: string;
  workspaceId?: string;
  closingDay?: number;
  dueDay?: number;
}

interface InstallmentData {
  id?: string;
  workspaceId?: string;
  purchaseId?: string;
  cardId?: string;
  invoiceId?: string;
  installmentNumber?: number;
  amount?: number;
  competenceMonth?: string;
  dueDate?: string;
  status?: string;
  paidAmount?: number;
}

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

interface PaymentData {
  id?: string;
  workspaceId?: string;
  cardId?: string;
  invoiceId?: string;
  status?: string;
}

interface InvoiceDraft {
  id: string;
  competenceMonth: string;
  closingDate: string;
  dueDate: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  itemsCount: number;
  installmentIds: string[];
}

const normalizeMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (
    Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null
  );

const stripUndefinedValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedValues);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefinedValues(entryValue)])
  );
};

const toFirestoreData = (
  data: Record<string, unknown>
): admin.firestore.DocumentData =>
  stripUndefinedValues(data) as admin.firestore.DocumentData;

const pad = (value: number): string => String(value).padStart(2, "0");

const lastDayOfMonth = (year: number, monthIndex: number): number =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

const formatDateWithSafeDay = (
  competenceMonth: string,
  day: number
): string => {
  const [year, month] = competenceMonth.split("-").map(Number);
  const monthIndex = month - 1;
  const safeDay = Math.min(day, lastDayOfMonth(year, monthIndex));

  return `${year}-${pad(month)}-${pad(safeDay)}`;
};

const buildInvoiceId = (
  cardId: string,
  competenceMonth: string
): string => `${cardId}_${competenceMonth}`;

const assertValidBillingDay = (
  value: unknown,
  field: string
): number => {
  const numericValue = Number(value);

  if (
    !Number.isInteger(numericValue) ||
    numericValue < 1 ||
    numericValue > 31
  ) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      "O cartão possui regra de ciclo inválida.",
      { field, value }
    );
  }

  return numericValue;
};

const isBillableInstallment = (
  installment: InstallmentData
): boolean =>
  installment.status !== "cancelled" &&
  installment.status !== "reversed";

const isCompetenceInsideRange = (
  competenceMonth: string,
  fromCompetenceMonth?: string,
  toCompetenceMonth?: string
): boolean => {
  if (fromCompetenceMonth && competenceMonth < fromCompetenceMonth) {
    return false;
  }

  if (toCompetenceMonth && competenceMonth > toCompetenceMonth) {
    return false;
  }

  return true;
};

const sumMoney = (values: number[]): number =>
  normalizeMoney(values.reduce((total, value) => total + value, 0));

const derivePaymentStatus = (
  totalAmount: number,
  paidAmount: number
): "unpaid" | "partial" | "paid" | "overpaid" => {
  if (totalAmount <= 0) return "paid";
  if (paidAmount <= 0) return "unpaid";
  if (paidAmount < totalAmount) return "partial";
  if (paidAmount === totalAmount) return "paid";

  return "overpaid";
};

const buildInvoiceDrafts = (
  workspaceId: string,
  cardId: string,
  installments: InstallmentData[],
  closingDay: number,
  dueDay: number
): InvoiceDraft[] => {
  const grouped = new Map<string, InstallmentData[]>();

  installments
    .filter(isBillableInstallment)
    .forEach((installment) => {
      if (!installment.competenceMonth) return;

      const current = grouped.get(installment.competenceMonth) ?? [];
      current.push(installment);
      grouped.set(installment.competenceMonth, current);
    });

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([competenceMonth, invoiceInstallments]) => {
      const totalAmount = sumMoney(
        invoiceInstallments.map((installment) =>
          Number(installment.amount ?? 0)
        )
      );
      const paidAmount = sumMoney(
        invoiceInstallments.map((installment) =>
          Number(installment.paidAmount ?? 0)
        )
      );
      const remainingAmount = normalizeMoney(totalAmount - paidAmount);

      return {
        id: buildInvoiceId(cardId, competenceMonth),
        competenceMonth,
        closingDate: formatDateWithSafeDay(competenceMonth, closingDay),
        dueDate: formatDateWithSafeDay(competenceMonth, dueDay),
        totalAmount,
        paidAmount,
        remainingAmount,
        itemsCount: invoiceInstallments.length,
        installmentIds: invoiceInstallments
          .map((installment) => installment.id)
          .filter((id): id is string => Boolean(id)),
      };
    });
};

const buildResult = (
  cardId: string,
  eventId: string,
  rebuiltInvoiceIds: string[],
  cancelledInvoiceIds: string[],
  updatedInstallmentIds: string[],
  inspectedInstallmentsCount: number
): RebuildCardInvoicesForCardResult => ({
  success: true,
  cardId,
  eventId,
  rebuiltInvoiceIds,
  cancelledInvoiceIds,
  updatedInstallmentIds,
  inspectedInstallmentsCount,
});

export const executeRebuildCardInvoicesForCard = async (
  context: CreditCardCallableExecutionContext<
    RebuildCardInvoicesForCardPayload
  >
): Promise<RebuildCardInvoicesForCardResult | Record<string, unknown>> => {
  const { payload, auth } = context;
  const db = getFirestore();
  const operation = "rebuildCardInvoicesForCard";

  return db.runTransaction(async (transaction) => {
    const workspaceId = payload.workspaceId;
    const cardRef = creditCardDoc(workspaceId, payload.cardId);
    const installmentsQuery = workspaceCollection(
      workspaceId,
      CREDIT_CARD_ADMIN_COLLECTIONS.installments
    ).where("cardId", "==", payload.cardId);
    const invoicesQuery = workspaceCollection(
      workspaceId,
      CREDIT_CARD_ADMIN_COLLECTIONS.invoices
    ).where("cardId", "==", payload.cardId);

    const [
      cardSnapshot,
      installmentsSnapshot,
      invoicesSnapshot,
    ] = await Promise.all([
      transaction.get(cardRef),
      transaction.get(installmentsQuery),
      transaction.get(invoicesQuery),
    ]);

    if (!cardSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Cartão não encontrado.",
        { cardId: payload.cardId }
      );
    }

    const cardData = cardSnapshot.data() as CreditCardData | undefined;

    if (!cardData) {
      throw new CreditCardApplicationError(
        "internal",
        "Cartão existente sem dados carregados.",
        { cardId: payload.cardId }
      );
    }

    if (
      cardData.workspaceId !== undefined &&
      cardData.workspaceId !== workspaceId
    ) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "O cartão não pertence ao workspace informado.",
        { cardId: payload.cardId }
      );
    }

    const closingDay = assertValidBillingDay(
      cardData.closingDay,
      "closingDay"
    );
    const dueDay = assertValidBillingDay(cardData.dueDay, "dueDay");

    const allInstallments = installmentsSnapshot.docs.map(
      (documentSnapshot) => ({
        id: documentSnapshot.id,
        ...documentSnapshot.data(),
      })
    ) as InstallmentData[];

    const scopedInstallments = allInstallments.filter((installment) =>
      installment.workspaceId === workspaceId &&
      installment.cardId === payload.cardId &&
      Boolean(installment.competenceMonth) &&
      isCompetenceInsideRange(
        String(installment.competenceMonth),
        payload.fromCompetenceMonth,
        payload.toCompetenceMonth
      )
    );

    if (scopedInstallments.length === 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Nenhuma parcela encontrada para reconstrução de faturas.",
        {
          cardId: payload.cardId,
          fromCompetenceMonth: payload.fromCompetenceMonth,
          toCompetenceMonth: payload.toCompetenceMonth,
        }
      );
    }

    const invalidInstallment = scopedInstallments.find((installment) =>
      !Number.isFinite(Number(installment.amount)) ||
      Number(installment.amount) < 0 ||
      !installment.competenceMonth
    );

    if (invalidInstallment) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Existe parcela inválida no escopo de reconstrução.",
        { installmentId: invalidInstallment.id }
      );
    }

    const invoiceDrafts = buildInvoiceDrafts(
      workspaceId,
      payload.cardId,
      scopedInstallments,
      closingDay,
      dueDay
    );

    if (invoiceDrafts.length === 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Nenhuma fatura faturável foi gerada para reconstrução.",
        { cardId: payload.cardId }
      );
    }

    const targetInvoiceIds = new Set(
      invoiceDrafts.map((invoiceDraft) => invoiceDraft.id)
    );
    const existingInvoices = invoicesSnapshot.docs.map((documentSnapshot) => ({
      id: documentSnapshot.id,
      data: documentSnapshot.data() as InvoiceData | undefined,
      ref: documentSnapshot.ref,
    }));
    const scopedExistingInvoices = existingInvoices.filter((invoice) => {
      const competenceMonth = invoice.data?.competenceMonth;

      if (!competenceMonth) return false;

      return isCompetenceInsideRange(
        competenceMonth,
        payload.fromCompetenceMonth,
        payload.toCompetenceMonth
      );
    });
    const paymentQueries = scopedExistingInvoices.map((invoice) =>
      workspaceCollection(
        workspaceId,
        CREDIT_CARD_ADMIN_COLLECTIONS.invoicePayments
      ).where("invoiceId", "==", invoice.id)
    );
    const paymentSnapshots = await Promise.all(
      paymentQueries.map((paymentQuery) => transaction.get(paymentQuery))
    );

    const payments = paymentSnapshots.reduce<PaymentData[]>(
      (accumulator, paymentSnapshot) => {
        accumulator.push(
          ...paymentSnapshot.docs.map((documentSnapshot) => ({
            id: documentSnapshot.id,
            ...documentSnapshot.data(),
          }) as PaymentData)
        );

        return accumulator;
      },
      []
    );

    const idempotency = await reserveIdempotencyKey(transaction, {
      workspaceId,
      operation,
      idempotencyKey: payload.idempotencyKey,
      requestPayload: payload,
    });

    if (idempotency.replayResult) {
      return idempotency.replayResult;
    }

    const invalidPayment = payments.find((payment) =>
      payment.workspaceId !== workspaceId ||
      payment.cardId !== payload.cardId ||
      !payment.invoiceId
    );

    if (invalidPayment) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Há pagamento inválido no escopo de reconstrução.",
        { paymentId: invalidPayment.id }
      );
    }

    const activePayment = payments.find((payment) =>
      payment.status !== "reversed"
    );

    if (activePayment) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Não é permitido reconstruir faturas com pagamentos registrados.",
        {
          paymentId: activePayment.id,
          invoiceId: activePayment.invoiceId,
        }
      );
    }

    const blockedInvoice = scopedExistingInvoices.find((invoice) =>
      invoice.data?.status === "paid" ||
      invoice.data?.status === "partial_paid"
    );

    if (blockedInvoice) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Não é permitido reconstruir fatura paga ou parcialmente paga.",
        {
          invoiceId: blockedInvoice.id,
          status: blockedInvoice.data?.status,
        }
      );
    }

    const serverTimestamp = FieldValue.serverTimestamp();
    const updatedInstallmentIds: string[] = [];
    const rebuiltInvoiceIds: string[] = [];
    const cancelledInvoiceIds: string[] = [];
    const invoiceDraftById = new Map(
      invoiceDrafts.map((invoiceDraft) => [invoiceDraft.id, invoiceDraft])
    );

    scopedInstallments.forEach((installment) => {
      if (!installment.id || !installment.competenceMonth) return;

      const invoiceId = buildInvoiceId(
        payload.cardId,
        installment.competenceMonth
      );
      const nextStatus = installment.status === "projected" ?
        "invoiced" :
        installment.status;

      if (
        installment.invoiceId !== invoiceId ||
        installment.status !== nextStatus
      ) {
        transaction.update(
          creditCardInstallmentDoc(workspaceId, installment.id),
          toFirestoreData({
            invoiceId,
            status: nextStatus,
            dueDate: formatDateWithSafeDay(
              installment.competenceMonth,
              dueDay
            ),
            updatedAt: serverTimestamp,
          })
        );

        updatedInstallmentIds.push(installment.id);
      }
    });

    invoiceDrafts.forEach((invoiceDraft) => {
      const paymentStatusDerived = derivePaymentStatus(
        invoiceDraft.totalAmount,
        invoiceDraft.paidAmount
      );
      const status = invoiceDraft.paidAmount > 0 ?
        "partial_paid" :
        "open";

      transaction.set(
        creditCardInvoiceDoc(workspaceId, invoiceDraft.id),
        toFirestoreData({
          id: invoiceDraft.id,
          workspaceId,
          cardId: payload.cardId,
          competenceMonth: invoiceDraft.competenceMonth,
          closingDate: invoiceDraft.closingDate,
          dueDate: invoiceDraft.dueDate,
          status,
          totalAmount: invoiceDraft.totalAmount,
          paidAmount: invoiceDraft.paidAmount,
          remainingAmount: invoiceDraft.remainingAmount,
          itemsCount: invoiceDraft.itemsCount,
          paymentStatusDerived,
          generatedAt: serverTimestamp,
          rebuiltAt: serverTimestamp,
          updatedAt: serverTimestamp,
        }),
        { merge: true }
      );

      transaction.set(
        creditCardInvoiceViewDoc(workspaceId, invoiceDraft.id),
        toFirestoreData({
          id: invoiceDraft.id,
          workspaceId,
          cardId: payload.cardId,
          competenceMonth: invoiceDraft.competenceMonth,
          dueDate: invoiceDraft.dueDate,
          status,
          totalAmount: invoiceDraft.totalAmount,
          paidAmount: invoiceDraft.paidAmount,
          remainingAmount: invoiceDraft.remainingAmount,
          updatedAt: serverTimestamp,
        }),
        { merge: true }
      );

      rebuiltInvoiceIds.push(invoiceDraft.id);
    });

    scopedExistingInvoices.forEach((invoice) => {
      if (targetInvoiceIds.has(invoice.id)) return;

      const invoiceData = invoice.data;

      if (!invoiceData) return;

      transaction.set(
        invoice.ref,
        toFirestoreData({
          status: "cancelled",
          totalAmount: 0,
          paidAmount: 0,
          remainingAmount: 0,
          itemsCount: 0,
          paymentStatusDerived: "paid",
          rebuiltAt: serverTimestamp,
          updatedAt: serverTimestamp,
        }),
        { merge: true }
      );

      transaction.set(
        creditCardInvoiceViewDoc(workspaceId, invoice.id),
        toFirestoreData({
          id: invoice.id,
          workspaceId,
          cardId: payload.cardId,
          competenceMonth: invoiceData.competenceMonth,
          dueDate: invoiceData.dueDate,
          status: "cancelled",
          totalAmount: 0,
          paidAmount: 0,
          remainingAmount: 0,
          updatedAt: serverTimestamp,
        }),
        { merge: true }
      );

      cancelledInvoiceIds.push(invoice.id);
    });

    const eventId = `${payload.cardId}_invoices_rebuilt_${Date.now()}`;

    const eventPayload = {
      operation,
      reason: payload.reason,
      fromCompetenceMonth: payload.fromCompetenceMonth,
      toCompetenceMonth: payload.toCompetenceMonth,
      inspectedInstallmentsCount: scopedInstallments.length,
      rebuiltInvoiceIds,
      cancelledInvoiceIds,
      updatedInstallmentIds,
      generatedInvoiceIds: Array.from(invoiceDraftById.keys()),
    };

    transaction.set(cardFinancialEventDoc(workspaceId, eventId), toFirestoreData({
      id: eventId,
      workspaceId,
      cardId: payload.cardId,
      eventType: "reconciliation_warning",
      payload: eventPayload,
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
      createdAt: serverTimestamp,
      actorId: auth.uid,
    }));

    enqueueCreditCardDomainNotifications(transaction, {
      id: eventId,
      workspaceId,
      cardId: payload.cardId,
      eventType: "reconciliation_warning",
      payload: eventPayload,
      actorId: auth.uid,
    });

    recordCreditCardAuditLog(transaction, {
      workspaceId,
      action: "card_invoices_rebuilt",
      actorId: auth.uid,
      entityType: "card",
      entityId: payload.cardId,
      cardId: payload.cardId,
      domainEventId: eventId,
      reason: payload.reason,
      idempotencyKey: payload.idempotencyKey,
      correlationId: payload.correlationId,
      details: eventPayload,
    });

    recordCreditCardOperationMetric(transaction, {
  workspaceId,
  operation: "card_invoices_rebuilt",
  actorId: auth.uid,
  cardId: payload.cardId,
  correlationId: payload.correlationId,
  idempotencyKey: payload.idempotencyKey,
});

    const result = buildResult(
      payload.cardId,
      eventId,
      rebuiltInvoiceIds,
      cancelledInvoiceIds,
      updatedInstallmentIds,
      scopedInstallments.length
    );

    markIdempotencyKeyCompleted(
      transaction,
      idempotency.ref,
      result as unknown as Record<string, unknown>
    );

    return result;
  });
};