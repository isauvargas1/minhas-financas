import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { CreditCard } from '../modules/cards/types.ts';
import { useCashAccounts } from '../modules/accounts/hooks.ts';
import { useTransactionCatalogOptions } from '../modules/settings-catalog/useTransactionCatalogOptions.ts';
import { saoPauloToday } from '../modules/transactions/cashEntry.ts';
import {
    useCreateSplitBill,
    useCreateSplitReimbursement,
    useSplitIntentKey,
    useUpdateSplitBill,
} from '../modules/split-bills/hooks.ts';
import {
    SplitInputError,
    amountInputToCents,
    billMetadataOf,
    centsToAmountInput,
    inputsFromShares,
    percentInputToBps,
    previewAllocation,
    toBillTerms,
    toCreateBillPayload,
    toCreateReimbursementPayload,
    type SplitBillFormState,
} from '../modules/split-bills/payloads.ts';
import {
    areTermsLocked,
    formatBps,
    formatSplitCents,
    participantName,
    splitErrorView,
    type WorkspaceMemberName,
} from '../modules/split-bills/presentation.ts';
import type { SplitAllocationMethod, SplitBill, SplitGroup, SplitParticipant, SplitShare } from '../modules/split-bills/types.ts';
import { CloseIcon, UsersIcon, CheckIcon } from './Icons.tsx';
import { useCardDialogFocus } from './cards/useCardDialogFocus.ts';

interface SplitBillFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
    group: SplitGroup;
    participants: SplitParticipant[];
    members: ReadonlyMap<string, WorkspaceMemberName>;
    /** Participante do próprio usuário (identidade pelo `uid`). */
    me: SplitParticipant | null;
    isWorkspaceAdmin: boolean;
    creditCards: CreditCard[]; // Cartões para integração
    billToEdit?: SplitBill | null;
    sharesToEdit?: SplitShare[] | null;
    isReimbursementGroup?: boolean;
}

type PaymentMethod = 'dinheiro' | 'pix' | 'cartaoCredito';

const METHODS: readonly SplitAllocationMethod[] = ['equal', 'percentage', 'fixed'];

const SplitBillFormModal: React.FC<SplitBillFormModalProps> = (props) => {
    if (!props.isOpen) return null;
    return <SplitBillForm {...props} />;
};

