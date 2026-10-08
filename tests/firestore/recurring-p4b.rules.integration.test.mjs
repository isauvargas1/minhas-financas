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
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

/**
 * P4-B (D-12, PR-REC-01) — Rules de Recorrentes contra o Emulator.
 *
 * - Nenhum papel escreve em `recurring_expenses`, `recurring_occurrences` ou
 *   `recurring_events`: o cliente não cria contrato, não muda estado nem
 *   próximo vencimento, não materializa ocorrência, não grava fato gerado
 *   nem histórico de valor. O único caminho de escrita são as callables (e
 *   o agendador, com Admin SDK).
 * - Leitura de qualquer membro ativo (viewer incluído), nas consultas exatas
 *   do frontend, com teto de listagem; nada atravessa o workspace; membro
 *   removido não lê.
 * - `transactions`: o cliente não forja o vínculo `recurringEntry` nem
 *   altera o lançamento gerado por Recorrentes.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da P4-B.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-p4b-123456';

const users = {
  ownerA: {uid: 'p4b-owner-a', email: 'p4b-owner-a@example.test'},
  adminA: {uid: 'p4b-admin-a', email: 'p4b-admin-a@example.test'},
  memberA: {uid: 'p4b-member-a', email: 'p4b-member-a@example.test'},
  viewerA: {uid: 'p4b-viewer-a', email: 'p4b-viewer-a@example.test'},
  removedA: {uid: 'p4b-removed-a', email: 'p4b-removed-a@example.test'},
  ownerB: {uid: 'p4b-owner-b', email: 'p4b-owner-b@example.test'},
};
const wsA = 'p4b-workspace-a';
const wsB = 'p4b-workspace-b';
const REC = 'rec_main';
const OCC_1 = 'rocc_1';
const OCC_2 = 'rocc_2';
const EVT_CREATED = 'recurring_created_1';
const EVT_UPDATED = 'recurring_updated_1';
const EVT_OCC = 'recurring_occurrence_generated_1';
const ENTRY = 'cash_recurring_1';

const COLLECTIONS = ['recurring_expenses', 'recurring_occurrences', 'recurring_events'];
const existingId = {
  recurring_expenses: REC,
  recurring_occurrences: OCC_1,
  recurring_events: EVT_CREATED,
};

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const ts = (iso = '2026-10-05T12:00:00.000Z') => getAdmin().firestore.Timestamp.fromDate(new Date(iso));

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
    db.doc(`workspaces/${wsA}`).set({ownerId: users.ownerA.uid, type: 'PF', name: 'A', currency: 'BRL', status: 'active'}),
    db.doc(`workspaces/${wsB}`).set({ownerId: users.ownerB.uid, type: 'PF', name: 'B', currency: 'BRL', status: 'active'}),
  ]);
  const members = [
    [wsA, users.ownerA, 'owner', 'active'], [wsA, users.adminA, 'admin', 'active'],
    [wsA, users.memberA, 'member', 'active'], [wsA, users.viewerA, 'viewer', 'active'],
    [wsA, users.removedA, 'member', 'removed'], [wsB, users.ownerB, 'owner', 'active'],
  ];
  await Promise.all(members.map(([ws, user, role, status]) =>
    db.doc(`workspaces/${ws}/members/${user.uid}`).set({uid: user.uid, role, status})));
  for (const ws of [wsA, wsB]) {
    const base = `workspaces/${ws}`;
    const batch = db.batch();
    batch.set(db.doc(`${base}/recurring_expenses/${REC}`), {
      id: REC, schemaVersion: 1, workspaceId: ws, name: 'Internet', type: 'fixed_bill', description: null,
      amountCents: 9_990, currency: 'BRL', frequency: 'monthly', billingDay: 10, startDate: '2026-01-10',
      endDate: null, paymentMethod: 'pix', executionMode: 'automatic', cardId: null, cashAccountId: 'acc_main',
      category: 'Utilidades', status: 'active', nextDueDate: '2026-11-10', lastProcessedDueDate: '2026-10-10',
      openOccurrenceCount: 0, visual: {color: '#4f46e5', icon: 'Bolt', emoji: null}, business: null,
      createdBy: users.memberA.uid, updatedBy: users.memberA.uid, revision: 1, requestHash: 'h',
      createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`${base}/recurring_expenses/rec_paused`), {
      id: 'rec_paused', schemaVersion: 1, workspaceId: ws, name: 'Academia', status: 'paused', nextDueDate: null,
      createdAt: ts(), updatedAt: ts(),
    });
    for (const [id, dueDate, status] of [[OCC_1, '2026-10-10', 'generated'], [OCC_2, '2026-09-10', 'ignored']]) {
      batch.set(db.doc(`${base}/recurring_occurrences/${id}`), {
        id, schemaVersion: 1, workspaceId: ws, recurringExpenseId: REC, dueDate, competenceMonth: dueDate.slice(0, 7),
        plannedAmountCents: 9_990, actualAmountCents: status === 'generated' ? 9_990 : null, currency: 'BRL', status,
        targetDomain: 'cash', executionMode: 'automatic', cardId: null, cashAccountId: 'acc_main',
        cashTransactionId: status === 'generated' ? ENTRY : null, cardPurchaseId: null, attentionCode: null,
        settlement: status === 'generated' ? 'pending' : null, revision: 1, createdAt: ts(), updatedAt: ts(),
      });
    }
    for (const [id, operation, amountChanged, occurredAt] of [
      [EVT_CREATED, 'recurring.created', true, '2026-01-05T12:00:00.000Z'],
      [EVT_UPDATED, 'recurring.updated', true, '2026-06-05T12:00:00.000Z'],
      [EVT_OCC, 'recurring.occurrence_generated', false, '2026-10-10T05:00:00.000Z'],
    ]) {
      batch.set(db.doc(`${base}/recurring_events/${id}`), {
        id, schemaVersion: 1, workspaceId: ws, recurringExpenseId: REC, operation, amountChanged,
        before: null, after: {amountCents: 9_990}, actorId: users.ownerA.uid, occurredAt: ts(occurredAt),
      });
    }
    batch.set(db.doc(`${base}/transactions/${ENTRY}`), {
      type: 'despesa', description: 'Internet', category: 'Utilidades', value: 99.9, valueCents: 9_990,
      date: '2026-10-10', dueDate: '2026-10-10', isPaid: false, workspaceId: ws, profileId: ws,
      userId: users.memberA.uid, cashAccountId: 'acc_main',
      cashEntry: {domainVersion: 1, origin: 'recurring', status: 'pending', currency: 'BRL', requestHash: 'h',
        quotaPeriod: null, accountMovementId: null},
      recurringEntry: {domainVersion: 1, recurringExpenseId: REC, occurrenceId: OCC_1},
      createdBy: 'system:recurring-expenses', createdAt: ts(), updatedAt: ts(),
    });
    await batch.commit();
  }
};

const signedClient = async (user, suffix) => {
  const app = initializeApp(
    {apiKey: 'rules-test', projectId},
    `p4b-${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
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

test.before(seed);

test('P4-B Rules — nenhum papel cria, altera ou apaga contratos, ocorrências ou trilha', async () => {
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA', 'ownerB'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const coll of COLLECTIONS) {
        const base = `workspaces/${wsA}/${coll}`;
        await denied(setDoc(doc(db, `${base}/novo-${name}`), {
          schemaVersion: 1, workspaceId: wsA, name: 'Forjado', amountCents: 1, status: 'active',
          nextDueDate: '2026-01-01', recurringExpenseId: REC, dueDate: '2026-01-01', operation: 'recurring.updated',
          createdBy: users[name].uid, updatedAt: serverTimestamp(),
        }), `${name} cria em ${coll}`);
        await denied(addDoc(collection(db, base), {name: 'Forjado'}), `${name} adiciona em ${coll}`);
        await denied(updateDoc(doc(db, `${base}/${existingId[coll]}`), {status: 'cancelled', amountCents: 1}),
          `${name} altera ${coll}`);
        await denied(setDoc(doc(db, `${base}/${existingId[coll]}`), {status: 'paused'}, {merge: true}),
          `${name} sobrescreve ${coll}`);
        await denied(deleteDoc(doc(db, `${base}/${existingId[coll]}`)), `${name} apaga ${coll}`);
      }
      // O formato do CRUD anterior (reais, competência, ajustes) também é negado.
      await denied(setDoc(doc(db, `workspaces/${wsA}/recurring_expenses/legado-${name}`), {
        nome: 'Assinatura', valorPadrao: 49.9, periodo: 'mensal', status: 'ativo', adjustments: [],
        gerarDespesaAutomaticamente: true, splitGroupIdOpcional: 'g1',
      }), `${name} grava o formato legado`);
      await denied(setDoc(doc(db, `workspaces/${wsA}/recurring_occurrences/occ_${REC}_2026-10`), {
        competencia: '2026-10', valorPrevisto: 49.9, status: 'pago',
      }), `${name} grava ocorrência por competência`);
      const batch = writeBatch(db);
      batch.update(doc(db, `workspaces/${wsA}/recurring_expenses/${REC}`), {nextDueDate: '2020-01-01'});
      batch.set(doc(db, `workspaces/${wsA}/recurring_occurrences/lote-${name}`), {status: 'generated'});
      await denied(batch.commit(), `${name} grava em lote`);
    }
  });
  const db = getAdmin().firestore();
  const contract = await db.doc(`workspaces/${wsA}/recurring_expenses/${REC}`).get();
  assert.equal(contract.get('amountCents'), 9_990);
  assert.equal(contract.get('nextDueDate'), '2026-11-10');
  assert.equal((await db.collection(`workspaces/${wsA}/recurring_occurrences`).get()).size, 2);
  assert.equal((await db.collection(`workspaces/${wsA}/recurring_events`).get()).size, 3);
});

test('P4-B Rules — leitura de membros (viewer incluído) nas consultas do frontend, com teto', async () => {
  await withClients(['ownerA', 'memberA', 'viewerA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const coll = (path) => collection(db, 'workspaces', wsA, path);
      for (const path of COLLECTIONS) {
        assert.equal((await getDoc(doc(db, `workspaces/${wsA}/${path}/${existingId[path]}`))).exists(), true,
          `${name} lê ${path}`);
      }
      assert.deepEqual(ids(await getDocs(query(coll('recurring_expenses'), orderBy(documentId()), limit(101)))),
        [REC, 'rec_paused']);
      assert.deepEqual(ids(await getDocs(query(coll('recurring_expenses'), where('status', '==', 'active'),
        orderBy(documentId()), limit(501)))), [REC]);
      assert.deepEqual(ids(await getDocs(query(coll('recurring_occurrences'), where('recurringExpenseId', '==', REC),
        where('status', 'in', ['generated', 'ignored']), orderBy('dueDate', 'desc'), orderBy(documentId(), 'desc'),
        limit(25)))), [OCC_1, OCC_2]);
      assert.deepEqual(ids(await getDocs(query(coll('recurring_occurrences'), where('recurringExpenseId', '==', REC),
        where('status', 'in', ['awaiting_confirmation', 'attention_required']), orderBy('dueDate', 'asc'),
        orderBy(documentId(), 'asc'), limit(51)))), []);
      assert.deepEqual(ids(await getDocs(query(coll('recurring_events'), where('recurringExpenseId', '==', REC),
        where('amountChanged', '==', true), orderBy('occurredAt', 'desc'), orderBy(documentId(), 'desc'),
        limit(21)))), [EVT_UPDATED, EVT_CREATED]);
      // Estado dos fatos gerados (lançamento por ID).
      assert.deepEqual(ids(await getDocs(query(coll('transactions'), where(documentId(), 'in', [ENTRY]),
        limit(30)))), [ENTRY]);
      // Sem teto ou acima dele: negado.
      await denied(getDocs(query(coll('recurring_expenses'))), `${name} lista contratos sem teto`);
      await denied(getDocs(query(coll('recurring_expenses'), limit(502))), `${name} contratos acima do teto`);
      await denied(getDocs(query(coll('recurring_occurrences'), limit(102))), `${name} ocorrências acima do teto`);
      await denied(getDocs(query(coll('recurring_events'))), `${name} trilha sem teto`);
      await denied(getDocs(query(coll('recurring_events'), limit(51))), `${name} trilha acima do teto`);
    }
  });
});

test('P4-B Rules — nada atravessa o workspace; membro removido não lê', async () => {
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
  });
});

test('P4-B Rules — o cliente não forja o vínculo recorrente nem altera o lançamento gerado', async () => {
  await withClients(['ownerA', 'memberA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const plain = {
        type: 'despesa', description: 'Internet', category: 'Utilidades', value: 99.9, date: '2026-10-10',
        workspaceId: wsA, profileId: wsA, userId: users[name].uid, isPaid: false,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      };
      await denied(setDoc(doc(db, `workspaces/${wsA}/transactions/forjado-${name}`), {
        ...plain, recurringEntry: {domainVersion: 1, recurringExpenseId: REC, occurrenceId: OCC_1},
      }), `${name} cria lançamento com vínculo recorrente`);
      await denied(setDoc(doc(db, `workspaces/${wsA}/transactions/forjado2-${name}`), {
        ...plain, source: 'recurring', recurringId: REC,
      }), `${name} cria lançamento no formato recorrente anterior`);
      const entry = doc(db, `workspaces/${wsA}/transactions/${ENTRY}`);
      await denied(updateDoc(entry, {isPaid: true, updatedAt: serverTimestamp()}), `${name} paga sem callable`);
      await denied(updateDoc(entry, {recurringEntry: deleteField(), updatedAt: serverTimestamp()}),
        `${name} remove o vínculo`);
      await denied(updateDoc(entry, {value: 1, updatedAt: serverTimestamp()}), `${name} altera o valor`);
      await denied(deleteDoc(entry), `${name} apaga o lançamento gerado`);
    }
  });
  const stored = await getAdmin().firestore().doc(`workspaces/${wsA}/transactions/${ENTRY}`).get();
  assert.equal(stored.get('isPaid'), false);
  assert.equal(stored.get('recurringEntry.occurrenceId'), OCC_1);
});

test('P4-B Rules — paginação nas consultas do frontend: fronteira, cursor e sonda de corte', async () => {
  // Massa própria no workspace B (o A tem asserções exatas nos testes acima).
  const db = getAdmin().firestore();
  const base = `workspaces/${wsB}`;
  const MANY = 'rec_many';
  const batch = db.batch();
  for (const suffix of ['a', 'b', 'c']) {
    batch.set(db.doc(`${base}/recurring_expenses/rec_page_${suffix}`), {
      id: `rec_page_${suffix}`, schemaVersion: 1, workspaceId: wsB, name: `Página ${suffix}`, status: 'paused',
      nextDueDate: null, createdAt: ts(), updatedAt: ts(),
    });
  }
  // 30 resolvidas (geradas e ignoradas) e 3 que pedem ação, semanais.
  const statusOf = (index) => (index >= 30 ? (index === 31 ? 'attention_required' : 'awaiting_confirmation') :
    index % 5 === 0 ? 'ignored' : 'generated');
  const occurrences = [];
  for (let index = 0; index < 33; index += 1) {
    const day = new Date(Date.UTC(2026, 0, 5 + 7 * index, 12)).toISOString().slice(0, 10);
    const id = `rocc_page_${String(index).padStart(2, '0')}`;
    occurrences.push({id, dueDate: day, status: statusOf(index)});
    batch.set(db.doc(`${base}/recurring_occurrences/${id}`), {
      id, schemaVersion: 1, workspaceId: wsB, recurringExpenseId: MANY, dueDate: day,
      competenceMonth: day.slice(0, 7), plannedAmountCents: 9_990, status: statusOf(index), targetDomain: 'cash',
      createdAt: ts(), updatedAt: ts(),
    });
  }
  for (let index = 0; index < 22; index += 1) {
    const id = `recurring_page_evt_${String(index).padStart(2, '0')}`;
    batch.set(db.doc(`${base}/recurring_events/${id}`), {
      id, schemaVersion: 1, workspaceId: wsB, recurringExpenseId: MANY, operation: 'recurring.updated',
      amountChanged: true, occurredAt: ts(new Date(Date.UTC(2026, 0, 1 + index, 12)).toISOString()),
    });
  }
  await batch.commit();

  await withClients(['ownerB'], async ({ownerB}) => {
    const coll = (path) => collection(ownerB.db, 'workspaces', wsB, path);
    // Contratos por ID: página de 2 (+1 de sonda), depois o cursor.
    const contracts = ids(await getDocs(query(coll('recurring_expenses'), orderBy(documentId()), limit(501))));
    const first = await getDocs(query(coll('recurring_expenses'), orderBy(documentId()), limit(3)));
    assert.equal(first.size, 3, 'sonda indica mais páginas');
    const firstPage = ids(first).slice(0, 2);
    const rest = ids(await getDocs(query(coll('recurring_expenses'), orderBy(documentId()),
      startAfter(firstPage[firstPage.length - 1]), limit(501))));
    assert.deepEqual([...firstPage, ...rest], contracts, 'sem lacuna nem repetição entre páginas');

    // Histórico (geradas e ignoradas), mais recentes primeiro, 24 + sonda.
    const resolved = occurrences.filter((item) => item.status === 'generated' || item.status === 'ignored')
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate) || b.id.localeCompare(a.id)).map((item) => item.id);
    const historyQuery = (...extra) => query(coll('recurring_occurrences'),
      where('recurringExpenseId', '==', MANY), where('status', 'in', ['generated', 'ignored']),
      orderBy('dueDate', 'desc'), orderBy(documentId(), 'desc'), ...extra, limit(25));
    const page1 = await getDocs(historyQuery());
    assert.equal(page1.size, 25, 'primeira página cheia com sonda');
    const shown = page1.docs.slice(0, 24);
    const last = shown[shown.length - 1];
    const page2 = await getDocs(historyQuery(startAfter(last.get('dueDate'), last.id)));
    assert.equal(page2.size, resolved.length - 24, 'segunda página traz só o restante');
    assert.deepEqual([...shown.map((entry) => entry.id), ...ids(page2)], resolved);

    // Ocorrências que pedem ação, mais antigas primeiro, com teto e sonda.
    const open = ids(await getDocs(query(coll('recurring_occurrences'), where('recurringExpenseId', '==', MANY),
      where('status', 'in', ['awaiting_confirmation', 'attention_required']),
      orderBy('dueDate', 'asc'), orderBy(documentId(), 'asc'), limit(51))));
    assert.deepEqual(open, ['rocc_page_30', 'rocc_page_31', 'rocc_page_32']);

    // Reajustes: 20 + sonda (21) revela o corte.
    const history = await getDocs(query(coll('recurring_events'), where('recurringExpenseId', '==', MANY),
      where('amountChanged', '==', true), orderBy('occurredAt', 'desc'), orderBy(documentId(), 'desc'), limit(21)));
    assert.equal(history.size, 21, 'sonda de corte dos reajustes');
    assert.equal(history.docs[0].id, 'recurring_page_evt_21');
  });
});
