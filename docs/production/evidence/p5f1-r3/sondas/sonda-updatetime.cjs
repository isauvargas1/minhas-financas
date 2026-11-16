// P5-F.1-R3, B03-02: no Firestore Emulator, `DocumentSnapshot.updateTime` é igual ao `updatedAt` gravado com
// `FieldValue.serverTimestamp()` na mesma escrita? E dois documentos da mesma transação recebem o mesmo instante?
const path = require('node:path');
const from = { paths: [path.join(process.env.WT, 'functions')] };
const admin = require(require.resolve('firebase-admin', from));
const { FieldValue } = require(require.resolve('firebase-admin/firestore', from));
admin.initializeApp({ projectId: 'minhas-financas-local' });
const db = admin.firestore();
const eq = (a, b) => a && b && a.seconds === b.seconds && a.nanoseconds === b.nanoseconds;
const fmt = (t) => (t ? `${t.seconds}.${String(t.nanoseconds).padStart(9, '0')}` : 'null');
(async () => {
  const ws = `sonda-${Date.now()}`;
  const ref = db.doc(`workspaces/${ws}/transactions/t1`);
  const rows = [];
  let ok = true;
  await ref.create({ v: 0, updatedAt: FieldValue.serverTimestamp() });
  for (let i = 1; i <= 40; i += 1) {
    if (i % 2) await ref.update({ v: i, updatedAt: FieldValue.serverTimestamp() });
    else await db.runTransaction(async (tx) => { await tx.get(ref); tx.set(ref, { v: i, updatedAt: FieldValue.serverTimestamp() }, { merge: true }); });
    const snap = await ref.get();
    const same = eq(snap.updateTime, snap.data().updatedAt);
    ok = ok && same;
    rows.push([i, fmt(snap.updateTime), fmt(snap.data().updatedAt), same]);
  }
  let increasing = true;
  for (let i = 1; i < rows.length; i += 1) if (!(rows[i][1] > rows[i - 1][1])) increasing = false;
  const nanosMultipleOf1000 = rows.every((r) => Number(r[1].split('.')[1]) % 1000 === 0);
  // Dois documentos na mesma transação, um deles com o instante num mapa aninhado (como `months.{m}` da marca).
  const a = db.doc(`workspaces/${ws}/cash_report_periods/2026-10`);
  const b = db.doc(`workspaces/${ws}/cash_projection_marks/t1`);
  await db.runTransaction(async (tx) => {
    await tx.getAll(a, b);
    tx.set(a, { incomeCents: FieldValue.increment(100), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(b, { chain: { months: { '2026-10': FieldValue.serverTimestamp() } }, at: FieldValue.serverTimestamp() }, { merge: true });
  });
  const [sa, sb] = await db.getAll(a, b);
  const sameCommit = eq(sa.data().updatedAt, sb.data().chain.months['2026-10']) && eq(sa.data().updatedAt, sb.data().at) &&
    eq(sa.updateTime, sb.updateTime) && eq(sa.updateTime, sa.data().updatedAt);
  console.log(JSON.stringify({
    escritas: rows.length, updatedAtIgualUpdateTime: ok, updateTimeCrescente: increasing, nanosMultiplosDe1000: nanosMultipleOf1000,
    mesmaTransacaoMesmoInstante: sameCommit, mes: fmt(sa.data().updatedAt), marca: fmt(sb.data().chain.months['2026-10']),
    updateTimeMes: fmt(sa.updateTime), updateTimeMarca: fmt(sb.updateTime), amostra: rows.slice(0, 4),
  }, null, 1));
  process.exit(ok && increasing && sameCommit ? 0 : 1);
})().catch((error) => { console.error(error); process.exit(2); });
