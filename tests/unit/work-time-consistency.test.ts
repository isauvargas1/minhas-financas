import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test, {afterEach} from 'node:test';
import {createElement, useState} from 'react';
import TestRenderer, {act, type ReactTestRenderer} from 'react-test-renderer';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';

import type {ConfirmedProjection} from '../../src/modules/reports/basisRefresh.ts';
import {clearBasisRegistry} from '../../src/modules/reports/basisRegistry.ts';
import type {BasisSyncDeps, PeriodsSnapshot} from '../../src/modules/reports/basisSync.ts';
import type {FinancialReport} from '../../src/modules/reports/official.ts';
import {invalidateFinancialReportBases} from '../../src/modules/reports/queryKeys.ts';
import type {WorkCalendar} from '../../src/modules/work-time/calendar.ts';
import {proveEstimateConsistency, type ConsistencyInput} from '../../src/modules/work-time/consistency.ts';
import {DEFAULT_WEEKLY_ROUTINE} from '../../src/modules/work-time/draft.ts';
import type {WorkTimeEstimate} from '../../src/modules/work-time/estimate.ts';
import {ESTIMATE_EXCLUDED_READ_FAILED, ESTIMATE_UNCONFIRMED_FAILED, ESTIMATE_UPDATING} from '../../src/modules/work-time/messages.ts';
import {proveProjectionExclusions, transactionFingerprint, type ProjectionProof, type SnapshotMonth} from '../../src/modules/work-time/projectionProof.ts';
import {readExcludedIncome} from '../../src/modules/work-time/receivableReversal.ts';
import {
  useIncomeEstimateWith,
  type IncomeEstimateDeps,
  type IncomeEstimateParams,
  type IncomeEstimateState,
} from '../../src/modules/work-time/useIncomeEstimateWith.ts';

/**
 * P5-F.1-R1 — prova de consistência da estimativa (B03) e estorno de recebimento desconsiderado
 * (B01), com a estimativa inteira (`useIncomeEstimateWith`: React Query real, React 18 e
 * react-test-renderer, sem DOM) sobre um Firestore em memória com hora do servidor: a projeção mensal
 * muda de versão quando a receita do mês muda, e cada escrita de lançamento tem `createdAt` e
 * `updatedAt`. Cada teste confere todas as renderizações: uma estimativa pronta só aparece com um valor
 * de um estado consistente (bases, projeção e leitura por id do mesmo estado).
 *
 * P5-F.1-R3 (B03): o mundo também tem as marcas de aplicação (`cash_projection_marks`) e a transação só de leitura
 * dos meses e das marcas (`readProjectionMarks`), com a invariante INV-M do sistema real: a marca de um lançamento
 * muda no MESMO passo síncrono em que a receita da projeção (`w.income`) passa a refletir o estado dele
 * (`w.apply`, chamado junto com a alteração de `w.income`). Um lançamento escrito sem o gatilho ter aplicado fica
 * com a marca no conteúdo anterior (o atraso do gatilho). Nenhum prazo, hora do servidor ou total coincidente
 * aprova a conversão: sem a marca aplicada, o estado é "calculando" ou "estimativa em atualização".
 */

(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const OFFICE: WorkCalendar = {routines: [DEFAULT_WEEKLY_ROUTINE], worksOnHolidays: false, localHolidays: [], exceptions: []};
const REFERENCE = '2026-11-04';
const at = (seconds: number) => ({seconds, nanoseconds: 0});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Espera a condição; no tempo esgotado, a mensagem traz o que as renderizações mostraram (`shown`). */
let shownSoFar: () => string = () => '';
const until = async (condition: () => boolean, message: string, timeoutMs = 3_000) => {
  const started = performance.now();
  while (!condition()) {
    if (performance.now() - started > timeoutMs) assert.fail(`tempo esgotado: ${message} (mostrados: ${shownSoFar()})`);
    await act(async () => { await wait(5); });
  }
};
const settle = async (ms = 100) => { await act(async () => { await wait(ms); }); };

// ------------------------------------------------------------------ prova (funções puras)

const MONTHS = ['2026-08', '2026-09', '2026-10'];
const INCOME = {'2026-08': 100, '2026-09': 100, '2026-10': 100};
const projectionOf = (patch: Partial<ConfirmedProjection> = {}): ConfirmedProjection => ({
  income: INCOME,
  versions: {'2026-08': at(10), '2026-09': at(10), '2026-10': at(10)},
  seen: {'2026-08': 1, '2026-09': 1, '2026-10': 1},
  ...patch,
});
const PROVEN: ProjectionProof = {proven: true, applied: {r1: {document: null, reversal: null}}};
const refused = (reason: Extract<ProjectionProof, {proven: false}>['reason']): ProjectionProof => ({proven: false, reason});
const input = (patch: Partial<ConsistencyInput> = {}): ConsistencyInput => ({
  months: MONTHS, hasExclusions: true,
  basis: {income: INCOME, exact: true},
  projection: projectionOf(),
  excludedStartedOrder: 5, excludedMonths: ['2026-10'], exclusionsProof: PROVEN,
  ...patch,
});
const reasonOf = (value: ConsistencyInput) => {
  const result = proveEstimateConsistency(value);
  return 'reason' in result ? result.reason : 'provada';
};

test('prova: cada regra, na ordem, com o motivo da primeira que falha', () => {
  assert.equal(reasonOf(input()), 'provada');
  assert.equal(reasonOf(input({basis: null})), 'loading', 'base carregando');
  // 1. Sem bloco exato, nada é provado, com ou sem escuta (P5-F.1-R3.2, F-03). A indisponível sem números (aqui,
  // `report_unavailable`) aparece como está sem depender da prova (`holdEstimate`, ADV-01 e F-08); uma que convertesse
  // sem bloco exato nunca apareceria.
  assert.equal(reasonOf(input({basis: {income: INCOME, exact: false}, projection: null, exclusionsProof: null})), 'inexact');
  assert.equal(reasonOf(input({hasExclusions: false, basis: {income: INCOME, exact: false}, projection: null, exclusionsProof: null})), 'inexact');
  assert.equal(reasonOf(input({hasExclusions: false, basis: {income: INCOME, exact: false}, exclusionsProof: null})), 'inexact',
    'nem com a projeção confirmada e igual às bases');
  // 2. Projeção confirmada: obrigatória sempre (P5-F.1-R3.2, RR-R31-05). Uma base e nenhuma desconsiderada não
  // dispensam a confirmação do servidor: a base lida, ou servida do cache, não prova sozinha que é a atual.
  assert.equal(reasonOf(input({projection: null})), 'projection');
  assert.equal(reasonOf(input({hasExclusions: false, projection: null, exclusionsProof: null})), 'projection',
    'uma base, nenhuma desconsiderada e nenhum retorno do servidor (a "leitura única" da R3.1 não prova mais)');
  // 3. Bases na projeção, mês a mês (mês sem documento vale 0).
  assert.equal(reasonOf(input({basis: {income: {...INCOME, '2026-09': 101}, exact: true}})), 'bases');
  assert.equal(reasonOf(input({projection: projectionOf({income: {'2026-08': 100, '2026-10': 100}})})), 'bases');
  assert.equal(reasonOf(input({basis: {income: {...INCOME, '2026-09': 0}, exact: true},
    projection: projectionOf({income: {'2026-08': 100, '2026-10': 100}})})), 'provada', 'zero e sem documento são o mesmo');
  // Também sem desconsiderada: a base que não alcança a projeção não é provada, por mais releituras que tenham sido
  // feitas (a divergência persistente da R3.1 era aceita pela leitura única).
  assert.equal(reasonOf(input({hasExclusions: false, basis: {income: {...INCOME, '2026-09': 101}, exact: true}, exclusionsProof: null})), 'bases');
  assert.equal(reasonOf(input({hasExclusions: false, projection: projectionOf({income: {'2026-08': 100, '2026-10': 100}}), exclusionsProof: null})), 'bases');
  assert.equal(reasonOf(input({hasExclusions: false, exclusionsProof: null})), 'provada', 'a base confirmada pelo servidor, sem desconsiderada');
  // 4. Leitura por id depois da versão atual de cada mês com desconsiderada (frescor, não a prova).
  assert.equal(reasonOf(input({excludedStartedOrder: null})), 'loading');
  assert.equal(reasonOf(input({projection: projectionOf({seen: {'2026-08': 1, '2026-09': 1, '2026-10': 5}})})), 'exclusions_read', 'mesma ordem');
  assert.equal(reasonOf(input({projection: projectionOf({seen: {'2026-08': 1, '2026-09': 1, '2026-10': 9}})})), 'exclusions_read');
  assert.equal(reasonOf(input({projection: projectionOf({seen: {'2026-08': 9, '2026-09': 9, '2026-10': 1}})})), 'provada',
    'só os meses com desconsiderada');
  assert.equal(reasonOf(input({excludedMonths: ['2026-07'], projection: projectionOf({seen: {'2026-08': 9, '2026-09': 9, '2026-10': 9}})})), 'provada',
    'desconsiderada fora da janela');
  // 5. As marcas de aplicação (P5-F.1-R3): a prova da leitura em uso decide; sem ela, nada converte.
  assert.equal(reasonOf(input({exclusionsProof: null})), 'loading', 'leitura sem a prova das marcas ainda');
  assert.equal(reasonOf(input({exclusionsProof: refused('content')})), 'projection_marks');
});

test('prova (regra 5, marcas): prova nula espera, prova recusada é "projection_marks" por qualquer motivo, provada aprova, e as regras 1 a 4 vêm antes', () => {
  const reasons = ['generation', 'bases', 'mark_pending', 'mark_broken', 'content'] as const;
  assert.equal(reasonOf(input({exclusionsProof: null})), 'loading');
  for (const reason of reasons) assert.equal(reasonOf(input({exclusionsProof: refused(reason)})), 'projection_marks', reason);
  assert.equal(reasonOf(input({exclusionsProof: PROVEN})), 'provada');
  // Sem desconsideradas, a prova das marcas não é consultada (nem a recusada nem a nula decidem); a projeção, sim.
  assert.equal(reasonOf(input({hasExclusions: false, exclusionsProof: refused('content')})), 'provada');
  assert.equal(reasonOf(input({hasExclusions: false, exclusionsProof: null})), 'provada');
  assert.equal(reasonOf(input({hasExclusions: false, projection: null, exclusionsProof: refused('content')})), 'projection');
  // Mesmo com a prova das marcas recusada, o motivo é o da primeira regra anterior que falha (a ordem 1, 2, 3, 4, 5).
  const bad = refused('mark_broken');
  assert.equal(reasonOf(input({basis: null, exclusionsProof: bad})), 'loading', 'regra 1');
  assert.equal(reasonOf(input({projection: null, exclusionsProof: bad})), 'projection', 'regra 2');
  assert.equal(reasonOf(input({basis: {income: {...INCOME, '2026-09': 101}, exact: true}, exclusionsProof: bad})), 'bases', 'regra 3');
  assert.equal(reasonOf(input({excludedStartedOrder: null, exclusionsProof: bad})), 'loading', 'regra 4: sem leitura');
  assert.equal(reasonOf(input({projection: projectionOf({seen: {'2026-08': 1, '2026-09': 1, '2026-10': 9}}), exclusionsProof: bad})), 'exclusions_read', 'regra 4');
  // Com a prova das marcas válida, as regras 1 a 4 continuam valendo sozinhas.
  assert.equal(reasonOf(input({projection: null})), 'projection');
  assert.equal(reasonOf(input({projection: projectionOf({seen: {'2026-08': 1, '2026-09': 1, '2026-10': 9}})})), 'exclusions_read');
});

test('prova (regra 5, marcas): só o resultado da prova das marcas decide; escrita, hora ou prazo não aprovam nem seguram', () => {
  // A entrada não tem mais escritas pendentes, espera limitada nem relógio (a presunção temporal foi removida): campos
  // desse tipo, mesmo que alguém os passe, não mudam o resultado.
  const legacy = {
    pendingWrites: [{id: 'r1', month: '2026-10', at: at(99), bounded: true}],
    expired: new Set(['r1|2026-10|99.0']),
    now: Number.MAX_SAFE_INTEGER,
  } as unknown as Partial<ConsistencyInput>;
  assert.equal(reasonOf(input({...legacy, exclusionsProof: refused('content')})), 'projection_marks', 'prazo vencido não aprova');
  assert.equal(reasonOf(input({...legacy, exclusionsProof: PROVEN})), 'provada', 'escrita conhecida não segura uma prova válida');
  // As entradas da prova (P5-F.1-R3.2): sem `multipleBases`, que só servia à leitura única; a quantidade de bases não
  // muda a exigência da projeção confirmada.
  assert.deepEqual(Object.keys(input()).sort(), [
    'basis', 'excludedMonths', 'excludedStartedOrder', 'exclusionsProof', 'hasExclusions', 'months', 'projection',
  ], 'as entradas da prova');
  const extra = {...input({hasExclusions: false, projection: null, exclusionsProof: null}), multipleBases: false} as unknown as ConsistencyInput;
  assert.equal(reasonOf(extra), 'projection', 'um campo antigo de "base única" não dispensa a projeção');
  // Com a prova real das marcas (`proveProjectionExclusions`), no mesmo instante: o conteúdo lido é o aplicado.
  const month = (incomeCents: number): SnapshotMonth => ({exists: true, incomeCents, generation: {id: 'g0', cutoff: null}});
  const snapshotOf = (fp: string) => ({
    months: {'2026-08': month(100), '2026-09': month(100), '2026-10': month(100)},
    marks: {r1: {chains: {a: {g: 'g0', cut: null, root: 'absent', base: null, node: {k: 'alive', fp}, pending: [], broken: null}}}},
  });
  const proofOf = (fp: string, readFp: string) => proveProjectionExclusions({
    months: MONTHS, snapshot: snapshotOf(fp), basisIncome: INCOME, excludedIds: ['r1'],
    read: {r1: {document: {id: 'r1', valueCents: 5_000}, fingerprint: readFp}}, reversalIds: {},
  });
  assert.equal(reasonOf(input({exclusionsProof: proofOf('fp-a', 'fp-a')})), 'provada', 'a mesma impressão digital');
  assert.equal(reasonOf(input({exclusionsProof: proofOf('fp-a', 'fp-b')})), 'projection_marks', 'outro conteúdo: sem prova');
});

// ------------------------------------------------------------------ estimativa inteira com o Firestore em memória

type Done = Extract<IncomeEstimateState, {status: 'done'}>;
type Failed = Extract<IncomeEstimateState, {status: 'error'}>;

interface Listener {
  ws: string;
  first: string;
  last: string;
  onNext: (snapshot: PeriodsSnapshot) => void;
  onError: () => void;
}

/**
 * O Firestore e as callables em memória. As leituras das bases e por id leem o estado no começo e respondem
 * depois da latência; a escuta entrega o retorno inicial do servidor sozinha e, depois, cada `publish` (o
 * gatilho gravou a projeção).
 */
const world = () => {
  let clock = 100;
  const tick = () => { clock += 1; return clock; };
  const versions = new Map<string, {income: number; version: number}>();
  const listeners = new Set<Listener>();
  const docs = new Map<string, Record<string, unknown>>();
  /** O conteúdo de cada lançamento que o gatilho já aplicou à projeção (a marca de aplicação), por `ws:id`. */
  const applied = new Map<string, Record<string, unknown> | 'deleted'>();
  const w = {
    income: {} as Record<string, Record<string, number>>,
    delays: {series: 2, month: 2, byIds: 10, marks: 5, listen: 1},
    autoListen: true,
    /** A escuta é encerrada por erro logo depois de abrir. */
    listenRefused: false,
    /**
     * `generatedAt` das bases na hora do servidor deste mundo (ISO, como o das Functions). Fora disso, um rótulo
     * sem hora. Nenhuma hora (a do servidor ou a do relógio) aprova a conversão: só as marcas (P5-F.1-R3).
     */
    serverClock: false,
    /** O tempo do servidor passa (segundos), sem nenhuma escrita. */
    advance: (seconds: number) => { clock += seconds; },
    failing: {month: false, byIds: false, marks: false},
    /**
     * Sem conexão (P5-F.1-R3.2): as leituras do servidor falham e a escuta, como o SDK com `includeMetadataChanges`,
     * entrega só retornos do cache local (`fromCache`), sem confirmação do servidor. `goOffline`/`goOnline` mudam com
     * a escuta aberta.
     */
    offline: false,
    /** Anomalia no servidor: a receita que as leituras das bases trazem, por workspace e mês, somada a isto (a projeção não). */
    basisSkew: {} as Record<string, Record<string, number>>,
    /** O status do bloco da série (`exact` por padrão; outro, como na reconstrução pendente, deixa a estimativa indisponível). */
    seriesStatus: 'exact',
    /** O tipo do espaço-fonte que o relatório traz (`PJ`: a receita empresarial precisa de confirmação). */
    workspaceType: 'PF' as 'PF' | 'PJ',
    calls: {series: 0, month: 0, byIds: 0, marks: 0, opened: 0},
    /** Marcas com evento fora de ordem esperando o anterior (`ws:id`), e marcas quebradas. */
    pendingMarks: new Set<string>(),
    brokenMarks: new Set<string>(),
    log: [] as string[],
    /**
     * Grava um lançamento: `createdAt` na primeira escrita e `updatedAt` em todas, na hora do servidor. Como no
     * Firestore, o documento guardado não tem o `id` (fica no caminho): a leitura por id devolve o normalizado com
     * o `id` e, à parte, o bruto; a marca e a prova usam a impressão do bruto, como o gatilho (P5-F.1-R3).
     */
    write: (ws: string, id: string, data: Record<string, unknown>) => {
      const key = `${ws}:${id}`;
      const now = at(tick());
      docs.set(key, {...data, createdAt: docs.get(key)?.createdAt ?? now, updatedAt: now});
    },
    /** Anula um lançamento (o documento guarda o valor e o estado de antes). */
    voidDoc: (ws: string, id: string) => {
      const key = `${ws}:${id}`;
      const now = at(tick());
      docs.set(key, {...docs.get(key), voidedAt: now, updatedAt: now});
    },
    /**
     * INV-M: o gatilho aplicou o conteúdo atual de cada lançamento à projeção. A marca muda no MESMO passo
     * síncrono em que `w.income` passa a refletir o estado dele; chame junto com a alteração de `w.income`.
     */
    apply: (ws: string, ids: readonly string[]) => {
      for (const id of ids) {
        const doc = docs.get(`${ws}:${id}`);
        applied.set(`${ws}:${id}`, doc === undefined ? 'deleted' : structuredClone(doc));
      }
    },
    publish: (ws = 'ws-a') => {
      for (const listener of [...listeners]) if (listener.ws === ws) deliver(listener);
    },
    /** O gatilho já gravou a projeção de cada mês com a receita atual (fixa a versão agora, sem entregar). */
    stamp: (ws = 'ws-a') => { snapshot(ws, '0000-00', '9999-99'); },
    failListen: () => act(() => {
      for (const listener of [...listeners]) {
        listeners.delete(listener);
        listener.onError();
      }
    }),
    /** A conexão cai com a escuta aberta: o SDK entrega o retorno do cache local a cada escuta, e as leituras falham. */
    goOffline: () => {
      w.offline = true;
      for (const listener of [...listeners]) deliver(listener, true);
    },
    /**
     * A conexão volta: cada escuta recebe o retorno do servidor, e as leituras voltam a responder. As mudanças são
     * contadas como o SDK conta as `docChanges` do retorno, contra o último que a escuta recebeu: nenhuma quando nada
     * mudou sem conexão (P5-F.1-R3.2, ADV-02; as outras entregas seguem contando todos os documentos).
     */
    goOnline: () => {
      w.offline = false;
      for (const listener of [...listeners]) deliver(listener, false, true);
    },
    /** As mudanças contadas no último retorno entregue a uma escuta. */
    lastChanges: null as number | null,
    deps: null as unknown as IncomeEstimateDeps,
  };
  const income = (ws: string) => {
    const read = {...(w.income[ws] ?? {})};
    for (const [month, skew] of Object.entries(w.basisSkew[ws] ?? {})) read[month] = (read[month] ?? 0) + skew;
    return read;
  };
  const snapshot = (ws: string, first: string, last: string, fromCache = false): PeriodsSnapshot => {
    const documents = Object.entries(w.income[ws] ?? {})
      .filter(([month]) => month >= first && month <= last)
      .map(([month, incomeCents]) => {
        const key = `${ws}:${month}`;
        const known = versions.get(key);
        // Retorno só do cache local (P5-F.1-R3.2): a versão já conhecida, sem fixar versão nova.
        if (fromCache) return {id: month, incomeCents: known?.income ?? incomeCents, updatedAt: at(known?.version ?? 0)};
        const version = known !== undefined && known.income === incomeCents ? known.version : tick();
        versions.set(key, {income: incomeCents, version});
        return {id: month, incomeCents, updatedAt: at(version)};
      });
    // O retorno do cache local não traz confirmação do servidor nem conta mudanças.
    return {documents, fromCache, changes: fromCache ? 0 : documents.length};
  };
  /** O que cada escuta recebeu por último (documento a documento), para contar as mudanças como o SDK (ADV-02). */
  const lastDelivered = new WeakMap<Listener, Map<string, string>>();
  const deliver = (listener: Listener, fromCache = false, countChanges = false) => {
    if (!listeners.has(listener)) return;
    w.log.push(fromCache ? 'projeção do cache' : 'projeção');
    const base = snapshot(listener.ws, listener.first, listener.last, fromCache);
    const now = new Map(base.documents.map((document) => [document.id, JSON.stringify(document)]));
    const previous = lastDelivered.get(listener);
    lastDelivered.set(listener, now);
    let changes = base.changes;
    if (countChanges) {
      changes = 0;
      for (const [id, value] of now) if (previous?.get(id) !== value) changes += 1;
      for (const id of previous?.keys() ?? []) if (!now.has(id)) changes += 1;
    }
    w.lastChanges = changes;
    act(() => listener.onNext({...base, changes}));
  };
  w.deps = {
    basis: {
      fetchReport: async (payload) => {
        const read = income(payload.workspaceId);
        if (payload.range.kind === 'month') {
          const month = payload.range.month;
          w.calls.month += 1;
          w.log.push('mês avulso');
          await wait(w.delays.month);
          if (w.failing.month || w.offline) throw new Error('Não foi possível carregar o relatório. Tente novamente.');
          return {
            referenceDate: REFERENCE, workspaceType: w.workspaceType, generatedAt: w.serverClock ? new Date(clock * 1000).toISOString() : `m-${w.calls.month}`, period: {range: payload.range},
            cash: {status: 'exact', data: {receiptsCents: read[month] ?? 0}},
          } as unknown as FinancialReport;
        }
        w.calls.series += 1;
        w.log.push('série');
        await wait(w.delays.series);
        if (w.offline) throw new Error('Não foi possível carregar o relatório. Tente novamente.');
        const points = Object.entries(read).filter(([month]) => month >= '2025-12').sort(([a], [b]) => a.localeCompare(b))
          .map(([month, receiptsCents]) => ({month, receiptsCents, partial: month === '2026-11'}));
        return {
          referenceDate: REFERENCE, workspaceType: w.workspaceType, generatedAt: w.serverClock ? new Date(clock * 1000).toISOString() : `s-${w.calls.series}`, series: {status: w.seriesStatus, data: {points}},
        } as unknown as FinancialReport;
      },
      subscribePeriods: (ws, first, last, onNext, onError) => {
        const listener: Listener = {ws, first, last, onNext, onError};
        listeners.add(listener);
        w.calls.opened += 1;
        if (w.listenRefused) {
          setTimeout(() => { if (listeners.delete(listener)) act(() => onError()); }, w.delays.listen);
        } else if (w.offline) {
          // Sem conexão, o SDK só entrega o retorno do cache local.
          setTimeout(() => deliver(listener, true), w.delays.listen);
        } else if (w.autoListen) {
          setTimeout(() => deliver(listener), w.delays.listen);
        }
        return () => { listeners.delete(listener); };
      },
      refresh: {options: {coalesceMs: 30, burst: 100, refillMs: 60_000}, mutationOptions: {coalesceMs: 30, burst: 100, refillMs: 60_000}},
    } satisfies BasisSyncDeps,
    // O tempo de interface (30 s no produto), curto aqui: depois dele, "calculando" sem prova vira "estimativa em
    // atualização". Nunca é prazo que aprove a conversão (P5-F.1-R3).
    pendingWaitMs: 800,
    readByIds: async (ws, ids) => {
      w.calls.byIds += 1;
      w.log.push('exclusões');
      if (w.offline) { await wait(w.delays.byIds); throw new Error('falha de rede'); }
      const found: object[] = [];
      const missing: string[] = [];
      const raw: Record<string, object> = {};
      for (const id of ids) {
        const doc = docs.get(`${ws}:${id}`);
        if (doc) {
          found.push({...structuredClone(doc), id});
          raw[id] = structuredClone(doc);
        } else missing.push(id);
      }
      await wait(w.delays.byIds);
      if (w.failing.byIds) throw new Error('falha de rede');
      return {found, missing, raw};
    },
    // A transação só de leitura: os meses da janela e as marcas, no mesmo instante (o estado de quando começa).
    readProjectionMarks: async (ws, months, ids) => {
      w.calls.marks += 1;
      w.log.push('marcas');
      if (w.offline) { await wait(w.delays.marks); throw new Error('falha de rede'); }
      const monthsRead: Record<string, SnapshotMonth> = {};
      for (const month of months) {
        const cents = w.income[ws]?.[month];
        monthsRead[month] = cents === undefined
          ? {exists: false, incomeCents: Number.NaN, generation: null}
          : {exists: true, incomeCents: cents, generation: {id: 'g0', cutoff: null}};
      }
      const contents = new Map(ids.map((id) => {
        const content = applied.get(`${ws}:${id}`);
        return [id, content === undefined || content === 'deleted' ? content : structuredClone(content)] as const;
      }));
      const marks: Record<string, unknown> = {};
      for (const id of ids) {
        const key = `${ws}:${id}`;
        const content = contents.get(id);
        if (content === undefined && !w.pendingMarks.has(key) && !w.brokenMarks.has(key)) {
          marks[id] = null;
          continue;
        }
        const node = content === undefined ? {k: 'absent'} : content === 'deleted' ? {k: 'deleted'} : {k: 'alive', fp: await transactionFingerprint(content)};
        marks[id] = {chains: {a: {
          g: 'g0', cut: null, root: 'absent', base: null, node,
          pending: w.pendingMarks.has(key) ? [{b: {k: 'alive', fp: 'conteudo-que-ainda-nao-chegou'}, a: {k: 'alive', fp: 'conteudo-seguinte'}}] : [],
          broken: w.brokenMarks.has(key) ? 'invalid_chain' : null,
        }}};
      }
      await wait(w.delays.marks);
      if (w.failing.marks) throw new Error('falha de rede');
      return {months: monthsRead, marks};
    },
  };
  return w;
};
type World = ReturnType<typeof world>;

/** Agosto e setembro com R$ 3.520,00, outubro com R$ 4.020,00 e, nele, a receita r500 (R$ 500,00). */
const standard = (w: World) => {
  w.income['ws-a'] = {'2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000, '2026-11': 100_000};
  w.write('ws-a', 'r500', {date: '2026-10-15', type: 'receita', valueCents: 50_000, isPaid: true});
  w.apply('ws-a', ['r500']);
};
/** Novembro de 2025 a outubro de 2026 com R$ 3.000,00 por mês (novembro de 2025 vem à parte na janela de 12 meses). */
const twelve = (w: World) => {
  const income: Record<string, number> = {};
  for (let index = 0; index < 12; index += 1) {
    const date = new Date(Date.UTC(2025, 10 + index, 1));
    income[`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`] = 300_000;
  }
  income['2026-11'] = 100_000;
  w.income['ws-a'] = income;
};

const params = (patch: Partial<IncomeEstimateParams> = {}): IncomeEstimateParams => ({
  workspaceId: 'ws-a', mode: 'habitual', historyMonths: 3, allowBusinessIncome: false, calendar: OFFICE,
  excludedIds: ['r500'], enabled: true, ...patch,
});

let renderer: ReactTestRenderer | null = null;
/** Montagens a mais do mesmo teste (a prévia ao lado do provedor, a remontagem com o cache aquecido; P5-F.1-R3.2). */
const extraRenderers: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => renderer?.unmount());
  renderer = null;
  for (const extra of extraRenderers.splice(0)) act(() => extra.unmount());
  clearBasisRegistry();
});

