import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../lib/firebase';
import {
  toCardEvent,
  toCardInvoice,
  toCardInvoiceEntry,
  toCardPayment,
  toCardPurchase,
  toCreditCard,
} from './adapters';
import { createCardsCallables, type CardsInvoke } from './callables';
import type {
  CardEvent,
  CardInvoice,
  CardInvoiceEntry,
  CardPayment,
  CardPurchase,
  CreditCard,
} from './types';

/**
 * Leitura do domínio de cartões e ligação das callables (P4-A).
 *
 * Este módulo só **lê** (`getDocs`), sempre com teto — sem listener e sem
 * varredura. Toda escrita é das callables do backend; as Rules negam ao
 * cliente criar, alterar ou apagar qualquer documento do domínio, inclusive
 * `credit_cards`, e a guarda `tests/unit/cards-no-client-writes.test.ts`
 * falha se uma operação de escrita do Firestore aparecer aqui.
 *
 * Sem corte silencioso (PR-CC-07): cada lista pede um documento a mais que o
 * teto; se ele vier, a resposta diz `truncated: true` e a tela avisa.
 */
const CARDS_COLL = 'credit_cards';
const PURCHASES_COLL = 'credit_card_purchases';
const INVOICES_COLL = 'credit_card_invoices';
const ENTRIES_COLL = 'credit_card_invoice_entries';
const PAYMENTS_COLL = 'credit_card_invoice_payments';
const EVENTS_COLL = 'credit_card_events';

/** Teto da lista de cartões: o mesmo do backend e das Rules. */
export const CARDS_LIMIT = 50;
/** Teto de documentos por lista; as Rules aceitam `limit <= 501` (sonda). */
export const LIST_LIMIT = 500;
/** Faturas abertas por cartão: as futuras chegam a 60 competências. */
export const OPEN_INVOICES_LIMIT = 61;
export const CLOSED_INVOICES_PAGE_SIZE = 12;
export const RECENT_PURCHASES_LIMIT = 10;
export const CARD_EVENTS_LIMIT = 20;

const isReady = (workspaceId?: string): workspaceId is string =>
  Boolean(workspaceId) && workspaceId !== 'loading';

const reportInvalid = (kind: string, id: string) => {
  console.error(`Documento de ${kind} fora do formato autoritativo ignorado: ${id}`);
};

export interface Bounded<TItem> {
  items: TItem[];
  /** Havia mais documentos que o teto: a lista não está completa. */
  truncated: boolean;
}

const readBounded = async <TItem>(
  workspaceId: string,
  coll: string,
  constraints: QueryConstraint[],
  max: number,
  adapt: (id: string, data: Record<string, unknown>) => TItem | null,
  kind: string,
): Promise<Bounded<TItem>> => {
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, coll),
    ...constraints,
    limit(max + 1),
  ));
  const items: TItem[] = [];
  for (const entry of snapshot.docs.slice(0, max)) {
    const item = adapt(entry.id, entry.data());
    if (item) items.push(item);
    else reportInvalid(kind, entry.id);
  }
  return { items, truncated: snapshot.size > max };
};

/** Cartões (ativos e arquivados) por nome; o backend não passa de 50. */
export const listCreditCards = async (workspaceId?: string): Promise<CreditCard[]> => {
  if (!isReady(workspaceId)) return [];
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, CARDS_COLL),
    orderBy('name'),
    orderBy(documentId()),
    limit(CARDS_LIMIT),
  ));
  const items: CreditCard[] = [];
  for (const entry of snapshot.docs) {
    const card = toCreditCard(entry.id, entry.data());
    if (card) items.push(card);
    else reportInvalid('cartão', entry.id);
  }
  return items;
};

/** Faturas abertas do cartão (a atual e as futuras), em ordem de competência. */
export const listOpenInvoices = async (
  cardId: string,
  workspaceId?: string,
): Promise<Bounded<CardInvoice>> => {
  if (!isReady(workspaceId)) return { items: [], truncated: false };
  return readBounded(workspaceId, INVOICES_COLL, [
    where('cardId', '==', cardId),
    where('cycleStatus', '==', 'open'),
    orderBy('competenceMonth', 'asc'),
  ], OPEN_INVOICES_LIMIT, toCardInvoice, 'fatura');
};

