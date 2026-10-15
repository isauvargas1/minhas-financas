import assert from "node:assert/strict";
import test from "node:test";

import {Timestamp} from "firebase-admin/firestore";

import {buildNotificationDocument} from "../builder";
import {
  NOTIFICATION_DOCUMENT_FIELDS,
  NOTIFICATION_EVENT_TYPES,
  NotificationContractError,
  NotificationInput,
} from "../contract";
import {notificationIdFor} from "../ids";
import {notificationPublishLogFields} from "../publish";

const DAY_MS = 86_400_000;
const CREATED_AT_MS = Date.parse("2026-03-10T15:00:00.123Z");

interface Case {
  eventType: NotificationInput["eventType"];
  domain: string;
  source: string;
  link: NotificationInput["link"];
  actionLabel: string;
  entity: Record<string, string>;
}

const CASES: Case[] = [
  {
    eventType: "invoice_closed", domain: "credit_card",
    source: "credit_card_invoice", link: "cards", actionLabel: "Ver cartões",
    entity: {cardId: "card-1", invoiceId: "inv-1"},
  },
  {
    eventType: "invoice_due_soon", domain: "credit_card",
    source: "credit_card_invoice", link: "cards", actionLabel: "Ver cartões",
    entity: {cardId: "card-1", invoiceId: "inv-1"},
  },
  {
    eventType: "invoice_overdue", domain: "credit_card",
    source: "credit_card_invoice", link: "cards", actionLabel: "Ver cartões",
    entity: {cardId: "card-1", invoiceId: "inv-1"},
  },
  {
    eventType: "loan_overdue", domain: "loan", source: "loan",
    link: "loans", actionLabel: "Ver empréstimos",
    entity: {loanId: "loan-1"},
  },
  {
    eventType: "receivable_overdue", domain: "receivable",
    source: "receivable", link: "clients_receivables",
    actionLabel: "Ver recebíveis", entity: {receivableId: "rec-1"},
  },
  {
    eventType: "cash_account_negative_balance", domain: "cash_account",
    source: "cash_account", link: "settings",
    actionLabel: "Abrir configurações", entity: {accountId: "acc-1"},
  },
  {
    eventType: "goal_achieved", domain: "goal", source: "goal",
    link: "goals", actionLabel: "Ver metas", entity: {goalId: "goal-1"},
  },
  {
    eventType: "recurring_awaiting_confirmation", domain: "recurring",
    source: "recurring_occurrence", link: "recurring",
    actionLabel: "Ver recorrentes",
    entity: {recurringExpenseId: "rx-1", occurrenceId: "oc-1"},
  },
  {
    eventType: "recurring_attention_required", domain: "recurring",
    source: "recurring_occurrence", link: "recurring",
    actionLabel: "Ver recorrentes",
    entity: {recurringExpenseId: "rx-1", occurrenceId: "oc-1"},
  },
];

const inputFor = (item: Case, overrides: Record<string, unknown> = {}) =>
  ({
    id: "evento_1-A",
    workspaceId: "ws-1",
    eventType: item.eventType,
    title: "Título do evento",
    message: "Mensagem do evento.",
    type: "warning",
    link: item.link,
    createdAtMs: CREATED_AT_MS,
    entity: {...item.entity},
    ...overrides,
  }) as unknown as NotificationInput;

const cardCase = CASES[0];
const build = (overrides: Record<string, unknown> = {}) =>
  buildNotificationDocument(inputFor(cardCase, overrides));

const assertViolation = (
  run: () => unknown,
  reason: string,
  label: string,
): void => {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof NotificationContractError, label);
    assert.equal(error.reason, reason, label);
    return true;
  }, label);
};

test("o contrato cobre os 9 tipos de evento", () => {
  assert.equal(NOTIFICATION_EVENT_TYPES.length, 9);
  assert.deepEqual(
    [...NOTIFICATION_EVENT_TYPES].sort(),
    CASES.map((item) => item.eventType).sort());
});

for (const item of CASES) {
  test(`documento válido para ${item.eventType}`, () => {
    const document = buildNotificationDocument(inputFor(item));
    assert.deepEqual(
      Object.keys(document).sort(),
      [...NOTIFICATION_DOCUMENT_FIELDS, ...Object.keys(item.entity)].sort());
    assert.equal(document.id, "evento_1-A");
    assert.equal(document.workspaceId, "ws-1");
    assert.equal(document.title, "Título do evento");
    assert.equal(document.message, "Mensagem do evento.");
    assert.equal(document.type, "warning");
    assert.equal(document.domain, item.domain);
    assert.equal(document.source, item.source);
    assert.equal(document.domainEventType, item.eventType);
    assert.equal(document.link, item.link);
    assert.equal(document.actionLabel, item.actionLabel);
    for (const [field, value] of Object.entries(item.entity)) {
      assert.equal(document[field], value);
    }
  });
}

