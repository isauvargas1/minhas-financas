import assert from 'node:assert/strict';
import test, {afterEach} from 'node:test';
import {createElement, useMemo, useState} from 'react';
import TestRenderer, {act, type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient, QueryClientProvider, onlineManager} from '@tanstack/react-query';

import {basisIncomeOf, type MonthlyIncome} from '../../src/modules/reports/basisRefresh.ts';
import {
  basesOutOfStep,
  basisRefreshes,
  basisRereadScheduled,
  clearBasisRegistry,
  noteBasisReadServed,
  noteBasisReadStart,
  refreshRegisteredBases,
  rereadWorkspaceBases,
  scheduleBasisReread,
  type BasisRefreshEntry,
} from '../../src/modules/reports/basisRegistry.ts';
import {
  basisKeyOf,
  useFinancialReportBasisLiveRefreshWith,
  useFinancialReportBasisWith,
  type BasisSyncDeps,
  type BasisView,
  type PeriodsSnapshot,
} from '../../src/modules/reports/basisSync.ts';
import type {LiveRefreshClock} from '../../src/modules/reports/liveRefresh.ts';
import type {FinancialReport, ReportRange, ReportSection} from '../../src/modules/reports/official.ts';
import {FINANCIAL_REPORT_BASIS_KEY, invalidateFinancialReportBases, invalidateFinancialReports} from '../../src/modules/reports/queryKeys.ts';
import {incomeReadsKey, invalidateTransactionReads, useTransactionsByIdsWith} from '../../src/modules/transactions/incomeReads.ts';

/**
 * P5-F.1 — ganchos da base do relatório e da atualização ao vivo
 * (`src/modules/reports/basisSync.ts`) com React Query real (React 18 +
 * react-test-renderer, sem DOM) e uma API em memória no lugar da callable e
 * da escuta das projeções mensais. Cobre: primeiro retorno, retorno só do
 * cache, estado que volta, base sem bloco exato, teto de falhas (que só um
 * sinal da própria base reabre), base que nunca carregou, ordem das releituras
 * dependentes (inclusive duas leituras dependentes concluídas no mesmo
 * milissegundo), dois observadores, troca de workspace (sem retenção herdada),
 * marco sem relógio, a janela de 12 meses (série e mês avulso, nas duas
 * ordens de chegada), a base nova que chega sem pedido (retida na mesma
 * renderização), a escuta encerrada (projeção descartada e reabertura entre
 * estimativas), o orçamento à parte da releitura da mutação e, na janela de
 * 12 meses, a base nova que espera a releitura pendente da outra e a base
 * parada no teto.
 */

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const RANGE: ReportRange = {kind: 'preset', preset: '12m'};
const SECTIONS: readonly ReportSection[] = ['series'];
const CASH: readonly ReportSection[] = ['cash'];
const WINDOW = ['2026-08', '2026-09', '2026-10'];
/** Janela habitual de 12 meses (hoje 04/11/2026): a série traz de dez/2025 em diante; novembro de 2025 vem à parte. */
const EXTRA_MONTH = '2025-11';
const WINDOW_12 = [EXTRA_MONTH, '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', ...WINDOW];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Medido com `performance.now()`: um teste muda `Date.now` (relógio do aparelho voltando).
const until = async (condition: () => boolean, message: string, timeoutMs = 3_000) => {
  const started = performance.now();
  while (!condition()) {
    if (performance.now() - started > timeoutMs) assert.fail(`tempo esgotado: ${message}`);
    await act(async () => { await wait(5); });
  }
};
/** Nada acontece por um tempo (para provar que não há releitura nem laço). */
const settle = async (ms = 120) => { await act(async () => { await wait(ms); }); };

interface Fake {
  deps: BasisSyncDeps;
  /** Receita por mês que a série devolve. */
  receipts: Record<string, number>;
  /** Receita do mês avulso (bloco `cash` de um mês). */
  extraReceipts: Record<string, number>;
  status: 'exact' | 'needs_rebuild';
  failing: boolean;
  /** Só a série deste workspace falha. */
  failingWs: string | null;
  /** A leitura do mês avulso falha. */
  failingMonth: boolean;
  /** Todas as chamadas da callable. */
  calls: number;
  seriesCalls: number;
  monthCalls: number;
  seriesDelayMs: number;
  monthDelayMs: number;
  log: string[];
  emit: (workspaceId: string, snapshot: PeriodsSnapshot) => void;
  /** A escuta do workspace é encerrada por erro (como o SDK faz ao perder o acesso). */
  failListen: (workspaceId: string) => void;
  subscriptions: Map<string, number>;
  /** Escutas abertas por workspace, no total (reaberturas incluídas). */
  opened: Map<string, number>;
  readExcluded: () => Promise<{version: number}>;
  excludedReads: number;
  /** Atraso da leitura por id (para expor uma releitura no meio). */
  excludedDelayMs: number;
  /** Chamado quando a leitura por id dada termina de ler, antes de responder (para parar o relógio). */
  excludedLanded: ((version: number) => void) | null;
  /** A callable lê a receita no começo da chamada e responde depois do atraso (padrão: no fim). */
  readAtStart: boolean;
}

const fake = (): Fake => {
  // Como no SDK, cada escuta recebe os retornos do próprio alvo (várias por workspace).
  const listeners = new Map<string, Set<(snapshot: PeriodsSnapshot) => void>>();
  const errorHandlers = new Map<(snapshot: PeriodsSnapshot) => void, () => void>();
  const state: Fake = {
    receipts: {'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000},
    extraReceipts: {[EXTRA_MONTH]: 90_000},
    status: 'exact',
    failing: false,
    failingWs: null,
    failingMonth: false,
    calls: 0,
    seriesCalls: 0,
    monthCalls: 0,
    seriesDelayMs: 2,
    monthDelayMs: 2,
    log: [],
    subscriptions: new Map(),
    opened: new Map(),
    excludedReads: 0,
    excludedDelayMs: 0,
    excludedLanded: null,
    readAtStart: false,
    readExcluded: async () => {
      state.excludedReads += 1;
      const version = state.excludedReads;
      state.log.push('exclusões');
      if (state.excludedDelayMs > 0) await wait(state.excludedDelayMs);
      state.excludedLanded?.(version);
      return {version};
    },
    emit: (workspaceId, snapshot) => {
      const active = [...(listeners.get(workspaceId) ?? [])];
      assert.ok(active.length > 0, `escuta ativa em ${workspaceId}`);
      act(() => active.forEach((listener) => listener(snapshot)));
    },
    failListen: (workspaceId) => {
      const active = [...(listeners.get(workspaceId) ?? [])];
      assert.ok(active.length > 0, `escuta ativa em ${workspaceId}`);
      // Depois do erro, nenhum retorno chega mais a essa escuta.
      act(() => active.forEach((listener) => {
        listeners.get(workspaceId)?.delete(listener);
        errorHandlers.get(listener)?.();
      }));
    },
    deps: {
      fetchReport: async (payload) => {
        state.calls += 1;
        const exact = state.status === 'exact';
        if (payload.range.kind === 'month') {
          state.monthCalls += 1;
          state.log.push('mês avulso');
          const month = payload.range.month;
          const early = state.extraReceipts[month] ?? 0;
          await wait(state.monthDelayMs);
          if (state.failingMonth) throw new Error('Não foi possível carregar o relatório. Tente novamente.');
          return {
            referenceDate: '2026-11-04',
            workspaceType: 'PF',
            generatedAt: `gerado-${state.calls}`,
            period: {range: payload.range},
            cash: {status: state.status, data: exact ? {receiptsCents: state.readAtStart ? early : state.extraReceipts[month] ?? 0} : null},
          } as unknown as FinancialReport;
        }
        state.seriesCalls += 1;
        state.log.push('relatório');
        const early = {...state.receipts};
        await wait(state.seriesDelayMs);
        if (state.failing || state.failingWs === payload.workspaceId) throw new Error('Não foi possível carregar o relatório. Tente novamente.');
        const receipts = state.readAtStart ? early : state.receipts;
        return {
          referenceDate: '2026-11-04',
          workspaceType: 'PF',
          generatedAt: `gerado-${state.calls}`,
          series: {
            status: state.status,
            data: exact ? {points: Object.entries(receipts).map(([month, receiptsCents]) => ({month, receiptsCents, partial: false}))} : null,
          },
        } as unknown as FinancialReport;
      },
      subscribePeriods: (workspaceId, _first, _last, onNext, onError) => {
        const set = listeners.get(workspaceId) ?? new Set();
        set.add(onNext);
        listeners.set(workspaceId, set);
        errorHandlers.set(onNext, onError);
        state.subscriptions.set(workspaceId, (state.subscriptions.get(workspaceId) ?? 0) + 1);
        state.opened.set(workspaceId, (state.opened.get(workspaceId) ?? 0) + 1);
        return () => {
          listeners.get(workspaceId)?.delete(onNext);
          errorHandlers.delete(onNext);
          state.subscriptions.set(workspaceId, (state.subscriptions.get(workspaceId) ?? 0) - 1);
        };
      },
      // Agrupamento curto (o real é de 5 s; o da mutação, de 30 s), mas maior que uma renderização com dois observadores.
      refresh: {options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 100, refillMs: 60_000}},
    },
  };
  return state;
};

/** Documentos da projeção para os meses dados (receita por mês). */
const server = (income: MonthlyIncome, changes = Object.keys(income).length): PeriodsSnapshot => ({
  documents: Object.entries(income).map(([id, incomeCents]) => ({id, incomeCents, expenseCents: 0})),
  fromCache: false,
  changes,
});

interface Probe {
  basisIncome: MonthlyIncome | null;
  syncing: boolean;
  /** A estimativa seguraria o valor anterior nesta renderização. */
  holding: boolean;
  /** A escuta das projeções foi encerrada por erro. */
  listenFailed: boolean;
  retryListen: () => void;
  dataUpdatedAt: number;
  /** Versão da leitura por id que esta renderização vê. */
  excluded: number | undefined;
  /** `dataUpdatedAt` dessa leitura. */
  excludedAt: number;
}

/**
 * As bases como `useIncomeEstimateWith` as monta: a série e, com `extraMonth`, o mês avulso, que só
 * começa a ser lido quando a série chega (o mês sai do "hoje" dela).
 */
