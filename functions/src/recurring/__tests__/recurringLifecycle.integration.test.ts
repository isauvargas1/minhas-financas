import assert from "node:assert/strict";
import test, {after} from "node:test";

import {
  archiveAccount,
  expireKeys,
  statusPayload,
} from "../../accounts/testSupport/accountTestSupport";
import {executeArchiveCreditCard} from "../../cards/cardOperations";
import {
  cardVersion,
  createCard,
} from "../../cards/testSupport/cardTestSupport";
import {
  seedActiveAccount,
  seedMember,
} from "../../shared/testSupport/kernelTestSupport";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  cancelRecurringExpense,
  createRecurringExpense,
  pauseRecurringExpense,
} from "../callables";
import {MEMBER_OWNERSHIP_MESSAGE, RECURRING_CONFLICT_MESSAGE} from "../common";
import {
  ALREADY_CANCELLED_MESSAGE,
  BACKLOG_MESSAGE,
  BUSINESS_PJ_ONLY_MESSAGE,
  NOT_EDITABLE_MESSAGE,
  NO_DUE_DATE_MESSAGE,
  UNCHANGED_MESSAGE,
  executeCreateRecurringExpense,
  executePauseRecurringExpense,
  executeUpdateRecurringExpense,
} from "../contractOperations";
import {
  actorOf,
  cancelContract,
  cleanupRecurring,
  clockAt,
  contractPayload,
  contractVersion,
  createContract,
  defaultAccountOf,
  eventsOf,
  occurrencesOf,
  pauseContract,
  readContract,
  rejectsWith,
  requestId,
  resumeContract,
  runOn,
  seedRecurringTenant,
  transactionsOf,
  updateContract,
  type RecurringTenant,
} from "../testSupport/recurringTestSupport";

/**
 * Ciclo de vida do contrato recorrente (P4-B, D-12): criação validada,
 * edição só do futuro, pausa e retomada sem recuperar o intervalo pausado,
 * cancelamento terminal, idempotência com âncora durável e RBAC relido na
 * transação. No Emulator.
 */
const tenants: RecurringTenant[] = [];
const tenantFor = async (type: "PF" | "PJ" = "PF") => {
  const tenant = await seedRecurringTenant(type);
  tenants.push(tenant);
  return tenant;
};
after(() => cleanupRecurring(tenants));

test("criação: primeiro vencimento a partir de hoje, sem " +
  "retroagir", async () => {
  const tenant = await tenantFor();
  // Início em janeiro, criado em 05/03: o primeiro vencimento é 10/03.
  const {recurringExpenseId, nextDueDate} = await createContract(tenant,
    "2026-03-05");
  assert.equal(nextDueDate, "2026-03-10");
  const contract = await readContract(tenant.workspaceId, recurringExpenseId);
  assert.equal(contract.status, "active");
  assert.equal(contract.amountCents, 9_990);
  assert.equal(contract.currency, "BRL");
  assert.equal(contract.executionMode, "automatic");
  assert.equal(contract.lastProcessedDueDate, null);
  assert.equal(contract.openOccurrenceCount, 0);
  assert.equal(contract.createdBy, tenant.owner);
  assert.equal(contract.revision, 1);
  // Nenhum campo legado.
  for (const legacy of ["valorPadrao", "periodo", "adjustments",
    "gerarDespesaAutomaticamente", "splitGroupIdOpcional",
    "cartaoIdOpcional"]) {
    assert.equal(contract[legacy], undefined, legacy);
  }
  const events = await eventsOf(tenant.workspaceId, recurringExpenseId);
  assert.equal(events.length, 1);
  assert.equal(events[0].operation, "recurring.created");
  assert.equal(events[0].amountChanged, true);
  assert.equal(events[0].after.amountCents, 9_990);
  // Criar não gera nada: nem ocorrência nem lançamento.
  assert.equal((await occurrencesOf(tenant.workspaceId, recurringExpenseId))
    .length, 0);
  assert.equal((await transactionsOf(tenant.workspaceId)).length, 0);
});

