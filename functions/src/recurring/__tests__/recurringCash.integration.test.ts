import assert from "node:assert/strict";
import test, {after} from "node:test";

import {
  archiveAccount,
  assertLedgerConsistent,
  createAccountPayload,
  movementsOf,
  newAccount,
  statusPayload,
} from "../../accounts/testSupport/accountTestSupport";
import {classifyCashEntryEligibility} from "../../cash/eligibility";
import {executeConfirmCashTransaction} from "../../cash/mutateTransaction";
import {formatIsoInstant} from "../../shared/commitTime";
import {db, idempotencyKey} from "../../workspaces/testSupport/p1TestSupport";
import {
  CANCELLED_CONTRACT_MESSAGE,
  OCCURRENCE_ALREADY_RESOLVED_MESSAGE,
  SETTLEMENT_REQUIRED_MESSAGE,
} from "../occurrenceOperations";
import {MEMBER_OWNERSHIP_MESSAGE} from "../common";
import {RECURRING_SYSTEM_ACTOR} from "../model";
import {
  actorOf,
  balanceOf,
  cancelContract,
  cleanupRecurring,
  confirmOccurrence,
  createContract,
  defaultAccountOf,
  ignoreOccurrence,
  occurrencesOf,
  quotaUsed,
  readContract,
  readOccurrence,
  readTransaction,
  rejectsWith,
  requestId,
  retryOccurrence,
  runOn,
  seedRecurringTenant,
  transactionRef,
  transactionsOf,
  type RecurringTenant,
} from "../testSupport/recurringTestSupport";

/**
 * Recorrentes fora do cartão (P4-B): o fato é sempre um lançamento do Caixa
 * (P3), nunca um segundo ledger. Automático gera a obrigação pendente, sem
 * mover conta; pagar é a confirmação P3-F ou o "registrar como paga" da
 * ocorrência, com o movimento de conta no mesmo commit. Nada consome a
 * quota `transactionsPerMonth` (D-40). No Emulator.
 */
const tenants: RecurringTenant[] = [];
const tenantFor = async (type: "PF" | "PJ" = "PF") => {
  const tenant = await seedRecurringTenant(type);
  tenants.push(tenant);
  return tenant;
};
after(() => cleanupRecurring(tenants));

const MONTH = "2026-03";

