
import React from 'react';
import { CloseIcon, WarningIcon } from './Icons.tsx';
import { useTheme } from '../ThemeContext.tsx';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ isOpen, onClose, onConfirm, title, message }) => {
    const { playSound } = useTheme();

    if (!isOpen) {
        return null;
    }

    const handleConfirm = () => {
        playSound('click');
        onConfirm();
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 transition-opacity" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="confirmation-modal-title">
            <div className="bg-white dark:bg-dark-100 rounded-xl shadow-lg w-full max-w-md transition-transform transform scale-95 animate-scale-in" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center p-5 border-b border-gray-200 dark:border-gray-700">
                    <h3 id="confirmation-modal-title" className="text-lg font-bold text-gray-800 dark:text-white">{title}</h3>
                    <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Fechar">
                       <CloseIcon />
                    </button>
                </div>
                
                <div className="p-6 text-center">
                    <div className="flex justify-center mb-4">
                        <WarningIcon className="h-12 w-12 text-red-500 dark:text-red-400" />
                    </div>
                    <p className="text-gray-600 dark:text-gray-300">{message}</p>
                </div>

                <div className="flex justify-end items-center gap-3 p-4 bg-gray-50 dark:bg-dark-200 rounded-b-xl">
                    <button onClick={onClose} className="py-2 px-4 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium transition-colors">
                        Cancelar
                    </button>
                    <button onClick={handleConfirm} className="py-2 px-4 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium shadow-sm transition-colors">
                        Confirmar Exclusão
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
            `}</style>
        </div>
    );
};

export default ConfirmationModal;