
import React, { useState, useEffect } from 'react';
import { Loan } from '../modules/loans/types.ts';
import { CloseIcon, CoinsIcon, CalendarIcon, FileInvoiceIcon } from './Icons.tsx';

interface LoanMovementModalProps {
    isOpen: boolean;
    onClose: () => void;
    loan: Loan;
    onSave: (amount: number, date: string, description: string, isFullSettlement: boolean) => void;
}

const LoanMovementModal: React.FC<LoanMovementModalProps> = ({ isOpen, onClose, loan, onSave }) => {
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
    const [description, setDescription] = useState('');
    const [isFullSettlement, setIsFullSettlement] = useState(false);

    useEffect(() => {
        if (isOpen) {
            // Suggest next installment or balance
            let suggestion = loan.currentBalance;
            if (loan.hasInstallments && loan.installments) {
                const next = loan.installments.find(i => i.status !== 'paid');
                if (next) suggestion = next.amount;
            }
            setAmount(String(suggestion));
            setDescription(loan.hasInstallments ? `Pagamento parcela` : `Pagamento parcial`);
        }
    }, [isOpen, loan]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(parseFloat(amount), date, description, isFullSettlement);
        onClose();
    };

    const commonInputClass = "w-full border border-border rounded-lg px-4 py-2 bg-background text-on-surface outline-none focus:ring-2 focus:ring-primary text-sm";
    const labelClass = "block text-[10px] font-bold text-muted uppercase tracking-wider mb-1";

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-surface rounded-xl shadow-lg w-full max-w-md animate-scale-in" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-5 border-b border-border">
                    <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                        <CoinsIcon className="w-5 h-5 text-primary" />
                        {loan.type === 'lend' ? 'Registrar Recebimento' : 'Registrar Pagamento'}
                    </h3>
                    <button onClick={onClose} className="text-muted hover:text-on-surface"><CloseIcon /></button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    <div>
                        <label className={labelClass}>Valor (R$) <span className="text-error">*</span></label>
                        <div className="relative">
                            <span className="absolute left-3.5 top-2 text-muted font-bold text-sm">R$</span>
                            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className={`${commonInputClass} pl-10 font-bold text-lg`} required />
                        </div>
                        <p className="text-[10px] text-muted mt-1">Saldo pendente: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(loan.currentBalance)}</p>
                    </div>

                    <div>
                        <label className={labelClass}>Data da Operação</label>
                        <input type="date" value={date} onChange={e => setDate(e.target.value)} className={commonInputClass} required />
                    </div>

                    <div>
                        <label className={labelClass}>Descrição</label>
                        <input type="text" value={description} onChange={e => setDescription(e.target.value)} className={commonInputClass} placeholder="Ex: Pagamento parcela 3/10" required />
                    </div>

                    <div className="flex items-center gap-3 pt-2">
                        <input id="chkFull" type="checkbox" checked={isFullSettlement} onChange={e => setIsFullSettlement(e.target.checked)} className="w-5 h-5 text-primary border-border rounded" />
                        <label htmlFor="chkFull" className="text-sm font-bold text-on-surface cursor-pointer">Marcar como Quitação Total</label>
                    </div>

                    <div className="bg-blue-50 dark:bg-blue-900/10 p-3 rounded-lg border border-blue-100 dark:border-blue-900/30">
                        <p className="text-[10px] text-blue-700 dark:text-blue-300">Esta operação gerará automaticamente uma transação de {loan.type === 'lend' ? 'receita' : 'despesa'} no valor informado para seu controle financeiro.</p>
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 bg-background border border-border text-on-surface rounded-lg font-medium">Cancelar</button>
                        <button type="submit" className="px-6 py-2 bg-primary text-white rounded-lg font-bold shadow-md hover:bg-primary/90 transition-all active:scale-95">Registrar</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default LoanMovementModal;
