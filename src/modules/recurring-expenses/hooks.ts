
import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import * as api from './api.ts';
import { RecurringExpense, RecurringOccurrence, RecurringStatus } from './types.ts';
import { useWorkspace } from '../../contexts/WorkspaceContext.tsx';

export const keys = {
    all: (ws: string) => ['recurringExpenses', ws],
    active: (ws: string) => ['recurringExpenses', ws, 'active'],
    detail: (id: string, ws: string) => ['recurringExpense', id, ws],
    occurrences: (start: string, end: string, ws: string) => ['recurringOccurrences', start, end, ws],
};

// Expenses Hooks
/**
 * Assinaturas, uma página por vez.
 *
 * `data` continua sendo o array já carregado; `hasNextPage`/`fetchNextPage`
 * existem para a tela oferecer "carregar mais".
 */
export const useRecurringExpenses = () => {
    const { activeWorkspace } = useWorkspace();
    const queryResult = useInfiniteQuery({
        queryKey: keys.all(activeWorkspace.id),
        enabled: !!activeWorkspace.id,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) =>
            api.listRecurringExpenses(activeWorkspace.id, { cursor: pageParam }),
        getNextPageParam: (lastPage) =>
            lastPage.hasMore ? lastPage.nextCursor : undefined,
    });
    return {
        ...queryResult,
        data: queryResult.data?.pages.flatMap((page) => page.items),
    };
};

/**
 * Assinaturas ativas, para os resumos.
 *
 * Consulta própria e filtrada no servidor: o resumo não depende de quantas
 * páginas da listagem já foram carregadas, e não paga pelas pausadas e
 * canceladas que não entram em conta nenhuma.
 */
export const useActiveRecurringExpenses = () => {
    const { activeWorkspace } = useWorkspace();
    const queryResult = useQuery({
        queryKey: keys.active(activeWorkspace.id),
        queryFn: () => api.listActiveRecurringExpenses(activeWorkspace.id),
        enabled: !!activeWorkspace.id,
    });
    return {
        ...queryResult,
        data: queryResult.data?.items,
        isTruncated: queryResult.data?.truncated === true,
    };
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
export const useRecurringOccurrences = (start: Date, end: Date, expenseId?: string) => {
    const { activeWorkspace } = useWorkspace();
    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];

    return useQuery({
        queryKey: [
            ...keys.occurrences(startStr, endStr, activeWorkspace.id),
            expenseId ?? 'all',
        ],
        queryFn: () =>
            api.listRecurringOccurrences(start, end, activeWorkspace.id, undefined, expenseId),
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
