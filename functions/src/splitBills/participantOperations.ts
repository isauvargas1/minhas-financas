import {randomInt} from "node:crypto";

import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import {consumeWorkspaceRateLimit} from "../shared/rateLimit";
import {
  workspaceMemberRef,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import {AggregateBook, writeGroup} from "./aggregates";
import {
  GROUP_ARCHIVED_MESSAGE,
  PARTICIPANT_CONFLICT_MESSAGE,
  PARTICIPANT_INCONSISTENT_MESSAGE,
  PARTICIPANT_NOT_FOUND_MESSAGE,
  SPLIT_ACCEPT_RATE_LIMIT,
  SPLIT_ACTOR_ROLES,
  SPLIT_INVITE_RATE_LIMIT,
  SPLIT_STRUCTURE_RATE_LIMIT,
  assertCanManageGroup,
  assertGroupActive,
  assertVersion,
  beginSplitMutation,
  canManageGroup,
  correlationOf,
  finishSplitMutation,
  loadGroupAccess,
  nowOf,
  reserveSplitRateLimit,
  splitIds,
  type GroupAccess,
  type SplitMutationResult,
  type SplitMutationStart,
  type SplitOperationOptions,
} from "./common";
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  type AcceptSplitInvitePayload,
  type AddExternalParticipantPayload,
  type AddWorkspaceParticipantPayload,
  type CreateSplitInvitePayload,
  type DeactivateParticipantPayload,
  type RevokeSplitInvitePayload,
} from "./contracts";
import {
  SPLIT_INVITE_TTL_MS,
  SPLIT_LIMITS,
  SPLIT_SCHEMA_VERSION,
  appendSplitEvent,
  participantColorFor,
  participantDocument,
  readAuthoritativeInvite,
  readAuthoritativeParticipant,
  splitExternalParticipantIdFor,
  splitInviteIdFor,
  splitInvitesRef,
  splitParticipantsRef,
  type AuthoritativeSplitParticipant,
  type SplitAssignableRole,
} from "./model";

/**
 * Participantes e convites (P4-C, D-14 §3–§6, §26, §27).
 *
 * - `workspace_member`: um usuário com membership ativo (owner, admin ou
 *   member — viewer do workspace só lê e não participa), no máximo um
 *   registro por grupo (ID derivado do `uid`). Entra por convite aceito ou
 *   por inclusão direta do dono do grupo/administrador; o papel atribuível é
 *   `participant` ou `viewer` (o dono é só quem criou o grupo).
 * - `external`: só um nome de exibição. Sem login, sem convite, sem
 *   permissão; nunca usado para autorização.
 * - Ninguém é apagado: sair ou remover é desativar, e só sem rateios,
 *   recebíveis ou reembolsos em aberto. O dono não sai de um grupo ativo.
 *
 * Convite: código de 10 caracteres de um alfabeto de 31 símbolos, gerado por
 * CSPRNG; o documento guarda só o hash (o ID deriva dele) e uma dica de 3
 * caracteres; uso único, validade de 7 dias, papel fixo. O aceite consome o
 * rate limit numa transação própria antes de avaliar o código, de modo que
 * as tentativas que falham também contam.
 */
export const CREATE_SPLIT_INVITE_OPERATION = "createSplitGroupInvite";
export const REVOKE_SPLIT_INVITE_OPERATION = "revokeSplitGroupInvite";
export const ACCEPT_SPLIT_INVITE_OPERATION = "acceptSplitGroupInvite";
export const ADD_WORKSPACE_PARTICIPANT_OPERATION =
  "addWorkspaceSplitParticipant";
export const ADD_EXTERNAL_PARTICIPANT_OPERATION = "addExternalSplitParticipant";
export const DEACTIVATE_PARTICIPANT_OPERATION = "deactivateSplitParticipant";

export const INVITE_LIMIT_MESSAGE =
  `Este grupo já tem ${SPLIT_LIMITS.pendingInvitesPerGroup} convites ` +
  "pendentes. Revogue algum ou aguarde a expiração.";
export const INVITE_INVALID_MESSAGE =
  "Convite inválido, expirado ou já utilizado.";
