import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {BILLING_CATALOG_VERSION, type PlanId} from "./catalog";

/**
 * Estado canônico de billing (P2A, D-01).
 *
 * A assinatura pertence à conta do **owner** que paga: um documento por
 * titular, `billing_accounts/{uid}`, gravado somente pelo backend
 * (`bootstrapAccount` cria o estado Free; checkout grava o customer e o lock
 * de checkout; o webhook grava o estado da assinatura). O titular lê o
 * próprio documento; ninguém mais lê, e o cliente nunca escreve (Rules).
 *
 * `planId`/`entitlementStatus` são o entitlement **efetivo** na última
 * avaliação do servidor. Como grace period e cancelamento no fim do período
 * vencem sem novo evento do Stripe, quem decide acesso usa
 * `effectiveEntitlement(conta, agora)` (`entitlements.ts`), nunca os campos
 * crus.
 *
 * Coleções auxiliares, todas backend-only:
 * - `billing_customers/{stripeCustomerId}`: vínculo reverso customer → titular,
 *   criado na mesma transação que grava `stripeCustomerId` na conta.
 * - `billing_webhook_events/{stripeEventId}`: recibo idempotente de cada
 *   evento (sem payload), com TTL: `processing` enquanto a reconciliação
 *   corre, `processed` só no commit do efeito.
 * - `billing_accounts/{uid}/billing_events/{id}`: trilha append-only das
 *   mudanças de billing.
 * - `billing_accounts/{uid}/billing_sync/reconciliation`: lease e geração da
 *   reconciliação do titular com o Stripe (`webhook.ts`).
 */
export const BILLING_ACCOUNTS_COLLECTION = "billing_accounts";
export const BILLING_CUSTOMERS_COLLECTION = "billing_customers";
export const BILLING_WEBHOOK_EVENTS_COLLECTION = "billing_webhook_events";
export const BILLING_EVENTS_COLLECTION = "billing_events";
export const BILLING_SYNC_COLLECTION = "billing_sync";
export const RECONCILIATION_LEASE_ID = "reconciliation";

/** Status de assinatura do Stripe, mais `none` (sem assinatura). */
export const STRIPE_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
] as const;
export type StripeSubscriptionStatus =
  (typeof STRIPE_SUBSCRIPTION_STATUSES)[number];
export type SubscriptionStatus = "none" | StripeSubscriptionStatus;

/**
 * Situação do entitlement:
 * - `free`: sem plano pago (nunca assinou, cancelada, expirada).
 * - `active`: plano pago em dia (inclui cancelamento agendado até o fim do
 *   período).
 * - `grace`: `past_due` dentro do grace period; mantém o plano pago.
 * - `restricted`: cobrança não regularizada (`past_due` após o grace,
 *   `unpaid`, `paused`); limites do Free, dados preservados.
 * - `pending`: primeira cobrança pendente (`incomplete`); nada é concedido.
 */
export const ENTITLEMENT_STATUSES = [
  "free",
  "active",
  "grace",
  "restricted",
  "pending",
] as const;
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

/** Status que ainda representam uma assinatura viva no Stripe. */
export const LIVE_SUBSCRIPTION_STATUSES: readonly StripeSubscriptionStatus[] = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "incomplete",
  "paused",
];

export const isLiveSubscriptionStatus = (
  status: SubscriptionStatus,
): boolean =>
  (LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);

/** Lock do checkout em andamento (um por titular). */
export interface PendingCheckout {
  state: "creating" | "open";
  /** SHA-256 de `uid:idempotencyKey`; a chave crua nunca é persistida. */
  requestHash: string;
  planId: PlanId;
  sessionId: string | null;
  createdAt: Timestamp;
  /** Validade do lock enquanto a sessão ainda está sendo criada. */
  leaseExpiresAt: Timestamp;
  /** `expires_at` enviado ao Stripe (fixado na reserva, para o retry). */
  sessionExpiresAt: Timestamp;
}

export interface BillingAccountDocument {
  billingOwnerUid: string;
  catalogVersion: number;
  planId: PlanId;
  entitlementStatus: EntitlementStatus;
  subscriptionStatus: SubscriptionStatus;
  graceUntil: Timestamp | null;
  currentPeriodEnd: Timestamp | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: Timestamp | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  pendingCheckout: PendingCheckout | null;
  lastStripeEventId: string | null;
  lastStripeEventType: string | null;
  stripeSyncedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Lease da reconciliação de um titular (P2A.1). Nenhuma leitura do Stripe
 * acontece dentro de transação: o evento adquire o lease numa transação
 * curta, lê o Stripe fora dela e aplica o resultado numa segunda transação
 * que exige a mesma geração.
 *
 * `generation` é um fencing token monotônico: toda aquisição a incrementa, e
 * o commit de quem perdeu o lease (vencido e assumido por outro evento) é
 * recusado. `holderEventId`/`leaseExpiresAt` nulos ⇒ lease livre; lease
 * vencido pode ser assumido, então uma queda nunca deixa trava permanente.
 */
export interface ReconciliationLeaseDocument {
  billingOwnerUid: string;
  generation: number;
  holderEventId: string | null;
  leaseExpiresAt: Timestamp | null;
  acquiredAt: Timestamp | null;
  updatedAt: Timestamp;
}

/** `processing` nunca vale como processado: só `processed` encerra o evento. */
export type WebhookReceiptStatus = "processing" | "processed";

const db = () => admin.firestore();

export const billingAccountRef = (
  uid: string,
): admin.firestore.DocumentReference =>
  db().collection(BILLING_ACCOUNTS_COLLECTION).doc(uid);

export const billingCustomerRef = (
  stripeCustomerId: string,
): admin.firestore.DocumentReference =>
  db().collection(BILLING_CUSTOMERS_COLLECTION).doc(stripeCustomerId);

export const billingWebhookEventRef = (
  stripeEventId: string,
): admin.firestore.DocumentReference =>
  db().collection(BILLING_WEBHOOK_EVENTS_COLLECTION).doc(stripeEventId);

export const billingReconciliationLeaseRef = (
  uid: string,
): admin.firestore.DocumentReference =>
  billingAccountRef(uid)
    .collection(BILLING_SYNC_COLLECTION)
    .doc(RECONCILIATION_LEASE_ID);

/**
 * Estado inicial de toda conta: Free válido, sem customer nem assinatura.
 * Criado por `bootstrapAccount` na mesma transação do perfil.
 */
export const freeBillingAccountDocument = (uid: string) => ({
  billingOwnerUid: uid,
  catalogVersion: BILLING_CATALOG_VERSION,
  planId: "free",
  entitlementStatus: "free",
  subscriptionStatus: "none",
  graceUntil: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  cancelAt: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  stripePriceId: null,
  pendingCheckout: null,
  lastStripeEventId: null,
  lastStripeEventType: null,
  stripeSyncedAt: null,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

/**
 * Garante o documento de billing dentro da transação do bootstrap.
 *
 * Recebe o snapshot já lido na fase de leitura (o Firestore exige todas as
 * leituras antes da primeira escrita). Nunca sobrescreve um estado existente.
 */
export const ensureBillingAccount = (
  transaction: admin.firestore.Transaction,
  uid: string,
  snapshot: admin.firestore.DocumentSnapshot,
): boolean => {
  if (snapshot.exists) return false;
  transaction.create(billingAccountRef(uid), freeBillingAccountDocument(uid));
  return true;
};
