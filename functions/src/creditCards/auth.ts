import type {CallableRequest} from "firebase-functions/v2/https";

import {
  CreditCardApplicationError,
} from "./errors";

import {
  getFirestore,
  workspaceDoc,
} from "./adminPaths";

export type WorkspaceMemberRole =
  | "owner"
  | "admin"
  | "member"
  | "viewer";

export interface AuthenticatedCallableUser {
  uid: string;
  email?: string;
}

export interface WorkspaceAuthorizationContext {
  uid: string;
  workspaceId: string;
  role: WorkspaceMemberRole;
  email?: string;
}

const isWorkspaceMemberRole = (value: unknown): value is WorkspaceMemberRole =>
  value === "owner" ||
  value === "admin" ||
  value === "member" ||
  value === "viewer";

export const requireAuthenticatedUser = (
  request: CallableRequest<unknown>
): AuthenticatedCallableUser => {
  if (!request.auth?.uid) {
    throw new CreditCardApplicationError(
      "unauthenticated",
      "Usuário não autenticado."
    );
  }

  const token = request.auth.token as Record<string, unknown>;

  return {
    uid: request.auth.uid,
    email: typeof token.email === "string" ? token.email : undefined,
  };
};

export const getWorkspaceRoleForUser = async (
  workspaceId: string,
  uid: string
): Promise<WorkspaceMemberRole> => {
  const db = getFirestore();
  const memberRef = db.doc(`workspaces/${workspaceId}/members/${uid}`);
  const [memberSnap, workspaceSnap] = await Promise.all([
    memberRef.get(),
    workspaceDoc(workspaceId).get(),
  ]);

  if (!workspaceSnap.exists) {
    throw new CreditCardApplicationError(
      "workspace_not_found",
      "Workspace não encontrado.",
      {workspaceId}
    );
  }

  if (memberSnap.exists) {
    const role = memberSnap.data()?.role;
    const status = memberSnap.data()?.status;

    if (isWorkspaceMemberRole(role) && (status === undefined || status === "active")) {
      return role;
    }

    if (status !== undefined && status !== "active") {
      throw new CreditCardApplicationError(
        "workspace_membership_required",
        "A participação do usuário neste workspace não está ativa.",
        {workspaceId}
      );
    }
  }

  const ownerId = workspaceSnap.data()?.ownerId;

  if (ownerId === uid) {
    return "owner";
  }

  throw new CreditCardApplicationError(
    "workspace_membership_required",
    "Usuário não pertence a este workspace.",
    {workspaceId}
  );
};

export const requireWorkspaceRole = async (
  request: CallableRequest<unknown>,
  workspaceId: string,
  allowedRoles: WorkspaceMemberRole[]
): Promise<WorkspaceAuthorizationContext> => {
  const user = requireAuthenticatedUser(request);
  const role = await getWorkspaceRoleForUser(workspaceId, user.uid);

  if (!allowedRoles.includes(role)) {
    throw new CreditCardApplicationError(
      "workspace_role_denied",
      "Usuário não possui permissão para executar esta operação.",
      {workspaceId, role, allowedRoles}
    );
  }

  return {
    uid: user.uid,
    email: user.email,
    workspaceId,
    role,
  };
};
