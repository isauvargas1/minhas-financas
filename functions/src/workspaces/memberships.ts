import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {billingAccountRef} from "../billing/model";
import {
  assertCanonicalOwnerMembership,
  assertWithinQuota,
  canonicalOwnerCandidate,
  entitlementAt,
  liveReservations,
  membershipQuotaRef,
  ownershipQuotaRef,
  quotaStateUnavailable,
  readMembershipQuota,
  readOwnershipQuota,
  releasedMember,
  releasedOwnership,
  transferQuotaExceeded,
  writeMembershipQuota,
  writeOwnershipQuota,
} from "../billing/quota";
import {appendMembershipEvent} from "../shared/audit";
import type {CallerIdentity} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
} from "../shared/idempotency";
import {reserveRateLimit, type RateLimitPolicy} from "../shared/rateLimit";
import {
  assertActiveAccountSnapshot,
  evaluateWorkspaceAccess,
  isWorkspaceRole,
  reassertWorkspaceActor,
  userProfileRef,
  workspaceMemberRef,
  workspaceRef,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import type {
  InviteWorkspaceMemberPayload,
  TransferWorkspaceOwnershipPayload,
} from "./contracts";
import {
  INVITE_TTL_DAYS,
  hashInviteToken,
  normalizeEmail,
} from "./inviteTokens";
import {
  INVITES_COLLECTION,
  inviteExpiresAt,
  inviteRef,
  inviteTokenRef,
  newInviteRef,
  workspaceDisplayOf,
  writeActiveMembership,
  writeRemovedMembership,
} from "./model";
import {
  canChangeRole,
  canInvite,
  canRemove,
  canRevokeInvite,
  MANAGEABLE_ROLES,
  type ManageableRole,
} from "./rbac";

const isManageableRole = (value: unknown): value is ManageableRole =>
  typeof value === "string" &&
  (MANAGEABLE_ROLES as readonly string[]).includes(value);

const db = () => admin.firestore();

/**
 * Resposta única para qualquer falha de aceite (D-05): token inexistente,
 * expirado, revogado, já usado por outra pessoa, de outro e-mail ou de
 * workspace indisponível. Diferenciar os casos permitiria testar tokens e
 * descobrir convites alheios.
 */
export const INVITE_UNAVAILABLE_MESSAGE =
  "Este convite é inválido, expirou ou já foi utilizado.";

const inviteUnavailable = () =>
  new ApplicationError("not_found", INVITE_UNAVAILABLE_MESSAGE);

const roleDenied = (message: string) =>
  new ApplicationError("workspace_role_denied", message);

/** Emissão de convites por ator e workspace. */
export const INVITE_RATE_LIMIT: RateLimitPolicy = {
  operation: "inviteWorkspaceMember",
  limit: 30,
  windowSeconds: 60 * 60,
};

/**
 * Tentativas de aceite por usuário, contadas mesmo quando falham (consumidas
 * antes da transação do aceite, em `consumeUserRateLimit`).
 */
export const ACCEPT_RATE_LIMIT: RateLimitPolicy = {
  operation: "acceptWorkspaceInvite",
  limit: 10,
  windowSeconds: 60 * 60,
};

export interface InviteResult extends Record<string, unknown> {
  inviteId: string;
  expiresAt: string;
}

/**
 * `inviteWorkspaceMember` (PR-WS-01).
 *
 * Não cria membership: só o convite pendente, vinculado ao e-mail
 * normalizado. `tokenHash` é o SHA-256 do token gerado pelo chamador desta
 * função; o token em claro não é persistido nem devolvido. A entrega ao
 * convidado depende do e-mail transacional (E-11) e não é simulada.
 *
 * Um convite pendente anterior para o mesmo e-mail é revogado na mesma
 * transação: há no máximo um convite válido por pessoa e workspace.
 *
 * Quota (P2B.1): o convite reserva uma vaga até expirar (mesmo `expiresAt`).
 * Na transação: owner canônico, billing dele e quota de membros do
 * workspace; reservas vencidas e as dos convites substituídos saem do
 * cálculo; exige `ativos + reservas + 1 <= membersPerWorkspace` do plano
 * efetivo do owner. Substituir o convite do mesmo e-mail não consome vaga
 * extra.
 */
export const executeInviteWorkspaceMember = async (
  actor: WorkspaceActor,
  payload: InviteWorkspaceMemberPayload,
  tokenHash: string,
  requestId: string,
): Promise<Record<string, unknown>> => {
  const email = normalizeEmail(payload.email);
  return db().runTransaction(async (transaction) => {
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: "inviteWorkspaceMember",
      idempotencyKey: payload.idempotencyKey,
      payload: {...payload, email},
    });
    if (reservation.replay) return reservation.replay;

    const {role, workspace} = await reassertWorkspaceActor(
      transaction,
      actor,
      ["owner", "admin"],
    );
    if (!canInvite(role, payload.role)) {
      throw roleDenied("Seu papel não permite convidar com este papel.");
    }
    const workspaceDoc = workspaceRef(actor.workspaceId);
    const [activeMembers, pendingInvites] = await Promise.all([
      transaction.get(workspaceDoc.collection("members")
        .where("email", "==", email)
        .where("status", "==", "active")
        .limit(1)),
      transaction.get(workspaceDoc.collection(INVITES_COLLECTION)
        .where("emailNormalized", "==", email)
        .where("status", "==", "pending")
        .limit(10)),
    ]);
    if (!activeMembers.empty) {
      throw new ApplicationError(
        "domain_precondition_failed",
        "Esta pessoa já participa deste espaço.",
      );
    }
    const nowMs = Date.now();
    const ownerUid = canonicalOwnerCandidate(workspace);
    const [ownerMember, billing, membershipQuota] = await transaction.getAll(
      workspaceMemberRef(actor.workspaceId, ownerUid),
      billingAccountRef(ownerUid),
      membershipQuotaRef(actor.workspaceId),
    );
    assertCanonicalOwnerMembership(ownerMember);
    const quota = readMembershipQuota(membershipQuota);
    const reservations = liveReservations(
      quota,
      nowMs,
      pendingInvites.docs.map((previous) => previous.id),
    );
    assertWithinQuota({
      resource: "membersPerWorkspace",
      entitlement: entitlementAt(billing, nowMs),
      used: quota.activeMembers + reservations.size,
      adding: 1,
    });
    const rateLimit = await reserveRateLimit(
      transaction,
      actor.workspaceId,
      actor.uid,
      INVITE_RATE_LIMIT,
    );

    const invite = newInviteRef(actor.workspaceId);
    const expiresAt = inviteExpiresAt(INVITE_TTL_DAYS, nowMs);
    reservations.set(invite.id, expiresAt.toMillis());
    writeMembershipQuota(
      transaction,
      actor.workspaceId,
      quota.activeMembers,
      reservations,
    );
    for (const previous of pendingInvites.docs) {
      transaction.update(previous.ref, {
        status: "revoked",
        revokedBy: actor.uid,
        revokedAt: FieldValue.serverTimestamp(),
        revokedReason: "replaced",
        updatedAt: FieldValue.serverTimestamp(),
      });
      appendMembershipEvent(transaction, {
        workspaceId: actor.workspaceId,
        operation: "invite.revoked",
        actorId: actor.uid,
        actorRole: role,
        targetId: previous.id,
        before: {status: "pending"},
        after: {status: "revoked"},
        reason: "replaced",
        requestId,
      });
    }
    rateLimit.commit();
    transaction.create(invite, {
      inviteId: invite.id,
      workspaceId: actor.workspaceId,
      emailNormalized: email,
      role: payload.role,
      status: "pending",
      createdBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt,
      acceptedBy: null,
      acceptedAt: null,
      revokedBy: null,
      revokedAt: null,
    });
    transaction.create(inviteTokenRef(tokenHash), {
      workspaceId: actor.workspaceId,
      inviteId: invite.id,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
    });
    appendMembershipEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "invite.created",
      actorId: actor.uid,
      actorRole: role,
      targetId: invite.id,
      before: null,
      after: {role: payload.role, status: "pending"},
      reason: null,
      requestId,
    });
    const result: InviteResult = {
      inviteId: invite.id,
      expiresAt: expiresAt.toDate().toISOString(),
    };
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: "inviteWorkspaceMember",
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    return result;
  });
};

