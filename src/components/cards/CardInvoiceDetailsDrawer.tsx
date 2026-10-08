import React, { useMemo, useRef, useState } from 'react';

import { CloseIcon } from '../Icons.tsx';
import ClientsConfirmModal from '../clients/ClientsConfirmModal.tsx';
import { useCashAccounts } from '../../modules/accounts/hooks.ts';
import { formatCents, formatDayKey, saoPauloToday } from '../../modules/loans/money.ts';
import { firstOpenCompetence, formatCompetence } from '../../modules/cards/cycle.ts';
import {
  toPurchaseMutationPayload,
  toReversePaymentPayload,
} from '../../modules/cards/payloads.ts';
import {
  INVOICE_STATUS_LABELS,
  REVERSAL_EXPLANATION,
  canPayInvoice,
  cardsErrorView,
  entryLabel,
  entryNote,
  invoiceDisplayStatus,
  payableCents,
} from '../../modules/cards/presentation.ts';
import {
  useCancelCardPurchase,
  useCardsIntentKey,
  useInvoiceEntries,
  useInvoicePayments,
  usePurchasesByIds,
  useRefundCardPurchase,
  useReverseInvoicePayment,
} from '../../modules/cards/hooks.ts';
import type { CardInvoice, CardPayment, CardPurchase, CreditCard } from '../../modules/cards/types.ts';
import type { InvoicePaymentMode } from './CardInvoicePaymentModal.tsx';

/**
 * Detalhe da fatura (P4-A, D-36): lançamentos com sinal (parcelas, ajustes,
 * créditos de estorno e transporte), pagamentos e estornos. Owner/admin
 * cancelam a compra com todas as parcelas abertas ou estornam a já faturada
 * (crédito na fatura aberta), e estornam pagamentos na conta original. Não
 * há fechamento nem reabertura manual: o ciclo é decidido pela data.
 */
interface CardInvoiceDetailsDrawerProps {
  invoice: CardInvoice;
  card: CreditCard;
  workspaceId: string;
  canManage: boolean;
  onClose: () => void;
  onOpenPayment: (invoice: CardInvoice, mode: InvoicePaymentMode) => void;
  onNotify: (message: string) => void;
}

type PurchaseAction = { purchase: CardPurchase; kind: 'cancel' | 'refund' };

