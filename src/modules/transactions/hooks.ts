import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getTransactions, createTransaction, updateTransaction, deleteTransaction } from './api';
import { Transaction } from '../../../types';

export const useTransactions = (workspaceId: string) => {
    return useQuery({
        queryKey: ['transactions', workspaceId],
        queryFn: () => getTransactions(workspaceId),
        enabled: !!workspaceId, // Só busca se tiver ID
        staleTime: 1000 * 60 * 5, // Cache de 5 minutos
    });
};

export const useCreateTransaction = (workspaceId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (newTransaction: Omit<Transaction, 'id'>) => 
            createTransaction({ ...newTransaction, workspaceId, userId: newTransaction.userId }), 
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transactions', workspaceId] });
        }
    });
};

export const useUpdateTransaction = (workspaceId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: updateTransaction,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transactions', workspaceId] });
        }
    });
};

export const useDeleteTransaction = (workspaceId: string) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: deleteTransaction,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['transactions', workspaceId] });
        }
    });
};