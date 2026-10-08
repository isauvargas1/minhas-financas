import assert from "node:assert/strict";
import type * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {formatIsoInstant} from "../../shared/commitTime";
import {defaultAccountOf} from "../../shared/testSupport/kernelTestSupport";
import {
  call,
  db,
  idempotencyKey,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  archiveCashAccount,
  createCashAccount,
  createCashTransfer,
  reactivateCashAccount,
  reverseCashTransfer,
  updateCashAccount,
} from "../callables";
import type {
  CashAccountMutationResult,
  CashTransferResult,
} from "../contracts";

/** Apoio das suítes de contas e transferências (P3-J), só no Emulator. */

export {defaultAccountOf};

export const accountRef = (workspaceId: string, accountId: string) =>
  db().doc(`workspaces/${workspaceId}/cash_accounts/${accountId}`);
export const transferRef = (workspaceId: string, transferId: string) =>
  db().doc(`workspaces/${workspaceId}/cash_transfers/${transferId}`);
export const movementRef = (workspaceId: string, movementId: string) =>
  db().doc(`workspaces/${workspaceId}/cash_account_movements/${movementId}`);

export const readAccount = async (workspaceId: string, accountId: string) =>
  (await accountRef(workspaceId, accountId).get()).data() ?? {};

export const balanceOf = async (workspaceId: string, accountId: string) =>
  Number((await readAccount(workspaceId, accountId)).balanceCents);

export const movementsOf = async (workspaceId: string, accountId?: string) => {
  let query: admin.firestore.Query =
    db().collection(`workspaces/${workspaceId}/cash_account_movements`);
  if (accountId) query = query.where("accountId", "==", accountId);
  return (await query.get()).docs.map((doc) => doc.data());
};

export const countOf = async (workspaceId: string, collection: string) =>
  (await db().collection(`workspaces/${workspaceId}/${collection}`).count()
    .get()).data().count;

export const accountEvents = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/cash_account_events`)
    .get()).docs.map((doc) => doc.data());

const versionOf = async (ref: admin.firestore.DocumentReference) =>
  formatIsoInstant((await ref.get()).get("updatedAt") as Timestamp);

export const accountVersion = (workspaceId: string, accountId: string) =>
  versionOf(accountRef(workspaceId, accountId));
export const transferVersion = (workspaceId: string, transferId: string) =>
  versionOf(transferRef(workspaceId, transferId));

/**
 * Prova do livro-razão: em cada conta do workspace, o saldo gravado é a soma
 * exata dos movimentos dela; nenhum movimento aponta para conta inexistente.
 */
export const assertLedgerConsistent = async (workspaceId: string) => {
  const accounts = (await db()
    .collection(`workspaces/${workspaceId}/cash_accounts`).get()).docs;
  const movements = await movementsOf(workspaceId);
  const ids = new Set(accounts.map((doc) => doc.id));
  for (const movement of movements) {
    assert.ok(ids.has(movement.accountId), `movimento órfão ${movement.id}`);
    assert.ok(Number.isSafeInteger(movement.amountCents) &&
      movement.amountCents !== 0, `valor inválido em ${movement.id}`);
  }
  for (const account of accounts) {
    const sum = movements
      .filter((movement) => movement.accountId === account.id)
      .reduce((total, movement) => total + movement.amountCents, 0);
    assert.equal(account.get("balanceCents"), sum,
      `saldo ≠ soma dos movimentos em ${account.id}`);
  }
};

export const createAccountPayload = (
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  name: "Conta corrente",
  accountType: "checking",
  ...overrides,
});

export const newAccount = (uid: string, data: Record<string, unknown>) =>
  call<CashAccountMutationResult>(createCashAccount, uid, data);

export const editAccount = (uid: string, data: Record<string, unknown>) =>
  call<CashAccountMutationResult>(updateCashAccount, uid, data);

export const archiveAccount = (uid: string, data: Record<string, unknown>) =>
  call<CashAccountMutationResult>(archiveCashAccount, uid, data);

export const reactivateAccount = (uid: string, data: Record<string, unknown>) =>
  call<CashAccountMutationResult>(reactivateCashAccount, uid, data);

export const statusPayload = async (
  workspaceId: string,
  accountId: string,
) => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  accountId,
  expectedUpdatedAt: await accountVersion(workspaceId, accountId),
});

export const transferPayload = (
  workspaceId: string,
  sourceAccountId: string,
  destinationAccountId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  sourceAccountId,
  destinationAccountId,
  amountCents: 10_000,
  date: "2026-10-01",
  ...overrides,
});

export const transfer = (uid: string, data: Record<string, unknown>) =>
  call<CashTransferResult>(createCashTransfer, uid, data);

export const reversePayload = async (
  workspaceId: string,
  transferId: string,
  overrides: Record<string, unknown> = {},
) => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  transferId,
  expectedUpdatedAt: await transferVersion(workspaceId, transferId),
  reason: "Transferência lançada em duplicidade",
  ...overrides,
});

export const reverse = (uid: string, data: Record<string, unknown>) =>
  call<CashTransferResult>(reverseCashTransfer, uid, data);

/** Remove os recibos de idempotência do ator (expiração da TTL). */
export const expireKeys = async (uid: string) => {
  const keys = await db().collection(`users/${uid}/idempotency_keys`).get();
  await Promise.all(keys.docs.map((doc) => doc.ref.delete()));
};
