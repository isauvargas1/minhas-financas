import type {CallableOptions} from "firebase-functions/v2/https";
import type {z} from "zod";

import {defineCallable, type CallableFailure} from "../shared/callable";
import {errorCodeOf} from "../shared/errors";
import {
  CREDIT_CARD_CALLABLE_OPTIONS,
  HEAVY_CREDIT_CARD_CALLABLE_OPTIONS,
} from "../shared/runtimeOptions";

import {
  buildCreditCardOperationContext,
  CREDIT_CARD_INTERNAL_ERROR_MESSAGE,
  creditCardWorkspaceRoles,
  type CreditCardOperationContext,
} from "./callable";
import {executeCancelCreditCardPurchase} from "./cancelPurchase";
import {executeCloseCreditCardInvoice} from "./closeInvoice";
import {
  cancelCreditCardPurchasePayloadSchema,
  closeCreditCardInvoicePayloadSchema,
  createCreditCardPurchasePayloadSchema,
  rebuildCardInvoicesForCardPayloadSchema,
  recalculateCardLimitPayloadSchema,
  registerCreditCardInvoicePaymentPayloadSchema,
  reopenCreditCardInvoicePayloadSchema,
  reverseCreditCardInvoicePaymentPayloadSchema,
  updateCreditCardPurchasePayloadSchema,
} from "./contracts";
import {executeCreateCreditCardPurchase} from "./createPurchase";
import {recordCreditCardCallableFailureSafely} from "./observability";
import {recordPurchaseLimitExceededEvent} from "./purchaseFailureEvents";
import {executeRebuildCardInvoicesForCard} from "./rebuildInvoices";
import {executeRecalculateCardLimit} from "./recalculateCardLimit";
import {
  executeRegisterCreditCardInvoicePayment,
} from "./registerInvoicePayment";
import {executeReopenCreditCardInvoice} from "./reopenInvoice";
import {
  executeReverseCreditCardInvoicePayment,
} from "./reverseInvoicePayment";
import {executeUpdateCreditCardPurchase} from "./updatePurchase";
import type {CreditCardBackendWriteOperation} from "./writeStrategy";

/**
 * Códigos que só nascem da autenticação ou da autorização. Uma falha com um
 * deles nunca é gravada em workspace: o `workspaceId` não foi autorizado — ou
 * deixou de ser, na releitura transacional.
 */
const ACCESS_FAILURE_CODES: ReadonlySet<string> = new Set([
  "unauthenticated",
  "permission_denied",
  "email_not_verified",
  "recent_login_required",
  "account_suspended",
  "account_not_initialized",
  "workspace_not_found",
  "workspace_archived",
  "workspace_membership_required",
  "workspace_role_denied",
]);

type DomainFailureRecorder<TPayload> = (
  context: CreditCardOperationContext<TPayload>,
  error: unknown,
) => Promise<void>;

/**
 * Contexto autorizado para registrar a falha, ou `null`.
 *
 * Gravar a falha num `workspaceId` não autorizado era o vetor INV-P0-001: um
 * chamador sem token escrevia métricas, eventos financeiros e notificações no
 * workspace de outro tenant. O destino é só o do ator que passou pela
 * pré-checagem do kernel (`failure.actor`); se a própria falha é de acesso —
 * membro removido ou rebaixado na releitura transacional —, nada é gravado.
 */
const authorizedFailureContext = <TPayload extends {workspaceId: string}>(
  schema: z.ZodType<TPayload>,
  failure: CallableFailure,
): CreditCardOperationContext<TPayload> | null => {
  const actor = failure.actor;

  if (!actor || ACCESS_FAILURE_CODES.has(errorCodeOf(failure.error))) {
    return null;
  }

  const parsed = schema.safeParse(failure.request.data);

  if (!parsed.success || parsed.data.workspaceId !== actor.workspaceId) {
    return null;
  }

  return {payload: parsed.data, actor};
};

const recordCreditCardFailure = async <
  TPayload extends {workspaceId: string},