interface Render {
  uid: string;
  params: IncomeEstimateParams;
  state: IncomeEstimateState;
}

/**
 * A estimativa montada, com as entradas e a conta trocáveis; cada renderização fica registrada. Com `client`, usa o
 * cache do React Query de outra montagem (o cache aquecido da tela que volta ou da prévia ao lado; P5-F.1-R3.2).
 */
const mount = (w: World, initial: IncomeEstimateParams, options: {client?: QueryClient} = {}) => {
  const client = options.client ?? new QueryClient({defaultOptions: {queries: {retryDelay: 1, refetchOnWindowFocus: false}}});
  const renders: Render[] = [];
  const setters: {params: ((value: IncomeEstimateParams) => void) | null; uid: ((value: string) => void) | null} = {params: null, uid: null};
  const Estimate = () => {
    const [estimateParams, setParams] = useState(initial);
    const [uid, setUid] = useState('u1');
    setters.params = setParams;
    setters.uid = setUid;
    renders.push({uid, params: estimateParams, state: useIncomeEstimateWith(w.deps, uid, estimateParams)});
    return null;
  };
  let created: ReactTestRenderer | null = null;
  act(() => { created = TestRenderer.create(createElement(QueryClientProvider, {client}, createElement(Estimate))); });
  if (renderer === null) renderer = created;
  else extraRenderers.push(created as unknown as ReactTestRenderer);
  shownSoFar = () => renders.map((render) => render.state.status === 'done' ? String(incomeOf(render.state)) : render.state.status)
    .filter((value, index, all) => index === 0 || all[index - 1] !== value).join(' → ');
  return {
    client,
    renders,
    latest: () => renders[renders.length - 1]?.state,
    setParams: (value: IncomeEstimateParams) => act(() => setters.params?.(value)),
    setUid: (value: string) => act(() => setters.uid?.(value)),
    /** Desmonta esta montagem (a tela que sai); o cache do React Query fica no `client`. */
    unmount: () => act(() => (created as unknown as ReactTestRenderer).unmount()),
  };
};

const readyOf = (state: IncomeEstimateState | undefined) =>
  state?.status === 'done' && state.estimate.status === 'ready' ? (state.estimate as Extract<WorkTimeEstimate, {status: 'ready'}>) : null;
const incomeOf = (state: IncomeEstimateState | undefined) => readyOf(state)?.incomeCents ?? null;
const ignored = (state: IncomeEstimateState | undefined) => readyOf(state)?.notes.some((note) => note.kind === 'exclusions_ignored') === true;
const monthOf = (state: IncomeEstimateState | undefined, month: string) => readyOf(state)?.months.find((entry) => entry.month === month)?.receiptsCents;

/** Toda estimativa pronta mostrada nas renderizações tem um dos valores dos estados consistentes. */
const assertOnly = (renders: readonly Render[], allowed: readonly number[], message: string) => {
  const shown = [...new Set(renders.map((render) => incomeOf(render.state)).filter((cents): cents is number => cents !== null))];
  assert.deepEqual(shown.filter((cents) => !allowed.includes(cents)), [], `${message} (mostrados: ${shownSoFar()})`);
};
/** Fora as estimativas permitidas, só "calculando". */
const assertLoadingOr = (renders: readonly Render[], allowed: readonly number[], message: string) => {
  const other = renders.filter((render) => render.state.status !== 'loading' && !allowed.includes(incomeOf(render.state) ?? -1));
  assert.deepEqual(other.map((render) => render.state.status), [], `${message} (mostrados: ${shownSoFar()})`);
};

for (const order of ['a escuta antes das bases', 'a escuta depois das bases', 'a escuta só quando o servidor responde'] as const) {
  test(`B03: a primeira estimativa só aparece provada pela projeção, com a leitura por id depois dela (${order})`, async () => {
    const w = world();
    standard(w);
    if (order === 'a escuta depois das bases') w.delays.listen = 40;
    if (order === 'a escuta só quando o servidor responde') w.autoListen = false;
    const {renders, latest} = mount(w, params());
    if (order === 'a escuta só quando o servidor responde') {
      await until(() => w.calls.series === 1, 'série lida');
      await settle(60);
      assert.equal(w.calls.byIds, 0, 'sem a projeção, a leitura por id nem começa');
      assert.equal(latest()?.status, 'loading');
      w.publish();
    }
    await until(() => incomeOf(latest()) !== null, 'estimativa');
    await settle(60);
    assert.equal(incomeOf(latest()), 1_056_000);
    assertLoadingOr(renders, [1_056_000], 'só "calculando" e a estimativa provada (R10-02)');
    assert.ok(w.log.indexOf('projeção') < w.log.indexOf('exclusões'), `a leitura por id depois da projeção: ${w.log.join(', ')}`);
    assert.equal(w.calls.byIds, 1, 'uma leitura por id');
  });
}

test('B03: a projeção mais nova que a base lida na montagem: nunca a estimativa da base antiga; a base é relida e a nova aparece provada', async () => {
  const w = world();
  standard(w);
  w.delays.listen = 40;
  const {renders, latest} = mount(w, params());
  await until(() => w.calls.series === 1, 'série lida');
  // Outra sessão lança R$ 500,00 em outubro depois da leitura da série; o gatilho grava a projeção.
  w.income['ws-a']['2026-10'] = 452_000;
  await until(() => incomeOf(latest()) === 1_106_000, 'a estimativa da base relida');
  await settle(80);
  assertLoadingOr(renders, [1_106_000], 'nunca R$ 10.560,00 (a base antiga, que a projeção não confirma)');
  assert.equal(w.calls.series, 2, 'a base relida uma vez');
});

// P5-F.1-R3.2 (RR-R31-05): até a R3.1, este cenário mostrava a estimativa convertida "com a ressalva" (a leitura única
// era provada sem a escuta). Agora a base sem confirmação do servidor não converte, como na janela de 12 meses.
test('B03 (R3.2): uma base e nenhuma desconsiderada com a escuta encerrada desde o começo: nenhuma conversão, o erro com "Tentar de novo"; com a escuta de volta, a estimativa provada', async () => {
  const w = world();
  standard(w);
  w.listenRefused = true;
  const {renders, latest} = mount(w, params({excludedIds: []}));
  await until(() => latest()?.status === 'error' && w.calls.series >= 1, 'erro');
  await settle(60);
  const failed = latest() as Failed;
  assert.equal(failed.message, ESTIMATE_UNCONFIRMED_FAILED);
  assertNoConversion(renders, 'nenhuma estimativa sem a confirmação do servidor, nem com a ressalva');
  w.listenRefused = false;
  act(() => failed.retry());
  await until(() => incomeOf(latest()) === 1_106_000 && !(latest() as Done).refreshFailed, 'estimativa provada');
  assertOnlyWithoutConversionOr(renders, [ESTIMATE_UNCONFIRMED_FAILED], [1_106_000], 'só o erro, "calculando" e a estimativa provada');
});

test('B03: janela de 12 meses com a escuta encerrada desde o começo: sem prova, o erro com "Tentar de novo"; com a escuta de volta, a estimativa provada', async () => {
  const w = world();
  twelve(w);
  w.listenRefused = true;
  const {renders, latest} = mount(w, params({excludedIds: [], historyMonths: 12}));
  await until(() => latest()?.status === 'error', 'erro');
  const failed = latest() as Failed;
  assert.equal(failed.message, ESTIMATE_UNCONFIRMED_FAILED);
  assert.ok(renders.every((render) => incomeOf(render.state) === null), 'nenhuma estimativa sem prova');
  w.listenRefused = false;
  act(() => failed.retry());
  await until(() => incomeOf(latest()) === 3_600_000 && !(latest() as Done).refreshFailed, 'estimativa provada');
  assertOnly(renders, [3_600_000], 'só a estimativa provada');
});

test('B03 (R8-02): a desconsiderada do 12º mês anulada em outra sessão e a troca para 12 meses: o mês avulso novo nunca aparece com a exclusão antiga', async () => {
  const w = world();
  twelve(w);
  w.write('ws-a', 'r500', {date: '2025-11-15', type: 'receita', valueCents: 50_000, isPaid: true});
  w.apply('ws-a', ['r500']);
  const {renders, latest, setParams} = mount(w, params());
  await until(() => incomeOf(latest()) === 900_000, '3 meses, com a desconsiderada fora da janela');
  await settle(60);
  // Outra sessão a anula; o gatilho grava novembro de 2025 sem ela (a escuta de 3 meses não escuta esse mês).
  w.voidDoc('ws-a', 'r500');
  w.income['ws-a']['2025-11'] = 250_000;
  w.apply('ws-a', ['r500']);
  const from = renders.length;
  setParams(params({historyMonths: 12}));
  await until(() => incomeOf(latest()) === 3_550_000 && ignored(latest()), '12 meses com a anulação');
  await settle(80);
  assertLoadingOr(renders.slice(from), [3_550_000], 'nunca R$ 35.000,00 (o mês avulso novo menos a exclusão anulada)');
  assert.equal(w.calls.byIds, 2, 'a leitura por id relida depois da projeção do mês avulso');
});

