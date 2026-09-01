
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
    FinancialReportSnapshot,
    KPI_NATURE_LABELS,
    type KpiNature,
} from '../modules/reports/types.ts';
import {
    TrendingUpIcon, WalletIcon, ChartBarIcon, ArrowUpIcon,
    ArrowDownIcon, TargetIcon, BuildingIcon, SparklesIcon,
    BriefcaseIcon, PiggyBankIcon, WarningIcon, CheckIcon, DynamicIcon
} from './Icons.tsx';
import ReportsAlertsPanel from './ReportsAlertsPanel.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
const MotionDiv = motion.div as any;
interface ReportsOverviewProps {
    snapshot?: FinancialReportSnapshot;
    isLoading?: boolean;
}

const KPISkeleton = () => (
    <div className="bg-surface rounded-card p-6 border border-border shadow-sm flex items-start justify-between h-[140px] animate-pulse">
        <div className="space-y-3 flex-1">
            <div className="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
            <div className="h-8 w-32 bg-gray-300 dark:bg-gray-600 rounded"></div>
        </div>
        <div className="w-12 h-12 rounded-xl bg-gray-200 dark:bg-gray-700"></div>
    </div>
);

const KPICard: React.FC<{
    label: string;
    value: string;
    trend?: 'up' | 'down' | 'stable';
    trendBasis?: 'sign' | 'period';
    trendPercentage?: number;
    nature?: KpiNature;
    icon: React.ReactNode;
    color: string;
    bg: string;
    description?: string;
}> = ({ label, value, trend, trendBasis, trendPercentage, nature, icon, color, bg, description }) => (
    <MotionDiv
        whileHover={{ y: -4 }}
        className="bg-surface rounded-card p-6 border border-border shadow-sm flex flex-col justify-between h-full group transition-all duration-300 hover:shadow-lg relative overflow-hidden"
    >
        <div className="flex justify-between items-start mb-4 relative z-10">
            <div className={`p-3 rounded-xl ${bg} ${color} shadow-inner group-hover:scale-110 transition-transform duration-500`}>
                {icon}
            </div>
            <div className="flex flex-col items-end gap-1">
                {/*
                  INV-P2-024 — a natureza do indicador fica visível: caixa,
                  patrimônio, contribuição e rendimento medem coisas diferentes
                  e apareciam lado a lado sem nada distingui-los.
                */}
                {nature && (
                    <span className="rounded-full bg-background px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-muted">
                        {KPI_NATURE_LABELS[nature]}
                    </span>
                )}
                {/*
                  INV-P2-046 — "Alta"/"Baixa" só quando existe comparação real
                  com período anterior. O que o cálculo produz hoje é o sinal
                  do valor, e rotulá-lo como tendência afirmava uma comparação
                  que nunca foi feita.
                */}
                {trend && trend !== 'stable' && (
                    <div className={`text-[10px] font-bold px-2 py-1 rounded-full flex items-center gap-1 ${trend === 'up' ? 'bg-green-100 text-green-700 dark:bg-green-900/30' : 'bg-red-100 text-red-700 dark:bg-red-900/30'
                        }`}>
                        {trend === 'up' ? '↑' : '↓'}
                        <span className="uppercase">
                            {trendBasis === 'period' && typeof trendPercentage === 'number'
                                ? `${trend === 'up' ? 'Alta' : 'Baixa'} ${Math.abs(trendPercentage).toFixed(1)}%`
                                : (trend === 'up' ? 'Positivo' : 'Negativo')}
                        </span>
                    </div>
                )}
            </div>
        </div>
        <div className="relative z-10">
            <p className="text-xs font-bold text-muted uppercase tracking-widest mb-1.5">{label}</p>
            <h3 className="text-2xl font-black text-on-surface tracking-tight">{value}</h3>
            {description && <p className="text-[10px] text-muted mt-1 font-medium leading-tight">{description}</p>}
        </div>

        {/* Decorative element */}
        <div className={`absolute -bottom-4 -right-4 w-24 h-24 rounded-full opacity-[0.03] ${color.replace('text-', 'bg-')} pointer-events-none transition-transform duration-700 group-hover:scale-150`}></div>
    </MotionDiv>
);

