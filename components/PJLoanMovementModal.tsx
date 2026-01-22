
import React, { useState, useEffect } from 'react';
import { Loan } from '../modules/loans/types.ts';
import { CloseIcon, CoinsIcon, CalendarIcon } from './Icons.tsx';

interface PJLoanMovementModalProps {
    isOpen: boolean;
    onClose: () => void;
    loan: Loan;
    onSave: (pAmount: number, iAmount: number, date: string, description: string, isFullSettlement: boolean) => void;
}

const PJLoanMovementModal: React.FC<PJLoanMovementModalProps> = ({ isOpen, onClose, loan, onSave }) => {
    const [pAmount, setPAmount] = useState('');
    const [iAmount, setIAmount] = useState('0');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [description, setDescription] = useState('');
    const [isFullSettlement, setIsFullSettlement] = useState(false);

    useEffect(() => {
        if (isOpen) {
            // Suggest based on next installment if possible
            if (loan.hasInstallments && loan.installments) {
                const next = loan.installments.find(i => i.status !== 'paid');
                if (next) {
                    setPAmount(String(next.principalPart || next.amount));
                    setIAmount(String(next.interestPart || 0));
                    setDescription(`Amortização Parcela ${next.number}`);
                }
            } else {
                setPAmount(String(loan.currentBalance));
                setIAmount('0');
                setDescription('Liquidação parcial/total');
            }
        }
    }, [isOpen, loan]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(parseFloat(pAmount) || 0, parseFloat(iAmount) || 0, date, description, isFullSettlement);
        onClose();
    };

    const commonInputClass = "w-full border border-border rounded-lg px-4 py-2 bg-background text-on-surface outline-none focus:ring-2 focus:ring-primary text-sm transition-all";
    const labelClass = "block text-[10px] font-black text-muted uppercase tracking-widest mb-1.5";

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg animate-scale-in" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-6 border-b border-border bg-background/50 rounded-t-2xl">
                    <div className="flex items-center gap-3">
                         <div className="p-2 bg-primary/10 rounded-lg text-primary shadow-inner">
                            <CoinsIcon className="w-5 h-5" />
                        </div>
                        <h3 className="text-lg font-black text-on-surface tracking-tight uppercase tracking-wider">
                            {loan.type === 'borrow' ? 'Registrar Pagamento (Passivo)' : 'Registrar Recebimento (Ativo)'}
                        </h3>
                    </div>
                    <button onClick={onClose} className="p-2 text-muted hover:text-on-surface transition-colors rounded-full hover:bg-background"><CloseIcon /></button>
                </div>

                <form onSubmit={handleSubmit} className="p-8 space-y-6">
                    <div className="grid grid-cols-2 gap-5">
                        <div>
                            <label className={labelClass}>Principal (Amortização)</label>
                            <div className="relative">
                                <span className="absolute left-3 top-2.5 text-muted font-bold text-xs">R$</span>
                                <input type="number" step="0.01" value={pAmount} onChange={e => setPAmount(e.target.value)} className={`${commonInputClass} pl-10 font-bold`} required />
                            </div>
                        </div>
                        <div>
                            <label className={labelClass}>Juros / Taxas</label>
                            <div className="relative">
                                <span className="absolute left-3 top-2.5 text-muted font-bold text-xs">R$</span>
                                <input type="number" step="0.01" value={iAmount} onChange={e => setIAmount(e.target.value)} className={`${commonInputClass} pl-10 font-bold text-blue-600`} required />
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-between items-center bg-gray-50 dark:bg-dark-100 p-4 rounded-xl border border-border">
                        <span className="text-xs font-black text-muted uppercase">Total do Lançamento:</span>
                        <span className="text-xl font-black text-on-surface">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((parseFloat(pAmount) || 0) + (parseFloat(iAmount) || 0))}
                        </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div>
                            <label className={labelClass}>Data da Operação</label>
                            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={commonInputClass} required />
                        </div>
                        <div>
                            <label className={labelClass}>Descrição</label>
                            <input type="text" value={description} onChange={e => setDescription(e.target.value)} className={commonInputClass} placeholder="Ex: Parcela 05/24" required />
                        </div>
                    </div>

                    <div className="flex items-center gap-3 p-4 bg-indigo-50/30 dark:bg-indigo-950/10 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
                        <input id="chkPJFull" type="checkbox" checked={isFullSettlement} onChange={e => setIsFullSettlement(e.target.checked)} className="w-5 h-5 text-primary border-border rounded focus:ring-primary cursor-pointer" />
                        <label htmlFor="chkPJFull" className="text-sm font-black text-on-surface cursor-pointer select-none">Esta operação liquida totalmente o contrato</label>
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-6 py-2.5 bg-background border border-border text-on-surface rounded-xl font-bold text-sm shadow-sm transition-all">Cancelar</button>
                        <button type="submit" className="px-10 py-2.5 bg-primary text-white rounded-xl font-black shadow-lg hover:bg-primary/90 transition-all active:scale-95 text-sm uppercase tracking-wider">Confirmar Registro</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PJLoanMovementModal;
