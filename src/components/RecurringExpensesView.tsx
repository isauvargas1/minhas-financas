
import React from 'react';
import { useRecurringExpenses } from '../modules/recurring-expenses/hooks.ts';
import { RepeatIcon } from './Icons.tsx';

const RecurringExpensesView: React.FC = () => {
    const { data: expenses, isLoading } = useRecurringExpenses();

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col animate-fade-in">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-white flex items-center gap-2">
                        <RepeatIcon className="h-6 w-6 text-indigo-600" />
                        Assinaturas e Recorrentes
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Gerencie seus gastos fixos mensais</p>
                </div>
            </div>

            <div className="bg-white dark:bg-dark-100 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 flex-1">
                <div className="text-center py-10">
                    <p className="text-gray-500 dark:text-gray-400 mb-2">Estrutura base implementada com sucesso!</p>
                    <p className="text-sm text-gray-400">Total de registros mockados: {expenses?.length || 0}</p>
                </div>
                
                {/* Simple debug list */}
                <div className="mt-4 space-y-2">
                    {expenses?.map(e => (
                        <div key={e.id} className="p-3 border rounded bg-gray-50 dark:bg-dark-200 dark:border-gray-700 flex justify-between items-center">
                            <div className="flex items-center gap-2">
                                {e.emojiOpcional && <span>{e.emojiOpcional}</span>}
                                <span className="font-medium text-gray-800 dark:text-gray-200">{e.nome}</span>
                            </div>
                            <span className="text-gray-600 dark:text-gray-400">R$ {e.valorPadrao.toFixed(2)} ({e.periodo})</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default RecurringExpensesView;
