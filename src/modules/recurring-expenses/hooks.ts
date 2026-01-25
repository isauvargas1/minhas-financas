
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from './api.ts';
import { RecurringExpense, RecurringOccurrence, RecurringStatus } from './types.ts';
import { useWorkspace } from '../../contexts/WorkspaceContext.tsx';

export const keys = {
    all: (ws: string) => ['recurringExpenses', ws],
    detail: (id: string, ws: string) => ['recurringExpense', id, ws],
    occurrences: (start: string, end: string, ws: string) => ['recurringOccurrences', start, end, ws],
};

// Expenses Hooks
export const useRecurringExpenses = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.all(activeWorkspace.id),
        queryFn: () => api.listRecurringExpenses(activeWorkspace.id),
        enabled: !!activeWorkspace.id
    });
};

export const useRecurringExpense = (id: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: keys.detail(id, activeWorkspace.id),
        queryFn: () => api.getRecurringExpense(id, activeWorkspace.id),
        enabled: !!id && !!activeWorkspace.id
    });
};

export const useCreateRecurringExpense = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (expense: RecurringExpense) => api.createRecurringExpense(expense, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all(activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: ['recurringOccurrences'] }); 
        }
    });
};

export const useUpdateRecurringExpense = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, data }: { id: string; data: Partial<RecurringExpense> }) => 
            api.updateRecurringExpense(id, data, activeWorkspace.id),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: keys.all(activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: keys.detail(data.id, activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: ['recurringOccurrences'] });
        }
    });
};

export const useDeleteRecurringExpense = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.deleteRecurringExpense(id, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keys.all(activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: ['recurringOccurrences'] });
        }
    });
};

export const useToggleRecurringStatus = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, status }: { id: string; status: RecurringStatus }) => 
            api.updateRecurringStatus(id, status, activeWorkspace.id),
        onSuccess: (_, variables) => {
            queryClient.invalidateQueries({ queryKey: keys.all(activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: keys.detail(variables.id, activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: ['recurringOccurrences'] });
        }
    });
};

// Occurrences Hooks
export const useRecurringOccurrences = (start: Date, end: Date) => {
    const { activeWorkspace } = useWorkspace();
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    return useQuery({
        queryKey: keys.occurrences(startStr, endStr, activeWorkspace.id),
        queryFn: () => api.listRecurringOccurrences(start, end, activeWorkspace.id),
        enabled: !!activeWorkspace.id
    });
};

export const useSaveOccurrence = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (occurrence: RecurringOccurrence) => api.saveOccurrence(occurrence, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['recurringOccurrences'] });
        }
    });
};
