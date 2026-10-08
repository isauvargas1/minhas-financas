import assert from "node:assert/strict";
import {before, describe, test} from "node:test";

import {cashPeriodDeltaFor} from "../../cash/periods";
import {
  REIMBURSEMENT_ADMIN_ONLY_MESSAGE,
  REIMBURSEMENT_CANCEL_DENIED_MESSAGE,
  REIMBURSEMENT_NOT_APPROVED_MESSAGE,
  REIMBURSEMENT_NOT_PAID_MESSAGE,
  REIMBURSEMENT_NOT_REQUESTED_MESSAGE,
  REIMBURSEMENT_PAYMENT_DESCRIPTION,
  REIMBURSEMENT_REQUESTER_NOT_ELIGIBLE_MESSAGE,
  REIMBURSEMENT_SELF_ONLY_MESSAGE,
  REIMBURSEMENT_SPLIT_GROUP_MESSAGE,
  executeReverseReimbursementPayment,
} from "../reimbursementOperations";
import {splitReimbursementCashTransactionIdFor} from "../model";
import {
  actorOf,
  addExternal,
  addMember,
  approveReimbursement,
  assertSplitReconciles,
  balanceOf,
  cancelReimbursement,
  clockAt,
  createGroup,
  createReimbursement,
  defaultAccountOf,
  eventsOf,
  groupRef,
  idempotencyKey,
  memberParticipantId,
  payReimbursement,
  readDoc,
  reimbursementPayload,
  reimbursementRef,
  rejectReimbursement,
  rejectsWith,
  requestId,
  reverseReimbursementPayment,
  seedSplitTenant,
  transactionRef,
  versionOf,
  type SplitTenant,
} from "../testSupport/splitTestSupport";

/**
 * Reembolso PJ (P4-C, §21–§25): membro pede só para si; owner/admin pede
 * para qualquer participante (externo inclusive) e é o único que aprova,
 * rejeita, paga e estorna. Pagar é integral e grava, no mesmo commit, o
 * reembolso pago, a despesa confirmada no Caixa (descrição genérica) e o
 * movimento da conta; estornar compensa na mesma conta e volta a aprovado.
 */
