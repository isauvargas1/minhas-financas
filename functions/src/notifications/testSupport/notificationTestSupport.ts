import assert from "node:assert/strict";

import * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {
  rateLimitDocumentId,
  type RateLimitPolicy,
} from "../../shared/rateLimit";
import {db} from "../../workspaces/testSupport/p1TestSupport";
import {buildNotificationDocument} from "../builder";
import {
  NOTIFICATION_ENTITY_FIELDS,
  NOTIFICATION_EVENT_DOMAIN,
  type NotificationEventType,
} from "../contract";
import {onCashAccountWriteNotification} from "../producers/cashAccounts";
import {onGoalWriteNotification} from "../producers/goals";
import {onLoanWriteNotification} from "../producers/loans";
import {onRecurringOccurrenceCreatedNotification} from
  "../producers/recurring";

/**
 * Apoio das suítes de integração das notificações (P5-D2), só no Emulator.
 *
 * Os gatilhos são entregues pelo corpo real exportado (`.run`), com o
 * snapshot do Admin SDK lido imediatamente antes e depois da operação de
 * domínio: o mesmo que o Eventarc entrega (`exists`, `data()`, `updateTime`,
 * `createTime`). Nada aqui grava no domínio.
 */

export const DAY_MS = 86_400_000;
/**
 * Prazo aprovado (D-18-NOTIF), escrito à mão para que os testes não
 * dependam da constante de produção.
 */
export const APPROVED_RETENTION_MS = 180 * DAY_MS;

export type DocSnapshot = admin.firestore.DocumentSnapshot;

export const workspacePath = (workspaceId: string) =>
  `workspaces/${workspaceId}`;

export const notificationsCollection = (workspaceId: string) =>
  db().collection(`${workspacePath(workspaceId)}/notifications`);

export const notificationRef = (workspaceId: string, id: string) =>
  notificationsCollection(workspaceId).doc(id);

export const stateRef = (workspaceId: string, uid: string, id: string) =>
  db().doc(`${workspacePath(workspaceId)}/notification_user_states/${uid}/` +
    `notification_entries/${id}`);

/**
 * Trabalho pendente e confirmação de entrega do aviso de recebível vencido
 * (P5-D2.1). Caminhos escritos à mão, sem as constantes de produção.
 */
export const overdueQueueRef = (workspaceId: string, receivableId: string) =>
  db().doc(`${workspacePath(workspaceId)}/receivable_overdue_queue/` +
    receivableId);

export const overdueDeliveryRef = (
  workspaceId: string,
  notificationId: string,
) => db().doc(`${workspacePath(workspaceId)}/receivable_overdue_deliveries/` +
  notificationId);

export type Doc = Record<string, unknown>;

export const notificationsOf = async (workspaceId: string): Promise<Doc[]> =>
  (await notificationsCollection(workspaceId).get()).docs
    .map((doc) => ({id: doc.id, ...doc.data()}));

export const notificationsOfType = async (
  workspaceId: string,
  eventType: NotificationEventType,
): Promise<Doc[]> =>
  (await notificationsOf(workspaceId))
    .filter((item) => item.domainEventType === eventType);

/** `AAAA-MM-DD` → `DD/MM/AAAA`, escrito à mão (não usa o do produtor). */
export const br = (dayKey: string): string => {
  const [year, month, day] = dayKey.split("-");
  return `${day}/${month}/${year}`;
};