test("automático: despesa pendente no Caixa, sem mover conta nem consumir " +
  "quota", async () => {
  const tenant = await tenantFor();
  const account = defaultAccountOf(tenant.workspaceId);
  const balance = await balanceOf(tenant.workspaceId, account);
  const quota = await quotaUsed(tenant.workspaceId, MONTH);
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05",
    {}, tenant.member, "member");
  await runOn("2026-03-10");

  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  assert.equal(occurrence.status, "generated");
  assert.equal(occurrence.targetDomain, "cash");
  assert.equal(occurrence.dueDate, "2026-03-10");
  assert.equal(occurrence.competenceMonth, "2026-03");
  assert.equal(occurrence.plannedAmountCents, 9_990);
  assert.equal(occurrence.actualAmountCents, 9_990);
  assert.equal(occurrence.settlement, "pending");
  assert.equal(occurrence.cardPurchaseId, null);

  const entry = await readTransaction(tenant.workspaceId,
    occurrence.cashTransactionId);
  assert.equal(entry.type, "despesa");
  assert.equal(entry.isPaid, false);
  assert.equal(entry.dueDate, "2026-03-10");
  assert.equal(entry.date, "2026-03-10");
  assert.equal(entry.valueCents, 9_990);
  assert.equal(entry.cashAccountId, account);
  assert.equal(entry.paymentMethod, "Pix");
  assert.equal(entry.expenseType, "Recorrente");
  assert.equal(entry.description, "Internet");
  // Responsável: quem criou o contrato; executor: o agendador.
  assert.equal(entry.userId, tenant.member);
  assert.equal(entry.createdBy, RECURRING_SYSTEM_ACTOR);
  assert.equal(entry.cashEntry.origin, "recurring");
  assert.equal(entry.cashEntry.status, "pending");
  assert.equal(entry.cashEntry.quotaPeriod, null);
  assert.equal(entry.cashEntry.accountMovementId, null);
  assert.deepEqual(entry.recurringEntry, {domainVersion: 1,
    recurringExpenseId: id, occurrenceId: occurrence.id});
  // Nada de cartão nem parcelado em `transactions` (PR-TX-06).
  assert.equal(entry.cardId, undefined);
  assert.equal(entry.installments, undefined);
  // Pendente não move conta; a quota manual não é consumida (D-40).
  assert.equal(await balanceOf(tenant.workspaceId, account), balance);
  assert.ok(!(await movementsOf(tenant.workspaceId)).some((movement) =>
    movement.sourceId === occurrence.cashTransactionId));
  assert.equal(await quotaUsed(tenant.workspaceId, MONTH), quota);
  // É um lançamento do Caixa elegível às callables P3.
  const eligibility = classifyCashEntryEligibility(entry, tenant.workspaceId);
  assert.equal(eligibility.eligible, true);

  // O membro responsável paga pelo Caixa (confirmação P3-F): conta move.
  const snapshot = await transactionRef(tenant.workspaceId,
    occurrence.cashTransactionId).get();
  const member = actorOf(tenant, tenant.member, "member");
  await executeConfirmCashTransaction(member, {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId: occurrence.cashTransactionId,
    expectedUpdatedAt: formatIsoInstant(snapshot.get("updatedAt")),
    date: "2026-03-11",
    amountCents: 9_990,
  }, requestId());
  assert.equal(await balanceOf(tenant.workspaceId, account), balance - 9_990);
  await assertLedgerConsistent(tenant.workspaceId);
  assert.equal(await quotaUsed(tenant.workspaceId, MONTH), quota);
  // A ocorrência continua sendo o vínculo; o estado do fato é do Caixa.
  assert.equal((await readOccurrence(tenant.workspaceId, occurrence.id))
    .status, "generated");
});

test("confirmar antes: aguarda; pagar agora move a conta escolhida com o " +
  "valor real", async () => {
  const tenant = await tenantFor();
  const main = defaultAccountOf(tenant.workspaceId);
  const {accountId: savings} = await newAccount(tenant.owner,
    createAccountPayload(tenant.workspaceId, {name: "Poupança",
      accountType: "savings", openingBalanceCents: 50_000}));
  const quota = await quotaUsed(tenant.workspaceId, MONTH);
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05", {
    executionMode: "confirmation_required",
  });
  await runOn("2026-03-10");
  let contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.openOccurrenceCount, 1);
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  assert.equal(occurrence.status, "awaiting_confirmation");
  assert.equal(occurrence.cashTransactionId, null);
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 0);

  await rejectsWith(confirmOccurrence(tenant, occurrence.id, "2026-03-12"),
    "invalid_payload", SETTLEMENT_REQUIRED_MESSAGE);
  const mainBefore = await balanceOf(tenant.workspaceId, main);
  await confirmOccurrence(tenant, occurrence.id, "2026-03-12", {
    settlement: "paid", paidDate: "2026-03-11", amountCents: 10_450,
    cashAccountId: savings,
  });
  const resolved = await readOccurrence(tenant.workspaceId, occurrence.id);
  assert.equal(resolved.status, "generated");
  assert.equal(resolved.actualAmountCents, 10_450);
  assert.equal(resolved.plannedAmountCents, 9_990);
  assert.equal(resolved.settlement, "paid");
  assert.equal(resolved.cashAccountId, savings);
  assert.equal(resolved.resolvedBy, tenant.owner);
  const entry = await readTransaction(tenant.workspaceId,
    resolved.cashTransactionId);
  assert.equal(entry.isPaid, true);
  assert.equal(entry.date, "2026-03-11");
  assert.equal(entry.valueCents, 10_450);
  assert.equal(entry.cashEntry.status, "confirmed");
  assert.equal(entry.createdBy, tenant.owner);
  assert.equal(await balanceOf(tenant.workspaceId, savings), 50_000 - 10_450);
  assert.equal(await balanceOf(tenant.workspaceId, main), mainBefore);
  await assertLedgerConsistent(tenant.workspaceId);
  assert.equal(await quotaUsed(tenant.workspaceId, MONTH), quota);
  contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.openOccurrenceCount, 0);
  // Uma segunda confirmação não cria outro fato.
  await rejectsWith(confirmOccurrence(tenant, occurrence.id, "2026-03-12", {
    settlement: "paid", paidDate: "2026-03-11",
  }), "domain_precondition_failed", OCCURRENCE_ALREADY_RESOLVED_MESSAGE);
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 1);
});

