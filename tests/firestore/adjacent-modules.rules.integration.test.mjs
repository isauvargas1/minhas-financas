import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {initializeApp, deleteApp} from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  count,
  documentId,
  getAggregateFromServer,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  startAfter,
  sum,
  where,
} from 'firebase/firestore';

/**
 * Consultas dos módulos adjacentes contra as Rules reais.
 *
 * As telas de empréstimo deixaram de somar a coleção inteira em memória e
 * passaram a pedir agregados ao servidor (`sum`, `count`). Agregado é uma
 * forma de consulta com avaliação própria pelas Rules: uma regra que dependa
 * de `resource.data` recusa a agregação inteira, e o resultado da recusa não
 * é um erro na tela — é `undefined` virando zero, isto é, um indicador
 * financeiro exibindo R$ 0,00 como se fosse o saldo.
 *
 * Estes testes exercitam a **forma exata** das consultas novas com um cliente
 * autenticado, nos dois sentidos do isolamento.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules dos módulos adjacentes.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-adjacent-123456';

const ownerA = {uid: 'adj-owner-a', email: 'adj-owner-a@example.test'};
const ownerB = {uid: 'adj-owner-b', email: 'adj-owner-b@example.test'};
const workspaceA = 'adj-workspace-a';
const workspaceB = 'adj-workspace-b';

/** Saldo aberto do schema autoritativo: `paid` e `cancelled` ficam de fora. */
const OPEN = ['active', 'overdue'];
/** Contratos semeados por workspace; acima de uma página de 3. */
const LOANS = 7;

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const seed = async () => {
  const firebaseAdmin = getAdmin();
  const db = firebaseAdmin.firestore();
  for (const user of [ownerA, ownerB]) {
    try {
      await firebaseAdmin.auth().deleteUser(user.uid);
    } catch (error) {
      if (error?.code !== 'auth/user-not-found') throw error;
    }
    await firebaseAdmin.auth().createUser({...user, password, emailVerified: true});
    // P1: a autorização exige perfil de conta ativo (gravado pelo backend).
    await db.doc(`users/${user.uid}`).set({uid: user.uid, status: 'active'});
  }
  for (const [workspaceId, owner] of [[workspaceA, ownerA], [workspaceB, ownerB]]) {
    await db.recursiveDelete(db.doc(`workspaces/${workspaceId}`));
    await db.doc(`workspaces/${workspaceId}`).set({
      ownerId: owner.uid, type: 'PJ', name: workspaceId, status: 'active',
    });
    await db.doc(`workspaces/${workspaceId}/members/${owner.uid}`)
      .set({uid: owner.uid, role: 'owner', status: 'active'});

    const batch = db.batch();
    for (let index = 0; index < LOANS; index += 1) {
      const status = index === 0 ? 'paid' : index === 6 ? 'cancelled' : 'active';
      batch.set(db.doc(`workspaces/${workspaceId}/loans/loan-${index}`), {
        schemaVersion: 1,
        type: index % 2 === 0 ? 'lend' : 'borrow',
        status,
        personName: `Contraparte ${index}`,
        description: 'Contrato de teste',
        principalCents: 10_000,
        balanceCents: status === 'paid' ? 0 : 10_000,
        startDate: '2026-01-01',
      });
    }
    // Rateio de um título (P4-C), para a consulta por título.
    batch.set(db.doc(`workspaces/${workspaceId}/split_bills/bill-1`), {
      groupId: 'grupo-1', amountCents: 10_000, status: 'open',
    });
    batch.set(db.doc(`workspaces/${workspaceId}/split_shares/share-1`), {
      billId: 'bill-1', participantId: 'p1', amountDueCents: 5_000,
      status: 'open',
    });
    batch.set(db.doc(`workspaces/${workspaceId}/recurring_expenses/rec-1`), {
      schemaVersion: 1, name: 'Assinatura', status: 'active',
      frequency: 'monthly', amountCents: 1_000, nextDueDate: '2099-01-10',
    });
    await batch.commit();
  }
};

const signedClient = async (user, suffix) => {
  const app = initializeApp({apiKey: 'rules-test', projectId}, `adj-${suffix}-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  await signInWithEmailAndPassword(auth, user.email, password);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {app, db};
};

const withClients = async (run) => {
  const clientA = await signedClient(ownerA, `a-${Math.random().toString(36).slice(2, 8)}`);
  const clientB = await signedClient(ownerB, `b-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await run(clientA, clientB);
  } finally {
    await Promise.all([deleteApp(clientA.app), deleteApp(clientB.app)]);
  }
};

