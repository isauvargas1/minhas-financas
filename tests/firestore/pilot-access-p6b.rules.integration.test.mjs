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
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

/**
 * P6-B (gate G0) — autorização do piloto fechado nas Rules.
 *
 * `hasActiveAccount()` exige `users/{uid}.status == 'active'` E
 * `users/{uid}.accessStatus == 'granted'`. Uma conta anterior à P6-B (perfil
 * ativo sem o campo), uma conta revogada e qualquer valor que não seja
 * exatamente `'granted'` não leem nem escrevem dado de workspace, índice de
 * workspaces, a própria membership, o billing, a preferência de tempo de
 * trabalho nem o estado de notificação, mesmo com membership `owner` ativo e
 * ID token vigente. O cliente nunca grava o perfil (logo, nunca se autoriza).
 *
 * Os controles positivos (conta autorizada lê e, onde há escrita de cliente,
 * grava) provam que a negação vem da autorização e não de outra regra.
 */
const require = createRequire(import.meta.url);
const requireAdmin = createRequire(new URL('../../functions/package.json', import.meta.url));
const adminAppModule = requireAdmin('firebase-admin/app');
const adminFirestoreModule = requireAdmin('firebase-admin/firestore');
const adminAuthModule = requireAdmin('firebase-admin/auth');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules do piloto.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-password-123456';
const user = (uid) => ({uid, email: `${uid}@example.test`});

const WS_A = 'p6b-ws-a';
const WS_B = 'p6b-ws-b';
const PREFERENCE = 'work_time_equivalent';
const ROUTINES = 'W:08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,-,-';

/** Perfis semeados: valor de `accessStatus` (`undefined` = campo ausente) e `status`. */
const profiles = {
  antiga: {accessStatus: undefined, status: 'active'},
  revogada: {accessStatus: 'revoked', status: 'active'},
  maiuscula: {accessStatus: 'GRANTED', status: 'active'},
  booleana: {accessStatus: true, status: 'active'},
  aproximada: {accessStatus: 'grant', status: 'active'},
  nula: {accessStatus: null, status: 'active'},
  suspensa: {accessStatus: 'granted', status: 'suspended'},
  vigenteRevogada: {accessStatus: 'granted', status: 'active'},
  vigenteSuspensa: {accessStatus: 'granted', status: 'active'},
  donoA: {accessStatus: 'granted', status: 'active'},
  adminA: {accessStatus: 'granted', status: 'active'},
  membroA: {accessStatus: 'granted', status: 'active'},
  leitorA: {accessStatus: 'granted', status: 'active'},
  donoB: {accessStatus: 'granted', status: 'active'},
  semPerfil: null,
};
const roles = {donoA: 'owner', adminA: 'admin', membroA: 'member', leitorA: 'viewer'};
/** Todo perfil com membership `owner` ativo no workspace A (o pior caso para a autorização). */
const ownerOfA = ['antiga', 'revogada', 'maiuscula', 'booleana', 'aproximada', 'nula', 'suspensa',
  'vigenteRevogada', 'vigenteSuspensa', 'semPerfil'];
const users = Object.fromEntries(Object.keys(profiles).map((nome) => [nome, user(`p6b-${nome.toLowerCase()}`)]));

const getAdmin = () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!adminAppModule.getApps().length) adminAppModule.initializeApp({projectId});
  return adminAppModule.getApp();
};

const validPreference = () => ({
  schemaVersion: 2,
  enabled: true,
  displayMode: 'time',
  estimateMode: 'habitual',
  historyMonths: 3,
  incomeWorkspaceId: WS_A,
  allowBusinessIncome: false,
  excludedIncomeIds: '',
  routines: ROUTINES,
  worksOnHolidays: false,
  uf: 'SP',
  municipality: 'São Paulo',
  localHolidays: '01-25',
  exceptions: '',
  updatedAt: serverTimestamp(),
});
const storedPreference = () => ({...validPreference(), updatedAt: (getAdmin(), adminFirestoreModule.FieldValue).serverTimestamp()});

const seedProfile = async (firestore, nome) => {
  const entry = users[nome];
  const ref = firestore.doc(`users/${entry.uid}`);
  await firestore.recursiveDelete(ref);
  const profile = profiles[nome];
  if (profile === null) return;
  const data = {uid: entry.uid, email: entry.email, status: profile.status};
  if (profile.accessStatus !== undefined) data.accessStatus = profile.accessStatus;
  await ref.set(data);
};

