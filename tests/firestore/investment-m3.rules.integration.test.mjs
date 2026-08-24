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
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules do M3.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-password-123456';

const users = {
  owner: {uid: 'm3-rules-owner', email: 'm3-rules-owner@example.test'},
  admin: {uid: 'm3-rules-admin', email: 'm3-rules-admin@example.test'},
  member: {uid: 'm3-rules-member', email: 'm3-rules-member@example.test'},
  outsider: {uid: 'm3-rules-outsider', email: 'm3-rules-outsider@example.test'},
};
const workspace = 'm3-rules-workspace';
const foreign = 'm3-rules-foreign-workspace';

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const ts = (iso) => getAdmin().firestore.Timestamp.fromDate(new Date(iso));

const movementBase = {
  workspaceId: workspace,
  profileType: 'PF',
  domainVersion: 2,
  calculationVersion: 'investment-v2-cents-micros-half-up',
  accountId: 'acc-1',
  assetId: 'ast-1',
  positionId: 'pos-1',
  operation: 'redemption',
  currency: 'BRL',
  description: 'Resgate M3',
  principalCents: 4000,
  gainCents: 0,
  feesCents: 0,
  taxCents: 0,
  quantityMicros: 400000,
  cashDeltaCents: 0,
  principalDeltaCents: 0,
  realizedGainDeltaCents: 0,
  feesDeltaCents: 0,
  taxDeltaCents: 0,
  quantityDeltaMicros: 0,
  goalNetContributionDeltaCents: 0,
  goalCurrentValueDeltaCents: 0,
  correlationId: 'corr-m3-rules',
  idempotencyKeyHash: 'hash-m3-rules',
  occurredAt: null,
  createdBy: 'backend',
  createdAt: null,
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
    db.recursiveDelete(db.doc(`workspaces/${workspace}`)),
    db.recursiveDelete(db.doc(`workspaces/${foreign}`)),
  ]);
  await db.doc(`workspaces/${workspace}`).set({ownerId: users.owner.uid, type: 'PF'});
  await db.doc(`workspaces/${foreign}`).set({ownerId: users.outsider.uid, type: 'PJ'});
  await Promise.all([
    db.doc(`workspaces/${workspace}/members/${users.owner.uid}`).set({uid: users.owner.uid, role: 'owner', status: 'active'}),
    db.doc(`workspaces/${workspace}/members/${users.admin.uid}`).set({uid: users.admin.uid, role: 'admin', status: 'active'}),
    db.doc(`workspaces/${workspace}/members/${users.member.uid}`).set({uid: users.member.uid, role: 'member', status: 'active'}),
    db.doc(`workspaces/${foreign}/members/${users.outsider.uid}`).set({uid: users.outsider.uid, role: 'owner', status: 'active'}),
  ]);

  const occurredAt = ts('2026-08-15T18:00:00.000Z');
  await Promise.all([
    // Movimento cancelado válido: deltas zerados e autoria do cancelamento.
    db.doc(`workspaces/${workspace}/investment_movements/cancelled-ok`).set({
      ...movementBase,
      id: 'cancelled-ok',
      status: 'cancelled',
      occurredAt,
      createdAt: occurredAt,
      cancelledAt: ts('2026-08-16T18:00:00.000Z'),
      cancelledBy: users.owner.uid,
      cancellationReason: 'Pedido desfeito',
    }),
    // Cancelado sem autoria: fora do contrato.
    db.doc(`workspaces/${workspace}/investment_movements/cancelled-no-author`).set({
      ...movementBase,
      id: 'cancelled-no-author',
      status: 'cancelled',
      occurredAt,
      createdAt: occurredAt,
      cancelledAt: ts('2026-08-16T18:00:00.000Z'),
    }),
    // Cancelado carregando delta financeiro: fora do contrato.
    db.doc(`workspaces/${workspace}/investment_movements/cancelled-with-delta`).set({
      ...movementBase,
      id: 'cancelled-with-delta',
      status: 'cancelled',
      occurredAt,
      createdAt: occurredAt,
      cancelledAt: ts('2026-08-16T18:00:00.000Z'),
      cancelledBy: users.owner.uid,
      principalDeltaCents: -4000,
    }),
    db.doc(`workspaces/${workspace}/investment_operational_metrics/2026-08-16_cancelInvestmentMovement_success`).set({
      id: '2026-08-16_cancelInvestmentMovement_success',
      workspaceId: workspace,
      date: '2026-08-16',
      domain: 'investment',
      operation: 'cancelInvestmentMovement',
      status: 'success',
      count: 1,
      updatedAt: ts('2026-08-16T18:00:00.000Z'),
    }),
    db.doc(`workspaces/${workspace}/investment_event_logs/failure-event`).set({
      id: 'failure-event',
      workspaceId: workspace,
      operation: 'createInvestmentContribution',
      entityType: 'operation',
      entityId: 'createInvestmentContribution',
      outcome: 'failed',
      details: {errorCode: 'domain_precondition_failed'},
      occurredAt: ts('2026-08-16T18:00:00.000Z'),
    }),
    db.doc(`workspaces/${workspace}/investment_snapshots/projection-rebuild-1`).set({
      id: 'projection-rebuild-1',
      workspaceId: workspace,
      profileType: 'PF',
      kind: 'projection_rebuild',
      targetId: workspace,
      status: 'running',
      cutoffAt: occurredAt,
      processedCount: 3,
      expectedProjectionVersion: 2,
      totals: {
        quantityMicros: 0,
        principalCents: 100000,
        realizedGainCents: 0,
        feesCents: 0,
        taxCents: 0,
        netContributionCents: 100000,
        currentValueCents: 100000,
      },
      pageSize: 50,
      calculationVersion: 'investment-v2-cents-micros-half-up',
      correlationId: 'corr-m3-rules',
      createdBy: 'backend',
      createdAt: occurredAt,
      updatedAt: occurredAt,
    }),
  ]);
};