test('B03 (R11-01): o mês avulso sai da janela com a leitura em curso e volta desatualizado: a base antiga não aparece, e é relida', async () => {
  const w = world();
  twelve(w);
  w.write('ws-a', 'r500', {date: '2026-10-15', type: 'receita', valueCents: 50_000, isPaid: true});
  w.apply('ws-a', ['r500']);
  const twelveParams = params({historyMonths: 12});
  const {renders, latest, setParams} = mount(w, twelveParams);
  await until(() => incomeOf(latest()) === 3_550_000, '12 meses');
  await settle(60);
  // Outra sessão muda novembro de 2025 para R$ 2.800,00: a escuta pede a releitura das bases; o mês avulso lê devagar.
  w.delays.month = 150;
  w.income['ws-a']['2025-11'] = 280_000;
  w.publish();
  await until(() => w.calls.month === 2, 'mês avulso em releitura');
  // Com a leitura em curso, a pessoa passa a 6 meses; durante ela, outra mudança: R$ 2.600,00.
  const six = renders.length;
  setParams(params({historyMonths: 6}));
  w.income['ws-a']['2025-11'] = 260_000;
  w.publish();
  await settle(200);
  assertLoadingOr(renders.slice(six), [1_750_000], '6 meses');
  // A pessoa volta a 12 meses: a base do mês avulso volta com R$ 2.800,00, e a escuta confirma R$ 2.600,00.
  w.delays.month = 2;
  const back = renders.length;
  setParams(twelveParams);
  await until(() => incomeOf(latest()) === 3_510_000, '12 meses com a base relida');
  await settle(100);
  assertLoadingOr(renders.slice(back), [3_510_000], 'nunca R$ 35.300,00 (o mês avulso desatualizado)');
});

test('B03 (R11-02): 12 meses sem desconsiderada, as bases relidas sem pedido da escuta (a virada do mês) e o mês avulso falhando: nenhuma renderização mostra só a série nova', async () => {
  const w = world();
  twelve(w);
  const {client, renders, latest} = mount(w, params({excludedIds: [], historyMonths: 12}));
  await until(() => incomeOf(latest()) === 3_600_000, '12 meses');
  await settle(60);
  const from = renders.length;
  // R$ 500,00 passam de novembro de 2025 para outubro de 2026; a escuta ainda não entregou a projeção.
  w.failing.month = true;
  w.income['ws-a']['2026-10'] = 350_000;
  w.income['ws-a']['2025-11'] = 250_000;
  // A virada do mês relê as duas bases, sem pedido da escuta: a série chega nova, e o mês avulso falha. A série nova não
  // bate com a projeção confirmada (ainda a anterior): sem prova, nenhuma conversão, e o erro do mês avulso com
  // "Tentar de novo" (P5-F.1-R3.1; antes, a última provada com a ressalva).
  await act(async () => { await invalidateFinancialReportBases(client); });
  await until(() => w.calls.series >= 2 && w.calls.month >= 3 && latest()?.status === 'error',
    'a série nova e a falha do mês avulso: o erro, sem conversão');
  const failedAt = renders.length - 1;
  await settle(250);
  assert.equal((latest() as Failed).message, 'Não foi possível carregar o relatório. Tente novamente.', 'o erro da leitura, com "Tentar de novo"');
  assertNoConversion(renders.slice(failedAt), 'com o mês avulso falhando e a série nova sem prova');
  assertOnly(renders.slice(from), [3_600_000], 'nunca R$ 36.500,00 (out/2026 nova com nov/2025 antiga)');
  // O mês avulso volta e a escuta entrega a projeção: as duas bases novas aparecem juntas, provadas.
  w.failing.month = false;
  w.publish();
  await until(() => monthOf(latest(), '2026-10') === 350_000 && monthOf(latest(), '2025-11') === 250_000, 'as duas bases novas provadas');
  await settle(60);
  assertOnly(renders.slice(from), [3_600_000], 'o mesmo total antes e depois');
  const mixed = renders.slice(from).filter((render) => incomeOf(render.state) !== null &&
    (monthOf(render.state, '2026-10') === 350_000) !== (monthOf(render.state, '2025-11') === 250_000));
  assert.deepEqual(mixed.length, 0, 'nenhuma renderização com só uma das bases novas');
});

test('B03: o calendário trocado durante a sincronização de uma anulação em outra sessão: nunca a base nova com a leitura por id antiga', async () => {
  const w = world();
  standard(w);
  const {renders, latest, setParams} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'estimativa');
  await settle(60);
  const before = readyOf(latest())?.workMinutes ?? 0;
  // Outra sessão anula a desconsiderada; o gatilho grava outubro sem ela. A base é relida e a leitura por id, devagar.
  w.delays.byIds = 150;
  w.voidDoc('ws-a', 'r500');
  w.income['ws-a']['2026-10'] = 352_000;
  w.apply('ws-a', ['r500']);
  w.publish();
  await until(() => w.calls.series === 2 && w.calls.byIds === 2, 'a base nova e a leitura por id em releitura');
  // Com a leitura por id em curso, a pessoa trabalha no feriado de 12 de outubro: outubro ganha um dia.
  const from = renders.length;
  setParams(params({calendar: {...OFFICE, worksOnHolidays: true}}));
  await until(() => ignored(latest()) && (readyOf(latest())?.workMinutes ?? 0) > before, 'a anulação provada, com o calendário novo');
  await settle(200);
  // Agosto, setembro e outubro sem a receita anulada: R$ 10.560,00. Nunca R$ 10.060,00 (descontada duas vezes).
  assertLoadingOr(renders.slice(from), [1_056_000], 'só "calculando" e a estimativa provada das entradas novas');
  const after = renders.slice(from).map((render) => readyOf(render.state)).filter((estimate) => estimate !== null);
  assert.deepEqual([...new Set(after.map((estimate) => estimate.workMinutes))], [readyOf(latest())?.workMinutes], 'só o calendário novo depois da troca');
  assert.ok(after.every((estimate) => estimate.notes.some((note) => note.kind === 'exclusions_ignored')), 'só a leitura por id nova');
});

test('B03: troca do workspace da renda: a estimativa do anterior nunca aparece; só "calculando" até a do novo estar provada', async () => {
  const w = world();
  standard(w);
  w.income['ws-b'] = {'2026-08': 200_000, '2026-09': 200_000, '2026-10': 200_000, '2026-11': 50_000};
  w.write('ws-b', 'r500', {date: '2026-10-20', type: 'receita', valueCents: 20_000, isPaid: true});
  w.apply('ws-b', ['r500']);
  const {renders, latest, setParams} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'ws-a');
  await settle(60);
  w.delays.listen = 40;
  const from = renders.length;
  setParams(params({workspaceId: 'ws-b'}));
  await until(() => incomeOf(latest()) === 580_000, 'ws-b');
  await settle(60);
  assertLoadingOr(renders.slice(from), [580_000], 'nunca a renda do workspace anterior');
});

test('B03: troca de conta: a estimativa da conta anterior não é reaproveitada', async () => {
  const w = world();
  standard(w);
  const {renders, latest, setUid} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'u1');
  await settle(60);
  w.delays.series = 60;
  const from = renders.length;
  setUid('u2');
  await settle(30);
  assert.ok(renders.slice(from).every((render) => render.uid === 'u2' && render.state.status === 'loading'), 'sem a estimativa de u1');
  await until(() => incomeOf(latest()) === 1_056_000, 'u2');
  assertLoadingOr(renders.slice(from), [1_056_000], 'só a estimativa de u2, provada');
});

test('B03: nova receita e anulação da desconsiderada em outra sessão durante a releitura por id: nenhuma renderização desconta duas vezes', async () => {
  const w = world();
  standard(w);
  const {renders, latest} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'estimativa');
  await settle(60);
  const from = renders.length;
  // Outra sessão lança R$ 300,00 em setembro; a sincronização relê a base e, devagar, a leitura por id.
  w.delays.byIds = 150;
  w.income['ws-a']['2026-09'] = 382_000;
  w.publish();
  await until(() => w.calls.byIds === 2, 'leitura por id em releitura');
  // Durante ela, outra sessão anula a desconsiderada de outubro; o gatilho grava outubro sem ela.
  w.voidDoc('ws-a', 'r500');
  w.income['ws-a']['2026-10'] = 352_000;
  w.apply('ws-a', ['r500']);
  w.publish();
  w.delays.byIds = 10;
  await until(() => incomeOf(latest()) === 1_086_000 && ignored(latest()) && readyOf(latest())?.months[2]?.receiptsCents === 352_000, 'a anulação provada');
  await settle(150);
  // Consistentes: o começo, setembro novo com a desconsiderada descontada e, depois, a anulação ignorada
  // (R$ 10.860,00 nos dois). Nunca R$ 10.360,00 (descontada duas vezes) nem R$ 11.360,00 (a anulação antes da base).
  assertOnly(renders.slice(from), [1_056_000, 1_086_000], 'só estados consistentes');
  const shown = renders.slice(from).map((render) => readyOf(render.state)).filter((estimate) => estimate !== null);
  assert.deepEqual(shown.filter((estimate) => estimate.incomeCents === 1_086_000 && estimate.months[2]?.receiptsCents === 352_000 &&
    !estimate.notes.some((note) => note.kind === 'exclusions_ignored')), [], 'outubro sem a receita, nunca com a exclusão aplicada');
});

test('B03: a leitura por id falha antes da primeira estimativa: o erro com "Tentar de novo", nunca o total sem as exclusões', async () => {
  const w = world();
  standard(w);
  w.failing.byIds = true;
  const {renders, latest} = mount(w, params());
  await until(() => latest()?.status === 'error', 'erro');
  assert.equal((latest() as Failed).message, ESTIMATE_EXCLUDED_READ_FAILED);
  assert.ok(renders.every((render) => incomeOf(render.state) === null), 'nenhuma estimativa');
  w.failing.byIds = false;
  act(() => (latest() as Failed).retry());
  await until(() => incomeOf(latest()) === 1_056_000, 'estimativa');
  assertOnly(renders, [1_056_000], 'só a estimativa provada');
});

test('revisão pt-BR da R3 (M-01): sem desconsiderada, 12 meses e a escuta sem retorno do servidor: depois do tempo de interface, o texto de "em atualização" sem apontar causa, nunca a conversão; com o retorno, a estimativa provada', async () => {
  const w = world();
  const time = manualClock(w);
  twelve(w);
  w.autoListen = false;
  const {renders, latest} = mount(w, params({excludedIds: [], historyMonths: 12}));
  await until(() => w.calls.series >= 1 && w.calls.month >= 1, 'as bases lidas');
  await settle(50);
  assert.equal(latest()?.status, 'loading', 'antes do tempo de interface: "calculando"');
  time.advance(1_000);
  await settle(50);
  const updating = latest() as Failed;
  assert.deepEqual([updating.status, updating.message], ['error', ESTIMATE_UPDATING]);
  assert.doesNotMatch(updating.message, /desconsiderad/, 'sem desconsiderada, o texto não fala delas');
  assert.ok(noEstimate(renders), `nenhuma conversão sem prova (mostrados: ${shownSoFar()})`);
  w.publish();
  await until(() => incomeOf(latest()) === 3_600_000, 'a estimativa provada com o retorno da escuta');
  assertUpdatingOr(renders, [3_600_000], 'só "calculando", "em atualização" e a estimativa provada');
});

test('revisão pt-BR da R3 (L-03): a leitura das marcas falha: o erro fixo em pt-BR com "Tentar de novo", nunca a conversão; o "Tentar de novo" prova', async () => {
  const w = world();
  standard(w);
  w.failing.marks = true;
  const {renders, latest} = mount(w, params());
  await until(() => latest()?.status === 'error', 'erro');
  assert.equal((latest() as Failed).message, ESTIMATE_EXCLUDED_READ_FAILED);
  assert.ok(renders.every((render) => incomeOf(render.state) === null), 'nenhuma estimativa');
  w.failing.marks = false;
  act(() => (latest() as Failed).retry());
  await until(() => incomeOf(latest()) === 1_056_000, 'estimativa');
  assertOnly(renders, [1_056_000], 'só a estimativa provada');
});

// ------------------------------------------------------------------ revisão independente da R1 (N03, N05, N06)

test('revisão da R1 (N05): com desconsiderada, a escuta encerrada antes do primeiro retorno do servidor dá o erro com "Tentar de novo", nunca "calculando" para sempre', async () => {
  const w = world();
  standard(w);
  w.listenRefused = true;
  const {renders, latest} = mount(w, params());
  await until(() => latest()?.status === 'error', 'o erro');
  const failed = latest() as Failed;
  assert.equal(failed.message, ESTIMATE_UNCONFIRMED_FAILED);
  await settle(100);
  assert.equal(latest()?.status, 'error', 'o erro continua até o "Tentar de novo"');
  assert.equal(w.calls.byIds, 0, 'sem a projeção, a leitura por id nem começa');
  assert.ok(renders.every((render) => incomeOf(render.state) === null), 'nenhuma estimativa');
  // O "Tentar de novo" reabre a escuta; com o retorno do servidor, a leitura por id começa e a estimativa é provada.
  w.listenRefused = false;
  act(() => failed.retry());
  await until(() => incomeOf(latest()) === 1_056_000 && !(latest() as Done).refreshFailed, 'a estimativa provada');
  assertOnly(renders, [1_056_000], 'só a estimativa provada');
  assert.equal(w.calls.byIds, 1, 'uma leitura por id, depois da projeção');
});

test('revisão da R1 (N03): a desconsiderada editada em outra sessão antes do gatilho, na primeira leitura: nunca o valor novo com o total velho', async () => {
  const w = world();
  standard(w);
  w.stamp();
  // Outra sessão muda a desconsiderada de R$ 500,00 para R$ 800,00; o gatilho ainda não gravou outubro.
  w.write('ws-a', 'r500', {date: '2026-10-15', type: 'receita', valueCents: 80_000, isPaid: true});
  const {renders, latest} = mount(w, params());
  await until(() => w.calls.byIds === 1, 'a leitura por id');
  await settle(200);
  assert.ok(renders.every((render) => incomeOf(render.state) === null), `antes do gatilho, nenhuma estimativa (mostrados: ${shownSoFar()})`);
  // O gatilho aplica o valor novo: a receita de outubro e a marca mudam juntas.
  w.income['ws-a']['2026-10'] = 432_000;
  w.apply('ws-a', ['r500']);
  w.publish();
  await until(() => incomeOf(latest()) === 1_056_000, 'a estimativa provada');
  await settle(100);
  // Consistentes: R$ 10.560,00 (antes e depois da edição). Nunca R$ 10.260,00 (R$ 800,00 tirados do total velho).
  assertLoadingOr(renders, [1_056_000], 'só "calculando" e a estimativa provada');
});

// ------------------------------------------------------------------ P5-F.1-R3 (B03): as marcas de aplicação; nenhum prazo aprova

/**
 * Relógio dos agendadores e do tempo de interface que só anda quando o teste manda; as leituras e o React Query
 * seguem o relógio real. Instalado nas dependências da estimativa antes de montar.
 */
