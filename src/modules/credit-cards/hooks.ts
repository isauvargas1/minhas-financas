import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listCreditCards, createCreditCard, updateCreditCard, deleteCreditCard } from './api';
import { CreditCard } from '../../types';
import { useWorkspace } from '../../contexts/WorkspaceContext';

export const KEYS = {
    all: (ws: string) => ['creditCards', ws],
};

export const useCreditCards = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.all(activeWorkspace.id),
        queryFn: () => listCreditCards(activeWorkspace.id),
        enabled: !!activeWorkspace.id
    });
};

export const useCreateCreditCard = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: (card: Omit<CreditCard, 'id'>) => createCreditCard(card, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) });
        }
    });
};

export const useUpdateCreditCard = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<CreditCard> }) => 
            updateCreditCard(id, data, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) });
        }
    });
};

export const useDeleteCreditCard = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: (id: string) => deleteCreditCard(id, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) });
        }
    });
};