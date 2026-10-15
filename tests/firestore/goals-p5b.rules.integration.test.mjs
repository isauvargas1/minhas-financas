import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {deleteApp, initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInAnonymously, signInWithEmailAndPassword} from 'firebase/auth';
import {
  collection,
  collectionGroup,
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
  setDoc,
  startAfter,
  updateDoc,
  where,
} from 'firebase/firestore';

/**
 * P5-B (D-31) — Rules das metas contra o Emulator.
 *
 * - `goals/{id}`: escrita só pelo backend (callables). Todo membro ativo
 *   (owner, admin, member, viewer) lê; a listagem tem teto de 26 (página de
 *   25 + sonda), inclusive no seletor de metas de investimento.
 * - `goal_audit_logs/{id}`: owner/admin, workspace ativo, listagem até 20.
 * - `goal_idempotency_keys/{id}`: fechada nos dois sentidos.
 * - A catch-all de subcoleção não reabre nada disso (`goals` está na lista
 *   de coleções do backend).
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da P5-B.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-p5b-123456';

const users = {
  ownerA: {uid: 'p5b-owner-a', email: 'p5b-owner-a@example.test'},
  adminA: {uid: 'p5b-admin-a', email: 'p5b-admin-a@example.test'},
  memberA: {uid: 'p5b-member-a', email: 'p5b-member-a@example.test'},
  viewerA: {uid: 'p5b-viewer-a', email: 'p5b-viewer-a@example.test'},
  removedA: {uid: 'p5b-removed-a', email: 'p5b-removed-a@example.test'},
  suspendedA: {uid: 'p5b-suspended-a', email: 'p5b-suspended-a@example.test'},
  demotedA: {uid: 'p5b-demoted-a', email: 'p5b-demoted-a@example.test'},
  ownerB: {uid: 'p5b-owner-b', email: 'p5b-owner-b@example.test'},
};
const ACTIVE_A = ['ownerA', 'adminA', 'memberA', 'viewerA'];
const wsA = 'p5b-workspace-a';
// IDs parecidos: prefixo e sufixo do workspace A não herdam a membership.
const wsSimilar = 'p5b-workspace-a-2';
const wsPrefix = 'p5b-workspace';
const wsB = 'p5b-workspace-b';
const wsArchived = 'p5b-workspace-arquivado';
const LIST_CAP = 26;
const AUDIT_CAP = 20;
const GOAL_COUNT = 30;

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

/** Documento como o backend grava (`executeCreateGoal`). */
const goalDoc = (ws, index, extra = {}) => {
  const createdAt = admin.firestore.Timestamp.fromMillis(Date.UTC(2026, 8, 1) + index * 60_000);
  return {
    workspaceId: ws, profileId: ws, name: `Meta ${String(index).padStart(2, '0')}`,
    category: 'reserva_emergencia', priority: 'media', priorityRank: 2,
    status: 'em_andamento', startDate: '2026-01-01', deadline: '2026-12-31',
    horizon: 'curto', progressSource: index % 2 ? 'investment' : 'manual',
    ...(index % 2 ?
      {progressBasis: 'net_contributions', investmentNetContributionCents: 0,
        investmentCurrentValueCents: 0, investmentProgressCents: 0} :
      {manualProgressCents: 0}),
    targetAmountCents: 100_000, archived: false, revision: 1,
    visual: {color: '#6366f1', icon: 'Target', progressBarType: 'linear'},
    createdAt, updatedAt: createdAt, statusUpdatedAt: createdAt,
    createdBy: users.ownerA.uid, updatedBy: users.ownerA.uid,
    ...extra,
  };
};

