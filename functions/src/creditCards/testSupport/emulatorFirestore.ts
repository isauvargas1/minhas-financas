import * as admin from "firebase-admin";

import {
  requireFirestoreEmulator,
  seedActiveAccount,
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import type {
  WorkspaceActor,
  WorkspaceRole,
} from "../../shared/workspaceAuth";

export interface SeedCreditCardIntegrationWorkspaceInput {
  workspaceId: string;
  ownerId: string;
  cardId: string;
}

export interface SeedCreditCardIntegrationMemberInput {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
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

/**
 * Firestore do Emulator para os testes de integração.
 *
 * Sem Emulator a suíte **falha** em vez de pular (FIRE-13), e o projeto é
 * sempre o local: nenhum `GCLOUD_PROJECT` herdado aponta o Admin SDK para um
 * projeto real.
 */
export const getIntegrationFirestore = (): admin.firestore.Firestore =>
  requireFirestoreEmulator();

/** Ator como a pré-checagem do kernel o entregaria à operação. */
export const creditCardTestActor = (
  workspaceId: string,
  uid: string,
  role: WorkspaceRole = "owner",
): WorkspaceActor => ({uid, workspaceId, role});

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

  const members = await db.collection(`workspaces/${workspaceId}/members`)
    .get();

  await Promise.all(
    members.docs.map((member) =>
      db.doc(`users/${member.id}/workspaces/${workspaceId}`).delete(),
    ),
  );

  await deleteCollectionDocuments(db, `workspaces/${workspaceId}/members`);

  await db.doc(`workspaces/${workspaceId}`).delete();
};

/**
 * Workspace ativo com o owner canônico: perfil ativo, membership ativo e
 * entrada no índice do usuário — o mesmo estado que o bootstrap produz. O
 * `ownerId` do documento é só dado denormalizado; a autorização vem do
 * membership.
 */
export const seedCreditCardIntegrationWorkspace = async ({
  workspaceId,
  ownerId,
  cardId,
}: SeedCreditCardIntegrationWorkspaceInput): Promise<void> => {
  const db = getIntegrationFirestore();
  const now = admin.firestore.Timestamp.now();

  await seedActiveAccount(ownerId);
  await seedWorkspace({
    workspaceId,
    ownerId,
    name: "Workspace Integração Cartão",
  });

  const batch = db.batch();

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

  batch.set(
    db.doc(`workspaces/${workspaceId}/card_limit_snapshots/${cardId}`),
    {
      cardId,
      workspaceId,
      limitTotal: 5000,
      limitUsed: 0,
      limitAvailable: 5000,
      updatedAt: now,
    },
  );

  await batch.commit();
};

/** Membro com perfil ativo e membership ativo no papel informado. */
export const seedCreditCardIntegrationMember = async ({
  workspaceId,
  userId,
  role,
}: SeedCreditCardIntegrationMemberInput): Promise<void> => {
  await seedActiveAccount(userId);
  await seedMember(workspaceId, userId, role);
};
