import React, { useMemo, useState } from 'react';

import {
    ArrowDownIcon,
    BackIcon,
    CheckIcon,
    CloseIcon,
    EditIcon,
    FilterIcon,
    PlusIcon,
    RotateCcwIcon,
    SearchIcon,
    SortDownIcon,
    SortUpIcon,
    TargetIcon,
} from '../../../../components/Icons';
import CatalogVisualChip from '../../../../components/CatalogVisualChip';
import type { ResolvedCatalogVisual } from '../../../settings-catalog/display';
import { useSettingsCatalog } from '../../../settings-catalog/hooks';
import type { Goal } from '../../../../types';
import type { InvestmentAllocationDimension } from '../../types';
import {
    isRedeemablePosition,
    useInvestmentAllocation,
    useSimpleInvestmentMovements,
    useSimpleInvestmentPositions,
} from '../api';
import {
    DEFAULT_SIMPLE_SORT,
    EMPTY_SIMPLE_FILTERS,
    SIMPLE_KIND_LABEL,
    SIMPLE_STATUS_LABEL,
    filterSimpleInvestmentRows,
    hasActiveSimpleFilters,
    simpleCategoryOptions,
    simpleGoalLabel,
    simpleGoalOptions,
    sortSimpleInvestmentRows,
    type SimpleInvestmentFilters,
    type SimpleInvestmentRow,
    type SimpleInvestmentStatus,
    type SimpleSortConfig,
    type SimpleSortKey,
} from '../rows';
import { buildSimpleGoalCards, summarizeSimpleInvestmentChips } from '../summary';
import InvestmentAllocationBand from './AllocationPanels';
import { simpleRowActions, type SimpleWorkspaceRole } from '../permissions';
import { simpleInvestmentError } from '../../errors';
import NewInvestmentModal, { type EditingInvestment } from './NewInvestmentModal';
import WithdrawInvestmentModal from './WithdrawInvestmentModal';
import ConfirmMovementModal, { type ConfirmMovementIntent } from './ConfirmMovementModal';

/**
 * Tela comum de Investimentos (Etapa 2, §6, §7 e §12).
 *
 * Reproduz a experiência do baseline `3395f465` — cabeçalho, cards por meta,
 * barra de filtros, chips, tabela e estado vazio — sobre o domínio
 * autoritativo. A fonte deixou de ser `transactions`: cada linha é um
 * movimento de `investment_movements`, o que faz o aporte pendente aparecer
 * desde o primeiro instante, mesmo sem posição, e faz um lançamento cancelado
 * aparecer como cancelado em vez de sumir ou de posar de investimento ativo.
 *
 * Componente próprio, e não um terceiro `viewType` no `TransactionsView`: a
 * versão atual daquele componente é tipada como `'receita' | 'despesa'` e todo
 * o corpo dele opera sobre `Transaction`. Reintroduzir investimento ali
 * significaria fazer a tela de receitas e despesas carregar um segundo domínio.
 */

const formatCurrency = (cents: number): string =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

const formatDate = (value: Date | null): string =>
    value ? value.toLocaleDateString('pt-BR') : '—';

const STATUS_BADGE: Record<SimpleInvestmentStatus, string> = {
    deposited: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-400',
    pending: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400',
    awaiting: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400',
    received: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400',
    cancelled: 'bg-gray-200 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300',
    undone: 'bg-gray-200 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300',
};

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
    { value: 'todos', label: 'Todos' },
    { value: 'deposited', label: 'Depositados' },
    { value: 'pending', label: 'Pendentes' },
    { value: 'awaiting', label: 'Aguardando recebimento' },
    { value: 'received', label: 'Recebidos' },
    { value: 'cancelled', label: 'Cancelados' },
    { value: 'undone', label: 'Desfeitos' },
];

const TABLE_HEADERS: { key: SimpleSortKey; label: string; align: 'left' | 'center' }[] = [
    { key: 'description', label: 'Descrição', align: 'left' },
    { key: 'category', label: 'Categoria', align: 'left' },
    { key: 'status', label: 'Status', align: 'center' },
    { key: 'date', label: 'Data', align: 'left' },
    { key: 'value', label: 'Valor', align: 'center' },
];

