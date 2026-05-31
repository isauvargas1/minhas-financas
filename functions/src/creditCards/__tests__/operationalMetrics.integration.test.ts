import assert from "node:assert/strict";
import test from "node:test";

import {
  executeCancelCreditCardPurchase,
  type CancelCreditCardPurchaseResult,
} from "../cancelPurchase";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "../createPurchase";

import {
  executeRebuildCardInvoicesForCard,
  type RebuildCardInvoicesForCardResult,
} from "../rebuildInvoices";

import {
  executeRegisterCreditCardInvoicePayment,
  type RegisterCreditCardInvoicePaymentResult,
} from "../registerInvoicePayment";

import {
  executeReverseCreditCardInvoicePayment,
  type ReverseCreditCardInvoicePaymentResult,
} from "../reverseInvoicePayment";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-operational-metrics-test";
const TEST_OWNER_ID = "user-credit-card-operational-metrics-owner";
const TEST_CARD_ID = "card-credit-card-operational-metrics-test";

type FirestoreRecord = Record<string, unknown> & {id: string};

const listCollectionRecords = async (
  collectionPath: string,
): Promise<FirestoreRecord[]> => {
  const db = getIntegrationFirestore();
  const snapshot = await db.collection(collectionPath).get();

  return snapshot.docs.map((documentSnapshot) => ({
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  }));
};

const findSuccessMetric = (
  metrics: FirestoreRecord[],
  operation: string,
): FirestoreRecord => {
  const metric = metrics.find(
    (item) => item.operation === operation && item.status === "success",
  );

  assert.ok(metric, `Métrica não encontrada para ${operation}.`);

  return metric;
};

