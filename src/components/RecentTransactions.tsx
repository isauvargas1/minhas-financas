import React, { useState, useMemo } from 'react';
import { Transaction, TransactionType } from '../types.ts';
import { transactionTypeColors } from '../constants.ts';
import { PlusIcon, SortUpIcon, SortDownIcon } from './Icons.tsx';
import CatalogVisualChip from './CatalogVisualChip.tsx';
import { useBilling } from '../modules/billing/BillingContext';
import { transactionsQuotaView } from '../modules/billing/transactionsQuota';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { transactionAmount } from '../modules/transactions/amount.ts';
import { formatDateBR } from '../utils/date.ts';
import { useMoneyDisplay } from '../modules/work-time/display';
import { useSettingsCatalog } from '../modules/settings-catalog/hooks.ts';
import { resolveTransactionVisuals } from '../modules/settings-catalog/display.ts';
import { useRecentTransactions } from '../modules/transactions/hooks.ts';
import { RECENT_TRANSACTIONS_COUNT } from '../modules/transactions/api.ts';
import {
    isCreditCardPaymentCashMirror,
    isInvestmentRedemption,
    transactionCashImpactCents,
} from '../modules/investments/semantics.ts';

interface RecentTransactionsProps {
    onNewTransaction: () => void;
    /** Só a prévia de Personalização: lançamentos de exemplo, sem consulta ao Firestore. */
    previewTransactions?: Transaction[];
}

type SortableKeys = 'description' | 'category' | 'date' | 'valueCents';

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

