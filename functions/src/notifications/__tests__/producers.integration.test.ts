import assert from "node:assert/strict";
import {readdirSync, readFileSync, statSync} from "node:fs";
import path from "node:path";
import test, {after, mock} from "node:test";

// Módulo cru (sem a namespace de getters do `import * as`), para o mock
// substituir `write` onde o logger estruturado o procura.
import functionsLogger = require("firebase-functions/logger");

import {Timestamp} from "firebase-admin/firestore";

import {
  archiveAccount,
  assertLedgerConsistent,
  balanceOf,
  createAccountPayload,
  newAccount,
  accountRef,
  statusPayload,
  transfer,
  transferPayload,
} from "../../accounts/testSupport/accountTestSupport";
import {createCashTransaction} from "../../cash/callables";
import {runCreditCardInvoiceClosing} from "../../cards/closing";
import {invoiceIdFor} from "../../cards/model";
import {executeRefundCreditCardPurchase} from "../../cards/purchaseOperations";
import {
  actorOf as cardActorOf,
  buy,
  clockAt,
  createCard,
  pay as payInvoice,
  purchaseVersion,
  requestId as cardRequestId,
  seedCardTenant,
} from "../../cards/testSupport/cardTestSupport";
import {
  executeArchiveGoal,
  executeCreateGoal,
  executeSetGoalStatus,
  executeUpdateGoalManualProgress,
} from "../../goals/operations";
import {executeGetGoalsOverview} from "../../goals/kpi";
import {
  createGoalPayloadSchema,
  setGoalStatusPayloadSchema,
  updateGoalManualProgressPayloadSchema,
  archiveGoalPayloadSchema,
} from "../../goals/contracts";
import {executeCreateSimpleInvestment} from "../../investments/operationsV2";
import {runLoanStatusRefresh} from "../../loans/statusRefresh";
import {
  cancel as cancelLoan,
  cancelPayload as cancelLoanPayload,
  create as createLoan,
  createPayload as loanPayload,
  loanRef,
  metadataPayload as loanMetadataPayload,
  pay as payLoan,
  payPayload as loanPayPayload,
  readLoan,
  reverse as reverseLoan,
  reversePayload as reverseLoanPayload,
  seedLoanTenant,
  shiftDays,
  today,
  updateMetadata as updateLoanMetadata,
  type LoanTenant,
} from "../../loans/testSupport/loanTestSupport";
import {
  PII,
  PII_VALUES,
  cancel as cancelReceivable,
  cancelPayload as cancelReceivablePayload,
  clientPrivateRef,
  clientRef,
  editReceivable,
  newReceivable,
  receivablePayload,
  receivableUpdatePayload,
  receive,
  receivePayload,
  reverse as reverseReceivable,
  reversePayload as reverseReceivablePayload,
  seedClient,
  seedReceivableTenant,
} from "../../receivables/testSupport/receivableTestSupport";
import {
  actorOf as reportActorOf,
  daysAgo,
  preset,
  report,
  seedReportTenant,
} from "../../reports/__tests__/reportSupport";
import {
  cleanupRecurring,
  confirmOccurrence,
  contractRef as recurringContractRef,
  createContract,
  occurrenceRef,
  occurrencesOf,
  runOn,
  seedRecurringTenant,
  transactionsOf as recurringTransactionsOf,
  type RecurringTenant,
} from "../../recurring/testSupport/recurringTestSupport";
import {executeCreateSettingsCatalogItem} from
  "../../settingsCatalog/operations";
