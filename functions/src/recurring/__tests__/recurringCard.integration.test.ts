import assert from "node:assert/strict";
import type {DocumentData} from "firebase-admin/firestore";
import test, {after} from "node:test";

import {
  executeArchiveCreditCard,
  executeReactivateCreditCard,
} from "../../cards/cardOperations";
import {
  PURCHASE_GENERATED_FINANCIAL_LOCKED_MESSAGE,
  executeCancelCreditCardPurchase,
  executeUpdateCreditCardPurchase,
} from "../../cards/purchaseOperations";
import {
  assertCardInvariants,
  buy,
  cardEventsOf,
  cardVersion,
  createCard,
  entriesOf,
  purchaseVersion,
  readCard,
  readPurchase,
} from "../../cards/testSupport/cardTestSupport";
import {idempotencyKey} from "../../workspaces/testSupport/p1TestSupport";
import {
  CASH_FIELDS_ON_CARD_MESSAGE,
  OCCURRENCE_ALREADY_RESOLVED_MESSAGE,
} from "../occurrenceOperations";
import {RECURRING_SYSTEM_ACTOR} from "../model";
import {
  actorOf,
  cleanupRecurring,
  clockAt,
  confirmOccurrence,
  createContract,
  occurrencesOf,
  purchasesOf,
  quotaUsed,
  readContract,
  readOccurrence,
  rejectsWith,
  requestId,
  retryOccurrence,
  runOn,
  seedRecurringTenant,
  transactionsOf,
  type RecurringTenant,
} from "../testSupport/recurringTestSupport";

/**
 * Recorrentes no cartão (P4-B): o fato é uma compra P4-A à vista, pela
 * mesma primitiva da compra manual — parcelas, publicação na fatura (com a
 * retroatividade de D-36), reserva do limite, livro do limite e evento. A
 * origem `recurring` só o backend grava. Nada de `parcelado` nem `cardId` em
 * `transactions`; nada consome a quota manual (D-40). No Emulator.
 */
const tenants: RecurringTenant[] = [];
const tenantFor = async () => {
  const tenant = await seedRecurringTenant();
  tenants.push(tenant);
  return tenant;
};
after(() => cleanupRecurring(tenants));

const cardContract = (cardId: string, extra: Record<string, unknown> = {}) => ({
  paymentMethod: "credit_card" as const,
  cardId,
  cashAccountId: null,
  ...extra,
});

const archive = async (tenant: RecurringTenant, cardId: string) =>
  executeArchiveCreditCard(actorOf(tenant, tenant.owner), {
    workspaceId: tenant.workspaceId, idempotencyKey: idempotencyKey(), cardId,
    expectedUpdatedAt: await cardVersion(tenant.workspaceId, cardId),
  }, requestId());

test("automático: uma compra à vista `recurring`, limite e fatura do " +
  "P4-A", async () => {
  const tenant = await tenantFor();
  const cardId = await createCard(tenant);
  const quota = await quotaUsed(tenant.workspaceId, "2026-03");
  const before = await readCard(tenant.workspaceId, cardId);
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05",
    cardContract(cardId), tenant.member, "member");
  await runOn("2026-03-10");

  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  assert.equal(occurrence.status, "generated");
  assert.equal(occurrence.targetDomain, "card");
  assert.equal(occurrence.cashTransactionId, null);
  const purchases = await purchasesOf(tenant.workspaceId);
  assert.equal(purchases.length, 1);
  const [purchase] = purchases;
  assert.equal(purchase.id, occurrence.cardPurchaseId);
  assert.equal(purchase.source, "recurring");
  assert.equal(purchase.recurringExpenseId, id);
  assert.equal(purchase.recurringOccurrenceId, occurrence.id);
  assert.equal(purchase.installmentsCount, 1);
  assert.equal(purchase.totalCents, 9_990);
  assert.equal(purchase.purchaseDate, "2026-03-10");
  assert.equal(purchase.firstCompetence, "2026-03");
  assert.equal(purchase.retroactive, false);
  assert.equal(purchase.description, "Internet");
  // Responsável pela compra: quem criou o contrato.
  assert.equal(purchase.createdBy, tenant.member);
  assert.equal(purchase.intentId, null);
  const after = await readCard(tenant.workspaceId, cardId);
  assert.equal(after.limitUsedCents, before.limitUsedCents + 9_990);
  const entries = (await entriesOf(tenant.workspaceId, cardId))
    .filter((entry) => (entry as Record<string, unknown>).purchaseId ===
      purchase.id);
  assert.equal(entries.length, 1);
  await assertCardInvariants(tenant.workspaceId, cardId);
  const events = await cardEventsOf(tenant.workspaceId, cardId);
  const created = events.find((event) =>
    (event as Record<string, unknown>).operation ===
      "credit_card.purchase_created") as DocumentData;
  assert.equal(created.actorId, RECURRING_SYSTEM_ACTOR);
  assert.equal(created.after.source, "recurring");
  // Nada no Caixa e nada de quota.
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 0);
  assert.equal(await quotaUsed(tenant.workspaceId, "2026-03"), quota);
});

