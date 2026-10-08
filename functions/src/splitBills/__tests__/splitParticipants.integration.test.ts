import assert from "node:assert/strict";
import {before, describe, test} from "node:test";

import {seedMember} from "../../shared/testSupport/kernelTestSupport";
import {db} from "../../workspaces/testSupport/p1TestSupport";
import {GROUP_MANAGE_DENIED_MESSAGE} from "../common";
import {
  ALREADY_PARTICIPANT_MESSAGE,
  ALREADY_PARTICIPANT_SELF_MESSAGE,
  DEACTIVATE_DENIED_MESSAGE,
  INVITE_ALREADY_REVOKED_MESSAGE,
  INVITE_ALREADY_USED_MESSAGE,
  INVITE_INVALID_MESSAGE,
  INVITE_LIMIT_MESSAGE,
  MEMBER_NOT_ELIGIBLE_MESSAGE,
} from "../participantOperations";
import {
  acceptInvite,
  addExternal,
  addMember,
  assertSplitReconciles,
  clockAt,
  createGroup,
  createInvite,
  deactivateParticipant,
  eventsOf,
  inviteRef,
  memberParticipantId,
  participantRef,
  readDoc,
  rejectsWith,
  revokeInvite,
  seedGroupWithMembers,
  seedSplitTenant,
  type SplitTenant,
} from "../testSupport/splitTestSupport";

/**
 * Participantes e convites (P4-C, D-14 §3–§6, §26–§27): membro do
 * workspace com `uid` validado contra membership ativo; externo só com
 * nome; convite por código CSPRNG guardado só como hash, de uso único, com
 * validade, papel fixo e rate limit que conta as tentativas que falham.
 */
