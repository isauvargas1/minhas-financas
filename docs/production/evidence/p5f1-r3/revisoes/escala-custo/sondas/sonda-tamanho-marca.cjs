// Sonda (revisão escala/custo P5-F.1-R3): tamanho do documento de marca e entradas de índice
// automáticas de campo único, usando as funções REAIS do backend compiladas no sandbox da revisão
// (markChainOf, applyMarkEvent, markViewOf, markDocumentData, markAnchorPatch). Sem rede, sem Firebase.
// Fórmulas (estimativa, regras públicas de "storage size" do Firestore):
//   string = bytes UTF-8 + 1; bool/null = 1; inteiro/double/timestamp = 8; mapa = Σ(chave + valor);
//   array = Σ elementos; nome do documento = Σ(id de coleção + id de doc, cada um +1) + 16;
//   documento = nome + Σ nomes de campo + Σ valores + 32.
//   Entrada de índice de campo único (estimativa): nome do doc + caminho do campo + valor + 32.
//   Índices automáticos: asc + desc por folha escalar (inclusive dentro de mapas); array-contains por
//   elemento de array (sem índice das subchaves dos elementos). Não conta o mapa inteiro (limite inferior).
const path = require('node:path');
const SB = process.argv[2];
const m = require(path.join(SB, 'functions/lib/cash/projectionMarks.js'));
const {Timestamp} = require(path.join(SB, 'functions/node_modules/firebase-admin/lib/firestore/index.js'));

const str = (s) => Buffer.byteLength(s, 'utf8') + 1;
const isTs = (v) => v instanceof Timestamp;
const isSentinel = (v) => v && typeof v === 'object' && v.constructor && /FieldValue|ServerTimestamp/i.test(v.constructor.name);
const valueSize = (v) => {
  if (v === null || typeof v === 'boolean') return 1;
  if (typeof v === 'number') return 8;
  if (typeof v === 'string') return str(v);
  if (isTs(v) || isSentinel(v)) return 8; // serverTimestamp resolve para timestamp
  if (Array.isArray(v)) return v.reduce((s, x) => s + valueSize(x), 0);
  return Object.entries(v).reduce((s, [k, x]) => s + str(k) + valueSize(x), 0);
};
const docName = (ws, tx) => str('workspaces') + str(ws) + str('cash_projection_marks') + str(tx) + 16;
const docSize = (ws, tx, data) => docName(ws, tx) + Object.entries(data).reduce((s, [k, x]) => s + str(k) + valueSize(x), 0) + 32;
const indexEntries = (ws, tx, data) => {
  const name = docName(ws, tx);
  const out = {count: 0, bytes: 0};
  const walk = (prefix, v) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !isTs(v) && !isSentinel(v)) {
      for (const [k, x] of Object.entries(v)) walk(prefix ? `${prefix}.${k}` : k, x);
      return;
    }
    if (Array.isArray(v)) {
      for (const el of v) { out.count += 1; out.bytes += name + str(prefix) + valueSize(el) + 32; }
      return;
    }
    out.count += 2; out.bytes += 2 * (name + str(prefix) + valueSize(v) + 32);
  };
  walk('', data);
  return out;
};

const WS = 'a'.repeat(20), TX = 'b'.repeat(20);
const hex = (n) => n.toString(16).padStart(64, '0');
const cut = Timestamp.fromMillis(Date.UTC(2026, 10, 9, 12));
const g0 = {id: 'g0', cutoff: null, slot: 'a', role: 'published'};
const r1 = {id: 'b9f3c2a1-0000-4000-8000-000000000001', cutoff: cut, slot: 'b', role: 'staging'};
const ev = (b, a) => ({before: b === null ? {k: 'none'} : {k: 'alive', fp: hex(b)}, after: a === null ? {k: 'deleted'} : {k: 'alive', fp: hex(a)}, beforeUpdateTime: null});

