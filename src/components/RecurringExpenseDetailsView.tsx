
import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useRecurringExpense, useRecurringOccurrences, useSaveOccurrence, useUpdateRecurringExpense } from '../modules/recurring-expenses/hooks.ts';
import { useSplitParticipants, useCreateSplitBill } from '../modules/split-bills/hooks.ts';
import { BackIcon, DynamicIcon, CalendarIcon, WarningIcon, TrendingUpIcon, BuildingIcon, BriefcaseIcon, FileInvoiceIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { RecurringStatus, RecurringOccurrence, RecurringAdjustment } from '../modules/recurring-expenses/types.ts';
import { SplitBill, SplitShare } from '../types.ts';
import { Transaction } from '../types.ts';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';

interface RecurringExpenseDetailsViewProps {
    expenseId: string;
    onBack: () => void;
    onAddTransaction: (transaction: Omit<Transaction, 'id'> & { id?: number }) => void;
}

const listVariants = {
    hidden: { opacity: 0 },
    show: {
        opacity: 1,
        transition: {
            staggerChildren: 0.05
        }
    }
};

const itemVariants = {
    hidden: { opacity: 0, x: -10 },
    show: { opacity: 1, x: 0 }
};

const RecurringExpenseDetailsView: React.FC<RecurringExpenseDetailsViewProps> = ({ expenseId, onBack, onAddTransaction }) => {
    const { activeWorkspace } = useWorkspace();
    const isPJ = activeWorkspace.type === 'PJ';
    
    const { data: expense, isLoading: isExpenseLoading } = useRecurringExpense(expenseId);
    const saveOccurrenceMutation = useSaveOccurrence();
    const updateExpenseMutation = useUpdateRecurringExpense();
    const MotionDiv = motion.div as any;
    
    // Split Bill Hooks
    const { data: splitParticipants } = useSplitParticipants(expense?.splitGroupIdOpcional || '');
    const createSplitBillMutation = useCreateSplitBill();

    // Calculate range for occurrences
    const range = useMemo(() => {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth() - 6, 1);
        const end = new Date(today.getFullYear(), today.getMonth() + 7, 0); 
        return { start, end };
    }, []);

    const { data: occurrences, isLoading: isOccurrencesLoading } = useRecurringOccurrences(range.start, range.end);
    const { playSound } = useTheme();

    // Adjustment State
    const [isAdjusting, setIsAdjusting] = useState(false);
    const [newPrice, setNewPrice] = useState('');
    const [adjustmentNote, setAdjustmentNote] = useState('');

    if (isExpenseLoading || !expense) {
        return (
            <div className="flex items-center justify-center h-full">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
            </div>
        );
    }

    const formatCurrency = (val: number) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
    };

    // Logic: Expiring Soon
    const isExpiringSoon = () => {
        if (!expense.dataFim) return false;
        const today = new Date();
        const endDate = new Date(expense.dataFim);
        const diffTime = endDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays > 0 && diffDays <= 45;
    };

    const handleGenerate = async (occurrence: RecurringOccurrence, markAsPaid: boolean = false) => {
        const transactionId = Date.now();
        const splitBillId = Date.now().toString();
        
        let updatedOccurrence = { ...occurrence };

        // 1. Integration: Expenses / Credit Card
        if (expense.gerarDespesaAutomaticamente) {
            const isCreditCard = expense.metodoPagamento === 'cartaoCredito' && expense.usarCartaoAutomaticamente;
            
            const newTransaction: any = {
                id: transactionId,
                description: `${expense.nome} (${new Date(occurrence.dataPrevista).toLocaleString('pt-BR', { month: 'long' })})`,
                value: occurrence.valorPrevisto,
                date: occurrence.dataPrevista,
                category: isPJ ? (expense.tipoEmpresa || 'Contratos') : 'Assinaturas', 
                type: 'despesa', 
                paymentMethod: expense.metodoPagamento === 'cartaoCredito' ? 'Cartão de Crédito' : 'Outro',
                isPaid: markAsPaid,
                profileId: activeWorkspace.id
            };

            if (isCreditCard && expense.cartaoIdOpcional) {
                newTransaction.cardId = parseInt(expense.cartaoIdOpcional);
            }

            onAddTransaction(newTransaction);
            updatedOccurrence.despesaId = transactionId.toString();
            updatedOccurrence.cartaoCompraId = isCreditCard ? transactionId.toString() : undefined;
        }

        // 2. Integration: Split Bills
        if (expense.splitGroupIdOpcional && expense.dividirAutomaticamenteNoGrupo && splitParticipants && splitParticipants.length > 0) {
            const amount = occurrence.valorPrevisto;
            const splitAmount = amount / splitParticipants.length;
            
            const me = splitParticipants.find(p => p.nomeExibicao === 'Você');
            const payerId = me?.id || splitParticipants[0].id;

            // Map payment method from Recurring to SplitBill types
            let splitPaymentMethod: any = expense.metodoPagamento;
            if (expense.metodoPagamento === 'debitoConta') splitPaymentMethod = 'transferencia';
            else if (expense.metodoPagamento === 'boleto') splitPaymentMethod = 'outro';

            const bill: SplitBill = {
                id: splitBillId,
                groupId: expense.splitGroupIdOpcional,
                descricao: `${expense.nome} (${new Date(occurrence.dataPrevista).toLocaleString('pt-BR', { month: 'short' })})`,
                categoriaNome: isPJ ? (expense.tipoEmpresa || 'Recorrência Corp.') : 'Assinaturas',
                tipoValor: 'fixo',
                valorReal: amount,
                moeda: 'BRL',
                competencia: occurrence.competencia,
                statusPagamento: markAsPaid ? 'pago' : 'pendente',
                formaPagamento: splitPaymentMethod,
                pagadorPrincipalId: payerId,
                createdAt: new Date().toISOString()
            };

            const shares: SplitShare[] = splitParticipants.map(p => ({
                id: Date.now().toString() + Math.random(),
                billId: splitBillId,
                participantId: p.id,
                valorDevido: splitAmount,
                valorPago: p.id === payerId ? splitAmount : 0, 
                status: p.id === payerId ? 'pagoDireto' : 'aPagar'
            }));

            createSplitBillMutation.mutate({ bill, shares });
            updatedOccurrence.splitBillId = splitBillId;
        }

        updatedOccurrence.status = markAsPaid ? 'pago' : 'gerado';
        saveOccurrenceMutation.mutate(updatedOccurrence);
        playSound('success');
    };

    const handleAdjustPrice = (e: React.FormEvent) => {
        e.preventDefault();
        const price = parseFloat(newPrice);
        if (!price || price <= 0) return;

        const adjustment: RecurringAdjustment = {
            id: Date.now().toString(),
            date: new Date().toISOString(),
            oldValue: expense.valorPadrao,
            newValue: price,
            note: adjustmentNote
        };

        const currentAdjustments = expense.adjustments || [];
        updateExpenseMutation.mutate({
            id: expense.id,
            data: {
                valorPadrao: price,
                adjustments: [adjustment, ...currentAdjustments]
            }
        });

        setIsAdjusting(false);
        setNewPrice('');
        setAdjustmentNote('');
        playSound('success');
    };

    const getStatusBadge = (status: RecurringStatus) => {
        switch (status) {
            case 'ativo':
                return <span className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded text-xs font-bold uppercase">Ativo</span>;
            case 'pausado':
                return <span className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 px-2 py-0.5 rounded text-xs font-bold uppercase">Pausado</span>;
            case 'cancelado':
                return <span className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded text-xs font-bold uppercase">Cancelado</span>;
            default:
                return null;
        }
    };

    const todayStr = new Date().toISOString().split('T')[0];
    const pastOccurrences = occurrences?.filter(o => o.dataPrevista < todayStr).reverse() || [];
    const futureOccurrences = occurrences?.filter(o => o.dataPrevista >= todayStr) || [];

    return (
        <div className="flex flex-col h-full animate-fade-in pb-10">
            {/* Header */}
            <div className="flex items-center justify-between mb-6 flex-shrink-0">
                <button 
                    onClick={() => {
                        playSound('click');
                        onBack();
                    }}
                    className="flex items-center gap-2 text-muted hover:text-on-surface transition-colors"
                    aria-label="Voltar"
                >
                    <BackIcon className="h-5 w-5" />
                    <span className="text-sm font-medium">Voltar para {isPJ ? 'Contratos' : 'Recorrências'}</span>
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                {/* Hero Card */}
                <MotionDiv 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="lg:col-span-2 bg-surface rounded-card p-6 shadow-sm border border-border relative overflow-hidden flex flex-col justify-between"
                >
                    {isExpiringSoon() && (
                        <div className="absolute top-0 right-0 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 px-3 py-1 rounded-bl-xl text-xs font-bold flex items-center gap-1">
                            <WarningIcon className="w-4 h-4" />
                            Vence em breve: {new Date(expense.dataFim!).toLocaleDateString('pt-BR')}
                        </div>
                    )}

                    <div className="flex items-start gap-5">
                        <div 
                            className="w-20 h-20 rounded-2xl flex items-center justify-center text-white shadow-md text-4xl flex-shrink-0"
                            style={{ backgroundColor: expense.corPrincipal }}
                        >
                            {expense.emojiOpcional ? <span>{expense.emojiOpcional}</span> : <DynamicIcon name={expense.icone} size={40} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                                <h1 className="text-3xl font-bold text-on-surface truncate">{expense.nome}</h1>
                                {getStatusBadge(expense.status)}
                            </div>
                            
                            {isPJ ? (
                                <div className="flex items-center gap-2 text-sm font-medium text-primary bg-primary/5 px-2 py-1 rounded w-fit mb-3">
                                    <BuildingIcon className="w-4 h-4" />
                                    {expense.fornecedor || 'Fornecedor não informado'}
                                </div>
                            ) : (
                                <p className="text-muted text-sm mb-3">{expense.descricao || 'Sem descrição'}</p>
                            )}
                            
                            <div className="flex flex-wrap gap-3 text-sm">
                                <div className="flex items-center gap-1.5 text-on-surface bg-background px-3 py-1.5 rounded-lg border border-border">
                                    <span className="font-bold text-lg">{formatCurrency(expense.valorPadrao)}</span>
                                    <span className="text-xs text-muted">/ {expense.periodo}</span>
                                </div>
                                <div className="flex items-center gap-1.5 text-on-surface bg-background px-3 py-1.5 rounded-lg capitalize border border-border">
                                    <CalendarIcon className="w-4 h-4 text-muted" />
                                    <span>Dia {expense.diaCobranca}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 flex flex-wrap gap-4 border-t border-border pt-4">
                        <button 
                            onClick={() => setIsAdjusting(!isAdjusting)}
                            className="flex items-center gap-1.5 text-primary text-xs font-bold uppercase tracking-wider hover:underline"
                        >
                            <TrendingUpIcon className="w-4 h-4" />
                            Reajustar Valor
                        </button>
                        {isPJ && (
                            <div className="flex items-center gap-1.5 text-muted text-xs">
                                <DynamicIcon name="Paperclip" size={14} />
                                {expense.anexoNome ? 'Contrato Anexado' : 'Sem Anexo'}
                            </div>
                        )}
                    </div>
                </MotionDiv>

                {/* PJ Info Grid */}
                <div className="bg-surface rounded-card p-6 border border-border shadow-sm space-y-4">
                    <h3 className="text-xs font-bold text-muted uppercase tracking-widest border-b border-border pb-2">Informações do Contrato</h3>
                    
                    <div className="space-y-3">
                        {isPJ ? (
                            <>
                                <div>
                                    <span className="text-[10px] text-muted uppercase font-bold block">Responsável</span>
                                    <p className="text-sm font-medium text-on-surface">{expense.responsavel || '-'}</p>
                                </div>
                                <div>
                                    <span className="text-[10px] text-muted uppercase font-bold block">Centro de Custo</span>
                                    <p className="text-sm font-medium text-on-surface">{expense.centroCusto || '-'}</p>
                                </div>
                                <div>
                                    <span className="text-[10px] text-muted uppercase font-bold block">Próximo Reajuste</span>
                                    <p className="text-sm font-medium text-on-surface">{expense.dataReajuste ? formatDate(expense.dataReajuste) : '-'}</p>
                                </div>
                                <div>
                                    <span className="text-[10px] text-muted uppercase font-bold block">Fidelidade</span>
                                    <p className="text-sm font-medium text-on-surface">{expense.fidelidade || 'Sem fidelidade'}</p>
                                </div>
                            </>
                        ) : (
                            <>
                                <div>
                                    <span className="text-[10px] text-muted uppercase font-bold block">Data de Início</span>
                                    <p className="text-sm font-medium text-on-surface">{formatDate(expense.dataInicio)}</p>
                                </div>
                                <div>
                                    <span className="text-[10px] text-muted uppercase font-bold block">Tipo</span>
                                    <p className="text-sm font-medium text-on-surface capitalize">{expense.tipo}</p>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* Adjust Price Form */}
            {isAdjusting && (
                <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="mb-6 p-4 bg-background rounded-lg border border-border"
                >
                    <h4 className="text-sm font-bold text-on-surface mb-2">Novo Reajuste</h4>
                    <form onSubmit={handleAdjustPrice} className="flex gap-2 items-end">
                        <div>
                            <label className="block text-xs text-muted mb-1">Novo Valor</label>
                            <input 
                                type="number" 
                                step="0.01" 
                                value={newPrice} 
                                onChange={e => setNewPrice(e.target.value)} 
                                className="border border-border rounded px-2 py-1.5 text-sm w-24 bg-surface text-on-surface"
                                placeholder="0.00"
                                required
                            />
                        </div>
                        <div className="flex-1">
                            <label className="block text-xs text-muted mb-1">Motivo (Opcional)</label>
                            <input 
                                type="text" 
                                value={adjustmentNote} 
                                onChange={e => setAdjustmentNote(e.target.value)} 
                                className="border border-border rounded px-2 py-1.5 text-sm w-full bg-surface text-on-surface"
                                placeholder="Ex: Reajuste anual da operadora"
                            />
                        </div>
                        <button type="submit" className="bg-primary hover:bg-primary/90 text-white px-3 py-1.5 rounded text-sm font-medium">
                            Salvar
                        </button>
                        <button type="button" onClick={() => setIsAdjusting(false)} className="text-muted hover:text-on-surface px-3 py-1.5 text-sm">
                            Cancelar
                        </button>
                    </form>
                </motion.div>
            )}

            {/* Timeline / Occurrences */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    
                    {/* Column 1: Projections & History */}
                    <div className="space-y-8">
                        <div>
                            <h3 className="text-lg font-bold text-on-surface mb-4 flex items-center gap-2">
                                <CalendarIcon className="w-5 h-5 text-primary" />
                                {isPJ ? 'Provisionamento e Pagamentos' : 'Próximos Vencimentos'}
                            </h3>
                            {isOccurrencesLoading ? (
                                <div className="text-center py-4 text-muted">Carregando projeção...</div>
                            ) : (
                                <MotionDiv 
                                    variants={listVariants}
                                    initial="hidden"
                                    animate="show"
                                    className="space-y-3"
                                >
                                    {futureOccurrences.length > 0 ? futureOccurrences.map(occ => (
                                        <motion.div key={occ.id} variants={itemVariants} className="bg-surface p-4 rounded-card shadow-sm border border-border flex items-center justify-between opacity-90 hover:opacity-100 transition-opacity">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-background flex flex-col items-center justify-center text-xs font-bold text-muted border border-border">
                                                    <span>{new Date(occ.dataPrevista).getDate()}</span>
                                                    <span className="text-[9px] uppercase">{new Date(occ.dataPrevista).toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}</span>
                                                </div>
                                                <div>
                                                    <p className="font-medium text-on-surface">{formatDate(occ.dataPrevista)}</p>
                                                    <p className="text-xs text-muted capitalize">{occ.status === 'pendente' ? (isPJ ? 'Pendente' : 'Aguardando') : occ.status}</p>
                                                </div>
                                            </div>
                                            <div className="text-right flex flex-col items-end">
                                                <p className="font-bold text-on-surface">{formatCurrency(occ.valorPrevisto)}</p>
                                                {occ.status === 'pendente' ? (
                                                    <div className="flex gap-2 mt-1">
                                                        <button 
                                                            onClick={() => handleGenerate(occ, false)}
                                                            className="text-[10px] bg-primary/10 text-primary hover:bg-primary/20 px-2 py-1 rounded transition-colors font-bold uppercase"
                                                            title="Provisionar em Contas a Pagar"
                                                        >
                                                            {isPJ ? 'Provisionar' : 'Gerar'}
                                                        </button>
                                                        <button 
                                                            onClick={() => handleGenerate(occ, true)}
                                                            className="text-[10px] bg-green-50 text-green-600 hover:bg-green-100 px-2 py-1 rounded transition-colors font-bold uppercase"
                                                            title="Marcar como Pago"
                                                        >
                                                            Pagar
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${occ.status === 'pago' ? 'bg-green-100 text-green-700' : 'bg-background text-muted'}`}>
                                                        {occ.status === 'gerado' && isPJ ? 'Pendente' : occ.status}
                                                    </span>
                                                )}
                                            </div>
                                        </motion.div>
                                    )) : (
                                        <p className="text-muted text-sm">Nenhuma cobrança prevista.</p>
                                    )}
                                </MotionDiv>
                            )}
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-on-surface mb-4 flex items-center gap-2">
                                <DynamicIcon name="History" className="w-5 h-5 text-muted" />
                                Histórico Recente
                            </h3>
                            <div className="space-y-3">
                                {pastOccurrences.length > 0 ? pastOccurrences.map(occ => (
                                    <div key={occ.id} className="flex items-center justify-between p-3 rounded-lg border-b border-border hover:bg-background transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-2 h-2 rounded-full ${occ.status === 'pago' ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                                            <p className="text-sm text-muted">{formatDate(occ.dataPrevista)}</p>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className={`text-xs font-bold uppercase ${occ.status === 'pago' ? 'text-green-600' : 'text-muted'}`}>
                                                {occ.status === 'gerado' && isPJ ? 'Pendente' : occ.status}
                                            </span>
                                            <span className={`text-sm font-medium ${occ.status === 'pago' ? 'text-on-surface' : 'text-muted line-through'}`}>
                                                {formatCurrency(occ.valorReal || occ.valorPrevisto)}
                                            </span>
                                        </div>
                                    </div>
                                )) : (
                                    <p className="text-muted text-sm italic">Nenhum histórico recente.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Column 2: Price History */}
                    <div>
                        <h3 className="text-lg font-bold text-on-surface mb-4 flex items-center gap-2">
                            <TrendingUpIcon className="w-5 h-5 text-green-500" />
                            Histórico de Reajustes
                        </h3>
                        <div className="bg-surface rounded-card shadow-sm border border-border overflow-hidden">
                            {expense.adjustments && expense.adjustments.length > 0 ? (
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-background text-muted">
                                        <tr>
                                            <th className="px-4 py-2">Data</th>
                                            <th className="px-4 py-2 text-right">Anterior</th>
                                            <th className="px-4 py-2 text-right">Novo</th>
                                            <th className="px-4 py-2">Motivo</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {expense.adjustments.map(adj => (
                                            <tr key={adj.id}>
                                                <td className="px-4 py-3 text-muted">
                                                    {new Date(adj.date).toLocaleDateString('pt-BR')}
                                                </td>
                                                <td className="px-4 py-3 text-right text-muted line-through">
                                                    {formatCurrency(adj.oldValue)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-bold text-on-surface">
                                                    {formatCurrency(adj.newValue)}
                                                </td>
                                                <td className="px-4 py-3 text-muted text-xs italic">
                                                    {adj.note || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="p-6 text-center text-muted">
                                    <p className="text-sm">Nenhum reajuste registrado.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RecurringExpenseDetailsView;
