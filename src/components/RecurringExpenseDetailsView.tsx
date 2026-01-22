import React, { useMemo, useState } from 'react';
import { useRecurringExpense, useRecurringOccurrences, useSaveOccurrence, useUpdateRecurringExpense } from '../modules/recurring-expenses/hooks.ts';
import { useSplitParticipants, useCreateSplitBill } from '../modules/split-bills/hooks.ts';
import { BackIcon, DynamicIcon, CalendarIcon, EditIcon, DeleteIcon, CheckIcon, WarningIcon, BoltIcon, TrendingUpIcon } from './Icons.tsx';
import { useTheme } from '../ThemeContext.tsx';
import { RecurringStatus, RecurringOccurrence, RecurringAdjustment, RecurringPaymentMethod } from '../modules/recurring-expenses/types.ts';
import { SplitBill, SplitShare, SplitBillPaymentMethod } from '../types.ts';
import { Transaction } from '../types.ts';

interface RecurringExpenseDetailsViewProps {
    expenseId: string;
    onBack: () => void;
    onAddTransaction: (transaction: Omit<Transaction, 'id'> & { id?: number }) => void;
}

const RecurringExpenseDetailsView: React.FC<RecurringExpenseDetailsViewProps> = ({ expenseId, onBack, onAddTransaction }) => {
    const { data: expense, isLoading: isExpenseLoading } = useRecurringExpense(expenseId);
    const saveOccurrenceMutation = useSaveOccurrence();
    const updateExpenseMutation = useUpdateRecurringExpense();
    
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
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600"></div>
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
                category: 'Assinaturas', 
                type: 'despesa', 
                paymentMethod: expense.metodoPagamento === 'cartaoCredito' ? 'Cartão de Crédito' : 'Outro',
                isPaid: markAsPaid,
            };

            if (isCreditCard && expense.cartaoIdOpcional) {
                newTransaction.cardId = parseInt(expense.cartaoIdOpcional);
                newTransaction.type = 'despesa'; 
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
                categoriaNome: 'Assinaturas',
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
        <div className="flex flex-col h-full animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between mb-6 flex-shrink-0">
                <button 
                    onClick={() => {
                        playSound('click');
                        onBack();
                    }}
                    className="flex items-center gap-2 text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white transition-colors"
                >
                    <BackIcon className="h-5 w-5" />
                    <span className="text-sm font-medium">Voltar</span>
                </button>
            </div>

            {/* Hero Card */}
            <div className="bg-white dark:bg-dark-100 rounded-2xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 mb-6 relative overflow-hidden">
                {isExpiringSoon() && (
                    <div className="absolute top-0 right-0 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 px-3 py-1 rounded-bl-xl text-xs font-bold flex items-center gap-1">
                        <WarningIcon className="w-4 h-4" />
                        Vence em breve: {new Date(expense.dataFim!).toLocaleDateString('pt-BR')}
                    </div>
                )}

                <div className="flex items-start gap-5">
                    <div 
                        className="w-16 h-16 rounded-2xl flex items-center justify-center text-white shadow-md text-3xl flex-shrink-0"
                        style={{ backgroundColor: expense.corPrincipal }}
                    >
                        {expense.emojiOpcional ? <span>{expense.emojiOpcional}</span> : <DynamicIcon name={expense.icone} size={32} />}
                    </div>
                    <div className="flex-1">
                        <div className="flex items-center justify-between">
                            <h1 className="text-2xl font-bold text-gray-800 dark:text-white mb-1">{expense.nome}</h1>
                            {getStatusBadge(expense.status)}
                        </div>
                        <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">{expense.descricao || 'Sem descrição'}</p>
                        <div className="flex flex-wrap gap-4 text-sm mt-3">
                            <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-dark-200 px-3 py-1.5 rounded-lg">
                                <span className="font-bold">{formatCurrency(expense.valorPadrao)}</span>
                                <span className="text-xs text-gray-400">/ {expense.periodo}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-dark-200 px-3 py-1.5 rounded-lg capitalize">
                                <CalendarIcon className="w-4 h-4 text-gray-400" />
                                <span>Dia {expense.diaCobranca}</span>
                            </div>
                            <button 
                                onClick={() => setIsAdjusting(!isAdjusting)}
                                className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-1.5 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                            >
                                <TrendingUpIcon className="w-4 h-4" />
                                Reajustar Valor
                            </button>
                        </div>
                    </div>
                </div>

                {/* Adjust Price Form */}
                {isAdjusting && (
                    <div className="mt-4 p-4 bg-gray-50 dark:bg-dark-200 rounded-lg border border-gray-200 dark:border-gray-700 animate-fade-in">
                        <h4 className="text-sm font-bold text-gray-700 dark:text-white mb-2">Novo Reajuste</h4>
                        <form onSubmit={handleAdjustPrice} className="flex gap-2 items-end">
                            <div>
                                <label className="block text-xs text-gray-500 mb-1">Novo Valor</label>
                                <input 
                                    type="number" 
                                    step="0.01" 
                                    value={newPrice} 
                                    onChange={e => setNewPrice(e.target.value)} 
                                    className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm w-24 bg-white dark:bg-dark-100 dark:text-white"
                                    placeholder="0.00"
                                    required
                                />
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs text-gray-500 mb-1">Motivo (Opcional)</label>
                                <input 
                                    type="text" 
                                    value={adjustmentNote} 
                                    onChange={e => setAdjustmentNote(e.target.value)} 
                                    className="border border-gray-300 dark:border-gray-600 rounded px-2 py-1.5 text-sm w-full bg-white dark:bg-dark-100 dark:text-white"
                                    placeholder="Ex: Reajuste anual da operadora"
                                />
                            </div>
                            <button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded text-sm font-medium">
                                Salvar
                            </button>
                            <button type="button" onClick={() => setIsAdjusting(false)} className="text-gray-500 hover:text-gray-700 px-3 py-1.5 text-sm">
                                Cancelar
                            </button>
                        </form>
                    </div>
                )}
            </div>

            {/* Timeline / Occurrences */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    
                    {/* Column 1: Projections & History */}
                    <div className="space-y-8">
                        <div>
                            <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
                                <CalendarIcon className="w-5 h-5 text-indigo-500" />
                                Próximos Vencimentos
                            </h3>
                            {isOccurrencesLoading ? (
                                <div className="text-center py-4 text-gray-400">Carregando projeção...</div>
                            ) : (
                                <div className="space-y-3">
                                    {futureOccurrences.length > 0 ? futureOccurrences.map(occ => (
                                        <div key={occ.id} className="bg-white dark:bg-dark-100 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex items-center justify-between opacity-90 hover:opacity-100 transition-opacity">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-lg bg-gray-50 dark:bg-dark-200 flex flex-col items-center justify-center text-xs font-bold text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700">
                                                    <span>{new Date(occ.dataPrevista).getDate()}</span>
                                                    <span className="text-[9px] uppercase">{new Date(occ.dataPrevista).toLocaleString('pt-BR', { month: 'short' }).replace('.', '')}</span>
                                                </div>
                                                <div>
                                                    <p className="font-medium text-gray-800 dark:text-white">{formatDate(occ.dataPrevista)}</p>
                                                    <p className="text-xs text-gray-500 capitalize">{occ.status === 'pendente' ? 'Aguardando' : occ.status}</p>
                                                </div>
                                            </div>
                                            <div className="text-right flex flex-col items-end">
                                                <p className="font-bold text-gray-800 dark:text-white">{formatCurrency(occ.valorPrevisto)}</p>
                                                {occ.status === 'pendente' ? (
                                                    <div className="flex gap-2 mt-1">
                                                        <button 
                                                            onClick={() => handleGenerate(occ, false)}
                                                            className="text-[10px] bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-2 py-1 rounded"
                                                            title="Gerar lançamento"
                                                        >
                                                            Gerar
                                                        </button>
                                                        <button 
                                                            onClick={() => handleGenerate(occ, true)}
                                                            className="text-[10px] bg-green-50 text-green-600 hover:bg-green-100 px-2 py-1 rounded"
                                                            title="Gerar e marcar como pago"
                                                        >
                                                            Pagar
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span className="text-[10px] text-gray-400 font-medium bg-gray-100 dark:bg-dark-200 px-2 py-0.5 rounded capitalize">
                                                        {occ.status}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    )) : (
                                        <p className="text-gray-500 text-sm">Nenhuma cobrança prevista.</p>
                                    )}
                                </div>
                            )}
                        </div>

                        <div>
                            <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
                                <DynamicIcon name="History" className="w-5 h-5 text-gray-500" />
                                Histórico Recente
                            </h3>
                            <div className="space-y-3">
                                {pastOccurrences.length > 0 ? pastOccurrences.map(occ => (
                                    <div key={occ.id} className="flex items-center justify-between p-3 rounded-lg border-b border-gray-100 dark:border-gray-800">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-2 h-2 rounded-full ${occ.status === 'pago' ? 'bg-green-500' : 'bg-gray-300'}`}></div>
                                            <p className="text-sm text-gray-600 dark:text-gray-300">{formatDate(occ.dataPrevista)}</p>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <span className={`text-xs font-bold uppercase ${occ.status === 'pago' ? 'text-green-600' : 'text-gray-400'}`}>
                                                {occ.status}
                                            </span>
                                            <span className={`text-sm font-medium ${occ.status === 'pago' ? 'text-gray-800 dark:text-white' : 'text-gray-500 line-through'}`}>
                                                {formatCurrency(occ.valorReal || occ.valorPrevisto)}
                                            </span>
                                        </div>
                                    </div>
                                )) : (
                                    <p className="text-gray-500 text-sm italic">Nenhum histórico recente.</p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Column 2: Price History */}
                    <div>
                        <h3 className="text-lg font-bold text-gray-800 dark:text-white mb-4 flex items-center gap-2">
                            <TrendingUpIcon className="w-5 h-5 text-green-500" />
                            Histórico de Reajustes
                        </h3>
                        <div className="bg-white dark:bg-dark-100 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
                            {expense.adjustments && expense.adjustments.length > 0 ? (
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-gray-50 dark:bg-dark-200 text-gray-500 dark:text-gray-400">
                                        <tr>
                                            <th className="px-4 py-2">Data</th>
                                            <th className="px-4 py-2 text-right">Anterior</th>
                                            <th className="px-4 py-2 text-right">Novo</th>
                                            <th className="px-4 py-2">Motivo</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                        {expense.adjustments.map(adj => (
                                            <tr key={adj.id}>
                                                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">
                                                    {new Date(adj.date).toLocaleDateString('pt-BR')}
                                                </td>
                                                <td className="px-4 py-3 text-right text-gray-500 line-through">
                                                    {formatCurrency(adj.oldValue)}
                                                </td>
                                                <td className="px-4 py-3 text-right font-bold text-gray-800 dark:text-white">
                                                    {formatCurrency(adj.newValue)}
                                                </td>
                                                <td className="px-4 py-3 text-gray-500 text-xs italic">
                                                    {adj.note || '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            ) : (
                                <div className="p-6 text-center text-gray-400">
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