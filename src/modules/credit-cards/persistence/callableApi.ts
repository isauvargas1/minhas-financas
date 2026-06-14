import { httpsCallable } from 'firebase/functions';

import { functions } from '../../../lib/firebase';

export interface CloseCreditCardInvoiceFrontendInput {
  workspaceId: string;
  cardId: string;
  invoiceId: string;
  closedAt: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface ReopenCreditCardInvoiceFrontendInput {
  workspaceId: string;
  cardId: string;
  invoiceId: string;
  reason: string;
  policy: 'only_if_unpaid' | 'allow_if_partial_paid_with_audit' | 'block_if_paid';
  idempotencyKey: string;
  correlationId?: string;
}

export interface CancelCreditCardPurchaseFrontendInput {
  workspaceId: string;
  cardId: string;
  purchaseId: string;
  reason: string;
  policy: 'only_if_all_installments_open' | 'allow_reversal_entries' | 'block_if_invoice_paid';
  idempotencyKey: string;
  correlationId?: string;
}

export interface RecalculateCardLimitFrontendInput {
  workspaceId: string;
  cardId: string;
  reason: string;
  idempotencyKey: string;
  correlationId?: string;
}

export interface RebuildCardInvoicesForCardFrontendInput {
  workspaceId: string;
  cardId: string;
  fromCompetenceMonth?: string;
  toCompetenceMonth?: string;
  reason: string;
  idempotencyKey: string;
  correlationId?: string;
}

export type CreditCardAdminCallableResult = {
  success: true;
  [key: string]: unknown;
};

const normalizeOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;

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
      .map(([key, entryValue]) => [key, stripEmptyOptionalFields(entryValue)])
  ) as T;
};

const normalizeAdminPayload = <T extends Record<string, unknown>>(payload: T): T =>
  stripEmptyOptionalFields(
    Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        typeof value === 'string' ? value.trim() : value,
      ])
    ) as T
  );

const callCreditCardAdminFunction = async <TInput extends Record<string, unknown>>(
  functionName: string,
  payload: TInput
): Promise<CreditCardAdminCallableResult> => {
  const callable = httpsCallable<TInput, CreditCardAdminCallableResult>(
    functions,
    functionName
  );

  const result = await callable(normalizeAdminPayload(payload));

  return result.data;
};

export const closeCreditCardInvoice = (
  payload: CloseCreditCardInvoiceFrontendInput
): Promise<CreditCardAdminCallableResult> =>
  callCreditCardAdminFunction('closeCreditCardInvoice', {
    ...payload,
    correlationId: normalizeOptionalString(payload.correlationId),
  });

export const reopenCreditCardInvoice = (
  payload: ReopenCreditCardInvoiceFrontendInput
): Promise<CreditCardAdminCallableResult> =>
  callCreditCardAdminFunction('reopenCreditCardInvoice', {
    ...payload,
    correlationId: normalizeOptionalString(payload.correlationId),
  });

export const cancelCreditCardPurchase = (
  payload: CancelCreditCardPurchaseFrontendInput
): Promise<CreditCardAdminCallableResult> =>
  callCreditCardAdminFunction('cancelCreditCardPurchase', {
    ...payload,
    correlationId: normalizeOptionalString(payload.correlationId),
  });

export const recalculateCardLimit = (
  payload: RecalculateCardLimitFrontendInput
): Promise<CreditCardAdminCallableResult> =>
  callCreditCardAdminFunction('recalculateCardLimit', {
    ...payload,
    correlationId: normalizeOptionalString(payload.correlationId),
  });

export const rebuildCardInvoicesForCard = (
  payload: RebuildCardInvoicesForCardFrontendInput
): Promise<CreditCardAdminCallableResult> =>
  callCreditCardAdminFunction('rebuildCardInvoicesForCard', {
    ...payload,
    correlationId: normalizeOptionalString(payload.correlationId),
  });