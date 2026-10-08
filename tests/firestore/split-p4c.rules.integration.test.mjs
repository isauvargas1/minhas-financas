import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {deleteApp, initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {
  addDoc,
  collection,
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
  serverTimestamp,
  setDoc,
  startAfter,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

/**
 * P4-C (D-14, PR-SPLIT-01/02, PR-RULES-01) — Rules da Divisão de contas
 * contra o Emulator.
 *
 * - Nenhum papel escreve em `split_groups`, `split_participants`,
 *   `split_invites`, `split_bills`, `split_shares`, `split_reimbursements`
 *   ou `split_events`: dono, papel, estado, valores, rateios, quitação,
 *   reembolso e vínculo financeiro só mudam pelas callables (Admin SDK).
 * - Leitura de qualquer membro ativo (viewer incluído), nas consultas exatas
 *   de `src/modules/split-bills/api.ts`, com teto de listagem; convite só
 *   para owner/admin ou para quem o criou; trilha só para owner/admin.
 * - Nada atravessa o workspace; membro removido não lê.
 * - `transactions`: o cliente não forja `splitEntry`, não grava o formato
 *   `parcelado` (cartão/parcelas) que o Split antigo usava e não altera o
 *   espelho financeiro gravado pela Divisão.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da P4-C.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-p4c-123456';

const users = {
  ownerA: {uid: 'p4c-owner-a', email: 'p4c-owner-a@example.test'},
  adminA: {uid: 'p4c-admin-a', email: 'p4c-admin-a@example.test'},
  memberA: {uid: 'p4c-member-a', email: 'p4c-member-a@example.test'},
  member2A: {uid: 'p4c-member2-a', email: 'p4c-member2-a@example.test'},
  viewerA: {uid: 'p4c-viewer-a', email: 'p4c-viewer-a@example.test'},
  removedA: {uid: 'p4c-removed-a', email: 'p4c-removed-a@example.test'},
  ownerB: {uid: 'p4c-owner-b', email: 'p4c-owner-b@example.test'},
};
const wsA = 'p4c-workspace-a';
const wsB = 'p4c-workspace-b';
const GROUP = 'sgrp_main';
const ARCHIVED = 'sgrp_archived';
const BILL = 'sbill_main';
const SHARE_MEMBER = 'sshr_member';
const SHARE_EXTERNAL = 'sshr_external';
const REIMB = 'sreimb_main';
const INVITE_ADMIN = 'sinv_admin';
const INVITE_MEMBER = 'sinv_member';
const EVENT = 'split_bill_created_1';
const MIRROR = 'scash_main';

const COLLECTIONS = [
  'split_groups', 'split_participants', 'split_invites', 'split_bills', 'split_shares',
  'split_reimbursements', 'split_events',
];
const existingId = {
  split_groups: GROUP,
  split_participants: 'spart_owner',
  split_invites: INVITE_ADMIN,
  split_bills: BILL,
  split_shares: SHARE_MEMBER,
  split_reimbursements: REIMB,
  split_events: EVENT,
};

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const ts = (iso = '2026-10-05T12:00:00.000Z') => getAdmin().firestore.Timestamp.fromDate(new Date(iso));
const FUTURE = '2099-01-01T00:00:00.000Z';

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
    await db.doc(`users/${user.uid}`).set({uid: user.uid, status: 'active'});
  }
  await Promise.all([wsA, wsB].map((ws) => db.recursiveDelete(db.doc(`workspaces/${ws}`))));
  await Promise.all([
    db.doc(`workspaces/${wsA}`).set({ownerId: users.ownerA.uid, type: 'PJ', name: 'A', currency: 'BRL', status: 'active'}),
    db.doc(`workspaces/${wsB}`).set({ownerId: users.ownerB.uid, type: 'PF', name: 'B', currency: 'BRL', status: 'active'}),
  ]);
  const members = [
    [wsA, users.ownerA, 'owner', 'active'], [wsA, users.adminA, 'admin', 'active'],
    [wsA, users.memberA, 'member', 'active'], [wsA, users.member2A, 'member', 'active'],
    [wsA, users.viewerA, 'viewer', 'active'], [wsA, users.removedA, 'member', 'removed'],
    [wsB, users.ownerB, 'owner', 'active'],
  ];
  await Promise.all(members.map(([ws, user, role, status]) =>
    db.doc(`workspaces/${ws}/members/${user.uid}`).set({uid: user.uid, role, status})));
  for (const ws of [wsA, wsB]) {
    const base = `workspaces/${ws}`;
    const owner = ws === wsA ? users.ownerA.uid : users.ownerB.uid;
    const batch = db.batch();
    const group = (id, status, createdAt) => ({
      id, schemaVersion: 1, workspaceId: ws, name: `Grupo ${id}`, description: null, businessMode: 'split',
      status, ownerUserId: owner, ownerParticipantId: 'spart_owner', currency: 'BRL',
      counters: {participantCount: 3, activeParticipantCount: 3, billCount: 1, openBillCount: 1, openShareCount: 2,
        reimbursementCount: 1, openReimbursementCount: 1},
      totals: {billedCents: 9_000, openCents: 6_000, settledCents: 0, forgivenCents: 0,
        reimbursementRequestedCents: 2_500, reimbursementApprovedCents: 0, reimbursementPaidCents: 0},
      categoryTotals: {Restaurantes: 9_000}, createdBy: owner, updatedBy: owner, revision: 1,
      createdAt: ts(createdAt), updatedAt: ts(createdAt),
    });
    batch.set(db.doc(`${base}/split_groups/${GROUP}`), group(GROUP, 'active', '2026-10-01T12:00:00.000Z'));
    batch.set(db.doc(`${base}/split_groups/${ARCHIVED}`), group(ARCHIVED, 'archived', '2026-09-01T12:00:00.000Z'));
    for (const [id, kind, userId, role] of [
      ['spart_owner', 'workspace_member', owner, 'owner'],
      ['spart_member', 'workspace_member', users.memberA.uid, 'participant'],
      ['spart_external', 'external', null, 'participant'],
    ]) {
      batch.set(db.doc(`${base}/split_participants/${id}`), {
        id, schemaVersion: 1, workspaceId: ws, groupId: GROUP, kind, userId, role, status: 'active',
        displayName: kind === 'external' ? 'Fulana Externa' : null,
        balance: {owedCents: 3_000, receivableCents: 0}, createdAt: ts(), updatedAt: ts(),
      });
    }
    for (const [id, createdBy] of [[INVITE_ADMIN, users.adminA.uid], [INVITE_MEMBER, users.memberA.uid]]) {
      batch.set(db.doc(`${base}/split_invites/${id}`), {
        id, schemaVersion: 1, workspaceId: ws, groupId: GROUP, role: 'participant', status: 'pending',
        codeHint: 'X2Z', createdBy, expiresAt: ts(FUTURE), createdAt: ts(), updatedAt: ts(),
      });
    }
    batch.set(db.doc(`${base}/split_bills/${BILL}`), {
      id: BILL, schemaVersion: 1, workspaceId: ws, groupId: GROUP, description: 'Jantar', category: 'Restaurantes',
      categoryBucket: 'Restaurantes', amountCents: 9_000, currency: 'BRL', expenseDate: '2026-10-04',
      payerParticipantId: 'spart_owner', method: 'equal', status: 'open', financialIntegration: 'cash',
      cashAccountId: 'acc_main', cashTransactionId: MIRROR, cardId: null, cardPurchaseId: null,
      createdBy: owner, updatedBy: owner, revision: 1, createdAt: ts(), updatedAt: ts(),
    });
    for (const [id, participantId] of [[SHARE_MEMBER, 'spart_member'], [SHARE_EXTERNAL, 'spart_external']]) {
      batch.set(db.doc(`${base}/split_shares/${id}`), {
        id, schemaVersion: 1, workspaceId: ws, groupId: GROUP, billId: BILL, participantId,
        debtorParticipantId: participantId, creditorParticipantId: 'spart_owner', amountCents: 3_000,
        status: 'open', settledAt: null, settledBy: null, forgivenAt: null, forgivenBy: null, forgiveReason: null,
        revision: 1, createdAt: ts(), updatedAt: ts(),
      });
    }
    batch.set(db.doc(`${base}/split_reimbursements/${REIMB}`), {
      id: REIMB, schemaVersion: 1, workspaceId: ws, groupId: GROUP, requesterParticipantId: 'spart_member',
      requesterUserId: users.memberA.uid, description: 'Táxi', category: 'Transporte', amountCents: 2_500,
      currency: 'BRL', expenseDate: '2026-10-03', status: 'requested', paymentSequence: 0, cashTransactionId: null,
      cashAccountId: null, paymentDate: null, revision: 1, createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`${base}/split_events/${EVENT}`), {
      id: EVENT, schemaVersion: 1, workspaceId: ws, groupId: GROUP, operation: 'split.bill_created', billId: BILL,
      actorId: owner, occurredAt: ts(),
    });
    batch.set(db.doc(`${base}/transactions/${MIRROR}`), {
      type: 'despesa', description: 'Divisão de contas', category: 'Restaurantes', value: 90, valueCents: 9_000,
      date: '2026-10-04', isPaid: true, workspaceId: ws, profileId: ws, userId: owner, cashAccountId: 'acc_main',
      cashEntry: {domainVersion: 1, origin: 'split', status: 'confirmed', currency: 'BRL', requestHash: 'h',
        quotaPeriod: null, accountMovementId: 'mov_1'},
      splitEntry: {kind: 'bill_expense', groupId: GROUP, billId: BILL, reimbursementId: null, reversal: false,
        reversalOf: null, amountCents: 9_000},
      createdBy: 'system:split-bills', createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`${base}/quota_state/split_groups`), {workspaceId: ws, activeCount: 1, schemaVersion: 1,
      updatedAt: ts()});
    await batch.commit();
  }
};

const signedClient = async (user, suffix) => {
  const app = initializeApp(
    {apiKey: 'rules-test', projectId},
    `p4c-${suffix}-${Math.random().toString(36).slice(2, 12)}`,
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

const ids = (snapshot) => snapshot.docs.map((entry) => entry.id);

/** As consultas de `src/modules/split-bills/api.ts`, com os mesmos tetos. */
const frontendQueries = (db, ws, uid, isWorkspaceAdmin) => {
  const coll = (path) => collection(db, 'workspaces', ws, path);
  return {
    activeGroups: () => query(coll('split_groups'), where('status', '==', 'active'), orderBy('createdAt', 'desc'),
      limit(101)),
    archivedGroups: () => query(coll('split_groups'), where('status', '==', 'archived'),
      orderBy('createdAt', 'desc'), limit(51)),
    myParticipants: () => query(coll('split_participants'), where('userId', '==', uid), limit(101)),
    groupParticipants: () => query(coll('split_participants'), where('groupId', '==', GROUP), limit(101)),
    invites: () => query(coll('split_invites'), where('groupId', '==', GROUP),
      ...(isWorkspaceAdmin ? [] : [where('createdBy', '==', uid)]), where('status', '==', 'pending'),
      where('expiresAt', '>', Timestamp.now()), orderBy('expiresAt', 'asc'), limit(21)),
    bills: (...cursor) => query(coll('split_bills'), where('groupId', '==', GROUP), orderBy('expenseDate', 'desc'),
      orderBy(documentId(), 'desc'), ...cursor, limit(21)),
    reimbursements: () => query(coll('split_reimbursements'), where('groupId', '==', GROUP),
      orderBy('expenseDate', 'desc'), orderBy(documentId(), 'desc'), limit(21)),
    shares: () => query(coll('split_shares'), where('billId', '==', BILL), limit(51)),
  };
};

test.before(seed);

test('P4-C Rules — nenhum papel cria, altera ou apaga grupos, participantes, convites, títulos, rateios, ' +
  'reembolsos ou trilha', async () => {
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA', 'ownerB'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const coll of COLLECTIONS) {
        const base = `workspaces/${wsA}/${coll}`;
        await denied(setDoc(doc(db, `${base}/novo-${name}`), {
          schemaVersion: 1, workspaceId: wsA, groupId: GROUP, billId: BILL, name: 'Forjado', status: 'active',
          amountCents: 1, role: 'owner', userId: users[name].uid, ownerUserId: users[name].uid,
          createdBy: users[name].uid, updatedAt: serverTimestamp(),
        }), `${name} cria em ${coll}`);
        await denied(addDoc(collection(db, base), {name: 'Forjado'}), `${name} adiciona em ${coll}`);
        await denied(updateDoc(doc(db, `${base}/${existingId[coll]}`), {status: 'settled', amountCents: 1}),
          `${name} altera ${coll}`);
        await denied(setDoc(doc(db, `${base}/${existingId[coll]}`), {status: 'archived'}, {merge: true}),
          `${name} sobrescreve ${coll}`);
        await denied(deleteDoc(doc(db, `${base}/${existingId[coll]}`)), `${name} apaga ${coll}`);
      }
      // O formato do CRUD anterior (reais, nomes livres, status antigos) também é negado.
      await denied(setDoc(doc(db, `workspaces/${wsA}/split_groups/legado-${name}`), {
        nome: 'Viagem', participantes: [{nomeExibicao: 'Você'}], criadoPor: users[name].uid,
      }), `${name} grava grupo no formato legado`);
      await denied(setDoc(doc(db, `workspaces/${wsA}/split_bills/legado-${name}`), {
        groupId: GROUP, valorReal: 90.5, statusPagamento: 'aberto', pagoPor: 'Você',
      }), `${name} grava título no formato legado`);
      await denied(setDoc(doc(db, `workspaces/${wsA}/split_shares/legado-${name}`), {
        billId: BILL, valorDevido: 30.17, status: 'aPagar',
      }), `${name} grava rateio no formato legado`);
      // Quitação, perdão, papel e convite pelo cliente: negados.
      await denied(updateDoc(doc(db, `workspaces/${wsA}/split_shares/${SHARE_MEMBER}`),
        {status: 'settled', settledBy: users[name].uid}), `${name} quita sem callable`);
      await denied(updateDoc(doc(db, `workspaces/${wsA}/split_participants/spart_member`), {role: 'owner'}),
        `${name} promove participante`);
      await denied(updateDoc(doc(db, `workspaces/${wsA}/split_invites/${INVITE_MEMBER}`),
        {status: 'accepted', acceptedBy: users[name].uid}), `${name} aceita convite sem callable`);
      await denied(updateDoc(doc(db, `workspaces/${wsA}/split_reimbursements/${REIMB}`), {status: 'paid'}),
        `${name} paga reembolso sem callable`);
      const batch = writeBatch(db);
      batch.update(doc(db, `workspaces/${wsA}/split_groups/${GROUP}`), {'totals.openCents': 0});
      batch.set(doc(db, `workspaces/${wsA}/split_shares/lote-${name}`), {status: 'open'});
      await denied(batch.commit(), `${name} grava em lote`);
    }
  });
  // O contador da quota `splitGroups` é só do backend, nos dois sentidos.
  await withClients(['ownerA', 'memberA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const counter = doc(db, `workspaces/${wsA}/quota_state/split_groups`);
      await denied(getDoc(counter), `${name} lê o contador de grupos`);
      await denied(setDoc(counter, {workspaceId: wsA, activeCount: 0, schemaVersion: 1}),
        `${name} zera o contador de grupos`);
      await denied(updateDoc(counter, {activeCount: 0}), `${name} altera o contador de grupos`);
    }
  });
  const db = getAdmin().firestore();
  const counter = await db.doc(`workspaces/${wsA}/quota_state/split_groups`).get();
  assert.equal(counter.get('activeCount'), 1);
  const share = await db.doc(`workspaces/${wsA}/split_shares/${SHARE_MEMBER}`).get();
  assert.equal(share.get('status'), 'open');
  assert.equal(share.get('amountCents'), 3_000);
  const group = await db.doc(`workspaces/${wsA}/split_groups/${GROUP}`).get();
  assert.equal(group.get('totals.openCents'), 6_000);
  assert.equal((await db.collection(`workspaces/${wsA}/split_groups`).get()).size, 2);
  assert.equal((await db.collection(`workspaces/${wsA}/split_shares`).get()).size, 2);
  assert.equal((await db.collection(`workspaces/${wsA}/split_events`).get()).size, 1);
});

