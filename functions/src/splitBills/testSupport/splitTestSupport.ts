import assert from "node:assert/strict";
import type * as admin from "firebase-admin";
import {Timestamp} from "firebase-admin/firestore";

import {
  seedLoanTenant,
  type LoanTenant,
} from "../../loans/testSupport/loanTestSupport";
import {
  rejectsWith,
} from "../../recurring/testSupport/recurringTestSupport";
import {formatIsoInstant} from "../../shared/commitTime";
import {
  defaultAccountOf,
  seedPaidPlan,
} from "../../shared/testSupport/kernelTestSupport";
import type {WorkspaceActor, WorkspaceRole} from "../../shared/workspaceAuth";
import {db, idempotencyKey} from "../../workspaces/testSupport/p1TestSupport";
import {
  executeCreateSplitBill,
  executeUpdateSplitBill,
  executeVoidSplitBill,
} from "../billOperations";
import type {SplitMutationResult, SplitOperationOptions} from "../common";
import {
  acceptSplitInvitePayloadSchema,
  type CreateSplitBillPayload,
  type CreateSplitGroupPayload,
  type CreateSplitReimbursementPayload,
  type UpdateSplitBillPayload,
} from "../contracts";
import {
  executeArchiveSplitGroup,
  executeCreateSplitGroup,
  executeReactivateSplitGroup,
  executeUpdateSplitGroup,
} from "../groupOperations";
import {
  SPLIT_BILLS_COLLECTION,
  SPLIT_EVENTS_COLLECTION,
  SPLIT_GROUPS_COLLECTION,
  SPLIT_INVITES_COLLECTION,
  SPLIT_PARTICIPANTS_COLLECTION,
  SPLIT_REIMBURSEMENTS_COLLECTION,
  SPLIT_SHARES_COLLECTION,
  readAuthoritativeBill,
  readAuthoritativeGroup,
  readAuthoritativeParticipant,
  readAuthoritativeReimbursement,
  readAuthoritativeShare,
  splitMemberParticipantIdFor,
  splitShareIdFor,
} from "../model";
import {
  executeAcceptSplitGroupInvite,
  executeAddExternalSplitParticipant,
  executeAddWorkspaceSplitParticipant,
  executeCreateSplitGroupInvite,
  executeDeactivateSplitParticipant,
  executeRevokeSplitGroupInvite,
} from "../participantOperations";
import {reconstructGroupAggregates} from "../reconciliation";
import {
  executeApproveSplitReimbursement,
  executeCancelSplitReimbursement,
  executeCreateSplitReimbursement,
  executePaySplitReimbursement,
  executeRejectSplitReimbursement,
  executeReverseReimbursementPayment,
} from "../reimbursementOperations";
import {
  executeForgiveSplitShare,
  executeReverseSplitShareSettlement,
  executeSettleSplitShare,
} from "../shareOperations";

/** Apoio das suítes da Divisão de contas (P4-C), só no Emulator. */

export {defaultAccountOf, idempotencyKey, rejectsWith};
export type SplitTenant = LoanTenant;

/**
 * Tenant com owner, admin, dois members e viewer. Plano Business por
 * padrão (100 grupos), para as suítes que não exercitam a quota.
 */
export const seedSplitTenant = async (
  type: "PF" | "PJ" = "PF",
  prefix = "split",
  plan: "free" | "pro" | "business" = "business",
): Promise<SplitTenant> => {
  const tenant = await seedLoanTenant(type, prefix);
  if (plan !== "free") await seedPaidPlan(tenant.owner, plan);
  return tenant;
};

export const TODAY = "2026-10-07";

/** Relógio fixo ao meio-dia em São Paulo (15:00Z) do dia informado. */
export const clockAt = (dayKey: string = TODAY): SplitOperationOptions => ({
  now: () => Date.parse(`${dayKey}T15:00:00.000Z`),
});

export const actorOf = (
  tenant: SplitTenant,
  uid: string,
  role?: WorkspaceRole,
): WorkspaceActor => ({
  uid,
  workspaceId: tenant.workspaceId,
  role: role ?? roleOf(tenant, uid),
});

/** Papel semeado do usuário no tenant. */
export const roleOf = (tenant: SplitTenant, uid: string): WorkspaceRole =>
  uid === tenant.owner ? "owner" :
    uid === tenant.admin ? "admin" :
      uid === tenant.viewer ? "viewer" : "member";

