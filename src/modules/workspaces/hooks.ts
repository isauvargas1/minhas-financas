import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from './api';
import { Workspace, WorkspaceMember, WorkspaceRole, WorkspaceType } from './types';

export const keys = {
    all: ['workspaces'],
    members: (workspaceId: string) => ['workspaces', workspaceId, 'members']
};


export const useCreateWorkspace = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: { type: WorkspaceType; name: string; ownerId: string; email: string }) => 
            api.createWorkspace({ 
                type: input.type, 
                name: input.name, 
                ownerId: input.ownerId 
            }, input.email),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all });
        }
    });
};

// NOVOS HOOKS DE MEMBROS

export const useWorkspaceMembers = (workspaceId: string) => {
    return useQuery({
        queryKey: keys.members(workspaceId),
        queryFn: () => api.listWorkspaceMembers(workspaceId),
        enabled: !!workspaceId
    });
};

export const useAddMember = (workspaceId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (member: WorkspaceMember) => api.addMember(workspaceId, member),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.members(workspaceId) });
        }
    });
};

export const useUpdateMemberRole = (workspaceId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ memberId, role }: { memberId: string, role: WorkspaceRole }) => 
            api.updateMemberRole(workspaceId, memberId, role),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.members(workspaceId) });
        }
    });
};

export const useRemoveMember = (workspaceId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (memberId: string) => api.removeMember(workspaceId, memberId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.members(workspaceId) });
        }
    });
};

export const useUpdateWorkspace = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (workspace: Workspace) => api.updateWorkspace(workspace.id, workspace),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all });
        }
    });
};