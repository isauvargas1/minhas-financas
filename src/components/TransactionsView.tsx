import React, { useMemo, useState } from 'react';
import { Goal, Transaction } from '../types.ts';
import { transactionTypeColors } from '../constants.ts';
import {
    PlusIcon,
    BackIcon,
    EditIcon,
    DeleteIcon,
    SortUpIcon,
    SortDownIcon,
    TargetIcon,
    SearchIcon,
    FilterIcon,
    CloseIcon,
} from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import AllocationAnalysis from './AllocationAnalysis.tsx';
import BusinessAllocationAnalysis from './BusinessAllocationAnalysis.tsx';
import { usePlan } from '../hooks/usePlan.ts';
import CatalogVisualChip from './CatalogVisualChip.tsx';
import { useSettingsCatalog } from '../modules/settings-catalog/hooks.ts';
import { resolveTransactionVisuals } from '../modules/settings-catalog/display.ts';
import {
    isCreditCardInvoiceCompatibleTransaction,
    isCreditCardInvoicePaymentCashTransaction,
} from '../modules/credit-cards/compatibility';

interface TransactionsViewProps {
    viewType: 'receita' | 'despesa' | 'investimento';
    transactions: Transaction[];
    onBack: () => void;
    onAddTransaction: () => void;
    onEditTransaction: (transaction: Transaction) => void;
    onDeleteTransaction: (transaction: Transaction) => void;
    goals?: Goal[];
}

type SortableKeys =
    | 'description'
    | 'category'
    | 'date'
    | 'value'
    | 'incomeType'
    | 'expenseType'
    | 'paymentMethod'
    | 'isPaid';



type ColumnAlignment = 'left' | 'right' | 'center';

const getHeaderAlignClass = (align: 'left' | 'right' | 'center') => {
    if (align === 'right') return 'text-right';
    if (align === 'center') return 'text-center';
    return 'text-left';
};

const getButtonAlignClass = (align: ColumnAlignment) => {
    if (align === 'right') return 'w-full justify-end';
    if (align === 'center') return 'w-full justify-center';
    return 'w-full justify-start';
};

const normalizeText = (value: unknown): string =>
    String(value ?? '').trim().toLocaleLowerCase('pt-BR');

