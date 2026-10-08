import assert from "node:assert/strict";
import test from "node:test";

import {Transaction} from "firebase-admin/firestore";

import {
  catalogSeedDocumentId,
  catalogUniqueLockIdFor,
  readAuthoritativeCatalogItem,
} from "../../settingsCatalog/model";
import {
  GENERAL_CATALOG_SEEDS,
  INVESTMENT_CLASS_SEEDS,
  catalogSeedsFor,
} from "../../settingsCatalog/seeds";
import {
  requireFirestoreEmulator,
  seedActiveAccount,
  seedPaidPlan,
} from "../../shared/testSupport/kernelTestSupport";
import {bootstrapAccount, createWorkspace} from "../callables";
import {defaultCashAccountIdFor} from "../../accounts/model";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
  membershipEvents,
  uniqueId,
} from "../testSupport/p1TestSupport";

requireFirestoreEmulator();

/**
 * Provisionamento de workspace (P1, PR-AUTH-03).
 *
 * O workspace sai de `bootstrapAccount`/`createWorkspace` com os cadastros
 * padrão gravados na mesma transação da criação. Nada aqui chama o cliente,
 * seleciona o workspace nem invoca callable de "preparo".
 */

/**
 * Itens de investimento por perfil (D-15, P4-D): só as carteiras de
 * investimentos (`investment_class`). A categoria é `category`/`investimento`
 * (catálogo geral) e a instituição é cadastrada pelo usuário.
 */
const INVESTMENT_CATALOG_ITEMS = {
  PF: INVESTMENT_CLASS_SEEDS.PF.length,
  PJ: INVESTMENT_CLASS_SEEDS.PJ.length,
} as const;
const GENERAL_ITEMS = {
  PF: GENERAL_CATALOG_SEEDS.filter((seed) => seed.group !== "cost_center")
    .length,
  PJ: GENERAL_CATALOG_SEEDS.length,
} as const;

const countOf = async (workspaceId: string, collection: string) =>
  (await db().collection(`workspaces/${workspaceId}/${collection}`).count()
    .get()).data().count;

const assertProvisioned = async (workspaceId: string, type: "PF" | "PJ") => {
  const expected = GENERAL_ITEMS[type] + INVESTMENT_CATALOG_ITEMS[type];
  assert.equal(await countOf(workspaceId, "settings_catalog"), expected);
  assert.equal(
    await countOf(workspaceId, "settings_catalog_uniques"),
    expected,
  );
  const costCenters = await db()
    .collection(`workspaces/${workspaceId}/settings_catalog`)
    .where("group", "==", "cost_center").get();
  assert.equal(costCenters.size, type === "PJ" ? 3 : 0);
  // A categoria de investimento semeada tem o ID que a classificação procura.
  const tesouro = await db().doc(
    `workspaces/${workspaceId}/settings_catalog/` +
    catalogSeedDocumentId(
      "category", "investimento", "both", "Tesouro Direto",
    ),
  ).get();
  assert.equal(tesouro.get("workspaceId"), workspaceId);
  assert.equal(tesouro.get("status"), "active");
  // D-23 (P4-E): cada semente nasce no formato autoritativo das callables,
  // com a reserva do nome apontando para ela; nenhum subtipo `parcelado`.
  const seeded = await db()
    .collection(`workspaces/${workspaceId}/settings_catalog`).get();
  assert.deepEqual(seeded.docs.map((doc) => doc.id).sort(),
    catalogSeedsFor(type).map((seed) => catalogSeedDocumentId(
      seed.group, seed.transactionSubtype,
      seed.group === "cost_center" ? "PJ" :
        seed.group === "investment_class" ? type : "both",
      seed.name)).sort());
  for (const doc of seeded.docs) {
    const item = readAuthoritativeCatalogItem(doc.id, doc.data(), workspaceId);
    assert.ok(item, `semente fora do formato autoritativo: ${doc.id}`);
    assert.notEqual(doc.get("transactionSubtype"), "parcelado");
    const lock = await db().doc(`workspaces/${workspaceId}/` +
      `settings_catalog_uniques/${catalogUniqueLockIdFor(item.dedupeKey)}`)
      .get();
    assert.equal(lock.get("catalogItemId"), doc.id);
    assert.equal(lock.get("dedupeKey"), item.dedupeKey);
  }
  const classes = await db()
    .collection(`workspaces/${workspaceId}/settings_catalog`)
    .where("group", "==", "investment_class").get();
  assert.deepEqual(
    classes.docs.map((doc) => doc.get("name")).sort(),
    [...INVESTMENT_CLASS_SEEDS[type]].sort(),
  );
  assert.ok(classes.docs.every((doc) => doc.get("workspaceScope") === type));
  // Nenhum cadastro técnico nem grupo profissional é semeado (D-15, P4-D).
  for (const collection of ["investment_accounts", "investment_assets"]) {
    assert.equal(await countOf(workspaceId, collection), 0, collection);
  }
  for (const group of ["investment_type", "investment_risk",
    "investment_liquidity", "investment_indexer", "investment_strategy"]) {
    const items = await db()
      .collection(`workspaces/${workspaceId}/settings_catalog`)
      .where("group", "==", group).get();
    assert.equal(items.size, 0, group);
  }
  const [created] = await membershipEvents(workspaceId, "workspace.created");
  assert.equal(
    (created.after as Record<string, unknown>).defaultCatalogItems,
    expected,
  );
  // P3-J (D-30): a carteira de caixa não é item de catálogo; o workspace
  // nasce com uma conta autoritativa, saldo zero e sem movimento.
  const wallets = await db()
    .collection(`workspaces/${workspaceId}/settings_catalog`)
    .where("group", "==", "wallet").get();
  assert.equal(wallets.size, 0, "grupo genérico wallet não é semeado");
  const accounts = await db()
    .collection(`workspaces/${workspaceId}/cash_accounts`).get();
  assert.equal(accounts.size, 1);
  const account = accounts.docs[0];
  assert.equal(account.id, defaultCashAccountIdFor(workspaceId));
  assert.deepEqual(
    [account.get("name"), account.get("accountType"), account.get("status"),
      account.get("balanceCents"), account.get("schemaVersion")],
    ["Carteira principal", "cash", "active", 0, 1],
  );
  assert.equal(await countOf(workspaceId, "cash_account_movements"), 0);
  const events = await db()
    .collection(`workspaces/${workspaceId}/cash_account_events`).get();
  assert.deepEqual(events.docs.map((doc) => doc.get("operation")),
    ["cash_account.created"]);
};

