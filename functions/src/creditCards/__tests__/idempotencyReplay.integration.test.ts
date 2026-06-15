import assert from "node:assert/strict";
import test from "node:test";

import type {
  CreditCardCallableExecutionContext,
} from "../callable";

import type {
  CreateCreditCardPurchasePayload,
} from "../contracts";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "../createPurchase";

import {
  CreditCardApplicationError,
} from "../errors";

import {
  getCreditCardBackendWritePlan,
  type CreditCardBackendWriteOperation,
} from "../writeStrategy";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-idempotency-replay-test";
const TEST_OWNER_ID = "user-credit-card-idempotency-replay-owner";
const TEST_CARD_ID = "card-credit-card-idempotency-replay-test";

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

const buildPurchasePayload = (
  overrides: Partial<CreateCreditCardPurchasePayload> = {}
): CreateCreditCardPurchasePayload => ({
  workspaceId: TEST_WORKSPACE_ID,
  cardId: TEST_CARD_ID,
  description: "Compra replay idempotente",
  categorySnapshot: {
    label: "Testes",
  },
  purchaseDate: "2026-04-05",
  totalAmount: 120,
  installmentsCount: 2,
  amountType: "total",
  source: "manual",
  idempotencyKey: "idempotency-replay-create-purchase-001",
  correlationId: "idempotency-replay-create-purchase",
  ...overrides,
});

const expectIdempotencyConflict = async (
  operation: () => Promise<unknown>
): Promise<void> => {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof CreditCardApplicationError &&
      error.code === "idempotency_conflict"
  );
};

test(
  "mesma idempotencyKey com mesmo payload deve retornar replay sem duplicar efeitos financeiros",
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

    const payload = buildPurchasePayload();
    const context = buildContext(payload, "createCreditCardPurchase");

    const firstResult = await executeCreateCreditCardPurchase(
      context
    ) as CreateCreditCardPurchaseResult;

    const secondResult = await executeCreateCreditCardPurchase(
      context
    ) as CreateCreditCardPurchaseResult;

    assert.equal(secondResult.purchaseId, firstResult.purchaseId);
    assert.deepEqual(secondResult.installmentIds, firstResult.installmentIds);
    assert.deepEqual(secondResult.invoiceIds, firstResult.invoiceIds);
    assert.equal(secondResult.ledgerEntryId, firstResult.ledgerEntryId);

    assert.equal(await countCollection("credit_card_purchases"), 1);
    assert.equal(await countCollection("credit_card_installments"), 2);
    assert.equal(await countCollection("credit_card_invoices"), 2);
    assert.equal(await countCollection("card_limit_ledger"), 1);
    assert.equal(await countCollection("financial_events"), 1);
    assert.equal(await countCollection("credit_card_idempotency_keys"), 1);

    const db = getIntegrationFirestore();
    const limitSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`)
      .get();

    assert.equal(limitSnapshot.data()?.limitUsed, 120);
    assert.equal(limitSnapshot.data()?.limitAvailable, 4880);

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  }
);

test(
  "mesma idempotencyKey com payload diferente deve bloquear replay incompatível",
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

    const originalPayload = buildPurchasePayload({
      idempotencyKey: "idempotency-replay-conflict-001",
    });

    const conflictingPayload = buildPurchasePayload({
      description: "Compra replay conflitante",
      totalAmount: 180,
      idempotencyKey: "idempotency-replay-conflict-001",
    });

    await executeCreateCreditCardPurchase(
      buildContext(originalPayload, "createCreditCardPurchase")
    );

    await expectIdempotencyConflict(() =>
      executeCreateCreditCardPurchase(
        buildContext(conflictingPayload, "createCreditCardPurchase")
      )
    );

    assert.equal(await countCollection("credit_card_purchases"), 1);
    assert.equal(await countCollection("credit_card_installments"), 2);
    assert.equal(await countCollection("credit_card_invoices"), 2);
    assert.equal(await countCollection("card_limit_ledger"), 1);
    assert.equal(await countCollection("financial_events"), 1);
    assert.equal(await countCollection("credit_card_idempotency_keys"), 1);

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  }
);