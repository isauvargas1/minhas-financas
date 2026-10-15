import type {DocumentData, Timestamp} from "firebase-admin/firestore";
import {onDocumentWritten} from "firebase-functions/v2/firestore";

import {goalStatusSchema} from "../../goals/contracts";
import {createOperationLogger, type OperationLogger} from "../../shared/logger";
import {NOTIFICATION_TRIGGER_OPTIONS} from "../../shared/runtimeOptions";
import type {NotificationInput} from "../contract";
import {notificationIdFor} from "../ids";
import {
  dayLabel,
  publishProduced,
  saoPauloDayOf,
  timestampEpisode,
} from "./common";

/**
 * Produtor `goal_achieved` (P5-D2).
 *
 * - Emissão: escrita em `goals` em que o status passa a `alcancada` (antes
 *   ausente ou com outro status). O status só muda por `setGoalStatus` (ou na
 *   criação); `alcancada` → `alcancada` (edição, progresso, arquivamento)
 *   não emite.
 * - Reentrega não duplica: o episódio é o instante exato do commit da
 *   transição (`updateTime`), logo o ID é determinístico, e `createdAt` é
 *   esse mesmo instante; ALREADY_EXISTS é sucesso.
 * - Sem reemissão depois do TTL: só a transição emite. A reentrega do
 *   Eventarc dura no máximo 24 h e o estado autoritativo não expira; depois
 *   dos 180 dias, só uma nova transição (reabrir e concluir de novo) emite,
 *   e isso é um fato novo, com outro episódio.
 * - Sem ciclo: `notifications` não tem gatilho e nada é gravado no domínio.
 *
 * Metas não têm leitor `readAuthoritative*` nem `schemaVersion` (o documento
 * é gravado por `executeCreateGoal`/`executeSetGoalStatus`). A checagem
 * equivalente mínima é: `workspaceId` igual ao do caminho e `status` dentro
 * de `goalStatusSchema`.
 */
export const GOAL_NOTIFICATION_OPERATION = "onGoalWriteNotification";

export interface GoalNotificationInput {
  workspaceId: string;
  goalId: string;
  before: DocumentData | undefined;
  after: DocumentData | undefined;
  commitTime: Timestamp;
  /** Registra o documento fora do schema (só identificadores). */
  log?: OperationLogger;
}

export const goalAchievedNotification = (
  input: GoalNotificationInput,
): NotificationInput | null => {
  const {workspaceId, goalId, before, after, commitTime, log} = input;
  if (!after || after.status !== "alcancada") return null;
  if (before && before.status === "alcancada") return null;
  if (after.workspaceId !== workspaceId ||
    !goalStatusSchema.safeParse(after.status).success) {
    log?.warn("goal_notification_schema_invalid", {workspaceId, goalId});
    return null;
  }
  return {
    id: notificationIdFor({
      workspaceId,
      domain: "goal",
      entityId: goalId,
      eventType: "goal_achieved",
      episode: timestampEpisode(commitTime),
    }),
    workspaceId,
    eventType: "goal_achieved",
    title: "Meta alcançada",
    message: "Uma meta foi marcada como alcançada em " +
      `${dayLabel(saoPauloDayOf(commitTime))}.`,
    type: "success",
    link: "goals",
    createdAtMs: commitTime.toMillis(),
    entity: {goalId},
  };
};

/** Exportada para que os testes de integração chamem sem o Eventarc. */
export const handleGoalNotificationWrite = async (
  input: Omit<GoalNotificationInput, "log"> & {eventId?: string},
): Promise<void> => {
  const {eventId, ...fact} = input;
  const log = createOperationLogger({
    operation: GOAL_NOTIFICATION_OPERATION,
    // `event.id` do Eventarc (OBSERVABILITY §4): o mesmo em cada
    // reentrega do fato.
    sourceEventId: eventId,
    workspaceId: fact.workspaceId,
    goalId: fact.goalId,
  });
  await publishProduced(() => goalAchievedNotification({...fact, log}), log);
};

export const onGoalWriteNotification = onDocumentWritten(
  {
    ...NOTIFICATION_TRIGGER_OPTIONS,
    document: "workspaces/{workspaceId}/goals/{goalId}",
  },
  async (event) => {
    if (!event.data) return;
    const {workspaceId, goalId} = event.params;
    const {before, after} = event.data;
    // Exclusão não gera fato; sem `updateTime` não há instante de commit.
    if (!after.exists || !after.updateTime) return;
    await handleGoalNotificationWrite({
      eventId: event.id,
      workspaceId,
      goalId,
      before: before.exists ? before.data() : undefined,
      after: after.data(),
      commitTime: after.updateTime,
    });
  },
);