let requestCounter = 0;
export const requestId = (): string => `req-split-${++requestCounter}`;

export const VISUAL = {color: "#6366f1", icon: "Users", emoji: null};

// ------------------------------------------------------------- referências

const ws = (workspaceId: string) => db().doc(`workspaces/${workspaceId}`);
const collectionOf = (workspaceId: string, name: string) =>
  ws(workspaceId).collection(name);

export const groupRef = (workspaceId: string, id: string) =>
  collectionOf(workspaceId, SPLIT_GROUPS_COLLECTION).doc(id);
export const participantRef = (workspaceId: string, id: string) =>
  collectionOf(workspaceId, SPLIT_PARTICIPANTS_COLLECTION).doc(id);
export const billRef = (workspaceId: string, id: string) =>
  collectionOf(workspaceId, SPLIT_BILLS_COLLECTION).doc(id);
export const shareRef = (workspaceId: string, id: string) =>
  collectionOf(workspaceId, SPLIT_SHARES_COLLECTION).doc(id);
export const reimbursementRef = (workspaceId: string, id: string) =>
  collectionOf(workspaceId, SPLIT_REIMBURSEMENTS_COLLECTION).doc(id);
export const inviteRef = (workspaceId: string, id: string) =>
  collectionOf(workspaceId, SPLIT_INVITES_COLLECTION).doc(id);
export const transactionRef = (workspaceId: string, id: string) =>
  ws(workspaceId).collection("transactions").doc(id);
export const accountRef = (workspaceId: string, id: string) =>
  ws(workspaceId).collection("cash_accounts").doc(id);
export const splitQuotaRef = (workspaceId: string) =>
  ws(workspaceId).collection("quota_state").doc("split_groups");

export const readDoc = async (ref: admin.firestore.DocumentReference) =>
  (await ref.get()).data() ?? {};
export const exists = async (ref: admin.firestore.DocumentReference) =>
  (await ref.get()).exists;

export const versionOf = async (
  ref: admin.firestore.DocumentReference,
): Promise<string> => {
  const updatedAt = (await ref.get()).get("updatedAt");
  assert.ok(updatedAt instanceof Timestamp, `${ref.path} sem updatedAt`);
  return formatIsoInstant(updatedAt);
};

export const memberParticipantId = (
  tenant: SplitTenant,
  groupId: string,
  uid: string,
): string => splitMemberParticipantIdFor(tenant.workspaceId, groupId, uid);

export const shareIdOf = (
  tenant: SplitTenant,
  billId: string,
  participantId: string,
): string => splitShareIdFor(tenant.workspaceId, billId, participantId);

export const balanceOf = async (workspaceId: string, accountId: string) =>
  Number((await readDoc(accountRef(workspaceId, accountId))).balanceCents);

export const activeSplitGroups = async (workspaceId: string) =>
  Number((await readDoc(splitQuotaRef(workspaceId))).activeCount ?? 0);

const listWhere = async (
  workspaceId: string,
  collection: string,
  field?: string,
  value?: string,
): Promise<admin.firestore.QueryDocumentSnapshot[]> => {
  let query: admin.firestore.Query = collectionOf(workspaceId, collection);
  if (field) query = query.where(field, "==", value);
  return (await query.get()).docs;
};

export const eventsOf = async (workspaceId: string, groupId?: string) =>
  (await listWhere(workspaceId, SPLIT_EVENTS_COLLECTION,
    groupId ? "groupId" : undefined, groupId))
    .map((doc) => doc.data());
export const sharesOfBill = async (workspaceId: string, billId: string) =>
  (await listWhere(workspaceId, SPLIT_SHARES_COLLECTION, "billId", billId))
    .map((doc) => doc.data())
    .sort((a, b) => String(a.participantId).localeCompare(b.participantId));
export const countOf = async (workspaceId: string, collection: string) =>
  (await collectionOf(workspaceId, collection).count().get()).data().count;
export const transactionsOf = async (workspaceId: string) =>
  (await ws(workspaceId).collection("transactions").get()).docs
    .map((doc) =>
      ({id: doc.id, ...doc.data()}) as admin.firestore.DocumentData);

// --------------------------------------------------------------- operações

