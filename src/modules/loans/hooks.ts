import {
    useInfiniteQuery,
    useMutation,
    useQuery,
    useQueryClient,
} from '@tanstack/react-query';
import {
    listLoans,
    createLoan,
    updateLoan,
    deleteLoan,
    listMovements,
    createMovement,
    getLoan,
    getLoanTotals,
    type LoanMovementCursor,
} from './api';
import { Loan, LoanMovement } from './types';
import { useWorkspace } from '../../contexts/WorkspaceContext';

export const KEYS = {
    allLoans: (ws: string) => ['loans', ws],
    loanTotals: (ws: string) => ['loans', ws, 'totals'],
    loan: (ws: string, id: string) => ['loans', ws, id],
    movements: (ws: string, loanId: string) => ['loan_movements', ws, loanId],
};

// --- LOANS ---

/**
 * Empréstimos, uma página por vez.
 *
 * `data` continua sendo o array de contratos já carregados, para que as telas
 * não precisem conhecer a paginação para renderizar. Quem quiser oferecer
 * "carregar mais" usa `hasNextPage`/`fetchNextPage`.
 */
export const useLoans = () => {
    const { activeWorkspace } = useWorkspace();
    const queryResult = useInfiniteQuery({
        queryKey: KEYS.allLoans(activeWorkspace.id),
        enabled: !!activeWorkspace.id,
        initialPageParam: undefined as string | undefined,
        queryFn: ({ pageParam }) => listLoans(activeWorkspace.id, { cursor: pageParam }),
        getNextPageParam: (lastPage) =>
            lastPage.hasMore ? lastPage.nextCursor : undefined,
    });
    return {
        ...queryResult,
        data: queryResult.data?.pages.flatMap((page) => page.items),
    };
};

/**
 * Totais dos contratos, do servidor.
 *
 * Separado da listagem de propósito: as telas mostram saldo a receber, saldo a
 * pagar e atrasados, e esses números precisam cobrir **todos** os contratos,
 * não só a página carregada.
 */
export const useLoanTotals = () => {
    const { activeWorkspace } = useWorkspace();
    return useQuery({
        queryKey: KEYS.loanTotals(activeWorkspace.id),
        queryFn: () => getLoanTotals(activeWorkspace.id),
        enabled: !!activeWorkspace.id,
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

/**
 * Movimentações de um contrato, paginadas e já ordenadas pelo servidor.
 *
 * A ordenação era feita em memória sobre o histórico inteiro do contrato.
 * Agora o servidor ordena e corta, e a tela pede a próxima página.
 */
export const useLoanMovements = (loanId: string) => {
    const { activeWorkspace } = useWorkspace();
    const queryResult = useInfiniteQuery({
        queryKey: KEYS.movements(activeWorkspace.id, loanId),
        enabled: !!activeWorkspace.id && !!loanId,
        initialPageParam: undefined as LoanMovementCursor | undefined,
        queryFn: ({ pageParam }) =>
            listMovements(loanId, activeWorkspace.id, { cursor: pageParam }),
        getNextPageParam: (lastPage) =>
            lastPage.hasMore ? lastPage.nextCursor : undefined,
    });
    return {
        ...queryResult,
        data: queryResult.data?.pages.flatMap((page) => page.items),
    };
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