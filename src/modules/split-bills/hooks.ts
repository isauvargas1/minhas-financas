import { useCallback, useMemo, useRef } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { QueryDocumentSnapshot } from 'firebase/firestore';

import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useAuth } from '../../contexts/AuthContext';
import { invalidateTransactionDependents } from '../transactions/hooks';
import { resolveIntentKey, type IntentKey } from '../transactions/cashEntry';
import {
  getSplitGroup,
  listActiveSplitGroups,
  listArchivedSplitGroups,
  listMySplitParticipants,
  listSplitBills,
  listSplitInvites,
  listSplitParticipants,
  listSplitReimbursements,
  listSplitShares,
  splitCallables,
  type DatedCursor,
} from './api';
import { splitErrorView } from './presentation';

/**
 * Hooks da Divisão de contas (P4-C). Leituras com teto ou paginadas, sem
 * listener; mutações só por callable, com chave de idempotência por
 * intenção (o mesmo conteúdo reenviado reusa a chave; o duplo clique é
 * barrado de forma síncrona pelos diálogos).
 */
export const SPLIT_KEYS = {
  all: (ws: string) => ['split', ws] as const,
  activeGroups: (ws: string) => ['split', ws, 'groups', 'active'] as const,
  archivedGroups: (ws: string) => ['split', ws, 'groups', 'archived'] as const,
  group: (ws: string, id: string) => ['split', ws, 'group', id] as const,
  myParticipants: (ws: string, uid: string) => ['split', ws, 'my-participants', uid] as const,
  participants: (ws: string, id: string) => ['split', ws, 'participants', id] as const,
  invites: (ws: string, id: string) => ['split', ws, 'invites', id] as const,
  bills: (ws: string, id: string) => ['split', ws, 'bills', id] as const,
  shares: (ws: string, billId: string) => ['split', ws, 'shares', billId] as const,
  reimbursements: (ws: string, id: string) => ['split', ws, 'reimbursements', id] as const,
};

const isReady = (workspaceId: string) => Boolean(workspaceId) && workspaceId !== 'loading';

/** Grupos ativos (completos até a maior quota), com corte sinalizado. */
export const useActiveSplitGroups = () => {
  const { activeWorkspace } = useWorkspace();
  const result = useQuery({
    queryKey: SPLIT_KEYS.activeGroups(activeWorkspace.id),
    queryFn: () => listActiveSplitGroups(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id),
  });
  return { ...result, data: result.data?.items, isTruncated: result.data?.truncated === true };
};

