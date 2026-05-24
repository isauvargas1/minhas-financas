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

  export const isCreditCardInvoicePaymentReversalCashTransaction = (
  transaction: Transaction
): boolean =>
  transaction.source === 'credit_card_invoice_payment_reversal' ||
  (
    Boolean(transaction.creditCardInvoicePaymentId) &&
    transaction.type === 'receita' &&
    transaction.description.toLowerCase().includes('estorno')
  );

const getCreditCardInvoicePaymentPairKey = (
  transaction: Transaction
): string | undefined => {
  if (!isCreditCardInvoicePaymentCashTransaction(transaction)) {
    return undefined;
  }

  return transaction.creditCardInvoicePaymentId;
};

export const filterReversedCreditCardInvoicePaymentCashTransactions = (
  transactions: Transaction[]
): Transaction[] => {
  const reversedPaymentIds = new Set(
    transactions
      .filter(isCreditCardInvoicePaymentReversalCashTransaction)
      .map(getCreditCardInvoicePaymentPairKey)
      .filter((paymentId): paymentId is string => Boolean(paymentId))
  );

  if (reversedPaymentIds.size === 0) {
    return transactions;
  }

  return transactions.filter((transaction) => {
    const paymentId = getCreditCardInvoicePaymentPairKey(transaction);

    return !paymentId || !reversedPaymentIds.has(paymentId);
  });
};

export const isCreditCardInvoiceCompatibleTransaction = (
  transaction: Transaction
): transaction is CreditCardInvoiceCompatibleTransaction =>
  transaction.creditCardCompatibility?.source === 'credit_card_invoice';

  export const getCreditCardInvoiceStatusLabel = (
  status: CreditCardInvoiceStatus
): string => {
  const labels: Record<CreditCardInvoiceStatus, string> = {
    open: 'Aberta',
    closed: 'Fechada',
    partial_paid: 'Parcial',
    paid: 'Paga',
    overdue: 'Vencida',
    cancelled: 'Cancelada',
  };

  return labels[status];
};

export const getCreditCardInvoiceBadgeLabel = (
  status: CreditCardInvoiceStatus
): string => `Fatura ${getCreditCardInvoiceStatusLabel(status)}`;

export const getCreditCardInvoiceBadgeClassName = (
  status: CreditCardInvoiceStatus
): string => {
  const classNames: Record<CreditCardInvoiceStatus, string> = {
    open: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    closed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    partial_paid: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    paid: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    overdue: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  };

  return classNames[status];
};

export const getCreditCardInvoiceSecondaryText = (
  transaction: CreditCardInvoiceCompatibleTransaction
): string => {
  const statusLabel = getCreditCardInvoiceStatusLabel(
    transaction.creditCardCompatibility.invoiceStatus
  );

  return `Fatura do cartão · ${statusLabel} · Competência ${transaction.creditCardCompatibility.competenceMonth}`;
};

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