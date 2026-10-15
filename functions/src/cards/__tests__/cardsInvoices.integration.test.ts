import assert from "node:assert/strict";
import test from "node:test";

import {Timestamp} from "firebase-admin/firestore";

import {ACCOUNT_ARCHIVED_MESSAGE} from "../../accounts/ledger";
import {
  archiveAccount,
  createAccountPayload,
  newAccount,
  statusPayload,
} from "../../accounts/testSupport/accountTestSupport";
import {cashPeriodDeltaFor} from "../../cash/periods";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  createCreditCardInvoiceAdjustment,
  registerInvoicePayment,
  reverseInvoicePayment,
} from "../callables";
import {runCreditCardInvoiceClosing} from "../closing";
import {LIMIT_INSUFFICIENT_MESSAGE} from "../common";
import {
  INVOICE_NOTHING_TO_PAY_MESSAGE,
  INVOICE_OPEN_PAYMENT_MESSAGE,
  PAYMENT_ALREADY_REVERSED_MESSAGE,
  PAYMENT_NOT_REVERSIBLE_MESSAGE,
  PAYMENT_REVERSAL_LIMIT_MESSAGE,
  executeCreateInvoiceAdjustment,
  executeRegisterInvoicePayment,
  executeReverseInvoicePayment,
} from "../invoiceOperations";
import {
  carryoverEntryIdFor,
  invoiceIdFor,
  paymentCashTransactionIdFor,
  paymentReversalIdFor,
} from "../model";
import {executeRefundCreditCardPurchase} from "../purchaseOperations";
import {
  executeRebuildCardInvoices,
  executeRecalculateCardLimit,
} from "../reconciliation";
import {
  accountLedger,
  actorOf,
  assertCardInvariants,
  buy,
  cardEventsOf,
  cardRef,
  clockAt,
  createCard,
  defaultAccountOf,
  entriesOf,
  invoiceRef,
  invoiceVersion,
  invoicesOf,
  pay,
  paymentRef,
  purchaseVersion,
  readCard,
  readDoc,
  readInvoice,
  requestId,
  seedCardTenant,
  transactionsOf,
  type CardTenant,
} from "../testSupport/cardTestSupport";

/**
 * P4-A (D-36) — faturas no Emulator: pagamento (fatura aberta recusada,
 * fechamento tardio pela própria operação, antecipado, parcial, total),
 * conta de origem e espelho de caixa no mesmo commit, estorno na mesma
 * conta, ajuste manual, fechamento automático (página, corte, concorrência,
 * transporte de crédito, alertas) e reconciliação.
 */

const rejectsWith = async (
  promise: Promise<unknown>,
  code: string,
  message?: string | RegExp,
) => {
  await assert.rejects(promise, (error: {code?: string; message?: string}) => {
    assert.equal(error.code, code, error.message);
    if (typeof message === "string") assert.equal(error.message, message);
    else if (message) assert.match(String(error.message), message);
    return true;
  });
};

const reversePayment = async (
  t: CardTenant,
  cardId: string,
  competence: string,
  paymentId: string,
  today: string,
) => executeReverseInvoicePayment(actorOf(t, t.owner), {
  workspaceId: t.workspaceId,
  idempotencyKey: idempotencyKey(),
  paymentId,
  expectedUpdatedAt: await invoiceVersion(t.workspaceId, cardId, competence),
}, requestId(), clockAt(today));

const adjust = (
  t: CardTenant,
  cardId: string,
  competenceMonth: string,
  amountCents: number,
  today: string,
  uid = t.owner,
) => executeCreateInvoiceAdjustment(actorOf(t, uid), {
  workspaceId: t.workspaceId,
  idempotencyKey: idempotencyKey(),
  cardId,
  competenceMonth,
  amountCents,
  reason: "Tarifa de anuidade lançada pelo banco",
}, requestId(), clockAt(today));