test("expiresAt é um Timestamp 180 dias exatos depois de createdAt", () => {
  const document = build();
  assert.equal(document.createdAt, "2026-03-10T15:00:00.123Z");
  assert.ok(document.expiresAt instanceof Timestamp);
  assert.equal(
    (document.expiresAt as Timestamp).toMillis(),
    CREATED_AT_MS + 180 * DAY_MS);
  assert.equal(
    (document.expiresAt as Timestamp).toMillis() -
      Date.parse(document.createdAt as string),
    15_552_000_000);
});

test("é determinístico: a mesma entrada dá o mesmo documento", () => {
  assert.deepEqual(build(), build());
  assert.notDeepEqual(build(), build({createdAtMs: CREATED_AT_MS + 1}));
});

test("aviso de cartão equivale ao documento de cards/closing.ts", () => {
  const document = buildNotificationDocument(inputFor(cardCase, {
    id: "ccclosed_0123456789abcdef0123456789abcdef",
    workspaceId: "workspace-1",
    title: "Fatura fechada",
    message: "A fatura de 03/2026 do cartão Nubank fechou em R$ 100,00, " +
      "com vencimento em 10/04/2026.",
    type: "credit_card",
  }));
  assert.deepEqual(document, {
    id: "ccclosed_0123456789abcdef0123456789abcdef",
    workspaceId: "workspace-1",
    title: "Fatura fechada",
    message: "A fatura de 03/2026 do cartão Nubank fechou em R$ 100,00, " +
      "com vencimento em 10/04/2026.",
    type: "credit_card",
    link: "cards",
    actionLabel: "Ver cartões",
    createdAt: "2026-03-10T15:00:00.123Z",
    expiresAt: Timestamp.fromMillis(CREATED_AT_MS + 180 * DAY_MS),
    source: "credit_card_invoice",
    domain: "credit_card",
    domainEventType: "invoice_closed",
    cardId: "card-1",
    invoiceId: "inv-1",
  });
});

test("rejeita id inválido", () => {
  for (const id of ["a/b", "", "a".repeat(129), "com espaço", 7, undefined]) {
    assertViolation(() => build({id}), "invalid_id", `id ${String(id)}`);
  }
  assert.equal(build({id: "a".repeat(128)}).id, "a".repeat(128));
});

test("rejeita workspace inválido", () => {
  for (const workspaceId of ["", "a/b", " ws", "..", "__x__", 3, undefined]) {
    assertViolation(() => build({workspaceId}), "invalid_workspace",
      `workspace ${String(workspaceId)}`);
  }
});

test("rejeita tipo de evento desconhecido ou herdado de protótipo", () => {
  for (const eventType of [
    "toString", "constructor", "__proto__", "unknown", "", 1, undefined,
  ]) {
    assertViolation(() => build({eventType}), "unknown_event_type",
      `eventType ${String(eventType)}`);
  }
});

test("rejeita título inválido", () => {
  const invalid = ["", " Título", "Título ", "a".repeat(81), "Tí\ntulo",
    "Tí\u0000tulo", "Tí\u007ftulo", 5, undefined];
  for (const title of invalid) {
    assertViolation(() => build({title}), "invalid_title",
      `title ${JSON.stringify(title)}`);
  }
  assert.equal(build({title: "a".repeat(80)}).title, "a".repeat(80));
});

test("rejeita mensagem inválida", () => {
  const invalid = ["", " msg", "msg ", "a".repeat(301), "m\tsg", null];
  for (const message of invalid) {
    assertViolation(() => build({message}), "invalid_message",
      `message ${JSON.stringify(message)}`);
  }
  assert.equal(build({message: "a".repeat(300)}).message, "a".repeat(300));
});

test("rejeita apresentação inválida", () => {
  for (const type of ["danger", "", "toString", 1, undefined]) {
    assertViolation(() => build({type}), "invalid_type",
      `type ${String(type)}`);
  }
  for (const type of ["info", "success", "warning", "error", "credit_card"]) {
    assert.equal(build({type}).type, type);
  }
});

test("rejeita link que não é chave de tela interna", () => {
  for (const link of ["https://x", "admin", "", "toString", "Ver cartões", 1]) {
    assertViolation(() => build({link}), "invalid_link",
      `link ${String(link)}`);
  }
});

