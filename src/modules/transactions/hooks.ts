import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getIncomeWindow, getMonthTransactions, getRecentTransactions } from "./api";
import type { TransactionType } from "../../types";
import { billingKeys } from "../billing/queryKeys";
import { invalidateFinancialReports } from "../reports/queryKeys";
import {
  confirmCashTransaction,
  createCashTransaction,
  updateCashTransaction,
  voidCashTransaction,
} from "./cashApi";
import { cashRefreshScope } from "./cashEntry";
import { runCashRefreshAfterCommit } from "./confirmedRefresh";
import { incomeReadsKey, invalidateTransactionReads } from "./incomeReads";

/*
 * Toda leitura de lista fica sob `["transactions", workspaceId, ...]`: a mutação nesta aba relê as que estão
 * em uso (`invalidateTransactionReads`), e só elas. A lista do mês e as recentes são consultas separadas,
 * cada uma só do que a sua tela mostra (P5-GATE-FINAL, FIRESTORE-01).
 */
const monthKeyOf = (workspaceId: string, monthKey: string, type: string) =>
  ["transactions", workspaceId, "month", monthKey, type] as const;
const recentKeyOf = (workspaceId: string, type: TransactionType | null) =>
  ["transactions", workspaceId, "recent", type ?? "todas"] as const;
const goalKey = (workspaceId: string) => ["goals", workspaceId] as const;
const isWorkspaceReady = (workspaceId: string) => !!workspaceId && workspaceId !== "loading";

/**
 * Telas que dependem dos lançamentos (lista, relatório financeiro oficial,
 * contas e metas). Exportada para os domínios cujo backend grava
 * espelho de caixa (empréstimos, P3-H) recarregarem as mesmas telas. As
 * leituras de receitas da estimativa de tempo de trabalho ficam com a
 * sincronização dela (`invalidateTransactionReads`).
 */
export const invalidateTransactionDependents = async (
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string
) => {
  await Promise.all([
    invalidateTransactionReads(queryClient, workspaceId),
    invalidateFinancialReports(queryClient),
    queryClient.invalidateQueries({ queryKey: goalKey(workspaceId) }),
    // P3-J (D-30): saldos e extratos das contas movem no mesmo commit.
    queryClient.invalidateQueries({ queryKey: ["cash_accounts", workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ["cash_account_movements", workspaceId] })
  ]);
};

/**
 * Lista de Receitas ou de Despesas do mês do Header (`AAAA-MM`). Só lê com a
 * tela aberta (`type` nulo desliga a consulta): nenhuma carga de lançamentos
 * na abertura do aplicativo.
 */
export const useMonthTransactions = (
  workspaceId: string,
  monthKey: string,
  type: "receita" | "despesa" | null,
) => {
  const queryResult = useQuery({
    queryKey: monthKeyOf(workspaceId, monthKey, type ?? ""),
    queryFn: () => getMonthTransactions(workspaceId, monthKey, type as "receita" | "despesa"),
    enabled: isWorkspaceReady(workspaceId) && type !== null,
    staleTime: 1000 * 60 * 5
  });
  return {
    ...queryResult,
    data: queryResult.data?.items,
    /** O mês bateu no teto de páginas: a lista e os totais não cobrem tudo (a tela avisa). */
    isTruncated: queryResult.data?.truncated === true,
    /** Documentos fora do contrato excluídos da lista (a tela avisa). */
    invalidCount: queryResult.data?.invalidCount ?? 0,
  };
};

/** "Transações Recentes" do Dashboard: as 9 mais recentes do tipo do filtro (ou de todos). */
export const useRecentTransactions = (
  workspaceId: string,
  type: TransactionType | null,
  options: { enabled?: boolean } = {},
) => {
  const queryResult = useQuery({
    queryKey: recentKeyOf(workspaceId, type),
    queryFn: () => getRecentTransactions(workspaceId, type),
    enabled: (options.enabled ?? true) && isWorkspaceReady(workspaceId),
    staleTime: 1000 * 60 * 5
  });
  return {
    ...queryResult,
    data: queryResult.data?.items,
    /** O teto de páginas acabou antes de juntar as 9 (a tela avisa). */
    isTruncated: queryResult.data?.truncated === true,
  };
};


/**
 * Receitas de uma janela de datas (conferência item a item), carregadas só
 * quando alguém as pede. Mesma família de chave dos lançamentos.
 */
export const useIncomeWindow = (
  workspaceId: string | null,
  since: string | null,
  until: string | null,
  options: { enabled?: boolean } = {},
) => useQuery({
  queryKey: [...incomeReadsKey(workspaceId ?? "", "income-window"), since ?? "", until ?? ""] as const,
  queryFn: () => getIncomeWindow(workspaceId as string, since as string, until as string),
  enabled: (options.enabled ?? true) && workspaceId !== null && isWorkspaceReady(workspaceId) && !!since && !!until,
  staleTime: 1000 * 60 * 5,
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
 * As quatro operações de caixa invalidam a lista, os dependentes e a quota no
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

/**
 * O resultado da callable é a confirmação autoritativa. Revalidar leituras é
 * necessário, mas não pode prolongar a mutação nem prender o modal depois de
 * o backend confirmar. Falhas de leitura continuam no estado das queries.
 */
const refreshAfterConfirmedCashMutation = (
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
): void => {
  runCashRefreshAfterCommit(
    () => invalidateCashDependents(queryClient, workspaceId),
    () => {
      // Não registrar dados do lançamento nem detalhes sensíveis do erro.
      console.warn('[caixa] Revalidação após confirmação não concluída; consultas permanecem sujeitas a nova leitura.');
    },
  );
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
    onSuccess: () => {
      refreshAfterConfirmedCashMutation(queryClient, workspaceId);
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
    onSuccess: () => {
      refreshAfterConfirmedCashMutation(queryClient, workspaceId);
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
    onSuccess: () => {
      refreshAfterConfirmedCashMutation(queryClient, workspaceId);
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
    onSuccess: () => {
      refreshAfterConfirmedCashMutation(queryClient, workspaceId);
    },
    onError: async (error) => {
      await refreshAfterCashFailure(queryClient, workspaceId, error);
    }
  });
};
