import type {CallableOptions} from "firebase-functions/v2/https";
import type {z} from "zod";

import {
  defineCallable,
  type CallableDefinition,
  type CallableFailure,
} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {
  DOMAIN_CALLABLE_OPTIONS,
  HEAVY_CALLABLE_OPTIONS,
} from "../shared/runtimeOptions";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import type {InvestmentBackendOperation} from "./infrastructure";
import {recordInvestmentCallableFailureSafely} from "./observability";
import {investmentOperationRoles} from "./writeStrategy";
import {
  archiveInvestmentAccountPayloadSchema,
  archiveInvestmentAssetPayloadSchema,
  cancelInvestmentMovementPayloadSchema,
  createInvestmentContributionPayloadSchema,
  createInvestmentRedemptionPayloadSchema,
  createSimpleInvestmentPayloadSchema,
  settleInvestmentContributionPayloadSchema,
  settleSimpleWithdrawalPayloadSchema,
  withdrawSimpleInvestmentPayloadSchema,
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
import {
  executeArchiveInvestmentAccount,
  executeArchiveInvestmentAsset,
  executeCancelInvestmentMovement,
  executeCreateInvestmentContribution,
  executeCreateInvestmentRedemptionV2,
  executeCreateSimpleInvestment,
  executeSettleInvestmentContribution,
  executeSettleSimpleWithdrawal,
  executeWithdrawSimpleInvestment,
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

const INVESTMENT_INTERNAL_MESSAGE =
  "Erro interno ao processar operação de investimento.";

/**
 * O registro de falha só grava no workspace que a pré-checagem do kernel
 * autorizou (`CallableFailure.workspaceId`); antes dela o valor é `null` e o
 * registrador não escreve em tenant nenhum.
 */
const recordFailure = (backendOperation: InvestmentBackendOperation) =>
  async (failure: CallableFailure): Promise<void> => {
    await recordInvestmentCallableFailureSafely(
      backendOperation,
      failure.request,
      failure.error,
      failure.workspaceId ?? undefined,
    );
  };

/**
 * Definição de callable do domínio sobre o wrapper único do kernel.
 *
 * Os papéis vêm da matriz declarativa (`writeStrategy.ts`), nunca de literais
 * locais: o kernel faz a pré-checagem com eles e as operações releem a mesma
 * entrada dentro da transação (`reassertWorkspaceActor`), que é a decisão que
 * vale.
 */
const investmentDefinition = <TPayload extends {workspaceId: string}>(
  backendOperation: InvestmentBackendOperation,
  schema: z.ZodType<TPayload>,
  operation: (
    auth: WorkspaceActor,
    payload: TPayload,
  ) => Promise<Record<string, unknown>>,
  runtime: CallableOptions = DOMAIN_CALLABLE_OPTIONS,
): CallableDefinition<TPayload, Record<string, unknown>> => {
  return {
    operation: backendOperation,
    schema,
    runtime,
    workspaceRoles: investmentOperationRoles(backendOperation),
    internalMessage: INVESTMENT_INTERNAL_MESSAGE,
    onFailure: recordFailure(backendOperation),
    handler: async ({payload, actor}) => {
      if (!actor) {
        throw new ApplicationError("internal", INVESTMENT_INTERNAL_MESSAGE);
      }
      return operation(actor, payload);
    },
  };
};

export const onboardInvestmentWorkspace = defineCallable(
  investmentDefinition(
    "onboardInvestmentWorkspace",
    onboardInvestmentWorkspacePayloadSchema,
    executeOnboardInvestmentWorkspace,
  ),
);

export const createInvestmentContribution = defineCallable(
  investmentDefinition(
    "createInvestmentContribution",
    createInvestmentContributionPayloadSchema,
    executeCreateInvestmentContribution,
  ),
);

/**
 * Superfície simples do domínio patrimonial (Etapa 1).
 *
 * As três callables abaixo existem para que a interface possa registrar um
 * investimento, confirmar um aporte e retirar dinheiro sem conhecer conta
 * técnica, ativo técnico, quantidade, preço unitário, custo médio, resultado
 * realizado, valoração ou reconstrução. O ledger, as projeções e as garantias
 * são exatamente os mesmos do restante do domínio.
 */
export const createSimpleInvestment = defineCallable(
  investmentDefinition(
    "createSimpleInvestment",
    createSimpleInvestmentPayloadSchema,
    executeCreateSimpleInvestment,
  ),
);

export const settleInvestmentContribution = defineCallable(
  investmentDefinition(
    "settleInvestmentContribution",
    settleInvestmentContributionPayloadSchema,
    executeSettleInvestmentContribution,
  ),
);

export const withdrawSimpleInvestment = defineCallable(
  investmentDefinition(
    "withdrawSimpleInvestment",
    withdrawSimpleInvestmentPayloadSchema,
    executeWithdrawSimpleInvestment,
  ),
);

export const settleSimpleWithdrawal = defineCallable(
  investmentDefinition(
    "settleSimpleWithdrawal",
    settleSimpleWithdrawalPayloadSchema,
    executeSettleSimpleWithdrawal,
  ),
);

export const createInvestmentRedemption = defineCallable(
  investmentDefinition(
    "createInvestmentRedemption",
    createInvestmentRedemptionPayloadSchema,
    executeCreateInvestmentRedemptionV2,
  ),
);

export const settleInvestmentRedemption = defineCallable(
  investmentDefinition(
    "settleInvestmentRedemption",
    settleInvestmentRedemptionPayloadSchema,
    executeSettleInvestmentRedemption,
  ),
);

export const reverseInvestmentMovement = defineCallable(
  investmentDefinition(
    "reverseInvestmentMovement",
    reverseInvestmentMovementPayloadSchema,
    executeReverseInvestmentMovement,
  ),
);

export const changeInvestmentGoal = defineCallable(
  investmentDefinition(
    "changeInvestmentGoal",
    changeInvestmentGoalPayloadSchema,
    executeChangeInvestmentGoal,
  ),
);

export const linkInvestmentToGoal = defineCallable(
  investmentDefinition(
    "linkInvestmentToGoal",
    linkInvestmentToGoalPayloadSchema,
    executeLinkInvestmentToGoal,
  ),
);

export const unlinkInvestmentFromGoal = defineCallable(
  investmentDefinition(
    "unlinkInvestmentFromGoal",
    unlinkInvestmentFromGoalPayloadSchema,
    executeUnlinkInvestmentFromGoal,
  ),
);

export const recalculateInvestmentPosition = defineCallable(
  investmentDefinition(
    "recalculateInvestmentPosition",
    recalculateInvestmentPositionPayloadSchema,
    executeRecalculateInvestmentPosition,
    HEAVY_CALLABLE_OPTIONS,
  ),
);

export const recalculateGoalInvestmentProgress = defineCallable(
  investmentDefinition(
    "recalculateGoalInvestmentProgress",
    recalculateGoalInvestmentProgressPayloadSchema,
    executeRecalculateGoalInvestmentProgress,
    HEAVY_CALLABLE_OPTIONS,
  ),
);

export const archiveInvestmentAccount = defineCallable(
  investmentDefinition(
    "archiveInvestmentAccount",
    archiveInvestmentAccountPayloadSchema,
    executeArchiveInvestmentAccount,
  ),
);

export const archiveInvestmentAsset = defineCallable(
  investmentDefinition(
    "archiveInvestmentAsset",
    archiveInvestmentAssetPayloadSchema,
    executeArchiveInvestmentAsset,
  ),
);

export const saveInvestmentAccount = defineCallable(
  investmentDefinition(
    "saveInvestmentAccount",
    saveInvestmentAccountPayloadSchema,
    executeSaveInvestmentAccount,
  ),
);

export const saveInvestmentAsset = defineCallable(
  investmentDefinition(
    "saveInvestmentAsset",
    saveInvestmentAssetPayloadSchema,
    executeSaveInvestmentAsset,
  ),
);

export const cancelInvestmentMovement = defineCallable(
  investmentDefinition(
    "cancelInvestmentMovement",
    cancelInvestmentMovementPayloadSchema,
    executeCancelInvestmentMovement,
  ),
);

export const recordInvestmentValuation = defineCallable(
  investmentDefinition(
    "recordInvestmentValuation",
    recordInvestmentValuationPayloadSchema,
    executeRecordInvestmentValuation,
  ),
);

export const registerInvestmentImportBatch = defineCallable(
  investmentDefinition(
    "registerInvestmentImportBatch",
    registerInvestmentImportBatchPayloadSchema,
    executeRegisterInvestmentImportBatch,
  ),
);

export const rebuildInvestmentProjections = defineCallable(
  investmentDefinition(
    "rebuildInvestmentProjections",
    rebuildInvestmentProjectionsPayloadSchema,
    executeRebuildInvestmentProjections,
    HEAVY_CALLABLE_OPTIONS,
  ),
);

export const backfillInvestmentWorkspace = defineCallable(
  investmentDefinition(
    "backfillInvestmentWorkspace",
    backfillInvestmentWorkspacePayloadSchema,
    executeBackfillInvestmentWorkspace,
    HEAVY_CALLABLE_OPTIONS,
  ),
);
