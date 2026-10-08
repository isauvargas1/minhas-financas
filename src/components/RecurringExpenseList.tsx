import React from 'react';
import { motion } from 'framer-motion';
import type { RecurringExpense } from '../modules/recurring/types.ts';
import { FREQUENCY_LABELS, RECURRING_STATUS_BADGE, RECURRING_STATUS_LABELS, RECURRING_TYPE_LABELS, formatDayShort } from '../modules/recurring/presentation.ts';
import { formatCents } from '../modules/loans/money.ts';
import { DynamicIcon, CreditCardIcon, WarningIcon } from './Icons.tsx';

interface RecurringExpenseListProps {
    expenses: RecurringExpense[];
    onSelect: (id: string) => void;
}

const rowVariants = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0 }
};

const RecurringExpenseList: React.FC<RecurringExpenseListProps> = ({ expenses, onSelect }) => {
    const MotionTr = motion.tr as any;

    // Próximo vencimento: o do backend; pausada, encerrada ou cancelada não tem.
    const getNextDate = (expense: RecurringExpense) =>
        expense.status === 'active' ? formatDayShort(expense.nextDueDate) : '-';

    return (
        <div className="bg-surface rounded-card shadow-sm border border-border overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-background text-muted uppercase font-bold text-xs border-b border-border">
                        <tr>
                            <th className="px-4 py-3">Nome</th>
                            <th className="px-4 py-3">Tipo</th>
                            <th className="px-4 py-3 text-right">Valor</th>
                            <th className="px-4 py-3 text-center">Pagamento</th>
                            <th className="px-4 py-3">Próxima</th>
                            <th className="px-4 py-3 text-center">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                        {expenses.map((expense, index) => (
                            <MotionTr 
                                key={expense.id}
                                variants={rowVariants}
                                initial="hidden"
                                animate="show"
                                transition={{ delay: index * 0.05 }}
                                onClick={() => onSelect(expense.id)}
                                className={`hover:bg-background transition-colors cursor-pointer group ${expense.status !== 'active' ? 'opacity-60' : ''}`}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e: any) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        onSelect(expense.id);
                                    }
                                }}
                            >
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <div 
                                            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm shadow-sm"
                                            style={{ backgroundColor: expense.visual.color }}
                                        >
                                            {expense.visual.emoji || <DynamicIcon name={expense.visual.icon} size={16} />}
                                        </div>
                                        <span className="font-medium text-on-surface group-hover:text-primary transition-colors">
                                            {expense.name}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-muted capitalize">
                                    {RECURRING_TYPE_LABELS[expense.type].toLowerCase()}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <div className="font-bold text-on-surface">
                                        {formatCents(expense.amountCents)}
                                    </div>
                                    <div className="text-xs text-muted capitalize">
                                        {FREQUENCY_LABELS[expense.frequency].toLowerCase()}
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <div className="flex justify-center gap-2 text-muted">
                                        {expense.paymentMethod === 'credit_card' ? (
                                            <CreditCardIcon className="w-4 h-4 text-purple-500" title="Cartão de Crédito" />
                                        ) : expense.paymentMethod === 'pix' ? (
                                            <DynamicIcon name="BrandPix" className="w-4 h-4 text-teal-500" title="Pix" />
                                        ) : (
                                            <DynamicIcon name="Barcode" className="w-4 h-4" title="Outro" />
                                        )}
                                        {expense.openOccurrenceCount > 0 && <WarningIcon className="w-4 h-4 text-amber-500" title="Ocorrência aguardando ação" />}
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-muted whitespace-nowrap">
                                    {getNextDate(expense)}
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${RECURRING_STATUS_BADGE[expense.status]}`}>
                                        {RECURRING_STATUS_LABELS[expense.status]}
                                    </span>
                                </td>
                            </MotionTr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default RecurringExpenseList;
