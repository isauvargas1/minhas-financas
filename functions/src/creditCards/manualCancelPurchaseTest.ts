import * as admin from "firebase-admin";

import {
  cancelCreditCardPurchasePayloadSchema,
  createCreditCardPurchasePayloadSchema,
} from "./contracts";

import {
  executeCancelCreditCardPurchase,
  type CancelCreditCardPurchaseResult,
} from "./cancelPurchase";

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
  const suffix = Date.now();
  const workspaceId = `workspace-cancel-purchase-test-${suffix}`;
  const uid = `user-cancel-purchase-test-${suffix}`;
  const cardId = `card-cancel-purchase-test-${suffix}`;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  await workspaceRef.set(
    {
      id: workspaceId,
      name: "Workspace Teste Cancelamento de Compra",
      ownerId: uid,
      createdAt: now,
      updatedAt: now,
    },
    {merge: true}
  );

  await workspaceRef.collection("members").doc(uid).set(
    {
      uid,
      email: "teste-cancelamento-compra@example.com",
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
      name: "Cartão Teste Cancelamento",
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
    idempotencyKey: `manual-create-before-cancel-${Date.now()}`,
    correlationId: "manual-test-cancel-create-purchase",

    description: "Compra para teste de cancelamento",
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
      email: "teste-cancelamento-compra@example.com",
    },
    plan: getCreditCardBackendWritePlan("createCreditCardPurchase"),
  };

  return await executeCreateCreditCardPurchase(context) as
    CreateCreditCardPurchaseResult;
};

const cancelPurchase = async (
  workspaceId: string,
  uid: string,
  cardId: string,
  purchaseId: string,
  idempotencyKey: string
): Promise<CancelCreditCardPurchaseResult> => {
  const payload = cancelCreditCardPurchasePayloadSchema.parse({
    workspaceId,
    cardId,
    purchaseId,
    idempotencyKey,
    correlationId: "manual-test-cancel-purchase",

    reason: "Teste controlado de cancelamento de compra",
    policy: "block_if_invoice_paid",
  });

  const context = {
    payload,
    auth: {
      uid,
      workspaceId,
      role: "owner" as const,
      email: "teste-cancelamento-compra@example.com",
    },
    plan: getCreditCardBackendWritePlan("cancelCreditCardPurchase"),
  };

  return await executeCancelCreditCardPurchase(context) as
    CancelCreditCardPurchaseResult;
};

const assertCancelResult = (
  firstResult: CancelCreditCardPurchaseResult,
  secondResult: CancelCreditCardPurchaseResult
): void => {
  if (!firstResult.success) {
    throw new Error("A primeira execução do cancelamento não retornou sucesso.");
  }

  if (firstResult.purchaseId !== secondResult.purchaseId) {
    throw new Error("A idempotência falhou: purchaseId diferente no replay.");
  }

  if (firstResult.cancelledInstallmentIds.length !== 3) {
    throw new Error("O cancelamento deveria afetar exatamente 3 parcelas.");
  }

  if (firstResult.affectedInvoiceIds.length !== 3) {
    throw new Error("O cancelamento deveria afetar exatamente 3 faturas.");
  }

  if (firstResult.limitSnapshot.limitUsed !== 0) {
    throw new Error("O limite usado deveria voltar para 0.");
  }

  if (firstResult.limitSnapshot.limitAvailable !== 5000) {
    throw new Error("O limite disponível deveria voltar para 5000.");
  }
};

const inspectCreatedDocuments = async (
  workspaceId: string,
  cardId: string,
  result: CancelCreditCardPurchaseResult
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
  ] = await Promise.all([
    workspaceRef
      .collection("credit_card_purchases")
      .doc(result.purchaseId)
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
      .collection("credit_card_installments")
      .where("purchaseId", "==", result.purchaseId)
      .get(),
    workspaceRef
      .collection("credit_card_invoices")
      .where("cardId", "==", cardId)
      .get(),
  ]);

  if (!purchaseSnap.exists) {
    throw new Error("Documento da compra não foi encontrado.");
  }

  if (!ledgerSnap.exists) {
    throw new Error("Ledger de restauração de limite não foi criado.");
  }

  if (!eventSnap.exists) {
    throw new Error("Evento financeiro do cancelamento não foi criado.");
  }

  if (!limitSnapshotSnap.exists) {
    throw new Error("Snapshot de limite não foi encontrado.");
  }

  if (installmentsSnap.size !== 3) {
    throw new Error(
      `Esperado 3 parcelas, encontrado ${installmentsSnap.size}.`
    );
  }

  if (invoicesSnap.size !== 3) {
    throw new Error(`Esperado 3 faturas, encontrado ${invoicesSnap.size}.`);
  }

  const purchaseData = purchaseSnap.data();
  const limitSnapshotData = limitSnapshotSnap.data();

  if (purchaseData?.status !== "cancelled") {
    throw new Error("A compra persistida deveria estar cancelled.");
  }

  if (limitSnapshotData?.limitUsed !== 0) {
    throw new Error("O snapshot deveria ter limitUsed igual a 0.");
  }

  if (limitSnapshotData?.limitAvailable !== 5000) {
    throw new Error("O snapshot deveria ter limitAvailable igual a 5000.");
  }

  installmentsSnap.docs.forEach((installmentDoc) => {
    const installment = installmentDoc.data();

    if (installment.status !== "cancelled") {
      throw new Error(
        `Parcela ${installmentDoc.id} deveria estar cancelled.`
      );
    }

    if (installment.paidAmount !== 0) {
      throw new Error(
        `Parcela ${installmentDoc.id} deveria ter paidAmount 0.`
      );
    }
  });

  invoicesSnap.docs.forEach((invoiceDoc) => {
    const invoice = invoiceDoc.data();

    if (invoice.status !== "cancelled") {
      throw new Error(`Fatura ${invoiceDoc.id} deveria estar cancelled.`);
    }

    if (invoice.totalAmount !== 0) {
      throw new Error(`Fatura ${invoiceDoc.id} deveria ter totalAmount 0.`);
    }

    if (invoice.remainingAmount !== 0) {
      throw new Error(
        `Fatura ${invoiceDoc.id} deveria ter remainingAmount 0.`
      );
    }

    if (invoice.itemsCount !== 0) {
      throw new Error(`Fatura ${invoiceDoc.id} deveria ter itemsCount 0.`);
    }
  });
};

const run = async (): Promise<void> => {
  assertEmulator();
  initializeAdmin();

  const {workspaceId, uid, cardId} = await seedTestData();
  const purchaseResult = await createPurchase(workspaceId, uid, cardId);
  const cancelIdempotencyKey = `manual-cancel-purchase-${Date.now()}`;

  const firstCancelResult = await cancelPurchase(
    workspaceId,
    uid,
    cardId,
    purchaseResult.purchaseId,
    cancelIdempotencyKey
  );

  const secondCancelResult = await cancelPurchase(
    workspaceId,
    uid,
    cardId,
    purchaseResult.purchaseId,
    cancelIdempotencyKey
  );

  assertCancelResult(firstCancelResult, secondCancelResult);

  await inspectCreatedDocuments(
    workspaceId,
    cardId,
    firstCancelResult
  );

  console.log(
    "Teste manual cancelCreditCardPurchase concluído com sucesso."
  );
  console.log(JSON.stringify(firstCancelResult, null, 2));
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Falha no teste manual cancelCreditCardPurchase.");
    console.error(error);
    process.exit(1);
  });