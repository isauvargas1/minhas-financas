import type {DocumentSnapshot} from "firebase-admin/firestore";

import {saoPauloMonthKey} from "../shared/dateKeys";
import {
  readActiveSplitGroups,
  splitGroupsQuotaRef,
} from "../splitBills/quota";
import {
  WORKSPACE_ROLES,
  assertActiveAccountSnapshot,
  reassertWorkspaceActor,
  userProfileRef,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import {aiUsageRef, readAiUsedCredits} from "./aiCredits";
import {
  describeTransactionQuota,
  transactionQuotaAnchorRef,
  transactionQuotaMonthRef,
  type TransactionQuotaReadStatus,
} from "./transactionQuota";
import {BILLING_CATALOG_VERSION, type PlanId, type PlanLimits} from "./catalog";
import {billingAccountRef, type EntitlementStatus} from "./model";
import {
  entitlementAt,
  ownershipQuotaRef,
  readCanonicalOwner,
  readOnlyTransaction,
  readOwnershipQuota,
} from "./quota";

/**
 * Projeção pública do entitlement de um workspace (P2B.1, PR-BILL-07).
 *
 * O plano do workspace é o do owner canônico (D-01). Qualquer membro ativo,
 * inclusive `viewer`, consulta o resultado **sem** ler o billing do owner:
 * a leitura é do backend, e a resposta leva só versão do catálogo, plano,
 * status e limites. Nunca Stripe IDs, uid do owner, datas de grace ou
 * qualquer outro campo de `billing_accounts`. Quem não é membro recebe a
 * mesma recusa de um workspace inexistente (resolvedor canônico).
 *
 * É ajuda de UX: cada operação sujeita a quota decide de novo na própria
 * transação. Não leva o uso de créditos de IA: o pool é do titular e soma
 * todos os workspaces dele, e um membro inferiria o uso de outros espaços.
 *
 * Leva o estado da quota mensal de lançamentos **deste** workspace (P3-E,
 * D-40), lido do contador do backend, e não de uma contagem do cliente. A
 * política de visibilidade é a mesma do erro de quota (P2B.1): só o titular
 * recebe `used` e `remaining`; os demais papéis recebem `limit`, o mês e se
 * o limite foi atingido (`exhausted`), suficiente para a interface orientar
 * a procurar o titular.
 */
export interface PublicTransactionsQuota extends Record<string, unknown> {
  status: TransactionQuotaReadStatus;
  /** Mês de referência (`YYYY-MM`, São Paulo, relógio do servidor). */
  periodKey: string;
  limit: number;
  /** Só para o titular e só com `status: available`. */
  used: number | null;
  /** Só para o titular e só com `status: available`. */
  remaining: number | null;
  /** Para todos os papéis, só com `status: available`. */
  exhausted: boolean | null;
}

/**
 * Grupos de divisão ativos (P4-C, quota `splitGroups`), do contador do
 * backend. Mesma política de visibilidade: `used`/`remaining` só para o
 * titular; `exhausted` para todos. Contador fora do schema: `unavailable`
 * (a criação falha fechada; esta leitura não derruba o entitlement).
 */
export interface PublicSplitGroupsQuota extends Record<string, unknown> {
  status: "available" | "unavailable";
  limit: number;
  used: number | null;
  remaining: number | null;
  exhausted: boolean | null;
}

export interface PublicWorkspaceEntitlement extends Record<string, unknown> {
  catalogVersion: number;
  planId: PlanId;
  entitlementStatus: EntitlementStatus;
  limits: PlanLimits;
  transactionsQuota: PublicTransactionsQuota;
  splitGroupsQuota: PublicSplitGroupsQuota;
}

const splitGroupsUsed = (
  snapshot: DocumentSnapshot,
  workspaceId: string,
): number | null => {
  try {
    return readActiveSplitGroups(snapshot, workspaceId);
  } catch {
    return null;
  }
};

export const executeGetWorkspaceEntitlement = (
  actor: WorkspaceActor,
  nowMs: number = Date.now(),
): Promise<PublicWorkspaceEntitlement> =>
  readOnlyTransaction(async (transaction) => {
    const {workspace} = await reassertWorkspaceActor(
      transaction,
      actor,
      WORKSPACE_ROLES,
    );
    const ownerUid = await readCanonicalOwner(
      transaction,
      actor.workspaceId,
      workspace,
    );
    const periodKey = saoPauloMonthKey(new Date(nowMs));
    const [billing, anchor, month, splitGroups] = await transaction.getAll(
      billingAccountRef(ownerUid),
      transactionQuotaAnchorRef(actor.workspaceId),
      transactionQuotaMonthRef(actor.workspaceId, periodKey),
      splitGroupsQuotaRef(actor.workspaceId),
    );
    const entitlement = entitlementAt(billing, nowMs);
    const limit = entitlement.limits.transactionsPerMonth;
    const quota = describeTransactionQuota(
      anchor,
      month,
      actor.workspaceId,
      periodKey,
    );
    const isOwner = actor.uid === ownerUid;
    const known = quota.status === "available" && quota.used !== null;
    const used = known ? quota.used as number : null;
    const splitLimit = entitlement.limits.splitGroups;
    const splitUsed = splitGroupsUsed(splitGroups, actor.workspaceId);
    return {
      catalogVersion: BILLING_CATALOG_VERSION,
      planId: entitlement.planId,
      entitlementStatus: entitlement.entitlementStatus,
      limits: {...entitlement.limits},
      transactionsQuota: {
        status: quota.status,
        periodKey,
        limit,
        used: isOwner ? used : null,
        remaining: isOwner && used !== null ?
          Math.max(0, limit - used) :
          null,
        exhausted: used === null ? null : used >= limit,
      },
      splitGroupsQuota: {
        status: splitUsed === null ? "unavailable" : "available",
        limit: splitLimit,
        used: isOwner ? splitUsed : null,
        remaining: isOwner && splitUsed !== null ?
          Math.max(0, splitLimit - splitUsed) :
          null,
        exhausted: splitUsed === null ? null : splitUsed >= splitLimit,
      },
    };
  });

export interface AccountUsage extends Record<string, unknown> {
  /** Workspaces ativos dos quais o próprio usuário é owner. */
  activeOwnedWorkspaces: number;
  /** Créditos de IA do próprio pool no mês civil (São Paulo). */
  aiCreditsUsed: number;
  aiCreditsLimit: number;
  aiCreditsRemaining: number;
  /** Mês do contador (`YYYY-MM`). */
  aiPeriodKey: string;
}

/**
 * Uso da conta do próprio usuário: quantos workspaces ativos ele possui e
 * quanto do próprio pool de créditos de IA já foi usado no mês, pelo plano
 * efetivo da própria conta (P2B.2). Serve à ajuda de UX da conta; os
 * documentos de quota continuam backend-only e cada operação decide na
 * própria transação. Só o titular consulta o próprio pool.
 */
export const executeGetAccountUsage = (
  uid: string,
  nowMs: number = Date.now(),
): Promise<AccountUsage> =>
  readOnlyTransaction(async (transaction) => {
    const periodKey = saoPauloMonthKey(new Date(nowMs));
    const [profile, ownership, billing, aiUsage] = await transaction.getAll(
      userProfileRef(uid),
      ownershipQuotaRef(uid),
      billingAccountRef(uid),
      aiUsageRef(uid, periodKey),
    );
    assertActiveAccountSnapshot(profile);
    const limit = entitlementAt(billing, nowMs).limits.aiCreditsPerMonth;
    const used = readAiUsedCredits(aiUsage, uid, periodKey);
    return {
      activeOwnedWorkspaces:
        readOwnershipQuota(ownership).activeOwnedWorkspaces,
      aiCreditsUsed: used,
      aiCreditsLimit: limit,
      aiCreditsRemaining: Math.max(0, limit - used),
      aiPeriodKey: periodKey,
    };
  });
