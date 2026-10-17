import assert from "node:assert/strict";
import test from "node:test";

import {Timestamp} from "firebase-admin/firestore";

import {buildNotificationDocument} from "../builder";
import {
  NOTIFICATION_DOCUMENT_FIELDS,
  NotificationContractError,
  type NotificationInput,
} from "../contract";
import {notificationIdFor} from "../ids";
import {
  cashAccountNegativeBalanceNotification,
} from "../producers/cashAccounts";
import {
  dayLabel,
  publishProduced,
  saoPauloDayOf,
  timestampEpisode,
} from "../producers/common";
import type {OperationLogger} from "../../shared/logger";
import {goalAchievedNotification} from "../producers/goals";
import {loanOverdueNotification} from "../producers/loans";
import {
  RECEIVABLE_OVERDUE_BACKOFF_DAYS,
  RECEIVABLE_OVERDUE_CONCURRENCY,
  RECEIVABLE_OVERDUE_MAX_PAGES,
  RECEIVABLE_OVERDUE_PAGE_SIZE,
  RECEIVABLE_OVERDUE_PERSISTENT_ATTEMPTS,
  RECEIVABLE_OVERDUE_HARD_STOP_MS,
  RECEIVABLE_OVERDUE_TIME_BUDGET_MS,
  RECEIVABLE_OVERDUE_TRANSIENT_HOURLY_ATTEMPTS,
  RECEIVABLE_OVERDUE_WORKSPACE_SHARE,
  receivableOverdueBackoffDays,
  receivableOverdueErrorCode,
  receivableOverdueIsPersistent,
  receivableOverdueNotification,
} from "../producers/receivables";
import {
  ATTENTION_REASON,
  recurringOccurrenceNotification,
} from "../producers/recurring";
import {ATTENTION_CODES} from "../../recurring/model";

const WS = "ws-notif";
// 01:30 UTC de 11/03 = 22:30 de 10/03 em São Paulo.
const COMMIT = Timestamp.fromDate(new Date("2026-03-11T01:30:00.123Z"));
const OTHER_COMMIT = Timestamp.fromDate(new Date("2026-03-12T12:00:00.000Z"));

// Dados pessoais e valores que NUNCA podem aparecer em um aviso.
const PII_WORDS = [
  "Maria Souza", "maria@example.com", "11999990000", "Aluguel do galpão",
  "Cliente Alfa", "Conta Corrente Principal", "Meta Viagem",
];

const assertNoPersonalData = (
  input: NotificationInput,
  extraForbidden: string[] = [],
) => {
  const document = buildNotificationDocument(input);
  const allowed = new Set<string>([
    ...NOTIFICATION_DOCUMENT_FIELDS, ...Object.keys(input.entity),
  ]);
  for (const key of Object.keys(document)) {
    assert.ok(allowed.has(key), `campo inesperado no aviso: ${key}`);
  }
  for (const forbidden of ["personName", "personContact", "description",
    "name", "clientId", "amountCents", "balanceCents", "plannedAmountCents"]) {
    assert.ok(!(forbidden in document), `campo proibido: ${forbidden}`);
  }
  const text = JSON.stringify(document);
  for (const word of [...PII_WORDS, ...extraForbidden]) {
    assert.ok(!text.includes(word), `dado pessoal no aviso: ${word}`);
  }
  return document;
};

// ------------------------------------------------------------ fábricas

const loanDoc = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  workspaceId: WS,
  profileType: "PF",
  type: "borrow",
  createdBy: "uid-1",
  personName: "Maria Souza",
  personContact: "maria@example.com",
  description: "Aluguel do galpão",
  principalCents: 100_000,
  balanceCents: 80_000,
  totalPrincipalSettledCents: 20_000,
  totalInterestSettledCents: 0,
  activePaymentCount: 1,
  status: "overdue",
  overdueFrom: "2026-03-06",
  installmentsCount: 1,
  schedule: [{number: 1}],
  disbursementMovementId: "mov-1",
  disbursementTransactionId: "tx-1",
  revision: 3,
  updatedAt: COMMIT,
  ...overrides,
});