import {
  defaultCategoryIdFor,
  seedDefaultCategories,
} from "../../settingsCatalog/testSupport/categorySeeds";
import {
  defaultAccountOf,
} from "../../shared/testSupport/kernelTestSupport";
import type {WorkspaceActor} from "../../shared/workspaceAuth";
import {
  billPayload,
  createBill,
  seedGroupWithMembers,
  seedSplitTenant,
  settleShare,
  shareIdOf,
  transactionsOf as splitTransactionsOf,
} from "../../splitBills/testSupport/splitTestSupport";
import {
  call,
  db,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import type {NotificationEventType} from "../contract";
import {notificationIdFor} from "../ids";
import {
  LOAN_NOTIFICATION_OPERATION,
  handleLoanNotificationWrite,
} from "../producers/loans";
import {
  RECEIVABLE_OVERDUE_OPERATION,
  processReceivableOverdueNotifications,
  runReceivableOverdueNotifications,
} from "../producers/receivables";
import {
  APPROVED_RETENTION_MS,
  DAY_MS,
  assertDomainUntouched,
  assertOnlyContractFields,
  assertRetention,
  br,
  capture,
  deliverCashAccountWrite,
  deliverGoalWrite,
  deliverLoanWrite,
  deliverOccurrenceCreated,
  domainSnapshot,
  notificationRef,
  notificationsOf,
  notificationsOfType,
  overdueDeliveryRef,
  overdueQueueRef,
  saoPauloDay,
  sleep,
  workspacePath,
  writeAndDeliver,
  type Doc,
  type DocSnapshot,
} from "../testSupport/notificationTestSupport";

/**
 * P5-D2 (PR-NOTIF-01) — produtores de notificações financeiras, no Emulator.
 *
 * Cada documento de domínio vem de uma operação REAL do domínio (callables e
 * `execute*` com Admin SDK, rotinas `runLoanStatusRefresh`,
 * `runReceivableOverdueNotifications`, `runCreditCardInvoiceClosing`,
 * `runRecurringGeneration`). Os gatilhos recebem, pelo corpo real exportado,
 * o snapshot lido imediatamente antes e depois da operação (`exists`,
 * `data()`, `updateTime`, `createTime`), exatamente como o Eventarc entrega.
 * Os textos esperados são escritos à mão: nenhum usa as funções de texto do
 * produtor.
 *
 * LIMITES DO EMULATOR. O Emulator não executa a política de TTL: a remoção
 * física é simulada apagando o documento pelo Admin SDK. Ele também não
 * reentrega eventos: a reentrega é simulada chamando o gatilho de novo com o
 * mesmo par antes/depois. Os gatilhos de produção (`on*`) só rodam sob o
 * Eventarc; aqui se exercita o corpo exportado, não o transporte.
 */

db();

const recurringTenants: RecurringTenant[] = [];
after(() => cleanupRecurring(recurringTenants));

// ------------------------------------------------------------- utilidades

const ID_PATTERN = {
  loan: /^ln_[0-9a-f]{32}$/,
  receivable: /^rc_[0-9a-f]{32}$/,
  cash_account: /^ca_[0-9a-f]{32}$/,
  goal: /^gl_[0-9a-f]{32}$/,
  recurring: /^ro_[0-9a-f]{32}$/,
};

interface NoticeSpec {
  eventType: NotificationEventType;
  workspaceId: string;
  id?: RegExp;
  title: string;
  message: string | RegExp;
  type: string;
  link: string;
  actionLabel: string;
  source: string;
  domain: string;
  entity: Record<string, string>;
  /** Instante do commit do domínio: `createdAt` deve ser exatamente ele. */
  commitMs?: number;
}

/** Confere campo a campo o aviso gravado contra o esperado escrito à mão. */
const expectNotice = (item: Doc, spec: NoticeSpec) => {
  assertOnlyContractFields(item, spec.eventType);
  assertRetention(item);
  assert.equal(item.workspaceId, spec.workspaceId);
  if (spec.id) assert.match(String(item.id), spec.id);
  assert.equal(item.domainEventType, spec.eventType);
  assert.equal(item.title, spec.title);
  if (typeof spec.message === "string") {
    assert.equal(item.message, spec.message);
  } else {
    assert.match(String(item.message), spec.message);
  }
  assert.equal(item.type, spec.type);
  assert.equal(item.link, spec.link);
  assert.equal(item.actionLabel, spec.actionLabel);
  assert.equal(item.source, spec.source);
  assert.equal(item.domain, spec.domain);
  for (const [key, value] of Object.entries(spec.entity)) {
    assert.equal(item[key], value, `entidade ${key}`);
  }
  if (spec.commitMs !== undefined) {
    assert.equal(item.createdAt, new Date(spec.commitMs).toISOString(),
      "createdAt é o instante do commit do domínio");
  }
};

const assertNoWords = (item: Doc, words: string[]) => {
  // Todos os campos entram na busca; instantes viram texto ISO, porque os
  // segundos e nanossegundos de um Timestamp não são dado do aviso e podem
  // conter qualquer sequência de dígitos (ex.: 510000000 ns contém
  // "1000000").
  const text = JSON.stringify(Object.fromEntries(Object.entries(item)
    .map(([key, value]) => [key, value instanceof Timestamp ?
      value.toDate().toISOString() : value])));
  for (const word of words) {
    assert.ok(!text.includes(word), `dado indevido no aviso: ${word}`);
  }
};

const commitMsOf = (snapshot: DocSnapshot): number => {
  assert.ok(snapshot.updateTime, "documento sem updateTime");
  return snapshot.updateTime.toMillis();
};

/** Snapshot de um documento que não existe (o "antes" de uma criação). */
const absent = (workspaceId: string, collection: string) =>
  capture(db().doc(`${workspacePath(workspaceId)}/${collection}/` +
    `${uniqueId("ausente")}`));

const only = async (
  workspaceId: string,
  eventType: NotificationEventType,
): Promise<Doc> => {
  const items = await notificationsOfType(workspaceId, eventType);
  assert.equal(items.length, 1, `um único aviso ${eventType}`);
  return items[0];
};

// ============================================================== CARTÕES

/** Cartão com fechamento dia 10 e vencimento dia 20; compra de 02/01/2014. */
const cardWithInvoice = async (prefix: string, name: string) => {
  const t = await seedCardTenant("PF", prefix);
  const cardId = await createCard(t, {closingDay: 10, dueDay: 20, name});
  await buy(t, cardId, "2014-01-02", {totalCents: 25_000});
  return {t, cardId, invoiceId: invoiceIdFor(cardId, "2014-01")};
};

test("§16.1 fatura fechada gera exatamente um aviso", async () => {
  const {t, cardId, invoiceId} = await cardWithInvoice("p16c1",
    "Cartão Fechamento");
  const summary = await runCreditCardInvoiceClosing({today: "2014-01-12"});
  assert.equal(summary.failed, 0);
  const items = await notificationsOf(t.workspaceId);
  assert.equal(items.length, 1, "exatamente um aviso para a fatura fechada");
  expectNotice(items[0], {
    eventType: "invoice_closed",
    workspaceId: t.workspaceId,
    id: /^ccclosed_[0-9a-f]{32}$/,
    title: "Fatura fechada",
    message: new RegExp("^A fatura de 01/2014 do cartão Cartão Fechamento " +
      "fechou em R\\$\\s250,00, com vencimento em 20/01/2014\\.$"),
    type: "credit_card",
    link: "cards",
    actionLabel: "Ver cartões",
    source: "credit_card_invoice",
    domain: "credit_card",
    entity: {cardId, invoiceId},
  });
});

test("§16.2 repetir o fechamento não duplica nem altera o aviso", async () => {
  const {t} = await cardWithInvoice("p16c2", "Cartão Repetição");
  await runCreditCardInvoiceClosing({today: "2014-01-12"});
  const first = await notificationsOf(t.workspaceId);
  assert.equal(first.length, 1);
  await sleep(25);
  await runCreditCardInvoiceClosing({today: "2014-01-12"});
  await runCreditCardInvoiceClosing({today: "2014-01-13"});
  const second = await notificationsOf(t.workspaceId);
  assert.deepEqual(second, first, "mesmo documento, createdAt e expiresAt");
});

test("§16.3 aviso de vencimento já existente não duplica", async () => {
  const {t} = await cardWithInvoice("p16c3", "Cartão Vencimento");
  await runCreditCardInvoiceClosing({today: "2014-01-18"});
  const dueSoon = await only(t.workspaceId, "invoice_due_soon");
  expectNotice(dueSoon, {
    eventType: "invoice_due_soon",
    workspaceId: t.workspaceId,
    id: /^ccdue_[0-9a-f]{32}$/,
    title: "Fatura próxima do vencimento",
    message: new RegExp("^A fatura de 01/2014 do cartão Cartão Vencimento " +
      "vence em 20/01/2014, com saldo de R\\$\\s250,00\\.$"),
    type: "warning",
    link: "cards",
    actionLabel: "Ver cartões",
    source: "credit_card_invoice",
    domain: "credit_card",
    entity: {},
  });
  await sleep(25);
  await runCreditCardInvoiceClosing({today: "2014-01-18"});
  await runCreditCardInvoiceClosing({today: "2014-01-19"});
  const after = await notificationsOfType(t.workspaceId, "invoice_due_soon");
  assert.equal(after.length, 1);
  assert.deepEqual(after[0], dueSoon, "intacto, inclusive createdAt/expiresAt");
});

test("§16.4 fatura paga deixa de satisfazer a condição de novo aviso de " +
  "atraso; fatura com saldo ainda avisa", async () => {
  const paid = await cardWithInvoice("p16c4a", "Cartão Pago");
  const partial = await cardWithInvoice("p16c4b", "Cartão Parcial");
  await runCreditCardInvoiceClosing({today: "2014-01-12"});
  await payInvoice(paid.t, paid.cardId, "2014-01", "2014-01-15", 25_000);
  await payInvoice(partial.t, partial.cardId, "2014-01", "2014-01-15", 10_000);
  await runCreditCardInvoiceClosing({today: "2014-01-22"});
  assert.deepEqual(await notificationsOfType(paid.t.workspaceId,
    "invoice_overdue"), [], "paga integralmente: sem aviso de atraso");
  const overdue = await only(partial.t.workspaceId, "invoice_overdue");
  expectNotice(overdue, {
    eventType: "invoice_overdue",
    workspaceId: partial.t.workspaceId,
    id: /^ccoverdue_[0-9a-f]{32}$/,
    title: "Fatura vencida",
    message: new RegExp("^A fatura de 01/2014 do cartão Cartão Parcial " +
      "venceu em 20/01/2014, com saldo de R\\$\\s150,00\\.$"),
    type: "error",
    link: "cards",
    actionLabel: "Ver cartões",
    source: "credit_card_invoice",
    domain: "credit_card",
    entity: {},
  });
});

test("§16.1b fechamento com crédito transportado: o aviso traz o total " +
  "gravado na fatura fechada, não o total antes do transporte", async () => {
  const t = await seedCardTenant("PF", "p16c1b");
  const cardId = await createCard(t, {closingDay: 10, dueDay: 20,
    name: "Cartão Crédito"});
  const bought = await buy(t, cardId, "2013-01-05", {totalCents: 10_000});
  await executeRefundCreditCardPurchase(cardActorOf(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    purchaseId: bought.purchaseId,
    expectedUpdatedAt: await purchaseVersion(t.workspaceId, bought.purchaseId),
  }, cardRequestId(), clockAt("2013-01-12"));
  await runCreditCardInvoiceClosing({today: "2013-01-12"});
  await payInvoice(t, cardId, "2013-01", "2013-01-15", 10_000);
  await runCreditCardInvoiceClosing({today: "2013-02-11"});

  const february = (await db().doc(`${workspacePath(t.workspaceId)}/` +
    `credit_card_invoices/${invoiceIdFor(cardId, "2013-02")}`).get()).data();
  assert.ok(february);
  assert.equal(february.totalCents, 0, "total gravado depois do transporte");
  assert.equal(february.carryoverOutCents, 10_000);
  const closed = (await notificationsOfType(t.workspaceId, "invoice_closed"))
    .sort((a, b) => String(a.message).localeCompare(String(b.message)));
  assert.equal(closed.length, 2, "uma fatura fechada, um aviso");
  assert.match(String(closed[0].message), new RegExp(
    "^A fatura de 01/2013 do cartão Cartão Crédito fechou em R\\$\\s100,00, " +
    "com vencimento em 20/01/2013\\.$"));
  assert.match(String(closed[1].message), new RegExp(
    "^A fatura de 02/2013 do cartão Cartão Crédito fechou em R\\$\\s0,00, " +
    "com vencimento em 20/02/2013\\.$"),
  "o total é o gravado na fatura fechada (zero), sem o crédito de −R$ 100");
  assert.ok(!/-/.test(String(closed[1].message)), "sem valor negativo");
});

// ============================================================ EMPRÉSTIMOS

const LOAN_PII = ["Banco Exemplo S.A.", "contato@banco.example",
  "Capital de giro", "personName", "personContact", "description",
  "principalCents", "balanceCents"];

const loanNotice = (
  workspaceId: string,
  loanId: string,
  kind: "borrow" | "lend",
  dueDay: string,
  commitMs: number,
): NoticeSpec => ({
  eventType: "loan_overdue",
  workspaceId,
  id: ID_PATTERN.loan,
  title: kind === "borrow" ? "Empréstimo a pagar em atraso" :
    "Empréstimo a receber em atraso",
  message: "Foi identificado atraso em " +
    `${br(saoPauloDay(new Date(commitMs)))} em um empréstimo ` +
    `${kind === "borrow" ? "a pagar" : "a receber"}: a parcela com ` +
    `vencimento em ${br(dueDay)} não estava quitada.`,
  type: "warning",
  link: "loans",
  actionLabel: "Ver empréstimos",
  source: "loan",
  domain: "loan",
  entity: {loanId},
  commitMs,
});

/** Empréstimo em dia (1ª parcela vence hoje) que a rotina real atrasa. */
const loanTurnedOverdueByRoutine = async (
  t: LoanTenant,
  kind: "borrow" | "lend",
) => {
  const created = await createLoan(t.owner, loanPayload(t.workspaceId, {
    type: kind, firstDueDate: today(),
  }));
  const ref = loanRef(t.workspaceId, created.loanId);
  assert.equal((await readLoan(t.workspaceId, created.loanId)).status,
    "active");
  const delivered = await writeAndDeliver(ref,
    () => runLoanStatusRefresh({today: shiftDays(today(), 1)}),
    (before, after) => deliverLoanWrite(t.workspaceId, created.loanId,
      before, after));
  return {loanId: created.loanId, ref, ...delivered};
};

test("§16.5 empréstimo a pagar vencido, atrasado pela rotina real " +
  "runLoanStatusRefresh, gera um evento apropriado (texto exato, link " +
  "loans, sem pessoa nem valores)", async () => {
  const t = await seedLoanTenant("PF", "p16l5");
  const {loanId, before, after} = await loanTurnedOverdueByRoutine(t,
    "borrow");
  assert.equal(before.get("status"), "active");
  assert.equal(after.get("status"), "overdue");
  assert.equal(after.get("updatedBy"), "system:loan-status");
  const item = await only(t.workspaceId, "loan_overdue");
  expectNotice(item, loanNotice(t.workspaceId, loanId, "borrow", today(),
    commitMsOf(after)));
  assertNoWords(item, LOAN_PII);
  // O documento de domínio tem os dados pessoais; o aviso, não.
  assert.equal(after.get("personName"), "Banco Exemplo S.A.");
});

test("§16.5 reentrega do mesmo antes/depois: já existe, createdAt e " +
  "expiresAt idênticos; retry tardio com outro instante cai no mesmo ID",
async () => {
  const t = await seedLoanTenant("PF", "p16l5r");
  const {loanId, before, after} = await loanTurnedOverdueByRoutine(t,
    "borrow");
  const original = await only(t.workspaceId, "loan_overdue");
  await sleep(25);
  await deliverLoanWrite(t.workspaceId, loanId, before, after);
  await deliverLoanWrite(t.workspaceId, loanId, before, after);
  assert.deepEqual(await notificationsOf(t.workspaceId), [original]);
  // Retry muito depois (instante de commit posterior): mesmo episódio
  // (`overdueFrom`), mesmo ID; o documento original permanece.
  await handleLoanNotificationWrite({
    workspaceId: t.workspaceId,
    loanId,
    before: before.data(),
    after: after.data(),
    commitTime: Timestamp.fromMillis(commitMsOf(after) + 5 * DAY_MS),
  });
  assert.deepEqual(await notificationsOf(t.workspaceId), [original],
    "o retry não prorroga createdAt nem expiresAt");
});

test("§16.7 empréstimo concedido (lend) não é classificado como dívida " +
  "tomada", async () => {
  const t = await seedLoanTenant("PF", "p16l7");
  const {loanId, after} = await loanTurnedOverdueByRoutine(t, "lend");
  const item = await only(t.workspaceId, "loan_overdue");
  expectNotice(item, loanNotice(t.workspaceId, loanId, "lend", today(),
    commitMsOf(after)));
  assert.ok(!/a pagar/.test(String(item.title) + String(item.message)));
  assertNoWords(item, LOAN_PII);
});

test("§16.5 empréstimo criado já em atraso gera um aviso", async () => {
  const t = await seedLoanTenant("PF", "p16l5c");
  const firstDue = shiftDays(today(), -10);
  const loanId = (await createLoan(t.owner, loanPayload(t.workspaceId, {
    startDate: shiftDays(today(), -40), firstDueDate: firstDue,
  }))).loanId;
  const after = await capture(loanRef(t.workspaceId, loanId));
  assert.equal(after.get("status"), "overdue");
  await deliverLoanWrite(t.workspaceId, loanId,
    await absent(t.workspaceId, "loans"), after);
  const item = await only(t.workspaceId, "loan_overdue");
  expectNotice(item, loanNotice(t.workspaceId, loanId, "borrow", firstDue,
    commitMsOf(after)));
});

test("§16.6 empréstimo liquidado não gera aviso indevido (quitar, " +
  "cancelar e documento fora do schema)", async () => {
  const t = await seedLoanTenant("PF", "p16l6");
  // Em dia, quitado por inteiro: active → paid.
  const settled = (await createLoan(t.owner, loanPayload(t.workspaceId)))
    .loanId;
  await writeAndDeliver(loanRef(t.workspaceId, settled),
    async () => {
      await payLoan(t.owner, await loanPayPayload(t.workspaceId, settled, {
        principalCents: 300_000, interestCents: 0}));
    },
    (before, after) => deliverLoanWrite(t.workspaceId, settled, before, after));
  assert.equal((await readLoan(t.workspaceId, settled)).status, "paid");

  // Já em atraso (1 aviso, do fato), depois quitado: overdue → paid.
  const firstDue = shiftDays(today(), -10);
  const late = (await createLoan(t.owner, loanPayload(t.workspaceId, {
    startDate: shiftDays(today(), -40), firstDueDate: firstDue,
  }))).loanId;
  await deliverLoanWrite(t.workspaceId, late,
    await absent(t.workspaceId, "loans"),
    await capture(loanRef(t.workspaceId, late)));
  assert.equal((await notificationsOf(t.workspaceId)).length, 1);
  await writeAndDeliver(loanRef(t.workspaceId, late),
    async () => {
      await payLoan(t.owner, await loanPayPayload(t.workspaceId, late, {
        principalCents: 300_000, interestCents: 0}));
    },
    (before, after) => deliverLoanWrite(t.workspaceId, late, before, after));
  assert.equal((await readLoan(t.workspaceId, late)).status, "paid");
  assert.equal((await notificationsOf(t.workspaceId)).length, 1,
    "liquidar não gera novo aviso");

  // Cancelado: nada.
  const toCancel = (await createLoan(t.owner, loanPayload(t.workspaceId, {
    startDate: shiftDays(today(), -40), firstDueDate: firstDue,
  }))).loanId;
  await writeAndDeliver(loanRef(t.workspaceId, toCancel),
    async () => {
      await cancelLoan(t.owner, await cancelLoanPayload(t.workspaceId,
        toCancel));
    },
    (before, after) => deliverLoanWrite(t.workspaceId, toCancel, before,
      after));
  assert.equal((await readLoan(t.workspaceId, toCancel)).status, "cancelled");
  assert.equal((await notificationsOf(t.workspaceId)).length, 1);

  // Documento fora do schema autoritativo: nada, e o gatilho não explode.
  const broken = (await createLoan(t.owner, loanPayload(t.workspaceId, {
    startDate: shiftDays(today(), -40), firstDueDate: firstDue,
  }))).loanId;
  await loanRef(t.workspaceId, broken).update({schemaVersion: 999});
  await deliverLoanWrite(t.workspaceId, broken,
    await absent(t.workspaceId, "loans"),
    await capture(loanRef(t.workspaceId, broken)));
  assert.equal((await notificationsOf(t.workspaceId)).length, 1);
});

test("§16.6 pagamento que mantém o atraso mas muda overdueFrom (parcela 1 " +
  "quitada, parcela 2 também vencida) não gera novo aviso", async () => {
  const t = await seedLoanTenant("PF", "p16l6b");
  const loanId = (await createLoan(t.owner, loanPayload(t.workspaceId, {
    startDate: shiftDays(today(), -70), firstDueDate: shiftDays(today(), -40),
  }))).loanId;
  const created = await capture(loanRef(t.workspaceId, loanId));
  assert.equal(created.get("status"), "overdue");
  await deliverLoanWrite(t.workspaceId, loanId,
    await absent(t.workspaceId, "loans"), created);
  assert.equal((await notificationsOf(t.workspaceId)).length, 1);

  const {before, after} = await writeAndDeliver(
    loanRef(t.workspaceId, loanId),
    async () => {
      await payLoan(t.owner, await loanPayPayload(t.workspaceId, loanId, {
        principalCents: 100_000, interestCents: 0}));
    },
    (b, a) => deliverLoanWrite(t.workspaceId, loanId, b, a));
  assert.equal(before.get("status"), "overdue");
  assert.equal(after.get("status"), "overdue", "continua em atraso");
  assert.notEqual(after.get("overdueFrom"), before.get("overdueFrom"),
    "o episódio mudou (parcela 2)");
  assert.equal((await notificationsOf(t.workspaceId)).length, 1,
    "antes já era overdue: nenhum aviso novo");
});

test("§16.6 pagamento que quita o atraso e estorno que volta a overdue " +
  "com o mesmo overdueFrom continuam sendo um único aviso (mesmo ID)",
async () => {
  const t = await seedLoanTenant("PF", "p16l6c");
  const loanId = (await createLoan(t.owner, loanPayload(t.workspaceId, {
    startDate: shiftDays(today(), -40), firstDueDate: shiftDays(today(), -10),
  }))).loanId;
  const created = await capture(loanRef(t.workspaceId, loanId));
  await deliverLoanWrite(t.workspaceId, loanId,
    await absent(t.workspaceId, "loans"), created);
  const original = await only(t.workspaceId, "loan_overdue");

  let movementId = "";
  const cured = await writeAndDeliver(loanRef(t.workspaceId, loanId),
    async () => {
      movementId = String((await payLoan(t.owner,
        await loanPayPayload(t.workspaceId, loanId, {
          principalCents: 100_000, interestCents: 0}))).movementId);
    },
    (b, a) => deliverLoanWrite(t.workspaceId, loanId, b, a));
  assert.equal(cured.after.get("status"), "active", "atraso quitado");
  assert.deepEqual(await notificationsOf(t.workspaceId), [original]);

  const back = await writeAndDeliver(loanRef(t.workspaceId, loanId),
    async () => {
      await reverseLoan(t.owner, await reverseLoanPayload(t.workspaceId,
        loanId, movementId));
    },
    (b, a) => deliverLoanWrite(t.workspaceId, loanId, b, a));
  assert.equal(back.after.get("status"), "overdue", "voltou a overdue");
  assert.equal(back.after.get("overdueFrom"), created.get("overdueFrom"),
    "mesmo overdueFrom");
  assert.deepEqual(await notificationsOf(t.workspaceId), [original],
    "mesmo ID: continua 1 aviso, createdAt/expiresAt do primeiro");
});

// ============================================================ RECEBÍVEIS

const RECEIVABLE_PII = [PII.name, "Consultoria de outubro", ...PII_VALUES,
  "clientId", "description", "amountCents", "balanceCents"];

const receivableNotice = (
  workspaceId: string,
  receivableId: string,
  dueDate: string,
  detectedOn: string,
): NoticeSpec => ({
  eventType: "receivable_overdue",
  workspaceId,
  id: ID_PATTERN.receivable,
  title: "Recebível vencido",
  message: `Foi identificado atraso em ${br(detectedOn)} em um recebível ` +
    `com vencimento em ${br(dueDate)}, que tinha saldo a receber.`,
  type: "warning",
  link: "clients_receivables",
  actionLabel: "Ver recebíveis",
  source: "receivable",
  domain: "receivable",
  entity: {receivableId},
});

const newOpenReceivable = async (
  t: LoanTenant,
  clientId: string,
  dueDate: string,
  amountCents = 100_000,
) => String((await newReceivable(t.owner, receivablePayload(t.workspaceId,
  clientId, {dueDate, amountCents}))).receivableId);

const ofReceivable = (items: Doc[], receivableId: string) =>
  items.filter((item) => item.receivableId === receivableId);

test("§16.8 recebível vencido (dueDate = hoje − 1, em aberto) gera um " +
  "aviso, sem cliente nem documento, sem depender de client_private",
async () => {
  const t = await seedReceivableTenant("p16r8");
  const clientId = await seedClient(t);
  const dueDate = shiftDays(today(), -1);
  const receivableId = await newOpenReceivable(t, clientId, dueDate);
  // O aviso não lê o cadastro do cliente: sem ele, o resultado é o mesmo.
  await clientPrivateRef(t.workspaceId, clientId).delete();
  await clientRef(t.workspaceId, clientId).delete();
  const nowMs = Date.now();
  const summary = await runReceivableOverdueNotifications({
    today: today(), nowMs});
  assert.equal(summary.failed, 0);
  const items = await notificationsOf(t.workspaceId);
  assert.equal(items.length, 1);
  expectNotice(items[0], {
    ...receivableNotice(t.workspaceId, receivableId, dueDate, today()),
    commitMs: nowMs,
  });
  assertNoWords(items[0], RECEIVABLE_PII);
});

test("§16.8 sem limite de dias (P5-D2.1, substitui a janela de sete dias " +
  "da P5-D2): hoje−1, hoje−7, hoje−8 e hoje−30 avisam; hoje e futuro não; " +
  "parcialmente recebido (ainda aberto) avisa", async () => {
  const t = await seedReceivableTenant("p16r8w");
  const clientId = await seedClient(t);
  const ids = {
    yesterday: await newOpenReceivable(t, clientId, shiftDays(today(), -1)),
    sevenDays: await newOpenReceivable(t, clientId, shiftDays(today(), -7)),
    eightDays: await newOpenReceivable(t, clientId, shiftDays(today(), -8)),
    thirtyDays: await newOpenReceivable(t, clientId, shiftDays(today(), -30)),
    dueToday: await newOpenReceivable(t, clientId, today()),
    future: await newOpenReceivable(t, clientId, shiftDays(today(), 5)),
    partial: await newOpenReceivable(t, clientId, shiftDays(today(), -3)),
  };
  const partial = await receive(t.owner, await receivePayload(t.workspaceId,
    ids.partial, {principalCents: 40_000}));
  assert.equal(partial.status, "open");
  assert.equal(partial.balanceCents, 60_000);
  await runReceivableOverdueNotifications({today: today()});
  const items = await notificationsOf(t.workspaceId);
  const notified = new Set(items.map((item) => item.receivableId));
  assert.deepEqual(notified, new Set([ids.yesterday, ids.sevenDays,
    ids.eightDays, ids.thirtyDays, ids.partial]));
  assert.equal(items.length, 5, "um aviso por recebível");
  for (const item of items) {
    assert.equal(item.domainEventType, "receivable_overdue");
    assertNoWords(item, RECEIVABLE_PII);
  }
});

test("§16.8 reexecução no dia seguinte: o trabalho já saiu da fila e a " +
  "confirmação existe; createdAt e expiresAt inalterados mesmo com outro " +
  "instante", async () => {
  const t = await seedReceivableTenant("p16r8r");
  const clientId = await seedClient(t);
  const receivableId = await newOpenReceivable(t, clientId,
    shiftDays(today(), -2));
  assert.equal((await overdueQueueRef(t.workspaceId, receivableId).get())
    .exists, true, "a criação enfileira o trabalho na mesma transação");
  const firstMs = Date.now();
  await runReceivableOverdueNotifications({today: today(), nowMs: firstMs});
  const original = await notificationsOf(t.workspaceId);
  assert.equal(original.length, 1);
  assert.equal((await overdueQueueRef(t.workspaceId, receivableId).get())
    .exists, false, "publicado, o trabalho sai da fila");
  assert.equal((await overdueDeliveryRef(t.workspaceId,
    String(original[0].id)).get()).exists, true, "confirmação gravada");
  await runReceivableOverdueNotifications({
    today: shiftDays(today(), 1), nowMs: firstMs + DAY_MS + 5_000});
  assert.deepEqual(await notificationsOf(t.workspaceId), original);
});

test("§16.9 recebível recebido não gera aviso de atraso", async () => {
  const t = await seedReceivableTenant("p16r9");
  const clientId = await seedClient(t);
  const id = await newOpenReceivable(t, clientId, shiftDays(today(), -2));
  const paid = await receive(t.owner, await receivePayload(t.workspaceId, id, {
    principalCents: 100_000}));
  assert.equal(paid.status, "received");
  await runReceivableOverdueNotifications({today: today()});
  assert.deepEqual(await notificationsOf(t.workspaceId), []);
});

test("§16.10 recebível cancelado não gera aviso", async () => {
  const t = await seedReceivableTenant("p16r10");
  const clientId = await seedClient(t);
  const id = await newOpenReceivable(t, clientId, shiftDays(today(), -2));
  const cancelled = await cancelReceivable(t.owner,
    await cancelReceivablePayload(t.workspaceId, id));
  assert.equal(cancelled.status, "cancelled");
  await runReceivableOverdueNotifications({today: today()});
  assert.deepEqual(await notificationsOf(t.workspaceId), []);
});

test("§16.12 recebível: vencimento editado para outra data passada " +
  "abre um novo episódio (segundo aviso, outro ID)", async () => {
  const t = await seedReceivableTenant("p16r12");
  const clientId = await seedClient(t);
  const first = shiftDays(today(), -3);
  const second = shiftDays(today(), -5);
  const id = await newOpenReceivable(t, clientId, first);
  await runReceivableOverdueNotifications({today: today()});
  assert.equal(ofReceivable(await notificationsOf(t.workspaceId), id).length,
    1);
  await editReceivable(t.owner, await receivableUpdatePayload(t.workspaceId,
    id, {dueDate: second}));
  await runReceivableOverdueNotifications({today: today()});
  const items = ofReceivable(await notificationsOf(t.workspaceId), id);
  assert.equal(items.length, 2);
  assert.notEqual(items[0].id, items[1].id);
  const dueLabels = items.map((item) => String(item.message)
    .match(/vencimento em (\d{2}\/\d{2}\/\d{4})/)?.[1]).sort();
  assert.deepEqual(dueLabels, [br(first), br(second)].sort());
  // Repetir não cria um terceiro.
  await runReceivableOverdueNotifications({today: today()});
  assert.equal(ofReceivable(await notificationsOf(t.workspaceId), id).length,
    2);
});

// ================================================================= CONTAS

const expenseOf = (
  t: LoanTenant,
  accountId: string,
  amountCents: number,
  type: "receita" | "despesa" = "despesa",
  overrides: Record<string, unknown> = {},
) => call(createCashTransaction, t.owner, {
  workspaceId: t.workspaceId,
  idempotencyKey: idempotencyKey(),
  cashAccountId: accountId,
  type,
  description: type === "despesa" ? "Mercado reservado" : "Salário reservado",
  categoryId: defaultCategoryIdFor(type),
  amountCents,
  date: today(),
  ...overrides,
});

const seededAccount = async (prefix: string) => {
  const t = await seedLoanTenant("PF", prefix);
  await seedDefaultCategories(t.workspaceId);
  const {accountId} = await newAccount(t.owner, createAccountPayload(
    t.workspaceId, {name: "Conta Reservada Alfa"}));
  return {t, accountId, ref: accountRef(t.workspaceId, accountId)};
};

const moveAndDeliver = (
  t: LoanTenant,
  accountId: string,
  operation: () => Promise<unknown>,
) => writeAndDeliver(accountRef(t.workspaceId, accountId), operation,
  (before, after) => deliverCashAccountWrite(t.workspaceId, accountId, before,
    after));

const negativeNotice = (
  workspaceId: string,
  accountId: string,
  commitMs: number,
): NoticeSpec => ({
  eventType: "cash_account_negative_balance",
  workspaceId,
  id: ID_PATTERN.cash_account,
  title: "Saldo negativo em conta",
  message: "Uma conta ficou com saldo negativo em " +
    `${br(saoPauloDay(new Date(commitMs)))}. Confira em Configurações, ` +
    "em Contas e carteiras.",
  type: "warning",
  link: "settings",
  actionLabel: "Abrir configurações",
  source: "cash_account",
  domain: "cash_account",
  entity: {accountId},
  commitMs,
});

test("§16.11 saldo negativo é calculado da conta oficial: 0 → negativo por " +
  "operação real de caixa gera um aviso, sem nome nem saldo", async () => {
  const {t, accountId} = await seededAccount("p16a11");
  const delivered = await moveAndDeliver(t, accountId, () =>
    expenseOf(t, accountId, 10_000));
  assert.equal(delivered.before.get("balanceCents"), 0);
  assert.equal(delivered.after.get("balanceCents"), -10_000,
    "saldo oficial da conta");
  await assertLedgerConsistent(t.workspaceId);
  const item = await only(t.workspaceId, "cash_account_negative_balance");
  expectNotice(item, negativeNotice(t.workspaceId, accountId,
    commitMsOf(delivered.after)));
  assertNoWords(item, ["Conta Reservada Alfa", "balanceCents", "-10000",
    "Mercado reservado"]);
});

test("§16.11 lançamento pendente não move a conta oficial e não gera " +
  "aviso", async () => {
  const {t, accountId} = await seededAccount("p16a11p");
  const delivered = await moveAndDeliver(t, accountId, () =>
    expenseOf(t, accountId, 99_000, "despesa", {
      status: "pending", date: undefined, dueDate: shiftDays(today(), 10)}));
  assert.equal(await balanceOf(t.workspaceId, accountId), 0);
  assert.equal(delivered.after.get("balanceCents"), 0);
  assert.deepEqual(await notificationsOf(t.workspaceId), []);
});

test("§16.12 episódios sucessivos são diferenciados sem spam: já negativo → " +
  "mais negativo não avisa; negativo → positivo → negativo avisa de novo",
async () => {
  const {t, accountId} = await seededAccount("p16a12");
  const first = await moveAndDeliver(t, accountId, () =>
    expenseOf(t, accountId, 10_000));
  assert.equal((await notificationsOf(t.workspaceId)).length, 1);
  await moveAndDeliver(t, accountId, () => expenseOf(t, accountId, 10_000));
  assert.equal(await balanceOf(t.workspaceId, accountId), -20_000);
  assert.equal((await notificationsOf(t.workspaceId)).length, 1,
    "−1 → −2 não é transição");
  await moveAndDeliver(t, accountId, () =>
    expenseOf(t, accountId, 30_000, "receita"));
  assert.equal(await balanceOf(t.workspaceId, accountId), 10_000);
  assert.equal((await notificationsOf(t.workspaceId)).length, 1,
    "voltar ao positivo não avisa");
  const second = await moveAndDeliver(t, accountId, () =>
    expenseOf(t, accountId, 15_000));
  assert.equal(await balanceOf(t.workspaceId, accountId), -5_000);
  const items = await notificationsOfType(t.workspaceId,
    "cash_account_negative_balance");
  assert.equal(items.length, 2, "dois episódios, dois avisos");
  assert.notEqual(items[0].id, items[1].id);
  const byCreated = items.sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt)));
  expectNotice(byCreated[0], negativeNotice(t.workspaceId, accountId,
    commitMsOf(first.after)));
  expectNotice(byCreated[1], negativeNotice(t.workspaceId, accountId,
    commitMsOf(second.after)));
  // Reentrega de um dos episódios não cria um terceiro.
  await deliverCashAccountWrite(t.workspaceId, accountId, second.before,
    second.after);
  assert.equal((await notificationsOf(t.workspaceId)).length, 2);
});

