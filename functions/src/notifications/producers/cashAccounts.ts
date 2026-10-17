import type {DocumentData, Timestamp} from "firebase-admin/firestore";
import {onDocumentWritten} from "firebase-functions/v2/firestore";

import {readAuthoritativeCashAccount} from "../../accounts/model";
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
 * Produtor `cash_account_negative_balance` (P5-D2).
 *
 * - Emissão: escrita em `cash_accounts` em que o saldo vai de >= 0 para < 0,
 *   com antes e depois no schema autoritativo. A criação (sem antes) nunca
 *   emite: uma conta nascida negativa não passou de não negativa a negativa.
 *   Continuar negativo (−1 → −5) não emite.
 * - Reentrega não duplica: o episódio é o instante exato do commit que
 *   tornou o saldo negativo (`updateTime`), logo o ID é determinístico, e
 *   `createdAt` é esse mesmo instante; ALREADY_EXISTS é sucesso.
 * - Sem reemissão depois do TTL: só a transição emite. A reentrega do
 *   Eventarc dura no máximo 24 h e o estado autoritativo não expira; depois
 *   dos 180 dias, só uma nova transição (voltar a >= 0 e negativar de novo)
 *   emite, e isso é um fato novo, com outro episódio.
 * - Sem ciclo: `notifications` não tem gatilho e nada é gravado no domínio.
 */
export const CASH_ACCOUNT_NOTIFICATION_OPERATION =
  "onCashAccountWriteNotification";

export interface CashAccountNotificationInput {
  workspaceId: string;
  accountId: string;
  before: DocumentData | undefined;
  after: DocumentData | undefined;
  commitTime: Timestamp;
  /** Registra o documento fora do schema (só identificadores). */
  log?: OperationLogger;
}

const isCrossing = (
  before: DocumentData | undefined,
  after: DocumentData | undefined,
): boolean =>
  Boolean(before && after) &&
  typeof before?.balanceCents === "number" && before.balanceCents >= 0 &&
  typeof after?.balanceCents === "number" && after.balanceCents < 0;

export const cashAccountNegativeBalanceNotification = (
  input: CashAccountNotificationInput,
): NotificationInput | null => {
  const {workspaceId, accountId, before, after, commitTime, log} = input;
  if (!isCrossing(before, after)) return null;
  const previous = readAuthoritativeCashAccount(accountId, before, workspaceId);
  const current = readAuthoritativeCashAccount(accountId, after, workspaceId);
  if (!previous || !current ||
    previous.balanceCents < 0 || current.balanceCents >= 0) {
    log?.warn("cash_account_notification_schema_invalid",
      {workspaceId, accountId});
    return null;
  }
  return {
    id: notificationIdFor({
      workspaceId,
      domain: "cash_account",
      entityId: accountId,
      eventType: "cash_account_negative_balance",
      episode: timestampEpisode(commitTime),
    }),
    workspaceId,
    eventType: "cash_account_negative_balance",
    title: "Saldo negativo em conta",
    message: "Uma conta ficou com saldo negativo em " +
      `${dayLabel(saoPauloDayOf(commitTime))}. Confira em Configurações, ` +
      "em Contas e carteiras.",
    type: "warning",
    link: "settings",
    createdAtMs: commitTime.toMillis(),
    entity: {accountId},
  };
};

/** Exportada para que os testes de integração chamem sem o Eventarc. */
export const handleCashAccountNotificationWrite = async (
  input: Omit<CashAccountNotificationInput, "log"> & {eventId?: string},
): Promise<void> => {
  const {eventId, ...fact} = input;
  const log = createOperationLogger({
    operation: CASH_ACCOUNT_NOTIFICATION_OPERATION,
    // `event.id` do Eventarc (OBSERVABILITY §4): o mesmo em cada
    // reentrega do fato.
    sourceEventId: eventId,
    workspaceId: fact.workspaceId,
    accountId: fact.accountId,
  });
  await publishProduced(
    () => cashAccountNegativeBalanceNotification({...fact, log}), log);
};

export const onCashAccountWriteNotification = onDocumentWritten(
  {
    ...NOTIFICATION_TRIGGER_OPTIONS,
    document: "workspaces/{workspaceId}/cash_accounts/{accountId}",
  },
  async (event) => {
    if (!event.data) return;
    const {workspaceId, accountId} = event.params;
    const {before, after} = event.data;
    // Criação e exclusão nunca são a transição; sem `updateTime` não há
    // instante de commit.
    if (!before.exists || !after.exists || !after.updateTime) return;
    await handleCashAccountNotificationWrite({
      eventId: event.id,
      workspaceId,
      accountId,
      before: before.data(),
      after: after.data(),
      commitTime: after.updateTime,
    });
  },
);
