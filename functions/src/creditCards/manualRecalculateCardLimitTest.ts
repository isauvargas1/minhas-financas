import * as admin from "firebase-admin";

import {
  createCreditCardPurchasePayloadSchema,
  recalculateCardLimitPayloadSchema,
  registerCreditCardInvoicePaymentPayloadSchema,
  reverseCreditCardInvoicePaymentPayloadSchema,
} from "./contracts";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "./createPurchase";

import {
  executeRecalculateCardLimit,
  type RecalculateCardLimitResult,
} from "./recalculateCardLimit";

import {
  executeRegisterCreditCardInvoicePayment,
  type RegisterCreditCardInvoicePaymentResult,
} from "./registerInvoicePayment";

import {
  executeReverseCreditCardInvoicePayment,
} from "./reverseInvoicePayment";

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
  const workspaceId = `workspace-recalculate-limit-test-${suffix}`;
  const uid = `user-recalculate-limit-test-${suffix}`;
  const cardId = `card-recalculate-limit-test-${suffix}`;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  await workspaceRef.set(
    {
      id: workspaceId,
      name: "Workspace Teste Recálculo de Limite",
      ownerId: uid,
      createdAt: now,
      updatedAt: now,
    },
    {merge: true}
  );

  await workspaceRef.collection("members").doc(uid).set(
    {
      uid,
      email: "teste-recalculo-limite@example.com",
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
      name: "Cartão Teste Recálculo",
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
  email: "teste-recalculo-limite@example.com",
});

