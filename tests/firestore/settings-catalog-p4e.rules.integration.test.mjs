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
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

/**
 * P4-E (D-23) — Rules do catálogo de configurações contra o Emulator.
 *
 * - `settings_catalog`: qualquer membro ativo (owner, admin, member e viewer)
 *   lê, nas consultas exatas do frontend e com teto de listagem; nenhum
 *   papel — nem o owner — cria, altera, inativa ou apaga pelo cliente. O
 *   único caminho de escrita são as callables do catálogo.
 * - `settings_catalog_uniques` (reservas de nome) e `settings_catalog_events`
 *   (auditoria): fechadas nos dois sentidos para todo papel; ninguém forja
 *   reserva, `catalogItemId`, `dedupeKey` ou autoria.
 * - Nada atravessa o workspace, nos dois sentidos, e nada é lido sem
 *   autenticação nem por membro removido.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da P4-E.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-p4e-123456';

const users = {
  ownerA: {uid: 'p4e-owner-a', email: 'p4e-owner-a@example.test'},
  adminA: {uid: 'p4e-admin-a', email: 'p4e-admin-a@example.test'},
  memberA: {uid: 'p4e-member-a', email: 'p4e-member-a@example.test'},
  viewerA: {uid: 'p4e-viewer-a', email: 'p4e-viewer-a@example.test'},
  removedA: {uid: 'p4e-removed-a', email: 'p4e-removed-a@example.test'},
  ownerB: {uid: 'p4e-owner-b', email: 'p4e-owner-b@example.test'},
};
const ACTIVE_A = ['ownerA', 'adminA', 'memberA', 'viewerA'];
const wsA = 'p4e-workspace-a';
const wsB = 'p4e-workspace-b';
const LIST_CAP = 2001;

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const ts = () => getAdmin().firestore.Timestamp.fromDate(new Date('2026-10-07T12:00:00.000Z'));

const itemDoc = (ws, overrides = {}) => ({
  schemaVersion: 1, workspaceId: ws, group: 'category', name: 'Alimentação',
  normalizedName: 'alimentacao', dedupeKey: 'category::despesa::both::alimentacao',
  workspaceScope: 'both', transactionSubtype: 'despesa', sortOrder: 10, status: 'active',
  createdBy: users.ownerA.uid, updatedBy: users.ownerA.uid, createdAt: ts(), updatedAt: ts(), ...overrides,
});

/** Mesmo documento, com datas que o SDK do cliente aceita enviar. */
const clientItemDoc = (ws) => itemDoc(ws, {createdAt: serverTimestamp(), updatedAt: serverTimestamp()});

const LOCK_ID = 'lock_0000000000000000000000000000000000000001';
const EVENT_ID = 'settings_catalog_created_0001';

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
    db.doc(`workspaces/${wsA}`).set({ownerId: users.ownerA.uid, type: 'PJ', name: 'A', status: 'active'}),
    db.doc(`workspaces/${wsB}`).set({ownerId: users.ownerB.uid, type: 'PF', name: 'B', status: 'active'}),
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
    batch.set(db.doc(`workspaces/${ws}/settings_catalog/seed_despesa`), itemDoc(ws));
    const {transactionSubtype: _subtype, ...paymentBase} = itemDoc(ws, {
      group: 'payment_method', name: 'Pix', normalizedName: 'pix', dedupeKey: 'payment_method::all::both::pix',
    });
    batch.set(db.doc(`workspaces/${ws}/settings_catalog/seed_pagamento`), paymentBase);
    batch.set(db.doc(`workspaces/${ws}/settings_catalog_uniques/${LOCK_ID}`), {
      schemaVersion: 1, workspaceId: ws, dedupeKey: 'category::despesa::both::alimentacao',
      catalogItemId: 'seed_despesa', group: 'category', createdBy: users.ownerA.uid, createdAt: ts(),
    });
    batch.set(db.doc(`workspaces/${ws}/settings_catalog_events/${EVENT_ID}`), {
      id: EVENT_ID, schemaVersion: 1, workspaceId: ws, operation: 'settings_catalog.created',
      itemId: 'seed_despesa', group: 'category', actorId: users.ownerA.uid, createdAt: ts(),
    });
    await batch.commit();
  }
};

