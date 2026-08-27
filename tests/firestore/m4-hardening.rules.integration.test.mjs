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
  getDoc,
  getDocs,
  getFirestore,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp as ClientTimestamp,
  updateDoc,
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
};
const wsA = 'm4-workspace-a';
const wsB = 'm4-workspace-b';

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
  walletId: 'wallet-1',
  isPaid: true,
  supplier: 'Mercado',
  costCenter: 'Casa',
  paymentMethod: 'pix',
  expenseType: 'variavel',
  installments: 1,
  currentInstallment: 1,
  source: 'manual',
  userId,
  workspaceId,
  profileId: workspaceId,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
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
  }
  await Promise.all([
    db.recursiveDelete(db.doc(`workspaces/${wsA}`)),
    db.recursiveDelete(db.doc(`workspaces/${wsB}`)),
  ]);
  await Promise.all([
    db.doc(`workspaces/${wsA}`).set({ownerId: users.ownerA.uid, type: 'PF', name: 'A', currency: 'BRL'}),
    db.doc(`workspaces/${wsB}`).set({ownerId: users.ownerB.uid, type: 'PJ', name: 'B', currency: 'BRL'}),
  ]);
  await Promise.all([
    db.doc(`workspaces/${wsA}/members/${users.ownerA.uid}`).set({uid: users.ownerA.uid, role: 'owner', status: 'active'}),
    db.doc(`workspaces/${wsA}/members/${users.adminA.uid}`).set({uid: users.adminA.uid, role: 'admin', status: 'active'}),
    db.doc(`workspaces/${wsA}/members/${users.memberA.uid}`).set({uid: users.memberA.uid, role: 'member', status: 'active'}),
    db.doc(`workspaces/${wsA}/members/${users.viewerA.uid}`).set({uid: users.viewerA.uid, role: 'viewer', status: 'active'}),
    db.doc(`workspaces/${wsA}/members/${users.removedA.uid}`).set({uid: users.removedA.uid, role: 'member', status: 'removed'}),
    db.doc(`workspaces/${wsB}/members/${users.ownerB.uid}`).set({uid: users.ownerB.uid, role: 'owner', status: 'active'}),
    db.doc(`workspaces/${wsB}/members/${users.memberB.uid}`).set({uid: users.memberB.uid, role: 'member', status: 'active'}),
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
      'Apagar o membership do owner muda o regime de acesso dele.',
    );
  });
});