const Probe = ({f, uid, workspaceId, sink, withExcluded = true, months = WINDOW, extraMonth = null}: {
  f: Fake; uid: string; workspaceId: string; sink: (probe: Probe) => void; withExcluded?: boolean;
  months?: readonly string[]; extraMonth?: string | null;
}) => {
  const series = useFinancialReportBasisWith(f.deps, uid, workspaceId, RANGE, SECTIONS);
  const extraRange = useMemo<ReportRange>(() => (extraMonth ? {kind: 'month', month: extraMonth} : RANGE), [extraMonth]);
  const extra = useFinancialReportBasisWith(f.deps, uid, workspaceId, extraRange, CASH, {enabled: extraMonth !== null && !!series.data});
  const basis = useMemo<BasisView | null>(() => {
    if (!series.data || (extraMonth && !extra.data)) return null;
    return {
      income: basisIncomeOf(
        series.data.series.data?.points ?? [],
        extraMonth && extra.data ? {month: extraMonth, receiptsCents: extra.data.cash.data?.receiptsCents ?? 0} : null,
      ),
      exact: series.data.series.status === 'exact' && (!extraMonth || extra.data?.cash.status === 'exact'),
      versions: extraMonth ? [series.dataUpdatedAt, extra.dataUpdatedAt] : [series.dataUpdatedAt],
      keys: extraMonth
        ? [basisKeyOf(uid, workspaceId, RANGE, SECTIONS), basisKeyOf(uid, workspaceId, extraRange, CASH)]
        : [basisKeyOf(uid, workspaceId, RANGE, SECTIONS)],
      fetching: series.fetchStatus !== 'idle' || (!!extraMonth && extra.fetchStatus !== 'idle'),
    };
  }, [series.data, series.dataUpdatedAt, series.fetchStatus, extra.data, extra.dataUpdatedAt, extra.fetchStatus, extraMonth, extraRange, uid, workspaceId]);
  // A leitura por id das exclusões, como a estimativa a usa (na chave que `refreshIncomeReads` relê).
  const excluded = useTransactionsByIdsWith(f.readExcluded, workspaceId, ['p5f1'], {enabled: withExcluded});
  const {syncing, holding, listenFailed, retryListen} = useFinancialReportBasisLiveRefreshWith(
    f.deps, uid, workspaceId, months, basis, withExcluded ? excluded.data : null,
  );
  sink({
    basisIncome: basis?.income ?? null, syncing, holding, listenFailed, retryListen, dataUpdatedAt: series.dataUpdatedAt,
    excluded: excluded.data?.version, excludedAt: excluded.dataUpdatedAt,
  });
  return null;
};

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  clearBasisRegistry();
});

const mount = (f: Fake, props: {
  uid?: string; workspaceId?: string; withExcluded?: boolean; twice?: boolean; renders?: Probe[][];
  months?: readonly string[]; extraMonth?: string | null;
} = {}) => {
  const client = new QueryClient({defaultOptions: {queries: {retryDelay: 1, refetchOnWindowFocus: false}}});
  const probe: {current: Probe | null} = {current: null};
  const record = (index: number, value: Probe) => { props.renders?.[index]?.push(value); };
  const common = {f, uid: props.uid ?? 'u1', months: props.months, extraMonth: props.extraMonth};
  const element = (workspaceId: string) => createElement(QueryClientProvider, {client},
    createElement(Probe, {...common, workspaceId, sink: (value: Probe) => { probe.current = value; record(0, value); }, withExcluded: props.withExcluded}),
    ...(props.twice ? [createElement(Probe, {
      ...common, workspaceId, sink: (value: Probe) => record(1, value), withExcluded: props.renders !== undefined,
    })] : []));
  act(() => { renderer = TestRenderer.create(element(props.workspaceId ?? 'ws-a')); });
  return {client, probe, rerender: (workspaceId: string) => act(() => renderer?.update(element(workspaceId)))};
};

/** Uma estimativa cuja janela muda (por exemplo, "meses do histórico" trocado e salvo), com o mês avulso dos 12 meses. */
const mountWindow = (f: Fake, months: readonly string[], renders: Probe[], options: {withExcluded?: boolean} = {}) => {
  const client = new QueryClient({defaultOptions: {queries: {retryDelay: 1, refetchOnWindowFocus: false}}});
  const probe: {current: Probe | null} = {current: null};
  const element = (window: readonly string[], extraMonth: string | null) => createElement(QueryClientProvider, {client},
    createElement(Probe, {f, uid: 'u1', workspaceId: 'ws-a', months: window, extraMonth, withExcluded: options.withExcluded ?? true,
      sink: (value: Probe) => { probe.current = value; renders.push(value); }}));
  act(() => { renderer = TestRenderer.create(element(months, null)); });
  return {client, probe, setWindow: (window: readonly string[], extraMonth: string | null = null) => act(() => renderer?.update(element(window, extraMonth)))};
};

/** Uma estimativa de 3 meses e, depois, uma de 12 meses (por exemplo, o provedor e a prévia de Configurações), no mesmo cache. */
const mountShortAndLong = (f: Fake) => {
  const client = new QueryClient({defaultOptions: {queries: {retryDelay: 1, refetchOnWindowFocus: false}}});
  const probes: {short: Probe | null; long: Probe | null} = {short: null, long: null};
  const longRenders: Probe[] = [];
  const show: {current: ((on: boolean) => void) | null} = {current: null};
  const Root = () => {
    const [on, setOn] = useState(false);
    show.current = setOn;
    return createElement(QueryClientProvider, {client},
      createElement(Probe, {f, uid: 'u1', workspaceId: 'ws-a', sink: (value: Probe) => { probes.short = value; }}),
      on ? createElement(Probe, {f, uid: 'u1', workspaceId: 'ws-a', months: WINDOW_12, extraMonth: EXTRA_MONTH,
        sink: (value: Probe) => { probes.long = value; longRenders.push(value); }}) : null);
  };
  act(() => { renderer = TestRenderer.create(createElement(Root)); });
  return {client, probes, longRenders, showLong: () => act(() => show.current?.(true))};
};

/** Relógio dos agendadores que só anda quando o teste manda; as leituras e o React Query seguem o relógio real. */
const manualClock = () => {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, {at: number; run: () => void}>();
  const clock: LiveRefreshClock = {
    now: () => now,
    setTimer: (run, ms) => { nextId += 1; timers.set(nextId, {at: now + ms, run}); return nextId; },
    clearTimer: (handle) => { timers.delete(handle as number); },
  };
  const advance = (ms: number) => act(() => {
    const target = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].run();
    }
    now = target;
  });
  return {clock, advance};
};

/** O provedor montado e, depois, a prévia de Configurações (outra janela), na mesma sessão e no mesmo cache. */
const mountPair = (f: Fake) => {
  const client = new QueryClient({defaultOptions: {queries: {retryDelay: 1, refetchOnWindowFocus: false}}});
  const probes: {provider: Probe | null; preview: Probe | null} = {provider: null, preview: null};
  const show: {current: ((on: boolean) => void) | null} = {current: null};
  const Root = () => {
    const [on, setOn] = useState(false);
    show.current = setOn;
    return createElement(QueryClientProvider, {client},
      createElement(Probe, {f, uid: 'u1', workspaceId: 'ws-a', sink: (value: Probe) => { probes.provider = value; }}),
      on ? createElement(Probe, {f, uid: 'u1', workspaceId: 'ws-a', months: ['2026-09', '2026-10'], sink: (value: Probe) => { probes.preview = value; }}) : null);
  };
  act(() => { renderer = TestRenderer.create(createElement(Root)); });
  return {client, probes, showPreview: (on: boolean) => act(() => show.current?.(on))};
};

test('primeiro retorno confirmado com receita diferente relê a base, e as exclusões só depois dela', async () => {
  const f = fake();
  const {probe} = mount(f);
  await until(() => probe.current?.basisIncome !== null && f.excludedReads === 1, 'base e exclusões iniciais');
  assert.deepEqual(f.log, ['relatório', 'exclusões']);
  // Receita retroativa em outubro, gravada entre a leitura da base e o primeiro retorno da escuta.
  f.receipts['2026-10'] = 150_000;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 150_000}));
  assert.equal(probe.current?.syncing, true, 'sincronizando desde o pedido');
  await until(() => probe.current?.holding === false && f.excludedReads === 2, 'base e exclusões relidas');
  assert.deepEqual(f.log, ['relatório', 'exclusões', 'relatório', 'exclusões'], 'as exclusões são relidas depois da base nova');
  assert.equal(probe.current?.basisIncome?.['2026-10'], 150_000);
  // Convergiu: o mesmo retorno de novo não relê nada.
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 150_000}, 0));
  await settle();
  assert.equal(f.calls, 2);
});

test('retorno só do cache local não compara; o do servidor, igual à base, não relê', async () => {
  const f = fake();
  const {probe} = mount(f);
  await until(() => probe.current?.basisIncome !== null, 'base inicial');
  // O cache traz só outubro (outro alvo segura esse documento): agosto e setembro valeriam 0.
  f.emit('ws-a', {documents: [{id: '2026-10', incomeCents: 100_000}], fromCache: true, changes: 1});
  await settle();
  assert.equal(f.calls, 1, 'nenhuma releitura pelo retorno do cache');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle();
  assert.equal(f.calls, 1, 'o servidor confirma a base');
  assert.equal(probe.current?.syncing, false);
});

test('estado que volta: cada mudança de receita relê, mesmo repetindo um estado anterior', async () => {
  const f = fake();
  const {probe} = mount(f);
  await until(() => probe.current?.basisIncome !== null, 'base inicial');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(30);
  // Outra sessão edita outubro e desfaz, várias vezes.
  for (const [round, value] of [120_000, 100_000, 120_000, 100_000, 120_000].entries()) {
    f.receipts['2026-10'] = value;
    f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': value}, 1));
    await until(() => probe.current?.basisIncome?.['2026-10'] === value && probe.current?.syncing === false, `rodada ${round + 1}`);
  }
  assert.equal(f.calls, 6, 'uma leitura inicial e uma releitura por mudança');
});

test('base sem bloco exato: relê no primeiro retorno do servidor e a cada mudança dos documentos, sem laço', async () => {
  const f = fake();
  f.status = 'needs_rebuild';
  const {probe} = mount(f, {withExcluded: false});
  await until(() => f.calls === 1 && probe.current?.dataUpdatedAt !== 0, 'base inicial (aguardando reconstrução)');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await until(() => f.calls === 2, 'releitura no primeiro retorno do servidor');
  await settle();
  assert.equal(f.calls, 2, 'a base nova (outro generatedAt) não relê de novo: sem laço');
  assert.deepEqual([probe.current?.syncing, probe.current?.holding], [false, false], 'a releitura sem bloco exato libera a sincronização');
  // A reconstrução publica os meses com a mesma receita: os documentos mudam e a base é relida, agora exata.
  f.status = 'exact';
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}, 3));
  await until(() => probe.current?.basisIncome?.['2026-10'] === 100_000, 'base exata depois da publicação');
  assert.equal(f.calls, 3);
  await settle();
  assert.equal(f.calls, 3, 'exata e igual à projeção: nada mais');
  assert.deepEqual([probe.current?.syncing, probe.current?.holding], [false, false]);
});

