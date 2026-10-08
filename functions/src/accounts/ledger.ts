import type * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import {
  CASH_ACCOUNT_BALANCE_LIMIT_CENTS,
  cashAccountMovementDocument,
  cashAccountMovementsRef,
  cashAccountsRef,
  readAuthoritativeCashAccount,
  readAuthoritativeCashAccountMovement,
  type AuthoritativeCashAccount,
  type AuthoritativeCashAccountMovement,
  type CashAccountMovementInput,
} from "./model";

/**
 * Lançamento no livro-razão das contas (D-30, P3-J).
 *
 * Todo produtor que move dinheiro de uma conta — lançamento manual,
 * importação, empréstimo, recebível, transferência e o saldo inicial — usa
 * estas duas fases dentro da **própria** transação do Firestore:
 *
 * 1. leitura (`readPostingAccounts`, `readPostedMovement`): relê as contas e,
 *    num estorno, o movimento compensado, antes de qualquer escrita;
 * 2. escrita (`postAccountMovements`): cria os movimentos (ID
 *    determinístico, `create`) e grava o saldo novo de cada conta, calculado
 *    sobre o saldo relido.
 *
 * Saldo e movimento nascem no mesmo commit do fato de origem, da auditoria e
 * da idempotência: ou tudo vale, ou nada vale. Duas operações concorrentes
 * sobre a mesma conta leem o mesmo documento; a serialização da transação
 * faz uma delas ser repetida e ver o saldo novo. Conta arquivada não aceita
 * movimento algum — nem novo fato, nem compensação: para estornar sobre ela,
 * reative-a antes.
 */
export const ACCOUNT_NOT_FOUND_MESSAGE = "Conta não encontrada.";
export const ACCOUNT_INCONSISTENT_MESSAGE =
  "Esta conta tem dados inconsistentes e não pode ser movimentada.";
export const ACCOUNT_ARCHIVED_MESSAGE =
  "A conta selecionada está arquivada e não aceita movimentos. Escolha outra " +
  "conta ou reative esta em Configurações › Contas e carteiras.";
export const ACCOUNT_BALANCE_LIMIT_MESSAGE =
  "O saldo da conta ficaria fora do limite permitido.";
export const ACCOUNT_MOVEMENT_INCONSISTENT_MESSAGE =
  "O movimento de conta deste registro está inconsistente e não pode ser " +
  "compensado.";

export interface PostingAccount extends AuthoritativeCashAccount {
  ref: admin.firestore.DocumentReference;
}

export type PostingAccounts = Map<string, PostingAccount>;

/**
 * Relê as contas indicadas (sem repetição) no workspace autorizado. Conta
 * inexistente é `not_found`; fora do schema, falha fechada. O estado
 * (`active`/`archived`) é conferido na escrita, para que a leitura sirva
 * também a quem só exibe a conta.
 */
export const readPostingAccounts = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  accountIds: readonly string[],
): Promise<PostingAccounts> => {
  const unique = Array.from(new Set(accountIds));
  const accounts: PostingAccounts = new Map();
  if (unique.length === 0) return accounts;
  const refs = unique.map((id) => cashAccountsRef(workspaceId).doc(id));
  const snapshots = await transaction.getAll(...refs);
  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) {
      throw new ApplicationError("not_found", ACCOUNT_NOT_FOUND_MESSAGE,
        {accountId: unique[index]});
    }
    const account = readAuthoritativeCashAccount(
      snapshot.id, snapshot.data(), workspaceId);
    if (!account) {
      throw new ApplicationError("domain_precondition_failed",
        ACCOUNT_INCONSISTENT_MESSAGE, {ineligible: "inconsistent_account"});
    }
    accounts.set(account.id, {...account, ref: refs[index]});
  });
  return accounts;
};

/** Conta escolhida para um fato novo: precisa estar ativa. */
export const assertActiveAccount = (account: PostingAccount): void => {
  if (account.status !== "active") {
    throw new ApplicationError("domain_precondition_failed",
      ACCOUNT_ARCHIVED_MESSAGE, {ineligible: "archived_account"});
  }
};

/**
 * Relê o movimento de conta que será compensado. Precisa existir, estar no
 * schema, pertencer à conta e à origem esperadas e não ser ele mesmo um
 * estorno.
 */