export const INVITE_ALREADY_USED_MESSAGE = "Este convite já foi usado.";
export const INVITE_ALREADY_REVOKED_MESSAGE = "Este convite já foi revogado.";
export const INVITE_NOT_FOUND_MESSAGE = "Convite não encontrado.";
export const ALREADY_PARTICIPANT_SELF_MESSAGE =
  "Você já participa deste grupo.";
export const ALREADY_PARTICIPANT_MESSAGE = "Esta pessoa já participa do grupo.";
export const MEMBER_NOT_ELIGIBLE_MESSAGE =
  "Esta pessoa não é membro ativo deste espaço com permissão para " +
  "participar de grupos.";
export const ACTIVE_PARTICIPANTS_LIMIT_MESSAGE =
  `Este grupo atingiu o limite de ${SPLIT_LIMITS.activeParticipantsPerGroup} ` +
  "participantes ativos.";
export const PARTICIPANT_RECORDS_LIMIT_MESSAGE =
  "Este grupo atingiu o limite de registros de participantes.";
export const PARTICIPANT_ALREADY_INACTIVE_MESSAGE =
  "Este participante já está inativo.";
export const OWNER_CANNOT_LEAVE_MESSAGE =
  "O dono do grupo não pode sair nem ser removido. Arquive o grupo quando " +
  "ele não for mais usado.";
export const PARTICIPANT_HAS_OPEN_ITEMS_MESSAGE =
  "Este participante ainda tem rateios, valores a receber ou reembolsos em " +
  "aberto. Resolva-os antes de removê-lo do grupo.";
export const DEACTIVATE_DENIED_MESSAGE =
  "Só o dono do grupo, um administrador do espaço ou o próprio participante " +
  "pode fazer isso.";

const db = () => admin.firestore();

/** Papéis do workspace que podem participar de grupos. */
const PARTICIPATING_ROLES: readonly WorkspaceRole[] = SPLIT_ACTOR_ROLES;

const isParticipatingRole = (value: unknown): value is WorkspaceRole =>
  typeof value === "string" &&
  (PARTICIPATING_ROLES as readonly string[]).includes(value);

/** Código do convite: CSPRNG, alfabeto sem ambiguidades. */
export const generateInviteCode = (): string => {
  let code = "";
  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
};

/** Convites pendentes e ainda válidos do grupo (consulta limitada). */
const countPendingInvites = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  groupId: string,
  nowMs: number,
): Promise<number> => {
  const snapshot = await transaction.get(splitInvitesRef(workspaceId)
    .where("groupId", "==", groupId)
    .where("status", "==", "pending")
    .where("expiresAt", ">", Timestamp.fromMillis(nowMs))
    .limit(SPLIT_LIMITS.pendingInvitesPerGroup)
    .count());
  return snapshot.data().count;
};

const assertRoomForParticipant = (
  access: GroupAccess,
  isNewRecord: boolean,
): void => {
  const {counters} = access.group;
  if (counters.activeParticipantCount >=
    SPLIT_LIMITS.activeParticipantsPerGroup) {
    throw new ApplicationError("domain_precondition_failed",
      ACTIVE_PARTICIPANTS_LIMIT_MESSAGE);
  }
  if (isNewRecord &&
    counters.participantCount >= SPLIT_LIMITS.participantRecordsPerGroup) {
    throw new ApplicationError("domain_precondition_failed",
      PARTICIPANT_RECORDS_LIMIT_MESSAGE);
  }
};

/**
 * Admissão de um membro do workspace: cria o registro (ID derivado do
 * `uid`) ou reativa o registro inativo com o papel novo. Só escritas.
 */