const manualClock = (w: World, options = {coalesceMs: 30, burst: 100, refillMs: 60_000}) => {
  let now = 0;
  let nextId = 0;
  const timers = new Map<number, {at: number; run: () => void}>();
  w.deps.basis.refresh = {
    clock: {
      now: () => now,
      setTimer: (run, ms) => { nextId += 1; timers.set(nextId, {at: now + ms, run}); return nextId; },
      clearTimer: (handle) => { timers.delete(handle as number); },
    },
    options,
    mutationOptions: options,
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
  return {now: () => now, advance};
};
type Time = ReturnType<typeof manualClock>;

/** Avança o relógio manual de 30 ms em 30 ms (a coalescência) até a condição, deixando as leituras terminarem. */
const drive = async (time: Time, condition: () => boolean, message: string, steps = 20) => {
  for (let step = 0; step < steps && !condition(); step += 1) {
    time.advance(30);
    await settle(40);
  }
  assert.ok(condition(), `${message} (mostrados: ${shownSoFar()})`);
};
/** Deixa passar muito tempo: o relógio manual e a hora do servidor, em passos de 30 s, com as leituras terminando. */
const elapse = async (w: World, time: Time, totalMs: number) => {
  for (let passed = 0; passed < totalMs; passed += 30_000) {
    time.advance(30_000);
    w.advance(30);
    await settle(30);
  }
};
/** Fora as estimativas permitidas, só "calculando" e "estimativa em atualização" (sem conversão). */
const assertUpdatingOr = (renders: readonly Render[], allowed: readonly number[], message: string) => {
  const other = renders.filter((render) => render.state.status !== 'loading' && !allowed.includes(incomeOf(render.state) ?? -1) &&
    !(render.state.status === 'error' && render.state.message === ESTIMATE_UPDATING));
  assert.deepEqual(other.map((render) => render.state.status), [], `${message} (mostrados: ${shownSoFar()})`);
};
const noEstimate = (renders: readonly Render[]) => renders.every((render) => incomeOf(render.state) === null);
const NEW_DESCRIPTION = 'Outra descrição';
/** Outra sessão muda só a descrição de r500: a receita não muda e o gatilho ainda não aplicou (a marca segue no conteúdo anterior). */
const editDescriptionBeforeTrigger = (w: World) =>
  w.write('ws-a', 'r500', {date: '2026-10-15', type: 'receita', valueCents: 50_000, isPaid: true, description: NEW_DESCRIPTION});

test('B03 (R3, ex-N03): a desconsiderada editada sem efeito na renda e o gatilho atrasado (marca velha): nenhuma conversão em tempo nenhum, só "estimativa em atualização"; com a marca aplicada, a estimativa certa aparece sem esperar prazo', async () => {
  const w = world();
  const time = manualClock(w);
  standard(w);
  w.stamp();
  editDescriptionBeforeTrigger(w);
  const {renders, latest} = mount(w, params());
  await until(() => w.calls.marks >= 1, 'a leitura das marcas');
  await settle(100);
  assert.ok(noEstimate(renders), `marca velha: nenhuma estimativa (mostrados: ${shownSoFar()})`);
  assert.equal(latest()?.status, 'loading', 'antes do tempo de interface: "calculando"');
  // Bem além do tempo de interface (800 ms aqui) e de qualquer prazo antes presumido (30 s): 10 min no relógio da
  // estimativa e mais de 1 h na hora do servidor. A marca velha continua sem prova, e o texto é o de "em atualização".
  await elapse(w, time, 600_000);
  w.advance(3_600);
  assert.ok(noEstimate(renders), `nem depois de qualquer tempo (mostrados: ${shownSoFar()})`);
  const updating = latest() as Failed;
  assert.deepEqual([updating.status, updating.message], ['error', ESTIMATE_UPDATING]);
  assert.equal(typeof updating.retry, 'function', 'com "Tentar de novo"');
  assert.ok(w.calls.byIds > 1, 'a leitura é refeita pelo agendador, mas nunca aprovada');
  // O gatilho aplica o conteúdo (a descrição não muda a renda: só a marca muda); a próxima leitura prova.
  w.apply('ws-a', ['r500']);
  const applied = time.now();
  const from = renders.length;
  await drive(time, () => incomeOf(latest()) === 1_056_000, 'a estimativa certa, provada pela marca');
  assert.ok(time.now() - applied < 800, 'sem esperar o tempo de interface nem prazo nenhum');
  await settle(100);
  assert.equal((latest() as Done).refreshFailed, false);
  assertUpdatingOr(renders.slice(from), [1_056_000], 'só "calculando" ou "atualização" e a estimativa certa');
});

test('B03 (R3, ex-M02): a hora do servidor não aprova: uma sessão nova aberta depois de o servidor passar da escrita por mais que qualquer prazo continua sem converter com a marca velha', async () => {
  const w = world();
  w.serverClock = true;
  standard(w);
  w.stamp();
  editDescriptionBeforeTrigger(w);
  manualClock(w);
  const first = mount(w, params());
  await until(() => w.calls.marks === 1, 'a leitura das marcas');
  await settle(300);
  assert.ok(noEstimate(first.renders), `a primeira sessão, sem estimativa (mostrados: ${shownSoFar()})`);
  act(() => renderer?.unmount());
  renderer = null;
  clearBasisRegistry();
  // Uma sessão nova, depois de o servidor passar da escrita por mais de uma hora: a hora não aprova nada.
  w.advance(3_700);
  const time = manualClock(w);
  const second = mount(w, params());
  await until(() => w.calls.marks === 2, 'a leitura das marcas da sessão nova');
  await elapse(w, time, 120_000);
  assert.ok(noEstimate(second.renders), `a sessão nova, sem estimativa (mostrados: ${shownSoFar()})`);
  assert.equal((second.latest() as Failed).message, ESTIMATE_UPDATING);
  // O gatilho aplica: a sessão nova prova, sem prazo.
  w.apply('ws-a', ['r500']);
  await drive(time, () => incomeOf(second.latest()) === 1_056_000, 'a estimativa certa, provada pela marca');
});

test('B03 (R3, ex-P01): o N03 com a hora do servidor nas bases: sessão aberta 5 s depois da edição de valor, e mesmo 1 h depois, nunca o valor novo com o total velho; o gatilho aplica (receita e marca) e aparece o certo', async () => {
  // Como nas Functions, `generatedAt` é ISO. A sessão abre 5 s depois da edição (R$ 500,00 → R$ 800,00), e o gatilho
  // aplica depois. Consistente: R$ 10.560,00. Misto: R$ 10.260,00 (R$ 800,00 tirados do total velho).
  const w = world();
  w.serverClock = true;
  const time = manualClock(w);
  standard(w);
  w.stamp();
  w.write('ws-a', 'r500', {date: '2026-10-15', type: 'receita', valueCents: 80_000, isPaid: true});
  w.advance(5);
  const {renders, latest} = mount(w, params());
  await until(() => w.calls.marks >= 1, 'a leitura das marcas');
  await settle(300);
  assert.ok(noEstimate(renders), `antes do gatilho, nenhuma estimativa (mostrados: ${shownSoFar()})`);
  await elapse(w, time, 120_000);
  w.advance(3_600);
  assert.ok(noEstimate(renders), `nem 1 h depois (mostrados: ${shownSoFar()})`);
  w.income['ws-a']['2026-10'] = 432_000;
  w.apply('ws-a', ['r500']);
  w.publish();
  await drive(time, () => incomeOf(latest()) === 1_056_000, 'a estimativa provada');
  await settle(100);
  assertUpdatingOr(renders, [1_056_000], 'só "calculando" ou "em atualização" e a estimativa provada');
});

for (const seconds of [59, 60, 3_600] as const) {
  test(`B03 (R3, ex-P01): nenhum intervalo aprova a conversão: com a base gerada ${seconds} s depois da escrita e a marca velha, só "estimativa em atualização"${seconds === 60 ? ' (o limite que antes encerrava a espera)' : ''}`, async () => {
    const w = world();
    w.serverClock = true;
    const time = manualClock(w);
    standard(w);
    w.stamp();
    // Edição sem efeito na renda: o gatilho não aplicou, e a marca segue no conteúdo anterior.
    editDescriptionBeforeTrigger(w);
    w.advance(seconds);
    const {renders, latest} = mount(w, params());
    await until(() => w.calls.marks >= 1, 'a leitura das marcas');
    await settle(100);
    assert.ok(noEstimate(renders), `${seconds} s: nenhuma estimativa (mostrados: ${shownSoFar()})`);
    await elapse(w, time, 120_000);
    assert.ok(noEstimate(renders), `${seconds} s: nem depois de muito tempo (mostrados: ${shownSoFar()})`);
    assert.equal((latest() as Failed).message, ESTIMATE_UPDATING);
  });
}

test('B03 (R3, ex-N06): a edição sem efeito na renda depois da mudança vista, aplicada pelo gatilho, não prende a estimativa: outra receita entra sem esperar prazo', async () => {
  const w = world();
  standard(w);
  const {renders, latest} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'estimativa');
  await settle(60);
  const from = renders.length;
  // Outra sessão muda a desconsiderada para R$ 800,00 (o gatilho aplica: outubro e a marca juntos) e, logo depois, só
  // a descrição (o gatilho aplica a marca; a renda não muda).
  w.delays.byIds = 60;
  w.write('ws-a', 'r500', {date: '2026-10-15', type: 'receita', valueCents: 80_000, isPaid: true});
  w.income['ws-a']['2026-10'] = 432_000;
  w.apply('ws-a', ['r500']);
  w.publish();
  w.write('ws-a', 'r500', {date: '2026-10-15', type: 'receita', valueCents: 80_000, isPaid: true, description: NEW_DESCRIPTION});
  w.apply('ws-a', ['r500']);
  await until(() => w.calls.byIds >= 2, 'a leitura por id relida');
  // Mais tarde, entra R$ 100,00 em agosto.
  w.income['ws-a']['2026-08'] = 362_000;
  w.publish();
  await until(() => incomeOf(latest()) === 1_066_000, 'agosto novo, provado pela marca');
  await settle(100);
  assertOnly(renders.slice(from), [1_056_000, 1_066_000], 'só estados consistentes');
  assert.ok(renders.slice(from).every((render) => render.state.status !== 'error'), 'nunca "em atualização": a marca estava aplicada');
});

// ------------------------------------------------------------------ P5-F.1-R3: o gancho com as marcas (a a e)

test('B03 (R3, a): a desconsiderada editada em outra sessão com o gatilho atrasado: nenhuma renderização converte com o conteúdo novo e o total velho; quando o gatilho aplica (receita e marca juntas), aparece o valor certo', async () => {
  const w = world();
  standard(w);
  const {renders, latest} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'estimativa');
  await settle(60);
  const from = renders.length;
  // Outra sessão muda a desconsiderada de R$ 500,00 para R$ 900,00. O gatilho atrasou: outubro e a marca seguem no
  // estado anterior.
  w.write('ws-a', 'r500', {date: '2026-10-15', type: 'receita', valueCents: 90_000, isPaid: true});
  // Outra receita de R$ 300,00 em setembro (essa já aplicada) faz a sincronização reler a base e, depois dela, a
  // leitura por id, que já traz o valor novo.
  w.income['ws-a']['2026-09'] = 382_000;
  w.publish();
  await until(() => w.calls.byIds >= 2 && w.calls.marks >= 2, 'a leitura por id relida, com o valor novo');
  await settle(300);
  // Nunca R$ 10.460,00 (R$ 900,00 tirados do total velho de outubro), nem a última estimativa provada no lugar da atual
  // (P5-F.1-R3.1, R3-AUD-01: antes, este teste admitia a última provada aqui): sem prova, nenhuma conversão.
  assertNoConversion(renders.slice(from), 'sem conversão enquanto o gatilho não aplicou');
  const calls = w.calls.byIds;
  // O gatilho aplica: outubro com o valor novo e a marca, no mesmo passo.
  w.income['ws-a']['2026-10'] = 442_000;
  w.apply('ws-a', ['r500']);
  w.publish();
  await until(() => incomeOf(latest()) === 1_086_000 && !(latest() as Done).refreshFailed, 'o valor certo, provado pela marca');
  await settle(150);
  assert.ok(w.calls.byIds > calls, 'relida depois da aplicação');
  // Depois da divergência, só a estimativa nova provada (R$ 10.860,00: setembro novo, outubro com o valor novo menos
  // R$ 900,00); nunca o conteúdo novo com o total velho nem a anterior.
  assertUpdatingOr(renders.slice(from), [1_086_000], 'sem o conteúdo novo com o total velho nem a anterior');
});

test('B03 (R3, b): evento fora de ordem (marca com pendência): sem conversão enquanto a pendência não fecha, mesmo relendo; fechada, a estimativa aparece', async () => {
  const w = world();
  const time = manualClock(w);
  standard(w);
  // O evento seguinte da desconsiderada chegou antes do anterior: a marca guarda a pendência.
  w.pendingMarks.add('ws-a:r500');
  const {renders, latest} = mount(w, params());
  await until(() => w.calls.marks >= 1, 'a leitura das marcas');
  await drive(time, () => w.calls.marks >= 3, 'releituras por motivo passageiro');
  assert.ok(noEstimate(renders), `sem conversão com a pendência (mostrados: ${shownSoFar()})`);
  await elapse(w, time, 600_000);
  assert.ok(noEstimate(renders), `nem depois de muito tempo (mostrados: ${shownSoFar()})`);
  assert.equal((latest() as Failed).message, ESTIMATE_UPDATING);
  // O evento anterior chega e a pendência fecha; a leitura seguinte prova.
  w.pendingMarks.delete('ws-a:r500');
  await drive(time, () => incomeOf(latest()) === 1_056_000, 'a estimativa certa depois de a pendência fechar');
  await settle(100);
  assertUpdatingOr(renders, [1_056_000], 'só "calculando" ou "em atualização" e a estimativa provada');
});

test('B03 (R3, c): marca quebrada: sem conversão e sem releitura automática além da escuta; só a reconstrução, a escuta ou o "Tentar de novo" recuperam', async () => {
  const w = world();
  const time = manualClock(w);
  standard(w);
  w.brokenMarks.add('ws-a:r500');
  const {renders, latest} = mount(w, params());
  await until(() => w.calls.byIds === 1 && w.calls.marks === 1, 'a primeira leitura');
  await settle(100);
  await elapse(w, time, 600_000);
  assert.deepEqual([w.calls.byIds, w.calls.marks], [1, 1], 'nenhuma releitura automática, por mais que o tempo passe');
  assert.ok(noEstimate(renders), `sem conversão (mostrados: ${shownSoFar()})`);
  assert.equal((latest() as Failed).message, ESTIMATE_UPDATING);
  // A escuta (uma receita nova em setembro) pede a releitura da base e, depois dela, a das exclusões: ainda quebrada.
  w.income['ws-a']['2026-09'] = 382_000;
  w.publish();
  await drive(time, () => w.calls.byIds === 2 && w.calls.marks === 2, 'a releitura pedida pela escuta');
  await elapse(w, time, 120_000);
  assert.deepEqual([w.calls.byIds, w.calls.marks], [2, 2], 'só a releitura da escuta');
  assert.ok(noEstimate(renders), `a marca quebrada segue sem prova (mostrados: ${shownSoFar()})`);
  // A reconstrução recupera a marca; o "Tentar de novo" lê de novo e prova.
  w.brokenMarks.delete('ws-a:r500');
  act(() => (latest() as Failed).retry());
  await drive(time, () => incomeOf(latest()) === 1_086_000, 'a estimativa certa depois do "Tentar de novo"');
  assert.deepEqual([w.calls.byIds, w.calls.marks], [3, 3]);
});

test('B03 (R3, d): a desconsiderada muda de mês para fora da janela: o mês antigo só deixa de descontar quando a marca e a receita mudam juntas', async () => {
  const w = world();
  standard(w);
  const {renders, latest} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'estimativa');
  await settle(60);
  const from = renders.length;
  // Outra sessão muda a data de r500 para julho (fora da janela, agosto a outubro). O gatilho atrasou: outubro segue
  // com os R$ 500,00 e a marca com o conteúdo de outubro.
  w.write('ws-a', 'r500', {date: '2026-07-15', type: 'receita', valueCents: 50_000, isPaid: true});
  w.income['ws-a']['2026-09'] = 382_000;
  w.publish();
  await until(() => w.calls.byIds >= 2 && w.calls.marks >= 2, 'a leitura por id relida, com a data nova');
  await settle(300);
  // Nunca R$ 11.360,00: o mês antigo sem desconto (a data nova) com outubro ainda somando a receita; nem a última
  // estimativa provada no lugar da atual (P5-F.1-R3.1): sem prova, nenhuma conversão.
  assertNoConversion(renders.slice(from), 'sem conversão enquanto o gatilho não aplicou');
  // O gatilho aplica: outubro sem a receita, julho com ela e a marca com o conteúdo de julho, no mesmo passo.
  w.income['ws-a']['2026-10'] = 352_000;
  w.income['ws-a']['2026-07'] = 50_000;
  w.apply('ws-a', ['r500']);
  w.publish();
  await until(() => incomeOf(latest()) === 1_086_000 && monthOf(latest(), '2026-10') === 352_000, 'o mês antigo sem desconto, provado');
  await settle(150);
  assertUpdatingOr(renders.slice(from), [1_086_000], 'nunca o mês antigo sem desconto com o total velho, nem a anterior');
});

test('B03 (R3, e): a releitura por motivo passageiro respeita o orçamento do agendador: no máximo o orçamento, a reposição depois, e nunca um prazo que aprove', async () => {
  const w = world();
  // Orçamento de 2 releituras e reposição de 1 a cada 60 s.
  const time = manualClock(w, {coalesceMs: 30, burst: 2, refillMs: 60_000});
  standard(w);
  w.stamp();
  editDescriptionBeforeTrigger(w);
  const {renders, latest} = mount(w, params());
  await until(() => w.calls.byIds === 1 && w.calls.marks === 1, 'a primeira leitura');
  await settle(60);
  const calls = () => [w.calls.byIds, w.calls.marks];
  for (let step = 0; step < 6; step += 1) {
    time.advance(30);
    await settle(60);
  }
  assert.deepEqual(calls(), [3, 3], 'a carga e as duas releituras do orçamento; depois, espera a reposição');
  // Sem ficha, o pedido espera a reposição: nada antes dela.
  time.advance(59_000);
  await settle(60);
  assert.deepEqual(calls(), [3, 3], 'antes da reposição, nenhuma releitura');
  // A reposição devolve uma ficha: uma releitura, e de novo sem ficha.
  for (let step = 0; step < 4; step += 1) {
    time.advance(1_000);
    await settle(60);
  }
  assert.deepEqual(calls(), [4, 4], 'uma ficha devolvida, uma releitura');
  await elapse(w, time, 30_000);
  assert.deepEqual(calls(), [4, 4], 'sem outra ficha, sem releitura');
  assert.ok(noEstimate(renders), `nenhuma conversão, nem depois de gastar o orçamento (mostrados: ${shownSoFar()})`);
  assert.equal((latest() as Failed).message, ESTIMATE_UPDATING);
});

/*
 * Revisão da R1 (N06), contrato reescrito na P5-F.1-R3.1 (R3-AUD-01). Antes: "a última estimativa provada mostrada no
 * lugar da atual por mais que a espera limitada ganha o aviso e o 'Tentar de novo'", ou seja, a anterior aparecia
 * como atual, sem aviso até a espera acabar. Agora a anterior não aparece em momento nenhum; o tempo de interface só
 * troca "calculando" por "estimativa em atualização", com "Tentar de novo" (evidence/p5f1-r31/testes-substituidos.md).
 */
test('revisão da R1 (N06), contrato da R3.1: a base relida devagar por mais que o tempo de interface: nunca a última provada; "calculando", depois "estimativa em atualização" com "Tentar de novo", e a nova provada, sem aviso', async () => {
  const w = world();
  standard(w);
  const {renders, latest} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'estimativa');
  await settle(60);
  const from = renders.length;
  // Outra sessão lança R$ 300,00 em setembro, e a releitura da base demora mais que o tempo de interface (800 ms aqui).
  w.delays.series = 1_300;
  w.income['ws-a']['2026-09'] = 382_000;
  w.publish();
  await until(() => latest()?.status === 'error', '"em atualização" depois do tempo de interface', 2_500);
  const updating = latest() as Failed;
  assert.equal(updating.message, ESTIMATE_UPDATING);
  assert.equal(typeof updating.retry, 'function', 'com "Tentar de novo"');
  assertNoConversion(renders.slice(from), 'enquanto a base nova não chega, nenhuma conversão, nem a anterior com aviso');
  await until(() => incomeOf(latest()) === 1_086_000, 'a nova provada', 3_000);
  assert.equal((latest() as Done).refreshFailed, false, 'a nova, sem o aviso');
  assertUpdatingOr(renders.slice(from), [1_086_000], 'só "calculando", "em atualização" e a nova provada');
});

// ------------------------------------------------------------------ P5-F.1-R3.1 (R3-AUD-01): nada anterior como atual

/**
 * A prova das marcas sobre o que o servidor tem agora, com as mesmas funções do gancho (leitura por id com as
 * impressões, transação dos meses e das marcas e `proveProjectionExclusions`): afirma a premissa do cenário
 * (`proven=false`) sem depender do gancho.
 */
