import assert from "node:assert/strict";
import type * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {
  seedLoanTenant,
  type LoanTenant,
} from "../../loans/testSupport/loanTestSupport";
import {formatIsoInstant} from "../../shared/commitTime";
import {defaultAccountOf} from "../../shared/testSupport/kernelTestSupport";
import type {WorkspaceActor, WorkspaceRole} from "../../shared/workspaceAuth";
import {db, idempotencyKey} from "../../workspaces/testSupport/p1TestSupport";
import type {RecurringOperationOptions} from "../common";
import {ApplicationError} from "../../shared/errors";
import {
  executeCancelRecurringExpense,
  executeCreateRecurringExpense,
  executePauseRecurringExpense,
  executeResumeRecurringExpense,
  executeUpdateRecurringExpense,
} from "../contractOperations";
import type {
  ConfirmRecurringOccurrencePayload,
  CreateRecurringExpensePayload,
} from "../contracts";
import {
  executeConfirmRecurringOccurrence,
  executeIgnoreRecurringOccurrence,
  executeRetryRecurringOccurrence,
} from "../occurrenceOperations";
import {runRecurringGeneration} from "../scheduler";

/** Apoio das suítes de Recorrentes (P4-B), só no Emulator. */

export {defaultAccountOf, idempotencyKey};
export type RecurringTenant = LoanTenant;

export const seedRecurringTenant = (
  type: "PF" | "PJ" = "PF",
  prefix = "rec",
): Promise<RecurringTenant> => seedLoanTenant(type, prefix);

/** Relógio fixo ao meio-dia em São Paulo (15:00Z) do dia informado. */
export const clockAt = (dayKey: string): RecurringOperationOptions => ({
  now: () => Date.parse(`${dayKey}T15:00:00.000Z`),
});

export const actorOf = (
  tenant: RecurringTenant,
  uid: string,
  role: WorkspaceRole = "owner",
): WorkspaceActor => ({uid, workspaceId: tenant.workspaceId, role});

let requestCounter = 0;
export const requestId = (): string => `req-rec-${++requestCounter}`;

export const VISUAL = {color: "#4f46e5", icon: "repeat" as const, emoji: null};

/** Contrato mensal no Caixa (conta padrão), automático, dia 10. */
export const contractPayload = (
  tenant: RecurringTenant,
  overrides: Partial<CreateRecurringExpensePayload> = {},
): CreateRecurringExpensePayload => ({
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  name: "Internet",
  type: "fixed_bill",
  description: null,
  amountCents: 9_990,
  frequency: "monthly",
  billingDay: 10,
  startDate: "2026-01-10",
  endDate: null,
  paymentMethod: "pix",
  executionMode: "automatic",
  cardId: null,
  cashAccountId: defaultAccountOf(tenant.workspaceId),
  category: "Utilidades",
  visual: VISUAL,
  business: null,
  ...overrides,
} as CreateRecurringExpensePayload);

export const createContract = async (
  tenant: RecurringTenant,
  today: string,
  overrides: Partial<CreateRecurringExpensePayload> = {},
  uid = tenant.owner,
  role: WorkspaceRole = "owner",
) => executeCreateRecurringExpense(actorOf(tenant, uid, role),
  contractPayload(tenant, overrides), requestId(), clockAt(today));

export const runOn = (
  today: string,
  options: Parameters<typeof runRecurringGeneration>[0] = {},
) => runRecurringGeneration({today, requestId: requestId(), ...options});

const ws = (workspaceId: string) => db().doc(`workspaces/${workspaceId}`);

export const contractRef = (workspaceId: string, id: string) =>
  ws(workspaceId).collection("recurring_expenses").doc(id);
export const occurrenceRef = (workspaceId: string, id: string) =>
  ws(workspaceId).collection("recurring_occurrences").doc(id);
export const transactionRef = (workspaceId: string, id: string) =>
  ws(workspaceId).collection("transactions").doc(id);
export const accountRef = (workspaceId: string, id: string) =>
  ws(workspaceId).collection("cash_accounts").doc(id);

export const readDoc = async (ref: admin.firestore.DocumentReference) =>
  (await ref.get()).data() ?? {};
export const readContract = (workspaceId: string, id: string) =>
  readDoc(contractRef(workspaceId, id));
export const readOccurrence = (workspaceId: string, id: string) =>
  readDoc(occurrenceRef(workspaceId, id));
export const readTransaction = (workspaceId: string, id: string) =>
  readDoc(transactionRef(workspaceId, id));
export const balanceOf = async (workspaceId: string, accountId: string) =>
  Number((await readDoc(accountRef(workspaceId, accountId))).balanceCents);

export const contractVersion = async (workspaceId: string, id: string) =>
  formatIsoInstant((await contractRef(workspaceId, id).get())
    .get("updatedAt") as Timestamp);

