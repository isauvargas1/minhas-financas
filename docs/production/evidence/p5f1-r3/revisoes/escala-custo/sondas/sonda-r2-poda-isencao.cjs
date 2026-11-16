// Sonda da rodada 2 (escala/custo P5-F.1-R3): tamanho da marca com a poda (`pruneMarkDoc`) e cobertura das
// isenções de índice de campo único, com as funções REAIS compiladas da árvore congelada 377c2f3f.
// Sem rede, sem Firebase. Mesmas fórmulas de tamanho da rodada 1 (estimativa pelas regras públicas).
const path = require('node:path');
const fs = require('node:fs');
const SB = process.argv[2];
const m = require(path.join(SB, 'functions/lib/cash/projectionMarks.js'));
const {Timestamp} = require(path.join(SB, 'functions/node_modules/firebase-admin/lib/firestore/index.js'));
const str = (s) => Buffer.byteLength(s, 'utf8') + 1;
const isSentinel = (v) => v && typeof v === 'object' && v.constructor && /FieldValue|ServerTimestamp/i.test(v.constructor.name);
const valueSize = (v) => v === null || typeof v === 'boolean' ? 1 : typeof v === 'number' ? 8 : typeof v === 'string' ? str(v)
  : (v instanceof Timestamp || isSentinel(v)) ? 8 : Array.isArray(v) ? v.reduce((s, x) => s + valueSize(x), 0)
  : Object.entries(v).reduce((s, [k, x]) => s + str(k) + valueSize(x), 0);
const WS = 'a'.repeat(20), TX = 'b'.repeat(20);
const docName = str('workspaces') + str(WS) + str('cash_projection_marks') + str(TX) + 16;
const docSize = (data) => docName + Object.entries(data).reduce((s, [k, x]) => s + str(k) + valueSize(x), 0) + 32;
const hex = (n) => n.toString(16).padStart(64, '0');
const cut = Timestamp.fromMillis(Date.UTC(2026, 10, 9, 12));
const ev = (b, a) => ({before: b === null ? {k: 'none'} : {k: 'alive', fp: hex(b)}, after: a === null ? {k: 'deleted'} : {k: 'alive', fp: hex(a)}, beforeUpdateTime: null});
const g0 = {id: 'g0', cutoff: null, slot: 'a', role: 'published'};
const r1s = {id: 'b9f3c2a1-0000-4000-8000-000000000001', cutoff: cut, slot: 'b', role: 'staging'};
const r1p = {...r1s, role: 'published'};
// g0: criação + 3 edições
const doc = {anchors: {}, chains: {}};
let v = m.markViewOf(doc, g0);
for (const e of [ev(null, 1), ev(1, 2), ev(2, 3), ev(3, 4)]) v = m.applyMarkEvent(v, e, g0);
doc.chains.a = m.markChainOf(v, g0);
// preparação r1: âncora b e um evento posterior ao corte nas duas gerações
doc.anchors.b = {g: r1s.id, cut, fp: hex(4)};
for (const gen of [g0, r1s]) { let w = m.markViewOf(doc, gen); w = m.applyMarkEvent(w, ev(4, 5), gen); doc.chains[gen.slot] = m.markChainOf(w, gen); }
const during = m.pruneMarkDoc(doc, ['g0', r1s.id]);
// publicada a r1; próxima entrega: a geração vigente é a r1 e não há preparação
let w = m.markViewOf(during, r1p); w = m.applyMarkEvent(w, ev(5, 6), r1p);
const afterPub = {anchors: {...during.anchors}, chains: {...during.chains, b: m.markChainOf(w, r1p)}};
const pruned = m.pruneMarkDoc(afterPub, [r1p.id]);
const rows = [
  ['durante a preparação (vigente + preparada)', during],
  ['publicada, antes da próxima regravação', afterPub],
  ['publicada, depois da regravação com poda', pruned],
].map(([nome, d]) => ({cenario: nome, componentes: Object.keys(d.anchors).length + Object.keys(d.chains).length, bytesDocumento: docSize(m.markDocumentData(WS, TX, d))}));
// Isenções: todos os campos de topo que o gatilho e a varredura gravam precisam estar isentos.
const idx = JSON.parse(fs.readFileSync(path.join(SB, 'firestore.indexes.json'), 'utf8'));
const exempt = new Set(idx.fieldOverrides.filter((o) => o.collectionGroup === 'cash_projection_marks' && Array.isArray(o.indexes) && o.indexes.length === 0).map((o) => o.fieldPath));
const written = new Set([...Object.keys(m.markDocumentData(WS, TX, pruned)), ...Object.keys(m.markAnchorPatch(WS, TX, 'b', {g: r1s.id, cut, fp: hex(4)}))]);
const naoIsentos = [...written].filter((f) => !exempt.has(f));
const compostos = idx.indexes.filter((i) => i.collectionGroup === 'cash_projection_marks').length;
console.log(JSON.stringify({rows, camposGravados: [...written].sort(), isentos: [...exempt].sort(), naoIsentos, compostos,
  entradasAutomaticasPorMarca: naoIsentos.length === 0 ? 0 : 'há campos sem isenção'}, null, 1));
