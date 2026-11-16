import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { FinancialReport, ReportRange, ReportSection } from './official.ts';
import { FINANCIAL_REPORT_BASIS_MUTATION_REFRESH, FINANCIAL_REPORT_BASIS_REFRESH, financialReportBasisKey } from './queryKeys.ts';
import { rangeKey, sectionsKey } from './range.ts';
import { createLiveRefreshScheduler, type LiveRefreshClock, type LiveRefreshOptions } from './liveRefresh.ts';
import {
  INITIAL_BASIS_FAILURE_STATE,
  basisRefreshAfter,
  divergenceRefresh,
  projectedIncomeOf,
  sameIncome,
  serverVersionKey,
  serverVersionOf,
  type ConfirmedProjection,
  type MonthlyIncome,
  type ServerVersion,
} from './basisRefresh.ts';
import {
  basesOutOfStep,
  basisFetchStarts,
  basisRefreshes,
  basisRereadScheduled,
  markRereadOnReturn,
  noteBasisReadServed,
  noteBasisReadStart,
  noteProjectionSeen,
  noteServerSnapshot,
  refreshRegisteredBases,
  registerFailedListener,
  reopenFailedListeners,
  scheduleBasisReread,
  serverSnapshotCount,
  syncKeyOf,
  takeRereadOnReturn,
} from './basisRegistry.ts';
import { refreshIncomeReads } from '../transactions/incomeReads.ts';

/**
 * Bases de relatório de longa duração e a atualização ao vivo delas (P5-F.1),
 * com as dependências injetadas: `hooks.ts` liga a callable e o Firestore
 * reais; os testes, uma API em memória. Sem SDK neste módulo.
 */

export interface BasisReportPayload {
  workspaceId: string;
  range: ReportRange;
  sections: ReportSection[];
}

/** Um retorno da escuta das projeções mensais. */
export interface PeriodsSnapshot {
  /** Cada mês com documento: a receita e a versão (`updatedAt`, hora do servidor da última escrita do gatilho). */
  documents: ReadonlyArray<{ id: string; incomeCents: unknown; updatedAt?: unknown }>;
  /** Veio só do cache local (sem confirmação do servidor). */
  fromCache: boolean;
  /** Documentos que mudaram desde o retorno anterior (no primeiro, todos). */
  changes: number;
}

export interface BasisSyncDeps {
  fetchReport: (payload: BasisReportPayload) => Promise<FinancialReport>;
  /** Escuta as projeções mensais com id entre `firstMonth` e `lastMonth` (até `BASIS_PERIODS_MAX`). */
  subscribePeriods: (
    workspaceId: string,
    firstMonth: string,
    lastMonth: string,
    onNext: (snapshot: PeriodsSnapshot) => void,
    onError: () => void,
  ) => () => void;
  /**
   * Relógio e orçamentos dos agendadores (os testes encurtam): `options`, o da escuta e da virada do
   * mês (padrão `FINANCIAL_REPORT_BASIS_REFRESH`); `mutationOptions`, o da releitura depois de uma
   * mutação nesta aba (padrão `FINANCIAL_REPORT_BASIS_MUTATION_REFRESH`).
   */
  refresh?: { clock?: LiveRefreshClock; options?: LiveRefreshOptions; mutationOptions?: LiveRefreshOptions };
}

/**
 * Depois de releituras que falham, o agendador para nesta quantidade de
 * falhas seguidas para a mesma versão dos dados (sem releitura indefinida,
 * por exemplo depois de perder o acesso ao workspace). Só um sinal de versão
 * nova para a base zera a contagem e relê: a projeção da janela mudou no
 * workspace dela ou o mês virou. O "Tentar de novo" também relê, e qualquer
 * leitura que chega com dados zera a contagem (a falha de uma releitura que
 * não deixou a base desatualizada, como a da mutação, não pede outra). A volta
 * da rede e a montagem de outro observador não relêem; fora isso, a contagem
 * só recomeça do zero quando nenhuma estimativa ligada usa mais a base (por
 * exemplo, a estimativa desligada e religada). A invalidação dos relatórios
 * das telas não toca as bases.
 */
