import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import type {CallerIdentity} from "../shared/callable";
import {
  userWorkspaceIndexRef,
  workspaceMemberRef,
  workspaceRef,
  type WorkspaceRole,
} from "../shared/workspaceAuth";
import {normalizeEmail} from "./inviteTokens";

/**
 * Documentos de conta, workspace e membership (P1).
 *
 * Todos são server-owned: as Rules negam escrita do cliente em cada um deles.
 *
 * - `users/{uid}`: perfil mínimo (`uid`, `email`, `displayName`, `photoURL`,
 *   `status`, `createdAt`, `updatedAt`). O webhook do Stripe acrescenta os
 *   campos de cobrança.
 * - `workspaces/{id}`: `ownerId` é só desnormalizado (D-03); `status` é
 *   `active` ou `archived`; moeda fixa BRL (D-16).
 * - `workspaces/{id}/members/{uid}`: única fonte de papel; `status` é
 *   `active` ou `removed` e a remoção é lógica.
 * - `users/{uid}/workspaces/{id}`: índice de listagem. Guarda dados de
 *   exibição (`name`, `type`, `workspaceStatus`) e o status do vínculo; **não**
 *   guarda papel e não autoriza nada.
 * - `workspaces/{id}/invites/{inviteId}`: convite sem o token nem seu hash.
 * - `invite_tokens/{sha256(token)}`: ponteiro do hash para o convite,
 *   server-only, com TTL em `expiresAt`.
 */
export const INVITES_COLLECTION = "invites";
export const INVITE_TOKENS_COLLECTION = "invite_tokens";

export type WorkspaceStatus = "active" | "archived";
export type MembershipStatus = "active" | "removed";
export type InviteStatus = "pending" | "accepted" | "revoked";

export const DEFAULT_ALERT_PREFERENCES = {
  billing: true,
  accountsPayable: true,
  delinquency: true,
  lowMargin: false,
} as const;

export const DEFAULT_THEME_COLOR: Record<"PF" | "PJ", string> = {
  PF: "#4f46e5",
  PJ: "#0f766e",
};

export const PERSONAL_WORKSPACE_NAME = "Meu Espaço Pessoal";

const db = () => admin.firestore();

export const inviteRef = (workspaceId: string, inviteId: string) =>
  workspaceRef(workspaceId).collection(INVITES_COLLECTION).doc(inviteId);

export const newInviteRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(INVITES_COLLECTION).doc();

export const inviteTokenRef = (tokenHash: string) =>
  db().collection(INVITE_TOKENS_COLLECTION).doc(tokenHash);

export const newWorkspaceRef = () => db().collection("workspaces").doc();

/** Identidade de exibição copiada do token verificado, nunca do payload. */
export const memberIdentityFrom = (caller: CallerIdentity) => ({
  email: caller.email ? normalizeEmail(caller.email) : null,
  displayName: caller.displayName,
  photoURL: caller.photoURL,
});

export interface WorkspaceDisplay {
  name: string;
  type: "PF" | "PJ";
  status: WorkspaceStatus;
}

export const workspaceDisplayOf = (
  data: admin.firestore.DocumentData,
): WorkspaceDisplay => ({
  name: typeof data.name === "string" ? data.name : "",
  type: data.type === "PJ" ? "PJ" : "PF",
  status: data.status === "archived" ? "archived" : "active",
});

/** Grava (ou reativa) o membership ativo e a entrada do índice. */
export const writeActiveMembership = (
  transaction: admin.firestore.Transaction,
  input: {
    workspaceId: string;
    uid: string;
    role: WorkspaceRole;
    caller: CallerIdentity | null;
    email: string | null;
    workspace: WorkspaceDisplay;
    invitedBy: string | null;
    existing: boolean;
  },
): void => {
  const identity = input.caller ? memberIdentityFrom(input.caller) : null;
  const member = {
    uid: input.uid,
    role: input.role,
    status: "active" as MembershipStatus,
    email: identity?.email ?? input.email,
    displayName: identity?.displayName ?? null,
    photoURL: identity?.photoURL ?? null,
    invitedBy: input.invitedBy,
    joinedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    removedAt: null,
    removedBy: null,
  };
  const memberDoc = workspaceMemberRef(input.workspaceId, input.uid);
  if (input.existing) {
    transaction.set(memberDoc, member);
  } else {
    transaction.create(memberDoc, member);
  }
  transaction.set(userWorkspaceIndexRef(input.uid, input.workspaceId), {
    workspaceId: input.workspaceId,
    status: "active" as MembershipStatus,
    name: input.workspace.name,
    type: input.workspace.type,
    workspaceStatus: input.workspace.status,
    joinedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
};

/** Remoção lógica: membership e índice passam a `removed`. */
export const writeRemovedMembership = (
  transaction: admin.firestore.Transaction,
  input: {workspaceId: string; uid: string; removedBy: string},
): void => {
  transaction.update(workspaceMemberRef(input.workspaceId, input.uid), {
    status: "removed",
    removedAt: FieldValue.serverTimestamp(),
    removedBy: input.removedBy,
    updatedAt: FieldValue.serverTimestamp(),
  });
  transaction.set(
    userWorkspaceIndexRef(input.uid, input.workspaceId),
    {status: "removed", updatedAt: FieldValue.serverTimestamp()},
    {merge: true},
  );
};

export const inviteExpiresAt = (days: number, now = Date.now()): Timestamp =>
  Timestamp.fromMillis(now + days * 24 * 60 * 60 * 1000);
