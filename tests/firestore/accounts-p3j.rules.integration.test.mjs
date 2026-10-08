import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {deleteApp, initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {
  addDoc,
  collection,
  connectFirestoreEmulator,
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
 * P3-J (D-30) — Rules de contas/carteiras, livro-razão e transferências
 * contra o Emulator.
 *
 * - Nenhum papel escreve em `cash_accounts`, `cash_account_movements`,
 *   `cash_transfers` ou `cash_account_events`: o cliente não cria conta, não
 *   altera `balanceCents`, não cria movimento nem transferência e não forja
 *   a origem de um movimento. O único caminho de escrita são as callables.
 * - Contas, movimentos e transferências: leitura de qualquer membro ativo
 *   (viewer incluído), nas consultas exatas do frontend, com teto de
 *   listagem; auditoria só owner/admin. Nada atravessa o workspace, nos
 *   dois sentidos, e nada é lido ou gravado sem autenticação.
 * - `transactions`: o cliente não grava `cashAccountId` nem `walletId`; o
 *   catálogo não aceita mais o grupo `wallet`.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da P3-J.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-p3j-123456';

const users = {
  ownerA: {uid: 'p3j-owner-a', email: 'p3j-owner-a@example.test'},
  adminA: {uid: 'p3j-admin-a', email: 'p3j-admin-a@example.test'},
  memberA: {uid: 'p3j-member-a', email: 'p3j-member-a@example.test'},
  viewerA: {uid: 'p3j-viewer-a', email: 'p3j-viewer-a@example.test'},
  removedA: {uid: 'p3j-removed-a', email: 'p3j-removed-a@example.test'},
  ownerB: {uid: 'p3j-owner-b', email: 'p3j-owner-b@example.test'},
};
const wsA = 'p3j-workspace-a';
const wsB = 'p3j-workspace-b';

const COLLECTIONS = ['cash_accounts', 'cash_account_movements', 'cash_transfers', 'cash_account_events'];
const SHARED = ['cash_accounts', 'cash_account_movements', 'cash_transfers'];
const existingId = {
  cash_accounts: 'acc_main', cash_account_movements: 'acm_1',
  cash_transfers: 'trf_1', cash_account_events: 'cash_account_created_1',
};

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const ts = () => getAdmin().firestore.Timestamp.fromDate(new Date('2026-10-05T12:00:00.000Z'));

const accountDoc = (ws, id, overrides = {}) => ({
  id, schemaVersion: 1, workspaceId: ws, name: id === 'acc_main' ? 'Carteira principal' : 'Poupança',
  accountType: 'cash', status: 'active', balanceCents: 10_000, currency: 'BRL',
  createdBy: users.ownerA.uid, updatedBy: users.ownerA.uid, createdAt: ts(), updatedAt: ts(), ...overrides,
});

const movementDoc = (ws, id, accountId, amountCents, effectiveDate) => ({
  id, schemaVersion: 1, workspaceId: ws, accountId, kind: amountCents < 0 ? 'transfer_out' : 'transfer_in',
  amountCents, currency: 'BRL', effectiveDate, sourceDomain: 'transfer', sourceId: 'trf_1',
  sourceFactId: 'trf_1', reversalOf: null, actorId: users.memberA.uid, operation: 'createCashTransfer',
  requestId: 'req-1', createdAt: ts(),
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
    db.doc(`workspaces/${wsA}`).set({ownerId: users.ownerA.uid, type: 'PF', name: 'A', currency: 'BRL', status: 'active'}),
    db.doc(`workspaces/${wsB}`).set({ownerId: users.ownerB.uid, type: 'PF', name: 'B', currency: 'BRL', status: 'active'}),
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
    batch.set(db.doc(`workspaces/${ws}/cash_accounts/acc_main`), accountDoc(ws, 'acc_main'));
    batch.set(db.doc(`workspaces/${ws}/cash_accounts/acc_save`), accountDoc(ws, 'acc_save', {balanceCents: -2_500}));
    batch.set(db.doc(`workspaces/${ws}/cash_account_movements/acm_1`), movementDoc(ws, 'acm_1', 'acc_main', -5_000, '2026-10-01'));
    batch.set(db.doc(`workspaces/${ws}/cash_account_movements/acm_2`), movementDoc(ws, 'acm_2', 'acc_main', 15_000, '2026-10-01'));
    batch.set(db.doc(`workspaces/${ws}/cash_account_movements/acm_3`), movementDoc(ws, 'acm_3', 'acc_save', 5_000, '2026-10-02'));
    batch.set(db.doc(`workspaces/${ws}/cash_transfers/trf_1`), {
      id: 'trf_1', schemaVersion: 1, workspaceId: ws, sourceAccountId: 'acc_main', destinationAccountId: 'acc_save',
      amountCents: 5_000, currency: 'BRL', date: '2026-10-01', status: 'completed', outMovementId: 'acm_1',
      inMovementId: 'acm_3', reversal: null, requestHash: 'h', createdBy: users.memberA.uid,
      updatedBy: users.memberA.uid, createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`workspaces/${ws}/cash_transfers/trf_2`), {
      id: 'trf_2', schemaVersion: 1, workspaceId: ws, sourceAccountId: 'acc_save', destinationAccountId: 'acc_main',
      amountCents: 1_000, currency: 'BRL', date: '2026-10-01', status: 'completed', outMovementId: 'x',
      inMovementId: 'y', reversal: null, requestHash: 'h', createdBy: users.ownerA.uid,
      updatedBy: users.ownerA.uid, createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`workspaces/${ws}/cash_account_events/cash_account_created_1`), {
      id: 'cash_account_created_1', schemaVersion: 1, workspaceId: ws, operation: 'cash_account.created',
      accountId: 'acc_main', transferId: null, actorId: users.ownerA.uid, intentId: 'intent-1', createdAt: ts(),
    });
    batch.set(db.doc(`workspaces/${ws}/transactions/cash_1`), {
      type: 'receita', description: 'Salário', category: 'Salário', value: 100, valueCents: 10_000,
      date: '2026-10-01', isPaid: true, workspaceId: ws, profileId: ws, userId: users.memberA.uid,
      cashAccountId: 'acc_main', cashEntry: {origin: 'manual', status: 'confirmed', accountMovementId: 'acm_x'},
      createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`workspaces/${ws}/transactions/plain_1`), {
      type: 'despesa', description: 'Mercado', category: 'Casa', value: 50, date: '2026-10-01',
      workspaceId: ws, profileId: ws, userId: users.memberA.uid, createdAt: ts(), updatedAt: ts(),
    });
    await batch.commit();
  }
};

const signedClient = async (user, suffix) => {
  const app = initializeApp(
    {apiKey: 'rules-test', projectId},
    `p3j-${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
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

test.before(seed);

test('P3-J Rules — nenhum papel cria, altera ou apaga contas, movimentos, transferências ou auditoria', async () => {
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA', 'ownerB'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const coll of COLLECTIONS) {
        const base = `workspaces/${wsA}/${coll}`;
        await denied(setDoc(doc(db, `${base}/novo-${name}`), {
          schemaVersion: 1, workspaceId: wsA, accountId: 'acc_main', kind: 'loan', amountCents: 999_999,
          sourceDomain: 'loan', sourceId: 'loan_forjado', balanceCents: 999_999, status: 'active',
          createdBy: users[name].uid, updatedAt: serverTimestamp(),
        }), `${name} cria em ${coll}`);
        await denied(updateDoc(doc(db, `${base}/${existingId[coll]}`), {balanceCents: 1_000_000}),
          `${name} altera ${coll}`);
        await denied(setDoc(doc(db, `${base}/${existingId[coll]}`), {status: 'reversed'}, {merge: true}),
          `${name} sobrescreve ${coll}`);
        await denied(deleteDoc(doc(db, `${base}/${existingId[coll]}`)), `${name} apaga ${coll}`);
      }
      const batch = writeBatch(db);
      batch.update(doc(db, `workspaces/${wsA}/cash_accounts/acc_main`), {balanceCents: 0});
      batch.set(doc(db, `workspaces/${wsA}/cash_account_movements/lote-${name}`), {amountCents: 1});
      await denied(batch.commit(), `${name} grava em lote`);
    }
  });
  const db = getAdmin().firestore();
  assert.equal((await db.doc(`workspaces/${wsA}/cash_accounts/acc_main`).get()).get('balanceCents'), 10_000);
  assert.equal((await db.collection(`workspaces/${wsA}/cash_account_movements`).get()).size, 3);
});

test('P3-J Rules — contas, extrato e transferências: leitura de membros, nas consultas do frontend', async () => {
  await withClients(['ownerA', 'memberA', 'viewerA', 'removedA', 'ownerB'], async (clients) => {
    for (const name of ['ownerA', 'memberA', 'viewerA']) {
      const {db} = clients[name];
      for (const coll of SHARED) {
        assert.equal((await getDoc(doc(db, `workspaces/${wsA}/${coll}/${existingId[coll]}`))).exists(), true,
          `${name} lê ${coll}`);
      }
      const accounts = collection(db, 'workspaces', wsA, 'cash_accounts');
      const list = await getDocs(query(accounts, orderBy('name'), orderBy(documentId()), limit(100)));
      assert.deepEqual(list.docs.map((entry) => entry.id), ['acc_main', 'acc_save']);
      const total = await getAggregateFromServer(query(accounts, limit(100)), {total: sum('balanceCents')});
      assert.equal(total.data().total, 7_500, 'saldo geral somado no servidor');
      // Extrato paginado por (data efetiva, ID), decrescente.
      const movements = collection(db, 'workspaces', wsA, 'cash_account_movements');
      const firstPage = await getDocs(query(movements, where('accountId', '==', 'acc_main'),
        orderBy('effectiveDate', 'desc'), orderBy(documentId(), 'desc'), limit(1)));
      assert.deepEqual(firstPage.docs.map((entry) => entry.id), ['acm_2']);
      const nextPage = await getDocs(query(movements, where('accountId', '==', 'acc_main'),
        orderBy('effectiveDate', 'desc'), orderBy(documentId(), 'desc'),
        startAfter('2026-10-01', 'acm_2'), limit(1)));
      assert.deepEqual(nextPage.docs.map((entry) => entry.id), ['acm_1'], 'empate de data cruza a página');
      const transfers = collection(db, 'workspaces', wsA, 'cash_transfers');
      const page = await getDocs(query(transfers, orderBy('date', 'desc'), orderBy(documentId(), 'desc'), limit(51)));
      assert.deepEqual(page.docs.map((entry) => entry.id), ['trf_2', 'trf_1']);
      // Sem teto ou acima dele: negado (nem a regra genérica concede).
      await denied(getDocs(query(accounts)), `${name} lista contas sem teto`);
      await denied(getDocs(query(movements, limit(101))), `${name} lista movimentos acima do teto`);
      await denied(getDocs(query(transfers)), `${name} lista transferências sem teto`);
    }
    for (const name of ['removedA', 'ownerB']) {
      const {db} = clients[name];
      for (const coll of SHARED) {
        await denied(getDoc(doc(db, `workspaces/${wsA}/${coll}/${existingId[coll]}`)), `${name} lê ${coll}`);
        await denied(getDocs(query(collection(db, 'workspaces', wsA, coll), limit(10))), `${name} lista ${coll}`);
      }
    }
  });
});

test('P3-J Rules — auditoria de contas: só owner/admin, com teto de listagem', async () => {
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA', 'ownerB'], async (clients) => {
    const coll = 'cash_account_events';
    for (const name of ['ownerA', 'adminA']) {
      const {db} = clients[name];
      assert.equal((await getDoc(doc(db, `workspaces/${wsA}/${coll}/${existingId[coll]}`))).exists(), true);
      assert.equal((await getDocs(query(collection(db, 'workspaces', wsA, coll), limit(50)))).size, 1);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, coll))), `${name} sem teto`);
    }
    for (const name of ['memberA', 'viewerA', 'ownerB']) {
      const {db} = clients[name];
      await denied(getDoc(doc(db, `workspaces/${wsA}/${coll}/${existingId[coll]}`)), `${name} lê auditoria`);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, coll), limit(10))), `${name} lista auditoria`);
    }
  });
});

test('P3-J Rules — o cliente não forja conta em lançamento nem usa o grupo `wallet`', async () => {
  await withClients(['ownerA', 'memberA'], async (clients) => {
    const {db} = clients.memberA;
    const base = {
      type: 'despesa', description: 'Forjado', category: 'Casa', value: 10, date: '2026-10-01',
      workspaceId: wsA, profileId: wsA, userId: users.memberA.uid,
    };
    // P4-D: nem o lançamento comum do cliente é aceito — `transactions` é só
    // do backend (cobertura completa em transactions-p4d.rules).
    await denied(addDoc(collection(db, 'workspaces', wsA, 'transactions'), base), 'cria lançamento comum');
    await denied(addDoc(collection(db, 'workspaces', wsA, 'transactions'),
      {...base, cashAccountId: 'acc_main'}), 'cria com cashAccountId');
    await denied(addDoc(collection(db, 'workspaces', wsA, 'transactions'),
      {...base, walletId: 'carteira-1'}), 'cria com walletId');
    await denied(updateDoc(doc(db, `workspaces/${wsA}/transactions/plain_1`), {cashAccountId: 'acc_main'}),
      'vincula conta a lançamento existente');
    await denied(updateDoc(doc(db, `workspaces/${wsA}/transactions/plain_1`), {walletId: 'carteira-1'}),
      'vincula carteira genérica');
    await denied(updateDoc(doc(db, `workspaces/${wsA}/transactions/cash_1`), {cashAccountId: 'acc_save'}),
      'troca a conta do lançamento do backend');
    await denied(updateDoc(doc(db, `workspaces/${wsA}/transactions/cash_1`), {description: 'Editado'}),
      'edita lançamento do backend');

    // Catálogo (D-23, P4-E): somente leitura no cliente — nem `wallet` nem
    // nenhum outro grupo é gravado pelo cliente; as callables são o caminho.
    const owner = clients.ownerA.db;
    const catalog = (group, id) => setDoc(doc(owner, `workspaces/${wsA}/settings_catalog/${id}`), {
      workspaceId: wsA, group, name: 'Carteira X', normalizedName: 'carteira x', dedupeKey: `${group}-x`,
      workspaceScope: 'both', sortOrder: 10, status: 'active', createdBy: users.ownerA.uid,
      updatedBy: users.ownerA.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await denied(catalog('payment_method', 'controle-pagamento'), 'cria item pelo cliente');
    await denied(catalog('wallet', 'carteira-generica'), 'cria item do grupo wallet');
  });
});

test('P3-J Rules — isolamento nos dois sentidos e sem autenticação', async () => {
  // Membros ativos de A (inclusive owner) não alcançam B; o caminho B → A
  // está coberto nos testes acima com `ownerB`.
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const coll of COLLECTIONS) {
        await denied(getDoc(doc(db, `workspaces/${wsB}/${coll}/${existingId[coll]}`)), `${name} lê ${coll} de B`);
        await denied(getDocs(query(collection(db, 'workspaces', wsB, coll), limit(10))), `${name} lista ${coll} de B`);
        await denied(updateDoc(doc(db, `workspaces/${wsB}/${coll}/${existingId[coll]}`), {balanceCents: 1}),
          `${name} altera ${coll} de B`);
        await denied(setDoc(doc(db, `workspaces/${wsB}/${coll}/forjado-${name}`), {workspaceId: wsB, amountCents: 1}),
          `${name} cria em ${coll} de B`);
      }
      await denied(getAggregateFromServer(query(collection(db, 'workspaces', wsB, 'cash_accounts'), limit(100)),
        {total: sum('balanceCents')}), `${name} soma saldos de B`);
    }
  });
  // Sem autenticação: nada é lido nem gravado.
  const app = initializeApp({apiKey: 'rules-test', projectId}, `p3j-anon-${Date.now().toString(36)}`);
  try {
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    for (const coll of COLLECTIONS) {
      await denied(getDoc(doc(db, `workspaces/${wsA}/${coll}/${existingId[coll]}`)), `anônimo lê ${coll}`);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, coll), limit(10))), `anônimo lista ${coll}`);
      await denied(setDoc(doc(db, `workspaces/${wsA}/${coll}/anonimo`), {amountCents: 1}), `anônimo cria em ${coll}`);
    }
  } finally {
    await deleteApp(app);
  }
  const adminDb = getAdmin().firestore();
  assert.equal((await adminDb.doc(`workspaces/${wsB}/cash_accounts/acc_main`).get()).get('balanceCents'), 10_000);
  assert.equal((await adminDb.collection(`workspaces/${wsB}/cash_account_movements`).get()).size, 3);
});
