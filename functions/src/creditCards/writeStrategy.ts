export type CreditCardBackendWriteOperation =
  | "createCreditCardPurchase"
  | "updateCreditCardPurchase"
  | "cancelCreditCardPurchase"
  | "closeCreditCardInvoice"
  | "reopenCreditCardInvoice"
  | "registerCreditCardInvoicePayment"
  | "reverseCreditCardInvoicePayment"
  | "recalculateCardLimit"
  | "rebuildCardInvoicesForCard"
  | "migrateLegacyInstallmentsToInvoiceDomain";

export type CreditCardBackendRole =
  | "owner"
  | "admin"
  | "member"
  | "viewer"
  | "system";

export type CreditCardWriteTarget =
  | "credit_cards"
  | "credit_card_purchases"
  | "credit_card_installments"
  | "credit_card_invoices"
  | "credit_card_invoice_payments"
  | "card_limit_ledger"
  | "financial_events"
  | "invoice_views"
  | "card_limit_snapshots"
  | "transactions"
  | "wallets"
  | "cash_accounts";

export interface CreditCardBackendWritePlan {
  operation: CreditCardBackendWriteOperation;
  allowedRoles: CreditCardBackendRole[];
  requiresAuthentication: boolean;
  requiresWorkspaceMembership: boolean;
  requiresIdempotencyKey: boolean;
  requiresFirestoreTransaction: boolean;
  reads: CreditCardWriteTarget[];
  writes: CreditCardWriteTarget[];
  emitsFinancialEvent: boolean;
  updatesLimitLedger: boolean;
  updatesInvoiceProjection: boolean;
  affectsCashBalance: boolean;
  clientDirectWriteAllowed: false;
}

export const CREDIT_CARD_BACKEND_WRITE_PLANS: Record<
  CreditCardBackendWriteOperation,
  CreditCardBackendWritePlan