test("vencimento em fatura já fechada: a data fica, a parcela vai para a " +
  "aberta", async () => {
  const tenant = await tenantFor();
  const cardId = await createCard(tenant, {closingDay: 25, dueDay: 5});
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-20",
    cardContract(cardId, {billingDay: 24}));
  // O agendador só alcança o vencimento de 24/03 depois do fechamento (25).
  await runOn("2026-03-27");
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  const purchase = await readPurchase(tenant.workspaceId,
    occurrence.cardPurchaseId);
  assert.equal(purchase.purchaseDate, "2026-03-24");
  assert.equal(purchase.firstCompetence, "2026-04");
  assert.equal(purchase.retroactive, true);
  await assertCardInvariants(tenant.workspaceId, cardId);
});

test("confirmar antes: a compra nasce com o valor real informado", async () => {
  const tenant = await tenantFor();
  const cardId = await createCard(tenant);
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05",
    cardContract(cardId, {executionMode: "confirmation_required"}));
  await runOn("2026-03-10");
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  assert.equal(occurrence.status, "awaiting_confirmation");
  assert.equal((await purchasesOf(tenant.workspaceId)).length, 0);
  await rejectsWith(confirmOccurrence(tenant, occurrence.id, "2026-03-12", {
    settlement: "paid", paidDate: "2026-03-12"}), "invalid_payload",
  CASH_FIELDS_ON_CARD_MESSAGE);
  await confirmOccurrence(tenant, occurrence.id, "2026-03-12",
    {amountCents: 11_111});
  const resolved = await readOccurrence(tenant.workspaceId, occurrence.id);
  assert.equal(resolved.status, "generated");
  assert.equal(resolved.actualAmountCents, 11_111);
  const purchase = await readPurchase(tenant.workspaceId,
    resolved.cardPurchaseId);
  assert.equal(purchase.totalCents, 11_111);
  assert.equal(purchase.purchaseDate, "2026-03-10");
  assert.equal(purchase.source, "recurring");
  assert.equal((await readCard(tenant.workspaceId, cardId)).limitUsedCents,
    11_111);
  await rejectsWith(confirmOccurrence(tenant, occurrence.id, "2026-03-12"),
    "domain_precondition_failed", OCCURRENCE_ALREADY_RESOLVED_MESSAGE);
  assert.equal((await purchasesOf(tenant.workspaceId)).length, 1);
  await assertCardInvariants(tenant.workspaceId, cardId);
});

test("cartão arquivado: atenção sem compra nem limite; reativado, nova " +
  "tentativa gera", async () => {
  const tenant = await tenantFor();
  const cardId = await createCard(tenant);
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05",
    cardContract(cardId));
  await archive(tenant, cardId);
  await runOn("2026-03-10");
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  assert.equal(occurrence.status, "attention_required");
  assert.equal(occurrence.attentionCode, "card_archived");
  assert.equal((await purchasesOf(tenant.workspaceId)).length, 0);
  assert.equal((await readCard(tenant.workspaceId, cardId)).limitUsedCents, 0);
  await rejectsWith(retryOccurrence(tenant, occurrence.id, "2026-03-11"),
    "domain_precondition_failed", /arquivado/);
  await executeReactivateCreditCard(actorOf(tenant, tenant.owner), {
    workspaceId: tenant.workspaceId, idempotencyKey: idempotencyKey(), cardId,
    expectedUpdatedAt: await cardVersion(tenant.workspaceId, cardId),
  }, requestId());
  await retryOccurrence(tenant, occurrence.id, "2026-03-11");
  const resolved = await readOccurrence(tenant.workspaceId, occurrence.id);
  assert.equal(resolved.status, "generated");
  const purchase = await readPurchase(tenant.workspaceId,
    resolved.cardPurchaseId);
  assert.equal(purchase.purchaseDate, "2026-03-10");
  assert.equal((await readContract(tenant.workspaceId, id))
    .openOccurrenceCount, 0);
  await assertCardInvariants(tenant.workspaceId, cardId);
});