const createPurchase = async (
  workspaceId: string,
  uid: string,
  cardId: string
): Promise<CreateCreditCardPurchaseResult> => {
  const payload = createCreditCardPurchasePayloadSchema.parse({
    workspaceId,
    cardId,
    idempotencyKey: `manual-create-before-recalculate-${Date.now()}`,
    correlationId: "manual-test-recalculate-create-purchase",

    description: "Compra para teste de recálculo de limite",
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

const registerPayment = async (
  workspaceId: string,
  uid: string,
  cardId: string,
  invoiceId: string
): Promise<RegisterCreditCardInvoicePaymentResult> => {
  const payload = registerCreditCardInvoicePaymentPayloadSchema.parse({
    workspaceId,
    cardId,
    invoiceId,
    idempotencyKey: `manual-payment-before-recalculate-${Date.now()}`,
    correlationId: "manual-test-recalculate-register-payment",

    paymentDate: "2026-05-20",
    amount: 400,
    paymentMethod: "external",
  });

  const context = {
    payload,
    auth: buildAuth(workspaceId, uid),
    plan: getCreditCardBackendWritePlan(
      "registerCreditCardInvoicePayment"
    ),
  };

  return await executeRegisterCreditCardInvoicePayment(context) as
    RegisterCreditCardInvoicePaymentResult;
};

const reversePayment = async (
  workspaceId: string,
  uid: string,
  cardId: string,
  invoiceId: string,
  paymentId: string
): Promise<void> => {
  const payload = reverseCreditCardInvoicePaymentPayloadSchema.parse({
    workspaceId,
    cardId,
    invoiceId,
    paymentId,
    idempotencyKey: `manual-reverse-before-recalculate-${Date.now()}`,
    correlationId: "manual-test-recalculate-reverse-payment",

    reason: "Teste controlado antes do recálculo de limite",
    reversedAt: "2026-05-21",
  });

  const context = {
    payload,
    auth: buildAuth(workspaceId, uid),
    plan: getCreditCardBackendWritePlan(
      "reverseCreditCardInvoicePayment"
    ),
  };

  await executeReverseCreditCardInvoicePayment(context);
};

const corruptLimitSnapshot = async (
  workspaceId: string,
  cardId: string
): Promise<void> => {
  const db = admin.firestore();

  await db
    .doc(`workspaces/${workspaceId}`)
    .collection("card_limit_snapshots")
    .doc(cardId)
    .set(
      {
        workspaceId,
        cardId,
        limitTotal: 5000,
        limitUsed: 999,
        limitAvailable: 4001,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true}
    );
};

const recalculateLimit = async (
  workspaceId: string,
  uid: string,
  cardId: string,
  idempotencyKey: string
): Promise<RecalculateCardLimitResult> => {
  const payload = recalculateCardLimitPayloadSchema.parse({
    workspaceId,
    cardId,
    idempotencyKey,
    correlationId: "manual-test-recalculate-card-limit",
    reason: "Teste controlado de reconstrução do snapshot pelo ledger",
  });

  const context = {
    payload,
    auth: buildAuth(workspaceId, uid),
    plan: getCreditCardBackendWritePlan("recalculateCardLimit"),
  };

  return await executeRecalculateCardLimit(context) as
    RecalculateCardLimitResult;
};

const assertRecalculateResult = (
  firstResult: RecalculateCardLimitResult,
  secondResult: RecalculateCardLimitResult
): void => {
  if (!firstResult.success) {
    throw new Error("A primeira execução do recálculo não retornou sucesso.");
  }

  if (firstResult.eventId !== secondResult.eventId) {
    throw new Error("A idempotência falhou: eventId diferente no replay.");
  }

  if (firstResult.ledgerEntriesCount !== 3) {
    throw new Error("O recálculo deveria considerar 3 lançamentos de ledger.");
  }

  if (firstResult.limitSnapshot.limitTotal !== 5000) {
    throw new Error("O limite total deveria ser 5000.");
  }

  if (firstResult.limitSnapshot.limitUsed !== 1200) {
    throw new Error("O limite usado recalculado deveria ser 1200.");
  }

  if (firstResult.limitSnapshot.limitAvailable !== 3800) {
    throw new Error("O limite disponível recalculado deveria ser 3800.");
  }
};

const inspectCreatedDocuments = async (
  workspaceId: string,
  cardId: string,
  result: RecalculateCardLimitResult
): Promise<void> => {
  const db = admin.firestore();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  const [
    limitSnapshotSnap,
    eventSnap,
    ledgerSnap,
  ] = await Promise.all([
    workspaceRef
      .collection("card_limit_snapshots")
      .doc(cardId)
      .get(),
    workspaceRef
      .collection("financial_events")
      .doc(result.eventId)
      .get(),
    workspaceRef
      .collection("card_limit_ledger")
      .where("cardId", "==", cardId)
      .get(),
  ]);

  if (!limitSnapshotSnap.exists) {
    throw new Error("Snapshot de limite não foi encontrado.");
  }

  if (!eventSnap.exists) {
    throw new Error("Evento financeiro de recálculo não foi criado.");
  }

  if (ledgerSnap.size !== 3) {
    throw new Error(`Esperado 3 lançamentos no ledger, achado ${ledgerSnap.size}.`);
  }

  const limitSnapshotData = limitSnapshotSnap.data();

  if (limitSnapshotData?.limitUsed !== 1200) {
    throw new Error("Snapshot recalculado deveria ter limitUsed 1200.");
  }

  if (limitSnapshotData?.limitAvailable !== 3800) {
    throw new Error("Snapshot recalculado deveria ter limitAvailable 3800.");
  }
};

const run = async (): Promise<void> => {
  assertEmulator();
  initializeAdmin();

  const {workspaceId, uid, cardId} = await seedTestData();
  const purchaseResult = await createPurchase(workspaceId, uid, cardId);
  const invoiceId = purchaseResult.invoiceIds[0];
  const paymentResult = await registerPayment(
    workspaceId,
    uid,
    cardId,
    invoiceId
  );

  await reversePayment(
    workspaceId,
    uid,
    cardId,
    invoiceId,
    paymentResult.paymentId
  );

  await corruptLimitSnapshot(workspaceId, cardId);

  const recalculateIdempotencyKey = `manual-recalculate-limit-${Date.now()}`;

  const firstRecalculateResult = await recalculateLimit(
    workspaceId,
    uid,
    cardId,
    recalculateIdempotencyKey
  );

  const secondRecalculateResult = await recalculateLimit(
    workspaceId,
    uid,
    cardId,
    recalculateIdempotencyKey
  );

  assertRecalculateResult(
    firstRecalculateResult,
    secondRecalculateResult
  );

  await inspectCreatedDocuments(
    workspaceId,
    cardId,
    firstRecalculateResult
  );

  console.log("Teste manual recalculateCardLimit concluído com sucesso.");
  console.log(JSON.stringify(firstRecalculateResult, null, 2));
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Falha no teste manual recalculateCardLimit.");
    console.error(error);
    process.exit(1);
  });