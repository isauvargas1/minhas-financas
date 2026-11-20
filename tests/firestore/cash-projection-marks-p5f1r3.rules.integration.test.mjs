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
  documentId,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {transactionFingerprint as clientFingerprint} from '../../src/modules/work-time/projectionProof.ts';

/**
 * P5-F.1-R3 (B03) — Rules da marca de aplicação da projeção contra o Emulator.
 *
 * `workspaces/{ws}/cash_projection_marks/{transactionId}` é backend-only para escrita:
 * - `get`: membro ativo com conta ativa, inclusive viewer;
 * - `list`: negado a todos os papéis, com ou sem `limit` (o cliente só lê por id, na transação);
 * - `create`, `update` e `delete`: negados a todos os papéis, inclusive o owner;
 * - consulta de grupo (`collectionGroup`): negada;
 * - não membro, membro removido, conta suspensa e sessão anônima: nada.
 *
 * Também prova a leitura do cliente (transação só de leitura do SDK web, junto com
 * `cash_report_periods`) e a paridade da impressão digital entre o SDK web e o Admin SDK
 * sobre um documento real de lançamento.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da P5-F.1-R3.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-p5f1r3-123456';

const users = {
  ownerA: {uid: 'p5f1r3-owner-a', email: 'p5f1r3-owner-a@example.test'},
  adminA: {uid: 'p5f1r3-admin-a', email: 'p5f1r3-admin-a@example.test'},
  memberA: {uid: 'p5f1r3-member-a', email: 'p5f1r3-member-a@example.test'},
  viewerA: {uid: 'p5f1r3-viewer-a', email: 'p5f1r3-viewer-a@example.test'},
  removedA: {uid: 'p5f1r3-removed-a', email: 'p5f1r3-removed-a@example.test'},
  suspendedA: {uid: 'p5f1r3-suspended-a', email: 'p5f1r3-suspended-a@example.test'},
  ownerB: {uid: 'p5f1r3-owner-b', email: 'p5f1r3-owner-b@example.test'},
};
const ACTIVE_A = ['ownerA', 'adminA', 'memberA', 'viewerA'];
const wsA = 'p5f1r3-workspace-a';
const wsB = 'p5f1r3-workspace-b';
const wsArchived = 'p5f1r3-workspace-arquivado';
const MONTH = '2026-10';
const MISSING_MONTH = '2026-09';
const FP_TX = 't-fp';
const FP1 = 'a'.repeat(64);
const FP2 = 'b'.repeat(64);

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

/** Forma real da marca gravada pelo gatilho de caixa (`MarkDoc`). */
const markDoc = (ws, transactionId, fp, Timestamp) => ({
  schemaVersion: 1,
  workspaceId: ws,
  transactionId,
  anchors: {},
  chains: {a: {g: 'g0', cut: null, root: 'absent', base: null, node: {k: 'alive', fp}, pending: [], broken: null}},
  updatedAt: Timestamp.now(),
});

const periodDoc = (ws, Timestamp) => ({
  id: MONTH, workspaceId: ws, period: MONTH,
  periodStart: Timestamp.fromDate(new Date('2026-10-01T03:00:00.000Z')),
  incomeCents: 50_000, expenseCents: 10_000, investmentOutflowCents: 0,
  netCents: 40_000, transactionCount: 2, schemaVersion: 5,
  projectionGeneration: {id: 'g0', cutoff: null},
  updatedAt: Timestamp.now(),
});

