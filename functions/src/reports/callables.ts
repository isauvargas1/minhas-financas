import * as admin from "firebase-admin";

import {defineCallable} from "../shared/callable";
import {reserveRateLimit, type RateLimitPolicy} from "../shared/rateLimit";
import {REPORT_CALLABLE_OPTIONS} from "../shared/runtimeOptions";
import {
  reassertWorkspaceActor,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import {
  getFinancialReportPayloadSchema,
  type FinancialReport,
} from "./contract";
import {REPORT_READER_ROLES, executeGetFinancialReport} from "./report";

/**
 * `getFinancialReport` (P5-C1): relatório financeiro autoritativo do
 * Dashboard e dos Relatórios.
 *
 * Autorização em duas etapas, como as demais leituras do kernel: a
 * pré-checagem do kernel (conta ativa, workspace ativo, membership real e
 * papel resolvido no servidor — nunca o papel informado pelo cliente) e a
 * releitura do ator na transação que consome o limite de frequência, para
 * que quem foi removido ou suspenso entre as duas não leia. Somente leitura:
 * a única escrita é o contador de frequência.
 */
export const FINANCIAL_REPORT_RATE_LIMIT: RateLimitPolicy = {
  operation: "getFinancialReport",
  limit: 300,
  windowSeconds: 60 * 60,
};

const requireActor = (actor: WorkspaceActor | null): WorkspaceActor => {
  if (!actor) throw new Error("financial_report_without_actor");
  return actor;
};

export const getFinancialReport = defineCallable({
  operation: "getFinancialReport",
  schema: getFinancialReportPayloadSchema,
  runtime: REPORT_CALLABLE_OPTIONS,
  workspaceRoles: REPORT_READER_ROLES,
  handler: async ({
    actor: resolved,
    payload,
    log,
    trustWorkspace,
  }): Promise<FinancialReport> => {
    const actor = requireActor(resolved);
    const current = await admin.firestore().runTransaction(
      async (transaction) => {
        const reassert = await reassertWorkspaceActor(
          transaction, actor, REPORT_READER_ROLES);
        const reservation = await reserveRateLimit(
          transaction, actor.workspaceId, actor.uid,
          FINANCIAL_REPORT_RATE_LIMIT);
        reservation.commit();
        return reassert.role;
      },
    );
    // O papel relido decide o que o relatório entrega (ex.: investimentos)
    // e é o que fica no log da chamada.
    trustWorkspace(actor.workspaceId, current);
    return executeGetFinancialReport({...actor, role: current}, payload,
      new Date(), {log: log.with({actorRole: current})});
  },
});