const cashAccountDoc = (id: string, balanceCents: number,
  overrides: Record<string, unknown> = {}) => ({
  id,
  schemaVersion: 1,
  workspaceId: WS,
  name: "Conta Corrente Principal",
  accountType: "checking",
  status: "active",
  balanceCents,
  currency: "BRL",
  createdBy: "uid-1",
  updatedAt: COMMIT,
  ...overrides,
});

const goalDoc = (status: string, overrides: Record<string, unknown> = {}) => ({
  workspaceId: WS,
  name: "Meta Viagem",
  status,
  archived: false,
  revision: 1,
  targetAmountCents: 500_000,
  ...overrides,
});

const occurrenceDoc = (
  status: string,
  overrides: Record<string, unknown> = {},
) => ({
  schemaVersion: 1,
  workspaceId: WS,
  recurringExpenseId: "rec-1",
  dueDate: "2026-03-15",
  competenceMonth: "2026-03",
  plannedAmountCents: 12_345,
  actualAmountCents: null,
  currency: "BRL",
  status,
  targetDomain: "cash",
  executionMode: "confirmation_required",
  cardId: null,
  cashAccountId: "acc-1",
  cashTransactionId: null,
  cardPurchaseId: null,
  attentionCode: null,
  revision: 1,
  updatedAt: COMMIT,
  ...overrides,
});

// ------------------------------------------------------------- comuns

test("comuns: rótulo de dia, dia de São Paulo e episódio por instante", () => {
  assert.equal(dayLabel("2026-03-06"), "06/03/2026");
  assert.equal(saoPauloDayOf(COMMIT), "2026-03-10");
  assert.equal(timestampEpisode(COMMIT), `${COMMIT.seconds}.123000000`);
  assert.ok(!timestampEpisode(COMMIT).includes(":"));
  assert.equal(
    timestampEpisode(Timestamp.fromMillis(5_000)),
    "5.000000000",
  );
});

// ------------------------------------------------------------ empréstimos

test("empréstimo a pagar: transição para atraso emite o texto exato", () => {
  const input = loanOverdueNotification({
    workspaceId: WS, loanId: "loan-1",
    before: loanDoc({status: "active", overdueFrom: null}),
    after: loanDoc(), commitTime: COMMIT,
  });
  assert.ok(input);
  assert.equal(input.eventType, "loan_overdue");
  assert.equal(input.title, "Empréstimo a pagar em atraso");
  assert.equal(input.message,
    "Foi identificado atraso em 10/03/2026 em um empréstimo a pagar: a " +
    "parcela com vencimento em 05/03/2026 não estava quitada.");
  assert.equal(input.type, "warning");
  assert.equal(input.link, "loans");
  assert.deepEqual(input.entity, {loanId: "loan-1"});
  assert.equal(input.createdAtMs, COMMIT.toMillis());
  assert.equal(input.id, notificationIdFor({
    workspaceId: WS, domain: "loan", entityId: "loan-1",
    eventType: "loan_overdue", episode: "2026-03-06",
  }));
  assert.match(input.id, /^ln_[0-9a-f]{32}$/);
  assertNoPersonalData(input);
});

test("empréstimo a receber: título e mensagem próprios", () => {
  const input = loanOverdueNotification({
    workspaceId: WS, loanId: "loan-2", before: undefined,
    after: loanDoc({type: "lend"}), commitTime: COMMIT,
  });
  assert.ok(input);
  assert.equal(input.title, "Empréstimo a receber em atraso");
  assert.equal(input.message,
    "Foi identificado atraso em 10/03/2026 em um empréstimo a receber: a " +
    "parcela com vencimento em 05/03/2026 não estava quitada.");
  assertNoPersonalData(input);
});

