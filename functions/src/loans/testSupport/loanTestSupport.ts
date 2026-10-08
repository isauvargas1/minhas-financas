import assert from "node:assert/strict";
import {Timestamp} from "firebase-admin/firestore";

import {
  cashPeriodDeltaFor,
  cashPeriodKeyFor,
  normalizeCashPeriodDelta,
  CASH_DELTA_FIELDS,
  type CashPeriodDelta,
} from "../../cash/periods";
import {formatIsoInstant} from "../../shared/commitTime";
import {addDaysToDayKey, saoPauloDayKey} from "../../shared/dateKeys";
import {
  defaultAccountOf,
  seedActiveAccount,
  seedMember,
  seedWorkspace,
} from "../../shared/testSupport/kernelTestSupport";
import {handleTransactionWrite} from "../../triggers/transactions";
import {
  call,
  db,
  idempotencyKey,
  uniqueId,
} from "../../workspaces/testSupport/p1TestSupport";
import {
  cancelLoan,
  createLoan,
  registerLoanPayment,
  reverseLoanMovement,
  updateLoanMetadata,
} from "../callables";
import type {CreateLoanResult, LoanMutationResult} from "../contracts";
import {LOAN_EVENTS_COLLECTION} from "../model";
import {addMonthsToDayKey} from "../schedule";

/** Apoio comum das suítes de empréstimos (P3-G), só no Emulator. */

export interface LoanTenant {
  workspaceId: string;
  owner: string;
  admin: string;
  member: string;
  otherMember: string;
  viewer: string;
}

export const seedLoanTenant = async (
  type: "PF" | "PJ" = "PF",
  prefix = "loan",
): Promise<LoanTenant> => {
  const tenant: LoanTenant = {
    workspaceId: uniqueId(`${prefix}-ws`),
    owner: uniqueId(`${prefix}-owner`),
    admin: uniqueId(`${prefix}-admin`),
    member: uniqueId(`${prefix}-member`),
    otherMember: uniqueId(`${prefix}-member-b`),
    viewer: uniqueId(`${prefix}-viewer`),
  };
  for (const uid of [tenant.owner, tenant.admin, tenant.member,
    tenant.otherMember, tenant.viewer]) {
    await seedActiveAccount(uid);
  }
  await seedWorkspace({workspaceId: tenant.workspaceId, ownerId: tenant.owner,
    type});
  await seedMember(tenant.workspaceId, tenant.admin, "admin");
  await seedMember(tenant.workspaceId, tenant.member, "member");
  await seedMember(tenant.workspaceId, tenant.otherMember, "member");
  await seedMember(tenant.workspaceId, tenant.viewer, "viewer");
  return tenant;
};

export const today = (): string => saoPauloDayKey();
export const shiftDays = addDaysToDayKey;
export const nextMonth = (): string => addMonthsToDayKey(today(), 1);

/** Como o SDK serializa: chave com `undefined` não viaja. */
export const json = (data: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(data)) as Record<string, unknown>;

export const loanRef = (workspaceId: string, loanId: string) =>
  db().doc(`workspaces/${workspaceId}/loans/${loanId}`);
export const movementRef = (workspaceId: string, movementId: string) =>
  db().doc(`workspaces/${workspaceId}/loan_movements/${movementId}`);
export const transactionRef = (workspaceId: string, id: string) =>
  db().doc(`workspaces/${workspaceId}/transactions/${id}`);

export const readLoan = async (workspaceId: string, loanId: string) =>
  (await loanRef(workspaceId, loanId).get()).data() ?? {};
export const readMovement = async (workspaceId: string, id: string) =>
  (await movementRef(workspaceId, id).get()).data() ?? {};
export const readMirror = async (workspaceId: string, id: string) =>
  (await transactionRef(workspaceId, id).get()).data() ?? {};

export const loanVersion = async (
  workspaceId: string,
  loanId: string,
): Promise<string> => {
  const updatedAt = (await readLoan(workspaceId, loanId)).updatedAt;
  assert.ok(updatedAt instanceof Timestamp, "contrato sem updatedAt");
  return formatIsoInstant(updatedAt);
};

export const loanEvents = async (workspaceId: string) =>
  (await db().collection(`workspaces/${workspaceId}/${LOAN_EVENTS_COLLECTION}`)
    .get()).docs.map((doc) => doc.data());

export const countOf = async (workspaceId: string, collection: string) =>
  (await db().collection(`workspaces/${workspaceId}/${collection}`).count()
    .get()).data().count;