/** Dia civil de São Paulo de um instante, `AAAA-MM-DD`. */
export const saoPauloDay = (instant: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Leitura do documento exatamente como o gatilho a recebe. */
export const capture = (
  ref: admin.firestore.DocumentReference,
): Promise<DocSnapshot> => ref.get();

interface Runnable {
  run: (event: unknown) => unknown;
}

const run = async (fn: unknown, event: unknown): Promise<void> => {
  await (fn as Runnable).run(event);
};

export const deliverLoanWrite = (
  workspaceId: string,
  loanId: string,
  before: DocSnapshot,
  after: DocSnapshot,
  eventId?: string,
) => run(onLoanWriteNotification, {
  ...(eventId ? {id: eventId} : {}),
  data: {before, after},
  params: {workspaceId, loanId},
});

export const deliverCashAccountWrite = (
  workspaceId: string,
  accountId: string,
  before: DocSnapshot,
  after: DocSnapshot,
  eventId?: string,
) => run(onCashAccountWriteNotification, {
  ...(eventId ? {id: eventId} : {}),
  data: {before, after},
  params: {workspaceId, accountId},
});

export const deliverGoalWrite = (
  workspaceId: string,
  goalId: string,
  before: DocSnapshot,
  after: DocSnapshot,
  eventId?: string,
) => run(onGoalWriteNotification, {
  ...(eventId ? {id: eventId} : {}),
  data: {before, after},
  params: {workspaceId, goalId},
});

export const deliverOccurrenceCreated = (
  workspaceId: string,
  occurrenceId: string,
  created: DocSnapshot,
  eventId?: string,
) => run(onRecurringOccurrenceCreatedNotification, {
  ...(eventId ? {id: eventId} : {}),
  data: created,
  params: {workspaceId, occurrenceId},
});

/**
 * Executa a operação de domínio entre duas leituras do documento e entrega o
 * par ao gatilho. Devolve as duas leituras para as asserções do teste.
 */
export const writeAndDeliver = async (
  ref: admin.firestore.DocumentReference,
  operation: () => Promise<unknown>,
  deliver: (before: DocSnapshot, after: DocSnapshot) => Promise<void>,
): Promise<{before: DocSnapshot; after: DocSnapshot}> => {
  const before = await capture(ref);
  await operation();
  const after = await capture(ref);
  await deliver(before, after);
  return {before, after};
};

/**
 * Estado operacional das notificações, fora do domínio financeiro: os avisos,
 * o estado de cada usuário e, para recebíveis vencidos (P5-D2.1), o trabalho
 * pendente e a confirmação de entrega. Lista fechada: qualquer outra coleção
 * entra no instantâneo do domínio.
 */
export const NOTIFICATION_OPERATIONAL_COLLECTIONS: readonly string[] = [
  "notifications",
  "notification_user_states",
  "receivable_overdue_queue",
  "receivable_overdue_deliveries",
];

/**
 * Fotografia de tudo o que existe sob o workspace, exceto o estado
 * operacional das notificações: caminho → dados e instante da última
 * escrita. Comparar duas fotografias prova que nada do domínio (ledger,
 * projeções, contas, contratos) foi tocado.
 */
export const domainSnapshot = async (
  workspaceId: string,
): Promise<Map<string, {data: Doc; updateTime: Timestamp}>> => {
  const result = new Map<string, {data: Doc; updateTime: Timestamp}>();
  const collections = await db().doc(workspacePath(workspaceId))
    .listCollections();
  for (const collection of collections) {
    if (NOTIFICATION_OPERATIONAL_COLLECTIONS.includes(collection.id)) continue;
    for (const doc of (await collection.get()).docs) {
      result.set(doc.ref.path, {
        data: doc.data() as Doc,
        updateTime: doc.updateTime,
      });
    }
  }
  return result;
};

export const assertDomainUntouched = (
  before: Map<string, {data: Doc; updateTime: Timestamp}>,
  after: Map<string, {data: Doc; updateTime: Timestamp}>,
) => {
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(),
    "nenhum documento de domínio criado ou removido");
  for (const [path, entry] of before) {
    const later = after.get(path);
    assert.ok(later, path);
    assert.deepEqual(later.data, entry.data, `${path} idêntico`);
    assert.ok(later.updateTime.isEqual(entry.updateTime),
      `${path} sem nova escrita`);
  }
};

/** Campos permitidos num evento do tipo, pelo contrato. */
export const contractFieldsFor = (
  eventType: NotificationEventType,
): string[] => [
  "id", "workspaceId", "title", "message", "type", "link", "actionLabel",
  "createdAt", "expiresAt", "source", "domain", "domainEventType",
  ...NOTIFICATION_ENTITY_FIELDS[NOTIFICATION_EVENT_DOMAIN[eventType]],
];

/** O evento tem exatamente os campos do contrato, nenhum a mais. */
export const assertOnlyContractFields = (
  item: Doc,
  eventType: NotificationEventType,
) => {
  assert.deepEqual(
    Object.keys(item).sort(),
    contractFieldsFor(eventType).sort(),
    `campos do evento ${eventType}`,
  );
  for (const forbidden of ["personName", "personContact", "description",
    "name", "clientId", "document", "email", "phone", "amountCents",
    "balanceCents", "valueCents", "plannedAmountCents", "read", "uid",
    "audienceUid"]) {
    assert.ok(!(forbidden in item), `campo proibido: ${forbidden}`);
  }
};

/** Contrato de retenção: `createdAt` ISO, `expiresAt` Timestamp, 180 dias. */
export const assertRetention = (item: Doc) => {
  assert.equal(typeof item.createdAt, "string");
  const createdMs = Date.parse(String(item.createdAt));
  assert.ok(Number.isFinite(createdMs));
  assert.equal(new Date(createdMs).toISOString(), item.createdAt);
  assert.ok(item.expiresAt instanceof Timestamp,
    "expiresAt é Timestamp nativo");
  assert.equal(item.expiresAt.toMillis() - createdMs, APPROVED_RETENTION_MS,
    "expiresAt = createdAt + 180 dias exatos");
};

// ---------------------------------------------------- fixtures da contagem

