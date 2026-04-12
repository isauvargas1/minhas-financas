import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import {
  createSettingsCatalogItem,
  deleteSettingsCatalogItem,
  listSettingsCatalog,
  updateSettingsCatalogItem
} from './api';
import { filterSettingsCatalogItems } from './utils';
import type {
  SettingsCatalogCreateInput,
  SettingsCatalogGroup,
  SettingsCatalogListFilters,
  SettingsCatalogUpdateInput
} from './types';

export const SETTINGS_CATALOG_KEYS = {
  root: ['settingsCatalog'] as const,
  workspace: (workspaceId: string) => ['settingsCatalog', workspaceId] as const,
  list: (workspaceId: string) => ['settingsCatalog', workspaceId, 'list'] as const
};

const invalidateSettingsCatalogCache = async (
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId?: string
) => {
  if (!isWorkspaceReady(workspaceId)) return;

  await queryClient.cancelQueries({
    queryKey: SETTINGS_CATALOG_KEYS.workspace(workspaceId)
  });

  await queryClient.invalidateQueries({
    queryKey: SETTINGS_CATALOG_KEYS.workspace(workspaceId),
    refetchType: 'active'
  });
};

const isWorkspaceReady = (workspaceId?: string) =>
  !!workspaceId && workspaceId !== 'loading';

export const useSettingsCatalog = (
  filters: SettingsCatalogListFilters = {}
) => {
  const { activeWorkspace } = useWorkspace();

  return useQuery({
  queryKey: SETTINGS_CATALOG_KEYS.list(activeWorkspace.id),
  queryFn: () => listSettingsCatalog(activeWorkspace.id),
  enabled: isWorkspaceReady(activeWorkspace.id),
  staleTime: 1000 * 60 * 5,
  retry: 1,
  refetchOnWindowFocus: false,
  select: (items) => filterSettingsCatalogItems(items, filters)
});
};

export const useSettingsCatalogGroup = (
  group: SettingsCatalogGroup,
  filters: Omit<SettingsCatalogListFilters, 'group'> = {}
) => {
  return useSettingsCatalog({
    ...filters,
    group
  });
};

export const useCreateSettingsCatalogItem = () => {
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SettingsCatalogCreateInput) =>
      createSettingsCatalogItem(input, activeWorkspace.id, user?.uid),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SETTINGS_CATALOG_KEYS.all(activeWorkspace.id)
      });
    }
  });
};

export const useUpdateSettingsCatalogItem = () => {
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data
    }: {
      id: string;
      data: SettingsCatalogUpdateInput;
    }) =>
      updateSettingsCatalogItem(id, data, activeWorkspace.id, user?.uid),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SETTINGS_CATALOG_KEYS.all(activeWorkspace.id)
      });
    }
  });
};

export const useDeleteSettingsCatalogItem = () => {
  const { activeWorkspace } = useWorkspace();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      deleteSettingsCatalogItem(id, activeWorkspace.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: SETTINGS_CATALOG_KEYS.all(activeWorkspace.id)
      });
    }
  });
};