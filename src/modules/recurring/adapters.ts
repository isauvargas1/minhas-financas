import { versionOf } from '../clients/adapters.ts';
import { saoPauloToday } from '../loans/money.ts';
import { RECURRING_FREQUENCIES, isCivilDayKey, usesBillingDay } from './schedule.ts';
import type {
  AttentionCode,
  GeneratedFactState,
  OccurrenceStatus,
  RecurringAmountChange,
  RecurringBusinessDetails,
  RecurringBusinessType,
  RecurringExecutionMode,
  RecurringExpense,
  RecurringFrequency,
  RecurringOccurrence,
  RecurringPaymentMethod,
  RecurringStatus,
  RecurringType,
  RecurringVisual,
} from './types.ts';

/**
 * Leitura dos documentos de Recorrentes gravados pelo backend (P4-B).
 * Módulo puro.
 *
 * Um único formato é aceito — o autoritativo `schemaVersion: 1`, em
 * centavos inteiros e datas civis. Documento fora dele devolve `null`: a
 * interface não o exibe nem o soma. Não há leitor do formato anterior
 * (`valorPadrao`, `periodo`, `adjustments`, `competencia`).
 */
export const RECURRING_SCHEMA_VERSION = 1;

export const RECURRING_TYPES: readonly RecurringType[] =
  ['subscription', 'fixed_bill', 'service', 'other'];
export const RECURRING_PAYMENT_METHODS: readonly RecurringPaymentMethod[] =
  ['credit_card', 'pix', 'boleto', 'debit', 'cash', 'other'];
export const RECURRING_EXECUTION_MODES: readonly RecurringExecutionMode[] =
  ['automatic', 'confirmation_required'];
export const RECURRING_STATUSES: readonly RecurringStatus[] =
  ['active', 'paused', 'ended', 'cancelled'];
export const RECURRING_BUSINESS_TYPES: readonly RecurringBusinessType[] = [
  'saas', 'rent', 'internet', 'energy', 'water', 'accounting', 'taxes', 'services', 'other',
];
const OCCURRENCE_STATUSES: readonly OccurrenceStatus[] =
  ['awaiting_confirmation', 'generated', 'ignored', 'attention_required'];
