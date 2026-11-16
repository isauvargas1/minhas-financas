import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {initializeApp, deleteApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut} from 'firebase/auth';
import {
  Timestamp,
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
  deleteField,
  disableNetwork,
  doc,
  documentId,
  enableNetwork,
  getDoc,
  getDocs,
  getDocsFromServer,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore';

/**
 * P5-F (REQ-FUT-01), contrato v2 da P5-F.1 — Rules da preferência privada de
 * tempo de trabalho equivalente:
 * `users/{uid}/private_preferences/work_time_equivalent`.
 *
 * Só o titular, com conta ativa, lê, grava e apaga o próprio documento. Os
 * outros papéis do mesmo workspace (owner, admin, member, viewer), um usuário
 * de outro workspace, o anônimo e a conta suspensa são negados. A escrita
 * aceita exatamente os campos do contrato v2, com tipos, limites de tamanho e
 * de quantidade, as gramáticas fechadas e `updatedAt == request.time`; o v1 e
 * qualquer valor derivado (renda, minutos, valor da hora) são negados; não há
 * listagem nem consulta de collection group, e nenhum outro id existe na
 * subcoleção. O corpus `tests/fixtures/work-time-grammar-cases.json` é o
 * mesmo do teste do cliente.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da P5-F.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-password-123456';

const user = (uid) => ({uid, email: `${uid}@example.test`});
const users = {
  holder: user('p5f-holder'),
  workspaceOwner: user('p5f-ws-owner'),
  workspaceAdmin: user('p5f-ws-admin'),
  workspaceMember: user('p5f-ws-member'),
  workspaceViewer: user('p5f-ws-viewer'),
  otherTenant: user('p5f-other-tenant'),
  suspended: user('p5f-suspended'),
  switcher: user('p5f-switcher'),
};

const WORKSPACE = 'p5f-rules-ws';
const OTHER_WORKSPACE = 'p5f-rules-other-ws';
const PREFERENCE_ID = 'work_time_equivalent';
const preferencePath = (uid, id = PREFERENCE_ID) => `users/${uid}/private_preferences/${id}`;

const getAdmin = () => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const ROUTINES = 'W:08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,08:00-17:00/60,-,-';
const corpus = JSON.parse(readFileSync(new URL('../fixtures/work-time-grammar-cases.json', import.meta.url), 'utf8'));

/** Campos v2 válidos, sem `updatedAt`. */
const v2Fields = (workspaceId = WORKSPACE) => ({
  schemaVersion: 2,
  enabled: true,
  displayMode: 'time',
  estimateMode: 'habitual',
  historyMonths: 3,
  incomeWorkspaceId: workspaceId,
  allowBusinessIncome: false,
  excludedIncomeIds: '',
  routines: ROUTINES,
  worksOnHolidays: false,
  uf: 'SP',
  municipality: 'São Paulo',
  localHolidays: '01-25',
  exceptions: '',
});

/** Documento válido, como o cliente grava (hora do servidor em `updatedAt`). */
const validFields = (overrides = {}) => ({
  ...v2Fields(),
  updatedAt: serverTimestamp(),
  ...overrides,
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
    await db.recursiveDelete(db.doc(`users/${entry.uid}`));
    await db.doc(`users/${entry.uid}`).set({
      uid: entry.uid,
      status: entry === users.suspended ? 'suspended' : 'active',
    });
  }
  // O titular é membro do workspace de outra pessoa, junto com todos os papéis.
  for (const [workspaceId, ownerUid, members] of [
    [WORKSPACE, users.workspaceOwner.uid, [
      [users.workspaceOwner, 'owner'],
      [users.workspaceAdmin, 'admin'],
      [users.holder, 'member'],
      [users.workspaceMember, 'member'],
      [users.workspaceViewer, 'viewer'],
    ]],
    [OTHER_WORKSPACE, users.otherTenant.uid, [[users.otherTenant, 'owner']]],
  ]) {
    await db.recursiveDelete(db.doc(`workspaces/${workspaceId}`));
    await db.doc(`workspaces/${workspaceId}`).set({name: workspaceId, type: 'PF', ownerId: ownerUid, status: 'active'});
    for (const [entry, role] of members) {
      await db.doc(`workspaces/${workspaceId}/members/${entry.uid}`).set({uid: entry.uid, role, status: 'active'});
    }
  }
  const stored = {
    ...v2Fields(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  for (const entry of [users.holder, users.workspaceOwner, users.suspended, users.switcher]) {
    await db.doc(preferencePath(entry.uid)).set(stored);
  }
};

const clients = [];
const connect = (label) => {
  const app = initializeApp({
    apiKey: 'demo-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
  }, `p5f-${label}-${clients.length}`);
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  const db = getFirestore(app);
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  connectFirestoreEmulator(db, host, Number(port));
  return {app, auth, db};
};

const signIn = async (entry) => {
  const client = connect(entry?.uid ?? 'anon');
  if (entry) await signInWithEmailAndPassword(client.auth, entry.email, password);
  return client.db;
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
  for (const [name, entry] of Object.entries(users)) {
    if (entry !== users.switcher) db[name] = await signIn(entry);
  }
  db.anon = await signIn(null);
});

test.after(async () => {
  await Promise.all(clients.map((app) => deleteApp(app.app ?? app)));
});

test('titular lê a própria preferência; sem documento, a leitura é permitida e vem vazia', async () => {
  const snapshot = await getDoc(doc(db.holder, preferencePath(users.holder.uid)));
  assert.equal(snapshot.data().routines, ROUTINES);
  assert.equal(snapshot.data().schemaVersion, 2);
  const absent = await getDoc(doc(db.workspaceMember, preferencePath(users.workspaceMember.uid)));
  assert.equal(absent.exists(), false);
});

test('owner, admin, member e viewer do workspace não leem a configuração do titular', async () => {
  for (const name of ['workspaceOwner', 'workspaceAdmin', 'workspaceMember', 'workspaceViewer']) {
    await denied(getDoc(doc(db[name], preferencePath(users.holder.uid))), `${name} lê o titular`);
  }
  // E o titular (member) também não lê a do owner do workspace.
  await denied(getDoc(doc(db.holder, preferencePath(users.workspaceOwner.uid))), 'member lê o owner');
});

test('usuário de outro workspace, anônimo e conta suspensa são negados', async () => {
  await denied(getDoc(doc(db.otherTenant, preferencePath(users.holder.uid))), 'outro workspace');
  await denied(getDoc(doc(db.anon, preferencePath(users.holder.uid))), 'anônimo');
  await denied(getDoc(doc(db.suspended, preferencePath(users.suspended.uid))), 'suspensa lê a própria');
  await denied(setDoc(doc(db.suspended, preferencePath(users.suspended.uid)), validFields()), 'suspensa grava');
  await denied(deleteDoc(doc(db.suspended, preferencePath(users.suspended.uid))), 'suspensa apaga');
  await denied(setDoc(doc(db.anon, preferencePath(users.holder.uid)), validFields()), 'anônimo grava');
});

test('ninguém grava nem apaga a preferência de outra pessoa, em nenhum papel', async () => {
  for (const name of ['workspaceOwner', 'workspaceAdmin', 'workspaceMember', 'workspaceViewer', 'otherTenant']) {
    const target = doc(db[name], preferencePath(users.holder.uid));
    await denied(setDoc(target, validFields({routines: 'W:D60,-,-,-,-,-,-'})), `${name} cria/sobrescreve`);
    await denied(updateDoc(target, {displayMode: 'money', updatedAt: serverTimestamp()}), `${name} altera`);
    await denied(deleteDoc(target), `${name} apaga`);
  }
  const intact = await getDoc(doc(db.holder, preferencePath(users.holder.uid)));
  assert.equal(intact.data().routines, ROUTINES);
  assert.equal(intact.data().displayMode, 'time');
});

test('sem listagem e sem consulta de collection group, nem da própria subcoleção', async () => {
  await denied(
    getDocs(query(collection(db.holder, `users/${users.holder.uid}/private_preferences`), limit(1))),
    'titular lista',
  );
  await denied(
    getDocs(query(collection(db.workspaceOwner, `users/${users.holder.uid}/private_preferences`), limit(1))),
    'owner lista a do titular',
  );
  await denied(getDocs(query(collectionGroup(db.holder, 'private_preferences'), limit(1))), 'collection group');
  // Nem a consulta do titular restrita ao único id permitido: o documento só se lê por `get`.
  const ownCollection = collection(db.holder, `users/${users.holder.uid}/private_preferences`);
  await denied(getDocs(query(ownCollection, where(documentId(), '==', 'work_time_equivalent'))), 'titular consulta o próprio id');
  await denied(getDocs(query(ownCollection, where(documentId(), 'in', ['work_time_equivalent']))), 'titular consulta o próprio id com in');
});

test('titular cria, altera o modo, altera tudo e apaga com o contrato exato', async () => {
  const target = doc(db.workspaceMember, preferencePath(users.workspaceMember.uid));
  await setDoc(target, validFields({enabled: false, displayMode: 'money'}));
  await updateDoc(target, {displayMode: 'time', updatedAt: serverTimestamp()});
  let snapshot = await getDoc(target);
  assert.equal(snapshot.data().displayMode, 'time');
  assert.equal(snapshot.data().enabled, false);
  await setDoc(target, validFields({
    estimateMode: 'current_month',
    historyMonths: 12,
    allowBusinessIncome: true,
    excludedIncomeIds: 'cash_a,cash_b',
    routines: 'C:2026-01-01:1x1:07:00-19:00/60',
    worksOnHolidays: true,
    uf: '',
    municipality: '',
    localHolidays: '',
    exceptions: 'F2026-07-06/2026-07-17;E2026-07-20+120',
  }));
  snapshot = await getDoc(target);
  assert.equal(snapshot.data().routines, 'C:2026-01-01:1x1:07:00-19:00/60');
  assert.equal(snapshot.data().historyMonths, 12);
  await deleteDoc(target);
  assert.equal((await getDoc(target)).exists(), false);
  // Limites exatos: maiores textos e quantidades aceitos pelo contrato.
  const biggest = (field) => corpus[field].filter((item) => item.rules)
    .reduce((longest, item) => (item.value.length > longest.length ? item.value : longest), '');
  await setDoc(target, validFields({
    excludedIncomeIds: biggest('excludedIncomeIds'),
    routines: biggest('routines'),
    localHolidays: biggest('localHolidays'),
    exceptions: biggest('exceptions'),
    municipality: biggest('municipality'),
  }));
  await deleteDoc(target);
});

test('outro id na subcoleção é negado mesmo com campos válidos', async () => {
  await denied(
    setDoc(doc(db.workspaceMember, preferencePath(users.workspaceMember.uid, 'hourly_rate')), validFields()),
    'outro id',
  );
  await denied(
    getDoc(doc(db.workspaceMember, preferencePath(users.workspaceMember.uid, 'hourly_rate'))),
    'ler outro id',
  );
});

test('campos extras, ausentes, tipos e limites inválidos são negados', async () => {
  const target = doc(db.workspaceMember, preferencePath(users.workspaceMember.uid));
  const without = (field) => {
    const {[field]: _ignored, ...rest} = validFields();
    return rest;
  };
  const invalid = [
    // Nada derivado cabe no documento.
    ['campo extra (valor por hora)', validFields({hourlyRateCents: 2_019})],
    ['campo extra (renda derivada)', validFields({incomeCents: 350_000})],
    ['campo extra (minutos derivados)', validFields({workMinutes: 9_600})],
    ['campo extra (renda do v1)', validFields({monthlyIncomeCents: 350_000})],
    ['campo extra (workspace)', validFields({workspaceId: WORKSPACE})],
    ['campo extra (minutos convertidos)', validFields({convertedMinutes: 90})],
    ['campo extra (motivo da ausência)', validFields({absenceReason: 'consulta'})],
    ...['schemaVersion', 'updatedAt', 'displayMode', 'estimateMode', 'historyMonths', 'incomeWorkspaceId', 'allowBusinessIncome',
      'excludedIncomeIds', 'routines', 'worksOnHolidays', 'uf', 'municipality', 'localHolidays', 'exceptions', 'enabled']
      .map((field) => [`sem ${field}`, without(field)]),
    ['updatedAt do cliente', validFields({updatedAt: Timestamp.fromMillis(Date.now())})],
    // O contrato v1 não é mais aceito.
    ['documento v1', {
      schemaVersion: 1, enabled: true, displayMode: 'time',
      monthlyIncomeCents: 350_000, monthlyWorkMinutes: 10_400, updatedAt: serverTimestamp(),
    }],
    ['schemaVersion 1', validFields({schemaVersion: 1})],
    ['schemaVersion 3', validFields({schemaVersion: 3})],
    ['schemaVersion texto', validFields({schemaVersion: '2'})],
    ['enabled texto', validFields({enabled: 'true'})],
    ['displayMode desconhecido', validFields({displayMode: 'hours'})],
    ['estimateMode desconhecido', validFields({estimateMode: 'annual'})],
    ['historyMonths 2', validFields({historyMonths: 2})],
    ['historyMonths 0', validFields({historyMonths: 0})],
    ['historyMonths 24', validFields({historyMonths: 24})],
    ['historyMonths texto', validFields({historyMonths: '3'})],
    ['historyMonths fracionário', validFields({historyMonths: 3.5})],
    ['allowBusinessIncome texto', validFields({allowBusinessIncome: 'false'})],
    ['worksOnHolidays número', validFields({worksOnHolidays: 0})],
    ['incomeWorkspaceId número', validFields({incomeWorkspaceId: 123})],
    ['excludedIncomeIds lista', validFields({excludedIncomeIds: ['cash_a']})],
    ['routines mapa', validFields({routines: {monday: 'D480'}})],
    ['exceptions lista', validFields({exceptions: [{kind: 'vacation'}]})],
    ['localHolidays número', validFields({localHolidays: 125})],
    ['municipality número', validFields({municipality: 1})],
    ['uf nula', validFields({uf: null})],
  ];
  for (const [label, data] of invalid) await denied(setDoc(target, data), label);
  assert.equal((await getDoc(target)).exists(), false, 'nada foi gravado');

  // Atualização que deixaria o documento fora do contrato.
  await setDoc(target, validFields());
  await denied(updateDoc(target, {displayMode: 'money'}), 'update sem updatedAt do servidor');
  await denied(updateDoc(target, {displayMode: 'x', updatedAt: serverTimestamp()}), 'update com modo inválido');
  await denied(updateDoc(target, {extra: 1, updatedAt: serverTimestamp()}), 'update com campo extra');
  await denied(updateDoc(target, {enabled: deleteField(), updatedAt: serverTimestamp()}), 'update removendo campo');
  await denied(updateDoc(target, {routines: '', updatedAt: serverTimestamp()}), 'update sem rotina');
  await denied(updateDoc(target, {incomeCents: 350_000, updatedAt: serverTimestamp()}), 'update com renda derivada');
  await denied(updateDoc(target, {schemaVersion: 1, updatedAt: serverTimestamp()}), 'update de volta ao v1');
  await deleteDoc(target);
});

test('gramáticas: o corpus compartilhado com o cliente vale igual nas Rules', async () => {
  const target = doc(db.workspaceMember, preferencePath(users.workspaceMember.uid));
  let allowed = 0;
  let deniedCount = 0;
  for (const [field, cases] of Object.entries(corpus)) {
    for (const item of cases) {
      const write = setDoc(target, validFields({[field]: item.value}));
      if (item.rules) {
        await write;
        allowed += 1;
      } else {
        await denied(write, `${field}: ${item.label}`);
        deniedCount += 1;
      }
    }
  }
  await deleteDoc(target);
  assert.ok(allowed >= 50 && deniedCount >= 50, `aceitos ${allowed}, negados ${deniedCount}`);
});

/*
 * O SDK 12 guarda em memória (LRU de 40 MB) os documentos já lidos, também
 * depois de trocar a conta: é o comportamento padrão para todos os dados do
 * app (evidência em `docs/production/evidence/p5f/cache-sdk.md`). As Rules
 * negam o servidor à conta seguinte; o app nunca lê do cache local
 * (`*FromCache` é proibido pela guarda `tests/unit/work-time-guard.test.ts`)
 * nem monta caminho com outro uid.
 */
test('troca de usuário no mesmo cliente: a conta seguinte não lê a preferência anterior no servidor', async () => {
  const client = connect('switch');
  await signInWithEmailAndPassword(client.auth, users.switcher.email, password);
  const ref = doc(client.db, preferencePath(users.switcher.uid));
  // Como a interface: listener de documento único, cancelado ao sair.
  const first = await new Promise((resolve, reject) => {
    const unsubscribe = onSnapshot(ref, (snapshot) => {
      unsubscribe();
      resolve(snapshot.data());
    }, reject);
  });
  assert.equal(first.routines, ROUTINES);
  await signOut(client.auth);
  await signInWithEmailAndPassword(client.auth, users.workspaceViewer.email, password);
  await denied(getDoc(ref), 'conta seguinte lê a anterior no servidor');
  await denied(
    new Promise((resolve, reject) => {
      const unsubscribe = onSnapshot(ref, (snapshot) => {
        // O listener da conta seguinte não pode receber o documento do servidor.
        if (!snapshot.metadata.fromCache) {
          unsubscribe();
          resolve(snapshot);
        }
      }, reject);
    }),
    'conta seguinte escuta a anterior',
  );
  const own = await getDoc(doc(client.db, preferencePath(users.workspaceViewer.uid)));
  assert.equal(own.exists(), false, 'a conta seguinte vê só a própria (inexistente)');
});

test('exclusão pelo titular apaga toda a configuração; depois disso nenhuma leitura a encontra', async () => {
  const target = doc(db.holder, preferencePath(users.holder.uid));
  await deleteDoc(target);
  assert.equal((await getDoc(target)).exists(), false);
  const adminSnapshot = await getAdmin().firestore().doc(preferencePath(users.holder.uid)).get();
  assert.equal(adminSnapshot.exists, false, 'apagado no servidor, sem cópia');
});

test('P5-F.1: as consultas da renda (janela de receitas, estornos de recebimento, leitura por id, projeções da janela) só servem a membros ativos do workspace', async () => {
  const adminDb = getAdmin().firestore();
  for (const workspaceId of [WORKSPACE, OTHER_WORKSPACE]) {
    await adminDb.doc(`workspaces/${workspaceId}/transactions/p5f1-income`).set({type: 'receita', date: '2026-10-05', valueCents: 100000, isPaid: true});
    await adminDb.doc(`workspaces/${workspaceId}/transactions/p5f1-reversal`)
      .set({type: 'despesa', date: '2026-10-06', valueCents: 5000, isPaid: true, receivableEntry: {reversal: true, principalCents: 5000}});
    // Projeções mensais (gravadas só pelo backend): dois meses da janela e um de cada lado, fora dela.
    for (const month of ['2026-07', '2026-08', '2026-10', '2026-11']) {
      await adminDb.doc(`workspaces/${workspaceId}/cash_report_periods/${month}`).set({incomeCents: 100000, expenseCents: 0});
    }
  }
  // Conta suspensa com membership ativo e membro removido: nenhum dos dois lê.
  await adminDb.doc(`workspaces/${WORKSPACE}/members/${users.suspended.uid}`).set({uid: users.suspended.uid, role: 'member', status: 'active'});
  await adminDb.doc(`workspaces/${WORKSPACE}/members/${users.otherTenant.uid}`).set({uid: users.otherTenant.uid, role: 'member', status: 'removed'});
  // As mesmas formas de `getIncomeWindow` e `getTransactionsByIds` (src/modules/transactions/api.ts) e da
  // escuta das projeções de `firebaseBasisDeps.subscribePeriods` (src/modules/reports/hooks.ts: ids entre o
  // primeiro e o último mês da janela, até 13 documentos).
  const shapes = (database, workspaceId) => {
    const transactions = collection(database, `workspaces/${workspaceId}/transactions`);
    const periods = collection(database, `workspaces/${workspaceId}/cash_report_periods`);
    const windowed = (filter) => query(transactions, filter, where('date', '>=', '2026-08-01'), where('date', '<=', '2026-10-31'),
      orderBy('date', 'desc'), orderBy(documentId(), 'desc'), limit(501));
    return [
      ['janela de receitas', windowed(where('type', '==', 'receita')), ['p5f1-income']],
      ['estornos de recebimento', windowed(where('receivableEntry.reversal', '==', true)), ['p5f1-reversal']],
      ['leitura por id', query(transactions, where(documentId(), 'in', ['p5f1-income', 'p5f1-reversal'])), ['p5f1-income', 'p5f1-reversal']],
      ['projeções da janela', query(periods, where(documentId(), '>=', '2026-08'), where(documentId(), '<=', '2026-10'), limit(13)), ['2026-08', '2026-10']],
    ];
  };
  // Sem limite, a mesma escuta é negada (as Rules exigem limit entre 1 e 600 na listagem das projeções).
  await denied(getDocs(query(collection(db.workspaceOwner, `workspaces/${WORKSPACE}/cash_report_periods`),
    where(documentId(), '>=', '2026-08'), where(documentId(), '<=', '2026-10'))), 'projeções sem limite');
  for (const name of ['workspaceOwner', 'workspaceAdmin', 'holder', 'workspaceMember', 'workspaceViewer']) {
    for (const [label, shaped, expected] of shapes(db[name], WORKSPACE)) {
      const ids = (await getDocs(shaped)).docs.map((entry) => entry.id).sort();
      assert.deepEqual(ids, expected, `${name}: ${label}`);
    }
    for (const [label, shaped] of shapes(db[name], OTHER_WORKSPACE)) await denied(getDocs(shaped), `${name} no outro workspace: ${label}`);
  }
  for (const [label, shaped, expected] of shapes(db.otherTenant, OTHER_WORKSPACE)) {
    assert.deepEqual((await getDocs(shaped)).docs.map((entry) => entry.id).sort(), expected, `dono do outro workspace no próprio: ${label}`);
  }
  for (const [name, who] of [['otherTenant', 'membro removido do workspace'], ['suspended', 'conta suspensa'], ['anon', 'anônimo']]) {
    for (const [label, shaped] of shapes(db[name], WORKSPACE)) await denied(getDocs(shaped), `${who}: ${label}`);
  }
});

test('P5-F.1-R1: a leitura por id traz o recebimento e o espelho do estorno juntos (IDs determinísticos, estorno ainda inexistente incluído), sempre do servidor, e a versão das projeções, só a membros ativos', async () => {
  const adminDb = getAdmin().firestore();
  const reversalIds = JSON.parse(readFileSync(new URL('../fixtures/receivable-reversal-ids.json', import.meta.url), 'utf8'));
  const [first, second] = reversalIds.cases;
  const receipt = (item) => ({
    type: 'receita', date: '2026-10-10', valueCents: 100000, isPaid: true,
    receivableEntry: {receivableMovementId: item.movementId, reversal: false, principalCents: 100000},
  });
  for (const workspaceId of [WORKSPACE, OTHER_WORKSPACE]) {
    await adminDb.doc(`workspaces/${workspaceId}/transactions/${first.mirrorId}`).set(receipt(first));
    await adminDb.doc(`workspaces/${workspaceId}/transactions/${second.mirrorId}`).set(receipt(second));
    // Só o primeiro recebimento foi estornado: o espelho do estorno tem o ID derivado do movimento dele.
    await adminDb.doc(`workspaces/${workspaceId}/transactions/${first.reversalMirrorId}`).set({
      type: 'despesa', date: '2026-10-10', valueCents: 100000, isPaid: true,
      receivableEntry: {receivableMovementId: first.reversalMovementId, reversal: true, reversalOf: first.movementId, principalCents: 100000},
    });
    await adminDb.doc(`workspaces/${workspaceId}/cash_report_periods/2026-10`).set({
      incomeCents: 0, expenseCents: 0, updatedAt: getAdmin().firestore.FieldValue.serverTimestamp(),
    });
  }
  await adminDb.doc(`workspaces/${WORKSPACE}/members/${users.suspended.uid}`).set({uid: users.suspended.uid, role: 'member', status: 'active'});
  await adminDb.doc(`workspaces/${WORKSPACE}/members/${users.otherTenant.uid}`).set({uid: users.otherTenant.uid, role: 'member', status: 'removed'});
  // A forma de `readExcludedIncome` (src/modules/work-time/receivableReversal.ts): os pares (recebimento,
  // estorno) lado a lado na mesma consulta `in`, também quando o estorno não existe.
  const byIds = (database, workspaceId) => query(collection(database, `workspaces/${workspaceId}/transactions`),
    where(documentId(), 'in', [first.mirrorId, first.reversalMirrorId, second.mirrorId, second.reversalMirrorId]));
  const periods = (database, workspaceId) => query(collection(database, `workspaces/${workspaceId}/cash_report_periods`),
    where(documentId(), '>=', '2026-08'), where(documentId(), '<=', '2026-10'), limit(13));
  const expected = [first.mirrorId, first.reversalMirrorId, second.mirrorId].sort();
  for (const name of ['workspaceOwner', 'workspaceAdmin', 'holder', 'workspaceMember', 'workspaceViewer']) {
    // A forma da estimativa (`getTransactionsByIds`): `getDocsFromServer`, nunca o cache local.
    assert.deepEqual((await getDocsFromServer(byIds(db[name], WORKSPACE))).docs.map((entry) => entry.id).sort(), expected, `${name}: leitura por id`);
    await denied(getDocsFromServer(byIds(db[name], OTHER_WORKSPACE)), `${name} no outro workspace: leitura por id do servidor`);
    const october = (await getDocs(periods(db[name], WORKSPACE))).docs.find((entry) => entry.id === '2026-10');
    assert.ok(october?.get('updatedAt') instanceof Timestamp, `${name}: a versão da projeção (hora do servidor) chega ao cliente`);
    await denied(getDocs(byIds(db[name], OTHER_WORKSPACE)), `${name} no outro workspace: leitura por id`);
    await denied(getDocs(periods(db[name], OTHER_WORKSPACE)), `${name} no outro workspace: projeções`);
  }
  assert.deepEqual((await getDocs(byIds(db.otherTenant, OTHER_WORKSPACE))).docs.map((entry) => entry.id).sort(), expected,
    'dono do outro workspace no próprio');
  // Sem rede (revisão da R1, N04): `getDocs` responde do cache local sem erro (o que faria os desconsiderados que não
  // estão nele parecerem inexistentes); `getDocsFromServer`, a forma que a estimativa usa, falha. De volta à rede, lê
  // do servidor de novo.
  await disableNetwork(db.workspaceOwner);
  try {
    const cached = await getDocs(byIds(db.workspaceOwner, WORKSPACE));
    assert.equal(cached.metadata.fromCache, true, 'sem rede, getDocs responde do cache');
    await assert.rejects(getDocsFromServer(byIds(db.workspaceOwner, WORKSPACE)),
      (error) => error?.code === 'unavailable' || assert.fail(`sem rede, getDocsFromServer falha como indisponível: ${error?.code} ${error?.message}`));
  } finally {
    await enableNetwork(db.workspaceOwner);
  }
  const back = await getDocsFromServer(byIds(db.workspaceOwner, WORKSPACE));
  assert.deepEqual([back.metadata.fromCache, back.docs.map((entry) => entry.id).sort()], [false, expected], 'de volta à rede, do servidor');
  for (const [name, who] of [['otherTenant', 'membro removido do workspace'], ['suspended', 'conta suspensa'], ['anon', 'anônimo']]) {
    await denied(getDocs(byIds(db[name], WORKSPACE)), `${who}: leitura por id`);
    await denied(getDocs(periods(db[name], WORKSPACE)), `${who}: projeções`);
  }
  // O cliente não grava o espelho do estorno nem a projeção, em nenhum papel (só o backend, com o Admin SDK).
  for (const name of ['workspaceOwner', 'workspaceAdmin', 'workspaceMember']) {
    await denied(setDoc(doc(db[name], `workspaces/${WORKSPACE}/transactions/${second.reversalMirrorId}`), {
      type: 'despesa', date: '2026-10-10', valueCents: 100000, isPaid: true,
      receivableEntry: {receivableMovementId: second.reversalMovementId, reversal: true, reversalOf: second.movementId, principalCents: 100000},
    }), `${name}: criar o espelho do estorno`);
    await denied(updateDoc(doc(db[name], `workspaces/${WORKSPACE}/cash_report_periods/2026-10`), {updatedAt: serverTimestamp()}),
      `${name}: mudar a versão da projeção`);
  }
});

test('P5-F.1: a janela de receitas pagina por cursor (data desc, id desc), sem repetir nem pular, só no próprio workspace', async () => {
  const adminDb = getAdmin().firestore();
  const PAGE = 500; // TRANSACTION_PAGE_SIZE de src/modules/transactions/api.ts
  const dateOf = (index) => `2026-09-0${1 + (index % 3)}`; // três datas: muitos empates, decididos pelo id
  const ids = [];
  const writer = adminDb.bulkWriter();
  for (let index = 0; index < PAGE + 7; index += 1) {
    const id = `p5f1-page-${String(index).padStart(4, '0')}`;
    ids.push(id);
    writer.set(adminDb.doc(`workspaces/${WORKSPACE}/transactions/${id}`), {type: 'receita', date: dateOf(index), valueCents: 100, isPaid: true});
  }
  writer.set(adminDb.doc(`workspaces/${OTHER_WORKSPACE}/transactions/p5f1-page-other`), {type: 'receita', date: '2026-09-02', valueCents: 100, isPaid: true});
  await writer.close();
  const transactions = collection(db.holder, `workspaces/${WORKSPACE}/transactions`);
  const shape = [where('type', '==', 'receita'), where('date', '>=', '2026-09-01'), where('date', '<=', '2026-09-30'),
    orderBy('date', 'desc'), orderBy(documentId(), 'desc')];
  // Como `getIncomeWindow`: um documento a mais que a página só para saber se há mais.
  const first = await getDocs(query(transactions, ...shape, limit(PAGE + 1)));
  assert.equal(first.size, PAGE + 1, 'primeira página cheia e mais um: há mais');
  const firstPage = first.docs.slice(0, PAGE);
  const second = await getDocs(query(transactions, ...shape, startAfter(firstPage[PAGE - 1]), limit(PAGE + 1)));
  assert.equal(second.size, 7, 'a segunda página traz só o resto (não passa da página: fim da janela)');
  const seen = [...firstPage, ...second.docs].map((entry) => `${entry.data().date}|${entry.id}`);
  const expected = ids.map((id, index) => `${dateOf(index)}|${id}`).sort().reverse();
  assert.deepEqual(seen, expected, 'ordem estável, sem repetir nem pular, sem o outro workspace');
  // Limites: depois dos 7 primeiros restam exatamente 500, uma página cheia sem "há mais" (a janela não é
  // marcada como incompleta); depois do último, página vazia; mês sem receitas, página vazia.
  const exact = await getDocs(query(transactions, ...shape, startAfter(first.docs[6]), limit(PAGE + 1)));
  assert.equal(exact.size, PAGE, 'exatamente uma página cheia: o documento a mais não existe');
  assert.deepEqual(exact.docs.map((entry) => `${entry.data().date}|${entry.id}`), expected.slice(7));
  const afterLast = await getDocs(query(transactions, ...shape, startAfter(second.docs[second.size - 1]), limit(PAGE + 1)));
  assert.equal(afterLast.size, 0, 'depois do último, página vazia');
  // (outubro tem a receita semeada pelo teste das consultas da renda; dezembro não tem nenhuma)
  const emptyMonth = await getDocs(query(transactions, where('type', '==', 'receita'), where('date', '>=', '2026-12-01'),
    where('date', '<=', '2026-12-31'), orderBy('date', 'desc'), orderBy(documentId(), 'desc'), limit(PAGE + 1)));
  assert.equal(emptyMonth.size, 0, 'mês sem receitas: página vazia');
});
