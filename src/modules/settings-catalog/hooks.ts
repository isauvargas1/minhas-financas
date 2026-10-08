import { useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useWorkspace } from '../../contexts/WorkspaceContext';
import { resolveIntentKey, type IntentKey } from '../transactions/cashEntry';
import {
  listSettingsCatalog,
  listSettingsCatalogPage,
  settingsCatalogCallables,
} from './api';
import { settingsCatalogErrorView } from './callables';
import { filterSettingsCatalogItems } from './utils';
import type {
  SettingsCatalogGroup,
  SettingsCatalogListFilters,
  SettingsCatalogPageCursor,
} from './types';

export const SETTINGS_CATALOG_KEYS = {
  root: ['settingsCatalog'] as const,
  workspace: (workspaceId: string) => ['settingsCatalog', workspaceId] as const,
  list: (workspaceId: string) => ['settingsCatalog', workspaceId, 'list'] as const,
};

const isWorkspaceReady = (workspaceId?: string): workspaceId is string =>
  Boolean(workspaceId) && workspaceId !== 'loading';

const invalidateSettingsCatalogCache = async (
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId?: string,
) => {
  if (!isWorkspaceReady(workspaceId)) return;

  await queryClient.cancelQueries({
    queryKey: SETTINGS_CATALOG_KEYS.workspace(workspaceId),
  });

  await queryClient.invalidateQueries({
    queryKey: SETTINGS_CATALOG_KEYS.workspace(workspaceId),
    refetchType: 'active',
  });
};

export const useSettingsCatalog = (
  filters: SettingsCatalogListFilters = {},
) => {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;

  return useQuery({
    queryKey: isWorkspaceReady(workspaceId)
      ? SETTINGS_CATALOG_KEYS.list(workspaceId)
      : SETTINGS_CATALOG_KEYS.root,
    queryFn: () => {
      if (!isWorkspaceReady(workspaceId)) {
        return Promise.resolve([]);
      }

      return listSettingsCatalog(workspaceId);
    },
    enabled: isWorkspaceReady(workspaceId),
    staleTime: 1000 * 60 * 5,
    retry: 1,
    refetchOnWindowFocus: false,
    select: (items) => filterSettingsCatalogItems(items, filters),
  });
};

export const useSettingsCatalogGroup = (
  group: SettingsCatalogGroup,
  filters: Omit<SettingsCatalogListFilters, 'group'> = {},
) => {
  return useSettingsCatalog({
    ...filters,
    group,
  });
};

export const useSettingsCatalogPage = (
  filters: SettingsCatalogListFilters,
  cursor: SettingsCatalogPageCursor | null,
) => {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;

  return useQuery({
    queryKey: isWorkspaceReady(workspaceId)
      ? [...SETTINGS_CATALOG_KEYS.workspace(workspaceId), 'page', filters, cursor]
      : SETTINGS_CATALOG_KEYS.root,
    queryFn: () => listSettingsCatalogPage(workspaceId, filters, cursor),
    enabled: isWorkspaceReady(workspaceId) && Boolean(filters.group),
    staleTime: 1000 * 60 * 5,
    retry: 1,
    refetchOnWindowFocus: false,
  });
};

export interface SettingsCatalogMutationInput {
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * Mutação por callable (D-23). Depois do sucesso recarrega o catálogo do
 * workspace — a lista de Cadastros e os seletores de todos os formulários —;
 * depois de falha que indica outro estado no servidor (versão antiga, nome
 * já reservado, item removido da lista), também.
 */
const useSettingsCatalogCallable = (
  call: (payload: Record<string, unknown>, idempotencyKey: string) => Promise<unknown>,
) => {
  const { activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const workspaceId = activeWorkspace?.id;
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: SettingsCatalogMutationInput) =>
      call(payload, idempotencyKey),
    onSuccess: async () => {
      await invalidateSettingsCatalogCache(queryClient, workspaceId);
    },
    onError: async (error) => {
      if (settingsCatalogErrorView(error).refresh) {
        await invalidateSettingsCatalogCache(queryClient, workspaceId);
      }
    },
  });
};

export const useCreateSettingsCatalogItem = () =>
  useSettingsCatalogCallable(settingsCatalogCallables.createSettingsCatalogItem);
export const useUpdateSettingsCatalogItem = () =>
  useSettingsCatalogCallable(settingsCatalogCallables.updateSettingsCatalogItem);
export const useArchiveSettingsCatalogItem = () =>
  useSettingsCatalogCallable(settingsCatalogCallables.archiveSettingsCatalogItem);

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
export const useCatalogIntentKey = () => {
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
