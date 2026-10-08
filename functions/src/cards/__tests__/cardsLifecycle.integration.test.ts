import assert from "node:assert/strict";
import test from "node:test";

import {
  call,
  db,
  expectHttpsError,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  CARD_ALREADY_ARCHIVED_MESSAGE,
  CARD_ARCHIVE_OPEN_ENTRIES_MESSAGE,
  CARD_ARCHIVE_UNPAID_MESSAGE,
  CARD_CYCLE_LOCKED_MESSAGE,
  CARD_LIMIT_PER_WORKSPACE_MESSAGE,
  CARD_UNCHANGED_MESSAGE,
  executeArchiveCreditCard,
  executeCreateCreditCard,
  executeReactivateCreditCard,
  executeUpdateCreditCard,
} from "../cardOperations";
import {
  archiveCreditCard,
  createCreditCard,
  updateCreditCard,
} from "../callables";
import {runCreditCardInvoiceClosing} from "../closing";
import {CARD_ARCHIVED_MESSAGE} from "../common";
import {CARD_LIMIT_PER_WORKSPACE, cardIdFor} from "../model";
import {
  executeCancelCreditCardPurchase,
  executeRefundCreditCardPurchase,
} from "../purchaseOperations";
import {
  VISUAL,
  actorOf,
  assertCardInvariants,
  buy,
  cardEventsOf,
  cardPayload,
  cardVersion,
  clockAt,
  createCard,
  pay,
  purchaseVersion,
  readCard,
  readInvoice,
  requestId,
  seedCardTenant,
  type CardTenant,
} from "../testSupport/cardTestSupport";

