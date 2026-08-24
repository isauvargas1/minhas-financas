import { onCall } from "firebase-functions/v2/https";

import {
  buildCreditCardCallableContext,
} from "./callable";

import {
  cancelCreditCardPurchasePayloadSchema,
  closeCreditCardInvoicePayloadSchema,
  createCreditCardPurchasePayloadSchema,
  rebuildCardInvoicesForCardPayloadSchema,
  recalculateCardLimitPayloadSchema,
  registerCreditCardInvoicePaymentPayloadSchema,
  reopenCreditCardInvoicePayloadSchema,
  reverseCreditCardInvoicePaymentPayloadSchema,
  updateCreditCardPurchasePayloadSchema,
} from "./contracts";

import {
  executeCreateCreditCardPurchase,
} from "./createPurchase";

import {
  executeUpdateCreditCardPurchase,
} from "./updatePurchase";

import {
  executeCancelCreditCardPurchase,
} from "./cancelPurchase";

import {
  executeCloseCreditCardInvoice,
} from "./closeInvoice";

import {
  executeRegisterCreditCardInvoicePayment,
} from "./registerInvoicePayment";

import {
  executeReopenCreditCardInvoice,
} from "./reopenInvoice";

import {
  executeRebuildCardInvoicesForCard,
} from "./rebuildInvoices";

import {
  executeRecalculateCardLimit,
} from "./recalculateCardLimit";

import {
  executeReverseCreditCardInvoicePayment,
} from "./reverseInvoicePayment";

import {
  toHttpsError,
} from "./errors";

import {
  recordCreditCardCallableFailureSafely,
} from "./observability";

import type {
  CreditCardBackendWriteOperation,
} from "./writeStrategy";

import type {
  CreditCardCallableExecutionContext,
} from "./callable";

import {
  recordPurchaseLimitExceededEvent,
} from "./purchaseFailureEvents";

import {
  CREDIT_CARD_CALLABLE_OPTIONS,
  HEAVY_CREDIT_CARD_CALLABLE_OPTIONS,
} from "../shared/runtimeOptions";

import type { z } from "zod";

/**
 * Wrapper único das callables de cartão.
 *
 * Antes, cada callable montava o próprio `try/catch` e o `catch` chamava a
 * observabilidade passando `request.data` cru — de onde o `workspaceId` era
 * lido. Como o `catch` também captura `unauthenticated` e
 * `workspace_role_denied`, um chamador **sem token** gravava métricas, eventos
 * financeiros e notificações no workspace de qualquer tenant (INV-P0-001).
 *
 * Aqui o workspace só existe depois que `buildCreditCardCallableContext`
 * devolve — isto é, depois de `requireWorkspaceRole`. É esse valor, e nenhum
 * outro, que chega à observabilidade. É o mesmo padrão já aplicado em
 * `investments/callables.ts`.
 */
const creditCardCallable = <TPayload extends { workspaceId: string }>(
  operation: CreditCardBackendWriteOperation,
  schema: z.ZodType<TPayload>,
  execute: (
    context: CreditCardCallableExecutionContext<TPayload>
  ) => Promise<unknown>,
  options: {
    runtime?: typeof CREDIT_CARD_CALLABLE_OPTIONS;
    onFailure?: (
      context: CreditCardCallableExecutionContext<TPayload>,
      error: unknown
    ) => Promise<void>;
  } = {}
) =>
  onCall(options.runtime ?? CREDIT_CARD_CALLABLE_OPTIONS, async (request) => {
    let context: CreditCardCallableExecutionContext<TPayload> | null = null;

    try {
      context = await buildCreditCardCallableContext(
        request,
        schema,
        operation
      );

      return await execute(context);
    } catch (error) {
      if (context && options.onFailure) {
        await options.onFailure(context, error);
      }

      await recordCreditCardCallableFailureSafely(
        operation,
        request.data,
        request.auth?.uid,
        error,
        context?.auth.workspaceId
      );

      throw toHttpsError(error);
    }
  });

export const createCreditCardPurchase = creditCardCallable(
  "createCreditCardPurchase",
  createCreditCardPurchasePayloadSchema,
  executeCreateCreditCardPurchase,
  { onFailure: recordPurchaseLimitExceededEvent }
);

export const registerCreditCardInvoicePayment = creditCardCallable(
  "registerCreditCardInvoicePayment",
  registerCreditCardInvoicePaymentPayloadSchema,
  executeRegisterCreditCardInvoicePayment
);

export const reverseCreditCardInvoicePayment = creditCardCallable(
  "reverseCreditCardInvoicePayment",
  reverseCreditCardInvoicePaymentPayloadSchema,
  executeReverseCreditCardInvoicePayment
);

export const cancelCreditCardPurchase = creditCardCallable(
  "cancelCreditCardPurchase",
  cancelCreditCardPurchasePayloadSchema,
  executeCancelCreditCardPurchase
);

export const recalculateCardLimit = creditCardCallable(
  "recalculateCardLimit",
  recalculateCardLimitPayloadSchema,
  executeRecalculateCardLimit,
  { runtime: HEAVY_CREDIT_CARD_CALLABLE_OPTIONS }
);

export const closeCreditCardInvoice = creditCardCallable(
  "closeCreditCardInvoice",
  closeCreditCardInvoicePayloadSchema,
  executeCloseCreditCardInvoice
);

export const reopenCreditCardInvoice = creditCardCallable(
  "reopenCreditCardInvoice",
  reopenCreditCardInvoicePayloadSchema,
  executeReopenCreditCardInvoice
);

export const rebuildCardInvoicesForCard = creditCardCallable(
  "rebuildCardInvoicesForCard",
  rebuildCardInvoicesForCardPayloadSchema,
  executeRebuildCardInvoicesForCard,
  { runtime: HEAVY_CREDIT_CARD_CALLABLE_OPTIONS }
);

export const updateCreditCardPurchase = creditCardCallable(
  "updateCreditCardPurchase",
  updateCreditCardPurchasePayloadSchema,
  executeUpdateCreditCardPurchase
);
