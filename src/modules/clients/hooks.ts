import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
    listClients, createClient, updateClient, deleteClient,
    listReceivables, listReceivablesByClient, createReceivable, updateReceivable, deleteReceivable
} from './api';
import { Client, Receivable } from './types';
import { useWorkspace } from '../../contexts/WorkspaceContext';

export const KEYS = {
    clients: (ws: string) => ['clients', ws],
    receivables: (ws: string) => ['receivables', ws],
    clientReceivables: (ws: string, clientId: string) => ['receivables', ws, clientId],
};

// --- CLIENTS ---

export const useClients = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.clients(activeWorkspace.id),
        queryFn: () => listClients(activeWorkspace.id),
        enabled: !!activeWorkspace.id
    });
};

export const useCreateClient = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (client: Omit<Client, 'id'>) => createClient(client, activeWorkspace.id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.clients(activeWorkspace.id) })
    });
};

export const useUpdateClient = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (client: Client) => updateClient(client, activeWorkspace.id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.clients(activeWorkspace.id) })
    });
};

export const useDeleteClient = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (clientId: string) => deleteClient(clientId, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.clients(activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: KEYS.receivables(activeWorkspace.id) });
        }
    });
};

// --- RECEIVABLES ---

export const useReceivables = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.receivables(activeWorkspace.id),
        queryFn: () => listReceivables(activeWorkspace.id),
        enabled: !!activeWorkspace.id
    });
};

export const useClientReceivables = (clientId: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.clientReceivables(activeWorkspace.id, clientId),
        queryFn: () => listReceivablesByClient(clientId, activeWorkspace.id),
        enabled: !!activeWorkspace.id && !!clientId
    });
};

export const useCreateReceivable = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (receivable: Omit<Receivable, 'id'>) => createReceivable(receivable, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.receivables(activeWorkspace.id) });
        }
    });
};

export const useUpdateReceivable = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (receivable: Receivable) => updateReceivable(receivable, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.receivables(activeWorkspace.id) });
        }
    });
};

// ADICIONADO: Este é o hook que faltava
export const useUpdateReceivableStatus = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: (data: { id: string; status: 'pending' | 'paid' | 'overdue' | 'cancelled' }) => 
            // Usamos 'as any' aqui para reutilizar a função updateReceivable passando apenas o parcial
            updateReceivable({ id: data.id, status: data.status } as any, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.receivables(activeWorkspace.id) });
        }
    });
};

export const useDeleteReceivable = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => deleteReceivable(id, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.receivables(activeWorkspace.id) });
        }
    });
};