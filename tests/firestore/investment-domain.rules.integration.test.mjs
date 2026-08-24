import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {deleteApp, initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {
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
} from 'firebase/firestore';

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules do domínio M3.');
}

const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'investment-domain-rules-123456';
const workspaceA = 'investment-domain-rules-a';
const workspaceB = 'investment-domain-rules-b';
const users = {
  ownerA: {uid: 'investment-domain-owner-a', email: 'investment-domain-owner-a@example.test'},
  ownerB: {uid: 'investment-domain-owner-b', email: 'investment-domain-owner-b@example.test'},
  adminA: {uid: 'investment-domain-admin-a', email: 'investment-domain-admin-a@example.test'},
  memberA: {uid: 'investment-domain-member-a', email: 'investment-domain-member-a@example.test'},
  viewerA: {uid: 'investment-domain-viewer-a', email: 'investment-domain-viewer-a@example.test'},
  removedA: {uid: 'investment-domain-removed-a', email: 'investment-domain-removed-a@example.test'},
};
const workspaceWithoutMembership = 'investment-domain-owner-without-membership';

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
    db.recursiveDelete(db.doc(`workspaces/${workspaceWithoutMembership}`)),
  ]);
  await Promise.all([
    db.doc(`workspaces/${workspaceA}`).set({ownerId: users.ownerA.uid, type: 'PF'}),
    db.doc(`workspaces/${workspaceB}`).set({ownerId: users.ownerB.uid, type: 'PJ'}),
    db.doc(`workspaces/${workspaceWithoutMembership}`).set({ownerId: users.ownerA.uid, type: 'PF'}),
  ]);
  await Promise.all([
    db.doc(`workspaces/${workspaceA}/members/${users.ownerA.uid}`).set({uid: users.ownerA.uid, role: 'owner', status: 'active'}),
    db.doc(`workspaces/${workspaceA}/members/${users.adminA.uid}`).set({uid: users.adminA.uid, role: 'admin', status: 'active'}),
    db.doc(`workspaces/${workspaceA}/members/${users.memberA.uid}`).set({uid: users.memberA.uid, role: 'member', status: 'active'}),
    db.doc(`workspaces/${workspaceA}/members/${users.viewerA.uid}`).set({uid: users.viewerA.uid, role: 'viewer', status: 'active'}),
    db.doc(`workspaces/${workspaceA}/members/${users.removedA.uid}`).set({uid: users.removedA.uid, role: 'member', status: 'removed'}),
    db.doc(`workspaces/${workspaceB}/members/${users.ownerB.uid}`).set({uid: users.ownerB.uid, role: 'owner', status: 'active'}),
  ]);
  const now = firebaseAdmin.firestore.Timestamp.fromDate(new Date('2026-08-18T12:00:00.000Z'));
  const auditFields = {
    createdBy: users.ownerA.uid,
    createdAt: now,
    updatedBy: users.ownerA.uid,
    updatedAt: now,
  };
  const account = (id, workspaceId, profileType, actorId) => ({
    id, workspaceId, profileType, name: `Conta ${id}`,
    institutionName: 'Instituição Teste', currency: 'BRL', status: 'active',
    ...auditFields, createdBy: actorId, updatedBy: actorId,
  });
  const asset = (id, workspaceId, profileType, actorId) => ({
    id, workspaceId, profileType, name: `Ativo ${id}`, assetType: 'fixed_income',
    symbol: 'CDB', currency: 'BRL', status: 'active',
    ...auditFields, createdBy: actorId, updatedBy: actorId,
  });
  const position = (id, workspaceId, profileType, actorId) => ({
    id, workspaceId, profileType, accountId: 'account-1', assetId: 'asset-1',
    currency: 'BRL', status: 'active', quantityMicros: 1_000_000,
    principalCents: 10_000, realizedGainCents: 0, feesCents: 0, taxCents: 0,
    currentValueCents: 10_000, unrealizedAppreciationCents: 0,
    calculationVersion: 'investment-v2-cents-micros-half-up', version: 1,
    ...auditFields, createdBy: actorId, updatedBy: actorId,
  });
  const valuation = (id, workspaceId, profileType, actorId) => ({
    id, workspaceId, profileType,
    accountId: 'account-1', assetId: 'asset-1', currency: 'BRL',
    unitPriceMicros: 10_000_000, source: 'manual', effectiveAt: now,
    correlationId: `correlation-${id}`, createdBy: actorId, createdAt: now,
  });
  const movement = (id, workspaceId, profileType, actorId, occurredAt = now) => ({
    id, workspaceId, profileType, domainVersion: 2,
    calculationVersion: 'investment-v2-cents-micros-half-up',
    accountId: 'account-1', assetId: 'asset-1', positionId: 'account-1__asset-1',
    operation: 'contribution', status: 'settled', currency: 'BRL',
    description: `Movimento ${id}`, principalCents: 10_000, gainCents: 0,
    feesCents: 0, taxCents: 0, quantityMicros: 1_000_000,
    cashDeltaCents: -10_000, principalDeltaCents: 10_000,
    realizedGainDeltaCents: 0, feesDeltaCents: 0, taxDeltaCents: 0,
    quantityDeltaMicros: 1_000_000, goalNetContributionDeltaCents: 0,
    goalCurrentValueDeltaCents: 0, correlationId: `correlation-${id}`,
    idempotencyKeyHash: `hash-${id}`, occurredAt, settlementAt: occurredAt,
    createdBy: actorId, createdAt: now, settledBy: actorId, settledAt: now,
  });
  await Promise.all([
    db.doc(`workspaces/${workspaceA}/investment_accounts/document-a`).set(account('document-a', workspaceA, 'PF', users.ownerA.uid)),
    db.doc(`workspaces/${workspaceB}/investment_accounts/document-b`).set(account('document-b', workspaceB, 'PJ', users.ownerB.uid)),
    db.doc(`workspaces/${workspaceWithoutMembership}/investment_accounts/document-orphan`).set(account('document-orphan', workspaceWithoutMembership, 'PF', users.ownerA.uid)),
    db.doc(`workspaces/${workspaceA}/investment_assets/document-a`).set(asset('document-a', workspaceA, 'PF', users.ownerA.uid)),
    db.doc(`workspaces/${workspaceB}/investment_assets/document-b`).set(asset('document-b', workspaceB, 'PJ', users.ownerB.uid)),
    db.doc(`workspaces/${workspaceA}/investment_positions/document-a`).set(position('document-a', workspaceA, 'PF', users.ownerA.uid)),
    db.doc(`workspaces/${workspaceB}/investment_positions/document-b`).set(position('document-b', workspaceB, 'PJ', users.ownerB.uid)),
    db.doc(`workspaces/${workspaceA}/investment_summaries/current`).set({
      id: 'current', workspaceId: workspaceA, profileType: 'PF', currency: 'BRL',
      positionCount: 1, principalCents: 10_000, currentValueCents: 10_000,
      realizedGainCents: 0, unrealizedAppreciationCents: 0, feesCents: 0,
      taxCents: 0, updatedAt: now, updatedBy: users.ownerA.uid,
    }),
    db.doc(`workspaces/${workspaceB}/investment_summaries/current`).set({
      id: 'current', workspaceId: workspaceB, profileType: 'PJ', currency: 'BRL',
      positionCount: 1, principalCents: 20_000, currentValueCents: 21_000,
      realizedGainCents: 0, unrealizedAppreciationCents: 1_000, feesCents: 0,
      taxCents: 0, updatedAt: now, updatedBy: users.ownerB.uid,
    }),
    db.doc(`workspaces/${workspaceA}/investment_report_periods/2026-08`).set({
      id: '2026-08', workspaceId: workspaceA, profileType: 'PF', currency: 'BRL',
      period: '2026-08', periodStart: now, contributionCents: 10_000,
      redemptionPrincipalCents: 0, realizedGainCents: 0, feesCents: 0,
      taxCents: 0, costDeltaCents: 10_000, currentValueDeltaCents: 10_000,
      cashDeltaCents: -10_000, settledMovementCount: 1,
      updatedAt: now, updatedBy: users.ownerA.uid,
    }),
    db.doc(`workspaces/${workspaceA}/investment_allocation_summaries/account-a`).set({
      id: 'account-a', workspaceId: workspaceA, profileType: 'PF', currency: 'BRL',
      dimension: 'account', key: 'account-1', label: 'Conta principal',
      positionCount: 1, principalCents: 10_000, currentValueCents: 10_000,
      realizedGainCents: 0, feesCents: 0, taxCents: 0,
      updatedAt: now, updatedBy: users.ownerA.uid,
    }),
    db.doc(`workspaces/${workspaceA}/investment_valuations/document-a`).set(valuation('document-a', workspaceA, 'PF', users.ownerA.uid)),
    db.doc(`workspaces/${workspaceB}/investment_valuations/document-b`).set(valuation('document-b', workspaceB, 'PJ', users.ownerB.uid)),
  ]);
  await Promise.all(['movement-a', 'movement-b', 'movement-c'].map((id, index) =>
    db.doc(`workspaces/${workspaceA}/investment_movements/${id}`).set(movement(
      id,
      workspaceA,
      'PF',
      users.ownerA.uid,
      firebaseAdmin.firestore.Timestamp.fromMillis(now.toMillis() + index),
    ))));
  await db.doc(`workspaces/${workspaceB}/investment_movements/movement-z`).set(
    movement('movement-z', workspaceB, 'PJ', users.ownerB.uid),
  );
  const invalidMovement = movement('invalid-workspace', workspaceB, 'PF', users.ownerA.uid);
  await Promise.all([
    db.doc(`workspaces/${workspaceA}/investment_movements/invalid-workspace`).set(invalidMovement),
    db.doc(`workspaces/${workspaceA}/investment_movements/invalid-currency`).set({...movement('invalid-currency', workspaceA, 'PF', users.ownerA.uid), currency: 'USD'}),
    db.doc(`workspaces/${workspaceA}/investment_movements/invalid-status`).set({...movement('invalid-status', workspaceA, 'PF', users.ownerA.uid), status: 'processing'}),
    db.doc(`workspaces/${workspaceA}/investment_movements/invalid-timestamp`).set({...movement('invalid-timestamp', workspaceA, 'PF', users.ownerA.uid), occurredAt: '2026-08-18'}),
    db.doc(`workspaces/${workspaceA}/investment_movements/invalid-cents`).set({...movement('invalid-cents', workspaceA, 'PF', users.ownerA.uid), principalCents: 10.5}),
    db.doc(`workspaces/${workspaceA}/investment_snapshots/snapshot-a`).set({
      id: 'snapshot-a', workspaceId: workspaceA, profileType: 'PF',
      kind: 'position_rebuild', targetId: 'account-1__asset-1', status: 'completed',
      cutoffAt: now, processedCount: 3, expectedProjectionVersion: 1,
      totals: {quantityMicros: 1_000_000, principalCents: 10_000,
        realizedGainCents: 0, feesCents: 0, taxCents: 0,
        netContributionCents: 10_000, currentValueCents: 10_000},
      pageSize: 50, calculationVersion: 'investment-v2-cents-micros-half-up',
      correlationId: 'snapshot-correlation', createdBy: users.adminA.uid,
      createdAt: now, updatedAt: now, completedAt: now,
    }),
    db.doc(`workspaces/${workspaceA}/investment_event_logs/event-a`).set({
      id: 'event-a', workspaceId: workspaceA, profileType: 'PF',
      actorId: users.ownerA.uid, actorRole: 'owner', operation: 'archiveInvestmentAsset',
      entityType: 'asset', entityId: 'asset-1', correlationId: 'event-correlation',
      idempotencyKeyId: 'key-a', outcome: 'completed', details: {}, occurredAt: now,
    }),
    db.doc(`workspaces/${workspaceB}/investment_event_logs/event-b`).set({
      id: 'event-b', workspaceId: workspaceB, profileType: 'PJ',
      actorId: users.ownerB.uid, actorRole: 'owner', operation: 'archiveInvestmentAccount',
      entityType: 'account', entityId: 'account-1', correlationId: 'event-b-correlation',
      idempotencyKeyId: 'key-b', outcome: 'completed', details: {}, occurredAt: now,
    }),
    db.doc(`workspaces/${workspaceA}/investment_import_batches/import-a`).set({
      id: 'import-a', workspaceId: workspaceA, profileType: 'PF', status: 'pending',
      source: 'csv', processedCount: 0, failedCount: 0,
      correlationId: 'import-correlation', createdBy: users.adminA.uid,
      createdAt: now, updatedAt: now,
    }),
    db.doc(`workspaces/${workspaceA}/investment_idempotency_keys/key-a`).set({
      id: 'key-a', workspaceId: workspaceA, actorId: users.ownerA.uid,
      operation: 'createInvestmentContribution', correlationId: 'key-correlation',
      idempotencyKeyHash: 'key-hash', requestHash: 'request-hash',
      status: 'completed', result: {}, createdAt: now, completedAt: now,
    }),
    db.doc(`workspaces/${workspaceA}/goals/existing-goal`).set({workspaceId: workspaceA, name: 'Meta existente'}),
    db.doc(`workspaces/${workspaceA}/credit_card_purchases/existing-purchase`).set({workspaceId: workspaceA, amountCents: 2_500}),
  ]);
};

