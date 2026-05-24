import {
  documentId,
  getDoc,
  getDocs,
  limit as firestoreLimit,
  orderBy,
  query,
  where,
  type DocumentData,
  type QueryConstraint,
  type QuerySnapshot,
} from 'firebase/firestore';

import type {
  CardLimitLedger,
  CompetenceMonth,
  CreditCardInstallment,
  CreditCardInstallmentStatus,
  CreditCardInvoice,
  CreditCardInvoicePayment,
  CreditCardInvoiceProjection,
  CreditCardInvoiceStatus,
  CreditCardLimitSnapshot,
  CreditCardPurchase,
  CreditCardPurchaseStatus,
  IsoDateString,
} from '../domain/types.ts';

import {
  cardLimitLedgerCollectionRef,
  cardLimitSnapshotDocRef,
  cardLimitSnapshotsCollectionRef,
  creditCardInstallmentsCollectionRef,
  creditCardInvoiceDocRef,
  creditCardInvoicePaymentsCollectionRef,
  creditCardInvoicesCollectionRef,
  creditCardInvoiceViewsCollectionRef,
  creditCardPurchasesCollectionRef,
} from './firestorePaths.ts';

export interface CreditCardQueryLimitOptions {
  limit?: number;
}

export interface ListCreditCardInvoicesByCardOptions extends CreditCardQueryLimitOptions {
  statuses?: CreditCardInvoiceStatus[];
}

export interface ListCreditCardPurchasesByCardOptions extends CreditCardQueryLimitOptions {
  statuses?: CreditCardPurchaseStatus[];
}

export interface ListCreditCardInstallmentsByInvoiceOptions extends CreditCardQueryLimitOptions {
  statuses?: CreditCardInstallmentStatus[];
}

export interface ListCreditCardLedgerByCardOptions extends CreditCardQueryLimitOptions {
  sourceId?: string;
}

const DEFAULT_QUERY_LIMIT = 50;

const normalizeQueryLimit = (limit?: number): number => {
  if (!Number.isInteger(limit) || !limit || limit < 1) return DEFAULT_QUERY_LIMIT;
  return Math.min(limit, 200);
};

const withOptionalLimit = (
  constraints: QueryConstraint[],
  limit?: number
): QueryConstraint[] => [
  ...constraints,
  firestoreLimit(normalizeQueryLimit(limit)),
];

const mapDocs = <TData>(snapshot: QuerySnapshot<DocumentData>): TData[] =>
  snapshot.docs.map((documentSnapshot) => ({
    ...documentSnapshot.data(),
    id: documentSnapshot.id,
  }) as TData);

export const getCreditCardInvoiceById = async (
  workspaceId: string,
  invoiceId: string
): Promise<CreditCardInvoice | null> => {
  const snapshot = await getDoc(creditCardInvoiceDocRef(workspaceId, invoiceId));
  if (!snapshot.exists()) return null;
  return { ...snapshot.data(), id: snapshot.id } as CreditCardInvoice;
};

export const listCardLimitSnapshotsByWorkspace = async (
  workspaceId: string
): Promise<CreditCardLimitSnapshot[]> => {
  const snapshot = await getDocs(cardLimitSnapshotsCollectionRef(workspaceId));

  return snapshot.docs.map((documentSnapshot) => ({
    ...documentSnapshot.data(),
    cardId: documentSnapshot.id,
  }) as CreditCardLimitSnapshot);
};

export const listOpenCreditCardInvoicesByCard = async (
  workspaceId: string,
  cardId: string,
  options: CreditCardQueryLimitOptions = {}
): Promise<CreditCardInvoice[]> => {
  const snapshot = await getDocs(
    query(
      creditCardInvoicesCollectionRef(workspaceId),
      ...withOptionalLimit(
        [
          where('cardId', '==', cardId),
          where('status', 'in', ['open', 'closed', 'partial_paid', 'paid', 'overdue']),
          orderBy('dueDate', 'asc'),
        ],
        options.limit
      )
    )
  );

  return mapDocs<CreditCardInvoice>(snapshot);
};

export const listCreditCardInvoiceHistoryByCard = async (
  workspaceId: string,
  cardId: string,
  options: ListCreditCardInvoicesByCardOptions = {}
): Promise<CreditCardInvoice[]> => {
  const statuses = options.statuses?.length ? options.statuses : undefined;
  const constraints: QueryConstraint[] = [where('cardId', '==', cardId)];

  if (statuses) constraints.push(where('status', 'in', statuses));
  constraints.push(orderBy('competenceMonth', 'desc'));

  const snapshot = await getDocs(
    query(
      creditCardInvoicesCollectionRef(workspaceId),
      ...withOptionalLimit(constraints, options.limit)
    )
  );

  return mapDocs<CreditCardInvoice>(snapshot);
};

