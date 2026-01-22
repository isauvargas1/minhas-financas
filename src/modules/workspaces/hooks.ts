
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from './api.ts';
import { Workspace, WorkspaceType } from './types.ts';

export const keys = {
    all: ['workspaces'],
};

export const useUpdateWorkspace = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (workspace: Workspace) => api.updateWorkspace(workspace),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all });
        }
    });
};

export const useCreateWorkspace = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: { type: WorkspaceType; name: string; cnpj?: string }) => 
            api.createWorkspace(input),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all });
        }
    });
};
