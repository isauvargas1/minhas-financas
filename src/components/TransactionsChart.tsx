
import React, { useState, useMemo, useEffect } from 'react';
import { ResponsiveContainer, PieChart, Pie, BarChart, Bar, LineChart, Line, Cell, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { Transaction, TransactionType } from '../types.ts';
import { PieChartIcon, BarChartIcon, LineChartIcon, DoughnutChartIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';

interface TransactionsChartProps {
    transactions: Transaction[];
}

type ChartType = 'pie' | 'bar' | 'line' | 'doughnut';

const TransactionsChart: React.FC<TransactionsChartProps> = ({ transactions }) => {
    const [chartType, setChartType] = useState<ChartType>('pie');
    const { theme } = useTheme();
    const [isDarkMode, setIsDarkMode] = useState(false);
    
    useEffect(() => {
        setIsDarkMode(document.documentElement.classList.contains('dark'));
        const observer = new MutationObserver(() => {
            setIsDarkMode(document.documentElement.classList.contains('dark'));
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);

    const data = useMemo(() => {
        const aggregated = transactions.reduce((acc, t) => {
            acc[t.type] = (acc[t.type] || 0) + t.value;
            return acc;
        }, {} as Record<TransactionType, number>);

        return [
            { name: 'Receitas', value: aggregated.receita || 0, fill: theme.colors.chartIncome },
            { name: 'Despesas', value: aggregated.despesa || 0, fill: theme.colors.chartExpense },
            { name: 'Investimentos', value: aggregated.investimento || 0, fill: theme.colors.chartInvestment },
            { name: 'Parceladas', value: aggregated.parcelado || 0, fill: theme.colors.chartInstallment },
        ];
    }, [transactions, theme.colors]);
    
    const renderChart = () => {
        switch (chartType) {
            case 'bar':
                return (
                    <BarChart data={data}>
                        <XAxis dataKey="name" tick={{ fill: theme.colors.textSecondary, fontSize: 12 }} />
                        <YAxis tick={{ fill: theme.colors.textSecondary, fontSize: 12 }} />
                        <Tooltip contentStyle={{ backgroundColor: theme.colors.surface, border: `1px solid ${theme.colors.border}`, color: theme.colors.text }} itemStyle={{ color: theme.colors.text }} />
                        <Bar dataKey="value" />
                    </BarChart>
                );
            case 'line':
                return (
                    <LineChart data={data}>
                        <XAxis dataKey="name" tick={{ fill: theme.colors.textSecondary, fontSize: 12 }} />
                        <YAxis tick={{ fill: theme.colors.textSecondary, fontSize: 12 }}/>
                        <Tooltip contentStyle={{ backgroundColor: theme.colors.surface, border: `1px solid ${theme.colors.border}`, color: theme.colors.text }} itemStyle={{ color: theme.colors.text }} />
                        <Line type="monotone" dataKey="value" stroke={theme.colors.primary} />
                    </LineChart>
                );
            case 'pie':
            case 'doughnut':
                return (
                    <PieChart>
                        <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={chartType === 'doughnut' ? 60 : 0} labelLine={false} label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                            const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                            const x = cx + radius * Math.cos(-midAngle * (Math.PI / 180));
                            const y = cy + radius * Math.sin(-midAngle * (Math.PI / 180));
                            return (
                                <text x={x} y={y} fill="white" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central">
                                    {`${(percent * 100).toFixed(0)}%`}
                                </text>
                            );
                        }}>
                           {data.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.fill} />)}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: theme.colors.surface, border: `1px solid ${theme.colors.border}`, color: theme.colors.text }} itemStyle={{ color: theme.colors.text }}/>
                    </PieChart>
                );
            default:
                return null;
        }
    };
    
    const chartButtons: { type: ChartType; icon: React.ReactNode; title: string; }[] = [
      { type: 'pie', icon: <PieChartIcon />, title: 'Gráfico de Pizza' },
      { type: 'bar', icon: <BarChartIcon />, title: 'Gráfico de Barras' },
      { type: 'line', icon: <LineChartIcon />, title: 'Gráfico de Linha' },
      { type: 'doughnut', icon: <DoughnutChartIcon />, title: 'Gráfico de Rosca' },
    ];

    return (
        <div className="bg-surface rounded-card shadow-md p-6 h-full border border-border">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-on-surface">Distribuição de Despesas</h2>
                <div className="flex space-x-1 bg-background p-1 rounded-lg border border-border">
                    {chartButtons.map(btn => (
                        <button
                          key={btn.type}
                          onClick={() => setChartType(btn.type)}
                          className={`p-1.5 rounded-md transition-all duration-200 ${chartType === btn.type ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:bg-surface/50'}`}
                          title={btn.title}
                        >
                            {btn.icon}
                        </button>
                    ))}
                </div>
            </div>
            <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                    {renderChart()}
                </ResponsiveContainer>
            </div>
             <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2">
                {data.map((item, index) => (
                    <div key={index} className="flex items-center">
                        <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: item.fill }}></div>
                        <span className="text-sm text-text-secondary">{item.name}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default TransactionsChart;