const seed = async () => {
  const firebaseAdmin = getAdmin();
  const firestore = adminFirestoreModule.getFirestore(firebaseAdmin);
  for (const nome of Object.keys(profiles)) {
    const entry = users[nome];
    try {
      await adminAuthModule.getAuth(firebaseAdmin).deleteUser(entry.uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    await adminAuthModule.getAuth(firebaseAdmin).createUser({...entry, password, emailVerified: true});
    await seedProfile(firestore, nome);
  }
  await Promise.all([WS_A, WS_B].map((ws) => firestore.recursiveDelete(firestore.doc(`workspaces/${ws}`))));
  await firestore.doc(`workspaces/${WS_A}`).set({name: 'A', type: 'PF', ownerId: users.donoA.uid, status: 'active', currency: 'BRL'});
  await firestore.doc(`workspaces/${WS_B}`).set({name: 'B', type: 'PF', ownerId: users.donoB.uid, status: 'active', currency: 'BRL'});
  const members = [
    ...Object.entries(roles).map(([nome, role]) => [WS_A, nome, role]),
    ...ownerOfA.map((nome) => [WS_A, nome, 'owner']),
    [WS_B, 'donoB', 'owner'],
  ];
  for (const [ws, nome, role] of members) {
    const uid = users[nome].uid;
    await firestore.doc(`workspaces/${ws}/members/${uid}`).set({uid, role, status: 'active'});
    await firestore.doc(`users/${uid}/workspaces/${ws}`).set({workspaceId: ws, status: 'active', name: ws, type: 'PF', workspaceStatus: 'active'});
  }
  for (const ws of [WS_A, WS_B]) {
    await firestore.doc(`workspaces/${ws}/transactions/t1`).set({type: 'despesa', date: '2026-10-10', workspaceId: ws, valueCents: 1000});
    await firestore.doc(`workspaces/${ws}/cash_accounts/a1`).set({name: 'Conta', workspaceId: ws});
    await firestore.doc(`workspaces/${ws}/goals/g1`).set({name: 'Meta', workspaceId: ws});
    await firestore.doc(`workspaces/${ws}/goal_audit_logs/l1`).set({goalId: 'g1', workspaceId: ws});
  }
  for (const nome of Object.keys(profiles)) {
    const uid = users[nome].uid;
    await firestore.doc(`billing_accounts/${uid}`).set({billingOwnerUid: uid, planId: 'free'});
    await firestore.doc(`users/${uid}/private_preferences/${PREFERENCE}`).set(storedPreference());
  }
};

const clients = [];
const signIn = async (entry) => {
  const app = initializeApp({apiKey: 'demo-api-key', authDomain: `${projectId}.firebaseapp.com`, projectId},
    `p6b-${entry.uid}-${clients.length}`);
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  const firestore = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(firestore, host, Number(port));
  await signInWithEmailAndPassword(auth, entry.email, password);
  return firestore;
};

const denied = async (promise, label) => {
  await assert.rejects(promise, (error) => {
    assert.match(String(error?.code ?? error), /permission-denied/, label);
    return true;
  }, label);
};

const allowed = async (promise, label) => {
  try {
    return await promise;
  } catch (error) {
    assert.fail(`${label}: esperava permitido, recebeu ${String(error?.code ?? error)}`);
  }
};

let db;
test.before(async () => {
  await seed();
  db = {};
  for (const nome of Object.keys(profiles)) db[nome] = await signIn(users[nome]);
});

test.after(async () => {
  await Promise.all(clients.map((app) => deleteApp(app)));
});

const col = (firestore, path) => collection(firestore, path);

/** Toda leitura e escrita protegida por `hasActiveAccount()`, para o próprio uid, no workspace A. */
const assertAllDenied = async (nome) => {
  const firestore = db[nome];
  const uid = users[nome].uid;
  const label = (acao) => `${nome}: ${acao}`;
  // Dados financeiros e do workspace.
  await denied(getDoc(doc(firestore, `workspaces/${WS_A}/transactions/t1`)), label('get transactions'));
  await denied(getDocs(query(col(firestore, `workspaces/${WS_A}/transactions`), limit(5))), label('list transactions'));
  await denied(getDoc(doc(firestore, `workspaces/${WS_A}/cash_accounts/a1`)), label('get accounts'));
  await denied(getDocs(query(col(firestore, `workspaces/${WS_A}/cash_accounts`), limit(5))), label('list accounts'));
  await denied(getDoc(doc(firestore, `workspaces/${WS_A}`)), label('get workspace'));
  await denied(getDoc(doc(firestore, `workspaces/${WS_A}/goals/g1`)), label('get goals'));
  await denied(getDoc(doc(firestore, `workspaces/${WS_A}/goal_audit_logs/l1`)), label('get trilha (owner)'));
  // Escritas em dado financeiro (negadas a todos; aqui a conta também não está autorizada).
  await denied(setDoc(doc(firestore, `workspaces/${WS_A}/transactions/novo`), {type: 'despesa', date: '2026-10-11', valueCents: 1}),
    label('create transactions'));
  await denied(updateDoc(doc(firestore, `workspaces/${WS_A}/transactions/t1`), {valueCents: 1}), label('update transactions'));
  await denied(deleteDoc(doc(firestore, `workspaces/${WS_A}/transactions/t1`)), label('delete transactions'));
  await denied(setDoc(doc(firestore, `workspaces/${WS_A}/cash_accounts/novo`), {name: 'X'}), label('create accounts'));
  await denied(updateDoc(doc(firestore, `workspaces/${WS_A}/cash_accounts/a1`), {name: 'Y'}), label('update accounts'));
  await denied(deleteDoc(doc(firestore, `workspaces/${WS_A}/cash_accounts/a1`)), label('delete accounts'));
  // Índice de workspaces, membership própria e billing.
  await denied(getDoc(doc(firestore, `users/${uid}/workspaces/${WS_A}`)), label('get índice'));
  await denied(getDocs(query(col(firestore, `users/${uid}/workspaces`), limit(10))), label('list índice'));
  await denied(getDoc(doc(firestore, `workspaces/${WS_A}/members/${uid}`)), label('get members/{uid}'));
  await denied(getDoc(doc(firestore, `billing_accounts/${uid}`)), label('get billing'));
  // Preferência de tempo de trabalho: leitura, criação/atualização válidas e exclusão.
  await denied(getDoc(doc(firestore, `users/${uid}/private_preferences/${PREFERENCE}`)), label('get preferência'));
  await denied(setDoc(doc(firestore, `users/${uid}/private_preferences/${PREFERENCE}`), validPreference()), label('set preferência'));
  await denied(deleteDoc(doc(firestore, `users/${uid}/private_preferences/${PREFERENCE}`)), label('delete preferência'));
  // Estado de notificação do próprio usuário.
  await denied(getDoc(doc(firestore, `workspaces/${WS_A}/notification_user_states/${uid}/notification_entries/n1`)),
    label('get estado de notificação'));
  await denied(getDocs(query(col(firestore, `workspaces/${WS_A}/notification_user_states/${uid}/notification_entries`), limit(5))),
    label('list estado de notificação'));
};

test('controle: conta autorizada lê dados, índice, membership, billing e preferência, e grava a preferência', async () => {
  const firestore = db.donoA;
  const uid = users.donoA.uid;
  await allowed(getDoc(doc(firestore, `workspaces/${WS_A}/transactions/t1`)), 'get transactions');
  assert.equal((await allowed(getDocs(query(col(firestore, `workspaces/${WS_A}/transactions`), limit(5))), 'list transactions')).size, 1);
  assert.equal((await allowed(getDocs(query(col(firestore, `workspaces/${WS_A}/cash_accounts`), limit(5))), 'list accounts')).size, 1);
  assert.equal((await allowed(getDoc(doc(firestore, `workspaces/${WS_A}`)), 'get workspace')).exists(), true);
  assert.equal((await allowed(getDoc(doc(firestore, `users/${uid}/workspaces/${WS_A}`)), 'get índice')).exists(), true);
  assert.equal((await allowed(getDocs(query(col(firestore, `users/${uid}/workspaces`), limit(10))), 'list índice')).size, 1);
  assert.equal((await allowed(getDoc(doc(firestore, `workspaces/${WS_A}/members/${uid}`)), 'get members/{uid}')).exists(), true);
  assert.equal((await allowed(getDoc(doc(firestore, `billing_accounts/${uid}`)), 'get billing')).get('planId'), 'free');
  await allowed(getDoc(doc(firestore, `users/${uid}/private_preferences/${PREFERENCE}`)), 'get preferência');
  await allowed(setDoc(doc(firestore, `users/${uid}/private_preferences/${PREFERENCE}`), validPreference()), 'set preferência');
  await allowed(getDoc(doc(firestore, `workspaces/${WS_A}/notification_user_states/${uid}/notification_entries/n1`)),
    'get estado de notificação');
  // As escritas financeiras do cliente continuam negadas mesmo autorizado (são do backend).
  await denied(setDoc(doc(firestore, `workspaces/${WS_A}/transactions/novo`), {type: 'despesa', valueCents: 1}), 'create transactions');
});

test('R1: conta antiga (perfil ativo sem accessStatus) com membership owner ativo não lê nem escreve nada protegido', async () => {
  await assertAllDenied('antiga');
});

test('R1: o próprio perfil continua legível à conta antiga, para a interface descobrir o estado', async () => {
  const profile = await allowed(getDoc(doc(db.antiga, `users/${users.antiga.uid}`)), 'get perfil');
  assert.equal(profile.get('accessStatus'), undefined);
  assert.equal(profile.get('status'), 'active');
});

test('R2: accessStatus revogado nega tudo, mesmo com status ativo e membership owner', async () => {
  await assertAllDenied('revogada');
});

test('R2: valores não exatos de accessStatus negam tudo', async () => {
  for (const nome of ['maiuscula', 'booleana', 'aproximada', 'nula']) {
    await assertAllDenied(nome);
  }
});

test('R2: accessStatus granted com status suspenso também nega tudo', async () => {
  await assertAllDenied('suspensa');
});

test('R2: conta sem perfil nega tudo, mesmo com membership owner ativo', async () => {
  await assertAllDenied('semPerfil');
});

test('R3: conta autorizada lê por papel, conforme as Rules vigentes', async () => {
  for (const nome of Object.keys(roles)) {
    const firestore = db[nome];
    const label = (acao) => `${nome}: ${acao}`;
    await allowed(getDoc(doc(firestore, `workspaces/${WS_A}/transactions/t1`)), label('get transactions'));
    await allowed(getDocs(query(col(firestore, `workspaces/${WS_A}/cash_accounts`), limit(5))), label('list accounts'));
    await allowed(getDoc(doc(firestore, `workspaces/${WS_A}/goals/g1`)), label('get goals'));
    await allowed(getDoc(doc(firestore, `workspaces/${WS_A}/members/${users[nome].uid}`)), label('get members/{uid}'));
  }
  // A trilha das metas é de owner/admin.
  for (const nome of ['donoA', 'adminA']) {
    await allowed(getDoc(doc(db[nome], `workspaces/${WS_A}/goal_audit_logs/l1`)), `${nome}: get trilha`);
  }
  for (const nome of ['membroA', 'leitorA']) {
    await denied(getDoc(doc(db[nome], `workspaces/${WS_A}/goal_audit_logs/l1`)), `${nome}: get trilha`);
  }
  // Nenhum papel escreve dado financeiro pelo cliente.
  for (const nome of Object.keys(roles)) {
    await denied(setDoc(doc(db[nome], `workspaces/${WS_A}/transactions/novo`), {type: 'despesa', valueCents: 1}), `${nome}: create`);
    await denied(deleteDoc(doc(db[nome], `workspaces/${WS_A}/transactions/t1`)), `${nome}: delete`);
  }
});

test('R3: a conta autorizada de A não lê nem lista o workspace de B', async () => {
  for (const nome of Object.keys(roles)) {
    const firestore = db[nome];
    await denied(getDoc(doc(firestore, `workspaces/${WS_B}/transactions/t1`)), `${nome}: get transactions de B`);
    await denied(getDocs(query(col(firestore, `workspaces/${WS_B}/transactions`), limit(5))), `${nome}: list transactions de B`);
    await denied(getDoc(doc(firestore, `workspaces/${WS_B}`)), `${nome}: get workspace B`);
    await denied(getDoc(doc(firestore, `workspaces/${WS_B}/members/${users.donoB.uid}`)), `${nome}: get member de B`);
  }
  await denied(getDoc(doc(db.donoA, `billing_accounts/${users.donoB.uid}`)), 'billing de B');
  await denied(getDoc(doc(db.donoA, `users/${users.donoB.uid}/workspaces/${WS_B}`)), 'índice de B');
  await allowed(getDoc(doc(db.donoB, `workspaces/${WS_B}/transactions/t1`)), 'controle: B lê o próprio workspace');
});

test('R4: o cliente não grava o próprio perfil para se autorizar, em nenhum estado', async () => {
  const firestore = adminFirestoreModule.getFirestore(getAdmin());
  const tentativas = ['antiga', 'revogada', 'donoA', 'semPerfil'];
  const before = {};
  for (const nome of tentativas) {
    const snapshot = await firestore.doc(`users/${users[nome].uid}`).get();
    before[nome] = snapshot.exists ? snapshot.data() : null;
  }
  for (const nome of tentativas) {
    const ref = doc(db[nome], `users/${users[nome].uid}`);
    const label = (acao) => `${nome}: ${acao}`;
    await denied(setDoc(ref, {uid: users[nome].uid, status: 'active', accessStatus: 'granted'}), label('set'));
    await denied(setDoc(ref, {accessStatus: 'granted'}, {merge: true}), label('set merge'));
    await denied(updateDoc(ref, {accessStatus: 'granted'}), label('update'));
    await denied(updateDoc(ref, {accessStatus: 'granted', status: 'active', accessSource: 'pilot_invite'}), label('update completo'));
    await denied(deleteDoc(ref), label('delete'));
  }
  for (const nome of tentativas) {
    const snapshot = await firestore.doc(`users/${users[nome].uid}`).get();
    assert.deepEqual(snapshot.exists ? snapshot.data() : null, before[nome], `${nome}: perfil inalterado`);
  }
  assert.equal((await firestore.doc(`users/${users.semPerfil.uid}`).get()).exists, false, 'quem não tem perfil não o cria');
});

test('R5: ID token vigente — a conta lê antes e é negada depois que o backend revoga o acesso', async () => {
  const nome = 'vigenteRevogada';
  const firestore = db[nome];
  const uid = users[nome].uid;
  await allowed(getDoc(doc(firestore, `workspaces/${WS_A}/transactions/t1`)), 'get antes');
  assert.equal((await allowed(getDocs(query(col(firestore, `workspaces/${WS_A}/transactions`), limit(5))), 'list antes')).size, 1);
  await allowed(getDocs(query(col(firestore, `users/${uid}/workspaces`), limit(10))), 'índice antes');
  await allowed(getDoc(doc(firestore, `billing_accounts/${uid}`)), 'billing antes');

  await adminFirestoreModule.getFirestore(getAdmin()).doc(`users/${uid}`).update({accessStatus: 'revoked'});

  await assertAllDenied(nome);
});

test('R5: ID token vigente — a conta lê antes e é negada depois de suspensa, ainda com accessStatus granted', async () => {
  const nome = 'vigenteSuspensa';
  const firestore = db[nome];
  const uid = users[nome].uid;
  await allowed(getDoc(doc(firestore, `workspaces/${WS_A}/transactions/t1`)), 'get antes');
  await allowed(getDocs(query(col(firestore, `users/${uid}/workspaces`), limit(10))), 'índice antes');

  await adminFirestoreModule.getFirestore(getAdmin()).doc(`users/${uid}`).update({status: 'suspended'});
  assert.equal((await adminFirestoreModule.getFirestore(getAdmin()).doc(`users/${uid}`).get()).get('accessStatus'), 'granted');

  await assertAllDenied(nome);
});

test('R5: reautorizar o perfil devolve o acesso na requisição seguinte, sem novo login', async () => {
  const nome = 'vigenteRevogada';
  const uid = users[nome].uid;
  await denied(getDoc(doc(db[nome], `workspaces/${WS_A}/transactions/t1`)), 'antes de reautorizar');
  await adminFirestoreModule.getFirestore(getAdmin()).doc(`users/${uid}`).update({accessStatus: 'granted'});
  await allowed(getDoc(doc(db[nome], `workspaces/${WS_A}/transactions/t1`)), 'depois de reautorizar');
});