const signedClient = async (user, suffix) => {
  const app = initializeApp({apiKey: 'rules-test', projectId}, `investment-m3-${suffix}-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', {disableWarnings: true});
  await signInWithEmailAndPassword(auth, user.email, password);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {app, db};
};

const anonymousClient = suffix => {
  const app = initializeApp({apiKey: 'rules-test', projectId}, `investment-m3-${suffix}-${Date.now()}`);
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  return {app, db};
};


const malformedMovementIds = [
  'invalid-workspace',
  'invalid-currency',
  'invalid-status',
  'invalid-timestamp',
  'invalid-cents',
];

const deleteMalformedMovements = () => Promise.all(malformedMovementIds.map(id => getAdmin().firestore()
  .doc(`workspaces/${workspaceA}/investment_movements/${id}`).delete()));

const withClients = async (names, run) => {
  const clients = {};
  try {
    for (const name of names) {
      const suffix = `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      clients[name] = name === 'anonymous'
        ? anonymousClient(suffix)
        : await signedClient(users[name], suffix);
    }
    return await run(clients);
  } finally {
    await Promise.all(Object.values(clients).map(client => deleteApp(client.app)));
  }
};

test('Rules M4 restringem leitura das coleções operacionais por papel e bloqueiam escrita direta', async () => {
  await seed();
  await withClients(
    ['ownerA', 'ownerB', 'adminA', 'memberA', 'viewerA', 'removedA', 'anonymous'],
    async ({ownerA, ownerB, adminA, memberA, viewerA, removedA, anonymous}) => {
      for (const collectionName of [
        'investment_accounts',
        'investment_assets',
        'investment_positions',
        'investment_valuations',
      ]) {
        const pathA = `workspaces/${workspaceA}/${collectionName}/document-a`;
        assert.equal((await getDoc(doc(ownerA.db, pathA))).exists(), true);
        assert.equal((await getDoc(doc(adminA.db, pathA))).exists(), true);
        assert.equal((await getDoc(doc(memberA.db, pathA))).exists(), true);
        await assert.rejects(() => getDoc(doc(ownerB.db, pathA)));
        await assert.rejects(() => getDoc(doc(viewerA.db, pathA)));
        await assert.rejects(() => getDoc(doc(removedA.db, pathA)));
        await assert.rejects(() => getDoc(doc(anonymous.db, pathA)));
        await assert.rejects(() => setDoc(doc(ownerA.db, pathA), {workspaceId: workspaceA}));
        await assert.rejects(() => updateDoc(doc(adminA.db, pathA), {workspaceId: workspaceB}));
        await assert.rejects(() => deleteDoc(doc(memberA.db, pathA)));
      }
    },
  );
});