export const listCreditCardInvoicesByDueDateAndStatus = async (
  workspaceId: string,
  status: CreditCardInvoiceStatus,
  startDueDate: IsoDateString,
  endDueDate: IsoDateString,
  options: CreditCardQueryLimitOptions = {}
): Promise<CreditCardInvoice[]> => {
  const snapshot = await getDocs(
    query(
      creditCardInvoicesCollectionRef(workspaceId),
      ...withOptionalLimit(
        [
          where('status', '==', status),
          where('dueDate', '>=', startDueDate),
          where('dueDate', '<=', endDueDate),
          orderBy('dueDate', 'asc'),
        ],
        options.limit
      )
    )
  );

  return mapDocs<CreditCardInvoice>(snapshot);
};

export const listCreditCardInstallmentsByInvoice = async (
  workspaceId: string,
  invoiceId: string,
  options: ListCreditCardInstallmentsByInvoiceOptions = {}
): Promise<CreditCardInstallment[]> => {
  const constraints: QueryConstraint[] = [where('invoiceId', '==', invoiceId)];

  if (options.statuses?.length) constraints.push(where('status', 'in', options.statuses));
  constraints.push(orderBy('installmentNumber', 'asc'));

  const snapshot = await getDocs(
    query(
      creditCardInstallmentsCollectionRef(workspaceId),
      ...withOptionalLimit(constraints, options.limit)
    )
  );

  return mapDocs<CreditCardInstallment>(snapshot);
};

export const listCreditCardInstallmentsByPurchase = async (
  workspaceId: string,
  purchaseId: string,
  options: CreditCardQueryLimitOptions = {}
): Promise<CreditCardInstallment[]> => {
  const snapshot = await getDocs(
    query(
      creditCardInstallmentsCollectionRef(workspaceId),
      ...withOptionalLimit(
        [where('purchaseId', '==', purchaseId), orderBy('installmentNumber', 'asc')],
        options.limit
      )
    )
  );

  return mapDocs<CreditCardInstallment>(snapshot);
};

export const listCreditCardInstallmentsByCardAndCompetence = async (
  workspaceId: string,
  cardId: string,
  competenceMonth: CompetenceMonth,
  options: CreditCardQueryLimitOptions = {}
): Promise<CreditCardInstallment[]> => {
  const snapshot = await getDocs(
    query(
      creditCardInstallmentsCollectionRef(workspaceId),
      ...withOptionalLimit(
        [
          where('cardId', '==', cardId),
          where('competenceMonth', '==', competenceMonth),
          orderBy('installmentNumber', 'asc'),
        ],
        options.limit
      )
    )
  );

  return mapDocs<CreditCardInstallment>(snapshot);
};

export const listCreditCardPurchasesByCard = async (
  workspaceId: string,
  cardId: string,
  options: ListCreditCardPurchasesByCardOptions = {}
): Promise<CreditCardPurchase[]> => {
  const constraints: QueryConstraint[] = [where('cardId', '==', cardId)];

  if (options.statuses?.length) constraints.push(where('status', 'in', options.statuses));
  constraints.push(orderBy('purchaseDate', 'desc'));

  const snapshot = await getDocs(
    query(
      creditCardPurchasesCollectionRef(workspaceId),
      ...withOptionalLimit(constraints, options.limit)
    )
  );

  return mapDocs<CreditCardPurchase>(snapshot);
};

