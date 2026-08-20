import {onCall} from "firebase-functions/v2/https";
import {z} from "zod";

import {requireWorkspaceRole} from "../creditCards/auth";
import {
  archiveInvestmentAccountPayloadSchema,
  archiveInvestmentAssetPayloadSchema,
  cancelInvestmentRedemptionPayloadSchema,
  createInvestmentContributionPayloadSchema,
  createInvestmentRedemptionPayloadSchema,
  linkInvestmentToGoalPayloadSchema,
  recalculateGoalInvestmentProgressPayloadSchema,
  recalculateInvestmentPositionPayloadSchema,
  reverseInvestmentRedemptionPayloadSchema,
  reverseInvestmentMovementPayloadSchema,
  saveInvestmentRedemptionPayloadSchema,
  saveInvestmentAccountPayloadSchema,
  saveInvestmentAssetPayloadSchema,
  settleInvestmentRedemptionPayloadSchema,
  unlinkInvestmentFromGoalPayloadSchema,
} from "./contracts";
import {toInvestmentHttpsError} from "./errors";
import {
  executeCancelInvestmentRedemption,
  executeReverseInvestmentRedemption,
  executeSaveInvestmentRedemption,
} from "./operations";
import {
  executeArchiveInvestmentAccount,
  executeArchiveInvestmentAsset,
  executeCreateInvestmentContribution,
  executeCreateInvestmentRedemptionV2,
  executeLinkInvestmentToGoal,
  executeReverseInvestmentMovement,
  executeSettleInvestmentRedemption,
  executeSaveInvestmentAccount,
  executeSaveInvestmentAsset,
  executeUnlinkInvestmentFromGoal,
} from "./operationsV2";
import {
  executeRecalculateGoalInvestmentProgress,
  executeRecalculateInvestmentPosition,
} from "./rebuild";

const ALL_ACTIVE_ROLES: Array<"owner" | "admin" | "member"> = [
  "owner",
  "admin",
  "member",
];

const callable = <TPayload extends { workspaceId: string }>(
  schema: z.ZodType<TPayload>,
  operation: (
    auth: Awaited<ReturnType<typeof requireWorkspaceRole>>,
    payload: TPayload,
  ) => Promise<Record<string, unknown>>,
) =>
    onCall(async (request) => {
      try {
        const payload = schema.parse(request.data);
        const auth = await requireWorkspaceRole(
          request,
          payload.workspaceId,
          ALL_ACTIVE_ROLES,
        );
        return await operation(auth, payload);
      } catch (error) {
        throw toInvestmentHttpsError(error);
      }
    });

export const saveInvestmentRedemption = callable(
  saveInvestmentRedemptionPayloadSchema,
  executeSaveInvestmentRedemption,
);

export const cancelInvestmentRedemption = callable(
  cancelInvestmentRedemptionPayloadSchema,
  executeCancelInvestmentRedemption,
);

export const reverseInvestmentRedemption = callable(
  reverseInvestmentRedemptionPayloadSchema,
  executeReverseInvestmentRedemption,
);

const privilegedCallable = <TPayload extends { workspaceId: string }>(
  schema: z.ZodType<TPayload>,
  operation: (
    auth: Awaited<ReturnType<typeof requireWorkspaceRole>>,
    payload: TPayload,
  ) => Promise<Record<string, unknown>>,
) =>
    onCall(async (request) => {
      try {
        const payload = schema.parse(request.data);
        const auth = await requireWorkspaceRole(request, payload.workspaceId, [
          "owner",
          "admin",
        ]);
        return await operation(auth, payload);
      } catch (error) {
        throw toInvestmentHttpsError(error);
      }
    });

export const createInvestmentContribution = callable(
  createInvestmentContributionPayloadSchema,
  executeCreateInvestmentContribution,
);

export const createInvestmentRedemption = callable(
  createInvestmentRedemptionPayloadSchema,
  executeCreateInvestmentRedemptionV2,
);

export const settleInvestmentRedemption = callable(
  settleInvestmentRedemptionPayloadSchema,
  executeSettleInvestmentRedemption,
);

export const reverseInvestmentMovement = privilegedCallable(
  reverseInvestmentMovementPayloadSchema,
  executeReverseInvestmentMovement,
);

export const linkInvestmentToGoal = callable(
  linkInvestmentToGoalPayloadSchema,
  executeLinkInvestmentToGoal,
);

export const unlinkInvestmentFromGoal = callable(
  unlinkInvestmentFromGoalPayloadSchema,
  executeUnlinkInvestmentFromGoal,
);

export const recalculateInvestmentPosition = privilegedCallable(
  recalculateInvestmentPositionPayloadSchema,
  executeRecalculateInvestmentPosition,
);

export const recalculateGoalInvestmentProgress = privilegedCallable(
  recalculateGoalInvestmentProgressPayloadSchema,
  executeRecalculateGoalInvestmentProgress,
);

export const archiveInvestmentAccount = privilegedCallable(
  archiveInvestmentAccountPayloadSchema,
  executeArchiveInvestmentAccount,
);

export const archiveInvestmentAsset = privilegedCallable(
  archiveInvestmentAssetPayloadSchema,
  executeArchiveInvestmentAsset,
);

export const saveInvestmentAccount = privilegedCallable(
  saveInvestmentAccountPayloadSchema,
  executeSaveInvestmentAccount,
);

export const saveInvestmentAsset = privilegedCallable(
  saveInvestmentAssetPayloadSchema,
  executeSaveInvestmentAsset,
);
