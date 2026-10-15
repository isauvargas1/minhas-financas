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
 * P4-A (D-36) — Rules do domínio de cartões contra o Emulator.
 *
 * - Nenhum papel escreve em `credit_cards`, `credit_card_purchases`,
 *   `credit_card_invoices`, `credit_card_invoice_entries`,
 *   `credit_card_invoice_payments`, `credit_card_limit_ledger` ou
 *   `credit_card_events`: o cliente não cria cartão, não altera limite, não
 *   fecha nem paga fatura, não lança parcela e não forja auditoria. O único
 *   caminho de escrita são as callables.
 * - Leitura de qualquer membro ativo (viewer incluído), nas consultas exatas
 *   do frontend, com teto de listagem (cartões ≤ 50; demais ≤ 501, a sonda
 *   de corte; razão do limite ≤ 201); auditoria só owner/admin (≤ 50).
 * - Nada atravessa o workspace, nos dois sentidos; membro removido e
 *   anônimo não leem nem gravam.
 * - `transactions`: o cliente não forja o espelho de pagamento de fatura
 *   (`creditCardPaymentEntry`) nem edita o espelho gravado pelo backend.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da P4-A.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-p4a-123456';

const users = {
  ownerA: {uid: 'p4a-owner-a', email: 'p4a-owner-a@example.test'},
  adminA: {uid: 'p4a-admin-a', email: 'p4a-admin-a@example.test'},
  memberA: {uid: 'p4a-member-a', email: 'p4a-member-a@example.test'},
  viewerA: {uid: 'p4a-viewer-a', email: 'p4a-viewer-a@example.test'},
  removedA: {uid: 'p4a-removed-a', email: 'p4a-removed-a@example.test'},
  ownerB: {uid: 'p4a-owner-b', email: 'p4a-owner-b@example.test'},
};
const wsA = 'p4a-workspace-a';
const wsB = 'p4a-workspace-b';

const CARD = 'card_main';
const OPEN_INVOICE = `${CARD}_2026-11`;
const CLOSED_INVOICE = `${CARD}_2026-10`;
const OLD_INVOICE = `${CARD}_2026-09`;

const COLLECTIONS = [
  'credit_cards', 'credit_card_purchases', 'credit_card_invoices', 'credit_card_invoice_entries',
  'credit_card_invoice_payments', 'credit_card_limit_ledger', 'credit_card_events',
];
const SHARED = COLLECTIONS.filter((coll) => coll !== 'credit_card_events');
const existingId = {
  credit_cards: CARD,
  credit_card_purchases: 'ccp_1',
  credit_card_invoices: OPEN_INVOICE,
  credit_card_invoice_entries: 'cce_1',
  credit_card_invoice_payments: 'ccpay_1',
  credit_card_limit_ledger: 'ccl_1',
  credit_card_events: 'credit_card_created_1',
};

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const ts = (iso = '2026-10-05T12:00:00.000Z') => getAdmin().firestore.Timestamp.fromDate(new Date(iso));

