import React, { useMemo, useRef, useState } from 'react';
import CreditCard3D from './CreditCard3D.tsx';
import CreditCardForm from './CreditCardForm.tsx';
import { PlusIcon, SearchIcon, EditIcon, ArchiveIcon, RotateCcwIcon, CloseIcon, LayoutGridIcon, ListIcon, ChartBarIcon, UsersIcon, CurrencyDollarIcon } from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import ClientsConfirmModal from './clients/ClientsConfirmModal.tsx';
import CardInvoiceDetailsDrawer from './cards/CardInvoiceDetailsDrawer.tsx';
import CardInvoicePaymentModal, { type InvoicePaymentMode } from './cards/CardInvoicePaymentModal.tsx';
import CardAdjustmentModal from './cards/CardAdjustmentModal.tsx';
import {
    useArchiveCreditCard,
    useCardEvents,
    useCardsIntentKey,
    useClosedInvoices,
    useCreateCreditCard,
    useCreditCards,
    useOpenInvoices,
    useReactivateCreditCard,
    useRebuildCardInvoices,
    useRecalculateCardLimit,
    useRecentPurchases,
    useUpdateCreditCard,
} from '../modules/cards/hooks.ts';
import {
    ARCHIVE_EXPLANATION,
    CARD_STATUS_LABELS,
    INVOICE_STATUS_LABELS,
    canPayInvoice,
    cardPermissions,
    cardsErrorView,
    eventLabel,
    invoiceDisplayStatus,
    openInvoiceCreditNote,
    payableCents,
    selectInvoiceSections,
} from '../modules/cards/presentation.ts';
import {
    toCardStatusPayload,
    toCreateCreditCardPayload,
    toUpdateCreditCardPayload,
    type CreditCardFormValues,
} from '../modules/cards/payloads.ts';
import { formatCompetence } from '../modules/cards/cycle.ts';
import { formatCents, formatDayKey, saoPauloToday } from '../modules/loans/money.ts';
import type { CardInvoice, CreditCard } from '../modules/cards/types.ts';

/**
 * Cartões de crédito (P4-A, D-36). Toda escrita passa pelas callables do
 * backend, com chave de idempotência por intenção e trava síncrona contra
 * duplo clique; os valores chegam em centavos e só viram reais na exibição.
 * Não existe exclusão: o cartão é arquivado (e reativado). Fechamento e
 * reabertura manual de fatura saíram — o ciclo é decidido pela data.
 */
interface InvoicePaymentDraft {
    invoice: CardInvoice;
    mode: InvoicePaymentMode;
}

const InvoiceSummaryCard: React.FC<{
    invoice: CardInvoice;
    today: string;
    highlighted: boolean;
    canManage: boolean;
    showPay: boolean;
    onDetails: () => void;
    onPay: () => void;
}> = ({ invoice, today, highlighted, canManage, showPay, onDetails, onPay }) => {
    const status = invoiceDisplayStatus(invoice, today);
    const canPay = canManage && canPayInvoice(invoice, today);
    const competence = formatCompetence(invoice.competenceMonth);
    const creditNote = openInvoiceCreditNote(invoice);
    return (
        <div
            data-testid="card-invoice-summary"
            className={highlighted
                ? 'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-xl p-4 space-y-3'
                : 'bg-gray-50 dark:bg-dark-200 border border-gray-100 dark:border-gray-700 rounded-xl p-4 space-y-3'}
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <p className="font-bold text-gray-800 dark:text-white">Fatura {competence}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">Vencimento: {formatDayKey(invoice.dueDate)}</p>
                </div>
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                    {INVOICE_STATUS_LABELS[status]}
                </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                    <p className="text-gray-500 dark:text-gray-400">Total</p>
                    <p className="font-bold">{formatCents(invoice.totalCents)}</p>
                </div>
                <div>
                    <p className="text-gray-500 dark:text-gray-400">Pago</p>
                    <p className="font-bold">{formatCents(invoice.paidCents)}</p>
                </div>
                <div>
                    <p className="text-gray-500 dark:text-gray-400">Restante</p>
                    <p className="font-bold">{formatCents(payableCents(invoice))}</p>
                </div>
            </div>

            {creditNote && (
                <p className="text-xs text-gray-600 dark:text-gray-300">{creditNote}</p>
            )}

            <button
                type="button"
                data-testid={`credit-card-invoice-details-${invoice.id}`}
                aria-label={`Ver detalhes da fatura ${competence}`}
                onClick={onDetails}
                className="w-full py-2 rounded-lg font-bold bg-white dark:bg-dark-300 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-dark-400 transition-all"
            >
                Ver detalhes da fatura
            </button>

            {showPay && canManage && (
                <button
                    type="button"
                    disabled={!canPay}
                    onClick={onPay}
                    className={`w-full py-2.5 rounded-lg font-bold transition-all ${canPay
                        ? 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                        : 'bg-gray-200 dark:bg-dark-300 text-gray-400 cursor-not-allowed'
                    }`}
                >
                    {status === 'paid' ? 'Fatura paga' : status === 'open' ? 'Aguardando fechamento' : 'Pagar total'}
                </button>
            )}
        </div>
    );
};

