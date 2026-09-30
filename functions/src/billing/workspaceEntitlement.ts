import {
  WORKSPACE_ROLES,
  assertActiveAccountSnapshot,
  reassertWorkspaceActor,
  userProfileRef,
  type WorkspaceActor,
} from "../shared/workspaceAuth";
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
 * transação.
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
}

/**
 * Uso da conta do próprio usuário: quantos workspaces ativos ele possui.
 * Serve à ajuda de UX de "criar espaço" (quota da conta); o documento de
 * quota continua backend-only e a criação decide na própria transação.
 */
export const executeGetAccountUsage = (uid: string): Promise<AccountUsage> =>
  readOnlyTransaction(async (transaction) => {
    const [profile, ownership] = await transaction.getAll(
      userProfileRef(uid),
      ownershipQuotaRef(uid),
    );
    assertActiveAccountSnapshot(profile);
    return {
      activeOwnedWorkspaces:
        readOwnershipQuota(ownership).activeOwnedWorkspaces,
    };
  });
