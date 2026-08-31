import {onCall} from "firebase-functions/v2/https";
import {z} from "zod";

import {requireWorkspaceRole} from "../creditCards/auth";
import type {InvestmentBackendOperation} from "./infrastructure";
import {recordInvestmentCallableFailureSafely} from "./observability";
import {investmentOperationRoles} from "./writeStrategy";
import {
  archiveInvestmentAccountPayloadSchema,
  archiveInvestmentAssetPayloadSchema,
  cancelInvestmentMovementPayloadSchema,
  createInvestmentContributionPayloadSchema,
  createInvestmentRedemptionPayloadSchema,
  changeInvestmentGoalPayloadSchema,
  linkInvestmentToGoalPayloadSchema,
  onboardInvestmentWorkspacePayloadSchema,
  backfillInvestmentWorkspacePayloadSchema,
  rebuildInvestmentProjectionsPayloadSchema,
  recalculateGoalInvestmentProgressPayloadSchema,
  recalculateInvestmentPositionPayloadSchema,
  recordInvestmentValuationPayloadSchema,
  registerInvestmentImportBatchPayloadSchema,
  reverseInvestmentMovementPayloadSchema,
  saveInvestmentAccountPayloadSchema,
  saveInvestmentAssetPayloadSchema,
  settleInvestmentRedemptionPayloadSchema,
  unlinkInvestmentFromGoalPayloadSchema,
} from "./contracts";
import {toInvestmentHttpsError} from "./errors";
import {
  executeArchiveInvestmentAccount,
  executeArchiveInvestmentAsset,
  executeCancelInvestmentMovement,
  executeCreateInvestmentContribution,
  executeCreateInvestmentRedemptionV2,
  executeChangeInvestmentGoal,
  executeLinkInvestmentToGoal,
  executeRecordInvestmentValuation,
  executeRegisterInvestmentImportBatch,
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
import {executeRebuildInvestmentProjections} from "./projectionRebuild";
import {executeBackfillInvestmentWorkspace} from "./backfill";
import {executeOnboardInvestmentWorkspace} from "./onboarding";
import {
  DOMAIN_CALLABLE_OPTIONS,
  HEAVY_CALLABLE_OPTIONS,
} from "../shared/runtimeOptions";

/**
 * Wrapper único de callable do domínio.
 *
 * Os papéis vêm da matriz declarativa (`writeStrategy.ts`), nunca de literais
 * locais, e a mesma entrada é relida dentro da transação pelas operações.
 */
const investmentCallable = <TPayload extends { workspaceId: string }>(
  backendOperation: InvestmentBackendOperation,
  schema: z.ZodType<TPayload>,
  operation: (
    auth: Awaited<ReturnType<typeof requireWorkspaceRole>>,
    payload: TPayload,
  ) => Promise<Record<string, unknown>>,
  runtime = DOMAIN_CALLABLE_OPTIONS,
) =>
    onCall(runtime, async (request) => {
      // Só existe workspace autorizado depois que `requireWorkspaceRole`
      // devolve. A observabilidade de falha usa exclusivamente este valor:
      // ler `workspaceId` do payload deixava qualquer chamador gravar no
      // domínio de outro tenant pelo caminho de erro.
      let authorizedWorkspaceId: string | undefined;
      try {
        const payload = schema.parse(request.data);
        const auth = await requireWorkspaceRole(
          request,
          payload.workspaceId,
          investmentOperationRoles(backendOperation),
        );
        authorizedWorkspaceId = auth.workspaceId;
        return await operation(auth, payload);
      } catch (error) {
        await recordInvestmentCallableFailureSafely(
          backendOperation,
          request,
          error,
          authorizedWorkspaceId,
        );
        throw toInvestmentHttpsError(error);
      }
    });

export const onboardInvestmentWorkspace = investmentCallable(
  "onboardInvestmentWorkspace",
  onboardInvestmentWorkspacePayloadSchema,
  executeOnboardInvestmentWorkspace,
);

export const createInvestmentContribution = investmentCallable(
  "createInvestmentContribution",
  createInvestmentContributionPayloadSchema,
  executeCreateInvestmentContribution,
);

export const createInvestmentRedemption = investmentCallable(
  "createInvestmentRedemption",
  createInvestmentRedemptionPayloadSchema,
  executeCreateInvestmentRedemptionV2,
);

export const settleInvestmentRedemption = investmentCallable(
  "settleInvestmentRedemption",
  settleInvestmentRedemptionPayloadSchema,
  executeSettleInvestmentRedemption,
);

export const reverseInvestmentMovement = investmentCallable(
  "reverseInvestmentMovement",
  reverseInvestmentMovementPayloadSchema,
  executeReverseInvestmentMovement,
);

export const changeInvestmentGoal = investmentCallable(
  "changeInvestmentGoal",
  changeInvestmentGoalPayloadSchema,
  executeChangeInvestmentGoal,
);

export const linkInvestmentToGoal = investmentCallable(
  "linkInvestmentToGoal",
  linkInvestmentToGoalPayloadSchema,
  executeLinkInvestmentToGoal,
);

export const unlinkInvestmentFromGoal = investmentCallable(
  "unlinkInvestmentFromGoal",
  unlinkInvestmentFromGoalPayloadSchema,
  executeUnlinkInvestmentFromGoal,
);

export const recalculateInvestmentPosition = investmentCallable(
  "recalculateInvestmentPosition",
  recalculateInvestmentPositionPayloadSchema,
  executeRecalculateInvestmentPosition,
  HEAVY_CALLABLE_OPTIONS,
);

export const recalculateGoalInvestmentProgress = investmentCallable(
  "recalculateGoalInvestmentProgress",
  recalculateGoalInvestmentProgressPayloadSchema,
  executeRecalculateGoalInvestmentProgress,
  HEAVY_CALLABLE_OPTIONS,
);

export const archiveInvestmentAccount = investmentCallable(
  "archiveInvestmentAccount",
  archiveInvestmentAccountPayloadSchema,
  executeArchiveInvestmentAccount,
);

export const archiveInvestmentAsset = investmentCallable(
  "archiveInvestmentAsset",
  archiveInvestmentAssetPayloadSchema,
  executeArchiveInvestmentAsset,
);

export const saveInvestmentAccount = investmentCallable(
  "saveInvestmentAccount",
  saveInvestmentAccountPayloadSchema,
  executeSaveInvestmentAccount,
);

export const saveInvestmentAsset = investmentCallable(
  "saveInvestmentAsset",
  saveInvestmentAssetPayloadSchema,
  executeSaveInvestmentAsset,
);

export const cancelInvestmentMovement = investmentCallable(
  "cancelInvestmentMovement",
  cancelInvestmentMovementPayloadSchema,
  executeCancelInvestmentMovement,
);

export const recordInvestmentValuation = investmentCallable(
  "recordInvestmentValuation",
  recordInvestmentValuationPayloadSchema,
  executeRecordInvestmentValuation,
);

export const registerInvestmentImportBatch = investmentCallable(
  "registerInvestmentImportBatch",
  registerInvestmentImportBatchPayloadSchema,
  executeRegisterInvestmentImportBatch,
);

export const rebuildInvestmentProjections = investmentCallable(
  "rebuildInvestmentProjections",
  rebuildInvestmentProjectionsPayloadSchema,
  executeRebuildInvestmentProjections,
  HEAVY_CALLABLE_OPTIONS,
);

export const backfillInvestmentWorkspace = investmentCallable(
  "backfillInvestmentWorkspace",
  backfillInvestmentWorkspacePayloadSchema,
  executeBackfillInvestmentWorkspace,
  HEAVY_CALLABLE_OPTIONS,
);
