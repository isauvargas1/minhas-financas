import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {ApplicationError} from "../shared/errors";
import {memberIdSchema} from "../shared/ids";
import {workspaceMemberRef, workspaceRef} from "../shared/workspaceAuth";
import {
  PLAN_IDS,
  planLimits,
  type PlanId,
  type PlanLimits,
} from "./catalog";
import {
  effectiveEntitlement,
  type EntitlementDecision,
  type StoredEntitlement,
} from "./entitlements";
import {billingAccountRef} from "./model";

/**
 * Quotas de plano aplicadas no servidor (P2B.1, D-01, D-08).
 *
 * O plano do **owner** governa todos os workspaces de que ele é owner. Toda
 * decisão lê o `billing_accounts/{owner}` e o estado de quota **dentro da
 * transação da operação autoritativa**, reavalia o entitlement com o relógio
 * do servidor (`effectiveEntitlement`: grace e cancelamento vencem sem novo
 * webhook) e grava o contador no mesmo commit. Duas operações concorrentes
 * sobre o último slot leem o mesmo documento de quota; a perdedora é
 * repetida pelo Firestore, relê o contador e é recusada.
 *
 * Estado server-only (Rules negam leitura e escrita do cliente):
 *
 * - `billing_accounts/{ownerUid}/quota_state/ownership`:
 *   `activeOwnedWorkspaces` = workspaces `active` cujo owner canônico é o
 *   titular. Criado pelo primeiro `bootstrapAccount` (valor 1); incrementado
 *   por `createWorkspace`, pela restauração do espaço pessoal e pelo destino
 *   da transferência; decrementado pelo arquivamento e pela origem da
 *   transferência.
 * - `workspaces/{workspaceId}/quota_state/membership`:
 *   `activeMembers` (inclui o owner) e `pendingReservations`
 *   (`inviteId → expiresAt`): cada convite pendente reserva uma vaga até
 *   expirar, ser revogado, substituído ou aceito. Reservas vencidas são
 *   descartadas preguiçosamente na próxima operação que lê o documento, sem
 *   cron. O mapa é limitado: um convite só nasce com
 *   `activeMembers + reservas + 1 <= membersPerWorkspace`, cujo teto no
 *   catálogo é `MAX_PENDING_RESERVATIONS`.
 *
 * Sem reconstrução por varredura, sem contagem de coleção e sem fallback: o
 * estado nasce com a conta e com o workspace. Estado ausente ou malformado
 * onde deveria existir falha fechado (`internal`); ambientes de teste
 * anteriores à P2B precisam ser recriados.
 */
export const QUOTA_STATE_COLLECTION = "quota_state";
export const OWNERSHIP_QUOTA_ID = "ownership";
export const MEMBERSHIP_QUOTA_ID = "membership";
export const QUOTA_SCHEMA_VERSION = 1;

export const QUOTA_EXCEEDED_MESSAGE =
  "Limite do plano atingido. Faça upgrade em Meu Plano para continuar.";

/**
 * Na transferência quem precisa de capacidade é o **destino**; o upgrade do
 * owner atual não resolveria. Os detalhes não levam plano nem uso do
 * destinatário, que são dados da conta de outra pessoa.
 */
export const TRANSFER_QUOTA_EXCEEDED_MESSAGE =
  "O plano do novo titular não comporta este espaço. Para receber a " +
  "titularidade, ele precisa fazer upgrade em Meu Plano.";

export const QUOTA_STATE_UNAVAILABLE_MESSAGE =
  "Não foi possível verificar os limites do plano. Tente novamente em " +
  "instantes.";

/** Recursos com quota nesta etapa: nomes das chaves de `PlanLimits`. */
export type QuotaResource = Extract<
  keyof PlanLimits,
  "workspaces" | "membersPerWorkspace"
>;

/** Teto do mapa de reservas: o maior `membersPerWorkspace` do catálogo. */
export const MAX_PENDING_RESERVATIONS = Math.max(
  ...PLAN_IDS.map((planId) => planLimits(planId).membersPerWorkspace),
);

const db = () => admin.firestore();

type Snapshot = admin.firestore.DocumentSnapshot;

/** Estado de quota ou de owner canônico incoerente: falha fechada. */
export const quotaStateUnavailable = (): ApplicationError =>
  new ApplicationError("internal", QUOTA_STATE_UNAVAILABLE_MESSAGE);

export interface QuotaExceededDetails {
  resource: QuotaResource;
  planId: PlanId;
  limit: number;
  used: number;
}

export const quotaExceeded = (details: QuotaExceededDetails) =>
  new ApplicationError("quota_exceeded", QUOTA_EXCEEDED_MESSAGE, {
    resource: details.resource,
    planId: details.planId,
    limit: details.limit,
    used: details.used,
  });

