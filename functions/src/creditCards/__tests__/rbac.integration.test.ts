import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCreditCardCallableContext,
} from "../callable";

import {
  cancelCreditCardPurchasePayloadSchema,
  closeCreditCardInvoicePayloadSchema,
  createCreditCardPurchasePayloadSchema,
  rebuildCardInvoicesForCardPayloadSchema,
  recalculateCardLimitPayloadSchema,
  registerCreditCardInvoicePaymentPayloadSchema,
  reopenCreditCardInvoicePayloadSchema,
  reverseCreditCardInvoicePaymentPayloadSchema,
} from "../contracts";

import {
  CreditCardApplicationError,
} from "../errors";

import {
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationMember,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-rbac-test";
const TEST_OWNER_ID = "user-credit-card-rbac-owner";
const TEST_ADMIN_ID = "user-credit-card-rbac-admin";
const TEST_MEMBER_ID = "user-credit-card-rbac-member";
const TEST_OUTSIDER_ID = "user-credit-card-rbac-outsider";
const TEST_CARD_ID = "card-credit-card-rbac-test";

const buildRequest = (
  uid: string,
  data: Record<string, unknown>,
) => ({
  auth: {
    uid,
    token: {},
  },
  data,
} as any);

const expectWorkspaceRoleDenied = async (
  operation: () => Promise<unknown>,
): Promise<void> => {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      error.code === "workspace_role_denied",
  );
};

const expectWorkspaceMembershipRequired = async (
  operation: () => Promise<unknown>,
): Promise<void> => {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      error.code === "workspace_membership_required",
  );
};

const createPurchasePayload = {
  workspaceId: TEST_WORKSPACE_ID,
  cardId: TEST_CARD_ID,
  description: "Compra RBAC",
  categorySnapshot: {
    label: "RBAC",
  },
  purchaseDate: "2026-04-05",
  totalAmount: 100,
  installmentsCount: 1,
  amountType: "total",
  source: "manual",
  idempotencyKey: "rbac-create-purchase-001",
  correlationId: "rbac-create-purchase",
};

const paymentPayload = {
  workspaceId: TEST_WORKSPACE_ID,
  cardId: TEST_CARD_ID,
  invoiceId: `${TEST_CARD_ID}_2026-04`,
  paymentDate: "2026-04-20",
  amount: 100,
  paymentMethod: "external",
  idempotencyKey: "rbac-payment-001",
  correlationId: "rbac-payment",
};

const cancelPurchasePayload = {
  workspaceId: TEST_WORKSPACE_ID,
  cardId: TEST_CARD_ID,
  purchaseId: "purchase-rbac-test",
  reason: "Teste RBAC de cancelamento",
  policy: "block_if_invoice_paid",
  idempotencyKey: "rbac-cancel-purchase-001",
  correlationId: "rbac-cancel-purchase",
};

const reversePaymentPayload = {
  workspaceId: TEST_WORKSPACE_ID,
  cardId: TEST_CARD_ID,
  invoiceId: `${TEST_CARD_ID}_2026-04`,
  paymentId: "payment-rbac-test",
  reason: "Teste RBAC de estorno",
  reversedAt: "2026-04-21",
  idempotencyKey: "rbac-reverse-payment-001",
  correlationId: "rbac-reverse-payment",
};

const closeInvoicePayload = {
  workspaceId: TEST_WORKSPACE_ID,
  cardId: TEST_CARD_ID,
  invoiceId: `${TEST_CARD_ID}_2026-04`,
  closedAt: "2026-04-10",
  idempotencyKey: "rbac-close-invoice-001",
  correlationId: "rbac-close-invoice",
};

const reopenInvoicePayload = {
  workspaceId: TEST_WORKSPACE_ID,
  cardId: TEST_CARD_ID,
  invoiceId: `${TEST_CARD_ID}_2026-04`,
  reason: "Teste RBAC de reabertura",
  policy: "block_if_paid",
  idempotencyKey: "rbac-reopen-invoice-001",
  correlationId: "rbac-reopen-invoice",
};

const recalculateLimitPayload = {
  workspaceId: TEST_WORKSPACE_ID,
  cardId: TEST_CARD_ID,
  reason: "Teste RBAC de recálculo",
  idempotencyKey: "rbac-recalculate-limit-001",
  correlationId: "rbac-recalculate-limit",
};

