import React, { useEffect, useMemo, useRef, useState } from 'react';

import { CloseIcon } from '../Icons.tsx';
import { useCardDialogFocus } from './useCardDialogFocus.ts';
import CashAccountSelect from '../accounts/CashAccountSelect.tsx';
import { formatCents, formatDayKey, saoPauloToday } from '../../modules/loans/money.ts';
import { formatCompetence } from '../../modules/cards/cycle.ts';
import {
  amountInputToCents,
  centsToNumberInput,
  toInvoicePaymentPayload,
} from '../../modules/cards/payloads.ts';
import { PAYMENT_EXPLANATION, cardsErrorView, payableCents } from '../../modules/cards/presentation.ts';
import { useCardsIntentKey, useRegisterInvoicePayment } from '../../modules/cards/hooks.ts';
import type { CardInvoice } from '../../modules/cards/types.ts';

/**
 * Pagamento de fatura fechada (P4-A, D-36): total ou parcial, a partir de uma
 * conta ativa (D-30). O valor vira centavos por leitura de texto; o backend
 * recusa fatura aberta e valor acima do saldo. Mesma chave de idempotência
 * para o mesmo conteúdo reenviado; duplo clique barrado de forma síncrona.
 * Moldura e classes do modal de pagamento que a tela já tinha.
 */
export type InvoicePaymentMode = 'total' | 'partial';

interface CardInvoicePaymentModalProps {
  invoice: CardInvoice;
  mode: InvoicePaymentMode;
  workspaceId: string;
  onClose: () => void;
  onPaid: () => void;
}

const inputClass = 'w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-dark-200 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none';
const labelClass = 'block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1';

const CardInvoicePaymentModal: React.FC<CardInvoicePaymentModalProps> = ({
  invoice, mode, workspaceId, onClose, onPaid,
}) => {
  const payable = payableCents(invoice);
  const today = saoPauloToday();
  const [amount, setAmount] = useState(mode === 'total' ? centsToNumberInput(payable) : '');
  const [paymentDate, setPaymentDate] = useState(today < invoice.closingDate ? invoice.closingDate : today);
  const [cashAccountId, setCashAccountId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useRegisterInvoicePayment();
  const intent = useCardsIntentKey();
  const submittingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    intent.reset();
  }, [intent, invoice.id]);

  const amountCents = useMemo(() => amountInputToCents(amount), [amount]);
  const isAmountValid = amountCents !== null && amountCents > 0 && amountCents <= payable;
  const busy = mutation.isPending;
  useCardDialogFocus(panelRef, onClose, busy);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || busy) return;
    if (!isAmountValid) {
      setError(`Informe um valor maior que zero e menor ou igual a ${formatCents(payable)}.`);
      return;
    }
    submittingRef.current = true;
    setError(null);
    try {
      const payload = toInvoicePaymentPayload({
        workspaceId,
        invoice,
        cashAccountId,
        amount,
        paymentDate,
      });
      const idempotencyKey = intent.keyFor('registerInvoicePayment', payload);
      await mutation.mutateAsync({ payload, idempotencyKey });
      intent.reset();
      onPaid();
    } catch (caught) {
      setError(cardsErrorView(caught).message);
    } finally {
      submittingRef.current = false;
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4" onClick={() => { if (!busy) onClose(); }}>
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Pagamento da fatura ${formatCompetence(invoice.competenceMonth)}`}
        className="w-full max-w-md bg-white dark:bg-dark-100 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase text-indigo-600 dark:text-indigo-400">
              Pagamento de fatura
            </p>
            <h3 className="text-xl font-bold text-gray-800 dark:text-white">
              Fatura {formatCompetence(invoice.competenceMonth)}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Saldo atual: {formatCents(payable)}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-dark-200 text-gray-500 disabled:opacity-50"
            aria-label="Fechar pagamento da fatura"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label htmlFor="card-payment-amount" className={labelClass}>
              Valor a pagar
            </label>
            <input
              id="card-payment-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={inputClass}
              placeholder="0,00"
              disabled={busy}
              autoFocus={mode === 'partial'}
            />
            <p className={`text-xs mt-1 ${isAmountValid || !amount ? 'text-gray-500 dark:text-gray-400' : 'text-red-600 dark:text-red-300'}`}>
              O valor deve ser maior que zero e não pode ultrapassar o saldo da fatura.
            </p>
          </div>

          <div>
            <label htmlFor="card-payment-date" className={labelClass}>
              Data do pagamento
            </label>
            <input
              id="card-payment-date"
              type="date"
              value={paymentDate}
              min={invoice.closingDate}
              max={today}
              onChange={(event) => setPaymentDate(event.target.value)}
              className={inputClass}
              disabled={busy}
            />
          </div>

          <CashAccountSelect
            id="card-payment-account"
            label="Conta de origem"
            value={cashAccountId}
            onChange={setCashAccountId}
            disabled={busy}
            autoSelect
            labelClassName={labelClass}
            selectClassName={inputClass}
            hintClassName="text-xs mt-1 text-gray-500 dark:text-gray-400"
          />

          <div className="bg-gray-50 dark:bg-dark-200 rounded-xl p-4 text-sm space-y-2 border border-gray-100 dark:border-gray-700">
            <div className="flex justify-between gap-3">
              <span className="text-gray-500 dark:text-gray-400">Total da fatura</span>
              <span className="font-bold text-gray-800 dark:text-white">{formatCents(Math.max(invoice.totalCents, 0))}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500 dark:text-gray-400">Já pago</span>
              <span className="font-bold text-gray-800 dark:text-white">{formatCents(invoice.paidCents)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray-500 dark:text-gray-400">Saldo após este pagamento</span>
              <span className="font-bold text-gray-800 dark:text-white">
                {formatCents(Math.max(payable - (isAmountValid ? amountCents : 0), 0))}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 pt-1">
              Vencimento em {formatDayKey(invoice.dueDate)}. {PAYMENT_EXPLANATION}
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-300">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="flex-1 py-3 rounded-xl font-bold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-dark-200 transition-all disabled:opacity-50"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={!isAmountValid || !cashAccountId || busy}
              aria-busy={busy}
              className={`flex-1 py-3 rounded-xl font-bold transition-all ${isAmountValid && cashAccountId && !busy
                ? 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                : 'bg-gray-200 dark:bg-dark-300 text-gray-400 cursor-not-allowed'
              }`}
            >
              {busy ? 'Processando...' : 'Confirmar pagamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CardInvoicePaymentModal;
