import React, { useEffect, useMemo, useRef, useState } from 'react';

import { CloseIcon } from '../Icons.tsx';
import { useCardDialogFocus } from './useCardDialogFocus.ts';
import { saoPauloToday } from '../../modules/loans/money.ts';
import {
  firstOpenCompetence,
  formatCompetence,
} from '../../modules/cards/cycle.ts';
import {
  adjustmentCompetences,
  amountInputToCents,
  toAdjustmentPayload,
  CARD_TEXT_LIMITS,
} from '../../modules/cards/payloads.ts';
import {
  ADJUSTMENT_EXPLANATION,
  adjustmentEffect,
  cardsErrorView,
} from '../../modules/cards/presentation.ts';
import { useCardsIntentKey, useCreateInvoiceAdjustment } from '../../modules/cards/hooks.ts';
import type { CreditCard } from '../../modules/cards/types.ts';

/**
 * Ajuste manual de fatura (P4-A, D-36), só owner/admin: competência, valor
 * com sinal (débito aumenta, crédito reduz), motivo obrigatório e o efeito
 * esperado antes de confirmar. Nunca é pagamento: não movimenta contas. Em
 * competência já fechada, o backend publica a compensação na primeira fatura
 * aberta. Mesma moldura do modal de pagamento da tela.
 */
interface CardAdjustmentModalProps {
  card: CreditCard;
  workspaceId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}

const inputClass = 'w-full px-4 py-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-dark-200 text-gray-800 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none';
const labelClass = 'block text-sm font-bold text-gray-700 dark:text-gray-200 mb-1';

const CardAdjustmentModal: React.FC<CardAdjustmentModalProps> = ({ card, workspaceId, onClose, onDone }) => {
  const today = saoPauloToday();
  const open = firstOpenCompetence(today, card.closingDay);
  const competences = useMemo(() => adjustmentCompetences(today, card.closingDay), [today, card.closingDay]);
  const [competenceMonth, setCompetenceMonth] = useState(open);
  const [direction, setDirection] = useState<'debit' | 'credit'>('debit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useCreateInvoiceAdjustment();
  const intent = useCardsIntentKey();
  const submittingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const busy = mutation.isPending;
  useCardDialogFocus(panelRef, onClose, busy);

  useEffect(() => {
    intent.reset();
  }, [intent, card.id]);

  const cents = amountInputToCents(amount);
  const signed = cents ? (direction === 'credit' ? -cents : cents) : null;
  // Competência anterior à aberta já fechou: a compensação vai para a aberta.
  const target = competenceMonth < open ? open : competenceMonth;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submittingRef.current || busy) return;
    submittingRef.current = true;
    setError(null);
    try {
      const payload = toAdjustmentPayload({
        workspaceId,
        cardId: card.id,
        competenceMonth,
        amount,
        direction,
        reason,
      });
      const idempotencyKey = intent.keyFor('createCreditCardInvoiceAdjustment', payload);
      const result = await mutation.mutateAsync({ payload, idempotencyKey });
      intent.reset();
      onDone(result.compensated
        ? `Ajuste lançado na fatura aberta de ${formatCompetence(result.competenceMonth ?? target)}.`
        : 'Ajuste lançado na fatura.');
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
        aria-label="Ajuste manual de fatura"
        className="w-full max-w-md bg-white dark:bg-dark-100 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 overflow-hidden outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase text-indigo-600 dark:text-indigo-400">
              Ajuste manual
            </p>
            <h3 className="text-xl font-bold text-gray-800 dark:text-white">{card.name}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{ADJUSTMENT_EXPLANATION}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-dark-200 text-gray-500 disabled:opacity-50"
            aria-label="Fechar ajuste manual"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label htmlFor="card-adjustment-competence" className={labelClass}>Competência da fatura</label>
            <select
              id="card-adjustment-competence"
              value={competenceMonth}
              onChange={(event) => setCompetenceMonth(event.target.value)}
              className={inputClass}
              disabled={busy}
            >
              {competences.map((competence) => (
                <option key={competence} value={competence}>
                  {formatCompetence(competence)}{competence < open ? ' (fechada)' : competence === open ? ' (aberta)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className={labelClass}>Tipo do ajuste</span>
            <div className="flex gap-4 text-sm text-gray-700 dark:text-gray-300">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="card-adjustment-direction" checked={direction === 'debit'} onChange={() => setDirection('debit')} disabled={busy} />
                Débito (aumenta a fatura)
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="card-adjustment-direction" checked={direction === 'credit'} onChange={() => setDirection('credit')} disabled={busy} />
                Crédito (reduz a fatura)
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="card-adjustment-amount" className={labelClass}>Valor (R$)</label>
            <input
              id="card-adjustment-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={inputClass}
              placeholder="0,00"
              disabled={busy}
            />
          </div>

          <div>
            <label htmlFor="card-adjustment-reason" className={labelClass}>Motivo <span className="text-red-500">*</span></label>
            <textarea
              id="card-adjustment-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={CARD_TEXT_LIMITS.reason}
              rows={2}
              className={`${inputClass} resize-none`}
              placeholder="Ex.: tarifa de anuidade lançada pelo banco"
              disabled={busy}
            />
          </div>

          {signed !== null && (
            <p className="bg-gray-50 dark:bg-dark-200 rounded-xl p-4 text-sm border border-gray-100 dark:border-gray-700 text-gray-700 dark:text-gray-200">
              {adjustmentEffect(signed, competenceMonth, target)}
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-300">{error}</p>
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
              disabled={busy || signed === null || reason.trim().length < 3}
              aria-busy={busy}
              className={`flex-1 py-3 rounded-xl font-bold transition-all ${!busy && signed !== null && reason.trim().length >= 3
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md'
                : 'bg-gray-200 dark:bg-dark-300 text-gray-400 cursor-not-allowed'
              }`}
            >
              {busy ? 'Processando...' : 'Lançar ajuste'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CardAdjustmentModal;
