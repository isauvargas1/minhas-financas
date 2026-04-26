import * as admin from "firebase-admin";

import {
  createCreditCardPurchasePayloadSchema,
  registerCreditCardInvoicePaymentPayloadSchema,
  reverseCreditCardInvoicePaymentPayloadSchema,
} from "./contracts";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "./createPurchase";

import {
  executeRegisterCreditCardInvoicePayment,
  type RegisterCreditCardInvoicePaymentResult,
} from "./registerInvoicePayment";

import {
  executeReverseCreditCardInvoicePayment,
  type ReverseCreditCardInvoicePaymentResult,
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
  const workspaceId = `workspace-reverse-payment-test-${suffix}`;
  const uid = `user-reverse-payment-test-${suffix}`;
  const cardId = `card-reverse-payment-test-${suffix}`;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  await workspaceRef.set(
    {
      id: workspaceId,
      name: "Workspace Teste Estorno de Pagamento",
      ownerId: uid,
      createdAt: now,
      updatedAt: now,
    },
    {merge: true}
  );

  await workspaceRef.collection("members").doc(uid).set(
    {
      uid,
      email: "teste-estorno-cartao@example.com",
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
      name: "Cartão Teste Estorno",
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

const createPurchase = async (
  workspaceId: string,
  uid: string,
  cardId: string
): Promise<CreateCreditCardPurchaseResult> => {
  const payload = createCreditCardPurchasePayloadSchema.parse({
    workspaceId,
    cardId,
    idempotencyKey: `manual-create-before-reversal-${Date.now()}`,
    correlationId: "manual-test-reversal-create-purchase",

    description: "Compra para teste de estorno de pagamento",
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
      email: "teste-estorno-cartao@example.com",
    },
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
    idempotencyKey: `manual-payment-before-reversal-${Date.now()}`,
    correlationId: "manual-test-reversal-register-payment",

    paymentDate: "2026-05-20",
    amount: 400,
    paymentMethod: "external",
  });

  const context = {
    payload,
    auth: {
      uid,
      workspaceId,
      role: "owner" as const,
      email: "teste-estorno-cartao@example.com",
    },
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
  paymentId: string,
  idempotencyKey: string
): Promise<ReverseCreditCardInvoicePaymentResult> => {
  const payload = reverseCreditCardInvoicePaymentPayloadSchema.parse({
    workspaceId,
    cardId,
    invoiceId,
    paymentId,
    idempotencyKey,
    correlationId: "manual-test-reverse-invoice-payment",

    reason: "Teste controlado de estorno",
    reversedAt: "2026-05-21",
  });

  const context = {
    payload,
    auth: {
      uid,
      workspaceId,
      role: "owner" as const,
      email: "teste-estorno-cartao@example.com",
    },
    plan: getCreditCardBackendWritePlan(
      "reverseCreditCardInvoicePayment"
    ),
  };

  return await executeReverseCreditCardInvoicePayment(context) as
    ReverseCreditCardInvoicePaymentResult;
};

const assertReverseResult = (
  firstResult: ReverseCreditCardInvoicePaymentResult,
  secondResult: ReverseCreditCardInvoicePaymentResult
): void => {
  if (!firstResult.success) {
    throw new Error("A primeira execução do estorno não retornou sucesso.");
  }

  if (firstResult.paymentId !== secondResult.paymentId) {
    throw new Error("A idempotência falhou: paymentId diferente no replay.");
  }

  if (firstResult.invoice.status !== "open") {
    throw new Error("A fatura deveria voltar para status open.");
  }

  if (firstResult.invoice.paidAmount !== 0) {
    throw new Error("O valor pago da fatura deveria voltar para 0.");
  }

  if (firstResult.invoice.remainingAmount !== 400) {
    throw new Error("O saldo restante da fatura deveria voltar para 400.");
  }

  if (firstResult.limitSnapshot.limitUsed !== 1200) {
    throw new Error("O limite usado deveria voltar para 1200.");
  }

  if (firstResult.limitSnapshot.limitAvailable !== 3800) {
    throw new Error("O limite disponível deveria voltar para 3800.");
  }

  if (!firstResult.cashReversalTransactionId) {
    throw new Error("A transação de reversão de caixa deveria existir.");
  }
};

const inspectCreatedDocuments = async (
  workspaceId: string,
  cardId: string,
  result: ReverseCreditCardInvoicePaymentResult
): Promise<void> => {
  const db = admin.firestore();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  const [
    paymentSnap,
    invoiceSnap,
    ledgerSnap,
    eventSnap,
    limitSnapshotSnap,
    cashReversalTransactionSnap,
  ] = await Promise.all([
    workspaceRef
      .collection("credit_card_invoice_payments")
      .doc(result.paymentId)
      .get(),
    workspaceRef
      .collection("credit_card_invoices")
      .doc(result.invoiceId)
      .get(),
    workspaceRef
      .collection("card_limit_ledger")
      .doc(result.ledgerEntryId)
      .get(),
    workspaceRef
      .collection("financial_events")
      .doc(result.eventId)
      .get(),
    workspaceRef
      .collection("card_limit_snapshots")
      .doc(cardId)
      .get(),
    workspaceRef
      .collection("transactions")
      .doc(result.cashReversalTransactionId || "missing")
      .get(),
  ]);

  if (!paymentSnap.exists) {
    throw new Error("Documento do pagamento não foi encontrado.");
  }

  if (!invoiceSnap.exists) {
    throw new Error("Documento da fatura não foi encontrado.");
  }

  if (!ledgerSnap.exists) {
    throw new Error("Ledger de reversão não foi criado.");
  }

  if (!eventSnap.exists) {
    throw new Error("Evento financeiro do estorno não foi criado.");
  }

  if (!limitSnapshotSnap.exists) {
    throw new Error("Snapshot de limite não foi encontrado.");
  }

  if (!cashReversalTransactionSnap.exists) {
    throw new Error("Transação de reversão de caixa não foi criada.");
  }

  const paymentData = paymentSnap.data();
  const invoiceData = invoiceSnap.data();

  if (paymentData?.status !== "reversed") {
    throw new Error("O pagamento persistido deveria estar reversed.");
  }

  if (invoiceData?.status !== "open") {
    throw new Error("A fatura persistida deveria estar open.");
  }

  if (invoiceData?.paidAmount !== 0) {
    throw new Error("A fatura persistida deveria ter paidAmount 0.");
  }

  if (invoiceData?.remainingAmount !== 400) {
    throw new Error("A fatura persistida deveria ter remainingAmount 400.");
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

  const reversalIdempotencyKey = `manual-reverse-payment-${Date.now()}`;

  const firstReverseResult = await reversePayment(
    workspaceId,
    uid,
    cardId,
    invoiceId,
    paymentResult.paymentId,
    reversalIdempotencyKey
  );

  const secondReverseResult = await reversePayment(
    workspaceId,
    uid,
    cardId,
    invoiceId,
    paymentResult.paymentId,
    reversalIdempotencyKey
  );

  assertReverseResult(firstReverseResult, secondReverseResult);

  await inspectCreatedDocuments(
    workspaceId,
    cardId,
    firstReverseResult
  );

  console.log(
    "Teste manual reverseCreditCardInvoicePayment concluído com sucesso."
  );
  console.log(JSON.stringify(firstReverseResult, null, 2));
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Falha no teste manual reverseCreditCardInvoicePayment.");
    console.error(error);
    process.exit(1);
  });