test("criação: destino ativo do workspace, PJ só em PJ, datas com " +
  "vencimento", async () => {
  const tenant = await tenantFor();
  const cardId = await createCard(tenant);
  await executeArchiveCreditCard(actorOf(tenant, tenant.owner), {
    workspaceId: tenant.workspaceId, idempotencyKey: idempotencyKey(), cardId,
    expectedUpdatedAt: await cardVersion(tenant.workspaceId, cardId),
  }, requestId());
  await rejectsWith(createContract(tenant, "2026-03-05", {
    paymentMethod: "credit_card", cardId, cashAccountId: null,
  }), "domain_precondition_failed", /arquivado/);
  await rejectsWith(createContract(tenant, "2026-03-05", {
    paymentMethod: "credit_card", cardId: "card-inexistente",
    cashAccountId: null,
  }), "not_found", "Cartão não encontrado.");
  await rejectsWith(createContract(tenant, "2026-03-05", {
    cashAccountId: "conta-inexistente",
  }), "not_found");
  await rejectsWith(createContract(tenant, "2026-03-05", {
    business: {supplier: "Fornecedor", businessType: "saas", costCenter: null,
      responsible: null, adjustmentDate: null, commitment: null},
  }), "invalid_payload", BUSINESS_PJ_ONLY_MESSAGE);
  await rejectsWith(createContract(tenant, "2026-03-05", {
    startDate: "2026-01-10", endDate: "2026-03-01",
  }), "domain_precondition_failed", NO_DUE_DATE_MESSAGE);

  // Conta arquivada também é recusada.
  const other = await tenantFor();
  await archiveAccount(other.owner, await statusPayload(other.workspaceId,
    defaultAccountOf(other.workspaceId)));
  await rejectsWith(createContract(other, "2026-03-05"),
    "domain_precondition_failed", /arquivada/);

  // PJ aceita os dados de empresa.
  const pj = await tenantFor("PJ");
  const created = await createContract(pj, "2026-03-05", {
    business: {supplier: "AWS", businessType: "saas", costCenter: "TI",
      responsible: "Ana", adjustmentDate: "2026-12-01", commitment: "12 meses"},
  });
  const contract = await readContract(pj.workspaceId,
    created.recurringExpenseId);
  assert.equal(contract.business.supplier, "AWS");
});

test("idempotência: replay pela chave e pela âncora durável; conflito de " +
  "conteúdo", async () => {
  const tenant = await tenantFor();
  const payload = contractPayload(tenant);
  const first = await executeCreateRecurringExpense(
    actorOf(tenant, tenant.owner), payload, requestId(), clockAt("2026-03-05"));
  const replay = await executeCreateRecurringExpense(
    actorOf(tenant, tenant.owner), payload, requestId(), clockAt("2026-03-05"));
  assert.equal(replay.replayed, true);
  assert.equal(replay.recurringExpenseId, first.recurringExpenseId);
  // Recibo expirado: a âncora (o próprio contrato) ainda decide.
  await expireKeys(tenant.owner);
  const anchored = await executeCreateRecurringExpense(
    actorOf(tenant, tenant.owner), payload, requestId(), clockAt("2026-03-05"));
  assert.equal(anchored.replayed, true);
  await rejectsWith(executeCreateRecurringExpense(
    actorOf(tenant, tenant.owner), {...payload, amountCents: 1_234},
    requestId(), clockAt("2026-03-05")), "idempotency_conflict");
  const count = (await db().collection(
    `workspaces/${tenant.workspaceId}/recurring_expenses`).get()).size;
  assert.equal(count, 1);

  // Edição: mesma intenção com outro conteúdo é conflito.
  const update = {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    recurringExpenseId: first.recurringExpenseId,
    expectedUpdatedAt: await contractVersion(tenant.workspaceId,
      first.recurringExpenseId),
    changes: {name: "Internet fibra"},
  };
  await executeUpdateRecurringExpense(actorOf(tenant, tenant.owner), update,
    requestId(), clockAt("2026-03-05"));
  const again = await executeUpdateRecurringExpense(
    actorOf(tenant, tenant.owner), update, requestId(), clockAt("2026-03-05"));
  assert.equal(again.replayed, true);
  await expireKeys(tenant.owner);
  const durable = await executeUpdateRecurringExpense(
    actorOf(tenant, tenant.owner), update, requestId(), clockAt("2026-03-05"));
  assert.equal(durable.replayed, true);
  await rejectsWith(executeUpdateRecurringExpense(actorOf(tenant, tenant.owner),
    {...update, changes: {name: "Outra"}}, requestId(), clockAt("2026-03-05")),
  "idempotency_conflict");
  const contract = await readContract(tenant.workspaceId,
    first.recurringExpenseId);
  assert.equal(contract.name, "Internet fibra");
  assert.equal(contract.revision, 2);
});

