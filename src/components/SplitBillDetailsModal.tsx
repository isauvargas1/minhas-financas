import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    useForgiveSplitShare,
    useReverseSplitShareSettlement,
    useSettleSplitShare,
    useSplitIntentKey,
    useSplitShares,
    useVoidSplitBill,
} from '../modules/split-bills/hooks.ts';
import { SPLIT_TEXT_LIMITS, requireReason } from '../modules/split-bills/payloads.ts';
import {
    canEditBill,
    canForgiveShare,
    canSettleShare,
    canVoidBill,
    formatSplitCents,
    hasFinancialFact,
    participantInitial,
    participantName,
    shareStatusText,
    splitErrorView,
    type SplitGroupPermissions,
    type SplitViewer,
    type WorkspaceMemberName,
} from '../modules/split-bills/presentation.ts';
import { formatDayKey } from '../modules/loans/money.ts';
import type { SplitBill, SplitParticipant, SplitShare } from '../modules/split-bills/types.ts';
import { CloseIcon, CheckIcon, EditIcon, DeleteIcon, WarningIcon } from './Icons.tsx';
import { useCardDialogFocus } from './cards/useCardDialogFocus.ts';

interface SplitBillDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    bill: SplitBill;
    participants: SplitParticipant[];
    members: ReadonlyMap<string, WorkspaceMemberName>;
    me: SplitParticipant | null;
    viewer: SplitViewer;
    permissions: SplitGroupPermissions;
    onEditBill: (bill: SplitBill, shares: SplitShare[]) => void;
}

const SplitBillDetailsModal: React.FC<SplitBillDetailsModalProps> = (props) => {
    if (!props.isOpen) return null;
    return <SplitBillDetails {...props} />;
};

