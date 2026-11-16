import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { basisIncomeOf } from '../reports/basisRefresh.ts';
import { noteDependentReadStart, syncKeyOf } from '../reports/basisRegistry.ts';
import {
  basisKeyOf,
  useFinancialReportBasisLiveRefreshWith,
  useFinancialReportBasisWith,
  type BasisSyncDeps,
  type BasisView,
} from '../reports/basisSync.ts';
import { SYSTEM_LIVE_REFRESH_CLOCK, createLiveRefreshScheduler } from '../reports/liveRefresh.ts';
import type { ReportRange, ReportSection } from '../reports/official.ts';
import { FINANCIAL_REPORT_BASIS_REFRESH } from '../reports/queryKeys.ts';
import { useTransactionsByIdsWith } from '../transactions/incomeReads.ts';
import type { WorkCalendar } from './calendar.ts';
import { proveEstimateConsistency, type ConsistencyInput } from './consistency.ts';
import type { WorkTimeEstimateMode, WorkTimeHistoryMonths } from './contract.ts';
import { monthKeyOf } from './dates.ts';
import { computeWorkTimeEstimate, estimateWindowMonths, extraMonthNeeded, type EstimateUnavailableReason, type WorkTimeEstimate } from './estimate.ts';
import { excludedItemOf, type ExcludedIncomeItem, type MonthReceipts } from './incomeBasis.ts';
import { proveProjectionExclusions, type ProjectionMarksRead, type ProjectionProof, type ReadDocument } from './projectionProof.ts';
import { readExcludedIncome, type ExcludedRead, type ReadByIds } from './receivableReversal.ts';
import { ESTIMATE_UNCONFIRMED_FAILED, ESTIMATE_UPDATING, estimateFailureMessage } from './messages.ts';

/**
 * Estimativa automática a partir das fontes oficiais (P5-F.1), com as
 * dependências injetadas: `useIncomeEstimate.ts` liga a callable, a escuta e
 * a leitura por id reais; os testes, uma API em memória. Sem SDK neste módulo.
 *
 * Lê, só quando ligada: a série mensal do relatório oficial (`12m`, bloco
 * `series`) do workspace escolhido como fonte; o bloco `cash` do 12º mês
 * completo quando a janela é de 12 meses; e os lançamentos que o usuário
 * desconsiderou, por id (até 50), com o espelho do estorno de cada recebimento
 * de cliente na mesma leitura (`receivableReversal.ts`). Nada é somado no navegador além de tirar
 * esses itens do total oficial do próprio mês (`incomeBasis.ts`). O cache é
 * o dos módulos de dados (relatórios e lançamentos), com a chave do uid; a
 * estimativa derivada não é guardada em lugar nenhum: é recalculada em
 * memória a cada mudança das entradas. As bases relêem quando muda a projeção
 * mensal de algum mês da janela no workspace-fonte (uma consulta de até 13
 * documentos), depois de uma mutação nesta aba (sem as leituras de receitas)
 * e na virada do mês, sem polling e sem listener por lançamento.
 *
 * Fail-closed (P5-F.1-R1, B03; prova pelas marcas na P5-F.1-R3): a estimativa que converte só é mostrada quando a
 * correspondência entre as leituras é provada pela projeção confirmada pelo servidor e, com desconsideradas,
 * pelas marcas de aplicação lidas no mesmo instante dos meses (`consistency.ts`, `projectionProof.ts`), e com a
 * sincronização concluída. Fora disso vale um estado sem conversão, com os valores em reais: "calculando",
 * "estimativa em atualização" ou, com uma leitura ou a escuta em falha, o erro com "Tentar de novo". Nenhuma
 * estimativa anterior é mostrada no lugar da atual (P5-F.1-R3.1, `holdEstimate`). Nenhum prazo aprova a conversão.
 * A confirmação do servidor é exigida em toda janela, também com uma base e nenhuma desconsiderada: a base do
 * cache (a tela que volta, a estimativa religada, outro workspace e de volta) só converte depois de um retorno do
 * servidor que a confirme, e sem conexão nada é confirmado (P5-F.1-R3.2, RR-R31-05). Toda estimativa que depende das
 * leituras de receita espera a mesma prova: a indisponível com a memória de cálculo preenchida (os números vêm das
 * mesmas leituras; F-08) e a de rotinas ambíguas (o motivo depende dos meses com renda; ADV-R3-01). A indisponível por
 * um motivo decidido antes das receitas (com o motivo) não converte e aparece como está, com ou sem confirmação (ADV-01).
 */

