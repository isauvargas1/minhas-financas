import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {deleteApp, initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

/**
 * D-18-NOTIF — Rules do estado privado de notificação (leitura, arquivamento e
 * exclusão para si) contra o Emulator.
 *
 * - Evento: `workspaces/{ws}/notifications/{id}`, só o backend grava; todo
 *   membro ativo lê (limite ≤ 50); nenhum papel cria, altera ou apaga.
 * - Estado: `workspaces/{ws}/notification_user_states/{uid}/notification_entries/{id}`.
 *   Marcas `read`/`dismissed`/`deleted` monotônicas, carimbo do servidor,
 *   `expiresAt` obrigatório e igual ao do evento. `deleted` só para
 *   owner/admin/member (papel relido pelas Rules); viewer nunca a adiciona,
 *   mas uma marca `deleted` já gravada é mantida em qualquer atualização.
 * - A subcoleção antiga `items` não existe mais; a catch-all não reabre nada.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da D-18-NOTIF.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-d18-123456';

const users = {
  ownerA: {uid: 'd18-owner-a', email: 'd18-owner-a@example.test'},
  adminA: {uid: 'd18-admin-a', email: 'd18-admin-a@example.test'},
  memberA: {uid: 'd18-member-a', email: 'd18-member-a@example.test'},
  viewerA: {uid: 'd18-viewer-a', email: 'd18-viewer-a@example.test'},
  removedA: {uid: 'd18-removed-a', email: 'd18-removed-a@example.test'},
  suspendedA: {uid: 'd18-suspended-a', email: 'd18-suspended-a@example.test'},
  ownerB: {uid: 'd18-owner-b', email: 'd18-owner-b@example.test'},
};
const ACTIVE_A = ['ownerA', 'adminA', 'memberA', 'viewerA'];
const CAN_DELETE = ['ownerA', 'adminA', 'memberA'];
const wsA = 'd18-workspace-a';
const wsB = 'd18-workspace-b';
const wsArchived = 'd18-workspace-arquivado';
const LIST_CAP = 50;
const DAY_MS = 86_400_000;
/** Expiração dos eventos vivos: agora + 30 dias, em segundos inteiros. */
const EXPIRES_MS = Math.floor(Date.now() / 1000) * 1000 + 30 * DAY_MS;
const PAST_MS = Math.floor(Date.now() / 1000) * 1000 - 2 * DAY_MS;

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};
const adminTs = (ms) => getAdmin().firestore.Timestamp.fromMillis(ms);
const exp = () => Timestamp.fromMillis(EXPIRES_MS);

const eventDoc = (ws, id, expiresAt) => ({
  workspaceId: ws, title: `Aviso ${id}`, message: 'Fatura fechada.', type: 'credit_card',
  link: 'cards', actionLabel: 'Ver cartões', createdAt: '2026-10-08T12:00:00.000Z', source: 'cards',
  domain: 'credit_card', domainEventType: 'invoice.closed', cardId: 'card-1', invoiceId: `inv-${id}`,
  ...(expiresAt === undefined ? {} : {expiresAt}),
});

let counter = 0;
/** Evento novo (vivo, 30 dias) semeado pelo backend: cada teste usa o seu para não colidir com marcas monotônicas. */
const freshEvent = async (ws = wsA, expiresAtMs = EXPIRES_MS) => {
  counter += 1;
  const id = `ev-${Date.now().toString(36)}-${counter}`;
  await getAdmin().firestore().doc(`workspaces/${ws}/notifications/${id}`)
    .set(eventDoc(ws, id, adminTs(expiresAtMs)));
  return id;
};

const READ_IDS = ['ev-read-1', 'ev-read-2', 'ev-read-3'];

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
  for (const id of READ_IDS) {
    batch.set(db.doc(`workspaces/${wsA}/notifications/${id}`), eventDoc(wsA, id, adminTs(EXPIRES_MS)));
  }
  batch.set(db.doc(`workspaces/${wsA}/notifications/ev-expired`), eventDoc(wsA, 'ev-expired', adminTs(PAST_MS)));
  batch.set(db.doc(`workspaces/${wsA}/notifications/ev-no-expires`), eventDoc(wsA, 'ev-no-expires'));
  batch.set(db.doc(`workspaces/${wsB}/notifications/ev-b`), eventDoc(wsB, 'ev-b', adminTs(EXPIRES_MS)));
  await batch.commit();
};

