import assert from "node:assert/strict";
import test, {after} from "node:test";
import {Timestamp} from "firebase-admin/firestore";

import {
  catalogItemDocument,
  settingsCatalogRef,
} from "../../settingsCatalog/model";
import {
  DEFAULT_EXPENSE_CATEGORY_ID,
  DEFAULT_EXPENSE_CATEGORY_NAME,
  DEFAULT_INCOME_CATEGORY_ID,
  seedCategory,
} from "../../settingsCatalog/testSupport/categorySeeds";
import {
  actorOf,
  cleanupRecurring,
  contractPayload,
  createContract,
  defaultAccountOf,
  occurrencesOf,
  readContract,
  readTransaction,
  rejectsWith,
  runOn,
  seedRecurringTenant,
  updateContract,
  type RecurringTenant,
} from "../../recurring/testSupport/recurringTestSupport";
import {
  executeCreateRecurringExpense,
} from "../../recurring/contractOperations";
import {CASH_EVENTS_COLLECTION} from "../../shared/audit";
import {formatIsoInstant} from "../../shared/commitTime";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  createCashTransaction,
  importCashTransactions,
  updateCashTransaction,
} from "../callables";
import {
  CATEGORY_INACTIVE_MESSAGE,
  CATEGORY_NOT_FOUND_MESSAGE,
  CATEGORY_SUBTYPE_MESSAGE,
  UNCATEGORIZED_LABEL,
} from "../categories";

/**
 * Vínculo lançamento ↔ categoria do catálogo (P5-C1, D-37.8) contra o
 * Emulator: o cliente informa só o `categoryId`; o backend confere workspace,
 * grupo, tipo e estado dentro da transação e grava o retrato do nome.
 */
db();

const tenants: RecurringTenant[] = [];
const tenantFor = async (type: "PF" | "PJ" = "PF") => {
  const tenant = await seedRecurringTenant(type, "catlink");
  tenants.push(tenant);
  return tenant;
};
after(() => cleanupRecurring(tenants));

interface Result {
  transactionId: string;
  replayed: boolean;
  changed?: boolean;
}

const createPayload = (
  tenant: RecurringTenant,
  overrides: Record<string, unknown> = {},
) => ({
  workspaceId: tenant.workspaceId,
  cashAccountId: defaultAccountOf(tenant.workspaceId),
  idempotencyKey: idempotencyKey(),
  type: "despesa",
  description: "Almoço de domingo",
  categoryId: DEFAULT_EXPENSE_CATEGORY_ID,
  amountCents: 4_550,
  date: "2026-09-15",
  ...overrides,
});

const create = (
  tenant: RecurringTenant,
  overrides: Record<string, unknown> = {},
) => call<Result>(createCashTransaction, tenant.member,
  createPayload(tenant, overrides));

const transactionDocs = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/transactions`).get()).docs;

const eventDocs = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/${CASH_EVENTS_COLLECTION}`)
    .get()).docs;

const read = async (workspaceId: string, id: string) =>
  (await db().doc(`workspaces/${workspaceId}/transactions/${id}`).get())
    .data() ?? {};

/** Nenhum lançamento nem evento: a recusa não deixou efeito. */
const assertNothingWritten = async (workspaceId: string) => {
  assert.equal((await transactionDocs(workspaceId)).length, 0,
    "lançamento gravado");
  assert.equal((await eventDocs(workspaceId)).length, 0, "evento gravado");
};

const updatePayload = async (
  tenant: RecurringTenant,
  transactionId: string,
  entry: Record<string, unknown>,
) => {
  const stored = await read(tenant.workspaceId, transactionId);
  return {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId,
    expectedUpdatedAt: formatIsoInstant(stored.updatedAt as Timestamp),
    reason: "Ajuste da categoria",
    entry: {
      cashAccountId: defaultAccountOf(tenant.workspaceId),
      type: "despesa",
      description: "Almoço de domingo",
      categoryId: DEFAULT_EXPENSE_CATEGORY_ID,
      amountCents: 4_550,
      date: "2026-09-15",
      ...entry,
    },
  };
};