/**
 * `acceptWorkspaceInvite`.
 *
 * O membership é criado (ou reativado) com `uid` do token de sessão, nunca de
 * um identificador enviado pelo cliente, e só se o e-mail verificado da sessão
 * for o e-mail do convite. O convite é marcado `accepted` na mesma transação:
 * dois aceites concorrentes disputam o mesmo documento e só um vence. Repetir
 * o aceite pela mesma pessoa devolve o mesmo resultado.
 *
 * Quota (P2B.1): vale o plano **atual** do owner. Quem ainda não é membro
 * ativo só entra com `ativos < membersPerWorkspace`; a reserva do convite é
 * convertida em membro (sai do mapa, `activeMembers` sobe) no mesmo commit,
 * sem aumentar a ocupação total. Downgrade entre o convite e o aceite pode
 * recusar o aceite; nada existente é apagado. Quem já é membro ativo não
 * conta de novo: só a reserva é liberada.
 */
export const executeAcceptWorkspaceInvite = async (
  caller: CallerIdentity,
  token: string,
  requestId: string,
): Promise<Record<string, unknown>> => {
  const tokenHash = hashInviteToken(token);
  const callerEmail = caller.email ? normalizeEmail(caller.email) : null;
  return db().runTransaction(async (transaction) => {
    const pointer = await transaction.get(inviteTokenRef(tokenHash));
    const workspaceId = pointer.get("workspaceId");
    const inviteId = pointer.get("inviteId");
    if (
      !pointer.exists ||
      typeof workspaceId !== "string" ||
      typeof inviteId !== "string"
    ) {
      throw inviteUnavailable();
    }
    const [invite, profile, workspace, member] = await transaction.getAll(
      inviteRef(workspaceId, inviteId),
      userProfileRef(caller.uid),
      workspaceRef(workspaceId),
      workspaceMemberRef(workspaceId, caller.uid),
    );
    assertActiveAccountSnapshot(profile);
    if (!invite.exists || !workspace.exists) throw inviteUnavailable();

    if (
      invite.get("status") === "accepted" &&
      invite.get("acceptedBy") === caller.uid &&
      member.get("status") === "active"
    ) {
      // Retry do mesmo aceite. Depois de uma remoção, o token não readmite:
      // voltar exige convite novo.
      return {workspaceId, role: member.get("role") ?? null, replay: true};
    }
    const nowMs = Date.now();
    const expiresAt = invite.get("expiresAt");
    if (
      invite.get("status") !== "pending" ||
      !(expiresAt instanceof Timestamp) ||
      expiresAt.toMillis() <= nowMs ||
      !callerEmail ||
      invite.get("emailNormalized") !== callerEmail ||
      workspace.get("status") === "archived"
    ) {
      throw inviteUnavailable();
    }
    const inviteRole = invite.get("role");
    if (!isManageableRole(inviteRole)) throw inviteUnavailable();

    const alreadyActive = member.exists && member.get("status") === "active";
    const role = alreadyActive ? member.get("role") : inviteRole;
    // Quem já é membro ativo não consome vaga: owner e billing só são lidos
    // quando o aceite cria (ou reativa) um membership.
    const ownerUid = alreadyActive ?
      null :
      canonicalOwnerCandidate(workspace.data() ?? {});
    const ownerRefs = ownerUid ?
      [workspaceMemberRef(workspaceId, ownerUid), billingAccountRef(ownerUid)] :
      [];
    const [membershipQuota, ownerMember, billing] = await transaction.getAll(
      membershipQuotaRef(workspaceId),
      ...ownerRefs,
    );
    const quota = readMembershipQuota(membershipQuota);
    let activeMembers = quota.activeMembers;
    if (ownerUid) {
      assertCanonicalOwnerMembership(ownerMember);
      assertWithinQuota({
        resource: "membersPerWorkspace",
        entitlement: entitlementAt(billing, nowMs),
        used: activeMembers,
        adding: 1,
      });
      activeMembers += 1;
    }
    writeMembershipQuota(
      transaction,
      workspaceId,
      activeMembers,
      liveReservations(quota, nowMs, [inviteId]),
    );
    if (!alreadyActive) {
      writeActiveMembership(transaction, {
        workspaceId,
        uid: caller.uid,
        role: inviteRole,
        caller,
        email: callerEmail,
        workspace: workspaceDisplayOf(workspace.data() ?? {}),
        invitedBy: invite.get("createdBy") ?? null,
        existing: member.exists,
      });
    }
    transaction.update(invite.ref, {
      status: "accepted",
      acceptedBy: caller.uid,
      acceptedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendMembershipEvent(transaction, {
      workspaceId,
      operation: "invite.accepted",
      actorId: caller.uid,
      actorRole: isWorkspaceRole(role) ? role : null,
      targetId: inviteId,
      before: {
        membership: member.exists ? String(member.get("status")) : null,
      },
      after: {membership: "active", role: String(role)},
      reason: alreadyActive ? "already_member" : null,
      requestId,
    });
    return {workspaceId, role, replay: false};
  });
};

/**
 * `revokeWorkspaceInvite`: admin revoga só convites que poderia emitir. A
 * reserva de vaga do convite sai no mesmo commit; repetir a revogação não
 * mexe na quota.
 */
export const executeRevokeWorkspaceInvite = async (
  actor: WorkspaceActor,
  inviteId: string,
  requestId: string,
): Promise<Record<string, unknown>> =>
  db().runTransaction(async (transaction) => {
    const {role} = await reassertWorkspaceActor(
      transaction,
      actor,
      ["owner", "admin"],
    );
    const invite = await transaction.get(
      inviteRef(actor.workspaceId, inviteId),
    );
    if (!invite.exists) {
      throw new ApplicationError("not_found", "Convite não encontrado.");
    }
    const inviteRole = invite.get("role");
    if (!isManageableRole(inviteRole) || !canRevokeInvite(role, inviteRole)) {
      throw roleDenied("Seu papel não permite revogar este convite.");
    }
    const status = invite.get("status");
    if (status === "revoked") return {status: "revoked", changed: false};
    if (status !== "pending") {
      throw new ApplicationError(
        "domain_precondition_failed",
        "Este convite já foi aceito e não pode mais ser revogado.",
      );
    }
    const quota = readMembershipQuota(
      await transaction.get(membershipQuotaRef(actor.workspaceId)),
    );
    writeMembershipQuota(
      transaction,
      actor.workspaceId,
      quota.activeMembers,
      liveReservations(quota, Date.now(), [inviteId]),
    );
    transaction.update(invite.ref, {
      status: "revoked",
      revokedBy: actor.uid,
      revokedAt: FieldValue.serverTimestamp(),
      revokedReason: "revoked",
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendMembershipEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "invite.revoked",
      actorId: actor.uid,
      actorRole: role,
      targetId: inviteId,
      before: {status: "pending"},
      after: {status: "revoked"},
      reason: null,
      requestId,
    });
    return {status: "revoked", changed: true};
  });

/** Vaga liberada por um membro ativo que sai; reservas vencidas também. */
const releaseMemberSeat = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  snapshot: admin.firestore.DocumentSnapshot,
): void => {
  const quota = readMembershipQuota(snapshot);
  writeMembershipQuota(
    transaction,
    workspaceId,
    releasedMember(quota),
    liveReservations(quota, Date.now()),
  );
};

const readTargetMember = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  memberId: string,
) => {
  const target = await transaction.get(
    workspaceMemberRef(workspaceId, memberId),
  );
  const role = target.get("role");
  if (!target.exists || !isWorkspaceRole(role)) {
    throw new ApplicationError("not_found", "Membro não encontrado.");
  }
  return {target, role, status: target.get("status")};
};

