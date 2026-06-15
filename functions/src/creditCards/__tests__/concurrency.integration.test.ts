import assert from "node:assert/strict";
import test from "node:test";

import type {
  CreditCardCallableExecutionContext,
} from "../callable";

import type {
  CancelCreditCardPurchasePayload,
  CreateCreditCardPurchasePayload,
  RegisterCreditCardInvoicePaymentPayload,
  ReverseCreditCardInvoicePaymentPayload,
} from "../contracts";

import {
  executeCancelCreditCardPurchase,
} from "../cancelPurchase";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "../createPurchase";

import {
  CreditCardApplicationError,
} from "../errors";

import {
  executeRegisterCreditCardInvoicePayment,
  type RegisterCreditCardInvoicePaymentResult,
} from "../registerInvoicePayment";

import {
  executeReverseCreditCardInvoicePayment,
} from "../reverseInvoicePayment";

import {
  getCreditCardBackendWritePlan,
  type CreditCardBackendWriteOperation,
} from "../writeStrategy";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-concurrency-test";
const TEST_OWNER_ID = "user-credit-card-concurrency-owner";
const TEST_CARD_ID = "card-credit-card-concurrency-test";

const buildContext = <TPayload extends {workspaceId: string}>(
  payload: TPayload,
  operation: CreditCardBackendWriteOperation
): CreditCardCallableExecutionContext<TPayload> => ({
  payload,
  auth: {
    uid: TEST_OWNER_ID,
    workspaceId: payload.workspaceId,
    role: "owner",
  },
  plan: getCreditCardBackendWritePlan(operation),
});

const countCollection = async (
  collectionName: string
): Promise<number> => {
  const db = getIntegrationFirestore();
  const snapshot = await db
    .collection(`workspaces/${TEST_WORKSPACE_ID}/${collectionName}`)
    .get();

  return snapshot.size;
};

const countLedgerByDirection = async (
  direction: "consume" | "restore"
): Promise<number> => {
  const db = getIntegrationFirestore();
  const snapshot = await db
    .collection(`workspaces/${TEST_WORKSPACE_ID}/card_limit_ledger`)
    .where("direction", "==", direction)
    .get();

  return snapshot.size;
};

const getInvoiceData = async (
  invoiceId: string
): Promise<Record<string, unknown> | undefined> => {
  const db = getIntegrationFirestore();
  const snapshot = await db
    .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${invoiceId}`)
    .get();

  return snapshot.data();
};

const getLimitSnapshotData = async (): Promise<Record<string, unknown> | undefined> => {
  const db = getIntegrationFirestore();
  const snapshot = await db
    .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`)
    .get();

  return snapshot.data();
};

const setupWorkspace = async (): Promise<void> => {
  await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);

  await seedCreditCardIntegrationWorkspace({
    workspaceId: TEST_WORKSPACE_ID,
    ownerId: TEST_OWNER_ID,
    cardId: TEST_CARD_ID,
  });
};

const createSingleInstallmentPurchase = async (
  idempotencyKey: string
): Promise<CreateCreditCardPurchaseResult> => {
  const payload: CreateCreditCardPurchasePayload = {
    workspaceId: TEST_WORKSPACE_ID,
    cardId: TEST_CARD_ID,
    description: "Compra concorrência",
    categorySnapshot: {
      label: "Testes",
    },
    purchaseDate: "2026-04-05",
    totalAmount: 100,
    installmentsCount: 1,
    amountType: "total",
    source: "manual",
    idempotencyKey,
    correlationId: idempotencyKey,
  };

  return await executeCreateCreditCardPurchase(
    buildContext(payload, "createCreditCardPurchase")
  ) as CreateCreditCardPurchaseResult;
};

const payInvoice = async (
  invoiceId: string,
  idempotencyKey: string
): Promise<RegisterCreditCardInvoicePaymentResult> => {
  const payload: RegisterCreditCardInvoicePaymentPayload = {
    workspaceId: TEST_WORKSPACE_ID,
    cardId: TEST_CARD_ID,
    invoiceId,
    paymentDate: "2026-04-20",
    amount: 100,
    paymentMethod: "external",
    idempotencyKey,
    correlationId: idempotencyKey,
  };

  return await executeRegisterCreditCardInvoicePayment(
    buildContext(payload, "registerCreditCardInvoicePayment")
  ) as RegisterCreditCardInvoicePaymentResult;
};

const reversePayment = async (
  invoiceId: string,
  paymentId: string,
  idempotencyKey: string
): Promise<unknown> => {
  const payload: ReverseCreditCardInvoicePaymentPayload = {
    workspaceId: TEST_WORKSPACE_ID,
    cardId: TEST_CARD_ID,
    invoiceId,
    paymentId,
    reason: "Teste de concorrência no estorno",
    reversedAt: "2026-04-21",
    idempotencyKey,
    correlationId: idempotencyKey,
  };

  return executeReverseCreditCardInvoicePayment(
    buildContext(payload, "reverseCreditCardInvoicePayment")
  );
};

