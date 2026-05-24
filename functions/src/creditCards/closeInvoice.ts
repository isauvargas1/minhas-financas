import * as admin from "firebase-admin";

import type {
  CreditCardCallableExecutionContext,
} from "./callable";

import type {
  CloseCreditCardInvoicePayload,
} from "./contracts";

import {
  CREDIT_CARD_ADMIN_COLLECTIONS,
  cardFinancialEventDoc,
  creditCardInvoiceDoc,
  creditCardInvoiceViewDoc,
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
  enqueueCreditCardDomainNotifications,
} from "./domainNotifications";

export interface CloseCreditCardInvoiceResult {
  success: true;
  invoiceId: string;
  eventId: string;
  invoice: {
    id: string;
    status: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
    itemsCount: number;
  };
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

interface InstallmentData {
  id?: string;
  workspaceId?: string;
  cardId?: string;
  invoiceId?: string;
  amount?: number;
  paidAmount?: number;
  status?: string;
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

const isBillableInstallment = (
  installment: InstallmentData
): boolean =>
  installment.status !== "cancelled" &&
  installment.status !== "reversed";

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

const buildResult = (
  invoiceId: string,
  eventId: string,
  totalAmount: number,
  paidAmount: number,
  remainingAmount: number,
  itemsCount: number
): CloseCreditCardInvoiceResult => ({
  success: true,
  invoiceId,
  eventId,
  invoice: {
    id: invoiceId,
    status: "closed",
    totalAmount,
    paidAmount,
    remainingAmount,
    itemsCount,
  },
});

export const executeCloseCreditCardInvoice = async (
  context: CreditCardCallableExecutionContext<CloseCreditCardInvoicePayload>
): Promise<CloseCreditCardInvoiceResult | Record<string, unknown>> => {
  const { payload, auth } = context;
  const db = getFirestore();
  const operation = "closeCreditCardInvoice";

  return db.runTransaction(async (transaction) => {
    const workspaceId = payload.workspaceId;
    const invoiceRef = creditCardInvoiceDoc(workspaceId, payload.invoiceId);
    const installmentsQuery = workspaceCollection(
      workspaceId,
      CREDIT_CARD_ADMIN_COLLECTIONS.installments
    ).where("invoiceId", "==", payload.invoiceId);

    const [
      invoiceSnapshot,
      installmentsSnapshot,
    ] = await Promise.all([
      transaction.get(invoiceRef),
      transaction.get(installmentsQuery),
    ]);

    if (!invoiceSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Fatura não encontrada.",
        { invoiceId: payload.invoiceId }
      );
    }

    const invoiceData = invoiceSnapshot.data() as InvoiceData | undefined;

    if (!invoiceData) {
      throw new CreditCardApplicationError(
        "internal",
        "Fatura existente sem dados carregados.",
        { invoiceId: payload.invoiceId }
      );
    }

    const installments = installmentsSnapshot.docs.map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    })) as InstallmentData[];

    const idempotency = await reserveIdempotencyKey(transaction, {
      workspaceId,
      operation,
      idempotencyKey: payload.idempotencyKey,
      requestPayload: payload,
    });

    if (idempotency.replayResult) {
      return idempotency.replayResult;
    }

    if (invoiceData.workspaceId !== workspaceId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A fatura não pertence ao workspace informado.",
        { invoiceId: payload.invoiceId }
      );
    }

    if (invoiceData.cardId !== payload.cardId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A fatura não pertence ao cartão informado.",
        { invoiceId: payload.invoiceId, cardId: payload.cardId }
      );
    }

    if (invoiceData.status !== "open") {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Somente faturas abertas podem ser fechadas.",
        { invoiceId: payload.invoiceId, status: invoiceData.status }
      );
    }

    const invalidInstallment = installments.find((installment) =>
      installment.workspaceId !== workspaceId ||
      installment.cardId !== payload.cardId ||
      installment.invoiceId !== payload.invoiceId
    );

    if (invalidInstallment) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Todas as parcelas da fatura precisam pertencer ao mesmo workspace e cartão.",
        { installmentId: invalidInstallment.id }
      );
    }

    const billableInstallments = installments.filter(isBillableInstallment);

    if (billableInstallments.length === 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Não é permitido fechar fatura sem itens faturáveis.",
        { invoiceId: payload.invoiceId }
      );
    }

    const totalAmount = sumMoney(
      billableInstallments.map((installment) => Number(installment.amount ?? 0))
    );
    const paidAmount = normalizeMoney(Number(invoiceData.paidAmount ?? 0));
    const remainingAmount = normalizeMoney(totalAmount - paidAmount);

    if (remainingAmount < 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A fatura possui valor pago maior que o total calculado.",
        {
          invoiceId: payload.invoiceId,
          totalAmount,
          paidAmount,
        }
      );
    }

    const itemsCount = billableInstallments.length;
    const paymentStatusDerived = derivePaymentStatus(
      totalAmount,
      paidAmount
    );
    const eventId = `${payload.invoiceId}_invoice_closed`;
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    transaction.update(invoiceRef, toFirestoreData({
      status: "closed",
      totalAmount,
      paidAmount,
      remainingAmount,
      itemsCount,
      paymentStatusDerived,
      closedAt: payload.closedAt,
      updatedAt: serverTimestamp,
    }));

    transaction.set(
      creditCardInvoiceViewDoc(workspaceId, payload.invoiceId),
      toFirestoreData({
        id: payload.invoiceId,
        workspaceId,
        cardId: payload.cardId,
        competenceMonth: invoiceData.competenceMonth,
        dueDate: invoiceData.dueDate,
        status: "closed",
        totalAmount,
        paidAmount,
        remainingAmount,
        updatedAt: serverTimestamp,
      }),
      { merge: true }
    );

    const eventPayload = {
      closedAt: payload.closedAt,
      totalAmount,
      paidAmount,
      remainingAmount,
      itemsCount,
    };

    transaction.set(cardFinancialEventDoc(workspaceId, eventId), toFirestoreData({
      id: eventId,
      workspaceId,
      cardId: payload.cardId,
      eventType: "invoice_closed",
      invoiceId: payload.invoiceId,
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
      invoiceId: payload.invoiceId,
      eventType: "invoice_closed",
      payload: eventPayload,
      actorId: auth.uid,
    });

    const result = buildResult(
      payload.invoiceId,
      eventId,
      totalAmount,
      paidAmount,
      remainingAmount,
      itemsCount
    );

    markIdempotencyKeyCompleted(
      transaction,
      idempotency.ref,
      result as unknown as Record<string, unknown>
    );

    return result;
  });
};