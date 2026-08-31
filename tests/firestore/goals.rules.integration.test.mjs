import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {initializeApp, deleteApp} from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (!enabled) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules de metas.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-password-123456';

const ownerA = {uid: 'rules-owner-a', email: 'rules-owner-a@example.test'};
const ownerB = {uid: 'rules-owner-b', email: 'rules-owner-b@example.test'};
const workspaceA = 'rules-workspace-a';
const workspaceB = 'rules-workspace-b';

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const seed = async () => {
  const firebaseAdmin = getAdmin();
  const db = firebaseAdmin.firestore();
  for (const user of [ownerA, ownerB]) {
    try {
      await firebaseAdmin.auth().deleteUser(user.uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    await firebaseAdmin.auth().createUser({...user, password, emailVerified: true});
  }
  for (const [workspaceId, owner] of [[workspaceA, ownerA], [workspaceB, ownerB]]) {
    await db.recursiveDelete(db.doc(`workspaces/${workspaceId}`));
    await db.doc(`workspaces/${workspaceId}`).set({ownerId: owner.uid, type: 'PF', name: workspaceId});
    await db.doc(`workspaces/${workspaceId}/members/${owner.uid}`).set({uid: owner.uid, role: 'owner', status: 'active'});
    await db.doc(`workspaces/${workspaceId}/goals/server-goal-id`).set({name: 'Meta protegida'});
  }
  await db.doc(`workspaces/${workspaceA}/transactions/unlinked-transaction-id`).set({
    type: 'despesa', description: 'Sem vínculo', category: 'Moradia', value: 10,
    date: '2026-08-01', userId: ownerA.uid, workspaceId: workspaceA,
  });
};

const signedClient = async (user, suffix) => {
  const app = initializeApp({apiKey: 'rules-test', projectId}, `rules-${suffix}-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  await signInWithEmailAndPassword(auth, user.email, password);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {app, db};
};

/*
 * Transação gravável pelo cliente.
 *
 * `investimento` não entra aqui: esse tipo é negado ao cliente em qualquer
 * estado (`isLegacyInvestmentWriteAllowed`), e o que estes testes verificam é
 * o vínculo de meta — que precisa continuar negado mesmo num tipo permitido.
 */
const transactionPayload = (workspaceId, uid, extra = {}) => ({
  type: 'despesa',
  description: 'Despesa por regra',
  category: 'Moradia',
  value: 10,
  date: '2026-08-01',
  userId: uid,
  workspaceId,
  ...extra,
});

const withClients = async (run) => {
  const clientA = await signedClient(ownerA, `a-${Math.random().toString(36).slice(2, 8)}`);
  const clientB = await signedClient(ownerB, `b-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await run(clientA, clientB);
  } finally {
    await Promise.all([deleteApp(clientA.app), deleteApp(clientB.app)]);
  }
};

test('meta do próprio workspace é legível', async () => {
  await seed();
  await withClients(async (clientA) => {
    assert.equal(
      (await getDoc(doc(clientA.db, `workspaces/${workspaceA}/goals/server-goal-id`))).exists(),
      true,
    );
  });
});

test('metas são isoladas entre tenants nos dois sentidos', async () => {
  await seed();
  await withClients(async (clientA, clientB) => {
    await assert.rejects(() => getDoc(doc(clientA.db, `workspaces/${workspaceB}/goals/server-goal-id`)));
    await assert.rejects(() => getDoc(doc(clientB.db, `workspaces/${workspaceA}/goals/server-goal-id`)));
  });
});

test('cliente não cria meta diretamente', async () => {
  await seed();
  await withClients(async (clientA) => {
    await assert.rejects(() => setDoc(
      doc(clientA.db, `workspaces/${workspaceA}/goals/client-created-goal`),
      {name: 'Meta forjada'},
    ));
  });
});

test('cliente não forja nem cria vínculo de meta em transação', async () => {
  await seed();
  await withClients(async (clientA) => {
    await assert.rejects(() => setDoc(
      doc(clientA.db, `workspaces/${workspaceA}/transactions/forged-linked-contribution`),
      transactionPayload(workspaceA, ownerA.uid, {goalId: 'server-goal-id'}),
    ));
    await assert.rejects(() => updateDoc(
      doc(clientA.db, `workspaces/${workspaceA}/transactions/unlinked-transaction-id`),
      {goalId: 'server-goal-id'},
    ));
  });
});

test('transação sem vínculo de meta permanece permitida ao cliente', async () => {
  await seed();
  await withClients(async (clientA) => {
    await setDoc(
      doc(clientA.db, `workspaces/${workspaceA}/transactions/allowed-unlinked-contribution`),
      transactionPayload(workspaceA, ownerA.uid),
    );
  });
});
