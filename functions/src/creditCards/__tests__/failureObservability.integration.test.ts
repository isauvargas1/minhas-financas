import assert from "node:assert/strict";
import test from "node:test";

import {
  CreditCardApplicationError,
} from "../errors";

import {
  recordCreditCardCallableFailureSafely,
} from "../observability";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-failure-observability-test";
const TEST_OWNER_ID = "user-credit-card-failure-observability-owner";
const TEST_CARD_ID = "card-credit-card-failure-observability-test";

type FirestoreRecord = Record<string, unknown> & {id: string};

const listCollectionRecords = async (
  collectionPath: string
): Promise<FirestoreRecord[]> => {
  const db = getIntegrationFirestore();
  const snapshot = await db.collection(collectionPath).get();

  return snapshot.docs.map((documentSnapshot) => ({
    id: documentSnapshot.id,
    ...documentSnapshot.data(),
  }));
};

test(
  "falha de operação crítica deve gerar métrica, evento e notificação de processamento",
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

    await recordCreditCardCallableFailureSafely(
      "registerCreditCardInvoicePayment",
      {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        invoiceId: `${TEST_CARD_ID}_2026-04`,
        amount: 100,
        idempotencyKey: "failure-observability-payment-001",
        correlationId: "failure-observability-payment",
      },
      TEST_OWNER_ID,
      new CreditCardApplicationError(
        "domain_precondition_failed",
        "Fatura não aceita pagamento neste estado.",
        {
          invoiceId: `${TEST_CARD_ID}_2026-04`,
        }
      )
    );

    const metrics = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/credit_card_operational_metrics`
    );

    const failureMetric = metrics.find(
      (metric) =>
        metric.operation === "invoice_payment_posted" &&
        metric.status === "failure"
    );

    assert.ok(failureMetric);
    assert.equal(failureMetric.workspaceId, TEST_WORKSPACE_ID);
    assert.equal(failureMetric.domain, "credit_card");
    assert.equal(failureMetric.count, 1);
    assert.equal(failureMetric.amountTotal, 100);
    assert.equal(failureMetric.lastActorId, TEST_OWNER_ID);
    assert.equal(failureMetric.lastCardId, TEST_CARD_ID);
    assert.equal(
      failureMetric.lastCorrelationId,
      "failure-observability-payment"
    );
    assert.equal(
      failureMetric.lastIdempotencyKey,
      "failure-observability-payment-001"
    );

    const financialEvents = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/financial_events`
    );

    const failureEvent = financialEvents.find(
      (event) => event.eventType === "processing_failure"
    );

    assert.ok(failureEvent);
    assert.equal(failureEvent.workspaceId, TEST_WORKSPACE_ID);
    assert.equal(failureEvent.actorId, TEST_OWNER_ID);
    assert.equal(failureEvent.cardId, TEST_CARD_ID);
    assert.equal(failureEvent.invoiceId, `${TEST_CARD_ID}_2026-04`);
    assert.equal(failureEvent.correlationId, "failure-observability-payment");

    const notifications = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/notifications`
    );

    const failureNotification = notifications.find(
      (notification) =>
        notification.domainEventType === "processing_failure" &&
        notification.cardId === TEST_CARD_ID
    );

    assert.ok(failureNotification);
    assert.equal(failureNotification.source, "credit_card_domain_event");
    assert.equal(failureNotification.type, "error");

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  }
);