const rebuildInvoicesPayload = {
  workspaceId: TEST_WORKSPACE_ID,
  cardId: TEST_CARD_ID,
  fromCompetenceMonth: "2026-04",
  toCompetenceMonth: "2026-04",
  reason: "Teste RBAC de rebuild",
  idempotencyKey: "rbac-rebuild-invoices-001",
  correlationId: "rbac-rebuild-invoices",
};

test(
  "RBAC do domínio de cartão deve restringir operações críticas por papel",
  {
    skip: !process.env.FIRESTORE_EMULATOR_HOST,
  },
  async () => {
    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);

    await seedCreditCardIntegrationWorkspace({
      workspaceId: TEST_WORKSPACE_ID,
      ownerId: TEST_OWNER_ID,
      cardId: TEST_CARD_ID,
    });

    await seedCreditCardIntegrationMember({
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_ADMIN_ID,
      role: "admin",
    });

    await seedCreditCardIntegrationMember({
      workspaceId: TEST_WORKSPACE_ID,
      userId: TEST_MEMBER_ID,
      role: "member",
    });

    const memberCreateContext = await buildCreditCardCallableContext(
      buildRequest(TEST_MEMBER_ID, createPurchasePayload),
      createCreditCardPurchasePayloadSchema,
      "createCreditCardPurchase",
    );

    assert.equal(memberCreateContext.auth.role, "member");

    await expectWorkspaceRoleDenied(() =>
      buildCreditCardCallableContext(
        buildRequest(TEST_MEMBER_ID, paymentPayload),
        registerCreditCardInvoicePaymentPayloadSchema,
        "registerCreditCardInvoicePayment",
      ),
    );

    await expectWorkspaceRoleDenied(() =>
      buildCreditCardCallableContext(
        buildRequest(TEST_MEMBER_ID, cancelPurchasePayload),
        cancelCreditCardPurchasePayloadSchema,
        "cancelCreditCardPurchase",
      ),
    );

    await expectWorkspaceRoleDenied(() =>
      buildCreditCardCallableContext(
        buildRequest(TEST_MEMBER_ID, reversePaymentPayload),
        reverseCreditCardInvoicePaymentPayloadSchema,
        "reverseCreditCardInvoicePayment",
      ),
    );

    await expectWorkspaceRoleDenied(() =>
      buildCreditCardCallableContext(
        buildRequest(TEST_MEMBER_ID, closeInvoicePayload),
        closeCreditCardInvoicePayloadSchema,
        "closeCreditCardInvoice",
      ),
    );

    await expectWorkspaceRoleDenied(() =>
      buildCreditCardCallableContext(
        buildRequest(TEST_MEMBER_ID, reopenInvoicePayload),
        reopenCreditCardInvoicePayloadSchema,
        "reopenCreditCardInvoice",
      ),
    );

    await expectWorkspaceRoleDenied(() =>
      buildCreditCardCallableContext(
        buildRequest(TEST_MEMBER_ID, recalculateLimitPayload),
        recalculateCardLimitPayloadSchema,
        "recalculateCardLimit",
      ),
    );

    await expectWorkspaceRoleDenied(() =>
      buildCreditCardCallableContext(
        buildRequest(TEST_MEMBER_ID, rebuildInvoicesPayload),
        rebuildCardInvoicesForCardPayloadSchema,
        "rebuildCardInvoicesForCard",
      ),
    );

    const ownerPaymentContext = await buildCreditCardCallableContext(
      buildRequest(TEST_OWNER_ID, paymentPayload),
      registerCreditCardInvoicePaymentPayloadSchema,
      "registerCreditCardInvoicePayment",
    );

    assert.equal(ownerPaymentContext.auth.role, "owner");

    const adminCancelContext = await buildCreditCardCallableContext(
      buildRequest(TEST_ADMIN_ID, cancelPurchasePayload),
      cancelCreditCardPurchasePayloadSchema,
      "cancelCreditCardPurchase",
    );

    assert.equal(adminCancelContext.auth.role, "admin");

    await expectWorkspaceMembershipRequired(() =>
      buildCreditCardCallableContext(
        buildRequest(TEST_OUTSIDER_ID, createPurchasePayload),
        createCreditCardPurchasePayloadSchema,
        "createCreditCardPurchase",
      ),
    );

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  },
);