test('teto de falhas: duas releituras falhas param; só a projeção nova e a virada do mês reabrem (R4-03)', async () => {
  const f = fake();
  const {client, probe} = mount(f, {withExcluded: false});
  await until(() => probe.current?.basisIncome !== null, 'base inicial');
  f.failing = true;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 130_000}));
  // Cada releitura falha duas vezes (retry: 1); depois de duas releituras falhas, o agendador para.
  await until(() => f.calls === 5, 'duas releituras com uma nova tentativa cada');
  await settle(200);
  assert.equal(f.calls, 5, 'parado no teto, sem releitura indefinida');
  assert.equal(probe.current?.basisIncome?.['2026-10'], 100_000, 'a leitura anterior continua valendo');
  assert.equal(probe.current?.syncing, true, 'a estimativa segura a última versão consistente (a tela avisa a falha)');
  // Mutações nesta aba e o listener do mês do App invalidam os relatórios das telas: a base parada
  // no teto não é relida por isso (nem tem dado novo para trazer antes de a projeção mudar).
  for (let round = 0; round < 4; round += 1) await act(async () => { await invalidateFinancialReports(client); });
  for (let round = 0; round < 4; round += 1) await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  await settle(200);
  assert.equal(f.calls, 5, 'invalidações dos relatórios e mutações nesta aba não reabrem o teto');
  // Uma receita nova (outra divergência) zera as falhas: duas releituras de novo, e de novo o teto.
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 140_000}, 1));
  await until(() => f.calls === 9, 'duas releituras depois da divergência nova');
  await settle(200);
  assert.equal(f.calls, 9, 'parado no teto de novo');
  // A virada do mês reabre todas as bases carregadas: a base volta a ser relida e alcança a projeção.
  f.failing = false;
  f.receipts['2026-10'] = 140_000;
  await act(async () => { await invalidateFinancialReportBases(client); });
  await until(() => probe.current?.basisIncome?.['2026-10'] === 140_000 && probe.current?.syncing === false, 'base relida na virada do mês');
  assert.equal(f.calls, 10);
});

test('base que nunca carregou fica fora do agendador: nem invalidação, nem projeção, nem virada do mês a relêem (R4-03)', async () => {
  const f = fake();
  f.failingMonth = true;
  const {client, probe} = mount(f, {withExcluded: false, months: WINDOW_12, extraMonth: EXTRA_MONTH});
  await until(() => f.monthCalls === 2 && probe.current?.dataUpdatedAt !== 0, 'série carregada; mês avulso falhou duas vezes (retry: 1)');
  await settle(150);
  assert.equal(probe.current?.basisIncome, null, 'sem o mês avulso, nada a comparar');
  for (let round = 0; round < 4; round += 1) await act(async () => { await invalidateFinancialReports(client); });
  f.emit('ws-a', server({[EXTRA_MONTH]: 95_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 130_000}));
  await settle(200);
  assert.deepEqual([f.seriesCalls, f.monthCalls], [1, 2], 'nada relido enquanto o mês avulso não carregou');
  // A virada do mês relê a série (carregada), não o mês avulso: esse espera "Tentar de novo" ou uma montagem nova.
  await act(async () => { await invalidateFinancialReportBases(client); });
  await until(() => f.seriesCalls === 2, 'série relida na virada do mês');
  await settle(200);
  assert.deepEqual([f.seriesCalls, f.monthCalls], [2, 2]);
});

test('dois observadores da mesma base dividem o agendador: uma releitura por mudança', async () => {
  const f = fake();
  const {probe} = mount(f, {twice: true, withExcluded: false});
  await until(() => probe.current?.basisIncome !== null, 'base inicial');
  assert.equal(f.calls, 1, 'uma leitura para os dois');
  f.receipts['2026-09'] = 90_000;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 90_000, '2026-10': 100_000}));
  await until(() => probe.current?.basisIncome?.['2026-09'] === 90_000, 'base relida');
  await settle();
  assert.equal(f.calls, 2);
});

test('troca de workspace: a escuta anterior é cancelada e a nova compara com a própria base', async () => {
  const f = fake();
  const {probe, rerender} = mount(f, {withExcluded: false});
  await until(() => probe.current?.basisIncome !== null, 'base de ws-a');
  assert.equal(f.subscriptions.get('ws-a'), 1);
  rerender('ws-b');
  await until(() => f.calls === 2 && probe.current?.basisIncome !== null, 'base de ws-b');
  assert.equal(f.subscriptions.get('ws-a'), 0, 'escuta de ws-a cancelada');
  assert.equal(f.subscriptions.get('ws-b'), 1);
  f.emit('ws-b', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle();
  assert.equal(f.calls, 2, 'ws-b igual à própria base: nada a reler');
});

test('duas estimativas (provedor e prévia) relendo as mesmas exclusões: nenhuma combina base nova com exclusões antigas', async () => {
  const f = fake();
  f.excludedDelayMs = 40;
  const renders: Probe[][] = [[], []];
  const {probe} = mount(f, {twice: true, renders});
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  f.receipts['2026-10'] = 150_000;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 150_000}));
  await until(() => renders.every((list) => {
    const last = list[list.length - 1];
    return last?.holding === false && last.basisIncome?.['2026-10'] === 150_000 && (last.excluded ?? 0) > 1;
  }), 'as duas estimativas sincronizadas');
  for (const [index, list] of renders.entries()) {
    const mixed = list.filter((render) => !render.holding && render.basisIncome?.['2026-10'] === 150_000 && render.excluded === 1);
    assert.deepEqual(mixed, [], `estimativa ${index + 1}: nenhuma renderização usaria a base nova com as exclusões antigas`);
    assert.ok(list.some((render) => render.holding && render.basisIncome?.['2026-10'] === 150_000), `estimativa ${index + 1}: segurou enquanto as exclusões eram relidas`);
  }
  assert.equal(f.calls, 2, 'uma releitura da base para as duas');
  assert.equal(f.excludedReads, 2, 'uma releitura das exclusões para as duas: a segunda não cancela a que está em curso');
});

test('troca de workspace: a retenção de uma sincronização não passa para outro workspace (R4-05)', async () => {
  const f = fake();
  const {probe, rerender} = mount(f, {workspaceId: 'ws-b'});
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'ws-b carregado');
  rerender('ws-a');
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 2, 'ws-a carregado');
  // Sincronização em ws-a: a base e, depois dela, as exclusões de ws-a são relidas.
  f.receipts['2026-10'] = 150_000;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 150_000}));
  await until(() => probe.current?.holding === false && probe.current?.excluded === 3, 'ws-a sincronizado');
  // De volta a ws-b, com a leitura por id ainda no cache (fresca): nada a esperar ali.
  rerender('ws-b');
  await settle(150);
  assert.equal(probe.current?.excluded, 1, 'a leitura de ws-b vem do cache');
  assert.deepEqual([probe.current?.syncing, probe.current?.holding], [false, false], 'nenhuma retenção herdada de ws-a');
});

test('marco sem relógio: o relógio do aparelho voltando para trás não prende a retenção (R4-05)', async () => {
  const f = fake();
  const {probe} = mount(f);
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  f.excludedDelayMs = 80;
  f.receipts['2026-10'] = 150_000;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 150_000}));
  await until(() => probe.current?.syncing === false && probe.current?.basisIncome?.['2026-10'] === 150_000, 'base nova; exclusões em releitura');
  assert.equal(probe.current?.holding, true, 'segura até as exclusões chegarem');
  const realNow = Date.now;
  Date.now = () => realNow() - 3_600_000;
  try {
    await until(() => probe.current?.holding === false, 'as exclusões chegam com o relógio uma hora atrás');
  } finally {
    Date.now = realNow;
  }
  assert.equal(probe.current?.excluded, 2);
});

test('janela de 12 meses: o mês avulso ainda carregando não conta como base sem bloco exato (R4-02)', async () => {
  const f = fake();
  f.monthDelayMs = 80;
  const {probe} = mount(f, {months: WINDOW_12, extraMonth: EXTRA_MONTH});
  await until(() => probe.current?.dataUpdatedAt !== 0 && f.monthCalls === 1, 'série carregada; mês avulso em leitura');
  // O primeiro retorno da escuta chega antes do mês avulso: só é guardado.
  f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  assert.equal(probe.current?.syncing, false, 'nada pedido enquanto uma base carrega');
  await until(() => probe.current?.basisIncome?.[EXTRA_MONTH] === 90_000 && probe.current?.excluded === 1, 'as duas bases e as exclusões');
  await settle(250);
  assert.deepEqual([f.seriesCalls, f.monthCalls, f.excludedReads], [1, 1, 1], 'duas chamadas e uma leitura por id na carga');
  assert.deepEqual([probe.current?.syncing, probe.current?.holding], [false, false]);
});

for (const order of [{seriesDelayMs: 60, monthDelayMs: 15, name: 'mês avulso primeiro'}, {seriesDelayMs: 15, monthDelayMs: 60, name: 'série primeiro'}]) {
  test(`janela de 12 meses, ${order.name}: cada base relida uma vez e as exclusões uma vez por mudança, sem renderização mista (R4-02)`, async () => {
    const f = fake();
    const renders: Probe[][] = [[]];
    const {probe} = mount(f, {months: WINDOW_12, extraMonth: EXTRA_MONTH, renders});
    await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'carga');
    f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
    await settle(150);
    assert.deepEqual([f.seriesCalls, f.monthCalls, f.excludedReads], [1, 1, 1]);
    // Outra sessão muda outubro (série) e novembro de 2025 (mês avulso).
    f.seriesDelayMs = order.seriesDelayMs;
    f.monthDelayMs = order.monthDelayMs;
    f.receipts['2026-10'] = 150_000;
    f.extraReceipts[EXTRA_MONTH] = 95_000;
    f.emit('ws-a', server({[EXTRA_MONTH]: 95_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 150_000}, 2));
    await until(() => probe.current?.holding === false && probe.current?.excluded === 2 &&
      probe.current?.basisIncome?.['2026-10'] === 150_000 && probe.current?.basisIncome?.[EXTRA_MONTH] === 95_000, 'sincronizado');
    await settle(250);
    assert.deepEqual([f.seriesCalls, f.monthCalls, f.excludedReads], [2, 2, 2], 'uma releitura de cada base e uma das exclusões');
    const mixed = renders[0].filter((render) => !render.holding && render.excluded === 1 &&
      (render.basisIncome?.['2026-10'] === 150_000 || render.basisIncome?.[EXTRA_MONTH] === 95_000));
    assert.deepEqual(mixed, [], 'nenhuma renderização livre com uma base nova e as exclusões antigas');
    const halfway = renders[0].filter((render) => !render.holding &&
      (render.basisIncome?.['2026-10'] === 150_000) !== (render.basisIncome?.[EXTRA_MONTH] === 95_000));
    assert.deepEqual(halfway, [], 'nenhuma renderização livre com só uma das bases nova');
  });
}

test('mutação nesta aba relê a base carregada do workspace, nunca as exclusões (R5-02)', async () => {
  const f = fake();
  const {client, probe} = mount(f);
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(100);
  // O gatilho desiste e marca a projeção para reconstrução: os documentos mensais não mudam.
  f.status = 'needs_rebuild';
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  await until(() => f.calls === 2 && probe.current?.basisIncome !== null, 'base relida pela mutação');
  await settle(150);
  assert.equal(f.excludedReads, 1, 'as exclusões seguem a base, pela sincronização: a mutação não as relê');
  assert.deepEqual([probe.current?.syncing, probe.current?.holding], [false, false]);
  await act(async () => { await invalidateTransactionReads(client, 'ws-b'); });
  await settle(150);
  assert.equal(f.calls, 2, 'mutação em outro workspace não relê esta base');
});

