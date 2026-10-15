import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {deleteApp, initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

/**
 * P5-C1 (D-37.7, D-37.8) — Rules das projeções do relatório contra o Emulator.
 *
 * - `cash_category_years/{gen}__{AAAA}__{categoria}`: projeção de caixa por
 *   categoria. Backend-only nos dois sentidos: o cliente recebe categorias
 *   apenas pelo relatório autoritativo (`getFinancialReport`). Nenhum papel,
 *   nem o owner, lê, lista ou grava; nem por consulta de grupo.
 * - `cash_rebuild_shards/{rebuildId}__m__{AAAA-MM}`: acumuladores da
 *   reconstrução. Mesma regra.
 * - `cash_report_periods/{AAAA-MM}` (agora com o mapa `days`): continua legível
 *   por membro ativo (get e lista com teto de 600) e fechado para escrita —
 *   é o documento escutado pelo Dashboard para reler o relatório.
 * - Não membro, membro removido, conta suspensa e sessão anônima não leem
 *   nada disso; workspace arquivado continua somente leitura.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da P5-C1.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-p5c1-123456';

const users = {
  ownerA: {uid: 'p5c1-owner-a', email: 'p5c1-owner-a@example.test'},
  adminA: {uid: 'p5c1-admin-a', email: 'p5c1-admin-a@example.test'},
  memberA: {uid: 'p5c1-member-a', email: 'p5c1-member-a@example.test'},
  viewerA: {uid: 'p5c1-viewer-a', email: 'p5c1-viewer-a@example.test'},
  removedA: {uid: 'p5c1-removed-a', email: 'p5c1-removed-a@example.test'},
  suspendedA: {uid: 'p5c1-suspended-a', email: 'p5c1-suspended-a@example.test'},
  ownerB: {uid: 'p5c1-owner-b', email: 'p5c1-owner-b@example.test'},
};
const ACTIVE_A = ['ownerA', 'adminA', 'memberA', 'viewerA'];
const wsA = 'p5c1-workspace-a';
const wsB = 'p5c1-workspace-b';
const wsArchived = 'p5c1-workspace-arquivado';
const MONTH = '2026-10';
const CATEGORY_DOC = 'g0__2026__cat-mercado';
const UNCATEGORIZED_DOC = 'g0__2026__sem_categoria';
const SHARD_DOC = 'rebuild-1__m__2026-10';
const BACKEND_ONLY = [
  ['cash_category_years', CATEGORY_DOC],
  ['cash_category_years', UNCATEGORIZED_DOC],
  ['cash_rebuild_shards', SHARD_DOC],
];

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

/** Forma gravada pelo gatilho de caixa v5 (totais do mês + `days`). */
const periodDoc = (ws, Timestamp) => ({
  id: MONTH, workspaceId: ws, period: MONTH,
  periodStart: Timestamp.fromDate(new Date('2026-10-01T03:00:00.000Z')),
  incomeCents: 50_000, expenseCents: 10_000, investmentOutflowCents: 0,
  netCents: 40_000, transactionCount: 2, schemaVersion: 5,
  days: {'03': {incomeCents: 50_000, transactionCount: 1}, '09': {expenseCents: 10_000, transactionCount: 1}},
  updatedAt: Timestamp.now(),
});

/** Forma gravada pelo gatilho na projeção por categoria. */
const categoryDoc = (ws, categoryKey, Timestamp) => ({
  workspaceId: ws, generation: 'g0', year: '2026', categoryKey,
  incomeCents: 0, expenseCents: 10_000, transactionCount: 1,
  days: {'1009': {expenseCents: 10_000, transactionCount: 1}},
  updatedAt: Timestamp.now(),
});

const shardDoc = (ws, Timestamp) => ({
  workspaceId: ws, rebuildId: 'rebuild-1', period: MONTH,
  incomeCents: 50_000, expenseCents: 10_000, transactionCount: 2,
  days: {'03': {incomeCents: 50_000, transactionCount: 1}},
  expiresAt: Timestamp.fromDate(new Date('2026-10-16T00:00:00.000Z')),
});

const seed = async () => {
  const firebaseAdmin = getAdmin();
  const db = firebaseAdmin.firestore();
  const {Timestamp} = firebaseAdmin.firestore;
  for (const user of Object.values(users)) {
    try {
      await firebaseAdmin.auth().deleteUser(user.uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    await firebaseAdmin.auth().createUser({...user, password, emailVerified: true});
    await db.doc(`users/${user.uid}`).set({
      uid: user.uid, status: user === users.suspendedA ? 'suspended' : 'active',
    });
  }
  await Promise.all([wsA, wsB, wsArchived].map((ws) => db.recursiveDelete(db.doc(`workspaces/${ws}`))));
  await Promise.all([
    db.doc(`workspaces/${wsA}`).set({ownerId: users.ownerA.uid, type: 'PF', name: 'A', status: 'active'}),
    db.doc(`workspaces/${wsB}`).set({ownerId: users.ownerB.uid, type: 'PJ', name: 'B', status: 'active'}),
    db.doc(`workspaces/${wsArchived}`).set({ownerId: users.ownerA.uid, type: 'PF', name: 'Arq', status: 'archived'}),
  ]);
  const members = [
    [wsA, users.ownerA, 'owner', 'active'], [wsA, users.adminA, 'admin', 'active'],
    [wsA, users.memberA, 'member', 'active'], [wsA, users.viewerA, 'viewer', 'active'],
    [wsA, users.removedA, 'member', 'removed'], [wsA, users.suspendedA, 'member', 'active'],
    [wsB, users.ownerB, 'owner', 'active'], [wsArchived, users.memberA, 'member', 'active'],
  ];
  await Promise.all(members.map(([ws, user, role, status]) =>
    db.doc(`workspaces/${ws}/members/${user.uid}`).set({uid: user.uid, role, status})));
  const batch = db.batch();
  for (const ws of [wsA, wsB, wsArchived]) {
    batch.set(db.doc(`workspaces/${ws}/cash_report_periods/${MONTH}`), periodDoc(ws, Timestamp));
    batch.set(db.doc(`workspaces/${ws}/cash_category_years/${CATEGORY_DOC}`),
      categoryDoc(ws, 'cat-mercado', Timestamp));
    batch.set(db.doc(`workspaces/${ws}/cash_category_years/${UNCATEGORIZED_DOC}`),
      categoryDoc(ws, 'sem_categoria', Timestamp));
    batch.set(db.doc(`workspaces/${ws}/cash_rebuild_shards/${SHARD_DOC}`), shardDoc(ws, Timestamp));
  }
  await batch.commit();
};

const clientApp = (suffix) => initializeApp(
  {apiKey: 'rules-test', projectId},
  `p5c1-${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
);

const signedClient = async (user, suffix) => {
  const app = clientApp(suffix);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  await signInWithEmailAndPassword(auth, user.email, password);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {app, db};
};

const anonymousClient = () => {
  const app = clientApp('anon');
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

const periodRef = (db, ws) => doc(db, `workspaces/${ws}/cash_report_periods/${MONTH}`);
const periodList = (db, ws, max) => query(collection(db, `workspaces/${ws}/cash_report_periods`), limit(max));

/** Toda forma de acesso do cliente a uma coleção backend-only é negada. */
const assertBackendOnly = async (db, ws, label) => {
  for (const [name, id] of BACKEND_ONLY) {
    const ref = doc(db, `workspaces/${ws}/${name}/${id}`);
    await denied(getDoc(ref), `${label}: get ${name}/${id}`);
    await denied(getDocs(query(collection(db, `workspaces/${ws}/${name}`), limit(1))),
      `${label}: lista ${name} com limite`);
    await denied(getDocs(collection(db, `workspaces/${ws}/${name}`)), `${label}: lista ${name} sem limite`);
    await denied(setDoc(doc(db, `workspaces/${ws}/${name}/forjado`), {workspaceId: ws, expenseCents: 1}),
      `${label}: cria ${name}`);
    await denied(updateDoc(ref, {expenseCents: 0}), `${label}: altera ${name}/${id}`);
    await denied(setDoc(ref, {days: {}}, {merge: true}), `${label}: zera days de ${name}/${id}`);
    await denied(deleteDoc(ref), `${label}: apaga ${name}/${id}`);
  }
};

test.before(seed);

// 1–4. Cada papel ativo: projeção mensal legível; categoria e shards fechados.
for (const name of ACTIVE_A) {
  test(`P5-C1 Rules — ${name} lê o caixa mensal e não toca categorias nem shards`, async () => {
    await withClients([name], async ({[name]: {db}}) => {
      const period = await getDoc(periodRef(db, wsA));
      assert.equal(period.get('schemaVersion'), 5);
      assert.equal(period.get('days.03.incomeCents'), 50_000, 'o mapa de dias é legível com o mês');
      assert.equal((await getDocs(periodList(db, wsA, 600))).size, 1);
      await denied(getDocs(periodList(db, wsA, 601)), `${name} lista o caixa acima do teto`);
      await denied(getDocs(collection(db, `workspaces/${wsA}/cash_report_periods`)),
        `${name} lista o caixa sem limite`);
      await assertBackendOnly(db, wsA, name);
    });
  });
}

// 5. Nenhum papel grava a projeção mensal (nem o mapa de dias).
test('P5-C1 Rules — nenhum papel grava cash_report_periods, nem o mapa de dias', async () => {
  await withClients(ACTIVE_A, async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      await denied(updateDoc(periodRef(db, wsA), {'days.09.expenseCents': 0}), `${name} altera um dia`);
      await denied(setDoc(periodRef(db, wsA), {days: {}}, {merge: true}), `${name} zera os dias`);
      await denied(setDoc(doc(db, `workspaces/${wsA}/cash_report_periods/2026-11`), {
        workspaceId: wsA, incomeCents: 1, schemaVersion: 5, days: {'01': {incomeCents: 1}},
      }), `${name} cria mês`);
      await denied(deleteDoc(periodRef(db, wsA)), `${name} apaga o mês`);
    }
  });
});

// 6. Não membro, nos dois sentidos: nada do workspace alheio; controle no próprio.
test('P5-C1 Rules — não membro não lê nem grava as projeções de outro workspace', async () => {
  await withClients(['ownerB', 'ownerA'], async ({ownerB, ownerA}) => {
    await denied(getDoc(periodRef(ownerB.db, wsA)), 'ownerB lê o caixa de A');
    await denied(getDocs(periodList(ownerB.db, wsA, 10)), 'ownerB lista o caixa de A');
    await assertBackendOnly(ownerB.db, wsA, 'ownerB em A');
    await denied(getDoc(periodRef(ownerA.db, wsB)), 'ownerA lê o caixa de B');
    await denied(getDocs(periodList(ownerA.db, wsB, 10)), 'ownerA lista o caixa de B');
    await denied(setDoc(periodRef(ownerA.db, wsB), {netCents: 0}, {merge: true}),
      'ownerA grava o caixa de B');
    await assertBackendOnly(ownerA.db, wsB, 'ownerA em B');
    // Controle: no próprio workspace lê o mês e continua sem categorias.
    assert.equal((await getDoc(periodRef(ownerB.db, wsB))).exists(), true);
    await assertBackendOnly(ownerB.db, wsB, 'ownerB em B');
  });
});

// 7. Membro removido.
test('P5-C1 Rules — membro removido não lê o caixa nem as projeções', async () => {
  await withClients(['removedA'], async ({removedA}) => {
    await denied(getDoc(periodRef(removedA.db, wsA)), 'removido lê o caixa');
    await denied(getDocs(periodList(removedA.db, wsA, 10)), 'removido lista o caixa');
    await assertBackendOnly(removedA.db, wsA, 'removido');
  });
});

// 8. Conta suspensa (membro ativo do workspace).
test('P5-C1 Rules — conta suspensa não lê o caixa nem as projeções', async () => {
  await withClients(['suspendedA'], async ({suspendedA}) => {
    await denied(getDoc(periodRef(suspendedA.db, wsA)), 'suspenso lê o caixa');
    await denied(getDocs(periodList(suspendedA.db, wsA, 10)), 'suspenso lista o caixa');
    await assertBackendOnly(suspendedA.db, wsA, 'suspenso');
  });
});

// 9. Workspace arquivado: somente leitura do mês; categorias e shards fechados.
test('P5-C1 Rules — workspace arquivado: membro lê o mês e continua sem categorias e shards', async () => {
  await withClients(['memberA'], async ({memberA}) => {
    assert.equal((await getDoc(periodRef(memberA.db, wsArchived))).get('netCents'), 40_000);
    await denied(setDoc(periodRef(memberA.db, wsArchived), {netCents: 0}, {merge: true}),
      'membro grava o caixa do arquivado');
    await assertBackendOnly(memberA.db, wsArchived, 'arquivado');
  });
});

// 10. Sessão anônima.
test('P5-C1 Rules — sem autenticação nada é lido nem gravado', async () => {
  const client = anonymousClient();
  try {
    await denied(getDoc(periodRef(client.db, wsA)), 'anônimo lê o caixa');
    await denied(getDocs(periodList(client.db, wsA, 10)), 'anônimo lista o caixa');
    await assertBackendOnly(client.db, wsA, 'anônimo');
  } finally {
    await deleteApp(client.app);
  }
});

// 11. Consulta de grupo: nem o owner varre categorias ou shards de todos os tenants.
test('P5-C1 Rules — consulta de grupo em categorias e shards é negada a todos', async () => {
  await withClients(['ownerA', 'ownerB'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const group of ['cash_category_years', 'cash_rebuild_shards']) {
        await denied(getDocs(query(collectionGroup(db, group), limit(10))), `${name} varre ${group}`);
      }
    }
  });
});

// 12. Os documentos semeados continuam intactos depois de todas as tentativas.
test('P5-C1 Rules — tentativas negadas não alteram as projeções', async () => {
  const db = getAdmin().firestore();
  for (const ws of [wsA, wsB, wsArchived]) {
    const period = await db.doc(`workspaces/${ws}/cash_report_periods/${MONTH}`).get();
    assert.equal(period.get('netCents'), 40_000, `${ws}: mês intacto`);
    assert.equal(period.get('days.09.expenseCents'), 10_000, `${ws}: dia intacto`);
    const category = await db.doc(`workspaces/${ws}/cash_category_years/${CATEGORY_DOC}`).get();
    assert.equal(category.get('expenseCents'), 10_000, `${ws}: categoria intacta`);
    const shard = await db.doc(`workspaces/${ws}/cash_rebuild_shards/${SHARD_DOC}`).get();
    assert.equal(shard.get('incomeCents'), 50_000, `${ws}: shard intacto`);
    const forged = await db.collection(`workspaces/${ws}/cash_category_years`).doc('forjado').get();
    assert.equal(forged.exists, false, `${ws}: nada forjado`);
    assert.equal((await db.doc(`workspaces/${ws}/cash_report_periods/2026-11`).get()).exists, false);
  }
});
