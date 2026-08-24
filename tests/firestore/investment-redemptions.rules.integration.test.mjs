import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {deleteApp, initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getDoc,
  getFirestore,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (!enabled) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules de resgate.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-password-123456';

const users = {
  ownerA: {uid: 'redemption-rules-owner-a', email: 'redemption-rules-owner-a@example.test'},
  ownerB: {uid: 'redemption-rules-owner-b', email: 'redemption-rules-owner-b@example.test'},
  adminA: {uid: 'redemption-rules-admin-a', email: 'redemption-rules-admin-a@example.test'},
  memberA: {uid: 'redemption-rules-member-a', email: 'redemption-rules-member-a@example.test'},
  removedA: {uid: 'redemption-rules-removed-a', email: 'redemption-rules-removed-a@example.test'},
};
const workspaceA = 'redemption-rules-workspace-a';
const workspaceB = 'redemption-rules-workspace-b';

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

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
  }
  await Promise.all([
    db.recursiveDelete(db.doc(`workspaces/${workspaceA}`)),
    db.recursiveDelete(db.doc(`workspaces/${workspaceB}`)),
  ]);
  await db.doc(`workspaces/${workspaceA}`).set({ownerId: users.ownerA.uid, type: 'PF'});
  await db.doc(`workspaces/${workspaceB}`).set({ownerId: users.ownerB.uid, type: 'PJ'});
  await Promise.all([
    db.doc(`workspaces/${workspaceA}/members/${users.ownerA.uid}`).set({uid: users.ownerA.uid, role: 'owner', status: 'active'}),
    db.doc(`workspaces/${workspaceA}/members/${users.adminA.uid}`).set({uid: users.adminA.uid, role: 'admin', status: 'active'}),
    db.doc(`workspaces/${workspaceA}/members/${users.memberA.uid}`).set({uid: users.memberA.uid, role: 'member', status: 'active'}),
    db.doc(`workspaces/${workspaceA}/members/${users.removedA.uid}`).set({uid: users.removedA.uid, role: 'member', status: 'removed'}),
    db.doc(`workspaces/${workspaceB}/members/${users.ownerB.uid}`).set({uid: users.ownerB.uid, role: 'owner', status: 'active'}),
  ]);
  const contribution = {
    type: 'investimento', description: 'Aporte protegido', category: 'CDB', value: 100,
    valueCents: 10000, date: '2026-08-01', userId: users.ownerA.uid,
    workspaceId: workspaceA, redeemedPrincipalCents: 4000, remainingPrincipalCents: 6000,
  };
  const redemption = {
    type: 'investimento', description: 'Resgate protegido', category: 'CDB', value: 43.5,
    valueCents: 4350, date: '2026-08-18', userId: users.ownerA.uid, workspaceId: workspaceA,
    investmentMetadata: {
      currency: 'BRL',
      investmentOperation: 'redemption', cashImpact: 'inflow', investmentImpact: 'decrease',
      principalCents: 4000, gainCents: 500, feesCents: 50, taxCents: 100,
      status: 'settled', sourceMovementId: 'source-a', idempotencyKey: 'server-key-00000001',
    },
  };
  await Promise.all([
    db.doc(`workspaces/${workspaceA}/transactions/source-a`).set(contribution),
    db.doc(`workspaces/${workspaceA}/transactions/redemption-a`).set(redemption),
    db.doc(`workspaces/${workspaceB}/transactions/redemption-b`).set({...redemption, workspaceId: workspaceB, userId: users.ownerB.uid}),
    db.doc(`workspaces/${workspaceA}/investment_audit_logs/audit-a`).set({
      workspaceId: workspaceA,
      profileType: 'PF',
      actorId: users.ownerA.uid,
      actorRole: 'owner',
      operation: 'saveInvestmentRedemption',
      targetId: 'redemption-a',
      correlationId: 'audit-a',
      details: {},
      timestamp: firebaseAdmin.firestore.Timestamp.fromDate(new Date('2026-08-18T12:00:00.000Z')),
    }),
    db.doc(`workspaces/${workspaceA}/investment_idempotency_keys/key-a`).set({status: 'completed'}),
    // M3.B: documento cujo único marcador de investimento é `settlementDate`.
    // Antes do M3 o pré-teste de update e o de delete não citavam esse campo,
    // então ele permanecia editável e apagável pelo cliente.
    db.doc(`workspaces/${workspaceA}/transactions/settlement-only-a`).set({
      type: 'investimento', description: 'Liquidação protegida', category: 'CDB',
      value: 10, valueCents: 1000, date: '2026-08-18', userId: users.ownerA.uid,
      workspaceId: workspaceA,
      settlementDate: firebaseAdmin.firestore.Timestamp.fromDate(
        new Date('2026-08-18T12:00:00.000Z'),
      ),
    }),
  ]);
};

