import {defineCallable} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {
  CREATE_SPLIT_BILL_OPERATION,
  UPDATE_SPLIT_BILL_OPERATION,
  VOID_SPLIT_BILL_OPERATION,
  executeCreateSplitBill,
  executeUpdateSplitBill,
  executeVoidSplitBill,
} from "./billOperations";
import {
  INTERNAL_MESSAGE,
  SPLIT_ACTOR_ROLES,
} from "./common";
import {
  acceptSplitInvitePayloadSchema,
  addExternalParticipantPayloadSchema,
  addWorkspaceParticipantPayloadSchema,
  createSplitBillPayloadSchema,
  createSplitGroupPayloadSchema,
  createSplitInvitePayloadSchema,
  createSplitReimbursementPayloadSchema,
  deactivateParticipantPayloadSchema,
  forgiveSplitSharePayloadSchema,
  groupLifecyclePayloadSchema,
  paySplitReimbursementPayloadSchema,
  reimbursementActionPayloadSchema,
  rejectSplitReimbursementPayloadSchema,
  revokeSplitInvitePayloadSchema,
  shareActionPayloadSchema,
  updateSplitBillPayloadSchema,
  updateSplitGroupPayloadSchema,
  voidSplitBillPayloadSchema,
} from "./contracts";
import {
  ARCHIVE_SPLIT_GROUP_OPERATION,
  CREATE_SPLIT_GROUP_OPERATION,
  REACTIVATE_SPLIT_GROUP_OPERATION,
  UPDATE_SPLIT_GROUP_OPERATION,
  executeArchiveSplitGroup,
  executeCreateSplitGroup,
  executeReactivateSplitGroup,
  executeUpdateSplitGroup,
} from "./groupOperations";
import {
  ACCEPT_SPLIT_INVITE_OPERATION,
  ADD_EXTERNAL_PARTICIPANT_OPERATION,
  ADD_WORKSPACE_PARTICIPANT_OPERATION,
  CREATE_SPLIT_INVITE_OPERATION,
  DEACTIVATE_PARTICIPANT_OPERATION,
  REVOKE_SPLIT_INVITE_OPERATION,
  executeAcceptSplitGroupInvite,
  executeAddExternalSplitParticipant,
  executeAddWorkspaceSplitParticipant,
  executeCreateSplitGroupInvite,
  executeDeactivateSplitParticipant,
  executeRevokeSplitGroupInvite,
} from "./participantOperations";
import {
  APPROVE_SPLIT_REIMBURSEMENT_OPERATION,
  CANCEL_SPLIT_REIMBURSEMENT_OPERATION,
  CREATE_SPLIT_REIMBURSEMENT_OPERATION,
  PAY_SPLIT_REIMBURSEMENT_OPERATION,
  REJECT_SPLIT_REIMBURSEMENT_OPERATION,
  REVERSE_REIMBURSEMENT_PAYMENT_OPERATION,
  executeApproveSplitReimbursement,
  executeCancelSplitReimbursement,
  executeCreateSplitReimbursement,
  executePaySplitReimbursement,
  executeRejectSplitReimbursement,
  executeReverseReimbursementPayment,
} from "./reimbursementOperations";
import {
  FORGIVE_SPLIT_SHARE_OPERATION,
  REVERSE_SPLIT_SHARE_SETTLEMENT_OPERATION,
  SETTLE_SPLIT_SHARE_OPERATION,
  executeForgiveSplitShare,
  executeReverseSplitShareSettlement,
  executeSettleSplitShare,
} from "./shareOperations";

/**
 * Callables da Divisão de contas (P4-C, D-14).
 *
 * A pré-checagem do kernel filtra o papel do workspace (viewer fica fora:
 * só lê); a decisão que vale — papel relido, workspace ativo, papel no
 * grupo, estado do grupo, do título, do rateio e do reembolso — é tomada
 * dentro da transação de cada operação. São o único caminho de escrita: as
 * Rules negam ao cliente toda escrita nas coleções `split_*`.
 */
const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new ApplicationError("internal", INTERNAL_MESSAGE);
  return actor;
};

export const createSplitGroup = defineCallable({
  operation: CREATE_SPLIT_GROUP_OPERATION,
  schema: createSplitGroupPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateSplitGroup(requireActor(actor), payload, requestId),
});

export const updateSplitGroup = defineCallable({
  operation: UPDATE_SPLIT_GROUP_OPERATION,
  schema: updateSplitGroupPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeUpdateSplitGroup(requireActor(actor), payload, requestId),
});

export const archiveSplitGroup = defineCallable({
  operation: ARCHIVE_SPLIT_GROUP_OPERATION,
  schema: groupLifecyclePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeArchiveSplitGroup(requireActor(actor), payload, requestId),
});

