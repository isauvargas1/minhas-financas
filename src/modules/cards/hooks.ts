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
  cardsCallables,
  getPurchasesByIds,
  listCardEvents,
  listClosedInvoices,
  listCreditCards,
  listInvoiceEntries,
  listInvoicePayments,
  listOpenInvoices,
  listRecentPurchases,
} from './api';
import { cardsErrorView } from './presentation';

/**
 * Hooks de cartões (P4-A). Leituras com teto ou paginadas, sem listener;
 * mutações só por callable, com chave de idempotência por intenção (o mesmo
 * conteúdo reenviado reusa a chave; o duplo clique é barrado de forma
 * síncrona pelos diálogos).
 */
export const CARD_KEYS = {
  all: (ws: string) => ['credit_cards', ws] as const,
  list: (ws: string) => ['credit_cards', ws, 'list'] as const,
  openInvoices: (ws: string, cardId: string) => ['credit_cards', ws, 'open_invoices', cardId] as const,
  closedInvoices: (ws: string, cardId: string) => ['credit_cards', ws, 'closed_invoices', cardId] as const,
  entries: (ws: string, invoiceId: string) => ['credit_cards', ws, 'entries', invoiceId] as const,
  payments: (ws: string, invoiceId: string) => ['credit_cards', ws, 'payments', invoiceId] as const,
  purchases: (ws: string, ids: string) => ['credit_cards', ws, 'purchases', ids] as const,
  recent: (ws: string, cardId: string) => ['credit_cards', ws, 'recent', cardId] as const,
  events: (ws: string, cardId: string) => ['credit_cards', ws, 'events', cardId] as const,
};

const isReady = (workspaceId: string) => Boolean(workspaceId) && workspaceId !== 'loading';

/** Todos os cartões (ativos e arquivados), até o teto. */
export const useCreditCards = () => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: CARD_KEYS.list(activeWorkspace.id),
    queryFn: () => listCreditCards(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id),
  });
};

export const useOpenInvoices = (cardId: string | null) => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: CARD_KEYS.openInvoices(activeWorkspace.id, cardId ?? ''),
    queryFn: () => listOpenInvoices(cardId!, activeWorkspace.id),
    enabled: isReady(activeWorkspace.id) && Boolean(cardId),
  });
};

export const useClosedInvoices = (cardId: string | null) => {
  const { activeWorkspace } = useWorkspace();
  const result = useInfiniteQuery({
    queryKey: CARD_KEYS.closedInvoices(activeWorkspace.id, cardId ?? ''),
    enabled: isReady(activeWorkspace.id) && Boolean(cardId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listClosedInvoices(cardId!, activeWorkspace.id, pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  return { ...result, data: result.data?.pages.flatMap((page) => page.items) };
};

export const useInvoiceEntries = (invoiceId: string | null) => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: CARD_KEYS.entries(activeWorkspace.id, invoiceId ?? ''),
    queryFn: () => listInvoiceEntries(invoiceId!, activeWorkspace.id),
    enabled: isReady(activeWorkspace.id) && Boolean(invoiceId),
  });
};

export const useInvoicePayments = (invoiceId: string | null) => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: CARD_KEYS.payments(activeWorkspace.id, invoiceId ?? ''),
    queryFn: () => listInvoicePayments(invoiceId!, activeWorkspace.id),
    enabled: isReady(activeWorkspace.id) && Boolean(invoiceId),
  });
};

export const usePurchasesByIds = (ids: readonly string[]) => {
  const { activeWorkspace } = useWorkspace();
  const key = Array.from(new Set(ids)).sort().join(',');
  return useQuery({
    queryKey: CARD_KEYS.purchases(activeWorkspace.id, key),
    queryFn: () => getPurchasesByIds(key ? key.split(',') : [], activeWorkspace.id),
    enabled: isReady(activeWorkspace.id) && key.length > 0,
  });
};

