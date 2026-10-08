import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getFullTransactionHistory,
  getTransactions,
  type TransactionPage
} from "./api";
import { billingKeys } from "../billing/queryKeys";
import {
  confirmCashTransaction,
  createCashTransaction,
  updateCashTransaction,
  voidCashTransaction,
} from "./cashApi";
import { cashRefreshScope } from "./cashEntry";

const transactionKey = (workspaceId: string) => ["transactions", workspaceId] as const;
const goalKey = (workspaceId: string) => ["goals", workspaceId] as const;
const isWorkspaceReady = (workspaceId: string) => !!workspaceId && workspaceId !== "loading";

/**
 * Telas que dependem dos lançamentos (lista, histórico, projeção de caixa,
 * contas e metas). Exportada para os domínios cujo backend grava
 * espelho de caixa (empréstimos, P3-H) recarregarem as mesmas telas.
 */
export const invalidateTransactionDependents = async (
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string
) => {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: transactionKey(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: ["transactions-full-history", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["cash-periods", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: goalKey(workspaceId) }),
    // P3-J (D-30): saldos e extratos das contas movem no mesmo commit.
    queryClient.invalidateQueries({ queryKey: ["cash_accounts", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["cash_account_movements", workspaceId] })
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
  const queryResult = useQuery({
    queryKey: transactionKey(workspaceId),
    queryFn: () => getTransactions(workspaceId),
    enabled: isWorkspaceReady(workspaceId),
    staleTime: 1000 * 60 * 5
  });
  return {
    ...queryResult,
    data: queryResult.data?.items,
    /** A janela bateu no teto de páginas: os agregados não cobrem tudo. */
    isTruncated: queryResult.data?.truncated === true,
  };
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
 * Lançamento manual confirmado pelas callables autoritativas (P3-E).
 *
 * Nenhuma escrita local no Firestore: o servidor grava, audita e consome a
 * quota; aqui só se invalidam as consultas que dependem do resultado —
 * inclusive o entitlement do workspace, que traz o uso mensal da quota.
 * Recusa do servidor sobe para quem chamou: não há caminho alternativo de
 * escrita no cliente (as Rules negam toda escrita em `transactions`).
 */
interface CashMutationInput {
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

/*
 * As três operações de caixa invalidam a lista, os dependentes e a quota no
 * sucesso e, na falha, conforme `cashRefreshScope`: um conflito, um "já
 * anulado" ou um resultado incerto significam que o servidor pode ter um
 * estado diferente do exibido; a quota esgotada atualiza só o indicador. O
 * formulário aberto mantém a versão que leu (o reenvio continua com a mesma
 * intenção e o conflito continua visível); reabrir carrega a versão atual.
 */
const invalidateCashDependents = async (
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
) => {
  await Promise.all([
    invalidateTransactionDependents(queryClient, workspaceId),
    queryClient.invalidateQueries({ queryKey: billingKeys.workspaceEntitlementPrefix }),
  ]);
};

const refreshAfterCashFailure = async (
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  error: unknown,
) => {
  const scope = cashRefreshScope(error);
  if (scope === 'state') await invalidateCashDependents(queryClient, workspaceId);
  if (scope === 'quota') {
    await queryClient.invalidateQueries({ queryKey: billingKeys.workspaceEntitlementPrefix });
  }
};

export const useCreateCashTransaction = (workspaceId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: CashMutationInput) =>
      createCashTransaction(payload, idempotencyKey),
    onSuccess: async () => {
      await invalidateCashDependents(queryClient, workspaceId);
    },
    onError: async (error) => {
      await refreshAfterCashFailure(queryClient, workspaceId, error);
    }
  });
};

export const useUpdateCashTransaction = (workspaceId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: CashMutationInput) =>
      updateCashTransaction(payload, idempotencyKey),
    onSuccess: async () => {
      await invalidateCashDependents(queryClient, workspaceId);
    },
    onError: async (error) => {
      await refreshAfterCashFailure(queryClient, workspaceId, error);
    }
  });
};

/** Confirmação de pendente (P3-F, D-29): data efetiva e valor liquidado. */
export const useConfirmCashTransaction = (workspaceId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: CashMutationInput) =>
      confirmCashTransaction(payload, idempotencyKey),
    onSuccess: async () => {
      await invalidateCashDependents(queryClient, workspaceId);
    },
    onError: async (error) => {
      await refreshAfterCashFailure(queryClient, workspaceId, error);
    }
  });
};

export const useVoidCashTransaction = (workspaceId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ payload, idempotencyKey }: CashMutationInput) =>
      voidCashTransaction(payload, idempotencyKey),
    onSuccess: async () => {
      await invalidateCashDependents(queryClient, workspaceId);
    },
    onError: async (error) => {
      await refreshAfterCashFailure(queryClient, workspaceId, error);
    }
  });
};
