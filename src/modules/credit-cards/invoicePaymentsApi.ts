import { httpsCallable } from 'firebase/functions';

import { functions } from '../../lib/firebase';
import type { CreditCardInvoicePaymentMethod } from './domain/types.ts';

export interface RegisterCreditCardInvoicePaymentFrontendInput {
  workspaceId: string;
  cardId: string;
  invoiceId: string;
  paymentDate: string;
  amount: number;
  walletId?: string;
  cashAccountId?: string;
  paymentMethod: CreditCardInvoicePaymentMethod;
  idempotencyKey: string;
  correlationId?: string;
}

export interface RegisterCreditCardInvoicePaymentFrontendResult {
  success: true;
  paymentId: string;
  invoiceId: string;
  ledgerEntryId: string;
  eventId: string;
  cashTransactionId?: string;
  invoice: {
    id: string;
    status: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
  };
  limitSnapshot: {
    cardId: string;
    limitTotal: number;
    limitUsed: number;
    limitAvailable: number;
  };
}

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();

  return normalized ? normalized : undefined;
};

const stripEmptyOptionalFields = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .map(stripEmptyOptionalFields)
      .filter((item) => item !== undefined && item !== null) as T;
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null)
      .map(([key, entryValue]) => [key, stripEmptyOptionalFields(entryValue)]),
  ) as T;
};

const normalizeRegisterInvoicePaymentPayload = (
  payload: RegisterCreditCardInvoicePaymentFrontendInput,
): RegisterCreditCardInvoicePaymentFrontendInput => ({
  workspaceId: payload.workspaceId.trim(),
  cardId: payload.cardId.trim(),
  invoiceId: payload.invoiceId.trim(),
  paymentDate: payload.paymentDate,
  amount: Number(payload.amount),
  walletId: normalizeOptionalString(payload.walletId),
  cashAccountId: normalizeOptionalString(payload.cashAccountId),
  paymentMethod: payload.paymentMethod,
  idempotencyKey: payload.idempotencyKey,
  correlationId: normalizeOptionalString(payload.correlationId),
});

export const registerCreditCardInvoicePayment = async (
  payload: RegisterCreditCardInvoicePaymentFrontendInput,
): Promise<RegisterCreditCardInvoicePaymentFrontendResult> => {
  const callable = httpsCallable<
    RegisterCreditCardInvoicePaymentFrontendInput,
    RegisterCreditCardInvoicePaymentFrontendResult
  >(functions, 'registerCreditCardInvoicePayment');

  const normalizedPayload = stripEmptyOptionalFields(
    normalizeRegisterInvoicePaymentPayload(payload),
  );

  const result = await callable(normalizedPayload);

  return result.data;
};
export interface ReverseCreditCardInvoicePaymentFrontendInput {
  workspaceId: string;
  cardId: string;
  invoiceId: string;
  paymentId: string;
  reason: string;
  reversedAt: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface ReverseCreditCardInvoicePaymentFrontendResult {
  success: true;
  paymentId: string;
  invoiceId: string;
  ledgerEntryId: string;
  eventId: string;
  cashReversalTransactionId?: string;
  invoice: {
    id: string;
    status: string;
    totalAmount: number;
    paidAmount: number;
    remainingAmount: number;
  };
  limitSnapshot: {
    cardId: string;
    limitTotal: number;
    limitUsed: number;
    limitAvailable: number;
  };
}

const normalizeReverseInvoicePaymentPayload = (
  payload: ReverseCreditCardInvoicePaymentFrontendInput,
): ReverseCreditCardInvoicePaymentFrontendInput => ({
  workspaceId: payload.workspaceId.trim(),
  cardId: payload.cardId.trim(),
  invoiceId: payload.invoiceId.trim(),
  paymentId: payload.paymentId.trim(),
  reason: payload.reason.trim(),
  reversedAt: payload.reversedAt,
  idempotencyKey: payload.idempotencyKey,
  correlationId: normalizeOptionalString(payload.correlationId),
});

export const reverseCreditCardInvoicePayment = async (
  payload: ReverseCreditCardInvoicePaymentFrontendInput,
): Promise<ReverseCreditCardInvoicePaymentFrontendResult> => {
  const callable = httpsCallable<
    ReverseCreditCardInvoicePaymentFrontendInput,
    ReverseCreditCardInvoicePaymentFrontendResult
  >(functions, 'reverseCreditCardInvoicePayment');

  const normalizedPayload = stripEmptyOptionalFields(
    normalizeReverseInvoicePaymentPayload(payload),
  );

  const result = await callable(normalizedPayload);

  return result.data;
};