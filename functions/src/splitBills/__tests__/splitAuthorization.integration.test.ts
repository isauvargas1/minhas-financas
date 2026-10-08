import assert from "node:assert/strict";
import {before, describe, test} from "node:test";

import {seedMember} from "../../shared/testSupport/kernelTestSupport";
import {
  BILL_EDIT_DENIED_MESSAGE,
  BILL_PARTICIPANT_NOT_ELIGIBLE_MESSAGE,
  BILL_REIMBURSEMENT_GROUP_MESSAGE,
  executeVoidSplitBill,
} from "../billOperations";
import {
  BILL_NOT_FOUND_MESSAGE,
  GROUP_ARCHIVED_MESSAGE,
  GROUP_NOT_FOUND_MESSAGE,
  GROUP_WRITE_DENIED_MESSAGE,
  PARTICIPANT_NOT_FOUND_MESSAGE,
  SHARE_CONFLICT_MESSAGE,
} from "../common";
import {
  SHARE_DEBTOR_DENIED_MESSAGE,
  SHARE_FORGIVE_DENIED_MESSAGE,
  SHARE_SETTLE_DENIED_MESSAGE,
  executeSettleSplitShare,
} from "../shareOperations";
import {
  actorOf,
  addExternal,
  addMember,
  archiveGroup,
  assertSplitReconciles,
  billPayload,
  clockAt,
  createBill,
  createGroup,
  deactivateParticipant,
  forgiveShare,
  idempotencyKey,
  memberParticipantId,
  rejectsWith,
  requestId,
  reverseSettlement,
  seedGroupWithMembers,
  seedSplitTenant,
  settleShare,
  shareIdOf,
  shareRef,
  updateBill,
  versionOf,
  type SplitTenant,
} from "../testSupport/splitTestSupport";

/**
 * Autorização e isolamento (P4-C, §4, §14, §15, §19): papel do workspace e
 * papel no grupo relidos na transação; a identidade é o `uid` (participante
 * derivado dele), nunca um nome; nada atravessa o workspace.
 */