/** Lançamento com tipos variados, para exercitar a serialização canônica da impressão digital. */
const fingerprintTransaction = (ws, Timestamp, microNanos = 123_456_000) => ({
  workspaceId: ws,
  description: 'Mercado açaí — pão de queijo',
  amountCents: 9_007_199_254_740_991,
  type: 'income',
  nothing: null,
  tags: ['ação', 3, true, null, {profundo: 'é'}],
  nested: {a: {b: {c: [1, {d: 'ç'}], e: null}}, n: 0, f: false},
  date: Timestamp.fromDate(new Date('2026-10-09T12:00:00.000Z')),
  createdAt: new Timestamp(1_760_000_000, microNanos),
  isDeleted: false,
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
      uid: user.uid, accessStatus: 'granted', status: user === users.suspendedA ? 'suspended' : 'active',
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
  for (const ws of [wsA, wsB]) {
    batch.set(db.doc(`workspaces/${ws}/cash_projection_marks/t1`), markDoc(ws, 't1', FP1, Timestamp));
    batch.set(db.doc(`workspaces/${ws}/cash_projection_marks/t2`), markDoc(ws, 't2', FP2, Timestamp));
    batch.set(db.doc(`workspaces/${ws}/cash_report_periods/${MONTH}`), periodDoc(ws, Timestamp));
    batch.set(db.doc(`workspaces/${ws}/transactions/${FP_TX}`), fingerprintTransaction(ws, Timestamp));
  }
  await batch.commit();
};

const clientApp = (suffix) => initializeApp(
  {apiKey: 'rules-test', projectId},
  `p5f1r3-${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
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

const markRef = (db, ws, id) => doc(db, `workspaces/${ws}/cash_projection_marks/${id}`);
const marksByIds = (db, ws, ids, max) => {
  const constraints = [where(documentId(), 'in', ids)];
  if (max !== undefined) constraints.push(limit(max));
  return query(collection(db, `workspaces/${ws}/cash_projection_marks`), ...constraints);
};

test.before(seed);

test('get da marca: owner, admin, member e viewer de A leem; removido, suspensa, outro workspace e anônimo negados', async () => {
  await withClients([...ACTIVE_A, 'removedA', 'suspendedA', 'ownerB'], async (clients) => {
    for (const name of ACTIVE_A) {
      const snapshot = await getDoc(markRef(clients[name].db, wsA, 't1'));
      assert.equal(snapshot.exists(), true, `${name} lê a marca t1`);
      assert.equal(snapshot.data().transactionId, 't1', `${name} recebe o documento certo`);
      assert.equal(snapshot.data().chains.a.node.fp, FP1, `${name} recebe a impressão digital`);
    }
    await denied(getDoc(markRef(clients.removedA.db, wsA, 't1')), 'membro removido não lê a marca');
    await denied(getDoc(markRef(clients.suspendedA.db, wsA, 't1')), 'conta suspensa não lê a marca');
    await denied(getDoc(markRef(clients.ownerB.db, wsA, 't1')), 'owner de B não lê a marca de A');
    // O owner de B lê a própria marca (isolamento por workspace, não bloqueio geral).
    assert.equal((await getDoc(markRef(clients.ownerB.db, wsB, 't1'))).exists(), true);
  });
  const anon = anonymousClient();
  try {
    await denied(getDoc(markRef(anon.db, wsA, 't1')), 'anônimo não lê a marca');
  } finally {
    await deleteApp(anon.app);
  }
});

test('consulta à coleção de marcas: negada a todos os papéis, com ou sem limite; só a leitura por documento é permitida', async () => {
  await withClients([...ACTIVE_A, 'removedA', 'suspendedA', 'ownerB'], async (clients) => {
    for (const name of ACTIVE_A) {
      await denied(getDocs(marksByIds(clients[name].db, wsA, ['t1', 't2'], 2)), `${name} com limite 2 é negado`);
      await denied(getDocs(marksByIds(clients[name].db, wsA, ['t1'], 1)), `${name} com limite 1 é negado`);
      await denied(getDocs(marksByIds(clients[name].db, wsA, ['t1', 't2'])), `${name} sem limite é negado`);
      await denied(getDocs(marksByIds(clients[name].db, wsA, ['t1', 't2'], 31)), `${name} com limite acima de 30 é negado`);
      await denied(getDocs(query(collection(clients[name].db, `workspaces/${wsA}/cash_projection_marks`), limit(1))),
        `${name} listagem da coleção é negada`);
      // A mesma marca continua legível por documento.
      assert.equal((await getDoc(markRef(clients[name].db, wsA, 't1'))).exists(), true, `${name} lê t1 por documento`);
    }
    await denied(getDocs(marksByIds(clients.ownerB.db, wsA, ['t1', 't2'], 2)), 'owner de B não consulta marcas de A');
    await denied(getDocs(marksByIds(clients.removedA.db, wsA, ['t1', 't2'], 2)), 'membro removido não consulta');
    await denied(getDocs(marksByIds(clients.suspendedA.db, wsA, ['t1', 't2'], 2)), 'conta suspensa não consulta');
  });
});

test('escrita direta na marca: criar, sobrescrever, atualizar e apagar negados a todos os papéis, inclusive owner', async () => {
  await withClients(ACTIVE_A, async (clients) => {
    for (const name of ACTIVE_A) {
      const {db} = clients[name];
      await denied(setDoc(markRef(db, wsA, `forjada-${name}`), {schemaVersion: 1, workspaceId: wsA, transactionId: 'x', chains: {}}),
        `${name} não cria marca nova`);
      await denied(setDoc(markRef(db, wsA, 't1'), {schemaVersion: 1, workspaceId: wsA, transactionId: 't1', anchors: {}, chains: {}}),
        `${name} não sobrescreve marca existente`);
      await denied(updateDoc(markRef(db, wsA, 't1'), {'chains.a.node': {k: 'alive', fp: FP2}}),
        `${name} não troca o nó da marca`);
      await denied(deleteDoc(markRef(db, wsA, 't1')), `${name} não apaga a marca`);
    }
  });
  // Nada mudou no servidor: marca intacta e nenhuma marca forjada.
  const db = getAdmin().firestore();
  const kept = await db.doc(`workspaces/${wsA}/cash_projection_marks/t1`).get();
  assert.equal(kept.exists, true);
  assert.equal(kept.data().chains.a.node.fp, FP1);
  const all = await db.collection(`workspaces/${wsA}/cash_projection_marks`).get();
  assert.deepEqual(all.docs.map((item) => item.id).sort(), ['t1', 't2']);
});

test('consulta de grupo cash_projection_marks com limite 5 é negada ao owner de A e ao anônimo', async () => {
  await withClients(['ownerA'], async ({ownerA}) => {
    await denied(getDocs(query(collectionGroup(ownerA.db, 'cash_projection_marks'), limit(5))),
      'owner de A não consulta o grupo');
  });
  const anon = anonymousClient();
  try {
    await denied(getDocs(query(collectionGroup(anon.db, 'cash_projection_marks'), limit(5))),
      'anônimo não consulta o grupo');
  } finally {
    await deleteApp(anon.app);
  }
});

test('transação só de leitura: viewer lê meses e marcas; escrita na transação e leitor de outro workspace negados', async () => {
  const readSnapshot = (db, ws) => runTransaction(db, async (transaction) => {
    const month = await transaction.get(doc(db, `workspaces/${ws}/cash_report_periods/${MONTH}`));
    const missingMonth = await transaction.get(doc(db, `workspaces/${ws}/cash_report_periods/${MISSING_MONTH}`));
    const mark = await transaction.get(markRef(db, ws, 't1'));
    const missingMark = await transaction.get(markRef(db, ws, 'inexistente'));
    return {month, missingMonth, mark, missingMark};
  });
  await withClients(['viewerA', 'ownerB'], async ({viewerA, ownerB}) => {
    const read = await readSnapshot(viewerA.db, wsA);
    assert.equal(read.month.exists(), true, 'mês 2026-10 existe');
    assert.equal(read.month.data().incomeCents, 50_000);
    assert.deepEqual(read.month.data().projectionGeneration, {id: 'g0', cutoff: null});
    assert.equal(read.missingMonth.exists(), false, 'mês 2026-09 não existe');
    assert.equal(read.mark.exists(), true, 'marca t1 existe');
    assert.equal(read.mark.data().chains.a.g, 'g0');
    assert.equal(read.mark.data().chains.a.node.fp, FP1);
    assert.equal(read.missingMark.exists(), false, 'marca inexistente não existe');

    await denied(runTransaction(viewerA.db, async (transaction) => {
      await transaction.get(markRef(viewerA.db, wsA, 't1'));
      transaction.update(markRef(viewerA.db, wsA, 't1'), {'chains.a.node': {k: 'alive', fp: FP2}});
    }), 'transação do viewer não escreve na marca');
    const intact = await getAdmin().firestore().doc(`workspaces/${wsA}/cash_projection_marks/t1`).get();
    assert.equal(intact.data().chains.a.node.fp, FP1, 'marca segue intacta');

    await denied(readSnapshot(ownerB.db, wsA), 'owner de B não lê a projeção de A');
  });
});

test('paridade da impressão digital entre o SDK web e o Admin SDK, e sensibilidade a 1 microssegundo', async () => {
  const firebaseAdmin = getAdmin();
  const adminDb = firebaseAdmin.firestore();
  const {Timestamp} = firebaseAdmin.firestore;
  const backend = require('../../functions/lib/cash/projectionMarks.js');
  const ref = `workspaces/${wsA}/transactions/${FP_TX}`;

  const both = async (client) => {
    const web = await getDocFromServer(doc(client.db, ref));
    assert.equal(web.exists(), true);
    const adminSnap = await adminDb.doc(ref).get();
    const fromClient = await clientFingerprint(web.data());
    const fromBackend = backend.transactionFingerprint(adminSnap.data());
    return {fromClient, fromBackend};
  };

  await withClients(['memberA'], async ({memberA}) => {
    const before = await both(memberA);
    assert.match(before.fromBackend, /^[0-9a-f]{64}$/);
    assert.equal(before.fromClient, before.fromBackend, 'SDKs concordam sobre o documento real');

    // Muda o Timestamp em 1 microssegundo (1000 ns): ambas as impressões mudam e seguem iguais.
    await adminDb.doc(ref).update({createdAt: new Timestamp(1_760_000_000, 123_457_000)});
    const after = await both(memberA);
    assert.notEqual(after.fromBackend, before.fromBackend, 'o backend percebe 1 microssegundo');
    assert.notEqual(after.fromClient, before.fromClient, 'o cliente percebe 1 microssegundo');
    assert.equal(after.fromClient, after.fromBackend, 'SDKs seguem iguais após a mudança');
  });
});
