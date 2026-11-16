import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { monthDateRange, readFirstAccepted, readPagedWindow } from '../../src/modules/transactions/paging.ts';

/**
 * P5-GATE-FINAL (FIRESTORE-01) — leituras de lançamentos do cliente sem a janela de 12 meses.
 *
 * Antes, a carga do aplicativo lia até 40 páginas de 500 lançamentos dos últimos 12 meses (até 20.000
 * documentos) em qualquer tela e a cada mutação; o Dashboard mostrava 9 deles e a lista de Receitas ou
 * Despesas filtrava o mês no navegador. Agora:
 *
 * - "Transações Recentes" lê só as 9 mais recentes (`readFirstAccepted`, páginas de 10, teto de 10 páginas),
 *   na mesma ordem de antes (`date` desc, id desc), pulando anuladas e fora do contrato;
 * - a lista do mês lê só o tipo e o mês pedidos (`monthDateRange`), por cursor até o fim (`readPagedWindow`).
 *
 * Aqui: equivalência com o resultado antigo em dados aleatórios (semente fixa), paginação sem repetição nem
 * omissão, teto e aviso, volume alto e contagem de documentos lidos. A forma real das consultas no Emulator
 * (Rules, ordem e cursor do Firestore) está em `tests/firestore/transactions-reads-p5gate.rules.integration.test.mjs`.
 */

type Type = 'receita' | 'despesa' | 'investimento';
interface Doc { id: string; type: Type; date: string; valueCents: number; voided: boolean; valid: boolean }

const WANTED = 9;
const RECENT_PAGE = 10;
const RECENT_MAX_PAGES = 10;
const MONTH_PAGE = 500;
const MONTH_MAX_PAGES = 40;
const SINCE = '2025-11-01';