> = {
  createCreditCardPurchase: {
    operation: "createCreditCardPurchase",
    allowedRoles: ["owner", "admin", "member"],
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresFirestoreTransaction: true,
    reads: ["credit_cards", "card_limit_snapshots"],
    writes: [
      "credit_card_purchases",
      "credit_card_installments",
      "credit_card_invoices",
      "card_limit_ledger",
      "financial_events",
      "invoice_views",
      "card_limit_snapshots",
    ],
    emitsFinancialEvent: true,
    updatesLimitLedger: true,
    updatesInvoiceProjection: true,
    affectsCashBalance: false,
    clientDirectWriteAllowed: false,
  },

  updateCreditCardPurchase: {
    operation: "updateCreditCardPurchase",
    allowedRoles: ["owner", "admin", "member"],
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresFirestoreTransaction: true,
    reads: [
      "credit_card_purchases",
      "credit_card_installments",
      "credit_card_invoices",
      "credit_card_invoice_payments",
      "card_limit_snapshots",
    ],
    writes: [
      "credit_card_purchases",
      "credit_card_installments",
      "credit_card_invoices",
      "card_limit_ledger",
      "financial_events",
      "invoice_views",
      "card_limit_snapshots",
    ],
    emitsFinancialEvent: true,
    updatesLimitLedger: true,
    updatesInvoiceProjection: true,
    affectsCashBalance: false,
    clientDirectWriteAllowed: false,
  },

   cancelCreditCardPurchase: {
    operation: "cancelCreditCardPurchase",
    allowedRoles: ["owner", "admin"],
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresFirestoreTransaction: true,
    reads: [
      "credit_card_purchases",
      "credit_card_installments",
      "credit_card_invoices",
      "credit_card_invoice_payments",
      "card_limit_snapshots",
    ],
    writes: [
      "credit_card_purchases",
      "credit_card_installments",
      "credit_card_invoices",
      "card_limit_ledger",
      "financial_events",
      "invoice_views",
      "card_limit_snapshots",
    ],
    emitsFinancialEvent: true,
    updatesLimitLedger: true,
    updatesInvoiceProjection: true,
    affectsCashBalance: false,
    clientDirectWriteAllowed: false,
  },

  closeCreditCardInvoice: {
    operation: "closeCreditCardInvoice",
    allowedRoles: ["owner", "admin", "system"],
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresFirestoreTransaction: true,
    reads: ["credit_card_invoices", "credit_card_installments"],
    writes: ["credit_card_invoices", "financial_events", "invoice_views"],
    emitsFinancialEvent: true,
    updatesLimitLedger: false,
    updatesInvoiceProjection: true,
    affectsCashBalance: false,
    clientDirectWriteAllowed: false,
  },

  reopenCreditCardInvoice: {
    operation: "reopenCreditCardInvoice",
    allowedRoles: ["owner", "admin"],
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresFirestoreTransaction: true,
    reads: [
      "credit_card_invoices",
      "credit_card_installments",
      "credit_card_invoice_payments",
    ],
    writes: ["credit_card_invoices", "financial_events", "invoice_views"],
    emitsFinancialEvent: true,
    updatesLimitLedger: false,
    updatesInvoiceProjection: true,
    affectsCashBalance: false,
    clientDirectWriteAllowed: false,
  },

  registerCreditCardInvoicePayment: {
    operation: "registerCreditCardInvoicePayment",
    allowedRoles: ["owner", "admin"],
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresFirestoreTransaction: true,
    reads: [
      "credit_card_invoices",
      "credit_card_invoice_payments",
      "card_limit_snapshots",
      "wallets",
      "cash_accounts",
    ],
    writes: [
      "credit_card_invoice_payments",
      "credit_card_invoices",
      "card_limit_ledger",
      "financial_events",
      "invoice_views",
      "card_limit_snapshots",
      "wallets",
      "cash_accounts",
      "transactions",
    ],
    emitsFinancialEvent: true,
    updatesLimitLedger: true,
    updatesInvoiceProjection: true,
    affectsCashBalance: true,
    clientDirectWriteAllowed: false,
  },

  reverseCreditCardInvoicePayment: {
    operation: "reverseCreditCardInvoicePayment",
    allowedRoles: ["owner", "admin"],
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresFirestoreTransaction: true,
    reads: [
      "credit_card_invoice_payments",
      "credit_card_invoices",
      "card_limit_snapshots",
      "wallets",
      "cash_accounts",
    ],
    writes: [
      "credit_card_invoice_payments",
      "credit_card_invoices",
      "card_limit_ledger",
      "financial_events",
      "invoice_views",
      "card_limit_snapshots",
      "wallets",
      "cash_accounts",
      "transactions",
    ],
    emitsFinancialEvent: true,
    updatesLimitLedger: true,
    updatesInvoiceProjection: true,
    affectsCashBalance: true,
    clientDirectWriteAllowed: false,
  },

  recalculateCardLimit: {
    operation: "recalculateCardLimit",
    allowedRoles: ["owner", "admin", "system"],
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresFirestoreTransaction: true,
    reads: ["credit_cards", "card_limit_ledger"],
    writes: ["card_limit_snapshots", "financial_events"],
    emitsFinancialEvent: true,
    updatesLimitLedger: false,
    updatesInvoiceProjection: false,
    affectsCashBalance: false,
    clientDirectWriteAllowed: false,
  },

  rebuildCardInvoicesForCard: {
    operation: "rebuildCardInvoicesForCard",
    allowedRoles: ["owner", "admin", "system"],
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresFirestoreTransaction: true,
    reads: [
      "credit_cards",
      "credit_card_purchases",
      "credit_card_installments",
      "credit_card_invoices",
      "credit_card_invoice_payments",
    ],
    writes: [
      "credit_card_installments",
      "credit_card_invoices",
      "financial_events",
      "invoice_views",
    ],
    emitsFinancialEvent: true,
    updatesLimitLedger: false,
    updatesInvoiceProjection: true,
    affectsCashBalance: false,
    clientDirectWriteAllowed: false,
  },

  migrateLegacyInstallmentsToInvoiceDomain: {
    operation: "migrateLegacyInstallmentsToInvoiceDomain",
    allowedRoles: ["owner", "admin"],
    requiresAuthentication: true,
    requiresWorkspaceMembership: true,
    requiresIdempotencyKey: true,
    requiresFirestoreTransaction: true,
    reads: ["transactions", "credit_cards"],
    writes: [
      "transactions",
      "credit_card_purchases",
      "credit_card_installments",
      "credit_card_invoices",
      "card_limit_ledger",
      "financial_events",
      "invoice_views",
      "card_limit_snapshots",
    ],
    emitsFinancialEvent: true,
    updatesLimitLedger: true,
    updatesInvoiceProjection: true,
    affectsCashBalance: false,
    clientDirectWriteAllowed: false,
  },
};

export const getCreditCardBackendWritePlan = (
  operation: CreditCardBackendWriteOperation
): CreditCardBackendWritePlan => CREDIT_CARD_BACKEND_WRITE_PLANS[operation];
