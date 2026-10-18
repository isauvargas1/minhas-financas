import type {DocumentData, Timestamp} from "firebase-admin/firestore";
import {onDocumentCreated} from "firebase-functions/v2/firestore";

import {
  readAuthoritativeOccurrence,
  type AttentionCode,
} from "../../recurring/model";
import {createOperationLogger, type OperationLogger} from "../../shared/logger";
import {NOTIFICATION_TRIGGER_OPTIONS} from "../../shared/runtimeOptions";
import type {NotificationInput} from "../contract";
import {notificationIdFor} from "../ids";
import {dayLabel, publishProduced, saoPauloDayOf} from "./common";

/**
 * Produtor das ocorrências de despesa recorrente (P5-D2):
 * `recurring_awaiting_confirmation` e `recurring_attention_required`.
 *
 * - Emissão: criação de uma ocorrência no schema autoritativo com status
 *   `awaiting_confirmation` ou `attention_required` (a geração abriu uma
 *   ação para o usuário). `generated` e `ignored` não emitem.
 * - Reentrega não duplica: o episódio é o próprio `occurrenceId` e
 *   `createdAt` é o `createTime` da ocorrência; ALREADY_EXISTS é sucesso.
 * - Sem reemissão depois do TTL: o gatilho é de criação, e a ocorrência é
 *   criada uma única vez (ID determinístico, `alreadyProcessed`), nunca
 *   recriada. A reentrega do Eventarc dura no máximo 24 h; mudanças
 *   posteriores de status não disparam este gatilho.
 * - Sem ciclo: `notifications` não tem gatilho e nada é gravado no domínio.
 *
 * O motivo da atenção vem só do código de impedimento (nunca de texto de
 * erro, descrição ou valor).
 */
export const RECURRING_NOTIFICATION_OPERATION =
  "onRecurringOccurrenceCreatedNotification";

/** Motivo em pt-BR de cada código; exaustivo por construção do tipo. */
export const ATTENTION_REASON: Record<AttentionCode, string> = {
  card_unavailable: "o cartão não estava disponível",
  card_archived: "o cartão estava arquivado",
  limit_insufficient: "o limite do cartão era insuficiente",
  account_unavailable: "a conta não estava disponível",
  account_archived: "a conta estava arquivada",
  workspace_unavailable: "o espaço de trabalho não estava disponível",
};

export interface RecurringOccurrenceNotificationInput {
  workspaceId: string;
  occurrenceId: string;
  data: DocumentData | undefined;
  createTime: Timestamp;
  /** Registra o documento fora do schema (só identificadores). */
  log?: OperationLogger;
}

export const recurringOccurrenceNotification = (
  input: RecurringOccurrenceNotificationInput,
): NotificationInput | null => {
  const {workspaceId, occurrenceId, data, createTime, log} = input;
  const occurrence = readAuthoritativeOccurrence(
    occurrenceId, data, workspaceId);
  if (!occurrence) {
    log?.warn("recurring_notification_schema_invalid",
      {workspaceId, occurrenceId});
    return null;
  }
  const awaiting = occurrence.status === "awaiting_confirmation";
  const attention = occurrence.status === "attention_required";
  if (!awaiting && !attention) return null;
  const eventType = awaiting ?
    "recurring_awaiting_confirmation" :
    "recurring_attention_required";
  const dueDay = dayLabel(occurrence.dueDate);
  // Dia (São Paulo) em que a ocorrência foi criada: o fato é datado.
  const day = dayLabel(saoPauloDayOf(createTime));
  const reason = occurrence.attentionCode ?
    ATTENTION_REASON[occurrence.attentionCode] :
    null;
  return {
    id: notificationIdFor({
      workspaceId,
      domain: "recurring",
      entityId: occurrenceId,
      eventType,
      episode: occurrenceId,
    }),
    workspaceId,
    eventType,
    title: awaiting ?
      "Despesa recorrente aguardando confirmação" :
      "Despesa recorrente não gerada",
    message: awaiting ?
      `Em ${day}, uma despesa recorrente com vencimento em ${dueDay} ` +
      "ficou aguardando confirmação." :
      `Em ${day}, uma despesa recorrente com vencimento em ${dueDay} não ` +
      `pôde ser gerada: ${reason}.`,
    type: "warning",
    link: "recurring",
    createdAtMs: createTime.toMillis(),
    entity: {
      recurringExpenseId: occurrence.recurringExpenseId,
      occurrenceId,
    },
  };
};

/** Exportada para que os testes de integração chamem sem o Eventarc. */
export const handleRecurringOccurrenceCreated = async (
  input: Omit<RecurringOccurrenceNotificationInput, "log"> & {eventId?: string},
): Promise<void> => {
  const {eventId, ...fact} = input;
  const log = createOperationLogger({
    operation: RECURRING_NOTIFICATION_OPERATION,
    // `event.id` do Eventarc (OBSERVABILITY §4): o mesmo em cada
    // reentrega do fato.
    sourceEventId: eventId,
    workspaceId: fact.workspaceId,
    occurrenceId: fact.occurrenceId,
  });
  await publishProduced(
    () => recurringOccurrenceNotification({...fact, log}), log);
};

export const onRecurringOccurrenceCreatedNotification = onDocumentCreated(
  {
    ...NOTIFICATION_TRIGGER_OPTIONS,
    document: "workspaces/{workspaceId}/recurring_occurrences/{occurrenceId}",
  },
  async (event) => {
    if (!event.data) return;
    const {workspaceId, occurrenceId} = event.params;
    await handleRecurringOccurrenceCreated({
      eventId: event.id,
      workspaceId,
      occurrenceId,
      data: event.data.data(),
      createTime: event.data.createTime,
    });
  },
);
