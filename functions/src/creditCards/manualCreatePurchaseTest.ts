import * as admin from "firebase-admin";

import {
  createCreditCardPurchasePayloadSchema,
} from "./contracts";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "./createPurchase";

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
  const workspaceId = "workspace-credit-card-test";
  const uid = "user-credit-card-test";
  const cardId = "card-credit-card-test";
  const now = admin.firestore.FieldValue.serverTimestamp();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  await workspaceRef.set(
    {
      id: workspaceId,
      name: "Workspace Teste Cartão",
      ownerId: uid,
      createdAt: now,
      updatedAt: now,
    },
    {merge: true}
  );

  await workspaceRef.collection("members").doc(uid).set(
    {
      uid,
      email: "teste-cartao@example.com",
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
      name: "Cartão Teste",
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

const assertResult = (
  firstResult: CreateCreditCardPurchaseResult,
  secondResult: CreateCreditCardPurchaseResult
): void => {
  if (!firstResult.success) {
    throw new Error("A primeira execução não retornou sucesso.");
  }

  if (firstResult.purchaseId !== secondResult.purchaseId) {
    throw new Error("A idempotência falhou: purchaseId diferente no replay.");
  }

  if (firstResult.installmentIds.length !== 3) {
    throw new Error("A compra deveria gerar exatamente 3 parcelas.");
  }

  if (firstResult.invoiceIds.length !== 3) {
    throw new Error("A compra deveria gerar exatamente 3 faturas.");
  }

  if (firstResult.limitSnapshot.limitUsed !== 1200) {
    throw new Error("O limite usado deveria ser 1200.");
  }

  if (firstResult.limitSnapshot.limitAvailable !== 3800) {
    throw new Error("O limite disponível deveria ser 3800.");
  }
};

const inspectCreatedDocuments = async (
  workspaceId: string,
  cardId: string,
  result: CreateCreditCardPurchaseResult
): Promise<void> => {
  const db = admin.firestore();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  const [
    purchaseSnap,
    ledgerSnap,
    eventSnap,
    limitSnapshotSnap,
    installmentsSnap,
    invoicesSnap,
    invoiceViewsSnap,
  ] = await Promise.all([
    workspaceRef.collection("credit_card_purchases").doc(result.purchaseId).get(),
    workspaceRef.collection("card_limit_ledger").doc(result.ledgerEntryId).get(),
    workspaceRef.collection("financial_events").doc(result.eventId).get(),
    workspaceRef.collection("card_limit_snapshots").doc(cardId).get(),
    workspaceRef
      .collection("credit_card_installments")
      .where("purchaseId", "==", result.purchaseId)
      .get(),
    workspaceRef
      .collection("credit_card_invoices")
      .where("cardId", "==", cardId)
      .get(),
    workspaceRef
      .collection("invoice_views")
      .where("cardId", "==", cardId)
      .get(),
  ]);

  if (!purchaseSnap.exists) {
    throw new Error("Documento da compra não foi criado.");
  }

  if (!ledgerSnap.exists) {
    throw new Error("Documento do ledger não foi criado.");
  }

  if (!eventSnap.exists) {
    throw new Error("Documento do evento financeiro não foi criado.");
  }

  if (!limitSnapshotSnap.exists) {
    throw new Error("Snapshot de limite não foi criado.");
  }

  if (installmentsSnap.size !== 3) {
    throw new Error(`Esperado 3 parcelas, encontrado ${installmentsSnap.size}.`);
  }

  if (invoicesSnap.size !== 3) {
    throw new Error(`Esperado 3 faturas, encontrado ${invoicesSnap.size}.`);
  }

  if (invoiceViewsSnap.size !== 3) {
    throw new Error(
      `Esperado 3 projeções de fatura, encontrado ${invoiceViewsSnap.size}.`
    );
  }
};

const run = async (): Promise<void> => {
  assertEmulator();
  initializeAdmin();

  const {workspaceId, uid, cardId} = await seedTestData();
  const idempotencyKey = `manual-create-purchase-${Date.now()}`;

  const payload = createCreditCardPurchasePayloadSchema.parse({
    workspaceId,
    cardId,
    idempotencyKey,
    correlationId: "manual-test-create-purchase",

    description: "Compra controlada Fase 3.3",
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
    auth: {
      uid,
      workspaceId,
      role: "owner" as const,
      email: "teste-cartao@example.com",
    },
    plan: getCreditCardBackendWritePlan("createCreditCardPurchase"),
  };

  const firstResult = await executeCreateCreditCardPurchase(context) as
    CreateCreditCardPurchaseResult;

  const secondResult = await executeCreateCreditCardPurchase(context) as
    CreateCreditCardPurchaseResult;

  assertResult(firstResult, secondResult);
  await inspectCreatedDocuments(workspaceId, cardId, firstResult);

  console.log("Teste manual createCreditCardPurchase concluído com sucesso.");
  console.log(JSON.stringify(firstResult, null, 2));
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Falha no teste manual createCreditCardPurchase.");
    console.error(error);
    process.exit(1);
  });