test('P4-C Rules — leitura de membros (viewer incluído) nas consultas do frontend, com teto', async () => {
  await withClients(['ownerA', 'memberA', 'viewerA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const uid = users[name].uid;
      const q = frontendQueries(db, wsA, uid, name === 'ownerA');
      const coll = (path) => collection(db, 'workspaces', wsA, path);
      for (const path of COLLECTIONS.filter((item) => item !== 'split_invites' && item !== 'split_events')) {
        assert.equal((await getDoc(doc(db, `workspaces/${wsA}/${path}/${existingId[path]}`))).exists(), true,
          `${name} lê ${path}`);
      }
      assert.deepEqual(ids(await getDocs(q.activeGroups())), [GROUP]);
      assert.deepEqual(ids(await getDocs(q.archivedGroups())), [ARCHIVED]);
      assert.deepEqual(ids(await getDocs(q.groupParticipants())).sort(),
        ['spart_external', 'spart_member', 'spart_owner']);
      assert.deepEqual(ids(await getDocs(q.myParticipants())),
        name === 'ownerA' ? ['spart_owner'] : name === 'memberA' ? ['spart_member'] : []);
      assert.deepEqual(ids(await getDocs(q.bills())), [BILL]);
      assert.deepEqual(ids(await getDocs(q.reimbursements())), [REIMB]);
      assert.deepEqual(ids(await getDocs(q.shares())).sort(), [SHARE_EXTERNAL, SHARE_MEMBER]);
      // Sem teto ou acima dele: negado.
      await denied(getDocs(query(coll('split_groups'))), `${name} lista grupos sem teto`);
      await denied(getDocs(query(coll('split_groups'), limit(102))), `${name} grupos acima do teto`);
      await denied(getDocs(query(coll('split_participants'), where('groupId', '==', GROUP), limit(102))),
        `${name} participantes acima do teto`);
      await denied(getDocs(query(coll('split_bills'), where('groupId', '==', GROUP), limit(102))),
        `${name} títulos acima do teto`);
      await denied(getDocs(query(coll('split_shares'), where('billId', '==', BILL), limit(52))),
        `${name} rateios acima do teto`);
      await denied(getDocs(query(coll('split_shares'))), `${name} varre rateios`);
      await denied(getDocs(query(coll('split_reimbursements'), limit(102))), `${name} reembolsos acima do teto`);
    }
  });
});

