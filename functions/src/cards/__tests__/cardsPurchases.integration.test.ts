import assert from "node:assert/strict";
import test from "node:test";

import {seedMember} from "../../shared/testSupport/kernelTestSupport";
import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {executeArchiveCreditCard} from "../cardOperations";
import {createCreditCardPurchase} from "../callables";
import {
  CARD_ARCHIVED_MESSAGE,
  PURCHASE_LIMIT_INSUFFICIENT_MESSAGE,
} from "../common";
import {invoiceIdFor, installmentEntryIdFor} from "../model";
import {
  PURCHASE_ALREADY_CANCELLED_MESSAGE,
  PURCHASE_ALL_OPEN_MESSAGE,
  PURCHASE_FINANCIAL_LOCKED_MESSAGE,
  PURCHASE_HAS_CLOSED_INSTALLMENTS_MESSAGE,
  MEMBER_PURCHASE_OWNERSHIP_MESSAGE,
  executeCancelCreditCardPurchase,
  executeCreateCreditCardPurchase,
  executeRefundCreditCardPurchase,
  executeUpdateCreditCardPurchase,
} from "../purchaseOperations";
import {
  actorOf,
  assertCardInvariants,
  buy,
  cardEventsOf,
  cardVersion,
  clockAt,
  countOf,
  createCard,
  entriesOf,
  ledgerOf,
  purchasePayload,
  purchaseVersion,
  readCard,
  readInvoice,
  readPurchase,
  requestId,
  seedCardTenant,
  activeEntriesByCompetence,
} from "../testSupport/cardTestSupport";

/**
 * P4-A (D-36) — compras de cartão no Emulator: à vista e parcelada em
 * centavos exatos, compra retroativa, reserva do limite (inclusive a disputa
 * pelo último centavo), idempotência e âncora durável, falha antes do commit,
 * edição, cancelamento, estorno, papéis e isolamento.
 */

const rejectsWith = async (
  promise: Promise<unknown>,
  code: string,
  message?: string | RegExp,
) => {
  await assert.rejects(promise, (error: {code?: string; message?: string}) => {
    assert.equal(error.code, code, error.message);
    if (typeof message === "string") assert.equal(error.message, message);
    else if (message) assert.match(String(error.message), message);
    return true;
  });
};

test("P4-A — compra à vista e parcelada: centavos exatos, faturas, livro do " +
  "limite, evento e nenhum lançamento em `transactions`", async () => {
  const t = await seedCardTenant("PF", "cc-buy");
  const cardId = await createCard(t);
  const single = await buy(t, cardId, "2026-03-10", {totalCents: 100_000});
  assert.equal(single.replayed, false);
  assert.equal(single.retroactive, false);
  assert.equal(single.firstCompetence, "2026-03");
  const purchase = await readPurchase(t.workspaceId, single.purchaseId);
  assert.equal(purchase.source, "manual", "origem fixada pelo backend");
  assert.equal(purchase.status, "active");
  assert.equal(purchase.totalCents, 100_000);
  assert.equal(purchase.installmentsCount, 1);
  assert.equal(purchase.totalAmount, undefined, "nada em ponto flutuante");

  const split = await buy(t, cardId, "2026-03-10",
    {totalCents: 10_000, installmentsCount: 3, description: "Curso"});
  const entries = (await entriesOf(t.workspaceId, cardId))
    .filter((entry) => (entry as Record<string, unknown>).purchaseId ===
      split.purchaseId) as Array<Record<string, unknown>>;
  entries.sort((a, b) => Number(a.installmentNumber) -
    Number(b.installmentNumber));
  assert.deepEqual(entries.map((entry) => entry.amountCents),
    [3334, 3333, 3333], "maior resto: a sobra vai para a primeira parcela");
  assert.deepEqual(entries.map((entry) => entry.competenceMonth),
    ["2026-03", "2026-04", "2026-05"]);
  assert.equal(entries[0].id,
    installmentEntryIdFor(split.purchaseId, 1, 1));
  assert.deepEqual(await activeEntriesByCompetence(t.workspaceId, cardId),
    {"2026-03": 103_334, "2026-04": 3333, "2026-05": 3333});

  const march = await readInvoice(t.workspaceId, cardId, "2026-03");
  assert.equal(march.cycleStatus, "open");
  assert.equal(march.paymentStatus, "unpaid");
  assert.equal(march.closingDate, "2026-03-25");
  assert.equal(march.dueDate, "2026-04-05");
  assert.equal(march.totalCents, 103_334);
  assert.equal(march.activeEntryCount, 2);
  const card = await assertCardInvariants(t.workspaceId, cardId);
  assert.equal(card.limitUsedCents, 110_000);
  assert.equal(card.limitAvailableCents, 390_000);
  assert.equal((await ledgerOf(t.workspaceId, cardId)).length, 2);
  const events = await cardEventsOf(t.workspaceId, cardId);
  assert.equal(events.filter((event) =>
    (event as Record<string, unknown>).operation ===
      "credit_card.purchase_created").length, 2);
  // D-40: compra de cartão não grava `transactions` nem consome a quota.
  assert.equal(await countOf(t.workspaceId, "transactions"), 0);
});

