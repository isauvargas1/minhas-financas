import {defineCallable} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {
  DOMAIN_CALLABLE_OPTIONS,
  HEAVY_CALLABLE_OPTIONS,
} from "../shared/runtimeOptions";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {
  ARCHIVE_CREDIT_CARD_OPERATION,
  CREATE_CREDIT_CARD_OPERATION,
  REACTIVATE_CREDIT_CARD_OPERATION,
  UPDATE_CREDIT_CARD_OPERATION,
  executeArchiveCreditCard,
  executeCreateCreditCard,
  executeReactivateCreditCard,
  executeUpdateCreditCard,
} from "./cardOperations";
import {
  CARD_ADMIN_ROLES,
  CARD_PURCHASE_ROLES,
  INTERNAL_MESSAGE,
} from "./common";
import {
  archiveCreditCardPayloadSchema,
  cancelCreditCardPurchasePayloadSchema,
  createCreditCardInvoiceAdjustmentPayloadSchema,
  createCreditCardPayloadSchema,
  createCreditCardPurchasePayloadSchema,
  reactivateCreditCardPayloadSchema,
  rebuildCardInvoicesPayloadSchema,
  recalculateCardLimitPayloadSchema,
  refundCreditCardPurchasePayloadSchema,
  registerInvoicePaymentPayloadSchema,
  reverseInvoicePaymentPayloadSchema,
  updateCreditCardPayloadSchema,
  updateCreditCardPurchasePayloadSchema,
} from "./contracts";
import {
  CREATE_INVOICE_ADJUSTMENT_OPERATION,
  REGISTER_INVOICE_PAYMENT_OPERATION,
  REVERSE_INVOICE_PAYMENT_OPERATION,
  executeCreateInvoiceAdjustment,
  executeRegisterInvoicePayment,
  executeReverseInvoicePayment,
} from "./invoiceOperations";
import {
  CANCEL_CREDIT_CARD_PURCHASE_OPERATION,
  CREATE_CREDIT_CARD_PURCHASE_OPERATION,
  REFUND_CREDIT_CARD_PURCHASE_OPERATION,
  UPDATE_CREDIT_CARD_PURCHASE_OPERATION,
  executeCancelCreditCardPurchase,
  executeCreateCreditCardPurchase,
  executeRefundCreditCardPurchase,
  executeUpdateCreditCardPurchase,
} from "./purchaseOperations";
import {
  REBUILD_CARD_INVOICES_OPERATION,
  RECALCULATE_CARD_LIMIT_OPERATION,
  executeRebuildCardInvoices,
  executeRecalculateCardLimit,
} from "./reconciliation";

/**
 * Callables de cartões de crédito (P4-A, D-36).
 *
 * A pré-checagem do kernel filtra o papel; a decisão que vale (papel,
 * titularidade de `member` na edição de compra, cartão ativo, workspace
 * ativo) é relida dentro da transação de cada operação. São o único caminho
 * de escrita: as Rules negam ao cliente toda escrita em `credit_cards` e nas
 * demais coleções do domínio.
 */
const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new ApplicationError("internal", INTERNAL_MESSAGE);
  return actor;
};

export const createCreditCard = defineCallable({
  operation: CREATE_CREDIT_CARD_OPERATION,
  schema: createCreditCardPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CARD_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateCreditCard(requireActor(actor), payload, requestId),
});

export const updateCreditCard = defineCallable({
  operation: UPDATE_CREDIT_CARD_OPERATION,
  schema: updateCreditCardPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CARD_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeUpdateCreditCard(requireActor(actor), payload, requestId),
});

export const archiveCreditCard = defineCallable({
  operation: ARCHIVE_CREDIT_CARD_OPERATION,
  schema: archiveCreditCardPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CARD_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeArchiveCreditCard(requireActor(actor), payload, requestId),
});

export const reactivateCreditCard = defineCallable({
  operation: REACTIVATE_CREDIT_CARD_OPERATION,
  schema: reactivateCreditCardPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CARD_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeReactivateCreditCard(requireActor(actor), payload, requestId),
});

export const createCreditCardPurchase = defineCallable({
  operation: CREATE_CREDIT_CARD_PURCHASE_OPERATION,
  schema: createCreditCardPurchasePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CARD_PURCHASE_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateCreditCardPurchase(requireActor(actor), payload, requestId),
});

export const updateCreditCardPurchase = defineCallable({
  operation: UPDATE_CREDIT_CARD_PURCHASE_OPERATION,
  schema: updateCreditCardPurchasePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CARD_PURCHASE_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeUpdateCreditCardPurchase(requireActor(actor), payload, requestId),
});

export const cancelCreditCardPurchase = defineCallable({
  operation: CANCEL_CREDIT_CARD_PURCHASE_OPERATION,
  schema: cancelCreditCardPurchasePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CARD_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCancelCreditCardPurchase(requireActor(actor), payload, requestId),
});

export const refundCreditCardPurchase = defineCallable({
  operation: REFUND_CREDIT_CARD_PURCHASE_OPERATION,
  schema: refundCreditCardPurchasePayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CARD_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeRefundCreditCardPurchase(requireActor(actor), payload, requestId),
});

export const createCreditCardInvoiceAdjustment = defineCallable({
  operation: CREATE_INVOICE_ADJUSTMENT_OPERATION,
  schema: createCreditCardInvoiceAdjustmentPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CARD_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeCreateInvoiceAdjustment(requireActor(actor), payload, requestId),
});

export const registerInvoicePayment = defineCallable({
  operation: REGISTER_INVOICE_PAYMENT_OPERATION,
  schema: registerInvoicePaymentPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CARD_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeRegisterInvoicePayment(requireActor(actor), payload, requestId),
});

export const reverseInvoicePayment = defineCallable({
  operation: REVERSE_INVOICE_PAYMENT_OPERATION,
  schema: reverseInvoicePaymentPayloadSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  workspaceRoles: CARD_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeReverseInvoicePayment(requireActor(actor), payload, requestId),
});

export const recalculateCardLimit = defineCallable({
  operation: RECALCULATE_CARD_LIMIT_OPERATION,
  schema: recalculateCardLimitPayloadSchema,
  runtime: HEAVY_CALLABLE_OPTIONS,
  workspaceRoles: CARD_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeRecalculateCardLimit(requireActor(actor), payload, requestId),
});

export const rebuildCardInvoicesForCard = defineCallable({
  operation: REBUILD_CARD_INVOICES_OPERATION,
  schema: rebuildCardInvoicesPayloadSchema,
  runtime: HEAVY_CALLABLE_OPTIONS,
  workspaceRoles: CARD_ADMIN_ROLES,
  internalMessage: INTERNAL_MESSAGE,
  handler: ({actor, payload, requestId}) =>
    executeRebuildCardInvoices(requireActor(actor), payload, requestId),
});
