import { useCallback, useRef } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { useWorkspace } from '../../contexts/WorkspaceContext';
import { invalidateTransactionDependents } from '../transactions/hooks';
import { resolveIntentKey, type IntentKey } from '../transactions/cashEntry';
import {
  accountsCallables,
  getCashAccountsTotal,
  listCashAccountMovements,
  listCashAccounts,
  listCashTransfers,
  type MovementCursor,
  type TransferCursor,
} from './api';
import { accountsErrorView } from './presentation';

/**
 * Hooks de contas/carteiras e transferências (D-30, P3-J). Leituras com teto
 * ou paginadas, sem listener; mutações só por callable, com chave por
 * intenção.
 */
export const ACCOUNT_KEYS = {
  all: (ws: string) => ['cash_accounts', ws] as const,
  list: (ws: string) => ['cash_accounts', ws, 'list'] as const,
  total: (ws: string) => ['cash_accounts', ws, 'total'] as const,
  movements: (ws: string, id: string) => ['cash_account_movements', ws, id] as const,
  transfers: (ws: string) => ['cash_transfers', ws, 'list'] as const,
};

const isReady = (workspaceId: string) => Boolean(workspaceId) && workspaceId !== 'loading';

/**
 * Todas as contas (ativas e arquivadas), até o teto: a área de configurações
 * e a escolha de conta nos formulários (ativas, mais a já vinculada).
 */
export const useCashAccounts = () => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: ACCOUNT_KEYS.list(activeWorkspace.id),
    queryFn: () => listCashAccounts(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id),
  });
};

/** Saldo geral, somado no servidor. */
export const useCashAccountsTotal = () => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: ACCOUNT_KEYS.total(activeWorkspace.id),
    queryFn: () => getCashAccountsTotal(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id),
  });
};

/** Extrato de uma conta, paginado pelo servidor. */
export const useCashAccountMovements = (accountId: string | null) => {
  const { activeWorkspace } = useWorkspace();
  const result = useInfiniteQuery({
    queryKey: ACCOUNT_KEYS.movements(activeWorkspace.id, accountId ?? ''),
    enabled: isReady(activeWorkspace.id) && Boolean(accountId),
    initialPageParam: undefined as MovementCursor | undefined,
    queryFn: ({ pageParam }) =>
      listCashAccountMovements(accountId!, activeWorkspace.id, { cursor: pageParam }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  return { ...result, data: result.data?.pages.flatMap((page) => page.items) };
};

/** Histórico de transferências, paginado pelo servidor. */
export const useCashTransfers = () => {
  const { activeWorkspace } = useWorkspace();
  const result = useInfiniteQuery({
    queryKey: ACCOUNT_KEYS.transfers(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id),
    initialPageParam: undefined as TransferCursor | undefined,
    queryFn: ({ pageParam }) => listCashTransfers(activeWorkspace.id, { cursor: pageParam }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  return { ...result, data: result.data?.pages.flatMap((page) => page.items) };
};

export interface AccountsMutationInput {
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * Mutação por callable. Depois do sucesso recarrega contas, saldo geral,
 * extratos e transferências e — quando o saldo pode ter mudado — as telas do
 * caixa; depois de falha que indica outro estado no servidor, também.
 */
const useAccountsCallable = <TResult,>(
  call: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<TResult>,
) => {
  const { activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const workspaceId = activeWorkspace.id;
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['cash_accounts', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['cash_account_movements', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['cash_transfers', workspaceId] }),
    invalidateTransactionDependents(queryClient, workspaceId),
  ]);
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: AccountsMutationInput) => call(payload, idempotencyKey),
    onSuccess: async () => {
      await refresh();
    },
    onError: async (error) => {
      if (accountsErrorView(error).refresh) await refresh();
    },
  });
};

export const useCreateCashAccount = () => useAccountsCallable(accountsCallables.createCashAccount);
export const useUpdateCashAccount = () => useAccountsCallable(accountsCallables.updateCashAccount);
export const useArchiveCashAccount = () => useAccountsCallable(accountsCallables.archiveCashAccount);
export const useReactivateCashAccount = () =>
  useAccountsCallable(accountsCallables.reactivateCashAccount);
export const useCreateCashTransfer = () => useAccountsCallable(accountsCallables.createCashTransfer);
export const useReverseCashTransfer = () => useAccountsCallable(accountsCallables.reverseCashTransfer);

/** Chave aleatória da intenção (UUID; fora de contexto seguro, 128 bits do CSPRNG). */
const newIdempotencyKey = (): string => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Chave de idempotência por intenção de um diálogo: reenviar o mesmo
 * conteúdo (depois de falha ou resposta incerta) reusa a chave; conteúdo
 * diferente gera outra. `reset` ao abrir o diálogo para uma intenção nova.
 */
export const useAccountsIntentKey = () => {
  const intentRef = useRef<IntentKey | null>(null);
  const keyFor = useCallback((operation: string, payload: Record<string, unknown>) => {
    const intent = resolveIntentKey(intentRef.current, operation, payload, newIdempotencyKey);
    intentRef.current = intent;
    return intent.key;
  }, []);
  const reset = useCallback(() => {
    intentRef.current = null;
  }, []);
  return { keyFor, reset };
};