test('escuta encerrada por erro: a estimativa avisa, e "Tentar de novo" a reabre (R5-02)', async () => {
  const f = fake();
  const {probe} = mount(f, {withExcluded: false});
  await until(() => probe.current?.basisIncome !== null, 'base inicial');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(50);
  assert.equal(probe.current?.listenFailed, false);
  const opened = f.opened.get('ws-a') ?? 0;
  f.failListen('ws-a');
  await settle(50);
  assert.equal(probe.current?.listenFailed, true, 'o SDK não reabre a escuta: a tela avisa');
  assert.equal(f.opened.get('ws-a'), opened, 'nada reabre sozinho');
  act(() => probe.current?.retryListen());
  await until(() => f.opened.get('ws-a') === opened + 1, 'escuta reaberta');
  assert.equal(probe.current?.listenFailed, false);
  assert.equal(f.subscriptions.get('ws-a'), 1, 'a escuta antiga foi desfeita');
  // A escuta reaberta volta a comparar: uma receita nova relê a base.
  f.receipts['2026-10'] = 120_000;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 120_000}));
  await until(() => probe.current?.basisIncome?.['2026-10'] === 120_000 && probe.current?.syncing === false, 'base relida');
});

test('troca de workspace com pedido em curso: nada é liberado no outro workspace, e nada fica preso na volta (R5-03)', async () => {
  const f = fake();
  const {probe, rerender} = mount(f);
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'ws-a carregado');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(50);
  // Em ws-a, a releitura falha: o pedido fica em curso.
  f.failingWs = 'ws-a';
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 130_000}, 1));
  assert.equal(probe.current?.syncing, true);
  rerender('ws-b');
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 2, 'ws-b carregado');
  f.emit('ws-b', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(150);
  assert.equal(f.excludedReads, 2, 'o pedido de ws-a não libera nada em ws-b (nenhuma releitura das exclusões de ws-b)');
  assert.deepEqual([probe.current?.syncing, probe.current?.holding], [false, false]);
  // De volta a ws-a, com a projeção igual à base: nada a esperar.
  f.failingWs = null;
  rerender('ws-a');
  await until(() => probe.current?.basisIncome !== null, 'ws-a de volta');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}, 1));
  await settle(150);
  assert.deepEqual([probe.current?.syncing, probe.current?.holding], [false, false], 'a espera de antes não fica presa');
});

test('tentativas esgotadas com um pedido em curso: as exclusões só são relidas depois da base (R5-03)', async () => {
  const f = fake();
  const {probe} = mount(f);
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  // A projeção diz 130.000, mas o relatório continua em 100.000: duas releituras e a liberação com o que chegou.
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 130_000}));
  await until(() => f.calls === 3 && probe.current?.syncing === false && f.excludedReads === 2, 'tentativas esgotadas');
  // Uma mudança nova pede releitura (lenta); antes de ela chegar, a projeção volta ao estado já esgotado.
  f.seriesDelayMs = 150;
  f.receipts['2026-10'] = 140_000;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 140_000}, 1));
  const before = f.log.length;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 130_000}, 1));
  await until(() => probe.current?.basisIncome?.['2026-10'] === 140_000 && probe.current?.holding === false, 'base nova e liberação');
  await settle(150);
  assert.deepEqual(f.log.slice(before), ['relatório', 'exclusões'], 'a base primeiro, as exclusões depois');
});

test('registro das bases: a escuta relê só as bases da estimativa; a mutação, pelo agendador dela, as carregadas do workspace e fora do teto', () => {
  clearBasisRegistry();
  const notified: string[] = [];
  const entry = (key: string, workspaceId: string, loaded: boolean, failures: number): BasisRefreshEntry => ({
    scheduler: {notify: () => { notified.push(key); }, cancel: () => undefined, scheduled: () => false},
    mutationScheduler: {notify: () => { notified.push(`mutação:${key}`); }, cancel: () => undefined, scheduled: () => false},
    users: 1,
    failure: {dataUpdatedAt: 1, errorUpdatedAt: 0, failures},
    maxFailures: 2,
    workspaceId,
    loaded: () => loaded,
  });
  basisRefreshes.set('serie-a', entry('serie-a', 'ws-a', true, 0));
  basisRefreshes.set('mes-a', entry('mes-a', 'ws-a', true, 2));
  basisRefreshes.set('serie-b', entry('serie-b', 'ws-b', true, 0));
  basisRefreshes.set('nunca-a', entry('nunca-a', 'ws-a', false, 0));
  refreshRegisteredBases(['serie-a']);
  assert.deepEqual(notified, ['serie-a'], 'só as chaves pedidas');
  notified.length = 0;
  rereadWorkspaceBases('ws-a');
  assert.deepEqual(notified, ['mutação:serie-a'], 'do workspace, carregada e fora do teto, pelo agendador da mutação (sem gastar o da escuta)');
  assert.equal(basisRefreshes.get('mes-a')?.failure.failures, 2, 'a mutação não zera as falhas');
  notified.length = 0;
  refreshRegisteredBases();
  assert.deepEqual(notified.sort(), ['mes-a', 'serie-a', 'serie-b'], 'a virada do mês reabre todas as carregadas');
  assert.equal(basisRefreshes.get('mes-a')?.failure.failures, 0);
  // Releitura pendente em qualquer um dos dois agendadores, pedida depois do começo da última leitura (R8-01).
  const pendingIn = (which: 'escuta' | 'mutação' | null): BasisRefreshEntry => ({
    ...entry('x', 'ws-a', true, 0),
    scheduler: {notify: () => undefined, cancel: () => undefined, scheduled: () => which === 'escuta'},
    mutationScheduler: {notify: () => undefined, cancel: () => undefined, scheduled: () => which === 'mutação'},
  });
  const keys = ['p-escuta', 'p-mutacao', 'p-nada', 'ausente'];
  basisRefreshes.set('p-escuta', pendingIn('escuta'));
  basisRefreshes.set('p-mutacao', pendingIn('mutação'));
  basisRefreshes.set('p-nada', pendingIn(null));
  for (const key of keys) noteBasisReadStart(key);
  for (const key of keys.slice(0, 3)) scheduleBasisReread(key, basisRefreshes.get(key)?.scheduler ?? {notify: () => undefined});
  assert.deepEqual(keys.map(basisRereadScheduled), [true, true, false, false]);
  // Uma leitura que começou depois do pedido já lê um estado pelo menos tão novo: a releitura pendente não segura.
  noteBasisReadStart('p-escuta');
  assert.deepEqual(keys.map(basisRereadScheduled), [false, true, false, false]);
});

test('registro das bases: a leitura em uso cobre os pedidos anteriores ao começo dela, e as bases ficam fora de passo só quando uma leu um pedido que outra ainda vai ler (R10-01)', () => {
  clearBasisRegistry();
  const pending = new Map<string, boolean>();
  const scheduler = (key: string) => ({notify: () => { pending.set(key, true); }, cancel: () => undefined, scheduled: () => pending.get(key) === true});
  for (const key of ['serie', 'mes']) {
    basisRefreshes.set(key, {
      scheduler: scheduler(key), mutationScheduler: scheduler(key), users: 1,
      failure: {dataUpdatedAt: 1, errorUpdatedAt: 0, failures: 0}, maxFailures: 2, workspaceId: 'ws-a', loaded: () => true,
    });
  }
  const keys = ['serie', 'mes'];
  const ask = () => { for (const key of keys) scheduleBasisReread(key, basisRefreshes.get(key)?.mutationScheduler ?? {notify: () => undefined}); };
  /** O agendador dispara: a leitura começa; a função devolvida é a chegada dela, com dados. */
  const fire = (key: string) => {
    pending.set(key, false);
    const started = noteBasisReadStart(key);
    return () => noteBasisReadServed(key, started);
  };
  // As duas leituras começam, e durante elas chega um pedido para as duas (por exemplo, uma mutação nesta aba).
  const serieLands = fire('serie');
  const mesLands = fire('mes');
  ask();
  serieLands();
  mesLands();
  assert.equal(basesOutOfStep(keys), false, 'as duas leram antes do mesmo pedido pendente: em passo');
  assert.deepEqual(keys.map(basisRereadScheduled), [true, true], 'o pedido continua pendente nas duas');
  // A releitura pendente da série sai antes da do mês: a série leu um pedido que o mês ainda vai ler.
  fire('serie')();
  assert.equal(basesOutOfStep(keys), true, 'a série à frente do mês');
  fire('mes')();
  assert.equal(basesOutOfStep(keys), false, 'o mês relido: em passo de novo');
  // A base que não vai ser relida (sem releitura pendente, como no teto) não segura a outra.
  ask();
  fire('serie')();
  pending.set('mes', false);
  assert.equal(basesOutOfStep(keys), false, 'o mês sem releitura pendente não segura a série');
  // Uma leitura cancelada por outra que começou depois não passa a ser a leitura em uso.
  fire('mes')();
  ask();
  const cancelled = fire('mes');
  fire('serie')();
  const fresh = fire('mes');
  cancelled();
  ask();
  assert.equal(basesOutOfStep(keys), true, 'o mês continua com o pedido anterior à leitura cancelada: a série está à frente');
  fresh();
  fire('serie')();
  fire('mes')();
  assert.equal(basesOutOfStep(keys), false);
  assert.deepEqual(keys.map(basisRereadScheduled), [false, false]);
  // A leitura que começou depois do pedido e falhou (sem dados) não põe a base à frente: os dados dela continuam os de
  // antes do pedido, em passo com o mês, que ainda vai ser relido.
  ask();
  fire('serie');
  assert.equal(basesOutOfStep(keys), false, 'a série que falhou não está à frente do mês');
  fire('serie')();
  assert.equal(basesOutOfStep(keys), true, 'relida com dados, a série fica à frente');
  fire('mes')();
  assert.equal(basesOutOfStep(keys), false);
});

test('base nova sem pedido (a releitura da mutação, depois do gatilho) antes do retorno da escuta: segura na mesma renderização, relê as exclusões depois dela e não pede outra releitura (R6-02)', async () => {
  const f = fake();
  f.excludedDelayMs = 30;
  const renders: Probe[][] = [[]];
  const {client, probe} = mount(f, {renders});
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(100);
  const before = f.log.length;
  // Nesta aba, uma receita de outubro é anulada; o gatilho grava a projeção antes de a releitura da
  // mutação ler a base, e a escuta ainda não trouxe o retorno.
  f.receipts['2026-10'] = 60_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  await until(() => probe.current?.basisIncome?.['2026-10'] === 60_000 && probe.current?.excluded === 2 && probe.current?.holding === false,
    'base nova e exclusões relidas');
  assert.deepEqual(f.log.slice(before), ['relatório', 'exclusões'], 'a base primeiro, as exclusões depois');
  const mixed = renders[0].filter((render) => !render.holding && render.basisIncome?.['2026-10'] === 60_000 && render.excluded === 1);
  assert.deepEqual(mixed, [], 'nenhuma renderização livre com a base nova e as exclusões antigas');
  assert.ok(renders[0].some((render) => render.holding && render.basisIncome?.['2026-10'] === 60_000 && render.excluded === 1),
    'segurou já na renderização em que a base nova chegou');
  // Só agora a escuta traz a projeção, igual à base: nada mais é relido.
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 60_000}, 1));
  await settle(150);
  assert.deepEqual([f.calls, f.excludedReads], [2, 2], 'a carga e a releitura da mutação; nenhuma releitura contra a projeção ainda velha');
  assert.deepEqual([probe.current?.syncing, probe.current?.holding], [false, false]);
});

