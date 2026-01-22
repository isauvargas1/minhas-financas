
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { RecurringExpense } from '../modules/recurring-expenses/types.ts';
import { DynamicIcon, CalendarIcon, CreditCardIcon, UsersIcon, BoltIcon, WarningIcon } from './Icons.tsx';
import { useTheme } from '../ThemeContext.tsx';
import { projectOccurrences } from '../modules/recurring-expenses/logic.ts';

interface RecurringExpenseCardProps {
    expense: RecurringExpense;
    onClick: () => void;
}

const RecurringExpenseCard: React.FC<RecurringExpenseCardProps> = ({ expense, onClick }) => {
    const { playSound } = useTheme();
    const MotionDiv = motion.div as any;

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    // Calculate next due date dynamically
    const nextDate = useMemo(() => {
        if (expense.status !== 'ativo') return null;
        const today = new Date();
        const nextYear = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
        const occurrences = projectOccurrences(expense, today, nextYear);
        return occurrences.length > 0 ? new Date(occurrences[0].dataPrevista) : null;
    }, [expense]);

    const formattedNextDate = nextDate 
        ? nextDate.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }) 
        : '-';

    // Check if expiring soon (within 30 days)
    const isExpiringSoon = useMemo(() => {
        if (!expense.dataFim) return false;
        const today = new Date();
        const endDate = new Date(expense.dataFim);
        const diffTime = endDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 0 && diffDays <= 30;
    }, [expense.dataFim]);

    const statusColors = {
        ativo: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
        pausado: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
        cancelado: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    };

    const periodLabels: Record<string, string> = {
        semanal: '/semana',
        quinzenal: '/15 dias',
        mensal: '/mês',
        bimestral: '/2 meses',
        trimestral: '/3 meses',
        semestral: '/6 meses',
        anual: '/ano'
    };

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
            className={`bg-surface rounded-card shadow-sm border border-border cursor-pointer group flex flex-col relative overflow-hidden h-full ${expense.status !== 'ativo' ? 'opacity-75 grayscale-[0.3]' : ''}`}
            aria-label={`Detalhes da assinatura ${expense.nome}`}
        >
            {/* Top Color Bar */}
            <div className="h-1.5 w-full" style={{ backgroundColor: expense.corPrincipal }}></div>

            <div className="p-5 flex-1 flex flex-col">
                <div className="flex justify-between items-start mb-4">
                    <div 
                        className="w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-sm flex-shrink-0 transition-transform group-hover:scale-110"
                        style={{ backgroundColor: expense.corPrincipal }}
                    >
                        {expense.emojiOpcional ? <span className="text-xl" aria-hidden="true">{expense.emojiOpcional}</span> : <DynamicIcon name={expense.icone} size={24} />}
                    </div>
                    
                    <div className="flex flex-col items-end gap-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${statusColors[expense.status]}`}>
                            {expense.status}
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
                        {expense.nome || 'Sem Nome'}
                    </h3>
                    <p className="text-xs text-muted capitalize bg-background inline-block px-2 py-0.5 rounded">
                        {(expense.tipo || '').replace(/([A-Z])/g, ' $1').trim()}
                    </p>
                </div>

                {/* Integrations Badges */}
                <div className="flex gap-2 mb-4 mt-auto" role="list" aria-label="Integrações ativas">
                    {expense.cartaoIdOpcional && (
                        <div className="flex items-center justify-center w-6 h-6 rounded bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-300" title="Vinculado a Cartão" role="listitem">
                            <CreditCardIcon className="w-3 h-3" />
                        </div>
                    )}
                    {expense.splitGroupIdOpcional && (
                        <div className="flex items-center justify-center w-6 h-6 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300" title="Grupo Dividido" role="listitem">
                            <UsersIcon className="w-3 h-3" />
                        </div>
                    )}
                    {expense.gerarDespesaAutomaticamente && (
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
                            {formatCurrency(expense.valorPadrao || 0)}
                        </span>
                        <span className="text-xs text-muted">
                            {periodLabels[expense.periodo] || expense.periodo}
                        </span>
                    </div>
                </div>
            </div>
        </MotionDiv>
    );
};

export default RecurringExpenseCard;
