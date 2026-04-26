export type IsoDateString = string;
export type CompetenceMonth = string;
export type MoneyAmount = number;

export type CreditCardBillingCycleStatus =
  | 'idle'
  | 'open'
  | 'closing'
  | 'closed'
  | 'overdue';

export type CreditCardPurchaseAmountType =
  | 'total'
  | 'installment';

export type CreditCardPurchaseSource =
  | 'manual'
  | 'recurring'
  | 'split'
  | 'migration';

export type CreditCardPurchaseStatus =
  | 'active'
  | 'cancelled'
  | 'partially_reversed'
  | 'fully_reversed';

export type CreditCardInstallmentStatus =
  | 'projected'
  | 'invoiced'
  | 'paid'
  | 'cancelled'
  | 'reversed';

export type CreditCardInvoiceStatus =
  | 'open'
  | 'closed'
  | 'partial_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled';

export type CreditCardInvoicePaymentStatus =
  | 'posted'
  | 'reversed';

export type CreditCardInvoicePaymentMethod =
  | 'wallet'
  | 'cash_account'
  | 'manual_adjustment'
  | 'external';

export type CardLimitLedgerSourceType =
  | 'purchase'
  | 'payment'
  | 'reversal'
  | 'manual_adjustment'
  | 'migration';

export type CardLimitLedgerDirection =
  | 'consume'
  | 'restore';

export type CardEventType =
  | 'purchase_created'
  | 'purchase_updated'
  | 'purchase_cancelled'
  | 'purchase_reversed'
  | 'installments_rebuilt'
  | 'installment_attached_to_invoice'
  | 'invoice_created'
  | 'invoice_closed'
  | 'invoice_reopened'
  | 'invoice_payment_posted'
  | 'invoice_payment_reversed'
  | 'limit_consumed'
  | 'limit_restored'
  | 'legacy_migrated'
  | 'reconciliation_warning';

export interface CreditCardCategorySnapshot {
  id?: string;
  label: string;
  normalizedLabel?: string;
  icon?: string;
  color?: string;
}

export interface CreditCardDomainTimestamps {
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CreditCardPurchase extends CreditCardDomainTimestamps {
  id: string;
  workspaceId: string;
  cardId: string;

  description: string;
  categoryId?: string;
  categorySnapshot?: CreditCardCategorySnapshot;

  supplier?: string;
  costCenter?: string;

  purchaseDate: IsoDateString;
  totalAmount: MoneyAmount;
  installmentsCount: number;
  amountType: CreditCardPurchaseAmountType;
  firstInvoiceCompetence: CompetenceMonth;

  source: CreditCardPurchaseSource;
  status: CreditCardPurchaseStatus;

  createdBy: string;
  updatedBy?: string;

  idempotencyKey?: string;

  legacyTransactionIds?: string[];
  legacyMigrated?: boolean;
  legacyMode?: 'read_only' | 'reconciled';
}

export interface CreditCardInstallment extends CreditCardDomainTimestamps {
  id: string;
  workspaceId: string;
  purchaseId: string;
  cardId: string;

  installmentNumber: number;
  installmentsCount: number;
  amount: MoneyAmount;

  competenceMonth: CompetenceMonth;
  invoiceId?: string;
  dueDate: IsoDateString;

  status: CreditCardInstallmentStatus;
  paidAmount: MoneyAmount;

  legacyTransactionId?: string;
}

export interface CreditCardInvoice extends CreditCardDomainTimestamps {
  id: string;
  workspaceId: string;
  cardId: string;

  competenceMonth: CompetenceMonth;
  closingDate: IsoDateString;
  dueDate: IsoDateString;

  status: CreditCardInvoiceStatus;

  totalAmount: MoneyAmount;
  paidAmount: MoneyAmount;
  remainingAmount: MoneyAmount;
  itemsCount: number;

  paymentStatusDerived:
    | 'unpaid'
    | 'partial'
    | 'paid'
    | 'overpaid';

  generatedAt?: unknown;
  closedAt?: unknown;
}

export interface CreditCardInvoicePayment extends CreditCardDomainTimestamps {
  id: string;
  workspaceId: string;
  cardId: string;
  invoiceId: string;

  paymentDate: IsoDateString;
  amount: MoneyAmount;

  walletId?: string;
  cashAccountId?: string;
  paymentMethod: CreditCardInvoicePaymentMethod;

  status: CreditCardInvoicePaymentStatus;
  idempotencyKey: string;

  createdBy: string;
  reversedBy?: string;
  reversedAt?: unknown;
  reversalReason?: string;
}

export interface CardLimitLedger {
  id: string;
  workspaceId: string;
  cardId: string;

  sourceType: CardLimitLedgerSourceType;
  sourceId: string;

  direction: CardLimitLedgerDirection;
  amount: MoneyAmount;
  balanceAfter: MoneyAmount;

  createdAt: unknown;
  actorId: string;

  idempotencyKey?: string;
}

export interface CardEventLog {
  id: string;
  workspaceId: string;
  cardId: string;

  eventType: CardEventType;

  purchaseId?: string;
  installmentId?: string;
  invoiceId?: string;
  paymentId?: string;
  ledgerEntryId?: string;

  payload?: Record<string, unknown>;

  correlationId?: string;
  idempotencyKey?: string;

  createdAt: unknown;
  actorId?: string;
}

export interface CreditCardInvoiceProjection {
  id: string;
  workspaceId: string;
  cardId: string;

  competenceMonth: CompetenceMonth;
  dueDate: IsoDateString;
  status: CreditCardInvoiceStatus;

  totalAmount: MoneyAmount;
  paidAmount: MoneyAmount;
  remainingAmount: MoneyAmount;

  cardName?: string;
  cardBrand?: string;
}

export interface CreditCardLimitSnapshot {
  workspaceId: string;
  cardId: string;

  limitTotal: MoneyAmount;
  limitUsed: MoneyAmount;
  limitAvailable: MoneyAmount;

  updatedAt: unknown;
}