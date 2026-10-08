import { versionOf } from '../clients/adapters.ts';
import { isDayKey } from '../loans/money.ts';
import type {
  CardEntryKind,
  CardEvent,
  CardInvoice,
  CardInvoiceEntry,
  CardPayment,
  CardPurchase,
  CardPurchaseSource,
  CreditCard,
  CreditCardBrand,
  CreditCardVisual,
} from './types.ts';

/**
 * Leitura dos documentos do domínio de cartões gravados pelo backend (P4-A).
 * Módulo puro.
 *
 * Um único formato é aceito — o autoritativo `schemaVersion: 1`, em
 * centavos inteiros. Documento fora dele (marca ausente, valor que não é
 * centavo inteiro, estado desconhecido, derivados incoerentes) devolve
 * `null`: a interface não o exibe nem o soma, em vez de "consertar" números
 * na tela. Não há leitor de formato antigo.
 */
export const CARDS_SCHEMA_VERSION = 1;

export const CARD_BRANDS: readonly CreditCardBrand[] = ['Visa', 'Mastercard', 'Elo', 'Amex'];

const ENTRY_KINDS: readonly CardEntryKind[] = [
  'installment', 'adjustment', 'refund_credit', 'carryover_in', 'carryover_out',
];
const PURCHASE_SOURCES: readonly CardPurchaseSource[] = ['manual', 'recurring', 'split'];

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const isCents = (value: unknown): value is number => Number.isSafeInteger(value);
const isPositiveCents = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
const isNonNegativeInt = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isDay = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 31;
const isMonthKey = (value: unknown): value is string =>
  typeof value === 'string' && MONTH_KEY.test(value);
const optionalText = (value: unknown): string | undefined =>
  isText(value) ? value : undefined;

const toVisual = (value: unknown): CreditCardVisual | null => {
  if (typeof value !== 'object' || value === null) return null;
  const visual = value as Record<string, unknown>;
  if (
    !['color', 'gradient', 'image'].includes(visual.bgType as string) ||
    typeof visual.bgColor !== 'string' || !HEX_COLOR.test(visual.bgColor) ||
    !['white', 'black'].includes(visual.textColor as string) ||
    typeof visual.showName !== 'boolean' ||
    typeof visual.showBrand !== 'boolean' ||
    typeof visual.showLogo !== 'boolean'
  ) {
    return null;
  }
  return {
    bgType: visual.bgType as CreditCardVisual['bgType'],
    bgColor: visual.bgColor,
    bgGradientColor: optionalText(visual.bgGradientColor),
    bgImage: optionalText(visual.bgImage),
    textColor: visual.textColor as CreditCardVisual['textColor'],
    showName: visual.showName,
    showBrand: visual.showBrand,
    showLogo: visual.showLogo,
  };
};

/** Cartão autoritativo, ou `null`. */
export const toCreditCard = (
  id: string,
  data: Record<string, unknown> | undefined,
): CreditCard | null => {
  if (!data || data.schemaVersion !== CARDS_SCHEMA_VERSION) return null;
  const version = versionOf(data.updatedAt);
  const visual = toVisual(data.visual);
  if (
    data.id !== id ||
    !isText(data.name) ||
    !CARD_BRANDS.includes(data.brand as CreditCardBrand) ||
    (data.status !== 'active' && data.status !== 'archived') ||
    !isPositiveCents(data.limitTotalCents) ||
    !isCents(data.limitUsedCents) ||
    data.limitAvailableCents !==
      (data.limitTotalCents as number) - (data.limitUsedCents as number) ||
    !isDay(data.closingDay) ||
    !isDay(data.dueDay) ||
    !(data.bestDay === null || isDay(data.bestDay)) ||
    !visual ||
    !version
  ) {
    return null;
  }
  return {
    id,
    name: data.name,
    brand: data.brand as CreditCardBrand,
    status: data.status,
    limitTotalCents: data.limitTotalCents,
    limitUsedCents: (data.limitUsedCents as number) || 0,
    limitAvailableCents: (data.limitAvailableCents as number) || 0,
    closingDay: data.closingDay,
    dueDay: data.dueDay,
    bestDay: isDay(data.bestDay) ? data.bestDay : undefined,
    observations: optionalText(data.observations),
    responsiblePerson: optionalText(data.responsiblePerson),
    recommendedUse: optionalText(data.recommendedUse),
    defaultCostCenter: optionalText(data.defaultCostCenter),
    visual,
    version,
  };
};

/** Compra autoritativa, ou `null`. */
export const toCardPurchase = (
  id: string,
  data: Record<string, unknown> | undefined,
): CardPurchase | null => {
  if (!data || data.schemaVersion !== CARDS_SCHEMA_VERSION) return null;
  const version = versionOf(data.updatedAt);
  if (
    data.id !== id ||
    !isText(data.cardId) ||
    !isText(data.description) ||
    !isText(data.category) ||
    !isDayKey(data.purchaseDate) ||
    !isPositiveCents(data.totalCents) ||
    !isPositiveCents(data.installmentsCount) ||
    !['active', 'cancelled', 'refunded'].includes(data.status as string) ||
    !PURCHASE_SOURCES.includes(data.source as CardPurchaseSource) ||
    !isNonNegativeInt(data.refundedCents) ||
    !isMonthKey(data.firstCompetence) ||
    !isText(data.createdBy) ||
    !version
  ) {
    return null;
  }
  return {
    id,
    cardId: data.cardId,
    description: data.description,
    category: data.category,
    supplier: optionalText(data.supplier),
    costCenter: optionalText(data.costCenter),
    purchaseDate: data.purchaseDate,
    totalCents: data.totalCents,
    installmentsCount: data.installmentsCount,
    status: data.status as CardPurchase['status'],
    source: data.source as CardPurchaseSource,
    refundedCents: data.refundedCents,
    firstCompetence: data.firstCompetence,
    retroactive: data.retroactive === true,
    createdBy: data.createdBy,
    version,
  };
};

