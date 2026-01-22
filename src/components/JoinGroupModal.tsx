
import React, { useState } from 'react';
import { useAcceptInvite } from '../modules/split-bills/hooks.ts';
import { CloseIcon, LoginIcon } from './Icons.tsx';
import { useTheme } from '../ThemeContext.tsx';

interface JoinGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: (groupId: string) => void;
}

const JoinGroupModal: React.FC<JoinGroupModalProps> = ({ isOpen, onClose, onSuccess }) => {
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const acceptInviteMutation = useAcceptInvite();
    const { playSound } = useTheme();

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        
        if (code.length < 6) {
            setError('O código deve ter pelo menos 6 caracteres.');
            return;
        }

        acceptInviteMutation.mutate(
            { code: code.toUpperCase(), userName: 'Você' },
            {
                onSuccess: (data) => {
                    if (data.success && data.groupId) {
                        playSound('success');
                        onSuccess(data.groupId);
                        onClose();
                        setCode('');
                    } else {
                        playSound('error');
                        setError(data.message || 'Erro ao entrar no grupo.');
                    }
                },
                onError: () => {
                    playSound('error');
                    setError('Erro de conexão. Tente novamente.');
                }
            }
        );
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="join-modal-title">
            <div className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-sm animate-scale-in" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-5 border-b border-gray-200 dark:border-gray-700">
                    <h3 id="join-modal-title" className="text-lg font-bold text-gray-800 dark:text-white">Entrar em um Grupo</h3>
                    <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Fechar">
                        <CloseIcon />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6">
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Código do Convite
                        </label>
                        <div className="relative">
                            <input 
                                type="text" 
                                value={code}
                                onChange={(e) => setCode(e.target.value.toUpperCase())}
                                placeholder="EX: A1B2C3"
                                className="w-full pl-10 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white text-gray-900 dark:bg-dark-200 dark:text-white text-lg font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                maxLength={8}
                                autoFocus
                            />
                            <div className="absolute left-3 top-3.5 text-gray-400">
                                <LoginIcon className="w-5 h-5" />
                            </div>
                        </div>
                        {error && (
                            <p className="mt-2 text-xs text-red-500 font-medium">{error}</p>
                        )}
                    </div>

                    <button 
                        type="submit"
                        disabled={acceptInviteMutation.isPending || !code}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-3 rounded-lg shadow-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center"
                    >
                        {acceptInviteMutation.isPending ? (
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            'Entrar Agora'
                        )}
                    </button>
                </form>
            </div>
             <style>{`
                @keyframes scale-in {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                .animate-scale-in {
                    animation: scale-in 0.2s ease-out forwards;
                }
            `}</style>
        </div>
    );
};

export default JoinGroupModal;