test('M4 — admin não reescreve ownerId, type nem features do workspace', async () => {
  await seed();
  await withClients(['adminA'], async ({adminA}) => {
    for (const patch of [
      {ownerId: users.adminA.uid},
      {type: 'PJ'},
      {features: {qualquerRecurso: {enabled: true}}},
    ]) {
      await assert.rejects(
        () => updateDoc(doc(adminA.db, `workspaces/${wsA}`), patch),
        `Campo crítico do workspace não pode mudar: ${Object.keys(patch)[0]}.`,
      );
    }
    // Campo não crítico continua editável, para não quebrar Configurações.
    await updateDoc(doc(adminA.db, `workspaces/${wsA}`), {name: 'Renomeado'});
  });
  const stored = await getAdmin().firestore().doc(`workspaces/${wsA}`).get();
  assert.equal(stored.data().ownerId, users.ownerA.uid);
  assert.equal(stored.data().type, 'PF');
  assert.equal(stored.data().name, 'Renomeado');
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

test('M4 — campos imutáveis de uma transação não mudam em update', async () => {
  await seed();
  await withClients(['ownerA'], async ({ownerA}) => {
    const ref = doc(ownerA.db, `workspaces/${wsA}/transactions/mutable-tx`);
    await setDoc(ref, clientTransaction(wsA, users.ownerA.uid));

    // Edição legítima do frontend continua funcionando.
    await updateDoc(ref, {description: 'Compra editada', value: 200, updatedAt: serverTimestamp()});

    for (const patch of [
      {workspaceId: wsB},
      {userId: users.memberA.uid},
      {profileId: wsB},
      {valueCents: 123},
      {createdAt: clientTs(NOW)},
    ]) {
      await assert.rejects(
        () => updateDoc(ref, patch),
        `Campo imutável não pode mudar: ${Object.keys(patch)[0]}.`,
      );
    }
  });
  const stored = await getAdmin().firestore().doc(`workspaces/${wsA}/transactions/mutable-tx`).get();
  assert.equal(stored.data().description, 'Compra editada');
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
    for (const [collectionName, docId] of [
      ['investment_snapshots', 'snap-1'],
      ['investment_event_logs', 'event-1'],
    ]) {
      assert.equal((await getDoc(doc(c.ownerA.db, `workspaces/${wsA}/${collectionName}/${docId}`))).exists(), true);
      assert.equal((await getDoc(doc(c.adminA.db, `workspaces/${wsA}/${collectionName}/${docId}`))).exists(), true);
      await assert.rejects(() => getDoc(doc(c.memberA.db, `workspaces/${wsA}/${collectionName}/${docId}`)));
      await assert.rejects(() => getDoc(doc(c.viewerA.db, `workspaces/${wsA}/${collectionName}/${docId}`)));
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

test('M4 — o fluxo legítimo do frontend continua criando e editando transações', async () => {
  await seed();
  await withClients(['ownerA', 'adminA', 'memberA'], async (clients) => {
    for (const [name, client] of Object.entries(clients)) {
      const user = users[`${name}`];
      const ref = doc(client.db, `workspaces/${wsA}/transactions/regression-${name}`);
      await setDoc(ref, clientTransaction(wsA, user.uid));
      await updateDoc(ref, {value: 99.9, description: 'Editado', updatedAt: serverTimestamp()});
      const stored = await getDoc(ref);
      assert.equal(stored.data().value, 99.9);
    }
  });
});

test('M4 — catálogo e metas seguem com o comportamento anterior', async () => {
  await seed();
  await withClients(['ownerA', 'memberA'], async ({ownerA, memberA}) => {
    // Owner/admin continuam mantendo o catálogo.
    await setDoc(doc(ownerA.db, `workspaces/${wsA}/settings_catalog/catalog-2`), {
      workspaceId: wsA, group: 'investment_class', name: 'Multimercado',
      normalizedName: 'multimercado', dedupeKey: `${wsA}|investment_class|multimercado`,
      workspaceScope: 'PF', sortOrder: 2, status: 'active',
      createdBy: users.ownerA.uid, updatedBy: users.ownerA.uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
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

test('M4 — owner legítimo mantém a gestão de membros', async () => {
  await seed();
  await withClients(['ownerA'], async ({ownerA}) => {
    await setDoc(doc(ownerA.db, `workspaces/${wsA}/members/${users.viewerA.uid}`), {
      uid: users.viewerA.uid, role: 'member', status: 'active',
    });
    await updateDoc(doc(ownerA.db, `workspaces/${wsA}/members/${users.memberA.uid}`), {role: 'admin'});
    await deleteDoc(doc(ownerA.db, `workspaces/${wsA}/members/${users.removedA.uid}`));
  });
  const db = getAdmin().firestore();
  assert.equal((await db.doc(`workspaces/${wsA}/members/${users.memberA.uid}`).get()).data().role, 'admin');
  assert.equal((await db.doc(`workspaces/${wsA}/members/${users.removedA.uid}`).get()).exists, false);
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
    await assert.rejects(
      () => setDoc(doc(ownerA.db, `workspaces/${wsA}/transactions/legacy-v2-1`), aporte(users.ownerA.uid)),
      'owner não pode gravar transação de investimento direto',
    );
    await assert.rejects(
      () => setDoc(doc(memberA.db, `workspaces/${wsA}/transactions/legacy-v2-2`), aporte(users.memberA.uid)),
      'member não pode gravar transação de investimento direto',
    );

    // Receita e despesa seguem inalteradas: a negação é só do tipo investimento.
    await setDoc(doc(ownerA.db, `workspaces/${wsA}/transactions/receita-v2-1`), {
      type: 'receita', description: 'Salário', category: 'Salário',
      value: 500, date: '2026-08-20', userId: users.ownerA.uid,
      workspaceId: wsA, profileId: wsA,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  });
});

// ------------------------------------------------------- INV-P1-002 / P2-049
//
// A barreira fechava apenas `create`. O cliente criava uma `despesa` (aceita) e
// a atualizava para `investimento` — aceito, porque `type` estava na lista de
// chaves mutáveis e nenhum dos ramos de `allow update` chamava
// `isLegacyInvestmentWriteAllowed`.

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
      const ref = doc(c[name].db, `workspaces/${wsA}/transactions/${docId}`);

      // A despesa é aceita, como sempre foi.
      await setDoc(ref, clientTransaction(wsA, user.uid, {
        description: 'Despesa que tenta virar investimento',
      }));

      await assert.rejects(
        () => updateDoc(ref, {type: 'investimento'}),
        `${name} não pode trocar o tipo de uma transação para investimento`,
      );

      const persisted = await db
        .doc(`workspaces/${wsA}/transactions/${docId}`)
        .get();
      assert.equal(persisted.data().type, 'despesa');
    }
  });
});

test('INV-P1-002 — troca de tipo é negada para qualquer tipo alvo', async () => {
  await seed();
  await withClients(['ownerA'], async ({ownerA}) => {
    const ref = doc(ownerA.db, `workspaces/${wsA}/transactions/tipo-imutavel`);
    await setDoc(ref, clientTransaction(wsA, users.ownerA.uid));

    // Trocar o tipo de uma transação existente não é operação do produto: o
    // modal só oferece o tipo original quando está editando.
    await assert.rejects(
      () => updateDoc(ref, {type: 'receita'}),
      'tipo é imutável mesmo sem a flag',
    );
  });
});

test('INV-P2-049 — update com payload máximo de chaves mutáveis continua aceito', async () => {
  await seed();
  await withClients(['ownerA', 'memberA'], async (c) => {
    for (const [name, user] of [
      ['ownerA', users.ownerA],
      ['memberA', users.memberA],
    ]) {
      const ref = doc(c[name].db, `workspaces/${wsA}/transactions/teto-${name}`);
      await setDoc(ref, clientTransaction(wsA, user.uid));

      // Toda chave mutável de uma vez: é o pior caso de custo de avaliação da
      // regra de `update`, que já operava no teto de 1.000 expressões.
      await updateDoc(ref, {
        description: 'Descrição atualizada com texto bem mais longo que o anterior',
        category: 'Educação',
        value: 987.65,
        date: '2026-08-21',
        transactionDate: clientTs('2026-08-21T15:00:00.000Z'),
        installments: 3,
        currentInstallment: 2,
        cardId: 'card-9',
        walletId: 'wallet-9',
        loanId: 'loan-9',
        loanMovementId: 'loan-mov-9',
        expenseType: 'fixa',
        incomeType: 'servico',
        paymentMethod: 'boleto',
        isPaid: false,
        supplier: 'Fornecedor Atualizado',
        costCenter: 'Centro Atualizado',
        source: 'manual',
        creditCardInvoiceId: 'inv-9',
        creditCardInvoicePaymentId: 'pay-9',
        creditCardCompatibility: {
          source: 'credit_card_invoice',
          invoiceId: 'inv-9',
          cardId: 'card-9',
          competenceMonth: '2026-08',
          invoiceStatus: 'open',
          isProjection: true,
        },
        displaySnapshots: {
          categorySnapshot: {
            group: 'category',
            label: 'Educação',
            normalizedLabel: 'educacao',
          },
        },
        updatedAt: serverTimestamp(),
      });
    }
  });
});

// ------------------------------------------------------------- INV-P2-032

test('INV-P2-032 — delete de transação é negado; a baixa é lógica', async () => {
  await seed();
  await withClients(['ownerA', 'adminA', 'memberA'], async (c) => {
    for (const [name, user] of [
      ['ownerA', users.ownerA],
      ['adminA', users.adminA],
      ['memberA', users.memberA],
    ]) {
      const docId = `soft-delete-${name}`;
      const ref = doc(c[name].db, `workspaces/${wsA}/transactions/${docId}`);
      await setDoc(ref, clientTransaction(wsA, user.uid));

      await assert.rejects(
        () => deleteDoc(ref),
        `${name} não pode apagar histórico financeiro`,
      );

      // A baixa lógica é o caminho aceito, e carrega quem baixou.
      await updateDoc(ref, {
        voidedAt: serverTimestamp(),
        voidedBy: user.uid,
        voidReason: 'Excluída pelo usuário',
        updatedAt: serverTimestamp(),
      });

      const persisted = await getAdmin()
        .firestore()
        .doc(`workspaces/${wsA}/transactions/${docId}`)
        .get();
      assert.ok(persisted.exists);
      assert.equal(persisted.data().voidedBy, user.uid);

      // Depois de baixada, a transação não volta a ser editável.
      await assert.rejects(
        () => updateDoc(ref, {description: 'Tentando reviver'}),
        'transação baixada não aceita mais edição',
      );
    }
  });
});

test('INV-P2-032 — baixa lógica não aceita forjar o autor da baixa', async () => {
  await seed();
  await withClients(['ownerA'], async ({ownerA}) => {
    const ref = doc(ownerA.db, `workspaces/${wsA}/transactions/void-forjado`);
    await setDoc(ref, clientTransaction(wsA, users.ownerA.uid));

    await assert.rejects(
      () => updateDoc(ref, {
        voidedAt: serverTimestamp(),
        voidedBy: users.memberA.uid,
        updatedAt: serverTimestamp(),
      }),
      'voidedBy precisa ser o próprio autor da requisição',
    );
  });
});

// ------------------------------------------------------------- INV-P1-013

test('INV-P1-013 — usuário autenticado não concede a si mesmo o plano pago', async () => {
  await seed();
  const db = getAdmin().firestore();
  await db.doc(`users/${users.ownerA.uid}`).set({
    displayName: 'Owner A',
    planId: 'free',
    isPro: false,
  });

  await withClients(['ownerA'], async ({ownerA}) => {
    const ref = doc(ownerA.db, `users/${users.ownerA.uid}`);

    for (const forged of [
      {planId: 'pro'},
      {isPro: true},
      {planId: 'pro', isPro: true},
      {isAdmin: true},
      {stripeCustomerId: 'cus_forjado'},
      {subscriptionStatus: 'active'},
      {entitlements: {pro: true}},
    ]) {
      await assert.rejects(
        () => setDoc(ref, forged, {merge: true}),
        `campo server-owned não pode ser gravado pelo cliente: ${Object.keys(forged).join(',')}`,
      );
    }

    // Edição legítima de perfil continua funcionando.
    await setDoc(ref, {
      displayName: 'Owner Atualizado',
      photoURL: 'https://example.test/avatar.png',
      locale: 'pt-BR',
      updatedAt: serverTimestamp(),
    }, {merge: true});

    const persisted = await db.doc(`users/${users.ownerA.uid}`).get();
    assert.equal(persisted.data().displayName, 'Owner Atualizado');
    assert.equal(persisted.data().planId, 'free');
    assert.equal(persisted.data().isPro, false);

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
});

test('INV-P1-013 — backend continua sendo a fonte de entitlement', async () => {
  await seed();
  const db = getAdmin().firestore();

  // O Admin SDK — usado pelo webhook do Stripe — ignora as Rules.
  await db.doc(`users/${users.ownerA.uid}`).set({
    displayName: 'Owner A',
    planId: 'pro',
    isPro: true,
    stripeCustomerId: 'cus_legitimo',
  });

  await withClients(['ownerA'], async ({ownerA}) => {
    const snapshot = await getDoc(doc(ownerA.db, `users/${users.ownerA.uid}`));
    assert.equal(snapshot.data().planId, 'pro');

    // E o usuário pago continua editando o próprio perfil sem perder o plano.
    await setDoc(doc(ownerA.db, `users/${users.ownerA.uid}`), {
      displayName: 'Owner Pago',
      updatedAt: serverTimestamp(),
    }, {merge: true});

    const after = await db.doc(`users/${users.ownerA.uid}`).get();
    assert.equal(after.data().displayName, 'Owner Pago');
    assert.equal(after.data().planId, 'pro');
    assert.equal(after.data().isPro, true);
  });
});

// ------------------------------------------------------------- INV-P3-053

test('INV-P3-053 — workspace, membro e transação rejeitam campos arbitrários', async () => {
  await seed();
  await withClients(['ownerA'], async ({ownerA}) => {
    await assert.rejects(
      () => updateDoc(doc(ownerA.db, `workspaces/${wsA}`), {campoArbitrario: 'x'}),
      'workspace não aceita campo fora da allowlist',
    );

    await assert.rejects(
      () => setDoc(doc(ownerA.db, `workspaces/${wsA}/members/${users.memberA.uid}`), {
        uid: users.memberA.uid,
        role: 'member',
        campoArbitrario: 'x',
      }),
      'membership não aceita campo fora da allowlist',
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

    // O caminho legítimo segue aceito.
    await updateDoc(doc(ownerA.db, `workspaces/${wsA}`), {
      name: 'Workspace Renomeado',
      themeColor: '#123456',
      updatedAt: serverTimestamp(),
    });
  });
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