/** O resultado traz o identificador esperado (não nulo). */
const withId = <K extends keyof SplitMutationResult>(key: K) =>
  async (promise: Promise<SplitMutationResult>) => {
    const result = await promise;
    const value = result[key];
    assert.equal(typeof value, "string", `resultado sem ${String(key)}`);
    return result as SplitMutationResult & Record<K, string>;
  };
const withBillId = withId("billId");
const withParticipantId = withId("participantId");
const withReimbursementId = withId("reimbursementId");
const withInviteId = withId("inviteId");

export const groupPayload = (
  tenant: SplitTenant,
  overrides: Partial<CreateSplitGroupPayload> = {},
): CreateSplitGroupPayload => ({
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  name: "Viagem",
  description: null,
  groupType: "temporary",
  businessMode: "split",
  visual: VISUAL,
  ...overrides,
} as CreateSplitGroupPayload);

export const createGroup = (
  tenant: SplitTenant,
  overrides: Partial<CreateSplitGroupPayload> = {},
  uid = tenant.owner,
  options: SplitOperationOptions = clockAt(),
) => executeCreateSplitGroup(actorOf(tenant, uid),
  groupPayload(tenant, overrides), requestId(), options);

export const updateGroup = async (
  tenant: SplitTenant,
  groupId: string,
  changes: Record<string, unknown>,
  uid = tenant.owner,
) => executeUpdateSplitGroup(actorOf(tenant, uid), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  groupId,
  expectedUpdatedAt: await versionOf(groupRef(tenant.workspaceId, groupId)),
  changes,
} as Parameters<typeof executeUpdateSplitGroup>[1], requestId(), clockAt());

const groupLifecycle = (execute: typeof executeArchiveSplitGroup) => async (
  tenant: SplitTenant,
  groupId: string,
  uid = tenant.owner,
  options: SplitOperationOptions = clockAt(),
) => execute(actorOf(tenant, uid), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  groupId,
  expectedUpdatedAt: await versionOf(groupRef(tenant.workspaceId, groupId)),
}, requestId(), options);

export const archiveGroup = groupLifecycle(executeArchiveSplitGroup);
export const reactivateGroup = groupLifecycle(executeReactivateSplitGroup);

export const addMember = (
  tenant: SplitTenant,
  groupId: string,
  userId: string,
  role: "participant" | "viewer" = "participant",
  uid = tenant.owner,
) => executeAddWorkspaceSplitParticipant(actorOf(tenant, uid), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  groupId,
  userId,
  role,
}, requestId(), clockAt());

export const addExternal = (
  tenant: SplitTenant,
  groupId: string,
  displayName = "Convidado externo",
  uid = tenant.owner,
) => withParticipantId(executeAddExternalSplitParticipant(
  actorOf(tenant, uid), {
    workspaceId: tenant.workspaceId,
    idempotencyKey: idempotencyKey(),
    groupId,
    displayName,
  }, requestId(), clockAt()));

export const deactivateParticipant = async (
  tenant: SplitTenant,
  groupId: string,
  participantId: string,
  uid = tenant.owner,
) => executeDeactivateSplitParticipant(actorOf(tenant, uid), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  groupId,
  participantId,
  expectedUpdatedAt: await versionOf(
    participantRef(tenant.workspaceId, participantId)),
}, requestId(), clockAt());

export const createInvite = (
  tenant: SplitTenant,
  groupId: string,
  role: "participant" | "viewer" = "participant",
  uid = tenant.owner,
  options: SplitOperationOptions = clockAt(),
) => withInviteId(executeCreateSplitGroupInvite(actorOf(tenant, uid), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  groupId,
  role,
}, requestId(), options));

export const revokeInvite = (
  tenant: SplitTenant,
  groupId: string,
  inviteId: string,
  uid = tenant.owner,
) => executeRevokeSplitGroupInvite(actorOf(tenant, uid), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  groupId,
  inviteId,
}, requestId(), clockAt());

export const acceptInvite = (
  tenant: SplitTenant,
  code: string,
  uid: string,
  options: SplitOperationOptions = clockAt(),
  key = idempotencyKey(),
) => executeAcceptSplitGroupInvite(actorOf(tenant, uid),
  // Como a callable: o contrato normaliza o código (sem hífen, maiúsculo).
  acceptSplitInvitePayloadSchema.parse({
    workspaceId: tenant.workspaceId,
    idempotencyKey: key,
    code,
  }), requestId(), options);