export const transferQuotaExceeded = (resource: QuotaResource) =>
  new ApplicationError("quota_exceeded", TRANSFER_QUOTA_EXCEEDED_MESSAGE, {
    resource,
  });

// ---------------------------------------------------------------------------
// Entitlement efetivo do titular
// ---------------------------------------------------------------------------

export interface QuotaEntitlement extends EntitlementDecision {
  limits: PlanLimits;
}

const millisOf = (value: unknown): number | null =>
  value instanceof Timestamp ? value.toMillis() : null;

export const storedEntitlementOf = (
  data: admin.firestore.DocumentData,
): StoredEntitlement => ({
  planId: data.planId,
  entitlementStatus: data.entitlementStatus,
  graceUntilMs: millisOf(data.graceUntil),
  currentPeriodEndMs: millisOf(data.currentPeriodEnd),
  cancelAtPeriodEnd: data.cancelAtPeriodEnd === true,
  cancelAtMs: millisOf(data.cancelAt),
});

/**
 * Entitlement e limites **agora** a partir do billing lido na transação.
 * Nunca usa `planId` cru: grace e cancelamento agendado vencem sem webhook.
 */
export const entitlementAt = (
  billing: Snapshot,
  nowMs: number,
): QuotaEntitlement => {
  const data = billing.data();
  if (!billing.exists || !data) throw quotaStateUnavailable();
  const decision = effectiveEntitlement(storedEntitlementOf(data), nowMs);
  return {...decision, limits: planLimits(decision.planId)};
};

/**
 * Exige `used + adding <= limite do recurso`. `used` já inclui tudo o que
 * ocupa o recurso (membros ativos e reservas vigentes, por exemplo).
 */
export const assertWithinQuota = (input: {
  resource: QuotaResource;
  entitlement: QuotaEntitlement;
  used: number;
  adding: number;
}): void => {
  const limit = input.entitlement.limits[input.resource];
  if (input.used + input.adding > limit) {
    throw quotaExceeded({
      resource: input.resource,
      planId: input.entitlement.planId,
      limit,
      used: input.used,
    });
  }
};

// ---------------------------------------------------------------------------
// Owner canônico do workspace (entidade pagadora)
// ---------------------------------------------------------------------------

/**
 * Owner que paga pelo workspace. `workspace.ownerId` só aponta o candidato:
 * ele vale apenas se existir membership `active` com papel `owner` para esse
 * uid. Qualquer divergência falha fechado — sem adivinhar o owner por outro
 * caminho e sem varrer a coleção de membros. Não autoriza ninguém: a
 * autorização do ator continua sendo o resolvedor de `workspaceAuth.ts`.
 */
export const readCanonicalOwner = async (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  workspace: admin.firestore.DocumentData,
): Promise<string> => {
  const ownerUid = canonicalOwnerCandidate(workspace);
  assertCanonicalOwnerMembership(await transaction.get(
    workspaceMemberRef(workspaceId, ownerUid),
  ));
  return ownerUid;
};

/**
 * Primeira metade de `readCanonicalOwner`, para quem lê o membership do
 * candidato no mesmo `getAll` das demais leituras da transação (menos idas
 * ao banco, janela de contenção menor). O resultado só vale depois de
 * `assertCanonicalOwnerMembership` sobre esse membership.
 */
export const canonicalOwnerCandidate = (
  workspace: admin.firestore.DocumentData,
): string => {
  const parsed = memberIdSchema.safeParse(workspace.ownerId);
  if (!parsed.success) throw quotaStateUnavailable();
  return parsed.data;
};

export const assertCanonicalOwnerMembership = (member: Snapshot): void => {
  if (
    !member.exists ||
    member.get("status") !== "active" ||
    member.get("role") !== "owner"
  ) {
    throw quotaStateUnavailable();
  }
};

// ---------------------------------------------------------------------------
// Quota de workspaces próprios (por titular)
// ---------------------------------------------------------------------------

export interface OwnershipQuota {
  activeOwnedWorkspaces: number;
}

export const ownershipQuotaRef = (
  uid: string,
): admin.firestore.DocumentReference =>
  billingAccountRef(uid)
    .collection(QUOTA_STATE_COLLECTION)
    .doc(OWNERSHIP_QUOTA_ID);

