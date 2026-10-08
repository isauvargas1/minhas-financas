import * as admin from "firebase-admin";

import {
  DEFAULT_CASH_ACCOUNT_NAME,
  accountIntentIdFor,
  appendCashAccountEvent,
  cashAccountDocument,
  cashAccountsRef,
  defaultCashAccountIdFor,
} from "../accounts/model";
import {writeCatalogDefaults} from "../settingsCatalog/seeds";
import {sha256} from "../shared/hashing";

/**
 * Provisionamento de workspace novo (P1, PR-AUTH-03).
 *
 * `bootstrapAccount` e `createWorkspace` chamam `provisionWorkspaceDefaults`
 * **na mesma transação** que cria o workspace, o membership owner, o índice e
 * a auditoria. O workspace sai do backend já com os cadastros padrão; nada
 * depende de o cliente abrir, selecionar ou "preparar" o espaço depois.
 *
 * - Atomicidade: ou o workspace existe com todos os padrões, ou nada foi
 *   gravado. Uma falha de provisionamento aborta a criação e a callable
 *   responde com erro — nunca com sucesso parcial.
 * - Retry e concorrência: herdados da transação de criação. `createWorkspace`
 *   devolve o resultado salvo pela idempotência; `bootstrapAccount` disputa
 *   `users/{uid}` e a perdedora encontra o workspace já criado.
 * - Sem leituras: o ID do workspace acabou de ser gerado. Todas as escritas
 *   são `transaction.create`; uma colisão aborta em vez de sobrescrever.
 *
 * Volume: no pior caso (PJ) são 28 itens de catálogo e 28 reservas de nome
 * (`settingsCatalog/seeds.ts`, D-23), mais a conta padrão e a sua auditoria —
 * cerca de 70 escritas com as da criação, abaixo do limite de 500 por
 * transação.
 */

type WorkspaceType = "PF" | "PJ";

export interface WorkspaceProvisioningSummary {
  catalogItemCount: number;
  cashAccountId: string;
}

/**
 * Conta/carteira padrão (D-30, P3-J): "Carteira principal", tipo dinheiro,
 * saldo zero, sem movimento. O workspace nasce pronto para o primeiro
 * lançamento; owner e admin criam outras contas em Configurações › Contas e
 * carteiras. Auditada como criação pelo dono do workspace.
 */
export const writeDefaultCashAccount = (
  transaction: admin.firestore.Transaction,
  input: {workspaceId: string; uid: string},
): string => {
  const accountId = defaultCashAccountIdFor(input.workspaceId);
  transaction.create(cashAccountsRef(input.workspaceId).doc(accountId),
    cashAccountDocument({
      id: accountId,
      workspaceId: input.workspaceId,
      name: DEFAULT_CASH_ACCOUNT_NAME,
      accountType: "cash",
      actorUid: input.uid,
    }));
  const provisioningKey = `provisioning:${input.workspaceId}`;
  appendCashAccountEvent(transaction, {
    workspaceId: input.workspaceId,
    operation: "cash_account.created",
    targetKey: accountId,
    accountId,
    transferId: null,
    actorId: input.uid,
    actorRole: "owner",
    intentId: accountIntentIdFor(input.uid, provisioningKey),
    requestHash: sha256(provisioningKey),
    requestId: provisioningKey,
    correlationId: null,
    before: null,
    after: {accountType: "cash", status: "active", balanceCents: 0,
      openingBalanceCents: 0},
    changedFields: ["name", "accountType"],
    reason: null,
  });
  return accountId;
};

/** Grava os padrões obrigatórios de um workspace recém-criado. */
export const provisionWorkspaceDefaults = (
  transaction: admin.firestore.Transaction,
  input: {workspaceId: string; type: WorkspaceType; uid: string},
): WorkspaceProvisioningSummary => {
  const catalogItemCount = writeCatalogDefaults(transaction, input);
  const cashAccountId = writeDefaultCashAccount(transaction, input);
  return {catalogItemCount, cashAccountId};
};
