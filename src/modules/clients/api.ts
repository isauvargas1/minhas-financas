import {
  collection,
  count,
  doc,
  documentId,
  getAggregateFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  sum,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../lib/firebase';
import {
  toClient,
  toClientPrivate,
  toReceivable,
  toReceivableMovement,
} from './adapters';
import { createClientsCallables, type ClientsInvoke } from './callables';
import { addDaysToDayKey } from './presentation';
import type {
  Client,
  ClientPrivate,
  Receivable,
  ReceivableMovement,
  ReceivableReportData,
  ReceivableTotals,
} from './types';

/**
 * Leitura de clientes e recebíveis e ligação das callables (P3-I).
 *
 * Este módulo só **lê** (`getDoc`, `getDocs`, agregados do servidor), sempre
 * paginado ou com teto, sem listener. Toda escrita é das callables do
 * backend; as Rules negam ao cliente criar, alterar ou apagar qualquer
 * documento dessas coleções, e a guarda
 * `tests/unit/clients-no-client-writes.test.ts` falha se uma operação de
 * escrita do Firestore voltar a este módulo.
 *
 * Dados pessoais (`client_private`) só são pedidos para owner/admin — quem
 * chama decide pelo papel; as Rules recusam member e viewer de qualquer modo.
 * Nada é baixado para depois ser escondido na tela.
 */
const CLIENTS_COLL = 'clients';
const PRIVATE_COLL = 'client_private';
const RECEIVABLES_COLL = 'receivables';
const MOVEMENTS_COLL = 'receivable_movements';

export const CLIENTS_PAGE_SIZE = 100;
export const RECEIVABLES_PAGE_SIZE = 100;
export const MOVEMENTS_PAGE_SIZE = 100;
/** Teto da lista de clientes ativos do formulário de recebível. */
export const CLIENT_OPTIONS_LIMIT = 500;
/** Teto da amostra (vencimentos mais recentes) do ranking de clientes. */
export const TOP_CLIENTS_SAMPLE_LIMIT = 500;
/** `in` do Firestore aceita até 30 valores. */
const IN_CHUNK = 30;

const isReady = (workspaceId?: string): workspaceId is string =>
  Boolean(workspaceId) && workspaceId !== 'loading';

const reportInvalid = (kind: string, id: string) => {
  // Só o ID: nenhum dado do cliente vai para o console.
  console.error(`Documento de ${kind} fora do formato autoritativo ignorado: ${id}`);
};

const chunks = <T,>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

const cents = (value: number | null | undefined): number =>
  Number.isSafeInteger(value) ? (value as number) : 0;

export interface Page<TItem, TCursor> {
  items: TItem[];
  nextCursor?: TCursor;
  hasMore: boolean;
}

/** Cursor por nome e ID (a ordenação da lista). */
export interface ClientCursor {
  name: string;
  id: string;
}

/** Clientes (ativos e arquivados) por nome, uma página por vez. */
export const listClients = async (
  workspaceId?: string,
  options: { pageSize?: number; cursor?: ClientCursor } = {},
): Promise<Page<Client, ClientCursor>> => {
  if (!isReady(workspaceId)) return { items: [], hasMore: false };
  const pageSize = options.pageSize ?? CLIENTS_PAGE_SIZE;
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, CLIENTS_COLL),
    orderBy('name'),
    orderBy(documentId()),
    ...(options.cursor ? [startAfter(options.cursor.name, options.cursor.id)] : []),
    // Um a mais para saber se há próxima página sem outra consulta.
    limit(pageSize + 1),
  ));
  const docs = snapshot.docs.slice(0, pageSize);
  const items: Client[] = [];
  for (const entry of docs) {
    const client = toClient(entry.id, entry.data());
    if (client) items.push(client);
    else reportInvalid('cliente', entry.id);
  }
  const last = docs[docs.length - 1];
  return {
    items,
    nextCursor: last ? { name: String(last.get('name') ?? ''), id: last.id } : undefined,
    hasMore: snapshot.size > pageSize,
  };
};

/** Clientes ativos para o formulário de recebível (índice `status, name`). */
export const listActiveClientOptions = async (
  workspaceId?: string,
): Promise<{ items: Client[]; truncated: boolean }> => {
  if (!isReady(workspaceId)) return { items: [], truncated: false };
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, CLIENTS_COLL),
    where('status', '==', 'active'),
    orderBy('name'),
    limit(CLIENT_OPTIONS_LIMIT),
  ));
  const items = snapshot.docs
    .map((entry) => toClient(entry.id, entry.data()))
    .filter((client): client is Client => client !== null);
  return { items, truncated: snapshot.size >= CLIENT_OPTIONS_LIMIT };
};