const isCount = (value: unknown, min: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= min;

export const readOwnershipQuota = (snapshot: Snapshot): OwnershipQuota => {
  const count = snapshot.get("activeOwnedWorkspaces");
  if (
    !snapshot.exists ||
    snapshot.get("schemaVersion") !== QUOTA_SCHEMA_VERSION ||
    !isCount(count, 0)
  ) {
    throw quotaStateUnavailable();
  }
  return {activeOwnedWorkspaces: count};
};

export const writeOwnershipQuota = (
  transaction: admin.firestore.Transaction,
  uid: string,
  activeOwnedWorkspaces: number,
  mode: "create" | "set" = "set",
): void => {
  if (!isCount(activeOwnedWorkspaces, 0)) throw quotaStateUnavailable();
  const document = {
    billingOwnerUid: uid,
    activeOwnedWorkspaces,
    schemaVersion: QUOTA_SCHEMA_VERSION,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (mode === "create") {
    transaction.create(ownershipQuotaRef(uid), document);
  } else {
    transaction.set(ownershipQuotaRef(uid), document);
  }
};

/** Decremento que nunca deixa o contador negativo: abaixo de 1 é incoerente. */
export const releasedOwnership = (quota: OwnershipQuota): number => {
  if (quota.activeOwnedWorkspaces < 1) throw quotaStateUnavailable();
  return quota.activeOwnedWorkspaces - 1;
};

// ---------------------------------------------------------------------------
// Quota de membros e reservas de convite (por workspace)
// ---------------------------------------------------------------------------

export interface MembershipQuota {
  activeMembers: number;
  /** `inviteId → expiresAt` em milissegundos. */
  pendingReservations: Map<string, number>;
}

export const membershipQuotaRef = (
  workspaceId: string,
): admin.firestore.DocumentReference =>
  workspaceRef(workspaceId)
    .collection(QUOTA_STATE_COLLECTION)
    .doc(MEMBERSHIP_QUOTA_ID);

export const readMembershipQuota = (snapshot: Snapshot): MembershipQuota => {
  const activeMembers = snapshot.get("activeMembers");
  const raw = snapshot.get("pendingReservations");
  if (
    !snapshot.exists ||
    snapshot.get("schemaVersion") !== QUOTA_SCHEMA_VERSION ||
    !isCount(activeMembers, 1) ||
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw)
  ) {
    throw quotaStateUnavailable();
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_PENDING_RESERVATIONS) throw quotaStateUnavailable();
  const pendingReservations = new Map<string, number>();
  for (const [inviteId, expiresAt] of entries) {
    if (!(expiresAt instanceof Timestamp)) throw quotaStateUnavailable();
    pendingReservations.set(inviteId, expiresAt.toMillis());
  }
  return {activeMembers, pendingReservations};
};

/**
 * Reservas que ainda ocupam vaga: sem as vencidas (`expiresAt <= agora`,
 * mesmo critério do aceite) e sem as dos convites que a própria operação
 * encerra (revogados, substituídos, aceitos).
 */
export const liveReservations = (
  quota: MembershipQuota,
  nowMs: number,
  released: Iterable<string> = [],
): Map<string, number> => {
  const drop = new Set(released);
  const live = new Map<string, number>();
  for (const [inviteId, expiresAtMs] of quota.pendingReservations) {
    if (expiresAtMs > nowMs && !drop.has(inviteId)) {
      live.set(inviteId, expiresAtMs);
    }
  }
  return live;
};

const membershipQuotaDocument = (
  workspaceId: string,
  activeMembers: number,
  reservations: Map<string, number>,
) => {
  if (
    !isCount(activeMembers, 1) ||
    reservations.size > MAX_PENDING_RESERVATIONS
  ) {
    throw quotaStateUnavailable();
  }
  return {
    workspaceId,
    activeMembers,
    pendingReservations: Object.fromEntries(
      [...reservations].map(([inviteId, expiresAtMs]) =>
        [inviteId, Timestamp.fromMillis(expiresAtMs)]),
    ),
    schemaVersion: QUOTA_SCHEMA_VERSION,
    updatedAt: FieldValue.serverTimestamp(),
  };
};

/** Estado inicial de todo workspace novo: só o owner, nenhuma reserva. */
export const createMembershipQuota = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
): void => {
  transaction.create(
    membershipQuotaRef(workspaceId),
    membershipQuotaDocument(workspaceId, 1, new Map()),
  );
};

/** Regrava o documento inteiro (o mapa já sai sem as reservas encerradas). */
export const writeMembershipQuota = (
  transaction: admin.firestore.Transaction,
  workspaceId: string,
  activeMembers: number,
  reservations: Map<string, number>,
): void => {
  transaction.set(
    membershipQuotaRef(workspaceId),
    membershipQuotaDocument(workspaceId, activeMembers, reservations),
  );
};

/** Saída de um membro ativo: nunca deixa o workspace sem o owner contado. */
export const releasedMember = (quota: MembershipQuota): number => {
  if (quota.activeMembers < 2) throw quotaStateUnavailable();
  return quota.activeMembers - 1;
};

/** Leitura fora de mutação (callables de consulta). */
export const readOnlyTransaction = <T>(
  run: (transaction: admin.firestore.Transaction) => Promise<T>,
): Promise<T> => db().runTransaction(run, {readOnly: true});
