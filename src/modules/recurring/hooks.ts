import { useCallback, useMemo, useRef } from 'react';
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
  getGeneratedFacts,
  getRecurringExpense,
  listActiveRecurringExpenses,
  listAmountHistory,
  listOpenOccurrences,
  listRecurringExpenses,
  listRecurringOccurrences,
  recurringCallables,
  type OccurrenceCursor,
} from './api';
import { recurringErrorView } from './presentation';
import type { GeneratedFactState, RecurringOccurrence } from './types';

/**
 * Hooks de Recorrentes (P4-B). Leituras com teto ou paginadas, sem listener;
 * mutações só por callable, com chave de idempotência por intenção (o mesmo
 * conteúdo reenviado reusa a chave; o duplo clique é barrado de forma
 * síncrona pelos diálogos).
 */
export const RECURRING_KEYS = {
  all: (ws: string) => ['recurring', ws] as const,
  list: (ws: string) => ['recurring', ws, 'list'] as const,
  active: (ws: string) => ['recurring', ws, 'active'] as const,
  detail: (ws: string, id: string) => ['recurring', ws, 'detail', id] as const,
  occurrences: (ws: string, id: string) => ['recurring', ws, 'occurrences', id] as const,
  openOccurrences: (ws: string, id: string) => ['recurring', ws, 'open-occurrences', id] as const,
  history: (ws: string, id: string) => ['recurring', ws, 'history', id] as const,
};

const isReady = (workspaceId: string) => Boolean(workspaceId) && workspaceId !== 'loading';

/** Contratos, uma página por vez (`data` é o array já carregado). */
export const useRecurringExpenses = () => {
  const { activeWorkspace } = useWorkspace();
  const result = useInfiniteQuery({
    queryKey: RECURRING_KEYS.list(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listRecurringExpenses(activeWorkspace.id, { cursor: pageParam }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  return { ...result, data: result.data?.pages.flatMap((page) => page.items) };
};

/** Contratos ativos para os resumos, com corte sinalizado. */
export const useActiveRecurringExpenses = () => {
  const { activeWorkspace } = useWorkspace();
  const result = useQuery({
    queryKey: RECURRING_KEYS.active(activeWorkspace.id),
    queryFn: () => listActiveRecurringExpenses(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id),
  });
  return {
    ...result,
    data: result.data?.items,
    isTruncated: result.data?.truncated === true,
  };
};

export const useRecurringExpense = (id: string) => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: RECURRING_KEYS.detail(activeWorkspace.id, id),
    queryFn: () => getRecurringExpense(id, activeWorkspace.id),
    enabled: isReady(activeWorkspace.id) && Boolean(id),
  });
};

const factRefsOf = (occurrences: readonly RecurringOccurrence[]) => ({
  cashTransactionIds: occurrences
    .map((occurrence) => occurrence.cashTransactionId)
    .filter((factId): factId is string => Boolean(factId)),
  cardPurchaseIds: occurrences
    .map((occurrence) => occurrence.cardPurchaseId)
    .filter((factId): factId is string => Boolean(factId)),
});

/**
 * Histórico de ocorrências resolvidas, uma página por vez (cursor), com o
 * estado atual dos fatos gerados daquela página (lido uma vez por página, em
 * lotes de 30 por ID — "Carregar mais" não relê os fatos já exibidos).
 */
export const useRecurringOccurrences = (id: string) => {
  const { activeWorkspace } = useWorkspace();
  const result = useInfiniteQuery({
    queryKey: RECURRING_KEYS.occurrences(activeWorkspace.id, id),
    enabled: isReady(activeWorkspace.id) && Boolean(id),
    initialPageParam: undefined as OccurrenceCursor | undefined,
    queryFn: async ({ pageParam }) => {
      const page = await listRecurringOccurrences(id, activeWorkspace.id, { cursor: pageParam });
      const facts = await getGeneratedFacts(factRefsOf(page.items), activeWorkspace.id);
      return { ...page, facts };
    },
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  const pages = result.data?.pages;
  const facts = useMemo(
    () => Object.assign({}, ...(pages ?? []).map((page) => page.facts)) as Record<string, GeneratedFactState>,
    [pages],
  );
  return { ...result, data: pages?.flatMap((page) => page.items), facts };
};

/** Ocorrências que pedem ação, com corte sinalizado. */
export const useOpenRecurringOccurrences = (id: string) => {
  const { activeWorkspace } = useWorkspace();
  const result = useQuery({
    queryKey: RECURRING_KEYS.openOccurrences(activeWorkspace.id, id),
    queryFn: () => listOpenOccurrences(id, activeWorkspace.id),
    enabled: isReady(activeWorkspace.id) && Boolean(id),
  });
  return { ...result, data: result.data?.items, isTruncated: result.data?.truncated === true };
};

export const useRecurringAmountHistory = (id: string) => {
  const { activeWorkspace } = useWorkspace();
  const result = useQuery({
    queryKey: RECURRING_KEYS.history(activeWorkspace.id, id),
    queryFn: () => listAmountHistory(id, activeWorkspace.id),
    enabled: isReady(activeWorkspace.id) && Boolean(id),
  });
  return { ...result, data: result.data?.items, isTruncated: result.data?.truncated === true };
};

export interface RecurringMutationInput {
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * Mutação por callable. Depois do sucesso — e depois de falha que indica
 * outro estado no servidor — recarrega Recorrentes, cartões (compra gerada),
 * contas e as telas do caixa (lançamento gerado).
 */
const useRecurringCallable = <TResult,>(
  call: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<TResult>,
) => {
  const { activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const workspaceId = activeWorkspace.id;
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: RECURRING_KEYS.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: ['credit_cards', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['financialReportCreditCardDomain'] }),
    invalidateTransactionDependents(queryClient, workspaceId),
  ]);
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: RecurringMutationInput) =>
      call({ workspaceId, ...payload }, idempotencyKey),
    onSuccess: async () => {
      await refresh();
    },
    onError: async (error) => {
      if (recurringErrorView(error).refresh) await refresh();
    },
  });
};

