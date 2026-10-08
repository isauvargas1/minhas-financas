import assert from "node:assert/strict";
import test, {after} from "node:test";

import {createCard} from "../../cards/testSupport/cardTestSupport";
import {
  call,
  expectHttpsError,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  confirmRecurringOccurrence,
  ignoreRecurringOccurrence,
  retryRecurringOccurrence,
  updateRecurringExpense,
} from "../callables";
import {
  cleanupRecurring,
  confirmOccurrence,
  contractVersion,
  createContract,
  defaultAccountOf,
  eventsOf,
  ignoreOccurrence,
  occurrencesOf,
  purchasesOf,
  readContract,
  readOccurrence,
  rejectsWith,
  retryOccurrence,
  runOn,
  seedRecurringTenant,
  transactionsOf,
  updateContract,
  type RecurringTenant,
} from "../testSupport/recurringTestSupport";

/**
 * Isolamento entre workspaces (P4-B), nos dois sentidos: nenhuma callable de
 * Recorrentes alcança contrato, ocorrência, cartão ou conta de outro tenant —
 * nem pela pré-checagem do kernel (workspace forjado) nem dentro do próprio
 * workspace (ID de outro tenant não existe aqui). Estado final conferido.
 */
const tenants: RecurringTenant[] = [];
after(() => cleanupRecurring(tenants));

test("ocorrências e contratos de A não são alcançáveis por B, nos dois " +
  "sentidos", async () => {
  const a = await seedRecurringTenant("PF", "rec-iso-a");
  const b = await seedRecurringTenant("PF", "rec-iso-b");
  tenants.push(a, b);
  const {recurringExpenseId: contractA} = await createContract(a, "2026-03-05",
    {executionMode: "confirmation_required"});
  const {recurringExpenseId: contractB} = await createContract(b, "2026-03-05",
    {executionMode: "confirmation_required"});
  await runOn("2026-03-10");
  const [occurrenceA] = await occurrencesOf(a.workspaceId, contractA);
  const [occurrenceB] = await occurrencesOf(b.workspaceId, contractB);

  for (const [attacker, victim, occurrence] of [
    [b, a, occurrenceA], [a, b, occurrenceB],
  ] as const) {
    // Workspace forjado: o kernel recusa quem não é membro.
    const forged = {workspaceId: victim.workspaceId,
      idempotencyKey: idempotencyKey(), occurrenceId: occurrence.id};
    await expectHttpsError(call(confirmRecurringOccurrence, attacker.owner,
      {...forged, settlement: "pending"}), "permission-denied");
    await expectHttpsError(call(ignoreRecurringOccurrence, attacker.owner,
      {...forged, idempotencyKey: idempotencyKey()}), "permission-denied");
    await expectHttpsError(call(retryRecurringOccurrence, attacker.owner,
      {...forged, idempotencyKey: idempotencyKey()}), "permission-denied");
    await expectHttpsError(call(updateRecurringExpense, attacker.owner, {
      workspaceId: victim.workspaceId, idempotencyKey: idempotencyKey(),
      recurringExpenseId: occurrence.recurringExpenseId,
      expectedUpdatedAt: await contractVersion(victim.workspaceId,
        occurrence.recurringExpenseId),
      changes: {amountCents: 1},
    }), "permission-denied");
    // No próprio workspace, o ID do outro tenant não existe.
    await rejectsWith(confirmOccurrence(attacker, occurrence.id, "2026-03-10",
      {settlement: "pending"}), "not_found");
    await rejectsWith(ignoreOccurrence(attacker, occurrence.id, "2026-03-10"),
      "not_found");
    await rejectsWith(retryOccurrence(attacker, occurrence.id, "2026-03-10"),
      "not_found");
    // Nada mudou na vítima nem no atacante.
    assert.equal((await readOccurrence(victim.workspaceId, occurrence.id))
      .status, "awaiting_confirmation");
    assert.equal((await transactionsOf(victim.workspaceId)).length, 0);
    assert.equal((await transactionsOf(attacker.workspaceId)).length, 0);
    assert.equal((await readContract(victim.workspaceId,
      occurrence.recurringExpenseId)).amountCents, 9_990);
    assert.equal((await eventsOf(attacker.workspaceId)).filter((event) =>
      event.occurrenceId === occurrence.id).length, 0);
  }
});

test("cartão e conta de outro workspace não servem de destino", async () => {
  const a = await seedRecurringTenant("PF", "rec-iso-c");
  const b = await seedRecurringTenant("PF", "rec-iso-d");
  tenants.push(a, b);
  const cardB = await createCard(b);
  const accountB = defaultAccountOf(b.workspaceId);
  // Criação em A apontando cartão ou conta de B: não existem em A.
  await rejectsWith(createContract(a, "2026-03-05", {
    paymentMethod: "credit_card", cardId: cardB, cashAccountId: null,
  }), "not_found");
  await rejectsWith(createContract(a, "2026-03-05", {cashAccountId: accountB}),
    "not_found");
  // Edição em A trocando para o cartão de B: recusada, contrato intacto.
  const {recurringExpenseId: id} = await createContract(a, "2026-03-05");
  await rejectsWith(updateContract(a, id, {paymentMethod: "credit_card",
    cardId: cardB, cashAccountId: null}, "2026-03-05"), "not_found");
  assert.equal((await readContract(a.workspaceId, id)).paymentMethod, "pix");
  // Nova tentativa em A com a conta de B: recusada, nada gravado.
  const cardA = await createCard(a, {limitTotalCents: 1_000});
  const {recurringExpenseId: cardContract} = await createContract(a,
    "2026-03-05", {paymentMethod: "credit_card", cardId: cardA,
      cashAccountId: null});
  await runOn("2026-03-10");
  const [attention] = (await occurrencesOf(a.workspaceId, cardContract));
  assert.equal(attention.attentionCode, "limit_insufficient");
  await rejectsWith(retryOccurrence(a, attention.id, "2026-03-11",
    {cardId: cardB}), "not_found");
  assert.equal((await purchasesOf(b.workspaceId)).length, 0);
  assert.equal((await purchasesOf(a.workspaceId)).length, 0);
  assert.equal((await readOccurrence(a.workspaceId, attention.id)).status,
    "attention_required");
});