test("§16.12 conta criada com saldo inicial negativo não avisa; " +
  "transferência que negativa só a conta de origem avisa", async () => {
  const t = await seedLoanTenant("PF", "p16a12b");
  const {accountId: negative} = await newAccount(t.owner,
    createAccountPayload(t.workspaceId, {openingBalanceCents: -20_000}));
  const created = await capture(accountRef(t.workspaceId, negative));
  assert.equal(created.get("balanceCents"), -20_000);
  await deliverCashAccountWrite(t.workspaceId, negative,
    await absent(t.workspaceId, "cash_accounts"), created);
  assert.deepEqual(await notificationsOf(t.workspaceId), [],
    "nasceu negativa: não houve transição");

  const {accountId: source} = await newAccount(t.owner, createAccountPayload(
    t.workspaceId, {name: "Origem"}));
  const {accountId: destination} = await newAccount(t.owner,
    createAccountPayload(t.workspaceId, {name: "Destino"}));
  const sourceBefore = await capture(accountRef(t.workspaceId, source));
  const destinationBefore = await capture(accountRef(t.workspaceId,
    destination));
  await transfer(t.owner, transferPayload(t.workspaceId, source, destination,
    {amountCents: 5_000, date: today()}));
  const sourceAfter = await capture(accountRef(t.workspaceId, source));
  const destinationAfter = await capture(accountRef(t.workspaceId,
    destination));
  assert.equal(sourceAfter.get("balanceCents"), -5_000);
  await deliverCashAccountWrite(t.workspaceId, source, sourceBefore,
    sourceAfter);
  await deliverCashAccountWrite(t.workspaceId, destination, destinationBefore,
    destinationAfter);
  const item = await only(t.workspaceId, "cash_account_negative_balance");
  assert.equal(item.accountId, source);
});