test("rejeita createdAtMs inválido", () => {
  for (const createdAtMs of [
    0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE,
    "1700000000000", null, undefined,
  ]) {
    assertViolation(() => build({createdAtMs}), "invalid_created_at",
      `createdAtMs ${String(createdAtMs)}`);
  }
});

test("rejeita entidade fora do contrato do domínio", () => {
  const entities: Array<[string, unknown]> = [
    ["campo faltando", {cardId: "card-1"}],
    ["campo extra", {cardId: "card-1", invoiceId: "inv-1", extra: "x"}],
    ["campo de outro domínio", {cardId: "card-1", loanId: "loan-1"}],
    ["somente outro domínio", {loanId: "loan-1"}],
    ["sem campos", {}],
    ["valor vazio", {cardId: "", invoiceId: "inv-1"}],
    ["valor com barra", {cardId: "card/1", invoiceId: "inv-1"}],
    ["espaço nas pontas", {cardId: " card-1", invoiceId: "inv-1"}],
    ["valor longo", {cardId: "c".repeat(257), invoiceId: "inv-1"}],
    ["valor não textual", {cardId: 1, invoiceId: "inv-1"}],
    ["não é objeto", "card-1"],
    ["nulo", null],
    ["lista", ["card-1", "inv-1"]],
  ];
  for (const [label, entity] of entities) {
    assertViolation(() => build({entity}), "invalid_entity", label);
  }
  assert.equal(
    build({entity: {cardId: "c".repeat(256), invoiceId: "i"}}).cardId.length,
    256);
});

test("entidade herdada de protótipo não conta como campo próprio", () => {
  const inherited = Object.create({cardId: "card-1", invoiceId: "inv-1"});
  assertViolation(() => build({entity: inherited}), "invalid_entity",
    "protótipo");
});

const IDENTITY = {
  workspaceId: "ws-1",
  domain: "loan",
  entityId: "loan-1",
  eventType: "loan_overdue",
  episode: "2026-03-01",
} as const;

test("notificationIdFor é determinístico e tem prefixo por domínio", () => {
  assert.equal(notificationIdFor(IDENTITY), notificationIdFor({...IDENTITY}));
  const prefixes = {
    loan: "ln_", receivable: "rc_", cash_account: "ca_", goal: "gl_",
    recurring: "ro_",
  } as const;
  for (const [domain, prefix] of Object.entries(prefixes)) {
    const id = notificationIdFor({
      ...IDENTITY,
      domain: domain as keyof typeof prefixes,
    });
    assert.match(id, new RegExp(`^${prefix}[0-9a-f]{32}$`), domain);
    assert.equal(id.length, 3 + 32);
  }
});

test("notificationIdFor muda quando qualquer componente muda", () => {
  const base = notificationIdFor(IDENTITY);
  const variants = [
    {...IDENTITY, workspaceId: "ws-2"},
    {...IDENTITY, domain: "receivable" as const},
    {...IDENTITY, entityId: "loan-2"},
    {...IDENTITY, eventType: "receivable_overdue" as const},
    {...IDENTITY, episode: "2026-03-02"},
  ];
  const ids = new Set([base, ...variants.map(notificationIdFor)]);
  assert.equal(ids.size, 6);
});

test("notificationIdFor rejeita segmento inválido", () => {
  for (const field of [
    "workspaceId", "entityId", "episode",
  ] as const) {
    for (const value of ["a:b", "a/b", "", " a"]) {
      // Identidade inválida é contrato violado: o produtor registra e não
      // relança (sem reentrega envenenada do gatilho).
      assert.throws(
        () => notificationIdFor({...IDENTITY, [field]: value}),
        (error: unknown) => error instanceof NotificationContractError &&
          error.reason === "invalid_identity",
        `${field}=${JSON.stringify(value)}`);
    }
  }
});

test("o ID gerado é aceito pelo builder", () => {
  const id = notificationIdFor(IDENTITY);
  const document = buildNotificationDocument(inputFor(CASES[3], {id}));
  assert.equal(document.id, id);
});

test("notificationPublishLogFields expõe só identificadores", () => {
  const document = build();
  const fields = notificationPublishLogFields(document, "created");
  assert.deepEqual(fields, {
    workspaceId: "ws-1",
    notificationId: "evento_1-A",
    domain: "credit_card",
    domainEventType: "invoice_closed",
    outcome: "created",
  });
  assert.deepEqual(
    Object.keys(notificationPublishLogFields(document, "exists")).sort(),
    ["domain", "domainEventType", "notificationId", "outcome", "workspaceId"]);
  const serialized = JSON.stringify(fields);
  assert.ok(!serialized.includes(document.title as string));
  assert.ok(!serialized.includes(document.message as string));
  assert.ok(!serialized.includes("card-1"));
});