test("confirmar antes: gerar como pendente não move conta", async () => {
  const tenant = await tenantFor();
  const account = defaultAccountOf(tenant.workspaceId);
  const balance = await balanceOf(tenant.workspaceId, account);
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05", {
    executionMode: "confirmation_required",
  });
  await runOn("2026-03-10");
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  await confirmOccurrence(tenant, occurrence.id, "2026-03-12", {
    settlement: "pending",
  });
  const resolved = await readOccurrence(tenant.workspaceId, occurrence.id);
  const entry = await readTransaction(tenant.workspaceId,
    resolved.cashTransactionId);
  assert.equal(entry.isPaid, false);
  assert.equal(entry.dueDate, "2026-03-10");
  assert.equal(entry.cashEntry.accountMovementId, null);
  assert.equal(resolved.settlement, "pending");
  assert.equal(await balanceOf(tenant.workspaceId, account), balance);
});

test("conta arquivada: atenção com código seguro, nenhum fato; nova " +
  "tentativa em outra conta", async () => {
  const tenant = await tenantFor();
  const account = defaultAccountOf(tenant.workspaceId);
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05");
  await archiveAccount(tenant.owner, await statusPayload(tenant.workspaceId,
    account));
  const summary = await runOn("2026-03-10");
  assert.ok((summary.attentionCodes.account_archived ?? 0) >= 1);
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  assert.equal(occurrence.status, "attention_required");
  assert.equal(occurrence.attentionCode, "account_archived");
  assert.equal(occurrence.cashTransactionId, null);
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 0);
  // O contrato avança: o próximo vencimento não fica preso.
  const contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.nextDueDate, "2026-04-10");
  assert.equal(contract.openOccurrenceCount, 1);
  // Persistindo o impedimento, a nova tentativa volta o erro e nada grava.
  await rejectsWith(retryOccurrence(tenant, occurrence.id, "2026-03-11"),
    "domain_precondition_failed", /arquivada/);
  const {accountId: other} = await newAccount(tenant.owner,
    createAccountPayload(tenant.workspaceId, {name: "Conta nova"}));
  await retryOccurrence(tenant, occurrence.id, "2026-03-11",
    {cashAccountId: other});
  const resolved = await readOccurrence(tenant.workspaceId, occurrence.id);
  assert.equal(resolved.status, "generated");
  assert.equal(resolved.attentionCode, null);
  assert.equal(resolved.cashAccountId, other);
  const entry = await readTransaction(tenant.workspaceId,
    resolved.cashTransactionId);
  assert.equal(entry.cashAccountId, other);
  assert.equal(entry.isPaid, false);
  assert.equal((await readContract(tenant.workspaceId, id))
    .openOccurrenceCount, 0);
});

test("ignorar: terminal, sem fato; recorrência cancelada só " +
  "ignora", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05", {
    executionMode: "confirmation_required",
    frequency: "weekly", billingDay: null, startDate: "2026-03-02",
  });
  await runOn("2026-03-16");
  const [first, second] = await occurrencesOf(tenant.workspaceId, id);
  assert.equal((await readContract(tenant.workspaceId, id))
    .openOccurrenceCount, 2);
  await ignoreOccurrence(tenant, first.id, "2026-03-16");
  assert.equal((await readOccurrence(tenant.workspaceId, first.id)).status,
    "ignored");
  await rejectsWith(ignoreOccurrence(tenant, first.id, "2026-03-16"),
    "domain_precondition_failed", OCCURRENCE_ALREADY_RESOLVED_MESSAGE);
  await cancelContract(tenant, id, "2026-03-16");
  await rejectsWith(confirmOccurrence(tenant, second.id, "2026-03-16", {
    settlement: "pending"}), "domain_precondition_failed",
  CANCELLED_CONTRACT_MESSAGE);
  await ignoreOccurrence(tenant, second.id, "2026-03-16");
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 0);
  assert.equal((await readContract(tenant.workspaceId, id))
    .openOccurrenceCount, 0);
});