describe("Divisão de contas — autorização e isolamento", () => {
  let tenant: SplitTenant;

  before(async () => {
    tenant = await seedSplitTenant("PF", "split-auth");
  });

  test("lançar: viewer do espaço e visualizador do grupo não lançam; " +
    "membro de fora do grupo também não; admin lança", async () => {
    const ids = await seedGroupWithMembers(tenant);
    await addMember(tenant, ids.groupId, tenant.admin, "viewer");
    const adminParticipant = memberParticipantId(tenant, ids.groupId,
      tenant.admin);
    const payload = () => billPayload(tenant, ids.groupId, ids.owner,
      [ids.owner, ids.member]);
    await rejectsWith(createBill(tenant, payload(), tenant.viewer),
      "workspace_role_denied");
    // O admin do espaço lança mesmo como visualizador do grupo.
    const adminBill = await createBill(tenant, payload(), tenant.admin);
    assert.equal(adminBill.replayed, false);
    // Visualizador do grupo não é parte financeira de uma despesa.
    await rejectsWith(createBill(tenant, billPayload(tenant, ids.groupId,
      ids.owner, [ids.owner, adminParticipant])),
    "domain_precondition_failed", BILL_PARTICIPANT_NOT_ELIGIBLE_MESSAGE);
    const outsider = await createGroup(tenant);
    const outsiderOwner = memberParticipantId(tenant, outsider.groupId,
      tenant.owner);
    await rejectsWith(createBill(tenant, billPayload(tenant, outsider.groupId,
      outsiderOwner, [outsiderOwner]), tenant.member), "permission_denied",
    GROUP_WRITE_DENIED_MESSAGE);
    // Participante de outro grupo não entra no rateio.
    await rejectsWith(createBill(tenant, billPayload(tenant, ids.groupId,
      ids.owner, [ids.owner, outsiderOwner])), "not_found",
    PARTICIPANT_NOT_FOUND_MESSAGE);
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
  });

  test("quitação: nunca o devedor; o pagador (no grupo), o dono e o admin " +
    "podem; outro participante não", async () => {
    const ids = await seedGroupWithMembers(tenant);
    // O member paga; o owner (dono do grupo) e o otherMember devem.
    const {billId} = await createBill(tenant, billPayload(tenant, ids.groupId,
      ids.member, [ids.owner, ids.member, ids.otherMember]), tenant.member);
    const ownerShare = shareIdOf(tenant, billId, ids.owner);
    const otherShare = shareIdOf(tenant, billId, ids.otherMember);
    await rejectsWith(settleShare(tenant, otherShare, tenant.otherMember),
      "permission_denied", SHARE_DEBTOR_DENIED_MESSAGE);
    // O dono do grupo (e owner do espaço) também não quita a própria dívida.
    await rejectsWith(settleShare(tenant, ownerShare, tenant.owner),
      "permission_denied", SHARE_DEBTOR_DENIED_MESSAGE);
    await rejectsWith(forgiveShare(tenant, ownerShare, tenant.owner),
      "permission_denied", SHARE_DEBTOR_DENIED_MESSAGE);
    await settleShare(tenant, ownerShare, tenant.member);
    // Perdoar: o pagador comum não perdoa; o admin do espaço sim.
    await rejectsWith(forgiveShare(tenant, otherShare, tenant.member),
      "permission_denied", SHARE_FORGIVE_DENIED_MESSAGE);
    await forgiveShare(tenant, otherShare, tenant.admin);
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
  });

  test("quitação com pagador externo: só o dono do grupo ou o admin",
    async () => {
      const ids = await seedGroupWithMembers(tenant);
      const {participantId: external} = await addExternal(tenant, ids.groupId);
      const {billId} = await createBill(tenant, billPayload(tenant, ids.groupId,
        external, [external, ids.member, ids.otherMember]));
      await rejectsWith(settleShare(tenant, shareIdOf(tenant, billId,
        ids.otherMember), tenant.member), "permission_denied",
      SHARE_SETTLE_DENIED_MESSAGE);
      await settleShare(tenant, shareIdOf(tenant, billId, ids.otherMember),
        tenant.owner);
      await settleShare(tenant, shareIdOf(tenant, billId, ids.member),
        tenant.admin);
      await assertSplitReconciles(tenant.workspaceId, ids.groupId);
    });

  test("edição: quem lançou, o pagador, o dono ou o admin; versão velha " +
    "é conflito", async () => {
    const ids = await seedGroupWithMembers(tenant);
    const {billId} = await createBill(tenant, billPayload(tenant, ids.groupId,
      ids.member, [ids.member, ids.otherMember]), tenant.member);
    await rejectsWith(updateBill(tenant, billId, {metadata: {
      description: "Outro"}}, tenant.otherMember), "permission_denied",
    BILL_EDIT_DENIED_MESSAGE);
    await updateBill(tenant, billId, {metadata: {description: "Jantar A"}},
      tenant.member);
    // Versão lida antes da quitação de outro ator: recusa por conflito.
    const share = shareIdOf(tenant, billId, ids.otherMember);
    const stale = await versionOf(shareRef(tenant.workspaceId, share));
    await settleShare(tenant, share, tenant.member);
    await reverseSettlement(tenant, share, tenant.member);
    await rejectsWith(executeSettleSplitShare(actorOf(tenant, tenant.owner), {
      workspaceId: tenant.workspaceId,
      idempotencyKey: idempotencyKey(),
      shareId: share,
      expectedUpdatedAt: stale,
    }, requestId(), clockAt()), "concurrent_update", SHARE_CONFLICT_MESSAGE);
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
  });

  test("grupo arquivado não aceita lançamento; modo errado é recusado",
    async () => {
      const ids = await seedGroupWithMembers(tenant);
      await archiveGroup(tenant, ids.groupId);
      await rejectsWith(createBill(tenant, billPayload(tenant, ids.groupId,
        ids.owner, [ids.owner])), "domain_precondition_failed",
      GROUP_ARCHIVED_MESSAGE);
      const pj = await seedSplitTenant("PJ", "split-auth-pj");
      const {groupId} = await createGroup(pj, {businessMode: "reimbursement"});
      const owner = memberParticipantId(pj, groupId, pj.owner);
      await rejectsWith(createBill(pj, billPayload(pj, groupId, owner,
        [owner])), "domain_precondition_failed",
      BILL_REIMBURSEMENT_GROUP_MESSAGE);
    });

  test("isolamento: IDs de outro workspace não existem para o ator",
    async () => {
      const other = await seedSplitTenant("PF", "split-auth-other");
      const ids = await seedGroupWithMembers(tenant);
      const {billId} = await createBill(tenant, billPayload(tenant, ids.groupId,
        ids.owner, [ids.owner, ids.member]));
      // O ator do outro espaço usa os IDs deste no próprio espaço: nada existe.
      await rejectsWith(createBill(other, billPayload(other, ids.groupId,
        ids.owner, [ids.owner])), "not_found", GROUP_NOT_FOUND_MESSAGE);
      await rejectsWith(executeVoidSplitBill(actorOf(other, other.owner), {
        workspaceId: other.workspaceId,
        idempotencyKey: idempotencyKey(),
        billId,
        expectedUpdatedAt: "2026-10-07T12:00:00.000000000Z",
      }, requestId(), clockAt()), "not_found", BILL_NOT_FOUND_MESSAGE);
      // E o ator deste espaço não age no outro (sem membership lá).
      await rejectsWith(createGroup({...tenant,
        workspaceId: other.workspaceId}), "workspace_membership_required");
    });

  test("membro removido do espaço perde o acesso imediatamente", async () => {
    const removed = await seedSplitTenant("PF", "split-auth-removed");
    const ids = await seedGroupWithMembers(removed);
    const {billId} = await createBill(removed, billPayload(removed,
      ids.groupId, ids.member, [ids.member, ids.owner]), removed.member);
    await seedMember(removed.workspaceId, removed.member, "member", "removed");
    await rejectsWith(settleShare(removed, shareIdOf(removed, billId,
      ids.owner), removed.member), "workspace_membership_required");
    await rejectsWith(deactivateParticipant(removed, ids.groupId, ids.member,
      removed.member), "workspace_membership_required");
  });
});
