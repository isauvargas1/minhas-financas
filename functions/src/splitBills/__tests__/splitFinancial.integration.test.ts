import assert from "node:assert/strict";
import {before, describe, test} from "node:test";

import {
  assertCardInvariants,
  createCard,
  readPurchase,
} from "../../cards/testSupport/cardTestSupport";
import {runCreditCardInvoiceClosing} from "../../cards/closing";
import {
  PURCHASE_SPLIT_MANAGED_MESSAGE,
  executeCancelCreditCardPurchase,
  executeUpdateCreditCardPurchase,
} from "../../cards/purchaseOperations";
import {cashPeriodDeltaFor} from "../../cash/periods";
import {
  BILL_TERMS_LOCKED_MESSAGE,
  BILL_VOID_FACT_DENIED_MESSAGE,
  EXTERNAL_PAYER_INTEGRATION_MESSAGE,
  INTEGRATION_ACTOR_MESSAGE,
  PAYER_NOT_MEMBER_MESSAGE,
} from "../billOperations";
import {
  splitBillCardPurchaseIdFor,
  splitBillCashTransactionIdFor,
} from "../model";
import {
  accountRef,
  actorOf,
  addExternal,
  assertSplitReconciles,
  balanceOf,
  billPayload,
  billRef,
  clockAt,
  countOf,
  createBill,
  defaultAccountOf,
  eventsOf,
  idempotencyKey,
  readDoc,
  rejectsWith,
  requestId,
  seedGroupWithMembers,
  seedSplitTenant,
  settleShare,
  shareIdOf,
  transactionRef,
  updateBill,
  versionOf,
  voidBill,
  type SplitTenant,
} from "../testSupport/splitTestSupport";
import {db} from "../../workspaces/testSupport/p1TestSupport";
import {seedMember} from "../../shared/testSupport/kernelTestSupport";

/**
 * Integração financeira da Divisão de contas (P4-C, §16–§20): o fato do
 * título nasce no mesmo commit — despesa confirmada no Caixa (P3, com o
 * movimento da conta, D-30) ou compra no domínio de cartões (P4-A, origem
 * `split`, nunca `parcelado` em `transactions`) — e a anulação compensa
 * sem apagar: estorno na mesma conta ou cancelamento/estorno da compra.
 */
