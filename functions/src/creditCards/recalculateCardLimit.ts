import * as admin from "firebase-admin";

import type {
  CreditCardCallableExecutionContext,
} from "./callable";

import type {
  RecalculateCardLimitPayload,
} from "./contracts";

import {
  CREDIT_CARD_ADMIN_COLLECTIONS,
  cardFinancialEventDoc,
  cardLimitSnapshotDoc,
  creditCardDoc,
  getFirestore,
  workspaceCollection,
} from "./adminPaths";

import {
  CreditCardApplicationError,
} from "./errors";

import {
  markIdempotencyKeyCompleted,
  reserveIdempotencyKey,
} from "./idempotency";

export interface RecalculateCardLimitResult {
  success: true;
  cardId: string;
  eventId: string;
  ledgerEntriesCount: number;
  limitSnapshot: {
    cardId: string;
    limitTotal: number;
    limitUsed: number;
    limitAvailable: number;
  };
}

interface CreditCardData {
  id?: string;
  workspaceId?: string;
  status?: string;
  limitTotal?: number;
}

interface LedgerEntryData {
  id?: string;
  workspaceId?: string;
  cardId?: string;
  direction?: string;
  amount?: number;
}

const normalizeMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (
    Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null
  );

const stripUndefinedValues = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedValues);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefinedValues(entryValue)])
  );
};

const toFirestoreData = (
  data: Record<string, unknown>
): admin.firestore.DocumentData =>
  stripUndefinedValues(data) as admin.firestore.DocumentData;

const sumLedgerAmountsByDirection = (
  ledgerEntries: LedgerEntryData[],
  direction: "consume" | "restore"
): number =>
  normalizeMoney(
    ledgerEntries
      .filter((entry) => entry.direction === direction)
      .reduce((total, entry) => total + Number(entry.amount ?? 0), 0)
  );

const buildResult = (
  cardId: string,
  eventId: string,
  ledgerEntriesCount: number,
  limitTotal: number,
  limitUsed: number,
  limitAvailable: number
): RecalculateCardLimitResult => ({
  success: true,
  cardId,
  eventId,
  ledgerEntriesCount,
  limitSnapshot: {
    cardId,
    limitTotal,
    limitUsed,
    limitAvailable,
  },
});

export const executeRecalculateCardLimit = async (
  context: CreditCardCallableExecutionContext<RecalculateCardLimitPayload>
): Promise<RecalculateCardLimitResult | Record<string, unknown>> => {
  const {payload, auth} = context;
  const db = getFirestore();
  const operation = "recalculateCardLimit";

  return db.runTransaction(async (transaction) => {
    const workspaceId = payload.workspaceId;
    const cardRef = creditCardDoc(workspaceId, payload.cardId);
    const limitSnapshotRef = cardLimitSnapshotDoc(
      workspaceId,
      payload.cardId
    );
    const ledgerQuery = workspaceCollection(
      workspaceId,
      CREDIT_CARD_ADMIN_COLLECTIONS.limitLedger
    ).where("cardId", "==", payload.cardId);

    const [
      cardSnapshot,
      currentLimitSnapshot,
      ledgerSnapshot,
    ] = await Promise.all([
      transaction.get(cardRef),
      transaction.get(limitSnapshotRef),
      transaction.get(ledgerQuery),
    ]);

    if (!cardSnapshot.exists) {
      throw new CreditCardApplicationError(
        "not_found",
        "Cartão não encontrado.",
        {cardId: payload.cardId}
      );
    }

    const cardData = cardSnapshot.data() as CreditCardData | undefined;

    if (!cardData) {
      throw new CreditCardApplicationError(
        "internal",
        "Cartão existente sem dados carregados.",
        {cardId: payload.cardId}
      );
    }

    if (
      cardData.workspaceId !== undefined &&
      cardData.workspaceId !== workspaceId
    ) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "O cartão não pertence ao workspace informado.",
        {cardId: payload.cardId}
      );
    }

    const limitTotal = normalizeMoney(Number(cardData.limitTotal ?? 0));

    if (limitTotal <= 0) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "O limite total do cartão precisa ser maior que zero.",
        {cardId: payload.cardId, limitTotal: cardData.limitTotal}
      );
    }

    const ledgerEntries = ledgerSnapshot.docs.map((documentSnapshot) => ({
      id: documentSnapshot.id,
      ...documentSnapshot.data(),
    })) as LedgerEntryData[];

    const invalidLedgerEntry = ledgerEntries.find((entry) =>
      entry.workspaceId !== workspaceId ||
      entry.cardId !== payload.cardId ||
      !["consume", "restore"].includes(String(entry.direction)) ||
      !Number.isFinite(Number(entry.amount)) ||
      Number(entry.amount) <= 0
    );

    if (invalidLedgerEntry) {
      throw new CreditCardApplicationError(
        "domain_precondition_failed",
        "O ledger do cartão possui lançamento inválido.",
        {
          cardId: payload.cardId,
          ledgerEntryId: invalidLedgerEntry.id,
        }
      );
    }

    const idempotency = await reserveIdempotencyKey(transaction, {
      workspaceId,
      operation,
      idempotencyKey: payload.idempotencyKey,
      requestPayload: payload,
    });

    if (idempotency.replayResult) {
      return idempotency.replayResult;
    }

    const consumedAmount = sumLedgerAmountsByDirection(
      ledgerEntries,
      "consume"
    );
    const restoredAmount = sumLedgerAmountsByDirection(
      ledgerEntries,
      "restore"
    );
    const rawLimitUsed = normalizeMoney(consumedAmount - restoredAmount);
    const limitUsed = normalizeMoney(Math.max(rawLimitUsed, 0));
    const limitAvailable = normalizeMoney(limitTotal - limitUsed);
    const eventId = `${payload.cardId}_limit_recalculated_${Date.now()}`;
    const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
    const previousSnapshot = currentLimitSnapshot.exists ?
      currentLimitSnapshot.data() :
      undefined;

    transaction.set(limitSnapshotRef, toFirestoreData({
      workspaceId,
      cardId: payload.cardId,
      limitTotal,
      limitUsed,
      limitAvailable,
      updatedAt: serverTimestamp,
    }));

    transaction.set(cardFinancialEventDoc(workspaceId, eventId), toFirestoreData({
      id: eventId,
      workspaceId,
      cardId: payload.cardId,
      eventType: "reconciliation_warning",
      payload: {
        reason: payload.reason,
        operation,
        consumedAmount,
        restoredAmount,
        rawLimitUsed,
        recalculatedLimitUsed: limitUsed,
        recalculatedLimitAvailable: limitAvailable,
        ledgerEntriesCount: ledgerEntries.length,
        previousSnapshot,
      },
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
      createdAt: serverTimestamp,
      actorId: auth.uid,
    }));

    const result = buildResult(
      payload.cardId,
      eventId,
      ledgerEntries.length,
      limitTotal,
      limitUsed,
      limitAvailable
    );

    markIdempotencyKeyCompleted(
      transaction,
      idempotency.ref,
      result as unknown as Record<string, unknown>
    );

    return result;
  });
};