/**
 * Tempo de interface, nunca de prova: depois dele, "calculando" (sem prova ou com a sincronização em curso) vira
 * "estimativa em atualização", com "Tentar de novo". Só muda o texto; a conversão continua exigindo a prova.
 */
export const ESTIMATE_PENDING_WAIT_MS = 30_000;

const PRESET_12M: ReportRange = { kind: 'preset', preset: '12m' };
const SERIES_SECTIONS: readonly ReportSection[] = ['series'];
const CASH_SECTIONS: readonly ReportSection[] = ['cash'];
const EXACT = new Set(['exact', 'zero']);

export interface IncomeEstimateParams {
  workspaceId: string | null;
  mode: WorkTimeEstimateMode;
  historyMonths: WorkTimeHistoryMonths;
  allowBusinessIncome: boolean;
  calendar: WorkCalendar;
  excludedIds: readonly string[];
  enabled: boolean;
}

export type IncomeEstimateState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string; retry: () => void }
  | {
    status: 'done';
    estimate: WorkTimeEstimate;
    updatedAt: number;
    /** A última releitura falhou: a estimativa usa a leitura anterior (a tela oferece "Tentar de novo"). */
    refreshFailed: boolean;
    retry: () => void;
  };

export interface IncomeEstimateDeps {
  basis: BasisSyncDeps;
  /**
   * Lançamentos por id: os encontrados, os ids que não existem e a impressão digital do conteúdo bruto
   * (`getTransactionsByIds`, sempre do servidor: sem rede, falha, e nunca devolve o cache local).
   */
  readByIds: ReadByIds;
  /**
   * Os meses da janela e as marcas de aplicação dos ids, no mesmo instante (`readProjectionMarks`, transação só
   * de leitura do servidor; P5-F.1-R3).
   */
  readProjectionMarks: (workspaceId: string, months: readonly string[], ids: readonly string[]) => Promise<ProjectionMarksRead>;
  /** Só para os testes: o tempo de interface (padrão `ESTIMATE_PENDING_WAIT_MS`), no relógio de `basis.refresh.clock`. */
  pendingWaitMs?: number;
}

/**
 * Os motivos que `computeWorkTimeEstimate` decide antes de ler qualquer receita: a fonte PJ sem a confirmação da receita
 * empresarial, o relatório sem bloco exato e o recebimento desconsiderado sem o estado de estorno confirmado. Não trazem
 * números e não dependem de quais meses têm renda (P5-F.1-R3.2, F-08 da revisão financeira; ADV-R3-01 da adversarial).
 */
export const DECIDED_BEFORE_INCOME: ReadonlySet<EstimateUnavailableReason> = new Set<EstimateUnavailableReason>([
  'business_not_confirmed',
  'report_unavailable',
  'exclusion_unconfirmed',
]);

/**
 * A estimativa depende das leituras de receita: todo estado `done` fora dos motivos decididos antes delas. A que
 * converte (`ready`), a indisponível com a memória de cálculo preenchida (nenhuma renda na janela, rotina sem horas, os
 * limites), cujos números e motivo vêm das mesmas leituras da conversão (F-08), e a de rotinas ou véspera reduzida
 * ambíguas, cujo motivo depende de quais meses entram na janela: no modo habitual, os primeiros meses sem renda saem
 * antes da conferência da ambiguidade (ADV-R3-01). Um motivo novo cai aqui, e espera a prova (fail-closed).
 */
