import type {z} from "zod";

import {
  defineCallable,
  type CallableDefinition,
  type CallableFailure,
} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import type {InvestmentBackendOperation} from "./infrastructure";
import {recordInvestmentCallableFailureSafely} from "./observability";
import {investmentOperationRoles} from "./writeStrategy";
import {
  cancelInvestmentMovementPayloadSchema,
  changeInvestmentGoalPayloadSchema,
  createSimpleInvestmentPayloadSchema,
  linkInvestmentToGoalPayloadSchema,
  reverseInvestmentMovementPayloadSchema,
  settleInvestmentContributionPayloadSchema,
  settleSimpleWithdrawalPayloadSchema,
  unlinkInvestmentFromGoalPayloadSchema,
  withdrawSimpleInvestmentPayloadSchema,
} from "./contracts";
import {
  executeCancelInvestmentMovement,
  executeChangeInvestmentGoal,
  executeCreateSimpleInvestment,
  executeLinkInvestmentToGoal,
  executeReverseInvestmentMovement,
  executeSettleInvestmentContribution,
  executeSettleSimpleWithdrawal,
  executeUnlinkInvestmentFromGoal,
  executeWithdrawSimpleInvestment,
} from "./operationsV2";

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
): CallableDefinition<TPayload, Record<string, unknown>> => {
  return {
    operation: backendOperation,
    schema,
    runtime: DOMAIN_CALLABLE_OPTIONS,
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

/**
 * Superfície pública do domínio patrimonial (D-15, P4-D).
 *
 * Só as operações da experiência simples — a única oferecida: registrar um
 * investimento, confirmar um aporte, retirar dinheiro, confirmar a retirada,
 * desfazer (estorno compensatório) ou cancelar um pendente e vincular,
 * desvincular ou trocar a meta. A interface não conhece conta técnica, ativo
 * técnico, quantidade, preço unitário, valoração, importação nem
 * reconstrução; o ledger, as projeções e as garantias são os mesmos.
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

export const reverseInvestmentMovement = defineCallable(
  investmentDefinition(
    "reverseInvestmentMovement",
    reverseInvestmentMovementPayloadSchema,
    executeReverseInvestmentMovement,
  ),
);

export const cancelInvestmentMovement = defineCallable(
  investmentDefinition(
    "cancelInvestmentMovement",
    cancelInvestmentMovementPayloadSchema,
    executeCancelInvestmentMovement,
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