const signedClient = async (user, suffix) => {
  const app = initializeApp({apiKey: 'rules-test', projectId}, `m3-rules-${suffix}-${Date.now()}-${Math.random()}`);
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
    for (const name of names) {
      clients[name] = await signedClient(users[name], name);
    }
    await run(clients);
  } finally {
    await Promise.all(Object.values(clients).map((client) => deleteApp(client.app)));
  }
};

test('movimento cancelado válido é legível pelo workspace', async () => {
  await seed();
  await withClients(['owner', 'member'], async ({owner, member}) => {
    for (const client of [owner, member]) {
      const snapshot = await getDoc(doc(client.db, `workspaces/${workspace}/investment_movements/cancelled-ok`));
      assert.equal(snapshot.exists(), true);
      assert.equal(snapshot.data().status, 'cancelled');
    }
  });
});

test('movimento cancelado fora do contrato é rejeitado na leitura', async () => {
  await seed();
  await withClients(['owner'], async ({owner}) => {
    await assert.rejects(
      () => getDoc(doc(owner.db, `workspaces/${workspace}/investment_movements/cancelled-no-author`)),
      'Cancelado sem autoria precisa ser rejeitado.',
    );
    await assert.rejects(
      () => getDoc(doc(owner.db, `workspaces/${workspace}/investment_movements/cancelled-with-delta`)),
      'Cancelado com delta financeiro precisa ser rejeitado.',
    );
  });
});

test('cliente não cancela movimento por escrita direta', async () => {
  await seed();
  await withClients(['owner', 'member'], async ({owner, member}) => {
    for (const client of [owner, member]) {
      await assert.rejects(() => updateDoc(
        doc(client.db, `workspaces/${workspace}/investment_movements/cancelled-ok`),
        {status: 'settled'},
      ));
      await assert.rejects(() => deleteDoc(
        doc(client.db, `workspaces/${workspace}/investment_movements/cancelled-ok`),
      ));
    }
  });
});

test('métrica operacional é privilegiada e nunca gravável pelo cliente', async () => {
  await seed();
  const path = `workspaces/${workspace}/investment_operational_metrics/2026-08-16_cancelInvestmentMovement_success`;
  await withClients(['owner', 'admin', 'member'], async ({owner, admin: adminClient, member}) => {
    assert.equal((await getDoc(doc(owner.db, path))).exists(), true);
    assert.equal((await getDoc(doc(adminClient.db, path))).exists(), true);
    await assert.rejects(
      () => getDoc(doc(member.db, path)),
      'Member não pode ler métricas operacionais.',
    );
    await assert.rejects(() => setDoc(doc(owner.db, path), {count: 999}, {merge: true}));
    await assert.rejects(() => deleteDoc(doc(owner.db, path)));
  });
});

test('evento de falha é legível por owner/admin e imutável', async () => {
  await seed();
  const path = `workspaces/${workspace}/investment_event_logs/failure-event`;
  await withClients(['owner', 'admin', 'member'], async ({owner, admin: adminClient, member}) => {
    assert.equal((await getDoc(doc(owner.db, path))).exists(), true);
    assert.equal((await getDoc(doc(adminClient.db, path))).exists(), true);
    await assert.rejects(() => getDoc(doc(member.db, path)));
    await assert.rejects(() => updateDoc(doc(owner.db, path), {outcome: 'completed'}));
    await assert.rejects(() => deleteDoc(doc(owner.db, path)));
  });
});

test('snapshot de reconstrução de projeções é aceito e privilegiado', async () => {
  await seed();
  const path = `workspaces/${workspace}/investment_snapshots/projection-rebuild-1`;
  await withClients(['owner', 'member'], async ({owner, member}) => {
    const snapshot = await getDoc(doc(owner.db, path));
    assert.equal(snapshot.exists(), true);
    assert.equal(snapshot.data().kind, 'projection_rebuild');
    await assert.rejects(() => getDoc(doc(member.db, path)));
    await assert.rejects(() => setDoc(doc(owner.db, path), {status: 'completed'}, {merge: true}));
  });
});

test('isolamento entre tenants vale para os documentos novos do M3', async () => {
  await seed();
  await withClients(['outsider'], async ({outsider}) => {
    for (const path of [
      `workspaces/${workspace}/investment_movements/cancelled-ok`,
      `workspaces/${workspace}/investment_operational_metrics/2026-08-16_cancelInvestmentMovement_success`,
      `workspaces/${workspace}/investment_event_logs/failure-event`,
      `workspaces/${workspace}/investment_snapshots/projection-rebuild-1`,
    ]) {
      await assert.rejects(
        () => getDoc(doc(outsider.db, path)),
        `Tenant estrangeiro não pode ler ${path}.`,
      );
    }
  });
});
