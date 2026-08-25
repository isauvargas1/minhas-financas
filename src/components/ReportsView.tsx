
import React, { useState } from 'react';
import { Transaction, Goal, CreditCard, EntityItem } from '../types.ts';
import { ReportIcon, DashboardIcon, ChartBarIcon, SparklesIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useFinancialReportSnapshot } from '../modules/reports/hooks.ts';
import { useReceivables, useClients } from '../modules/clients/hooks.ts';
import { ReportTimeRange } from '../modules/reports/types.ts';
import { getAvailableReportPeriods } from '../modules/reports/api.ts';
import ReportPeriodSelect from './ReportPeriodSelect.tsx';

// Subviews
import ReportsOverview from './ReportsOverview.tsx';
import ReportsChartsView from './ReportsChartsView.tsx';
import ReportsAIChat from './ReportsAIChat.tsx';

interface ReportsViewProps {
    transactions: Transaction[];
    goals: Goal[];
    creditCards: CreditCard[];
    categories: EntityItem[];
}

type ReportTab = 'overview' | 'charts' | 'ai';

/** Abas de relatórios, na ordem de navegação por seta. */
const REPORT_TABS: Array<{
    id: ReportTab;
    label: string;
    Icon: React.FC<{ className?: string }>;
}> = [
    { id: 'overview', label: 'Visão Geral', Icon: DashboardIcon },
    { id: 'charts', label: 'Gráficos', Icon: ChartBarIcon },
    { id: 'ai', label: 'IA Financeira', Icon: SparklesIcon },
];

const ReportsView: React.FC<ReportsViewProps> = ({ transactions, goals, creditCards, categories }) => {
    const [timeRange, setTimeRange] = useState<ReportTimeRange>('30d');
    const [activeTab, setActiveTab] = useState<ReportTab>('overview');
    
    const { activeWorkspace } = useWorkspace();
    
    // Fetch receivables and clients only if PJ (hook internally handles enabled check)
    const { data: receivables } = useReceivables(); 
    const { data: clients } = useClients();

    const { data: snapshot, isLoading, isError } = useFinancialReportSnapshot(
        transactions, 
        goals, 
        creditCards, 
        timeRange,
        receivables,
        clients // Pass loaded clients to snapshot generator
    );
    
    const { theme } = useTheme();

    const periodOptions = getAvailableReportPeriods();

    // Title Logic based on Workspace
    const reportTitle = activeWorkspace.type === 'PJ' 
        ? 'Relatórios Empresariais'
        : 'Relatórios de Finanças Pessoais';

    const reportSubtitle = activeWorkspace.type === 'PJ'
        ? `Análise inteligente da saúde financeira da empresa ${activeWorkspace.name}.`
        : 'Análise inteligente da saúde financeira.';

    return (
        <div className="h-full flex flex-col animate-fade-in">
            {/* Header */}
            <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4 flex-shrink-0">
                <div>
                    <h2 className="text-2xl font-bold text-on-surface flex items-center gap-2">
                        <ReportIcon className="h-6 w-6 text-primary" />
                        {reportTitle}
                    </h2>
                    <p className="text-sm text-muted">{reportSubtitle}</p>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto">
                    {/* Custom Period Selector */}
                    <ReportPeriodSelect 
                        value={timeRange}
                        onChange={setTimeRange}
                        options={periodOptions}
                    />
                </div>
            </div>

            {/*
              INV-P3-056 — padrão ARIA de abas completo.

              Havia `role="tab"` e `aria-selected` sem `id`, sem
              `aria-controls`, sem `tabpanel` associado e sem foco itinerante:
              o leitor de tela anunciava "aba 1 de 3" e prometia uma navegação
              por setas que não existia — pior do que não usar o papel. Agora
              só a aba ativa recebe foco por Tab, as setas percorrem as demais
              e cada aba aponta para o painel que controla.
            */}
            <div
                className="flex border-b border-border mb-6 flex-shrink-0 overflow-x-auto gap-2"
                role="tablist"
                aria-label="Seções de relatórios"
            >
                {REPORT_TABS.map(({ id, label, Icon }, index) => (
                    <button
                        key={id}
                        id={`reports-tab-${id}`}
                        type="button"
                        role="tab"
                        aria-selected={activeTab === id}
                        aria-controls={`reports-panel-${id}`}
                        tabIndex={activeTab === id ? 0 : -1}
                        onClick={() => setActiveTab(id)}
                        onKeyDown={(event) => {
                            const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                            if (step === 0) return;
                            event.preventDefault();
                            const next = REPORT_TABS[(index + step + REPORT_TABS.length) % REPORT_TABS.length].id;
                            setActiveTab(next);
                            document.getElementById(`reports-tab-${next}`)?.focus();
                        }}
                        className={`px-4 py-3 text-sm font-medium border-b-2 transition-all flex items-center gap-2 whitespace-nowrap outline-none rounded-t-lg
                            ${activeTab === id
                                ? 'border-primary text-primary bg-primary/5'
                                : 'border-transparent text-muted hover:text-on-surface hover:bg-surface'
                            }
                            focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background
                        `}
                    >
                        <Icon className="h-4 w-4" /> {label}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div
                className="flex-1 overflow-y-auto custom-scrollbar pb-6"
                role="tabpanel"
                id={`reports-panel-${activeTab}`}
                aria-labelledby={`reports-tab-${activeTab}`}
                tabIndex={0}
            >
                {isError && (
                    <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800">
                        Não foi possível carregar os relatórios. Tente novamente.
                    </div>
                )}
                {!isError && activeTab === 'overview' && (
                    <ReportsOverview 
                        snapshot={snapshot || undefined} 
                        isLoading={isLoading} 
                    />
                )}
                {!isError && activeTab === 'charts' && (
                    <ReportsChartsView 
                        snapshot={snapshot || undefined} 
                        isLoading={isLoading}
                        categories={categories}
                    />
                )}
                {!isError && activeTab === 'ai' && snapshot && (
                    <ReportsAIChat snapshot={snapshot} />
                )}
                {/* Fallback for AI Tab Loading */}
                {activeTab === 'ai' && isLoading && (
                    <div className="flex items-center justify-center h-full">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReportsView;