test('P4-C Rules — convite: owner/admin leem todos; os demais só os que criaram', async () => {
  await withClients(['ownerA', 'adminA', 'memberA', 'member2A', 'viewerA'], async (clients) => {
    for (const name of ['ownerA', 'adminA']) {
      const {db} = clients[name];
      const q = frontendQueries(db, wsA, users[name].uid, true);
      assert.deepEqual(ids(await getDocs(q.invites())).sort(), [INVITE_ADMIN, INVITE_MEMBER], name);
      assert.equal((await getDoc(doc(db, `workspaces/${wsA}/split_invites/${INVITE_MEMBER}`))).exists(), true);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, 'split_invites'), where('groupId', '==', GROUP),
        limit(22))), `${name} convites acima do teto`);
    }
    for (const name of ['memberA', 'member2A', 'viewerA']) {
      const {db} = clients[name];
      const uid = users[name].uid;
      const q = frontendQueries(db, wsA, uid, false);
      assert.deepEqual(ids(await getDocs(q.invites())), name === 'memberA' ? [INVITE_MEMBER] : [], name);
      // Sem o filtro de autor, a consulta alcançaria convites de outros: negada.
      await denied(getDocs(query(collection(db, 'workspaces', wsA, 'split_invites'), where('groupId', '==', GROUP),
        where('status', '==', 'pending'), limit(21))), `${name} lista convites de outros`);
      await denied(getDoc(doc(db, `workspaces/${wsA}/split_invites/${INVITE_ADMIN}`)),
        `${name} lê convite do admin`);
      if (name === 'memberA') {
        assert.equal((await getDoc(doc(db, `workspaces/${wsA}/split_invites/${INVITE_MEMBER}`))).exists(), true);
      } else {
        await denied(getDoc(doc(db, `workspaces/${wsA}/split_invites/${INVITE_MEMBER}`)),
          `${name} lê convite de outro membro`);
      }
    }
  });
});