/** Gerador determinístico (mulberry32): os dados de cada caso se repetem a cada execução. */
const prng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const dayKey = (base: Date, offsetDays: number) =>
  new Date(base.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const dataset = (seed: number, size: number, voidedRate = 0.1, invalidRate = 0.03): Doc[] => {
  const random = prng(seed);
  const base = new Date('2026-11-15T12:00:00Z');
  const types: Type[] = ['receita', 'despesa', 'investimento'];
  return Array.from({ length: size }, (_, index) => ({
    // Ids com o mesmo dia de propósito: o desempate pelo id precisa valer.
    id: `tx-${String(Math.floor(random() * 1e6)).padStart(6, '0')}-${index}`,
    type: types[Math.floor(random() * types.length)],
    // De 20 meses atrás até 1 mês à frente (lançamento com data futura conta como mais recente).
    date: dayKey(base, Math.floor(random() * 640) - 610),
    valueCents: Math.floor(random() * 1_000_000),
    voided: random() < voidedRate,
    valid: random() >= invalidRate,
  }));
};

/** A ordem das consultas: `date` desc e, no empate, id desc (como `orderBy(documentId(), 'desc')`). */
const byDateThenIdDesc = (a: Doc, b: Doc) =>
  a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id === b.id ? 0 : a.id < b.id ? 1 : -1;

/** Fonte em memória com cursor; registra cada página pedida. */
const querySource = (docs: Doc[], where: (doc: Doc) => boolean) => {
  const ordered = docs.filter(where).sort(byDateThenIdDesc);
  const pages: Array<{ after: string | undefined; limitCount: number; returned: number }> = [];
  const readPage = async (after: Doc | undefined, limitCount: number) => {
    const start = after === undefined ? 0 : ordered.indexOf(after) + 1;
    const page = ordered.slice(start, start + limitCount);
    pages.push({ after: after?.id, limitCount, returned: page.length });
    return page;
  };
  return { ordered, pages, readPage };
};

const accept = (doc: Doc) => (doc.voided || !doc.valid ? null : doc);

/** O que o widget mostrava antes: janela inteira, anuladas e inválidas fora, filtro, ordem por data, 9 primeiras. */
const legacyRecent = (docs: Doc[], filter: Type | null) => {
  const window = docs.filter((doc) => doc.date >= SINCE).sort(byDateThenIdDesc);
  const shown = window.filter((doc) => !doc.voided && doc.valid);
  const items = shown.filter((doc) => filter === null || doc.type === filter).slice(0, WANTED);
  return { items, reads: window.length };
};

const recent = (docs: Doc[], filter: Type | null) => {
  const source = querySource(docs, (doc) => doc.date >= SINCE && (filter === null || doc.type === filter));
  return readFirstAccepted(source.readPage, accept, WANTED, RECENT_PAGE, RECENT_MAX_PAGES)
    .then((result) => ({ ...result, source }));
};

// ------------------------------------------------------------ Transações Recentes

test('recentes: em 300 conjuntos aleatórios e nos 4 filtros, as mesmas 9, na mesma ordem, que a janela de 12 meses mostrava', async () => {
  for (let seed = 1; seed <= 300; seed += 1) {
    const docs = dataset(seed, 20 + (seed % 7) * 37);
    for (const filter of [null, 'receita', 'despesa', 'investimento'] as const) {
      const result = await recent(docs, filter);
      assert.equal(result.truncated, false, `semente ${seed}, filtro ${filter}: não truncada`);
      assert.deepEqual(result.items.map((doc) => doc.id), legacyRecent(docs, filter).items.map((doc) => doc.id),
        `semente ${seed}, filtro ${filter ?? 'todas'}`);
    }
  }
});

test('recentes: anuladas e inconsistentes espalhadas entre páginas não repetem nem omitem nenhuma das 9', async () => {
  // 30 lançamentos no mesmo dia; as anuladas caem nas bordas das páginas de 10.
  const docs: Doc[] = Array.from({ length: 30 }, (_, index) => ({
    id: `tx-${String(index).padStart(2, '0')}`, type: 'despesa', date: '2026-11-10', valueCents: index,
    voided: [29, 28, 20, 19, 10, 9].includes(index), valid: index !== 21,
  }));
  const result = await recent(docs, null);
  const expected = docs.filter((doc) => !doc.voided && doc.valid).sort(byDateThenIdDesc).slice(0, WANTED);
  assert.deepEqual(result.items.map((doc) => doc.id), expected.map((doc) => doc.id));
  assert.equal(new Set(result.items.map((doc) => doc.id)).size, WANTED, 'sem repetição');
  assert.deepEqual(result.source.pages.map((page) => page.after), [undefined, 'tx-20'], 'cursor no último da página anterior');
  assert.equal(result.reads, 20);
});

test('recentes: menos de 9 no período mostra só as que existem, sem aviso; a consulta para na página curta', async () => {
  const docs = dataset(7, 5, 0, 0).map((doc) => ({ ...doc, date: '2026-10-01' }));
  const result = await recent(docs, null);
  assert.equal(result.items.length, 5);
  assert.equal(result.truncated, false);
  assert.equal(result.source.pages.length, 1);
});

test('recentes: com o teto de páginas esgotado antes das 9, volta truncada (a tela avisa) e lê no máximo 100', async () => {
  const docs: Doc[] = Array.from({ length: 150 }, (_, index) => ({
    id: `tx-${String(index).padStart(3, '0')}`, type: 'receita', date: '2026-11-01', valueCents: 1,
    voided: index >= 5, valid: true,
  }));
  const result = await recent(docs, null);
  assert.equal(result.truncated, true);
  assert.equal(result.reads, RECENT_PAGE * RECENT_MAX_PAGES);
  assert.ok(result.items.length < WANTED);
});

test('recentes, volume alto: com 20.000 lançamentos na janela, o widget lê 10 documentos; a carga antiga lia 20.000', async () => {
  const docs = dataset(42, 20_000, 0, 0).map((doc) => ({ ...doc, date: doc.date < SINCE ? '2026-06-01' : doc.date }));
  const result = await recent(docs, null);
  assert.equal(result.reads, RECENT_PAGE);
  assert.equal(result.source.pages.length, 1);
  const legacy = legacyRecent(docs, null);
  assert.equal(legacy.reads, 20_000);
  assert.deepEqual(result.items.map((doc) => doc.id), legacy.items.map((doc) => doc.id));
});

// ------------------------------------------------------------ lista do mês

test('mês: todo dia válido do mês cabe no intervalo e nenhum dia de outro mês cabe (1999–2101)', () => {
  for (let year = 1999; year <= 2101; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      const { since, until } = monthDateRange(key);
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      for (let day = 1; day <= last; day += 1) {
        const date = `${key}-${String(day).padStart(2, '0')}`;
        assert.ok(since <= date && date <= until, date);
      }
      const before = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
      const after = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      assert.ok(before < since, `${before} fora de ${key}`);
      assert.ok(after > until, `${after} fora de ${key}`);
    }
  }
});