export const BASIS_RETRIES_AFTER_ERROR = 2;

/**
 * Teto de documentos mensais escutados por base. A janela tem no máximo 12
 * meses (os completos do histórico, ou só o corrente); o teto deixa um de folga.
 */
export const BASIS_PERIODS_MAX = 13;

/** Chave serializada de uma base, a mesma do cache e do registro dos agendadores. */
export const basisKeyOf = (
  uid: string | null,
  workspaceId: string | null,
  range: ReportRange,
  sections: readonly ReportSection[],
): string => JSON.stringify(financialReportBasisKey(uid ?? '', workspaceId ?? '', rangeKey(range), sectionsKey(sections)));

/**
 * Relatório oficial de um workspace escolhido (não necessariamente o ativo),
 * para bases de longa duração que ficam montadas em qualquer tela. O servidor
 * confere membership e papel a cada chamada; o cache é do uid da sessão e é
 * limpo no logout e na troca de conta.
 *
 * Não relê a cada mudança: a releitura é pedida pela escuta das projeções
 * (`useFinancialReportBasisLiveRefreshWith`) ou pela virada do mês e passa
 * por um agendador por base, dividido entre os observadores, com o orçamento
 * de `FINANCIAL_REPORT_BASIS_REFRESH`: nenhum polling, e o limite de
 * frequência da callable preservado.
 */
