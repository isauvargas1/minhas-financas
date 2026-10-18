import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {deleteApp, initializeApp} from 'firebase/app';
import {connectAuthEmulator, getAuth, signInWithEmailAndPassword} from 'firebase/auth';
import {
  addDoc,
  collection,
  collectionGroup,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getCountFromServer,
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
 * P5-D2 (PR-NOTIF-01) — Rules das notificações dos novos tipos de evento e da
 * contagem, contra o Emulator.
 *
 * Os eventos semeados passam pelo builder real compilado
 * (`functions/lib/notifications/builder.js`) e pela identidade determinística
 * (`ids.js`): um de CADA tipo (`invoice_*`, `loan_overdue`, `receivable_overdue`,
 * `cash_account_negative_balance`, `goal_achieved`, `recurring_*`). As Rules
 * da D-18 e da P5-D1 não mudaram (suítes `notifications-d18` e
 * `notifications-p5d1`, preservadas); aqui se prova que os novos tipos e a
 * contagem do backend não abriram nada:
 *
 * - leitura por owner, admin, member e viewer (get e list com limite ≤ 50);
 *   listagem sem limite e com 51 negadas; contagem sem limite pelo cliente negada;
 * - não membro, membro removido, conta suspensa e sem autenticação negados;
 *   acesso cruzado A → B e B → A negado (eventos, estados e contadores);
 * - nenhum papel cria (nem com forma válida, nem com `audienceUid`, a
 *   "injeção de destinatário"), altera ou apaga o evento;
 * - estado próprio de evento novo: lida/arquivada para todos os ativos;
 *   `deleted` negado ao viewer e permitido a owner, admin e member; estado de
 *   terceiro, `expiresAt` diferente do evento e campo extra negados;
 * - o contador de frequência da contagem e qualquer caminho inventado de
 *   contagem não são lidos nem escritos pelo cliente;
 * - workspace arquivado: leitura como hoje, escrita de estado negada;
 * - os eventos semeados só têm os campos do contrato (nenhum dado pessoal).
 */

const require = createRequire(import.meta.url);
const admin = require('../../functions/node_modules/firebase-admin');
const {buildNotificationDocument} = require('../../functions/lib/notifications/builder.js');
const {notificationIdFor} = require('../../functions/lib/notifications/ids.js');
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('FIRESTORE_EMULATOR_HOST é obrigatório para os testes de Rules da P5-D2.');
}
const projectId = process.env.GCLOUD_PROJECT || 'minhas-financas-local';
const password = 'rules-p5d2-123456';

const users = {
  ownerA: {uid: 'p5d2-owner-a', email: 'p5d2-owner-a@example.test'},
  adminA: {uid: 'p5d2-admin-a', email: 'p5d2-admin-a@example.test'},
  memberA: {uid: 'p5d2-member-a', email: 'p5d2-member-a@example.test'},
  viewerA: {uid: 'p5d2-viewer-a', email: 'p5d2-viewer-a@example.test'},
  removedA: {uid: 'p5d2-removed-a', email: 'p5d2-removed-a@example.test'},
  suspendedA: {uid: 'p5d2-suspended-a', email: 'p5d2-suspended-a@example.test'},
  ownerB: {uid: 'p5d2-owner-b', email: 'p5d2-owner-b@example.test'},
  memberB: {uid: 'p5d2-member-b', email: 'p5d2-member-b@example.test'},
};
const ACTIVE_A = ['ownerA', 'adminA', 'memberA', 'viewerA'];
const CAN_DELETE = ['ownerA', 'adminA', 'memberA'];
const wsA = 'p5d2-workspace-a';
const wsB = 'p5d2-workspace-b';
const wsArchived = 'p5d2-workspace-arquivado';
const LIST_CAP = 50;
const DAY_MS = 86_400_000;
const BASE_MS = Math.floor(Date.now() / 1000) * 1000 - 3_600_000;

const statePath = (ws, uid, id) => `workspaces/${ws}/notification_user_states/${uid}/notification_entries/${id}`;

const getAdmin = () => {
  process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
  if (!admin.apps.length) admin.initializeApp({projectId});
  return admin;
};

const sha = (text) => createHash('sha256').update(text).digest('hex');
const cardId = (kind, invoiceId) => `cc${kind}_${sha(`${kind}:${invoiceId}`).slice(0, 32)}`;

