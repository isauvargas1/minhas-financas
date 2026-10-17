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
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

/**
 * P4-D (D-15, PR-TX-01/02/05, PR-INV-01) — Rules de `transactions` fechadas
 * ao cliente e do domínio de investimentos contra o Emulator.
 *
 * - Nenhum papel (owner, admin, member, viewer), nem membro removido, nem
 *   dono de outro workspace cria, altera ou apaga documento algum em
 *   `transactions`: nem tipo comum, nem `investimento` (com ou sem marca),
 *   nem o espelho gravado pelo backend.
 * - Todo membro ativo lê `transactions` (viewer incluído); nada atravessa o
 *   workspace.
 * - Domínio patrimonial: nenhum papel escreve; movimento e posição são de
 *   owner/admin/member; o agregado mensal do card do dashboard
 *   (`investment_report_periods`) é de todo membro ativo, na consulta exata
 *   do frontend.
 * - Coleções removidas (valoração, snapshot, lote de importação) não têm
 *   regra: leitura e escrita negadas a todos.
 * - Catálogo: os grupos técnicos de investimento removidos não são aceitos;
 *   a carteira de investimentos e a instituição continuam.
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da P4-D.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-p4d-123456';

const users = {
  ownerA: {uid: 'p4d-owner-a', email: 'p4d-owner-a@example.test'},
  adminA: {uid: 'p4d-admin-a', email: 'p4d-admin-a@example.test'},
  memberA: {uid: 'p4d-member-a', email: 'p4d-member-a@example.test'},
  viewerA: {uid: 'p4d-viewer-a', email: 'p4d-viewer-a@example.test'},
  removedA: {uid: 'p4d-removed-a', email: 'p4d-removed-a@example.test'},
  ownerB: {uid: 'p4d-owner-b', email: 'p4d-owner-b@example.test'},
};
const wsA = 'p4d-workspace-a';
const wsB = 'p4d-workspace-b';
const ACCOUNT = 'acc_main';
const MOVEMENT = 'imov_contribution';
const PENDING_MOVEMENT = 'imov_pending';
const ACCOUNT_MOVEMENT = 'camv_investment_imov_contribution';
const MIRROR = 'investment_mirror_settled';
const PENDING_MIRROR = 'investment_mirror_pending';
const MANUAL = 'cash_manual_1';
const PERIOD = '2026-10';
const ROLES = ['ownerA', 'adminA', 'memberA', 'viewerA', 'removedA', 'ownerB'];

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const ts = (iso = '2026-10-05T12:00:00.000Z') =>
  getAdmin().firestore.Timestamp.fromDate(new Date(iso));

const investmentEntry = (status, overrides = {}) => ({
  domainVersion: 1, movementId: MOVEMENT, operation: 'contribution', reversal: false,
  reversalOf: null, status, principalCents: 150_000, gainCents: 0, amountCents: 150_000,
  currency: 'BRL', ...overrides,
});

const mirror = (ws, owner, status) => ({
  type: 'investimento', description: 'CDB Banco X', category: 'Investimentos',
  valueCents: 150_000, date: '2026-10-05',
  isPaid: status === 'settled', workspaceId: ws, profileId: ws, profileType: 'PF',
  userId: owner, source: 'investment',
  investmentEntry: investmentEntry(status, status === 'settled' ? {} : {movementId: PENDING_MOVEMENT}),
  ...(status === 'settled' ? {cashAccountId: ACCOUNT, accountMovementId: ACCOUNT_MOVEMENT} : {}),
  createdBy: owner, createdAt: ts(), updatedBy: owner, updatedAt: ts(),
});

const movement = (ws, owner, id, status) => ({
  id, workspaceId: ws, profileType: 'PF', domainVersion: 2, calculationVersion: 'simple-v1',
  accountId: 'iacc_1', assetId: 'iast_1', positionId: 'iacc_1__iast_1', operation: 'contribution',
  status, currency: 'BRL', description: 'CDB Banco X', principalCents: 150_000, gainCents: 0,
  feesCents: 0, taxCents: 0, quantityMicros: 150_000_000_000,
  cashDeltaCents: status === 'settled' ? -150_000 : 0,
  principalDeltaCents: status === 'settled' ? 150_000 : 0, realizedGainDeltaCents: 0,
  feesDeltaCents: 0, taxDeltaCents: 0, quantityDeltaMicros: status === 'settled' ? 150_000_000_000 : 0,
  goalNetContributionDeltaCents: 0, goalCurrentValueDeltaCents: 0,
  institutionId: 'inst_1', institutionName: 'Banco X', classId: 'cls_1', className: 'Reserva de emergência',
  typeId: 'cat_cdb', typeName: 'CDB', assetName: 'CDB Banco X',
  ...(status === 'settled' ? {
    cashAccountId: ACCOUNT, accountMovementId: ACCOUNT_MOVEMENT, settlementAt: ts(), settledAt: ts(),
    settledBy: owner,
  } : {}),
  correlationId: `corr-${id}`, idempotencyKeyHash: `hash-${id}`, occurredAt: ts(), createdBy: owner,
  createdAt: ts(),
});

const reportPeriod = (ws, owner) => ({
  id: PERIOD, workspaceId: ws, profileType: 'PF', currency: 'BRL', period: PERIOD,
  periodStart: ts('2026-10-01T03:00:00.000Z'), contributionCents: 150_000, redemptionPrincipalCents: 0,
  realizedGainCents: 0, realizedLossCents: 0, feesCents: 0, taxCents: 0, costDeltaCents: 150_000,
  currentValueDeltaCents: 150_000, cashDeltaCents: -150_000, settledMovementCount: 1,
  updatedAt: ts(), updatedBy: owner,
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
    const owner = ws === wsA ? users.ownerA.uid : users.ownerB.uid;
    const batch = db.batch();
    batch.set(db.doc(`${base}/transactions/${MIRROR}`), mirror(ws, owner, 'settled'));
    batch.set(db.doc(`${base}/transactions/${PENDING_MIRROR}`), mirror(ws, owner, 'pending'));
    batch.set(db.doc(`${base}/transactions/${MANUAL}`), {
      type: 'despesa', description: 'Mercado', category: 'Alimentação', value: 50, valueCents: 5_000,
      date: '2026-10-04', isPaid: true, workspaceId: ws, profileId: ws, userId: owner, cashAccountId: ACCOUNT,
      cashEntry: {domainVersion: 1, origin: 'manual', status: 'confirmed', currency: 'BRL', requestHash: 'h',
        quotaPeriod: '2026-10', accountMovementId: 'camv_cash_1'},
      createdBy: owner, createdAt: ts(), updatedAt: ts(),
    });
    batch.set(db.doc(`${base}/investment_movements/${MOVEMENT}`), movement(ws, owner, MOVEMENT, 'settled'));
    batch.set(db.doc(`${base}/investment_movements/${PENDING_MOVEMENT}`),
      movement(ws, owner, PENDING_MOVEMENT, 'pending'));
    batch.set(db.doc(`${base}/investment_report_periods/${PERIOD}`), reportPeriod(ws, owner));
    for (const removed of ['investment_valuations', 'investment_snapshots', 'investment_import_batches']) {
      batch.set(db.doc(`${base}/${removed}/x1`), {id: 'x1', workspaceId: ws});
    }
    await batch.commit();
  }
};

const signedClient = async (user, suffix) => {
  const app = initializeApp(
    {apiKey: 'rules-test', projectId},
    `p4d-${suffix}-${Math.random().toString(36).slice(2, 12)}`,
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

/** Troca os Timestamps do Admin SDK pelos do SDK cliente (payload forjado). */
const toClient = (value) => {
  if (value && typeof value.toDate === 'function' && !(value instanceof Timestamp)) {
    return Timestamp.fromDate(value.toDate());
  }
  if (Array.isArray(value)) return value.map(toClient);
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toClient(entry)]));
  }
  return value;
};

