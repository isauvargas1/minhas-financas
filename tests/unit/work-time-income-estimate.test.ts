import assert from 'node:assert/strict';
import test, {afterEach} from 'node:test';
import {createElement, useState} from 'react';
import TestRenderer, {act, type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient, QueryClientProvider, onlineManager, useQueryClient} from '@tanstack/react-query';

import {clearBasisRegistry} from '../../src/modules/reports/basisRegistry.ts';
import type {BasisSyncDeps, PeriodsSnapshot} from '../../src/modules/reports/basisSync.ts';
import type {LiveRefreshClock} from '../../src/modules/reports/liveRefresh.ts';
import type {FinancialReport} from '../../src/modules/reports/official.ts';
import {FINANCIAL_REPORT_BASIS_KEY, invalidateFinancialReports} from '../../src/modules/reports/queryKeys.ts';
import {incomeReadsKey, invalidateTransactionReads, useTransactionsByIdsWith} from '../../src/modules/transactions/incomeReads.ts';
import type {WorkCalendar} from '../../src/modules/work-time/calendar.ts';
import {DEFAULT_WEEKLY_ROUTINE} from '../../src/modules/work-time/draft.ts';
import type {WorkTimeEstimate} from '../../src/modules/work-time/estimate.ts';
import {ESTIMATE_UNCONFIRMED_FAILED, UNAVAILABLE_REASON_TEXT} from '../../src/modules/work-time/messages.ts';
import {transactionFingerprint, type SnapshotMonth} from '../../src/modules/work-time/projectionProof.ts';
import {
  holdEstimate,
  useIncomeEstimateWith,
  type IncomeEstimateDeps,
  type IncomeEstimateParams,
  type IncomeEstimateState,
} from '../../src/modules/work-time/useIncomeEstimateWith.ts';

/**
 * P5-F.1 — a estimativa automática inteira (`useIncomeEstimateWith`), com as
 * bases, a escuta das projeções e a leitura por id injetadas (React Query real,
 * React 18 + react-test-renderer, sem DOM): a regra de retenção (função pura),
 * a mutação feita nesta aba (R4-01, R6-02), a carga da janela de 12 meses
 * (R4-02) e a escuta encerrada do provedor (R6-01), com a fiação real das
 * bases da estimativa, inclusive a leitura em curso das duas bases da janela
 * de 12 meses (R8-03).
 */

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const OFFICE: WorkCalendar = {routines: [DEFAULT_WEEKLY_ROUTINE], worksOnHolidays: false, localHolidays: [], exceptions: []};
const REFERENCE = '2026-11-04';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (condition: () => boolean, message: string, timeoutMs = 3_000) => {
  const started = performance.now();
  while (!condition()) {
    if (performance.now() - started > timeoutMs) assert.fail(`tempo esgotado: ${message}`);
    await act(async () => { await wait(5); });
  }
};
const settle = async (ms = 150) => { await act(async () => { await wait(ms); }); };

// ------------------------------------------------------------------ retenção (função pura)

const params = (patch: Partial<IncomeEstimateParams> = {}): IncomeEstimateParams => ({
  workspaceId: 'ws-a', mode: 'habitual', historyMonths: 3, allowBusinessIncome: false, calendar: OFFICE,
  excludedIds: ['r1', 'r2'], enabled: true, ...patch,
});
const done = (incomeCents: number, patch: Partial<Extract<IncomeEstimateState, {status: 'done'}>> = {}) => ({
  status: 'done' as const,
  estimate: {status: 'ready', incomeCents} as unknown as WorkTimeEstimate,
  updatedAt: incomeCents,
  refreshFailed: false,
  retry: () => undefined,
  ...patch,
});

const LOADING = {status: 'loading'} as const;

/*
 * P5-F.1-R3.1 (R3-AUD-01): contrato novo da apresentação. Estes três testes substituem os da retenção da R1 ("sem prova,
 * vale a última estimativa provada da mesma identidade"; "provada durante a sincronização, a anterior"; "outra identidade
 * não reaproveita a anterior"), que formalizavam o comportamento inseguro: uma estimativa anterior mostrada como a
 * atual, sem prova, e sem aviso enquanto a leitura corrente não falhava. Afirmação nova, mais forte: nenhuma estimativa
 * anterior é mostrada em caso nenhum, e a atual só com a prova e a sincronização concluída
 * (`evidence/p5f1-r31/testes-substituidos.md`).
 */
test('apresentação fail-closed (R3.1, R3-AUD-01): a estimativa pronta só aparece provada e com a sincronização concluída, e é a própria atual; sem prova ou sincronizando, o estado sem conversão ("calculando" ou a falha com "Tentar de novo")', () => {
  const retry = () => undefined;
  const failed = {status: 'error' as const, message: 'falhou', retry};
  const states: Array<[string, IncomeEstimateState]> = [
    ['pronta sem aviso', done(100)],
    ['pronta com aviso', done(200, {refreshFailed: true, retry})],
    ['carregando', LOADING],
    ['erro', {status: 'error', message: 'x', retry}],
    ['desligada', {status: 'idle'}],
  ];
  // Tabela-verdade completa: prova × sincronização × estado × o que vale sem prova.
  for (const proven of [true, false]) {
    for (const settling of [true, false]) {
      for (const [name, state] of states) {
        for (const unproven of [LOADING, failed]) {
          const shown = holdEstimate(proven, settling, state, unproven);
          const label = `${name}, ${proven ? 'provada' : 'sem prova'}, ${settling ? 'sincronizando' : 'sincronizada'}, ${unproven.status}`;
          if (state.status !== 'done') assert.equal(shown, state, `${label}: o estado sem conversão aparece como está`);
          else if (proven && !settling) assert.equal(shown, state, `${label}: a atual, o próprio objeto`);
          else assert.equal(shown, unproven, `${label}: nenhuma estimativa pronta`);
          assert.ok(shown.status !== 'done' || (proven && !settling && shown === state), `${label}: pronta só a atual, provada e sincronizada`);
        }
      }
    }
  }
  // A função não recebe estimativa anterior nenhuma: a prova, a sincronização, o estado atual e o estado sem conversão.
  assert.equal(holdEstimate.length, 4);
});

test('apresentação fail-closed (R3.1): provada, mas com a sincronização em curso, nenhuma conversão, nem a anterior nem a atual; concluída a sincronização, a atual provada, com o aviso dela quando houver', () => {
  const retry = () => undefined;
  const current = done(300);
  assert.equal(holdEstimate(true, true, current, LOADING), LOADING, 'sincronizando: "calculando"');
  const failed = {status: 'error' as const, message: 'falhou', retry};
  assert.equal(holdEstimate(true, true, current, failed), failed, 'sincronizando com uma leitura em falha: o erro com "Tentar de novo"');
  assert.equal(holdEstimate(true, false, current, LOADING), current, 'sincronizada: a atual');
  // O aviso da releitura que falhou é da atual, provada e sincronizada: continua (o aviso imediato, não uma anterior).
  const stale = done(300, {refreshFailed: true, retry});
  assert.equal(holdEstimate(true, false, stale, LOADING), stale);
});

test('apresentação fail-closed (R3.1), propriedade: em 20 000 renderizações aleatórias (pronta, carregando, erro ou ociosa; com ou sem prova; sincronizando ou não), o mostrado é a atual provada e sincronizada ou um estado sem conversão; nunca um estado pronto de outra renderização', () => {
  // Gerador determinístico (LCG), sem dependência nova. A função não recebe identidade nem estimativa anterior: os
  // rótulos abaixo só nomeiam o passo na mensagem. As trocas reais de workspace e de preferência estão nos testes do
  // gancho (`work-time-consistency.test.ts`, R3.1).
  let seed = 0x5eed_31;
  const next = () => { seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648; return seed / 2_147_483_648; };
  const changes = ['conta', 'período', 'espaço da renda', 'modo', 'meses', 'receita PJ', 'calendário', 'exclusões', 'nada'] as const;
  const seen = new Set<IncomeEstimateState>();
  let shownDone = 0;
  for (let step = 0; step < 20_000; step += 1) {
    const change = changes[Math.floor(next() * changes.length)];
    const proven = next() < 0.5;
    const settling = next() < 0.5;
    const roll = next();
    const state: IncomeEstimateState = roll < 0.6
      ? done(Math.floor(next() * 1_000_000), {refreshFailed: next() < 0.3})
      : roll < 0.8 ? LOADING : roll < 0.95 ? {status: 'error', message: change, retry: () => undefined} : {status: 'idle'};
    const unproven = next() < 0.5 ? LOADING : {status: 'error' as const, message: 'falhou', retry: () => undefined};
    const shown = holdEstimate(proven, settling, state, unproven);
    if (shown.status === 'done') {
      shownDone += 1;
      assert.equal(shown, state, `passo ${step} (${change}): pronta só a desta renderização`);
      assert.ok(proven && !settling, `passo ${step} (${change}): pronta só provada e sincronizada`);
      assert.ok(!seen.has(shown), `passo ${step} (${change}): nunca um estado de outra renderização`);
    } else {
      assert.ok(shown === state || shown === unproven, `passo ${step} (${change}): sem conversão, o estado atual ou o de sem prova`);
    }
    seen.add(state);
  }
  assert.ok(shownDone > 1_000, 'a propriedade exercitou estimativas mostradas');
});

