
import React, { useState, useEffect } from 'react';
import { Client } from '../modules/clients/types.ts';
import { CloseIcon, UsersIcon } from './Icons.tsx';

interface ClientFormModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (client: Pick<Client, 'name' | 'email' | 'phone' | 'document' | 'notes'>) => void;
    clientToEdit?: Client | null;
}

const ClientFormModal: React.FC<ClientFormModalProps> = ({ isOpen, onClose, onSave, clientToEdit }) => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [document, setDocument] = useState('');
    const [notes, setNotes] = useState('');

    useEffect(() => {
        if (isOpen) {
            if (clientToEdit) {
                setName(clientToEdit.name);
                setEmail(clientToEdit.email || '');
                setPhone(clientToEdit.phone || '');
                setDocument(clientToEdit.document || '');
                setNotes(clientToEdit.notes || '');
            } else {
                setName('');
                setEmail('');
                setPhone('');
                setDocument('');
                setNotes('');
            }
        }
    }, [isOpen, clientToEdit]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({ name, email, phone, document, notes });
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-surface w-full max-w-md rounded-xl shadow-lg border border-border flex flex-col max-h-[90vh] animate-scale-in" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-5 border-b border-border">
                    <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
                        <UsersIcon className="w-5 h-5 text-primary" />
                        {clientToEdit ? 'Editar Cliente' : 'Novo Cliente'}
                    </h3>
                    <button onClick={onClose} className="text-muted hover:text-on-surface">
                        <CloseIcon />
                    </button>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-on-surface mb-1">Nome <span className="text-error">*</span></label>
                        <input 
                            type="text" 
                            value={name} 
                            onChange={e => setName(e.target.value)} 
                            className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none"
                            required
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-on-surface mb-1">E-mail</label>
                        <input 
                            type="email" 
                            value={email} 
                            onChange={e => setEmail(e.target.value)} 
                            className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-on-surface mb-1">Telefone</label>
                            <input 
                                type="text" 
                                value={phone} 
                                onChange={e => setPhone(e.target.value)} 
                                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface mb-1">CPF/CNPJ</label>
                            <input 
                                type="text" 
                                value={document} 
                                onChange={e => setDocument(e.target.value)} 
                                className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-on-surface mb-1">Observações</label>
                        <textarea 
                            value={notes} 
                            onChange={e => setNotes(e.target.value)} 
                            className="w-full bg-background border border-border rounded-lg px-4 py-2 text-on-surface focus:ring-2 focus:ring-primary outline-none"
                            rows={3}
                        />
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
                            className="px-6 py-2 bg-primary hover:bg-primary/90 text-white font-medium rounded-lg shadow-sm transition-colors"
                        >
                            Salvar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ClientFormModal;
