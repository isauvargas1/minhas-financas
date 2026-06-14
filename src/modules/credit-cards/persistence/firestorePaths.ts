import {
  collection,
  doc,
  type CollectionReference,
  type DocumentReference,
} from 'firebase/firestore';

import { db } from '../../../lib/firebase';

import type {
  CardEventLog,
  CardLimitLedger,
  CreditCardAuditLog,
  CreditCardInstallment,
  CreditCardInvoice,
  CreditCardInvoicePayment,
  CreditCardInvoiceProjection,
  CreditCardLimitSnapshot,
  CreditCardOperationalMetric,
  CreditCardPurchase,
} from '../domain/types.ts';

import type { CreditCard } from '../../../types';

export const CREDIT_CARD_FIRESTORE_COLLECTIONS = {
  creditCards: 'credit_cards',
  purchases: 'credit_card_purchases',
  installments: 'credit_card_installments',
  invoices: 'credit_card_invoices',
  invoicePayments: 'credit_card_invoice_payments',
  limitLedger: 'card_limit_ledger',
  financialEvents: 'financial_events',
  auditLogs: 'credit_card_audit_logs',
  operationalMetrics: 'credit_card_operational_metrics',
  invoiceViews: 'invoice_views',
  limitSnapshots: 'card_limit_snapshots',
} as const;

export type CreditCardFirestoreCollectionName =
  typeof CREDIT_CARD_FIRESTORE_COLLECTIONS[keyof typeof CREDIT_CARD_FIRESTORE_COLLECTIONS];

export const assertCreditCardWorkspaceId = (workspaceId?: string): string => {
  if (!workspaceId || workspaceId === 'loading') {
    throw new Error('Workspace ID obrigatório para acessar o domínio de cartão.');
  }

  return workspaceId;
};

export const buildWorkspaceCollectionPath = (
  workspaceId: string,
  collectionName: CreditCardFirestoreCollectionName
): string => `workspaces/${workspaceId}/${collectionName}`;

export const buildWorkspaceDocumentPath = (
  workspaceId: string,
  collectionName: CreditCardFirestoreCollectionName,
  documentId: string
): string => `${buildWorkspaceCollectionPath(workspaceId, collectionName)}/${documentId}`;

export const creditCardsCollectionRef = (
  workspaceId: string
): CollectionReference<CreditCard> =>
  collection(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.creditCards
  ) as CollectionReference<CreditCard>;

export const creditCardDocRef = (
  workspaceId: string,
  cardId: string
): DocumentReference<CreditCard> =>
  doc(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.creditCards,
    cardId
  ) as DocumentReference<CreditCard>;

export const creditCardPurchasesCollectionRef = (
  workspaceId: string
): CollectionReference<CreditCardPurchase> =>
  collection(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.purchases
  ) as CollectionReference<CreditCardPurchase>;

export const creditCardPurchaseDocRef = (
  workspaceId: string,
  purchaseId: string
): DocumentReference<CreditCardPurchase> =>
  doc(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.purchases,
    purchaseId
  ) as DocumentReference<CreditCardPurchase>;

export const creditCardInstallmentsCollectionRef = (
  workspaceId: string
): CollectionReference<CreditCardInstallment> =>
  collection(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.installments
  ) as CollectionReference<CreditCardInstallment>;

export const creditCardInstallmentDocRef = (
  workspaceId: string,
  installmentId: string
): DocumentReference<CreditCardInstallment> =>
  doc(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.installments,
    installmentId
  ) as DocumentReference<CreditCardInstallment>;

export const creditCardInvoicesCollectionRef = (
  workspaceId: string
): CollectionReference<CreditCardInvoice> =>
  collection(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.invoices
  ) as CollectionReference<CreditCardInvoice>;

export const creditCardInvoiceDocRef = (
  workspaceId: string,
  invoiceId: string
): DocumentReference<CreditCardInvoice> =>
  doc(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.invoices,
    invoiceId
  ) as DocumentReference<CreditCardInvoice>;

export const creditCardInvoicePaymentsCollectionRef = (
  workspaceId: string
): CollectionReference<CreditCardInvoicePayment> =>
  collection(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.invoicePayments
  ) as CollectionReference<CreditCardInvoicePayment>;

export const creditCardInvoicePaymentDocRef = (
  workspaceId: string,
  paymentId: string
): DocumentReference<CreditCardInvoicePayment> =>
  doc(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.invoicePayments,
    paymentId
  ) as DocumentReference<CreditCardInvoicePayment>;

export const cardLimitLedgerCollectionRef = (
  workspaceId: string
): CollectionReference<CardLimitLedger> =>
  collection(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.limitLedger
  ) as CollectionReference<CardLimitLedger>;

export const cardLimitLedgerDocRef = (
  workspaceId: string,
  ledgerEntryId: string
): DocumentReference<CardLimitLedger> =>
  doc(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.limitLedger,
    ledgerEntryId
  ) as DocumentReference<CardLimitLedger>;

export const cardFinancialEventsCollectionRef = (
  workspaceId: string
): CollectionReference<CardEventLog> =>
  collection(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.financialEvents
  ) as CollectionReference<CardEventLog>;

export const cardFinancialEventDocRef = (
  workspaceId: string,
  eventId: string
): DocumentReference<CardEventLog> =>
  doc(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.financialEvents,
    eventId
  ) as DocumentReference<CardEventLog>;

export const creditCardInvoiceViewsCollectionRef = (
  workspaceId: string
): CollectionReference<CreditCardInvoiceProjection> =>
  collection(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.invoiceViews
  ) as CollectionReference<CreditCardInvoiceProjection>;

export const creditCardInvoiceViewDocRef = (
  workspaceId: string,
  invoiceViewId: string
): DocumentReference<CreditCardInvoiceProjection> =>
  doc(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.invoiceViews,
    invoiceViewId
  ) as DocumentReference<CreditCardInvoiceProjection>;

export const cardLimitSnapshotsCollectionRef = (
  workspaceId: string
): CollectionReference<CreditCardLimitSnapshot> =>
  collection(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.limitSnapshots
  ) as CollectionReference<CreditCardLimitSnapshot>;

export const cardLimitSnapshotDocRef = (
  workspaceId: string,
  cardId: string
): DocumentReference<CreditCardLimitSnapshot> =>
  doc(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.limitSnapshots,
    cardId
  ) as DocumentReference<CreditCardLimitSnapshot>;

  export const creditCardAuditLogsCollectionRef = (
  workspaceId: string
): CollectionReference<CreditCardAuditLog> =>
  collection(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.auditLogs
  ) as CollectionReference<CreditCardAuditLog>;

export const creditCardOperationalMetricsCollectionRef = (
  workspaceId: string
): CollectionReference<CreditCardOperationalMetric> =>
  collection(
    db,
    'workspaces',
    assertCreditCardWorkspaceId(workspaceId),
    CREDIT_CARD_FIRESTORE_COLLECTIONS.operationalMetrics
  ) as CollectionReference<CreditCardOperationalMetric>;