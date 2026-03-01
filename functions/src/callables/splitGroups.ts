import {onCall, HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {z} from "zod";

const db = admin.firestore();

// 1. Schema de Validação com Zod
const inviteSchema = z.object({
  groupId: z.string().min(1, "Group ID é obrigatório"),
  role: z.enum(["participante", "visualizador"]),
  workspaceId: z.string().min(1, "Workspace ID é obrigatório"),
});

// 2. A Função Callable de CRIAR Convite
export const createSplitGroupInvite = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      "unauthenticated",
      "Você precisa estar logado para gerar convites."
    );
  }

  const uid = request.auth.uid;
  let data;

  try {
    data = inviteSchema.parse(request.data);
  } catch (error) {
    throw new HttpsError(
      "invalid-argument",
      "Dados inválidos enviados para a função."
    );
  }

  const path = `workspaces/${data.workspaceId}/split_participants`;
  const participantsRef = db.collection(path);

  const snapshot = await participantsRef
    .where("groupId", "==", data.groupId)
    .where("userId", "==", uid)
    .get();

  if (snapshot.empty) {
    throw new HttpsError(
      "permission-denied",
      "Você não faz parte deste grupo."
    );
  }

  const myParticipantRecord = snapshot.docs[0].data();
  if (myParticipantRecord.papel !== "dono") {
    throw new HttpsError(
      "permission-denied",
      "Apenas o dono do grupo pode gerar convites."
    );
  }

  const code = Math.random().toString(36).substring(2, 8).toUpperCase();
  const expDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const invite = {
    groupId: data.groupId,
    codigoConvite: code,
    papelSugerido: data.role,
    status: "pendente",
    expiraEm: expDate,
    createdBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  const invitePath = `workspaces/${data.workspaceId}/split_invites`;
  const inviteRef = db.collection(invitePath).doc();
  await inviteRef.set(invite);

  return {
    success: true,
    inviteId: inviteRef.id,
    code: code,
  };
});

// --- NOVA FUNÇÃO: ACEITAR CONVITE ---

const acceptInviteSchema = z.object({
  code: z.string().min(6, "Código inválido"),
  userName: z.string().min(1, "Nome é obrigatório"),
  workspaceId: z.string().min(1, "Workspace ID é obrigatório"),
});

export const acceptSplitGroupInvite = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Você precisa estar logado.");
  }

  const uid = request.auth.uid;
  let data;

  try {
    data = acceptInviteSchema.parse(request.data);
  } catch (error) {
    throw new HttpsError("invalid-argument", "Dados inválidos.");
  }

  const workspaceRef = db.doc(`workspaces/${data.workspaceId}`);

  const invitesRef = workspaceRef.collection("split_invites");
  const inviteSnap = await invitesRef
    .where("codigoConvite", "==", data.code)
    .where("status", "==", "pendente")
    .limit(1)
    .get();

  if (inviteSnap.empty) {
    throw new HttpsError(
      "not-found",
      "Convite inválido, expirado ou já aceito."
    );
  }

  const inviteDoc = inviteSnap.docs[0];
  const inviteData = inviteDoc.data();

  if (inviteData.expiraEm && new Date(inviteData.expiraEm) < new Date()) {
    await inviteDoc.ref.update({status: "expirado"});
    throw new HttpsError("failed-precondition", "Este convite já expirou.");
  }

  const participantsRef = workspaceRef.collection("split_participants");
  const alreadyInGroup = await participantsRef
    .where("groupId", "==", inviteData.groupId)
    .where("userId", "==", uid)
    .get();

  if (!alreadyInGroup.empty) {
    throw new HttpsError("already-exists", "Você já participa deste grupo.");
  }

  const batch = db.batch();

  const newParticipantRef = participantsRef.doc();
  batch.set(newParticipantRef, {
    id: newParticipantRef.id,
    groupId: inviteData.groupId,
    userId: uid,
    nomeExibicao: data.userName,
    papel: inviteData.papelSugerido,
    corIdentidade: "#6366f1",
  });

  batch.update(inviteDoc.ref, {
    status: "aceito",
    aceitoPor: uid,
    aceitoEm: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();

  return {success: true, groupId: inviteData.groupId};
});