test('M4 — owner sem documento de membership lê o próprio domínio, e só ele', async () => {
  await seed();
  // Decisão do M4: as Rules acompanham o backend, que concede `owner` a quem é
  // `ownerId` do workspace mesmo sem documento de membership. Antes, essa
  // pessoa escrevia na carteira pelas callables e via a tela vazia.
  await withClients(['ownerA', 'ownerB', 'memberA'], async ({ownerA, ownerB, memberA}) => {
    const path = `workspaces/${workspaceWithoutMembership}/investment_accounts/document-orphan`;
    const snapshot = await getDoc(doc(ownerA.db, path));
    assert.equal(snapshot.exists(), true, 'O ownerId do workspace precisa ler o próprio domínio.');

    // O fallback vale só para o ownerId real: qualquer outro segue negado.
    await assert.rejects(
      () => getDoc(doc(ownerB.db, path)),
      'Owner de outro tenant não pode ler pelo fallback.',
    );
    await assert.rejects(
      () => getDoc(doc(memberA.db, path)),
      'Membro de outro workspace não pode ler pelo fallback.',
    );
  });
});

test('Rules M4 mantêm o resumo consolidado somente leitura para membros e sem listagem da coleção', async () => {
  await seed();
  await withClients(['ownerA', 'ownerB', 'memberA'], async ({ownerA, ownerB, memberA}) => {
    assert.equal((await getDoc(doc(
      memberA.db,
      `workspaces/${workspaceA}/investment_summaries/current`,
    ))).data()?.principalCents, 10_000);
    await assert.rejects(() => getDoc(doc(
      ownerB.db,
      `workspaces/${workspaceA}/investment_summaries/current`,
    )));
    await assert.rejects(() => updateDoc(doc(
      ownerA.db,
      `workspaces/${workspaceA}/investment_summaries/current`,
    ), {principalCents: 1}));
    await assert.rejects(() => getDocs(collection(
      ownerA.db,
      `workspaces/${workspaceA}/investment_summaries`,
    )));
  });
});