/** Histórico de faturas fechadas, mais recente primeiro, por página. */
export const listClosedInvoices = async (
  cardId: string,
  workspaceId?: string,
  cursor?: string,
): Promise<{ items: CardInvoice[]; nextCursor?: string; hasMore: boolean }> => {
  if (!isReady(workspaceId)) return { items: [], hasMore: false };
  const page = await readBounded(workspaceId, INVOICES_COLL, [
    where('cardId', '==', cardId),
    where('cycleStatus', '==', 'closed'),
    orderBy('competenceMonth', 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
  ], CLOSED_INVOICES_PAGE_SIZE, toCardInvoice, 'fatura');
  const last = page.items[page.items.length - 1];
  return { items: page.items, nextCursor: last?.competenceMonth, hasMore: page.truncated };
};

/** Lançamentos ativos de uma fatura (até 500, com corte sinalizado). */
export const listInvoiceEntries = async (
  invoiceId: string,
  workspaceId?: string,
): Promise<Bounded<CardInvoiceEntry>> => {
  if (!isReady(workspaceId)) return { items: [], truncated: false };
  return readBounded(workspaceId, ENTRIES_COLL, [
    where('invoiceId', '==', invoiceId),
    where('status', '==', 'active'),
    orderBy('createdAt', 'asc'),
  ], LIST_LIMIT, toCardInvoiceEntry, 'lançamento de fatura');
};

/** Pagamentos e estornos de uma fatura, mais recente primeiro. */
export const listInvoicePayments = async (
  invoiceId: string,
  workspaceId?: string,
): Promise<Bounded<CardPayment>> => {
  if (!isReady(workspaceId)) return { items: [], truncated: false };
  return readBounded(workspaceId, PAYMENTS_COLL, [
    where('invoiceId', '==', invoiceId),
    orderBy('createdAt', 'desc'),
  ], LIST_LIMIT, toCardPayment, 'pagamento de fatura');
};

const IN_CHUNK = 30;

/** Compras por ID (para descrever os lançamentos), em lotes de 30. */
export const getPurchasesByIds = async (
  ids: readonly string[],
  workspaceId?: string,
): Promise<CardPurchase[]> => {
  if (!isReady(workspaceId)) return [];
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += IN_CHUNK) {
    chunks.push(unique.slice(index, index + IN_CHUNK));
  }
  const pages = await Promise.all(chunks.map((chunk) => getDocs(query(
    collection(db, 'workspaces', workspaceId, PURCHASES_COLL),
    where(documentId(), 'in', chunk),
    limit(IN_CHUNK),
  ))));
  const items: CardPurchase[] = [];
  for (const page of pages) {
    for (const entry of page.docs) {
      const purchase = toCardPurchase(entry.id, entry.data());
      if (purchase) items.push(purchase);
      else reportInvalid('compra', entry.id);
    }
  }
  return items;
};

/** Compras recentes do cartão (mais recente primeiro). */
export const listRecentPurchases = async (
  cardId: string,
  workspaceId?: string,
): Promise<CardPurchase[]> => {
  if (!isReady(workspaceId)) return [];
  return (await readBounded(workspaceId, PURCHASES_COLL, [
    where('cardId', '==', cardId),
    orderBy('purchaseDate', 'desc'),
  ], RECENT_PURCHASES_LIMIT, toCardPurchase, 'compra')).items;
};

/** Auditoria recente do cartão (owner/admin; as Rules negam aos demais). */
export const listCardEvents = async (
  cardId: string,
  workspaceId?: string,
): Promise<CardEvent[]> => {
  if (!isReady(workspaceId)) return [];
  return (await readBounded(workspaceId, EVENTS_COLL, [
    where('cardId', '==', cardId),
    orderBy('occurredAt', 'desc'),
  ], CARD_EVENTS_LIMIT, toCardEvent, 'evento de cartão')).items;
};

// ---------------------------------------------------------------- relatórios

export interface CardReportRange {
  startDate?: string;
  endDate?: string;
}

const rangeConstraints = (field: string, range: CardReportRange): QueryConstraint[] => [
  ...(range.startDate ? [where(field, '>=', range.startDate)] : []),
  ...(range.endDate ? [where(field, '<=', range.endDate)] : []),
  orderBy(field, 'desc'),
];

/** Compras do período (por data da compra), com corte sinalizado. */
export const listPurchasesForReport = async (
  workspaceId: string | undefined,
  range: CardReportRange,
): Promise<Bounded<CardPurchase>> => {
  if (!isReady(workspaceId)) return { items: [], truncated: false };
  return readBounded(workspaceId, PURCHASES_COLL, rangeConstraints('purchaseDate', range),
    LIST_LIMIT, toCardPurchase, 'compra');
};

/** Pagamentos e estornos do período (por data do pagamento). */
export const listPaymentsForReport = async (
  workspaceId: string | undefined,
  range: CardReportRange,
): Promise<Bounded<CardPayment>> => {
  if (!isReady(workspaceId)) return { items: [], truncated: false };
  return readBounded(workspaceId, PAYMENTS_COLL, rangeConstraints('paymentDate', range),
    LIST_LIMIT, toCardPayment, 'pagamento de fatura');
};

/** Faturas com saldo (abertas e fechadas a pagar), por vencimento. */
export const listInvoicesWithBalanceForReport = async (
  workspaceId: string | undefined,
): Promise<Bounded<CardInvoice>> => {
  if (!isReady(workspaceId)) return { items: [], truncated: false };
  return readBounded(workspaceId, INVOICES_COLL, [
    where('paymentStatus', 'in', ['unpaid', 'partial']),
    orderBy('dueDate', 'asc'),
  ], LIST_LIMIT, toCardInvoice, 'fatura');
};

const invoke: CardsInvoke = async <TResult>(name: string, payload: Record<string, unknown>) =>
  (await httpsCallable<Record<string, unknown>, TResult>(functions, name)(payload)).data;

/** Callables de cartões (contrato em `callables.ts`), ligadas ao SDK. */
export const cardsCallables = createCardsCallables(invoke);