const proofOfWorld = async (w: World, basisIncome: Record<string, number>) => {
  const read = await readExcludedIncome(w.deps.readByIds, 'ws-a', ['r500']);
  const snapshot = await w.deps.readProjectionMarks('ws-a', MONTHS, ['r500', ...Object.values(read.reversalIds)]);
  const documents: Record<string, {document: Record<string, unknown>; fingerprint: string | null}> = {};
  for (const document of [...read.found, ...Object.values(read.reversals)]) {
    const id = String((document as {id?: unknown}).id);
    documents[id] = {document: document as Record<string, unknown>, fingerprint: read.fingerprints[id] ?? null};
  }
  return proveProjectionExclusions({months: MONTHS, snapshot, basisIncome, excludedIds: ['r500'], read: documents, reversalIds: read.reversalIds});
};
/** Nenhuma renderização recebeu estimativa pronta (nem a anterior nem outra, com ou sem aviso): os valores ficam em reais. */
const assertNoConversion = (renders: readonly Render[], message: string) => {
  const converted = renders.filter((render) => render.state.status === 'done');
  assert.deepEqual(
    converted.map((render) => `${incomeOf(render.state)} ${(render.state as Done).refreshFailed ? 'com aviso' : 'sem aviso'}`),
    [],
    `${message} (mostrados: ${shownSoFar()})`,
  );
};
/** Depois da divergência, só estados sem conversão (os permitidos) até a estimativa nova provada (`allowed`). */
const assertOnlyWithoutConversionOr = (
  renders: readonly Render[], allowedFailures: readonly string[], allowed: readonly number[], message: string,
) => {
  const other = renders.filter((render) => {
    if (render.state.status === 'loading') return false;
    if (render.state.status === 'error') return !allowedFailures.includes(render.state.message);
    return !allowed.includes(incomeOf(render.state) ?? -1);
  });
  assert.deepEqual(other.map((render) => render.state.status === 'error' ? render.state.message : `${render.state.status} ${incomeOf(render.state)}`), [],
    `${message} (mostrados: ${shownSoFar()})`);
};
/**
 * O cenário do achado R3-AUD-01, a partir da estimativa provada de R$ 10.560,00: outra sessão muda a desconsiderada de
 * R$ 500,00 para R$ 900,00 sem o gatilho ter aplicado (outubro e a marca seguem no conteúdo anterior) e lança R$ 300,00
 * em setembro, já aplicados. A escuta vê a projeção nova, a sincronização relê a base e, depois dela, a leitura por id
 * traz o valor novo, que a marca ainda não contém: a prova é falsa, a identidade não muda e nenhuma leitura falhou.
 * Devolve o índice da primeira renderização depois da divergência.
 */
const divergeWithoutTrigger = (w: World, renders: readonly Render[]) => {
  w.write('ws-a', 'r500', {date: '2026-10-15', type: 'receita', valueCents: 90_000, isPaid: true});
  w.income['ws-a']['2026-09'] = 382_000;
  const from = renders.length;
  w.publish();
  return from;
};
/** O gatilho aplica a edição: outubro com o valor novo e a marca, no mesmo passo. Consistente: R$ 10.860,00. */
const applyEdit = (w: World) => {
  w.income['ws-a']['2026-10'] = 442_000;
  w.apply('ws-a', ['r500']);
  w.publish();
};

test('R3.1 (R3-AUD-01): a última estimativa provada nunca aparece como a atual: leitura nova divergente, prova falsa, a mesma identidade e nenhuma falha de leitura dão só "calculando"; com a prova de volta, a estimativa nova', async () => {
  const w = world();
  standard(w);
  const initial = params();
  const {renders, latest} = mount(w, initial);
  await until(() => incomeOf(latest()) === 1_056_000 && !(latest() as Done).refreshFailed, 'a estimativa provada, sem aviso');
  await settle(60);
  const from = divergeWithoutTrigger(w, renders);
  await until(() => w.calls.byIds >= 2 && w.calls.marks >= 2, 'a leitura por id relida, com o valor novo');
  await settle(150);
  const between = renders.slice(from);
  // A premissa do achado: a mesma identidade (conta e entradas), nenhuma falha de leitura nem da escuta, e a prova falsa.
  assert.ok(between.length > 0, 'a divergência renderizou');
  assert.ok(between.every((render) => render.uid === 'u1' && render.params === initial), 'a mesma identidade');
  assert.deepEqual([w.failing.byIds, w.failing.marks, w.failing.month, w.listenRefused], [false, false, false, false], 'nenhuma falha de leitura nem da escuta');
  assert.ok(between.every((render) => render.state.status !== 'error' || render.state.message === ESTIMATE_UPDATING), 'nenhum erro de leitura');
  assert.deepEqual(await proofOfWorld(w, {'2026-08': 352_000, '2026-09': 382_000, '2026-10': 402_000}), {proven: false, reason: 'content'},
    'a prova é falsa: a marca guarda o conteúdo anterior');
  // A interface nunca recebe a estimativa anterior (R$ 10.560,00) como a atual, nem sem aviso nem com ele.
  assertNoConversion(between, 'nenhuma conversão depois da divergência, sem prova');
  // A prova volta: a estimativa nova aparece sem esperar prazo nenhum e sem aviso.
  applyEdit(w);
  await until(() => incomeOf(latest()) === 1_086_000, 'a estimativa nova, provada');
  await settle(100);
  assert.equal((latest() as Done).refreshFailed, false, 'a nova, sem aviso');
  assertUpdatingOr(renders.slice(from), [1_086_000], 'depois da divergência, só "calculando" ou "em atualização" e a estimativa nova provada');
});

test('R3.1: antes e depois do tempo de interface (30 s no produto, 800 ms aqui): "calculando" e depois "estimativa em atualização" com "Tentar de novo"; em nenhum dos dois a última provada, e só a prova reabilita a conversão', async () => {
  const w = world();
  const time = manualClock(w);
  standard(w);
  const {renders, latest} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'a estimativa provada');
  await settle(60);
  const from = divergeWithoutTrigger(w, renders);
  await drive(time, () => w.calls.byIds >= 2 && w.calls.marks >= 2, 'a leitura por id relida');
  await settle(100);
  assertNoConversion(renders.slice(from), 'antes do tempo de interface');
  assert.equal(latest()?.status, 'loading', 'antes do tempo de interface: "calculando"');
  time.advance(1_000);
  await settle(60);
  const updating = latest() as Failed;
  assert.deepEqual([updating.status, updating.message], ['error', ESTIMATE_UPDATING], 'depois do tempo de interface: "em atualização"');
  assert.equal(typeof updating.retry, 'function', 'com "Tentar de novo"');
  assertNoConversion(renders.slice(from), 'depois do tempo de interface');
  // O tempo não aprova nada: 10 min no relógio da estimativa e 1 h na hora do servidor depois, ainda sem conversão.
  await elapse(w, time, 600_000);
  w.advance(3_600);
  assertNoConversion(renders.slice(from), 'nem muito depois');
  // "Tentar de novo" relê, mas sem a marca aplicada continua sem prova.
  const reads = w.calls.byIds;
  act(() => (latest() as Failed).retry());
  await drive(time, () => w.calls.byIds > reads && w.calls.marks > reads, 'a releitura pedida pelo "Tentar de novo"');
  await settle(100);
  assertNoConversion(renders.slice(from), 'o "Tentar de novo" sem a marca aplicada');
  // A prova volta: a conversão volta sem esperar o tempo de interface.
  applyEdit(w);
  const applied = time.now();
  await drive(time, () => incomeOf(latest()) === 1_086_000, 'a estimativa nova, provada');
  assert.ok(time.now() - applied < 800, 'sem esperar o tempo de interface nem prazo nenhum');
  assert.equal((latest() as Done).refreshFailed, false, 'sem aviso');
  assertUpdatingOr(renders.slice(from), [1_086_000], 'só "calculando", "em atualização" e a estimativa nova');
  // Um segundo período sem prova começa de novo em "calculando": o tempo de interface conta a partir do começo de cada
  // espera, sem herdar o "em atualização" do período anterior (revisão adversarial da R3.1, A-06 a; mutante A12).
  const readsBefore = w.calls.byIds;
  const marksBefore = w.calls.marks;
  w.write('ws-a', 'r500', {date: '2026-10-15', type: 'receita', valueCents: 120_000, isPaid: true});
  w.income['ws-a']['2026-09'] = 412_000;
  const second = renders.length;
  w.publish();
  await drive(time, () => w.calls.byIds > readsBefore && w.calls.marks > marksBefore, 'a leitura por id relida no segundo período');
  await settle(100);
  assertNoConversion(renders.slice(second), 'o segundo período, antes do tempo de interface');
  assert.deepEqual(renders.slice(second).filter((render) => render.state.status === 'error').map((render) => (render.state as Failed).message), [],
    'o segundo período não herda o "em atualização" do primeiro');
  assert.equal(latest()?.status, 'loading', 'o segundo período começa em "calculando"');
  time.advance(1_000);
  await settle(60);
  const updatingAgain = latest() as Failed;
  assert.deepEqual([updatingAgain.status, updatingAgain.message], ['error', ESTIMATE_UPDATING], 'depois do tempo de interface, de novo "em atualização"');
  assertNoConversion(renders.slice(second), 'o segundo período, depois do tempo de interface');
  // O gatilho aplica a segunda edição: outubro com o valor novo e a marca. Consistente: R$ 11.160,00.
  w.income['ws-a']['2026-10'] = 472_000;
  w.apply('ws-a', ['r500']);
  w.publish();
  await drive(time, () => incomeOf(latest()) === 1_116_000, 'a estimativa do segundo período, provada');
  assert.equal((latest() as Done).refreshFailed, false, 'sem aviso no segundo período');
  assertUpdatingOr(renders.slice(second), [1_116_000], 'no segundo período, só "calculando", "em atualização" e a estimativa nova');
});

for (const failing of ['byIds', 'marks'] as const) {
  test(`R3.1: a releitura falha depois da divergência (${failing === 'byIds' ? 'lançamentos por id' : 'meses e marcas'}): o erro fixo em pt-BR com "Tentar de novo", nunca a última provada com ou sem aviso; o "Tentar de novo" sem a marca aplicada continua sem conversão, e a prova reabilita`, async () => {
    const w = world();
    standard(w);
    const {renders, latest} = mount(w, params());
    await until(() => incomeOf(latest()) === 1_056_000, 'a estimativa provada');
    await settle(60);
    w.failing[failing] = true;
    const from = divergeWithoutTrigger(w, renders);
    await until(() => latest()?.status === 'error', 'o erro da releitura');
    await settle(60);
    assert.equal((latest() as Failed).message, ESTIMATE_EXCLUDED_READ_FAILED, 'o texto fixo, sem detalhe técnico');
    assertNoConversion(renders.slice(from), 'nenhuma conversão com a releitura falhando');
    // A rede volta; o "Tentar de novo" relê, e sem a marca aplicada ainda não há prova.
    w.failing[failing] = false;
    const reads = w.calls.marks;
    act(() => (latest() as Failed).retry());
    await until(() => w.calls.marks > reads && latest()?.status !== 'error', 'a releitura pelo "Tentar de novo"');
    await settle(100);
    assertNoConversion(renders.slice(from), 'o "Tentar de novo" sem a marca aplicada');
    applyEdit(w);
    await until(() => incomeOf(latest()) === 1_086_000 && !(latest() as Done).refreshFailed, 'a estimativa nova, provada');
    await settle(60);
    assertOnlyWithoutConversionOr(renders.slice(from), [ESTIMATE_EXCLUDED_READ_FAILED, ESTIMATE_UPDATING], [1_086_000],
      'só "calculando", o erro fixo, "em atualização" e a estimativa nova');
  });
}

test('R3.1: com a releitura por id em andamento depois da divergência, "calculando", nunca a última provada; terminada sem prova, ainda sem conversão', async () => {
  const w = world();
  standard(w);
  const {renders, latest} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'a estimativa provada');
  await settle(60);
  w.delays.byIds = 400;
  const from = divergeWithoutTrigger(w, renders);
  await until(() => w.calls.byIds >= 2, 'a releitura por id começou');
  await settle(100);
  assert.equal(w.calls.marks, 1, 'a releitura ainda em andamento (as marcas vêm depois dos lançamentos)');
  assert.equal(latest()?.status, 'loading', 'com a leitura em andamento: "calculando"');
  assertNoConversion(renders.slice(from), 'nenhuma conversão com a leitura em andamento');
  await until(() => w.calls.marks >= 2, 'a releitura terminou');
  await settle(100);
  assertNoConversion(renders.slice(from), 'terminada sem prova, ainda sem conversão');
  w.delays.byIds = 10;
  applyEdit(w);
  await until(() => incomeOf(latest()) === 1_086_000, 'a estimativa nova, provada');
  await settle(60);
  assertUpdatingOr(renders.slice(from), [1_086_000], 'só "calculando" ou "em atualização" e a estimativa nova');
});

test('R3.1: troca do workspace da renda com a prova pendente: nem a última provada do anterior nem estado nenhum dele; só "calculando" até a estimativa do novo estar provada', async () => {
  const w = world();
  standard(w);
  w.income['ws-b'] = {'2026-08': 200_000, '2026-09': 200_000, '2026-10': 200_000, '2026-11': 50_000};
  w.write('ws-b', 'r500', {date: '2026-10-20', type: 'receita', valueCents: 20_000, isPaid: true});
  w.apply('ws-b', ['r500']);
  const {renders, latest, setParams} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'ws-a provado');
  await settle(60);
  const from = divergeWithoutTrigger(w, renders);
  await until(() => w.calls.byIds >= 2 && w.calls.marks >= 2, 'ws-a relido, sem prova');
  await settle(100);
  assertNoConversion(renders.slice(from), 'ws-a sem prova: nenhuma conversão');
  const switched = renders.length;
  setParams(params({workspaceId: 'ws-b'}));
  await until(() => incomeOf(latest()) === 580_000, 'ws-b provado');
  await settle(60);
  assertLoadingOr(renders.slice(from), [580_000], 'nunca a renda de ws-a, nem a anterior nem a nova');
  assert.ok(renders.slice(switched).every((render) => render.params.workspaceId === 'ws-b'), 'só ws-b depois da troca');
});

test('R3.1: mudança da preferência com a prova pendente (a receita deixa de ser desconsiderada): a estimativa das entradas novas só aparece provada; a última provada das entradas antigas nunca', async () => {
  const w = world();
  standard(w);
  const {renders, latest, setParams} = mount(w, params());
  await until(() => incomeOf(latest()) === 1_056_000, 'a estimativa provada');
  await settle(60);
  const from = divergeWithoutTrigger(w, renders);
  await until(() => w.calls.byIds >= 2 && w.calls.marks >= 2, 'a leitura por id relida, sem prova');
  await settle(100);
  assertNoConversion(renders.slice(from), 'sem prova: nenhuma conversão');
  setParams(params({excludedIds: []}));
  // Sem desconsiderada e com uma base, basta a base confirmada pela projeção (P5-F.1-R3.2: a leitura única não prova
  // mais sozinha): R$ 3.520,00 + R$ 3.820,00 + R$ 4.020,00 (outubro ainda com os R$ 500,00 que a projeção contém).
  await until(() => incomeOf(latest()) === 1_136_000, 'a estimativa das entradas novas');
  await settle(60);
  assertLoadingOr(renders.slice(from), [1_136_000], 'nunca R$ 10.560,00 (a última provada das entradas antigas)');
});

test('R3.1: com a sincronização em curso (uma base e nenhuma desconsiderada; a base em releitura ainda diverge da projeção): nenhuma conversão até a base relida chegar, "calculando" e, passado o tempo de interface, "em atualização"; chegando, a nova, sem prazo', async () => {
  const w = world();
  standard(w);
  const {renders, latest} = mount(w, params({excludedIds: []}));
  await until(() => incomeOf(latest()) === 1_106_000, 'a estimativa');
  await settle(60);
  // Outra sessão lança R$ 300,00 em setembro; a releitura da base demora mais que o tempo de interface (800 ms aqui).
  w.delays.series = 1_300;
  w.income['ws-a']['2026-09'] = 382_000;
  const from = renders.length;
  w.publish();
  await until(() => w.calls.series >= 2, 'a base em releitura');
  await settle(100);
  assert.equal(latest()?.status, 'loading', 'com a base em releitura: "calculando", nunca a anterior');
  assertNoConversion(renders.slice(from), 'nenhuma conversão com a sincronização em curso');
  // A sincronização segura e, com a projeção nova vista antes da base relida, a prova também falta (P5-F.1-R3.2); o
  // tempo de interface só muda o texto.
  await until(() => latest()?.status === 'error', '"em atualização" com a sincronização em curso', 2_500);
  assert.equal((latest() as Failed).message, ESTIMATE_UPDATING);
  assertNoConversion(renders.slice(from), 'nem depois do tempo de interface');
  await until(() => incomeOf(latest()) === 1_136_000, 'a estimativa nova', 3_000);
  await settle(60);
  assert.equal((latest() as Done).refreshFailed, false);
  assertUpdatingOr(renders.slice(from), [1_136_000], 'só "calculando", "em atualização" e a estimativa nova');
});

// ------------------------------------------------------------------ P5-F.1-R3.2 (RR-R31-05): só converte o que o servidor confirmou

/*
 * P5-F.1-R3.2 (RR-R31-05): uma estimativa pronta só converte com a projeção confirmada por um retorno do servidor à
 * escuta desta montagem e com a base igual a ela, em toda janela e com ou sem desconsiderada. A base do cache do React
 * Query (a tela que volta, a prévia ao lado, a estimativa religada, o workspace que volta), a escuta sem retorno do
 * servidor, sem conexão ou encerrada, e a base que não alcança a projeção depois das releituras não convertem. Nenhum
 * prazo aprova. Na R3.1, os cenários com uma base e nenhuma desconsiderada convertiam (a "leitura única").
 */

/** A estimativa provada numa primeira montagem, que sai da tela: devolve o cache do React Query aquecido e o valor. */
const warmCache = async (w: World, first: IncomeEstimateParams, expected?: number) => {
  const view = mount(w, first);
  await until(() => readyOf(view.latest()) !== null && !(view.latest() as Done).refreshFailed, 'a estimativa provada na primeira montagem');
  await settle(60);
  const value = incomeOf(view.latest()) as number;
  if (expected !== undefined) assert.equal(value, expected, 'o valor da primeira montagem');
  view.unmount();
  return {client: view.client, value};
};