const invoiceDoc = (ws, id, competenceMonth, cycleStatus, paymentStatus, totalCents, paidCents) => ({
  id, schemaVersion: 1, workspaceId: ws, cardId: CARD, competenceMonth, cycleStatus, paymentStatus,
  closingDate: `${competenceMonth}-25`, dueDate: `${competenceMonth}-28`, totalCents, paidCents,
  remainingCents: totalCents - paidCents, createdAt: ts(), updatedAt: ts(),
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
    batch.set(db.doc(`${base}/credit_cards/${CARD}`), {
      id: CARD, schemaVersion: 1, workspaceId: ws, name: 'Cartão principal', brand: 'Visa', status: 'active',
      closingDay: 25, dueDay: 28, limitTotalCents: 500_000, limitUsedCents: 30_000,
      createdBy: users.ownerA.uid, updatedBy: users.ownerA.uid, createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`${base}/credit_cards/card_archived`), {
      id: 'card_archived', schemaVersion: 1, workspaceId: ws, name: 'Antigo', brand: 'Elo', status: 'archived',
      closingDay: 5, dueDay: 15, limitTotalCents: 100_000, limitUsedCents: 0, createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`${base}/credit_card_purchases/ccp_1`), {
      id: 'ccp_1', schemaVersion: 1, workspaceId: ws, cardId: CARD, source: 'manual', status: 'active',
      description: 'Notebook', totalCents: 30_000, installmentsCount: 3, purchaseDate: '2026-10-02',
      createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`${base}/credit_card_purchases/ccp_2`), {
      id: 'ccp_2', schemaVersion: 1, workspaceId: ws, cardId: CARD, source: 'manual', status: 'active',
      description: 'Mercado', totalCents: 10_000, installmentsCount: 1, purchaseDate: '2026-09-10',
      createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`${base}/credit_card_invoices/${OPEN_INVOICE}`),
      invoiceDoc(ws, OPEN_INVOICE, '2026-11', 'open', 'unpaid', 10_000, 0));
    batch.set(db.doc(`${base}/credit_card_invoices/${CLOSED_INVOICE}`),
      invoiceDoc(ws, CLOSED_INVOICE, '2026-10', 'closed', 'partial', 20_000, 5_000));
    batch.set(db.doc(`${base}/credit_card_invoices/${OLD_INVOICE}`),
      invoiceDoc(ws, OLD_INVOICE, '2026-09', 'closed', 'paid', 10_000, 10_000));
    for (const [id, invoiceId, amountCents, status, createdAt] of [
      ['cce_1', OPEN_INVOICE, 10_000, 'active', '2026-10-02T12:00:00.000Z'],
      ['cce_2', CLOSED_INVOICE, 10_000, 'active', '2026-10-02T12:00:01.000Z'],
      ['cce_3', CLOSED_INVOICE, 10_000, 'active', '2026-09-10T12:00:00.000Z'],
      ['cce_4', CLOSED_INVOICE, 4_000, 'cancelled', '2026-09-11T12:00:00.000Z'],
    ]) {
      batch.set(db.doc(`${base}/credit_card_invoice_entries/${id}`), {
        id, schemaVersion: 1, workspaceId: ws, cardId: CARD, invoiceId, purchaseId: 'ccp_1', kind: 'installment',
        amountCents, status, createdAt: ts(createdAt),
      });
    }
    batch.set(db.doc(`${base}/credit_card_invoice_payments/ccpay_1`), {
      id: 'ccpay_1', schemaVersion: 1, workspaceId: ws, cardId: CARD, invoiceId: CLOSED_INVOICE, kind: 'payment',
      amountCents: 5_000, cashAccountId: 'acc_main', paymentDate: '2026-10-04', status: 'active',
      createdAt: ts('2026-10-04T12:00:00.000Z'),
    });
    batch.set(db.doc(`${base}/credit_card_limit_ledger/ccl_1`), {
      id: 'ccl_1', schemaVersion: 1, workspaceId: ws, cardId: CARD, kind: 'purchase', amountCents: 30_000,
      createdAt: ts(),
    });
    batch.set(db.doc(`${base}/credit_card_events/credit_card_created_1`), {
      id: 'credit_card_created_1', schemaVersion: 1, workspaceId: ws, cardId: CARD, operation: 'createCreditCard',
      actorId: users.ownerA.uid, intentId: 'intent-1', occurredAt: ts(), createdAt: ts(),
    });
    batch.set(db.doc(`${base}/transactions/cccash_1`), {
      type: 'despesa', description: 'Pagamento de fatura', category: 'Fatura de cartão', valueCents: 5_000,
      date: '2026-10-04', isPaid: true, workspaceId: ws, profileId: ws, userId: users.ownerA.uid,
      cashAccountId: 'acc_main', creditCardPaymentEntry: {version: 1, cardId: CARD, invoiceId: CLOSED_INVOICE,
        paymentId: 'ccpay_1', amountCents: 5_000, direction: 'payment'},
      createdAt: ts(), updatedAt: ts(),
    });
    // Espelho só com a marca (sem `valueCents` nem `cashAccountId`): a marca
    // sozinha já o tira do alcance do cliente.
    batch.set(db.doc(`${base}/transactions/cccash_marker`), {
      type: 'despesa', description: 'Pagamento de fatura', category: 'Fatura de cartão', value: 50,
      date: '2026-10-04', isPaid: true, workspaceId: ws, profileId: ws, userId: users.memberA.uid,
      creditCardPaymentEntry: {version: 1, cardId: CARD, invoiceId: CLOSED_INVOICE, paymentId: 'ccpay_1',
        amountCents: 5_000, direction: 'payment'},
      createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`${base}/transactions/plain_1`), {
      type: 'despesa', description: 'Mercado', category: 'Casa', value: 50, date: '2026-10-01',
      workspaceId: ws, profileId: ws, userId: users.memberA.uid, createdAt: ts(), updatedAt: ts(),
    });
    await batch.commit();
  }
};

