import React from 'react';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { formatCentsBRL } from '../../../lib/money';
import { useBilling } from '../BillingContext';
import { hasManageableSubscription } from '../entitlement';
import { useBillingActions } from '../hooks';
import type { PlanLimits } from '../types';

const formatCount = (value: number) => value.toLocaleString('pt-BR');

/** Textos dos limites do plano, na ordem de exibição. */
const limitLabels = (limits: PlanLimits): Array<[keyof PlanLimits, string]> => [
  ['workspaces', limits.workspaces === 1 ? '1 espaço' : `${formatCount(limits.workspaces)} espaços`],
  [
    'membersPerWorkspace',
    limits.membersPerWorkspace === 1
      ? '1 membro por espaço'
      : `${formatCount(limits.membersPerWorkspace)} membros por espaço`,
  ],
  ['transactionsPerMonth', `${formatCount(limits.transactionsPerMonth)} lançamentos por mês`],
  [
    'splitGroups',
    limits.splitGroups === 1
      ? '1 grupo de divisão'
      : `${formatCount(limits.splitGroups)} grupos de divisão`,
  ],
  ['aiCreditsPerMonth', `${formatCount(limits.aiCreditsPerMonth)} créditos de IA por mês`],
];

export const PricingTable = () => {
  // Planos e preços vêm do catálogo do servidor; o estado da assinatura, do documento canônico
  const { catalog, catalogStatus, account, accountEntitlement } = useBilling();
  const { startCheckout, openPortal, isLoading, error } = useBillingActions();
  const canManage = hasManageableSubscription(account);

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

        {catalogStatus === 'error' && (
          <div className="mt-8 bg-red-50 dark:bg-red-900/30 p-4 rounded-lg flex items-center justify-center text-red-600 dark:text-red-400 max-w-2xl mx-auto">
            <AlertCircle className="w-5 h-5 mr-2" />
            Não foi possível carregar os planos. Tente novamente mais tarde.
          </div>
        )}

        {catalogStatus === 'loading' && (
          <div className="mt-12 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          </div>
        )}

        {catalog && (
        <div className="mt-12 space-y-4 sm:mt-16 sm:space-y-0 sm:grid sm:grid-cols-3 sm:gap-6 lg:max-w-4xl lg:mx-auto xl:max-w-none xl:mx-0">
          {catalog.plans.map((plan) => (
            <div key={plan.planId} className="border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-800 flex flex-col">
              <div className="p-6">
                <h3 className="text-lg font-medium leading-6 text-gray-900 dark:text-white">{plan.name}</h3>
                <p className="mt-8">
                  <span className="text-4xl font-extrabold text-gray-900 dark:text-white">
                    {plan.amountCents === 0 ? 'R$ 0' : formatCentsBRL(plan.amountCents)}
                  </span>
                  <span className="text-base font-medium text-gray-500">/mês</span>
                </p>
                
                <button
                  onClick={() => {
                    if (plan.planId === 'free') return;
                    if (canManage) void openPortal();
                    else void startCheckout(plan.planId);
                  }}
                  disabled={isLoading || plan.planId === 'free'} // Desativa o botão se for grátis ou se estiver a carregar
                  className={`mt-8 flex w-full items-center justify-center border border-transparent rounded-md py-2 text-sm font-semibold text-white transition-colors
                    ${plan.planId === 'free' 
                      ? 'bg-gray-400 cursor-not-allowed' 
                      : 'bg-indigo-600 hover:bg-indigo-700'
                    }
                  `}
                >
                  {isLoading && plan.planId !== 'free' ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : plan.planId === 'free' ? (
                    accountEntitlement.planId === 'free' ? 'Plano Atual' : 'Plano Gratuito'
                  ) : canManage ? (
                    'Gerenciar assinatura'
                  ) : (
                    'Fazer Upgrade'
                  )}
                </button>
              </div>
              <div className="pt-6 pb-8 px-6 flex-1">
                <h4 className="text-sm font-medium text-gray-900 dark:text-white tracking-wide uppercase">O que inclui:</h4>
                <ul className="mt-6 space-y-4">
                  {limitLabels(plan.limits).map(([key, label]) => (
                    <li key={key} className="flex space-x-3">
                      <Check className="flex-shrink-0 h-5 w-5 text-green-500" />
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {label}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
};