const chunkArray = <TValue,>(
  values: TValue[],
  chunkSize: number
): TValue[][] => {
  const chunks: TValue[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
};

export const listCreditCardPurchasesByIds = async (
  workspaceId: string,
  purchaseIds: string[]
): Promise<CreditCardPurchase[]> => {
  const uniquePurchaseIds = Array.from(
    new Set(purchaseIds.filter((purchaseId) => Boolean(purchaseId)))
  );

  if (uniquePurchaseIds.length === 0) {
    return [];
  }

  const snapshots = await Promise.all(
    chunkArray(uniquePurchaseIds, 30).map((purchaseIdChunk) =>
      getDocs(
        query(
          creditCardPurchasesCollectionRef(workspaceId),
          where(documentId(), 'in', purchaseIdChunk)
        )
      )
    )
  );

  return snapshots.reduce<CreditCardPurchase[]>((accumulator, snapshot) => {
    accumulator.push(...mapDocs<CreditCardPurchase>(snapshot));

    return accumulator;
  }, []);
};

export const listCreditCardInvoicePaymentsByInvoice = async (
  workspaceId: string,
  invoiceId: string,
  options: CreditCardQueryLimitOptions = {}
): Promise<CreditCardInvoicePayment[]> => {
  const snapshot = await getDocs(
    query(
      creditCardInvoicePaymentsCollectionRef(workspaceId),
      ...withOptionalLimit(
        [where('invoiceId', '==', invoiceId), orderBy('paymentDate', 'desc')],
        options.limit
      )
    )
  );

  return mapDocs<CreditCardInvoicePayment>(snapshot);
};

export const listCreditCardLedgerByCard = async (
  workspaceId: string,
  cardId: string,
  options: ListCreditCardLedgerByCardOptions = {}
): Promise<CardLimitLedger[]> => {
  const constraints: QueryConstraint[] = [where('cardId', '==', cardId)];

  if (options.sourceId) constraints.push(where('sourceId', '==', options.sourceId));
  constraints.push(orderBy('createdAt', 'desc'));

  const snapshot = await getDocs(
    query(
      cardLimitLedgerCollectionRef(workspaceId),
      ...withOptionalLimit(constraints, options.limit)
    )
  );

  return mapDocs<CardLimitLedger>(snapshot);
};

export const listCreditCardInvoiceViewsByStatus = async (
  workspaceId: string,
  status: CreditCardInvoiceStatus,
  options: CreditCardQueryLimitOptions = {}
): Promise<CreditCardInvoiceProjection[]> => {
  const snapshot = await getDocs(
    query(
      creditCardInvoiceViewsCollectionRef(workspaceId),
      ...withOptionalLimit(
        [where('status', '==', status), orderBy('dueDate', 'asc')],
        options.limit
      )
    )
  );

  return mapDocs<CreditCardInvoiceProjection>(snapshot);
};

export const listCreditCardInvoiceViewsForExpenseCompatibility = async (
  workspaceId: string,
  options: CreditCardQueryLimitOptions = {}
): Promise<CreditCardInvoiceProjection[]> => {
  const snapshot = await getDocs(
    query(
      creditCardInvoiceViewsCollectionRef(workspaceId),
      ...withOptionalLimit(
        [
          where('status', 'in', ['open', 'closed', 'partial_paid', 'paid', 'overdue']),
          orderBy('dueDate', 'asc'),
        ],
        options.limit
      )
    )
  );

  return mapDocs<CreditCardInvoiceProjection>(snapshot);
};

export const listCreditCardInvoicesForReports = async (
  workspaceId: string,
  options: CreditCardQueryLimitOptions = {}
): Promise<CreditCardInvoice[]> => {
  const snapshot = await getDocs(
    query(
      creditCardInvoicesCollectionRef(workspaceId),
      ...withOptionalLimit(
        [orderBy('dueDate', 'asc')],
        options.limit
      )
    )
  );

  return mapDocs<CreditCardInvoice>(snapshot);
};

export const listCreditCardInstallmentsForReports = async (
  workspaceId: string,
  options: CreditCardQueryLimitOptions = {}
): Promise<CreditCardInstallment[]> => {
  const snapshot = await getDocs(
    query(
      creditCardInstallmentsCollectionRef(workspaceId),
      ...withOptionalLimit(
        [orderBy('dueDate', 'asc')],
        options.limit
      )
    )
  );

  return mapDocs<CreditCardInstallment>(snapshot);
};

export const listCreditCardInvoicePaymentsForReports = async (
  workspaceId: string,
  options: CreditCardQueryLimitOptions = {}
): Promise<CreditCardInvoicePayment[]> => {
  const snapshot = await getDocs(
    query(
      creditCardInvoicePaymentsCollectionRef(workspaceId),
      ...withOptionalLimit(
        [orderBy('paymentDate', 'desc')],
        options.limit
      )
    )
  );

  return mapDocs<CreditCardInvoicePayment>(snapshot);
};

export const listCreditCardPurchasesForReports = async (
  workspaceId: string,
  options: CreditCardQueryLimitOptions = {}
): Promise<CreditCardPurchase[]> => {
  const snapshot = await getDocs(
    query(
      creditCardPurchasesCollectionRef(workspaceId),
      ...withOptionalLimit(
        [orderBy('purchaseDate', 'desc')],
        options.limit
      )
    )
  );

  return mapDocs<CreditCardPurchase>(snapshot);
};