import type {
  CardEventLog,
  CardLimitLedger,
  CreditCardCategorySnapshot,
  CreditCardInstallment,
  CreditCardInvoice,
  CreditCardInvoicePayment,
  CreditCardPurchase,
  CreditCardPurchaseAmountType,
  CreditCardPurchaseSource,
  CreditCardPurchaseStatus,
  IsoDateString,
  MoneyAmount,
} from './types.ts';

export type CreditCardUseCaseRole =
  | 'owner'
  | 'admin'
  | 'member'
  | 'viewer'
  | 'system';

export type CreditCardUseCaseSeverity =
  | 'error'
  | 'warning';

export interface CreditCardUseCaseActor {
  actorId: string;
  workspaceId: string;
  role: CreditCardUseCaseRole;
}

export interface CreditCardUseCaseIssue {
  code: string;
  message: string;
  field?: string;
  severity: CreditCardUseCaseSeverity;
}

export interface CreditCardUseCaseContext {
  workspaceId: string;
  actor: CreditCardUseCaseActor;
  idempotencyKey: string;
  correlationId?: string;
  requestedAt?: IsoDateString;
}

export interface CreditCardUseCaseResult<TData> {
  success: boolean;
  data?: TData;
  issues: CreditCardUseCaseIssue[];
  events?: CardEventLog[];
}

export interface CreateCreditCardPurchaseInput extends CreditCardUseCaseContext {
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

  source: CreditCardPurchaseSource;
}

export interface CreateCreditCardPurchaseOutput {
  purchase: CreditCardPurchase;
  installments: CreditCardInstallment[];
  invoices: CreditCardInvoice[];
  limitLedgerEntry: CardLimitLedger;
}

export interface UpdateCreditCardPurchaseInput extends CreditCardUseCaseContext {
  purchaseId: string;
  cardId: string;

  description?: string;
  categoryId?: string;
  categorySnapshot?: CreditCardCategorySnapshot;

  supplier?: string;
  costCenter?: string;

  purchaseDate?: IsoDateString;
  totalAmount?: MoneyAmount;
  installmentsCount?: number;
  amountType?: CreditCardPurchaseAmountType;

  reason: string;
  rebuildInstallments: boolean;
}

export interface UpdateCreditCardPurchaseOutput {
  purchase: CreditCardPurchase;
  installments: CreditCardInstallment[];
  affectedInvoices: CreditCardInvoice[];
  limitLedgerEntries: CardLimitLedger[];
}

export type CancelCreditCardPurchasePolicy =
  | 'only_if_all_installments_open'
  | 'allow_reversal_entries'
  | 'block_if_invoice_paid';

export interface CancelCreditCardPurchaseInput extends CreditCardUseCaseContext {
  purchaseId: string;
  cardId: string;
  reason: string;
  policy: CancelCreditCardPurchasePolicy;
}

export interface CancelCreditCardPurchaseOutput {
  purchase: CreditCardPurchase;
  cancelledInstallments: CreditCardInstallment[];
  affectedInvoices: CreditCardInvoice[];
  limitLedgerEntries: CardLimitLedger[];
}

export interface RebuildInstallmentsForPurchaseInput extends CreditCardUseCaseContext {
  purchase: CreditCardPurchase;
  existingInstallments?: CreditCardInstallment[];
  preservePaidInstallments: boolean;
  reason: string;
}

export interface RebuildInstallmentsForPurchaseOutput {
  purchase: CreditCardPurchase;
  previousInstallments: CreditCardInstallment[];
  rebuiltInstallments: CreditCardInstallment[];
  affectedInvoices: CreditCardInvoice[];
}

export interface AttachInstallmentsToInvoicesInput extends CreditCardUseCaseContext {
  cardId: string;
  installments: CreditCardInstallment[];
}

export interface AttachInstallmentsToInvoicesOutput {
  invoices: CreditCardInvoice[];
  installments: CreditCardInstallment[];
}

