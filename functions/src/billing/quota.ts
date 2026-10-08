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
 * - Créditos mensais de IA do titular (P2B.2): `aiCredits.ts`, consumidos
 *   pela admissão de `ai/admission.ts`.
 * - Lançamentos manuais por mês civil do workspace (P3-D, D-40):
 *   `transactionQuota.ts`, consumidos pela criação e pela importação de
 *   lançamentos de caixa.
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
 * Quem esbarra no limite sem ser o titular (admin que convida, convidado que
 * aceita, membro que usa IA) não resolve com upgrade do próprio plano: o
 * limite é do plano de quem paga pelo espaço (D-01).
 */
export const QUOTA_EXCEEDED_NON_OWNER_MESSAGE =
  "Este espaço atingiu o limite do plano do titular. Peça ao titular do " +
  "espaço para fazer upgrade em Meu Plano.";

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

/** Créditos mensais de IA esgotados no pool do titular (P2B.2). */
export const AI_CREDITS_EXHAUSTED_MESSAGE =
  "Os créditos de IA deste plano acabaram neste mês. Faça upgrade ou " +
  "aguarde o início do próximo mês.";

/** Créditos esgotados vistos por quem não é o titular do espaço. */
export const AI_CREDITS_EXHAUSTED_NON_OWNER_MESSAGE =
  "Os créditos de IA do plano do titular deste espaço acabaram neste mês. " +
  "Peça ao titular para fazer upgrade ou aguarde o início do próximo mês.";

/**
 * Lançamentos do mês esgotados no workspace (P3-D, D-40). O limite é do
 * plano do titular e vale por workspace; o contador recomeça no mês civil
 * seguinte de São Paulo.
 */
export const TRANSACTIONS_QUOTA_EXHAUSTED_MESSAGE =
  "Este espaço atingiu o limite de lançamentos do seu plano neste mês. Faça " +
  "upgrade em Meu Plano ou aguarde o início do próximo mês.";

/**
 * Visto por quem não é o titular: o upgrade da própria conta não muda o
 * limite do espaço, que é do plano de quem paga por ele (D-01).
 */
export const TRANSACTIONS_QUOTA_EXHAUSTED_NON_OWNER_MESSAGE =
  "Este espaço atingiu o limite mensal de lançamentos do plano do titular. " +
  "Fale com o titular do espaço ou aguarde o início do próximo mês.";

/**
 * Grupos de divisão ativos no workspace (P4-C). Arquivar libera a vaga;
 * reativar consome de novo; downgrade nunca apaga grupo existente.
 */
export const SPLIT_GROUPS_QUOTA_EXHAUSTED_MESSAGE =
  "Este espaço atingiu o limite de grupos de divisão ativos do seu plano. " +
  "Arquive um grupo ou faça upgrade em Meu Plano.";

/** Visto por quem não é o titular: o limite é do plano do titular (D-01). */
export const SPLIT_GROUPS_QUOTA_EXHAUSTED_NON_OWNER_MESSAGE =
  "Este espaço atingiu o limite de grupos de divisão ativos do plano do " +
  "titular. Fale com o titular do espaço ou arquive um grupo.";

/** Recursos com quota no servidor: nomes das chaves de `PlanLimits`. */
export type QuotaResource = Extract<
  keyof PlanLimits,
  | "workspaces"
  | "membersPerWorkspace"
  | "aiCreditsPerMonth"
  | "transactionsPerMonth"
  | "splitGroups"
>;

const QUOTA_MESSAGE_BY_RESOURCE: Partial<Record<QuotaResource, string>> = {
  aiCreditsPerMonth: AI_CREDITS_EXHAUSTED_MESSAGE,
  transactionsPerMonth: TRANSACTIONS_QUOTA_EXHAUSTED_MESSAGE,
  splitGroups: SPLIT_GROUPS_QUOTA_EXHAUSTED_MESSAGE,
};

const NON_OWNER_QUOTA_MESSAGE_BY_RESOURCE:
  Partial<Record<QuotaResource, string>> = {
    aiCreditsPerMonth: AI_CREDITS_EXHAUSTED_NON_OWNER_MESSAGE,
    transactionsPerMonth: TRANSACTIONS_QUOTA_EXHAUSTED_NON_OWNER_MESSAGE,
    splitGroups: SPLIT_GROUPS_QUOTA_EXHAUSTED_NON_OWNER_MESSAGE,
  };

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
  /** Período do contador (`YYYY-MM`), só nos recursos mensais. */
  periodKey?: string;
  /**
   * O ator é o titular que paga pelo recurso. Só ele recebe `used`: o
   * contador do titular pode somar o uso de espaços em que o ator não está
   * (créditos de IA são um pool por titular), e a próxima ação muda.
   */
  actorIsBillingOwner: boolean;
  /**
   * Unidades pedidas de uma vez (importação em lote). É o próprio pedido do
   * ator, então vale para qualquer papel; só aparece quando informado.
   */
  requested?: number;
}

export const quotaExceeded = (details: QuotaExceededDetails) => {
  const messages = details.actorIsBillingOwner ?
    QUOTA_MESSAGE_BY_RESOURCE :
    NON_OWNER_QUOTA_MESSAGE_BY_RESOURCE;
  const fallback = details.actorIsBillingOwner ?
    QUOTA_EXCEEDED_MESSAGE :
    QUOTA_EXCEEDED_NON_OWNER_MESSAGE;
  return new ApplicationError(
    "quota_exceeded",
    messages[details.resource] ?? fallback,
    {
      resource: details.resource,
      planId: details.planId,
      limit: details.limit,
      ...(details.actorIsBillingOwner ? {used: details.used} : {}),
      ...(details.periodKey === undefined ?
        {} :
        {periodKey: details.periodKey}),
      ...(details.requested === undefined ?
        {} :
        {requested: details.requested}),
    },
  );
};

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
  periodKey?: string;
  /** Ver `QuotaExceededDetails.actorIsBillingOwner`. */
  actorIsBillingOwner: boolean;
  /** Ver `QuotaExceededDetails.requested`. */
  requested?: number;
}): void => {
  const limit = input.entitlement.limits[input.resource];
  if (input.used + input.adding > limit) {
    throw quotaExceeded({
      resource: input.resource,
      planId: input.entitlement.planId,
      limit,
      used: input.used,
      periodKey: input.periodKey,
      actorIsBillingOwner: input.actorIsBillingOwner,
      requested: input.requested,
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
