import * as admin from "firebase-admin";

import {
  createCreditCardPurchasePayloadSchema,
  rebuildCardInvoicesForCardPayloadSchema,
} from "./contracts";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "./createPurchase";

import {
  executeRebuildCardInvoicesForCard,
  type RebuildCardInvoicesForCardResult,
} from "./rebuildInvoices";

import {
  getCreditCardBackendWritePlan,
} from "./writeStrategy";

const assertEmulator = (): void => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      "Este teste manual só pode rodar com FIRESTORE_EMULATOR_HOST definido."
    );
  }
};

const initializeAdmin = (): void => {
  const projectId = process.env.GCLOUD_PROJECT || "minhas-financas-local";

  if (admin.apps.length === 0) {
    admin.initializeApp({projectId});
  }
};

const seedTestData = async (): Promise<{
  workspaceId: string;
  uid: string;
  cardId: string;
}> => {
  const db = admin.firestore();
  const suffix = Date.now();
  const workspaceId = `workspace-rebuild-invoices-test-${suffix}`;
  const uid = `user-rebuild-invoices-test-${suffix}`;
  const cardId = `card-rebuild-invoices-test-${suffix}`;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  await workspaceRef.set(
    {
      id: workspaceId,
      name: "Workspace Teste Rebuild de Faturas",
      ownerId: uid,
      createdAt: now,
      updatedAt: now,
    },
    {merge: true}
  );

  await workspaceRef.collection("members").doc(uid).set(
    {
      uid,
      email: "teste-rebuild-faturas@example.com",
      role: "owner",
      createdAt: now,
      updatedAt: now,
    },
    {merge: true}
  );

  await workspaceRef.collection("credit_cards").doc(cardId).set(
    {
      id: cardId,
      workspaceId,
      name: "Cartão Teste Rebuild",
      brand: "Visa",
      status: "active",
      limitTotal: 5000,
      limitUsed: 0,
      limitAvailable: 5000,
      closingDay: 10,
      dueDay: 20,
      bestDay: 11,
      visual: {
        bgType: "color",
        bgColor: "#111827",
        textColor: "white",
        showName: true,
        showBrand: true,
        showLogo: true,
      },
      createdAt: now,
      updatedAt: now,
    },
    {merge: true}
  );

  await workspaceRef.collection("card_limit_snapshots").doc(cardId).set(
    {
      workspaceId,
      cardId,
      limitTotal: 5000,
      limitUsed: 0,
      limitAvailable: 5000,
      updatedAt: now,
    },
    {merge: true}
  );

  return {
    workspaceId,
    uid,
    cardId,
  };
};

const buildAuth = (
  workspaceId: string,
  uid: string
): {
  uid: string;
  workspaceId: string;
  role: "owner";
  email: string;
} => ({
  uid,
  workspaceId,
  role: "owner",
  email: "teste-rebuild-faturas@example.com",
});

const createPurchase = async (
  workspaceId: string,
  uid: string,
  cardId: string
): Promise<CreateCreditCardPurchaseResult> => {
  const payload = createCreditCardPurchasePayloadSchema.parse({
    workspaceId,
    cardId,
    idempotencyKey: `manual-create-before-rebuild-${Date.now()}`,
    correlationId: "manual-test-rebuild-create-purchase",

    description: "Compra para teste de rebuild de faturas",
    categorySnapshot: {
      label: "Teste",
      normalizedLabel: "teste",
    },

    purchaseDate: "2026-04-25",
    totalAmount: 1200,
    installmentsCount: 3,
    amountType: "total",
    source: "manual",
  });

  const context = {
    payload,
    auth: buildAuth(workspaceId, uid),
    plan: getCreditCardBackendWritePlan("createCreditCardPurchase"),
  };

  return await executeCreateCreditCardPurchase(context) as
    CreateCreditCardPurchaseResult;
};

