import React, { useState, useMemo } from 'react';
import { CreditCard, Transaction } from '../types.ts';
import CreditCard3D from './CreditCard3D.tsx';
import CreditCardForm from './CreditCardForm.tsx';
import { PlusIcon, SearchIcon, EditIcon, DeleteIcon, CloseIcon, LayoutGridIcon, ListIcon, ChartBarIcon, UsersIcon, BuildingIcon, CurrencyDollarIcon } from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip } from 'recharts';
import {
    useCreditCards,
    useCreateCreditCard,
    useUpdateCreditCard,
    useDeleteCreditCard,
    useOpenCreditCardInvoicesByCard,
    useRegisterCreditCardInvoicePaymentDomain,
    useCreditCardInvoiceInstallments,
    useCreditCardInvoicePayments,
} from '../modules/credit-cards/hooks';
import { useTheme } from '../contexts/ThemeContext.tsx';
import type { CreditCardInvoice } from '../modules/credit-cards/domain/types.ts';

interface CreditCardsViewProps {
    // cards e handlers removidos pois agora são gerenciados internamente via hooks
    transactions: Transaction[]; // Mantido para cálculo de limites
}


const CreditCardInvoiceDetailsPanel = ({
    invoiceId,
}: {
    invoiceId: string;
}) => {
    const {
        data: installmentsData,
        isLoading: isLoadingInstallments,
    } = useCreditCardInvoiceInstallments(invoiceId);
    const {
        data: paymentsData,
        isLoading: isLoadingPayments,
    } = useCreditCardInvoicePayments(invoiceId);

    const installments = installmentsData || [];
    const payments = paymentsData || [];

    const formatCurrency = (value: number) =>
        value.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        });

    return (
        <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3 space-y-4">
            <div>
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-2">
                    Itens da fatura
                </p>

                {isLoadingInstallments && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Carregando itens...
                    </p>
                )}

                {!isLoadingInstallments && installments.length === 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Nenhum item encontrado.
                    </p>
                )}

                <div className="space-y-2">
                    {installments.map((installment) => (
                        <div
                            key={installment.id}
                            className="flex items-center justify-between gap-3 text-sm bg-white dark:bg-dark-300 rounded-lg p-2"
                        >
                            <div>
                                <p className="font-medium text-gray-700 dark:text-gray-200">
                                    Item da fatura
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    Parcela {installment.installmentNumber}/{installment.installmentsCount}
                                </p>
                            </div>

                            <p className="font-bold text-gray-800 dark:text-white">
                                {formatCurrency(installment.amount)}
                            </p>
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-2">
                    Pagamentos
                </p>

                {isLoadingPayments && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Carregando pagamentos...
                    </p>
                )}

                {!isLoadingPayments && payments.length === 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Nenhum pagamento registrado.
                    </p>
                )}

                <div className="space-y-2">
                    {payments.map((payment) => (
                        <div
                            key={payment.id}
                            className="flex items-center justify-between gap-3 text-sm bg-white dark:bg-dark-300 rounded-lg p-2"
                        >
                            <div>
                                <p className="font-medium text-gray-700 dark:text-gray-200">
                                    Pagamento da fatura
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {new Date(`${payment.paymentDate}T12:00:00`).toLocaleDateString('pt-BR')} · {payment.status}
                                </p>
                            </div>

                            <p className="font-bold text-green-600 dark:text-green-300">
                                {formatCurrency(payment.amount)}
                            </p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

const CreditCardsView: React.FC<CreditCardsViewProps> = ({ transactions }) => {
    // --- HOOKS DO FIRESTORE ---
    const { data: cardsData, isLoading } = useCreditCards();
    const createMutation = useCreateCreditCard();
    const updateMutation = useUpdateCreditCard();
    const deleteMutation = useDeleteCreditCard();
    const registerInvoicePaymentMutation = useRegisterCreditCardInvoicePaymentDomain();

    // Fallback para array vazio enquanto carrega ou se der erro
    const cards = cardsData || [];

    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';
    const { playSound } = useTheme();

    // --- STATE LOCAL ---
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [cardToEdit, setCardToEdit] = useState<CreditCard | null>(null);
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
    const [expandedInvoiceId, setExpandedInvoiceId] = useState<string | null>(null);
    const {
        data: selectedCardInvoicesData,
        isLoading: isLoadingSelectedCardInvoices,
    } = useOpenCreditCardInvoicesByCard(selectedCardId);

    const selectedCardInvoices = selectedCardInvoicesData || [];

    // Filter cards
    const filteredCards = useMemo(() => {
        return cards.filter(card =>
            card.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            card.brand.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [cards, searchQuery]);

    const getCardLimits = (card: CreditCard) => {
        const domainLimitUsed = typeof card.limitUsed === 'number'
            ? card.limitUsed
            : undefined;
        const domainLimitAvailable = typeof card.limitAvailable === 'number'
            ? card.limitAvailable
            : undefined;

        if (domainLimitUsed !== undefined || domainLimitAvailable !== undefined) {
            const used = domainLimitUsed ?? Math.max(card.limitTotal - (domainLimitAvailable ?? card.limitTotal), 0);
            const available = domainLimitAvailable ?? Math.max(card.limitTotal - used, 0);

            return {
                used,
                available,
            };
        }

        const usedLimit = transactions
            .filter(t => (t.type === 'despesa' || t.type === 'parcelado') && String(t.cardId) === String(card.id))
            .reduce((sum, t) => sum + t.value, 0);

        return {
            used: usedLimit,
            available: card.limitTotal - usedLimit
        };
    };

    // --- PJ REPORTS LOGIC ---
    const cardReport = useMemo(() => {
        if (!selectedCardId || !isPJ) return null;

        const cardTransactions = transactions.filter(t => String(t.cardId) === String(selectedCardId));

        const byCategory: Record<string, number> = {};
        const bySupplier: Record<string, number> = {};

        cardTransactions.forEach(t => {
            const cat = t.category || 'Outros';
            const sup = t.supplier || 'N/A';
            byCategory[cat] = (byCategory[cat] || 0) + t.value;
            if (t.supplier) bySupplier[sup] = (bySupplier[sup] || 0) + t.value;
        });

        const categoryData = Object.entries(byCategory).map(([name, value]) => ({ name, value }));
        const topSuppliers = Object.entries(bySupplier)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5);

        return { categoryData, topSuppliers };
    }, [selectedCardId, transactions, isPJ]);

    // --- HANDLERS ---

    const formatCurrency = (value: number) =>
        value.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        });

    const getTodayIsoDate = () => new Date().toISOString().split('T')[0];

    const buildInvoicePaymentIdempotencyKey = (): string => {
        const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

        return `manual-invoice-payment-${randomPart}`;
    };

    const getInvoiceStatusLabel = (status: CreditCardInvoice['status']) => {
        const labels: Record<CreditCardInvoice['status'], string> = {
            open: 'Aberta',
            closed: 'Fechada',
            partial_paid: 'Parcial',
            paid: 'Paga',
            overdue: 'Vencida',
            cancelled: 'Cancelada',
        };

        return labels[status];
    };

    const handlePayInvoice = async (invoice: CreditCardInvoice) => {
        if (invoice.remainingAmount <= 0 || invoice.status === 'paid') {
            return;
        }

        const confirmed = window.confirm(
            `Confirmar pagamento externo de ${formatCurrency(invoice.remainingAmount)} da fatura ${invoice.competenceMonth}?`,
        );

        if (!confirmed) return;

        try {
            await registerInvoicePaymentMutation.mutateAsync({
                cardId: invoice.cardId,
                invoiceId: invoice.id,
                paymentDate: getTodayIsoDate(),
                amount: invoice.remainingAmount,
                paymentMethod: 'external',
                idempotencyKey: buildInvoicePaymentIdempotencyKey(),
                correlationId: 'credit-card-view-invoice-payment',
            });

            playSound('success');
        } catch (error) {
            console.error('Erro ao pagar fatura:', error);
            alert('Erro ao pagar fatura.');
        }
    };

    const handleEdit = (card: CreditCard) => {
        setCardToEdit(card);
        setIsFormOpen(true);
        setSelectedCardId(null);
    };

    const handleDelete = (id: string) => { // Alterado para string
        if (confirm('Tem certeza que deseja excluir este cartão?')) {
            deleteMutation.mutate(id);
            playSound('success'); // Feedback
            setSelectedCardId(null);
        }
    };

    const handleSave = (card: CreditCard) => {
        // card vindo do Form. Se tiver ID numérico antigo, o form precisa lidar ou aqui convertemos
        // Mas assumindo que o form retorna o objeto completo

        if (cardToEdit) {
            updateMutation.mutate({ id: card.id, data: card });
        } else {
            // Remove o ID temporário que o frontend possa ter gerado, pois o Firestore cria um novo
            const { id, ...newCardData } = card;
            createMutation.mutate(newCardData as any);
        }

        playSound('success');
        setIsFormOpen(false);
        setCardToEdit(null);
    };

    const selectedCard = cards.find(c => c.id === selectedCardId);
    const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

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
                        <button onClick={() => setViewMode('grid')} className={`p-2 rounded-md ${viewMode === 'grid' ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500'}`}><LayoutGridIcon className="h-5 w-5" /></button>
                        <button onClick={() => setViewMode('list')} className={`p-2 rounded-md ${viewMode === 'list' ? 'bg-white dark:bg-indigo-600 shadow-sm text-indigo-600 dark:text-white' : 'text-gray-500'}`}><ListIcon className="h-5 w-5" /></button>
                    </div>

                    <button onClick={() => { setCardToEdit(null); setIsFormOpen(true); }} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center shadow-md transition-all">
                        <PlusIcon className="mr-2 h-4 w-4" /> {isPJ ? 'Novo Cartão Corp' : 'Novo Cartão'}
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                <div className={viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-6" : "space-y-3 pb-6"}>
                    {filteredCards.map(card => (
                        <CreditCard3D key={card.id} card={card} mode={viewMode} limits={getCardLimits(card)} onClick={() => {
                            setSelectedCardId(card.id);
                            setExpandedInvoiceId(null);
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
                <div className="fixed inset-0 z-40 bg-black/50 flex justify-end transition-opacity" onClick={() => setSelectedCardId(null)}>
                    <div className="w-full max-w-lg bg-white dark:bg-dark-100 h-full shadow-2xl p-6 overflow-y-auto animate-slide-in-right" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-gray-800 dark:text-white">Detalhes do Cartão</h3>
                            <button onClick={() => setSelectedCardId(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-dark-200 rounded-full transition-colors text-gray-500"><CloseIcon /></button>
                        </div>

                        <div className="mb-8 transform scale-90 sm:scale-100 origin-top-center">
                            <CreditCard3D card={selectedCard} mode="grid" limits={getCardLimits(selectedCard)} onClick={() => { }} />
                        </div>

                        <div className="space-y-6">
                            <div className="grid grid-cols-2 gap-4 bg-gray-50 dark:bg-dark-200 p-4 rounded-xl border border-gray-100">
                                <div className="col-span-2 flex items-center justify-between mb-2">
                                    <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${selectedCard.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                        {selectedCard.status === 'active' ? 'Ativo' : 'Inativo'}
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

                            <div className="space-y-3">
                                <h4 className="font-bold text-gray-800 dark:text-white flex items-center gap-2 border-b pb-2">
                                    <CurrencyDollarIcon className="w-4 h-4 text-indigo-600" /> Faturas
                                </h4>

                                {isLoadingSelectedCardInvoices && (
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                        Carregando faturas...
                                    </div>
                                )}

                                {!isLoadingSelectedCardInvoices && selectedCardInvoices.length === 0 && (
                                    <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-dark-200 p-3 rounded-lg">
                                        Nenhuma fatura aberta para este cartão.
                                    </div>
                                )}

                                {!isLoadingSelectedCardInvoices && selectedCardInvoices.map((invoice) => {
                                    const canPay = invoice.remainingAmount > 0 &&
                                        invoice.status !== 'paid' &&
                                        invoice.status !== 'cancelled';

                                    return (
                                        <div
                                            key={invoice.id}
                                            className="bg-gray-50 dark:bg-dark-200 border border-gray-100 dark:border-gray-700 rounded-xl p-4 space-y-3"
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div>
                                                    <p className="font-bold text-gray-800 dark:text-white">
                                                        Fatura {invoice.competenceMonth}
                                                    </p>
                                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                                        Vencimento: {new Date(`${invoice.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}
                                                    </p>
                                                </div>

                                                <span className="text-xs font-bold px-2 py-1 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                                                    {getInvoiceStatusLabel(invoice.status)}
                                                </span>
                                            </div>

                                            <div className="grid grid-cols-3 gap-2 text-xs">
                                                <div>
                                                    <p className="text-gray-500 dark:text-gray-400">Total</p>
                                                    <p className="font-bold">{formatCurrency(invoice.totalAmount)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-500 dark:text-gray-400">Pago</p>
                                                    <p className="font-bold">{formatCurrency(invoice.paidAmount)}</p>
                                                </div>
                                                <div>
                                                    <p className="text-gray-500 dark:text-gray-400">Restante</p>
                                                    <p className="font-bold">{formatCurrency(invoice.remainingAmount)}</p>
                                                </div>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    setExpandedInvoiceId((currentInvoiceId) =>
                                                        currentInvoiceId === invoice.id ? null : invoice.id,
                                                    )
                                                }
                                                className="w-full py-2 rounded-lg font-bold bg-white dark:bg-dark-300 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-dark-400 transition-all"
                                            >
                                                {expandedInvoiceId === invoice.id ? 'Ocultar detalhes' : 'Ver detalhes'}
                                            </button>

                                            {expandedInvoiceId === invoice.id && (
                                                <CreditCardInvoiceDetailsPanel invoiceId={invoice.id} />
                                            )}

                                            <button
                                                type="button"
                                                disabled={!canPay || registerInvoicePaymentMutation.isPending}
                                                onClick={() => handlePayInvoice(invoice)}
                                                className={`w-full py-2.5 rounded-lg font-bold transition-all ${canPay && !registerInvoicePaymentMutation.isPending
                                                    ? 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                                                    : 'bg-gray-200 dark:bg-dark-300 text-gray-400 cursor-not-allowed'
                                                    }`}
                                            >
                                                {registerInvoicePaymentMutation.isPending ? 'Processando...' : 'Pagar fatura'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>

                            {isPJ && cardReport && (
                                <div className="space-y-4">
                                    <h4 className="font-bold text-gray-800 dark:text-white flex items-center gap-2 border-b pb-2">
                                        <ChartBarIcon className="w-4 h-4 text-indigo-600" /> Relatório do Cartão
                                    </h4>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-lg border border-gray-100">
                                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Gastos por Categoria</p>
                                            <div className="h-32">
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <PieChart>
                                                        <Pie data={cardReport.categoryData} innerRadius={25} outerRadius={45} paddingAngle={2} dataKey="value">
                                                            {cardReport.categoryData.map((_, index) => (
                                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                            ))}
                                                        </Pie>
                                                        <ReTooltip contentStyle={{ fontSize: '10px' }} />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                            </div>
                                        </div>

                                        <div className="bg-gray-50 dark:bg-dark-200 p-3 rounded-lg border border-gray-100">
                                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-2">Maiores Fornecedores</p>
                                            <div className="space-y-2">
                                                {cardReport.topSuppliers.map((sup, i) => (
                                                    <div key={i} className="flex justify-between items-center text-xs">
                                                        <span className="truncate max-w-[80px] font-medium"><BuildingIcon className="w-2 h-2 inline mr-1" /> {sup.name}</span>
                                                        <span className="font-bold">R$ {sup.value.toFixed(0)}</span>
                                                    </div>
                                                ))}
                                                {cardReport.topSuppliers.length === 0 && <p className="text-[10px] text-gray-400 italic">Sem fornecedores listados.</p>}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="pt-6 border-t border-gray-100 flex gap-3">
                                <button onClick={() => handleEdit(selectedCard)} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold shadow-md transition-all flex justify-center items-center gap-2">
                                    <EditIcon className="h-4 w-4" /> Editar
                                </button>
                                <button onClick={() => handleDelete(selectedCard.id)} className="flex-1 py-2.5 bg-white dark:bg-dark-200 border border-gray-200 text-red-600 rounded-lg font-bold hover:bg-red-50 transition-all flex justify-center items-center gap-2">
                                    <DeleteIcon className="h-4 w-4" /> Excluir
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <CreditCardForm isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} onSave={handleSave} cardToEdit={cardToEdit} />

            <style>{`
                @keyframes slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
                .animate-slide-in-right { animation: slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
            `}</style>
        </div>
    );
};

export default CreditCardsView;