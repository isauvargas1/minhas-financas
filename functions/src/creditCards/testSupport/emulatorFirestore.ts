import * as admin from "firebase-admin";

export interface SeedCreditCardIntegrationWorkspaceInput {
  workspaceId: string;
  ownerId: string;
  cardId: string;
}

export interface SeedCreditCardIntegrationMemberInput {
  workspaceId: string;
  userId: string;
  role: "owner" | "admin" | "member" | "viewer";
}

const CREDIT_CARD_TEST_COLLECTIONS = [
  "credit_cards",
  "credit_card_purchases",
  "credit_card_installments",
  "credit_card_invoices",
  "credit_card_invoice_payments",
  "card_limit_ledger",
  "card_limit_snapshots",
  "financial_events",
  "credit_card_audit_logs",
  "credit_card_operational_metrics",
  "invoice_views",
  "credit_card_idempotency_keys",
  "notifications",
  "transactions",
];

export const getIntegrationFirestore = (): admin.firestore.Firestore => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST não configurado.");
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.GCLOUD_PROJECT || "minhas-financas-local",
    });
  }

  return admin.firestore();
};

const deleteCollectionDocuments = async (
  db: admin.firestore.Firestore,
  collectionPath: string,
): Promise<void> => {
  const snapshot = await db.collection(collectionPath).get();

  if (snapshot.empty) {
    return;
  }

  const batch = db.batch();

  snapshot.docs.forEach((documentSnapshot) => {
    batch.delete(documentSnapshot.ref);
  });

  await batch.commit();
};

export const resetCreditCardIntegrationWorkspace = async (
  workspaceId: string,
): Promise<void> => {
  const db = getIntegrationFirestore();

  await Promise.all(
    CREDIT_CARD_TEST_COLLECTIONS.map((collectionName) =>
      deleteCollectionDocuments(
        db,
        `workspaces/${workspaceId}/${collectionName}`,
      ),
    ),
  );

  await deleteCollectionDocuments(db, `workspaces/${workspaceId}/members`);

  await db.doc(`workspaces/${workspaceId}`).delete();
};

export const seedCreditCardIntegrationWorkspace = async ({
  workspaceId,
  ownerId,
  cardId,
}: SeedCreditCardIntegrationWorkspaceInput): Promise<void> => {
  const db = getIntegrationFirestore();
  const now = admin.firestore.Timestamp.now();

  const batch = db.batch();

  batch.set(db.doc(`workspaces/${workspaceId}`), {
    id: workspaceId,
    name: "Workspace Integração Cartão",
    type: "PF",
    ownerId,
    createdAt: now,
    updatedAt: now,
  });

  batch.set(db.doc(`workspaces/${workspaceId}/members/${ownerId}`), {
    uid: ownerId,
    role: "owner",
    status: "active",
    joinedAt: now,
  });

  batch.set(db.doc(`workspaces/${workspaceId}/credit_cards/${cardId}`), {
    id: cardId,
    workspaceId,
    name: "Cartão Integração",
    brand: "visa",
    status: "active",
    limitTotal: 5000,
    closingDay: 10,
    dueDay: 20,
    createdAt: now,
    updatedAt: now,
  });

  batch.set(db.doc(`workspaces/${workspaceId}/card_limit_snapshots/${cardId}`), {
    cardId,
    workspaceId,
    limitTotal: 5000,
    limitUsed: 0,
    limitAvailable: 5000,
    updatedAt: now,
  });

  await batch.commit();
};

export const seedCreditCardIntegrationMember = async ({
  workspaceId,
  userId,
  role,
}: SeedCreditCardIntegrationMemberInput): Promise<void> => {
  const db = getIntegrationFirestore();
  const now = admin.firestore.Timestamp.now();

  await db.doc(`workspaces/${workspaceId}/members/${userId}`).set({
    uid: userId,
    role,
    status: "active",
    joinedAt: now,
  });
};