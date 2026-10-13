import type * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {
  assertActiveAccount,
  postAccountMovements,
  readPostedMovement,
  readPostingAccounts,
  reversalOfMovement,
  type PostingAccounts,
} from "../accounts/ledger";
import {
  splitAccountMovementIdFor,
  type AuthoritativeCashAccountMovement,
} from "../accounts/model";
import {ApplicationError} from "../shared/errors";
import {MONEY_CURRENCY} from "../shared/money";
import {workspaceRef} from "../shared/workspaceAuth";
import {
  SPLIT_CASH_ENTRY_VERSION,
  readSplitCashEntry,
  type SplitCashEntry,
  type SplitCashEntryKind,
} from "./cashEffect";

/**
 * Fatos da Divisão de contas no Caixa (P4-C): o espelho em `transactions` e o
 * movimento na conta (D-30) no mesmo commit da operação do domínio.
 *
 * - título com `financialIntegration: cash` → despesa confirmada na conta
 *   escolhida, responsável = pagador (membro do workspace);
 * - pagamento de reembolso PJ → despesa confirmada na conta escolhida, com
 *   descrição genérica (nada do solicitante).
 *
 * O espelho é protegido: carrega `splitEntry` (backend-only), fica fora das
 * callables de correção/anulação do Caixa (P3) e da quota manual D-40. A
 * anulação do título e o estorno do reembolso compensam o fato (lançamento
 * de sinal oposto + estorno do movimento na mesma conta); o original fica.
 */
export const SPLIT_CASH_SOURCE = "split";

const transactionsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection("transactions");

export const SPLIT_CASH_INCONSISTENT_MESSAGE =
  "O lançamento de caixa desta operação está inconsistente.";

