import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {initializeApp, deleteApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {
  collection,
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
  where,
} from 'firebase/firestore';

/**
 * P2A — Rules do billing canônico.
 *
 * `billing_accounts/{uid}`: o titular ativo lê só o próprio estado; ninguém
 * lista, lê o de outro titular ou escreve. Trilha de billing, vínculo de
 * customer e recibos do webhook são backend-only nos dois sentidos.
 *
 * P2B.1 — estado de quota: `workspaces/{id}/quota_state/*` e
 * `billing_accounts/{uid}/quota_state/*` são backend-only nos dois sentidos,
 * inclusive para o owner do workspace e o titular da conta.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules de billing.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-password-123456';

const user = (uid) => ({uid, email: `${uid}@example.test`});
const users = {
  ownerA: user('p2-bill-owner-a'),
  ownerB: user('p2-bill-owner-b'),
  suspended: user('p2-bill-suspended'),
};

const getAdmin = () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const QUOTA_WORKSPACE = 'p2b-quota-rules-ws';

const billingOf = (uid, planId) => ({
  billingOwnerUid: uid,
  catalogVersion: 1,
  planId,
  entitlementStatus: planId === 'free' ? 'free' : 'active',
  subscriptionStatus: planId === 'free' ? 'none' : 'active',
  stripeCustomerId: planId === 'free' ? null : `cus_${uid}`,
  pendingCheckout: null,
});

const seed = async () => {
  const firebaseAdmin = getAdmin();
  const db = firebaseAdmin.firestore();
  for (const entry of Object.values(users)) {
    try {
      await firebaseAdmin.auth().deleteUser(entry.uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    await firebaseAdmin.auth().createUser({...entry, password, emailVerified: true});
    await db.doc(`users/${entry.uid}`).set({
      uid: entry.uid,
      status: entry === users.suspended ? 'suspended' : 'active',
    });
    await db.recursiveDelete(db.doc(`billing_accounts/${entry.uid}`));
  }
  await db.doc(`billing_accounts/${users.ownerA.uid}`).set(billingOf(users.ownerA.uid, 'pro'));
  await db.doc(`billing_accounts/${users.ownerB.uid}`).set(billingOf(users.ownerB.uid, 'free'));
  await db.doc(`billing_accounts/${users.suspended.uid}`).set(billingOf(users.suspended.uid, 'free'));
  await db.doc(`billing_accounts/${users.ownerA.uid}/billing_events/evt-1`).set({
    type: 'checkout.created', billingOwnerUid: users.ownerA.uid,
  });
  await db.doc(`billing_customers/cus_${users.ownerA.uid}`).set({billingOwnerUid: users.ownerA.uid});
  await db.doc('billing_webhook_events/evt_p2_rules').set({outcome: 'applied'});
  await db.doc(`billing_accounts/${users.ownerA.uid}/quota_state/ownership`).set({
    billingOwnerUid: users.ownerA.uid, activeOwnedWorkspaces: 1, schemaVersion: 1,
  });
  await db.recursiveDelete(db.doc(`workspaces/${QUOTA_WORKSPACE}`));
  await db.doc(`workspaces/${QUOTA_WORKSPACE}`).set({
    name: 'Quota', type: 'PF', ownerId: users.ownerA.uid, status: 'active',
  });
  for (const [entry, role] of [[users.ownerA, 'owner'], [users.ownerB, 'viewer']]) {
    await db.doc(`workspaces/${QUOTA_WORKSPACE}/members/${entry.uid}`).set({
      uid: entry.uid, role, status: 'active',
    });
  }
  await db.doc(`workspaces/${QUOTA_WORKSPACE}/quota_state/membership`).set({
    workspaceId: QUOTA_WORKSPACE, activeMembers: 2, pendingReservations: {}, schemaVersion: 1,
  });
  // Controle positivo: subcoleção comum, lida pela regra catch-all de membro.
  await db.doc(`workspaces/${QUOTA_WORKSPACE}/p2b_rules_control/doc-1`).set({ok: true});
};

const clients = [];
const signIn = async (entry) => {
  const app = initializeApp({
    apiKey: 'demo-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
  }, `p2-bill-${entry?.uid ?? 'anon'}-${clients.length}`);
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  const db = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port));
  if (entry) await signInWithEmailAndPassword(auth, entry.email, password);
  return db;
};

const denied = async (promise, label) => {
  await assert.rejects(promise, (error) => {
    assert.match(String(error?.code ?? error), /permission-denied/, label);
    return true;
  }, label);
};

let db;
test.before(async () => {
  await seed();
  db = {};
  for (const [name, entry] of Object.entries(users)) db[name] = await signIn(entry);
  db.anon = await signIn(null);
});

test.after(async () => {
  await Promise.all(clients.map((app) => deleteApp(app)));
});

test('titular ativo lê o próprio billing', async () => {
  const snapshot = await getDoc(doc(db.ownerA, `billing_accounts/${users.ownerA.uid}`));
  assert.equal(snapshot.data().planId, 'pro');
  assert.equal(
    (await getDoc(doc(db.ownerB, `billing_accounts/${users.ownerB.uid}`))).data().planId,
    'free',
  );
});

test('leitura cruzada, anônima e de conta suspensa é negada', async () => {
  await denied(getDoc(doc(db.ownerB, `billing_accounts/${users.ownerA.uid}`)), 'B lê A');
  await denied(getDoc(doc(db.ownerA, `billing_accounts/${users.ownerB.uid}`)), 'A lê B');
  await denied(getDoc(doc(db.anon, `billing_accounts/${users.ownerA.uid}`)), 'anônimo');
  await denied(
    getDoc(doc(db.suspended, `billing_accounts/${users.suspended.uid}`)),
    'conta suspensa',
  );
});

test('nenhuma listagem de billing, nem do próprio documento', async () => {
  await denied(getDocs(query(collection(db.ownerA, 'billing_accounts'), limit(1))), 'list');
  await denied(
    getDocs(query(
      collection(db.ownerA, 'billing_accounts'),
      where('billingOwnerUid', '==', users.ownerA.uid),
      limit(1),
    )),
    'list filtrado pelo próprio uid',
  );
});

test('cliente nunca cria, altera ou apaga billing', async () => {
  const own = doc(db.ownerB, `billing_accounts/${users.ownerB.uid}`);
  for (const forged of [
    {planId: 'business'},
    {entitlementStatus: 'active'},
    {subscriptionStatus: 'active'},
    {graceUntil: new Date(Date.now() + 86400000)},
    {stripeCustomerId: 'cus_forjado'},
    {pendingCheckout: null},
  ]) {
    await denied(updateDoc(own, forged), `update ${Object.keys(forged)}`);
    await denied(setDoc(own, forged, {merge: true}), `merge ${Object.keys(forged)}`);
  }
  await denied(deleteDoc(own), 'delete do próprio billing');
  await denied(
    setDoc(doc(db.ownerA, `billing_accounts/${users.ownerB.uid}`), billingOf(users.ownerB.uid, 'business')),
    'escrita cruzada',
  );
  await denied(
    setDoc(doc(db.anon, 'billing_accounts/p2-bill-novo'), billingOf('p2-bill-novo', 'pro')),
    'criação anônima',
  );
  const persisted = await getAdmin().firestore().doc(`billing_accounts/${users.ownerB.uid}`).get();
  assert.deepEqual(persisted.data(), billingOf(users.ownerB.uid, 'free'));
});

test('trilha, vínculo de customer e recibos do webhook são backend-only', async () => {
  const eventsPath = `billing_accounts/${users.ownerA.uid}/billing_events`;
  await denied(getDoc(doc(db.ownerA, `${eventsPath}/evt-1`)), 'titular lê a trilha');
  await denied(getDocs(query(collection(db.ownerA, eventsPath), limit(1))), 'titular lista a trilha');
  await denied(setDoc(doc(db.ownerA, `${eventsPath}/evt-2`), {type: 'x'}), 'titular escreve na trilha');
  const customer = `billing_customers/cus_${users.ownerA.uid}`;
  await denied(getDoc(doc(db.ownerA, customer)), 'titular lê o vínculo');
  await denied(setDoc(doc(db.ownerA, 'billing_customers/cus_novo'), {billingOwnerUid: users.ownerA.uid}), 'cria vínculo');
  await denied(getDoc(doc(db.ownerA, 'billing_webhook_events/evt_p2_rules')), 'lê recibo');
  await denied(
    getDocs(query(collection(db.ownerA, 'billing_webhook_events'), limit(1))),
    'lista recibos',
  );
  await denied(setDoc(doc(db.anon, 'billing_webhook_events/evt_forjado'), {outcome: 'applied'}), 'forja recibo');
});

test('P2B.1: quota do workspace é backend-only, mesmo para owner e membro', async () => {
  const base = `workspaces/${QUOTA_WORKSPACE}`;
  // A mesma leitura pela regra catch-all passa para a subcoleção comum.
  assert.equal((await getDoc(doc(db.ownerB, `${base}/p2b_rules_control/doc-1`))).data().ok, true);
  for (const [name, client] of [['owner', db.ownerA], ['viewer', db.ownerB], ['anônimo', db.anon]]) {
    await denied(getDoc(doc(client, `${base}/quota_state/membership`)), `${name} lê a quota`);
    await denied(
      getDocs(query(collection(client, `${base}/quota_state`), limit(1))),
      `${name} lista a quota`,
    );
    await denied(
      setDoc(doc(client, `${base}/quota_state/membership`), {activeMembers: 1, pendingReservations: {}}),
      `${name} reescreve a quota`,
    );
    await denied(
      updateDoc(doc(client, `${base}/quota_state/membership`), {activeMembers: 1}),
      `${name} altera a quota`,
    );
    await denied(deleteDoc(doc(client, `${base}/quota_state/membership`)), `${name} apaga a quota`);
    await denied(setDoc(doc(client, `${base}/quota_state/novo`), {x: 1}), `${name} cria documento de quota`);
  }
  const persisted = await getAdmin().firestore().doc(`${base}/quota_state/membership`).get();
  assert.equal(persisted.data().activeMembers, 2);
});

test('P2B.1: quota de ownership do titular é backend-only', async () => {
  const path = `billing_accounts/${users.ownerA.uid}/quota_state/ownership`;
  await denied(getDoc(doc(db.ownerA, path)), 'titular lê a própria quota');
  await denied(
    getDocs(query(collection(db.ownerA, `billing_accounts/${users.ownerA.uid}/quota_state`), limit(1))),
    'titular lista a própria quota',
  );
  await denied(getDoc(doc(db.ownerB, path)), 'leitura cruzada');
  await denied(setDoc(doc(db.ownerA, path), {activeOwnedWorkspaces: 0}), 'titular zera o contador');
  await denied(updateDoc(doc(db.ownerA, path), {activeOwnedWorkspaces: 0}), 'titular altera o contador');
  await denied(deleteDoc(doc(db.ownerA, path)), 'titular apaga o contador');
  const persisted = await getAdmin().firestore().doc(path).get();
  assert.equal(persisted.data().activeOwnedWorkspaces, 1);
});
