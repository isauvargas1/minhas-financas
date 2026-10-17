import type {DocumentData, Timestamp} from "firebase-admin/firestore";
import {onDocumentWritten} from "firebase-functions/v2/firestore";

import {readAuthoritativeLoan} from "../../loans/model";
import {addDaysToDayKey, isDayKey} from "../../shared/dateKeys";
import {createOperationLogger, type OperationLogger} from "../../shared/logger";
import {NOTIFICATION_TRIGGER_OPTIONS} from "../../shared/runtimeOptions";
import type {NotificationInput} from "../contract";
import {notificationIdFor} from "../ids";
import {dayLabel, publishProduced, saoPauloDayOf} from "./common";

/**
 * Produtor `loan_overdue` (P5-D2).
 *
 * - Emissão: escrita em `loans` em que o contrato passa a `overdue` (antes
 *   ausente ou com outro status) e o documento depois da escrita está no
 *   schema autoritativo, com `overdueFrom` válido.
 * - Reentrega não duplica: o ID é determinístico (empréstimo + `overdueFrom`)
 *   e `createdAt` é o instante do commit, então a mesma entrega gera o mesmo
 *   documento; `create` com ALREADY_EXISTS é sucesso.
 * - Sem reemissão depois do TTL: só a transição emite. A reentrega do
 *   Eventarc dura no máximo 24 h e o estado autoritativo não expira; depois
 *   dos 180 dias, só uma nova transição (voltar a `active` e atrasar de novo)
 *   emite, e isso é um fato novo.
 * - Sem ciclo: `notifications` não tem gatilho e nada é gravado no domínio.
 */
export const LOAN_NOTIFICATION_OPERATION = "onLoanWriteNotification";

export interface LoanNotificationInput {
  workspaceId: string;
  loanId: string;
  before: DocumentData | undefined;
  after: DocumentData | undefined;
  commitTime: Timestamp;
  /** Registra o documento fora do schema (só identificadores). */
  log?: OperationLogger;
}

export const loanOverdueNotification = (
  input: LoanNotificationInput,
): NotificationInput | null => {
  const {workspaceId, loanId, before, after, commitTime, log} = input;
  if (!after || after.status !== "overdue") return null;
  if (before && before.status === "overdue") return null;
  const loan = readAuthoritativeLoan(loanId, after, workspaceId);
  if (!loan || !isDayKey(loan.overdueFrom)) {
    log?.warn("loan_notification_schema_invalid", {workspaceId, loanId});
    return null;
  }
  const today = saoPauloDayOf(commitTime);
  // `overdueFrom` é o primeiro dia em atraso; o vencimento é o dia anterior.
  const dueDay = dayLabel(addDaysToDayKey(loan.overdueFrom, -1));
  const borrow = loan.type === "borrow";
  return {
    id: notificationIdFor({
      workspaceId,
      domain: "loan",
      entityId: loanId,
      eventType: "loan_overdue",
      episode: loan.overdueFrom,
    }),
    workspaceId,
    eventType: "loan_overdue",
    title: borrow ?
      "Empréstimo a pagar em atraso" :
      "Empréstimo a receber em atraso",
    message: `Foi identificado atraso em ${dayLabel(today)} em um ` +
      `empréstimo ${borrow ? "a pagar" : "a receber"}: a parcela com ` +
      `vencimento em ${dueDay} não estava quitada.`,
    type: "warning",
    link: "loans",
    createdAtMs: commitTime.toMillis(),
    entity: {loanId},
  };
};

/** Exportada para que os testes de integração chamem sem o Eventarc. */
export const handleLoanNotificationWrite = async (
  input: Omit<LoanNotificationInput, "log"> & {eventId?: string},
): Promise<void> => {
  const {eventId, ...fact} = input;
  const log = createOperationLogger({
    operation: LOAN_NOTIFICATION_OPERATION,
    // `event.id` do Eventarc (OBSERVABILITY §4): o mesmo em cada
    // reentrega do fato.
    sourceEventId: eventId,
    workspaceId: fact.workspaceId,
    loanId: fact.loanId,
  });
  await publishProduced(() => loanOverdueNotification({...fact, log}), log);
};

export const onLoanWriteNotification = onDocumentWritten(
  {
    ...NOTIFICATION_TRIGGER_OPTIONS,
    document: "workspaces/{workspaceId}/loans/{loanId}",
  },
  async (event) => {
    if (!event.data) return;
    const {workspaceId, loanId} = event.params;
    const {before, after} = event.data;
    // Exclusão não gera fato; sem `updateTime` não há instante de commit.
    if (!after.exists || !after.updateTime) return;
    await handleLoanNotificationWrite({
      eventId: event.id,
      workspaceId,
      loanId,
      before: before.exists ? before.data() : undefined,
      after: after.data(),
      commitTime: after.updateTime,
    });
  },
);