test("P4-A — D-36 retroativa: data mantida, parcelas fechadas vão para a " +
  "primeira fatura aberta", async () => {
  const t = await seedCardTenant("PF", "cc-retro");
  const cardId = await createCard(t);
  const result = await executeCreateCreditCardPurchase(actorOf(t, t.owner),
    purchasePayload(t.workspaceId, cardId, {
      purchaseDate: "2026-01-10", totalCents: 30_001, installmentsCount: 4,
    }), requestId(), clockAt("2026-03-20"));
  assert.equal(result.retroactive, true);
  assert.equal(result.firstCompetence, "2026-03");
  const purchase = await readPurchase(t.workspaceId, result.purchaseId);
  assert.equal(purchase.purchaseDate, "2026-01-10", "data da compra mantida");
  assert.equal(purchase.retroactive, true);
  const entries = (await entriesOf(t.workspaceId, cardId)) as
    Array<Record<string, unknown>>;
  entries.sort((a, b) => Number(a.installmentNumber) -
    Number(b.installmentNumber));
  assert.deepEqual(entries.map((entry) => entry.naturalCompetence),
    ["2026-01", "2026-02", "2026-03", "2026-04"]);
  assert.deepEqual(entries.map((entry) => entry.competenceMonth),
    ["2026-03", "2026-03", "2026-03", "2026-04"]);
  // Nenhuma fatura das competências fechadas foi criada ou alterada.
  assert.deepEqual(await readInvoice(t.workspaceId, cardId, "2026-01"), {});
  assert.deepEqual(await readInvoice(t.workspaceId, cardId, "2026-02"), {});
  assert.equal((await readInvoice(t.workspaceId, cardId, "2026-03"))
    .totalCents, 22_501);
  await assertCardInvariants(t.workspaceId, cardId);
});

test("P4-A — limite: compra acima do disponível é recusada; duas compras " +
  "disputando o último limite: só uma passa, nunca negativo", async () => {
  const t = await seedCardTenant("PF", "cc-limit");
  const cardId = await createCard(t, {limitTotalCents: 10_000});
  await buy(t, cardId, "2026-03-10", {totalCents: 6_000});
  await rejectsWith(buy(t, cardId, "2026-03-10", {totalCents: 4_001}),
    "domain_precondition_failed", PURCHASE_LIMIT_INSUFFICIENT_MESSAGE);
  const outcomes = await Promise.allSettled([
    buy(t, cardId, "2026-03-10", {totalCents: 4_000}),
    buy(t, cardId, "2026-03-10", {totalCents: 4_000}, t.admin),
  ]);
  const fulfilled = outcomes.filter((outcome) =>
    outcome.status === "fulfilled");
  const rejected = outcomes.filter((outcome) =>
    outcome.status === "rejected") as PromiseRejectedResult[];
  assert.equal(fulfilled.length, 1, "exatamente uma compra leva o limite");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "domain_precondition_failed");
  const card = await assertCardInvariants(t.workspaceId, cardId);
  assert.equal(card.limitUsedCents, 10_000);
  assert.equal(card.limitAvailableCents, 0);
});