>(
  operation: CreditCardBackendWriteOperation,
  schema: z.ZodType<TPayload>,
  failure: CallableFailure,
  recordDomainFailure?: DomainFailureRecorder<TPayload>,
): Promise<void> => {
  const context = authorizedFailureContext(schema, failure);

  if (context && recordDomainFailure) {
    try {
      await recordDomainFailure(context, failure.error);
    } catch (domainFailureError) {
      console.error("credit_card_domain_failure_record_failed", {
        operation,
        requestId: failure.requestId,
        errorCode: errorCodeOf(domainFailureError),
      });
    }
  }

  await recordCreditCardCallableFailureSafely(
    operation,
    failure.request.data,
    failure.uid ?? undefined,
    failure.error,
    context?.actor.workspaceId,
  );
};

/**
 * Callable de cartão sobre o wrapper único do kernel (`defineCallable`).
 *
 * O kernel autentica, aplica a política de token, valida o payload e faz a
 * pré-checagem de papel com a matriz de `writeStrategy.ts`. Cada operação
 * relê a autorização dentro da própria transação (`reassertWorkspaceActor`).
 */
const creditCardCallable = <TPayload extends {workspaceId: string}, TResult>(
  operation: CreditCardBackendWriteOperation,
  schema: z.ZodType<TPayload>,
  execute: (context: CreditCardOperationContext<TPayload>) => Promise<TResult>,
  options: {
    runtime?: CallableOptions;
    recordDomainFailure?: DomainFailureRecorder<TPayload>;
  } = {},
) => {
  return defineCallable<TPayload, TResult>({
    operation,
    schema,
    runtime: options.runtime ?? CREDIT_CARD_CALLABLE_OPTIONS,
    workspaceRoles: creditCardWorkspaceRoles(operation),
    internalMessage: CREDIT_CARD_INTERNAL_ERROR_MESSAGE,
    onFailure: (failure) =>
      recordCreditCardFailure(
        operation,
        schema,
        failure,
        options.recordDomainFailure,
      ),
    handler: ({payload, actor}) =>
      execute(buildCreditCardOperationContext(payload, actor)),
  });
};

export const createCreditCardPurchase = creditCardCallable(
  "createCreditCardPurchase",
  createCreditCardPurchasePayloadSchema,
  executeCreateCreditCardPurchase,
  {recordDomainFailure: recordPurchaseLimitExceededEvent},
);

export const registerCreditCardInvoicePayment = creditCardCallable(
  "registerCreditCardInvoicePayment",
  registerCreditCardInvoicePaymentPayloadSchema,
  executeRegisterCreditCardInvoicePayment,
);

export const reverseCreditCardInvoicePayment = creditCardCallable(
  "reverseCreditCardInvoicePayment",
  reverseCreditCardInvoicePaymentPayloadSchema,
  executeReverseCreditCardInvoicePayment,
);

export const cancelCreditCardPurchase = creditCardCallable(
  "cancelCreditCardPurchase",
  cancelCreditCardPurchasePayloadSchema,
  executeCancelCreditCardPurchase,
);

export const recalculateCardLimit = creditCardCallable(
  "recalculateCardLimit",
  recalculateCardLimitPayloadSchema,
  executeRecalculateCardLimit,
  {runtime: HEAVY_CREDIT_CARD_CALLABLE_OPTIONS},
);

export const closeCreditCardInvoice = creditCardCallable(
  "closeCreditCardInvoice",
  closeCreditCardInvoicePayloadSchema,
  executeCloseCreditCardInvoice,
);

export const reopenCreditCardInvoice = creditCardCallable(
  "reopenCreditCardInvoice",
  reopenCreditCardInvoicePayloadSchema,
  executeReopenCreditCardInvoice,
);

export const rebuildCardInvoicesForCard = creditCardCallable(
  "rebuildCardInvoicesForCard",
  rebuildCardInvoicesForCardPayloadSchema,
  executeRebuildCardInvoicesForCard,
  {runtime: HEAVY_CREDIT_CARD_CALLABLE_OPTIONS},
);

export const updateCreditCardPurchase = creditCardCallable(
  "updateCreditCardPurchase",
  updateCreditCardPurchasePayloadSchema,
  executeUpdateCreditCardPurchase,
);