// ================================================================== METAS

const GOAL_VISUAL = {color: "#6366f1", icon: "Target",
  progressBarType: "linear"};

const manualGoalDefinition = (overrides: Record<string, unknown> = {}) => ({
  name: "Viagem reservada Beta",
  category: "reserva_emergencia",
  priority: "alta",
  startDate: "2026-01-01",
  deadline: "2026-12-31",
  horizon: "curto",
  progressSource: "manual",
  targetAmountCents: 1_000_000,
  visual: GOAL_VISUAL,
  ...overrides,
});

const goalActorOf = (t: LoanTenant): WorkspaceActor =>
  ({uid: t.owner, workspaceId: t.workspaceId, role: "owner"});

const makeGoal = async (
  t: LoanTenant,
  goal: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<string> => String((await executeCreateGoal(goalActorOf(t),
  createGoalPayloadSchema.parse({
    workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(), goal,
    ...extra,
  }))).goalId);

const goalRefOf = (t: LoanTenant, goalId: string) =>
  db().doc(`${workspacePath(t.workspaceId)}/goals/${goalId}`);

const setGoalStatus = (t: LoanTenant, goalId: string, status: string) =>
  executeSetGoalStatus(goalActorOf(t), setGoalStatusPayloadSchema.parse({
    workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(), goalId,
    status,
  }));

const goalAndDeliver = (
  t: LoanTenant,
  goalId: string,
  operation: () => Promise<unknown>,
) => writeAndDeliver(goalRefOf(t, goalId), operation,
  (before, after) => deliverGoalWrite(t.workspaceId, goalId, before, after));

const goalNotice = (
  workspaceId: string,
  goalId: string,
  commitMs: number,
): NoticeSpec => ({
  eventType: "goal_achieved",
  workspaceId,
  id: ID_PATTERN.goal,
  title: "Meta alcançada",
  message: "Uma meta foi marcada como alcançada em " +
    `${br(saoPauloDay(new Date(commitMs)))}.`,
  type: "success",
  link: "goals",
  actionLabel: "Ver metas",
  source: "goal",
  domain: "goal",
  entity: {goalId},
  commitMs,
});

test("§16.14 meta: em_andamento → alcancada gera um aviso (sem nome nem " +
  "valores); alcancada → alcancada não; alcancada → em_andamento → " +
  "alcancada gera o segundo", async () => {
  const t = await seedLoanTenant("PF", "p16g14");
  const goalId = await makeGoal(t, manualGoalDefinition(),
    {manualProgressCents: 0});
  const first = await goalAndDeliver(t, goalId, () =>
    setGoalStatus(t, goalId, "alcancada"));
  assert.equal(first.before.get("status"), "em_andamento");
  const one = await only(t.workspaceId, "goal_achieved");
  expectNotice(one, goalNotice(t.workspaceId, goalId,
    commitMsOf(first.after)));
  assertNoWords(one, ["Viagem reservada Beta", "targetAmountCents",
    "1000000", "manualProgressCents"]);

  // Reafirmar o mesmo status: escreve, mas não é transição.
  await goalAndDeliver(t, goalId, () => setGoalStatus(t, goalId, "alcancada"));
  assert.equal((await notificationsOf(t.workspaceId)).length, 1);

  await goalAndDeliver(t, goalId, () =>
    setGoalStatus(t, goalId, "em_andamento"));
  assert.equal((await notificationsOf(t.workspaceId)).length, 1);
  const second = await goalAndDeliver(t, goalId, () =>
    setGoalStatus(t, goalId, "alcancada"));
  const items = await notificationsOfType(t.workspaceId, "goal_achieved");
  assert.equal(items.length, 2, "dois episódios");
  assert.notEqual(items[0].id, items[1].id);
  const created = items.map((item) => item.createdAt).sort();
  assert.deepEqual(created, [
    new Date(commitMsOf(first.after)).toISOString(),
    new Date(commitMsOf(second.after)).toISOString(),
  ].sort());
  // Arquivar a meta alcançada não é transição de status.
  await goalAndDeliver(t, goalId, () => executeArchiveGoal(goalActorOf(t),
    archiveGoalPayloadSchema.parse({
      workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(), goalId,
      reason: "Meta encerrada no teste",
    })));
  assert.equal((await notificationsOf(t.workspaceId)).length, 2);
});

test("§16.14 meta criada já alcançada gera um aviso na criação",
  async () => {
    const t = await seedLoanTenant("PF", "p16g14c");
    const goalId = await makeGoal(t, manualGoalDefinition(),
      {manualProgressCents: 1_000_000, status: "alcancada"});
    const after = await capture(goalRefOf(t, goalId));
    await deliverGoalWrite(t.workspaceId, goalId,
      await absent(t.workspaceId, "goals"), after);
    expectNotice(await only(t.workspaceId, "goal_achieved"),
      goalNotice(t.workspaceId, goalId, commitMsOf(after)));
  });

test("§16.14 meta automática (investimento): o recálculo do progresso, " +
  "inclusive ao passar do alvo, não duplica nem cria aviso; meta manual " +
  "com progresso atualizado também não", async () => {
  const t = await seedLoanTenant("PF", "p16g14i");
  const actor = goalActorOf(t);
  let requests = 0;
  const catalog = async (group: string, name: string, subtype?: string) =>
    (await executeCreateSettingsCatalogItem(actor, {
      workspaceId: t.workspaceId,
      idempotencyKey: idempotencyKey(),
      group,
      name,
      ...(subtype ? {transactionSubtype: subtype} : {}),
    } as Parameters<typeof executeCreateSettingsCatalogItem>[1],
    `req-p5d2-cat-${++requests}`)).itemId;
  const institutionId = await catalog("investment_institution", "Banco Z");
  const classId = await catalog("investment_class", "Reserva Z");
  const typeId = await catalog("category", "Renda fixa Z", "investimento");
  const goalId = await makeGoal(t, manualGoalDefinition({
    name: "Reserva investida Gama", progressSource: "investment",
    progressBasis: "net_contributions", targetAmountCents: 50_000}));
  const contribute = (valueCents: number) => executeCreateSimpleInvestment(
    actor, {
      workspaceId: t.workspaceId,
      idempotencyKey: idempotencyKey(),
      correlationId: `corr-p5d2-${idempotencyKey()}`,
      institutionId,
      classId,
      typeId,
      description: "Tesouro Selic",
      valueCents,
      settled: true,
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
      cashAccountId: defaultAccountOf(t.workspaceId),
      goalId,
    } as Parameters<typeof executeCreateSimpleInvestment>[1]);
  const small = await goalAndDeliver(t, goalId, () => contribute(20_000));
  assert.equal(small.after.get("investmentProgressCents"), 20_000,
    "o recálculo gravou a meta");
  // Passa do alvo (60.000 ≥ 50.000) sem mudar o status: o progresso por si
  // só não é fato notificável (decisão registrada na arquitetura).
  const over = await goalAndDeliver(t, goalId, () => contribute(40_000));
  assert.equal(over.after.get("investmentProgressCents"), 60_000);
  assert.equal(over.after.get("status"), "em_andamento");
  assert.deepEqual(await notificationsOf(t.workspaceId), []);
  // Já alcançada, novo recálculo: alcancada → alcancada.
  await goalAndDeliver(t, goalId, () => setGoalStatus(t, goalId, "alcancada"));
  assert.equal((await notificationsOf(t.workspaceId)).length, 1);
  await goalAndDeliver(t, goalId, () => contribute(5_000));
  await goalAndDeliver(t, goalId, () => contribute(5_000));
  assert.equal((await notificationsOf(t.workspaceId)).length, 1,
    "recálculo repetido não duplica");

  // Meta manual: atualizar o progresso não muda o status nem avisa.
  const manualId = await makeGoal(t, manualGoalDefinition(),
    {manualProgressCents: 0});
  const manualDoc = await capture(goalRefOf(t, manualId));
  await goalAndDeliver(t, manualId, () => executeUpdateGoalManualProgress(
    actor, updateGoalManualProgressPayloadSchema.parse({
      workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(),
      goalId: manualId, expectedRevision: manualDoc.get("revision"),
      manualProgressCents: 1_000_000,
    })));
  assert.equal((await notificationsOfType(t.workspaceId, "goal_achieved"))
    .length, 1, "só o aviso da meta marcada como alcançada");
});

test("§16.13 meta não cria avisos apenas por consulta (leitura da meta, " +
  "visão geral de metas e relatório financeiro)", async () => {
  const t = await seedReportTenant("PF", "p16g13");
  const goalId = await makeGoal(t, manualGoalDefinition(),
    {manualProgressCents: 1_000_000});
  await makeGoal(t, manualGoalDefinition({name: "Outra"}),
    {manualProgressCents: 5_000});
  const before = await domainSnapshot(t.workspaceId);
  await goalRefOf(t, goalId).get();
  const overview = await executeGetGoalsOverview(reportActorOf(t));
  assert.equal(overview.activeCount, 2);
  const r = await report(t, preset("30d"));
  assert.ok(r.alerts, "relatório calculado");
  assert.deepEqual(await notificationsOf(t.workspaceId), []);
  assertDomainUntouched(before, await domainSnapshot(t.workspaceId));
});

test("§16.13 relatório com condições de alerta (conta negativa, " +
  "empréstimo vencido) mostra o alerta contextual, mas não cria " +
  "notificação nem mexe no domínio", async () => {
  const t = await seedReportTenant("PF", "p16g13r");
  await seedDefaultCategories(t.workspaceId);
  // Conta própria: o desembolso do empréstimo entra na conta padrão.
  const {accountId} = await newAccount(t.owner, createAccountPayload(
    t.workspaceId, {name: "Conta no vermelho"}));
  await expenseOf(t, accountId, 12_345);
  await createLoan(t.owner, loanPayload(t.workspaceId, {
    startDate: daysAgo(40), firstDueDate: daysAgo(10)}));
  const before = await domainSnapshot(t.workspaceId);
  const r = await report(t, preset("30d"));
  const codes = (r.alerts.data?.items ?? []).map((item) => item.code);
  assert.ok(codes.includes("negative_account_balance"), codes.join(","));
  assert.ok(codes.includes("overdue_borrowed_loans"), codes.join(","));
  assert.deepEqual(await notificationsOf(t.workspaceId), [],
    "alerta contextual não é evento persistido");
  assertDomainUntouched(before, await domainSnapshot(t.workspaceId));
});

// ============================================================ RECORRENTES

const newRecurringTenant = async () => {
  const t = await seedRecurringTenant();
  recurringTenants.push(t);
  return t;
};

const MARCH_DUE = "2026-03-10";

/** Instante da criação da ocorrência (o fato datado no aviso). */
const createdDay = (snapshot: {createTime?: Timestamp}): Date => {
  assert.ok(snapshot.createTime, "ocorrência com instante de criação");
  return snapshot.createTime.toDate();
};

test("§16.15 recorrência pendente não vira pagamento realizado: a " +
  "ocorrência aguarda confirmação, o aviso diz isso e nenhum lançamento " +
  "de caixa é criado", async () => {
  const t = await newRecurringTenant();
  const account = defaultAccountOf(t.workspaceId);
  const balance = await balanceOf(t.workspaceId, account);
  const {recurringExpenseId} = await createContract(t, "2026-03-05", {
    executionMode: "confirmation_required",
    description: "Descrição reservada do contrato",
    name: "Internet reservada",
  });
  await runOn(MARCH_DUE);
  const [occurrence] = await occurrencesOf(t.workspaceId, recurringExpenseId);
  assert.equal(occurrence.status, "awaiting_confirmation");
  assert.equal(occurrence.cashTransactionId, null);
  const created = await capture(occurrenceRef(t.workspaceId, occurrence.id));
  await deliverOccurrenceCreated(t.workspaceId, occurrence.id, created);
  const item = await only(t.workspaceId, "recurring_awaiting_confirmation");
  expectNotice(item, {
    eventType: "recurring_awaiting_confirmation",
    workspaceId: t.workspaceId,
    id: ID_PATTERN.recurring,
    title: "Despesa recorrente aguardando confirmação",
    message: `Em ${br(saoPauloDay(createdDay(created)))}, uma ` +
      "despesa recorrente com vencimento em 10/03/2026 ficou aguardando " +
      "confirmação.",
    type: "warning",
    link: "recurring",
    actionLabel: "Ver recorrentes",
    source: "recurring_occurrence",
    domain: "recurring",
    entity: {recurringExpenseId, occurrenceId: occurrence.id},
    commitMs: created.createTime?.toMillis(),
  });
  assertNoWords(item, ["Internet reservada", "Descrição reservada",
    "plannedAmountCents", "9990"]);
  assert.deepEqual(await recurringTransactionsOf(t.workspaceId), [],
    "nenhum lançamento de caixa");
  assert.equal(await balanceOf(t.workspaceId, account), balance);
  // Reentrega da criação não duplica.
  await deliverOccurrenceCreated(t.workspaceId, occurrence.id, created);
  assert.deepEqual(await notificationsOf(t.workspaceId), [item]);
});

test("§16.15 impedimento de domínio (conta arquivada): aviso " +
  "\"não pôde ser gerada: a conta estava arquivada\", sem lançamento",
async () => {
  const t = await newRecurringTenant();
  const {recurringExpenseId} = await createContract(t, "2026-03-05");
  await archiveAccount(t.owner, await statusPayload(t.workspaceId,
    defaultAccountOf(t.workspaceId)));
  await runOn(MARCH_DUE);
  const [occurrence] = await occurrencesOf(t.workspaceId, recurringExpenseId);
  assert.equal(occurrence.status, "attention_required");
  assert.equal(occurrence.attentionCode, "account_archived");
  const created = await capture(occurrenceRef(t.workspaceId, occurrence.id));
  await deliverOccurrenceCreated(t.workspaceId, occurrence.id, created);
  expectNotice(await only(t.workspaceId, "recurring_attention_required"), {
    eventType: "recurring_attention_required",
    workspaceId: t.workspaceId,
    id: ID_PATTERN.recurring,
    title: "Despesa recorrente não gerada",
    message: `Em ${br(saoPauloDay(createdDay(created)))}, uma ` +
      "despesa recorrente com vencimento em 10/03/2026 não pôde ser " +
      "gerada: a conta estava arquivada.",
    type: "warning",
    link: "recurring",
    actionLabel: "Ver recorrentes",
    source: "recurring_occurrence",
    domain: "recurring",
    entity: {recurringExpenseId, occurrenceId: occurrence.id},
  });
  assert.deepEqual(await recurringTransactionsOf(t.workspaceId), []);
});

test("§16.15 geração normal (generated) e confirmação posterior não " +
  "geram aviso", async () => {
  const t = await newRecurringTenant();
  const {recurringExpenseId} = await createContract(t, "2026-03-05");
  await runOn(MARCH_DUE);
  const [occurrence] = await occurrencesOf(t.workspaceId, recurringExpenseId);
  assert.equal(occurrence.status, "generated");
  await deliverOccurrenceCreated(t.workspaceId, occurrence.id,
    await capture(occurrenceRef(t.workspaceId, occurrence.id)));
  assert.deepEqual(await notificationsOf(t.workspaceId), []);

  // Pendente resolvida pelo usuário: o gatilho é de criação, e a resolução
  // não é criação.
  const manual = await createContract(t, "2026-03-05", {
    executionMode: "confirmation_required"});
  await runOn(MARCH_DUE);
  const [pending] = (await occurrencesOf(t.workspaceId,
    manual.recurringExpenseId));
  await deliverOccurrenceCreated(t.workspaceId, pending.id,
    await capture(occurrenceRef(t.workspaceId, pending.id)));
  assert.equal((await notificationsOf(t.workspaceId)).length, 1);
  await confirmOccurrence(t, pending.id, "2026-03-12",
    {settlement: "pending"});
  assert.equal((await notificationsOf(t.workspaceId)).length, 1);
});

// ===================================================== DIVISÃO DE CONTAS

const collectSources = (directory: string, files: string[] = []): string[] => {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "testSupport") continue;
      collectSources(full, files);
    } else if (entry.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
};