for (const changed of [false, true] as const) {
  test(`R3.2 (RR-R31-05): a base do cache aquecido antes do primeiro retorno do servidor (uma base, nenhuma desconsiderada${changed ? ', receita nova de outra sessão com a tela fora' : ''}): nenhuma conversão, nem passado o tempo de interface; o retorno do servidor traz a conversão${changed ? ' da base relida, nunca a do cache' : ''}`, async () => {
    const w = world();
    const time = manualClock(w);
    standard(w);
    const {client} = await warmCache(w, params({excludedIds: []}), 1_106_000);
    // Outra sessão lança R$ 500,00 em outubro enquanto a tela está fora; o gatilho grava a projeção.
    if (changed) w.income['ws-a']['2026-10'] = 452_000;
    // O servidor ainda não respondeu à escuta da montagem nova.
    w.autoListen = false;
    const seriesBefore = w.calls.series;
    const {renders, latest} = mount(w, params({excludedIds: []}), {client});
    await settle(120);
    assert.equal(w.calls.series, seriesBefore, 'a base vem do cache do React Query, sem leitura');
    assert.equal(latest()?.status, 'loading', 'antes do retorno do servidor: "calculando"');
    assertNoConversion(renders, 'a base do cache não converte antes do retorno do servidor (a R3.1 mostrava R$ 11.060,00)');
    time.advance(1_000);
    await settle(60);
    assert.deepEqual([latest()?.status, (latest() as Failed).message], ['error', ESTIMATE_UPDATING], 'passado o tempo de interface: "em atualização"');
    // O tempo não é prova: 10 min no relógio da estimativa e 30 min na hora do servidor, ainda sem conversão.
    await elapse(w, time, 600_000);
    assertNoConversion(renders, 'o tempo não aprova a base do cache');
    w.publish();
    const expected = changed ? 1_156_000 : 1_106_000;
    await drive(time, () => incomeOf(latest()) === expected, 'a conversão confirmada pelo servidor');
    await settle(60);
    assert.equal((latest() as Done).refreshFailed, false, 'sem aviso');
    assert.equal(w.calls.series, seriesBefore + (changed ? 1 : 0), changed ? 'a base relida uma vez, pela divergência' : 'confirmada sem leitura nova');
    assertUpdatingOr(renders, [expected], changed
      ? 'só "calculando", "em atualização" e a estimativa da base relida; nunca R$ 11.060,00 (a do cache)'
      : 'só "calculando", "em atualização" e a estimativa confirmada');
  });
}

test('R3.2 (RR-R31-05): mês corrente com o cache de antes de uma receita de hoje: a base do cache diverge da projeção do mês e é relida; nenhuma conversão antes, e a confirmada depois', async () => {
  const w = world();
  standard(w);
  const {client} = await warmCache(w, params({excludedIds: [], mode: 'current_month'}), 100_000);
  // Receita de hoje (nenhum lançamento confirmado tem data futura, D-29): a projeção do mês corrente passa a R$ 1.300,00.
  w.income['ws-a']['2026-11'] = 130_000;
  w.autoListen = false;
  const {renders, latest} = mount(w, params({excludedIds: [], mode: 'current_month'}), {client});
  await settle(120);
  assertNoConversion(renders, 'o mês corrente do cache, antes do retorno do servidor');
  w.publish();
  await until(() => incomeOf(latest()) === 130_000, 'a base relida, confirmada');
  await settle(60);
  assertLoadingOr(renders, [130_000], 'nunca R$ 1.000,00 (o mês corrente do cache, sem a receita de hoje)');
});

test('R3.2 (RR-R31-05): a prévia montada ao lado da estimativa provada, com o mesmo cache, não converte antes do retorno do servidor à escuta dela; o retorno traz a mesma estimativa', async () => {
  const w = world();
  standard(w);
  const provider = mount(w, params({excludedIds: []}));
  await until(() => incomeOf(provider.latest()) === 1_106_000, 'a estimativa do provedor, provada');
  await settle(60);
  w.autoListen = false;
  const preview = mount(w, params({excludedIds: []}), {client: provider.client});
  await settle(120);
  assertNoConversion(preview.renders, 'a prévia, antes do retorno do servidor à escuta dela');
  assert.equal(incomeOf(provider.latest()), 1_106_000, 'o provedor continua provado pela escuta dele');
  w.publish();
  await until(() => incomeOf(preview.latest()) === 1_106_000, 'a prévia confirmada');
  assertLoadingOr(preview.renders, [1_106_000], 'a prévia: só "calculando" e a estimativa confirmada');
});

test('R3.2 (RR-R31-05): a estimativa desligada e religada com o cache aquecido: nenhuma conversão até o retorno do servidor à escuta reaberta', async () => {
  const w = world();
  standard(w);
  const {renders, latest, setParams} = mount(w, params({excludedIds: []}));
  await until(() => incomeOf(latest()) === 1_106_000, 'a estimativa provada');
  await settle(60);
  setParams(params({excludedIds: [], enabled: false}));
  await settle(30);
  assert.equal(latest()?.status, 'idle', 'desligada');
  w.autoListen = false;
  const from = renders.length;
  setParams(params({excludedIds: []}));
  await settle(120);
  assertNoConversion(renders.slice(from), 'religada, antes do retorno do servidor');
  w.publish();
  await until(() => incomeOf(latest()) === 1_106_000, 'religada e confirmada');
  assertLoadingOr(renders.slice(from), [1_106_000], 'religada: só "calculando" e a estimativa confirmada');
});

test('R3.2 (RR-R31-05): troca do workspace da renda e volta ao anterior com o cache aquecido: nenhuma conversão do anterior antes do retorno do servidor à escuta dele, nem estado do outro', async () => {
  const w = world();
  standard(w);
  w.income['ws-b'] = {'2026-08': 200_000, '2026-09': 200_000, '2026-10': 200_000, '2026-11': 50_000};
  const {renders, latest, setParams} = mount(w, params({excludedIds: []}));
  await until(() => incomeOf(latest()) === 1_106_000, 'ws-a provado');
  await settle(60);
  setParams(params({excludedIds: [], workspaceId: 'ws-b'}));
  await until(() => incomeOf(latest()) === 600_000, 'ws-b provado');
  await settle(60);
  w.autoListen = false;
  const back = renders.length;
  setParams(params({excludedIds: []}));
  await settle(120);
  assertNoConversion(renders.slice(back), 'ws-a com o cache aquecido, antes do retorno do servidor');
  assert.ok(renders.slice(back).every((render) => render.params.workspaceId === 'ws-a'), 'só ws-a depois da volta');
  w.publish('ws-a');
  await until(() => incomeOf(latest()) === 1_106_000, 'ws-a confirmado');
  assertLoadingOr(renders.slice(back), [1_106_000], 'depois da volta, só "calculando" e a estimativa de ws-a confirmada');
});

test('R3.2 (RR-R31-05): sem conexão, a tela que volta com o cache aquecido não converte (a escuta só tem o retorno do cache local); com a conexão de volta, a conversão confirmada', async () => {
  const w = world();
  const time = manualClock(w);
  standard(w);
  const {client} = await warmCache(w, params({excludedIds: []}), 1_106_000);
  w.offline = true;
  const {renders, latest} = mount(w, params({excludedIds: []}), {client});
  await settle(120);
  assert.ok(w.log.includes('projeção do cache'), 'a escuta recebeu só o retorno do cache local');
  assertNoConversion(renders, 'sem conexão, a base do cache não converte');
  time.advance(1_000);
  await settle(60);
  assert.deepEqual([latest()?.status, (latest() as Failed).message], ['error', ESTIMATE_UPDATING], 'sem conexão, passado o tempo de interface: "em atualização"');
  w.goOnline();
  await drive(time, () => incomeOf(latest()) === 1_106_000, 'com a conexão de volta, a conversão confirmada');
  await settle(60);
  assertUpdatingOr(renders, [1_106_000], 'só "calculando", "em atualização" e a estimativa confirmada');
});

test('R3.2 (RR-R31-05): a conexão cai com a estimativa provada na tela: o retorno do cache local tira a conversão ("calculando", depois "em atualização"); com a conexão de volta, ela volta sem leitura a mais', async () => {
  const w = world();
  const time = manualClock(w);
  standard(w);
  const {renders, latest} = mount(w, params({excludedIds: []}));
  await until(() => incomeOf(latest()) === 1_106_000, 'a estimativa provada');
  await settle(60);
  const reads = w.calls.series;
  const from = renders.length;
  w.goOffline();
  await settle(60);
  assertNoConversion(renders.slice(from), 'sem conexão, nenhuma conversão (a R3.1 mantinha R$ 11.060,00)');
  assert.equal(latest()?.status, 'loading', 'sem conexão: "calculando"');
  time.advance(1_000);
  await settle(60);
  assert.equal((latest() as Failed).message, ESTIMATE_UPDATING, 'passado o tempo de interface: "em atualização"');
  w.goOnline();
  await drive(time, () => incomeOf(latest()) === 1_106_000, 'a conversão de volta, confirmada pelo servidor');
  assert.equal(w.calls.series, reads, 'sem releitura: a projeção confirma a mesma base');
  assertUpdatingOr(renders.slice(from), [1_106_000], 'só "calculando", "em atualização" e a estimativa confirmada');
});

test('R3.2 (RR-R31-05): a escuta encerrada por erro com a estimativa provada (uma base, nenhuma desconsiderada): a conversão sai e fica o erro com "Tentar de novo"; o "Tentar de novo" reabre a escuta e o retorno do servidor traz a conversão', async () => {
  const w = world();
  standard(w);
  const {renders, latest} = mount(w, params({excludedIds: []}));
  await until(() => incomeOf(latest()) === 1_106_000, 'a estimativa provada');
  await settle(60);
  const from = renders.length;
  w.failListen();
  await settle(60);
  assertNoConversion(renders.slice(from), 'a escuta encerrada: nenhuma conversão, nem com a ressalva (a R3.1 mostrava R$ 11.060,00 com o aviso)');
  const failed = latest() as Failed;
  assert.deepEqual([failed.status, failed.message], ['error', ESTIMATE_UNCONFIRMED_FAILED], 'o erro fixo em pt-BR');
  act(() => failed.retry());
  await until(() => incomeOf(latest()) === 1_106_000 && !(latest() as Done).refreshFailed, 'a escuta reaberta confirma');
  assertOnlyWithoutConversionOr(renders.slice(from), [ESTIMATE_UNCONFIRMED_FAILED], [1_106_000], 'só o erro, "calculando" e a estimativa confirmada');
});

test('R3.2 (RR-R31-05): a base que não alcança a projeção depois das releituras (anomalia no servidor; uma base, nenhuma desconsiderada): nenhuma conversão, nem passadas as releituras e o tempo de interface; sem a anomalia, o "Tentar de novo" traz a estimativa provada', async () => {
  const w = world();
  const time = manualClock(w);
  standard(w);
  // A série traz R$ 300,00 a mais em setembro do que a projeção: a base nunca a alcança.
  w.basisSkew['ws-a'] = {'2026-09': 30_000};
  const {renders, latest} = mount(w, params({excludedIds: []}));
  await drive(time, () => w.calls.series >= 3, 'a leitura e as duas releituras pela mesma divergência', 60);
  await settle(100);
  time.advance(2_000);
  await settle(100);
  assert.equal(w.calls.series, 3, 'no máximo BASIS_DIVERGENCE_RETRIES releituras pela mesma divergência');
  assertNoConversion(renders, 'a divergência persistente não vira prova (a R3.1 mostrava R$ 11.360,00 depois das releituras)');
  const updating = latest() as Failed;
  assert.deepEqual([updating.status, updating.message], ['error', ESTIMATE_UPDATING], '"em atualização" com "Tentar de novo"');
  await elapse(w, time, 600_000);
  assertNoConversion(renders, 'nem muito depois');
  w.basisSkew = {};
  act(() => (latest() as Failed).retry());
  await drive(time, () => incomeOf(latest()) === 1_106_000, 'sem a anomalia, a estimativa provada');
  await settle(60);
  assertUpdatingOr(renders, [1_106_000], 'só "calculando", "em atualização" e a estimativa provada');
});

test('R3.2: o estado legitimamente indisponível (série sem bloco exato, como na reconstrução pendente) aparece como está, sem conversão, mesmo sem retorno do servidor', async () => {
  const w = world();
  standard(w);
  w.seriesStatus = 'unavailable';
  w.autoListen = false;
  const {renders, latest} = mount(w, params({excludedIds: []}));
  await until(() => latest()?.status === 'done', 'o estado indisponível');
  await settle(60);
  const done = latest() as Done;
  assert.deepEqual([done.estimate.status, (done.estimate as {reason?: string}).reason], ['unavailable', 'report_unavailable'], 'indisponível, com o motivo');
  assert.ok(renders.every((render) => incomeOf(render.state) === null), 'nada converte');
});

// ------------------------------------------------------------------ P5-F.1-R3.2 (ADV-01 e F-08): o estado indisponível

/*
 * P5-F.1-R3.2. A estimativa indisponível SEM números das bases (renda PJ sem a confirmação da receita empresarial, o
 * relatório sem bloco exato: o motivo sai antes de qualquer receita) não converte e aparece como está, com o motivo,
 * sem depender da confirmação do servidor: sem retorno do servidor, com a escuta encerrada, sem conexão e com a
 * divergência persistente, em toda janela (ADV-01 da revisão adversarial: "preservar estados legitimamente
 * indisponíveis"). A indisponível COM a memória de cálculo preenchida (rotina sem horas, nenhuma renda na janela, os
 * limites) traz os meses, as receitas e as desconsideradas das mesmas leituras da conversão e espera a mesma prova: sem
 * ela, os números podiam vir de um estado misto ou de uma base divergente, e o motivo podia ser falso (F-08 da revisão
 * financeira; ADV-R2-01 da adversarial). A de rotinas ou véspera reduzida ambíguas não traz números, mas o motivo
 * depende de quais meses têm renda, e espera também (ADV-R3-01 da adversarial, rodada 3). Só os motivos decididos antes
 * de qualquer receita (`DECIDED_BEFORE_INCOME`) aparecem sem prova. Na rodada 1, toda indisponível passava sem prova; na
 * rodada 2, a de rotinas ambíguas também.
 */
const NO_HOURS: WorkCalendar = {routines: [], worksOnHolidays: false, localHolidays: [], exceptions: []};
const unavailableOf = (state: IncomeEstimateState | undefined) =>
  state?.status === 'done' && state.estimate.status === 'unavailable' ? state.estimate.reason : null;
/** A renderização mostra números das bases: a conversão ou a memória de cálculo preenchida de uma indisponível. */
const figuresOf = (state: IncomeEstimateState | undefined) =>
  state?.status === 'done' && (state.estimate.status === 'ready' || state.estimate.months.length > 0);
/** Depois de calculado, só o indisponível com o motivo: nada de "calculando", "em atualização", erro nem conversão. */
const assertOnlyUnavailable = (renders: readonly Render[], reason: string, message: string) => {
  const other = renders.filter((render) => unavailableOf(render.state) !== reason);
  assert.deepEqual(
    other.map((render) => render.state.status === 'error' ? render.state.message : `${render.state.status} ${incomeOf(render.state)}`),
    [],
    `${message} (mostrados: ${shownSoFar()})`,
  );
};
/** Nenhuma renderização com números das bases: nem a conversão, nem o indisponível com a memória de cálculo preenchida. */
const assertNoFigures = (renders: readonly Render[], message: string) => {
  const shown = renders.filter((render) => figuresOf(render.state));
  assert.deepEqual(
    shown.map((render) => `${unavailableOf(render.state) ?? 'pronta'} ${(render.state as Done).estimate.incomeCents}`),
    [],
    `${message} (mostrados: ${shownSoFar()})`,
  );
};
/** Outubro com a receita r500 (R$ 500,00), desconsiderável, na janela de 12 meses. */
const twelveWithR500 = (w: World) => {
  twelve(w);
  w.write('ws-a', 'r500', {date: '2026-10-15', type: 'receita', valueCents: 50_000, isPaid: true});
  w.apply('ws-a', ['r500']);
};
/** A fonte é um espaço PJ, e a receita empresarial não foi confirmada: o motivo sai antes de qualquer receita. */
const asBusiness = (setup: (w: World) => void) => (w: World) => {
  setup(w);
  w.workspaceType = 'PJ';
};

const WITHOUT_FIGURES = [
  {label: 'renda PJ sem confirmação', reason: 'business_not_confirmed', setup: asBusiness(standard)},
  {label: 'relatório sem bloco exato', reason: 'report_unavailable', setup: (w: World) => { standard(w); w.seriesStatus = 'unavailable'; }},
] as const;
for (const item of WITHOUT_FIGURES) {
  for (const condition of ['sem retorno do servidor', 'com a escuta encerrada desde o começo', 'com a divergência persistente'] as const) {
    test(`R3.2 (ADV-01): indisponível sem números (${item.label}; uma base, nenhuma desconsiderada), ${condition}: aparece como está, com o motivo, sem conversão, nem passado o tempo de interface; a ressalva de leitura anterior só com a escuta encerrada`, async () => {
      const w = world();
      const time = manualClock(w);
      item.setup(w);
      if (condition === 'sem retorno do servidor') w.autoListen = false;
      if (condition === 'com a escuta encerrada desde o começo') w.listenRefused = true;
      // A série traz R$ 300,00 a mais em setembro do que a projeção: a base nunca a alcança.
      if (condition === 'com a divergência persistente') w.basisSkew['ws-a'] = {'2026-09': 30_000};
      const {renders, latest} = mount(w, params({excludedIds: []}));
      await drive(time, () => unavailableOf(latest()) === item.reason, 'o indisponível, com o motivo', 60);
      const from = renders.findIndex((render) => unavailableOf(render.state) === item.reason);
      for (let step = 0; step < 30; step += 1) { time.advance(30); await settle(30); }
      time.advance(2_000);
      await settle(100);
      assertOnlyUnavailable(renders.slice(from), item.reason, 'depois de calculado, só o indisponível (antes do ADV-01: "calculando", "em atualização" ou o erro)');
      assert.ok(renders.every((render) => incomeOf(render.state) === null), 'nada converte');
      // A ressalva de leitura anterior acompanha o motivo com a escuta encerrada (PT-R32-08 da revisão pt-BR).
      assert.equal((latest() as Done).refreshFailed, condition === 'com a escuta encerrada desde o começo', 'a ressalva só com a escuta encerrada');
    });
  }
}

for (const variant of [
  {label: '3 meses, sem desconsiderada', setup: asBusiness(standard), patch: {excludedIds: [] as string[]}},
  {label: '12 meses, com desconsiderada', setup: asBusiness(twelveWithR500), patch: {historyMonths: 12 as const, excludedIds: ['r500']}},
] as const) {
  for (const condition of ['sem conexão', 'com a escuta encerrada', 'com a divergência persistente'] as const) {
    test(`R3.2 (ADV-01): renda PJ sem confirmação, ${variant.label}, ${condition} depois do primeiro retorno do servidor: o indisponível sem números continua como está, com o motivo, sem conversão; a ressalva só com a escuta encerrada`, async () => {
      const w = world();
      const time = manualClock(w);
      variant.setup(w);
      const {renders, latest} = mount(w, params(variant.patch));
      await drive(time, () => unavailableOf(latest()) === 'business_not_confirmed' && w.log.includes('projeção'), 'o indisponível, com o primeiro retorno do servidor', 60);
      await settle(100);
      const from = renders.length;
      if (condition === 'sem conexão') w.goOffline();
      if (condition === 'com a escuta encerrada') w.failListen();
      if (condition === 'com a divergência persistente') {
        // Outra sessão: a projeção de setembro sobe R$ 100,00, e a série continua trazendo o valor antigo.
        w.income['ws-a']['2026-09'] += 10_000;
        w.basisSkew['ws-a'] = {'2026-09': -10_000};
        w.publish();
      }
      // As releituras e a sincronização correm no relógio manual.
      for (let step = 0; step < 30; step += 1) { time.advance(30); await settle(40); }
      time.advance(2_000);
      await settle(100);
      assertOnlyUnavailable(renders.slice(from), 'business_not_confirmed', `${condition}: só o indisponível`);
      assert.ok(renders.every((render) => incomeOf(render.state) === null), 'nada converte');
      // Sem conexão, as leituras não falham (ninguém relê): a ressalva não aparece só pela queda (PT-R32-08).
      assert.equal((latest() as Done).refreshFailed, condition === 'com a escuta encerrada', 'a ressalva só com a escuta encerrada');
    });
  }
}

