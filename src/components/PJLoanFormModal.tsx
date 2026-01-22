import React, { useState, useEffect } from 'react';
import { Loan, LoanType, LoanInterestType, LoanInterestBasis, PJCounterpartyType, PJLoanClassification } from '../modules/loans/types.ts';
// Fix: Added DynamicIcon to the imports
import { CloseIcon, HandshakeIcon, BuildingIcon, UsersIcon, BriefcaseIcon, CoinsIcon, DynamicIcon } from './Icons.tsx';
import { useWorkspace } from '../contexts/WorkspaceContext.tsx';
import { generatePJAmortizationPlan } from '../modules/loans/pj-logic.ts';

interface PJLoanFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (loan: Loan) => void;
    onAddTransaction: (t: any) => void;
}

const PJLoanFormModal: React.FC<PJLoanFormModalProps> = ({ isOpen, onClose, onSave, onAddTransaction }) => {
    const { activeWorkspace } = useWorkspace();
    
    // Form State
    const [type, setType] = useState<LoanType>('borrow');
    const [personName, setPersonName] = useState('');
    const [counterpartyType, setCounterpartyType] = useState<PJCounterpartyType>('banco');
    const [cnpjCpf, setCnpjCpf] = useState('');
    const [personContact, setPersonContact] = useState('');
    const [description, setDescription] = useState('');
    const [classification, setClassification] = useState<PJLoanClassification>('dividas_financeiras');
    const [costCenter, setCostCenter] = useState('');
    
    const [principalValue, setPrincipalValue] = useState('');
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
    const [expectedPayoffDate, setExpectedPayoffDate] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('Transferência');
    
    const [interestType, setInterestType] = useState<LoanInterestType>('percentage');
    const [interestBasis, setInterestBasis] = useState<LoanInterestBasis>('monthly');
    const [interestValue, setInterestValue] = useState('');
    
    const [hasInstallments, setHasInstallments] = useState(true);
    const [installmentsCount, setInstallmentsCount] = useState('24');

    useEffect(() => {
        if (isOpen) {
            const date = new Date();
            date.setFullYear(date.getFullYear() + 2);
            setExpectedPayoffDate(date.toISOString().split('T')[0]);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const principalVal = parseFloat(principalValue);
        const intVal = parseFloat(interestValue) || 0;
        const loanId = 'pj_loan_' + Date.now().toString();

        const loan: Loan = {
            id: loanId,
            profileId: activeWorkspace.id,
            type,
            personName,
            counterpartyType,
            cnpjCpf,
            personContact,
            description,
            classification,
            costCenter,
            principalValue: principalVal,
            currentBalance: principalVal, 
            totalPaidReceived: 0,
            totalInterestPaidReceived: 0,
            startDate,
            expectedPayoffDate,
            paymentMethod,
            status: 'active',
            interestType,
            interestBasis,
            interestValue: intVal,
            hasInstallments,
            installmentsCount: hasInstallments ? parseInt(installmentsCount) : 1,
            installments: hasInstallments ? generatePJAmortizationPlan(principalVal, parseInt(installmentsCount), startDate, interestBasis, intVal) : undefined,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Create initial cash flow transaction
        const tType = type === 'borrow' ? 'receita' : 'despesa';
        const category = type === 'borrow' ? 'Captação de Empréstimo' : 'Empréstimo Concedido';
        
        onAddTransaction({
            type: tType,
            description: `[CORP] ${type === 'borrow' ? 'Entrada:' : 'Saída:'} ${personName} - ${description}`,
            value: principalVal,
            date: startDate,
            category,
            loanId: loanId,
            isPaid: true,
            profileId: activeWorkspace.id,
            costCenter: costCenter,
            supplier: personName
        });

        onSave(loan);
        onClose();
    };

    const commonInputClass = "w-full border border-border rounded-lg px-4 py-2 bg-background text-on-surface outline-none focus:ring-2 focus:ring-primary text-sm transition-all";
    const labelClass = "block text-[10px] font-black text-muted uppercase tracking-widest mb-1.5";

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-border bg-background/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2.5 bg-primary/10 rounded-xl text-primary shadow-inner">
                            <HandshakeIcon className="w-6 h-6" />
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-on-surface tracking-tight">Registro de Operação Financeira</h3>
                            <p className="text-[10px] text-muted uppercase font-bold tracking-wider">Perfil Empresarial: {activeWorkspace.name}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-muted hover:text-on-surface transition-colors rounded-full hover:bg-background">
                        <CloseIcon />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                    {/* Header Controls */}
                    <div className="flex flex-col sm:flex-row gap-6">
                        <div className="flex-1">
                            <label className={labelClass}>Tipo de Operação <span className="text-error">*</span></label>
                            <div className="flex bg-background p-1 rounded-xl border border-border">
                                <button type="button" onClick={() => setType('borrow')} className={`flex-1 py-3 text-xs font-black uppercase rounded-lg transition-all ${type === 'borrow' ? 'bg-primary text-white shadow-md' : 'text-muted hover:text-on-surface'}`}>Empresa Tomou (Passivo)</button>
                                <button type="button" onClick={() => setType('lend')} className={`flex-1 py-3 text-xs font-black uppercase rounded-lg transition-all ${type === 'lend' ? 'bg-primary text-white shadow-md' : 'text-muted hover:text-on-surface'}`}>Empresa Concedeu (Ativo)</button>
                            </div>
                        </div>
                        <div className="flex-1">
                            <label className={labelClass}>Classificação Contábil</label>
                            <select value={classification} onChange={e => setClassification(e.target.value as any)} className={commonInputClass}>
                                <option value="dividas_financeiras">Dívidas Financeiras</option>
                                <option value="antecipacoes">Antecipações</option>
                                <option value="emprestimos_colaboradores">Empréstimos a Colaboradores</option>
                                <option value="capital_giro">Capital de Giro</option>
                                <option value="outro">Outros</option>
                            </select>
                        </div>
                    </div>

                    {/* Counterparty Block */}
                    <div className="bg-background/40 p-6 rounded-2xl border border-border space-y-5">
                        <div className="flex items-center gap-2 text-xs font-black text-primary uppercase tracking-widest border-b border-border pb-2 mb-1">
                             <BuildingIcon className="w-4 h-4" /> Dados da Contraparte
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            <div>
                                <label className={labelClass}>Nome / Razão Social <span className="text-error">*</span></label>
                                <div className="relative">
                                    <input type="text" value={personName} onChange={e => setPersonName(e.target.value)} className={`${commonInputClass} pl-10`} placeholder="Ex: Banco Itaú, João Silva..." required />
                                    <UsersIcon className="absolute left-3.5 top-2.5 w-4 h-4 text-muted" />
                                </div>
                            </div>
                            <div>
                                <label className={labelClass}>Tipo de Contraparte</label>
                                <select value={counterpartyType} onChange={e => setCounterpartyType(e.target.value as any)} className={commonInputClass}>
                                    <option value="banco">Instituição Financeira</option>
                                    <option value="socio">Sócio / Acionista</option>
                                    <option value="colaborador">Colaborador</option>
                                    <option value="fornecedor">Fornecedor</option>
                                    <option value="cliente">Cliente</option>
                                    <option value="terceiro">Terceiro</option>
                                </select>
                            </div>
                            <div>
                                <label className={labelClass}>CNPJ / CPF</label>
                                <input type="text" value={cnpjCpf} onChange={e => setCnpjCpf(e.target.value)} className={commonInputClass} placeholder="00.000.000/0000-00" />
                            </div>
                            <div>
                                <label className={labelClass}>Contato / Telefone</label>
                                <input type="text" value={personContact} onChange={e => setPersonContact(e.target.value)} className={commonInputClass} placeholder="E-mail ou celular" />
                            </div>
                        </div>
                    </div>

                    {/* Financial Values */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="md:col-span-2">
                            <label className={labelClass}>Finalidade da Operação <span className="text-error">*</span></label>
                            <input type="text" value={description} onChange={e => setDescription(e.target.value)} className={commonInputClass} placeholder="Ex: Investimento em maquinário, Adiantamento PLR..." required />
                        </div>
                        <div>
                            <label className={labelClass}>Centro de Custo</label>
                            <div className="relative">
                                <input type="text" value={costCenter} onChange={e => setCostCenter(e.target.value)} className={`${commonInputClass} pl-10`} placeholder="Ex: Operacional, RH..." />
                                <BriefcaseIcon className="absolute left-3.5 top-2.5 w-4 h-4 text-muted" />
                            </div>
                        </div>
                        <div>
                            <label className={labelClass}>Valor Principal <span className="text-error">*</span></label>
                            <div className="relative">
                                <span className="absolute left-3.5 top-2.5 text-muted font-bold text-xs">R$</span>
                                <input type="number" step="0.01" value={principalValue} onChange={e => setPrincipalValue(e.target.value)} className={`${commonInputClass} pl-10 font-black text-base`} required />
                            </div>
                        </div>
                        <div>
                            <label className={labelClass}>Data de Contratação</label>
                            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className={commonInputClass} required />
                        </div>
                        <div>
                            <label className={labelClass}>Data de Vencimento Final</label>
                            <input type="date" value={expectedPayoffDate} onChange={e => setExpectedPayoffDate(e.target.value)} className={commonInputClass} required />
                        </div>
                    </div>

                    {/* Interest & Amortization */}
                    <div className="bg-indigo-50/50 dark:bg-indigo-950/10 p-6 rounded-2xl border border-indigo-100 dark:border-indigo-900/30 space-y-6">
                        <div className="flex items-center gap-2 text-xs font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest border-b border-indigo-100 dark:border-indigo-900/30 pb-2">
                             <CoinsIcon className="w-4 h-4" /> Condições Financeiras
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                            <div>
                                <label className={labelClass}>Tipo de Juros</label>
                                <select value={interestType} onChange={e => setInterestType(e.target.value as any)} className={commonInputClass}>
                                    <option value="none">Isento / Sem Juros</option>
                                    <option value="percentage">Percentual (%)</option>
                                    <option value="fixed">Valor Fixo Total</option>
                                </select>
                            </div>
                            {interestType === 'percentage' && (
                                <>
                                    <div>
                                        <label className={labelClass}>Base de Cálculo</label>
                                        <select value={interestBasis} onChange={e => setInterestBasis(e.target.value as any)} className={commonInputClass}>
                                            <option value="monthly">Ao Mês (% a.m.)</option>
                                            <option value="annual">Ao Ano (% a.a.)</option>
                                        </select>
                                    </div>
                                    <div className="animate-fade-in">
                                        <label className={labelClass}>Taxa (%)</label>
                                        <input type="number" step="0.001" value={interestValue} onChange={e => setInterestValue(e.target.value)} className={commonInputClass} placeholder="0,000" />
                                    </div>
                                </>
                            )}
                            {interestType === 'fixed' && (
                                <div className="animate-fade-in">
                                    <label className={labelClass}>Valor Fixo Total (R$)</label>
                                    <input type="number" step="0.01" value={interestValue} onChange={e => setInterestValue(e.target.value)} className={commonInputClass} placeholder="0,00" />
                                </div>
                            )}
                        </div>

                        <div className="flex items-center gap-3 py-2 border-t border-indigo-100 dark:border-indigo-900/30">
                            <input id="chkPJInst" type="checkbox" checked={hasInstallments} onChange={e => setHasInstallments(e.target.checked)} className="w-5 h-5 text-primary border-border rounded focus:ring-primary" />
                            <label htmlFor="chkPJInst" className="text-sm font-black text-on-surface cursor-pointer select-none">Amortização em Parcelas Periódicas</label>
                        </div>

                        {hasInstallments && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 animate-fade-in">
                                <div>
                                    <label className={labelClass}>Quantidade de Parcelas</label>
                                    <input type="number" min="2" max="360" value={installmentsCount} onChange={e => setInstallmentsCount(e.target.value)} className={commonInputClass} />
                                </div>
                                <div className="bg-white/50 dark:bg-dark-100/50 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                                     <p className="text-[10px] text-muted leading-relaxed">
                                        <strong>Nota Corporativa:</strong> O cronograma será gerado com base no sistema de amortização francês (Price). O sistema criará as previsões mensais no seu fluxo de caixa.
                                     </p>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-blue-50/50 dark:bg-blue-950/10 p-4 rounded-xl border border-blue-100 dark:border-blue-900/30 flex items-start gap-3">
                         <div className="p-1.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 rounded flex-shrink-0">
                            <DynamicIcon name="InfoCircle" size={14} />
                         </div>
                         <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
                            <strong>Impacto no Caixa:</strong> Uma transação de {type === 'borrow' ? 'entrada' : 'saída'} de {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseFloat(principalValue) || 0)} será registrada na data de contratação para conciliação bancária inicial.
                         </p>
                    </div>
                </form>

                <div className="p-6 border-t border-border flex justify-end gap-3 bg-background/50">
                    <button type="button" onClick={onClose} className="px-6 py-2.5 bg-background border border-border text-on-surface rounded-xl hover:bg-surface transition-all font-bold text-sm">Cancelar</button>
                    <button type="submit" form="pjLoanForm" onClick={handleSubmit} className="px-10 py-2.5 bg-primary text-white rounded-xl font-black shadow-lg hover:bg-primary/90 transition-all active:scale-95 text-sm uppercase tracking-wider">Salvar Registro</button>
                </div>
            </div>
        </div>
    );
};

export default PJLoanFormModal;