const signedClient = async (user, suffix) => {
  const app = initializeApp(
    {apiKey: 'rules-test', projectId},
    `d18-${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
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

const eventRef = (db, ws, id) => doc(db, `workspaces/${ws}/notifications/${id}`);
const statePath = (ws, uid, id) => `workspaces/${ws}/notification_user_states/${uid}/notification_entries/${id}`;
const stateRef = (db, ws, uid, id) => doc(db, statePath(ws, uid, id));
const statesCollection = (db, ws, uid) =>
  collection(db, `workspaces/${ws}/notification_user_states/${uid}/notification_entries`);
const adminState = (ws, uid, id) => getAdmin().firestore().doc(statePath(ws, uid, id)).get();
/** Estado semeado pelo backend (ignora as Rules). */
const seedState = (ws, uid, id, data) => getAdmin().firestore().doc(statePath(ws, uid, id)).set(data);

const read = () => ({read: true, readAt: serverTimestamp(), expiresAt: exp()});
const dismissed = () => ({dismissed: true, dismissedAt: serverTimestamp(), expiresAt: exp()});
const deleted = () => ({deleted: true, deletedAt: serverTimestamp(), expiresAt: exp()});
const adminMark = (flag, stamp, ms = Date.now()) =>
  ({[flag]: true, [stamp]: adminTs(ms)});

test.before(seed);

// 1–4. Cada papel ativo lê (get e list ≤ 50) os eventos.
for (const name of ACTIVE_A) {
  test(`D-18-NOTIF Rules — ${name} lê o evento (get) e lista com limite de 50`, async () => {
    await withClients([name], async ({[name]: {db}}) => {
      const item = await getDoc(eventRef(db, wsA, 'ev-read-1'));
      assert.equal(item.get('title'), 'Aviso ev-read-1');
      assert.ok(item.get('expiresAt') instanceof Timestamp, 'expiresAt chega como Timestamp');
      const page = await getDocs(query(collection(db, 'workspaces', wsA, 'notifications'), limit(LIST_CAP)));
      assert.ok(page.size >= READ_IDS.length && page.size <= LIST_CAP);
    });
  });
}

// 5. Viewer marca a própria como lida.
test('D-18-NOTIF Rules — viewer marca a própria leitura (permitido)', async () => {
  const id = await freshEvent();
  await withClients(['viewerA'], async ({viewerA}) => {
    const ref = stateRef(viewerA.db, wsA, users.viewerA.uid, id);
    await setDoc(ref, read());
    const snapshot = await getDoc(ref);
    assert.equal(snapshot.get('read'), true);
    assert.ok(snapshot.get('readAt') instanceof Timestamp);
    assert.deepEqual(snapshot.get('expiresAt'), exp());
  });
});

// 6. Viewer arquiva a própria.
test('D-18-NOTIF Rules — viewer arquiva a própria (permitido)', async () => {
  const id = await freshEvent();
  await withClients(['viewerA'], async ({viewerA}) => {
    const ref = stateRef(viewerA.db, wsA, users.viewerA.uid, id);
    await setDoc(ref, dismissed());
    assert.equal((await getDoc(ref)).get('dismissed'), true);
  });
});

// 7. Viewer não exclui para si.
test('D-18-NOTIF Rules — viewer não exclui (deleted) nem na criação nem na atualização', async () => {
  const createId = await freshEvent();
  const updateId = await freshEvent();
  await withClients(['viewerA'], async ({viewerA}) => {
    await denied(setDoc(stateRef(viewerA.db, wsA, users.viewerA.uid, createId), deleted()), 'viewer cria com deleted');
    const ref = stateRef(viewerA.db, wsA, users.viewerA.uid, updateId);
    await setDoc(ref, read());
    await denied(updateDoc(ref, {deleted: true, deletedAt: serverTimestamp()}), 'viewer adiciona deleted em estado existente');
    await denied(setDoc(ref, {deleted: true, deletedAt: serverTimestamp()}, {merge: true}), 'viewer adiciona deleted por merge');
  });
  assert.equal((await adminState(wsA, users.viewerA.uid, createId)).exists, false);
  assert.equal((await adminState(wsA, users.viewerA.uid, updateId)).get('deleted'), undefined);
});

// 8–10. Owner, admin e member excluem para si (criação direta e atualização).
for (const name of CAN_DELETE) {
  test(`D-18-NOTIF Rules — ${name} exclui para si (create direto e update de estado existente)`, async () => {
    const createId = await freshEvent();
    const updateId = await freshEvent();
    await withClients([name], async ({[name]: {db}}) => {
      const uid = users[name].uid;
      await setDoc(stateRef(db, wsA, uid, createId), deleted());
      const created = await getDoc(stateRef(db, wsA, uid, createId));
      assert.equal(created.get('deleted'), true);
      assert.ok(created.get('deletedAt') instanceof Timestamp);

      const ref = stateRef(db, wsA, uid, updateId);
      await setDoc(ref, read());
      await updateDoc(ref, {deleted: true, deletedAt: serverTimestamp()});
      const updated = await getDoc(ref);
      assert.equal(updated.get('read'), true, 'a leitura anterior é preservada');
      assert.equal(updated.get('deleted'), true);
      assert.ok(updated.get('deletedAt') instanceof Timestamp);
    });
  });
}

// 11–14. Nenhum papel apaga nem altera o evento compartilhado.
for (const name of ACTIVE_A) {
  test(`D-18-NOTIF Rules — ${name} não apaga nem altera o evento compartilhado`, async () => {
    const id = await freshEvent();
    await withClients([name], async ({[name]: {db}}) => {
      await denied(deleteDoc(eventRef(db, wsA, id)), `${name} deleteDoc no evento`);
      await denied(updateDoc(eventRef(db, wsA, id), {title: 'Alterado'}), `${name} updateDoc no evento`);
      await denied(updateDoc(eventRef(db, wsA, id), {deleted: true}), `${name} marca deleted no evento`);
      await denied(setDoc(eventRef(db, wsA, id), eventDoc(wsA, id, exp())), `${name} setDoc no evento`);
      await denied(setDoc(eventRef(db, wsA, id), {expiresAt: exp()}, {merge: true}), `${name} merge no evento`);
    });
    const persisted = await getAdmin().firestore().doc(`workspaces/${wsA}/notifications/${id}`).get();
    assert.equal(persisted.exists, true);
    assert.equal(persisted.get('title'), `Aviso ${id}`);
    assert.equal(persisted.get('deleted'), undefined);
  });
}

// 15. Usuário A escreve o estado de B (caminho com uid de B).
test('D-18-NOTIF Rules — usuário escreve o estado de outro usuário (caminho com o uid dele): negado', async () => {
  const id = await freshEvent();
  await withClients(['ownerA', 'adminA'], async ({ownerA, adminA}) => {
    await denied(setDoc(stateRef(ownerA.db, wsA, users.memberA.uid, id), deleted()), 'owner exclui pelo member');
    await denied(setDoc(stateRef(adminA.db, wsA, users.viewerA.uid, id), read()), 'admin lê-marca pelo viewer');
    await denied(setDoc(stateRef(adminA.db, wsA, users.ownerA.uid, id), dismissed()), 'admin arquiva pelo owner');
  });
  for (const user of [users.memberA, users.viewerA, users.ownerA]) {
    assert.equal((await adminState(wsA, user.uid, id)).exists, false);
  }
});

// 16. Membro de A escreve estado em workspace B.
test('D-18-NOTIF Rules — membro de A não escreve estado no workspace B', async () => {
  const idB = await freshEvent(wsB);
  await withClients(['memberA'], async ({memberA}) => {
    await denied(setDoc(stateRef(memberA.db, wsB, users.memberA.uid, idB), deleted()), 'member exclui em B');
    await denied(setDoc(stateRef(memberA.db, wsB, users.memberA.uid, idB), read()), 'member marca leitura em B');
    await denied(getDoc(stateRef(memberA.db, wsB, users.memberA.uid, idB)), 'member lê o próprio estado em B');
  });
  assert.equal((await adminState(wsB, users.memberA.uid, idB)).exists, false);
});

// 17. Membro removido.
test('D-18-NOTIF Rules — membro removido não exclui nem marca', async () => {
  const id = await freshEvent();
  await withClients(['removedA'], async ({removedA}) => {
    await denied(setDoc(stateRef(removedA.db, wsA, users.removedA.uid, id), deleted()), 'removido exclui');
    await denied(setDoc(stateRef(removedA.db, wsA, users.removedA.uid, id), read()), 'removido marca leitura');
    await denied(getDocs(query(statesCollection(removedA.db, wsA, users.removedA.uid), limit(10))), 'removido lista');
  });
  assert.equal((await adminState(wsA, users.removedA.uid, id)).exists, false);
});

// 18. Usuário suspenso.
test('D-18-NOTIF Rules — usuário suspenso não exclui, não marca e não lê', async () => {
  const id = await freshEvent();
  await withClients(['suspendedA'], async ({suspendedA}) => {
    await denied(setDoc(stateRef(suspendedA.db, wsA, users.suspendedA.uid, id), deleted()), 'suspenso exclui');
    await denied(setDoc(stateRef(suspendedA.db, wsA, users.suspendedA.uid, id), read()), 'suspenso marca leitura');
    await denied(getDoc(eventRef(suspendedA.db, wsA, id)), 'suspenso lê o evento');
    await denied(getDoc(stateRef(suspendedA.db, wsA, users.suspendedA.uid, id)), 'suspenso lê o próprio estado');
  });
  assert.equal((await adminState(wsA, users.suspendedA.uid, id)).exists, false);
});

// 19. Não autenticado.
test('D-18-NOTIF Rules — cliente não autenticado não exclui nem lê', async () => {
  const id = await freshEvent();
  const app = initializeApp({apiKey: 'rules-test', projectId}, `d18-anon-${Date.now().toString(36)}`);
  try {
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    await denied(setDoc(stateRef(db, wsA, users.memberA.uid, id), deleted()), 'sem auth exclui');
    await denied(getDoc(eventRef(db, wsA, id)), 'sem auth lê o evento');
    await denied(getDoc(stateRef(db, wsA, users.memberA.uid, id)), 'sem auth lê estado');
    await denied(deleteDoc(eventRef(db, wsA, id)), 'sem auth apaga o evento');
  } finally {
    await deleteApp(app);
  }
});

// 20. Workspace arquivado.
test('D-18-NOTIF Rules — workspace arquivado nega criar e atualizar estado, mas o próprio estado segue legível', async () => {
  const createId = await freshEvent(wsArchived);
  const updateId = await freshEvent(wsArchived);
  await seedState(wsArchived, users.memberA.uid, updateId, {...adminMark('read', 'readAt'), expiresAt: adminTs(EXPIRES_MS)});
  await withClients(['memberA'], async ({memberA}) => {
    const uid = users.memberA.uid;
    await denied(setDoc(stateRef(memberA.db, wsArchived, uid, createId), read()), 'cria leitura em arquivado');
    await denied(setDoc(stateRef(memberA.db, wsArchived, uid, createId), deleted()), 'cria exclusão em arquivado');
    await denied(updateDoc(stateRef(memberA.db, wsArchived, uid, updateId), {dismissed: true, dismissedAt: serverTimestamp()}),
      'atualiza (arquiva) em arquivado');
    await denied(updateDoc(stateRef(memberA.db, wsArchived, uid, updateId), {deleted: true, deletedAt: serverTimestamp()}),
      'atualiza (exclui) em arquivado');
    // Leitura do próprio estado continua permitida.
    assert.equal((await getDoc(stateRef(memberA.db, wsArchived, uid, createId))).exists(), false);
    assert.equal((await getDoc(stateRef(memberA.db, wsArchived, uid, updateId))).get('read'), true);
    assert.equal((await getDocs(query(statesCollection(memberA.db, wsArchived, uid), limit(10)))).size >= 1, true);
  });
  assert.equal((await adminState(wsArchived, users.memberA.uid, createId)).exists, false);
  assert.equal((await adminState(wsArchived, users.memberA.uid, updateId)).get('dismissed'), undefined);
});

// 21. expiresAt diferente do evento.
test('D-18-NOTIF Rules — expiresAt diferente do evento é negado (+1 s e muito no futuro)', async () => {
  const id = await freshEvent();
  await withClients(['memberA'], async ({memberA}) => {
    const ref = stateRef(memberA.db, wsA, users.memberA.uid, id);
    const stamp = () => ({read: true, readAt: serverTimestamp()});
    await denied(setDoc(ref, {...stamp(), expiresAt: Timestamp.fromMillis(EXPIRES_MS + 1000)}), 'expiresAt +1 s');
    await denied(setDoc(ref, {...stamp(), expiresAt: Timestamp.fromMillis(EXPIRES_MS - 1000)}), 'expiresAt -1 s');
    await denied(setDoc(ref, {...stamp(), expiresAt: Timestamp.fromMillis(EXPIRES_MS + 3650 * DAY_MS)}), 'expiresAt +10 anos');
    await denied(setDoc(ref, {...deleted(), expiresAt: Timestamp.fromMillis(EXPIRES_MS + 1000)}), 'exclusão com expiresAt +1 s');
  });
  assert.equal((await adminState(wsA, users.memberA.uid, id)).exists, false);
});

// 22. Sem expiresAt ou com tipo errado.
test('D-18-NOTIF Rules — sem expiresAt, ou com string ISO ou número, é negado', async () => {
  const id = await freshEvent();
  await withClients(['memberA'], async ({memberA}) => {
    const ref = stateRef(memberA.db, wsA, users.memberA.uid, id);
    const base = {read: true, readAt: serverTimestamp()};
    await denied(setDoc(ref, base), 'sem expiresAt');
    await denied(setDoc(ref, {...base, expiresAt: new Date(EXPIRES_MS).toISOString()}), 'expiresAt string ISO');
    await denied(setDoc(ref, {...base, expiresAt: EXPIRES_MS}), 'expiresAt número');
    await denied(setDoc(ref, {...base, expiresAt: null}), 'expiresAt nulo');
    await denied(setDoc(ref, {...deleted(), expiresAt: EXPIRES_MS}), 'exclusão com expiresAt número');
  });
  assert.equal((await adminState(wsA, users.memberA.uid, id)).exists, false);
});

// 23. Atualizar alterando expiresAt.
test('D-18-NOTIF Rules — atualizar alterando expiresAt é negado', async () => {
  const id = await freshEvent();
  await withClients(['memberA'], async ({memberA}) => {
    const ref = stateRef(memberA.db, wsA, users.memberA.uid, id);
    await setDoc(ref, read());
    await denied(updateDoc(ref, {expiresAt: Timestamp.fromMillis(EXPIRES_MS + 1000)}), 'só prorroga expiresAt');
    await denied(updateDoc(ref, {dismissed: true, dismissedAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(EXPIRES_MS + 1000)}),
      'arquiva e prorroga');
    await denied(updateDoc(ref, {deleted: true, deletedAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(EXPIRES_MS - 1000)}),
      'exclui e encurta');
    await denied(updateDoc(ref, {expiresAt: deleteField()}), 'remove expiresAt');
  });
  assert.deepEqual((await adminState(wsA, users.memberA.uid, id)).get('expiresAt'), adminTs(EXPIRES_MS));
});

// 24. Remover deleted ou deletedAt.
test('D-18-NOTIF Rules — remover deleted/deletedAt ou desmarcar é negado', async () => {
  const id = await freshEvent();
  await withClients(['memberA'], async ({memberA}) => {
    const ref = stateRef(memberA.db, wsA, users.memberA.uid, id);
    await setDoc(ref, deleted());
    await denied(updateDoc(ref, {deleted: deleteField(), deletedAt: deleteField()}), 'remove os dois campos');
    await denied(updateDoc(ref, {deleted: deleteField()}), 'remove deleted');
    await denied(updateDoc(ref, {deletedAt: deleteField()}), 'remove deletedAt');
    await denied(updateDoc(ref, {deleted: false}), 'deleted false');
    await denied(updateDoc(ref, {deleted: false, deletedAt: serverTimestamp()}), 'deleted false com carimbo');
    await denied(setDoc(ref, read()), 'regrava o estado sem a exclusão');
  });
  const state = await adminState(wsA, users.memberA.uid, id);
  assert.equal(state.get('deleted'), true);
  assert.ok(state.get('deletedAt'));
});

// 25. deletedAt arbitrário.
test('D-18-NOTIF Rules — deletedAt escolhido pelo cliente (não serverTimestamp) é negado', async () => {
  const createId = await freshEvent();
  const updateId = await freshEvent();
  await withClients(['memberA'], async ({memberA}) => {
    const fixed = Timestamp.fromDate(new Date('2026-01-01T00:00:00.000Z'));
    await denied(setDoc(stateRef(memberA.db, wsA, users.memberA.uid, createId), {deleted: true, deletedAt: fixed, expiresAt: exp()}),
      'create com deletedAt fixo');
    await denied(setDoc(stateRef(memberA.db, wsA, users.memberA.uid, createId),
      {deleted: true, deletedAt: Timestamp.fromMillis(Date.now()), expiresAt: exp()}), 'create com deletedAt "agora" do cliente');
    const ref = stateRef(memberA.db, wsA, users.memberA.uid, updateId);
    await setDoc(ref, read());
    await denied(updateDoc(ref, {deleted: true, deletedAt: fixed}), 'update com deletedAt fixo');
    await denied(updateDoc(ref, {deleted: true, deletedAt: '2026-10-08T00:00:00.000Z'}), 'update com deletedAt em texto');
  });
  assert.equal((await adminState(wsA, users.memberA.uid, createId)).exists, false);
  assert.equal((await adminState(wsA, users.memberA.uid, updateId)).get('deleted'), undefined);
});

// 26. deleteDoc no documento de estado.
test('D-18-NOTIF Rules — o dono não apaga o próprio documento de estado', async () => {
  const id = await freshEvent();
  await withClients(['ownerA', 'memberA'], async ({ownerA, memberA}) => {
    await setDoc(stateRef(ownerA.db, wsA, users.ownerA.uid, id), deleted());
    await denied(deleteDoc(stateRef(ownerA.db, wsA, users.ownerA.uid, id)), 'owner apaga o estado com exclusão');
    await denied(deleteDoc(stateRef(memberA.db, wsA, users.memberA.uid, id)), 'member apaga estado inexistente');
    await denied(deleteDoc(stateRef(memberA.db, wsA, users.ownerA.uid, id)), 'member apaga o estado do owner');
  });
  assert.equal((await adminState(wsA, users.ownerA.uid, id)).get('deleted'), true);
});

// 27. Ler estado de outro usuário.
test('D-18-NOTIF Rules — ler (get/list) o estado de outro usuário é negado', async () => {
  const id = await freshEvent();
  await seedState(wsA, users.ownerA.uid, id, {...adminMark('read', 'readAt'), expiresAt: adminTs(EXPIRES_MS)});
  await withClients(['adminA', 'memberA', 'viewerA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      await denied(getDoc(stateRef(db, wsA, users.ownerA.uid, id)), `${name} lê o estado do owner`);
      await denied(getDocs(query(statesCollection(db, wsA, users.ownerA.uid), limit(10))), `${name} lista o estado do owner`);
    }
  });
});

// 28. Tetos de listagem.
test('D-18-NOTIF Rules — listagem do próprio estado e dos eventos exige limit ≤ 50', async () => {
  await withClients(['memberA'], async ({memberA}) => {
    const own = statesCollection(memberA.db, wsA, users.memberA.uid);
    await denied(getDocs(own), 'lista o próprio estado sem limit');
    await denied(getDocs(query(own, limit(LIST_CAP + 1))), 'lista o próprio estado com limit 51');
    await getDocs(query(own, limit(LIST_CAP)));
    const events = collection(memberA.db, 'workspaces', wsA, 'notifications');
    await denied(getDocs(events), 'lista eventos sem limit');
    await denied(getDocs(query(events, limit(LIST_CAP + 1))), 'lista eventos com limit 51');
    assert.ok((await getDocs(query(events, limit(LIST_CAP)))).size > 0);
  });
});

// 29. Catch-all e documento intermediário.
test('D-18-NOTIF Rules — documento intermediário e subcoleção arbitrária continuam fechados', async () => {
  await withClients(['memberA', 'ownerA'], async ({memberA, ownerA}) => {
    const own = users.memberA.uid;
    const parent = doc(memberA.db, `workspaces/${wsA}/notification_user_states/${own}`);
    await denied(getDoc(parent), 'lê o documento intermediário do próprio uid');
    await denied(getDoc(doc(ownerA.db, `workspaces/${wsA}/notification_user_states/${own}`)), 'owner lê o intermediário do member');
    await denied(setDoc(parent, {deleted: true}), 'grava o documento intermediário');
    await denied(updateDoc(parent, {deleted: true}), 'atualiza o documento intermediário');
    await denied(deleteDoc(parent), 'apaga o documento intermediário');
    await denied(getDocs(query(collection(memberA.db, 'workspaces', wsA, 'notification_user_states'), limit(10))), 'lista os donos');

    const arbitrary = doc(memberA.db, `workspaces/${wsA}/notification_user_states/${own}/outra/x`);
    await denied(getDoc(arbitrary), 'lê subcoleção arbitrária');
    await denied(setDoc(arbitrary, {read: true, readAt: serverTimestamp(), expiresAt: exp()}), 'grava subcoleção arbitrária');
    await denied(getDocs(query(collection(memberA.db, `workspaces/${wsA}/notification_user_states/${own}/outra`), limit(10))),
      'lista subcoleção arbitrária');
    const foreign = doc(ownerA.db, `workspaces/${wsA}/notification_user_states/${own}/outra/x`);
    await denied(getDoc(foreign), 'owner lê subcoleção arbitrária do member');
    await denied(setDoc(foreign, {anything: true}), 'owner grava subcoleção arbitrária do member');
    await denied(getDocs(query(collectionGroup(ownerA.db, 'notification_entries'), limit(10))), 'collection group sem filtro de dono');
    await denied(getDocs(query(collectionGroup(memberA.db, 'notification_entries'), limit(10))), 'collection group pelo próprio dono');
  });
});

// 30. Subcoleção antiga items.
test('D-18-NOTIF Rules — a subcoleção antiga items está fechada para leitura e escrita', async () => {
  const id = await freshEvent();
  await withClients(['memberA', 'ownerA'], async ({memberA, ownerA}) => {
    const legacy = doc(memberA.db, `workspaces/${wsA}/notification_user_states/${users.memberA.uid}/items/${id}`);
    await denied(getDoc(legacy), 'lê items');
    await denied(setDoc(legacy, read()), 'grava items (formato novo)');
    await denied(setDoc(legacy, {read: true, readAt: serverTimestamp()}), 'grava items (formato antigo)');
    await denied(setDoc(legacy, deleted()), 'exclui para si em items');
    await denied(updateDoc(legacy, {read: true}), 'atualiza items');
    await denied(deleteDoc(legacy), 'apaga items');
    await denied(getDocs(query(collection(memberA.db, `workspaces/${wsA}/notification_user_states/${users.memberA.uid}/items`), limit(10))),
      'lista items');
    await denied(getDocs(query(collectionGroup(ownerA.db, 'items'), limit(10))), 'collection group items');
  });
  assert.equal(
    (await getAdmin().firestore().doc(`workspaces/${wsA}/notification_user_states/${users.memberA.uid}/items/${id}`).get()).exists,
    false,
  );
});

// 31. Evento expirado.
test('D-18-NOTIF Rules — estado de evento expirado não é criado e estado expirado não é atualizado', async () => {
  const expiredId = await freshEvent(wsA, PAST_MS);
  const updateId = await freshEvent();
  const expiredTs = Timestamp.fromMillis(PAST_MS);
  // Estado já expirado semeado pelo backend (cópia do prazo do evento).
  await seedState(wsA, users.memberA.uid, updateId, {
    ...adminMark('read', 'readAt'), expiresAt: adminTs(PAST_MS),
  });
  await withClients(['memberA'], async ({memberA}) => {
    const uid = users.memberA.uid;
    await denied(setDoc(stateRef(memberA.db, wsA, uid, 'ev-expired'), {read: true, readAt: serverTimestamp(), expiresAt: expiredTs}),
      'cria leitura para o evento expirado semeado');
    await denied(setDoc(stateRef(memberA.db, wsA, uid, expiredId), {read: true, readAt: serverTimestamp(), expiresAt: expiredTs}),
      'cria leitura copiando o prazo vencido');
    await denied(setDoc(stateRef(memberA.db, wsA, uid, expiredId), {deleted: true, deletedAt: serverTimestamp(), expiresAt: expiredTs}),
      'cria exclusão copiando o prazo vencido');
    await denied(setDoc(stateRef(memberA.db, wsA, uid, expiredId), read()), 'cria com prazo diferente do evento vencido');
    await denied(updateDoc(stateRef(memberA.db, wsA, uid, updateId), {dismissed: true, dismissedAt: serverTimestamp()}),
      'arquiva estado cujo expiresAt já passou');
    await denied(updateDoc(stateRef(memberA.db, wsA, uid, updateId), {deleted: true, deletedAt: serverTimestamp()}),
      'exclui estado cujo expiresAt já passou');
  });
  assert.equal((await adminState(wsA, users.memberA.uid, 'ev-expired')).exists, false);
  assert.equal((await adminState(wsA, users.memberA.uid, expiredId)).exists, false);
  assert.equal((await adminState(wsA, users.memberA.uid, updateId)).get('dismissed'), undefined);
});

// 32. Viewer com read e deleted juntos.
test('D-18-NOTIF Rules — viewer com read e deleted (ou dismissed e deleted) no mesmo payload é negado', async () => {
  const id = await freshEvent();
  await withClients(['viewerA'], async ({viewerA}) => {
    const ref = stateRef(viewerA.db, wsA, users.viewerA.uid, id);
    await denied(setDoc(ref, {...read(), deleted: true, deletedAt: serverTimestamp()}), 'read + deleted');
    await denied(setDoc(ref, {...dismissed(), deleted: true, deletedAt: serverTimestamp()}), 'dismissed + deleted');
    await denied(setDoc(ref, {...read(), ...dismissed(), deleted: true, deletedAt: serverTimestamp()}), 'tudo junto');
  });
  assert.equal((await adminState(wsA, users.viewerA.uid, id)).exists, false);
});

// 33. Marca deleted pré-existente de quem virou viewer: mantida sim, alterada/removida não.
test('D-18-NOTIF Rules — viewer com deleted já gravado: adicionar read mantendo deleted é PERMITIDO; alterar ou remover deleted é NEGADO', async () => {
  const keepId = await freshEvent();
  const alterId = await freshEvent();
  const removeId = await freshEvent();
  const originalMs = Date.now() - 60_000;
  for (const id of [keepId, alterId, removeId]) {
    await seedState(wsA, users.viewerA.uid, id, {...adminMark('deleted', 'deletedAt', originalMs), expiresAt: adminTs(EXPIRES_MS)});
  }
  await withClients(['viewerA'], async ({viewerA}) => {
    const uid = users.viewerA.uid;
    // Sentido permitido: marca de leitura nova, deleted/deletedAt intactos.
    await updateDoc(stateRef(viewerA.db, wsA, uid, keepId), {read: true, readAt: serverTimestamp()});
    await updateDoc(stateRef(viewerA.db, wsA, uid, keepId), {dismissed: true, dismissedAt: serverTimestamp()});
    // Sentido negado: alterar o carimbo, desmarcar ou remover.
    await denied(updateDoc(stateRef(viewerA.db, wsA, uid, alterId), {deletedAt: serverTimestamp()}), 'altera deletedAt');
    await denied(updateDoc(stateRef(viewerA.db, wsA, uid, alterId), {read: true, readAt: serverTimestamp(), deletedAt: serverTimestamp()}),
      'adiciona read e altera deletedAt');
    await denied(updateDoc(stateRef(viewerA.db, wsA, uid, removeId), {deleted: deleteField(), deletedAt: deleteField()}), 'remove deleted');
    await denied(updateDoc(stateRef(viewerA.db, wsA, uid, removeId), {deleted: false}), 'deleted false');
    await denied(updateDoc(stateRef(viewerA.db, wsA, uid, removeId),
      {read: true, readAt: serverTimestamp(), deleted: deleteField(), deletedAt: deleteField()}), 'adiciona read e remove deleted');
    await denied(setDoc(stateRef(viewerA.db, wsA, uid, removeId), read()), 'regrava o estado sem a exclusão');
  });
  const kept = await adminState(wsA, users.viewerA.uid, keepId);
  assert.equal(kept.get('read'), true);
  assert.equal(kept.get('dismissed'), true);
  assert.equal(kept.get('deleted'), true);
  assert.equal(kept.get('deletedAt').toMillis(), originalMs, 'carimbo original da exclusão preservado');
  for (const id of [alterId, removeId]) {
    const state = await adminState(wsA, users.viewerA.uid, id);
    assert.equal(state.get('deleted'), true);
    assert.equal(state.get('deletedAt').toMillis(), originalMs);
    assert.equal(state.get('read'), undefined);
  }
});

// 34. expiresAt copiado exatamente do evento.
test('D-18-NOTIF Rules — expiresAt copiado exatamente do evento é permitido (todos os papéis ativos)', async () => {
  await withClients(ACTIVE_A, async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const id = await freshEvent();
      const ref = stateRef(db, wsA, users[name].uid, id);
      const source = await getDoc(eventRef(db, wsA, id));
      await setDoc(ref, {read: true, readAt: serverTimestamp(), expiresAt: source.get('expiresAt')});
      assert.deepEqual((await getDoc(ref)).get('expiresAt'), source.get('expiresAt'), `${name} grava o prazo do evento`);
    }
  });
});

// 35. Idempotência.
test('D-18-NOTIF Rules — segunda escrita igual (mesma marca) não muda nada: negada, carimbo original preservado', async () => {
  const id = await freshEvent();
  let firstStamp;
  await withClients(['memberA'], async ({memberA}) => {
    const ref = stateRef(memberA.db, wsA, users.memberA.uid, id);
    await setDoc(ref, read());
    firstStamp = (await adminState(wsA, users.memberA.uid, id)).get('readAt');
    await denied(updateDoc(ref, {read: true}), 'repete a mesma marca sem carimbo (nada muda)');
    await denied(setDoc(ref, {read: true, expiresAt: exp()}, {merge: true}), 'merge sem mudança');
    await denied(updateDoc(ref, {read: true, readAt: serverTimestamp()}), 'repete a marca com novo carimbo');
    await denied(setDoc(ref, read()), 'repete o setDoc inteiro (novo carimbo)');
    await denied(setDoc(ref, read(), {merge: true}), 'repete o merge inteiro (novo carimbo)');
  });
  const after = await adminState(wsA, users.memberA.uid, id);
  assert.deepEqual(after.get('readAt'), firstStamp, 'carimbo da primeira marca preservado');
  assert.deepEqual(Object.keys(after.data()).sort(), ['expiresAt', 'read', 'readAt']);
});

// Extras.
test('D-18-NOTIF Rules — campo extra, estado sem marca, evento inexistente e evento sem expiresAt são negados', async () => {
  const id = await freshEvent();
  await withClients(['memberA', 'ownerA'], async ({memberA, ownerA}) => {
    const uid = users.memberA.uid;
    const ref = stateRef(memberA.db, wsA, uid, id);
    await denied(setDoc(ref, {...read(), foo: 'bar'}), 'campo extra na criação');
    await denied(setDoc(ref, {...deleted(), uid}), 'uid no estado');
    await denied(setDoc(ref, {expiresAt: exp()}), 'sem nenhuma marca');
    await denied(setDoc(ref, {}), 'estado vazio');
    await denied(setDoc(ref, {deleted: true, expiresAt: exp()}), 'deleted sem carimbo');
    await denied(setDoc(ref, {deletedAt: serverTimestamp(), expiresAt: exp()}), 'carimbo sem deleted');
    await denied(setDoc(ref, {deleted: false, deletedAt: serverTimestamp(), expiresAt: exp()}), 'deleted false na criação');
    await denied(setDoc(ref, {deleted: 'true', deletedAt: serverTimestamp(), expiresAt: exp()}), 'deleted não booleano');
    await setDoc(ref, read());
    await denied(updateDoc(ref, {foo: 'bar'}), 'campo extra na atualização');
    await denied(updateDoc(ref, {deleted: true, deletedAt: serverTimestamp(), foo: 1}), 'exclui com campo extra');
    await denied(setDoc(stateRef(memberA.db, wsA, uid, 'nao-existe'), deleted()), 'exclui para evento inexistente');
    await denied(setDoc(stateRef(memberA.db, wsA, uid, 'nao-existe'), read()), 'lê-marca evento inexistente');
    await denied(setDoc(stateRef(ownerA.db, wsA, users.ownerA.uid, 'ev-no-expires'), {...read()}), 'evento sem expiresAt (lida)');
    await denied(setDoc(stateRef(ownerA.db, wsA, users.ownerA.uid, 'ev-no-expires'), deleted()), 'evento sem expiresAt (excluída)');
    await denied(setDoc(stateRef(ownerA.db, wsA, users.ownerA.uid, 'ev-no-expires'), {read: true, readAt: serverTimestamp()}),
      'evento sem expiresAt e estado sem expiresAt');
  });
  assert.deepEqual(Object.keys((await adminState(wsA, users.memberA.uid, id)).data()).sort(), ['expiresAt', 'read', 'readAt']);
  assert.equal((await adminState(wsA, users.memberA.uid, 'nao-existe')).exists, false);
  assert.equal((await adminState(wsA, users.ownerA.uid, 'ev-no-expires')).exists, false);
});

// Medição do custo de acesso por lote (teto de 20 acessos por commit).
test('D-18-NOTIF Rules — medição: criações por writeBatch antes da recusa por limite de acessos', async () => {
  const sizes = [10, 12, 14, 15, 16];
  const result = {read: {}, deleted: {}, updates: {}};
  await withClients(['ownerA'], async ({ownerA}) => {
    const uid = users.ownerA.uid;
    for (const kind of ['read', 'deleted']) {
      for (const size of sizes) {
        const ids = [];
        for (let index = 0; index < size; index += 1) ids.push(await freshEvent());
        const batch = writeBatch(ownerA.db);
        for (const id of ids) batch.set(stateRef(ownerA.db, wsA, uid, id), kind === 'read' ? read() : deleted());
        try {
          await batch.commit();
          result[kind][size] = 'ok';
        } catch (error) {
          result[kind][size] = String(error?.code);
          assert.match(String(error?.code), /permission-denied/, `lote ${kind}/${size} só pode falhar por Rules`);
        }
      }
    }
    // Atualizações (sem `get` do evento): lote de 10 sobre estados já criados.
    const ids = [];
    for (let index = 0; index < 10; index += 1) ids.push(await freshEvent());
    for (const id of ids) await setDoc(stateRef(ownerA.db, wsA, uid, id), read());
    const batch = writeBatch(ownerA.db);
    for (const id of ids) batch.update(stateRef(ownerA.db, wsA, uid, id), {deleted: true, deletedAt: serverTimestamp()});
    await batch.commit();
    result.updates[10] = 'ok';
  });
  console.log(`MEDICAO_LOTE ${JSON.stringify(result)}`);
  // O lote do cliente (10 criações) precisa caber, com leitura e com exclusão.
  assert.equal(result.read[10], 'ok');
  assert.equal(result.deleted[10], 'ok');
  // Orçamento medido: 5 acessos fixos + 1 por criação (teto de 20). Com o
  // `hasRole` da exclusão no mesmo cache, 15 criações cabem e 16 não.
  for (const kind of ['read', 'deleted']) {
    assert.equal(result[kind][15], 'ok', `${kind}: 15 criações cabem`);
    assert.equal(result[kind][16], 'permission-denied', `${kind}: 16 criações passam do teto`);
  }
});
