import type * as admin from "firebase-admin";
import {FieldValue, type Timestamp} from "firebase-admin/firestore";

import {
  assertActiveAccount,
  postAccountMovements,
  readPostedMovement,
  readPostingAccounts,
  reversalOfMovement,
  type PostingAccounts,
} from "../accounts/ledger";
import {
  investmentAccountMovementIdFor,
  type AuthoritativeCashAccountMovement,
} from "../accounts/model";
import {saoPauloDayKey} from "../shared/dateKeys";
import {ApplicationError} from "../shared/errors";
import {MONEY_CURRENCY} from "../shared/money";
import type {WorkspaceActor} from "../shared/workspaceAuth";
import {
  INVESTMENT_CASH_ENTRY_VERSION,
  investmentCashEffect,
  type InvestmentCashEntry,
  type InvestmentCashOperation,
  type InvestmentCashStatus,
} from "./cashEffect";
import {investmentTransactionDoc} from "./paths";

/**
 * Efeito de caixa dos movimentos de investimento (D-15, D-30, P4-D).
 *
 * Todo fato liquidado com dinheiro — aporte depositado, retirada recebida e o
 * estorno de um deles — grava, no **mesmo commit** do movimento, da posição,
 * das projeções, da auditoria e da idempotência:
 *
 * 1. o movimento na conta do Caixa (`cash_account_movements`, kind e domínio
 *    `investment`) e o saldo novo da conta, pelo livro-razão da P3-J;
 * 2. o espelho de caixa em `transactions/investment_{movementId}`, com a
 *    marca backend-only `investmentEntry` e o mesmo efeito líquido do
 *    movimento de conta.
 *
 * Pendente e cancelado não movem conta: o espelho existe (para a listagem do
 * Caixa) com efeito zero. O estorno compensa na conta do movimento original,
 * nunca em outra. O espelho é só caixa: patrimônio, meta e resultado vivem
 * em `investment_movements`, `investment_positions` e nas projeções.
 */
export const INVESTMENT_CASH_SOURCE = "investment";

export const INVESTMENT_CASH_INCONSISTENT_MESSAGE =
  "O lançamento de caixa deste investimento está inconsistente.";

/** Dia efetivo do fato: liquidação, ou o registro quando não há. */
export const investmentCashDate = (movement: {
  occurredAt: Timestamp;
  settlementAt?: Timestamp;
}): string => saoPauloDayKey(
  (movement.settlementAt ?? movement.occurredAt).toDate());

/** Fase de leitura do fato novo: a conta existe no workspace e está ativa. */
export const prepareInvestmentCashAccount = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  cashAccountId: string,
): Promise<PostingAccounts> => {
  const accounts = await readPostingAccounts(transaction, workspaceId,
    [cashAccountId]);
  const account = accounts.get(cashAccountId);
  if (!account) {
    throw new ApplicationError("internal",
      INVESTMENT_CASH_INCONSISTENT_MESSAGE);
  }
  assertActiveAccount(account);
  return accounts;
};

/**
 * Fase de escrita do fato liquidado: o movimento na conta, com o efeito
 * líquido do fato (aporte sai, retirada entra). Devolve o ID determinístico
 * do movimento de conta — um por movimento de investimento.
 */
export const postInvestmentAccountMovement = (
  transaction: admin.firestore.Transaction,
  accounts: PostingAccounts,
  input: {
    workspaceId: string;
    actorUid: string;
    operation: string;
    requestId: string;
    investmentMovementId: string;
    cashAccountId: string;
    /** Centavos com sinal: entrada positiva, saída negativa. */
    amountCents: number;
    effectiveDate: string;
  },
): string => {
  const accountMovementId = investmentAccountMovementIdFor(
    input.investmentMovementId);
  postAccountMovements(transaction, accounts, [{
    id: accountMovementId,
    accountId: input.cashAccountId,
    kind: "investment",
    amountCents: input.amountCents,
    effectiveDate: input.effectiveDate,
    sourceDomain: "investment",
    sourceId: input.investmentMovementId,
    sourceFactId: input.investmentMovementId,
    reversalOf: null,
  }], {
    workspaceId: input.workspaceId,
    actorUid: input.actorUid,
    operation: input.operation,
    requestId: input.requestId,
  });
  return accountMovementId;
};

export interface PreparedInvestmentReversalAccount {
  movement: AuthoritativeCashAccountMovement;
  accounts: PostingAccounts;
}

/**
 * Fase de leitura do estorno: relê o movimento de conta que o fato original
 * aplicou. Precisa existir, ser da conta e do movimento do original e ter
 * exatamente o efeito de caixa dele — senão a compensação não seria exata.
 */
