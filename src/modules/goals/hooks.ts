import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {useMemo} from 'react';

import {useWorkspace} from '../../contexts/WorkspaceContext';
import {invalidateFinancialReports} from '../reports/queryKeys';
import {
  archiveGoal,
  createGoal,
  getGoalKpiProgress,
  getGoalsOverview,
  listGoalManualProgressHistory,
  listActiveInvestmentGoalsByIds,
  listGoalsPage,
  listInvestmentGoalOptionsPage,
  setGoalStatus,
  updateGoal,
  updateGoalManualProgress,
  type ArchiveGoalInput,
  type CreateGoalInput,
  type GoalListCursor,
  type SetGoalStatusInput,
  type UpdateGoalInput,
  type UpdateManualProgressInput,
} from './api';
import {
  chunkKpiGoalIds,
  goalErrorView,
  type GoalKpiInput,
  type InvestmentGoalOptionsCursor,
} from './model';

/**
 * Todas as chaves de metas ficam sob `['goals', workspaceId]`: invalidar o
 * prefixo (como fazem as mutações de caixa e de investimentos) atualiza a
 * lista, o resumo, os indicadores PJ, os seletores e o histórico de uma vez.
 * Nenhuma consulta de meta faz polling.
 */
export const KEYS = {
  all: (workspaceId: string) => ['goals', workspaceId] as const,
  list: (workspaceId: string) => ['goals', workspaceId, 'list'] as const,
  overview: (workspaceId: string) => ['goals', workspaceId, 'overview'] as const,
  kpi: (workspaceId: string, goalIds: readonly string[]) =>
    ['goals', workspaceId, 'kpi', goalIds.join(',')] as const,
  investmentOptions: (workspaceId: string) =>
    ['goals', workspaceId, 'investment-options'] as const,
  investmentGoalsById: (workspaceId: string, goalIds: readonly string[]) =>
    ['goals', workspaceId, 'investment-by-id', goalIds.join(',')] as const,
  manualHistory: (workspaceId: string, goalId: string) =>
    ['goals', workspaceId, 'manual-history', goalId] as const,
};

const isReady = (workspaceId: string) => Boolean(workspaceId) && workspaceId !== 'loading';

/** Metas, uma página por vez; `data` é o que já foi carregado. */
export const useGoals = (options: {enabled?: boolean} = {}) => {
  const {activeWorkspace} = useWorkspace();
  const queryResult = useInfiniteQuery({
    queryKey: KEYS.list(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id) && options.enabled !== false,
    initialPageParam: undefined as GoalListCursor | undefined,
    queryFn: ({pageParam}) => listGoalsPage(activeWorkspace.id, pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextCursor : undefined),
  });
  return {
    ...queryResult,
    data: queryResult.data?.pages.flatMap((page) => page.items),
  };
};

/** Contadores exatos do servidor, independentes da página carregada. */
export const useGoalsOverview = (options: {enabled?: boolean} = {}) => {
  const {activeWorkspace} = useWorkspace();
  return useQuery({
    queryKey: KEYS.overview(activeWorkspace.id),
    queryFn: () => getGoalsOverview(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id) && options.enabled !== false,
  });
};

/**
 * Indicadores das metas `business_kpi` da página, em lotes de até 25. Devolve
 * o estado por meta: carregando, erro ou o resultado do servidor.
 */
export const useGoalKpiProgress = (goalIds: readonly string[]): Map<string, GoalKpiInput> => {
  const {activeWorkspace} = useWorkspace();
  const workspaceId = activeWorkspace.id;
  const chunks = chunkKpiGoalIds(goalIds);
  const queries = useQueries({
    queries: chunks.map((ids) => ({
      queryKey: KEYS.kpi(workspaceId, ids),
      queryFn: () => getGoalKpiProgress(workspaceId, ids),
      enabled: isReady(workspaceId),
    })),
  });
  const states = new Map<string, GoalKpiInput>();
  chunks.forEach((ids, index) => {
    const query = queries[index];
    for (const id of ids) {
      if (query?.isError) {
        states.set(id, {status: 'error'});
      } else if (query?.data) {
        const result = query.data.find((entry) => entry.goalId === id);
        states.set(id, result ?? {status: 'error'});
      } else {
        states.set(id, {status: 'loading'});
      }
    }
  });
  return states;
};

/** Paginação do seletor de metas de investimento, passada às telas de aporte. */
export interface InvestmentGoalOptionsPaging {
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
}

