
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import * as api from './api.ts';
import { Transaction, Goal, CreditCard } from '../../types.ts';
import { ReportTimeRange, FinancialReportSnapshot } from './types.ts';
import { useWorkspace } from '../../WorkspaceContext.tsx';
import { Receivable, Client } from '../clients/types.ts';

// Keys for React Query cache management
export const reportKeys = {
    snapshot: (range: string, ws: string) => ['financialReportSnapshot', range, ws],
    alerts: (ws: string) => ['financialAlerts', ws]
};

/**
 * Hook to fetch and calculate the full financial report snapshot.
 */
export const useFinancialReportSnapshot = (
    transactions: Transaction[],
    goals: Goal[],
    creditCards: CreditCard[],
    range: ReportTimeRange,
    receivables?: Receivable[],
    clients?: Client[]
) => {
    const { activeWorkspace } = useWorkspace();
    
    // Create a simple version hash based on list lengths to force refresh when data changes
    const dataVersion = `${transactions.length}-${goals.length}-${creditCards.length}-${receivables?.length || 0}-${clients?.length || 0}`;

    return useQuery({
        queryKey: [...reportKeys.snapshot(range, activeWorkspace.id), dataVersion],
        queryFn: () => api.getFinancialReportSnapshot(transactions, goals, creditCards, range, activeWorkspace, receivables, clients),
        // Keep previous data while fetching new data to avoid flickering
        placeholderData: (previousData) => previousData,
        staleTime: 1000 * 60 * 5, 
        enabled: !!activeWorkspace.id
    });
};

/**
 * Hook to manage financial alerts.
 */
export const useFinancialAlerts = (snapshotData?: FinancialReportSnapshot) => {
    const [readAlertIds, setReadAlertIds] = useState<string[]>([]);
    
    // Since alerts are currently derived from snapshot, we don't need a query here for now.
    // If backend persistence is added for 'read' status, we would use reportKeys.alerts(wsId)

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
        allAlerts: rawAlerts,
        markAsRead,
        totalActive: activeAlerts.length
    };
};

/**
 * Hook to manage the AI Chat interaction with Persistence.
 */
export const useFinanceAIChat = () => {
    const { activeWorkspace } = useWorkspace();
    const STORAGE_KEY = `finance_ai_chat_history_${activeWorkspace.id}`;

    // Initialize from LocalStorage
    const [history, setHistory] = useState<Array<{ id: string; type: 'user' | 'ai'; text: string; timestamp: string }>>([]);

    // Load history when workspace changes
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                setHistory(JSON.parse(saved));
            } else {
                setHistory([]);
            }
        } catch (e) {
            console.error("Failed to load chat history", e);
            setHistory([]);
        }
    }, [STORAGE_KEY]);

    // Save to LocalStorage whenever history changes
    useEffect(() => {
        if (history.length > 0) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
        }
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
                { id: Date.now().toString(), type: 'ai', text: 'Desculpe, tive um problema ao processar sua solicitação. Tente novamente.', timestamp: new Date().toISOString() }
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

export const useReportData = (transactions: Transaction[], range: ReportTimeRange) => {
    return {
        filteredTransactions: transactions, 
        summary: { totalIncome: 0, totalExpense: 0, netResult: 0, savingsRate: 0 },
        isLoading: false
    };
};
