import type * as admin from "firebase-admin";
import {FieldValue} from "firebase-admin/firestore";

import {billingAccountRef} from "../billing/model";
import {
  QUOTA_STATE_COLLECTION,
  assertWithinQuota,
  entitlementAt,
  quotaStateUnavailable,
  readCanonicalOwner,
  type QuotaEntitlement,
} from "../billing/quota";
import {workspaceRef} from "../shared/workspaceAuth";

/**
 * Quota comercial `splitGroups` aplicada no servidor (P4-C, PR-ENT-01).
 *
 * O limite é o do plano efetivo do owner canônico do workspace (D-01) e
 * conta só grupos `active`. O contador `quota_state/split_groups` é relido e
 * regravado na transação de cada criação, arquivamento e reativação: como
 * todas disputam o mesmo documento, o Firestore as serializa e a última vaga
 * é admitida uma vez só. Downgrade nunca apaga grupo: acima do limite, os
 * dados seguem acessíveis e só criar e reativar ficam bloqueados.
 */
export const SPLIT_GROUPS_QUOTA_ID = "split_groups";
export const SPLIT_GROUPS_QUOTA_SCHEMA_VERSION = 1;

export const splitGroupsQuotaRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(QUOTA_STATE_COLLECTION)
    .doc(SPLIT_GROUPS_QUOTA_ID);

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * Grupos ativos. Sem documento: nenhum grupo foi criado ainda (o contador
 * nasce com o primeiro grupo; não há dado legado). Fora do schema: falha
 * fechada.
 */
export const readActiveSplitGroups = (
  snapshot: admin.firestore.DocumentSnapshot,
  workspaceId: string,
): number => {
  if (!snapshot.exists) return 0;
  const activeCount = snapshot.get("activeCount");
  if (
    snapshot.get("schemaVersion") !== SPLIT_GROUPS_QUOTA_SCHEMA_VERSION ||
    snapshot.get("workspaceId") !== workspaceId ||
    !isCount(activeCount)
  ) {
    throw quotaStateUnavailable();
  }
  return activeCount;
};

const writeActiveCount = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  activeCount: number,
): void => {
  if (!isCount(activeCount)) throw quotaStateUnavailable();
  transaction.set(splitGroupsQuotaRef(workspaceId), {
    workspaceId,
    activeCount,
    schemaVersion: SPLIT_GROUPS_QUOTA_SCHEMA_VERSION,
    updatedAt: FieldValue.serverTimestamp(),
  });
};

export interface SplitGroupSlotReservation {
  used: number;
  limit: number;
  entitlement: QuotaEntitlement;
  /** Grava o contador (+1); chamar depois de todas as leituras. */
  commit(): void;
}

/** Criação e reativação: uma vaga, dentro do limite do plano do titular. */
export const reserveSplitGroupSlot = async (
  transaction: admin.firestore.Transaction,
  input: {
    actorUid: string;
    workspaceId: string;
    workspace: admin.firestore.DocumentData;
    nowMs: number;
  },
): Promise<SplitGroupSlotReservation> => {
  const ownerUid = await readCanonicalOwner(transaction, input.workspaceId,
    input.workspace);
  const [billing, counter] = await transaction.getAll(
    billingAccountRef(ownerUid), splitGroupsQuotaRef(input.workspaceId));
  const entitlement = entitlementAt(billing, input.nowMs);
  const used = readActiveSplitGroups(counter, input.workspaceId);
  assertWithinQuota({
    resource: "splitGroups",
    entitlement,
    used,
    adding: 1,
    actorIsBillingOwner: input.actorUid === ownerUid,
  });
  return {
    used,
    limit: entitlement.limits.splitGroups,
    entitlement,
    commit: () => writeActiveCount(transaction, input.workspaceId, used + 1),
  };
};

/** Arquivamento: libera uma vaga (o contador nunca fica negativo). */
export const releaseSplitGroupSlot = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
): Promise<{commit(): void}> => {
  const used = readActiveSplitGroups(
    await transaction.get(splitGroupsQuotaRef(workspaceId)), workspaceId);
  if (used < 1) throw quotaStateUnavailable();
  return {commit: () => writeActiveCount(transaction, workspaceId, used - 1)};
};
