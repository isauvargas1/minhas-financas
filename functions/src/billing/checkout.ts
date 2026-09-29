import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import type {CallerIdentity} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import {sha256} from "../shared/hashing";
import {
  completeActorIdempotency,
  reserveActorIdempotency,
} from "../shared/idempotency";
import type {OperationLogger} from "../shared/logger";
import {reserveUserRateLimit, type RateLimitPolicy} from "../shared/rateLimit";
import {
  assertActiveAccountSnapshot,
  userProfileRef,
} from "../shared/workspaceAuth";
import {appendBillingEvent} from "./audit";
import {
  BILLING_CATALOG_VERSION,
  BILLING_POLICY,
  catalogPlan,
  type PaidPlanId,
} from "./catalog";
import {
  billingUnavailableError,
  invalidReturnUrlError,
  isAllowedReturnUrl,
  type PriceConfig,
} from "./config";
import type {CreateCheckoutSessionPayload} from "./contracts";
import {
  billingAccountRef,
  billingCustomerRef,
  isLiveSubscriptionStatus,
  type BillingAccountDocument,
  type PendingCheckout,
} from "./model";
import type {CheckoutSessionSnapshot, StripeGateway} from "./stripeGateway";

/**
 * `createCheckoutSession` (P2A, PR-BILL-03).
 *
 * O cliente escolhe o plano; o servidor resolve o Price do ambiente, confere
 * que ele cobra exatamente o valor do catálogo e cria a sessão para o
 * Customer canônico do titular. Nenhum checkout concede entitlement: quem
 * concede é o webhook, a partir da assinatura relida no Stripe.
 *
 * **Sem assinatura duplicada.** Três barreiras, em ordem:
 * 1. Conta com assinatura viva (`active`, `trialing`, `past_due`, `unpaid`,
 *    `incomplete`, `paused`) recusa e orienta ao portal.
 * 2. Lock transacional por titular (`pendingCheckout`): só uma criação de
 *    sessão por vez; outra chave concorrente é recusada enquanto o lease vale.
 * 3. No Stripe, antes de criar a sessão: assinatura viva do customer ainda
 *    não refletida pelo webhook recusa; qualquer outra sessão aberta do
 *    customer é expirada — se já tiver sido concluída, recusa. Só a sessão
 *    desta intenção pode estar aberta.
 *
 * **Idempotência.** A chave do cliente vira reserva transacional
 * (`users/{uid}/idempotency_keys`, replay devolve a mesma URL) e chave
 * idempotente do Stripe (`Idempotency-Key`), derivada do hash da chave e da
 * expiração fixada na reserva — os parâmetros enviados ao Stripe são sempre
 * os mesmos para a mesma chave. O Customer também é criado com chave
 * idempotente.
 */
export interface CheckoutDependencies {
  gateway: StripeGateway;
  prices: PriceConfig;
  livemode: boolean;
  allowedOrigins: readonly string[];
  now: () => number;
}

export const CHECKOUT_RATE_LIMIT: RateLimitPolicy = {
  operation: "createCheckoutSession",
  limit: 10,
  windowSeconds: 60 * 60,
};

/** Lease do lock enquanto a sessão é criada: acima do tempo limite (60 s). */
export const CHECKOUT_LEASE_MS = 90_000;
/** Validade da sessão no Stripe (o Stripe aceita de 30 min a 24 h). */
export const CHECKOUT_SESSION_TTL_MS = 35 * 60_000;
/** Menor validade restante para reaproveitar a expiração já reservada. */
const MIN_REUSABLE_SESSION_TTL_MS = 31 * 60_000;

const OPERATION = "createCheckoutSession";

const db = () => admin.firestore();

export const subscriptionExistsError = (): ApplicationError =>
  new ApplicationError(
    "already_exists",
    "Você já tem uma assinatura. Use “Gerenciar assinatura” para trocar " +
      "de plano ou atualizar o pagamento.",
    {reason: "billing_subscription_exists"},
  );

const checkoutInProgressError = (): ApplicationError =>
  new ApplicationError(
    "domain_precondition_failed",
    "Já existe um pagamento sendo preparado. Aguarde alguns segundos e " +
      "tente novamente.",
    {reason: "billing_checkout_in_progress"},
  );

const confirmationPendingError = (): ApplicationError =>
  new ApplicationError(
    "domain_precondition_failed",
    "Seu pagamento anterior ainda está sendo confirmado. Aguarde alguns " +
      "instantes e tente novamente.",
    {reason: "billing_confirmation_pending"},
  );