/** Grupo com o owner (dono) e os dois members como participantes. */
export const seedGroupWithMembers = async (
  tenant: SplitTenant,
  overrides: Partial<CreateSplitGroupPayload> = {},
) => {
  const {groupId} = await createGroup(tenant, overrides);
  await addMember(tenant, groupId, tenant.member);
  await addMember(tenant, groupId, tenant.otherMember);
  return {
    groupId,
    owner: memberParticipantId(tenant, groupId, tenant.owner),
    member: memberParticipantId(tenant, groupId, tenant.member),
    otherMember: memberParticipantId(tenant, groupId, tenant.otherMember),
  };
};

export const billPayload = (
  tenant: SplitTenant,
  groupId: string,
  payerParticipantId: string,
  participantIds: string[],
  overrides: Partial<CreateSplitBillPayload> = {},
): CreateSplitBillPayload => ({
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  groupId,
  description: "Jantar",
  category: "Alimentação",
  amountCents: 10_000,
  expenseDate: TODAY,
  payerParticipantId,
  allocationMethod: "equal",
  participants: participantIds.map((participantId) => ({participantId})),
  financialIntegration: "none",
  cashAccountId: null,
  cardId: null,
  installmentsCount: null,
  ...overrides,
} as CreateSplitBillPayload);

export const createBill = (
  tenant: SplitTenant,
  payload: CreateSplitBillPayload,
  uid = tenant.owner,
  options: SplitOperationOptions = clockAt(),
) => withBillId(executeCreateSplitBill(actorOf(tenant, uid), payload,
  requestId(), options));

export const updateBill = async (
  tenant: SplitTenant,
  billId: string,
  changes: Pick<UpdateSplitBillPayload, "metadata" | "terms">,
  uid = tenant.owner,
  options: SplitOperationOptions = clockAt(),
) => executeUpdateSplitBill(actorOf(tenant, uid), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  billId,
  expectedUpdatedAt: await versionOf(billRef(tenant.workspaceId, billId)),
  ...changes,
} as UpdateSplitBillPayload, requestId(), options);

export const voidBill = async (
  tenant: SplitTenant,
  billId: string,
  uid = tenant.owner,
  options: SplitOperationOptions = clockAt(),
) => executeVoidSplitBill(actorOf(tenant, uid), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  billId,
  expectedUpdatedAt: await versionOf(billRef(tenant.workspaceId, billId)),
}, requestId(), options);

const shareAction = (execute: typeof executeSettleSplitShare) => async (
  tenant: SplitTenant,
  shareId: string,
  uid = tenant.owner,
) => execute(actorOf(tenant, uid), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  shareId,
  expectedUpdatedAt: await versionOf(shareRef(tenant.workspaceId, shareId)),
}, requestId(), clockAt());

export const settleShare = shareAction(executeSettleSplitShare);
export const reverseSettlement = shareAction(
  executeReverseSplitShareSettlement);

export const forgiveShare = async (
  tenant: SplitTenant,
  shareId: string,
  uid = tenant.owner,
  reason = "Acerto entre amigos",
) => executeForgiveSplitShare(actorOf(tenant, uid), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  shareId,
  expectedUpdatedAt: await versionOf(shareRef(tenant.workspaceId, shareId)),
  reason,
}, requestId(), clockAt());

export const reimbursementPayload = (
  tenant: SplitTenant,
  groupId: string,
  requesterParticipantId: string,
  overrides: Partial<CreateSplitReimbursementPayload> = {},
): CreateSplitReimbursementPayload => ({
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  groupId,
  requesterParticipantId,
  description: "Táxi para o cliente",
  category: "Transporte",
  amountCents: 8_750,
  expenseDate: TODAY,
  ...overrides,
} as CreateSplitReimbursementPayload);

export const createReimbursement = (
  tenant: SplitTenant,
  payload: CreateSplitReimbursementPayload,
  uid = tenant.owner,
) => withReimbursementId(executeCreateSplitReimbursement(
  actorOf(tenant, uid), payload, requestId(), clockAt()));

