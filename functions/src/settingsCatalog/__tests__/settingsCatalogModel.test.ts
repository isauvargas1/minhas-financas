import assert from "node:assert/strict";
import test from "node:test";

import {Timestamp} from "firebase-admin/firestore";

import {
  archiveSettingsCatalogItemPayloadSchema,
  createSettingsCatalogItemPayloadSchema,
  updateSettingsCatalogItemPayloadSchema,
} from "../contracts";
import {
  CATEGORY_TRANSACTION_SUBTYPES,
  SETTINGS_CATALOG_GROUPS,
  catalogDedupeKey,
  catalogItemIdFor,
  catalogScopeFor,
  catalogSeedDocumentId,
  catalogUniqueLockIdFor,
  normalizeCatalogName,
  readAuthoritativeCatalogItem,
} from "../model";
import {
  GENERAL_CATALOG_SEEDS,
  INVESTMENT_CATEGORY_SEED_NAMES,
  catalogSeedsFor,
} from "../seeds";

/**
 * P4-E (D-23) — modelo e contratos do catálogo, sem Emulator: grupos e
 * subtipos canônicos, normalização, chave de unicidade, escopo derivado,
 * IDs determinísticos, leitura autoritativa e contratos estritos.
 */

const base = {
  workspaceId: "ws-1",
  idempotencyKey: "idem-00000001",
  group: "category",
  name: "Alimentação",
  transactionSubtype: "despesa",
};

test("grupos e subtipos canônicos: sem wallet, tipo técnico nem parcelado",
  () => {
    assert.deepEqual([...SETTINGS_CATALOG_GROUPS].sort(), [
      "category", "cost_center", "expense_type", "income_type",
      "investment_class", "investment_institution", "payment_method",
      "product_service",
    ]);
    assert.deepEqual([...CATEGORY_TRANSACTION_SUBTYPES],
      ["receita", "despesa", "investimento"]);
    for (const seed of GENERAL_CATALOG_SEEDS) {
      assert.notEqual(seed.transactionSubtype, "parcelado");
      assert.ok((SETTINGS_CATALOG_GROUPS as readonly string[])
        .includes(seed.group));
    }
  });

test("normalização, chave de unicidade e escopo derivado do workspace", () => {
  assert.equal(normalizeCatalogName("  Ação   E  REAÇÃO "), "acao e reacao");
  assert.equal(
    catalogDedupeKey("category", "despesa", "both", " Saúde "),
    "category::despesa::both::saude");
  assert.equal(catalogDedupeKey("payment_method", undefined, "both", "Pix"),
    "payment_method::all::both::pix");
  assert.equal(catalogScopeFor("cost_center", "PJ"), "PJ");
  assert.equal(catalogScopeFor("cost_center", "PF"), null);
  assert.equal(catalogScopeFor("investment_class", "PF"), "PF");
  assert.equal(catalogScopeFor("investment_class", "PJ"), "PJ");
  for (const group of ["product_service", "expense_type", "category",
    "payment_method", "income_type", "investment_institution"] as const) {
    assert.equal(catalogScopeFor(group, "PF"), "both", group);
    assert.equal(catalogScopeFor(group, "PJ"), "both", group);
  }
});

test("IDs determinísticos: semente estável, reserva com hash (aceita `/`)",
  () => {
    const seedId = catalogSeedDocumentId(
      "category", "investimento", "both", "Tesouro Direto");
    assert.match(seedId, /^seed_[0-9a-f]{24}$/);
    assert.equal(seedId, catalogSeedDocumentId(
      "category", "investimento", "both", " tesouro  DIRETO"));
    assert.notEqual(seedId, catalogSeedDocumentId(
      "category", "despesa", "both", "Tesouro Direto"));
    const lock = catalogUniqueLockIdFor("category::despesa::both::agua/luz");
    assert.match(lock, /^lock_[0-9a-f]{40}$/);
    assert.match(catalogItemIdFor("ws", "uid", "idem-1"), /^cat_[0-9a-f]{40}$/);
    // Sementes PF sem centro de custo; PJ com; carteiras pelo perfil.
    const pf = catalogSeedsFor("PF");
    const pj = catalogSeedsFor("PJ");
    assert.equal(pf.some((seed) => seed.group === "cost_center"), false);
    assert.equal(pj.filter((seed) => seed.group === "cost_center").length, 3);
    // 22 gerais + 3 carteiras (PF); + 3 centros de custo (PJ).
    assert.equal(pf.length, 25);
    assert.equal(pj.length, 28);
    assert.deepEqual(
      pf.filter((seed) => seed.transactionSubtype === "investimento")
        .map((seed) => seed.name),
      [...INVESTMENT_CATEGORY_SEED_NAMES]);
  });

