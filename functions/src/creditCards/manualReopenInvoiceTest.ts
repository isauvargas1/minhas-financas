import * as admin from "firebase-admin";

import {
  closeCreditCardInvoicePayloadSchema,
  createCreditCardPurchasePayloadSchema,
  reopenCreditCardInvoicePayloadSchema,
} from "./contracts";

import {
  executeCloseCreditCardInvoice,
  type CloseCreditCardInvoiceResult,
} from "./closeInvoice";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "./createPurchase";

import {
  executeReopenCreditCardInvoice,
  type ReopenCreditCardInvoiceResult,
} from "./reopenInvoice";

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
  const workspaceId = `workspace-reopen-invoice-test-${suffix}`;
  const uid = `user-reopen-invoice-test-${suffix}`;
  const cardId = `card-reopen-invoice-test-${suffix}`;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  await workspaceRef.set(
    {
      id: workspaceId,
      name: "Workspace Teste Reabertura de Fatura",
      ownerId: uid,
      createdAt: now,
      updatedAt: now,
    },
    {merge: true}
  );

  await workspaceRef.collection("members").doc(uid).set(
    {
      uid,
      email: "teste-reabertura-fatura@example.com",
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
      name: "Cartão Teste Reabertura",
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
  email: "teste-reabertura-fatura@example.com",
});

