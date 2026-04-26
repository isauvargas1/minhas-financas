import { httpsCallable } from 'firebase/functions';

import { functions } from '../../lib/firebase';
import type {
  CreditCardPurchaseAmountType,
  CreditCardPurchaseSource,
} from './domain/types.ts';

export interface CreateCreditCardPurchaseFrontendInput {
  workspaceId: string;
  cardId: string;
  description: string;
  categoryId?: string;
  categorySnapshot?: {
    id?: string;
    label: string;
    normalizedLabel?: string;
    icon?: string;
    color?: string;
  };
  supplier?: string;
  costCenter?: string;
  purchaseDate: string;
  totalAmount: number;
  installmentsCount: number;
  amountType: CreditCardPurchaseAmountType;
  source: CreditCardPurchaseSource;
  idempotencyKey: string;
  correlationId?: string;
}

export interface CreateCreditCardPurchaseFrontendResult {
  success: true;
  purchaseId: string;
  installmentIds: string[];
  invoiceIds: string[];
  ledgerEntryId: string;
  eventId: string;
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

const normalizeCategorySnapshot = (
  snapshot: CreateCreditCardPurchaseFrontendInput['categorySnapshot'] | null | undefined,
): CreateCreditCardPurchaseFrontendInput['categorySnapshot'] | undefined => {
  const label = normalizeOptionalString(snapshot?.label);

  if (!label) {
    return undefined;
  }

  return {
    id: normalizeOptionalString(snapshot?.id),
    label,
    normalizedLabel:
      normalizeOptionalString(snapshot?.normalizedLabel) ??
      label.toLowerCase(),
    icon: normalizeOptionalString(snapshot?.icon),
    color: normalizeOptionalString(snapshot?.color),
  };
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

const normalizeCreateCreditCardPurchasePayload = (
  payload: CreateCreditCardPurchaseFrontendInput,
): CreateCreditCardPurchaseFrontendInput => ({
  workspaceId: payload.workspaceId.trim(),
  cardId: payload.cardId.trim(),
  description: payload.description.trim(),
  categoryId: normalizeOptionalString(payload.categoryId),
  categorySnapshot: normalizeCategorySnapshot(payload.categorySnapshot),
  supplier: normalizeOptionalString(payload.supplier),
  costCenter: normalizeOptionalString(payload.costCenter),
  purchaseDate: payload.purchaseDate,
  totalAmount: Number(payload.totalAmount),
  installmentsCount: Number(payload.installmentsCount),
  amountType: payload.amountType,
  source: payload.source,
  idempotencyKey: payload.idempotencyKey,
  correlationId: normalizeOptionalString(payload.correlationId),
});

export const createCreditCardPurchase = async (
  payload: CreateCreditCardPurchaseFrontendInput,
): Promise<CreateCreditCardPurchaseFrontendResult> => {
  const callable = httpsCallable<
    CreateCreditCardPurchaseFrontendInput,
    CreateCreditCardPurchaseFrontendResult
  >(functions, 'createCreditCardPurchase');

  const normalizedPayload = stripEmptyOptionalFields(
    normalizeCreateCreditCardPurchasePayload(payload),
  );

  const result = await callable(normalizedPayload);

  return result.data;
};