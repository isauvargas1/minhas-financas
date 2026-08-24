import assert from "node:assert/strict";
import test from "node:test";

import {idempotencyKeyDigest} from "../../shared/observabilityKeys";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "../createPurchase";

import {
  executeRecalculateCardLimit,
  type RecalculateCardLimitResult,
} from "../recalculateCardLimit";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-recalculate-limit-test";
const TEST_OWNER_ID = "user-credit-card-recalculate-limit-owner";
const TEST_CARD_ID = "card-credit-card-recalculate-limit-test";

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

const findSuccessMetric = (
  metrics: FirestoreRecord[],
  operation: string
): FirestoreRecord => {
  const metric = metrics.find(
    (item) => item.operation === operation && item.status === "success"
  );

  assert.ok(metric, `Métrica não encontrada para ${operation}.`);

  return metric;
};

test(
  "recalculateCardLimit deve recalcular limite a partir do ledger e registrar evento, auditoria e métrica",
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

    const purchaseResult = await executeCreateCreditCardPurchase({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        description: "Compra para recálculo de limite",
        categoryId: "category-recalculate-limit-test",
        categorySnapshot: {
          id: "category-recalculate-limit-test",
          label: "Recálculo",
          normalizedLabel: "recalculo",
          icon: "tag",
          color: "#6366f1",
        },
        purchaseDate: "2026-04-05",
        totalAmount: 100,
        installmentsCount: 1,
        amountType: "total",
        source: "manual",
        idempotencyKey: "integration-recalculate-limit-create-001",
        correlationId: "integration-recalculate-limit-create",
      },
    } as any) as CreateCreditCardPurchaseResult;

    assert.equal(purchaseResult.success, true);

    await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`)
      .set(
        {
          limitUsed: 999,
          limitAvailable: 4001,
        },
        {merge: true}
      );

    const recalculateResult = await executeRecalculateCardLimit({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        reason: "Teste de recálculo a partir do ledger",
        idempotencyKey: "integration-recalculate-limit-001",
        correlationId: "integration-recalculate-limit",
      },
    } as any) as RecalculateCardLimitResult;

    assert.equal(recalculateResult.success, true);
    assert.equal(recalculateResult.cardId, TEST_CARD_ID);
    assert.equal(recalculateResult.ledgerEntriesCount, 1);
    assert.equal(recalculateResult.limitSnapshot.limitTotal, 5000);
    assert.equal(recalculateResult.limitSnapshot.limitUsed, 100);
    assert.equal(recalculateResult.limitSnapshot.limitAvailable, 4900);

    const limitSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`)
      .get();

    assert.equal(limitSnapshot.data()?.limitTotal, 5000);
    assert.equal(limitSnapshot.data()?.limitUsed, 100);
    assert.equal(limitSnapshot.data()?.limitAvailable, 4900);

    const financialEventSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/financial_events/${recalculateResult.eventId}`)
      .get();

    assert.equal(financialEventSnapshot.exists, true);
    assert.equal(financialEventSnapshot.data()?.eventType, "reconciliation_warning");
    assert.equal(financialEventSnapshot.data()?.actorId, TEST_OWNER_ID);
    assert.equal(financialEventSnapshot.data()?.cardId, TEST_CARD_ID);

    const auditLogSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_audit_logs/${recalculateResult.eventId}_audit_card_limit_recalculated`)
      .get();

    assert.equal(auditLogSnapshot.exists, true);
    assert.equal(auditLogSnapshot.data()?.action, "card_limit_recalculated");
    assert.equal(auditLogSnapshot.data()?.actorId, TEST_OWNER_ID);
    assert.equal(auditLogSnapshot.data()?.cardId, TEST_CARD_ID);
    assert.equal(auditLogSnapshot.data()?.reason, "Teste de recálculo a partir do ledger");

    const metrics = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/credit_card_operational_metrics`
    );

    const recalculateMetric = findSuccessMetric(metrics, "card_limit_recalculated");

    assert.equal(recalculateMetric.count, 1);
    assert.equal(recalculateMetric.amountTotal, 100);
    assert.equal(recalculateMetric.lastActorId, TEST_OWNER_ID);
    assert.equal(recalculateMetric.lastCardId, TEST_CARD_ID);
    assert.equal(recalculateMetric.lastCorrelationId, "integration-recalculate-limit");
    assert.equal(recalculateMetric.lastIdempotencyKeyHash, idempotencyKeyDigest("integration-recalculate-limit-001"));

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  }
);