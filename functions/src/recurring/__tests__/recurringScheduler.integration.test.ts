import assert from "node:assert/strict";
import test, {after} from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {processRecurring} from "../../crons/recurring";
import {
  recurringCashTransactionIdFor,
  recurringOccurrenceIdFor,
} from "../model";
import {saoPauloDayKey} from "../../shared/dateKeys";
import {FUNCTIONS_REGION} from "../../shared/runtimeOptions";
import {db} from "../../workspaces/testSupport/p1TestSupport";
import {
  cleanupRecurring,
  contractRef,
  createContract,
  eventsOf,
  occurrencesOf,
  readContract,
  runOn,
  seedRecurringTenant,
  transactionsOf,
  type RecurringTenant,
} from "../testSupport/recurringTestSupport";

/**
 * Agendador de Recorrentes (P4-B, PR-REC-01): consulta filtrada no servidor
 * (só ativos com vencimento alcançado), cursor estável, recuperação de
 * vencimentos perdidos com tetos explícitos e retomada determinística,
 * isolamento de falha e o corpo do gatilho `onSchedule`. No Emulator.
 */
const tenants: RecurringTenant[] = [];
const tenantFor = async () => {
  const tenant = await seedRecurringTenant();
  tenants.push(tenant);
  return tenant;
};
after(() => cleanupRecurring(tenants));

const weekly = (startDate: string) => ({
  frequency: "weekly" as const, billingDay: null, startDate,
});

test("o corpo do gatilho gera os vencimentos de hoje com correlação do " +
  "agendamento", async () => {
  const tenant = await tenantFor();
  const today = saoPauloDayKey();
  const {recurringExpenseId: id} = await createContract(tenant, today,
    weekly(today));
  const scheduleTime = new Date().toISOString();
  await processRecurring.run({
    jobName: "test-job",
    scheduleTime,
    scheduleId: "test-schedule",
    region: FUNCTIONS_REGION,
    data: undefined,
  } as unknown as Parameters<typeof processRecurring.run>[0]);
  const [occurrence] = await occurrencesOf(tenant.workspaceId, id);
  assert.equal(occurrence.dueDate, today);
  assert.equal(occurrence.status, "generated");
  assert.equal(occurrence.lastRequestId,
    `recurring-generation-${scheduleTime}`);
  const events = await eventsOf(tenant.workspaceId, id);
  assert.ok(events.some((event) =>
    event.operation === "recurring.occurrence_generated" &&
    event.requestId === `recurring-generation-${scheduleTime}`));
});

test("recuperação com teto por contrato e retomada " +
  "determinística", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-01-05",
    weekly("2026-01-05"));
  // 05/01 a 30/03: 13 vencimentos semanais perdidos.
  const first = await runOn("2026-03-30", {maxDuePerContract: 5});
  assert.ok(first.backlog >= 1);
  let contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.lastProcessedDueDate, "2026-02-02");
  assert.equal(contract.nextDueDate, "2026-02-09");
  await runOn("2026-03-30", {maxDuePerContract: 5});
  await runOn("2026-03-30", {maxDuePerContract: 5});
  contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.lastProcessedDueDate, "2026-03-30");
  assert.equal(contract.nextDueDate, "2026-04-06");
  const dues = (await occurrencesOf(tenant.workspaceId, id))
    .map((occurrence) => occurrence.dueDate);
  assert.equal(dues.length, 13);
  assert.equal(new Set(dues).size, 13);
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 13);
});

test("teto por workspace na execução deixa o resto para a " +
  "próxima", async () => {
  const tenant = await tenantFor();
  const ids = [];
  for (let index = 0; index < 3; index += 1) {
    ids.push((await createContract(tenant, "2026-03-01",
      weekly("2026-03-02"))).recurringExpenseId);
  }
  const summary = await runOn("2026-03-02", {maxDuePerWorkspace: 2});
  assert.ok(summary.backlog >= 1);
  let generated = 0;
  for (const id of ids) {
    generated += (await occurrencesOf(tenant.workspaceId, id)).length;
  }
  assert.equal(generated, 2);
  await runOn("2026-03-02", {maxDuePerWorkspace: 2});
  generated = 0;
  for (const id of ids) {
    generated += (await occurrencesOf(tenant.workspaceId, id)).length;
  }
  assert.equal(generated, 3);
});

test("contrato com atraso que reaparece na varredura é atendido uma vez " +
  "por execução", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-01-05",
    weekly("2026-01-05"));
  // Página de 1, um vencimento por contrato: o próximo vencimento avança e
  // o contrato reaparece adiante na mesma varredura — sem segundo passo.
  await runOn("2026-03-30", {pageSize: 1, maxPages: 10,
    maxDuePerContract: 1});
  assert.equal((await occurrencesOf(tenant.workspaceId, id)).length, 1);
});

test("corte por páginas é declarado (`truncated`)", async () => {
  const tenant = await tenantFor();
  for (let index = 0; index < 3; index += 1) {
    await createContract(tenant, "2026-03-01", weekly("2026-03-02"));
  }
  const summary = await runOn("2026-03-02", {pageSize: 1, maxPages: 1});
  assert.equal(summary.truncated, true);
  const complete = await runOn("2026-03-02");
  assert.equal(complete.truncated, false);
});

test("falha num contrato não interrompe os outros; falha transitória é " +
  "retomada sem duplicar", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: healthy} = await createContract(tenant,
    "2026-03-01", weekly("2026-03-02"));
  // Documento fora do schema autoritativo, mas capturado pela consulta.
  const broken = contractRef(tenant.workspaceId, "rec_quebrado");
  await broken.set({schemaVersion: 1, status: "active",
    nextDueDate: "2026-03-02", workspaceId: tenant.workspaceId,
    updatedAt: Timestamp.now()});
  // Falha transitória no Caixa: o ID determinístico do lançamento já está
  // ocupado, e o `create` da transação falha sem fato parcial (P4-D: a janela
  // de manutenção do ledger saiu com a inicialização retroativa da quota).
  const occupied = db().doc(`workspaces/${tenant.workspaceId}/transactions/` +
    recurringCashTransactionIdFor(tenant.workspaceId,
      recurringOccurrenceIdFor(tenant.workspaceId, healthy, "2026-03-02")));
  await occupied.set({ocupado: true});
  const first = await runOn("2026-03-02");
  assert.ok(first.failed >= 2);
  assert.equal((await occurrencesOf(tenant.workspaceId, healthy)).length, 0);
  assert.equal((await readContract(tenant.workspaceId, healthy)).nextDueDate,
    "2026-03-02");
  await occupied.delete();
  await broken.delete();
  await runOn("2026-03-02");
  await runOn("2026-03-02");
  assert.equal((await occurrencesOf(tenant.workspaceId, healthy)).length, 1);
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 1);
});