test('escuta encerrada: a projeção recebida deixa de valer; cada base nova sem pedido é segurada e as exclusões relidas depois dela, sem releituras contra a projeção morta (R6-02)', async () => {
  const f = fake();
  f.excludedDelayMs = 30;
  const renders: Probe[][] = [[]];
  const {client, probe} = mount(f, {renders});
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(100);
  f.failListen('ws-a');
  await settle(50);
  assert.equal(probe.current?.listenFailed, true);
  // Duas mutações nesta aba que mudam a receita, com o gatilho já gravado quando a base é relida.
  for (const [round, value] of [[1, 60_000], [2, 30_000]] as const) {
    f.receipts['2026-10'] = value;
    await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
    await until(() => probe.current?.basisIncome?.['2026-10'] === value && probe.current?.excluded === round + 1 && probe.current?.holding === false,
      `mutação ${round}`);
  }
  await settle(150);
  assert.deepEqual([f.calls, f.excludedReads], [3, 3], 'só as releituras da mutação e, depois de cada uma, as exclusões');
  const mixed = renders[0].filter((render) => !render.holding &&
    ((render.basisIncome?.['2026-10'] === 60_000 && render.excluded !== 2) || (render.basisIncome?.['2026-10'] === 30_000 && render.excluded !== 3)));
  assert.deepEqual(mixed, [], 'nenhuma renderização livre mistura uma base com exclusões de outra versão');
  assert.equal(probe.current?.listenFailed, true, 'o aviso continua até a escuta ser reaberta');
});

test('escuta encerrada com um pedido em curso: a sincronização termina quando a base chega (R6-02)', async () => {
  const f = fake();
  const {probe} = mount(f);
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(100);
  f.seriesDelayMs = 120;
  f.receipts['2026-10'] = 150_000;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 150_000}, 1));
  assert.equal(probe.current?.syncing, true);
  // A escuta é encerrada antes de a releitura pedida chegar, e outra mutação muda outubro de novo: a
  // releitura traz 170.000, diferente da última projeção recebida. Sem projeção que valha, a chegada
  // libera, sem novas releituras contra a projeção morta.
  f.failListen('ws-a');
  f.receipts['2026-10'] = 170_000;
  await until(() => probe.current?.basisIncome?.['2026-10'] === 170_000 && probe.current?.excluded === 2 && probe.current?.holding === false,
    'liberada com a base nova e as exclusões relidas');
  await settle(150);
  assert.deepEqual([probe.current?.syncing, probe.current?.listenFailed], [false, true]);
  assert.equal(f.calls, 2, 'a carga e a releitura pedida, nada mais');
});

test('duas bases novas sem pedido, a segunda antes de as exclusões relidas chegarem: as exclusões são relidas de novo depois dela (R6-02)', async () => {
  const f = fake();
  const renders: Probe[][] = [[]];
  const {client, probe} = mount(f, {renders});
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(100);
  const before = f.log.length;
  // A releitura da mutação traz outubro em 60.000; as exclusões são relidas devagar.
  f.excludedDelayMs = 100;
  f.receipts['2026-10'] = 60_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  await until(() => probe.current?.basisIncome?.['2026-10'] === 60_000 && f.excludedReads === 2, 'base nova; exclusões em releitura');
  // Antes de elas chegarem, outra leitura sem pedido (por exemplo, a de outra estimativa) traz 30.000.
  f.excludedDelayMs = 0;
  f.receipts['2026-10'] = 30_000;
  await act(async () => { await client.refetchQueries({queryKey: [FINANCIAL_REPORT_BASIS_KEY], exact: false}); });
  await until(() => probe.current?.basisIncome?.['2026-10'] === 30_000 && probe.current?.excluded === 3 && probe.current?.holding === false,
    'as exclusões relidas de novo depois da segunda base');
  assert.deepEqual(f.log.slice(before), ['relatório', 'exclusões', 'relatório', 'exclusões']);
  const mixed = renders[0].filter((render) => !render.holding &&
    ((render.basisIncome?.['2026-10'] === 60_000 && render.excluded !== 2) || (render.basisIncome?.['2026-10'] === 30_000 && render.excluded !== 3)));
  assert.deepEqual(mixed, [], 'nenhuma renderização livre com uma base e as exclusões lidas antes dela');
});

test('o mesmo caso com as duas releituras das exclusões concluídas no mesmo milissegundo: a leitura chega como nova, e a estimativa é solta (R6-02)', async () => {
  const f = fake();
  const renders: Probe[][] = [[]];
  const {client, probe} = mount(f, {renders});
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(100);
  const before = f.log.length;
  f.excludedDelayMs = 100;
  f.receipts['2026-10'] = 60_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  await until(() => probe.current?.basisIncome?.['2026-10'] === 60_000 && f.excludedReads === 2, 'base nova; exclusões em releitura');
  f.excludedDelayMs = 0;
  f.receipts['2026-10'] = 30_000;
  // O relógio para quando as exclusões relidas chegam: a releitura seguinte, sem latência, termina no mesmo
  // milissegundo, com o mesmo `dataUpdatedAt`.
  const realNow = Date.now;
  let stopped: number | null = null;
  f.excludedLanded = (version) => {
    if (version !== 2) return;
    const at = realNow();
    stopped = at;
    Date.now = () => at;
  };
  try {
    await act(async () => { await client.refetchQueries({queryKey: [FINANCIAL_REPORT_BASIS_KEY], exact: false}); });
    await until(() => probe.current?.basisIncome?.['2026-10'] === 30_000 && probe.current?.excluded === 3 && probe.current?.holding === false,
      'as exclusões relidas de novo depois da segunda base, no mesmo milissegundo da leitura anterior');
  } finally {
    Date.now = realNow;
    f.excludedLanded = null;
  }
  const at = (version: number) => [...new Set(renders[0].filter((render) => render.excluded === version).map((render) => render.excludedAt))];
  assert.ok(stopped !== null);
  assert.deepEqual([at(2), at(3)], [[stopped], [stopped]], 'as duas leituras com o mesmo `dataUpdatedAt`');
  assert.deepEqual(f.log.slice(before), ['relatório', 'exclusões', 'relatório', 'exclusões']);
  const mixed = renders[0].filter((render) => !render.holding &&
    ((render.basisIncome?.['2026-10'] === 60_000 && render.excluded !== 2) || (render.basisIncome?.['2026-10'] === 30_000 && render.excluded !== 3)));
  assert.deepEqual(mixed, [], 'nenhuma renderização livre com uma base e as exclusões lidas antes dela');
});

test('escuta do provedor encerrada: o retorno do servidor à escuta da prévia a reabre, e o "Tentar de novo" de qualquer estimativa reabre as encerradas (R6-01)', async () => {
  const f = fake();
  const {probes, showPreview} = mountPair(f);
  await until(() => probes.provider?.basisIncome !== null && probes.provider?.excluded === 1, 'provedor carregado');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(50);
  f.failListen('ws-a');
  await settle(50);
  assert.equal(probes.provider?.listenFailed, true);
  const opened = f.opened.get('ws-a') ?? 0;
  // A pessoa segue a ressalva do topo e abre Configurações: a prévia abre a própria escuta.
  showPreview(true);
  await until(() => f.opened.get('ws-a') === opened + 1 && probes.preview?.basisIncome !== null, 'escuta da prévia');
  await settle(50);
  assert.equal(probes.provider?.listenFailed, true, 'sem retorno do servidor, nada muda');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await until(() => f.opened.get('ws-a') === opened + 2 && probes.provider?.listenFailed === false, 'a do provedor reaberta pelo retorno à da prévia');
  assert.equal(f.subscriptions.get('ws-a'), 2, 'uma escuta por estimativa');
  // Fechada a prévia, a escuta reaberta do provedor acompanha outra sessão.
  showPreview(false);
  f.receipts['2026-10'] = 150_000;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 150_000}, 1));
  await until(() => probes.provider?.basisIncome?.['2026-10'] === 150_000 && probes.provider?.holding === false, 'receita de outra sessão no provedor');
  // Com as duas escutas saudáveis, o "Tentar de novo" não reabre nada.
  showPreview(true);
  await until(() => f.subscriptions.get('ws-a') === 2 && probes.preview?.basisIncome !== null, 'prévia de novo');
  const healthy = f.opened.get('ws-a') ?? 0;
  act(() => probes.preview?.retryListen());
  await settle(50);
  assert.equal(f.opened.get('ws-a'), healthy, 'escuta saudável não é reaberta');
  // As duas encerradas: o "Tentar de novo" da prévia reabre as duas.
  f.failListen('ws-a');
  await settle(50);
  assert.deepEqual([probes.provider?.listenFailed, probes.preview?.listenFailed], [true, true]);
  act(() => probes.preview?.retryListen());
  await until(() => f.opened.get('ws-a') === healthy + 2 && probes.provider?.listenFailed === false && probes.preview?.listenFailed === false,
    'as duas reabertas');
  assert.equal(f.subscriptions.get('ws-a'), 2);
});

test('rajadas de mutação nesta aba não gastam o orçamento da escuta: a receita nova sincroniza sem esperar a reposição (R6-03)', async () => {
  const f = fake();
  f.deps.refresh = {options: {coalesceMs: 20, burst: 5, refillMs: 60_000}, mutationOptions: {coalesceMs: 20, burst: 2, refillMs: 60_000}};
  const {client, probe} = mount(f, {withExcluded: false});
  await until(() => probe.current?.basisIncome !== null, 'base inicial');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(50);
  // Seis rajadas de despesas nesta aba, separadas pelo agrupamento: a releitura da mutação para no orçamento dela.
  for (let round = 0; round < 6; round += 1) {
    await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
    await settle(50);
  }
  await settle(100);
  assert.equal(f.calls, 3, 'a carga e as 2 releituras do orçamento da mutação');
  // Uma receita nova de outra sessão: a escuta pede a releitura, com o orçamento dela intacto.
  f.receipts['2026-10'] = 150_000;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 150_000}, 1));
  await until(() => probe.current?.basisIncome?.['2026-10'] === 150_000 && probe.current?.syncing === false, 'receita nova sincronizada', 1_000);
  assert.equal(f.calls, 4);
});

