import {defineCallable} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {
  archiveCashAccountPayloadSchema,
  createCashAccountPayloadSchema,
  createCashTransferPayloadSchema,
  reactivateCashAccountPayloadSchema,
  reverseCashTransferPayloadSchema,
  updateCashAccountPayloadSchema,
} from "./contracts";
import {
  ARCHIVE_CASH_ACCOUNT_OPERATION,
  CASH_ACCOUNT_ADMIN_ROLES,
  CREATE_CASH_ACCOUNT_OPERATION,
  REACTIVATE_CASH_ACCOUNT_OPERATION,
  UPDATE_CASH_ACCOUNT_OPERATION,
  executeArchiveCashAccount,
  executeCreateCashAccount,
  executeReactivateCashAccount,
  executeUpdateCashAccount,
} from "./operations";
import {
  CASH_TRANSFER_ROLES,
  CREATE_CASH_TRANSFER_OPERATION,
  REVERSE_CASH_TRANSFER_OPERATION,
  executeCreateCashTransfer,
  executeReverseCashTransfer,
} from "./transfers";

/**
 * Callables de contas/carteiras e transferências (D-30, P3-J).
 *
 * A pré-checagem do kernel filtra o papel; a decisão que vale (papel,
 * titularidade de `member` no estorno, conta ativa, workspace ativo) é
 * relida dentro da transação de cada operação. São o único caminho de
 * escrita: as Rules negam ao cliente toda escrita em `cash_accounts`,
 * `cash_account_movements`, `cash_transfers` e `cash_account_events`.
 */
const INTERNAL_MESSAGE =
  "Não foi possível concluir a operação. Tente novamente.";

const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new ApplicationError("internal", INTERNAL_MESSAGE);
  return actor;
};

export const createCashAccount = defineCallable({
  operation: CREATE_CASH_ACCOUNT_OPERATION,
  schema: createCashAccountPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CASH_ACCOUNT_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateCashAccount(requireActor(actor), payload, requestId),
});

export const updateCashAccount = defineCallable({
  operation: UPDATE_CASH_ACCOUNT_OPERATION,
  schema: updateCashAccountPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CASH_ACCOUNT_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeUpdateCashAccount(requireActor(actor), payload, requestId),
});

export const archiveCashAccount = defineCallable({
  operation: ARCHIVE_CASH_ACCOUNT_OPERATION,
  schema: archiveCashAccountPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CASH_ACCOUNT_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeArchiveCashAccount(requireActor(actor), payload, requestId),
});

export const reactivateCashAccount = defineCallable({
  operation: REACTIVATE_CASH_ACCOUNT_OPERATION,
  schema: reactivateCashAccountPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CASH_ACCOUNT_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeReactivateCashAccount(requireActor(actor), payload, requestId),
});

export const createCashTransfer = defineCallable({
  operation: CREATE_CASH_TRANSFER_OPERATION,
  schema: createCashTransferPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CASH_TRANSFER_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateCashTransfer(requireActor(actor), payload, requestId),
});

export const reverseCashTransfer = defineCallable({
  operation: REVERSE_CASH_TRANSFER_OPERATION,
  schema: reverseCashTransferPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CASH_TRANSFER_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeReverseCashTransfer(requireActor(actor), payload, requestId),
});
