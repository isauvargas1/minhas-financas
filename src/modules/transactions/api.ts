import {
  collection,
  query,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../../lib/firebase";
import type { Transaction } from "../../types";

const txCol = (workspaceId: string) =>
  collection(db, "workspaces", workspaceId, "transactions");

const stripUndefined = <T extends Record<string, any>>(obj: T): Partial<T> => {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as (keyof T)[]) {
    const v = obj[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
};

export const getTransactions = async (
  workspaceId: string
): Promise<Transaction[]> => {
  const q = query(txCol(workspaceId), orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<Transaction, "id">),
  }));
};

export const createTransaction = async (
  workspaceId: string,
  transaction: Omit<Transaction, "id">
): Promise<Transaction> => {
  const docRef = await addDoc(
    txCol(workspaceId),
    stripUndefined({
      ...transaction,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  );

  return { id: docRef.id, ...transaction } as Transaction;
};

export const updateTransaction = async (
  workspaceId: string,
  transaction: Transaction
): Promise<void> => {
  const { id, ...data } = transaction;

  const docRef = doc(db, "workspaces", workspaceId, "transactions", String(id));
  await updateDoc(
    docRef,
    stripUndefined({
      ...data,
      updatedAt: serverTimestamp(),
    })
  );
};

export const deleteTransaction = async (
  workspaceId: string,
  id: string | number
): Promise<void> => {
  const docRef = doc(db, "workspaces", workspaceId, "transactions", String(id));
  await deleteDoc(docRef);
};