test("contrato de criação: estrito, sem autoria, escopo, chave nem parcelado",
  () => {
    assert.equal(createSettingsCatalogItemPayloadSchema.safeParse(base).success,
      true);
    assert.equal(createSettingsCatalogItemPayloadSchema.parse(
      {...base, name: "  Mercado  "}).name, "Mercado");
    const invalid: Array<Record<string, unknown>> = [
      {workspaceScope: "both"}, {normalizedName: "x"}, {dedupeKey: "x"},
      {createdBy: "u"}, {updatedBy: "u"}, {userId: "u"}, {createdAt: 1},
      {updatedAt: 1}, {schemaVersion: 1}, {group: "wallet"},
      {group: "investment_type"}, {group: "investment_strategy"},
      {transactionSubtype: "parcelado"}, {transactionSubtype: undefined},
      {group: "income_type"}, {name: ""}, {name: " ".repeat(5)},
      {name: "n".repeat(121)}, {name: "a\u0000b"}, {icon: "a b"},
      {icon: "x".repeat(81)}, {icon: "IconA", color: "#12345"},
      {icon: "IconA", color: "blue"}, {color: "#fff"}, {stroke: 2},
      {icon: "IconA", stroke: Number.NaN},
      {icon: "IconA", stroke: Number.POSITIVE_INFINITY},
      {icon: "IconA", stroke: 0.5}, {icon: "IconA", stroke: 1.2},
      {icon: "IconA", stroke: 5}, {sortOrder: -1}, {sortOrder: 0.5},
      {sortOrder: Number.NaN}, {sortOrder: 1e14}, {status: "archived"},
      {idempotencyKey: "curta"}, {workspaceId: "a/b"},
    ];
    for (const change of invalid) {
      assert.equal(
        createSettingsCatalogItemPayloadSchema.safeParse({...base, ...change})
          .success,
        false,
        JSON.stringify(change));
    }
    assert.equal(createSettingsCatalogItemPayloadSchema.safeParse({...base,
      icon: "IconStar", color: "#abc", stroke: 2.5, sortOrder: 10,
      status: "inactive"}).success, true);
  });

test("contrato de edição e inativação: versão obrigatória, campos fixos",
  () => {
    const mutation = {workspaceId: "ws-1", idempotencyKey: "idem-00000002",
      itemId: "cat_1", expectedUpdatedAt: "2026-10-07T12:00:00.123456789Z"};
    assert.equal(updateSettingsCatalogItemPayloadSchema.safeParse({...mutation,
      changes: {name: "Novo", icon: null, status: "active"}}).success, true);
    for (const changes of [{}, {group: "category"}, {transactionSubtype: "x"},
      {workspaceScope: "PF"}, {dedupeKey: "x"}, {updatedBy: "u"},
      {status: "deleted"}, {stroke: 9}]) {
      assert.equal(updateSettingsCatalogItemPayloadSchema.safeParse(
        {...mutation, changes}).success, false, JSON.stringify(changes));
    }
    assert.equal(updateSettingsCatalogItemPayloadSchema.safeParse(
      {...mutation, expectedUpdatedAt: "ontem", changes: {name: "x"}})
      .success, false);
    assert.equal(archiveSettingsCatalogItemPayloadSchema.safeParse(mutation)
      .success, true);
    assert.equal(archiveSettingsCatalogItemPayloadSchema.safeParse(
      {...mutation, status: "inactive"}).success, false);
    const {expectedUpdatedAt: _omit, ...withoutVersion} = mutation;
    void _omit;
    assert.equal(archiveSettingsCatalogItemPayloadSchema.safeParse(
      withoutVersion).success, false);
  });

test("leitura autoritativa recusa documento incoerente", () => {
  const valid = {
    schemaVersion: 1, workspaceId: "ws-1", group: "category",
    name: "Saúde", normalizedName: "saude",
    dedupeKey: "category::despesa::both::saude", workspaceScope: "both",
    transactionSubtype: "despesa", sortOrder: 10, status: "active",
    createdBy: "u", updatedBy: "u", updatedAt: Timestamp.now(),
  };
  assert.ok(readAuthoritativeCatalogItem("i", valid, "ws-1"));
  const broken: Array<Record<string, unknown>> = [
    {schemaVersion: 2}, {workspaceId: "ws-2"}, {group: "wallet"},
    {transactionSubtype: "parcelado"}, {transactionSubtype: undefined},
    {normalizedName: "outro"}, {dedupeKey: "category::despesa::both::x"},
    {workspaceScope: "PJ"}, {status: "deleted"}, {sortOrder: 1.5},
    {updatedAt: "ontem"}, {color: "#fff"}, {icon: "a b"},
    {group: "cost_center", transactionSubtype: undefined,
      dedupeKey: "cost_center::all::both::saude"},
  ];
  for (const change of broken) {
    assert.equal(readAuthoritativeCatalogItem("i", {...valid, ...change},
      "ws-1"), null, JSON.stringify(change));
  }
  assert.equal(readAuthoritativeCatalogItem("i", valid, "ws-2"), null);
});
