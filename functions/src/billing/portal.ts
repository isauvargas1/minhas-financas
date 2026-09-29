import * as admin from "firebase-admin";

import type {CallerIdentity} from "../shared/callable";
import {ApplicationError} from "../shared/errors";
import type {OperationLogger} from "../shared/logger";
import {reserveUserRateLimit, type RateLimitPolicy} from "../shared/rateLimit";
import {
  assertActiveAccountSnapshot,
  userProfileRef,
} from "../shared/workspaceAuth";
import {billingAccountMissingError} from "./checkout";
import {invalidReturnUrlError, isAllowedReturnUrl} from "./config";
import type {CreateBillingPortalSessionPayload} from "./contracts";
import {billingAccountRef} from "./model";
import type {StripeGateway} from "./stripeGateway";

/**
 * `createBillingPortalSession` (P2A, PR-BILL-02).
 *
 * Abre o Customer Portal do Stripe para o **próprio** titular: a conta é
 * sempre `billing_accounts/{caller.uid}`, sem nenhum identificador vindo do
 * cliente. Troca de plano, cancelamento (no fim do período) e meio de
 * pagamento acontecem no portal; o retorno não altera estado local — quem
 * altera é o webhook.
 */
export interface PortalDependencies {
  gateway: StripeGateway;
  allowedOrigins: readonly string[];
}

export const PORTAL_RATE_LIMIT: RateLimitPolicy = {
  operation: "createBillingPortalSession",
  limit: 20,
  windowSeconds: 60 * 60,
};

export const noBillingCustomerError = (): ApplicationError =>
  new ApplicationError(
    "domain_precondition_failed",
    "Você ainda não tem uma assinatura para gerenciar.",
    {reason: "billing_customer_missing"},
  );

export const executeCreateBillingPortalSession = async (
  deps: PortalDependencies,
  input: {
    caller: CallerIdentity;
    payload: CreateBillingPortalSessionPayload;
    log: OperationLogger;
  },
): Promise<{url: string}> => {
  const {caller, payload, log} = input;
  if (!isAllowedReturnUrl(payload.returnUrl, deps.allowedOrigins)) {
    throw invalidReturnUrlError();
  }
  const uid = caller.uid;
  const customerId = await admin.firestore().runTransaction(
    async (transaction) => {
      assertActiveAccountSnapshot(await transaction.get(userProfileRef(uid)));
      const account = await transaction.get(billingAccountRef(uid));
      if (!account.exists) throw billingAccountMissingError();
      const stripeCustomerId = account.get("stripeCustomerId");
      if (typeof stripeCustomerId !== "string" || stripeCustomerId === "") {
        throw noBillingCustomerError();
      }
      const rateLimit = await reserveUserRateLimit(
        transaction,
        uid,
        PORTAL_RATE_LIMIT,
      );
      rateLimit.commit();
      return stripeCustomerId;
    },
  );
  const session = await deps.gateway.createPortalSession({
    customerId,
    returnUrl: payload.returnUrl,
  });
  log.info("billing.portal_session_created");
  return {url: session.url};
};