const ENTITY_VALUE: Record<string, (seed: string) => string> = {
  cardId: (seed) => `card-${seed}`,
  invoiceId: (seed) => `inv-${seed}`,
  loanId: (seed) => `loan-${seed}`,
  receivableId: (seed) => `rec-${seed}`,
  accountId: (seed) => `acc-${seed}`,
  goalId: (seed) => `goal-${seed}`,
  recurringExpenseId: (seed) => `rx-${seed}`,
  occurrenceId: (seed) => `occ-${seed}`,
};

/** Tipos usados em rodízio nos conjuntos grandes (todos os domínios). */
export const EVENT_TYPE_CYCLE: NotificationEventType[] = [
  "invoice_closed", "invoice_due_soon", "invoice_overdue", "loan_overdue",
  "receivable_overdue", "cash_account_negative_balance", "goal_achieved",
  "recurring_awaiting_confirmation", "recurring_attention_required",
];

export type Mark = "read" | "dismissed" | "deleted";

/** Um evento da fixture: dados e marcas por usuário, em JS puro. */
export interface Fixture {
  id: string;
  /** Instante de criação em ms; `expiresAt` esperado = + 180 dias. */
  createdAtMs: number;
  marks: Record<string, Mark[]>;
  /** Evento removido fisicamente (TTL já passou), estado permanece. */
  eventRemoved?: boolean;
  /** Estado removido fisicamente (TTL já passou), evento permanece. */
  statesRemoved?: boolean;
}

export const fixtureExpiresAtMs = (fixture: Fixture): number =>
  fixture.createdAtMs + APPROVED_RETENTION_MS;

/** Documento do evento pelo builder real (nunca montado à mão). */
export const eventDocumentFor = (
  workspaceId: string,
  fixture: Fixture,
  eventType: NotificationEventType = "loan_overdue",
) => {
  const domain = NOTIFICATION_EVENT_DOMAIN[eventType];
  const entity: Record<string, string> = {};
  for (const field of NOTIFICATION_ENTITY_FIELDS[domain]) {
    entity[field] = ENTITY_VALUE[field](fixture.id);
  }
  return buildNotificationDocument({
    id: fixture.id,
    workspaceId,
    eventType,
    title: `Aviso ${fixture.id}`.slice(0, 80),
    message: "Fato de domínio de teste, no passado.",
    type: "info",
    link: "loans",
    createdAtMs: fixture.createdAtMs,
    entity,
  });
};

export const stateDocumentFor = (
  marks: Mark[],
  expiresAt: Timestamp,
): Doc => {
  assert.ok(marks.length >= 1, "todo estado tem ao menos uma marca");
  const stamp = Timestamp.now();
  const state: Doc = {expiresAt};
  for (const mark of marks) {
    state[mark] = true;
    state[`${mark}At`] = stamp;
  }
  return state;
};

/**
 * Grava a fixture no Emulator pelo Admin SDK, respeitando o contrato:
 * eventos pelo builder real e estados com o `expiresAt` do evento e ao menos
 * uma marca. `eventRemoved`/`statesRemoved` simulam a remoção física do TTL
 * (o Emulator não executa a política).
 */
export const seedFixtures = async (
  workspaceId: string,
  fixtures: Fixture[],
  eventTypeFor: (index: number) => NotificationEventType = () => "loan_overdue",
): Promise<void> => {
  let batch = db().batch();
  let size = 0;
  const flush = async (force = false) => {
    if (size >= 400 || (force && size > 0)) {
      await batch.commit();
      batch = db().batch();
      size = 0;
    }
  };
  for (const [index, fixture] of fixtures.entries()) {
    const document = eventDocumentFor(workspaceId, fixture,
      eventTypeFor(index));
    if (!fixture.eventRemoved) {
      batch.create(notificationRef(workspaceId, fixture.id), document);
      size += 1;
      await flush();
    }
    if (!fixture.statesRemoved) {
      for (const [uid, marks] of Object.entries(fixture.marks)) {
        if (marks.length === 0) continue;
        batch.create(stateRef(workspaceId, uid, fixture.id),
          stateDocumentFor(marks, document.expiresAt as Timestamp));
        size += 1;
        await flush();
      }
    }
  }
  await flush(true);
};

/**
 * Oráculo independente: filtro simples em JS sobre as fixtures. Não lê o
 * Firestore e não usa a fórmula de produção (contagem de eventos menos
 * contagem de estados).
 */
export const expectedUnread = (
  fixtures: Fixture[],
  uid: string,
  nowMs: number,
): number =>
  fixtures.filter((fixture) =>
    fixtureExpiresAtMs(fixture) > nowMs &&
    (fixture.statesRemoved || (fixture.marks[uid] ?? []).length === 0))
    .length;

export const rateLimitRef = (
  workspaceId: string,
  uid: string,
  policy: RateLimitPolicy,
) => db().doc(`${workspacePath(workspaceId)}/rate_limits/` +
  rateLimitDocumentId(policy, uid));