test('mês: chave fora do formato AAAA-MM é recusada antes de qualquer consulta', () => {
  for (const key of ['2026-13', '2026-00', '2026-1', '26-01', '2026-01-01', '', '2026/01']) {
    assert.throws(() => monthDateRange(key), /Mês inválido/, key);
  }
});

/** O que a lista mostrava antes: janela de 12 meses, anuladas e inválidas fora, mês do Header e tipo da tela. */
const legacyMonth = (docs: Doc[], month: string, type: 'receita' | 'despesa') =>
  docs.filter((doc) => doc.date >= SINCE).sort(byDateThenIdDesc)
    .filter((doc) => !doc.voided && doc.valid && doc.date.slice(0, 7) === month && doc.type === type);

const monthList = async (docs: Doc[], month: string, type: 'receita' | 'despesa') => {
  const { since, until } = monthDateRange(month);
  const source = querySource(docs, (doc) => doc.type === type && doc.date >= since && doc.date <= until);
  const { docs: read, truncated } = await readPagedWindow(source.readPage, MONTH_PAGE, MONTH_MAX_PAGES);
  return {
    items: read.filter((doc) => !doc.voided && doc.valid),
    invalidCount: read.filter((doc) => !doc.voided && !doc.valid).length,
    truncated,
    reads: source.pages.reduce((sum, page) => sum + page.returned, 0),
  };
};

test('mês: nos meses dentro da janela, o mesmo conjunto, na mesma ordem, que o filtro antigo no navegador', async () => {
  const docs = dataset(11, 6_000);
  for (const month of ['2025-11', '2026-02', '2026-07', '2026-11', '2026-12']) {
    for (const type of ['receita', 'despesa'] as const) {
      const result = await monthList(docs, month, type);
      assert.equal(result.truncated, false);
      assert.deepEqual(result.items.map((doc) => doc.id), legacyMonth(docs, month, type).map((doc) => doc.id), `${month} ${type}`);
    }
  }
});

test('mês mais antigo que a janela: antes aparecia vazio; agora vem completo', async () => {
  const docs = dataset(12, 4_000);
  const month = '2025-06';
  const expected = docs.filter((doc) => doc.date.slice(0, 7) === month && doc.type === 'despesa' && !doc.voided && doc.valid);
  assert.ok(expected.length > 0);
  assert.deepEqual(legacyMonth(docs, month, 'despesa'), []);
  assert.deepEqual((await monthList(docs, month, 'despesa')).items.map((doc) => doc.id).sort(), expected.map((doc) => doc.id).sort());
});

test('mês, volume alto: 1.203 despesas no mês em 3 páginas, sem repetição nem omissão; as demais nem são lidas', async () => {
  const docs: Doc[] = [];
  for (let index = 0; index < 1_203; index += 1) {
    docs.push({ id: `d-${String(index).padStart(5, '0')}`, type: 'despesa', date: `2026-10-${String(1 + (index % 31)).padStart(2, '0')}`,
      valueCents: index, voided: index % 97 === 0, valid: index % 101 !== 0 });
  }
  // 18.000 lançamentos de outros meses e tipos na janela: a carga antiga leria todos.
  for (let index = 0; index < 18_000; index += 1) {
    docs.push({ id: `o-${index}`, type: index % 2 ? 'receita' : 'investimento', date: '2026-10-05', valueCents: 1, voided: false, valid: true });
  }
  const result = await monthList(docs, '2026-10', 'despesa');
  const expected = docs.filter((doc) => doc.type === 'despesa' && !doc.voided && doc.valid);
  assert.equal(result.items.length, expected.length);
  assert.equal(new Set(result.items.map((doc) => doc.id)).size, expected.length, 'sem repetição');
  assert.deepEqual(result.items.map((doc) => doc.id), [...expected].sort(byDateThenIdDesc).map((doc) => doc.id), 'ordem estável');
  assert.equal(result.invalidCount, docs.filter((doc) => doc.type === 'despesa' && !doc.voided && !doc.valid).length);
  // Só as despesas do mês, mais o documento de sonda de cada página cheia (relido no início da seguinte).
  assert.equal(result.reads, 1_203 + 2, 'lê só as despesas do mês');
  assert.equal(result.truncated, false);
});