test("P4-A — pagamento: aberta recusada; fechamento tardio pela operação; " +
  "antecipado, parcial e total; conta, espelho e projeção no mesmo commit",
async () => {
  const t = await seedCardTenant("PF", "cc-pay");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-10", {totalCents: 30_000});
  const accountId = defaultAccountOf(t.workspaceId);

  await rejectsWith(pay(t, cardId, "2026-03", "2026-03-20", 10_000),
    "domain_precondition_failed", INVOICE_OPEN_PAYMENT_MESSAGE);
  await rejectsWith(pay(t, cardId, "2026-03", "2026-03-26", 10_000,
    {paymentDate: "2026-03-24"}), "domain_precondition_failed",
  /anterior ao fechamento/);

  // 26/03: fechou pela data; a rotina não rodou — a operação fecha e paga,
  // antes do vencimento (05/04): pagamento antecipado.
  const partial = await pay(t, cardId, "2026-03", "2026-03-26", 10_000);
  assert.equal(partial.paymentStatus, "partial");
  assert.equal(partial.remainingCents, 20_000);
  const invoice = await readInvoice(t.workspaceId, cardId, "2026-03");
  assert.equal(invoice.cycleStatus, "closed");
  assert.equal(invoice.closedBy, t.owner);
  assert.equal(invoice.paymentStatus, "partial");
  assert.equal(invoice.dueDate, "2026-04-05");
  const events = (await cardEventsOf(t.workspaceId, cardId)) as
    Array<Record<string, unknown>>;
  assert.equal(events.filter((event) =>
    event.operation === "credit_card.invoice_closed").length, 1);

  // Conta de origem: movimento no mesmo commit; saldo = soma do livro-razão.
  const ledger = await accountLedger(t.workspaceId, accountId);
  assert.equal(ledger.balanceCents, -10_000);
  const movement = ledger.movements.find((item) =>
    item.kind === "credit_card_payment");
  assert.ok(movement);
  assert.equal(movement.sourceDomain, "credit_card");
  assert.equal(movement.sourceFactId, partial.paymentId);
  assert.equal(movement.amountCents, -10_000);

  // Espelho de caixa: liquidação do cartão, nunca despesa operacional.
  const mirror = (await transactionsOf(t.workspaceId)).find((item) =>
    item.id === paymentCashTransactionIdFor(String(partial.paymentId))) as
    Record<string, unknown> | undefined;
  assert.ok(mirror);
  assert.equal(mirror.type, "despesa");
  assert.equal(mirror.valueCents, 10_000);
  assert.equal(mirror.cashAccountId, accountId);
  assert.equal(mirror.source, "credit_card_payment");
  const delta = cashPeriodDeltaFor(mirror);
  assert.equal(delta.expenseCents, 0);
  assert.equal(delta.creditCardPaymentCents, 10_000);
  assert.equal(delta.netCents, -10_000);

  await rejectsWith(pay(t, cardId, "2026-03", "2026-03-27", 20_001),
    "domain_precondition_failed", /maior que o saldo/);
  const full = await pay(t, cardId, "2026-03", "2026-03-27", 20_000);
  assert.equal(full.paymentStatus, "paid");
  assert.equal(full.remainingCents, 0);
  await rejectsWith(pay(t, cardId, "2026-03", "2026-03-28", 1),
    "domain_precondition_failed", INVOICE_NOTHING_TO_PAY_MESSAGE);
  // Paga continua paga, mesmo depois do vencimento.
  const paid = await readInvoice(t.workspaceId, cardId, "2026-03");
  assert.equal(paid.paymentStatus, "paid");
  assert.equal(paid.status, undefined, "nenhum `overdue` persistido");

  // Papéis: só owner/admin pagam (member e viewer são recusados antes).
  for (const [uid, role] of [[t.member, "member"], [t.viewer, "viewer"]] as
    const) {
    await rejectsWith(executeRegisterInvoicePayment(actorOf(t, uid, role), {
      workspaceId: t.workspaceId,
      idempotencyKey: idempotencyKey(),
      cardId,
      invoiceId: invoiceIdFor(cardId, "2026-03"),
      cashAccountId: accountId,
      amountCents: 1,
      paymentDate: "2026-03-28",
      expectedUpdatedAt: await invoiceVersion(t.workspaceId, cardId,
        "2026-03"),
    }, requestId(), clockAt("2026-03-28")), "workspace_role_denied");
  }
  const card = await assertCardInvariants(t.workspaceId, cardId);
  assert.equal(card.limitUsedCents, 0);
  assert.equal((await accountLedger(t.workspaceId, accountId)).balanceCents,
    -30_000);
});

