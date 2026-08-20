
import React, { useMemo, useEffect, useRef } from 'react';
import { Goal, Transaction } from '../types.ts';
import { 
    CheckIcon, WarningIcon, DynamicIcon, TrendingUpIcon, ClockIcon, WifiIcon
} from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { motion } from 'framer-motion';
// @ts-ignore
import confetti from 'canvas-confetti';
import { calculateBusinessGoalProgress, getGoalPaceStatus } from '../modules/goals/logic.ts';
import { transactionCashImpact } from '../modules/investments/semantics.ts';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface GoalCardProps {
    goal: Goal;
    onClick: () => void;
    mode: 'card' | 'list';
    transactions: Transaction[]; 
}

const adjustBrightness = (color: string, amount: number) => {
    return '#' + color.replace(/^#/, '').replace(/../g, color => ('0'+Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
}

const GoalCard: React.FC<GoalCardProps> = ({ goal, onClick, mode, transactions }) => {
    const { theme } = useTheme();
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';
    const cardRef = useRef<HTMLDivElement>(null);
    const MotionDiv = motion.div as any;

    // --- BUSINESS LOGIC ---
    const currentVal = useMemo(() => {
        if (isPJ && goal.isAutomatic) {
            const balance = transactions.reduce((acc, transaction) => acc + transactionCashImpact(transaction), 0);
            return calculateBusinessGoalProgress(goal, transactions, balance);
        }
        return goal.currentAmount;
    }, [isPJ, goal, transactions]);

    const percentage = useMemo(() => {
        if (goal.targetAmount <= 0) return 0;
        const pct = (currentVal / goal.targetAmount) * 100;
        return goal.businessType === 'reducao_custos' ? Math.min(100, pct) : pct;
    }, [currentVal, goal.targetAmount, goal.businessType]);

    const paceStatus = useMemo(() => getGoalPaceStatus(goal, currentVal), [goal, currentVal]);
    
    const isCompleted = percentage >= 100 || goal.status === 'alcancada';
    const isInvalid = goal.targetAmount <= 0;
    const isOverLimit = goal.businessType === 'reducao_custos' && percentage > 100;

    useEffect(() => {
        if (isCompleted && theme.effects.enableAnimations && !isOverLimit) {
            if(cardRef.current) {
                const rect = cardRef.current.getBoundingClientRect();
                const x = (rect.left + rect.width / 2) / window.innerWidth;
                const y = (rect.top + rect.height / 2) / window.innerHeight;
                confetti({
                    particleCount: 50,
                    spread: 40,
                    origin: { x, y },
                    disableForReducedMotion: true,
                    colors: [goal.visual.color, '#ffffff']
                });
            }
        }
    }, [isCompleted, goal.visual.color, theme.effects.enableAnimations, isOverLimit]);

    const formatValue = (val: number) => {
        if (goal.businessType === 'margem') return `${val.toFixed(1)}%`;
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
            maximumFractionDigits: 0 
        }).format(val);
    };

    const getHealthBadge = () => {
        if (!theme.goals?.showBadges) return null;
        if (goal.status === 'pausada') return <span className="text-[10px] px-2 py-0.5 rounded bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300 font-bold">PAUSADA</span>;
        if (goal.status === 'cancelada') return <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 font-bold">CANCELADA</span>;
        if (isCompleted) return <span className="text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-bold">CONCLUÍDA</span>;
        
        // Logic for PF Pace
        const start = new Date(goal.startDate).getTime();
        const end = new Date(goal.deadline).getTime();
        const now = new Date().getTime();
        const totalDuration = end - start;
        const elapsed = now - start;
        if (elapsed < 0) return null; 
        const timeProgress = elapsed / totalDuration;
        const valueProgress = currentVal / goal.targetAmount;
        
        if (valueProgress >= timeProgress * 0.9) return <span className="text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 font-bold">NO TRILHO</span>;
        if (valueProgress >= timeProgress * 0.7) return <span className="text-[10px] px-2 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 font-bold">ATENÇÃO</span>;
        return <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 font-bold">ATRASADA</span>;
    };

    const getPaceBadgePJ = () => {
        if (!theme.goals?.showBadges || goal.status !== 'em_andamento') return null;
        if (goal.businessType === 'reducao_custos') {
            if (percentage > 90) return <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700 font-bold">LIMITE PRÓXIMO</span>;
            return <span className="text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700 font-bold">SAUDÁVEL</span>;
        }
        switch(paceStatus) {
            case 'on_track': return <span className="text-[10px] px-2 py-0.5 rounded bg-green-100 text-green-700 font-bold">NO RITMO</span>;
            case 'warning': return <span className="text-[10px] px-2 py-0.5 rounded bg-yellow-100 text-yellow-700 font-bold">LENTO</span>;
            case 'off_track': return <span className="text-[10px] px-2 py-0.5 rounded bg-red-100 text-red-700 font-bold">FORA DO RITMO</span>;
            default: return null;
        }
    };

    const darkerColor = adjustBrightness(goal.visual.color, -50);
    const gradientStyle = `radial-gradient(circle at top left, rgba(255,255,255,0.2) 0%, transparent 40%), linear-gradient(135deg, ${goal.visual.color} 0%, ${darkerColor} 100%)`;
    
    // Config
    const density = theme.goals?.density || 'comfortable';
    const showCover = theme.goals?.showCover && goal.visual.coverImage && !isPJ; 
    const showEmoji = theme.goals?.showEmoji && goal.visual.emoji;
    const opacityClass = (goal.status === 'pausada' || goal.status === 'cancelada') ? 'opacity-70 grayscale-[0.5]' : '';

    // --- PF MODE ---
    if (!isPJ) {
        if (mode === 'list') {
            return (
                <MotionDiv 
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={onClick}
                    className={`group flex items-center p-4 bg-surface rounded-card border border-border hover:border-primary/30 hover:shadow-md transition-all cursor-pointer ${opacityClass}`}
                >
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center mr-4 shadow-sm relative overflow-hidden">
                        <div className="absolute inset-0" style={{ background: gradientStyle }}></div>
                        <div className="w-5 h-5 relative z-10 text-white flex items-center justify-center">
                            <DynamicIcon name={goal.visual.icon} size={20} />
                        </div>
                        {showEmoji && <span className="absolute -top-1 -right-1 text-xs z-10">{goal.visual.emoji}</span>}
                    </div>
                    <div className="flex-1 min-w-0 mr-4">
                        <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-on-surface truncate">{goal.name}</h3>
                            {getHealthBadge()}
                        </div>
                        <div className="text-xs text-muted flex items-center gap-2 mt-0.5">
                            <span>Até {new Date(goal.deadline).toLocaleDateString('pt-BR')}</span>
                        </div>
                    </div>
                    <div className="w-32 mr-6 hidden sm:block">
                        <div className="flex justify-between text-xs mb-1">
                            <span className="font-medium text-on-surface">{percentage > 100 ? '100%+' : `${percentage.toFixed(0)}%`}</span>
                        </div>
                        <div className="h-2 w-full bg-background rounded-full overflow-hidden relative">
                            <MotionDiv 
                                className="h-full rounded-full absolute top-0 left-0" 
                                initial={{ width: 0 }} 
                                animate={{ width: `${Math.min(100, percentage)}%` }} 
                                transition={{ duration: 1, ease: "easeOut" }} 
                                style={{ backgroundColor: goal.visual.color }} 
                            />
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="font-bold text-on-surface">{formatValue(currentVal)}</div>
                        <div className="text-xs text-muted">de {formatValue(goal.targetAmount)}</div>
                    </div>
                </MotionDiv>
            );
        }

        return (
            <MotionDiv 
                ref={cardRef}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                whileHover={{ y: -5, boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)" }}
                onClick={onClick}
                className={`relative group bg-surface rounded-card border transition-all duration-300 cursor-pointer overflow-hidden flex flex-col ${opacityClass} ${isCompleted ? 'border-green-500/50 shadow-[0_0_15px_rgba(34,197,94,0.1)]' : 'border-border hover:border-primary/30'} ${density === 'compact' ? 'h-auto' : 'h-full'}`}
            >
                <div className={`w-full relative transition-all ${density === 'compact' ? 'h-16' : 'h-32'}`} style={{ background: showCover ? `url(${goal.visual.coverImage}) center/cover` : gradientStyle }}>
                    {showCover && <div className={`absolute inset-0 bg-gradient-to-t from-black/60 to-transparent`} />}
                    <div className="absolute top-3 right-3 z-10">{getHealthBadge()}</div>
                    <div className={`absolute left-5 rounded-2xl shadow-lg flex items-center justify-center border-4 border-surface transition-all overflow-hidden ${density === 'compact' ? '-bottom-4 w-10 h-10' : '-bottom-6 w-14 h-14'}`} style={{ backgroundColor: showCover ? '#fff' : undefined, background: !showCover ? gradientStyle : undefined, color: showCover ? goal.visual.color : '#fff' }}>
                        <div className={density === 'compact' ? 'w-5 h-5' : 'w-7 h-7'}>{isCompleted ? <CheckIcon className="w-full h-full" /> : <DynamicIcon name={goal.visual.icon} className="w-full h-full" />}</div>
                    </div>
                    {showEmoji && <div className="absolute top-3 left-3 text-2xl z-10 drop-shadow-md transform group-hover:scale-125 transition-transform">{goal.visual.emoji}</div>}
                </div>
                <div className={`px-5 pb-5 flex-1 flex flex-col ${density === 'compact' ? 'pt-6' : 'pt-8'}`}>
                    <div className="mb-4">
                        <h3 className="font-bold text-lg text-on-surface leading-tight mb-1 truncate">{goal.name}</h3>
                        <p className="text-xs font-medium text-muted uppercase tracking-wide">{goal.category.replace('_', ' ')}</p>
                    </div>
                    <div className="mt-auto">
                        <div className="flex justify-between items-end mb-2">
                            <div><span className="text-xs text-muted block mb-0.5">Acumulado</span><span className={`font-bold ${percentage > 100 ? 'text-green-600 dark:text-green-400' : 'text-on-surface'} ${density === 'compact' ? 'text-lg' : 'text-xl'}`}>{formatValue(currentVal)}</span></div>
                            <div className="text-right"><span className="text-xs text-muted block mb-0.5">Meta</span><span className="text-sm font-semibold text-muted">{formatValue(goal.targetAmount)}</span></div>
                        </div>
                        <div className="relative h-3 w-full bg-gray-200 dark:bg-dark-200 rounded-full overflow-hidden">
                            <MotionDiv 
                                className="absolute top-0 left-0 h-full rounded-full z-10" 
                                initial={{ width: 0 }} 
                                animate={{ width: `${Math.min(100, percentage)}%` }} 
                                transition={{ duration: 1.5, ease: "circOut" }} 
                                style={{ backgroundColor: goal.visual.color }} 
                            />
                            {!isCompleted && !isInvalid && (
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/50 dark:via-white/30 to-transparent w-full -translate-x-full animate-[shimmer_2s_infinite]"></div>
                            )}
                        </div>
                        <div className="flex justify-between mt-2 items-center">
                            <span className="text-xs font-bold" style={{ color: goal.visual.color }}>{percentage.toFixed(0)}% {percentage > 100 ? '🎉' : ''}</span>
                            <span className="text-xs text-muted">Até {new Date(goal.deadline).toLocaleDateString('pt-BR')}</span>
                        </div>
                    </div>
                </div>
                <style>{`
                    @keyframes shimmer {
                        100% { transform: translateX(100%); }
                    }
                `}</style>
            </MotionDiv>
        );
    }

    // --- PJ MODE (EXISTENTE) ---
    if (mode === 'list') {
        return (
            <MotionDiv layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} onClick={onClick} className="group flex items-center p-4 bg-surface rounded-card border border-border hover:border-primary/30 hover:shadow-md transition-all cursor-pointer">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mr-4 shadow-sm relative overflow-hidden">
                    <div className="absolute inset-0" style={{ background: gradientStyle }}></div>
                    <div className="w-5 h-5 relative z-10 text-white flex items-center justify-center"><DynamicIcon name={goal.visual.icon} size={20} /></div>
                </div>
                <div className="flex-1 min-w-0 mr-4">
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-on-surface truncate">{goal.name}</h3>
                        {getPaceBadgePJ()}
                        {goal.isAutomatic && <span className="text-[9px] bg-indigo-50 text-indigo-600 px-1 rounded border border-indigo-100">AUTO</span>}
                    </div>
                    <div className="text-xs text-muted flex items-center gap-2 mt-0.5">
                        <span>Até {new Date(goal.deadline).toLocaleDateString('pt-BR')}</span>
                        {goal.period && <span className="capitalize">• {goal.period}</span>}
                    </div>
                </div>
                {/* Barra de Progresso (Esquerda) */}
                <div className="w-32 mr-6 hidden sm:block">
                    <div className="h-2 w-full bg-background rounded-full overflow-hidden relative">
                        <MotionDiv 
                            className="h-full rounded-full"
                            initial={{ width: 0 }} 
                            animate={{ width: `${Math.min(100, percentage)}%` }} 
                            style={{ backgroundColor: isOverLimit ? '#ef4444' : goal.visual.color }} 
                        />
                    </div>
                </div>

                {/* Valores (Direita) */}
                <div className="text-right">
                    <div className="font-bold text-on-surface">{formatValue(currentVal)}</div>
                    <div className="text-xs text-muted">alvo {formatValue(goal.targetAmount)}</div>
                </div>
            </MotionDiv>
        );
    }

    return (
        <MotionDiv ref={cardRef} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} whileHover={{ y: -5 }} onClick={onClick} className={`relative bg-surface rounded-card border transition-all duration-300 cursor-pointer overflow-hidden flex flex-col h-full ${isCompleted && !isOverLimit ? 'border-green-500/50 shadow-sm' : 'border-border hover:border-primary/30'} ${isOverLimit ? 'border-red-500/50' : ''}`}>
            <div className="w-full h-24 relative" style={{ background: gradientStyle }}>
                <div className="absolute top-3 right-3 z-10">{getPaceBadgePJ()}</div>
                <div className="absolute left-5 -bottom-5 rounded-2xl shadow-lg flex items-center justify-center border-4 border-surface w-14 h-14" style={{ background: gradientStyle, color: '#fff' }}><DynamicIcon name={goal.visual.icon} size={28} /></div>
                {goal.isAutomatic && <div className="absolute top-3 left-3 bg-white/20 backdrop-blur-sm text-white text-[9px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1"><ClockIcon className="w-3 h-3" /> AUTOMÁTICA</div>}
            </div>
            <div className="px-5 pb-5 pt-8 flex-1 flex flex-col">
                <div className="mb-4">
                    <h3 className="font-bold text-lg text-on-surface leading-tight mb-1 truncate">{goal.name}</h3>
                    <div className="flex items-center gap-2"><p className="text-xs font-medium text-muted uppercase tracking-wide">{isPJ && goal.businessType ? goal.businessType.replace('_', ' ') : goal.category.replace('_', ' ')}</p>{goal.period && <span className="text-[10px] text-muted font-bold px-1.5 py-0.5 bg-gray-100 dark:bg-dark-200 rounded uppercase">{goal.period}</span>}</div>
                </div>
                <div className="mt-auto">
                    <div className="flex justify-between items-end mb-2">
                        <div><span className="text-[10px] text-muted uppercase font-bold block mb-0.5">{goal.businessType === 'reducao_custos' ? 'Consumido' : 'Progresso'}</span><span className={`font-bold text-xl ${percentage > 100 && goal.businessType !== 'reducao_custos' ? 'text-green-600' : 'text-on-surface'}`}>{formatValue(currentVal)}</span></div>
                        <div className="text-right"><span className="text-[10px] text-muted uppercase font-bold block mb-0.5">Objetivo</span><span className="text-sm font-semibold text-muted">{formatValue(goal.targetAmount)}</span></div>
                    </div>
                    <div className="relative h-2.5 w-full bg-gray-200 dark:bg-dark-200 rounded-full overflow-hidden">
                        <MotionDiv className="absolute top-0 left-0 h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${Math.min(100, percentage)}%` }} style={{ backgroundColor: isOverLimit ? '#ef4444' : goal.visual.color }} />
                    </div>
                    <div className="flex justify-between mt-2 items-center">
                        <span className="text-xs font-bold" style={{ color: isOverLimit ? '#ef4444' : goal.visual.color }}>{percentage.toFixed(0)}% {isOverLimit ? '⚠️' : (isCompleted ? '🎉' : '')}</span>
                        <span className="text-[10px] text-muted font-medium">Até {new Date(goal.deadline).toLocaleDateString('pt-BR')}</span>
                    </div>
                </div>
            </div>
            <style>{`
                @keyframes shimmer {
                    100% { transform: translateX(100%); }
                }
            `}</style>
        </MotionDiv>
    );
};

export default GoalCard;
