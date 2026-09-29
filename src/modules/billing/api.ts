import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../lib/firebase';
import { createBillingCallables, type Invoke } from './callables';
import type {
  BillingAccount,
  EntitlementStatus,
  PlanId,
  SubscriptionStatus,
} from './types';

const invoke: Invoke = async <TResult>(name: string, payload: Record<string, unknown>) =>
  (await httpsCallable<Record<string, unknown>, TResult>(functions, name)(payload)).data;

/** Callables de billing (contrato em `callables.ts`), ligadas ao SDK. */
export const {
  getBillingCatalog,
  createCheckoutSession,
  createBillingPortalSession,
} = createBillingCallables(invoke);

const PLAN_IDS: readonly PlanId[] = ['free', 'pro', 'business'];
const ENTITLEMENT_STATUSES: readonly EntitlementStatus[] = [
  'free', 'active', 'grace', 'restricted', 'pending',
];
const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'none', 'active', 'trialing', 'past_due', 'unpaid', 'canceled',
  'incomplete', 'incomplete_expired', 'paused',
];

const toDate = (value: unknown): Date | null => {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  return null;
};

const oneOf = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/**
 * Escuta o documento canônico do próprio usuário (leitura de documento único
 * permitida pelas Rules; a escrita é só do backend). `null` quando o documento
 * ainda não existe (é criado pelo `bootstrapAccount`).
 */
export const subscribeBillingAccount = (
  uid: string,
  onNext: (account: BillingAccount | null) => void,
  onError: (error: unknown) => void,
): (() => void) =>
  onSnapshot(
    doc(db, 'billing_accounts', uid),
    (snapshot) => {
      const data = snapshot.data();
      if (!snapshot.exists() || !data) {
        onNext(null);
        return;
      }
      onNext({
        planId: oneOf(PLAN_IDS, data.planId, 'free'),
        entitlementStatus: oneOf(ENTITLEMENT_STATUSES, data.entitlementStatus, 'free'),
        subscriptionStatus: oneOf(SUBSCRIPTION_STATUSES, data.subscriptionStatus, 'none'),
        graceUntil: toDate(data.graceUntil),
        currentPeriodEnd: toDate(data.currentPeriodEnd),
        cancelAtPeriodEnd: data.cancelAtPeriodEnd === true,
        cancelAt: toDate(data.cancelAt),
        hasCustomer: data.stripeCustomerId != null,
      });
    },
    onError,
  );
