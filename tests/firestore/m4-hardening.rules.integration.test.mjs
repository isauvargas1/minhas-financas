import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {deleteApp, initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {
  collection,
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
  Timestamp as ClientTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules do M4.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-password-123456';

const users = {
  ownerA: {uid: 'm4-owner-a', email: 'm4-owner-a@example.test'},
  adminA: {uid: 'm4-admin-a', email: 'm4-admin-a@example.test'},
  memberA: {uid: 'm4-member-a', email: 'm4-member-a@example.test'},
  viewerA: {uid: 'm4-viewer-a', email: 'm4-viewer-a@example.test'},
  removedA: {uid: 'm4-removed-a', email: 'm4-removed-a@example.test'},
  ownerB: {uid: 'm4-owner-b', email: 'm4-owner-b@example.test'},
  memberB: {uid: 'm4-member-b', email: 'm4-member-b@example.test'},
  // P1: owner com membership ativo cuja conta é suspensa durante o teste.
  ownerC: {uid: 'm4-owner-c', email: 'm4-owner-c@example.test'},
  // P1: membership ativo, mas sem documento de perfil `users/{uid}`.
  noProfileC: {uid: 'm4-no-profile-c', email: 'm4-no-profile-c@example.test'},
};
const wsA = 'm4-workspace-a';
const wsB = 'm4-workspace-b';
/** Workspace do owner que tem a conta suspensa e do membro sem perfil. */
const wsC = 'm4-workspace-c';
/** Workspace arquivado: leitura pelos membros ativos, nenhuma escrita. */
const wsArchived = 'm4-workspace-archived';
/** ID que um cliente tentaria usar para criar workspace por conta própria. */
const wsClientCreated = 'm4-workspace-client-created';
/** Usuários sem documento de perfil semeado. */
const USERS_WITHOUT_PROFILE = new Set([users.noProfileC.uid]);

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

/** Timestamp do Admin SDK, para semear documentos. */
const ts = (iso) => getAdmin().firestore.Timestamp.fromDate(new Date(iso));
/** Timestamp do SDK cliente, para payloads enviados como cliente. */
const clientTs = (iso) => ClientTimestamp.fromDate(new Date(iso));
const NOW = '2026-08-20T15:00:00.000Z';

/** Coleções do domínio que nenhum cliente pode escrever, em nenhum papel. */
const BACKEND_ONLY_COLLECTIONS = [
  'investment_accounts',
  'investment_assets',
  'investment_movements',
  'investment_positions',
  'investment_valuations',
  'investment_snapshots',
  'investment_event_logs',
  'investment_import_batches',
  'investment_operational_metrics',
  'investment_summaries',
  'investment_report_periods',
  'investment_allocation_summaries',
  'investment_idempotency_keys',
  // Coleções sem bloco `match` próprio: precisam cair negadas no catch-all de
  // `investment_*`, e não herdar leitura/escrita de membro.
  'investment_audit_logs',
  'investment_operation_leases',
];

/** Payload exatamente como `buildTransactionPayload` do frontend o monta. */
const clientTransaction = (workspaceId, userId, overrides = {}) => ({
  type: 'despesa',
  description: 'Compra de mercado',
  category: 'Alimentação',
  value: 150.5,
  date: '2026-08-20',
  transactionDate: clientTs(NOW),
  isPaid: true,
  supplier: 'Mercado',
  costCenter: 'Casa',
  paymentMethod: 'pix',
  expenseType: 'variavel',
  source: 'manual',
  userId,
  workspaceId,
  profileId: workspaceId,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
});

/** Negação por permissão (e não por payload inválido no SDK). */
const deniedByRules = (promise, label) => assert.rejects(promise, (error) => {
  assert.match(String(error?.code ?? error?.message), /permission-denied|PERMISSION_DENIED/, label);
  return true;
}, label);

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
    // P1: perfil server-owned. A autorização exige `status == 'active'`; o
    // membro removido também tem perfil ativo, para que seja o membership, e
    // não a conta, o que o nega.
    await db.recursiveDelete(db.doc(`users/${user.uid}`));
    if (!USERS_WITHOUT_PROFILE.has(user.uid)) {
      await db.doc(`users/${user.uid}`).set({uid: user.uid, status: 'active'});
    }
  }
  await Promise.all([
    db.recursiveDelete(db.doc(`workspaces/${wsA}`)),
    db.recursiveDelete(db.doc(`workspaces/${wsB}`)),
    db.recursiveDelete(db.doc(`workspaces/${wsC}`)),
    db.recursiveDelete(db.doc(`workspaces/${wsArchived}`)),
    db.recursiveDelete(db.doc(`workspaces/${wsClientCreated}`)),
  ]);
  await Promise.all([
    db.doc(`workspaces/${wsA}`).set({ownerId: users.ownerA.uid, type: 'PF', name: 'A', currency: 'BRL', status: 'active'}),
    db.doc(`workspaces/${wsB}`).set({ownerId: users.ownerB.uid, type: 'PJ', name: 'B', currency: 'BRL', status: 'active'}),
    db.doc(`workspaces/${wsC}`).set({ownerId: users.ownerC.uid, type: 'PF', name: 'C', currency: 'BRL', status: 'active'}),
    db.doc(`workspaces/${wsArchived}`).set({ownerId: users.ownerA.uid, type: 'PF', name: 'Arquivado', currency: 'BRL', status: 'archived'}),
  ]);
  await Promise.all([
    db.doc(`workspaces/${wsA}/members/${users.ownerA.uid}`).set({uid: users.ownerA.uid, role: 'owner', status: 'active'}),
    db.doc(`workspaces/${wsA}/members/${users.adminA.uid}`).set({uid: users.adminA.uid, role: 'admin', status: 'active'}),
    db.doc(`workspaces/${wsA}/members/${users.memberA.uid}`).set({uid: users.memberA.uid, role: 'member', status: 'active'}),
    db.doc(`workspaces/${wsA}/members/${users.viewerA.uid}`).set({uid: users.viewerA.uid, role: 'viewer', status: 'active'}),
    db.doc(`workspaces/${wsA}/members/${users.removedA.uid}`).set({uid: users.removedA.uid, role: 'member', status: 'removed'}),
    db.doc(`workspaces/${wsB}/members/${users.ownerB.uid}`).set({uid: users.ownerB.uid, role: 'owner', status: 'active'}),
    db.doc(`workspaces/${wsB}/members/${users.memberB.uid}`).set({uid: users.memberB.uid, role: 'member', status: 'active'}),
    db.doc(`workspaces/${wsC}/members/${users.ownerC.uid}`).set({uid: users.ownerC.uid, role: 'owner', status: 'active'}),
    db.doc(`workspaces/${wsC}/members/${users.noProfileC.uid}`).set({uid: users.noProfileC.uid, role: 'admin', status: 'active'}),
    db.doc(`workspaces/${wsArchived}/members/${users.ownerA.uid}`).set({uid: users.ownerA.uid, role: 'owner', status: 'active'}),
    db.doc(`workspaces/${wsArchived}/members/${users.memberA.uid}`).set({uid: users.memberA.uid, role: 'member', status: 'active'}),
    // Índice de participação: gravado só pelo backend, sem papel.
    db.doc(`users/${users.ownerA.uid}/workspaces/${wsA}`).set({
      workspaceId: wsA, status: 'active', name: 'A', type: 'PF',
      workspaceStatus: 'active', joinedAt: ts(NOW), updatedAt: ts(NOW),
    }),
  ]);
  await Promise.all([
    db.doc(`workspaces/${wsC}/transactions/tx-1`).set({
      type: 'despesa', description: 'Semente C', category: 'Casa', value: 10,
      date: '2026-08-20', userId: users.ownerC.uid, workspaceId: wsC, profileId: wsC,
      createdAt: ts(NOW), updatedAt: ts(NOW),
    }),
    db.doc(`workspaces/${wsArchived}/transactions/tx-owner`).set({
      type: 'despesa', description: 'Semente arquivada', category: 'Casa', value: 10,
      date: '2026-08-20', userId: users.ownerA.uid, workspaceId: wsArchived,
      profileId: wsArchived, createdAt: ts(NOW), updatedAt: ts(NOW),
    }),
    db.doc(`workspaces/${wsArchived}/transactions/tx-member`).set({
      type: 'despesa', description: 'Semente do membro', category: 'Casa', value: 20,
      date: '2026-08-20', userId: users.memberA.uid, workspaceId: wsArchived,
      profileId: wsArchived, createdAt: ts(NOW), updatedAt: ts(NOW),
    }),
    db.doc(`workspaces/${wsArchived}/notifications/notif-1`).set({
      title: 'Aviso', read: false, createdAt: ts(NOW),
    }),
  ]);

  // Um documento por coleção do domínio, nos dois tenants.
  const writes = [];
  for (const [workspaceId, profileType] of [[wsA, 'PF'], [wsB, 'PJ']]) {
    writes.push(db.doc(`workspaces/${workspaceId}/investment_positions/position-1`).set({
      id: 'position-1', workspaceId, profileType, accountId: 'acc-1', assetId: 'ast-1',
      currency: 'BRL', status: 'active', quantityMicros: 1_000_000, principalCents: 10_000,
      realizedGainCents: 0, feesCents: 0, taxCents: 0, currentValueCents: 10_000,
      unrealizedAppreciationCents: 0, calculationVersion: 'investment-v2-cents-micros-half-up',
      version: 1, createdAt: ts(NOW), updatedAt: ts(NOW), updatedBy: 'backend',
    }));
    writes.push(db.doc(`workspaces/${workspaceId}/investment_snapshots/snap-1`).set({
      id: 'snap-1', workspaceId, profileType, kind: 'projection_rebuild', targetId: workspaceId,
      status: 'running', cutoffAt: ts(NOW), processedCount: 0, expectedProjectionVersion: 0,
      totals: {
        quantityMicros: 0, principalCents: 0, realizedGainCents: 0, feesCents: 0,
        taxCents: 0, netContributionCents: 0, currentValueCents: 0,
      },
      pageSize: 50, calculationVersion: 'investment-v2-cents-micros-half-up',
      correlationId: 'corr-m4-hardening', createdBy: 'backend', createdAt: ts(NOW), updatedAt: ts(NOW),
    }));
    writes.push(db.doc(`workspaces/${workspaceId}/investment_event_logs/event-1`).set({
      id: 'event-1', workspaceId, profileType, actorId: 'backend', actorRole: 'owner',
      operation: 'createInvestmentContribution', entityType: 'movement', entityId: 'mov-1',
      correlationId: 'corr-m4-hardening', idempotencyKeyId: 'key-1', outcome: 'completed',
      details: {}, occurredAt: ts(NOW),
    }));
    writes.push(db.doc(`workspaces/${workspaceId}/investment_idempotency_keys/key-1`).set({
      id: 'key-1', workspaceId, actorId: 'backend', operation: 'createInvestmentContribution',
      status: 'completed', result: {}, createdAt: ts(NOW),
    }));
    writes.push(db.doc(`workspaces/${workspaceId}/transactions/tx-1`).set({
      type: 'despesa', description: 'Semente', category: 'Casa', value: 10,
      date: '2026-08-20', userId: workspaceId === wsA ? users.ownerA.uid : users.ownerB.uid,
      workspaceId, profileId: workspaceId, createdAt: ts(NOW), updatedAt: ts(NOW),
    }));
    writes.push(db.doc(`workspaces/${workspaceId}/goals/goal-1`).set({
      id: 'goal-1', workspaceId, name: 'Meta', progressBasis: 'net_contributions',
      investmentNetContributionCents: 0, investmentProgressCents: 0,
    }));
    writes.push(db.doc(`workspaces/${workspaceId}/settings_catalog/catalog-1`).set({
      workspaceId, group: 'investment_class', name: 'Renda fixa',
      normalizedName: 'renda fixa', dedupeKey: `${workspaceId}|investment_class|renda fixa`,
      workspaceScope: profileType, sortOrder: 1, status: 'active',
      createdBy: 'backend', updatedBy: 'backend', createdAt: ts(NOW), updatedAt: ts(NOW),
    }));
  }
  await Promise.all(writes);
};

