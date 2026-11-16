// Sonda (revisão escala/custo P5-F.1-R3): consumo por página da varredura da reconstrução com a função
// REAL `processPage` (compilada da árvore R2A f8267922 e da árvore R3), mesma entrada para as duas.
// Mede: documentos consumidos por chamada, leituras por documento da base (a página inteira é lida e só
// a parte consumida avança o cursor), chamadas e escritas de âncora. Sem rede, sem Firebase.
const path = require('node:path');
const [, , R3DIR, BASEDIR] = process.argv;
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'sonda-offline';
const r3 = require(path.join(R3DIR, 'functions/lib/cash/rebuild.probe.js'));
const base = require(path.join(BASEDIR, 'functions/lib/cash/rebuild.probe.js'));
const {Timestamp} = require(path.join(R3DIR, 'functions/node_modules/firebase-admin/lib/firestore/index.js'));

let seed = 12345 >>> 0;
// mulberry32 (inteiros de 32 bits com Math.imul: sem perda de precisão)
const rand = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const autoId = () => Array.from({length: 20}, () => ALPHA[Math.floor(rand() * ALPHA.length)]).join('');

const cutoff = Timestamp.fromMillis(Date.UTC(2026, 10, 9, 12));
const older = Timestamp.fromMillis(Date.UTC(2026, 10, 1, 12));
const ledger = ({n, months, categories}) => {
  const docs = [];
  for (let i = 0; i < n; i += 1) {
    const mIdx = Math.floor(rand() * months);
    const y = 2026 - Math.floor(mIdx / 12); const mo = 12 - (mIdx % 12);
    const day = 1 + Math.floor(rand() * 28);
    const date = `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const c = Math.floor(rand() * categories);
    const type = c % 3 === 0 ? 'receita' : 'despesa';
    const data = {type, description: 'x', category: `Categoria ${c}`, categoryId: `cat${c}`, valueCents: 100 + Math.floor(rand() * 100000), date, isPaid: true, userId: 'u'};
    docs.push({id: autoId(), createTime: older, updateTime: older, data: () => data});
  }
  return docs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};
const scan = (impl, docs, pageSize) => {
  let pos = 0, calls = 0, reads = 0, cuts = 0, anchors = 0, minConsumed = Infinity, maxWrites = 0;
  while (pos < docs.length) {
    const page = docs.slice(pos, pos + pageSize);
    reads += page.length; calls += 1;
    const work = impl.__processPage(page, cutoff);
    if (work.restart) throw new Error('restart inesperado');
    if (work.cut) cuts += 1;
    anchors += work.anchors ? work.anchors.length : 0;
    // escritas do commit da página: shards de dias por mês + categoria-ano + âncoras + checkpoint
    const writes = Object.keys(work.days).length + Object.keys(work.categories).length + (work.anchors ? work.anchors.length : 0) + 1;
    maxWrites = Math.max(maxWrites, writes);
    if (writes > 500) throw new Error(`commit da página com ${writes} escritas`);
    minConsumed = Math.min(minConsumed, work.consumed);
    pos += work.consumed;
    if (work.consumed === 0) throw new Error('página sem avanço');
  }
  return {calls, reads, leiturasPorDoc: +(reads / docs.length).toFixed(2), cortes: cuts, menorConsumo: minConsumed, ancoras: anchors, maiorCommit: maxWrites};
};
const cenarios = [
  {nome: 'concentrado (12 meses, 10 categorias)', n: 20000, months: 12, categories: 10},
  {nome: 'típico (36 meses, 20 categorias)', n: 20000, months: 36, categories: 20},
  {nome: 'diverso (120 meses, 60 categorias)', n: 20000, months: 120, categories: 60},
  {nome: 'extremo (240 meses, 150 categorias)', n: 20000, months: 240, categories: 150},
  {nome: 'adversário (600 meses, 500 categorias)', n: 20000, months: 600, categories: 500},
];
const out = [];
for (const c of cenarios) {
  const docs = ledger(c);
  for (const pageSize of [300, 500]) {
    const b = scan(base, docs, pageSize);
    const n = scan(r3, docs, pageSize);
    out.push({cenario: c.nome, N: c.n, pageSize, r2a: b, r3: n, chamadasR3SobreR2A: +(n.calls / b.calls).toFixed(2), leiturasR3SobreR2A: +(n.reads / b.reads).toFixed(2)});
  }
}
console.log(JSON.stringify(out, null, 1));
