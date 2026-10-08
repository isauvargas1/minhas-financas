import assert from "node:assert/strict";
import test, {after} from "node:test";

import {
  assertCardInvariants,
  createCard,
  readCard,
} from "../../cards/testSupport/cardTestSupport";
import {idempotencyKey} from "../../workspaces/testSupport/p1TestSupport";
import {processDueOccurrence} from "../generation";
import {executeConfirmRecurringOccurrence} from "../occurrenceOperations";
import {
  actorOf,
  cancelContract,
  cleanupRecurring,
  clockAt,
  confirmOccurrence,
  contractRef,
  createContract,
  occurrencesOf,
  pauseContract,
  purchasesOf,
  readContract,
  readOccurrence,
  requestId,
  runOn,
  seedRecurringTenant,
  transactionsOf,
  updateContract,
  type RecurringTenant,
} from "../testSupport/recurringTestSupport";

/**
 * Concorrência de Recorrentes (P4-B): no máximo um fato financeiro por
 * ocorrência, qualquer que seja a ordem entre agendador, ações do usuário,
 * edição, pausa e cancelamento. As transações do Firestore serializam; as
 * guardas são a releitura do contrato e da ocorrência, os IDs determinísticos
 * criados com `create` e a idempotência por ator. No Emulator.
 */
const tenants: RecurringTenant[] = [];
const tenantFor = async () => {
  const tenant = await seedRecurringTenant();
  tenants.push(tenant);
  return tenant;
};
after(() => cleanupRecurring(tenants));

const settle = (promises: Promise<unknown>[]) => Promise.allSettled(promises);

test("duas execuções do agendador ao mesmo tempo: um fato por " +
  "vencimento", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-01-05", {
    frequency: "weekly", billingDay: null, startDate: "2026-01-05",
  });
  const results = await settle([runOn("2026-02-02"), runOn("2026-02-02"),
    runOn("2026-02-02")]);
  assert.ok(results.every((result) => result.status === "fulfilled"));
  const occurrences = await occurrencesOf(tenant.workspaceId, id);
  assert.deepEqual(occurrences.map((occurrence) => occurrence.dueDate), [
    "2026-01-05", "2026-01-12", "2026-01-19", "2026-01-26", "2026-02-02",
  ]);
  const entries = await transactionsOf(tenant.workspaceId);
  assert.equal(entries.length, 5);
  assert.equal(new Set(entries.map((entry) =>
    entry.recurringEntry.occurrenceId)).size, 5);
  const contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.lastProcessedDueDate, "2026-02-02");
  assert.equal(contract.nextDueDate, "2026-02-09");
});

test("a mesma unidade do agendador disputada: um processa, os outros " +
  "desistem", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05");
  const ref = contractRef(tenant.workspaceId, id);
  const outcomes = await Promise.all([1, 2, 3, 4].map(() =>
    processDueOccurrence(ref, "2026-03-10", "2026-03-10", requestId())));
  assert.equal(outcomes.filter((outcome) =>
    outcome.status === "processed").length, 1);
  assert.equal((await occurrencesOf(tenant.workspaceId, id)).length, 1);
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 1);
});

test("agendador × confirmação manual: cada um no seu vencimento, sem " +
  "duplicar", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-01", {
    frequency: "weekly", billingDay: null, startDate: "2026-03-02",
    executionMode: "confirmation_required",
  });
  await runOn("2026-03-02");
  const [first] = await occurrencesOf(tenant.workspaceId, id);
  await Promise.all([
    runOn("2026-03-09"),
    confirmOccurrence(tenant, first.id, "2026-03-09", {settlement: "pending"}),
  ]);
  const occurrences = await occurrencesOf(tenant.workspaceId, id);
  assert.deepEqual(occurrences.map((occurrence) =>
    [occurrence.dueDate, occurrence.status]), [
    ["2026-03-02", "generated"], ["2026-03-09", "awaiting_confirmation"],
  ]);
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 1);
  assert.equal((await readContract(tenant.workspaceId, id))
    .openOccurrenceCount, 1);
});

test("duplo clique com a mesma chave: um fato; a repetição é " +
  "replay", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05", {
    executionMode: "confirmation_required",
  });
  await runOn("2026-03-10");
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  const payload = {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    occurrenceId: occurrence.id,
    settlement: "paid" as const,
    paidDate: "2026-03-10",
  };
  const actor = actorOf(tenant, tenant.owner);
  const results = await Promise.all([1, 2, 3].map(() =>
    executeConfirmRecurringOccurrence(actor, payload, requestId(),
      clockAt("2026-03-10"))));
  assert.equal(results.filter((result) => !result.replayed).length, 1);
  assert.ok(results.every((result) => result.occurrenceId === occurrence.id));
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 1);

  // Resposta incerta: o cliente reenvia a mesma intenção — replay, nada novo.
  const retried = await executeConfirmRecurringOccurrence(actor, payload,
    requestId(), clockAt("2026-03-10"));
  assert.equal(retried.replayed, true);
  // Mesma chave com outro conteúdo: conflito.
  await assert.rejects(executeConfirmRecurringOccurrence(actor,
    {...payload, paidDate: "2026-03-09"}, requestId(), clockAt("2026-03-10")),
  (error: {code?: string}) => error.code === "idempotency_conflict");
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 1);
});

