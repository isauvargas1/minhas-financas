import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createTransaction,
  createTransactionsBatch,
  deleteTransaction,
  getTransactions,
  updateTransaction
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
    queryClient.invalidateQueries({ queryKey: goalKey(workspaceId) })
  ]);
};

export const useTransactions = (workspaceId: string) => {
  return useQuery({
    queryKey: transactionKey(workspaceId),
    queryFn: () => getTransactions(workspaceId),
    enabled: isWorkspaceReady(workspaceId),
    staleTime: 1000 * 60 * 5
  });
};

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
