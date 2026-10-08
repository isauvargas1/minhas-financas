import {
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
  toAmountChange,
  toCardFactState,
  toCashFactState,
  toRecurringExpense,
  toRecurringOccurrence,
} from './adapters';
import { createRecurringCallables, type RecurringInvoke } from './callables';
import type {
  GeneratedFactState,
  RecurringAmountChange,
  RecurringExpense,
  RecurringOccurrence,
} from './types';

/**
 * Leitura de Recorrentes e ligação das callables (P4-B).
 *
 * Este módulo só **lê** (`getDocs`/`getDoc`), sempre com teto — sem listener
 * e sem varredura. Toda escrita é das callables do backend; as Rules negam
 * ao cliente criar, alterar ou apagar qualquer documento do domínio, e a
 * guarda `tests/unit/recurring-no-client-writes.test.ts` falha se uma
 * operação de escrita do Firestore aparecer aqui.
 *
 * Sem corte silencioso: cada lista pede um documento a mais que o teto; se
 * ele vier, a resposta diz `truncated: true` e a tela avisa.
 */
const EXPENSES_COLL = 'recurring_expenses';
const OCCURRENCES_COLL = 'recurring_occurrences';
const EVENTS_COLL = 'recurring_events';

export const RECURRING_PAGE_SIZE = 100;
/** Teto das ativas para os resumos; as Rules aceitam `limit <= 501`. */
export const RECURRING_ACTIVE_LIMIT = 500;
/** Histórico de ocorrências por página; as Rules aceitam `limit <= 101`. */
export const RECURRING_OCCURRENCES_PAGE_SIZE = 24;
/** Ocorrências que pedem ação, mais antigas primeiro, com corte sinalizado. */
export const RECURRING_OPEN_OCCURRENCES_LIMIT = 50;
/** Reajustes exibidos; as Rules da trilha aceitam `limit <= 50`. */
export const RECURRING_AMOUNT_HISTORY_LIMIT = 20;

/** Estados que pedem ação do usuário e estados já resolvidos. */
const OPEN_STATUSES = ['awaiting_confirmation', 'attention_required'];
const RESOLVED_STATUSES = ['generated', 'ignored'];

const isReady = (workspaceId?: string): workspaceId is string =>
  Boolean(workspaceId) && workspaceId !== 'loading';

const reportInvalid = (kind: string, id: string) => {
  console.error(`Documento de ${kind} fora do formato autoritativo ignorado: ${id}`);
};

export interface RecurringPage {
  items: RecurringExpense[];
  nextCursor?: string;
  hasMore: boolean;
}

/** Contratos (todos os estados), uma página por vez, por ID. */
export const listRecurringExpenses = async (
  workspaceId: string | undefined,
  options: { cursor?: string } = {},
): Promise<RecurringPage> => {
  if (!isReady(workspaceId)) return { items: [], hasMore: false };
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, EXPENSES_COLL),
    orderBy(documentId()),
    ...(options.cursor ? [startAfter(options.cursor)] : []),
    limit(RECURRING_PAGE_SIZE + 1),
  ));
  const docs = snapshot.docs.slice(0, RECURRING_PAGE_SIZE);
  const items: RecurringExpense[] = [];
  for (const entry of docs) {
    const expense = toRecurringExpense(entry.id, entry.data());
    if (expense) items.push(expense);
    else reportInvalid('recorrência', entry.id);
  }
  return {
    items,
    nextCursor: docs[docs.length - 1]?.id,
    hasMore: snapshot.size > RECURRING_PAGE_SIZE,
  };
};

/** Contratos ativos (para os resumos), filtrados no servidor e com teto. */
export const listActiveRecurringExpenses = async (
  workspaceId: string | undefined,
): Promise<{ items: RecurringExpense[]; truncated: boolean }> => {
  if (!isReady(workspaceId)) return { items: [], truncated: false };
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, EXPENSES_COLL),
    where('status', '==', 'active'),
    orderBy(documentId()),
    limit(RECURRING_ACTIVE_LIMIT + 1),
  ));
  const items: RecurringExpense[] = [];
  for (const entry of snapshot.docs.slice(0, RECURRING_ACTIVE_LIMIT)) {
    const expense = toRecurringExpense(entry.id, entry.data());
    if (expense) items.push(expense);
    else reportInvalid('recorrência', entry.id);
  }
  return { items, truncated: snapshot.size > RECURRING_ACTIVE_LIMIT };
};

export const getRecurringExpense = async (
  id: string,
  workspaceId: string | undefined,
): Promise<RecurringExpense | null> => {
  if (!isReady(workspaceId)) return null;
  const snapshot = await getDoc(doc(db, 'workspaces', workspaceId, EXPENSES_COLL, id));
  if (!snapshot.exists()) return null;
  const expense = toRecurringExpense(snapshot.id, snapshot.data());
  if (!expense) reportInvalid('recorrência', snapshot.id);
  return expense;
};

/** Cursor do histórico de ocorrências: o último (vencimento, ID) exibido. */
export interface OccurrenceCursor {
  dueDate: string;
  id: string;
}

export interface OccurrencePage {
  items: RecurringOccurrence[];
  nextCursor?: OccurrenceCursor;
  hasMore: boolean;
}

