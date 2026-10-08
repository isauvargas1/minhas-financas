import { useCallback, useMemo, useRef } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { useWorkspace } from '../../contexts/WorkspaceContext';
import { saoPauloToday } from '../loans/money';
import { invalidateTransactionDependents } from '../transactions/hooks';
import { resolveIntentKey, type IntentKey } from '../transactions/cashEntry';
import {
  clientsCallables,
  countOpenReceivablesOfClient,
  getClientPrivate,
  getClientsByIds,
  getReceivableReportData,
  getReceivableTotals,
  listActiveClientOptions,
  listClientPrivate,
  listClients,
  listReceivableMovements,
  listReceivables,
  type ClientCursor,
  type MovementCursor,
  type ReceivableCursor,
} from './api';
import { clientPermissions, clientsErrorView } from './presentation';
import type { Client } from './types';

/**
 * Hooks de clientes e recebíveis (P3-I). Leituras paginadas ou agregadas,
 * sem listener; mutações só por callable, com chave por intenção.
 */
export const KEYS = {
  clients: (ws: string) => ['clients', ws, 'list'] as const,
  clientOptions: (ws: string) => ['clients', ws, 'options'] as const,
  clientNames: (ws: string, ids: string) => ['clients', ws, 'names', ids] as const,
  clientPrivate: (ws: string, ids: string) => ['client_private', ws, 'list', ids] as const,
  clientPrivateOne: (ws: string, id: string) => ['client_private', ws, 'one', id] as const,
  openOfClient: (ws: string, id: string) => ['receivables', ws, 'open-of-client', id] as const,
  receivables: (ws: string) => ['receivables', ws, 'list'] as const,
  totals: (ws: string, today: string) => ['receivables', ws, 'totals', today] as const,
  report: (ws: string, today: string) => ['receivables', ws, 'report', today] as const,
  movements: (ws: string, id: string) => ['receivable_movements', ws, id] as const,
};

const isReady = (workspaceId: string) => Boolean(workspaceId) && workspaceId !== 'loading';

/** Clientes (ativos e arquivados), uma página por vez. */
export const useClients = () => {
  const { activeWorkspace } = useWorkspace();
  const result = useInfiniteQuery({
    queryKey: KEYS.clients(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id),
    initialPageParam: undefined as ClientCursor | undefined,
    queryFn: ({ pageParam }) => listClients(activeWorkspace.id, { cursor: pageParam }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  return { ...result, data: result.data?.pages.flatMap((page) => page.items) };
};

/** Clientes ativos para o formulário de recebível. */
export const useActiveClientOptions = (enabled: boolean) => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: KEYS.clientOptions(activeWorkspace.id),
    queryFn: () => listActiveClientOptions(activeWorkspace.id),
    enabled: enabled && isReady(activeWorkspace.id),
  });
};

/** Nomes dos clientes citados pelos recebíveis que não estão nas páginas carregadas. */
export const useClientNames = (loaded: Client[] | undefined, referencedIds: string[]) => {
  const { activeWorkspace } = useWorkspace();
  const missing = useMemo(() => {
    const known = new Set((loaded ?? []).map((client) => client.id));
    return Array.from(new Set(referencedIds.filter((id) => !known.has(id)))).sort();
  }, [loaded, referencedIds]);
  const extra = useQuery({
    queryKey: KEYS.clientNames(activeWorkspace.id, missing.join(',')),
    queryFn: () => getClientsByIds(missing, activeWorkspace.id),
    enabled: isReady(activeWorkspace.id) && missing.length > 0 && loaded !== undefined,
  });
  return useMemo(() => {
    const names = new Map<string, Client>();
    for (const client of [...(loaded ?? []), ...(extra.data ?? [])]) names.set(client.id, client);
    return names;
  }, [loaded, extra.data]);
};

/**
 * Dados pessoais dos clientes exibidos — a consulta só existe para owner e
 * admin. Para member e viewer nada é pedido (D-24).
 */
export const useClientPrivateList = (clientIds: string[]) => {
  const { activeWorkspace, activeWorkspaceRole } = useWorkspace();
  const allowed = clientPermissions(activeWorkspaceRole).canSeePrivateData;
  const ids = useMemo(() => Array.from(new Set(clientIds)).sort(), [clientIds]);
  return useQuery({
    queryKey: KEYS.clientPrivate(activeWorkspace.id, ids.join(',')),
    queryFn: () => listClientPrivate(ids, activeWorkspace.id),
    enabled: allowed && isReady(activeWorkspace.id) && ids.length > 0,
  });
};