test('mês acima do teto: 20.001 do mesmo tipo voltam truncadas (o aviso da tela está na guarda FIRESTORE-08), com 20.040 lidas', async () => {
  const docs: Doc[] = Array.from({ length: MONTH_PAGE * MONTH_MAX_PAGES + 1 }, (_, index) => ({
    id: `d-${String(index).padStart(6, '0')}`, type: 'receita', date: '2026-10-10', valueCents: 1, voided: false, valid: true,
  }));
  const result = await monthList(docs, '2026-10', 'receita');
  assert.equal(result.truncated, true);
  assert.equal(result.items.length, MONTH_PAGE * MONTH_MAX_PAGES);
  // 40 páginas de 500 mais o documento de sonda de cada uma: o teto real de leitura da lista.
  assert.equal(result.reads, MONTH_PAGE * MONTH_MAX_PAGES + MONTH_MAX_PAGES);
});

// ------------------------------------------------------------ guardas do código

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('guarda: a carga do aplicativo não lê lançamentos; a lista lê o mês só com a tela aberta', () => {
  const app = read('src/App.tsx');
  assert.doesNotMatch(app, /useTransactions\(|getTransactions\b|isSameMonthYear/);
  assert.match(app, /useMonthTransactions\(\s*workspaceId, monthKey, view === 'receita' \|\| view === 'despesa' \? view : null,\s*\)/);
  assert.match(app, /<RecentTransactions onNewTransaction=\{openFullTransactionModal\} \/>/);
  const hooks = read('src/modules/transactions/hooks.ts');
  assert.match(hooks, /enabled: isWorkspaceReady\(workspaceId\) && type !== null,/);
  // Sob o prefixo que a mutação relê (`invalidateTransactionReads`), fora das leituras de receitas.
  assert.match(hooks, /\["transactions", workspaceId, "month", monthKey, type\] as const/);
  assert.match(hooks, /\["transactions", workspaceId, "recent", type \?\? "todas"\] as const/);
  assert.doesNotMatch(hooks, /export const useTransactions\b/);
  // O filtro do mês no navegador saiu com a janela de 12 meses: o auxiliar que ele usava não existe mais (gate final).
  assert.doesNotMatch(read('src/utils/date.ts'), /isSameMonthYear/);
  // FIRESTORE-10: a prévia da Personalização (com `previewTransactions`) não consulta o Firestore.
  assert.match(hooks, /enabled: \(options\.enabled \?\? true\) && isWorkspaceReady\(workspaceId\),/);
  assert.match(read('src/components/RecentTransactions.tsx'), /useRecentTransactions\([^)]*\{\s*enabled: previewTransactions === undefined,\s*\}\)/);
});

