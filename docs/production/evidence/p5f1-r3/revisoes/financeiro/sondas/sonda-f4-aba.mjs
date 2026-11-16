// Sonda F4 (revisão financeira P5-F.1-R3): conteúdo repetido (ABA) sem `updatedAt`. Escritas X→Y, Y→X, X→Y;
// a terceira entregue primeiro casa com o nó X e deixa a cadeia limpa (nó Y, sem pendência) antes de as duas
// primeiras chegarem. Confere: (a) a cadeia fica "provável" com predecessores ausentes; (b) a INV-M continua
// valendo (parte de T na projeção = efeito do nó), porque o efeito só depende do conteúdo.
// Uso: node sonda-f4-aba.mjs <WT>
import { createRequire } from 'node:module';

const WT = process.argv[2];
const require = createRequire(`${WT}/functions/package.json`);
const { Timestamp } = require('firebase-admin/firestore');
const marks = require(`${WT}/functions/lib/cash/projectionMarks.js`);
const periods = require(`${WT}/functions/lib/cash/periods.js`);

const X = { type: 'receita', valueCents: 1000, date: '2026-10-05', isPaid: true };
const Y = { type: 'receita', valueCents: 3000, date: '2026-11-05', isPaid: true };
const g0 = { id: 'g0', cutoff: null, slot: 'a', role: 'published' };
const t = (s) => Timestamp.fromMillis(s * 1000);
const writes = [
  { name: 'e0 criação X', before: undefined, after: X, beforeUpdateTime: null },
  { name: 'e1 X→Y', before: X, after: Y, beforeUpdateTime: t(1) },
  { name: 'e2 Y→X', before: Y, after: X, beforeUpdateTime: t(2) },
  { name: 'e3 X→Y', before: X, after: Y, beforeUpdateTime: t(3) },
];
const income = {};
const apply = (w) => {
  const plan = periods.cashWritePlanFor(w.before, w.after);
  for (const [m, d] of Object.entries(plan.months)) income[m] = (income[m] ?? 0) + d.incomeCents;
};
let doc = { anchors: {}, chains: {} };
const deliver = (w) => {
  apply(w);
  const view = marks.applyMarkEvent(marks.markViewOf(doc, g0), marks.markEventOf(w.before, w.after, w.beforeUpdateTime), g0);
  doc = { anchors: doc.anchors, chains: { a: marks.markChainOf(view, g0) } };
  const seen = marks.markViewOf(doc, g0);
  const node = seen.kind === 'rooted' ? (seen.node.k === 'alive' ? (seen.node.fp === marks.transactionFingerprint(X) ? 'X' : 'Y') : seen.node.k) : seen.kind;
  console.log(`${w.name.padEnd(14)} visão=${seen.kind} nó=${node} pendências=${seen.kind === 'rooted' ? seen.pending.length : '-'} projeção=${JSON.stringify(income)}`);
};
for (const w of [writes[0], writes[3], writes[1], writes[2]]) deliver(w);
