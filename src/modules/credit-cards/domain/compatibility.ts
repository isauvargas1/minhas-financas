import type {
  IsoDateString,
  MoneyAmount,
} from './types.ts';

import {
  isPositiveMoneyAmount,
  isValidIsoDateString,
} from './invariants.ts';

export type LegacyCreditCardTransactionType = 'parcelado';

export type LegacyCreditCardTransactionMode =
  | 'active_legacy'
  | 'read_only'
  | 'reconciled'
  | 'ignored';

export type LegacyCreditCardTransactionClassification =
  | 'eligible_for_migration'
  | 'already_migrated'
  | 'not_credit_card_installment'
  | 'missing_workspace'
  | 'missing_card'
  | 'invalid_amount'
  | 'invalid_date'
  | 'invalid_installments'
  | 'invalid_current_installment';

export type CreditCardFinancialViewMode =
  | 'legacy_compatibility'
  | 'invoice_domain'
  | 'cash_basis'
  | 'competence_basis';

  export type LegacyCreditCardDataStrategy =
  | 'empty_database_no_data_migration'
  | 'compatibility_only'
  | 'legacy_data_migration_required';

export interface LegacyCreditCardTransactionSnapshot {
  id: string;
  workspaceId?: string;
  profileId?: string;
  userId?: string;

  type?: string;
  description?: string;
  category?: string;

  value?: MoneyAmount;
  date?: IsoDateString;

  cardId?: string | number;
  installments?: number;
  currentInstallment?: number;
  isPaid?: boolean;

  supplier?: string;
  costCenter?: string;

  legacyMigrated?: boolean;
  legacyPurchaseId?: string;
  legacyInvoiceId?: string;
  legacyMode?: LegacyCreditCardTransactionMode;
  migrationBatchId?: string;
}

export interface LegacyCreditCardTransactionCompatibilityFlags {
  isLegacyCreditCardInstallment: boolean;
  isEligibleForMigration: boolean;
  shouldRemainVisibleInLegacyLists: boolean;
  shouldBeIgnoredByNewInvoiceDomain: boolean;
  shouldBeReadOnlyAfterMigration: boolean;
  preventsDoubleCounting: boolean;
  classification: LegacyCreditCardTransactionClassification;
}

export interface LegacyCreditCardCompatibilityPolicy {
  legacyCollectionName: 'transactions';
  legacyInstallmentType: LegacyCreditCardTransactionType;
  migratedMode: Extract<LegacyCreditCardTransactionMode, 'read_only' | 'reconciled'>;
  dataStrategy: LegacyCreditCardDataStrategy;
  preserveLegacyTransactionsDuringRollout: boolean;
  preventHardDeleteAfterMigration: boolean;
  preventDoubleCountingAfterMigration: boolean;
  requiresDataMigrationBeforeRollout: boolean;
}

export const CREDIT_CARD_LEGACY_COMPATIBILITY_POLICY: LegacyCreditCardCompatibilityPolicy = {
  legacyCollectionName: 'transactions',
  legacyInstallmentType: 'parcelado',
  migratedMode: 'read_only',
  dataStrategy: 'empty_database_no_data_migration',
  preserveLegacyTransactionsDuringRollout: true,
  preventHardDeleteAfterMigration: true,
  preventDoubleCountingAfterMigration: true,
  requiresDataMigrationBeforeRollout: false,
};

export const normalizeLegacyCardId = (
  cardId: LegacyCreditCardTransactionSnapshot['cardId']
): string | undefined => {
  if (cardId === undefined || cardId === null) return undefined;

  const normalizedCardId = String(cardId).trim();

  return normalizedCardId.length > 0 ? normalizedCardId : undefined;
};

export const isLegacyCreditCardInstallmentTransaction = (
  transaction: LegacyCreditCardTransactionSnapshot
): boolean =>
  transaction.type === CREDIT_CARD_LEGACY_COMPATIBILITY_POLICY.legacyInstallmentType &&
  normalizeLegacyCardId(transaction.cardId) !== undefined;

