import {
  RECENT_AUTH_MAX_AGE_SECONDS,
  defineCallable,
} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {consumeUserRateLimit} from "../shared/rateLimit";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {
  acceptWorkspaceInvitePayloadSchema,
  archiveWorkspacePayloadSchema,
  bootstrapAccountPayloadSchema,
  changeWorkspaceMemberRolePayloadSchema,
  createWorkspacePayloadSchema,
  inviteWorkspaceMemberPayloadSchema,
  leaveWorkspacePayloadSchema,
  removeWorkspaceMemberPayloadSchema,
  revokeWorkspaceInvitePayloadSchema,
  transferWorkspaceOwnershipPayloadSchema,
  updateWorkspaceSettingsPayloadSchema,
} from "./contracts";
import {generateInviteToken, hashInviteToken} from "./inviteTokens";
import {
  executeArchiveWorkspace,
  executeBootstrapAccount,
  executeCreateWorkspace,
  executeUpdateWorkspaceSettings,
} from "./lifecycle";
import {
  ACCEPT_RATE_LIMIT,
  executeAcceptWorkspaceInvite,
  executeChangeWorkspaceMemberRole,
  executeInviteWorkspaceMember,
  executeLeaveWorkspace,
  executeRemoveWorkspaceMember,
  executeRevokeWorkspaceInvite,
  executeTransferWorkspaceOwnership,
} from "./memberships";

/**
 * Callables de conta, workspace e membership (P1).
 *
 * Política de token por operação (D-06): e-mail verificado em convites e
 * mutações sensíveis; autenticação recente (10 min) em transferência e
 * arquivamento. `bootstrapAccount` não exige e-mail verificado nem conta já
 * existente — é ela que cria a conta. Nenhuma consulta plano, quota ou
 * entitlement: P2 acrescenta a quota dentro das transações de criação de
 * workspace, convite e aceite (D-01).
 */
const INTERNAL_MESSAGE =
  "Não foi possível concluir a operação no espaço. Tente novamente.";

const VERIFIED = {requireVerifiedEmail: true} as const;
const VERIFIED_RECENT = {
  requireVerifiedEmail: true,
  maxAuthAgeSeconds: RECENT_AUTH_MAX_AGE_SECONDS,
} as const;

const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) {
    throw new ApplicationError("internal", INTERNAL_MESSAGE);
  }
  return actor;
};

export const bootstrapAccount = defineCallable({
  operation: "bootstrapAccount",
  schema: bootstrapAccountPayloadSchema,
  policy: {requireActiveAccount: false},
  internalMessage: INTERNAL_MESSAGE,
  handler: ({caller, requestId}) => executeBootstrapAccount(caller, requestId),
});

export const createWorkspace = defineCallable({
  operation: "createWorkspace",
  schema: createWorkspacePayloadSchema,
  policy: VERIFIED,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({caller, payload, requestId}) =>
    executeCreateWorkspace(caller, payload, requestId),
});

export const updateWorkspaceSettings = defineCallable({
  operation: "updateWorkspaceSettings",
  schema: updateWorkspaceSettingsPayloadSchema,
  workspaceRoles: ["owner", "admin"],
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeUpdateWorkspaceSettings(requireActor(actor), payload, requestId),
});

/**
 * Sem pré-checagem de papel no wrapper: repetir o arquivamento precisa
 * devolver o resultado anterior, e a pré-checagem recusaria o workspace já
 * arquivado. A decisão é inteira da transação.
 */
export const archiveWorkspace = defineCallable({
  operation: "archiveWorkspace",
  schema: archiveWorkspacePayloadSchema,
  policy: VERIFIED_RECENT,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({caller, payload, requestId}) =>
    executeArchiveWorkspace(caller.uid, payload.workspaceId, requestId),
});

export const inviteWorkspaceMember = defineCallable({
  operation: "inviteWorkspaceMember",
  schema: inviteWorkspaceMemberPayloadSchema,
  policy: VERIFIED,
  workspaceRoles: ["owner", "admin"],
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) => {
    // O token em claro existe só aqui. A entrega ao convidado depende do
    // e-mail transacional (E-11) e não é simulada nesta fase (D-05).
    const tokenHash = hashInviteToken(generateInviteToken());
    return executeInviteWorkspaceMember(
      requireActor(actor),
      payload,
      tokenHash,
      requestId,
    );
  },
});

export const acceptWorkspaceInvite = defineCallable({
  operation: "acceptWorkspaceInvite",
  schema: acceptWorkspaceInvitePayloadSchema,
  policy: VERIFIED,
  internalMessage: INTERNAL_MESSAGE,
  handler: async ({caller, payload, requestId}) => {
    // Consumido em transação própria, antes do aceite: a tentativa inválida
    // gasta orçamento mesmo que a transação do aceite falhe.
    await consumeUserRateLimit(caller.uid, ACCEPT_RATE_LIMIT);
    return executeAcceptWorkspaceInvite(caller, payload.token, requestId);
  },
});

export const revokeWorkspaceInvite = defineCallable({
  operation: "revokeWorkspaceInvite",
  schema: revokeWorkspaceInvitePayloadSchema,
  policy: VERIFIED,
  workspaceRoles: ["owner", "admin"],
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeRevokeWorkspaceInvite(
      requireActor(actor),
      payload.inviteId,
      requestId,
    ),
});

export const changeWorkspaceMemberRole = defineCallable({
  operation: "changeWorkspaceMemberRole",
  schema: changeWorkspaceMemberRolePayloadSchema,
  policy: VERIFIED,
  workspaceRoles: ["owner", "admin"],
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeChangeWorkspaceMemberRole(
      requireActor(actor),
      payload.memberId,
      payload.role,
      requestId,
    ),
});

export const removeWorkspaceMember = defineCallable({
  operation: "removeWorkspaceMember",
  schema: removeWorkspaceMemberPayloadSchema,
  policy: VERIFIED,
  workspaceRoles: ["owner", "admin"],
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeRemoveWorkspaceMember(
      requireActor(actor),
      payload.memberId,
      requestId,
    ),
});

/** Sem pré-checagem: repetir a saída depois de concluída é no-op. */
export const leaveWorkspace = defineCallable({
  operation: "leaveWorkspace",
  schema: leaveWorkspacePayloadSchema,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({caller, payload, requestId}) =>
    executeLeaveWorkspace(caller.uid, payload.workspaceId, requestId),
});

/**
 * Sem pré-checagem de papel: depois de concluída, a origem já é admin, e um
 * retry legítimo precisa chegar à reserva de idempotência para receber o
 * resultado salvo. A transação relê o papel (`owner`) depois do replay.
 */
export const transferWorkspaceOwnership = defineCallable({
  operation: "transferWorkspaceOwnership",
  schema: transferWorkspaceOwnershipPayloadSchema,
  policy: VERIFIED_RECENT,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({caller, payload, requestId}) =>
    executeTransferWorkspaceOwnership(
      {uid: caller.uid, workspaceId: payload.workspaceId, role: "owner"},
      payload,
      requestId,
    ),
});
