import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  DocumentData,
  getDocs,
  QueryDocumentSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch
} from "firebase/firestore";

import { db } from "../../lib/firebase";
import type { Transaction } from "../../types";
import { toDateOnlyString, toFirestoreDateTimestamp } from "../../utils/date";

const txCol = (workspaceId: string) =>
  collection(db, "workspaces", workspaceId, "transactions");

function assertValidWorkspaceId(workspaceId: string | undefined): asserts workspaceId is string {
  if (!workspaceId || workspaceId === "loading") {
    throw new Error("Workspace ID inválido para operações de transação.");
  }
}

const stripUndefined = <T extends Record<string, any>>(obj: T): Partial<T> => {
  const out: Partial<T> = {};

  for (const k of Object.keys(obj) as (keyof T)[]) {
    const v = obj[k];
    if (v !== undefined) {
      out[k] = v;
    }
  }

  return out;
};

const getSortTime = (data: DocumentData): number => {
  if (data.createdAt && typeof data.createdAt.toMillis === "function") {
    return data.createdAt.toMillis();
  }

  if (data.transactionDate && typeof data.transactionDate.toMillis === "function") {
    return data.transactionDate.toMillis();
  }

  const dateOnly = toDateOnlyString(data.date);
  return dateOnly ? new Date(`${dateOnly}T12:00:00.000Z`).getTime() : 0;
};

const normalizeTransaction = (
  snapshot: QueryDocumentSnapshot<DocumentData>
): Transaction => {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    ...(data as Omit<Transaction, "id">),
    date: toDateOnlyString(data.date ?? data.transactionDate),
    cardId: data.cardId ? String(data.cardId) : undefined,
    goalId: data.goalId ? String(data.goalId) : undefined,
    workspaceId: data.workspaceId ?? snapshot.ref.parent.parent?.id
  };
};

const buildTransactionPayload = (
  workspaceId: string,
  transaction: Omit<Transaction, "id">
) => {
  return stripUndefined({
    ...transaction,
    date: toDateOnlyString(transaction.date),
    transactionDate: toFirestoreDateTimestamp(transaction.date),
    workspaceId,
    profileId: transaction.profileId ?? workspaceId
  });
};

export const getTransactions = async (workspaceId: string): Promise<Transaction[]> => {
  assertValidWorkspaceId(workspaceId);

  const snapshot = await getDocs(txCol(workspaceId));

  return snapshot.docs
    .sort((a, b) => getSortTime(b.data()) - getSortTime(a.data()))
    .map(normalizeTransaction);
};

export const createTransaction = async (
  workspaceId: string,
  transaction: Omit<Transaction, "id">
): Promise<Transaction> => {
  assertValidWorkspaceId(workspaceId);

  const normalizedTransaction = buildTransactionPayload(workspaceId, transaction);

  const docRef = await addDoc(
    txCol(workspaceId),
    stripUndefined({
      ...normalizedTransaction,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  );

  return {
    id: docRef.id,
    ...transaction,
    ...normalizedTransaction
  } as Transaction;
};

export const createTransactionsBatch = async (
  workspaceId: string,
  transactions: Omit<Transaction, "id">[]
): Promise<Transaction[]> => {
  assertValidWorkspaceId(workspaceId);

  if (transactions.length === 0) {
    return [];
  }

  const batch = writeBatch(db);
  const collectionRef = txCol(workspaceId);
  const createdTransactions: Transaction[] = [];

  transactions.forEach((transaction) => {
    const docRef = doc(collectionRef);
    const normalizedTransaction = buildTransactionPayload(workspaceId, transaction);

    batch.set(
      docRef,
      stripUndefined({
        ...normalizedTransaction,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      })
    );

    createdTransactions.push({
      id: docRef.id,
      ...transaction,
      ...normalizedTransaction
    } as Transaction);
  });

  await batch.commit();

  return createdTransactions;
};

export const updateTransaction = async (
  workspaceId: string,
  transaction: Transaction
): Promise<void> => {
  assertValidWorkspaceId(workspaceId);

  const { id, ...data } = transaction;
  const docRef = doc(db, "workspaces", workspaceId, "transactions", String(id));

  await updateDoc(
    docRef,
    stripUndefined({
      ...buildTransactionPayload(workspaceId, data as Omit<Transaction, "id">),
      updatedAt: serverTimestamp()
    })
  );
};

export const deleteTransaction = async (
  workspaceId: string,
  id: string | number
): Promise<void> => {
  assertValidWorkspaceId(workspaceId);

  const docRef = doc(db, "workspaces", workspaceId, "transactions", String(id));
  await deleteDoc(docRef);
};