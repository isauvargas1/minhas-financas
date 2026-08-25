
import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Goal, Transaction, GoalStatus } from '../types.ts';
import { 
    BackIcon, EditIcon, DeleteIcon, CheckIcon, TargetIcon, 
    TrendingUpIcon, ClockIcon, HistoryIcon, PlusIcon, 
    DynamicIcon, PiggyBankIcon, BriefcaseIcon, BuildingIcon
} from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { motion } from 'framer-motion';
// @ts-ignore
import confetti from 'canvas-confetti';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { calculateBusinessGoalProgress, getGoalPaceStatus, getPeriodDates } from '../modules/goals/logic.ts';
import { goalInvestmentImpact, transactionCashImpact } from '../modules/investments/semantics.ts';
import { listGoalInvestmentMovements } from '../modules/investments/persistence/readApi.ts';

/** Rótulo em pt-BR de cada operação do domínio patrimonial. */
const MOVEMENT_LABELS: Record<string, string> = {
    contribution: 'Aporte',
    redemption: 'Resgate',
    reversal: 'Estorno',
    goal_link: 'Vínculo com a meta',
    goal_unlink: 'Desvínculo da meta',
};

interface GoalDetailsViewProps {
    goal: Goal;
    transactions: Transaction[];
    onBack: () => void;
    onEdit: (goal: Goal) => void;
    onLink: (goal: Goal) => void;
    onDelete: (goalId: string) => void;
    onUpdateStatus?: (goal: Goal, status: GoalStatus) => void;
    onAddInvestment: (goalId: string) => void;
}