test('P4-C Rules — a trilha é só de owner/admin, com teto', async () => {
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA'], async (clients) => {
    for (const name of ['ownerA', 'adminA']) {
      const {db} = clients[name];
      const events = collection(db, 'workspaces', wsA, 'split_events');
      assert.deepEqual(ids(await getDocs(query(events, where('groupId', '==', GROUP), limit(50)))), [EVENT]);
      await denied(getDocs(query(events, limit(51))), `${name} trilha acima do teto`);
    }
    for (const name of ['memberA', 'viewerA']) {
      const {db} = clients[name];
      await denied(getDoc(doc(db, `workspaces/${wsA}/split_events/${EVENT}`)), `${name} lê a trilha`);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, 'split_events'), limit(10))),
        `${name} lista a trilha`);
    }
  });
});

test('P4-C Rules — nada atravessa o workspace; membro removido não lê', async () => {
  await withClients(['ownerB', 'removedA', 'ownerA'], async (clients) => {
    for (const path of COLLECTIONS) {
      await denied(getDoc(doc(clients.ownerB.db, `workspaces/${wsA}/${path}/${existingId[path]}`)),
        `B lê ${path} de A`);
      await denied(getDoc(doc(clients.ownerA.db, `workspaces/${wsB}/${path}/${existingId[path]}`)),
        `A lê ${path} de B`);
      await denied(getDoc(doc(clients.removedA.db, `workspaces/${wsA}/${path}/${existingId[path]}`)),
        `removido lê ${path}`);
      await denied(getDocs(query(collection(clients.ownerB.db, 'workspaces', wsA, path), limit(20))),
        `B lista ${path} de A`);
    }
    const removed = frontendQueries(clients.removedA.db, wsA, users.removedA.uid, false);
    await denied(getDocs(removed.activeGroups()), 'removido lista grupos');
    await denied(getDocs(removed.shares()), 'removido lista rateios');
  });
});

