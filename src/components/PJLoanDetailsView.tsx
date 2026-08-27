
import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useLoan, useLoanMovements, useUpdateLoan, useCreateMovement, useDeleteLoan } from '../modules/loans/hooks.ts';
import { Loan, LoanMovement, LoanStatus } from '../modules/loans/types.ts';
import { BackIcon, DynamicIcon, HistoryIcon, CoinsIcon, PlusIcon, CalendarIcon, WarningIcon, EditIcon, DeleteIcon, CheckIcon, BuildingIcon, BriefcaseIcon, HandshakeIcon, TrendingUpIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import PJLoanMovementModal from './PJLoanMovementModal.tsx';
import ConfirmationModal from './ConfirmationModal.tsx';
import { calculateTotalLoanCost, getPJLoanClassificationLabel } from '../modules/loans/pj-logic.ts';

interface PJLoanDetailsViewProps {
    loanId: string;
    onBack: () => void;
    onAddTransaction: (t: any) => void;
}

const PJLoanDetailsView: React.FC<PJLoanDetailsViewProps> = ({ loanId, onBack, onAddTransaction }) => {
    const { data: loan, isLoading } = useLoan(loanId);
    const {
        data: movements,
        hasNextPage: hasMoreMovements,
        fetchNextPage: fetchMoreMovements,
        isFetchingNextPage: isFetchingMoreMovements,
    } = useLoanMovements(loanId);
    const updateLoanMutation = useUpdateLoan();
    const deleteLoanMutation = useDeleteLoan();
    const createMovementMutation = useCreateMovement();
    
    const { playSound } = useTheme();
    const { activeWorkspace } = useWorkspace();
    const MotionDiv = motion.div as any;

    const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

    const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

    const metrics = useMemo(() => {
        if (!loan) return { totalCost: 0, paid: 0, interestPaid: 0, balance: 0, progress: 0 };
        const totalCost = calculateTotalLoanCost(loan);
        const paid = loan.totalPaidReceived + loan.totalInterestPaidReceived;
        const balance = loan.currentBalance;
        const progress = Math.min(100, (loan.totalPaidReceived / loan.principalValue) * 100);
        return { totalCost, paid, interestPaid: loan.totalInterestPaidReceived, balance, progress };
    }, [loan]);

    if (isLoading || !loan) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;

    const isLiab = loan.type === 'borrow';

    const handleAddMovement = (pAmount: number, iAmount: number, date: string, description: string, isFullSettlement: boolean) => {
        const movementId = 'pj_mv_' + Date.now().toString();
        const totalAmount = pAmount + iAmount;
        
        const newMovement: LoanMovement = {
            id: movementId,
            loanId: loan.id,
            type: isLiab ? 'payment' : 'receipt',
            amount: totalAmount,
            principalAmount: pAmount,
            interestAmount: iAmount,
            date,
            description,
            createdAt: new Date().toISOString()
        };

        // Create Corporate Transaction
        const tType = isLiab ? 'despesa' : 'receita';
        const category = isLiab ? 'Pagamento Financiamento' : 'Amortização Recebível';
        
        onAddTransaction({
            type: tType,
            description: `[AMORT] ${loan.personName}: ${description}`,
            value: totalAmount,
            date: date,
            category,
            loanId: loan.id,
            loanMovementId: movementId,
            isPaid: true,
            profileId: activeWorkspace.id,
            costCenter: loan.costCenter,
            supplier: loan.personName
        });

        // Update Loan State
        const newTotalPrincipal = loan.totalPaidReceived + pAmount;
        const newTotalInterest = loan.totalInterestPaidReceived + iAmount;
        const newBalance = Math.max(0, loan.currentBalance - pAmount);
        const newStatus: LoanStatus = (isFullSettlement || newBalance <= 0) ? 'paid' : loan.status;

        createMovementMutation.mutate(newMovement);
        updateLoanMutation.mutate({
            ...loan,
            totalPaidReceived: newTotalPrincipal,
            totalInterestPaidReceived: newTotalInterest,
            currentBalance: newBalance,
            status: newStatus,
            updatedAt: new Date().toISOString()
        });
        
        playSound('success');
    };

    const handleDelete = () => {
        deleteLoanMutation.mutate(loan.id, {
            onSuccess: () => {
                playSound('success');
                onBack();
            }
        });
    };

    return (
        <div className="flex flex-col h-full animate-fade-in pb-10">
            {/* Toolbar */}
            <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
                <button onClick={onBack} className="flex items-center gap-2 text-muted hover:text-on-surface transition-all group">
                    <BackIcon className="h-5 w-5 group-hover:-translate-x-1 transition-transform" />
                    <span className="font-bold text-sm uppercase tracking-widest">Painel de Empréstimos</span>
                </button>
                <div className="flex items-center gap-3">
                    <button className="px-4 py-2 bg-surface border border-border text-xs font-bold uppercase rounded-lg hover:bg-background transition-all flex items-center gap-2">
                        <EditIcon className="h-3.5 w-3.5" /> Editar Operação
                    </button>
                    <button onClick={() => setIsDeleteModalOpen(true)} className="p-2.5 bg-red-50 text-red-600 dark:bg-red-900/20 rounded-lg hover:bg-red-100 transition-colors shadow-sm" title="Excluir"><DeleteIcon className="h-4 w-4" /></button>
                </div>
            </div>

            {/* Analysis Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-8">
                {/* Main Identity & Principal */}
                <div className="lg:col-span-3 bg-surface rounded-3xl p-8 shadow-xl border border-border relative overflow-hidden flex flex-col">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-10">
                        <div className="flex items-center gap-6">
                            <div className={`w-20 h-20 rounded-3xl flex items-center justify-center text-white shadow-2xl border-4 border-surface text-4xl transform -rotate-3 ${isLiab ? 'bg-red-600' : 'bg-green-600'}`}>
                                <HandshakeIcon size={40} />
                            </div>
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    <span className={`px-2.5 py-1 rounded-full text-[10px] uppercase font-black tracking-widest ${isLiab ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                                        {isLiab ? 'Passivo Financeiro' : 'Ativo Financeiro'}
                                    </span>
                                    <span className="px-2.5 py-1 rounded-full text-[10px] uppercase font-black bg-background text-muted border border-border tracking-wider">{loan.status}</span>
                                </div>
                                <h1 className="text-4xl font-black text-on-surface tracking-tight leading-none mb-2">{loan.personName}</h1>
                                <p className="text-muted text-sm font-medium flex items-center gap-2">
                                    <BriefcaseIcon className="w-4 h-4" /> {loan.costCenter || 'Sem centro de custo vinculado'}
                                </p>
                            </div>
                        </div>

                        <div className="text-right flex flex-col items-end">
                            <span className="text-[11px] font-black text-muted uppercase tracking-[0.2em] mb-1">{isLiab ? 'Saldo Devedor Atual' : 'Saldo a Receber Atual'}</span>
                            <div className="text-5xl font-black text-on-surface tracking-tighter">{formatCurrency(metrics.balance)}</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 pt-8 border-t border-border mt-auto">
                        <div>
                            <span className="text-[10px] font-black text-muted uppercase tracking-widest mb-1 block">Principal Contratado</span>
                            <p className="text-xl font-bold text-on-surface">{formatCurrency(loan.principalValue)}</p>
                        </div>
                        <div>
                            <span className="text-[10px] font-black text-muted uppercase tracking-widest mb-1 block">Total Amortizado</span>
                            <p className="text-xl font-bold text-green-600">{formatCurrency(loan.totalPaidReceived)}</p>
                        </div>
                        <div>
                            <span className="text-[10px] font-black text-muted uppercase tracking-widest mb-1 block">Juros Acumulados ({isLiab ? 'Pagos' : 'Rec.'})</span>
                            <p className="text-xl font-bold text-blue-600">{formatCurrency(loan.totalInterestPaidReceived)}</p>
                        </div>
                    </div>

                    <div className="mt-8 space-y-2">
                        <div className="flex justify-between text-[10px] font-black text-muted uppercase tracking-[0.15em]">
                            <span>Status da Liquidação</span>
                            <span>{Math.round(metrics.progress)}% concluído</span>
                        </div>
                        <div className="h-2.5 bg-background rounded-full overflow-hidden border border-border/50 relative">
                            <MotionDiv className="h-full bg-primary" initial={{ width: 0 }} animate={{ width: `${metrics.progress}%` }} transition={{ duration: 1.2 }} />
                        </div>
                    </div>
                </div>

                {/* PJ Insights Sidebar */}
                <div className="space-y-6">
                    <div className="bg-primary/5 rounded-3xl p-6 border border-primary/20 flex flex-col justify-between">
                         <div className="flex items-center gap-3 mb-4">
                            <div className="p-2 bg-primary text-white rounded-xl shadow-lg">
                                <TrendingUpIcon className="w-5 h-5" />
                            </div>
                            <h4 className="font-black text-sm text-primary uppercase tracking-widest">Resumo PJ</h4>
                         </div>
                         <div className="space-y-4">
                            <div>
                                <span className="text-[9px] font-bold text-muted uppercase">Custo Efetivo Total (Est.)</span>
                                <p className="text-lg font-black text-on-surface">{formatCurrency(metrics.totalCost)}</p>
                            </div>
                            <div className="pt-3 border-t border-primary/10">
                                <span className="text-[9px] font-bold text-muted uppercase">Taxa Vigente</span>
                                <p className="text-sm font-bold text-on-surface">
                                    {loan.interestType === 'none' ? 'Sem juros' : `${loan.interestValue}${loan.interestBasis === 'monthly' ? '% a.m.' : '% a.a.'}`}
                                </p>
                            </div>
                            <div className="pt-3 border-t border-primary/10">
                                <span className="text-[9px] font-bold text-muted uppercase">Impacto Fluxo de Caixa</span>
                                <p className="text-xs font-medium text-muted leading-relaxed">Provisionado em {loan.hasInstallments ? `${loan.installmentsCount} parcelas` : 'Pagamento único'}.</p>
                            </div>
                         </div>
                    </div>

                    <div className="bg-surface rounded-3xl p-6 shadow-sm border border-border space-y-4">
                        <div className="flex items-center gap-3">
                             <CalendarIcon className="w-5 h-5 text-muted" />
                             <div>
                                <p className="text-[9px] font-bold text-muted uppercase leading-none">Início</p>
                                <p className="text-sm font-bold text-on-surface">{new Date(loan.startDate).toLocaleDateString('pt-BR')}</p>
                             </div>
                        </div>
                        <div className="flex items-center gap-3 pt-4 border-t border-border">
                             <CoinsIcon className="w-5 h-5 text-muted" />
                             <div>
                                <p className="text-[9px] font-bold text-muted uppercase leading-none">Vencimento Final</p>
                                <p className="text-sm font-bold text-on-surface">{new Date(loan.expectedPayoffDate).toLocaleDateString('pt-BR')}</p>
                             </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Actions & Schedule */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 flex-1">
                {/* Movements History */}
                <div className="lg:col-span-7 flex flex-col min-h-[400px]">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-black text-lg text-on-surface uppercase tracking-widest flex items-center gap-2">
                            <HistoryIcon className="h-5 w-5 text-primary" /> Histórico de Movimentações
                        </h3>
                        <button 
                            disabled={loan.status === 'paid'}
                            onClick={() => setIsMovementModalOpen(true)}
                            className="bg-primary hover:bg-primary/90 text-white px-5 py-2 rounded-xl text-xs font-black uppercase tracking-wider shadow-lg transition-all active:scale-95 disabled:bg-gray-300 disabled:shadow-none"
                        >
                            <PlusIcon className="w-3.5 h-3.5 inline mr-1" /> Novo Lançamento
                        </button>
                    </div>

                    <div className="bg-surface rounded-3xl shadow-xl border border-border flex-1 overflow-hidden flex flex-col">
                        <div className="overflow-y-auto custom-scrollbar flex-1 p-3">
                             {movements && movements.length > 0 ? (
                                 <div className="space-y-3">
                                     {movements.map(m => (
                                         <div key={m.id} className="p-4 bg-background rounded-2xl border border-border flex justify-between items-center hover:shadow-md transition-all">
                                            <div className="flex items-center gap-4">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white ${isLiab ? 'bg-red-500' : 'bg-green-500'}`}>
                                                     <CoinsIcon size={18} />
                                                </div>
                                                <div>
                                                    <p className="font-bold text-on-surface text-sm">{m.description}</p>
                                                    <div className="flex gap-2 items-center text-[10px] text-muted font-bold uppercase mt-0.5">
                                                        <span>{new Date(m.date).toLocaleDateString('pt-BR')}</span>
                                                        <span>•</span>
                                                        <span>P: {formatCurrency(m.principalAmount || 0)}</span>
                                                        <span>•</span>
                                                        <span>J: {formatCurrency(m.interestAmount || 0)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <p className={`font-black text-lg ${isLiab ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(m.amount)}</p>
                                                <span className="text-[9px] text-green-600 uppercase font-black flex items-center justify-end gap-1"><CheckIcon className="w-3 h-3" /> Conciliado</span>
                                            </div>
                                         </div>
                                     ))}

                                     {hasMoreMovements && (
                                         <button
                                             type="button"
                                             onClick={() => fetchMoreMovements()}
                                             disabled={isFetchingMoreMovements}
                                             className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-bold text-on-surface disabled:opacity-60"
                                         >
                                             {isFetchingMoreMovements ? 'Carregando…' : 'Carregar movimentações anteriores'}
                                         </button>
                                     )}
                                 </div>
                             ) : (
                                 <div className="flex flex-col items-center justify-center h-full text-muted opacity-40 py-20">
                                     <HistoryIcon className="w-16 h-16 mb-4" />
                                     <p className="text-sm font-black uppercase tracking-widest">Sem movimentações financeiras</p>
                                 </div>
                             )}
                        </div>
                    </div>
                </div>

                {/* Schedule Column */}
                <div className="lg:col-span-5 flex flex-col h-full">
                    <h3 className="font-black text-lg text-on-surface uppercase tracking-widest mb-6 flex items-center gap-2">
                        <CalendarIcon className="h-5 w-5 text-primary" /> Cronograma PJ
                    </h3>
                    <div className="bg-surface rounded-3xl shadow-xl border border-border flex-1 overflow-hidden flex flex-col p-6">
                        {loan.hasInstallments ? (
                            <div className="overflow-y-auto custom-scrollbar flex-1 space-y-4 pr-2">
                                {loan.installments?.map(inst => (
                                    <div key={inst.number} className={`flex items-center justify-between p-4 rounded-2xl border ${inst.status === 'paid' ? 'bg-green-50/30 border-green-100' : inst.status === 'overdue' ? 'bg-red-50/30 border-red-100' : 'bg-background/50 border-border'}`}>
                                        <div className="flex items-center gap-4">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm shadow-sm ${inst.status === 'paid' ? 'bg-green-100 text-green-700' : inst.status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-gray-200 text-gray-600'}`}>
                                                {inst.number}
                                            </div>
                                            <div>
                                                <p className="font-black text-on-surface text-xs uppercase tracking-wider">Parcela {inst.number}</p>
                                                <p className="text-[10px] text-muted font-bold">Vence em {new Date(inst.dueDate).toLocaleDateString('pt-BR')}</p>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-black text-on-surface text-base">{formatCurrency(inst.amount)}</p>
                                            <div className="flex gap-2 justify-end mt-1">
                                                <span className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${inst.status === 'paid' ? 'bg-green-600 text-white' : inst.status === 'overdue' ? 'bg-red-600 text-white' : 'bg-gray-400 text-white'}`}>{inst.status}</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-center p-6 text-muted">
                                <div className="p-4 bg-background rounded-full mb-4">
                                    <CoinsIcon className="w-10 h-10 opacity-30" />
                                </div>
                                <p className="text-sm font-bold uppercase tracking-widest">Pagamento Único</p>
                                <p className="text-xs mt-2">Nenhum cronograma recorrente para esta operação.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <PJLoanMovementModal 
                isOpen={isMovementModalOpen}
                onClose={() => setIsMovementModalOpen(false)}
                loan={loan}
                onSave={handleAddMovement}
            />

            <ConfirmationModal 
                isOpen={isDeleteModalOpen}
                onClose={() => setIsDeleteModalOpen(false)}
                title="Remover Operação Financeira"
                message="Deseja excluir este registro de empréstimo? Você pode optar por manter as transações conciliadas no seu fluxo de caixa PJ."
                onConfirm={handleDelete}
            />
        </div>
    );
};

export default PJLoanDetailsView;
