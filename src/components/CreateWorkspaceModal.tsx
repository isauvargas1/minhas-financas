
import React, { useState } from 'react';
import { CloseIcon, BriefcaseIcon } from './Icons.tsx';
import { useCreateWorkspace } from '../modules/workspaces/hooks.ts';
import { useWorkspace } from '../WorkspaceContext.tsx';
import { useTheme } from '../ThemeContext.tsx';

interface CreateWorkspaceModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const CreateWorkspaceModal: React.FC<CreateWorkspaceModalProps> = ({ isOpen, onClose }) => {
    const [name, setName] = useState('');
    const [cnpj, setCnpj] = useState('');
    
    const { mutate: createWorkspace, isPending } = useCreateWorkspace();
    const { reloadWorkspaces, switchWorkspace } = useWorkspace();
    const { playSound } = useTheme();

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!name.trim()) return;

        createWorkspace({ 
            type: 'PJ', 
            name, 
            cnpj: cnpj || undefined 
        }, {
            onSuccess: async (newWorkspace) => {
                playSound('success');
                await reloadWorkspaces();
                switchWorkspace(newWorkspace.id);
                onClose();
                setName('');
                setCnpj('');
            },
            onError: () => {
                playSound('error');
            }
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-md overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-5 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                        <BriefcaseIcon className="w-5 h-5 text-indigo-600" />
                        Nova Empresa
                    </h3>
                    <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                        <CloseIcon />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Nome da Empresa <span className="text-red-500">*</span>
                        </label>
                        <input 
                            type="text" 
                            value={name} 
                            onChange={(e) => setName(e.target.value)} 
                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 bg-white dark:bg-dark-200 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder="Ex: Minha Consultoria LTDA"
                            required
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            CNPJ (Opcional)
                        </label>
                        <input 
                            type="text" 
                            value={cnpj} 
                            onChange={(e) => setCnpj(e.target.value)} 
                            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-2 bg-white dark:bg-dark-200 text-gray-900 dark:text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                            placeholder="00.000.000/0001-00"
                        />
                    </div>

                    <div className="pt-4 flex justify-end gap-3">
                        <button 
                            type="button" 
                            onClick={onClose} 
                            className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button 
                            type="submit" 
                            disabled={isPending || !name}
                            className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                            {isPending ? 'Criando...' : 'Criar Empresa'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateWorkspaceModal;