export const useFinancialReportBasisWith = (
  deps: BasisSyncDeps,
  uid: string | null,
  workspaceId: string | null,
  range: ReportRange,
  sections: readonly ReportSection[],
  options: { enabled?: boolean } = {},
) => {
  const queryClient = useQueryClient();
  const enabled = (options.enabled ?? true) &&
    uid !== null &&
    workspaceId !== null &&
    workspaceId !== '' &&
    workspaceId !== 'loading';
  const queryKey = financialReportBasisKey(uid ?? '', workspaceId ?? '', rangeKey(range), sectionsKey(sections));
  const refreshKey = basisKeyOf(uid, workspaceId, range, sections);
  const query = useQuery<FinancialReport>({
    queryKey,
    queryFn: async () => {
      // Quantos retornos do servidor a escuta já trouxe quando esta leitura começa, e a ordem dela entre
      // os pedidos de releitura da base (`basisRegistry.ts`); com dados, a ordem dos dados que a base mostra.
      basisFetchStarts.set(refreshKey, serverSnapshotCount(syncKeyOf(uid as string, workspaceId as string)));
      const started = noteBasisReadStart(refreshKey);
      const report = await deps.fetchReport({
        workspaceId: workspaceId as string,
        range,
        sections: [...sections],
      });
      noteBasisReadServed(refreshKey, started);
      return report;
    },
    enabled,
    staleTime: Infinity,
    // Enquanto a base está em uso, toda releitura passa por um agendador (orçamento): nem a montagem
    // de outro observador nem a volta da rede relêem uma base já carregada. A base sem dado carrega na
    // montagem. A desatualizada que volta a ser usada pela mesma estimativa (chave trocada ou
    // estimativa religada) é lida na hora (React Query 5.0, `shouldFetchOptionally`); a de uma
    // estimativa que monta é relida pelo agendador, pelo efeito abaixo, se estiver abaixo do teto.
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: 1,
  });
  useEffect(() => {
    if (!enabled) return undefined;
    let entry = basisRefreshes.get(refreshKey);
    if (!entry) {
      const exactKey = JSON.parse(refreshKey) as unknown[];
      const refetch = () => {
        void queryClient.refetchQueries({ queryKey: exactKey, exact: true });
      };
      entry = {
        scheduler: createLiveRefreshScheduler(refetch, deps.refresh?.clock, deps.refresh?.options ?? { ...FINANCIAL_REPORT_BASIS_REFRESH }),
        mutationScheduler: createLiveRefreshScheduler(
          refetch,
          deps.refresh?.clock,
          deps.refresh?.mutationOptions ?? { ...FINANCIAL_REPORT_BASIS_MUTATION_REFRESH },
        ),
        users: 0,
        failure: INITIAL_BASIS_FAILURE_STATE,
        maxFailures: BASIS_RETRIES_AFTER_ERROR,
        workspaceId: workspaceId as string,
        loaded: () => (queryClient.getQueryState(exactKey)?.dataUpdatedAt ?? 0) !== 0,
      };
      basisRefreshes.set(refreshKey, entry);
      // A base que volta a ser usada depois de sair com releitura pendente (marcada na limpeza) é relida pelo
      // agendador se ninguém a está lendo: a leitura em curso na saída, se terminou depois, desfez a
      // desatualização. Sem marca, ou já em leitura (a chave trocada lê a desatualizada na hora), nada muda.
      if (takeRereadOnReturn(refreshKey) && entry.loaded() && (queryClient.getQueryState(exactKey)?.fetchStatus ?? 'idle') === 'idle') {
        void queryClient.invalidateQueries({ queryKey: exactKey, exact: true, refetchType: 'none' });
        scheduleBasisReread(refreshKey, entry.scheduler);
      }
    }
    entry.users += 1;
    const current = entry;
    return () => {
      current.users -= 1;
      if (current.users === 0) {
        // Uma releitura pendente que a base não chegou a fazer não se perde: a base fica desatualizada e
        // marcada, e a estimativa que voltar a usá-la (por exemplo, a janela que sai de 12 meses e volta) a lê
        // de novo. A ordem fica no registro: a base que volta sabe o que não leu.
        if (basisRereadScheduled(refreshKey)) {
          void queryClient.invalidateQueries({ queryKey: JSON.parse(refreshKey) as unknown[], exact: true, refetchType: 'none' });
          markRereadOnReturn(refreshKey);
        }
        current.scheduler.cancel();
        current.mutationScheduler.cancel();
        basisRefreshes.delete(refreshKey);
        basisFetchStarts.delete(refreshKey);
      }
    };
  }, [enabled, refreshKey, queryClient, deps]);
  const { isStale, isFetching, dataUpdatedAt, errorUpdatedAt } = query;
  useEffect(() => {
    if (!enabled || isFetching || dataUpdatedAt === 0) return;
    const entry = basisRefreshes.get(refreshKey);
    if (!entry) return;
    if (!isStale) {
      // Uma leitura com dados que chega sem a base estar desatualizada (o "Tentar de novo", a releitura da
      // mutação) também zera as falhas: a base relida com sucesso sai do teto e volta a ser relida pela
      // mutação. A falha dessa releitura fica registrada sem contar, nem quando a base ficar desatualizada.
      entry.failure = { dataUpdatedAt, errorUpdatedAt, failures: dataUpdatedAt !== entry.failure.dataUpdatedAt ? 0 : entry.failure.failures };
      return;
    }
    const decision = basisRefreshAfter(entry.failure, { dataUpdatedAt, errorUpdatedAt }, BASIS_RETRIES_AFTER_ERROR);
    entry.failure = decision.state;
    if (decision.notify) scheduleBasisReread(refreshKey, entry.scheduler);
  }, [enabled, refreshKey, isStale, isFetching, dataUpdatedAt, errorUpdatedAt]);
  return query;
};

/** As bases que uma estimativa usa, já carregadas (série e, na janela de 12 meses, o mês avulso). */
export interface BasisView {
  /** Receita por mês das bases. */
  income: MonthlyIncome;
  /** Todas as bases têm bloco exato: a receita de cada mês pode ser comparada com a projeção. */
  exact: boolean;
  /** `dataUpdatedAt` de cada base, na mesma ordem a cada renderização: muda a cada leitura que chega. */
  versions: readonly number[];
  /** Chave de cada base (`basisKeyOf`), na mesma ordem: a releitura pedida pela escuta vai só para elas. */
  keys: readonly string[];
  /**
   * Alguma base da estimativa está em leitura, inclusive a busca pausada sem rede (`fetchStatus` diferente
   * de `idle`: sem rede, o React Query pausa a leitura antes de chamar a `queryFn`). A base nova sem pedido só
   * libera quando nenhuma está; com mais de uma base, a estimativa segura enquanto alguma está assim
   * (`outOfStep`).
   */
  fetching: boolean;
}