const signedClient = async (user, suffix) => {
  const app = initializeApp(
    {apiKey: 'rules-test', projectId},
    `p4a-${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
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

test('P4-A Rules — nenhum papel cria, altera ou apaga cartões, compras, faturas, parcelas, pagamentos, limite ou auditoria', async () => {
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA', 'ownerB'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const coll of COLLECTIONS) {
        const base = `workspaces/${wsA}/${coll}`;
        await denied(setDoc(doc(db, `${base}/novo-${name}`), {
          schemaVersion: 1, workspaceId: wsA, cardId: CARD, invoiceId: OPEN_INVOICE, name: 'Forjado', brand: 'Visa',
          status: 'active', closingDay: 25, dueDay: 28, limitTotalCents: 999_999_999, limitUsedCents: 0,
          amountCents: -999_999, kind: 'payment', cycleStatus: 'closed', paymentStatus: 'paid',
          createdBy: users[name].uid, updatedAt: serverTimestamp(),
        }), `${name} cria em ${coll}`);
        await denied(updateDoc(doc(db, `${base}/${existingId[coll]}`), {limitUsedCents: 0, paymentStatus: 'paid'}),
          `${name} altera ${coll}`);
        await denied(setDoc(doc(db, `${base}/${existingId[coll]}`), {status: 'cancelled'}, {merge: true}),
          `${name} sobrescreve ${coll}`);
        await denied(deleteDoc(doc(db, `${base}/${existingId[coll]}`)), `${name} apaga ${coll}`);
      }
      // Fechar, pagar ou marcar atraso pelo cliente: negado.
      const invoice = doc(db, `workspaces/${wsA}/credit_card_invoices/${OPEN_INVOICE}`);
      await denied(updateDoc(invoice, {cycleStatus: 'closed'}), `${name} fecha fatura`);
      await denied(updateDoc(invoice, {paymentStatus: 'overdue'}), `${name} grava overdue`);
      await denied(updateDoc(doc(db, `workspaces/${wsA}/credit_cards/${CARD}`), {status: 'archived'}),
        `${name} arquiva cartão sem callable`);
      const batch = writeBatch(db);
      batch.update(doc(db, `workspaces/${wsA}/credit_cards/${CARD}`), {limitTotalCents: 1});
      batch.set(doc(db, `workspaces/${wsA}/credit_card_invoice_entries/lote-${name}`), {amountCents: 1});
      await denied(batch.commit(), `${name} grava em lote`);
    }
  });
  const db = getAdmin().firestore();
  const card = await db.doc(`workspaces/${wsA}/credit_cards/${CARD}`).get();
  assert.equal(card.get('limitTotalCents'), 500_000);
  assert.equal(card.get('limitUsedCents'), 30_000);
  assert.equal((await db.doc(`workspaces/${wsA}/credit_card_invoices/${OPEN_INVOICE}`).get()).get('cycleStatus'), 'open');
  assert.equal((await db.collection(`workspaces/${wsA}/credit_card_invoice_entries`).get()).size, 4);
});

test('P4-A Rules — cartões, faturas, parcelas, pagamentos e compras: leitura de membros, nas consultas do frontend', async () => {
  await withClients(['ownerA', 'memberA', 'viewerA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const coll = (path) => collection(db, 'workspaces', wsA, path);
      for (const path of SHARED) {
        assert.equal((await getDoc(doc(db, `workspaces/${wsA}/${path}/${existingId[path]}`))).exists(), true,
          `${name} lê ${path}`);
      }
      // Cartões por nome, ativos e arquivados (o backend não passa de 50).
      assert.deepEqual(ids(await getDocs(query(coll('credit_cards'), orderBy('name'), orderBy(documentId()), limit(50)))),
        ['card_archived', CARD]);
      // Faturas abertas e fechadas paginadas (a sonda +1 do frontend).
      assert.deepEqual(ids(await getDocs(query(coll('credit_card_invoices'), where('cardId', '==', CARD),
        where('cycleStatus', '==', 'open'), orderBy('competenceMonth', 'asc'), limit(62)))), [OPEN_INVOICE]);
      const closedFirst = await getDocs(query(coll('credit_card_invoices'), where('cardId', '==', CARD),
        where('cycleStatus', '==', 'closed'), orderBy('competenceMonth', 'desc'), limit(1)));
      assert.deepEqual(ids(closedFirst), [CLOSED_INVOICE]);
      assert.deepEqual(ids(await getDocs(query(coll('credit_card_invoices'), where('cardId', '==', CARD),
        where('cycleStatus', '==', 'closed'), orderBy('competenceMonth', 'desc'),
        startAfter(closedFirst.docs[0]), limit(13)))), [OLD_INVOICE], 'próxima página de fechadas');
      // Lançamentos ativos da fatura, pagamentos, compras por ID e recentes.
      assert.deepEqual(ids(await getDocs(query(coll('credit_card_invoice_entries'), where('invoiceId', '==', CLOSED_INVOICE),
        where('status', '==', 'active'), orderBy('createdAt', 'asc'), limit(501)))), ['cce_3', 'cce_2']);
      assert.deepEqual(ids(await getDocs(query(coll('credit_card_invoice_payments'), where('invoiceId', '==', CLOSED_INVOICE),
        orderBy('createdAt', 'desc'), limit(501)))), ['ccpay_1']);
      assert.deepEqual(ids(await getDocs(query(coll('credit_card_purchases'), where(documentId(), 'in', ['ccp_1', 'ccp_2']),
        limit(30)))).sort(), ['ccp_1', 'ccp_2']);
      assert.deepEqual(ids(await getDocs(query(coll('credit_card_purchases'), where('cardId', '==', CARD),
        orderBy('purchaseDate', 'desc'), limit(11)))), ['ccp_1', 'ccp_2']);
      // Relatórios: período por data e faturas com saldo por vencimento.
      assert.deepEqual(ids(await getDocs(query(coll('credit_card_purchases'), where('purchaseDate', '>=', '2026-10-01'),
        where('purchaseDate', '<=', '2026-10-31'), orderBy('purchaseDate', 'desc'), limit(501)))), ['ccp_1']);
      assert.deepEqual(ids(await getDocs(query(coll('credit_card_invoice_payments'), where('paymentDate', '>=', '2026-10-01'),
        orderBy('paymentDate', 'desc'), limit(501)))), ['ccpay_1']);
      assert.deepEqual(ids(await getDocs(query(coll('credit_card_invoices'), where('paymentStatus', 'in', ['unpaid', 'partial']),
        orderBy('dueDate', 'asc'), limit(501)))), [CLOSED_INVOICE, OPEN_INVOICE]);
      assert.deepEqual(ids(await getDocs(query(coll('credit_card_limit_ledger'), where('cardId', '==', CARD), limit(201)))),
        ['ccl_1']);
      // Sem teto ou acima dele: negado (nem a regra genérica concede).
      await denied(getDocs(query(coll('credit_cards'), orderBy('name'))), `${name} lista cartões sem teto`);
      await denied(getDocs(query(coll('credit_cards'), limit(51))), `${name} lista cartões acima do teto`);
      for (const path of ['credit_card_purchases', 'credit_card_invoices', 'credit_card_invoice_entries',
        'credit_card_invoice_payments']) {
        await denied(getDocs(query(coll(path))), `${name} lista ${path} sem teto`);
        await denied(getDocs(query(coll(path), limit(502))), `${name} lista ${path} acima do teto`);
      }
      await denied(getDocs(query(coll('credit_card_limit_ledger'), limit(202))), `${name} razão acima do teto`);
    }
  });
});

test('P4-A Rules — auditoria de cartões: só owner/admin, com teto de listagem', async () => {
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA', 'ownerB'], async (clients) => {
    const path = 'credit_card_events';
    for (const name of ['ownerA', 'adminA']) {
      const {db} = clients[name];
      assert.equal((await getDoc(doc(db, `workspaces/${wsA}/${path}/${existingId[path]}`))).exists(), true);
      assert.deepEqual(ids(await getDocs(query(collection(db, 'workspaces', wsA, path), where('cardId', '==', CARD),
        orderBy('occurredAt', 'desc'), limit(21)))), [existingId[path]]);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, path))), `${name} sem teto`);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, path), limit(51))), `${name} acima do teto`);
    }
    for (const name of ['memberA', 'viewerA', 'ownerB']) {
      const {db} = clients[name];
      await denied(getDoc(doc(db, `workspaces/${wsA}/${path}/${existingId[path]}`)), `${name} lê auditoria`);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, path), limit(10))), `${name} lista auditoria`);
    }
  });
});

test('P4-A Rules — o cliente não forja nem edita o espelho de pagamento de fatura', async () => {
  await withClients(['ownerA', 'memberA'], async (clients) => {
    for (const name of ['ownerA', 'memberA']) {
      const {db} = clients[name];
      const transactions = collection(db, 'workspaces', wsA, 'transactions');
      const base = {
        type: 'despesa', description: 'Forjado', category: 'Casa', value: 10, date: '2026-10-01',
        workspaceId: wsA, profileId: wsA, userId: users[name].uid,
      };
      // P4-D: nem o lançamento comum do cliente é aceito.
      await denied(addDoc(transactions, base), `${name} cria lançamento comum`);
      await denied(addDoc(transactions, {...base, creditCardPaymentEntry: {version: 1, cardId: CARD,
        invoiceId: CLOSED_INVOICE, paymentId: 'ccpay_x', amountCents: 1_000, direction: 'payment'}}),
      `${name} forja espelho de pagamento`);
      await denied(setDoc(doc(db, `workspaces/${wsA}/transactions/cccash_forjado-${name}`),
        {...base, creditCardPaymentEntry: {version: 1}}), `${name} cria espelho com ID determinístico`);
      for (const key of ['creditCardInvoiceId', 'creditCardPurchaseId', 'creditCardInstallment']) {
        await denied(addDoc(transactions, {...base, [key]: 'x'}), `${name} grava chave de compatibilidade ${key}`);
      }
      await denied(updateDoc(doc(db, `workspaces/${wsA}/transactions/plain_1`), {creditCardPaymentEntry: {version: 1}}),
        `${name} transforma lançamento comum em espelho`);
      await denied(updateDoc(doc(db, `workspaces/${wsA}/transactions/cccash_1`), {valueCents: 1}),
        `${name} altera o espelho do backend`);
      await denied(deleteDoc(doc(db, `workspaces/${wsA}/transactions/cccash_1`)), `${name} apaga o espelho`);
    }
    // Baixa lógica: negada no lançamento comum do autor (P4-D: a anulação é
    // callable do caixa) e no espelho que só tem a marca.
    const {db} = clients.memberA;
    const voidOf = {voidedAt: serverTimestamp(), voidedBy: users.memberA.uid, voidReason: 'Teste', updatedAt: serverTimestamp()};
    await denied(updateDoc(doc(db, `workspaces/${wsA}/transactions/plain_1`), voidOf), 'baixa do lançamento comum');
    await denied(updateDoc(doc(db, `workspaces/${wsA}/transactions/cccash_marker`), voidOf),
      'baixa do espelho marcado');
    await denied(updateDoc(doc(db, `workspaces/${wsA}/transactions/cccash_marker`), {description: 'Editado'}),
      'edição do espelho marcado');
  });
  const mirror = await getAdmin().firestore().doc(`workspaces/${wsA}/transactions/cccash_1`).get();
  assert.equal(mirror.get('valueCents'), 5_000);
  const marker = await getAdmin().firestore().doc(`workspaces/${wsA}/transactions/cccash_marker`).get();
  assert.equal(marker.get('voidedAt'), undefined);
  assert.equal(marker.get('description'), 'Pagamento de fatura');
});

test('P4-A Rules — isolamento nos dois sentidos, membro removido e sem autenticação', async () => {
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA', 'removedA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const coll of COLLECTIONS) {
        await denied(getDoc(doc(db, `workspaces/${wsB}/${coll}/${existingId[coll]}`)), `${name} lê ${coll} de B`);
        await denied(getDocs(query(collection(db, 'workspaces', wsB, coll), limit(10))), `${name} lista ${coll} de B`);
        await denied(updateDoc(doc(db, `workspaces/${wsB}/${coll}/${existingId[coll]}`), {amountCents: 1}),
          `${name} altera ${coll} de B`);
        await denied(setDoc(doc(db, `workspaces/${wsB}/${coll}/forjado-${name}`), {workspaceId: wsB, amountCents: 1}),
          `${name} cria em ${coll} de B`);
      }
    }
    const {db} = clients.removedA;
    for (const coll of COLLECTIONS) {
      await denied(getDoc(doc(db, `workspaces/${wsA}/${coll}/${existingId[coll]}`)), `removido lê ${coll}`);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, coll), limit(10))), `removido lista ${coll}`);
    }
  });
  await withClients(['ownerB'], async ({ownerB}) => {
    for (const coll of COLLECTIONS) {
      await denied(getDoc(doc(ownerB.db, `workspaces/${wsA}/${coll}/${existingId[coll]}`)), `B lê ${coll} de A`);
      await denied(getDocs(query(collection(ownerB.db, 'workspaces', wsA, coll), limit(10))), `B lista ${coll} de A`);
    }
  });
  const app = initializeApp({apiKey: 'rules-test', projectId}, `p4a-anon-${Date.now().toString(36)}`);
  try {
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    for (const coll of COLLECTIONS) {
      await denied(getDoc(doc(db, `workspaces/${wsA}/${coll}/${existingId[coll]}`)), `anônimo lê ${coll}`);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, coll), limit(10))), `anônimo lista ${coll}`);
      await denied(setDoc(doc(db, `workspaces/${wsA}/${coll}/anonimo`), {amountCents: 1}), `anônimo cria em ${coll}`);
    }
  } finally {
    await deleteApp(app);
  }
  const adminDb = getAdmin().firestore();
  assert.equal((await adminDb.doc(`workspaces/${wsB}/credit_cards/${CARD}`).get()).get('limitUsedCents'), 30_000);
  assert.equal((await adminDb.collection(`workspaces/${wsB}/credit_card_invoice_entries`).get()).size, 4);
});
