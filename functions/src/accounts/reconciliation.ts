import * as admin from "firebase-admin";
import {FieldPath, FieldValue} from "firebase-admin/firestore";

import {
  cashAccountMovementsRef,
  cashAccountsRef,
  isCashAccountBalance,
} from "./model";

/**
 * Reconciliação local das contas (D-30, P3-J) — **somente Emulator**.
 *
 * Recalcula o saldo esperado de cada conta pela soma dos seus movimentos
 * (`cash_account_movements`) e compara com `balanceCents`. Em simulação
 * (padrão) nada é escrito: devolve o relatório de divergências. O modo de
 * reparo só existe no Emulator e regrava o saldo esperado numa transação que
 * relê a conta e os movimentos.
 *
 * Não substitui a reconciliação agendada de produção (P7): é ferramenta de
 * desenvolvimento e prova de teste de que o saldo é sempre a soma do
 * livro-razão.
 */
export const RECONCILIATION_EMULATOR_PROJECT_ID = "minhas-financas-local";

/** Recusa qualquer ambiente que não seja o Emulator local. */
export const assertReconciliationEmulator = (
  env: NodeJS.ProcessEnv = process.env,
): void => {
  const projectId = env.GCLOUD_PROJECT ?? env.GOOGLE_CLOUD_PROJECT;
  if (
    !env.FIRESTORE_EMULATOR_HOST ||
    projectId !== RECONCILIATION_EMULATOR_PROJECT_ID
  ) {
    throw new Error(
      "A reconciliação local de contas só roda no Emulator " +
      `(${RECONCILIATION_EMULATOR_PROJECT_ID}).`,
    );
  }
};

export interface AccountBalanceInput {
  id: string;
  balanceCents: unknown;
}

export interface AccountMovementSum {
  accountId: string;
  amountCents: unknown;
}

export interface AccountReconciliationRow {
  accountId: string;
  /** `null` quando o saldo gravado não é inteiro seguro dentro do teto. */
  balanceCents: number | null;
  expectedCents: number;
  movementCount: number;
  invalidMovementCount: number;
  divergenceCents: number | null;
  ok: boolean;
}

/**
 * Comparação pura: saldo gravado × soma dos movimentos. Movimento com valor
 * inválido (não inteiro, zero, fora do teto) ou de conta inexistente conta
 * como divergência.
 */
export const reconcileAccountLedger = (
  accounts: readonly AccountBalanceInput[],
  movements: readonly AccountMovementSum[],
): {rows: AccountReconciliationRow[]; orphanMovementCount: number} => {
  const sums = new Map<string, {sum: number; count: number;
    invalid: number}>();
  for (const account of accounts) {
    sums.set(account.id, {sum: 0, count: 0, invalid: 0});
  }
  let orphanMovementCount = 0;
  for (const movement of movements) {
    const entry = sums.get(movement.accountId);
    if (!entry) {
      orphanMovementCount += 1;
      continue;
    }
    entry.count += 1;
    if (
      !isCashAccountBalance(movement.amountCents) ||
      movement.amountCents === 0
    ) {
      entry.invalid += 1;
      continue;
    }
    entry.sum += movement.amountCents;
  }
  const rows = accounts.map((account) => {
    const entry = sums.get(account.id) as {sum: number; count: number;
      invalid: number};
    const balance = isCashAccountBalance(account.balanceCents) ?
      account.balanceCents : null;
    const expected = entry.sum || 0;
    const divergence = balance === null ? null : balance - expected || 0;
    return {
      accountId: account.id,
      balanceCents: balance,
      expectedCents: expected,
      movementCount: entry.count,
      invalidMovementCount: entry.invalid,
      divergenceCents: divergence,
      ok: balance !== null && divergence === 0 && entry.invalid === 0,
    };
  });
  return {rows, orphanMovementCount};
};

export interface CashAccountReconciliationReport {
  workspaceId: string;
  mode: "dry-run" | "repair";
  accounts: AccountReconciliationRow[];
  orphanMovementCount: number;
  divergentAccountIds: string[];
  repairedAccountIds: string[];
}

const PAGE_SIZE = 300;

/** Lê uma coleção inteira em páginas por `__name__` (só Emulator). */
const readAll = async (
  query: admin.firestore.Query,
): Promise<admin.firestore.QueryDocumentSnapshot[]> => {
  const docs: admin.firestore.QueryDocumentSnapshot[] = [];
  let cursor: admin.firestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    let page = query.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) page = page.startAfter(cursor);
    const snapshot = await page.get();
    docs.push(...snapshot.docs);
    if (snapshot.size < PAGE_SIZE) return docs;
    cursor = snapshot.docs[snapshot.docs.length - 1];
  }
};

/**
 * Executa a reconciliação de um workspace no Emulator. `repair: true`
 * regrava, numa transação por conta, o saldo esperado das contas divergentes
 * (relendo conta e movimentos dentro da transação).
 */
export const runCashAccountReconciliation = async (
  workspaceId: string,
  options: {repair?: boolean} = {},
): Promise<CashAccountReconciliationReport> => {
  assertReconciliationEmulator();
  const accountDocs = await readAll(cashAccountsRef(workspaceId));
  const movementDocs = await readAll(cashAccountMovementsRef(workspaceId));
  const {rows, orphanMovementCount} = reconcileAccountLedger(
    accountDocs.map((doc) => ({id: doc.id,
      balanceCents: doc.get("balanceCents")})),
    movementDocs.map((doc) => ({accountId: String(doc.get("accountId")),
      amountCents: doc.get("amountCents")})),
  );
  const divergent = rows.filter((row) => !row.ok);
  const repaired: string[] = [];
  if (options.repair) {
    for (const row of divergent) {
      if (row.invalidMovementCount > 0) continue;
      await admin.firestore().runTransaction(async (transaction) => {
        const accountRef = cashAccountsRef(workspaceId).doc(row.accountId);
        const [account, movements] = await Promise.all([
          transaction.get(accountRef),
          transaction.get(cashAccountMovementsRef(workspaceId)
            .where("accountId", "==", row.accountId)),
        ]);
        if (!account.exists) return;
        const expected = movements.docs.reduce((sum, doc) =>
          sum + Number(doc.get("amountCents")), 0) || 0;
        transaction.update(accountRef, {
          balanceCents: expected,
          lastMovementAt: FieldValue.serverTimestamp(),
        });
      });
      repaired.push(row.accountId);
    }
  }
  return {
    workspaceId,
    mode: options.repair ? "repair" : "dry-run",
    accounts: rows,
    orphanMovementCount,
    divergentAccountIds: divergent.map((row) => row.accountId),
    repairedAccountIds: repaired,
  };
};