describe("Divisão de contas — reembolso PJ", () => {
  let tenant: SplitTenant;
  let groupId: string;
  let ownerId: string;
  let memberId: string;
  let externalId: string;

  before(async () => {
    tenant = await seedSplitTenant("PJ", "split-reimb");
    groupId = (await createGroup(tenant, {businessMode: "reimbursement",
      name: "Reembolsos"})).groupId;
    ownerId = memberParticipantId(tenant, groupId, tenant.owner);
    await addMember(tenant, groupId, tenant.member);
    await addMember(tenant, groupId, tenant.otherMember, "viewer");
    memberId = memberParticipantId(tenant, groupId, tenant.member);
    externalId = (await addExternal(tenant, groupId, "Prestador"))
      .participantId;
  });

  test("quem pede: membro só para si; admin para externo; visualizador não",
    async () => {
      await rejectsWith(createReimbursement(tenant, reimbursementPayload(
        tenant, groupId, ownerId), tenant.member), "permission_denied",
      REIMBURSEMENT_SELF_ONLY_MESSAGE);
      const own = await createReimbursement(tenant, reimbursementPayload(
        tenant, groupId, memberId), tenant.member);
      const data = await readDoc(reimbursementRef(tenant.workspaceId,
        own.reimbursementId));
      assert.equal(data.status, "requested");
      assert.equal(data.requesterUserId, tenant.member);
      await createReimbursement(tenant, reimbursementPayload(tenant, groupId,
        externalId), tenant.admin);
      const viewerId = memberParticipantId(tenant, groupId, tenant.otherMember);
      await rejectsWith(createReimbursement(tenant, reimbursementPayload(
        tenant, groupId, viewerId), tenant.admin),
      "domain_precondition_failed",
      REIMBURSEMENT_REQUESTER_NOT_ELIGIBLE_MESSAGE);
      // Grupo de rateio não aceita pedido de reembolso.
      const split = await createGroup(tenant);
      await rejectsWith(createReimbursement(tenant, reimbursementPayload(
        tenant, split.groupId, memberParticipantId(tenant, split.groupId,
          tenant.owner))), "domain_precondition_failed",
      REIMBURSEMENT_SPLIT_GROUP_MESSAGE);
      await assertSplitReconciles(tenant.workspaceId, groupId);
    });

  test("aprovar e pagar: só admin; pagamento integral no Caixa no mesmo " +
    "commit; estorno compensa e volta a aprovado", async () => {
    const accountId = defaultAccountOf(tenant.workspaceId);
    const {reimbursementId} = await createReimbursement(tenant,
      reimbursementPayload(tenant, groupId, memberId, {amountCents: 8_750,
        description: "Táxi até o cliente João"}), tenant.member);
    await rejectsWith(approveReimbursement(tenant, reimbursementId,
      tenant.member), "permission_denied", REIMBURSEMENT_ADMIN_ONLY_MESSAGE);
    await rejectsWith(payReimbursement(tenant, reimbursementId),
      "domain_precondition_failed", REIMBURSEMENT_NOT_APPROVED_MESSAGE);
    await approveReimbursement(tenant, reimbursementId, tenant.admin);
    await rejectsWith(approveReimbursement(tenant, reimbursementId),
      "domain_precondition_failed", REIMBURSEMENT_NOT_REQUESTED_MESSAGE);
    await rejectsWith(payReimbursement(tenant, reimbursementId, tenant.member),
      "permission_denied", REIMBURSEMENT_ADMIN_ONLY_MESSAGE);
    const before = await balanceOf(tenant.workspaceId, accountId);
    await payReimbursement(tenant, reimbursementId, tenant.admin,
      {paymentDate: "2026-10-06"});
    const paid = await readDoc(reimbursementRef(tenant.workspaceId,
      reimbursementId));
    const paymentId = splitReimbursementCashTransactionIdFor(
      tenant.workspaceId, reimbursementId, "payment", 1);
    assert.equal(paid.status, "paid");
    assert.equal(paid.cashTransactionId, paymentId);
    assert.equal(paid.cashAccountId, accountId);
    assert.equal(paid.paymentDate, "2026-10-06");
    const mirror = await readDoc(transactionRef(tenant.workspaceId,
      paymentId));
    assert.equal(mirror.type, "despesa");
    assert.equal(mirror.valueCents, 8_750);
    assert.equal(mirror.date, "2026-10-06");
    // Descrição genérica: nada do solicitante nem do texto livre.
    assert.equal(mirror.description, REIMBURSEMENT_PAYMENT_DESCRIPTION);
    assert.equal(JSON.stringify(mirror).includes("João"), false);
    assert.equal(mirror.splitEntry.kind, "reimbursement_payment");
    assert.equal(mirror.splitEntry.reimbursementId, reimbursementId);
    assert.equal(cashPeriodDeltaFor(mirror).expenseCents, 8_750);
    assert.equal(await balanceOf(tenant.workspaceId, accountId),
      before - 8_750);
    await assertSplitReconciles(tenant.workspaceId, groupId);

    // Estorno: mesma conta, compensação, volta a aprovado; replay idempotente.
    const payload = {
      workspaceId: tenant.workspaceId,
      idempotencyKey: idempotencyKey(),
      reimbursementId,
      expectedUpdatedAt: await versionOf(reimbursementRef(tenant.workspaceId,
        reimbursementId)),
    };
    const first = await executeReverseReimbursementPayment(actorOf(tenant,
      tenant.admin), payload, requestId(), clockAt());
    const replay = await executeReverseReimbursementPayment(actorOf(tenant,
      tenant.admin), payload, requestId(), clockAt());
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    const reversalId = splitReimbursementCashTransactionIdFor(
      tenant.workspaceId, reimbursementId, "reversal", 1);
    const reversal = await readDoc(transactionRef(tenant.workspaceId,
      reversalId));
    assert.equal(reversal.type, "receita");
    assert.equal(reversal.cashAccountId, accountId);
    assert.equal(reversal.date, "2026-10-06");
    assert.equal(reversal.splitEntry.reversalOf, paymentId);
    assert.equal(cashPeriodDeltaFor(mirror).expenseCents +
      cashPeriodDeltaFor(reversal).expenseCents, 0);
    assert.equal(await balanceOf(tenant.workspaceId, accountId), before);
    const reverted = await readDoc(reimbursementRef(tenant.workspaceId,
      reimbursementId));
    assert.equal(reverted.status, "approved");
    assert.equal(reverted.cashTransactionId, null);
    assert.equal(reverted.paymentDate, null);
    await rejectsWith(reverseReimbursementPayment(tenant, reimbursementId),
      "domain_precondition_failed", REIMBURSEMENT_NOT_PAID_MESSAGE);
    // Novo pagamento usa a sequência seguinte (IDs novos, nada sobrescrito).
    await payReimbursement(tenant, reimbursementId);
    const repaid = await readDoc(reimbursementRef(tenant.workspaceId,
      reimbursementId));
    assert.equal(repaid.paymentSequence, 2);
    assert.equal(repaid.cashTransactionId,
      splitReimbursementCashTransactionIdFor(tenant.workspaceId,
        reimbursementId, "payment", 2));
    await assertSplitReconciles(tenant.workspaceId, groupId);
    // A trilha não guarda texto livre.
    const events = await eventsOf(tenant.workspaceId, groupId);
    assert.equal(JSON.stringify(events).includes("João"), false);
  });

  test("rejeitar e cancelar: regras por estado e por papel", async () => {
    const a = await createReimbursement(tenant, reimbursementPayload(tenant,
      groupId, memberId), tenant.member);
    const b = await createReimbursement(tenant, reimbursementPayload(tenant,
      groupId, memberId), tenant.member);
    await rejectsWith(rejectReimbursement(tenant, a.reimbursementId,
      tenant.member), "permission_denied", REIMBURSEMENT_ADMIN_ONLY_MESSAGE);
    await rejectReimbursement(tenant, a.reimbursementId, tenant.admin,
      "Sem comprovante do cliente Maria");
    const rejected = await readDoc(reimbursementRef(tenant.workspaceId,
      a.reimbursementId));
    assert.equal(rejected.status, "rejected");
    assert.equal(rejected.rejectionReason, "Sem comprovante do cliente Maria");
    const events = await eventsOf(tenant.workspaceId, groupId);
    assert.equal(JSON.stringify(events).includes("Maria"), false);
    await rejectsWith(approveReimbursement(tenant, a.reimbursementId),
      "domain_precondition_failed", REIMBURSEMENT_NOT_REQUESTED_MESSAGE);
    // Solicitante cancela o próprio pedido enquanto aguarda aprovação.
    await approveReimbursement(tenant, b.reimbursementId);
    await rejectsWith(cancelReimbursement(tenant, b.reimbursementId,
      tenant.member), "permission_denied", REIMBURSEMENT_CANCEL_DENIED_MESSAGE);
    await cancelReimbursement(tenant, b.reimbursementId, tenant.admin);
    const c = await createReimbursement(tenant, reimbursementPayload(tenant,
      groupId, memberId), tenant.member);
    await cancelReimbursement(tenant, c.reimbursementId, tenant.member);
    await assertSplitReconciles(tenant.workspaceId, groupId);
    const group = await readDoc(groupRef(tenant.workspaceId, groupId));
    assert.ok(group.totals.reimbursementPaidCents >= 8_750);
  });
});