test(
  "operações críticas devem registrar métricas operacionais por workspace",
  {
    skip: !process.env.FIRESTORE_EMULATOR_HOST,
  },
  async () => {
    const db = getIntegrationFirestore();

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);

    await seedCreditCardIntegrationWorkspace({
      workspaceId: TEST_WORKSPACE_ID,
      ownerId: TEST_OWNER_ID,
      cardId: TEST_CARD_ID,
    });

    const purchaseForPaymentResult = await executeCreateCreditCardPurchase({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        description: "Compra para métrica de pagamento",
        categoryId: "category-metrics-payment",
        categorySnapshot: {
          id: "category-metrics-payment",
          label: "Métrica Pagamento",
          normalizedLabel: "metrica pagamento",
          icon: "tag",
          color: "#6366f1",
        },
        purchaseDate: "2026-04-05",
        totalAmount: 400,
        installmentsCount: 1,
        amountType: "total",
        source: "manual",
        idempotencyKey: "integration-metrics-purchase-payment-001",
        correlationId: "integration-metrics-purchase-payment",
      },
    } as any) as CreateCreditCardPurchaseResult;

    assert.equal(purchaseForPaymentResult.success, true);

    const invoiceId = `${TEST_CARD_ID}_2026-04`;

    const paymentResult = await executeRegisterCreditCardInvoicePayment({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        invoiceId,
        paymentDate: "2026-04-20",
        amount: 400,
        paymentMethod: "external",
        idempotencyKey: "integration-metrics-payment-001",
        correlationId: "integration-metrics-payment",
      },
    } as any) as RegisterCreditCardInvoicePaymentResult;

    assert.equal(paymentResult.success, true);

    const reversalResult = await executeReverseCreditCardInvoicePayment({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        invoiceId,
        paymentId: paymentResult.paymentId,
        reversedAt: "2026-04-22",
        reason: "Teste de métrica de estorno",
        idempotencyKey: "integration-metrics-reversal-001",
        correlationId: "integration-metrics-reversal",
      },
    } as any) as ReverseCreditCardInvoicePaymentResult;

    assert.equal(reversalResult.success, true);

    const purchaseForCancellationResult = await executeCreateCreditCardPurchase({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        description: "Compra para métrica de cancelamento",
        categoryId: "category-metrics-cancel",
        categorySnapshot: {
          id: "category-metrics-cancel",
          label: "Métrica Cancelamento",
          normalizedLabel: "metrica cancelamento",
          icon: "tag",
          color: "#6366f1",
        },
        purchaseDate: "2026-05-05",
        totalAmount: 300,
        installmentsCount: 1,
        amountType: "total",
        source: "manual",
        idempotencyKey: "integration-metrics-purchase-cancel-001",
        correlationId: "integration-metrics-purchase-cancel",
      },
    } as any) as CreateCreditCardPurchaseResult;

    assert.equal(purchaseForCancellationResult.success, true);

    const cancellationResult = await executeCancelCreditCardPurchase({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        purchaseId: purchaseForCancellationResult.purchaseId,
        reason: "Teste de métrica de cancelamento",
        policy: "block_if_invoice_paid",
        idempotencyKey: "integration-metrics-cancel-001",
        correlationId: "integration-metrics-cancel",
      },
    } as any) as CancelCreditCardPurchaseResult;

    assert.equal(cancellationResult.success, true);

    const rebuildResult = await executeRebuildCardInvoicesForCard({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        fromCompetenceMonth: "2026-04",
        toCompetenceMonth: "2026-05",
        reason: "Teste de métrica de rebuild",
        idempotencyKey: "integration-metrics-rebuild-001",
        correlationId: "integration-metrics-rebuild",
      },
    } as any) as RebuildCardInvoicesForCardResult;

    assert.equal(rebuildResult.success, true);

    const metrics = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/credit_card_operational_metrics`,
    );

    assert.ok(metrics.length >= 5);

    const purchaseMetric = findSuccessMetric(metrics, "purchase_created");
    assert.equal(purchaseMetric.workspaceId, TEST_WORKSPACE_ID);
    assert.equal(purchaseMetric.domain, "credit_card");
    assert.equal(purchaseMetric.count, 2);
    assert.equal(purchaseMetric.amountTotal, 700);
    assert.equal(purchaseMetric.lastActorId, TEST_OWNER_ID);
    assert.equal(purchaseMetric.lastCardId, TEST_CARD_ID);
    assert.equal(
      purchaseMetric.lastIdempotencyKey,
      "integration-metrics-purchase-cancel-001",
    );
    assert.equal(
      purchaseMetric.lastCorrelationId,
      "integration-metrics-purchase-cancel",
    );

    const paymentMetric = findSuccessMetric(metrics, "invoice_payment_posted");
    assert.equal(paymentMetric.count, 1);
    assert.equal(paymentMetric.amountTotal, 400);
    assert.equal(paymentMetric.lastActorId, TEST_OWNER_ID);
    assert.equal(paymentMetric.lastCardId, TEST_CARD_ID);
    assert.equal(paymentMetric.lastInvoiceId, invoiceId);
    assert.equal(paymentMetric.lastPaymentId, paymentResult.paymentId);
    assert.equal(paymentMetric.lastIdempotencyKey, "integration-metrics-payment-001");

    const reversalMetric = findSuccessMetric(metrics, "invoice_payment_reversed");
    assert.equal(reversalMetric.count, 1);
    assert.equal(reversalMetric.amountTotal, 400);
    assert.equal(reversalMetric.lastActorId, TEST_OWNER_ID);
    assert.equal(reversalMetric.lastCardId, TEST_CARD_ID);
    assert.equal(reversalMetric.lastInvoiceId, invoiceId);
    assert.equal(reversalMetric.lastPaymentId, paymentResult.paymentId);
    assert.equal(reversalMetric.lastIdempotencyKey, "integration-metrics-reversal-001");

    const cancellationMetric = findSuccessMetric(metrics, "purchase_cancelled");
    assert.equal(cancellationMetric.count, 1);
    assert.equal(cancellationMetric.amountTotal, 300);
    assert.equal(cancellationMetric.lastActorId, TEST_OWNER_ID);
    assert.equal(cancellationMetric.lastCardId, TEST_CARD_ID);
    assert.equal(cancellationMetric.lastPurchaseId, purchaseForCancellationResult.purchaseId);
    assert.equal(cancellationMetric.lastIdempotencyKey, "integration-metrics-cancel-001");

    const rebuildMetric = findSuccessMetric(metrics, "card_invoices_rebuilt");
    assert.equal(rebuildMetric.count, 1);
    assert.equal(rebuildMetric.lastActorId, TEST_OWNER_ID);
    assert.equal(rebuildMetric.lastCardId, TEST_CARD_ID);
    assert.equal(rebuildMetric.lastCorrelationId, "integration-metrics-rebuild");
    assert.equal(rebuildMetric.lastIdempotencyKey, "integration-metrics-rebuild-001");

    const workspaceSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}`)
      .get();

    assert.equal(workspaceSnapshot.exists, true);

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  },
);