const listOf = async (
  workspaceId: string,
  collection: string,
  field?: string,
  value?: string,
) => {
  let query: admin.firestore.Query = ws(workspaceId).collection(collection);
  if (field) query = query.where(field, "==", value);
  return (await query.get()).docs.map((doc) =>
    ({id: doc.id, ...doc.data()}) as admin.firestore.DocumentData);
};

export const occurrencesOf = async (workspaceId: string, contractId: string) =>
  (await listOf(workspaceId, "recurring_occurrences", "recurringExpenseId",
    contractId)).sort((a, b) => String(a.dueDate).localeCompare(b.dueDate));
export const eventsOf = (workspaceId: string, contractId?: string) =>
  contractId ?
    listOf(workspaceId, "recurring_events", "recurringExpenseId", contractId) :
    listOf(workspaceId, "recurring_events");
export const transactionsOf = (workspaceId: string) =>
  listOf(workspaceId, "transactions");
export const purchasesOf = (workspaceId: string) =>
  listOf(workspaceId, "credit_card_purchases");
export const countOf = async (workspaceId: string, collection: string) =>
  (await ws(workspaceId).collection(collection).count().get()).data().count;

// ------------------------------------------------------------ operações


export const updateContract = async (
  tenant: RecurringTenant,
  id: string,
  changes: Record<string, unknown>,
  today: string,
  uid = tenant.owner,
  role: WorkspaceRole = "owner",
  extra: Record<string, unknown> = {},
) => executeUpdateRecurringExpense(actorOf(tenant, uid, role), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  recurringExpenseId: id,
  expectedUpdatedAt: await contractVersion(tenant.workspaceId, id),
  changes,
  ...extra,
} as Parameters<typeof executeUpdateRecurringExpense>[1], requestId(),
clockAt(today));

const lifecycle = (
  execute: typeof executePauseRecurringExpense,
) => async (
  tenant: RecurringTenant,
  id: string,
  today: string,
  uid = tenant.owner,
  role: WorkspaceRole = "owner",
) => execute(actorOf(tenant, uid, role), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  recurringExpenseId: id,
  expectedUpdatedAt: await contractVersion(tenant.workspaceId, id),
}, requestId(), clockAt(today));

export const pauseContract = lifecycle(executePauseRecurringExpense);
export const resumeContract = lifecycle(executeResumeRecurringExpense);
export const cancelContract = lifecycle(executeCancelRecurringExpense);

export const confirmOccurrence = (
  tenant: RecurringTenant,
  occurrenceId: string,
  today: string,
  extra: Partial<ConfirmRecurringOccurrencePayload> = {},
  uid = tenant.owner,
  role: WorkspaceRole = "owner",
) => executeConfirmRecurringOccurrence(actorOf(tenant, uid, role), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  occurrenceId,
  ...extra,
}, requestId(), clockAt(today));

export const ignoreOccurrence = (
  tenant: RecurringTenant,
  occurrenceId: string,
  today: string,
  uid = tenant.owner,
  role: WorkspaceRole = "owner",
) => executeIgnoreRecurringOccurrence(actorOf(tenant, uid, role), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  occurrenceId,
}, requestId(), clockAt(today));

export const retryOccurrence = (
  tenant: RecurringTenant,
  occurrenceId: string,
  today: string,
  extra: {cardId?: string; cashAccountId?: string} = {},
  uid = tenant.owner,
  role: WorkspaceRole = "owner",
) => executeRetryRecurringOccurrence(actorOf(tenant, uid, role), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  occurrenceId,
  ...extra,
}, requestId(), clockAt(today));

/** Recusa de domínio com código e (opcionalmente) a mensagem pt-BR exata. */
export const rejectsWith = async (
  promise: Promise<unknown>,
  code: string,
  message?: string | RegExp,
): Promise<void> => {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ApplicationError,
      `erro inesperado: ${String(error)}`);
    assert.equal(error.code, code, error.message);
    if (typeof message === "string") assert.equal(error.message, message);
    else if (message) assert.match(error.message, message);
    return true;
  });
};

/** Quantas unidades da quota manual do mês o workspace consumiu. */
export const quotaUsed = async (workspaceId: string, monthKey: string) =>
  Number((await db().doc(
    `workspaces/${workspaceId}/quota_state/transactions_${monthKey}`)
    .get()).get("used") ?? 0);

/** Contratos dos tenants da suíte saem do collection group global ao fim. */
export const cleanupRecurring = async (tenants: RecurringTenant[]) => {
  for (const tenant of tenants) {
    await db().recursiveDelete(db().collection(
      `workspaces/${tenant.workspaceId}/recurring_expenses`));
  }
};