const edit = (
  tenant: RecurringTenant,
  transactionId: string,
  entry: Record<string, unknown>,
) => updatePayload(tenant, transactionId, entry).then((payload) =>
  call<Result>(updateCashTransaction, tenant.owner, payload));

// ------------------------------------------------------------- criação

test("P5-C1 — criação: categoria de outro workspace é recusada sem " +
  "gravar nada", async () => {
  const a = await tenantFor();
  const b = await tenantFor();
  const foreignId = await seedCategory(b.workspaceId, {
    name: "Exclusiva de B", subtype: "despesa",
  });

  await expectHttpsError(create(a, {categoryId: foreignId}),
    "invalid-argument", {message: CATEGORY_NOT_FOUND_MESSAGE});
  await assertNothingWritten(a.workspaceId);
  await assertNothingWritten(b.workspaceId);

  // Documento no caminho de A que declara pertencer a B: formato recusado.
  await db().doc(`${settingsCatalogRef(a.workspaceId).path}/${foreignId}`)
    .set(catalogItemDocument({
      workspaceId: b.workspaceId,
      group: "category",
      name: "Exclusiva de B",
      workspaceScope: "both",
      transactionSubtype: "despesa",
      sortOrder: 0,
      status: "active",
      actorUid: "seed-test",
    }));
  await expectHttpsError(create(a, {categoryId: foreignId}),
    "invalid-argument", {message: CATEGORY_NOT_FOUND_MESSAGE});
  await assertNothingWritten(a.workspaceId);

  // ID inexistente e item de outro grupo do catálogo também não servem.
  await expectHttpsError(create(a, {categoryId: uniqueId("inexistente")}),
    "invalid-argument", {message: CATEGORY_NOT_FOUND_MESSAGE});
  const paymentMethodId = uniqueId("forma");
  await db().doc(`${settingsCatalogRef(a.workspaceId).path}/${paymentMethodId}`)
    .set(catalogItemDocument({
      workspaceId: a.workspaceId,
      group: "payment_method",
      name: "Pix",
      workspaceScope: "both",
      sortOrder: 0,
      status: "active",
      actorUid: "seed-test",
    }));
  await expectHttpsError(create(a, {categoryId: paymentMethodId}),
    "invalid-argument", {message: CATEGORY_NOT_FOUND_MESSAGE});
  await assertNothingWritten(a.workspaceId);
});

test("P5-C1 — criação: categoria do outro tipo é recusada", async () => {
  const t = await tenantFor();
  await expectHttpsError(
    create(t, {type: "despesa", categoryId: DEFAULT_INCOME_CATEGORY_ID}),
    "invalid-argument", {message: CATEGORY_SUBTYPE_MESSAGE});
  await expectHttpsError(
    create(t, {type: "receita", categoryId: DEFAULT_EXPENSE_CATEGORY_ID}),
    "invalid-argument", {message: CATEGORY_SUBTYPE_MESSAGE});
  await assertNothingWritten(t.workspaceId);
});

test("P5-C1 — criação: categoria inativa é recusada", async () => {
  const t = await tenantFor();
  const inactiveId = await seedCategory(t.workspaceId, {
    name: "Antiga", subtype: "despesa", status: "inactive",
  });
  await expectHttpsError(create(t, {categoryId: inactiveId}),
    "failed-precondition", {message: CATEGORY_INACTIVE_MESSAGE});
  await assertNothingWritten(t.workspaceId);
});

test("P5-C1 — criação grava o categoryId e o retrato do nome", async () => {
  const t = await tenantFor();
  const categoryId = await seedCategory(t.workspaceId, {
    name: "Freelance", subtype: "receita",
  });
  const result = await create(t, {type: "receita", categoryId});
  const entry = await read(t.workspaceId, result.transactionId);
  assert.equal(entry.categoryId, categoryId);
  assert.equal(entry.category, "Freelance");

  const expense = await create(t);
  const expenseEntry = await read(t.workspaceId, expense.transactionId);
  assert.equal(expenseEntry.categoryId, DEFAULT_EXPENSE_CATEGORY_ID);
  assert.equal(expenseEntry.category, DEFAULT_EXPENSE_CATEGORY_NAME);
});

