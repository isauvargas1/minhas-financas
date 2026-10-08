import assert from "node:assert/strict";
import test from "node:test";

import type * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {seedLoanTenant} from "../../loans/testSupport/loanTestSupport";
import {formatIsoInstant} from "../../shared/commitTime";
import {seedMember} from "../../shared/testSupport/kernelTestSupport";
import type {WorkspaceActor} from "../../shared/workspaceAuth";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  archiveSettingsCatalogItem,
  createSettingsCatalogItem,
  updateSettingsCatalogItem,
} from "../callables";
import type {SettingsCatalogMutationResult} from "../contracts";
import {
  SETTINGS_CATALOG_ITEM_LIMIT_PER_WORKSPACE,
  catalogItemIdFor,
  catalogUniqueLockIdFor,
  readAuthoritativeCatalogItem,
} from "../model";
import {
  CATALOG_ALREADY_INACTIVE_MESSAGE,
  CATALOG_CONFLICT_MESSAGE,
  CATALOG_COST_CENTER_PJ_ONLY_MESSAGE,
  CATALOG_DUPLICATE_INACTIVE_MESSAGE,
  CATALOG_DUPLICATE_MESSAGE,
  CATALOG_IDEMPOTENCY_CONFLICT_MESSAGE,
  CATALOG_LIMIT_MESSAGE,
  CATALOG_UNCHANGED_MESSAGE,
  executeArchiveSettingsCatalogItem,
  executeCreateSettingsCatalogItem,
  executeUpdateSettingsCatalogItem,
} from "../operations";

/**
 * P4-E (D-23) — catálogo de configurações backend-authoritative, no
 * Emulator: papéis, isolamento, contrato estrito, escopo PF/PJ, unicidade
 * transacional (item + reserva), renomear atômico, inativar/reativar,
 * concorrência, idempotência, falha antes do commit e auditoria sem texto
 * livre.
 */

type Tenant = Awaited<ReturnType<typeof seedLoanTenant>>;

const itemsRef = (workspaceId: string) =>
  db().collection(`workspaces/${workspaceId}/settings_catalog`);
const locksRef = (workspaceId: string) =>
  db().collection(`workspaces/${workspaceId}/settings_catalog_uniques`);
const eventsRef = (workspaceId: string) =>
  db().collection(`workspaces/${workspaceId}/settings_catalog_events`);

const readItem = async (workspaceId: string, itemId: string) =>
  (await itemsRef(workspaceId).doc(itemId).get()).data() ?? {};

const versionOf = async (workspaceId: string, itemId: string) =>
  formatIsoInstant((await itemsRef(workspaceId).doc(itemId).get())
    .get("updatedAt") as Timestamp);

const countOf = async (ref: admin.firestore.Query) =>
  (await ref.count().get()).data().count;

const eventsOf = async (workspaceId: string) =>
  (await eventsRef(workspaceId).get()).docs.map((doc) => doc.data());

const create = (uid: string | null, payload: Record<string, unknown>) =>
  call<SettingsCatalogMutationResult>(createSettingsCatalogItem, uid,
    {idempotencyKey: idempotencyKey(), ...payload});
const update = (uid: string, payload: Record<string, unknown>) =>
  call<SettingsCatalogMutationResult>(updateSettingsCatalogItem, uid,
    {idempotencyKey: idempotencyKey(), ...payload});
const archive = (uid: string, payload: Record<string, unknown>) =>
  call<SettingsCatalogMutationResult>(archiveSettingsCatalogItem, uid,
    {idempotencyKey: idempotencyKey(), ...payload});

const category = (
  t: Tenant,
  name: string,
  transactionSubtype = "despesa",
) => ({workspaceId: t.workspaceId, group: "category", name,
  transactionSubtype});

const actorOf = (
  t: Tenant,
  uid: string,
  role: WorkspaceActor["role"] = "owner",
): WorkspaceActor => ({uid, workspaceId: t.workspaceId, role});

/**
 * Prova estrutural do catálogo: todo item está no formato autoritativo e é
 * dono da reserva da sua chave; toda reserva aponta para um item existente
 * cuja chave é a dela. Uma reserva por item, nem mais nem menos.
 */
