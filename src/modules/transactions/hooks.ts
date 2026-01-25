import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from "./api";
import type { Transaction } from "../../types";

export const useTransactions = (workspaceId: string) => {
  return useQuery({
    queryKey: ["transactions", workspaceId],
    queryFn: () => getTransactions(workspaceId),
    enabled: !!workspaceId,
    staleTime: 1000 * 60 * 5,
  });
};

export const useCreateTransaction = (workspaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (newTransaction: Omit<Transaction, "id">) =>
      createTransaction(workspaceId, newTransaction),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId] });
    },
  });
};

export const useUpdateTransaction = (workspaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (transaction: Transaction) =>
      updateTransaction(workspaceId, transaction),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId] });
    },
  });
};

export const useDeleteTransaction = (workspaceId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string | number) => deleteTransaction(workspaceId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["transactions", workspaceId] });
    },
  });
};
