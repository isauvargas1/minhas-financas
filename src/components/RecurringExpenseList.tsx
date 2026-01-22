
import React from 'react';
import { RecurringExpense } from '../modules/recurring-expenses/types.ts';
import { DynamicIcon, CreditCardIcon, UsersIcon, BoltIcon, CalendarIcon } from './Icons.tsx';
import { projectOccurrences } from '../modules/recurring-expenses/logic.ts';

interface RecurringExpenseListProps {
    expenses: RecurringExpense[];
    onSelect: (id: string) => void;
}

const RecurringExpenseList: React.FC<RecurringExpenseListProps> = ({ expenses, onSelect }) => {
    
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
        <div className="bg-white dark:bg-dark-100 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-gray-50 dark:bg-dark-200 text-gray-500 dark:text-gray-400 uppercase font-bold text-xs border-b border-gray-200 dark:border-gray-700">
                        <tr>
                            <th className="px-4 py-3">Nome</th>
                            <th className="px-4 py-3">Tipo</th>
                            <th className="px-4 py-3 text-right">Valor</th>
                            <th className="px-4 py-3 text-center">Pagamento</th>
                            <th className="px-4 py-3">Próxima</th>
                            <th className="px-4 py-3 text-center">Status</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {expenses.map(expense => (
                            <tr 
                                key={expense.id} 
                                onClick={() => onSelect(expense.id)}
                                className={`hover:bg-gray-50 dark:hover:bg-dark-200 transition-colors cursor-pointer group ${expense.status !== 'ativo' ? 'opacity-60' : ''}`}
                            >
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-3">
                                        <div 
                                            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm shadow-sm"
                                            style={{ backgroundColor: expense.corPrincipal }}
                                        >
                                            {expense.emojiOpcional || <DynamicIcon name={expense.icone} size={16} />}
                                        </div>
                                        <span className="font-medium text-gray-800 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                            {expense.nome}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-gray-600 dark:text-gray-300 capitalize">
                                    {expense.tipo.replace(/([A-Z])/g, ' $1').toLowerCase()}
                                </td>
                                <td className="px-4 py-3 text-right">
                                    <div className="font-bold text-gray-800 dark:text-white">
                                        {formatCurrency(expense.valorPadrao)}
                                    </div>
                                    <div className="text-xs text-gray-400 capitalize">
                                        {expense.periodo}
                                    </div>
                                </td>
                                <td className="px-4 py-3 text-center">
                                    <div className="flex justify-center gap-2 text-gray-400">
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
                                <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
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
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default RecurringExpenseList;
