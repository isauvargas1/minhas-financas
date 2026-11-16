const path = require('node:path');
const [, , R3DIR] = process.argv;
process.env.GCLOUD_PROJECT = 'sonda-offline';
const r3 = require(path.join(R3DIR, 'functions/lib/cash/rebuild.probe.js'));
const periods = require(path.join(R3DIR, 'functions/lib/cash/periods.js'));
const {Timestamp} = require(path.join(R3DIR, 'functions/node_modules/firebase-admin/lib/firestore/index.js'));
const cutoff = Timestamp.fromMillis(Date.UTC(2026, 10, 9, 12));
const older = Timestamp.fromMillis(Date.UTC(2026, 10, 1, 12));
const docs = [];
for (let i = 0; i < 300; i += 1) {
  const mIdx = i % 240; const y = 2026 - Math.floor(mIdx / 12); const mo = 12 - (mIdx % 12);
  const data = {type: i % 3 ? 'despesa' : 'receita', description: 'x', category: 'C' + (i % 150), categoryId: 'cat' + (i % 150), valueCents: 1000 + i, date: `${y}-${String(mo).padStart(2,'0')}-10`, isPaid: true, userId: 'u'};
  docs.push({id: 'd' + String(i).padStart(5, '0'), createTime: older, updateTime: older, data: () => data});
}
const plan = periods.cashWritePlanFor(undefined, docs[1].data());
console.log('plan exemplo', JSON.stringify({months: Object.keys(plan.months), days: Object.keys(plan.days), categories: Object.keys(plan.categories)}));
const w = r3.__processPage(docs, cutoff);
console.log({consumed: w.consumed, cut: w.cut, months: Object.keys(w.days).length, categories: Object.keys(w.categories).length, anchors: w.anchors.length});