test("§16.16 divisão de contas não inventa liquidação financeira: a " +
  "quitação do rateio não cria notificação nem lançamento, e nenhum " +
  "gatilho escuta coleções de divisão", async () => {
  const tenant = await seedSplitTenant("PF", "p16s16");
  const ids = await seedGroupWithMembers(tenant);
  const {billId} = await createBill(tenant, billPayload(tenant, ids.groupId,
    ids.owner, [ids.owner, ids.member, ids.otherMember],
    {amountCents: 9_000}));
  await settleShare(tenant, shareIdOf(tenant, billId, ids.member));
  assert.deepEqual(await notificationsOf(tenant.workspaceId), [],
    "nenhum aviso pela quitação declarada");
  assert.deepEqual(await splitTransactionsOf(tenant.workspaceId), [],
    "quitação declarada não é caixa");
  assert.equal(
    (await db().collection(`${workspacePath(tenant.workspaceId)}/` +
      "notification_user_states").get()).size, 0);

  // Estático: nenhum gatilho de documento (`onDocument*`) escuta coleção de
  // divisão, e `index.ts` não exporta nenhum gatilho de `splitBills/`.
  const sourceRoot = path.resolve(__dirname, "..", "..", "..", "src");
  const documentPaths: string[] = [];
  for (const file of collectSources(sourceRoot)) {
    const text = readFileSync(file, "utf8");
    if (!/onDocument(Written|Created|Updated|Deleted)/.test(text)) continue;
    for (const match of text.matchAll(/document:\s*"([^"]+)"/g)) {
      documentPaths.push(match[1]);
    }
  }
  assert.ok(documentPaths.length >= 4, "gatilhos de documento encontrados");
  for (const documentPath of documentPaths) {
    assert.ok(!/split/i.test(documentPath), documentPath);
  }
  for (const wanted of ["loans/{loanId}", "cash_accounts/{accountId}",
    "goals/{goalId}", "recurring_occurrences/{occurrenceId}"]) {
    assert.ok(documentPaths.some((item) => item.endsWith(wanted)), wanted);
  }
  const index = readFileSync(path.join(sourceRoot, "index.ts"), "utf8");
  const splitExports = [...index.matchAll(
    /export\s*\{([^}]*)\}\s*from\s*"\.\/splitBills\/[^"]*"/g)]
    .flatMap((match) => match[1].split(",").map((name) => name.trim()))
    .filter(Boolean);
  assert.ok(splitExports.length > 0, "callables de divisão exportadas");
  for (const name of splitExports) {
    assert.ok(!/^on[A-Z]/.test(name), `gatilho exportado: ${name}`);
  }
  for (const file of collectSources(path.join(sourceRoot, "splitBills"))) {
    assert.ok(!/notifications|onDocument/.test(readFileSync(file, "utf8")),
      `${file} não produz notificação nem gatilho`);
  }
});

