import React, { useEffect, useState } from 'react';

export const BillingSuccessModal = () => {
    const [isOpen, setIsOpen] = useState(false);

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

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-fade-in">
            <div className="bg-white dark:bg-dark-100 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-scale-in flex flex-col items-center text-center p-8 border border-gray-100 dark:border-gray-800">
                
                {/* Ícone de Sucesso Animado */}
                <div className="w-20 h-20 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-6">
                    <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                </div>

                <h3 className="text-2xl font-extrabold text-gray-900 dark:text-white mb-2">
                    Pagamento Aprovado!
                </h3>
                
                <p className="text-gray-500 dark:text-gray-400 mb-8">
                    A sua assinatura foi ativada com sucesso. Todos os recursos premium já estão liberados para você usar! 🎉
                </p>

                <button 
                    onClick={() => setIsOpen(false)}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition-colors shadow-lg shadow-indigo-200 dark:shadow-none"
                >
                    Começar a usar
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