const assertCatalogCoherent = async (workspaceId: string) => {
  const items = (await itemsRef(workspaceId).get()).docs;
  const locks = (await locksRef(workspaceId).get()).docs;
  assert.equal(locks.length, items.length, "uma reserva por item");
  const byId = new Map(items.map((doc) => [doc.id, doc]));
  for (const doc of items) {
    const item = readAuthoritativeCatalogItem(doc.id, doc.data(), workspaceId);
    assert.ok(item, `item fora do formato autoritativo: ${doc.id}`);
    const lock = locks.find((entry) =>
      entry.id === catalogUniqueLockIdFor(item.dedupeKey));
    assert.ok(lock, `item sem reserva: ${doc.id}`);
    assert.equal(lock.get("catalogItemId"), doc.id);
    assert.equal(lock.get("dedupeKey"), item.dedupeKey);
  }
  for (const lock of locks) {
    const owner = byId.get(String(lock.get("catalogItemId")));
    assert.ok(owner, `reserva órfã: ${lock.id}`);
    assert.equal(owner.get("dedupeKey"), lock.get("dedupeKey"));
  }
};

// ------------------------------------------------------------------ criação

for (const type of ["PF", "PJ"] as const) {
  test(`P4-E — ${type}: owner e admin criam; item, reserva e auditoria no ` +
    "mesmo commit, com escopo e chave derivados pelo backend", async () => {
    const t = await seedLoanTenant(type, `cat-create-${type.toLowerCase()}`);
    const byOwner = await create(t.owner, category(t, "  Alimentação   Fora "));
    assert.equal(byOwner.replayed, false);
    assert.equal(byOwner.status, "active");
    const item = await readItem(t.workspaceId, byOwner.itemId);
    assert.equal(item.name, "Alimentação   Fora");
    assert.equal(item.normalizedName, "alimentacao fora");
    assert.equal(item.dedupeKey, "category::despesa::both::alimentacao fora");
    assert.equal(item.workspaceScope, "both");
    assert.equal(item.transactionSubtype, "despesa");
    assert.equal(item.createdBy, t.owner);
    assert.equal(item.updatedBy, t.owner);
    assert.equal(item.schemaVersion, 1);
    assert.ok(item.createdAt instanceof Timestamp);
    const lock = await locksRef(t.workspaceId)
      .doc(catalogUniqueLockIdFor(item.dedupeKey)).get();
    assert.equal(lock.get("catalogItemId"), byOwner.itemId);

    const byAdmin = await create(t.admin, {workspaceId: t.workspaceId,
      group: "investment_class", name: "Viagens"});
    assert.equal((await readItem(t.workspaceId, byAdmin.itemId))
      .workspaceScope, type, "carteira de investimentos no escopo do perfil");
    const institution = await create(t.admin, {workspaceId: t.workspaceId,
      group: "investment_institution", name: "Banco Azul", icon: "IconBuildingBank",
      color: "#123abc", stroke: 1.5});
    const institutionItem = await readItem(t.workspaceId, institution.itemId);
    assert.equal(institutionItem.workspaceScope, "both");
    assert.deepEqual([institutionItem.icon, institutionItem.color,
      institutionItem.stroke], ["IconBuildingBank", "#123abc", 1.5]);

    if (type === "PJ") {
      const center = await create(t.owner, {workspaceId: t.workspaceId,
        group: "cost_center", name: "Diretoria"});
      assert.equal((await readItem(t.workspaceId, center.itemId))
        .workspaceScope, "PJ");
    } else {
      await expectHttpsError(create(t.owner, {workspaceId: t.workspaceId,
        group: "cost_center", name: "Diretoria"}), "failed-precondition",
      {message: CATALOG_COST_CENTER_PJ_ONLY_MESSAGE});
    }

    const events = await eventsOf(t.workspaceId);
    const created = events.filter((event) =>
      event.operation === "settings_catalog.created");
    assert.equal(created.length, type === "PJ" ? 4 : 3);
    for (const event of events) {
      // Auditoria sem texto livre: nenhum campo carrega o nome digitado.
      assert.ok(!JSON.stringify(event).includes("Alimenta"));
      assert.ok(!JSON.stringify(event).includes("Banco Azul"));
      assert.equal(event.workspaceId, t.workspaceId);
      assert.ok(["owner", "admin"].includes(event.actorRole));
    }
    await assertCatalogCoherent(t.workspaceId);
  });
}