/** O payload que o caminho direto antigo do cliente gravava (P3). */
const clientTransaction = (ws, uid, overrides = {}) => ({
  type: 'despesa', description: 'Forjada', category: 'Outros', value: 10, valueCents: 1_000,
  date: '2026-10-05', isPaid: true, workspaceId: ws, profileId: ws, userId: uid,
  createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...overrides,
});

test.before(seed);

test('P4-D Rules — nenhum papel cria lançamento em transactions, de tipo algum', async () => {
  await withClients(ROLES, async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const uid = users[name].uid;
      const coll = collection(db, 'workspaces', wsA, 'transactions');
      const payloads = {
        receita: clientTransaction(wsA, uid, {type: 'receita'}),
        despesa: clientTransaction(wsA, uid),
        // O aporte antigo: `investimento` sem marca, pelo valor de apresentação.
        investimento: clientTransaction(wsA, uid, {type: 'investimento', category: 'Investimentos'}),
        // Marca do backend forjada pelo cliente.
        investimentoMarcado: clientTransaction(wsA, uid, {
          type: 'investimento', category: 'Investimentos', source: 'investment',
          investmentEntry: investmentEntry('settled', {movementId: `forjado-${name}`}),
          cashAccountId: ACCOUNT,
        }),
      };
      for (const [kind, payload] of Object.entries(payloads)) {
        await denied(addDoc(coll, payload), `${name} criou ${kind} por addDoc`);
        await denied(setDoc(doc(coll, `forjado-${name}-${kind}`), payload),
          `${name} criou ${kind} por setDoc`);
      }
      // Pré-ocupar o ID determinístico de um espelho futuro também é criação.
      await denied(setDoc(doc(coll, `investment_${name}-preempt`), payloads.despesa),
        `${name} pré-ocupou o ID do espelho`);
      const batch = writeBatch(db);
      batch.set(doc(coll, `lote-${name}`), payloads.receita);
      await denied(batch.commit(), `${name} criou em lote`);
    }
  });
});

