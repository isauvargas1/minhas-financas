
import React, { useMemo, useState } from 'react';
import {
    ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
    PieChart, Pie, Cell, Legend, BarChart, Bar
} from 'recharts';
import { FinancialReportSnapshot } from '../modules/reports/types.ts';
import { EntityItem } from '../types.ts';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface ReportsChartsViewProps {
    snapshot?: FinancialReportSnapshot;
    isLoading?: boolean;
    categories?: EntityItem[];
}

const ChartSkeleton = ({ height }: { height: string }) => (
    <div className={`bg-surface p-6 rounded-card border border-border shadow-sm w-full ${height} flex flex-col`}>
        <div className="h-6 w-48 bg-gray-200 dark:bg-gray-700 rounded mb-6 animate-pulse"></div>
        <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded animate-pulse relative overflow-hidden">
            {/* Shimmer line */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-[shimmer_1.5s_infinite]"></div>
        </div>
    </div>
);

const ReportsChartsView: React.FC<ReportsChartsViewProps> = ({ snapshot, isLoading, categories = [] }) => {
    const { theme } = useTheme();
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';

    const [creditCardExpenseView, setCreditCardExpenseView] = useState<
        'purchaseCompetence' | 'invoicePaymentDate' | 'cardAnalytics'
    >('purchaseCompetence');

    // --- Labels based on Context ---
    const labels = {
        income: isPJ ? 'Faturamento' : 'Receita',
        expense: isPJ ? 'Despesas Op.' : 'Despesa',
        balance: isPJ ? 'Lucro/Prej.' : 'Saldo',
        categoryTitle: isPJ ? 'Categorias que mais impactam o caixa' : 'Despesas por Categoria',
        debtTitle: isPJ ? 'Contas a Receber por Status' : 'Composição de Dívidas'
    };

    // --- Data Transformations ---
    const cashFlowData = useMemo(() => {
        if (!snapshot) return [];
        // Reverse to show oldest first if API returns descending
        return [...snapshot.cashFlow].reverse().map(item => ({
            name: new Date(item.month + '-02').toLocaleDateString('pt-BR', { month: 'short' }), // Force middle of month to avoid timezone skips
            [labels.income]: item.totalIncome,
            [labels.expense]: item.totalExpenses,
            [labels.balance]: item.netCashFlow
        }));
    }, [snapshot, labels]);

    const categoryData = useMemo(() => {
        if (!snapshot) return [];
        return snapshot.expenseCategories.map(cat => {
            // Find color from settings
            const categorySetting = categories.find(c => c.name === cat.categoryName);
            const color = categorySetting?.iconColor || theme.colors.chartExpense;

            return {
                name: cat.categoryName,
                value: cat.totalAmount,
                color
            };
        });
    }, [snapshot, categories, theme]);

    // PF: Debt Breakdown
    const debtDataPF = useMemo(() => {
        if (!snapshot || isPJ) return [];
        return [
            { name: 'Cartão', value: snapshot.debtProfile.totalCreditCardDebt, fill: theme.colors.primary },
            { name: 'Empréstimos', value: snapshot.debtProfile.totalLoans, fill: theme.colors.warning },
            { name: 'Parcelamentos', value: snapshot.debtProfile.totalInstallments, fill: theme.colors.chartInstallment }
        ].filter(d => d.value > 0);
    }, [snapshot, theme, isPJ]);

    // PJ: Receivables Status
    const receivablesData = useMemo(() => {
        if (!snapshot || !isPJ || !snapshot.receivablesStatus) return [];
        return snapshot.receivablesStatus.map(status => ({
            name: status.status,
            value: status.totalValue,
            fill: status.color
        }));
    }, [snapshot, isPJ]);

    // PJ: Top Clients
    const topClientsData = useMemo(() => {
        if (!snapshot || !isPJ || !snapshot.topClients) return [];
        return snapshot.topClients.map((client, index) => ({
            name: client.clientName,
            value: client.totalValue,
            fill: index % 2 === 0 ? theme.colors.chartIncome : theme.colors.primary // Alternating colors
        }));
    }, [snapshot, isPJ, theme]);

    const creditCardUtilizationData = useMemo(() => {
        if (!snapshot?.creditCardIndicators?.length) return [];

        return snapshot.creditCardIndicators.map((card) => ({
            name: card.cardName,
            value: card.utilizationRate,
            fill:
                card.utilizationRate >= 90
                    ? theme.colors.chartExpense
                    : card.utilizationRate >= 75
                        ? theme.colors.warning
                        : theme.colors.primary,
        }));
    }, [snapshot, theme]);

    const creditCardDueData = useMemo(() => {
        if (!snapshot?.creditCardIndicators?.length) return [];

        return snapshot.creditCardIndicators.map((card) => ({
            name: card.cardName,
            '7 dias': card.dueBuckets.next7Days,
            '15 dias': card.dueBuckets.next15Days,
            '30 dias': card.dueBuckets.next30Days,
        }));
    }, [snapshot]);

    const creditCardExpenseViews = snapshot?.creditCardExpenseReportViews;
    const investmentEvolutionData = snapshot?.investmentOverview?.evolution.map((item) => ({
        name: new Date(`${item.period}-02T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
        Patrimônio: item.currentValue,
    })) ?? [];

    const selectedCreditCardExpensePeriodData = useMemo(() => {
        if (!creditCardExpenseViews) return [];

        return creditCardExpenseView === 'invoicePaymentDate'
            ? creditCardExpenseViews.invoicePaymentDate
            : creditCardExpenseViews.purchaseCompetence;
    }, [creditCardExpenseViews, creditCardExpenseView]);

    const selectedCreditCardExpenseCardData = useMemo(() => {
        if (!creditCardExpenseViews) return [];

        return creditCardExpenseViews.cardAnalytics;
    }, [creditCardExpenseViews]);

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    if (isLoading || !snapshot) {
        return (
            <div className="space-y-8 animate-fade-in">
                <ChartSkeleton height="h-72" />
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <ChartSkeleton height="h-80" />
                    <ChartSkeleton height="h-80" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in">

            {snapshot?.investmentOverview?.evolutionUnavailable && (
                <section className="bg-surface p-6 rounded-card border border-amber-300 shadow-sm">
                    <h3 className="text-lg font-bold text-on-surface mb-1">Evolução patrimonial</h3>
                    <p role="status" className="text-sm text-amber-900">
                        A série histórica ainda não tem o valor de fechamento de cada mês.
                        Execute a reconstrução das projeções para disponibilizá-la.
                    </p>
                </section>
            )}
            {investmentEvolutionData.length > 0 && (
                <section className="bg-surface p-6 rounded-card border border-border shadow-sm" aria-labelledby="investment-evolution-title">
                    <h3 id="investment-evolution-title" className="text-lg font-bold text-on-surface mb-1">Evolução patrimonial</h3>
                    <p className="mb-6 text-xs text-muted">Valor de fechamento de cada mês, lido da projeção mensal oficial, sem varrer movimentações no navegador.</p>
                    <div className="h-72 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={investmentEvolutionData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.colors.border} />
                                <XAxis dataKey="name" tick={{ fill: theme.colors.textSecondary, fontSize: 12 }} />
                                <YAxis tick={{ fill: theme.colors.textSecondary, fontSize: 12 }} tickFormatter={(value) => new Intl.NumberFormat('pt-BR', { notation: 'compact', style: 'currency', currency: 'BRL' }).format(value)} />
                                <Tooltip formatter={(value: number) => formatCurrency(value)} contentStyle={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, color: theme.colors.text, borderRadius: '8px' }} />
                                <Area type="monotone" dataKey="Patrimônio" stroke={theme.colors.primary} fill={theme.colors.primary} fillOpacity={0.15} strokeWidth={3} />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </section>
            )}

            {/* Row 1: Cash Flow Evolution */}
            <div className="bg-surface p-6 rounded-card border border-border shadow-sm">
                <h3 className="text-lg font-bold text-on-surface mb-6">
                    {isPJ ? 'Evolução Faturamento x Despesa x Lucro (6 Meses)' : 'Fluxo de Caixa (6 Meses)'}
                </h3>
                <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={cashFlowData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={theme.colors.chartIncome} stopOpacity={0.2} />
                                    <stop offset="95%" stopColor={theme.colors.chartIncome} stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={theme.colors.chartExpense} stopOpacity={0.2} />
                                    <stop offset="95%" stopColor={theme.colors.chartExpense} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.colors.border} />
                            <XAxis
                                dataKey="name"
                                tick={{ fill: theme.colors.textSecondary, fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                tickMargin={10}
                            />
                            <YAxis
                                tick={{ fill: theme.colors.textSecondary, fontSize: 12 }}
                                axisLine={false}
                                tickLine={false}
                                tickFormatter={(val) => `R$${val / 1000}k`}
                            />
                            <Tooltip
                                formatter={(value: number) => formatCurrency(value)}
                                contentStyle={{
                                    backgroundColor: theme.colors.surface,
                                    borderColor: theme.colors.border,
                                    color: theme.colors.text,
                                    borderRadius: '8px',
                                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                                }}
                            />
                            <Legend wrapperStyle={{ paddingTop: '20px' }} />
                            <Area
                                type="monotone"
                                dataKey={labels.income}
                                stroke={theme.colors.chartIncome}
                                fillOpacity={1}
                                fill="url(#colorIncome)"
                                strokeWidth={3}
                                animationDuration={1500}
                            />
                            <Area
                                type="monotone"
                                dataKey={labels.expense}
                                stroke={theme.colors.chartExpense}
                                fillOpacity={1}
                                fill="url(#colorExpense)"
                                strokeWidth={3}
                                animationDuration={1500}
                                animationBegin={300}
                            />
                            {/* For PJ we might want to emphasize Net Profit as a separate line if needed, but area overlap shows it too */}
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Row 2: Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* Category Pie */}
                <div className="bg-surface p-6 rounded-card border border-border shadow-sm">
                    <h3 className="text-lg font-bold text-on-surface mb-4">{labels.categoryTitle}</h3>
                    <div className="h-64">
                        {categoryData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={categoryData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="value"
                                        animationDuration={1000}
                                        animationBegin={0}
                                    >
                                        {categoryData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} stroke={theme.colors.surface} strokeWidth={2} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        formatter={(value: number) => formatCurrency(value)}
                                        contentStyle={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, color: theme.colors.text, borderRadius: '8px' }}
                                    />
                                    <Legend
                                        layout="vertical"
                                        verticalAlign="middle"
                                        align="right"
                                        wrapperStyle={{ fontSize: '12px' }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex items-center justify-center h-full text-muted text-sm">
                                {isPJ ? 'Nenhuma despesa operacional registrada.' : 'Sem dados de categoria.'}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column: Debt (PF) or Receivables (PJ) */}
                <div className="bg-surface p-6 rounded-card border border-border shadow-sm">
                    <h3 className="text-lg font-bold text-on-surface mb-4">{labels.debtTitle}</h3>
                    <div className="h-64">
                        {isPJ ? (
                            // PJ: Receivables Status
                            receivablesData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={receivablesData} layout="vertical" margin={{ left: 20 }}>
                                        <XAxis type="number" hide />
                                        <YAxis
                                            dataKey="name"
                                            type="category"
                                            tick={{ fill: theme.colors.textSecondary, fontSize: 12, fontWeight: 500 }}
                                            width={100}
                                            axisLine={false}
                                            tickLine={false}
                                        />
                                        <Tooltip
                                            cursor={{ fill: 'transparent' }}
                                            formatter={(value: number) => formatCurrency(value)}
                                            contentStyle={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, color: theme.colors.text, borderRadius: '8px' }}
                                        />
                                        <Bar
                                            dataKey="value"
                                            radius={[0, 4, 4, 0]}
                                            barSize={32}
                                            animationDuration={1200}
                                        >
                                            {receivablesData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.fill} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex items-center justify-center h-full text-muted text-sm">
                                    Nenhum cliente com contas a receber neste período.
                                </div>
                            )
                        ) : (
                            // PF: Debt Breakdown
                            debtDataPF.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={debtDataPF} layout="vertical" margin={{ left: 20 }}>
                                        <XAxis type="number" hide />
                                        <YAxis
                                            dataKey="name"
                                            type="category"
                                            tick={{ fill: theme.colors.textSecondary, fontSize: 12, fontWeight: 500 }}
                                            width={100}
                                            axisLine={false}
                                            tickLine={false}
                                        />
                                        <Tooltip
                                            cursor={{ fill: 'transparent' }}
                                            formatter={(value: number) => formatCurrency(value)}
                                            contentStyle={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, color: theme.colors.text, borderRadius: '8px' }}
                                        />
                                        <Bar
                                            dataKey="value"
                                            radius={[0, 4, 4, 0]}
                                            barSize={24}
                                            animationDuration={1200}
                                        >
                                            {debtDataPF.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.fill} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex items-center justify-center h-full text-muted text-sm">
                                    Sem dados de dívidas registrados.
                                </div>
                            )
                        )}
                    </div>
                </div>
            </div>

            {!isPJ && snapshot.creditCardExpenseReportViews && (
                <div className="bg-surface p-6 rounded-card border border-border shadow-sm space-y-5">
                    <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div>
                            <h3 className="text-lg font-bold text-on-surface">
                                Visões de despesa do cartão
                            </h3>
                            <p className="text-xs text-muted mt-1">
                                Compare compra por competência, pagamento da fatura e visão analítica por cartão.
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                onClick={() => setCreditCardExpenseView('purchaseCompetence')}
                                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${creditCardExpenseView === 'purchaseCompetence'
                                        ? 'bg-primary text-white shadow-md'
                                        : 'bg-background text-muted border border-border hover:text-on-surface'
                                    }`}
                            >
                                Competência da compra
                            </button>

                            <button
                                type="button"
                                onClick={() => setCreditCardExpenseView('invoicePaymentDate')}
                                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${creditCardExpenseView === 'invoicePaymentDate'
                                        ? 'bg-primary text-white shadow-md'
                                        : 'bg-background text-muted border border-border hover:text-on-surface'
                                    }`}
                            >
                                Pagamento da fatura
                            </button>

                            <button
                                type="button"
                                onClick={() => setCreditCardExpenseView('cardAnalytics')}
                                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${creditCardExpenseView === 'cardAnalytics'
                                        ? 'bg-primary text-white shadow-md'
                                        : 'bg-background text-muted border border-border hover:text-on-surface'
                                    }`}
                            >
                                Por cartão
                            </button>
                        </div>
                    </div>

                    {creditCardExpenseView !== 'cardAnalytics' ? (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="h-72">
                                {selectedCreditCardExpensePeriodData.length > 0 ? (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={[...selectedCreditCardExpensePeriodData].reverse()}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.colors.border} />
                                            <XAxis
                                                dataKey="label"
                                                tick={{ fill: theme.colors.textSecondary, fontSize: 12 }}
                                                axisLine={false}
                                                tickLine={false}
                                            />
                                            <YAxis
                                                tick={{ fill: theme.colors.textSecondary, fontSize: 12 }}
                                                axisLine={false}
                                                tickLine={false}
                                                tickFormatter={(value) => `R$${value / 1000}k`}
                                            />
                                            <Tooltip
                                                formatter={(value: number) => formatCurrency(value)}
                                                contentStyle={{
                                                    backgroundColor: theme.colors.surface,
                                                    borderColor: theme.colors.border,
                                                    color: theme.colors.text,
                                                    borderRadius: '8px',
                                                }}
                                            />
                                            <Bar
                                                dataKey="amount"
                                                fill={
                                                    creditCardExpenseView === 'purchaseCompetence'
                                                        ? theme.colors.primary
                                                        : theme.colors.chartExpense
                                                }
                                                radius={[4, 4, 0, 0]}
                                            />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-muted text-sm">
                                        Sem dados para esta visão.
                                    </div>
                                )}
                            </div>

                            <div className="overflow-x-auto border border-border rounded-xl">
                                <table className="w-full text-sm">
                                    <thead className="bg-background text-muted uppercase text-[10px] font-black">
                                        <tr>
                                            <th className="px-4 py-3 text-left">Período</th>
                                            <th className="px-4 py-3 text-right">Qtd.</th>
                                            <th className="px-4 py-3 text-right">Valor</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {selectedCreditCardExpensePeriodData.map((item) => (
                                            <tr key={item.period}>
                                                <td className="px-4 py-3 font-bold text-on-surface">{item.label}</td>
                                                <td className="px-4 py-3 text-right text-muted">{item.count}</td>
                                                <td className="px-4 py-3 text-right font-bold text-on-surface">
                                                    {formatCurrency(item.amount)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto border border-border rounded-xl">
                            <table className="w-full text-sm">
                                <thead className="bg-background text-muted uppercase text-[10px] font-black">
                                    <tr>
                                        <th className="px-4 py-3 text-left">Cartão</th>
                                        <th className="px-4 py-3 text-right">Compras</th>
                                        <th className="px-4 py-3 text-right">Pago em faturas</th>
                                        <th className="px-4 py-3 text-right">Fatura aberta</th>
                                        <th className="px-4 py-3 text-right">Futuro</th>
                                        <th className="px-4 py-3 text-right">Utilização</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {selectedCreditCardExpenseCardData.map((card) => (
                                        <tr key={card.cardId}>
                                            <td className="px-4 py-3">
                                                <p className="font-bold text-on-surface">{card.cardName}</p>
                                                <p className="text-xs text-muted">{card.purchaseCount} compra(s) no período</p>
                                            </td>
                                            <td className="px-4 py-3 text-right font-bold text-on-surface">
                                                {formatCurrency(card.purchaseAmount)}
                                            </td>
                                            <td className="px-4 py-3 text-right font-bold text-on-surface">
                                                {formatCurrency(card.paidAmount)}
                                            </td>
                                            <td className="px-4 py-3 text-right font-bold text-on-surface">
                                                {formatCurrency(card.openInvoiceBalance)}
                                            </td>
                                            <td className="px-4 py-3 text-right font-bold text-on-surface">
                                                {formatCurrency(card.futureCommittedBalance)}
                                            </td>
                                            <td className={`px-4 py-3 text-right font-black ${card.utilizationRate >= 90
                                                    ? 'text-red-600'
                                                    : card.utilizationRate >= 75
                                                        ? 'text-amber-600'
                                                        : 'text-green-600'
                                                }`}>
                                                {card.utilizationRate.toFixed(1)}%
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {!isPJ && snapshot.creditCardIndicators.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <div className="bg-surface p-6 rounded-card border border-border shadow-sm">
                        <h3 className="text-lg font-bold text-on-surface mb-4">
                            Utilização de limite por cartão
                        </h3>

                        <div className="h-72">
                            {creditCardUtilizationData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={creditCardUtilizationData} layout="vertical" margin={{ left: 20 }}>
                                        <XAxis
                                            type="number"
                                            domain={[0, 100]}
                                            tick={{ fill: theme.colors.textSecondary, fontSize: 12 }}
                                            tickFormatter={(value) => `${value}%`}
                                        />
                                        <YAxis
                                            dataKey="name"
                                            type="category"
                                            tick={{ fill: theme.colors.textSecondary, fontSize: 12, fontWeight: 500 }}
                                            width={120}
                                            axisLine={false}
                                            tickLine={false}
                                        />
                                        <Tooltip
                                            formatter={(value: number) => `${value.toFixed(1)}%`}
                                            contentStyle={{
                                                backgroundColor: theme.colors.surface,
                                                borderColor: theme.colors.border,
                                                color: theme.colors.text,
                                                borderRadius: '8px',
                                            }}
                                        />
                                        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={28}>
                                            {creditCardUtilizationData.map((entry, index) => (
                                                <Cell key={`credit-card-utilization-${index}`} fill={entry.fill} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex items-center justify-center h-full text-muted text-sm">
                                    Sem dados de utilização de cartão.
                                </div>
                            )}
                        </div>
                    </div>


                    <div className="bg-surface p-6 rounded-card border border-border shadow-sm">
                        <h3 className="text-lg font-bold text-on-surface mb-4">
                            Valores a vencer por cartão
                        </h3>

                        <div className="h-72">
                            {creditCardDueData.length > 0 ? (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={creditCardDueData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.colors.border} />
                                        <XAxis
                                            dataKey="name"
                                            tick={{ fill: theme.colors.textSecondary, fontSize: 12 }}
                                            axisLine={false}
                                            tickLine={false}
                                        />
                                        <YAxis
                                            tick={{ fill: theme.colors.textSecondary, fontSize: 12 }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={(value) => `R$${value / 1000}k`}
                                        />
                                        <Tooltip
                                            formatter={(value: number) => formatCurrency(value)}
                                            contentStyle={{
                                                backgroundColor: theme.colors.surface,
                                                borderColor: theme.colors.border,
                                                color: theme.colors.text,
                                                borderRadius: '8px',
                                            }}
                                        />
                                        <Legend />
                                        <Bar dataKey="7 dias" fill={theme.colors.chartExpense} radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="15 dias" fill={theme.colors.warning} radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="30 dias" fill={theme.colors.primary} radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex items-center justify-center h-full text-muted text-sm">
                                    Sem valores a vencer em cartão.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Row 3: Top Clients (PJ ONLY) */}
            {isPJ && (
                <div className="bg-surface p-6 rounded-card border border-border shadow-sm">
                    <h3 className="text-lg font-bold text-on-surface mb-4">Top 5 Clientes por Faturamento</h3>
                    <div className="h-72">
                        {topClientsData.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={topClientsData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.colors.border} />
                                    <XAxis
                                        dataKey="name"
                                        tick={{ fill: theme.colors.textSecondary, fontSize: 12 }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        tick={{ fill: theme.colors.textSecondary, fontSize: 12 }}
                                        axisLine={false}
                                        tickLine={false}
                                        tickFormatter={(val) => `R$${val / 1000}k`}
                                    />
                                    <Tooltip
                                        cursor={{ fill: 'transparent' }}
                                        formatter={(value: number) => formatCurrency(value)}
                                        contentStyle={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, color: theme.colors.text, borderRadius: '8px' }}
                                    />
                                    <Bar dataKey="value" radius={[4, 4, 0, 0]} barSize={40}>
                                        {topClientsData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.fill} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="flex items-center justify-center h-full text-muted text-sm">
                                Sem dados de clientes/faturamento.
                            </div>
                        )}
                    </div>
                </div>
            )}

            <style>{`
                @keyframes shimmer {
                    100% { transform: translateX(100%); }
                }
            `}</style>
        </div>
    );
};

export default ReportsChartsView;