test('P4-C Rules — o cliente não forja splitEntry, não grava parcelado/cartão e não altera o espelho', async () => {
  await withClients(['ownerA', 'memberA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const plain = {
        type: 'despesa', description: 'Jantar', category: 'Restaurantes', value: 90, date: '2026-10-04',
        workspaceId: wsA, profileId: wsA, userId: users[name].uid, isPaid: true,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      };
      // P4-D: nem o lançamento simples é aceito — `transactions` é só do
      // backend; os campos abaixo seguem negados de todo modo.
      await denied(setDoc(doc(db, `workspaces/${wsA}/transactions/simples-${name}`), plain),
        `${name} cria lançamento simples`);
      await denied(setDoc(doc(db, `workspaces/${wsA}/transactions/forjado-${name}`), {
        ...plain, splitEntry: {kind: 'bill_expense', groupId: GROUP, billId: BILL, reimbursementId: null,
          reversal: false, reversalOf: null, amountCents: 9_000},
      }), `${name} cria lançamento com splitEntry`);
      for (const [label, extra] of [
        ['tipo parcelado', {type: 'parcelado'}],
        ['cartão', {cardId: 'card_1'}],
        ['parcelas', {installments: 3}],
        ['parcela corrente', {currentInstallment: 1}],
        ['grupo antigo', {splitGroupId: GROUP}],
      ]) {
        await denied(setDoc(doc(db, `workspaces/${wsA}/transactions/legado-${name}-${label.replace(/\s/g, '-')}`),
          {...plain, ...extra}), `${name} cria lançamento com ${label}`);
      }
      const mirror = doc(db, `workspaces/${wsA}/transactions/${MIRROR}`);
      await denied(updateDoc(mirror, {value: 1, updatedAt: serverTimestamp()}), `${name} altera o espelho`);
      await denied(updateDoc(mirror, {splitEntry: deleteField(), updatedAt: serverTimestamp()}),
        `${name} remove o vínculo`);
      await denied(updateDoc(mirror, {voidedAt: serverTimestamp(), voidedBy: users[name].uid,
        voidReason: 'teste', updatedAt: serverTimestamp()}), `${name} anula o espelho`);
      await denied(deleteDoc(mirror), `${name} apaga o espelho`);
    }
  });
  const stored = await getAdmin().firestore().doc(`workspaces/${wsA}/transactions/${MIRROR}`).get();
  assert.equal(stored.get('valueCents'), 9_000);
  assert.equal(stored.get('splitEntry.billId'), BILL);
  assert.equal(stored.get('voidedAt'), undefined);
});

