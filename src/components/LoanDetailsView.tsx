
import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useLoan, useLoanMovements, useCreateMovement, useDeleteLoan } from '../modules/loans/hooks.ts';
import { Loan, LoanMovement, LoanStatus } from '../modules/loans/types.ts';
// Added HandshakeIcon to the imports below
import { BackIcon, DynamicIcon, HistoryIcon, CoinsIcon, PlusIcon, CalendarIcon, WarningIcon, EditIcon, DeleteIcon, CheckIcon, HandshakeIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import LoanMovementModal from './LoanMovementModal.tsx';
import ConfirmationModal from './ConfirmationModal.tsx';

interface LoanDetailsViewProps {
    loanId: string;
    onBack: () => void;
    onAddTransaction: (t: any) => void;
}

const LoanDetailsView: React.FC<LoanDetailsViewProps> = ({ loanId, onBack, onAddTransaction }) => {
    const { data: loan, isLoading } = useLoan(loanId);
    const { data: movements } = useLoanMovements(loanId);
    const deleteLoanMutation = useDeleteLoan();
    const createMovementMutation = useCreateMovement();
    
    const { playSound } = useTheme();
    const { activeWorkspace } = useWorkspace();
    const MotionDiv = motion.div as any;

    const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [deleteOption, setDeleteOption] = useState<'both' | 'loan'>('loan');

    if (isLoading || !loan) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;

    const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    const totalToSettle = loan.principalValue + (loan.interestType === 'fixed' ? loan.interestValue || 0 : 0);
    const progress = Math.min(100, (loan.totalPaidReceived / (totalToSettle || 1)) * 100);

    const handleAddMovement = (amount: number, date: string, description: string, isFullSettlement: boolean) => {
        const movementId = Date.now().toString();
        
        // 1. Constrói o objeto de movimentação
        const newMovement: LoanMovement = {
            id: movementId,
            loanId: loan.id,
            type: loan.type === 'lend' ? 'receipt' : 'payment',
            amount,
            date,
            description,
            createdAt: new Date().toISOString()
        };

        // 2. (Opcional) Cria a transação no fluxo de caixa global
        // Isso mantém o registro financeiro, mas não afeta o saldo do empréstimo (que é isolado)
        const tType = loan.type === 'lend' ? 'receita' : 'despesa';
        const category = loan.type === 'lend' ? 'Recuperação de Empréstimo' : 'Pagamento de Empréstimo';
        
        onAddTransaction({
            type: tType,
            description: `${description} (${loan.personName})`,
            value: amount,
            date: date,
            category,
            loanId: loan.id,
            loanMovementId: movementId,
            isPaid: true,
            profileId: activeWorkspace.id
        });

        // 3. Envia para a API (que vai atualizar o saldo e o histórico automaticamente)
        createMovementMutation.mutate(newMovement, {
            onSuccess: () => {
                playSound('success');
                setIsMovementModalOpen(false);
            }
        });
    };

    const handleDelete = () => {
        // Logic to keep or delete transactions should be handled here or by passing flags to API.
        // In this mock, we just delete the loan.
        deleteLoanMutation.mutate(loan.id, {
            onSuccess: () => {
                playSound('success');
                onBack();
            }
        });
    };

    return (
        <div className="flex flex-col h-full animate-fade-in pb-10">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                <button onClick={onBack} className="flex items-center gap-2 text-muted hover:text-on-surface transition-colors">
                    <BackIcon className="h-5 w-5" /> Voltar
                </button>
                <div className="flex items-center gap-3">
                    <button onClick={() => setIsDeleteModalOpen(true)} className="p-2 bg-red-50 text-red-600 dark:bg-red-900/20 rounded-lg hover:bg-red-100 transition-colors shadow-sm" title="Excluir"><DeleteIcon className="h-4 w-4" /></button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                <div className="lg:col-span-2 bg-surface rounded-2xl p-8 shadow-md border border-border relative overflow-hidden">
                    <div className="flex items-start gap-6 relative z-10">
                        <div className={`w-20 h-20 rounded-3xl flex items-center justify-center shadow-lg border-4 border-surface text-white text-4xl ${loan.type === 'lend' ? 'bg-green-600' : 'bg-red-600'}`}>
                            <HandshakeIcon size={40} />
                        </div>
                        <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                                <span className={`px-2.5 py-1 rounded text-[10px] uppercase font-bold tracking-widest ${loan.type === 'lend' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                    {loan.type === 'lend' ? 'Eu Emprestei' : 'Eu Peguei Emprestado'}
                                </span>
                                <span className="px-2.5 py-1 rounded text-[10px] uppercase font-bold bg-background text-muted border border-border">{loan.status}</span>
                            </div>
                            <h1 className="text-4xl font-black text-on-surface mb-2">{loan.personName}</h1>
                            <p className="text-muted text-sm">{loan.description}</p>
                            {loan.personContact && <p className="text-xs text-primary mt-1 font-medium">{loan.personContact}</p>}
                        </div>
                    </div>

                    <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <span className="text-sm font-bold text-muted uppercase tracking-widest">Saldo Pendente</span>
                            <div className="text-4xl font-black text-on-surface mt-1">{formatCurrency(loan.currentBalance)}</div>
                            <div className="h-3 bg-background rounded-full overflow-hidden relative mt-4 border border-border/50">
                                <MotionDiv className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 1 }} />
                            </div>
                            <div className="flex justify-between mt-2 text-[10px] font-bold text-muted uppercase">
                                <span>Quitação: {Math.round(progress)}%</span>
                                <span>{formatCurrency(loan.totalPaidReceived)} pagos</span>
                            </div>
                        </div>
                        
                        <div className="space-y-4">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted font-medium">Principal:</span>
                                <span className="font-bold text-on-surface">{formatCurrency(loan.principalValue)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted font-medium">Juros:</span>
                                <span className="font-bold text-on-surface">{loan.interestType === 'none' ? 'Sem juros' : `${loan.interestValue}${loan.interestType === 'percentage' ? '%' : ' fixos'}`}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span className="text-muted font-medium">Modo:</span>
                                <span className="font-bold text-on-surface">{loan.hasInstallments ? `${loan.installmentsCount} parcelas` : 'Pagamento único'}</span>
                            </div>
                            <div className="flex justify-between text-sm pt-2 border-t border-border">
                                <span className="text-muted font-medium">Método Previsto:</span>
                                <span className="font-bold text-on-surface">{loan.paymentMethod}</span>
                            </div>
                        </div>
                    </div>
                    
                    <button 
                        disabled={loan.status === 'paid'}
                        onClick={() => setIsMovementModalOpen(true)}
                        className="mt-8 w-full py-4 bg-primary hover:bg-primary/90 text-white rounded-xl font-bold shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 disabled:bg-gray-300 disabled:shadow-none"
                    >
                        <PlusIcon className="w-5 h-5" /> Registrar Pagamento/Recebimento
                    </button>
                </div>

                <div className="space-y-4">
                    <div className="bg-surface rounded-2xl p-6 shadow-sm border border-border flex items-center gap-4">
                        <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><CalendarIcon className="h-6 w-6" /></div>
                        <div>
                            <span className="text-[10px] font-black text-muted uppercase tracking-widest block">Data de Início</span>
                            <p className="text-lg font-bold text-on-surface">{new Date(loan.startDate).toLocaleDateString('pt-BR')}</p>
                        </div>
                    </div>
                    <div className="bg-surface rounded-2xl p-6 shadow-sm border border-border flex items-center gap-4">
                        <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl"><CoinsIcon className="h-6 w-6" /></div>
                        <div>
                            <span className="text-[10px] font-black text-muted uppercase tracking-widest block">Quitação Prevista</span>
                            <p className="text-lg font-bold text-on-surface">{new Date(loan.expectedPayoffDate).toLocaleDateString('pt-BR')}</p>
                        </div>
                    </div>
                    {loan.status === 'overdue' && (
                        <div className="bg-red-50 dark:bg-red-900/10 p-6 rounded-2xl border border-red-200 dark:border-red-900/30 flex items-center gap-4">
                            <div className="p-3 bg-red-100 text-red-600 rounded-xl"><WarningIcon className="h-6 w-6" /></div>
                            <div>
                                <span className="text-[10px] font-black text-red-600 uppercase tracking-widest block">Atenção</span>
                                <p className="text-sm font-bold text-red-700">Contrato em atraso!</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-1 min-h-0">
                 <div className="flex flex-col min-h-0">
                    <h3 className="font-bold text-lg text-on-surface mb-4 flex items-center gap-2"><HistoryIcon className="h-5 w-5 text-primary" /> Histórico de Movimentações</h3>
                    <div className="bg-surface rounded-xl shadow-sm border border-border flex-1 overflow-hidden flex flex-col">
                        <div className="overflow-y-auto custom-scrollbar flex-1 p-2">
                             {movements && movements.length > 0 ? (
                                 <div className="space-y-2">
                                     {movements.map(m => (
                                         <div key={m.id} className="p-4 bg-background rounded-lg border border-border flex justify-between items-center hover:bg-surface/50 transition-colors">
                                            <div>
                                                <p className="font-bold text-on-surface text-sm">{m.description}</p>
                                                <p className="text-xs text-muted">{new Date(m.date).toLocaleDateString('pt-BR')}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className={`font-black ${loan.type === 'lend' ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(m.amount)}</p>
                                                <span className="text-[9px] text-muted uppercase font-bold flex items-center justify-end gap-1"><CheckIcon className="w-3 h-3" /> Conciliado</span>
                                            </div>
                                         </div>
                                     ))}
                                 </div>
                             ) : (
                                 <div className="flex flex-col items-center justify-center h-48 text-muted opacity-50">
                                     <HistoryIcon className="w-12 h-12 mb-2" />
                                     <p className="text-sm font-medium">Nenhuma movimentação registrada.</p>
                                 </div>
                             )}
                        </div>
                    </div>
                 </div>

                 {loan.hasInstallments && (
                     <div className="flex flex-col min-h-0">
                        <h3 className="font-bold text-lg text-on-surface mb-4 flex items-center gap-2"><CalendarIcon className="h-5 w-5 text-primary" /> Plano de Pagamento</h3>
                        <div className="bg-surface rounded-xl shadow-sm border border-border flex-1 overflow-hidden flex flex-col p-4">
                            <div className="overflow-y-auto custom-scrollbar flex-1 space-y-3 pr-2">
                                {loan.installments?.map(inst => (
                                    <div key={inst.number} className="flex items-center justify-between p-3 rounded-xl border border-border bg-background/50">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs ${inst.status === 'paid' ? 'bg-green-100 text-green-700' : inst.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
                                                {inst.number}
                                            </div>
                                            <div>
                                                <p className="font-bold text-on-surface text-xs">Parcela {inst.number}</p>
                                                <p className="text-[10px] text-muted">Vence em {new Date(inst.dueDate).toLocaleDateString('pt-BR')}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-bold text-on-surface text-sm">{formatCurrency(inst.amount)}</p>
                                            <span className={`text-[9px] font-black uppercase ${inst.status === 'paid' ? 'text-green-600' : inst.status === 'overdue' ? 'text-red-600' : 'text-gray-400'}`}>{inst.status}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                     </div>
                 )}
            </div>

            <LoanMovementModal 
                isOpen={isMovementModalOpen}
                onClose={() => setIsMovementModalOpen(false)}
                loan={loan}
                onSave={handleAddMovement}
            />

            <ConfirmationModal 
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                title="Excluir Empréstimo"
                message="Deseja excluir este empréstimo? Você pode escolher se mantém as transações financeiras já geradas ou se remove tudo."
                onConfirm={handleDelete}
            />
        </div>
    );
};

export default LoanDetailsView;