test("createWorkspace entrega PF e PJ já provisionados", async () => {
  const uid = uniqueId("prov-create");
  await seedActiveAccount(uid);
  // Dois workspaces próprios: acima do Free (P2B.1).
  await seedPaidPlan(uid, "pro");
  for (const type of ["PF", "PJ"] as const) {
    const {workspaceId} = await call<{workspaceId: string}>(
      createWorkspace,
      uid,
      {type, name: `Espaço ${type}`, idempotencyKey: idempotencyKey()},
    );
    await assertProvisioned(workspaceId, type);
  }
});

test("retry de createWorkspace não provisiona de novo", async () => {
  const uid = uniqueId("prov-retry");
  await seedActiveAccount(uid);
  const payload = {
    type: "PJ",
    name: "Empresa",
    idempotencyKey: idempotencyKey(),
  };
  const create = () =>
    call<{workspaceId: string}>(createWorkspace, uid, payload);
  const results = await Promise.allSettled(
    Array.from({length: 4}, create),
  );
  const ok = results.filter(
    (r): r is PromiseFulfilledResult<{workspaceId: string}> =>
      r.status === "fulfilled",
  );
  assert.ok(ok.length >= 1);
  // Todas as respostas de sucesso apontam para o mesmo workspace.
  assert.equal(new Set(ok.map((r) => r.value.workspaceId)).size, 1);
  const replay = await create();
  assert.equal(replay.workspaceId, ok[0].value.workspaceId);
  const owned = await db().collection("workspaces")
    .where("ownerId", "==", uid).get();
  assert.equal(owned.size, 1, "um único workspace para a mesma chave");
  await assertProvisioned(replay.workspaceId, "PJ");
});

test("falha no provisionamento aborta a criação e converge", async () => {
  const uid = uniqueId("prov-fault");
  await seedActiveAccount(uid);
  const payload = {
    type: "PF",
    name: "Pessoal",
    idempotencyKey: idempotencyKey(),
  };
  const originalCreate = Transaction.prototype.create;
  // Falha injetada na escrita da conta padrão do Caixa: o workspace, o
  // membership, o índice e o catálogo já foram enfileirados.
  const faulty = {
    create(this: Transaction, ...args: Parameters<typeof originalCreate>) {
      if (args[0].path.includes("/cash_accounts/")) {
        throw new Error("falha injetada no provisionamento");
      }
      return originalCreate.apply(this, args);
    },
  };
  Transaction.prototype.create = faulty.create as typeof originalCreate;
  try {
    await expectHttpsError(call(createWorkspace, uid, payload), "internal");
  } finally {
    Transaction.prototype.create = originalCreate;
  }
  // Nenhum sucesso falso nem estado parcial: nada da criação persistiu.
  const owned = await db().collection("workspaces")
    .where("ownerId", "==", uid).get();
  assert.equal(owned.size, 0);
  assert.equal(
    (await db().collection(`users/${uid}/workspaces`).get()).size,
    0,
  );
  // A mesma intenção, repetida, cria e provisiona por inteiro.
  const {workspaceId} = await call<{workspaceId: string}>(
    createWorkspace, uid, payload,
  );
  await assertProvisioned(workspaceId, "PF");
});

test("bootstrapAccount provisiona o espaço pessoal uma única vez", async () => {
  const uid = uniqueId("prov-boot");
  const results = await Promise.all(
    Array.from({length: 4}, () =>
      call<{created: boolean; workspaceId: string | null}>(
        bootstrapAccount, uid, {},
      )),
  );
  const created = results.filter((result) => result.created);
  assert.equal(created.length, 1);
  const workspaceId = created[0].workspaceId as string;
  await assertProvisioned(workspaceId, "PF");
  const owned = await db().collection("workspaces")
    .where("ownerId", "==", uid).get();
  assert.equal(owned.size, 1);
});