export const classifyLegacyCreditCardTransaction = (
  transaction: LegacyCreditCardTransactionSnapshot
): LegacyCreditCardTransactionClassification => {
  if (transaction.legacyMigrated || transaction.legacyPurchaseId || transaction.legacyMode === 'read_only') {
    return 'already_migrated';
  }

  if (!isLegacyCreditCardInstallmentTransaction(transaction)) {
    return 'not_credit_card_installment';
  }

  if (!transaction.workspaceId && !transaction.profileId) {
    return 'missing_workspace';
  }

  if (!normalizeLegacyCardId(transaction.cardId)) {
    return 'missing_card';
  }

  if (transaction.value === undefined || !isPositiveMoneyAmount(transaction.value)) {
    return 'invalid_amount';
  }

  if (!transaction.date || !isValidIsoDateString(transaction.date)) {
    return 'invalid_date';
  }

  if (!Number.isInteger(transaction.installments) || Number(transaction.installments) < 1) {
    return 'invalid_installments';
  }

  if (!Number.isInteger(transaction.currentInstallment) || Number(transaction.currentInstallment) < 1) {
    return 'invalid_current_installment';
  }

  if (Number(transaction.currentInstallment) > Number(transaction.installments)) {
    return 'invalid_current_installment';
  }

  return 'eligible_for_migration';
};

export const buildLegacyCreditCardTransactionCompatibilityFlags = (
  transaction: LegacyCreditCardTransactionSnapshot
): LegacyCreditCardTransactionCompatibilityFlags => {
  const classification = classifyLegacyCreditCardTransaction(transaction);
  const isLegacyCreditCardInstallment = isLegacyCreditCardInstallmentTransaction(transaction);
  const isAlreadyMigrated = classification === 'already_migrated';
  const isEligibleForMigration = classification === 'eligible_for_migration';

  return {
    isLegacyCreditCardInstallment,
    isEligibleForMigration,
    shouldRemainVisibleInLegacyLists: isLegacyCreditCardInstallment && !isAlreadyMigrated,
    shouldBeIgnoredByNewInvoiceDomain: !isEligibleForMigration,
    shouldBeReadOnlyAfterMigration: isAlreadyMigrated,
    preventsDoubleCounting: isAlreadyMigrated,
    classification,
  };
};

export const shouldLegacyTransactionBeVisibleInPrimaryExpenseList = (
  transaction: LegacyCreditCardTransactionSnapshot,
  viewMode: CreditCardFinancialViewMode
): boolean => {
  const flags = buildLegacyCreditCardTransactionCompatibilityFlags(transaction);

  if (!flags.isLegacyCreditCardInstallment) return true;

  if (viewMode === 'legacy_compatibility') {
    return flags.shouldRemainVisibleInLegacyLists;
  }

  if (viewMode === 'invoice_domain') {
    return false;
  }

  if (viewMode === 'cash_basis') {
    return false;
  }

  return !flags.preventsDoubleCounting;
};

export const shouldLegacyTransactionBeIncludedInReports = (
  transaction: LegacyCreditCardTransactionSnapshot,
  viewMode: CreditCardFinancialViewMode
): boolean => {
  const flags = buildLegacyCreditCardTransactionCompatibilityFlags(transaction);

  if (!flags.isLegacyCreditCardInstallment) return true;

  if (viewMode === 'legacy_compatibility') {
    return flags.shouldRemainVisibleInLegacyLists;
  }

  if (viewMode === 'competence_basis') {
    return !flags.preventsDoubleCounting;
  }

  if (viewMode === 'invoice_domain') {
    return false;
  }

  if (viewMode === 'cash_basis') {
    return false;
  }

  return false;
};

export const shouldLegacyTransactionBeEligibleForMigration = (
  transaction: LegacyCreditCardTransactionSnapshot
): boolean =>
  classifyLegacyCreditCardTransaction(transaction) === 'eligible_for_migration';

export const buildLegacyMigrationGroupingKey = (
  transaction: LegacyCreditCardTransactionSnapshot
): string => {
  const workspaceId = transaction.workspaceId ?? transaction.profileId ?? 'unknown_workspace';
  const cardId = normalizeLegacyCardId(transaction.cardId) ?? 'unknown_card';
  const description = transaction.description?.trim().toLowerCase() ?? 'unknown_description';
  const category = transaction.category?.trim().toLowerCase() ?? 'unknown_category';
  const installments = transaction.installments ?? 'unknown_installments';

  return [
    workspaceId,
    cardId,
    description,
    category,
    installments,
  ].join('__');
};

export const shouldRunLegacyCreditCardDataMigration = (
  policy: LegacyCreditCardCompatibilityPolicy = CREDIT_CARD_LEGACY_COMPATIBILITY_POLICY
): boolean => policy.requiresDataMigrationBeforeRollout;

export const canStartInvoiceDomainWithoutLegacyDataMigration = (
  policy: LegacyCreditCardCompatibilityPolicy = CREDIT_CARD_LEGACY_COMPATIBILITY_POLICY
): boolean =>
  policy.dataStrategy === 'empty_database_no_data_migration' &&
  policy.requiresDataMigrationBeforeRollout === false;