/*
 * P5-F.1-R3.2 (ADV-01 da revisão adversarial; F-08 da financeira e ADV-R2-01 da adversarial, rodada 2; ADV-R3-01 da
 * adversarial, rodada 3). Só a estimativa indisponível por um motivo decidido antes de qualquer receita (fonte PJ sem
 * confirmação, relatório sem bloco exato, desconsiderada sem estado confirmado) aparece como está, a desta
 * renderização, com ou sem prova: "preservar estados legitimamente indisponíveis". Todo o resto depende das leituras
 * de receita e só aparece provado e com a sincronização concluída: a que converte, a indisponível com a memória de
 * cálculo preenchida (meses, receitas, desconsideradas e totais) e a de rotinas ambíguas, cujo motivo depende de quais
 * meses têm renda. Um motivo que a lista não conhece também espera (fail-closed). Na rodada 1, toda indisponível
 * passava sem prova; na rodada 2, a de rotinas ambíguas também; antes do ADV-01, nenhuma passava.
 */
test('apresentação (R3.2, ADV-01, F-08 e ADV-R3-01): a indisponível por um motivo decidido antes das receitas aparece como está, com ou sem prova e sincronizando ou não; a que depende das receitas (com números, rotinas ambíguas, motivo novo) e a que converte, só provadas e sincronizadas', () => {
  const retry = () => undefined;
  const failed = {status: 'error' as const, message: 'falhou', retry};
  // Os motivos decididos antes de qualquer receita (base vazia, antes de `applyIncomeExclusions` em `estimate.ts`), os
  // de rotina ambígua (base vazia, mas depois do corte dos meses sem renda) e os que trazem a base preenchida. A
  // classificação cobre todos os motivos que a interface conhece.
  const decidedBeforeIncome = ['business_not_confirmed', 'report_unavailable', 'exclusion_unconfirmed'] as const;
  const ambiguous = ['ambiguous_routines', 'ambiguous_reduced_eve'] as const;
  const withFigures = ['no_income', 'no_work_minutes', 'income_too_low', 'income_too_high', 'work_minutes_too_high', 'hourly_rate_too_low'] as const;
  assert.deepEqual([...decidedBeforeIncome, ...ambiguous, ...withFigures].sort(), Object.keys(UNAVAILABLE_REASON_TEXT).sort(), 'todos os motivos classificados');
  const month = {month: '2026-10', receiptsCents: 352_000, eligibleCents: 352_000, excludedCents: 0, excludedCount: 0, workMinutes: 0, workDays: 0};
  const unavailableState = (reason: string, months: readonly object[], refreshFailed: boolean): IncomeEstimateState => ({
    status: 'done', estimate: {status: 'unavailable', reason, months} as unknown as WorkTimeEstimate, updatedAt: 1, refreshFailed, retry,
  });
  for (const proven of [true, false]) {
    for (const settling of [true, false]) {
      for (const unproven of [LOADING, failed]) {
        const label = (reason: string, refreshFailed: boolean) =>
          `${reason}${refreshFailed ? ' com aviso' : ''}, ${proven ? 'provada' : 'sem prova'}, ${settling ? 'sincronizando' : 'sincronizada'}, ${unproven.status}`;
        const held = (state: IncomeEstimateState) => (proven && !settling ? state : unproven);
        for (const refreshFailed of [false, true]) {
          for (const reason of decidedBeforeIncome) {
            const state = unavailableState(reason, [], refreshFailed);
            assert.equal(holdEstimate(proven, settling, state, unproven), state, `${label(reason, refreshFailed)}: decidido antes das receitas, como está`);
          }
          for (const reason of [...ambiguous, 'motivo_novo']) {
            const state = unavailableState(reason, [], refreshFailed);
            assert.equal(holdEstimate(proven, settling, state, unproven), held(state),
              `${label(reason, refreshFailed)}: sem números, mas depende das receitas (ou é desconhecido): só provado e sincronizado`);
          }
          for (const reason of withFigures) {
            const state = unavailableState(reason, [month], refreshFailed);
            assert.equal(holdEstimate(proven, settling, state, unproven), held(state),
              `${label(reason, refreshFailed)}: o indisponível com números, só provado e sincronizado`);
          }
        }
        // A que converte continua: só provada e sincronizada.
        const ready = done(400);
        assert.equal(holdEstimate(proven, settling, ready, unproven), held(ready), `pronta, ${proven}, ${settling}`);
      }
    }
  }
});

// ------------------------------------------------------------------ gancho com a API em memória

interface Fake {
  deps: IncomeEstimateDeps;
  /** Receita por mês da série (o mês corrente é parcial). */
  receipts: Record<string, number>;
  extraReceipts: Record<string, number>;
  seriesCalls: number;
  monthCalls: number;
  /** A leitura do mês avulso falha. */
  monthFailing: boolean;
  monthDelayMs: number;
  seriesDelayMs: number;
  /** Ordem em que as leituras começam. */
  log: string[];
  byIdReads: number;
  /**
   * Latência da leitura por id. No produto ela é uma ida ao servidor, e a raiz do React 18 agrupa as
   * renderizações das duas estimativas; no react-test-renderer em modo legado, elas saem em passos
   * diferentes do `act` (uns 5 ms entre si). Com 20 ms, as duas liberações dividem a leitura em curso
   * como no produto (R6-04).
   */
  byIdsDelayMs: number;
  /** Chamado quando a leitura por id dada termina de ler, antes de responder (para parar o relógio). */
  byIdsLanded: ((read: number) => void) | null;
  /** Data do lançamento desconsiderado (padrão: outubro, dentro da janela habitual). */
  excludedDate: string;
  /** O lançamento desconsiderado foi anulado no Firestore. */
  voided: boolean;
  /**
   * INV-M (P5-F.1-R3): o gatilho aplicou à projeção o conteúdo atual do lançamento desconsiderado. A marca de
   * aplicação muda no MESMO passo síncrono em que a receita da projeção (`receipts`, `extraReceipts`) passa a
   * refletir o estado dele: chame junto com a alteração da receita. A marca começa no estado de criação; uma
   * anulação ou mudança de data feita sem `apply` fica com a marca no conteúdo anterior (o atraso do gatilho).
   */
  apply: () => void;
  /** Estado do bloco da série (o backend marca `rebuild_needed` quando o gatilho desiste). */
  seriesStatus: 'exact' | 'rebuild_needed';
  emit: (snapshot: PeriodsSnapshot) => void;
  /**
   * A escuta aberta entrega, logo depois de abrir, o retorno do servidor com a projeção atual dos meses dela
   * (a receita da série e do mês avulso), como o SDK faz (P5-F.1-R1). Desligado, só `emit` entrega.
   */
  initialSnapshot: boolean;
  /** As escutas abertas são encerradas por erro (o SDK não as reabre). */
  failListen: () => void;
  opened: number;
}

/**
 * Hora do servidor do Firestore em memória (P5-F.1-R1): cada escrita da projeção e de um lançamento
 * avança o relógio, e a projeção de um mês só muda de versão quando a receita dele muda (o gatilho só grava
 * o mês quando o total ou a distribuição diária muda).
 */
let serverClock = 100;
const tick = () => { serverClock += 1; return serverClock; };
const at = (seconds: number) => ({seconds, nanoseconds: 0});
const projectionVersions = new Map<string, {income: number; version: number}>();