describe("Divisão de contas — participantes e convites", () => {
  let tenant: SplitTenant;

  before(async () => {
    tenant = await seedSplitTenant("PF", "split-part");
  });

  test("convite: o documento guarda só o hash; aceite cria o participante " +
    "com o papel do convite; uso único", async () => {
    const {groupId} = await createGroup(tenant);
    const created = await createInvite(tenant, groupId, "viewer");
    assert.match(String(created.code), /^[A-HJ-NP-Z2-9]{10}$/);
    const invite = await readDoc(inviteRef(tenant.workspaceId,
      created.inviteId));
    assert.equal(invite.status, "pending");
    assert.equal(invite.role, "viewer");
    assert.equal(invite.codeHint, String(created.code).slice(-3));
    assert.equal(JSON.stringify(invite).includes(String(created.code)), false,
      "código em claro gravado");
    // O recibo da chave também não guarda o código.
    const receipts = await db()
      .collection(`users/${tenant.owner}/idempotency_keys`).get();
    assert.equal(receipts.docs.some((doc) =>
      JSON.stringify(doc.data()).includes(String(created.code))), false);

    const accepted = await acceptInvite(tenant,
      `${String(created.code).slice(0, 5)}-${String(created.code).slice(5)}`
        .toLowerCase(), tenant.member);
    const participantId = memberParticipantId(tenant, groupId, tenant.member);
    assert.equal(accepted.participantId, participantId);
    const participant = await readDoc(participantRef(tenant.workspaceId,
      participantId));
    assert.equal(participant.role, "viewer");
    assert.equal(participant.userId, tenant.member);
    assert.equal(participant.displayName, null);
    const used = await readDoc(inviteRef(tenant.workspaceId,
      created.inviteId));
    assert.equal(used.status, "accepted");
    assert.equal(used.acceptedBy, tenant.member);
    // Uso único: o mesmo código não serve para outro membro.
    await rejectsWith(acceptInvite(tenant, String(created.code),
      tenant.otherMember), "not_found", INVITE_INVALID_MESSAGE);
    await rejectsWith(revokeInvite(tenant, groupId, created.inviteId),
      "domain_precondition_failed", INVITE_ALREADY_USED_MESSAGE);
    await assertSplitReconciles(tenant.workspaceId, groupId);
  });

  test("convite: expirado, revogado ou inexistente têm a mesma resposta; " +
    "viewer do espaço e quem já participa não aceitam", async () => {
    const {groupId} = await createGroup(tenant);
    const expiring = await createInvite(tenant, groupId, "participant",
      tenant.owner, clockAt("2026-09-01"));
    await rejectsWith(acceptInvite(tenant, String(expiring.code),
      tenant.member, clockAt("2026-09-09")), "not_found",
    INVITE_INVALID_MESSAGE);
    const revoked = await createInvite(tenant, groupId);
    await revokeInvite(tenant, groupId, revoked.inviteId);
    await rejectsWith(revokeInvite(tenant, groupId, revoked.inviteId),
      "domain_precondition_failed", INVITE_ALREADY_REVOKED_MESSAGE);
    await rejectsWith(acceptInvite(tenant, String(revoked.code),
      tenant.member), "not_found", INVITE_INVALID_MESSAGE);
    await rejectsWith(acceptInvite(tenant, "ABCDEFGH23", tenant.member),
      "not_found", INVITE_INVALID_MESSAGE);
    const valid = await createInvite(tenant, groupId);
    await rejectsWith(acceptInvite(tenant, String(valid.code), tenant.viewer),
      "workspace_role_denied");
    await rejectsWith(acceptInvite(tenant, String(valid.code), tenant.owner),
      "domain_precondition_failed", ALREADY_PARTICIPANT_SELF_MESSAGE);
    // Só quem administra o grupo gera convite.
    await addMember(tenant, groupId, tenant.member);
    await rejectsWith(createInvite(tenant, groupId, "participant",
      tenant.member), "permission_denied", GROUP_MANAGE_DENIED_MESSAGE);
  });

  test("convite: membro de outro workspace não alcança o código", async () => {
    const other = await seedSplitTenant("PF", "split-part-other");
    const {groupId} = await createGroup(tenant);
    const created = await createInvite(tenant, groupId);
    // O ator de outro espaço não é membro deste: recusa antes do código.
    await rejectsWith(acceptInvite(tenant, String(created.code), other.member),
      "workspace_membership_required");
    // E no espaço dele o mesmo código não existe (o ID deriva do espaço).
    await rejectsWith(acceptInvite(other, String(created.code), other.member),
      "not_found", INVITE_INVALID_MESSAGE);
  });

  test("rate limit do aceite conta as tentativas que falham", async () => {
    const limited = await seedSplitTenant("PF", "split-part-rate");
    const {groupId} = await createGroup(limited);
    const created = await createInvite(limited, groupId);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await rejectsWith(acceptInvite(limited, "ABCDEFGH23", limited.member),
        "not_found");
    }
    // O código válido também é barrado: o orçamento foi gasto nas falhas.
    await rejectsWith(acceptInvite(limited, String(created.code),
      limited.member), "domain_precondition_failed", /Muitas solicitações/);
  });

  test("limite de convites pendentes por grupo", async () => {
    const many = await seedSplitTenant("PF", "split-part-invites");
    const {groupId} = await createGroup(many);
    // Dois usuários para não esbarrar no rate limit de geração (10/h).
    for (let index = 0; index < 20; index += 1) {
      await createInvite(many, groupId, "participant",
        index < 10 ? many.owner : many.admin);
    }
    await rejectsWith(createInvite(many, groupId, "participant", many.admin),
      "domain_precondition_failed", INVITE_LIMIT_MESSAGE);
  });

  test("inclusão direta: só membro ativo (não viewer); sem duplicar; " +
    "reativa o registro inativo", async () => {
    const {groupId} = await createGroup(tenant);
    await rejectsWith(addMember(tenant, groupId, tenant.viewer),
      "domain_precondition_failed", MEMBER_NOT_ELIGIBLE_MESSAGE);
    await rejectsWith(addMember(tenant, groupId, "uid-que-nao-existe"),
      "domain_precondition_failed", MEMBER_NOT_ELIGIBLE_MESSAGE);
    await addMember(tenant, groupId, tenant.member);
    await rejectsWith(addMember(tenant, groupId, tenant.member),
      "domain_precondition_failed", ALREADY_PARTICIPANT_MESSAGE);
    const participantId = memberParticipantId(tenant, groupId, tenant.member);
    await deactivateParticipant(tenant, groupId, participantId);
    await addMember(tenant, groupId, tenant.member, "viewer");
    const back = await readDoc(participantRef(tenant.workspaceId,
      participantId));
    assert.equal(back.status, "active");
    assert.equal(back.role, "viewer");
    // Membro removido do espaço não pode ser incluído.
    const removed = await seedSplitTenant("PF", "split-part-removed");
    const removedGroup = (await createGroup(removed)).groupId;
    await seedMember(removed.workspaceId, removed.member, "member", "removed");
    await rejectsWith(addMember(removed, removedGroup, removed.member),
      "domain_precondition_failed", MEMBER_NOT_ELIGIBLE_MESSAGE);
    await assertSplitReconciles(tenant.workspaceId, groupId);
  });

  test("externo: só nome, sem login; o nome não vai para a trilha",
    async () => {
      const {groupId} = await createGroup(tenant);
      const {participantId} = await addExternal(tenant, groupId,
        "Fulana de Tal Externa");
      const external = await readDoc(participantRef(tenant.workspaceId,
        participantId));
      assert.equal(external.kind, "external");
      assert.equal(external.userId, null);
      assert.equal(external.role, "participant");
      const events = await eventsOf(tenant.workspaceId, groupId);
      assert.equal(JSON.stringify(events).includes("Fulana"), false);
      // Participante comum não inclui ninguém.
      await addMember(tenant, groupId, tenant.member);
      await rejectsWith(addExternal(tenant, groupId, "Outro", tenant.member),
        "permission_denied", GROUP_MANAGE_DENIED_MESSAGE);
      await assertSplitReconciles(tenant.workspaceId, groupId);
    });

  test("desativação: o próprio participante sai; outro participante não " +
    "remove ninguém; admin do espaço remove", async () => {
    const ids = await seedGroupWithMembers(tenant);
    await rejectsWith(deactivateParticipant(tenant, ids.groupId,
      ids.otherMember, tenant.member), "permission_denied",
    DEACTIVATE_DENIED_MESSAGE);
    await deactivateParticipant(tenant, ids.groupId, ids.member,
      tenant.member);
    await deactivateParticipant(tenant, ids.groupId, ids.otherMember,
      tenant.admin);
    const group = await readDoc(db().doc(
      `workspaces/${tenant.workspaceId}/split_groups/${ids.groupId}`));
    assert.equal(group.counters.activeParticipantCount, 1);
    assert.equal(group.counters.participantCount, 3);
    await assertSplitReconciles(tenant.workspaceId, ids.groupId);
  });
});