export const splitCashMirrorDocument = (input: {
  workspaceId: string;
  actorUid: string;
  /** Responsável pelo lançamento (`userId`). */
  ownerUid: string;
  profileType: "PF" | "PJ";
  date: string;
  description: string;
  category: string;
  entry: SplitCashEntry;
  cashAccountId: string;
  accountMovementId: string;
}): admin.firestore.DocumentData => ({
  type: input.entry.reversal ? "receita" : "despesa",
  description: input.description,
  category: input.category,
  valueCents: input.entry.amountCents,
  date: input.date,
  isPaid: true,
  workspaceId: input.workspaceId,
  profileId: input.workspaceId,
  profileType: input.profileType,
  userId: input.ownerUid,
  source: SPLIT_CASH_SOURCE,
  splitEntry: input.entry,
  cashAccountId: input.cashAccountId,
  accountMovementId: input.accountMovementId,
  createdBy: input.actorUid,
  updatedBy: input.actorUid,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

/** Fase de leitura do fato novo: a conta precisa existir e estar ativa. */
export const prepareSplitCashFact = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  cashAccountId: string,
): Promise<PostingAccounts> => {
  const accounts = await readPostingAccounts(transaction, workspaceId,
    [cashAccountId]);
  const account = accounts.get(cashAccountId);
  if (!account) {
    throw new ApplicationError("internal", SPLIT_CASH_INCONSISTENT_MESSAGE);
  }
  assertActiveAccount(account);
  return accounts;
};

export interface SplitCashFactInput {
  transactionId: string;
  workspaceId: string;
  actorUid: string;
  ownerUid: string;
  profileType: "PF" | "PJ";
  cashAccountId: string;
  date: string;
  description: string;
  category: string;
  kind: SplitCashEntryKind;
  groupId: string;
  billId: string | null;
  reimbursementId: string | null;
  amountCents: number;
  operation: string;
  requestId: string;
}

/** Fase de escrita: movimento de saída na conta + espelho da despesa. */
export const commitSplitCashFact = (
  transaction: admin.firestore.Transaction,
  accounts: PostingAccounts,
  input: SplitCashFactInput,
): {accountMovementId: string} => {
  const accountMovementId = splitAccountMovementIdFor(input.transactionId);
  postAccountMovements(transaction, accounts, [{
    id: accountMovementId,
    accountId: input.cashAccountId,
    kind: "split",
    amountCents: -input.amountCents,
    effectiveDate: input.date,
    sourceDomain: "split",
    sourceId: input.transactionId,
    sourceFactId: input.transactionId,
    reversalOf: null,
  }], {
    workspaceId: input.workspaceId,
    actorUid: input.actorUid,
    operation: input.operation,
    requestId: input.requestId,
  });
  transaction.create(
    transactionsRef(input.workspaceId).doc(input.transactionId),
    splitCashMirrorDocument({
      workspaceId: input.workspaceId,
      actorUid: input.actorUid,
      ownerUid: input.ownerUid,
      profileType: input.profileType,
      date: input.date,
      description: input.description,
      category: input.category,
      cashAccountId: input.cashAccountId,
      accountMovementId,
      entry: {
        domainVersion: SPLIT_CASH_ENTRY_VERSION,
        kind: input.kind,
        groupId: input.groupId,
        billId: input.billId,
        reimbursementId: input.reimbursementId,
        reversal: false,
        reversalOf: null,
        amountCents: input.amountCents,
        currency: MONEY_CURRENCY,
      },
    }),
  );
  return {accountMovementId};
};

export interface PreparedSplitCashReversal {
  originalTransactionId: string;
  entry: SplitCashEntry;
  movement: AuthoritativeCashAccountMovement;
  accounts: PostingAccounts;
  category: string;
  date: string;
}

/**
 * Fase de leitura da compensação: relê o espelho original (precisa ser o
 * fato do mesmo título/reembolso, não uma compensação) e o movimento de conta
 * que ele aplicou. A conta precisa estar ativa (o estorno volta para ela).
 */
export const prepareSplitCashReversal = async (
  transaction: admin.firestore.Transaction,
  input: {
    workspaceId: string;
    originalTransactionId: string;
    expected: {kind: SplitCashEntryKind; groupId: string;
      billId: string | null; reimbursementId: string | null};
  },
): Promise<PreparedSplitCashReversal> => {
  const snapshot = await transaction.get(
    transactionsRef(input.workspaceId).doc(input.originalTransactionId));
  const data = snapshot.data();
  const entry = readSplitCashEntry(data?.splitEntry);
  if (
    !snapshot.exists || !data || !entry || entry.reversal ||
    entry.kind !== input.expected.kind ||
    entry.groupId !== input.expected.groupId ||
    entry.billId !== input.expected.billId ||
    entry.reimbursementId !== input.expected.reimbursementId ||
    data.workspaceId !== input.workspaceId ||
    typeof data.cashAccountId !== "string" ||
    typeof data.category !== "string" ||
    typeof data.date !== "string"
  ) {
    throw new ApplicationError("internal", SPLIT_CASH_INCONSISTENT_MESSAGE);
  }
  const movement = await readPostedMovement(transaction, input.workspaceId,
    splitAccountMovementIdFor(input.originalTransactionId), {
      accountId: data.cashAccountId,
      sourceId: input.originalTransactionId,
    });
  if (movement.amountCents !== -entry.amountCents) {
    throw new ApplicationError("internal", SPLIT_CASH_INCONSISTENT_MESSAGE);
  }
  const accounts = await readPostingAccounts(transaction, input.workspaceId,
    [data.cashAccountId]);
  return {
    originalTransactionId: input.originalTransactionId,
    entry,
    movement,
    accounts,
    category: data.category,
    date: data.date,
  };
};

/** Fase de escrita da compensação: estorno do movimento + espelho oposto. */
export const commitSplitCashReversal = (
  transaction: admin.firestore.Transaction,
  prepared: PreparedSplitCashReversal,
  input: {
    reversalTransactionId: string;
    workspaceId: string;
    actorUid: string;
    ownerUid: string;
    profileType: "PF" | "PJ";
    description: string;
    operation: string;
    requestId: string;
  },
): {accountMovementId: string} => {
  const accountMovementId = splitAccountMovementIdFor(
    input.reversalTransactionId);
  postAccountMovements(transaction, prepared.accounts, [
    reversalOfMovement(prepared.movement, accountMovementId,
      input.reversalTransactionId),
  ], {
    workspaceId: input.workspaceId,
    actorUid: input.actorUid,
    operation: input.operation,
    requestId: input.requestId,
  });
  transaction.create(
    transactionsRef(input.workspaceId).doc(input.reversalTransactionId),
    splitCashMirrorDocument({
      workspaceId: input.workspaceId,
      actorUid: input.actorUid,
      ownerUid: input.ownerUid,
      profileType: input.profileType,
      // Mesma data do fato original (como o estorno do movimento): fato e
      // compensação se anulam no mesmo mês da projeção.
      date: prepared.date,
      description: input.description,
      category: prepared.category,
      cashAccountId: prepared.movement.accountId,
      accountMovementId,
      entry: {
        ...prepared.entry,
        reversal: true,
        reversalOf: prepared.originalTransactionId,
      },
    }),
  );
  return {accountMovementId};
};
