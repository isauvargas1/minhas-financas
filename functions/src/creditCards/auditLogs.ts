import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

import {
  creditCardAuditLogDoc,
} from "./adminPaths";

export type CreditCardAuditAction =
  | "purchase_created"
  | "purchase_updated"
  | "purchase_cancelled"
  | "invoice_closed"
  | "invoice_reopened"
  | "invoice_payment_registered"
  | "invoice_payment_reversed"
  | "card_limit_recalculated"
  | "card_invoices_rebuilt";

export type CreditCardAuditEntityType =
  | "purchase"
  | "invoice"
  | "payment"
  | "card";

export interface RecordCreditCardAuditLogInput {
  workspaceId: string;
  action: CreditCardAuditAction;
  actorId: string;
  entityType: CreditCardAuditEntityType;
  entityId: string;
  cardId?: string;
  invoiceId?: string;
  purchaseId?: string;
  paymentId?: string;
  ledgerEntryId?: string;
  domainEventId?: string;
  reason?: string;
  policy?: string;
  idempotencyKey?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
}

const sanitizeAuditLogIdPart = (value: string): string =>
  value.replace(/[^\w-]/g, "_");

const stripUndefinedValues = (
  value: Record<string, unknown>
): admin.firestore.DocumentData =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );

const stripUndefinedValuesDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedValuesDeep);
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, stripUndefinedValuesDeep(entryValue)])
  );
};

const buildAuditLogId = (
  input: RecordCreditCardAuditLogInput
): string => {
  const baseId = input.domainEventId ||
    input.idempotencyKey ||
    `${input.action}_${input.entityType}_${input.entityId}`;

  return sanitizeAuditLogIdPart(`${baseId}_audit_${input.action}`);
};

export const recordCreditCardAuditLog = (
  transaction: admin.firestore.Transaction,
  input: RecordCreditCardAuditLogInput
): void => {
  const auditLogId = buildAuditLogId(input);
  const auditLogRef = creditCardAuditLogDoc(input.workspaceId, auditLogId);

  transaction.set(auditLogRef, stripUndefinedValues({
    id: auditLogId,
    workspaceId: input.workspaceId,
    action: input.action,
    actorId: input.actorId,
    entityType: input.entityType,
    entityId: input.entityId,
    cardId: input.cardId,
    invoiceId: input.invoiceId,
    purchaseId: input.purchaseId,
    paymentId: input.paymentId,
    ledgerEntryId: input.ledgerEntryId,
    domainEventId: input.domainEventId,
    reason: input.reason,
    policy: input.policy,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
    details: stripUndefinedValuesDeep(input.details ?? {}),
    occurredAt: FieldValue.serverTimestamp(),
  }));
};
