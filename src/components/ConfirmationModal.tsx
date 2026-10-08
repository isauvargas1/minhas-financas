
import React from 'react';
import { CloseIcon, WarningIcon } from './Icons.tsx';
import { useTheme } from '../contexts/ThemeContext.tsx';

interface ConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: string;
    /** Rótulo do botão de confirmação (padrão: "Confirmar Exclusão"). */
    confirmLabel?: string;
    /**
     * Justificativa obrigatória (P3-E: anulação de lançamento, D-35). Sem
     * texto, a confirmação fica desabilitada.
     */
    reason?: {
        label: string;
        value: string;
        onChange: (value: string) => void;
        maxLength: number;
    };
    /** Operação em andamento: confirmação desabilitada. */
    isBusy?: boolean;
    /** Erro da última tentativa, em pt-BR. */
    error?: string | null;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmLabel = 'Confirmar Exclusão',
    reason,
    isBusy = false,
    error = null,
}) => {
    const { playSound } = useTheme();

    if (!isOpen) {
        return null;
    }

    const confirmDisabled = isBusy || (reason !== undefined && !reason.value.trim());

    const handleConfirm = () => {
        if (confirmDisabled) return;
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
                    {reason && (
                        <div className="mt-4 text-left">
                            <label htmlFor="confirmation-modal-reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                {reason.label} <span className="text-red-500">*</span>
                            </label>
                            <textarea
                                id="confirmation-modal-reason"
                                value={reason.value}
                                onChange={(event) => reason.onChange(event.target.value)}
                                maxLength={reason.maxLength}
                                rows={2}
                                required
                                aria-required="true"
                                // Campo obrigatório que habilita a confirmação:
                                // o foco começa nele (o modal não gerencia foco).
                                autoFocus
                                className="w-full border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-dark-200 text-gray-800 dark:text-gray-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
                            />
                        </div>
                    )}
                    {error && (
                        <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
                    )}
                </div>

                <div className="flex justify-end items-center gap-3 p-4 bg-gray-50 dark:bg-dark-200 rounded-b-xl">
                    <button onClick={onClose} className="py-2 px-4 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-medium transition-colors">
                        Cancelar
                    </button>
                    <button onClick={handleConfirm} disabled={confirmDisabled} aria-busy={isBusy} className="py-2 px-4 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium shadow-sm transition-colors">
                        {confirmLabel}
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