test('guarda: as consultas de lista do módulo têm limite, cursor e ordem determinística', () => {
  const api = read('src/modules/transactions/api.ts');
  assert.doesNotMatch(api, /getTransactionWindow|export const getTransactions\b/);
  const queries = api.split('query(\n      txCol(workspaceId),').slice(1);
  assert.equal(queries.length, 2, 'recentes e janela paginada');
  for (const shape of queries) {
    const body = shape.slice(0, shape.indexOf('))'));
    assert.match(body, /orderBy\("date", "desc"\),\s*orderBy\(documentId\(\), "desc"\),\s*\.\.\.\(after \? \[startAfter\(after\)\] : \[\]\),\s*limit\(limitCount\),/);
  }
  assert.match(api, /\.\.\.\(type \? \[where\("type", "==", type\)\] : \[\]\),\s*where\("date", ">=", since\),/);
  assert.match(api, /RECENT_TRANSACTIONS_COUNT,\s*RECENT_TRANSACTIONS_PAGE_SIZE,\s*RECENT_TRANSACTIONS_MAX_PAGES,/);
  assert.match(api, /return pagedWindow\(workspaceId, where\("type", "==", type\), since, until, MAX_TRANSACTION_PAGES\);/);
  assert.match(api, /export const RECENT_TRANSACTIONS_COUNT = 9;/);
  assert.match(api, /export const RECENT_TRANSACTIONS_PAGE_SIZE = 10;/);
  assert.match(api, /export const RECENT_TRANSACTIONS_MAX_PAGES = 10;/);
  // FIRESTORE-08 (2ª rodada): os tetos da lista do mês são os do modelo acima (páginas de 500, até 40), e a janela
  // paginada filtra o mês pelos dois lados e usa os dois tetos.
  assert.match(api, /export const TRANSACTION_PAGE_SIZE = 500;/);
  assert.match(api, /export const MAX_TRANSACTION_PAGES = 40;/);
  assert.equal(MONTH_PAGE, 500);
  assert.equal(MONTH_MAX_PAGES, 40);
  const paged = api.slice(api.indexOf('const pagedWindow = async ('), api.indexOf('export const getIncomeWindow'));
  assert.match(paged, /filter,\s*where\("date", ">=", since\),\s*where\("date", "<=", until\),\s*orderBy\("date", "desc"\),/);
  assert.match(paged, /\)\)\)\.docs,\s*TRANSACTION_PAGE_SIZE,\s*maxPages,\s*\);/);
  assert.match(paged, /return \{ items, truncated, invalidCount \};/);
});

test('guarda (FIRESTORE-08): o teto de leitura chega às telas; lista curta, carregando ou com falha nunca aparece como completa', () => {
  const hooks = read('src/modules/transactions/hooks.ts');
  assert.equal(hooks.match(/isTruncated: queryResult\.data\?\.truncated === true,/g)?.length, 2, 'lista do mês e widget');
  const app = read('src/App.tsx');
  assert.match(app, /isTruncated=\{monthTransactions\.isTruncated\}/);
  assert.match(app, /invalidCount=\{monthTransactions\.invalidCount\}/);
  assert.match(app, /loadState=\{monthTransactions\.isError\s*\? 'error'\s*: monthTransactions\.data === undefined \? 'loading' : 'ready'\}/);
  const list = read('src/components/TransactionsView.tsx');
  assert.match(list, /\{loadState === 'ready' && isTruncated && \([\s\S]{0,600}?Este mês tem mais lançamentos do que a lista consegue carregar: a lista, o total e a média não incluem todos\./);
  const widget = read('src/components/RecentTransactions.tsx');
  assert.match(widget, /\{!recent\.isError && recent\.isTruncated && \([\s\S]{0,600}?Não foi possível reunir as \{RECENT_TRANSACTIONS_COUNT\} mais recentes: veja a lista completa em Receitas ou Despesas\./);
});

test('guarda: o widget diz que a ordenação vale só para as 9 e não apresenta lista curta ou falha como completa', () => {
  const widget = read('src/components/RecentTransactions.tsx');
  assert.match(widget, /Mostra até as \{RECENT_TRANSACTIONS_COUNT\} mais recentes dos últimos 12 meses\. Ordenar por coluna reorganiza só as exibidas\./);
  // PTBR2-05: enquanto a consulta do filtro carrega, a tabela diz que está carregando (não fica vazia).
  assert.match(widget, /\{previewTransactions === undefined && recent\.isPending && \([\s\S]{0,300}?Carregando transações recentes…/);
  assert.match(widget, /useRecentTransactions\(activeWorkspace\?\.id \?\? '', filter === 'todas' \? null : filter,/);
  assert.match(widget, /Não foi possível carregar as transações recentes\./);
  assert.match(widget, /Não foi possível reunir as \{RECENT_TRANSACTIONS_COUNT\} mais recentes/);
  assert.doesNotMatch(widget, /transactions: Transaction\[\]/);
  const list = read('src/components/TransactionsView.tsx');
  assert.match(list, /\{loadState === 'ready' && sortedTransactions\.map\(/);
  assert.match(list, /\{loadState === 'ready' && sortedTransactions\.length === 0 && \(/);
  assert.match(list, /Este mês tem mais lançamentos do que a lista consegue carregar/);
  assert.match(list, /não exibidos neste mês\./);
  assert.doesNotMatch(list, /meses carregados/);
});