test("P4-A — estorno de pagamento: mesma conta, compensação, fatura e " +
  "limite restaurados; sem duplicidade; limite e conta arquivada", async () => {
  const t = await seedCardTenant("PF", "cc-rev");
  const cardId = await createCard(t, {limitTotalCents: 50_000});
  const bank = await newAccount(t.owner, createAccountPayload(t.workspaceId,
    {name: "Banco", openingBalanceCents: 100_000,
      openingBalanceDate: "2026-01-01"}));
  await buy(t, cardId, "2026-03-10", {totalCents: 30_000});
  const payment = await pay(t, cardId, "2026-03", "2026-03-26", 30_000,
    {cashAccountId: bank.accountId});
  assert.equal((await accountLedger(t.workspaceId, bank.accountId))
    .balanceCents, 70_000);

  // A mesma intenção reenviada é o mesmo payload (inclusive a versão lida).
  const reversalPayload = {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    paymentId: String(payment.paymentId),
    expectedUpdatedAt: await invoiceVersion(t.workspaceId, cardId, "2026-03"),
  };
  const reversal = await executeReverseInvoicePayment(actorOf(t, t.owner),
    reversalPayload, requestId(), clockAt("2026-03-27"));
  assert.equal(reversal.paymentStatus, "unpaid");
  assert.equal(reversal.remainingCents, 30_000);
  const original = await readDoc(paymentRef(t.workspaceId,
    String(payment.paymentId)));
  assert.equal(original.reversedBy, paymentReversalIdFor(
    String(payment.paymentId)), "original intacto, só com o vínculo");
  assert.equal(original.amountCents, 30_000);
  const reversalDoc = await readDoc(paymentRef(t.workspaceId,
    String(reversal.paymentId)));
  assert.equal(reversalDoc.kind, "reversal");
  assert.equal(reversalDoc.cashAccountId, bank.accountId,
    "estorno na conta do pagamento original");
  const bankLedger = await accountLedger(t.workspaceId, bank.accountId);
  assert.equal(bankLedger.balanceCents, 100_000);
  assert.equal(bankLedger.movements.filter((item) =>
    item.sourceDomain === "credit_card").length, 2);
  const mirrors = (await transactionsOf(t.workspaceId)) as
    Array<Record<string, unknown>>;
  const net = mirrors.reduce((sum, item) =>
    sum + cashPeriodDeltaFor(item).netCents, 0);
  const cardPayments = mirrors.reduce((sum, item) =>
    sum + cashPeriodDeltaFor(item).creditCardPaymentCents, 0);
  assert.equal(net, 0, "pagamento + estorno somam zero no caixa");
  assert.equal(cardPayments, 0);
  assert.equal((await assertCardInvariants(t.workspaceId, cardId))
    .limitUsedCents, 30_000, "limite consumido de novo");

  const replay = await executeReverseInvoicePayment(actorOf(t, t.owner),
    reversalPayload, requestId(), clockAt("2026-03-27"));
  assert.equal(replay.replayed, true);
  assert.equal(replay.paymentId, reversal.paymentId);
  await rejectsWith(reversePayment(t, cardId, "2026-03",
    String(payment.paymentId), "2026-03-27"), "domain_precondition_failed",
  PAYMENT_ALREADY_REVERSED_MESSAGE);
  await rejectsWith(reversePayment(t, cardId, "2026-03",
    String(reversal.paymentId), "2026-03-27"), "domain_precondition_failed",
  PAYMENT_NOT_REVERSIBLE_MESSAGE);

  // O estorno não pode deixar o limite disponível negativo.
  const second = await pay(t, cardId, "2026-03", "2026-03-28", 30_000,
    {cashAccountId: bank.accountId});
  await buy(t, cardId, "2026-03-28", {totalCents: 45_000});
  await rejectsWith(reversePayment(t, cardId, "2026-03",
    String(second.paymentId), "2026-03-29"), "domain_precondition_failed",
  PAYMENT_REVERSAL_LIMIT_MESSAGE);

  // Conta arquivada não paga fatura.
  const spare = await newAccount(t.owner, createAccountPayload(t.workspaceId,
    {name: "Reserva"}));
  await archiveAccount(t.owner, await statusPayload(t.workspaceId,
    spare.accountId));
  await rejectsWith(pay(t, cardId, "2026-04", "2026-04-26", 1_000,
    {cashAccountId: spare.accountId}), "domain_precondition_failed",
  ACCOUNT_ARCHIVED_MESSAGE);
  await assertCardInvariants(t.workspaceId, cardId);
});