test('Rules M4 mantêm projeções de período e alocação somente leitura para o workspace dono', async () => {
  await seed();
  await withClients(['ownerA', 'ownerB', 'adminA', 'memberA'], async ({ownerA, ownerB, adminA, memberA}) => {
    for (const [collectionName, id] of [
      ['investment_report_periods', '2026-08'],
      ['investment_allocation_summaries', 'account-a'],
    ]) {
      const projectionPath = `workspaces/${workspaceA}/${collectionName}/${id}`;
      assert.equal((await getDoc(doc(memberA.db, projectionPath))).exists(), true);
      await assert.rejects(() => getDoc(doc(ownerB.db, projectionPath)));
      await assert.rejects(() => setDoc(doc(ownerA.db, projectionPath), {workspaceId: workspaceA}));
      await assert.rejects(() => updateDoc(doc(adminA.db, projectionPath), {currentValueCents: 1}));
      await assert.rejects(() => deleteDoc(doc(memberA.db, projectionPath)));
    }
  });
});

test('Rules M4 permitem listagens de projeções e carteira apenas com limit dentro do teto', async () => {
  await seed();
  await withClients(['memberA'], async ({memberA}) => {
    const reportPeriods = await getDocs(query(
      collection(memberA.db, `workspaces/${workspaceA}/investment_report_periods`),
      orderBy('periodStart', 'desc'),
      orderBy(documentId(), 'desc'),
      limit(7),
    ));
    assert.equal(reportPeriods.size, 1);
    const accountAllocations = await getDocs(query(
      collection(memberA.db, `workspaces/${workspaceA}/investment_allocation_summaries`),
      where('dimension', '==', 'account'),
      orderBy('currentValueCents', 'desc'),
      orderBy(documentId(), 'desc'),
      limit(21),
    ));
    assert.equal(accountAllocations.size, 1);
    await assert.rejects(() => getDocs(query(
      collection(memberA.db, `workspaces/${workspaceA}/investment_report_periods`),
      orderBy('periodStart', 'asc'),
      limit(101),
    )));

    const activeAccounts = await getDocs(query(
      collection(memberA.db, `workspaces/${workspaceA}/investment_accounts`),
      where('status', '==', 'active'),
      orderBy('updatedAt', 'desc'),
      orderBy(documentId(), 'desc'),
      limit(20),
    ));
    assert.equal(activeAccounts.size, 1);
    const activePositions = await getDocs(query(
      collection(memberA.db, `workspaces/${workspaceA}/investment_positions`),
      where('status', '==', 'active'),
      orderBy('updatedAt', 'desc'),
      orderBy(documentId(), 'desc'),
      limit(20),
    ));
    assert.equal(activePositions.size, 1);
  });
});

