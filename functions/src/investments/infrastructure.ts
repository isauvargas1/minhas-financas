import {createHash} from "node:crypto";
import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import type {
  WorkspaceAuthorizationContext,
  WorkspaceMemberRole,
} from "../creditCards/auth";
import {CreditCardApplicationError} from "../creditCards/errors";
import type {InvestmentProfileType} from "./domain";
import {
  INVESTMENT_COLLECTIONS,
  investmentDoc,
  investmentMemberDoc,
  investmentWorkspaceRef,
} from "./paths";

export type InvestmentBackendOperation =
  | "saveInvestmentAccount"
  | "saveInvestmentAsset"
  | "createInvestmentContribution"
  | "createInvestmentRedemption"
  | "settleInvestmentRedemption"
  | "reverseInvestmentMovement"
  | "linkInvestmentToGoal"
  | "unlinkInvestmentFromGoal"
  | "recalculateInvestmentPosition"
  | "recalculateGoalInvestmentProgress"
  | "archiveInvestmentAccount"
  | "archiveInvestmentAsset";

export interface InvestmentIdempotencyReservation {
  ref: admin.firestore.DocumentReference;
  requestHash: string;
  keyHash: string;
  replay?: Record<string, unknown>;
}

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
};

export const deterministicDocumentId = (...parts: string[]): string =>
  `inv_${sha256(parts.join(":")).slice(0, 36)}`;

export const investmentPositionId = (
  accountId: string,
  assetId: string,
): string => deterministicDocumentId("position", accountId, assetId);

export const parseTimestamp = (value: string): Timestamp => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CreditCardApplicationError("invalid_payload", "Data inválida.");
  }
  return Timestamp.fromDate(date);
};

export const profileTypeFromWorkspace = (
  workspace: admin.firestore.DocumentData,
): InvestmentProfileType => {
  if (workspace.type === "PF" || workspace.type === "PJ") {
    return workspace.type;
  }
  throw new CreditCardApplicationError(
    "domain_precondition_failed",
    "O workspace precisa declarar explicitamente o contexto PF ou PJ.",
  );
};

const isRole = (value: unknown): value is WorkspaceMemberRole =>
  value === "owner" ||
  value === "admin" ||
  value === "member" ||
  value === "viewer";

export const authorizeInvestmentTransaction = async (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceAuthorizationContext,
  allowedRoles: WorkspaceMemberRole[],
): Promise<{
  workspace: admin.firestore.DocumentData;
  profileType: InvestmentProfileType;
  role: WorkspaceMemberRole;
}> => {
  const [workspaceSnapshot, memberSnapshot] = await Promise.all([
    transaction.get(investmentWorkspaceRef(auth.workspaceId)),
    transaction.get(investmentMemberDoc(auth.workspaceId, auth.uid)),
  ]);
  if (!workspaceSnapshot.exists) {
    throw new CreditCardApplicationError(
      "workspace_not_found",
      "Workspace não encontrado.",
    );
  }
  const workspace = workspaceSnapshot.data() ?? {};
  const member = memberSnapshot.data();
  if (
    memberSnapshot.exists &&
    member?.status !== undefined &&
    member.status !== "active"
  ) {
    throw new CreditCardApplicationError(
      "workspace_membership_required",
      "A participação do usuário neste workspace não está ativa.",
    );
  }
  const persistedRole =
    memberSnapshot.exists && isRole(member?.role) ?
      member.role :
      workspace.ownerId === auth.uid ?
        "owner" :
        undefined;
  if (!persistedRole) {
    throw new CreditCardApplicationError(
      "workspace_membership_required",
      "Usuário não pertence a este workspace.",
    );
  }
  if (!allowedRoles.includes(persistedRole)) {
    throw new CreditCardApplicationError(
      "workspace_role_denied",
      "Usuário não possui permissão para executar esta operação.",
    );
  }
  return {
    workspace,
    profileType: profileTypeFromWorkspace(workspace),
    role: persistedRole,
  };
};

