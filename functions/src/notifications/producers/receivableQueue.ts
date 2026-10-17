import * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {addDaysToDayKey, isDayKey} from "../../shared/dateKeys";

/**
 * Trabalho pendente e confirmação durável dos avisos de recebível vencido
 * (P5-D2.1). Duas estruturas backend-owned, específicas de Recebíveis:
 *
 * - `receivable_overdue_queue/{receivableId}` existe só enquanto há trabalho:
 *   o recebível está aberto, com saldo e com vencimento válido, e o episódio
 *   (o `dueDate`) ainda não foi confirmado. Para vencimento futuro, isso
 *   inclui a espera até ele (até 10 anos, o teto do contrato). `runAfterDay`
 *   é o dia civil de São Paulo a partir do qual o item pode ser processado:
 *   o dia em que ficou devido (o seguinte ao vencimento, ou o próprio dia do
 *   enfileiramento quando o vencimento já passou), ou um dia posterior
 *   depois de uma falha (backoff).
 * - `receivable_overdue_deliveries/{notificationId}` é a confirmação de que o
 *   episódio foi entregue. Sem `expiresAt` e sem TTL: é ela, e não a
 *   existência do aviso (apagado pelo TTL em 180 dias), que impede a
 *   reemissão. Retida enquanto existir o recebível (que nunca é apagado) e
 *   eliminada com o workspace.
 *
 * Nenhuma das duas guarda dado pessoal: só identificadores e datas.
 */
export const RECEIVABLE_OVERDUE_QUEUE_COLLECTION = "receivable_overdue_queue";
export const RECEIVABLE_OVERDUE_DELIVERIES_COLLECTION =
  "receivable_overdue_deliveries";
export const RECEIVABLE_OVERDUE_WORK_SCHEMA_VERSION = 1;

export const receivableOverdueQueueRef = (
  workspaceId: string,
  receivableId: string,
) => admin.firestore().doc(
  `workspaces/${workspaceId}/${RECEIVABLE_OVERDUE_QUEUE_COLLECTION}/` +
  receivableId);

export const receivableOverdueDeliveryRef = (
  workspaceId: string,
  notificationId: string,
) => admin.firestore().doc(
  `workspaces/${workspaceId}/${RECEIVABLE_OVERDUE_DELIVERIES_COLLECTION}/` +
  notificationId);

/** O que importa do recebível para o trabalho de aviso de atraso. */
export interface ReceivableOverdueShape {
  status: string;
  balanceCents: number;
  dueDate: string;
}

/**
 * Forma elegível: aberto, com saldo e com vencimento válido. O vencimento
 * ainda pode estar no futuro; nesse caso o item espera em `runAfterDay`.
 */
export const isOverdueWorkShape = (shape: ReceivableOverdueShape): boolean =>
  shape.status === "open" && shape.balanceCents > 0 && isDayKey(shape.dueDate);

/** Primeiro dia de atraso (dia civil de São Paulo): o dia seguinte. */
export const firstOverdueDay = (dueDate: string): string =>
  addDaysToDayKey(dueDate, 1);

/**
 * Dia em que o item fica devido: o primeiro dia de atraso, mas nunca antes
 * do dia do enfileiramento. A fila anda na ordem em que os itens ficaram
 * devidos: um vencimento retroativo (cadastro ou edição para o passado)
 * entra atrás do que já esperava, e não fura a fila dos outros workspaces.
 */
export const dueQueueDay = (dueDate: string, enqueuedOn: string): string => {
  const first = firstOverdueDay(dueDate);
  return first > enqueuedOn ? first : enqueuedOn;
};

/**
 * Sincroniza o trabalho pendente dentro da transação da operação de domínio,
 * depois de ela gravar o recebível. Só escreve quando muda a forma elegível
 * ou o vencimento: um recebimento parcial que mantém o recebível aberto não
 * escreve nada (e não gera segundo aviso do mesmo episódio). Não lê nada: o
 * estado anterior já foi lido pela operação.
 */
export const syncReceivableOverdueWork = (
  transaction: admin.firestore.Transaction,
  input: {
    workspaceId: string;
    receivableId: string;
    before: ReceivableOverdueShape | null;
    after: ReceivableOverdueShape;
    /** Dia civil de São Paulo da operação de domínio. */
    today: string;
  },
): void => {
  const wasEligible = input.before !== null && isOverdueWorkShape(input.before);
  const isEligible = isOverdueWorkShape(input.after);
  const sameEpisode = input.before !== null &&
    input.before.dueDate === input.after.dueDate;
  if (wasEligible === isEligible && (!isEligible || sameEpisode)) return;
  const ref = receivableOverdueQueueRef(input.workspaceId, input.receivableId);
  if (!isEligible) {
    transaction.delete(ref);
    return;
  }
  transaction.set(ref, {
    schemaVersion: RECEIVABLE_OVERDUE_WORK_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    receivableId: input.receivableId,
    dueDate: input.after.dueDate,
    runAfterDay: dueQueueDay(input.after.dueDate, input.today),
    attempts: 0,
    lastErrorCode: null,
    lastAttemptAt: null,
    updatedAt: FieldValue.serverTimestamp(),
  });
};