const corruptInvoiceDomain = async (
  workspaceId: string,
  cardId: string,
  purchaseResult: CreateCreditCardPurchaseResult
): Promise<{
  corruptedInvoiceId: string;
  corruptedInstallmentId: string;
}> => {
  const db = admin.firestore();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);
  const corruptedInvoiceId = purchaseResult.invoiceIds[0];
  const corruptedInstallmentId = purchaseResult.installmentIds[0];
  const now = admin.firestore.FieldValue.serverTimestamp();

  await workspaceRef
    .collection("credit_card_invoices")
    .doc(corruptedInvoiceId)
    .set(
      {
        totalAmount: 999,
        paidAmount: 0,
        remainingAmount: 999,
        itemsCount: 99,
        status: "open",
        paymentStatusDerived: "unpaid",
        updatedAt: now,
      },
      {merge: true}
    );

  await workspaceRef
    .collection("invoice_views")
    .doc(corruptedInvoiceId)
    .set(
      {
        totalAmount: 999,
        paidAmount: 0,
        remainingAmount: 999,
        status: "open",
        updatedAt: now,
      },
      {merge: true}
    );

  await workspaceRef
    .collection("credit_card_installments")
    .doc(corruptedInstallmentId)
    .set(
      {
        invoiceId: `${cardId}_BROKEN`,
        status: "projected",
        dueDate: "2099-12-31",
        updatedAt: now,
      },
      {merge: true}
    );

  return {
    corruptedInvoiceId,
    corruptedInstallmentId,
  };
};

const rebuildInvoices = async (
  workspaceId: string,
  uid: string,
  cardId: string,
  idempotencyKey: string
): Promise<RebuildCardInvoicesForCardResult> => {
  const payload = rebuildCardInvoicesForCardPayloadSchema.parse({
    workspaceId,
    cardId,
    idempotencyKey,
    correlationId: "manual-test-rebuild-invoices",
    fromCompetenceMonth: "2026-05",
    toCompetenceMonth: "2026-07",
    reason: "Teste controlado de rebuild de faturas",
  });

  const context = {
    payload,
    auth: buildAuth(workspaceId, uid),
    plan: getCreditCardBackendWritePlan("rebuildCardInvoicesForCard"),
  };

  return await executeRebuildCardInvoicesForCard(context) as
    RebuildCardInvoicesForCardResult;
};

const assertRebuildResult = (
  firstResult: RebuildCardInvoicesForCardResult,
  secondResult: RebuildCardInvoicesForCardResult,
  corruptedInstallmentId: string
): void => {
  if (!firstResult.success) {
    throw new Error("A primeira execução do rebuild não retornou sucesso.");
  }

  if (firstResult.eventId !== secondResult.eventId) {
    throw new Error("A idempotência falhou: eventId diferente no replay.");
  }

  if (firstResult.rebuiltInvoiceIds.length !== 3) {
    throw new Error("O rebuild deveria reconstruir exatamente 3 faturas.");
  }

  if (firstResult.inspectedInstallmentsCount !== 3) {
    throw new Error("O rebuild deveria inspecionar exatamente 3 parcelas.");
  }

  if (!firstResult.updatedInstallmentIds.includes(corruptedInstallmentId)) {
    throw new Error("A parcela corrompida deveria ter sido atualizada.");
  }

  if (firstResult.cancelledInvoiceIds.length !== 0) {
    throw new Error("Nenhuma fatura deveria ser cancelada neste teste.");
  }
};

