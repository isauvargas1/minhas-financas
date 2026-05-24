import * as admin from "firebase-admin";

import {
    workspaceDoc,
} from "./adminPaths";

type DomainNotificationType =
    | "credit_card"
    | "info"
    | "success"
    | "warning"
    | "error";

interface CreditCardDomainEventForNotification {
    id: string;
    workspaceId: string;
    eventType: string;
    cardId?: string;
    invoiceId?: string;
    purchaseId?: string;
    paymentId?: string;
    ledgerEntryId?: string;
    payload?: Record<string, unknown>;
    actorId?: string;
}

interface DomainNotificationDraft {
    suffix: string;
    title: string;
    message: string;
    type: DomainNotificationType;
    actionLabel?: string;
    link?: string;
}

const normalizeMoney = (value: number): number =>
    Math.round((value + Number.EPSILON) * 100) / 100;

const formatCurrency = (value: number): string =>
    new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
    }).format(value);

const getPayloadNumber = (
    payload: Record<string, unknown> | undefined,
    key: string
): number | undefined => {
    const value = payload?.[key];

    return typeof value === "number" && Number.isFinite(value) ?
        value :
        undefined;
};

const getPayloadString = (
    payload: Record<string, unknown> | undefined,
    key: string
): string | undefined => {
    const value = payload?.[key];

    return typeof value === "string" && value.trim() ?
        value.trim() :
        undefined;
};

const stripUndefinedValues = (
    value: Record<string, unknown>
): admin.firestore.DocumentData =>
    Object.fromEntries(
        Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
    );

const buildNotificationId = (
    event: CreditCardDomainEventForNotification,
    suffix: string
): string => `${event.id}_${suffix}`.replace(/[^\w-]/g, "_");

const buildLimitUsageNotification = (
    event: CreditCardDomainEventForNotification
): DomainNotificationDraft | null => {
    const limitUsed = getPayloadNumber(event.payload, "limitUsed");
    const limitTotal = getPayloadNumber(event.payload, "limitTotal");

    if (!limitUsed || !limitTotal || limitTotal <= 0) {
        return null;
    }

    const utilizationRate = normalizeMoney((limitUsed / limitTotal) * 100);

    if (utilizationRate < 75) {
        return null;
    }

    const isCritical = utilizationRate >= 90;

    return {
        suffix: isCritical ? "limit_critical" : "limit_warning",
        title: isCritical ?
            "Cartão em utilização crítica" :
            "Cartão próximo do limite",
        message: `O cartão atingiu ${utilizationRate.toFixed(0)}% de utilização do limite.`,
        type: isCritical ? "warning" : "credit_card",
        actionLabel: "Ver cartão",
        link: "cards",
    };
};

