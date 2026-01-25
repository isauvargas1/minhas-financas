import React, { useState, useEffect } from 'react';
import { Loan, LoanType, LoanInterestType } from '../modules/loans/types.ts';
import { CloseIcon, HandshakeIcon, UsersIcon, CalendarIcon, CoinsIcon } from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { generateInstallmentPlan } from '../modules/loans/logic.ts';

interface LoanFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (loan: Loan) => void;
    onAddTransaction: (t: any) => void;
}

const LoanFormModal: React.FC<LoanFormModalProps> = ({ isOpen, onClose, onSave, onAddTransaction }) => {
    const { activeWorkspace } = useWorkspace();
    
    // Form State
    const [type, setType] = useState<LoanType>('lend');
    const [personName, setPersonName] = useState('');
    const [personContact, setPersonContact] = useState('');
    const [description, setDescription] = useState('');
    const [principalValue, setPrincipalValue] = useState('');
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [expectedPayoffDate, setExpectedPayoffDate] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('PIX');
    
    const [interestType, setInterestType] = useState<LoanInterestType>('none');
    const [interestValue, setInterestValue] = useState('');
    
    const [hasInstallments, setHasInstallments] = useState(false);
    const [installmentsCount, setInstallmentsCount] = useState('12');

    useEffect(() => {
        if (isOpen) {
            const date = new Date();
            date.setFullYear(date.getFullYear() + 1);
            setExpectedPayoffDate(date.toISOString().split('T')[0]);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const principalVal = parseFloat(principalValue);
        const intVal = parseFloat(interestValue) || 0;
        const loanId = Date.now().toString();

        // Fix: Added missing totalInterestPaidReceived property to type Loan
        const loan: Loan = {
            id: loanId,
            profileId: activeWorkspace.id,
            type,
            personName,
            personContact,
            description,
            principalValue: principalVal,
            currentBalance: principalVal, // Initial balance is the principal
            totalPaidReceived: 0,
            totalInterestPaidReceived: 0,
            startDate,
            expectedPayoffDate,
            paymentMethod,
            status: 'active',
            interestType,
            interestValue: intVal,
            hasInstallments,
            installmentsCount: hasInstallments ? parseInt(installmentsCount) : 1,
            installments: hasInstallments ? generateInstallmentPlan(principalVal, parseInt(installmentsCount), startDate, interestType, intVal) : undefined,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Create initial transaction
        const transactionType = type === 'lend' ? 'despesa' : 'receita';
        const category = type === 'lend' ? 'Empréstimos concedidos' : 'Empréstimos recebidos';
        
        onAddTransaction({
            type: transactionType,
            description: `${type === 'lend' ? 'Empréstimo p/' : 'Empréstimo de'} ${personName}: ${description}`,
            value: principalVal,
            date: startDate,
            category,
            loanId: loanId,
            isPaid: true,
            profileId: activeWorkspace.id
        });

        onSave(loan);
        onClose();
    };

    const commonInputClass = "w-full border border-border rounded-lg px-4 py-2 bg-background text-on-surface outline-none focus:ring-2 focus:ring-primary text-sm";
    const labelClass = "block text-[10px] font-bold text-muted uppercase tracking-wider mb-1";

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-surface rounded-xl shadow-lg w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-border bg-background/50">
                    <div className="flex items-center gap-3">
                        <HandshakeIcon className="w-6 h-6 text-primary" />
                        <h3 className="text-xl font-bold text-on-surface">Novo Empréstimo</h3>
                    </div>
                    <button onClick={onClose} className="text-muted hover:text-on-surface"><CloseIcon /></button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    {/* Type Toggle */}
                    <div className="flex bg-background p-1 rounded-xl border border-border">
                        <button type="button" onClick={() => setType('lend')} className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${type === 'lend' ? 'bg-primary text-white shadow-md' : 'text-muted hover:text-on-surface'}`}>Eu Emprestei</button>
                        <button type="button" onClick={() => setType('borrow')} className={`flex-1 py-3 text-sm font-bold rounded-lg transition-all ${type === 'borrow' ? 'bg-primary text-white shadow-md' : 'text-muted hover:text-on-surface'}`}>Eu Peguei</button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="md:col-span-2">
                            <label className={labelClass}>Pessoa Envolvida <span className="text-error">*</span></label>
                            <div className="relative">
                                <input type="text" value={personName} onChange={e => setPersonName(e.target.value)} className={`${commonInputClass} pl-10`} placeholder="Nome completo" required />
                                <UsersIcon className="absolute left-3.5 top-2.5 w-4 h-4 text-muted" />
                            </div>
                        </div>
                        <div>
                            <label className={labelClass}>Contato (Opcional)</label>
                            <input type="text" value={personContact} onChange={e => setPersonContact(e.target.value)} className={commonInputClass} placeholder="Telefone ou e-mail" />
                        </div>
                        <div>
                            <label className={labelClass}>Descrição curta</label>
                            <input type="text" value={description} onChange={e => setDescription(e.target.value)} className={commonInputClass} placeholder="Ex: Reforma casa, Investimento..." />
                        </div>
                        <div>
                            <label className={labelClass}>Valor Principal <span className="text-error">*</span></label>
                            <div className="relative">
                                <span className="absolute left-3.5 top-2 text-muted font-bold text-sm">R$</span>
                                <input type="number" step="0.01" value={principalValue} onChange={e => setPrincipalValue(e.target.value)} className={`${commonInputClass} pl-10 font-bold text-lg`} required />
                            </div>
                        </div>
                        <div>
                            <label className={labelClass}>Data de Início</label>
                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={commonInputClass} required />
                        </div>
                        <div>
                            <label className={labelClass}>Quitação Prevista</label>
                            <input type="date" value={expectedPayoffDate} onChange={e => setExpectedPayoffDate(e.target.value)} className={commonInputClass} required />
                        </div>
                        <div>
                            <label className={labelClass}>Forma de Pagamento</label>
                            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className={commonInputClass}>
                                <option value="PIX">PIX</option>
                                <option value="Transferência">Transferência</option>
                                <option value="Boleto">Boleto</option>
                                <option value="Dinheiro">Dinheiro</option>
                                <option value="Cartão">Cartão</option>
                            </select>
                        </div>
                    </div>

                    <div className="bg-background p-5 rounded-2xl border border-border space-y-4">
                        <div className="flex items-center gap-2 mb-2">
                            <CoinsIcon className="w-4 h-4 text-primary" />
                            <h4 className="text-xs font-bold text-on-surface uppercase tracking-widest">Juros e Parcelamento</h4>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className={labelClass}>Tipo de Juros</label>
                                <select value={interestType} onChange={e => setInterestType(e.target.value as any)} className={commonInputClass}>
                                    <option value="none">Sem Juros</option>
                                    <option value="percentage">% ao Mês</option>
                                    <option value="fixed">Valor Fixo (Total)</option>
                                </select>
                            </div>
                            {interestType !== 'none' && (
                                <div className="animate-fade-in">
                                    <label className={labelClass}>{interestType === 'percentage' ? 'Percentual (%)' : 'Valor Total (R$)'}</label>
                                    <input type="number" step="0.01" value={interestValue} onChange={e => setInterestValue(e.target.value)} className={commonInputClass} placeholder="0.00" />
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-3 pt-2">
                            <input id="chkInst" type="checkbox" checked={hasInstallments} onChange={e => setHasInstallments(e.target.checked)} className="w-5 h-5 text-primary border-border rounded" />
                            <label htmlFor="chkInst" className="text-sm font-bold text-on-surface cursor-pointer">Dividir em Parcelas Mensais</label>
                        </div>

                        {hasInstallments && (
                            <div className="grid grid-cols-2 gap-4 animate-fade-in">
                                <div>
                                    <label className={labelClass}>Número de Parcelas</label>
                                    <input type="number" min="2" max="120" value={installmentsCount} onChange={e => setInstallmentsCount(e.target.value)} className={commonInputClass} />
                                </div>
                                <div className="flex items-end">
                                    <p className="text-[10px] text-muted italic">O plano de pagamento será gerado automaticamente com vencimento mensal a partir da data de início.</p>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <div className="bg-indigo-50 dark:bg-indigo-900/10 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                         <p className="text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
                            <strong>Nota de Fluxo:</strong> Ao salvar, uma transação de {type === 'lend' ? 'saída (despesa)' : 'entrada (receita)'} de {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(principalValue) || 0)} será criada automaticamente para refletir o {type === 'lend' ? 'dinheiro saindo da sua conta' : 'dinheiro entrando na sua conta'}.
                         </p>
                    </div>
                </form>

                <div className="p-6 border-t border-border flex justify-end gap-3 bg-background/50">
                    <button type="button" onClick={onClose} className="px-5 py-2 bg-background border border-border text-on-surface rounded-lg hover:bg-surface transition-colors font-medium">Cancelar</button>
                    <button type="submit" form="loanForm" onClick={handleSubmit} className="px-8 py-2 bg-primary text-white rounded-lg font-bold shadow-md hover:bg-primary/90 transition-all active:scale-95">Salvar Empréstimo</button>
                </div>
            </div>
        </div>
    );
};

export default LoanFormModal;