test("P4-E — member, viewer, sem login, removido e workspace arquivado não " +
  "gravam; nada é escrito", async () => {
  const t = await seedLoanTenant("PF", "cat-rbac");
  const before = await countOf(itemsRef(t.workspaceId));
  for (const uid of [t.member, t.viewer]) {
    await expectHttpsError(create(uid, category(t, `Negado ${uid}`)),
      "permission-denied");
  }
  await expectHttpsError(create(null, category(t, "Anônimo")),
    "unauthenticated");
  const owned = await create(t.owner, category(t, "Mercado"));
  const version = await versionOf(t.workspaceId, owned.itemId);
  for (const uid of [t.member, t.viewer]) {
    await expectHttpsError(update(uid, {workspaceId: t.workspaceId,
      itemId: owned.itemId, expectedUpdatedAt: version,
      changes: {name: "Invasão"}}), "permission-denied");
    await expectHttpsError(archive(uid, {workspaceId: t.workspaceId,
      itemId: owned.itemId, expectedUpdatedAt: version}), "permission-denied");
  }
  // Removido: a pré-checagem do kernel já recusa.
  await seedMember(t.workspaceId, t.admin, "admin", "removed");
  await expectHttpsError(create(t.admin, category(t, "Removido")),
    "permission-denied");
  // Workspace arquivado: somente leitura.
  await db().doc(`workspaces/${t.workspaceId}`).update({status: "archived"});
  await expectHttpsError(create(t.owner, category(t, "Arquivado")),
    "failed-precondition", {reason: "workspace_archived"});
  await expectHttpsError(archive(t.owner, {workspaceId: t.workspaceId,
    itemId: owned.itemId, expectedUpdatedAt: version}),
  "failed-precondition", {reason: "workspace_archived"});
  assert.equal(await countOf(itemsRef(t.workspaceId)), before + 1);
  assert.equal((await readItem(t.workspaceId, owned.itemId)).name, "Mercado");
  await assertCatalogCoherent(t.workspaceId);
});

test("P4-E — papel perdido ou membership removido entre a pré-checagem e a " +
  "transação: a releitura recusa", async () => {
  const t = await seedLoanTenant("PJ", "cat-race-role");
  const owned = await create(t.admin, category(t, "Logística"));
  const version = await versionOf(t.workspaceId, owned.itemId);
  // O ator chegou ao handler como admin; antes do commit foi rebaixado.
  await seedMember(t.workspaceId, t.admin, "member");
  await assert.rejects(executeUpdateSettingsCatalogItem(
    actorOf(t, t.admin, "admin"), {workspaceId: t.workspaceId,
      idempotencyKey: idempotencyKey(), itemId: owned.itemId,
      expectedUpdatedAt: version, changes: {name: "Rebaixado"}}, "req-demoted"),
  (error: {code?: string}) => error.code === "workspace_role_denied");
  await seedMember(t.workspaceId, t.otherMember, "admin");
  await seedMember(t.workspaceId, t.otherMember, "admin", "removed");
  await assert.rejects(executeCreateSettingsCatalogItem(
    actorOf(t, t.otherMember, "admin"), {...category(t, "Fantasma"),
      group: "category", transactionSubtype: "despesa",
      idempotencyKey: idempotencyKey()}, "req-removed"),
  (error: {code?: string}) =>
    error.code === "workspace_membership_required");
  assert.equal((await readItem(t.workspaceId, owned.itemId)).name, "Logística");
  await assertCatalogCoherent(t.workspaceId);
});

test("P4-E — isolamento: item de outro workspace não é alcançável e o " +
  "dono de outro tenant não grava aqui", async () => {
  const a = await seedLoanTenant("PF", "cat-ta");
  const b = await seedLoanTenant("PF", "cat-tb");
  const itemB = await create(b.owner, category(b, "Exclusivo de B"));
  const versionB = await versionOf(b.workspaceId, itemB.itemId);
  // Owner de A no workspace de B: sem membership.
  await expectHttpsError(create(a.owner, category(b, "Invasor")),
    "permission-denied");
  await expectHttpsError(archive(a.owner, {workspaceId: b.workspaceId,
    itemId: itemB.itemId, expectedUpdatedAt: versionB}), "permission-denied");
  // Item de B informado no workspace de A: não existe ali.
  await expectHttpsError(update(a.owner, {workspaceId: a.workspaceId,
    itemId: itemB.itemId, expectedUpdatedAt: versionB,
    changes: {name: "Roubado"}}), "not-found");
  await expectHttpsError(archive(a.owner, {workspaceId: a.workspaceId,
    itemId: itemB.itemId, expectedUpdatedAt: versionB}), "not-found");
  assert.equal((await readItem(b.workspaceId, itemB.itemId)).status, "active");
  assert.equal((await readItem(b.workspaceId, itemB.itemId)).name,
    "Exclusivo de B");
});

