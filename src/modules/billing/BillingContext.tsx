import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import {
  getAccountUsage,
  getBillingCatalog,
  getWorkspaceEntitlement,
  subscribeBillingAccount,
} from './api';
import { displayEntitlement } from './entitlement';
import { billingKeys } from './queryKeys';
import type {
  AccountLimitKey,
  AccountUsage,
  BillingAccount,
  BillingCatalog,
  BillingPlan,
  DisplayEntitlement,
  WorkspaceEntitlement,
  WorkspaceLimitKey,
} from './types';

type LoadStatus = 'loading' | 'ready' | 'error';

/**
 * Dois planos diferentes (D-01):
 *
 * - **conta**: o plano do próprio usuário (`billing_accounts/{uid}`). Vale
 *   para "Meu Plano", tabela de preços, portal e criação de workspace
 *   próprio;
 * - **workspace**: o plano do owner do workspace ativo, avaliado pelo
 *   servidor (`getWorkspaceEntitlement`). Vale para os recursos daquele
 *   workspace (lançamentos, divisão de contas...), inclusive para quem é só
 *   convidado.
 *
 * Tudo aqui é ajuda de UX para habilitar/desabilitar botões; a autoridade
 * sobre limites é o backend, que decide de novo em cada operação.
 */
interface BillingContextValue {
  catalog: BillingCatalog | null;
  catalogStatus: LoadStatus;
  account: BillingAccount | null;
  accountStatus: LoadStatus;
  /** Plano e status da conta do usuário, para exibição. */
  accountEntitlement: DisplayEntitlement;
  /** Plano do catálogo da conta do usuário; `null` sem catálogo. */
  accountPlan: BillingPlan | null;
  /** Uso da conta; `null` enquanto carrega ou se a leitura falhar. */
  accountUsage: AccountUsage | null;
  checkAccountLimit: (resource: AccountLimitKey) => boolean;
  /** Plano do owner do workspace ativo; `null` enquanto carrega. */
  workspaceEntitlement: WorkspaceEntitlement | null;
  checkWorkspaceLimit: (resource: WorkspaceLimitKey, currentValue: number) => boolean;
}

const BillingContext = createContext<BillingContextValue | undefined>(undefined);

/** Refaz as leituras do servidor ao voltar para a janela, no máximo a cada minuto. */
const SERVER_READ_OPTIONS = {
  staleTime: 60 * 1000,
  refetchOnWindowFocus: true,
  retry: 1,
} as const;

/**
 * Fica abaixo do `WorkspaceProvider`: catálogo e listener do documento
 * canônico só começam depois que o `bootstrapAccount` do usuário atual
 * concluiu. Antes disso as Rules negam a leitura (conta ainda inexistente no
 * primeiro login) e o listener morreria sem ser refeito.
 */
export const BillingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const { isAccountReady, activeWorkspace } = useWorkspace();
  const uid = user && isAccountReady ? user.uid : null;
  const workspaceId = uid && activeWorkspace.id !== 'loading' ? activeWorkspace.id : null;

  const catalogQuery = useQuery({
    queryKey: billingKeys.catalog(uid),
    queryFn: getBillingCatalog,
    enabled: uid !== null,
    staleTime: Infinity,
  });

  const usageQuery = useQuery({
    queryKey: billingKeys.accountUsage(uid),
    queryFn: getAccountUsage,
    enabled: uid !== null,
    ...SERVER_READ_OPTIONS,
  });

  // A chave muda com o workspace: trocar de workspace refaz a consulta e
  // nunca exibe o plano do workspace anterior.
  const workspaceQuery = useQuery({
    queryKey: billingKeys.workspaceEntitlement(uid, workspaceId),
    queryFn: () => getWorkspaceEntitlement(workspaceId as string),
    enabled: workspaceId !== null,
    ...SERVER_READ_OPTIONS,
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

  const accountEntitlement = displayEntitlement(current.account, Date.now());
  const accountPlan = catalog?.plans.find((plan) => plan.planId === accountEntitlement.planId) ?? null;
  const accountUsage = uid ? usageQuery.data ?? null : null;
  const workspaceEntitlement = workspaceId ? workspaceQuery.data ?? null : null;

  const checkAccountLimit = useCallback(
    (resource: AccountLimitKey): boolean =>
      accountPlan && accountUsage
        ? accountUsage.activeOwnedWorkspaces < accountPlan.limits[resource]
        : true,
    [accountPlan, accountUsage],
  );

  const checkWorkspaceLimit = useCallback(
    (resource: WorkspaceLimitKey, currentValue: number): boolean =>
      workspaceEntitlement ? currentValue < workspaceEntitlement.limits[resource] : true,
    [workspaceEntitlement],
  );

  const value: BillingContextValue = {
    catalog,
    catalogStatus,
    account: current.account,
    accountStatus: current.status,
    accountEntitlement,
    accountPlan,
    accountUsage,
    checkAccountLimit,
    workspaceEntitlement,
    checkWorkspaceLimit,
  };

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
};

export const useBilling = (): BillingContextValue => {
  const context = useContext(BillingContext);
  if (!context) throw new Error('useBilling deve ser usado dentro de BillingProvider');
  return context;
};