const writeMemberAdmission = (
  transaction: admin.firestore.Transaction,
  input: {
    actor: WorkspaceActor;
    access: GroupAccess;
    participantId: string;
    userId: string;
    existing: AuthoritativeSplitParticipant | null;
    role: SplitAssignableRole;
    addedVia: "invite" | "direct";
    extraGroupFields?: Record<string, unknown>;
  },
): void => {
  const {actor, access} = input;
  const book = new AggregateBook();
  book.group.counters.activeParticipantCount += 1;
  const ref = splitParticipantsRef(actor.workspaceId).doc(input.participantId);
  if (input.existing) {
    transaction.update(ref, {
      status: "active",
      role: input.role,
      addedVia: input.addedVia,
      deactivatedAt: null,
      deactivatedBy: null,
      revision: input.existing.revision + 1,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } else {
    book.group.counters.participantCount += 1;
    transaction.create(ref, participantDocument({
      id: input.participantId,
      workspaceId: actor.workspaceId,
      groupId: access.group.id,
      kind: "workspace_member",
      userId: input.userId,
      displayName: null,
      role: input.role,
      color: participantColorFor(access.group.counters.participantCount),
      addedVia: input.addedVia,
      actorUid: actor.uid,
    }));
  }
  writeGroup(transaction, access.groupRef, access.group, book.group,
    actor.uid, input.extraGroupFields);
};

const eventBase = (
  actor: WorkspaceActor,
  start: SplitMutationStart,
  requestId: string,
  payload: {correlationId?: string},
) => ({
  workspaceId: actor.workspaceId,
  targetKey: start.intentId,
  actorId: actor.uid,
  actorRole: start.role,
  intentId: start.intentId,
  requestHash: start.reservation.requestHash,
  requestId,
  correlationId: correlationOf(payload),
});

// ------------------------------------------------------------------ convite

export const executeCreateSplitGroupInvite = async (
  actor: WorkspaceActor,
  payload: CreateSplitInvitePayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: CREATE_SPLIT_INVITE_OPERATION,
      eventOperation: "split.invite_created",
      roles: SPLIT_ACTOR_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    const access = await loadGroupAccess(transaction, actor, payload.groupId);
    assertCanManageGroup(start.role, access);
    assertGroupActive(access.group);
    const nowMs = nowOf(options);
    const pending = await countPendingInvites(transaction, actor.workspaceId,
      access.group.id, nowMs);
    if (pending >= SPLIT_LIMITS.pendingInvitesPerGroup) {
      throw new ApplicationError("domain_precondition_failed",
        INVITE_LIMIT_MESSAGE);
    }
    const code = generateInviteCode();
    const inviteId = splitInviteIdFor(actor.workspaceId, code);
    const inviteRef = splitInvitesRef(actor.workspaceId).doc(inviteId);
    // Colisão (31^10 códigos): recusa sem revelar nada; o cliente repete.
    if ((await transaction.get(inviteRef)).exists) {
      throw new ApplicationError("internal",
        "Não foi possível gerar o convite. Tente novamente.");
    }
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_INVITE_RATE_LIMIT);
    const expiresAt = Timestamp.fromMillis(nowMs + SPLIT_INVITE_TTL_MS);
    transaction.create(inviteRef, {
      id: inviteId,
      schemaVersion: SPLIT_SCHEMA_VERSION,
      workspaceId: actor.workspaceId,
      groupId: access.group.id,
      role: payload.role,
      status: "pending",
      codeHint: code.slice(-3),
      expiresAt,
      createdBy: actor.uid,
      acceptedBy: null,
      acceptedAt: null,
      acceptedParticipantId: null,
      revokedBy: null,
      revokedAt: null,
      intentId: start.intentId,
      requestHash: start.reservation.requestHash,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendSplitEvent(transaction, {
      ...eventBase(actor, start, requestId, payload),
      operation: "split.invite_created",
      groupId: access.group.id,
      inviteId,
      before: null,
      after: {status: "pending", role: payload.role},
    });
    const expiresAtIso = expiresAt.toDate().toISOString();
    // O código vai só nesta resposta: o recibo da chave guarda `null`.
    const result = finishSplitMutation(transaction, actor, {
      start,
      operation: CREATE_SPLIT_INVITE_OPERATION,
      requestId,
      ids: splitIds({groupId: access.group.id, inviteId}),
      extra: {code: null, expiresAt: expiresAtIso},
      rateLimit,
      options,
    });
    return {...result, code};
  });

export const executeRevokeSplitGroupInvite = async (
  actor: WorkspaceActor,
  payload: RevokeSplitInvitePayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: REVOKE_SPLIT_INVITE_OPERATION,
      eventOperation: "split.invite_revoked",
      roles: SPLIT_ACTOR_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    const access = await loadGroupAccess(transaction, actor, payload.groupId);
    assertCanManageGroup(start.role, access);
    const inviteRef = splitInvitesRef(actor.workspaceId).doc(payload.inviteId);
    const snapshot = await transaction.get(inviteRef);
    const invite = readAuthoritativeInvite(snapshot.id, snapshot.data(),
      actor.workspaceId);
    if (!snapshot.exists || !invite || invite.groupId !== access.group.id) {
      throw new ApplicationError("not_found", INVITE_NOT_FOUND_MESSAGE);
    }
    if (invite.status === "accepted") {
      throw new ApplicationError("domain_precondition_failed",
        INVITE_ALREADY_USED_MESSAGE);
    }
    if (invite.status === "revoked") {
      throw new ApplicationError("domain_precondition_failed",
        INVITE_ALREADY_REVOKED_MESSAGE);
    }
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_STRUCTURE_RATE_LIMIT);
    transaction.update(inviteRef, {
      status: "revoked",
      revokedBy: actor.uid,
      revokedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendSplitEvent(transaction, {
      ...eventBase(actor, start, requestId, payload),
      operation: "split.invite_revoked",
      groupId: access.group.id,
      inviteId: invite.id,
      before: {status: "pending"},
      after: {status: "revoked"},
    });
    return finishSplitMutation(transaction, actor, {
      start,
      operation: REVOKE_SPLIT_INVITE_OPERATION,
      requestId,
      ids: splitIds({groupId: access.group.id, inviteId: invite.id}),
      rateLimit,
      options,
    });
  });

/**
 * Aceite: o rate limit é consumido numa transação própria antes de avaliar
 * o código (a tentativa que falha não o desfaz). Exige membership ativo de
 * owner/admin/member no workspace do convite — o código sozinho não dá
 * acesso a nada; o participante nasce com o papel gravado no convite.
 */
export const executeAcceptSplitGroupInvite = async (
  actor: WorkspaceActor,
  payload: AcceptSplitInvitePayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> => {
  await consumeWorkspaceRateLimit(actor.workspaceId, actor.uid,
    SPLIT_ACCEPT_RATE_LIMIT);
  return db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: ACCEPT_SPLIT_INVITE_OPERATION,
      eventOperation: "split.invite_accepted",
      roles: PARTICIPATING_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    const inviteId = splitInviteIdFor(actor.workspaceId, payload.code);
    const inviteRef = splitInvitesRef(actor.workspaceId).doc(inviteId);
    const snapshot = await transaction.get(inviteRef);
    const invite = readAuthoritativeInvite(snapshot.id, snapshot.data(),
      actor.workspaceId);
    if (
      !snapshot.exists || !invite || invite.status !== "pending" ||
      invite.expiresAt.toMillis() <= nowOf(options)
    ) {
      throw new ApplicationError("not_found", INVITE_INVALID_MESSAGE);
    }
    const access = await loadGroupAccess(transaction, actor, invite.groupId);
    if (access.group.status !== "active") {
      throw new ApplicationError("domain_precondition_failed",
        GROUP_ARCHIVED_MESSAGE, {ineligible: "archived_group"});
    }
    const existing = access.actorParticipant;
    if (existing?.status === "active") {
      throw new ApplicationError("domain_precondition_failed",
        ALREADY_PARTICIPANT_SELF_MESSAGE);
    }
    assertRoomForParticipant(access, existing === null);
    const participantId = access.actorParticipantId;
    writeMemberAdmission(transaction, {
      actor,
      access,
      participantId,
      userId: actor.uid,
      existing,
      role: invite.role,
      addedVia: "invite",
    });
    transaction.update(inviteRef, {
      status: "accepted",
      acceptedBy: actor.uid,
      acceptedAt: FieldValue.serverTimestamp(),
      acceptedParticipantId: participantId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendSplitEvent(transaction, {
      ...eventBase(actor, start, requestId, payload),
      operation: "split.invite_accepted",
      groupId: access.group.id,
      participantId,
      inviteId,
      before: {status: "pending",
        participant: existing ? existing.status : null},
      after: {status: "accepted", role: invite.role},
    });
    // O aceite já consumiu o limite próprio; nenhum outro contador aqui.
    return finishSplitMutation(transaction, actor, {
      start,
      operation: ACCEPT_SPLIT_INVITE_OPERATION,
      requestId,
      ids: splitIds({groupId: access.group.id, participantId, inviteId}),
      rateLimit: {commit: () => undefined},
      options,
    });
  });
};

// ----------------------------------------------------------- inclusão direta

export const executeAddWorkspaceSplitParticipant = async (
  actor: WorkspaceActor,
  payload: AddWorkspaceParticipantPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: ADD_WORKSPACE_PARTICIPANT_OPERATION,
      eventOperation: "split.participant_added",
      roles: SPLIT_ACTOR_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    const access = await loadGroupAccess(transaction, actor, payload.groupId);
    assertCanManageGroup(start.role, access);
    assertGroupActive(access.group);
    const participantId = access.participantIdOf(payload.userId);
    const [memberSnapshot, participantSnapshot] = await transaction.getAll(
      workspaceMemberRef(actor.workspaceId, payload.userId),
      splitParticipantsRef(actor.workspaceId).doc(participantId));
    if (
      !memberSnapshot.exists ||
      memberSnapshot.get("status") !== "active" ||
      !isParticipatingRole(memberSnapshot.get("role"))
    ) {
      throw new ApplicationError("domain_precondition_failed",
        MEMBER_NOT_ELIGIBLE_MESSAGE);
    }
    let existing: AuthoritativeSplitParticipant | null = null;
    if (participantSnapshot.exists) {
      existing = readAuthoritativeParticipant(participantSnapshot.id,
        participantSnapshot.data(), actor.workspaceId);
      if (
        !existing || existing.groupId !== access.group.id ||
        existing.kind !== "workspace_member" ||
        existing.userId !== payload.userId
      ) {
        throw new ApplicationError("domain_precondition_failed",
          PARTICIPANT_INCONSISTENT_MESSAGE);
      }
      if (existing.status === "active") {
        throw new ApplicationError("domain_precondition_failed",
          ALREADY_PARTICIPANT_MESSAGE);
      }
    }
    assertRoomForParticipant(access, existing === null);
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_STRUCTURE_RATE_LIMIT);
    writeMemberAdmission(transaction, {
      actor,
      access,
      participantId,
      userId: payload.userId,
      existing,
      role: payload.role,
      addedVia: "direct",
    });
    appendSplitEvent(transaction, {
      ...eventBase(actor, start, requestId, payload),
      operation: "split.participant_added",
      groupId: access.group.id,
      participantId,
      before: {participant: existing ? existing.status : null},
      after: {status: "active", kind: "workspace_member",
        role: payload.role},
    });
    return finishSplitMutation(transaction, actor, {
      start,
      operation: ADD_WORKSPACE_PARTICIPANT_OPERATION,
      requestId,
      ids: splitIds({groupId: access.group.id, participantId}),
      rateLimit,
      options,
    });
  });

export const executeAddExternalSplitParticipant = async (
  actor: WorkspaceActor,
  payload: AddExternalParticipantPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: ADD_EXTERNAL_PARTICIPANT_OPERATION,
      eventOperation: "split.participant_added",
      roles: SPLIT_ACTOR_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    const access = await loadGroupAccess(transaction, actor, payload.groupId);
    assertCanManageGroup(start.role, access);
    assertGroupActive(access.group);
    assertRoomForParticipant(access, true);
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_STRUCTURE_RATE_LIMIT);
    const participantId = splitExternalParticipantIdFor(actor.workspaceId,
      access.group.id, start.intentId);
    transaction.create(
      splitParticipantsRef(actor.workspaceId).doc(participantId),
      participantDocument({
        id: participantId,
        workspaceId: actor.workspaceId,
        groupId: access.group.id,
        kind: "external",
        userId: null,
        displayName: payload.displayName,
        role: "participant",
        color: participantColorFor(access.group.counters.participantCount),
        addedVia: "direct",
        actorUid: actor.uid,
      }));
    const book = new AggregateBook();
    book.group.counters.participantCount += 1;
    book.group.counters.activeParticipantCount += 1;
    writeGroup(transaction, access.groupRef, access.group, book.group,
      actor.uid);
    // O nome do externo não entra na trilha (§29).
    appendSplitEvent(transaction, {
      ...eventBase(actor, start, requestId, payload),
      operation: "split.participant_added",
      groupId: access.group.id,
      participantId,
      before: null,
      after: {status: "active", kind: "external", role: "participant"},
    });
    return finishSplitMutation(transaction, actor, {
      start,
      operation: ADD_EXTERNAL_PARTICIPANT_OPERATION,
      requestId,
      ids: splitIds({groupId: access.group.id, participantId}),
      rateLimit,
      options,
    });
  });

