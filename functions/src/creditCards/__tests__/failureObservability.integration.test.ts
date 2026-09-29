import assert from "node:assert/strict";
import test from "node:test";

import {HttpsError} from "firebase-functions/v2/https";

import {
  ApplicationError,
} from "../../shared/errors";

import {
  callableRequest,
  seedActiveAccount,
} from "../../shared/testSupport/kernelTestSupport";

import {
  createCreditCardPurchase,
  registerCreditCardInvoicePayment,
} from "../callables";

import {
  recordCreditCardCallableFailureSafely,
} from "../observability";

import {idempotencyKeyDigest} from "../../shared/observabilityKeys";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationMember,
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

const CALLABLE_WORKSPACE_ID = "workspace-credit-card-failure-callable";
const CALLABLE_OWNER_ID = "user-credit-card-failure-callable-owner";
const CALLABLE_MEMBER_ID = "user-credit-card-failure-callable-member";
const CALLABLE_VIEWER_ID = "user-credit-card-failure-callable-viewer";
const CALLABLE_OUTSIDER_ID = "user-credit-card-failure-callable-outsider";
const CALLABLE_CARD_ID = "card-credit-card-failure-callable";

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
      new ApplicationError(
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
        new ApplicationError(
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
        new ApplicationError(
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

const callablePurchasePayload = (
  workspaceId: string,
  cardId: string,
  idempotencyKey: string,
  totalAmount: number,
) => ({
  workspaceId,
  cardId,
  description: "Compra acima do limite",
  categorySnapshot: {label: "Testes"},
  purchaseDate: "2026-04-05",
  totalAmount,
  installmentsCount: 1,
  amountType: "total",
  source: "manual",
  idempotencyKey,
  correlationId: `${idempotencyKey}-correlation`,
});

test(
  "callable: falha de domínio de chamador autorizado grava evento de " +
    "domínio, métrica e evento de falha no workspace dele",
  async () => {
    await resetCreditCardIntegrationWorkspace(CALLABLE_WORKSPACE_ID);

    await seedCreditCardIntegrationWorkspace({
      workspaceId: CALLABLE_WORKSPACE_ID,
      ownerId: CALLABLE_OWNER_ID,
      cardId: CALLABLE_CARD_ID,
    });

    await seedCreditCardIntegrationMember({
      workspaceId: CALLABLE_WORKSPACE_ID,
      userId: CALLABLE_MEMBER_ID,
      role: "member",
    });

    await assert.rejects(
      () => createCreditCardPurchase.run(callableRequest(
        CALLABLE_MEMBER_ID,
        callablePurchasePayload(
          CALLABLE_WORKSPACE_ID,
          CALLABLE_CARD_ID,
          "failure-callable-limit-exceeded-001",
          999999,
        ),
      )),
      (error: unknown) =>
        error instanceof HttpsError &&
        error.code === "failed-precondition" &&
        error.message === "Limite disponível insuficiente para esta compra.",
    );

    await assert.rejects(
      () => registerCreditCardInvoicePayment.run(callableRequest(
        CALLABLE_OWNER_ID,
        {
          workspaceId: CALLABLE_WORKSPACE_ID,
          cardId: CALLABLE_CARD_ID,
          invoiceId: `${CALLABLE_CARD_ID}_2030-01`,
          paymentDate: "2030-01-20",
          amount: 100,
          paymentMethod: "external",
          idempotencyKey: "failure-callable-missing-invoice-001",
          correlationId: "failure-callable-missing-invoice",
        },
      )),
      (error: unknown) =>
        error instanceof HttpsError && error.code === "not-found",
    );

    const events = await listCollectionRecords(
      `workspaces/${CALLABLE_WORKSPACE_ID}/financial_events`
    );

    const limitExceededEvent = events.find(
      (event) => event.eventType === "purchase_limit_exceeded"
    );

    assert.ok(limitExceededEvent);
    assert.equal(limitExceededEvent.actorId, CALLABLE_MEMBER_ID);
    assert.equal(limitExceededEvent.cardId, CALLABLE_CARD_ID);

    const failureEvents = events.filter(
      (event) => event.eventType === "processing_failure"
    );

    assert.deepEqual(
      failureEvents.map((event) => event.actorId).sort(),
      [CALLABLE_MEMBER_ID, CALLABLE_OWNER_ID].sort(),
    );

    const metrics = await listCollectionRecords(
      `workspaces/${CALLABLE_WORKSPACE_ID}/credit_card_operational_metrics`
    );

    const purchaseFailureMetric = metrics.find(
      (metric) =>
        metric.operation === "purchase_created" &&
        metric.status === "failure"
    );
    const paymentFailureMetric = metrics.find(
      (metric) =>
        metric.operation === "invoice_payment_posted" &&
        metric.status === "failure"
    );

    assert.equal(purchaseFailureMetric?.lastActorId, CALLABLE_MEMBER_ID);
    assert.equal(paymentFailureMetric?.lastActorId, CALLABLE_OWNER_ID);

    // A falha não consumiu limite nem criou compra.
    const purchases = await listCollectionRecords(
      `workspaces/${CALLABLE_WORKSPACE_ID}/credit_card_purchases`
    );
    const limitSnapshot = await getIntegrationFirestore()
      .doc(
        `workspaces/${CALLABLE_WORKSPACE_ID}/card_limit_snapshots/` +
          CALLABLE_CARD_ID
      )
      .get();

    assert.equal(purchases.length, 0);
    assert.equal(limitSnapshot.get("limitUsed"), 0);
    assert.equal(limitSnapshot.get("limitAvailable"), 5000);

    await resetCreditCardIntegrationWorkspace(CALLABLE_WORKSPACE_ID);
  }
);

test(
  "callable: chamada sem token, de não membro ou de papel negado não grava " +
    "nada no workspace alvo",
  async () => {
    // INV-P0-001 de ponta a ponta: o `workspaceId` que o kernel entrega ao
    // `onFailure` é o do payload, ainda não autorizado. Nenhuma dessas falhas
    // pode virar métrica, evento ou notificação no workspace alvo.
    await resetCreditCardIntegrationWorkspace(CALLABLE_WORKSPACE_ID);

    await seedCreditCardIntegrationWorkspace({
      workspaceId: CALLABLE_WORKSPACE_ID,
      ownerId: CALLABLE_OWNER_ID,
      cardId: CALLABLE_CARD_ID,
    });

    await seedCreditCardIntegrationMember({
      workspaceId: CALLABLE_WORKSPACE_ID,
      userId: CALLABLE_MEMBER_ID,
      role: "member",
    });

    await seedCreditCardIntegrationMember({
      workspaceId: CALLABLE_WORKSPACE_ID,
      userId: CALLABLE_VIEWER_ID,
      role: "viewer",
    });

    await seedActiveAccount(CALLABLE_OUTSIDER_ID);

    const attackPayload = callablePurchasePayload(
      CALLABLE_WORKSPACE_ID,
      CALLABLE_CARD_ID,
      "failure-callable-attack-001",
      99999999,
    );

    await assert.rejects(
      () => createCreditCardPurchase.run(callableRequest(null, attackPayload)),
      (error: unknown) =>
        error instanceof HttpsError && error.code === "unauthenticated",
    );

    for (const uid of [CALLABLE_OUTSIDER_ID, CALLABLE_VIEWER_ID]) {
      await assert.rejects(
        () => createCreditCardPurchase.run(callableRequest(uid, attackPayload)),
        (error: unknown) =>
          error instanceof HttpsError && error.code === "permission-denied",
      );
    }

    await assert.rejects(
      () => registerCreditCardInvoicePayment.run(callableRequest(
        CALLABLE_MEMBER_ID,
        {
          workspaceId: CALLABLE_WORKSPACE_ID,
          cardId: CALLABLE_CARD_ID,
          invoiceId: `${CALLABLE_CARD_ID}_2026-04`,
          paymentDate: "2026-04-20",
          amount: 99999999,
          paymentMethod: "external",
          idempotencyKey: "failure-callable-attack-payment-001",
          correlationId: "failure-callable-attack-payment",
        },
      )),
      (error: unknown) =>
        error instanceof HttpsError && error.code === "permission-denied",
    );

    for (const collectionName of [
      "credit_card_operational_metrics",
      "financial_events",
      "notifications",
      "credit_card_purchases",
      "credit_card_idempotency_keys",
    ]) {
      const records = await listCollectionRecords(
        `workspaces/${CALLABLE_WORKSPACE_ID}/${collectionName}`
      );

      assert.equal(records.length, 0, collectionName);
    }

    await resetCreditCardIntegrationWorkspace(CALLABLE_WORKSPACE_ID);
  }
);
