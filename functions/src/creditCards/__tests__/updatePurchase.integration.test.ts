import assert from "node:assert/strict";
import test from "node:test";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "../createPurchase";

import {
  executeRegisterCreditCardInvoicePayment,
} from "../registerInvoicePayment";

import {
  executeUpdateCreditCardPurchase,
  type UpdateCreditCardPurchaseResult,
} from "../updatePurchase";

import {
  CreditCardApplicationError,
} from "../errors";

import {
  getIntegrationFirestore,
  resetCreditCardIntegrationWorkspace,
  seedCreditCardIntegrationWorkspace,
} from "../testSupport/emulatorFirestore";

const TEST_WORKSPACE_ID = "workspace-credit-card-update-purchase-test";
const TEST_OWNER_ID = "user-credit-card-update-purchase-owner";
const TEST_CARD_ID = "card-credit-card-update-purchase-test";

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

const setupWorkspace = async (): Promise<void> => {
  await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);

  await seedCreditCardIntegrationWorkspace({
    workspaceId: TEST_WORKSPACE_ID,
    ownerId: TEST_OWNER_ID,
    cardId: TEST_CARD_ID,
  });
};

const createPurchase = async (
  idempotencyKey: string,
  totalAmount = 100
): Promise<CreateCreditCardPurchaseResult> =>
  await executeCreateCreditCardPurchase({
    auth: {
      uid: TEST_OWNER_ID,
    },
    payload: {
      workspaceId: TEST_WORKSPACE_ID,
      cardId: TEST_CARD_ID,
      description: "Compra para edição",
      categoryId: "category-update-purchase-test",
      categorySnapshot: {
        id: "category-update-purchase-test",
        label: "Edição",
        normalizedLabel: "edicao",
        icon: "tag",
        color: "#6366f1",
      },
      purchaseDate: "2026-04-05",
      totalAmount,
      installmentsCount: 1,
      amountType: "total",
      source: "manual",
      idempotencyKey,
      correlationId: idempotencyKey,
    },
  } as any) as CreateCreditCardPurchaseResult;

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
  "updateCreditCardPurchase deve editar compra aberta, ajustar fatura, ledger, limite, evento, auditoria e métrica",
  {
    skip: !process.env.FIRESTORE_EMULATOR_HOST,
  },
  async () => {
    const db = getIntegrationFirestore();

    await setupWorkspace();

    const purchaseResult = await createPurchase(
      "integration-update-purchase-create-open-001",
      100
    );

    const updateResult = await executeUpdateCreditCardPurchase({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        purchaseId: purchaseResult.purchaseId,
        description: "Compra editada",
        totalAmount: 150,
        installmentsCount: 1,
        amountType: "total",
        reason: "Teste de edição de compra aberta",
        rebuildInstallments: true,
        idempotencyKey: "integration-update-purchase-open-001",
        correlationId: "integration-update-purchase-open",
      },
    } as any) as UpdateCreditCardPurchaseResult;

    assert.equal(updateResult.success, true);
    assert.equal(updateResult.purchaseId, purchaseResult.purchaseId);
    assert.equal(updateResult.limitSnapshot.limitUsed, 150);
    assert.equal(updateResult.limitSnapshot.limitAvailable, 4850);
    assert.ok(updateResult.ledgerEntryId);

    const purchaseSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_purchases/${purchaseResult.purchaseId}`)
      .get();

    assert.equal(purchaseSnapshot.exists, true);
    assert.equal(purchaseSnapshot.data()?.description, "Compra editada");
    assert.equal(purchaseSnapshot.data()?.totalAmount, 150);
    assert.equal(purchaseSnapshot.data()?.installmentsCount, 1);

    const invoiceId = purchaseResult.invoiceIds[0];
    const invoiceSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${invoiceId}`)
      .get();

    assert.equal(invoiceSnapshot.exists, true);
    assert.equal(invoiceSnapshot.data()?.status, "open");
    assert.equal(invoiceSnapshot.data()?.totalAmount, 150);
    assert.equal(invoiceSnapshot.data()?.paidAmount, 0);
    assert.equal(invoiceSnapshot.data()?.remainingAmount, 150);
    assert.equal(invoiceSnapshot.data()?.itemsCount, 1);

    const limitSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/card_limit_snapshots/${TEST_CARD_ID}`)
      .get();

    assert.equal(limitSnapshot.data()?.limitUsed, 150);
    assert.equal(limitSnapshot.data()?.limitAvailable, 4850);

    const financialEventSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/financial_events/${updateResult.eventId}`)
      .get();

    assert.equal(financialEventSnapshot.exists, true);
    assert.equal(financialEventSnapshot.data()?.eventType, "purchase_updated");
    assert.equal(financialEventSnapshot.data()?.actorId, TEST_OWNER_ID);
    assert.equal(financialEventSnapshot.data()?.cardId, TEST_CARD_ID);

    const auditLogSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_audit_logs/${updateResult.eventId}_audit_purchase_updated`)
      .get();

    assert.equal(auditLogSnapshot.exists, true);
    assert.equal(auditLogSnapshot.data()?.action, "purchase_updated");
    assert.equal(auditLogSnapshot.data()?.actorId, TEST_OWNER_ID);
    assert.equal(auditLogSnapshot.data()?.purchaseId, purchaseResult.purchaseId);
    assert.equal(auditLogSnapshot.data()?.reason, "Teste de edição de compra aberta");

    const metrics = await listCollectionRecords(
      `workspaces/${TEST_WORKSPACE_ID}/credit_card_operational_metrics`
    );

    const updateMetric = findSuccessMetric(metrics, "purchase_updated");

    assert.equal(updateMetric.count, 1);
    assert.equal(updateMetric.amountTotal, 50);
    assert.equal(updateMetric.lastActorId, TEST_OWNER_ID);
    assert.equal(updateMetric.lastCardId, TEST_CARD_ID);
    assert.equal(updateMetric.lastPurchaseId, purchaseResult.purchaseId);
    assert.equal(updateMetric.lastCorrelationId, "integration-update-purchase-open");

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  }
);

test(
  "updateCreditCardPurchase deve bloquear edição quando a fatura afetada já tem pagamento",
  {
    skip: !process.env.FIRESTORE_EMULATOR_HOST,
  },
  async () => {
    const db = getIntegrationFirestore();

    await setupWorkspace();

    const purchaseResult = await createPurchase(
      "integration-update-purchase-create-paid-001",
      100
    );

    const invoiceId = purchaseResult.invoiceIds[0];

    await executeRegisterCreditCardInvoicePayment({
      auth: {
        uid: TEST_OWNER_ID,
      },
      payload: {
        workspaceId: TEST_WORKSPACE_ID,
        cardId: TEST_CARD_ID,
        invoiceId,
        paymentDate: "2026-04-20",
        amount: 100,
        paymentMethod: "external",
        idempotencyKey: "integration-update-purchase-payment-001",
        correlationId: "integration-update-purchase-payment",
      },
    } as any);

    await expectDomainPreconditionFailure(() =>
      executeUpdateCreditCardPurchase({
        auth: {
          uid: TEST_OWNER_ID,
        },
        payload: {
          workspaceId: TEST_WORKSPACE_ID,
          cardId: TEST_CARD_ID,
          purchaseId: purchaseResult.purchaseId,
          description: "Compra paga editada indevidamente",
          totalAmount: 150,
          installmentsCount: 1,
          amountType: "total",
          reason: "Tentativa de edição com fatura paga",
          rebuildInstallments: true,
          idempotencyKey: "integration-update-purchase-paid-blocked-001",
          correlationId: "integration-update-purchase-paid-blocked",
        },
      } as any)
    );

    const purchaseSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_purchases/${purchaseResult.purchaseId}`)
      .get();

    assert.equal(purchaseSnapshot.data()?.description, "Compra para edição");
    assert.equal(purchaseSnapshot.data()?.totalAmount, 100);

    const invoiceSnapshot = await db
      .doc(`workspaces/${TEST_WORKSPACE_ID}/credit_card_invoices/${invoiceId}`)
      .get();

    assert.equal(invoiceSnapshot.data()?.status, "paid");
    assert.equal(invoiceSnapshot.data()?.paidAmount, 100);
    assert.equal(invoiceSnapshot.data()?.remainingAmount, 0);

    await resetCreditCardIntegrationWorkspace(TEST_WORKSPACE_ID);
  }
);