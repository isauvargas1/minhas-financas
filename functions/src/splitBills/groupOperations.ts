import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {
  GROUP_CONFLICT_MESSAGE,
  SPLIT_ACTOR_ROLES,
  SPLIT_STRUCTURE_RATE_LIMIT,
  assertCanManageGroup,
  assertGroupActive,
  assertVersion,
  beginSplitMutation,
  correlationOf,
  finishSplitMutation,
  loadGroupAccess,
  nowOf,
  reserveSplitRateLimit,
  splitIds,
  type SplitMutationResult,
  type SplitOperationOptions,
} from "./common";
import type {
  CreateSplitGroupPayload,
  GroupLifecyclePayload,
  UpdateSplitGroupPayload,
} from "./contracts";
import {
  EMPTY_GROUP_COUNTERS,
  EMPTY_GROUP_TOTALS,
  SPLIT_SCHEMA_VERSION,
  appendSplitEvent,
  groupSnapshot,
  participantColorFor,
  participantDocument,
  splitGroupIdFor,
  splitGroupsRef,
  splitMemberParticipantIdFor,
  splitParticipantsRef,
  type AuthoritativeSplitGroup,
} from "./model";
import {releaseSplitGroupSlot, reserveSplitGroupSlot} from "./quota";

/**
 * Ciclo de vida do grupo (P4-C, §7, §8, §27, §28).
 *
 * - criação: o criador (owner/admin/member do workspace) vira o dono, como
 *   participante `workspace_member` com papel `owner`, no mesmo commit do
 *   grupo e da vaga da quota `splitGroups`;
 * - edição: nome, descrição, tipo e visual (o modo não muda: os títulos ou
 *   reembolsos existentes dependem dele);
 * - arquivamento: só sem títulos, rateios e reembolsos em aberto; libera a
 *   vaga; nada é apagado;
 * - reativação: reconfere a quota e consome a vaga.
 */
export const CREATE_SPLIT_GROUP_OPERATION = "createSplitGroup";
export const UPDATE_SPLIT_GROUP_OPERATION = "updateSplitGroup";
export const ARCHIVE_SPLIT_GROUP_OPERATION = "archiveSplitGroup";
export const REACTIVATE_SPLIT_GROUP_OPERATION = "reactivateSplitGroup";

export const REIMBURSEMENT_PJ_ONLY_MESSAGE =
  "O modo reembolso está disponível só em espaços PJ.";
export const GROUP_UNCHANGED_MESSAGE = "Nenhuma alteração para salvar.";
export const GROUP_HAS_OPEN_ITEMS_MESSAGE =
  "Este grupo ainda tem títulos, rateios ou reembolsos em aberto. Quite, " +
  "perdoe, anule ou conclua tudo antes de arquivar.";
export const GROUP_ALREADY_ARCHIVED_MESSAGE = "Este grupo já está arquivado.";
export const GROUP_NOT_ARCHIVED_MESSAGE = "Este grupo não está arquivado.";

const db = () => admin.firestore();

// ------------------------------------------------------------------ criação

