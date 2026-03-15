import React from 'react';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { PLANS } from '../../../constants/plans';
import { useCheckout } from '../hooks'; // Importa a ponte que acabámos de criar

export const PricingTable = () => {
  // Puxa a função de iniciar checkout, o estado de carregamento e possíveis erros
  const { startCheckout, isLoading, error } = useCheckout();

  const handleSubscribe = async (priceId: string) => {
    if (!priceId) return;
    await startCheckout(priceId);
  };

  return (
    <div className="py-12 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold text-gray-900 dark:text-white">
            Planos e Assinaturas
          </h2>
          <p className="mt-4 text-xl text-gray-600 dark:text-gray-400">
            Escolha o plano ideal para a sua gestão financeira.
          </p>
        </div>

        {/* Mostra um alerta vermelho se ocorrer um erro ao gerar o link do Stripe */}
        {error && (
          <div className="mt-8 bg-red-50 dark:bg-red-900/30 p-4 rounded-lg flex items-center justify-center text-red-600 dark:text-red-400 max-w-2xl mx-auto">
            <AlertCircle className="w-5 h-5 mr-2" />
            {error}
          </div>
        )}

        <div className="mt-12 space-y-4 sm:mt-16 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-6 lg:max-w-4xl lg:mx-auto xl:max-w-none xl:mx-0">
          {Object.values(PLANS).map((plan) => (
            <div key={plan.id} className="border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800 flex flex-col">
              <div className="p-6">
                <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white">{plan.name}</h3>
                <p className="mt-8">
                  <span className="text-4xl font-extrabold text-gray-900 dark:text-white">
                    {plan.id === 'free' ? 'R$ 0' : 'R$ 29,90'}
                  </span>
                  <span className="text-base font-medium text-gray-500">/mês</span>
                </p>
                
                <button
                  onClick={() => handleSubscribe((plan as any).priceId || '')}
                  disabled={isLoading || plan.id === 'free'} // Desativa o botão se for grátis ou se estiver a carregar
                  className={`mt-8 flex w-full items-center justify-center border border-transparent rounded-md py-2 text-sm font-semibold text-white transition-colors
                    ${plan.id === 'free' 
                      ? 'bg-gray-400 cursor-not-allowed' 
                      : 'bg-indigo-600 hover:bg-indigo-700'
                    }
                  `}
                >
                  {isLoading && plan.id !== 'free' ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : plan.id === 'free' ? (
                    'Plano Atual'
                  ) : (
                    'Fazer Upgrade'
                  )}
                </button>
              </div>
              <div className="pt-6 pb-8 px-6 flex-1">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white tracking-wide uppercase">O que inclui:</h4>
                <ul className="mt-6 space-y-4">
                  {Object.entries(plan.limits).map(([key, value]) => (
                    <li key={key} className="flex space-x-3">
                      <Check className="flex-shrink-0 h-5 w-5 text-green-500" />
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {value === 999 ? 'Ilimitado' : value} {key}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};