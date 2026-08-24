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
import { httpsCallable } from "firebase/functions";

import { db, functions } from "../../lib/firebase";
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
      if (Array.isArray(v)) {
        out[k] = v.map((entry) => (
          entry && typeof entry === "object" && Object.getPrototypeOf(entry) === Object.prototype
            ? stripUndefined(entry)
            : entry
        )) as T[keyof T];
      } else if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
        out[k] = stripUndefined(v) as T[keyof T];
      } else {
        out[k] = v;
      }
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
    investmentMetadata: data.investmentMetadata ? {
      ...data.investmentMetadata,
      settlementDate: toDateOnlyString(data.investmentMetadata.settlementDate),
      sourceMovementId: String(data.investmentMetadata.sourceMovementId),
      reversalMovementId: data.investmentMetadata.reversalMovementId
        ? String(data.investmentMetadata.reversalMovementId)
        : undefined,
    } : undefined,
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

const newIdempotencyKey = () => crypto.randomUUID();

const callInvestmentFunction = async <TResult>(
  name: string,
  payload: Record<string, unknown>,
): Promise<TResult> => {
  const callable = httpsCallable<Record<string, unknown>, TResult>(functions, name);
  const result = await callable(payload);
  return result.data;
};

const saveRedemption = async (
  workspaceId: string,
  transaction: Omit<Transaction, "id">,
  transactionId?: string,
): Promise<{transactionId: string}> => {
  const metadata = transaction.investmentMetadata;
  if (!metadata || metadata.investmentOperation !== "redemption") {
    throw new Error("Resgate inválido.");
  }
  return callInvestmentFunction("saveInvestmentRedemption", {
    workspaceId,
    idempotencyKey: metadata.idempotencyKey,
    correlationId: `transaction-ui-${metadata.idempotencyKey}`,
    ...(transactionId ? {transactionId} : {}),
    redemption: {
      sourceMovementId: metadata.sourceMovementId,
      description: transaction.description,
      principal: metadata.principalCents / 100,
      gain: metadata.gainCents / 100,
      fees: metadata.feesCents / 100,
      tax: metadata.taxCents / 100,
      settlementDate: metadata.settlementDate ?? transaction.date,
      status: metadata.status,
    },
  });
};

const saveLinkedContribution = async (
  workspaceId: string,
  transaction: Omit<Transaction, "id">,
  transactionId?: string,
): Promise<{transactionId: string}> => {
  if (transaction.type !== "investimento" || !transaction.goalId) {
    throw new Error("Aporte vinculado inválido.");
  }
  const displaySnapshots = transaction.displaySnapshots
    ? stripUndefined({
        categorySnapshot: transaction.displaySnapshots.categorySnapshot,
        walletSnapshot: transaction.displaySnapshots.walletSnapshot,
      })
    : undefined;
  const contribution = stripUndefined({
    goalId: transaction.goalId,
    description: transaction.description,
    category: transaction.category,
    value: transaction.value,
    date: transaction.date,
    walletId: transaction.walletId,
    isPaid: transaction.isPaid === true,
    supplier: transaction.supplier,
    costCenter: transaction.costCenter,
    displaySnapshots,
  });
  const callable = httpsCallable(functions, "saveGoalContribution");
  const result = await callable({
    workspaceId,
    idempotencyKey: newIdempotencyKey(),
    ...(transactionId ? {transactionId} : {}),
    contribution,
  });
  return result.data as {transactionId: string};
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

  if (transaction.investmentMetadata?.investmentOperation === "redemption") {
    const result = await saveRedemption(workspaceId, transaction);
    return {id: result.transactionId, ...transaction, workspaceId, profileId: workspaceId};
  }

  if (transaction.type === "investimento" && transaction.goalId) {
    const result = await saveLinkedContribution(workspaceId, transaction);
    return {id: result.transactionId, ...transaction, workspaceId, profileId: workspaceId};
  }

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

  if (transaction.investmentMetadata?.investmentOperation === "redemption") {
    await saveRedemption(workspaceId, data, String(id));
    return;
  }

  if (transaction.type === "investimento" && transaction.goalId) {
    await saveLinkedContribution(workspaceId, data, String(id));
    return;
  }
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
  transaction: Transaction,
): Promise<void> => {
  assertValidWorkspaceId(workspaceId);

  if (transaction.investmentMetadata?.investmentOperation === "redemption") {
    const idempotencyKey = newIdempotencyKey();
    if (transaction.investmentMetadata.status === "pending") {
      await callInvestmentFunction("cancelInvestmentRedemption", {
        workspaceId,
        idempotencyKey,
        correlationId: `transaction-ui-${idempotencyKey}`,
        transactionId: String(transaction.id),
        reason: "Cancelado pelo usuário",
      });
      return;
    }
    if (transaction.investmentMetadata.status === "settled") {
      await callInvestmentFunction("reverseInvestmentRedemption", {
        workspaceId,
        idempotencyKey,
        correlationId: `transaction-ui-${idempotencyKey}`,
        transactionId: String(transaction.id),
        reversalDate: new Date().toISOString().slice(0, 10),
        reason: "Estornado pelo usuário",
      });
      return;
    }
    throw new Error("Este resgate não pode ser alterado novamente.");
  }

  const docRef = doc(db, "workspaces", workspaceId, "transactions", String(transaction.id));
  await deleteDoc(docRef);
};