const RecentTransactions: React.FC<RecentTransactionsProps> = ({ onNewTransaction, previewTransactions }) => {
    const display = useMoneyDisplay();
    const [filter, setFilter] = useState<TransactionType | 'todas'>('todas');
    // P5-GATE-FINAL (FIRESTORE-01): o widget lê só as 9 mais recentes do tipo do filtro, nos últimos 12 meses.
    // A ordenação por coluna reorganiza só as exibidas (até 9), e a legenda abaixo do título diz isso.
    const { activeWorkspace } = useWorkspace();
    const recent = useRecentTransactions(activeWorkspace?.id ?? '', filter === 'todas' ? null : filter, {
        enabled: previewTransactions === undefined,
    });
    const transactions = useMemo(
        () => previewTransactions === undefined
            ? recent.data ?? []
            : previewTransactions.filter((t) => filter === 'todas' || t.type === filter),
        [previewTransactions, recent.data, filter],
    );
    const [sortConfig, setSortConfig] = useState<{ key: SortableKeys; direction: 'ascending' | 'descending' }>({ key: 'date', direction: 'descending' });

    // --- LÓGICA DE LIMITES DE PLANO ---
    // Plano do WORKSPACE ativo (do owner), não o de quem está vendo.
    const { workspaceEntitlement } = useBilling();
    // O limite é do plano do titular (D-01): só ele resolve com upgrade.
    const { activeWorkspaceRole } = useWorkspace();
    const isWorkspaceOwner = activeWorkspaceRole === 'owner';
    const catalogQuery = useSettingsCatalog({ includeInactive: true });
    const catalogItems = catalogQuery.data ?? [];

    // Uso mensal do contador do backend (D-40), não contagem local.
    const canCreateTransaction = transactionsQuotaView(workspaceEntitlement).canCreate;
    // ----------------------------------

    const sortedTransactions = useMemo(() => {
        let sortableItems = [...transactions];
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
    }, [transactions, sortConfig]);

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
        { key: 'valueCents', label: 'Valor', align: 'center' },
    ];

    return (
        <div className="bg-white dark:bg-dark-100 rounded-xl shadow-md p-6 h-full">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-800 dark:text-white">Transações Recentes</h2>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Mostra até as {RECENT_TRANSACTIONS_COUNT} mais recentes dos últimos 12 meses. Ordenar por coluna reorganiza só as exibidas.
                    </p>
                </div>
                <div className="flex items-center space-x-3">

                    <div className="flex flex-col items-end">
                        <button
                            onClick={onNewTransaction}
                            disabled={!canCreateTransaction}
                            className={`font-medium py-2 px-4 rounded-lg flex items-center shadow-md transition-colors duration-200 whitespace-nowrap ${canCreateTransaction
                                    ? 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800 text-white cursor-pointer'
                                    : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
                                }`}
                        >
                            <PlusIcon className="mr-2" />
                            Nova Transação
                        </button>

                        {!canCreateTransaction && (
                            <span className="text-[10px] text-amber-600 mt-1 absolute -bottom-4">
                                Limite mensal atingido.{' '}
                                {isWorkspaceOwner
                                    ? <a href="/planos" className="underline font-bold">Upgrade!</a>
                                    : 'Peça ao titular do espaço.'}
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
                        {recent.isError && (
                            <tr>
                                <td colSpan={tableHeaders.length} role="alert" className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                    Não foi possível carregar as transações recentes.{' '}
                                    <button type="button" onClick={() => void recent.refetch()} className="font-semibold text-indigo-600 dark:text-indigo-300 underline">
                                        Tentar novamente
                                    </button>
                                </td>
                            </tr>
                        )}
                        {previewTransactions === undefined && recent.isPending && (
                            <tr>
                                <td colSpan={tableHeaders.length} role="status" className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                    Carregando transações recentes…
                                </td>
                            </tr>
                        )}
                        {!recent.isError && recent.isTruncated && (
                            <tr>
                                <td colSpan={tableHeaders.length} role="status" className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                    Não foi possível reunir as {RECENT_TRANSACTIONS_COUNT} mais recentes: veja a lista completa em Receitas ou Despesas.
                                </td>
                            </tr>
                        )}
                        {!recent.isError && sortedTransactions.slice(0, RECENT_TRANSACTIONS_COUNT).map((t) => {
                            const visuals = resolveTransactionVisuals({
                                transaction: t,
                                catalogItems,
                            });
                            const isInvoicePayment = isCreditCardPaymentCashMirror(t);
                            const isRedemption = isInvestmentRedemption(t);
                            const cashImpactCents = transactionCashImpactCents(t);

                            return (
                                <tr key={t.id} className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-dark-200 transition-colors duration-200">
                                    <td className="py-4 px-4 text-gray-800 dark:text-gray-200">
                                        <div className="flex flex-col gap-1">
                                            {t.type === 'despesa' && (
                                                <CatalogVisualChip
                                                    visual={visuals.productService}
                                                    fallbackLabel={t.description}
                                                />
                                            )}

                                            {t.type === 'receita' || t.type === 'investimento' ? (
                                                <span>{t.description}</span>
                                            ) : null}

                                            {isInvoicePayment ? (
                                                <span className="text-xs text-green-600 dark:text-green-300 font-medium">
                                                    {t.creditCardPaymentEntry?.reversal ? 'Estorno de pagamento de fatura' : 'Pagamento de fatura'}
                                                </span>
                                            ) : isRedemption ? (
                                                <span className="text-xs text-emerald-600 dark:text-emerald-300 font-medium">
                                                    Resgate de investimento
                                                </span>
                                            ) : null}
                                        </div>
                                    </td>

                                    <td className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                        <CatalogVisualChip
                                            visual={visuals.category}
                                            fallbackLabel={t.category}
                                        />
                                    </td>

                                    <td className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                        {formatDate(t.date)}
                                    </td>

                                    <td className={`py-4 px-4 text-center font-medium ${transactionTypeColors[t.type] || ''}`}>
                                        {cashImpactCents > 0 ? '+' : cashImpactCents < 0 ? '-' : '•'} {display.cents(t.valueCents, () => formatCurrency(transactionAmount(t)))}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default RecentTransactions;