export const billingAccountMissingError = (): ApplicationError =>
  new ApplicationError(
    "account_not_initialized",
    "Sua conta ainda está sendo preparada. Recarregue a página e tente " +
      "novamente.",
  );

/** A sessão criada perdeu o lock (outra intenção assumiu ou a assinatura
 * foi vinculada): ela é expirada e nunca devolvida ao usuário. */
class CheckoutSupersededError extends ApplicationError {
  constructor() {
    super(
      "domain_precondition_failed",
      "Não foi possível iniciar o pagamento. Tente novamente.",
    );
  }
}

export const checkoutReturnUrl = (
  returnUrl: string,
  outcome: "success" | "canceled",
): string => {
  const url = new URL(returnUrl);
  url.searchParams.set("billing", outcome);
  return url.toString();
};

/** Identificador da intenção: hash de `uid:chave`, nunca a chave crua. */
export const checkoutRequestHash = (uid: string, idempotencyKey: string) =>
  sha256(`${uid}:${idempotencyKey}`);

export const stripeCheckoutIdempotencyKey = (
  requestHash: string,
  sessionExpiresAtSeconds: number,
): string =>
  `billing-checkout-${requestHash.slice(0, 40)}-${sessionExpiresAtSeconds}`;

export const stripeCustomerIdempotencyKey = (
  uid: string,
  email: string | null,
): string => `billing-customer-${sha256(`${uid}:${email ?? ""}`).slice(0, 40)}`;

/**
 * O Price configurado precisa cobrar exatamente o catálogo: ativo,
 * recorrente mensal, BRL, mesmo valor em centavos e do mesmo modo (test ou
 * live) da chave. Divergência falha fechada — preço exibido = preço cobrado.
 */
const assertPriceMatchesCatalog = async (
  deps: CheckoutDependencies,
  planId: PaidPlanId,
  log: OperationLogger,
): Promise<string> => {
  const priceId = deps.prices[planId];
  const plan = catalogPlan(planId);
  let matches = false;
  try {
    const price = await deps.gateway.retrievePrice(priceId);
    matches = price.id === priceId &&
      price.active &&
      price.type === "recurring" &&
      price.currency === BILLING_POLICY.currency &&
      price.unitAmount === plan.amountCents &&
      price.recurringInterval === plan.interval &&
      price.recurringIntervalCount === 1 &&
      price.livemode === deps.livemode;
  } catch (error) {
    log.error("billing.price_unavailable", error, {planId});
    throw billingUnavailableError();
  }
  if (!matches) {
    log.error("billing.price_mismatch", null, {planId});
    throw billingUnavailableError();
  }
  return priceId;
};

type Reservation =
  | {kind: "replay"; result: Record<string, unknown>}
  | {
    kind: "reserved";
    customerId: string | null;
    sessionExpiresAtMs: number;
    /** Lock substituído (de outra intenção), restaurado se esta falhar. */
    previousLock: PendingCheckout | null;
  };