test("P4-A — ajuste manual: fatura aberta; fechada vira compensação na " +
  "primeira aberta; saldo e limite protegidos; só owner/admin; não é " +
  "pagamento", async () => {
  const t = await seedCardTenant("PF", "cc-adj");
  const cardId = await createCard(t, {limitTotalCents: 20_000});
  await buy(t, cardId, "2026-03-10", {totalCents: 10_000});
  const fee = await adjust(t, cardId, "2026-03", 500, "2026-03-12");
  assert.equal(fee.compensated, false);
  assert.equal((await readInvoice(t.workspaceId, cardId, "2026-03"))
    .totalCents, 10_500);
  const marchBefore = await readInvoice(t.workspaceId, cardId, "2026-03");
  const credit = await adjust(t, cardId, "2026-03", -700, "2026-03-26");
  assert.equal(credit.compensated, true);
  assert.equal(credit.competenceMonth, "2026-04");
  const marchAfter = await readInvoice(t.workspaceId, cardId, "2026-03");
  assert.equal(marchAfter.revision, marchBefore.revision,
    "a competência fechada não é reescrita");
  const entry = ((await entriesOf(t.workspaceId, cardId)) as
    Array<Record<string, unknown>>).find((item) =>
    item.id === credit.entryId);
  assert.ok(entry);
  assert.equal(entry.kind, "adjustment");
  assert.equal(entry.requestedCompetence, "2026-03");
  assert.equal(entry.invoiceId, invoiceIdFor(cardId, "2026-04"));
  assert.equal(entry.reason, "Tarifa de anuidade lançada pelo banco");
  const event = ((await cardEventsOf(t.workspaceId, cardId)) as
    Array<Record<string, unknown>>).find((item) =>
    item.operation === "credit_card.adjustment_created" &&
    item.entryId === credit.entryId);
  assert.ok(event);
  assert.equal(JSON.stringify(event).includes("anuidade"), false,
    "o motivo (texto livre) não vai para a auditoria");

  await rejectsWith(adjust(t, cardId, "2026-04", -10_000, "2026-03-26"),
    "domain_precondition_failed", /saldo do cartão negativo/);
  await rejectsWith(adjust(t, cardId, "2026-04", 10_201, "2026-03-26"),
    "domain_precondition_failed", LIMIT_INSUFFICIENT_MESSAGE);
  await rejectsWith(adjust(t, cardId, "2026-04", 100, "2026-03-26", t.member),
    "workspace_role_denied");
  // Ajuste nunca é pagamento: nada em pagamentos, contas ou `transactions`.
  assert.equal((await db().collection(
    `workspaces/${t.workspaceId}/credit_card_invoice_payments`).get()).size, 0);
  assert.equal((await transactionsOf(t.workspaceId)).length, 0);
  const card = await assertCardInvariants(t.workspaceId, cardId);
  assert.equal(card.limitUsedCents, 9_800);
});

test("P4-A — rotina: estorno, fechamento, pagamento e transporte do crédito " +
  "para a primeira fatura aberta", async () => {
  const t = await seedCardTenant("PF", "cc-carry");
  const cardId = await createCard(t, {closingDay: 10, dueDay: 20});
  const bought = await buy(t, cardId, "2013-01-05", {totalCents: 10_000});
  await executeRefundCreditCardPurchase(actorOf(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    purchaseId: bought.purchaseId,
    expectedUpdatedAt: await purchaseVersion(t.workspaceId, bought.purchaseId),
  }, requestId(), clockAt("2013-01-12"));
  // Janeiro: total 10.000 (faturado); fevereiro: crédito −10.000.
  const first = await runCreditCardInvoiceClosing({today: "2013-01-12"});
  assert.ok(first.closed >= 1);
  const january = await readInvoice(t.workspaceId, cardId, "2013-01");
  assert.equal(january.cycleStatus, "closed");
  assert.equal(january.closedBy, "system:credit-card-closing");
  assert.equal(january.totalCents, 10_000);
  await pay(t, cardId, "2013-01", "2013-01-15", 10_000);
  assert.equal((await readCard(t.workspaceId, cardId)).limitUsedCents,
    -10_000, "crédito a favor depois do pagamento do estornado");

  await runCreditCardInvoiceClosing({today: "2013-02-11"});
  const february = await readInvoice(t.workspaceId, cardId, "2013-02");
  assert.equal(february.cycleStatus, "closed");
  assert.equal(february.totalCents, 0, "o crédito saiu da fatura fechada");
  assert.equal(february.paymentStatus, "paid");
  assert.equal(february.carryoverOutCents, 10_000);
  const march = await readInvoice(t.workspaceId, cardId, "2013-03");
  assert.equal(march.cycleStatus, "open");
  assert.equal(march.totalCents, -10_000);
  const entries = (await entriesOf(t.workspaceId, cardId)) as
    Array<Record<string, unknown>>;
  const carryIn = entries.find((entry) =>
    entry.id === carryoverEntryIdFor(invoiceIdFor(cardId, "2013-02"), "in"));
  assert.ok(carryIn);
  assert.equal(carryIn.amountCents, -10_000);
  assert.equal(carryIn.sourceInvoiceId, invoiceIdFor(cardId, "2013-02"));
  const card = await assertCardInvariants(t.workspaceId, cardId);
  assert.equal(card.limitUsedCents, -10_000, "transporte não mexe no limite");
});

