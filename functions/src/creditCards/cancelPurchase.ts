import * as admin from "firebase-admin";

import type {
  CreditCardCallableExecutionContext,
} from "./callable";

import type {
  CancelCreditCardPurchasePayload,
} from "./contracts";

import {
  recordCreditCardOperationMetric,
} from "./observability";

import {
  CREDIT_CARD_ADMIN_COLLECTIONS,
  cardFinancialEventDoc,
  cardLimitLedgerDoc,
  cardLimitSnapshotDoc,
  creditCardInstallmentDoc,
  creditCardInvoiceDoc,
  creditCardInvoiceViewDoc,
  creditCardPurchaseDoc,
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
  recordCreditCardAuditLog,
} from "./auditLogs";

export interface CancelCreditCardPurchaseResult {
  success: true;
  purchaseId: string;
  cancelledInstallmentIds: string[];
  affectedInvoiceIds: string[];
  ledgerEntryId: string;
  eventId: string;
  limitSnapshot: {
    cardId: string;
    limitTotal: number;
    limitUsed: number;
    limitAvailable: number;
  };
}

interface PurchaseData {
  id?: string;
  workspaceId?: string;
  cardId?: string;
  status?: string;
  totalAmount?: number;
  description?: string;
}

interface InstallmentData {
  id?: string;
  workspaceId?: string;
  purchaseId?: string;
  cardId?: string;
  invoiceId?: string;
  amount?: number;
  status?: string;
  paidAmount?: number;
}

interface InvoiceData {
  id?: string;
  workspaceId?: string;
  cardId?: string;
  competenceMonth?: string;
  dueDate?: string;
  status?: string;
  totalAmount?: number;
  paidAmount?: number;
  remainingAmount?: number;
  itemsCount?: number;
}

interface LimitSnapshotData {
  workspaceId?: string;
  cardId?: string;
  limitTotal?: number;
  limitUsed?: number;
  limitAvailable?: number;
}

