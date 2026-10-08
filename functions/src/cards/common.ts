import * as admin from "firebase-admin";
import type {Timestamp} from "firebase-admin/firestore";

import {compareCommitTimes} from "../cash/periods";
import {parseIsoInstant} from "../shared/commitTime";
import {saoPauloDayKey} from "../shared/dateKeys";
import {ApplicationError} from "../shared/errors";
import {
  reserveRateLimit,
  type RateLimitPolicy,
} from "../shared/rateLimit";
import type {WorkspaceActor, WorkspaceRole} from "../shared/workspaceAuth";
import {CARD_EVENTS_COLLECTION, type CardEventOperation} from "./model";

/**
 * Regras comuns às operações de cartões (P4-A).
 *
 * - Cadastro, ciclo de vida do cartão, cancelamento, estorno de compra,
 *   ajuste, pagamento e estorno de pagamento: owner e admin.
 * - Compra manual: owner, admin e member; member edita só as compras que
 *   criou (`createdBy`, gravado pelo backend).
 * - Viewer só lê (as Rules liberam a leitura a todo membro ativo).
 * - Reconciliação: owner e admin.
 */
export const CARD_ADMIN_ROLES: readonly WorkspaceRole[] = ["owner", "admin"];
export const CARD_PURCHASE_ROLES: readonly WorkspaceRole[] =
  ["owner", "admin", "member"];

/**
 * Limites operacionais (não são quota comercial: compras de cartão não
 * consomem `transactionsPerMonth`, D-40). Replay, recusa e falha antes do
 * commit não consomem.
 */
export const CARD_MUTATION_RATE_LIMIT: RateLimitPolicy = {
  operation: "creditCardMutation",
  limit: 120,
  windowSeconds: 10 * 60,
};
export const CARD_RECONCILIATION_RATE_LIMIT: RateLimitPolicy = {
  operation: "creditCardReconciliation",
  limit: 30,
  windowSeconds: 10 * 60,
};

export const IDEMPOTENCY_CONFLICT_MESSAGE =
  "Esta chave de idempotência já foi usada com outros dados.";
export const INTERNAL_MESSAGE =
  "Não foi possível concluir a operação. Tente novamente.";
export const CARD_NOT_FOUND_MESSAGE = "Cartão não encontrado.";
export const CARD_INCONSISTENT_MESSAGE =
  "Este cartão tem dados inconsistentes e não pode ser alterado.";
export const CARD_CONFLICT_MESSAGE =
  "O cartão foi alterado por outra pessoa. Recarregue e tente novamente.";
export const CARD_ARCHIVED_MESSAGE =
  "Este cartão está arquivado e não aceita novas compras nem ajustes. " +
  "Reative-o para voltar a usá-lo.";
export const PURCHASE_NOT_FOUND_MESSAGE = "Compra não encontrada.";
export const PURCHASE_INCONSISTENT_MESSAGE =
  "Esta compra tem dados inconsistentes e não pode ser alterada.";
export const PURCHASE_CONFLICT_MESSAGE =
  "A compra foi alterada por outra pessoa. Recarregue e tente novamente.";
export const INVOICE_NOT_FOUND_MESSAGE = "Fatura não encontrada.";
export const INVOICE_INCONSISTENT_MESSAGE =
  "Esta fatura tem dados inconsistentes e não pode ser alterada.";
export const INVOICE_CONFLICT_MESSAGE =
  "A fatura mudou desde que você a abriu. Confira os valores e tente " +
  "novamente.";
export const LIMIT_INSUFFICIENT_MESSAGE =
  "Limite disponível insuficiente para esta operação.";
export const PURCHASE_LIMIT_INSUFFICIENT_MESSAGE =
  "Limite disponível insuficiente para esta compra.";

/** Relógio e ponto de falha injetáveis, só para os testes. */
export interface CardOperationOptions {
  now?: () => number;
  /** Com todas as escritas enfileiradas, antes do commit. */
  beforeCommit?: () => void;
}

export const todayOf = (options: CardOperationOptions): string =>
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

/**
 * Âncora durável da intenção: o evento da operação com o mesmo `intentId`,
 * em qualquer workspace (consulta de grupo com `limit(1)`). Depois que o
 * recibo temporário da chave expira, é ele que transforma a repetição em
 * replay — ou em conflito, quando a mesma chave aparece com outro conteúdo.
 */
export const findCardIntentAnchor = async (
  transaction: admin.firestore.Transaction,
  intentId: string,
  operation: CardEventOperation,
): Promise<admin.firestore.QueryDocumentSnapshot | undefined> => {
  const anchors = await transaction.get(
    admin.firestore().collectionGroup(CARD_EVENTS_COLLECTION)
      .where("intentId", "==", intentId)
      .where("operation", "==", operation)
      .limit(1),
  );
  return anchors.docs[0];
};

export const reserveCardRateLimit = (
  transaction: admin.firestore.Transaction,
  actor: WorkspaceActor,
  policy: RateLimitPolicy = CARD_MUTATION_RATE_LIMIT,
) => reserveRateLimit(transaction, actor.workspaceId, actor.uid, policy);

/** Profile do workspace para o espelho de caixa. */
export const profileTypeOf = (
  workspace: admin.firestore.DocumentData,
): "PF" | "PJ" => (workspace.type === "PJ" ? "PJ" : "PF");

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

/** Valor em reais só para mensagens ao usuário (a autoridade é o centavo). */
export const formatBrl = (cents: number): string => BRL.format(cents / 100);
