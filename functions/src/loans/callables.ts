import {defineCallable} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {
  cancelLoanPayloadSchema,
  createLoanPayloadSchema,
  registerLoanPaymentPayloadSchema,
  reverseLoanMovementPayloadSchema,
  updateLoanMetadataPayloadSchema,
} from "./contracts";
import {
  CANCEL_LOAN_OPERATION,
  CREATE_LOAN_OPERATION,
  LOAN_ROLES,
  REGISTER_LOAN_PAYMENT_OPERATION,
  REVERSE_LOAN_MOVEMENT_OPERATION,
  UPDATE_LOAN_METADATA_OPERATION,
  executeCancelLoan,
  executeCreateLoan,
  executeRegisterLoanPayment,
  executeReverseLoanMovement,
  executeUpdateLoanMetadata,
} from "./operations";

/**
 * Callables do domínio autoritativo de empréstimos (D-13, P3-G; interface
 * PF/PJ desde a P3-H).
 *
 * A pré-checagem do kernel aceita owner, admin e member; a decisão que vale
 * (papel, titularidade de `member`, conta e workspace ativos) é relida dentro
 * da transação de cada operação. São o único caminho de escrita de
 * empréstimos: as Rules negam ao cliente toda escrita em `loans`,
 * `loan_movements` e `loan_events`.
 */
const INTERNAL_MESSAGE =
  "Não foi possível concluir a operação do empréstimo. Tente novamente.";

const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new ApplicationError("internal", INTERNAL_MESSAGE);
  return actor;
};

export const createLoan = defineCallable({
  operation: CREATE_LOAN_OPERATION,
  schema: createLoanPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: LOAN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateLoan(requireActor(actor), payload, requestId),
});

export const registerLoanPayment = defineCallable({
  operation: REGISTER_LOAN_PAYMENT_OPERATION,
  schema: registerLoanPaymentPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: LOAN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeRegisterLoanPayment(requireActor(actor), payload, requestId),
});

export const reverseLoanMovement = defineCallable({
  operation: REVERSE_LOAN_MOVEMENT_OPERATION,
  schema: reverseLoanMovementPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: LOAN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeReverseLoanMovement(requireActor(actor), payload, requestId),
});

export const cancelLoan = defineCallable({
  operation: CANCEL_LOAN_OPERATION,
  schema: cancelLoanPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: LOAN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCancelLoan(requireActor(actor), payload, requestId),
});

export const updateLoanMetadata = defineCallable({
  operation: UPDATE_LOAN_METADATA_OPERATION,
  schema: updateLoanMetadataPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: LOAN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeUpdateLoanMetadata(requireActor(actor), payload, requestId),
});
