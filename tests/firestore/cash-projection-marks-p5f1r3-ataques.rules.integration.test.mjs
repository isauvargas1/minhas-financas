// P5-F.1-R3 (B03) — Rules de `cash_projection_marks` contra ataques de isolamento, no Emulator.
// Suíte escrita pela revisão independente multi-tenant da R3 e incorporada à suíte oficial (achado M1 da revisão):
// leitura e escrita cruzadas nos dois sentidos pelos quatro papéis, não membros (removido, conta suspensa, sem
// perfil, membership sem status, sem membership, claims forjadas) e anônimo, consulta de grupo, caminho × conteúdo,
// subcaminhos, workspace arquivado, tetos do cliente, revogação no meio da transação, `verify` sem oráculo de
// existência e o estado backend-only. Roda dentro de `firebase emulators:exec --project minhas-financas-local`
// (`npm run test:rules:projection-marks`); os dados usam o prefixo `sec3-`.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';

if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Só roda contra o Firestore Emulator.');
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
if (projectId !== 'minhas-financas-local') throw new Error(`Projeto inesperado: ${projectId}`);

const requireWeb = createRequire(new URL('../../package.json', import.meta.url));
const requireAdmin = createRequire(new URL('../../functions/package.json', import.meta.url));
const {initializeApp, deleteApp} = requireWeb('firebase/app');
const {connectAuthEmulator, getAuth, signInWithEmailAndPassword, signInWithCustomToken} = requireWeb('firebase/auth');
const fs = requireWeb('firebase/firestore');
const adminAppModule = requireAdmin('firebase-admin/app');
const adminFirestoreModule = requireAdmin('firebase-admin/firestore');
const adminAuthModule = requireAdmin('firebase-admin/auth');
const {
  collection, collectionGroup, connectFirestoreEmulator, deleteDoc, doc, documentId, getCountFromServer, getDoc,
  getDocs, getFirestore, limit, query, runTransaction, setDoc, setLogLevel, updateDoc, where, writeBatch,
} = fs;
setLogLevel('silent');

const [fsHost, fsPortText] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
const fsPort = Number(fsPortText);
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
const password = 'sec3-revisao-123456';