test("empréstimo: sem transição, fora do schema ou sem atraso", () => {
  const base = {workspaceId: WS, loanId: "loan-1", commitTime: COMMIT};
  // Já estava em atraso antes.
  assert.equal(loanOverdueNotification({
    ...base, before: loanDoc(), after: loanDoc({revision: 4}),
  }), null);
  // Depois não é atraso.
  assert.equal(loanOverdueNotification({
    ...base, before: loanDoc(), after: loanDoc({status: "active"}),
  }), null);
  // Exclusão.
  assert.equal(loanOverdueNotification({
    ...base, before: loanDoc(), after: undefined,
  }), null);
  // Fora do schema autoritativo (sem schemaVersion, workspace trocado,
  // overdueFrom inválido).
  for (const broken of [
    {schemaVersion: undefined},
    {workspaceId: "outro-ws"},
    {overdueFrom: null},
    {overdueFrom: "2026-02-30"},
    {principalCents: 1.5},
  ]) {
    assert.equal(loanOverdueNotification({
      ...base, before: loanDoc({status: "active"}),
      after: loanDoc(broken),
    }), null, JSON.stringify(broken));
  }
});

test("empréstimo: episódios diferentes geram IDs diferentes", () => {
  const first = loanOverdueNotification({
    workspaceId: WS, loanId: "loan-1", before: undefined,
    after: loanDoc({overdueFrom: "2026-03-06"}), commitTime: COMMIT,
  });
  const second = loanOverdueNotification({
    workspaceId: WS, loanId: "loan-1", before: undefined,
    after: loanDoc({overdueFrom: "2026-04-06"}), commitTime: OTHER_COMMIT,
  });
  const replay = loanOverdueNotification({
    workspaceId: WS, loanId: "loan-1", before: undefined,
    after: loanDoc({overdueFrom: "2026-03-06"}), commitTime: COMMIT,
  });
  assert.ok(first && second && replay);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(first, replay);
});

// ------------------------------------------------------------------ contas

test("conta: 0 → −1 emite com o texto exato e episódio do commit", () => {
  const input = cashAccountNegativeBalanceNotification({
    workspaceId: WS, accountId: "acc-1",
    before: cashAccountDoc("acc-1", 0),
    after: cashAccountDoc("acc-1", -1), commitTime: COMMIT,
  });
  assert.ok(input);
  assert.equal(input.eventType, "cash_account_negative_balance");
  assert.equal(input.title, "Saldo negativo em conta");
  assert.equal(input.message,
    "Uma conta ficou com saldo negativo em 10/03/2026. Confira em " +
    "Configurações, em Contas e carteiras.");
  assert.equal(input.type, "warning");
  assert.equal(input.link, "settings");
  assert.deepEqual(input.entity, {accountId: "acc-1"});
  assert.equal(input.createdAtMs, COMMIT.toMillis());
  assert.equal(input.id, notificationIdFor({
    workspaceId: WS, domain: "cash_account", entityId: "acc-1",
    eventType: "cash_account_negative_balance",
    episode: timestampEpisode(COMMIT),
  }));
  assert.match(input.id, /^ca_[0-9a-f]{32}$/);
  assertNoPersonalData(input);
});

test("conta: criação negativa, continuar negativo e subir não emitem", () => {
  const base = {workspaceId: WS, accountId: "acc-1", commitTime: COMMIT};
  // Criação já negativa: não é transição de não negativo para negativo.
  assert.equal(cashAccountNegativeBalanceNotification({
    ...base, before: undefined, after: cashAccountDoc("acc-1", -500),
  }), null);
  // −1 → −5.
  assert.equal(cashAccountNegativeBalanceNotification({
    ...base, before: cashAccountDoc("acc-1", -1),
    after: cashAccountDoc("acc-1", -5),
  }), null);
  // −5 → 10 e 10 → 20.
  assert.equal(cashAccountNegativeBalanceNotification({
    ...base, before: cashAccountDoc("acc-1", -5),
    after: cashAccountDoc("acc-1", 10),
  }), null);
  assert.equal(cashAccountNegativeBalanceNotification({
    ...base, before: cashAccountDoc("acc-1", 10),
    after: cashAccountDoc("acc-1", 20),
  }), null);
  // Exclusão.
  assert.equal(cashAccountNegativeBalanceNotification({
    ...base, before: cashAccountDoc("acc-1", 10), after: undefined,
  }), null);
});

