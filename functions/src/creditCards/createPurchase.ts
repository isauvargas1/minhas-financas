import * as admin from "firebase-admin";

import type {
    CreditCardCallableExecutionContext,
} from "./callable";

import type {
    CreateCreditCardPurchasePayload,
} from "./contracts";

import {
    CREDIT_CARD_ADMIN_COLLECTIONS,
    cardFinancialEventDoc,
    cardLimitLedgerDoc,
    cardLimitSnapshotDoc,
    creditCardDoc,
    creditCardInstallmentDoc,
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

export interface CreateCreditCardPurchaseResult {
    success: true;
    purchaseId: string;
    installmentIds: string[];
    invoiceIds: string[];
    ledgerEntryId: string;
    eventId: string;
    limitSnapshot: {
        cardId: string;
        limitTotal: number;
        limitUsed: number;
        limitAvailable: number;
    };
}

interface CreditCardDocumentData {
    id?: string;
    name?: string;
    brand?: string;
    status?: string;
    limitTotal?: number;
    limitUsed?: number;
    limitAvailable?: number;
    closingDay?: number;
    dueDay?: number;
    bestDay?: number;
}

interface InvoiceDraft {
    id: string;
    competenceMonth: string;
    closingDate: string;
    dueDate: string;
    totalAmount: number;
    itemsCount: number;
    installmentIds: string[];
}

interface InstallmentDraft {
    id: string;
    workspaceId: string;
    purchaseId: string;
    cardId: string;
    installmentNumber: number;
    installmentsCount: number;
    amount: number;
    competenceMonth: string;
    invoiceId: string;
    dueDate: string;
    status: "invoiced";
    paidAmount: number;
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

const assertPositiveNumber = (
    value: unknown,
    code: string,
    message: string
): number => {
    const numberValue = Number(value);

    if (!Number.isFinite(numberValue) || numberValue <= 0) {
        throw new CreditCardApplicationError(
            "domain_precondition_failed",
            message,
            { code }
        );
    }

    return numberValue;
};

const assertValidDay = (
    value: unknown,
    code: string,
    message: string
): number => {
    const numberValue = Number(value);

    if (
        !Number.isInteger(numberValue) ||
        numberValue < 1 ||
        numberValue > 31
    ) {
        throw new CreditCardApplicationError(
            "domain_precondition_failed",
            message,
            { code }
        );
    }

    return numberValue;
};

const parseIsoDateParts = (
    value: string
): { year: number; monthIndex: number; day: number } => {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

    if (!match) {
        throw new CreditCardApplicationError(
            "invalid_payload",
            "Data da compra inválida.",
            { field: "purchaseDate" }
        );
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const monthIndex = month - 1;
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

    if (month < 1 || month > 12 || day < 1 || day > lastDay) {
        throw new CreditCardApplicationError(
            "invalid_payload",
            "Data da compra inválida.",
            { field: "purchaseDate" }
        );
    }

    return { year, monthIndex, day };
};

const pad = (value: number): string => String(value).padStart(2, "0");

const formatCompetenceMonth = (
    year: number,
    monthIndex: number
): string => {
    const date = new Date(Date.UTC(year, monthIndex, 1));

    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
};

const addMonthsToCompetence = (
    competenceMonth: string,
    months: number
): string => {
    const [year, month] = competenceMonth.split("-").map(Number);

    return formatCompetenceMonth(year, month - 1 + months);
};

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

const calculateFirstInvoiceCompetence = (
    purchaseDate: string,
    closingDay: number
): string => {
    const parts = parseIsoDateParts(purchaseDate);
    const baseCompetence = formatCompetenceMonth(
        parts.year,
        parts.monthIndex
    );

    return parts.day > closingDay ?
        addMonthsToCompetence(baseCompetence, 1) :
        baseCompetence;
};

const resolvePurchaseTotalAmount = (
    payload: CreateCreditCardPurchasePayload
): number => {
    const inputAmount = normalizeMoney(payload.totalAmount);

    if (payload.amountType === "installment") {
        return normalizeMoney(inputAmount * payload.installmentsCount);
    }

    return inputAmount;
};

const calculateInstallmentAmounts = (
    totalAmount: number,
    installmentsCount: number
): number[] => {
    const baseAmount = normalizeMoney(totalAmount / installmentsCount);
    const amounts: number[] = [];
    let accumulated = 0;

    for (let index = 0; index < installmentsCount; index++) {
        const isLast = index === installmentsCount - 1;
        const amount = isLast ?
            normalizeMoney(totalAmount - accumulated) :
            baseAmount;

        amounts.push(amount);
        accumulated = normalizeMoney(accumulated + amount);
    }

    const calculatedTotal = sumMoney(amounts);

    if (calculatedTotal !== normalizeMoney(totalAmount)) {
        throw new CreditCardApplicationError(
            "domain_precondition_failed",
            "A soma das parcelas não fecha com o valor total da compra.",
            { totalAmount, calculatedTotal }
        );
    }

    return amounts;
};

const buildInstallmentId = (
    purchaseId: string,
    installmentNumber: number
): string =>
    `${purchaseId}_installment_${String(installmentNumber).padStart(3, "0")}`;

const buildInvoiceId = (
    cardId: string,
    competenceMonth: string
): string => `${cardId}_${competenceMonth}`;

const buildPurchaseInstallments = (
    workspaceId: string,
    purchaseId: string,
    cardId: string,
    totalAmount: number,
    installmentsCount: number,
    firstInvoiceCompetence: string,
    dueDay: number
): InstallmentDraft[] => {
    const amounts = calculateInstallmentAmounts(totalAmount, installmentsCount);

    return amounts.map((amount, index) => {
        const installmentNumber = index + 1;
        const competenceMonth = addMonthsToCompetence(
            firstInvoiceCompetence,
            index
        );
        const invoiceId = buildInvoiceId(cardId, competenceMonth);

        return {
            id: buildInstallmentId(purchaseId, installmentNumber),
            workspaceId,
            purchaseId,
            cardId,
            installmentNumber,
            installmentsCount,
            amount,
            competenceMonth,
            invoiceId,
            dueDate: formatDateWithSafeDay(competenceMonth, dueDay),
            status: "invoiced",
            paidAmount: 0,
        };
    });
};

const buildInvoiceDrafts = (
    cardId: string,
    installments: InstallmentDraft[],
    closingDay: number,
    dueDay: number
): InvoiceDraft[] => {
    const grouped = new Map<string, InstallmentDraft[]>();

    installments.forEach((installment) => {
        const current = grouped.get(installment.competenceMonth) ?? [];
        current.push(installment);
        grouped.set(installment.competenceMonth, current);
    });

    return Array.from(grouped.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([competenceMonth, invoiceInstallments]) => ({
            id: buildInvoiceId(cardId, competenceMonth),
            competenceMonth,
            closingDate: formatDateWithSafeDay(competenceMonth, closingDay),
            dueDate: formatDateWithSafeDay(competenceMonth, dueDay),
            totalAmount: sumMoney(
                invoiceInstallments.map((installment) => installment.amount)
            ),
            itemsCount: invoiceInstallments.length,
            installmentIds: invoiceInstallments.map((installment) => installment.id),
        }));
};

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
    purchaseId: string,
    installments: InstallmentDraft[],
    invoices: InvoiceDraft[],
    ledgerEntryId: string,
    eventId: string,
    cardId: string,
    limitTotal: number,
    limitUsed: number,
    limitAvailable: number
): CreateCreditCardPurchaseResult => ({
    success: true,
    purchaseId,
    installmentIds: installments.map((installment) => installment.id),
    invoiceIds: invoices.map((invoice) => invoice.id),
    ledgerEntryId,
    eventId,
    limitSnapshot: {
        cardId,
        limitTotal,
        limitUsed,
        limitAvailable,
    },
});

export const executeCreateCreditCardPurchase = async (
    context: CreditCardCallableExecutionContext<CreateCreditCardPurchasePayload>
): Promise<CreateCreditCardPurchaseResult | Record<string, unknown>> => {
    const { payload, auth } = context;
    const db = getFirestore();
    const operation = "createCreditCardPurchase";

    return db.runTransaction(async (transaction) => {
        const workspaceId = payload.workspaceId;
        const cardRef = creditCardDoc(workspaceId, payload.cardId);
        const cardSnapshotRef = cardLimitSnapshotDoc(
            workspaceId,
            payload.cardId
        );

        const [cardSnapshot, limitSnapshot] = await Promise.all([
            transaction.get(cardRef),
            transaction.get(cardSnapshotRef),
        ]);

        if (!cardSnapshot.exists) {
            throw new CreditCardApplicationError(
                "not_found",
                "Cartão não encontrado.",
                { cardId: payload.cardId }
            );
        }

        const cardData = cardSnapshot.data() as CreditCardDocumentData;

        if (cardData.status !== "active") {
            throw new CreditCardApplicationError(
                "domain_precondition_failed",
                "A compra só pode ser lançada em cartão ativo.",
                { cardId: payload.cardId, status: cardData.status }
            );
        }

        const limitTotal = normalizeMoney(assertPositiveNumber(
            cardData.limitTotal,
            "invalid_card_limit_total",
            "O limite total do cartão precisa ser maior que zero."
        ));
        const closingDay = assertValidDay(
            cardData.closingDay,
            "invalid_card_closing_day",
            "O dia de fechamento do cartão é inválido."
        );
        const dueDay = assertValidDay(
            cardData.dueDay,
            "invalid_card_due_day",
            "O dia de vencimento do cartão é inválido."
        );
        const purchaseTotalAmount = resolvePurchaseTotalAmount(payload);
        const snapshotData = limitSnapshot.exists ?
            limitSnapshot.data() :
            undefined;
        const currentLimitUsed = normalizeMoney(
            Number(snapshotData?.limitUsed ?? cardData.limitUsed ?? 0)
        );
        const currentLimitAvailable = normalizeMoney(
            Number(
                snapshotData?.limitAvailable ??
                cardData.limitAvailable ??
                limitTotal - currentLimitUsed
            )
        );

        if (currentLimitAvailable < purchaseTotalAmount) {
            throw new CreditCardApplicationError(
                "domain_precondition_failed",
                "Limite disponível insuficiente para esta compra.",
                {
                    cardId: payload.cardId,
                    currentLimitAvailable,
                    purchaseTotalAmount,
                }
            );
        }

        const purchaseRef = workspaceCollection(
            workspaceId,
            CREDIT_CARD_ADMIN_COLLECTIONS.purchases
        ).doc();
        const purchaseId = purchaseRef.id;

        const firstInvoiceCompetence = calculateFirstInvoiceCompetence(
            payload.purchaseDate,
            closingDay
        );
        const installments = buildPurchaseInstallments(
            workspaceId,
            purchaseId,
            payload.cardId,
            purchaseTotalAmount,
            payload.installmentsCount,
            firstInvoiceCompetence,
            dueDay
        );
        const invoices = buildInvoiceDrafts(
            payload.cardId,
            installments,
            closingDay,
            dueDay
        );
        const invoiceRefs = invoices.map((invoice) =>
            creditCardInvoiceDoc(workspaceId, invoice.id)
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

        const ledgerEntryId = `${purchaseId}_limit_consume`;
        const eventId = `${purchaseId}_purchase_created`;
        const newLimitUsed = normalizeMoney(
            currentLimitUsed + purchaseTotalAmount
        );
        const newLimitAvailable = normalizeMoney(
            currentLimitAvailable - purchaseTotalAmount
        );
        const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();

        transaction.set(purchaseRef, toFirestoreData({
            id: purchaseId,
            workspaceId,
            cardId: payload.cardId,
            description: payload.description,
            categoryId: payload.categoryId,
            categorySnapshot: payload.categorySnapshot,
            supplier: payload.supplier,
            costCenter: payload.costCenter,
            purchaseDate: payload.purchaseDate,
            totalAmount: purchaseTotalAmount,
            installmentsCount: payload.installmentsCount,
            amountType: payload.amountType,
            firstInvoiceCompetence,
            source: payload.source,
            status: "active",
            createdBy: auth.uid,
            updatedBy: auth.uid,
            idempotencyKey: payload.idempotencyKey,
            createdAt: serverTimestamp,
            updatedAt: serverTimestamp,
        }));

        installments.forEach((installment) => {
            transaction.set(
                creditCardInstallmentDoc(workspaceId, installment.id),
                toFirestoreData({
                    ...installment,
                    createdAt: serverTimestamp,
                    updatedAt: serverTimestamp,
                })
            );
        });

        invoices.forEach((invoice, index) => {
            const existingInvoice = invoiceSnapshots[index];
            const invoiceRef = invoiceRefs[index];

            if (existingInvoice.exists) {
                const existingData = existingInvoice.data();

                if (!existingData) {
                    throw new CreditCardApplicationError(
                        "internal",
                        "Fatura existente sem dados carregados.",
                        { invoiceId: invoice.id }
                    );
                }

                const existingStatus = existingData.status;

                if (existingStatus !== "open") {
                    throw new CreditCardApplicationError(
                        "domain_precondition_failed",
                        "Não é permitido adicionar compra em fatura não aberta.",
                        { invoiceId: invoice.id, status: existingStatus }
                    );
                }

                const totalAmount = normalizeMoney(
                    Number(existingData.totalAmount ?? 0) + invoice.totalAmount
                );
                const paidAmount = normalizeMoney(Number(
                    existingData.paidAmount ?? 0
                ));
                const remainingAmount = normalizeMoney(totalAmount - paidAmount);
                const itemsCount = Number(existingData.itemsCount ?? 0) +
                    invoice.itemsCount;

                transaction.update(invoiceRef, {
                    totalAmount,
                    paidAmount,
                    remainingAmount,
                    itemsCount,
                    paymentStatusDerived: derivePaymentStatus(
                        totalAmount,
                        paidAmount
                    ),
                    updatedAt: serverTimestamp,
                });

                transaction.set(
                    creditCardInvoiceViewDoc(workspaceId, invoice.id),
                    toFirestoreData({
                        id: invoice.id,
                        workspaceId,
                        cardId: payload.cardId,
                        competenceMonth: invoice.competenceMonth,
                        dueDate: invoice.dueDate,
                        status: existingStatus,
                        totalAmount,
                        paidAmount,
                        remainingAmount,
                        cardName: cardData.name,
                        cardBrand: cardData.brand,
                        updatedAt: serverTimestamp,
                    }),
                    { merge: true }
                );

                return;
            }

            transaction.set(invoiceRef, toFirestoreData({
                id: invoice.id,
                workspaceId,
                cardId: payload.cardId,
                competenceMonth: invoice.competenceMonth,
                closingDate: invoice.closingDate,
                dueDate: invoice.dueDate,
                status: "open",
                totalAmount: invoice.totalAmount,
                paidAmount: 0,
                remainingAmount: invoice.totalAmount,
                itemsCount: invoice.itemsCount,
                paymentStatusDerived: "unpaid",
                generatedAt: serverTimestamp,
                createdAt: serverTimestamp,
                updatedAt: serverTimestamp,
            }));
            transaction.set(
                creditCardInvoiceViewDoc(workspaceId, invoice.id),
                toFirestoreData({
                    id: invoice.id,
                    workspaceId,
                    cardId: payload.cardId,
                    competenceMonth: invoice.competenceMonth,
                    dueDate: invoice.dueDate,
                    status: "open",
                    totalAmount: invoice.totalAmount,
                    paidAmount: 0,
                    remainingAmount: invoice.totalAmount,
                    cardName: cardData.name,
                    cardBrand: cardData.brand,
                    createdAt: serverTimestamp,
                    updatedAt: serverTimestamp,
                })
            );
        });

        transaction.set(cardLimitLedgerDoc(workspaceId, ledgerEntryId), toFirestoreData({
            id: ledgerEntryId,
            workspaceId,
            cardId: payload.cardId,
            sourceType: "purchase",
            sourceId: purchaseId,
            direction: "consume",
            amount: purchaseTotalAmount,
            balanceAfter: newLimitAvailable,
            createdAt: serverTimestamp,
            actorId: auth.uid,
            idempotencyKey: payload.idempotencyKey,
        }));

        transaction.set(cardSnapshotRef, toFirestoreData({
            workspaceId,
            cardId: payload.cardId,
            limitTotal,
            limitUsed: newLimitUsed,
            limitAvailable: newLimitAvailable,
            updatedAt: serverTimestamp,
        }));

        const limitUtilizationRate = limitTotal > 0 ?
            normalizeMoney((newLimitUsed / limitTotal) * 100) :
            0;

        const eventPayload = {
            description: payload.description,
            totalAmount: purchaseTotalAmount,
            installmentsCount: payload.installmentsCount,
            firstInvoiceCompetence,
            limitTotal,
            limitUsed: newLimitUsed,
            limitAvailable: newLimitAvailable,
            utilizationRate: limitUtilizationRate,
        };

        transaction.set(cardFinancialEventDoc(workspaceId, eventId), toFirestoreData({
            id: eventId,
            workspaceId,
            cardId: payload.cardId,
            eventType: "purchase_created",
            purchaseId,
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
            eventType: "purchase_created",
            purchaseId,
            ledgerEntryId,
            payload: eventPayload,
            actorId: auth.uid,
        });

        const result = buildResult(
            purchaseId,
            installments,
            invoices,
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