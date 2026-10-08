import {defineCallable} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {
  confirmCashTransactionPayloadSchema,
  createCashTransactionPayloadSchema,
  importCashTransactionsPayloadSchema,
  updateCashTransactionPayloadSchema,
  voidCashTransactionPayloadSchema,
} from "./contracts";
import {
  CASH_ENTRY_ROLES,
  CREATE_CASH_TRANSACTION_OPERATION,
  executeCreateCashTransaction,
} from "./createTransaction";
import {
  IMPORT_CASH_TRANSACTIONS_OPERATION,
  executeImportCashTransactions,
} from "./importTransactions";
import {
  CONFIRM_CASH_TRANSACTION_OPERATION,
  UPDATE_CASH_TRANSACTION_OPERATION,
  VOID_CASH_TRANSACTION_OPERATION,
  executeConfirmCashTransaction,
  executeUpdateCashTransaction,
  executeVoidCashTransaction,
} from "./mutateTransaction";

/**
 * Callables do domínio de caixa (P3-A, P3-C, P3-D, P3-F).
 *
 * Criação de lançamento manual confirmado ou pendente (P3-A, P3-F/D-29),
 * correção e anulação (P3-C, D-35), confirmação de pendente (P3-F) e
 * importação em lotes de confirmados (P3-D). A criação e a importação
 * consomem a quota mensal do workspace (D-40); a confirmação não.
 * Transferências entre contas ficam em `functions/src/accounts/` (D-30,
 * P3-J). Desde a P4-D todo produtor de `transactions` é backend e as Rules
 * negam toda escrita do cliente na coleção.
 */
const INTERNAL_MESSAGE =
  "Não foi possível registrar o lançamento. Tente novamente.";

/** Com `workspaceRoles`, o kernel sempre entrega o ator resolvido. */
const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new ApplicationError("internal", INTERNAL_MESSAGE);
  return actor;
};

export const createCashTransaction = defineCallable({
  operation: CREATE_CASH_TRANSACTION_OPERATION,
  schema: createCashTransactionPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CASH_ENTRY_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  // A pré-checagem do kernel recusa cedo; a decisão que vale é a releitura
  // dentro da transação (`executeCreateCashTransaction`).
  handler: ({actor, payload, requestId}) =>
    executeCreateCashTransaction(requireActor(actor), payload, requestId),
});

const MUTATION_INTERNAL_MESSAGE =
  "Não foi possível alterar o lançamento. Tente novamente.";

/**
 * Correção de lançamento (P3-C). A pré-checagem aceita owner, admin e member;
 * a regra de que `member` só corrige o que registrou e a elegibilidade são
 * decididas dentro da transação (`executeUpdateCashTransaction`).
 */
export const updateCashTransaction = defineCallable({
  operation: UPDATE_CASH_TRANSACTION_OPERATION,
  schema: updateCashTransactionPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CASH_ENTRY_ROLES,
  internalMessage: MUTATION_INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeUpdateCashTransaction(requireActor(actor), payload, requestId),
});

/**
 * Confirmação de lançamento pendente (P3-F, D-29): data efetiva e valor
 * liquidado; vencimento preservado; sem nova unidade de quota.
 */
export const confirmCashTransaction = defineCallable({
  operation: CONFIRM_CASH_TRANSACTION_OPERATION,
  schema: confirmCashTransactionPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CASH_ENTRY_ROLES,
  internalMessage: MUTATION_INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeConfirmCashTransaction(requireActor(actor), payload, requestId),
});

/** Anulação lógica de lançamento (P3-C), com motivo obrigatório. */
export const voidCashTransaction = defineCallable({
  operation: VOID_CASH_TRANSACTION_OPERATION,
  schema: voidCashTransactionPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CASH_ENTRY_ROLES,
  internalMessage: MUTATION_INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeVoidCashTransaction(requireActor(actor), payload, requestId),
});

/**
 * Importação em lotes de lançamentos manuais confirmados (P3-D). Atomicidade
 * por lote; identidade estável por linha; quota de todas as linhas novas do
 * lote na mesma transação (`executeImportCashTransactions`).
 */
export const importCashTransactions = defineCallable({
  operation: IMPORT_CASH_TRANSACTIONS_OPERATION,
  schema: importCashTransactionsPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CASH_ENTRY_ROLES,
  internalMessage: "Não foi possível importar os lançamentos. Tente novamente.",
  handler: ({actor, payload, requestId}) =>
    executeImportCashTransactions(requireActor(actor), payload, requestId),
});
