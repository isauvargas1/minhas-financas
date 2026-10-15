import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {deleteApp, initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {
  addDoc,
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
  deleteField,
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
  startAfter,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

/**
 * P5-D1 (PR-NOTIF-01) — Rules das notificações contra o Emulator.
 *
 * - `notifications/{id}`: evento compartilhado do workspace, gravado só pelo
 *   backend. Todo membro ativo (owner, admin, member, viewer) lê, com teto de
 *   listagem de 50; nenhum papel cria, altera (nem `read`) ou apaga.
 * - `notification_user_states/{uid}/notification_entries/{id}`: estado privado
 *   de cada usuário (lida, arquivada para si; D-18-NOTIF acrescenta a exclusão
 *   para si, coberta em `notifications-d18`). Só o dono, membro ativo, lê e
 *   grava o seu; marcas monotônicas com carimbo do servidor; `expiresAt`
 *   obrigatório e igual ao do evento; sem exclusão do documento; nada de outro
 *   usuário, de outro workspace, de membro removido ou de conta suspensa; o
 *   documento intermediário é fechado.
 * - A subcoleção antiga `items` não existe mais: leitura e escrita negadas.
 * - A catch-all de subcoleção não reabre nada disso.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da P5-D1.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-p5d1-123456';

const users = {
  ownerA: {uid: 'p5d1-owner-a', email: 'p5d1-owner-a@example.test'},
  adminA: {uid: 'p5d1-admin-a', email: 'p5d1-admin-a@example.test'},
  memberA: {uid: 'p5d1-member-a', email: 'p5d1-member-a@example.test'},
  viewerA: {uid: 'p5d1-viewer-a', email: 'p5d1-viewer-a@example.test'},
  removedA: {uid: 'p5d1-removed-a', email: 'p5d1-removed-a@example.test'},
  suspendedA: {uid: 'p5d1-suspended-a', email: 'p5d1-suspended-a@example.test'},
  ownerB: {uid: 'p5d1-owner-b', email: 'p5d1-owner-b@example.test'},
};
const ACTIVE_A = ['ownerA', 'adminA', 'memberA', 'viewerA'];
const wsA = 'p5d1-workspace-a';
const wsB = 'p5d1-workspace-b';
const wsArchived = 'p5d1-workspace-arquivado';
const LIST_CAP = 50;
const SAME_INSTANT = '2026-10-08T12:00:00.000Z';
/** D-18-NOTIF: expiração dos eventos semeados (agora + 30 dias, em segundos inteiros). */
const EXPIRES_MS = Math.floor(Date.now() / 1000) * 1000 + 30 * 86_400_000;
const clientExpiresAt = () => Timestamp.fromMillis(EXPIRES_MS);

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

/** Forma do evento gravado pelo produtor de cartões (sem `read`). */
const notificationDoc = (ws, id, createdAt) => ({
  workspaceId: ws, title: `Aviso ${id}`, message: 'Fatura fechada.', type: 'credit_card',
  link: 'cards', actionLabel: 'Ver cartões', createdAt, source: 'cards', domain: 'credit_card',
  domainEventType: 'invoice.closed', cardId: 'card-1', invoiceId: `inv-${id}`,
  expiresAt: getAdmin().firestore.Timestamp.fromMillis(EXPIRES_MS),
});

// Três eventos no mesmo instante (empate de `createdAt`) e um anterior.
const SEEDED = [
  ['n-a', SAME_INSTANT], ['n-b', SAME_INSTANT], ['n-c', SAME_INSTANT],
  ['n-old', '2026-10-01T09:00:00.000Z'],
];
// Notificações extras para os lotes de marcação. O cliente grava em lotes de
// 10 (`NOTIFICATION_MARK_BATCH_SIZE`); 15 criações por lote é o teto medido
// (5 acessos fixos + 1 por criação, teto de 20 das Rules; medido na D-18-NOTIF: 15 passam, 16 são recusadas).
const BATCH_IDS = Array.from({length: 15}, (_, index) => `n-lote-${String(index).padStart(2, '0')}`);
const CLIENT_CHUNK = BATCH_IDS.slice(0, 10);

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
  await Promise.all([wsA, wsB, wsArchived].map((ws) => db.recursiveDelete(db.doc(`workspaces/${ws}`))));
  await Promise.all([
    db.doc(`workspaces/${wsA}`).set({ownerId: users.ownerA.uid, type: 'PF', name: 'A', status: 'active'}),
    db.doc(`workspaces/${wsB}`).set({ownerId: users.ownerB.uid, type: 'PJ', name: 'B', status: 'active'}),
    db.doc(`workspaces/${wsArchived}`).set({ownerId: users.ownerA.uid, type: 'PF', name: 'Arq', status: 'archived'}),
  ]);
  const members = [
    [wsA, users.ownerA, 'owner', 'active'], [wsA, users.adminA, 'admin', 'active'],
    [wsA, users.memberA, 'member', 'active'], [wsA, users.viewerA, 'viewer', 'active'],
    [wsA, users.removedA, 'member', 'removed'], [wsA, users.suspendedA, 'member', 'active'],
    [wsB, users.ownerB, 'owner', 'active'], [wsArchived, users.memberA, 'member', 'active'],
  ];
  await Promise.all(members.map(([ws, user, role, status]) =>
    db.doc(`workspaces/${ws}/members/${user.uid}`).set({uid: user.uid, role, status})));
  const batch = db.batch();
  for (const ws of [wsA, wsB, wsArchived]) {
    for (const [id, createdAt] of SEEDED) {
      batch.set(db.doc(`workspaces/${ws}/notifications/${id}`), notificationDoc(ws, id, createdAt));
    }
  }
  for (const id of BATCH_IDS) {
    batch.set(db.doc(`workspaces/${wsA}/notifications/${id}`), notificationDoc(wsA, id, '2026-09-01T00:00:00.000Z'));
  }
  // Estado do removido gravado antes da remoção (pelo backend, para o teste).
  batch.set(db.doc(`workspaces/${wsA}/notification_user_states/${users.removedA.uid}/notification_entries/n-a`), {
    read: true, readAt: firebaseAdmin.firestore.Timestamp.now(),
    expiresAt: firebaseAdmin.firestore.Timestamp.fromMillis(EXPIRES_MS),
  });
  await batch.commit();
};

const signedClient = async (user, suffix) => {
  const app = initializeApp(
    {apiKey: 'rules-test', projectId},
    `p5d1-${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
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

const notificationRef = (db, ws, id) => doc(db, `workspaces/${ws}/notifications/${id}`);
const stateRef = (db, ws, uid, id) => doc(db, `workspaces/${ws}/notification_user_states/${uid}/notification_entries/${id}`);
const statesCollection = (db, ws, uid) => collection(db, `workspaces/${ws}/notification_user_states/${uid}/notification_entries`);
const adminState = (ws, uid, id) =>
  getAdmin().firestore().doc(`workspaces/${ws}/notification_user_states/${uid}/notification_entries/${id}`).get();

/** Página do painel: mais recentes primeiro, desempate por ID (`listNotificationPage`). */
const pageQuery = (db, ws, max, cursor) => query(
  collection(db, 'workspaces', ws, 'notifications'),
  orderBy('createdAt', 'desc'),
  orderBy(documentId(), 'desc'),
  ...(cursor ? [startAfter(cursor.createdAt, cursor.id)] : []),
  limit(max),
);

const markRead = () => ({read: true, readAt: serverTimestamp(), expiresAt: clientExpiresAt()});
const markDismissed = () => ({dismissed: true, dismissedAt: serverTimestamp(), expiresAt: clientExpiresAt()});

test.before(seed);

// 1–4. Leitura de cada papel ativo.
for (const name of ACTIVE_A) {
  test(`P5-D1 Rules — ${name} lê a notificação e a primeira página com teto`, async () => {
    await withClients([name], async ({[name]: {db}}) => {
      const item = await getDoc(notificationRef(db, wsA, 'n-a'));
      assert.equal(item.get('title'), 'Aviso n-a');
      assert.equal(item.get('read'), undefined, 'o evento não carrega estado de leitura');
      const page = await getDocs(pageQuery(db, wsA, 26));
      assert.equal(page.size, SEEDED.length + BATCH_IDS.length);
    });
  });
}

// 5. Não membro.
test('P5-D1 Rules — não membro não lê nem lista notificações de outro workspace', async () => {
  await withClients(['ownerB'], async ({ownerB}) => {
    await denied(getDoc(notificationRef(ownerB.db, wsA, 'n-a')), 'ownerB lê notificação de A');
    await denied(getDocs(pageQuery(ownerB.db, wsA, 10)), 'ownerB lista notificações de A');
    // Controle: no próprio workspace, lê.
    assert.equal((await getDoc(notificationRef(ownerB.db, wsB, 'n-a'))).exists(), true);
  });
});

// 6. Membro removido.
test('P5-D1 Rules — membro removido não lê nem lista notificações', async () => {
  await withClients(['removedA'], async ({removedA}) => {
    await denied(getDoc(notificationRef(removedA.db, wsA, 'n-a')), 'removido lê notificação');
    await denied(getDocs(pageQuery(removedA.db, wsA, 10)), 'removido lista notificações');
  });
});

// 7. Listagem sem limite.
test('P5-D1 Rules — listagem sem limite é negada a todos os papéis', async () => {
  await withClients(ACTIVE_A, async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      await denied(getDocs(collection(db, 'workspaces', wsA, 'notifications')), `${name} lista sem limite`);
      await denied(
        getDocs(query(collection(db, 'workspaces', wsA, 'notifications'), orderBy('createdAt', 'desc'))),
        `${name} lista ordenada sem limite (consulta anterior à P5-D1)`,
      );
    }
  });
});

// 8. Listagem acima do teto.
test('P5-D1 Rules — listagem acima de 50 é negada', async () => {
  await withClients(ACTIVE_A, async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      await denied(getDocs(pageQuery(db, wsA, LIST_CAP + 1)), `${name} lista 51`);
      assert.equal((await getDocs(pageQuery(db, wsA, LIST_CAP))).size, SEEDED.length + BATCH_IDS.length,
        `${name} lista no teto`);
    }
  });
});

// 9. Listagem limitada com cursor estável e empate de createdAt.
test('P5-D1 Rules — listagem limitada pagina por cursor sem repetir empates', async () => {
  await withClients(['viewerA'], async ({viewerA}) => {
    const seen = [];
    let cursor = null;
    for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
      const snapshot = await getDocs(pageQuery(viewerA.db, wsA, 2, cursor));
      if (snapshot.empty) break;
      for (const entry of snapshot.docs) seen.push(entry.id);
      const last = snapshot.docs[snapshot.docs.length - 1];
      cursor = {createdAt: last.get('createdAt'), id: last.id};
      if (snapshot.size < 2) break;
    }
    assert.deepEqual(seen.slice(0, 4), ['n-c', 'n-b', 'n-a', 'n-old'], 'empate desfeito pelo ID, decrescente');
    assert.equal(new Set(seen).size, seen.length, 'nenhum evento repetido entre páginas');
    assert.equal(seen.length, SEEDED.length + BATCH_IDS.length, 'nenhum evento perdido');
  });
});

// 10. Nenhuma escrita no evento compartilhado.
test('P5-D1 Rules — nenhum papel cria nem altera a notificação compartilhada', async () => {
  await withClients([...ACTIVE_A, 'ownerB'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const forged = {
        ...notificationDoc(wsA, `forjada-${name}`, new Date().toISOString()),
        expiresAt: clientExpiresAt(),
      };
      await denied(setDoc(notificationRef(db, wsA, `forjada-${name}`), forged), `${name} cria com ID`);
      await denied(addDoc(collection(db, 'workspaces', wsA, 'notifications'), forged), `${name} cria com ID automático`);
      await denied(updateDoc(notificationRef(db, wsA, 'n-a'), {read: true}), `${name} marca lida no evento`);
      await denied(updateDoc(notificationRef(db, wsA, 'n-a'), {title: 'Alterado'}), `${name} altera o título`);
      await denied(setDoc(notificationRef(db, wsA, 'n-a'), {dismissed: true}, {merge: true}), `${name} arquiva no evento`);
    }
  });
  const persisted = await getAdmin().firestore().doc(`workspaces/${wsA}/notifications/n-a`).get();
  assert.equal(persisted.get('title'), 'Aviso n-a');
  assert.equal(persisted.get('read'), undefined);
  assert.equal(persisted.get('dismissed'), undefined);
});

// 11. Nenhuma exclusão do evento compartilhado.
test('P5-D1 Rules — nenhum papel apaga a notificação compartilhada', async () => {
  await withClients([...ACTIVE_A, 'ownerB'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      await denied(deleteDoc(notificationRef(db, wsA, 'n-b')), `${name} apaga o evento`);
    }
  });
  assert.equal((await getAdmin().firestore().doc(`workspaces/${wsA}/notifications/n-b`).get()).exists, true);
});

// 12. Viewer marca o próprio estado; o dos outros fica intacto.
test('P5-D1 Rules — viewer marca leitura e arquivamento só para si, de forma idempotente', async () => {
  await withClients(['viewerA', 'memberA'], async ({viewerA, memberA}) => {
    const ref = stateRef(viewerA.db, wsA, users.viewerA.uid, 'n-a');
    await setDoc(ref, markRead());
    const first = await getDoc(ref);
    assert.equal(first.get('read'), true);
    assert.ok(first.get('readAt') instanceof Timestamp, 'readAt é timestamp do servidor');

    // Repetir: a transação lê o estado e não regrava a marca já feita.
    const rewrote = await runTransaction(viewerA.db, async (transaction) => {
      const current = await transaction.get(ref);
      if (current.get('read') === true) return false;
      transaction.set(ref, markRead(), {merge: true});
      return true;
    });
    assert.equal(rewrote, false);
    assert.deepEqual((await getDoc(ref)).get('readAt'), first.get('readAt'), 'carimbo da primeira leitura preservado');

    // Arquivar para si, depois de lida, preservando a leitura.
    await setDoc(ref, markDismissed(), {merge: true});
    const both = await getDoc(ref);
    assert.equal(both.get('read'), true);
    assert.equal(both.get('dismissed'), true);
    assert.ok(both.get('dismissedAt') instanceof Timestamp);

    // Arquivar sem ter lido também vale (marca independente).
    await setDoc(stateRef(viewerA.db, wsA, users.viewerA.uid, 'n-b'), markDismissed());

    // O membro continua vendo o evento e sem estado nenhum.
    assert.equal((await getDoc(notificationRef(memberA.db, wsA, 'n-a'))).exists(), true);
    assert.equal((await getDoc(stateRef(memberA.db, wsA, users.memberA.uid, 'n-a'))).exists(), false);
  });
  assert.equal((await adminState(wsA, users.memberA.uid, 'n-a')).exists, false);
});

// 13. Outro usuário não alcança o estado do viewer.
test('P5-D1 Rules — outro usuário não lê nem grava o estado do viewer', async () => {
  await withClients(['ownerA', 'adminA', 'memberA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const viewerState = stateRef(db, wsA, users.viewerA.uid, 'n-a');
      await denied(getDoc(viewerState), `${name} lê o estado do viewer`);
      await denied(getDocs(query(statesCollection(db, wsA, users.viewerA.uid), limit(10))), `${name} lista o estado do viewer`);
      await denied(setDoc(stateRef(db, wsA, users.viewerA.uid, 'n-c'), markRead()), `${name} cria estado para o viewer`);
      await denied(setDoc(stateRef(db, wsA, users.viewerA.uid, 'n-old'), markDismissed()), `${name} arquiva pelo viewer`);
      await denied(updateDoc(viewerState, {dismissed: true, dismissedAt: serverTimestamp()}), `${name} altera o estado do viewer`);
      await denied(deleteDoc(viewerState), `${name} apaga o estado do viewer`);
    }
  });
  assert.equal((await adminState(wsA, users.viewerA.uid, 'n-c')).exists, false);
  assert.equal((await adminState(wsA, users.viewerA.uid, 'n-old')).exists, false);
});

// 14. Workspace B não alcança os estados de A (nem pelo próprio uid em A).
test('P5-D1 Rules — workspace B não acessa estados do workspace A', async () => {
  await withClients(['ownerB', 'viewerA'], async ({ownerB, viewerA}) => {
    await denied(getDoc(stateRef(ownerB.db, wsA, users.viewerA.uid, 'n-a')), 'ownerB lê estado de A');
    await denied(getDocs(query(statesCollection(ownerB.db, wsA, users.viewerA.uid), limit(10))), 'ownerB lista estado de A');
    await denied(getDoc(stateRef(ownerB.db, wsA, users.ownerB.uid, 'n-a')), 'ownerB lê "o seu" estado em A');
    await denied(setDoc(stateRef(ownerB.db, wsA, users.ownerB.uid, 'n-a'), markRead()), 'ownerB grava "o seu" estado em A');
    // E o inverso: o viewer de A não grava estado em B.
    await denied(setDoc(stateRef(viewerA.db, wsB, users.viewerA.uid, 'n-a'), markRead()), 'viewerA grava estado em B');
    // Controle: em B, o ownerB grava o seu.
    await setDoc(stateRef(ownerB.db, wsB, users.ownerB.uid, 'n-a'), markRead());
  });
  assert.equal((await adminState(wsA, users.ownerB.uid, 'n-a')).exists, false);
});

// 15. Forma estrita: campos extras, tipos, carimbo do cliente, desmarcar.
test('P5-D1 Rules — campos extras, valores inválidos e carimbo do cliente são rejeitados', async () => {
  await withClients(['memberA'], async ({memberA}) => {
    const own = (id) => stateRef(memberA.db, wsA, users.memberA.uid, id);
    const clientTime = Timestamp.fromDate(new Date('2026-10-08T00:00:00.000Z'));
    await denied(setDoc(own('n-c'), {...markRead(), workspaceId: wsA}), 'campo extra');
    await denied(setDoc(own('n-c'), {...markRead(), uid: users.memberA.uid}), 'uid no estado');
    await denied(setDoc(own('n-c'), {...markRead(), notificationId: 'n-c'}), 'id no estado');
    await denied(setDoc(own('n-c'), {read: false, readAt: serverTimestamp(), expiresAt: clientExpiresAt()}), 'read false');
    await denied(setDoc(own('n-c'), {read: 'true', readAt: serverTimestamp(), expiresAt: clientExpiresAt()}), 'read não booleano');
    await denied(setDoc(own('n-c'), {read: true, expiresAt: clientExpiresAt()}), 'marca sem carimbo');
    await denied(setDoc(own('n-c'), {readAt: serverTimestamp(), expiresAt: clientExpiresAt()}), 'carimbo sem marca');
    await denied(setDoc(own('n-c'), {read: true, readAt: clientTime, expiresAt: clientExpiresAt()}), 'carimbo escolhido pelo cliente');
    await denied(setDoc(own('n-c'), {read: true, readAt: '2026-10-08T00:00:00.000Z', expiresAt: clientExpiresAt()}), 'carimbo em texto');
    await denied(setDoc(own('n-c'), {dismissed: true, dismissedAt: clientTime, expiresAt: clientExpiresAt()}), 'arquivamento com carimbo do cliente');
    await denied(setDoc(own('n-c'), {}), 'estado vazio');
    await denied(setDoc(own('n-c'), {expiresAt: clientExpiresAt()}), 'só expiresAt, sem nenhuma marca');

    // Marcas gravadas não voltam nem somem.
    await setDoc(own('n-c'), markRead());
    await denied(updateDoc(own('n-c'), {read: false}), 'desmarcar leitura');
    await denied(updateDoc(own('n-c'), {readAt: serverTimestamp()}), 'reescrever o carimbo');
    await denied(updateDoc(own('n-c'), {read: deleteField(), readAt: deleteField()}), 'remover a leitura');
    await denied(setDoc(own('n-c'), markDismissed()), 'regravar sem preservar a leitura');
    await denied(updateDoc(own('n-c'), {...markDismissed(), extra: 1}), 'campo extra na atualização');
    await denied(setDoc(own('n-c'), markRead(), {merge: true}), 'reescrever a leitura já gravada');
  });
  const state = await adminState(wsA, users.memberA.uid, 'n-c');
  assert.deepEqual(Object.keys(state.data()).sort(), ['expiresAt', 'read', 'readAt']);
});

// 16. Removido não altera nem lê o próprio estado antigo.
test('P5-D1 Rules — membro removido não lê nem altera o próprio estado', async () => {
  await withClients(['removedA'], async ({removedA}) => {
    const own = stateRef(removedA.db, wsA, users.removedA.uid, 'n-a');
    await denied(getDoc(own), 'removido lê o próprio estado');
    await denied(getDocs(query(statesCollection(removedA.db, wsA, users.removedA.uid), limit(10))), 'removido lista o próprio estado');
    await denied(setDoc(own, markDismissed(), {merge: true}), 'removido arquiva');
    await denied(setDoc(stateRef(removedA.db, wsA, users.removedA.uid, 'n-b'), markRead()), 'removido marca leitura');
    await denied(deleteDoc(own), 'removido apaga o próprio estado');
  });
  const state = await adminState(wsA, users.removedA.uid, 'n-a');
  assert.equal(state.get('dismissed'), undefined);
});

// 17. A catch-all e caminhos laterais não reabrem nada.
test('P5-D1 Rules — catch-all, documento intermediário, collection group e a subcoleção antiga items continuam fechados', async () => {
  await withClients(['viewerA', 'ownerA'], async ({viewerA, ownerA}) => {
    const parent = doc(viewerA.db, `workspaces/${wsA}/notification_user_states/${users.viewerA.uid}`);
    await denied(getDoc(parent), 'lê o documento intermediário do próprio estado');
    await denied(getDoc(doc(ownerA.db, `workspaces/${wsA}/notification_user_states/${users.viewerA.uid}`)),
      'owner lê o documento intermediário do viewer');
    await denied(setDoc(parent, {anything: true}), 'grava o documento intermediário');
    await denied(getDocs(query(collection(viewerA.db, 'workspaces', wsA, 'notification_user_states'), limit(10))),
      'lista os donos de estado');
    // Sem `notification_entries` no filtro de dono: nenhum collection group abre estados de outros.
    await denied(getDocs(query(collectionGroup(ownerA.db, 'notification_entries'), limit(10))),
      'collection group de estados (sem filtro de dono)');
    await denied(getDocs(query(collectionGroup(viewerA.db, 'notification_entries'), limit(10))),
      'collection group de estados pelo próprio dono');
    // A subcoleção antiga `items` deixou de existir: leitura e escrita negadas.
    await denied(getDocs(query(collectionGroup(ownerA.db, 'items'), limit(10))), 'collection group da subcoleção antiga');
    const legacy = doc(viewerA.db, `workspaces/${wsA}/notification_user_states/${users.viewerA.uid}/items/n-a`);
    await denied(getDoc(legacy), 'lê a subcoleção antiga items');
    await denied(getDocs(query(collection(viewerA.db, `workspaces/${wsA}/notification_user_states/${users.viewerA.uid}/items`), limit(10))),
      'lista a subcoleção antiga items');
    await denied(setDoc(legacy, markRead()), 'grava na subcoleção antiga items');
    await denied(setDoc(legacy, {read: true, readAt: serverTimestamp()}), 'grava o formato P5-D1 em items');
    await denied(updateDoc(legacy, {read: true}), 'atualiza a subcoleção antiga items');
    await denied(deleteDoc(legacy), 'apaga na subcoleção antiga items');
    await denied(getDocs(query(collectionGroup(ownerA.db, 'notifications'), limit(10))), 'collection group de notificações');
    await denied(getDocs(collection(viewerA.db, 'workspaces', wsA, 'notifications')), 'listagem sem limite pela catch-all');
  });
});

// 18. Sem exclusão do estado, nem pelo dono.
test('P5-D1 Rules — o dono não apaga o próprio estado (arquivar não é excluir)', async () => {
  await withClients(['viewerA', 'ownerA'], async ({viewerA, ownerA}) => {
    await denied(deleteDoc(stateRef(viewerA.db, wsA, users.viewerA.uid, 'n-a')), 'viewer apaga o próprio estado');
    await setDoc(stateRef(ownerA.db, wsA, users.ownerA.uid, 'n-a'), markRead());
    await denied(deleteDoc(stateRef(ownerA.db, wsA, users.ownerA.uid, 'n-a')), 'owner apaga o próprio estado');
  });
  assert.equal((await adminState(wsA, users.viewerA.uid, 'n-a')).exists, true);
  assert.equal((await adminState(wsA, users.ownerA.uid, 'n-a')).exists, true);
});

// 19. Conta suspensa segue a regra da conta.
test('P5-D1 Rules — conta suspensa não lê notificações nem grava estado', async () => {
  await withClients(['suspendedA'], async ({suspendedA}) => {
    await denied(getDoc(notificationRef(suspendedA.db, wsA, 'n-a')), 'suspenso lê notificação');
    await denied(getDocs(pageQuery(suspendedA.db, wsA, 10)), 'suspenso lista notificações');
    await denied(setDoc(stateRef(suspendedA.db, wsA, users.suspendedA.uid, 'n-a'), markRead()), 'suspenso marca leitura');
    await denied(getDoc(stateRef(suspendedA.db, wsA, users.suspendedA.uid, 'n-a')), 'suspenso lê o próprio estado');
  });
});

// 20. Workspace arquivado: leitura sim, marcação não.
test('P5-D1 Rules — workspace arquivado é somente leitura também para o estado', async () => {
  await withClients(['memberA'], async ({memberA}) => {
    assert.equal((await getDoc(notificationRef(memberA.db, wsArchived, 'n-a'))).exists(), true);
    await denied(setDoc(stateRef(memberA.db, wsArchived, users.memberA.uid, 'n-a'), markRead()), 'marca em arquivado');
    assert.equal((await getDoc(stateRef(memberA.db, wsArchived, users.memberA.uid, 'n-a'))).exists(), false,
      'lê o próprio estado (vazio) em arquivado');
  });
});

// 21. Estado só para notificação existente do mesmo workspace.
test('P5-D1 Rules — estado para notificação inexistente é negado', async () => {
  await withClients(['memberA'], async ({memberA}) => {
    await denied(setDoc(stateRef(memberA.db, wsA, users.memberA.uid, 'nao-existe'), markRead()), 'notificação inexistente');
    await denied(setDoc(stateRef(memberA.db, wsA, users.memberA.uid, 'nao-existe'), markDismissed()), 'arquivar inexistente');
  });
  assert.equal((await adminState(wsA, users.memberA.uid, 'nao-existe')).exists, false);
});

// 22. Lote do "Marcar exibidas como lidas" na mesma transação do cliente
// (`applyMark`, lotes de 10): relê os estados e grava os que faltam. E o teto
// medido, 15 criações num `writeBatch`, também cabe.
test('P5-D1 Rules — lote do cliente (10) e teto medido (15) cabem no limite de acesso', async () => {
  await withClients(['memberA', 'ownerA'], async ({memberA, ownerA}) => {
    const refs = CLIENT_CHUNK.map((id) => stateRef(memberA.db, wsA, users.memberA.uid, id));
    // Um já marcado antes: a transação não o regrava (o carimbo fica).
    await setDoc(refs[0], markRead());
    const firstStamp = (await getDoc(refs[0])).get('readAt');
    await runTransaction(memberA.db, async (transaction) => {
      const current = await Promise.all(refs.map((ref) => transaction.get(ref)));
      refs.forEach((ref, index) => {
        if (current[index].get('read') !== true) transaction.set(ref, markRead(), {merge: true});
      });
    });
    assert.deepEqual((await getDoc(refs[0])).get('readAt'), firstStamp);
    const states = await getDocs(query(
      statesCollection(memberA.db, wsA, users.memberA.uid),
      where(documentId(), 'in', CLIENT_CHUNK),
      limit(CLIENT_CHUNK.length),
    ));
    assert.equal(states.size, CLIENT_CHUNK.length);
    assert.ok(states.docs.every((entry) => entry.get('read') === true));

    const batch = writeBatch(ownerA.db);
    for (const id of BATCH_IDS) batch.set(stateRef(ownerA.db, wsA, users.ownerA.uid, id), markDismissed());
    await batch.commit();
  });
  assert.equal((await adminState(wsA, users.ownerA.uid, BATCH_IDS[14])).get('dismissed'), true);
});

// 24. Sem autenticação, nada.
test('P5-D1 Rules — cliente sem autenticação não lê nem grava notificações ou estados', async () => {
  const app = initializeApp({apiKey: 'rules-test', projectId}, `p5d1-anon-${Date.now().toString(36)}`);
  try {
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    await denied(getDoc(notificationRef(db, wsA, 'n-a')), 'sem auth lê notificação');
    await denied(getDocs(pageQuery(db, wsA, 10)), 'sem auth lista notificações');
    await denied(getDoc(stateRef(db, wsA, users.viewerA.uid, 'n-a')), 'sem auth lê estado');
    await denied(getDocs(query(statesCollection(db, wsA, users.viewerA.uid), limit(10))), 'sem auth lista estado');
    await denied(setDoc(stateRef(db, wsA, users.viewerA.uid, 'n-c'), markRead()), 'sem auth grava estado');
    await denied(updateDoc(notificationRef(db, wsA, 'n-a'), {title: 'x'}), 'sem auth altera notificação');
  } finally {
    await deleteApp(app);
  }
});

// 23. Listagem do próprio estado com teto.
test('P5-D1 Rules — o dono lista o próprio estado só com teto de 50', async () => {
  await withClients(['viewerA'], async ({viewerA}) => {
    const own = statesCollection(viewerA.db, wsA, users.viewerA.uid);
    const page = await getDocs(query(own, where(documentId(), 'in', ['n-a', 'n-b', 'n-c']), limit(3)));
    assert.deepEqual(page.docs.map((entry) => entry.id).sort(), ['n-a', 'n-b']);
    await denied(getDocs(own), 'lista o próprio estado sem limite');
    await denied(getDocs(query(own, limit(LIST_CAP + 1))), 'lista o próprio estado acima do teto');
  });
});
