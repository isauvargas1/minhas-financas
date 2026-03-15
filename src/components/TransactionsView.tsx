import React, { useState, useMemo } from 'react';
import { Transaction, TransactionType, Goal } from '../types.ts';
import { transactionTypeColors } from '../constants.ts';
import { PlusIcon, BackIcon, EditIcon, DeleteIcon, SortUpIcon, SortDownIcon, TargetIcon } from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import AllocationAnalysis from './AllocationAnalysis.tsx';
import BusinessAllocationAnalysis from './BusinessAllocationAnalysis.tsx';
import { usePlan } from '../hooks/usePlan.ts';

interface TransactionsViewProps {
    viewType: 'receita' | 'despesa' | 'investimento';
    transactions: Transaction[];
    onBack: () => void;
    onAddTransaction: () => void;
    onEditTransaction: (transaction: Transaction) => void;
    onDeleteTransaction: (transaction: Transaction) => void;
    goals?: Goal[];
}

type SortableKeys = 'description' | 'category' | 'date' | 'value' | 'incomeType' | 'expenseType' | 'paymentMethod' | 'isPaid';

const TransactionsView: React.FC<TransactionsViewProps> = ({ 
    viewType, transactions, onBack, onAddTransaction, onEditTransaction, onDeleteTransaction,
    goals = [] 
}) => {
    const { activeWorkspace } = useWorkspace();
    const isPF = activeWorkspace.type === 'PF';
    const isPJ = activeWorkspace.type === 'PJ';
    
    const { checkLimit, userPlan } = usePlan();
    
    const transactionsThisMonth = useMemo(() => {
        const today = new Date();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();
        
        return transactions.filter(t => {
            const tDate = new Date(t.date + 'T00:00:00');
            return tDate.getMonth() === currentMonth && tDate.getFullYear() === currentYear;
        }).length;
    }, [transactions]);

    const canCreateTransaction = checkLimit('transactionsMonth', transactionsThisMonth);

    const [sortConfig, setSortConfig] = useState<{ key: SortableKeys; direction: 'ascending' | 'descending' }>({ key: 'date', direction: 'descending' });
    
    const viewTitles = {
        receita: 'Receitas',
        despesa: 'Despesas e Parcelamentos',
        investimento: 'Investimentos',
    };
    
    const sortedTransactions = useMemo(() => {
        let sortableItems = [...transactions];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                const aValue = a[sortConfig.key as keyof Transaction] || '';
                const bValue = b[sortConfig.key as keyof Transaction] || '';

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
    }, [transactions, sortConfig]);

    const investmentSummary = useMemo(() => {
        if (viewType !== 'investimento') return null;

        const summary: Record<string, { name: string, total: number, color: string, icon: string }> = {};
        let noGoalTotal = 0;

        transactions.forEach(t => {
            if (t.goalId) {
                const goal = goals.find(g => g.id === t.goalId);
                if (goal) {
                    if (!summary[goal.id]) {
                        summary[goal.id] = { 
                            name: goal.name, 
                            total: 0, 
                            color: goal.visual.color, 
                            icon: goal.visual.emoji || '' 
                        };
                    }
                    summary[goal.id].total += t.value;
                } else {
                    noGoalTotal += t.value;
                }
            } else {
                noGoalTotal += t.value;
            }
        });

        return { goals: Object.values(summary), noGoalTotal };
    }, [transactions, viewType, goals]);

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
    
    const formatDate = (dateString: string) => {
        const date = new Date(dateString + 'T00:00:00');
        return date.toLocaleDateString('pt-BR');
    }

    const tableHeaders = useMemo<{ key: SortableKeys, label: string, align: 'left' | 'right' | 'center' }[]>(() => {
        if (viewType === 'receita') {
            return [
                { key: 'incomeType', label: 'Tipo de Receita', align: 'left'},
                { key: 'category', label: 'Categoria', align: 'left'},
                { key: 'description', label: 'Origem/Descrição', align: 'left'},
                { key: 'value', label: 'Valor (R$)', align: 'right'},
                { key: 'date', label: 'Data', align: 'center'},
            ];
        }
        if (viewType === 'despesa') {
            return [
                { key: 'description', label: 'Produto/Serviço', align: 'left'},
                { key: 'category', label: 'Categoria', align: 'left'},
                { key: 'expenseType', label: 'Tipo', align: 'left'},
                { key: 'paymentMethod', label: 'Forma Pgto', align: 'left'},
                { key: 'isPaid', label: 'Status', align: 'center'},
                { key: 'date', label: 'Vencimento', align: 'left'},
                { key: 'value', label: 'Valor', align: 'right'},
            ];
        }
        return [
            { key: 'description', label: 'Descrição', align: 'left'},
            { key: 'category', label: 'Categoria', align: 'left'},
            { key: 'isPaid', label: 'Status', align: 'center'},
            { key: 'date', label: 'Data', align: 'left'},
            { key: 'value', label: 'Valor', align: 'right'},
        ];
    }, [viewType]);

    return (
        <div className="h-full animate-fade-in flex flex-col gap-6">
            
            {viewType === 'investimento' && isPF && (
                <AllocationAnalysis transactions={transactions} goals={goals} periodLabel="este período" />
            )}

            {viewType === 'investimento' && isPJ && (
                <BusinessAllocationAnalysis transactions={transactions} goals={goals} />
            )}

            {viewType === 'investimento' && investmentSummary && (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                    <div className="bg-white dark:bg-dark-100 rounded-xl shadow-md p-6 border-l-4 border-gray-400 dark:border-gray-500">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-gray-500 dark:text-gray-400 font-medium text-sm">Sem Meta Definida</span>
                            <div className="bg-gray-100 dark:bg-dark-800 p-1.5 rounded-full text-gray-500">
                                <TargetIcon className="w-4 h-4 opacity-50" />
                            </div>
                        </div>
                        <p className="text-2xl font-bold text-gray-800 dark:text-white">
                            {formatCurrency(investmentSummary.noGoalTotal)}
                        </p>
                    </div>
                    {investmentSummary.goals.map((item, idx) => (
                        <div key={idx} className="bg-white dark:bg-dark-100 rounded-xl shadow-md p-6 border-l-4" style={{ borderLeftColor: item.color }}>
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-gray-500 dark:text-gray-400 font-medium text-sm truncate pr-2">{item.name}</span>
                                <div className="p-1.5 rounded-full text-white text-xs flex items-center justify-center w-7 h-7" style={{ backgroundColor: item.color }}>
                                    {item.icon || <TargetIcon className="w-3 h-3" />}
                                </div>
                            </div>
                            <p className="text-2xl font-bold text-gray-800 dark:text-white">
                                {formatCurrency(item.total)}
                            </p>
                        </div>
                    ))}
                </div>
            )}

            <div className="bg-white dark:bg-dark-100 rounded-xl shadow-md p-6 flex-1">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                    <div className="flex items-center gap-4">
                        <button onClick={onBack} className="p-2 rounded-md bg-gray-100 dark:bg-dark-200 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-dark-300 transition-colors" aria-label="Voltar ao dashboard">
                            <BackIcon />
                        </button>
                        <h2 className="text-2xl font-bold text-gray-800 dark:text-white">{viewTitles[viewType]}</h2>
                    </div>
                    
                    <div className="flex flex-col items-end relative">
                        <button 
                            onClick={onAddTransaction} 
                            disabled={!canCreateTransaction}
                            className={`font-medium py-2 px-4 rounded-lg flex items-center shadow-md transition-colors duration-200 whitespace-nowrap ${
                                canCreateTransaction
                                ? 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800 text-white cursor-pointer'
                                : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                            }`}
                        >
                            <PlusIcon className="mr-2 h-4 w-4" />
                            Nova Transação
                        </button>
                        
                        {!canCreateTransaction && (
                            <span className="text-[10px] text-amber-600 mt-1 absolute -bottom-5">
                                Limite mensal ({userPlan.limits.transactionsMonth}) atingido. <a href="/planos" className="underline font-bold">Upgrade!</a>
                            </span>
                        )}
                    </div>
                </div>
                
                <div className="overflow-x-auto max-w-6xl mx-auto w-full">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-200 dark:border-gray-700">
                                {tableHeaders.map(({ key, label, align }) => (
                                    <th key={key} className={`text-${align} py-3 px-4 text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap`}>
                                        <button onClick={() => requestSort(key)} className={`flex items-center hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${align === 'right' ? 'ml-auto' : align === 'center' ? 'mx-auto' : ''}`}>
                                            {label}
                                            {getSortIcon(key)}
                                        </button>
                                    </th>
                                ))}
                                <th className="text-center py-3 px-4 text-gray-500 dark:text-gray-400 font-medium">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sortedTransactions.map(t => (
                                <tr key={t.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-dark-200 transition-colors duration-200">
                                    {viewType === 'receita' ? (
                                        <>
                                            <td className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                                {t.incomeType ? (
                                                    <span className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-2 py-1 rounded text-xs font-medium">
                                                        {t.incomeType}
                                                    </span>
                                                ) : '-'}
                                            </td>
                                            
                                            <td className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                                {t.category}
                                            </td>

                                            <td className="py-4 px-4 text-gray-800 dark:text-gray-200">
                                                <div className="font-medium">{t.description}</div>
                                            </td>

                                            <td className={`py-4 px-4 text-right font-medium whitespace-nowrap ${transactionTypeColors[t.type] || ''}`}>
                                                + {formatCurrency(t.value)}
                                            </td>

                                            <td className="py-4 px-4 text-center text-gray-600 dark:text-gray-300 whitespace-nowrap">
                                                {formatDate(t.date)}
                                            </td>

                                            <td className="py-4 px-4 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button onClick={() => onEditTransaction(t)} className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-full" aria-label="Editar">
                                                        <EditIcon />
                                                    </button>
                                                    <button onClick={() => onDeleteTransaction(t)} className="p-2 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full" aria-label="Deletar">
                                                        <DeleteIcon />
                                                    </button>
                                                </div>
                                            </td>
                                        </>
                                    ) : (
                                        <>
                                            <td className="py-4 px-4 text-gray-800 dark:text-gray-200">
                                                <div className="font-medium">{t.description}</div>
                                                {t.type === 'parcelado' && <span className="text-xs text-purple-500">Parcela {t.currentInstallment}/{t.installments}</span>}
                                                {t.goalId && viewType === 'investimento' && (
                                                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300">
                                                        Meta Vinculada
                                                    </span>
                                                )}
                                            </td>
                                            
                                            <td className="py-4 px-4 text-gray-600 dark:text-gray-300">{t.category}</td>

                                            {viewType === 'despesa' && (
                                                <>
                                                    <td className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                                        {t.expenseType || (t.type === 'parcelado' ? 'Parcelamento' : '-')}
                                                    </td>
                                                    <td className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                                        {t.paymentMethod || (t.cardId ? 'Cartão de Crédito' : '-')}
                                                    </td>
                                                    <td className="py-4 px-4 text-center">
                                                        {t.isPaid ? (
                                                            <span className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">Pago</span>
                                                        ) : (
                                                            <span className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">Pendente</span>
                                                        )}
                                                    </td>
                                                </>
                                            )}

                                            {viewType === 'investimento' && (
                                                <td className="py-4 px-4 text-center">
                                                    {t.isPaid ? (
                                                        <span className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">Depositado</span>
                                                    ) : (
                                                        <span className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider">Pendente</span>
                                                    )}
                                                </td>
                                            )}

                                            <td className="py-4 px-4 text-gray-600 dark:text-gray-300 whitespace-nowrap">{formatDate(t.date)}</td>
                                            <td className={`py-4 px-4 text-right font-medium whitespace-nowrap ${transactionTypeColors[t.type] || ''}`}>
                                                - {formatCurrency(t.value)}
                                            </td>
                                            <td className="py-4 px-4 text-center">
                                                <div className="flex items-center justify-center gap-2">
                                                    <button onClick={() => onEditTransaction(t)} className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-full" aria-label="Editar">
                                                        <EditIcon />
                                                    </button>
                                                    <button onClick={() => onDeleteTransaction(t)} className="p-2 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full" aria-label="Deletar">
                                                        <DeleteIcon />
                                                    </button>
                                                </div>
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))}
                             {transactions.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="text-center py-10 text-gray-500 dark:text-gray-400">
                                        Nenhuma transação encontrada.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default TransactionsView;