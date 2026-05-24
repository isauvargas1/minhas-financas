import * as admin from "firebase-admin";

import type {
    CreditCardCallableExecutionContext,
} from "./callable";

import type {
    RegisterCreditCardInvoicePaymentPayload,
} from "./contracts";

import {
    cardFinancialEventDoc,
    cardLimitLedgerDoc,
    cardLimitSnapshotDoc,
    creditCardInvoiceDoc,
    creditCardInvoiceViewDoc,
    getFirestore,
    workspaceDoc,
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

export interface RegisterCreditCardInvoicePaymentResult {
    success: true;
    paymentId: string;
    invoiceId: string;
    ledgerEntryId: string;
    eventId: string;
    cashTransactionId?: string;
    invoice: {
        id: string;
        status: string;
        totalAmount: number;
        paidAmount: number;
        remainingAmount: number;
    };
    limitSnapshot: {
        cardId: string;
        limitTotal: number;
        limitUsed: number;
        limitAvailable: number;
    };
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

const deriveInvoiceStatusAfterPayment = (
    totalAmount: number,
    paidAmount: number
): "partial_paid" | "paid" => {
    const remainingAmount = normalizeMoney(totalAmount - paidAmount);

    return remainingAmount <= 0 ? "paid" : "partial_paid";
};

const shouldCreateCashTransaction = (
    paymentMethod: RegisterCreditCardInvoicePaymentPayload["paymentMethod"]
): boolean => paymentMethod !== "manual_adjustment";

const buildResult = (
    paymentId: string,
    invoiceId: string,
    ledgerEntryId: string,
    eventId: string,
    cashTransactionId: string | undefined,
    cardId: string,
    invoiceStatus: string,
    totalAmount: number,
    paidAmount: number,
    remainingAmount: number,
    limitTotal: number,
    limitUsed: number,
    limitAvailable: number
): RegisterCreditCardInvoicePaymentResult => ({
    success: true,
    paymentId,
    invoiceId,
    ledgerEntryId,
    eventId,
    cashTransactionId,
    invoice: {
        id: invoiceId,
        status: invoiceStatus,
        totalAmount,
        paidAmount,
        remainingAmount,
    },
    limitSnapshot: {
        cardId,
        limitTotal,
        limitUsed,
        limitAvailable,
    },
});

export const executeRegisterCreditCardInvoicePayment = async (
    context: CreditCardCallableExecutionContext<
        RegisterCreditCardInvoicePaymentPayload
    >
): Promise<RegisterCreditCardInvoicePaymentResult | Record<string, unknown>> => {
    const { payload, auth } = context;
    const db = getFirestore();
    const operation = "registerCreditCardInvoicePayment";

    return db.runTransaction(async (transaction) => {
        const workspaceId = payload.workspaceId;
        const invoiceRef = creditCardInvoiceDoc(workspaceId, payload.invoiceId);
        const limitSnapshotRef = cardLimitSnapshotDoc(
            workspaceId,
            payload.cardId
        );

        const [invoiceSnapshot, limitSnapshot] = await Promise.all([
            transaction.get(invoiceRef),
            transaction.get(limitSnapshotRef),
        ]);

        if (!invoiceSnapshot.exists) {
            throw new CreditCardApplicationError(
                "not_found",
                "Fatura não encontrada.",
                { invoiceId: payload.invoiceId }
            );
        }

        if (!limitSnapshot.exists) {
            throw new CreditCardApplicationError(
                "not_found",
                "Snapshot de limite do cartão não encontrado.",
                { cardId: payload.cardId }
            );
        }

        const invoiceData = invoiceSnapshot.data() as InvoiceData | undefined;
        const limitSnapshotData = limitSnapshot.data() as
            LimitSnapshotData | undefined;

        if (!invoiceData) {
            throw new CreditCardApplicationError(
                "internal",
                "Fatura existente sem dados carregados.",
                { invoiceId: payload.invoiceId }
            );
        }

        if (!limitSnapshotData) {
            throw new CreditCardApplicationError(
                "internal",
                "Snapshot de limite existente sem dados carregados.",
                { cardId: payload.cardId }
            );
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

        const idempotency = await reserveIdempotencyKey(transaction, {
            workspaceId,
            operation,
            idempotencyKey: payload.idempotencyKey,
            requestPayload: payload,
        });

        if (idempotency.replayResult) {
            return idempotency.replayResult;
        }

        if (invoiceData.status === "cancelled") {
            throw new CreditCardApplicationError(
                "domain_precondition_failed",
                "Não é permitido pagar fatura cancelada.",
                { invoiceId: payload.invoiceId }
            );
        }

        if (invoiceData.status === "paid") {
            throw new CreditCardApplicationError(
                "domain_precondition_failed",
                "A fatura já está paga.",
                { invoiceId: payload.invoiceId }
            );
        }

        const totalAmount = normalizeMoney(Number(invoiceData.totalAmount ?? 0));
        const currentPaidAmount = normalizeMoney(
            Number(invoiceData.paidAmount ?? 0)
        );
        const currentRemainingAmount = normalizeMoney(
            Number(
                invoiceData.remainingAmount ??
                Math.max(totalAmount - currentPaidAmount, 0)
            )
        );
        const paymentAmount = normalizeMoney(payload.amount);

        if (paymentAmount > currentRemainingAmount) {
            throw new CreditCardApplicationError(
                "domain_precondition_failed",
                "O pagamento não pode exceder o saldo restante da fatura.",
                {
                    invoiceId: payload.invoiceId,
                    paymentAmount,
                    currentRemainingAmount,
                }
            );
        }

        const paymentRef = db
            .doc(`workspaces/${workspaceId}`)
            .collection("credit_card_invoice_payments")
            .doc();

        const paymentId = paymentRef.id;
        const ledgerEntryId = `${paymentId}_limit_restore`;
        const eventId = `${paymentId}_invoice_payment_posted`;
        const cashTransactionRef = shouldCreateCashTransaction(
            payload.paymentMethod
        ) ?
            workspaceDoc(workspaceId).collection("transactions").doc() :
            undefined;

        const newPaidAmount = normalizeMoney(currentPaidAmount + paymentAmount);
        const newRemainingAmount = normalizeMoney(totalAmount - newPaidAmount);
        const newInvoiceStatus = deriveInvoiceStatusAfterPayment(
            totalAmount,
            newPaidAmount
        );
        const paymentStatusDerived = derivePaymentStatus(
            totalAmount,
            newPaidAmount
        );
        const limitTotal = normalizeMoney(
            Number(limitSnapshotData.limitTotal ?? 0)
        );
        const currentLimitUsed = normalizeMoney(
            Number(limitSnapshotData.limitUsed ?? 0)
        );
        const newLimitUsed = normalizeMoney(
            Math.max(currentLimitUsed - paymentAmount, 0)
        );
        const newLimitAvailable = normalizeMoney(limitTotal - newLimitUsed);
        const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

        transaction.set(paymentRef, toFirestoreData({
            id: paymentId,
            workspaceId,
            cardId: payload.cardId,
            invoiceId: payload.invoiceId,
            paymentDate: payload.paymentDate,
            amount: paymentAmount,
            walletId: payload.walletId,
            cashAccountId: payload.cashAccountId,
            paymentMethod: payload.paymentMethod,
            status: "posted",
            cashTransactionId: cashTransactionRef?.id,
            idempotencyKey: payload.idempotencyKey,
            createdBy: auth.uid,
            createdAt: serverTimestamp,
            updatedAt: serverTimestamp,
        }));

        transaction.update(invoiceRef, toFirestoreData({
            paidAmount: newPaidAmount,
            remainingAmount: newRemainingAmount,
            status: newInvoiceStatus,
            paymentStatusDerived,
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
                status: newInvoiceStatus,
                totalAmount,
                paidAmount: newPaidAmount,
                remainingAmount: newRemainingAmount,
                updatedAt: serverTimestamp,
            }),
            { merge: true }
        );

        transaction.set(cardLimitLedgerDoc(workspaceId, ledgerEntryId), {
            id: ledgerEntryId,
            workspaceId,
            cardId: payload.cardId,
            sourceType: "payment",
            sourceId: paymentId,
            direction: "restore",
            amount: paymentAmount,
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

        if (cashTransactionRef) {
            transaction.set(cashTransactionRef, toFirestoreData({
                id: cashTransactionRef.id,
                workspaceId,
                profileId: workspaceId,
                userId: auth.uid,
                type: "despesa",
                description: `Pagamento de fatura ${payload.invoiceId}`,
                category: "Pagamento de Cartão",
                value: paymentAmount,
                date: payload.paymentDate,
                isPaid: true,
                cardId: payload.cardId,
                paymentMethod: payload.paymentMethod,
                walletId: payload.walletId,
                cashAccountId: payload.cashAccountId,
                creditCardInvoiceId: payload.invoiceId,
                creditCardInvoicePaymentId: paymentId,
                source: "credit_card_invoice_payment",
                createdAt: serverTimestamp,
                updatedAt: serverTimestamp,
            }));
        }

        const eventPayload = {
            amount: paymentAmount,
            paymentDate: payload.paymentDate,
            paymentMethod: payload.paymentMethod,
            paidAmount: newPaidAmount,
            remainingAmount: newRemainingAmount,
            cashTransactionId: cashTransactionRef?.id,
        };

        transaction.set(cardFinancialEventDoc(workspaceId, eventId), toFirestoreData({
            id: eventId,
            workspaceId,
            cardId: payload.cardId,
            eventType: "invoice_payment_posted",
            invoiceId: payload.invoiceId,
            paymentId,
            ledgerEntryId,
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
            paymentId,
            ledgerEntryId,
            eventType: "invoice_payment_posted",
            payload: eventPayload,
            actorId: auth.uid,
        });

        const result = buildResult(
            paymentId,
            payload.invoiceId,
            ledgerEntryId,
            eventId,
            cashTransactionRef?.id,
            payload.cardId,
            newInvoiceStatus,
            totalAmount,
            newPaidAmount,
            newRemainingAmount,
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