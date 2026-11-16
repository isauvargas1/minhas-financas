// Sonda da rodada 3 (escala/custo P5-F.1-R3): quantas provas (transação de meses + marcas) a estimativa REAL
// (`useIncomeEstimateWith`, árvore congelada 377c2f3f) faz quando a projeção de um mês da janela diverge da base
// e volta, sem que as bases sejam relidas. Relógio dos agendadores manual e nunca avançado: nenhuma releitura de
// base, nenhuma releitura pelo agendador da prova. Dependências em memória, como o harness do repositório
// (`tests/unit/work-time-income-estimate.test.ts`). Sem rede, sem Firebase.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

const SRC = process.env.SONDA_SRC as string;
const {clearBasisRegistry} = await import(`${SRC}/modules/reports/basisRegistry.ts`);
const {DEFAULT_WEEKLY_ROUTINE} = await import(`${SRC}/modules/work-time/draft.ts`);
const {transactionFingerprint} = await import(`${SRC}/modules/work-time/projectionProof.ts`);
const {useIncomeEstimateWith} = await import(`${SRC}/modules/work-time/useIncomeEstimateWith.ts`);

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = async (ms: number) => { await act(async () => { await wait(ms); }); };
const until = async (condition: () => boolean, message: string, timeoutMs = 5_000) => {
  const started = performance.now();
  while (!condition()) {
    if (performance.now() - started > timeoutMs) assert.fail(`tempo esgotado: ${message}`);
    await act(async () => { await wait(5); });
  }
};

const REFERENCE = '2026-11-04';
const OFFICE = {routines: [DEFAULT_WEEKLY_ROUTINE], worksOnHolidays: false, localHolidays: [], exceptions: []};
let clockValue = 100;
const tick = () => { clockValue += 1; return clockValue; };
const at = (seconds: number) => ({seconds, nanoseconds: 0});
const versions = new Map<string, {income: number; version: number}>();
const server = (income: Record<string, number>, changes = Object.keys(income).length) => ({
  documents: Object.entries(income).map(([id, incomeCents]) => {
    const known = versions.get(id);
    const version = known !== undefined && known.income === incomeCents ? known.version : tick();
    versions.set(id, {income: incomeCents, version});
    return {id, incomeCents, updatedAt: at(version)};
  }),
  fromCache: false,
  changes,
});

const scenario = async (name: string, cycles: number, revert: boolean) => {
  clearBasisRegistry();
  versions.clear();
  clockValue = 100;
  const receipts: Record<string, number> = {'2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000, '2026-11': 100_000};
  const counts = {series: 0, byIds: 0, marks: 0};
  const listeners = new Set<(snapshot: unknown) => void>();
  const docOf = (id: string) => ({id, date: '2026-10-15', type: 'receita', valueCents: 50_000, isPaid: true, createdAt: at(1), updatedAt: at(1)});
  // Relógio manual que nunca anda: os agendadores (bases e prova) não disparam nada depois da carga.
  const frozen = {now: () => 0, setTimer: () => 0, clearTimer: () => undefined};
  const deps = {
    basis: {
      fetchReport: async () => {
        counts.series += 1;
        await wait(2);
        return {
          referenceDate: REFERENCE, workspaceType: 'PF', generatedAt: `s-${counts.series}`,
          series: {status: 'exact', data: {points: Object.entries(receipts).map(([month, receiptsCents]) => ({month, receiptsCents, partial: month === '2026-11'}))}},
        };
      },
      subscribePeriods: (_ws: string, first: string, last: string, onNext: (snapshot: unknown) => void) => {
        listeners.add(onNext);
        setTimeout(() => {
          if (!listeners.has(onNext)) return;
          act(() => onNext(server(Object.fromEntries(Object.entries(receipts).filter(([month]) => month >= first && month <= last)))));
        }, 1);
        return () => { listeners.delete(onNext); };
      },
      refresh: {clock: frozen, options: {coalesceMs: 5_000, burst: 5, refillMs: 120_000}, mutationOptions: {coalesceMs: 30_000, burst: 2, refillMs: 600_000}},
    },
    readByIds: async (_ws: string, ids: readonly string[]) => {
      counts.byIds += 1;
      await wait(5);
      return {found: ids.map(docOf), missing: [], raw: Object.fromEntries(ids.map((id) => [id, docOf(id)]))};
    },
    readProjectionMarks: async (_ws: string, months: readonly string[], ids: readonly string[]) => {
      counts.marks += 1;
      const monthsRead: Record<string, unknown> = {};
      for (const month of months) monthsRead[month] = {exists: true, incomeCents: receipts[month], generation: {id: 'g0', cutoff: null}};
      const marks: Record<string, unknown> = {};
      for (const id of ids) {
        marks[id] = {chains: {a: {g: 'g0', cut: null, root: 'absent', base: null, node: {k: 'alive', fp: await transactionFingerprint(docOf(id))}, pending: [], broken: null}}};
      }
      await wait(1);
      return {months: monthsRead, marks};
    },
  };
  const params = {workspaceId: 'ws-a', mode: 'habitual', historyMonths: 3, allowBusinessIncome: false, calendar: OFFICE, excludedIds: ['r1', 'r2'], enabled: true};
  const client = new QueryClient({defaultOptions: {queries: {retryDelay: 1, refetchOnWindowFocus: false}}});
  const renders: Array<{status: string; estimate?: {status: string}}> = [];
  const Estimate = () => { renders.push(useIncomeEstimateWith(deps, 'u1', params)); return null; };
  let renderer: ReturnType<typeof TestRenderer.create> | null = null;
  act(() => { renderer = TestRenderer.create(createElement(QueryClientProvider, {client}, createElement(Estimate))); });
  const ready = () => { const s = renders[renders.length - 1]; return s?.status === 'done' && s.estimate?.status === 'ready'; };
  await until(ready, `${name}: carga provada`);
  await settle(50);
  const before = {...counts};
  const emit = (snapshot: unknown) => act(() => [...listeners].forEach((listener) => listener(snapshot)));
  const window = (oct: number) => ({'2026-08': 352_000, '2026-09': 352_000, '2026-10': oct});
  for (let i = 0; i < cycles; i += 1) {
    // Outro membro lança uma receita no mês da janela; o gatilho grava o mês; a escuta vê a divergência.
    emit(server(window(402_000 + 10_000 * (i + 1)), 1));
    await settle(30);
    if (revert) {
      // A receita é anulada (ou a edição desfeita) antes de as bases relerem: a projeção volta à base.
      emit(server(window(402_000), 1));
      await settle(60);
    }
  }
  await settle(100);
  const after = {...counts};
  act(() => renderer?.unmount());
  return {
    cenario: name, ciclos: cycles,
    provasNaCarga: before.marks, releiturasDaBaseNaCarga: before.series,
    provasDepois: after.marks - before.marks, leiturasPorIdDepois: after.byIds - before.byIds,
    releiturasDaBaseDepois: after.series - before.series,
  };
};

test('sonda: liberação por convergência relê a prova sem orçamento; divergência sem volta não relê', async () => {
  const out = [];
  out.push(await scenario('diverge e volta (receita lançada e anulada antes da releitura das bases)', 20, true));
  out.push(await scenario('só diverge (receitas que só crescem, sem releitura das bases)', 20, false));
  console.log(JSON.stringify(out, null, 1));
});