test("P4-A — idempotência: replay, conflito de conteúdo e âncora durável " +
  "depois do recibo expirado", async () => {
  const t = await seedCardTenant("PF", "cc-idem");
  const cardId = await createCard(t);
  const payload = purchasePayload(t.workspaceId, cardId,
    {purchaseDate: "2026-03-10", totalCents: 12_000, installmentsCount: 2});
  const actor = actorOf(t, t.owner);
  const first = await executeCreateCreditCardPurchase(actor, payload,
    requestId(), clockAt("2026-03-10"));
  const replay = await executeCreateCreditCardPurchase(actor, payload,
    requestId(), clockAt("2026-03-10"));
  assert.equal(replay.replayed, true);
  assert.equal(replay.purchaseId, first.purchaseId);
  await rejectsWith(executeCreateCreditCardPurchase(actor,
    {...payload, totalCents: 12_001}, requestId(), clockAt("2026-03-10")),
  "idempotency_conflict");
  // Recibo temporário expirado: a própria compra é a âncora.
  const keys = await db().collection(`users/${t.owner}/idempotency_keys`)
    .get();
  await Promise.all(keys.docs.map((doc) => doc.ref.delete()));
  const anchored = await executeCreateCreditCardPurchase(actor, payload,
    requestId(), clockAt("2026-03-10"));
  assert.equal(anchored.replayed, true);
  assert.equal(anchored.purchaseId, first.purchaseId);
  await rejectsWith(executeCreateCreditCardPurchase(actor,
    {...payload, totalCents: 12_001}, requestId(), clockAt("2026-03-10")),
  "idempotency_conflict");
  assert.equal(await countOf(t.workspaceId, "credit_card_purchases"), 1);
  assert.equal((await ledgerOf(t.workspaceId, cardId)).length, 1);
  assert.equal((await readCard(t.workspaceId, cardId)).limitUsedCents,
    12_000);
});

test("P4-A — falha antes do commit não grava nada; a repetição da mesma " +
  "intenção cria uma única compra", async () => {
  const t = await seedCardTenant("PF", "cc-fail");
  const cardId = await createCard(t);
  const payload = purchasePayload(t.workspaceId, cardId,
    {purchaseDate: "2026-03-10", totalCents: 9_000, installmentsCount: 3});
  const actor = actorOf(t, t.owner);
  await assert.rejects(executeCreateCreditCardPurchase(actor, payload,
    requestId(), {
      ...clockAt("2026-03-10"),
      beforeCommit: () => {
        throw new Error("falha simulada antes do commit");
      },
    }), /falha simulada/);
  assert.equal(await countOf(t.workspaceId, "credit_card_purchases"), 0);
  assert.equal(await countOf(t.workspaceId, "credit_card_invoice_entries"), 0);
  assert.equal(await countOf(t.workspaceId, "credit_card_invoices"), 0);
  assert.equal(await countOf(t.workspaceId, "credit_card_limit_ledger"), 0);
  assert.equal((await readCard(t.workspaceId, cardId)).limitUsedCents, 0);
  const retry = await executeCreateCreditCardPurchase(actor, payload,
    requestId(), clockAt("2026-03-10"));
  assert.equal(retry.replayed, false);
  assert.equal(await countOf(t.workspaceId, "credit_card_purchases"), 1);
  await assertCardInvariants(t.workspaceId, cardId);
});