test("limite insuficiente: atenção; nova tentativa em outro " +
  "cartão", async () => {
  const tenant = await tenantFor();
  const small = await createCard(tenant, {limitTotalCents: 5_000});
  const big = await createCard(tenant, {name: "Cartão reserva"});
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05",
    cardContract(small));
  await runOn("2026-03-10");
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  assert.equal(occurrence.attentionCode, "limit_insufficient");
  assert.equal((await readCard(tenant.workspaceId, small)).limitUsedCents, 0);
  await retryOccurrence(tenant, occurrence.id, "2026-03-11", {cardId: big});
  const resolved = await readOccurrence(tenant.workspaceId, occurrence.id);
  assert.equal(resolved.cardId, big);
  assert.equal((await readCard(tenant.workspaceId, big)).limitUsedCents, 9_990);
  assert.equal((await readCard(tenant.workspaceId, small)).limitUsedCents, 0);
  await assertCardInvariants(tenant.workspaceId, big);
  await assertCardInvariants(tenant.workspaceId, small);
});

test("compra gerada: valor, data e parcelas travados; cancelar é do " +
  "domínio de cartões", async () => {
  const tenant = await tenantFor();
  const cardId = await createCard(tenant);
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05",
    cardContract(cardId));
  await runOn("2026-03-10");
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  const purchaseId = occurrence.cardPurchaseId as string;
  for (const changes of [{totalCents: 1_000}, {installmentsCount: 3},
    {purchaseDate: "2026-03-09"}]) {
    await rejectsWith(executeUpdateCreditCardPurchase(
      actorOf(tenant, tenant.owner), {
        workspaceId: tenant.workspaceId, idempotencyKey: idempotencyKey(),
        purchaseId,
        expectedUpdatedAt: await purchaseVersion(tenant.workspaceId,
          purchaseId),
        changes,
      }, requestId(), clockAt("2026-03-12")), "domain_precondition_failed",
    PURCHASE_GENERATED_FINANCIAL_LOCKED_MESSAGE);
  }
  // Descritivo continua permitido; a compra manual segue editável.
  await executeUpdateCreditCardPurchase(actorOf(tenant, tenant.owner), {
    workspaceId: tenant.workspaceId, idempotencyKey: idempotencyKey(),
    purchaseId,
    expectedUpdatedAt: await purchaseVersion(tenant.workspaceId, purchaseId),
    changes: {description: "Internet de março"},
  }, requestId(), clockAt("2026-03-12"));
  const manual = await buy(tenant, cardId, "2026-03-12");
  await executeUpdateCreditCardPurchase(actorOf(tenant, tenant.owner), {
    workspaceId: tenant.workspaceId, idempotencyKey: idempotencyKey(),
    purchaseId: manual.purchaseId,
    expectedUpdatedAt: await purchaseVersion(tenant.workspaceId,
      manual.purchaseId),
    changes: {totalCents: 120_000},
  }, requestId(), clockAt("2026-03-12"));
  assert.equal((await readPurchase(tenant.workspaceId, manual.purchaseId))
    .source, "manual");
  // Cancelar a compra gerada é do cartão; a ocorrência continua o vínculo.
  await executeCancelCreditCardPurchase(actorOf(tenant, tenant.owner), {
    workspaceId: tenant.workspaceId, idempotencyKey: idempotencyKey(),
    purchaseId,
    expectedUpdatedAt: await purchaseVersion(tenant.workspaceId, purchaseId),
  }, requestId(), clockAt("2026-03-12"));
  assert.equal((await readPurchase(tenant.workspaceId, purchaseId)).status,
    "cancelled");
  assert.equal((await readOccurrence(tenant.workspaceId, occurrence.id))
    .status, "generated");
  // Reexecutar não gera de novo.
  await runOn("2026-03-12");
  assert.equal((await purchasesOf(tenant.workspaceId)).filter((purchase) =>
    purchase.source === "recurring").length, 1);
  await assertCardInvariants(tenant.workspaceId, cardId);
});