test("edição: só o futuro; recalcula o vencimento; versão lida; histórico " +
  "de valor", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05");
  await runOn("2026-03-10");
  const [generated] = await occurrencesOf(tenant.workspaceId, id);
  assert.equal(generated.status, "generated");
  const entryBefore = (await db().doc(`workspaces/${tenant.workspaceId}/` +
    `transactions/${generated.cashTransactionId}`).get()).data();

  // Valor e dia mudam: o vencimento seguinte é recalculado pela regra nova.
  await updateContract(tenant, id, {amountCents: 12_990, billingDay: 20},
    "2026-03-12", tenant.owner, "owner", {reason: "Reajuste anual"});
  let contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.amountCents, 12_990);
  assert.equal(contract.nextDueDate, "2026-03-20");
  assert.equal(contract.revision, 2);
  // O que já foi gerado não muda: ocorrência e lançamento intactos.
  const [unchanged] = await occurrencesOf(tenant.workspaceId, id);
  assert.equal(unchanged.plannedAmountCents, 9_990);
  assert.equal(unchanged.actualAmountCents, 9_990);
  const entryAfter = (await db().doc(`workspaces/${tenant.workspaceId}/` +
    `transactions/${generated.cashTransactionId}`).get()).data();
  assert.equal(entryAfter?.valueCents, entryBefore?.valueCents);
  // Histórico de valor pela trilha append-only, com o motivo.
  const changes = (await eventsOf(tenant.workspaceId, id))
    .filter((event) => event.amountChanged);
  const update = changes.find((event) =>
    event.operation === "recurring.updated");
  assert.equal(update?.before.amountCents, 9_990);
  assert.equal(update?.after.amountCents, 12_990);
  assert.equal(update?.reason, "Reajuste anual");
  assert.deepEqual(update?.changedFields.sort(), ["amountCents", "billingDay"]);

  // Mudar para semanal: dia de cobrança sai; vencimento recalculado depois
  // do último processado.
  await updateContract(tenant, id, {frequency: "weekly", billingDay: null,
    startDate: "2026-03-02"}, "2026-03-12");
  contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.nextDueDate, "2026-03-16");

  // Versão antiga: conflito, nada gravado.
  const stale = await contractVersion(tenant.workspaceId, id);
  await updateContract(tenant, id, {name: "Nova"}, "2026-03-12");
  const owner = actorOf(tenant, tenant.owner);
  await rejectsWith(executeUpdateRecurringExpense(owner, {
    workspaceId: tenant.workspaceId, idempotencyKey: idempotencyKey(),
    recurringExpenseId: id, expectedUpdatedAt: stale,
    changes: {name: "Outra"},
  }, requestId(), clockAt("2026-03-12")), "concurrent_update",
  RECURRING_CONFLICT_MESSAGE);
  await rejectsWith(updateContract(tenant, id, {name: "Nova"}, "2026-03-12"),
    "domain_precondition_failed", UNCHANGED_MESSAGE);
  // Coerência sobre o contrato resultante.
  await rejectsWith(updateContract(tenant, id, {paymentMethod: "credit_card"},
    "2026-03-12"), "invalid_payload", /Cartão: obrigatório/);
});

