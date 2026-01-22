
import React, { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Legend } from 'recharts';
import { SplitBill, SplitParticipant, SplitShare } from '../types.ts';
import { useTheme } from '../contexts/ThemeContext.tsx';

interface SplitGroupChartsProps {
    bills: SplitBill[];
    participants: SplitParticipant[];
    shares: SplitShare[];
}

const SplitGroupCharts: React.FC<SplitGroupChartsProps> = ({ bills, participants, shares }) => {
    const { theme } = useTheme();

    // 1. Despesas por Categoria (Pie Chart)
    const categoryData = useMemo(() => {
        const catMap: Record<string, number> = {};
        bills.forEach(bill => {
            const cat = bill.categoriaNome || 'Outros';
            catMap[cat] = (catMap[cat] || 0) + (bill.valorReal || 0);
        });

        return Object.entries(catMap).map(([name, value]) => ({ name, value }));
    }, [bills]);

    // 2. Saldos por Participante (Bar Chart)
    // Quanto cada um pagou (como pagador principal) vs Quanto deveria pagar (soma dos seus shares)
    const balanceData = useMemo(() => {
        return participants.map(p => {
            // Total pago efetivamente (contas onde ele é o pagador principal)
            const totalPaid = bills
                .filter(b => b.pagadorPrincipalId === p.id)
                .reduce((acc, b) => acc + (b.valorReal || 0), 0);

            // Total que deveria pagar (soma dos shares atribuídos a ele)
            const totalShare = shares
                .filter(s => s.participantId === p.id)
                .reduce((acc, s) => acc + s.valorDevido, 0);

            return {
                name: p.nomeExibicao,
                Pago: totalPaid,
                "Devido": totalShare
            };
        });
    }, [participants, bills, shares]);

    const COLORS = [
        theme.colors.chartIncome, 
        theme.colors.chartExpense, 
        theme.colors.chartInvestment, 
        theme.colors.chartInstallment,
        '#f59e0b', '#ec4899', '#6366f1'
    ];

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in">
            {/* Gráfico de Categorias */}
            <div className="bg-white dark:bg-dark-100 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4">Gastos por Categoria</h3>
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
                                >
                                    {categoryData.map((_, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip 
                                    formatter={(value: number) => formatCurrency(value)}
                                    contentStyle={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, color: theme.colors.text }}
                                />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-400">
                            Sem dados suficientes
                        </div>
                    )}
                </div>
            </div>

            {/* Gráfico de Balanço */}
            <div className="bg-white dark:bg-dark-100 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
                <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4">Pago vs. Consumido</h3>
                <div className="h-64">
                    {balanceData.length > 0 ? (
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={balanceData} layout="vertical">
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" width={80} tick={{ fill: theme.colors.textSecondary, fontSize: 12 }} />
                                <Tooltip 
                                    cursor={{fill: 'transparent'}}
                                    formatter={(value: number) => formatCurrency(value)}
                                    contentStyle={{ backgroundColor: theme.colors.surface, borderColor: theme.colors.border, color: theme.colors.text }}
                                />
                                <Legend />
                                <Bar dataKey="Pago" fill={theme.colors.success} radius={[0, 4, 4, 0]} barSize={10} />
                                <Bar dataKey="Devido" fill={theme.colors.error} radius={[0, 4, 4, 0]} barSize={10} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : (
                        <div className="flex items-center justify-center h-full text-gray-400">
                            Sem dados suficientes
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SplitGroupCharts;
