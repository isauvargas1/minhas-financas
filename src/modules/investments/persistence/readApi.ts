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
  InvestmentAllocationDimension,
  InvestmentAllocationSummary,
  InvestmentReportPeriod,
  OfficialInvestmentReportData,
} from '../types';
import {
  investmentAccountsRef,
  investmentAssetsRef,
  investmentMovementsRef,
  investmentPositionsRef,
  investmentSummaryRef,
  investmentReportPeriodsRef,
  investmentAllocationSummariesRef,
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

/**
 * Resolve nomes de conta e ativo por ID, inclusive arquivados (INV-P3-050).
 *
 * A tela resolvia os nomes com o mapa dos 20 registros **ativos** carregados
 * na página corrente: uma posição de um ativo fora dessa página — e toda
 * posição de ativo arquivado, que nunca entra na lista de ativos — aparecia
 * como "Ativo a1b2c3", um fragmento de ID na tabela patrimonial.
 *
 * A consulta é por `documentId() in [...]`, em blocos de 30, que é o teto do
 * operador. `limit` é obrigatório pelas Rules do domínio.
 */
export const resolveInvestmentEntityNames = async <T extends { id: string; name: string }>(
  reference: ReturnType<typeof investmentAccountsRef>,
  ids: string[],
): Promise<Map<string, string>> => {
  const unique = Array.from(new Set(ids.filter((id) => id.length > 0)));
  const names = new Map<string, string>();
  const CHUNK = 30;
  for (let index = 0; index < unique.length; index += CHUNK) {
    const chunk = unique.slice(index, index + CHUNK);
    const snapshot = await getDocs(query(
      reference,
      where(documentId(), 'in', chunk),
      limit(chunk.length),
    ));
    snapshot.docs.forEach((entry) => {
      names.set(entry.id, String((entry.data() as T).name ?? entry.id));
    });
  }
  return names;
};

export const resolveInvestmentAccountNames = (workspaceId: string, ids: string[]) =>
  resolveInvestmentEntityNames<InvestmentAccount>(investmentAccountsRef(workspaceId), ids);

export const resolveInvestmentAssetNames = (workspaceId: string, ids: string[]) =>
  resolveInvestmentEntityNames<InvestmentAsset>(investmentAssetsRef(workspaceId), ids);

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

/**
 * Movimentos do domínio patrimonial vinculados a uma meta (INV-P2-029).
 *
 * Com o domínio ligado, o progresso da meta vem de `investmentProgressCents`,
 * mas a lista de movimentações continuava vindo de `transactions` filtrada por
 * `goalId` — e o vínculo retroativo não gera espelho de caixa. A meta exibia
 * progresso positivo com lista vazia, sem nada explicando a contradição.
 */
export const listGoalInvestmentMovements = async (
  workspaceId: string,
  goalId: string,
  max = 50,
): Promise<InvestmentMovement[]> => {
  const snapshot = await getDocs(query(
    investmentMovementsRef(workspaceId),
    where('goalId', '==', goalId),
    orderBy('occurredAt', 'desc'),
    orderBy(documentId(), 'desc'),
    limit(Math.min(max, PAGE_SIZE)),
  ));
  return snapshot.docs.map((entry) => ({ ...entry.data(), id: entry.id }) as InvestmentMovement);
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

// Teto de listagem imposto pelas Rules (`isBoundedInvestmentList`).
const RULES_LIST_LIMIT = 100;
// Um a menos que o teto, para caber a sonda n+1 de truncamento dentro dele.
const REPORT_PERIOD_LIMIT = RULES_LIST_LIMIT - 1;
const ALLOCATION_LIMIT = 10;
const ALLOCATION_DIMENSIONS: InvestmentAllocationDimension[] = [
  'account', 'class', 'asset', 'goal', 'risk', 'liquidity', 'indexer', 'purpose',
];

export const getOfficialInvestmentReportData = async (
  workspaceId: string,
  options: { periodLimit?: number; includeAllocations?: boolean } = {},
): Promise<OfficialInvestmentReportData> => {
  const periodLimit = Math.min(
    Math.max(options.periodLimit ?? REPORT_PERIOD_LIMIT, 1),
    REPORT_PERIOD_LIMIT,
  );
  const dimensions = options.includeAllocations === false ? [] : ALLOCATION_DIMENSIONS;
  const [summary, periodSnapshot, ...allocationSnapshots] = await Promise.all([
    getInvestmentSummary(workspaceId),
    getDocs(query(
      investmentReportPeriodsRef(workspaceId),
      orderBy('periodStart', 'desc'),
      orderBy(documentId(), 'desc'),
      // Sonda n+1, como já se faz nas alocações: pede um a mais para saber se
      // há período além da janela. A heurística anterior comparava o tamanho
      // com o teto de 100 e, como as faixas usuais pedem 3, 5, 7 ou 14
      // períodos, nunca sinalizava truncamento fora da faixa "tudo".
      limit(periodLimit + 1),
    )),
    ...dimensions.map((dimension) => getDocs(query(
      investmentAllocationSummariesRef(workspaceId),
      where('dimension', '==', dimension),
      orderBy('currentValueCents', 'desc'),
      orderBy(documentId(), 'desc'),
      limit(ALLOCATION_LIMIT + 1),
    ))),
  ]);
  const periodsTruncated = periodSnapshot.size > periodLimit;
  const periods = periodSnapshot.docs.slice(0, periodLimit).map((entry) => ({
    ...entry.data(), id: entry.id,
  }) as InvestmentReportPeriod).reverse();
  const allocations: OfficialInvestmentReportData['allocations'] = {};
  const truncatedDimensions: InvestmentAllocationDimension[] = [];
  dimensions.forEach((dimension, index) => {
    const snapshot = allocationSnapshots[index];
    if (snapshot.size > ALLOCATION_LIMIT) truncatedDimensions.push(dimension);
    allocations[dimension] = snapshot.docs.slice(0, ALLOCATION_LIMIT).map((entry) => ({
      ...entry.data(), id: entry.id,
    }) as InvestmentAllocationSummary);
  });
  return {
    summary,
    periods,
    allocations,
    periodsTruncated,
    truncatedDimensions,
  };
};
