import assert from "node:assert/strict";
import {before, describe, test} from "node:test";

import {
  GROUP_HAS_OPEN_ITEMS_MESSAGE,
  GROUP_UNCHANGED_MESSAGE,
} from "../groupOperations";
import {
  BILL_HAS_FORGIVEN_MESSAGE,
  BILL_HAS_SETTLEMENTS_MESSAGE,
  BILL_TERMS_LOCKED_MESSAGE,
  BILL_UNCHANGED_MESSAGE,
} from "../billOperations";
import {SHARE_NOT_OPEN_MESSAGE} from "../shareOperations";
import {
  OWNER_CANNOT_LEAVE_MESSAGE,
  PARTICIPANT_HAS_OPEN_ITEMS_MESSAGE,
} from "../participantOperations";
import {
  activeSplitGroups,
  addExternal,
  archiveGroup,
  assertSplitReconciles,
  billPayload,
  billRef,
  createBill,
  createGroup,
  deactivateParticipant,
  eventsOf,
  forgiveShare,
  groupRef,
  memberParticipantId,
  participantRef,
  reactivateGroup,
  readDoc,
  rejectsWith,
  reverseSettlement,
  seedGroupWithMembers,
  seedSplitTenant,
  settleShare,
  shareIdOf,
  shareRef,
  sharesOfBill,
  updateBill,
  updateGroup,
  voidBill,
  type SplitTenant,
} from "../testSupport/splitTestSupport";

/**
 * Ciclo de vida da Divisão de contas (P4-C): grupo com dono no mesmo
 * commit, participantes, título com rateio exato, quitação, estorno,
 * perdão, edição, anulação e arquivamento — com a reconciliação dos
 * agregados depois de cada passo.
 */
