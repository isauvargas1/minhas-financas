import type {CallableRequest} from "firebase-functions/v2/https";
import {z} from "zod";

import type {
  CreditCardBackendRole,
  CreditCardBackendWriteOperation,
  CreditCardBackendWritePlan,
} from "./writeStrategy";

import {
  getCreditCardBackendWritePlan,
} from "./writeStrategy";

import type {
  WorkspaceAuthorizationContext,
  WorkspaceMemberRole,
} from "./auth";

import {
  requireWorkspaceRole,
} from "./auth";

export interface CreditCardCallableExecutionContext<TPayload> {
  payload: TPayload;
  auth: WorkspaceAuthorizationContext;
  plan: CreditCardBackendWritePlan;
}

type CallableAllowedWorkspaceRole = Extract<
  CreditCardBackendRole,
  WorkspaceMemberRole
>;

const isWorkspaceMemberRole = (
  role: CreditCardBackendRole
): role is CallableAllowedWorkspaceRole =>
  role === "owner" ||
  role === "admin" ||
  role === "member";

export const parseCallablePayload = <TPayload>(
  schema: z.ZodType<TPayload>,
  data: unknown
): TPayload => schema.parse(data);

export const buildCreditCardCallableContext = async <TPayload extends {
  workspaceId: string;
}>(
  request: CallableRequest<unknown>,
  schema: z.ZodType<TPayload>,
  operation: CreditCardBackendWriteOperation
): Promise<CreditCardCallableExecutionContext<TPayload>> => {
  const payload = parseCallablePayload(schema, request.data);
  const plan = getCreditCardBackendWritePlan(operation);
  const allowedRoles = plan.allowedRoles.filter(isWorkspaceMemberRole);

  const auth = await requireWorkspaceRole(
    request,
    payload.workspaceId,
    allowedRoles
  );

  return {
    payload,
    auth,
    plan,
  };
};