/**
 * A leitura dependente (as exclusões por id) como a estimativa a vê: o resultado
 * dela (`undefined` antes do primeiro), ou nulo sem leitura dependente. A
 * identidade é a do objeto: cada leitura concluída traz um objeto novo
 * (`useTransactionsByIdsWith`, sem compartilhamento de estrutura), mesmo com os
 * mesmos dados e no mesmo milissegundo. O `dataUpdatedAt` não serve: a
 * liberação relê a leitura dependente logo que a anterior chega, e uma releitura
 * que termina no mesmo milissegundo repetiria o valor, deixando a estimativa
 * segurada até outra mudança.
 */
export type DependentRead = object | undefined | null;

/**
 * Atualização ao vivo das bases de uma estimativa: escuta, numa consulta só
 * de até `BASIS_PERIODS_MAX` documentos, as projeções mensais de caixa
 * (`cash_report_periods`) dos meses da janela num workspace que não precisa
 * ser o ativo. A projeção é o que o relatório lê: só depois que o gatilho a
 * grava é que a base relida traz uma mudança (mutação nesta aba, em outra
 * sessão, de outro membro).
 *
 * - Retorno só do cache local não conta: pode trazer só parte dos documentos
 *   (os que outro alvo segura); vale o retorno confirmado pelo servidor.
 * - Enquanto alguma base carrega (`basis` nulo), a escuta só guarda a
 *   projeção: nada é comparado nem relido.
 * - Base exata: compara a receita (`incomeCents`) de cada mês com a que a base
 *   leu, a cada retorno do servidor, quando a base termina de carregar e
 *   quando chega uma releitura pedida por esta estimativa; despesas não relêem
 *   nada. Cada estado divergente pede no máximo `BASIS_DIVERGENCE_RETRIES`
 *   releituras; quando a base alcança a projeção, a conta recomeça. Uma
 *   leitura nova que esta estimativa não pediu (a releitura da mutação, o
 *   pedido de outra estimativa com a mesma base, a virada do mês, o "Tentar de
 *   novo") e que começou depois do último retorno do servidor não pede
 *   releitura: ela leu a projeção depois desse retorno, e a escuta traz o
 *   mesmo estado em seguida. A que começou antes dele (um retorno chegou
 *   durante a leitura, `basisRegistry.ts`) pode ter lido um estado anterior,
 *   como uma receita lançada e anulada no meio: essa compara e pode pedir.
 * - Base sem bloco exato (por exemplo, aguardando reconstrução): não compara,
 *   porque ela não tem receita por mês; relê no primeiro retorno do servidor e
 *   a cada mudança dos documentos (pode ser a publicação), pelo agendador.
 *
 * Releitura: as bases desta estimativa (`keys`) são marcadas e relidas pelo
 * agendador de cada uma (falhas zeradas). A sincronização é liberada em três
 * casos: (1) a base, exata, alcança a projeção, mesmo antes de todas as
 * releituras chegarem (com a mesma receita por mês, a estimativa é a mesma);
 * (2) todas as bases trouxeram uma leitura nova (`versions`) e não há mais
 * releituras para o mesmo estado divergente; (3) sem bloco exato, ou sem
 * projeção para comparar (escuta encerrada), todas as bases trouxeram uma
 * leitura nova. Só então as leituras de receitas que dependem dos totais
 * (exclusões por id e janela do painel) são relidas, para a estimativa nunca
 * juntar um item novo com um total velho. `syncing` vai do pedido até a
 * liberação; `holding` continua até a leitura dependente (`reads`) trazer
 * dados novos.
 *
 * Base nova sem pedido: as leituras de receitas acompanham a receita da base
 * com que foram lidas (a da liberação que as releu ou, para leituras novas
 * sem liberação desta estimativa, a da base daquele momento), em todos os
 * meses que a base traz, e não só na janela: uma mudança fora dela também vale
 * para uma janela que passe a incluí-la e para uma estimativa que monte depois
 * com a mesma base. O mês avulso, que só a janela de 12 meses lê, não é
 * acompanhado antes de entrar: a estimativa que passa a 12 meses segura e
 * relê as leituras de receitas depois dele e não mostra nenhuma estimativa até
 * a prova e o fim da sincronização (P5-F.1-R1, R3.1, `work-time/consistency.ts`). Uma
 * base exata com outra receita, pedida ou não, é segurada já na renderização
 * em que chega (`holding`) e libera, relendo as leituras de receitas depois
 * dela, quando nenhuma base da estimativa está em leitura (`fetching`).
 *
 * Bases fora de passo (só com mais de uma base, a janela de 12 meses): a
 * estimativa segura enquanto alguma base está em leitura (inclusive a busca
 * pausada sem rede) ou mostra uma leitura que começou depois de um pedido que
 * outra ainda não leu e que ainda vai relê-la (`basesOutOfStep`, no registro),
 * com ou sem leitura dependente. Assim, a releitura da mutação adiada pelo
 * orçamento de uma base, ou a nova tentativa agendada depois de uma falha,
 * segura a base nova da outra até chegar, e uma leitura nova das duas (o
 * "Tentar de novo") solta a espera. As bases cujas leituras começaram antes do
 * mesmo pedido pendente (por exemplo, uma mutação nesta aba durante a
 * sincronização) estão em passo: a estimativa as mostra, e a releitura
 * pendente as atualiza depois. A base que sai de uso com releitura pendente
 * fica desatualizada e marcada, e é relida quando volta, mesmo que a leitura
 * em curso na saída termine depois. A base parada no teto de falhas não é
 * relida pela mutação e não segura a outra; a estimativa avisa a falha. Os
 * marcos não usam o relógio (só igualdade e a ordem do registro) e valem só
 * para o uid e o workspace em que foram postos.
 *
 * Projeção confirmada (P5-F.1-R1, `confirmed`): a receita e a versão de cada mês da janela no último
 * retorno do servidor, com a ordem em que cada versão chegou pela primeira vez a uma escuta da conta e do
 * workspace (`noteProjectionSeen`). É a fonte da prova de consistência da estimativa
 * (`work-time/consistency.ts`); vale só para a conta, o workspace e os meses em que foi recebida e deixa
 * de valer com a escuta encerrada e com um retorno só do cache local, que o SDK entrega ao perder a conexão
 * (`includeMetadataChanges`); volta com o próximo retorno do servidor (P5-F.1-R3.2). Cada montagem, a
 * estimativa religada e a troca de conta, workspace ou meses começam sem ela.
 *
 * Escuta encerrada por erro (por exemplo, acesso perdido ao workspace-fonte):
 * o SDK não a reabre. `listenFailed` avisa, a projeção recebida deixa de valer
 * (nada é comparado com ela) e a escuta fica registrada para ser reaberta
 * pelo "Tentar de novo" de qualquer estimativa da mesma conta e do mesmo
 * workspace, ou pelo retorno do servidor a outra escuta deles
 * (`basisRegistry.ts`): o provedor, que não tem botão, volta quando a prévia
 * de Configurações abre a dela.
 */