export const reactivateSplitGroup = defineCallable({
  operation: REACTIVATE_SPLIT_GROUP_OPERATION,
  schema: groupLifecyclePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeReactivateSplitGroup(requireActor(actor), payload, requestId),
});

export const createSplitGroupInvite = defineCallable({
  operation: CREATE_SPLIT_INVITE_OPERATION,
  schema: createSplitInvitePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateSplitGroupInvite(requireActor(actor), payload, requestId),
});

export const revokeSplitGroupInvite = defineCallable({
  operation: REVOKE_SPLIT_INVITE_OPERATION,
  schema: revokeSplitInvitePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeRevokeSplitGroupInvite(requireActor(actor), payload, requestId),
});

export const acceptSplitGroupInvite = defineCallable({
  operation: ACCEPT_SPLIT_INVITE_OPERATION,
  schema: acceptSplitInvitePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeAcceptSplitGroupInvite(requireActor(actor), payload, requestId),
});

export const addWorkspaceSplitParticipant = defineCallable({
  operation: ADD_WORKSPACE_PARTICIPANT_OPERATION,
  schema: addWorkspaceParticipantPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeAddWorkspaceSplitParticipant(requireActor(actor), payload,
      requestId),
});

export const addExternalSplitParticipant = defineCallable({
  operation: ADD_EXTERNAL_PARTICIPANT_OPERATION,
  schema: addExternalParticipantPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeAddExternalSplitParticipant(requireActor(actor), payload, requestId),
});

export const deactivateSplitParticipant = defineCallable({
  operation: DEACTIVATE_PARTICIPANT_OPERATION,
  schema: deactivateParticipantPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeDeactivateSplitParticipant(requireActor(actor), payload, requestId),
});

export const createSplitBill = defineCallable({
  operation: CREATE_SPLIT_BILL_OPERATION,
  schema: createSplitBillPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateSplitBill(requireActor(actor), payload, requestId),
});

export const updateSplitBill = defineCallable({
  operation: UPDATE_SPLIT_BILL_OPERATION,
  schema: updateSplitBillPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeUpdateSplitBill(requireActor(actor), payload, requestId),
});

export const voidSplitBill = defineCallable({
  operation: VOID_SPLIT_BILL_OPERATION,
  schema: voidSplitBillPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeVoidSplitBill(requireActor(actor), payload, requestId),
});

export const settleSplitShare = defineCallable({
  operation: SETTLE_SPLIT_SHARE_OPERATION,
  schema: shareActionPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeSettleSplitShare(requireActor(actor), payload, requestId),
});

export const reverseSplitShareSettlement = defineCallable({
  operation: REVERSE_SPLIT_SHARE_SETTLEMENT_OPERATION,
  schema: shareActionPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeReverseSplitShareSettlement(requireActor(actor), payload, requestId),
});

export const forgiveSplitShare = defineCallable({
  operation: FORGIVE_SPLIT_SHARE_OPERATION,
  schema: forgiveSplitSharePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeForgiveSplitShare(requireActor(actor), payload, requestId),
});

export const createSplitReimbursement = defineCallable({
  operation: CREATE_SPLIT_REIMBURSEMENT_OPERATION,
  schema: createSplitReimbursementPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateSplitReimbursement(requireActor(actor), payload, requestId),
});

export const approveSplitReimbursement = defineCallable({
  operation: APPROVE_SPLIT_REIMBURSEMENT_OPERATION,
  schema: reimbursementActionPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeApproveSplitReimbursement(requireActor(actor), payload, requestId),
});

export const rejectSplitReimbursement = defineCallable({
  operation: REJECT_SPLIT_REIMBURSEMENT_OPERATION,
  schema: rejectSplitReimbursementPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeRejectSplitReimbursement(requireActor(actor), payload, requestId),
});

export const cancelSplitReimbursement = defineCallable({
  operation: CANCEL_SPLIT_REIMBURSEMENT_OPERATION,
  schema: reimbursementActionPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCancelSplitReimbursement(requireActor(actor), payload, requestId),
});

export const paySplitReimbursement = defineCallable({
  operation: PAY_SPLIT_REIMBURSEMENT_OPERATION,
  schema: paySplitReimbursementPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executePaySplitReimbursement(requireActor(actor), payload, requestId),
});

export const reverseReimbursementPayment = defineCallable({
  operation: REVERSE_REIMBURSEMENT_PAYMENT_OPERATION,
  schema: reimbursementActionPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: SPLIT_ACTOR_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeReverseReimbursementPayment(requireActor(actor), payload, requestId),
});
