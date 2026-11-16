import { useQuery, type QueryClient } from '@tanstack/react-query';

import { rereadWorkspaceBases } from '../reports/basisRegistry.ts';

/**
 * Leituras de receitas que dependem dos totais do relatório oficial (P5-F.1):
 * os lançamentos desconsiderados, lidos por id, e a janela do painel
 * "Receitas consideradas". Módulo sem SDK, para os ganchos dos relatórios as
 * relerem junto com a base, sem importar o Firebase.
 */
export type IncomeReadKind = 'by-ids' | 'income-window';

export const incomeReadsKey = (workspaceId: string, kind: IncomeReadKind) =>
  ['transactions', workspaceId, kind] as const;

const KINDS: readonly IncomeReadKind[] = ['by-ids', 'income-window'];

const isIncomeReadKey = (queryKey: readonly unknown[]) =>
  queryKey[0] === 'transactions' && KINDS.includes(queryKey[2] as IncomeReadKind);

/**
 * Relê agora as leituras de receitas em uso no workspace (as demais ficam desatualizadas) e só
 * termina quando os dados novos chegam. Sem cancelar uma releitura em curso: outra estimativa (o
 * provedor e a prévia de Configurações) pode pedir a mesma ao mesmo tempo, e o cancelamento faria a
 * primeira terminar antes dos dados.
 */
export const refreshIncomeReads = (
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  workspaceId: string,
) => Promise.all(KINDS.map((kind) => queryClient.invalidateQueries({ queryKey: incomeReadsKey(workspaceId, kind) }, { cancelRefetch: false })));

/**
 * Depois de uma mutação nesta aba: relê as listas de lançamentos do workspace, mas não as leituras
 * de receitas que dependem dos totais oficiais. O total oficial só muda quando o gatilho grava a
 * projeção mensal; a escuta da estimativa (`reports/basisSync.ts`) vê essa mudança, relê a base e só
 * depois relê essas leituras, para nunca juntar um item novo com um total velho. A leitura por id
 * fica como está; a janela do painel só é marcada (é relida quando o painel abrir de novo). As bases
 * do workspace são relidas pelo agendador da mutação, agrupado e com orçamento próprio, sem zerar as
 * falhas (`rereadWorkspaceBases`): cobre o gatilho que desiste e marca a projeção para reconstrução
 * sem mudar os documentos mensais. Se essa releitura trouxer outra receita, a estimativa a segura e
 * relê as leituras de receitas depois dela (`basisSync.ts`).
 */
export const invalidateTransactionReads = (
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  workspaceId: string,
) => {
  rereadWorkspaceBases(workspaceId);
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: ['transactions', workspaceId],
      predicate: (query) => !isIncomeReadKey(query.queryKey),
    }),
    queryClient.invalidateQueries({ queryKey: incomeReadsKey(workspaceId, 'income-window'), refetchType: 'none' }),
  ]);
};

const isWorkspaceReady = (workspaceId: string | null): workspaceId is string =>
  !!workspaceId && workspaceId !== 'loading';

/**
 * Lançamentos por id (até 50), com a leitura injetada (`work-time/useIncomeEstimate.ts` liga o
 * Firestore; os testes, uma API em memória). Os dados dependem dos totais oficiais, então só a
 * sincronização da estimativa os relê, depois da base (`refreshIncomeReads`); além dela, só uma lista
 * nova (outra chave), o "Tentar de novo" e a prova de consistência da estimativa, quando uma versão
 * nova da projeção chega depois do começo da leitura (`work-time/consistency.ts`, regra 4, por um
 * agendador com orçamento). Sem prazo de validade nem releitura na montagem ou na
 * volta da rede: uma leitura vencida relida antes do gatilho da projeção juntaria um item novo com
 * um total velho. Sem compartilhamento de estrutura: cada leitura concluída traz um objeto novo, mesmo
 * com os mesmos dados e no mesmo milissegundo, e a sincronização usa esse objeto como a identidade da
 * leitura (`reports/basisSync.ts`). O `dataUpdatedAt`, em milissegundos, repete o valor quando uma
 * releitura termina no mesmo milissegundo da anterior.
 */
export const useTransactionsByIdsWith = <T>(
  read: (workspaceId: string, ids: readonly string[]) => Promise<T>,
  workspaceId: string | null,
  ids: readonly string[],
  /** `scope`: o que mais a leitura usa e muda o resultado (a janela de meses da prova da estimativa, P5-F.1-R3). */
  options: { enabled?: boolean; scope?: string } = {},
) => {
  const sorted = [...new Set(ids)].sort();
  return useQuery({
    queryKey: [...incomeReadsKey(workspaceId ?? '', 'by-ids'), sorted.join(','), options.scope ?? ''] as const,
    queryFn: () => read(workspaceId as string, sorted),
    enabled: (options.enabled ?? true) && isWorkspaceReady(workspaceId) && sorted.length > 0,
    staleTime: Infinity,
    refetchOnReconnect: false,
    structuralSharing: false,
  });
};