const fake = (): Fake => {
  const listeners = new Set<(snapshot: PeriodsSnapshot) => void>();
  // O lançamento desconsiderado: criado antes de tudo; a anulação e a mudança de data são escritas com hora.
  let excludedDate = '2026-10-15';
  let voided = false;
  let voidedAt: number | null = null;
  let updatedAt = 1;
  const docOf = (id: string, content: {date: string; updatedAt: number; voidedAt: number | null}) => ({
    id, date: content.date, type: 'receita', valueCents: 50_000, isPaid: true,
    createdAt: at(1), updatedAt: at(content.updatedAt),
    ...(content.voidedAt !== null ? {voidedAt: at(content.voidedAt)} : {}),
  });
  /** O conteúdo do lançamento que a marca de aplicação diz estar na projeção. */
  let appliedContent = {date: excludedDate, updatedAt, voidedAt: voidedAt};
  const errorHandlers = new Map<(snapshot: PeriodsSnapshot) => void, () => void>();
  const state: Fake = {
    receipts: {'2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000, '2026-11': 100_000},
    extraReceipts: {},
    seriesCalls: 0,
    monthCalls: 0,
    monthFailing: false,
    monthDelayMs: 2,
    seriesDelayMs: 2,
    log: [],
    byIdReads: 0,
    byIdsDelayMs: 20,
    byIdsLanded: null,
    get excludedDate() { return excludedDate; },
    set excludedDate(value: string) { excludedDate = value; updatedAt = tick(); },
    get voided() { return voided; },
    set voided(value: boolean) {
      voided = value;
      updatedAt = tick();
      voidedAt = value ? updatedAt : null;
    },
    apply: () => { appliedContent = {date: excludedDate, updatedAt, voidedAt: voided ? voidedAt : null}; },
    seriesStatus: 'exact',
    opened: 0,
    initialSnapshot: true,
    emit: (snapshot) => act(() => [...listeners].forEach((listener) => listener(snapshot))),
    failListen: () => act(() => [...listeners].forEach((listener) => {
      listeners.delete(listener);
      errorHandlers.get(listener)?.();
    })),
    deps: {
      basis: {
        fetchReport: async (payload) => {
          if (payload.range.kind === 'month') {
            state.monthCalls += 1;
            await wait(state.monthDelayMs);
            if (state.monthFailing) throw new Error('Não foi possível carregar o relatório. Tente novamente.');
            return {
              referenceDate: REFERENCE, workspaceType: 'PF', generatedAt: `m-${state.monthCalls}`,
              period: {range: payload.range},
              cash: {status: 'exact', data: {receiptsCents: state.extraReceipts[payload.range.month] ?? 0}},
            } as unknown as FinancialReport;
          }
          state.seriesCalls += 1;
          state.log.push('relatório');
          await wait(state.seriesDelayMs);
          return {
            referenceDate: REFERENCE, workspaceType: 'PF', generatedAt: `s-${state.seriesCalls}`,
            series: {
              status: state.seriesStatus,
              data: state.seriesStatus === 'exact' ? {points: Object.entries(state.receipts).map(([month, receiptsCents]) => ({month, receiptsCents, partial: month === '2026-11'}))} : null,
            },
          } as unknown as FinancialReport;
        },
        subscribePeriods: (_workspaceId, first, last, onNext, onError) => {
          listeners.add(onNext);
          errorHandlers.set(onNext, onError);
          state.opened += 1;
          if (state.initialSnapshot) {
            setTimeout(() => {
              if (!listeners.has(onNext)) return;
              const income = Object.fromEntries(Object.entries({...state.receipts, ...state.extraReceipts})
                .filter(([month]) => month >= first && month <= last));
              act(() => onNext(server(income)));
            }, 1);
          }
          return () => {
            listeners.delete(onNext);
            errorHandlers.delete(onNext);
          };
        },
        refresh: {options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 100, refillMs: 60_000}},
      } satisfies BasisSyncDeps,
      readByIds: async (_workspaceId, ids) => {
        state.byIdReads += 1;
        const read = state.byIdReads;
        state.log.push('exclusões');
        await wait(state.byIdsDelayMs);
        state.byIdsLanded?.(read);
        const content = {date: state.excludedDate, updatedAt, voidedAt: state.voided ? voidedAt : null};
        return {
          found: ids.map((id) => docOf(id, content)),
          missing: [],
          raw: Object.fromEntries(ids.map((id) => [id, docOf(id, content)])),
        };
      },
      // A transação só de leitura (P5-F.1-R3): os meses da janela e as marcas, no mesmo instante (o estado de quando começa).
      readProjectionMarks: async (_workspaceId, months, ids) => {
        const income: Record<string, number> = {...state.receipts, ...state.extraReceipts};
        const monthsRead: Record<string, SnapshotMonth> = {};
        for (const month of months) {
          monthsRead[month] = income[month] === undefined
            ? {exists: false, incomeCents: Number.NaN, generation: null}
            : {exists: true, incomeCents: income[month], generation: {id: 'g0', cutoff: null}};
        }
        const applied = {...appliedContent};
        const marks: Record<string, unknown> = {};
        for (const id of ids) {
          marks[id] = {chains: {a: {
            g: 'g0', cut: null, root: 'absent', base: null,
            node: {k: 'alive', fp: await transactionFingerprint(docOf(id, applied))},
            pending: [], broken: null,
          }}};
        }
        await wait(1);
        return {months: monthsRead, marks};
      },
    },
  };
  return state;
};

const server = (income: Record<string, number>, changes = Object.keys(income).length): PeriodsSnapshot => ({
  documents: Object.entries(income).map(([id, incomeCents]) => {
    const known = projectionVersions.get(id);
    const version = known !== undefined && known.income === incomeCents ? known.version : tick();
    projectionVersions.set(id, {income: incomeCents, version});
    return {id, incomeCents, updatedAt: at(version)};
  }),
  fromCache: false,
  changes,
});

let renderer: ReactTestRenderer | null = null;
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  clearBasisRegistry();
  serverClock = 100;
  projectionVersions.clear();
});

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

/** Uma estimativa cujas entradas mudam (por exemplo, "meses do histórico" trocado e salvo). */
const mountSwitchable = (f: Fake, initial: IncomeEstimateParams) => {
  const client = new QueryClient({defaultOptions: {queries: {retryDelay: 1, refetchOnWindowFocus: false}}});
  const renders: Array<{months: number; state: IncomeEstimateState}> = [];
  const setter: {current: ((value: IncomeEstimateParams) => void) | null} = {current: null};
  const Estimate = () => {
    const [estimateParams, setParams] = useState(initial);
    setter.current = setParams;
    renders.push({months: estimateParams.historyMonths, state: useIncomeEstimateWith(f.deps, 'u1', estimateParams)});
    return null;
  };
  act(() => { renderer = TestRenderer.create(createElement(QueryClientProvider, {client}, createElement(Estimate))); });
  return {
    client, renders,
    setParams: (value: IncomeEstimateParams) => act(() => setter.current?.(value)),
    latest: () => renders[renders.length - 1]?.state,
  };
};

const mount = (f: Fake, estimateParams: IncomeEstimateParams) => {
  const client = new QueryClient({defaultOptions: {queries: {retryDelay: 1, refetchOnWindowFocus: false}}});
  const renders: IncomeEstimateState[] = [];
  const Estimate = () => {
    renders.push(useIncomeEstimateWith(f.deps, 'u1', estimateParams));
    return null;
  };
  act(() => { renderer = TestRenderer.create(createElement(QueryClientProvider, {client}, createElement(Estimate))); });
  const latest = () => renders[renders.length - 1];
  return {client, renders, latest};
};

/** O provedor montado e a prévia de Configurações montada depois, na mesma sessão (mesmo cache). */
const mountWithPreview = (f: Fake, estimateParams: IncomeEstimateParams) => {
  const client = new QueryClient({defaultOptions: {queries: {retryDelay: 1, refetchOnWindowFocus: false}}});
  const provider: IncomeEstimateState[] = [];
  const preview: IncomeEstimateState[] = [];
  const show: {current: ((on: boolean) => void) | null} = {current: null};
  const Provider = () => { provider.push(useIncomeEstimateWith(f.deps, 'u1', estimateParams)); return null; };
  const Preview = () => { preview.push(useIncomeEstimateWith(f.deps, 'u1', estimateParams)); return null; };
  const Root = () => {
    const [on, setOn] = useState(false);
    show.current = setOn;
    return createElement(QueryClientProvider, {client}, createElement(Provider), on ? createElement(Preview) : null);
  };
  act(() => { renderer = TestRenderer.create(createElement(Root)); });
  return {client, provider, preview, showPreview: (on = true) => act(() => show.current?.(on))};
};

const readyOf = (state: IncomeEstimateState | undefined) =>
  state?.status === 'done' && state.estimate.status === 'ready' ? state.estimate : null;
type Failed = Extract<IncomeEstimateState, {status: 'error'}>;
/** Nenhuma estimativa pronta nas renderizações (P5-F.1-R3.1): os valores ficam em reais. */
const assertNoConversion = (states: readonly IncomeEstimateState[], message: string) => {
  const shown = states.filter((state) => state.status === 'done').map((state) => readyOf(state)?.incomeCents ?? 'indisponível');
  assert.deepEqual(shown, [], message);
};

