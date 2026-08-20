
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Transaction, Goal } from '../types.ts';
import { calculatePJAllocation, PJ_MODELS } from '../modules/business-allocations/logic.ts';
import { PJAllocationModel, PJAllocationBucket } from '../modules/business-allocations/types.ts';
import { contributionAllocation, isInvestmentContribution } from '../modules/investments/semantics.ts';
import { 
    BriefcaseIcon, TrendingUpIcon, BuildingIcon, 
    WarningIcon, CheckIcon, SettingsIcon, 
    CloseIcon, ArrowUpIcon, ArrowDownIcon,
    ShieldCheckIcon, ChartBarIcon, SparklesIcon,
    // Added SearchIcon to imports
    SearchIcon
} from './Icons.tsx';

interface BusinessAllocationAnalysisProps {
    transactions: Transaction[];
    goals: Goal[];
}

const BusinessAllocationAnalysis: React.FC<BusinessAllocationAnalysisProps> = ({ transactions, goals }) => {
    const [selectedModel, setSelectedModel] = useState<PJAllocationModel>(PJ_MODELS[0]);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [drilldownBucket, setDrilldownBucket] = useState<PJAllocationBucket | null>(null);

    const diagnostic = useMemo(() => 
        calculatePJAllocation(transactions, selectedModel),
    [transactions, selectedModel]);

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    const drilldownTransactions = useMemo(() => {
        if (!drilldownBucket) return [];
        // Filtra transações baseada no mapeamento da lógica
        // Recria o mapa aqui para evitar exportações desnecessárias ou redundância complexa
        const CATEGORY_MAP: any = { 
            'Moradia': 'operacional', 'Utilidades': 'operacional', 'Salários': 'operacional', 
            'Marketing': 'reinvestimento', 'Software': 'reinvestimento', 'Equipamentos': 'reinvestimento',
            'Reserva de Caixa': 'reserva', 'Aplicações de Liquidez': 'reserva',
            'Empréstimo': 'dividas', 'Juros': 'dividas'
        };
        return transactions.filter(t => {
            if (t.type === 'receita') return false;
            if (t.type === 'investimento' && (!isInvestmentContribution(t) || contributionAllocation(t) <= 0)) return false;
            const b = CATEGORY_MAP[t.category] || 'operacional';
            return b === drilldownBucket;
        });
    }, [drilldownBucket, transactions]);

    const MotionDiv = motion.div as any;

    return (
        <div className="mb-10 space-y-6 animate-fade-in">
            {/* Bloco Principal de Performance */}
            <div className="bg-surface rounded-card border border-border shadow-sm overflow-hidden flex flex-col xl:flex-row">
                {/* Lateral Esquerda: Diagnóstico de Receita */}
                <div className="p-6 xl:w-1/3 bg-primary/5 border-r border-border relative overflow-hidden">
                    <div className="relative z-10">
                        <div className="flex justify-between items-start mb-2">
                            <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Faturamento Operacional</span>
                            <button onClick={() => setIsSettingsOpen(true)} className="p-1 text-muted hover:text-primary transition-colors">
                                <SettingsIcon className="w-4 h-4" />
                            </button>
                        </div>
                        <h2 className="text-3xl font-black text-on-surface mb-1">{formatCurrency(diagnostic.revenue)}</h2>
                        <div className="flex items-center gap-2 mt-2">
                             <div className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase ${diagnostic.margin > 15 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                Margem: {diagnostic.margin.toFixed(1)}%
                             </div>
                             <div className="flex items-center gap-1 text-[10px] text-muted font-bold">
                                {diagnostic.trends.margin === 'up' ? <ArrowUpIcon className="w-3 h-3 text-green-500" /> : <ArrowDownIcon className="w-3 h-3 text-red-500" />}
                                vs. Mês Ant.
                             </div>
                        </div>
                    </div>
                    <BriefcaseIcon className="absolute right-[-20px] bottom-[-20px] w-40 h-40 opacity-[0.03] rotate-12" />
                </div>

                {/* Centro: Meta de Capitalização */}
                <div className="flex-1 p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    <div>
                        <span className="text-[10px] font-bold text-muted uppercase block mb-1">Alvo Capitalização (Res+Reinv)</span>
                        <div className="text-xl font-black text-on-surface">{formatCurrency(diagnostic.totalTargetValue)}</div>
                        <p className="text-[10px] text-muted">Baseado no modelo {selectedModel.name}</p>
                    </div>
                    <div>
                        <span className="text-[10px] font-bold text-muted uppercase block mb-1">Realizado no Período</span>
                        <div className="text-xl font-black text-indigo-600">{formatCurrency(diagnostic.totalActualValue)}</div>
                    </div>
                    <div>
                        <span className="text-[10px] font-bold text-muted uppercase block mb-1">Diferença p/ Meta</span>
                        <div className={`text-xl font-black ${diagnostic.totalActualValue >= diagnostic.totalTargetValue ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(diagnostic.totalActualValue - diagnostic.totalTargetValue)}
                        </div>
                    </div>

                    <div className="sm:col-span-2 lg:col-span-3 pt-2">
                        <div className="flex justify-between items-center text-[10px] font-black text-muted uppercase mb-2 tracking-widest">
                            <span>Eficiência de Alocação de Lucro</span>
                            <span>{diagnostic.allocationProgress.toFixed(0)}% da meta</span>
                        </div>
                        <div className="h-3 w-full bg-background rounded-full overflow-hidden border border-border/50 shadow-inner">
                            <MotionDiv 
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, diagnostic.allocationProgress)}%` }}
                                transition={{ duration: 1.5, ease: "circOut" }}
                                className={`h-full ${diagnostic.allocationProgress >= 100 ? 'bg-green-500' : 'bg-primary'}`}
                            />
                        </div>
                    </div>
                </div>
            </div>

            {/* Sub-cards: Detalhamento de Buckets */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Reserva */}
                <MotionDiv whileHover={{ y: -3 }} onClick={() => setDrilldownBucket('reserva')} className={`p-4 rounded-xl border bg-surface cursor-pointer shadow-sm transition-all ${diagnostic.buckets.reserva.status === 'critical' ? 'border-red-200 hover:border-red-400' : 'border-border hover:border-primary/50'}`}>
                    <div className="flex justify-between items-start mb-3">
                        <span className="text-[9px] font-black text-muted uppercase tracking-widest">Reserva de Caixa</span>
                        <ShieldCheckIcon className={`w-4 h-4 ${diagnostic.buckets.reserva.status === 'healthy' ? 'text-green-500' : 'text-red-500'}`} />
                    </div>
                    <div className="text-xl font-black text-on-surface">{formatCurrency(diagnostic.buckets.reserva.actualValue)}</div>
                    <p className="text-[10px] text-muted font-bold mt-1">Alvo: {selectedModel.percentages.reserva}% da receita</p>
                </MotionDiv>

                {/* Reinvestimento */}
                <MotionDiv whileHover={{ y: -3 }} onClick={() => setDrilldownBucket('reinvestimento')} className={`p-4 rounded-xl border bg-surface cursor-pointer shadow-sm transition-all ${diagnostic.buckets.reinvestimento.status === 'critical' ? 'border-red-200 hover:border-red-400' : 'border-border hover:border-primary/50'}`}>
                    <div className="flex justify-between items-start mb-3">
                        <span className="text-[9px] font-black text-muted uppercase tracking-widest">Reinvestimento</span>
                        <TrendingUpIcon className="w-4 h-4 text-primary" />
                    </div>
                    <div className="text-xl font-black text-on-surface">{formatCurrency(diagnostic.buckets.reinvestimento.actualValue)}</div>
                    <p className="text-[10px] text-muted font-bold mt-1">Crescimento: {diagnostic.buckets.reinvestimento.percentageOfRevenue.toFixed(1)}% investidos</p>
                </MotionDiv>

                {/* Dívidas */}
                <MotionDiv whileHover={{ y: -3 }} onClick={() => setDrilldownBucket('dividas')} className="p-4 rounded-xl border border-border bg-surface cursor-pointer shadow-sm hover:border-red-400 transition-all">
                    <div className="flex justify-between items-start mb-3">
                        <span className="text-[9px] font-black text-muted uppercase tracking-widest">Endividamento/Juros</span>
                        <ArrowDownIcon className="w-4 h-4 text-red-500" />
                    </div>
                    <div className="text-xl font-black text-on-surface">{formatCurrency(diagnostic.buckets.dividas.actualValue)}</div>
                    <p className="text-[10px] text-muted font-bold mt-1">Comprometimento: {diagnostic.buckets.dividas.percentageOfRevenue.toFixed(1)}%</p>
                </MotionDiv>

                {/* Operacional */}
                <MotionDiv whileHover={{ y: -3 }} onClick={() => setDrilldownBucket('operacional')} className="p-4 rounded-xl border border-border bg-surface cursor-pointer shadow-sm hover:border-primary/50 transition-all">
                    <div className="flex justify-between items-start mb-3">
                        <span className="text-[9px] font-black text-muted uppercase tracking-widest">Custo Operacional</span>
                        <BuildingIcon className="w-4 h-4 text-muted" />
                    </div>
                    <div className="text-xl font-black text-on-surface">{formatCurrency(diagnostic.operatingExpenses)}</div>
                    <p className="text-[10px] text-muted font-bold mt-1">Eficiência: {( (diagnostic.operatingExpenses/ (diagnostic.revenue || 1)) * 100).toFixed(1)}%</p>
                </MotionDiv>
            </div>

            {/* Insights do "CFO IA" */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {diagnostic.alerts.map(alert => (
                    <div key={alert.id} className={`p-4 rounded-xl border flex items-start gap-3 shadow-sm ${
                        alert.severity === 'error' ? 'bg-red-50 border-red-100 text-red-700 dark:bg-red-900/10' :
                        alert.severity === 'warning' ? 'bg-yellow-50 border-yellow-100 text-yellow-700 dark:bg-yellow-900/10' :
                        'bg-blue-50 border-blue-100 text-blue-700 dark:bg-blue-900/10'
                    }`}>
                        <div className="mt-0.5">
                            {alert.severity === 'error' ? <WarningIcon className="w-4 h-4" /> : <SparklesIcon className="w-4 h-4" />}
                        </div>
                        <div>
                            <p className="text-xs font-black uppercase tracking-wider mb-1">{alert.title}</p>
                            <p className="text-xs font-medium leading-relaxed opacity-90">{alert.message}</p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Modais de Suporte */}
            <AnimatePresence>
                {drilldownBucket && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setDrilldownBucket(null)}>
                         <MotionDiv 
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-surface w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
                            onClick={e => e.stopPropagation()}
                         >
                            <div className="p-5 border-b border-border flex justify-between items-center bg-background/50">
                                <h3 className="font-black text-on-surface uppercase tracking-[0.1em] text-sm flex items-center gap-2">
                                    <ChartBarIcon className="w-4 h-4 text-primary" /> Conciliação de {diagnostic.buckets[drilldownBucket].label}
                                </h3>
                                <button onClick={() => setDrilldownBucket(null)} className="p-1 hover:bg-background rounded-full transition-colors"><CloseIcon /></button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
                                {drilldownTransactions.length > 0 ? (
                                    <div className="space-y-3">
                                        {drilldownTransactions.map(t => (
                                            <div key={t.id} className="p-4 bg-background rounded-xl border border-border flex justify-between items-center hover:shadow-md transition-all">
                                                <div>
                                                    <p className="font-bold text-on-surface text-sm">{t.description}</p>
                                                    <p className="text-[10px] text-muted font-black uppercase mt-1">{new Date(t.date).toLocaleDateString('pt-BR')} • {t.category}</p>
                                                </div>
                                                <p className="font-black text-on-surface">{formatCurrency(t.value)}</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="py-20 text-center text-muted italic flex flex-col items-center">
                                        <div className="w-12 h-12 rounded-full bg-background flex items-center justify-center mb-4">
                                            <SearchIcon className="w-6 h-6 opacity-30" />
                                        </div>
                                        Nenhuma transação registrada neste período.
                                    </div>
                                )}
                            </div>
                         </MotionDiv>
                    </div>
                )}

                {isSettingsOpen && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60" onClick={() => setIsSettingsOpen(false)}>
                         <MotionDiv 
                            initial={{ y: 20, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            className="bg-surface w-full max-w-sm rounded-2xl p-6 shadow-2xl"
                            onClick={e => e.stopPropagation()}
                         >
                            <h3 className="text-lg font-black text-on-surface mb-6 flex items-center gap-2 uppercase tracking-tighter">
                                <SettingsIcon className="w-5 h-5 text-primary" /> Modelo de Gestão PJ
                            </h3>
                            <div className="space-y-3">
                                {PJ_MODELS.map(m => (
                                    <button 
                                        key={m.id}
                                        onClick={() => { setSelectedModel(m); setIsSettingsOpen(false); }}
                                        className={`w-full p-4 rounded-xl border text-left transition-all ${selectedModel.id === m.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-background'}`}
                                    >
                                        <p className="font-black text-on-surface text-sm uppercase tracking-wide">{m.name}</p>
                                        <p className="text-[10px] text-muted mt-1 leading-tight">{m.description}</p>
                                        <div className="flex gap-2 mt-3">
                                            <span className="text-[9px] font-black uppercase text-indigo-600 bg-indigo-50 px-1.5 rounded">Res: {m.percentages.reserva}%</span>
                                            <span className="text-[9px] font-black uppercase text-emerald-600 bg-emerald-50 px-1.5 rounded">Reinv: {m.percentages.reinvestimento}%</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <button onClick={() => setIsSettingsOpen(false)} className="w-full mt-8 py-3 bg-background border border-border rounded-xl font-black text-xs uppercase tracking-widest hover:bg-surface transition-all">Fechar Configurações</button>
                         </MotionDiv>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default BusinessAllocationAnalysis;
