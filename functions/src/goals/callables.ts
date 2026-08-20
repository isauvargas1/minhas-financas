import {onCall} from "firebase-functions/v2/https";
import {z} from "zod";

import {requireWorkspaceRole} from "../creditCards/auth";
import {toHttpsError} from "../creditCards/errors";
import {
  archiveGoalPayloadSchema,
  createGoalPayloadSchema,
  rebuildGoalProgressPayloadSchema,
  saveGoalContributionPayloadSchema,
  seedLegacyCatalogPayloadSchema,
  setGoalLinksPayloadSchema,
  updateGoalPayloadSchema,
} from "./contracts";
import {
  executeArchiveGoal,
  executeCreateGoal,
  executeRebuildGoalProgress,
  executeSaveGoalContribution,
  executeSeedLegacySettingsCatalog,
  executeSetGoalTransactionLinks,
  executeUpdateGoal,
} from "./operations";

const buildContext = async <TPayload extends {workspaceId: string}>(
  request: Parameters<typeof requireWorkspaceRole>[0],
  schema: z.ZodType<TPayload>,
  allowedRoles: Array<"owner" | "admin" | "member">,
) => {
  const payload = schema.parse(request.data);
  const auth = await requireWorkspaceRole(request, payload.workspaceId, allowedRoles);
  return {payload, auth};
};

const callable = <TPayload extends {workspaceId: string}>(
  schema: z.ZodType<TPayload>,
  allowedRoles: Array<"owner" | "admin" | "member">,
  operation: (auth: Awaited<ReturnType<typeof requireWorkspaceRole>>, payload: TPayload) => Promise<Record<string, unknown>>,
) => onCall(async (request) => {
  try {
    const context = await buildContext(request, schema, allowedRoles);
    return await operation(context.auth, context.payload);
  } catch (error) {
    throw toHttpsError(error);
  }
});

const ALL_ACTIVE_ROLES: Array<"owner" | "admin" | "member"> = [
  "owner",
  "admin",
  "member",
];

export const createGoal = callable(
  createGoalPayloadSchema,
  ALL_ACTIVE_ROLES,
  executeCreateGoal,
);

export const updateGoal = callable(
  updateGoalPayloadSchema,
  ALL_ACTIVE_ROLES,
  executeUpdateGoal,
);

export const setGoalTransactionLinks = callable(
  setGoalLinksPayloadSchema,
  ALL_ACTIVE_ROLES,
  executeSetGoalTransactionLinks,
);

export const archiveGoal = callable(
  archiveGoalPayloadSchema,
  ALL_ACTIVE_ROLES,
  executeArchiveGoal,
);

export const rebuildGoalProgress = callable(
  rebuildGoalProgressPayloadSchema,
  ALL_ACTIVE_ROLES,
  executeRebuildGoalProgress,
);

export const saveGoalContribution = callable(
  saveGoalContributionPayloadSchema,
  ALL_ACTIVE_ROLES,
  executeSaveGoalContribution,
);

export const seedLegacySettingsCatalog = callable(
  seedLegacyCatalogPayloadSchema,
  ["owner", "admin"],
  executeSeedLegacySettingsCatalog,
);
