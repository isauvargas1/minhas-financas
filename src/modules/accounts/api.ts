import {
  collection,
  documentId,
  getAggregateFromServer,
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
import { toCashAccount, toCashAccountMovement, toCashTransfer } from './adapters';
import { createAccountsCallables, type AccountsInvoke } from './callables';
import type { CashAccount, CashAccountMovement, CashTransfer } from './types';

/**
 * Leitura de contas, movimentos e transferências e ligação das callables
 * (D-30, P3-J).
 *
 * Este módulo só **lê** (`getDocs` e agregado do servidor), sempre com teto
 * ou paginado, sem listener. Toda escrita é das callables do backend; as
 * Rules negam ao cliente criar, alterar ou apagar qualquer documento dessas
 * coleções, e a guarda `tests/unit/accounts-no-client-writes.test.ts` falha
 * se uma operação de escrita do Firestore aparecer aqui.
 *
 * Saldos: a lista lê o `balanceCents` autoritativo de cada conta; o saldo
 * geral é a soma feita **pelo servidor** (`sum`) sobre as mesmas contas
 * listadas. Nada soma movimentos no navegador.
 */
const ACCOUNTS_COLL = 'cash_accounts';
const MOVEMENTS_COLL = 'cash_account_movements';
const TRANSFERS_COLL = 'cash_transfers';

/** Teto da lista de contas (o mesmo das Rules). */
export const ACCOUNTS_LIMIT = 100;
export const MOVEMENTS_PAGE_SIZE = 50;
export const TRANSFERS_PAGE_SIZE = 50;

const isReady = (workspaceId?: string): workspaceId is string =>
  Boolean(workspaceId) && workspaceId !== 'loading';

const reportInvalid = (kind: string, id: string) => {
  console.error(`Documento de ${kind} fora do formato autoritativo ignorado: ${id}`);
};

export interface Page<TItem, TCursor> {
  items: TItem[];
  nextCursor?: TCursor;
  hasMore: boolean;
}

/**
 * Contas (ativas e arquivadas) por nome. O backend não deixa o workspace
 * passar de `ACCOUNTS_LIMIT` contas (`CASH_ACCOUNT_LIMIT_PER_WORKSPACE`), então
 * uma página traz todas; `atLimit` sinaliza o teto atingido.
 */
export const listCashAccounts = async (
  workspaceId?: string,
): Promise<{ items: CashAccount[]; atLimit: boolean }> => {
  if (!isReady(workspaceId)) return { items: [], atLimit: false };
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, ACCOUNTS_COLL),
    orderBy('name'),
    orderBy(documentId()),
    limit(ACCOUNTS_LIMIT),
  ));
  const items: CashAccount[] = [];
  for (const entry of snapshot.docs) {
    const account = toCashAccount(entry.id, entry.data());
    if (account) items.push(account);
    else reportInvalid('conta', entry.id);
  }
  return { items, atLimit: snapshot.size >= ACCOUNTS_LIMIT };
};

/**
 * Saldo geral: soma do servidor sobre as contas do workspace (as mesmas, e
 * o mesmo teto, da lista). Resultado fora dos inteiros seguros é recusado.
 */
export const getCashAccountsTotal = async (workspaceId?: string): Promise<number> => {
  if (!isReady(workspaceId)) return 0;
  const aggregate = await getAggregateFromServer(query(
    collection(db, 'workspaces', workspaceId, ACCOUNTS_COLL),
    limit(ACCOUNTS_LIMIT),
  ), { total: sum('balanceCents') });
  const total = aggregate.data().total ?? 0;
  if (!Number.isSafeInteger(total)) {
    throw new Error('Saldo total fora dos limites de cálculo.');
  }
  return total || 0;
};

/** Cursor do extrato: data efetiva e ID (a ordenação). */
export interface MovementCursor {
  effectiveDate: string;
  id: string;
}

/** Extrato de uma conta, mais recente primeiro, uma página por vez. */
export const listCashAccountMovements = async (
  accountId: string,
  workspaceId?: string,
  options: { pageSize?: number; cursor?: MovementCursor } = {},
): Promise<Page<CashAccountMovement, MovementCursor>> => {
  if (!isReady(workspaceId)) return { items: [], hasMore: false };
  const pageSize = options.pageSize ?? MOVEMENTS_PAGE_SIZE;
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, MOVEMENTS_COLL),
    where('accountId', '==', accountId),
    orderBy('effectiveDate', 'desc'),
    orderBy(documentId(), 'desc'),
    ...(options.cursor ? [startAfter(options.cursor.effectiveDate, options.cursor.id)] : []),
    // Um a mais para saber se há próxima página sem outra consulta.
    limit(pageSize + 1),
  ));
  const docs = snapshot.docs.slice(0, pageSize);
  const items: CashAccountMovement[] = [];
  for (const entry of docs) {
    const movement = toCashAccountMovement(entry.id, entry.data());
    if (movement) items.push(movement);
    else reportInvalid('movimento de conta', entry.id);
  }
  const last = docs[docs.length - 1];
  return {
    items,
    nextCursor: last
      ? { effectiveDate: String(last.get('effectiveDate') ?? ''), id: last.id }
      : undefined,
    hasMore: snapshot.size > pageSize,
  };
};

/** Cursor do histórico de transferências: data e ID. */
export interface TransferCursor {
  date: string;
  id: string;
}

/** Transferências, mais recente primeiro, uma página por vez. */
export const listCashTransfers = async (
  workspaceId?: string,
  options: { pageSize?: number; cursor?: TransferCursor } = {},
): Promise<Page<CashTransfer, TransferCursor>> => {
  if (!isReady(workspaceId)) return { items: [], hasMore: false };
  const pageSize = options.pageSize ?? TRANSFERS_PAGE_SIZE;
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, TRANSFERS_COLL),
    orderBy('date', 'desc'),
    orderBy(documentId(), 'desc'),
    ...(options.cursor ? [startAfter(options.cursor.date, options.cursor.id)] : []),
    limit(pageSize + 1),
  ));
  const docs = snapshot.docs.slice(0, pageSize);
  const items: CashTransfer[] = [];
  for (const entry of docs) {
    const transfer = toCashTransfer(entry.id, entry.data());
    if (transfer) items.push(transfer);
    else reportInvalid('transferência', entry.id);
  }
  const last = docs[docs.length - 1];
  return {
    items,
    nextCursor: last ? { date: String(last.get('date') ?? ''), id: last.id } : undefined,
    hasMore: snapshot.size > pageSize,
  };
};

const invoke: AccountsInvoke = async <TResult>(name: string, payload: Record<string, unknown>) =>
  (await httpsCallable<Record<string, unknown>, TResult>(functions, name)(payload)).data;

/** Callables de contas e transferências (contrato em `callables.ts`), ligadas ao SDK. */
export const accountsCallables = createAccountsCallables(invoke);
