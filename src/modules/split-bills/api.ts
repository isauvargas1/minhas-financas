import {
  Timestamp,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../lib/firebase';
import {
  toSplitBill,
  toSplitGroup,
  toSplitInvite,
  toSplitParticipant,
  toSplitReimbursement,
  toSplitShare,
} from './adapters';
import { createSplitCallables, type SplitInvoke } from './callables';
import type {
  SplitBill,
  SplitGroup,
  SplitInvite,
  SplitPage,
  SplitParticipant,
  SplitReimbursement,
  SplitShare,
} from './types';

/**
 * Leitura da Divisão de contas e ligação das callables (P4-C).
 *
 * Este módulo só **lê** (`getDocs`/`getDoc`), sempre com teto e filtrado no
 * servidor — sem listener, sem varredura e sem N+1: os totais do grupo e os
 * saldos de cada participante são agregados mantidos pelo backend, então a
 * lista de grupos não carrega títulos nem rateios. Toda escrita é das
 * callables; as Rules negam ao cliente criar, alterar ou apagar qualquer
 * documento `split_*`, e a guarda `tests/unit/split-no-client-writes.test.ts`
 * falha se uma operação de escrita do Firestore aparecer aqui.
 *
 * Sem corte silencioso: cada lista pede um documento a mais que o teto; se
 * ele vier, a resposta diz `truncated: true` (ou `hasMore`) e a tela avisa.
 */
const GROUPS = 'split_groups';
const PARTICIPANTS = 'split_participants';
const INVITES = 'split_invites';
const BILLS = 'split_bills';
const SHARES = 'split_shares';
const REIMBURSEMENTS = 'split_reimbursements';

/** Grupos ativos: o teto cobre a maior quota (100) — as Rules aceitam 101. */
export const SPLIT_ACTIVE_GROUPS_LIMIT = 100;
/** Grupos arquivados por página. */
export const SPLIT_ARCHIVED_PAGE_SIZE = 50;
/** Registros de participante por grupo (100) e grupos do usuário. */
export const SPLIT_PARTICIPANTS_LIMIT = 100;
/** Títulos e reembolsos por página. */
export const SPLIT_BILLS_PAGE_SIZE = 20;
/** Rateios por título (50) — as Rules aceitam 51. */
export const SPLIT_SHARES_LIMIT = 50;
/** Convites pendentes por grupo (20) — as Rules aceitam 21. */
export const SPLIT_INVITES_LIMIT = 20;

const isReady = (workspaceId?: string): workspaceId is string =>
  Boolean(workspaceId) && workspaceId !== 'loading';

const reportInvalid = (kind: string, id: string) => {
  console.error(`Documento de ${kind} fora do formato autoritativo ignorado: ${id}`);
};

const adapt = <T>(
  docs: readonly QueryDocumentSnapshot[],
  reader: (id: string, data: Record<string, unknown>) => T | null,
  kind: string,
): T[] => {
  const items: T[] = [];
  for (const entry of docs) {
    const value = reader(entry.id, entry.data());
    if (value) items.push(value);
    else reportInvalid(kind, entry.id);
  }
  return items;
};

const coll = (workspaceId: string, name: string) =>
  collection(db, 'workspaces', workspaceId, name);

// ------------------------------------------------------------------ grupos

/** Grupos ativos, mais novos primeiro (completos dentro da maior quota). */
export const listActiveSplitGroups = async (
  workspaceId: string | undefined,
): Promise<SplitPage<SplitGroup>> => {
  if (!isReady(workspaceId)) return { items: [], truncated: false };
  const snapshot = await getDocs(query(
    coll(workspaceId, GROUPS),
    where('status', '==', 'active'),
    orderBy('createdAt', 'desc'),
    limit(SPLIT_ACTIVE_GROUPS_LIMIT + 1),
  ));
  return {
    items: adapt(snapshot.docs.slice(0, SPLIT_ACTIVE_GROUPS_LIMIT), toSplitGroup, 'grupo'),
    truncated: snapshot.size > SPLIT_ACTIVE_GROUPS_LIMIT,
  };
};

export interface ArchivedGroupsPage {
  items: SplitGroup[];
  nextCursor?: QueryDocumentSnapshot;
  hasMore: boolean;
}

/** Grupos arquivados, uma página por vez (cursor no último documento). */
export const listArchivedSplitGroups = async (
  workspaceId: string | undefined,
  cursor?: QueryDocumentSnapshot,
): Promise<ArchivedGroupsPage> => {
  if (!isReady(workspaceId)) return { items: [], hasMore: false };
  const snapshot = await getDocs(query(
    coll(workspaceId, GROUPS),
    where('status', '==', 'archived'),
    orderBy('createdAt', 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(SPLIT_ARCHIVED_PAGE_SIZE + 1),
  ));
  const docs = snapshot.docs.slice(0, SPLIT_ARCHIVED_PAGE_SIZE);
  return {
    items: adapt(docs, toSplitGroup, 'grupo'),
    nextCursor: docs[docs.length - 1],
    hasMore: snapshot.size > SPLIT_ARCHIVED_PAGE_SIZE,
  };
};

export const getSplitGroup = async (
  workspaceId: string | undefined,
  groupId: string,
): Promise<SplitGroup | null> => {
  if (!isReady(workspaceId) || !groupId) return null;
  const snapshot = await getDoc(doc(db, 'workspaces', workspaceId, GROUPS, groupId));
  if (!snapshot.exists()) return null;
  const group = toSplitGroup(snapshot.id, snapshot.data());
  if (!group) reportInvalid('grupo', snapshot.id);
  return group;
};

// ----------------------------------------------------------- participantes

/** Registros do próprio usuário em todos os grupos (saldos dos cartões). */
export const listMySplitParticipants = async (
  workspaceId: string | undefined,
  uid: string | null | undefined,
): Promise<SplitPage<SplitParticipant>> => {
  if (!isReady(workspaceId) || !uid) return { items: [], truncated: false };
  const snapshot = await getDocs(query(
    coll(workspaceId, PARTICIPANTS),
    where('userId', '==', uid),
    limit(SPLIT_PARTICIPANTS_LIMIT + 1),
  ));
  return {
    items: adapt(snapshot.docs.slice(0, SPLIT_PARTICIPANTS_LIMIT), toSplitParticipant, 'participante'),
    truncated: snapshot.size > SPLIT_PARTICIPANTS_LIMIT,
  };
};

export const listSplitParticipants = async (
  workspaceId: string | undefined,
  groupId: string,
): Promise<SplitPage<SplitParticipant>> => {
  if (!isReady(workspaceId) || !groupId) return { items: [], truncated: false };
  const snapshot = await getDocs(query(
    coll(workspaceId, PARTICIPANTS),
    where('groupId', '==', groupId),
    limit(SPLIT_PARTICIPANTS_LIMIT + 1),
  ));
  return {
    items: adapt(snapshot.docs.slice(0, SPLIT_PARTICIPANTS_LIMIT), toSplitParticipant, 'participante'),
    truncated: snapshot.size > SPLIT_PARTICIPANTS_LIMIT,
  };
};

/**
 * Convites pendentes e válidos do grupo. Owner/admin veem todos; os demais,
 * só os que criaram (é o que as Rules permitem listar).
 */
export const listSplitInvites = async (
  workspaceId: string | undefined,
  groupId: string,
  options: { uid: string | null | undefined; isWorkspaceAdmin: boolean },
): Promise<SplitPage<SplitInvite>> => {
  if (!isReady(workspaceId) || !groupId || !options.uid) return { items: [], truncated: false };
  const snapshot = await getDocs(query(
    coll(workspaceId, INVITES),
    where('groupId', '==', groupId),
    ...(options.isWorkspaceAdmin ? [] : [where('createdBy', '==', options.uid)]),
    where('status', '==', 'pending'),
    where('expiresAt', '>', Timestamp.now()),
    orderBy('expiresAt', 'asc'),
    limit(SPLIT_INVITES_LIMIT + 1),
  ));
  return {
    items: adapt(snapshot.docs.slice(0, SPLIT_INVITES_LIMIT), toSplitInvite, 'convite'),
    truncated: snapshot.size > SPLIT_INVITES_LIMIT,
  };
};

// ---------------------------------------------------------- títulos e rateios

/** Cursor de títulos e reembolsos: a última (data, ID) exibida. */
export interface DatedCursor {
  expenseDate: string;
  id: string;
}

export interface DatedPage<T> {
  items: T[];
  nextCursor?: DatedCursor;
  hasMore: boolean;
}

const datedPage = async <T extends { id: string; expenseDate: string }>(
  workspaceId: string,
  name: string,
  groupId: string,
  reader: (id: string, data: Record<string, unknown>) => T | null,
  kind: string,
  cursor?: DatedCursor,
): Promise<DatedPage<T>> => {
  const snapshot = await getDocs(query(
    coll(workspaceId, name),
    where('groupId', '==', groupId),
    orderBy('expenseDate', 'desc'),
    orderBy(documentId(), 'desc'),
    ...(cursor ? [startAfter(cursor.expenseDate, cursor.id)] : []),
    limit(SPLIT_BILLS_PAGE_SIZE + 1),
  ));
  const docs = snapshot.docs.slice(0, SPLIT_BILLS_PAGE_SIZE);
  const last = docs[docs.length - 1];
  return {
    items: adapt(docs, reader, kind),
    nextCursor: last ? { expenseDate: String(last.get('expenseDate')), id: last.id } : undefined,
    hasMore: snapshot.size > SPLIT_BILLS_PAGE_SIZE,
  };
};

/** Despesas do grupo, mais recentes primeiro, uma página por vez. */
export const listSplitBills = (
  workspaceId: string | undefined,
  groupId: string,
  cursor?: DatedCursor,
): Promise<DatedPage<SplitBill>> => (isReady(workspaceId) && groupId ?
  datedPage(workspaceId, BILLS, groupId, toSplitBill, 'título', cursor) :
  Promise.resolve({ items: [], hasMore: false }));

/** Rateios de uma despesa (até 50, o teto por título). */
export const listSplitShares = async (
  workspaceId: string | undefined,
  billId: string,
): Promise<SplitPage<SplitShare>> => {
  if (!isReady(workspaceId) || !billId) return { items: [], truncated: false };
  const snapshot = await getDocs(query(
    coll(workspaceId, SHARES),
    where('billId', '==', billId),
    limit(SPLIT_SHARES_LIMIT + 1),
  ));
  return {
    items: adapt(snapshot.docs.slice(0, SPLIT_SHARES_LIMIT), toSplitShare, 'rateio'),
    truncated: snapshot.size > SPLIT_SHARES_LIMIT,
  };
};

/** Pedidos de reembolso do grupo, mais recentes primeiro, uma página por vez. */
export const listSplitReimbursements = (
  workspaceId: string | undefined,
  groupId: string,
  cursor?: DatedCursor,
): Promise<DatedPage<SplitReimbursement>> => (isReady(workspaceId) && groupId ?
  datedPage(workspaceId, REIMBURSEMENTS, groupId, toSplitReimbursement, 'reembolso', cursor) :
  Promise.resolve({ items: [], hasMore: false }));

// ---------------------------------------------------------------- callables

const invoke: SplitInvoke = async <TResult>(
  name: Parameters<SplitInvoke>[0],
  payload: Record<string, unknown>,
) => {
  const callable = httpsCallable<Record<string, unknown>, TResult>(functions, name);
  return (await callable(payload)).data;
};

export const splitCallables = createSplitCallables(invoke);
