import React, { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Goal, GoalStatus } from '../types.ts';
import { 
    BackIcon, EditIcon, DeleteIcon, CheckIcon, TargetIcon, 
    TrendingUpIcon, ClockIcon, HistoryIcon, PlusIcon, 
    DynamicIcon, PiggyBankIcon, BuildingIcon
} from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { motion } from 'framer-motion';
// @ts-ignore
import confetti from 'canvas-confetti';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useGoalKpiProgress, useGoalManualHistory } from '../modules/goals/hooks';
import {
    GOAL_CASH_REGIME_NOTE, GOAL_COST_CENTER_KPI_NOTE, businessTypeLabel, businessTypeNeedsCashNote, civilDateKey,
    formatBasisPoints, formatCents, formatCivilDate, formatInstantDate, goalPaceStatus,
    goalProgressView, goalTargetText, monthlySuggestionCents, parseReaisToCents,
} from '../modules/goals/model.ts';
import { goalForecastLabel, goalTimelineEvents, type GoalMovementFact } from '../modules/goals/timeline.ts';
import { listGoalInvestmentMovements } from '../modules/investments/persistence/readApi.ts';
import { toGoalHistoryRows, type GoalHistoryRow } from '../modules/investments/simple/goalHistory.ts';
import NewInvestmentModal from '../modules/investments/simple/components/NewInvestmentModal.tsx';
import LinkGoalInvestmentsModal from '../modules/investments/simple/components/LinkGoalInvestmentsModal.tsx';

interface GoalDetailsViewProps {
    goal: Goal;
    onBack: () => void;
    onEdit: (goal: Goal) => void;
    /** Arquiva a meta; devolve a mensagem de erro (pt-BR) ou `null` se arquivou. */
    onDelete: (goalId: string) => Promise<string | null>;
    /** Muda o status pelo backend; devolve a mensagem de erro ou `null`. */
    onUpdateStatus: (goal: Goal, status: GoalStatus) => Promise<string | null>;
    /** Atualiza o valor acumulado de meta manual; devolve a mensagem de erro ou `null`. */
    onUpdateManualProgress: (goal: Goal, manualProgressCents: number) => Promise<string | null>;
}

