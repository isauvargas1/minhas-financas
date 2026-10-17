import React, { useMemo } from 'react';
import DistributionChart, { type DistributionItem } from './DistributionChart.tsx';
import type { DashboardSummary } from '../modules/reports/adapter.ts';

interface TransactionsChartProps {
    summary: DashboardSummary;
}

/**
 * Distribuição de despesas do mês no Dashboard: totais do relatório oficial
 * (receitas, despesas, investimentos quando permitido e faturas de cartão).
 * Sem totais, mostra o estado do relatório em vez de um gráfico zerado.
 */
const TransactionsChart: React.FC<TransactionsChartProps> = ({ summary }) => {
    const items = useMemo<DistributionItem[]>(
        () => (summary.chart ?? []).map((item) => ({
            name: item.name,
            kind: item.kind,
            value: item.value,
        })),
        [summary.chart],
    );
    return <DistributionChart items={items} message={summary.chart ? null : summary.chartMessage} />;
};

export default TransactionsChart;
