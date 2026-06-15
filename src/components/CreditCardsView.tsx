import React, { useMemo, useRef, useState } from 'react';
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
    useReverseCreditCardInvoicePaymentDomain,
    useCreditCardInvoiceInstallments,
    useCreditCardInvoicePayments,
    useCreditCardPurchasesByIds,
    useRecentCreditCardPurchasesByCard,
    useCancelCreditCardPurchaseDomain,
    useCloseCreditCardInvoiceDomain,
    useCreditCardAuditLogsByCard,
    useCreditCardOperationalMetrics,
    useRebuildCardInvoicesForCardDomain,
    useRecalculateCardLimitDomain,
    useReopenCreditCardInvoiceDomain,
} from '../modules/credit-cards/hooks';
import { useTheme } from '../contexts/ThemeContext.tsx';
import type {
    CreditCardInvoice,
    CreditCardInvoicePayment,
    CreditCardInvoicePaymentMethod,
    CreditCardPurchase,
} from '../modules/credit-cards/domain/types.ts';

interface CreditCardsViewProps {
    // cards e handlers removidos pois agora são gerenciados internamente via hooks
    transactions: Transaction[]; // Mantido para cálculo de limites
}

type CreditCardInvoicePaymentMode = 'total' | 'partial';

interface CreditCardInvoicePaymentDraft {
    invoice: CreditCardInvoice;
    mode: CreditCardInvoicePaymentMode;
}

interface CreditCardInvoicePaymentSubmitInput {
    invoice: CreditCardInvoice;
    amount: number;
    paymentDate: string;
    paymentMethod: CreditCardInvoicePaymentMethod;
}