/** `changeWorkspaceMemberRole` (D-04). Troca para o mesmo papel é no-op. */
export const executeChangeWorkspaceMemberRole = async (
  actor: WorkspaceActor,
  memberId: string,
  nextRole: ManageableRole,
  requestId: string,
): Promise<Record<string, unknown>> =>
  db().runTransaction(async (transaction) => {
    const {role} = await reassertWorkspaceActor(
      transaction,
      actor,
      ["owner", "admin"],
    );
    if (memberId === actor.uid) {
      throw roleDenied("Você não pode alterar o próprio papel.");
    }
    const target = await readTargetMember(
      transaction,
      actor.workspaceId,
      memberId,
    );
    if (target.status !== "active") {
      throw new ApplicationError("not_found", "Membro não encontrado.");
    }
    if (target.role === "owner") {
      throw roleDenied(
        "O papel do proprietário só muda pela transferência de titularidade.",
      );
    }
    if (!canChangeRole(role, target.role, nextRole)) {
      throw roleDenied("Seu papel não permite esta alteração.");
    }
    if (target.role === nextRole) return {role: nextRole, changed: false};
    transaction.update(target.target.ref, {
      role: nextRole,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendMembershipEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "member.role_changed",
      actorId: actor.uid,
      actorRole: role,
      targetId: memberId,
      before: {role: target.role},
      after: {role: nextRole},
      reason: null,
      requestId,
    });
    return {role: nextRole, changed: true};
  });

