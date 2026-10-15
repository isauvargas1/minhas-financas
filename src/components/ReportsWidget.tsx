
import React from 'react';
import { useFinancialReportView } from '../modules/reports/hooks.ts';
import { blockEmptyText } from '../modules/reports/adapter.ts';
import { ReportIcon, WarningIcon, ChevronRightIcon, CheckIcon } from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface ReportsWidgetProps {
    onNavigate: () => void;
}

/**
 * Blocos que o widget exibe: resultado, taxa/margem e o alerta principal. Os
 * alertas já leem contas, cartões e dívidas no servidor; pedir esses blocos
 * só traria dados que o widget não mostra.
 */
const WIDGET_SECTIONS = ['cash', 'kpis', 'alerts'] as const;

const ReportsWidget: React.FC<ReportsWidgetProps> = ({ onNavigate }) => {
    // Faixa fixa de 30 dias: contexto imediato no Dashboard, pelo relatório oficial.
    const { snapshot, view, isLoading, isError, error } = useFinancialReportView('30d', WIDGET_SECTIONS);
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';

    if (isLoading) {
        return (
            <div className="bg-surface rounded-card p-5 shadow-md border border-border h-[200px] flex items-center justify-center animate-pulse">
                <div className="h-8 w-8 bg-border rounded-full"></div>
            </div>
        );
    }
    
    if (isError || !snapshot || !view) {
        return (
            <div role="alert" className="bg-surface rounded-card p-5 shadow-md border border-border h-full flex items-center justify-center text-center text-sm text-muted">
                {error?.message || 'Não foi possível carregar o relatório. Tente novamente.'}
            </div>
        );
    }

    const balanceKPI = snapshot.kpis.find(k => k.id === 'kpi-balance');
    const rateKPI = snapshot.kpis.find(k => k.id === (isPJ ? 'kpi-profit-margin' : 'kpi-net-contribution-rate'));
    
    // Find most important alert (Critical first, then Warning)
    const topAlert = snapshot.alerts.find(a => a.severity === 'critical') || 
                     snapshot.alerts.find(a => a.severity === 'warning');

    return (
        <div 
            onClick={onNavigate}
            className="bg-surface rounded-card p-5 shadow-md border border-border cursor-pointer group transition-all duration-300 hover:shadow-lg hover:border-primary/50 relative overflow-hidden flex flex-col justify-between h-full"
        >
            <div className="flex justify-between items-start mb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-primary/10 text-primary rounded-xl group-hover:scale-110 transition-transform duration-300">
                        <ReportIcon className="w-5 h-5" />
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-on-surface leading-tight">Diagnóstico</h3>
                        <p className="text-xs text-muted">Últimos 30 dias</p>
                    </div>
                </div>
                <div className="p-1.5 rounded-full text-muted group-hover:bg-background group-hover:text-primary transition-colors">
                    <ChevronRightIcon className="w-4 h-4" />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-background rounded-lg p-3 border border-border">
                    <span className="text-[10px] uppercase font-bold text-muted block mb-1">Resultado</span>
                    <span className={`text-lg font-bold truncate block ${balanceKPI?.value == null ? 'text-on-surface' : balanceKPI.value >= 0 ? 'text-success' : 'text-error'}`}>
                        {balanceKPI?.formattedValue ?? '—'}
                    </span>
                    {balanceKPI?.value == null && (
                        <span className="text-[10px] text-muted block truncate">{balanceKPI?.description}</span>
                    )}
                </div>
                <div className="bg-background rounded-lg p-3 border border-border">
                    <span className="text-[10px] uppercase font-bold text-muted block mb-1">{isPJ ? 'Margem' : 'Aportes líq.'}</span>
                    <span className="text-lg font-bold text-on-surface truncate block">
                        {rateKPI?.formattedValue ?? '—'}
                    </span>
                    {rateKPI?.value == null && (
                        <span className="text-[10px] text-muted block truncate">{rateKPI?.description}</span>
                    )}
                </div>
            </div>

            {topAlert ? (
                <div className={`text-xs p-3 rounded-lg flex gap-3 items-start transition-colors ${
                    topAlert.severity === 'critical' 
                        ? 'bg-error/10 text-error border border-error/20' 
                        : 'bg-warning/10 text-warning-dark border border-warning/20'
                }`}>
                    <WarningIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span className="line-clamp-2 font-medium leading-snug">{topAlert.message}</span>
                </div>
            ) : !view.blocks.alerts.hasNumbers ? (
                <div className="text-xs p-3 rounded-lg bg-background text-muted border border-border flex gap-2 items-center">
                    <WarningIcon className="w-4 h-4 flex-shrink-0" />
                    <span className="font-medium">{blockEmptyText(view.blocks.alerts)}</span>
                </div>
            ) : (
                <div className="text-xs p-3 rounded-lg bg-success/10 text-success border border-success/20 flex gap-2 items-center">
                    <CheckIcon className="w-4 h-4" />
                    <span className="font-medium">Saúde financeira estável.</span>
                </div>
            )}
        </div>
    );
};

export default ReportsWidget;
