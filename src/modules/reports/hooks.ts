import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import * as api from './api';
import { Transaction, Goal, CreditCard } from '../../types';
import {
    ReportTimeRange,
    FinancialReportSnapshot,
    CreditCardReportDomainData,
    CreditCardReportDomainMeta,
} from './types';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { resolveReportDateRange } from './logic';
import { Receivable, Client } from '../clients/types';
import {
    listCreditCardInstallmentsForReports,
    listCreditCardInvoicePaymentsForReports,
    listCreditCardInvoicesForReports,
    listCreditCardPurchasesForReports,
} from '../credit-cards/persistence/readApi';
import { getOfficialInvestmentReportData } from '../investments/persistence/readApi';

export const reportKeys = {
    snapshot: (range: string, ws: string) => ['financialReportSnapshot', range, ws],
    creditCardDomain: (range: string, ws: string) => ['financialReportCreditCardDomain', range, ws],
    investmentDomain: (range: string, ws: string) => ['financialReportInvestmentDomain', range, ws],
};


const buildTransactionsVersion = (transactions: Transaction[]): string =>
    transactions
        .map((transaction) => [
            transaction.id,
            transaction.type,
            transaction.value,
            transaction.date,
            transaction.isPaid,
            transaction.source,
            transaction.creditCardInvoiceId,
            transaction.creditCardInvoicePaymentId,
        ].join(':'))
        .join('|');

const buildCreditCardsVersion = (creditCards: CreditCard[]): string =>
    creditCards
        .map((card) => [
            card.id,
            card.status,
            card.limitTotal,
            card.limitUsed,
            card.limitAvailable,
            card.closingDay,
            card.dueDay,
        ].join(':'))
        .join('|');

const buildGoalsVersion = (goals: Goal[]): string =>
    goals
        .map((goal) => [
            goal.id,
            goal.name,
            goal.currentAmount,
            goal.targetAmount,
            goal.status,
        ].join(':'))
        .join('|');

const buildReceivablesVersion = (receivables?: Receivable[]): string =>
    (receivables || [])
        .map((receivable) => [
            receivable.id,
            receivable.status,
            receivable.value,
            receivable.dueDate,
        ].join(':'))
        .join('|');

const buildClientsVersion = (clients?: Client[]): string =>
    (clients || [])
        .map((client) => [
            client.id,
            client.name,
        ].join(':'))
        .join('|');

        const CREDIT_CARD_REPORT_QUERY_LIMITS = {
    purchases: 5000,
    invoices: 2500,
    installments: 5000,
    payments: 2500,
};

type CreditCardReportDomainCollectionKey = keyof typeof CREDIT_CARD_REPORT_QUERY_LIMITS;

const buildCreditCardReportDomainMeta = (
    range: ReportTimeRange,
    dateRange: ReturnType<typeof resolveReportDateRange>,
    collectionSizes: Record<CreditCardReportDomainCollectionKey, number>,
): CreditCardReportDomainMeta => {
    const truncated = {
        purchases: collectionSizes.purchases >= CREDIT_CARD_REPORT_QUERY_LIMITS.purchases,
        invoices: collectionSizes.invoices >= CREDIT_CARD_REPORT_QUERY_LIMITS.invoices,
        installments: collectionSizes.installments >= CREDIT_CARD_REPORT_QUERY_LIMITS.installments,
        payments: collectionSizes.payments >= CREDIT_CARD_REPORT_QUERY_LIMITS.payments,
    };

    return {
        range,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        isAllTime: dateRange.isAllTime,
        limits: { ...CREDIT_CARD_REPORT_QUERY_LIMITS },
        truncated,
        isTruncated: Object.values(truncated).some(Boolean),
    };
};

export interface FinancialReportSnapshotOptions {
    /**
     * Carregar o domínio patrimonial junto do snapshot (INV-P2-035).
     *
     * O widget do dashboard usa apenas `kpi-balance`, `kpi-savings` e alertas —
     * nada que venha do domínio patrimonial. Como ele monta na mesma tela que
     * `InvestmentDashboardOverview`, o dashboard disparava **duas** cargas
     * independentes do resumo, dos períodos e das alocações. Consumidores que
     * não exibem indicadores patrimoniais passam a dizê-lo.
     */
    includeInvestmentDomain?: boolean;
}

