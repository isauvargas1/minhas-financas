import React, { useEffect, useState } from 'react';
import { Clock, Loader2 } from 'lucide-react';

import { useBilling } from '../BillingContext';
import { isPaidEntitlementActive } from '../entitlement';

/** Tempo de espera pela confirmação do servidor antes de avisar que segue em processamento. */
const CONFIRMATION_TIMEOUT_MS = 90_000;

export const BillingSuccessModal = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [timedOut, setTimedOut] = useState(false);
    const { accountEntitlement, accountPlan } = useBilling();
    // O retorno `?billing=success` não prova pagamento: só o servidor confirma.
    const confirmed = isPaidEntitlementActive(accountEntitlement);

    useEffect(() => {
        // Verifica se a URL tem ?billing=success
        const params = new URLSearchParams(window.location.search);
        if (params.get('billing') === 'success') {
            setIsOpen(true);
            
            // Limpa a URL para não mostrar o pop-up de novo se a página for atualizada
            const newUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.replaceState({ path: newUrl }, '', newUrl);
        }
    }, []);

    useEffect(() => {
        if (!isOpen || confirmed) return undefined;
        const timer = setTimeout(() => setTimedOut(true), CONFIRMATION_TIMEOUT_MS);
        return () => clearTimeout(timer);
    }, [isOpen, confirmed]);

    if (!isOpen) return null;

    const state = confirmed ? 'confirmed' : timedOut ? 'processing' : 'confirming';
    const copy = {
        confirming: {
            title: 'Confirmando seu pagamento',
            text: 'Estamos aguardando a confirmação do pagamento. Isso costuma levar poucos segundos.',
            button: 'Fechar',
        },
        confirmed: {
            title: 'Pagamento confirmado!',
            text: `Sua assinatura do plano ${accountPlan?.name ?? ''} está ativa. Todos os recursos do plano já estão liberados para você usar! 🎉`,
            button: 'Começar a usar',
        },
        processing: {
            title: 'Pagamento em processamento',
            text: 'Ainda não recebemos a confirmação do pagamento. Assim que ela chegar, seu plano será atualizado automaticamente.',
            button: 'Entendi',
        },
    }[state];

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-fade-in">
            <div className="bg-white dark:bg-dark-100 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in flex flex-col items-center text-center p-8 border border-gray-100 dark:border-gray-800">
                
                {/* Ícone de estado animado */}
                <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6">
                    {state === 'confirming' && <Loader2 className="w-10 h-10 text-green-500 animate-spin" />}
                    {state === 'processing' && <Clock className="w-10 h-10 text-green-500" />}
                    {state === 'confirmed' && (
                        <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                    )}
                </div>

                <h3 className="text-2xl font-extrabold text-gray-900 dark:text-white mb-2">
                    {copy.title}
                </h3>
                
                <p className="text-gray-500 dark:text-gray-400 mb-8">
                    {copy.text}
                </p>

                <button 
                    onClick={() => setIsOpen(false)}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-lg shadow-indigo-200 dark:shadow-none"
                >
                    {copy.button}
                </button>
            </div>

            <style>{`
                @keyframes scale-in {
                    from { transform: scale(0.9); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
                .animate-scale-in {
                    animation: scale-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
                @keyframes fade-in {
                    from { opacity: 0; backdrop-filter: blur(0px); }
                    to { opacity: 1; backdrop-filter: blur(4px); }
                }
                .animate-fade-in {
                    animation: fade-in 0.3s ease-out forwards;
                }
            `}</style>
        </div>
    );
};