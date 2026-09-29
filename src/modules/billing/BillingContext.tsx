import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '../../contexts/AuthContext';
import { getBillingCatalog, subscribeBillingAccount } from './api';
import { displayEntitlement } from './entitlement';
import type {
  BillingAccount,
  BillingCatalog,
  BillingPlan,
  DisplayEntitlement,
  PlanLimitKey,
} from './types';

type LoadStatus = 'loading' | 'ready' | 'error';

interface BillingContextValue {
  catalog: BillingCatalog | null;
  catalogStatus: LoadStatus;
  account: BillingAccount | null;
  accountStatus: LoadStatus;
  /** Plano e status para exibição; a autoridade é o backend. */
  entitlement: DisplayEntitlement;
  /** Plano do catálogo correspondente ao entitlement; `null` sem catálogo. */
  currentPlan: BillingPlan | null;
  /**
   * Ajuda de UX apenas: habilita/desabilita botões. NÃO é enforcement; a
   * autoridade sobre limites será o backend (P2B).
   */
  checkLimit: (resource: PlanLimitKey, currentValue: number) => boolean;
}

const BillingContext = createContext<BillingContextValue | undefined>(undefined);

export const BillingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  const catalogQuery = useQuery({
    queryKey: ['billing', 'catalog', uid],
    queryFn: getBillingCatalog,
    enabled: !!user,
    staleTime: Infinity,
  });

  const [accountState, setAccountState] = useState<{
    uid: string | null;
    account: BillingAccount | null;
    status: LoadStatus;
  }>({ uid: null, account: null, status: 'loading' });

  useEffect(() => {
    if (!uid) {
      setAccountState({ uid: null, account: null, status: 'loading' });
      return undefined;
    }
    setAccountState({ uid, account: null, status: 'loading' });
    return subscribeBillingAccount(
      uid,
      (account) => setAccountState({ uid, account, status: 'ready' }),
      (error) => {
        const code = (error as { code?: unknown } | null)?.code;
        console.error('Falha ao ler a conta de cobrança', typeof code === 'string' ? code : 'desconhecido');
        setAccountState({ uid, account: null, status: 'error' });
      },
    );
  }, [uid]);

  // Estado de outra sessão nunca é exposto durante a troca de usuário.
  const current = accountState.uid === uid
    ? accountState
    : { uid, account: null, status: 'loading' as LoadStatus };

  const catalog = uid ? catalogQuery.data ?? null : null;
  const catalogStatus: LoadStatus = catalogQuery.isError
    ? 'error'
    : catalog ? 'ready' : 'loading';

  const entitlement = displayEntitlement(current.account, Date.now());
  const currentPlan = catalog?.plans.find((plan) => plan.planId === entitlement.planId) ?? null;

  const checkLimit = useCallback(
    (resource: PlanLimitKey, currentValue: number): boolean =>
      currentPlan ? currentValue < currentPlan.limits[resource] : true,
    [currentPlan],
  );

  const value: BillingContextValue = {
    catalog,
    catalogStatus,
    account: current.account,
    accountStatus: current.status,
    entitlement,
    currentPlan,
    checkLimit,
  };

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
};

export const useBilling = (): BillingContextValue => {
  const context = useContext(BillingContext);
  if (!context) throw new Error('useBilling deve ser usado dentro de BillingProvider');
  return context;
};