const reserveCheckout = (
  deps: CheckoutDependencies,
  uid: string,
  payload: CreateCheckoutSessionPayload,
  requestHash: string,
): Promise<Reservation> =>
  db().runTransaction(async (transaction) => {
    const idempotency = await reserveActorIdempotency(transaction, {
      uid,
      operation: OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (idempotency.replay) return {kind: "replay", result: idempotency.replay};
    assertActiveAccountSnapshot(await transaction.get(userProfileRef(uid)));
    const accountRef = billingAccountRef(uid);
    const snapshot = await transaction.get(accountRef);
    if (!snapshot.exists) throw billingAccountMissingError();
    const account = snapshot.data() as BillingAccountDocument;
    if (isLiveSubscriptionStatus(account.subscriptionStatus)) {
      throw subscriptionExistsError();
    }

    const now = deps.now();
    const lock = account.pendingCheckout;
    const ownLock = lock?.requestHash === requestHash;
    if (
      lock?.state === "creating" &&
      lock.leaseExpiresAt.toMillis() > now &&
      !ownLock
    ) {
      throw checkoutInProgressError();
    }
    const rateLimit = await reserveUserRateLimit(
      transaction,
      uid,
      CHECKOUT_RATE_LIMIT,
    );
    // A mesma intenção reaproveita a expiração reservada para que a chave
    // idempotente do Stripe receba parâmetros idênticos.
    const reuse = ownLock && lock !== null &&
      lock.sessionExpiresAt.toMillis() - now >= MIN_REUSABLE_SESSION_TTL_MS;
    const sessionExpiresAtMs = reuse && lock ?
      lock.sessionExpiresAt.toMillis() :
      now + CHECKOUT_SESSION_TTL_MS;
    const next: PendingCheckout = {
      state: "creating",
      requestHash,
      planId: payload.planId,
      sessionId: null,
      createdAt: Timestamp.fromMillis(now),
      leaseExpiresAt: Timestamp.fromMillis(now + CHECKOUT_LEASE_MS),
      sessionExpiresAt: Timestamp.fromMillis(sessionExpiresAtMs),
    };
    transaction.update(accountRef, {
      pendingCheckout: next,
      updatedAt: FieldValue.serverTimestamp(),
    });
    rateLimit.commit();
    return {
      kind: "reserved",
      customerId: account.stripeCustomerId,
      sessionExpiresAtMs,
      previousLock: ownLock ? null : lock ?? null,
    };
  });

/**
 * Customer canônico do titular: criado uma vez, com chave idempotente no
 * Stripe, e gravado com o vínculo reverso na mesma transação. Se outro
 * caminho já gravou um customer, esse prevalece.
 */
const ensureStripeCustomer = async (
  deps: CheckoutDependencies,
  caller: CallerIdentity,
  log: OperationLogger,
): Promise<string> => {
  const uid = caller.uid;
  const email = caller.emailVerified && caller.email ? caller.email : null;
  const created = await deps.gateway.createCustomer(
    {billingOwnerUid: uid, email},
    stripeCustomerIdempotencyKey(uid, email),
  );
  return db().runTransaction(async (transaction) => {
    const accountRef = billingAccountRef(uid);
    const mappingRef = billingCustomerRef(created.id);
    const [account, mapping] = await transaction.getAll(accountRef, mappingRef);
    if (!account.exists) throw billingAccountMissingError();
    const existing = account.get("stripeCustomerId");
    if (typeof existing === "string" && existing.length > 0) {
      if (existing !== created.id) {
        log.warn("billing.customer_orphaned", {stripeCustomerId: created.id});
      }
      return existing;
    }
    if (mapping.exists && mapping.get("billingOwnerUid") !== uid) {
      throw new Error("Customer do Stripe vinculado a outro titular.");
    }
    transaction.update(accountRef, {
      stripeCustomerId: created.id,
      updatedAt: FieldValue.serverTimestamp(),
    });
    if (!mapping.exists) {
      transaction.create(mappingRef, {
        stripeCustomerId: created.id,
        billingOwnerUid: uid,
        livemode: deps.livemode,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    return created.id;
  });
};

/**
 * Barreira no próprio Stripe. Antes de abrir a sessão desta intenção:
 * assinatura viva ainda não refletida recusa; outra sessão aberta é
 * expirada, e sessão já concluída recusa (o webhook ainda vai refleti-la).
 */
const settleCompetingCheckouts = async (
  deps: CheckoutDependencies,
  customerId: string,
  own: {checkoutRequestId: string; expiresAtSeconds: number},
): Promise<void> => {
  const subscriptions = await deps.gateway.listSubscriptions(customerId);
  if (subscriptions.some((entry) => isLiveSubscriptionStatus(entry.status))) {
    throw subscriptionExistsError();
  }
  const openSessions = await deps.gateway.listOpenCheckoutSessions(customerId);
  for (const session of openSessions) {
    const isOwn = session.checkoutRequestId === own.checkoutRequestId &&
      session.expiresAt === own.expiresAtSeconds;
    if (isOwn) continue;
    const settled = await deps.gateway.expireCheckoutSession(session.id);
    if (settled.status === "complete") throw confirmationPendingError();
    if (settled.status !== "expired") throw checkoutInProgressError();
  }
};

const commitCheckout = (
  uid: string,
  payload: CreateCheckoutSessionPayload,
  requestHash: string,
  session: CheckoutSessionSnapshot & {url: string},
  requestId: string,
): Promise<Record<string, unknown>> =>
  db().runTransaction(async (transaction) => {
    const idempotency = await reserveActorIdempotency(transaction, {
      uid,
      operation: OPERATION,
      idempotencyKey: payload.idempotencyKey,
      payload,
    });
    if (idempotency.replay) return idempotency.replay;
    const accountRef = billingAccountRef(uid);
    const snapshot = await transaction.get(accountRef);
    const account = snapshot.data() as BillingAccountDocument | undefined;
    const lock = account?.pendingCheckout ?? null;
    if (
      !account ||
      isLiveSubscriptionStatus(account.subscriptionStatus) ||
      lock?.requestHash !== requestHash
    ) {
      throw new CheckoutSupersededError();
    }
    transaction.update(accountRef, {
      pendingCheckout: {...lock, state: "open", sessionId: session.id},
      updatedAt: FieldValue.serverTimestamp(),
    });
    const result = {url: session.url};
    completeActorIdempotency(transaction, idempotency, {
      uid,
      operation: OPERATION,
      workspaceId: null,
      requestId,
      result,
    });
    appendBillingEvent(transaction, {
      billingOwnerUid: uid,
      type: "checkout.created",
      source: "checkout",
      requestId,
      stripeEventId: null,
      stripeEventType: null,
      before: null,
      after: null,
      details: {
        planId: payload.planId,
        catalogVersion: BILLING_CATALOG_VERSION,
        stripeCheckoutSessionId: session.id,
        stripeCustomerId: account.stripeCustomerId,
      },
    });
    return result;
  });

/**
 * Libera o lock desta intenção se ele ainda estiver em criação, devolvendo
 * o lock que ela substituiu (a sessão anterior continua rastreável).
 */
const releaseCheckoutLock = (
  uid: string,
  requestHash: string,
  previousLock: PendingCheckout | null,
) =>
  db().runTransaction(async (transaction) => {
    const accountRef = billingAccountRef(uid);
    const lock = (await transaction.get(accountRef))
      .get("pendingCheckout") as PendingCheckout | null | undefined;
    if (lock?.requestHash === requestHash && lock.state === "creating") {
      transaction.update(accountRef, {
        pendingCheckout: previousLock,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  });

export const executeCreateCheckoutSession = async (
  deps: CheckoutDependencies,
  input: {
    caller: CallerIdentity;
    payload: CreateCheckoutSessionPayload;
    requestId: string;
    log: OperationLogger;
  },
): Promise<{url: string}> => {
  const {caller, payload, requestId, log} = input;
  const uid = caller.uid;
  if (!isAllowedReturnUrl(payload.returnUrl, deps.allowedOrigins)) {
    throw invalidReturnUrlError();
  }
  const priceId = await assertPriceMatchesCatalog(deps, payload.planId, log);
  const requestHash = checkoutRequestHash(uid, payload.idempotencyKey);

  const reservation = await reserveCheckout(deps, uid, payload, requestHash);
  if (reservation.kind === "replay") {
    return reservation.result as {url: string};
  }

  let createdSessionId: string | null = null;
  try {
    const customerId = reservation.customerId ??
      await ensureStripeCustomer(deps, caller, log);
    const checkoutRequestId = requestHash.slice(0, 32);
    const expiresAtSeconds = Math.floor(reservation.sessionExpiresAtMs / 1000);
    await settleCompetingCheckouts(deps, customerId, {
      checkoutRequestId,
      expiresAtSeconds,
    });
    const session = await deps.gateway.createCheckoutSession({
      customerId,
      priceId,
      successUrl: checkoutReturnUrl(payload.returnUrl, "success"),
      cancelUrl: checkoutReturnUrl(payload.returnUrl, "canceled"),
      expiresAt: expiresAtSeconds,
      billingOwnerUid: uid,
      planId: payload.planId,
      catalogVersion: BILLING_CATALOG_VERSION,
      checkoutRequestId,
    }, stripeCheckoutIdempotencyKey(requestHash, expiresAtSeconds));
    createdSessionId = session.id;
    if (session.status !== "open" || !session.url) {
      throw new CheckoutSupersededError();
    }
    const result = await commitCheckout(
      uid,
      payload,
      requestHash,
      {...session, url: session.url},
      requestId,
    );
    log.info("billing.checkout_created", {planId: payload.planId});
    return result as {url: string};
  } catch (error) {
    try {
      await releaseCheckoutLock(uid, requestHash, reservation.previousLock);
    } catch (releaseError) {
      log.error("billing.checkout_lock_release_failed", releaseError);
    }
    if (createdSessionId && error instanceof CheckoutSupersededError) {
      // A sessão nunca foi entregue: expirá-la impede que alguém a conclua.
      try {
        await deps.gateway.expireCheckoutSession(createdSessionId);
      } catch (expireError) {
        log.error("billing.checkout_expire_failed", expireError);
      }
    }
    throw error;
  }
};
