
import React from 'react';
import { motion } from 'framer-motion';
import { RecurringExpense } from '../modules/recurring-expenses/types.ts';
import { DynamicIcon, CreditCardIcon, UsersIcon, CalendarIcon } from './Icons.tsx';
import { projectOccurrences } from '../modules/recurring-expenses/logic.ts';

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
    
    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    const getNextDate = (expense: RecurringExpense) => {
        const today = new Date();
        const nextYear = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
        const occurrences = projectOccurrences(expense, today, nextYear);
        return occurrences.length > 0 
            ? new Date(occurrences[0].dataPrevista).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }) 
            : '-';
    };

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
                                className={`hover:bg-background transition-colors cursor-pointer group ${expense.status !== 'ativo' ? 'opacity-60' : ''}`}
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
                                            style={{ backgroundColor: expense.corPrincipal }}
                                        >
                                            {expense.emojiOpcional || <DynamicIcon name={expense.icone} size={16} />}
                                        </div>
                                        <span className="font-medium text-on-surface group-hover:text-primary transition-colors">
                                            {expense.nome}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-muted capitalize">
                                    {expense.tipo.replace(/([A-Z])/g, ' $1').toLowerCase()}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <div className="font-bold text-on-surface">
                                        {formatCurrency(expense.valorPadrao)}
                                    </div>
                                    <div className="text-xs text-muted capitalize">
                                        {expense.periodo}
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <div className="flex justify-center gap-2 text-muted">
                                        {expense.metodoPagamento === 'cartaoCredito' ? (
                                            <CreditCardIcon className="w-4 h-4 text-purple-500" title="Cartão de Crédito" />
                                        ) : expense.metodoPagamento === 'pix' ? (
                                            <DynamicIcon name="BrandPix" className="w-4 h-4 text-teal-500" title="Pix" />
                                        ) : (
                                            <DynamicIcon name="Barcode" className="w-4 h-4" title="Outro" />
                                        )}
                                        {expense.splitGroupIdOpcional && <UsersIcon className="w-4 h-4 text-blue-500" title="Grupo Compartilhado" />}
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-muted whitespace-nowrap">
                                    {getNextDate(expense)}
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${
                                        expense.status === 'ativo' ? 'bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-300' :
                                        expense.status === 'pausado' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300' :
                                        'bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300'
                                    }`}>
                                        {expense.status}
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
