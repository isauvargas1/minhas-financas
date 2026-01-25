
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from './api.ts';
import { Client, Receivable } from './types.ts';
import { useWorkspace } from "../../contexts/WorkspaceContext";


export const keys = {
    clients: (ws: string) => ['pjClients', ws],
    receivables: (ws: string) => ['pjReceivables', ws],
};

// --- CLIENTS ---

export const useClients = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.clients(activeWorkspace.id),
        queryFn: () => api.listClients(activeWorkspace.id),
        enabled: activeWorkspace.type === 'PJ' && !!activeWorkspace.id
    });
};

export const useCreateClient = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (client: Omit<Client, 'id' | 'createdAt' | 'workspaceId'>) => 
            api.createClient({ ...client, workspaceId: activeWorkspace.id }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.clients(activeWorkspace.id) });
        }
    });
};

export const useUpdateClient = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (client: Client) => api.updateClient(client),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.clients(activeWorkspace.id) });
        }
    });
};

export const useDeleteClient = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (clientId: string) => api.deleteClient(clientId, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.clients(activeWorkspace.id) });
        }
    });
};

// --- RECEIVABLES ---

export const useReceivables = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.receivables(activeWorkspace.id),
        queryFn: () => api.listReceivables(activeWorkspace.id),
        enabled: activeWorkspace.type === 'PJ' && !!activeWorkspace.id
    });
};

export const useCreateReceivable = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (data: Omit<Receivable, 'id' | 'createdAt' | 'workspaceId'>) => 
            api.createReceivable({ ...data, workspaceId: activeWorkspace.id }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.receivables(activeWorkspace.id) });
        }
    });
};

export const useUpdateReceivableStatus = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, status }: { id: string; status: Receivable['status'] }) => 
            api.updateReceivableStatus(id, status, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.receivables(activeWorkspace.id) });
        }
    });
};

export const useDeleteReceivable = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.deleteReceivable(id, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.receivables(activeWorkspace.id) });
        }
    });
};
