
import React, { useState, useEffect, useMemo } from 'react';
import { SplitBill, SplitParticipant, SplitShare, EntityItem, CreditCard } from '../types.ts';
import { CloseIcon, UsersIcon, CheckIcon } from './Icons.tsx';
import { calculateSplitShares, validateSplitTotal, calculateInstallments, SplitMethod } from '../modules/split-bills/logic.ts';

interface SplitBillFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (bill: SplitBill, shares: SplitShare[], integrationData?: any) => void;
    groupId: string;
    participants: SplitParticipant[];
    categories: EntityItem[]; // Categorias do sistema principal
    creditCards: CreditCard[]; // Cartões para integração
    billToEdit?: SplitBill | null;
    sharesToEdit?: SplitShare[] | null;
    isReimbursementGroup?: boolean;
}

const SplitBillFormModal: React.FC<SplitBillFormModalProps> = ({ 
    isOpen, onClose, onSave, groupId, participants, categories, creditCards, billToEdit, sharesToEdit, isReimbursementGroup
}) => {
    // Basic Info
    const [descricao, setDescricao] = useState('');
    const [valorTotal, setValorTotal] = useState<string>('');
    const [data, setData] = useState(new Date().toISOString().split('T')[0]);
    const [categoria, setCategoria] = useState('');
    
    // Payment Info
    const [pagadorId, setPagadorId] = useState('');
    const [formaPagamento, setFormaPagamento] = useState('dinheiro'); // dinheiro, pix, cartaoCredito
    const [cartaoId, setCartaoId] = useState('');
    const [parcelas, setParcelas] = useState('1');

    // Split Logic
    const [metodoDivisao, setMetodoDivisao] = useState<SplitMethod>('igual');
    const [manualInputs, setManualInputs] = useState<Record<string, string>>({});
    const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);

    // Integration
    const [integrarDespesa, setIntegrarDespesa] = useState(true);

    // Init Logic
    useEffect(() => {
        if (isOpen) {
            if (billToEdit) {
                setDescricao(billToEdit.descricao);
                setValorTotal(String(billToEdit.valorReal || billToEdit.valorPadrao || ''));
                setData(billToEdit.createdAt?.split('T')[0] || new Date().toISOString().split('T')[0]);
                setCategoria(billToEdit.categoriaNome || '');
                setPagadorId(billToEdit.pagadorPrincipalId || '');
                setFormaPagamento(billToEdit.formaPagamento);
                setCartaoId(billToEdit.cartaoIdOpcional || '');
                setIntegrarDespesa(!!billToEdit.despesaIdOpcional);
                
                setSelectedParticipantIds(sharesToEdit?.map(s => s.participantId) || participants.map(p => p.id));
                setMetodoDivisao('igual'); 
                setManualInputs({});
            } else {
                setDescricao('');
                setValorTotal('');
                setData(new Date().toISOString().split('T')[0]);
                setCategoria(categories[0]?.name || '');
                const me = participants.find(p => p.nomeExibicao === 'Você');
                setPagadorId(me?.id || participants[0]?.id || '');
                setFormaPagamento('pix');
                setCartaoId('');
                setParcelas('1');
                setMetodoDivisao('igual');
                setSelectedParticipantIds(participants.map(p => p.id));
                setManualInputs({});
                setIntegrarDespesa(!isReimbursementGroup); // Default integrate only if rateio
            }
        }
    }, [isOpen, billToEdit, sharesToEdit, participants, categories, isReimbursementGroup]);

    // Use extracted logic
    const calculatedShares = useMemo(() => {
        if (isReimbursementGroup) return {}; // Skip for reimbursement
        return calculateSplitShares({
            total: parseFloat(valorTotal) || 0,
            method: metodoDivisao,
            participantIds: selectedParticipantIds,
            manualInputs
        });
    }, [valorTotal, metodoDivisao, manualInputs, selectedParticipantIds, isReimbursementGroup]);

    const diff = isReimbursementGroup ? 0 : validateSplitTotal(parseFloat(valorTotal) || 0, calculatedShares);
    const isDiffZero = Math.abs(diff) < 0.05;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!isReimbursementGroup && !isDiffZero && metodoDivisao !== 'igual') {
            alert(`A soma das divisões difere do total em ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(diff)}.`);
            return;
        }

        const newBill: SplitBill = {
            id: billToEdit ? billToEdit.id : Date.now().toString(),
            groupId,
            descricao,
            categoriaNome: categoria,
            tipoValor: 'variavel',
            valorReal: parseFloat(valorTotal),
            moeda: 'BRL',
            competencia: data.substring(0, 7),
            statusPagamento: isReimbursementGroup ? 'pendente' : 'pago', // Reimbursement starts pending approval/payment
            formaPagamento: formaPagamento as any,
            pagadorPrincipalId: pagadorId,
            cartaoIdOpcional: formaPagamento === 'cartaoCredito' ? cartaoId : undefined,
            createdAt: new Date().toISOString(),
            reimbursementStatus: isReimbursementGroup ? 'solicitado' : undefined
        };

        // Shares generation
        let shares: SplitShare[] = [];
        
        if (isReimbursementGroup) {
            // For reimbursement, we create a dummy share or assign everything to the company implicitly
            // Ideally we track who owes whom, but simpler logic:
            // Payer gets credit (pagoDireto), Company (not in list) owes. 
            // We just store one share for the payer to track who requested it.
            shares = [{
                id: Date.now().toString(),
                billId: newBill.id,
                participantId: pagadorId,
                valorDevido: 0, // Doesn't owe
                valorPago: parseFloat(valorTotal),
                status: 'pagoDireto'
            }];
        } else {
            shares = selectedParticipantIds.map(pId => {
                const amount = calculatedShares[pId] || 0;
                let status: any = 'aPagar';
                if (pId === pagadorId) {
                    status = 'pagoDireto';
                }

                return {
                    id: sharesToEdit?.find(s => s.participantId === pId)?.id || Date.now().toString() + Math.random(),
                    billId: newBill.id,
                    participantId: pId,
                    valorDevido: amount,
                    valorPago: status === 'pagoDireto' ? amount : 0,
                    status: status
                };
            });
        }

        // Prepare integration data
        let integrationData = undefined;
        if (integrarDespesa && !isReimbursementGroup) {
            // Only integrate upfront if NOT reimbursement. Reimbursement integrates upon payment.
            const installmentsInfo = formaPagamento === 'cartaoCredito' 
                ? calculateInstallments(parseFloat(valorTotal), parseInt(parcelas)) 
                : undefined;

            integrationData = {
                description: descricao,
                value: parseFloat(valorTotal),
                category: categoria,
                date: data,
                type: formaPagamento === 'cartaoCredito' ? 'parcelado' : 'despesa',
                installments: formaPagamento === 'cartaoCredito' ? parseInt(parcelas) : undefined,
                cardId: formaPagamento === 'cartaoCredito' ? parseInt(cartaoId) : undefined,
                paymentMethod: formaPagamento,
                isPaid: true,
                ...installmentsInfo
            };
        }

        onSave(newBill, shares, integrationData);
        onClose();
    };

    const toggleParticipant = (id: string) => {
        setSelectedParticipantIds(prev => 
            prev.includes(id) ? prev.filter(pid => pid !== id) : [...prev, id]
        );
    };

    if (!isOpen) return null;

    const commonInputClass = "w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 bg-white text-gray-900 dark:bg-dark-200 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500";
    const payerLabel = isReimbursementGroup ? "Colaborador (Solicitante)" : "Quem Pagou?";
    const title = billToEdit ? 'Editar Conta' : (isReimbursementGroup ? 'Solicitar Reembolso' : 'Nova Conta Compartilhada');

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 transition-opacity" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-2xl animate-scale-in max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
                    <h3 id="modal-title" className="text-xl font-bold text-gray-800 dark:text-white">
                        {title}
                    </h3>
                    <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Fechar">
                        <CloseIcon />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
                    {/* Basic Fields */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrição <span className="text-red-500">*</span></label>
                            <input 
                                type="text" 
                                value={descricao} 
                                onChange={e => setDescricao(e.target.value)} 
                                className={commonInputClass} 
                                required 
                                placeholder={isReimbursementGroup ? "Ex: Táxi para reunião" : "Ex: Jantar de sábado"}
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valor Total (R$) <span className="text-red-500">*</span></label>
                            <input type="number" step="0.01" value={valorTotal} onChange={e => setValorTotal(e.target.value)} className={`${commonInputClass} font-bold`} required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Data</label>
                            <input type="date" value={data} onChange={e => setData(e.target.value)} className={commonInputClass} required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Categoria</label>
                            <select value={categoria} onChange={e => setCategoria(e.target.value)} className={commonInputClass}>
                                {categories.filter(c => c.type === 'despesa').map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{payerLabel}</label>
                            <select value={pagadorId} onChange={e => setPagadorId(e.target.value)} className={commonInputClass}>
                                {participants.map(p => <option key={p.id} value={p.id}>{p.nomeExibicao} {p.nomeExibicao === 'Você' ? '(Eu)' : ''}</option>)}
                            </select>
                        </div>
                    </div>

                    {/* Payment Method - Only relevant if NOT reimbursement (reimbursement is usually cash out) or if tracking how user paid */}
                    <div className="bg-gray-50 dark:bg-dark-200 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            {isReimbursementGroup ? 'Como foi pago?' : 'Forma de Pagamento'}
                        </label>
                        <div className="flex flex-wrap gap-4 mb-3">
                            {['dinheiro', 'pix', 'cartaoCredito'].map(method => (
                                <label key={method} className="flex items-center cursor-pointer">
                                    <input type="radio" name="paymentMethod" checked={formaPagamento === method} onChange={() => setFormaPagamento(method)} className="mr-2 text-indigo-600 focus:ring-indigo-500" />
                                    <span className="capitalize text-gray-700 dark:text-gray-300">
                                        {method === 'cartaoCredito' ? 'Cartão de Crédito' : method}
                                    </span>
                                </label>
                            ))}
                        </div>
                        
                        {formaPagamento === 'cartaoCredito' && (
                            <div className="grid grid-cols-2 gap-4 animate-fade-in">
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">Cartão</label>
                                    <select value={cartaoId} onChange={e => setCartaoId(e.target.value)} className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white text-gray-900 dark:bg-dark-300 dark:text-white text-sm outline-none">
                                        <option value="">Selecione...</option>
                                        {creditCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-gray-500 mb-1">Parcelas</label>
                                    <input type="number" value={parcelas} onChange={e => setParcelas(e.target.value)} min="1" max="24" className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white text-gray-900 dark:bg-dark-300 dark:text-white text-sm outline-none" />
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Split Logic (Hide for Reimbursement) */}
                    {!isReimbursementGroup && (
                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <h4 className="font-bold text-gray-800 dark:text-white">Divisão</h4>
                                <div className="flex gap-1 text-xs bg-gray-100 dark:bg-dark-200 p-1 rounded-lg">
                                    {(['igual', 'porcentagem', 'valor_fixo'] as const).map(m => (
                                        <button 
                                            key={m}
                                            type="button" 
                                            onClick={() => setMetodoDivisao(m)} 
                                            className={`px-2 py-1 rounded transition-colors ${metodoDivisao === m ? 'bg-white dark:bg-dark-300 shadow-sm text-indigo-600' : 'text-gray-500 hover:text-gray-700'}`}
                                        >
                                            {m === 'igual' ? 'Igual' : m === 'porcentagem' ? '%' : 'R$'}
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
                                                {metodoDivisao === 'porcentagem' ? '%' : 'Valor'}
                                            </th>
                                            {metodoDivisao !== 'igual' && <th className="px-4 py-2 text-right w-24">Total</th>}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {participants.map(p => {
                                            const isSelected = selectedParticipantIds.includes(p.id);
                                            return (
                                                <tr key={p.id} className={`${!isSelected ? 'opacity-50' : ''} transition-opacity`}>
                                                    <td className="px-4 py-3 text-center cursor-pointer" onClick={() => toggleParticipant(p.id)}>
                                                        <div className={`w-5 h-5 rounded border flex items-center justify-center mx-auto transition-colors ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-400'}`}>
                                                            {isSelected && <CheckIcon className="w-3 h-3" />}
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-white">
                                                        {p.nomeExibicao}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        {metodoDivisao === 'igual' ? (
                                                            <span className="text-gray-600 dark:text-gray-300">
                                                                {isSelected ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(calculatedShares[p.id] || 0) : '-'}
                                                            </span>
                                                        ) : (
                                                            <input 
                                                                type="number" 
                                                                disabled={!isSelected}
                                                                value={manualInputs[p.id] || ''}
                                                                onChange={(e) => setManualInputs(prev => ({ ...prev, [p.id]: e.target.value }))}
                                                                className="w-full text-right border border-gray-300 dark:border-gray-600 rounded px-2 py-1 bg-white text-gray-900 dark:bg-dark-300 dark:text-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                                                placeholder="0"
                                                            />
                                                        )}
                                                    </td>
                                                    {metodoDivisao !== 'igual' && (
                                                        <td className="px-4 py-3 text-right font-medium text-gray-800 dark:text-white">
                                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(calculatedShares[p.id] || 0)}
                                                        </td>
                                                    )}
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                    {metodoDivisao !== 'igual' && (
                                        <tfoot className="bg-gray-50 dark:bg-dark-200">
                                            <tr>
                                                <td colSpan={2} className="px-4 py-2 text-right font-medium text-gray-500">Diferença:</td>
                                                <td colSpan={2} className={`px-4 py-2 text-right font-bold ${!isDiffZero ? 'text-red-500' : 'text-green-500'}`}>
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(diff)}
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
                                checked={integrarDespesa} 
                                onChange={e => setIntegrarDespesa(e.target.checked)}
                                className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500 cursor-pointer" 
                            />
                            <label htmlFor="integrate" className="text-sm text-indigo-900 dark:text-indigo-200 cursor-pointer">
                                Adicionar também no meu módulo de <strong>{formaPagamento === 'cartaoCredito' ? 'Cartões' : 'Despesas'}</strong>
                            </label>
                        </div>
                    )}

                </form>

                <div className="p-6 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors">
                        Cancelar
                    </button>
                    <button onClick={handleSubmit} className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
                        {isReimbursementGroup ? 'Solicitar' : 'Salvar Conta'}
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
    );
};

export default SplitBillFormModal;