test("P4-E — contrato estrito: autoria, escopo, chave, grupo removido, " +
  "subtipo parcelado e limites são recusados", async () => {
  const t = await seedLoanTenant("PJ", "cat-contract");
  const base = category(t, "Válida");
  for (const extra of [
    {workspaceScope: "both"}, {normalizedName: "valida"},
    {dedupeKey: "category::despesa::both::valida"}, {createdBy: t.owner},
    {updatedBy: t.owner}, {userId: t.owner}, {createdAt: "2026-01-01"},
    {catalogItemId: "x"}, {schemaVersion: 1},
  ]) {
    await expectHttpsError(create(t.owner, {...base, ...extra}),
      "invalid-argument");
  }
  for (const invalid of [
    {group: "wallet"}, {group: "investment_type"}, {group: "investment_risk"},
    {transactionSubtype: "parcelado"}, {transactionSubtype: undefined},
    {group: "payment_method", transactionSubtype: "despesa"},
    {name: ""}, {name: "   "}, {name: "x".repeat(121)}, {name: "a\u0007b"},
    {icon: "<svg>"}, {icon: "I".repeat(81)}, {color: "red"},
    {icon: "IconStar", stroke: 0.5}, {icon: "IconStar", stroke: 1.25},
    {icon: "IconStar", stroke: 4.5}, {color: "#fff"},
    {sortOrder: -1}, {sortOrder: 1.5}, {sortOrder: 1e16},
    {status: "deleted"},
  ]) {
    await expectHttpsError(create(t.owner, {...base, ...invalid}),
      "invalid-argument");
  }
  const created = await create(t.owner, base);
  const version = await versionOf(t.workspaceId, created.itemId);
  for (const changes of [
    {}, {group: "income_type"}, {transactionSubtype: "receita"},
    {workspaceScope: "PJ"}, {dedupeKey: "x"}, {updatedBy: t.admin},
  ]) {
    await expectHttpsError(update(t.owner, {workspaceId: t.workspaceId,
      itemId: created.itemId, expectedUpdatedAt: version, changes}),
    "invalid-argument");
  }
  await expectHttpsError(update(t.owner, {workspaceId: t.workspaceId,
    itemId: created.itemId, expectedUpdatedAt: "ontem",
    changes: {name: "Outra"}}), "invalid-argument");
  // Cor sem ícone, numa edição de item sem ícone.
  await expectHttpsError(update(t.owner, {workspaceId: t.workspaceId,
    itemId: created.itemId, expectedUpdatedAt: version,
    changes: {color: "#ff0000"}}), "invalid-argument");
  assert.equal(await countOf(itemsRef(t.workspaceId)), 1);
  await assertCatalogCoherent(t.workspaceId);
});

// --------------------------------------------------------------- unicidade

test("P4-E — nome repetido (acentos, caixa e espaços) é recusado; o mesmo " +
  "nome em outro subtipo ou grupo não colide", async () => {
  const t = await seedLoanTenant("PF", "cat-dup");
  await create(t.owner, category(t, "Reembolso Médico"));
  for (const name of ["reembolso medico", "  REEMBOLSO   MÉDICO ",
    "Reembolso médico"]) {
    await expectHttpsError(create(t.admin, category(t, name)),
      "already-exists", {message: CATALOG_DUPLICATE_MESSAGE});
  }
  await create(t.owner, category(t, "Reembolso Médico", "receita"));
  await create(t.owner, {workspaceId: t.workspaceId,
    group: "product_service", name: "Reembolso Médico"});
  assert.equal(await countOf(itemsRef(t.workspaceId)), 3);
  await assertCatalogCoherent(t.workspaceId);
});

test("P4-E — criações simultâneas do mesmo nome: exatamente uma vence; a " +
  "outra falha de forma determinística", async () => {
  const t = await seedLoanTenant("PF", "cat-dup-race");
  const outcomes = await Promise.allSettled(Array.from({length: 4},
    (_, index) => create(index % 2 ? t.owner : t.admin,
      category(t, index % 2 ? "Farmácia" : "farmacia"))));
  const done = outcomes.filter((outcome) => outcome.status === "fulfilled");
  assert.equal(done.length, 1, JSON.stringify(outcomes.map((o) => o.status)));
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      const error = outcome.reason as {code?: string; message?: string};
      assert.ok(error.code === "already-exists" || error.code === "aborted",
        `código inesperado: ${error.code}`);
    }
  }
  assert.equal(await countOf(itemsRef(t.workspaceId)), 1);
  await assertCatalogCoherent(t.workspaceId);
});

// ---------------------------------------------------------------- renomear