test("RBAC nas ocorrências: member só nas próprias; viewer nunca", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: ownerId} = await createContract(tenant,
    "2026-03-05", {executionMode: "confirmation_required"});
  const {recurringExpenseId: memberId} = await createContract(tenant,
    "2026-03-05", {executionMode: "confirmation_required"}, tenant.member,
    "member");
  await runOn("2026-03-10");
  const [ownerOccurrence] = await occurrencesOf(tenant.workspaceId, ownerId);
  const [memberOccurrence] = await occurrencesOf(tenant.workspaceId, memberId);
  await rejectsWith(confirmOccurrence(tenant, ownerOccurrence.id, "2026-03-10",
    {settlement: "pending"}, tenant.member, "member"), "permission_denied",
  MEMBER_OWNERSHIP_MESSAGE);
  await rejectsWith(ignoreOccurrence(tenant, memberOccurrence.id, "2026-03-10",
    tenant.viewer, "viewer"), "workspace_role_denied");
  await confirmOccurrence(tenant, memberOccurrence.id, "2026-03-10",
    {settlement: "pending"}, tenant.member, "member");
  // Admin resolve a do owner.
  await ignoreOccurrence(tenant, ownerOccurrence.id, "2026-03-10",
    tenant.admin, "admin");
});

test("workspace arquivado no vencimento: atenção, sem fato", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05");
  await db().doc(`workspaces/${tenant.workspaceId}`).update({
    status: "archived"});
  await runOn("2026-03-10");
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  assert.equal(occurrence.status, "attention_required");
  assert.equal(occurrence.attentionCode, "workspace_unavailable");
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 0);
  await db().doc(`workspaces/${tenant.workspaceId}`).update({
    status: "active"});
  await retryOccurrence(tenant, occurrence.id, "2026-03-11");
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 1);
});

test("semanal e quinzenal: uma ocorrência e um lançamento por " +
  "vencimento", async () => {
  const tenant = await tenantFor();
  const quota = await quotaUsed(tenant.workspaceId, MONTH);
  const {recurringExpenseId: weekly} = await createContract(tenant,
    "2026-03-01", {frequency: "weekly", billingDay: null,
      startDate: "2026-03-02"});
  const {recurringExpenseId: biweekly} = await createContract(tenant,
    "2026-01-01", {frequency: "biweekly", billingDay: null,
      startDate: "2026-01-01", amountCents: 5_000});
  // Biquinzenal desde janeiro: até 12 vencimentos por execução.
  await runOn("2026-03-31");
  const weeks = await occurrencesOf(tenant.workspaceId, weekly);
  assert.deepEqual(weeks.map((occurrence) => occurrence.dueDate),
    ["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"]);
  assert.equal(new Set(weeks.map((occurrence) =>
    occurrence.cashTransactionId)).size, 5);
  const halves = await occurrencesOf(tenant.workspaceId, biweekly);
  assert.deepEqual(halves.map((occurrence) => occurrence.dueDate), [
    "2026-01-01", "2026-01-16", "2026-01-31", "2026-02-15", "2026-03-02",
    "2026-03-17",
  ]);
  const entries = await transactionsOf(tenant.workspaceId);
  assert.equal(entries.length, 11);
  // Cada lançamento aponta para a sua ocorrência; nenhuma duplicidade.
  assert.equal(new Set(entries.map((entry) =>
    entry.recurringEntry.occurrenceId)).size, 11);
  assert.equal(await quotaUsed(tenant.workspaceId, MONTH), quota);
  // Reexecutar no mesmo dia não grava nada.
  await runOn("2026-03-31");
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 11);
});