/** Clientes pelos IDs (nomes dos recebíveis fora das páginas carregadas). */
export const getClientsByIds = async (ids: string[], workspaceId?: string): Promise<Client[]> => {
  if (!isReady(workspaceId) || ids.length === 0) return [];
  const unique = Array.from(new Set(ids));
  const pages = await Promise.all(chunks(unique, IN_CHUNK).map((chunk) => getDocs(query(
    collection(db, 'workspaces', workspaceId, CLIENTS_COLL),
    where(documentId(), 'in', chunk),
    limit(chunk.length),
  ))));
  return pages.flatMap((page) => page.docs)
    .map((entry) => toClient(entry.id, entry.data()))
    .filter((client): client is Client => client !== null);
};

/**
 * Dados pessoais dos clientes listados — **só owner/admin** (as Rules exigem
 * o papel e o teto da listagem).
 */
export const listClientPrivate = async (
  ids: string[],
  workspaceId?: string,
): Promise<ClientPrivate[]> => {
  if (!isReady(workspaceId) || ids.length === 0) return [];
  const unique = Array.from(new Set(ids));
  const pages = await Promise.all(chunks(unique, IN_CHUNK).map((chunk) => getDocs(query(
    collection(db, 'workspaces', workspaceId, PRIVATE_COLL),
    where(documentId(), 'in', chunk),
    limit(chunk.length),
  ))));
  return pages.flatMap((page) => page.docs)
    .map((entry) => toClientPrivate(entry.id, entry.data()))
    .filter((personal): personal is ClientPrivate => personal !== null);
};

/** Dados pessoais de um cliente (formulário de edição, só owner/admin). */
export const getClientPrivate = async (
  clientId: string,
  workspaceId?: string,
): Promise<ClientPrivate | null> => {
  if (!isReady(workspaceId)) return null;
  const snapshot = await getDoc(doc(db, 'workspaces', workspaceId, PRIVATE_COLL, clientId));
  return snapshot.exists() ? toClientPrivate(snapshot.id, snapshot.data()) : null;
};

/** Cursor por vencimento e ID (a ordenação da lista). */
export interface ReceivableCursor {
  dueDate: string;
  id: string;
}

/** Recebíveis por vencimento (mais antigo primeiro), uma página por vez. */
export const listReceivables = async (
  workspaceId?: string,
  options: { pageSize?: number; cursor?: ReceivableCursor } = {},
): Promise<Page<Receivable, ReceivableCursor>> => {
  if (!isReady(workspaceId)) return { items: [], hasMore: false };
  const pageSize = options.pageSize ?? RECEIVABLES_PAGE_SIZE;
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, RECEIVABLES_COLL),
    orderBy('dueDate'),
    orderBy(documentId()),
    ...(options.cursor ? [startAfter(options.cursor.dueDate, options.cursor.id)] : []),
    limit(pageSize + 1),
  ));
  const docs = snapshot.docs.slice(0, pageSize);
  const items: Receivable[] = [];
  for (const entry of docs) {
    const receivable = toReceivable(entry.id, entry.data());
    if (receivable) items.push(receivable);
    else reportInvalid('recebível', entry.id);
  }
  const last = docs[docs.length - 1];
  return {
    items,
    nextCursor: last ? { dueDate: String(last.get('dueDate') ?? ''), id: last.id } : undefined,
    hasMore: snapshot.size > pageSize,
  };
};

/** Janela de "Próximos 7 dias": de hoje a hoje + 7, inclusive. */
export const UPCOMING_DAYS = 7;

/**
 * Totais dos cartões: soma do **saldo** dos recebíveis em aberto, feita pelo
 * servidor (índice `status, dueDate, balanceCents`). Recebidos e cancelados
 * ficam fora; o atraso é o mesmo recorte derivado da tela.
 */
export const getReceivableTotals = async (
  today: string,
  workspaceId?: string,
): Promise<ReceivableTotals> => {
  if (!isReady(workspaceId)) return { openCents: 0, overdueCents: 0, upcomingCents: 0 };
  const ref = collection(db, 'workspaces', workspaceId, RECEIVABLES_COLL);
  const open = where('status', '==', 'open');
  const [all, overdue, upcoming] = await Promise.all([
    getAggregateFromServer(query(ref, open), { total: sum('balanceCents') }),
    getAggregateFromServer(query(ref, open, where('dueDate', '<', today)), { total: sum('balanceCents') }),
    getAggregateFromServer(query(
      ref, open,
      where('dueDate', '>=', today),
      where('dueDate', '<=', addDaysToDayKey(today, UPCOMING_DAYS)),
    ), { total: sum('balanceCents') }),
  ]);
  return {
    openCents: cents(all.data().total),
    overdueCents: cents(overdue.data().total),
    upcomingCents: cents(upcoming.data().total),
  };
};