test("P4-A — rotina: além da primeira página, corte sinalizado, retomada e " +
  "reexecução idempotente", async () => {
  const t = await seedCardTenant("PF", "cc-page");
  const cardId = await createCard(t, {closingDay: 10, dueDay: 20});
  // Cinco faturas: dez/2010 a abr/2011.
  await buy(t, cardId, "2010-12-01", {totalCents: 50_000,
    installmentsCount: 5});
  const truncated = await runCreditCardInvoiceClosing({
    today: "2011-04-12", pageSize: 2, maxPages: 1,
  });
  assert.equal(truncated.truncated, true, "corte explícito, não silencioso");
  assert.equal(truncated.closed, 2);
  const resumed = await runCreditCardInvoiceClosing({
    today: "2011-04-12", pageSize: 2, maxPages: 10,
  });
  assert.equal(resumed.truncated, false);
  assert.equal(resumed.closed, 3, "páginas seguintes pelo cursor");
  const invoices = (await invoicesOf(t.workspaceId, cardId)) as
    Array<Record<string, unknown>>;
  assert.equal(invoices.length, 5);
  assert.ok(invoices.every((invoice) => invoice.cycleStatus === "closed"));
  const rerun = await runCreditCardInvoiceClosing({today: "2011-04-12"});
  assert.equal(rerun.closed, 0, "reexecução não grava nada");
  const closedEvents = ((await cardEventsOf(t.workspaceId, cardId)) as
    Array<Record<string, unknown>>).filter((event) =>
    event.operation === "credit_card.invoice_closed");
  assert.equal(closedEvents.length, 5);
  await assertCardInvariants(t.workspaceId, cardId);
});

test("P4-A — rotina concorrente: duas execuções simultâneas fecham cada " +
  "fatura uma única vez, relendo na transação", async () => {
  const t = await seedCardTenant("PF", "cc-conc");
  const cardId = await createCard(t, {closingDay: 10, dueDay: 20});
  await buy(t, cardId, "2012-01-01", {totalCents: 40_000,
    installmentsCount: 4});
  const [a, b] = await Promise.all([
    runCreditCardInvoiceClosing({today: "2012-06-01", requestId: "run-a"}),
    runCreditCardInvoiceClosing({today: "2012-06-01", requestId: "run-b"}),
  ]);
  assert.equal(a.failed + b.failed, 0);
  assert.equal(a.closed + b.closed, 4, "nenhuma fatura fechada duas vezes");
  const closedEvents = ((await cardEventsOf(t.workspaceId, cardId)) as
    Array<Record<string, unknown>>).filter((event) =>
    event.operation === "credit_card.invoice_closed");
  assert.equal(closedEvents.length, 4);
  for (const invoice of (await invoicesOf(t.workspaceId, cardId)) as
    Array<Record<string, unknown>>) {
    assert.equal(invoice.cycleStatus, "closed");
    assert.equal(invoice.revision, 2, "uma única escrita de fechamento");
  }
  await assertCardInvariants(t.workspaceId, cardId);
});

