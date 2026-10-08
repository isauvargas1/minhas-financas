import React, { useMemo, useRef, useState } from 'react';
import { motion, type MotionProps } from 'framer-motion';
import {
    useCancelRecurringExpense,
    useConfirmRecurringOccurrence,
    useIgnoreRecurringOccurrence,
    useOpenRecurringOccurrences,
    usePauseRecurringExpense,
    useRecurringAmountHistory,
    useRecurringExpense,
    useRecurringIntentKey,
    useRecurringOccurrences,
    useResumeRecurringExpense,
    useRetryRecurringOccurrence,
    useUpdateRecurringExpense,
} from '../modules/recurring/hooks.ts';
import { civilDaysBetween, dueDatesBetween, addCivilDays } from '../modules/recurring/schedule.ts';
import { actualAmountToCents, centsToNumberInput } from '../modules/recurring/payloads.ts';
import {
    ATTENTION_MESSAGES,
    EXECUTION_MODE_LABELS,
    FREQUENCY_LABELS,
    OCCURRENCE_STATUS_LABELS,
    RECURRING_STATUS_LABELS,
    RECURRING_TYPE_LABELS,
    TARGET_LABELS,
    dayBadgeParts,
    factStateLabel,
    formatDayLong,
    recurringErrorView,
    recurringPermissions,
} from '../modules/recurring/presentation.ts';
import { RECURRING_AMOUNT_HISTORY_LIMIT, RECURRING_OPEN_OCCURRENCES_LIMIT } from '../modules/recurring/api.ts';
import type { RecurringOccurrence, RecurringStatus } from '../modules/recurring/types.ts';
import { formatCents, formatDayKey, saoPauloToday } from '../modules/loans/money.ts';
import { BackIcon, DynamicIcon, CalendarIcon, WarningIcon, TrendingUpIcon, BuildingIcon } from './Icons.tsx';
import CashAccountSelect from './accounts/CashAccountSelect.tsx';
import ConfirmationModal from './ConfirmationModal.tsx';
import RecurringExpenseFormModal from './RecurringExpenseFormModal.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useAuth } from '../contexts/AuthContext.tsx';
import { CreditCard } from '../types.ts';

interface RecurringExpenseDetailsViewProps {
    expenseId: string;
    onBack: () => void;
    creditCards: CreditCard[];
}

const listVariants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.05
        }
    }
};

const itemVariants = {
    hidden: { opacity: 0, x: -10 },
    show: { opacity: 1, x: 0 }
};

const MotionDiv = motion.div as React.ComponentType<React.HTMLAttributes<HTMLDivElement> & MotionProps>;

/** Próximos vencimentos projetados (sem materializar o futuro). */
const PROJECTION_COUNT = 6;

type OccurrenceAction = 'card' | 'pending' | 'paid' | 'retry' | 'ignore';

interface ActivePanel {
    occurrence: RecurringOccurrence;
    action: OccurrenceAction;
}

/**
 * Detalhes da recorrência (P4-B). Toda ação passa pelas callables de
 * Recorrentes — edição, reajuste, pausa, retomada, cancelamento e as ações
 * das ocorrências (confirmar, gerar pendente, registrar pago, tentar de novo,
 * ignorar). Nenhum lançamento é criado por aqui direto no Caixa nem no
 * Cartão: o backend gera o fato no domínio de destino.
 */