test("P5-C1 — renomear a categoria não muda o categoryId dos " +
  "lançamentos", async () => {
  const t = await tenantFor();
  const categoryId = await seedCategory(t.workspaceId, {
    name: "Mercado", subtype: "despesa",
  });
  const first = await create(t, {categoryId});

  // Renomeia o item do catálogo (nome, nome normalizado e chave coerentes).
  await seedCategory(t.workspaceId, {
    name: "Supermercado", subtype: "despesa", id: categoryId,
  });

  const untouched = await read(t.workspaceId, first.transactionId);
  assert.equal(untouched.categoryId, categoryId, "identidade preservada");
  assert.equal(untouched.category, "Mercado", "retrato da época");

  // Lançamento novo e correção do antigo usam o mesmo ID e o nome atual.
  const second = await create(t, {categoryId});
  const secondEntry = await read(t.workspaceId, second.transactionId);
  assert.equal(secondEntry.categoryId, categoryId);
  assert.equal(secondEntry.category, "Supermercado");

  await edit(t, first.transactionId, {
    categoryId, description: "Compras da semana",
  });
  const corrected = await read(t.workspaceId, first.transactionId);
  assert.equal(corrected.categoryId, categoryId);
  assert.equal(corrected.category, "Supermercado");
});

// ------------------------------------------------------------ correção

test("P5-C1 — correção: trocar de categoria do mesmo tipo é campo " +
  "alterado", async () => {
  const t = await tenantFor();
  const otherId = await seedCategory(t.workspaceId, {
    name: "Lazer", subtype: "despesa",
  });
  const created = await create(t);
  const result = await edit(t, created.transactionId, {categoryId: otherId});
  assert.equal(result.changed, true);
  const entry = await read(t.workspaceId, created.transactionId);
  assert.equal(entry.categoryId, otherId);
  assert.equal(entry.category, "Lazer");
  const updated = (await eventDocs(t.workspaceId))
    .map((doc) => doc.data())
    .find((event) => event.operation === "cash_entry.updated");
  assert.deepEqual(updated?.changedFields, ["categoryId"]);
});

test("P5-C1 — correção: manter a mesma categoria, agora inativa, " +
  "funciona", async () => {
  const t = await tenantFor();
  const categoryId = await seedCategory(t.workspaceId, {
    name: "Assinaturas", subtype: "despesa",
  });
  const created = await create(t, {categoryId});
  await seedCategory(t.workspaceId, {
    name: "Assinaturas", subtype: "despesa", id: categoryId,
    status: "inactive",
  });

  const result = await edit(t, created.transactionId, {
    categoryId, description: "Assinatura anual",
  });
  assert.equal(result.changed, true);
  const entry = await read(t.workspaceId, created.transactionId);
  assert.equal(entry.categoryId, categoryId);
  assert.equal(entry.description, "Assinatura anual");
});

test("P5-C1 — correção: trocar para categoria inativa é recusado", async () => {
  const t = await tenantFor();
  const inactiveId = await seedCategory(t.workspaceId, {
    name: "Descontinuada", subtype: "despesa", status: "inactive",
  });
  const created = await create(t);
  await expectHttpsError(
    edit(t, created.transactionId, {categoryId: inactiveId}),
    "failed-precondition", {message: CATEGORY_INACTIVE_MESSAGE});
  const entry = await read(t.workspaceId, created.transactionId);
  assert.equal(entry.categoryId, DEFAULT_EXPENSE_CATEGORY_ID);
  assert.equal(entry.category, DEFAULT_EXPENSE_CATEGORY_NAME);
});