test('mês fora da janela mudado sem pedido: as exclusões são relidas depois da base, e a janela que passa a incluí-lo não junta versões nem prende a retenção (R7-01)', async () => {
  const f = fake();
  f.receipts['2026-07'] = 100_000;
  const renders: Probe[] = [];
  const {client, probe, setWindow} = mountWindow(f, WINDOW, renders);
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(100);
  const before = f.log.length;
  // Nesta aba, uma receita de julho (fora da janela de agosto a outubro) é anulada; a releitura da mutação traz julho novo.
  f.receipts['2026-07'] = 60_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  await until(() => probe.current?.basisIncome?.['2026-07'] === 60_000 && probe.current?.excluded === 2 && probe.current?.holding === false,
    'base nova e exclusões relidas, mesmo com o mês fora da janela');
  assert.deepEqual(f.log.slice(before), ['relatório', 'exclusões']);
  // A janela passa a incluir julho: nada a reler, nada preso.
  setWindow(['2026-07', ...WINDOW]);
  f.emit('ws-a', server({'2026-07': 60_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(200);
  assert.deepEqual([probe.current?.syncing, probe.current?.holding], [false, false], 'nenhuma retenção presa na janela nova');
  assert.deepEqual([f.calls, f.excludedReads], [2, 2]);
  const mixed = renders.filter((render) => !render.holding && render.basisIncome?.['2026-07'] === 60_000 && render.excluded === 1);
  assert.deepEqual(mixed, [], 'nenhuma renderização livre com julho novo e as exclusões antigas');
});

test('janela de 12 meses, as duas bases relidas sem pedido: a liberação espera as duas, e as exclusões são relidas uma vez, depois delas (R7-01)', async () => {
  const f = fake();
  const renders: Probe[][] = [[]];
  const {client, probe} = mount(f, {months: WINDOW_12, extraMonth: EXTRA_MONTH, renders});
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'carga');
  f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(150);
  const before = f.log.length;
  // A releitura da mutação traz outubro e novembro de 2025 novos: a série chega logo; o mês avulso, 150 ms depois.
  f.seriesDelayMs = 10;
  f.monthDelayMs = 150;
  f.receipts['2026-10'] = 150_000;
  f.extraReceipts[EXTRA_MONTH] = 95_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  await until(() => probe.current?.basisIncome?.['2026-10'] === 150_000 && probe.current?.basisIncome?.[EXTRA_MONTH] === 95_000 &&
    probe.current?.excluded === 2 && probe.current?.holding === false, 'as duas bases novas e as exclusões relidas');
  await settle(150);
  assert.deepEqual(f.log.slice(before), ['relatório', 'mês avulso', 'exclusões'], 'as exclusões só depois das duas bases');
  const halfway = renders[0].filter((render) => !render.holding &&
    (render.basisIncome?.['2026-10'] === 150_000) !== (render.basisIncome?.[EXTRA_MONTH] === 95_000));
  assert.deepEqual(halfway, [], 'nenhuma renderização livre com só uma das bases nova');
});

test('releitura pedida liberada pela convergência antes de chegar, com um estado intermediário: a chegada compara e pede de novo (R7-02)', async () => {
  const f = fake();
  f.readAtStart = true;
  const renders: Probe[][] = [[]];
  const {probe} = mount(f, {renders});
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(100);
  // Uma receita de 50.000 entra em outubro; a releitura pedida lê a projeção com ela e responde 200 ms depois.
  f.seriesDelayMs = 200;
  f.receipts['2026-10'] = 150_000;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 150_000}, 1));
  await until(() => f.calls === 2, 'releitura pedida em curso');
  // A receita é anulada antes de a releitura responder: a escuta traz outubro de volta a 100.000, igual à base.
  f.receipts['2026-10'] = 100_000;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}, 1));
  f.seriesDelayMs = 2;
  await until(() => f.calls === 3 && probe.current?.basisIncome?.['2026-10'] === 100_000 && probe.current?.holding === false,
    'a chegada com o estado intermediário pede outra releitura, que traz o estado final');
  await settle(150);
  assert.equal(f.calls, 3);
  const stale = renders[0].filter((render) => !render.holding && render.basisIncome?.['2026-10'] === 150_000);
  assert.deepEqual(stale, [], 'o estado intermediário nunca é mostrado livre');
});

test('releitura da mutação que começou antes do último retorno da escuta: a chegada com um estado intermediário compara e pede de novo (R7-02)', async () => {
  const f = fake();
  f.readAtStart = true;
  const renders: Probe[][] = [[]];
  const {client, probe} = mount(f, {renders});
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(100);
  // A releitura da mutação lê outubro num estado intermediário (150.000) e responde 200 ms depois.
  f.seriesDelayMs = 200;
  f.receipts['2026-10'] = 150_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  await until(() => f.calls === 2, 'releitura da mutação em curso');
  // Enquanto ela responde, o estado final (100.000, igual à base) é projetado e chega à escuta.
  f.receipts['2026-10'] = 100_000;
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}, 1));
  f.seriesDelayMs = 2;
  await until(() => f.calls === 3 && probe.current?.basisIncome?.['2026-10'] === 100_000 && probe.current?.holding === false,
    'a chegada pede outra releitura, que traz o estado final');
  await settle(150);
  assert.equal(f.calls, 3);
  const stale = renders[0].filter((render) => !render.holding && render.basisIncome?.['2026-10'] === 150_000);
  assert.deepEqual(stale, [], 'o estado intermediário nunca é mostrado livre');
});

/**
 * Janela de 12 meses com o orçamento da mutação da série gasto e o do mês avulso cheio: uma despesa nesta
 * aba ainda com 3 meses, a troca para 12 meses e, então, uma receita de R$ 500,00 que passa de novembro de
 * 2025 (mês avulso) para outubro de 2026 (série), sem retorno da escuta. Devolve o momento em que o mês
 * avulso chegou novo e a série espera a reposição (10 s no relógio do teste; o real: 10 min). Com a
 * leitura por id, ela é relida depois de cada base que chega (`reads`); sem ela, não há leitura dependente.
 */
const budgetSpent = async (listener: 'viva' | 'encerrada', withExcluded = true) => {
  const f = fake();
  const time = manualClock();
  f.deps.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 1, refillMs: 10_000}};
  const renders: Probe[] = [];
  const {client, probe, setWindow} = mountWindow(f, WINDOW, renders, {withExcluded});
  const reads = (value: number) => !withExcluded || probe.current?.excluded === value;
  await until(() => probe.current?.basisIncome !== null && reads(1), 'janela de 3 meses');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  // Uma despesa nesta aba, ainda com 3 meses: a releitura da mutação gasta a ficha da série.
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => f.seriesCalls === 2, 'série relida pela mutação');
  await settle(50);
  // A pessoa passa a 12 meses: a base do mês avulso nasce com o orçamento cheio.
  setWindow(WINDOW_12, EXTRA_MONTH);
  await until(() => probe.current?.basisIncome?.[EXTRA_MONTH] === 90_000 && reads(2) && probe.current?.holding === false, 'janela de 12 meses');
  if (listener === 'viva') f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  else f.failListen('ws-a');
  await settle(50);
  const before = f.log.length;
  const from = renders.length;
  f.extraReceipts[EXTRA_MONTH] = 40_000;
  f.receipts['2026-10'] = 150_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => probe.current?.basisIncome?.[EXTRA_MONTH] === 40_000 && reads(3), 'mês avulso relido');
  await settle(150);
  assert.deepEqual([probe.current?.holding, f.seriesCalls], [true, 2], 'a série espera a reposição: a estimativa segura a versão anterior');
  const halfway = () => renders.slice(from).filter((render) => !render.holding &&
    (render.basisIncome?.['2026-10'] === 150_000) !== (render.basisIncome?.[EXTRA_MONTH] === 40_000));
  return {f, time, client, probe, before, halfway, reads, setWindow};
};

for (const listener of ['viva', 'encerrada'] as const) {
  for (const withExcluded of [true, false]) {
    test(`janela de 12 meses, a releitura da mutação de uma base adiada pelo orçamento (escuta ${listener}, ${withExcluded ? 'com' : 'sem'} receita desconsiderada): a outra base nova é segurada até ela chegar (R8-01, R9-01)`, async () => {
      const {f, time, probe, before, halfway, reads} = await budgetSpent(listener, withExcluded);
      // A reposição: a série é relida, e só então a estimativa libera (com a leitura por id relida depois dela).
      time.advance(10_000);
      await until(() => probe.current?.basisIncome?.['2026-10'] === 150_000 && reads(4) && probe.current?.holding === false,
        'série relida na reposição');
      if (listener === 'viva') f.emit('ws-a', server({[EXTRA_MONTH]: 40_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 150_000}, 2));
      await settle(150);
      assert.deepEqual(f.log.slice(before), withExcluded ? ['mês avulso', 'exclusões', 'relatório', 'exclusões'] : ['mês avulso', 'relatório'],
        'a leitura por id relida depois de cada base; nada mais');
      assert.deepEqual(halfway(), [], 'nenhuma renderização livre com só uma das bases nova');
      assert.equal(probe.current?.listenFailed, listener === 'encerrada');
    });
  }
}

test('janela de 12 meses com a escuta encerrada e a série esperando a reposição: o "Tentar de novo" relê as duas bases e libera sem esperar a releitura pendente (R8-01)', async () => {
  const {f, time, client, probe, before, halfway} = await budgetSpent('encerrada');
  // "Tentar de novo": as duas bases são relidas na hora; a releitura da mutação da série continua pendente.
  await act(async () => {
    await Promise.all([
      client.refetchQueries({queryKey: JSON.parse(basisKeyOf('u1', 'ws-a', RANGE, SECTIONS)) as unknown[], exact: true}),
      client.refetchQueries({queryKey: JSON.parse(basisKeyOf('u1', 'ws-a', {kind: 'month', month: EXTRA_MONTH}, CASH)) as unknown[], exact: true}),
    ]);
  });
  await until(() => probe.current?.basisIncome?.['2026-10'] === 150_000 && probe.current?.excluded === 4 && probe.current?.holding === false,
    'liberada com as duas bases relidas, sem a reposição');
  assert.deepEqual(f.log.slice(before), ['mês avulso', 'exclusões', 'relatório', 'mês avulso', 'exclusões'], 'a última leitura por id, depois das duas');
  assert.deepEqual(halfway(), [], 'nenhuma renderização livre com só uma das bases nova');
  // A releitura pendente da série sai na reposição e traz a mesma receita: nada mais é relido.
  time.advance(10_000);
  await until(() => f.seriesCalls === 4, 'a releitura pendente sai');
  await settle(150);
  assert.deepEqual([probe.current?.holding, probe.current?.excluded], [false, 4]);
});