const reimbursementAction = (
  execute: typeof executeApproveSplitReimbursement,
) => async (
  tenant: SplitTenant,
  reimbursementId: string,
  uid = tenant.owner,
) => execute(actorOf(tenant, uid), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  reimbursementId,
  expectedUpdatedAt: await versionOf(
    reimbursementRef(tenant.workspaceId, reimbursementId)),
}, requestId(), clockAt());

export const approveReimbursement = reimbursementAction(
  executeApproveSplitReimbursement);
export const cancelReimbursement = reimbursementAction(
  executeCancelSplitReimbursement);
export const reverseReimbursementPayment = reimbursementAction(
  executeReverseReimbursementPayment);

export const rejectReimbursement = async (
  tenant: SplitTenant,
  reimbursementId: string,
  uid = tenant.owner,
  reason: string | null = "Fora da política",
) => executeRejectSplitReimbursement(actorOf(tenant, uid), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  reimbursementId,
  expectedUpdatedAt: await versionOf(
    reimbursementRef(tenant.workspaceId, reimbursementId)),
  reason,
}, requestId(), clockAt());

export const payReimbursement = async (
  tenant: SplitTenant,
  reimbursementId: string,
  uid = tenant.owner,
  extra: {cashAccountId?: string; paymentDate?: string} = {},
) => executePaySplitReimbursement(actorOf(tenant, uid), {
  workspaceId: tenant.workspaceId,
  idempotencyKey: idempotencyKey(),
  reimbursementId,
  expectedUpdatedAt: await versionOf(
    reimbursementRef(tenant.workspaceId, reimbursementId)),
  cashAccountId: extra.cashAccountId ?? defaultAccountOf(tenant.workspaceId),
  paymentDate: extra.paymentDate ?? TODAY,
}, requestId(), clockAt());

// ------------------------------------------------------------- conferência

/**
 * Todos os documentos do grupo passam pelos leitores autoritativos e os
 * agregados gravados (grupo, participantes e títulos) batem com a
 * reconstrução a partir das fontes.
 */
export const assertSplitReconciles = async (
  workspaceId: string,
  groupId: string,
): Promise<void> => {
  const read = async <T>(
    collection: string,
    reader: (id: string, data: admin.firestore.DocumentData,
      workspaceId: string) => T | null,
  ): Promise<T[]> => (await listWhere(workspaceId, collection, "groupId",
    groupId)).map((doc) => {
    const value = reader(doc.id, doc.data(), workspaceId);
    assert.ok(value, `${collection}/${doc.id} fora do schema`);
    return value;
  });
  const groupSnapshot = await groupRef(workspaceId, groupId).get();
  const group = readAuthoritativeGroup(groupId, groupSnapshot.data(),
    workspaceId);
  assert.ok(group, "grupo fora do schema");
  const participants = await read(SPLIT_PARTICIPANTS_COLLECTION,
    readAuthoritativeParticipant);
  const bills = await read(SPLIT_BILLS_COLLECTION, readAuthoritativeBill);
  const shares = await read(SPLIT_SHARES_COLLECTION, readAuthoritativeShare);
  const reimbursements = await read(SPLIT_REIMBURSEMENTS_COLLECTION,
    readAuthoritativeReimbursement);
  const expected = reconstructGroupAggregates({participants, bills, shares,
    reimbursements});
  assert.deepEqual(group.counters, expected.counters, "contadores do grupo");
  assert.deepEqual(group.totals, expected.totals, "totais do grupo");
  for (const participant of participants) {
    const want = expected.participants.get(participant.id);
    assert.deepEqual({
      balances: participant.balances,
      openShareCount: participant.openShareCount,
      openReceivableCount: participant.openReceivableCount,
      openReimbursementCount: participant.openReimbursementCount,
    }, want, `saldos do participante ${participant.id}`);
  }
  for (const bill of bills) {
    const want = expected.bills.get(bill.id);
    assert.ok(want);
    if (bill.status !== "voided") {
      assert.equal(want.dueSumCents, bill.amountCents,
        `Σ rateios do título ${bill.id}`);
    }
    assert.equal(bill.status, want.status, `estado do título ${bill.id}`);
    assert.equal(bill.openShareCount, want.openShareCount);
    assert.equal(bill.outstandingCents, want.outstandingCents);
    if (bill.status !== "voided") {
      assert.equal(bill.resolvedShareCount, want.resolvedShareCount);
    }
  }
};
