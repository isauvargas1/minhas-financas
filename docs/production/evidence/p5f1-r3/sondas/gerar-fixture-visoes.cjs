// Gera tests/fixtures/projection-mark-views.json: marcas e geração -> visão, pela implementação do backend
// (markViewOf, papel "publicada", na posição onde a geração está; "a" quando não está em nenhuma).
const path = require('node:path');
const fs = require('node:fs');
const WT = process.argv[2];
const { createRequire } = require('node:module');
const freq = createRequire(path.join(WT, 'functions/package.json'));
const { Timestamp } = freq('firebase-admin/firestore');
const m = require(path.join(WT, 'functions/lib/cash/projectionMarks.js'));
const ts = (s, n = 0) => ({ __timestamp: [s, n] });
const toAdmin = (v) => Array.isArray(v) ? v.map(toAdmin) : v && typeof v === 'object' ? (Array.isArray(v.__timestamp) ? new Timestamp(v.__timestamp[0], v.__timestamp[1]) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toAdmin(x)]))) : v;
const A = 'a'.repeat(64), B = 'b'.repeat(64), C = 'c'.repeat(64), D = 'd'.repeat(64);
const g0 = { id: 'g0', cutoff: null };
const r1 = { id: 'r1', cutoff: ts(1790000000, 5000) };
const alive = (fp) => ({ k: 'alive', fp });
const chain = (g, cut, extra) => ({ g, cut, root: 'absent', base: null, node: { k: 'absent' }, pending: [], broken: null, ...extra });
const cases = [
  ['sem marca: ausente', {}, g0],
  ['criação aplicada em g0', { chains: { a: chain('g0', null, { node: alive(A) }) } }, g0],
  ['pendente em g0', { chains: { a: chain('g0', null, { node: alive(A), pending: [{ b: alive(B), a: alive(C) }] }) } }, g0],
  ['pendente absorvível', { chains: { a: chain('g0', null, { node: alive(A), pending: [{ b: alive(A), a: alive(C) }, { b: alive(C), a: { k: 'deleted' } }] }) } }, g0],
  ['quebrada', { chains: { a: { g: 'g0', cut: null, root: null, base: null, node: null, pending: [], broken: 'pending_overflow' } } }, g0],
  ['âncora sem cadeia', { anchors: { b: { g: 'r1', cut: r1.cutoff, fp: D } } }, r1],
  ['âncora e cadeia event coerentes', { anchors: { b: { g: 'r1', cut: r1.cutoff, fp: D } }, chains: { b: chain('r1', r1.cutoff, { root: 'event', base: D, node: alive(A) }) } }, r1],
  ['âncora e cadeia event de outra base', { anchors: { b: { g: 'r1', cut: r1.cutoff, fp: D } }, chains: { b: chain('r1', r1.cutoff, { root: 'event', base: C, node: alive(A) }) } }, r1],
  ['âncora depois de raiz absent', { anchors: { b: { g: 'r1', cut: r1.cutoff, fp: D } }, chains: { b: chain('r1', r1.cutoff, { node: alive(A) }) } }, r1],
  ['âncora e cadeia sem raiz', { anchors: { b: { g: 'r1', cut: r1.cutoff, fp: D } }, chains: { b: { g: 'r1', cut: r1.cutoff, root: null, base: null, node: null, pending: [{ b: alive(D), a: alive(B) }], broken: null } } }, r1],
  ['publicada sem âncora com raiz event', { chains: { b: chain('r1', r1.cutoff, { root: 'event', base: D, node: alive(A) }) } }, r1],
  ['publicada sem âncora e sem raiz', { chains: { b: { g: 'r1', cut: r1.cutoff, root: null, base: null, node: null, pending: [{ b: { k: 'none' }, a: alive(A) }], broken: null } } }, r1],
  ['cadeia de g0 velha não vale para r1', { chains: { a: chain('g0', null, { node: alive(A) }) } }, r1],
  ['apagado', { chains: { a: chain('g0', null, { node: { k: 'deleted' } }) } }, g0],
  ['criação pendente sobre nó vivo não é absorvida', { chains: { a: chain('g0', null, { node: alive(A), pending: [{ b: { k: 'none' }, a: alive(B) }] }) } }, g0],
  ['âncora com criação pendente não absorvida', { anchors: { b: { g: 'r1', cut: r1.cutoff, fp: D } }, chains: { b: { g: 'r1', cut: r1.cutoff, root: null, base: null, node: null, pending: [{ b: { k: 'none' }, a: alive(B) }], broken: null } } }, r1],
  ['criação pendente sobre apagado é absorvida', { chains: { a: chain('g0', null, { node: { k: 'deleted' }, pending: [{ b: { k: 'none' }, a: alive(B) }] }) } }, g0],
  ['formato desconhecido', { chains: { a: { g: 'g0', cut: null, root: 'outro', pending: [] } } }, g0],
];
const out = { description: 'P5-F.1-R3 (B03): visão da marca de aplicação para a geração lida (papel publicada). Gerada pelo backend (functions/src/cash/projectionMarks.ts: readMarkDoc + markViewOf) e conferida pelo cliente (src/modules/work-time/projectionProof.ts: readMarkDoc + markViewFor). kind rooted traz o nó e a quantidade de pendências; broken traz o código.', cases: [] };
for (const [name, mark, gen] of cases) {
  const doc = m.readMarkDoc(toAdmin(mark));
  const slot = ['a', 'b'].find((s) => doc.anchors[s]?.g === gen.id || doc.chains[s]?.g === gen.id) ?? 'a';
  const view = m.markViewOf(doc, { id: gen.id, cutoff: toAdmin(gen.cutoff), slot, role: 'published' });
  const expected = view.kind === 'rooted' ? { kind: 'rooted', node: view.node, pending: view.pending.length } : view;
  out.cases.push({ name, mark, generation: gen, expected });
}
fs.writeFileSync(path.join(WT, 'tests/fixtures/projection-mark-views.json'), JSON.stringify(out, null, 2) + '\n');
for (const c of out.cases) console.log(JSON.stringify(c.expected), '-', c.name);