const adjustBrightness = (color: string, amount: number) => {
    return '#' + color.replace(/^#/, '').replace(/../g, color => ('0'+Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
}

const GoalDetailsView: React.FC<GoalDetailsViewProps> = ({ 
    goal, transactions, onBack, onEdit, onLink, onDelete, onUpdateStatus, onAddInvestment 
}) => {
    const { theme } = useTheme();
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';
    const MotionDiv = motion.div as any;
    const investmentsV2Enabled =
        activeWorkspace.features?.investmentsV2?.enabled === true;

    // Movimentos oficiais do domínio patrimonial vinculados a esta meta.
    const goalMovements = useQuery({
        queryKey: ['goal-investment-movements', activeWorkspace.id, goal.id],
        enabled: investmentsV2Enabled && Boolean(goal.id),
        queryFn: async () => {
            const movements = await listGoalInvestmentMovements(
                activeWorkspace.id,
                String(goal.id),
            );
            return movements.map((movement) => ({
                id: movement.id,
                type: 'investimento' as const,
                description: movement.description,
                category: MOVEMENT_LABELS[movement.operation] ?? 'Movimentação',
                value: movement.principalCents / 100,
                date: movement.occurredAt?.toDate().toISOString().slice(0, 10) ?? '',
                goalId: String(goal.id),
            }));
        },
    });

    const currentVal = useMemo(() => {
        if (isPJ && goal.isAutomatic) {
            const balance = transactions.reduce((acc, transaction) => acc + transactionCashImpact(transaction), 0);
            return calculateBusinessGoalProgress(goal, transactions, balance);
        }
        return goal.currentAmount;
    }, [isPJ, goal, transactions]);

    const percentage = goal.targetAmount > 0 ? (currentVal / goal.targetAmount) * 100 : 0;
    const paceStatus = getGoalPaceStatus(goal, currentVal);

    const periodInfo = useMemo(() => {
        if (!isPJ || !goal.period) return null;
        return getPeriodDates(goal.period, goal.startDate, goal.deadline);
    }, [isPJ, goal]);

    const formatValue = (val: number) => {
        if (isPJ && goal.businessType === 'margem') return `${val.toFixed(1)}%`;
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

  const handleComplete = () => {
    confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: [goal.visual.color, '#ffffff'] });
    onUpdateStatus?.(goal, 'alcancada');
};

    const darkerColor = adjustBrightness(goal.visual.color, -50);
    const gradientStyle = `radial-gradient(circle at top left, rgba(255,255,255,0.2) 0%, transparent 40%), linear-gradient(135deg, ${goal.visual.color} 0%, ${darkerColor} 100%)`;

    // --- PF SPECIFIC RENDER (RESTAURADO) ---
    if (!isPJ) {
        const statusOptions = [
            { key: 'em_andamento', label: 'Retomar', activeLabel: 'Em Andamento', icon: 'PlayerPlay', color: 'blue' },
            { key: 'pausada', label: 'Pausar', activeLabel: 'Pausada', icon: 'PlayerPause', color: 'yellow' },
            { key: 'alcancada', label: 'Concluir', activeLabel: 'Concluída', icon: 'Check', color: 'green' },
            { key: 'cancelada', label: 'Cancelar', activeLabel: 'Cancelada', icon: 'X', color: 'red' }
        ];

        /*
         * INV-P2-029 — a lista de movimentações acompanha a fonte do número.
         *
         * Com o domínio patrimonial ligado, o progresso vem de
         * `investmentProgressCents`, mas a lista continuava vindo de
         * `transactions` filtrada por `goalId`. O vínculo retroativo não gera
         * espelho de caixa, então a meta mostrava progresso positivo com lista
         * vazia — o usuário via um número que nada na tela explicava.
         */
        const goalTransactions = (investmentsV2Enabled
            ? goalMovements.data ?? []
            : transactions
                .filter(t => t.goalId === goal.id && t.type === 'investimento'))
            .slice()
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
        
        const monthlySuggestion = (() => {
            if (goal.status !== 'em_andamento' || percentage >= 100) return 0;
            const start = new Date();
            const end = new Date(goal.deadline);
            const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
            return months > 0 ? remaining / months : remaining;
        })();

        const forecast = (() => {
            if (percentage >= 100 || goal.status !== 'em_andamento') return null;
            if (goalTransactions.length < 2) return null;
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
            const recent = goalTransactions.filter(t => new Date(t.date) >= sixMonthsAgo);
            const distinctMonths = new Set(recent.map(t => t.date.substring(0, 7))).size;
            const divider = Math.max(1, distinctMonths);
            const avgMonthly = recent.reduce((acc, transaction) => acc + goalInvestmentImpact(transaction), 0) / divider;
            if (avgMonthly <= 0) return null;
            const monthsNeeded = remaining / avgMonthly;
            if (monthsNeeded > 120) return "> 10 anos";
            const estimatedDate = new Date();
            estimatedDate.setMonth(estimatedDate.getMonth() + Math.ceil(monthsNeeded));
            return estimatedDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        })();

        // Timeline Logic Recreated
        const timelineEvents = (() => {
            const events = [];
            events.push({ date: goal.startDate, title: 'Meta Criada', type: 'start', value: 0 });
            const chronological = [...goalTransactions].reverse();
            let runningTotal = 0;
            let milestones = [0.25, 0.50, 0.75, 1.0];
            let nextMilestoneIdx = 0;
            chronological.forEach(t => {
                const impact = goalInvestmentImpact(t);
                runningTotal += impact;
                const progress = runningTotal / goal.targetAmount;
                while (nextMilestoneIdx < milestones.length && progress >= milestones[nextMilestoneIdx]) {
                    const pct = milestones[nextMilestoneIdx] * 100;
                    events.push({ date: t.date, title: `Alcançou ${pct}%`, type: 'milestone', value: runningTotal });
                    nextMilestoneIdx++;
                }
                if (impact >= goal.targetAmount * 0.1) {
                    events.push({ date: t.date, title: 'Grande Aporte', type: 'deposit', value: impact });
                }
            });
            if (goal.status === 'alcancada' || percentage >= 100) {
                 if (nextMilestoneIdx < milestones.length) {
                     events.push({ date: new Date().toISOString().split('T')[0], title: 'Meta Concluída! 🎉', type: 'completion', value: goal.currentAmount });
                 }
            }
            return events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        })();

        return (
            <div className="h-full flex flex-col animate-fade-in pb-10">
                {/* Header / Nav */}
                <div className="flex items-center justify-between mb-6 flex-shrink-0 flex-wrap gap-4">
                    <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white transition-colors">
                        <BackIcon className="h-5 w-5" /> Voltar
                    </button>
                    <div className="flex items-center gap-3">
                        <div className="flex bg-gray-100 dark:bg-dark-200 rounded-lg p-1">
                             {statusOptions.map((option) => {
                                 const isActive = goal.status === option.key;
                                 let activeClass = '';
                                 if (isActive) {
                                     if(option.color === 'blue') { activeClass = "bg-white dark:bg-blue-600 text-blue-600 dark:text-white shadow-sm"; }
                                     if(option.color === 'yellow') { activeClass = "bg-white dark:bg-yellow-600 text-yellow-600 dark:text-white shadow-sm"; }
                                     if(option.color === 'green') { activeClass = "bg-white dark:bg-green-600 text-green-600 dark:text-white shadow-sm"; }
                                     if(option.color === 'red') { activeClass = "bg-white dark:bg-red-600 text-red-600 dark:text-white shadow-sm"; }
                                 } else {
                                     activeClass = "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-white/50 dark:hover:bg-dark-300";
                                 }
                                 return (
                                     <button
                                         key={option.key}
onClick={() => { if (option.key === 'alcancada' && !isActive) handleComplete(); else if (!isActive) onUpdateStatus?.(goal, option.key as GoalStatus); }}                                         className={`p-2 rounded-md transition-all flex items-center justify-center gap-2 text-sm font-medium ${activeClass}`}
                                         title={isActive ? option.activeLabel : option.label}
                                     >
                                         <DynamicIcon name={option.icon} size={18} />
                                         {isActive && <span className="hidden sm:inline">{option.activeLabel}</span>}
                                     </button>
                                 );
                            })}
                        </div>
                        <div className="h-6 w-px bg-gray-200 dark:bg-gray-700"></div>
                        <button onClick={() => onEdit(goal)} className="p-2 bg-gray-100 text-gray-700 dark:bg-dark-200 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-dark-300 transition-colors"><EditIcon className="h-4 w-4" /></button>
                        <button onClick={() => onDelete(goal.id)} aria-label="Arquivar meta" title="Arquivar meta" className="p-2 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"><DeleteIcon className="h-4 w-4" /></button>
                    </div>
                </div>

                {/* Hero Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                    <div className="lg:col-span-2 bg-white dark:bg-dark-100 rounded-2xl p-6 shadow-md border border-gray-100 dark:border-gray-700 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-transparent to-white/10 rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ backgroundColor: `${goal.visual.color}20` }} />
                        <div className="flex items-start gap-5 relative z-10">
                            <div className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg border-4 border-white dark:border-dark-100" style={{ background: gradientStyle, color: '#fff' }}>
                                <div className="w-10 h-10 flex items-center justify-center">
                                    {goal.status === 'alcancada' ? <CheckIcon className="w-full h-full" /> : <DynamicIcon name={goal.visual.icon} className="w-full h-full" />}
                                </div>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-1">
                                    <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-gray-100 dark:bg-dark-200 text-gray-500">{goal.category.replace('_', ' ')}</span>
                                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${goal.priority === 'alta' ? 'bg-red-100 text-red-600' : goal.priority === 'media' ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'}`}>Prioridade {goal.priority}</span>
                                </div>
                                <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">{goal.visual.emoji} {goal.name}</h1>
                                <p className="text-gray-500 dark:text-gray-400 text-sm max-w-lg">{goal.description || 'Sem descrição.'}</p>
                            </div>
                        </div>
                        <div className="mt-8 relative z-10">
                            <div className="flex justify-between items-end mb-2">
                                <div><span className="text-sm text-gray-500 dark:text-gray-400">Progresso Atual</span><div className="text-3xl font-bold text-gray-800 dark:text-white flex items-baseline gap-2">{formatValue(goal.currentAmount)}<span className="text-sm font-medium text-gray-400">/ {formatValue(goal.targetAmount)}</span></div></div>
                                <div className="text-right"><span className="text-2xl font-bold" style={{ color: goal.visual.color }}>{percentage.toFixed(1)}%</span></div>
                            </div>
                            <div className="h-4 bg-gray-100 dark:bg-dark-200 rounded-full overflow-hidden">
                                <MotionDiv className="h-full rounded-full relative" initial={{ width: 0 }} animate={{ width: `${Math.min(100, percentage)}%` }} transition={{ duration: 1 }} style={{ backgroundColor: goal.visual.color }}><div className="absolute inset-0 bg-white/20 animate-pulse"></div></MotionDiv>
                            </div>
                            <div className="flex justify-between mt-2 text-xs font-medium text-gray-500 dark:text-gray-400"><span>Início: {new Date(goal.startDate).toLocaleDateString('pt-BR')}</span><span>Prazo: {new Date(goal.deadline).toLocaleDateString('pt-BR')}</span></div>
                        </div>
                    </div>

                    <div className="grid grid-rows-3 gap-4">
                        <div className="bg-white dark:bg-dark-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-4">
                            <div className="p-3 bg-red-50 text-red-500 dark:bg-red-900/20 rounded-lg"><TargetIcon className="h-6 w-6" /></div>
                            <div><span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold">Falta Acumular</span><div className="text-lg font-bold text-gray-800 dark:text-white">{remaining > 0 ? formatValue(remaining) : 'Concluído!'}</div></div>
                        </div>
                        <div className="bg-white dark:bg-dark-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-4">
                            <div className="p-3 bg-indigo-50 text-indigo-500 dark:bg-indigo-900/20 rounded-lg"><TrendingUpIcon className="h-6 w-6" /></div>
                            <div><span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold">Sugestão Mensal</span><div className="text-lg font-bold text-gray-800 dark:text-white">{monthlySuggestion > 0 ? formatValue(monthlySuggestion) : '-'}</div></div>
                        </div>
                        <div className="bg-white dark:bg-dark-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-4">
                            <div className="p-3 bg-purple-50 text-purple-500 dark:bg-purple-900/20 rounded-lg"><ClockIcon className="h-6 w-6" /></div>
                            <div><span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold">Estimativa de Fim</span><div className="text-lg font-bold text-gray-800 dark:text-white">{forecast || '-'}</div></div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 min-h-0">
                    <div className="lg:col-span-2 flex flex-col min-h-0">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg text-gray-800 dark:text-white flex items-center gap-2"><HistoryIcon className="h-5 w-5 text-gray-400" /> Histórico da Meta</h3>
                            <div className="flex gap-2">
                                <button onClick={() => onLink(goal)} className="text-xs bg-gray-100 hover:bg-gray-200 dark:bg-dark-200 dark:hover:bg-dark-300 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-lg transition-colors">Vincular Existente</button>
                                <button onClick={() => onAddInvestment(goal.id)} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"><PlusIcon className="h-3 w-3" /> Novo Aporte</button>
                            </div>
                        </div>
                        <div className="bg-white dark:bg-dark-100 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex-1 overflow-hidden flex flex-col">
                            <div className="overflow-y-auto custom-scrollbar flex-1">
                                {goalTransactions.length > 0 ? (
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-gray-50 dark:bg-dark-200 text-gray-500 dark:text-gray-400 font-medium sticky top-0"><tr><th className="px-5 py-3">Descrição</th><th className="px-5 py-3">Categoria</th><th className="px-5 py-3">Data</th><th className="px-5 py-3 text-right">Valor</th></tr></thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                            {goalTransactions.map(t => {
                                                const impact = goalInvestmentImpact(t);
                                                const operation = t.investmentMetadata?.investmentOperation;
                                                const operationLabel = operation === 'redemption'
                                                    ? 'Resgate'
                                                    : operation === 'redemption_reversal'
                                                        ? 'Estorno de resgate'
                                                        : 'Aporte';
                                                return (
                                                    <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-dark-200 transition-colors">
                                                        <td className="px-5 py-3 text-gray-800 dark:text-gray-200 font-medium">
                                                            {t.description}
                                                            <span className="block text-xs font-normal text-gray-500 dark:text-gray-400">{operationLabel}</span>
                                                        </td>
                                                        <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{t.category}</td>
                                                        <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{new Date(t.date).toLocaleDateString('pt-BR')}</td>
                                                        <td className="px-5 py-3 text-right font-bold text-gray-800 dark:text-white">
                                                            {impact > 0 ? '+' : impact < 0 ? '-' : '•'} {formatValue(Math.abs(impact))}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-48 text-gray-400"><PiggyBankIcon className="h-10 w-10 mb-2 opacity-50" /><p>Nenhum investimento vinculado ainda.</p></div>
                                )}
                            </div>
                            {goalTransactions.length > 0 && (<div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-dark-200/50 flex justify-between items-center"><span className="text-sm font-medium text-gray-600 dark:text-gray-300">Progresso Atual</span><span className="text-lg font-bold text-gray-800 dark:text-white">{formatValue(goal.currentAmount)}</span></div>)}
                        </div>
                    </div>
                    <div className="flex flex-col min-h-0">
                        <h3 className="font-bold text-lg text-gray-800 dark:text-white mb-4">Linha do Tempo</h3>
                        <div className="bg-white dark:bg-dark-100 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 flex-1 overflow-y-auto custom-scrollbar">
                            <div className="relative border-l-2 border-gray-200 dark:border-gray-700 ml-3 space-y-8">
                                {timelineEvents.map((event, idx) => (
                                    <div key={idx} className="relative pl-8">
                                        <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white dark:border-dark-100 shadow-sm ${event.type === 'start' ? 'bg-gray-400' : event.type === 'milestone' ? 'bg-indigo-500' : event.type === 'completion' ? 'bg-green-500' : 'bg-blue-400'}`}></div>
                                        <div>
                                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{new Date(event.date).toLocaleDateString('pt-BR')}</span>
                                            <h4 className="font-bold text-gray-800 dark:text-white mt-0.5">{event.title}</h4>
                                            {event.value > 0 && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{event.type === 'deposit' ? `+ ${formatValue(event.value)}` : `Saldo: ${formatValue(event.value)}`}</p>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // --- PJ MODE RENDER (EXISTENTE) ---
    return (
        <div className="h-full flex flex-col animate-fade-in pb-10">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 transition-colors">
                    <BackIcon className="h-5 w-5" /> Voltar para Metas
                </button>
                <div className="flex items-center gap-3">
                    <button onClick={() => onEdit(goal)} className="p-2 bg-gray-100 text-gray-700 dark:bg-dark-200 rounded-lg hover:bg-gray-200 transition-colors" title="Editar">
                        <EditIcon className="h-4 w-4" />
                    </button>
                    <button onClick={() => onDelete(goal.id)} className="p-2 bg-red-50 text-red-600 dark:bg-red-900/20 rounded-lg hover:bg-red-100 transition-colors" title="Arquivar" aria-label="Arquivar meta">
                        <DeleteIcon className="h-4 w-4" />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                <div className="lg:col-span-2 bg-white dark:bg-dark-100 rounded-2xl p-8 shadow-md border border-gray-100 dark:border-gray-700 relative overflow-hidden">
                    <div className="flex items-start gap-6 relative z-10">
                        <div className="w-24 h-24 rounded-3xl flex items-center justify-center shadow-lg border-4 border-white dark:border-dark-100" style={{ background: gradientStyle, color: '#fff' }}>
                            <DynamicIcon name={goal.visual.icon} size={48} />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <span className="px-2.5 py-1 rounded text-[10px] uppercase font-bold tracking-widest bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                                    {isPJ && goal.businessType ? `Empresa • ${goal.businessType.replace('_', ' ')}` : goal.category.replace('_', ' ')}
                                </span>
                                {goal.period && <span className="px-2.5 py-1 rounded text-[10px] uppercase font-bold bg-gray-100 text-gray-600">{goal.period}</span>}
                            </div>
                            <h1 className="text-4xl font-black text-gray-800 dark:text-white mb-2">{goal.name}</h1>
                            {goal.costCenter && (
                                <p className="text-sm font-bold text-primary flex items-center gap-2 mb-3">
                                    <BuildingIcon className="w-4 h-4" /> {goal.costCenter}
                                </p>
                            )}
                            <p className="text-gray-500 dark:text-gray-400 text-sm">{goal.description}</p>
                        </div>
                    </div>

                    <div className="mt-10">
                        <div className="flex justify-between items-end mb-3">
                            <div>
                                <span className="text-sm font-bold text-gray-400 uppercase tracking-widest">Atual</span>
                                <div className="text-4xl font-black text-gray-800 dark:text-white">{formatValue(currentVal)}</div>
                            </div>
                            <div className="text-right">
                                <span className="text-sm font-bold text-gray-400 uppercase tracking-widest">Objetivo</span>
                                <div className="text-2xl font-bold text-gray-400">{formatValue(goal.targetAmount)}</div>
                            </div>
                        </div>
                        <div className="h-5 bg-gray-100 dark:bg-dark-200 rounded-full overflow-hidden relative">
                            <MotionDiv className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${Math.min(100, percentage)}%` }} transition={{ duration: 1 }} style={{ backgroundColor: goal.visual.color }} />
                        </div>
                        <div className="flex justify-between mt-3 text-xs font-bold text-gray-400 uppercase">
                            <span>Início: {new Date(goal.startDate).toLocaleDateString('pt-BR')}</span>
                            <span>Prazo: {new Date(goal.deadline).toLocaleDateString('pt-BR')}</span>
                        </div>
                    </div>
                </div>

                <div className="grid grid-rows-3 gap-4">
                    <div className="bg-white dark:bg-dark-100 rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-4">
                        <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl"><TargetIcon className="h-6 w-6" /></div>
                        <div>
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Status do Ritmo</span>
                            <p className={`text-lg font-black uppercase ${paceStatus === 'on_track' ? 'text-green-600' : 'text-red-500'}`}>
                                {paceStatus === 'on_track' ? 'No Ritmo' : paceStatus === 'warning' ? 'Atenção' : 'Fora do Ritmo'}
                            </p>
                        </div>
                    </div>
                    {isPJ && goal.period && (
                         <div className="bg-white dark:bg-dark-100 rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-4">
                            <div className="p-3 bg-purple-50 text-purple-600 rounded-xl"><ClockIcon className="h-6 w-6" /></div>
                            <div>
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Período Vigente</span>
                                <p className="text-sm font-bold text-gray-800 dark:text-white">
                                    {periodInfo?.start.toLocaleDateString('pt-BR')} até {periodInfo?.end.toLocaleDateString('pt-BR')}
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default GoalDetailsView;
