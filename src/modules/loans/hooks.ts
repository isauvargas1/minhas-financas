import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listLoans, createLoan, updateLoan, deleteLoan, listMovements, createMovement, getLoan } from './api';
import { Loan, LoanMovement } from './types';
import { useWorkspace } from '../../contexts/WorkspaceContext';

export const KEYS = {
    allLoans: (ws: string) => ['loans', ws],
    loan: (ws: string, id: string) => ['loans', ws, id],
    movements: (ws: string, loanId: string) => ['loan_movements', ws, loanId],
};

// --- LOANS ---

export const useLoans = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.allLoans(activeWorkspace.id),
        queryFn: () => listLoans(activeWorkspace.id),
        enabled: !!activeWorkspace.id
    });
};

export const useCreateLoan = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: (loan: Loan) => createLoan(loan, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.allLoans(activeWorkspace.id) });
        }
    });
};

export const useLoan = (loanId: string | null) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.loan(activeWorkspace.id, loanId || ''),
        queryFn: () => getLoan(loanId!, activeWorkspace.id),
        enabled: !!activeWorkspace.id && !!loanId
    });
};

export const useUpdateLoan = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: (loan: Loan) => updateLoan(loan, activeWorkspace.id),
        onSuccess: (data) => {
            queryClient.invalidateQueries({ queryKey: KEYS.allLoans(activeWorkspace.id) });
            // Se houver detalhes abertos, também invalidaria, mas react-query cuida disso se usarmos a mesma key
        }
    });
};

export const useDeleteLoan = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: (id: string) => deleteLoan(id, activeWorkspace.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: KEYS.allLoans(activeWorkspace.id) });
        }
    });
};

// --- MOVEMENTS ---

export const useLoanMovements = (loanId: string) => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.movements(activeWorkspace.id, loanId),
        queryFn: () => listMovements(loanId, activeWorkspace.id),
        enabled: !!activeWorkspace.id && !!loanId
    });
};

export const useCreateMovement = () => {
    const { activeWorkspace } = useWorkspace();
    const queryClient = useQueryClient();
    
    return useMutation({
        mutationFn: (movement: LoanMovement) => createMovement(movement, activeWorkspace.id),
        onSuccess: (_, variables) => {
            // Invalida a lista de movimentos desse empréstimo
            queryClient.invalidateQueries({ queryKey: KEYS.movements(activeWorkspace.id, variables.loanId) });
            // Invalida a lista de empréstimos também (para atualizar saldo/status na tabela)
            queryClient.invalidateQueries({ queryKey: KEYS.allLoans(activeWorkspace.id) });
        }
    });
};