test("P4-A — cancelamento com todas as parcelas abertas: lógico, limite " +
  "devolvido, histórico preservado", async () => {
  const t = await seedCardTenant("PF", "cc-cancel");
  const cardId = await createCard(t);
  const bought = await buy(t, cardId, "2026-03-10",
    {totalCents: 9_000, installmentsCount: 3});
  const admin = actorOf(t, t.admin, "admin");
  const cancel = await executeCancelCreditCardPurchase(admin, {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    purchaseId: bought.purchaseId,
    expectedUpdatedAt: await purchaseVersion(t.workspaceId, bought.purchaseId),
  }, requestId(), clockAt("2026-03-12"));
  assert.equal(cancel.restoredLimitCents, 9_000);
  const entries = (await entriesOf(t.workspaceId, cardId)) as
    Array<Record<string, unknown>>;
  assert.equal(entries.length, 3, "nada é apagado");
  assert.ok(entries.every((entry) => entry.status === "cancelled"));
  assert.equal((await readPurchase(t.workspaceId, bought.purchaseId)).status,
    "cancelled");
  for (const competence of ["2026-03", "2026-04", "2026-05"]) {
    const invoice = await readInvoice(t.workspaceId, cardId, competence);
    assert.equal(invoice.totalCents, 0, competence);
    assert.equal(invoice.activeEntryCount, 0, competence);
  }
  const card = await assertCardInvariants(t.workspaceId, cardId);
  assert.equal(card.limitUsedCents, 0);
  const ledger = (await ledgerOf(t.workspaceId, cardId)) as
    Array<Record<string, unknown>>;
  assert.deepEqual(ledger.map((entry) => entry.amountCents).sort(),
    [-9_000, 9_000].sort());
  await rejectsWith(executeCancelCreditCardPurchase(actorOf(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    purchaseId: bought.purchaseId,
    expectedUpdatedAt: await purchaseVersion(t.workspaceId, bought.purchaseId),
  }, requestId(), clockAt("2026-03-12")), "domain_precondition_failed",
  PURCHASE_ALREADY_CANCELLED_MESSAGE);
});

test("P4-A — parcela em fatura fechada: cancelamento recusado; estorno " +
  "credita o faturado na primeira aberta, sem reescrever a fechada",
async () => {
  const t = await seedCardTenant("PF", "cc-refund");
  const cardId = await createCard(t);
  const bought = await buy(t, cardId, "2026-03-10",
    {totalCents: 30_000, installmentsCount: 3});
  const mutation = async () => ({
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    purchaseId: bought.purchaseId,
    expectedUpdatedAt: await purchaseVersion(t.workspaceId, bought.purchaseId),
  });
  // Ainda tudo aberto: estorno aponta o cancelamento.
  await rejectsWith(executeRefundCreditCardPurchase(actorOf(t, t.owner),
    await mutation(), requestId(), clockAt("2026-03-12")),
  "domain_precondition_failed", PURCHASE_ALL_OPEN_MESSAGE);
  // 26/03: a fatura de março já fechou pela data (sem a rotina ter rodado).
  await rejectsWith(executeCancelCreditCardPurchase(actorOf(t, t.owner),
    await mutation(), requestId(), clockAt("2026-03-26")),
  "domain_precondition_failed", PURCHASE_HAS_CLOSED_INSTALLMENTS_MESSAGE);
  const marchBefore = await readInvoice(t.workspaceId, cardId, "2026-03");
  const refund = await executeRefundCreditCardPurchase(actorOf(t, t.owner),
    await mutation(), requestId(), clockAt("2026-03-26"));
  assert.equal(refund.refundedCents, 10_000);
  assert.equal(refund.cancelledOpenCents, 20_000);
  assert.equal(refund.refundCompetence, "2026-04");
  const marchAfter = await readInvoice(t.workspaceId, cardId, "2026-03");
  assert.equal(marchAfter.totalCents, marchBefore.totalCents,
    "fatura de março não foi reescrita");
  assert.equal(marchAfter.revision, marchBefore.revision);
  const april = await readInvoice(t.workspaceId, cardId, "2026-04");
  assert.equal(april.totalCents, -10_000, "crédito do estorno na aberta");
  const refundEntry = ((await entriesOf(t.workspaceId, cardId)) as
    Array<Record<string, unknown>>).find((entry) =>
    entry.kind === "refund_credit");
  assert.ok(refundEntry);
  assert.equal(refundEntry.purchaseId, bought.purchaseId,
    "crédito ligado à compra original");
  assert.equal(refundEntry.invoiceId, invoiceIdFor(cardId, "2026-04"));
  const purchase = await readPurchase(t.workspaceId, bought.purchaseId);
  assert.equal(purchase.status, "refunded");
  assert.equal(purchase.refundedCents, 10_000);
  const card = await assertCardInvariants(t.workspaceId, cardId);
  assert.equal(card.limitUsedCents, 0, "limite devolvido pelo total");
  // Repetição do estorno: recusada pelo estado (idempotente no efeito).
  await rejectsWith(executeRefundCreditCardPurchase(actorOf(t, t.owner),
    await mutation(), requestId(), clockAt("2026-03-26")),
  "domain_precondition_failed");
  assert.equal((await ledgerOf(t.workspaceId, cardId)).length, 2);
});