const derivedPaymentStatus = (total: number, paid: number): CardInvoice['paymentStatus'] => {
  if (total - paid <= 0) return 'paid';
  return paid > 0 ? 'partial' : 'unpaid';
};

/** Fatura autoritativa (derivados coerentes), ou `null`. */
export const toCardInvoice = (
  id: string,
  data: Record<string, unknown> | undefined,
): CardInvoice | null => {
  if (!data || data.schemaVersion !== CARDS_SCHEMA_VERSION) return null;
  const version = versionOf(data.updatedAt);
  if (
    data.id !== id ||
    !isText(data.cardId) ||
    !isMonthKey(data.competenceMonth) ||
    !isDayKey(data.closingDate) ||
    !isDayKey(data.dueDate) ||
    (data.cycleStatus !== 'open' && data.cycleStatus !== 'closed') ||
    !isCents(data.totalCents) ||
    !isNonNegativeInt(data.paidCents) ||
    data.remainingCents !== (data.totalCents as number) - (data.paidCents as number) ||
    data.paymentStatus !==
      derivedPaymentStatus(data.totalCents as number, data.paidCents as number) ||
    !isNonNegativeInt(data.activeEntryCount) ||
    !version
  ) {
    return null;
  }
  return {
    id,
    cardId: data.cardId,
    competenceMonth: data.competenceMonth,
    closingDate: data.closingDate,
    dueDate: data.dueDate,
    cycleStatus: data.cycleStatus,
    paymentStatus: data.paymentStatus as CardInvoice['paymentStatus'],
    totalCents: (data.totalCents as number) || 0,
    paidCents: data.paidCents,
    remainingCents: (data.remainingCents as number) || 0,
    activeEntryCount: data.activeEntryCount,
    version,
  };
};

/** Lançamento de fatura autoritativo, ou `null`. */
export const toCardInvoiceEntry = (
  id: string,
  data: Record<string, unknown> | undefined,
): CardInvoiceEntry | null => {
  if (!data || data.schemaVersion !== CARDS_SCHEMA_VERSION) return null;
  if (
    data.id !== id ||
    !isText(data.cardId) ||
    !isText(data.invoiceId) ||
    !isMonthKey(data.competenceMonth) ||
    !ENTRY_KINDS.includes(data.kind as CardEntryKind) ||
    !isCents(data.amountCents) ||
    data.amountCents === 0 ||
    (data.status !== 'active' && data.status !== 'cancelled')
  ) {
    return null;
  }
  return {
    id,
    cardId: data.cardId,
    invoiceId: data.invoiceId,
    competenceMonth: data.competenceMonth,
    kind: data.kind as CardEntryKind,
    amountCents: data.amountCents,
    status: data.status,
    purchaseId: optionalText(data.purchaseId),
    installmentNumber: isPositiveCents(data.installmentNumber) ? data.installmentNumber : undefined,
    installmentsCount: isPositiveCents(data.installmentsCount) ? data.installmentsCount : undefined,
    naturalCompetence: isMonthKey(data.naturalCompetence) ? data.naturalCompetence : undefined,
    requestedCompetence: isMonthKey(data.requestedCompetence) ? data.requestedCompetence : undefined,
    reason: optionalText(data.reason),
  };
};

/** Pagamento (ou estorno de pagamento) autoritativo, ou `null`. */
export const toCardPayment = (
  id: string,
  data: Record<string, unknown> | undefined,
): CardPayment | null => {
  if (!data || data.schemaVersion !== CARDS_SCHEMA_VERSION) return null;
  if (
    data.id !== id ||
    !isText(data.cardId) ||
    !isText(data.invoiceId) ||
    (data.kind !== 'payment' && data.kind !== 'reversal') ||
    !isPositiveCents(data.amountCents) ||
    !isDayKey(data.paymentDate) ||
    !isText(data.cashAccountId)
  ) {
    return null;
  }
  return {
    id,
    cardId: data.cardId,
    invoiceId: data.invoiceId,
    kind: data.kind,
    amountCents: data.amountCents,
    paymentDate: data.paymentDate,
    cashAccountId: data.cashAccountId,
    reversalOf: optionalText(data.reversalOf),
    reversedBy: optionalText(data.reversedBy),
  };
};

/** Evento de auditoria (owner/admin), ou `null`. */
export const toCardEvent = (
  id: string,
  data: Record<string, unknown> | undefined,
): CardEvent | null => {
  if (!data || data.schemaVersion !== CARDS_SCHEMA_VERSION) return null;
  const occurredAt = data.occurredAt as { toMillis?: () => number } | undefined;
  if (
    !isText(data.cardId) ||
    !isText(data.operation) ||
    !isText(data.actorId) ||
    typeof occurredAt?.toMillis !== 'function'
  ) {
    return null;
  }
  return {
    id,
    cardId: data.cardId,
    operation: data.operation,
    actorId: data.actorId,
    amountCents: isCents(data.amountCents) ? data.amountCents : undefined,
    occurredAtMillis: occurredAt.toMillis(),
  };
};