const buildCreditCardDomainNotificationDrafts = (
    event: CreditCardDomainEventForNotification
): DomainNotificationDraft[] => {
    const amount = getPayloadNumber(event.payload, "amount") ??
        getPayloadNumber(event.payload, "totalAmount");
    const description = getPayloadString(event.payload, "description");
    const remainingAmount = getPayloadNumber(event.payload, "remainingAmount");

    switch (event.eventType) {
        case "purchase_created": {
            const drafts: DomainNotificationDraft[] = [
                {
                    suffix: "purchase_created",
                    title: "Compra lançada no cartão",
                    message: `${description || "Compra"} lançada no cartão${amount ? ` no valor de ${formatCurrency(amount)}` : ""}.`,
                    type: "credit_card",
                    actionLabel: "Ver cartão",
                    link: "cards",
                },
            ];

            const limitDraft = buildLimitUsageNotification(event);
            if (limitDraft) drafts.push(limitDraft);

            return drafts;
        }

        case "invoice_closed":
            return [
                {
                    suffix: "invoice_closed",
                    title: "Fatura fechada",
                    message: `Fatura consolidada${amount ? ` no valor de ${formatCurrency(amount)}` : ""}.`,
                    type: "credit_card",
                    actionLabel: "Ver faturas",
                    link: "cards",
                },
            ];

        case "invoice_payment_posted": {
            const isPartial = typeof remainingAmount === "number" && remainingAmount > 0;

            return [
                {
                    suffix: isPartial ? "invoice_payment_partial" : "invoice_payment_paid",
                    title: isPartial ? "Pagamento parcial registrado" : "Fatura paga",
                    message: `${isPartial ? "Pagamento parcial" : "Pagamento total"} de fatura registrado${amount ? ` no valor de ${formatCurrency(amount)}` : ""}.`,
                    type: isPartial ? "warning" : "success",
                    actionLabel: "Ver fatura",
                    link: "cards",
                },
            ];
        }

        case "invoice_payment_reversed":
            return [
                {
                    suffix: "invoice_payment_reversed",
                    title: "Pagamento de fatura estornado",
                    message: `Estorno registrado${amount ? ` no valor de ${formatCurrency(amount)}` : ""}.`,
                    type: "warning",
                    actionLabel: "Ver fatura",
                    link: "cards",
                },
            ];

        case "reconciliation_warning":
            return [
                {
                    suffix: "reconciliation_warning",
                    title: "Divergência de reconciliação",
                    message: "Uma operação de reconciliação do domínio de cartão foi executada. Confira os dados do cartão.",
                    type: "warning",
                    actionLabel: "Ver cartão",
                    link: "cards",
                },
            ];

        case "invoice_due_soon": {
            const dueDate = getPayloadString(event.payload, "dueDate");
            const daysUntilDue = getPayloadNumber(event.payload, "daysUntilDue");
            const remainingAmount = getPayloadNumber(event.payload, "remainingAmount");

            const dueLabel = daysUntilDue === 0 ?
                "vence hoje" :
                `vence em ${daysUntilDue} dia(s)`;

            return [
                {
                    suffix: `invoice_due_soon_${dueDate || "unknown"}_${daysUntilDue ?? "x"}`,
                    title: "Fatura próxima do vencimento",
                    message: `Uma fatura ${dueLabel}${remainingAmount ? ` com saldo de ${formatCurrency(remainingAmount)}` : ""}.`,
                    type: "warning",
                    actionLabel: "Ver fatura",
                    link: "cards",
                },
            ];
        }

        case "invoice_overdue": {
            const dueDate = getPayloadString(event.payload, "dueDate");
            const remainingAmount = getPayloadNumber(event.payload, "remainingAmount");

            return [
                {
                    suffix: "invoice_overdue",
                    title: "Fatura vencida",
                    message: `Uma fatura venceu${dueDate ? ` em ${dueDate}` : ""}${remainingAmount ? ` com saldo de ${formatCurrency(remainingAmount)}` : ""}.`,
                    type: "error",
                    actionLabel: "Ver fatura",
                    link: "cards",
                },
            ];
        }

        case "processing_failure":
            return [
                {
                    suffix: "processing_failure",
                    title: "Falha de processamento financeiro",
                    message: "Uma automação do domínio de cartão falhou. Verifique os dados do cartão ou tente novamente.",
                    type: "error",
                    actionLabel: "Ver cartão",
                    link: "cards",
                },
            ];

        case "purchase_limit_exceeded": {
            const requestedAmount = getPayloadNumber(event.payload, "requestedAmount");
            const availableLimit = getPayloadNumber(event.payload, "availableLimit");
            const missingAmount = getPayloadNumber(event.payload, "missingAmount");
            const description = getPayloadString(event.payload, "description");

            return [
                {
                    suffix: "purchase_limit_exceeded",
                    title: "Compra bloqueada por limite insuficiente",
                    message:
                        `${description || "Compra"} não foi lançada porque o limite disponível` +
                        `${availableLimit !== undefined ? ` era ${formatCurrency(availableLimit)}` : ""}` +
                        `${requestedAmount !== undefined ? ` e o valor solicitado era ${formatCurrency(requestedAmount)}` : ""}` +
                        `${missingAmount !== undefined ? `. Faltaram ${formatCurrency(missingAmount)} de limite.` : "."}`,
                    type: "warning",
                    actionLabel: "Ver cartão",
                    link: "cards",
                },
            ];
        }

        default:
            return [];
    }
};

export const enqueueCreditCardDomainNotifications = (
    transaction: admin.firestore.Transaction,
    event: CreditCardDomainEventForNotification
): void => {
    const drafts = buildCreditCardDomainNotificationDrafts(event);

    drafts.forEach((draft) => {
        const notificationId = buildNotificationId(event, draft.suffix);
        const notificationRef = workspaceDoc(event.workspaceId)
            .collection("notifications")
            .doc(notificationId);

        transaction.set(notificationRef, stripUndefinedValues({
            id: notificationId,
            workspaceId: event.workspaceId,
            title: draft.title,
            message: draft.message,
            type: draft.type,
            read: false,
            link: draft.link,
            actionLabel: draft.actionLabel,
            createdAt: new Date().toISOString(),

            source: "credit_card_domain_event",
            domain: "credit_card",
            domainEventId: event.id,
            domainEventType: event.eventType,
            cardId: event.cardId,
            invoiceId: event.invoiceId,
            purchaseId: event.purchaseId,
            paymentId: event.paymentId,
            ledgerEntryId: event.ledgerEntryId,
            actorId: event.actorId,
        }));
    });
};