test('janela de 12 meses, a nova tentativa do mês avulso agendada depois de uma falha: a série nova espera por ela (R8-01)', async () => {
  const f = fake();
  const time = manualClock();
  f.deps.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 100, refillMs: 60_000}};
  const renders: Probe[][] = [[]];
  const {client, probe} = mount(f, {months: WINDOW_12, extraMonth: EXTRA_MONTH, renders});
  await until(() => probe.current?.basisIncome?.[EXTRA_MONTH] === 90_000 && probe.current?.excluded === 1, 'carga');
  f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(50);
  const from = renders[0].length;
  // Uma receita de R$ 500,00 passou de novembro de 2025 para outubro de 2026. Na virada do mês, as duas
  // bases são relidas: a série chega nova, e o mês avulso falha (com a nova tentativa).
  f.receipts['2026-10'] = 150_000;
  f.extraReceipts[EXTRA_MONTH] = 40_000;
  f.failingMonth = true;
  await act(async () => { await invalidateFinancialReportBases(client); });
  time.advance(50);
  await until(() => probe.current?.basisIncome?.['2026-10'] === 150_000 && f.monthCalls === 3 && probe.current?.excluded === 2,
    'série nova; mês avulso falhou; a leitura por id relida depois da série');
  await settle(100);
  assert.equal(probe.current?.holding, true, 'a nova tentativa agendada do mês avulso segura a série nova');
  // A nova tentativa do mês avulso (pelo agendador da escuta) chega: só então a estimativa libera.
  f.failingMonth = false;
  time.advance(50);
  await until(() => probe.current?.basisIncome?.[EXTRA_MONTH] === 40_000 && probe.current?.excluded === 3 && probe.current?.holding === false,
    'mês avulso relido na nova tentativa');
  const halfway = renders[0].slice(from).filter((render) => !render.holding &&
    (render.basisIncome?.['2026-10'] === 150_000) !== (render.basisIncome?.[EXTRA_MONTH] === 40_000));
  assert.deepEqual(halfway, [], 'nenhuma renderização livre com só uma das bases nova');
});

test('janela de 12 meses com a escuta encerrada: a releitura pendente da série que sai sem rede fica pausada e continua segurando a estimativa em qualquer renderização, até a rede voltar (R10-03)', async () => {
  const {f, time, probe, halfway, setWindow} = await budgetSpent('encerrada', false);
  onlineManager.setOnline(false);
  try {
    // A reposição: a releitura da série sai, mas sem rede o React Query a pausa antes da callable.
    time.advance(10_000);
    await settle(50);
    assert.equal(f.seriesCalls, 2, 'sem rede, nenhuma chamada');
    // Outra renderização qualquer (por exemplo, a do provedor por outro motivo) não solta a estimativa.
    setWindow(WINDOW_12, EXTRA_MONTH);
    await settle(50);
    assert.equal(probe.current?.holding, true, 'a busca pausada conta como leitura');
  } finally {
    onlineManager.setOnline(true);
  }
  await until(() => probe.current?.basisIncome?.['2026-10'] === 150_000 && probe.current?.holding === false, 'série lida com a rede de volta');
  assert.equal(f.seriesCalls, 3);
  assert.deepEqual(halfway(), [], 'nenhuma renderização livre com só uma das bases nova');
});

for (const withExcluded of [true, false]) {
  test(`janela de 12 meses, uma mutação nesta aba durante a releitura pedida pela escuta (${withExcluded ? 'com' : 'sem'} receita desconsiderada): as duas bases chegam em passo, e a estimativa mostra a sincronização sem esperar a releitura da mutação (R10-01)`, async () => {
    const f = fake();
    const time = manualClock();
    f.deps.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 100, refillMs: 60_000}};
    const renders: Probe[][] = [[]];
    const {client, probe} = mount(f, {months: WINDOW_12, extraMonth: EXTRA_MONTH, withExcluded, renders});
    const reads = (value: number) => !withExcluded || probe.current?.excluded === value;
    await until(() => probe.current?.basisIncome?.[EXTRA_MONTH] === 90_000 && reads(1) && probe.current?.holding === false, 'as duas bases e as exclusões');
    f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
    await settle(50);
    // Outra sessão lança receitas em novembro de 2025 e em outubro de 2026: a escuta pede, e as duas bases são relidas devagar.
    f.seriesDelayMs = 80;
    f.monthDelayMs = 80;
    f.extraReceipts[EXTRA_MONTH] = 40_000;
    f.receipts['2026-10'] = 150_000;
    f.emit('ws-a', server({[EXTRA_MONTH]: 40_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 150_000}, 2));
    time.advance(50);
    await until(() => f.seriesCalls === 2 && f.monthCalls === 2, 'as duas bases em releitura');
    // Durante as leituras, a pessoa salva uma despesa nesta aba: a releitura da mutação fica pendente (o relógio dos
    // agendadores não anda mais).
    const from = renders[0].length;
    await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
    await until(() => probe.current?.basisIncome?.['2026-10'] === 150_000 && probe.current?.basisIncome?.[EXTRA_MONTH] === 40_000 &&
      reads(2) && probe.current?.holding === false, 'a sincronização mostrada sem esperar a releitura da mutação');
    await settle(100);
    assert.deepEqual([probe.current?.holding, f.seriesCalls, f.monthCalls], [false, 2, 2], 'a releitura da mutação continua pendente, e nada segura');
    const halfway = renders[0].slice(from).filter((render) => !render.holding && (render.basisIncome?.['2026-10'] === 150_000) !== (render.basisIncome?.[EXTRA_MONTH] === 40_000));
    assert.deepEqual(halfway, [], 'nenhuma renderização livre com só uma das bases nova');
    // A releitura da mutação sai e traz o mesmo estado: nada muda.
    time.advance(50);
    await until(() => f.seriesCalls === 3 && f.monthCalls === 3, 'releitura da mutação');
    await settle(100);
    assert.deepEqual([probe.current?.holding, probe.current?.basisIncome?.['2026-10'], probe.current?.basisIncome?.[EXTRA_MONTH]], [false, 150_000, 40_000]);
  });
}

test('janela de 12 meses com receita desconsiderada: uma mutação nesta aba durante a releitura por id que segue a sincronização não segura a estimativa até a releitura da mutação (R10-01)', async () => {
  const f = fake();
  const time = manualClock();
  f.deps.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 100, refillMs: 60_000}};
  const {client, probe} = mount(f, {months: WINDOW_12, extraMonth: EXTRA_MONTH});
  await until(() => probe.current?.basisIncome?.[EXTRA_MONTH] === 90_000 && probe.current?.excluded === 1 && probe.current?.holding === false, 'as duas bases e as exclusões');
  f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(50);
  f.excludedDelayMs = 80;
  f.receipts['2026-10'] = 150_000;
  f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 150_000}, 1));
  time.advance(50);
  await until(() => probe.current?.basisIncome?.['2026-10'] === 150_000 && f.excludedReads === 2, 'as bases relidas; a leitura por id em curso');
  // Durante a releitura por id, uma despesa nesta aba: a releitura da mutação das duas bases fica pendente.
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  await until(() => probe.current?.excluded === 2 && probe.current?.holding === false, 'a estimativa solta quando a leitura por id chega');
  assert.deepEqual([f.seriesCalls, f.monthCalls], [2, 2], 'sem esperar a releitura da mutação');
});

test('janela de 12 meses que sai no meio de uma leitura do mês avulso, com outro pedido feito durante ela: o mês avulso é relido na volta, mesmo com a leitura em curso terminando depois da saída (R10-03)', async () => {
  const f = fake();
  const time = manualClock();
  f.deps.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 100, refillMs: 60_000}};
  const renders: Probe[] = [];
  const {client, probe, setWindow} = mountWindow(f, WINDOW, renders);
  setWindow(WINDOW_12, EXTRA_MONTH);
  await until(() => probe.current?.basisIncome?.[EXTRA_MONTH] === 90_000 && probe.current?.holding === false, 'janela de 12 meses');
  f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  f.failListen('ws-a');
  await settle(50);
  // Uma mutação nesta aba: as duas bases são relidas; a callable lê no começo, e o mês avulso responde devagar.
  f.readAtStart = true;
  f.monthDelayMs = 150;
  f.extraReceipts[EXTRA_MONTH] = 40_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => f.seriesCalls === 2 && f.monthCalls === 2, 'as duas bases em releitura');
  // Outra mutação durante a leitura do mês avulso, que já leu 40.000: o pedido dela fica pendente.
  f.extraReceipts[EXTRA_MONTH] = 30_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  // A pessoa passa a 3 meses antes de a leitura do mês avulso chegar, e volta a 12 depois dela.
  setWindow(WINDOW, null);
  await settle(250);
  assert.equal(f.monthCalls, 2);
  setWindow(WINDOW_12, EXTRA_MONTH);
  await settle(50);
  time.advance(50);
  await until(() => f.monthCalls === 3 && probe.current?.basisIncome?.[EXTRA_MONTH] === 30_000 && probe.current?.holding === false, 'o mês avulso relido na volta');
});

test('uma base só: a releitura da mutação em curso não segura a estimativa (as bases fora de passo só valem com mais de uma base) (R10-01)', async () => {
  const f = fake();
  const time = manualClock();
  f.deps.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 100, refillMs: 60_000}};
  const {client, probe} = mount(f);
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1 && probe.current?.holding === false, 'base e exclusões');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(50);
  // Uma despesa nesta aba: a releitura da mutação da base sai devagar, sem pedido e sem mudar a receita.
  f.seriesDelayMs = 150;
  const before = probe.current?.dataUpdatedAt;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => f.seriesCalls === 2, 'base em releitura');
  await settle(40);
  assert.equal(probe.current?.holding, false, 'a única base em leitura não segura');
  await until(() => probe.current?.dataUpdatedAt !== before, 'a releitura chega');
  await settle(50);
  assert.deepEqual([probe.current?.holding, f.excludedReads], [false, 1], 'a mesma receita: nada mais');
});

test('uma base só: a releitura sem pedido que chega com a próxima já pendente libera na hora, sem esperar por ela (R8-01)', async () => {
  const f = fake();
  const time = manualClock();
  f.deps.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 100, refillMs: 60_000}};
  const {client, probe} = mount(f);
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(50);
  // Nesta aba, uma receita de outubro é anulada; a releitura da mutação demora, e outra mutação chega no meio dela.
  f.seriesDelayMs = 100;
  f.receipts['2026-10'] = 60_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => f.seriesCalls === 2, 'releitura da mutação em curso');
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  // Com uma base só, nada a juntar: a chegada libera e relê as exclusões, com a próxima releitura pendente.
  await until(() => probe.current?.basisIncome?.['2026-10'] === 60_000 && probe.current?.excluded === 2 && probe.current?.holding === false,
    'liberada na chegada');
  assert.equal(f.seriesCalls, 2, 'a próxima releitura ainda não saiu');
  time.advance(50);
  await until(() => f.seriesCalls === 3, 'a próxima sai');
  await settle(150);
  assert.deepEqual([probe.current?.holding, f.excludedReads], [false, 2], 'a mesma receita: nada mais');
});