test('leitura por id: cada leitura concluída traz um objeto novo, mesmo com os mesmos dados e no mesmo milissegundo', async () => {
  const client = new QueryClient({defaultOptions: {queries: {retryDelay: 1, refetchOnWindowFocus: false}}});
  const seen: Array<{data: unknown; at: number}> = [];
  const refetch: {current: (() => Promise<unknown>) | null} = {current: null};
  const read = async (_workspaceId: string, ids: readonly string[]) => ({found: ids.map((id) => ({id, valueCents: 50_000})), missing: []});
  const Reader = () => {
    const result = useTransactionsByIdsWith(read, 'ws-a', ['r500']);
    const queryClient = useQueryClient();
    refetch.current = () => queryClient.refetchQueries({queryKey: incomeReadsKey('ws-a', 'by-ids')});
    if (result.data !== undefined && seen[seen.length - 1]?.data !== result.data) seen.push({data: result.data, at: result.dataUpdatedAt});
    return null;
  };
  act(() => { renderer = TestRenderer.create(createElement(QueryClientProvider, {client}, createElement(Reader))); });
  await until(() => seen.length === 1, 'primeira leitura');
  const realNow = Date.now;
  const stoppedAt = realNow();
  Date.now = () => stoppedAt;
  try {
    for (const expected of [2, 3]) {
      await act(async () => { await refetch.current?.(); });
      await until(() => seen.length === expected, `leitura ${expected}`);
    }
  } finally {
    Date.now = realNow;
  }
  assert.deepEqual(seen.slice(1).map((entry) => entry.at), [stoppedAt, stoppedAt], 'as duas releituras com o mesmo `dataUpdatedAt`');
  assert.deepEqual(seen[1].data, seen[0].data);
  assert.deepEqual(seen[2].data, seen[0].data);
  assert.equal(new Set(seen.map((entry) => entry.data)).size, 3, 'um objeto por leitura concluída');
});

test('duas leituras por id concluídas no mesmo milissegundo e com os mesmos dados, a segunda pedida pela base que chegou durante a primeira: a estimativa mostra a base nova (R6-02)', async () => {
  const f = fake();
  const {client, renders, latest} = mount(f, params({excludedIds: ['r500']}));
  await until(() => readyOf(latest()) !== null, 'estimativa inicial');
  assert.equal(readyOf(latest())?.incomeCents, 1_056_000);
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000}));
  await settle(100);
  // Uma mutação nesta aba muda outubro para R$ 3.020,00: o gatilho grava a projeção (a escuta a vê) e a
  // releitura da mutação traz a base; a leitura por id é relida devagar.
  f.byIdsDelayMs = 100;
  f.receipts['2026-10'] = 302_000;
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 302_000}, 1));
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  await until(() => f.byIdReads === 2, 'base nova; leitura por id em releitura');
  // Antes de ela chegar, outra mudança: R$ 2.520,00 na projeção e na outra leitura das bases. O relógio para
  // quando a leitura por id chega: a releitura pedida por essa base, sem latência, termina no mesmo
  // milissegundo e com os mesmos dados.
  f.byIdsDelayMs = 0;
  f.receipts['2026-10'] = 252_000;
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 252_000}, 1));
  const realNow = Date.now;
  let stopped: number | null = null;
  f.byIdsLanded = (read) => {
    if (read !== 2) return;
    const at = realNow();
    stopped = at;
    Date.now = () => at;
  };
  try {
    await act(async () => { await client.refetchQueries({queryKey: [FINANCIAL_REPORT_BASIS_KEY], exact: false}); });
    await until(() => f.byIdReads === 3 && readyOf(latest())?.incomeCents === 906_000, 'a estimativa com a base nova, depois da releitura por id');
  } finally {
    Date.now = realNow;
    f.byIdsLanded = null;
  }
  // A chave da leitura inclui a janela de meses da prova (P5-F.1-R3): a leitura sem janela, de antes de a série
  // carregar, fica na cache sem dados; vale a que tem dados, uma só.
  const byIds = client.getQueryCache().findAll({queryKey: incomeReadsKey('ws-a', 'by-ids')}).filter((query) => query.state.data !== undefined);
  assert.equal(byIds.length, 1);
  assert.ok(stopped !== null);
  assert.deepEqual([byIds[0].state.dataUpdateCount, byIds[0].state.dataUpdatedAt], [3, stopped], 'a segunda e a terceira leitura com o mesmo `dataUpdatedAt`');
  await settle(150);
  assert.equal(readyOf(latest())?.incomeCents, 906_000);
  // Agosto e setembro (R$ 3.520,00 cada) mais outubro sem a desconsiderada (R$ 500,00): antes, R$ 10.560,00;
  // no fim, R$ 9.060,00.
  const incomes = [...new Set(renders.map(readyOf).filter((estimate) => estimate !== null).map((estimate) => estimate.incomeCents))];
  assert.deepEqual([incomes[0], incomes[incomes.length - 1]], [1_056_000, 906_000]);
  // A série: a carga; para R$ 3.020,00, o pedido da escuta e a releitura da mutação, que saem juntos (a segunda
  // cancela a primeira); para R$ 2.520,00, a outra leitura e o pedido da escuta, agendado antes de ela chegar.
  // A leitura por id: a carga e, depois de cada base nova provada pela projeção, uma releitura.
  assert.deepEqual([f.seriesCalls, f.byIdReads], [5, 3], 'cada base nova relê as exclusões uma vez, depois dela');
});

test('mutação nesta aba: anular a receita desconsiderada nunca junta o item anulado com o total velho (R4-01)', async () => {
  const f = fake();
  const estimateParams = params({excludedIds: ['r500']});
  const {client, renders, latest} = mount(f, estimateParams);
  await until(() => readyOf(latest()) !== null, 'estimativa inicial');
  // Agosto a outubro, sem a receita desconsiderada de outubro (R$ 500,00).
  assert.equal(readyOf(latest())?.incomeCents, 1_056_000);
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000}));
  await settle(100);
  assert.deepEqual([f.seriesCalls, f.byIdReads], [1, 1]);
  // A pessoa anula essa receita em Lançamentos, nesta aba: o lançamento muda já; a mutação invalida
  // as leituras de lançamentos e os relatórios (como `invalidateTransactionDependents`).
  f.voided = true;
  await act(async () => {
    await Promise.all([invalidateTransactionReads(client, 'ws-a'), invalidateFinancialReports(client)]);
  });
  // A mutação relê a base do workspace pelo agendador (sem a leitura por id): o gatilho ainda não
  // gravou, então ela volta igual e nada muda.
  await until(() => f.seriesCalls === 2, 'base relida pela mutação');
  await settle(60);
  assert.equal(f.byIdReads, 1, 'a leitura por id não é relida antes da base');
  // O gatilho grava a projeção de outubro sem os R$ 500,00; a escuta vê a divergência.
  f.receipts['2026-10'] = 352_000;
  f.apply();
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 352_000}, 1));
  await until(() => {
    const estimate = readyOf(latest());
    return estimate !== null && estimate.notes.some((note) => note.kind === 'exclusions_ignored') && estimate.months[2]?.receiptsCents === 352_000;
  }, 'base nova e a exclusão anulada ignorada');
  await settle(150);
  // Do começo ao fim, a renda elegível é a mesma: antes, o total com a receita menos a exclusão;
  // depois, o total sem ela, com a exclusão ignorada. Nenhuma renderização mistura as versões.
  const incomes = new Set(renders.map(readyOf).filter((estimate) => estimate !== null).map((estimate) => estimate.incomeCents));
  assert.deepEqual([...incomes], [1_056_000], 'nenhum valor intermediário');
  assert.deepEqual([f.seriesCalls, f.byIdReads], [3, 2], 'a releitura da mutação, a da projeção nova e, depois dela, uma das exclusões');
});

