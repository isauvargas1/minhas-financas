import type { Transaction } from '../../types.ts';

/**
 * Valor da transação em reais, só para apresentação. A fonte é `valueCents`
 * (inteiro); o resultado nunca é regravado nem usado para somar.
 */
export const transactionAmount = (transaction: Pick<Transaction, 'valueCents'>): number =>
  transaction.valueCents / 100;