const CardInvoiceDetailsDrawer: React.FC<CardInvoiceDetailsDrawerProps> = ({
  invoice, card, workspaceId, canManage, onClose, onOpenPayment, onNotify,
}) => {
  const today = saoPauloToday();
  const entries = useInvoiceEntries(invoice.id);
  const payments = useInvoicePayments(invoice.id);
  const accounts = useCashAccounts();
  const entryItems = useMemo(() => entries.data?.items ?? [], [entries.data]);
  const paymentItems = payments.data?.items ?? [];
  const purchaseIds = useMemo(
    () => entryItems.map((entry) => entry.purchaseId).filter((id): id is string => Boolean(id)),
    [entryItems],
  );
  const purchases = usePurchasesByIds(purchaseIds);
  const purchasesById = useMemo(
    () => new Map((purchases.data ?? []).map((purchase) => [purchase.id, purchase])),
    [purchases.data],
  );
  const accountNames = useMemo(
    () => new Map((accounts.data?.items ?? []).map((account) => [account.id, account.name])),
    [accounts.data],
  );

  const cancelMutation = useCancelCardPurchase();
  const refundMutation = useRefundCardPurchase();
  const reverseMutation = useReverseInvoicePayment();
  const purchaseIntent = useCardsIntentKey();
  const reverseIntent = useCardsIntentKey();
  const submittingRef = useRef(false);
  const [purchaseAction, setPurchaseAction] = useState<PurchaseAction | null>(null);
  const [paymentToReverse, setPaymentToReverse] = useState<CardPayment | null>(null);

  const status = invoiceDisplayStatus(invoice, today);
  const canPay = canManage && canPayInvoice(invoice, today);
  const openCompetence = firstOpenCompetence(today, card.closingDay);

  /** Faturada = a primeira parcela vigente já está numa fatura fechada. */
  const purchaseActionKind = (purchase: CardPurchase): 'cancel' | 'refund' =>
    purchase.firstCompetence < openCompetence ? 'refund' : 'cancel';

  const confirmPurchaseAction = async (): Promise<string | null> => {
    if (!purchaseAction || submittingRef.current) return null;
    submittingRef.current = true;
    try {
      const payload = toPurchaseMutationPayload({
        workspaceId,
        purchaseId: purchaseAction.purchase.id,
        version: purchaseAction.purchase.version,
      });
      const operation = purchaseAction.kind === 'cancel'
        ? 'cancelCreditCardPurchase'
        : 'refundCreditCardPurchase';
      const idempotencyKey = purchaseIntent.keyFor(operation, payload);
      const mutation = purchaseAction.kind === 'cancel' ? cancelMutation : refundMutation;
      await mutation.mutateAsync({ payload, idempotencyKey });
      purchaseIntent.reset();
      onNotify(purchaseAction.kind === 'cancel' ? 'Compra cancelada.' : 'Compra estornada.');
      setPurchaseAction(null);
      return null;
    } catch (caught) {
      return cardsErrorView(caught).message;
    } finally {
      submittingRef.current = false;
    }
  };

  const confirmReversal = async (): Promise<string | null> => {
    if (!paymentToReverse || submittingRef.current) return null;
    submittingRef.current = true;
    try {
      const payload = toReversePaymentPayload({ workspaceId, invoice, paymentId: paymentToReverse.id });
      const idempotencyKey = reverseIntent.keyFor('reverseInvoicePayment', payload);
      await reverseMutation.mutateAsync({ payload, idempotencyKey });
      reverseIntent.reset();
      onNotify('Pagamento estornado.');
      setPaymentToReverse(null);
      return null;
    } catch (caught) {
      return cardsErrorView(caught).message;
    } finally {
      submittingRef.current = false;
    }
  };

  const competenceLabel = formatCompetence(invoice.competenceMonth);

  return (
    <div
      data-testid={`credit-card-invoice-details-drawer-${invoice.id}`}
      className="fixed inset-0 z-50 bg-black/50 flex justify-end"
      onClick={onClose}
    >
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
              Fatura {competenceLabel}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Vencimento em {formatDayKey(invoice.dueDate)}
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
              <p className="font-bold text-gray-800 dark:text-white">{competenceLabel}</p>
            </div>
            <div className="bg-gray-50 dark:bg-dark-200 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">Status</p>
              <p className="font-bold text-gray-800 dark:text-white" data-testid="card-invoice-status">
                {INVOICE_STATUS_LABELS[status]}
              </p>
            </div>
            <div className="bg-gray-50 dark:bg-dark-200 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">Fechamento</p>
              <p className="font-bold text-gray-800 dark:text-white">{formatDayKey(invoice.closingDate)}</p>
            </div>
            <div className="bg-gray-50 dark:bg-dark-200 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
              <p className="text-xs text-gray-500 dark:text-gray-400">Vencimento</p>
              <p className="font-bold text-gray-800 dark:text-white">{formatDayKey(invoice.dueDate)}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-4 border border-indigo-100 dark:border-indigo-800">
              <p className="text-xs text-indigo-700 dark:text-indigo-300">Total</p>
              <p className="font-bold text-gray-800 dark:text-white" data-testid="card-invoice-total">{formatCents(invoice.totalCents)}</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 border border-green-100 dark:border-green-800">
              <p className="text-xs text-green-700 dark:text-green-300">Pago</p>
              <p className="font-bold text-gray-800 dark:text-white" data-testid="card-invoice-paid">{formatCents(invoice.paidCents)}</p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 border border-amber-100 dark:border-amber-800">
              <p className="text-xs text-amber-700 dark:text-amber-300">Saldo</p>
              <p className="font-bold text-gray-800 dark:text-white" data-testid="card-invoice-remaining">{formatCents(payableCents(invoice))}</p>
            </div>
          </div>

          <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3 space-y-4">
            <div>
              <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-2">
                Itens da fatura
              </p>

              {entries.isLoading && (
                <p className="text-xs text-gray-500 dark:text-gray-400">Carregando itens...</p>
              )}
              {entries.isError && (
                <p role="alert" className="text-xs text-red-600 dark:text-red-300">Não foi possível carregar os itens.</p>
              )}
              {!entries.isLoading && entryItems.length === 0 && !entries.isError && (
                <p className="text-xs text-gray-500 dark:text-gray-400">Nenhum item encontrado.</p>
              )}
              {entries.data?.truncated && (
                <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
                  Mostrando os primeiros 500 itens desta fatura.
                </p>
              )}

              <div className="space-y-2">
                {entryItems.map((entry) => {
                  const purchase = entry.purchaseId ? purchasesById.get(entry.purchaseId) : undefined;
                  const note = entryNote(entry);
                  const canAct = canManage && entry.kind === 'installment' && purchase?.status === 'active';
                  return (
                    <div
                      key={entry.id}
                      data-testid="card-invoice-entry"
                      className="flex items-center justify-between gap-3 text-sm bg-white dark:bg-dark-300 rounded-lg p-2"
                    >
                      <div>
                        <p className="font-medium text-gray-700 dark:text-gray-200">{entryLabel(entry, purchase)}</p>
                        {purchase && entry.kind === 'installment' && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Compra em {formatDayKey(purchase.purchaseDate)}
                            {[purchase.category, purchase.supplier, purchase.costCenter].filter(Boolean).length > 0
                              ? ` · ${[purchase.category, purchase.supplier, purchase.costCenter].filter(Boolean).join(' · ')}`
                              : ''}
                          </p>
                        )}
                        {note && <p className="text-xs text-gray-500 dark:text-gray-400">{note}</p>}
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <p className={`font-bold ${entry.amountCents < 0 ? 'text-green-600 dark:text-green-300' : 'text-gray-800 dark:text-white'}`}>
                          {formatCents(entry.amountCents)}
                        </p>
                        {canAct && purchase && (
                          <button
                            type="button"
                            onClick={() => setPurchaseAction({ purchase, kind: purchaseActionKind(purchase) })}
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40 transition-all"
                          >
                            {purchaseActionKind(purchase) === 'cancel' ? 'Cancelar compra' : 'Estornar compra'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase mb-2">Pagamentos</p>

              {payments.isLoading && (
                <p className="text-xs text-gray-500 dark:text-gray-400">Carregando pagamentos...</p>
              )}
              {!payments.isLoading && paymentItems.length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">Nenhum pagamento registrado.</p>
              )}

              <div className="space-y-2">
                {paymentItems.map((payment) => {
                  const reversible = canManage && payment.kind === 'payment' && !payment.reversedBy;
                  const account = accountNames.get(payment.cashAccountId) ?? 'Conta';
                  return (
                    <div
                      key={payment.id}
                      data-testid="card-invoice-payment"
                      className="flex items-center justify-between gap-3 text-sm bg-white dark:bg-dark-300 rounded-lg p-2"
                    >
                      <div>
                        <p className="font-medium text-gray-700 dark:text-gray-200">
                          {payment.kind === 'payment' ? 'Pagamento da fatura' : 'Estorno de pagamento'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDayKey(payment.paymentDate)} · {account}
                          {payment.kind === 'payment' && payment.reversedBy ? ' · Estornado' : ''}
                        </p>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <p className={`font-bold ${payment.kind === 'payment' ? 'text-green-600 dark:text-green-300' : 'text-red-600 dark:text-red-300'}`}>
                          {payment.kind === 'payment' ? formatCents(payment.amountCents) : formatCents(-payment.amountCents)}
                        </p>
                        {canManage && payment.kind === 'payment' && (
                          <button
                            type="button"
                            disabled={!reversible}
                            onClick={() => setPaymentToReverse(payment)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${reversible
                              ? 'bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40'
                              : 'bg-gray-100 dark:bg-dark-400 text-gray-400 cursor-not-allowed'
                            }`}
                          >
                            {payment.reversedBy ? 'Estornado' : 'Estornar'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {canManage && (
            <div className="pt-4 border-t border-gray-100 dark:border-gray-700 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                disabled={!canPay}
                onClick={() => onOpenPayment(invoice, 'partial')}
                className={`py-3 rounded-xl font-bold transition-all ${canPay
                  ? 'bg-white dark:bg-dark-200 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 hover:bg-green-50 dark:hover:bg-green-900/20'
                  : 'bg-gray-200 dark:bg-dark-300 text-gray-400 cursor-not-allowed'
                }`}
              >
                Pagamento parcial
              </button>

              <button
                type="button"
                disabled={!canPay}
                onClick={() => onOpenPayment(invoice, 'total')}
                className={`py-3 rounded-xl font-bold transition-all ${canPay
                  ? 'bg-green-600 hover:bg-green-700 text-white shadow-md'
                  : 'bg-gray-200 dark:bg-dark-300 text-gray-400 cursor-not-allowed'
                }`}
              >
                {status === 'paid' ? 'Fatura paga' : status === 'open' ? 'Aguardando fechamento' : 'Pagar total'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div onClick={(event) => event.stopPropagation()}>
        <ClientsConfirmModal
          open={purchaseAction !== null}
          title={purchaseAction?.kind === 'refund' ? 'Estornar compra' : 'Cancelar compra'}
          confirmLabel={purchaseAction?.kind === 'refund' ? 'Estornar compra' : 'Cancelar compra'}
          onClose={() => { if (!cancelMutation.isPending && !refundMutation.isPending) setPurchaseAction(null); }}
          onConfirm={confirmPurchaseAction}
          busy={cancelMutation.isPending || refundMutation.isPending}
        >
          {purchaseAction && (
            <>
              <p className="font-medium">
                {purchaseAction.purchase.description} · {formatCents(purchaseAction.purchase.totalCents)}
              </p>
              {purchaseAction.kind === 'cancel' ? (
                <p>Todas as parcelas estão em faturas abertas: elas serão canceladas e o limite volta. O histórico é mantido.</p>
              ) : (
                <p>
                  A compra já tem parcelas em fatura fechada, que não é alterada. O valor já faturado vira crédito na
                  fatura aberta de {formatCompetence(openCompetence)}; as parcelas futuras são canceladas e o limite volta.
                </p>
              )}
            </>
          )}
        </ClientsConfirmModal>

        <ClientsConfirmModal
          open={paymentToReverse !== null}
          title="Estornar pagamento"
          confirmLabel="Estornar pagamento"
          onClose={() => { if (!reverseMutation.isPending) setPaymentToReverse(null); }}
          onConfirm={confirmReversal}
          busy={reverseMutation.isPending}
        >
          {paymentToReverse && (
            <>
              <p className="font-medium">
                {formatCents(paymentToReverse.amountCents)} pago em {formatDayKey(paymentToReverse.paymentDate)}
              </p>
              <p>Conta do estorno: {accountNames.get(paymentToReverse.cashAccountId) ?? 'conta do pagamento original'}</p>
              <p>{REVERSAL_EXPLANATION}</p>
            </>
          )}
        </ClientsConfirmModal>
      </div>
    </div>
  );
};

export default CardInvoiceDetailsDrawer;