const RecurringExpenseDetailsView: React.FC<RecurringExpenseDetailsViewProps> = ({ expenseId, onBack, creditCards }) => {
    const { activeWorkspace, activeWorkspaceRole } = useWorkspace();
    const { user } = useAuth();
    const isPJ = activeWorkspace.type === 'PJ';

    const { data: expense, isLoading: isExpenseLoading } = useRecurringExpense(expenseId);
    const {
        data: openData,
        isLoading: isOpenLoading,
        isTruncated: isOpenTruncated,
    } = useOpenRecurringOccurrences(expenseId);
    const {
        data: historyData,
        hasNextPage: hasMoreHistory,
        fetchNextPage: fetchMoreHistory,
        isFetchingNextPage: isFetchingMoreHistory,
        facts,
    } = useRecurringOccurrences(expenseId);
    const { data: amountHistory, isTruncated: isAmountHistoryTruncated } = useRecurringAmountHistory(expenseId);
    const openOccurrences = useMemo(() => openData ?? [], [openData]);
    const pastOccurrences = useMemo(() => historyData ?? [], [historyData]);
    const { playSound } = useTheme();

    const updateMutation = useUpdateRecurringExpense();
    const pauseMutation = usePauseRecurringExpense();
    const resumeMutation = useResumeRecurringExpense();
    const cancelMutation = useCancelRecurringExpense();
    const confirmMutation = useConfirmRecurringOccurrence();
    const ignoreMutation = useIgnoreRecurringOccurrence();
    const retryMutation = useRetryRecurringOccurrence();
    const intent = useRecurringIntentKey();

    // Adjustment State
    const [isAdjusting, setIsAdjusting] = useState(false);
    const [newPrice, setNewPrice] = useState('');
    const [adjustmentNote, setAdjustmentNote] = useState('');
    const [isEditOpen, setIsEditOpen] = useState(false);
    const [isCancelOpen, setIsCancelOpen] = useState(false);
    const [panel, setPanel] = useState<ActivePanel | null>(null);
    const [panelAmount, setPanelAmount] = useState('');
    const [panelAccountId, setPanelAccountId] = useState('');
    const [panelCardId, setPanelCardId] = useState('');
    const [panelDate, setPanelDate] = useState('');
    const [actionError, setActionError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);

    if (isExpenseLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
            </div>
        );
    }

    if (!expense) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-3">
                <p className="text-muted text-sm">Despesa recorrente não encontrada.</p>
                <button onClick={onBack} className="text-primary text-sm font-medium hover:underline">
                    Voltar para {isPJ ? 'Contratos' : 'Recorrências'}
                </button>
            </div>
        );
    }

    const { canManage } = recurringPermissions(activeWorkspaceRole, user?.uid, expense);
    const editable = expense.status === 'active' || expense.status === 'paused';
    const today = saoPauloToday();

    // Logic: Expiring Soon
    const isExpiringSoon = () => {
        if (!expense.endDate) return false;
        const diffDays = civilDaysBetween(today, expense.endDate);
        return diffDays > 0 && diffDays <= 45;
    };

    /**
     * Executa uma callable com a chave da intenção; duplo clique é barrado
     * de forma síncrona. Erro do backend aparece em pt-BR.
     */
    const run = async (
        operation: string,
        payload: Record<string, unknown>,
        mutation: { mutateAsync: (input: { payload: Record<string, unknown>; idempotencyKey: string }) => Promise<unknown> },
        onDone?: () => void,
    ) => {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setActionError(null);
        try {
            await mutation.mutateAsync({ payload, idempotencyKey: intent.keyFor(operation, payload) });
            intent.reset();
            onDone?.();
            playSound('success');
        } catch (failure) {
            setActionError(recurringErrorView(failure).message);
        } finally {
            busyRef.current = false;
            setBusy(false);
        }
    };

    const lifecyclePayload = () => ({
        recurringExpenseId: expense.id,
        expectedUpdatedAt: expense.version,
    });

    const handleAdjustPrice = (e: React.FormEvent) => {
        e.preventDefault();
        let amountCents: number;
        try {
            amountCents = actualAmountToCents(newPrice);
        } catch (validation) {
            setActionError(recurringErrorView(validation).message);
            return;
        }
        const reason = adjustmentNote.trim();
        void run('updateRecurringExpense', {
            ...lifecyclePayload(),
            changes: { amountCents },
            ...(reason ? { reason } : {}),
        }, updateMutation, () => {
            setIsAdjusting(false);
            setNewPrice('');
            setAdjustmentNote('');
        });
    };

    const openPanel = (occurrence: RecurringOccurrence, action: OccurrenceAction) => {
        intent.reset();
        setActionError(null);
        setPanel({ occurrence, action });
        setPanelAmount(centsToNumberInput(occurrence.plannedAmountCents));
        setPanelAccountId(occurrence.cashAccountId ?? '');
        setPanelCardId(occurrence.cardId ?? '');
        setPanelDate(today);
    };

    const submitPanel = (e: React.FormEvent) => {
        e.preventDefault();
        if (!panel) return;
        const { occurrence, action } = panel;
        const base = { occurrenceId: occurrence.id };
        if (action === 'ignore') {
            void run('ignoreRecurringOccurrence', base, ignoreMutation, () => setPanel(null));
            return;
        }
        if (action === 'retry') {
            const target = occurrence.targetDomain === 'card'
                ? (panelCardId && panelCardId !== occurrence.cardId ? { cardId: panelCardId } : {})
                : (panelAccountId && panelAccountId !== occurrence.cashAccountId ? { cashAccountId: panelAccountId } : {});
            void run('retryRecurringOccurrence', { ...base, ...target }, retryMutation, () => setPanel(null));
            return;
        }
        let amountCents: number;
        try {
            amountCents = actualAmountToCents(panelAmount);
        } catch (validation) {
            setActionError(recurringErrorView(validation).message);
            return;
        }
        const payload: Record<string, unknown> = { ...base, amountCents };
        if (action === 'pending' || action === 'paid') {
            payload.settlement = action;
            if (panelAccountId && panelAccountId !== occurrence.cashAccountId) {
                payload.cashAccountId = panelAccountId;
            }
            if (action === 'paid') payload.paidDate = panelDate;
        }
        void run('confirmRecurringOccurrence', payload, confirmMutation, () => setPanel(null));
    };

    const getStatusBadge = (status: RecurringStatus) => {
        switch (status) {
            case 'active':
                return <span className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded text-xs font-bold uppercase">{RECURRING_STATUS_LABELS.active}</span>;
            case 'paused':
                return <span className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 px-2 py-0.5 rounded text-xs font-bold uppercase">{RECURRING_STATUS_LABELS.paused}</span>;
            case 'ended':
                return <span className="bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300 px-2 py-0.5 rounded text-xs font-bold uppercase">{RECURRING_STATUS_LABELS.ended}</span>;
            case 'cancelled':
                return <span className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded text-xs font-bold uppercase">{RECURRING_STATUS_LABELS.cancelled}</span>;
            default:
                return null;
        }
    };

    // Ocorrências que pedem ação e histórico vêm do backend (consultas
    // filtradas no servidor); os próximos vencimentos são projetados pela
    // agenda pura, a partir do próximo vencimento do contrato.
    const materialized = new Set([...openOccurrences, ...pastOccurrences].map(o => o.dueDate));
    const projected = expense.status === 'active' && expense.nextDueDate
        ? dueDatesBetween(expense, expense.nextDueDate, addCivilDays(expense.nextDueDate, 3 * 366), PROJECTION_COUNT)
            .filter(dueDate => !materialized.has(dueDate))
        : [];
    const priceChanges = (amountHistory ?? []).filter(change => change.previousCents !== null);
    const scheduleLabel = expense.billingDay !== null
        ? `Dia ${expense.billingDay}`
        : expense.frequency === 'weekly' ? 'A cada 7 dias' : 'A cada 15 dias';

    const smallButton = 'text-[10px] px-2 py-1 rounded transition-colors font-bold uppercase disabled:opacity-60';
    const panelInputClass = 'border border-border rounded px-2 py-1.5 text-sm w-full bg-surface text-on-surface';
    const panelLabelClass = 'block text-xs text-muted mb-1';

    const renderPanel = () => {
        if (!panel) return null;
        const { occurrence, action } = panel;
        const titles: Record<OccurrenceAction, string> = {
            card: 'Confirmar compra no cartão',
            pending: 'Gerar despesa pendente no Caixa',
            paid: 'Registrar como paga agora',
            retry: 'Tentar de novo',
            ignore: 'Ignorar ocorrência',
        };
        const confirmLabels: Record<OccurrenceAction, string> = {
            card: 'Confirmar compra',
            pending: 'Gerar pendente',
            paid: 'Registrar pagamento',
            retry: 'Tentar de novo',
            ignore: 'Ignorar',
        };
        return (
            <form onSubmit={submitPanel} className="mt-3 p-4 bg-background rounded-lg border border-border space-y-3" aria-label={titles[action]}>
                <h4 className="text-sm font-bold text-on-surface">{titles[action]}</h4>
                {action === 'ignore' && (
                    <p className="text-xs text-muted">Nada será lançado para o vencimento de {formatDayLong(occurrence.dueDate)}. Esta ação não pode ser desfeita.</p>
                )}
                {action === 'pending' && (
                    <p className="text-xs text-muted">A despesa entra no Caixa como pendente, sem movimentar a conta; o pagamento é confirmado depois.</p>
                )}
                {(action === 'card' || action === 'pending' || action === 'paid') && (
                    <div>
                        <label htmlFor="occurrence-amount" className={panelLabelClass}>{action === 'paid' ? 'Valor pago' : 'Valor real'}</label>
                        <input id="occurrence-amount" type="number" step="0.01" value={panelAmount} onChange={e => setPanelAmount(e.target.value)} className={panelInputClass} placeholder="0.00" required />
                    </div>
                )}
                {(action === 'pending' || action === 'paid' || (action === 'retry' && occurrence.targetDomain === 'cash')) && (
                    <CashAccountSelect
                        id="occurrence-account"
                        label={action === 'paid' ? 'Conta do pagamento' : 'Conta'}
                        value={panelAccountId}
                        onChange={setPanelAccountId}
                        disabled={busy}
                        labelClassName={panelLabelClass}
                        selectClassName={panelInputClass}
                    />
                )}
                {action === 'retry' && occurrence.targetDomain === 'card' && (
                    <div>
                        <label htmlFor="occurrence-card" className={panelLabelClass}>Cartão</label>
                        <select id="occurrence-card" value={panelCardId} onChange={e => setPanelCardId(e.target.value)} className={panelInputClass}>
                            {creditCards.filter(c => c.status === 'active' || c.id === occurrence.cardId).map(c => (
                                <option key={c.id} value={c.id}>{c.name} ({c.brand}){c.status === 'archived' ? ' (arquivado)' : ''}</option>
                            ))}
                        </select>
                    </div>
                )}
                {action === 'paid' && (
                    <div>
                        <label htmlFor="occurrence-paid-date" className={panelLabelClass}>Data do pagamento</label>
                        <input id="occurrence-paid-date" type="date" value={panelDate} max={today} onChange={e => setPanelDate(e.target.value)} className={panelInputClass} required />
                    </div>
                )}
                <div className="flex gap-2">
                    <button type="submit" disabled={busy} className="bg-primary hover:bg-primary/90 text-white px-3 py-1.5 rounded text-sm font-medium disabled:opacity-60">
                        {busy ? 'Enviando…' : confirmLabels[action]}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setPanel(null)} className="text-muted hover:text-on-surface px-3 py-1.5 text-sm">
                        Cancelar
                    </button>
                </div>
            </form>
        );
    };

    return (
        <div className="flex flex-col h-full animate-fade-in pb-10">
            {/* Header */}
            <div className="flex items-center justify-between mb-6 flex-shrink-0">
                <button
                    onClick={() => {
                        playSound('click');
                        onBack();
                    }}
                    className="flex items-center gap-2 text-muted hover:text-on-surface transition-colors"
                    aria-label="Voltar"
                >
                    <BackIcon className="h-5 w-5" />
                    <span className="text-sm font-medium">Voltar para {isPJ ? 'Contratos' : 'Recorrências'}</span>
                </button>
            </div>

            {actionError && !isCancelOpen && (
                <p role="alert" className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
                    {actionError}
                </p>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                {/* Hero Card */}
                <MotionDiv
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="lg:col-span-2 bg-surface rounded-card p-6 shadow-sm border border-border relative overflow-hidden flex flex-col justify-between"
                >
                    {isExpiringSoon() && (
                        <div className="absolute top-0 right-0 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 px-3 py-1 rounded-bl-xl text-xs font-bold flex items-center gap-1">
                            <WarningIcon className="w-4 h-4" />
                            Vence em breve: {formatDayKey(expense.endDate)}
                        </div>
                    )}

                    <div className="flex items-start gap-5">
                        <div
                            className="w-20 h-20 rounded-2xl flex items-center justify-center text-white shadow-md text-4xl flex-shrink-0"
                            style={{ backgroundColor: expense.visual.color }}
                        >
                            {expense.visual.emoji ? <span>{expense.visual.emoji}</span> : <DynamicIcon name={expense.visual.icon} size={40} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                                <h1 className="text-3xl font-bold text-on-surface truncate">{expense.name}</h1>
                                {getStatusBadge(expense.status)}
                            </div>

                            {isPJ ? (
                                <div className="flex items-center gap-2 text-sm font-medium text-primary bg-primary/5 px-2 py-1 rounded w-fit mb-3">
                                    <BuildingIcon className="w-4 h-4" />
                                    {expense.business?.supplier || 'Fornecedor não informado'}
                                </div>
                            ) : (
                                <p className="text-muted text-sm mb-3">{expense.description || 'Sem descrição'}</p>
                            )}

                            <div className="flex flex-wrap gap-3 text-sm">
                                <div className="flex items-center gap-1.5 text-on-surface bg-background px-3 py-1.5 rounded-lg border border-border">
                                    <span className="font-bold text-lg">{formatCents(expense.amountCents)}</span>
                                    <span className="text-xs text-muted">/ {FREQUENCY_LABELS[expense.frequency].toLowerCase()}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-on-surface bg-background px-3 py-1.5 rounded-lg capitalize border border-border">
                                    <CalendarIcon className="w-4 h-4 text-muted" />
                                    <span>{scheduleLabel}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 flex flex-wrap gap-4 border-t border-border pt-4">
                        {canManage && editable && (
                            <button
                                onClick={() => setIsAdjusting(!isAdjusting)}
                                className="flex items-center gap-1.5 text-primary dark:text-primary-on-dark text-xs font-bold uppercase tracking-wider hover:underline"
                            >
                                <TrendingUpIcon className="w-4 h-4" />
                                Reajustar Valor
                            </button>
                        )}
                        {canManage && editable && (
                            <button
                                onClick={() => setIsEditOpen(true)}
                                className="flex items-center gap-1.5 text-primary dark:text-primary-on-dark text-xs font-bold uppercase tracking-wider hover:underline"
                            >
                                <DynamicIcon name="Pencil" size={14} />
                                Editar
                            </button>
                        )}
                        {canManage && expense.status === 'active' && (
                            <button
                                disabled={busy}
                                onClick={() => void run('pauseRecurringExpense', lifecyclePayload(), pauseMutation)}
                                className="flex items-center gap-1.5 text-primary dark:text-primary-on-dark text-xs font-bold uppercase tracking-wider hover:underline disabled:opacity-60"
                            >
                                <DynamicIcon name="PlayerPause" size={14} />
                                Pausar
                            </button>
                        )}
                        {canManage && expense.status === 'paused' && (
                            <button
                                disabled={busy}
                                onClick={() => void run('resumeRecurringExpense', lifecyclePayload(), resumeMutation)}
                                className="flex items-center gap-1.5 text-primary dark:text-primary-on-dark text-xs font-bold uppercase tracking-wider hover:underline disabled:opacity-60"
                            >
                                <DynamicIcon name="PlayerPlay" size={14} />
                                Retomar
                            </button>
                        )}
                        {canManage && editable && (
                            <button
                                disabled={busy}
                                onClick={() => { intent.reset(); setActionError(null); setIsCancelOpen(true); }}
                                className="flex items-center gap-1.5 text-red-600 dark:text-red-400 text-xs font-bold uppercase tracking-wider hover:underline disabled:opacity-60"
                            >
                                <DynamicIcon name="Ban" size={14} />
                                Cancelar recorrência
                            </button>
                        )}
                        {isPJ && (
                            <div className="flex items-center gap-1.5 text-muted text-xs">
                                <DynamicIcon name="Paperclip" size={14} />
                                Sem Anexo
                            </div>
                        )}
                    </div>
                </MotionDiv>

                {/* PJ Info Grid */}
                <div className="bg-surface rounded-card p-6 border border-border shadow-sm space-y-4">
                    <h3 className="text-xs font-bold text-muted uppercase tracking-widest border-b border-border pb-2">Informações do Contrato</h3>

                    <div className="space-y-3">
                        {isPJ ? (
                            <>
                                <div>
                                    <span className="text-[10px] text-muted uppercase font-bold block">Responsável</span>
                                    <p className="text-sm font-medium text-on-surface">{expense.business?.responsible || '-'}</p>
                                </div>
                                <div>
                                    <span className="text-[10px] text-muted uppercase font-bold block">Centro de Custo</span>
                                    <p className="text-sm font-medium text-on-surface">{expense.business?.costCenter || '-'}</p>
                                </div>
                                <div>
                                    <span className="text-[10px] text-muted uppercase font-bold block">Próximo Reajuste</span>
                                    <p className="text-sm font-medium text-on-surface">{expense.business?.adjustmentDate ? formatDayLong(expense.business.adjustmentDate) : '-'}</p>
                                </div>
                                <div>
                                    <span className="text-[10px] text-muted uppercase font-bold block">Fidelidade</span>
                                    <p className="text-sm font-medium text-on-surface">{expense.business?.commitment || 'Sem fidelidade'}</p>
                                </div>
                            </>
                        ) : (
                            <>
                                <div>
                                    <span className="text-[10px] text-muted uppercase font-bold block">Data de Início</span>
                                    <p className="text-sm font-medium text-on-surface">{formatDayLong(expense.startDate)}</p>
                                </div>
                                <div>
                                    <span className="text-[10px] text-muted uppercase font-bold block">Tipo</span>
                                    <p className="text-sm font-medium text-on-surface capitalize">{RECURRING_TYPE_LABELS[expense.type]}</p>
                                </div>
                            </>
                        )}
                        <div>
                            <span className="text-[10px] text-muted uppercase font-bold block">Execução</span>
                            <p className="text-sm font-medium text-on-surface">
                                {EXECUTION_MODE_LABELS[expense.executionMode]} · {expense.paymentMethod === 'credit_card' ? 'Cartão' : 'Caixa'}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Adjust Price Form */}
            {isAdjusting && (
                <MotionDiv
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="mb-6 p-4 bg-background rounded-lg border border-border"
                >
                    <h4 className="text-sm font-bold text-on-surface mb-2">Novo Reajuste</h4>
                    <form onSubmit={handleAdjustPrice} className="flex gap-2 items-end">
                        <div>
                            <label htmlFor="reajuste-valor" className="block text-xs text-muted mb-1">Novo Valor</label>
                            <input
                                id="reajuste-valor"
                                type="number"
                                step="0.01"
                                value={newPrice}
                                onChange={e => setNewPrice(e.target.value)}
                                className="border border-border rounded px-2 py-1.5 text-sm w-24 bg-surface text-on-surface"
                                placeholder="0.00"
                                required
                            />
                        </div>
                        <div className="flex-1">
                            <label htmlFor="reajuste-motivo" className="block text-xs text-muted mb-1">Motivo (Opcional)</label>
                            <input
                                id="reajuste-motivo"
                                type="text"
                                value={adjustmentNote}
                                onChange={e => setAdjustmentNote(e.target.value)}
                                className="border border-border rounded px-2 py-1.5 text-sm w-full bg-surface text-on-surface"
                                placeholder="Ex: Reajuste anual da operadora"
                                maxLength={140}
                            />
                        </div>
                        <button type="submit" disabled={busy} className="bg-primary hover:bg-primary/90 text-white px-3 py-1.5 rounded text-sm font-medium disabled:opacity-60">
                            Salvar
                        </button>
                        <button type="button" onClick={() => setIsAdjusting(false)} className="text-muted hover:text-on-surface px-3 py-1.5 text-sm">
                            Cancelar
                        </button>
                    </form>
                </MotionDiv>
            )}

            {/* Timeline / Occurrences */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                    {/* Column 1: Projections & History */}
                    <div className="space-y-8">
                        <div>
                            <h3 className="text-lg font-bold text-on-surface mb-4 flex items-center gap-2">
                                <CalendarIcon className="w-5 h-5 text-primary" />
                                {isPJ ? 'Provisionamento e Pagamentos' : 'Próximos Vencimentos'}
                            </h3>
                            {isOpenLoading ? (
                                <div className="text-center py-4 text-muted">Carregando projeção...</div>
                            ) : (
                                <MotionDiv
                                    variants={listVariants}
                                    initial="hidden"
                                    animate="show"
                                    className="space-y-3"
                                >
                                    {openOccurrences.map(occ => {
                                        const badge = dayBadgeParts(occ.dueDate);
                                        const attention = occ.status === 'attention_required';
                                        return (
                                            <MotionDiv key={occ.id} variants={itemVariants} className="bg-surface p-4 rounded-card shadow-sm border border-border opacity-90 hover:opacity-100 transition-opacity" data-occurrence-id={occ.id}>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-lg bg-background flex flex-col items-center justify-center text-xs font-bold text-muted border border-border">
                                                            <span>{badge.day}</span>
                                                            <span className="text-[9px] uppercase">{badge.month}</span>
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-on-surface">{formatDayLong(occ.dueDate)}</p>
                                                            <p className={`text-xs ${attention ? 'text-red-600 dark:text-red-400' : 'text-muted'}`}>
                                                                {OCCURRENCE_STATUS_LABELS[occ.status]} · {TARGET_LABELS[occ.targetDomain]}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right flex flex-col items-end">
                                                        <p className="font-bold text-on-surface">{formatCents(occ.plannedAmountCents)}</p>
                                                        {canManage && (
                                                            <div className="flex gap-2 mt-1">
                                                                {occ.status === 'awaiting_confirmation' && occ.targetDomain === 'cash' && expense.status !== 'cancelled' && (
                                                                    <>
                                                                        <button disabled={busy} onClick={() => openPanel(occ, 'pending')} className={`${smallButton} bg-primary/10 text-primary hover:bg-primary/20`} title="Gerar despesa pendente no Caixa">
                                                                            {isPJ ? 'Provisionar' : 'Gerar'}
                                                                        </button>
                                                                        <button disabled={busy} onClick={() => openPanel(occ, 'paid')} className={`${smallButton} bg-green-50 text-green-600 hover:bg-green-100`} title="Registrar como paga agora">
                                                                            Pagar
                                                                        </button>
                                                                    </>
                                                                )}
                                                                {occ.status === 'awaiting_confirmation' && occ.targetDomain === 'card' && expense.status !== 'cancelled' && (
                                                                    <button disabled={busy} onClick={() => openPanel(occ, 'card')} className={`${smallButton} bg-primary/10 text-primary hover:bg-primary/20`} title="Confirmar compra no cartão">
                                                                        Confirmar
                                                                    </button>
                                                                )}
                                                                {attention && expense.status !== 'cancelled' && (
                                                                    <button disabled={busy} onClick={() => openPanel(occ, 'retry')} className={`${smallButton} bg-primary/10 text-primary hover:bg-primary/20`} title="Tentar de novo">
                                                                        Tentar de novo
                                                                    </button>
                                                                )}
                                                                <button disabled={busy} onClick={() => openPanel(occ, 'ignore')} className={`${smallButton} bg-background text-muted hover:text-on-surface`} title="Ignorar ocorrência">
                                                                    Ignorar
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                                {attention && occ.attentionCode && (
                                                    <p className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-start gap-1">
                                                        <WarningIcon className="w-3 h-3 mt-0.5" />
                                                        {ATTENTION_MESSAGES[occ.attentionCode]}
                                                    </p>
                                                )}
                                                {panel?.occurrence.id === occ.id && renderPanel()}
                                            </MotionDiv>
                                        );
                                    })}
                                    {projected.map(dueDate => {
                                        const badge = dayBadgeParts(dueDate);
                                        return (
                                            <MotionDiv key={dueDate} variants={itemVariants} className="bg-surface p-4 rounded-card shadow-sm border border-border flex items-center justify-between opacity-90 hover:opacity-100 transition-opacity">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-lg bg-background flex flex-col items-center justify-center text-xs font-bold text-muted border border-border">
                                                        <span>{badge.day}</span>
                                                        <span className="text-[9px] uppercase">{badge.month}</span>
                                                    </div>
                                                    <div>
                                                        <p className="font-medium text-on-surface">{formatDayLong(dueDate)}</p>
                                                        <p className="text-xs text-muted">Previsto · {expense.paymentMethod === 'credit_card' ? 'Cartão' : 'Caixa'}</p>
                                                    </div>
                                                </div>
                                                <div className="text-right flex flex-col items-end">
                                                    <p className="font-bold text-on-surface">{formatCents(expense.amountCents)}</p>
                                                </div>
                                            </MotionDiv>
                                        );
                                    })}
                                    {openOccurrences.length === 0 && projected.length === 0 && (
                                        <p className="text-muted text-sm">Nenhuma cobrança prevista.</p>
                                    )}
                                    {isOpenTruncated && (
                                        <p className="text-xs text-muted">Mostrando as {RECURRING_OPEN_OCCURRENCES_LIMIT} ocorrências mais antigas que aguardam ação.</p>
                                    )}
                                </MotionDiv>
                            )}
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-on-surface mb-4 flex items-center gap-2">
                                <DynamicIcon name="History" className="w-5 h-5 text-muted" />
                                Histórico Recente
                            </h3>
                            <div className="space-y-3">
                                {pastOccurrences.length > 0 ? pastOccurrences.map(occ => {
                                    const generated = occ.status === 'generated';
                                    const factId = occ.cashTransactionId ?? occ.cardPurchaseId;
                                    const fact = factId ? facts?.[factId] : undefined;
                                    return (
                                        <div key={occ.id} className="flex items-center justify-between p-3 rounded-lg border-b border-border hover:bg-background transition-colors" data-occurrence-id={occ.id}>
                                            <div className="flex items-center gap-3">
                                                <div className={`w-2 h-2 rounded-full ${generated ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                                                <div>
                                                    <p className="text-sm text-muted">{formatDayLong(occ.dueDate)}</p>
                                                    {generated && factId && (
                                                        <p className="text-[10px] text-muted" title={factId}>Ref. {factId.slice(-6)}</p>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <span className={`text-xs font-bold uppercase ${generated ? 'text-green-600' : 'text-muted'}`}>
                                                    {generated ? factStateLabel(fact) : OCCURRENCE_STATUS_LABELS.ignored}
                                                </span>
                                                <span className={`text-sm font-medium ${generated ? 'text-on-surface' : 'text-muted line-through'}`}>
                                                    {formatCents(fact?.amountCents ?? occ.actualAmountCents ?? occ.plannedAmountCents)}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                }) : (
                                    <p className="text-muted text-sm italic">Nenhum histórico recente.</p>
                                )}
                                {hasMoreHistory && (
                                    <div className="flex justify-center">
                                        <button type="button" onClick={() => void fetchMoreHistory()} disabled={isFetchingMoreHistory} className="px-4 py-2 text-sm font-medium text-primary hover:bg-background rounded-lg disabled:opacity-60">
                                            {isFetchingMoreHistory ? 'Carregando…' : 'Carregar mais'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Column 2: Price History */}
                    <div>
                        <h3 className="text-lg font-bold text-on-surface mb-4 flex items-center gap-2">
                            <TrendingUpIcon className="w-5 h-5 text-green-500" />
                            Histórico de Reajustes
                        </h3>
                        <div className="bg-surface rounded-card shadow-sm border border-border overflow-hidden">
                            {priceChanges.length > 0 ? (
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-background text-muted">
                                        <tr>
                                            <th className="px-4 py-2">Data</th>
                                            <th className="px-4 py-2 text-right">Anterior</th>
                                            <th className="px-4 py-2 text-right">Novo</th>
                                            <th className="px-4 py-2">Motivo</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {priceChanges.map(adj => (
                                            <tr key={adj.id}>
                                                <td className="px-4 py-3 text-muted">
                                                    {formatDayKey(adj.date)}
                                                </td>
                                                <td className="px-4 py-3 text-right text-muted line-through">
                                                    {formatCents(adj.previousCents ?? 0)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-bold text-on-surface">
                                                    {formatCents(adj.nextCents)}
                                                </td>
                                                <td className="px-4 py-3 text-muted text-xs italic">
                                                    {adj.reason || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="p-6 text-center text-muted">
                                    <p className="text-sm">Nenhum reajuste registrado.</p>
                                </div>
                            )}
                            {isAmountHistoryTruncated && (
                                <p className="px-4 py-2 text-xs text-muted">Mostrando os {RECURRING_AMOUNT_HISTORY_LIMIT} reajustes mais recentes.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <RecurringExpenseFormModal
                isOpen={isEditOpen}
                onClose={() => setIsEditOpen(false)}
                onSaved={() => playSound('success')}
                expenseToEdit={expense}
                creditCards={creditCards}
            />

            <ConfirmationModal
                isOpen={isCancelOpen}
                onClose={() => setIsCancelOpen(false)}
                onConfirm={() => void run('cancelRecurringExpense', lifecyclePayload(), cancelMutation, () => setIsCancelOpen(false))}
                title="Cancelar recorrência"
                message="Nenhuma nova ocorrência será gerada. O que já foi lançado no Caixa ou no Cartão não é apagado nem revertido. Esta ação não pode ser desfeita."
                confirmLabel="Cancelar recorrência"
                isBusy={busy}
                error={isCancelOpen ? actionError : null}
            />
        </div>
    );
};

export default RecurringExpenseDetailsView;