test("P4-E — renomear move a reserva no mesmo commit e preserva ID, autoria " +
  "e criação; só grafia mantém a reserva", async () => {
  const t = await seedLoanTenant("PF", "cat-rename");
  const created = await create(t.owner, category(t, "Combustível"));
  const before = await readItem(t.workspaceId, created.itemId);
  const oldLock = catalogUniqueLockIdFor(String(before.dedupeKey));
  const renamed = await update(t.admin, {workspaceId: t.workspaceId,
    itemId: created.itemId,
    expectedUpdatedAt: await versionOf(t.workspaceId, created.itemId),
    changes: {name: "Posto de Gasolina"}});
  assert.deepEqual([renamed.itemId, renamed.changed, renamed.replayed],
    [created.itemId, true, false]);
  const after = await readItem(t.workspaceId, created.itemId);
  assert.equal(after.name, "Posto de Gasolina");
  assert.equal(after.dedupeKey, "category::despesa::both::posto de gasolina");
  assert.equal(after.createdBy, t.owner);
  assert.equal(after.updatedBy, t.admin);
  assert.ok((after.createdAt as Timestamp).isEqual(
    before.createdAt as Timestamp));
  assert.equal((await locksRef(t.workspaceId).doc(oldLock).get()).exists,
    false, "a reserva antiga foi liberada");
  // O nome antigo volta a ficar livre.
  await create(t.owner, category(t, "Combustível"));

  // Só grafia: mesma chave, mesma reserva.
  const lockBefore = catalogUniqueLockIdFor(String(after.dedupeKey));
  await update(t.owner, {workspaceId: t.workspaceId, itemId: created.itemId,
    expectedUpdatedAt: await versionOf(t.workspaceId, created.itemId),
    changes: {name: "posto de gasolina"}});
  const recased = await readItem(t.workspaceId, created.itemId);
  assert.equal(recased.name, "posto de gasolina");
  assert.equal(catalogUniqueLockIdFor(String(recased.dedupeKey)), lockBefore);

  const renames = (await eventsOf(t.workspaceId)).filter((event) =>
    event.operation === "settings_catalog.renamed");
  assert.deepEqual(renames.map((event) =>
    (event.after as Record<string, unknown>).nameKeyChanged).sort(),
  [false, true]);
  await assertCatalogCoherent(t.workspaceId);
});

test("P4-E — renomear para nome ocupado é recusado sem efeito; edição com " +
  "versão antiga não sobrescreve", async () => {
  const t = await seedLoanTenant("PJ", "cat-rename-dup");
  const a = await create(t.owner, category(t, "Aluguel"));
  await create(t.owner, category(t, "Condomínio"));
  const version = await versionOf(t.workspaceId, a.itemId);
  await expectHttpsError(update(t.owner, {workspaceId: t.workspaceId,
    itemId: a.itemId, expectedUpdatedAt: version,
    changes: {name: "condominio", icon: "IconHome"}}), "already-exists",
  {message: CATALOG_DUPLICATE_MESSAGE});
  const unchanged = await readItem(t.workspaceId, a.itemId);
  assert.equal(unchanged.name, "Aluguel");
  assert.equal(unchanged.icon, undefined);
  await update(t.owner, {workspaceId: t.workspaceId, itemId: a.itemId,
    expectedUpdatedAt: version, changes: {icon: "IconHome"}});
  // A mesma versão de antes: outra operação já mudou o item.
  await expectHttpsError(update(t.admin, {workspaceId: t.workspaceId,
    itemId: a.itemId, expectedUpdatedAt: version,
    changes: {name: "Aluguel Comercial"}}), "aborted",
  {message: CATALOG_CONFLICT_MESSAGE});
  await expectHttpsError(update(t.owner, {workspaceId: t.workspaceId,
    itemId: a.itemId,
    expectedUpdatedAt: await versionOf(t.workspaceId, a.itemId),
    changes: {icon: "IconHome"}}), "failed-precondition",
  {message: CATALOG_UNCHANGED_MESSAGE});
  // Sem ícone, cor e espessura saem junto.
  await update(t.owner, {workspaceId: t.workspaceId, itemId: a.itemId,
    expectedUpdatedAt: await versionOf(t.workspaceId, a.itemId),
    changes: {color: "#00aa00", stroke: 3}});
  await update(t.owner, {workspaceId: t.workspaceId, itemId: a.itemId,
    expectedUpdatedAt: await versionOf(t.workspaceId, a.itemId),
    changes: {icon: null}});
  const cleared = await readItem(t.workspaceId, a.itemId);
  assert.deepEqual([cleared.icon, cleared.color, cleared.stroke],
    [undefined, undefined, undefined]);
  await assertCatalogCoherent(t.workspaceId);
});

