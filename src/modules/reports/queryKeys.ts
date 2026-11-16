import type { QueryClient } from '@tanstack/react-query';

import { refreshRegisteredBases } from './basisRegistry.ts';

/**
 * Prefixo de toda consulta do relatório financeiro oficial. Módulo sem SDK:
 * os módulos de domínio o importam para invalidar o relatório depois de uma
 * mutação financeira bem-sucedida.
 */
export const FINANCIAL_REPORT_KEY = 'financialReport';

export const financialReportKey = (
    uid: string,
    workspaceId: string,
    role: string,
    rangeKey: string,
    sectionsKey: string,
) => [FINANCIAL_REPORT_KEY, uid, workspaceId, role, rangeKey, sectionsKey] as const;

/**
 * Prefixo das bases de relatório de longa duração (P5-F.1): consultas que
 * ficam montadas o tempo todo, em qualquer tela. A releitura passa pelo mesmo
 * agendador da atualização ao vivo (`./liveRefresh.ts`), uma por base, com
 * orçamento próprio: até `FINANCIAL_REPORT_BASIS_REFRESH.burst` releituras seguidas e
 * reposição de uma a cada `refillMs` — no máximo 35 por hora por base. A
 * releitura depois de uma mutação nesta aba tem agendador e orçamento à parte
 * (`FINANCIAL_REPORT_BASIS_MUTATION_REFRESH`, no máximo 8 por hora por base),
 * para nunca gastar o da escuta. Com o Dashboard (até 200 por hora), o total
 * fica abaixo do limite de frequência da callable (300 por hora, por
 * workspace e usuário) mesmo com duas bases: 200 + 2 × (35 + 8) = 286.
 */
export const FINANCIAL_REPORT_BASIS_KEY = 'financialReportBasis';

/**
 * `coalesceMs` maior que o da atualização ao vivo: a projeção de caixa é
 * assíncrona, e um lançamento retroativo feito agora só aparece no relatório
 * depois que o gatilho roda (em geral, poucos segundos).
 */
export const FINANCIAL_REPORT_BASIS_REFRESH = {
    coalesceMs: 5_000,
    burst: 5,
    refillMs: 120_000,
} as const;

/**
 * Releitura das bases depois de uma mutação nesta aba (`rereadWorkspaceBases`):
 * cobre o gatilho que desiste e marca a projeção para reconstrução sem mudar os
 * documentos mensais, o que a escuta não vê. Agrupada por 30 s depois da última
 * mutação (o gatilho já terminou, em geral) e com orçamento próprio, de 2
 * seguidas e uma a cada 10 min: rajadas de despesas não atrasam a
 * sincronização de uma receita nova.
 */
export const FINANCIAL_REPORT_BASIS_MUTATION_REFRESH = {
    coalesceMs: 30_000,
    burst: 2,
    refillMs: 600_000,
} as const;

export const financialReportBasisKey = (
    uid: string,
    workspaceId: string,
    rangeKey: string,
    sectionsKey: string,
) => [FINANCIAL_REPORT_BASIS_KEY, uid, workspaceId, rangeKey, sectionsKey] as const;

/**
 * Invalida o relatório oficial das telas, que relê já. As bases de longa
 * duração (P5-F.1) não mudam com essa invalidação: elas leem a projeção
 * mensal de caixa, que só muda depois do gatilho, e a escuta delas
 * (`basisSync.ts`) já relê a base quando a projeção da janela muda. Reler a
 * cada mutação ou a cada mudança do mês corrente (o listener do App) gastaria
 * chamadas sem dado novo e abriria o teto de falhas sem motivo.
 */
export const invalidateFinancialReports = async (
    queryClient: Pick<QueryClient, 'invalidateQueries'>,
): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: [FINANCIAL_REPORT_KEY] });
};

/*
 * P5-F.1-R3 (RR-R2A-04) — releitura do relatório pedida pela escuta do mês.
 *
 * A invalidação geral cancela, no cliente, a leitura em curso e começa outra. Quando a leitura em curso começou
 * DEPOIS de a escuta mostrar a mudança, ela já lê o estado com a mudança (o servidor responde a ela depois do
 * retorno que a mostrou): cancelá-la só atrasava a tela pela duração de uma chamada a mais e dobrava a carga da
 * callable, porque o servidor segue processando a cancelada. Medido na falha intermitente do Dashboard: duas
 * releituras depois do gatilho, de ~10 s cada no Emulator carregado.
 *
 * A ordem é a do registro (um contador, sem relógio): a mudança vista e o começo de cada leitura pegam o
 * próximo número. Leitura em curso que começou depois da última mudança vista fica; qualquer outra (parada, em
 * curso desde antes da mudança, desativada) é invalidada e relida como antes. Nenhuma mudança deixa de ser lida.
 */
let liveOrder = 0;
const reportFetchStarts = new Map<string, number>();

/** Próximo número da ordem de registro. */
export const nextFinancialReportOrder = (): number => {
    liveOrder += 1;
    return liveOrder;
};

/** Uma leitura do relatório começou agora (chamado pela `queryFn`, com o hash da chave). */
export const noteFinancialReportFetchStart = (queryHash: string): void => {
    reportFetchStarts.set(queryHash, nextFinancialReportOrder());
};

/** A consulta precisa ser relida depois da mudança `changeOrder`? */
export const needsReportRefetch = (
    query: { fetching: boolean; fetchStartedOrder: number | null },
    changeOrder: number,
): boolean => !(query.fetching && query.fetchStartedOrder !== null && query.fetchStartedOrder > changeOrder);

/**
 * Releitura pela escuta: só as consultas do relatório que ainda não estão lendo o estado da mudança. O React
 * Query não cancela a primeira leitura de uma consulta (ainda sem dado): ele a reaproveita, mesmo começada antes
 * da mudança. Nesse caso, a releitura vem depois que ela termina, para a mudança nunca se perder.
 */
export const refreshFinancialReportsAfterChange = async (
    queryClient: Pick<QueryClient, 'getQueryCache' | 'invalidateQueries'>,
    changeOrder: number,
): Promise<void> => {
    const queries = queryClient.getQueryCache().findAll({ queryKey: [FINANCIAL_REPORT_KEY] });
    await Promise.all(queries
        .filter((query) => needsReportRefetch({
            fetching: query.state.fetchStatus === 'fetching',
            fetchStartedOrder: reportFetchStarts.get(query.queryHash) ?? null,
        }, changeOrder))
        .map((query) => {
            const refetch = () => queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true });
            const firstRead = query.state.fetchStatus === 'fetching' && query.state.dataUpdatedAt === 0;
            return firstRead ? refetch().then(refetch, refetch) : refetch();
        }));
};

/**
 * Virada do mês: as bases de longa duração ficam desatualizadas (o "hoje" e a
 * janela mudaram) e cada uma já carregada é relida pelo próprio agendador, com
 * as falhas zeradas.
 */
export const invalidateFinancialReportBases = async (
    queryClient: Pick<QueryClient, 'invalidateQueries'>,
): Promise<void> => {
    const invalidated = queryClient.invalidateQueries({ queryKey: [FINANCIAL_REPORT_BASIS_KEY], refetchType: 'none' });
    refreshRegisteredBases();
    await invalidated;
};