interface AffectedInvoiceCalculation {
  invoiceId: string;
  cancelledAmount: number;
  cancelledItemsCount: number;
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

const deriveInvoiceStatusAfterCancel = (
  totalAmount: number,
  paidAmount: number,
  itemsCount: number
): "open" | "partial_paid" | "paid" | "cancelled" => {
  if (itemsCount <= 0 || totalAmount <= 0) return "cancelled";
  if (paidAmount <= 0) return "open";
  if (paidAmount < totalAmount) return "partial_paid";

  return "paid";
};

const groupInstallmentsByInvoice = (
  installments: InstallmentData[]
): Map<string, AffectedInvoiceCalculation> => {
  const grouped = new Map<string, AffectedInvoiceCalculation>();

  installments.forEach((installment) => {
    if (!installment.invoiceId) return;

    const current = grouped.get(installment.invoiceId) ?? {
      invoiceId: installment.invoiceId,
      cancelledAmount: 0,
      cancelledItemsCount: 0,
    };

    current.cancelledAmount = normalizeMoney(
      current.cancelledAmount + Number(installment.amount ?? 0)
    );
    current.cancelledItemsCount += 1;

    grouped.set(installment.invoiceId, current);
  });

  return grouped;
};

const buildResult = (
  purchaseId: string,
  cancelledInstallmentIds: string[],
  affectedInvoiceIds: string[],
  ledgerEntryId: string,
  eventId: string,
  cardId: string,
  limitTotal: number,
  limitUsed: number,
  limitAvailable: number
): CancelCreditCardPurchaseResult => ({
  success: true,
  purchaseId,
  cancelledInstallmentIds,
  affectedInvoiceIds,
  ledgerEntryId,
  eventId,
  limitSnapshot: {
    cardId,
    limitTotal,
    limitUsed,
    limitAvailable,
  },
});

export const executeCancelCreditCardPurchase = async (
  context: CreditCardCallableExecutionContext<CancelCreditCardPurchasePayload>
): Promise<CancelCreditCardPurchaseResult | Record<string, unknown>> => {
  const {payload, auth} = context;
  const db = getFirestore();
  const operation = "cancelCreditCardPurchase";

  return db.runTransaction(async (transaction) => {
    const workspaceId = payload.workspaceId;
    const purchaseRef = creditCardPurchaseDoc(
      workspaceId,
      payload.purchaseId
    );
    const limitSnapshotRef = cardLimitSnapshotDoc(
      workspaceId,
      payload.cardId
    );
    const installmentsQuery = workspaceCollection(
      workspaceId,
      CREDIT_CARD_ADMIN_COLLECTIONS.installments
    ).where("purchaseId", "==", payload.purchaseId);

    const [
      purchaseSnapshot,
      limitSnapshot,
      installmentsSnapshot,
    ] = await Promise.all([
      transaction.get(purchaseRef),
      transaction.get(limitSnapshotRef),
      transaction.get(installmentsQuery),
    ]);

    if (!purchaseSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Compra de cartão não encontrada.",
        {purchaseId: payload.purchaseId}
      );
    }

    if (!limitSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Snapshot de limite do cartão não encontrado.",
        {cardId: payload.cardId}
      );
    }

    const purchaseData = purchaseSnapshot.data() as PurchaseData | undefined;
    const limitSnapshotData = limitSnapshot.data() as
      LimitSnapshotData | undefined;
    const installments = installmentsSnapshot.docs.map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    })) as InstallmentData[];

    if (!purchaseData) {
      throw new CreditCardApplicationError(
        "internal",
        "Compra existente sem dados carregados.",
        {purchaseId: payload.purchaseId}
      );
    }

    if (!limitSnapshotData) {
      throw new CreditCardApplicationError(
        "internal",
        "Snapshot de limite existente sem dados carregados.",
        {cardId: payload.cardId}
      );
    }

    if (installments.length === 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A compra não possui parcelas para cancelamento.",
        {purchaseId: payload.purchaseId}
      );
    }

    const affectedInvoiceMap = groupInstallmentsByInvoice(installments);
    const affectedInvoiceIds = Array.from(affectedInvoiceMap.keys());
    const invoiceRefs = affectedInvoiceIds.map((invoiceId) =>
      creditCardInvoiceDoc(workspaceId, invoiceId)
    );
    const invoiceSnapshots = await Promise.all(
      invoiceRefs.map((invoiceRef) => transaction.get(invoiceRef))
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

    if (purchaseData.workspaceId !== workspaceId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A compra não pertence ao workspace informado.",
        {purchaseId: payload.purchaseId}
      );
    }

    if (purchaseData.cardId !== payload.cardId) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A compra não pertence ao cartão informado.",
        {purchaseId: payload.purchaseId, cardId: payload.cardId}
      );
    }

    if (purchaseData.status !== "active") {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Somente compras ativas podem ser canceladas.",
        {purchaseId: payload.purchaseId, status: purchaseData.status}
      );
    }

    const invalidInstallment = installments.find((installment) =>
      installment.workspaceId !== workspaceId ||
      installment.cardId !== payload.cardId ||
      installment.purchaseId !== payload.purchaseId
    );

    if (invalidInstallment) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Todas as parcelas precisam pertencer à compra, cartão e workspace.",
        {installmentId: invalidInstallment.id}
      );
    }

    const paidInstallment = installments.find((installment) =>
      Number(installment.paidAmount ?? 0) > 0 ||
      installment.status === "paid"
    );

    if (paidInstallment) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Não é permitido cancelar compra com parcela já paga.",
        {installmentId: paidInstallment.id}
      );
    }

    const alreadyCancelledInstallment = installments.find((installment) =>
      installment.status === "cancelled" ||
      installment.status === "reversed"
    );

    if (alreadyCancelledInstallment) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "A compra possui parcelas já canceladas ou revertidas.",
        {installmentId: alreadyCancelledInstallment.id}
      );
    }

    const invoices = invoiceSnapshots.map((invoiceSnapshot) => {
      if (!invoiceSnapshot.exists) {
        throw new CreditCardApplicationError(
          "not_found",
          "Fatura afetada pela compra não foi encontrada.",
          {purchaseId: payload.purchaseId}
        );
      }

      return {
        id: invoiceSnapshot.id,
        data: invoiceSnapshot.data() as InvoiceData | undefined,
        ref: invoiceSnapshot.ref,
      };
    });

    const invalidInvoice = invoices.find((invoice) =>
      !invoice.data ||
      invoice.data.workspaceId !== workspaceId ||
      invoice.data.cardId !== payload.cardId
    );

    if (invalidInvoice) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "As faturas afetadas precisam pertencer ao mesmo cartão e workspace.",
        {invoiceId: invalidInvoice.id}
      );
    }

    const nonOpenInvoice = invoices.find((invoice) =>
      invoice.data?.status !== "open"
    );

    if (nonOpenInvoice) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "Cancelamento conservador exige que todas as faturas estejam abertas.",
        {
          invoiceId: nonOpenInvoice.id,
          status: nonOpenInvoice.data?.status,
          policy: payload.policy,
        }
      );
    }

    const purchaseTotalAmount = normalizeMoney(
      Number(purchaseData.totalAmount ?? sumMoney(
        installments.map((installment) => Number(installment.amount ?? 0))
      ))
    );
    const limitTotal = normalizeMoney(
      Number(limitSnapshotData.limitTotal ?? 0)
    );
    const currentLimitUsed = normalizeMoney(
      Number(limitSnapshotData.limitUsed ?? 0)
    );
    const restoredAmount = purchaseTotalAmount;
    const newLimitUsed = normalizeMoney(
      Math.max(currentLimitUsed - restoredAmount, 0)
    );
    const newLimitAvailable = normalizeMoney(limitTotal - newLimitUsed);
    const ledgerEntryId = `${payload.purchaseId}_purchase_cancelled_restore`;
    const eventId = `${payload.purchaseId}_purchase_cancelled`;
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

    transaction.update(purchaseRef, toFirestoreData({
      status: "cancelled",
      cancelledAt: serverTimestamp,
      cancellationReason: payload.reason,
      updatedBy: auth.uid,
      updatedAt: serverTimestamp,
    }));

    installments.forEach((installment) => {
      if (!installment.id) return;

      transaction.update(
        creditCardInstallmentDoc(workspaceId, installment.id),
        toFirestoreData({
          status: "cancelled",
          cancelledAt: serverTimestamp,
          paidAmount: 0,
          updatedAt: serverTimestamp,
        })
      );
    });

    invoices.forEach((invoice) => {
      const invoiceData = invoice.data as InvoiceData;
      const calculation = affectedInvoiceMap.get(invoice.id);

      if (!calculation) return;

      const previousTotalAmount = normalizeMoney(
        Number(invoiceData.totalAmount ?? 0)
      );
      const previousPaidAmount = normalizeMoney(
        Number(invoiceData.paidAmount ?? 0)
      );
      const previousItemsCount = Number(invoiceData.itemsCount ?? 0);
      const totalAmount = normalizeMoney(
        Math.max(previousTotalAmount - calculation.cancelledAmount, 0)
      );
      const paidAmount = Math.min(previousPaidAmount, totalAmount);
      const remainingAmount = normalizeMoney(totalAmount - paidAmount);
      const itemsCount = Math.max(
        previousItemsCount - calculation.cancelledItemsCount,
        0
      );
      const status = deriveInvoiceStatusAfterCancel(
        totalAmount,
        paidAmount,
        itemsCount
      );
      const paymentStatusDerived = derivePaymentStatus(
        totalAmount,
        paidAmount
      );

      transaction.update(invoice.ref, toFirestoreData({
        totalAmount,
        paidAmount,
        remainingAmount,
        itemsCount,
        status,
        paymentStatusDerived,
        updatedAt: serverTimestamp,
      }));

      transaction.set(
        creditCardInvoiceViewDoc(workspaceId, invoice.id),
        toFirestoreData({
          id: invoice.id,
          workspaceId,
          cardId: payload.cardId,
          competenceMonth: invoiceData.competenceMonth,
          dueDate: invoiceData.dueDate,
          status,
          totalAmount,
          paidAmount,
          remainingAmount,
          updatedAt: serverTimestamp,
        }),
        {merge: true}
      );
    });

    transaction.set(cardLimitLedgerDoc(workspaceId, ledgerEntryId), {
      id: ledgerEntryId,
      workspaceId,
      cardId: payload.cardId,
      sourceType: "reversal",
      sourceId: payload.purchaseId,
      direction: "restore",
      amount: restoredAmount,
      balanceAfter: newLimitAvailable,
      createdAt: serverTimestamp,
      actorId: auth.uid,
      idempotencyKey: payload.idempotencyKey,
    });

    transaction.set(limitSnapshotRef, toFirestoreData({
      workspaceId,
      cardId: payload.cardId,
      limitTotal,
      limitUsed: newLimitUsed,
      limitAvailable: newLimitAvailable,
      updatedAt: serverTimestamp,
    }));

    transaction.set(cardFinancialEventDoc(workspaceId, eventId), toFirestoreData({
      id: eventId,
      workspaceId,
      cardId: payload.cardId,
      eventType: "purchase_cancelled",
      purchaseId: payload.purchaseId,
      ledgerEntryId,
      payload: {
        reason: payload.reason,
        policy: payload.policy,
        restoredAmount,
        cancelledInstallmentsCount: installments.length,
        affectedInvoiceIds,
      },
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
      createdAt: serverTimestamp,
      actorId: auth.uid,
    }));

    recordCreditCardAuditLog(transaction, {
      workspaceId,
      action: "purchase_cancelled",
      actorId: auth.uid,
      entityType: "purchase",
      entityId: payload.purchaseId,
      cardId: payload.cardId,
      purchaseId: payload.purchaseId,
      ledgerEntryId,
      domainEventId: eventId,
      reason: payload.reason,
      policy: payload.policy,
      idempotencyKey: payload.idempotencyKey,
      correlationId: payload.correlationId,
      details: {
        restoredAmount,
        cancelledInstallmentsCount: installments.length,
        affectedInvoiceIds,
      },
    });

    recordCreditCardOperationMetric(transaction, {
  workspaceId,
  operation: "purchase_cancelled",
  actorId: auth.uid,
  cardId: payload.cardId,
  purchaseId: payload.purchaseId,
  amount: restoredAmount,
  correlationId: payload.correlationId,
  idempotencyKey: payload.idempotencyKey,
});

    const result = buildResult(
      payload.purchaseId,
      installments
        .map((installment) => installment.id)
        .filter((id): id is string => Boolean(id)),
      affectedInvoiceIds,
      ledgerEntryId,
      eventId,
      payload.cardId,
      limitTotal,
      newLimitUsed,
      newLimitAvailable
    );

    markIdempotencyKeyCompleted(
      transaction,
      idempotency.ref,
      result as unknown as Record<string, unknown>
    );

    return result;
  });
};