test('Rules M4 rejeitam a leitura individual de movimentos com schema corrompido', async () => {
  await seed();
  await withClients(['ownerA'], async ({ownerA}) => {
    for (const invalidId of malformedMovementIds) {
      await assert.rejects(() => getDoc(doc(
        ownerA.db,
        `workspaces/${workspaceA}/investment_movements/${invalidId}`,
      )));
    }
  });
});

test('Rules M4 exigem ordenação e limit válidos na listagem de movimentos', async () => {
  await seed();
  await deleteMalformedMovements();
  await withClients(['memberA'], async ({memberA}) => {
    await assert.rejects(() => getDocs(collection(
      memberA.db,
      `workspaces/${workspaceA}/investment_movements`,
    )));
    await assert.rejects(() => getDocs(query(
      collection(memberA.db, `workspaces/${workspaceA}/investment_movements`),
      orderBy('occurredAt', 'asc'),
      limit(101),
    )));
  });
});

test('Rules M4 permitem paginação de movimentos por cursor com limit reduzido', async () => {
  await seed();
  await deleteMalformedMovements();
  await withClients(['memberA'], async ({memberA}) => {
    const firstPage = await getDocs(query(
      collection(memberA.db, `workspaces/${workspaceA}/investment_movements`),
      orderBy('occurredAt', 'asc'),
      orderBy(documentId(), 'asc'),
      limit(2),
    ));
    assert.deepEqual(firstPage.docs.map(document => document.id), ['movement-a', 'movement-b']);
    const secondPage = await getDocs(query(
      collection(memberA.db, `workspaces/${workspaceA}/investment_movements`),
      orderBy('occurredAt', 'asc'),
      orderBy(documentId(), 'asc'),
      startAfter(firstPage.docs[1]),
      limit(2),
    ));
    assert.deepEqual(secondPage.docs.map(document => document.id), ['movement-c']);
    const emptyPage = await getDocs(query(
      collection(memberA.db, `workspaces/${workspaceA}/investment_movements`),
      orderBy('occurredAt', 'asc'),
      orderBy(documentId(), 'asc'),
      startAfter(secondPage.docs[0]),
      limit(2),
    ));
    assert.equal(emptyPage.empty, true);
  });
});

