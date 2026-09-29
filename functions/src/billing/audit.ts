import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import type {AuditSnapshot} from "../shared/audit";
import {sha256} from "../shared/hashing";
import {BILLING_EVENTS_COLLECTION, billingAccountRef} from "./model";

/**
 * Trilha append-only de billing (P2A).
 *
 * `billing_accounts/{uid}/billing_events/{id}` é gravado só pelo backend, na
 * mesma transação da mudança: o evento existe se e somente se a mudança foi
 * confirmada. As Rules negam leitura e escrita do cliente.
 *
 * Nunca entra aqui: payload do Stripe, e-mail, dado de cartão, segredo ou
 * URL de sessão. Só IDs do Stripe, status, planos, valores em centavos e
 * instantes.
 *
 * O ID deriva da âncora (`event.id` do Stripe ou `requestId` do servidor),
 * do tipo e de um discriminador; a escrita usa `transaction.create`. O recibo
 * idempotente do webhook garante que cada evento do Stripe é aplicado uma
 * única vez, então cada efeito é auditado exatamente uma vez.
 */
export type BillingEventType =
  | "checkout.created"
  | "subscription.linked"
  | "billing.state_changed"
  | "grace.started"
  | "grace.ended"
  | "cancellation.scheduled"
  | "cancellation.reverted"
  | "subscription.canceled"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.action_required"
  | "refund.received"
  | "dispute.received"
  | "dispute.closed"
  | "anomaly.detected";

export interface BillingEventInput {
  billingOwnerUid: string;
  type: BillingEventType;
  source: "checkout" | "stripe_webhook";
  /** `requestId` do servidor (checkout) ou `null`. */
  requestId: string | null;
  stripeEventId: string | null;
  stripeEventType: string | null;
  before: AuditSnapshot | null;
  after: AuditSnapshot | null;
  details: AuditSnapshot | null;
  /** Diferencia eventos do mesmo tipo na mesma âncora. */
  discriminator?: string;
}

export const billingEventId = (
  anchor: string,
  type: BillingEventType,
  discriminator = "-",
): string =>
  `${type.replace(/\./g, "_")}_` +
  sha256(`${anchor}:${type}:${discriminator}`).slice(0, 32);

export const appendBillingEvent = (
  transaction: admin.firestore.Transaction,
  input: BillingEventInput,
): admin.firestore.DocumentReference => {
  const anchor = input.stripeEventId ?? input.requestId;
  if (!anchor) {
    throw new Error("Evento de billing sem âncora idempotente.");
  }
  const ref = billingAccountRef(input.billingOwnerUid)
    .collection(BILLING_EVENTS_COLLECTION)
    .doc(billingEventId(anchor, input.type, input.discriminator));
  transaction.create(ref, {
    id: ref.id,
    billingOwnerUid: input.billingOwnerUid,
    type: input.type,
    source: input.source,
    requestId: input.requestId,
    stripeEventId: input.stripeEventId,
    stripeEventType: input.stripeEventType,
    before: input.before,
    after: input.after,
    details: input.details,
    createdAt: FieldValue.serverTimestamp(),
  });
  return ref;
};