export const executeCreateSplitGroup = async (
  actor: WorkspaceActor,
  payload: CreateSplitGroupPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: CREATE_SPLIT_GROUP_OPERATION,
      eventOperation: "split.group_created",
      roles: SPLIT_ACTOR_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    if (payload.businessMode === "reimbursement" &&
      start.workspace.type !== "PJ") {
      throw new ApplicationError("invalid_payload",
        REIMBURSEMENT_PJ_ONLY_MESSAGE);
    }
    const slot = await reserveSplitGroupSlot(transaction, {
      actorUid: actor.uid,
      workspaceId: actor.workspaceId,
      workspace: start.workspace,
      nowMs: nowOf(options),
    });
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_STRUCTURE_RATE_LIMIT);

    const groupId = splitGroupIdFor(actor.workspaceId, start.intentId);
    const ownerParticipantId = splitMemberParticipantIdFor(actor.workspaceId,
      groupId, actor.uid);
    const counters = {
      ...EMPTY_GROUP_COUNTERS,
      participantCount: 1,
      activeParticipantCount: 1,
    };
    const totals = {...EMPTY_GROUP_TOTALS, categoryTotals: {}};
    transaction.create(splitGroupsRef(actor.workspaceId).doc(groupId), {
      id: groupId,
      schemaVersion: SPLIT_SCHEMA_VERSION,
      workspaceId: actor.workspaceId,
      name: payload.name,
      description: payload.description,
      groupType: payload.groupType,
      businessMode: payload.businessMode,
      status: "active",
      createdBy: actor.uid,
      ownerParticipantId,
      ownerUserId: actor.uid,
      visual: payload.visual,
      counters,
      totals,
      intentId: start.intentId,
      requestHash: start.reservation.requestHash,
      revision: 1,
      archivedAt: null,
      archivedBy: null,
      updatedBy: actor.uid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(
      splitParticipantsRef(actor.workspaceId).doc(ownerParticipantId),
      participantDocument({
        id: ownerParticipantId,
        workspaceId: actor.workspaceId,
        groupId,
        kind: "workspace_member",
        userId: actor.uid,
        displayName: null,
        role: "owner",
        color: participantColorFor(0),
        addedVia: "creation",
        actorUid: actor.uid,
      }));
    slot.commit();
    appendSplitEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "split.group_created",
      targetKey: start.intentId,
      groupId,
      participantId: ownerParticipantId,
      actorId: actor.uid,
      actorRole: start.role,
      intentId: start.intentId,
      requestHash: start.reservation.requestHash,
      requestId,
      correlationId: correlationOf(payload),
      before: null,
      after: {
        ...groupSnapshot({
          status: "active",
          businessMode: payload.businessMode,
          groupType: payload.groupType,
          revision: 1,
          counters,
          totals,
        }),
        activeGroupsAfter: slot.used + 1,
        activeGroupsLimit: slot.limit,
      },
    });
    return finishSplitMutation(transaction, actor, {
      start,
      operation: CREATE_SPLIT_GROUP_OPERATION,
      requestId,
      ids: splitIds({groupId, participantId: ownerParticipantId}),
      rateLimit,
      options,
    });
  });

// ------------------------------------------------------------------- edição

const sameVisual = (
  left: AuthoritativeSplitGroup["visual"],
  right: AuthoritativeSplitGroup["visual"],
): boolean => left.color === right.color && left.icon === right.icon &&
  left.emoji === right.emoji;

export const executeUpdateSplitGroup = async (
  actor: WorkspaceActor,
  payload: UpdateSplitGroupPayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: UPDATE_SPLIT_GROUP_OPERATION,
      eventOperation: "split.group_updated",
      roles: SPLIT_ACTOR_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    const access = await loadGroupAccess(transaction, actor, payload.groupId);
    const {group, groupRef} = access;
    assertCanManageGroup(start.role, access);
    assertGroupActive(group);
    assertVersion(group.updatedAt, payload.expectedUpdatedAt,
      GROUP_CONFLICT_MESSAGE);
    const {changes} = payload;
    const patch: Record<string, unknown> = {};
    if (changes.name !== undefined && changes.name !== group.name) {
      patch.name = changes.name;
    }
    if (
      changes.description !== undefined &&
      changes.description !== group.description
    ) {
      patch.description = changes.description;
    }
    if (
      changes.groupType !== undefined &&
      changes.groupType !== group.groupType
    ) {
      patch.groupType = changes.groupType;
    }
    if (changes.visual !== undefined &&
      !sameVisual(changes.visual, group.visual)) {
      patch.visual = changes.visual;
    }
    const changedFields = Object.keys(patch);
    if (changedFields.length === 0) {
      throw new ApplicationError("domain_precondition_failed",
        GROUP_UNCHANGED_MESSAGE);
    }
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_STRUCTURE_RATE_LIMIT);
    transaction.update(groupRef, {
      ...patch,
      revision: group.revision + 1,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    appendSplitEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "split.group_updated",
      targetKey: start.intentId,
      groupId: group.id,
      actorId: actor.uid,
      actorRole: start.role,
      intentId: start.intentId,
      requestHash: start.reservation.requestHash,
      requestId,
      correlationId: correlationOf(payload),
      changedFields,
      before: {revision: group.revision,
        groupType: group.groupType},
      after: {revision: group.revision + 1,
        groupType: (patch.groupType as string | undefined) ?? group.groupType},
    });
    return finishSplitMutation(transaction, actor, {
      start,
      operation: UPDATE_SPLIT_GROUP_OPERATION,
      requestId,
      ids: splitIds({groupId: group.id}),
      rateLimit,
      options,
    });
  });

// ------------------------------------------------------------ arquivamento