test('P4-D Rules — nenhum papel altera, anula ou apaga o espelho de investimento', async () => {
  await withClients(ROLES, async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const id of [MIRROR, PENDING_MIRROR]) {
        const ref = doc(db, 'workspaces', wsA, 'transactions', id);
        const changes = [
          {valueCents: 1},
          {value: 1},
          {isPaid: true},
          {description: 'Editado'},
          {'investmentEntry.status': 'cancelled'},
          {'investmentEntry.amountCents': 1},
          {investmentEntry: deleteField()},
          {cashAccountId: 'outra-conta'},
          {voidedAt: serverTimestamp(), voidedBy: users[name].uid, voidReason: 'sumir do caixa'},
          {type: 'despesa'},
        ];
        for (const change of changes) {
          await denied(updateDoc(ref, change), `${name} alterou ${id}: ${Object.keys(change).join(',')}`);
        }
        await denied(setDoc(ref, clientTransaction(wsA, users[name].uid)), `${name} sobrescreveu ${id}`);
        await denied(deleteDoc(ref), `${name} apagou ${id}`);
      }
    }
  });
});

test('P4-D Rules — nenhum papel corrige, anula ou apaga lançamento de outro domínio', async () => {
  await withClients(ROLES, async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const ref = doc(db, 'workspaces', wsA, 'transactions', MANUAL);
      await denied(updateDoc(ref, {valueCents: 1, value: 0.01}), `${name} corrigiu o lançamento manual`);
      await denied(updateDoc(ref, {voidedAt: serverTimestamp()}), `${name} anulou o lançamento manual`);
      await denied(deleteDoc(ref), `${name} apagou o lançamento manual`);
    }
  });
});

