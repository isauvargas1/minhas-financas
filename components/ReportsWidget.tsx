
import React from 'react';
import { useFinancialReportSnapshot } from '../modules/reports/hooks.ts';
import { Transaction, Goal, CreditCard } from '../types.ts';
import { ReportIcon, WarningIcon, ChevronRightIcon, CheckIcon } from './Icons.tsx';
import { useTheme } from '../ThemeContext.tsx';

interface ReportsWidgetProps {
    transactions: Transaction[];
    goals: Goal[];
    creditCards: CreditCard[];
    onNavigate: () => void;
}

const ReportsWidget: React.FC<ReportsWidgetProps> = ({ transactions, goals, creditCards, onNavigate }) => {
    // We use a fixed 30d range for the dashboard snapshot to give immediate context
    const { data: snapshot, isLoading } = useFinancialReportSnapshot(transactions, goals, creditCards, '30d');
    const { theme } = useTheme();

    if (isLoading) {
        return (
            <div className="bg-surface rounded-card p-5 shadow-md border border-border h-[200px] flex items-center justify-center animate-pulse">
                <div className="h-8 w-8 bg-border rounded-full"></div>
            </div>
        );
    }
    
    if (!snapshot) return null;

    const balanceKPI = snapshot.kpis.find(k => k.id === 'kpi-balance');
    const savingsKPI = snapshot.kpis.find(k => k.id === 'kpi-savings');
    
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
                    <span className="text-[10px] uppercase font-bold text-muted block mb-1">Saldo</span>
                    <span className={`text-lg font-bold truncate block ${balanceKPI && balanceKPI.value >= 0 ? 'text-success' : 'text-error'}`}>
                        {balanceKPI?.formattedValue}
                    </span>
                </div>
                <div className="bg-background rounded-lg p-3 border border-border">
                    <span className="text-[10px] uppercase font-bold text-muted block mb-1">Poupança</span>
                    <span className="text-lg font-bold text-on-surface truncate block">
                        {savingsKPI?.formattedValue}
                    </span>
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