describe("Divisão de contas — ciclo de vida", () => {
  let tenant: SplitTenant;

  before(async () => {
    tenant = await seedSplitTenant("PF", "split-life");
  });

  test("criação do grupo: dono no mesmo commit, vaga da quota e evento",
    async () => {
      const result = await createGroup(tenant);
      assert.equal(result.replayed, false);
      const group = await readDoc(groupRef(tenant.workspaceId,
        result.groupId));
      const ownerId = memberParticipantId(tenant, result.groupId,
        tenant.owner);
      assert.equal(group.ownerParticipantId, ownerId);
      assert.equal(group.ownerUserId, tenant.owner);
      assert.equal(group.status, "active");
      const owner = await readDoc(participantRef(tenant.workspaceId,
        ownerId));
      assert.equal(owner.role, "owner");
      assert.equal(owner.kind, "workspace_member");
      assert.equal(owner.userId, tenant.owner);
      assert.equal(await activeSplitGroups(tenant.workspaceId), 1);
      const events = await eventsOf(tenant.workspaceId, result.groupId);
      assert.deepEqual(events.map((event) => event.operation),
        ["split.group_created"]);
      await assertSplitReconciles(tenant.workspaceId, result.groupId);
    });

  test("título igual em três: Σ rateios = valor, pagador quitado, " +
    "maior resto determinístico", async () => {
    const ids = await seedGroupWithMembers(tenant);
    const participants = [ids.owner, ids.member, ids.otherMember];
    const {billId} = await createBill(tenant, billPayload(tenant,
      ids.groupId, ids.owner, participants));
    const shares = await sharesOfBill(tenant.workspaceId, billId);
    assert.equal(shares.reduce((sum, share) => sum + share.amountDueCents, 0),
      10_000);
    // Ordenados pelo ID do participante: o primeiro leva o centavo extra.
    assert.deepEqual(shares.map((share) => share.amountDueCents),
      [3_334, 3_333, 3_333]);
    const payerShare = shares.find((share) =>
      share.participantId === ids.owner);
    assert.equal(payerShare?.status, "settled");
    assert.equal(payerShare?.settledVia, "payer_self");
    const bill = await readDoc(billRef(tenant.workspaceId, billId));
    assert.equal(bill.status, "open");
    assert.equal(bill.openShareCount, 2);
    assert.equal(bill.outstandingCents,
      10_000 - (payerShare?.amountDueCents as number));
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
  });

  test("quitação, estorno e perdão mantêm título e agregados exatos",
    async () => {
      const ids = await seedGroupWithMembers(tenant);
      const {billId} = await createBill(tenant, billPayload(tenant,
        ids.groupId, ids.owner, [ids.owner, ids.member, ids.otherMember],
        {amountCents: 9_000}));
      const memberShare = shareIdOf(tenant, billId, ids.member);
      const otherShare = shareIdOf(tenant, billId, ids.otherMember);

      await settleShare(tenant, memberShare);
      let share = await readDoc(shareRef(tenant.workspaceId, memberShare));
      assert.equal(share.status, "settled");
      assert.equal(share.settledVia, "settlement");
      assert.equal(share.amountSettledCents, 3_000);
      await assertSplitReconciles(tenant.workspaceId, ids.groupId);
      await rejectsWith(settleShare(tenant, memberShare),
        "domain_precondition_failed", SHARE_NOT_OPEN_MESSAGE);

      await reverseSettlement(tenant, memberShare);
      share = await readDoc(shareRef(tenant.workspaceId, memberShare));
      assert.equal(share.status, "open");
      assert.equal(share.amountSettledCents, 0);
      await assertSplitReconciles(tenant.workspaceId, ids.groupId);

      await settleShare(tenant, memberShare);
      await forgiveShare(tenant, otherShare);
      const bill = await readDoc(billRef(tenant.workspaceId, billId));
      assert.equal(bill.status, "settled");
      assert.equal(bill.openShareCount, 0);
      assert.equal(bill.outstandingCents, 0);
      assert.equal(bill.resolvedShareCount, 2);
      await assertSplitReconciles(tenant.workspaceId, ids.groupId);
      // Perdão é terminal: o título não pode mais ser anulado.
      await rejectsWith(voidBill(tenant, billId),
        "domain_precondition_failed", BILL_HAS_FORGIVEN_MESSAGE);
      // Termos travados depois de quitação/perdão.
      await rejectsWith(updateBill(tenant, billId, {terms: {
        amountCents: 12_000,
        expenseDate: bill.expenseDate,
        payerParticipantId: ids.owner,
        allocationMethod: "equal",
        participants: [{participantId: ids.owner},
          {participantId: ids.member}],
        financialIntegration: "none",
        cashAccountId: null,
        cardId: null,
        installmentsCount: null,
      }}), "domain_precondition_failed", BILL_TERMS_LOCKED_MESSAGE);
      // Descrição e categoria seguem editáveis.
      await updateBill(tenant, billId, {metadata: {category: "Lazer"}});
      await assertSplitReconciles(tenant.workspaceId, ids.groupId);
      const group = await readDoc(groupRef(tenant.workspaceId, ids.groupId));
      assert.deepEqual(group.totals.categoryTotals, {Lazer: 9_000});
    });

  test("edição dos termos antes de qualquer quitação: rateios no lugar, " +
    "quem sai fica anulado", async () => {
    const ids = await seedGroupWithMembers(tenant);
    const {billId} = await createBill(tenant, billPayload(tenant,
      ids.groupId, ids.owner, [ids.owner, ids.member, ids.otherMember]));
    const bill = await readDoc(billRef(tenant.workspaceId, billId));
    const terms = {
      amountCents: 10_001,
      expenseDate: bill.expenseDate as string,
      payerParticipantId: ids.member,
      allocationMethod: "percentage" as const,
      participants: [
        {participantId: ids.owner, weightBps: 2_500},
        {participantId: ids.member, weightBps: 7_500},
      ],
      financialIntegration: "none" as const,
      cashAccountId: null,
      cardId: null,
      installmentsCount: null,
    };
    await updateBill(tenant, billId, {terms});
    const shares = await sharesOfBill(tenant.workspaceId, billId);
    const byParticipant = new Map(shares.map((share) =>
      [share.participantId, share]));
    assert.equal(byParticipant.get(ids.otherMember)?.status, "voided");
    const live = shares.filter((share) => share.status !== "voided");
    assert.equal(live.reduce((sum, share) => sum + share.amountDueCents, 0),
      10_001);
    assert.equal(byParticipant.get(ids.member)?.settledVia, "payer_self");
    const updated = await readDoc(billRef(tenant.workspaceId, billId));
    assert.equal(updated.termsRevision, 2);
    assert.equal(updated.payerParticipantId, ids.member);
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
    await rejectsWith(updateBill(tenant, billId, {terms}),
      "domain_precondition_failed", BILL_UNCHANGED_MESSAGE);
  });

  test("anulação: recusada com recebimento registrado; depois do estorno " +
    "anula sem apagar nada", async () => {
    const ids = await seedGroupWithMembers(tenant);
    const {billId} = await createBill(tenant, billPayload(tenant,
      ids.groupId, ids.owner, [ids.owner, ids.member]));
    const memberShare = shareIdOf(tenant, billId, ids.member);
    await settleShare(tenant, memberShare);
    await rejectsWith(voidBill(tenant, billId),
      "domain_precondition_failed", BILL_HAS_SETTLEMENTS_MESSAGE);
    await reverseSettlement(tenant, memberShare);
    await voidBill(tenant, billId);
    const bill = await readDoc(billRef(tenant.workspaceId, billId));
    assert.equal(bill.status, "voided");
    const shares = await sharesOfBill(tenant.workspaceId, billId);
    assert.equal(shares.length, 2);
    assert.ok(shares.every((share) => share.status === "voided"));
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
  });

  test("participantes: externo entra só com nome; dono não sai; " +
    "obrigação aberta impede a desativação", async () => {
    const ids = await seedGroupWithMembers(tenant);
    const {participantId: external} = await addExternal(tenant, ids.groupId,
      "Carla");
    const data = await readDoc(participantRef(tenant.workspaceId,
      external as string));
    assert.equal(data.kind, "external");
    assert.equal(data.userId, null);
    assert.equal(data.role, "participant");
    await rejectsWith(deactivateParticipant(tenant, ids.groupId, ids.owner),
      "domain_precondition_failed", OWNER_CANNOT_LEAVE_MESSAGE);
    const {billId} = await createBill(tenant, billPayload(tenant,
      ids.groupId, ids.owner, [ids.owner, external as string]));
    await rejectsWith(
      deactivateParticipant(tenant, ids.groupId, external as string),
      "domain_precondition_failed", PARTICIPANT_HAS_OPEN_ITEMS_MESSAGE);
    await settleShare(tenant, shareIdOf(tenant, billId, external as string));
    await deactivateParticipant(tenant, ids.groupId, external as string);
    const after = await readDoc(participantRef(tenant.workspaceId,
      external as string));
    assert.equal(after.status, "inactive");
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
    // O próprio membro pode sair quando não deve nada.
    await deactivateParticipant(tenant, ids.groupId, ids.otherMember,
      tenant.otherMember);
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
  });

  test("arquivar exige nada em aberto e libera a vaga; reativar consome",
    async () => {
      const ids = await seedGroupWithMembers(tenant);
      const {billId} = await createBill(tenant, billPayload(tenant,
        ids.groupId, ids.owner, [ids.owner, ids.member]));
      await rejectsWith(archiveGroup(tenant, ids.groupId),
        "domain_precondition_failed", GROUP_HAS_OPEN_ITEMS_MESSAGE);
      await settleShare(tenant, shareIdOf(tenant, billId, ids.member));
      const before = await activeSplitGroups(tenant.workspaceId);
      await archiveGroup(tenant, ids.groupId);
      assert.equal(await activeSplitGroups(tenant.workspaceId), before - 1);
      const archived = await readDoc(groupRef(tenant.workspaceId,
        ids.groupId));
      assert.equal(archived.status, "archived");
      await reactivateGroup(tenant, ids.groupId);
      assert.equal(await activeSplitGroups(tenant.workspaceId), before);
      await rejectsWith(updateGroup(tenant, ids.groupId, {name: "Viagem"}),
        "domain_precondition_failed", GROUP_UNCHANGED_MESSAGE);
      await updateGroup(tenant, ids.groupId, {name: "Viagem à praia"});
      await assertSplitReconciles(tenant.workspaceId, ids.groupId);
    });
});