/**
 * Metas de investimento para os seletores de aporte e para nomear posições:
 * a primeira página (25) e as seguintes só quando a tela pede (`loadMore`).
 * Sem teto fixo e sem carregar tudo de uma vez (P5-B.1).
 */
export const useInvestmentGoalOptions = () => {
  const {activeWorkspace} = useWorkspace();
  const queryResult = useInfiniteQuery({
    queryKey: KEYS.investmentOptions(activeWorkspace.id),
    enabled: isReady(activeWorkspace.id),
    initialPageParam: undefined as InvestmentGoalOptionsCursor | undefined,
    queryFn: ({pageParam}) => listInvestmentGoalOptionsPage(activeWorkspace.id, pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const {data, hasNextPage, isFetchingNextPage, fetchNextPage} = queryResult;
  const goals = useMemo(() => data?.pages.flatMap((page) => page.goals) ?? [], [data]);
  const paging: InvestmentGoalOptionsPaging = useMemo(() => ({
    hasMore: Boolean(hasNextPage),
    isLoadingMore: isFetchingNextPage,
    loadMore: () => {
      if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    },
  }), [hasNextPage, isFetchingNextPage, fetchNextPage]);
  return {...queryResult, goals, paging};
};

/**
 * Metas de investimento ativas pelo ID — só as que a tela precisa nomear e
 * ainda não vieram nas páginas carregadas (posições da página, cards da
 * alocação, meta já selecionada). Lotes de 25; nada sem ID pedido.
 */
export const useInvestmentGoalsByIds = (goalIds: readonly string[]) => {
  const {activeWorkspace} = useWorkspace();
  const ids = useMemo(
    () => Array.from(new Set(goalIds.filter(Boolean))).sort(),
    [goalIds],
  );
  return useQuery({
    queryKey: KEYS.investmentGoalsById(activeWorkspace.id, ids),
    queryFn: () => listActiveInvestmentGoalsByIds(activeWorkspace.id, ids),
    enabled: isReady(activeWorkspace.id) && ids.length > 0,
  });
};

/** Histórico das atualizações manuais (owner/admin; as Rules negam aos demais). */
export const useGoalManualHistory = (goalId: string, enabled: boolean) => {
  const {activeWorkspace} = useWorkspace();
  return useQuery({
    queryKey: KEYS.manualHistory(activeWorkspace.id, goalId),
    queryFn: () => listGoalManualProgressHistory(activeWorkspace.id, goalId),
    enabled: enabled && isReady(activeWorkspace.id) && Boolean(goalId),
  });
};

/**
 * Mutação por callable. Depois do sucesso recarrega lista, resumo, indicadores
 * e histórico; depois de falha que indica outro estado no servidor (conflito,
 * pré-condição, resultado incerto), também. Sem atualização otimista.
 */
const useGoalCallable = <TInput, TResult>(
  call: (input: TInput, workspaceId: string, idempotencyKey: string) => Promise<TResult>,
) => {
  const {activeWorkspace} = useWorkspace();
  const queryClient = useQueryClient();
  const workspaceId = activeWorkspace.id;
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({queryKey: KEYS.all(workspaceId)}),
    invalidateFinancialReports(queryClient),
  ]);
  return useMutation({
    mutationFn: ({input, idempotencyKey}: {input: TInput; idempotencyKey: string}) =>
      call(input, workspaceId, idempotencyKey),
    onSuccess: async () => {
      await refresh();
    },
    onError: async (error) => {
      if (goalErrorView(error).refresh) await refresh();
    },
  });
};

export const useCreateGoal = () => useGoalCallable<CreateGoalInput, Awaited<ReturnType<typeof createGoal>>>(createGoal);
export const useUpdateGoal = () => useGoalCallable<UpdateGoalInput, Awaited<ReturnType<typeof updateGoal>>>(updateGoal);
export const useUpdateGoalManualProgress = () =>
  useGoalCallable<UpdateManualProgressInput, Awaited<ReturnType<typeof updateGoalManualProgress>>>(updateGoalManualProgress);
export const useSetGoalStatus = () =>
  useGoalCallable<SetGoalStatusInput, Awaited<ReturnType<typeof setGoalStatus>>>(setGoalStatus);
export const useArchiveGoal = () =>
  useGoalCallable<ArchiveGoalInput, Awaited<ReturnType<typeof archiveGoal>>>(archiveGoal);
