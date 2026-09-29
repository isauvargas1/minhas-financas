import { newIdempotencyKey } from '../workspaces/callables.ts';
import type { BillingCatalog, PaidPlanId } from './types';

/**
 * Contrato cliente das callables de billing (P2A).
 *
 * Módulo puro: não importa o SDK. `api.ts` o liga ao `httpsCallable`; os
 * testes o ligam a um `invoke` falso. O cliente escolhe o plano (`planId`),
 * nunca o preço do provedor: o backend resolve o preço a partir do plano.
 */
export const BILLING_CALLABLES = [
  'getBillingCatalog',
  'createCheckoutSession',
  'createBillingPortalSession',
] as const;

export type BillingCallableName = (typeof BILLING_CALLABLES)[number];

export type Invoke = <TResult>(
  name: BillingCallableName,
  payload: Record<string, unknown>,
) => Promise<TResult>;

export interface CheckoutSessionInput {
  planId: PaidPlanId;
  returnUrl: string;
}

export interface BillingPortalSessionInput {
  returnUrl: string;
}

export const createBillingCallables = (invoke: Invoke) => ({
  getBillingCatalog: () => invoke<BillingCatalog>('getBillingCatalog', {}),

  /** Cada chamada é uma intenção nova do usuário: chave de idempotência própria. */
  createCheckoutSession: (input: CheckoutSessionInput) =>
    invoke<{ url: string }>('createCheckoutSession', {
      planId: input.planId,
      returnUrl: input.returnUrl,
      idempotencyKey: newIdempotencyKey(),
    }),

  createBillingPortalSession: (input: BillingPortalSessionInput) =>
    invoke<{ url: string }>('createBillingPortalSession', { returnUrl: input.returnUrl }),
} satisfies Record<BillingCallableName, (...args: never[]) => Promise<unknown>>);
