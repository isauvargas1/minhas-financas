import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import {
  createSettingsCatalogItem,
  deleteSettingsCatalogItem,
  listSettingsCatalog,
  listSettingsCatalogPage,
  updateSettingsCatalogItem,
} from './api';
import { filterSettingsCatalogItems } from './utils';
import type {
  SettingsCatalogCreateInput,
  SettingsCatalogGroup,
  SettingsCatalogListFilters,
  SettingsCatalogPageCursor,
  SettingsCatalogUpdateInput,
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

export const useCreateSettingsCatalogItem = () => {
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SettingsCatalogCreateInput) => {
      if (!isWorkspaceReady(activeWorkspace?.id)) {
        return Promise.reject(new Error('Workspace ativo não encontrado.'));
      }

      return createSettingsCatalogItem(input, activeWorkspace.id, user?.uid);
    },
    onSuccess: async () => {
      await invalidateSettingsCatalogCache(queryClient, activeWorkspace?.id);
    },
  });
};

export const useUpdateSettingsCatalogItem = () => {
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: SettingsCatalogUpdateInput;
    }) => {
      if (!isWorkspaceReady(activeWorkspace?.id)) {
        return Promise.reject(new Error('Workspace ativo não encontrado.'));
      }

      return updateSettingsCatalogItem(id, data, activeWorkspace.id, user?.uid);
    },
    onSuccess: async () => {
      await invalidateSettingsCatalogCache(queryClient, activeWorkspace?.id);
    },
  });
};

export const useDeleteSettingsCatalogItem = () => {
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => {
      if (!isWorkspaceReady(activeWorkspace?.id)) {
        return Promise.reject(new Error('Workspace ativo não encontrado.'));
      }

      return deleteSettingsCatalogItem(id, activeWorkspace.id, user?.uid);
    },
    onSuccess: async () => {
      await invalidateSettingsCatalogCache(queryClient, activeWorkspace?.id);
    },
  });
};