/**
 * `removeWorkspaceMember` (D-04). Remoção lógica; repetir é no-op. A
 * transição `active → removed` libera a vaga no mesmo commit (P2B.1).
 */
export const executeRemoveWorkspaceMember = async (
  actor: WorkspaceActor,
  memberId: string,
  requestId: string,
): Promise<Record<string, unknown>> =>
  db().runTransaction(async (transaction) => {
    const {role} = await reassertWorkspaceActor(
      transaction,
      actor,
      ["owner", "admin"],
    );
    if (memberId === actor.uid) {
      throw roleDenied("Para deixar o espaço, use a opção de sair.");
    }
    const target = await readTargetMember(
      transaction,
      actor.workspaceId,
      memberId,
    );
    if (target.status === "removed") return {status: "removed", changed: false};
    if (target.status !== "active") {
      throw new ApplicationError("not_found", "Membro não encontrado.");
    }
    if (target.role === "owner") {
      throw roleDenied("O proprietário não pode ser removido.");
    }
    if (!canRemove(role, target.role)) {
      throw roleDenied("Seu papel não permite remover este membro.");
    }
    releaseMemberSeat(
      transaction,
      actor.workspaceId,
      await transaction.get(membershipQuotaRef(actor.workspaceId)),
    );
    writeRemovedMembership(transaction, {
      workspaceId: actor.workspaceId,
      uid: memberId,
      removedBy: actor.uid,
    });
    appendMembershipEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "member.removed",
      actorId: actor.uid,
      actorRole: role,
      targetId: memberId,
      before: {status: "active", role: target.role},
      after: {status: "removed"},
      reason: null,
      requestId,
    });
    return {status: "removed", changed: true};
  });