test("P4-A — edição: member só a própria compra; financeira só com todas as " +
  "parcelas abertas; versão obrigatória", async () => {
  const t = await seedCardTenant("PF", "cc-edit");
  const cardId = await createCard(t);
  const bought = await buy(t, cardId, "2026-03-10",
    {totalCents: 9_000, installmentsCount: 3}, t.member);
  const edit = async (
    uid: string,
    changes: Record<string, unknown>,
    today: string,
    role: "owner" | "member" = "member",
  ) => executeUpdateCreditCardPurchase(actorOf(t, uid, role), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    purchaseId: bought.purchaseId,
    expectedUpdatedAt: await purchaseVersion(t.workspaceId, bought.purchaseId),
    changes,
  } as Parameters<typeof executeUpdateCreditCardPurchase>[1], requestId(),
  clockAt(today));
  await rejectsWith(edit(t.otherMember, {description: "Outro"}, "2026-03-11"),
    "workspace_role_denied", MEMBER_PURCHASE_OWNERSHIP_MESSAGE);
  const descriptive = await edit(t.member, {description: "Monitor 27"},
    "2026-03-11");
  assert.equal(descriptive.financial, false);
  assert.equal((await readPurchase(t.workspaceId, bought.purchaseId))
    .description, "Monitor 27");
  const financial = await edit(t.member,
    {totalCents: 12_000, installmentsCount: 4}, "2026-03-11");
  assert.equal(financial.financial, true);
  const purchase = await readPurchase(t.workspaceId, bought.purchaseId);
  assert.equal(purchase.installmentRevision, 2);
  const entries = (await entriesOf(t.workspaceId, cardId)) as
    Array<Record<string, unknown>>;
  assert.equal(entries.filter((entry) => entry.status === "cancelled").length,
    3, "parcelas antigas canceladas, não apagadas");
  assert.deepEqual(entries.filter((entry) => entry.status === "active")
    .map((entry) => entry.amountCents), [3000, 3000, 3000, 3000]);
  assert.equal((await assertCardInvariants(t.workspaceId, cardId))
    .limitUsedCents, 12_000);
  // Depois do fechamento de março: financeiro bloqueado, descritivo livre.
  await rejectsWith(edit(t.member, {totalCents: 15_000}, "2026-03-25"),
    "domain_precondition_failed", PURCHASE_FINANCIAL_LOCKED_MESSAGE);
  await edit(t.member, {category: "Escritório"}, "2026-03-25");
  // Versão desatualizada: conflito explícito.
  await rejectsWith(executeUpdateCreditCardPurchase(actorOf(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    purchaseId: bought.purchaseId,
    expectedUpdatedAt: "2020-01-01T00:00:00.000000000Z",
    changes: {description: "Velha"},
  }, requestId(), clockAt("2026-03-25")), "concurrent_update");
  await assertCardInvariants(t.workspaceId, cardId);
});

