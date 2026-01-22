
import React, { useState, useEffect } from 'react';
import { CloseIcon, SearchIcon, CheckIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';
import { useCreateConversation, useSearchUsers } from '../modules/messages/hooks.ts';
import { ChatUser } from '../modules/messages/types.ts';

interface NewConversationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConversationCreated?: (conversationId: string) => void;
}

const NewConversationModal: React.FC<NewConversationModalProps> = ({ isOpen, onClose, onConversationCreated }) => {
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [selectedUsers, setSelectedUsers] = useState<ChatUser[]>([]);
    const [groupName, setGroupName] = useState('');

    const { data: searchResults, isLoading } = useSearchUsers(debouncedSearch);
    const createConversationMutation = useCreateConversation();
    const { playSound } = useTheme();

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 300);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        if (isOpen) {
            setSearch('');
            setDebouncedSearch('');
            setSelectedUsers([]);
            setGroupName('');
        }
    }, [isOpen]);

    const handleUserSelect = (user: ChatUser) => {
        if (selectedUsers.some(u => u.id === user.id)) {
            setSelectedUsers(selectedUsers.filter(u => u.id !== user.id));
        } else {
            setSelectedUsers([...selectedUsers, user]);
        }
    };

    const handleCreate = () => {
        if (selectedUsers.length === 0) return;

        createConversationMutation.mutate(
            { 
                participantIds: selectedUsers.map(u => u.id),
                name: selectedUsers.length > 1 ? groupName : undefined
            },
            {
                onSuccess: (newThread) => {
                    playSound('success');
                    if (onConversationCreated) {
                        onConversationCreated(newThread.id);
                    }
                    onClose();
                }
            }
        );
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4" onClick={onClose}>
            <div className="bg-white dark:bg-dark-100 w-full max-w-md rounded-xl shadow-lg flex flex-col max-h-[80vh] animate-scale-in" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="font-bold text-gray-800 dark:text-white">Nova Conversa</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
                        <CloseIcon />
                    </button>
                </div>

                <div className="p-4 space-y-4 flex-1 overflow-hidden flex flex-col">
                    {selectedUsers.length > 1 && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome do Grupo</label>
                            <input 
                                type="text" 
                                value={groupName}
                                onChange={e => setGroupName(e.target.value)}
                                placeholder="Ex: Time de Projetos"
                                className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 bg-white dark:bg-dark-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-white"
                            />
                        </div>
                    )}

                    <div className="relative">
                        <input 
                            type="text" 
                            value={search} 
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Buscar pessoas..."
                            className="w-full pl-9 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-dark-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500 text-gray-900 dark:text-white"
                            autoFocus
                        />
                        <SearchIcon className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
                        {isLoading ? (
                            <div className="text-center py-4 text-gray-500 text-sm">Carregando...</div>
                        ) : searchResults?.length === 0 ? (
                            <div className="text-center py-4 text-gray-500 text-sm">Nenhum usuário encontrado.</div>
                        ) : (
                            searchResults?.map((user: any) => {
                                const isSelected = selectedUsers.some(u => u.id === user.id);
                                return (
                                    <div 
                                        key={user.id}
                                        onClick={() => handleUserSelect(user)}
                                        className={`flex items-center p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-gray-50 dark:hover:bg-dark-200'}`}
                                    >
                                        <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-dark-300 flex items-center justify-center text-lg mr-3 text-gray-600 dark:text-gray-300">
                                            {user.avatar || user.name.charAt(0)}
                                        </div>
                                        <div className="flex-1">
                                            <p className="font-medium text-gray-800 dark:text-white text-sm">{user.name}</p>
                                            {user.role && <p className="text-xs text-gray-500">{user.role}</p>}
                                        </div>
                                        {isSelected && (
                                            <div className="text-indigo-600 dark:text-indigo-400">
                                                <CheckIcon className="w-5 h-5" />
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
                    <button 
                        onClick={handleCreate}
                        disabled={selectedUsers.length === 0 || (selectedUsers.length > 1 && !groupName)}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        {selectedUsers.length > 1 ? 'Criar Grupo' : 'Iniciar Chat'}
                    </button>
                </div>
            </div>
             <style>{`
                @keyframes scale-in {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                .animate-scale-in {
                    animation: scale-in 0.2s ease-out forwards;
                }
                 .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: rgba(156, 163, 175, 0.5);
                    border-radius: 20px;
                }
                .dark .custom-scrollbar::-webkit-scrollbar-thumb {
                    background-color: rgba(75, 85, 99, 0.5);
                }
            `}</style>
        </div>
    );
};

export default NewConversationModal;