test("P4-E — dois renomear para a mesma chave e renomear A→B contra criar " +
  "B: exatamente um vence, reservas coerentes", async () => {
  const t = await seedLoanTenant("PF", "cat-rename-race");
  const x = await create(t.owner, category(t, "Item X"));
  const y = await create(t.owner, category(t, "Item Y"));
  const [vx, vy] = await Promise.all([
    versionOf(t.workspaceId, x.itemId), versionOf(t.workspaceId, y.itemId)]);
  const renames = await Promise.allSettled([
    update(t.owner, {workspaceId: t.workspaceId, itemId: x.itemId,
      expectedUpdatedAt: vx, changes: {name: "Destino Comum"}}),
    update(t.admin, {workspaceId: t.workspaceId, itemId: y.itemId,
      expectedUpdatedAt: vy, changes: {name: "destino comum"}}),
  ]);
  assert.equal(renames.filter((o) => o.status === "fulfilled").length, 1,
    JSON.stringify(renames.map((o) => o.status)));
  await assertCatalogCoherent(t.workspaceId);

  const z = await create(t.owner, category(t, "Item Z"));
  const vz = await versionOf(t.workspaceId, z.itemId);
  const race = await Promise.allSettled([
    update(t.owner, {workspaceId: t.workspaceId, itemId: z.itemId,
      expectedUpdatedAt: vz, changes: {name: "Novo Nome"}}),
    create(t.admin, category(t, "novo nome")),
  ]);
  assert.equal(race.filter((o) => o.status === "fulfilled").length, 1,
    JSON.stringify(race.map((o) => o.status)));
  const holders = (await itemsRef(t.workspaceId)
    .where("normalizedName", "==", "novo nome").get()).size;
  assert.equal(holders, 1);
  await assertCatalogCoherent(t.workspaceId);
});

// ---------------------------------------------------- inativar e reativar

test("P4-E — inativar mantém documento e reserva; o mesmo nome orienta a " +
  "reativar; reativar revalida e devolve ao uso", async () => {
  const t = await seedLoanTenant("PJ", "cat-archive");
  const created = await create(t.owner, {workspaceId: t.workspaceId,
    group: "cost_center", name: "Marketing"});
  const archived = await archive(t.admin, {workspaceId: t.workspaceId,
    itemId: created.itemId,
    expectedUpdatedAt: await versionOf(t.workspaceId, created.itemId)});
  assert.deepEqual([archived.status, archived.replayed], ["inactive", false]);
  const item = await readItem(t.workspaceId, created.itemId);
  assert.equal(item.status, "inactive");
  assert.equal((await locksRef(t.workspaceId)
    .doc(catalogUniqueLockIdFor(String(item.dedupeKey))).get())
    .get("catalogItemId"), created.itemId, "a reserva permanece");
  await expectHttpsError(create(t.owner, {workspaceId: t.workspaceId,
    group: "cost_center", name: "marketing"}), "already-exists",
  {message: CATALOG_DUPLICATE_INACTIVE_MESSAGE});
  await expectHttpsError(archive(t.owner, {workspaceId: t.workspaceId,
    itemId: created.itemId,
    expectedUpdatedAt: await versionOf(t.workspaceId, created.itemId)}),
  "failed-precondition", {message: CATALOG_ALREADY_INACTIVE_MESSAGE});

  const reactivated = await update(t.owner, {workspaceId: t.workspaceId,
    itemId: created.itemId,
    expectedUpdatedAt: await versionOf(t.workspaceId, created.itemId),
    changes: {status: "active"}});
  assert.equal(reactivated.status, "active");
  assert.equal((await readItem(t.workspaceId, created.itemId)).status,
    "active");
  // Inativar pela edição também é inativar (evento archived).
  await update(t.owner, {workspaceId: t.workspaceId, itemId: created.itemId,
    expectedUpdatedAt: await versionOf(t.workspaceId, created.itemId),
    changes: {status: "inactive"}});
  const operations = (await eventsOf(t.workspaceId))
    .map((event) => event.operation).sort();
  assert.deepEqual(operations, [
    "settings_catalog.archived", "settings_catalog.archived",
    "settings_catalog.created", "settings_catalog.reactivated",
  ]);
  assert.equal(await countOf(itemsRef(t.workspaceId)), 1, "nada é apagado");
  await assertCatalogCoherent(t.workspaceId);
});

