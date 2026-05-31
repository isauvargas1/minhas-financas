import * as admin from "firebase-admin";

export const CREDIT_CARD_ADMIN_COLLECTIONS = {
  creditCards: "credit_cards",
  purchases: "credit_card_purchases",
  installments: "credit_card_installments",
  invoices: "credit_card_invoices",
  invoicePayments: "credit_card_invoice_payments",
  limitLedger: "card_limit_ledger",
    financialEvents: "financial_events",
  auditLogs: "credit_card_audit_logs",
  operationalMetrics: "credit_card_operational_metrics",
  invoiceViews: "invoice_views",
  limitSnapshots: "card_limit_snapshots",
  idempotencyKeys: "credit_card_idempotency_keys",
} as const;

export type CreditCardAdminCollectionName =
  typeof CREDIT_CARD_ADMIN_COLLECTIONS[
    keyof typeof CREDIT_CARD_ADMIN_COLLECTIONS
  ];

export const getFirestore = (): admin.firestore.Firestore =>
  admin.firestore();

export const assertWorkspaceId = (workspaceId: string): string => {
  if (!workspaceId || workspaceId.trim().length === 0) {
    throw new Error("Workspace ID obrigatório.");
  }

  return workspaceId;
};

export const workspaceDoc = (
  workspaceId: string
): admin.firestore.DocumentReference =>
  getFirestore().doc(`workspaces/${assertWorkspaceId(workspaceId)}`);

export const workspaceCollection = (
  workspaceId: string,
  collectionName: CreditCardAdminCollectionName
): admin.firestore.CollectionReference =>
  workspaceDoc(workspaceId).collection(collectionName);

export const workspaceCollectionDoc = (
  workspaceId: string,
  collectionName: CreditCardAdminCollectionName,
  documentId: string
): admin.firestore.DocumentReference =>
  workspaceCollection(workspaceId, collectionName).doc(documentId);

export const creditCardDoc = (
  workspaceId: string,
  cardId: string
): admin.firestore.DocumentReference =>
  workspaceCollectionDoc(
    workspaceId,
    CREDIT_CARD_ADMIN_COLLECTIONS.creditCards,
    cardId
  );

export const creditCardPurchaseDoc = (
  workspaceId: string,
  purchaseId: string
): admin.firestore.DocumentReference =>
  workspaceCollectionDoc(
    workspaceId,
    CREDIT_CARD_ADMIN_COLLECTIONS.purchases,
    purchaseId
  );

export const creditCardInstallmentDoc = (
  workspaceId: string,
  installmentId: string
): admin.firestore.DocumentReference =>
  workspaceCollectionDoc(
    workspaceId,
    CREDIT_CARD_ADMIN_COLLECTIONS.installments,
    installmentId
  );

export const creditCardInvoiceDoc = (
  workspaceId: string,
  invoiceId: string
): admin.firestore.DocumentReference =>
  workspaceCollectionDoc(
    workspaceId,
    CREDIT_CARD_ADMIN_COLLECTIONS.invoices,
    invoiceId
  );

export const creditCardInvoicePaymentDoc = (
  workspaceId: string,
  paymentId: string
): admin.firestore.DocumentReference =>
  workspaceCollectionDoc(
    workspaceId,
    CREDIT_CARD_ADMIN_COLLECTIONS.invoicePayments,
    paymentId
  );

export const cardLimitLedgerDoc = (
  workspaceId: string,
  ledgerEntryId: string
): admin.firestore.DocumentReference =>
  workspaceCollectionDoc(
    workspaceId,
    CREDIT_CARD_ADMIN_COLLECTIONS.limitLedger,
    ledgerEntryId
  );

export const cardFinancialEventDoc = (
  workspaceId: string,
  eventId: string
): admin.firestore.DocumentReference =>
  workspaceCollectionDoc(
    workspaceId,
    CREDIT_CARD_ADMIN_COLLECTIONS.financialEvents,
    eventId
  );

export const creditCardAuditLogDoc = (
  workspaceId: string,
  auditLogId: string
): admin.firestore.DocumentReference =>
  workspaceCollectionDoc(
    workspaceId,
    CREDIT_CARD_ADMIN_COLLECTIONS.auditLogs,
    auditLogId
  );

  export const creditCardOperationalMetricDoc = (
  workspaceId: string,
  metricId: string
): admin.firestore.DocumentReference =>
  workspaceCollectionDoc(
    workspaceId,
    CREDIT_CARD_ADMIN_COLLECTIONS.operationalMetrics,
    metricId
  );

export const creditCardInvoiceViewDoc = (
  workspaceId: string,
  invoiceViewId: string
): admin.firestore.DocumentReference =>
  workspaceCollectionDoc(
    workspaceId,
    CREDIT_CARD_ADMIN_COLLECTIONS.invoiceViews,
    invoiceViewId
  );

export const cardLimitSnapshotDoc = (
  workspaceId: string,
  cardId: string
): admin.firestore.DocumentReference =>
  workspaceCollectionDoc(
    workspaceId,
    CREDIT_CARD_ADMIN_COLLECTIONS.limitSnapshots,
    cardId
  );

export const creditCardIdempotencyDoc = (
  workspaceId: string,
  idempotencyDocumentId: string
): admin.firestore.DocumentReference =>
  workspaceCollectionDoc(
    workspaceId,
    CREDIT_CARD_ADMIN_COLLECTIONS.idempotencyKeys,
    idempotencyDocumentId
  );