// ---------------------------------------------------------------- desativação

export const executeDeactivateSplitParticipant = async (
  actor: WorkspaceActor,
  payload: DeactivateParticipantPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: DEACTIVATE_PARTICIPANT_OPERATION,
      eventOperation: "split.participant_deactivated",
      roles: SPLIT_ACTOR_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    const access = await loadGroupAccess(transaction, actor, payload.groupId);
    const isSelf = payload.participantId === access.actorParticipantId;
    if (!isSelf && !canManageGroup(start.role, access)) {
      throw new ApplicationError("permission_denied",
        DEACTIVATE_DENIED_MESSAGE);
    }
    assertGroupActive(access.group);
    const ref = splitParticipantsRef(actor.workspaceId)
      .doc(payload.participantId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) {
      throw new ApplicationError("not_found", PARTICIPANT_NOT_FOUND_MESSAGE);
    }
    const participant = readAuthoritativeParticipant(snapshot.id,
      snapshot.data(), actor.workspaceId);
    if (!participant || participant.groupId !== access.group.id) {
      throw new ApplicationError("not_found", PARTICIPANT_NOT_FOUND_MESSAGE);
    }
    if (participant.status !== "active") {
      throw new ApplicationError("domain_precondition_failed",
        PARTICIPANT_ALREADY_INACTIVE_MESSAGE);
    }
    if (
      participant.role === "owner" ||
      participant.id === access.group.ownerParticipantId
    ) {
      throw new ApplicationError("domain_precondition_failed",
        OWNER_CANNOT_LEAVE_MESSAGE);
    }
    assertVersion(participant.updatedAt, payload.expectedUpdatedAt,
      PARTICIPANT_CONFLICT_MESSAGE);
    if (
      participant.openShareCount > 0 ||
      participant.openReceivableCount > 0 ||
      participant.openReimbursementCount > 0
    ) {
      throw new ApplicationError("domain_precondition_failed",
        PARTICIPANT_HAS_OPEN_ITEMS_MESSAGE, {ineligible: "open_items"});
    }
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_STRUCTURE_RATE_LIMIT);
    transaction.update(ref, {
      status: "inactive",
      deactivatedAt: FieldValue.serverTimestamp(),
      deactivatedBy: actor.uid,
      revision: participant.revision + 1,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const book = new AggregateBook();
    book.group.counters.activeParticipantCount -= 1;
    writeGroup(transaction, access.groupRef, access.group, book.group,
      actor.uid);
    appendSplitEvent(transaction, {
      ...eventBase(actor, start, requestId, payload),
      operation: "split.participant_deactivated",
      groupId: access.group.id,
      participantId: participant.id,
      before: {status: "active", kind: participant.kind,
        role: participant.role},
      after: {status: "inactive", selfService: isSelf},
    });
    return finishSplitMutation(transaction, actor, {
      start,
      operation: DEACTIVATE_PARTICIPANT_OPERATION,
      requestId,
      ids: splitIds({groupId: access.group.id,
        participantId: participant.id}),
      rateLimit,
      options,
    });
  });
