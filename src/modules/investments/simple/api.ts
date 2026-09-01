import { useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  listInvestmentAllocations,
  listInvestmentMovements,
  listInvestmentPositions,
  resolveInvestmentAssetNames,
  resolveInvestmentPositions,
  type InvestmentCursor,
  type MovementCursor,
} from '../persistence/readApi';
import { callInvestment, investmentRequestIds } from '../persistence/callableApi';
import type { InvestmentAllocationDimension, InvestmentPosition } from '../types';
import { toGoalLinkCandidates, type GoalLinkCandidate } from './goalLink';
import {
  simpleMovementQueryFilter,
  toSimpleInvestmentRows,
  type SimpleInvestmentFilters,
  type SimpleInvestmentRow,
  type SimpleMovementQueryFilter,
} from './rows';

/**
 * Camada de leitura e escrita da tela simples (Etapa 2, §6).
 *
 * Leitura: `investment_movements`, paginado pelo cursor que o domínio já
 * expunha (20 por página, ordenado por `occurredAt`), mais **uma** consulta em
 * bloco de posições por página carregada. Nenhuma consulta nova, nenhum índice
 * novo — a ordenação por `occurredAt` decrescente já é coberta pelo índice de
 * campo único, e a resolução de posição usa `documentId() in`.
 *
 * Escrita: apenas as callables do modo simples. A tela não escreve em
 * `transactions` e não conhece conta, ativo, quantidade nem preço.
 */

export const SIMPLE_INVESTMENT_KEYS = {
  root: ['investments-simple'] as const,
  movements: (workspaceId: string, filter: SimpleMovementQueryFilter) =>
    ['investments-simple', workspaceId, 'movements', filter] as const,
  positions: (workspaceId: string, ids: string[]) =>
    ['investments-simple', workspaceId, 'positions', ids] as const,
  allocation: (workspaceId: string, dimensions: InvestmentAllocationDimension[]) =>
    ['investments-simple', workspaceId, 'allocation', dimensions] as const,
  goalCandidates: (workspaceId: string, goalId: string) =>
    ['investments-simple', workspaceId, 'goal-candidates', goalId] as const,
};

export interface SimpleInvestmentsPage {
  rows: SimpleInvestmentRow[];
  nextCursor: MovementCursor | null;
}

/**
 * Página do ledger com o recorte que couber no servidor (Etapa 3, §0.C).
 *
 * Estado e meta descem como `where` sempre que existe índice para isso; o que
 * sobra — texto livre, categoria, "Desfeitos" — é refinado sobre a página. A
 * chave da consulta carrega o recorte para a troca de filtro buscar de novo em
 * vez de reaproveitar a página do filtro anterior.
 */
