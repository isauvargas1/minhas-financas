
import React, { useState } from 'react';
import { SplitBill, SplitParticipant, SplitShare } from '../types.ts';
import { CloseIcon, CheckIcon, EditIcon, DeleteIcon, WarningIcon } from './Icons.tsx';

interface SplitBillDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    bill: SplitBill;
    participants: SplitParticipant[];
    shares: SplitShare[];
    onUpdateShareStatus: (share: SplitShare, newStatus: any) => void;
    onEditBill: (bill: SplitBill) => void;
    onDeleteBill: (billId: string) => void;
    isOwner: boolean; // Para saber se mostra a confirmação avançada
}

const SplitBillDetailsModal: React.FC<SplitBillDetailsModalProps> = ({ 
    isOpen, onClose, bill, participants, shares, onUpdateShareStatus, onEditBill, onDeleteBill, isOwner
}) => {
    const [isDeleting, setIsDeleting] = useState(false);
    const [deleteInput, setDeleteInput] = useState('');
    
    // Encontrar o pagador
    const payer = participants.find(p => p.id === bill.pagadorPrincipalId);
    const isCurrentUserPayer = payer?.nomeExibicao === 'Você';

    const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    if (!isOpen) return null;

    const handleDeleteClick = () => {
        if (isOwner) {
            setIsDeleting(true);
        } else {
            // Se não for dono, mas puder excluir (ex: quem criou), confirmação simples
            if(confirm("Tem certeza que deseja excluir esta despesa?")) {
                onDeleteBill(bill.id);
                onClose();
            }
        }
    };

    const confirmDelete = () => {
        if (deleteInput.toUpperCase() === 'DELETAR') {
            onDeleteBill(bill.id);
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-md animate-scale-in flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                
                {/* Header */}
                <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-start bg-gray-50 dark:bg-dark-200 rounded-t-xl">
                    <div className="flex-1 mr-4">
                        <h3 className="text-xl font-bold text-gray-800 dark:text-white mb-1">{bill.descricao}</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Pago por <strong className="text-indigo-600 dark:text-indigo-400">{payer?.nomeExibicao}</strong> em {new Date(bill.createdAt || '').toLocaleDateString('pt-BR')}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => {
                                onEditBill(bill);
                                onClose();
                            }}
                            className="p-2 text-gray-500 hover:text-indigo-600 dark:text-gray-400 dark:hover:text-indigo-400 transition-colors rounded-full hover:bg-gray-200 dark:hover:bg-dark-300"
                            title="Editar Despesa"
                        >
                            <EditIcon className="w-4 h-4" />
                        </button>
                        <button 
                            onClick={handleDeleteClick}
                            className="p-2 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors rounded-full hover:bg-gray-200 dark:hover:bg-dark-300"
                            title="Excluir Despesa"
                        >
                            <DeleteIcon className="w-4 h-4" />
                        </button>
                        <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                            <CloseIcon className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Delete Confirmation for Owner */}
                {isDeleting ? (
                    <div className="p-6 bg-red-50 dark:bg-red-900/10">
                        <div className="flex items-center gap-3 text-red-600 dark:text-red-400 mb-3">
                            <WarningIcon className="w-6 h-6" />
                            <h4 className="font-bold">Atenção, Administrador!</h4>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                            Excluir esta despesa removerá todo o histórico de pagamentos associado a ela para todos os participantes. Esta ação é irreversível.
                        </p>
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                            Digite "DELETAR" para confirmar
                        </label>
                        <input 
                            type="text" 
                            value={deleteInput}
                            onChange={e => setDeleteInput(e.target.value)}
                            className="w-full border border-red-300 dark:border-red-700 rounded-lg px-3 py-2 bg-white dark:bg-dark-200 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 mb-4"
                            placeholder="DELETAR"
                        />
                        <div className="flex gap-3 justify-end">
                            <button 
                                onClick={() => { setIsDeleting(false); setDeleteInput(''); }}
                                className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-dark-300 rounded-lg"
                            >
                                Cancelar
                            </button>
                            <button 
                                onClick={confirmDelete}
                                disabled={deleteInput.toUpperCase() !== 'DELETAR'}
                                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Excluir Permanentemente
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Total */}
                        <div className="p-6 text-center">
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Valor Total</span>
                            <p className="text-4xl font-bold text-gray-900 dark:text-white mt-1">{formatCurrency(bill.valorReal || 0)}</p>
                        </div>

                        {/* Shares List */}
                        <div className="flex-1 overflow-y-auto px-6 pb-6">
                            <h4 className="text-sm font-bold text-gray-800 dark:text-white mb-3">Divisão</h4>
                            <div className="space-y-3">
                                {shares.map(share => {
                                    const participant = participants.find(p => p.id === share.participantId);
                                    const isMe = participant?.nomeExibicao === 'Você';
                                    
                                    // Lógica de status
                                    let statusText = '';
                                    let statusColor = '';
                                    let actionButton = null;

                                    if (share.status === 'pagoDireto') {
                                        statusText = 'Pagou a conta';
                                        statusColor = 'text-gray-500';
                                    } else if (share.status === 'pagoAoPagadorPrincipal') {
                                        statusText = 'Reembolsou';
                                        statusColor = 'text-green-600';
                                    } else {
                                        statusText = 'Pendente';
                                        statusColor = 'text-red-500';
                                        
                                        // Ações
                                        if (isCurrentUserPayer && !isMe) {
                                            actionButton = (
                                                <button 
                                                    onClick={() => onUpdateShareStatus(share, 'pagoAoPagadorPrincipal')}
                                                    className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 transition-colors"
                                                >
                                                    Marcar Recebido
                                                </button>
                                            );
                                        } else if (!isCurrentUserPayer && isMe) {
                                            // Simplificação: Apenas o pagador principal dá baixa.
                                            statusText = 'Você deve';
                                        }
                                    }

                                    return (
                                        <div key={share.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-dark-200/50 rounded-lg border border-gray-100 dark:border-gray-700">
                                            <div className="flex items-center gap-3">
                                                <div 
                                                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                                                    style={{ backgroundColor: participant?.corIdentidade || '#ccc' }}
                                                >
                                                    {participant?.nomeExibicao.substring(0, 1)}
                                                </div>
                                                <div>
                                                    <p className="font-medium text-gray-800 dark:text-gray-200 text-sm">{participant?.nomeExibicao}</p>
                                                    <p className={`text-xs ${statusColor} font-medium flex items-center`}>
                                                        {statusText}
                                                        {(share.status === 'pagoDireto' || share.status === 'pagoAoPagadorPrincipal') && <CheckIcon className="w-3 h-3 ml-1" />}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className="font-bold text-gray-800 dark:text-white text-sm">{formatCurrency(share.valorDevido)}</p>
                                                {actionButton}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default SplitBillDetailsModal;