// ================================================== ISOLAMENTO E CICLO

/** Cria, para um workspace PJ, um fato notificável de cada domínio. */
const everyDomain = async (t: LoanTenant) => {
  await seedDefaultCategories(t.workspaceId);
  const clientId = await seedClient(t);
  const accountIds = await newAccount(t.owner, createAccountPayload(
    t.workspaceId, {name: "Conta isolada"}));
  const loanId = (await createLoan(t.owner, loanPayload(t.workspaceId, {
    startDate: shiftDays(today(), -40), firstDueDate: shiftDays(today(), -10),
  }))).loanId;
  const receivableId = await newOpenReceivable(t, clientId,
    shiftDays(today(), -2));
  const goalId = await makeGoal(t, manualGoalDefinition(),
    {manualProgressCents: 0});
  return {clientId, accountId: accountIds.accountId, loanId, receivableId,
    goalId};
};

test("§16.20 a notificação não altera ledger, saldos, projeções nem " +
  "contratos: todos os documentos de domínio ficam idênticos byte a byte " +
  "depois de todos os produtores", async () => {
  const t = await seedReceivableTenant("p16x20");
  const ids = await everyDomain(t);
  const accountBefore = await capture(accountRef(t.workspaceId,
    ids.accountId));
  await expenseOf(t, ids.accountId, 7_000);
  const accountAfter = await capture(accountRef(t.workspaceId, ids.accountId));
  const goalBefore = await capture(goalRefOf(t, ids.goalId));
  await setGoalStatus(t, ids.goalId, "alcancada");
  const goalAfter = await capture(goalRefOf(t, ids.goalId));
  recurringTenants.push(t);
  await createContract(t, "2026-03-05", {
    executionMode: "confirmation_required"});
  await runOn(MARCH_DUE);
  const occurrences = (await db().collection(
    `${workspacePath(t.workspaceId)}/recurring_occurrences`).get()).docs;
  assert.equal(occurrences.length, 1);

  const snapshotBefore = await domainSnapshot(t.workspaceId);
  assert.ok(snapshotBefore.size > 10, "domínio com dados");
  await deliverLoanWrite(t.workspaceId, ids.loanId,
    await absent(t.workspaceId, "loans"),
    await capture(loanRef(t.workspaceId, ids.loanId)));
  await runReceivableOverdueNotifications({today: today()});
  await deliverCashAccountWrite(t.workspaceId, ids.accountId, accountBefore,
    accountAfter);
  await deliverGoalWrite(t.workspaceId, ids.goalId, goalBefore, goalAfter);
  await deliverOccurrenceCreated(t.workspaceId, occurrences[0].id,
    await capture(occurrences[0].ref));
  const snapshotAfter = await domainSnapshot(t.workspaceId);

  const kinds = new Set((await notificationsOf(t.workspaceId)).map(
    (item) => item.domainEventType));
  assert.deepEqual(kinds, new Set(["loan_overdue", "receivable_overdue",
    "cash_account_negative_balance", "goal_achieved",
    "recurring_awaiting_confirmation"]));
  assertDomainUntouched(snapshotBefore, snapshotAfter);
  await assertLedgerConsistent(t.workspaceId);
  // A escrita operacional do aviso de recebível fica fora do domínio: o
  // trabalho saiu da fila e a confirmação do episódio existe.
  const receivableNotice = ofReceivable(await notificationsOf(t.workspaceId),
    ids.receivableId);
  assert.equal(receivableNotice.length, 1);
  assert.equal((await overdueDeliveryRef(t.workspaceId,
    String(receivableNotice[0].id)).get()).exists, true);
  assert.equal((await overdueQueueRef(t.workspaceId, ids.receivableId).get())
    .exists, false);
});