const wsA = 'sec3-ws-a';
const wsB = 'sec3-ws-b';
const wsArc = 'sec3-ws-arquivado';
const FP1 = '1'.repeat(64);
const FP2 = '2'.repeat(64);
const FPB = 'b'.repeat(64);
const MONTHS = Array.from({length: 13}, (_, index) => {
  const date = new Date(Date.UTC(2025, 9 + index, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
});
const MANY = Array.from({length: 100}, (_, index) => `mx${String(index).padStart(3, '0')}`);

const u = (name) => ({uid: `sec3-${name}`, email: `sec3-${name}@example.test`});
const users = {
  ownerA: u('owner-a'), adminA: u('admin-a'), memberA: u('member-a'), viewerA: u('viewer-a'),
  ownerB: u('owner-b'), adminB: u('admin-b'), memberB: u('member-b'), viewerB: u('viewer-b'),
  removedA: u('removed-a'), suspendedA: u('suspended-a'), noProfileA: u('noprofile-a'), noStatusA: u('nostatus-a'),
  outsider: u('outsider'), forged: u('forged-claims'), dual: u('dual'), revokeMid: u('revoke-mid'),
};
const ROLES_A = ['ownerA', 'adminA', 'memberA', 'viewerA'];
const ROLES_B = ['ownerB', 'adminB', 'memberB', 'viewerB'];
const NON_MEMBERS_A = ['removedA', 'suspendedA', 'noProfileA', 'noStatusA', 'outsider', 'forged'];

const getAdmin = () => {
  if (!adminAppModule.getApps().length) adminAppModule.initializeApp({projectId});
  return adminAppModule.getApp();
};

const mark = (ws, id, fp, Timestamp, extra = {}) => ({
  schemaVersion: 1, workspaceId: ws, transactionId: id, anchors: {},
  chains: {a: {g: 'g0', cut: null, root: 'absent', base: null, node: {k: 'alive', fp}, pending: [], broken: null}},
  updatedAt: Timestamp.now(), ...extra,
});

const month = (ws, period, Timestamp) => ({
  id: period, workspaceId: ws, period, incomeCents: 1000, expenseCents: 0, investmentOutflowCents: 0, netCents: 1000,
  transactionCount: 1, schemaVersion: 5, projectionGeneration: {id: 'g0', cutoff: null}, updatedAt: Timestamp.now(),
});

const seed = async () => {
  const firebaseAdmin = getAdmin();
  const db = adminFirestoreModule.getFirestore(firebaseAdmin);
  const {Timestamp} = adminFirestoreModule;
  for (const [name, user] of Object.entries(users)) {
    try {
      await adminAuthModule.getAuth(firebaseAdmin).deleteUser(user.uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    await adminAuthModule.getAuth(firebaseAdmin).createUser({...user, password, emailVerified: true});
    if (name === 'noProfileA') {
      await db.doc(`users/${user.uid}`).delete();
      continue;
    }
    await db.doc(`users/${user.uid}`).set({uid: user.uid, accessStatus: 'granted', status: name === 'suspendedA' ? 'suspended' : 'active'});
  }
  await Promise.all([wsA, wsB, wsArc].map((ws) => db.recursiveDelete(db.doc(`workspaces/${ws}`))));
  await Promise.all([
    db.doc(`workspaces/${wsA}`).set({ownerId: users.ownerA.uid, type: 'PF', name: 'A', status: 'active'}),
    db.doc(`workspaces/${wsB}`).set({ownerId: users.ownerB.uid, type: 'PJ', name: 'B', status: 'active'}),
    db.doc(`workspaces/${wsArc}`).set({ownerId: users.ownerA.uid, type: 'PF', name: 'Arq', status: 'archived'}),
  ]);
  const members = [
    [wsA, 'ownerA', 'owner', 'active'], [wsA, 'adminA', 'admin', 'active'], [wsA, 'memberA', 'member', 'active'],
    [wsA, 'viewerA', 'viewer', 'active'], [wsA, 'removedA', 'member', 'removed'], [wsA, 'suspendedA', 'owner', 'active'],
    [wsA, 'noProfileA', 'owner', 'active'], [wsA, 'noStatusA', 'owner', undefined], [wsA, 'dual', 'viewer', 'active'],
    [wsA, 'revokeMid', 'member', 'active'],
    [wsB, 'ownerB', 'owner', 'active'], [wsB, 'adminB', 'admin', 'active'], [wsB, 'memberB', 'member', 'active'],
    [wsB, 'viewerB', 'viewer', 'active'], [wsB, 'dual', 'member', 'active'],
    [wsArc, 'memberA', 'member', 'active'],
  ];
  await Promise.all(members.map(([ws, name, role, status]) => db.doc(`workspaces/${ws}/members/${users[name].uid}`)
    .set(status === undefined ? {uid: users[name].uid, role} : {uid: users[name].uid, role, status})));
  const batch = db.batch();
  batch.set(db.doc(`workspaces/${wsA}/cash_projection_marks/t1`), mark(wsA, 't1', FP1, Timestamp));
  batch.set(db.doc(`workspaces/${wsA}/cash_projection_marks/t2`), mark(wsA, 't2', FP2, Timestamp));
  // Campo `workspaceId` divergente do caminho: a decisão das Rules precisa vir do caminho.
  batch.set(db.doc(`workspaces/${wsA}/cash_projection_marks/mismatch`), mark(wsB, 'mismatch', FP1, Timestamp));
  batch.set(db.doc(`workspaces/${wsB}/cash_projection_marks/t1`), mark(wsB, 't1', FPB, Timestamp));
  batch.set(db.doc(`workspaces/${wsB}/cash_projection_marks/t2`), mark(wsB, 't2', FPB, Timestamp));
  batch.set(db.doc(`workspaces/${wsArc}/cash_projection_marks/t1`), mark(wsArc, 't1', FP1, Timestamp));
  for (const id of MANY) batch.set(db.doc(`workspaces/${wsA}/cash_projection_marks/${id}`), mark(wsA, id, FP1, Timestamp));
  for (const period of MONTHS) {
    batch.set(db.doc(`workspaces/${wsA}/cash_report_periods/${period}`), month(wsA, period, Timestamp));
    batch.set(db.doc(`workspaces/${wsB}/cash_report_periods/${period}`), month(wsB, period, Timestamp));
  }
  batch.set(db.doc(`workspaces/${wsA}/cash_period_events/projection_state`), {
    id: 'projection_state', workspaceId: wsA, kind: 'cash_projection_state', markSlot: 'a',
    markRecoveryNeeded: true, markIssueCount: 1, lastMarkIssueTransactionId: 't1', updatedAt: Timestamp.now(),
  });
  await batch.commit();
};

const clientApp = (suffix) => initializeApp(
  {apiKey: 'sec3-review', projectId},
  `sec3-${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
);

const connectDb = (app) => {
  const db = getFirestore(app);
  connectFirestoreEmulator(db, fsHost, fsPort);
  return db;
};

const signedClient = async (name) => {
  const app = clientApp(name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${authHost}`, {disableWarnings: true});
  if (name === 'forged') {
    // Papel e workspace afirmados pelo token (claims), sem membership: as Rules não podem aceitar.
    const token = await adminAuthModule.getAuth(getAdmin()).createCustomToken(users.forged.uid, {role: 'owner', workspaceId: wsA, admin: true});
    await signInWithCustomToken(auth, token);
  } else {
    await signInWithEmailAndPassword(auth, users[name].email, password);
  }
  return {app, db: connectDb(app)};
};

const anonymousClient = () => {
  const app = clientApp('anon');
  return {app, db: connectDb(app)};
};

const withClients = async (names, run) => {
  const clients = {};
  try {
    for (const name of names) clients[name] = name === 'anon' ? anonymousClient() : await signedClient(name);
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
const marksCol = (db, ws) => collection(db, `workspaces/${ws}/cash_projection_marks`);
const monthRef = (db, ws, period) => doc(db, `workspaces/${ws}/cash_report_periods/${period}`);

/** Toda forma de ler marcas de `ws` que não é `get` por id, e o `get`. */
const readAttempts = (db, ws) => ({
  get: () => getDoc(markRef(db, ws, 't1')),
  byIds: () => getDocs(query(marksCol(db, ws), where(documentId(), 'in', ['t1', 't2']), limit(2))),
  list: () => getDocs(query(marksCol(db, ws), limit(1))),
  count: () => getCountFromServer(marksCol(db, ws)),
  transaction: () => runTransaction(db, async (transaction) => {
    await transaction.get(monthRef(db, ws, MONTHS[0]));
    return transaction.get(markRef(db, ws, 't1'));
  }),
});

/** Toda forma de escrita do cliente numa marca de `ws`. */
const writeAttempts = (db, ws, tag) => ({
  create: () => setDoc(markRef(db, ws, `forjada-${tag}`), {schemaVersion: 1, workspaceId: ws, transactionId: 'x', anchors: {}, chains: {}}),
  overwrite: () => setDoc(markRef(db, ws, 't1'), {schemaVersion: 1, workspaceId: ws, transactionId: 't1', anchors: {}, chains: {}}),
  merge: () => setDoc(markRef(db, ws, 't1'), {chains: {a: {g: 'g0', cut: null, root: 'absent', base: null, node: {k: 'deleted'}, pending: [], broken: null}}}, {merge: true}),
  update: () => updateDoc(markRef(db, ws, 't1'), {'chains.a.node': {k: 'alive', fp: FP2}, workspaceId: 'outro'}),
  remove: () => deleteDoc(markRef(db, ws, 't1')),
  batch: () => {
    const batch = writeBatch(db);
    batch.set(markRef(db, ws, `lote-${tag}`), {schemaVersion: 1, workspaceId: ws});
    return batch.commit();
  },
  transaction: () => runTransaction(db, async (transaction) => {
    await transaction.get(markRef(db, ws, 't1'));
    transaction.set(markRef(db, ws, 't1'), {chains: {}}, {merge: true});
  }),
});

const snapshotMarks = async (ws) => {
  const all = await adminFirestoreModule.getFirestore(getAdmin()).collection(`workspaces/${ws}/cash_projection_marks`).get();
  return Object.fromEntries(all.docs.map((item) => [item.id, `${item.updateTime.toMillis()}:${item.updateTime.nanoseconds}:${JSON.stringify(item.data().chains)}:${item.data().workspaceId}`]));
};

test.before(seed);

test('A→B e B→A: os quatro papéis de cada tenant não leem marcas do outro (get, consulta por id, listagem, contagem, transação); controle positivo no próprio', async () => {
  await withClients([...ROLES_A, ...ROLES_B], async (clients) => {
    for (const [own, other, roles] of [[wsA, wsB, ROLES_A], [wsB, wsA, ROLES_B]]) {
      for (const name of roles) {
        const {db} = clients[name];
        const positive = await getDoc(markRef(db, own, 't1'));
        assert.equal(positive.exists(), true, `${name} lê a própria marca (controle positivo)`);
        assert.equal(positive.data().workspaceId, own);
        for (const [kind, attempt] of Object.entries(readAttempts(db, other))) {
          await denied(attempt(), `${name} → ${other}: ${kind}`);
        }
        // No próprio workspace, só o `get` passa: consulta, listagem e contagem negadas.
        for (const kind of ['byIds', 'list', 'count']) await denied(readAttempts(db, own)[kind](), `${name} no próprio: ${kind}`);
      }
    }
  });
});

test('escrita cruzada nos dois sentidos (create, overwrite, merge, update, delete, batch, transação): negada e marcas intactas', async () => {
  const beforeA = await snapshotMarks(wsA);
  const beforeB = await snapshotMarks(wsB);
  await withClients([...ROLES_A, ...ROLES_B], async (clients) => {
    for (const [other, roles] of [[wsB, ROLES_A], [wsA, ROLES_B]]) {
      for (const name of roles) {
        for (const [kind, attempt] of Object.entries(writeAttempts(clients[name].db, other, name))) {
          await denied(attempt(), `${name} escreve em ${other}: ${kind}`);
        }
      }
    }
  });
  assert.deepEqual(await snapshotMarks(wsA), beforeA, 'marcas de A intactas, nenhuma forjada');
  assert.deepEqual(await snapshotMarks(wsB), beforeB, 'marcas de B intactas, nenhuma forjada');
});

test('não membros de A (removido, conta suspensa, sem perfil, membership sem status, sem membership, claims forjadas) e anônimo: nenhuma leitura nem escrita', async () => {
  const beforeA = await snapshotMarks(wsA);
  await withClients([...NON_MEMBERS_A, 'anon'], async (clients) => {
    for (const name of [...NON_MEMBERS_A, 'anon']) {
      const {db} = clients[name];
      for (const [kind, attempt] of Object.entries(readAttempts(db, wsA))) await denied(attempt(), `${name}: leitura ${kind}`);
      for (const [kind, attempt] of Object.entries(writeAttempts(db, wsA, name))) await denied(attempt(), `${name}: escrita ${kind}`);
    }
  });
  assert.deepEqual(await snapshotMarks(wsA), beforeA, 'marcas de A intactas');
});

test('collection group: consulta, consulta filtrada pelo próprio workspace e contagem negadas (owner A, owner B, membro dos dois e anônimo)', async () => {
  await withClients(['ownerA', 'ownerB', 'dual', 'anon'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      await denied(getDocs(query(collectionGroup(db, 'cash_projection_marks'), limit(5))), `${name}: grupo`);
      await denied(getDocs(query(collectionGroup(db, 'cash_projection_marks'), where('workspaceId', '==', wsA), limit(5))),
        `${name}: grupo filtrado por workspace`);
      await denied(getCountFromServer(collectionGroup(db, 'cash_projection_marks')), `${name}: contagem do grupo`);
    }
  });
});

test('o caminho decide, não o conteúdo: marca de A com workspaceId = B é negada ao owner de B e lida pelo owner de A; membro dos dois lê cada uma no próprio caminho', async () => {
  await withClients(['ownerA', 'ownerB', 'dual'], async ({ownerA, ownerB, dual}) => {
    await denied(getDoc(markRef(ownerB.db, wsA, 'mismatch')), 'owner de B não lê marca de A que diz workspaceId = B');
    assert.equal((await getDoc(markRef(ownerA.db, wsA, 'mismatch'))).exists(), true, 'owner de A lê pelo caminho');
    const fromA = await getDoc(markRef(dual.db, wsA, 't1'));
    const fromB = await getDoc(markRef(dual.db, wsB, 't1'));
    assert.equal(fromA.data().chains.a.node.fp, FP1, 'conteúdo de A pelo caminho de A');
    assert.equal(fromB.data().chains.a.node.fp, FPB, 'conteúdo de B pelo caminho de B');
  });
});

test('subcaminho sob a marca e coleções de nome vizinho: sem leitura nem escrita do cliente', async () => {
  await withClients(['ownerA'], async ({ownerA}) => {
    const {db} = ownerA;
    await denied(getDoc(doc(db, `workspaces/${wsA}/cash_projection_marks/t1/sub/x`)), 'subcoleção sob a marca');
    await denied(setDoc(doc(db, `workspaces/${wsA}/cash_projection_marks/t1/sub/x`), {a: 1}), 'escrita em subcoleção sob a marca');
    await denied(setDoc(doc(db, `workspaces/${wsA}/Cash_Projection_Marks/t1`), {chains: {}}), 'escrita em coleção com outra caixa');
    await denied(setDoc(doc(db, `workspaces/${wsA}/cash_projection_marks_v2/t1`), {chains: {}}), 'escrita em coleção de nome vizinho');
  });
});

test('workspace arquivado: o membro ativo lê a marca por id e não escreve; não consulta', async () => {
  await withClients(['memberA'], async ({memberA}) => {
    assert.equal((await getDoc(markRef(memberA.db, wsArc, 't1'))).exists(), true, 'leitura no arquivado');
    for (const [kind, attempt] of Object.entries(writeAttempts(memberA.db, wsArc, 'arq'))) await denied(attempt(), `arquivado: ${kind}`);
    await denied(getDocs(query(marksCol(memberA.db, wsArc), limit(1))), 'arquivado: listagem');
  });
});

test('tetos do cliente: viewer de A lê 13 meses e 100 marcas numa transação só de leitura; a mesma leitura por owner de B é negada sem resultado parcial', async () => {
  const readAll = (db, ws) => runTransaction(db, async (transaction) => {
    const [months, marks] = await Promise.all([
      Promise.all(MONTHS.map((period) => transaction.get(monthRef(db, ws, period)))),
      Promise.all(MANY.map((id) => transaction.get(markRef(db, ws, id)))),
    ]);
    return {months: months.filter((item) => item.exists()).length, marks: marks.filter((item) => item.exists()).length};
  }, {maxAttempts: 5});
  await withClients(['viewerA', 'ownerB'], async ({viewerA, ownerB}) => {
    const started = Date.now();
    const read = await readAll(viewerA.db, wsA);
    assert.deepEqual(read, {months: 13, marks: 100}, 'viewer lê o teto inteiro');
    console.log(`# leitura de 13 meses + 100 marcas pelo viewer em ${Date.now() - started} ms`);
    let partial = null;
    await denied(runTransaction(ownerB.db, async (transaction) => {
      partial = await transaction.get(monthRef(ownerB.db, wsB, MONTHS[0]));
      await transaction.get(markRef(ownerB.db, wsA, 't1'));
      return 'leu';
    }), 'owner de B mistura o mês de B com a marca de A');
    assert.equal(partial?.exists(), true, 'a parte de B foi lida antes da negação');
  });
});

test('revogação no meio da transação: membro removido entre dois get não recebe a segunda leitura e a transação falha', async () => {
  const db0 = adminFirestoreModule.getFirestore(getAdmin());
  await withClients(['revokeMid'], async ({revokeMid}) => {
    let attempts = 0;
    await denied(runTransaction(revokeMid.db, async (transaction) => {
      attempts += 1;
      const first = await transaction.get(markRef(revokeMid.db, wsA, 't1'));
      assert.equal(first.exists(), true, 'primeira leitura como membro ativo');
      if (attempts === 1) await db0.doc(`workspaces/${wsA}/members/${users.revokeMid.uid}`).update({status: 'removed'});
      await transaction.get(markRef(revokeMid.db, wsA, 't2'));
      return 'leu';
    }), 'segunda leitura depois da remoção');
    assert.equal(attempts, 1, 'sem nova tentativa que leia algo depois da remoção');
    await denied(getDoc(markRef(revokeMid.db, wsA, 't1')), 'depois da remoção, nenhuma leitura avulsa');
  });
});

test('oráculo de existência por `verify` no commit (REST): sem leitura, nenhuma resposta distingue marca existente de inexistente', async () => {
  const base = `projects/${projectId}/databases/(default)/documents`;
  const commit = async (token, path, exists) => {
    const response = await fetch(`http://${fsHost}:${fsPort}/v1/${base}:commit`, {
      method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${token}`},
      body: JSON.stringify({writes: [{verify: `${base}/${path}`, currentDocument: {exists}}]}),
    });
    const body = await response.json().catch(() => ({}));
    return {status: response.status, code: body?.error?.status ?? 'OK'};
  };
  await withClients(['viewerA', 'ownerB', 'ownerA'], async (clients) => {
    const token = async (name) => getAuth(clients[name].app).currentUser.getIdToken();
    const viewer = await token('viewerA');
    // Controle positivo: com leitura, o `verify` responde pela existência (é o que a transação só de leitura usa).
    assert.deepEqual(await commit(viewer, `workspaces/${wsA}/cash_projection_marks/t1`, true), {status: 200, code: 'OK'});
    const absent = await commit(viewer, `workspaces/${wsA}/cash_projection_marks/t1`, false);
    assert.notEqual(absent.status, 200, 'precondição falsa falha para quem lê');
    console.log(`# verify com leitura: existe=true -> 200; existe=false -> ${absent.status} ${absent.code}`);
    // Sem leitura: as duas perguntas recebem a mesma negação (nenhum oráculo).
    const outsider = await token('ownerB');
    for (const path of [`workspaces/${wsA}/cash_projection_marks/t1`, `workspaces/${wsA}/cash_projection_marks/nao-existe`]) {
      for (const exists of [true, false]) {
        const result = await commit(outsider, path, exists);
        assert.equal(result.status, 403, `owner de B: verify ${path} exists=${exists} -> ${JSON.stringify(result)}`);
        assert.equal(result.code, 'PERMISSION_DENIED');
      }
    }
    const ownerA = await token('ownerA');
    for (const exists of [true, false]) {
      const result = await commit(ownerA, `workspaces/${wsA}/cash_period_events/projection_state`, exists);
      assert.equal(result.status, 403, `owner de A: verify do projection_state exists=${exists} -> ${JSON.stringify(result)}`);
    }
  });
});

test('estado backend-only da R3 e etiqueta de geração: projection_state negado; mês não aceita projectionGeneration do cliente', async () => {
  await withClients(['ownerA', 'viewerA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      await denied(getDoc(doc(db, `workspaces/${wsA}/cash_period_events/projection_state`)), `${name}: projection_state`);
      await denied(updateDoc(monthRef(db, wsA, MONTHS[0]), {projectionGeneration: {id: 'forjada', cutoff: null}}), `${name}: forja geração`);
      await denied(setDoc(monthRef(db, wsA, MONTHS[0]), {projectionGeneration: {id: 'forjada', cutoff: null}}, {merge: true}),
        `${name}: forja geração com merge`);
      await denied(runTransaction(db, async (transaction) => {
        await transaction.get(monthRef(db, wsA, MONTHS[0]));
        transaction.update(monthRef(db, wsA, MONTHS[0]), {incomeCents: 0});
      }), `${name}: escrita no mês dentro da transação de leitura`);
    }
  });
  const kept = await adminFirestoreModule.getFirestore(getAdmin()).doc(`workspaces/${wsA}/cash_report_periods/${MONTHS[0]}`).get();
  assert.deepEqual(kept.data().projectionGeneration, {id: 'g0', cutoff: null});
  assert.equal(kept.data().incomeCents, 1000);
});