/**
 * P4-A — cadastro e ciclo de vida do cartão no Emulator: criação em
 * centavos, replay, edição (limite nunca abaixo do usado, dias travados com
 * fatura aberta com lançamento), arquivamento com pendências recusadas,
 * reativação, papéis, isolamento e teto por workspace. Não existe exclusão.
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

const update = async (
  t: CardTenant,
  cardId: string,
  changes: Record<string, unknown>,
  today = "2026-03-10",
  uid = t.owner,
) => executeUpdateCreditCard(actorOf(t, uid), {
  workspaceId: t.workspaceId,
  idempotencyKey: idempotencyKey(),
  cardId,
  expectedUpdatedAt: await cardVersion(t.workspaceId, cardId),
  changes,
} as Parameters<typeof executeUpdateCreditCard>[1], requestId(),
clockAt(today));

const archive = async (
  t: CardTenant,
  cardId: string,
  today = "2026-03-10",
  uid = t.owner,
) => executeArchiveCreditCard(actorOf(t, uid), {
  workspaceId: t.workspaceId,
  idempotencyKey: idempotencyKey(),
  cardId,
  expectedUpdatedAt: await cardVersion(t.workspaceId, cardId),
}, requestId(), clockAt(today));

const reactivate = async (t: CardTenant, cardId: string) =>
  executeReactivateCreditCard(actorOf(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId,
    expectedUpdatedAt: await cardVersion(t.workspaceId, cardId),
  }, requestId(), clockAt("2026-03-10"));

test("P4-A — criação: schema único em centavos, replay pela chave e evento",
  async () => {
    const t = await seedCardTenant("PJ", "cc-create");
    const payload = cardPayload(t.workspaceId, {
      name: "Corporativo",
      limitTotalCents: 1_234_567,
      responsiblePerson: "Equipe financeira",
      observations: "",
    });
    const created = await executeCreateCreditCard(actorOf(t, t.admin),
      payload, requestId());
    assert.equal(created.cardId,
      cardIdFor(t.workspaceId, t.admin, payload.idempotencyKey));
    const card = await readCard(t.workspaceId, created.cardId);
    assert.equal(card.schemaVersion, 1);
    assert.equal(card.status, "active");
    assert.equal(card.limitTotalCents, 1_234_567);
    assert.equal(card.limitUsedCents, 0);
    assert.equal(card.limitAvailableCents, 1_234_567);
    assert.equal(card.observations, null, "texto vazio vira nulo");
    assert.equal(card.responsiblePerson, "Equipe financeira");
    assert.equal(card.limitTotal, undefined, "nenhum campo em reais");
    assert.equal(card.limitUsed, undefined);
    assert.deepEqual(card.visual, VISUAL);
    const replay = await executeCreateCreditCard(actorOf(t, t.admin),
      payload, requestId());
    assert.equal(replay.replayed, true);
    await rejectsWith(executeCreateCreditCard(actorOf(t, t.admin),
      {...payload, name: "Outro"}, requestId()), "idempotency_conflict");
    const events = (await cardEventsOf(t.workspaceId, created.cardId)) as
      Array<Record<string, unknown>>;
    assert.equal(events.length, 1);
    assert.equal(events[0].operation, "credit_card.created");
    assert.equal(JSON.stringify(events[0]).includes("Equipe financeira"),
      false, "auditoria sem dado pessoal");
  });

test("P4-A — edição: descritivos e limite; nunca abaixo do usado; versão " +
  "obrigatória; sem efeito é recusada", async () => {
  const t = await seedCardTenant("PF", "cc-update");
  const cardId = await createCard(t, {limitTotalCents: 100_000});
  await buy(t, cardId, "2026-03-10", {totalCents: 60_000});
  await update(t, cardId, {name: "Cartão da casa", brand: "Elo"});
  const renamed = await readCard(t.workspaceId, cardId);
  assert.equal(renamed.name, "Cartão da casa");
  assert.equal(renamed.brand, "Elo");
  await rejectsWith(update(t, cardId, {limitTotalCents: 59_999}),
    "domain_precondition_failed", /abaixo do limite já utilizado/);
  await update(t, cardId, {limitTotalCents: 60_000});
  const card = await assertCardInvariants(t.workspaceId, cardId);
  assert.equal(card.limitAvailableCents, 0);
  await rejectsWith(update(t, cardId, {name: "Cartão da casa"}),
    "domain_precondition_failed", CARD_UNCHANGED_MESSAGE);
  await rejectsWith(executeUpdateCreditCard(actorOf(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId,
    expectedUpdatedAt: "2020-01-01T00:00:00.000000000Z",
    changes: {name: "Velho"},
  }, requestId()), "concurrent_update");
  // Compras mudam o limite usado, não a versão do cadastro.
  const version = await cardVersion(t.workspaceId, cardId);
  await update(t, cardId, {limitTotalCents: 200_000});
  await buy(t, cardId, "2026-03-10", {totalCents: 1_000});
  assert.notEqual(await cardVersion(t.workspaceId, cardId), version);
  const afterPurchase = await cardVersion(t.workspaceId, cardId);
  await buy(t, cardId, "2026-03-10", {totalCents: 1_000});
  assert.equal(await cardVersion(t.workspaceId, cardId), afterPurchase);
});

test("P4-A — dias de fechamento e vencimento: travados com fatura aberta " +
  "com lançamento; faturas abertas vazias passam às datas novas", async () => {
  const t = await seedCardTenant("PF", "cc-cycle");
  const cardId = await createCard(t);
  const bought = await buy(t, cardId, "2026-03-10", {totalCents: 5_000});
  await rejectsWith(update(t, cardId, {closingDay: 28}),
    "domain_precondition_failed", CARD_CYCLE_LOCKED_MESSAGE);
  await executeCancelCreditCardPurchase(actorOf(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    purchaseId: bought.purchaseId,
    expectedUpdatedAt: await purchaseVersion(t.workspaceId, bought.purchaseId),
  }, requestId(), clockAt("2026-03-11"));
  await update(t, cardId, {closingDay: 28, dueDay: 8}, "2026-03-11");
  const march = await readInvoice(t.workspaceId, cardId, "2026-03");
  assert.equal(march.closingDate, "2026-03-28");
  assert.equal(march.dueDate, "2026-04-08");
  const next = await buy(t, cardId, "2026-03-26", {totalCents: 1_000});
  assert.equal(next.firstCompetence, "2026-03", "26/03 < novo fechamento 28");
  await assertCardInvariants(t.workspaceId, cardId);
});

test("P4-A — arquivamento: recusado com parcelas futuras, saldo devedor, " +
  "fatura a pagar ou crédito; depois de quitado, arquiva e reativa",
async () => {
  const t = await seedCardTenant("PF", "cc-archive");
  const cardId = await createCard(t);
  const bought = await buy(t, cardId, "2026-03-10", {totalCents: 10_000});
  await rejectsWith(archive(t, cardId), "domain_precondition_failed",
    /saldo devedor/);
  // Fecha março (sem pagamento): fatura a pagar.
  await runCreditCardInvoiceClosing({today: "2026-03-26"});
  await rejectsWith(archive(t, cardId, "2026-03-26"),
    "domain_precondition_failed", /saldo devedor/);
  // Estorno da compra faturada: crédito em abril; ainda há fatura a pagar.
  await executeRefundCreditCardPurchase(actorOf(t, t.owner), {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    purchaseId: bought.purchaseId,
    expectedUpdatedAt: await purchaseVersion(t.workspaceId, bought.purchaseId),
  }, requestId(), clockAt("2026-03-26"));
  assert.equal((await readCard(t.workspaceId, cardId)).limitUsedCents, 0);
  await rejectsWith(archive(t, cardId, "2026-03-26"),
    "domain_precondition_failed", CARD_ARCHIVE_OPEN_ENTRIES_MESSAGE);
  // Paga março: crédito a favor de 10.000 em abril.
  await pay(t, cardId, "2026-03", "2026-03-27", 10_000);
  await rejectsWith(archive(t, cardId, "2026-03-27"),
    "domain_precondition_failed", /crédito a favor/);
  // Um novo cartão sem movimento arquiva; fatura a pagar também bloqueia.
  const other = await createCard(t, {name: "Viagem"});
  await buy(t, other, "2026-03-10", {totalCents: 2_000});
  await runCreditCardInvoiceClosing({today: "2026-03-26"});
  await rejectsWith(archive(t, other, "2026-03-27"),
    "domain_precondition_failed", /saldo devedor/);
  // Defesa em profundidade: com os invariantes, limite usado zero e nenhuma
  // parcela aberta implicam nenhuma fatura fechada a pagar. Sob deriva (o
  // limite gravado zerado à mão, como um reparo errado faria), a fatura
  // fechada em aberto ainda bloqueia o arquivamento.
  const drifted = await createCard(t, {name: "Deriva"});
  await buy(t, drifted, "2026-03-10", {totalCents: 3_000});
  await runCreditCardInvoiceClosing({today: "2026-03-26"});
  await db().doc(`workspaces/${t.workspaceId}/credit_cards/${drifted}`)
    .update({limitUsedCents: 0, limitAvailableCents: 500_000});
  await rejectsWith(archive(t, drifted, "2026-03-27"),
    "domain_precondition_failed", CARD_ARCHIVE_UNPAID_MESSAGE);
  assert.equal((await readCard(t.workspaceId, drifted)).status, "active");
  await pay(t, other, "2026-03", "2026-03-27", 2_000);
  await archive(t, other, "2026-03-27");
  const archived = await readCard(t.workspaceId, other);
  assert.equal(archived.status, "archived");
  assert.equal(archived.archivedBy, t.owner);
  await rejectsWith(archive(t, other, "2026-03-27"),
    "domain_precondition_failed", CARD_ALREADY_ARCHIVED_MESSAGE);
  await rejectsWith(buy(t, other, "2026-03-27"), "domain_precondition_failed",
    CARD_ARCHIVED_MESSAGE);
  // Arquivado continua no histórico: faturas e pagamentos intactos.
  assert.equal((await readInvoice(t.workspaceId, other, "2026-03"))
    .paymentStatus, "paid");
  await reactivate(t, other);
  assert.equal((await readCard(t.workspaceId, other)).status, "active");
  await buy(t, other, "2026-03-27", {totalCents: 500});
  await assertCardInvariants(t.workspaceId, other);
  await assertCardInvariants(t.workspaceId, cardId);
});

test("P4-A — papéis, isolamento e teto: só owner/admin administram; " +
  "cartão de outro workspace; 50 cartões por workspace", async () => {
  const t = await seedCardTenant("PF", "cc-roles");
  const other = await seedCardTenant("PF", "cc-roles-b");
  for (const uid of [t.member, t.viewer]) {
    await expectHttpsError(call(createCreditCard, uid,
      cardPayload(t.workspaceId)), "permission-denied");
  }
  const created = await call<{cardId: string}>(createCreditCard, t.owner,
    cardPayload(t.workspaceId));
  await expectHttpsError(call(updateCreditCard, t.member, {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId: created.cardId,
    expectedUpdatedAt: await cardVersion(t.workspaceId, created.cardId),
    changes: {name: "Do membro"},
  }), "permission-denied");
  await expectHttpsError(call(archiveCreditCard, t.viewer, {
    workspaceId: t.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId: created.cardId,
    expectedUpdatedAt: await cardVersion(t.workspaceId, created.cardId),
  }), "permission-denied");
  // Cross-tenant: o dono de outro workspace não alcança este cartão.
  await expectHttpsError(call(updateCreditCard, other.owner, {
    workspaceId: other.workspaceId,
    idempotencyKey: idempotencyKey(),
    cardId: created.cardId,
    expectedUpdatedAt: await cardVersion(t.workspaceId, created.cardId),
    changes: {name: "Invasor"},
  }), "not-found");
  assert.notEqual((await readCard(t.workspaceId, created.cardId)).name,
    "Invasor");
  // Dados inválidos: centavos, contrato estrito, mensagens em pt-BR.
  await expectHttpsError(call(createCreditCard, t.owner,
    {...cardPayload(t.workspaceId), limitTotalCents: 10.5}),
  "invalid-argument");
  await expectHttpsError(call(createCreditCard, t.owner,
    {...cardPayload(t.workspaceId), status: "active"}), "invalid-argument");
  // Teto operacional por workspace (ativos e arquivados).
  const batch = db().batch();
  for (let index = 0; index < CARD_LIMIT_PER_WORKSPACE - 1; index += 1) {
    batch.set(db().doc(
      `workspaces/${t.workspaceId}/credit_cards/seed-${index}`),
    {seeded: true});
  }
  await batch.commit();
  await rejectsWith(executeCreateCreditCard(actorOf(t, t.owner),
    cardPayload(t.workspaceId), requestId()), "domain_precondition_failed",
  CARD_LIMIT_PER_WORKSPACE_MESSAGE);
});