describe("Divisão de contas — Caixa e Cartão", () => {
  let tenant: SplitTenant;

  before(async () => {
    tenant = await seedSplitTenant("PF", "split-fin");
  });

  test("Caixa: despesa confirmada, conta movida, espelho protegido e " +
    "evento — tudo no commit do título", async () => {
    const ids = await seedGroupWithMembers(tenant);
    const accountId = defaultAccountOf(tenant.workspaceId);
    const before = await balanceOf(tenant.workspaceId, accountId);
    const {billId} = await createBill(tenant, billPayload(tenant,
      ids.groupId, ids.owner, [ids.owner, ids.member, ids.otherMember], {
        amountCents: 12_345,
        financialIntegration: "cash",
        cashAccountId: accountId,
      }));
    const transactionId = splitBillCashTransactionIdFor(tenant.workspaceId,
      billId, "apply");
    const bill = await readDoc(billRef(tenant.workspaceId, billId));
    assert.equal(bill.cashTransactionId, transactionId);
    assert.equal(bill.cashAccountId, accountId);
    const mirror = await readDoc(transactionRef(tenant.workspaceId,
      transactionId));
    assert.equal(mirror.type, "despesa");
    assert.equal(mirror.valueCents, 12_345);
    assert.equal(mirror.isPaid, true);
    assert.equal(mirror.source, "split");
    assert.equal(mirror.userId, tenant.owner);
    assert.equal(mirror.cashAccountId, accountId);
    assert.equal(mirror.splitEntry.kind, "bill_expense");
    assert.equal(mirror.splitEntry.billId, billId);
    assert.equal(mirror.splitEntry.reversal, false);
    assert.notEqual(mirror.type, "parcelado");
    assert.equal(mirror.cardId, undefined);
    assert.equal(await balanceOf(tenant.workspaceId, accountId),
      before - 12_345);
    // Projeção mensal: despesa operacional, saída de caixa.
    const delta = cashPeriodDeltaFor(mirror);
    assert.equal(delta.expenseCents, 12_345);
    assert.equal(delta.incomeCents, 0);
    const events = await eventsOf(tenant.workspaceId, ids.groupId);
    assert.ok(events.some((event) => event.operation === "split.bill_created" &&
      event.billId === billId && event.amountCents === 12_345));
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);

    // Termos travados pelo fato; descrição e categoria seguem editáveis.
    await rejectsWith(updateBill(tenant, billId, {terms: {
      amountCents: 12_000, expenseDate: bill.expenseDate,
      payerParticipantId: ids.owner, allocationMethod: "equal",
      participants: [{participantId: ids.owner}, {participantId: ids.member}],
      financialIntegration: "cash", cashAccountId: accountId, cardId: null,
      installmentsCount: null,
    }}), "domain_precondition_failed", BILL_TERMS_LOCKED_MESSAGE);
    await updateBill(tenant, billId, {metadata: {description: "Jantar 2"}});

    // Anulação: compensação na mesma conta e com a data do fato.
    await voidBill(tenant, billId);
    const reversalId = splitBillCashTransactionIdFor(tenant.workspaceId,
      billId, "reversal");
    const reversal = await readDoc(transactionRef(tenant.workspaceId,
      reversalId));
    assert.equal(reversal.type, "receita");
    assert.equal(reversal.valueCents, 12_345);
    assert.equal(reversal.date, mirror.date);
    assert.equal(reversal.cashAccountId, accountId);
    assert.equal(reversal.splitEntry.reversal, true);
    assert.equal(reversal.splitEntry.reversalOf, transactionId);
    assert.equal(await balanceOf(tenant.workspaceId, accountId), before);
    // O original continua lá; fato + compensação somam zero na projeção.
    const original = await readDoc(transactionRef(tenant.workspaceId,
      transactionId));
    assert.equal(original.valueCents, 12_345);
    const sum = cashPeriodDeltaFor(original).expenseCents +
      cashPeriodDeltaFor(reversal).expenseCents;
    assert.equal(sum, 0);
    const voided = await readDoc(billRef(tenant.workspaceId, billId));
    assert.equal(voided.status, "voided");
    assert.equal(voided.reversalTransactionId, reversalId);
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
  });

  test("Caixa: pagador externo não integra; membro não lança pelo outro; " +
    "admin lança pelo pagador membro", async () => {
    const ids = await seedGroupWithMembers(tenant);
    const accountId = defaultAccountOf(tenant.workspaceId);
    const {participantId: external} = await addExternal(tenant, ids.groupId);
    await rejectsWith(createBill(tenant, billPayload(tenant, ids.groupId,
      external, [external, ids.owner], {financialIntegration: "cash",
        cashAccountId: accountId})),
    "domain_precondition_failed", EXTERNAL_PAYER_INTEGRATION_MESSAGE);
    // Sem integração, o pagador externo é aceito.
    await createBill(tenant, billPayload(tenant, ids.groupId, external,
      [external, ids.owner]));
    await rejectsWith(createBill(tenant, billPayload(tenant, ids.groupId,
      ids.otherMember, [ids.otherMember, ids.member], {
        financialIntegration: "cash", cashAccountId: accountId,
      }), tenant.member), "permission_denied", INTEGRATION_ACTOR_MESSAGE);
    const transactionsBefore = await countOf(tenant.workspaceId,
      "transactions");
    const {billId} = await createBill(tenant, billPayload(tenant, ids.groupId,
      ids.member, [ids.member, ids.owner], {financialIntegration: "cash",
        cashAccountId: accountId}), tenant.admin);
    const mirror = await readDoc(transactionRef(tenant.workspaceId,
      splitBillCashTransactionIdFor(tenant.workspaceId, billId, "apply")));
    // Responsável pelo lançamento: o pagador; quem executou: o admin.
    assert.equal(mirror.userId, tenant.member);
    assert.equal(mirror.createdBy, tenant.admin);
    assert.equal(await countOf(tenant.workspaceId, "transactions"),
      transactionsBefore + 1);
    // Anular com fato: participante que não é o pagador nem admin não pode.
    await rejectsWith(voidBill(tenant, billId, tenant.otherMember),
      "permission_denied", BILL_VOID_FACT_DENIED_MESSAGE);
    await voidBill(tenant, billId, tenant.member);
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
  });

  test("Caixa: admin não integra por pagador removido do espaço ou " +
    "rebaixado a viewer; nada é gravado", async () => {
    const local = await seedSplitTenant("PF", "split-fin-payer");
    const ids = await seedGroupWithMembers(local);
    const accountId = defaultAccountOf(local.workspaceId);
    const snapshot = async () => ({
      bills: await countOf(local.workspaceId, "split_bills"),
      shares: await countOf(local.workspaceId, "split_shares"),
      transactions: await countOf(local.workspaceId, "transactions"),
      balance: await balanceOf(local.workspaceId, accountId),
    });
    const before = await snapshot();
    const payload = () => billPayload(local, ids.groupId, ids.member,
      [ids.member, ids.owner], {financialIntegration: "cash",
        cashAccountId: accountId});
    // O participante continua ativo no grupo; o que mudou foi o espaço.
    await seedMember(local.workspaceId, local.member, "member", "removed");
    await rejectsWith(createBill(local, payload(), local.admin),
      "domain_precondition_failed", PAYER_NOT_MEMBER_MESSAGE);
    await seedMember(local.workspaceId, local.member, "viewer", "active");
    await rejectsWith(createBill(local, payload(), local.admin),
      "domain_precondition_failed", PAYER_NOT_MEMBER_MESSAGE);
    assert.deepEqual(await snapshot(), before);
    await assertSplitReconciles(local.workspaceId, ids.groupId);
  });

  test("edição antes de qualquer fato lança no Caixa no mesmo commit; " +
    "depois os termos travam", async () => {
    const local = await seedSplitTenant("PF", "split-fin-edit-cash");
    const ids = await seedGroupWithMembers(local);
    const accountId = defaultAccountOf(local.workspaceId);
    const {billId} = await createBill(local, billPayload(local, ids.groupId,
      ids.owner, [ids.owner, ids.member], {amountCents: 5_001}));
    const balance = await balanceOf(local.workspaceId, accountId);
    const bill = await readDoc(billRef(local.workspaceId, billId));
    const terms = {
      amountCents: 5_001,
      expenseDate: bill.expenseDate as string,
      payerParticipantId: ids.owner,
      allocationMethod: "equal" as const,
      participants: [{participantId: ids.owner}, {participantId: ids.member}],
      financialIntegration: "cash" as const,
      cashAccountId: accountId,
      cardId: null,
      installmentsCount: null,
    };
    await updateBill(local, billId, {terms});
    const updated = await readDoc(billRef(local.workspaceId, billId));
    const mirrorId = splitBillCashTransactionIdFor(local.workspaceId, billId,
      "apply");
    assert.equal(updated.financialIntegration, "cash");
    assert.equal(updated.cashTransactionId, mirrorId);
    const mirror = await readDoc(transactionRef(local.workspaceId, mirrorId));
    assert.equal(mirror.valueCents, 5_001);
    assert.equal(mirror.splitEntry.billId, billId);
    assert.equal(await balanceOf(local.workspaceId, accountId),
      balance - 5_001);
    // Com o fato gravado, os termos travam (só descrição e categoria).
    await rejectsWith(updateBill(local, billId, {terms: {...terms,
      amountCents: 5_000}}), "domain_precondition_failed",
    BILL_TERMS_LOCKED_MESSAGE);
    await assertSplitReconciles(local.workspaceId, ids.groupId);
  });

  test("Caixa: conta arquivada recusa o fato e nada é gravado", async () => {
    const ids = await seedGroupWithMembers(tenant);
    const accountId = defaultAccountOf(tenant.workspaceId);
    await accountRef(tenant.workspaceId, accountId)
      .update({status: "archived"});
    try {
      const bills = await countOf(tenant.workspaceId, "split_bills");
      const shares = await countOf(tenant.workspaceId, "split_shares");
      await rejectsWith(createBill(tenant, billPayload(tenant, ids.groupId,
        ids.owner, [ids.owner, ids.member], {financialIntegration: "cash",
          cashAccountId: accountId})), "domain_precondition_failed");
      assert.equal(await countOf(tenant.workspaceId, "split_bills"), bills);
      assert.equal(await countOf(tenant.workspaceId, "split_shares"), shares);
      await assertSplitReconciles(tenant.workspaceId, ids.groupId);
    } finally {
      await accountRef(tenant.workspaceId, accountId)
        .update({status: "active"});
    }
  });

  test("Cartão: compra pela primitiva (origem split), parcelas, limite; " +
    "anulação com tudo aberto cancela", async () => {
    const ids = await seedGroupWithMembers(tenant);
    const cardId = await createCard(tenant);
    const {billId} = await createBill(tenant, billPayload(tenant, ids.groupId,
      ids.owner, [ids.owner, ids.member], {
        amountCents: 30_001,
        financialIntegration: "card",
        cardId,
        installmentsCount: 3,
      }));
    const purchaseId = splitBillCardPurchaseIdFor(tenant.workspaceId, billId);
    const purchase = await readPurchase(tenant.workspaceId, purchaseId);
    assert.equal(purchase.source, "split");
    assert.equal(purchase.splitBillId, billId);
    assert.equal(purchase.splitGroupId, ids.groupId);
    assert.equal(purchase.totalCents, 30_001);
    assert.equal(purchase.installmentsCount, 3);
    assert.equal(purchase.createdBy, tenant.owner);
    const card = await assertCardInvariants(tenant.workspaceId, cardId);
    assert.equal(card.limitUsedCents, 30_001);
    // Nada de `parcelado` com `cardId` em `transactions`.
    const transactions = await db()
      .collection(`workspaces/${tenant.workspaceId}/transactions`)
      .where("type", "==", "parcelado").get();
    assert.equal(transactions.size, 0);
    // A compra da Divisão não é cancelada nem editada pelo domínio de cartões.
    await rejectsWith(executeCancelCreditCardPurchase(actorOf(tenant,
      tenant.owner), {workspaceId: tenant.workspaceId,
        idempotencyKey: idempotencyKey(), purchaseId,
        expectedUpdatedAt: await versionOf(db().doc(
          `workspaces/${tenant.workspaceId}/credit_card_purchases/` +
          purchaseId)),
      } as Parameters<typeof executeCancelCreditCardPurchase>[1], requestId(),
      clockAt()), "domain_precondition_failed", PURCHASE_SPLIT_MANAGED_MESSAGE);
    await rejectsWith(executeUpdateCreditCardPurchase(actorOf(tenant,
      tenant.owner), {workspaceId: tenant.workspaceId,
        idempotencyKey: idempotencyKey(), purchaseId,
        expectedUpdatedAt: await versionOf(db().doc(
          `workspaces/${tenant.workspaceId}/credit_card_purchases/` +
          purchaseId)),
        changes: {description: "Outra"},
      } as Parameters<typeof executeUpdateCreditCardPurchase>[1], requestId(),
      clockAt()), "domain_precondition_failed", PURCHASE_SPLIT_MANAGED_MESSAGE);
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);

    await voidBill(tenant, billId);
    const cancelled = await readPurchase(tenant.workspaceId, purchaseId);
    assert.equal(cancelled.status, "cancelled");
    const afterCard = await assertCardInvariants(tenant.workspaceId, cardId);
    assert.equal(afterCard.limitUsedCents, 0);
    const bill = await readDoc(billRef(tenant.workspaceId, billId));
    assert.equal(bill.cardReversalMode, "cancel");
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
  });

  test("Cartão: parcela já faturada → anulação estorna com crédito " +
    "na fatura aberta (fatura fechada nunca muda)", async () => {
    const cardTenant = await seedSplitTenant("PF", "split-fin-card");
    const ids = await seedGroupWithMembers(cardTenant);
    const cardId = await createCard(cardTenant);
    const {billId} = await createBill(cardTenant, billPayload(cardTenant,
      ids.groupId, ids.owner, [ids.owner, ids.member], {
        amountCents: 20_000,
        expenseDate: "2026-10-07",
        financialIntegration: "card",
        cardId,
        installmentsCount: 2,
      }), cardTenant.owner, clockAt("2026-10-07"));
    await runCreditCardInvoiceClosing({today: "2026-10-26"});
    await voidBill(cardTenant, billId, cardTenant.owner, clockAt("2026-10-27"));
    const purchase = await readPurchase(cardTenant.workspaceId,
      splitBillCardPurchaseIdFor(cardTenant.workspaceId, billId));
    assert.equal(purchase.status, "refunded");
    assert.equal(purchase.refundedCents, 10_000);
    const bill = await readDoc(billRef(cardTenant.workspaceId, billId));
    assert.equal(bill.cardReversalMode, "refund");
    await assertCardInvariants(cardTenant.workspaceId, cardId);
    await assertSplitReconciles(cardTenant.workspaceId, ids.groupId);
  });

  test("Cartão: limite insuficiente recusa tudo (título, rateios, compra)",
    async () => {
      const ids = await seedGroupWithMembers(tenant);
      const cardId = await createCard(tenant, {limitTotalCents: 1_000});
      const bills = await countOf(tenant.workspaceId, "split_bills");
      const purchases = await countOf(tenant.workspaceId,
        "credit_card_purchases");
      await rejectsWith(createBill(tenant, billPayload(tenant, ids.groupId,
        ids.owner, [ids.owner, ids.member], {amountCents: 5_000,
          financialIntegration: "card", cardId, installmentsCount: 1})),
      "domain_precondition_failed");
      assert.equal(await countOf(tenant.workspaceId, "split_bills"), bills);
      assert.equal(await countOf(tenant.workspaceId, "credit_card_purchases"),
        purchases);
      await assertSplitReconciles(tenant.workspaceId, ids.groupId);
    });

  test("quitação não movimenta o Caixa", async () => {
    const ids = await seedGroupWithMembers(tenant);
    const accountId = defaultAccountOf(tenant.workspaceId);
    const {billId} = await createBill(tenant, billPayload(tenant, ids.groupId,
      ids.owner, [ids.owner, ids.member], {financialIntegration: "cash",
        cashAccountId: accountId}));
    const balance = await balanceOf(tenant.workspaceId, accountId);
    const transactions = await countOf(tenant.workspaceId, "transactions");
    await settleShare(tenant, shareIdOf(tenant, billId, ids.member));
    assert.equal(await balanceOf(tenant.workspaceId, accountId), balance);
    assert.equal(await countOf(tenant.workspaceId, "transactions"),
      transactions);
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
  });
});