export const prepareInvestmentReversalAccount = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  original: admin.firestore.DocumentData,
): Promise<PreparedInvestmentReversalAccount> => {
  const cashAccountId = original.cashAccountId;
  const accountMovementId = original.accountMovementId;
  if (
    typeof cashAccountId !== "string" || cashAccountId.length === 0 ||
    accountMovementId !== investmentAccountMovementIdFor(String(original.id))
  ) {
    throw new ApplicationError("internal",
      INVESTMENT_CASH_INCONSISTENT_MESSAGE);
  }
  const movement = await readPostedMovement(transaction, workspaceId,
    accountMovementId, {accountId: cashAccountId, sourceId: String(original.id)});
  if (
    movement.sourceDomain !== "investment" ||
    movement.amountCents !== original.cashDeltaCents
  ) {
    throw new ApplicationError("internal",
      INVESTMENT_CASH_INCONSISTENT_MESSAGE);
  }
  const accounts = await readPostingAccounts(transaction, workspaceId,
    [cashAccountId]);
  return {movement, accounts};
};

/**
 * Fase de escrita do estorno: compensação exata na mesma conta, datada no dia
 * do estorno — o mesmo dia do espelho compensatório e do período patrimonial
 * em que o estorno é reconhecido.
 */
export const postInvestmentReversalAccountMovement = (
  transaction: admin.firestore.Transaction,
  prepared: PreparedInvestmentReversalAccount,
  input: {
    workspaceId: string;
    actorUid: string;
    operation: string;
    requestId: string;
    reversalMovementId: string;
    effectiveDate: string;
  },
): string => {
  const accountMovementId = investmentAccountMovementIdFor(
    input.reversalMovementId);
  postAccountMovements(transaction, prepared.accounts, [{
    ...reversalOfMovement(prepared.movement, accountMovementId,
      input.reversalMovementId),
    effectiveDate: input.effectiveDate,
  }], {
    workspaceId: input.workspaceId,
    actorUid: input.actorUid,
    operation: input.operation,
    requestId: input.requestId,
  });
  return accountMovementId;
};

/** Marca do espelho a partir do movimento do domínio. */
export const investmentCashEntryFor = (
  movement: admin.firestore.DocumentData,
  input: {
    operation: InvestmentCashOperation;
    status: InvestmentCashStatus;
  },
): InvestmentCashEntry => {
  const principalCents = Number(movement.principalCents);
  const gainCents = input.operation === "redemption" ?
    Number(movement.gainCents ?? 0) : 0;
  const reversal = movement.operation === "reversal";
  return {
    domainVersion: INVESTMENT_CASH_ENTRY_VERSION,
    movementId: String(movement.id),
    operation: input.operation,
    reversal,
    reversalOf: reversal ? String(movement.reversedMovementId) : null,
    status: input.status,
    principalCents,
    gainCents,
    amountCents: principalCents + gainCents,
    currency: MONEY_CURRENCY,
  };
};

/**
 * Grava o espelho de caixa do movimento.
 *
 * Substituição integral, sem `merge` (INV-P2-051): o identificador é
 * determinístico e a escrita termina sempre na forma autoritativa — nenhum
 * campo de uma gravação anterior sobrevive. O efeito líquido do espelho é o
 * `cashDeltaCents` do movimento, igual ao movimento de conta.
 */
export const writeInvestmentCashMirror = (
  transaction: admin.firestore.Transaction,
  auth: WorkspaceActor,
  profileType: "PF" | "PJ",
  movement: admin.firestore.DocumentData,
  entry: InvestmentCashEntry,
  account: {cashAccountId: string; accountMovementId: string} | null,
): void => {
  const occurredAt = movement.occurredAt as Timestamp;
  const settlementAt = movement.settlementAt as Timestamp | undefined;
  const settled = entry.status === "settled";
  // Liquidado ⇔ conta; e o efeito líquido do espelho é exatamente o efeito
  // de caixa do movimento — o mesmo valor lançado na conta.
  if (
    settled !== (account !== null) ||
    investmentCashEffect(entry).netCents !==
      (settled ? movement.cashDeltaCents : 0)
  ) {
    throw new ApplicationError("internal",
      INVESTMENT_CASH_INCONSISTENT_MESSAGE);
  }
  transaction.set(
    investmentTransactionDoc(auth.workspaceId, String(movement.transactionId)),
    {
      type: "investimento",
      description: movement.description,
      category: "Investimentos",
      // Apresentação: a autoridade é `valueCents` e a marca.
      value: entry.amountCents / 100,
      valueCents: entry.amountCents,
      date: investmentCashDate({occurredAt, settlementAt}),
      transactionDate: settlementAt ?? occurredAt,
      isPaid: settled,
      workspaceId: auth.workspaceId,
      profileId: auth.workspaceId,
      profileType,
      userId: auth.uid,
      source: INVESTMENT_CASH_SOURCE,
      investmentEntry: entry,
      ...(account ? account : {}),
      createdBy: movement.createdBy,
      createdAt: movement.createdAt,
      updatedBy: auth.uid,
      updatedAt: FieldValue.serverTimestamp(),
    },
  );
};