const createPurchase = async (
  workspaceId: string,
  uid: string,
  cardId: string
): Promise<CreateCreditCardPurchaseResult> => {
  const payload = createCreditCardPurchasePayloadSchema.parse({
    workspaceId,
    cardId,
    idempotencyKey: `manual-create-before-reopen-${Date.now()}`,
    correlationId: "manual-test-reopen-create-purchase",

    description: "Compra para teste de reabertura de fatura",
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

const closeInvoice = async (
  workspaceId: string,
  uid: string,
  cardId: string,
  invoiceId: string
): Promise<CloseCreditCardInvoiceResult> => {
  const payload = closeCreditCardInvoicePayloadSchema.parse({
    workspaceId,
    cardId,
    invoiceId,
    idempotencyKey: `manual-close-before-reopen-${Date.now()}`,
    correlationId: "manual-test-reopen-close-invoice",
    closedAt: "2026-05-10",
  });

  const context = {
    payload,
    auth: buildAuth(workspaceId, uid),
    plan: getCreditCardBackendWritePlan("closeCreditCardInvoice"),
  };

  return await executeCloseCreditCardInvoice(context) as
    CloseCreditCardInvoiceResult;
};

const reopenInvoice = async (
  workspaceId: string,
  uid: string,
  cardId: string,
  invoiceId: string,
  idempotencyKey: string
): Promise<ReopenCreditCardInvoiceResult> => {
  const payload = reopenCreditCardInvoicePayloadSchema.parse({
    workspaceId,
    cardId,
    invoiceId,
    idempotencyKey,
    correlationId: "manual-test-reopen-invoice",

    reason: "Teste controlado de reabertura de fatura",
    policy: "only_if_unpaid",
  });

  const context = {
    payload,
    auth: buildAuth(workspaceId, uid),
    plan: getCreditCardBackendWritePlan("reopenCreditCardInvoice"),
  };

  return await executeReopenCreditCardInvoice(context) as
    ReopenCreditCardInvoiceResult;
};

const assertReopenResult = (
  firstResult: ReopenCreditCardInvoiceResult,
  secondResult: ReopenCreditCardInvoiceResult
): void => {
  if (!firstResult.success) {
    throw new Error("A primeira execução da reabertura não retornou sucesso.");
  }

  if (firstResult.eventId !== secondResult.eventId) {
    throw new Error("A idempotência falhou: eventId diferente no replay.");
  }

  if (firstResult.invoice.status !== "open") {
    throw new Error("A fatura deveria voltar para open.");
  }

  if (firstResult.invoice.totalAmount !== 400) {
    throw new Error("O total da fatura deveria continuar 400.");
  }

  if (firstResult.invoice.paidAmount !== 0) {
    throw new Error("O valor pago da fatura deveria continuar 0.");
  }

  if (firstResult.invoice.remainingAmount !== 400) {
    throw new Error("O saldo restante da fatura deveria continuar 400.");
  }
};

const inspectCreatedDocuments = async (
  workspaceId: string,
  invoiceId: string,
  result: ReopenCreditCardInvoiceResult
): Promise<void> => {
  const db = admin.firestore();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  const [
    invoiceSnap,
    invoiceViewSnap,
    eventSnap,
    paymentsSnap,
  ] = await Promise.all([
    workspaceRef
      .collection("credit_card_invoices")
      .doc(invoiceId)
      .get(),
    workspaceRef
      .collection("invoice_views")
      .doc(invoiceId)
      .get(),
    workspaceRef
      .collection("financial_events")
      .doc(result.eventId)
      .get(),
    workspaceRef
      .collection("credit_card_invoice_payments")
      .where("invoiceId", "==", invoiceId)
      .get(),
  ]);

  if (!invoiceSnap.exists) {
    throw new Error("Documento da fatura não foi encontrado.");
  }

  if (!invoiceViewSnap.exists) {
    throw new Error("Projeção da fatura não foi encontrada.");
  }

  if (!eventSnap.exists) {
    throw new Error("Evento financeiro da reabertura não foi criado.");
  }

  if (!paymentsSnap.empty) {
    throw new Error("A fatura de teste não deveria possuir pagamentos.");
  }

  const invoiceData = invoiceSnap.data();
  const invoiceViewData = invoiceViewSnap.data();
  const eventData = eventSnap.data();

  if (invoiceData?.status !== "open") {
    throw new Error("A fatura persistida deveria estar open.");
  }

  if (invoiceData?.closedAt !== null) {
    throw new Error("A fatura persistida deveria ter closedAt null.");
  }

  if (invoiceData?.totalAmount !== 400) {
    throw new Error("A fatura persistida deveria ter totalAmount 400.");
  }

  if (invoiceData?.remainingAmount !== 400) {
    throw new Error("A fatura persistida deveria ter remainingAmount 400.");
  }

  if (invoiceViewData?.status !== "open") {
    throw new Error("A projeção da fatura deveria estar open.");
  }

  if (invoiceViewData?.totalAmount !== 400) {
    throw new Error("A projeção da fatura deveria ter totalAmount 400.");
  }

  if (eventData?.eventType !== "invoice_reopened") {
    throw new Error("O evento financeiro deveria ser invoice_reopened.");
  }
};

const run = async (): Promise<void> => {
  assertEmulator();
  initializeAdmin();

  const {workspaceId, uid, cardId} = await seedTestData();
  const purchaseResult = await createPurchase(workspaceId, uid, cardId);
  const invoiceId = purchaseResult.invoiceIds[0];

  await closeInvoice(
    workspaceId,
    uid,
    cardId,
    invoiceId
  );

  const reopenIdempotencyKey = `manual-reopen-invoice-${Date.now()}`;

  const firstReopenResult = await reopenInvoice(
    workspaceId,
    uid,
    cardId,
    invoiceId,
    reopenIdempotencyKey
  );

  const secondReopenResult = await reopenInvoice(
    workspaceId,
    uid,
    cardId,
    invoiceId,
    reopenIdempotencyKey
  );

  assertReopenResult(firstReopenResult, secondReopenResult);

  await inspectCreatedDocuments(
    workspaceId,
    invoiceId,
    firstReopenResult
  );

  console.log("Teste manual reopenCreditCardInvoice concluído com sucesso.");
  console.log(JSON.stringify(firstReopenResult, null, 2));
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Falha no teste manual reopenCreditCardInvoice.");
    console.error(error);
    process.exit(1);
  });