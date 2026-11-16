// P5-F.1-R3: o SDK web faz uma leitura consistente de vários documentos de coleções diferentes numa
// transação só de leitura (verificações no commit), sob as Rules do projeto (escrita negada)? E repete
// quando um documento lido muda antes do commit?
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.join(process.env.WT, 'package.json'));
const freq = createRequire(path.join(process.env.WT, 'functions/package.json'));
const admin = freq('firebase-admin');
const { initializeApp, deleteApp } = req('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = req('firebase/auth');
const { getFirestore, connectFirestoreEmulator, doc, runTransaction, getDoc } = req('firebase/firestore');
process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
const projectId = 'minhas-financas-local';
admin.initializeApp({ projectId });
const adb = admin.firestore();
(async () => {
  const uid = 'sonda-r3-member';
  const email = 'sonda-r3@example.test';
  const password = 'sonda-r3-123456';
  try { await admin.auth().deleteUser(uid); } catch (e) { if (e?.code !== 'auth/user-not-found') throw e; }
  await admin.auth().createUser({ uid, email, password, emailVerified: true });
  await adb.doc(`users/${uid}`).set({ uid, status: 'active' });
  const ws = `sonda-r3-${Date.now()}`;
  await adb.doc(`workspaces/${ws}`).set({ ownerId: uid, type: 'PF', name: 'S', status: 'active' });
  await adb.doc(`workspaces/${ws}/members/${uid}`).set({ uid, role: 'viewer', status: 'active' });
  await adb.doc(`workspaces/${ws}/transactions/t1`).set({ type: 'receita', valueCents: 100, date: '2026-10-05', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  await adb.doc(`workspaces/${ws}/cash_report_periods/2026-10`).set({ incomeCents: 100, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  const app = initializeApp({ apiKey: 'sonda', projectId }, `sonda-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  await signInWithEmailAndPassword(auth, email, password);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  const out = {};
  // 1. Leitura consistente sem concorrência.
  let attempts = 0;
  const r1 = await runTransaction(db, async (tx) => {
    attempts += 1;
    const t = await tx.get(doc(db, `workspaces/${ws}/transactions/t1`));
    const m = await tx.get(doc(db, `workspaces/${ws}/cash_report_periods/2026-10`));
    const x = await tx.get(doc(db, `workspaces/${ws}/transactions/inexistente`));
    return { t: t.data()?.valueCents, m: m.data()?.incomeCents, x: x.exists() };
  });
  out.semConcorrencia = { ...r1, tentativas: attempts };
  // 2. Um documento lido muda entre a leitura e o commit: a transação tem de repetir.
  attempts = 0;
  const r2 = await runTransaction(db, async (tx) => {
    attempts += 1;
    const t = await tx.get(doc(db, `workspaces/${ws}/transactions/t1`));
    if (attempts === 1) {
      await adb.doc(`workspaces/${ws}/cash_report_periods/2026-10`).update({ incomeCents: 300, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      await adb.doc(`workspaces/${ws}/transactions/t1`).update({ valueCents: 300, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
    const m = await tx.get(doc(db, `workspaces/${ws}/cash_report_periods/2026-10`));
    return { t: t.data()?.valueCents, m: m.data()?.incomeCents };
  });
  out.comMudancaNoMeio = { ...r2, tentativas: attempts };
  // 3. Escrita direta continua negada (controle).
  try {
    await runTransaction(db, async (tx) => { tx.update(doc(db, `workspaces/${ws}/transactions/t1`), { valueCents: 1 }); });
    out.escritaNegada = false;
  } catch (e) { out.escritaNegada = /permission/i.test(String(e?.code ?? e?.message)); }
  // 4. Documento sem permissão de leitura (coleção backend-only) falha a transação inteira.
  try {
    await runTransaction(db, async (tx) => { await tx.get(doc(db, `workspaces/${ws}/cash_period_events/projection_state`)); });
    out.leituraNegadaFalha = false;
  } catch (e) { out.leituraNegadaFalha = /permission/i.test(String(e?.code ?? e?.message)); }
  console.log(JSON.stringify(out, null, 1));
  await deleteApp(app);
  const ok = out.semConcorrencia.tentativas === 1 && out.semConcorrencia.t === 100 && out.semConcorrencia.m === 100 &&
    out.comMudancaNoMeio.tentativas === 2 && out.comMudancaNoMeio.t === 300 && out.comMudancaNoMeio.m === 300 &&
    out.escritaNegada && out.leituraNegadaFalha;
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('ERRO', e?.code, e?.message); process.exit(2); });
