import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import {sha256} from "../shared/hashing";
import {userProfileRef} from "../shared/workspaceAuth";

/**
 * Suspensão de conta (D-P1-SUSP; mecanismo interno, sem superfície).
 *
 * Ordem deliberada:
 * 1. Transação: `users/{uid}.status = "suspended"` e registro de auditoria da
 *    plataforma. A partir do commit, toda callable recusa a conta (o wrapper
 *    lê o perfil) e as Rules negam leitura e escrita em dados de workspace
 *    (os helpers de membership exigem perfil ativo).
 * 2. Auth: `disabled: true` impede novo login e a renovação do ID token.
 * 3. `revokeRefreshTokens` invalida as sessões existentes.
 *
 * Se o passo 2 ou 3 falhar, a operação é repetível: a transação encontra a
 * conta já suspensa, não grava auditoria de novo e refaz os passos do Auth.
 * O status no Firestore vem primeiro porque é ele que as Rules e o backend
 * consultam; a revogação sozinha deixaria o ID token vigente valer até expirar.
 *
 * A operação por um administrador de plataforma (tela, custom claim, MFA) é
 * PR-ADMIN-01, em P7. Esta função não é exportada como callable.
 */
export const PLATFORM_AUDIT_COLLECTION = "platform_audit_events";

export interface SuspendAccountInput {
  uid: string;
  actorId: string;
  reason: string;
  requestId: string;
}

export const suspendAccount = async (
  input: SuspendAccountInput,
): Promise<{changed: boolean}> => {
  const reason = input.reason.trim().slice(0, 500);
  if (!reason) {
    throw new ApplicationError("invalid_payload", "Informe o motivo.");
  }
  const db = admin.firestore();
  const changed = await db.runTransaction(async (transaction) => {
    const profileRef = userProfileRef(input.uid);
    const profile = await transaction.get(profileRef);
    if (!profile.exists) {
      throw new ApplicationError("not_found", "Conta não encontrada.");
    }
    if (profile.get("status") === "suspended") return false;
    transaction.update(profileRef, {
      status: "suspended",
      suspendedAt: FieldValue.serverTimestamp(),
      suspendedBy: input.actorId,
      suspensionReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const eventRef = db.collection(PLATFORM_AUDIT_COLLECTION).doc(
      `account_suspended_${
        sha256(`${input.requestId}:${input.uid}`).slice(0, 32)
      }`,
    );
    transaction.create(eventRef, {
      id: eventRef.id,
      operation: "account.suspended",
      actorId: input.actorId,
      targetId: input.uid,
      before: {status: profile.get("status") ?? null},
      after: {status: "suspended"},
      reason,
      requestId: input.requestId,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  await admin.auth().updateUser(input.uid, {disabled: true});
  await admin.auth().revokeRefreshTokens(input.uid);
  return {changed};
};