const adjustBrightness = (color: string, amount: number) => {
    return '#' + color.replace(/^#/, '').replace(/../g, color => ('0'+Math.min(255, Math.max(0, parseInt(color, 16) + amount)).toString(16)).substr(-2));
}

const ARCHIVE_LINK_HINT = 'Use "Vincular Existente" para desvincular ou transferir os investimentos desta meta.';

const GoalDetailsView: React.FC<GoalDetailsViewProps> = ({ 
    goal, onBack, onEdit, onDelete, onUpdateStatus, onUpdateManualProgress
}) => {
    const { theme } = useTheme();
    const { activeWorkspace, activeWorkspaceRole } = useWorkspace();
    /*
     * "Novo Aporte" e "Vincular Existente" abrem aqui dentro (Etapa 3, §2.A).
     *
     * Até a Etapa 2, "Novo Aporte" navegava para a tela de Investimentos com a
     * meta pré-selecionada e exigia um segundo clique em "Novo investimento" —
     * a pessoa saía da meta para voltar a ela. Agora o formulário abre sobre o
     * detalhe da meta, com a meta travada, e nenhuma transação é criada
     * diretamente: o destino continua sendo `createSimpleInvestment`.
     */
    const [isContributionOpen, setContributionOpen] = useState(false);
    const [isLinkOpen, setLinkOpen] = useState(false);
    const [feedback, setFeedback] = useState<string>();
    const [actionError, setActionError] = useState<{ message: string; hint?: string } | null>(null);
    const [isStatusBusy, setStatusBusy] = useState(false);
    const [isArchiveBusy, setArchiveBusy] = useState(false);
    const busyRef = useRef(false);
    const isPJ = activeWorkspace.type === 'PJ';
    const MotionDiv = motion.div as any;
    const isInvestment = goal.progressSource === 'investment';
    const isManual = goal.progressSource === 'manual';
    const canWrite = activeWorkspaceRole === 'owner' || activeWorkspaceRole === 'admin' || activeWorkspaceRole === 'member';
    const canSeeAudit = activeWorkspaceRole === 'owner' || activeWorkspaceRole === 'admin';
    /*
     * Histórico patrimonial da meta, direto do ledger — só para meta de
     * investimentos (meta manual e indicador PJ não têm posições vinculadas).
     *
     * O sinal de cada linha vem de `goalNetContributionDeltaCents`, que é o
     * valor que o backend aplicou no progresso da meta. Derivar o sinal da
     * operação no cliente é o que fazia resgate, estorno e desvínculo entrarem
     * como aporte positivo na previsão, na linha do tempo e na tabela.
     */
    const goalMovements = useQuery<GoalHistoryRow[]>({
        queryKey: ['goal-investment-movements', activeWorkspace.id, goal.id],
        enabled: Boolean(goal.id) && isInvestment,
        queryFn: async () => toGoalHistoryRows(await listGoalInvestmentMovements(
            activeWorkspace.id,
            String(goal.id),
        )),
    });

    // Indicador PJ calculado no servidor; as demais fontes não o consultam.
    const kpiStates = useGoalKpiProgress(useMemo(
        () => (goal.progressSource === 'business_kpi' ? [goal.id] : []),
        [goal.id, goal.progressSource],
    ));
    const view = goalProgressView(goal, kpiStates.get(goal.id));
    const today = civilDateKey();
    const paceStatus = goalPaceStatus(goal, view, today);
    const readyView = view.state === 'ready' ? view : null;
    const percentBasisPoints = readyView?.percentBasisPoints ?? 0;
    const barPercent = (readyView?.barBasisPoints ?? 0) / 100;
    const progressText = readyView
        ? readyView.valueText
        : view.state === 'loading' ? 'Calculando...' : '—';
    const targetText = readyView ? readyView.targetText : goalTargetText(goal);
    const statusMessage = view.state === 'error' || view.state === 'unavailable' ? view.message : '';
    const cashNote = businessTypeNeedsCashNote(goal.businessType) ? GOAL_CASH_REGIME_NOTE : '';
    const progressCents = readyView && readyView.unit === 'cents' ? readyView.value : 0;
    const targetCents = goal.targetAmountCents ?? 0;

    const runGuarded = async (
        setBusy: (busy: boolean) => void,
        action: () => Promise<string | null>,
        hint?: string,
    ): Promise<boolean> => {
        if (busyRef.current) return false;
        busyRef.current = true;
        setBusy(true);
        setActionError(null);
        setFeedback(undefined);
        try {
            const message = await action();
            if (message) {
                setActionError({ message, hint });
                return false;
            }
            return true;
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    const handleStatus = async (status: GoalStatus) => {
        if (goal.status === status) return;
        const ok = await runGuarded(setStatusBusy, () => onUpdateStatus(goal, status));
        if (ok && status === 'alcancada') {
            confetti({ particleCount: 150, spread: 70, origin: { y: 0.6 }, colors: [goal.visual.color, '#ffffff'] });
        }
    };

    const handleArchive = () => {
        void runGuarded(setArchiveBusy, () => onDelete(goal.id), isInvestment ? ARCHIVE_LINK_HINT : undefined);
    };

    // --- Valor acumulado informado pelo usuário (meta manual) ---
    const [isManualEditing, setManualEditing] = useState(false);
    const [manualInput, setManualInput] = useState('');
    const [manualError, setManualError] = useState<string | null>(null);
    const [isManualSaving, setManualSaving] = useState(false);
    const manualHistory = useGoalManualHistory(goal.id, isManual && canSeeAudit);

    const openManualEditor = () => {
        setManualInput('');
        setManualError(null);
        setFeedback(undefined);
        setManualEditing(true);
    };

    const submitManual = async (event: React.FormEvent) => {
        event.preventDefault();
        if (busyRef.current) return;
        const cents = parseReaisToCents(manualInput, { allowZero: true });
        if (cents === null) {
            setManualError('Informe o valor acumulado em reais, com até duas casas decimais (zero vale).');
            return;
        }
        setManualError(null);
        busyRef.current = true;
        setManualSaving(true);
        try {
            const message = await onUpdateManualProgress(goal, cents);
            if (message) {
                setManualError(message);
            } else {
                setManualEditing(false);
                setManualInput('');
                setFeedback('Valor acumulado atualizado.');
            }
        } finally {
            busyRef.current = false;
            setManualSaving(false);
        }
    };

    const manualPanel = (
        <div className="flex flex-col min-h-0">
            <div className="flex justify-between items-center mb-4 gap-2 flex-wrap">
                <h3 className="font-bold text-lg text-gray-800 dark:text-white flex items-center gap-2"><HistoryIcon className="h-5 w-5 text-gray-400" /> Valor acumulado</h3>
                {canWrite && !isManualEditing && goal.status !== 'cancelada' && (
                    <button type="button" onClick={openManualEditor} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors">Atualizar valor acumulado</button>
                )}
            </div>
            {feedback && (
                <div role="status" className="mb-3 rounded-lg border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-900/20 px-3 py-2 text-sm text-green-700 dark:text-green-300">
                    {feedback}
                </div>
            )}
            {isManualEditing && (
                <form onSubmit={submitManual} className="mb-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-dark-100 p-4 space-y-3">
                    <div>
                        <label htmlFor="goal-manual-progress" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Novo valor acumulado (R$)</label>
                        <input
                            id="goal-manual-progress"
                            type="text"
                            inputMode="decimal"
                            value={manualInput}
                            onChange={(event) => setManualInput(event.target.value)}
                            placeholder="Ex: 1.500,00"
                            autoFocus
                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 dark:bg-dark-200 dark:text-white"
                        />
                        <p className="text-xs text-gray-500 mt-1">O valor substitui o acumulado atual ({formatCents(goal.manualProgressCents ?? 0)}). Não cria lançamento nem move conta.</p>
                    </div>
                    {manualError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{manualError}</p>}
                    <div className="flex justify-end gap-2">
                        <button type="button" disabled={isManualSaving} onClick={() => { setManualEditing(false); setManualError(null); }} className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-dark-200 text-gray-700 dark:text-gray-300 rounded-lg">Cancelar</button>
                        <button type="submit" disabled={isManualSaving} className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-lg font-medium">{isManualSaving ? 'Salvando...' : 'Salvar valor'}</button>
                    </div>
                </form>
            )}
            <div className="bg-white dark:bg-dark-100 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 space-y-3">
                <p className="text-sm text-gray-600 dark:text-gray-300">
                    Atualizado em {formatInstantDate(goal.manualProgressUpdatedAt)}
                </p>
                {canSeeAudit && (
                    manualHistory.isError ? (
                        <p role="alert" className="text-sm text-red-600 dark:text-red-400">Não foi possível carregar o histórico de atualizações.</p>
                    ) : manualHistory.isLoading ? (
                        <p className="text-sm text-gray-400">Carregando histórico...</p>
                    ) : (manualHistory.data ?? []).length > 0 ? (
                        <ul aria-label="Histórico de atualizações do valor acumulado" className="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
                            {(manualHistory.data ?? []).map((entry) => (
                                <li key={entry.id} className="flex justify-between gap-3 py-2">
                                    <span className="text-gray-500 dark:text-gray-400">{formatInstantDate(entry.timestamp)}</span>
                                    <span className="font-medium text-gray-800 dark:text-gray-200 text-right">{formatCents(entry.beforeCents)} → {formatCents(entry.afterCents)}</span>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <p className="text-sm text-gray-400">Nenhuma atualização manual registrada.</p>
                    )
                )}
            </div>
        </div>
    );

    const investmentButtons = (
        <div className="flex gap-2">
            <button type="button" onClick={() => { setFeedback(undefined); setLinkOpen(true); }} className="text-xs bg-gray-100 hover:bg-gray-200 dark:bg-dark-200 dark:hover:bg-dark-300 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-lg transition-colors">Vincular Existente</button>
            <button type="button" onClick={() => { setFeedback(undefined); setContributionOpen(true); }} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"><PlusIcon className="h-3 w-3" /> Novo Aporte</button>
        </div>
    );

    const investmentModals = isInvestment ? (
        <>
            <NewInvestmentModal
                open={isContributionOpen}
                workspaceId={activeWorkspace.id}
                goals={[goal]}
                initialGoalId={String(goal.id)}
                goalLocked
                onClose={() => setContributionOpen(false)}
                onSuccess={setFeedback}
            />

            <LinkGoalInvestmentsModal
                open={isLinkOpen}
                workspaceId={activeWorkspace.id}
                goalId={String(goal.id)}
                goalName={goal.name}
                role={activeWorkspaceRole}
                onClose={() => setLinkOpen(false)}
                onSuccess={setFeedback}
            />
        </>
    ) : null;

    const actionBanner = actionError && (
        <div role="alert" className="mb-4 rounded-lg border border-red-200 dark:border-red-900/40 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            <p>{actionError.message}</p>
            {actionError.hint && <p className="mt-1">{actionError.hint}</p>}
        </div>
    );

    const darkerColor = adjustBrightness(goal.visual.color, -50);
    const gradientStyle = `radial-gradient(circle at top left, rgba(255,255,255,0.2) 0%, transparent 40%), linear-gradient(135deg, ${goal.visual.color} 0%, ${darkerColor} 100%)`;

    // --- PF SPECIFIC RENDER (RESTAURADO) ---
    if (!isPJ) {
        const statusOptions = [
            { key: 'em_andamento', label: 'Retomar', activeLabel: 'Em Andamento', icon: 'PlayerPlay', color: 'blue' },
            { key: 'pausada', label: 'Pausar', activeLabel: 'Pausada', icon: 'PlayerPause', color: 'yellow' },
            { key: 'alcancada', label: 'Concluir', activeLabel: 'Concluída', icon: 'Check', color: 'green' },
            { key: 'cancelada', label: 'Cancelar', activeLabel: 'Cancelada', icon: 'X', color: 'red' }
        ];

        /*
         * INV-P2-029 — a lista de movimentações e o número do progresso saem da
         * mesma fonte: os movimentos do ledger vinculados à meta.
         */
        const goalTransactions = (goalMovements.data ?? [])
            .map((row) => ({
                ...row,
                /** Data civil (AAAA-MM-DD) em São Paulo, ou vazio se desconhecida. */
                date: row.occurredAt ? civilDateKey(row.occurredAt) : '',
            }))
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
        const movementFacts: GoalMovementFact[] = goalTransactions
            .filter((row) => row.effective)
            .map((row) => ({ dateKey: row.date, impactCents: row.impactCents }));

        const remainingCents = Math.max(0, targetCents - progressCents);
        const reachedTarget = Boolean(readyView?.achieved);

        const monthlySuggestion = goal.status !== 'em_andamento' || reachedTarget
            ? 0
            : monthlySuggestionCents(targetCents, progressCents, goal.deadline, today);

        const forecast = reachedTarget || goal.status !== 'em_andamento' || !isInvestment
            ? null
            : goalForecastLabel(movementFacts, remainingCents, today);

        const timelineEvents = goalTimelineEvents({
            startDate: goal.startDate,
            status: goal.status,
            statusUpdatedAt: goal.statusUpdatedAt,
            targetCents,
            progressCents,
            achieved: reachedTarget,
        }, isInvestment ? movementFacts : [], today);

        return (
            <div className="h-full flex flex-col animate-fade-in pb-10">
                {/* Header / Nav */}
                <div className="flex items-center justify-between mb-6 flex-shrink-0 flex-wrap gap-4">
                    <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white transition-colors">
                        <BackIcon className="h-5 w-5" /> Voltar
                    </button>
                    <div className="flex items-center gap-3">
                        <div className="flex bg-gray-100 dark:bg-dark-200 rounded-lg p-1">
                             {statusOptions.map((option) => {
                                 const isActive = goal.status === option.key;
                                 let activeClass = '';
                                 if (isActive) {
                                     if(option.color === 'blue') { activeClass = "bg-white dark:bg-blue-600 text-blue-600 dark:text-white shadow-sm"; }
                                     if(option.color === 'yellow') { activeClass = "bg-white dark:bg-yellow-600 text-yellow-600 dark:text-white shadow-sm"; }
                                     if(option.color === 'green') { activeClass = "bg-white dark:bg-green-600 text-green-600 dark:text-white shadow-sm"; }
                                     if(option.color === 'red') { activeClass = "bg-white dark:bg-red-600 text-red-600 dark:text-white shadow-sm"; }
                                 } else {
                                     activeClass = "text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 hover:bg-white/50 dark:hover:bg-dark-300";
                                 }
                                 return (
                                     <button
                                         key={option.key}
                                         type="button"
                                         onClick={() => { if (!isActive) void handleStatus(option.key as GoalStatus); }}
                                         disabled={isStatusBusy}
                                         aria-label={isActive ? option.activeLabel : option.label}
                                         aria-pressed={isActive}
                                         className={`p-2 rounded-md transition-all flex items-center justify-center gap-2 text-sm font-medium disabled:opacity-60 ${activeClass}`}
                                         title={isActive ? option.activeLabel : option.label}
                                     >
                                         <DynamicIcon name={option.icon} size={18} />
                                         {isActive && <span className="hidden sm:inline">{option.activeLabel}</span>}
                                     </button>
                                 );
                            })}
                        </div>
                        <div className="h-6 w-px bg-gray-200 dark:bg-gray-700"></div>
                        <button type="button" onClick={() => onEdit(goal)} aria-label="Editar meta" title="Editar meta" className="p-2 bg-gray-100 text-gray-700 dark:bg-dark-200 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-dark-300 transition-colors"><EditIcon className="h-4 w-4" /></button>
                        <button type="button" onClick={handleArchive} disabled={isArchiveBusy} aria-label="Arquivar meta" title="Arquivar meta" className="p-2 bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors disabled:opacity-60"><DeleteIcon className="h-4 w-4" /></button>
                    </div>
                </div>

                {actionBanner}

                {/* Hero Section */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                    <div className="lg:col-span-2 bg-white dark:bg-dark-100 rounded-2xl p-6 shadow-md border border-gray-100 dark:border-gray-700 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-transparent to-white/10 rounded-full blur-3xl transform translate-x-1/2 -translate-y-1/2 pointer-events-none" style={{ backgroundColor: `${goal.visual.color}20` }} />
                        <div className="flex items-start gap-5 relative z-10">
                            <div className="w-20 h-20 rounded-2xl flex items-center justify-center shadow-lg border-4 border-white dark:border-dark-100" style={{ background: gradientStyle, color: '#fff' }}>
                                <div className="w-10 h-10 flex items-center justify-center">
                                    {goal.status === 'alcancada' ? <CheckIcon className="w-full h-full" /> : <DynamicIcon name={goal.visual.icon} className="w-full h-full" />}
                                </div>
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-3 mb-1">
                                    <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider bg-gray-100 dark:bg-dark-200 text-gray-500">{goal.category.replace('_', ' ')}</span>
                                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${goal.priority === 'alta' ? 'bg-red-100 text-red-600' : goal.priority === 'media' ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'}`}>Prioridade {goal.priority}</span>
                                </div>
                                <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">{goal.visual.emoji} {goal.name}</h1>
                                <p className="text-gray-500 dark:text-gray-400 text-sm max-w-lg">{goal.description || 'Sem descrição.'}</p>
                            </div>
                        </div>
                        <div className="mt-8 relative z-10">
                            <div className="flex justify-between items-end mb-2">
                                <div><span className="text-sm text-gray-500 dark:text-gray-400">Progresso Atual</span><div className="text-3xl font-bold text-gray-800 dark:text-white flex items-baseline gap-2">{progressText}<span className="text-sm font-medium text-gray-400">/ {targetText}</span></div></div>
                                <div className="text-right"><span className="text-2xl font-bold" style={{ color: goal.visual.color }}>{readyView ? formatBasisPoints(percentBasisPoints) : ''}</span></div>
                            </div>
                            <div className="h-4 bg-gray-100 dark:bg-dark-200 rounded-full overflow-hidden">
                                <MotionDiv className="h-full rounded-full relative" initial={{ width: 0 }} animate={{ width: `${barPercent}%` }} transition={{ duration: 1 }} style={{ backgroundColor: goal.visual.color }}><div className="absolute inset-0 bg-white/20 animate-pulse"></div></MotionDiv>
                            </div>
                            <div className="flex justify-between mt-2 text-xs font-medium text-gray-500 dark:text-gray-400"><span>Início: {formatCivilDate(goal.startDate)}</span><span>Prazo: {formatCivilDate(goal.deadline)}</span></div>
                        </div>
                    </div>

                    <div className="grid grid-rows-3 gap-4">
                        <div className="bg-white dark:bg-dark-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-4">
                            <div className="p-3 bg-red-50 text-red-500 dark:bg-red-900/20 rounded-lg"><TargetIcon className="h-6 w-6" /></div>
                            <div><span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold">Falta Acumular</span><div className="text-lg font-bold text-gray-800 dark:text-white">{remainingCents > 0 ? formatCents(remainingCents) : 'Alvo atingido!'}</div></div>
                        </div>
                        <div className="bg-white dark:bg-dark-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-4">
                            <div className="p-3 bg-indigo-50 text-indigo-500 dark:bg-indigo-900/20 rounded-lg"><TrendingUpIcon className="h-6 w-6" /></div>
                            <div><span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold">Sugestão Mensal</span><div className="text-lg font-bold text-gray-800 dark:text-white">{monthlySuggestion > 0 ? formatCents(monthlySuggestion) : '-'}</div></div>
                        </div>
                        <div className="bg-white dark:bg-dark-100 rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 flex items-center gap-4">
                            <div className="p-3 bg-purple-50 text-purple-500 dark:bg-purple-900/20 rounded-lg"><ClockIcon className="h-6 w-6" /></div>
                            <div><span className="text-xs text-gray-500 dark:text-gray-400 uppercase font-bold">Estimativa de Fim</span><div className="text-lg font-bold text-gray-800 dark:text-white">{forecast || '-'}</div></div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 min-h-0">
                    {isManual ? (
                        <div className="lg:col-span-2 flex flex-col min-h-0">{manualPanel}</div>
                    ) : (
                    <div className="lg:col-span-2 flex flex-col min-h-0">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg text-gray-800 dark:text-white flex items-center gap-2"><HistoryIcon className="h-5 w-5 text-gray-400" /> Histórico de investimentos</h3>
                            {investmentButtons}
                        </div>
                        {feedback && (
                            <div role="status" className="mb-3 rounded-lg border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-900/20 px-3 py-2 text-sm text-green-700 dark:text-green-300">
                                {feedback}
                            </div>
                        )}
                        <div className="bg-white dark:bg-dark-100 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex-1 overflow-hidden flex flex-col">
                            <div className="overflow-y-auto custom-scrollbar flex-1">
                                {goalTransactions.length > 0 ? (
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-gray-50 dark:bg-dark-200 text-gray-500 dark:text-gray-400 font-medium sticky top-0"><tr><th className="px-5 py-3">Descrição</th><th className="px-5 py-3">Categoria</th><th className="px-5 py-3">Data</th><th className="px-5 py-3 text-right">Valor</th></tr></thead>
                                        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                            {goalTransactions.map(t => (
                                                /*
                                                 * O que a linha mostra é o fato, não a operação
                                                 * técnica (Etapa 3, §2.B): "Aporte depositado",
                                                 * "Retirada aguardando recebimento". O lançamento
                                                 * que ainda não moveu o progresso aparece em
                                                 * cinza, com o valor do lançamento e sem sinal —
                                                 * um "+ R$ 0,00" seria uma promessa que a meta
                                                 * ainda não recebeu.
                                                 */
                                                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-dark-200 transition-colors">
                                                    <td className="px-5 py-3 text-gray-800 dark:text-gray-200 font-medium">
                                                        {t.description}
                                                    </td>
                                                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{t.label}</td>
                                                    <td className="px-5 py-3 text-gray-500 dark:text-gray-400">{formatCivilDate(t.date)}</td>
                                                    <td className={`px-5 py-3 text-right font-bold ${t.effective ? 'text-gray-800 dark:text-white' : 'text-gray-400 dark:text-gray-500'}`}>
                                                        {t.effective
                                                            ? `${t.impactCents < 0 ? '−' : '+'} ${formatCents(Math.abs(t.impactCents))}`
                                                            : formatCents(t.valueCents)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-48 text-gray-400"><PiggyBankIcon className="h-10 w-10 mb-2 opacity-50" /><p>Nenhum investimento vinculado ainda.</p></div>
                                )}
                            </div>
                            {goalTransactions.length > 0 && (<div className="p-4 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-dark-200/50 flex justify-between items-center"><span className="text-sm font-medium text-gray-600 dark:text-gray-300">Progresso Atual</span><span className="text-lg font-bold text-gray-800 dark:text-white">{progressText}</span></div>)}
                        </div>
                    </div>
                    )}
                    <div className="flex flex-col min-h-0">
                        <h3 className="font-bold text-lg text-gray-800 dark:text-white mb-4">Linha do Tempo</h3>
                        <div className="bg-white dark:bg-dark-100 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 flex-1 overflow-y-auto custom-scrollbar">
                            <div className="relative border-l-2 border-gray-200 dark:border-gray-700 ml-3 space-y-8">
                                {timelineEvents.map((event, idx) => (
                                    <div key={idx} className="relative pl-8">
                                        <div className={`absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white dark:border-dark-100 shadow-sm ${event.type === 'start' ? 'bg-gray-400' : event.type === 'milestone' ? 'bg-indigo-500' : event.type === 'completion' ? 'bg-green-500' : 'bg-blue-400'}`}></div>
                                        <div>
                                            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{formatCivilDate(event.date)}</span>
                                            <h4 className="font-bold text-gray-800 dark:text-white mt-0.5">{event.title}</h4>
                                            {event.valueCents > 0 && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{event.type === 'deposit' ? `+ ${formatCents(event.valueCents)}` : `Saldo: ${formatCents(event.valueCents)}`}</p>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/*
                  Modais da meta. `createSimpleInvestment` continua sendo o
                  único destino do aporte — nenhuma transação é escrita aqui —,
                  e o vínculo retroativo usa as operações autoritativas de meta.
                */}
                {investmentModals}
            </div>
        );
    }

    // --- PJ MODE RENDER (EXISTENTE) ---
    const paceLabel = paceStatus === 'on_track' || paceStatus === 'completed'
        ? 'No Ritmo'
        : paceStatus === 'warning'
            ? 'Atenção'
            : paceStatus === 'neutral' ? '—' : 'Fora do Ritmo';
    const periodWindow = readyView?.window;
    return (
        <div className="h-full flex flex-col animate-fade-in pb-10">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                <button type="button" onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-gray-800 transition-colors">
                    <BackIcon className="h-5 w-5" /> Voltar para Metas
                </button>
                <div className="flex items-center gap-3">
                    <button type="button" onClick={() => onEdit(goal)} className="p-2 bg-gray-100 text-gray-700 dark:bg-dark-200 rounded-lg hover:bg-gray-200 transition-colors" title="Editar" aria-label="Editar meta">
                        <EditIcon className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={handleArchive} disabled={isArchiveBusy} className="p-2 bg-red-50 text-red-600 dark:bg-red-900/20 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-60" title="Arquivar" aria-label="Arquivar meta">
                        <DeleteIcon className="h-4 w-4" />
                    </button>
                </div>
            </div>

            {actionBanner}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                <div className="lg:col-span-2 bg-white dark:bg-dark-100 rounded-2xl p-8 shadow-md border border-gray-100 dark:border-gray-700 relative overflow-hidden">
                    <div className="flex items-start gap-6 relative z-10">
                        <div className="w-24 h-24 rounded-3xl flex items-center justify-center shadow-lg border-4 border-white dark:border-dark-100" style={{ background: gradientStyle, color: '#fff' }}>
                            <DynamicIcon name={goal.visual.icon} size={48} />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <span className="px-2.5 py-1 rounded text-[10px] uppercase font-bold tracking-widest bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
                                    {isPJ && goal.businessType ? `Empresa • ${businessTypeLabel(goal.businessType)}` : goal.category.replace('_', ' ')}
                                </span>
                                {goal.period && <span className="px-2.5 py-1 rounded text-[10px] uppercase font-bold bg-gray-100 text-gray-600">{goal.period}</span>}
                            </div>
                            <h1 className="text-4xl font-black text-gray-800 dark:text-white mb-2">{goal.name}</h1>
                            {goal.costCenter && (
                                <p className="text-sm font-bold text-primary flex items-center gap-2 mb-3">
                                    <BuildingIcon className="w-4 h-4" /> Centro de custo: {goal.costCenter}
                                </p>
                            )}
                            <p className="text-gray-500 dark:text-gray-400 text-sm">{goal.description}</p>
                        </div>
                    </div>

                    <div className="mt-10">
                        <div className="flex justify-between items-end mb-3">
                            <div>
                                <span className="text-sm font-bold text-gray-400 uppercase tracking-widest">Atual</span>
                                <div className="text-4xl font-black text-gray-800 dark:text-white">{progressText}</div>
                            </div>
                            <div className="text-right">
                                <span className="text-sm font-bold text-gray-400 uppercase tracking-widest">Objetivo</span>
                                <div className="text-2xl font-bold text-gray-400">{targetText}</div>
                            </div>
                        </div>
                        {statusMessage && (
                            <p role="status" className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{statusMessage}</p>
                        )}
                        <div className="h-5 bg-gray-100 dark:bg-dark-200 rounded-full overflow-hidden relative">
                            <MotionDiv className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${barPercent}%` }} transition={{ duration: 1 }} style={{ backgroundColor: readyView?.overLimit ? '#ef4444' : goal.visual.color }} />
                        </div>
                        <div className="flex justify-between mt-3 text-xs font-bold text-gray-400 uppercase">
                            <span>Início: {formatCivilDate(goal.startDate)}</span>
                            <span>Prazo: {formatCivilDate(goal.deadline)}</span>
                        </div>
                        {readyView?.asOf && (
                            <p className="mt-2 text-xs text-gray-500">Saldo em {formatInstantDate(readyView.asOf)}.</p>
                        )}
                        {cashNote && <p className="mt-2 text-xs text-gray-500">{cashNote}</p>}
                        {goal.costCenter && goal.progressSource === 'business_kpi' && (
                            <p className="mt-2 text-xs text-gray-500">{GOAL_COST_CENTER_KPI_NOTE}</p>
                        )}
                    </div>
                </div>

                <div className="grid grid-rows-3 gap-4">
                    <div className="bg-white dark:bg-dark-100 rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-4">
                        <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl"><TargetIcon className="h-6 w-6" /></div>
                        <div>
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Status do Ritmo</span>
                            <p className={`text-lg font-black uppercase ${paceStatus === 'on_track' || paceStatus === 'completed' ? 'text-green-600' : paceStatus === 'neutral' ? 'text-gray-400' : 'text-red-500'}`}>
                                {paceLabel}
                            </p>
                        </div>
                    </div>
                    {isPJ && periodWindow && (
                         <div className="bg-white dark:bg-dark-100 rounded-2xl p-5 shadow-sm border border-gray-100 flex items-center gap-4">
                            <div className="p-3 bg-purple-50 text-purple-600 rounded-xl"><ClockIcon className="h-6 w-6" /></div>
                            <div>
                                <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest block">Período Vigente</span>
                                <p className="text-sm font-bold text-gray-800 dark:text-white">
                                    {formatCivilDate(periodWindow.startDate)} até {formatCivilDate(periodWindow.endDate)}
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {isInvestment && (
                <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                        <h3 className="font-bold text-lg text-gray-800 dark:text-white flex items-center gap-2"><HistoryIcon className="h-5 w-5 text-gray-400" /> Investimentos da meta</h3>
                        {investmentButtons}
                    </div>
                    {feedback && (
                        <div role="status" className="rounded-lg border border-green-200 dark:border-green-900/40 bg-green-50 dark:bg-green-900/20 px-3 py-2 text-sm text-green-700 dark:text-green-300">
                            {feedback}
                        </div>
                    )}
                </div>
            )}
            {isManual && manualPanel}
            {investmentModals}
        </div>
    );
};

export default GoalDetailsView;
