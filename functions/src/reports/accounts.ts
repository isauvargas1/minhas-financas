import * as admin from "firebase-admin";
import {AggregateField} from "firebase-admin/firestore";

import {CASH_ACCOUNTS_COLLECTION} from "../accounts/model";
import type {AccountsReport, ReportSectionResult} from "./contract";

/**
 * Saldo Atual (D-37.1): soma de `cash_accounts.balanceCents` de todas as
 * contas do workspace, com o sinal (conta negativa reduz o total). Conta
 * arquivada só existe com saldo zero (D-30), então entrar na soma não muda o
 * total e nada é escondido. Nunca é fluxo do período, limite de cartão,
 * dívida nem patrimônio investido. Duas agregações (`sum`/`count`), que leem
 * entradas de índice — nenhuma conta é lida documento a documento.
 */
export const readAccountsSection = async (
  workspaceId: string,
): Promise<ReportSectionResult<AccountsReport>> => {
  const accounts = admin.firestore()
    .collection(`workspaces/${workspaceId}/${CASH_ACCOUNTS_COLLECTION}`);
  const [all, negative] = await Promise.all([
    accounts.aggregate({
      total: AggregateField.sum("balanceCents"),
      count: AggregateField.count(),
    }).get(),
    accounts.where("balanceCents", "<", 0).count().get(),
  ]);
  const total = Number(all.data().total ?? 0);
  if (!Number.isSafeInteger(total)) {
    return {status: "unavailable", reason: "balance_out_of_range", data: null};
  }
  const data: AccountsReport = {
    totalBalanceCents: total || 0,
    accountCount: all.data().count ?? 0,
    negativeAccountCount: negative.data().count ?? 0,
  };
  return {
    status: data.totalBalanceCents === 0 && data.negativeAccountCount === 0 ?
      "zero" :
      "exact",
    data,
  };
};
