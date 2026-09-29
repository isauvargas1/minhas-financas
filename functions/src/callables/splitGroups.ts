import {randomInt} from "node:crypto";

import {HttpsError} from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {z} from "zod";

import {defineCallable, type CallableFailure} from "../shared/callable";
import {errorCodeOf} from "../shared/errors";
import {reserveRateLimit} from "../shared/rateLimit";
import {DOMAIN_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
  type WorkspaceRole,
} from "../shared/workspaceAuth";

const db = () => admin.firestore();

/**
 * Alfabeto sem caracteres ambíguos (`0/O`, `1/I/L`) — o código é ditado por
 * voz e digitado à mão.
 */
const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const INVITE_CODE_LENGTH = 10;

/**
 * Código de convite imprevisível.
 *
 * `Math.random().toString(36).substring(2, 8)` (INV-P2-037) produzia 6
 * caracteres de um PRNG **não criptográfico**, com espaço de busca da ordem
 * de 2 bilhões e estado previsível a partir de saídas anteriores. Combinado
 * com um `acceptSplitGroupInvite` que não verificava membership, isso era um
 * vetor de escrita cross-tenant por força bruta.
 *
 * `randomInt` usa o CSPRNG do sistema; 10 caracteres num alfabeto de 31 dão
 * ~49 bits, e o limite de frequência abaixo fecha a força bruta na prática.
 *
 * Exportado com o nome real (sem sufixo de teste): o entrypoint reexporta este
 * módulo, e o contrato de deploy recusa export com nome de teste. A
 * propriedade verificável é o formato e a entropia.
 */
export const generateInviteCode = (): string => {
  let code = "";
  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(INVITE_CODE_ALPHABET.length)];
  }
  return code;
};

const inviteSchema = z.object({
  groupId: z.string().min(1, "Group ID é obrigatório").max(128),
  role: z.enum(["participante", "visualizador"]),
  workspaceId: z.string().min(1, "Workspace ID é obrigatório").max(128),
}).strict();

const acceptInviteSchema = z.object({
  code: z
    .string()
    .min(6, "Código inválido")
    .max(32)
    .transform((value) => value.trim().toUpperCase()),
  userName: z.string().min(1, "Nome é obrigatório").max(120),
  workspaceId: z.string().min(1, "Workspace ID é obrigatório").max(128),
}).strict();

const CREATE_INVITE_RATE_LIMIT = {
  operation: "createSplitGroupInvite",
  limit: 10,
  windowSeconds: 60 * 60,
};

/**
 * Teto agressivo: cada tentativa de aceitar consulta um código. Sem ele, o
 * espaço de códigos é varrido por repetição, não por adivinhação.
 */
const ACCEPT_INVITE_RATE_LIMIT = {
  operation: "acceptSplitGroupInvite",
  limit: 10,
  windowSeconds: 15 * 60,
};

/**
 * Papéis que podem convidar e aceitar convite de grupo: quem escreve no
 * workspace. O convite escolhe o **papel no grupo**, nunca a participação no
 * tenant.
 */
export const SPLIT_GROUP_OPERATION_ROLES: readonly WorkspaceRole[] = [
  "owner",
  "admin",
  "member",
];

/** Mensagem do domínio para erro inesperado (sem detalhe interno). */
const SPLIT_GROUP_INTERNAL_MESSAGE =
  "Não foi possível concluir a operação. Tente novamente.";

/** Com `workspaceRoles`, o kernel sempre entrega o ator resolvido. */
const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new Error("split_group_callable_without_actor");
  return actor;
};

/**
 * Evento de erro inesperado do domínio, mantido ao lado do log do kernel:
 * só o código estável, nunca o erro cru de Firestore ou de biblioteca.
 */
const logUnexpectedSplitGroupError = ({
  requestId,
  error,
}: CallableFailure): void => {
  if (errorCodeOf(error) !== "internal") return;
  console.error("split_group_callable_error", {
    requestId,
    errorCode: error instanceof Error ? error.name : "unknown",
  });
};

