import React, { useMemo } from 'react';
import { useRecurringExpenses } from '../modules/recurring-expenses/hooks.ts';
import { RepeatIcon, WarningIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';

const RecurringDashboardWidget: React.FC = () => {
    const { data: expenses, isLoading } = useRecurringExpenses();
    const { theme } = useTheme();

    const summary = useMemo(() => {
        if (!expenses) return { totalMonthly: 0, top3: [], expiringSoon: [] };

        let totalMonthly = 0;
        const activeExpenses = [];
        const expiringSoon = [];
        const today = new Date();
        const nextMonth = new Date();
        nextMonth.setDate(today.getDate() + 30);

        for (const exp of expenses) {
            if (exp.status !== 'ativo') continue;

            // Calculate Monthly Value
            let monthlyVal = exp.valorPadrao;
            if (exp.periodo === 'semanal') monthlyVal *= 4;
            if (exp.periodo === 'quinzenal') monthlyVal *= 2;
            if (exp.periodo === 'anual') monthlyVal /= 12;
            if (exp.periodo === 'bimestral') monthlyVal /= 2;
            if (exp.periodo === 'trimestral') monthlyVal /= 3;
            if (exp.periodo === 'semestral') monthlyVal /= 6;

            totalMonthly += monthlyVal;
            activeExpenses.push({ ...exp, monthlyVal });

            // Check Expiration
            if (exp.dataFim) {
                const endDate = new Date(exp.dataFim);
                if (endDate > today && endDate <= nextMonth) {
                    expiringSoon.push(exp);
                }
            }
        }

        // Sort by value desc
        const top3 = activeExpenses.sort((a, b) => b.monthlyVal - a.monthlyVal).slice(0, 3);

        return { totalMonthly, top3, expiringSoon };
    }, [expenses]);

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    if (isLoading || !expenses || expenses.length === 0) return null;

    return (
        <div className="bg-surface rounded-card shadow-md border border-border p-5 flex flex-col">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                    <RepeatIcon className="w-5 h-5 text-primary" />
                    Assinaturas
                </h3>
                <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded font-medium">
                    Mensal: {formatCurrency(summary.totalMonthly)}
                </span>
            </div>

            <div className="flex-1 space-y-3">
                {/* Alert Section */}
                {summary.expiringSoon.length > 0 && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/10 p-2 rounded-lg border border-yellow-100 dark:border-yellow-900/30 flex items-start gap-3">
                        <WarningIcon className="w-4 h-4 text-yellow-600 mt-0.5" />
                        <div>
                            <p className="text-xs font-bold text-yellow-800 dark:text-yellow-200">Vencendo em breve</p>
                            <ul className="mt-0.5 space-y-0.5">
                                {summary.expiringSoon.map(exp => (
                                    <li key={exp.id} className="text-[10px] text-yellow-700 dark:text-yellow-300">
                                        • {exp.nome} ({new Date(exp.dataFim!).toLocaleDateString('pt-BR')})
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}

                {/* Top Expenses */}
                <div>
                    <p className="text-xs font-bold text-muted uppercase mb-1">Maiores Gastos</p>
                    <div className="space-y-1">
                        {summary.top3.map(exp => (
                            <div key={exp.id} className="flex items-center justify-between p-1.5 hover:bg-background rounded-lg transition-colors cursor-default">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: exp.corPrincipal }}></div>
                                    <span className="text-sm font-medium text-on-surface">{exp.nome}</span>
                                </div>
                                <span className="text-sm font-bold text-on-surface">{formatCurrency(exp.valorPadrao)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RecurringDashboardWidget;