test("P4-A — papéis e isolamento: viewer não compra, member não cancela, " +
  "cartão de outro workspace, membership removido, workspace e cartão " +
  "arquivados", async () => {
  const t = await seedCardTenant("PF", "cc-rbac");
  const other = await seedCardTenant("PF", "cc-rbac-b");
  const cardId = await createCard(t);
  await rejectsWith(buy(t, cardId, "2026-03-10", {}, t.viewer),
    "workspace_role_denied");
  const bought = await buy(t, cardId, "2026-03-10", {}, t.member);
  await rejectsWith(executeCancelCreditCardPurchase(
    actorOf(t, t.member, "member"), {
      workspaceId: t.workspaceId,
      idempotencyKey: idempotencyKey(),
      purchaseId: bought.purchaseId,
      expectedUpdatedAt: await purchaseVersion(t.workspaceId,
        bought.purchaseId),
    }, requestId(), clockAt("2026-03-11")), "workspace_role_denied");
  // Dono de outro workspace não alcança o cartão (o caminho é do seu tenant).
  await rejectsWith(executeCreateCreditCardPurchase(
    actorOf(other, other.owner),
    purchasePayload(other.workspaceId, cardId), requestId(),
    clockAt("2026-03-10")), "not_found");
  // Membership removido entre a pré-checagem e a transação.
  await seedMember(t.workspaceId, t.otherMember, "member", "removed");
  await assert.rejects(buy(t, cardId, "2026-03-10", {}, t.otherMember),
    (error: {code?: string}) => error.code !== undefined &&
      error.code !== "domain_precondition_failed");
  // Cartão arquivado não aceita compra nova.
  const emptyCard = await createCard(t, {name: "Reserva"});
  await executeArchiveCreditCard(actorOf(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId: emptyCard,
    expectedUpdatedAt: await cardVersion(t.workspaceId, emptyCard),
  }, requestId(), clockAt("2026-03-10"));
  await rejectsWith(buy(t, emptyCard, "2026-03-10"),
    "domain_precondition_failed", CARD_ARCHIVED_MESSAGE);
  // Workspace arquivado: nenhuma escrita.
  await db().doc(`workspaces/${t.workspaceId}`).update({status: "archived"});
  await rejectsWith(buy(t, cardId, "2026-03-10"), "workspace_archived");
  await assertCardInvariants(t.workspaceId, cardId);
});

test("P4-A — callable: contrato estrito em pt-BR; origem e valor em reais " +
  "recusados", async () => {
  const t = await seedCardTenant("PF", "cc-call");
  const cardId = await createCard(t);
  const base = {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId,
    description: "Assinatura",
    category: "Serviços",
    purchaseDate: "2026-03-10",
    totalCents: 4_990,
    installmentsCount: 1,
  };
  await expectHttpsError(call(createCreditCardPurchase, t.owner,
    {...base, source: "migration"}), "invalid-argument");
  await expectHttpsError(call(createCreditCardPurchase, t.owner,
    {...base, totalCents: 49.9}), "invalid-argument");
  await expectHttpsError(call(createCreditCardPurchase, t.owner,
    {...base, installmentsCount: 61}), "invalid-argument");
  await expectHttpsError(call(createCreditCardPurchase, t.viewer, base),
    "permission-denied");
  const created = await call<{purchaseId: string; replayed: boolean}>(
    createCreditCardPurchase, t.owner, base);
  assert.equal(created.replayed, false);
  assert.equal((await readPurchase(t.workspaceId, created.purchaseId)).source,
    "manual");
});