test("§16.19 a mesma entidade (mesmo ID) em dois workspaces gera dois " +
  "avisos com IDs diferentes, cada um só no seu workspace", async () => {
  const a = await seedReceivableTenant("p16x19a");
  const b = await seedReceivableTenant("p16x19b");
  const clientA = await seedClient(a);
  const dueDate = shiftDays(today(), -2);
  const loanId = (await createLoan(a.owner, loanPayload(a.workspaceId, {
    startDate: shiftDays(today(), -40), firstDueDate: shiftDays(today(), -10),
  }))).loanId;
  const receivableId = await newOpenReceivable(a, clientA, dueDate);

  // O mesmo documento, com o mesmo ID, no outro workspace.
  const clone = async (collection: string, id: string) => {
    const data = (await db().doc(`${workspacePath(a.workspaceId)}/` +
      `${collection}/${id}`).get()).data();
    assert.ok(data);
    await db().doc(`${workspacePath(b.workspaceId)}/${collection}/${id}`)
      .set({...data, workspaceId: b.workspaceId});
  };
  await clone("loans", loanId);
  await clone("receivables", receivableId);
  // P5-D2.1: o trabalho pendente nasce com a operação de domínio; a cópia
  // direta do recebível precisa levar o item da fila junto.
  await clone("receivable_overdue_queue", receivableId);

  for (const workspaceId of [a.workspaceId, b.workspaceId]) {
    await deliverLoanWrite(workspaceId, loanId,
      await absent(workspaceId, "loans"),
      await capture(loanRef(workspaceId, loanId)));
  }
  await runReceivableOverdueNotifications({today: today()});

  const itemsA = await notificationsOf(a.workspaceId);
  const itemsB = await notificationsOf(b.workspaceId);
  assert.equal(itemsA.length, 2);
  assert.equal(itemsB.length, 2);
  for (const type of ["loan_overdue", "receivable_overdue"] as const) {
    const inA = itemsA.find((item) => item.domainEventType === type);
    const inB = itemsB.find((item) => item.domainEventType === type);
    assert.ok(inA && inB, type);
    assert.notEqual(inA.id, inB.id, "IDs diferentes entre workspaces");
    assert.equal(inA.workspaceId, a.workspaceId);
    assert.equal(inB.workspaceId, b.workspaceId);
  }
  assert.equal(
    notificationIdFor({workspaceId: a.workspaceId, domain: "loan",
      entityId: loanId, eventType: "loan_overdue",
      episode: shiftDays(today(), -9)}),
    itemsA.find((item) => item.domainEventType === "loan_overdue")?.id);
  // Apagar o aviso de A (TTL) não toca o de B.
  for (const item of itemsA) {
    await notificationRef(a.workspaceId, String(item.id)).delete();
  }
  assert.equal((await notificationsOf(b.workspaceId)).length, 2);
  assert.deepEqual(await notificationsOf(a.workspaceId), []);
});

// ------------------------------------------- expiração física e TTL (17/18)

test("§16.17 evento antigo não reaparece após a expiração física: " +
  "empréstimo, conta, meta e recebível (o Emulator não executa TTL: a " +
  "remoção é simulada pelo Admin SDK)", async () => {
  // Empréstimo: removido o aviso, outra escrita que mantém o atraso (edição
  // de metadados, status overdue → overdue) e a rotina não o recriam.
  const t = await seedReceivableTenant("p16x17");
  const ids = await everyDomain(t);
  const loanAfter = await capture(loanRef(t.workspaceId, ids.loanId));
  await deliverLoanWrite(t.workspaceId, ids.loanId,
    await absent(t.workspaceId, "loans"), loanAfter);
  const loanNotice1 = await only(t.workspaceId, "loan_overdue");
  await notificationRef(t.workspaceId, String(loanNotice1.id)).delete();
  await runLoanStatusRefresh({today: shiftDays(today(), 30)});
  const loanLater = await writeAndDeliver(loanRef(t.workspaceId, ids.loanId),
    async () => {
      await updateLoanMetadata(t.owner, await loanMetadataPayload(
        t.workspaceId, ids.loanId, {classification: "capital_giro"}));
    },
    (b, a) => deliverLoanWrite(t.workspaceId, ids.loanId, b, a));
  assert.equal(loanLater.after.get("status"), "overdue");
  assert.deepEqual(await notificationsOfType(t.workspaceId, "loan_overdue"),
    [], "não reaparece");

  // Conta: negativa → mais negativa depois da remoção física.
  await seedDefaultCategories(t.workspaceId);
  await moveAndDeliver(t, ids.accountId, () =>
    expenseOf(t, ids.accountId, 4_000));
  const accountNotice = await only(t.workspaceId,
    "cash_account_negative_balance");
  await notificationRef(t.workspaceId, String(accountNotice.id)).delete();
  await moveAndDeliver(t, ids.accountId, () =>
    expenseOf(t, ids.accountId, 4_000));
  assert.deepEqual(await notificationsOfType(t.workspaceId,
    "cash_account_negative_balance"), []);

  // Meta: alcancada → alcancada depois da remoção física.
  await goalAndDeliver(t, ids.goalId, () =>
    setGoalStatus(t, ids.goalId, "alcancada"));
  const goalNotice1 = await only(t.workspaceId, "goal_achieved");
  await notificationRef(t.workspaceId, String(goalNotice1.id)).delete();
  await goalAndDeliver(t, ids.goalId, () =>
    setGoalStatus(t, ids.goalId, "alcancada"));
  assert.deepEqual(await notificationsOfType(t.workspaceId, "goal_achieved"),
    []);

  // Recebível (P5-D2.1): a confirmação durável do episódio, sem TTL, é o
  // que impede a reemissão. Com o aviso removido (TTL), nem a reabertura do
  // trabalho (o domínio regrava a fila) nem a rotina 181 dias depois recriam.
  const dueDate = shiftDays(today(), -2);
  await runReceivableOverdueNotifications({today: today()});
  const receivableNotice = ofReceivable(await notificationsOf(t.workspaceId),
    ids.receivableId);
  assert.equal(receivableNotice.length, 1);
  assert.equal(receivableNotice[0].id, notificationIdFor({
    workspaceId: t.workspaceId, domain: "receivable",
    entityId: ids.receivableId, eventType: "receivable_overdue",
    episode: dueDate}));
  await notificationRef(t.workspaceId, String(receivableNotice[0].id)).delete();
  const partial = await receive(t.owner, await receivePayload(t.workspaceId,
    ids.receivableId, {principalCents: 100_000}));
  assert.equal(partial.status, "received");
  await reverseReceivable(t.owner, await reverseReceivablePayload(
    t.workspaceId, ids.receivableId, String(partial.movementId)));
  assert.equal((await overdueQueueRef(t.workspaceId, ids.receivableId).get())
    .exists, true, "o estorno que reabre devolve o trabalho à fila");
  await runReceivableOverdueNotifications({today: shiftDays(dueDate, 9)});
  await runReceivableOverdueNotifications({today: shiftDays(dueDate, 181)});
  assert.deepEqual(ofReceivable(await notificationsOf(t.workspaceId),
    ids.receivableId), [], "a confirmação impede a reemissão");
  assert.equal((await overdueDeliveryRef(t.workspaceId,
    String(receivableNotice[0].id)).get()).exists, true,
  "a confirmação continua válida");
  assert.equal((await overdueQueueRef(t.workspaceId, ids.receivableId).get())
    .exists, false, "já entregue: o trabalho sai da fila sem publicar");
});

test("§16.17 cartões: depois de 180 dias, sem janela, o fechamento não " +
  "reemite aviso nenhum (aviso removido fisicamente)", async () => {
  const {t} = await cardWithInvoice("p16x17c", "Cartão Antigo");
  await runCreditCardInvoiceClosing({today: "2014-01-18"});
  await runCreditCardInvoiceClosing({today: "2014-01-22"});
  const items = await notificationsOf(t.workspaceId);
  assert.equal(items.length, 3);
  for (const item of items) {
    await notificationRef(t.workspaceId, String(item.id)).delete();
  }
  const later = new Date(Date.parse("2014-01-18T12:00:00Z") +
    (APPROVED_RETENTION_MS + DAY_MS)).toISOString().slice(0, 10);
  const summary = await runCreditCardInvoiceClosing({today: later});
  assert.equal(summary.failed, 0);
  assert.deepEqual(await notificationsOf(t.workspaceId), []);
});

test("§16.17 recorrente: a ocorrência é criada uma vez; regerar no mesmo " +
  "dia depois da remoção física do aviso não recria ocorrência nem aviso",
async () => {
  const t = await newRecurringTenant();
  const {recurringExpenseId} = await createContract(t, "2026-03-05", {
    executionMode: "confirmation_required"});
  await runOn(MARCH_DUE);
  const [occurrence] = await occurrencesOf(t.workspaceId, recurringExpenseId);
  await deliverOccurrenceCreated(t.workspaceId, occurrence.id,
    await capture(occurrenceRef(t.workspaceId, occurrence.id)));
  const item = await only(t.workspaceId, "recurring_awaiting_confirmation");
  await notificationRef(t.workspaceId, String(item.id)).delete();
  await runOn(MARCH_DUE);
  await runOn("2026-03-11");
  assert.equal((await occurrencesOf(t.workspaceId, recurringExpenseId)).length,
    1, "nenhuma nova ocorrência, logo nenhum novo evento de criação");
  assert.deepEqual(await notificationsOf(t.workspaceId), []);
  // O contrato avançou: não há mais vencimento de março a gerar.
  assert.notEqual((await recurringContractRef(t.workspaceId,
    recurringExpenseId).get()).get("nextDueDate"), MARCH_DUE);
});