export const createPayload = (
  workspaceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => json({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  type: "borrow",
  personName: "Banco Exemplo S.A.",
  personContact: "contato@banco.example",
  description: "Capital de giro",
  principalCents: 300_000,
  cashAccountId: defaultAccountOf(workspaceId),
  startDate: today(),
  firstDueDate: nextMonth(),
  installments: 3,
  interest: {type: "none"},
  ...overrides,
});

export const create = (uid: string, data: Record<string, unknown>) =>
  call<CreateLoanResult>(createLoan, uid, data);

export const payPayload = async (
  workspaceId: string,
  loanId: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> => json({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  loanId,
  expectedUpdatedAt: await loanVersion(workspaceId, loanId),
  cashAccountId: defaultAccountOf(workspaceId),
  date: today(),
  principalCents: 100_000,
  interestCents: 10_000,
  ...overrides,
});

export const pay = (uid: string, data: Record<string, unknown>) =>
  call<LoanMutationResult>(registerLoanPayment, uid, data);

export const reversePayload = async (
  workspaceId: string,
  loanId: string,
  movementId: string,
  overrides: Record<string, unknown> = {},
) => json({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  loanId,
  movementId,
  expectedUpdatedAt: await loanVersion(workspaceId, loanId),
  reason: "Pagamento lançado em duplicidade",
  ...overrides,
});

export const reverse = (uid: string, data: Record<string, unknown>) =>
  call<LoanMutationResult>(reverseLoanMovement, uid, data);

export const cancelPayload = async (
  workspaceId: string,
  loanId: string,
  overrides: Record<string, unknown> = {},
) => json({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  loanId,
  expectedUpdatedAt: await loanVersion(workspaceId, loanId),
  reason: "Contrato registrado por engano",
  ...overrides,
});

export const cancel = (uid: string, data: Record<string, unknown>) =>
  call<LoanMutationResult>(cancelLoan, uid, data);

export const metadataPayload = async (
  workspaceId: string,
  loanId: string,
  changes: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => ({
  workspaceId,
  idempotencyKey: idempotencyKey(),
  loanId,
  expectedUpdatedAt: await loanVersion(workspaceId, loanId),
  changes,
  ...overrides,
});

export const updateMetadata = (uid: string, data: Record<string, unknown>) =>
  call<LoanMutationResult>(updateLoanMetadata, uid, data);

/** Entrega a criação do espelho ao gatilho real da projeção. */
export const deliverMirror = async (
  workspaceId: string,
  transactionId: string,
): Promise<void> => {
  const after = await transactionRef(workspaceId, transactionId).get();
  assert.ok(after.exists, `espelho ${transactionId} ausente`);
  assert.ok(after.updateTime);
  await handleTransactionWrite({
    eventId: uniqueId(`evt-${transactionId}`),
    workspaceId,
    transactionId,
    eventTime: after.updateTime,
    before: undefined,
    after: after.data(),
  });
};

export type PeriodTotals = Record<string, CashPeriodDelta>;

const isZero = (delta: CashPeriodDelta) =>
  CASH_DELTA_FIELDS.every((field) => delta[field] === 0);

/** Soma recalculada do ledger inteiro: a verdade. */
export const ledgerTruth = async (
  workspaceId: string,
): Promise<PeriodTotals> => {
  const snapshot = await db()
    .collection(`workspaces/${workspaceId}/transactions`).get();
  const totals: PeriodTotals = {};
  for (const doc of snapshot.docs) {
    const key = cashPeriodKeyFor(doc.data());
    if (!key) continue;
    const delta = cashPeriodDeltaFor(doc.data());
    const bucket = totals[key] ?? normalizeCashPeriodDelta(undefined);
    for (const field of CASH_DELTA_FIELDS) bucket[field] += delta[field];
    totals[key] = bucket;
  }
  for (const [key, value] of Object.entries(totals)) {
    if (isZero(value)) delete totals[key];
  }
  return totals;
};

/** Projeção gravada, sem os estados da reconstrução e sem meses zerados. */
export const projectedTotals = async (
  workspaceId: string,
): Promise<PeriodTotals> => {
  const snapshot = await db()
    .collection(`workspaces/${workspaceId}/cash_report_periods`).get();
  const totals: PeriodTotals = {};
  for (const doc of snapshot.docs) {
    if (doc.id.startsWith("cash_periods_rebuild")) continue;
    const delta = normalizeCashPeriodDelta(doc.data());
    if (!isZero(delta)) totals[doc.id] = delta;
  }
  return totals;
};

export const monthOf = (dayKey: string): string => dayKey.slice(0, 7);
