
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from './api.ts';
import { RecurringExpense, RecurringOccurrence, RecurringStatus } from './types.ts';

export const keys = {
    all: ['recurringExpenses'],
    detail: (id: string) => ['recurringExpense', id],
    occurrences: (start: string, end: string) => ['recurringOccurrences', start, end],
};

// Expenses Hooks
export const useRecurringExpenses = () => {
    return useQuery({
        queryKey: keys.all,
        queryFn: api.listRecurringExpenses
    });
};

export const useRecurringExpense = (id: string) => {
    return useQuery({
        queryKey: keys.detail(id),
        queryFn: () => api.getRecurringExpense(id),
        enabled: !!id
    });
};

export const useCreateRecurringExpense = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: api.createRecurringExpense,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all });
            queryClient.invalidateQueries({ queryKey: ['recurringOccurrences'] }); // Refresh calendar/list
        }
    });
};

export const useUpdateRecurringExpense = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<RecurringExpense> }) => 
            api.updateRecurringExpense(id, data),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: keys.all });
            queryClient.invalidateQueries({ queryKey: keys.detail(data.id) });
            queryClient.invalidateQueries({ queryKey: ['recurringOccurrences'] });
        }
    });
};

export const useDeleteRecurringExpense = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: api.deleteRecurringExpense,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all });
            queryClient.invalidateQueries({ queryKey: ['recurringOccurrences'] });
        }
    });
};

export const useToggleRecurringStatus = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, status }: { id: string; status: RecurringStatus }) => 
            api.updateRecurringStatus(id, status),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: keys.all });
            queryClient.invalidateQueries({ queryKey: keys.detail(variables.id) });
            queryClient.invalidateQueries({ queryKey: ['recurringOccurrences'] });
        }
    });
};

// Occurrences Hooks
export const useRecurringOccurrences = (start: Date, end: Date) => {
    // Format dates to string for stable query keys
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    return useQuery({
        queryKey: keys.occurrences(startStr, endStr),
        queryFn: () => api.listRecurringOccurrences(start, end)
    });
};

export const useSaveOccurrence = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: api.saveOccurrence,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recurringOccurrences'] });
        }
    });
};
