import assert from "node:assert/strict";
import test from "node:test";

import {Transaction} from "firebase-admin/firestore";

import {
  legacyCatalogSeedDocumentId,
} from "../../investments/simpleMode";
import {
  requireFirestoreEmulator,
  seedActiveAccount,
} from "../../shared/testSupport/kernelTestSupport";
import {bootstrapAccount, createWorkspace} from "../callables";
import {GENERAL_CATALOG_SEEDS} from "../provisioning";
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

/** Itens do catálogo de investimentos por perfil (tipos, risco, etc.). */
const INVESTMENT_CATALOG_ITEMS = 21;
const GENERAL_ITEMS = {
  PF: GENERAL_CATALOG_SEEDS.filter((seed) => seed.workspaceScope === "both")
    .length,
  PJ: GENERAL_CATALOG_SEEDS.length,
} as const;

const countOf = async (workspaceId: string, collection: string) =>
  (await db().collection(`workspaces/${workspaceId}/${collection}`).count()
    .get()).data().count;

const assertProvisioned = async (workspaceId: string, type: "PF" | "PJ") => {
  const expected = GENERAL_ITEMS[type] + INVESTMENT_CATALOG_ITEMS;
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
    legacyCatalogSeedDocumentId(
      "category", "investimento", "both", "Tesouro Direto",
    ),
  ).get();
  assert.equal(tesouro.get("workspaceId"), workspaceId);
  assert.equal(tesouro.get("status"), "active");
  for (const collection of ["investment_accounts", "investment_assets"]) {
    const active = await db()
      .collection(`workspaces/${workspaceId}/${collection}`)
      .where("status", "==", "active").get();
    assert.equal(active.size, 1, `${collection} padrão`);
    assert.equal(active.docs[0].get("profileType"), type);
  }
  const [created] = await membershipEvents(workspaceId, "workspace.created");
  assert.equal(
    (created.after as Record<string, unknown>).defaultCatalogItems,
    expected,
  );
};

test("createWorkspace entrega PF e PJ já provisionados", async () => {
  const uid = uniqueId("prov-create");
  await seedActiveAccount(uid);
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
  // Falha injetada na escrita da conta de investimento padrão: o workspace,
  // o membership, o índice e parte do catálogo já foram enfileirados.
  const faulty = {
    create(this: Transaction, ...args: Parameters<typeof originalCreate>) {
      if (args[0].path.includes("/investment_accounts/")) {
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
