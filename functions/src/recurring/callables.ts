import {defineCallable} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {INTERNAL_MESSAGE, RECURRING_ROLES} from "./common";
import {
  CANCEL_RECURRING_EXPENSE_OPERATION,
  CREATE_RECURRING_EXPENSE_OPERATION,
  PAUSE_RECURRING_EXPENSE_OPERATION,
  RESUME_RECURRING_EXPENSE_OPERATION,
  UPDATE_RECURRING_EXPENSE_OPERATION,
  executeCancelRecurringExpense,
  executeCreateRecurringExpense,
  executePauseRecurringExpense,
  executeResumeRecurringExpense,
  executeUpdateRecurringExpense,
} from "./contractOperations";
import {
  cancelRecurringExpensePayloadSchema,
  confirmRecurringOccurrencePayloadSchema,
  createRecurringExpensePayloadSchema,
  ignoreRecurringOccurrencePayloadSchema,
  pauseRecurringExpensePayloadSchema,
  resumeRecurringExpensePayloadSchema,
  retryRecurringOccurrencePayloadSchema,
  updateRecurringExpensePayloadSchema,
} from "./contracts";
import {
  CONFIRM_RECURRING_OCCURRENCE_OPERATION,
  IGNORE_RECURRING_OCCURRENCE_OPERATION,
  RETRY_RECURRING_OCCURRENCE_OPERATION,
  executeConfirmRecurringOccurrence,
  executeIgnoreRecurringOccurrence,
  executeRetryRecurringOccurrence,
} from "./occurrenceOperations";

/**
 * Callables de despesas recorrentes (P4-B, D-12).
 *
 * A pré-checagem do kernel filtra o papel (viewer fica fora); a decisão que
 * vale — papel, titularidade de `member`, workspace ativo, estado do
 * contrato e da ocorrência — é relida dentro da transação de cada operação.
 * São o único caminho de escrita: as Rules negam ao cliente toda escrita em
 * `recurring_expenses`, `recurring_occurrences` e `recurring_events`.
 */
const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new ApplicationError("internal", INTERNAL_MESSAGE);
  return actor;
};

export const createRecurringExpense = defineCallable({
  operation: CREATE_RECURRING_EXPENSE_OPERATION,
  schema: createRecurringExpensePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: RECURRING_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateRecurringExpense(requireActor(actor), payload, requestId),
});

export const updateRecurringExpense = defineCallable({
  operation: UPDATE_RECURRING_EXPENSE_OPERATION,
  schema: updateRecurringExpensePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: RECURRING_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeUpdateRecurringExpense(requireActor(actor), payload, requestId),
});

export const pauseRecurringExpense = defineCallable({
  operation: PAUSE_RECURRING_EXPENSE_OPERATION,
  schema: pauseRecurringExpensePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: RECURRING_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executePauseRecurringExpense(requireActor(actor), payload, requestId),
});

export const resumeRecurringExpense = defineCallable({
  operation: RESUME_RECURRING_EXPENSE_OPERATION,
  schema: resumeRecurringExpensePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: RECURRING_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeResumeRecurringExpense(requireActor(actor), payload, requestId),
});

export const cancelRecurringExpense = defineCallable({
  operation: CANCEL_RECURRING_EXPENSE_OPERATION,
  schema: cancelRecurringExpensePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: RECURRING_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCancelRecurringExpense(requireActor(actor), payload, requestId),
});

export const confirmRecurringOccurrence = defineCallable({
  operation: CONFIRM_RECURRING_OCCURRENCE_OPERATION,
  schema: confirmRecurringOccurrencePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: RECURRING_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeConfirmRecurringOccurrence(requireActor(actor), payload, requestId),
});

export const ignoreRecurringOccurrence = defineCallable({
  operation: IGNORE_RECURRING_OCCURRENCE_OPERATION,
  schema: ignoreRecurringOccurrencePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: RECURRING_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeIgnoreRecurringOccurrence(requireActor(actor), payload, requestId),
});

export const retryRecurringOccurrence = defineCallable({
  operation: RETRY_RECURRING_OCCURRENCE_OPERATION,
  schema: retryRecurringOccurrencePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: RECURRING_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeRetryRecurringOccurrence(requireActor(actor), payload, requestId),
});