test("duplo clique com chaves diferentes: o segundo encontra a ocorrência " +
  "resolvida", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05", {
    executionMode: "confirmation_required",
  });
  await runOn("2026-03-10");
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  const results = await settle([
    confirmOccurrence(tenant, occurrence.id, "2026-03-10",
      {settlement: "pending"}),
    confirmOccurrence(tenant, occurrence.id, "2026-03-10",
      {settlement: "paid", paidDate: "2026-03-10"}),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled")
    .length, 1);
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 1);
  assert.equal((await readContract(tenant.workspaceId, id))
    .openOccurrenceCount, 0);
});

test("edição durante a geração: uma ocorrência, com o valor da revisão " +
  "que valeu", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05");
  const results = await settle([
    runOn("2026-03-10"),
    updateContract(tenant, id, {amountCents: 20_000}, "2026-03-10"),
  ]);
  assert.equal(results[0].status, "fulfilled");
  const occurrences = await occurrencesOf(tenant.workspaceId, id);
  assert.equal(occurrences.filter((occurrence) =>
    occurrence.dueDate === "2026-03-10").length, 1);
  const [occurrence] = occurrences;
  const entries = await transactionsOf(tenant.workspaceId);
  assert.equal(entries.length, 1);
  // O lançamento é coerente com a revisão registrada na ocorrência.
  assert.equal(entries[0].valueCents, occurrence.plannedAmountCents);
  assert.ok([9_990, 20_000].includes(occurrence.plannedAmountCents));
  assert.equal(occurrence.contractRevision,
    occurrence.plannedAmountCents === 9_990 ? 1 : 2);
});

/**
 * A pausa leva a versão lida pelo cliente (`expectedUpdatedAt`). Se a geração
 * grava primeiro, essa versão ficou velha e a pausa é recusada com
 * `concurrent_update`, sem efeito parcial — é a concorrência otimista, não
 * uma falha. As duas ordens são válidas; cada uma tem seu estado exato.
 */
const conflictCode = (result: PromiseSettledResult<unknown>) =>
  result.status === "rejected" ?
    (result.reason as {code?: string}).code : undefined;

test("pausa durante a geração: no máximo um fato; a pausa vale ou é " +
  "recusada pela versão", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05");
  const [generated, paused] = await settle([
    runOn("2026-03-10"),
    pauseContract(tenant, id, "2026-03-10"),
  ]);
  assert.equal(generated.status, "fulfilled");
  const contract = await readContract(tenant.workspaceId, id);
  const occurrences = await occurrencesOf(tenant.workspaceId, id);
  assert.ok(occurrences.length <= 1);
  assert.equal((await transactionsOf(tenant.workspaceId)).length,
    occurrences.length);
  if (paused.status === "fulfilled") {
    assert.equal(contract.status, "paused");
    assert.equal(contract.nextDueDate, null);
  } else {
    // A geração gravou antes: o vencimento saiu uma vez e o contrato segue.
    assert.equal(conflictCode(paused), "concurrent_update");
    assert.equal(contract.status, "active");
    assert.equal(occurrences.length, 1);
    assert.equal(contract.nextDueDate, "2026-04-10");
  }
});

test("cancelamento concorrente com confirmação: nunca dois fatos", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05", {
    executionMode: "confirmation_required",
  });
  await runOn("2026-03-10");
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  const [cancelled, confirmed] = await settle([
    cancelContract(tenant, id, "2026-03-10"),
    confirmOccurrence(tenant, occurrence.id, "2026-03-10",
      {settlement: "pending"}),
  ]);
  // Nunca os dois recusados: cada recusa só acontece se o outro gravou antes.
  assert.ok(cancelled.status === "fulfilled" ||
    confirmed.status === "fulfilled");
  const resolved = await readOccurrence(tenant.workspaceId, occurrence.id);
  const entries = await transactionsOf(tenant.workspaceId);
  if (confirmed.status === "fulfilled") {
    assert.equal(resolved.status, "generated");
    assert.equal(entries.length, 1);
  } else {
    assert.equal(resolved.status, "awaiting_confirmation");
    assert.equal(entries.length, 0);
  }
  const contract = await readContract(tenant.workspaceId, id);
  if (cancelled.status === "fulfilled") {
    assert.equal(contract.status, "cancelled");
    assert.equal(contract.nextDueDate, null);
  } else {
    // A confirmação gravou antes (e mudou o contador do contrato): o
    // cancelamento com a versão anterior é recusado, sem efeito parcial.
    assert.equal(conflictCode(cancelled), "concurrent_update");
    assert.equal(contract.status, "active");
  }
});

test("o último centavo do limite: só uma recorrência gera, a outra exige " +
  "atenção", async () => {
  const tenant = await tenantFor();
  const cardId = await createCard(tenant, {limitTotalCents: 10_000});
  const ids = [];
  for (let index = 0; index < 2; index += 1) {
    ids.push((await createContract(tenant, "2026-03-05", {
      paymentMethod: "credit_card", cardId, cashAccountId: null,
      amountCents: 6_000,
    })).recurringExpenseId);
  }
  await Promise.all(ids.map((id) => processDueOccurrence(
    contractRef(tenant.workspaceId, id), "2026-03-10", "2026-03-10",
    requestId())));
  const statuses = [];
  for (const id of ids) {
    const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
    statuses.push(occurrence.status === "generated" ? "generated" :
      occurrence.attentionCode);
  }
  assert.deepEqual(statuses.sort(), ["generated", "limit_insufficient"]);
  assert.equal((await purchasesOf(tenant.workspaceId)).length, 1);
  const card = await readCard(tenant.workspaceId, cardId);
  assert.equal(card.limitUsedCents, 6_000);
  await assertCardInvariants(tenant.workspaceId, cardId);
});