const cenarios = {};
// 1) Lançamento criado e editado 3 vezes em g0 (sem reconstrução): só chains.a.
{
  let doc = {anchors: {}, chains: {}};
  let view = m.markViewOf(doc, g0);
  for (const e of [ev(null, 1), ev(1, 2), ev(2, 3), ev(3, 4)]) view = m.applyMarkEvent(view, e, g0);
  doc.chains.a = m.markChainOf(view, g0);
  cenarios['típico g0 (1 cadeia, sem pendência)'] = doc;
}
// 2) Depois de uma reconstrução: âncora em b, cadeia b com um evento posterior, cadeia a velha.
{
  const base = cenarios['típico g0 (1 cadeia, sem pendência)'];
  const doc = {anchors: {b: {g: r1.id, cut, fp: hex(4)}}, chains: {a: base.chains.a}};
  let view = m.markViewOf(doc, r1);
  view = m.applyMarkEvent(view, ev(4, 5), r1);
  doc.chains.b = m.markChainOf(view, r1);
  cenarios['após reconstrução (âncora b + 2 cadeias)'] = doc;
}
// 3) Pior caso: as duas cadeias com 16 pendências (gatilho alimenta vigente e preparada) e âncoras nas duas posições.
{
  const doc = {anchors: {a: {g: 'g-velha', cut, fp: hex(9)}, b: {g: r1.id, cut, fp: hex(4)}}, chains: {}};
  for (const gen of [{...g0, slot: 'a'}, r1]) {
    let view = m.markViewOf(doc, gen);
    for (let i = 0; i < m.MAX_MARK_PENDING; i += 1) view = m.applyMarkEvent(view, ev(1000 + i, 2000 + i), gen);
    doc.chains[gen.slot] = m.markChainOf(view, gen);
  }
  cenarios['pior caso (2 âncoras + 2 cadeias com 16 pendências)'] = doc;
}
// 4) Cadeia quebrada por estouro (o 17º evento): pendências descartadas da gravação.
{
  const doc = {anchors: {}, chains: {}};
  let view = m.markViewOf(doc, g0);
  for (let i = 0; i <= m.MAX_MARK_PENDING; i += 1) view = m.applyMarkEvent(view, ev(3000 + i, 4000 + i), g0);
  doc.chains.a = m.markChainOf(view, g0);
  cenarios['quebrada (17º evento fora de ordem)'] = doc;
}
const linhas = [];
for (const [nome, doc] of Object.entries(cenarios)) {
  const data = m.markDocumentData(WS, TX, doc);
  const pend = Object.values(doc.chains).map((c) => c.pending.length);
  const size = docSize(WS, TX, data);
  const idx = indexEntries(WS, TX, data);
  linhas.push({cenario: nome, pendencias: pend.join('+') || '0', bytesDocumento: size, entradasIndice: idx.count, bytesIndiceEstimados: idx.bytes, fatorIndiceSobreDoc: +(idx.bytes / size).toFixed(1), broken: Object.values(doc.chains).map((c) => c.broken).filter(Boolean).join(',') || '-'});
}
// Âncora (set com merge) gravada pela varredura: payload da escrita.
const patch = m.markAnchorPatch(WS, TX, 'b', {g: r1.id, cut, fp: hex(4)});
console.log(JSON.stringify({MAX_MARK_PENDING: m.MAX_MARK_PENDING, cenarios: linhas, ancoraPatchBytes: valueSize(patch)}, null, 1));
// Projeção para N lançamentos (estimativa linear; cada lançamento tem no máximo uma marca).
for (const N of [10_000, 100_000, 1_000_000]) {
  const t = linhas[1];
  const w = linhas[2];
  console.log(`N=${N}: típico ${(N * (t.bytesDocumento + t.bytesIndiceEstimados) / 2 ** 20).toFixed(1)} MiB (doc ${(N * t.bytesDocumento / 2 ** 20).toFixed(1)} MiB); pior caso ${(N * (w.bytesDocumento + w.bytesIndiceEstimados) / 2 ** 20).toFixed(1)} MiB`);
}
