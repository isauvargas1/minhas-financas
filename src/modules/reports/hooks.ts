import { useEffect, useMemo, useRef, useState } from 'react';
import { hashKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { collection, doc, documentId, limit, onSnapshot, query, where } from 'firebase/firestore';
import * as api from './api';
import { toReportSnapshot, type ReportAdapterResult } from './adapter';
import { fetchFinancialReport } from './officialApi';
import type { FinancialReport, ReportRange, ReportSection } from './official';
import {
    financialReportKey,
    invalidateFinancialReportBases,
    invalidateFinancialReports,
    nextFinancialReportOrder,
    noteFinancialReportFetchStart,
    refreshFinancialReportsAfterChange,
} from './queryKeys';
import { presetRange, rangeKey, sectionsKey } from './range';
import { saoPauloMonthKey } from './dateWindow';
import { createLiveRefreshScheduler } from './liveRefresh';
import { BASIS_PERIODS_MAX, type BasisSyncDeps } from './basisSync';
import { FinancialReportSnapshot, ReportTimeRange } from './types';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../lib/firebase';
import { resolveAiChatScope } from './aiChatStorage';
import { useScopedAiChat } from './aiChatSession';

export { invalidateFinancialReports } from './queryKeys';

/**
 * Relatório financeiro oficial (P5-C1): uma callable, um contrato, os mesmos
 * números no Dashboard e nos Relatórios. A chave de cache inclui usuário,
 * workspace e papel — o papel muda o que o servidor entrega (investimentos) —
 * e só habilita a consulta com sessão e workspace carregados para ela.
 */
export const useFinancialReport = (
    range: ReportRange,
    sections?: readonly ReportSection[],
    options: { enabled?: boolean } = {},
) => {
    const { user } = useAuth();
    const { activeWorkspace, activeWorkspaceUid, activeWorkspaceRole } = useWorkspace();
    const uid = user?.uid ?? null;
    const workspaceId = activeWorkspace?.id ?? '';
    const ready = uid !== null &&
        activeWorkspaceUid === uid &&
        workspaceId !== '' &&
        workspaceId !== 'loading';
    return useQuery<FinancialReport>({
        queryKey: financialReportKey(
            uid ?? '',
            workspaceId,
            activeWorkspaceRole ?? 'unknown',
            rangeKey(range),
            sectionsKey(sections),
        ),
        queryFn: ({ queryKey }) => {
            // Ordem do começo da leitura, para a releitura pela escuta (`refreshFinancialReportsAfterChange`).
            noteFinancialReportFetchStart(hashKey(queryKey));
            return fetchFinancialReport({
                workspaceId,
                range,
                ...(sections ? { sections: [...sections] } : {}),
            });
        },
        enabled: ready && (options.enabled ?? true),
        staleTime: 30_000,
        retry: 1,
    });
};

/**
 * Dependências reais das bases de longa duração (P5-F.1): a callable do
 * relatório oficial e a escuta das projeções mensais de caixa, com os
 * metadados de cache (o retorno só do cache local não conta). A lógica fica
 * em `./basisSync.ts`, testada com uma API em memória; quem usa as bases é a
 * estimativa de tempo de trabalho (`work-time/useIncomeEstimate.ts`).
 */
export const firebaseBasisDeps: BasisSyncDeps = {
    fetchReport: (payload) => fetchFinancialReport(payload),
    subscribePeriods: (workspaceId, firstMonth, lastMonth, onNext, onError) => onSnapshot(
        query(
            collection(db, 'workspaces', workspaceId, 'cash_report_periods'),
            where(documentId(), '>=', firstMonth),
            where(documentId(), '<=', lastMonth),
            limit(BASIS_PERIODS_MAX),
        ),
        { includeMetadataChanges: true },
        (snapshot) => onNext({
            documents: snapshot.docs.map((entry) => ({
                id: entry.id,
                incomeCents: entry.data().incomeCents,
                updatedAt: entry.data().updatedAt,
            })),
            fromCache: snapshot.metadata.fromCache,
            changes: snapshot.docChanges().length,
        }),
        () => onError(),
    ),
};

/** Relatório da faixa escolhida nos Relatórios, já adaptado para as telas. */
export const useFinancialReportView = (
    preset: ReportTimeRange,
    sections?: readonly ReportSection[],
) => {
    const { activeWorkspace } = useWorkspace();
    const query = useFinancialReport(presetRange(preset), sections);
    const workspaceType = activeWorkspace?.type === 'PJ' ? 'PJ' : 'PF';
    const adapted = useMemo<ReportAdapterResult | undefined>(
        () => (query.data ? toReportSnapshot(query.data, workspaceType) : undefined),
        [query.data, workspaceType],
    );
    return { ...query, snapshot: adapted?.snapshot, view: adapted?.view };
};

/**
 * O caixa é projetado por gatilho assíncrono depois da mutação: o relatório
 * relido logo após o sucesso pode ainda não incluí-la. Escuta o documento da
 * projeção do mês corrente e, quando diferente, o do mês escolhido no Header
 * (no máximo dois documentos) e, a cada retorno (inclusive o primeiro: uma
 * gravação entre a leitura do relatório e ele só aparece ali), relê os
 * relatórios que ainda não estão lendo o estado dele (RR-R2A-04). Mudanças em rajada (vários lançamentos, outros membros)
 * são agrupadas numa só releitura, com orçamento por hora abaixo do limite de
 * frequência da callable (`./liveRefresh.ts`). Falha do listener não quebra a
 * tela. Na virada do mês em São Paulo (aba aberta), troca para o documento do
 * mês novo e relê os relatórios e as bases de longa duração, cujo "hoje"
 * também mudou. As bases não acompanham este listener: elas têm a escuta
 * própria das projeções da janela (`./basisSync.ts`).
 */
const MONTH_CHECK_INTERVAL_MS = 60_000;

export const useFinancialReportLiveRefresh = (
    workspaceId: string,
    selectedMonth?: string,
) => {
    const queryClient = useQueryClient();
    const [monthKey, setMonthKey] = useState(() => saoPauloMonthKey());
    // Um agendador (e um orçamento) por montagem, mantido nas trocas de mês e
    // de workspace.
    const scheduler = useRef<ReturnType<typeof createLiveRefreshScheduler> | null>(null);
    /** A última mudança vista pela escuta, na ordem de registro (RR-R2A-04). */
    const lastChange = useRef(0);
    if (scheduler.current === null) {
        scheduler.current = createLiveRefreshScheduler(() => {
            void refreshFinancialReportsAfterChange(queryClient, lastChange.current);
        });
    }
    useEffect(() => {
        const timer = setInterval(() => {
            const current = saoPauloMonthKey();
            if (current === monthKey) return;
            setMonthKey(current);
            void invalidateFinancialReports(queryClient);
            // O "hoje" e a janela das bases de longa duração também mudaram.
            void invalidateFinancialReportBases(queryClient);
        }, MONTH_CHECK_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [monthKey, queryClient]);
    const extraMonth = selectedMonth && selectedMonth !== monthKey ? selectedMonth : null;
    useEffect(() => {
        if (!workspaceId || workspaceId === 'loading') return undefined;
        const refresh = scheduler.current;
        const unsubscribes = [monthKey, ...(extraMonth ? [extraMonth] : [])].map((month) =>
            onSnapshot(
                doc(db, 'workspaces', workspaceId, 'cash_report_periods', month),
                () => {
                    // Todo retorno conta, inclusive o primeiro (RR-R2A-04): uma gravação entre a leitura do
                    // relatório e o primeiro retorno da escuta só aparece nele. A releitura agrupada pula a
                    // consulta cuja leitura em curso já começou depois deste retorno.
                    lastChange.current = nextFinancialReportOrder();
                    refresh?.notify();
                },
                () => { /* sem projeção legível: o relatório segue pelo staleTime */ },
            ));
        return () => {
            refresh?.cancel();
            unsubscribes.forEach((unsubscribe) => unsubscribe());
        };
    }, [workspaceId, monthKey, extraMonth]);
};

/**
 * Condições do período, como vieram do snapshot do relatório. Não há estado
 * de leitura: são calculadas a cada consulta e não ficam salvas.
 */
export const useFinancialAlerts = (snapshotData?: FinancialReportSnapshot) => {
    const alerts = snapshotData?.alerts || [];
    return {
        alerts,
        totalActive: alerts.length,
    };
};

/**
 * Chat de IA dos relatórios (P5-A, PR-AI-04). O histórico pertence ao par
 * (uid da sessão do Firebase Auth, workspace ativo carregado para esse uid) e
 * fica no `localStorage` por esse par; enquanto qualquer um dos dois estiver
 * indefinido ou carregando, não há escopo e nada é lido, gravado nem enviado.
 * Regras de sessão, geração e respostas atrasadas: `./aiChatSession.ts`.
 */
export const useFinanceAIChat = () => {
    const { user } = useAuth();
    const { activeWorkspace, activeWorkspaceUid } = useWorkspace();
    const uid = user?.uid ?? null;
    const workspaceId = activeWorkspace.id;
    const scope = useMemo(
        () => (uid !== null && activeWorkspaceUid === uid
            ? resolveAiChatScope(uid, workspaceId)
            : null),
        [uid, activeWorkspaceUid, workspaceId],
    );
    return useScopedAiChat<FinancialReportSnapshot>(scope, api.askFinanceAI);
};
