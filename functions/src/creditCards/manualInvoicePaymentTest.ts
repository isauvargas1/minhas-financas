import * as admin from "firebase-admin";

import {
  createCreditCardPurchasePayloadSchema,
  registerCreditCardInvoicePaymentPayloadSchema,
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
  const workspaceId = `workspace-invoice-payment-test-${suffix}`;
  const uid = `user-invoice-payment-test-${suffix}`;
  const cardId = `card-invoice-payment-test-${suffix}`;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  await workspaceRef.set(
    {
      id: workspaceId,
      name: "Workspace Teste Pagamento de Fatura",
      ownerId: uid,
      createdAt: now,
      updatedAt: now,
    },
    {merge: true}
  );

  await workspaceRef.collection("members").doc(uid).set(
    {
      uid,
      email: "teste-pagamento-cartao@example.com",
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
      name: "Cartão Teste Pagamento",
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
    idempotencyKey: `manual-create-before-payment-${Date.now()}`,
    correlationId: "manual-test-payment-create-purchase",

    description: "Compra para teste de pagamento de fatura",
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
      email: "teste-pagamento-cartao@example.com",
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
  invoiceId: string,
  idempotencyKey: string
): Promise<RegisterCreditCardInvoicePaymentResult> => {
  const payload = registerCreditCardInvoicePaymentPayloadSchema.parse({
    workspaceId,
    cardId,
    invoiceId,
    idempotencyKey,
    correlationId: "manual-test-register-invoice-payment",

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
      email: "teste-pagamento-cartao@example.com",
    },
    plan: getCreditCardBackendWritePlan(
      "registerCreditCardInvoicePayment"
    ),
  };

  return await executeRegisterCreditCardInvoicePayment(context) as
    RegisterCreditCardInvoicePaymentResult;
};

const assertPaymentResult = (
  firstResult: RegisterCreditCardInvoicePaymentResult,
  secondResult: RegisterCreditCardInvoicePaymentResult
): void => {
  if (!firstResult.success) {
    throw new Error("A primeira execução do pagamento não retornou sucesso.");
  }

  if (firstResult.paymentId !== secondResult.paymentId) {
    throw new Error("A idempotência falhou: paymentId diferente no replay.");
  }

  if (firstResult.invoice.status !== "paid") {
    throw new Error("A fatura deveria estar paga após o pagamento integral.");
  }

  if (firstResult.invoice.paidAmount !== 400) {
    throw new Error("O valor pago da fatura deveria ser 400.");
  }

  if (firstResult.invoice.remainingAmount !== 0) {
    throw new Error("O saldo restante da fatura deveria ser 0.");
  }

  if (firstResult.limitSnapshot.limitUsed !== 800) {
    throw new Error("O limite usado deveria ser 800 após o pagamento.");
  }

  if (firstResult.limitSnapshot.limitAvailable !== 4200) {
    throw new Error("O limite disponível deveria ser 4200 após o pagamento.");
  }

  if (!firstResult.cashTransactionId) {
    throw new Error("A transação de saída de caixa deveria ter sido criada.");
  }
};

const inspectCreatedDocuments = async (
  workspaceId: string,
  cardId: string,
  result: RegisterCreditCardInvoicePaymentResult
): Promise<void> => {
  const db = admin.firestore();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  const [
    paymentSnap,
    invoiceSnap,
    ledgerSnap,
    eventSnap,
    limitSnapshotSnap,
    cashTransactionSnap,
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
      .doc(result.cashTransactionId || "missing")
      .get(),
  ]);

  if (!paymentSnap.exists) {
    throw new Error("Documento do pagamento não foi criado.");
  }

  if (!invoiceSnap.exists) {
    throw new Error("Documento da fatura não foi encontrado.");
  }

  if (!ledgerSnap.exists) {
    throw new Error("Ledger de restauração de limite não foi criado.");
  }

  if (!eventSnap.exists) {
    throw new Error("Evento financeiro do pagamento não foi criado.");
  }

  if (!limitSnapshotSnap.exists) {
    throw new Error("Snapshot de limite não foi encontrado.");
  }

  if (!cashTransactionSnap.exists) {
    throw new Error("Transação de saída de caixa não foi criada.");
  }

  const invoiceData = invoiceSnap.data();

  if (invoiceData?.status !== "paid") {
    throw new Error("A fatura persistida deveria estar com status paid.");
  }

  if (invoiceData?.remainingAmount !== 0) {
    throw new Error("A fatura persistida deveria ter saldo restante zero.");
  }
};

const run = async (): Promise<void> => {
  assertEmulator();
  initializeAdmin();

  const {workspaceId, uid, cardId} = await seedTestData();
  const purchaseResult = await createPurchase(workspaceId, uid, cardId);
  const invoiceId = purchaseResult.invoiceIds[0];
  const paymentIdempotencyKey = `manual-invoice-payment-${Date.now()}`;

  const firstPaymentResult = await registerPayment(
    workspaceId,
    uid,
    cardId,
    invoiceId,
    paymentIdempotencyKey
  );

  const secondPaymentResult = await registerPayment(
    workspaceId,
    uid,
    cardId,
    invoiceId,
    paymentIdempotencyKey
  );

  assertPaymentResult(firstPaymentResult, secondPaymentResult);

  await inspectCreatedDocuments(
    workspaceId,
    cardId,
    firstPaymentResult
  );

  console.log(
    "Teste manual registerCreditCardInvoicePayment concluído com sucesso."
  );
  console.log(JSON.stringify(firstPaymentResult, null, 2));
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Falha no teste manual registerCreditCardInvoicePayment.");
    console.error(error);
    process.exit(1);
  });