const ATTENTION_CODES: readonly AttentionCode[] = [
  'card_unavailable', 'card_archived', 'limit_insufficient',
  'account_unavailable', 'account_archived', 'workspace_unavailable',
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const isNullableText = (value: unknown): value is string | null =>
  value === null || isText(value);
const isPositiveCents = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
const isNonNegativeInt = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isNullableDay = (value: unknown): value is string | null =>
  value === null || isCivilDayKey(value);
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  (values as readonly unknown[]).includes(value);

const toVisual = (value: unknown): RecurringVisual | null => {
  if (typeof value !== 'object' || value === null) return null;
  const visual = value as Record<string, unknown>;
  if (
    typeof visual.color !== 'string' || !HEX_COLOR.test(visual.color) ||
    !isText(visual.icon) || !isNullableText(visual.emoji)
  ) {
    return null;
  }
  return { color: visual.color, icon: visual.icon, emoji: visual.emoji };
};

const toBusiness = (value: unknown): RecurringBusinessDetails | null | undefined => {
  if (value === null) return null;
  if (typeof value !== 'object' || value === undefined) return undefined;
  const business = value as Record<string, unknown>;
  if (
    !isNullableText(business.supplier) ||
    !(business.businessType === null || isOneOf(RECURRING_BUSINESS_TYPES, business.businessType)) ||
    !isNullableText(business.costCenter) ||
    !isNullableText(business.responsible) ||
    !isNullableDay(business.adjustmentDate) ||
    !isNullableText(business.commitment)
  ) {
    return undefined;
  }
  return {
    supplier: business.supplier,
    businessType: business.businessType as RecurringBusinessType | null,
    costCenter: business.costCenter,
    responsible: business.responsible,
    adjustmentDate: business.adjustmentDate,
    commitment: business.commitment,
  };
};

/** Contrato autoritativo, ou `null` (as mesmas invariantes do backend). */
export const toRecurringExpense = (
  id: string,
  data: Record<string, unknown> | undefined,
): RecurringExpense | null => {
  if (!data || data.schemaVersion !== RECURRING_SCHEMA_VERSION) return null;
  const version = versionOf(data.updatedAt);
  const visual = toVisual(data.visual);
  const business = toBusiness(data.business);
  if (
    data.id !== id ||
    !isText(data.name) ||
    !isOneOf(RECURRING_TYPES, data.type) ||
    !isNullableText(data.description) ||
    !isPositiveCents(data.amountCents) ||
    data.currency !== 'BRL' ||
    !isOneOf(RECURRING_FREQUENCIES, data.frequency) ||
    !isCivilDayKey(data.startDate) ||
    !isNullableDay(data.endDate) ||
    !isOneOf(RECURRING_PAYMENT_METHODS, data.paymentMethod) ||
    !isOneOf(RECURRING_EXECUTION_MODES, data.executionMode) ||
    !isNullableText(data.cardId) ||
    !isNullableText(data.cashAccountId) ||
    !isText(data.categoryId) ||
    !isText(data.category) ||
    !isOneOf(RECURRING_STATUSES, data.status) ||
    !isNullableDay(data.nextDueDate) ||
    !isNullableDay(data.lastProcessedDueDate) ||
    !isNonNegativeInt(data.openOccurrenceCount) ||
    !visual ||
    business === undefined ||
    !isText(data.createdBy) ||
    !isPositiveCents(data.revision) ||
    !version
  ) {
    return null;
  }
  const frequency = data.frequency as RecurringFrequency;
  const monthly = usesBillingDay(frequency);
  const billingDay = data.billingDay;
  if (
    monthly
      ? !(Number.isSafeInteger(billingDay) && (billingDay as number) >= 1 && (billingDay as number) <= 31)
      : billingDay !== null
  ) {
    return null;
  }
  return {
    id,
    name: data.name,
    type: data.type,
    description: data.description,
    amountCents: data.amountCents,
    frequency,
    billingDay: monthly ? billingDay as number : null,
    startDate: data.startDate,
    endDate: data.endDate,
    paymentMethod: data.paymentMethod,
    executionMode: data.executionMode,
    cardId: data.cardId,
    cashAccountId: data.cashAccountId,
    categoryId: data.categoryId,
    category: data.category,
    status: data.status,
    nextDueDate: data.nextDueDate,
    lastProcessedDueDate: data.lastProcessedDueDate,
    openOccurrenceCount: data.openOccurrenceCount,
    visual,
    business,
    createdBy: data.createdBy,
    revision: data.revision as number,
    version,
  };
};

/** Ocorrência autoritativa, ou `null`. */
export const toRecurringOccurrence = (
  id: string,
  data: Record<string, unknown> | undefined,
): RecurringOccurrence | null => {
  if (!data || data.schemaVersion !== RECURRING_SCHEMA_VERSION) return null;
  if (
    data.id !== id ||
    !isText(data.recurringExpenseId) ||
    !isCivilDayKey(data.dueDate) ||
    data.competenceMonth !== data.dueDate.slice(0, 7) ||
    !isPositiveCents(data.plannedAmountCents) ||
    !(data.actualAmountCents === null || isPositiveCents(data.actualAmountCents)) ||
    !isOneOf(OCCURRENCE_STATUSES, data.status) ||
    (data.targetDomain !== 'cash' && data.targetDomain !== 'card') ||
    !isOneOf(RECURRING_EXECUTION_MODES, data.executionMode) ||
    !isNullableText(data.cardId) ||
    !isNullableText(data.cashAccountId) ||
    !isNullableText(data.cashTransactionId) ||
    !isNullableText(data.cardPurchaseId) ||
    !(data.attentionCode === null || isOneOf(ATTENTION_CODES, data.attentionCode)) ||
    !(data.settlement === null || data.settlement === 'pending' || data.settlement === 'paid')
  ) {
    return null;
  }
  return {
    id,
    recurringExpenseId: data.recurringExpenseId,
    dueDate: data.dueDate,
    competenceMonth: data.competenceMonth as string,
    plannedAmountCents: data.plannedAmountCents,
    actualAmountCents: data.actualAmountCents as number | null,
    status: data.status,
    targetDomain: data.targetDomain,
    executionMode: data.executionMode,
    cardId: data.cardId,
    cashAccountId: data.cashAccountId,
    cashTransactionId: data.cashTransactionId,
    cardPurchaseId: data.cardPurchaseId,
    attentionCode: data.attentionCode as AttentionCode | null,
    settlement: data.settlement as 'pending' | 'paid' | null,
  };
};

/** Alteração de valor da trilha (criação ou edição com `amountCents`), ou `null`. */
export const toAmountChange = (
  id: string,
  data: Record<string, unknown> | undefined,
): RecurringAmountChange | null => {
  if (!data || data.schemaVersion !== RECURRING_SCHEMA_VERSION || data.amountChanged !== true) {
    return null;
  }
  const occurredAt = data.occurredAt as { seconds?: unknown } | null | undefined;
  const after = data.after as Record<string, unknown> | null;
  const before = data.before as Record<string, unknown> | null;
  if (
    !occurredAt || typeof occurredAt.seconds !== 'number' ||
    !after || !isPositiveCents(after.amountCents)
  ) {
    return null;
  }
  const previous = before && isPositiveCents(before.amountCents) ? before.amountCents : null;
  return {
    id,
    date: saoPauloToday(new Date(occurredAt.seconds * 1000)),
    previousCents: previous,
    nextCents: after.amountCents,
    reason: isText(data.reason) ? data.reason : null,
  };
};

/** Estado atual do lançamento de caixa gerado, ou `null`. */
export const toCashFactState = (
  data: Record<string, unknown> | undefined,
): GeneratedFactState | null => {
  if (!data) return null;
  const marker = data.cashEntry as Record<string, unknown> | undefined;
  if (!marker || marker.origin !== 'recurring' || !isPositiveCents(data.valueCents)) return null;
  const status = marker.status;
  if (status !== 'pending' && status !== 'confirmed' && status !== 'voided') return null;
  return { domain: 'cash', status, amountCents: data.valueCents };
};

/** Estado atual da compra de cartão gerada, ou `null`. */
export const toCardFactState = (
  data: Record<string, unknown> | undefined,
): GeneratedFactState | null => {
  if (!data || data.source !== 'recurring' || !isPositiveCents(data.totalCents)) return null;
  const status = data.status;
  if (status !== 'active' && status !== 'cancelled' && status !== 'refunded') return null;
  return { domain: 'card', status, amountCents: data.totalCents };
};