test("P4-E — reativar revalida escopo e consistência: item fora do perfil " +
  "ou com reserva de outro não é reativado", async () => {
  const t = await seedLoanTenant("PF", "cat-reactivate-guard");
  const created = await create(t.owner, {workspaceId: t.workspaceId,
    group: "investment_class", name: "Longo Prazo"});
  await archive(t.owner, {workspaceId: t.workspaceId, itemId: created.itemId,
    expectedUpdatedAt: await versionOf(t.workspaceId, created.itemId)});
  // Documento incoerente com o perfil (escopo PJ num workspace PF).
  const ref = itemsRef(t.workspaceId).doc(created.itemId);
  const original = (await ref.get()).data() ?? {};
  await ref.update({workspaceScope: "PJ",
    dedupeKey: "investment_class::all::PJ::longo prazo"});
  await expectHttpsError(update(t.owner, {workspaceId: t.workspaceId,
    itemId: created.itemId,
    expectedUpdatedAt: await versionOf(t.workspaceId, created.itemId),
    changes: {status: "active"}}), "failed-precondition");
  // Reserva apontando para outro item: recusa, e nada é liberado.
  await ref.set(original);
  const lockRef = locksRef(t.workspaceId)
    .doc(catalogUniqueLockIdFor(String(original.dedupeKey)));
  await lockRef.update({catalogItemId: "cat_outro"});
  await expectHttpsError(update(t.owner, {workspaceId: t.workspaceId,
    itemId: created.itemId,
    expectedUpdatedAt: await versionOf(t.workspaceId, created.itemId),
    changes: {name: "Outro Nome", status: "active"}}), "failed-precondition");
  assert.equal((await lockRef.get()).get("catalogItemId"), "cat_outro");
  assert.equal((await readItem(t.workspaceId, created.itemId)).status,
    "inactive");
});

test("P4-E — inativar e reativar concorrentes na mesma versão: uma operação " +
  "vence, a outra recebe conflito", async () => {
  const t = await seedLoanTenant("PF", "cat-status-race");
  const created = await create(t.owner, category(t, "Assinaturas"));
  const version = await versionOf(t.workspaceId, created.itemId);
  const outcomes = await Promise.allSettled([
    archive(t.owner, {workspaceId: t.workspaceId, itemId: created.itemId,
      expectedUpdatedAt: version}),
    update(t.admin, {workspaceId: t.workspaceId, itemId: created.itemId,
      expectedUpdatedAt: version, changes: {icon: "IconStar"}}),
  ]);
  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1,
    JSON.stringify(outcomes.map((o) => o.status)));
  const rejected = outcomes.find((o) => o.status === "rejected") as
    PromiseRejectedResult;
  assert.equal((rejected.reason as {code?: string}).code, "aborted");
  await assertCatalogCoherent(t.workspaceId);
});

// ------------------------------------------------------------- idempotência

test("P4-E — replay devolve o resultado salvo; a mesma chave com outro " +
  "conteúdo é conflito; a chave expirada não duplica", async () => {
  const t = await seedLoanTenant("PF", "cat-idem");
  const key = idempotencyKey();
  const payload = {...category(t, "Educação Infantil"), idempotencyKey: key};
  const first = await call<SettingsCatalogMutationResult>(
    createSettingsCatalogItem, t.owner, payload);
  const replay = await call<SettingsCatalogMutationResult>(
    createSettingsCatalogItem, t.owner, payload);
  assert.equal(replay.itemId, first.itemId);
  assert.equal(replay.replayed, true);
  assert.equal(first.itemId, catalogItemIdFor(t.workspaceId, t.owner, key));
  await expectHttpsError(call(createSettingsCatalogItem, t.owner,
    {...payload, name: "Outro conteúdo"}), "failed-precondition",
  {message: CATALOG_IDEMPOTENCY_CONFLICT_MESSAGE});
  // Chave expirada (TTL): o evento de criação ancora o replay.
  const keys = await db().collection(`users/${t.owner}/idempotency_keys`).get();
  await Promise.all(keys.docs.map((doc) => doc.ref.delete()));
  const afterExpiry = await call<SettingsCatalogMutationResult>(
    createSettingsCatalogItem, t.owner, payload);
  assert.deepEqual([afterExpiry.itemId, afterExpiry.replayed],
    [first.itemId, true]);

  const version = await versionOf(t.workspaceId, first.itemId);
  const updateKey = idempotencyKey();
  const updatePayload = {workspaceId: t.workspaceId,
    idempotencyKey: updateKey, itemId: first.itemId,
    expectedUpdatedAt: version, changes: {name: "Educação Básica"}};
  const updated = await call<SettingsCatalogMutationResult>(
    updateSettingsCatalogItem, t.owner, updatePayload);
  const updateReplay = await call<SettingsCatalogMutationResult>(
    updateSettingsCatalogItem, t.owner, updatePayload);
  assert.deepEqual([updated.replayed, updateReplay.replayed], [false, true]);
  // Retry depois do commit com a chave expirada: a versão lida já mudou.
  const updateKeys = await db()
    .collection(`users/${t.owner}/idempotency_keys`).get();
  await Promise.all(updateKeys.docs.map((doc) => doc.ref.delete()));
  await expectHttpsError(call(updateSettingsCatalogItem, t.owner,
    updatePayload), "aborted");
  assert.equal(await countOf(itemsRef(t.workspaceId)), 1);
  const renamed = (await eventsOf(t.workspaceId)).filter((event) =>
    event.operation === "settings_catalog.renamed");
  assert.equal(renamed.length, 1, "um efeito só");
  await assertCatalogCoherent(t.workspaceId);
});