export const dependsOnIncomeReadings = (estimate: WorkTimeEstimate): boolean =>
  !(estimate.status === 'unavailable' && DECIDED_BEFORE_INCOME.has(estimate.reason));

/**
 * Apresentação fail-closed (P5-F.1-R3.1, R3-AUD-01). `proven`: a correspondência entre as leituras está provada pela
 * projeção confirmada (`consistency.ts`); `settling`: a sincronização ainda relê a base ou as leituras de receitas
 * (`holding`), e o estado vigente ainda não está confirmado.
 *
 * Uma estimativa que depende das leituras de receita (`dependsOnIncomeReadings`) só é mostrada provada e com a
 * sincronização concluída: é o estado atual. Sem prova, ou com a sincronização em curso, nenhuma delas é mostrada, nem
 * a atual nem uma anterior: vale `unproven` ("calculando", ou a falha com "Tentar de novo"), e os valores ficam em
 * reais. Vale para a que converte, para a indisponível com a memória de cálculo preenchida e para a de rotinas
 * ambíguas: sem a prova, os números e o motivo podiam ser de um estado misto (a receita oficial de um instante menos a
 * desconsiderada de outro) ou de uma base divergente depois das releituras ("nenhuma renda" ou uma ambiguidade num mês
 * que o estado confirmado não usa; F-08, ADV-R3-01). Nenhuma estimativa anterior é guardada: sem uso na tela,
 * guardá-la seria o caminho para mostrá-la como atual (a retenção da R1 fazia isso).
 *
 * Os outros estados aparecem como estão, sempre os desta renderização: carregando, erro, desligada e a estimativa
 * indisponível por um motivo decidido antes das receitas (`DECIDED_BEFORE_INCOME`), com o motivo, com ou sem prova. Não
 * há conversão nem número a comprovar, e o motivo real continua visível, também sem conexão ou com a escuta encerrada
 * (P5-F.1-R3.2, ADV-01: "preservar estados legitimamente indisponíveis").
 */
export const holdEstimate = (
  proven: boolean,
  settling: boolean,
  state: IncomeEstimateState,
  unproven: Exclude<IncomeEstimateState, { status: 'done' }>,
): IncomeEstimateState =>
  (state.status === 'done' && dependsOnIncomeReadings(state.estimate) && (!proven || settling) ? unproven : state);

/**
 * A leitura das desconsideradas em uso: por id, a ordem em que começou (regra 4 de `consistency.ts`) e os meses
 * e as marcas lidos numa transação depois dela (regra 5), com a janela usada.
 */
type ExcludedReadResult = ExcludedRead & { startedOrder: number; snapshot: ProjectionMarksRead; window: string };