test('Rules M4 isolam movimentos entre workspaces distintos', async () => {
  await seed();
  await withClients(['ownerA', 'ownerB'], async ({ownerA, ownerB}) => {
    await assert.rejects(() => getDocs(query(
      collection(ownerB.db, `workspaces/${workspaceA}/investment_movements`),
      orderBy('occurredAt', 'asc'),
      limit(2),
    )));
    await assert.rejects(() => getDoc(doc(
      ownerA.db,
      `workspaces/${workspaceB}/investment_movements/movement-z`,
    )));
    await assert.rejects(() => getDoc(doc(
      ownerB.db,
      `workspaces/${workspaceA}/investment_movements/movement-a`,
    )));
    assert.equal((await getDoc(doc(
      ownerB.db,
      `workspaces/${workspaceB}/investment_movements/movement-z`,
    ))).exists(), true);
  });
});

test('Rules M4 bloqueiam criação, alteração e exclusão de movimentos pelo cliente', async () => {
  await seed();
  await withClients(['ownerA', 'adminA', 'memberA'], async ({ownerA, adminA, memberA}) => {
    await assert.rejects(() => setDoc(doc(
      memberA.db,
      `workspaces/${workspaceA}/investment_movements/forged`,
    ), {workspaceId: workspaceA, principalDeltaCents: 999_999}));
    await assert.rejects(() => updateDoc(doc(
      ownerA.db,
      `workspaces/${workspaceA}/investment_movements/movement-a`,
    ), {id: 'forged-id'}));
    await assert.rejects(() => updateDoc(doc(
      adminA.db,
      `workspaces/${workspaceA}/investment_movements/movement-a`,
    ), {principalCents: 1.5, currency: 'USD', status: 'processing'}));
    await assert.rejects(() => deleteDoc(doc(
      ownerA.db,
      `workspaces/${workspaceA}/investment_movements/movement-a`,
    )));
  });
});