test('janela de 12 meses: a carga lê a série, o mês avulso e as exclusões uma vez cada, com a escuta adiantada (R4-02)', async () => {
  const f = fake();
  for (let month = 12; month >= 1; month -= 1) {
    const date = new Date(Date.UTC(2026, 10 - month, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    if (month === 12) f.extraReceipts[key] = 300_000;
    else f.receipts[key] = 300_000;
  }
  f.receipts['2026-11'] = 100_000;
  f.monthDelayMs = 80;
  const {latest} = mount(f, params({historyMonths: 12, excludedIds: ['r500']}));
  await until(() => f.seriesCalls === 1 && f.monthCalls === 1, 'série carregada; mês avulso em leitura');
  // O primeiro retorno da escuta chega antes do mês avulso: só é guardado.
  f.emit(server({...f.extraReceipts, ...Object.fromEntries(Object.entries(f.receipts).filter(([month]) => month !== '2026-11'))}));
  await until(() => readyOf(latest()) !== null, 'estimativa de 12 meses');
  await settle(250);
  assert.equal(readyOf(latest())?.months.length, 12);
  assert.deepEqual([f.seriesCalls, f.monthCalls, f.byIdReads], [1, 1, 1], 'duas chamadas e uma leitura por id');
});

test('leitura por id antiga: a prévia montada depois de uma mutação nesta aba não a relê antes da base (R5-01)', async () => {
  const f = fake();
  const {client, provider, preview, showPreview} = mountWithPreview(f, params({excludedIds: ['r500']}));
  await until(() => readyOf(provider[provider.length - 1]) !== null, 'estimativa do provedor');
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000}));
  await settle(100);
  // A leitura por id foi feita há mais de 5 minutos.
  // A chave da leitura inclui a janela de meses da prova (P5-F.1-R3): a leitura sem janela, de antes de a série
  // carregar, fica na cache sem dados; vale a que tem dados, uma só.
  const byIds = client.getQueryCache().findAll({queryKey: incomeReadsKey('ws-a', 'by-ids')}).filter((query) => query.state.data !== undefined);
  assert.equal(byIds.length, 1);
  act(() => byIds[0].setState({...byIds[0].state, dataUpdatedAt: Date.now() - 6 * 60_000}));
  // Nesta aba, a receita desconsiderada é anulada; logo depois, antes do gatilho, a prévia monta.
  f.voided = true;
  await act(async () => {
    await Promise.all([invalidateTransactionReads(client, 'ws-a'), invalidateFinancialReports(client)]);
  });
  showPreview();
  await until(() => readyOf(preview[preview.length - 1]) !== null, 'estimativa da prévia');
  await settle(150);
  assert.equal(f.byIdReads, 1, 'nem a montagem nem a mutação relêem a leitura por id antes da base');
  // O gatilho grava a projeção: as duas estimativas sincronizam.
  f.receipts['2026-10'] = 352_000;
  f.apply();
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 352_000}, 1));
  await until(() => [provider, preview].every((renders) => {
    const estimate = readyOf(renders[renders.length - 1]);
    return estimate !== null && estimate.notes.some((note) => note.kind === 'exclusions_ignored');
  }), 'as duas estimativas sincronizadas');
  await settle(150);
  for (const [name, renders] of [['provedor', provider], ['prévia', preview]] as const) {
    const incomes = new Set(renders.map(readyOf).filter((estimate) => estimate !== null).map((estimate) => estimate.incomeCents));
    assert.deepEqual([...incomes], [1_056_000], `${name}: nenhum valor intermediário`);
  }
  assert.equal(f.byIdReads, 2, 'uma releitura das exclusões, depois da base');
});

test('reconstrução marcada sem mudar os documentos mensais: a mutação relê a base, e a estimativa fica indisponível (R5-02)', async () => {
  const f = fake();
  const {client, latest} = mount(f, params({excludedIds: ['r500']}));
  await until(() => readyOf(latest()) !== null, 'estimativa inicial');
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000}));
  await settle(100);
  // O gatilho desiste de aplicar um lançamento e marca a projeção para reconstrução: a escuta não vê nada.
  f.seriesStatus = 'rebuild_needed';
  await act(async () => {
    await Promise.all([invalidateTransactionReads(client, 'ws-a'), invalidateFinancialReports(client)]);
  });
  await until(() => {
    const state = latest();
    return state?.status === 'done' && state.estimate.status === 'unavailable';
  }, 'estimativa indisponível');
  const state = latest();
  assert.ok(state?.status === 'done' && state.estimate.status === 'unavailable' && state.estimate.reason === 'report_unavailable');
  assert.equal(f.byIdReads, 1, 'a leitura por id não é relida pela mutação');
});

/*
 * R5-02, contrato reescrito na P5-F.1-R3.1 (R3-AUD-01). Antes: com a escuta encerrada, "a última leitura continua
 * valendo", com o aviso. Com desconsiderada, a prova depende da escuta: encerrada, nada prova a leitura em uso, e
 * mostrá-la seria a estimativa anterior como atual. Agora: o erro fixo com "Tentar de novo", sem conversão.
 */
test('escuta das projeções encerrada por erro, com desconsiderada: sem prova, o erro fixo com "Tentar de novo" e nenhuma conversão, nem a última leitura; "Tentar de novo" a reabre e a estimativa volta provada (R5-02, R3.1)', async () => {
  const f = fake();
  const {renders, latest} = mount(f, params({excludedIds: ['r500']}));
  await until(() => readyOf(latest()) !== null, 'estimativa inicial');
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000}));
  await settle(50);
  const done = () => { const state = latest(); return state?.status === 'done' ? state : null; };
  assert.equal(done()?.refreshFailed, false);
  const opened = f.opened;
  const from = renders.length;
  f.failListen();
  await until(() => latest()?.status === 'error', 'o erro da escuta encerrada');
  await settle(50);
  const failed = latest() as Failed;
  assert.equal(failed.message, ESTIMATE_UNCONFIRMED_FAILED);
  assertNoConversion(renders.slice(from), 'com a escuta encerrada, nenhuma conversão, nem a última leitura');
  act(() => failed.retry());
  await until(() => f.opened === opened + 1 && done()?.refreshFailed === false && readyOf(latest())?.incomeCents === 1_056_000,
    'escuta reaberta pelo "Tentar de novo", a estimativa provada');
});

test('prévia montada durante uma sincronização: as exclusões só são relidas depois da base (R5-01)', async () => {
  const f = fake();
  const {provider, preview, showPreview} = mountWithPreview(f, params({excludedIds: ['r500']}));
  await until(() => readyOf(provider[provider.length - 1]) !== null, 'estimativa do provedor');
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000}));
  await settle(100);
  // Receita nova de outra sessão em outubro: o provedor pede a releitura (lenta) da base.
  f.seriesDelayMs = 150;
  f.receipts['2026-10'] = 452_000;
  const before = f.log.length;
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 452_000}, 1));
  // A prévia monta no meio da sincronização e recebe o mesmo retorno da escuta.
  showPreview();
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 452_000}, 0));
  await until(() => [provider, preview].every((renders) => readyOf(renders[renders.length - 1])?.months[2]?.receiptsCents === 452_000), 'as duas com a base nova');
  await settle(150);
  assert.deepEqual(f.log.slice(before), ['relatório', 'exclusões'], 'a base primeiro; a montagem da prévia não relê as exclusões');
});

for (const listener of ['viva', 'encerrada'] as const) {
  test(`releitura da mutação com a base nova antes do retorno da escuta (${listener}): nenhuma renderização junta o total novo com a exclusão antiga (R6-02, B03)`, async () => {
    const f = fake();
    const estimateParams = params({excludedIds: ['r500']});
    const {client, renders, latest} = mount(f, estimateParams);
    await until(() => readyOf(latest()) !== null, 'estimativa inicial');
    f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000}));
    await settle(100);
    const failedFrom = renders.length;
    if (listener === 'encerrada') {
      f.failListen();
      // Com desconsiderada, a escuta encerrada tira a prova: o erro com "Tentar de novo", sem conversão (R3.1).
      await until(() => latest()?.status === 'error' && (latest() as Failed).message === ESTIMATE_UNCONFIRMED_FAILED, 'escuta encerrada');
    }
    const before = f.log.length;
    // Nesta aba, a receita desconsiderada de outubro (R$ 500,00) é anulada, e o gatilho grava a
    // projeção; a releitura da mutação traz a base nova antes de a escuta a entregar.
    f.voided = true;
    f.receipts['2026-10'] = 352_000;
    f.apply();
    await act(async () => {
      await Promise.all([invalidateTransactionReads(client, 'ws-a'), invalidateFinancialReports(client)]);
    });
    // Viva, a base nova relê as exclusões; encerrada, nada provaria uma leitura nova, e ela espera a escuta.
    await until(() => f.seriesCalls === 2 && f.byIdReads === (listener === 'viva' ? 2 : 1), 'a base nova (e, com a escuta viva, a leitura por id relida depois dela)');
    await settle(60);
    assert.equal(f.byIdReads, listener === 'viva' ? 2 : 1);
    // Sem a projeção nova confirmada, nada prova a base nova, e a anterior não aparece no lugar dela (B03; R3.1, antes
    // "vale a estimativa provada anterior"): nenhuma conversão.
    assertNoConversion(renders.slice(renders.length - 1), 'a base nova não aparece sem a projeção, nem a anterior');
    assert.equal(latest()?.status, listener === 'viva' ? 'loading' : 'error', listener === 'viva' ? '"calculando"' : 'o erro com "Tentar de novo"');
    // Em todas as renderizações até a prova (a escuta entregar a projeção nova, ou o "Tentar de novo"): a base nova
    // (outubro sem a anulada) nunca convertida; com a escuta encerrada, nenhuma conversão desde a falha.
    const untilProof = renders.length;
    assert.deepEqual(renders.slice(0, untilProof).map(readyOf).filter((estimate) => estimate !== null && estimate.months[2]?.receiptsCents === 352_000), [],
      'a base nova nunca convertida antes da prova');
    if (listener === 'encerrada') assertNoConversion(renders.slice(failedFrom, untilProof), 'com a escuta encerrada, nenhuma conversão até o "Tentar de novo"');
    if (listener === 'viva') {
      f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 352_000}, 1));
    } else {
      assert.equal((latest() as Failed).message, ESTIMATE_UNCONFIRMED_FAILED, 'o erro fixo, no lugar da ressalva');
      // "Tentar de novo": a escuta reabre e o servidor entrega a projeção atual.
      act(() => (latest() as Failed).retry());
    }
    await until(() => {
      const state = latest();
      const estimate = readyOf(state);
      return estimate !== null && state?.status === 'done' && !state.refreshFailed &&
        estimate.notes.some((note) => note.kind === 'exclusions_ignored') && estimate.months[2]?.receiptsCents === 352_000;
    }, 'base nova e a exclusão anulada ignorada, provadas pela projeção');
    await settle(150);
    const incomes = new Set(renders.map(readyOf).filter((estimate) => estimate !== null).map((estimate) => estimate.incomeCents));
    assert.deepEqual([...incomes], [1_056_000], 'nenhum valor intermediário (R$ 10.060,00 seria o total novo menos a exclusão antiga)');
    // Viva: a releitura da mutação, a das exclusões depois dela e, porque a versão nova de outubro chegou depois
    // dessa leitura por id, mais uma (regra 4 da prova). Encerrada: a releitura da mutação e, no "Tentar de
    // novo", a da série e, depois do retorno da escuta reaberta, a das exclusões.
    assert.deepEqual(f.log.slice(before), listener === 'viva'
      ? ['relatório', 'exclusões', 'exclusões']
      : ['relatório', 'relatório', 'exclusões']);
  });
}

