
import React, { useMemo } from 'react';
import { useRecurringExpenses } from '../modules/recurring-expenses/hooks.ts';
import { RepeatIcon, TrendingUpIcon, WarningIcon, CalendarIcon } from './Icons.tsx';
import { useTheme } from '../ThemeContext.tsx';

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
            // ... others simplified

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
        <div className="bg-white dark:bg-dark-100 rounded-xl shadow-md border border-gray-100 dark:border-gray-700 p-6 h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                    <RepeatIcon className="w-5 h-5 text-indigo-600" />
                    Assinaturas
                </h3>
                <span className="text-xs bg-indigo-50 text-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-300 px-2 py-1 rounded font-medium">
                    Mensal: {formatCurrency(summary.totalMonthly)}
                </span>
            </div>

            <div className="flex-1 space-y-4">
                {/* Alert Section */}
                {summary.expiringSoon.length > 0 && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/10 p-3 rounded-lg border border-yellow-100 dark:border-yellow-900/30 flex items-start gap-3">
                        <WarningIcon className="w-5 h-5 text-yellow-600 mt-0.5" />
                        <div>
                            <p className="text-sm font-bold text-yellow-800 dark:text-yellow-200">Vencendo em breve</p>
                            <ul className="mt-1 space-y-1">
                                {summary.expiringSoon.map(exp => (
                                    <li key={exp.id} className="text-xs text-yellow-700 dark:text-yellow-300">
                                        • {exp.nome} ({new Date(exp.dataFim!).toLocaleDateString('pt-BR')})
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}

                {/* Top Expenses */}
                <div>
                    <p className="text-xs font-bold text-gray-500 uppercase mb-2">Maiores Gastos</p>
                    <div className="space-y-2">
                        {summary.top3.map(exp => (
                            <div key={exp.id} className="flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-dark-200 rounded-lg transition-colors">
                                <div className="flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: exp.corPrincipal }}></div>
                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{exp.nome}</span>
                                </div>
                                <span className="text-sm font-bold text-gray-800 dark:text-white">{formatCurrency(exp.valorPadrao)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RecurringDashboardWidget;
