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
  setDoc,
  updateDoc,
} from 'firebase/firestore';

/**
 * P6-A (gate G0): a lista do piloto fechado (`pilot_access`) é só do backend.
 * Nenhum cliente, nem autenticado, nem anônimo, nem com conta ativa, lê, lista
 * ou grava convites. Se a lista vazasse, qualquer pessoa descobriria quem foi
 * convidada; se fosse gravável, qualquer pessoa se convidaria.
 */
const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules do piloto.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-password-123456';
const user = (uid) => ({uid, email: `${uid}@example.test`});
const users = {ativo: user('p6a-piloto-ativo'), novo: user('p6a-piloto-novo')};
const ENTRADA = 'b'.repeat(64);

const getAdmin = () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const seed = async () => {
  const firebaseAdmin = getAdmin();
  const firestore = firebaseAdmin.firestore();
  for (const entry of Object.values(users)) {
    try {
      await firebaseAdmin.auth().deleteUser(entry.uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    await firebaseAdmin.auth().createUser({...entry, password, emailVerified: true});
  }
  await firestore.doc(`users/${users.ativo.uid}`).set({uid: users.ativo.uid, accessStatus: 'granted', status: 'active'});
  await firestore.doc(`pilot_access/${ENTRADA}`).set({email: users.ativo.email, status: 'active'});
};

const clients = [];
const signIn = async (entry) => {
  const app = initializeApp({apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId},
    `p6a-piloto-${entry?.uid ?? 'anon'}-${clients.length}`);
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  const firestore = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(firestore, host, Number(port));
  if (entry) await signInWithEmailAndPassword(auth, entry.email, password);
  return firestore;
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
  db = {ativo: await signIn(users.ativo), novo: await signIn(users.novo), anon: await signIn(null)};
});

test.after(async () => {
  await Promise.all(clients.map((app) => deleteApp(app)));
});

test('ninguém lê nem lista a lista do piloto', async () => {
  for (const [nome, cliente] of Object.entries(db)) {
    await denied(getDoc(doc(cliente, `pilot_access/${ENTRADA}`)), `${nome}: get`);
    await denied(getDocs(collection(cliente, 'pilot_access')), `${nome}: list`);
  }
});

test('ninguém se convida, altera ou apaga convite pelo cliente', async () => {
  for (const [nome, cliente] of Object.entries(db)) {
    await denied(setDoc(doc(cliente, `pilot_access/${'c'.repeat(64)}`), {email: 'x@example.test', status: 'active'}),
      `${nome}: create`);
    await denied(updateDoc(doc(cliente, `pilot_access/${ENTRADA}`), {status: 'active'}), `${nome}: update`);
    await denied(deleteDoc(doc(cliente, `pilot_access/${ENTRADA}`)), `${nome}: delete`);
  }
});

test('controle: o convite continua intacto (o backend o lê)', async () => {
  const entrada = await getAdmin().firestore().doc(`pilot_access/${ENTRADA}`).get();
  assert.equal(entrada.get('status'), 'active');
});