test("§16.18 retry não prorroga o TTL: reentrega ou reexecução depois de " +
  "dias mantém createdAt e expiresAt de cada produtor", async () => {
  const t = await seedReceivableTenant("p16x18");
  const ids = await everyDomain(t);
  const loanAfter = await capture(loanRef(t.workspaceId, ids.loanId));
  const loanBefore = await absent(t.workspaceId, "loans");
  await deliverLoanWrite(t.workspaceId, ids.loanId, loanBefore, loanAfter);
  const nowMs = Date.now();
  await runReceivableOverdueNotifications({today: today(), nowMs});
  const account = await moveAndDeliver(t, ids.accountId, () =>
    expenseOf(t, ids.accountId, 8_000));
  const goal = await goalAndDeliver(t, ids.goalId, () =>
    setGoalStatus(t, ids.goalId, "alcancada"));
  const original = await notificationsOf(t.workspaceId);
  assert.equal(original.length, 4);
  for (const item of original) assertRetention(item);

  await sleep(30);
  // Retry do empréstimo muito tempo depois (outro commit).
  await handleLoanNotificationWrite({
    workspaceId: t.workspaceId,
    loanId: ids.loanId,
    before: undefined,
    after: loanAfter.data(),
    commitTime: Timestamp.fromMillis(commitMsOf(loanAfter) + 9 * DAY_MS),
  });
  // Rotina de recebíveis nos dias seguintes, com relógio avançado.
  for (let day = 1; day <= 4; day += 1) {
    await runReceivableOverdueNotifications({
      today: shiftDays(today(), day), nowMs: nowMs + day * DAY_MS});
  }
  // Reentregas de conta e meta.
  await deliverCashAccountWrite(t.workspaceId, ids.accountId, account.before,
    account.after);
  await deliverGoalWrite(t.workspaceId, ids.goalId, goal.before, goal.after);
  const retried = await notificationsOf(t.workspaceId);
  const byId = (items: Doc[]) => new Map(items.map((i) => [i.id, i]));
  for (const [id, item] of byId(original)) {
    const same = byId(retried).get(id);
    assert.ok(same, `${String(id)} permanece`);
    assert.deepEqual(same, item, "createdAt/expiresAt inalterados");
  }
  assert.equal(retried.length, original.length, "nenhum aviso novo");
});

// ------------------------------------------------------------- correlação

type LogEntry = Record<string, unknown>;

const captureLogs = async (
  run: () => Promise<unknown>,
): Promise<LogEntry[]> => {
  const entries: LogEntry[] = [];
  const spy = mock.method(functionsLogger, "write", (entry: LogEntry) => {
    entries.push(entry);
  });
  try {
    await run();
  } finally {
    spy.mock.restore();
  }
  return entries;
};

test("P5-D2 correlação: o gatilho registra a publicação com o ID do evento " +
  "do Eventarc, o mesmo na reentrega, só com identificadores", async () => {
  const t = await seedLoanTenant("PF", "p5d2corr");
  const loanId = (await createLoan(t.owner, loanPayload(t.workspaceId, {
    startDate: shiftDays(today(), -40), firstDueDate: shiftDays(today(), -10),
  }))).loanId;
  const after = await capture(loanRef(t.workspaceId, loanId));
  assert.equal(after.get("status"), "overdue");
  assert.ok(after.updateTime);
  const eventId = uniqueId("eventarc");
  const delivery = {
    eventId,
    workspaceId: t.workspaceId,
    loanId,
    before: undefined,
    after: after.data(),
    commitTime: after.updateTime,
  };
  const logs = await captureLogs(async () => {
    await handleLoanNotificationWrite(delivery);
    await handleLoanNotificationWrite(delivery);
  });
  const published = logs.filter(
    (entry) => entry.event === "notification_published");
  assert.deepEqual(published.map((entry) => entry.outcome),
    ["created", "exists"]);
  const item = await only(t.workspaceId, "loan_overdue");
  for (const entry of published) {
    assert.equal(entry.sourceEventId, eventId, "correlação pelo evento");
    assert.equal(entry.operation, LOAN_NOTIFICATION_OPERATION);
    assert.equal(entry.workspaceId, t.workspaceId);
    assert.equal(entry.loanId, loanId);
    assert.equal(entry.notificationId, item.id);
    assertNoWords(entry, LOAN_PII);
  }
});

test("P5-D2 correlação: o corpo da rotina de recebíveis deriva a correlação " +
  "do instante agendado e publica o aviso do dia", async () => {
  const t = await seedReceivableTenant("p5d2corr");
  const clientId = await seedClient(t);
  const receivableId = await newOpenReceivable(t, clientId,
    shiftDays(today(), -1));
  const scheduleTime = new Date().toISOString();
  const logs = await captureLogs(async () => {
    await processReceivableOverdueNotifications.run({
      jobName: "test-job",
      scheduleTime,
    } as unknown as Parameters<
      typeof processReceivableOverdueNotifications.run>[0]);
  });
  const items = ofReceivable(await notificationsOf(t.workspaceId),
    receivableId);
  assert.equal(items.length, 1, "o corpo agendado publicou o aviso");
  const runLogs = logs.filter(
    (entry) => entry.operation === RECEIVABLE_OVERDUE_OPERATION);
  const completed = runLogs.find((entry) =>
    entry.event === "receivable_overdue_notifications_completed");
  assert.ok(completed, "conclusão registrada");
  const published = runLogs.find((entry) =>
    entry.event === "notification_published" &&
    entry.notificationId === items[0].id);
  assert.ok(published, "publicação registrada");
  for (const entry of [completed, published]) {
    assert.equal(entry.runId, `receivable-overdue-${scheduleTime}`);
    assertNoWords(entry, RECEIVABLE_PII);
  }
});

test("§16 concorrência: entregas simultâneas do mesmo fato e duas " +
  "execuções simultâneas da rotina publicam um único aviso por fato",
async () => {
  const t = await seedLoanTenant("PF", "p16conc");
  const loanId = (await createLoan(t.owner, loanPayload(t.workspaceId, {
    startDate: shiftDays(today(), -40), firstDueDate: shiftDays(today(), -10),
  }))).loanId;
  const after = await capture(loanRef(t.workspaceId, loanId));
  assert.equal(after.get("status"), "overdue");
  assert.ok(after.updateTime);
  const delivery = {
    eventId: uniqueId("eventarc"),
    workspaceId: t.workspaceId,
    loanId,
    before: undefined,
    after: after.data(),
    commitTime: after.updateTime,
  };
  const logs = await captureLogs(() => Promise.all(Array.from({length: 6},
    () => handleLoanNotificationWrite(delivery))));
  const outcomes = logs
    .filter((entry) => entry.event === "notification_published")
    .map((entry) => String(entry.outcome))
    .sort();
  assert.deepEqual(outcomes, ["created", "exists", "exists", "exists",
    "exists", "exists"],
  "uma criação; as demais entregas já encontram o aviso");
  assert.equal((await notificationsOfType(t.workspaceId, "loan_overdue"))
    .length, 1);

  const r = await seedReceivableTenant("p16conc");
  const clientId = await seedClient(r);
  const receivableId = await newOpenReceivable(r, clientId,
    shiftDays(today(), -2));
  let runs: Awaited<ReturnType<typeof runReceivableOverdueNotifications>>[] =
    [];
  const runLogs = await captureLogs(async () => {
    runs = await Promise.all([
      runReceivableOverdueNotifications({today: today()}),
      runReceivableOverdueNotifications({today: today()}),
    ]);
  });
  assert.equal(runs[0].failed + runs[1].failed, 0);
  const notices = ofReceivable(await notificationsOf(r.workspaceId),
    receivableId);
  assert.equal(notices.length, 1, "um aviso para o recebível");
  // A rotina só registra a publicação quando cria: somadas as duas
  // execuções, exatamente uma criou; a outra encontrou o aviso.
  assert.equal(runLogs.filter((entry) =>
    entry.event === "notification_published" &&
    entry.notificationId === notices[0].id &&
    entry.outcome === "created").length, 1, "uma única criação");
  const marker = await overdueDeliveryRef(r.workspaceId,
    String(notices[0].id)).get();
  assert.equal(marker.exists, true, "uma confirmação");
  assert.equal(marker.get("receivableId"), receivableId);
});

test("P5-D2 correlação: os quatro gatilhos exportados (corpo real) passam " +
  "o event.id do Eventarc ao log como sourceEventId", async () => {
  const ids = {
    loan: uniqueId("evt-loan"),
    account: uniqueId("evt-account"),
    goal: uniqueId("evt-goal"),
    recurring: uniqueId("evt-recurring"),
  };
  const lt = await seedLoanTenant("PF", "p5d2c4l");
  const loanId = (await createLoan(lt.owner, loanPayload(lt.workspaceId, {
    startDate: shiftDays(today(), -40), firstDueDate: shiftDays(today(), -10),
  }))).loanId;
  const loanBefore = await absent(lt.workspaceId, "loans");
  const loanAfter = await capture(loanRef(lt.workspaceId, loanId));

  const {t: at, accountId, ref: accountDoc} = await seededAccount("p5d2c4a");
  const accountBefore = await capture(accountDoc);
  await expenseOf(at, accountId, 10_000);
  const accountAfter = await capture(accountDoc);

  const gt = await seedLoanTenant("PF", "p5d2c4g");
  const goalId = await makeGoal(gt, manualGoalDefinition(),
    {manualProgressCents: 0});
  const goalBefore = await capture(goalRefOf(gt, goalId));
  await setGoalStatus(gt, goalId, "alcancada");
  const goalAfter = await capture(goalRefOf(gt, goalId));

  const rt = await newRecurringTenant();
  const {recurringExpenseId} = await createContract(rt, "2026-03-05", {
    executionMode: "confirmation_required",
  });
  await runOn(MARCH_DUE);
  const [occurrence] = await occurrencesOf(rt.workspaceId,
    recurringExpenseId);
  assert.equal(occurrence.status, "awaiting_confirmation");
  const created = await capture(occurrenceRef(rt.workspaceId, occurrence.id));

  const logs = await captureLogs(async () => {
    await deliverLoanWrite(lt.workspaceId, loanId, loanBefore, loanAfter,
      ids.loan);
    await deliverCashAccountWrite(at.workspaceId, accountId, accountBefore,
      accountAfter, ids.account);
    await deliverGoalWrite(gt.workspaceId, goalId, goalBefore, goalAfter,
      ids.goal);
    await deliverOccurrenceCreated(rt.workspaceId, occurrence.id, created,
      ids.recurring);
  });
  const expected: Array<[string, string, string]> = [
    [lt.workspaceId, ids.loan, "loan_overdue"],
    [at.workspaceId, ids.account, "cash_account_negative_balance"],
    [gt.workspaceId, ids.goal, "goal_achieved"],
    [rt.workspaceId, ids.recurring, "recurring_awaiting_confirmation"],
  ];
  for (const [workspaceId, eventId, eventType] of expected) {
    const published = logs.filter((entry) =>
      entry.event === "notification_published" &&
      entry.workspaceId === workspaceId);
    assert.equal(published.length, 1, `${eventType}: uma publicação`);
    assert.equal(published[0].outcome, "created");
    assert.equal(published[0].domainEventType, eventType);
    assert.equal(published[0].sourceEventId, eventId,
      `${eventType}: correlação pelo event.id`);
  }
});