test("P5-C1 — correção: mudar o tipo de despesa para receita com " +
  "categoria de despesa é recusado", async () => {
  const t = await tenantFor();
  const created = await create(t);
  await expectHttpsError(
    edit(t, created.transactionId, {type: "receita"}),
    "invalid-argument", {message: CATEGORY_SUBTYPE_MESSAGE});
  const entry = await read(t.workspaceId, created.transactionId);
  assert.equal(entry.type, "despesa");
  assert.equal(entry.categoryId, DEFAULT_EXPENSE_CATEGORY_ID);

  // Com uma categoria de receita, a mesma troca de tipo é aceita.
  await edit(t, created.transactionId, {
    type: "receita", categoryId: DEFAULT_INCOME_CATEGORY_ID,
  });
  const changed = await read(t.workspaceId, created.transactionId);
  assert.equal(changed.type, "receita");
  assert.equal(changed.categoryId, DEFAULT_INCOME_CATEGORY_ID);
});

test("P5-C1 — correção: categoria de outro workspace é recusada", async () => {
  const a = await tenantFor();
  const b = await tenantFor();
  const foreignId = await seedCategory(b.workspaceId, {
    name: "Só de B", subtype: "despesa",
  });
  const created = await create(a);
  await expectHttpsError(
    edit(a, created.transactionId, {categoryId: foreignId}),
    "invalid-argument", {message: CATEGORY_NOT_FOUND_MESSAGE});
  assert.equal(
    (await read(a.workspaceId, created.transactionId)).categoryId,
    DEFAULT_EXPENSE_CATEGORY_ID);
});

// ----------------------------------------------------------- importação

const importBatch = (
  tenant: RecurringTenant,
  items: Array<Record<string, unknown>>,
) => ({
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  importId: uniqueId("arquivo"),
  cashAccountId: defaultAccountOf(tenant.workspaceId),
  items,
});

const importLine = (
  lineId: string,
  overrides: Record<string, unknown> = {},
) => ({
  lineId,
  type: "despesa",
  description: `Linha ${lineId}`,
  amountCents: 2_500,
  date: "2026-09-10",
  ...overrides,
});

test("P5-C1 — importação: linha sem categoryId fica \"Sem categoria\" " +
  "e sem ID", async () => {
  const t = await tenantFor();
  await call(importCashTransactions, t.owner, importBatch(t, [
    importLine("sem-categoria"),
    importLine("com-categoria", {categoryId: DEFAULT_EXPENSE_CATEGORY_ID}),
  ]));
  const docs = await transactionDocs(t.workspaceId);
  assert.equal(docs.length, 2);
  const uncategorized = docs.map((doc) => doc.data())
    .find((data) => data.description === "Linha sem-categoria");
  assert.equal(uncategorized?.category, UNCATEGORIZED_LABEL);
  assert.equal("categoryId" in (uncategorized ?? {}), false);
  const categorized = docs.map((doc) => doc.data())
    .find((data) => data.description === "Linha com-categoria");
  assert.equal(categorized?.categoryId, DEFAULT_EXPENSE_CATEGORY_ID);
  assert.equal(categorized?.category, DEFAULT_EXPENSE_CATEGORY_NAME);
});

test("P5-C1 — importação: categoryId estrangeiro ou inválido recusa o lote " +
  "inteiro, com a linha apontada", async () => {
  const a = await tenantFor();
  const b = await tenantFor();
  const foreignId = await seedCategory(b.workspaceId, {
    name: "Só de B", subtype: "despesa",
  });
  const inactiveId = await seedCategory(a.workspaceId, {
    name: "Inativa", subtype: "despesa", status: "inactive",
  });

  const cases: Array<[string, Record<string, unknown>, string, string]> = [
    ["de outro workspace", {categoryId: foreignId}, "invalid-argument",
      CATEGORY_NOT_FOUND_MESSAGE],
    ["inexistente", {categoryId: uniqueId("nada")}, "invalid-argument",
      CATEGORY_NOT_FOUND_MESSAGE],
    ["do outro tipo", {categoryId: DEFAULT_INCOME_CATEGORY_ID},
      "invalid-argument", CATEGORY_SUBTYPE_MESSAGE],
    ["inativa", {categoryId: inactiveId}, "failed-precondition",
      CATEGORY_INACTIVE_MESSAGE],
  ];
  for (const [label, overrides, code, message] of cases) {
    const error = await expectHttpsError(
      call(importCashTransactions, a.owner, importBatch(a, [
        importLine("ok-1", {categoryId: DEFAULT_EXPENSE_CATEGORY_ID}),
        importLine("ruim-2", overrides),
        importLine("ok-3"),
      ])),
      code, {message});
    assert.equal((error.details as {lineId?: string}).lineId, "ruim-2", label);
    await assertNothingWritten(a.workspaceId);
  }
  await assertNothingWritten(b.workspaceId);
});