test("conta: antes ou depois fora do schema não emite", () => {
  const base = {workspaceId: WS, accountId: "acc-1", commitTime: COMMIT};
  for (const broken of [
    {schemaVersion: 2}, {workspaceId: "outro-ws"}, {id: "outra"},
    {currency: "USD"}, {updatedAt: "ontem"},
  ]) {
    assert.equal(cashAccountNegativeBalanceNotification({
      ...base, before: cashAccountDoc("acc-1", 0),
      after: cashAccountDoc("acc-1", -1, broken),
    }), null, `depois ${JSON.stringify(broken)}`);
    assert.equal(cashAccountNegativeBalanceNotification({
      ...base, before: cashAccountDoc("acc-1", 0, broken),
      after: cashAccountDoc("acc-1", -1),
    }), null, `antes ${JSON.stringify(broken)}`);
  }
});

test("conta: dois episódios negativos geram IDs distintos", () => {
  const first = cashAccountNegativeBalanceNotification({
    workspaceId: WS, accountId: "acc-1",
    before: cashAccountDoc("acc-1", 0), after: cashAccountDoc("acc-1", -1),
    commitTime: COMMIT,
  });
  const second = cashAccountNegativeBalanceNotification({
    workspaceId: WS, accountId: "acc-1",
    before: cashAccountDoc("acc-1", 5), after: cashAccountDoc("acc-1", -7),
    commitTime: OTHER_COMMIT,
  });
  assert.ok(first && second);
  assert.notEqual(first.id, second.id);
});

// ------------------------------------------------------------------ metas

test("meta: transição para alcançada emite com o texto exato", () => {
  for (const before of [undefined, goalDoc("em_andamento"),
    goalDoc("pausada")]) {
    const input = goalAchievedNotification({
      workspaceId: WS, goalId: "goal-1", before,
      after: goalDoc("alcancada"), commitTime: COMMIT,
    });
    assert.ok(input);
    assert.equal(input.eventType, "goal_achieved");
    assert.equal(input.title, "Meta alcançada");
    assert.equal(input.message,
      "Uma meta foi marcada como alcançada em 10/03/2026.");
    assert.equal(input.type, "success");
    assert.equal(input.link, "goals");
    assert.deepEqual(input.entity, {goalId: "goal-1"});
    assert.equal(input.createdAtMs, COMMIT.toMillis());
    assert.equal(input.id, notificationIdFor({
      workspaceId: WS, domain: "goal", entityId: "goal-1",
      eventType: "goal_achieved", episode: timestampEpisode(COMMIT),
    }));
    assert.match(input.id, /^gl_[0-9a-f]{32}$/);
    assertNoPersonalData(input);
  }
});

test("meta: alcancada → alcancada, outro status ou schema inválido", () => {
  const base = {workspaceId: WS, goalId: "goal-1", commitTime: COMMIT};
  assert.equal(goalAchievedNotification({
    ...base, before: goalDoc("alcancada"),
    after: goalDoc("alcancada", {revision: 2}),
  }), null);
  assert.equal(goalAchievedNotification({
    ...base, before: goalDoc("alcancada"),
    after: goalDoc("alcancada", {archived: true}),
  }), null);
  assert.equal(goalAchievedNotification({
    ...base, before: goalDoc("alcancada"), after: goalDoc("em_andamento"),
  }), null);
  assert.equal(goalAchievedNotification({
    ...base, before: goalDoc("em_andamento"), after: goalDoc("cancelada"),
  }), null);
  assert.equal(goalAchievedNotification({
    ...base, before: goalDoc("em_andamento"), after: undefined,
  }), null);
  // Workspace diferente do caminho.
  assert.equal(goalAchievedNotification({
    ...base, before: goalDoc("em_andamento"),
    after: goalDoc("alcancada", {workspaceId: "outro-ws"}),
  }), null);
});

// ------------------------------------------------------------- recorrentes