test("P4-A — alertas: fechada, próxima do vencimento e vencida uma vez " +
  "cada; o atraso não é persistido e o 'lida' não volta (P5-D1: estado " +
  "privado, fora do evento)", async () => {
  const t = await seedCardTenant("PF", "cc-alert");
  const cardId = await createCard(t, {closingDay: 10, dueDay: 20,
    name: "Cartão Alerta"});
  await buy(t, cardId, "2014-01-02", {totalCents: 25_000});
  await runCreditCardInvoiceClosing({today: "2014-01-18"});
  const notifications = async () => (await db().collection(
    `workspaces/${t.workspaceId}/notifications`).get()).docs
    .map((doc) => ({id: doc.id, ...doc.data()} as Record<string, unknown>));
  let current = await notifications();
  assert.ok(current.some((item) => item.title === "Fatura fechada"));
  const dueSoon = current.find((item) =>
    item.title === "Fatura próxima do vencimento");
  assert.ok(dueSoon, "vence em 20/01, dentro de 3 dias");
  assert.match(String(dueSoon.message), /Cartão Alerta/);
  assert.match(String(dueSoon.message), /20\/01\/2014/);
  // P5-D1: o evento compartilhado não carrega estado de leitura; ID
  // determinístico por (tipo, fatura).
  for (const item of current) {
    assert.equal("read" in item, false, `${String(item.id)} sem 'read'`);
    assert.match(String(item.id), /^cc(closed|due|overdue)_[0-9a-f]{32}$/);
  }
  // A leitura de um usuário vive no estado privado dele.
  const statePath = `workspaces/${t.workspaceId}/notification_user_states/` +
    `${t.viewer}/notification_entries/${String(dueSoon.id)}`;
  await db().doc(statePath).set({
    read: true, readAt: Timestamp.now(), expiresAt: dueSoon.expiresAt,
  });
  const before = (await db().doc(
    `workspaces/${t.workspaceId}/notifications/${String(dueSoon.id)}`).get())
    .data();
  await runCreditCardInvoiceClosing({today: "2014-01-19"});
  current = await notifications();
  assert.equal(current.filter((item) =>
    item.title === "Fatura próxima do vencimento").length, 1);
  assert.deepEqual(current.find((item) => item.id === dueSoon.id),
    {id: dueSoon.id, ...before}, "o evento não é regravado");
  assert.equal((await db().doc(statePath).get()).get("read"), true,
    "o 'lida' do usuário não volta");
  await runCreditCardInvoiceClosing({today: "2014-01-22"});
  await runCreditCardInvoiceClosing({today: "2014-01-23"});
  current = await notifications();
  assert.equal(current.filter((item) => item.title === "Fatura vencida")
    .length, 1);
  const invoice = await readInvoice(t.workspaceId, cardId, "2014-01");
  assert.equal(invoice.paymentStatus, "unpaid");
  assert.equal(invoice.cycleStatus, "closed", "atraso derivado, não gravado");
});

test("P4-A — reconciliação: limite reparado só quando as duas fontes " +
  "concordam; faturas abertas reparadas, fechadas só relatadas; paginado",
async () => {
  const t = await seedCardTenant("PF", "cc-recon");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-10", {totalCents: 9_000,
    installmentsCount: 3});
  const actor = actorOf(t, t.owner);
  const clean = await executeRecalculateCardLimit(actor,
    {workspaceId: t.workspaceId, cardId}, requestId());
  assert.equal(clean.consistent, true);
  assert.equal(clean.repaired, false);

  // Derivado adulterado: as duas fontes concordam → reparo com evento.
  await cardRef(t.workspaceId, cardId).update({
    limitUsedCents: 1, limitAvailableCents: 499_999,
  });
  const repaired = await executeRecalculateCardLimit(actor,
    {workspaceId: t.workspaceId, cardId}, requestId());
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.ledgerLimitUsedCents, 9_000);
  await assertCardInvariants(t.workspaceId, cardId);

  // Fato adulterado: fontes divergentes → nada é alterado.
  await db().collection(`workspaces/${t.workspaceId}/credit_card_limit_ledger`)
    .doc("ccl_bogus").set({cardId, amountCents: 77, schemaVersion: 1});
  const diverged = await executeRecalculateCardLimit(actor,
    {workspaceId: t.workspaceId, cardId}, requestId());
  assert.equal(diverged.sourcesAgree, false);
  assert.equal(diverged.repaired, false);
  assert.equal((await readCard(t.workspaceId, cardId)).limitUsedCents, 9_000);
  await db().collection(`workspaces/${t.workspaceId}/credit_card_limit_ledger`)
    .doc("ccl_bogus").delete();

  // Faturas: aberta adulterada é reparada; fechada só relatada.
  await pay(t, cardId, "2026-03", "2026-03-26", 3_000);
  const april = invoiceRef(t.workspaceId, invoiceIdFor(cardId, "2026-04"));
  await april.update({totalCents: 1, remainingCents: 1});
  const march = invoiceRef(t.workspaceId, invoiceIdFor(cardId, "2026-03"));
  await march.update({totalCents: 4_000, remainingCents: 1_000,
    paymentStatus: "partial"});
  const page1 = await executeRebuildCardInvoices(actor,
    {workspaceId: t.workspaceId, cardId, pageSize: 2}, requestId());
  assert.equal(page1.processed, 2);
  assert.equal(page1.nextCursor, "2026-04");
  const byId = new Map(page1.items.map((item) => [item.invoiceId, item]));
  assert.equal(byId.get(march.id)?.status, "divergent");
  assert.equal(byId.get(april.id)?.status, "repaired");
  assert.equal((await readDoc(march)).totalCents, 4_000,
    "fatura fechada nunca é reescrita pela reconstrução");
  assert.equal((await readDoc(april)).totalCents, 3_000);
  const page2 = await executeRebuildCardInvoices(actor,
    {workspaceId: t.workspaceId, cardId, pageSize: 2, cursor: "2026-04"},
    requestId());
  assert.equal(page2.processed, 1);
  assert.equal(page2.nextCursor, null);
  assert.equal(page2.items[0].status, "consistent");
  await rejectsWith(executeRecalculateCardLimit(actorOf(t, t.member),
    {workspaceId: t.workspaceId, cardId}, requestId()),
  "workspace_role_denied");
});

