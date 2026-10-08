import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { RecurringExpense } from '../modules/recurring/types.ts';
import { civilDaysBetween } from '../modules/recurring/schedule.ts';
import { FREQUENCY_SUFFIX, RECURRING_STATUS_BADGE, RECURRING_STATUS_LABELS, RECURRING_TYPE_LABELS, formatDayShort } from '../modules/recurring/presentation.ts';
import { formatCents, saoPauloToday } from '../modules/loans/money.ts';
import { DynamicIcon, CalendarIcon, CreditCardIcon, WarningIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';

interface RecurringExpenseCardProps {
    expense: RecurringExpense;
    onClick: () => void;
}

const RecurringExpenseCard: React.FC<RecurringExpenseCardProps> = ({ expense, onClick }) => {
    const { playSound } = useTheme();
    const MotionDiv = motion.div as any;

    // Próximo vencimento: o do backend (o agendador avança o contrato).
    const formattedNextDate = expense.status === 'active' ? formatDayShort(expense.nextDueDate) : '-';

    // Check if expiring soon (within 30 days)
    const isExpiringSoon = useMemo(() => {
        if (!expense.endDate) return false;
        const diffDays = civilDaysBetween(saoPauloToday(), expense.endDate);
        return diffDays > 0 && diffDays <= 30;
    }, [expense.endDate]);

    return (
        <MotionDiv
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ scale: 1.02, y: -4, boxShadow: "0 10px 20px -5px rgba(0, 0, 0, 0.1)" }}
            transition={{ duration: 0.2 }}
            onClick={() => {
                playSound('click');
                onClick();
            }}
            onKeyDown={(e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    playSound('click');
                    onClick();
                }
            }}
            role="button"
            tabIndex={0}
            className={`bg-surface rounded-card shadow-sm border border-border cursor-pointer group flex flex-col relative overflow-hidden h-full ${expense.status !== 'active' ? 'opacity-75 grayscale-[0.3]' : ''}`}
            aria-label={`Detalhes da assinatura ${expense.name}`}
        >
            {/* Top Color Bar */}
            <div className="h-1.5 w-full" style={{ backgroundColor: expense.visual.color }}></div>

            <div className="p-5 flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                    <div 
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-sm flex-shrink-0 transition-transform group-hover:scale-110"
                        style={{ backgroundColor: expense.visual.color }}
                    >
                        {expense.visual.emoji ? <span className="text-xl" aria-hidden="true">{expense.visual.emoji}</span> : <DynamicIcon name={expense.visual.icon} size={24} />}
                    </div>
                    
                    <div className="flex flex-col items-end gap-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${RECURRING_STATUS_BADGE[expense.status]}`}>
                            {RECURRING_STATUS_LABELS[expense.status]}
                        </span>
                        {isExpiringSoon && (
                            <span className="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider bg-red-100 text-red-600 animate-pulse flex items-center gap-1">
                                <WarningIcon className="w-3 h-3" /> Expira
                            </span>
                        )}
                    </div>
                </div>

                <div className="mb-4">
                    <h3 className="font-bold text-on-surface text-lg leading-tight mb-1 group-hover:text-primary transition-colors">
                        {expense.name || 'Sem Nome'}
                    </h3>
                    <p className="text-xs text-muted capitalize bg-background inline-block px-2 py-0.5 rounded">
                        {RECURRING_TYPE_LABELS[expense.type]}
                    </p>
                </div>

                {/* Integrations Badges */}
                <div className="flex gap-2 mb-4 mt-auto" role="list" aria-label="Integrações ativas">
                    {expense.paymentMethod === 'credit_card' && (
                        <div className="flex items-center justify-center w-6 h-6 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-300" title="Vinculado a Cartão" role="listitem">
                            <CreditCardIcon className="w-3 h-3" />
                        </div>
                    )}
                    {expense.openOccurrenceCount > 0 && (
                        <div className="flex items-center justify-center w-6 h-6 rounded bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300" title="Ocorrência aguardando ação" aria-label="Ocorrência aguardando ação" role="listitem">
                            <WarningIcon className="w-3 h-3" />
                        </div>
                    )}
                    {expense.executionMode === 'automatic' && (
                        <div className="flex items-center justify-center w-6 h-6 rounded bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-300" title="Geração Automática" role="listitem">
                            <DynamicIcon name="Bolt" className="w-3 h-3" />
                        </div>
                    )}
                </div>

                <div className="border-t border-border pt-3 flex justify-between items-end">
                    <div>
                        <span className="text-[10px] text-muted uppercase font-bold block mb-0.5">Próxima</span>
                        <div className="flex items-center text-text-secondary text-xs font-medium">
                            <CalendarIcon className="w-3 h-3 mr-1 text-muted" />
                            {formattedNextDate}
                        </div>
                    </div>
                    <div className="text-right">
                        <span className="block text-xl font-bold text-on-surface">
                            {formatCents(expense.amountCents)}
                        </span>
                        <span className="text-xs text-muted">
                            {FREQUENCY_SUFFIX[expense.frequency]}
                        </span>
                    </div>
                </div>
            </div>
        </MotionDiv>
    );
};

export default RecurringExpenseCard;