test("recorrente aguardando confirmação: texto exato e episódio", () => {
  const input = recurringOccurrenceNotification({
    workspaceId: WS, occurrenceId: "occ-1",
    data: occurrenceDoc("awaiting_confirmation"), createTime: COMMIT,
  });
  assert.ok(input);
  assert.equal(input.eventType, "recurring_awaiting_confirmation");
  assert.equal(input.title, "Despesa recorrente aguardando confirmação");
  assert.equal(input.message,
    // COMMIT = 2026-03-11T01:30Z = 10/03/2026, 22:30 em São Paulo.
    "Em 10/03/2026, uma despesa recorrente com vencimento em 15/03/2026 " +
    "ficou aguardando confirmação.");
  assert.equal(input.type, "warning");
  assert.equal(input.link, "recurring");
  assert.deepEqual(input.entity,
    {recurringExpenseId: "rec-1", occurrenceId: "occ-1"});
  assert.equal(input.createdAtMs, COMMIT.toMillis());
  assert.equal(input.id, notificationIdFor({
    workspaceId: WS, domain: "recurring", entityId: "occ-1",
    eventType: "recurring_awaiting_confirmation", episode: "occ-1",
  }));
  assert.match(input.id, /^ro_[0-9a-f]{32}$/);
  assertNoPersonalData(input, ["12345", "12.345"]);
});

test("recorrente com atenção: cada código tem motivo e texto exato", () => {
  const expected: Record<string, string> = {
    card_unavailable: "o cartão não estava disponível",
    card_archived: "o cartão estava arquivado",
    limit_insufficient: "o limite do cartão era insuficiente",
    account_unavailable: "a conta não estava disponível",
    account_archived: "a conta estava arquivada",
    workspace_unavailable: "o espaço de trabalho não estava disponível",
  };
  assert.deepEqual(Object.keys(ATTENTION_REASON).sort(),
    [...ATTENTION_CODES].sort());
  assert.deepEqual(ATTENTION_REASON, expected);
  for (const code of ATTENTION_CODES) {
    const input = recurringOccurrenceNotification({
      workspaceId: WS, occurrenceId: "occ-2",
      data: occurrenceDoc("attention_required", {attentionCode: code}),
      createTime: COMMIT,
    });
    assert.ok(input, code);
    assert.equal(input.eventType, "recurring_attention_required");
    assert.equal(input.title, "Despesa recorrente não gerada");
    assert.equal(input.message,
      "Em 10/03/2026, uma despesa recorrente com vencimento em " +
      `15/03/2026 não pôde ser gerada: ${expected[code]}.`);
    assert.equal(input.type, "warning");
    assert.equal(input.id, notificationIdFor({
      workspaceId: WS, domain: "recurring", entityId: "occ-2",
      eventType: "recurring_attention_required", episode: "occ-2",
    }));
    assertNoPersonalData(input, ["12345"]);
  }
});

test("recorrente: gerada, ignorada ou fora do schema não emitem", () => {
  const base = {workspaceId: WS, occurrenceId: "occ-3", createTime: COMMIT};
  assert.equal(recurringOccurrenceNotification({
    ...base,
    data: occurrenceDoc("generated", {cashTransactionId: "tx-1"}),
  }), null);
  assert.equal(recurringOccurrenceNotification({
    ...base, data: occurrenceDoc("ignored"),
  }), null);
  for (const broken of [
    {schemaVersion: 2}, {workspaceId: "outro-ws"}, {dueDate: "2026-02-30"},
    // Atenção sem código e código sem atenção violam o schema.
    {status: "attention_required", attentionCode: null},
    {status: "awaiting_confirmation", attentionCode: "card_archived"},
  ]) {
    assert.equal(recurringOccurrenceNotification({
      ...base, data: occurrenceDoc("awaiting_confirmation", broken),
    }), null, JSON.stringify(broken));
  }
  assert.equal(recurringOccurrenceNotification({
    ...base, data: undefined,
  }), null);
});

// -------------------------------------------------------------- recebíveis

