import React, { useState, useMemo } from 'react';
import { Transaction, TransactionType } from '../types.ts';
import { transactionTypeColors } from '../constants.ts';
import { PlusIcon, SortUpIcon, SortDownIcon } from './Icons.tsx';
// NOVO IMPORT
import { usePlan } from '../hooks/usePlan.ts';
import { formatDateBR, isSameMonthYear } from '../utils/date.ts';

interface RecentTransactionsProps {
    transactions: Transaction[];
    onNewTransaction: () => void;
}

type SortableKeys = 'description' | 'category' | 'date' | 'value';

const getHeaderAlignClass = (align: 'left' | 'right' | 'center') => {
    if (align === 'right') return 'text-right';
    if (align === 'center') return 'text-center';
    return 'text-left';
};

const getButtonAlignClass = (align: 'left' | 'right' | 'center') => {
    if (align === 'right') return 'w-full justify-end';
    if (align === 'center') return 'w-full justify-center';
    return 'w-full justify-start';
};

const RecentTransactions: React.FC<RecentTransactionsProps> = ({ transactions, onNewTransaction }) => {
    const [filter, setFilter] = useState<TransactionType | 'todas'>('todas');
    const [sortConfig, setSortConfig] = useState<{ key: SortableKeys; direction: 'ascending' | 'descending' }>({ key: 'date', direction: 'descending' });

    // --- LÓGICA DE LIMITES DE PLANO ---
    const { checkLimit } = usePlan();
    
    // Conta quantas transações existem no mês atual
    const transactionsThisMonth = useMemo(() => {
    const today = new Date();
    return transactions.filter((transaction) => isSameMonthYear(transaction.date, today)).length;
}, [transactions]);

    const canCreateTransaction = checkLimit('transactionsMonth', transactionsThisMonth);
    // ----------------------------------

    const filteredTransactions = useMemo(() => {
        if (filter === 'todas') {
            return transactions;
        }
        return transactions.filter(t => t.type === filter);
    }, [transactions, filter]);

    const sortedTransactions = useMemo(() => {
        let sortableItems = [...filteredTransactions];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                const aValue = a[sortConfig.key];
                const bValue = b[sortConfig.key];

                if (aValue < bValue) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [filteredTransactions, sortConfig]);

    const requestSort = (key: SortableKeys) => {
        let direction: 'ascending' | 'descending' = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const getSortIcon = (key: SortableKeys) => {
        if (sortConfig.key !== key) return null;
        if (sortConfig.direction === 'ascending') return <SortUpIcon className="h-4 w-4 ml-1" />;
        return <SortDownIcon className="h-4 w-4 ml-1" />;
    };

    const formatCurrency = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
    
    const formatDate = (dateString: string) => formatDateBR(dateString);
    
    const tableHeaders: { key: SortableKeys, label: string, align: 'left' | 'right' | 'center' }[] = [
    { key: 'description', label: 'Descrição', align: 'left' },
    { key: 'category', label: 'Categoria', align: 'left' },
    { key: 'date', label: 'Data', align: 'left' },
    { key: 'value', label: 'Valor', align: 'center' },
];

    return (
        <div className="bg-white dark:bg-dark-100 rounded-xl shadow-md p-6 h-full">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                <h2 className="text-xl font-bold text-gray-800 dark:text-white">Transações Recentes</h2>
                <div className="flex items-center space-x-3">
                    
                    <div className="flex flex-col items-end">
                        <button 
                            onClick={onNewTransaction} 
                            disabled={!canCreateTransaction}
                            className={`font-medium py-2 px-4 rounded-lg flex items-center shadow-md transition-colors duration-200 whitespace-nowrap ${
                                canCreateTransaction 
                                ? 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800 text-white cursor-pointer' 
                                : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                            }`}
                        >
                            <PlusIcon className="mr-2" />
                            Nova Transação
                        </button>
                        
                        {!canCreateTransaction && (
                            <span className="text-[10px] text-amber-600 mt-1 absolute -bottom-4">
                                Limite mensal atingido. <a href="/planos" className="underline font-bold">Upgrade!</a>
                            </span>
                        )}
                    </div>
                    
                    <select 
                        value={filter}
                        onChange={(e) => setFilter(e.target.value as TransactionType | 'todas')}
                        className="border border-gray-300 dark:border-gray-600 bg-white dark:bg-dark-200 text-gray-800 dark:text-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                        <option value="todas">Todas</option>
                        <option value="receita">Receitas</option>
                        <option value="despesa">Despesas</option>
                        <option value="investimento">Investimentos</option>
                        <option value="parcelado">Parceladas</option>
                    </select>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b border-gray-200 dark:border-gray-700">
                            {tableHeaders.map(({ key, label, align }) => (
                                <th
                                    key={key}
                                    className={`${getHeaderAlignClass(align)} py-3 px-4 text-gray-500 dark:text-gray-400 font-medium`}
                                >
                                    <button
                                        onClick={() => requestSort(key)}
                                        className={`flex items-center ${getButtonAlignClass(align)} hover:text-gray-700 dark:hover:text-gray-200 transition-colors`}
                                    >
                                        {label}
                                        {getSortIcon(key)}
                                    </button>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {sortedTransactions.slice(0, 9).map(t => (
                            <tr key={t.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-dark-200 transition-colors duration-200">
                                <td className="py-4 px-4 text-gray-800 dark:text-gray-200">
                                    {t.description}
                                    {t.type === 'parcelado' && ` (${t.currentInstallment}/${t.installments})`}
                                </td>
                                <td className="py-4 px-4 text-gray-600 dark:text-gray-300">{t.category}</td>
                                <td className="py-4 px-4 text-gray-600 dark:text-gray-300">{formatDate(t.date)}</td>
                                <td className={`py-4 px-4 text-center font-medium ${transactionTypeColors[t.type] || ''}`}>
                                    {t.type === 'receita' ? '+' : '-'} {formatCurrency(t.value)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default RecentTransactions;