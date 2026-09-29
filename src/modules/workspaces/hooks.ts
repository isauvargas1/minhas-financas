import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QueryDocumentSnapshot } from 'firebase/firestore';
import * as api from './api';
import type { WorkspaceType } from './types';

export const keys = {
    all: ['workspaces'],
    members: (workspaceId: string) => ['workspaces', workspaceId, 'members']
};

export const useCreateWorkspace = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (input: { type: WorkspaceType; name: string; cnpj?: string }) => {
            // O backend devolve o workspace já provisionado (cadastros padrão
            // na mesma transação da criação).
            const { workspaceId } = await api.createWorkspace({
                type: input.type,
                name: input.name,
                cnpj: input.cnpj,
            });
            return { id: workspaceId };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all });
        }
    });
};

/**
 * Membros ativos, página a página (cursor). Só a primeira página é lida ao
 * abrir; `loadMore` busca a seguinte quando `hasMore` indica que ela existe.
 */
export const useWorkspaceMembers = (workspaceId: string) => {
    const query = useInfiniteQuery({
        queryKey: keys.members(workspaceId),
        queryFn: ({ pageParam }) => api.listWorkspaceMembersPage(workspaceId, pageParam),
        initialPageParam: null as QueryDocumentSnapshot | null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: !!workspaceId && workspaceId !== 'loading'
    });
    return {
        data: query.data?.pages.flatMap((page) => page.items),
        isLoading: query.isLoading,
        hasMore: query.hasNextPage,
        isLoadingMore: query.isFetchingNextPage,
        loadMore: () => query.fetchNextPage(),
    };
};

export const useInviteMember = (workspaceId: string) => {
    return useMutation({
        mutationFn: ({ email, role }: { email: string; role: api.InvitableRole }) =>
            api.inviteWorkspaceMember(workspaceId, email, role),
    });
};

export const useUpdateMemberRole = (workspaceId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ memberId, role }: { memberId: string; role: api.InvitableRole }) =>
            api.changeWorkspaceMemberRole(workspaceId, memberId, role),
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: keys.members(workspaceId) });
        }
    });
};

export const useTransferOwnership = (workspaceId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (newOwnerId: string) =>
            api.transferWorkspaceOwnership(workspaceId, newOwnerId),
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: keys.members(workspaceId) });
        }
    });
};

export const useRemoveMember = (workspaceId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (memberId: string) => api.removeWorkspaceMember(workspaceId, memberId),
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: keys.members(workspaceId) });
        }
    });
};

export const useUpdateWorkspaceSettings = (workspaceId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (settings: api.WorkspaceSettingsInput) =>
            api.updateWorkspaceSettings(workspaceId, settings),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all });
        }
    });
};
