import * as admin from "firebase-admin";

import {CreditCardApplicationError} from "../creditCards/errors";

/**
 * Estado da flag `investmentsV2` a partir do documento do workspace.
 *
 * A flag é a única chave que troca a fonte oficial do patrimônio; não existe
 * período de fonte dupla. Ela é lida do backend, nunca aceita do cliente.
 */
export const investmentsV2Enabled = (
  workspace: admin.firestore.DocumentData | undefined,
): boolean =>
  (workspace?.features as {investmentsV2?: {enabled?: unknown}} | undefined)
    ?.investmentsV2?.enabled === true;

/**
 * Fecha a trilha legada de escrita quando o domínio oficial está ligado.
 *
 * Com a flag ligada, os relatórios leem exclusivamente as projeções
 * (`investment_positions`, `investment_summaries`, `investment_report_periods`)
 * — mas o fluxo de caixa continua somando `transactions`. Um aporte ou resgate
 * gravado pela trilha legada nesse estado sai do caixa e nunca chega ao
 * patrimônio: as duas fontes divergem em silêncio, sem erro para o usuário.
 *
 * Gatear apenas no frontend não basta, porque a callable segue invocável. Esta
 * é a barreira server-side.
 */
export const assertLegacyInvestmentTrailOpen = (
  workspace: admin.firestore.DocumentData | undefined,
): void => {
  if (!investmentsV2Enabled(workspace)) return;
  throw new CreditCardApplicationError(
    "domain_precondition_failed",
    "Este workspace já usa o domínio patrimonial oficial. Registre aportes e " +
      "resgates em Investimentos, não pelo lançamento de transação.",
  );
};
