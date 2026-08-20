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

test('Rules isolam resgates e reservam metadata, saldos, auditoria e idempotência ao backend', async () => {
  await seed();
  const ownerA = await signedClient(users.ownerA, 'owner-a');
  const ownerB = await signedClient(users.ownerB, 'owner-b');
  const adminA = await signedClient(users.adminA, 'admin-a');
  const memberA = await signedClient(users.memberA, 'member-a');
  const removedA = await signedClient(users.removedA, 'removed-a');
  const anonymous = anonymousClient('anonymous');
  try {
    assert.equal((await getDoc(doc(ownerA.db, `workspaces/${workspaceA}/transactions/redemption-a`))).exists(), true);
    assert.equal((await getDoc(doc(adminA.db, `workspaces/${workspaceA}/transactions/redemption-a`))).exists(), true);
    assert.equal((await getDoc(doc(memberA.db, `workspaces/${workspaceA}/transactions/redemption-a`))).exists(), true);
    await assert.rejects(() => getDoc(doc(ownerA.db, `workspaces/${workspaceB}/transactions/redemption-b`)));
    await assert.rejects(() => getDoc(doc(ownerB.db, `workspaces/${workspaceA}/transactions/redemption-a`)));
    await assert.rejects(() => getDoc(doc(removedA.db, `workspaces/${workspaceA}/transactions/redemption-a`)));
    await assert.rejects(() => getDoc(doc(anonymous.db, `workspaces/${workspaceA}/transactions/redemption-a`)));

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
    await assert.rejects(() => updateDoc(
      doc(memberA.db, `workspaces/${workspaceA}/members/${users.memberA.uid}`),
      {role: 'owner'},
    ));
    await assert.rejects(() => updateDoc(
      doc(ownerA.db, `workspaces/${workspaceA}/transactions/source-a`),
      {redeemedPrincipalCents: 0, remainingPrincipalCents: 10000},
    ));
    await assert.rejects(() => deleteDoc(doc(ownerA.db, `workspaces/${workspaceA}/transactions/source-a`)));
    await assert.rejects(() => deleteDoc(doc(ownerA.db, `workspaces/${workspaceA}/transactions/redemption-a`)));

    assert.equal((await getDoc(doc(ownerA.db, `workspaces/${workspaceA}/investment_audit_logs/audit-a`))).exists(), true);
    assert.equal((await getDoc(doc(adminA.db, `workspaces/${workspaceA}/investment_audit_logs/audit-a`))).exists(), true);
    await assert.rejects(() => getDoc(doc(memberA.db, `workspaces/${workspaceA}/investment_audit_logs/audit-a`)));
    await assert.rejects(() => getDoc(doc(ownerA.db, `workspaces/${workspaceA}/investment_idempotency_keys/key-a`)));
  } finally {
    await Promise.all([ownerA, ownerB, adminA, memberA, removedA, anonymous].map(client => deleteApp(client.app)));
  }
});
