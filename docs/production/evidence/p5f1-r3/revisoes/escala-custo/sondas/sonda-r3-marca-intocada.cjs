// Sonda da rodada 3 (escala/custo P5-F.1-R3): tamanho da marca de um lançamento que NÃO recebe evento depois
// das reconstruções (a poda só acontece na regravação pelo gatilho; a âncora da varredura é `set` com merge só
// da posição). Funções REAIS compiladas da árvore congelada 377c2f3f. Sem rede, sem Firebase. Mesmas fórmulas
// de tamanho das sondas das rodadas 1 e 2 (estimativa pelas regras públicas de storage size do Firestore).
const path = require('node:path');
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
const uuid = (n) => `b9f3c2a1-0000-4000-8000-${String(n).padStart(12, '0')}`;
// g0: criação + 3 edições (o mesmo caso "típico g0" das rodadas anteriores)
const doc = {anchors: {}, chains: {}};
let v = m.markViewOf(doc, g0);
for (const e of [ev(null, 1), ev(1, 2), ev(2, 3), ev(3, 4)]) v = m.applyMarkEvent(v, e, g0);
doc.chains.a = m.markChainOf(v, g0);
const rows = [{cenario: 'g0, sem reconstrução', componentes: 1, bytesDocumento: docSize(m.markDocumentData(WS, TX, doc))}];
// Reconstruções sucessivas, sem nenhum evento no lançamento: cada uma grava a âncora na posição da preparada
// (b, a, b, ...) por merge, como `markAnchorPatch` + `set(..., {merge: true})` em rebuild.ts.
let slot = 'b';
for (let k = 1; k <= 4; k += 1) {
  const patch = m.markAnchorPatch(WS, TX, slot, {g: uuid(k), cut, fp: hex(4)});
  doc.anchors = {...doc.anchors, ...patch.anchors};
  rows.push({cenario: `intocado depois de ${k} reconstrução(ões)`, componentes: Object.keys(doc.anchors).length + Object.keys(doc.chains).length,
    bytesDocumento: docSize(m.markDocumentData(WS, TX, doc))});
  slot = slot === 'b' ? 'a' : 'b';
}
console.log(JSON.stringify({rows, posicoes: m.MARK_SLOTS}, null, 1));