/** Recebíveis em aberto de um cliente (para explicar o bloqueio do arquivamento). */
export const countOpenReceivablesOfClient = async (
  clientId: string,
  workspaceId?: string,
): Promise<number> => {
  if (!isReady(workspaceId)) return 0;
  const result = await getAggregateFromServer(query(
    collection(db, 'workspaces', workspaceId, RECEIVABLES_COLL),
    where('clientId', '==', clientId),
    where('status', '==', 'open'),
  ), { total: count() });
  return result.data().total ?? 0;
};

export interface MovementCursor {
  date: string;
  id: string;
}

/** Histórico de um recebível, do mais recente ao mais antigo (data, ID). */
export const listReceivableMovements = async (
  receivableId: string,
  workspaceId?: string,
  options: { pageSize?: number; cursor?: MovementCursor } = {},
): Promise<Page<ReceivableMovement, MovementCursor>> => {
  if (!isReady(workspaceId)) return { items: [], hasMore: false };
  const pageSize = options.pageSize ?? MOVEMENTS_PAGE_SIZE;
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, MOVEMENTS_COLL),
    where('receivableId', '==', receivableId),
    orderBy('date', 'desc'),
    orderBy(documentId(), 'desc'),
    ...(options.cursor ? [startAfter(options.cursor.date, options.cursor.id)] : []),
    limit(pageSize + 1),
  ));
  const docs = snapshot.docs.slice(0, pageSize);
  const items: ReceivableMovement[] = [];
  for (const entry of docs) {
    const movement = toReceivableMovement(entry.id, entry.data());
    if (movement) items.push(movement);
    else reportInvalid('movimento de recebível', entry.id);
  }
  const last = docs[docs.length - 1];
  return {
    items,
    nextCursor: last ? { date: String(last.get('date') ?? ''), id: last.id } : undefined,
    hasMore: snapshot.size > pageSize,
  };
};

/**
 * Indicadores de recebíveis do relatório PJ.
 *
 * Situação (em aberto, em atraso, recebido): agregados exatos do servidor.
 * Ranking de clientes: valor original dos recebíveis não cancelados numa
 * amostra com teto (os vencimentos mais recentes) — exato até o teto e
 * marcado como parcial acima dele. O agregado por cliente no servidor é
 * dívida registrada para a P5.
 */
export const getReceivableReportData = async (
  today: string,
  workspaceId?: string,
): Promise<ReceivableReportData | null> => {
  if (!isReady(workspaceId)) return null;
  const ref = collection(db, 'workspaces', workspaceId, RECEIVABLES_COLL);
  const open = where('status', '==', 'open');
  const [inDay, late, received, sample] = await Promise.all([
    getAggregateFromServer(query(ref, open, where('dueDate', '>=', today)),
      { count: count(), total: sum('balanceCents') }),
    getAggregateFromServer(query(ref, open, where('dueDate', '<', today)),
      { count: count(), total: sum('balanceCents') }),
    getAggregateFromServer(query(ref, where('status', '==', 'received')),
      { count: count(), total: sum('principalReceivedCents') }),
    getDocs(query(ref, orderBy('dueDate', 'desc'), limit(TOP_CLIENTS_SAMPLE_LIMIT))),
  ]);

  const byClient = new Map<string, number>();
  for (const entry of sample.docs) {
    const receivable = toReceivable(entry.id, entry.data());
    if (!receivable || receivable.status === 'cancelled') continue;
    byClient.set(receivable.clientId,
      (byClient.get(receivable.clientId) ?? 0) + receivable.amountCents);
  }
  const top = Array.from(byClient.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);
  const names = new Map((await getClientsByIds(top.map(([id]) => id), workspaceId))
    .map((client) => [client.id, client.name]));
  return {
    openNotOverdue: { count: inDay.data().count ?? 0, balanceCents: cents(inDay.data().total) },
    overdue: { count: late.data().count ?? 0, balanceCents: cents(late.data().total) },
    received: { count: received.data().count ?? 0, principalCents: cents(received.data().total) },
    topClients: top.map(([clientId, amountCents]) => ({
      clientId,
      clientName: names.get(clientId) ?? 'Cliente',
      amountCents,
    })),
    topClientsTruncated: sample.size >= TOP_CLIENTS_SAMPLE_LIMIT,
  };
};

const invoke: ClientsInvoke = async <TResult>(name: string, payload: Record<string, unknown>) =>
  (await httpsCallable<Record<string, unknown>, TResult>(functions, name)(payload)).data;

/** Callables de clientes e recebíveis (contrato em `callables.ts`), ligadas ao SDK. */
export const clientsCallables = createClientsCallables(invoke);