/**
 * `leaveWorkspace`: saída voluntária de admin, member ou viewer. O owner
 * precisa transferir a titularidade antes. Repetir depois de sair é no-op.
 * A saída libera a vaga no mesmo commit (P2B.1).
 */
export const executeLeaveWorkspace = async (
  uid: string,
  workspaceId: string,
  requestId: string,
): Promise<Record<string, unknown>> =>
  db().runTransaction(async (transaction) => {
    const [profile, workspace, member] = await transaction.getAll(
      userProfileRef(uid),
      workspaceRef(workspaceId),
      workspaceMemberRef(workspaceId, uid),
    );
    assertActiveAccountSnapshot(profile);
    if (
      member.get("status") === "removed" &&
      member.get("removedBy") === uid
    ) {
      return {status: "removed", changed: false};
    }
    if (member.get("status") === "active" && member.get("role") === "owner") {
      throw roleDenied(
        "Transfira a titularidade do espaço antes de sair dele.",
      );
    }
    const {role} = evaluateWorkspaceAccess(
      {profile, workspace, member},
      ["admin", "member", "viewer"],
    );
    releaseMemberSeat(
      transaction,
      workspaceId,
      await transaction.get(membershipQuotaRef(workspaceId)),
    );
    writeRemovedMembership(transaction, {workspaceId, uid, removedBy: uid});
    appendMembershipEvent(transaction, {
      workspaceId,
      operation: "member.left",
      actorId: uid,
      actorRole: role,
      targetId: uid,
      before: {status: "active", role},
      after: {status: "removed"},
      reason: null,
      requestId,
    });
    return {status: "removed", changed: true};
  });

/**
 * `transferWorkspaceOwnership` (D-03).
 *
 * Numa única transação: o destino (membro ativo, com conta ativa) vira owner,
 * a origem vira admin e `workspace.ownerId` passa a espelhar o novo owner.
 * Duas transferências concorrentes leem o mesmo membership da origem; a
 * perdedora é repetida, encontra a origem já rebaixada e é recusada — nunca
 * há zero nem dois owners.
 *
 * Quota (P2B.1, D-01): a transferência troca a entidade pagadora na hora.
 * O destino precisa comportar, pelo plano efetivo dele agora, mais um
 * workspace próprio e a ocupação atual do workspace (membros ativos e
 * reservas vigentes); senão nada muda (`quota_exceeded`). A origem pode estar
 * acima da própria quota: transferir para fora é sempre permitido. Os dois
 * contadores de ownership mudam no mesmo commit que os papéis e o `ownerId`.
 * O billing da origem não é lido: não decide nada nesta operação.
 */