// ----------------------------------------------------------- recorrentes

test("P5-C1 — recorrente: criação exige categoria de despesa ativa do " +
  "próprio workspace", async () => {
  const a = await tenantFor();
  const b = await tenantFor();
  const foreignId = await seedCategory(b.workspaceId, {
    name: "Só de B", subtype: "despesa",
  });
  const inactiveId = await seedCategory(a.workspaceId, {
    name: "Inativa", subtype: "despesa", status: "inactive",
  });
  const attempt = (categoryId: string) => executeCreateRecurringExpense(
    actorOf(a, a.owner), contractPayload(a, {categoryId}), "req-catlink",
    {now: () => Date.parse("2026-03-05T15:00:00.000Z")});

  await rejectsWith(attempt(DEFAULT_INCOME_CATEGORY_ID), "invalid_payload",
    CATEGORY_SUBTYPE_MESSAGE);
  await rejectsWith(attempt(foreignId), "invalid_payload",
    CATEGORY_NOT_FOUND_MESSAGE);
  await rejectsWith(attempt(inactiveId), "domain_precondition_failed",
    CATEGORY_INACTIVE_MESSAGE);
  const contracts = await db().collection(
    `workspaces/${a.workspaceId}/recurring_expenses`).get();
  assert.equal(contracts.size, 0, "nenhum contrato gravado");
});

test("P5-C1 — recorrente: o lançamento gerado leva o categoryId e o nome " +
  "do contrato", async () => {
  const t = await tenantFor();
  const categoryId = await seedCategory(t.workspaceId, {
    name: "Internet e telefone", subtype: "despesa",
  });
  const {recurringExpenseId: id} = await createContract(
    t, "2026-03-05", {categoryId}, t.member, "member");
  const contract = await readContract(t.workspaceId, id);
  assert.equal(contract.categoryId, categoryId);
  assert.equal(contract.category, "Internet e telefone");

  await runOn("2026-03-10");
  const [occurrence] = await occurrencesOf(t.workspaceId, id);
  assert.equal(occurrence.status, "generated");
  const entry = await readTransaction(t.workspaceId,
    occurrence.cashTransactionId);
  assert.equal(entry.categoryId, categoryId);
  assert.equal(entry.category, "Internet e telefone");
});

test("P5-C1 — recorrente: edição troca a categoria só por despesa " +
  "ativa e atualiza o retrato", async () => {
  const t = await tenantFor();
  const otherId = await seedCategory(t.workspaceId, {
    name: "Streaming", subtype: "despesa",
  });
  const {recurringExpenseId: id} = await createContract(t, "2026-03-05");
  await rejectsWith(
    updateContract(t, id, {categoryId: DEFAULT_INCOME_CATEGORY_ID},
      "2026-03-06"),
    "invalid_payload", CATEGORY_SUBTYPE_MESSAGE);
  assert.equal(
    (await readContract(t.workspaceId, id)).categoryId,
    DEFAULT_EXPENSE_CATEGORY_ID);

  await updateContract(t, id, {categoryId: otherId}, "2026-03-06");
  const contract = await readContract(t.workspaceId, id);
  assert.equal(contract.categoryId, otherId);
  assert.equal(contract.category, "Streaming");
});