/*
 * Segunda 20:00–06:00 e terça 00:00–08:00, como o teste S01 de `work-time-estimate.test.ts`; segunda 03/08/2026
 * reduzida a 8 h: a terça 04/08 fica sem cálculo seguro (`ambiguous_reduced_eve`). Setembro e outubro, sem exceção,
 * têm horas e nenhum dia ambíguo. No modo habitual, agosto só entra na janela com renda em agosto: o motivo depende das
 * receitas (ADV-R3-01 da revisão adversarial, rodada 3; as sondas R3-P1 a R3-P4 dela).
 */
const NIGHT_ROUTINE = {kind: 'weekly' as const, days: [0, 1, 2, 3, 4, 5, 6].map((index) => (
  index === 0 ? {kind: 'window' as const, start: 1200, end: 360, breakMinutes: 0}
    : index === 1 ? {kind: 'window' as const, start: 0, end: 480, breakMinutes: 0} : {kind: 'off' as const}))};
const AMBIGUOUS_AUGUST: WorkCalendar = {
  routines: [NIGHT_ROUTINE], worksOnHolidays: true, localHolidays: [],
  exceptions: [{kind: 'reduced', start: '2026-08-03', end: '2026-08-03', minutes: 480}],
};
/** Agosto com renda: o motivo do estado confirmado é a véspera reduzida ambígua. */
const augustWithIncome = (w: World) => {
  w.income['ws-a'] = {'2026-08': 30_000, '2026-09': 352_000, '2026-10': 352_000, '2026-11': 100_000};
};
const ambiguousOf = (state: IncomeEstimateState | undefined) => {
  const reason = unavailableOf(state);
  return reason === 'ambiguous_routines' || reason === 'ambiguous_reduced_eve';
};

const DEPENDS_ON_INCOME = [
  {label: 'rotina sem horas', reason: 'no_work_minutes', setup: (w: World) => standard(w), patch: {calendar: NO_HOURS}},
  {
    label: 'nenhuma renda na janela', reason: 'no_income',
    setup: (w: World) => { w.income['ws-a'] = {'2026-08': 0, '2026-09': 0, '2026-10': 0, '2026-11': 0}; }, patch: {},
  },
  {label: 'véspera reduzida ambígua, sem números', reason: 'ambiguous_reduced_eve', setup: augustWithIncome, patch: {calendar: AMBIGUOUS_AUGUST}},
] as const;
for (const item of DEPENDS_ON_INCOME) {
  for (const condition of ['sem retorno do servidor', 'com a escuta encerrada desde o começo', 'com a divergência persistente'] as const) {
    test(`R3.2 (F-08, ADV-R3-01): indisponível que depende das receitas (${item.label}; uma base, nenhuma desconsiderada), ${condition}: nem o motivo nem a memória de cálculo sem a prova, como a estimativa que converte; com a prova, o indisponível com o motivo`, async () => {
      const w = world();
      const time = manualClock(w);
      item.setup(w);
      if (condition === 'sem retorno do servidor') w.autoListen = false;
      if (condition === 'com a escuta encerrada desde o começo') w.listenRefused = true;
      if (condition === 'com a divergência persistente') w.basisSkew['ws-a'] = {'2026-09': 30_000};
      const {renders, latest} = mount(w, params({excludedIds: [], ...item.patch}));
      if (condition === 'com a divergência persistente') {
        await drive(time, () => w.calls.series >= 3, 'a leitura e as duas releituras pela mesma divergência', 60);
      }
      for (let step = 0; step < 30; step += 1) { time.advance(30); await settle(30); }
      time.advance(2_000);
      await settle(100);
      if (condition === 'com a divergência persistente') assert.equal(w.calls.series, 3, 'no máximo BASIS_DIVERGENCE_RETRIES releituras');
      assertNoFigures(renders, `${condition}: nenhum número das bases sem a prova (na rodada 1, o indisponível aparecia com eles)`);
      assert.ok(renders.every((render) => unavailableOf(render.state) !== item.reason),
        `${condition}: o motivo não aparece sem a prova (na rodada 2, o de rotina ambígua aparecia; mostrados: ${shownSoFar()})`);
      const held = latest() as Failed;
      assert.deepEqual([held.status, held.message],
        ['error', condition === 'com a escuta encerrada desde o começo' ? ESTIMATE_UNCONFIRMED_FAILED : ESTIMATE_UPDATING],
        'sem a prova: o erro, ou "em atualização" passado o tempo de interface, com "Tentar de novo"');
      // A prova chega: o indisponível aparece, com o motivo e os números confirmados.
      if (condition === 'sem retorno do servidor') { w.autoListen = true; w.publish(); }
      if (condition === 'com a escuta encerrada desde o começo') { w.listenRefused = false; act(() => held.retry()); }
      if (condition === 'com a divergência persistente') { w.basisSkew = {}; act(() => held.retry()); }
      await drive(time, () => unavailableOf(latest()) === item.reason && !(latest() as Done).refreshFailed, 'o indisponível provado, com o motivo', 80);
      assert.ok(renders.every((render) => incomeOf(render.state) === null), 'nada converte');
    });
  }
}

for (const variant of [
  {label: '3 meses, sem desconsiderada', setup: (w: World) => standard(w), patch: {excludedIds: [] as string[]}},
  {label: '12 meses, com desconsiderada', setup: twelveWithR500, patch: {historyMonths: 12 as const, excludedIds: ['r500']}},
] as const) {
  for (const condition of ['sem conexão', 'com a escuta encerrada', 'com a divergência persistente'] as const) {
    test(`R3.2 (F-08): rotina sem horas, ${variant.label}, ${condition} depois do indisponível provado: o motivo e a memória de cálculo saem como a conversão sai; com a prova de volta, o indisponível provado volta`, async () => {
      const w = world();
      const time = manualClock(w);
      variant.setup(w);
      const {renders, latest} = mount(w, params({...variant.patch, calendar: NO_HOURS}));
      await drive(time, () => unavailableOf(latest()) === 'no_work_minutes' && w.log.includes('projeção'), 'o indisponível provado', 60);
      await settle(100);
      const from = renders.length;
      if (condition === 'sem conexão') w.goOffline();
      if (condition === 'com a escuta encerrada') w.failListen();
      if (condition === 'com a divergência persistente') {
        w.income['ws-a']['2026-09'] += 10_000;
        w.basisSkew['ws-a'] = {'2026-09': -10_000};
        w.publish();
      }
      for (let step = 0; step < 30; step += 1) { time.advance(30); await settle(40); }
      time.advance(2_000);
      await settle(100);
      assertNoFigures(renders.slice(from), `${condition}: nenhum número das bases sem a prova`);
      const held = latest() as Failed;
      assert.deepEqual([held.status, held.message],
        ['error', condition === 'com a escuta encerrada' ? ESTIMATE_UNCONFIRMED_FAILED : ESTIMATE_UPDATING],
        'sem a prova: o erro, ou "em atualização" passado o tempo de interface, com "Tentar de novo"');
      if (condition === 'sem conexão') w.goOnline();
      if (condition === 'com a escuta encerrada') act(() => held.retry());
      if (condition === 'com a divergência persistente') { w.basisSkew = {}; act(() => held.retry()); }
      await drive(time, () => unavailableOf(latest()) === 'no_work_minutes' && !(latest() as Done).refreshFailed, 'o indisponível provado de volta', 80);
      assert.ok(renders.every((render) => incomeOf(render.state) === null), 'nada converte');
    });
  }
}

/*
 * As sondas R2-01 a R2-03 da revisão financeira (rodada 2, F-08), com o gancho real: estados mistos e divergentes que
 * a rodada 1 mostrava na memória de cálculo de uma indisponível, ou como um motivo falso.
 */
const trail = (renders: readonly Render[], month: string) => {
  const out: string[] = [];
  for (const render of renders) {
    const state = render.state;
    let label: string;
    if (state.status !== 'done') label = state.status === 'error' ? `erro(${state.message.slice(0, 32)})` : state.status;
    else if (state.estimate.status === 'ready') label = `pronta ${state.estimate.incomeCents}${state.refreshFailed ? ' com aviso' : ''}`;
    else {
      const entry = state.estimate.months.find((item) => item.month === month);
      label = `indisponível ${state.estimate.reason} total=${state.estimate.incomeCents}` +
        (entry ? ` ${month}: oficial=${entry.receiptsCents} desconsiderada=${entry.excludedCents} elegível=${entry.eligibleCents}` : '');
    }
    if (out[out.length - 1] !== label) out.push(label);
  }
  return out.join(' → ');
};
const distinct = <T>(values: readonly (T | undefined)[]) => [...new Set(values.filter((value): value is T => value !== undefined))];
const unavailableEstimateOf = (state: IncomeEstimateState | undefined) =>
  state?.status === 'done' && state.estimate.status === 'unavailable' ? state.estimate : null;

test('R3.2 (F-08, sonda R2-01): rotina sem horas e a desconsiderada editada em outra sessão antes do gatilho: o indisponível nunca traz os números de um estado misto (R$ 800,00 tirados do total que ainda tem R$ 500,00); depois do gatilho, os números consistentes', async () => {
  const w = world();
  standard(w);
  w.stamp();
  // Outra sessão muda a desconsiderada de R$ 500,00 para R$ 800,00; o gatilho ainda não gravou outubro nem a marca.
  w.write('ws-a', 'r500', {date: '2026-10-15', type: 'receita', valueCents: 80_000, isPaid: true});
  const {renders, latest} = mount(w, params({calendar: NO_HOURS}));
  await until(() => w.calls.marks >= 1, 'a leitura das marcas');
  await settle(200);
  const before = trail(renders, '2026-10');
  // Os estados consistentes (antes e depois da edição) dão R$ 10.560,00 de elegíveis e outubro elegível em R$ 3.520,00.
  const totals = distinct(renders.map((render) => unavailableEstimateOf(render.state)?.incomeCents));
  const october = distinct(renders.map((render) => unavailableEstimateOf(render.state)?.months.find((month) => month.month === '2026-10')?.eligibleCents));
  assert.deepEqual(totals.filter((cents) => cents !== 1_056_000), [], `antes do gatilho, só o total de elegíveis consistente (mostrados: ${before})`);
  assert.deepEqual(october.filter((cents) => cents !== 352_000), [], `antes do gatilho, outubro elegível consistente (mostrados: ${before})`);
  // O gatilho aplica o valor novo: a receita de outubro e a marca mudam juntas.
  w.income['ws-a']['2026-10'] = 432_000;
  w.apply('ws-a', ['r500']);
  w.publish();
  await until(() => {
    const estimate = unavailableEstimateOf(latest());
    return estimate?.incomeCents === 1_056_000 && estimate.months.find((month) => month.month === '2026-10')?.excludedCents === 80_000;
  }, 'o indisponível do estado novo, consistente');
  assert.ok(renders.every((render) => incomeOf(render.state) === null), 'nada converte (rotina sem horas)');
});

test('R3.2 (F-08, sonda R2-02): rotina sem horas, 12 meses, divergência persistente (a base de setembro R$ 300,00 acima da projeção): o indisponível nunca traz como receita oficial o valor da base divergente', async () => {
  const w = world();
  const time = manualClock(w);
  twelve(w);
  w.basisSkew['ws-a'] = {'2026-09': 30_000};
  const {renders} = mount(w, params({excludedIds: [], historyMonths: 12, calendar: NO_HOURS}));
  await drive(time, () => w.calls.series >= 3, 'a leitura e as duas releituras pela mesma divergência', 60);
  await settle(100);
  time.advance(2_000);
  await settle(100);
  const shown = trail(renders, '2026-09');
  assert.equal(w.calls.series, 3, 'no máximo BASIS_DIVERGENCE_RETRIES releituras');
  assert.ok(renders.every((render) => incomeOf(render.state) === null), 'nada converte (rotina sem horas)');
  const september = distinct(renders.map((render) => unavailableEstimateOf(render.state)?.months.find((month) => month.month === '2026-09')?.receiptsCents));
  assert.deepEqual(september.filter((cents) => cents !== 300_000), [], `setembro só com o valor da projeção confirmada (mostrados: ${shown})`);
});

test('R3.2 (F-08, sonda R2-03): rotina com horas, um mês, a desconsiderada editada antes do gatilho até igualar o total do mês: nunca "nenhuma renda" de um estado misto; os estados consistentes estão prontos', async () => {
  const w = world();
  w.income['ws-a'] = {'2026-10': 50_000, '2026-11': 100_000};
  w.write('ws-a', 'ra', {date: '2026-10-10', type: 'receita', valueCents: 30_000, isPaid: true});
  w.write('ws-a', 'rb', {date: '2026-10-20', type: 'receita', valueCents: 20_000, isPaid: true});
  w.apply('ws-a', ['ra', 'rb']);
  w.stamp();
  // Outra sessão muda ra (desconsiderada) de R$ 300,00 para R$ 500,00; o gatilho ainda não aplicou.
  w.write('ws-a', 'ra', {date: '2026-10-10', type: 'receita', valueCents: 50_000, isPaid: true});
  const {renders, latest} = mount(w, params({historyMonths: 1, excludedIds: ['ra']}));
  await until(() => w.calls.marks >= 1, 'a leitura das marcas');
  await settle(200);
  const before = trail(renders, '2026-10');
  const reasons = distinct(renders.map((render) => unavailableOf(render.state) ?? undefined));
  assert.deepEqual(reasons, [], `antes do gatilho, nenhum indisponível: os dois estados consistentes estão prontos (mostrados: ${before})`);
  w.income['ws-a']['2026-10'] = 70_000;
  w.apply('ws-a', ['ra']);
  w.publish();
  await until(() => incomeOf(latest()) === 20_000 && !(latest() as Done).refreshFailed, 'a estimativa provada do estado novo');
});

test('R3.2 (ADV-01): da renda PJ sem confirmação (indisponível sem números, mostrado sem a confirmação) para a renda confirmada, com a escuta encerrada: a estimativa que converte não aparece sem a confirmação; com a escuta de volta, a provada', async () => {
  const w = world();
  asBusiness(standard)(w);
  w.listenRefused = true;
  const view = mount(w, params({excludedIds: [], allowBusinessIncome: false}));
  await until(() => unavailableOf(view.latest()) === 'business_not_confirmed', 'o indisponível');
  await settle(60);
  const from = view.renders.length;
  view.setParams(params({excludedIds: [], allowBusinessIncome: true}));
  await settle(120);
  assertNoConversion(view.renders.slice(from), 'com a renda confirmada e sem a confirmação do servidor, nenhuma conversão');
  const failed = view.latest() as Failed;
  assert.deepEqual([failed.status, failed.message], ['error', ESTIMATE_UNCONFIRMED_FAILED], 'o erro com "Tentar de novo"');
  w.listenRefused = false;
  act(() => failed.retry());
  await until(() => incomeOf(view.latest()) === 1_106_000 && !(view.latest() as Done).refreshFailed, 'a estimativa provada');
  assertOnlyWithoutConversionOr(view.renders.slice(from), [ESTIMATE_UNCONFIRMED_FAILED], [1_106_000], 'só o erro, "calculando" e a provada');
});

/*
 * ADV-R3-01 (revisão adversarial, rodada 3), sondas R3-P1 a R3-P3 com asserções: a rotina ambígua só em agosto, e
 * agosto entra ou sai da janela conforme a renda dele. Sem a prova, o motivo de rotina ambígua de um estado misto, do
 * cache sem conexão ou de uma base divergente nunca aparece; com a prova, vale o estado confirmado.
 */
/** A única receita de agosto é `ra` (R$ 300,00), desconsiderada: os estados consistentes tiram agosto do período. */
const augustOnlyExcluded = (w: World) => {
  w.income['ws-a'] = {'2026-08': 30_000, '2026-09': 352_000, '2026-10': 352_000, '2026-11': 100_000};
  w.write('ws-a', 'ra', {date: '2026-08-10', type: 'receita', valueCents: 30_000, isPaid: true});
  w.apply('ws-a', ['ra']);
  w.stamp();
};

test('R3.2 (ADV-R3-01, sonda R3-P1): a desconsiderada de agosto editada em outra sessão antes do gatilho, com a rotina ambígua só em agosto: o motivo de rotina ambígua do estado misto nunca aparece; depois do gatilho, a estimativa provada sem agosto', async () => {
  const w = world();
  augustOnlyExcluded(w);
  // Outra sessão muda `ra` de R$ 300,00 para R$ 100,00; o gatilho ainda não gravou agosto nem a marca.
  w.write('ws-a', 'ra', {date: '2026-08-10', type: 'receita', valueCents: 10_000, isPaid: true});
  const {renders, latest} = mount(w, params({excludedIds: ['ra'], calendar: AMBIGUOUS_AUGUST}));
  await until(() => w.calls.marks >= 1, 'a leitura das marcas', 5_000);
  await settle(300);
  assert.ok(renders.every((render) => !ambiguousOf(render.state)), `antes do gatilho, nenhum motivo de rotina ambígua (mostrados: ${shownSoFar()})`);
  assertNoConversion(renders, 'antes do gatilho, nada converte');
  // O gatilho aplica o conteúdo novo: agosto e a marca no mesmo passo.
  w.income['ws-a']['2026-08'] = 10_000;
  w.apply('ws-a', ['ra']);
  w.publish();
  await until(() => readyOf(latest()) !== null && !(latest() as Done).refreshFailed, 'a estimativa provada do estado novo', 5_000);
  await settle(100);
  assert.ok(renders.every((render) => !ambiguousOf(render.state)), `do começo ao fim, nenhum motivo de rotina ambígua (mostrados: ${shownSoFar()})`);
  assert.deepEqual((latest() as Done).estimate.months.map((month) => month.month), ['2026-09', '2026-10'], 'agosto fora do período provado');
});