export const reserveInvestmentIdempotency = async (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceAuthorizationContext,
  operation: InvestmentBackendOperation,
  idempotencyKey: string,
  correlationId: string,
  payload: unknown,
): Promise<InvestmentIdempotencyReservation> => {
  const payloadWorkspaceId =
    typeof payload === "object" && payload ?
      (payload as Record<string, unknown>).workspaceId :
      undefined;
  if (payloadWorkspaceId !== auth.workspaceId) {
    throw new CreditCardApplicationError(
      "permission_denied",
      "O workspace do payload não corresponde ao contexto autorizado.",
    );
  }
  const keyHash = sha256(idempotencyKey);
  const actorKeyHash = sha256(`${auth.uid}:${idempotencyKey}`).slice(0, 32);
  const id = `${operation}_${actorKeyHash}`;
  const ref = investmentDoc(
    auth.workspaceId,
    INVESTMENT_COLLECTIONS.idempotencyKeys,
    id,
  );
  const requestHash = sha256(stableStringify(payload));
  const snapshot = await transaction.get(ref);
  if (!snapshot.exists) return {ref, requestHash, keyHash};
  const data = snapshot.data() ?? {};
  if (
    data.workspaceId !== auth.workspaceId ||
    data.actorId !== auth.uid ||
    data.operation !== operation ||
    data.requestHash !== requestHash ||
    data.correlationId !== correlationId
  ) {
    throw new CreditCardApplicationError(
      "idempotency_conflict",
      "A chave de idempotência já foi usada com outros dados.",
    );
  }
  if (
    data.status !== "completed" ||
    typeof data.result !== "object" ||
    !data.result
  ) {
    throw new CreditCardApplicationError(
      "idempotency_conflict",
      "Esta solicitação já está em processamento.",
    );
  }
  return {
    ref,
    requestHash,
    keyHash,
    replay: data.result as Record<string, unknown>,
  };
};

export const completeInvestmentIdempotency = (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceAuthorizationContext,
  operation: InvestmentBackendOperation,
  correlationId: string,
  reservation: InvestmentIdempotencyReservation,
  result: Record<string, unknown>,
): void => {
  transaction.create(reservation.ref, {
    id: reservation.ref.id,
    workspaceId: auth.workspaceId,
    actorId: auth.uid,
    operation,
    correlationId,
    idempotencyKeyHash: reservation.keyHash,
    requestHash: reservation.requestHash,
    status: "completed",
    result,
    createdAt: FieldValue.serverTimestamp(),
    completedAt: FieldValue.serverTimestamp(),
  });
};

export const recordInvestmentEvent = (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceAuthorizationContext,
  role: WorkspaceMemberRole,
  profileType: InvestmentProfileType,
  operation: InvestmentBackendOperation,
  reservation: InvestmentIdempotencyReservation,
  correlationId: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
): void => {
  const eventId = `${reservation.ref.id}_event`;
  transaction.create(
    investmentDoc(auth.workspaceId, INVESTMENT_COLLECTIONS.eventLogs, eventId),
    {
      id: eventId,
      workspaceId: auth.workspaceId,
      profileType,
      actorId: auth.uid,
      actorRole: role,
      operation,
      entityType,
      entityId,
      correlationId,
      idempotencyKeyId: reservation.ref.id,
      outcome: "completed",
      details,
      occurredAt: FieldValue.serverTimestamp(),
    },
  );
};

export const assertWorkspaceDocument = (
  snapshot: admin.firestore.DocumentSnapshot,
  workspaceId: string,
  label: string,
): admin.firestore.DocumentData => {
  if (!snapshot.exists) {
    throw new CreditCardApplicationError(
      "not_found",
      `${label} não encontrado.`,
    );
  }
  const data = snapshot.data() ?? {};
  if (data.workspaceId !== undefined && data.workspaceId !== workspaceId) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `${label} não pertence ao workspace autorizado.`,
    );
  }
  return data;
};
