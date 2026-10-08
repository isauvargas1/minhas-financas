import * as admin from "firebase-admin";
import type {Timestamp} from "firebase-admin/firestore";

import {compareCommitTimes} from "../cash/periods";
import {parseIsoInstant} from "../shared/commitTime";
import {saoPauloDayKey} from "../shared/dateKeys";
import {ApplicationError} from "../shared/errors";
import type {RateLimitPolicy} from "../shared/rateLimit";
import type {WorkspaceRole} from "../shared/workspaceAuth";

/**
 * Regras comuns às operações de clientes e recebíveis (P3-I).
 *
 * - Cadastro mestre do cliente (D-24): só owner e admin criam, editam e
 *   arquivam; member e viewer só leem o documento compartilhado.
 * - Recebíveis: owner e admin administram todos; member cria e administra só
 *   os que criou (`createdBy`, gravado pelo backend); viewer só lê.
 * - O módulo existe só em espaço PJ (a interface só o oferece em PJ; o tipo
 *   vem do workspace persistido, não do cliente).
 */
export const CLIENT_ADMIN_ROLES: readonly WorkspaceRole[] = ["owner", "admin"];
export const RECEIVABLE_ROLES: readonly WorkspaceRole[] =
  ["owner", "admin", "member"];

/**
 * Limites operacionais (não são quota comercial: o catálogo não define quota
 * de clientes nem de recebíveis). Replay, recusa e falha antes do commit não
 * consomem.
 */
export const CLIENT_MUTATION_RATE_LIMIT: RateLimitPolicy = {
  operation: "clientMutation",
  limit: 60,
  windowSeconds: 10 * 60,
};
export const RECEIVABLE_MUTATION_RATE_LIMIT: RateLimitPolicy = {
  operation: "receivableMutation",
  limit: 60,
  windowSeconds: 10 * 60,
};

export const IDEMPOTENCY_CONFLICT_MESSAGE =
  "Esta chave de idempotência já foi usada com outros dados.";
export const PJ_ONLY_MESSAGE =
  "Clientes e recebíveis estão disponíveis só em espaço PJ.";
export const INTERNAL_MESSAGE =
  "Não foi possível concluir a operação. Tente novamente.";

/** Relógio e ponto de falha injetáveis, só para os testes. */
export interface OperationOptions {
  now?: () => number;
  /** Com todas as escritas enfileiradas, antes do commit. */
  beforeCommit?: () => void;
}

export const todayOf = (options: OperationOptions): string =>
  saoPauloDayKey(new Date((options.now ?? Date.now)()));

export const assertPjWorkspace = (
  workspace: admin.firestore.DocumentData,
): void => {
  if (workspace.type !== "PJ") {
    throw new ApplicationError("domain_precondition_failed", PJ_ONLY_MESSAGE);
  }
};

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
export const findIntentAnchor = async (
  transaction: admin.firestore.Transaction,
  collection: string,
  intentId: string,
  operation: string,
): Promise<admin.firestore.QueryDocumentSnapshot | undefined> => {
  const anchors = await transaction.get(
    admin.firestore().collectionGroup(collection)
      .where("intentId", "==", intentId)
      .where("operation", "==", operation)
      .limit(1),
  );
  return anchors.docs[0];
};
