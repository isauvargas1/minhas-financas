
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from './api.ts';
import { Loan, LoanMovement } from './types.ts';
import { useWorkspace } from '../../WorkspaceContext.tsx';

export const loanKeys = {
    all: (profileId: string) => ['loans', profileId],
    detail: (id: string) => ['loan', id],
    movements: (loanId: string) => ['loanMovements', loanId]
};

export const useLoans = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: loanKeys.all(activeWorkspace.id),
        queryFn: () => api.listLoans(activeWorkspace.id),
        enabled: !!activeWorkspace.id
    });
};

export const useLoan = (id: string) => {
    return useQuery({
        queryKey: loanKeys.detail(id),
        queryFn: () => api.getLoan(id),
        enabled: !!id
    });
};

export const useLoanMovements = (loanId: string) => {
    return useQuery({
        queryKey: loanKeys.movements(loanId),
        queryFn: () => api.listMovements(loanId),
        enabled: !!loanId
    });
};

export const useCreateLoan = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: api.createLoan,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: loanKeys.all(activeWorkspace.id) });
        }
    });
};

export const useUpdateLoan = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: api.updateLoan,
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: loanKeys.all(activeWorkspace.id) });
            queryClient.invalidateQueries({ queryKey: loanKeys.detail(data.id) });
        }
    });
};

export const useDeleteLoan = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: api.deleteLoan,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: loanKeys.all(activeWorkspace.id) });
        }
    });
};

export const useCreateMovement = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: api.createMovement,
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: loanKeys.movements(data.loanId) });
            queryClient.invalidateQueries({ queryKey: loanKeys.detail(data.loanId) });
        }
    });
};