test("edição com vencimento atrasado ainda não processado é " +
  "recusada", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05");
  // O agendador não rodou desde 10/03: há atraso.
  await rejectsWith(updateContract(tenant, id, {amountCents: 1_000},
    "2026-03-15"), "domain_precondition_failed", BACKLOG_MESSAGE);
  // Descritivo continua permitido.
  await updateContract(tenant, id, {name: "Internet casa"}, "2026-03-15");
  const contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.nextDueDate, "2026-03-10");
});

test("pausa interrompe; retomada não recupera o intervalo " +
  "pausado", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05", {
    frequency: "weekly", billingDay: null, startDate: "2026-03-02",
  });
  await runOn("2026-03-09");
  assert.equal((await occurrencesOf(tenant.workspaceId, id)).length, 1);
  await pauseContract(tenant, id, "2026-03-10");
  let contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.status, "paused");
  assert.equal(contract.nextDueDate, null);
  // Durante a pausa nada é gerado.
  await runOn("2026-03-31");
  assert.equal((await occurrencesOf(tenant.workspaceId, id)).length, 1);
  await rejectsWith(pauseContract(tenant, id, "2026-03-31"),
    "domain_precondition_failed", "Esta recorrência já está pausada.");
  // Retomada em 01/04: o primeiro vencimento elegível é 06/04; 16, 23 e
  // 30/03 não são recuperados.
  await resumeContract(tenant, id, "2026-04-01");
  contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.status, "active");
  assert.equal(contract.nextDueDate, "2026-04-06");
  await runOn("2026-04-06");
  const dues = (await occurrencesOf(tenant.workspaceId, id))
    .map((occurrence) => occurrence.dueDate);
  assert.deepEqual(dues, ["2026-03-09", "2026-04-06"]);
});

test("retomada depois do término encerra a recorrência", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05", {
    endDate: "2026-04-30",
  });
  await pauseContract(tenant, id, "2026-03-06");
  const result = await resumeContract(tenant, id, "2026-05-15");
  assert.equal(result.status, "ended");
  const contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.status, "ended");
  assert.equal(contract.nextDueDate, null);
  await rejectsWith(updateContract(tenant, id, {name: "X"}, "2026-05-15"),
    "domain_precondition_failed", NOT_EDITABLE_MESSAGE);
});

test("término natural: o último vencimento encerra o contrato", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05", {
    endDate: "2026-04-15",
  });
  const summary = await runOn("2026-04-20");
  assert.ok(summary.ended >= 1);
  const contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.status, "ended");
  assert.equal(contract.nextDueDate, null);
  assert.equal(contract.lastProcessedDueDate, "2026-04-10");
  assert.deepEqual((await occurrencesOf(tenant.workspaceId, id))
    .map((occurrence) => occurrence.dueDate), ["2026-03-10", "2026-04-10"]);
  assert.ok((await eventsOf(tenant.workspaceId, id))
    .some((event) => event.operation === "recurring.ended"));
});

test("cancelamento: terminal, nada apagado nem revertido, nada gerado " +
  "depois", async () => {
  const tenant = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05");
  await runOn("2026-03-10");
  const before = await transactionsOf(tenant.workspaceId);
  assert.equal(before.length, 1);
  await cancelContract(tenant, id, "2026-03-11");
  const contract = await readContract(tenant.workspaceId, id);
  assert.equal(contract.status, "cancelled");
  assert.equal(contract.nextDueDate, null);
  assert.equal(contract.cancelledBy, tenant.owner);
  await runOn("2026-06-30");
  assert.equal((await occurrencesOf(tenant.workspaceId, id)).length, 1);
  const after = await transactionsOf(tenant.workspaceId);
  assert.equal(after.length, 1);
  assert.equal(after[0].cashEntry.status, "pending");
  await rejectsWith(cancelContract(tenant, id, "2026-06-30"),
    "domain_precondition_failed", ALREADY_CANCELLED_MESSAGE);
  await rejectsWith(resumeContract(tenant, id, "2026-06-30"),
    "domain_precondition_failed", ALREADY_CANCELLED_MESSAGE);
  await rejectsWith(updateContract(tenant, id, {name: "X"}, "2026-06-30"),
    "domain_precondition_failed", NOT_EDITABLE_MESSAGE);
});

