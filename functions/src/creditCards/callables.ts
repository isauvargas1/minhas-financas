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

import type {
  CreateCreditCardPurchasePayload,
} from "./contracts";

import {
  recordPurchaseLimitExceededEvent,
} from "./purchaseFailureEvents";

const toObservedHttpsError = async (
  operation: CreditCardBackendWriteOperation,
  request: {data: unknown; auth?: {uid?: string}},
  error: unknown
) => {
  await recordCreditCardCallableFailureSafely(
    operation,
    request.data,
    request.auth?.uid,
    error
  );

  return toHttpsError(error);
};

export const createCreditCardPurchase = onCall(async (request) => {
  let context: CreditCardCallableExecutionContext<CreateCreditCardPurchasePayload> | null = null;

  try {
    context = await buildCreditCardCallableContext(
      request,
      createCreditCardPurchasePayloadSchema,
      "createCreditCardPurchase"
    );

    return await executeCreateCreditCardPurchase(context);
  } catch (error) {
    if (context) {
      await recordPurchaseLimitExceededEvent(context, error);
    }

    throw await toObservedHttpsError(
      "createCreditCardPurchase",
      request,
      error
    );
  }
});

export const registerCreditCardInvoicePayment = onCall(async (request) => {
  try {
    const context = await buildCreditCardCallableContext(
      request,
      registerCreditCardInvoicePaymentPayloadSchema,
      "registerCreditCardInvoicePayment"
    );

    return await executeRegisterCreditCardInvoicePayment(context);
  } catch (error) {
    throw await toObservedHttpsError(
      "registerCreditCardInvoicePayment",
      request,
      error
    );
  }
});

export const reverseCreditCardInvoicePayment = onCall(async (request) => {
  try {
    const context = await buildCreditCardCallableContext(
      request,
      reverseCreditCardInvoicePaymentPayloadSchema,
      "reverseCreditCardInvoicePayment"
    );

    return await executeReverseCreditCardInvoicePayment(context);
  } catch (error) {
    throw await toObservedHttpsError(
      "reverseCreditCardInvoicePayment",
      request,
      error
    );
  }
});

export const cancelCreditCardPurchase = onCall(async (request) => {
  try {
    const context = await buildCreditCardCallableContext(
      request,
      cancelCreditCardPurchasePayloadSchema,
      "cancelCreditCardPurchase"
    );

    return await executeCancelCreditCardPurchase(context);
  } catch (error) {
    throw await toObservedHttpsError(
      "cancelCreditCardPurchase",
      request,
      error
    );
  }
});

export const recalculateCardLimit = onCall(async (request) => {
  try {
    const context = await buildCreditCardCallableContext(
      request,
      recalculateCardLimitPayloadSchema,
      "recalculateCardLimit"
    );

    return await executeRecalculateCardLimit(context);
  } catch (error) {
    throw await toObservedHttpsError(
      "recalculateCardLimit",
      request,
      error
    );
  }
});

export const closeCreditCardInvoice = onCall(async (request) => {
  try {
    const context = await buildCreditCardCallableContext(
      request,
      closeCreditCardInvoicePayloadSchema,
      "closeCreditCardInvoice"
    );

    return await executeCloseCreditCardInvoice(context);
  } catch (error) {
    throw await toObservedHttpsError(
      "closeCreditCardInvoice",
      request,
      error
    );
  }
});

export const reopenCreditCardInvoice = onCall(async (request) => {
  try {
    const context = await buildCreditCardCallableContext(
      request,
      reopenCreditCardInvoicePayloadSchema,
      "reopenCreditCardInvoice"
    );

    return await executeReopenCreditCardInvoice(context);
  } catch (error) {
    throw await toObservedHttpsError(
      "reopenCreditCardInvoice",
      request,
      error
    );
  }
});

export const rebuildCardInvoicesForCard = onCall(async (request) => {
  try {
    const context = await buildCreditCardCallableContext(
      request,
      rebuildCardInvoicesForCardPayloadSchema,
      "rebuildCardInvoicesForCard"
    );

    return await executeRebuildCardInvoicesForCard(context);
  } catch (error) {
    throw await toObservedHttpsError(
      "rebuildCardInvoicesForCard",
      request,
      error
    );
  }
});

export const updateCreditCardPurchase = onCall(async (request) => {
  try {
    const context = await buildCreditCardCallableContext(
      request,
      updateCreditCardPurchasePayloadSchema,
      "updateCreditCardPurchase"
    );

    return await executeUpdateCreditCardPurchase(context);
  } catch (error) {
    throw await toObservedHttpsError(
      "updateCreditCardPurchase",
      request,
      error
    );
  }
});