export const useFinancialReportSnapshot = (
    transactions: Transaction[],
    goals: Goal[],
    creditCards: CreditCard[],
    range: ReportTimeRange,
    receivables?: Receivable[],
    clients?: Client[],
    options: FinancialReportSnapshotOptions = {}
) => {
    const includeInvestmentDomain = options.includeInvestmentDomain !== false;
    const { activeWorkspace } = useWorkspace();


    const workspaceId = activeWorkspace?.id;
    const investmentsV2Enabled = activeWorkspace?.features?.investmentsV2?.enabled === true;

    const investmentDomainQuery = useQuery({
        queryKey: workspaceId && workspaceId !== 'loading'
            ? reportKeys.investmentDomain(range, workspaceId)
            : ['financialReportInvestmentDomain', 'disabled'],
        queryFn: () => getOfficialInvestmentReportData(workspaceId!, {
            periodLimit: range === 'all' ? 100 : range === '12m' || range === 'ytd' ? 14 : range === '90d' ? 5 : 3,
        }),
        enabled: Boolean(workspaceId) && workspaceId !== 'loading' &&
            investmentsV2Enabled && includeInvestmentDomain,
        staleTime: 1000 * 60 * 2,
    });

        const creditCardDomainQuery = useQuery({
        queryKey: workspaceId && workspaceId !== 'loading'
            ? reportKeys.creditCardDomain(range, workspaceId)
            : ['financialReportCreditCardDomain', range, 'disabled'],
        queryFn: async (): Promise<CreditCardReportDomainData> => {
            if (!workspaceId || workspaceId === 'loading') {
                return EMPTY_CREDIT_CARD_REPORT_DOMAIN_DATA;
            }

            const dateRange = resolveReportDateRange(range);
            const dateRangeOptions = dateRange.isAllTime
                ? {}
                : {
                    startDate: dateRange.startDate,
                    endDate: dateRange.endDate,
                };

            const [purchases, invoices, installments, payments] = await Promise.all([
                listCreditCardPurchasesForReports(workspaceId, {
                    ...dateRangeOptions,
                    limit: CREDIT_CARD_REPORT_QUERY_LIMITS.purchases,
                }),
                listCreditCardInvoicesForReports(workspaceId, {
                    ...dateRangeOptions,
                    limit: CREDIT_CARD_REPORT_QUERY_LIMITS.invoices,
                }),
                listCreditCardInstallmentsForReports(workspaceId, {
                    ...dateRangeOptions,
                    limit: CREDIT_CARD_REPORT_QUERY_LIMITS.installments,
                }),
                listCreditCardInvoicePaymentsForReports(workspaceId, {
                    ...dateRangeOptions,
                    limit: CREDIT_CARD_REPORT_QUERY_LIMITS.payments,
                }),
            ]);

            return {
                purchases,
                invoices,
                installments,
                payments,
                meta: buildCreditCardReportDomainMeta(
                    range,
                    dateRange,
                    {
                        purchases: purchases.length,
                        invoices: invoices.length,
                        installments: installments.length,
                        payments: payments.length,
                    }
                ),
            };
        },
        enabled: Boolean(workspaceId) && workspaceId !== 'loading',
        staleTime: 1000 * 60 * 2,
    });

    const creditCardDomainData =
        creditCardDomainQuery.data ?? EMPTY_CREDIT_CARD_REPORT_DOMAIN_DATA;

    const dataVersion = [
        buildTransactionsVersion(transactions),
        buildGoalsVersion(goals),
        buildCreditCardsVersion(creditCards),
        buildReceivablesVersion(receivables),
        buildClientsVersion(clients),
        buildCreditCardDomainVersion(creditCardDomainData),
        investmentsV2Enabled ? String(investmentDomainQuery.dataUpdatedAt) : 'legacy-investments',
    ].join('::');

    return useQuery({
        queryKey: workspaceId && workspaceId !== 'loading'
            ? [...reportKeys.snapshot(range, workspaceId), dataVersion]
            : ['financialReportSnapshot', range, 'disabled', dataVersion],
        queryFn: () => {
            if (investmentsV2Enabled && investmentDomainQuery.isError) {
                throw new Error('Não foi possível carregar o domínio patrimonial.');
            }
            return api.getFinancialReportSnapshot(
                transactions,
                goals,
                creditCards,
                range,
                activeWorkspace,
                receivables,
                clients,
                creditCardDomainData,
                investmentsV2Enabled ? investmentDomainQuery.data : undefined,
            );
        },
        enabled: Boolean(workspaceId) && workspaceId !== 'loading' &&
            !creditCardDomainQuery.isLoading &&
            (!investmentsV2Enabled || !investmentDomainQuery.isLoading),
        staleTime: 1000 * 60 * 5
    });
};