test('R3.2 (ADV-R3-01, sonda R3-P2): o cache aquecido sem conexão (a única receita de agosto anulada em outra sessão com a tela fora), com a rotina ambígua só em agosto: o motivo antigo não aparece sem a prova; com a conexão de volta, a estimativa provada sem agosto', async () => {
  const w = world();
  augustWithIncome(w);
  const first = mount(w, params({excludedIds: [], calendar: AMBIGUOUS_AUGUST}));
  await until(() => unavailableOf(first.latest()) === 'ambiguous_reduced_eve' && w.log.includes('projeção'), 'o indisponível provado da primeira montagem', 5_000);
  await settle(100);
  first.unmount();
  // Com a tela fora: outra sessão anula a receita de agosto (o gatilho grava agosto com zero); a conexão cai.
  w.income['ws-a']['2026-08'] = 0;
  w.offline = true;
  const second = mount(w, params({excludedIds: [], calendar: AMBIGUOUS_AUGUST}), {client: first.client});
  await settle(1_500);
  assert.ok(second.renders.every((render) => !ambiguousOf(render.state)), `sem conexão, o motivo do cache não aparece (mostrados: ${shownSoFar()})`);
  assertNoConversion(second.renders, 'sem conexão, nada converte');
  w.goOnline();
  await until(() => readyOf(second.latest()) !== null && !(second.latest() as Done).refreshFailed, 'a estimativa provada com a conexão de volta', 5_000);
  await settle(100);
  assert.ok(second.renders.every((render) => !ambiguousOf(render.state)), 'nenhum motivo de rotina ambígua na segunda montagem');
  assert.deepEqual((second.latest() as Done).estimate.months.map((month) => month.month), ['2026-09', '2026-10'], 'agosto fora do período provado');
});

test('R3.2 (ADV-R3-01, sonda R3-P3): divergência persistente (a série traz R$ 300,00 em agosto, a projeção confirmada traz zero), com a rotina ambígua só em agosto: depois das releituras, "em atualização", nunca o motivo de rotina ambígua da base divergente', async () => {
  const w = world();
  const time = manualClock(w);
  w.income['ws-a'] = {'2026-08': 0, '2026-09': 352_000, '2026-10': 352_000, '2026-11': 100_000};
  w.basisSkew['ws-a'] = {'2026-08': 30_000};
  const {renders, latest} = mount(w, params({excludedIds: [], calendar: AMBIGUOUS_AUGUST}));
  await drive(time, () => w.calls.series >= 3, 'a leitura e as duas releituras pela mesma divergência', 60);
  for (let step = 0; step < 30; step += 1) { time.advance(30); await settle(30); }
  time.advance(2_000);
  await settle(100);
  assert.ok(renders.every((render) => !ambiguousOf(render.state)), `nenhum motivo de rotina ambígua da base divergente (mostrados: ${shownSoFar()})`);
  assertNoConversion(renders, 'nada converte');
  const held = latest() as Failed;
  assert.deepEqual([held.status, held.message], ['error', ESTIMATE_UPDATING], 'passado o tempo de interface, "em atualização" com "Tentar de novo"');
  // Sem a anomalia, o "Tentar de novo" traz o estado da projeção: pronto, sem agosto.
  w.basisSkew = {};
  act(() => held.retry());
  await drive(time, () => readyOf(latest()) !== null && !(latest() as Done).refreshFailed, 'a estimativa provada sem a anomalia', 80);
  assert.deepEqual((latest() as Done).estimate.months.map((month) => month.month), ['2026-09', '2026-10'], 'agosto fora do período provado');
});

test('R3.2 (ADV-R2-07): a escuta encerrada com a estimativa provada na tela e o tempo de interface passado: fica o erro "Não foi possível confirmar…", com "Tentar de novo", e nunca vira "em atualização"', async () => {
  const w = world();
  const time = manualClock(w);
  standard(w);
  const {renders, latest} = mount(w, params({excludedIds: []}));
  await drive(time, () => incomeOf(latest()) === 1_106_000 && !(latest() as Done).refreshFailed, 'a estimativa provada', 60);
  await settle(60);
  const from = renders.length;
  w.failListen();
  await settle(60);
  time.advance(2_000);
  await settle(100);
  assertNoConversion(renders.slice(from), 'com a escuta encerrada, nenhuma conversão');
  assert.deepEqual([latest()?.status, (latest() as Failed).message], ['error', ESTIMATE_UNCONFIRMED_FAILED], 'o erro da escuta encerrada');
  assert.ok(renders.slice(from).every((render) => !(render.state.status === 'error' && render.state.message === ESTIMATE_UPDATING)),
    'o erro não vira "em atualização" passado o tempo de interface');
});

// ------------------------------------------------------------------ P5-F.1-R3.2: queda de conexão em toda janela (ADV-03)

for (const variant of [
  {label: '12 meses, sem desconsiderada', setup: (w: World) => twelve(w), patch: {historyMonths: 12 as const, excludedIds: [] as string[]}},
  {label: '3 meses, com desconsiderada', setup: (w: World) => standard(w), patch: {excludedIds: ['r500']}},
  {label: '12 meses, com desconsiderada', setup: twelveWithR500, patch: {historyMonths: 12 as const, excludedIds: ['r500']}},
] as const) {
  test(`R3.2 (ADV-03): ${variant.label}: a conexão cai com a estimativa provada na tela: nenhuma conversão sem conexão, nem passado o tempo de interface; com a conexão de volta, sem documento mudado, a mesma conversão volta sem leitura a mais`, async () => {
    const w = world();
    const time = manualClock(w);
    variant.setup(w);
    const {renders, latest} = mount(w, params(variant.patch));
    await drive(time, () => readyOf(latest()) !== null && !(latest() as Done).refreshFailed, 'a estimativa provada', 60);
    await settle(100);
    const value = incomeOf(latest()) as number;
    const reads = {...w.calls};
    const from = renders.length;
    w.goOffline();
    await settle(60);
    time.advance(1_000);
    await settle(60);
    assertNoConversion(renders.slice(from), `${variant.label}: sem conexão, nenhuma conversão (a R3.1 mantinha ${value})`);
    assert.equal((latest() as Failed).message, ESTIMATE_UPDATING, 'passado o tempo de interface: "em atualização"');
    w.goOnline();
    assert.equal(w.lastChanges, 0, 'a volta da conexão sem documento mudado: nenhuma mudança contada, como no SDK');
    await drive(time, () => incomeOf(latest()) === value, `${variant.label}: a mesma conversão de volta`, 60);
    assert.deepEqual([w.calls.series, w.calls.month, w.calls.byIds, w.calls.marks], [reads.series, reads.month, reads.byIds, reads.marks], 'sem leitura a mais');
    assertUpdatingOr(renders.slice(from), [value], 'só "calculando", "em atualização" e a mesma estimativa confirmada');
  });
}

// ------------------------------------------------------------------ P5-F.1-R3.2: casos da revisão financeira (F-04)

test('R3.2 (F-04): a base abaixo da projeção depois das releituras (anomalia no servidor; uma base, nenhuma desconsiderada): nenhuma conversão, nem passadas as releituras e o tempo de interface; sem a anomalia, o "Tentar de novo" traz a estimativa provada', async () => {
  const w = world();
  const time = manualClock(w);
  standard(w);
  // A série traz R$ 300,00 a menos em setembro do que a projeção: a base nunca a alcança.
  w.basisSkew['ws-a'] = {'2026-09': -30_000};
  const {renders, latest} = mount(w, params({excludedIds: []}));
  await drive(time, () => w.calls.series >= 3, 'a leitura e as duas releituras pela mesma divergência', 60);
  await settle(100);
  time.advance(2_000);
  await settle(100);
  assert.equal(w.calls.series, 3, 'no máximo BASIS_DIVERGENCE_RETRIES releituras pela mesma divergência');
  assertNoConversion(renders, 'a base abaixo da projeção não vira prova (a R3.1 mostrava R$ 10.760,00 depois das releituras)');
  const updating = latest() as Failed;
  assert.deepEqual([updating.status, updating.message], ['error', ESTIMATE_UPDATING], '"em atualização" com "Tentar de novo"');
  w.basisSkew = {};
  act(() => (latest() as Failed).retry());
  await drive(time, () => incomeOf(latest()) === 1_106_000, 'sem a anomalia, a estimativa provada');
  await settle(60);
  assertUpdatingOr(renders, [1_106_000], 'só "calculando", "em atualização" e a estimativa provada');
});

test('R3.2 (F-04, ADV-08): janela do mês corrente com a desconsiderada no próprio mês: o cache aquecido não converte antes do retorno do servidor; confirmado, o mesmo valor da primeira montagem, com a desconsiderada fora', async () => {
  const w = world();
  twelve(w);
  w.write('ws-a', 'r1103', {date: '2026-11-03', type: 'receita', valueCents: 20_000, isPaid: true});
  w.apply('ws-a', ['r1103']);
  const chosen = params({excludedIds: ['r1103'], mode: 'current_month'});
  const {client, value} = await warmCache(w, chosen);
  assert.equal(value, 80_000, 'novembro sem a desconsiderada (R$ 1.000,00 − R$ 200,00)');
  w.autoListen = false;
  const {renders, latest} = mount(w, chosen, {client});
  await settle(120);
  assertNoConversion(renders, 'mês corrente com a desconsiderada: antes do retorno do servidor');
  w.publish();
  await until(() => incomeOf(latest()) === value, 'confirmado, o mesmo valor');
  await settle(60);
  assertLoadingOr(renders, [value], 'só "calculando" e a estimativa confirmada');
});

test('R3.2 (F-04): a janela ampliada e reduzida na mesma montagem: a confirmação da janela anterior não vale para a nova; nenhuma conversão até o retorno do servidor à escuta dos meses novos; confirmada, a da janela nova', async () => {
  const w = world();
  twelve(w);
  const view = mount(w, params({excludedIds: [], historyMonths: 3}));
  await until(() => readyOf(view.latest()) !== null && !(view.latest() as Done).refreshFailed, 'a de 3 meses provada');
  await settle(60);
  const three = incomeOf(view.latest()) as number;
  w.autoListen = false;
  for (const [months, label] of [[6, 'ampliada para 6 meses'], [3, 'reduzida de volta para 3 meses']] as const) {
    const from = view.renders.length;
    view.setParams(params({excludedIds: [], historyMonths: months}));
    await settle(120);
    assertNoConversion(view.renders.slice(from), `${label}: antes do retorno do servidor à escuta dos meses novos`);
    w.publish();
    await until(() => readyOf(view.latest()) !== null && !(view.latest() as Done).refreshFailed, `${label}: confirmada`);
    await settle(60);
    if (months === 3) assert.equal(incomeOf(view.latest()), three, 'de volta a 3 meses, o mesmo valor');
    assertLoadingOr(view.renders.slice(from), [incomeOf(view.latest()) as number], `${label}: só "calculando" e a confirmada`);
  }
});

const WINDOWS = [
  {label: '1 mês', patch: {historyMonths: 1}},
  {label: '3 meses', patch: {historyMonths: 3}},
  {label: '6 meses', patch: {historyMonths: 6}},
  {label: '12 meses', patch: {historyMonths: 12}},
  {label: 'mês corrente', patch: {mode: 'current_month'}},
] as const;
for (const window of WINDOWS) {
  for (const excludedIds of [[], ['r500']] as const) {
    // A desconsiderada fica em outubro: fora da janela do mês corrente.
    if (window.label === 'mês corrente' && excludedIds.length > 0) continue;
    test(`R3.2 (RR-R31-05): janela de ${window.label}, ${excludedIds.length > 0 ? 'com' : 'sem'} desconsiderada: o cache aquecido não converte antes do retorno do servidor; confirmado, o mesmo valor da primeira montagem`, async () => {
      const w = world();
      twelve(w);
      w.write('ws-a', 'r500', {date: '2026-10-15', type: 'receita', valueCents: 50_000, isPaid: true});
      w.apply('ws-a', ['r500']);
      const chosen = params({excludedIds: [...excludedIds], ...window.patch});
      const {client, value} = await warmCache(w, chosen);
      w.autoListen = false;
      const {renders, latest} = mount(w, chosen, {client});
      await settle(120);
      assertNoConversion(renders, `${window.label}: antes do retorno do servidor`);
      w.publish();
      await until(() => incomeOf(latest()) === value, `${window.label}: confirmado, o mesmo valor`);
      await settle(60);
      assertLoadingOr(renders, [value], `${window.label}: só "calculando" e a estimativa confirmada`);
    });
  }
}

// ------------------------------------------------------------------ B01: recebimento desconsiderado e estornado

const reversalFixture = JSON.parse(readFileSync(new URL('../fixtures/receivable-reversal-ids.json', import.meta.url), 'utf8')) as {
  cases: Array<{movementId: string; mirrorId: string; reversalMovementId: string; reversalMirrorId: string}>;
};
const [A, C] = reversalFixture.cases;
const receiptOf = (item: typeof A, principalCents: number) => ({
  date: '2026-10-10', type: 'receita', valueCents: principalCents, isPaid: true,
  receivableEntry: {receivableMovementId: item.movementId, reversal: false, principalCents},
});
const reversalOf = (item: typeof A, principalCents: number) => ({
  date: '2026-10-10', type: 'despesa', valueCents: principalCents, isPaid: true,
  receivableEntry: {receivableMovementId: item.reversalMovementId, reversal: true, reversalOf: item.movementId, principalCents},
});
/** Outubro com R$ 4.020,00: o recebimento A (R$ 1.000,00), o C (R$ 500,00), a receita B e outras. */
const receivables = (w: World) => {
  w.income['ws-a'] = {'2026-08': 352_000, '2026-09': 352_000, '2026-10': 402_000, '2026-11': 100_000};
  w.write('ws-a', A.mirrorId, receiptOf(A, 100_000));
  w.write('ws-a', C.mirrorId, receiptOf(C, 50_000));
  w.write('ws-a', 'tx_b', {date: '2026-10-12', type: 'receita', valueCents: 100_000, isPaid: true});
  w.apply('ws-a', [A.mirrorId, C.mirrorId, 'tx_b']);
};

for (const timing of ['depois da sincronização', 'durante a releitura por id'] as const) {
  test(`B01: o recebimento desconsiderado é estornado em outra sessão (${timing}): a exclusão perde o efeito, nunca desconta de novo`, async () => {
    const w = world();
    receivables(w);
    const {renders, latest} = mount(w, params({excludedIds: [A.mirrorId]}));
    // Agosto, setembro e outubro sem A: R$ 10.060,00.
    await until(() => incomeOf(latest()) === 1_006_000, 'estimativa sem A');
    await settle(60);
    const from = renders.length;
    if (timing === 'durante a releitura por id') {
      // Outra mudança (R$ 300,00 em setembro) põe a leitura por id em releitura, devagar.
      w.delays.byIds = 150;
      w.income['ws-a']['2026-09'] = 382_000;
      w.publish();
      await until(() => w.calls.byIds === 2, 'leitura por id em releitura');
    }
    // O estorno de A: o espelho do estorno, no mesmo mês, e outubro sem os R$ 1.000,00.
    w.write('ws-a', A.reversalMirrorId, reversalOf(A, 100_000));
    w.income['ws-a']['2026-10'] = 302_000;
    w.apply('ws-a', [A.reversalMirrorId]);
    w.publish();
    w.delays.byIds = 10;
    const expected = timing === 'durante a releitura por id' ? 1_036_000 : 1_006_000;
    await until(() => incomeOf(latest()) === expected && readyOf(latest())?.months[2]?.receiptsCents === 302_000, 'o estorno provado');
    await settle(150);
    const estimate = readyOf(latest());
    assert.equal(estimate?.months[2]?.excludedCents, 0, 'o estorno anula A: a exclusão não tira nada');
    assert.ok(estimate?.notes.some((note) => note.kind === 'exclusions_reversed'), 'a memória de cálculo diz que a exclusão perdeu o efeito');
    // Consistentes: antes do estorno (com ou sem setembro novo) e depois dele. Nunca R$ 1.000,00 a menos
    // (o estorno no total com a exclusão ainda aplicada) nem a mais (a exclusão sem efeito com o total antigo).
    const allowed = timing === 'durante a releitura por id' ? [1_006_000, 1_036_000] : [1_006_000];
    assertOnly(renders.slice(from), allowed, 'sem desconto duplo');
  });
}

test('B01: o estorno lido antes de a projeção incluí-lo nunca aparece com o total antigo (a exclusão sem efeito com A ainda somado)', async () => {
  const w = world();
  receivables(w);
  const {renders, latest} = mount(w, params({excludedIds: [A.mirrorId]}));
  await until(() => incomeOf(latest()) === 1_006_000, 'estimativa sem A');
  await settle(60);
  const from = renders.length;
  // O estorno de A é gravado; o gatilho de outubro ainda não rodou.
  w.write('ws-a', A.reversalMirrorId, reversalOf(A, 100_000));
  // Outra mudança (R$ 300,00 em setembro) faz a sincronização reler a base e, depois dela, a leitura por id,
  // que já traz o estorno; outubro na projeção ainda soma A.
  w.income['ws-a']['2026-09'] = 382_000;
  w.publish();
  await until(() => w.calls.byIds === 2, 'leitura por id relida, com o estorno');
  await settle(150);
  // O gatilho grava outubro sem A.
  w.income['ws-a']['2026-10'] = 302_000;
  w.apply('ws-a', [A.reversalMirrorId]);
  w.publish();
  await until(() => incomeOf(latest()) === 1_036_000 && readyOf(latest())?.months[2]?.receiptsCents === 302_000, 'o estorno provado');
  await settle(150);
  // Nunca R$ 11.360,00: o estorno lido (A sem efeito) com outubro ainda somando A.
  assertOnly(renders.slice(from), [1_006_000, 1_036_000], 'sem o estorno adiante da projeção');
});

test('B01: o recebimento desconsiderado sem estorno continua descontado; com dois desconsiderados, só o estornado perde o efeito', async () => {
  const w = world();
  receivables(w);
  const {renders, latest} = mount(w, params({excludedIds: [A.mirrorId, C.mirrorId]}));
  // Sem A e sem C: R$ 9.560,00.
  await until(() => incomeOf(latest()) === 956_000, 'estimativa sem A e sem C');
  await settle(60);
  assert.equal(readyOf(latest())?.months[2]?.excludedCents, 150_000);
  const from = renders.length;
  w.write('ws-a', A.reversalMirrorId, reversalOf(A, 100_000));
  w.income['ws-a']['2026-10'] = 302_000;
  w.apply('ws-a', [A.reversalMirrorId]);
  w.publish();
  await until(() => readyOf(latest())?.months[2]?.receiptsCents === 302_000, 'o estorno de A provado');
  await settle(150);
  // Outubro sem A (estornado) e sem C (ainda descontado): R$ 3.020,00 − R$ 500,00.
  assert.deepEqual([incomeOf(latest()), readyOf(latest())?.months[2]?.excludedCents], [956_000, 50_000]);
  assertOnly(renders.slice(from), [956_000], 'nunca R$ 8.560,00 (A descontado duas vezes)');
});
