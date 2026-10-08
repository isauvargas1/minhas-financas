import {defineCallable} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {
  ARCHIVE_CLIENT_OPERATION,
  CREATE_CLIENT_OPERATION,
  UPDATE_CLIENT_OPERATION,
  executeArchiveClient,
  executeCreateClient,
  executeUpdateClient,
} from "./clientOperations";
import {CLIENT_ADMIN_ROLES, INTERNAL_MESSAGE, RECEIVABLE_ROLES} from "./common";
import {
  archiveClientPayloadSchema,
  cancelReceivablePayloadSchema,
  createClientPayloadSchema,
  createReceivablePayloadSchema,
  receiveReceivablePayloadSchema,
  reverseReceivableReceiptPayloadSchema,
  updateClientPayloadSchema,
  updateReceivablePayloadSchema,
} from "./contracts";
import {
  CANCEL_RECEIVABLE_OPERATION,
  CREATE_RECEIVABLE_OPERATION,
  RECEIVE_RECEIVABLE_OPERATION,
  REVERSE_RECEIVABLE_RECEIPT_OPERATION,
  UPDATE_RECEIVABLE_OPERATION,
  executeCancelReceivable,
  executeCreateReceivable,
  executeReceiveReceivable,
  executeReverseReceivableReceipt,
  executeUpdateReceivable,
} from "./operations";

/**
 * Callables de clientes e recebíveis (D-24, D-39, P3-I).
 *
 * A pré-checagem do kernel filtra o papel; a decisão que vale (papel,
 * titularidade de `member` nos recebíveis, conta, workspace ativo e PJ) é
 * relida dentro da transação de cada operação. São o único caminho de
 * escrita: as Rules negam ao cliente toda escrita em `clients`,
 * `client_private`, `receivables`, `receivable_movements`, `client_events` e
 * `receivable_events`.
 */
const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new ApplicationError("internal", INTERNAL_MESSAGE);
  return actor;
};

export const createClient = defineCallable({
  operation: CREATE_CLIENT_OPERATION,
  schema: createClientPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CLIENT_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateClient(requireActor(actor), payload, requestId),
});

export const updateClient = defineCallable({
  operation: UPDATE_CLIENT_OPERATION,
  schema: updateClientPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CLIENT_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeUpdateClient(requireActor(actor), payload, requestId),
});

export const archiveClient = defineCallable({
  operation: ARCHIVE_CLIENT_OPERATION,
  schema: archiveClientPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CLIENT_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeArchiveClient(requireActor(actor), payload, requestId),
});

export const createReceivable = defineCallable({
  operation: CREATE_RECEIVABLE_OPERATION,
  schema: createReceivablePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: RECEIVABLE_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateReceivable(requireActor(actor), payload, requestId),
});

export const updateReceivable = defineCallable({
  operation: UPDATE_RECEIVABLE_OPERATION,
  schema: updateReceivablePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: RECEIVABLE_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeUpdateReceivable(requireActor(actor), payload, requestId),
});

export const receiveReceivable = defineCallable({
  operation: RECEIVE_RECEIVABLE_OPERATION,
  schema: receiveReceivablePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: RECEIVABLE_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeReceiveReceivable(requireActor(actor), payload, requestId),
});

export const reverseReceivableReceipt = defineCallable({
  operation: REVERSE_RECEIVABLE_RECEIPT_OPERATION,
  schema: reverseReceivableReceiptPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: RECEIVABLE_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeReverseReceivableReceipt(requireActor(actor), payload, requestId),
});

export const cancelReceivable = defineCallable({
  operation: CANCEL_RECEIVABLE_OPERATION,
  schema: cancelReceivablePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: RECEIVABLE_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCancelReceivable(requireActor(actor), payload, requestId),
});