test('janela de 12 meses com a série parada no teto: a releitura da mutação relê só o mês avulso, que libera sem ela (a série em erro); relida a série com sucesso, a mutação volta a relê-la (R8-01)', async () => {
  const f = fake();
  const time = manualClock();
  f.deps.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 100, refillMs: 60_000}};
  const {client, probe} = mount(f, {months: WINDOW_12, extraMonth: EXTRA_MONTH});
  await until(() => probe.current?.basisIncome?.[EXTRA_MONTH] === 90_000 && probe.current?.excluded === 1, 'carga');
  f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(50);
  // A série passa a falhar: na virada do mês, duas releituras falhas (cada uma com a nova tentativa) a param no teto.
  f.failing = true;
  await act(async () => { await invalidateFinancialReportBases(client); });
  time.advance(50);
  await until(() => f.seriesCalls === 3 && f.monthCalls === 2, 'primeira releitura da virada');
  await settle(50);
  time.advance(50);
  await until(() => f.seriesCalls === 5, 'segunda releitura');
  await settle(50);
  time.advance(50);
  await settle(50);
  assert.equal(f.seriesCalls, 5, 'parada no teto');
  const seriesKey = JSON.parse(basisKeyOf('u1', 'ws-a', RANGE, SECTIONS)) as unknown[];
  // Nesta aba, uma receita de novembro de 2025 é anulada: a mutação pula a série parada e relê o mês avulso.
  f.failing = false;
  f.extraReceipts[EXTRA_MONTH] = 40_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => probe.current?.basisIncome?.[EXTRA_MONTH] === 40_000 && probe.current?.excluded === 2 && probe.current?.holding === false,
    'o mês avulso libera sem a série parada');
  assert.equal(f.seriesCalls, 5, 'a série parada no teto não é relida pela mutação');
  assert.equal(client.getQueryState(seriesKey)?.status, 'error', 'a série continua em erro: a estimativa avisa a falha');
  // "Tentar de novo": a série é relida com sucesso e sai do teto; a próxima mutação volta a relê-la.
  await act(async () => { await client.refetchQueries({queryKey: seriesKey, exact: true}); });
  await until(() => f.seriesCalls === 6 && client.getQueryState(seriesKey)?.status === 'success', 'série relida pelo "Tentar de novo"');
  await settle(50);
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => f.seriesCalls === 7, 'a mutação volta a reler a série');
});

test('janela de 12 meses, só a série relida sem pedido depois do último retorno da escuta: o mês avulso, lido antes desse retorno e sem leitura nova, não faz pedir (R8-03)', async () => {
  const f = fake();
  const {client, probe} = mount(f, {months: WINDOW_12, extraMonth: EXTRA_MONTH});
  await until(() => probe.current?.basisIncome?.[EXTRA_MONTH] === 90_000 && probe.current?.excluded === 1, 'carga');
  f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}, 0));
  await settle(100);
  const calls = f.calls;
  // Outra leitura da série (por exemplo, a de outra estimativa) traz outubro novo antes de a escuta trazê-lo.
  f.receipts['2026-10'] = 150_000;
  await act(async () => { await client.refetchQueries({queryKey: JSON.parse(basisKeyOf('u1', 'ws-a', RANGE, SECTIONS)) as unknown[], exact: true}); });
  await until(() => probe.current?.basisIncome?.['2026-10'] === 150_000 && probe.current?.excluded === 2 && probe.current?.holding === false,
    'série nova e exclusões relidas');
  await settle(200);
  assert.equal(f.calls, calls + 1, 'nenhum pedido: a série começou a leitura depois do último retorno, e o mês avulso não mudou');
});

test('falhas da releitura da mutação não param a base no teto: com a rede de volta, a mutação seguinte relê (R8-01)', async () => {
  const f = fake();
  const time = manualClock();
  f.deps.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 100, refillMs: 60_000}};
  const {client, probe} = mount(f);
  await until(() => probe.current?.basisIncome !== null && probe.current?.excluded === 1, 'base e exclusões iniciais');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(50);
  // Duas releituras da mutação falham (cada uma com a nova tentativa); a que não deixou a base desatualizada não pede outra.
  f.failing = true;
  for (const calls of [3, 5]) {
    await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
    time.advance(50);
    await until(() => f.seriesCalls === calls, `releitura da mutação que falha (${calls} chamadas)`);
    await settle(50);
  }
  time.advance(50);
  await settle(50);
  assert.equal(f.seriesCalls, 5, 'nenhuma releitura a mais depois das falhas');
  // A rede volta: a mutação seguinte relê a base, e a receita nova chega.
  f.failing = false;
  f.receipts['2026-10'] = 150_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => probe.current?.basisIncome?.['2026-10'] === 150_000 && probe.current?.excluded === 2 && probe.current?.holding === false,
    'a mutação seguinte relê a base');
  assert.equal(f.seriesCalls, 6);
});

test('com receita desconsiderada, a estimativa de uma base só não solta a de 12 meses: a leitura por id que ela relê não pareia a série nova com o mês avulso antigo (R9-02)', async () => {
  const f = fake();
  const time = manualClock();
  f.deps.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 1, refillMs: 10_000}};
  const {client, probes, longRenders, showLong} = mountShortAndLong(f);
  await until(() => probes.short?.basisIncome !== null && probes.short?.excluded === 1, 'estimativa de 3 meses');
  // A de 12 meses monta 5 s depois: o orçamento do mês avulso tem outra fase.
  time.advance(5_000);
  showLong();
  await until(() => probes.long?.basisIncome?.[EXTRA_MONTH] === 90_000 && probes.long?.holding === false, 'estimativa de 12 meses');
  f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  f.failListen('ws-a');
  await settle(50);
  // Uma despesa nesta aba gasta a ficha das duas bases.
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => f.seriesCalls === 2 && f.monthCalls === 2, 'as duas relidas pela mutação');
  await settle(50);
  // 5 s depois, a série tem ficha de novo, e o mês avulso não: uma receita de R$ 500,00 passa de novembro de 2025 para outubro de 2026.
  time.advance(5_000);
  const from = longRenders.length;
  const reads = f.excludedReads;
  f.extraReceipts[EXTRA_MONTH] = 40_000;
  f.receipts['2026-10'] = 150_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => probes.long?.basisIncome?.['2026-10'] === 150_000 && f.excludedReads === reads + 1 && probes.short?.holding === false,
    'série nova; a de 3 meses liberou e releu a leitura por id');
  await settle(150);
  assert.deepEqual([probes.long?.holding, f.monthCalls], [true, 2], 'a de 12 meses segura: o mês avulso espera a reposição');
  // A reposição do mês avulso: a de 12 meses libera, com a leitura por id relida depois das duas bases.
  time.advance(5_000);
  await until(() => probes.long?.basisIncome?.[EXTRA_MONTH] === 40_000 && f.excludedReads === reads + 2 && probes.long?.holding === false,
    'mês avulso relido na reposição');
  const halfway = longRenders.slice(from).filter((render) => !render.holding &&
    (render.basisIncome?.['2026-10'] === 150_000) !== (render.basisIncome?.[EXTRA_MONTH] === 40_000));
  assert.deepEqual(halfway, [], 'nenhuma renderização livre da de 12 meses com só uma das bases nova');
});

test('janela de 12 meses que sai e volta enquanto as duas bases esperam a reposição: o mês avulso, que saiu de uso com a releitura pendente, é relido na volta (R9-02)', async () => {
  const f = fake();
  const time = manualClock();
  f.deps.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 1, refillMs: 10_000}};
  const renders: Probe[] = [];
  const {client, probe, setWindow} = mountWindow(f, WINDOW, renders);
  setWindow(WINDOW_12, EXTRA_MONTH);
  await until(() => probe.current?.basisIncome?.[EXTRA_MONTH] === 90_000 && probe.current?.holding === false, 'janela de 12 meses');
  f.emit('ws-a', server({[EXTRA_MONTH]: 90_000, '2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  f.failListen('ws-a');
  await settle(50);
  // Uma despesa nesta aba gasta a ficha das duas bases.
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => f.seriesCalls === 2 && f.monthCalls === 2, 'as duas relidas pela mutação');
  await settle(50);
  // A receita de R$ 500,00 passa de novembro de 2025 para outubro de 2026: as duas releituras esperam a reposição.
  f.extraReceipts[EXTRA_MONTH] = 40_000;
  f.receipts['2026-10'] = 150_000;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await settle(50);
  assert.deepEqual([f.seriesCalls, f.monthCalls], [2, 2], 'as duas esperam a reposição');
  // A pessoa passa a 3 meses e volta a 12: o mês avulso sai de uso com a releitura pendente e é relido na volta.
  setWindow(WINDOW, null);
  await settle(50);
  const from = renders.length;
  setWindow(WINDOW_12, EXTRA_MONTH);
  await until(() => f.monthCalls === 3 && probe.current?.basisIncome?.[EXTRA_MONTH] === 40_000, 'o mês avulso relido na volta');
  await settle(100);
  assert.equal(probe.current?.holding, true, 'a série ainda espera a reposição');
  time.advance(10_000);
  await until(() => probe.current?.basisIncome?.['2026-10'] === 150_000 && probe.current?.holding === false, 'série relida na reposição');
  await settle(100);
  assert.equal(f.monthCalls, 3, 'uma leitura só do mês avulso na volta (a lida na hora não é agendada de novo)');
  const halfway = renders.slice(from).filter((render) => !render.holding && render.basisIncome !== null && render.basisIncome[EXTRA_MONTH] !== undefined &&
    (render.basisIncome['2026-10'] === 150_000) !== (render.basisIncome[EXTRA_MONTH] === 40_000));
  assert.deepEqual(halfway, [], 'nenhuma renderização livre da janela de 12 meses com só uma das bases nova');
});

test('a falha de uma releitura da mutação não conta para o teto, nem depois: o pedido seguinte da escuta ainda tem as duas releituras (R9-04)', async () => {
  const f = fake();
  const time = manualClock();
  f.deps.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 100, refillMs: 60_000}};
  const {client, probe} = mount(f, {withExcluded: false});
  await until(() => probe.current?.basisIncome !== null, 'base inicial');
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 100_000}));
  await settle(50);
  // Uma releitura da mutação falha (com a nova tentativa); a base não estava desatualizada.
  f.failing = true;
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => f.seriesCalls === 3, 'releitura da mutação que falha');
  await settle(50);
  // Uma receita nova chega à escuta: o pedido zera as falhas e relê. Com a base ainda falhando, são duas releituras
  // (cada uma com a nova tentativa) até o teto; a falha anterior, da mutação, não conta.
  f.emit('ws-a', server({'2026-08': 100_000, '2026-09': 100_000, '2026-10': 130_000}, 1));
  time.advance(50);
  await until(() => f.seriesCalls === 5, 'primeira releitura do pedido');
  await settle(50);
  time.advance(50);
  await until(() => f.seriesCalls === 7, 'segunda releitura do pedido');
  await settle(50);
  time.advance(50);
  await settle(50);
  assert.equal(f.seriesCalls, 7, 'parada no teto depois das duas releituras do pedido');
});
