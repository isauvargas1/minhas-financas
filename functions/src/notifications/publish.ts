import * as admin from "firebase-admin";

import {isAlreadyExistsError} from "../shared/errors";
import {workspaceRef} from "../shared/workspaceAuth";

/**
 * Publicação das notificações persistentes (P5-D2, PR-NOTIF-01).
 *
 * - Idempotente: o documento nasce com `create` e o ID determinístico do
 *   evento (`ids.ts`). Se já existe, nada é regravado e o resultado é
 *   `"exists"`.
 * - A reentrega (gatilho, rotina ou retry) nunca altera `createdAt` nem
 *   `expiresAt`: a retenção parte da primeira publicação.
 * - Sem leitura prévia: a própria criação decide, num único round trip.
 * - Nenhum gatilho escuta `notifications`: publicar não dispara outro
 *   produtor, logo não há ciclo.
 *
 * O documento vem do builder (`builder.ts`); este módulo não valida o
 * contrato nem monta campos.
 */
export type NotificationPublishOutcome = "created" | "exists";

export const notificationsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection("notifications");

export const publishNotification = async (
  document: admin.firestore.DocumentData,
): Promise<NotificationPublishOutcome> => {
  try {
    await notificationsRef(document.workspaceId).doc(document.id)
      .create(document);
    return "created";
  } catch (error) {
    if (isAlreadyExistsError(error)) return "exists";
    throw error;
  }
};

/**
 * Campos de log estruturado de uma publicação: só identificadores, nunca
 * título, mensagem ou entidade.
 */
export const notificationPublishLogFields = (
  document: admin.firestore.DocumentData,
  outcome: NotificationPublishOutcome,
) => ({
  workspaceId: document.workspaceId,
  notificationId: document.id,
  domain: document.domain,
  domainEventType: document.domainEventType,
  outcome,
});