export const readPostedMovement = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  movementId: string,
  expected: {accountId: string; sourceId: string},
): Promise<AuthoritativeCashAccountMovement> => {
  const snapshot = await transaction.get(
    cashAccountMovementsRef(workspaceId).doc(movementId));
  const movement = readAuthoritativeCashAccountMovement(
    snapshot.id, snapshot.data(), workspaceId);
  if (
    !movement ||
    movement.accountId !== expected.accountId ||
    movement.sourceId !== expected.sourceId ||
    movement.kind === "reversal"
  ) {
    throw new ApplicationError("internal",
      ACCOUNT_MOVEMENT_INCONSISTENT_MESSAGE);
  }
  return movement;
};

/** Compensação exata de um movimento: valor oposto, mesma data efetiva. */
export const reversalOfMovement = (
  original: AuthoritativeCashAccountMovement,
  id: string,
  sourceFactId: string,
): CashAccountMovementInput => ({
  id,
  accountId: original.accountId,
  kind: "reversal",
  amountCents: -original.amountCents,
  effectiveDate: original.effectiveDate,
  sourceDomain: original.sourceDomain,
  sourceId: original.sourceId,
  sourceFactId,
  reversalOf: original.id,
});

/**
 * Efeito de um lançamento manual confirmado sobre a conta: receita entra,
 * despesa sai. É o mesmo `netCents` que a projeção mensal soma.
 */
export const signedCashEntryCents = (
  type: "receita" | "despesa",
  amountCents: number,
): number => (type === "receita" ? amountCents : -amountCents);

/** Fato de origem de um movimento de lançamento: a revisão aplicada. */
export const cashEntryFactId = (
  transactionId: string,
  revision: number,
): string => `${transactionId}@r${revision}`;

export interface PostingContext {
  workspaceId: string;
  actorUid: string;
  operation: string;
  requestId: string;
}

/**
 * Fase de escrita: cria os movimentos e grava o saldo novo de cada conta
 * tocada (saldo relido + soma dos movimentos dela nesta operação).
 *
 * Recusa antes de escrever: movimento de valor zero ou não inteiro, conta
 * não relida, conta arquivada e saldo que sairia do teto. Devolve o saldo
 * novo por conta.
 */
export const postAccountMovements = (
  transaction: admin.firestore.Transaction,
  accounts: PostingAccounts,
  movements: readonly CashAccountMovementInput[],
  context: PostingContext,
): Map<string, number> => {
  const deltas = new Map<string, number>();
  for (const movement of movements) {
    if (
      !Number.isSafeInteger(movement.amountCents) ||
      movement.amountCents === 0
    ) {
      throw new ApplicationError("internal",
        ACCOUNT_MOVEMENT_INCONSISTENT_MESSAGE);
    }
    const account = accounts.get(movement.accountId);
    if (!account) {
      throw new ApplicationError("internal", ACCOUNT_INCONSISTENT_MESSAGE);
    }
    assertActiveAccount(account);
    deltas.set(account.id,
      (deltas.get(account.id) ?? 0) + movement.amountCents);
  }
  const balances = new Map<string, number>();
  for (const [accountId, delta] of deltas) {
    const account = accounts.get(accountId) as PostingAccount;
    // `|| 0` normaliza `-0`.
    const balance = account.balanceCents + delta || 0;
    if (
      !Number.isSafeInteger(balance) ||
      Math.abs(balance) > CASH_ACCOUNT_BALANCE_LIMIT_CENTS
    ) {
      throw new ApplicationError("domain_precondition_failed",
        ACCOUNT_BALANCE_LIMIT_MESSAGE);
    }
    balances.set(accountId, balance);
  }
  for (const movement of movements) {
    transaction.create(
      cashAccountMovementsRef(context.workspaceId).doc(movement.id),
      cashAccountMovementDocument({
        workspaceId: context.workspaceId,
        movement,
        actorUid: context.actorUid,
        operation: context.operation,
        requestId: context.requestId,
      }),
    );
  }
  for (const [accountId, balance] of balances) {
    const account = accounts.get(accountId) as PostingAccount;
    transaction.update(account.ref, {
      balanceCents: balance,
      lastMovementAt: FieldValue.serverTimestamp(),
    });
    // A mesma operação pode encadear outra fase sobre o saldo novo.
    accounts.set(accountId, {...account, balanceCents: balance});
  }
  return balances;
};