const EMPTY_CREDIT_CARD_REPORT_DOMAIN_DATA: CreditCardReportDomainData = {
    purchases: [],
    invoices: [],
    installments: [],
    payments: [],
};

const buildCreditCardDomainVersion = (
    data: CreditCardReportDomainData,
): string =>
    [

        data.purchases
            .map((purchase) => [
                purchase.id,
                purchase.cardId,
                purchase.status,
                purchase.purchaseDate,
                purchase.totalAmount,
                purchase.installmentsCount,
            ].join(':'))
            .join('|'),

        data.invoices
            .map((invoice) => [
                invoice.id,
                invoice.cardId,
                invoice.status,
                invoice.totalAmount,
                invoice.paidAmount,
                invoice.remainingAmount,
                invoice.dueDate,
            ].join(':'))
            .join('|'),
        data.installments
            .map((installment) => [
                installment.id,
                installment.cardId,
                installment.purchaseId,
                installment.invoiceId,
                installment.status,
                installment.amount,
                installment.dueDate,
                installment.competenceMonth,
            ].join(':'))
            .join('|'),
        data.payments
            .map((payment) => [
                payment.id,
                payment.cardId,
                payment.invoiceId,
                payment.status,
                payment.amount,
                payment.paymentDate,
            ].join(':'))
            .join('|'),
    ].join('::');

export const useFinancialAlerts = (snapshotData?: FinancialReportSnapshot) => {
    const [readAlertIds, setReadAlertIds] = useState<string[]>([]);

    const rawAlerts = snapshotData?.alerts || [];

    const activeAlerts = useMemo(() => {
        return rawAlerts.filter(a => !readAlertIds.includes(a.id));
    }, [rawAlerts, readAlertIds]);

    const markAsRead = useCallback((id: string) => {
        setReadAlertIds(prev => [...prev, id]);
        api.markAlertAsRead(id);
    }, []);

    return {
        alerts: activeAlerts,
        totalActive: activeAlerts.length,
        markAsRead
    };
};

export const useFinanceAIChat = () => {
    const { activeWorkspace } = useWorkspace();
    const STORAGE_KEY = `finance_ai_chat_history_${activeWorkspace.id}`;

    const [history, setHistory] = useState<Array<{ id: string; type: 'user' | 'ai'; text: string; timestamp: string }>>([]);

    // Load History
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) setHistory(JSON.parse(saved));
        } catch (e) { console.error(e); }
    }, [STORAGE_KEY]);

    // Save History
    useEffect(() => {
        if (history.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    }, [history, STORAGE_KEY]);

    const mutation = useMutation({
        mutationFn: (params: { question: string; context: FinancialReportSnapshot }) =>
            api.askFinanceAI(params.question, params.context, activeWorkspace.id),
        onSuccess: (data) => {
            setHistory(prev => [
                ...prev,
                { id: data.id || Date.now().toString(), type: 'ai', text: data.answer, timestamp: new Date().toISOString() }
            ]);
        },
        onError: () => {
            setHistory(prev => [
                ...prev,
                { id: Date.now().toString(), type: 'ai', text: 'Erro ao consultar a IA. Verifique sua chave API ou tente novamente.', timestamp: new Date().toISOString() }
            ]);
        }
    });

    const sendQuestion = useCallback((question: string, context: FinancialReportSnapshot) => {
        if (!question.trim()) return;

        const userMsg = {
            id: Date.now().toString(),
            type: 'user' as const,
            text: question,
            timestamp: new Date().toISOString()
        };
        setHistory(prev => [...prev, userMsg]);

        mutation.mutate({ question, context });
    }, [mutation]);

    const clearHistory = useCallback(() => {
        setHistory([]);
        localStorage.removeItem(STORAGE_KEY);
        mutation.reset();
    }, [STORAGE_KEY, mutation]);

    return {
        history,
        isLoading: mutation.isPending,
        isError: mutation.isError,
        sendQuestion,
        clearHistory
    };
};