const auditDoc = (ws, goalId, index) => ({
  workspaceId: ws, actorId: users.ownerA.uid, actorRole: 'owner',
  operation: 'updateGoalManualProgress', targetId: goalId,
  correlationId: `audit-${index}`, details: {beforeCents: index, afterCents: index + 1},
  timestamp: admin.firestore.Timestamp.fromMillis(Date.UTC(2026, 8, 2) + index * 1_000),
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
    await db.doc(`users/${user.uid}`).set({
      uid: user.uid, status: user === users.suspendedA ? 'suspended' : 'active',
    });
  }
  const workspaces = [wsA, wsSimilar, wsPrefix, wsB, wsArchived];
  await Promise.all(workspaces.map((ws) => db.recursiveDelete(db.doc(`workspaces/${ws}`))));
  await Promise.all(workspaces.map((ws) => db.doc(`workspaces/${ws}`).set({
    ownerId: ws === wsB ? users.ownerB.uid : users.ownerA.uid,
    type: 'PF', name: ws, status: ws === wsArchived ? 'archived' : 'active',
  })));
  const members = [
    [wsA, users.ownerA, 'owner', 'active'], [wsA, users.adminA, 'admin', 'active'],
    [wsA, users.memberA, 'member', 'active'], [wsA, users.viewerA, 'viewer', 'active'],
    [wsA, users.removedA, 'member', 'removed'], [wsA, users.suspendedA, 'member', 'active'],
    [wsA, users.demotedA, 'admin', 'active'],
    [wsB, users.ownerB, 'owner', 'active'],
    [wsSimilar, users.ownerB, 'owner', 'active'], [wsPrefix, users.ownerB, 'owner', 'active'],
    [wsArchived, users.ownerA, 'owner', 'active'], [wsArchived, users.memberA, 'member', 'active'],
  ];
  await Promise.all(members.map(([ws, user, role, status]) =>
    db.doc(`workspaces/${ws}/members/${user.uid}`).set({uid: user.uid, role, status})));
  const batch = db.batch();
  for (const ws of workspaces) {
    const count = ws === wsA ? GOAL_COUNT : 3;
    for (let index = 0; index < count; index += 1) {
      batch.set(db.doc(`workspaces/${ws}/goals/goal-${String(index).padStart(2, '0')}`), goalDoc(ws, index));
    }
    batch.set(db.doc(`workspaces/${ws}/goals/goal-arquivada`), goalDoc(ws, 99, {archived: true}));
    for (let index = 0; index < 25; index += 1) {
      batch.set(db.doc(`workspaces/${ws}/goal_audit_logs/audit-${index}`), auditDoc(ws, 'goal-00', index));
    }
    batch.set(db.doc(`workspaces/${ws}/goal_idempotency_keys/createGoal_abc`), {
      workspaceId: ws, actorId: users.ownerA.uid, operation: 'createGoal', status: 'completed',
      requestHash: 'x', result: {success: true, goalId: 'goal-00', revision: 1},
    });
  }
  await batch.commit();
};

/** Cópia sem `Timestamp` do Admin SDK (o SDK cliente recusa o objeto). */
const clientSafe = (data) => Object.fromEntries(Object.entries(data)
  .filter(([, value]) => !(value instanceof admin.firestore.Timestamp)));