test("P4-A — isolamento das faturas nos dois sentidos: fatura, pagamento, " +
  "estorno, ajuste e conta de outro workspace", async () => {
  const a = await seedCardTenant("PF", "cc-iso-a");
  const b = await seedCardTenant("PF", "cc-iso-b");
  const cardA = await createCard(a);
  const cardB = await createCard(b);
  await buy(a, cardA, "2026-03-10", {totalCents: 10_000});
  await buy(b, cardB, "2026-03-10", {totalCents: 7_000});
  const invoiceA = invoiceIdFor(cardA, "2026-03");
  const invoiceB = invoiceIdFor(cardB, "2026-03");
  const paymentAttempt = async (
    actor: CardTenant, workspace: CardTenant, cardId: string,
    invoiceId: string, invoiceOwner: CardTenant, accountOwner: CardTenant,
  ) => executeRegisterInvoicePayment(actorOf(actor, actor.owner), {
    workspaceId: workspace.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId,
    invoiceId,
    cashAccountId: defaultAccountOf(accountOwner.workspaceId),
    amountCents: 1_000,
    paymentDate: "2026-03-27",
    expectedUpdatedAt: await invoiceVersion(invoiceOwner.workspaceId, cardId,
      "2026-03"),
  }, requestId(), clockAt("2026-03-27"));

  // O dono de B, no próprio workspace, com IDs de A: nada encontrado. E o
  // inverso. Os IDs só resolvem no caminho do tenant autorizado.
  await rejectsWith(paymentAttempt(b, b, cardA, invoiceA, a, b), "not_found");
  await rejectsWith(paymentAttempt(a, a, cardB, invoiceB, b, a), "not_found");
  // Conta de origem de outro workspace: recusada nos dois sentidos.
  await rejectsWith(paymentAttempt(a, a, cardA, invoiceA, a, b), "not_found");
  await rejectsWith(paymentAttempt(b, b, cardB, invoiceB, b, a), "not_found");
  // `workspaceId` forjado (o de A, por quem não é membro): negado antes.
  await expectHttpsError(call(registerInvoicePayment, b.owner, {
    workspaceId: a.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId: cardA,
    invoiceId: invoiceA,
    cashAccountId: defaultAccountOf(a.workspaceId),
    amountCents: 1_000,
    paymentDate: "2026-03-27",
    expectedUpdatedAt: await invoiceVersion(a.workspaceId, cardA, "2026-03"),
  }), "permission-denied");
  await expectHttpsError(call(createCreditCardInvoiceAdjustment, a.owner, {
    workspaceId: b.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId: cardB,
    competenceMonth: "2026-04",
    amountCents: 500,
    reason: "Tentativa de outro tenant",
  }), "permission-denied");
  // Ajuste no próprio workspace com o cartão do outro: nada encontrado.
  await rejectsWith(executeCreateInvoiceAdjustment(actorOf(a, a.owner), {
    workspaceId: a.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId: cardB,
    competenceMonth: "2026-04",
    amountCents: 500,
    reason: "Tentativa de outro tenant",
  }, requestId(), clockAt("2026-03-27")), "not_found");

  // Pagamento legítimo em A; o estorno pelo dono de B (no workspace dele ou
  // forjando o de A) não alcança o pagamento.
  const paidA = await pay(a, cardA, "2026-03", "2026-03-27", 4_000);
  await rejectsWith(executeReverseInvoicePayment(actorOf(b, b.owner), {
    workspaceId: b.workspaceId,
    idempotencyKey: idempotencyKey(),
    paymentId: String(paidA.paymentId),
    expectedUpdatedAt: await invoiceVersion(a.workspaceId, cardA, "2026-03"),
  }, requestId(), clockAt("2026-03-27")), "not_found");
  await expectHttpsError(call(reverseInvoicePayment, b.owner, {
    workspaceId: a.workspaceId,
    idempotencyKey: idempotencyKey(),
    paymentId: String(paidA.paymentId),
    expectedUpdatedAt: await invoiceVersion(a.workspaceId, cardA, "2026-03"),
  }), "permission-denied");

  // Estado final: só o pagamento legítimo; nada gravado em B; contas intactas.
  assert.equal((await readInvoice(a.workspaceId, cardA, "2026-03")).paidCents,
    4_000);
  assert.equal((await readInvoice(b.workspaceId, cardB, "2026-03")).paidCents,
    0);
  assert.equal((await db().collection(
    `workspaces/${b.workspaceId}/credit_card_invoice_payments`).get()).size, 0);
  assert.equal((await accountLedger(a.workspaceId,
    defaultAccountOf(a.workspaceId))).balanceCents, -4_000);
  assert.equal((await accountLedger(b.workspaceId,
    defaultAccountOf(b.workspaceId))).balanceCents, 0);
  await assertCardInvariants(a.workspaceId, cardA);
  await assertCardInvariants(b.workspaceId, cardB);
});