/** Um evento de cada tipo, com o contrato do builder e IDs determinísticos. */
const EVENT_SPECS = (ws) => [
  {
    eventType: 'invoice_closed', id: cardId('closed', 'inv-1'), type: 'credit_card', link: 'cards',
    title: 'Fatura fechada', message: 'A fatura de 01/2026 do cartão fechou em R$ 100,00, com vencimento em 10/02/2026.',
    entity: {cardId: 'card-1', invoiceId: 'inv-1'},
  },
  {
    eventType: 'invoice_due_soon', id: cardId('due', 'inv-1'), type: 'warning', link: 'cards',
    title: 'Fatura próxima do vencimento', message: 'A fatura de 01/2026 do cartão vence em 10/02/2026, com saldo de R$ 100,00.',
    entity: {cardId: 'card-1', invoiceId: 'inv-1'},
  },
  {
    eventType: 'invoice_overdue', id: cardId('overdue', 'inv-1'), type: 'error', link: 'cards',
    title: 'Fatura vencida', message: 'A fatura de 01/2026 do cartão venceu em 10/02/2026, com saldo de R$ 100,00.',
    entity: {cardId: 'card-1', invoiceId: 'inv-1'},
  },
  {
    eventType: 'loan_overdue', id: notificationIdFor({
      workspaceId: ws, domain: 'loan', entityId: 'loan-1', eventType: 'loan_overdue', episode: '2026-03-06',
    }),
    type: 'error', link: 'loans', title: 'Empréstimo a pagar em atraso',
    message: 'Foi identificado atraso em 06/03/2026 em um empréstimo a pagar: a parcela com vencimento em 05/03/2026 ainda não foi quitada.',
    entity: {loanId: 'loan-1'},
  },
  {
    eventType: 'receivable_overdue', id: notificationIdFor({
      workspaceId: ws, domain: 'receivable', entityId: 'rec-1', eventType: 'receivable_overdue', episode: '2026-03-05',
    }),
    type: 'warning', link: 'clients_receivables', title: 'Recebível vencido',
    message: 'Foi identificado atraso em 06/03/2026 em um recebível com vencimento em 05/03/2026, ainda com saldo a receber.',
    entity: {receivableId: 'rec-1'},
  },
  {
    eventType: 'cash_account_negative_balance', id: notificationIdFor({
      workspaceId: ws, domain: 'cash_account', entityId: 'acc-1', eventType: 'cash_account_negative_balance',
      episode: '1772800000.000000000',
    }),
    type: 'warning', link: 'settings', title: 'Saldo negativo em conta',
    message: 'Uma conta ficou com saldo negativo em 06/03/2026. Confira em Configurações, em Contas e carteiras.',
    entity: {accountId: 'acc-1'},
  },
  {
    eventType: 'goal_achieved', id: notificationIdFor({
      workspaceId: ws, domain: 'goal', entityId: 'goal-1', eventType: 'goal_achieved', episode: '1772800000.000000000',
    }),
    type: 'success', link: 'goals', title: 'Meta alcançada',
    message: 'Uma meta foi marcada como alcançada em 06/03/2026.',
    entity: {goalId: 'goal-1'},
  },
  {
    eventType: 'recurring_awaiting_confirmation', id: notificationIdFor({
      workspaceId: ws, domain: 'recurring', entityId: 'occ-1', eventType: 'recurring_awaiting_confirmation', episode: 'occ-1',
    }),
    type: 'warning', link: 'recurring', title: 'Despesa recorrente aguardando confirmação',
    message: 'Uma despesa recorrente com vencimento em 10/03/2026 aguarda confirmação.',
    entity: {recurringExpenseId: 'rx-1', occurrenceId: 'occ-1'},
  },
  {
    eventType: 'recurring_attention_required', id: notificationIdFor({
      workspaceId: ws, domain: 'recurring', entityId: 'occ-2', eventType: 'recurring_attention_required', episode: 'occ-2',
    }),
    type: 'error', link: 'recurring', title: 'Despesa recorrente não gerada',
    message: 'Uma despesa recorrente com vencimento em 10/03/2026 não foi gerada: a conta está arquivada.',
    entity: {recurringExpenseId: 'rx-1', occurrenceId: 'occ-2'},
  },
];

/** Documento do evento pelo builder real; `index` ordena `createdAt` (mais novo = maior). */
const buildEvent = (ws, spec, index) => buildNotificationDocument({
  id: spec.id, workspaceId: ws, eventType: spec.eventType, title: spec.title, message: spec.message,
  type: spec.type, link: spec.link, createdAtMs: BASE_MS + index * 60_000, entity: spec.entity,
});

const EVENT_COUNT = EVENT_SPECS(wsA).length;
const eventsIn = (ws) => EVENT_SPECS(ws).map((spec, index) => buildEvent(ws, spec, index));
/** Mesmos IDs nos dois workspaces para os tipos de cartão; os demais dependem do workspace na identidade. */
const IDS_A = eventsIn(wsA).map((event) => event.id);
const TYPES = EVENT_SPECS(wsA).map((spec) => spec.eventType);
const idOf = (type) => IDS_A[TYPES.indexOf(type)];
const expiresMsOf = (id) => eventsIn(wsA)[IDS_A.indexOf(id)].expiresAt.toMillis();
const clientExpires = (id) => Timestamp.fromMillis(expiresMsOf(id));
/** Os IDs dos tipos que dependem do workspace na identidade mudam em cada workspace. */
const ARCHIVED_LOAN_ID = eventsIn(wsArchived)[TYPES.indexOf('loan_overdue')].id;
const ARCHIVED_GOAL_ID = eventsIn(wsArchived)[TYPES.indexOf('goal_achieved')].id;

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
    await db.doc(`users/${user.uid}`).set({
      uid: user.uid, status: user === users.suspendedA ? 'suspended' : 'active',
    });
  }
  await Promise.all([wsA, wsB, wsArchived].map((ws) => db.recursiveDelete(db.doc(`workspaces/${ws}`))));
  await Promise.all([
    db.doc(`workspaces/${wsA}`).set({ownerId: users.ownerA.uid, type: 'PF', name: 'A', status: 'active'}),
    db.doc(`workspaces/${wsB}`).set({ownerId: users.ownerB.uid, type: 'PJ', name: 'B', status: 'active'}),
    db.doc(`workspaces/${wsArchived}`).set({ownerId: users.ownerA.uid, type: 'PF', name: 'Arq', status: 'archived'}),
  ]);
  const members = [
    [wsA, users.ownerA, 'owner', 'active'], [wsA, users.adminA, 'admin', 'active'],
    [wsA, users.memberA, 'member', 'active'], [wsA, users.viewerA, 'viewer', 'active'],
    [wsA, users.removedA, 'member', 'removed'], [wsA, users.suspendedA, 'member', 'active'],
    [wsB, users.ownerB, 'owner', 'active'], [wsB, users.memberB, 'member', 'active'],
    [wsArchived, users.memberA, 'member', 'active'],
  ];
  await Promise.all(members.map(([ws, user, role, status]) =>
    db.doc(`workspaces/${ws}/members/${user.uid}`).set({uid: user.uid, role, status})));
  const batch = db.batch();
  for (const ws of [wsA, wsB, wsArchived]) {
    for (const event of eventsIn(ws)) batch.set(db.doc(`workspaces/${ws}/notifications/${event.id}`), event);
  }
  // Contador de frequência da contagem (gravado só pelo backend) e estado
  // de outro usuário no archived para a atualização negada.
  for (const user of [users.ownerA, users.memberA, users.viewerA]) {
    batch.set(db.doc(`workspaces/${wsA}/rate_limits/getNotificationUnreadCount_${user.uid}`), {
      count: 3, windowStart: admin.firestore.Timestamp.now(),
    });
  }
  batch.set(db.doc(statePath(wsArchived, users.memberA.uid, ARCHIVED_LOAN_ID)), {
    read: true, readAt: admin.firestore.Timestamp.now(), expiresAt: eventsIn(wsArchived)[TYPES.indexOf('loan_overdue')].expiresAt,
  });
  await batch.commit();
};