test('P4-D Rules — todo membro ativo lê transactions; removido e outro workspace não', async () => {
  await withClients(ROLES, async (clients) => {
    for (const name of ['ownerA', 'adminA', 'memberA', 'viewerA']) {
      const {db} = clients[name];
      const mirrorDoc = await getDoc(doc(db, 'workspaces', wsA, 'transactions', MIRROR));
      assert.equal(mirrorDoc.data()?.investmentEntry?.status, 'settled', name);
      const page = await getDocs(query(collection(db, 'workspaces', wsA, 'transactions'),
        orderBy('date', 'desc'), limit(50)));
      assert.equal(page.size, 3, name);
    }
    for (const name of ['removedA', 'ownerB']) {
      const {db} = clients[name];
      await denied(getDoc(doc(db, 'workspaces', wsA, 'transactions', MIRROR)), `${name} leu o espelho de A`);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, 'transactions'), limit(10))),
        `${name} listou transactions de A`);
    }
    // O dono de B lê o próprio workspace, e só ele.
    const own = await getDoc(doc(clients.ownerB.db, 'workspaces', wsB, 'transactions', MIRROR));
    assert.equal(own.data()?.workspaceId, wsB);
  });
});

test('P4-D Rules — domínio patrimonial: ninguém escreve; viewer não lê movimento', async () => {
  await withClients(ROLES, async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const owner = users.ownerA.uid;
      for (const [coll, id, payload] of [
        ['investment_movements', `forjado-${name}`, movement(wsA, owner, `forjado-${name}`, 'settled')],
        ['investment_movements', MOVEMENT, {...movement(wsA, owner, MOVEMENT, 'settled'), cashAccountId: 'outra'}],
        ['investment_positions', 'iacc_1__iast_1', {id: 'iacc_1__iast_1', workspaceId: wsA}],
        ['investment_assets', 'iast_1', {id: 'iast_1', workspaceId: wsA}],
        ['investment_accounts', 'iacc_1', {id: 'iacc_1', workspaceId: wsA}],
        ['investment_summaries', 'current', {id: 'current', workspaceId: wsA}],
        ['investment_report_periods', PERIOD, {...reportPeriod(wsA, owner), contributionCents: 1}],
        ['cash_accounts', ACCOUNT, {id: ACCOUNT, workspaceId: wsA, balanceCents: 999_999}],
        ['cash_account_movements', ACCOUNT_MOVEMENT, {
          id: ACCOUNT_MOVEMENT, workspaceId: wsA, accountId: ACCOUNT, kind: 'investment',
          sourceDomain: 'investment', sourceId: MOVEMENT, amountCents: -150_000,
        }],
      ]) {
        const data = toClient({...payload, occurredAt: Timestamp.now(), createdAt: Timestamp.now()});
        await denied(setDoc(doc(db, 'workspaces', wsA, coll, id), data), `${name} escreveu ${coll}/${id}`);
      }
      await denied(deleteDoc(doc(db, 'workspaces', wsA, 'investment_movements', MOVEMENT)),
        `${name} apagou movimento`);
    }
    for (const name of ['ownerA', 'adminA', 'memberA']) {
      const snapshot = await getDoc(doc(clients[name].db, 'workspaces', wsA, 'investment_movements', MOVEMENT));
      assert.equal(snapshot.data()?.cashAccountId, ACCOUNT, name);
      assert.equal(snapshot.data()?.accountMovementId, ACCOUNT_MOVEMENT, name);
    }
    for (const name of ['viewerA', 'removedA', 'ownerB']) {
      await denied(getDoc(doc(clients[name].db, 'workspaces', wsA, 'investment_movements', MOVEMENT)),
        `${name} leu movimento de A`);
    }
  });
});