test('escuta do provedor encerrada, com desconsiderada: o erro com "Tentar de novo" no provedor, sem conversão; a prévia de Configurações a reabre, e a estimativa em uso volta a acompanhar outras sessões (R6-01; R3.1)', async () => {
  const f = fake();
  const {provider, preview, showPreview} = mountWithPreview(f, params({excludedIds: ['r500']}));
  const last = (renders: IncomeEstimateState[]) => { const state = renders[renders.length - 1]; return state?.status === 'done' ? state : null; };
  await until(() => readyOf(provider[provider.length - 1]) !== null, 'estimativa do provedor');
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000}));
  await settle(100);
  f.failListen();
  // Com desconsiderada, a escuta encerrada tira a prova: o provedor mostra o erro com "Tentar de novo", sem conversão
  // (R3.1; antes, a última leitura com a ressalva).
  const failedFrom = provider.length;
  await until(() => provider[provider.length - 1]?.status === 'error', 'o erro no provedor');
  assert.equal((provider[provider.length - 1] as Failed).message, ESTIMATE_UNCONFIRMED_FAILED);
  assertNoConversion(provider.slice(failedFrom), 'o provedor sem conversão com a escuta encerrada');
  const opened = f.opened;
  // A pessoa segue a ressalva do topo ("Tente de novo em Configurações"): a prévia monta e abre a escuta dela.
  // O retorno do servidor à escuta da prévia reabre a do provedor.
  showPreview();
  await until(() => readyOf(preview[preview.length - 1]) !== null && f.opened === opened + 2 && last(provider)?.refreshFailed === false,
    'prévia com a própria escuta e a do provedor reaberta, sem a ressalva');
  // A prévia fecha; uma receita de R$ 500,00 de outra sessão em outubro chega à estimativa em uso.
  showPreview(false);
  f.receipts['2026-10'] = 452_000;
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 452_000}, 1));
  await until(() => readyOf(provider[provider.length - 1])?.incomeCents === 1_106_000, 'receita de outra sessão na estimativa em uso');
  assert.equal(last(provider)?.refreshFailed, false);
});