const loansOf = (db, workspaceId) => collection(db, 'workspaces', workspaceId, 'loans');

test('o agregado de saldo dos empréstimos é permitido e exato', async () => {
  await seed();
  await withClients(async (clientA) => {
    const aggregate = await getAggregateFromServer(
      query(
        loansOf(clientA.db, workspaceA),
        where('type', '==', 'lend'),
        where('status', 'in', OPEN),
      ),
      {total: sum('balanceCents')},
    );
    // `loan-0` é `lend` e `paid`; `loan-6` é `lend` e `cancelled`, com saldo
    // residual: ambos ficam de fora. Sobram `loan-2` e `loan-4`.
    assert.equal(aggregate.data().total, 20_000);

    const overdue = await getAggregateFromServer(
      query(loansOf(clientA.db, workspaceA), where('status', '==', 'overdue')),
      {total: count()},
    );
    assert.equal(overdue.data().total, 0);
  });
});

test('o agregado não atravessa a fronteira do workspace', async () => {
  await seed();
  await withClients(async (clientA, clientB) => {
    await assert.rejects(() => getAggregateFromServer(
      query(
        loansOf(clientA.db, workspaceB),
        where('type', '==', 'lend'),
        where('status', 'in', OPEN),
      ),
      {total: sum('balanceCents')},
    ));
    await assert.rejects(() => getAggregateFromServer(
      query(
        loansOf(clientB.db, workspaceA),
        where('type', '==', 'lend'),
        where('status', 'in', OPEN),
      ),
      {total: sum('balanceCents')},
    ));
  });
});

test('a listagem paginada de empréstimos respeita a fronteira e o cursor', async () => {
  await seed();
  await withClients(async (clientA, clientB) => {
    const first = await getDocs(query(
      loansOf(clientA.db, workspaceA),
      orderBy(documentId()),
      limit(4),
    ));
    assert.equal(first.size, 4);

    const second = await getDocs(query(
      loansOf(clientA.db, workspaceA),
      orderBy(documentId()),
      startAfter(first.docs[first.docs.length - 1].id),
      limit(4),
    ));
    // 7 contratos, páginas de 3 úteis: a segunda traz o resto, sem repetir.
    assert.equal(second.size, LOANS - 4);
    const ids = new Set([...first.docs, ...second.docs].map((entry) => entry.id));
    assert.equal(ids.size, LOANS);

    await assert.rejects(() => getDocs(query(
      loansOf(clientB.db, workspaceA),
      orderBy(documentId()),
      limit(4),
    )));
  });
});

test('a consulta de rateios de um título é permitida, limitada e isolada', async () => {
  await seed();
  await withClients(async (clientA, clientB) => {
    const shares = await getDocs(query(
      collection(clientA.db, 'workspaces', workspaceA, 'split_shares'),
      where('billId', '==', 'bill-1'),
      limit(51),
    ));
    assert.equal(shares.size, 1);
    assert.equal(shares.docs[0].get('billId'), 'bill-1');

    // P4-C: acima do teto (50 rateios por título + sonda), negada.
    await assert.rejects(() => getDocs(query(
      collection(clientA.db, 'workspaces', workspaceA, 'split_shares'),
      where('billId', '==', 'bill-1'),
      limit(52),
    )));
    await assert.rejects(() => getDocs(query(
      collection(clientB.db, 'workspaces', workspaceA, 'split_shares'),
      where('billId', '==', 'bill-1'),
      limit(51),
    )));
  });
});

test('a consulta de assinaturas ativas é permitida e isolada', async () => {
  await seed();
  await withClients(async (clientA, clientB) => {
    const active = await getDocs(query(
      collection(clientA.db, 'workspaces', workspaceA, 'recurring_expenses'),
      where('status', '==', 'active'),
      orderBy(documentId()),
      limit(501),
    ));
    assert.equal(active.size, 1);

    await assert.rejects(() => getDocs(query(
      collection(clientB.db, 'workspaces', workspaceA, 'recurring_expenses'),
      where('status', '==', 'active'),
      orderBy(documentId()),
      limit(501),
    )));
  });
});
