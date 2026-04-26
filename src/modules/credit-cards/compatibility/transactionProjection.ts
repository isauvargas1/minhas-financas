import type { Transaction } from '../../../types';
import type {
  CreditCardInvoiceProjection,
  CreditCardInvoiceStatus,
} from '../domain/types.ts';

export interface CreditCardTransactionProjectionOptions {
  hideLegacyCardInstallments?: boolean;
  hideCreditCardInvoicePaymentCashTransactions?: boolean;
}

export type CreditCardInvoiceCompatibleTransaction = Transaction & {
  creditCardCompatibility: {
    source: 'credit_card_invoice';
    invoiceId: string;
    cardId: string;
    competenceMonth: string;
    invoiceStatus: CreditCardInvoiceStatus;
    isProjection: true;
  };
};

const CREDIT_CARD_INVOICE_TRANSACTION_ID_PREFIX = 'credit-card-invoice';

const normalizeMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const buildInvoiceDescription = (
  invoice: CreditCardInvoiceProjection
): string => {
  const cardLabel = invoice.cardName?.trim() || 'Cartão';
  return `Fatura ${cardLabel} - ${invoice.competenceMonth}`;
};

export const isLegacyCreditCardInstallmentTransaction = (
  transaction: Transaction
): boolean =>
  transaction.type === 'parcelado' &&
  Boolean(transaction.cardId) &&
  Boolean(transaction.installments);

export const isCreditCardInvoicePaymentCashTransaction = (
  transaction: Transaction
): boolean =>
  transaction.source === 'credit_card_invoice_payment' ||
  Boolean(transaction.creditCardInvoicePaymentId);

export const isCreditCardInvoiceCompatibleTransaction = (
  transaction: Transaction
): transaction is CreditCardInvoiceCompatibleTransaction =>
  transaction.creditCardCompatibility?.source === 'credit_card_invoice';

export const buildCreditCardInvoiceTransactionProjection = (
  invoice: CreditCardInvoiceProjection
): CreditCardInvoiceCompatibleTransaction => {
  const value = normalizeMoney(invoice.totalAmount);

  return {
    id: `${CREDIT_CARD_INVOICE_TRANSACTION_ID_PREFIX}:${invoice.id}`,
    type: 'parcelado',
    description: buildInvoiceDescription(invoice),
    category: 'Fatura de cartão',
    value,
    date: invoice.dueDate,
    cardId: invoice.cardId,
    workspaceId: invoice.workspaceId,
    profileId: invoice.workspaceId,
    isPaid: invoice.status === 'paid',
    source: 'credit_card_invoice_projection',
    creditCardInvoiceId: invoice.id,
    creditCardCompatibility: {
      source: 'credit_card_invoice',
      invoiceId: invoice.id,
      cardId: invoice.cardId,
      competenceMonth: invoice.competenceMonth,
      invoiceStatus: invoice.status,
      isProjection: true,
    },
  };
};

export const buildCreditCardInvoiceTransactionProjections = (
  invoices: CreditCardInvoiceProjection[]
): CreditCardInvoiceCompatibleTransaction[] =>
  invoices.map(buildCreditCardInvoiceTransactionProjection);

export const filterTransactionsForCreditCardCompatibility = (
  transactions: Transaction[],
  options: CreditCardTransactionProjectionOptions = {}
): Transaction[] =>
  transactions.filter((transaction) => {
    if (
      options.hideLegacyCardInstallments &&
      isLegacyCreditCardInstallmentTransaction(transaction)
    ) {
      return false;
    }

    if (
      options.hideCreditCardInvoicePaymentCashTransactions &&
      isCreditCardInvoicePaymentCashTransaction(transaction)
    ) {
      return false;
    }

    return true;
  });

export const mergeTransactionsWithCreditCardInvoiceProjections = (
  transactions: Transaction[],
  invoices: CreditCardInvoiceProjection[],
  options: CreditCardTransactionProjectionOptions = {}
): Transaction[] => {
  const invoiceTransactions = buildCreditCardInvoiceTransactionProjections(invoices);
  const invoiceTransactionIds = new Set(
    invoiceTransactions.map((transaction) => String(transaction.id))
  );

  const compatibleTransactions = filterTransactionsForCreditCardCompatibility(
    transactions,
    options
  ).filter((transaction) => !invoiceTransactionIds.has(String(transaction.id)));

  return [...compatibleTransactions, ...invoiceTransactions].sort((left, right) =>
    right.date.localeCompare(left.date)
  );
};