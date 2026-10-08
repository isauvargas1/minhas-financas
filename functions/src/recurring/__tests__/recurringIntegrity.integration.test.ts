import assert from "node:assert/strict";
import test, {after} from "node:test";

import {movementsOf, assertLedgerConsistent} from
  "../../accounts/testSupport/accountTestSupport";
import {
  assertCardInvariants,
  createCard,
  readCard,
} from "../../cards/testSupport/cardTestSupport";
import {executeVoidCashTransaction} from "../../cash/mutateTransaction";
import {formatIsoInstant} from "../../shared/commitTime";
import {idempotencyKey} from "../../workspaces/testSupport/p1TestSupport";
import {processDueOccurrence} from "../generation";
import {executeConfirmRecurringOccurrence} from "../occurrenceOperations";
import {
  actorOf,
  balanceOf,
  cleanupRecurring,
  clockAt,
  contractRef,
  createContract,
  defaultAccountOf,
  eventsOf,
  occurrencesOf,
  purchasesOf,
  readContract,
  readOccurrence,
  readTransaction,
  requestId,
  runOn,
  seedRecurringTenant,
  transactionRef,
  transactionsOf,
  type RecurringTenant,
} from "../testSupport/recurringTestSupport";

/**
 * Integridade financeira de Recorrentes (P4-B): atomicidade da geração e
 * da confirmação provada com falha injetada antes do commit (nada parcial;
 * a repetição cria um efeito só), anulação do fato pelo domínio dono (P3)
 * sem reescrever a ocorrência e propagação dos campos PJ ao fato. No
 * Emulator.
 */
const tenants: RecurringTenant[] = [];
const tenantFor = async (type: "PF" | "PJ" = "PF") => {
  const tenant = await seedRecurringTenant(type);
  tenants.push(tenant);
  return tenant;
};
after(() => cleanupRecurring(tenants));

const injected = () => {
  throw new Error("falha injetada antes do commit");
};

const cardContract = (cardId: string) => ({
  paymentMethod: "credit_card" as const,
  cardId,
  cashAccountId: null,
});

test("falha antes do commit na geração: nada gravado; a próxima execução " +
  "gera uma vez", async () => {
  const tenant = await tenantFor();
  const account = defaultAccountOf(tenant.workspaceId);
  const balance = await balanceOf(tenant.workspaceId, account);
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05");
  const before = await readContract(tenant.workspaceId, id);
  const eventsBefore = (await eventsOf(tenant.workspaceId, id)).length;

  const failed = await runOn("2026-03-10", {beforeCommit: injected});
  assert.ok(failed.failed >= 1);
  assert.equal((await occurrencesOf(tenant.workspaceId, id)).length, 0);
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 0);
  assert.equal((await eventsOf(tenant.workspaceId, id)).length, eventsBefore);
  const unchanged = await readContract(tenant.workspaceId, id);
  assert.equal(unchanged.nextDueDate, "2026-03-10");
  assert.equal(unchanged.lastProcessedDueDate, before.lastProcessedDueDate);
  assert.equal(unchanged.revision, before.revision);
  assert.equal(unchanged.openOccurrenceCount, before.openOccurrenceCount);
  assert.equal(await balanceOf(tenant.workspaceId, account), balance);

  // A falha é passageira: a execução seguinte retoma do mesmo vencimento.
  await runOn("2026-03-10");
  await runOn("2026-03-10");
  const occurrences = await occurrencesOf(tenant.workspaceId, id);
  assert.deepEqual(occurrences.map((occurrence) =>
    [occurrence.dueDate, occurrence.status]), [["2026-03-10", "generated"]]);
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 1);
  assert.equal((await readContract(tenant.workspaceId, id)).nextDueDate,
    "2026-04-10");
});

