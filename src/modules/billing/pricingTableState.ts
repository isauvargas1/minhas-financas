import type { DisplayEntitlement, PlanId } from './types';

/*
 * Estado de cada card da tabela de planos (V-04, UX-H1), separado do JSX para
 * ser testado sem renderizar.
 *
 * - O spinner aparece só no botão que disparou a ação (`pendingPlanId`); os
 *   demais botões pagos ficam desabilitados durante a requisição, para não
 *   abrir duas operações de cobrança ao mesmo tempo.
 * - Enquanto o documento canônico da conta carrega, nenhum botão sabe se há
 *   assinatura: todos os pagos mostram o carregamento e ficam desabilitados.
 * - O plano em vigor vem do entitlement exibido (documento canônico
 *   `billing_accounts/{uid}` avaliado por `displayEntitlement`); nada é
 *   inferido no cliente. Só é destacado com o estado da conta confiável.
 */
export type AccountStatus = 'loading' | 'ready' | 'error';

export interface PlanCardInput {
  planId: PlanId;
  accountStatus: AccountStatus;
  accountEntitlement: DisplayEntitlement;
  canManage: boolean;
  isLoading: boolean;
  pendingPlanId: PlanId | null;
}

export type PlanCardLabel =
  | 'Plano Atual'
  | 'Plano Gratuito'
  | 'Gerenciar assinatura'
  | 'Fazer Upgrade';

export interface PlanCardState {
  disabled: boolean;
  showSpinner: boolean;
  label: PlanCardLabel;
  /** Plano pago em vigor da conta: recebe o destaque "Plano atual". */
  isCurrentPaidPlan: boolean;
}

export const planCardState = ({
  planId,
  accountStatus,
  accountEntitlement,
  canManage,
  isLoading,
  pendingPlanId,
}: PlanCardInput): PlanCardState => {
  const accountReady = accountStatus === 'ready';
  const isFree = planId === 'free';
  const label: PlanCardLabel = isFree
    ? (accountReady && accountEntitlement.planId === 'free' ? 'Plano Atual' : 'Plano Gratuito')
    : canManage ? 'Gerenciar assinatura' : 'Fazer Upgrade';
  return {
    disabled: isLoading || isFree || !accountReady,
    showSpinner: !isFree
      && (accountStatus === 'loading' || (isLoading && pendingPlanId === planId)),
    label,
    isCurrentPaidPlan: accountReady && !isFree && accountEntitlement.planId === planId,
  };
};