export const executeTransferWorkspaceOwnership = async (
  actor: WorkspaceActor,
  payload: TransferWorkspaceOwnershipPayload,
  requestId: string,
): Promise<Record<string, unknown>> =>
  db().runTransaction(async (transaction) => {
    const reservation = await reserveActorIdempotency(transaction, {
      uid: actor.uid,
      operation: "transferWorkspaceOwnership",
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (reservation.replay) return reservation.replay;
    const {workspace} = await reassertWorkspaceActor(
      transaction,
      actor,
      ["owner"],
    );
    if (payload.newOwnerId === actor.uid) {
      throw new ApplicationError(
        "invalid_payload",
        "Escolha outro membro para receber a titularidade.",
      );
    }
    // Uma única leitura para destino, owner canônico, billing do destino e
    // os três estados de quota: menos idas ao banco dentro da transação.
    const ownerUid = canonicalOwnerCandidate(workspace);
    if (ownerUid !== actor.uid) throw quotaStateUnavailable();
    const [
      target,
      targetProfile,
      ownerMember,
      previousOwnership,
      nextBilling,
      nextOwnership,
      membershipQuota,
    ] = await transaction.getAll(
      workspaceMemberRef(actor.workspaceId, payload.newOwnerId),
      userProfileRef(payload.newOwnerId),
      workspaceMemberRef(actor.workspaceId, ownerUid),
      ownershipQuotaRef(actor.uid),
      billingAccountRef(payload.newOwnerId),
      ownershipQuotaRef(payload.newOwnerId),
      membershipQuotaRef(actor.workspaceId),
    );
    if (
      !target.exists ||
      target.get("status") !== "active" ||
      !isWorkspaceRole(target.get("role")) ||
      targetProfile.get("status") !== "active"
    ) {
      throw new ApplicationError(
        "domain_precondition_failed",
        "A titularidade só pode ser transferida para um membro ativo.",
      );
    }
    const nowMs = Date.now();
    assertCanonicalOwnerMembership(ownerMember);
    const previousQuota = readOwnershipQuota(previousOwnership);
    const nextQuota = readOwnershipQuota(nextOwnership);
    const nextLimits = entitlementAt(nextBilling, nowMs).limits;
    const members = readMembershipQuota(membershipQuota);
    if (nextQuota.activeOwnedWorkspaces + 1 > nextLimits.workspaces) {
      throw transferQuotaExceeded("workspaces");
    }
    const occupancy =
      members.activeMembers + liveReservations(members, nowMs).size;
    if (occupancy > nextLimits.membersPerWorkspace) {
      throw transferQuotaExceeded("membersPerWorkspace");
    }
    writeOwnershipQuota(
      transaction,
      actor.uid,
      releasedOwnership(previousQuota),
    );
    writeOwnershipQuota(
      transaction,
      payload.newOwnerId,
      nextQuota.activeOwnedWorkspaces + 1,
    );
    const previousTargetRole = String(target.get("role"));
    transaction.update(target.ref, {
      role: "owner",
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(workspaceMemberRef(actor.workspaceId, actor.uid), {
      role: "admin",
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(workspaceRef(actor.workspaceId), {
      ownerId: payload.newOwnerId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendMembershipEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "ownership.transferred",
      actorId: actor.uid,
      actorRole: "owner",
      targetId: payload.newOwnerId,
      before: {ownerId: actor.uid, targetRole: previousTargetRole},
      after: {ownerId: payload.newOwnerId, previousOwnerRole: "admin"},
      reason: null,
      requestId,
    });
    const result = {ownerId: payload.newOwnerId, previousOwnerRole: "admin"};
    completeActorIdempotency(transaction, reservation, {
      uid: actor.uid,
      operation: "transferWorkspaceOwnership",
      workspaceId: actor.workspaceId,
      requestId,
      result,
    });
    return result;
  });