export const useCreateRecurringExpense = () =>
  useRecurringCallable(recurringCallables.createRecurringExpense);
export const useUpdateRecurringExpense = () =>
  useRecurringCallable(recurringCallables.updateRecurringExpense);
export const usePauseRecurringExpense = () =>
  useRecurringCallable(recurringCallables.pauseRecurringExpense);
export const useResumeRecurringExpense = () =>
  useRecurringCallable(recurringCallables.resumeRecurringExpense);
export const useCancelRecurringExpense = () =>
  useRecurringCallable(recurringCallables.cancelRecurringExpense);
export const useConfirmRecurringOccurrence = () =>
  useRecurringCallable(recurringCallables.confirmRecurringOccurrence);
export const useIgnoreRecurringOccurrence = () =>
  useRecurringCallable(recurringCallables.ignoreRecurringOccurrence);
export const useRetryRecurringOccurrence = () =>
  useRecurringCallable(recurringCallables.retryRecurringOccurrence);

/** Chave aleatória da intenção (UUID; fora de contexto seguro, 128 bits do CSPRNG). */
export const newRecurringIdempotencyKey = (): string => {
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
export const useRecurringIntentKey = () => {
  const intentRef = useRef<IntentKey | null>(null);
  const keyFor = useCallback((operation: string, payload: Record<string, unknown>) => {
    const intent = resolveIntentKey(intentRef.current, operation, payload, newRecurringIdempotencyKey);
    intentRef.current = intent;
    return intent.key;
  }, []);
  const reset = useCallback(() => {
    intentRef.current = null;
  }, []);
  return useMemo(() => ({ keyFor, reset }), [keyFor, reset]);
};
