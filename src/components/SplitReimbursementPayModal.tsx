import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCashAccounts } from '../modules/accounts/hooks.ts';
import { saoPauloToday } from '../modules/transactions/cashEntry.ts';
import { usePaySplitReimbursement, useSplitIntentKey } from '../modules/split-bills/hooks.ts';
import { SplitInputError } from '../modules/split-bills/payloads.ts';
import { formatSplitCents, splitErrorView } from '../modules/split-bills/presentation.ts';
import type { SplitReimbursement } from '../modules/split-bills/types.ts';
import { CloseIcon } from './Icons.tsx';
import { useCardDialogFocus } from './cards/useCardDialogFocus.ts';

interface SplitReimbursementPayModalProps {
    reimbursement: SplitReimbursement;
    onClose: () => void;
}

/**
 * Pagamento do reembolso PJ (P4-C, §24): integral, numa conta ativa do
 * Caixa. O servidor grava, no mesmo commit, o reembolso como pago, a
 * despesa confirmada no Caixa (descrição genérica) e o movimento da conta.
 */
const SplitReimbursementPayModal: React.FC<SplitReimbursementPayModalProps> = ({ reimbursement, onClose }) => {
    const { data: accounts } = useCashAccounts();
    const activeAccounts = useMemo(() => (accounts?.items ?? []).filter(a => a.status === 'active'), [accounts]);
    const pay = usePaySplitReimbursement();
    const intent = useSplitIntentKey();
    const [accountId, setAccountId] = useState('');
    const [paymentDate, setPaymentDate] = useState(saoPauloToday());
    const [error, setError] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    useCardDialogFocus(panelRef, onClose, pay.isPending);
    // Trava síncrona: dois envios no mesmo tique não passam pelo `isPending`.
    const submittingRef = useRef(false);
    const selectedAccount = accountId || activeAccounts[0]?.id || '';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (pay.isPending || submittingRef.current) return;
        submittingRef.current = true;
        setError(null);
        try {
            if (!selectedAccount) throw new SplitInputError('Escolha a conta de onde sai o pagamento.');
            if (!paymentDate) throw new SplitInputError('Informe a data do pagamento.');
            const payload = {
                reimbursementId: reimbursement.id,
                expectedUpdatedAt: reimbursement.version,
                cashAccountId: selectedAccount,
                paymentDate,
            };
            await pay.mutateAsync({ payload, idempotencyKey: intent.keyFor('paySplitReimbursement', payload) });
            intent.reset();
            onClose();
        } catch (failure) {
            setError(splitErrorView(failure).message);
        } finally {
            submittingRef.current = false;
        }
    };

    const inputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 bg-white text-gray-900 dark:bg-dark-200 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500";

    return createPortal((
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="split-pay-title">
            <div ref={panelRef} tabIndex={-1} className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-sm animate-scale-in outline-none" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-5 border-b border-gray-200 dark:border-gray-700">
                    <h3 id="split-pay-title" className="text-lg font-bold text-gray-800 dark:text-white">Pagar Reembolso</h3>
                    <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Fechar">
                        <CloseIcon />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <p className="text-sm text-gray-600 dark:text-gray-300">
                        {reimbursement.description} — <strong>{formatSplitCents(reimbursement.amountCents)}</strong>
                    </p>
                    <div>
                        <label htmlFor="split-pay-account" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Conta</label>
                        <select id="split-pay-account" value={selectedAccount} onChange={e => setAccountId(e.target.value)} className={inputClass} autoFocus>
                            {activeAccounts.length === 0 && <option value="">Nenhuma conta ativa</option>}
                            {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="split-pay-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data do pagamento</label>
                        <input id="split-pay-date" type="date" value={paymentDate} max={saoPauloToday()} onChange={e => setPaymentDate(e.target.value)} className={inputClass} required />
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        O pagamento entra como despesa confirmada no Caixa, na conta escolhida.
                    </p>
                    {error && <p role="alert" className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
                    <div className="flex justify-end gap-3">
                        <button type="button" onClick={onClose} disabled={pay.isPending} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                            Cancelar
                        </button>
                        <button type="submit" disabled={pay.isPending} className="px-6 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition-colors shadow-sm disabled:opacity-60">
                            {pay.isPending ? 'Pagando…' : 'Confirmar Pagamento'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    ), document.body);
};

export default SplitReimbursementPayModal;