const inspectCreatedDocuments = async (
  workspaceId: string,
  cardId: string,
  corruptedInvoiceId: string,
  corruptedInstallmentId: string,
  result: RebuildCardInvoicesForCardResult
): Promise<void> => {
  const db = admin.firestore();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);
  const expectedInvoiceId = `${cardId}_2026-05`;

  const [
    invoiceSnap,
    invoiceViewSnap,
    installmentSnap,
    eventSnap,
    invoicesSnap,
  ] = await Promise.all([
    workspaceRef
      .collection("credit_card_invoices")
      .doc(corruptedInvoiceId)
      .get(),
    workspaceRef
      .collection("invoice_views")
      .doc(corruptedInvoiceId)
      .get(),
    workspaceRef
      .collection("credit_card_installments")
      .doc(corruptedInstallmentId)
      .get(),
    workspaceRef
      .collection("financial_events")
      .doc(result.eventId)
      .get(),
    workspaceRef
      .collection("credit_card_invoices")
      .where("cardId", "==", cardId)
      .get(),
  ]);

  if (!invoiceSnap.exists) {
    throw new Error("Documento da fatura reconstruída não foi encontrado.");
  }

  if (!invoiceViewSnap.exists) {
    throw new Error("Projeção da fatura reconstruída não foi encontrada.");
  }

  if (!installmentSnap.exists) {
    throw new Error("Parcela reconstruída não foi encontrada.");
  }

  if (!eventSnap.exists) {
    throw new Error("Evento financeiro do rebuild não foi criado.");
  }

  if (invoicesSnap.size !== 3) {
    throw new Error(`Esperado 3 faturas, encontrado ${invoicesSnap.size}.`);
  }

  const invoiceData = invoiceSnap.data();
  const invoiceViewData = invoiceViewSnap.data();
  const installmentData = installmentSnap.data();
  const eventData = eventSnap.data();

  if (invoiceData?.totalAmount !== 400) {
    throw new Error("A fatura reconstruída deveria ter totalAmount 400.");
  }

  if (invoiceData?.remainingAmount !== 400) {
    throw new Error("A fatura reconstruída deveria ter remainingAmount 400.");
  }

  if (invoiceData?.itemsCount !== 1) {
    throw new Error("A fatura reconstruída deveria ter itemsCount 1.");
  }

  if (invoiceData?.status !== "open") {
    throw new Error("A fatura reconstruída deveria estar open.");
  }

  if (invoiceViewData?.totalAmount !== 400) {
    throw new Error("A projeção reconstruída deveria ter totalAmount 400.");
  }

  if (invoiceViewData?.remainingAmount !== 400) {
    throw new Error("A projeção reconstruída deveria ter remainingAmount 400.");
  }

  if (invoiceViewData?.status !== "open") {
    throw new Error("A projeção reconstruída deveria estar open.");
  }

  if (installmentData?.invoiceId !== expectedInvoiceId) {
    throw new Error("A parcela deveria estar vinculada à fatura correta.");
  }

  if (installmentData?.status !== "invoiced") {
    throw new Error("A parcela deveria voltar ao status invoiced.");
  }

  if (installmentData?.dueDate !== "2026-05-20") {
    throw new Error("A parcela deveria ter vencimento recalculado.");
  }

  if (eventData?.eventType !== "reconciliation_warning") {
    throw new Error("O evento financeiro deveria ser reconciliation_warning.");
  }
};

const run = async (): Promise<void> => {
  assertEmulator();
  initializeAdmin();

  const {workspaceId, uid, cardId} = await seedTestData();
  const purchaseResult = await createPurchase(workspaceId, uid, cardId);

  const {
    corruptedInvoiceId,
    corruptedInstallmentId,
  } = await corruptInvoiceDomain(workspaceId, cardId, purchaseResult);

  const rebuildIdempotencyKey = `manual-rebuild-invoices-${Date.now()}`;

  const firstRebuildResult = await rebuildInvoices(
    workspaceId,
    uid,
    cardId,
    rebuildIdempotencyKey
  );

  const secondRebuildResult = await rebuildInvoices(
    workspaceId,
    uid,
    cardId,
    rebuildIdempotencyKey
  );

  assertRebuildResult(
    firstRebuildResult,
    secondRebuildResult,
    corruptedInstallmentId
  );

  await inspectCreatedDocuments(
    workspaceId,
    cardId,
    corruptedInvoiceId,
    corruptedInstallmentId,
    firstRebuildResult
  );

  console.log("Teste manual rebuildCardInvoicesForCard concluído com sucesso.");
  console.log(JSON.stringify(firstRebuildResult, null, 2));
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Falha no teste manual rebuildCardInvoicesForCard.");
    console.error(error);
    process.exit(1);
  });