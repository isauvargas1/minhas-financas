
import React, { useState, useMemo } from 'react';
import { Goal } from '../types.ts';
import GoalCard from './GoalCard.tsx';
import { PlusIcon, LayoutGridIcon, ListIcon, SearchIcon } from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useGoals, useGoalsOverview, useGoalKpiProgress } from '../modules/goals/hooks';
import { goalErrorView, kpiGoalIds } from '../modules/goals/model.ts';

interface GoalsViewProps {
    onSelectGoal: (goal: Goal) => void;
    onOpenGoalModal: (goal?: Goal) => void;
}

const LOAD_ERROR_MESSAGE = 'Não foi possível carregar as metas. Verifique a conexão e tente novamente.';

const GoalsView: React.FC<GoalsViewProps> = ({ 
    onSelectGoal, onOpenGoalModal
}) => {
    const goalsQuery = useGoals();
    const { data: goalsData, isLoading, isError, error, hasNextPage, fetchNextPage, isFetchingNextPage, refetch } = goalsQuery;
    const goals = useMemo(() => goalsData || [], [goalsData]);
    // Contadores exatos do servidor, independentes da página carregada.
    const overview = useGoalsOverview();
    // Indicadores PJ (servidor) só das metas da página carregada.
    const kpiStates = useGoalKpiProgress(useMemo(() => kpiGoalIds(goals), [goals]));

    const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
    const [searchQuery, setSearchQuery] = useState('');
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';

    // Filter & Sort State
    const [filterStatus, setFilterStatus] = useState<string>('all');
    
    const filteredGoals = useMemo(() => {
        return goals.filter(goal => {
            const matchesSearch = goal.name.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesStatus = filterStatus === 'all' || goal.status === filterStatus;
            return matchesSearch && matchesStatus;
        });
    }, [goals, searchQuery, filterStatus]);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    if (isError && !goalsData) {
        return (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                    {goalErrorView(error).kind === 'forbidden' ? goalErrorView(error).message : LOAD_ERROR_MESSAGE}
                </p>
                <button onClick={() => { void refetch(); }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                    Tentar novamente
                </button>
            </div>
        );
    }

    // Contagens do servidor (metas não arquivadas); "Concluídas" é o status 'alcancada'.
    const counts = overview.data;
    const countText = (value: number | undefined) => (value === undefined ? '—' : String(value));
    const totalCount = countText(counts?.activeCount);
    const inProgressCount = countText(counts?.byStatus.em_andamento);
    const pausedCount = countText(counts?.byStatus.pausada);
    const completedCount = countText(counts?.byStatus.alcancada);
    const cancelledCount = countText(counts?.byStatus.cancelada);

    return (
        <div className="h-full flex flex-col animate-fade-in">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                        {isPJ ? 'Metas Empresariais' : 'Metas Financeiras'}
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {isPJ ? 'Defina objetivos estratégicos e acompanhe KPIs' : 'Defina objetivos e acompanhe seu progresso'}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                    {/* Search */}
                    <div className="relative flex-1 sm:flex-initial">
                        <input
                            type="text"
                            placeholder="Buscar meta..."
                            aria-label="Buscar meta"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full sm:w-48 pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-dark-200 text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                        />
                        <div className="absolute left-3 top-2.5 text-gray-400">
                            <SearchIcon className="h-4 w-4" />
                        </div>
                    </div>

                    {/* View Toggle */}
                    <div className="flex bg-gray-100 dark:bg-dark-200 rounded-lg p-1">
                        <button 
                            onClick={() => setViewMode('card')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'card' ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                            title="Visualização em Cards"
                            aria-label="Visualização em Cards"
                        >
                            <LayoutGridIcon className="h-5 w-5" />
                        </button>
                        <button 
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded-md transition-all ${viewMode === 'list' ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
                            title="Visualização em Lista"
                            aria-label="Visualização em Lista"
                        >
                            <ListIcon className="h-5 w-5" />
                        </button>
                    </div>

                    <button 
                        onClick={() => onOpenGoalModal()}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center shadow-md transition-colors whitespace-nowrap"
                    >
                        <PlusIcon className="mr-2 h-4 w-4" />
                        Nova Meta
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar pb-6">
                
                {/* Stats Summary - ONLY FOR PF (Layout Restaurado) */}
                {!isPJ && (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
                        <div className="bg-indigo-50 dark:bg-indigo-900/10 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                            <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase">Total Metas</span>
                            <p className="text-2xl font-bold text-indigo-800 dark:text-indigo-200">{totalCount}</p>
                        </div>
                        
                        <div className="bg-blue-50 dark:bg-blue-900/10 p-4 rounded-xl border border-blue-100 dark:border-blue-900/30">
                            <span className="text-xs font-bold text-blue-600 dark:text-blue-400 uppercase">Em Andamento</span>
                            <p className="text-2xl font-bold text-blue-800 dark:text-blue-200">
                                {inProgressCount}
                            </p>
                        </div>

                        <div className="bg-yellow-50 dark:bg-yellow-900/10 p-4 rounded-xl border border-yellow-100 dark:border-yellow-900/30">
                            <span className="text-xs font-bold text-yellow-600 dark:text-yellow-400 uppercase">Pausadas</span>
                            <p className="text-2xl font-bold text-yellow-800 dark:text-yellow-200">
                                {pausedCount}
                            </p>
                        </div>

                        <div className="bg-green-50 dark:bg-green-900/10 p-4 rounded-xl border border-green-100 dark:border-green-900/30">
                            <span className="text-xs font-bold text-green-600 dark:text-green-400 uppercase">Concluídas</span>
                            <p className="text-2xl font-bold text-green-800 dark:text-green-200">
                                {completedCount}
                            </p>
                        </div>

                        <div className="bg-red-50 dark:bg-red-900/10 p-4 rounded-xl border border-red-100 dark:border-red-900/30">
                            <span className="text-xs font-bold text-red-600 dark:text-red-400 uppercase">Canceladas</span>
                            <p className="text-2xl font-bold text-red-800 dark:text-red-200">
                                {cancelledCount}
                            </p>
                        </div>
                    </div>
                )}

                {/* PJ Simple Stats (Different layout kept for PJ) */}
                {isPJ && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                        <div className="bg-surface border border-border p-4 rounded-xl shadow-sm">
                            <span className="text-xs font-bold text-muted uppercase">Metas Ativas</span>
                            <p className="text-2xl font-bold text-on-surface">{inProgressCount}</p>
                        </div>
                        <div className="bg-surface border border-border p-4 rounded-xl shadow-sm">
                            <span className="text-xs font-bold text-muted uppercase">Concluídas</span>
                            <p className="text-2xl font-bold text-on-surface">{completedCount}</p>
                        </div>
                    </div>
                )}

                {viewMode === 'card' ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {filteredGoals.map(goal => (
                            <GoalCard 
                                key={goal.id} 
                                goal={goal} 
                                onClick={() => onSelectGoal(goal)} 
                                mode="card"
                                kpi={kpiStates.get(goal.id)}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {filteredGoals.map(goal => (
                            <GoalCard 
                                key={goal.id} 
                                goal={goal} 
                                onClick={() => onSelectGoal(goal)} 
                                mode="list"
                                kpi={kpiStates.get(goal.id)}
                            />
                        ))}
                    </div>
                )}

                {filteredGoals.length === 0 && (
                    <div className="text-center py-20 bg-gray-50 dark:bg-dark-200/50 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700">
                        <p className="text-gray-500 dark:text-gray-400">Nenhuma meta encontrada.</p>
                        <button onClick={() => onOpenGoalModal()} className="mt-2 text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
                            Criar minha primeira meta
                        </button>
                    </div>
                )}

                {isError && goalsData && (
                    <p role="alert" className="mt-4 text-center text-sm text-red-600 dark:text-red-400">
                        {LOAD_ERROR_MESSAGE}
                    </p>
                )}

                {searchQuery && hasNextPage && (
                    <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
                        A busca considera apenas as metas já carregadas.
                    </p>
                )}

                {hasNextPage && (
                    <div className="mt-4 flex justify-center">
                        <button
                            onClick={() => { void fetchNextPage(); }}
                            disabled={isFetchingNextPage}
                            className="px-4 py-2 text-sm font-medium rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-dark-200 dark:hover:bg-dark-300 text-gray-700 dark:text-gray-300 disabled:opacity-60 transition-colors"
                        >
                            {isFetchingNextPage ? 'Carregando...' : 'Carregar mais metas'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default GoalsView;