/** Dados pessoais de um cliente, para o formulário de edição (owner/admin). */
export const useClientPrivate = (clientId: string | null) => {
  const { activeWorkspace, activeWorkspaceRole } = useWorkspace();
  const allowed = clientPermissions(activeWorkspaceRole).canSeePrivateData;
  return useQuery({
    queryKey: KEYS.clientPrivateOne(activeWorkspace.id, clientId ?? ''),
    queryFn: () => getClientPrivate(clientId!, activeWorkspace.id),
    enabled: allowed && isReady(activeWorkspace.id) && Boolean(clientId),
  });
};

/** Quantos recebíveis em aberto o cliente tem (explica o bloqueio do arquivamento). */
export const useOpenReceivablesOfClient = (clientId: string | null) => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: KEYS.openOfClient(activeWorkspace.id, clientId ?? ''),
    queryFn: () => countOpenReceivablesOfClient(clientId!, activeWorkspace.id),
    enabled: isReady(activeWorkspace.id) && Boolean(clientId),
  });
};

/** Recebíveis por vencimento, uma página por vez. */
export const useReceivables = () => {
  const { activeWorkspace } = useWorkspace();
  const result = useInfiniteQuery({
    queryKey: KEYS.receivables(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id),
    initialPageParam: undefined as ReceivableCursor | undefined,
    queryFn: ({ pageParam }) => listReceivables(activeWorkspace.id, { cursor: pageParam }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  return { ...result, data: result.data?.pages.flatMap((page) => page.items) };
};

/** Totais dos cartões, somados no servidor sobre o saldo em aberto. */
export const useReceivableTotals = () => {
  const { activeWorkspace } = useWorkspace();
  const today = saoPauloToday();
  return useQuery({
    queryKey: KEYS.totals(activeWorkspace.id, today),
    queryFn: () => getReceivableTotals(today, activeWorkspace.id),
    enabled: isReady(activeWorkspace.id),
  });
};

/** Indicadores de recebíveis do relatório (só espaço PJ). */
export const useReceivableReportData = () => {
  const { activeWorkspace } = useWorkspace();
  const today = saoPauloToday();
  return useQuery({
    queryKey: KEYS.report(activeWorkspace.id, today),
    queryFn: () => getReceivableReportData(today, activeWorkspace.id),
    enabled: isReady(activeWorkspace.id) && activeWorkspace.type === 'PJ',
  });
};

/** Histórico de um recebível, paginado e ordenado pelo servidor. */
export const useReceivableMovements = (receivableId: string | null) => {
  const { activeWorkspace } = useWorkspace();
  const result = useInfiniteQuery({
    queryKey: KEYS.movements(activeWorkspace.id, receivableId ?? ''),
    enabled: isReady(activeWorkspace.id) && Boolean(receivableId),
    initialPageParam: undefined as MovementCursor | undefined,
    queryFn: ({ pageParam }) =>
      listReceivableMovements(receivableId!, activeWorkspace.id, { cursor: pageParam }),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  return { ...result, data: result.data?.pages.flatMap((page) => page.items) };
};

export interface ClientsMutationInput {
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * Mutação por callable. Depois do sucesso recarrega clientes, recebíveis,
 * totais, histórico e as telas do caixa (o espelho do recebimento nasce no
 * backend, no mesmo commit); depois de falha que indica outro estado no
 * servidor (conflito, pré-condição, resultado incerto), também.
 */
const useClientsCallable = <TResult,>(
  call: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<TResult>,
  options: { touchesCash: boolean },
) => {
  const { activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const workspaceId = activeWorkspace.id;
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['clients', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['client_private', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['receivables', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['receivable_movements', workspaceId] }),
    ...(options.touchesCash ? [invalidateTransactionDependents(queryClient, workspaceId)] : []),
  ]);
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: ClientsMutationInput) => call(payload, idempotencyKey),
    onSuccess: async () => {
      await refresh();
    },
    onError: async (error) => {
      if (clientsErrorView(error).refresh) await refresh();
    },
  });
};

export const useCreateClient = () =>
  useClientsCallable(clientsCallables.createClient, { touchesCash: false });
export const useUpdateClient = () =>
  useClientsCallable(clientsCallables.updateClient, { touchesCash: false });
export const useArchiveClient = () =>
  useClientsCallable(clientsCallables.archiveClient, { touchesCash: false });
export const useCreateReceivable = () =>
  useClientsCallable(clientsCallables.createReceivable, { touchesCash: false });
export const useUpdateReceivable = () =>
  useClientsCallable(clientsCallables.updateReceivable, { touchesCash: false });
export const useReceiveReceivable = () =>
  useClientsCallable(clientsCallables.receiveReceivable, { touchesCash: true });
export const useReverseReceivableReceipt = () =>
  useClientsCallable(clientsCallables.reverseReceivableReceipt, { touchesCash: true });
export const useCancelReceivable = () =>
  useClientsCallable(clientsCallables.cancelReceivable, { touchesCash: false });

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
export const useClientsIntentKey = () => {
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
