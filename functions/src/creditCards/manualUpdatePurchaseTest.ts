import * as admin from "firebase-admin";

import {
  createCreditCardPurchasePayloadSchema,
  updateCreditCardPurchasePayloadSchema,
} from "./contracts";

import {
  executeCreateCreditCardPurchase,
  type CreateCreditCardPurchaseResult,
} from "./createPurchase";

import {
  executeUpdateCreditCardPurchase,
  type UpdateCreditCardPurchaseResult,
} from "./updatePurchase";

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
  const workspaceId = `workspace-update-purchase-test-${suffix}`;
  const uid = `user-update-purchase-test-${suffix}`;
  const cardId = `card-update-purchase-test-${suffix}`;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  await workspaceRef.set(
    {
      id: workspaceId,
      name: "Workspace Teste Edição de Compra",
      ownerId: uid,
      createdAt: now,
      updatedAt: now,
    },
    {merge: true}
  );

  await workspaceRef.collection("members").doc(uid).set(
    {
      uid,
      email: "teste-edicao-compra@example.com",
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
      name: "Cartão Teste Edição",
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
  email: "teste-edicao-compra@example.com",
});

const createPurchase = async (
  workspaceId: string,
  uid: string,
  cardId: string
): Promise<CreateCreditCardPurchaseResult> => {
  const payload = createCreditCardPurchasePayloadSchema.parse({
    workspaceId,
    cardId,
    idempotencyKey: `manual-create-before-update-${Date.now()}`,
    correlationId: "manual-test-update-create-purchase",

    description: "Compra original para teste de edição",
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

const updatePurchase = async (
  workspaceId: string,
  uid: string,
  cardId: string,
  purchaseId: string,
  idempotencyKey: string
): Promise<UpdateCreditCardPurchaseResult> => {
  const payload = updateCreditCardPurchasePayloadSchema.parse({
    workspaceId,
    cardId,
    purchaseId,
    idempotencyKey,
    correlationId: "manual-test-update-purchase",

    description: "Compra editada para teste controlado",
    purchaseDate: "2026-04-25",
    totalAmount: 1500,
    installmentsCount: 5,
    amountType: "total",
    reason: "Teste controlado de edição de compra",
    rebuildInstallments: true,
  });

  const context = {
    payload,
    auth: buildAuth(workspaceId, uid),
    plan: getCreditCardBackendWritePlan("updateCreditCardPurchase"),
  };

  return await executeUpdateCreditCardPurchase(context) as
    UpdateCreditCardPurchaseResult;
};

const assertUpdateResult = (
  firstResult: UpdateCreditCardPurchaseResult,
  secondResult: UpdateCreditCardPurchaseResult
): void => {
  if (!firstResult.success) {
    throw new Error("A primeira execução da edição não retornou sucesso.");
  }

  if (firstResult.eventId !== secondResult.eventId) {
    throw new Error("A idempotência falhou: eventId diferente no replay.");
  }

  if (firstResult.updatedInstallmentIds.length !== 5) {
    throw new Error("A edição deveria gerar/atualizar exatamente 5 parcelas.");
  }

  if (firstResult.cancelledInstallmentIds.length !== 0) {
    throw new Error("Nenhuma parcela deveria ser cancelada neste teste.");
  }

  if (firstResult.affectedInvoiceIds.length !== 5) {
    throw new Error("A edição deveria afetar exatamente 5 faturas.");
  }

  if (!firstResult.ledgerEntryId) {
    throw new Error("A edição com aumento de valor deveria gerar ledger.");
  }

  if (firstResult.limitSnapshot.limitUsed !== 1500) {
    throw new Error("O limite usado deveria ser 1500 após a edição.");
  }

  if (firstResult.limitSnapshot.limitAvailable !== 3500) {
    throw new Error("O limite disponível deveria ser 3500 após a edição.");
  }
};

const inspectCreatedDocuments = async (
  workspaceId: string,
  cardId: string,
  purchaseId: string,
  result: UpdateCreditCardPurchaseResult
): Promise<void> => {
  const db = admin.firestore();
  const workspaceRef = db.doc(`workspaces/${workspaceId}`);

  const [
    purchaseSnap,
    installmentsSnap,
    invoicesSnap,
    invoiceViewsSnap,
    ledgerSnap,
    eventSnap,
    limitSnapshotSnap,
  ] = await Promise.all([
    workspaceRef
      .collection("credit_card_purchases")
      .doc(purchaseId)
      .get(),
    workspaceRef
      .collection("credit_card_installments")
      .where("purchaseId", "==", purchaseId)
      .get(),
    workspaceRef
      .collection("credit_card_invoices")
      .where("cardId", "==", cardId)
      .get(),
    workspaceRef
      .collection("invoice_views")
      .where("cardId", "==", cardId)
      .get(),
    workspaceRef
      .collection("card_limit_ledger")
      .doc(result.ledgerEntryId || "missing")
      .get(),
    workspaceRef
      .collection("financial_events")
      .doc(result.eventId)
      .get(),
    workspaceRef
      .collection("card_limit_snapshots")
      .doc(cardId)
      .get(),
  ]);

  if (!purchaseSnap.exists) {
    throw new Error("Documento da compra não foi encontrado.");
  }

  if (installmentsSnap.size !== 5) {
    throw new Error(
      `Esperado 5 parcelas, encontrado ${installmentsSnap.size}.`
    );
  }

  if (invoicesSnap.size !== 5) {
    throw new Error(`Esperado 5 faturas, encontrado ${invoicesSnap.size}.`);
  }

  if (invoiceViewsSnap.size !== 5) {
    throw new Error(
      `Esperado 5 projeções de fatura, encontrado ${invoiceViewsSnap.size}.`
    );
  }

  if (!ledgerSnap.exists) {
    throw new Error("Ledger de ajuste de limite não foi criado.");
  }

  if (!eventSnap.exists) {
    throw new Error("Evento financeiro da edição não foi criado.");
  }

  if (!limitSnapshotSnap.exists) {
    throw new Error("Snapshot de limite não foi encontrado.");
  }

  const purchaseData = purchaseSnap.data();
  const ledgerData = ledgerSnap.data();
  const eventData = eventSnap.data();
  const limitSnapshotData = limitSnapshotSnap.data();

  if (purchaseData?.description !== "Compra editada para teste controlado") {
    throw new Error("Descrição da compra não foi atualizada.");
  }

  if (purchaseData?.totalAmount !== 1500) {
    throw new Error("A compra deveria ter totalAmount 1500.");
  }

  if (purchaseData?.installmentsCount !== 5) {
    throw new Error("A compra deveria ter installmentsCount 5.");
  }

  if (purchaseData?.firstInvoiceCompetence !== "2026-05") {
    throw new Error("A primeira competência deveria continuar 2026-05.");
  }

  installmentsSnap.docs.forEach((installmentDoc) => {
    const installment = installmentDoc.data();

    if (installment.amount !== 300) {
      throw new Error(
        `Parcela ${installmentDoc.id} deveria ter amount 300.`
      );
    }

    if (installment.status !== "invoiced") {
      throw new Error(
        `Parcela ${installmentDoc.id} deveria estar invoiced.`
      );
    }

    if (!String(installment.invoiceId).startsWith(`${cardId}_2026-`)) {
      throw new Error(
        `Parcela ${installmentDoc.id} deveria estar vinculada a fatura.`
      );
    }
  });

  invoicesSnap.docs.forEach((invoiceDoc) => {
    const invoice = invoiceDoc.data();

    if (invoice.totalAmount !== 300) {
      throw new Error(`Fatura ${invoiceDoc.id} deveria ter totalAmount 300.`);
    }

    if (invoice.remainingAmount !== 300) {
      throw new Error(
        `Fatura ${invoiceDoc.id} deveria ter remainingAmount 300.`
      );
    }

    if (invoice.itemsCount !== 1) {
      throw new Error(`Fatura ${invoiceDoc.id} deveria ter itemsCount 1.`);
    }

    if (invoice.status !== "open") {
      throw new Error(`Fatura ${invoiceDoc.id} deveria estar open.`);
    }
  });

  invoiceViewsSnap.docs.forEach((viewDoc) => {
    const invoiceView = viewDoc.data();

    if (invoiceView.totalAmount !== 300) {
      throw new Error(
        `Projeção ${viewDoc.id} deveria ter totalAmount 300.`
      );
    }

    if (invoiceView.remainingAmount !== 300) {
      throw new Error(
        `Projeção ${viewDoc.id} deveria ter remainingAmount 300.`
      );
    }

    if (invoiceView.status !== "open") {
      throw new Error(`Projeção ${viewDoc.id} deveria estar open.`);
    }
  });

  if (ledgerData?.direction !== "consume") {
    throw new Error("O ledger da edição deveria consumir limite.");
  }

  if (ledgerData?.amount !== 300) {
    throw new Error("O ledger da edição deveria ter amount 300.");
  }

  if (eventData?.eventType !== "purchase_updated") {
    throw new Error("O evento financeiro deveria ser purchase_updated.");
  }

  if (limitSnapshotData?.limitUsed !== 1500) {
    throw new Error("O snapshot deveria ter limitUsed 1500.");
  }

  if (limitSnapshotData?.limitAvailable !== 3500) {
    throw new Error("O snapshot deveria ter limitAvailable 3500.");
  }
};

const run = async (): Promise<void> => {
  assertEmulator();
  initializeAdmin();

  const {workspaceId, uid, cardId} = await seedTestData();
  const purchaseResult = await createPurchase(workspaceId, uid, cardId);
  const updateIdempotencyKey = `manual-update-purchase-${Date.now()}`;

  const firstUpdateResult = await updatePurchase(
    workspaceId,
    uid,
    cardId,
    purchaseResult.purchaseId,
    updateIdempotencyKey
  );

  const secondUpdateResult = await updatePurchase(
    workspaceId,
    uid,
    cardId,
    purchaseResult.purchaseId,
    updateIdempotencyKey
  );

  assertUpdateResult(firstUpdateResult, secondUpdateResult);

  await inspectCreatedDocuments(
    workspaceId,
    cardId,
    purchaseResult.purchaseId,
    firstUpdateResult
  );

  console.log("Teste manual updateCreditCardPurchase concluído com sucesso.");
  console.log(JSON.stringify(firstUpdateResult, null, 2));
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Falha no teste manual updateCreditCardPurchase.");
    console.error(error);
    process.exit(1);
  });