const TABLE_COLUMN_COUNT = TABLE_HEADERS.length + 1;

const headerAlign = (align: 'left' | 'center') => (align === 'center' ? 'text-center' : 'text-left');
const buttonAlign = (align: 'left' | 'center') =>
    align === 'center' ? 'w-full justify-center' : 'w-full justify-start';

export interface SimpleInvestmentsViewProps {
    workspaceId: string;
    /** Decide qual faixa de alocação é montada — nunca as duas (Etapa 3, §6). */
    profileType: 'PF' | 'PJ';
    goals: Goal[];
    role: SimpleWorkspaceRole;
    onBack(): void;
}

/*
 * Corte da projeção que alimenta os cards. Constante de módulo porque a
 * chave da consulta é derivada dela: um array novo a cada render faria o
 * React Query refazer a leitura sem nada ter mudado.
 */
const GOAL_CARD_DIMENSIONS: InvestmentAllocationDimension[] = ['goal'];

const SimpleInvestmentsView: React.FC<SimpleInvestmentsViewProps> = ({
    workspaceId, profileType, goals, role, onBack,
}) => {
    const [filters, setFilters] = useState<SimpleInvestmentFilters>(EMPTY_SIMPLE_FILTERS);
    const [sort, setSort] = useState<SimpleSortConfig>(DEFAULT_SIMPLE_SORT);
    const [feedback, setFeedback] = useState<string>();
    const [creating, setCreating] = useState(false);
    const [editing, setEditing] = useState<EditingInvestment | null>(null);
    const [withdrawing, setWithdrawing] = useState<
        { positionId: string; description: string; principalCents: number } | null
    >(null);
    const [confirming, setConfirming] = useState<
        { intent: ConfirmMovementIntent; movement: { id: string; description: string } } | null
    >(null);

    const movementsQuery = useSimpleInvestmentMovements(workspaceId, filters);
    const rows = useMemo(
        () => (movementsQuery.data?.pages ?? []).flatMap((page) => page.rows),
        [movementsQuery.data],
    );
    const positionsQuery = useSimpleInvestmentPositions(workspaceId, rows);
    const catalogQuery = useSettingsCatalog({ includeInactive: true });

    const goalNames = useMemo(
        () => new Map(goals.map((goal) => [goal.id, goal.name])),
        [goals],
    );

    const filtered = useMemo(
        () => sortSimpleInvestmentRows(filterSimpleInvestmentRows(rows, filters, goalNames), sort),
        [rows, filters, goalNames, sort],
    );
    const chips = useMemo(() => summarizeSimpleInvestmentChips(filtered), [filtered]);
    /*
     * Os cards descrevem a carteira, e não o recorte da tabela.
     *
     * Somá-los a partir de `rows` os fazia zerar quando o usuário escolhia
     * "Pendentes" ou "Cancelados": esse filtro desce ao servidor, e a página
     * devolvida passa a não conter nenhum movimento liquidado. Um card em
     * R$ 0,00 afirma que não há investimento na meta, o que era falso — só a
     * tabela tinha sido filtrada. A projeção de alocação por meta responde a
     * pergunta certa, sem filtro e sem depender de quantas páginas foram
     * carregadas.
     */
    const goalAllocation = useInvestmentAllocation(workspaceId, GOAL_CARD_DIMENSIONS);
    const cards = useMemo(
        () => buildSimpleGoalCards(
            goalAllocation.data?.slices[0]?.items ?? [],
            goals.map((goal) => ({
                id: goal.id,
                name: goal.name,
                color: goal.visual?.color,
                icon: goal.visual?.emoji,
            })),
        ),
        [goalAllocation.data, goals],
    );

    /*
     * Chip da categoria, resolvido pelo **identificador** do movimento sobre o
     * catálogo já carregado — uma consulta para a tela inteira, nunca uma por
     * linha, e nunca uma correspondência por rótulo.
     *
     * O item pode estar em `category` (cadastro atual) ou em `investment_type`
     * (lançamentos anteriores à unificação); o grupo sai do próprio documento
     * encontrado. A cor de fallback continua sendo a do investimento, para que
     * a listagem não mude de identidade visual conforme a origem do cadastro.
     */
    const categoryVisual = (row: SimpleInvestmentRow): ResolvedCatalogVisual | null => {
        const item = (catalogQuery.data ?? []).find((entry) => entry.id === row.categoryId);
        if (!item) return null;
        return {
            group: item.group === 'category' ? 'category' : 'investment_type',
            label: item.name,
            normalizedLabel: item.normalizedName,
            icon: item.icon,
            color: item.color || '#2563eb',
            stroke: item.stroke,
            source: 'catalog',
        };
    };

    const requestSort = (key: SimpleSortKey) =>
        setSort((current) => ({
            key,
            direction: current.key === key && current.direction === 'ascending'
                ? 'descending'
                : 'ascending',
        }));

    const sortIcon = (key: SimpleSortKey) => {
        if (sort.key !== key) return null;
        return sort.direction === 'ascending'
            ? <SortUpIcon className="h-4 w-4 ml-1" />
            : <SortDownIcon className="h-4 w-4 ml-1" />;
    };

    const positionOf = (row: SimpleInvestmentRow) => positionsQuery.data?.get(row.positionId);

    const renderActions = (row: SimpleInvestmentRow) => {
        const actions = simpleRowActions(row, {
            role,
            redeemable: isRedeemablePosition(positionOf(row)),
        });
        if (actions.length === 0) {
            return <span className="text-xs text-gray-400 dark:text-gray-600">—</span>;
        }
        const button = (
            key: string,
            label: string,
            tone: string,
            icon: React.ReactNode,
            onClick: () => void,
        ) => (
            <button
                key={key}
                type="button"
                onClick={onClick}
                title={label}
                aria-label={`${label}: ${row.description}`}
                className={`p-2 rounded-full transition-colors ${tone}`}
            >
                {icon}
            </button>
        );
        return (
            <div className="flex items-center justify-center gap-2">
                {actions.map((action) => {
                    if (action === 'settleContribution') {
                        return button('settle', 'Confirmar depósito',
                            'text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30',
                            <CheckIcon />,
                            () => { setFeedback(undefined); setConfirming({
                                intent: 'settleContribution',
                                movement: { id: row.id, description: row.description },
                            }); });
                    }
                    if (action === 'settleWithdrawal') {
                        return button('settle-withdrawal', 'Confirmar recebimento',
                            'text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30',
                            <CheckIcon />,
                            () => { setFeedback(undefined); setConfirming({
                                intent: 'settleWithdrawal',
                                movement: { id: row.id, description: row.description },
                            }); });
                    }
                    if (action === 'edit') {
                        return button('edit', 'Editar',
                            'text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/30',
                            <EditIcon />,
                            () => { setFeedback(undefined); setEditing({
                                movementId: row.id,
                                description: row.description,
                                classId: row.portfolioId,
                                institutionId: row.institutionId,
                                typeId: row.categoryId,
                                // Rótulo fotografado no movimento: sustenta a
                                // opção de compatibilidade quando a categoria
                                // do pendente não está mais no cadastro.
                                typeName: row.category,
                                valueCents: row.valueCents,
                                goalId: row.goalId,
                                occurredAt: row.occurredAt,
                            }); });
                    }
                    if (action === 'cancel') {
                        return button('cancel', 'Cancelar lançamento',
                            'text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30',
                            <CloseIcon />,
                            () => { setFeedback(undefined); setConfirming({
                                intent: 'cancel',
                                movement: { id: row.id, description: row.description },
                            }); });
                    }
                    if (action === 'withdraw') {
                        return button('withdraw', 'Retirar investimento',
                            'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100 dark:hover:bg-emerald-900/30',
                            <ArrowDownIcon />,
                            () => { setFeedback(undefined); setWithdrawing({
                                positionId: row.positionId,
                                description: row.description,
                                principalCents: positionOf(row)?.principalCents ?? 0,
                            }); });
                    }
                    return button('undo', 'Desfazer lançamento',
                        'text-amber-600 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-900/30',
                        <RotateCcwIcon />,
                        () => { setFeedback(undefined); setConfirming({
                            intent: 'undo',
                            movement: { id: row.id, description: row.description },
                        }); });
                })}
            </div>
        );
    };

    const canCreate = role === 'owner' || role === 'admin' || role === 'member';

    return (
        <div className="h-full animate-fade-in flex flex-col gap-6">
            {/*
              Ordem visual do baseline: alocação, cards por meta, tabela. A
              faixa é PF **ou** PJ, escolhida pelo perfil do workspace.
            */}
            <InvestmentAllocationBand workspaceId={workspaceId} profileType={profileType} />

            {/*
              Enquanto a projeção não chega — ou se ela falhar — a faixa some,
              como a de alocação. Renderizar os cards em R$ 0,00 seria afirmar
              que não há investimento, que é justamente a mentira que esta
              correção elimina.
            */}
            {goalAllocation.data && (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                {cards.map((card) => (
                    <div
                        key={card.goalId ?? 'sem-meta'}
                        className={card.goalId
                            ? 'bg-white dark:bg-dark-100 rounded-xl shadow-md p-6 border-l-4'
                            : 'bg-white dark:bg-dark-100 rounded-xl shadow-md p-6 border-l-4 border-gray-400 dark:border-gray-500'}
                        style={card.goalId && card.color ? { borderLeftColor: card.color } : undefined}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-gray-500 dark:text-gray-400 font-medium text-sm truncate pr-2">
                                {card.name}
                            </span>
                            {card.goalId ? (
                                <div
                                    className="p-1.5 rounded-full text-white text-xs flex items-center justify-center w-7 h-7"
                                    style={{ backgroundColor: card.color || '#6366f1' }}
                                >
                                    {card.icon || <TargetIcon className="w-3 h-3" />}
                                </div>
                            ) : (
                                <div className="bg-gray-100 dark:bg-dark-800 p-1.5 rounded-full text-gray-500">
                                    <TargetIcon className="w-4 h-4 opacity-50" />
                                </div>
                            )}
                        </div>
                        <p className="text-2xl font-bold text-gray-800 dark:text-white">
                            {formatCurrency(card.totalCents)}
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
                            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">Investimentos</h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                Visualize, filtre, ordene e gerencie seus investimentos com mais precisão.
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-col items-end relative">
                        <button
                            onClick={() => { setFeedback(undefined); setEditing(null); setCreating(true); }}
                            disabled={!canCreate}
                            className={`font-medium py-2 px-4 rounded-lg flex items-center shadow-md transition-colors duration-200 whitespace-nowrap ${canCreate
                                ? 'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-700 dark:hover:bg-indigo-800 text-white cursor-pointer'
                                : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'}`}
                        >
                            <PlusIcon className="mr-2 h-4 w-4" />
                            Novo investimento
                        </button>
                    </div>
                </div>

                {feedback && (
                    <div
                        role="status"
                        className="mb-4 rounded-lg border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-700 dark:text-green-300"
                    >
                        {feedback}
                    </div>
                )}

                {movementsQuery.isError && (
                    <div
                        role="alert"
                        className="mb-4 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300"
                    >
                        {simpleInvestmentError(movementsQuery.error)}
                    </div>
                )}

                <div className="mb-6 rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/80 dark:bg-dark-200/70 p-4">
                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
                        <div className="xl:col-span-4">
                            <label htmlFor="simple-search" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Busca rápida
                            </label>
                            <div className="relative">
                                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                                <input
                                    id="simple-search"
                                    value={filters.search}
                                    onChange={(event) => setFilters({ ...filters, search: event.target.value })}
                                    placeholder="Buscar em investimentos..."
                                    className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-100 pl-10 pr-4 py-2.5 text-sm text-gray-800 dark:text-gray-200 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                            </div>
                        </div>

                        <div className="xl:col-span-3">
                            <label htmlFor="simple-filter-category" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Categoria
                            </label>
                            <select
                                id="simple-filter-category"
                                value={filters.category}
                                onChange={(event) => setFilters({ ...filters, category: event.target.value })}
                                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-100 px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="todas">Todas</option>
                                {simpleCategoryOptions(rows).map((category) => (
                                    <option key={category} value={category}>{category}</option>
                                ))}
                            </select>
                        </div>

                        <div className="xl:col-span-3">
                            <label htmlFor="simple-filter-goal" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Meta
                            </label>
                            <select
                                id="simple-filter-goal"
                                value={filters.goal}
                                onChange={(event) => setFilters({ ...filters, goal: event.target.value })}
                                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-100 px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                <option value="todas">Todos</option>
                                {simpleGoalOptions(rows, goalNames).map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="xl:col-span-2">
                            <label htmlFor="simple-filter-status" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Status
                            </label>
                            <select
                                id="simple-filter-status"
                                value={filters.status}
                                onChange={(event) => setFilters({ ...filters, status: event.target.value })}
                                className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-100 px-3 py-2.5 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            >
                                {STATUS_FILTER_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-2 rounded-full bg-white dark:bg-dark-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-sm ring-1 ring-gray-200 dark:ring-gray-800">
                            <FilterIcon className="h-4 w-4" />
                            {filtered.length} de {rows.length} registros
                        </span>
                        <span className="inline-flex items-center rounded-full bg-white dark:bg-dark-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-sm ring-1 ring-gray-200 dark:ring-gray-800">
                            Aportes {formatCurrency(chips.contributionCents)}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-white dark:bg-dark-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-sm ring-1 ring-gray-200 dark:ring-gray-800">
                            Retiradas {formatCurrency(chips.withdrawalCents)}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-white dark:bg-dark-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-sm ring-1 ring-gray-200 dark:ring-gray-800">
                            Aporte médio {formatCurrency(chips.averageContributionCents)}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-white dark:bg-dark-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-sm ring-1 ring-gray-200 dark:ring-gray-800">
                            Depositados {chips.depositedCount}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-white dark:bg-dark-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 shadow-sm ring-1 ring-gray-200 dark:ring-gray-800">
                            Ordenação {sort.direction === 'ascending' ? 'menor → maior' : 'maior → menor'}
                        </span>
                        {hasActiveSimpleFilters(filters) && (
                            <button
                                onClick={() => setFilters(EMPTY_SIMPLE_FILTERS)}
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
                                    {TABLE_HEADERS.map(({ key, label, align }) => (
                                        <th key={key} className={`${headerAlign(align)} py-3 px-4 text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap`}>
                                            <button
                                                onClick={() => requestSort(key)}
                                                className={`flex items-center ${buttonAlign(align)} hover:text-gray-700 dark:hover:text-gray-200 transition-colors`}
                                            >
                                                {label}
                                                {sortIcon(key)}
                                            </button>
                                        </th>
                                    ))}
                                    <th className="text-center py-3.5 px-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-gray-400 whitespace-nowrap">
                                        Ações
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((row) => (
                                    <tr
                                        key={row.id}
                                        className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/80 dark:hover:bg-dark-200/80 transition-colors duration-200"
                                    >
                                        <td className="py-4 px-4 text-gray-800 dark:text-gray-200">
                                            <div className="max-w-[280px]">
                                                <div className="font-semibold truncate">{row.description}</div>
                                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${row.kind === 'withdrawal'
                                                        ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300'
                                                        : 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'}`}>
                                                        {SIMPLE_KIND_LABEL[row.kind]}
                                                    </span>
                                                    {row.goalId && (
                                                        <span className="inline-flex rounded-full bg-indigo-100 dark:bg-indigo-900/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">
                                                            Meta vinculada
                                                        </span>
                                                    )}
                                                </div>
                                                {(row.institution || row.portfolio) && (
                                                    <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                                                        {[row.institution, row.portfolio].filter(Boolean).join(' · ')}
                                                    </p>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-4 px-4 text-gray-600 dark:text-gray-300">
                                            <CatalogVisualChip
                                                visual={categoryVisual(row)}
                                                fallbackLabel={row.category}
                                            />
                                        </td>
                                        <td className="py-4 px-4 text-center">
                                            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[row.status]}`}>
                                                {SIMPLE_STATUS_LABEL[row.status]}
                                            </span>
                                        </td>
                                        <td className="py-4 px-4 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                                            {formatDate(row.occurredAt)}
                                        </td>
                                        {/*
                                          Sinal na moldura do dinheiro investido, e não do caixa
                                          (Etapa 3, §0.A). Nesta tela, aporte aumenta o
                                          investimento e retirada o reduz — marcar a retirada
                                          com "+" porque o caixa cresceu dizia, dentro de
                                          Investimentos, o contrário do que aconteceu. O
                                          resgate liquidado continua sendo entrada no caixa,
                                          onde essa moldura é a correta.
                                        */}
                                        <td className={`py-4 px-4 text-center font-semibold whitespace-nowrap ${!row.effective
                                            ? 'text-gray-400 dark:text-gray-500'
                                            : row.kind === 'withdrawal'
                                                ? 'text-amber-600 dark:text-amber-400'
                                                : 'text-blue-600 dark:text-blue-400'}`}>
                                            {row.kind === 'withdrawal' ? '−' : '+'} {formatCurrency(row.valueCents)}
                                        </td>
                                        <td className="py-4 px-4 text-center">{renderActions(row)}</td>
                                    </tr>
                                ))}

                                {movementsQuery.isLoading && (
                                    <tr>
                                        <td colSpan={TABLE_COLUMN_COUNT} className="py-14 px-4">
                                            <div className="flex flex-col items-center justify-center gap-2 text-center text-gray-500 dark:text-gray-400">
                                                <p className="text-sm font-semibold">Carregando investimentos...</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}

                                {!movementsQuery.isLoading && filtered.length === 0 && (
                                    <tr>
                                        <td colSpan={TABLE_COLUMN_COUNT} className="py-14 px-4">
                                            <div className="flex flex-col items-center justify-center gap-2 text-center text-gray-500 dark:text-gray-400">
                                                <SearchIcon className="h-6 w-6 opacity-60" />
                                                <p className="text-sm font-semibold">
                                                    {rows.length === 0
                                                        ? 'Nenhum investimento registrado.'
                                                        : 'Nenhum investimento encontrado.'}
                                                </p>
                                                <p className="text-xs">
                                                    {rows.length === 0
                                                        ? 'Use "Novo investimento" para registrar o primeiro.'
                                                        : 'Ajuste os filtros ou limpe a busca para ver mais resultados.'}
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/*
                  Escopo declarado sempre, e não só quando há próxima página
                  (Etapa 3, §0.C). Estado e meta descem para a consulta; a busca
                  por texto é da página carregada, e dizer isso é o que impede a
                  pessoa de concluir que "não encontrei" significa "não existe".
                */}
                <div className="mt-4 flex flex-col items-center gap-1">
                    {movementsQuery.hasNextPage && (
                        <button
                            onClick={() => movementsQuery.fetchNextPage()}
                            disabled={movementsQuery.isFetchingNextPage}
                            className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-dark-200 disabled:opacity-50"
                        >
                            {movementsQuery.isFetchingNextPage ? 'Carregando...' : 'Carregar mais'}
                        </button>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        A busca por texto procura nos lançamentos já carregados.
                        {movementsQuery.hasNextPage ? ' Use "Carregar mais" para incluir os anteriores.' : ''}
                    </p>
                </div>
            </div>

            <NewInvestmentModal
                open={creating || editing !== null}
                workspaceId={workspaceId}
                goals={goals}
                editing={editing}
                onClose={() => { setCreating(false); setEditing(null); }}
                onSuccess={setFeedback}
            />

            <WithdrawInvestmentModal
                open={withdrawing !== null}
                workspaceId={workspaceId}
                investment={withdrawing}
                onClose={() => setWithdrawing(null)}
                onSuccess={setFeedback}
            />

            <ConfirmMovementModal
                open={confirming !== null}
                workspaceId={workspaceId}
                intent={confirming?.intent ?? null}
                movement={confirming?.movement ?? null}
                onClose={() => setConfirming(null)}
                onSuccess={setFeedback}
            />
        </div>
    );
};

export default SimpleInvestmentsView;
export { SimpleInvestmentsView };