const SplitBillForm: React.FC<SplitBillFormModalProps> = ({
    onClose, onSaved, group, participants, members, me, isWorkspaceAdmin, creditCards,
    billToEdit, sharesToEdit, isReimbursementGroup
}) => {
    const createBill = useCreateSplitBill();
    const updateBill = useUpdateSplitBill();
    const createReimbursement = useCreateSplitReimbursement();
    const intent = useSplitIntentKey();
    const { data: accounts } = useCashAccounts();
    const { options: catalog } = useTransactionCatalogOptions('despesa');
    const categories = catalog.settingsCategories;
    const activeAccounts = useMemo(() => (accounts?.items ?? []).filter(a => a.status === 'active'), [accounts]);
    const activeCards = useMemo(() => creditCards.filter(c => c.status === 'active'), [creditCards]);
    const panelRef = useRef<HTMLDivElement>(null);
    const isSaving = createBill.isPending || updateBill.isPending || createReimbursement.isPending;
    // Trava síncrona: dois envios no mesmo tique não passam pelo `isPending`.
    const submittingRef = useRef(false);
    useCardDialogFocus(panelRef, onClose, isSaving);

    // Pagador e devedores: participantes ativos com papel de dono ou participante.
    const eligible = useMemo(() => participants.filter(p => p.status === 'active' && p.role !== 'viewer'), [participants]);
    const nameOf = (p: SplitParticipant | undefined) => participantName(p, members);
    const isMine = (p: SplitParticipant | undefined) => Boolean(me && p && p.id === me.id);
    const termsLocked = Boolean(billToEdit && areTermsLocked(billToEdit));

    // Basic Info
    const [descricao, setDescricao] = useState('');
    const [valorTotal, setValorTotal] = useState<string>('');
    const [data, setData] = useState(saoPauloToday());
    const [categoria, setCategoria] = useState('');

    // Payment Info
    const [pagadorId, setPagadorId] = useState('');
    const [formaPagamento, setFormaPagamento] = useState<PaymentMethod>('pix');
    const [cartaoId, setCartaoId] = useState('');
    const [contaId, setContaId] = useState('');
    const [parcelas, setParcelas] = useState('1');

    // Split Logic
    const [metodoDivisao, setMetodoDivisao] = useState<SplitAllocationMethod>('equal');
    const [manualInputs, setManualInputs] = useState<Record<string, string>>({});
    const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);

    // Integration
    const [integrarDespesa, setIntegrarDespesa] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Init Logic
    useEffect(() => {
        setError(null);
        intent.reset();
        if (billToEdit) {
            setDescricao(billToEdit.description);
            setValorTotal(centsToAmountInput(billToEdit.amountCents));
            setData(billToEdit.expenseDate);
            setCategoria(billToEdit.category);
            setPagadorId(billToEdit.payerParticipantId);
            setFormaPagamento(billToEdit.financialIntegration === 'card' ? 'cartaoCredito' : 'pix');
            setCartaoId(billToEdit.cardId ?? '');
            setContaId(billToEdit.cashAccountId ?? '');
            setParcelas(String(billToEdit.installmentsCount ?? 1));
            setIntegrarDespesa(billToEdit.financialIntegration !== 'none');
            // Edição preserva o método e os valores gravados.
            setMetodoDivisao(billToEdit.allocationMethod);
            setSelectedParticipantIds(billToEdit.participantIds);
            setManualInputs(inputsFromShares(billToEdit.allocationMethod, sharesToEdit ?? []));
        } else {
            setDescricao('');
            setValorTotal('');
            setData(saoPauloToday());
            setCategoria(categories[0]?.name || '');
            const defaultPayer = (me && eligible.some(p => p.id === me.id)) ? me.id : eligible[0]?.id || '';
            setPagadorId(isReimbursementGroup && !isWorkspaceAdmin ? (me?.id ?? '') : defaultPayer);
            setFormaPagamento('pix');
            setCartaoId('');
            setContaId(activeAccounts[0]?.id ?? '');
            setParcelas('1');
            setMetodoDivisao('equal');
            setSelectedParticipantIds(eligible.map(p => p.id));
            setManualInputs({});
            // Lançamento no Caixa/Cartão: padrão só quando quem paga é o próprio usuário.
            setIntegrarDespesa(!isReimbursementGroup && Boolean(me) && defaultPayer === me?.id);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [billToEdit?.id]);

    useEffect(() => {
        if (!contaId && activeAccounts[0]) setContaId(activeAccounts[0].id);
    }, [activeAccounts, contaId]);

    const payer = participants.find(p => p.id === pagadorId);
    const payerIsExternal = payer?.kind === 'external';
    const canIntegrate = !payerIsExternal && Boolean(payer) && (isWorkspaceAdmin || isMine(payer));
    const integrate = integrarDespesa && canIntegrate;

    // Prévia exata (a regra do backend); quem decide é o servidor.
    const preview = useMemo(() => {
        if (isReimbursementGroup) return null;
        return previewAllocation({
            amountCents: amountInputToCents(valorTotal),
            method: metodoDivisao,
            participants: selectedParticipantIds.map(participantId => metodoDivisao === 'percentage'
                ? { participantId, weightBps: percentInputToBps(manualInputs[participantId] ?? '') }
                : metodoDivisao === 'fixed'
                    ? { participantId, amountCents: amountInputToCents(manualInputs[participantId] ?? '') }
                    : { participantId }),
        });
    }, [valorTotal, metodoDivisao, manualInputs, selectedParticipantIds, isReimbursementGroup]);

    const formState = (): SplitBillFormState => ({
        description: descricao,
        category: categoria,
        amount: valorTotal,
        expenseDate: data,
        payerParticipantId: pagadorId,
        method: metodoDivisao,
        participantIds: selectedParticipantIds,
        inputs: manualInputs,
        integrate,
        paymentKind: formaPagamento === 'cartaoCredito' ? 'card' : 'cash',
        cashAccountId: contaId,
        cardId: cartaoId,
        installments: parcelas,
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSaving || submittingRef.current) return;
        submittingRef.current = true;
        setError(null);
        try {
            if (isReimbursementGroup) {
                const payload = toCreateReimbursementPayload(group.id, {
                    description: descricao,
                    category: categoria,
                    amount: valorTotal,
                    expenseDate: data,
                    requesterParticipantId: pagadorId,
                });
                await createReimbursement.mutateAsync({ payload, idempotencyKey: intent.keyFor('createSplitReimbursement', payload) });
            } else if (billToEdit) {
                const form = formState();
                const next = billMetadataOf(form);
                const metadata: Record<string, string> = {};
                if (next.description !== billToEdit.description) metadata.description = next.description;
                if (next.category !== billToEdit.category) metadata.category = next.category;
                const payload: Record<string, unknown> = {
                    billId: billToEdit.id,
                    expectedUpdatedAt: billToEdit.version,
                    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
                    ...(termsLocked ? {} : { terms: toBillTerms({ ...form, integrate: false }) }),
                };
                if (termsLocked && Object.keys(metadata).length === 0) {
                    throw new SplitInputError('Nenhuma alteração para salvar.');
                }
                await updateBill.mutateAsync({ payload, idempotencyKey: intent.keyFor('updateSplitBill', payload) });
            } else {
                const payload = toCreateBillPayload(group.id, formState());
                await createBill.mutateAsync({ payload, idempotencyKey: intent.keyFor('createSplitBill', payload) });
            }
            intent.reset();
            onSaved();
            onClose();
        } catch (failure) {
            setError(splitErrorView(failure).message);
        } finally {
            submittingRef.current = false;
        }
    };

    const toggleParticipant = (id: string) => {
        setSelectedParticipantIds(prev =>
            prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
        );
    };

    const commonInputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 bg-white text-gray-900 dark:bg-dark-200 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60";
    const payerLabel = isReimbursementGroup ? "Colaborador (Solicitante)" : "Quem Pagou?";
    const title = billToEdit ? 'Editar Conta' : (isReimbursementGroup ? 'Solicitar Reembolso' : 'Nova Conta Compartilhada');
    const requesterOptions = isReimbursementGroup && !isWorkspaceAdmin ? eligible.filter(p => isMine(p)) : eligible;
    const shareOf = (id: string) => preview?.shares[id] ?? 0;

    return createPortal((
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 transition-opacity" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div ref={panelRef} tabIndex={-1} className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-2xl animate-scale-in max-h-[90vh] flex flex-col outline-none" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
                    <h3 id="modal-title" className="text-xl font-bold text-gray-800 dark:text-white">
                        {title}
                    </h3>
                    <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Fechar">
                        <CloseIcon />
                    </button>
                </div>

                <form id="splitBillForm" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                    {termsLocked && (
                        <p className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-200">
                            Esta conta já tem recebimento, perdão ou lançamento no Caixa ou no Cartão: só a descrição e a categoria podem mudar. Para mudar valores, anule a conta e lance de novo.
                        </p>
                    )}
                    {/* Basic Fields */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label htmlFor="split-bill-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição <span className="text-red-500">*</span></label>
                            <input
                                id="split-bill-description"
                                type="text"
                                value={descricao}
                                onChange={e => setDescricao(e.target.value)}
                                className={commonInputClass}
                                required
                                maxLength={120}
                                placeholder={isReimbursementGroup ? "Ex: Táxi para reunião" : "Ex: Jantar de sábado"}
                                autoFocus
                            />
                        </div>
                        <div>
                            <label htmlFor="split-bill-amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor Total (R$) <span className="text-red-500">*</span></label>
                            <input id="split-bill-amount" type="number" step="0.01" min="0.01" value={valorTotal} onChange={e => setValorTotal(e.target.value)} className={`${commonInputClass} font-bold`} required disabled={termsLocked} />
                        </div>
                        <div>
                            <label htmlFor="split-bill-date" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data</label>
                            <input id="split-bill-date" type="date" value={data} max={saoPauloToday()} onChange={e => setData(e.target.value)} className={commonInputClass} required disabled={termsLocked} />
                        </div>
                        <div>
                            <label htmlFor="split-bill-category" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria</label>
                            <select id="split-bill-category" value={categoria} onChange={e => setCategoria(e.target.value)} className={commonInputClass}>
                                {categoria && !categories.some(c => c.name === categoria) && <option value={categoria}>{categoria}</option>}
                                {categories.length === 0 && !categoria && <option value="">Sem categoria</option>}
                                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="split-bill-payer" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{payerLabel}</label>
                            <select id="split-bill-payer" value={pagadorId} onChange={e => setPagadorId(e.target.value)} className={commonInputClass} disabled={termsLocked || (isReimbursementGroup && !isWorkspaceAdmin)}>
                                {pagadorId && !requesterOptions.some(p => p.id === pagadorId) && <option value={pagadorId}>{nameOf(participants.find(p => p.id === pagadorId))}</option>}
                                {requesterOptions.map(p => <option key={p.id} value={p.id}>{nameOf(p)} {isMine(p) ? '(Eu)' : p.kind === 'external' ? '(Externo)' : ''}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Payment Method — o lançamento no Caixa ou no Cartão (rateio). */}
                    {!isReimbursementGroup && (
                        <div className="bg-gray-50 dark:bg-dark-200 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                            <span className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Forma de Pagamento
                            </span>
                            <div className="flex flex-wrap gap-4 mb-3" role="radiogroup" aria-label="Forma de Pagamento">
                                {(['dinheiro', 'pix', 'cartaoCredito'] as const).map(method => (
                                    <label key={method} className="flex items-center cursor-pointer">
                                        <input type="radio" name="paymentMethod" checked={formaPagamento === method} onChange={() => setFormaPagamento(method)} disabled={termsLocked} className="mr-2 text-indigo-600 focus:ring-indigo-500" />
                                        <span className="capitalize text-gray-700 dark:text-gray-300">
                                            {method === 'cartaoCredito' ? 'Cartão de Crédito' : method}
                                        </span>
                                    </label>
                                ))}
                            </div>

                            {integrate && formaPagamento === 'cartaoCredito' && (
                                <div className="grid grid-cols-2 gap-4 animate-fade-in">
                                    <div>
                                        <label htmlFor="split-bill-card" className="block text-xs text-gray-500 mb-1">Cartão</label>
                                        <select id="split-bill-card" value={cartaoId} onChange={e => setCartaoId(e.target.value)} disabled={termsLocked} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white text-gray-900 dark:bg-dark-300 dark:text-white text-sm outline-none">
                                            <option value="">Selecione...</option>
                                            {activeCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="split-bill-installments" className="block text-xs text-gray-500 mb-1">Parcelas</label>
                                        <input id="split-bill-installments" type="number" value={parcelas} onChange={e => setParcelas(e.target.value)} min="1" max="60" disabled={termsLocked} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white text-gray-900 dark:bg-dark-300 dark:text-white text-sm outline-none" />
                                    </div>
                                </div>
                            )}
                            {integrate && formaPagamento !== 'cartaoCredito' && (
                                <div className="animate-fade-in">
                                    <label htmlFor="split-bill-account" className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Conta</label>
                                    <select id="split-bill-account" value={contaId} onChange={e => setContaId(e.target.value)} disabled={termsLocked} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white text-gray-900 dark:bg-dark-300 dark:text-white text-sm outline-none">
                                        <option value="">Selecione...</option>
                                        {activeAccounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Split Logic (Hide for Reimbursement) */}
                    {!isReimbursementGroup && (
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="font-bold text-gray-800 dark:text-white">Divisão</h4>
                                <div className="flex gap-1 text-xs bg-gray-100 dark:bg-dark-200 p-1 rounded-lg" role="group" aria-label="Método de divisão">
                                    {METHODS.map(m => (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => { setMetodoDivisao(m); setManualInputs({}); }}
                                            disabled={termsLocked}
                                            aria-pressed={metodoDivisao === m}
                                            className={`px-2 py-1 rounded transition-colors ${metodoDivisao === m ? 'bg-white dark:bg-dark-300 shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                                        >
                                            {m === 'equal' ? 'Igual' : m === 'percentage' ? '%' : 'R$'}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50 dark:bg-dark-200 text-gray-500 dark:text-gray-400">
                                        <tr>
                                            <th className="px-4 py-2 w-10">
                                                <UsersIcon className="w-4 h-4" />
                                            </th>
                                            <th className="px-4 py-2 text-left">Participante</th>
                                            <th className="px-4 py-2 text-right w-32">
                                                {metodoDivisao === 'percentage' ? '%' : 'Valor'}
                                            </th>
                                            {metodoDivisao !== 'equal' && <th className="px-4 py-2 text-right w-24">Total</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {eligible.map(p => {
                                            const isSelected = selectedParticipantIds.includes(p.id);
                                            const name = nameOf(p);
                                            return (
                                                <tr key={p.id} className={`${!isSelected ? 'opacity-50' : ''} transition-opacity`}>
                                                    <td className="px-4 py-3 text-center">
                                                        <button type="button" role="checkbox" aria-checked={isSelected} aria-label={`Incluir ${name} na divisão`} disabled={termsLocked} onClick={() => toggleParticipant(p.id)} className={`w-5 h-5 rounded border flex items-center justify-center mx-auto transition-colors ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-400'}`}>
                                                            {isSelected && <CheckIcon className="w-3 h-3" />}
                                                        </button>
                                                    </td>
                                                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-white">
                                                        {name}
                                                        {p.kind === 'external' && <span className="ml-2 text-[10px] bg-gray-100 dark:bg-dark-300 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-600">EXTERNO</span>}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        {metodoDivisao === 'equal' ? (
                                                            <span className="text-gray-600 dark:text-gray-300">
                                                                {isSelected ? formatSplitCents(shareOf(p.id)) : '-'}
                                                            </span>
                                                        ) : (
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                min="0"
                                                                aria-label={metodoDivisao === 'percentage' ? `Percentual de ${name}` : `Valor de ${name}`}
                                                                disabled={!isSelected || termsLocked}
                                                                value={manualInputs[p.id] || ''}
                                                                onChange={(e) => setManualInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                                                                className="w-full text-right border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white text-gray-900 dark:bg-dark-300 dark:text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                                                placeholder="0"
                                                            />
                                                        )}
                                                    </td>
                                                    {metodoDivisao !== 'equal' && (
                                                        <td className="px-4 py-3 text-right font-medium text-gray-800 dark:text-white">
                                                            {isSelected ? formatSplitCents(shareOf(p.id)) : '-'}
                                                        </td>
                                                    )}
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                    {metodoDivisao !== 'equal' && preview && (
                                        <tfoot className="bg-gray-50 dark:bg-dark-200">
                                            <tr>
                                                <td colSpan={2} className="px-4 py-2 text-right font-medium text-gray-500">Diferença:</td>
                                                <td colSpan={2} className={`px-4 py-2 text-right font-bold ${(metodoDivisao === 'percentage' ? preview.differenceBps : preview.differenceCents) !== 0 ? 'text-red-500' : 'text-green-500'}`}>
                                                    {metodoDivisao === 'percentage' ? formatBps(preview.differenceBps) : formatSplitCents(preview.differenceCents)}
                                                </td>
                                            </tr>
                                        </tfoot>
                                    )}
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Integration Checkbox */}
                    {!billToEdit && !isReimbursementGroup && (
                        <div className="flex items-center gap-3 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-lg">
                            <input
                                type="checkbox"
                                id="integrate"
                                checked={integrate}
                                disabled={!canIntegrate}
                                onChange={e => setIntegrarDespesa(e.target.checked)}
                                className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500 cursor-pointer disabled:cursor-not-allowed"
                            />
                            <label htmlFor="integrate" className="text-sm text-indigo-900 dark:text-indigo-200 cursor-pointer">
                                {canIntegrate
                                    ? <>Adicionar também no módulo de <strong>{formaPagamento === 'cartaoCredito' ? 'Cartões' : 'Despesas'}</strong></>
                                    : payerIsExternal
                                        ? 'Quem pagou é participante externo: a conta fica só na Divisão de contas.'
                                        : 'Só o próprio pagador ou um administrador do espaço lança no Caixa ou no Cartão.'}
                            </label>
                        </div>
                    )}

                    {error && (
                        <p role="alert" className="rounded-lg bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-700 dark:text-red-300">
                            {error}
                        </p>
                    )}
                </form>

                <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                        Cancelar
                    </button>
                    <button type="submit" form="splitBillForm" disabled={isSaving} className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-60">
                        {isSaving ? 'Salvando…' : isReimbursementGroup ? 'Solicitar' : 'Salvar Conta'}
                    </button>
                </div>
            </div>
             <style>{`
                @keyframes scale-in {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                .animate-scale-in {
                    animation: scale-in 0.2s ease-out forwards;
                }
                @keyframes fade-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .animate-fade-in {
                    animation: fade-in 0.3s ease-out forwards;
                }
            `}</style>
        </div>
    ), document.body);
};

export default SplitBillFormModal;