export const useSimpleInvestmentMovements = (
  workspaceId: string,
  filters: SimpleInvestmentFilters,
) => {
  const serverFilter = useMemo(() => simpleMovementQueryFilter(filters), [filters]);
  return useInfiniteQuery({
    queryKey: SIMPLE_INVESTMENT_KEYS.movements(workspaceId, serverFilter),
    initialPageParam: null as MovementCursor | null,
    queryFn: async ({ pageParam }): Promise<SimpleInvestmentsPage> => {
      const page = await listInvestmentMovements(
        workspaceId, serverFilter, pageParam ?? undefined,
      );
      return { rows: toSimpleInvestmentRows(page.items), nextCursor: page.nextCursor };
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: workspaceId.length > 0,
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
};

/**
 * Posições das linhas carregadas.
 *
 * Só entram `positionId` de linhas já liquidadas: um aporte pendente ainda não
 * tem posição, e pedi-la devolveria nada de útil ao custo de alargar o bloco.
 */
export const useSimpleInvestmentPositions = (
  workspaceId: string,
  rows: SimpleInvestmentRow[],
) => {
  const ids = useMemo(
    () => Array.from(new Set(
      rows.filter((row) => row.effective).map((row) => row.positionId),
    )).sort(),
    [rows],
  );
  return useQuery({
    queryKey: SIMPLE_INVESTMENT_KEYS.positions(workspaceId, ids),
    queryFn: () => resolveInvestmentPositions(workspaceId, ids),
    enabled: workspaceId.length > 0 && ids.length > 0,
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });
};

/** Um investimento é retirável quando a posição está viva e tem capital. */
export const isRedeemablePosition = (position?: InvestmentPosition): boolean =>
  Boolean(position && position.status === 'active' && position.principalCents > 0);

export interface SimpleInvestmentCall {
  name: string;
  nonce: string;
  payload: Record<string, unknown>;
}

/**
 * Chamada ao domínio com identidade de intenção (INV-P1-004).
 *
 * O `nonce` vem do formulário aberto: duplo clique, retry de rede e
 * timeout+retry repetem a mesma chave e produzem **um** fato financeiro. É a
 * proteção contra envio duplo exigida pelo §4 — o botão desabilitado é só a
 * camada visível dela.
 */
export const useSimpleInvestmentMutation = (workspaceId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, nonce, payload }: SimpleInvestmentCall) => {
      const body = { workspaceId, ...payload };
      return callInvestment(name, { ...body, ...investmentRequestIds(name, nonce, body) });
    },
    onSuccess: async () => {
      // O domínio projeta espelho de caixa e progresso de meta na mesma
      // transação; a tela comum lê os dois por outras chaves e ficaria
      // desatualizada sem isto. A lista é a mesma que as mutações de
      // `transactions` já invalidam.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SIMPLE_INVESTMENT_KEYS.root }),
        queryClient.invalidateQueries({ queryKey: ['transactions', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['transactions-full-history', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['investment-transactions', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['cash-periods', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['goals', workspaceId] }),
        // O histórico da meta é uma consulta própria; sem isto, o aporte feito
        // de dentro da meta some da lista até um recarregamento manual.
        queryClient.invalidateQueries({ queryKey: ['goal-investment-movements', workspaceId] }),
      ]);
    },
  });
};

/**
 * Cortes de alocação da faixa acima dos cards (Etapa 3, §7).
 *
 * Duas dimensões, duas consultas, mais o resumo — não as oito do relatório
 * oficial. `staleTime` alto porque a projeção só muda quando uma liquidação
 * passa, e a própria mutação já invalida a raiz `investments-simple`.
 */
export const useInvestmentAllocation = (
  workspaceId: string,
  dimensions: InvestmentAllocationDimension[],
) => useQuery({
  queryKey: SIMPLE_INVESTMENT_KEYS.allocation(workspaceId, dimensions),
  queryFn: () => listInvestmentAllocations(workspaceId, dimensions),
  enabled: workspaceId.length > 0 && dimensions.length > 0,
  staleTime: 60_000,
  retry: 1,
  refetchOnWindowFocus: false,
});

export interface GoalLinkCandidatePage {
  candidates: GoalLinkCandidate[];
  nextCursor: InvestmentCursor | null;
}

/**
 * Investimentos que uma meta pode vincular (Etapa 3, §2.C).
 *
 * Páginas de posições ativas — 20 por vez, ordenadas por `updatedAt desc`, com
 * o índice `status+updatedAt` que já existe — e **uma** resolução em bloco dos
 * nomes dos ativos por página. Sem full scan, sem leitura por linha e sem
 * cruzar workspace: a coleção já é filha de `workspaces/{id}`, e as Rules
 * recusam qualquer listagem fora dela.
 *
 * A consulta é paginada, e não uma página só: num workspace com mais de vinte
 * posições, a página única escondia investimentos elegíveis enquanto a lista
 * afirmava, pelo estado vazio, que não havia nenhum. O cursor é o mesmo que
 * `listInvestmentPositions` já expunha — nenhuma consulta nova, nenhum índice
 * novo e o `limit` continua onde estava.
 */
export const useGoalLinkCandidates = (
  workspaceId: string,
  goalId: string,
  enabled: boolean,
) => useInfiniteQuery({
  queryKey: SIMPLE_INVESTMENT_KEYS.goalCandidates(workspaceId, goalId),
  initialPageParam: null as InvestmentCursor | null,
  queryFn: async ({ pageParam }): Promise<GoalLinkCandidatePage> => {
    const page = await listInvestmentPositions(workspaceId, undefined, pageParam ?? undefined);
    const names = await resolveInvestmentAssetNames(
      workspaceId,
      page.items.map((position) => position.assetId),
    );
    return {
      candidates: toGoalLinkCandidates(page.items, goalId, names),
      nextCursor: page.nextCursor,
    };
  },
  getNextPageParam: (last) => last.nextCursor,
  enabled: enabled && workspaceId.length > 0 && goalId.length > 0,
  staleTime: 30_000,
  retry: 1,
  refetchOnWindowFocus: false,
});