const getDateTimestamp = (dateString: string): number => {
    const parsed = new Date(`${dateString}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

const formatCurrency = (value: number) =>
    new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(value);

const formatDate = (dateString: string) => {
    const date = new Date(`${dateString}T12:00:00`);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('pt-BR');
};

const TransactionsView: React.FC<TransactionsViewProps> = ({
    viewType,
    transactions,
    onBack,
    onAddTransaction,
    onEditTransaction,
    onDeleteTransaction,
    goals = [],
}) => {
    const { activeWorkspace } = useWorkspace();
    const isPF = activeWorkspace.type === 'PF';
    const isPJ = activeWorkspace.type === 'PJ';

    const catalogQuery = useSettingsCatalog({ includeInactive: true });
    const catalogItems = catalogQuery.data ?? [];

    const { checkLimit, userPlan } = usePlan();

    const transactionsThisMonth = useMemo(() => {
        const today = new Date();
        const currentMonth = today.getMonth();
        const currentYear = today.getFullYear();

        return transactions.filter((transaction) => {
            if (isCreditCardInvoiceCompatibleTransaction(transaction)) {
                return false;
            }

            const date = new Date(`${transaction.date}T12:00:00`);
            return (
                !Number.isNaN(date.getTime()) &&
                date.getMonth() === currentMonth &&
                date.getFullYear() === currentYear
            );
        }).length;
    }, [transactions]);

    const canCreateTransaction = checkLimit('transactionsMonth', transactionsThisMonth);

    const [sortConfig, setSortConfig] = useState<{
        key: SortableKeys;
        direction: 'ascending' | 'descending';
    }>({
        key: 'date',
        direction: 'descending',
    });

    const [searchTerm, setSearchTerm] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('todas');
    const [secondaryFilter, setSecondaryFilter] = useState('todas');
    const [paymentStatusFilter, setPaymentStatusFilter] = useState<'todos' | 'paid' | 'pending'>(
        'todos',
    );

    const viewTitles = {
        receita: 'Receitas',
        despesa: 'Despesas e Parcelamentos',
        investimento: 'Investimentos',
    };

    const goalNameById = useMemo<Record<string, string>>(() => {
        return goals.reduce<Record<string, string>>((acc, goal) => {
            acc[goal.id] = goal.name;
            return acc;
        }, {});
    }, [goals]);

    const categoryOptions = useMemo<string[]>(() => {
        return Array.from(
            new Set<string>(
                transactions
                    .map((transaction) => transaction.category)
                    .filter((value): value is string => Boolean(value)),
            ),
        ).sort((a: string, b: string) => a.localeCompare(b, 'pt-BR'));
    }, [transactions]);

    const secondaryFilterLabel =
        viewType === 'receita'
            ? 'Tipo de receita'
            : viewType === 'despesa'
                ? 'Tipo de despesa'
                : 'Meta';

    const getSecondaryFilterValue = (transaction: Transaction): string => {
        if (viewType === 'receita') {
            return transaction.incomeType || '';
        }

        if (viewType === 'despesa') {
            return transaction.type === 'parcelado'
                ? 'Parcelamento'
                : transaction.expenseType || '';
        }

        return transaction.goalId
            ? goalNameById[transaction.goalId] || 'Meta removida'
            : 'Sem meta';
    };

    const secondaryOptions = useMemo<string[]>(() => {
        return Array.from(
            new Set<string>(
                transactions
                    .map((transaction) => getSecondaryFilterValue(transaction))
                    .filter((value): value is string => Boolean(value)),
            ),
        ).sort((a: string, b: string) => a.localeCompare(b, 'pt-BR'));
    }, [transactions, viewType, goalNameById]);

    const filteredTransactions = useMemo(() => {
        const normalizedSearch = normalizeText(searchTerm);

       return transactions.filter((transaction) => {
    if (
        viewType === 'despesa' &&
        isCreditCardInvoicePaymentCashTransaction(transaction)
    ) {
        return false;
    }

    const searchableFields = [
        transaction.description,
                transaction.category,
                transaction.date,
                transaction.incomeType,
                transaction.expenseType,
                transaction.paymentMethod || (transaction.cardId ? 'Cartão de Crédito' : ''),
                getSecondaryFilterValue(transaction),
                transaction.type === 'parcelado' ? 'Parcelamento' : '',
                transaction.isPaid
                    ? viewType === 'investimento'
                        ? 'Depositado'
                        : 'Pago'
                    : 'Pendente',
            ];

            const matchesSearch =
                !normalizedSearch ||
                searchableFields.some((value) =>
                    normalizeText(value).includes(normalizedSearch),
                );

            const matchesCategory =
                categoryFilter === 'todas' || transaction.category === categoryFilter;

            const matchesSecondary =
                secondaryFilter === 'todas' ||
                getSecondaryFilterValue(transaction) === secondaryFilter;

            const matchesPaymentStatus =
                viewType === 'receita' ||
                paymentStatusFilter === 'todos' ||
                (paymentStatusFilter === 'paid'
                    ? Boolean(transaction.isPaid)
                    : !transaction.isPaid);

            return (
                matchesSearch &&
                matchesCategory &&
                matchesSecondary &&
                matchesPaymentStatus
            );
        });
    }, [
        transactions,
        searchTerm,
        categoryFilter,
        secondaryFilter,
        paymentStatusFilter,
        viewType,
        goalNameById,
    ]);

    const sortedTransactions = useMemo(() => {
        const sortableItems = [...filteredTransactions];

        const getComparableValue = (
            transaction: Transaction,
            key: SortableKeys,
        ): string | number => {
            switch (key) {
                case 'date':
                    return getDateTimestamp(transaction.date);
                case 'value':
                    return transaction.value ?? 0;
                case 'incomeType':
                    return normalizeText(transaction.incomeType);
                case 'expenseType':
                    return normalizeText(
                        transaction.type === 'parcelado'
                            ? 'Parcelamento'
                            : transaction.expenseType,
                    );
                case 'paymentMethod':
                    return normalizeText(
                        transaction.paymentMethod ||
                        (transaction.cardId ? 'Cartão de Crédito' : ''),
                    );
                case 'isPaid':
                    return transaction.isPaid ? 1 : 0;
                case 'description':
                    return normalizeText(transaction.description);
                case 'category':
                    return normalizeText(transaction.category);
                default:
                    return '';
            }
        };

        sortableItems.sort((a, b) => {
            const aValue = getComparableValue(a, sortConfig.key);
            const bValue = getComparableValue(b, sortConfig.key);

            if (typeof aValue === 'number' && typeof bValue === 'number') {
                return sortConfig.direction === 'ascending'
                    ? aValue - bValue
                    : bValue - aValue;
            }

            const comparison = String(aValue).localeCompare(String(bValue), 'pt-BR', {
                numeric: true,
                sensitivity: 'base',
            });

            return sortConfig.direction === 'ascending' ? comparison : -comparison;
        });

        return sortableItems;
    }, [filteredTransactions, sortConfig]);

    const investmentSummary = useMemo(() => {
        if (viewType !== 'investimento') return null;

        const summary: Record<
            string,
            { name: string; total: number; color: string; icon: string }
        > = {};
        let noGoalTotal = 0;

        transactions.forEach((transaction) => {
            if (transaction.goalId) {
                const goal = goals.find((g) => g.id === transaction.goalId);
                if (goal) {
                    if (!summary[goal.id]) {
                        summary[goal.id] = {
                            name: goal.name,
                            total: 0,
                            color: goal.visual.color,
                            icon: goal.visual.emoji || '',
                        };
                    }
                    summary[goal.id].total += transaction.value;
                } else {
                    noGoalTotal += transaction.value;
                }
            } else {
                noGoalTotal += transaction.value;
            }
        });

        return { goals: Object.values(summary), noGoalTotal };
    }, [transactions, viewType, goals]);

    const filteredTotal = useMemo(
        () =>
            filteredTransactions.reduce(
                (total, transaction) => total + transaction.value,
                0,
            ),
        [filteredTransactions],
    );

    const filteredAverage =
        filteredTransactions.length > 0
            ? filteredTotal / filteredTransactions.length
            : 0;

    const paidTransactionsCount = useMemo(
        () =>
            filteredTransactions.filter((transaction) =>
                Boolean(transaction.isPaid),
            ).length,
        [filteredTransactions],
    );

    const hasActiveFilters =
        Boolean(searchTerm) ||
        categoryFilter !== 'todas' ||
        secondaryFilter !== 'todas' ||
        (viewType !== 'receita' && paymentStatusFilter !== 'todos');

    const clearFilters = () => {
        setSearchTerm('');
        setCategoryFilter('todas');
        setSecondaryFilter('todas');
        setPaymentStatusFilter('todos');
    };

    const requestSort = (key: SortableKeys) => {
        let direction: 'ascending' | 'descending' = 'ascending';

        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }

        setSortConfig({ key, direction });
    };

    const getSortIcon = (key: SortableKeys) => {
        if (sortConfig.key !== key) return null;
        if (sortConfig.direction === 'ascending') {
            return <SortUpIcon className="h-4 w-4 ml-1" />;
        }
        return <SortDownIcon className="h-4 w-4 ml-1" />;
    };

    const tableHeaders = useMemo<
        { key: SortableKeys; label: string; align: ColumnAlignment }[]
    >(() => {
        if (viewType === 'receita') {
            return [
                { key: 'incomeType', label: 'Tipo de Receita', align: 'left' },
                { key: 'category', label: 'Categoria', align: 'left' },
                { key: 'description', label: 'Origem/Descrição', align: 'left' },
                { key: 'value', label: 'Valor (R$)', align: 'center' },
                { key: 'date', label: 'Data', align: 'center' },
            ];
        }

        if (viewType === 'despesa') {
            return [
                { key: 'description', label: 'Produto/Serviço', align: 'left' },
                { key: 'category', label: 'Categoria', align: 'left' },
                { key: 'expenseType', label: 'Tipo', align: 'left' },
                { key: 'paymentMethod', label: 'Forma Pgto', align: 'left' },
                { key: 'isPaid', label: 'Status', align: 'center' },
                { key: 'date', label: 'Vencimento', align: 'left' },
                { key: 'value', label: 'Valor', align: 'center' },
            ];
        }

        return [
            { key: 'description', label: 'Descrição', align: 'left' },
            { key: 'category', label: 'Categoria', align: 'left' },
            { key: 'isPaid', label: 'Status', align: 'center' },
            { key: 'date', label: 'Data', align: 'left' },
            { key: 'value', label: 'Valor', align: 'center' },
        ];
    }, [viewType]);

    const tableColumnCount = tableHeaders.length + 1;

    return (
        <div className="h-full animate-fade-in flex flex-col gap-6">
            {viewType === 'investimento' && isPF && (
                <AllocationAnalysis
                    transactions={transactions}
                    goals={goals}
                    periodLabel="este período"
                />
            )}

            {viewType === 'investimento' && isPJ && (
                <BusinessAllocationAnalysis
                    transactions={transactions}
                    goals={goals}
                />
            )}

            {viewType === 'investimento' && investmentSummary && (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                    <div className="bg-white dark:bg-dark-100 rounded-xl shadow-md p-6 border-l-4 border-gray-400 dark:border-gray-500">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-gray-500 dark:text-gray-400 font-medium text-sm">
                                Sem Meta Definida
                            </span>
                            <div className="bg-gray-100 dark:bg-dark-800 p-1.5 rounded-full text-gray-500">
                                <TargetIcon className="w-4 h-4 opacity-50" />
                            </div>
                        </div>
                        <p className="text-2xl font-bold text-gray-800 dark:text-white">
                            {formatCurrency(investmentSummary.noGoalTotal)}
                        </p>
                    </div>

                    {investmentSummary.goals.map((item, idx) => (
                        <div
                            key={idx}
                            className="bg-white dark:bg-dark-100 rounded-xl shadow-md p-6 border-l-4"
                            style={{ borderLeftColor: item.color }}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-gray-500 dark:text-gray-400 font-medium text-sm truncate pr-2">
                                    {item.name}
                                </span>
                                <div
                                    className="p-1.5 rounded-full text-white text-xs flex items-center justify-center w-7 h-7"
                                    style={{ backgroundColor: item.color }}
                                >
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
                        <button
                            onClick={onBack}
                            className="p-2 rounded-md bg-gray-100 dark:bg-dark-200 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-dark-300 transition-colors"
                            aria-label="Voltar ao dashboard"
                        >
                            <BackIcon />
                        </button>

                        <div>
                            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                                {viewTitles[viewType]}
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                Visualize, filtre, ordene e gerencie suas transações com mais precisão.
                            </p>
                        </div>
                    </div>

                    <div className="flex flex-col items-end relative">
                        <button
                            onClick={onAddTransaction}
                            disabled={!canCreateTransaction}
                            className={`font-medium py-2 px-4 rounded-lg flex items-center shadow-md transition-colors duration-200 whitespace-nowrap ${canCreateTransaction
                                ? 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800 text-white cursor-pointer'
                                : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                                }`}
                        >
                            <PlusIcon className="mr-2 h-4 w-4" />
                            Nova Transação
                        </button>

                        {!canCreateTransaction && (
                            <span className="text-[10px] text-amber-600 mt-1 absolute -bottom-5">
                                Limite mensal ({userPlan.limits.transactionsMonth}) atingido.{' '}
                                <a href="/planos" className="underline font-bold">
                                    Upgrade!
                                </a>
                            </span>
                        )}
                    </div>
                </div>

                <div className="mb-6 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-dark-200/70 p-4">
                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
                        <div className="xl:col-span-4">
                            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Busca rápida
                            </label>
                            <div className="relative">
                                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                <input
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder={`Buscar em ${viewTitles[
                                        viewType
                                    ].toLowerCase()}...`}
                                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-100 pl-10 pr-4 py-2.5 text-sm text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                        </div>

                        <div className="xl:col-span-3">
                            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Categoria
                            </label>
                            <select
                                value={categoryFilter}
                                onChange={(e) => setCategoryFilter(e.target.value)}
                                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-100 px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="todas">Todas</option>
                                {categoryOptions.map((category) => (
                                    <option key={category} value={category}>
                                        {category}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="xl:col-span-3">
                            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                {secondaryFilterLabel}
                            </label>
                            <select
                                value={secondaryFilter}
                                onChange={(e) => setSecondaryFilter(e.target.value)}
                                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-100 px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="todas">Todos</option>
                                {secondaryOptions.map((option) => (
                                    <option key={option} value={option}>
                                        {option}
                                    </option>
                                ))}
                            </select>
                        </div>

                        {viewType !== 'receita' && (
                            <div className="xl:col-span-2">
                                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    {viewType === 'investimento'
                                        ? 'Status do aporte'
                                        : 'Status'}
                                </label>
                                <select
                                    value={paymentStatusFilter}
                                    onChange={(e) =>
                                        setPaymentStatusFilter(
                                            e.target.value as 'todos' | 'paid' | 'pending',
                                        )
                                    }
                                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-100 px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                >
                                    <option value="todos">Todos</option>
                                    <option value="paid">
                                        {viewType === 'investimento'
                                            ? 'Depositados'
                                            : 'Pagos'}
                                    </option>
                                    <option value="pending">Pendentes</option>
                                </select>
                            </div>
                        )}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2 rounded-full bg-white dark:bg-dark-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-sm ring-1 ring-gray-200 dark:ring-gray-800">
                            <FilterIcon className="h-4 w-4" />
                            {filteredTransactions.length} de {transactions.length} registros
                        </span>

                        <span className="inline-flex items-center rounded-full bg-white dark:bg-dark-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-sm ring-1 ring-gray-200 dark:ring-gray-800">
                            Total {formatCurrency(filteredTotal)}
                        </span>

                        <span className="inline-flex items-center rounded-full bg-white dark:bg-dark-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-sm ring-1 ring-gray-200 dark:ring-gray-800">
                            Média {formatCurrency(filteredAverage)}
                        </span>

                        {viewType !== 'receita' && (
                            <span className="inline-flex items-center rounded-full bg-white dark:bg-dark-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-sm ring-1 ring-gray-200 dark:ring-gray-800">
                                {viewType === 'investimento' ? 'Depositados' : 'Pagos'}{' '}
                                {paidTransactionsCount}
                            </span>
                        )}

                        <span className="inline-flex items-center rounded-full bg-white dark:bg-dark-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-sm ring-1 ring-gray-200 dark:ring-gray-800">
                            Ordenação{' '}
                            {sortConfig.direction === 'ascending'
                                ? 'menor → maior'
                                : 'maior → menor'}
                        </span>

                        {hasActiveFilters && (
                            <button
                                onClick={clearFilters}
                                className="inline-flex items-center gap-2 rounded-full bg-gray-900 text-white dark:bg-white dark:text-gray-900 px-3 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90"
                            >
                                <CloseIcon className="h-4 w-4" />
                                Limpar filtros
                            </button>
                        )}
                    </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-dark-100 shadow-sm">
                    <div className="max-h-[60vh] overflow-auto">
                        <table className="w-full min-w-[980px] text-sm">
                            <thead className="sticky top-0 z-10 bg-gray-50/95 dark:bg-dark-200/95 backdrop-blur-sm">
                                <tr className="border-b border-gray-200 dark:border-gray-700">
                                    {tableHeaders.map(({ key, label, align }) => (
                                        <th key={key} className={`${getHeaderAlignClass(align)} py-3 px-4 text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap`}>
                                            <button
                                                onClick={() => requestSort(key)}
                                                className={`flex items-center ${getButtonAlignClass(align)} hover:text-gray-700 dark:hover:text-gray-200 transition-colors`}
                                            >
                                                {label}
                                                {getSortIcon(key)}
                                            </button>
                                        </th>
                                    ))}

                                    <th className="text-center py-3.5 px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                        Ações
                                    </th>
                                </tr>
                            </thead>

                            <tbody>
                                {sortedTransactions.map((transaction) => {
                                    const visuals = resolveTransactionVisuals({
                                        transaction,
                                        catalogItems,
                                    });
                                    const isCreditCardInvoiceProjection = isCreditCardInvoiceCompatibleTransaction(transaction);

                                    return (
                                        <tr
                                            key={transaction.id}
                                            className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/80 dark:hover:bg-dark-200/80 transition-colors duration-200"
                                        >
                                            {viewType === 'receita' ? (
                                                <>
                                                    <td className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                                        {transaction.incomeType ? (
                                                            <CatalogVisualChip
                                                                visual={visuals.incomeType}
                                                                fallbackLabel={transaction.incomeType}
                                                            />
                                                        ) : (
                                                            '-'
                                                        )}
                                                    </td>

                                                    <td className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                                        <CatalogVisualChip
                                                            visual={visuals.category}
                                                            fallbackLabel={transaction.category}
                                                        />
                                                    </td>

                                                    <td className="py-4 px-4 text-gray-800 dark:text-gray-200">
                                                        <div className="max-w-[280px]">
                                                            <div className="font-semibold truncate">
                                                                {transaction.description}
                                                            </div>
                                                            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                                                Receita registrada
                                                            </div>
                                                        </div>
                                                    </td>

                                                    <td
                                                        className={`py-4 px-4 text-center font-semibold whitespace-nowrap ${transactionTypeColors[
                                                            transaction.type
                                                        ] || ''
                                                            }`}
                                                    >
                                                        + {formatCurrency(transaction.value)}
                                                    </td>

                                                    <td className="py-4 px-4 text-center text-gray-600 dark:text-gray-300 whitespace-nowrap">
                                                        {formatDate(transaction.date)}
                                                    </td>

                                                    <td className="py-4 px-4 text-center">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <button
                                                                onClick={() =>
                                                                    onEditTransaction(
                                                                        transaction,
                                                                    )
                                                                }
                                                                className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-full transition-colors"
                                                                aria-label="Editar"
                                                            >
                                                                <EditIcon />
                                                            </button>
                                                            <button
                                                                onClick={() =>
                                                                    onDeleteTransaction(
                                                                        transaction,
                                                                    )
                                                                }
                                                                className="p-2 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full transition-colors"
                                                                aria-label="Deletar"
                                                            >
                                                                <DeleteIcon />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    <td className="py-4 px-4 text-gray-800 dark:text-gray-200">
                                                        <div className="max-w-[280px]">
                                                            {(transaction.type === 'despesa' || transaction.type === 'parcelado') ? (
                                                                <CatalogVisualChip
                                                                    visual={visuals.productService}
                                                                    fallbackLabel={transaction.description}
                                                                />
                                                            ) : (
                                                                <div className="font-semibold truncate">
                                                                    {transaction.description}
                                                                </div>
                                                            )}

                                                            <div className="mt-1 flex flex-wrap items-center gap-2">
                                                                {isCreditCardInvoiceProjection ? (
                                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                                                                        FATURA
                                                                    </span>
                                                                ) : transaction.type === 'parcelado' ? (
                                                                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                                                                        PARCELA {transaction.currentInstallment}/{transaction.installments}
                                                                    </span>
                                                                ) : null}

                                                                {transaction.goalId && viewType === 'investimento' && (
                                                                    <span className="inline-flex rounded-full bg-indigo-100 dark:bg-indigo-900/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">
                                                                        Meta vinculada
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>

                                                    <td className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                                        <CatalogVisualChip
                                                            visual={visuals.category}
                                                            fallbackLabel={transaction.category}
                                                        />
                                                    </td>

                                                    {viewType === 'despesa' && (
                                                        <>
                                                            <td className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                                                {transaction.expenseType || transaction.type === 'parcelado' ? (
                                                                    <CatalogVisualChip
                                                                        visual={visuals.expenseType}
                                                                        fallbackLabel={
                                                                            transaction.type === 'parcelado'
                                                                                ? 'Parcelamento'
                                                                                : transaction.expenseType
                                                                        }
                                                                    />
                                                                ) : (
                                                                    '-'
                                                                )}
                                                            </td>

                                                            <td className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                                                {transaction.paymentMethod || transaction.cardId ? (
                                                                    <CatalogVisualChip
                                                                        visual={visuals.paymentMethod}
                                                                        fallbackLabel={
                                                                            transaction.paymentMethod ||
                                                                            (transaction.cardId ? 'Cartão de Crédito' : '')
                                                                        }
                                                                    />
                                                                ) : (
                                                                    '-'
                                                                )}
                                                            </td>

                                                            <td className="py-4 px-4 text-center">
                                                                {transaction.isPaid ? (
                                                                    <span className="inline-flex rounded-full bg-green-100 dark:bg-green-900/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-green-800 dark:text-green-400">
                                                                        Pago
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                                                                        Pendente
                                                                    </span>
                                                                )}
                                                            </td>
                                                        </>
                                                    )}

                                                    {viewType === 'investimento' && (
                                                        <td className="py-4 px-4 text-center">
                                                            {transaction.isPaid ? (
                                                                <span className="inline-flex rounded-full bg-blue-100 dark:bg-blue-900/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-400">
                                                                    Depositado
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                                                                    Pendente
                                                                </span>
                                                            )}
                                                        </td>
                                                    )}

                                                    <td className="py-4 px-4 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                                                        {formatDate(transaction.date)}
                                                    </td>

                                                    <td
                                                        className={`py-4 px-4 text-center font-semibold whitespace-nowrap ${transactionTypeColors[
                                                            transaction.type
                                                        ] || ''
                                                            }`}
                                                    >
                                                        - {formatCurrency(transaction.value)}
                                                    </td>

                                                    <td className="py-4 px-4 text-center">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <button
                                                                onClick={() => onEditTransaction(transaction)}
                                                                disabled={isCreditCardInvoiceProjection}
                                                                className={`p-2 rounded-full transition-colors ${isCreditCardInvoiceProjection
                                                                    ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                                                    : 'text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                                                                    }`}
                                                                aria-label={
                                                                    isCreditCardInvoiceProjection
                                                                        ? 'Fatura de cartão não pode ser editada como transação'
                                                                        : 'Editar'
                                                                }
                                                            >
                                                                <EditIcon />
                                                            </button>
                                                            <button
                                                                onClick={() => onDeleteTransaction(transaction)}
                                                                disabled={isCreditCardInvoiceProjection}
                                                                className={`p-2 rounded-full transition-colors ${isCreditCardInvoiceProjection
                                                                    ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                                                                    : 'text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30'
                                                                    }`}
                                                                aria-label={
                                                                    isCreditCardInvoiceProjection
                                                                        ? 'Fatura de cartão não pode ser excluída como transação'
                                                                        : 'Deletar'
                                                                }
                                                            >
                                                                <DeleteIcon />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </>
                                            )}
                                        </tr>
                                    );
                                })}

                                {sortedTransactions.length === 0 && (
                                    <tr>
                                        <td colSpan={tableColumnCount} className="py-14 px-4">
                                            <div className="flex flex-col items-center justify-center gap-2 text-center text-gray-500 dark:text-gray-400">
                                                <SearchIcon className="h-6 w-6 opacity-60" />
                                                <p className="text-sm font-semibold">
                                                    Nenhuma transação encontrada.
                                                </p>
                                                <p className="text-xs">
                                                    Ajuste os filtros ou limpe a busca para ver mais resultados.
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TransactionsView;