test("recebível vencido: mensagem e ID determinísticos por vencimento", () => {
  const createdAtMs = COMMIT.toMillis();
  const input = receivableOverdueNotification({
    workspaceId: WS, receivableId: "rcv-1", dueDate: "2026-03-06",
    today: "2026-03-10", createdAtMs,
  });
  assert.equal(input.eventType, "receivable_overdue");
  assert.equal(input.title, "Recebível vencido");
  assert.equal(input.message,
    "Foi identificado atraso em 10/03/2026 em um recebível com vencimento " +
    "em 06/03/2026, que tinha saldo a receber.");
  assert.equal(input.type, "warning");
  assert.equal(input.link, "clients_receivables");
  assert.deepEqual(input.entity, {receivableId: "rcv-1"});
  assert.equal(input.createdAtMs, createdAtMs);
  assert.equal(input.id, notificationIdFor({
    workspaceId: WS, domain: "receivable", entityId: "rcv-1",
    eventType: "receivable_overdue", episode: "2026-03-06",
  }));
  assert.match(input.id, /^rc_[0-9a-f]{32}$/);
  assertNoPersonalData(input);

  // Outro dia de detecção: mesmo ID (mesmo vencimento); outro vencimento:
  // outro ID.
  const nextDay = receivableOverdueNotification({
    workspaceId: WS, receivableId: "rcv-1", dueDate: "2026-03-06",
    today: "2026-03-11", createdAtMs: createdAtMs + 86_400_000,
  });
  assert.equal(nextDay.id, input.id);
  const moved = receivableOverdueNotification({
    workspaceId: WS, receivableId: "rcv-1", dueDate: "2026-03-08",
    today: "2026-03-10", createdAtMs,
  });
  assert.notEqual(moved.id, input.id);
});

test("recebível: limites explícitos por execução (P5-D2.1)", () => {
  // Página 100, teto de 200 páginas por execução (as duas passadas somadas;
  // com transações rápidas, é ele que limita), até 500 itens por workspace na
  // 1ª passada, 10 transações em paralelo, 420 s para iniciar páginas e 480 s
  // para iniciar itens, dentro do tempo limite de 540 s da rotina.
  assert.equal(RECEIVABLE_OVERDUE_PAGE_SIZE, 100);
  assert.equal(RECEIVABLE_OVERDUE_MAX_PAGES, 200);
  assert.equal(RECEIVABLE_OVERDUE_WORKSPACE_SHARE, 500);
  assert.equal(RECEIVABLE_OVERDUE_CONCURRENCY, 10);
  assert.equal(RECEIVABLE_OVERDUE_TIME_BUDGET_MS, 420_000);
  assert.equal(RECEIVABLE_OVERDUE_HARD_STOP_MS, 480_000);
  assert.equal(RECEIVABLE_OVERDUE_PERSISTENT_ATTEMPTS, 5);
});