const signedClient = async (user, suffix) => {
  const app = initializeApp({apiKey: 'rules-test', projectId}, `redemption-rules-${suffix}-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  await signInWithEmailAndPassword(auth, user.email, password);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {app, db};
};

const anonymousClient = (suffix) => {
  const app = initializeApp({apiKey: 'rules-test', projectId}, `redemption-rules-${suffix}-${Date.now()}`);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {app, db};
};

const withClients = async (names, run) => {
  const clients = {};
  try {
    for (const name of names) {
      clients[name] = await signedClient(users[name], `${name}-${Math.random().toString(36).slice(2, 8)}`);
    }
    await run(clients);
  } finally {
    await Promise.all(Object.values(clients).map((client) => deleteApp(client.app)));
  }
};

test('resgate é legível por owner, admin e member do próprio workspace', async () => {
  await seed();
  await withClients(['ownerA', 'adminA', 'memberA'], async ({ownerA, adminA, memberA}) => {
    for (const client of [ownerA, adminA, memberA]) {
      const snapshot = await getDoc(doc(client.db, `workspaces/${workspaceA}/transactions/redemption-a`));
      assert.equal(snapshot.exists(), true);
    }
  });
});

test('resgate é isolado entre tenants, removidos e anônimos', async () => {
  await seed();
  await withClients(['ownerA', 'ownerB', 'removedA'], async ({ownerA, ownerB, removedA}) => {
    const anonymous = anonymousClient('anonymous');
    try {
      await assert.rejects(() => getDoc(doc(ownerA.db, `workspaces/${workspaceB}/transactions/redemption-b`)));
      await assert.rejects(() => getDoc(doc(ownerB.db, `workspaces/${workspaceA}/transactions/redemption-a`)));
      await assert.rejects(() => getDoc(doc(removedA.db, `workspaces/${workspaceA}/transactions/redemption-a`)));
      await assert.rejects(() => getDoc(doc(anonymous.db, `workspaces/${workspaceA}/transactions/redemption-a`)));
    } finally {
      await deleteApp(anonymous.app);
    }
  });
});

test('cliente não forja metadata de investimento nem workspace alheio', async () => {
  await seed();
  await withClients(['ownerA', 'memberA'], async ({ownerA, memberA}) => {
    await assert.rejects(() => setDoc(
      doc(ownerA.db, `workspaces/${workspaceA}/transactions/forged-redemption`),
      {
        type: 'investimento', description: 'Forjado', category: 'CDB', value: 100,
        date: '2026-08-18', userId: users.ownerA.uid, workspaceId: workspaceA,
        investmentMetadata: {investmentOperation: 'redemption'},
      },
    ));
    await assert.rejects(() => setDoc(
      doc(memberA.db, `workspaces/${workspaceA}/transactions/forged-workspace`),
      {
        type: 'investimento', description: 'Workspace forjado', category: 'CDB', value: 10,
        date: '2026-08-18', userId: users.memberA.uid, workspaceId: workspaceB,
      },
    ));
    await assert.rejects(() => setDoc(
      doc(ownerA.db, `workspaces/${workspaceA}/transactions/forged-settlement`),
      {
        type: 'investimento', description: 'Liquidação forjada', category: 'CDB', value: 10,
        date: '2026-08-18', userId: users.ownerA.uid, workspaceId: workspaceA,
        settlementDate: '2026-08-18',
      },
    ));
  });
});

test('cliente não escala o próprio papel', async () => {
  await seed();
  await withClients(['memberA'], async ({memberA}) => {
    await assert.rejects(() => updateDoc(
      doc(memberA.db, `workspaces/${workspaceA}/members/${users.memberA.uid}`),
      {role: 'owner'},
    ));
  });
});

test('saldos de principal e histórico de resgate não são editáveis nem apagáveis', async () => {
  await seed();
  await withClients(['ownerA'], async ({ownerA}) => {
    await assert.rejects(() => updateDoc(
      doc(ownerA.db, `workspaces/${workspaceA}/transactions/source-a`),
      {redeemedPrincipalCents: 0, remainingPrincipalCents: 10000},
    ));
    await assert.rejects(() => deleteDoc(doc(ownerA.db, `workspaces/${workspaceA}/transactions/source-a`)));
    await assert.rejects(() => deleteDoc(doc(ownerA.db, `workspaces/${workspaceA}/transactions/redemption-a`)));
  });
});

test('documento marcado apenas por settlementDate não é editável nem apagável', async () => {
  await seed();
  await withClients(['ownerA'], async ({ownerA}) => {
    const ref = doc(ownerA.db, `workspaces/${workspaceA}/transactions/settlement-only-a`);
    await assert.rejects(
      () => updateDoc(ref, {description: 'Editado pelo cliente'}),
      'Update de documento com settlementDate precisa ser negado.',
    );
    await assert.rejects(
      () => deleteDoc(ref),
      'Hard delete de histórico financeiro precisa ser negado.',
    );
  });
});

test('trilha de auditoria é privilegiada e idempotência nunca é exposta', async () => {
  await seed();
  await withClients(['ownerA', 'adminA', 'memberA'], async ({ownerA, adminA, memberA}) => {
    assert.equal((await getDoc(doc(ownerA.db, `workspaces/${workspaceA}/investment_audit_logs/audit-a`))).exists(), true);
    assert.equal((await getDoc(doc(adminA.db, `workspaces/${workspaceA}/investment_audit_logs/audit-a`))).exists(), true);
    await assert.rejects(() => getDoc(doc(memberA.db, `workspaces/${workspaceA}/investment_audit_logs/audit-a`)));
    await assert.rejects(() => getDoc(doc(ownerA.db, `workspaces/${workspaceA}/investment_idempotency_keys/key-a`)));
  });
});