const adaptOccurrences = (docs: readonly QueryDocumentSnapshot[]): RecurringOccurrence[] => {
  const items: RecurringOccurrence[] = [];
  for (const entry of docs) {
    const occurrence = toRecurringOccurrence(entry.id, entry.data());
    if (occurrence) items.push(occurrence);
    else reportInvalid('ocorrência', entry.id);
  }
  return items;
};

/**
 * Histórico de ocorrências resolvidas (geradas e ignoradas), mais recentes
 * primeiro, uma página por vez, com cursor por (vencimento, ID).
 */
export const listRecurringOccurrences = async (
  recurringExpenseId: string,
  workspaceId: string | undefined,
  options: { cursor?: OccurrenceCursor } = {},
): Promise<OccurrencePage> => {
  if (!isReady(workspaceId)) return { items: [], hasMore: false };
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, OCCURRENCES_COLL),
    where('recurringExpenseId', '==', recurringExpenseId),
    where('status', 'in', RESOLVED_STATUSES),
    orderBy('dueDate', 'desc'),
    orderBy(documentId(), 'desc'),
    ...(options.cursor ? [startAfter(options.cursor.dueDate, options.cursor.id)] : []),
    limit(RECURRING_OCCURRENCES_PAGE_SIZE + 1),
  ));
  const docs = snapshot.docs.slice(0, RECURRING_OCCURRENCES_PAGE_SIZE);
  const last = docs[docs.length - 1];
  return {
    items: adaptOccurrences(docs),
    nextCursor: last ? { dueDate: String(last.get('dueDate')), id: last.id } : undefined,
    hasMore: snapshot.size > RECURRING_OCCURRENCES_PAGE_SIZE,
  };
};

/**
 * Ocorrências que pedem ação (aguardando confirmação ou com atenção), mais
 * antigas primeiro, filtradas no servidor e com teto; o corte é sinalizado.
 */
export const listOpenOccurrences = async (
  recurringExpenseId: string,
  workspaceId: string | undefined,
): Promise<{ items: RecurringOccurrence[]; truncated: boolean }> => {
  if (!isReady(workspaceId)) return { items: [], truncated: false };
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, OCCURRENCES_COLL),
    where('recurringExpenseId', '==', recurringExpenseId),
    where('status', 'in', OPEN_STATUSES),
    orderBy('dueDate', 'asc'),
    orderBy(documentId(), 'asc'),
    limit(RECURRING_OPEN_OCCURRENCES_LIMIT + 1),
  ));
  return {
    items: adaptOccurrences(snapshot.docs.slice(0, RECURRING_OPEN_OCCURRENCES_LIMIT)),
    truncated: snapshot.size > RECURRING_OPEN_OCCURRENCES_LIMIT,
  };
};

/** Histórico de valores (criação e reajustes), da trilha append-only. */
export const listAmountHistory = async (
  recurringExpenseId: string,
  workspaceId: string | undefined,
): Promise<{ items: RecurringAmountChange[]; truncated: boolean }> => {
  if (!isReady(workspaceId)) return { items: [], truncated: false };
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, EVENTS_COLL),
    where('recurringExpenseId', '==', recurringExpenseId),
    where('amountChanged', '==', true),
    orderBy('occurredAt', 'desc'),
    orderBy(documentId(), 'desc'),
    limit(RECURRING_AMOUNT_HISTORY_LIMIT + 1),
  ));
  const items: RecurringAmountChange[] = [];
  for (const entry of snapshot.docs.slice(0, RECURRING_AMOUNT_HISTORY_LIMIT)) {
    const change = toAmountChange(entry.id, entry.data());
    if (change) items.push(change);
  }
  return { items, truncated: snapshot.size > RECURRING_AMOUNT_HISTORY_LIMIT };
};

const IN_CHUNK = 30;

const chunksOf = (ids: readonly string[]): string[][] => {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += IN_CHUNK) {
    chunks.push(unique.slice(index, index + IN_CHUNK));
  }
  return chunks;
};

/**
 * Estado atual dos fatos gerados (lançamentos de caixa e compras de cartão),
 * por ID, em lotes de 30 — uma consulta por lote, não uma por ocorrência.
 */
export const getGeneratedFacts = async (
  refs: { cashTransactionIds: readonly string[]; cardPurchaseIds: readonly string[] },
  workspaceId: string | undefined,
): Promise<Record<string, GeneratedFactState>> => {
  if (!isReady(workspaceId)) return {};
  const facts: Record<string, GeneratedFactState> = {};
  const read = async (
    coll: string,
    ids: readonly string[],
    adapt: (data: Record<string, unknown>) => GeneratedFactState | null,
  ) => {
    const pages = await Promise.all(chunksOf(ids).map((chunk) => getDocs(query(
      collection(db, 'workspaces', workspaceId, coll),
      where(documentId(), 'in', chunk),
      limit(IN_CHUNK),
    ))));
    for (const page of pages) {
      for (const entry of page.docs) {
        const state = adapt(entry.data());
        if (state) facts[entry.id] = state;
      }
    }
  };
  await Promise.all([
    read('transactions', refs.cashTransactionIds, toCashFactState),
    read('credit_card_purchases', refs.cardPurchaseIds, toCardFactState),
  ]);
  return facts;
};

const invoke: RecurringInvoke = async <TResult>(name: string, payload: Record<string, unknown>) =>
  (await httpsCallable<Record<string, unknown>, TResult>(functions, name)(payload)).data;

/** Callables de Recorrentes (contrato em `callables.ts`), ligadas ao SDK. */
export const recurringCallables = createRecurringCallables(invoke);
