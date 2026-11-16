// Sonda (revisão escala/custo P5-F.1-R3): leituras e escritas por entrega do gatilho de caixa com a função
// REAL `applyCashPeriodWriteOnce` compilada das árvores R2A (f8267922) e R3, sobre uma transação falsa que
// só conta operações (nenhuma RPC; o app do Admin SDK é inicializado com projectId fictício e nunca
// chama a rede). Mesma entrada para as duas árvores.
const path = require('node:path');
const [, , R3DIR, BASEDIR] = process.argv;
const load = (dir) => {
  const admin = require(path.join(dir, 'functions/node_modules/firebase-admin'));
  if (admin.apps.length === 0) admin.initializeApp({projectId: 'sonda-offline'});
  return {periods: require(path.join(dir, 'functions/lib/cash/periods.js')), Timestamp: require(path.join(dir, 'functions/node_modules/firebase-admin/lib/firestore/index.js')).Timestamp};
};
const r3 = load(R3DIR);
const base = load(BASEDIR);
const {Timestamp} = r3;
const at = (iso) => Timestamp.fromDate(new Date(iso));
const income = (date, valueCents, extra = {}) => ({type: 'receita', description: 'x', category: 'Salário', categoryId: 'cat_salario', valueCents, date, isPaid: true, userId: 'u', updatedAt: at('2026-11-09T12:00:00Z'), ...extra});

const fakeTx = (docs) => {
  const ops = {reads: 0, writes: 0, paths: []};
  const tx = {
    getAll: async (...refs) => { ops.reads += refs.length; return refs.map((ref) => { const d = docs[ref.path]; return {exists: d !== undefined, data: () => d, createTime: undefined, updateTime: undefined}; }); },
    get: async (ref) => { ops.reads += 1; const d = docs[ref.path]; return {exists: d !== undefined, data: () => d}; },
    set: (ref) => { ops.writes += 1; ops.paths.push('set ' + ref.path.split('/').slice(2).join('/')); return tx; },
    create: (ref) => { ops.writes += 1; ops.paths.push('create ' + ref.path.split('/').slice(2).join('/')); return tx; },
    update: (ref) => { ops.writes += 1; ops.paths.push('update ' + ref.path.split('/').slice(2).join('/')); return tx; },
    delete: (ref) => { ops.writes += 1; ops.paths.push('delete ' + ref.path.split('/').slice(2).join('/')); return tx; },
  };
  return {tx, ops};
};
const WS = 'ws-sonda';
const statePath = `workspaces/${WS}/cash_period_events/projection_state`;
const run = async (mod, {before, after, state = {}, markerExists = false, mark, eventTime = at('2026-11-09T12:00:01Z'), beforeUpdateTime}) => {
  const docs = {[statePath]: {categoryGeneration: 'g0', categoryGarbage: [], ...state}};
  if (markerExists) docs[`workspaces/${WS}/cash_period_events/ek1`] = {outcome: 'applied', periods: []};
  if (mark) docs[`workspaces/${WS}/cash_projection_marks/t1`] = mark;
  const {tx, ops} = fakeTx(docs);
  const out = await mod.periods.applyCashPeriodWriteOnce(tx, WS, 'ek1', before, after, {transactionId: 't1', action: !before ? 'CREATE' : !after ? 'DELETE' : 'UPDATE', eventTime, beforeCreateTime: before ? at('2026-01-01T00:00:00Z') : undefined, beforeUpdateTime});
  return {reads: ops.reads, writes: ops.writes, outcome: out.outcome, markBroken: out.markBroken ?? null, escritas: ops.paths};
};
const staging = {categoryStaging: {generation: 'r1', cutoff: at('2026-11-09T12:00:00Z')}};
(async () => {
  const cases = {
    'criação (g0)': {after: income('2026-11-05', 1000)},
    'edição de valor no mesmo mês (g0)': {before: income('2026-11-05', 1000), after: income('2026-11-05', 1500)},
    'edição sem efeito no caixa (só descrição)': {before: income('2026-11-05', 1000), after: income('2026-11-05', 1000, {description: 'y'})},
    'mudança de mês e de ano (g0)': {before: income('2025-12-20', 1000), after: income('2026-01-05', 1000)},
    'evento depois do corte com reconstrução em preparação': {before: income('2026-11-05', 1000), after: income('2026-11-05', 1200), state: staging, beforeUpdateTime: at('2026-11-09T11:00:00Z')},
    'reentrega (marca de entrega já existe)': {before: income('2026-11-05', 1000), after: income('2026-11-05', 1500), markerExists: true},
    'coberto pela reconstrução (commit <= corte publicado)': {before: income('2026-11-05', 1000), after: income('2026-11-05', 1500), state: {baselineCutoff: at('2026-11-09T12:00:05Z'), categoryGeneration: 'r0'}},
  };
  const rows = [];
  for (const [name, c] of Object.entries(cases)) {
    const a = await run(base, c);
    const b = await run(r3, c);
    rows.push({caso: name, R2A: `${a.reads}L/${a.writes}E`, R3: `${b.reads}L/${b.writes}E`, delta: `+${b.reads - a.reads}L/+${b.writes - a.writes}E`, outcome: b.outcome, escritasR3: b.escritas.join('; ')});
  }
  // 17º evento fora de ordem sobre uma cadeia com 16 pendências: quebra e registro no estado.
  const pend = Array.from({length: 16}, (_, i) => ({b: {k: 'alive', fp: 'f'.repeat(63) + (i % 10)}, a: {k: 'alive', fp: 'e'.repeat(63) + (i % 10)}}));
  const mark = {schemaVersion: 1, workspaceId: WS, transactionId: 't1', anchors: {}, chains: {a: {g: 'g0', cut: null, root: 'absent', base: null, node: {k: 'alive', fp: '0'.repeat(64)}, pending: pend, broken: null}}};
  const brk = await run(r3, {before: income('2026-11-05', 1), after: income('2026-11-05', 2), mark});
  rows.push({caso: '17º evento fora de ordem (cadeia vira broken)', R2A: '-', R3: `${brk.reads}L/${brk.writes}E`, delta: '-', outcome: brk.outcome, escritasR3: brk.escritas.join('; ') + ` | markBroken=${brk.markBroken}`});
  const again = await run(r3, {before: income('2026-11-05', 2), after: income('2026-11-05', 3), mark: {...mark, chains: {a: {g: 'g0', cut: null, root: null, base: null, node: null, pending: [], broken: 'pending_overflow'}}}});
  rows.push({caso: 'evento seguinte sobre cadeia já broken', R2A: '-', R3: `${again.reads}L/${again.writes}E`, delta: '-', outcome: again.outcome, escritasR3: again.escritas.join('; ') + ` | markBroken=${again.markBroken}`});
  console.log(JSON.stringify(rows, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