test('P4-D Rules — card do dashboard: agregado mensal na consulta do frontend, viewer incluído', async () => {
  await withClients(ROLES, async (clients) => {
    // A consulta exata de `getInvestmentReportPeriod` (readApi.ts).
    const monthQuery = (db, ws) => query(collection(db, 'workspaces', ws, 'investment_report_periods'),
      where(documentId(), '==', PERIOD), limit(1));
    for (const name of ['ownerA', 'adminA', 'memberA', 'viewerA']) {
      const snapshot = await getDocs(monthQuery(clients[name].db, wsA));
      assert.equal(snapshot.size, 1, name);
      assert.equal(snapshot.docs[0].data().contributionCents, 150_000, name);
      // Mês sem documento: consulta vazia, sem erro.
      const empty = await getDocs(query(collection(clients[name].db, 'workspaces', wsA, 'investment_report_periods'),
        where(documentId(), '==', '2026-09'), limit(1)));
      assert.equal(empty.size, 0, name);
    }
    for (const name of ['removedA', 'ownerB']) {
      await denied(getDocs(monthQuery(clients[name].db, wsA)), `${name} leu o período de A`);
    }
    // Sem teto de listagem, nem membro lista.
    await denied(getDocs(query(collection(clients.viewerA.db, 'workspaces', wsA, 'investment_report_periods'))),
      'listagem sem limite');
  });
});

test('P4-D Rules — valoração, snapshot e lote de importação não existem para o cliente', async () => {
  await withClients(['ownerA', 'adminA', 'memberA', 'viewerA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const coll of ['investment_valuations', 'investment_snapshots', 'investment_import_batches']) {
        await denied(getDoc(doc(db, 'workspaces', wsA, coll, 'x1')), `${name} leu ${coll}`);
        await denied(getDocs(query(collection(db, 'workspaces', wsA, coll), limit(1))), `${name} listou ${coll}`);
        await denied(setDoc(doc(db, 'workspaces', wsA, coll, `novo-${name}`), {id: `novo-${name}`, workspaceId: wsA}),
          `${name} escreveu ${coll}`);
      }
    }
  });
});

test('P4-D Rules — catálogo: grupos técnicos de investimento recusados; carteira e instituição aceitas', async () => {
  await withClients(['ownerA', 'memberA', 'viewerA'], async (clients) => {
    const item = (uid, group, name, workspaceScope) => ({
      workspaceId: wsA, group, name, normalizedName: name.toLowerCase(),
      dedupeKey: `${wsA}|${group}|${name.toLowerCase()}`, workspaceScope, sortOrder: 1, status: 'active',
      createdBy: uid, updatedBy: uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
    const owner = users.ownerA.uid;
    for (const group of ['investment_type', 'investment_risk', 'investment_liquidity', 'investment_indexer',
      'investment_strategy', 'wallet']) {
      await denied(setDoc(doc(clients.ownerA.db, 'workspaces', wsA, 'settings_catalog', `p4d-${group}`),
        item(owner, group, `Item ${group}`, 'both')), `owner criou grupo removido ${group}`);
    }
    // P4-E (D-23): nem os grupos que continuam são gravados pelo cliente —
    // carteira e instituição nascem só pelas callables do catálogo, que
    // derivam o escopo do perfil do workspace.
    await denied(setDoc(doc(clients.ownerA.db, 'workspaces', wsA, 'settings_catalog', 'p4d-class'),
      item(owner, 'investment_class', 'Carteira P4-D', 'PF')), 'owner criou carteira pelo cliente');
    await denied(setDoc(doc(clients.ownerA.db, 'workspaces', wsA, 'settings_catalog', 'p4d-institution'),
      item(owner, 'investment_institution', 'Instituição P4-D', 'both')), 'owner criou instituição pelo cliente');
    await denied(setDoc(doc(clients.ownerA.db, 'workspaces', wsA, 'settings_catalog', 'p4d-class-pj'),
      item(owner, 'investment_class', 'Carteira PJ', 'PJ')), 'carteira com escopo de outro perfil');
    // Member e viewer, idem.
    for (const name of ['memberA', 'viewerA']) {
      await denied(setDoc(doc(clients[name].db, 'workspaces', wsA, 'settings_catalog', `p4d-class-${name}`),
        item(users[name].uid, 'investment_class', `Carteira ${name}`, 'PF')), `${name} criou carteira`);
    }
  });
});