test('exclusão de um mês fora da janela, anulada nesta aba: a janela maior salva depois mostra a renda certa, sem juntar versões (R7-01)', async () => {
  const f = fake();
  f.excludedDate = '2026-07-15';
  f.apply();
  Object.assign(f.receipts, {'2026-05': 352_000, '2026-06': 352_000, '2026-07': 402_000});
  const client = new QueryClient({defaultOptions: {queries: {retryDelay: 1, refetchOnWindowFocus: false}}});
  const renders: Array<{months: number; state: IncomeEstimateState}> = [];
  const setter: {current: ((value: IncomeEstimateParams) => void) | null} = {current: null};
  const Estimate = () => {
    const [estimateParams, setParams] = useState(params({excludedIds: ['r500']}));
    setter.current = setParams;
    renders.push({months: estimateParams.historyMonths, state: useIncomeEstimateWith(f.deps, 'u1', estimateParams)});
    return null;
  };
  act(() => { renderer = TestRenderer.create(createElement(QueryClientProvider, {client}, createElement(Estimate))); });
  const latest = () => renders[renders.length - 1]?.state;
  await until(() => readyOf(latest()) !== null, 'estimativa de 3 meses');
  f.emit(server({'2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000}));
  await settle(100);
  // Com 3 meses (agosto a outubro), a desconsiderada de julho fica fora da janela.
  assert.equal(readyOf(latest())?.incomeCents, 1_106_000);
  const before = f.log.length;
  // Nesta aba, ela é anulada; o gatilho grava julho sem ela, e a releitura da mutação traz a base nova.
  f.voided = true;
  f.receipts['2026-07'] = 352_000;
  f.apply();
  await act(async () => {
    await Promise.all([invalidateTransactionReads(client, 'ws-a'), invalidateFinancialReports(client)]);
  });
  await until(() => f.byIdReads === 2, 'exclusões relidas depois da base, mesmo com julho fora da janela');
  await settle(100);
  assert.deepEqual(f.log.slice(before), ['relatório', 'exclusões']);
  // A pessoa passa a 6 meses (maio a outubro) e salva: julho já sem a receita, e ela não é mais descontada.
  act(() => setter.current?.(params({excludedIds: ['r500'], historyMonths: 6})));
  f.emit(server({'2026-05': 352_000, '2026-06': 352_000, '2026-07': 352_000, '2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000}));
  await until(() => {
    const last = renders[renders.length - 1];
    return last?.months === 6 && readyOf(last.state) !== null;
  }, 'estimativa de 6 meses');
  await settle(150);
  const sixMonths = new Set(renders.filter((render) => render.months === 6).map((render) => readyOf(render.state)?.incomeCents).filter((cents) => cents !== undefined));
  assert.deepEqual([...sixMonths], [2_162_000], 'nunca R$ 21.120,00 (julho novo com a exclusão antiga)');
  // Julho entra na janela sem ter sido escutado antes: a leitura por id em uso começou antes de a versão dele
  // chegar, então é relida uma vez depois dela (regra 4 da prova, B03).
  assert.equal(f.byIdReads, 3, 'a janela maior relê as exclusões uma vez, depois da projeção dos meses novos');
});

/** Janela habitual de 12 meses (novembro de 2025 a outubro de 2026), R$ 3.000,00 por mês; novembro de 2025 vem à parte. */
const twelveMonths = (f: Fake) => {
  for (let month = 12; month >= 1; month -= 1) {
    const date = new Date(Date.UTC(2026, 10 - month, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    if (month === 12) f.extraReceipts[key] = 300_000;
    else f.receipts[key] = 300_000;
  }
  f.receipts['2026-11'] = 100_000;
};
const projection12 = (f: Fake) =>
  server({...f.extraReceipts, ...Object.fromEntries(Object.entries(f.receipts).filter(([month]) => month !== '2026-11'))});
const monthOf = (state: IncomeEstimateState | undefined, month: string) => readyOf(state)?.months.find((entry) => entry.month === month);

test('janela de 12 meses, as duas bases relidas sem pedido e o mês avulso chegando depois: a estimativa segura até as duas chegarem, sem mostrar só uma nova (R8-03)', async () => {
  const f = fake();
  twelveMonths(f);
  const {client, renders, latest} = mount(f, params({historyMonths: 12, excludedIds: ['r500']}));
  await until(() => readyOf(latest()) !== null, 'estimativa de 12 meses');
  f.emit(projection12(f));
  await settle(100);
  // 12 × R$ 3.000,00, menos a desconsiderada de outubro (R$ 500,00).
  assert.equal(readyOf(latest())?.incomeCents, 3_550_000);
  const from = renders.length;
  // Nesta aba, uma receita de R$ 500,00 passa de novembro de 2025 para outubro de 2026; a releitura da
  // mutação traz a série logo e o mês avulso 150 ms depois.
  f.seriesDelayMs = 10;
  f.monthDelayMs = 150;
  f.extraReceipts['2025-11'] = 250_000;
  f.receipts['2026-10'] = 350_000;
  // O gatilho grava os dois meses; a escuta os vê.
  f.emit(projection12(f));
  await act(async () => {
    await Promise.all([invalidateTransactionReads(client, 'ws-a'), invalidateFinancialReports(client)]);
  });
  await until(() => f.byIdReads === 2 && monthOf(latest(), '2025-11')?.receiptsCents === 250_000 && monthOf(latest(), '2026-10')?.receiptsCents === 350_000,
    'as duas bases novas e a leitura por id relida depois delas');
  await settle(150);
  const incomes = new Set(renders.slice(from).map(readyOf).filter((estimate) => estimate !== null).map((estimate) => estimate.incomeCents));
  assert.deepEqual([...incomes], [3_550_000], 'nunca R$ 36.000,00 (só a série nova) nem R$ 35.000,00 (só o mês avulso novo)');
  assert.equal(f.byIdReads, 2, 'uma releitura da leitura por id, depois das duas bases');
});

test('janela de 12 meses, a série nova sem pedido e o mês avulso falhando: sem conversão enquanto ele lê e sem prova; com a projeção que prova a série nova, a atual com a ressalva da falha (R8-03; R3.1)', async () => {
  const f = fake();
  twelveMonths(f);
  const {client, renders, latest} = mount(f, params({historyMonths: 12, excludedIds: ['r500']}));
  await until(() => readyOf(latest()) !== null, 'estimativa de 12 meses');
  f.emit(projection12(f));
  await settle(100);
  const from = renders.length;
  const monthCallsBefore = f.monthCalls;
  // Nesta aba, uma receita de R$ 500,00 entra em outubro; a releitura da mutação traz a série logo, e a
  // do mês avulso falha (com a nova tentativa).
  f.seriesDelayMs = 10;
  f.monthDelayMs = 100;
  f.monthFailing = true;
  f.receipts['2026-10'] = 350_000;
  await act(async () => {
    await Promise.all([invalidateTransactionReads(client, 'ws-a'), invalidateFinancialReports(client)]);
  });
  // A série nova chega; o mês avulso falha duas vezes; depois da falha, a base nova relê as exclusões.
  await until(() => f.seriesCalls === 2 && f.monthCalls === monthCallsBefore + 2 && f.byIdReads === 2,
    'a série nova, o mês avulso falhando duas vezes e a leitura por id relida depois');
  await settle(100);
  // A escuta ainda não entregou a projeção nova de outubro: nada prova a série nova, e a anterior não aparece no lugar
  // dela (B03; R3.1, antes "vale a anterior"): nenhuma conversão, com o erro do mês avulso.
  assertNoConversion(renders.slice(from), 'sem a projeção nova, nenhuma conversão');
  assert.equal(latest()?.status, 'error', 'o erro do mês avulso, com "Tentar de novo"');
  f.emit(projection12(f));
  await until(() => {
    const state = latest();
    return state?.status === 'done' && state.refreshFailed && readyOf(state)?.incomeCents === 3_600_000;
  }, 'liberada depois da falha do mês avulso, com a ressalva');
  await settle(200);
  const shown = renders.slice(from).flatMap((state) => (state.status === 'done' && readyOf(state) !== null ? [{cents: readyOf(state)?.incomeCents, failed: state.refreshFailed}] : []));
  // Provada e sincronizada, com a leitura do mês avulso falhando: a atual, com a ressalva imediata (o aviso continua).
  assert.ok(shown.length > 0 && shown.every(({cents, failed}) => cents === 3_600_000 && failed), `só o total novo provado, com a ressalva: ${JSON.stringify(shown)}`);
  // A releitura por id depois da série nova começou antes de a versão nova de outubro chegar: mais uma, depois
  // dela (regra 4 da prova).
  assert.equal(f.byIdReads, 3, 'a leitura por id relida depois da falha e depois da projeção nova');
  assert.equal(f.monthCalls, monthCallsBefore + 2, 'a releitura do mês avulso e a nova tentativa dela, nada mais');
});

test('janela de 12 meses sem receita desconsiderada, com a escuta encerrada e a releitura da mutação da série adiada pelo orçamento: sem prova, o erro com "Tentar de novo" e nenhuma conversão, nem a versão anterior; reaberta a escuta, as bases novas provadas (R9-01; R3.1)', async () => {
  const f = fake();
  twelveMonths(f);
  const time = manualClock();
  f.deps.basis.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 1, refillMs: 10_000}};
  const {client, renders, setParams, latest} = mountSwitchable(f, params({excludedIds: []}));
  await until(() => readyOf(latest()) !== null, 'estimativa de 3 meses');
  f.emit(server({'2026-08': 300_000, '2026-09': 300_000, '2026-10': 300_000}));
  // Uma despesa nesta aba, ainda com 3 meses: a releitura da mutação gasta a ficha da série.
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => f.seriesCalls === 2, 'série relida pela mutação');
  await settle(50);
  // A pessoa passa a 12 meses (o mês avulso nasce com o orçamento cheio); a escuta é encerrada por erro.
  setParams(params({excludedIds: [], historyMonths: 12}));
  await until(() => readyOf(latest())?.months.length === 12, 'estimativa de 12 meses');
  assert.equal(readyOf(latest())?.incomeCents, 3_600_000);
  f.failListen();
  // Com a escuta encerrada, nada prova a janela de 12 meses (duas bases): o erro com "Tentar de novo" e nenhuma
  // conversão (P5-F.1-R3.1; antes, a estimativa provada anterior com a ressalva).
  await until(() => latest()?.status === 'error', 'o erro da escuta encerrada');
  await settle(50);
  assert.equal((latest() as Failed).message, ESTIMATE_UNCONFIRMED_FAILED);
  const from = renders.length;
  // Nesta aba, uma receita de R$ 500,00 passa de novembro de 2025 para outubro de 2026: o mês avulso é relido,
  // e a série espera a reposição.
  f.extraReceipts['2025-11'] = 250_000;
  f.receipts['2026-10'] = 350_000;
  await act(async () => {
    await Promise.all([invalidateTransactionReads(client, 'ws-a'), invalidateFinancialReports(client)]);
  });
  time.advance(50);
  await until(() => f.monthCalls === 2, 'mês avulso relido');
  await settle(150);
  assert.equal(f.seriesCalls, 2, 'a série espera a reposição');
  time.advance(10_000);
  await until(() => f.seriesCalls === 3, 'série relida na reposição');
  await settle(100);
  // Com a escuta encerrada, nada prova a combinação das duas bases novas, e a anterior não aparece no lugar dela
  // (B03; R3.1, antes "vale a estimativa provada anterior, com a ressalva"): o erro com "Tentar de novo".
  const stale = latest();
  assert.deepEqual([stale?.status, (stale as Failed).message], ['error', ESTIMATE_UNCONFIRMED_FAILED], 'sem prova, o erro');
  assertNoConversion(renders.slice(from).map((render) => render.state), 'nenhuma conversão com a escuta encerrada');
  // "Tentar de novo": a escuta reabre, o servidor entrega a projeção atual e as bases relidas a provam.
  act(() => (stale as Failed).retry());
  await until(() => {
    const state = latest();
    return monthOf(state, '2026-10')?.receiptsCents === 350_000 && monthOf(state, '2025-11')?.receiptsCents === 250_000 &&
      state?.status === 'done' && !state.refreshFailed;
  }, 'as bases novas provadas depois do "Tentar de novo"');
  await settle(100);
  const incomes = new Set(renders.slice(from).map((render) => readyOf(render.state)).filter((estimate) => estimate !== null).map((estimate) => estimate.incomeCents));
  assert.deepEqual([...incomes], [3_600_000], 'nunca R$ 35.500,00 (o mês avulso novo com a série antiga)');
  const months = renders.slice(from).map((render) => [monthOf(render.state, '2025-11')?.receiptsCents, monthOf(render.state, '2026-10')?.receiptsCents]);
  assert.deepEqual(months.filter(([november, october]) => november !== undefined && (november === 250_000) !== (october === 350_000)), [],
    'nenhuma renderização com só uma das bases novas');
});

test('janela de 12 meses com a escuta encerrada: a releitura pendente da série que sai sem rede fica pausada, e nenhuma renderização converte (nem a versão anterior nem o mês avulso novo com a série antiga) até a rede voltar e a prova (R10-03; R3.1)', async () => {
  const f = fake();
  twelveMonths(f);
  const time = manualClock();
  f.deps.basis.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 1, refillMs: 10_000}};
  const {client, renders, setParams, latest} = mountSwitchable(f, params({excludedIds: []}));
  await until(() => readyOf(latest()) !== null, 'estimativa de 3 meses');
  f.emit(server({'2026-08': 300_000, '2026-09': 300_000, '2026-10': 300_000}));
  // Uma despesa nesta aba, ainda com 3 meses: a releitura da mutação gasta a ficha da série.
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  time.advance(50);
  await until(() => f.seriesCalls === 2, 'série relida pela mutação');
  await settle(50);
  setParams(params({excludedIds: [], historyMonths: 12}));
  await until(() => readyOf(latest())?.months.length === 12, 'estimativa de 12 meses');
  f.failListen();
  // Com a escuta encerrada, nada prova a janela de 12 meses: o erro com "Tentar de novo", sem conversão (R3.1).
  await until(() => latest()?.status === 'error', 'o erro da escuta encerrada');
  await settle(50);
  const from = renders.length;
  // A receita de R$ 500,00 passa de novembro de 2025 para outubro de 2026: o mês avulso é relido, e a série espera a reposição.
  f.extraReceipts['2025-11'] = 250_000;
  f.receipts['2026-10'] = 350_000;
  await act(async () => {
    await Promise.all([invalidateTransactionReads(client, 'ws-a'), invalidateFinancialReports(client)]);
  });
  time.advance(50);
  await until(() => f.monthCalls === 2, 'mês avulso relido');
  await settle(100);
  onlineManager.setOnline(false);
  try {
    // A reposição: a releitura da série sai, mas sem rede o React Query a pausa antes da callable.
    time.advance(10_000);
    await settle(50);
    assert.equal(f.seriesCalls, 2, 'sem rede, nenhuma chamada');
    // Outra renderização (as mesmas entradas de novo) também não converte: nem a versão anterior nem o mês avulso
    // novo com a série antiga (R3.1; antes, "a busca pausada continua segurando" a anterior).
    setParams(params({excludedIds: [], historyMonths: 12}));
    await settle(50);
    assertNoConversion(renders.slice(from).map((render) => render.state), 'a busca pausada: nenhuma conversão');
    assert.equal(latest()?.status, 'error', 'o erro com "Tentar de novo"');
  } finally {
    onlineManager.setOnline(true);
  }
  await until(() => f.seriesCalls === 3, 'série lida com a rede de volta');
  await settle(100);
  // Com a escuta encerrada, nada prova a combinação, e a anterior não aparece (B03; R3.1, antes "vale a estimativa
  // provada anterior, com a ressalva"): o erro com "Tentar de novo".
  const stale = latest();
  assert.deepEqual([stale?.status, (stale as Failed).message], ['error', ESTIMATE_UNCONFIRMED_FAILED], 'sem prova, o erro');
  assertNoConversion(renders.slice(from).map((render) => render.state), 'nenhuma conversão com a escuta encerrada');
  act(() => (stale as Failed).retry());
  await until(() => {
    const state = latest();
    return monthOf(state, '2026-10')?.receiptsCents === 350_000 && monthOf(state, '2025-11')?.receiptsCents === 250_000 &&
      state?.status === 'done' && !state.refreshFailed;
  }, 'as bases novas provadas depois do "Tentar de novo"');
  await settle(100);
  const incomes = new Set(renders.slice(from).map((render) => readyOf(render.state)).filter((estimate) => estimate !== null).map((estimate) => estimate.incomeCents));
  assert.deepEqual([...incomes], [3_600_000], 'nunca R$ 35.500,00 (o mês avulso novo com a série antiga)');
  const months = renders.slice(from).map((render) => [monthOf(render.state, '2025-11')?.receiptsCents, monthOf(render.state, '2026-10')?.receiptsCents]);
  assert.deepEqual(months.filter(([november, october]) => november !== undefined && (november === 250_000) !== (october === 350_000)), [],
    'nenhuma renderização com só uma das bases novas');
});

test('janela de 12 meses com a releitura de uma mutação nesta aba pendente: o calendário trocado é guardado logo, e a sincronização seguinte (outro membro anula a desconsiderada) não mostra a receita descontada duas vezes (R10-02)', async () => {
  const f = fake();
  twelveMonths(f);
  const time = manualClock();
  // O agrupamento da mutação é bem maior que o da escuta: a releitura dela continua pendente durante todo o teste.
  f.deps.basis.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 5_000, burst: 100, refillMs: 60_000}};
  const {client, renders, setParams, latest} = mountSwitchable(f, params({excludedIds: ['r500'], historyMonths: 12}));
  await until(() => readyOf(latest()) !== null, 'estimativa de 12 meses');
  f.emit(projection12(f));
  await settle(50);
  // Doze meses de R$ 3.000,00 sem a desconsiderada de outubro (R$ 500,00).
  assert.equal(readyOf(latest())?.incomeCents, 3_550_000);
  // Uma despesa nesta aba: a releitura da mutação das duas bases fica pendente.
  await act(async () => { await invalidateTransactionReads(client, 'ws-a'); });
  // A pessoa troca o calendário em Configurações e salva.
  const from = renders.length;
  setParams(params({excludedIds: ['r500'], historyMonths: 12, calendar: {...OFFICE, worksOnHolidays: true}}));
  await settle(50);
  // Outro membro anula a desconsiderada: o gatilho grava outubro sem ela, e a escuta sincroniza.
  f.voided = true;
  f.receipts['2026-10'] = 250_000;
  f.apply();
  f.emit(server({...f.extraReceipts, ...Object.fromEntries(Object.entries(f.receipts).filter(([month]) => month !== '2026-11'))}, 1));
  time.advance(50);
  await until(() => f.byIdReads === 2 && readyOf(latest())?.notes.some((note) => note.kind === 'exclusions_ignored') === true,
    'a sincronização com a leitura por id relida');
  await settle(100);
  const incomes = [...new Set(renders.slice(from).map((render) => readyOf(render.state)?.incomeCents).filter((cents) => cents !== undefined))];
  assert.deepEqual(incomes, [3_550_000], 'nenhum estado intermediário depois da troca');
  assert.equal(f.seriesCalls, 2, 'a releitura da mutação continua pendente');
});

test('anulação nesta aba de uma desconsiderada do 12º mês para trás e a troca para 12 meses logo depois: o estado misto nunca aparece, e a estimativa de 12 meses só aparece com a sincronização concluída (R9-03, B03; R3.1)', async () => {
  const f = fake();
  twelveMonths(f);
  f.excludedDate = '2025-11-15';
  f.apply();
  const time = manualClock();
  f.deps.basis.refresh = {clock: time.clock, options: {coalesceMs: 50, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 50, burst: 100, refillMs: 60_000}};
  const {client, renders, setParams, latest} = mountSwitchable(f, params({excludedIds: ['r500']}));
  await until(() => readyOf(latest()) !== null, 'estimativa de 3 meses');
  f.emit(server({'2026-08': 300_000, '2026-09': 300_000, '2026-10': 300_000}));
  await settle(50);
  assert.equal(readyOf(latest())?.incomeCents, 900_000, 'a desconsiderada de novembro de 2025 fica fora da janela');
  // Nesta aba, ela é anulada; o gatilho grava novembro de 2025 sem ela. A releitura da mutação da série fica pendente.
  f.voided = true;
  f.extraReceipts['2025-11'] = 250_000;
  f.apply();
  await act(async () => {
    await Promise.all([invalidateTransactionReads(client, 'ws-a'), invalidateFinancialReports(client)]);
  });
  // Logo depois, a pessoa passa a 12 meses: a leitura por id é relida depois da projeção do mês avulso. Com a releitura
  // da mutação da série ainda pendente, a sincronização está em curso: nenhuma conversão (P5-F.1-R3.1; antes, a
  // estimativa de 12 meses aparecia sem esperar a releitura pendente da série). Nunca o estado misto.
  setParams(params({excludedIds: ['r500'], historyMonths: 12}));
  await until(() => f.byIdReads === 2, 'a leitura por id relida depois do mês avulso');
  await settle(100);
  assert.equal(f.seriesCalls, 1, 'a releitura da mutação da série ainda pendente');
  assertNoConversion(renders.filter((render) => render.months === 12).map((render) => render.state),
    'com a sincronização em curso, nenhuma conversão');
  // A releitura pendente da série sai e traz a mesma receita: a sincronização termina e a estimativa de 12 meses aparece
  // provada, sem outra leitura por id.
  time.advance(50);
  await until(() => f.seriesCalls === 2 && readyOf(latest())?.incomeCents === 3_550_000, 'a estimativa de 12 meses, com a sincronização concluída');
  await settle(150);
  const twelve = renders.filter((render) => render.months === 12).map((render) => render.state);
  assert.deepEqual([...new Set(twelve.map(readyOf).filter((estimate) => estimate !== null).map((estimate) => estimate.incomeCents))], [3_550_000],
    'nenhum estado misto (R$ 35.000,00: novembro de 2025 novo com a exclusão antiga)');
  assert.ok(twelve.every((state) => state.status === 'loading' || readyOf(state)?.incomeCents === 3_550_000), 'antes da prova e da sincronização, só "calculando"');
  assert.deepEqual([readyOf(latest())?.incomeCents, f.byIdReads], [3_550_000, 2]);
});