const signedClient = async (user, suffix) => {
  const app = initializeApp(
    {apiKey: 'rules-test', projectId},
    `p5d2-${suffix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
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

const eventRef = (db, ws, id) => doc(db, `workspaces/${ws}/notifications/${id}`);
const stateRef = (db, ws, uid, id) => doc(db, statePath(ws, uid, id));
const adminState = (ws, uid, id) => getAdmin().firestore().doc(statePath(ws, uid, id)).get();
const pageQuery = (db, ws, max) => query(
  collection(db, 'workspaces', ws, 'notifications'), orderBy('createdAt', 'desc'), limit(max));
const mark = (kind, id) => ({[kind]: true, [`${kind}At`]: serverTimestamp(), expiresAt: clientExpires(id)});
const COUNTER = (uid) => `getNotificationUnreadCount_${uid}`;

/** Forma do evento válido, convertida para o SDK do cliente (Timestamp do cliente). */
const clientShapedEvent = (ws, spec, index) => {
  const event = buildEvent(ws, spec, index);
  return {...event, expiresAt: Timestamp.fromMillis(event.expiresAt.toMillis())};
};

let freshCounter = 0;
/**
 * Evento novo de um tipo (builder real, ID determinístico próprio), semeado
 * pelo backend. As marcas do estado são monotônicas: cada teste usa os seus
 * para não colidir com os de outros.
 */
const freshEvent = async (type, ws = wsA) => {
  freshCounter += 1;
  const unique = `u${Date.now().toString(36)}${freshCounter}`;
  const template = EVENT_SPECS(ws)[TYPES.indexOf(type)];
  const base = buildEvent(ws, template, freshCounter);
  const id = template.eventType.startsWith('invoice_') ?
    cardId(template.eventType.replace('invoice_', '').replace('due_soon', 'due'), unique) :
    notificationIdFor({
      workspaceId: ws, domain: base.domain, entityId: unique, eventType: type, episode: unique,
    });
  const entity = Object.fromEntries(Object.keys(template.entity).map((key) => [key, `${key}-${unique}`]));
  const event = buildNotificationDocument({
    id, workspaceId: ws, eventType: type, title: template.title, message: template.message, type: template.type,
    link: template.link, createdAtMs: BASE_MS - freshCounter * 1000, entity,
  });
  await getAdmin().firestore().doc(`workspaces/${ws}/notifications/${id}`).set(event);
  return {id, expiresAt: Timestamp.fromMillis(event.expiresAt.toMillis())};
};
const markOn = (kind, event) => ({[kind]: true, [`${kind}At`]: serverTimestamp(), expiresAt: event.expiresAt});

test.before(seed);

// ----------------------------------------------------------------- contrato

test('P5-D2 Rules — os eventos semeados de cada tipo só têm os campos do contrato, sem dado pessoal', async () => {
  const db = getAdmin().firestore();
  const CONTRACT = ['id', 'workspaceId', 'title', 'message', 'type', 'link', 'actionLabel', 'createdAt', 'expiresAt',
    'source', 'domain', 'domainEventType'];
  const ENTITY = {
    credit_card: ['cardId', 'invoiceId'], loan: ['loanId'], receivable: ['receivableId'],
    cash_account: ['accountId'], goal: ['goalId'], recurring: ['recurringExpenseId', 'occurrenceId'],
  };
  const snapshot = await db.collection(`workspaces/${wsA}/notifications`).get();
  assert.equal(snapshot.size, EVENT_COUNT);
  assert.deepEqual(snapshot.docs.map((entry) => entry.get('domainEventType')).sort(), [...TYPES].sort());
  for (const entry of snapshot.docs) {
    const data = entry.data();
    assert.deepEqual(Object.keys(data).sort(), [...CONTRACT, ...ENTITY[data.domain]].sort(), data.domainEventType);
    assert.equal(data.expiresAt.toMillis() - Date.parse(data.createdAt), 180 * DAY_MS, 'retenção de 180 dias');
    for (const forbidden of ['personName', 'personContact', 'description', 'name', 'clientId', 'document', 'email',
      'phone', 'amountCents', 'balanceCents', 'valueCents', 'read', 'uid', 'audienceUid']) {
      assert.ok(!(forbidden in data), `campo proibido ${forbidden} em ${data.domainEventType}`);
    }
    assert.equal(data.id, entry.id);
    assert.equal(data.workspaceId, wsA);
  }
});

// -------------------------------------------------------------------- leitura

for (const name of ACTIVE_A) {
  test(`P5-D2 Rules — ${name} lê (get) cada um dos novos tipos e lista com limite ≤ 50`, async () => {
    await withClients([name], async ({[name]: {db}}) => {
      for (const type of TYPES) {
        const item = await getDoc(eventRef(db, wsA, idOf(type)));
        assert.equal(item.get('domainEventType'), type);
        assert.ok(item.get('expiresAt') instanceof Timestamp);
        assert.equal(item.get('read'), undefined, 'o evento não carrega estado');
      }
      const page = await getDocs(pageQuery(db, wsA, LIST_CAP));
      assert.deepEqual(page.docs.map((entry) => entry.get('domainEventType')).sort(), [...TYPES].sort());
      const small = await getDocs(pageQuery(db, wsA, 26));
      assert.equal(small.size, EVENT_COUNT);
    });
  });
}

test('P5-D2 Rules — listagem sem limite e com 51 negadas a todos os papéis; contagem sem limite pelo cliente negada', async () => {
  await withClients(ACTIVE_A, async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      await denied(getDocs(collection(db, 'workspaces', wsA, 'notifications')), `${name} lista sem limite`);
      await denied(getDocs(query(collection(db, 'workspaces', wsA, 'notifications'), orderBy('createdAt', 'desc'))),
        `${name} lista ordenada sem limite`);
      await denied(getDocs(pageQuery(db, wsA, LIST_CAP + 1)), `${name} lista 51`);
      await denied(getCountFromServer(collection(db, 'workspaces', wsA, 'notifications')),
        `${name} conta os eventos no cliente, sem limite`);
      await denied(getCountFromServer(collection(db, `workspaces/${wsA}/notification_user_states/${users[name].uid}/notification_entries`)),
        `${name} conta os próprios estados no cliente, sem limite`);
    }
  });
});

test('P5-D2 Rules — não membro, removido, suspenso e sem autenticação não leem nem listam eventos', async () => {
  await withClients(['ownerB', 'memberB', 'removedA', 'suspendedA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const type of TYPES) {
        await denied(getDoc(eventRef(db, wsA, idOf(type))), `${name} lê ${type}`);
      }
      await denied(getDocs(pageQuery(db, wsA, 10)), `${name} lista eventos de A`);
    }
  });
  const app = initializeApp({apiKey: 'rules-test', projectId}, `p5d2-anon-${Date.now().toString(36)}`);
  try {
    const db = getFirestore(app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    for (const type of TYPES) {
      await denied(getDoc(eventRef(db, wsA, idOf(type))), `sem auth lê ${type}`);
    }
    await denied(getDocs(pageQuery(db, wsA, 10)), 'sem auth lista');
    await denied(setDoc(stateRef(db, wsA, users.viewerA.uid, idOf('loan_overdue')), mark('read', idOf('loan_overdue'))),
      'sem auth grava estado');
    await denied(getDoc(doc(db, `workspaces/${wsA}/rate_limits/${COUNTER(users.viewerA.uid)}`)), 'sem auth lê o contador');
  } finally {
    await deleteApp(app);
  }
});

test('P5-D2 Rules — acesso cruzado A → B e B → A negado (eventos, estados e contador)', async () => {
  await withClients(['ownerA', 'viewerA', 'ownerB', 'memberB'], async (clients) => {
    for (const name of ['ownerA', 'viewerA']) {
      const {db} = clients[name];
      for (const type of TYPES) {
        await denied(getDoc(eventRef(db, wsB, idOf(type))), `${name} lê ${type} de B`);
      }
      await denied(getDocs(pageQuery(db, wsB, 10)), `${name} lista eventos de B`);
      await denied(setDoc(stateRef(db, wsB, users[name].uid, idOf('goal_achieved')), mark('read', idOf('goal_achieved'))),
        `${name} grava estado em B`);
      await denied(getDoc(stateRef(db, wsB, users.ownerB.uid, idOf('goal_achieved'))), `${name} lê estado de B`);
    }
    for (const name of ['ownerB', 'memberB']) {
      const {db} = clients[name];
      const goalA = eventsIn(wsA)[TYPES.indexOf('goal_achieved')].id;
      await denied(getDoc(eventRef(db, wsA, goalA)), `${name} lê meta de A`);
      await denied(getDocs(pageQuery(db, wsA, 10)), `${name} lista A`);
      await denied(setDoc(stateRef(db, wsA, users[name].uid, goalA), mark('read', goalA)), `${name} grava estado em A`);
      await denied(setDoc(stateRef(db, wsA, users.ownerA.uid, goalA), mark('read', goalA)),
        `${name} grava estado do owner de A`);
      await denied(getDoc(doc(db, `workspaces/${wsA}/rate_limits/${COUNTER(users.ownerA.uid)}`)), `${name} lê o contador de A`);
    }
    // Controle: cada um lê o próprio workspace.
    assert.equal((await getDocs(pageQuery(clients.ownerB.db, wsB, LIST_CAP))).size, EVENT_COUNT);
    assert.equal((await getDocs(pageQuery(clients.ownerA.db, wsA, LIST_CAP))).size, EVENT_COUNT);
  });
});

// ------------------------------------------------------ escrita no evento

test('P5-D2 Rules — nenhum papel cria evento, nem com forma válida de cada tipo nem com audienceUid (injeção de destinatário)', async () => {
  await withClients([...ACTIVE_A, 'ownerB'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const specs = EVENT_SPECS(wsA);
      for (const [index, spec] of specs.entries()) {
        const valid = clientShapedEvent(wsA, spec, index);
        const forgedId = `forjado-${name}-${spec.eventType}`;
        await denied(setDoc(eventRef(db, wsA, forgedId), {...valid, id: forgedId}), `${name} cria ${spec.eventType}`);
        await denied(setDoc(eventRef(db, wsA, forgedId), {...valid, id: forgedId, audienceUid: users.viewerA.uid}),
          `${name} cria ${spec.eventType} dirigido (audienceUid)`);
        await denied(setDoc(eventRef(db, wsA, forgedId), {...valid, id: forgedId, audienceUid: users[name].uid}),
          `${name} cria ${spec.eventType} dirigido a si`);
      }
      await denied(addDoc(collection(db, 'workspaces', wsA, 'notifications'),
        {...clientShapedEvent(wsA, specs[3], 3), audienceUid: users.memberA.uid}), `${name} addDoc dirigido`);
      // Recriar com o ID determinístico de um evento existente: continua sendo escrita.
      await denied(setDoc(eventRef(db, wsA, idOf('loan_overdue')), clientShapedEvent(wsA, specs[3], 3)),
        `${name} sobrescreve o evento de empréstimo`);
    }
  });
  const stored = await getAdmin().firestore().collection(`workspaces/${wsA}/notifications`).get();
  assert.equal(stored.size, EVENT_COUNT, 'nenhum evento novo');
  assert.ok(stored.docs.every((entry) => entry.get('audienceUid') === undefined));
});

test('P5-D2 Rules — nenhum papel altera ou apaga evento de qualquer tipo (nem para dirigir, nem para marcar, nem para prorrogar)', async () => {
  const before = await getAdmin().firestore().collection(`workspaces/${wsA}/notifications`).get();
  await withClients([...ACTIVE_A, 'ownerB'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const type of TYPES) {
        const ref = eventRef(db, wsA, idOf(type));
        await denied(updateDoc(ref, {title: 'Alterado'}), `${name} altera ${type}`);
        await denied(updateDoc(ref, {audienceUid: users[name].uid}), `${name} dirige ${type}`);
        await denied(updateDoc(ref, {read: true}), `${name} marca lida no evento ${type}`);
        await denied(updateDoc(ref, {expiresAt: Timestamp.fromMillis(expiresMsOf(idOf(type)) + 365 * DAY_MS)}),
          `${name} prorroga ${type}`);
        await denied(setDoc(ref, {dismissed: true}, {merge: true}), `${name} arquiva no evento ${type}`);
        await denied(deleteDoc(ref), `${name} apaga ${type}`);
      }
      const batch = writeBatch(db);
      batch.delete(eventRef(db, wsA, idOf('invoice_closed')));
      await denied(batch.commit(), `${name} apaga em lote`);
    }
  });
  const after = await getAdmin().firestore().collection(`workspaces/${wsA}/notifications`).get();
  assert.deepEqual(after.docs.map((entry) => [entry.id, entry.data()]), before.docs.map((entry) => [entry.id, entry.data()]),
    'eventos intactos');
});

// ----------------------------------------------------------- estado próprio

for (const name of ACTIVE_A) {
  test(`P5-D2 Rules — ${name} marca lida e arquivada para si em cada um dos novos tipos`, async () => {
    const uid = users[name].uid;
    const created = [];
    await withClients([name], async ({[name]: {db}}) => {
      for (const [index, type] of TYPES.entries()) {
        const event = await freshEvent(type);
        const ref = stateRef(db, wsA, uid, event.id);
        const kind = index % 2 === 0 ? 'read' : 'dismissed';
        await setDoc(ref, markOn(kind, event));
        const stored = await getDoc(ref);
        assert.equal(stored.get(kind), true, type);
        // Idêntica ao expiresAt do evento (Timestamp nativo).
        assert.equal(stored.get('expiresAt').toMillis(), event.expiresAt.toMillis());
        created.push([event, kind]);
      }
      // Lida e arquivada podem conviver no mesmo estado.
      const [event, kind] = created[0];
      const other = kind === 'read' ? 'dismissed' : 'read';
      await updateDoc(stateRef(db, wsA, uid, event.id), {[other]: true, [`${other}At`]: serverTimestamp()});
      const both = await getDoc(stateRef(db, wsA, uid, event.id));
      assert.equal(both.get('read'), true);
      assert.equal(both.get('dismissed'), true);
    });
    for (const [event, kind] of created) {
      assert.equal((await adminState(wsA, uid, event.id)).get(kind), true);
    }
  });
}

test('P5-D2 Rules — excluir para si (deleted) é permitido a owner, admin e member e negado ao viewer, nos novos tipos', async () => {
  await withClients([...CAN_DELETE, 'viewerA'], async (clients) => {
    for (const name of CAN_DELETE) {
      const {db} = clients[name];
      for (const type of TYPES) {
        const event = await freshEvent(type);
        const ref = stateRef(db, wsA, users[name].uid, event.id);
        await setDoc(ref, markOn('deleted', event));
        assert.equal((await getDoc(ref)).get('deleted'), true, `${name} exclui ${type}`);
      }
    }
    const {db: viewerDb} = clients.viewerA;
    const viewerUid = users.viewerA.uid;
    for (const type of TYPES) {
      const createEvent = await freshEvent(type);
      await denied(setDoc(stateRef(viewerDb, wsA, viewerUid, createEvent.id), markOn('deleted', createEvent)),
        `viewer cria deleted em ${type}`);
      assert.equal((await adminState(wsA, viewerUid, createEvent.id)).exists, false);
      // Com marca anterior, adicionar deleted na atualização continua negado.
      const updateEvent = await freshEvent(type);
      await setDoc(stateRef(viewerDb, wsA, viewerUid, updateEvent.id), markOn('read', updateEvent));
      await denied(updateDoc(stateRef(viewerDb, wsA, viewerUid, updateEvent.id), {deleted: true, deletedAt: serverTimestamp()}),
        `viewer adiciona deleted em ${type}`);
      await denied(setDoc(stateRef(viewerDb, wsA, viewerUid, updateEvent.id),
        {deleted: true, deletedAt: serverTimestamp()}, {merge: true}), `viewer adiciona deleted por merge em ${type}`);
      assert.equal((await adminState(wsA, viewerUid, updateEvent.id)).get('deleted'), undefined);
    }
  });
});

test('P5-D2 Rules — ler ou gravar o estado de terceiro é negado (get, list, create, update, delete)', async () => {
  const id = idOf('loan_overdue');
  await withClients(['ownerA', 'adminA', 'memberA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const viewerState = stateRef(db, wsA, users.viewerA.uid, id);
      await denied(getDoc(viewerState), `${name} lê o estado do viewer`);
      await denied(getDocs(query(collection(db, `workspaces/${wsA}/notification_user_states/${users.viewerA.uid}/notification_entries`),
        limit(10))), `${name} lista o estado do viewer`);
      await denied(setDoc(stateRef(db, wsA, users.viewerA.uid, idOf('goal_achieved')), mark('read', idOf('goal_achieved'))),
        `${name} cria estado para o viewer`);
      await denied(updateDoc(viewerState, {dismissed: true, dismissedAt: serverTimestamp()}), `${name} altera o estado do viewer`);
      await denied(deleteDoc(viewerState), `${name} apaga o estado do viewer`);
    }
  });
});

test('P5-D2 Rules — estado com expiresAt diferente do evento ou com alteração de expiresAt é negado', async () => {
  const id = idOf('receivable_overdue');
  const own = (db, uid) => stateRef(db, wsA, uid, id);
  await withClients(['adminA'], async ({adminA}) => {
    const uid = users.adminA.uid;
    const expires = expiresMsOf(id);
    for (const [label, expiresAt] of [
      ['+1 s', Timestamp.fromMillis(expires + 1000)],
      ['−1 s', Timestamp.fromMillis(expires - 1000)],
      ['+1 ano', Timestamp.fromMillis(expires + 365 * DAY_MS)],
      ['já vencido', Timestamp.fromMillis(Date.now() - DAY_MS)],
    ]) {
      await denied(setDoc(own(adminA.db, uid), {read: true, readAt: serverTimestamp(), expiresAt}), `expiresAt ${label}`);
    }
    await denied(setDoc(own(adminA.db, uid), {read: true, readAt: serverTimestamp(), expiresAt: expires}),
      'expiresAt numérico');
    await denied(setDoc(own(adminA.db, uid), {read: true, readAt: serverTimestamp()}), 'sem expiresAt');
    // Estado correto e, depois, tentativa de mudar o prazo na atualização.
    await setDoc(own(adminA.db, uid), mark('read', id));
    await denied(updateDoc(own(adminA.db, uid), {
      dismissed: true, dismissedAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(expires + 365 * DAY_MS),
    }), 'prorrogar expiresAt na atualização');
    await denied(updateDoc(own(adminA.db, uid), {
      dismissed: true, dismissedAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(expires - 1000),
    }), 'antecipar expiresAt na atualização');
  });
  assert.equal((await adminState(wsA, users.adminA.uid, id)).get('expiresAt').toMillis(), expiresMsOf(id));
  assert.equal((await adminState(wsA, users.adminA.uid, id)).get('dismissed'), undefined);
});

test('P5-D2 Rules — estado com campo extra (uid, audienceUid, workspaceId, notificationId, unreadCount) é negado', async () => {
  const id = idOf('goal_achieved');
  await withClients(['memberA'], async ({memberA}) => {
    const uid = users.memberA.uid;
    for (const extra of [
      {uid}, {audienceUid: uid}, {audienceUid: users.viewerA.uid}, {workspaceId: wsA}, {notificationId: id},
      {unreadCount: 0}, {count: 1},
    ]) {
      await denied(setDoc(stateRef(memberA.db, wsA, uid, id), {...mark('read', id), ...extra}),
        `campo extra ${Object.keys(extra)[0]} na criação`);
    }
    await setDoc(stateRef(memberA.db, wsA, uid, id), mark('read', id));
    await denied(updateDoc(stateRef(memberA.db, wsA, uid, id), {
      dismissed: true, dismissedAt: serverTimestamp(), audienceUid: uid,
    }), 'audienceUid na atualização');
    await denied(updateDoc(stateRef(memberA.db, wsA, uid, id), {
      dismissed: true, dismissedAt: serverTimestamp(), uid,
    }), 'uid na atualização');
  });
  const state = await adminState(wsA, users.memberA.uid, id);
  assert.deepEqual(Object.keys(state.data()).sort(), ['expiresAt', 'read', 'readAt']);
});

test('P5-D2 Rules — removido, suspenso e conta suspensa não marcam nada nos novos tipos', async () => {
  await withClients(['removedA', 'suspendedA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const type of TYPES) {
        const id = idOf(type);
        await denied(setDoc(stateRef(db, wsA, users[name].uid, id), mark('read', id)), `${name} marca ${type}`);
        await denied(getDoc(stateRef(db, wsA, users[name].uid, id)), `${name} lê o próprio estado de ${type}`);
      }
    }
  });
});

// ------------------------------------------ contagem e caminhos inventados

test('P5-D2 Rules — o contador de frequência da contagem não é lido nem escrito pelo cliente, de ninguém', async () => {
  const counter = (db, uid) => doc(db, `workspaces/${wsA}/rate_limits/${COUNTER(uid)}`);
  await withClients(['ownerA', 'memberA', 'viewerA', 'adminA'], async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      for (const uid of [users[name].uid, users.ownerA.uid, users.viewerA.uid]) {
        await denied(getDoc(counter(db, uid)), `${name} lê o contador de ${uid}`);
        await denied(setDoc(counter(db, uid), {count: 0, windowStart: Timestamp.now()}), `${name} zera o contador de ${uid}`);
        await denied(updateDoc(counter(db, uid), {count: 0}), `${name} atualiza o contador de ${uid}`);
        await denied(deleteDoc(counter(db, uid)), `${name} apaga o contador de ${uid}`);
      }
      await denied(getDocs(query(collection(db, 'workspaces', wsA, 'rate_limits'), limit(10))), `${name} lista contadores`);
    }
  });
  for (const user of [users.ownerA, users.memberA, users.viewerA]) {
    const stored = await getAdmin().firestore().doc(`workspaces/${wsA}/rate_limits/${COUNTER(user.uid)}`).get();
    assert.equal(stored.get('count'), 3, 'contador intacto');
  }
});

// P5-D2.1 — o cursor global `system/receivable_overdue_notifications` da
// P5-D2 saiu com a varredura; o controle agora é por workspace, na fila e na
// confirmação de entrega, ambos backend-owned.
const OVERDUE_NOTICE_ID = notificationIdFor({
  workspaceId: wsA, domain: 'receivable', entityId: 'rcv-1', eventType: 'receivable_overdue', episode: '2026-03-05',
});
const overdueQueuePath = (ws, id = 'rcv-1') => `workspaces/${ws}/receivable_overdue_queue/${id}`;
const overdueDeliveryPath = (ws, id = OVERDUE_NOTICE_ID) => `workspaces/${ws}/receivable_overdue_deliveries/${id}`;
const overdueQueueData = (ws) => ({
  schemaVersion: 1, workspaceId: ws, receivableId: 'rcv-1', dueDate: '2026-03-05', runAfterDay: '2026-03-06',
  attempts: 2, lastErrorCode: 'unavailable', lastAttemptAt: null,
});
const overdueDeliveryData = (ws) => ({
  schemaVersion: 1, workspaceId: ws, receivableId: 'rcv-1', episode: '2026-03-05',
  notificationId: OVERDUE_NOTICE_ID, origin: 'published', runId: 'receivable-overdue-teste',
});

/** Tudo o que um cliente poderia tentar nas duas estruturas de um workspace. */
const overdueControlAttempts = (db, ws) => [
  ['lê o item da fila', () => getDoc(doc(db, overdueQueuePath(ws)))],
  ['lista a fila', () => getDocs(query(collection(db, 'workspaces', ws, 'receivable_overdue_queue'), limit(10)))],
  ['conta a fila', () => getCountFromServer(collection(db, 'workspaces', ws, 'receivable_overdue_queue'))],
  ['cria trabalho pendente', () => setDoc(doc(db, overdueQueuePath(ws, 'rcv-forjado')), overdueQueueData(ws))],
  ['zera as tentativas', () => updateDoc(doc(db, overdueQueuePath(ws)), {attempts: 0, lastErrorCode: null})],
  ['adia a próxima tentativa', () => updateDoc(doc(db, overdueQueuePath(ws)), {runAfterDay: '2999-12-31'})],
  ['troca o episódio', () => updateDoc(doc(db, overdueQueuePath(ws)), {dueDate: '2020-01-01'})],
  ['reescreve o item', () => setDoc(doc(db, overdueQueuePath(ws)), {...overdueQueueData(ws), attempts: 0})],
  ['apaga o trabalho pendente', () => deleteDoc(doc(db, overdueQueuePath(ws)))],
  ['lê a confirmação', () => getDoc(doc(db, overdueDeliveryPath(ws)))],
  ['lista as confirmações', () =>
    getDocs(query(collection(db, 'workspaces', ws, 'receivable_overdue_deliveries'), limit(10)))],
  ['marca entrega (suprime o aviso)', () =>
    setDoc(doc(db, overdueDeliveryPath(ws, 'rc_ffffffffffffffffffffffffffffffff')), overdueDeliveryData(ws))],
  ['altera a confirmação', () => updateDoc(doc(db, overdueDeliveryPath(ws)), {episode: '2020-01-01'})],
  ['apaga a confirmação (reabre a reemissão)', () => deleteDoc(doc(db, overdueDeliveryPath(ws)))],
  ['cria aviso de recebível vencido', () =>
    setDoc(eventRef(db, ws, 'rc_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'), clientShapedEvent(ws, EVENT_SPECS(ws)[4], 4))],
];

test('P5-D2.1 Rules — fila e confirmação dos avisos de recebível vencido: nenhum papel (owner, admin, member, ' +
  'viewer), removido, suspenso, outro workspace ou cliente sem autenticação lê ou escreve, nem em workspace ' +
  'arquivado; consulta de grupo negada', async () => {
  const db = getAdmin().firestore();
  for (const ws of [wsA, wsB, wsArchived]) {
    await db.doc(overdueQueuePath(ws)).set({...overdueQueueData(ws), updatedAt: admin.firestore.Timestamp.now()});
    await db.doc(overdueDeliveryPath(ws)).set({...overdueDeliveryData(ws), deliveredAt: admin.firestore.Timestamp.now()});
  }
  assert.equal(EVENT_SPECS(wsA)[4].eventType, 'receivable_overdue');
  const names = [...ACTIVE_A, 'removedA', 'suspendedA', 'ownerB', 'memberB'];
  await withClients(names, async (clients) => {
    for (const [name, {db: clientDb}] of Object.entries(clients)) {
      for (const ws of [wsA, wsB, wsArchived]) {
        for (const [label, attempt] of overdueControlAttempts(clientDb, ws)) {
          await denied(attempt(), `${name} ${label} em ${ws}`);
        }
      }
      await denied(getDocs(query(collectionGroup(clientDb, 'receivable_overdue_queue'),
        where('runAfterDay', '<=', '2999-12-31'), limit(10))), `${name} consulta a fila de todos os workspaces`);
      await denied(getDocs(query(collectionGroup(clientDb, 'receivable_overdue_deliveries'), limit(10))),
        `${name} consulta as confirmações de todos os workspaces`);
      // Caminho antigo (cursor global da P5-D2), removido: segue negado.
      await denied(getDoc(doc(clientDb, 'system/receivable_overdue_notifications')), `${name} lê o cursor antigo`);
      await denied(setDoc(doc(clientDb, 'system/receivable_overdue_notifications'), {cursor: null}),
        `${name} recria o cursor antigo`);
    }
  });
  const app = initializeApp({apiKey: 'rules-test', projectId}, `p5d21-anon-${Date.now().toString(36)}`);
  try {
    const anon = getFirestore(app);
    connectFirestoreEmulator(anon, '127.0.0.1', 8080);
    for (const ws of [wsA, wsB, wsArchived]) {
      for (const [label, attempt] of overdueControlAttempts(anon, ws)) {
        await denied(attempt(), `sem auth ${label} em ${ws}`);
      }
    }
  } finally {
    await deleteApp(app);
  }
  for (const ws of [wsA, wsB, wsArchived]) {
    const item = await db.doc(overdueQueuePath(ws)).get();
    assert.deepEqual([item.get('attempts'), item.get('runAfterDay'), item.get('dueDate')], [2, '2026-03-06', '2026-03-05'],
      `${ws}: item intacto`);
    assert.equal((await db.doc(overdueDeliveryPath(ws)).get()).get('episode'), '2026-03-05', `${ws}: confirmação intacta`);
    assert.equal((await db.doc(overdueQueuePath(ws, 'rcv-forjado')).get()).exists, false);
    assert.equal((await db.doc(overdueDeliveryPath(ws, 'rc_ffffffffffffffffffffffffffffffff')).get()).exists, false);
    assert.equal((await db.doc(`workspaces/${ws}/notifications/rc_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee`).get()).exists,
      false);
  }
});

test('P5-D2 Rules — caminhos inventados para guardar contagem (catch-all) negam toda escrita do cliente', async () => {
  const uidOf = (name) => users[name].uid;
  await withClients(ACTIVE_A, async (clients) => {
    for (const [name, {db}] of Object.entries(clients)) {
      const uid = uidOf(name);
      const paths = [
        `workspaces/${wsA}/notification_counts/${uid}`,
        `workspaces/${wsA}/notification_counts/current`,
        `workspaces/${wsA}/unread_counts/${uid}`,
        `workspaces/${wsA}/notification_unread_counts/${uid}`,
        `workspaces/${wsA}/unread_count/current`,
        `workspaces/${wsA}/notifications_meta/count`,
        `workspaces/${wsA}/notification_stats/${uid}`,
        `workspaces/${wsA}/notification_user_states/${uid}`,
        `workspaces/${wsA}/notification_user_states/${uid}/unread_count/current`,
        `workspaces/${wsA}/notification_user_states/${uid}/counts/current`,
        `workspaces/${wsA}/notifications/${idOf('loan_overdue')}/counts/${uid}`,
        `workspaces/${wsA}/rate_limits/unread_${uid}`,
        `users/${uid}/unread_counts/${wsA}`,
        `users/${uid}/notification_counts/${wsA}`,
      ];
      for (const path of paths) {
        await denied(setDoc(doc(db, path), {unreadCount: 0, count: 0}), `${name} cria ${path}`);
        await denied(setDoc(doc(db, path), {unreadCount: 0}, {merge: true}), `${name} mescla ${path}`);
        await denied(updateDoc(doc(db, path), {unreadCount: 0}), `${name} atualiza ${path}`);
        await denied(deleteDoc(doc(db, path)), `${name} apaga ${path}`);
      }
      await denied(updateDoc(doc(db, `workspaces/${wsA}`), {unreadCount: 0}), `${name} grava contagem no workspace`);
      await denied(updateDoc(doc(db, `workspaces/${wsA}/members/${uid}`), {unreadCount: 0}), `${name} grava contagem no membro`);
      await denied(updateDoc(doc(db, `users/${uid}`), {unreadCount: 0}), `${name} grava contagem no perfil`);
    }
  });
  const db = getAdmin().firestore();
  for (const name of ['notification_counts', 'unread_counts', 'notification_unread_counts', 'unread_count',
    'notifications_meta', 'notification_stats']) {
    assert.equal((await db.collection(`workspaces/${wsA}/${name}`).limit(1).get()).size, 0, `${name} vazio`);
  }
});

// --------------------------------------------------------- workspace arquivado

test('P5-D2 Rules — workspace arquivado: membro lê os eventos como hoje, mas não grava nem atualiza estado', async () => {
  const id = ARCHIVED_LOAN_ID;
  const fresh = ARCHIVED_GOAL_ID;
  await withClients(['memberA'], async ({memberA}) => {
    const uid = users.memberA.uid;
    // Leitura: conforme as Rules atuais, o membro ativo lê o arquivado.
    for (const event of eventsIn(wsArchived)) {
      assert.equal((await getDoc(eventRef(memberA.db, wsArchived, event.id))).get('domainEventType'), event.domainEventType);
    }
    assert.equal((await getDocs(pageQuery(memberA.db, wsArchived, LIST_CAP))).size, EVENT_COUNT);
    const expiresAt = (event) => Timestamp.fromMillis(event.expiresAt.toMillis());
    const events = eventsIn(wsArchived);
    await denied(setDoc(stateRef(memberA.db, wsArchived, uid, fresh), {
      read: true, readAt: serverTimestamp(), expiresAt: expiresAt(events[TYPES.indexOf('goal_achieved')]),
    }), 'cria leitura em arquivado');
    await denied(setDoc(stateRef(memberA.db, wsArchived, uid, fresh), {
      deleted: true, deletedAt: serverTimestamp(), expiresAt: expiresAt(events[TYPES.indexOf('goal_achieved')]),
    }), 'cria exclusão em arquivado');
    await denied(updateDoc(stateRef(memberA.db, wsArchived, uid, id), {dismissed: true, dismissedAt: serverTimestamp()}),
      'arquiva em arquivado');
    await denied(updateDoc(stateRef(memberA.db, wsArchived, uid, id), {deleted: true, deletedAt: serverTimestamp()}),
      'exclui em arquivado');
    // O próprio estado segue legível.
    assert.equal((await getDoc(stateRef(memberA.db, wsArchived, uid, id))).get('read'), true);
    // Nem evento nem contador por ali.
    await denied(setDoc(eventRef(memberA.db, wsArchived, 'forjado'), clientShapedEvent(wsArchived, EVENT_SPECS(wsArchived)[3], 3)),
      'cria evento em arquivado');
  });
  assert.equal((await adminState(wsArchived, users.memberA.uid, fresh)).exists, false);
  assert.equal((await adminState(wsArchived, users.memberA.uid, id)).get('dismissed'), undefined);
});