test("P4-A — falha antes do commit do pagamento não grava nada (fatura, " +
  "conta, espelho, razão, auditoria); a repetição paga uma vez", async () => {
  const t = await seedCardTenant("PF", "cc-pay-fail");
  const cardId = await createCard(t);
  await buy(t, cardId, "2026-03-10", {totalCents: 8_000});
  const accountId = defaultAccountOf(t.workspaceId);
  const payload = {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId,
    invoiceId: invoiceIdFor(cardId, "2026-03"),
    cashAccountId: accountId,
    amountCents: 8_000,
    paymentDate: "2026-03-27",
    expectedUpdatedAt: await invoiceVersion(t.workspaceId, cardId, "2026-03"),
  };
  const count = async (path: string) =>
    (await db().collection(`workspaces/${t.workspaceId}/${path}`).get()).size;
  const ledgerBefore = await count("credit_card_limit_ledger");
  const eventsBefore = await count("credit_card_events");
  await assert.rejects(executeRegisterInvoicePayment(actorOf(t, t.owner),
    payload, requestId(), {
      ...clockAt("2026-03-27"),
      beforeCommit: () => {
        throw new Error("falha simulada antes do commit");
      },
    }), /falha simulada/);
  // Nem o fechamento tardio, nem o pagamento, nem a conta, nem o espelho.
  const invoice = await readInvoice(t.workspaceId, cardId, "2026-03");
  assert.equal(invoice.cycleStatus, "open");
  assert.equal(invoice.paidCents, 0);
  assert.equal(await count("credit_card_invoice_payments"), 0);
  assert.equal(await count("cash_account_movements"), 0);
  assert.equal((await transactionsOf(t.workspaceId))
    .filter((item) => (item as Record<string, unknown>).creditCardPaymentEntry)
    .length, 0);
  assert.equal(await count("credit_card_limit_ledger"), ledgerBefore);
  assert.equal(await count("credit_card_events"), eventsBefore);
  assert.equal((await accountLedger(t.workspaceId, accountId)).balanceCents, 0);
  assert.equal((await readCard(t.workspaceId, cardId)).limitUsedCents, 8_000);
  // A mesma intenção, sem a falha: um pagamento só.
  const first = await executeRegisterInvoicePayment(actorOf(t, t.owner),
    payload, requestId(), clockAt("2026-03-27"));
  assert.equal(first.replayed, false);
  const replay = await executeRegisterInvoicePayment(actorOf(t, t.owner),
    payload, requestId(), clockAt("2026-03-27"));
  assert.equal(replay.replayed, true);
  assert.equal(await count("credit_card_invoice_payments"), 1);
  assert.equal((await accountLedger(t.workspaceId, accountId)).balanceCents,
    -8_000);
  await assertCardInvariants(t.workspaceId, cardId);
});
