import {
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type DocumentData,
  type QueryConstraint,
  type QuerySnapshot,
  type Timestamp,
} from 'firebase/firestore';
import type {
  InvestmentAccount,
  InvestmentAsset,
  InvestmentMovement,
  InvestmentPage,
  InvestmentPosition,
  InvestmentSummary,
} from '../types';
import {
  investmentAccountsRef,
  investmentAssetsRef,
  investmentMovementsRef,
  investmentPositionsRef,
  investmentSummaryRef,
} from './firestorePaths';

export interface InvestmentCursor { updatedAt: Timestamp; id: string }
export interface MovementCursor { occurredAt: Timestamp; id: string }
const PAGE_SIZE = 20;

const mapPage = <T>(snapshot: QuerySnapshot<DocumentData>): InvestmentPage<T> => {
  const items = snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }) as T);
  const last = snapshot.docs.at(-1);
  return {
    items,
    nextCursor: last && snapshot.size === PAGE_SIZE
      ? { updatedAt: last.get('updatedAt') as Timestamp, id: last.id }
      : null,
  };
};

const entityPage = async <T>(
  reference: ReturnType<typeof investmentAccountsRef>,
  status: 'active' | 'archived',
  cursor?: InvestmentCursor,
): Promise<InvestmentPage<T>> => {
  const constraints: QueryConstraint[] = [
    where('status', '==', status),
    orderBy('updatedAt', 'desc'),
    orderBy(documentId(), 'desc'),
  ];
  if (cursor) constraints.push(startAfter(cursor.updatedAt, cursor.id));
  constraints.push(limit(PAGE_SIZE));
  return mapPage<T>(await getDocs(query(reference, ...constraints)));
};

export const listInvestmentAccounts = (
  workspaceId: string,
  status: 'active' | 'archived',
  cursor?: InvestmentCursor,
) => entityPage<InvestmentAccount>(investmentAccountsRef(workspaceId), status, cursor);

export const listInvestmentAssets = (
  workspaceId: string,
  status: 'active' | 'archived',
  cursor?: InvestmentCursor,
) => entityPage<InvestmentAsset>(investmentAssetsRef(workspaceId), status, cursor);

export const listInvestmentPositions = async (
  workspaceId: string,
  accountId?: string,
  cursor?: InvestmentCursor,
): Promise<InvestmentPage<InvestmentPosition>> => {
  const constraints: QueryConstraint[] = [where('status', '==', 'active')];
  if (accountId) constraints.push(where('accountId', '==', accountId));
  constraints.push(orderBy('updatedAt', 'desc'), orderBy(documentId(), 'desc'));
  if (cursor) constraints.push(startAfter(cursor.updatedAt, cursor.id));
  constraints.push(limit(PAGE_SIZE));
  return mapPage(await getDocs(query(investmentPositionsRef(workspaceId), ...constraints)));
};

export const listInvestmentMovements = async (
  workspaceId: string,
  filters: { status?: string; operation?: string },
  cursor?: MovementCursor,
): Promise<{ items: InvestmentMovement[]; nextCursor: MovementCursor | null }> => {
  const constraints: QueryConstraint[] = [];
  if (filters.status) constraints.push(where('status', '==', filters.status));
  if (filters.operation) constraints.push(where('operation', '==', filters.operation));
  constraints.push(orderBy('occurredAt', 'desc'), orderBy(documentId(), 'desc'));
  if (cursor) constraints.push(startAfter(cursor.occurredAt, cursor.id));
  constraints.push(limit(PAGE_SIZE));
  const snapshot = await getDocs(query(investmentMovementsRef(workspaceId), ...constraints));
  const items = snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }) as InvestmentMovement);
  const last = snapshot.docs.at(-1);
  return {
    items,
    nextCursor: last && snapshot.size === PAGE_SIZE
      ? { occurredAt: last.get('occurredAt') as Timestamp, id: last.id }
      : null,
  };
};

export const getInvestmentSummary = async (workspaceId: string): Promise<InvestmentSummary | null> => {
  const snapshot = await getDoc(investmentSummaryRef(workspaceId));
  return snapshot.exists() ? ({ ...snapshot.data(), id: 'current' } as InvestmentSummary) : null;
};