const CreditCardInvoiceDetailsPanel = ({
    invoiceId,
    canManageCreditCardDomain,
    onCancelPurchase,
    onReversePayment,
    isReversingPayment,
}: {
    invoiceId: string;
    canManageCreditCardDomain: boolean;
    onCancelPurchase: (purchase: CreditCardPurchase) => void;
    onReversePayment: (payment: CreditCardInvoicePayment) => void;
    isReversingPayment: boolean;
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

    const purchaseIds = useMemo(
        () =>
            Array.from(
                new Set(
                    installments
                        .map((installment) => installment.purchaseId)
                        .filter((purchaseId): purchaseId is string => Boolean(purchaseId))
                )
            ).sort(),
        [installments]
    );

    const {
        data: purchasesData,
        isLoading: isLoadingPurchases,
    } = useCreditCardPurchasesByIds(purchaseIds);

    const purchasesById = useMemo(
        () =>
            new Map(
                (purchasesData || []).map((purchase) => [
                    purchase.id,
                    purchase,
                ])
            ),
        [purchasesData]
    );

    const formatCurrency = (value: number) =>
        value.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        });

    const getPurchaseCategoryLabel = (
        purchase?: CreditCardPurchase
    ): string | undefined => {
        const categorySnapshot = purchase?.categorySnapshot as
            | { label?: unknown }
            | undefined;

        if (typeof categorySnapshot?.label !== 'string') {
            return undefined;
        }

        const label = categorySnapshot.label.trim();

        return label || undefined;
    };

    const formatPurchaseDate = (purchase?: CreditCardPurchase): string | undefined => {
        if (!purchase?.purchaseDate) {
            return undefined;
        }

        return new Date(`${purchase.purchaseDate}T12:00:00`).toLocaleDateString('pt-BR');
    };

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
                    {installments.map((installment) => {
                        const purchase = purchasesById.get(installment.purchaseId);
                        const categoryLabel = getPurchaseCategoryLabel(purchase);
                        const purchaseDateLabel = formatPurchaseDate(purchase);

                        return (
                            <div
                                key={installment.id}
                                className="flex items-center justify-between gap-3 text-sm bg-white dark:bg-dark-300 rounded-lg p-2"
                            >
                                <div>
                                    <p className="font-medium text-gray-700 dark:text-gray-200">
                                        {purchase?.description || 'Item da fatura'}
                                    </p>

                                    <p className="text-xs text-gray-500 dark:text-gray-400">
                                        Parcela {installment.installmentNumber}/{installment.installmentsCount}
                                        {purchaseDateLabel ? ` · Compra em ${purchaseDateLabel}` : ''}
                                    </p>

                                    {(categoryLabel || purchase?.supplier || purchase?.costCenter) && (
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {[categoryLabel, purchase?.supplier, purchase?.costCenter]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </p>
                                    )}

                                    {isLoadingPurchases && (
                                        <p className="text-xs text-gray-400 dark:text-gray-500">
                                            Carregando compra original...
                                        </p>
                                    )}
                                </div>

                                <div className="flex flex-col items-end gap-2">
                                    <p className="font-bold text-gray-800 dark:text-white">
                                        {formatCurrency(installment.amount)}
                                    </p>

                                    {canManageCreditCardDomain && purchase?.status === 'active' && (
                                        <button
                                            type="button"
                                            onClick={() => onCancelPurchase(purchase)}
                                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40 transition-all"
                                        >
                                            Cancelar compra
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
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
                    {payments.map((payment) => {
                        const canReversePayment = payment.status === 'posted';

                        return (
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

                                <div className="flex flex-col items-end gap-2">
                                    <p className="font-bold text-green-600 dark:text-green-300">
                                        {formatCurrency(payment.amount)}
                                    </p>

                                    <button
                                        type="button"
                                        disabled={!canReversePayment || isReversingPayment}
                                        onClick={() => onReversePayment(payment)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${canReversePayment && !isReversingPayment
                                            ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40'
                                            : 'bg-gray-100 dark:bg-dark-400 text-gray-400 cursor-not-allowed'
                                            }`}
                                    >
                                        {payment.status === 'reversed'
                                            ? 'Estornado'
                                            : isReversingPayment
                                                ? 'Estornando...'
                                                : 'Estornar'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

const CreditCardInvoicePaymentModal = ({
    draft,
    onClose,
    onSubmit,
    isSubmitting,
}: {
    draft: CreditCardInvoicePaymentDraft;
    onClose: () => void;
    onSubmit: (input: CreditCardInvoicePaymentSubmitInput) => Promise<void> | void;
    isSubmitting: boolean;
}) => {
    const { invoice, mode } = draft;
    const [amount, setAmount] = useState(
        mode === 'total' ? invoice.remainingAmount.toFixed(2) : ''
    );
    const [paymentDate, setPaymentDate] = useState(
        new Date().toISOString().split('T')[0]
    );
    const [paymentMethod, setPaymentMethod] = useState<CreditCardInvoicePaymentMethod>('external');

    const formatCurrency = (value: number) =>
        value.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        });

    const parsedAmount = Number(amount);
    const isAmountValid =
        Number.isFinite(parsedAmount) &&
        parsedAmount > 0 &&
        parsedAmount <= invoice.remainingAmount;

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!isAmountValid) {
            alert(`Informe um valor maior que zero e menor ou igual a ${formatCurrency(invoice.remainingAmount)}.`);
            return;
        }

        const normalizedAmount = Math.round((parsedAmount + Number.EPSILON) * 100) / 100;
        const confirmed = window.confirm(
            `Confirmar pagamento de ${formatCurrency(normalizedAmount)} da fatura ${invoice.competenceMonth}?`
        );

        if (!confirmed) return;

        await onSubmit({
            invoice,
            amount: normalizedAmount,
            paymentDate,
            paymentMethod,
        });
    };

    return (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                className="w-full max-w-md bg-white dark:bg-dark-100 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-start justify-between gap-4">
                    <div>
                        <p className="text-xs font-bold uppercase text-indigo-600 dark:text-indigo-400">
                            Pagamento de fatura
                        </p>
                        <h3 className="text-xl font-bold text-gray-800 dark:text-white">
                            Fatura {invoice.competenceMonth}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Saldo atual: {formatCurrency(invoice.remainingAmount)}
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSubmitting}
                        className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-dark-200 text-gray-500 disabled:opacity-50"
                        aria-label="Fechar pagamento da fatura"
                    >
                        <CloseIcon className="w-5 h-5" />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">
                            Valor a pagar
                        </label>
                        <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            max={invoice.remainingAmount}
                            value={amount}
                            onChange={(event) => setAmount(event.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-dark-200 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder="0,00"
                            disabled={isSubmitting}
                            autoFocus={mode === 'partial'}
                        />
                        <p className={`text-xs mt-1 ${isAmountValid || !amount ? 'text-gray-500 dark:text-gray-400' : 'text-red-600 dark:text-red-300'}`}>
                            O valor deve ser maior que zero e não pode ultrapassar o saldo da fatura.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">
                            Data do pagamento
                        </label>
                        <input
                            type="date"
                            value={paymentDate}
                            onChange={(event) => setPaymentDate(event.target.value)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-dark-200 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                            disabled={isSubmitting}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1">
                            Método de pagamento
                        </label>
                        <select
                            value={paymentMethod}
                            onChange={(event) => setPaymentMethod(event.target.value as CreditCardInvoicePaymentMethod)}
                            className="w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-dark-200 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                            disabled={isSubmitting}
                        >
                            <option value="external">Pagamento externo</option>
                            <option value="manual_adjustment">Ajuste manual</option>
                        </select>
                    </div>

                    <div className="bg-gray-50 dark:bg-dark-200 rounded-xl p-4 text-sm space-y-2 border border-gray-100 dark:border-gray-700">
                        <div className="flex justify-between gap-3">
                            <span className="text-gray-500 dark:text-gray-400">Total da fatura</span>
                            <span className="font-bold text-gray-800 dark:text-white">{formatCurrency(invoice.totalAmount)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                            <span className="text-gray-500 dark:text-gray-400">Já pago</span>
                            <span className="font-bold text-gray-800 dark:text-white">{formatCurrency(invoice.paidAmount)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                            <span className="text-gray-500 dark:text-gray-400">Saldo após este pagamento</span>
                            <span className="font-bold text-gray-800 dark:text-white">
                                {formatCurrency(Math.max(invoice.remainingAmount - (isAmountValid ? parsedAmount : 0), 0))}
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="flex-1 py-3 rounded-xl font-bold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-dark-200 transition-all disabled:opacity-50"
                        >
                            Cancelar
                        </button>

                        <button
                            type="submit"
                            disabled={!isAmountValid || isSubmitting}
                            className={`flex-1 py-3 rounded-xl font-bold transition-all ${isAmountValid && !isSubmitting
                                ? 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                                : 'bg-gray-200 dark:bg-dark-300 text-gray-400 cursor-not-allowed'
                                }`}
                        >
                            {isSubmitting ? 'Processando...' : 'Confirmar pagamento'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CreditCardInvoiceDetailsDrawer = ({
    invoice,
    onClose,
    onOpenPayment,
    canManageCreditCardDomain,
    onCancelPurchase,
    onCloseInvoice,
    onReopenInvoice,
    onReversePayment,
    isPayingInvoice,
    isReversingPayment,
    isRunningAdminAction,
}: {
    invoice: CreditCardInvoice;
    canManageCreditCardDomain: boolean;
    onCancelPurchase: (purchase: CreditCardPurchase) => void;
    onClose: () => void;
    onCloseInvoice: (invoice: CreditCardInvoice) => void;
    onOpenPayment: (invoice: CreditCardInvoice, mode: CreditCardInvoicePaymentMode) => void;
    onReopenInvoice: (invoice: CreditCardInvoice) => void;
    onReversePayment: (payment: CreditCardInvoicePayment) => void;
    isPayingInvoice: boolean;
    isReversingPayment: boolean;
    isRunningAdminAction: boolean;
}) => {
    const formatCurrency = (value: number) =>
        value.toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        });

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

    const canPay = invoice.remainingAmount > 0 &&
        invoice.status !== 'paid' &&
        invoice.status !== 'cancelled';

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={onClose}>
            <div
                className="w-full max-w-2xl bg-white dark:bg-dark-100 h-full shadow-2xl overflow-y-auto animate-slide-in-right"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="sticky top-0 z-10 bg-white dark:bg-dark-100 border-b border-gray-100 dark:border-gray-700 p-6 flex items-start justify-between gap-4">
                    <div>
                        <p className="text-xs font-bold uppercase text-indigo-600 dark:text-indigo-400">
                            Detalhe da fatura
                        </p>
                        <h3 className="text-2xl font-bold text-gray-800 dark:text-white">
                            Fatura {invoice.competenceMonth}
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Vencimento em {new Date(`${invoice.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-dark-200 text-gray-500"
                        aria-label="Fechar detalhe da fatura"
                    >
                        <CloseIcon className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="bg-gray-50 dark:bg-dark-200 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                            <p className="text-xs text-gray-500 dark:text-gray-400">Competência</p>
                            <p className="font-bold text-gray-800 dark:text-white">{invoice.competenceMonth}</p>
                        </div>

                        <div className="bg-gray-50 dark:bg-dark-200 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                            <p className="text-xs text-gray-500 dark:text-gray-400">Status</p>
                            <p className="font-bold text-gray-800 dark:text-white">{getInvoiceStatusLabel(invoice.status)}</p>
                        </div>

                        <div className="bg-gray-50 dark:bg-dark-200 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                            <p className="text-xs text-gray-500 dark:text-gray-400">Fechamento</p>
                            <p className="font-bold text-gray-800 dark:text-white">
                                {new Date(`${invoice.closingDate}T12:00:00`).toLocaleDateString('pt-BR')}
                            </p>
                        </div>

                        <div className="bg-gray-50 dark:bg-dark-200 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                            <p className="text-xs text-gray-500 dark:text-gray-400">Vencimento</p>
                            <p className="font-bold text-gray-800 dark:text-white">
                                {new Date(`${invoice.dueDate}T12:00:00`).toLocaleDateString('pt-BR')}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-4 border border-indigo-100 dark:border-indigo-800">
                            <p className="text-xs text-indigo-700 dark:text-indigo-300">Total</p>
                            <p className="font-bold text-gray-800 dark:text-white">{formatCurrency(invoice.totalAmount)}</p>
                        </div>

                        <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 border border-green-100 dark:border-green-800">
                            <p className="text-xs text-green-700 dark:text-green-300">Pago</p>
                            <p className="font-bold text-gray-800 dark:text-white">{formatCurrency(invoice.paidAmount)}</p>
                        </div>

                        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-100 dark:border-amber-800">
                            <p className="text-xs text-amber-700 dark:text-amber-300">Saldo</p>
                            <p className="font-bold text-gray-800 dark:text-white">{formatCurrency(invoice.remainingAmount)}</p>
                        </div>
                    </div>

                    <CreditCardInvoiceDetailsPanel
                        invoiceId={invoice.id}
                        canManageCreditCardDomain={canManageCreditCardDomain}
                        onCancelPurchase={onCancelPurchase}
                        onReversePayment={onReversePayment}
                        isReversingPayment={isReversingPayment}
                    />

                    <div className="pt-4 border-t border-gray-100 dark:border-gray-700 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                            type="button"
                            disabled={!canPay || isPayingInvoice}
                            onClick={() => onOpenPayment(invoice, 'partial')}
                            className={`py-3 rounded-xl font-bold transition-all ${canPay && !isPayingInvoice
                                ? 'bg-white dark:bg-dark-200 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20'
                                : 'bg-gray-200 dark:bg-dark-300 text-gray-400 cursor-not-allowed'
                                }`}
                        >
                            Pagamento parcial
                        </button>

                        <button
                            type="button"
                            disabled={!canPay || isPayingInvoice}
                            onClick={() => onOpenPayment(invoice, 'total')}
                            className={`py-3 rounded-xl font-bold transition-all ${canPay && !isPayingInvoice
                                ? 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                                : 'bg-gray-200 dark:bg-dark-300 text-gray-400 cursor-not-allowed'
                                }`}
                        >
                            {invoice.status === 'paid'
                                ? 'Fatura paga'
                                : isPayingInvoice
                                    ? 'Processando...'
                                    : 'Pagar total'}
                        </button>
                    </div>


                    {canManageCreditCardDomain && (
                        <div className="pt-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
                            <p className="text-xs font-bold uppercase text-gray-500 dark:text-gray-400">
                                Ações administrativas
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <button
                                    type="button"
                                    disabled={invoice.status !== 'open' || isRunningAdminAction}
                                    onClick={() => onCloseInvoice(invoice)}
                                    className={`py-3 rounded-xl font-bold transition-all ${invoice.status === 'open' && !isRunningAdminAction
                                        ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md'
                                        : 'bg-gray-200 dark:bg-dark-300 text-gray-400 cursor-not-allowed'
                                        }`}
                                >
                                    Fechar fatura
                                </button>

                                <button
                                    type="button"
                                    disabled={invoice.status === 'paid' || invoice.status === 'cancelled' || isRunningAdminAction}
                                    onClick={() => onReopenInvoice(invoice)}
                                    className={`py-3 rounded-xl font-bold transition-all ${invoice.status !== 'paid' && invoice.status !== 'cancelled' && !isRunningAdminAction
                                        ? 'bg-white dark:bg-dark-200 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                                        : 'bg-gray-200 dark:bg-dark-300 text-gray-400 cursor-not-allowed'
                                        }`}
                                >
                                    Reabrir fatura
                                </button>
                            </div>
                        </div>
                    )}
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
    const reverseInvoicePaymentMutation = useReverseCreditCardInvoicePaymentDomain();
    const closeInvoiceMutation = useCloseCreditCardInvoiceDomain();
    const reopenInvoiceMutation = useReopenCreditCardInvoiceDomain();
    const cancelPurchaseMutation = useCancelCreditCardPurchaseDomain();
    const recalculateLimitMutation = useRecalculateCardLimitDomain();
    const rebuildInvoicesMutation = useRebuildCardInvoicesForCardDomain();

    const pendingCriticalInvoiceOperationsRef = useRef<Set<string>>(new Set());

    const runCriticalInvoiceOperation = async (
        operationKey: string,
        operation: () => Promise<void>,
    ): Promise<void> => {
        if (pendingCriticalInvoiceOperationsRef.current.has(operationKey)) {
            return;
        }

        pendingCriticalInvoiceOperationsRef.current.add(operationKey);

        try {
            await operation();
        } finally {
            pendingCriticalInvoiceOperationsRef.current.delete(operationKey);
        }
    };

    // Fallback para array vazio enquanto carrega ou se der erro
    const cards = cardsData || [];

    const { activeWorkspace, canManageActiveWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';
    const { playSound } = useTheme();

    // --- STATE LOCAL ---
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [searchQuery, setSearchQuery] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [cardToEdit, setCardToEdit] = useState<CreditCard | null>(null);
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
    const [selectedInvoiceForDetails, setSelectedInvoiceForDetails] = useState<CreditCardInvoice | null>(null);
    const [invoicePaymentDraft, setInvoicePaymentDraft] = useState<CreditCardInvoicePaymentDraft | null>(null);
    const {
        data: selectedCardInvoicesData,
        isLoading: isLoadingSelectedCardInvoices,
    } = useOpenCreditCardInvoicesByCard(selectedCardId);

    const {
        data: selectedCardRecentPurchasesData,
        isLoading: isLoadingSelectedCardRecentPurchases,
    } = useRecentCreditCardPurchasesByCard(selectedCardId);

    const selectedCardInvoices = selectedCardInvoicesData || [];
    const selectedCardRecentPurchases = selectedCardRecentPurchasesData || [];
    const {
        data: selectedCardAuditLogsData,
        isLoading: isLoadingSelectedCardAuditLogs,
    } = useCreditCardAuditLogsByCard(
        canManageActiveWorkspace ? selectedCardId : null,
        canManageActiveWorkspace
    );

    const {
        data: creditCardOperationalMetricsData,
        isLoading: isLoadingCreditCardOperationalMetrics,
    } = useCreditCardOperationalMetrics(canManageActiveWorkspace);

    const selectedCardAuditLogs = selectedCardAuditLogsData || [];
    const creditCardOperationalMetrics = creditCardOperationalMetricsData || [];

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

    const buildInvoicePaymentReversalIdempotencyKey = (): string => {
        const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

        return `manual-invoice-payment-reversal-${randomPart}`;
    };

    const buildAdminIdempotencyKey = (operation: string): string => {
        const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

        return `credit-card-admin-${operation}-${randomPart}`;
    };

    const askAdminReason = (message: string): string | null => {
        const reason = window.prompt(message);

        if (!reason || !reason.trim()) {
            return null;
        }

        return reason.trim();
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

    const handleOpenInvoicePayment = (
        invoice: CreditCardInvoice,
        mode: CreditCardInvoicePaymentMode,
    ) => {
        if (
            invoice.remainingAmount <= 0 ||
            invoice.status === 'paid' ||
            invoice.status === 'cancelled'
        ) {
            return;
        }

        const operationKey = `invoice-payment:${invoice.id}`;

        if (pendingCriticalInvoiceOperationsRef.current.has(operationKey)) {
            return;
        }

        setInvoicePaymentDraft({
            invoice,
            mode,
        });
    };

    const handleSubmitInvoicePayment = async ({
        invoice,
        amount,
        paymentDate,
        paymentMethod,
    }: CreditCardInvoicePaymentSubmitInput) => {
        if (
            amount <= 0 ||
            amount > invoice.remainingAmount ||
            invoice.status === 'paid' ||
            invoice.status === 'cancelled'
        ) {
            alert('Valor de pagamento inválido para esta fatura.');
            return;
        }

        const operationKey = `invoice-payment:${invoice.id}`;

        await runCriticalInvoiceOperation(operationKey, async () => {
            try {
                await registerInvoicePaymentMutation.mutateAsync({
                    cardId: invoice.cardId,
                    invoiceId: invoice.id,
                    paymentDate,
                    amount,
                    paymentMethod,
                    idempotencyKey: buildInvoicePaymentIdempotencyKey(),
                    correlationId: 'credit-card-view-invoice-payment',
                });

                setInvoicePaymentDraft(null);
                playSound('success');
            } catch (error) {
                console.error('Erro ao pagar fatura:', error);
                alert('Erro ao pagar fatura.');
            }
        });
    };

    const handleReverseInvoicePayment = async (payment: CreditCardInvoicePayment) => {
        if (payment.status !== 'posted') {
            return;
        }

        const operationKey = `invoice-payment-reversal:${payment.id}`;

        if (pendingCriticalInvoiceOperationsRef.current.has(operationKey)) {
            return;
        }

        const confirmed = window.confirm(
            `Confirmar estorno do pagamento de ${formatCurrency(payment.amount)}?`,
        );

        if (!confirmed) return;

        await runCriticalInvoiceOperation(operationKey, async () => {
            try {
                await reverseInvoicePaymentMutation.mutateAsync({
                    cardId: payment.cardId,
                    invoiceId: payment.invoiceId,
                    paymentId: payment.id,
                    reason: 'Estorno manual pela tela de cartões',
                    reversedAt: getTodayIsoDate(),
                    idempotencyKey: buildInvoicePaymentReversalIdempotencyKey(),
                    correlationId: 'credit-card-view-invoice-payment-reversal',
                });

                playSound('success');
            } catch (error) {
                console.error('Erro ao estornar pagamento da fatura:', error);
                alert('Erro ao estornar pagamento da fatura.');
            }
        });
    };

    const handleCloseInvoice = async (invoice: CreditCardInvoice) => {
        if (!canManageActiveWorkspace || invoice.status !== 'open') return;

        const confirmed = window.confirm(
            `Confirmar fechamento manual da fatura ${invoice.competenceMonth}?`
        );

        if (!confirmed) return;

        try {
            await closeInvoiceMutation.mutateAsync({
                cardId: invoice.cardId,
                invoiceId: invoice.id,
                closedAt: getTodayIsoDate(),
                idempotencyKey: buildAdminIdempotencyKey('close-invoice'),
                correlationId: 'credit-card-admin-close-invoice',
            });

            playSound('success');
        } catch (error) {
            console.error('Erro ao fechar fatura:', error);
            alert('Erro ao fechar fatura.');
        }
    };

    const handleReopenInvoice = async (invoice: CreditCardInvoice) => {
        if (!canManageActiveWorkspace || invoice.status === 'paid' || invoice.status === 'cancelled') {
            return;
        }

        const reason = askAdminReason('Informe o motivo para reabrir a fatura:');
        if (!reason) return;

        try {
            await reopenInvoiceMutation.mutateAsync({
                cardId: invoice.cardId,
                invoiceId: invoice.id,
                reason,
                policy: 'block_if_paid',
                idempotencyKey: buildAdminIdempotencyKey('reopen-invoice'),
                correlationId: 'credit-card-admin-reopen-invoice',
            });

            playSound('success');
        } catch (error) {
            console.error('Erro ao reabrir fatura:', error);
            alert('Erro ao reabrir fatura.');
        }
    };

    const handleCancelPurchase = async (purchase: CreditCardPurchase) => {
        if (!canManageActiveWorkspace || purchase.status !== 'active') return;

        const reason = askAdminReason(`Informe o motivo para cancelar a compra "${purchase.description}":`);
        if (!reason) return;

        try {
            await cancelPurchaseMutation.mutateAsync({
                cardId: purchase.cardId,
                purchaseId: purchase.id,
                reason,
                policy: 'block_if_invoice_paid',
                idempotencyKey: buildAdminIdempotencyKey('cancel-purchase'),
                correlationId: 'credit-card-admin-cancel-purchase',
            });

            playSound('success');
        } catch (error) {
            console.error('Erro ao cancelar compra:', error);
            alert('Erro ao cancelar compra.');
        }
    };

    const handleRecalculateLimit = async (card: CreditCard) => {
        if (!canManageActiveWorkspace) return;

        const reason = askAdminReason(`Informe o motivo para recalcular o limite do cartão "${card.name}":`);
        if (!reason) return;

        try {
            await recalculateLimitMutation.mutateAsync({
                cardId: card.id,
                reason,
                idempotencyKey: buildAdminIdempotencyKey('recalculate-limit'),
                correlationId: 'credit-card-admin-recalculate-limit',
            });

            playSound('success');
        } catch (error) {
            console.error('Erro ao recalcular limite:', error);
            alert('Erro ao recalcular limite.');
        }
    };

    const handleRebuildInvoices = async (card: CreditCard) => {
        if (!canManageActiveWorkspace) return;

        const reason = askAdminReason(`Informe o motivo para reconstruir faturas do cartão "${card.name}":`);
        if (!reason) return;

        try {
            await rebuildInvoicesMutation.mutateAsync({
                cardId: card.id,
                reason,
                idempotencyKey: buildAdminIdempotencyKey('rebuild-invoices'),
                correlationId: 'credit-card-admin-rebuild-invoices',
            });

            playSound('success');
        } catch (error) {
            console.error('Erro ao reconstruir faturas:', error);
            alert('Erro ao reconstruir faturas.');
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

    const selectedInvoiceForDetailsView = selectedInvoiceForDetails
        ? selectedCardInvoices.find((invoice) => invoice.id === selectedInvoiceForDetails.id) ?? selectedInvoiceForDetails
        : null;

    const selectedCardLimitSummary = selectedCard ? getCardLimits(selectedCard) : null;
    const selectedCardUsagePercent = selectedCard && selectedCard.limitTotal > 0 && selectedCardLimitSummary
        ? Math.round((selectedCardLimitSummary.used / selectedCard.limitTotal) * 100)
        : 0;

    const selectedCardUtilizationAlert = selectedCardUsagePercent >= 90
        ? {
            title: 'Utilização crítica do limite',
            description: 'Este cartão já consumiu 90% ou mais do limite disponível.',
            className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-900/20 dark:text-red-300',
        }
        : selectedCardUsagePercent >= 75
            ? {
                title: 'Atenção ao limite',
                description: 'Este cartão já consumiu 75% ou mais do limite disponível.',
                className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-900/20 dark:text-amber-300',
            }
            : null;

    const activeSelectedCardInvoices = useMemo(
        () =>
            selectedCardInvoices
                .filter((invoice) => invoice.status !== 'paid' && invoice.status !== 'cancelled')
                .sort((left, right) => left.dueDate.localeCompare(right.dueDate)),
        [selectedCardInvoices],
    );

    const currentSelectedCardInvoice = activeSelectedCardInvoices[0] ?? null;
    const nextSelectedCardInvoice = activeSelectedCardInvoices[1] ?? null;

    const selectedCardInvoiceHistory = useMemo(
        () =>
            selectedCardInvoices
                .filter((invoice) =>
                    invoice.id !== currentSelectedCardInvoice?.id &&
                    invoice.id !== nextSelectedCardInvoice?.id
                )
                .sort((left, right) => right.dueDate.localeCompare(left.dueDate)),
        [
            selectedCardInvoices,
            currentSelectedCardInvoice?.id,
            nextSelectedCardInvoice?.id,
        ],
    );

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
                            setSelectedInvoiceForDetails(null);
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
                    onClick={() => {
                        setSelectedCardId(null);
                        setSelectedInvoiceForDetails(null);
                    }}
                >
                    <div className="w-full max-w-lg bg-white dark:bg-dark-100 h-full shadow-2xl p-6 overflow-y-auto animate-slide-in-right" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-gray-800 dark:text-white">Detalhes do Cartão</h3>
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedCardId(null);
                                    setSelectedInvoiceForDetails(null);
                                }}
                                aria-label="Fechar detalhes do cartão"
                                className="p-2 hover:bg-gray-100 dark:hover:bg-dark-200 rounded-full transition-colors text-gray-500"
                            >
                                <CloseIcon />
                            </button>
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

                            {selectedCardUtilizationAlert && (
                                <div className={`rounded-xl border p-4 text-sm ${selectedCardUtilizationAlert.className}`}>
                                    <p className="font-bold">{selectedCardUtilizationAlert.title}</p>
                                    <p className="mt-1">{selectedCardUtilizationAlert.description}</p>
                                    <p className="mt-2 font-bold">
                                        Utilização atual: {selectedCardUsagePercent}%
                                    </p>
                                </div>
                            )}

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
                                        Nenhuma fatura encontrada para este cartão.
                                    </div>
                                )}

                                {!isLoadingSelectedCardInvoices && selectedCardInvoices.length > 0 && (
                                    <div className="space-y-4">
                                        {currentSelectedCardInvoice && (
                                            <div className="space-y-2">
                                                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">
                                                    Fatura atual
                                                </p>

                                                {(() => {
                                                    const invoice = currentSelectedCardInvoice;
                                                    const canPay = invoice.remainingAmount > 0 &&
                                                        invoice.status !== 'paid' &&
                                                        invoice.status !== 'cancelled';

                                                    return (
                                                        <div
                                                            key={invoice.id}
                                                            className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-xl p-4 space-y-3"
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
                                                                onClick={() => setSelectedInvoiceForDetails(invoice)}
                                                                className="w-full py-2 rounded-lg font-bold bg-white dark:bg-dark-300 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-dark-400 transition-all"
                                                            >
                                                                Ver detalhes da fatura
                                                            </button>

                                                            <button
                                                                type="button"
                                                                disabled={!canPay || registerInvoicePaymentMutation.isPending}
                                                                onClick={() => handleOpenInvoicePayment(invoice, 'total')}
                                                                className={`w-full py-2.5 rounded-lg font-bold transition-all ${canPay && !registerInvoicePaymentMutation.isPending
                                                                    ? 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                                                                    : 'bg-gray-200 dark:bg-dark-300 text-gray-400 cursor-not-allowed'
                                                                    }`}
                                                            >
                                                                {invoice.status === 'paid'
                                                                    ? 'Fatura paga'
                                                                    : registerInvoicePaymentMutation.isPending
                                                                        ? 'Processando...'
                                                                        : 'Pagar total'}
                                                            </button>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}

                                        {nextSelectedCardInvoice && (
                                            <div className="space-y-2">
                                                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">
                                                    Próxima fatura
                                                </p>

                                                {(() => {
                                                    const invoice = nextSelectedCardInvoice;

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
                                                                onClick={() => setSelectedInvoiceForDetails(invoice)}
                                                                className="w-full py-2 rounded-lg font-bold bg-white dark:bg-dark-300 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-dark-400 transition-all"
                                                            >
                                                                Ver detalhes da fatura
                                                            </button>

                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}

                                        {selectedCardInvoiceHistory.length > 0 && (
                                            <div className="space-y-2">
                                                <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">
                                                    Histórico de faturas
                                                </p>

                                                {selectedCardInvoiceHistory.map((invoice) => {
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
                                                                onClick={() => setSelectedInvoiceForDetails(invoice)}
                                                                className="w-full py-2 rounded-lg font-bold bg-white dark:bg-dark-300 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-dark-400 transition-all"
                                                            >
                                                                Ver detalhes da fatura
                                                            </button>

                                                            <button
                                                                type="button"
                                                                disabled={!canPay || registerInvoicePaymentMutation.isPending}
                                                                onClick={() => handleOpenInvoicePayment(invoice, 'total')}
                                                                className={`w-full py-2.5 rounded-lg font-bold transition-all ${canPay && !registerInvoicePaymentMutation.isPending
                                                                    ? 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                                                                    : 'bg-gray-200 dark:bg-dark-300 text-gray-400 cursor-not-allowed'
                                                                    }`}
                                                            >
                                                                {invoice.status === 'paid'
                                                                    ? 'Fatura paga'
                                                                    : registerInvoicePaymentMutation.isPending
                                                                        ? 'Processando...'
                                                                        : 'Pagar total'}
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {isPJ && cardReport && (
                                <div className="space-y-3">
                                    <h4 className="font-bold text-gray-800 dark:text-white flex items-center gap-2 border-b pb-2">
                                        <ChartBarIcon className="w-4 h-4 text-indigo-600" /> Compras recentes
                                    </h4>

                                    {isLoadingSelectedCardRecentPurchases && (
                                        <div className="text-sm text-gray-500 dark:text-gray-400">
                                            Carregando compras recentes...
                                        </div>
                                    )}

                                    {!isLoadingSelectedCardRecentPurchases && selectedCardRecentPurchases.length === 0 && (
                                        <div className="text-sm text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-dark-200 p-3 rounded-lg">
                                            Nenhuma compra recente neste cartão.
                                        </div>
                                    )}

                                    {!isLoadingSelectedCardRecentPurchases && selectedCardRecentPurchases.length > 0 && (
                                        <div className="space-y-2">
                                            {selectedCardRecentPurchases.map((purchase) => (
                                                <div
                                                    key={purchase.id}
                                                    className="flex items-center justify-between gap-3 text-sm bg-gray-50 dark:bg-dark-200 border border-gray-100 dark:border-gray-700 rounded-lg p-3"
                                                >
                                                    <div>
                                                        <p className="font-bold text-gray-800 dark:text-white">
                                                            {purchase.description}
                                                        </p>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                                            {new Date(`${purchase.purchaseDate}T12:00:00`).toLocaleDateString('pt-BR')}
                                                            {' · '}
                                                            {purchase.installmentsCount === 1
                                                                ? 'À vista no cartão'
                                                                : `${purchase.installmentsCount} parcelas`}
                                                        </p>
                                                    </div>

                                                    <p className="font-bold text-gray-800 dark:text-white">
                                                        {formatCurrency(purchase.totalAmount)}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {canManageActiveWorkspace && (
                                <div className="space-y-3 border-t border-gray-100 dark:border-gray-700 pt-6">
                                    <h4 className="font-bold text-gray-800 dark:text-white">
                                        Administração
                                    </h4>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            disabled={recalculateLimitMutation.isPending}
                                            onClick={() => handleRecalculateLimit(selectedCard)}
                                            className="py-2.5 rounded-lg font-bold bg-white dark:bg-dark-200 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-dark-300 transition-all disabled:opacity-50"
                                        >
                                            Recalcular limite
                                        </button>

                                        <button
                                            type="button"
                                            disabled={rebuildInvoicesMutation.isPending}
                                            onClick={() => handleRebuildInvoices(selectedCard)}
                                            className="py-2.5 rounded-lg font-bold bg-white dark:bg-dark-200 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-dark-300 transition-all disabled:opacity-50"
                                        >
                                            Rebuild de faturas
                                        </button>
                                    </div>

                                    <details className="bg-gray-50 dark:bg-dark-200 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
                                        <summary className="cursor-pointer font-bold text-sm text-gray-700 dark:text-gray-200">
                                            Audit logs recentes
                                        </summary>

                                        <div className="mt-3 space-y-2">
                                            {isLoadingSelectedCardAuditLogs && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    Carregando auditoria...
                                                </p>
                                            )}

                                            {!isLoadingSelectedCardAuditLogs && selectedCardAuditLogs.length === 0 && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    Nenhum audit log encontrado.
                                                </p>
                                            )}

                                            {selectedCardAuditLogs.map((auditLog) => (
                                                <div
                                                    key={auditLog.id}
                                                    className="text-xs bg-white dark:bg-dark-300 rounded-lg p-3 border border-gray-100 dark:border-gray-700"
                                                >
                                                    <p className="font-bold text-gray-800 dark:text-white">
                                                        {auditLog.action}
                                                    </p>
                                                    <p className="text-gray-500 dark:text-gray-400">
                                                        Usuário: {auditLog.actorId || 'N/A'}
                                                    </p>
                                                    {auditLog.reason && (
                                                        <p className="text-gray-500 dark:text-gray-400">
                                                            Motivo: {auditLog.reason}
                                                        </p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </details>

                                    <details className="bg-gray-50 dark:bg-dark-200 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
                                        <summary className="cursor-pointer font-bold text-sm text-gray-700 dark:text-gray-200">
                                            Métricas operacionais
                                        </summary>

                                        <div className="mt-3 space-y-2">
                                            {isLoadingCreditCardOperationalMetrics && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    Carregando métricas...
                                                </p>
                                            )}

                                            {!isLoadingCreditCardOperationalMetrics && creditCardOperationalMetrics.length === 0 && (
                                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                                    Nenhuma métrica operacional encontrada.
                                                </p>
                                            )}

                                            {creditCardOperationalMetrics
                                                .filter((metric) => !metric.lastCardId || metric.lastCardId === selectedCard.id)
                                                .map((metric) => (
                                                    <div
                                                        key={metric.id}
                                                        className="text-xs bg-white dark:bg-dark-300 rounded-lg p-3 border border-gray-100 dark:border-gray-700"
                                                    >
                                                        <p className="font-bold text-gray-800 dark:text-white">
                                                            {metric.operation} · {metric.status}
                                                        </p>
                                                        <p className="text-gray-500 dark:text-gray-400">
                                                            Data: {metric.date} · Ocorrências: {metric.count}
                                                        </p>
                                                        {typeof metric.amountTotal === 'number' && (
                                                            <p className="text-gray-500 dark:text-gray-400">
                                                                Valor total: {formatCurrency(metric.amountTotal)}
                                                            </p>
                                                        )}
                                                    </div>
                                                ))}
                                        </div>
                                    </details>
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

            {selectedInvoiceForDetailsView && (
                <CreditCardInvoiceDetailsDrawer
                    invoice={selectedInvoiceForDetailsView}
                    canManageCreditCardDomain={canManageActiveWorkspace}
                    onCancelPurchase={handleCancelPurchase}
                    onClose={() => setSelectedInvoiceForDetails(null)}
                    onCloseInvoice={handleCloseInvoice}
                    onOpenPayment={handleOpenInvoicePayment}
                    onReopenInvoice={handleReopenInvoice}
                    onReversePayment={handleReverseInvoicePayment}
                    isPayingInvoice={registerInvoicePaymentMutation.isPending}
                    isReversingPayment={reverseInvoicePaymentMutation.isPending}
                    isRunningAdminAction={
                        closeInvoiceMutation.isPending ||
                        reopenInvoiceMutation.isPending ||
                        cancelPurchaseMutation.isPending
                    }
                />
            )}

            {invoicePaymentDraft && (
                <CreditCardInvoicePaymentModal
                    draft={invoicePaymentDraft}
                    onClose={() => {
                        if (!registerInvoicePaymentMutation.isPending) {
                            setInvoicePaymentDraft(null);
                        }
                    }}
                    onSubmit={handleSubmitInvoicePayment}
                    isSubmitting={registerInvoicePaymentMutation.isPending}
                />
            )}

            <CreditCardForm
                isOpen={isFormOpen}
                onClose={() => {
                    setIsFormOpen(false);
                    setCardToEdit(null);
                }}
                onSave={handleSave}
                cardToEdit={cardToEdit}
            />

            <style>{`
                @keyframes slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
                .animate-slide-in-right { animation: slide-in-right 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
            `}</style>
        </div>
    );
};

export default CreditCardsView;