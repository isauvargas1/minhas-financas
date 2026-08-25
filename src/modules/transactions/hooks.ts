import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTransaction,
  createTransactionsBatch,
  deleteTransaction,
  getFullTransactionHistory,
  getTransactions,
  listInvestmentTransactions,
  updateTransaction,
  type TransactionPage
} from "./api";
import type { Transaction } from "../../types";

const transactionKey = (workspaceId: string) => ["transactions", workspaceId] as const;
const goalKey = (workspaceId: string) => ["goals", workspaceId] as const;
const isWorkspaceReady = (workspaceId: string) => !!workspaceId && workspaceId !== "loading";

const invalidateTransactionDependents = async (
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string
) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: transactionKey(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: ["transactions-full-history", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["investment-transactions", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["cash-periods", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: goalKey(workspaceId) })
  ]);
};

/**
 * Janela padrão de transações (INV-P1-011).
 *
 * A carga do aplicativo lia a subcoleção inteira. Agora lê os últimos doze
 * meses, paginados por `transactionDate` no servidor — janela que cobre tudo
 * que o produto consulta sem pedido explícito do usuário.
 */
export const useTransactions = (workspaceId: string) => {
  return useQuery({
    queryKey: transactionKey(workspaceId),
    queryFn: () => getTransactions(workspaceId),
    enabled: isWorkspaceReady(workspaceId),
    staleTime: 1000 * 60 * 5
  });
};

/**
 * Histórico completo, sob pedido explícito.
 *
 * Só é carregado quando o usuário escolhe a faixa "tudo" do relatório. Volta
 * marcado com `truncated` quando o teto de páginas é atingido, para que a tela
 * possa avisar em vez de apresentar um agregado incompleto como total.
 */
export const useFullTransactionHistory = (
  workspaceId: string,
  enabled: boolean,
) =>
  useQuery<TransactionPage>({
    queryKey: ["transactions-full-history", workspaceId],
    queryFn: () => getFullTransactionHistory(workspaceId),
    enabled: enabled && isWorkspaceReady(workspaceId),
    staleTime: 1000 * 60 * 5
  });

/**
 * Universo de transações de investimento, para vínculo retroativo de meta e
 * para escolher a origem de um resgate.
 *
 * Consulta específica por propósito, carregada só quando o formulário
 * correspondente está aberto.
 */
export const useInvestmentTransactions = (
  workspaceId: string,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ["investment-transactions", workspaceId],
    queryFn: () => listInvestmentTransactions(workspaceId),
    enabled: enabled && isWorkspaceReady(workspaceId),
    staleTime: 1000 * 60 * 2
  });

export const useCreateTransaction = (workspaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (newTransaction: Omit<Transaction, "id">) =>
      createTransaction(workspaceId, newTransaction),
    onSuccess: async () => {
      await invalidateTransactionDependents(queryClient, workspaceId);
    }
  });
};

export const useCreateTransactionsBatch = (workspaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (newTransactions: Omit<Transaction, "id">[]) =>
      createTransactionsBatch(workspaceId, newTransactions),
    onSuccess: async () => {
      await invalidateTransactionDependents(queryClient, workspaceId);
    }
  });
};

export const useUpdateTransaction = (workspaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (transaction: Transaction) =>
      updateTransaction(workspaceId, transaction),
    onSuccess: async () => {
      await invalidateTransactionDependents(queryClient, workspaceId);
    }
  });
};

export const useDeleteTransaction = (workspaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (transaction: Transaction) => deleteTransaction(workspaceId, transaction),
    onSuccess: async () => {
      await invalidateTransactionDependents(queryClient, workspaceId);
    }
  });
};