const ReportsOverview: React.FC<ReportsOverviewProps> = ({ snapshot, isLoading }) => {
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';
    

    const kpiData = useMemo(() => {
        if (!snapshot) return [];
        const find = (id: string) => snapshot.kpis.find(k => k.id === id);

        if (isPJ) {
            return [
                {
                    label: 'Faturamento',
                    id: 'kpi-gross-revenue',
                    icon: <BriefcaseIcon className="w-6 h-6" />,
                    color: 'text-indigo-600 dark:text-indigo-400',
                    bg: 'bg-indigo-50 dark:bg-indigo-900/20'
                },
                {
                    label: 'Margem Líquida',
                    id: 'kpi-profit-margin',
                    icon: <TrendingUpIcon className="w-6 h-6" />,
                    color: 'text-emerald-600 dark:text-emerald-400',
                    bg: 'bg-emerald-50 dark:bg-emerald-900/20'
                },
                {
                    label: 'Contas a Receber',
                    id: 'kpi-receivables-total',
                    icon: <WalletIcon className="w-6 h-6" />,
                    color: 'text-blue-600 dark:text-blue-400',
                    bg: 'bg-blue-50 dark:bg-blue-900/20'
                },
                {
                    label: 'Dívida Bancária',
                    id: 'kpi-debt-total',
                    icon: <BuildingIcon className="w-6 h-6" />,
                    color: 'text-red-600 dark:text-red-400',
                    bg: 'bg-red-50 dark:bg-red-900/20'
                }
            ].map(k => ({ ...k, data: find(k.id) }));
        }

        return [
            {
                label: 'Receita Total',
                id: 'kpi-income',
                icon: <ArrowUpIcon className="w-6 h-6" />,
                color: 'text-green-600 dark:text-green-400',
                bg: 'bg-green-50 dark:bg-green-900/20'
            },
            {
                label: 'Despesa Total',
                id: 'kpi-expenses',
                icon: <ArrowDownIcon className="w-6 h-6" />,
                color: 'text-red-600 dark:text-red-400',
                bg: 'bg-red-50 dark:bg-red-900/20'
            },
            {
                label: 'Investimentos',
                id: 'kpi-investments',
                icon: <ChartBarIcon className="w-6 h-6" />,
                color: 'text-blue-600 dark:text-blue-400',
                bg: 'bg-blue-50 dark:bg-blue-900/20'
            },
            {
                label: 'Resultado Líquido',
                id: 'kpi-balance',
                icon: <PiggyBankIcon className="w-6 h-6" />,
                color: 'text-purple-600 dark:text-purple-400',
                bg: 'bg-purple-50 dark:bg-purple-900/20'
            }
        ].map(k => ({ ...k, data: find(k.id) }));
    }, [snapshot, isPJ]);

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    const formatDateMonth = (monthStr: string) => {
        const [year, month] = monthStr.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1);
        return date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    };

    const creditCardIndicators = snapshot?.creditCardIndicators ?? [];
    const hasCreditCardIndicators = creditCardIndicators.length > 0;

    if (isLoading || !snapshot) {
        return (
            <div className="space-y-8 animate-fade-in">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {[1, 2, 3, 4].map(i => <KPISkeleton key={i} />)}
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 h-64 bg-surface rounded-card border border-border animate-pulse"></div>
                    <div className="h-64 bg-surface rounded-card border border-border animate-pulse"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in">
            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {kpiData.map((kpi, index) => (
                    <KPICard
                        key={index}
                        label={kpi.label}
                        value={kpi.data?.formattedValue || 'R$ 0,00'}
                        trend={kpi.data?.trend}
                        trendBasis={kpi.data?.trendBasis}
                        trendPercentage={kpi.data?.trendPercentage}
                        nature={kpi.data?.nature}
                        icon={kpi.icon}
                        color={kpi.color}
                        bg={kpi.bg}
                        description={kpi.data?.description}
                    />
                ))}
            </div>

            {/*
              Área de investimentos do relatório (Etapa 3, §4).

              O baseline tinha **um** número — "Investimentos" —, e ele era a
              soma bruta de toda transação de investimento do período. Agora há
              retirada e rendimento, e os três precisam aparecer separados;
              nada além disso precisa. Preço médio, marcação a mercado, risco,
              liquidez, indexador e ganho não realizado saíram: são taxonomia
              profissional que o ZIP não tinha, e a distribuição por carteira
              passou a morar na própria tela de Investimentos, onde o usuário
              a procura.

              Rendimento, taxas e impostos só aparecem quando existem: um
              "R$ 0,00" fixo faria o relatório afirmar que houve apuração de
              rendimento quando não houve nenhuma.
            */}
            {snapshot.investmentOverview && (
                <section aria-labelledby="investment-overview-title" className="space-y-5 rounded-card border border-border bg-surface p-5 shadow-sm">
                    <div>
                        <h3 id="investment-overview-title" className="font-bold text-on-surface">Patrimônio de investimentos</h3>
                        <p className="text-xs text-muted">Aportes, retiradas e rendimento aparecem separados do saldo em caixa.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {([
                            ['Patrimônio atual', snapshot.investmentOverview.currentValue, true],
                            ['Aportes', snapshot.investmentOverview.contributions, true],
                            ['Retiradas', snapshot.investmentOverview.redeemedPrincipal, true],
                            ['Rendimento realizado', snapshot.investmentOverview.realizedResult,
                                snapshot.investmentOverview.realizedResult !== 0],
                            ['Taxas', snapshot.investmentOverview.fees,
                                snapshot.investmentOverview.fees !== 0],
                            ['Impostos', snapshot.investmentOverview.taxes,
                                snapshot.investmentOverview.taxes !== 0],
                        ] as [string, number, boolean][]).filter(([, , visible]) => visible).map(([label, value]) => (
                            <article key={label} className="rounded-xl border border-border bg-background p-3">
                                <p className="text-xs text-muted">{label}</p>
                                <p className="mt-1 font-bold text-on-surface">{formatCurrency(Number(value))}</p>
                            </article>
                        ))}
                    </div>
                </section>
            )}

            {hasCreditCardIndicators && (
                <div className="bg-surface rounded-card border border-border shadow-sm overflow-hidden">
                    <div className="p-5 border-b border-border bg-background/30">
                        <h3 className="font-bold text-on-surface flex items-center gap-2">
                            <WalletIcon className="w-5 h-5 text-primary" />
                            Indicadores de Cartão de Crédito
                        </h3>
                        <p className="text-xs text-muted mt-1">
                            Visão baseada no domínio oficial de faturas, pagamentos e limite real.
                        </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 p-5">
                        <div className="bg-background rounded-xl border border-border p-4">
                            <p className="text-xs font-bold text-muted uppercase">Limite usado</p>
                            <p className="text-xl font-black text-on-surface mt-1">
                                {formatCurrency(snapshot.debtProfile.totalCreditCardDebt)}
                            </p>
                        </div>

                        <div className="bg-background rounded-xl border border-border p-4">
                            <p className="text-xs font-bold text-muted uppercase">Faturas abertas</p>
                            <p className="text-xl font-black text-on-surface mt-1">
                                {formatCurrency(snapshot.debtProfile.creditCardOpenInvoiceBalance)}
                            </p>
                        </div>

                        <div className="bg-background rounded-xl border border-border p-4">
                            <p className="text-xs font-bold text-muted uppercase">Futuro comprometido</p>
                            <p className="text-xl font-black text-on-surface mt-1">
                                {formatCurrency(snapshot.debtProfile.creditCardFutureCommittedBalance)}
                            </p>
                        </div>

                        <div className="bg-background rounded-xl border border-border p-4">
                            <p className="text-xs font-bold text-muted uppercase">A vencer em 30 dias</p>
                            <p className="text-xl font-black text-on-surface mt-1">
                                {formatCurrency(snapshot.debtProfile.creditCardDueNext30Days)}
                            </p>
                        </div>

                        <div className="bg-background rounded-xl border border-border p-4">
                            <p className="text-xs font-bold text-muted uppercase">Em atraso</p>
                            <p className={`text-xl font-black mt-1 ${snapshot.debtProfile.creditCardOverdueAmount > 0
                                ? 'text-red-600'
                                : 'text-green-600'
                                }`}>
                                {formatCurrency(snapshot.debtProfile.creditCardOverdueAmount)}
                            </p>
                        </div>
                    </div>

                    <div className="overflow-x-auto border-t border-border">
                        <table className="w-full text-left text-sm">
                            <thead className="bg-gray-50 dark:bg-dark-300/50 text-muted uppercase text-[10px] font-black tracking-widest">
                                <tr>
                                    <th className="px-5 py-4">Cartão</th>
                                    <th className="px-5 py-4 text-right">Utilização</th>
                                    <th className="px-5 py-4 text-right">Limite disponível</th>
                                    <th className="px-5 py-4 text-right">Fatura atual</th>
                                    <th className="px-5 py-4 text-right">Futuro</th>
                                    <th className="px-5 py-4 text-right">Atraso</th>
                                </tr>
                            </thead>

                            <tbody className="divide-y divide-border">
                                {creditCardIndicators.map((card) => (
                                    <tr key={card.cardId} className="hover:bg-background/40 transition-colors">
                                        <td className="px-5 py-4">
                                            <p className="font-bold text-on-surface">{card.cardName}</p>
                                            <p className="text-xs text-muted">
                                                {card.currentInvoiceDueDate
                                                    ? `Vencimento atual: ${new Date(`${card.currentInvoiceDueDate}T12:00:00`).toLocaleDateString('pt-BR')}`
                                                    : 'Sem fatura aberta'}
                                            </p>
                                        </td>

                                        <td className="px-5 py-4 text-right">
                                            <span className={`font-black ${card.utilizationRate >= 90
                                                ? 'text-red-600'
                                                : card.utilizationRate >= 75
                                                    ? 'text-amber-600'
                                                    : 'text-green-600'
                                                }`}>
                                                {card.utilizationRate.toFixed(1)}%
                                            </span>
                                        </td>

                                        <td className="px-5 py-4 text-right font-medium text-on-surface">
                                            {formatCurrency(card.limitAvailable)}
                                        </td>

                                        <td className="px-5 py-4 text-right font-medium text-on-surface">
                                            {formatCurrency(card.openInvoiceBalance)}
                                        </td>

                                        <td className="px-5 py-4 text-right font-medium text-on-surface">
                                            {formatCurrency(card.futureCommittedBalance)}
                                        </td>

                                        <td className={`px-5 py-4 text-right font-bold ${card.overdueAmount > 0 ? 'text-red-600' : 'text-green-600'
                                            }`}>
                                            {formatCurrency(card.overdueAmount)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Main Content: Table & Alerts */}
                <div className="lg:col-span-2 space-y-8">
                    {/* Summary Table - RESTORED FEATURE */}
                    <div className="bg-surface rounded-card border border-border shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-border bg-background/30 flex justify-between items-center">
                            <h3 className="font-bold text-on-surface flex items-center gap-2">
                                <DynamicIcon name="History" className="w-5 h-5 text-primary" />
                                Resumo de Fluxo de Caixa Mensal
                            </h3>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-gray-50 dark:bg-dark-300/50 text-muted uppercase text-[10px] font-black tracking-widest">
                                    <tr>
                                        <th className="px-6 py-4">Mês Referência</th>
                                        <th className="px-6 py-4 text-right">Entradas</th>
                                        <th className="px-6 py-4 text-right">Saídas</th>
                                        <th className="px-6 py-4 text-right">Resultado</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                    {snapshot.cashFlow.map((month, idx) => (
                                        <tr key={idx} className="hover:bg-background/40 transition-colors">
                                            <td className="px-6 py-4 font-bold text-on-surface capitalize">
                                                {formatDateMonth(month.month)}
                                            </td>
                                            <td className="px-6 py-4 text-right text-green-600 font-medium">
                                                {formatCurrency(month.totalIncome)}
                                            </td>
                                            <td className="px-6 py-4 text-right text-red-600 font-medium">
                                                {formatCurrency(month.totalExpenses)}
                                            </td>
                                            <td className={`px-6 py-4 text-right font-black ${month.netCashFlow >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                {formatCurrency(month.netCashFlow)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <ReportsAlertsPanel snapshot={snapshot} />
                </div>

                {/* Sidebar: Risk Profile & AI Insight */}
                <div className="space-y-6">
                    {/* Risk Profile - RESTORED FEATURE */}
                    <div className="bg-surface rounded-card p-6 border border-border shadow-sm">
                        <h3 className="text-sm font-bold text-muted uppercase tracking-widest mb-6 flex items-center gap-2">
                            <TargetIcon className="w-4 h-4 text-primary" /> Perfil de Risco
                        </h3>
                        <div className="space-y-5">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-on-surface font-medium">Utilização do Crédito</span>
                                <span className={`text-sm font-black ${snapshot.debtProfile.utilizationRate > 70 ? 'text-red-600' : 'text-green-600'}`}>
                                    {snapshot.debtProfile.utilizationRate.toFixed(1)}%
                                </span>
                            </div>
                            <div className="w-full h-2.5 bg-background rounded-full overflow-hidden border border-border/50">
                                <MotionDiv
                                    initial={{ width: 0 }}
                                    animate={{ width: `${Math.min(100, snapshot.debtProfile.utilizationRate)}%` }}
                                    transition={{ duration: 1.5, ease: "easeOut" }}
                                    className={`h-full ${snapshot.debtProfile.utilizationRate > 75 ? 'bg-red-500' : snapshot.debtProfile.utilizationRate > 40 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                />
                            </div>
                            <div className="flex items-center gap-3 p-4 bg-background rounded-xl border border-border">
                                <WarningIcon className={`w-5 h-5 flex-shrink-0 ${snapshot.debtProfile.riskLevel === 'baixo' ? 'text-green-500' : 'text-orange-500'}`} />
                                <span className="text-xs font-bold text-on-surface leading-tight">
                                    Grau de Endividamento: <strong className="uppercase text-primary">{snapshot.debtProfile.riskLevel}</strong>
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* IA Insight - Integrated */}
                    <div className="bg-primary/5 rounded-card p-6 border border-primary/10 shadow-sm relative overflow-hidden group">
                        <div className="relative z-10">
                            <h3 className="text-xs font-black text-primary uppercase tracking-widest mb-4 flex items-center gap-2">
                                <SparklesIcon className="w-4 h-4 animate-pulse" /> Insight Financeiro IA
                            </h3>
                            <p className="text-sm text-on-surface/90 leading-relaxed italic font-medium">
                                {isPJ
                                    ? "Sua margem líquida atual é de " + (snapshot.kpis.find(k => k.id === 'kpi-profit-margin')?.formattedValue || '0%') + ". No seu setor, margens acima de 15% são consideradas saudáveis para expansão."
                                    : "Sua taxa de poupança está em " + (snapshot.kpis.find(k => k.id === 'kpi-savings')?.value || 0).toFixed(1) + "%. Manter esse ritmo permitirá atingir suas metas de longo prazo antecipadamente."
                                }
                            </p>
                        </div>
                        <DynamicIcon name="ChartPie" className="absolute right-[-20px] bottom-[-20px] w-24 h-24 text-primary/10 -rotate-12 group-hover:rotate-0 transition-transform duration-700" />
                    </div>

                    {/* Top Expense Mini-Chart - Fusion Gain */}
                    <div className="bg-surface rounded-card p-6 border border-border shadow-sm">
                        <h3 className="text-sm font-bold text-muted uppercase tracking-widest mb-4">Principais Centros de Custo</h3>
                        <div className="space-y-4">
                            {snapshot.expenseCategories.slice(0, 3).map((cat, i) => (
                                <div key={i} className="space-y-1">
                                    <div className="flex justify-between text-xs">
                                        <span className="font-medium text-on-surface">{cat.categoryName}</span>
                                        <span className="font-bold text-muted">{cat.percentageOfTotal.toFixed(0)}%</span>
                                    </div>
                                    <div className="h-1.5 w-full bg-background rounded-full overflow-hidden">
                                        <div className="h-full bg-primary/40" style={{ width: `${cat.percentageOfTotal}%` }}></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReportsOverview;