export interface CloseCreditCardInvoiceInput extends CreditCardUseCaseContext {
  invoiceId: string;
  cardId: string;
  closedAt: IsoDateString;
}

export interface CloseCreditCardInvoiceOutput {
  invoice: CreditCardInvoice;
  installments: CreditCardInstallment[];
}

export type ReopenCreditCardInvoicePolicy =
  | 'only_if_unpaid'
  | 'allow_if_partial_paid_with_audit'
  | 'block_if_paid';

export interface ReopenCreditCardInvoiceInput extends CreditCardUseCaseContext {
  invoiceId: string;
  cardId: string;
  reason: string;
  policy: ReopenCreditCardInvoicePolicy;
}

export interface ReopenCreditCardInvoiceOutput {
  invoice: CreditCardInvoice;
}

export interface RegisterCreditCardInvoicePaymentInput extends CreditCardUseCaseContext {
  invoiceId: string;
  cardId: string;

  paymentDate: IsoDateString;
  amount: MoneyAmount;

  walletId?: string;
  cashAccountId?: string;
  paymentMethod: CreditCardInvoicePayment['paymentMethod'];
}

export interface RegisterCreditCardInvoicePaymentOutput {
  payment: CreditCardInvoicePayment;
  invoice: CreditCardInvoice;
  limitLedgerEntry: CardLimitLedger;
  cashTransactionId?: string;
}

export interface ReverseCreditCardInvoicePaymentInput extends CreditCardUseCaseContext {
  paymentId: string;
  invoiceId: string;
  cardId: string;
  reason: string;
  reversedAt: IsoDateString;
}

export interface ReverseCreditCardInvoicePaymentOutput {
  payment: CreditCardInvoicePayment;
  invoice: CreditCardInvoice;
  limitLedgerEntry: CardLimitLedger;
  cashReversalTransactionId?: string;
}

export interface RecalculateCardLimitInput extends CreditCardUseCaseContext {
  cardId: string;
  reason: string;
}

export interface RecalculateCardLimitOutput {
  cardId: string;
  workspaceId: string;
  limitTotal: MoneyAmount;
  limitUsed: MoneyAmount;
  limitAvailable: MoneyAmount;
  ledgerEntriesCount: number;
}

export interface RebuildCardInvoicesForCardInput extends CreditCardUseCaseContext {
  cardId: string;
  fromCompetenceMonth?: string;
  toCompetenceMonth?: string;
  reason: string;
}

export interface RebuildCardInvoicesForCardOutput {
  invoices: CreditCardInvoice[];
  installments: CreditCardInstallment[];
}

export interface LegacyInstallmentTransactionSnapshot {
  id: string;
  workspaceId: string;
  cardId: string;
  description: string;
  category?: string;
  value: MoneyAmount;
  date: IsoDateString;
  installments: number;
  currentInstallment: number;
  isPaid?: boolean;
  supplier?: string;
  costCenter?: string;
}

export interface MigrateLegacyInstallmentsToInvoiceDomainInput extends CreditCardUseCaseContext {
  cardId?: string;
  transactionIds?: string[];
  dryRun: boolean;
  migrationBatchId: string;
}

export interface MigrateLegacyInstallmentsToInvoiceDomainOutput {
  migrationBatchId: string;
  dryRun: boolean;

  purchases: CreditCardPurchase[];
  installments: CreditCardInstallment[];
  invoices: CreditCardInvoice[];
  ledgerEntries: CardLimitLedger[];

  migratedTransactionIds: string[];
  skippedTransactionIds: string[];

  inconsistencies: CreditCardUseCaseIssue[];
}

export interface ChangeCreditCardPurchaseStatusInput extends CreditCardUseCaseContext {
  purchaseId: string;
  cardId: string;
  fromStatus: CreditCardPurchaseStatus;
  toStatus: CreditCardPurchaseStatus;
  reason: string;
}

export interface ChangeCreditCardPurchaseStatusOutput {
  purchase: CreditCardPurchase;
}