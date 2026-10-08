import type * as admin from "firebase-admin";
import type {Timestamp} from "firebase-admin/firestore";

import {compareCommitTimes} from "../cash/periods";
import {parseIsoInstant} from "../shared/commitTime";
import {saoPauloDayKey} from "../shared/dateKeys";
import {ApplicationError} from "../shared/errors";
import type {ActorIdempotencyReservation} from "../shared/idempotency";
import {reserveRateLimit, type RateLimitPolicy} from "../shared/rateLimit";
import type {WorkspaceActor, WorkspaceRole} from "../shared/workspaceAuth";
import {
  recurringEventRef,
  type RecurringEventOperation,
} from "./model";

/**
 * Regras comuns às operações de Recorrentes (P4-B).
 *
 * - owner e admin: criam e administram qualquer recorrência;
 * - member: cria; administra (edita, pausa, retoma, cancela, confirma,
 *   ignora e tenta de novo) só as que criou (`createdBy`, gravado pelo
 *   backend);
 * - viewer: só lê (as Rules liberam a leitura a todo membro ativo).
 *
 * O papel é relido dentro da transação de cada operação; conta suspensa,
 * membership removido e workspace arquivado são recusados pela releitura.
 */
export const RECURRING_ROLES: readonly WorkspaceRole[] =
  ["owner", "admin", "member"];

/**
 * Limite operacional das callables (não é quota comercial: Recorrentes não
 * consome `transactionsPerMonth`, D-40). Replay, recusa e falha antes do
 * commit não consomem.
 */
export const RECURRING_MUTATION_RATE_LIMIT: RateLimitPolicy = {
  operation: "recurringMutation",
  limit: 120,
  windowSeconds: 10 * 60,
};

export const IDEMPOTENCY_CONFLICT_MESSAGE =
  "Esta chave de idempotência já foi usada com outros dados.";
export const INTERNAL_MESSAGE =
  "Não foi possível concluir a operação. Tente novamente.";
export const RECURRING_NOT_FOUND_MESSAGE = "Despesa recorrente não encontrada.";
export const RECURRING_INCONSISTENT_MESSAGE =
  "Esta despesa recorrente tem dados inconsistentes e não pode ser alterada.";
export const RECURRING_CONFLICT_MESSAGE =
  "A despesa recorrente foi alterada por outra pessoa. Recarregue e tente " +
  "novamente.";
export const MEMBER_OWNERSHIP_MESSAGE =
  "Membros só podem administrar as despesas recorrentes que criaram.";
export const OCCURRENCE_NOT_FOUND_MESSAGE = "Ocorrência não encontrada.";
export const OCCURRENCE_INCONSISTENT_MESSAGE =
  "Esta ocorrência tem dados inconsistentes e não pode ser alterada.";

/** Relógio e ponto de falha injetáveis, só para os testes. */
export interface RecurringOperationOptions {
  now?: () => number;
  /** Com todas as escritas enfileiradas, antes do commit. */
  beforeCommit?: () => void;
}

export const todayOf = (options: RecurringOperationOptions): string =>
  saoPauloDayKey(new Date((options.now ?? Date.now)()));

export const assertVersion = (
  current: Timestamp,
  expected: string,
  message: string,
): void => {
  if (compareCommitTimes(current, parseIsoInstant(expected)) !== 0) {
    throw new ApplicationError("concurrent_update", message);
  }
};

/** `member` só administra o que criou; owner e admin, tudo. */
export const assertCanManage = (
  role: WorkspaceRole,
  actor: WorkspaceActor,
  createdBy: string,
): void => {
  if (role === "member" && createdBy !== actor.uid) {
    throw new ApplicationError("permission_denied", MEMBER_OWNERSHIP_MESSAGE);
  }
};

export const reserveRecurringRateLimit = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
) => reserveRateLimit(transaction, actor.workspaceId, actor.uid,
  RECURRING_MUTATION_RATE_LIMIT);

/**
 * Âncora durável de uma intenção: o evento da operação no ID
 * determinístico `(operação, intenção)`, lido diretamente na transação.
 * Depois que o recibo temporário da chave expira, é ele que transforma a
 * repetição em replay (mesmo conteúdo) ou em conflito (outro conteúdo).
 */
export const readIntentAnchor = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  operation: RecurringEventOperation,
  intentId: string,
  reservation: ActorIdempotencyReservation,
): Promise<{replayed: true; recurringExpenseId: string;
  occurrenceId: string | null} | null> => {
  const snapshot = await transaction.get(
    recurringEventRef(workspaceId, operation, intentId));
  if (!snapshot.exists) return null;
  if (snapshot.get("requestHash") !== reservation.requestHash) {
    throw new ApplicationError("idempotency_conflict",
      IDEMPOTENCY_CONFLICT_MESSAGE);
  }
  return {
    replayed: true,
    recurringExpenseId: String(snapshot.get("recurringExpenseId")),
    occurrenceId: (snapshot.get("occurrenceId") as string | null) ?? null,
  };
};