export const createSplitGroupInvite = defineCallable({
  operation: CREATE_INVITE_RATE_LIMIT.operation,
  schema: inviteSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  // INV-P2-037 — antes bastava `request.auth`: qualquer conta autenticada
  // escrevia em `workspaces/{alheio}/split_invites` pelo Admin SDK, que
  // ignora as Rules.
  workspaceRoles: SPLIT_GROUP_OPERATION_ROLES,
  internalMessage: SPLIT_GROUP_INTERNAL_MESSAGE,
  onFailure: logUnexpectedSplitGroupError,
  handler: async ({actor: resolved, payload: data}) => {
    const actor = requireActor(resolved);

    const participantsRef = db().collection(
      `workspaces/${actor.workspaceId}/split_participants`
    );

    const snapshot = await participantsRef
      .where("groupId", "==", data.groupId)
      .where("userId", "==", actor.uid)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new HttpsError(
        "permission-denied",
        "Você não faz parte deste grupo."
      );
    }

    if (snapshot.docs[0].data().papel !== "dono") {
      throw new HttpsError(
        "permission-denied",
        "Apenas o dono do grupo pode gerar convites."
      );
    }

    const code = generateInviteCode();
    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const inviteRef = db()
      .collection(`workspaces/${actor.workspaceId}/split_invites`)
      .doc();

    // Limite de frequência e criação no mesmo limite atômico: um laço de
    // chamadas não consegue passar entre a verificação e a escrita.
    await db().runTransaction(async (transaction) => {
      // Autorização relida na fase de leitura: quem perdeu o acesso depois da
      // pré-checagem não grava convite.
      await reassertWorkspaceActor(transaction, actor);
      const rateLimit = await reserveRateLimit(
        transaction,
        actor.workspaceId,
        actor.uid,
        CREATE_INVITE_RATE_LIMIT
      );

      rateLimit.commit();
      transaction.set(inviteRef, {
        groupId: data.groupId,
        codigoConvite: code,
        papelSugerido: data.role,
        status: "pendente",
        expiraEm: expiresAt,
        createdBy: actor.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    return {success: true, inviteId: inviteRef.id, code};
  },
});

export const acceptSplitGroupInvite = defineCallable({
  operation: ACCEPT_INVITE_RATE_LIMIT.operation,
  schema: acceptInviteSchema,
  runtime: DOMAIN_CALLABLE_OPTIONS,
  // INV-P2-037 — a verificação de membership é o coração da correção:
  // aceitar um convite não pode ser a porta de entrada para um workspace
  // do qual o chamador não participa. O convite escolhe o **papel no
  // grupo**, nunca a participação no tenant.
  workspaceRoles: SPLIT_GROUP_OPERATION_ROLES,
  internalMessage: SPLIT_GROUP_INTERNAL_MESSAGE,
  onFailure: logUnexpectedSplitGroupError,
  handler: async ({actor: resolved, payload: data}) => {
    const actor = requireActor(resolved);

    const workspaceRef = db().doc(`workspaces/${actor.workspaceId}`);
    const invitesRef = workspaceRef.collection("split_invites");
    const participantsRef = workspaceRef.collection("split_participants");

    const result = await db().runTransaction(async (transaction) => {
      // Autorização relida antes de qualquer outra leitura e da gravação.
      await reassertWorkspaceActor(transaction, actor);
      // Toda tentativa consome limite, inclusive as que falham: é o que
      // fecha a varredura por força bruta do espaço de códigos. A gravação
      // do contador vem depois das leituras, por exigência do Firestore.
      const rateLimit = await reserveRateLimit(
        transaction,
        actor.workspaceId,
        actor.uid,
        ACCEPT_INVITE_RATE_LIMIT
      );

      const inviteSnapshot = await transaction.get(
        invitesRef
          .where("codigoConvite", "==", data.code)
          .where("status", "==", "pendente")
          .limit(1)
      );

      const existing = await transaction.get(
        participantsRef
          .where("groupId", "==", inviteSnapshot.docs[0]?.data().groupId ?? "")
          .where("userId", "==", actor.uid)
          .limit(1)
      );

      rateLimit.commit();

      if (inviteSnapshot.empty) {
        throw new HttpsError(
          "not-found",
          "Convite inválido, expirado ou já aceito."
        );
      }

      const inviteDoc = inviteSnapshot.docs[0];
      const invite = inviteDoc.data();

      if (invite.expiraEm && new Date(invite.expiraEm) < new Date()) {
        transaction.update(inviteDoc.ref, {status: "expirado"});
        throw new HttpsError(
          "failed-precondition",
          "Este convite já expirou."
        );
      }

      if (!existing.empty) {
        throw new HttpsError(
          "already-exists",
          "Você já participa deste grupo."
        );
      }

      const newParticipantRef = participantsRef.doc();
      transaction.set(newParticipantRef, {
        id: newParticipantRef.id,
        groupId: invite.groupId,
        userId: actor.uid,
        nomeExibicao: data.userName,
        papel: invite.papelSugerido,
        corIdentidade: "#6366f1",
      });

      transaction.update(inviteDoc.ref, {
        status: "aceito",
        aceitoPor: actor.uid,
        aceitoEm: admin.firestore.FieldValue.serverTimestamp(),
      });

      return {groupId: invite.groupId as string};
    });

    return {success: true, groupId: result.groupId};
  },
});
