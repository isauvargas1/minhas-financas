import {
  collection,
  doc,
  documentId,
  getAggregateFromServer,
  getDoc,
  getDocs,
  count,
  limit,
  orderBy,
  query,
  startAfter,
  sum,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../lib/firebase';
import { toLoan, toLoanMovement } from './adapters';
import { createLoanCallables, type LoanInvoke } from './callables';
import type { Loan, LoanMovement, LoanStatus } from './types';

/**
 * Leitura de empréstimos e ligação das callables (P3-H).
 *
 * Este módulo só **lê** `loans` e `loan_movements` (`getDoc`, `getDocs`,
 * agregados). Toda escrita é das callables do backend; as Rules negam ao
 * cliente criar, alterar ou apagar qualquer documento dessas coleções, e a
 * guarda `tests/unit/loans-no-client-writes.test.ts` falha se uma operação de
 * escrita do Firestore voltar ao frontend de empréstimos.
 */
const LOANS_COLL = 'loans';
const MOVEMENTS_COLL = 'loan_movements';

export const LOANS_PAGE_SIZE = 100;
export const LOAN_MOVEMENTS_PAGE_SIZE = 100;

export interface LoanPage {
  items: Loan[];
  /** ID do último documento da página; `undefined` quando acabou. */
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Cursor de movimentações: `date` e ID, um valor por campo da ordenação. Só o
 * ID compararia o identificador com as datas e repetiria a primeira página.
 */
export interface LoanMovementCursor {
  date: string;
  id: string;
}

export interface LoanMovementPage {
  items: LoanMovement[];
  nextCursor?: LoanMovementCursor;
  hasMore: boolean;
}

/** Totais em centavos, somados pelo servidor sobre todos os contratos. */
export interface LoanTotals {
  lendCents: number;
  borrowCents: number;
  overdue: number;
}

/**
 * Saldo em aberto: só contrato em dia ou em atraso. Quitado tem saldo zero e
 * cancelado não tem saldo em aberto (o principal foi compensado no caixa).
 */
const OPEN_STATUSES: LoanStatus[] = ['active', 'overdue'];

const isReady = (workspaceId?: string): workspaceId is string =>
  Boolean(workspaceId) && workspaceId !== 'loading';

const reportInvalid = (kind: string, id: string) => {
  // Só o ID: nenhum dado da contraparte vai para o console.
  console.error(`Documento de ${kind} fora do formato autoritativo ignorado: ${id}`);
};

/** Uma página de empréstimos, por ID (todo documento tem ID). */
export const listLoans = async (
  workspaceId?: string,
  options: { pageSize?: number; cursor?: string } = {},
): Promise<LoanPage> => {
  if (!isReady(workspaceId)) return { items: [], hasMore: false };
  const pageSize = options.pageSize ?? LOANS_PAGE_SIZE;
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, LOANS_COLL),
    orderBy(documentId()),
    ...(options.cursor ? [startAfter(options.cursor)] : []),
    // Um a mais para saber se há próxima página sem outra consulta.
    limit(pageSize + 1),
  ));
  const docs = snapshot.docs.slice(0, pageSize);
  const items: Loan[] = [];
  for (const entry of docs) {
    const loan = toLoan(entry.id, entry.data());
    if (loan) items.push(loan);
    else reportInvalid('empréstimo', entry.id);
  }
  return {
    items,
    nextCursor: docs[docs.length - 1]?.id,
    hasMore: snapshot.size > pageSize,
  };
};

/** Contrato pelo ID; `null` se não existir ou não for autoritativo. */
export const getLoan = async (id: string, workspaceId?: string): Promise<Loan | null> => {
  if (!isReady(workspaceId)) return null;
  const snapshot = await getDoc(doc(db, 'workspaces', workspaceId, LOANS_COLL, id));
  if (!snapshot.exists()) return null;
  const loan = toLoan(snapshot.id, snapshot.data());
  if (!loan) reportInvalid('empréstimo', snapshot.id);
  return loan;
};

/**
 * Saldo a receber, saldo a pagar e contratos em atraso: agregados do
 * servidor (índice `type, status, balanceCents`), exatos mesmo com a lista
 * paginada, sem trazer documento nenhum.
 */
export const getLoanTotals = async (workspaceId?: string): Promise<LoanTotals> => {
  if (!isReady(workspaceId)) return { lendCents: 0, borrowCents: 0, overdue: 0 };
  const ref = collection(db, 'workspaces', workspaceId, LOANS_COLL);
  const openOfType = (type: 'lend' | 'borrow') => query(
    ref,
    where('type', '==', type),
    where('status', 'in', OPEN_STATUSES),
  );
  const [lend, borrow, overdue] = await Promise.all([
    getAggregateFromServer(openOfType('lend'), { total: sum('balanceCents') }),
    getAggregateFromServer(openOfType('borrow'), { total: sum('balanceCents') }),
    getAggregateFromServer(query(ref, where('status', '==', 'overdue')), { total: count() }),
  ]);
  const cents = (value: number | null): number =>
    Number.isSafeInteger(value) ? (value as number) : 0;
  return {
    lendCents: cents(lend.data().total),
    borrowCents: cents(borrow.data().total),
    overdue: overdue.data().total ?? 0,
  };
};

/** Movimentos de um contrato, do mais recente ao mais antigo (data, ID). */
export const listMovements = async (
  loanId: string,
  workspaceId?: string,
  options: { pageSize?: number; cursor?: LoanMovementCursor } = {},
): Promise<LoanMovementPage> => {
  if (!isReady(workspaceId)) return { items: [], hasMore: false };
  const pageSize = options.pageSize ?? LOAN_MOVEMENTS_PAGE_SIZE;
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, MOVEMENTS_COLL),
    where('loanId', '==', loanId),
    orderBy('date', 'desc'),
    orderBy(documentId(), 'desc'),
    ...(options.cursor ? [startAfter(options.cursor.date, options.cursor.id)] : []),
    limit(pageSize + 1),
  ));
  const docs = snapshot.docs.slice(0, pageSize);
  const items: LoanMovement[] = [];
  for (const entry of docs) {
    const movement = toLoanMovement(entry.id, entry.data());
    if (movement) items.push(movement);
    else reportInvalid('movimento', entry.id);
  }
  const last = docs[docs.length - 1];
  return {
    items,
    nextCursor: last ? { date: String(last.get('date') ?? ''), id: last.id } : undefined,
    hasMore: snapshot.size > pageSize,
  };
};

const invoke: LoanInvoke = async <TResult>(name: string, payload: Record<string, unknown>) =>
  (await httpsCallable<Record<string, unknown>, TResult>(functions, name)(payload)).data;

/** Callables de empréstimos (contrato em `callables.ts`), ligadas ao SDK. */
export const loanCallables = createLoanCallables(invoke);
