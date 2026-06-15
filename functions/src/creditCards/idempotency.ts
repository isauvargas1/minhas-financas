import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import {createHash} from "crypto";

import {
  creditCardIdempotencyDoc,
} from "./adminPaths";

import {
  CreditCardApplicationError,
} from "./errors";

import type {
  CreditCardBackendWriteOperation,
} from "./writeStrategy";

export type CreditCardIdempotencyStatus =
  | "started"
  | "completed"
  | "failed";

export interface CreditCardIdempotencyRecord {
  id: string;
  workspaceId: string;
  operation: CreditCardBackendWriteOperation;
  idempotencyKeyHash: string;
  requestHash: string;
  status: CreditCardIdempotencyStatus;
  createdAt: FieldValue;
  updatedAt: FieldValue;
  completedAt?: FieldValue;
  failedAt?: FieldValue;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
}

export interface ReserveIdempotencyKeyInput {
  workspaceId: string;
  operation: CreditCardBackendWriteOperation;
  idempotencyKey: string;
  requestPayload: unknown;
}

export interface ReserveIdempotencyKeyResult {
  ref: admin.firestore.DocumentReference;
  documentId: string;
  requestHash: string;
  replayResult?: Record<string, unknown>;
}

const hashValue = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);

  return `{${entries.join(",")}}`;
};

export const buildIdempotencyDocumentId = (
  operation: CreditCardBackendWriteOperation,
  idempotencyKey: string
): string => `${operation}_${hashValue(idempotencyKey).slice(0, 32)}`;

export const buildRequestHash = (requestPayload: unknown): string =>
  hashValue(stableStringify(requestPayload));

export const reserveIdempotencyKey = async (
  transaction: admin.firestore.Transaction,
  input: ReserveIdempotencyKeyInput
): Promise<ReserveIdempotencyKeyResult> => {
  const documentId = buildIdempotencyDocumentId(
    input.operation,
    input.idempotencyKey
  );
  const ref = creditCardIdempotencyDoc(input.workspaceId, documentId);
  const requestHash = buildRequestHash(input.requestPayload);
  const snapshot = await transaction.get(ref);

  if (snapshot.exists) {
    const data = snapshot.data();

    if (data?.requestHash !== requestHash) {
      throw new CreditCardApplicationError(
        "idempotency_conflict",
        "A chave de idempotência já foi usada com outro payload.",
        {operation: input.operation}
      );
    }

    if (data?.status === "completed") {
      return {
        ref,
        documentId,
        requestHash,
        replayResult: data.result as Record<string, unknown> | undefined,
      };
    }

    throw new CreditCardApplicationError(
      "idempotency_conflict",
      "Esta operação já está em processamento.",
      {operation: input.operation}
    );
  }

  transaction.set(ref, {
    id: documentId,
    workspaceId: input.workspaceId,
    operation: input.operation,
    idempotencyKeyHash: hashValue(input.idempotencyKey),
    requestHash,
    status: "started",
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    ref,
    documentId,
    requestHash,
  };
};

export const markIdempotencyKeyCompleted = (
  transaction: admin.firestore.Transaction,
  ref: admin.firestore.DocumentReference,
  result: Record<string, unknown>
): void => {
  transaction.update(ref, {
    status: "completed",
    result,
    completedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
};

export const markIdempotencyKeyFailed = (
  transaction: admin.firestore.Transaction,
  ref: admin.firestore.DocumentReference,
  error: Record<string, unknown>
): void => {
  transaction.update(ref, {
    status: "failed",
    error,
    failedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
};