export const useFinancialReportBasisLiveRefreshWith = (
  deps: BasisSyncDeps,
  uid: string | null,
  workspaceId: string | null,
  months: readonly string[],
  basis: BasisView | null,
  reads: DependentRead,
  options: { enabled?: boolean } = {},
): {
  syncing: boolean;
  holding: boolean;
  listenFailed: boolean;
  retryListen: () => void;
  confirmed: ConfirmedProjection | null;
} => {
  const queryClient = useQueryClient();
  const firstMonth = months[0] ?? null;
  const lastMonth = months[months.length - 1] ?? null;
  const monthsKey = months.join(',');
  const enabled = (options.enabled ?? true) &&
    uid !== null &&
    !!workspaceId &&
    workspaceId !== 'loading' &&
    !!firstMonth &&
    !!lastMonth;
  const syncKey = enabled ? syncKeyOf(uid as string, workspaceId as string) : null;
  const projected = useRef<MonthlyIncome | null>(null);
  /** Um retorno do servidor (o primeiro, ou com documentos mudados) ainda não usado pela base sem bloco exato. */
  const changed = useRef(false);
  const attempts = useRef(new Map<string, number>());
  /** Pedido em curso: as versões das bases no pedido e o estado divergente que o motivou. */
  const pending = useRef<{ key: string; versions: readonly number[]; signature: string | null } | null>(null);
  /** A leitura dependente como estava ao ser relida; enquanto for a mesma, a estimativa segura. */
  const readsMark = useRef<{ key: string; value: object | undefined } | null>(null);
  /** A receita da base na última liberação: é a que as leituras relidas por ela acompanham. */
  const released = useRef<{ key: string; income: MonthlyIncome } | null>(null);
  /** A receita da base que a leitura dependente atual (`reads`) acompanha. */
  const paired = useRef<{ key: string; income: MonthlyIncome; reads: object | undefined } | null>(null);
  /** As versões das bases na última leitura nova vista (separa a carga da releitura sem pedido). */
  const seen = useRef<{ key: string; versions: readonly number[] } | null>(null);
  const [waitingKey, setWaitingKey] = useState<string | null>(null);
  /** Escuta encerrada por erro (a chave em que falhou) e o contador que a reabre. */
  const [listenFailedKey, setListenFailedKey] = useState<string | null>(null);
  const [listenAttempt, setListenAttempt] = useState(0);
  /** O último retorno do servidor da escuta, com a chave (conta, workspace e meses) em que chegou. */
  const [confirmed, setConfirmed] = useState<{ key: string; projection: ConfirmedProjection } | null>(null);
  const confirmedKey = syncKey === null ? null : `${syncKey}\n${monthsKey}`;
  const basisRef = useRef(basis);
  basisRef.current = basis;
  const readsRef = useRef(reads);
  readsRef.current = reads;
  const keyRef = useRef(syncKey);
  keyRef.current = syncKey;
  const arrived = () => {
    const current = basisRef.current;
    const request = pending.current;
    return !!current && !!request && current.versions.length > 0 &&
      current.versions.every((version, index) => version !== 0 && version !== request.versions[index]);
  };
  const request = useRef<(signature: string | null) => void>(() => undefined);
  request.current = (signature) => {
    const key = keyRef.current;
    const current = basisRef.current;
    if (key === null || current === null) return;
    pending.current = { key, versions: [...current.versions], signature };
    // Só as bases desta estimativa; as leituras de receitas não são marcadas: uma estimativa montada
    // durante a sincronização as releria antes da base.
    for (const basisKey of current.keys) {
      void queryClient.invalidateQueries({ queryKey: JSON.parse(basisKey) as unknown[], exact: true, refetchType: 'none' });
    }
    refreshRegisteredBases(current.keys);
    setWaitingKey(key);
  };
  const release = useRef<() => void>(() => undefined);
  release.current = () => {
    const key = keyRef.current;
    const current = basisRef.current;
    pending.current = null;
    readsMark.current = key !== null && readsRef.current !== null ? { key, value: readsRef.current } : null;
    released.current = key !== null && current !== null ? { key, income: current.income } : null;
    setWaitingKey(null);
    if (key !== null) void refreshIncomeReads(queryClient, workspaceId as string);
  };
  const evaluate = useRef<(mayRequest: boolean) => void>(() => undefined);
  evaluate.current = (mayRequest) => {
    const current = basisRef.current;
    if (!enabled || current === null) return;
    if (projected.current === null) {
      // Sem projeção para comparar (a escuta ainda sem retorno do servidor, ou encerrada por erro):
      // um pedido em curso termina quando todas as bases chegam.
      if (pending.current && arrived()) release.current();
      return;
    }
    if (current.exact) {
      changed.current = false;
      const decision = divergenceRefresh(projected.current, current.income, months, attempts.current);
      if (decision.converged) {
        attempts.current.clear();
        if (pending.current) release.current();
        return;
      }
      // A releitura deste mesmo estado está em curso: espera todas as bases chegarem.
      if (pending.current && !arrived() && pending.current.signature === decision.signature) return;
      if (mayRequest && decision.refresh && decision.signature !== null) {
        attempts.current.set(decision.signature, decision.attempts);
        request.current(decision.signature);
        return;
      }
      // O mesmo estado, sem mais releituras: libera com o que chegou.
      if (pending.current && arrived()) release.current();
      return;
    }
    if (changed.current) {
      changed.current = false;
      request.current(null);
      return;
    }
    if (pending.current && arrived()) release.current();
  };
  /**
   * As leituras de receitas acompanham a base: as relidas na liberação, a base daquele momento; as
   * novas sem liberação desta estimativa, a base atual. Uma base exata com outra receita libera (e
   * as relê depois dela) quando nenhuma base está em leitura; com um pedido em curso, quem libera é o
   * pedido. As bases fora de passo entre si são seguradas à parte (`outOfStep`, na renderização).
   */
  const followReads = useRef<() => void>(() => undefined);
  followReads.current = () => {
    const key = keyRef.current;
    const current = basisRef.current;
    const value = readsRef.current;
    if (key === null || current === null || value === null) return;
    const mark = readsMark.current;
    if (mark && mark.key === key) {
      if (mark.value === value) return;
      readsMark.current = null;
      const base = released.current;
      paired.current = { key, income: base && base.key === key ? base.income : current.income, reads: value };
    }
    if (pending.current) return;
    const pair = paired.current;
    if (pair === null || pair.key !== key || pair.reads !== value) {
      paired.current = { key, income: current.income, reads: value };
      return;
    }
    if (current.exact && !current.fetching && !sameIncome(current.income, pair.income)) release.current();
  };
  useEffect(() => {
    projected.current = null;
    changed.current = false;
    attempts.current = new Map();
    // Outra conta, outro workspace ou a estimativa desligada: nada da sincronização anterior vale (o
    // marco das leituras é descartado pela própria leitura, que muda com o workspace). Com a mesma
    // conta e o mesmo workspace (por exemplo, a janela mudou), o pedido em curso continua.
    if (pending.current && pending.current.key !== syncKey) pending.current = null;
    setWaitingKey((current) => (current === syncKey ? current : null));
    setListenFailedKey(null);
    setConfirmed(null);
    if (!enabled || syncKey === null) return undefined;
    const key = `${syncKey}\n${monthsKey}`;
    let synced = false;
    let unregister: (() => void) | null = null;
    const unsubscribe = deps.subscribePeriods(workspaceId as string, firstMonth as string, lastMonth as string, (snapshot) => {
      if (snapshot.fromCache) {
        // O SDK passou a servir só do cache local (sem conexão, ou antes do primeiro retorno do servidor): a
        // projeção recebida deixa de confirmar o estado atual, e nenhuma estimativa converte até o próximo retorno
        // do servidor (P5-F.1-R3.2, RR-R31-05). A sincronização mantém a última projeção para comparar as bases.
        setConfirmed(null);
        return;
      }
      noteServerSnapshot(syncKey);
      // O servidor respondeu: as escutas encerradas das outras estimativas desta conta e deste workspace reabrem.
      reopenFailedListeners(syncKey);
      if (!synced || snapshot.changes > 0) changed.current = true;
      synced = true;
      projected.current = projectedIncomeOf(snapshot.documents);
      // A versão de cada mês da janela (`sem-documento` sem documento) e a ordem em que ela chegou pela
      // primeira vez a uma escuta desta conta e deste workspace; a receita entra na chave, para um documento
      // sem `updatedAt` nunca parecer o mesmo depois de mudar.
      const byMonth = new Map(snapshot.documents.map((document) => [document.id, document]));
      const versions: Record<string, ServerVersion | null> = {};
      const seen: Record<string, number> = {};
      for (const month of monthsKey.split(',')) {
        const document = byMonth.get(month);
        const version = serverVersionOf(document?.updatedAt);
        versions[month] = version;
        const income = Number.isSafeInteger(document?.incomeCents) ? String(document?.incomeCents) : '-';
        seen[month] = noteProjectionSeen(syncKey, month, `${serverVersionKey(version)}|${income}`);
      }
      setConfirmed({ key, projection: { income: projected.current, versions, seen } });
      evaluate.current(true);
    }, () => {
      // O SDK não reabre a escuta: a projeção recebida deixa de valer, a estimativa avisa ("Tentar de
      // novo") e a escuta fica registrada para ser reaberta (`basisRegistry.ts`).
      projected.current = null;
      changed.current = false;
      attempts.current = new Map();
      setConfirmed(null);
      setListenFailedKey(syncKey);
      unregister?.();
      unregister = registerFailedListener(syncKey, () => setListenAttempt((attempt) => attempt + 1));
      evaluate.current(false);
    });
    return () => {
      unregister?.();
      unsubscribe();
    };
  }, [enabled, syncKey, uid, workspaceId, firstMonth, lastMonth, monthsKey, deps, listenAttempt]);
  // Leitura nova de alguma base (ou base que terminou de carregar): compara de novo e, com um pedido
  // em curso, libera quando todas as bases chegaram e alcançaram a projeção. Só a carga e a releitura
  // pedida por esta estimativa podem pedir outra; depois, as leituras de receitas seguem a base.
  const versionsKey = basis ? basis.versions.join(',') : '';
  useEffect(() => {
    const key = keyRef.current;
    const current = basisRef.current;
    const before = seen.current;
    seen.current = key !== null && current !== null ? { key, versions: current.versions } : null;
    const loading = before === null || before.key !== key || before.versions.length !== (current?.versions.length ?? 0) ||
      before.versions.some((version) => version === 0);
    // Uma leitura nova que começou antes do último retorno do servidor pode ter lido um estado anterior a
    // ele (por exemplo, uma receita lançada e anulada durante a leitura): compara e pode pedir.
    const overlapped = !loading && key !== null && current !== null && before !== null && current.keys.some((basisKey, index) =>
      current.versions[index] !== before.versions[index] && (basisFetchStarts.get(basisKey) ?? -1) < serverSnapshotCount(key));
    evaluate.current(loading || pending.current !== null || overlapped);
    followReads.current();
  }, [versionsKey, basis?.exact, basis?.income, basis?.fetching]);
  useEffect(() => {
    followReads.current();
  }, [reads]);
  const syncing = syncKey !== null && waitingKey === syncKey;
  const mark = readsMark.current;
  const readsBehind = syncKey !== null && mark !== null && mark.key === syncKey && reads !== null && reads === mark.value;
  // A receita da base que a leitura dependente desta renderização acompanha (a mesma regra de
  // `followReads`, que só roda depois): uma base exata com outra receita segura já aqui.
  let pairedIncome: MonthlyIncome | null = null;
  if (syncKey !== null && reads !== null) {
    if (mark !== null && mark.key === syncKey) {
      if (reads !== mark.value && released.current?.key === syncKey) pairedIncome = released.current.income;
    } else if (paired.current !== null && paired.current.key === syncKey && paired.current.reads === reads) {
      pairedIncome = paired.current.income;
    }
  }
  const ahead = basis !== null && basis.exact && pairedIncome !== null && !sameIncome(basis.income, pairedIncome);
  // Com mais de uma base (a janela de 12 meses), as bases fora de passo: alguma em leitura (inclusive a
  // pausada sem rede), ou uma mostrando uma leitura posterior a um pedido que outra ainda vai ler
  // (`basesOutOfStep`), com ou sem leitura dependente; o registro é o mesmo para todas as estimativas da sessão.
  // Enquanto segura, a estimativa não converte: nem a versão anterior nem a atual (`holdEstimate`, P5-F.1-R3.1);
  // a conversão volta com a prova de consistência e a sincronização concluída.
  const outOfStep = syncKey !== null && basis !== null && basis.keys.length > 1 &&
    (basis.fetching || basesOutOfStep(basis.keys));
  const retryListen = useCallback(() => {
    // Reabre as escutas encerradas desta conta e deste workspace, a desta estimativa e as das outras.
    const key = keyRef.current;
    if (key !== null) reopenFailedListeners(key);
  }, []);
  return {
    syncing,
    holding: syncing || readsBehind || ahead || outOfStep,
    listenFailed: syncKey !== null && listenFailedKey === syncKey,
    retryListen,
    // A escuta encerrada zera a projeção confirmada no próprio retorno de erro (`setConfirmed(null)`).
    confirmed: confirmed !== null && confirmed.key === confirmedKey ? confirmed.projection : null,
  };
};