test("recebível: backoff limitado por classe de falha, nunca descarte " +
  "por tentativas", () => {
  assert.deepEqual([...RECEIVABLE_OVERDUE_BACKOFF_DAYS], [0, 1, 2, 4, 7]);
  const attempts = [1, 2, 3, 4, 5, 6, 7, 8, 10, 100, 10_000];
  for (const code of ["receivable_invalid", "contract_violation",
    "unknown"] as const) {
    assert.deepEqual(attempts.map((n) => receivableOverdueBackoffDays(n, code)),
      [0, 1, 2, 4, 7, 7, 7, 7, 7, 7, 7],
      `${code}: 1ª na próxima execução; depois 1, 2, 4 e 7 dias, sem teto`);
  }
  assert.equal(RECEIVABLE_OVERDUE_TRANSIENT_HOURLY_ATTEMPTS, 6);
  for (const code of ["unavailable", "timeout", "contention",
    "resource_exhausted", "internal"] as const) {
    assert.deepEqual(attempts.map((n) => receivableOverdueBackoffDays(n, code)),
      [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
      `${code}: a cada execução horária nas 6 primeiras; depois todo dia`);
  }
});

test("recebível: falha persistente sinalizada na 5ª tentativa; na " +
  "transitória, só depois da fase horária", () => {
  const flags = (code: Parameters<typeof receivableOverdueIsPersistent>[1]) =>
    [1, 4, 5, 6, 7, 8].map((n) => receivableOverdueIsPersistent(n, code));
  for (const code of ["receivable_invalid", "contract_violation",
    "unknown"] as const) {
    assert.deepEqual(flags(code), [false, false, true, true, true, true],
      code);
  }
  for (const code of ["unavailable", "timeout", "contention",
    "resource_exhausted", "internal"] as const) {
    assert.deepEqual(flags(code), [false, false, false, false, true, true],
      code);
  }
});

test("recebível: o código da falha é tipado e nunca a mensagem", () => {
  const withCode = (code: unknown, message = "detalhe interno") =>
    Object.assign(new Error(message), {code});
  assert.equal(receivableOverdueErrorCode(withCode(4)), "timeout");
  assert.equal(receivableOverdueErrorCode(withCode(8)), "resource_exhausted");
  assert.equal(receivableOverdueErrorCode(withCode(13)), "internal");
  assert.equal(receivableOverdueErrorCode(withCode(14)), "unavailable");
  assert.equal(receivableOverdueErrorCode(withCode(10)), "contention");
  assert.equal(receivableOverdueErrorCode(withCode(3,
    "The referenced transaction has expired or is no longer valid")),
  "contention");
  assert.equal(receivableOverdueErrorCode(withCode(3, "outro")), "unknown");
  assert.equal(receivableOverdueErrorCode(
    new NotificationContractError("invalid_message")), "contract_violation");
  assert.equal(receivableOverdueErrorCode(new Error("sem código")), "unknown");
  assert.equal(receivableOverdueErrorCode(withCode("unavailable")), "unknown");
  assert.equal(receivableOverdueErrorCode(null), "unknown");
});

// ---------------------------------------------------------- todos juntos

test("todo aviso produzido passa pelo builder e respeita o contrato", () => {
  const produced: Array<NotificationInput | null> = [
    loanOverdueNotification({
      workspaceId: WS, loanId: "loan-1", before: undefined,
      after: loanDoc(), commitTime: COMMIT,
    }),
    cashAccountNegativeBalanceNotification({
      workspaceId: WS, accountId: "acc-1",
      before: cashAccountDoc("acc-1", 0), after: cashAccountDoc("acc-1", -1),
      commitTime: COMMIT,
    }),
    goalAchievedNotification({
      workspaceId: WS, goalId: "goal-1", before: undefined,
      after: goalDoc("alcancada"), commitTime: COMMIT,
    }),
    recurringOccurrenceNotification({
      workspaceId: WS, occurrenceId: "occ-1",
      data: occurrenceDoc("awaiting_confirmation"), createTime: COMMIT,
    }),
    receivableOverdueNotification({
      workspaceId: WS, receivableId: "rcv-1", dueDate: "2026-03-06",
      today: "2026-03-10", createdAtMs: COMMIT.toMillis(),
    }),
  ];
  const ids = new Set<string>();
  for (const input of produced) {
    assert.ok(input);
    const document = buildNotificationDocument(input);
    assert.equal(document.workspaceId, WS);
    assert.equal(document.createdAt, new Date(COMMIT.toMillis()).toISOString());
    assert.ok(document.expiresAt instanceof Timestamp);
    ids.add(input.id);
  }
  assert.equal(ids.size, produced.length);
});

// ------------------------------------------------------- executor comum

test("identidade inválida no produtor vira contrato violado: registrada " +
  "e sem relançar (o gatilho não reentrega uma mensagem envenenada)",
async () => {
  const errors: Array<{event: string; fields: Record<string, unknown>}> = [];
  const log: OperationLogger = {
    context: {},
    with: () => log,
    info: () => undefined,
    warn: () => undefined,
    error: (event, _error, fields = {}) => {
      errors.push({event, fields});
    },
  };
  const outcome = await publishProduced(() => {
    notificationIdFor({
      workspaceId: "ws:invalido", domain: "loan", entityId: "loan-1",
      eventType: "loan_overdue", episode: "2026-03-06",
    });
    return null;
  }, log);
  assert.equal(outcome, null);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].event, "notification_contract_violation");
  assert.equal(errors[0].fields.reason, "invalid_identity");
});

test("erro que não é de contrato sobe (o gatilho reentrega)", async () => {
  const log: OperationLogger = {
    context: {}, with: () => log, info: () => undefined,
    warn: () => undefined, error: () => undefined,
  };
  await assert.rejects(publishProduced(() => {
    throw new Error("falha passageira");
  }, log), /falha passageira/);
});
