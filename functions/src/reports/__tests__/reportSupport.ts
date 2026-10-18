import assert from "node:assert/strict";
import {Timestamp} from "firebase-admin/firestore";

import {executeCreateCashAccount} from "../../accounts/operations";
import {createCashAccountPayloadSchema} from "../../accounts/contracts";
import {
  confirmCashTransactionPayloadSchema,
  createCashTransactionPayloadSchema,
  updateCashTransactionPayloadSchema,
  voidCashTransactionPayloadSchema,
} from "../../cash/contracts";
import {executeCreateCashTransaction} from "../../cash/createTransaction";
import {
  executeConfirmCashTransaction,
  executeUpdateCashTransaction,
  executeVoidCashTransaction,
} from "../../cash/mutateTransaction";
import {
  seedLoanTenant,
  type LoanTenant,
} from "../../loans/testSupport/loanTestSupport";
import {seedDefaultCategories} from
  "../../settingsCatalog/testSupport/categorySeeds";
import {formatIsoInstant} from "../../shared/commitTime";
import {addDaysToDayKey, saoPauloDayKey} from "../../shared/dateKeys";
import {defaultAccountOf} from "../../shared/testSupport/kernelTestSupport";
import type {WorkspaceActor, WorkspaceRole} from "../../shared/workspaceAuth";
import {handleTransactionWrite} from "../../triggers/transactions";
import {
  db,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import type {FinancialReport, ReportRange, ReportSection} from "../contract";
import {executeGetFinancialReport} from "../report";

/**
 * Apoio das suítes do relatório (P5-C1), só no Emulator.
 *
 * As operações passam pelos executores reais dos domínios; o gatilho de caixa
 * é entregue por `sync`, que reproduz o Eventarc: para cada lançamento novo
 * ou alterado desde a última entrega, um evento com o estado anterior e o
 * atual (o gatilho aplica `depois − antes`, então estados intermediários não
 * entregues não mudam o resultado).
 */

export interface ReportTenant extends LoanTenant {
  incomeCategoryId: string;
  expenseCategoryId: string;
  accountId: string;
}

export const seedReportTenant = async (
  type: "PF" | "PJ",
  prefix: string,
): Promise<ReportTenant> => {
  const tenant = await seedLoanTenant(type, prefix);
  const categories = await seedDefaultCategories(tenant.workspaceId);
  return {
    ...tenant,
    ...categories,
    accountId: defaultAccountOf(tenant.workspaceId),
  };
};

export const actorOf = (
  tenant: ReportTenant,
  uid = tenant.owner,
  role: WorkspaceRole = "owner",
): WorkspaceActor => ({uid, workspaceId: tenant.workspaceId, role});

export const today = (): string => saoPauloDayKey();
export const daysAgo = (days: number): string =>
  addDaysToDayKey(today(), -days);

let requests = 0;
const requestId = () => `req-report-${++requests}`;

interface Delivered {
  data: FirebaseFirestore.DocumentData;
  updateTime: Timestamp;
}

const delivered = new Map<string, Map<string, Delivered>>();

/** Entrega ao gatilho real toda escrita de lançamento ainda não entregue. */
export const sync = async (workspaceId: string): Promise<number> => {
  const snapshot = await db()
    .collection(`workspaces/${workspaceId}/transactions`).get();
  const last = delivered.get(workspaceId) ?? new Map<string, Delivered>();
  let count = 0;
  for (const doc of snapshot.docs) {
    const previous = last.get(doc.id);
    if (previous && previous.updateTime.isEqual(doc.updateTime)) continue;
    await handleTransactionWrite({
      eventId: uniqueId(`evt-${doc.id}`),
      workspaceId,
      transactionId: doc.id,
      eventTime: doc.updateTime,
      before: previous?.data,
      after: doc.data(),
      beforeCreateTime: previous ? doc.createTime : undefined,
    });
    last.set(doc.id, {data: doc.data(), updateTime: doc.updateTime});
    count += 1;
  }
  delivered.set(workspaceId, last);
  return count;
};

export const report = async (
  tenant: ReportTenant,
  range: ReportRange,
  options: {
    uid?: string;
    role?: WorkspaceRole;
    sections?: ReportSection[];
  } = {},
): Promise<FinancialReport> => executeGetFinancialReport(
  actorOf(tenant, options.uid ?? tenant.owner, options.role ?? "owner"),
  {
    workspaceId: tenant.workspaceId,
    range,
    ...(options.sections ? {sections: options.sections} : {}),
  },
);

export const preset = (
  value: "7d" | "30d" | "90d" | "12m" | "ytd" | "all",
): ReportRange => ({kind: "preset", preset: value});

export const month = (value: string): ReportRange =>
  ({kind: "month", month: value});

/** Dados de um bloco que precisa estar exato (ou zero verdadeiro). */
export const exact = <T>(
  section: {status: string; data: T | null},
  label: string,
): T => {
  assert.ok(section.status === "exact" || section.status === "zero",
    `${label}: esperado exato, veio ${section.status}`);
  assert.ok(section.data, `${label}: sem dados`);
  return section.data as T;
};

export interface EntryInput {
  type: "receita" | "despesa";
  amountCents: number;
  date?: string;
  dueDate?: string;
  categoryId?: string;
  accountId?: string;
  uid?: string;
}

export const createEntry = async (
  tenant: ReportTenant,
  input: EntryInput,
): Promise<string> => {
  const pending = input.dueDate !== undefined;
  const payload = createCashTransactionPayloadSchema.parse({
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    type: input.type,
    description: `Lançamento ${input.type}`,
    categoryId: input.categoryId ?? (input.type === "receita" ?
      tenant.incomeCategoryId : tenant.expenseCategoryId),
    amountCents: input.amountCents,
    cashAccountId: input.accountId ?? tenant.accountId,
    ...(pending ?
      {status: "pending", dueDate: input.dueDate} :
      {date: input.date ?? today()}),
  });
  const result = await executeCreateCashTransaction(
    actorOf(tenant, input.uid ?? tenant.owner), payload, requestId());
  return result.transactionId;
};

const versionOf = async (tenant: ReportTenant, transactionId: string) => {
  const doc = await db()
    .doc(`workspaces/${tenant.workspaceId}/transactions/${transactionId}`)
    .get();
  const updatedAt = doc.get("updatedAt");
  return {
    data: doc.data() ?? {},
    expectedUpdatedAt: updatedAt instanceof Timestamp ?
      formatIsoInstant(updatedAt) : null,
  };
};

export const updateEntry = async (
  tenant: ReportTenant,
  transactionId: string,
  changes: Partial<EntryInput>,
): Promise<void> => {
  const {data, expectedUpdatedAt} = await versionOf(tenant, transactionId);
  const type = (changes.type ?? data.type) as "receita" | "despesa";
  const payload = updateCashTransactionPayloadSchema.parse({
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    transactionId,
    expectedUpdatedAt,
    reason: "correção de teste",
    entry: {
      type,
      description: data.description,
      categoryId: changes.categoryId ?? data.categoryId,
      amountCents: changes.amountCents ?? data.valueCents,
      cashAccountId: changes.accountId ?? data.cashAccountId,
      ...(data.isPaid === false ?
        {status: "pending", dueDate: changes.dueDate ?? data.dueDate} :
        {date: changes.date ?? data.date}),
    },
  });
  await executeUpdateCashTransaction(actorOf(tenant), payload, requestId());
};

export const voidEntry = async (
  tenant: ReportTenant,
  transactionId: string,
): Promise<void> => {
  const {expectedUpdatedAt} = await versionOf(tenant, transactionId);
  await executeVoidCashTransaction(actorOf(tenant),
    voidCashTransactionPayloadSchema.parse({
      workspaceId: tenant.workspaceId,
      idempotencyKey: idempotencyKey(),
      transactionId,
      expectedUpdatedAt,
      reason: "anulação de teste",
    }), requestId());
};

export const confirmEntry = async (
  tenant: ReportTenant,
  transactionId: string,
  date: string,
  amountCents: number,
): Promise<void> => {
  const {expectedUpdatedAt} = await versionOf(tenant, transactionId);
  await executeConfirmCashTransaction(actorOf(tenant),
    confirmCashTransactionPayloadSchema.parse({
      workspaceId: tenant.workspaceId,
      idempotencyKey: idempotencyKey(),
      transactionId,
      expectedUpdatedAt,
      date,
      amountCents,
    }), requestId());
};

export const createAccount = async (
  tenant: ReportTenant,
  name: string,
  openingBalanceCents: number,
): Promise<string> => {
  const result = await executeCreateCashAccount(actorOf(tenant),
    createCashAccountPayloadSchema.parse({
      workspaceId: tenant.workspaceId,
      idempotencyKey: idempotencyKey(),
      name,
      accountType: "checking",
      ...(openingBalanceCents !== 0 ? {openingBalanceCents} : {}),
    }), requestId());
  return (result as {accountId: string}).accountId;
};

/** Soma dos saldos iniciais (movimentos `opening_balance`) do workspace. */
export const openingBalancesOf = async (workspaceId: string) => {
  const movements = await db()
    .collection(`workspaces/${workspaceId}/cash_account_movements`)
    .where("kind", "==", "opening_balance").get();
  return movements.docs.reduce((sum, doc) =>
    sum + Number(doc.get("amountCents")), 0);
};