test('Rules M4 restringem coleções privilegiadas de auditoria a owner e admin do workspace', async () => {
  await seed();
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA'], async ({ownerA, adminA, memberA, viewerA}) => {
    for (const protectedCollection of [
      'investment_snapshots',
      'investment_event_logs',
      'investment_import_batches',
    ]) {
      const id = protectedCollection === 'investment_snapshots' ? 'snapshot-a' :
        protectedCollection === 'investment_event_logs' ? 'event-a' : 'import-a';
      const protectedPath = `workspaces/${workspaceA}/${protectedCollection}/${id}`;
      assert.equal((await getDoc(doc(ownerA.db, protectedPath))).exists(), true);
      assert.equal((await getDoc(doc(adminA.db, protectedPath))).exists(), true);
      await assert.rejects(() => getDoc(doc(memberA.db, protectedPath)));
      await assert.rejects(() => getDoc(doc(viewerA.db, protectedPath)));
      await assert.rejects(() => setDoc(doc(ownerA.db, protectedPath), {workspaceId: workspaceA}));
      await assert.rejects(() => updateDoc(doc(adminA.db, protectedPath), {status: 'completed'}));
      await assert.rejects(() => deleteDoc(doc(ownerA.db, protectedPath)));
    }
    await assert.rejects(() => getDoc(doc(
      ownerA.db,
      `workspaces/${workspaceB}/investment_event_logs/event-b`,
    )));
  });
});

test('Rules M4 nunca expõem chaves de idempotência ao cliente', async () => {
  await seed();
  await withClients(['ownerA'], async ({ownerA}) => {
    await assert.rejects(() => getDoc(doc(
      ownerA.db,
      `workspaces/${workspaceA}/investment_idempotency_keys/key-a`,
    )));
    await assert.rejects(() => setDoc(doc(
      ownerA.db,
      `workspaces/${workspaceA}/investment_idempotency_keys/forged`,
    ), {status: 'completed'}));
    await assert.rejects(() => deleteDoc(doc(
      ownerA.db,
      `workspaces/${workspaceA}/investment_idempotency_keys/key-a`,
    )));
  });
});

test('Rules M4 aceitam catálogo personalizado do workspace e bloqueiam escopo ou exclusão indevidos', async () => {
  await seed();
  await withClients(['ownerA', 'ownerB', 'memberA'], async ({ownerA, ownerB, memberA}) => {
    const customCatalogPath = `workspaces/${workspaceA}/settings_catalog/risk-custom`;
    await setDoc(doc(ownerA.db, customCatalogPath), {
      workspaceId: workspaceA,
      group: 'investment_risk',
      name: 'Muito baixo',
      normalizedName: 'muito baixo',
      dedupeKey: 'investment_risk::all::both::muito baixo',
      workspaceScope: 'both',
      sortOrder: 10,
      status: 'active',
      createdBy: users.ownerA.uid,
      updatedBy: users.ownerA.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    assert.equal((await getDoc(doc(memberA.db, customCatalogPath))).exists(), true);
    await assert.rejects(() => getDoc(doc(ownerB.db, customCatalogPath)));
    await assert.rejects(() => deleteDoc(doc(ownerA.db, customCatalogPath)));
    await assert.rejects(() => setDoc(doc(ownerA.db,
      `workspaces/${workspaceA}/settings_catalog/strategy-forged`), {
      workspaceId: workspaceA,
      group: 'investment_strategy',
      name: 'Estratégia forjada',
      normalizedName: 'estrategia forjada',
      dedupeKey: 'investment_strategy::all::PJ::estrategia forjada',
      workspaceScope: 'PJ',
      sortOrder: 10,
      status: 'active',
      createdBy: users.ownerA.uid,
      updatedBy: users.ownerA.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }));
  });
});

test('Rules M4 preservam isolamento de metas e compras de cartão entre workspaces', async () => {
  await seed();
  await withClients(['ownerA', 'ownerB', 'memberA'], async ({ownerA, ownerB, memberA}) => {
    assert.equal((await getDoc(doc(
      memberA.db,
      `workspaces/${workspaceA}/goals/existing-goal`,
    ))).exists(), true);
    assert.equal((await getDoc(doc(
      memberA.db,
      `workspaces/${workspaceA}/credit_card_purchases/existing-purchase`,
    ))).exists(), true);
    await assert.rejects(() => getDoc(doc(
      ownerB.db,
      `workspaces/${workspaceA}/goals/existing-goal`,
    )));
    await assert.rejects(() => setDoc(doc(
      ownerA.db,
      `workspaces/${workspaceA}/credit_card_purchases/forged`,
    ), {workspaceId: workspaceA, amountCents: 1}));
  });
});
