
import React, { useState, useEffect } from 'react';
import { Receivable, Client } from '../modules/clients/types.ts';
import { CloseIcon, FileInvoiceIcon } from './Icons.tsx';

interface ReceivableFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (receivable: Pick<Receivable, 'description' | 'clientId' | 'value' | 'dueDate' | 'status'>) => void;
    clients: Client[];
    receivableToEdit?: Receivable | null;
}

const ReceivableFormModal: React.FC<ReceivableFormModalProps> = ({ isOpen, onClose, onSave, clients, receivableToEdit }) => {
    const [description, setDescription] = useState('');
    const [clientId, setClientId] = useState('');
    const [amount, setAmount] = useState('');
    const [dueDate, setDueDate] = useState(new Date().toISOString().split('T')[0]);
    const [status, setStatus] = useState<Receivable['status']>('pending');

    useEffect(() => {
        if (isOpen) {
            if (receivableToEdit) {
                setDescription(receivableToEdit.description);
                setClientId(receivableToEdit.clientId);
                setAmount(String(receivableToEdit.value));
                setDueDate(receivableToEdit.dueDate);
                setStatus(receivableToEdit.status);
            } else {
                setDescription('');
                setClientId(clients.length > 0 ? clients[0].id : '');
                setAmount('');
                setDueDate(new Date().toISOString().split('T')[0]);
                setStatus('pending');
            }
        }
    }, [isOpen, receivableToEdit, clients]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ 
            description, 
            clientId, 
            value: parseFloat(amount),
            dueDate, 
            status 
        });
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-surface w-full max-w-md rounded-xl shadow-lg border border-border flex flex-col max-h-[90vh] animate-scale-in" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-5 border-b border-border">
                    <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                        <FileInvoiceIcon className="w-5 h-5 text-primary" />
                        {receivableToEdit ? 'Editar Recebível' : 'Novo Recebível'}
                    </h3>
                    <button onClick={onClose} className="text-muted hover:text-on-surface">
                        <CloseIcon />
                    </button>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-on-surface mb-1">Descrição <span className="text-error">*</span></label>
                        <input 
                            type="text" 
                            value={description} 
                            onChange={e => setDescription(e.target.value)} 
                            className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none"
                            placeholder="Ex: Consultoria Junho"
                            required
                            autoFocus
                        />
                    </div>
                    
                    <div>
                        <label className="block text-sm font-medium text-on-surface mb-1">Cliente <span className="text-error">*</span></label>
                        <select 
                            value={clientId} 
                            onChange={e => setClientId(e.target.value)} 
                            className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none"
                            required
                        >
                            <option value="">Selecione um cliente</option>
                            {clients.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                        {clients.length === 0 && <p className="text-xs text-error mt-1">Cadastre um cliente primeiro.</p>}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-on-surface mb-1">Valor (R$) <span className="text-error">*</span></label>
                            <input 
                                type="number" 
                                step="0.01"
                                value={amount} 
                                onChange={e => setAmount(e.target.value)} 
                                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none font-bold"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface mb-1">Vencimento <span className="text-error">*</span></label>
                            <input 
                                type="date" 
                                value={dueDate} 
                                onChange={e => setDueDate(e.target.value)} 
                                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none"
                                required
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-on-surface mb-1">Status</label>
                        <select 
                            value={status} 
                            onChange={e => setStatus(e.target.value as any)} 
                            className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none"
                        >
                            <option value="pending">Pendente</option>
                            <option value="paid">Recebido</option>
                            <option value="overdue">Atrasado</option>
                            <option value="cancelled">Cancelado</option>
                        </select>
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <button 
                            type="button" 
                            onClick={onClose} 
                            className="px-4 py-2 text-sm font-medium text-muted hover:bg-background rounded-lg transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            type="submit" 
                            disabled={clients.length === 0}
                            className="px-6 py-2 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            Salvar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ReceivableFormModal;