const SplitBillDetails: React.FC<SplitBillDetailsModalProps> = ({
    onClose, bill, participants, members, me, viewer, permissions, onEditBill
}) => {
    const { data: shares, isLoading, isTruncated } = useSplitShares(bill.id);
    const settle = useSettleSplitShare();
    const reverse = useReverseSplitShareSettlement();
    const forgive = useForgiveSplitShare();
    const voidBill = useVoidSplitBill();
    const intent = useSplitIntentKey();
    const [isVoiding, setIsVoiding] = useState(false);
    const [forgivingId, setForgivingId] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [error, setError] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    const busy = settle.isPending || reverse.isPending || forgive.isPending || voidBill.isPending;
    useCardDialogFocus(panelRef, onClose, busy);

    const byId = new Map(participants.map(p => [p.id, p]));
    const payer = byId.get(bill.payerParticipantId);
    const nameOf = (p: SplitParticipant | undefined) => participantName(p, members);
    const isVoided = bill.status === 'voided';
    const editable = canEditBill(viewer, permissions, bill);
    const voidable = canVoidBill(viewer, permissions, bill);
    const liveShares = (shares ?? []).filter(share => share.status !== 'voided' || isVoided);

    const run = async (
        operation: string,
        mutation: typeof settle,
        payload: Record<string, unknown>,
        after?: () => void,
    ) => {
        if (busy) return;
        setError(null);
        try {
            await mutation.mutateAsync({ payload, idempotencyKey: intent.keyFor(operation, payload) });
            intent.reset();
            after?.();
        } catch (failure) {
            setError(splitErrorView(failure).message);
        }
    };

    const shareAction = (operation: 'settleSplitShare' | 'reverseSplitShareSettlement', share: SplitShare) =>
        run(operation, operation === 'settleSplitShare' ? settle : reverse,
            { shareId: share.id, expectedUpdatedAt: share.version });

    const confirmForgive = (share: SplitShare) => {
        try {
            const payload = { shareId: share.id, expectedUpdatedAt: share.version, reason: requireReason(reason) };
            void run('forgiveSplitShare', forgive, payload, () => { setForgivingId(null); setReason(''); });
        } catch (failure) {
            setError(splitErrorView(failure).message);
        }
    };

    const confirmVoid = () => run('voidSplitBill', voidBill,
        { billId: bill.id, expectedUpdatedAt: bill.version }, onClose);

    return createPortal((
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="split-bill-details-title">
            <div ref={panelRef} tabIndex={-1} className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-md animate-scale-in flex flex-col max-h-[90vh] outline-none" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-start bg-gray-50 dark:bg-dark-200 rounded-t-xl">
                    <div className="flex-1 mr-4">
                        <h3 id="split-bill-details-title" className="text-xl font-bold text-gray-800 dark:text-white mb-1">{bill.description}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Pago por <strong className="text-indigo-600 dark:text-indigo-400">{nameOf(payer)}</strong> em {formatDayKey(bill.expenseDate)}
                        </p>
                        {isVoided && (
                            <span className="mt-1 inline-block text-[10px] bg-gray-200 text-gray-700 px-2 py-0.5 rounded font-bold">ANULADA</span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {editable && (
                            <button
                                onClick={() => {
                                    onEditBill(bill, shares ?? []);
                                    onClose();
                                }}
                                disabled={!shares}
                                className="p-2 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 transition-colors rounded-full hover:bg-gray-200 dark:hover:bg-dark-300"
                                title="Editar Despesa"
                                aria-label="Editar Despesa"
                            >
                                <EditIcon className="w-4 h-4" />
                            </button>
                        )}
                        {voidable && (
                            <button
                                onClick={() => { setError(null); setIsVoiding(true); }}
                                className="p-2 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors rounded-full hover:bg-gray-200 dark:hover:bg-dark-300"
                                title="Anular Despesa"
                                aria-label="Anular Despesa"
                            >
                                <DeleteIcon className="w-4 h-4" />
                            </button>
                        )}
                        <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200" aria-label="Fechar">
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Void confirmation — nada é apagado */}
                {isVoiding ? (
                    <div className="p-6 bg-red-50 dark:bg-red-900/10">
                        <div className="flex items-center gap-3 text-red-600 dark:text-red-400 mb-3">
                            <WarningIcon className="w-6 h-6" />
                            <h4 className="font-bold">Anular esta despesa?</h4>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                            A despesa continua no histórico como anulada e sai dos totais do grupo.
                            {bill.financialIntegration === 'cash' && ' O lançamento no Caixa é compensado por um estorno na mesma conta.'}
                            {bill.financialIntegration === 'card' && ' A compra no cartão é cancelada (ou estornada, se já foi faturada).'}
                        </p>
                        {error && <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => { setIsVoiding(false); setError(null); }}
                                disabled={busy}
                                className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-300 rounded-lg"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={confirmVoid}
                                disabled={busy}
                                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {voidBill.isPending ? 'Anulando…' : 'Confirmar Anulação'}
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Total */}
                        <div className="p-6 text-center">
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Valor Total</span>
                            <p className="text-4xl font-bold text-gray-900 dark:text-white mt-1">{formatSplitCents(bill.amountCents)}</p>
                            {hasFinancialFact(bill) && (
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                    {bill.financialIntegration === 'card' ? `Lançada no Cartão${bill.installmentsCount && bill.installmentsCount > 1 ? ` em ${bill.installmentsCount}x` : ''}` : 'Lançada no Caixa'}
                                </p>
                            )}
                        </div>

                        {/* Shares List */}
                        <div className="flex-1 overflow-y-auto px-6 pb-6">
                            <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-3">Divisão</h4>
                            {error && <p role="alert" className="mb-3 rounded-lg bg-red-50 dark:bg-red-900/20 p-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
                            {isTruncated && (
                                <p role="alert" className="mb-3 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                                    Esta despesa tem mais rateios do que o limite seguro de leitura.
                                </p>
                            )}
                            {isLoading ? (
                                <div className="text-center py-4 text-gray-400 text-sm">Carregando...</div>
                            ) : (
                                <div className="space-y-3">
                                    {liveShares.map(share => {
                                        const participant = byId.get(share.participantId);
                                        const name = nameOf(participant);
                                        const isMe = Boolean(me && participant?.id === me.id);
                                        const settled = share.status === 'settled';
                                        const canSettle = !isVoided && canSettleShare(viewer, permissions, bill, participant);
                                        const canForgive = !isVoided && canForgiveShare(viewer, permissions, participant);

                                        return (
                                            <div key={share.id} className="p-3 bg-gray-50 dark:bg-dark-200/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-3">
                                                        <div
                                                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                                                            style={{ backgroundColor: participant?.color || '#9ca3af' }}
                                                            aria-hidden="true"
                                                        >
                                                            {participantInitial(name)}
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">
                                                                {name}
                                                                {participant?.kind === 'external' && <span className="ml-1 text-[10px] text-gray-500 dark:text-gray-400">(externo)</span>}
                                                            </p>
                                                            <p className={`text-xs font-medium flex items-center ${settled ? (share.settledVia === 'settlement' ? 'text-green-600' : 'text-gray-500') : share.status === 'forgiven' ? 'text-gray-500' : 'text-red-500'}`}>
                                                                {shareStatusText(share, isMe)}
                                                                {settled && <CheckIcon className="w-3 h-3 ml-1" />}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="font-bold text-gray-800 dark:text-white text-sm">{formatSplitCents(share.amountDueCents)}</p>
                                                        {share.status === 'open' && canSettle && (
                                                            <button
                                                                onClick={() => shareAction('settleSplitShare', share)}
                                                                disabled={busy}
                                                                className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 transition-colors"
                                                            >
                                                                Registrar recebimento
                                                            </button>
                                                        )}
                                                        {share.status === 'open' && canForgive && forgivingId !== share.id && (
                                                            <button
                                                                onClick={() => { setForgivingId(share.id); setReason(''); setError(null); }}
                                                                disabled={busy}
                                                                className="ml-2 mt-1 text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200 transition-colors"
                                                            >
                                                                Perdoar
                                                            </button>
                                                        )}
                                                        {settled && share.settledVia === 'settlement' && canSettle && (
                                                            <button
                                                                onClick={() => shareAction('reverseSplitShareSettlement', share)}
                                                                disabled={busy}
                                                                className="ml-2 text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded hover:bg-amber-200 transition-colors"
                                                            >
                                                                Estornar recebimento
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                {forgivingId === share.id && (
                                                    <div className="mt-3 flex gap-2 items-end">
                                                        <div className="flex-1">
                                                            <label htmlFor={`forgive-${share.id}`} className="block text-xs text-gray-500 mb-1">Motivo do perdão</label>
                                                            <input
                                                                id={`forgive-${share.id}`}
                                                                type="text"
                                                                value={reason}
                                                                maxLength={SPLIT_TEXT_LIMITS.reason}
                                                                onChange={e => setReason(e.target.value)}
                                                                className="w-full border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white text-gray-900 dark:bg-dark-300 dark:text-white text-sm outline-none focus:ring-1 focus:ring-indigo-500"
                                                                autoFocus
                                                            />
                                                        </div>
                                                        <button onClick={() => setForgivingId(null)} disabled={busy} className="text-xs px-2 py-1.5 text-gray-600 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-dark-300">Cancelar</button>
                                                        <button onClick={() => confirmForgive(share)} disabled={busy || !reason.trim()} className="text-xs px-2 py-1.5 bg-gray-700 text-white rounded disabled:opacity-50">Confirmar</button>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                                Registrar recebimento marca o acerto entre os participantes; não movimenta o Caixa.
                            </p>
                        </div>
                    </>
                )}
            </div>
        </div>
    ), document.body);
};

export default SplitBillDetailsModal;
