
import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Transaction, Goal } from '../types.ts';
import { AllocationModel, AllocationDiagnostic, AllocationBucket } from '../modules/allocations/types.ts';
import { calculateAllocation, MODELS } from '../modules/allocations/logic.ts';
import { 
    SparklesIcon, TrendingUpIcon, WarningIcon, 
    CheckIcon, InfoIcon, SettingsIcon, CloseIcon, 
    ArrowUpIcon, ArrowDownIcon, ListIcon, WalletIcon 
} from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useCreateNotification } from '../modules/notifications/hooks.ts';

interface AllocationAnalysisProps {
    transactions: Transaction[];
    goals: Goal[];
    periodLabel: string;
}

const AllocationAnalysis: React.FC<AllocationAnalysisProps> = ({ transactions, goals, periodLabel }) => {
    const { theme } = useTheme();
    const [selectedModel, setSelectedModel] = useState<AllocationModel>(MODELS[0]);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [drilldownBucket, setDrilldownBucket] = useState<AllocationBucket | null>(null);
    
    // Simulate previous period comparison (In a real app this would come from a query)
    const prevPercentage = 22.5; 

    const diagnostic = useMemo(() => 
        calculateAllocation(transactions, goals, selectedModel, prevPercentage),
    [transactions, goals, selectedModel]);

    const formatCurrency = (val: number) => 
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    const drilldownTransactions = useMemo(() => {
        if (!drilldownBucket) return [];
        // Helper: same logic as the calculator to get transactions
        // (This should ideally be refactored into a selector)
        return transactions.filter(t => {
            if (t.type === 'receita') return false;
            if (t.type === 'investimento') {
                const isRetirement = goals.find(g => g.id === t.goalId)?.category === 'patrimonio' || !t.goalId;
                if (drilldownBucket === 'aposentadoria') return isRetirement;
                if (drilldownBucket === 'objetivos') return !!t.goalId && !isRetirement;
                return false;
            }
            // For expenses, we use the CATEGORY_MAP logic implicitly
            const CATEGORY_MAP: any = { 'Moradia': 'essenciais', 'Utilidades': 'essenciais', 'Alimentação': 'essenciais', 'Saúde': 'essenciais', 'Transporte': 'essenciais', 'Educação': 'educacao' };
            const bucket = CATEGORY_MAP[t.category] || 'estilo_vida';
            return bucket === drilldownBucket;
        });
    }, [drilldownBucket, transactions, goals]);

    const MotionDiv = motion.div as any;

    return (
        <div className="space-y-6 mb-10 animate-fade-in">
            {/* Header com Meta de Investimento */}
            <div className="bg-surface rounded-card border border-border shadow-sm overflow-hidden flex flex-col md:flex-row">
                <div className="p-6 md:w-1/3 bg-primary/5 border-r border-border relative overflow-hidden">
                    <div className="relative z-10">
                        <div className="flex justify-between items-start mb-2">
                            <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Fluxo de Futuro (Alvo {diagnostic.investmentTarget}%)</span>
                            <button onClick={() => setIsSettingsOpen(true)} className="p-1 text-muted hover:text-primary transition-colors">
                                <SettingsIcon className="w-4 h-4" />
                            </button>
                        </div>
                        <h2 className="text-3xl font-black text-on-surface mb-1">{diagnostic.investedPercentage.toFixed(1)}%</h2>
                        <p className="text-xs text-muted font-medium">Investidos em {periodLabel}</p>
                        
                        <div className="mt-4 flex items-center gap-2">
                             {diagnostic.trend.direction === 'up' ? <ArrowUpIcon className="w-3 h-3 text-green-500" /> : <ArrowDownIcon className="w-3 h-3 text-red-500" />}
                             <span className={`text-[10px] font-bold ${diagnostic.trend.direction === 'up' ? 'text-green-600' : 'text-red-600'}`}>
                                {diagnostic.trend.percentageDiff.toFixed(1)}% {diagnostic.trend.direction === 'up' ? 'melhor que' : 'abaixo do'} período anterior
                             </span>
                        </div>
                    </div>
                    <div className="absolute right-[-20px] bottom-[-20px] opacity-[0.03] rotate-12">
                        <TrendingUpIcon className="w-40 h-40" />
                    </div>
                </div>

                <div className="flex-1 p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    <div>
                        <span className="text-[10px] font-bold text-muted uppercase block mb-1">Receita Líquida</span>
                        <div className="text-lg font-bold text-on-surface">{formatCurrency(diagnostic.totalIncome)}</div>
                    </div>
                    <div>
                        <span className="text-[10px] font-bold text-muted uppercase block mb-1">Alvo do Período</span>
                        <div className="text-lg font-bold text-primary">{formatCurrency(diagnostic.totalIncome * (diagnostic.investmentTarget/100))}</div>
                    </div>
                    <div>
                        <span className="text-[10px] font-bold text-muted uppercase block mb-1">Total Investido</span>
                        <div className="text-lg font-bold text-emerald-600">{formatCurrency(diagnostic.totalInvested)}</div>
                    </div>
                    <div>
                        <span className="text-[10px] font-bold text-muted uppercase block mb-1">Diferença</span>
                        <div className={`text-lg font-bold ${diagnostic.totalInvested >= (diagnostic.totalIncome * (diagnostic.investmentTarget/100)) ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(diagnostic.totalInvested - (diagnostic.totalIncome * (diagnostic.investmentTarget/100)))}
                        </div>
                    </div>

                    <div className="sm:col-span-2 lg:col-span-4 space-y-2 pt-2">
                         <div className="flex justify-between items-center text-[10px] font-bold text-muted uppercase">
                            <span>Progresso da Alocação</span>
                            <span>{Math.min(100, (diagnostic.investedPercentage / diagnostic.investmentTarget) * 100).toFixed(0)}%</span>
                         </div>
                         <div className="h-2 w-full bg-background rounded-full overflow-hidden border border-border/50">
                            <MotionDiv 
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, (diagnostic.investedPercentage / diagnostic.investmentTarget) * 100)}%` }}
                                className={`h-full ${diagnostic.investedPercentage >= diagnostic.investmentTarget ? 'bg-emerald-500' : 'bg-primary'}`}
                            />
                         </div>
                    </div>
                </div>
            </div>

            {/* Buckets Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                {(Object.values(diagnostic.results) as any[]).map((res) => (
                    <MotionDiv 
                        whileHover={{ y: -3 }}
                        key={res.bucket} 
                        onClick={() => setDrilldownBucket(res.bucket)}
                        className={`bg-surface p-4 rounded-card border transition-all cursor-pointer group shadow-sm ${
                            res.status === 'critical' ? 'border-red-200 hover:border-red-400' : 
                            res.status === 'warning' ? 'border-yellow-200 hover:border-yellow-400' : 
                            'border-border hover:border-primary/50'
                        }`}
                    >
                        <div className="flex justify-between items-start mb-3">
                            <span className="text-[9px] font-black text-muted uppercase tracking-widest">{res.label}</span>
                            <div className={`w-1.5 h-1.5 rounded-full ${
                                res.status === 'critical' ? 'bg-red-500' : 
                                res.status === 'warning' ? 'bg-yellow-500' : 
                                'bg-emerald-500'
                            }`} />
                        </div>
                        <div className="text-lg font-black text-on-surface mb-1">{res.actualPercentage.toFixed(1)}%</div>
                        <div className="text-[10px] text-muted font-bold truncate">Alvo: {res.targetPercentage}% ({formatCurrency(res.targetValue)})</div>
                        
                        <div className="mt-3 h-1 w-full bg-background rounded-full overflow-hidden">
                             <div 
                                className={`h-full transition-all duration-1000 ${
                                    res.status === 'critical' ? 'bg-red-500' : 
                                    res.status === 'warning' ? 'bg-yellow-500' : 
                                    'bg-primary'
                                }`}
                                style={{ width: `${Math.min(100, (res.actualPercentage / (res.targetPercentage || 1)) * 100)}%` }}
                             />
                        </div>
                    </MotionDiv>
                ))}
            </div>

            {/* Insights IA / Alertas */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {diagnostic.alerts.map(alert => (
                    <div key={alert.id} className={`p-4 rounded-xl border flex items-start gap-3 shadow-sm ${
                        alert.type === 'warning' ? 'bg-red-50 border-red-100 text-red-700 dark:bg-red-900/10 dark:border-red-900/30 dark:text-red-300' :
                        alert.type === 'success' ? 'bg-green-50 border-green-100 text-green-700 dark:bg-green-900/10 dark:border-green-900/30 dark:text-green-300' :
                        'bg-blue-50 border-blue-100 text-blue-700 dark:bg-blue-900/10 dark:border-blue-900/30 dark:text-blue-300'
                    }`}>
                        <div className="mt-0.5">
                            {/* Changed SparklesIcon to InfoIcon for better alert visualization */}
                            {alert.type === 'warning' ? <WarningIcon className="w-4 h-4" /> : alert.type === 'success' ? <CheckIcon className="w-4 h-4" /> : <InfoIcon className="w-4 h-4" />}
                        </div>
                        <p className="text-xs font-bold leading-relaxed">{alert.message}</p>
                    </div>
                ))}
            </div>

            {/* Modais */}
            <AnimatePresence>
                {drilldownBucket && (
                    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setDrilldownBucket(null)}>
                         <MotionDiv 
                            initial={{ scale: 0.95, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.95, opacity: 0 }}
                            className="bg-surface w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
                            onClick={e => e.stopPropagation()}
                         >
                            <div className="p-5 border-b border-border flex justify-between items-center bg-background/50">
                                <h3 className="font-black text-on-surface uppercase tracking-widest text-sm flex items-center gap-2">
                                    <ListIcon className="w-4 h-4 text-primary" /> Detalhamento: {diagnostic.results[drilldownBucket].label}
                                </h3>
                                <button onClick={() => setDrilldownBucket(null)} className="p-1 hover:bg-background rounded-full"><CloseIcon /></button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                                {drilldownTransactions.length > 0 ? (
                                    <div className="space-y-2">
                                        {drilldownTransactions.map(t => (
                                            <div key={t.id} className="p-3 bg-background rounded-xl border border-border flex justify-between items-center">
                                                <div>
                                                    <p className="text-sm font-bold text-on-surface">{t.description}</p>
                                                    <p className="text-[10px] text-muted">{new Date(t.date).toLocaleDateString('pt-BR')} • {t.category}</p>
                                                </div>
                                                <p className="font-black text-on-surface">{formatCurrency(t.value)}</p>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="py-12 text-center text-muted italic">Nenhuma transação encontrada neste bucket.</div>
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
                            <h3 className="text-lg font-black text-on-surface mb-6 flex items-center gap-2">
                                <SettingsIcon className="w-5 h-5 text-primary" /> Modelo de Alocação
                            </h3>
                            <div className="space-y-3">
                                {MODELS.map(m => (
                                    <button 
                                        key={m.id}
                                        onClick={() => { setSelectedModel(m); setIsSettingsOpen(false); }}
                                        className={`w-full p-4 rounded-xl border text-left transition-all ${selectedModel.id === m.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-background'}`}
                                    >
                                        <p className="font-bold text-on-surface text-sm">{m.name}</p>
                                        <div className="flex gap-2 mt-2">
                                            {Object.entries(m.percentages).map(([k, v]) => v > 0 && (
                                                <span key={k} className="text-[9px] font-black uppercase text-muted bg-background px-1.5 rounded">{k[0]}:{v}%</span>
                                            ))}
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <button onClick={() => setIsSettingsOpen(false)} className="w-full mt-6 py-3 bg-background border border-border rounded-xl font-bold text-sm">Fechar</button>
                         </MotionDiv>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default AllocationAnalysis;