test("falha antes do commit na geração no cartão: sem compra nem limite " +
  "reservado", async () => {
  const tenant = await tenantFor();
  const cardId = await createCard(tenant);
  const card = await readCard(tenant.workspaceId, cardId);
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05",
    cardContract(cardId));
  const ref = contractRef(tenant.workspaceId, id);
  await assert.rejects(processDueOccurrence(ref, "2026-03-10", "2026-03-10",
    requestId(), {beforeCommit: injected}), /falha injetada/);
  assert.equal((await purchasesOf(tenant.workspaceId)).length, 0);
  assert.equal((await occurrencesOf(tenant.workspaceId, id)).length, 0);
  assert.equal((await readCard(tenant.workspaceId, cardId)).limitUsedCents,
    card.limitUsedCents);
  assert.equal((await readContract(tenant.workspaceId, id)).nextDueDate,
    "2026-03-10");

  const outcome = await processDueOccurrence(ref, "2026-03-10", "2026-03-10",
    requestId());
  assert.equal(outcome.status, "processed");
  assert.equal((await purchasesOf(tenant.workspaceId)).length, 1);
  assert.equal((await readCard(tenant.workspaceId, cardId)).limitUsedCents,
    card.limitUsedCents + 9_990);
  await assertCardInvariants(tenant.workspaceId, cardId);
});

test("falha antes do commit na confirmação no cartão: nada; a mesma " +
  "intenção depois confirma uma vez", async () => {
  const tenant = await tenantFor();
  const cardId = await createCard(tenant);
  const card = await readCard(tenant.workspaceId, cardId);
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05", {
    ...cardContract(cardId), executionMode: "confirmation_required",
  });
  await runOn("2026-03-10");
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  const actor = actorOf(tenant, tenant.owner);
  const payload = {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    occurrenceId: occurrence.id,
    amountCents: 10_450,
  };
  await assert.rejects(executeConfirmRecurringOccurrence(actor, payload,
    requestId(), {...clockAt("2026-03-10"), beforeCommit: injected}),
  /falha injetada/);
  assert.equal((await purchasesOf(tenant.workspaceId)).length, 0);
  assert.equal((await readCard(tenant.workspaceId, cardId)).limitUsedCents,
    card.limitUsedCents);
  const pending = await readOccurrence(tenant.workspaceId, occurrence.id);
  assert.equal(pending.status, "awaiting_confirmation");
  assert.equal(pending.cardPurchaseId, null);
  assert.equal((await readContract(tenant.workspaceId, id))
    .openOccurrenceCount, 1);

  const confirmed = await executeConfirmRecurringOccurrence(actor, payload,
    requestId(), clockAt("2026-03-10"));
  assert.equal(confirmed.replayed, false);
  const replay = await executeConfirmRecurringOccurrence(actor, payload,
    requestId(), clockAt("2026-03-10"));
  assert.equal(replay.replayed, true);
  const purchases = await purchasesOf(tenant.workspaceId);
  assert.equal(purchases.length, 1);
  assert.equal(purchases[0].totalCents, 10_450);
  assert.equal((await readCard(tenant.workspaceId, cardId)).limitUsedCents,
    card.limitUsedCents + 10_450);
  assert.equal((await readContract(tenant.workspaceId, id))
    .openOccurrenceCount, 0);
  await assertCardInvariants(tenant.workspaceId, cardId);
});

