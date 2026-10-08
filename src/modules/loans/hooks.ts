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
  getLoan,
  getLoanTotals,
  listLoans,
  listMovements,
  loanCallables,
  type LoanMovementCursor,
} from './api';
import { loanErrorView } from './presentation';

export const KEYS = {
  allLoans: (ws: string) => ['loans', ws] as const,
  loanTotals: (ws: string) => ['loans', ws, 'totals'] as const,
  loan: (ws: string, id: string) => ['loans', ws, 'detail', id] as const,
  movements: (ws: string, loanId: string) => ['loan_movements', ws, loanId] as const,
};

const isReady = (workspaceId: string) => Boolean(workspaceId) && workspaceId !== 'loading';

/** Empréstimos, uma página por vez; `data` é o que já foi carregado. */
export const useLoans = () => {
  const { activeWorkspace } = useWorkspace();
  const queryResult = useInfiniteQuery({
    queryKey: KEYS.allLoans(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listLoans(activeWorkspace.id, { cursor: pageParam }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  return {
    ...queryResult,
    data: queryResult.data?.pages.flatMap((page) => page.items),
  };
};

/** Totais do servidor (centavos), independentes da página carregada. */
export const useLoanTotals = () => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: KEYS.loanTotals(activeWorkspace.id),
    queryFn: () => getLoanTotals(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id),
  });
};

export const useLoan = (loanId: string | null) => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: KEYS.loan(activeWorkspace.id, loanId || ''),
    queryFn: () => getLoan(loanId!, activeWorkspace.id),
    enabled: isReady(activeWorkspace.id) && Boolean(loanId),
  });
};

/** Movimentos de um contrato, paginados e ordenados pelo servidor. */
export const useLoanMovements = (loanId: string) => {
  const { activeWorkspace } = useWorkspace();
  const queryResult = useInfiniteQuery({
    queryKey: KEYS.movements(activeWorkspace.id, loanId),
    enabled: isReady(activeWorkspace.id) && Boolean(loanId),
    initialPageParam: undefined as LoanMovementCursor | undefined,
    queryFn: ({ pageParam }) => listMovements(loanId, activeWorkspace.id, { cursor: pageParam }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  return {
    ...queryResult,
    data: queryResult.data?.pages.flatMap((page) => page.items),
  };
};

export interface LoanMutationInput {
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * Mutação por callable. Depois do sucesso recarrega contrato, movimentos,
 * lista, totais e as telas do caixa (o espelho nasce no backend, no mesmo
 * commit); depois de falha que indica outro estado no servidor (conflito,
 * pré-condição, resultado incerto), também.
 */
const useLoanCallable = <TResult,>(
  call: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<TResult>,
) => {
  const { activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const workspaceId = activeWorkspace.id;
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['loans', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['loan_movements', workspaceId] }),
    invalidateTransactionDependents(queryClient, workspaceId),
  ]);
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: LoanMutationInput) => call(payload, idempotencyKey),
    onSuccess: async () => {
      await refresh();
    },
    onError: async (error) => {
      if (loanErrorView(error).refresh) await refresh();
    },
  });
};

export const useCreateLoan = () => useLoanCallable(loanCallables.createLoan);
export const useRegisterLoanPayment = () => useLoanCallable(loanCallables.registerLoanPayment);
export const useReverseLoanMovement = () => useLoanCallable(loanCallables.reverseLoanMovement);
export const useCancelLoan = () => useLoanCallable(loanCallables.cancelLoan);
export const useUpdateLoanMetadata = () => useLoanCallable(loanCallables.updateLoanMetadata);

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
export const useLoanIntentKey = () => {
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
