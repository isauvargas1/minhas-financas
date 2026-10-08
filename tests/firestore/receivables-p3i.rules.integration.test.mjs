import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {deleteApp, initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  count,
  deleteDoc,
  doc,
  documentId,
  getAggregateFromServer,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  sum,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

/**
 * P3-I — Rules de clientes e recebíveis (D-24, D-39) contra o Emulator.
 *
 * - Nenhum papel escreve em `clients`, `client_private`, `receivables`,
 *   `receivable_movements`, `client_events` ou `receivable_events`: o único
 *   caminho de escrita são as callables (Admin SDK).
 * - Dados pessoais (`client_private`) e auditoria: só owner/admin, listagem
 *   com teto. Member e viewer não recebem o documento — nem pela regra
 *   genérica de subcoleção.
 * - Cadastro mínimo, recebíveis e movimentos: leitura de qualquer membro
 *   ativo, nos formatos exatos de consulta do frontend; nada atravessa o
 *   workspace.
 * - Nenhum lançamento do cliente forja o espelho de recebimento.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da P3-I.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-p3i-123456';

const users = {
  ownerA: {uid: 'p3i-owner-a', email: 'p3i-owner-a@example.test'},
  adminA: {uid: 'p3i-admin-a', email: 'p3i-admin-a@example.test'},
  memberA: {uid: 'p3i-member-a', email: 'p3i-member-a@example.test'},
  viewerA: {uid: 'p3i-viewer-a', email: 'p3i-viewer-a@example.test'},
  removedA: {uid: 'p3i-removed-a', email: 'p3i-removed-a@example.test'},
  ownerB: {uid: 'p3i-owner-b', email: 'p3i-owner-b@example.test'},
};
const wsA = 'p3i-workspace-a';
const wsB = 'p3i-workspace-b';
const TODAY = '2026-10-05';

const COLLECTIONS = [
  'clients', 'client_private', 'client_events',
  'receivables', 'receivable_movements', 'receivable_events',
];
/** Owner/admin apenas. */
const RESTRICTED = ['client_private', 'client_events', 'receivable_events'];
/** Qualquer membro ativo lê. */
const SHARED = ['clients', 'receivables', 'receivable_movements'];

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const ts = () => getAdmin().firestore.Timestamp.fromDate(new Date('2026-10-05T12:00:00.000Z'));

const receivableDoc = (workspaceId, id, overrides = {}) => ({
  id, schemaVersion: 1, workspaceId, clientId: 'cli_1', description: 'Consultoria', currency: 'BRL',
  amountCents: 100_000, principalReceivedCents: 0, discountGrantedCents: 0, interestReceivedCents: 0,
  penaltyReceivedCents: 0, balanceCents: 100_000, activeReceiptCount: 0, dueDate: TODAY,
  status: 'open', revision: 1, createdBy: users.memberA.uid, updatedAt: ts(), ...overrides,
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
    await db.doc(`users/${user.uid}`).set({uid: user.uid, status: 'active'});
  }
  await Promise.all([wsA, wsB].map((ws) => db.recursiveDelete(db.doc(`workspaces/${ws}`))));
  await Promise.all([
    db.doc(`workspaces/${wsA}`).set({ownerId: users.ownerA.uid, type: 'PJ', name: 'A', currency: 'BRL', status: 'active'}),
    db.doc(`workspaces/${wsB}`).set({ownerId: users.ownerB.uid, type: 'PJ', name: 'B', currency: 'BRL', status: 'active'}),
  ]);
  const members = [
    [wsA, users.ownerA, 'owner', 'active'], [wsA, users.adminA, 'admin', 'active'],
    [wsA, users.memberA, 'member', 'active'], [wsA, users.viewerA, 'viewer', 'active'],
    [wsA, users.removedA, 'member', 'removed'], [wsB, users.ownerB, 'owner', 'active'],
  ];
  await Promise.all(members.map(([ws, user, role, status]) =>
    db.doc(`workspaces/${ws}/members/${user.uid}`).set({uid: user.uid, role, status})));

  for (const ws of [wsA, wsB]) {
    const batch = db.batch();
    batch.set(db.doc(`workspaces/${ws}/clients/cli_1`), {
      clientId: 'cli_1', schemaVersion: 1, workspaceId: ws, name: 'Comercial Exemplo', status: 'active',
      createdBy: users.ownerA.uid, updatedBy: users.ownerA.uid, createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`workspaces/${ws}/clients/cli_2`), {
      clientId: 'cli_2', schemaVersion: 1, workspaceId: ws, name: 'Arquivada Ltda.', status: 'archived',
      createdBy: users.ownerA.uid, updatedBy: users.ownerA.uid, createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`workspaces/${ws}/client_private/cli_1`), {
      id: 'cli_1', schemaVersion: 1, workspaceId: ws, clientId: 'cli_1', document: '11222333000181',
      email: 'financeiro@cliente.example', phone: '(11) 98765-4321', address: 'Rua das Amostras, 100',
      notes: 'Prefere boleto', updatedBy: users.ownerA.uid, createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`workspaces/${ws}/client_events/client.created_1`), {
      id: 'client.created_1', schemaVersion: 1, workspaceId: ws, clientId: 'cli_1',
      operation: 'client.created', actorId: users.ownerA.uid, intentId: 'intent-1',
      changedFields: ['name', 'document'], createdAt: ts(),
    });
    // Em aberto vencido, em aberto no prazo, recebido e cancelado.
    batch.set(db.doc(`workspaces/${ws}/receivables/rcv_late`),
      receivableDoc(ws, 'rcv_late', {dueDate: '2026-09-01', balanceCents: 60_000, principalReceivedCents: 40_000, activeReceiptCount: 1}));
    batch.set(db.doc(`workspaces/${ws}/receivables/rcv_soon`),
      receivableDoc(ws, 'rcv_soon', {dueDate: '2026-10-08', amountCents: 25_000, balanceCents: 25_000}));
    batch.set(db.doc(`workspaces/${ws}/receivables/rcv_done`),
      receivableDoc(ws, 'rcv_done', {status: 'received', balanceCents: 0, principalReceivedCents: 90_000, discountGrantedCents: 10_000, activeReceiptCount: 1}));
    batch.set(db.doc(`workspaces/${ws}/receivables/rcv_cancel`),
      receivableDoc(ws, 'rcv_cancel', {status: 'cancelled', amountCents: 7_000, balanceCents: 7_000}));
    batch.set(db.doc(`workspaces/${ws}/receivable_movements/rmv_1`), {
      id: 'rmv_1', schemaVersion: 1, workspaceId: ws, receivableId: 'rcv_late', clientId: 'cli_1',
      kind: 'receipt', principalCents: 40_000, interestCents: 0, penaltyCents: 0, discountCents: 0,
      cashCents: 40_000, date: '2026-09-15', cashTransactionId: 'recvcash_1', reversalOf: null,
      reversedBy: null, reason: null, createdBy: users.memberA.uid, createdAt: ts(),
    });
    batch.set(db.doc(`workspaces/${ws}/receivable_events/receivable.created_1`), {
      id: 'receivable.created_1', schemaVersion: 1, workspaceId: ws, receivableId: 'rcv_late',
      clientId: 'cli_1', operation: 'receivable.created', actorId: users.memberA.uid,
      intentId: 'intent-2', createdAt: ts(),
    });
    await batch.commit();
  }
};

const signedClient = async (user, suffix) => {
  const app = initializeApp(
    {apiKey: 'rules-test', projectId},
    `p3i-${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );
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

const existingId = {
  clients: 'cli_1', client_private: 'cli_1', client_events: 'client.created_1',
  receivables: 'rcv_late', receivable_movements: 'rmv_1', receivable_events: 'receivable.created_1',
};

test.before(seed);

test('P3-I Rules — nenhum papel cria, altera ou apaga nas seis coleções', async () => {
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA', 'ownerB'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const coll of COLLECTIONS) {
        const base = `workspaces/${wsA}/${coll}`;
        await denied(setDoc(doc(db, `${base}/novo-${name}`), {
          schemaVersion: 1, workspaceId: wsA, name: 'Forjado', status: 'active',
          amountCents: 1, balanceCents: 1, createdBy: users[name].uid, updatedAt: serverTimestamp(),
        }), `${name} cria em ${coll}`);
        await denied(updateDoc(doc(db, `${base}/${existingId[coll]}`), {status: 'cancelled'}),
          `${name} altera ${coll}`);
        await denied(setDoc(doc(db, `${base}/${existingId[coll]}`), {status: 'paid'}, {merge: true}),
          `${name} sobrescreve ${coll}`);
        await denied(deleteDoc(doc(db, `${base}/${existingId[coll]}`)), `${name} apaga ${coll}`);
      }
      const batch = writeBatch(db);
      batch.set(doc(db, `workspaces/${wsA}/receivables/lote-${name}`), {value: 100, status: 'pending'});
      batch.delete(doc(db, `workspaces/${wsA}/clients/cli_1`));
      await denied(batch.commit(), `${name} grava em lote`);
    }
  });
  // Nada mudou.
  const db = getAdmin().firestore();
  assert.equal((await db.doc(`workspaces/${wsA}/receivables/rcv_late`).get()).get('status'), 'open');
  assert.equal((await db.doc(`workspaces/${wsA}/clients/cli_1`).get()).exists, true);
});

test('P3-I Rules — dados pessoais e auditoria: só owner/admin, com teto de listagem', async () => {
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA', 'removedA', 'ownerB'], async (clients) => {
    for (const coll of RESTRICTED) {
      const ref = (db) => collection(db, 'workspaces', wsA, coll);
      for (const name of ['ownerA', 'adminA']) {
        const {db} = clients[name];
        assert.equal((await getDoc(doc(db, `workspaces/${wsA}/${coll}/${existingId[coll]}`))).exists(), true,
          `${name} lê ${coll}`);
        assert.equal((await getDocs(query(ref(db), limit(50)))).size, 1, `${name} lista ${coll}`);
        await denied(getDocs(query(ref(db))), `${name} lista ${coll} sem teto`);
        await denied(getDocs(query(ref(db), limit(101))), `${name} lista ${coll} acima do teto`);
      }
      for (const name of ['memberA', 'viewerA', 'removedA', 'ownerB']) {
        const {db} = clients[name];
        await denied(getDoc(doc(db, `workspaces/${wsA}/${coll}/${existingId[coll]}`)), `${name} lê ${coll}`);
        await denied(getDocs(query(ref(db), limit(10))), `${name} lista ${coll}`);
      }
    }
    // Forma exata do frontend: dados pessoais dos clientes listados.
    const byIds = (db) => getDocs(query(collection(db, 'workspaces', wsA, 'client_private'),
      where(documentId(), 'in', ['cli_1', 'cli_2']), limit(2)));
    assert.equal((await byIds(clients.adminA.db)).size, 1);
    await denied(byIds(clients.memberA.db), 'member pede dados pessoais');
    await denied(byIds(clients.viewerA.db), 'viewer pede dados pessoais');
  });
});

test('P3-I Rules — cadastro mínimo, recebíveis e movimentos: leitura de membros, nas consultas do frontend', async () => {
  await withClients(['ownerA', 'memberA', 'viewerA', 'removedA', 'ownerB'], async (clients) => {
    for (const name of ['ownerA', 'memberA', 'viewerA']) {
      const {db} = clients[name];
      for (const coll of SHARED) {
        assert.equal((await getDoc(doc(db, `workspaces/${wsA}/${coll}/${existingId[coll]}`))).exists(), true,
          `${name} lê ${coll}`);
      }
      const clientsRef = collection(db, 'workspaces', wsA, 'clients');
      const firstPage = await getDocs(query(clientsRef, orderBy('name'), orderBy(documentId()), limit(2)));
      assert.deepEqual(firstPage.docs.map((entry) => entry.id), ['cli_2', 'cli_1']);
      const next = await getDocs(query(clientsRef, orderBy('name'), orderBy(documentId()),
        startAfter('Arquivada Ltda.', 'cli_2'), limit(2)));
      assert.deepEqual(next.docs.map((entry) => entry.id), ['cli_1']);
      const options = await getDocs(query(clientsRef, where('status', '==', 'active'), orderBy('name'), limit(500)));
      assert.deepEqual(options.docs.map((entry) => entry.id), ['cli_1']);
      // Nenhum dado pessoal no cadastro compartilhado.
      assert.deepEqual(Object.keys(firstPage.docs[1].data()).sort(),
        ['clientId', 'createdAt', 'createdBy', 'name', 'schemaVersion', 'status', 'updatedAt', 'updatedBy', 'workspaceId']);

      const receivablesRef = collection(db, 'workspaces', wsA, 'receivables');
      const page = await getDocs(query(receivablesRef, orderBy('dueDate'), orderBy(documentId()), limit(101)));
      assert.equal(page.size, 4);
      // Cursor (vencimento, ID) atravessando a página, com empate de
      // vencimento decidido pelo ID: nada repetido nem pulado.
      const first = await getDocs(query(receivablesRef, orderBy('dueDate'), orderBy(documentId()), limit(2)));
      assert.deepEqual(first.docs.map((entry) => entry.id), ['rcv_late', 'rcv_cancel']);
      const second = await getDocs(query(receivablesRef, orderBy('dueDate'), orderBy(documentId()),
        startAfter(TODAY, 'rcv_cancel'), limit(2)));
      assert.deepEqual(second.docs.map((entry) => entry.id), ['rcv_done', 'rcv_soon']);
      const empty = await getDocs(query(receivablesRef, orderBy('dueDate'), orderBy(documentId()),
        startAfter('2026-10-08', 'rcv_soon'), limit(2)));
      assert.equal(empty.size, 0);
      const movements = await getDocs(query(collection(db, 'workspaces', wsA, 'receivable_movements'),
        where('receivableId', '==', 'rcv_late'), orderBy('date', 'desc'), orderBy(documentId(), 'desc'), limit(101)));
      assert.equal(movements.size, 1);
      const sample = await getDocs(query(receivablesRef, orderBy('dueDate', 'desc'), limit(500)));
      assert.equal(sample.size, 4);
    }
    for (const name of ['removedA', 'ownerB']) {
      const {db} = clients[name];
      for (const coll of SHARED) {
        await denied(getDoc(doc(db, `workspaces/${wsA}/${coll}/${existingId[coll]}`)), `${name} lê ${coll} de A`);
      }
      await denied(getDocs(query(collection(db, 'workspaces', wsA, 'receivables'), limit(10))), `${name} lista de A`);
    }
  });
});

/** Cliente sem autenticação, apontado para o Emulator. */
const anonymousClient = () => {
  const app = initializeApp({apiKey: 'rules-test', projectId}, `p3i-anon-${Date.now().toString(36)}`);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {app, db};
};

test('P3-I Rules — isolamento nos dois sentidos (A → B) e sem autenticação', async () => {
  const anonymous = anonymousClient();
  try {
    await withClients(['ownerA', 'adminA', 'memberA', 'viewerA'], async (clients) => {
      const attackers = [...Object.entries(clients), ['anônimo', anonymous]];
      for (const [name, {db}] of attackers) {
        const targets = name === 'anônimo' ? [wsA, wsB] : [wsB];
        for (const ws of targets) {
          for (const coll of COLLECTIONS) {
            await denied(getDoc(doc(db, `workspaces/${ws}/${coll}/${existingId[coll]}`)), `${name} lê ${coll} de ${ws}`);
            await denied(getDocs(query(collection(db, 'workspaces', ws, coll), limit(10))), `${name} lista ${coll} de ${ws}`);
            await denied(setDoc(doc(db, `workspaces/${ws}/${coll}/invasao-${name}`), {schemaVersion: 1, workspaceId: ws}),
              `${name} cria em ${coll} de ${ws}`);
            await denied(deleteDoc(doc(db, `workspaces/${ws}/${coll}/${existingId[coll]}`)), `${name} apaga ${coll} de ${ws}`);
          }
          await denied(getAggregateFromServer(query(collection(db, 'workspaces', ws, 'receivables'),
            where('status', '==', 'open')), {total: sum('balanceCents')}), `${name} soma recebíveis de ${ws}`);
          await denied(getDocs(query(collection(db, 'workspaces', ws, 'client_private'),
            where(documentId(), 'in', ['cli_1']), limit(1))), `${name} pede dados pessoais de ${ws}`);
        }
      }
    });
  } finally {
    await deleteApp(anonymous.app);
  }
  // Nada mudou em B.
  const db = getAdmin().firestore();
  assert.equal((await db.doc(`workspaces/${wsB}/client_private/cli_1`).get()).get('email'), 'financeiro@cliente.example');
  assert.equal((await db.collection(`workspaces/${wsB}/receivables`).count().get()).data().count, 4);
});

test('P3-I Rules — agregados dos cartões e do relatório: permitidos, exatos e isolados', async () => {
  await withClients(['viewerA', 'ownerB'], async ({viewerA, ownerB}) => {
    const ref = (db, ws) => collection(db, 'workspaces', ws, 'receivables');
    const open = where('status', '==', 'open');
    const total = async (db, ws, ...filters) =>
      (await getAggregateFromServer(query(ref(db, ws), ...filters), {total: sum('balanceCents')})).data().total;
    // Saldo em aberto: 60.000 (vencido) + 25.000 (no prazo); recebido e cancelado fora.
    assert.equal(await total(viewerA.db, wsA, open), 85_000);
    assert.equal(await total(viewerA.db, wsA, open, where('dueDate', '<', TODAY)), 60_000);
    assert.equal(await total(viewerA.db, wsA, open, where('dueDate', '>=', TODAY), where('dueDate', '<=', '2026-10-12')), 25_000);
    const received = await getAggregateFromServer(query(ref(viewerA.db, wsA), where('status', '==', 'received')),
      {count: count(), total: sum('principalReceivedCents')});
    assert.deepEqual(received.data(), {count: 1, total: 90_000});
    const openOfClient = await getAggregateFromServer(query(ref(viewerA.db, wsA),
      where('clientId', '==', 'cli_1'), open), {total: count()});
    assert.equal(openOfClient.data().total, 2);
    // O agregado não atravessa a fronteira do workspace.
    await denied(getAggregateFromServer(query(ref(ownerB.db, wsA), open), {total: sum('balanceCents')}),
      'owner de B soma recebíveis de A');
    assert.equal(await total(ownerB.db, wsB, open), 85_000, 'B soma os próprios');
  });
});

test('P3-I Rules — lançamento do cliente não forja nem altera espelho de recebimento', async () => {
  const db = getAdmin().firestore();
  await db.doc(`workspaces/${wsA}/transactions/recvcash_1`).set({
    type: 'receita', description: 'Recebimento de recebível', category: 'Recebíveis', value: 400,
    valueCents: 40_000, date: '2026-09-15', isPaid: true, workspaceId: wsA, profileId: wsA,
    userId: users.memberA.uid, source: 'receivable', createdAt: ts(), updatedAt: ts(),
    receivableEntry: {domainVersion: 1, receivableId: 'rcv_late', receivableMovementId: 'rmv_1',
      clientId: 'cli_1', kind: 'receipt', reversal: false, principalCents: 40_000, interestCents: 0,
      penaltyCents: 0, discountCents: 0, currency: 'BRL'},
  });
  await withClients(['memberA', 'ownerA'], async ({memberA, ownerA}) => {
    const plain = (overrides = {}) => ({
      type: 'receita', description: 'Venda', category: 'Vendas', value: 10, date: TODAY,
      transactionDate: serverTimestamp(), isPaid: true, source: 'manual', userId: users.memberA.uid,
      workspaceId: wsA, profileId: wsA, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      ...overrides,
    });
    // P4-D: nem o lançamento comum do cliente é aceito.
    await denied(setDoc(doc(memberA.db, `workspaces/${wsA}/transactions/comum-p3i`), plain()), 'cria lançamento comum');
    await denied(setDoc(doc(memberA.db, `workspaces/${wsA}/transactions/forjado-p3i`),
      plain({receivableEntry: {receivableId: 'rcv_late', principalCents: 1}})), 'cria espelho com receivableEntry');
    for (const {db: client, label} of [{...memberA, label: 'member'}, {...ownerA, label: 'owner'}]) {
      await denied(updateDoc(doc(client, `workspaces/${wsA}/transactions/recvcash_1`), {value: 1, updatedAt: serverTimestamp()}),
        `${label} altera espelho`);
      await denied(updateDoc(doc(client, `workspaces/${wsA}/transactions/recvcash_1`),
        {voidedAt: serverTimestamp(), voidedBy: users.ownerA.uid, voidReason: 'x', updatedAt: serverTimestamp()}),
      `${label} anula espelho`);
      await denied(deleteDoc(doc(client, `workspaces/${wsA}/transactions/recvcash_1`)), `${label} apaga espelho`);
    }
  });
  assert.equal((await db.doc(`workspaces/${wsA}/transactions/recvcash_1`).get()).get('valueCents'), 40_000);
});