test("falha antes do commit no \"registrar como paga\": sem lançamento " +
  "nem movimento de conta", async () => {
  const tenant = await tenantFor();
  const account = defaultAccountOf(tenant.workspaceId);
  const balance = await balanceOf(tenant.workspaceId, account);
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05", {
    executionMode: "confirmation_required",
  });
  await runOn("2026-03-10");
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  const actor = actorOf(tenant, tenant.owner);
  const payload = {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    occurrenceId: occurrence.id,
    settlement: "paid" as const,
    paidDate: "2026-03-10",
  };
  const movements = (await movementsOf(tenant.workspaceId, account)).length;
  await assert.rejects(executeConfirmRecurringOccurrence(actor, payload,
    requestId(), {...clockAt("2026-03-10"), beforeCommit: injected}),
  /falha injetada/);
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 0);
  assert.equal((await movementsOf(tenant.workspaceId, account)).length,
    movements);
  assert.equal(await balanceOf(tenant.workspaceId, account), balance);
  assert.equal((await readOccurrence(tenant.workspaceId, occurrence.id))
    .status, "awaiting_confirmation");

  await executeConfirmRecurringOccurrence(actor, payload, requestId(),
    clockAt("2026-03-10"));
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 1);
  assert.equal(await balanceOf(tenant.workspaceId, account), balance - 9_990);
  await assertLedgerConsistent(tenant.workspaceId);
});

test("anular o lançamento gerado é do Caixa (P3): ocorrência intacta, " +
  "nada regerado", async () => {
  const tenant = await tenantFor();
  const account = defaultAccountOf(tenant.workspaceId);
  const balance = await balanceOf(tenant.workspaceId, account);
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05");
  await runOn("2026-03-10");
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  const snapshot = await transactionRef(tenant.workspaceId,
    occurrence.cashTransactionId).get();
  await executeVoidCashTransaction(actorOf(tenant, tenant.owner), {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId: occurrence.cashTransactionId,
    expectedUpdatedAt: formatIsoInstant(snapshot.get("updatedAt")),
    reason: "Cobrança contestada",
  }, requestId());

  // O fato muda de estado no domínio dono; nada é apagado.
  const entry = await readTransaction(tenant.workspaceId,
    occurrence.cashTransactionId);
  assert.equal(entry.cashEntry.status, "voided");
  assert.deepEqual(entry.recurringEntry, {domainVersion: 1,
    recurringExpenseId: id, occurrenceId: occurrence.id});
  // A ocorrência continua o vínculo histórico, e o vencimento não volta.
  const same = await readOccurrence(tenant.workspaceId, occurrence.id);
  assert.equal(same.status, "generated");
  assert.equal(same.cashTransactionId, occurrence.cashTransactionId);
  await runOn("2026-03-10");
  assert.equal((await occurrencesOf(tenant.workspaceId, id)).length, 1);
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 1);
  assert.equal((await readContract(tenant.workspaceId, id)).nextDueDate,
    "2026-04-10");
  assert.equal(await balanceOf(tenant.workspaceId, account), balance);
  await assertLedgerConsistent(tenant.workspaceId);
});

test("PJ: fornecedor e centro de custo chegam ao lançamento e à " +
  "compra", async () => {
  const tenant = await tenantFor("PJ");
  const business = {
    supplier: "Fornecedor Nuvem", businessType: "saas" as const,
    costCenter: "Tecnologia", responsible: "Financeiro",
    adjustmentDate: null, commitment: null,
  };
  const {recurringExpenseId: cashId} = await createContract(tenant,
    "2026-03-05", {business});
  const cardId = await createCard(tenant);
  const {recurringExpenseId: cardContractId} = await createContract(tenant,
    "2026-03-05", {...cardContract(cardId), business, name: "Servidor"});
  await runOn("2026-03-10");

  const [cashOccurrence] = await occurrencesOf(tenant.workspaceId, cashId);
  const entry = await readTransaction(tenant.workspaceId,
    cashOccurrence.cashTransactionId);
  assert.equal(entry.supplier, "Fornecedor Nuvem");
  assert.equal(entry.costCenter, "Tecnologia");
  const [cardOccurrence] = await occurrencesOf(tenant.workspaceId,
    cardContractId);
  const [purchase] = (await purchasesOf(tenant.workspaceId))
    .filter((item) => item.id === cardOccurrence.cardPurchaseId);
  assert.equal(purchase.supplier, "Fornecedor Nuvem");
  assert.equal(purchase.costCenter, "Tecnologia");
});