export const useRecentPurchases = (cardId: string | null, enabled = true) => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: CARD_KEYS.recent(activeWorkspace.id, cardId ?? ''),
    queryFn: () => listRecentPurchases(cardId!, activeWorkspace.id),
    enabled: enabled && isReady(activeWorkspace.id) && Boolean(cardId),
  });
};

/** Auditoria do cartão: só para owner/admin (as Rules negam aos demais). */
export const useCardEvents = (cardId: string | null, enabled: boolean) => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: CARD_KEYS.events(activeWorkspace.id, cardId ?? ''),
    queryFn: () => listCardEvents(cardId!, activeWorkspace.id),
    enabled: enabled && isReady(activeWorkspace.id) && Boolean(cardId),
  });
};

export interface CardsMutationInput {
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * Mutação por callable. Depois do sucesso — e depois de falha que indica
 * outro estado no servidor — recarrega o domínio de cartões, as contas (o
 * pagamento move a conta) e as telas do caixa e dos relatórios.
 */
const useCardsCallable = <TResult,>(
  call: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<TResult>,
) => {
  const { activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const workspaceId = activeWorkspace.id;
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['credit_cards', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['cash_accounts', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['cash_account_movements', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['financialReportCreditCardDomain'] }),
    invalidateTransactionDependents(queryClient, workspaceId),
  ]);
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: CardsMutationInput) => call(payload, idempotencyKey),
    onSuccess: async () => {
      await refresh();
    },
    onError: async (error) => {
      if (cardsErrorView(error).refresh) await refresh();
    },
  });
};

export const useCreateCreditCard = () => useCardsCallable(cardsCallables.createCreditCard);
export const useUpdateCreditCard = () => useCardsCallable(cardsCallables.updateCreditCard);
export const useArchiveCreditCard = () => useCardsCallable(cardsCallables.archiveCreditCard);
export const useReactivateCreditCard = () => useCardsCallable(cardsCallables.reactivateCreditCard);
export const useCreateCardPurchase = () => useCardsCallable(cardsCallables.createCreditCardPurchase);
export const useCancelCardPurchase = () => useCardsCallable(cardsCallables.cancelCreditCardPurchase);
export const useRefundCardPurchase = () => useCardsCallable(cardsCallables.refundCreditCardPurchase);
export const useCreateInvoiceAdjustment = () =>
  useCardsCallable(cardsCallables.createCreditCardInvoiceAdjustment);
export const useRegisterInvoicePayment = () => useCardsCallable(cardsCallables.registerInvoicePayment);
export const useReverseInvoicePayment = () => useCardsCallable(cardsCallables.reverseInvoicePayment);

/** Reconciliação (owner/admin): sem chave, idempotente por natureza. */
const useCardsReconciliation = <TResult,>(
  call: (payload: Record<string, unknown>) => Promise<TResult>,
) => {
  const { activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => call(payload),
    onSettled: () => queryClient.invalidateQueries({
      queryKey: ['credit_cards', activeWorkspace.id],
    }),
  });
};

export const useRecalculateCardLimit = () =>
  useCardsReconciliation(cardsCallables.recalculateCardLimit);
export const useRebuildCardInvoices = () =>
  useCardsReconciliation(cardsCallables.rebuildCardInvoicesForCard);

/** Chave aleatória da intenção (UUID; fora de contexto seguro, 128 bits do CSPRNG). */
export const newCardIdempotencyKey = (): string => {
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
export const useCardsIntentKey = () => {
  const intentRef = useRef<IntentKey | null>(null);
  const keyFor = useCallback((operation: string, payload: Record<string, unknown>) => {
    const intent = resolveIntentKey(intentRef.current, operation, payload, newCardIdempotencyKey);
    intentRef.current = intent;
    return intent.key;
  }, []);
  const reset = useCallback(() => {
    intentRef.current = null;
  }, []);
  // Identidade estável: os diálogos chamam `reset` num efeito que depende
  // deste objeto; um objeto novo por renderização zeraria a intenção a cada
  // erro exibido e o reenvio ganharia outra chave.
  return useMemo(() => ({ keyFor, reset }), [keyFor, reset]);
};
