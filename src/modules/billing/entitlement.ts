import type { BillingAccount, DisplayEntitlement } from './types';

/**
 * Plano e status para EXIBIÇÃO. A autoridade sobre o entitlement é o backend:
 * o documento reflete a última avaliação do servidor, e esta função só evita
 * mostrar como vigente um prazo (carência ou fim do período pago) que já
 * passou enquanto o servidor ainda não reavaliou.
 */
export const displayEntitlement = (
  account: BillingAccount | null,
  nowMs: number,
): DisplayEntitlement => {
  if (!account) return { planId: 'free', status: 'free' };

  if (account.entitlementStatus === 'grace') {
    if (!account.graceUntil || account.graceUntil.getTime() <= nowMs) {
      return { planId: 'free', status: 'restricted' };
    }
  }

  if (account.entitlementStatus === 'active') {
    const accessEnd = account.cancelAt
      ?? (account.cancelAtPeriodEnd ? account.currentPeriodEnd : null);
    if (accessEnd && accessEnd.getTime() <= nowMs) {
      return { planId: 'free', status: 'free' };
    }
  }

  return { planId: account.planId, status: account.entitlementStatus };
};

const MANAGEABLE_STATUSES = new Set([
  'active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused',
]);

/** Há assinatura que o portal de cobrança consegue gerenciar. */
export const hasManageableSubscription = (account: BillingAccount | null): boolean =>
  !!account && account.hasCustomer && MANAGEABLE_STATUSES.has(account.subscriptionStatus);

export const isPaidEntitlementActive = (entitlement: DisplayEntitlement): boolean =>
  entitlement.planId !== 'free' && entitlement.status === 'active';