export const useIncomeEstimateWith = (
  deps: IncomeEstimateDeps,
  uid: string | null,
  params: IncomeEstimateParams,
): IncomeEstimateState => {
  const { workspaceId, mode, historyMonths, allowBusinessIncome, calendar, excludedIds, enabled } = params;
  const series = useFinancialReportBasisWith(deps.basis, uid, workspaceId, PRESET_12M, SERIES_SECTIONS, { enabled });
  const referenceDate = series.data?.referenceDate ?? null;
  const extraMonth = referenceDate ? extraMonthNeeded(mode, historyMonths, monthKeyOf(referenceDate)) : null;
  const extraRange = useMemo<ReportRange>(
    () => (extraMonth ? { kind: 'month', month: extraMonth } : PRESET_12M),
    [extraMonth],
  );
  const extra = useFinancialReportBasisWith(deps.basis, uid, workspaceId, extraRange, CASH_SECTIONS, { enabled: enabled && extraMonth !== null });
  // Projeções mensais da janela no workspace-fonte, comparadas com a receita que as bases leram:
  // receita retroativa, edição, anulação, outro dispositivo ou outro membro, mesmo com outro
  // workspace ativo; despesas não relêem nada.
  const windowMonths = useMemo(
    () => (referenceDate ? estimateWindowMonths(mode, historyMonths, referenceDate) : []),
    [referenceDate, mode, historyMonths],
  );
  const needsExtra = extraMonth !== null;
  const needsExcluded = excludedIds.length > 0;
  // As bases em uso, só quando todas carregaram (enquanto uma carrega, a escuta só guarda a projeção).
  // Exatas: a receita de cada mês pode ser comparada; sem bloco exato (por exemplo, aguardando
  // reconstrução), a escuta relê a cada mudança das projeções.
  const basis = useMemo<BasisView | null>(() => {
    if (!series.data || (needsExtra && !extra.data)) return null;
    return {
      income: basisIncomeOf(
        series.data.series.data?.points ?? [],
        needsExtra && extra.data ? { month: extraMonth as string, receiptsCents: extra.data.cash.data?.receiptsCents ?? 0 } : null,
      ),
      exact: EXACT.has(series.data.series.status) && (!needsExtra || (!!extra.data && EXACT.has(extra.data.cash.status))),
      versions: needsExtra ? [series.dataUpdatedAt, extra.dataUpdatedAt] : [series.dataUpdatedAt],
      keys: needsExtra
        ? [basisKeyOf(uid, workspaceId, PRESET_12M, SERIES_SECTIONS), basisKeyOf(uid, workspaceId, extraRange, CASH_SECTIONS)]
        : [basisKeyOf(uid, workspaceId, PRESET_12M, SERIES_SECTIONS)],
      fetching: series.fetchStatus !== 'idle' || (needsExtra && extra.fetchStatus !== 'idle'),
    };
  }, [series.data, series.dataUpdatedAt, series.fetchStatus, extra.data, extra.dataUpdatedAt, extra.fetchStatus, needsExtra, extraMonth, extraRange, uid, workspaceId]);
  const syncKey = enabled && uid !== null && !!workspaceId && workspaceId !== 'loading' ? syncKeyOf(uid, workspaceId) : null;
  const windowKey = `${syncKey ?? ''}\n${windowMonths.join(',')}`;
  // A leitura por id começa depois do primeiro retorno do servidor da escuta desta janela (regra 4 de
  // `consistency.ts`): ela vê o estado que a projeção viu, sem uma releitura a mais na montagem.
  const [projectionReady, setProjectionReady] = useState<string | null>(null);
  // Os desconsiderados e, na mesma leitura, o estorno de cada recebimento de cliente (B01), com a ordem
  // em que a leitura começou (B03).
  const { readByIds, readProjectionMarks } = deps;
  const windowList = windowMonths.join(',');
  const readExcluded = useCallback(
    async (sourceId: string, ids: readonly string[]): Promise<ExcludedReadResult> => {
      const startedOrder = noteDependentReadStart();
      const read = await readExcludedIncome(readByIds, sourceId, ids);
      const months = windowList === '' ? [] : windowList.split(',');
      const snapshot = await readProjectionMarks(sourceId, months, [...new Set([...ids, ...Object.values(read.reversalIds)])]);
      return { ...read, startedOrder, snapshot, window: windowList };
    },
    [readByIds, readProjectionMarks, windowList],
  );
  const excluded = useTransactionsByIdsWith(readExcluded, workspaceId, excludedIds, {
    enabled: enabled && needsExcluded && projectionReady === windowKey,
    scope: windowList,
  });
  const { holding, listenFailed, retryListen, confirmed } = useFinancialReportBasisLiveRefreshWith(
    deps.basis, uid, workspaceId, windowMonths, basis, needsExcluded ? excluded.data : null, { enabled },
  );
  const confirmedReady = confirmed !== null;
  useEffect(() => {
    setProjectionReady(confirmedReady ? windowKey : null);
  }, [confirmedReady, windowKey]);

  const { refetch: refetchSeries } = series;
  const { refetch: refetchExtra } = extra;
  const { refetch: refetchExcluded } = excluded;
  // Com a escuta encerrada, a leitura por id não é relida aqui: só vale a que começar depois do retorno da
  // escuta reaberta (regra 4 de `consistency.ts`), e quem a relê é a prova.
  const retry = useCallback(() => {
    void refetchSeries();
    if (extraMonth) void refetchExtra();
    if (excludedIds.length > 0 && !listenFailed) void refetchExcluded();
    retryListen();
  }, [refetchSeries, refetchExtra, refetchExcluded, extraMonth, excludedIds.length, listenFailed, retryListen]);

  // Regra 5 (P5-F.1-R3): a prova pelas marcas de aplicação, com os meses e as marcas lidos no mesmo instante.
  // Só vale a leitura feita para esta janela; a receita comparada é a das bases em uso.
  const exclusionsProof = useMemo<ProjectionProof | null>(() => {
    const read = needsExcluded ? excluded.data : undefined;
    if (read === undefined || basis === null || read.window !== windowMonths.join(',')) return null;
    const documents: Record<string, ReadDocument> = {};
    const idOf = (document: object) => String((document as { id?: unknown }).id);
    for (const document of [...read.found, ...Object.values(read.reversals)]) {
      documents[idOf(document)] = { document: document as Record<string, unknown>, fingerprint: read.fingerprints[idOf(document)] ?? null };
    }
    return proveProjectionExclusions({
      months: windowMonths,
      snapshot: read.snapshot,
      basisIncome: basis.income,
      excludedIds: [...new Set(excludedIds)],
      read: documents,
      reversalIds: read.reversalIds,
    });
  }, [needsExcluded, excluded.data, basis, windowMonths, excludedIds]);
  const state = useMemo<IncomeEstimateState>(() => {
    if (!enabled || !workspaceId) return { status: 'idle' };
    const failedReport = [series, ...(needsExtra ? [extra] : [])].find((query) => query.isError && query.data === undefined);
    if (failedReport) return { status: 'error', message: estimateFailureMessage('report', failedReport.error), retry };
    if (needsExcluded && excluded.isError && excluded.data === undefined) {
      return { status: 'error', message: estimateFailureMessage('excluded', excluded.error), retry };
    }
    if (!series.data || (needsExtra && !extra.data) || (needsExcluded && !excluded.data)) return { status: 'loading' };

    const report = series.data;
    const points = report.series.data?.points ?? [];
    const receipts: MonthReceipts[] = points.map((point) => ({
      month: point.month,
      receiptsCents: point.receiptsCents,
      partial: point.partial,
    }));
    let reportExact = EXACT.has(report.series.status);
    if (needsExtra && extra.data && extraMonth) {
      const cash = extra.data.cash;
      reportExact = reportExact && EXACT.has(cash.status) && extra.data.period.range.kind === 'month';
      receipts.push({ month: extraMonth, receiptsCents: cash.data?.receiptsCents ?? 0, partial: false });
    }
    // Com a prova pelas marcas, cada item é o conteúdo que a projeção contém (ou nada, quando ela não contém o
    // lançamento). Sem prova, nada calculado daqui é mostrado: a estimativa que depende das receitas espera a prova
    // (`holdEstimate`), e a indisponível por um motivo decidido antes delas não traz número nenhum (F-08, ADV-R3-01).
    const excludedItems: ExcludedIncomeItem[] = [];
    if (needsExcluded && excluded.data && exclusionsProof?.proven) {
      for (const [id, applied] of Object.entries(exclusionsProof.applied)) {
        excludedItems.push(applied.document === null
          ? { id, month: null, classification: null }
          : excludedItemOf(applied.document, applied.reversal));
      }
    } else if (needsExcluded && excluded.data) {
      for (const found of excluded.data.found) {
        const transaction = found as Record<string, unknown>;
        const reversal = excluded.data.reversals[String(transaction.id)] as Record<string, unknown> | undefined;
        excludedItems.push(excludedItemOf(transaction, reversal ?? null));
      }
      for (const id of excluded.data.missing) excludedItems.push({ id, month: null, classification: null });
    }
    const estimate = computeWorkTimeEstimate({
      mode,
      historyMonths,
      allowBusinessIncome,
      calendar,
      referenceDate: report.referenceDate,
      workspaceType: report.workspaceType,
      reportExact,
      receipts,
      excluded: excludedItems,
    });
    const updatedAt = Math.max(series.dataUpdatedAt, needsExtra ? extra.dataUpdatedAt : 0, needsExcluded ? excluded.dataUpdatedAt : 0);
    // Releitura que falhou, ou a escuta das projeções encerrada por erro: a estimativa usa a última leitura. Com a
    // escuta encerrada não há projeção confirmada, e uma estimativa pronta nunca chega à tela (`holdEstimate`): com
    // ela, o aviso só aparece com a prova válida. A indisponível por um motivo decidido antes das receitas aparece como
    // está, com o aviso (P5-F.1-R3.2, ADV-01); a que depende das receitas espera a prova, como a pronta (F-08, ADV-R3-01).
    const refreshFailed = series.isError || (needsExtra && extra.isError) || (needsExcluded && excluded.isError) || listenFailed;
    return { status: 'done', estimate, updatedAt, refreshFailed, retry };
  }, [enabled, workspaceId, series, extra, excluded, needsExtra, needsExcluded, extraMonth, mode, historyMonths, allowBusinessIncome, calendar, retry, listenFailed, exclusionsProof]);
  const proofInput = useMemo<ConsistencyInput>(() => {
    const read = needsExcluded ? excluded.data : undefined;
    const excludedMonths: string[] = [];
    for (const found of read?.found ?? []) {
      const document = found as Record<string, unknown>;
      const reversal = (read?.reversals[String(document.id)] as Record<string, unknown> | undefined) ?? null;
      const month = excludedItemOf(document, reversal).month;
      if (month !== null) excludedMonths.push(month);
    }
    return {
      months: windowMonths,
      hasExclusions: needsExcluded,
      basis: basis === null ? null : { income: basis.income, exact: basis.exact },
      projection: confirmed,
      excludedStartedOrder: read?.startedOrder ?? null,
      excludedMonths,
      exclusionsProof,
    };
  }, [needsExcluded, excluded.data, windowMonths, basis, confirmed, exclusionsProof]);
  const clock = deps.basis.refresh?.clock ?? SYSTEM_LIVE_REFRESH_CLOCK;
  const waitMs = deps.pendingWaitMs ?? ESTIMATE_PENDING_WAIT_MS;
  const proof = useMemo(() => proveEstimateConsistency(proofInput), [proofInput]);
  // Uma versão da projeção que chegou depois do começo da leitura por id, num mês com desconsiderada, pede
  // outra leitura (regra 4), pelo agendador desta estimativa (agrupada e com orçamento), quando a
  // sincronização não vai relê-la: com a sincronização segurando (pedido, liberação, bases fora de passo),
  // é a liberação dela que relê, e o pedido daqui é cancelado. A regra 5 sem prova por motivo passageiro (o
  // gatilho ainda não aplicou o conteúdo lido, um evento espera o anterior, ou as bases ainda não são as dos
  // meses lidos) também pede outra leitura pelo mesmo agendador: no máximo o orçamento dele, nunca um prazo que
  // aprove. Marca quebrada ou mês sem etiqueta de geração só voltam com a reconstrução: nenhuma releitura
  // automática, só a escuta, a liberação e o "Tentar de novo".
  const refetchExcludedRef = useRef(refetchExcluded);
  refetchExcludedRef.current = refetchExcluded;
  const excludedScheduler = useRef<ReturnType<typeof createLiveRefreshScheduler> | null>(null);
  useEffect(() => {
    const scheduler = createLiveRefreshScheduler(
      () => {
        void refetchExcludedRef.current({ cancelRefetch: false });
      },
      deps.basis.refresh?.clock,
      deps.basis.refresh?.options ?? { ...FINANCIAL_REPORT_BASIS_REFRESH },
    );
    excludedScheduler.current = scheduler;
    return () => {
      scheduler.cancel();
      excludedScheduler.current = null;
    };
  }, [deps]);
  const unprovenReason = 'reason' in proof ? proof.reason : null;
  const marksReason = exclusionsProof !== null && exclusionsProof.proven === false ? exclusionsProof.reason : null;
  const marksTransient = unprovenReason === 'projection_marks' &&
    (marksReason === 'content' || marksReason === 'mark_pending' || marksReason === 'bases');
  const staleExcluded = (unprovenReason === 'exclusions_read' || marksTransient) && !holding && excluded.fetchStatus === 'idle'
    ? excluded.data
    : undefined;
  useEffect(() => {
    const scheduler = excludedScheduler.current;
    if (scheduler === null) return;
    if (staleExcluded !== undefined) scheduler.notify();
    else scheduler.cancel();
  }, [staleExcluded]);

  // Sem prova, ou com a sincronização em curso: nenhuma conversão. Com uma leitura ou a escuta em falha, o erro
  // com "Tentar de novo"; fora disso, "calculando".
  let failure: string | null = null;
  if (listenFailed) failure = ESTIMATE_UNCONFIRMED_FAILED;
  else if (series.isError) failure = estimateFailureMessage('report', series.error);
  else if (needsExtra && extra.isError) failure = estimateFailureMessage('report', extra.error);
  else if (needsExcluded && excluded.isError) failure = estimateFailureMessage('excluded', excluded.error);
  // Com desconsideradas, a leitura por id espera o primeiro retorno do servidor à escuta: com a escuta
  // encerrada antes dele, nada vai chegar, e "calculando" nunca terminaria. Vale o erro com "Tentar de novo",
  // que reabre a escuta (P5-F.1-R1, revisão: N05).
  const blockedByListen = listenFailed && needsExcluded && excluded.data === undefined && projectionReady !== windowKey;
  const current: IncomeEstimateState = state.status === 'loading' && blockedByListen
    ? { status: 'error', message: ESTIMATE_UNCONFIRMED_FAILED, retry }
    : state;
  const unproven: Exclude<IncomeEstimateState, { status: 'done' }> = current.status !== 'done'
    ? current
    : failure !== null ? { status: 'error', message: failure, retry } : { status: 'loading' };
  const shown = holdEstimate(proof.proven, holding, current, unproven);
  // "Calculando" com as leituras prontas, sem prova ou com a sincronização em curso, por mais que o tempo de
  // interface: o texto muda para "estimativa em atualização", com "Tentar de novo". Os valores seguem em reais; a
  // prova e o fim da sincronização continuam exigidos (P5-F.1-R3, R3.1). O tempo só muda o texto.
  const waitingProof = current.status === 'done' && shown.status === 'loading';
  const waitingSince = useRef<number | null>(null);
  const [waitedTooLong, setWaitedTooLong] = useState(false);
  useEffect(() => {
    if (!waitingProof) {
      waitingSince.current = null;
      setWaitedTooLong(false);
      return undefined;
    }
    if (waitingSince.current === null) waitingSince.current = clock.now();
    const remaining = waitingSince.current + waitMs - clock.now();
    if (remaining <= 0) {
      setWaitedTooLong(true);
      return undefined;
    }
    const handle = clock.setTimer(() => setWaitedTooLong(true), remaining);
    return () => clock.clearTimer(handle);
  }, [waitingProof, clock, waitMs]);
  if (waitingProof && waitedTooLong) return { status: 'error', message: ESTIMATE_UPDATING, retry };
  return shown;
};
