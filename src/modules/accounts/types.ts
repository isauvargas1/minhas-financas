/**
 * Modelo de leitura de contas/carteiras, movimentos e transferências
 * (D-30, P3-J), tal como o backend grava (`schemaVersion: 1`). Valores em
 * centavos inteiros; datas civis `YYYY-MM-DD` em São Paulo.
 */
export type CashAccountType = 'cash' | 'checking' | 'savings' | 'digital' | 'other';
export type CashAccountStatus = 'active' | 'archived';

export interface CashAccount {
  id: string;
  name: string;
  accountType: CashAccountType;
  status: CashAccountStatus;
  /** Saldo autoritativo em centavos (pode ser negativo). */
  balanceCents: number;
  /** Versão (`updatedAt`) para editar, arquivar e reativar. */
  version: string;
}

export type CashAccountMovementKind =
  | 'opening_balance'
  | 'cash_transaction'
  | 'loan'
  | 'receivable'
  | 'credit_card_payment'
  | 'split'
  | 'investment'
  | 'transfer_in'
  | 'transfer_out'
  | 'reversal';

export type CashAccountSourceDomain =
  | 'account'
  | 'cash'
  | 'loan'
  | 'receivable'
  | 'credit_card'
  | 'split'
  | 'investment'
  | 'transfer';

export interface CashAccountMovement {
  id: string;
  accountId: string;
  kind: CashAccountMovementKind;
  /** Centavos com sinal: entrada positiva, saída negativa. */
  amountCents: number;
  effectiveDate: string;
  sourceDomain: CashAccountSourceDomain;
  sourceId: string;
  reversalOf: string | null;
}

export type CashTransferStatus = 'completed' | 'reversed';

export interface CashTransfer {
  id: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amountCents: number;
  date: string;
  description?: string;
  status: CashTransferStatus;
  createdBy: string;
  version: string;
  reversalReason?: string;
}
