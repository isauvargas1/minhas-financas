import assert from "node:assert/strict";
import test from "node:test";

import {
  CreditCardApplicationError,
} from "../errors";

import {
  recordCreditCardCallableFailureSafely,
} from "../observability";

import {idempotencyKeyDigest} from "../../shared/observabilityKeys";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-failure-observability-test";
const TEST_OWNER_ID = "user-credit-card-failure-observability-owner";
const TEST_CARD_ID = "card-credit-card-failure-observability-test";

const VICTIM_WORKSPACE_ID = "workspace-credit-card-failure-cross-tenant-victim";
const VICTIM_OWNER_ID = "user-credit-card-failure-cross-tenant-owner";
const VICTIM_CARD_ID = "card-credit-card-failure-cross-tenant";

const BOUNDED_WORKSPACE_ID = "workspace-credit-card-failure-bounded-events";
const BOUNDED_OWNER_ID = "user-credit-card-failure-bounded-owner";
const BOUNDED_CARD_ID = "card-credit-card-failure-bounded";

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
      ),
      TEST_WORKSPACE_ID
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
    // A chave de idempotência é persistida como digest, nunca crua
    // (INV-P2-039): a coleção é legível por qualquer membro do workspace.
    assert.equal(failureMetric.lastIdempotencyKey, undefined);
    assert.equal(
      failureMetric.lastIdempotencyKeyHash,
      idempotencyKeyDigest("failure-observability-payment-001")
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
test(
  "chamador não autenticado com workspaceId de vítima não grava documento algum",
  {
    skip: !process.env.FIRESTORE_EMULATOR_HOST,
  },
  async () => {
    // INV-P0-001. `recordCreditCardCallableFailure` roda no `catch` de todas
    // as callables de cartão, e esse `catch` também captura
    // `unauthenticated` e `workspace_role_denied`. Enquanto o `workspaceId`
    // vinha do `request.data` cru, uma chamada **sem token** gravava métrica,
    // evento financeiro e notificação no workspace de outro tenant, com
    // `amount`, `errorMessage` e `correlationId` sob controle do atacante e
    // sem teto de documentos.
    await resetCreditCardIntegrationWorkspace(VICTIM_WORKSPACE_ID);

    await seedCreditCardIntegrationWorkspace({
      workspaceId: VICTIM_WORKSPACE_ID,
      ownerId: VICTIM_OWNER_ID,
      cardId: VICTIM_CARD_ID,
    });

    const metricsBefore = await listCollectionRecords(
      `workspaces/${VICTIM_WORKSPACE_ID}/credit_card_operational_metrics`
    );
    const eventsBefore = await listCollectionRecords(
      `workspaces/${VICTIM_WORKSPACE_ID}/financial_events`
    );
    const notificationsBefore = await listCollectionRecords(
      `workspaces/${VICTIM_WORKSPACE_ID}/notifications`
    );

    for (const operation of [
      "createCreditCardPurchase",
      "registerCreditCardInvoicePayment",
      "reverseCreditCardInvoicePayment",
      "cancelCreditCardPurchase",
      "closeCreditCardInvoice",
      "reopenCreditCardInvoice",
      "rebuildCardInvoicesForCard",
      "recalculateCardLimit",
      "updateCreditCardPurchase",
    ] as const) {
      await recordCreditCardCallableFailureSafely(
        operation,
        {
          workspaceId: VICTIM_WORKSPACE_ID,
          cardId: VICTIM_CARD_ID,
          amount: 99999999,
          correlationId: `attack-${operation}`,
          idempotencyKey: `attack-${operation}`,
        },
        // Sem token: nem sequer há `uid`.
        undefined,
        new CreditCardApplicationError(
          "unauthenticated",
          "Usuário não autenticado."
        ),
        // Nenhum workspace foi autorizado — é o único parâmetro que a
        // observabilidade aceita como destino de escrita.
        undefined
      );
    }

    const metricsAfter = await listCollectionRecords(
      `workspaces/${VICTIM_WORKSPACE_ID}/credit_card_operational_metrics`
    );
    const eventsAfter = await listCollectionRecords(
      `workspaces/${VICTIM_WORKSPACE_ID}/financial_events`
    );
    const notificationsAfter = await listCollectionRecords(
      `workspaces/${VICTIM_WORKSPACE_ID}/notifications`
    );

    assert.equal(metricsAfter.length, metricsBefore.length);
    assert.equal(eventsAfter.length, eventsBefore.length);
    assert.equal(notificationsAfter.length, notificationsBefore.length);

    await resetCreditCardIntegrationWorkspace(VICTIM_WORKSPACE_ID);
  }
);

test(
  "ID do evento de falha não cresce com o correlationId do chamador",
  {
    skip: !process.env.FIRESTORE_EMULATOR_HOST,
  },
  async () => {
    // INV-P2-039: o ID vinha do `correlationId`, que muda a cada tentativa —
    // cada retry criava um documento novo em `financial_events`, sem teto.
    // A identidade passa a ser a intenção (chave de idempotência).
    await resetCreditCardIntegrationWorkspace(BOUNDED_WORKSPACE_ID);

    await seedCreditCardIntegrationWorkspace({
      workspaceId: BOUNDED_WORKSPACE_ID,
      ownerId: BOUNDED_OWNER_ID,
      cardId: BOUNDED_CARD_ID,
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await recordCreditCardCallableFailureSafely(
        "registerCreditCardInvoicePayment",
        {
          workspaceId: BOUNDED_WORKSPACE_ID,
          cardId: BOUNDED_CARD_ID,
          amount: 100,
          idempotencyKey: "bounded-intent-001",
          correlationId: `retry-${attempt}`,
        },
        BOUNDED_OWNER_ID,
        new CreditCardApplicationError(
          "domain_precondition_failed",
          "Fatura não aceita pagamento neste estado."
        ),
        BOUNDED_WORKSPACE_ID
      );
    }

    const events = await listCollectionRecords(
      `workspaces/${BOUNDED_WORKSPACE_ID}/financial_events`
    );
    const failureEvents = events.filter(
      (event) => event.eventType === "processing_failure"
    );

    assert.equal(failureEvents.length, 1);
    assert.equal(failureEvents[0].idempotencyKey, undefined);
    assert.equal(
      failureEvents[0].idempotencyKeyHash,
      idempotencyKeyDigest("bounded-intent-001")
    );

    await resetCreditCardIntegrationWorkspace(BOUNDED_WORKSPACE_ID);
  }
);