const CreditCardsView: React.FC = () => {
    const { data: cardsData, isLoading } = useCreditCards();
    const cards = useMemo(() => cardsData ?? [], [cardsData]);
    const { activeWorkspace, activeWorkspaceRole } = useWorkspace();
    const workspaceId = activeWorkspace.id;
    const isPJ = activeWorkspace.type === 'PJ';
    const { playSound } = useTheme();
    const permissions = cardPermissions(activeWorkspaceRole as Parameters<typeof cardPermissions>[0]);
    const today = saoPauloToday();

    const createMutation = useCreateCreditCard();
    const updateMutation = useUpdateCreditCard();
    const archiveMutation = useArchiveCreditCard();
    const reactivateMutation = useReactivateCreditCard();
    const recalculateMutation = useRecalculateCardLimit();
    const rebuildMutation = useRebuildCardInvoices();
    const formIntent = useCardsIntentKey();
    const statusIntent = useCardsIntentKey();
    const submittingRef = useRef(false);

    // --- STATE LOCAL ---
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [cardToEdit, setCardToEdit] = useState<CreditCard | null>(null);
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
    const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
    const [paymentDraft, setPaymentDraft] = useState<InvoicePaymentDraft | null>(null);
    const [statusAction, setStatusAction] = useState<'archive' | 'reactivate' | null>(null);
    const [isAdjustmentOpen, setIsAdjustmentOpen] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const [adminResult, setAdminResult] = useState<string | null>(null);

    const openInvoices = useOpenInvoices(selectedCardId);
    const closedInvoices = useClosedInvoices(selectedCardId);
    const recentPurchases = useRecentPurchases(selectedCardId, isPJ);
    const cardEvents = useCardEvents(selectedCardId, permissions.canManage);

    const filteredCards = useMemo(() => {
        const query = searchQuery.toLowerCase();
        return cards.filter(card =>
            card.name.toLowerCase().includes(query) ||
            card.brand.toLowerCase().includes(query)
        );
    }, [cards, searchQuery]);

    const limitsOf = (card: CreditCard) => ({
        usedCents: card.limitUsedCents,
        availableCents: card.limitAvailableCents,
    });

    const selectedCard = cards.find(card => card.id === selectedCardId) ?? null;
    const openItems = openInvoices.data?.items ?? [];
    const closedItems = closedInvoices.data ?? [];
    const { nextToPay, openCycle, followingCycle, history } = selectInvoiceSections(openItems, closedItems, today);
    const allInvoices = [...openItems, ...closedItems];
    const selectedInvoice = selectedInvoiceId
        ? allInvoices.find((invoice) => invoice.id === selectedInvoiceId) ?? null
        : null;

    const usagePercent = selectedCard && selectedCard.limitTotalCents > 0
        ? Math.round((Math.max(selectedCard.limitUsedCents, 0) / selectedCard.limitTotalCents) * 100)
        : 0;
    const utilizationAlert = usagePercent >= 90
        ? {
            title: 'Utilização crítica do limite',
            description: 'Este cartão já consumiu 90% ou mais do limite disponível.',
            className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300',
        }
        : usagePercent >= 75
            ? {
                title: 'Atenção ao limite',
                description: 'Este cartão já consumiu 75% ou mais do limite disponível.',
                className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300',
            }
            : null;

    const notify = (message: string) => {
        setNotice(message);
        playSound('success');
    };

    const closeDrawer = () => {
        setSelectedCardId(null);
        setSelectedInvoiceId(null);
        setAdminResult(null);
        setNotice(null);
    };

    const openForm = (card: CreditCard | null) => {
        formIntent.reset();
        setFormError(null);
        setCardToEdit(card);
        setIsFormOpen(true);
    };

    const handleSave = async (values: CreditCardFormValues) => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setFormError(null);
        try {
            if (cardToEdit) {
                const payload = toUpdateCreditCardPayload(cardToEdit, values, workspaceId);
                await updateMutation.mutateAsync({
                    payload,
                    idempotencyKey: formIntent.keyFor('updateCreditCard', payload),
                });
            } else {
                const payload = toCreateCreditCardPayload(values, workspaceId);
                await createMutation.mutateAsync({
                    payload,
                    idempotencyKey: formIntent.keyFor('createCreditCard', payload),
                });
            }
            formIntent.reset();
            playSound('success');
            setIsFormOpen(false);
            setCardToEdit(null);
        } catch (caught) {
            setFormError(cardsErrorView(caught).message);
        } finally {
            submittingRef.current = false;
        }
    };

    const confirmStatusAction = async (): Promise<string | null> => {
        if (!selectedCard || !statusAction || submittingRef.current) return null;
        submittingRef.current = true;
        try {
            const payload = toCardStatusPayload(selectedCard, workspaceId);
            const operation = statusAction === 'archive' ? 'archiveCreditCard' : 'reactivateCreditCard';
            const mutation = statusAction === 'archive' ? archiveMutation : reactivateMutation;
            await mutation.mutateAsync({ payload, idempotencyKey: statusIntent.keyFor(operation, payload) });
            statusIntent.reset();
            notify(statusAction === 'archive' ? 'Cartão arquivado.' : 'Cartão reativado.');
            setStatusAction(null);
            return null;
        } catch (caught) {
            return cardsErrorView(caught).message;
        } finally {
            submittingRef.current = false;
        }
    };

    const handleRecalculateLimit = async (card: CreditCard) => {
        if (recalculateMutation.isPending) return;
        setAdminResult(null);
        try {
            const report = await recalculateMutation.mutateAsync({ workspaceId, cardId: card.id });
            setAdminResult(!report.sourcesAgree
                ? 'As fontes do limite divergem; nada foi alterado. Acione o suporte.'
                : report.repaired
                    ? `Limite reconciliado: utilizado ${formatCents(report.ledgerLimitUsedCents)}.`
                    : 'Limite conferido: nenhuma divergência.');
        } catch (caught) {
            setAdminResult(cardsErrorView(caught).message);
        }
    };

    const handleRebuildInvoices = async (card: CreditCard) => {
        if (rebuildMutation.isPending) return;
        setAdminResult(null);
        try {
            let cursor: string | null = null;
            let repaired = 0;
            let divergent = 0;
            let processed = 0;
            do {
                const report = await rebuildMutation.mutateAsync({
                    workspaceId,
                    cardId: card.id,
                    ...(cursor ? { cursor } : {}),
                });
                repaired += report.repaired;
                divergent += report.divergent;
                processed += report.processed;
                cursor = report.nextCursor;
            } while (cursor);
            setAdminResult(divergent > 0
                ? `${processed} fatura(s) conferida(s); ${divergent} fechada(s) com divergência (não alteradas). Acione o suporte.`
                : `${processed} fatura(s) conferida(s); ${repaired} reconstruída(s).`);
        } catch (caught) {
            setAdminResult(cardsErrorView(caught).message);
        }
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col animate-fade-in">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-white">
                        {isPJ ? 'Cartões Corporativos' : 'Meus Cartões'}
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {isPJ ? 'Gerencie limites e despesas da sua frota de cartões' : 'Gerencie seus limites e faturas'}
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                    <div className="relative flex-1 sm:flex-initial">
                        <input
                            type="text"
                            placeholder="Buscar..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full sm:w-48 pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-dark-200 text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                        />
                        <div className="absolute left-3 top-2.5 text-gray-400">
                            <SearchIcon className="h-4 w-4" />
                        </div>
                    </div>

                    <div className="flex bg-gray-100 dark:bg-dark-200 rounded-lg p-1">
                        <button onClick={() => setViewMode('grid')} aria-label="Exibir em grade" className={`p-2 rounded-md ${viewMode === 'grid' ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500'}`}><LayoutGridIcon className="h-5 w-5" /></button>
                        <button onClick={() => setViewMode('list')} aria-label="Exibir em lista" className={`p-2 rounded-md ${viewMode === 'list' ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500'}`}><ListIcon className="h-5 w-5" /></button>
                    </div>

                    {permissions.canManage && (
                        <button onClick={() => openForm(null)} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center shadow-md transition-all">
                            <PlusIcon className="mr-2 h-4 w-4" /> {isPJ ? 'Novo Cartão Corp' : 'Novo Cartão'}
                        </button>
                    )}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <div className={viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-6" : "space-y-3 pb-6"}>
                    {filteredCards.map(card => (
                        <CreditCard3D key={card.id} card={card} mode={viewMode} limits={limitsOf(card)} onClick={() => {
                            setSelectedCardId(card.id);
                            setSelectedInvoiceId(null);
                            setAdminResult(null);
                            setNotice(null);
                        }} />
                    ))}

                    {filteredCards.length === 0 && (
                        <div className="col-span-full text-center py-10 text-gray-400">
                            Nenhum cartão encontrado.
                        </div>
                    )}
                </div>
            </div>

            {selectedCard && (
                <div
                    className="fixed inset-0 z-40 bg-black/50 flex justify-end transition-opacity"
                    onClick={closeDrawer}
                >
                    <div className="w-full max-w-lg bg-white dark:bg-dark-100 h-full shadow-2xl p-6 overflow-y-auto animate-slide-in-right" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-gray-800 dark:text-white">Detalhes do Cartão</h3>
                            <button
                                type="button"
                                onClick={closeDrawer}
                                aria-label="Fechar detalhes do cartão"
                                className="p-2 hover:bg-gray-100 dark:hover:bg-dark-200 rounded-full transition-colors text-gray-500"
                            >
                                <CloseIcon />
                            </button>
                        </div>

                        <div className="mb-8 transform scale-90 sm:scale-100 origin-top-center">
                            <CreditCard3D card={selectedCard} mode="grid" limits={limitsOf(selectedCard)} onClick={() => { }} />
                        </div>

                        <div className="space-y-6">
                            {notice && (
                                <p role="status" className="rounded-xl border border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-900/20 dark:text-green-300 p-3 text-sm font-medium">
                                    {notice}
                                </p>
                            )}

                            <div className="grid grid-cols-2 gap-4 bg-gray-50 dark:bg-dark-200 p-4 rounded-xl border border-gray-100">
                                <div className="col-span-2 flex items-center justify-between mb-2">
                                    <span data-testid="card-status" className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${selectedCard.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                        {CARD_STATUS_LABELS[selectedCard.status]}
                                    </span>
                                    {isPJ && selectedCard.responsiblePerson && (
                                        <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded flex items-center gap-1">
                                            <UsersIcon className="w-3 h-3" /> {selectedCard.responsiblePerson}
                                        </span>
                                    )}
                                </div>
                                <div><p className="text-[10px] text-gray-500 uppercase font-bold">Fechamento</p><p className="font-bold">Dia {selectedCard.closingDay}</p></div>
                                <div><p className="text-[10px] text-gray-500 uppercase font-bold">Vencimento</p><p className="font-bold">Dia {selectedCard.dueDay}</p></div>
                                {isPJ && (
                                    <div className="col-span-2 pt-2 border-t border-gray-200 dark:border-gray-700 mt-2">
                                        <p className="text-[10px] text-gray-500 uppercase font-bold">Uso Recomendado</p>
                                        <p className="text-sm italic">{selectedCard.recommendedUse || 'Uso geral'}</p>
                                    </div>
                                )}
                            </div>

                            {utilizationAlert && (
                                <div className={`rounded-xl border p-4 text-sm ${utilizationAlert.className}`}>
                                    <p className="font-bold">{utilizationAlert.title}</p>
                                    <p className="mt-1">{utilizationAlert.description}</p>
                                    <p className="mt-2 font-bold">
                                        Utilização atual: {usagePercent}%
                                    </p>
                                </div>
                            )}

                            <div className="space-y-3">
                                <h4 className="font-bold text-gray-800 dark:text-white flex items-center gap-2 border-b pb-2">
                                    <CurrencyDollarIcon className="w-4 h-4 text-indigo-600" /> Faturas
                                </h4>

                                {(openInvoices.isLoading || closedInvoices.isLoading) && (
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                        Carregando faturas...
                                    </div>
                                )}

                                {(openInvoices.isError || closedInvoices.isError) && (
                                    <div role="alert" className="text-sm text-red-600 dark:text-red-300">
                                        Não foi possível carregar as faturas.
                                    </div>
                                )}

                                {!openInvoices.isLoading && !closedInvoices.isLoading && allInvoices.length === 0 && (
                                    <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-dark-200 p-3 rounded-lg">
                                        Nenhuma fatura encontrada para este cartão.
                                    </div>
                                )}

                                {allInvoices.length > 0 && (
                                    <div className="space-y-4">
                                        {nextToPay && (
                                            <div className="space-y-2">
                                                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">
                                                    Próxima fatura a pagar
                                                </p>
                                                <InvoiceSummaryCard
                                                    invoice={nextToPay}
                                                    today={today}
                                                    highlighted
                                                    canManage={permissions.canManage}
                                                    showPay
                                                    onDetails={() => setSelectedInvoiceId(nextToPay.id)}
                                                    onPay={() => setPaymentDraft({ invoice: nextToPay, mode: 'total' })}
                                                />
                                            </div>
                                        )}

                                        {openCycle && (
                                            <div className="space-y-2">
                                                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">
                                                    Fatura do ciclo aberto
                                                </p>
                                                <InvoiceSummaryCard
                                                    invoice={openCycle}
                                                    today={today}
                                                    highlighted={!nextToPay}
                                                    canManage={permissions.canManage}
                                                    showPay
                                                    onDetails={() => setSelectedInvoiceId(openCycle.id)}
                                                    onPay={() => setPaymentDraft({ invoice: openCycle, mode: 'total' })}
                                                />
                                            </div>
                                        )}

                                        {followingCycle && (
                                            <div className="space-y-2">
                                                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">
                                                    Fatura do ciclo seguinte
                                                </p>
                                                <InvoiceSummaryCard
                                                    invoice={followingCycle}
                                                    today={today}
                                                    highlighted={false}
                                                    canManage={permissions.canManage}
                                                    showPay={false}
                                                    onDetails={() => setSelectedInvoiceId(followingCycle.id)}
                                                    onPay={() => undefined}
                                                />
                                            </div>
                                        )}

                                        {(history.length > 0 || closedInvoices.hasNextPage) && (
                                            <div className="space-y-2">
                                                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">
                                                    Histórico de faturas
                                                </p>

                                                {history.map((invoice) => (
                                                    <InvoiceSummaryCard
                                                        key={invoice.id}
                                                        invoice={invoice}
                                                        today={today}
                                                        highlighted={false}
                                                        canManage={permissions.canManage}
                                                        showPay
                                                        onDetails={() => setSelectedInvoiceId(invoice.id)}
                                                        onPay={() => setPaymentDraft({ invoice, mode: 'total' })}
                                                    />
                                                ))}

                                                {closedInvoices.hasNextPage && (
                                                    <button
                                                        type="button"
                                                        onClick={() => closedInvoices.fetchNextPage()}
                                                        disabled={closedInvoices.isFetchingNextPage}
                                                        className="w-full py-2 rounded-lg font-bold bg-white dark:bg-dark-300 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-dark-400 transition-all disabled:opacity-50"
                                                    >
                                                        {closedInvoices.isFetchingNextPage ? 'Carregando...' : 'Carregar faturas anteriores'}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {isPJ && (
                                <div className="space-y-3">
                                    <h4 className="font-bold text-gray-800 dark:text-white flex items-center gap-2 border-b pb-2">
                                        <ChartBarIcon className="w-4 h-4 text-indigo-600" /> Compras recentes
                                    </h4>

                                    {recentPurchases.isLoading && (
                                        <div className="text-sm text-gray-500 dark:text-gray-400">
                                            Carregando compras recentes...
                                        </div>
                                    )}

                                    {!recentPurchases.isLoading && (recentPurchases.data ?? []).length === 0 && (
                                        <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-dark-200 p-3 rounded-lg">
                                            Nenhuma compra recente neste cartão.
                                        </div>
                                    )}

                                    {(recentPurchases.data ?? []).length > 0 && (
                                        <div className="space-y-2">
                                            {(recentPurchases.data ?? []).map((purchase) => (
                                                <div
                                                    key={purchase.id}
                                                    className="flex items-center justify-between gap-3 text-sm bg-gray-50 dark:bg-dark-200 border border-gray-100 dark:border-gray-700 rounded-lg p-3"
                                                >
                                                    <div>
                                                        <p className="font-bold text-gray-800 dark:text-white">
                                                            {purchase.description}
                                                        </p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                                            {formatDayKey(purchase.purchaseDate)}
                                                            {' · '}
                                                            {purchase.installmentsCount === 1
                                                                ? 'À vista no cartão'
                                                                : `${purchase.installmentsCount} parcelas`}
                                                            {purchase.status !== 'active' ? ` · ${purchase.status === 'cancelled' ? 'Cancelada' : 'Estornada'}` : ''}
                                                        </p>
                                                    </div>

                                                    <p className="font-bold text-gray-800 dark:text-white">
                                                        {formatCents(purchase.totalCents)}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {permissions.canManage && (
                                <div className="space-y-3 border-t border-gray-100 dark:border-gray-700 pt-6">
                                    <h4 className="font-bold text-gray-800 dark:text-white">
                                        Administração
                                    </h4>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            disabled={recalculateMutation.isPending}
                                            onClick={() => handleRecalculateLimit(selectedCard)}
                                            className="py-2.5 rounded-lg font-bold bg-white dark:bg-dark-200 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-dark-300 transition-all disabled:opacity-50"
                                        >
                                            {recalculateMutation.isPending ? 'Conferindo...' : 'Recalcular limite'}
                                        </button>

                                        <button
                                            type="button"
                                            disabled={rebuildMutation.isPending}
                                            onClick={() => handleRebuildInvoices(selectedCard)}
                                            className="py-2.5 rounded-lg font-bold bg-white dark:bg-dark-200 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-dark-300 transition-all disabled:opacity-50"
                                        >
                                            {rebuildMutation.isPending ? 'Conferindo...' : 'Reconstruir faturas'}
                                        </button>

                                        <button
                                            type="button"
                                            disabled={selectedCard.status !== 'active'}
                                            onClick={() => setIsAdjustmentOpen(true)}
                                            className="sm:col-span-2 py-2.5 rounded-lg font-bold bg-white dark:bg-dark-200 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-dark-300 transition-all disabled:opacity-50"
                                        >
                                            Lançar ajuste manual
                                        </button>
                                    </div>

                                    {adminResult && (
                                        <p role="status" className="text-sm text-gray-700 dark:text-gray-200 bg-gray-50 dark:bg-dark-200 rounded-xl border border-gray-100 dark:border-gray-700 p-3">
                                            {adminResult}
                                        </p>
                                    )}

                                    <details className="bg-gray-50 dark:bg-dark-200 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
                                        <summary className="cursor-pointer font-bold text-sm text-gray-700 dark:text-gray-200">
                                            Auditoria recente
                                        </summary>

                                        <div className="mt-3 space-y-2">
                                            {cardEvents.isLoading && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    Carregando auditoria...
                                                </p>
                                            )}

                                            {!cardEvents.isLoading && (cardEvents.data ?? []).length === 0 && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    Nenhum registro de auditoria.
                                                </p>
                                            )}

                                            {(cardEvents.data ?? []).map((event) => (
                                                <div
                                                    key={event.id}
                                                    className="text-xs bg-white dark:bg-dark-300 rounded-lg p-3 border border-gray-100 dark:border-gray-700"
                                                >
                                                    <p className="font-bold text-gray-800 dark:text-white">
                                                        {eventLabel(event)}
                                                        {event.amountCents !== undefined ? ` · ${formatCents(event.amountCents)}` : ''}
                                                    </p>
                                                    <p className="text-gray-500 dark:text-gray-400">
                                                        {new Date(event.occurredAtMillis).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                                                        {' · '}
                                                        {event.actorId.startsWith('system:') ? 'Rotina automática' : 'Usuário do espaço'}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    </details>
                                </div>
                            )}

                            {permissions.canManage && (
                                <div className="pt-6 border-t border-gray-100 flex gap-3">
                                    <button onClick={() => { openForm(selectedCard); setSelectedCardId(null); }} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-md transition-all flex justify-center items-center gap-2">
                                        <EditIcon className="h-4 w-4" /> Editar
                                    </button>
                                    {selectedCard.status === 'active' ? (
                                        <button onClick={() => { statusIntent.reset(); setStatusAction('archive'); }} className="flex-1 py-2.5 bg-white dark:bg-dark-200 border border-gray-200 text-red-600 rounded-lg font-bold hover:bg-red-50 transition-all flex justify-center items-center gap-2">
                                            <ArchiveIcon className="h-4 w-4" /> Arquivar
                                        </button>
                                    ) : (
                                        <button onClick={() => { statusIntent.reset(); setStatusAction('reactivate'); }} className="flex-1 py-2.5 bg-white dark:bg-dark-200 border border-gray-200 text-indigo-600 rounded-lg font-bold hover:bg-indigo-50 transition-all flex justify-center items-center gap-2">
                                            <RotateCcwIcon className="h-4 w-4" /> Reativar
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {selectedCard && selectedInvoice && (
                <CardInvoiceDetailsDrawer
                    invoice={selectedInvoice}
                    card={selectedCard}
                    workspaceId={workspaceId}
                    canManage={permissions.canManage}
                    onClose={() => setSelectedInvoiceId(null)}
                    onOpenPayment={(invoice, mode) => setPaymentDraft({ invoice, mode })}
                    onNotify={notify}
                />
            )}

            {paymentDraft && (
                <CardInvoicePaymentModal
                    invoice={paymentDraft.invoice}
                    mode={paymentDraft.mode}
                    workspaceId={workspaceId}
                    onClose={() => setPaymentDraft(null)}
                    onPaid={() => {
                        setPaymentDraft(null);
                        notify('Pagamento registrado.');
                    }}
                />
            )}

            {selectedCard && isAdjustmentOpen && (
                <CardAdjustmentModal
                    card={selectedCard}
                    workspaceId={workspaceId}
                    onClose={() => setIsAdjustmentOpen(false)}
                    onDone={(message) => {
                        setIsAdjustmentOpen(false);
                        notify(message);
                    }}
                />
            )}

            <ClientsConfirmModal
                open={statusAction !== null && selectedCard !== null}
                title={statusAction === 'reactivate' ? 'Reativar cartão' : 'Arquivar cartão'}
                confirmLabel={statusAction === 'reactivate' ? 'Reativar' : 'Arquivar'}
                onClose={() => { if (!archiveMutation.isPending && !reactivateMutation.isPending) setStatusAction(null); }}
                onConfirm={confirmStatusAction}
                busy={archiveMutation.isPending || reactivateMutation.isPending}
            >
                <p className="font-medium">{selectedCard?.name}</p>
                <p>
                    {statusAction === 'reactivate'
                        ? 'O cartão volta a aceitar compras e ajustes. O histórico continua o mesmo.'
                        : ARCHIVE_EXPLANATION}
                </p>
            </ClientsConfirmModal>

            <CreditCardForm
                isOpen={isFormOpen}
                onClose={() => {
                    if (createMutation.isPending || updateMutation.isPending) return;
                    setIsFormOpen(false);
                    setCardToEdit(null);
                    setFormError(null);
                }}
                onSave={handleSave}
                cardToEdit={cardToEdit}
                error={formError}
                isSubmitting={createMutation.isPending || updateMutation.isPending}
            />

            <style>{`
                @keyframes slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
                .animate-slide-in-right { animation: slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
            `}</style>
        </div>
    );
};

export default CreditCardsView;