/** Grupos arquivados, uma página por vez, só quando pedidos. */
export const useArchivedSplitGroups = (enabled: boolean) => {
  const { activeWorkspace } = useWorkspace();
  const result = useInfiniteQuery({
    queryKey: SPLIT_KEYS.archivedGroups(activeWorkspace.id),
    enabled: enabled && isReady(activeWorkspace.id),
    initialPageParam: undefined as QueryDocumentSnapshot | undefined,
    queryFn: ({ pageParam }) => listArchivedSplitGroups(activeWorkspace.id, pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  return { ...result, data: result.data?.pages.flatMap((page) => page.items) };
};

export const useSplitGroup = (groupId: string) => {
  const { activeWorkspace } = useWorkspace();
  return useQuery({
    queryKey: SPLIT_KEYS.group(activeWorkspace.id, groupId),
    queryFn: () => getSplitGroup(activeWorkspace.id, groupId),
    enabled: isReady(activeWorkspace.id) && Boolean(groupId),
  });
};

/** Registros do próprio usuário por grupo (`groupId` → participante). */
export const useMySplitParticipants = () => {
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const uid = user?.uid ?? '';
  const result = useQuery({
    queryKey: SPLIT_KEYS.myParticipants(activeWorkspace.id, uid),
    queryFn: () => listMySplitParticipants(activeWorkspace.id, uid),
    enabled: isReady(activeWorkspace.id) && Boolean(uid),
  });
  const byGroup = useMemo(
    () => new Map((result.data?.items ?? []).map((participant) => [participant.groupId, participant])),
    [result.data],
  );
  return { ...result, byGroup, isTruncated: result.data?.truncated === true };
};

export const useSplitParticipants = (groupId: string) => {
  const { activeWorkspace } = useWorkspace();
  const result = useQuery({
    queryKey: SPLIT_KEYS.participants(activeWorkspace.id, groupId),
    queryFn: () => listSplitParticipants(activeWorkspace.id, groupId),
    enabled: isReady(activeWorkspace.id) && Boolean(groupId),
  });
  return { ...result, data: result.data?.items, isTruncated: result.data?.truncated === true };
};

export const useSplitInvites = (groupId: string, isWorkspaceAdmin: boolean, enabled: boolean) => {
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const result = useQuery({
    queryKey: [...SPLIT_KEYS.invites(activeWorkspace.id, groupId), isWorkspaceAdmin],
    queryFn: () => listSplitInvites(activeWorkspace.id, groupId,
      { uid: user?.uid, isWorkspaceAdmin }),
    enabled: enabled && isReady(activeWorkspace.id) && Boolean(groupId) && Boolean(user?.uid),
  });
  return { ...result, data: result.data?.items, isTruncated: result.data?.truncated === true };
};

/** Despesas do grupo, uma página por vez (cursor por data e ID). */
export const useSplitBills = (groupId: string, enabled = true) => {
  const { activeWorkspace } = useWorkspace();
  const result = useInfiniteQuery({
    queryKey: SPLIT_KEYS.bills(activeWorkspace.id, groupId),
    enabled: enabled && isReady(activeWorkspace.id) && Boolean(groupId),
    initialPageParam: undefined as DatedCursor | undefined,
    queryFn: ({ pageParam }) => listSplitBills(activeWorkspace.id, groupId, pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  return { ...result, data: result.data?.pages.flatMap((page) => page.items) };
};

export const useSplitShares = (billId: string | null) => {
  const { activeWorkspace } = useWorkspace();
  const result = useQuery({
    queryKey: SPLIT_KEYS.shares(activeWorkspace.id, billId ?? ''),
    queryFn: () => listSplitShares(activeWorkspace.id, billId ?? ''),
    enabled: isReady(activeWorkspace.id) && Boolean(billId),
  });
  return { ...result, data: result.data?.items, isTruncated: result.data?.truncated === true };
};

/** Pedidos de reembolso do grupo, uma página por vez. */
export const useSplitReimbursements = (groupId: string, enabled = true) => {
  const { activeWorkspace } = useWorkspace();
  const result = useInfiniteQuery({
    queryKey: SPLIT_KEYS.reimbursements(activeWorkspace.id, groupId),
    enabled: enabled && isReady(activeWorkspace.id) && Boolean(groupId),
    initialPageParam: undefined as DatedCursor | undefined,
    queryFn: ({ pageParam }) => listSplitReimbursements(activeWorkspace.id, groupId, pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  return { ...result, data: result.data?.pages.flatMap((page) => page.items) };
};

export interface SplitMutationInput {
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * Mutação por callable. Depois do sucesso — e depois de falha que indica
 * outro estado no servidor — recarrega a Divisão de contas, o entitlement
 * (quota de grupos), cartões (compra lançada), contas e as telas do caixa
 * (despesa lançada ou estornada).
 */
const useSplitCallable = <TResult,>(
  call: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<TResult>,
) => {
  const { activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const workspaceId = activeWorkspace.id;
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: SPLIT_KEYS.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: ['credit_cards', workspaceId] }),
    invalidateTransactionDependents(queryClient, workspaceId),
  ]);
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: SplitMutationInput) =>
      call({ workspaceId, ...payload }, idempotencyKey),
    onSuccess: async () => {
      await refresh();
    },
    onError: async (error) => {
      if (splitErrorView(error).refresh) await refresh();
    },
  });
};

export const useCreateSplitGroup = () => useSplitCallable(splitCallables.createSplitGroup);
export const useUpdateSplitGroup = () => useSplitCallable(splitCallables.updateSplitGroup);
export const useArchiveSplitGroup = () => useSplitCallable(splitCallables.archiveSplitGroup);
export const useReactivateSplitGroup = () => useSplitCallable(splitCallables.reactivateSplitGroup);
export const useCreateSplitInvite = () => useSplitCallable(splitCallables.createSplitGroupInvite);
export const useRevokeSplitInvite = () => useSplitCallable(splitCallables.revokeSplitGroupInvite);
export const useAcceptSplitInvite = () => useSplitCallable(splitCallables.acceptSplitGroupInvite);
export const useAddWorkspaceSplitParticipant = () =>
  useSplitCallable(splitCallables.addWorkspaceSplitParticipant);
export const useAddExternalSplitParticipant = () =>
  useSplitCallable(splitCallables.addExternalSplitParticipant);
export const useDeactivateSplitParticipant = () =>
  useSplitCallable(splitCallables.deactivateSplitParticipant);
export const useCreateSplitBill = () => useSplitCallable(splitCallables.createSplitBill);
export const useUpdateSplitBill = () => useSplitCallable(splitCallables.updateSplitBill);
export const useVoidSplitBill = () => useSplitCallable(splitCallables.voidSplitBill);
export const useSettleSplitShare = () => useSplitCallable(splitCallables.settleSplitShare);
export const useReverseSplitShareSettlement = () =>
  useSplitCallable(splitCallables.reverseSplitShareSettlement);
export const useForgiveSplitShare = () => useSplitCallable(splitCallables.forgiveSplitShare);
export const useCreateSplitReimbursement = () =>
  useSplitCallable(splitCallables.createSplitReimbursement);
export const useApproveSplitReimbursement = () =>
  useSplitCallable(splitCallables.approveSplitReimbursement);
export const useRejectSplitReimbursement = () =>
  useSplitCallable(splitCallables.rejectSplitReimbursement);
export const useCancelSplitReimbursement = () =>
  useSplitCallable(splitCallables.cancelSplitReimbursement);
export const usePaySplitReimbursement = () => useSplitCallable(splitCallables.paySplitReimbursement);
export const useReverseReimbursementPayment = () =>
  useSplitCallable(splitCallables.reverseReimbursementPayment);

/** Chave aleatória da intenção (UUID; fora de contexto seguro, 128 bits do CSPRNG). */
export const newSplitIdempotencyKey = (): string => {
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
export const useSplitIntentKey = () => {
  const intentRef = useRef<IntentKey | null>(null);
  const keyFor = useCallback((operation: string, payload: Record<string, unknown>) => {
    const intent = resolveIntentKey(intentRef.current, operation, payload, newSplitIdempotencyKey);
    intentRef.current = intent;
    return intent.key;
  }, []);
  const reset = useCallback(() => {
    intentRef.current = null;
  }, []);
  return useMemo(() => ({ keyFor, reset }), [keyFor, reset]);
};
