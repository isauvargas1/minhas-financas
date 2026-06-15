
import { FieldValue } from "firebase-admin/firestore";

import type {
  CreditCardCallableExecutionContext,
} from "./callable";

import type {
  CreateCreditCardPurchasePayload,
} from "./contracts";

import {
  CreditCardApplicationError,
} from "./errors";

import {
  cardFinancialEventDoc,
  getFirestore,
} from "./adminPaths";

import {
  enqueueCreditCardDomainNotifications,
} from "./domainNotifications";

const SYSTEM_EVENT_OPERATION = "createCreditCardPurchase";

const normalizeMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const sanitizeEventIdPart = (value: string): string =>
  value.replace(/[^\w-]/g, "_");

const getNumberDetail = (
  details: Record<string, unknown> | undefined,
  key: string
): number | undefined => {
  const value = details?.[key];

  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
};

const isLimitExceededError = (error: unknown): error is CreditCardApplicationError =>
  error instanceof CreditCardApplicationError &&
  error.code === "domain_precondition_failed" &&
  error.message === "Limite disponível insuficiente para esta compra.";

export const recordPurchaseLimitExceededEvent = async (
  context: CreditCardCallableExecutionContext<CreateCreditCardPurchasePayload>,
  error: unknown
): Promise<void> => {
  if (!isLimitExceededError(error)) {
    return;
  }

  const {payload, auth} = context;
  const db = getFirestore();
  const workspaceId = payload.workspaceId;
  const cardId = payload.cardId;
  const availableLimit = getNumberDetail(error.details, "currentLimitAvailable");
  const requestedAmount = getNumberDetail(error.details, "purchaseTotalAmount");
  const missingAmount =
    availableLimit !== undefined && requestedAmount !== undefined
      ? normalizeMoney(Math.max(requestedAmount - availableLimit, 0))
      : undefined;

  const eventId = sanitizeEventIdPart(
    `${SYSTEM_EVENT_OPERATION}_${payload.idempotencyKey}_purchase_limit_exceeded`
  );

  await db.runTransaction(async (transaction) => {
    const eventRef = cardFinancialEventDoc(workspaceId, eventId);
    const existingEvent = await transaction.get(eventRef);

    if (existingEvent.exists) {
      return;
    }

    const eventPayload = {
      operation: SYSTEM_EVENT_OPERATION,
      description: payload.description,
      purchaseDate: payload.purchaseDate,
      installmentsCount: payload.installmentsCount,
      amountType: payload.amountType,
      requestedAmount,
      availableLimit,
      missingAmount,
      source: payload.source,
    };

    transaction.set(eventRef, {
      id: eventId,
      workspaceId,
      cardId,
      eventType: "purchase_limit_exceeded",
      payload: eventPayload,
      correlationId: payload.correlationId,
      idempotencyKey: payload.idempotencyKey,
      createdAt: FieldValue.serverTimestamp(),
      actorId: auth.uid,
    });

    enqueueCreditCardDomainNotifications(transaction, {
      id: eventId,
      workspaceId,
      cardId,
      eventType: "purchase_limit_exceeded",
      payload: eventPayload,
      actorId: auth.uid,
    });
  });
};