const signedClient = async (user, suffix) => {
  const app = initializeApp(
    {apiKey: 'rules-test', projectId},
    `p5b-${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  if (user) await signInWithEmailAndPassword(auth, user.email, password);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {app, db, auth};
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

const goalRef = (db, ws, id) => doc(db, `workspaces/${ws}/goals/${id}`);

/** Página da lista, exatamente como `listGoalsPage`. */
const pageQuery = (db, ws, max = LIST_CAP, cursor) => query(
  collection(db, 'workspaces', ws, 'goals'),
  where('archived', '==', false),
  orderBy('priorityRank', 'desc'),
  orderBy('createdAt', 'desc'),
  orderBy(documentId(), 'desc'),
  ...(cursor ? [startAfter(cursor.priorityRank, cursor.createdAt, cursor.id)] : []),
  limit(max),
);

/** Seletor de metas de investimento, como `listInvestmentGoalOptions`. */
const investmentOptionsQuery = (db, ws, max = LIST_CAP) => query(
  collection(db, 'workspaces', ws, 'goals'),
  where('archived', '==', false),
  where('progressSource', '==', 'investment'),
  orderBy('name', 'asc'),
  orderBy(documentId(), 'asc'),
  limit(max),
);

/** Histórico manual, como `listGoalManualProgressHistory`. */
const historyQuery = (db, ws, max = AUDIT_CAP) => query(
  collection(db, 'workspaces', ws, 'goal_audit_logs'),
  where('targetId', '==', 'goal-00'),
  where('operation', '==', 'updateGoalManualProgress'),
  orderBy('timestamp', 'desc'),
  limit(max),
);

test.before(seed);

// 1–4. Cada papel ativo lê meta, página e seletor com teto.
for (const name of ACTIVE_A) {
  test(`P5-B Rules — ${name} lê meta, página da lista e seletor de investimentos`, async () => {
    await withClients([name], async ({[name]: {db}}) => {
      const goal = await getDoc(goalRef(db, wsA, 'goal-00'));
      assert.equal(goal.get('name'), 'Meta 00');
      const page = await getDocs(pageQuery(db, wsA));
      assert.equal(page.size, LIST_CAP);
      assert.ok(page.docs.every((entry) => entry.get('archived') === false));
      const options = await getDocs(investmentOptionsQuery(db, wsA));
      assert.equal(options.size, GOAL_COUNT / 2);
      assert.ok(options.docs.every((entry) => entry.get('progressSource') === 'investment'));
    });
  });
}

// 5. Paginação por cursor dentro do teto, sem repetir.
test('P5-B Rules — paginação por cursor com teto percorre tudo sem repetir', async () => {
  await withClients(['viewerA'], async ({viewerA}) => {
    const seen = [];
    let cursor;
    for (;;) {
      const snapshot = await getDocs(pageQuery(viewerA.db, wsA, LIST_CAP, cursor));
      const docs = snapshot.docs.slice(0, LIST_CAP - 1);
      seen.push(...docs.map((entry) => entry.id));
      if (snapshot.size < LIST_CAP) break;
      const last = docs[docs.length - 1];
      cursor = {priorityRank: last.get('priorityRank'), createdAt: last.get('createdAt'), id: last.id};
    }
    assert.equal(seen.length, GOAL_COUNT);
    assert.equal(new Set(seen).size, GOAL_COUNT);
    assert.ok(!seen.includes('goal-arquivada'));
  });
});

// 6. Teto da listagem: sem limite e acima de 26 negados a todos.
test('P5-B Rules — listagem sem limite ou acima de 26 é negada a todos os papéis', async () => {
  await withClients(ACTIVE_A, async (clients) => {
    for (const name of ACTIVE_A) {
      const {db} = clients[name];
      await denied(getDocs(collection(db, 'workspaces', wsA, 'goals')), `${name} sem limite`);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, 'goals'),
        where('archived', '==', false))), `${name} filtro sem limite`);
      await denied(getDocs(pageQuery(db, wsA, LIST_CAP + 1)), `${name} limite 27`);
      await denied(getDocs(investmentOptionsQuery(db, wsA, 100)), `${name} seletor 100`);
    }
  });
});

// 7. Não membro e IDs de workspace parecidos.
test('P5-B Rules — não membro e IDs de workspace parecidos não alcançam metas', async () => {
  await withClients(['ownerB', 'ownerA'], async ({ownerB, ownerA}) => {
    await denied(getDoc(goalRef(ownerB.db, wsA, 'goal-00')), 'B lê meta de A');
    await denied(getDocs(pageQuery(ownerB.db, wsA, 10)), 'B lista metas de A');
    await denied(getDocs(historyQuery(ownerB.db, wsA)), 'B lê trilha de A');
    for (const ws of [wsSimilar, wsPrefix]) {
      await denied(getDoc(goalRef(ownerA.db, ws, 'goal-00')), `A lê ${ws}`);
      await denied(getDocs(pageQuery(ownerA.db, ws, 10)), `A lista ${ws}`);
    }
    // Controle: cada dono lê o próprio.
    assert.equal((await getDoc(goalRef(ownerB.db, wsSimilar, 'goal-00'))).exists(), true);
  });
});

// 8. Membro removido e conta suspensa.
test('P5-B Rules — membro removido e conta suspensa não leem metas', async () => {
  await withClients(['removedA', 'suspendedA'], async ({removedA, suspendedA}) => {
    for (const [label, {db}] of [['removido', removedA], ['suspenso', suspendedA]]) {
      await denied(getDoc(goalRef(db, wsA, 'goal-00')), `${label} lê meta`);
      await denied(getDocs(pageQuery(db, wsA, 10)), `${label} lista metas`);
    }
  });
});

// 9. Sem autenticação.
test('P5-B Rules — cliente anônimo ou sem login não lê metas', async () => {
  const anonymous = await signedClient(null, 'anon');
  try {
    await denied(getDoc(goalRef(anonymous.db, wsA, 'goal-00')), 'sem login lê meta');
    await signInAnonymously(anonymous.auth);
    await denied(getDoc(goalRef(anonymous.db, wsA, 'goal-00')), 'anônimo lê meta');
    await denied(getDocs(pageQuery(anonymous.db, wsA, 10)), 'anônimo lista metas');
  } finally {
    await deleteApp(anonymous.app);
  }
});

// 10. Nenhuma escrita direta, nem do owner.
test('P5-B Rules — nenhum papel cria, altera ou apaga meta diretamente', async () => {
  await withClients(ACTIVE_A, async (clients) => {
    for (const name of ACTIVE_A) {
      const {db} = clients[name];
      await denied(setDoc(goalRef(db, wsA, `forjada-${name}`), clientSafe(goalDoc(wsA, 50))), `${name} cria`);
      for (const patch of [
        {status: 'alcancada'}, {archived: true}, {manualProgressCents: 999_999},
        {investmentProgressCents: 1}, {revision: 99}, {name: 'Renomeada'},
      ]) {
        await denied(updateDoc(goalRef(db, wsA, 'goal-00'), patch), `${name} altera ${Object.keys(patch)[0]}`);
      }
      await denied(deleteDoc(goalRef(db, wsA, 'goal-00')), `${name} apaga`);
    }
  });
  const stored = (await getAdmin().firestore().doc(`workspaces/${wsA}/goals/goal-00`).get()).data();
  assert.equal(stored.status, 'em_andamento');
  assert.equal(stored.archived, false);
  assert.equal(stored.revision, 1);
});

// 11. Trilha: owner/admin leem com teto; member e viewer não.
test('P5-B Rules — trilha das metas: owner/admin com teto de 20; member e viewer não', async () => {
  await withClients(ACTIVE_A, async (clients) => {
    for (const name of ['ownerA', 'adminA']) {
      const {db} = clients[name];
      const page = await getDocs(historyQuery(db, wsA));
      assert.equal(page.size, AUDIT_CAP);
      assert.equal((await getDoc(doc(db, `workspaces/${wsA}/goal_audit_logs/audit-0`))).exists(), true);
      await denied(getDocs(historyQuery(db, wsA, AUDIT_CAP + 1)), `${name} trilha 21`);
      await denied(getDocs(collection(db, 'workspaces', wsA, 'goal_audit_logs')), `${name} trilha sem limite`);
      await denied(setDoc(doc(db, `workspaces/${wsA}/goal_audit_logs/forjada`), clientSafe(auditDoc(wsA, 'goal-00', 99))),
        `${name} grava trilha`);
      await denied(deleteDoc(doc(db, `workspaces/${wsA}/goal_audit_logs/audit-0`)), `${name} apaga trilha`);
    }
    for (const name of ['memberA', 'viewerA']) {
      const {db} = clients[name];
      await denied(getDocs(historyQuery(db, wsA)), `${name} lista trilha`);
      await denied(getDoc(doc(db, `workspaces/${wsA}/goal_audit_logs/audit-0`)), `${name} lê trilha`);
    }
  });
});

// 12. Chaves de idempotência: fechadas.
test('P5-B Rules — chaves de idempotência das metas são fechadas a todos', async () => {
  await withClients(ACTIVE_A, async (clients) => {
    for (const name of ACTIVE_A) {
      const {db} = clients[name];
      const ref = doc(db, `workspaces/${wsA}/goal_idempotency_keys/createGoal_abc`);
      await denied(getDoc(ref), `${name} lê chave`);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, 'goal_idempotency_keys'), limit(5))),
        `${name} lista chaves`);
      await denied(setDoc(doc(db, `workspaces/${wsA}/goal_idempotency_keys/forjada`), {status: 'completed'}),
        `${name} grava chave`);
      await denied(deleteDoc(ref), `${name} apaga chave`);
    }
  });
});

// 13. Workspace arquivado: metas legíveis, trilha não.
test('P5-B Rules — workspace arquivado: metas somente leitura e trilha fechada', async () => {
  await withClients(['memberA', 'ownerA'], async ({memberA, ownerA}) => {
    assert.equal((await getDoc(goalRef(memberA.db, wsArchived, 'goal-00'))).exists(), true);
    assert.equal((await getDocs(pageQuery(memberA.db, wsArchived))).size, 3);
    await denied(updateDoc(goalRef(ownerA.db, wsArchived, 'goal-00'), {status: 'pausada'}),
      'owner altera meta em arquivado');
    await denied(getDocs(historyQuery(ownerA.db, wsArchived)), 'owner lê trilha em arquivado');
  });
});

// 14. Rebaixamento de papel entre leituras.
test('P5-B Rules — rebaixamento de admin para viewer fecha a trilha na hora', async () => {
  await withClients(['demotedA'], async ({demotedA}) => {
    assert.equal((await getDocs(historyQuery(demotedA.db, wsA))).size, AUDIT_CAP);
    await getAdmin().firestore().doc(`workspaces/${wsA}/members/${users.demotedA.uid}`)
      .update({role: 'viewer'});
    await denied(getDocs(historyQuery(demotedA.db, wsA)), 'viewer rebaixado lê trilha');
    assert.equal((await getDoc(goalRef(demotedA.db, wsA, 'goal-00'))).exists(), true,
      'viewer continua lendo metas');
    await getAdmin().firestore().doc(`workspaces/${wsA}/members/${users.demotedA.uid}`)
      .update({status: 'removed'});
    await denied(getDoc(goalRef(demotedA.db, wsA, 'goal-00')), 'removido lê meta');
  });
});

// 15. Catch-all e collection group não reabrem.
test('P5-B Rules — catch-all e collection group não reabrem metas', async () => {
  await withClients(['ownerA'], async ({ownerA}) => {
    await denied(getDocs(query(collectionGroup(ownerA.db, 'goals'), limit(5))), 'collection group de metas');
    await denied(getDocs(query(collectionGroup(ownerA.db, 'goal_audit_logs'), limit(5))),
      'collection group da trilha');
    await denied(getDocs(query(collection(ownerA.db, 'workspaces', wsA, 'goals'), limit(500))),
      'listagem grande pela catch-all');
  });
});

// 16. P5-B.1 — metas por ID (nomear posição além das páginas carregadas):
// `in` com teto dentro do limite da listagem; outro workspace e sem limite, não.
const byIdsQuery = (db, ws, ids, max) => query(
  collection(db, 'workspaces', ws, 'goals'),
  where(documentId(), 'in', ids),
  ...(max === undefined ? [] : [limit(max)]),
);

test('P5-B.1 Rules — metas por ID: membro lê em lotes de 25; sem limite, acima do teto ou de fora, não', async () => {
  const ids = Array.from({length: 25}, (_, index) => `goal-${String(index).padStart(2, '0')}`);
  await withClients(['viewerA', 'ownerB'], async ({viewerA, ownerB}) => {
    const snapshot = await getDocs(byIdsQuery(viewerA.db, wsA, ids, 25));
    assert.equal(snapshot.size, 25);
    await denied(getDocs(byIdsQuery(viewerA.db, wsA, ids)), 'viewer por ID sem limite');
    await denied(getDocs(byIdsQuery(viewerA.db, wsA, [...ids, 'goal-25', 'goal-26'], 27)),
      'viewer por ID acima de 26');
    await denied(getDocs(byIdsQuery(ownerB.db, wsA, ids.slice(0, 5), 5)), 'dono de outro workspace por ID');
    await denied(getDocs(byIdsQuery(viewerA.db, wsB, ids.slice(0, 5), 5)), 'viewer A em workspace B por ID');
  });
});
