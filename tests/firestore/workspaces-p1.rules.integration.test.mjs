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
} from 'firebase/firestore';

/**
 * P1 — Rules de conta, workspace, membership, convites, auditoria e índice.
 *
 * Segunda camada independente: avalia as Rules como se o backend não
 * existisse. O cliente não escreve em nenhum documento de autorização; lê só
 * o que o membership ativo (com conta ativa) permite; listagens têm teto.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules de P1.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-password-123456';

const user = (uid) => ({uid, email: `${uid}@example.test`});
const users = {
  ownerA: user('p1-owner-a'),
  adminA: user('p1-admin-a'),
  memberA: user('p1-member-a'),
  viewerA: user('p1-viewer-a'),
  removedA: user('p1-removed-a'),
  suspendedA: user('p1-suspended-a'),
  noProfileA: user('p1-noprofile-a'),
  ownerB: user('p1-owner-b'),
  outsider: user('p1-outsider'),
};
const wsA = 'p1-rules-ws-a';
const wsB = 'p1-rules-ws-b';
const wsArchived = 'p1-rules-ws-archived';

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

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
    if (entry !== users.noProfileA) {
      await db.doc(`users/${entry.uid}`).set({
        uid: entry.uid,
        status: entry === users.suspendedA ? 'suspended' : 'active',
      });
    }
  }
  const workspaces = [
    [wsA, users.ownerA, 'active'],
    [wsB, users.ownerB, 'active'],
    [wsArchived, users.ownerA, 'archived'],
  ];
  for (const [workspaceId, owner, status] of workspaces) {
    await db.recursiveDelete(db.doc(`workspaces/${workspaceId}`));
    await db.doc(`workspaces/${workspaceId}`).set({
      name: workspaceId, type: 'PJ', ownerId: owner.uid, status, currency: 'BRL',
    });
  }
  const memberships = [
    [wsA, users.ownerA, 'owner', 'active'],
    [wsA, users.adminA, 'admin', 'active'],
    [wsA, users.memberA, 'member', 'active'],
    [wsA, users.viewerA, 'viewer', 'active'],
    [wsA, users.removedA, 'member', 'removed'],
    [wsA, users.suspendedA, 'owner', 'active'],
    [wsA, users.noProfileA, 'admin', 'active'],
    [wsB, users.ownerB, 'owner', 'active'],
    [wsArchived, users.ownerA, 'owner', 'active'],
  ];
  for (const [workspaceId, member, role, status] of memberships) {
    await db.doc(`workspaces/${workspaceId}/members/${member.uid}`).set({
      uid: member.uid, role, status, email: member.email,
    });
    await db.doc(`users/${member.uid}/workspaces/${workspaceId}`).set({
      workspaceId, status, name: workspaceId, type: 'PJ', workspaceStatus: 'active',
    });
  }
  for (const workspaceId of [wsA, wsB, wsArchived]) {
    await db.doc(`workspaces/${workspaceId}/invites/invite-1`).set({
      inviteId: 'invite-1', emailNormalized: 'x@y.test', role: 'member', status: 'pending',
    });
    await db.doc(`workspaces/${workspaceId}/membership_events/event-1`).set({
      operation: 'workspace.created', actorId: 'system',
    });
    await db.doc(`workspaces/${workspaceId}/transactions/tx-1`).set({
      workspaceId, type: 'despesa', description: 'Semente', value: 10,
      userId: users.ownerA.uid,
    });
  }
  await db.doc('invite_tokens/abc').set({workspaceId: wsA, inviteId: 'invite-1'});
  await db.doc('platform_audit_events/evt').set({operation: 'account.suspended'});
  await db.doc(`users/${users.ownerA.uid}/idempotency_keys/k1`).set({status: 'completed'});
  await db.doc(`users/${users.ownerA.uid}/rate_limits/r1`).set({count: 1});
};

const clients = [];
const signIn = async (entry) => {
  const app = initializeApp({
    apiKey: 'demo-api-key',
    authDomain: `${projectId}.firebaseapp.com`,
    projectId,
  }, `p1-${entry?.uid ?? 'anon'}-${clients.length}`);
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  const db = getFirestore(app);
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
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

const allowed = async (promise, label) => {
  try {
    return await promise;
  } catch (error) {
    assert.fail(`${label}: ${error?.code ?? error}`);
  }
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

test('workspace: leitura só por membership ativo com conta ativa', async () => {
  for (const name of ['ownerA', 'adminA', 'memberA', 'viewerA']) {
    await allowed(getDoc(doc(db[name], `workspaces/${wsA}`)), name);
  }
  for (const name of ['removedA', 'suspendedA', 'noProfileA', 'outsider', 'ownerB', 'anon']) {
    await denied(getDoc(doc(db[name], `workspaces/${wsA}`)), name);
  }
  await denied(getDoc(doc(db.ownerA, `workspaces/${wsB}`)), 'A lê B');
});

test('workspace: o cliente não cria, edita nem apaga', async () => {
  await denied(setDoc(doc(db.outsider, 'workspaces/p1-client-created'), {
    name: 'X', type: 'PF', ownerId: users.outsider.uid, status: 'active',
  }), 'criar workspace');
  await denied(updateDoc(doc(db.ownerA, `workspaces/${wsA}`), {name: 'Novo'}), 'owner edita');
  await denied(updateDoc(doc(db.adminA, `workspaces/${wsA}`), {ownerId: users.adminA.uid}), 'takeover');
  await denied(deleteDoc(doc(db.ownerA, `workspaces/${wsA}`)), 'apagar');
});

test('members: leitura com teto, escrita sempre negada', async () => {
  await allowed(getDoc(doc(db.removedA, `workspaces/${wsA}/members/${users.removedA.uid}`)),
    'removido lê o próprio membership');
  await denied(getDoc(doc(db.removedA, `workspaces/${wsA}/members/${users.ownerA.uid}`)),
    'removido não lê os demais');
  await allowed(getDocs(query(collection(db.viewerA, `workspaces/${wsA}/members`), limit(200))),
    'viewer lista com teto');
  await denied(getDocs(collection(db.ownerA, `workspaces/${wsA}/members`)), 'lista sem limit');
  await denied(getDocs(query(collection(db.ownerA, `workspaces/${wsA}/members`), limit(201))),
    'lista acima do teto');
  await denied(getDocs(query(collection(db.ownerB, `workspaces/${wsA}/members`), limit(10))),
    'B lista membros de A');
  await denied(getDocs(query(collection(db.suspendedA, `workspaces/${wsA}/members`), limit(10))),
    'suspenso lista');

  await denied(setDoc(doc(db.ownerA, `workspaces/${wsA}/members/intruso`), {
    uid: 'intruso', role: 'member', status: 'active',
  }), 'owner cria membership (fakeUid)');
  await denied(updateDoc(doc(db.adminA, `workspaces/${wsA}/members/${users.adminA.uid}`), {
    role: 'owner',
  }), 'autopromoção');
  await denied(updateDoc(doc(db.ownerA, `workspaces/${wsA}/members/${users.memberA.uid}`), {
    role: 'admin',
  }), 'owner troca papel pelo cliente');
  await denied(updateDoc(doc(db.ownerA, `workspaces/${wsA}/members/${users.ownerA.uid}`), {
    status: 'removed',
  }), 'trancamento do owner (PR-WS-04)');
  await denied(deleteDoc(doc(db.ownerA, `workspaces/${wsA}/members/${users.memberA.uid}`)),
    'hard delete de membership');
  await denied(setDoc(doc(db.ownerB, `workspaces/${wsA}/members/${users.ownerB.uid}`), {
    uid: users.ownerB.uid, role: 'owner', status: 'active',
  }), 'B se insere em A');
});

test('convites e auditoria: leitura por owner/admin, escrita negada', async () => {
  for (const sub of ['invites', 'membership_events']) {
    for (const name of ['ownerA', 'adminA']) {
      await allowed(getDocs(query(collection(db[name], `workspaces/${wsA}/${sub}`), limit(100))),
        `${name} lista ${sub}`);
    }
    for (const name of ['memberA', 'viewerA', 'removedA', 'ownerB', 'suspendedA']) {
      await denied(getDocs(query(collection(db[name], `workspaces/${wsA}/${sub}`), limit(10))),
        `${name} lista ${sub}`);
    }
    await denied(getDocs(collection(db.ownerA, `workspaces/${wsA}/${sub}`)), `${sub} sem limit`);
    await denied(setDoc(doc(db.ownerA, `workspaces/${wsA}/${sub}/client`), {x: 1}),
      `owner grava ${sub}`);
    await denied(deleteDoc(doc(db.ownerA, `workspaces/${wsA}/${sub}/${sub === 'invites' ? 'invite-1' : 'event-1'}`)),
      `owner apaga ${sub}`);
  }
});

test('perfil: só o próprio lê; ninguém grava', async () => {
  await allowed(getDoc(doc(db.ownerA, `users/${users.ownerA.uid}`)), 'lê o próprio');
  await allowed(getDoc(doc(db.suspendedA, `users/${users.suspendedA.uid}`)),
    'suspenso lê o próprio status');
  await denied(getDoc(doc(db.ownerA, `users/${users.ownerB.uid}`)), 'lê o de outro');
  for (const field of [{displayName: 'X'}, {status: 'active'}, {planId: 'pro'}, {isAdmin: true}, {email: 'a@b.c'}]) {
    await denied(updateDoc(doc(db.ownerA, `users/${users.ownerA.uid}`), field),
      `atualiza ${Object.keys(field)[0]}`);
  }
  await denied(updateDoc(doc(db.suspendedA, `users/${users.suspendedA.uid}`), {status: 'active'}),
    'suspenso se reativa');
  await denied(setDoc(doc(db.noProfileA, `users/${users.noProfileA.uid}`), {
    uid: users.noProfileA.uid, status: 'active',
  }), 'cria o próprio perfil');
  await denied(deleteDoc(doc(db.ownerA, `users/${users.ownerA.uid}`)), 'apaga o perfil');
});

test('índice do usuário: leitura própria com teto, escrita negada, sem papel', async () => {
  await allowed(getDoc(doc(db.memberA, `users/${users.memberA.uid}/workspaces/${wsA}`)), 'get');
  await allowed(getDocs(query(collection(db.memberA, `users/${users.memberA.uid}/workspaces`), limit(50))),
    'list com teto');
  await denied(getDocs(collection(db.memberA, `users/${users.memberA.uid}/workspaces`)), 'list sem limit');
  await denied(getDocs(query(collection(db.memberA, `users/${users.memberA.uid}/workspaces`), limit(51))),
    'list acima do teto');
  await denied(getDoc(doc(db.memberA, `users/${users.ownerA.uid}/workspaces/${wsA}`)), 'índice de outro');
  await denied(getDocs(query(collection(db.suspendedA, `users/${users.suspendedA.uid}/workspaces`), limit(10))),
    'suspenso lista o índice');
  await denied(setDoc(doc(db.memberA, `users/${users.memberA.uid}/workspaces/${wsB}`), {
    workspaceId: wsB, status: 'active',
  }), 'entra em B pelo índice');
  await denied(updateDoc(doc(db.memberA, `users/${users.memberA.uid}/workspaces/${wsA}`), {
    role: 'owner',
  }), 'papel no índice');
  await denied(deleteDoc(doc(db.memberA, `users/${users.memberA.uid}/workspaces/${wsA}`)), 'apaga');
});

test('coleções server-only do kernel são inacessíveis', async () => {
  await denied(getDoc(doc(db.ownerA, 'invite_tokens/abc')), 'ponteiro de token');
  await denied(setDoc(doc(db.ownerA, 'invite_tokens/novo'), {workspaceId: wsA}), 'cria ponteiro');
  await denied(getDoc(doc(db.ownerA, 'platform_audit_events/evt')), 'auditoria de plataforma');
  await denied(getDoc(doc(db.ownerA, `users/${users.ownerA.uid}/idempotency_keys/k1`)), 'idempotência');
  await denied(setDoc(doc(db.ownerA, `users/${users.ownerA.uid}/idempotency_keys/k2`), {x: 1}),
    'grava idempotência');
  await denied(getDoc(doc(db.ownerA, `users/${users.ownerA.uid}/rate_limits/r1`)), 'rate limit');
});

test('viewer é somente leitura e conta suspensa não lê nem escreve', async () => {
  await allowed(getDoc(doc(db.viewerA, `workspaces/${wsA}/transactions/tx-1`)), 'viewer lê');
  await denied(updateDoc(doc(db.viewerA, `workspaces/${wsA}/transactions/tx-1`), {
    description: 'Viewer',
  }), 'viewer edita');
  await denied(getDoc(doc(db.suspendedA, `workspaces/${wsA}/transactions/tx-1`)), 'suspenso lê');
  await denied(getDoc(doc(db.noProfileA, `workspaces/${wsA}/transactions/tx-1`)), 'sem perfil lê');
  await denied(getDoc(doc(db.ownerB, `workspaces/${wsA}/transactions/tx-1`)), 'B lê A');
  await denied(getDoc(doc(db.ownerA, `workspaces/${wsB}/transactions/tx-1`)), 'A lê B');
});

test('workspace arquivado: leitura mantida, escrita negada', async () => {
  await allowed(getDoc(doc(db.ownerA, `workspaces/${wsArchived}`)), 'lê o workspace');
  await allowed(getDoc(doc(db.ownerA, `workspaces/${wsArchived}/transactions/tx-1`)), 'lê transação');
  await denied(updateDoc(doc(db.ownerA, `workspaces/${wsArchived}/transactions/tx-1`), {
    voidedAt: new Date().toISOString(),
    voidedBy: users.ownerA.uid,
    voidReason: 'Arquivado',
  }), 'anula transação em arquivado');
  await denied(setDoc(doc(db.ownerA, `workspaces/${wsArchived}/recurring_expenses/r1`), {
    description: 'X',
  }), 'escreve recorrente em arquivado');
  await allowed(setDoc(doc(db.ownerA, `workspaces/${wsA}/recurring_expenses/p1-control`), {
    description: 'X',
  }), 'controle: mesma escrita em workspace ativo');
});
