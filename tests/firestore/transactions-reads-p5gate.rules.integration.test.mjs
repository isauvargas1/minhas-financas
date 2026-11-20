import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {deleteApp, initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  documentId,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from 'firebase/firestore';

/**
 * P5-GATE-FINAL (FIRESTORE-01) — as consultas de lançamentos do cliente contra o Emulator, na forma exata de
 * `src/modules/transactions/api.ts` (a guarda `tests/unit/transactions-reads.test.ts` prende a forma no código):
 *
 * - lista do mês: `type ==`, `date` entre o dia 01 e o dia 31 do mês, `date` desc, id desc, páginas de 500 com
 *   um documento de sonda (`limit(501)`) e cursor no último da página;
 * - "Transações Recentes": `type ==` opcional, `date >=` início da janela, `date` desc, id desc, páginas de 10
 *   por cursor até juntar 9 não anuladas e dentro do contrato.
 *
 * Prova, com o Firestore do Emulator: ordem estável, sem repetição nem omissão entre páginas, filtros de tipo
 * e de período, Rules (todo membro ativo, viewer incluído; removido e outro workspace negados) e o número de
 * documentos devolvidos, que é o que o Firestore cobra como leitura, contra a carga antiga de 12 meses. O
 * Emulator não confere índices compostos: as consultas usam o índice simples de `date` e o composto
 * (`type`, `date` desc, `__name__` desc), já declarado em `firestore.indexes.json` e conferido abaixo.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
const indexes = require('../../firestore.indexes.json');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules do P5-GATE-FINAL.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-p5gate-reads-123456';

const users = {
  ownerA: {uid: 'p5g-reads-owner-a', email: 'p5g-reads-owner-a@example.test'},
  memberA: {uid: 'p5g-reads-member-a', email: 'p5g-reads-member-a@example.test'},
  viewerA: {uid: 'p5g-reads-viewer-a', email: 'p5g-reads-viewer-a@example.test'},
  removedA: {uid: 'p5g-reads-removed-a', email: 'p5g-reads-removed-a@example.test'},
  ownerB: {uid: 'p5g-reads-owner-b', email: 'p5g-reads-owner-b@example.test'},
};
const wsA = 'p5g-reads-workspace-a';
const wsB = 'p5g-reads-workspace-b';
const SINCE = '2025-11-01';
const BUSY_MONTH = '2026-10';
const RECENT = {wanted: 9, pageSize: 10, maxPages: 10};
const MONTH = {pageSize: 500, maxPages: 40};
const TYPES = ['receita', 'despesa', 'investimento'];

const getAdmin = () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const months = () => {
  const list = [];
  for (let year = 2024; year <= 2026; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      if (key >= '2024-10') list.push(key);
    }
  }
  return list;
};

/**
 * Conjunto determinístico: 120 lançamentos por mês de 2024-10 a 2026-12 e, no mês movimentado, mais 1.203
 * despesas, 150 receitas e 40 investimentos. A cada 97 um é anulado e a cada 101 um está fora do contrato (sem
 * `valueCents`). Vários no mesmo dia, para o desempate pelo id valer. Nas bordas do mês movimentado, um no
 * último dia do mês anterior e um no primeiro do seguinte.
 */
const dataset = () => {
  const docs = [];
  let sequence = 0;
  const push = (month, type, day) => {
    sequence += 1;
    docs.push({
      id: `t-${String((sequence * 7919) % 100_000).padStart(5, '0')}-${sequence}`,
      type, date: `${month}-${String(day).padStart(2, '0')}`,
      voided: sequence % 97 === 0, valid: sequence % 101 !== 0,
    });
  };
  for (const month of months()) {
    for (let index = 0; index < 120; index += 1) push(month, TYPES[index % 3], 1 + (index % 28));
  }
  for (let index = 0; index < 1_203; index += 1) push(BUSY_MONTH, 'despesa', 1 + (index % 31));
  for (let index = 0; index < 150; index += 1) push(BUSY_MONTH, 'receita', 1 + (index % 31));
  for (let index = 0; index < 40; index += 1) push(BUSY_MONTH, 'investimento', 1 + (index % 31));
  push('2026-09', 'despesa', 30);
  push('2026-11', 'despesa', 1);
  return docs;
};

const DATA = dataset();

const documentOf = (ws, owner, row) => ({
  type: row.type, description: `Lançamento ${row.id}`, category: 'Casa', date: row.date, isPaid: true,
  workspaceId: ws, userId: owner,
  ...(row.valid ? {valueCents: 1_000 + (Number(row.id.slice(2, 7)) % 9_000)} : {value: 10}),
  ...(row.voided ? {voidedAt: getAdmin().firestore.Timestamp.fromDate(new Date('2026-11-01T12:00:00Z'))} : {}),
});

const seed = async () => {
  const firebaseAdmin = getAdmin();
  const db = firebaseAdmin.firestore();
  for (const user of Object.values(users)) {
    try {
      await firebaseAdmin.auth().deleteUser(user.uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    await firebaseAdmin.auth().createUser({...user, password, emailVerified: true});
    await db.doc(`users/${user.uid}`).set({uid: user.uid, accessStatus: 'granted', status: 'active'});
  }
  await Promise.all([wsA, wsB].map((ws) => db.recursiveDelete(db.doc(`workspaces/${ws}`))));
  await db.doc(`workspaces/${wsA}`).set({ownerId: users.ownerA.uid, type: 'PJ', name: 'A', currency: 'BRL', status: 'active'});
  await db.doc(`workspaces/${wsB}`).set({ownerId: users.ownerB.uid, type: 'PF', name: 'B', currency: 'BRL', status: 'active'});
  const members = [
    [wsA, users.ownerA, 'owner', 'active'], [wsA, users.memberA, 'member', 'active'],
    [wsA, users.viewerA, 'viewer', 'active'], [wsA, users.removedA, 'member', 'removed'],
    [wsB, users.ownerB, 'owner', 'active'],
  ];
  await Promise.all(members.map(([ws, user, role, status]) =>
    db.doc(`workspaces/${ws}/members/${user.uid}`).set({uid: user.uid, role, status})));
  for (let start = 0; start < DATA.length; start += 450) {
    const batch = db.batch();
    for (const row of DATA.slice(start, start + 450)) {
      batch.set(db.doc(`workspaces/${wsA}/transactions/${row.id}`), documentOf(wsA, users.ownerA.uid, row));
    }
    await batch.commit();
  }
  // B tem um lançamento no mesmo mês e com o mesmo tipo: nunca aparece nas leituras de A.
  await db.doc(`workspaces/${wsB}/transactions/b-only`).set(
    documentOf(wsB, users.ownerB.uid, {id: 'b-only', type: 'despesa', date: `${BUSY_MONTH}-15`, voided: false, valid: true}));
};

const signedClient = async (user, suffix) => {
  const app = initializeApp({apiKey: 'rules-test', projectId}, `p5g-reads-${suffix}-${Math.random().toString(36).slice(2, 12)}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  await signInWithEmailAndPassword(auth, user.email, password);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {app, db};
};

const withClients = async (names, run) => {
  const clients = {};
  try {
    for (const name of names) clients[name] = await signedClient(users[name], name);
    await run(clients);
  } finally {
    await Promise.all(Object.values(clients).map((client) => deleteApp(client.app)));
  }
};

const denied = async (promise, label) => {
  await assert.rejects(promise, (error) => {
    assert.match(String(error?.code ?? error?.message), /permission-denied|PERMISSION_DENIED/, label);
    return true;
  }, label);
};

const txCol = (db, ws) => collection(db, 'workspaces', ws, 'transactions');

/** A forma de `pagedWindow` (lista do mês): sonda de um documento a mais, cursor no último da página. */
const monthShape = (db, ws, month, type, after) => query(
  txCol(db, ws),
  where('type', '==', type),
  where('date', '>=', `${month}-01`),
  where('date', '<=', `${month}-31`),
  orderBy('date', 'desc'),
  orderBy(documentId(), 'desc'),
  ...(after ? [startAfter(after)] : []),
  limit(MONTH.pageSize + 1),
);

const readMonth = async (db, ws, month, type) => {
  const docs = [];
  let after;
  let returned = 0;
  const pages = [];
  for (let page = 0; page < MONTH.maxPages; page += 1) {
    const snapshot = await getDocs(monthShape(db, ws, month, type, after));
    returned += snapshot.size;
    pages.push(snapshot.size);
    const kept = snapshot.docs.slice(0, MONTH.pageSize);
    docs.push(...kept);
    if (snapshot.size <= MONTH.pageSize) return {docs, truncated: false, returned, pages};
    after = kept[kept.length - 1];
  }
  return {docs, truncated: true, returned, pages};
};

/** A forma de `getRecentTransactions`. */
const recentShape = (db, ws, type, after) => query(
  txCol(db, ws),
  ...(type ? [where('type', '==', type)] : []),
  where('date', '>=', SINCE),
  orderBy('date', 'desc'),
  orderBy(documentId(), 'desc'),
  ...(after ? [startAfter(after)] : []),
  limit(RECENT.pageSize),
);

const shown = (data) => (data.voidedAt === undefined || data.voidedAt === null) && Number.isSafeInteger(data.valueCents);

const readRecent = async (db, ws, type) => {
  const items = [];
  let after;
  let returned = 0;
  for (let page = 0; page < RECENT.maxPages; page += 1) {
    const snapshot = await getDocs(recentShape(db, ws, type, after));
    returned += snapshot.size;
    for (const document of snapshot.docs) {
      if (!shown(document.data())) continue;
      items.push(document.id);
      if (items.length === RECENT.wanted) return {items, truncated: false, returned};
    }
    if (snapshot.size < RECENT.pageSize) return {items, truncated: false, returned};
    after = snapshot.docs[snapshot.docs.length - 1];
  }
  return {items, truncated: true, returned};
};

/** A carga antiga (`getTransactionWindow`, removida): 12 meses em páginas de 500, sem sonda. */
const readLegacyWindow = async (db, ws) => {
  let after;
  let returned = 0;
  const docs = [];
  for (let page = 0; page < 40; page += 1) {
    const snapshot = await getDocs(query(txCol(db, ws), where('date', '>=', SINCE), orderBy('date', 'desc'),
      orderBy(documentId(), 'desc'), ...(after ? [startAfter(after)] : []), limit(500)));
    returned += snapshot.size;
    docs.push(...snapshot.docs);
    after = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < 500) break;
  }
  return {docs, returned};
};

const byDateThenIdDesc = (a, b) =>
  a.date !== b.date ? (a.date < b.date ? 1 : -1) : a.id === b.id ? 0 : a.id < b.id ? 1 : -1;

test.before(seed);

test('P5-GATE (FIRESTORE-01) — o índice composto das consultas por tipo existe; as sem tipo usam o índice simples de date', () => {
  const composite = indexes.indexes.filter((entry) => entry.collectionGroup === 'transactions')
    .map((entry) => entry.fields.map((field) => `${field.fieldPath}:${field.order}`).join(','));
  assert.ok(composite.includes('type:ASCENDING,date:DESCENDING,__name__:DESCENDING'), composite.join(' | '));
  const exempt = (indexes.fieldOverrides ?? []).filter((entry) => entry.collectionGroup === 'transactions' && entry.fieldPath === 'date');
  assert.deepEqual(exempt, [], 'o índice simples de date não foi desligado');
});

test('P5-GATE (FIRESTORE-01) — lista do mês: completa por cursor, sem repetir nem omitir, em date desc e id desc, só do tipo e do mês', async () => {
  await withClients(['memberA'], async ({memberA}) => {
    for (const type of ['despesa', 'receita']) {
      const result = await readMonth(memberA.db, wsA, BUSY_MONTH, type);
      const expected = DATA.filter((row) => row.type === type && row.date.slice(0, 7) === BUSY_MONTH).sort(byDateThenIdDesc);
      const ids = result.docs.map((document) => document.id);
      assert.equal(result.truncated, false, type);
      assert.equal(new Set(ids).size, ids.length, `${type}: sem repetição`);
      assert.deepEqual(ids, expected.map((row) => row.id), `${type}: mesmos documentos, mesma ordem`);
      assert.ok(result.docs.every((document) => document.data().type === type && document.data().date.startsWith(BUSY_MONTH)));
    }
    // As despesas do mês movimentado ocupam 3 páginas; a bordas (30/09 e 01/11) ficam fora.
    const despesas = await readMonth(memberA.db, wsA, BUSY_MONTH, 'despesa');
    assert.deepEqual(despesas.pages, [501, 501, 243]);
    const borders = DATA.filter((row) => row.date === '2026-09-30' || row.date === '2026-11-01').map((row) => row.id);
    assert.ok(borders.length >= 2);
    assert.ok(borders.every((id) => !despesas.docs.some((document) => document.id === id)));
    // Mês anterior à janela antiga de 12 meses: vem completo (antes aparecia vazio).
    const old = await readMonth(memberA.db, wsA, '2025-01', 'receita');
    assert.deepEqual(old.docs.map((document) => document.id),
      DATA.filter((row) => row.type === 'receita' && row.date.startsWith('2025-01')).sort(byDateThenIdDesc).map((row) => row.id));
  });
});

test('P5-GATE (FIRESTORE-01) — Transações Recentes: as 9 primeiras não anuladas e dentro do contrato, em cada filtro', async () => {
  await withClients(['memberA'], async ({memberA}) => {
    for (const type of [null, ...TYPES]) {
      const result = await readRecent(memberA.db, wsA, type);
      const expected = DATA.filter((row) => row.date >= SINCE && (type === null || row.type === type))
        .sort(byDateThenIdDesc).filter((row) => !row.voided && row.valid).slice(0, RECENT.wanted).map((row) => row.id);
      assert.equal(result.truncated, false);
      assert.deepEqual(result.items, expected, `filtro ${type ?? 'todas'}`);
      assert.ok(result.returned <= RECENT.pageSize * 2, `filtro ${type ?? 'todas'}: ${result.returned} lidos`);
    }
  });
});

test('P5-GATE (FIRESTORE-01) — documentos devolvidos (medidos no Emulator): carga antiga × leituras novas', async () => {
  await withClients(['memberA'], async ({memberA}) => {
    const legacy = await readLegacyWindow(memberA.db, wsA);
    const windowSize = DATA.filter((row) => row.date >= SINCE).length;
    assert.equal(legacy.returned, windowSize);
    const recent = await readRecent(memberA.db, wsA, null);
    const monthDespesas = await readMonth(memberA.db, wsA, BUSY_MONTH, 'despesa');
    const monthReceitas = await readMonth(memberA.db, wsA, '2026-07', 'receita');
    const measured = {
      cenario: 'Emulator, workspace A com o conjunto deste arquivo',
      janelaAntiga12Meses: legacy.returned,
      transacoesRecentes: recent.returned,
      listaDespesasMesMovimentado: monthDespesas.returned,
      listaReceitasMesComum: monthReceitas.returned,
    };
    console.log(`MEDICAO-FIRESTORE-01 ${JSON.stringify(measured)}`);
    assert.equal(recent.returned, RECENT.pageSize);
    assert.equal(monthDespesas.returned, DATA.filter((row) => row.type === 'despesa' && row.date.startsWith(BUSY_MONTH)).length + 2);
    assert.equal(monthReceitas.returned, DATA.filter((row) => row.type === 'receita' && row.date.startsWith('2026-07')).length);
    assert.ok(legacy.returned > 100 * recent.returned);
  });
});

test('P5-GATE (FIRESTORE-01) — Rules: owner, member e viewer leem as duas formas; removido e outro workspace não, nos dois sentidos', async () => {
  await withClients(Object.keys(users), async (clients) => {
    for (const name of ['ownerA', 'memberA', 'viewerA']) {
      const {db} = clients[name];
      assert.ok((await getDocs(monthShape(db, wsA, BUSY_MONTH, 'despesa'))).size > 0, name);
      assert.ok((await getDocs(recentShape(db, wsA, null))).size > 0, name);
      assert.ok((await getDocs(recentShape(db, wsA, 'receita'))).size > 0, name);
    }
    for (const name of ['removedA', 'ownerB']) {
      const {db} = clients[name];
      await denied(getDocs(monthShape(db, wsA, BUSY_MONTH, 'despesa')), `${name}: lista do mês de A`);
      await denied(getDocs(recentShape(db, wsA, null)), `${name}: recentes de A`);
      await denied(getDocs(recentShape(db, wsA, 'despesa')), `${name}: recentes de A por tipo`);
    }
    // MT-04 (P5-GATE-FINAL, 2ª rodada): o sentido A → B, com os três papéis ativos de A.
    for (const name of ['ownerA', 'memberA', 'viewerA']) {
      const {db} = clients[name];
      await denied(getDocs(monthShape(db, wsB, BUSY_MONTH, 'despesa')), `${name}: lista do mês de B`);
      await denied(getDocs(recentShape(db, wsB, null)), `${name}: recentes de B`);
      await denied(getDocs(recentShape(db, wsB, 'despesa')), `${name}: recentes de B por tipo`);
    }
    // No próprio workspace, B lê só o que é de B.
    const own = await getDocs(monthShape(clients.ownerB.db, wsB, BUSY_MONTH, 'despesa'));
    assert.deepEqual(own.docs.map((document) => document.id), ['b-only']);
    const ownRecent = await getDocs(recentShape(clients.ownerB.db, wsB, null));
    assert.deepEqual(ownRecent.docs.map((document) => document.id), ['b-only']);
  });
});