const expectDomainPreconditionFailure = async (
  operation: () => Promise<unknown>
): Promise<void> => {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      error.code === "domain_precondition_failed"
  );
};

test(
  "dois pagamentos simultâneos na mesma fatura devem preservar consistência financeira",
  {
    skip: !process.env.FIRESTORE_EMULATOR_HOST,
  },
  async () => {
    await setupWorkspace();

    const purchaseResult = await createSingleInstallmentPurchase(
      "concurrency-payment-create-001"
    );

    const invoiceId = purchaseResult.invoiceIds[0];

    const results = await Promise.allSettled([
      payInvoice(invoiceId, "concurrency-payment-first-001"),
      payInvoice(invoiceId, "concurrency-payment-second-001"),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const invoice = await getInvoiceData(invoiceId);
    const limitSnapshot = await getLimitSnapshotData();

    assert.equal(invoice?.status, "paid");
    assert.equal(invoice?.paidAmount, 100);
    assert.equal(invoice?.remainingAmount, 0);

    assert.equal(limitSnapshot?.limitUsed, 0);
    assert.equal(limitSnapshot?.limitAvailable, 5000);

    assert.equal(await countCollection("credit_card_invoice_payments"), 1);
    assert.equal(await countLedgerByDirection("consume"), 1);
    assert.equal(await countLedgerByDirection("restore"), 1);
    assert.equal(await countCollection("transactions"), 1);

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  }
);

test(
  "dois estornos simultâneos do mesmo pagamento devem preservar fatura, limite, ledger e caixa",
  {
    skip: !process.env.FIRESTORE_EMULATOR_HOST,
  },
  async () => {
    await setupWorkspace();

    const purchaseResult = await createSingleInstallmentPurchase(
      "concurrency-reversal-create-001"
    );

    const invoiceId = purchaseResult.invoiceIds[0];

    const paymentResult = await payInvoice(
      invoiceId,
      "concurrency-reversal-payment-001"
    );

    const results = await Promise.allSettled([
      reversePayment(
        invoiceId,
        paymentResult.paymentId,
        "concurrency-reversal-first-001"
      ),
      reversePayment(
        invoiceId,
        paymentResult.paymentId,
        "concurrency-reversal-second-001"
      ),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const db = getIntegrationFirestore();
    const paymentSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoice_payments/${paymentResult.paymentId}`)
      .get();

    const invoice = await getInvoiceData(invoiceId);
    const limitSnapshot = await getLimitSnapshotData();

    assert.equal(paymentSnapshot.data()?.status, "reversed");
    assert.equal(invoice?.paidAmount, 0);
    assert.equal(invoice?.remainingAmount, 100);
    assert.equal(limitSnapshot?.limitUsed, 100);
    assert.equal(limitSnapshot?.limitAvailable, 4900);

    assert.equal(await countCollection("credit_card_invoice_payments"), 1);
    assert.equal(await countLedgerByDirection("consume"), 2);
    assert.equal(await countLedgerByDirection("restore"), 1);
    assert.equal(await countCollection("transactions"), 2);

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  }
);

test(
  "cancelamento de compra com fatura paga deve ser bloqueado",
  {
    skip: !process.env.FIRESTORE_EMULATOR_HOST,
  },
  async () => {
    await setupWorkspace();

    const purchaseResult = await createSingleInstallmentPurchase(
      "concurrency-cancel-paid-create-001"
    );

    const invoiceId = purchaseResult.invoiceIds[0];

    await payInvoice(
      invoiceId,
      "concurrency-cancel-paid-payment-001"
    );

    const cancelPayload: CancelCreditCardPurchasePayload = {
      workspaceId: TEST_WORKSPACE_ID,
      cardId: TEST_CARD_ID,
      purchaseId: purchaseResult.purchaseId,
      reason: "Teste de bloqueio de cancelamento com fatura paga",
      policy: "block_if_invoice_paid",
      idempotencyKey: "concurrency-cancel-paid-purchase-001",
      correlationId: "concurrency-cancel-paid-purchase",
    };

    await expectDomainPreconditionFailure(() =>
      executeCancelCreditCardPurchase(
        buildContext(cancelPayload, "cancelCreditCardPurchase")
      )
    );

    const db = getIntegrationFirestore();
    const purchaseSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_purchases/${purchaseResult.purchaseId}`)
      .get();

    const invoice = await getInvoiceData(invoiceId);
    const limitSnapshot = await getLimitSnapshotData();

    assert.equal(purchaseSnapshot.data()?.status, "active");
    assert.equal(invoice?.status, "paid");
    assert.equal(invoice?.paidAmount, 100);
    assert.equal(invoice?.remainingAmount, 0);
    assert.equal(limitSnapshot?.limitUsed, 0);
    assert.equal(limitSnapshot?.limitAvailable, 5000);

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  }
);