export const executeArchiveSplitGroup = async (
  actor: WorkspaceActor,
  payload: GroupLifecyclePayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: ARCHIVE_SPLIT_GROUP_OPERATION,
      eventOperation: "split.group_archived",
      roles: SPLIT_ACTOR_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    const access = await loadGroupAccess(transaction, actor, payload.groupId);
    const {group, groupRef} = access;
    assertCanManageGroup(start.role, access);
    if (group.status === "archived") {
      throw new ApplicationError("domain_precondition_failed",
        GROUP_ALREADY_ARCHIVED_MESSAGE);
    }
    assertVersion(group.updatedAt, payload.expectedUpdatedAt,
      GROUP_CONFLICT_MESSAGE);
    if (
      group.counters.openBillCount > 0 ||
      group.counters.openShareCount > 0 ||
      group.counters.openReimbursementCount > 0
    ) {
      throw new ApplicationError("domain_precondition_failed",
        GROUP_HAS_OPEN_ITEMS_MESSAGE, {ineligible: "open_items"});
    }
    const slot = await releaseSplitGroupSlot(transaction, actor.workspaceId);
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_STRUCTURE_RATE_LIMIT);
    transaction.update(groupRef, {
      status: "archived",
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: actor.uid,
      revision: group.revision + 1,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    slot.commit();
    appendSplitEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "split.group_archived",
      targetKey: start.intentId,
      groupId: group.id,
      actorId: actor.uid,
      actorRole: start.role,
      intentId: start.intentId,
      requestHash: start.reservation.requestHash,
      requestId,
      correlationId: correlationOf(payload),
      before: groupSnapshot(group),
      after: groupSnapshot({...group, status: "archived",
        revision: group.revision + 1}),
    });
    return finishSplitMutation(transaction, actor, {
      start,
      operation: ARCHIVE_SPLIT_GROUP_OPERATION,
      requestId,
      ids: splitIds({groupId: group.id}),
      rateLimit,
      options,
    });
  });

// -------------------------------------------------------------- reativação

export const executeReactivateSplitGroup = async (
  actor: WorkspaceActor,
  payload: GroupLifecyclePayload,
  requestId: string,
  options: SplitOperationOptions = {},
): Promise<SplitMutationResult> =>
  db().runTransaction(async (transaction) => {
    const start = await beginSplitMutation(transaction, actor, {
      operation: REACTIVATE_SPLIT_GROUP_OPERATION,
      eventOperation: "split.group_reactivated",
      roles: SPLIT_ACTOR_ROLES,
      payload,
    });
    if ("replay" in start) return start.replay;
    const access = await loadGroupAccess(transaction, actor, payload.groupId);
    const {group, groupRef} = access;
    assertCanManageGroup(start.role, access);
    if (group.status !== "archived") {
      throw new ApplicationError("domain_precondition_failed",
        GROUP_NOT_ARCHIVED_MESSAGE);
    }
    assertVersion(group.updatedAt, payload.expectedUpdatedAt,
      GROUP_CONFLICT_MESSAGE);
    const slot = await reserveSplitGroupSlot(transaction, {
      actorUid: actor.uid,
      workspaceId: actor.workspaceId,
      workspace: start.workspace,
      nowMs: nowOf(options),
    });
    const rateLimit = await reserveSplitRateLimit(transaction, actor,
      SPLIT_STRUCTURE_RATE_LIMIT);
    transaction.update(groupRef, {
      status: "active",
      archivedAt: null,
      archivedBy: null,
      revision: group.revision + 1,
      updatedBy: actor.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });
    slot.commit();
    appendSplitEvent(transaction, {
      workspaceId: actor.workspaceId,
      operation: "split.group_reactivated",
      targetKey: start.intentId,
      groupId: group.id,
      actorId: actor.uid,
      actorRole: start.role,
      intentId: start.intentId,
      requestHash: start.reservation.requestHash,
      requestId,
      correlationId: correlationOf(payload),
      before: groupSnapshot(group),
      after: {
        ...groupSnapshot({...group, status: "active",
          revision: group.revision + 1}),
        activeGroupsAfter: slot.used + 1,
        activeGroupsLimit: slot.limit,
      },
    });
    return finishSplitMutation(transaction, actor, {
      start,
      operation: REACTIVATE_SPLIT_GROUP_OPERATION,
      requestId,
      ids: splitIds({groupId: group.id}),
      rateLimit,
      options,
    });
  });