test("RBAC: owner/admin tudo; member cria e administra só o que criou; " +
  "viewer lê", async () => {
  const tenant = await tenantFor();
  const ownerContract = (await createContract(tenant, "2026-03-05"))
    .recurringExpenseId;
  const memberContract = (await createContract(tenant, "2026-03-05", {},
    tenant.member, "member")).recurringExpenseId;
  // Member administra o próprio.
  await updateContract(tenant, memberContract, {name: "Do membro"},
    "2026-03-05", tenant.member, "member");
  await pauseContract(tenant, memberContract, "2026-03-05", tenant.member,
    "member");
  // Member não toca o do owner; outro member não toca o do primeiro.
  await rejectsWith(updateContract(tenant, ownerContract, {name: "X"},
    "2026-03-05", tenant.member, "member"), "permission_denied",
  MEMBER_OWNERSHIP_MESSAGE);
  await rejectsWith(resumeContract(tenant, memberContract, "2026-03-05",
    tenant.otherMember, "member"), "permission_denied",
  MEMBER_OWNERSHIP_MESSAGE);
  // Admin administra o do membro.
  await resumeContract(tenant, memberContract, "2026-03-05", tenant.admin,
    "admin");
  // Viewer: recusado na pré-checagem da callable e na releitura.
  await expectHttpsError(call(createRecurringExpense, tenant.viewer,
    contractPayload(tenant)), "permission-denied");
  await rejectsWith(createContract(tenant, "2026-03-05", {}, tenant.viewer,
    "viewer"), "workspace_role_denied");
  await rejectsWith(cancelContract(tenant, ownerContract, "2026-03-05",
    tenant.viewer, "viewer"), "workspace_role_denied");
});

test("perda de permissão e tenant cruzado são recusados na " +
  "transação", async () => {
  const tenant = await tenantFor();
  const other = await tenantFor();
  const {recurringExpenseId: id} = await createContract(tenant, "2026-03-05",
    {}, tenant.member, "member");
  // Membro removido: a releitura recusa, mesmo com papel antigo no ator.
  await seedMember(tenant.workspaceId, tenant.member, "member", "removed");
  await rejectsWith(pauseContract(tenant, id, "2026-03-05", tenant.member,
    "member"), "workspace_membership_required");
  // Conta suspensa.
  await seedActiveAccount(tenant.admin, {status: "suspended"});
  await rejectsWith(pauseContract(tenant, id, "2026-03-05", tenant.admin,
    "admin"), "account_suspended");
  // Workspace arquivado.
  await db().doc(`workspaces/${tenant.workspaceId}`).update({
    status: "archived"});
  await rejectsWith(pauseContract(tenant, id, "2026-03-05"),
    "workspace_archived");
  await db().doc(`workspaces/${tenant.workspaceId}`).update({
    status: "active"});
  // Cruzado: owner de B não alcança o contrato de A (nem pela callable).
  await expectHttpsError(call(pauseRecurringExpense, other.owner, {
    workspaceId: tenant.workspaceId, idempotencyKey: idempotencyKey(),
    recurringExpenseId: id,
    expectedUpdatedAt: await contractVersion(tenant.workspaceId, id),
  }), "permission-denied");
  // Pelo próprio workspace, o ID de A não existe em B.
  await rejectsWith(executePauseRecurringExpense(actorOf(other, other.owner), {
    workspaceId: other.workspaceId, idempotencyKey: idempotencyKey(),
    recurringExpenseId: id,
    expectedUpdatedAt: await contractVersion(tenant.workspaceId, id),
  }, requestId(), clockAt("2026-03-05")), "not_found");
  assert.equal((await readContract(tenant.workspaceId, id)).status, "active");
  // A callable de cancelamento também passa pelo kernel.
  await expectHttpsError(call(cancelRecurringExpense, other.viewer, {
    workspaceId: other.workspaceId, idempotencyKey: idempotencyKey(),
    recurringExpenseId: id, expectedUpdatedAt: "2026-01-01T00:00:00.000000000Z",
  }), "permission-denied");
});
