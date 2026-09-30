import {saoPauloMonthKey} from "../shared/dateKeys";
import {
  WORKSPACE_ROLES,
  assertActiveAccountSnapshot,
  reassertWorkspaceActor,
  userProfileRef,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
import {aiUsageRef, readAiUsedCredits} from "./aiCredits";
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
 */
export interface PublicWorkspaceEntitlement extends Record<string, unknown> {
  catalogVersion: number;
  planId: PlanId;
  entitlementStatus: EntitlementStatus;
  limits: PlanLimits;
}

export const executeGetWorkspaceEntitlement = (
  actor: WorkspaceActor,
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
    const entitlement = entitlementAt(
      await transaction.get(billingAccountRef(ownerUid)),
      Date.now(),
    );
    return {
      catalogVersion: BILLING_CATALOG_VERSION,
      planId: entitlement.planId,
      entitlementStatus: entitlement.entitlementStatus,
      limits: {...entitlement.limits},
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