const signedClient = async (user, suffix) => {
  const app = initializeApp(
    {apiKey: 'rules-test', projectId},
    `m4-${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
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

// ---------------------------------------------------------------- cross-tenant

test('M4 — nenhum tenant lê documento de investimento do outro, nos dois sentidos', async () => {
  await seed();
  await withClients(['ownerA', 'ownerB', 'memberA', 'memberB'], async (c) => {
    for (const collectionName of ['investment_positions', 'investment_snapshots', 'investment_event_logs']) {
      const id = collectionName === 'investment_positions' ? 'position-1' :
        collectionName === 'investment_snapshots' ? 'snap-1' : 'event-1';
      await assert.rejects(
        () => getDoc(doc(c.ownerA.db, `workspaces/${wsB}/${collectionName}/${id}`)),
        `ownerA não pode ler ${collectionName} de B.`,
      );
      await assert.rejects(
        () => getDoc(doc(c.ownerB.db, `workspaces/${wsA}/${collectionName}/${id}`)),
        `ownerB não pode ler ${collectionName} de A.`,
      );
      await assert.rejects(
        () => getDoc(doc(c.memberB.db, `workspaces/${wsA}/${collectionName}/${id}`)),
        `memberB não pode ler ${collectionName} de A.`,
      );
    }
    // O próprio tenant continua lendo o que lhe pertence.
    assert.equal((await getDoc(doc(c.ownerA.db, `workspaces/${wsA}/investment_positions/position-1`))).exists(), true);
    assert.equal((await getDoc(doc(c.memberA.db, `workspaces/${wsA}/investment_positions/position-1`))).exists(), true);
  });
});

test('M4 — listagem cross-tenant é negada e a do próprio tenant respeita o teto', async () => {
  await seed();
  await withClients(['ownerA', 'ownerB'], async ({ownerA, ownerB}) => {
    await assert.rejects(() => getDocs(query(
      collection(ownerB.db, `workspaces/${wsA}/investment_positions`), limit(10),
    )));
    const own = await getDocs(query(
      collection(ownerA.db, `workspaces/${wsA}/investment_positions`), limit(10),
    ));
    assert.equal(own.size, 1);
    await assert.rejects(
      () => getDocs(query(collection(ownerA.db, `workspaces/${wsA}/investment_positions`), limit(101))),
      'Listagem acima de 100 precisa ser negada.',
    );
  });
});

test('M4 — transações e metas de um tenant são invisíveis ao outro', async () => {
  await seed();
  await withClients(['ownerA', 'memberB'], async ({ownerA, memberB}) => {
    await assert.rejects(() => getDoc(doc(ownerA.db, `workspaces/${wsB}/transactions/tx-1`)));
    await assert.rejects(() => getDoc(doc(memberB.db, `workspaces/${wsA}/transactions/tx-1`)));
    await assert.rejects(() => getDoc(doc(memberB.db, `workspaces/${wsA}/goals/goal-1`)));
  });
});

// -------------------------------------------------------- privilege escalation

test('M4 — admin não se promove a owner', async () => {
  await seed();
  await withClients(['adminA'], async ({adminA}) => {
    await assert.rejects(
      () => updateDoc(doc(adminA.db, `workspaces/${wsA}/members/${users.adminA.uid}`), {role: 'owner'}),
      'Admin não pode alterar o próprio papel.',
    );
    await assert.rejects(
      () => setDoc(doc(adminA.db, `workspaces/${wsA}/members/${users.adminA.uid}`), {
        uid: users.adminA.uid, role: 'owner', status: 'active',
      }),
      'Admin não pode reescrever o próprio documento de membership como owner.',
    );
  });
  const stored = await getAdmin().firestore().doc(`workspaces/${wsA}/members/${users.adminA.uid}`).get();
  assert.equal(stored.data().role, 'admin', 'O papel persistido não pode ter mudado.');
});

test('M4 — admin não promove terceiro a owner nem rebaixa o owner', async () => {
  await seed();
  await withClients(['adminA'], async ({adminA}) => {
    await assert.rejects(
      () => updateDoc(doc(adminA.db, `workspaces/${wsA}/members/${users.memberA.uid}`), {role: 'owner'}),
      'Conceder owner exige ser owner.',
    );
    await assert.rejects(
      () => updateDoc(doc(adminA.db, `workspaces/${wsA}/members/${users.ownerA.uid}`), {role: 'member'}),
      'Rebaixar o owner exige ser owner.',
    );
  });
});

test('M4 — admin não apaga o documento de membership do owner', async () => {
  await seed();
  await withClients(['adminA'], async ({adminA}) => {
    await assert.rejects(
      () => deleteDoc(doc(adminA.db, `workspaces/${wsA}/members/${users.ownerA.uid}`)),
      'Membership é server-owned; apagar o do owner removeria todo o acesso dele.',
    );
  });
});

test('P1 — nenhum papel altera o documento do workspace pelo cliente', async () => {
  await seed();
  // P1: o workspace é server-owned. Configurações, arquivamento e
  // transferência passam pelas callables do kernel; mesmo o campo não crítico
  // (`name`), antes editável por owner/admin, agora é negado ao cliente.
  await withClients(['ownerA', 'adminA', 'memberA'], async (clients) => {
    for (const [name, client] of Object.entries(clients)) {
      for (const patch of [
        {ownerId: users[name].uid},
        {type: 'PJ'},
        {features: {qualquerRecurso: {enabled: true}}},
        {status: 'archived'},
        {name: 'Renomeado'},
      ]) {
        await assert.rejects(
          () => updateDoc(doc(client.db, `workspaces/${wsA}`), patch),
          `${name} não pode alterar o workspace: ${Object.keys(patch)[0]}.`,
        );
      }
    }
  });
  const stored = await getAdmin().firestore().doc(`workspaces/${wsA}`).get();
  assert.equal(stored.data().ownerId, users.ownerA.uid);
  assert.equal(stored.data().type, 'PF');
  assert.equal(stored.data().name, 'A');
  assert.equal(stored.data().status, 'active');
});

test('M4 — member não altera o próprio papel nem forja o uid de outro', async () => {
  await seed();
  await withClients(['memberA'], async ({memberA}) => {
    await assert.rejects(
      () => updateDoc(doc(memberA.db, `workspaces/${wsA}/members/${users.memberA.uid}`), {role: 'admin'}),
      'Member não escreve em members.',
    );
    await assert.rejects(
      () => setDoc(doc(memberA.db, `workspaces/${wsA}/members/${users.viewerA.uid}`), {
        uid: users.memberA.uid, role: 'owner', status: 'active',
      }),
      'Member não escreve documento de membership alheio.',
    );
  });
});

test('M4 — owner não grava membership com uid divergente do ID do documento', async () => {
  await seed();
  // P1: toda escrita do cliente em `members` é negada; os payloads malformados
  // abaixo seguem cobertos como casos particulares dessa negação.
  await withClients(['ownerA'], async ({ownerA}) => {
    await assert.rejects(
      () => setDoc(doc(ownerA.db, `workspaces/${wsA}/members/${users.memberA.uid}`), {
        uid: users.viewerA.uid, role: 'member', status: 'active',
      }),
      'O uid precisa coincidir com o ID do documento.',
    );
    await assert.rejects(
      () => setDoc(doc(ownerA.db, `workspaces/${wsA}/members/${users.memberA.uid}`), {
        uid: users.memberA.uid, role: 'superuser', status: 'active',
      }),
      'Papel fora do enum precisa ser negado.',
    );
  });
});

// ------------------------------------------------------------ payload forjado

test('M4 — cliente não grava campos autoritativos do backend em transactions', async () => {
  await seed();
  await withClients(['ownerA'], async ({ownerA}) => {
    const base = clientTransaction(wsA, users.ownerA.uid);
    for (const [field, forged] of [
      ['valueCents', {valueCents: 999_999_999}],
      ['profileType', {profileType: 'PJ'}],
      ['createdBy', {createdBy: 'backend'}],
      ['updatedBy', {updatedBy: 'backend'}],
      ['domainVersion', {domainVersion: 2}],
      ['campoDesconhecido', {campoDesconhecido: 'x'}],
      ['investmentMetadata', {investmentMetadata: {investmentOperation: 'redemption'}}],
      ['settlementDate', {settlementDate: clientTs(NOW)}],
      ['redeemedPrincipalCents', {redeemedPrincipalCents: 0}],
      ['goalId', {goalId: 'goal-1'}],
    ]) {
      await assert.rejects(
        () => setDoc(doc(ownerA.db, `workspaces/${wsA}/transactions/forged-${field}`), {...base, ...forged}),
        `Campo ${field} não pode vir do cliente.`,
      );
    }
  });
});

test('M4 — transação exige workspaceId igual ao path e userId do autor', async () => {
  await seed();
  await withClients(['ownerA'], async ({ownerA}) => {
    const {workspaceId: _omit, ...withoutWorkspace} = clientTransaction(wsA, users.ownerA.uid);
    await assert.rejects(
      () => setDoc(doc(ownerA.db, `workspaces/${wsA}/transactions/no-workspace`), withoutWorkspace),
      'workspaceId passa a ser obrigatório.',
    );
    await assert.rejects(
      () => setDoc(
        doc(ownerA.db, `workspaces/${wsA}/transactions/foreign-workspace`),
        clientTransaction(wsB, users.ownerA.uid),
      ),
      'workspaceId precisa coincidir com o path.',
    );
    await assert.rejects(
      () => setDoc(
        doc(ownerA.db, `workspaces/${wsA}/transactions/foreign-user`),
        clientTransaction(wsA, users.memberA.uid),
      ),
      'userId precisa ser o do autor autenticado.',
    );
  });
});

test('P4-D — nenhum campo de transação muda pelo cliente, nem os antes mutáveis', async () => {
  await seed();
  const db = getAdmin().firestore();
  await db.doc(`workspaces/${wsA}/transactions/mutable-tx`).set({
    ...clientTransaction(wsA, users.ownerA.uid), transactionDate: ts(NOW), createdAt: ts(NOW), updatedAt: ts(NOW),
  });
  await withClients(['ownerA'], async ({ownerA}) => {
    const ref = doc(ownerA.db, `workspaces/${wsA}/transactions/mutable-tx`);
    for (const patch of [
      // A edição que o frontend fazia direto agora é `updateCashTransaction`.
      {description: 'Compra editada', value: 200, updatedAt: serverTimestamp()},
      {workspaceId: wsB},
      {userId: users.memberA.uid},
      {profileId: wsB},
      {valueCents: 123},
      {createdAt: clientTs(NOW)},
    ]) {
      await deniedByRules(updateDoc(ref, patch), `Campo não pode mudar: ${Object.keys(patch)[0]}.`);
    }
  });
  const stored = await db.doc(`workspaces/${wsA}/transactions/mutable-tx`).get();
  assert.equal(stored.data().description, 'Compra de mercado');
  assert.equal(stored.data().workspaceId, wsA);
  assert.equal(stored.data().userId, users.ownerA.uid);
});

// ------------------------------------------- escrita direta no domínio negada

test('M4 — nenhum papel escreve direto em coleção do domínio de investimentos', async () => {
  await seed();
  await withClients(['ownerA', 'adminA', 'memberA'], async (clients) => {
    for (const [name, client] of Object.entries(clients)) {
      for (const collectionName of BACKEND_ONLY_COLLECTIONS) {
        const ref = doc(client.db, `workspaces/${wsA}/${collectionName}/forged-by-${name}`);
        await assert.rejects(
          () => setDoc(ref, {workspaceId: wsA, id: `forged-by-${name}`}),
          `${name} não pode criar em ${collectionName}.`,
        );
      }
      // Alteração e exclusão de documentos existentes também negadas.
      for (const [collectionName, docId] of [
        ['investment_positions', 'position-1'],
        ['investment_snapshots', 'snap-1'],
        ['investment_event_logs', 'event-1'],
        ['investment_idempotency_keys', 'key-1'],
      ]) {
        const ref = doc(client.db, `workspaces/${wsA}/${collectionName}/${docId}`);
        await assert.rejects(() => updateDoc(ref, {workspaceId: wsA}), `${name} update ${collectionName}`);
        await assert.rejects(() => deleteDoc(ref), `${name} delete ${collectionName}`);
      }
    }
  });
});

test('M4 — idempotência nunca é legível e projeções não são escritas', async () => {
  await seed();
  await withClients(['ownerA', 'adminA', 'memberA'], async (clients) => {
    for (const [name, client] of Object.entries(clients)) {
      await assert.rejects(
        () => getDoc(doc(client.db, `workspaces/${wsA}/investment_idempotency_keys/key-1`)),
        `${name} não pode ler chaves de idempotência.`,
      );
      await assert.rejects(
        () => setDoc(doc(client.db, `workspaces/${wsA}/goals/goal-1`), {investmentProgressCents: 999}, {merge: true}),
        `${name} não pode escrever progresso de meta.`,
      );
    }
  });
});

test('M4 — tier sensível permanece restrito a owner e admin', async () => {
  await seed();
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA'], async (c) => {
    const path = `workspaces/${wsA}/investment_event_logs/event-1`;
    assert.equal((await getDoc(doc(c.ownerA.db, path))).exists(), true);
    assert.equal((await getDoc(doc(c.adminA.db, path))).exists(), true);
    await assert.rejects(() => getDoc(doc(c.memberA.db, path)));
    await assert.rejects(() => getDoc(doc(c.viewerA.db, path)));
    // P4-D (D-15): o snapshot de reconstrução saiu com o job; nem owner lê.
    for (const name of ['ownerA', 'adminA']) {
      await deniedByRules(getDoc(doc(c[name].db, `workspaces/${wsA}/investment_snapshots/snap-1`)),
        `${name} lê snapshot removido`);
    }
  });
});

test('M4 — viewer e membro removido não leem o domínio de investimentos', async () => {
  await seed();
  await withClients(['viewerA', 'removedA'], async ({viewerA, removedA}) => {
    for (const client of [viewerA, removedA]) {
      await assert.rejects(
        () => getDoc(doc(client.db, `workspaces/${wsA}/investment_positions/position-1`)),
      );
      await assert.rejects(
        () => getDocs(query(collection(client.db, `workspaces/${wsA}/investment_positions`), limit(10))),
      );
    }
  });
});

// ---------------------------------------------------- regressão dos domínios

test('P4-D — o antigo fluxo direto do frontend não cria nem edita transação em papel algum', async () => {
  // Criação, correção e anulação são callables do caixa (P3-E/F); a escrita
  // direta acabou com a P4-D.
  await seed();
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA'], async (clients) => {
    for (const [name, client] of Object.entries(clients)) {
      const user = users[`${name}`];
      const ref = doc(client.db, `workspaces/${wsA}/transactions/regression-${name}`);
      await deniedByRules(setDoc(ref, clientTransaction(wsA, user.uid)), `${name} cria`);
      await deniedByRules(updateDoc(doc(client.db, `workspaces/${wsA}/transactions/tx-1`),
        {value: 99.9, description: 'Editado', updatedAt: serverTimestamp()}), `${name} edita`);
      // A leitura segue para todo membro ativo.
      assert.equal((await getDoc(doc(client.db, `workspaces/${wsA}/transactions/tx-1`))).exists(), true);
    }
  });
  assert.equal((await getAdmin().firestore().doc(`workspaces/${wsA}/transactions/tx-1`).get()).data().value, 10);
});

test('M4 — catálogo somente leitura no cliente (D-23) e metas inalteradas', async () => {
  await seed();
  await withClients(['ownerA', 'memberA'], async ({ownerA, memberA}) => {
    // P4-E (D-23): o catálogo é mantido só pelas callables; nem owner nem
    // admin gravam pelo cliente.
    await deniedByRules(setDoc(doc(ownerA.db, `workspaces/${wsA}/settings_catalog/catalog-2`), {
      workspaceId: wsA, group: 'investment_class', name: 'Multimercado',
      normalizedName: 'multimercado', dedupeKey: `${wsA}|investment_class|multimercado`,
      workspaceScope: 'PF', sortOrder: 2, status: 'active',
      createdBy: users.ownerA.uid, updatedBy: users.ownerA.uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }), 'owner não grava catálogo pelo cliente');
    // Member continua apenas lendo.
    assert.equal((await getDoc(doc(memberA.db, `workspaces/${wsA}/settings_catalog/catalog-1`))).exists(), true);
    await assert.rejects(() => setDoc(doc(memberA.db, `workspaces/${wsA}/settings_catalog/catalog-3`), {
      workspaceId: wsA, group: 'investment_class', name: 'Proibido',
      normalizedName: 'proibido', dedupeKey: `${wsA}|investment_class|proibido`,
      workspaceScope: 'PF', sortOrder: 3, status: 'active',
      createdBy: users.memberA.uid, updatedBy: users.memberA.uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }));
    // Metas seguem legíveis pelo workspace e não graváveis.
    assert.equal((await getDoc(doc(memberA.db, `workspaces/${wsA}/goals/goal-1`))).exists(), true);
  });
});

test('P1 — nem o owner gerencia membros pelo cliente; membership é server-owned', async () => {
  await seed();
  // P1: convite, aceite, troca de papel, remoção lógica e transferência são
  // callables do backend. O cliente — owner inclusive — não cria, não altera
  // e não apaga documento de membership; hard delete de membership removido
  // também é negado.
  await withClients(['ownerA'], async ({ownerA}) => {
    await assert.rejects(
      () => setDoc(doc(ownerA.db, `workspaces/${wsA}/members/${users.viewerA.uid}`), {
        uid: users.viewerA.uid, role: 'member', status: 'active',
      }),
      'owner não troca papel reescrevendo membership',
    );
    await assert.rejects(
      () => setDoc(doc(ownerA.db, `workspaces/${wsA}/members/${users.memberB.uid}`), {
        uid: users.memberB.uid, role: 'member', status: 'active',
      }),
      'owner não adiciona membro sem convite',
    );
    await assert.rejects(
      () => updateDoc(doc(ownerA.db, `workspaces/${wsA}/members/${users.memberA.uid}`), {role: 'admin'}),
      'owner não promove membro pelo cliente',
    );
    await assert.rejects(
      () => updateDoc(doc(ownerA.db, `workspaces/${wsA}/members/${users.removedA.uid}`), {status: 'active'}),
      'owner não reativa membro removido pelo cliente',
    );
    await assert.rejects(
      () => deleteDoc(doc(ownerA.db, `workspaces/${wsA}/members/${users.removedA.uid}`)),
      'owner não apaga membership',
    );
    await assert.rejects(
      () => updateDoc(doc(ownerA.db, `workspaces/${wsA}/members/${users.ownerA.uid}`), {role: 'admin'}),
      'owner não altera o próprio membership',
    );
  });
  const db = getAdmin().firestore();
  assert.equal((await db.doc(`workspaces/${wsA}/members/${users.viewerA.uid}`).get()).data().role, 'viewer');
  assert.equal((await db.doc(`workspaces/${wsA}/members/${users.memberA.uid}`).get()).data().role, 'member');
  assert.equal((await db.doc(`workspaces/${wsA}/members/${users.memberB.uid}`).get()).exists, false);
  const removed = await db.doc(`workspaces/${wsA}/members/${users.removedA.uid}`).get();
  assert.equal(removed.exists, true);
  assert.equal(removed.data().status, 'removed');
  assert.equal((await db.doc(`workspaces/${wsA}/members/${users.ownerA.uid}`).get()).data().role, 'owner');
});

test('P1 — cliente não cria nem apaga workspace e não grava o índice de participação', async () => {
  await seed();
  const db = getAdmin().firestore();
  await withClients(['ownerA', 'adminA', 'memberA'], async (clients) => {
    for (const [name, client] of Object.entries(clients)) {
      const uid = users[name].uid;
      await assert.rejects(
        () => setDoc(doc(client.db, `workspaces/${wsClientCreated}`), {
          ownerId: uid, type: 'PF', name: 'Criado pelo cliente', currency: 'BRL', status: 'active',
        }),
        `${name} não cria workspace pelo cliente`,
      );
      await assert.rejects(
        () => deleteDoc(doc(client.db, `workspaces/${wsA}`)),
        `${name} não apaga workspace`,
      );
      // O índice não autoriza nada, mas forjá-lo faria a interface listar um
      // workspace alheio; é gravado só na transação do backend.
      await assert.rejects(
        () => setDoc(doc(client.db, `users/${uid}/workspaces/${wsB}`), {
          workspaceId: wsB, status: 'active', name: 'B', type: 'PJ', workspaceStatus: 'active',
        }),
        `${name} não cria entrada no índice de participação`,
      );
      // Idempotência e limites de frequência do kernel: server-only.
      await assert.rejects(
        () => setDoc(doc(client.db, `users/${uid}/idempotency_keys/forjada`), {status: 'completed'}),
        `${name} não forja chave de idempotência`,
      );
      await assert.rejects(
        () => setDoc(doc(client.db, `users/${uid}/rate_limits/forjado`), {count: 0}),
        `${name} não zera o próprio limite de frequência`,
      );
    }

    // A entrada existente segue legível pelo dono e imutável pelo cliente.
    const indexRef = doc(clients.ownerA.db, `users/${users.ownerA.uid}/workspaces/${wsA}`);
    assert.equal((await getDoc(indexRef)).data().workspaceId, wsA);
    await assert.rejects(() => updateDoc(indexRef, {status: 'removed'}), 'índice não é alterável pelo cliente');
    await assert.rejects(() => deleteDoc(indexRef), 'índice não é apagável pelo cliente');
    await assert.rejects(
      () => getDoc(doc(clients.adminA.db, `users/${users.ownerA.uid}/workspaces/${wsA}`)),
      'ninguém lê o índice de outro usuário',
    );
  });
  assert.equal((await db.doc(`workspaces/${wsClientCreated}`).get()).exists, false);
  assert.equal((await db.doc(`workspaces/${wsA}`).get()).exists, true);
  assert.equal((await db.doc(`users/${users.ownerA.uid}/workspaces/${wsB}`).get()).exists, false);
  assert.equal((await db.doc(`users/${users.ownerA.uid}/workspaces/${wsA}`).get()).data().status, 'active');
});

// ------------------------------- escrita direta de investimento pelo cliente
//
// O patrimônio é `investment_movements`, e toda transação `investimento`
// legítima é o espelho de caixa gravado pelo backend com o Admin SDK. Uma
// transação de investimento gravada direto pelo cliente sai do caixa e nunca
// chega ao patrimônio — divergência silenciosa entre as duas fontes. A negação
// é incondicional: não depende de estado nenhum do workspace.

test('M4 — escrita direta de transação de investimento é sempre negada', async () => {
  await seed();

  await withClients(['ownerA', 'memberA'], async ({ownerA, memberA}) => {
    const aporte = (uid) => ({
      type: 'investimento', description: 'Aporte gravado pelo cliente',
      category: 'CDB', value: 100, date: '2026-08-20',
      userId: uid, workspaceId: wsA, profileId: wsA, isPaid: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    await deniedByRules(
      setDoc(doc(ownerA.db, `workspaces/${wsA}/transactions/legacy-v2-1`), aporte(users.ownerA.uid)),
      'owner não pode gravar transação de investimento direto',
    );
    await deniedByRules(
      setDoc(doc(memberA.db, `workspaces/${wsA}/transactions/legacy-v2-2`), aporte(users.memberA.uid)),
      'member não pode gravar transação de investimento direto',
    );
    // P4-D: receita e despesa também — a negação não é mais só do tipo.
    await deniedByRules(setDoc(doc(ownerA.db, `workspaces/${wsA}/transactions/receita-v2-1`), {
      type: 'receita', description: 'Salário', category: 'Salário',
      value: 500, date: '2026-08-20', userId: users.ownerA.uid,
      workspaceId: wsA, profileId: wsA,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }), 'owner não grava receita direto');
  });
});

// ------------------------------------------------------- INV-P1-002 / P2-049
//
// A barreira antiga fechava apenas `create`: o cliente criava uma `despesa` e
// a atualizava para `investimento`. Desde a P4-D nenhuma escrita do cliente é
// aceita em `transactions`, e a troca de tipo continua negada.

const seedClientShapedTransaction = async (docId, userId) => {
  await getAdmin().firestore().doc(`workspaces/${wsA}/transactions/${docId}`).set({
    ...clientTransaction(wsA, userId), transactionDate: ts(NOW), createdAt: ts(NOW), updatedAt: ts(NOW),
  });
};

test('INV-P1-002 — update de type para investimento é negado em todos os papéis', async () => {
  await seed();
  const db = getAdmin().firestore();

  await withClients(['ownerA', 'adminA', 'memberA'], async (c) => {
    for (const [name, user] of [
      ['ownerA', users.ownerA],
      ['adminA', users.adminA],
      ['memberA', users.memberA],
    ]) {
      const docId = `bypass-${name}`;
      await seedClientShapedTransaction(docId, user.uid);
      const ref = doc(c[name].db, `workspaces/${wsA}/transactions/${docId}`);
      await deniedByRules(
        updateDoc(ref, {type: 'investimento'}),
        `${name} não pode trocar o tipo de uma transação para investimento`,
      );
      const persisted = await db.doc(`workspaces/${wsA}/transactions/${docId}`).get();
      assert.equal(persisted.data().type, 'despesa');
    }
  });
});

test('INV-P1-002 — troca de tipo é negada para qualquer tipo alvo', async () => {
  await seed();
  await seedClientShapedTransaction('tipo-imutavel', users.ownerA.uid);
  await withClients(['ownerA'], async ({ownerA}) => {
    const ref = doc(ownerA.db, `workspaces/${wsA}/transactions/tipo-imutavel`);
    for (const type of ['receita', 'investimento', 'parcelado']) {
      await deniedByRules(updateDoc(ref, {type}), `tipo ${type}`);
    }
  });
});

test('P4-D — nem o payload máximo das chaves antes mutáveis é aceito', async () => {
  await seed();
  await withClients(['ownerA', 'memberA'], async (c) => {
    for (const [name, user] of [
      ['ownerA', users.ownerA],
      ['memberA', users.memberA],
    ]) {
      await seedClientShapedTransaction(`teto-${name}`, user.uid);
      const ref = doc(c[name].db, `workspaces/${wsA}/transactions/teto-${name}`);
      await deniedByRules(updateDoc(ref, {
        description: 'Descrição atualizada com texto bem mais longo que o anterior',
        category: 'Educação',
        value: 987.65,
        date: '2026-08-21',
        transactionDate: clientTs('2026-08-21T15:00:00.000Z'),
        expenseType: 'fixa',
        incomeType: 'servico',
        paymentMethod: 'boleto',
        isPaid: false,
        supplier: 'Fornecedor Atualizado',
        costCenter: 'Centro Atualizado',
        source: 'manual',
        displaySnapshots: {
          categorySnapshot: {group: 'category', label: 'Educação', normalizedLabel: 'educacao'},
        },
        updatedAt: serverTimestamp(),
      }), `${name} payload máximo`);
      for (const [key, value] of [
        ['creditCardInvoiceId', 'inv-9'],
        ['creditCardInvoicePaymentId', 'pay-9'],
        ['creditCardCompatibility', {source: 'credit_card_invoice'}],
        ['creditCardPaymentEntry', {paymentId: 'pay-9'}],
        ['installments', 3],
        ['currentInstallment', 2],
        ['cardId', 'card-9'],
        ['splitEntry', {kind: 'bill_expense'}],
        ['investmentEntry', {status: 'settled'}],
      ]) {
        await deniedByRules(updateDoc(ref, {[key]: value, updatedAt: serverTimestamp()}), `${name} não grava ${key}`);
      }
    }
  });
});

// ------------------------------------------------------------- INV-P2-032

test('INV-P2-032 — delete de transação é negado; a baixa lógica também não é do cliente', async () => {
  await seed();
  await withClients(['ownerA', 'adminA', 'memberA'], async (c) => {
    for (const [name, user] of [
      ['ownerA', users.ownerA],
      ['adminA', users.adminA],
      ['memberA', users.memberA],
    ]) {
      const docId = `soft-delete-${name}`;
      await seedClientShapedTransaction(docId, user.uid);
      const ref = doc(c[name].db, `workspaces/${wsA}/transactions/${docId}`);
      await deniedByRules(deleteDoc(ref), `${name} não pode apagar histórico financeiro`);
      // P4-D: a anulação é `voidCashTransaction` (P3-C); o cliente não baixa.
      await deniedByRules(updateDoc(ref, {
        voidedAt: serverTimestamp(),
        voidedBy: user.uid,
        voidReason: 'Excluída pelo usuário',
        updatedAt: serverTimestamp(),
      }), `${name} não baixa direto`);
      const persisted = await getAdmin().firestore().doc(`workspaces/${wsA}/transactions/${docId}`).get();
      assert.ok(persisted.exists);
      assert.equal(persisted.data().voidedAt, undefined);
    }
  });
});

test('INV-P2-032 — baixa lógica não aceita forjar o autor da baixa', async () => {
  await seed();
  await seedClientShapedTransaction('void-forjado', users.ownerA.uid);
  await withClients(['ownerA'], async ({ownerA}) => {
    const ref = doc(ownerA.db, `workspaces/${wsA}/transactions/void-forjado`);
    await deniedByRules(
      updateDoc(ref, {
        voidedAt: serverTimestamp(),
        voidedBy: users.memberA.uid,
        updatedAt: serverTimestamp(),
      }),
      'voidedBy forjado',
    );
  });
});

// ------------------------------------------------------------- INV-P1-013

test('INV-P1-013 / P1 — usuário não escreve no próprio perfil, nem para conceder plano ou admin', async () => {
  await seed();
  const db = getAdmin().firestore();
  const seeded = {
    uid: users.ownerA.uid,
    status: 'active',
    email: users.ownerA.email,
    displayName: 'Owner A',
  };
  await db.doc(`users/${users.ownerA.uid}`).set(seeded);

  await withClients(['ownerA'], async ({ownerA}) => {
    const ref = doc(ownerA.db, `users/${users.ownerA.uid}`);

    // P1: o perfil é server-owned (`bootstrapAccount`). P2A: plano e
    // cobrança vivem em `billing_accounts/{uid}`; as tentativas abaixo de
    // gravar campos de plano no perfil continuam negadas.
    // A allowlist anterior de campos de exibição deixou de existir: qualquer
    // escrita do cliente é negada, inclusive `status`, `email` e
    // `displayName`, que agora vêm do token verificado.
    for (const forged of [
      {planId: 'pro'},
      {isPro: true},
      {planId: 'pro', isPro: true},
      {isAdmin: true},
      {stripeCustomerId: 'cus_forjado'},
      {subscriptionStatus: 'active'},
      {entitlements: {pro: true}},
      {status: 'active'},
      {status: 'suspended'},
      {email: 'outro@example.test'},
      {displayName: 'Owner Atualizado'},
      {photoURL: 'https://example.test/avatar.png'},
      {locale: 'pt-BR', updatedAt: serverTimestamp()},
    ]) {
      await assert.rejects(
        () => setDoc(ref, forged, {merge: true}),
        `cliente não grava o perfil: ${Object.keys(forged).join(',')}`,
      );
      await assert.rejects(
        () => updateDoc(ref, forged),
        `cliente não atualiza o perfil: ${Object.keys(forged).join(',')}`,
      );
    }
    // Substituição integral (sem merge) também é negada.
    await assert.rejects(
      () => setDoc(ref, {...seeded, planId: 'pro', isAdmin: true}),
      'cliente não substitui o próprio perfil',
    );

    // O próprio usuário continua lendo o perfil.
    assert.equal((await getDoc(ref)).data().displayName, 'Owner A');

    // O documento de outro usuário permanece inacessível.
    await assert.rejects(
      () => getDoc(doc(ownerA.db, `users/${users.memberA.uid}`)),
      'ninguém lê o documento de perfil de outro usuário',
    );
    await assert.rejects(
      () => setDoc(doc(ownerA.db, `users/${users.memberA.uid}`), {displayName: 'x'}),
      'ninguém escreve no perfil de outro usuário',
    );

    // Nem apaga o próprio.
    await assert.rejects(
      () => deleteDoc(ref),
      'documento de usuário não é apagável pelo cliente',
    );
  });

  const persisted = await db.doc(`users/${users.ownerA.uid}`).get();
  assert.deepEqual(persisted.data(), seeded);
});

test('P1 — usuário sem perfil não cria o próprio documento de perfil', async () => {
  await seed();
  const db = getAdmin().firestore();
  await withClients(['noProfileC'], async ({noProfileC}) => {
    // A criação do perfil é do `bootstrapAccount`, a partir do token.
    await assert.rejects(
      () => setDoc(doc(noProfileC.db, `users/${users.noProfileC.uid}`), {
        uid: users.noProfileC.uid, status: 'active',
      }),
      'cliente não cria o próprio perfil',
    );
  });
  assert.equal((await db.doc(`users/${users.noProfileC.uid}`).get()).exists, false);
});

test('INV-P1-013 / P2A — backend continua sendo a fonte de entitlement', async () => {
  await seed();
  const db = getAdmin().firestore();

  // O Admin SDK — usado pelo webhook do Stripe — ignora as Rules. O estado
  // canônico é `billing_accounts/{uid}` (P2A), não o perfil.
  const billing = {
    billingOwnerUid: users.ownerA.uid,
    catalogVersion: 1,
    planId: 'pro',
    entitlementStatus: 'active',
    subscriptionStatus: 'active',
    stripeCustomerId: 'cus_legitimo',
  };
  await db.doc(`billing_accounts/${users.ownerA.uid}`).set(billing);

  await withClients(['ownerA'], async ({ownerA}) => {
    const ref = doc(ownerA.db, `billing_accounts/${users.ownerA.uid}`);
    assert.equal((await getDoc(ref)).data().planId, 'pro');

    // Nem o titular pago altera o próprio billing, em nenhum sentido.
    await assert.rejects(
      () => setDoc(ref, {planId: 'business'}, {merge: true}),
      'billing pago também é server-owned',
    );
    await assert.rejects(
      () => updateDoc(ref, {planId: 'free', entitlementStatus: 'free'}),
      'cliente não altera o plano, em nenhum sentido',
    );
  });

  const after = await db.doc(`billing_accounts/${users.ownerA.uid}`).get();
  assert.deepEqual(after.data(), billing);
});

// ------------------------------------------------------------- INV-P3-053

test('INV-P3-053 — workspace, membro e transação rejeitam campos arbitrários', async () => {
  await seed();
  await withClients(['ownerA'], async ({ownerA}) => {
    await assert.rejects(
      () => updateDoc(doc(ownerA.db, `workspaces/${wsA}`), {campoArbitrario: 'x'}),
      'workspace não aceita campo arbitrário',
    );

    await assert.rejects(
      () => setDoc(doc(ownerA.db, `workspaces/${wsA}/members/${users.memberA.uid}`), {
        uid: users.memberA.uid,
        role: 'member',
        campoArbitrario: 'x',
      }),
      'membership não aceita campo arbitrário',
    );

    // Teto numérico e de tamanho de string em transações.
    await assert.rejects(
      () => setDoc(doc(ownerA.db, `workspaces/${wsA}/transactions/teto-valor`),
        clientTransaction(wsA, users.ownerA.uid, {value: 5_000_000_000})),
      'valor de transação tem teto',
    );
    await assert.rejects(
      () => setDoc(doc(ownerA.db, `workspaces/${wsA}/transactions/teto-descricao`),
        clientTransaction(wsA, users.ownerA.uid, {description: 'x'.repeat(400)})),
      'descrição de transação tem tamanho máximo',
    );

    // P1: o caminho legítimo de configurações é a callable
    // `updateWorkspaceSettings`; a escrita direta, mesmo só com campos de
    // configuração, é negada ao owner.
    await assert.rejects(
      () => updateDoc(doc(ownerA.db, `workspaces/${wsA}`), {
        name: 'Workspace Renomeado',
        themeColor: '#123456',
        updatedAt: serverTimestamp(),
      }),
      'configurações do workspace não são gravadas pelo cliente',
    );
  });
  const stored = await getAdmin().firestore().doc(`workspaces/${wsA}`).get();
  assert.equal(stored.data().name, 'A');
  assert.equal(stored.data().themeColor, undefined);
  assert.equal(stored.data().campoArbitrario, undefined);
});

// ------------------------- coleções novas da remediação: isolamento e escrita
//
// A projeção mensal de caixa (INV-P1-011), os relatórios de deriva
// (INV-P2-019) e os leases de operação (INV-P2-043) são coleções novas
// escritas exclusivamente pelo backend. Toda coleção nova precisa de cobertura
// negativa nos dois sentidos entre tenants, e de prova de que o cliente não
// escreve nela.

test('coleções novas são server-only e invisíveis entre tenants', async () => {
  await seed();
  const db = getAdmin().firestore();
  const now = ts(NOW);

  await Promise.all([
    db.doc(`workspaces/${wsA}/cash_report_periods/2026-08`).set({
      id: '2026-08', workspaceId: wsA, period: '2026-08', periodStart: now,
      incomeCents: 50_000, expenseCents: 10_000, investmentOutflowCents: 0,
      netCents: 40_000, transactionCount: 2, updatedAt: now,
    }),
    db.doc(`workspaces/${wsB}/cash_report_periods/2026-08`).set({
      id: '2026-08', workspaceId: wsB, period: '2026-08', periodStart: now,
      incomeCents: 90_000, expenseCents: 0, investmentOutflowCents: 0,
      netCents: 90_000, transactionCount: 1, updatedAt: now,
    }),
    db.doc(`workspaces/${wsA}/investment_drift_reports/2026-08-20_${wsA}`).set({
      id: `2026-08-20_${wsA}`, workspaceId: wsA, date: '2026-08-20',
      correlationId: 'corr-drift', status: 'clean', findings: [],
      findingCount: 0, maxDifferenceCents: 0, positionsInspected: 1,
      detectedAt: now, expiresAt: now,
    }),
    db.doc(`workspaces/${wsB}/investment_drift_reports/2026-08-20_${wsB}`).set({
      id: `2026-08-20_${wsB}`, workspaceId: wsB, date: '2026-08-20',
      correlationId: 'corr-drift', status: 'clean', findings: [],
      findingCount: 0, maxDifferenceCents: 0, positionsInspected: 1,
      detectedAt: now, expiresAt: now,
    }),
    // Coleção `investment_*` sem bloco `match` próprio: o catch-all precisa
    // negá-la para todo papel, em vez de deixá-la herdar leitura de membro.
    db.doc(`workspaces/${wsA}/investment_sem_bloco_proprio/doc-a`).set({
      id: 'doc-a', workspaceId: wsA, updatedAt: now,
    }),
  ]);

  await withClients(['ownerA', 'adminA', 'memberA', 'ownerB', 'memberB'], async (c) => {
    // O próprio tenant lê a projeção de caixa; é ela que substitui a varredura
    // da coleção inteira de transações.
    await getDoc(doc(c.memberA.db, `workspaces/${wsA}/cash_report_periods/2026-08`));
    await getDocs(query(
      collection(c.memberA.db, `workspaces/${wsA}/cash_report_periods`),
      limit(600),
    ));

    // Nos dois sentidos, cross-tenant é negado.
    await assert.rejects(
      () => getDoc(doc(c.memberB.db, `workspaces/${wsA}/cash_report_periods/2026-08`)),
      'memberB não lê o caixa de A',
    );
    await assert.rejects(
      () => getDoc(doc(c.ownerA.db, `workspaces/${wsB}/cash_report_periods/2026-08`)),
      'ownerA não lê o caixa de B',
    );
    await assert.rejects(
      () => getDocs(query(
        collection(c.memberB.db, `workspaces/${wsA}/cash_report_periods`),
        limit(600),
      )),
      'memberB não lista o caixa de A',
    );

    // Deriva é tier sensível: owner e admin, nunca member, nunca outro tenant.
    await getDoc(doc(c.ownerA.db, `workspaces/${wsA}/investment_drift_reports/2026-08-20_${wsA}`));
    await assert.rejects(
      () => getDoc(doc(c.memberA.db, `workspaces/${wsA}/investment_drift_reports/2026-08-20_${wsA}`)),
      'member não lê relatório de deriva',
    );
    await assert.rejects(
      () => getDoc(doc(c.ownerB.db, `workspaces/${wsA}/investment_drift_reports/2026-08-20_${wsA}`)),
      'ownerB não lê a deriva de A',
    );

    // Coleção do domínio sem bloco próprio: ninguém lê, nem o proprietário.
    await assert.rejects(
      () => getDoc(doc(c.ownerA.db, `workspaces/${wsA}/investment_sem_bloco_proprio/doc-a`)),
      'nem o owner lê coleção de investimento sem bloco próprio',
    );

    // Nenhum papel escreve em nenhuma das três, nem no próprio tenant.
    for (const [name, path] of [
      ['ownerA', `workspaces/${wsA}/cash_report_periods/2026-09`],
      ['adminA', `workspaces/${wsA}/investment_drift_reports/forjado`],
      ['memberA', `workspaces/${wsA}/investment_sem_bloco_proprio/forjado`],
    ]) {
      await assert.rejects(
        () => setDoc(doc(c[name].db, path), {id: 'x', workspaceId: wsA}),
        `${name} não pode escrever em ${path}`,
      );
    }

    // E não escreve no tenant alheio.
    await assert.rejects(
      () => setDoc(doc(c.ownerB.db, `workspaces/${wsA}/cash_report_periods/2026-09`), {netCents: 1}),
      'ownerB não escreve no caixa de A',
    );
  });
});

/**
 * Marca de entrega do gatilho de caixa (INV-P3-001).
 *
 * É a única coisa entre uma reentrega do Eventarc e um delta somado duas vezes
 * em `cash_report_periods`. Um cliente que conseguisse **criá-la** faria o
 * gatilho legítimo pular a aplicação, e o saldo do workspace ficaria para trás
 * em silêncio; um cliente que conseguisse **apagá-la** reabriria a duplicação.
 * Por isso é negada nos dois sentidos, inclusive para o owner do próprio
 * tenant — diferente de `cash_report_periods`, que o membro lê.
 */
test('a marca de entrega do caixa é invisível e inescrevível pelo cliente', async () => {
  await seed();
  const db = getAdmin().firestore();
  const now = ts(NOW);
  const chave = 'a'.repeat(40);

  await Promise.all([
    db.doc(`workspaces/${wsA}/cash_period_events/${chave}`).set({
      id: chave, workspaceId: wsA, entity: 'transaction',
      entityId: 'tx-a', action: 'CREATE', periods: ['2026-08'],
      appliedAt: now, expiresAt: now,
    }),
    db.doc(`workspaces/${wsB}/cash_period_events/${chave}`).set({
      id: chave, workspaceId: wsB, entity: 'transaction',
      entityId: 'tx-b', action: 'CREATE', periods: ['2026-08'],
      appliedAt: now, expiresAt: now,
    }),
  ]);

  await withClients(['ownerA', 'adminA', 'memberA', 'ownerB'], async (c) => {
    for (const papel of ['ownerA', 'adminA', 'memberA']) {
      await assert.rejects(
        () => getDoc(doc(c[papel].db, `workspaces/${wsA}/cash_period_events/${chave}`)),
        `${papel} não lê a marca de entrega do próprio tenant`,
      );
      await assert.rejects(
        () => getDocs(query(
          collection(c[papel].db, `workspaces/${wsA}/cash_period_events`),
          limit(10),
        )),
        `${papel} não lista as marcas de entrega`,
      );
      // Forjar a marca é o ataque que importa: ela decide se o delta é
      // aplicado.
      await assert.rejects(
        () => setDoc(doc(c[papel].db, `workspaces/${wsA}/cash_period_events/forjada`), {
          id: 'forjada', workspaceId: wsA, periods: ['2026-08'],
        }),
        `${papel} não forja marca de entrega`,
      );
      await assert.rejects(
        () => deleteDoc(doc(c[papel].db, `workspaces/${wsA}/cash_period_events/${chave}`)),
        `${papel} não apaga marca de entrega`,
      );
    }
    // Cross-tenant, nos dois sentidos.
    await assert.rejects(
      () => getDoc(doc(c.ownerB.db, `workspaces/${wsA}/cash_period_events/${chave}`)),
      'ownerB não lê a marca de A',
    );
    await assert.rejects(
      () => setDoc(doc(c.ownerA.db, `workspaces/${wsB}/cash_period_events/forjada`), {id: 'x'}),
      'ownerA não escreve marca em B',
    );
  });
});

test('listagem da projeção de caixa respeita o teto declarado', async () => {
  await seed();
  await withClients(['ownerA'], async ({ownerA}) => {
    // 600 meses são 50 anos: acima disso a consulta é negada, o que impede
    // uma listagem arbitrariamente grande de reintroduzir o custo linear que a
    // projeção existe justamente para eliminar.
    await getDocs(query(
      collection(ownerA.db, `workspaces/${wsA}/cash_report_periods`),
      limit(600),
    ));
    await assert.rejects(
      () => getDocs(query(
        collection(ownerA.db, `workspaces/${wsA}/cash_report_periods`),
        limit(601),
      )),
      'listagem acima do teto é negada',
    );
  });
});

// ------------------------------------- P1 — conta, perfil e arquivamento
//
// A autorização P1 exige, além do membership ativo, o perfil `users/{uid}`
// com `status == 'active'` (D-P1-SUSP). É o que fecha a janela do ID token
// ainda vigente depois da suspensão. E um workspace arquivado continua
// legível pelos membros ativos, mas não aceita escrita do cliente.

test('P1 — conta suspensa com membership de owner ativo perde leitura e escrita na mesma sessão', async () => {
  await seed();
  const db = getAdmin().firestore();
  const uid = users.ownerC.uid;
  await withClients(['ownerC'], async ({ownerC}) => {
    const txRef = doc(ownerC.db, `workspaces/${wsC}/transactions/tx-1`);

    // Controle: com a conta ativa, o owner lê (escrita em `transactions` é
    // só do backend desde a P4-D).
    assert.equal((await getDoc(txRef)).exists(), true);

    // O backend suspende a conta. O token da sessão continua válido.
    await db.doc(`users/${uid}`).set({uid, status: 'suspended'});

    await assert.rejects(() => getDoc(txRef), 'conta suspensa não lê transação');
    await assert.rejects(
      () => getDocs(query(collection(ownerC.db, `workspaces/${wsC}/transactions`), limit(10))),
      'conta suspensa não lista transações',
    );
    await assert.rejects(
      () => getDoc(doc(ownerC.db, `workspaces/${wsC}`)),
      'conta suspensa não lê o workspace',
    );
    await assert.rejects(
      () => getDoc(doc(ownerC.db, `workspaces/${wsC}/members/${uid}`)),
      'conta suspensa não lê o próprio membership',
    );
    await assert.rejects(
      () => getDoc(doc(ownerC.db, `users/${uid}/workspaces/${wsC}`)),
      'conta suspensa não lê o índice de participação',
    );
    await assert.rejects(
      () => setDoc(
        doc(ownerC.db, `workspaces/${wsC}/transactions/depois-da-suspensao`),
        clientTransaction(wsC, uid),
      ),
      'conta suspensa não cria transação',
    );
    await assert.rejects(
      () => updateDoc(txRef, {description: 'Editada suspensa', updatedAt: serverTimestamp()}),
      'conta suspensa não edita transação',
    );
    await assert.rejects(
      () => updateDoc(txRef, {
        voidedAt: serverTimestamp(), voidedBy: uid, updatedAt: serverTimestamp(),
      }),
      'conta suspensa não baixa transação',
    );

    // O próprio perfil continua legível: é como a interface descobre a
    // suspensão.
    assert.equal((await getDoc(doc(ownerC.db, `users/${uid}`))).data().status, 'suspended');

    // Controle: reativada pelo backend, a mesma sessão volta a ler.
    await db.doc(`users/${uid}`).set({uid, status: 'active'});
    assert.equal((await getDoc(txRef)).exists(), true);
  });
  const persisted = await db.doc(`workspaces/${wsC}/transactions/tx-1`).get();
  assert.equal(persisted.data().description, 'Semente C');
  assert.equal(persisted.data().voidedAt, undefined);
  assert.equal((await db.doc(`workspaces/${wsC}/transactions/depois-da-suspensao`).get()).exists, false);
});

test('P1 — membership ativo sem documento de perfil não concede acesso', async () => {
  await seed();
  const db = getAdmin().firestore();
  const uid = users.noProfileC.uid;
  await withClients(['noProfileC'], async ({noProfileC}) => {
    const txRef = doc(noProfileC.db, `workspaces/${wsC}/transactions/tx-1`);
    await assert.rejects(() => getDoc(txRef), 'sem perfil não lê transação');
    await assert.rejects(
      () => getDocs(query(collection(noProfileC.db, `workspaces/${wsC}/transactions`), limit(10))),
      'sem perfil não lista transações',
    );
    await assert.rejects(
      () => getDoc(doc(noProfileC.db, `workspaces/${wsC}`)),
      'sem perfil não lê o workspace',
    );
    await assert.rejects(
      () => getDocs(query(collection(noProfileC.db, `workspaces/${wsC}/members`), limit(10))),
      'sem perfil não lista membros',
    );
    await assert.rejects(
      () => setDoc(
        doc(noProfileC.db, `workspaces/${wsC}/transactions/sem-perfil`),
        clientTransaction(wsC, uid),
      ),
      'sem perfil não cria transação',
    );
    await assert.rejects(
      () => updateDoc(txRef, {description: 'Editada sem perfil', updatedAt: serverTimestamp()}),
      'sem perfil não edita transação (papel admin)',
    );

    // Controle: com o perfil ativo criado pelo backend, o mesmo membership
    // passa a valer.
    await db.doc(`users/${uid}`).set({uid, status: 'active'});
    assert.equal((await getDoc(txRef)).exists(), true);
  });
  assert.equal((await db.doc(`workspaces/${wsC}/transactions/sem-perfil`).get()).exists, false);
  assert.equal((await db.doc(`workspaces/${wsC}/transactions/tx-1`).get()).data().description, 'Semente C');
});

test('P1 — workspace arquivado é legível pelos membros e não aceita escrita do cliente', async () => {
  await seed();
  const db = getAdmin().firestore();
  await withClients(['ownerA', 'memberA'], async ({ownerA, memberA}) => {
    const ownerTx = doc(ownerA.db, `workspaces/${wsArchived}/transactions/tx-owner`);
    const memberTx = doc(memberA.db, `workspaces/${wsArchived}/transactions/tx-member`);

    // Leitura preservada para os membros ativos.
    assert.equal((await getDoc(ownerTx)).exists(), true);
    assert.equal((await getDoc(memberTx)).exists(), true);
    assert.equal((await getDoc(doc(ownerA.db, `workspaces/${wsArchived}`))).data().status, 'archived');
    const listed = await getDocs(query(
      collection(ownerA.db, `workspaces/${wsArchived}/transactions`), limit(10),
    ));
    assert.equal(listed.size, 2);

    // Nenhuma escrita do cliente, em nenhum papel.
    await assert.rejects(
      () => setDoc(
        doc(ownerA.db, `workspaces/${wsArchived}/transactions/nova-owner`),
        clientTransaction(wsArchived, users.ownerA.uid),
      ),
      'owner não cria transação em workspace arquivado',
    );
    await assert.rejects(
      () => setDoc(
        doc(memberA.db, `workspaces/${wsArchived}/transactions/nova-member`),
        clientTransaction(wsArchived, users.memberA.uid),
      ),
      'member não cria transação em workspace arquivado',
    );
    await assert.rejects(
      () => updateDoc(ownerTx, {description: 'Editada no arquivo', updatedAt: serverTimestamp()}),
      'owner não edita transação em workspace arquivado',
    );
    await assert.rejects(
      () => updateDoc(memberTx, {description: 'Editada no arquivo', updatedAt: serverTimestamp()}),
      'member não edita a própria transação em workspace arquivado',
    );
    await assert.rejects(
      () => updateDoc(ownerTx, {
        voidedAt: serverTimestamp(), voidedBy: users.ownerA.uid, updatedAt: serverTimestamp(),
      }),
      'owner não baixa transação em workspace arquivado',
    );
    await assert.rejects(
      () => setDoc(doc(memberA.db, `workspaces/${wsArchived}/loans/emprestimo-arquivo`), {
        type: 'lend', status: 'active', personName: 'Contraparte', currentBalance: 100,
      }),
      'member não escreve em módulo adjacente de workspace arquivado',
    );
    await assert.rejects(
      () => setDoc(doc(ownerA.db, `workspaces/${wsArchived}/settings_catalog/class-arquivo`), {
        workspaceId: wsArchived, group: 'investment_class', name: 'Baixo',
        normalizedName: 'baixo', dedupeKey: 'investment_class::all::PF::baixo',
        workspaceScope: 'PF', sortOrder: 1, status: 'active',
        createdBy: users.ownerA.uid, updatedBy: users.ownerA.uid,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      }),
      'owner não grava catálogo de workspace arquivado',
    );
    await assert.rejects(
      () => updateDoc(doc(memberA.db, `workspaces/${wsArchived}/notifications/notif-1`), {read: true}),
      'member não marca notificação de workspace arquivado',
    );
  });

  const persistedOwner = await db.doc(`workspaces/${wsArchived}/transactions/tx-owner`).get();
  assert.equal(persistedOwner.data().description, 'Semente arquivada');
  assert.equal(persistedOwner.data().voidedAt, undefined);
  assert.equal((await db.doc(`workspaces/${wsArchived}/transactions/tx-member`).get()).data().description, 'Semente do membro');
  assert.equal((await db.doc(`workspaces/${wsArchived}/transactions/nova-owner`).get()).exists, false);
  assert.equal((await db.doc(`workspaces/${wsArchived}/notifications/notif-1`).get()).data().read, false);

  // Controle: o que nega a notificação é o arquivamento — reativado pelo
  // backend, o mesmo membro marca a notificação como lida. O catálogo
  // continua fechado ao cliente (D-23, P4-E) e `transactions` também (P4-D).
  await db.doc(`workspaces/${wsArchived}`).update({status: 'active'});
  await withClients(['ownerA', 'memberA'], async ({ownerA, memberA}) => {
    await updateDoc(doc(memberA.db, `workspaces/${wsArchived}/notifications/notif-1`), {read: true});
    await deniedByRules(setDoc(doc(ownerA.db, `workspaces/${wsArchived}/settings_catalog/class-arquivo`), {
      workspaceId: wsArchived, group: 'investment_class', name: 'Baixo',
      normalizedName: 'baixo', dedupeKey: 'investment_class::all::PF::baixo',
      workspaceScope: 'PF', sortOrder: 1, status: 'active',
      createdBy: users.ownerA.uid, updatedBy: users.ownerA.uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    }), 'catálogo segue fechado ao cliente no workspace ativo');
    await deniedByRules(setDoc(
      doc(ownerA.db, `workspaces/${wsArchived}/transactions/nova-owner`),
      clientTransaction(wsArchived, users.ownerA.uid),
    ), 'transactions segue fechada no workspace ativo');
  });
});

// ------------------------------------------------------------------- P3-A

/**
 * Auditoria append-only do caixa (P3-A). Mesmo contrato de
 * `membership_events`: owner e admin leem, com teto de listagem; member,
 * viewer e outro tenant não leem; ninguém escreve, nem o owner.
 */
test('P3-A — auditoria do caixa: leitura de owner e admin, escrita de ninguém', async () => {
  await seed();
  const db = getAdmin().firestore();
  const event = (workspaceId) => ({
    id: 'cash_entry_created_evt', workspaceId, operation: 'cash_entry.created',
    actorId: 'backend', actorRole: 'member', profileType: 'PF', transactionId: 'cash_tx',
    requestHash: 'h'.repeat(64), requestId: 'req-1', createdAt: ts(NOW),
  });
  await Promise.all([
    db.doc(`workspaces/${wsA}/cash_events/evt-a`).set(event(wsA)),
    db.doc(`workspaces/${wsB}/cash_events/evt-b`).set(event(wsB)),
  ]);

  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA', 'removedA', 'ownerB'], async (c) => {
    for (const papel of ['ownerA', 'adminA']) {
      await getDoc(doc(c[papel].db, `workspaces/${wsA}/cash_events/evt-a`));
      await getDocs(query(collection(c[papel].db, `workspaces/${wsA}/cash_events`), limit(100)));
      await assert.rejects(
        () => getDocs(query(collection(c[papel].db, `workspaces/${wsA}/cash_events`), limit(101))),
        `${papel} não lista acima do teto`,
      );
    }
    for (const papel of ['memberA', 'viewerA', 'removedA']) {
      await assert.rejects(
        () => getDoc(doc(c[papel].db, `workspaces/${wsA}/cash_events/evt-a`)),
        `${papel} não lê a auditoria do caixa`,
      );
      await assert.rejects(
        () => getDocs(query(collection(c[papel].db, `workspaces/${wsA}/cash_events`), limit(10))),
        `${papel} não lista a auditoria do caixa`,
      );
    }
    await assert.rejects(
      () => getDoc(doc(c.ownerB.db, `workspaces/${wsA}/cash_events/evt-a`)),
      'ownerB não lê a auditoria de A',
    );
    await assert.rejects(
      () => getDoc(doc(c.ownerA.db, `workspaces/${wsB}/cash_events/evt-b`)),
      'ownerA não lê a auditoria de B',
    );
    for (const papel of ['ownerA', 'adminA', 'memberA']) {
      await assert.rejects(
        () => setDoc(doc(c[papel].db, `workspaces/${wsA}/cash_events/forjado`), {
          ...event(wsA), createdAt: serverTimestamp(),
        }),
        `${papel} não cria evento de auditoria`,
      );
      await assert.rejects(
        () => updateDoc(doc(c[papel].db, `workspaces/${wsA}/cash_events/evt-a`), {actorId: 'outro'}),
        `${papel} não altera evento de auditoria`,
      );
      await assert.rejects(
        () => deleteDoc(doc(c[papel].db, `workspaces/${wsA}/cash_events/evt-a`)),
        `${papel} não apaga evento de auditoria`,
      );
    }
  });
  assert.equal((await db.doc(`workspaces/${wsA}/cash_events/evt-a`).get()).data().actorId, 'backend');
  assert.equal((await db.doc(`workspaces/${wsA}/cash_events/forjado`).get()).exists, false);
});

/**
 * Lançamento criado pela callable de caixa (P3-A): `cashEntry` marca o fato
 * autoritativo. O cliente não o cria com essa marca, não o edita e não o
 * anula — edição e anulação autoritativas dependem de D-35. O controle prova
 * que é a marca que nega: o mesmo documento sem ela segue o caminho legado.
 */
test('P3-A — lançamento com cashEntry não é criado, editado nem anulado pelo cliente', async () => {
  await seed();
  const db = getAdmin().firestore();
  const backendEntry = (userId, overrides = {}) => ({
    type: 'receita', description: 'Salário', category: 'Salário',
    value: 6200, valueCents: 620_000, date: '2026-08-20',
    transactionDate: ts(NOW), isPaid: true, workspaceId: wsA, profileId: wsA,
    profileType: 'PF', userId, createdBy: userId, updatedBy: userId,
    cashEntry: {
      domainVersion: 1, origin: 'manual', status: 'confirmed', currency: 'BRL',
      requestHash: 'h'.repeat(64),
    },
    createdAt: ts(NOW), updatedAt: ts(NOW),
    ...overrides,
  });
  // Só a marca, sem `valueCents`: prova que `cashEntry` sozinho já nega.
  const {valueCents: _omit, ...markerOnly} = backendEntry(users.memberA.uid);
  await Promise.all([
    db.doc(`workspaces/${wsA}/transactions/cash_backend`).set(backendEntry(users.memberA.uid)),
    db.doc(`workspaces/${wsA}/transactions/cash_marker_only`).set(markerOnly),
  ]);

  await withClients(['ownerA', 'adminA', 'memberA'], async (c) => {
    await assert.rejects(
      () => setDoc(
        doc(c.memberA.db, `workspaces/${wsA}/transactions/cash_forjado`),
        clientTransaction(wsA, users.memberA.uid, {
          cashEntry: {domainVersion: 1, origin: 'manual', status: 'confirmed', currency: 'BRL'},
        }),
      ),
      'cliente não cria lançamento com a marca do backend',
    );
    for (const id of ['cash_backend', 'cash_marker_only']) {
      for (const papel of ['ownerA', 'adminA', 'memberA']) {
        const ref = doc(c[papel].db, `workspaces/${wsA}/transactions/${id}`);
        await assert.rejects(
          () => updateDoc(ref, {description: 'Editado', updatedAt: serverTimestamp()}),
          `${papel} não edita ${id}`,
        );
        await assert.rejects(
          () => updateDoc(ref, {
            voidedAt: serverTimestamp(),
            voidedBy: users[papel].uid,
            voidReason: 'Excluída pelo usuário',
            updatedAt: serverTimestamp(),
          }),
          `${papel} não anula ${id}`,
        );
        await assert.rejects(() => deleteDoc(ref), `${papel} não apaga ${id}`);
        await assert.rejects(
          () => updateDoc(ref, {cashEntry: null, updatedAt: serverTimestamp()}),
          `${papel} não remove a marca de ${id}`,
        );
      }
    }
  });

  for (const id of ['cash_backend', 'cash_marker_only']) {
    const stored = (await db.doc(`workspaces/${wsA}/transactions/${id}`).get()).data();
    assert.equal(stored.description, 'Salário');
    assert.equal(stored.voidedAt, undefined);
    assert.equal(stored.cashEntry.origin, 'manual');
  }
  assert.equal((await db.doc(`workspaces/${wsA}/transactions/cash_forjado`).get()).exists, false);
});

/**
 * Estados que a correção e a anulação do backend produzem (P3-C, D-35): o
 * lançamento corrigido (revisão 2) e o anulado (`voidedAt` +
 * `cashEntry.status: voided`). O cliente não edita, não reativa, não apaga e
 * não forja a trilha. (P4-D: a adoção `legacy_manual` saiu.)
 */
test('P3-C — lançamento corrigido e anulado pelo backend ficam fora do cliente', async () => {
  await seed();
  const db = getAdmin().firestore();
  const corrected = (userId, overrides = {}) => ({
    type: 'despesa', description: 'Compra', category: 'Mercado',
    value: 160, valueCents: 16_000, date: '2026-08-20',
    transactionDate: ts(NOW), isPaid: true, workspaceId: wsA, profileId: wsA,
    profileType: 'PF', userId, createdBy: userId, updatedBy: userId, cashAccountId: 'acc-1',
    cashEntry: {
      domainVersion: 1, origin: 'manual', status: 'confirmed', currency: 'BRL',
      requestHash: 'h'.repeat(64), revision: 2, accountMovementId: 'camv-1',
    },
    createdAt: ts(NOW), updatedAt: ts(NOW),
    ...overrides,
  });
  const voided = corrected(users.memberA.uid, {
    voidedAt: ts(NOW), voidedBy: users.memberA.uid,
    voidReason: 'Lançado em duplicidade',
    cashEntry: {
      domainVersion: 1, origin: 'manual', status: 'voided', currency: 'BRL',
      requestHash: 'h'.repeat(64), revision: 3, accountMovementId: null,
    },
  });
  await Promise.all([
    db.doc(`workspaces/${wsA}/transactions/cash_corrected`).set(corrected(users.memberA.uid)),
    db.doc(`workspaces/${wsA}/transactions/cash_voided`).set(voided),
  ]);

  await withClients(['ownerA', 'adminA', 'memberA'], async (c) => {
    for (const id of ['cash_corrected', 'cash_voided']) {
      for (const papel of ['ownerA', 'adminA', 'memberA']) {
        const ref = doc(c[papel].db, `workspaces/${wsA}/transactions/${id}`);
        await deniedByRules(
          updateDoc(ref, {value: 1, updatedAt: serverTimestamp()}),
          `${papel} não corrige ${id}`,
        );
        await deniedByRules(
          updateDoc(ref, {
            voidedAt: deleteField(), voidedBy: deleteField(),
            voidReason: deleteField(), updatedAt: serverTimestamp(),
          }),
          `${papel} não reativa ${id}`,
        );
        await deniedByRules(
          updateDoc(ref, {'cashEntry.status': 'confirmed', updatedAt: serverTimestamp()}),
          `${papel} não troca o estado de ${id}`,
        );
        await deniedByRules(deleteDoc(ref), `${papel} não apaga ${id}`);
      }
    }
    await deniedByRules(
      setDoc(doc(c.ownerA.db, `workspaces/${wsA}/cash_events/forjado`), {
        operation: 'cash_entry.updated', transactionId: 'cash_corrected',
      }),
      'cliente não grava evento de correção',
    );
  });

  const storedCorrected = (await db.doc(`workspaces/${wsA}/transactions/cash_corrected`).get()).data();
  assert.equal(storedCorrected.valueCents, 16_000);
  assert.equal(storedCorrected.cashEntry.status, 'confirmed');
  const storedVoided = (await db.doc(`workspaces/${wsA}/transactions/cash_voided`).get()).data();
  assert.ok(storedVoided.voidedAt);
  assert.equal(storedVoided.cashEntry.status, 'voided');
  assert.equal((await db.doc(`workspaces/${wsA}/cash_events/forjado`).get()).exists, false);
});

test('P4-D — estado de quota é server-only; nenhum papel escreve em transactions', async () => {
  // A janela `ledger_write_freeze` (P3-F) existia para a inicialização de
  // quota de workspaces anteriores à âncora; saiu com ela. O que fica:
  // `quota_state` não é lido nem escrito pelo cliente, e nenhum papel cria
  // ou altera lançamento — inclusive em lote.
  await seed();
  const db = getAdmin().firestore();
  const existing = `workspaces/${wsA}/transactions/tx-1`;
  await db.doc(`workspaces/${wsA}/quota_state/transactions`).set({
    workspaceId: wsA, trackingSince: '2026-08', origin: 'workspace_created', initialUsed: 0,
    schemaVersion: 1, createdAt: ts(NOW),
  });
  await withClients(['ownerA', 'adminA', 'memberA'], async (clients) => {
    for (const [name, client] of Object.entries(clients)) {
      const user = users[name];
      await deniedByRules(setDoc(doc(client.db, `workspaces/${wsA}/transactions/novo-${name}`),
        clientTransaction(wsA, user.uid)), `${name} não cria`);
      await deniedByRules(updateDoc(doc(client.db, existing), {value: 1, updatedAt: serverTimestamp()}),
        `${name} não altera`);
      const batch = writeBatch(client.db);
      for (let index = 0; index < 3; index += 1) {
        batch.set(doc(client.db, `workspaces/${wsA}/transactions/lote-${name}-${index}`),
          clientTransaction(wsA, user.uid, {description: `Lançamento ${index + 1}`}));
      }
      await deniedByRules(batch.commit(), `${name} não cria em lote`);
      for (const quotaDoc of ['transactions', 'transactions_2026-08', 'ledger_write_freeze']) {
        await deniedByRules(getDoc(doc(client.db, `workspaces/${wsA}/quota_state/${quotaDoc}`)),
          `${name} não lê quota_state/${quotaDoc}`);
        await deniedByRules(setDoc(doc(client.db, `workspaces/${wsA}/quota_state/${quotaDoc}`), {
          workspaceId: wsA,
        }), `${name} não escreve quota_state/${quotaDoc}`);
      }
    }
  });
  assert.equal((await db.doc(existing).get()).data().value, 10);
  const created = await db.collection(`workspaces/${wsA}/transactions`).get();
  assert.equal(created.docs.some((entry) => entry.id.startsWith('novo-') || entry.id.startsWith('lote-')), false);
});

test('P3-H — empréstimos só pelo backend: nenhum papel cria, altera nem apaga; leituras autorizadas seguem; auditoria e espelho server-only', async () => {
  await seed();
  const db = getAdmin().firestore();
  const now = admin.firestore.Timestamp.now();
  const loanPath = `workspaces/${wsA}/loans/loan_autoritativo`;
  const movementPath = `workspaces/${wsA}/loan_movements/lmv_autoritativo`;
  const eventPath = `workspaces/${wsA}/loan_events/loan_created_autoritativo`;
  const mirrorPath = `workspaces/${wsA}/transactions/loancash_autoritativo`;
  const loanDoc = {
    id: 'loan_autoritativo', schemaVersion: 1, workspaceId: wsA, profileType: 'PF',
    type: 'borrow', personName: 'Banco', principalCents: 300000, balanceCents: 300000,
    totalPrincipalSettledCents: 0, totalInterestSettledCents: 0, activePaymentCount: 0,
    status: 'active', createdBy: users.memberA.uid, updatedAt: now,
  };
  await db.doc(loanPath).set(loanDoc);
  await db.doc(movementPath).set({
    id: 'lmv_autoritativo', schemaVersion: 1, workspaceId: wsA, loanId: 'loan_autoritativo',
    kind: 'disbursement', principalCents: 300000, interestCents: 0, date: '2026-08-20',
    createdBy: users.memberA.uid,
  });
  await db.doc(eventPath).set({id: 'loan_created_autoritativo', operation: 'loan.created',
    workspaceId: wsA, loanId: 'loan_autoritativo'});
  await db.doc(mirrorPath).set({
    type: 'receita', description: 'Empréstimo recebido', category: 'Empréstimos',
    value: 3000, valueCents: 300000, date: '2026-08-20', transactionDate: now, isPaid: true,
    workspaceId: wsA, profileId: wsA, userId: users.memberA.uid, source: 'loan',
    loanEntry: {domainVersion: 1, loanId: 'loan_autoritativo', loanMovementId: 'lmv_autoritativo',
      loanType: 'borrow', kind: 'disbursement', reversal: false, principalCents: 300000,
      interestCents: 0, currency: 'BRL'},
    createdAt: now, updatedAt: now,
  });
  // Formato que a interface anterior gravava: nem ele passa mais.
  const plainLoan = {
    profileId: wsA, type: 'borrow', personName: 'Fulano', description: 'Contrato',
    principalValue: 1000, currentBalance: 1000, totalPaidReceived: 0,
    totalInterestPaidReceived: 0, startDate: '2026-01-10', expectedPayoffDate: '2026-12-10',
    paymentMethod: 'PIX', status: 'active', interestType: 'none', hasInstallments: false,
  };
  const plainMovement = {loanId: 'loan_autoritativo', type: 'payment', amount: 100,
    date: '2026-02-10', description: 'Parcela'};
  const existingTransaction = `workspaces/${wsA}/transactions/comum-p3h`;
  await db.doc(existingTransaction).set({
    ...clientTransaction(wsA, users.ownerA.uid), transactionDate: ts(NOW), createdAt: ts(NOW), updatedAt: ts(NOW),
  });

  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA', 'ownerB'], async (c) => {
    for (const name of ['ownerA', 'adminA', 'memberA', 'viewerA']) {
      const client = c[name].db;
      // Criação: nenhum formato, nenhum papel.
      await assert.rejects(() => setDoc(doc(client, `workspaces/${wsA}/loans/novo-${name}`), plainLoan),
        `${name} não cria contrato`);
      await assert.rejects(() => setDoc(doc(client, `workspaces/${wsA}/loans/forjado-${name}`),
        {...loanDoc, id: `forjado-${name}`, updatedAt: clientTs(NOW)}),
      `${name} não forja contrato autoritativo`);
      // Alteração (financeira ou não) e exclusão.
      for (const patch of [{description: 'x'}, {personName: 'Outro'}, {balanceCents: 0},
        {status: 'paid'}, {currentBalance: 0}]) {
        await assert.rejects(() => updateDoc(doc(client, loanPath), patch),
          `${name} não altera ${Object.keys(patch)}`);
      }
      await assert.rejects(() => setDoc(doc(client, loanPath), {description: 'x'}, {merge: true}),
        `${name} não mescla no contrato`);
      await assert.rejects(() => deleteDoc(doc(client, loanPath)), `${name} não apaga contrato`);
      // Movimentos.
      await assert.rejects(() => setDoc(doc(client, `workspaces/${wsA}/loan_movements/novo-${name}`),
        plainMovement), `${name} não cria movimento`);
      await assert.rejects(() => updateDoc(doc(client, movementPath), {reversedBy: 'x'}),
        `${name} não liga estorno`);
      await assert.rejects(() => deleteDoc(doc(client, movementPath)), `${name} não apaga movimento`);
      // Lote: nem dentro de um batch.
      const batch = writeBatch(client);
      batch.set(doc(client, `workspaces/${wsA}/loans/lote-${name}`), plainLoan);
      batch.set(doc(client, `workspaces/${wsA}/loan_movements/lote-${name}`), plainMovement);
      await assert.rejects(() => batch.commit(), `${name} não grava empréstimo em lote`);
      // Auditoria: só o backend.
      await assert.rejects(() => setDoc(doc(client, `workspaces/${wsA}/loan_events/forjado-${name}`),
        {operation: 'loan.created'}), `${name} não escreve auditoria`);
      // Caixa: nem espelho com a marca, nem vínculo de empréstimo, nem
      // alteração do espelho do backend.
      await assert.rejects(() => setDoc(doc(client, `workspaces/${wsA}/transactions/espelho-${name}`),
        clientTransaction(wsA, users[name].uid, {loanEntry: {loanId: 'loan_autoritativo'}})),
      `${name} não cria espelho com loanEntry`);
      await assert.rejects(() => setDoc(doc(client, `workspaces/${wsA}/transactions/vinculo-${name}`),
        clientTransaction(wsA, users[name].uid, {loanId: 'loan_autoritativo'})),
      `${name} não cria lançamento vinculado a empréstimo`);
      await assert.rejects(() => setDoc(doc(client, `workspaces/${wsA}/transactions/movimento-${name}`),
        clientTransaction(wsA, users[name].uid, {loanMovementId: 'lmv_autoritativo'})),
      `${name} não cria lançamento vinculado a movimento`);
      await assert.rejects(() => updateDoc(doc(client, mirrorPath), {value: 1, updatedAt: serverTimestamp()}),
        `${name} não altera o espelho`);
    }
    // Lançamento comum existente: o vínculo também não entra por update.
    await assert.rejects(() => updateDoc(doc(c.ownerA.db, existingTransaction),
      {loanId: 'loan_autoritativo', updatedAt: serverTimestamp()}), 'vínculo não entra por update');
    // P4-D: nem o update comum, sem vínculo, é aceito.
    await deniedByRules(updateDoc(doc(c.ownerA.db, existingTransaction),
      {description: 'Compra revisada', updatedAt: serverTimestamp()}), 'update comum');

    // Leituras autorizadas seguem: todo membro lê contrato e movimento.
    for (const name of ['ownerA', 'adminA', 'memberA', 'viewerA']) {
      assert.equal((await getDoc(doc(c[name].db, loanPath))).exists(), true, `${name} lê contrato`);
      assert.equal((await getDoc(doc(c[name].db, movementPath))).exists(), true, `${name} lê movimento`);
      const page = await getDocs(query(collection(c[name].db, `workspaces/${wsA}/loans`), limit(101)));
      assert.equal(page.size, 1, `${name} lista contratos`);
    }
    // Outro tenant não lê.
    await assert.rejects(() => getDoc(doc(c.ownerB.db, loanPath)), 'ownerB não lê contrato de A');
    await assert.rejects(() => getDoc(doc(c.ownerB.db, movementPath)), 'ownerB não lê movimento de A');
    // Auditoria: só owner/admin, com teto de listagem.
    assert.equal((await getDoc(doc(c.ownerA.db, eventPath))).exists(), true);
    assert.equal((await getDoc(doc(c.adminA.db, eventPath))).exists(), true);
    await assert.rejects(() => getDoc(doc(c.memberA.db, eventPath)), 'member não lê auditoria');
    await assert.rejects(() => getDoc(doc(c.viewerA.db, eventPath)), 'viewer não lê auditoria');
    await getDocs(query(collection(c.ownerA.db, `workspaces/${wsA}/loan_events`), limit(100)));
    await assert.rejects(() => getDocs(query(collection(c.ownerA.db, `workspaces/${wsA}/loan_events`),
      limit(101))), 'listagem da auditoria tem teto');
  });
  // Nada mudou no que o backend gravou.
  assert.deepEqual((await db.doc(loanPath).get()).data(), loanDoc);
  assert.equal((await db.doc(movementPath).get()).get('reversedBy'), undefined);
  assert.equal((await db.doc(mirrorPath).get()).data().valueCents, 300000);
  assert.equal((await db.collection(`workspaces/${wsA}/loans`).get()).size, 1);
  assert.equal((await db.collection(`workspaces/${wsA}/loan_movements`).get()).size, 1);
});
