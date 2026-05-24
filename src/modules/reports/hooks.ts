import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import * as api from './api';
import { Transaction, Goal, CreditCard } from '../../types';
import { ReportTimeRange, FinancialReportSnapshot } from './types';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { Receivable, Client } from '../clients/types';

export const reportKeys = {
    snapshot: (range: string, ws: string) => ['financialReportSnapshot', range, ws],
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

export const useFinancialReportSnapshot = (
    transactions: Transaction[],
    goals: Goal[],
    creditCards: CreditCard[],
    range: ReportTimeRange,
    receivables?: Receivable[],
    clients?: Client[]
) => {
    const { activeWorkspace } = useWorkspace();


    const dataVersion = [
        buildTransactionsVersion(transactions),
        buildGoalsVersion(goals),
        buildCreditCardsVersion(creditCards),
        buildReceivablesVersion(receivables),
        buildClientsVersion(clients),
    ].join('::');
    
    return useQuery({
        queryKey: [...reportKeys.snapshot(range, activeWorkspace.id), dataVersion],
        queryFn: () => api.getFinancialReportSnapshot(
            transactions,
            goals,
            creditCards,
            range,
            activeWorkspace,
            receivables,
            clients
        ),
        enabled: !!activeWorkspace.id,
        staleTime: 1000 * 60 * 5 // Cache de 5 min
    });
};

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
            api.askFinanceAI(params.question, params.context),
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
        sendQuestion,
        clearHistory
    };
};