const signedClient = async (user, suffix) => {
  const app = initializeApp(
    {apiKey: 'rules-test', projectId},
    `p4e-${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
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

/** Consulta da leitura completa (`listSettingsCatalogSnapshot`). */
const snapshotQuery = (db, ws, max = LIST_CAP) => query(
  collection(db, 'workspaces', ws, 'settings_catalog'),
  orderBy('sortOrder', 'asc'), orderBy('normalizedName', 'asc'), orderBy(documentId(), 'asc'),
  limit(max),
);

/** Consulta paginada de Cadastros (`listSettingsCatalogPage`). */
const pageQuery = (db, ws) => query(
  collection(db, 'workspaces', ws, 'settings_catalog'),
  where('group', '==', 'category'), where('transactionSubtype', '==', 'despesa'),
  where('status', '==', 'active'),
  orderBy('sortOrder', 'asc'), orderBy('normalizedName', 'asc'), orderBy(documentId(), 'asc'),
  limit(31),
);

test.before(seed);

test('P4-E Rules — todo membro ativo lê o catálogo nas consultas do frontend, com teto', async () => {
  await withClients(ACTIVE_A, async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const item = await getDoc(doc(db, `workspaces/${wsA}/settings_catalog/seed_despesa`));
      assert.equal(item.get('name'), 'Alimentação', `${name} lê o item`);
      assert.equal((await getDocs(snapshotQuery(db, wsA))).size, 2, `${name} lê o catálogo completo`);
      assert.equal((await getDocs(pageQuery(db, wsA))).size, 1, `${name} pagina Cadastros`);
      // Acima do teto e sem limite: negado (a catch-all não reabre a listagem).
      await denied(getDocs(snapshotQuery(db, wsA, LIST_CAP + 1)), `${name} lista acima do teto`);
      await denied(getDocs(collection(db, 'workspaces', wsA, 'settings_catalog')), `${name} lista sem limite`);
    }
  });
});

test('P4-E Rules — nenhum papel cria, altera, inativa, reativa ou apaga item do catálogo', async () => {
  await withClients([...ACTIVE_A, 'ownerB'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const base = `workspaces/${wsA}/settings_catalog`;
      const forged = itemDoc(wsA, {
        name: `Forjado ${name}`, normalizedName: `forjado ${name}`,
        dedupeKey: `category::despesa::both::forjado ${name}`,
        createdBy: users[name].uid, updatedBy: users[name].uid,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      await denied(setDoc(doc(db, `${base}/novo-${name}`), forged), `${name} cria item`);
      await denied(addDoc(collection(db, 'workspaces', wsA, 'settings_catalog'), forged), `${name} cria item com ID automático`);
      await denied(updateDoc(doc(db, `${base}/seed_despesa`), {name: 'Renomeado', updatedBy: users[name].uid,
        updatedAt: serverTimestamp()}), `${name} renomeia`);
      await denied(updateDoc(doc(db, `${base}/seed_despesa`), {status: 'inactive'}), `${name} inativa`);
      await denied(updateDoc(doc(db, `${base}/seed_despesa`), {workspaceScope: 'PJ'}), `${name} troca o escopo`);
      await denied(updateDoc(doc(db, `${base}/seed_despesa`), {transactionSubtype: 'parcelado'}),
        `${name} grava subtipo parcelado`);
      await denied(setDoc(doc(db, `${base}/seed_despesa`), {status: 'active'}, {merge: true}), `${name} reativa`);
      await denied(deleteDoc(doc(db, `${base}/seed_despesa`)), `${name} apaga`);
      // O antigo caminho do cliente: item e reserva na mesma transação.
      await denied(runTransaction(db, async (transaction) => {
        transaction.set(doc(db, `${base}/tx-${name}`), forged);
        transaction.set(doc(db, `workspaces/${wsA}/settings_catalog_uniques/tx-${name}`), {
          dedupeKey: forged.dedupeKey, catalogItemId: `tx-${name}`, workspaceId: wsA,
        });
      }), `${name} grava item + reserva em transação`);
      const batch = writeBatch(db);
      batch.set(doc(db, `${base}/batch-${name}`), forged);
      await denied(batch.commit(), `${name} grava em lote`);
    }
  });
  const db = getAdmin().firestore();
  const item = (await db.doc(`workspaces/${wsA}/settings_catalog/seed_despesa`).get()).data();
  assert.equal(item.name, 'Alimentação');
  assert.equal(item.status, 'active');
  assert.equal((await db.collection(`workspaces/${wsA}/settings_catalog`).get()).size, 2);
});

test('P4-E Rules — reservas de nome e auditoria do catálogo: ninguém lê nem grava', async () => {
  await withClients([...ACTIVE_A, 'ownerB'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const [coll, id] of [['settings_catalog_uniques', LOCK_ID], ['settings_catalog_events', EVENT_ID]]) {
        const base = `workspaces/${wsA}/${coll}`;
        await denied(getDoc(doc(db, `${base}/${id}`)), `${name} lê ${coll}`);
        await denied(getDocs(query(collection(db, 'workspaces', wsA, coll), limit(10))), `${name} lista ${coll}`);
        await denied(setDoc(doc(db, `${base}/forjado-${name}`), {
          schemaVersion: 1, workspaceId: wsA, dedupeKey: 'category::despesa::both::forjado',
          catalogItemId: 'seed_despesa', group: 'category', createdBy: users[name].uid, createdAt: serverTimestamp(),
        }), `${name} forja ${coll}`);
        await denied(updateDoc(doc(db, `${base}/${id}`), {catalogItemId: 'outro'}), `${name} altera ${coll}`);
        await denied(deleteDoc(doc(db, `${base}/${id}`)), `${name} apaga ${coll}`);
      }
    }
  });
  const db = getAdmin().firestore();
  const lock = (await db.doc(`workspaces/${wsA}/settings_catalog_uniques/${LOCK_ID}`).get()).data();
  assert.equal(lock.catalogItemId, 'seed_despesa');
  assert.equal((await db.collection(`workspaces/${wsA}/settings_catalog_uniques`).get()).size, 1);
});

test('P4-E Rules — isolamento A↔B, membro removido e sem autenticação', async () => {
  await withClients([...ACTIVE_A, 'removedA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      await denied(getDoc(doc(db, `workspaces/${wsB}/settings_catalog/seed_despesa`)), `${name} lê item de B`);
      await denied(getDocs(snapshotQuery(db, wsB)), `${name} lista catálogo de B`);
      await denied(setDoc(doc(db, `workspaces/${wsB}/settings_catalog/forjado-${name}`), clientItemDoc(wsB)),
        `${name} cria item em B`);
    }
    // Removido não lê nem o próprio workspace.
    await denied(getDoc(doc(clients.removedA.db, `workspaces/${wsA}/settings_catalog/seed_despesa`)),
      'removido lê item');
    await denied(getDocs(snapshotQuery(clients.removedA.db, wsA)), 'removido lista catálogo');
  });
  await withClients(['ownerB'], async ({ownerB}) => {
    await denied(getDoc(doc(ownerB.db, `workspaces/${wsA}/settings_catalog/seed_despesa`)), 'owner de B lê item de A');
    await denied(getDocs(snapshotQuery(ownerB.db, wsA)), 'owner de B lista catálogo de A');
  });
  const app = initializeApp({apiKey: 'rules-test', projectId}, `p4e-anon-${Date.now().toString(36)}`);
  try {
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    await denied(getDoc(doc(db, `workspaces/${wsA}/settings_catalog/seed_despesa`)), 'anônimo lê item');
    await denied(getDocs(snapshotQuery(db, wsA)), 'anônimo lista catálogo');
    await denied(setDoc(doc(db, `workspaces/${wsA}/settings_catalog/anonimo`), clientItemDoc(wsA)), 'anônimo cria item');
    await denied(getDoc(doc(db, `workspaces/${wsA}/settings_catalog_uniques/${LOCK_ID}`)), 'anônimo lê reserva');
  } finally {
    await deleteApp(app);
  }
});
