// Gera tests/fixtures/transaction-fingerprints.json com a implementação do backend (functions/lib).
const path = require('node:path');
const fs = require('node:fs');
const WT = process.argv[2];
const { createRequire } = require('node:module');
const freq = createRequire(path.join(WT, 'functions/package.json'));
const { Timestamp, GeoPoint } = freq('firebase-admin/firestore');
const { transactionFingerprint } = require(path.join(WT, 'functions/lib/cash/projectionMarks.js'));
const fromFixture = (value) => {
  if (Array.isArray(value)) return value.map(fromFixture);
  if (value && typeof value === 'object') {
    if (Array.isArray(value.__timestamp)) return new Timestamp(value.__timestamp[0], value.__timestamp[1]);
    if (Array.isArray(value.__geopoint)) return new GeoPoint(value.__geopoint[0], value.__geopoint[1]);
    if (typeof value.__number === 'string') return Number(value.__number);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fromFixture(v)]));
  }
  return value;
};
const ts = (s, n) => ({ __timestamp: [s, n] });
const cases = [
  { name: 'receita de caixa paga', doc: { type: 'receita', description: 'Salário', category: 'Renda', categoryId: 'cat-renda', valueCents: 1250000, date: '2026-10-05', isPaid: true, userId: 'uid-1', createdAt: ts(1790000000, 123000), updatedAt: ts(1790000100, 456000), cashEntry: { status: 'paid', revision: 3, confirmedAt: ts(1790000050, 0), accountId: 'acc-1' } } },
  { name: 'mesmo conteúdo com chaves em outra ordem', doc: { updatedAt: ts(1790000100, 456000), cashEntry: { accountId: 'acc-1', confirmedAt: ts(1790000050, 0), revision: 3, status: 'paid' }, userId: 'uid-1', isPaid: true, date: '2026-10-05', valueCents: 1250000, categoryId: 'cat-renda', category: 'Renda', description: 'Salário', createdAt: ts(1790000000, 123000), type: 'receita' } },
  { name: 'um microssegundo a mais no updatedAt', doc: { type: 'receita', description: 'Salário', category: 'Renda', categoryId: 'cat-renda', valueCents: 1250000, date: '2026-10-05', isPaid: true, userId: 'uid-1', createdAt: ts(1790000000, 123000), updatedAt: ts(1790000100, 457000), cashEntry: { status: 'paid', revision: 3, confirmedAt: ts(1790000050, 0), accountId: 'acc-1' } } },
  { name: 'espelho de recebimento de cliente', doc: { type: 'receita', valueCents: 50000, date: '2026-09-20', description: 'Recebimento', receivableEntry: { principalCents: 50000, reversal: false, receivableMovementId: 'rmv_' + 'a'.repeat(40), clientId: 'cli-1' }, updatedAt: ts(1789000000, 1000) } },
  { name: 'anulado com nulos e lista', doc: { type: 'despesa', valueCents: 0, date: '2026-01-31', voidedAt: ts(1789500000, 999000), tags: ['a', 'b', 1, null, true], note: null, nested: { list: [{ x: 1 }, { y: [2, 3] }] } } },
  { name: 'mapa com chave $t não é Timestamp', doc: { weird: { $t: [1, 2] }, valueCents: 1, type: 'receita', date: '2026-02-01' } },
  { name: 'números especiais', doc: { a: -0, b: { __number: 'NaN' }, c: { __number: 'Infinity' }, d: 0.5, e: 9007199254740991 } },
  { name: 'ponto geográfico', doc: { where: { __geopoint: [-23.5505, -46.6333] }, valueCents: 10, type: 'despesa', date: '2026-03-03' } },
  { name: 'texto com acentos e emoji', doc: { description: 'Pão de queijo ☕ — ação', valueCents: 1, type: 'despesa', date: '2026-04-04' } },
];
const out = { description: 'P5-F.1-R3 (B03): impressão digital canônica de documentos de transactions. Gerada pela implementação do backend (functions/src/cash/projectionMarks.ts) e conferida pelo cliente (src/modules/work-time/projectionProof.ts). Marcadores: __timestamp [segundos, nanossegundos], __geopoint [lat, lng], __number (NaN, Infinity).', cases: cases.map((c) => ({ ...c, fingerprint: transactionFingerprint(fromFixture(c.doc)) })) };
fs.writeFileSync(path.join(WT, 'tests/fixtures/transaction-fingerprints.json'), JSON.stringify(out, null, 2) + '\n');
console.log(out.cases.map((c) => `${c.fingerprint.slice(0, 12)} ${c.name}`).join('\n'));
