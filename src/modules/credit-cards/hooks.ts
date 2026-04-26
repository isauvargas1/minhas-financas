import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listCreditCards, createCreditCard, updateCreditCard, deleteCreditCard } from './api';
import {
    createCreditCardPurchase,
    type CreateCreditCardPurchaseFrontendInput,
} from './purchasesApi';
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
        enabled: !!activeWorkspace.id && activeWorkspace.id !== 'loading'
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

const isWorkspaceReady = (workspaceId?: string): workspaceId is string =>
    Boolean(workspaceId) && workspaceId !== 'loading';

export const useCreateCreditCardPurchaseDomain = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (
            input: Omit<CreateCreditCardPurchaseFrontendInput, 'workspaceId'>
        ) => {
            if (!isWorkspaceReady(activeWorkspace?.id)) {
                return Promise.reject(new Error('Workspace ativo não encontrado.'));
            }

            return createCreditCardPurchase({
                ...input,
                workspaceId: activeWorkspace.id,
            });
        },
        onSuccess: async () => {
            if (!isWorkspaceReady(activeWorkspace?.id)) return;

            await Promise.all([
                queryClient.invalidateQueries({ queryKey: KEYS.all(activeWorkspace.id) }),
                queryClient.invalidateQueries({
                    queryKey: ['creditCardInvoiceTransactionProjections', activeWorkspace.id],
                }),
            ]);
        },
    });
};