test('P4-C Rules — paginação de títulos: cursor composto e sonda de corte', async () => {
  // Massa própria no workspace B (o A tem asserções exatas nos testes acima).
  const db = getAdmin().firestore();
  const base = `workspaces/${wsB}`;
  const batch = db.batch();
  const expected = [];
  for (let index = 0; index < 24; index += 1) {
    const id = `sbill_page_${String(index).padStart(2, '0')}`;
    // Datas repetidas de dois em dois: o desempate é o ID, em ordem reversa.
    const expenseDate = `2026-09-${String(1 + Math.floor(index / 2)).padStart(2, '0')}`;
    expected.push({id, expenseDate});
    batch.set(db.doc(`${base}/split_bills/${id}`), {
      id, schemaVersion: 1, workspaceId: wsB, groupId: GROUP, amountCents: 1_000, expenseDate, status: 'open',
      createdAt: ts(), updatedAt: ts(),
    });
  }
  await batch.commit();
  expected.push({id: BILL, expenseDate: '2026-10-04'});
  const order = expected.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate) || b.id.localeCompare(a.id))
    .map((item) => item.id);

  await withClients(['ownerB'], async ({ownerB}) => {
    const q = frontendQueries(ownerB.db, wsB, users.ownerB.uid, true);
    const first = await getDocs(q.bills());
    assert.equal(first.size, 21, 'sonda indica mais páginas');
    const shown = first.docs.slice(0, 20);
    const last = shown[shown.length - 1];
    const second = await getDocs(q.bills(startAfter(last.get('expenseDate'), last.id)));
    assert.equal(second.size, order.length - 20, 'segunda página traz só o restante');
    assert.deepEqual([...shown.map((entry) => entry.id), ...ids(second)], order,
      'sem lacuna nem repetição entre páginas');
  });
});