test("P4-E — falha antes do commit: nem item, nem reserva, nem evento, nem " +
  "chave de idempotência", async () => {
  const t = await seedLoanTenant("PJ", "cat-fail");
  const key = idempotencyKey();
  await assert.rejects(executeCreateSettingsCatalogItem(actorOf(t, t.owner), {
    workspaceId: t.workspaceId, idempotencyKey: key, group: "category",
    name: "Falha Injetada", transactionSubtype: "receita",
  }, "req-fail-create", {beforeCommit: () => {
    throw new Error("falha injetada");
  }}), /falha injetada/);
  assert.equal(await countOf(itemsRef(t.workspaceId)), 0);
  assert.equal(await countOf(locksRef(t.workspaceId)), 0);
  assert.equal(await countOf(eventsRef(t.workspaceId)), 0);
  assert.equal(await countOf(db()
    .collection(`users/${t.owner}/idempotency_keys`)), 0);

  const created = await create(t.owner, category(t, "Original"));
  const version = await versionOf(t.workspaceId, created.itemId);
  const before = await readItem(t.workspaceId, created.itemId);
  await assert.rejects(executeUpdateSettingsCatalogItem(actorOf(t, t.owner), {
    workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(),
    itemId: created.itemId, expectedUpdatedAt: version,
    changes: {name: "Renomeado"},
  }, "req-fail-update", {beforeCommit: () => {
    throw new Error("falha injetada");
  }}), /falha injetada/);
  await assert.rejects(executeArchiveSettingsCatalogItem(actorOf(t, t.owner), {
    workspaceId: t.workspaceId, idempotencyKey: idempotencyKey(),
    itemId: created.itemId, expectedUpdatedAt: version,
  }, "req-fail-archive", {beforeCommit: () => {
    throw new Error("falha injetada");
  }}), /falha injetada/);
  const after = await readItem(t.workspaceId, created.itemId);
  assert.deepEqual([after.name, after.status, after.dedupeKey],
    [before.name, before.status, before.dedupeKey]);
  assert.equal((await eventsOf(t.workspaceId)).length, 1);
  await assertCatalogCoherent(t.workspaceId);
});

// ---------------------------------------------------------------- teto

test("P4-E — teto de itens por workspace: o seguinte é recusado sem gravar",
  async () => {
    const t = await seedLoanTenant("PF", "cat-cap");
    // Fixtures diretas (Admin SDK) só para chegar perto do teto.
    for (let start = 0; start < SETTINGS_CATALOG_ITEM_LIMIT_PER_WORKSPACE - 1;
      start += 400) {
      const batch = db().batch();
      const end = Math.min(start + 400,
        SETTINGS_CATALOG_ITEM_LIMIT_PER_WORKSPACE - 1);
      for (let index = start; index < end; index += 1) {
        batch.set(itemsRef(t.workspaceId).doc(`fixture_${index}`), {
          workspaceId: t.workspaceId, group: "product_service",
          name: `Item ${index}`, status: "active",
        });
      }
      await batch.commit();
    }
    const last = await create(t.owner, category(t, "Último"));
    assert.equal(last.replayed, false);
    await expectHttpsError(create(t.owner, category(t, "Excedente")),
      "failed-precondition", {message: CATALOG_LIMIT_MESSAGE});
    assert.equal(await countOf(itemsRef(t.workspaceId)),
      SETTINGS_CATALOG_ITEM_LIMIT_PER_WORKSPACE);
    assert.equal(await countOf(locksRef(t.workspaceId)), 1);
  });
