import type {Timestamp} from "firebase-admin/firestore";

import {saoPauloDayKey} from "../../shared/dateKeys";
import type {OperationLogger} from "../../shared/logger";
import {buildNotificationDocument} from "../builder";
import {NotificationContractError, type NotificationInput} from "../contract";
import {
  notificationPublishLogFields,
  publishNotification,
  type NotificationPublishOutcome,
} from "../publish";

/**
 * Peças comuns dos produtores de notificação (P5-D2, PR-NOTIF-01).
 *
 * Os produtores só LEEM o antes e o depois do documento autoritativo e CRIAM
 * a notificação pelo builder único; nada aqui escreve no domínio. Logs
 * carregam só identificadores: nunca título, mensagem, nome ou valor.
 */

/** `AAAA-MM-DD` → `DD/MM/AAAA`, o formato dos textos das notificações. */
export const dayLabel = (dayKey: string): string =>
  `${dayKey.slice(8, 10)}/${dayKey.slice(5, 7)}/${dayKey.slice(0, 4)}`;

/** Dia civil, em `America/Sao_Paulo`, do instante de um commit. */
export const saoPauloDayOf = (timestamp: Timestamp): string =>
  saoPauloDayKey(timestamp.toDate());

/**
 * Episódio derivado do instante exato do commit (segundos + nanos). Nunca
 * contém `:`, que separa os segmentos da identidade (`ids.ts`).
 */
export const timestampEpisode = (timestamp: Timestamp): string =>
  `${timestamp.seconds}.${String(timestamp.nanoseconds).padStart(9, "0")}`;

/**
 * Executor comum dos gatilhos: constrói, valida e publica.
 *
 * - Recebe a função que monta a entrada, para que uma identidade ou um
 *   documento fora do contrato (`NotificationContractError`, do builder ou
 *   de `notificationIdFor`) seja tratado aqui.
 * - Entrada nula (sem transição): nada a fazer.
 * - Contrato violado: log de erro e fim, sem relançar. Reentregar o mesmo
 *   evento produziria o mesmo documento inválido.
 * - Publicação: `create` com ID determinístico. `"exists"` é sucesso (já
 *   publicado). Qualquer outro erro é relançado: o gatilho tem `retry: true`
 *   e o Eventarc reentrega, caindo no mesmo ID.
 */
export const publishProduced = async (
  produce: () => NotificationInput | null,
  log: OperationLogger,
): Promise<NotificationPublishOutcome | null> => {
  let input: NotificationInput | null = null;
  let document;
  try {
    input = produce();
    if (!input) return null;
    document = buildNotificationDocument(input);
  } catch (error) {
    if (!(error instanceof NotificationContractError)) throw error;
    log.error("notification_contract_violation", error, {
      workspaceId: input?.workspaceId ?? null,
      notificationId: input?.id ?? null,
      domainEventType: input?.eventType ?? null,
      reason: error.reason,
    });
    return null;
  }
  const outcome = await publishNotification(document);
  log.info("notification_published",
    notificationPublishLogFields(document, outcome));
  return outcome;
};
