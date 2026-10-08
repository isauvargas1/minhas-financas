import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {CASH_ENTRY_MAX_CENTS} from "../cash/contracts";
import {sha256} from "../shared/hashing";
import {MONEY_CURRENCY, isMoneyCents} from "../shared/money";
import {workspaceRef, type WorkspaceRole} from "../shared/workspaceAuth";

/**
 * Modelo autoritativo da Divisão de contas (P4-C, D-14).
 *
 * Coleções por workspace, todas escritas só pelo backend (Admin SDK), em
 * transação:
 *
 * - `split_groups/{sgr_*}` — o grupo: modo (`split` | `reimbursement`, este
 *   só em PJ), tipo (fixo/temporário), estado (`active` | `archived`, nunca
 *   apagado), dono (participante) e os agregados do grupo em centavos;
 * - `split_participants/{spt_*}` — participante: `workspace_member` (com
 *   `userId` de um membership ativo do mesmo workspace) ou `external` (só um
 *   nome de exibição; sem login, sem permissão); papel no grupo (`owner` |
 *   `participant` | `viewer`), estado (`active` | `inactive`) e saldos;
 * - `split_invites/{sinv_*}` — convite por código: o documento guarda só o
 *   hash do código (o ID deriva dele) e o papel (`participant` | `viewer`);
 * - `split_bills/{sbl_*}` — título de rateio em centavos, pagador, método,
 *   integração financeira (`none` | `cash` | `card`) e estado derivado dos
 *   rateios não anulados (`open` | `settled` | `voided`);
 * - `split_shares/{ssh_*}` — rateio de um participante num título:
 *   `amountDueCents`, `amountSettledCents` e estado (`open` | `settled` |
 *   `forgiven` | `voided`); a soma dos devidos é o valor do título por
 *   construção;
 * - `split_reimbursements/{srb_*}` — pedido de reembolso PJ (`requested` →
 *   `approved` → `paid`, ou `rejected`/`cancelled`);
 * - `split_events/{sev_*}` — trilha append-only das operações (sem nomes,
 *   descrições ou outros textos livres).
 *
 * A quota comercial `splitGroups` conta grupos `active` em
 * `quota_state/split_groups` (ver `quota.ts`).
 */
export const SPLIT_SCHEMA_VERSION = 1;

export const SPLIT_GROUPS_COLLECTION = "split_groups";
export const SPLIT_PARTICIPANTS_COLLECTION = "split_participants";
export const SPLIT_INVITES_COLLECTION = "split_invites";
export const SPLIT_BILLS_COLLECTION = "split_bills";
export const SPLIT_SHARES_COLLECTION = "split_shares";
export const SPLIT_REIMBURSEMENTS_COLLECTION = "split_reimbursements";
export const SPLIT_EVENTS_COLLECTION = "split_events";

/** Ator do sistema não existe aqui: toda operação tem um ator humano. */
export const SPLIT_MAX_CENTS = CASH_ENTRY_MAX_CENTS;
/** 100% em basis points. */
export const SPLIT_BPS_TOTAL = 10_000;

/**
 * Tetos operacionais (não são quota comercial; a única quota comercial é
 * `splitGroups`). Mantêm documentos, transações e leituras limitados.
 */
export const SPLIT_LIMITS = {
  /** Participantes ativos por grupo (internos + externos). */
  activeParticipantsPerGroup: 50,
  /** Registros de participante por grupo (ativos + inativos). */
  participantRecordsPerGroup: 100,
  /** Participantes (rateios) por título. */
  sharesPerBill: 50,
  /** Títulos em aberto por grupo. */
  openBillsPerGroup: 1_000,
  /** Convites pendentes por grupo. */
  pendingInvitesPerGroup: 20,
  /** Categorias distintas no agregado do grupo; as demais somam em "Outras". */
  categoryTotalsKeys: 50,
  /** Parcelas no cartão (o mesmo teto do domínio de cartões). */
  cardInstallments: 60,
} as const;

export const SPLIT_OTHER_CATEGORY = "Outras";

export const SPLIT_GROUP_TYPES = ["fixed", "temporary"] as const;
export type SplitGroupType = typeof SPLIT_GROUP_TYPES[number];

export const SPLIT_BUSINESS_MODES = ["split", "reimbursement"] as const;
export type SplitBusinessMode = typeof SPLIT_BUSINESS_MODES[number];

export type SplitGroupStatus = "active" | "archived";

export const SPLIT_PARTICIPANT_KINDS = ["workspace_member", "external"] as
  const;
export type SplitParticipantKind = typeof SPLIT_PARTICIPANT_KINDS[number];

export const SPLIT_GROUP_ROLES = ["owner", "participant", "viewer"] as const;
export type SplitGroupRole = typeof SPLIT_GROUP_ROLES[number];
/** Papéis que um convite ou uma inclusão direta podem atribuir. */
export const SPLIT_ASSIGNABLE_ROLES = ["participant", "viewer"] as const;
export type SplitAssignableRole = typeof SPLIT_ASSIGNABLE_ROLES[number];

export type SplitParticipantStatus = "active" | "inactive";

export type SplitInviteStatus = "pending" | "accepted" | "revoked";

export const SPLIT_ALLOCATION_METHODS = ["equal", "percentage", "fixed"] as
  const;
export type SplitAllocationMethod = typeof SPLIT_ALLOCATION_METHODS[number];

export const SPLIT_FINANCIAL_INTEGRATIONS = ["none", "cash", "card"] as const;
export type SplitFinancialIntegration =
  typeof SPLIT_FINANCIAL_INTEGRATIONS[number];

export type SplitBillStatus = "open" | "settled" | "voided";
export type SplitShareStatus = "open" | "settled" | "forgiven" | "voided";
/**
 * Como o rateio chegou a `settled`: o próprio pagador (a sua parte já está
 * paga na criação), quitação registrada por terceiro, ou parte zero.
 */
export type SplitShareSettledVia = "payer_self" | "settlement" | "zero";

export const SPLIT_REIMBURSEMENT_STATUSES = [
  "requested", "approved", "paid", "rejected", "cancelled",
] as const;
export type SplitReimbursementStatus =
  typeof SPLIT_REIMBURSEMENT_STATUSES[number];

export const SPLIT_ICON_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
export const SPLIT_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Validade do convite: 7 dias. */
export const SPLIT_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ------------------------------------------------------------------- refs

export const splitGroupsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(SPLIT_GROUPS_COLLECTION);
export const splitParticipantsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(SPLIT_PARTICIPANTS_COLLECTION);
export const splitInvitesRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(SPLIT_INVITES_COLLECTION);
export const splitBillsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(SPLIT_BILLS_COLLECTION);
export const splitSharesRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(SPLIT_SHARES_COLLECTION);
export const splitReimbursementsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(SPLIT_REIMBURSEMENTS_COLLECTION);
export const splitEventsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(SPLIT_EVENTS_COLLECTION);

// -------------------------------------------------------------------- IDs

const hash40 = (value: string): string => sha256(value).slice(0, 40);

/** Intenção do ator: `(uid, chave)`. */
export const splitIntentIdFor = (uid: string, idempotencyKey: string) =>
  sha256(`${uid}:${idempotencyKey}`).slice(0, 32);

/** Grupo: hash de `(workspace, intenção)`, a própria âncora durável. */
export const splitGroupIdFor = (workspaceId: string, intentId: string) =>
  `sgr_${hash40(`${workspaceId}:group:${intentId}`)}`;

/** Membro do workspace no grupo: no máximo um registro por usuário. */
export const splitMemberParticipantIdFor = (
  workspaceId: string,
  groupId: string,
  uid: string,
) => `spt_${hash40(`${workspaceId}:${groupId}:user:${uid}`)}`;

/** Participante externo: um por intenção de inclusão. */
export const splitExternalParticipantIdFor = (
  workspaceId: string,
  groupId: string,
  intentId: string,
) => `spt_${hash40(`${workspaceId}:${groupId}:external:${intentId}`)}`;

/** Convite: o ID deriva do código (o código em claro não é gravado). */
export const splitInviteIdFor = (workspaceId: string, code: string) =>
  `sinv_${hash40(`${workspaceId}:invite:${code}`)}`;

export const splitBillIdFor = (workspaceId: string, intentId: string) =>
  `sbl_${hash40(`${workspaceId}:bill:${intentId}`)}`;

/** Rateio: um por (título, participante), atualizado no lugar na edição. */
export const splitShareIdFor = (
  workspaceId: string,
  billId: string,
  participantId: string,
) => `ssh_${hash40(`${workspaceId}:${billId}:${participantId}`)}`;

export const splitReimbursementIdFor = (
  workspaceId: string,
  intentId: string,
) => `srb_${hash40(`${workspaceId}:reimbursement:${intentId}`)}`;

/** Despesa de caixa do título (no máximo uma) e a sua compensação. */
export const splitBillCashTransactionIdFor = (
  workspaceId: string,
  billId: string,
  effect: "apply" | "reversal",
) => `scash_${hash40(`${workspaceId}:${billId}:${effect}`)}`;

/** Compra de cartão do título (no máximo uma). */
export const splitBillCardPurchaseIdFor = (
  workspaceId: string,
  billId: string,
) => `ccp_${hash40(`split:${workspaceId}:${billId}`)}`;

/** Pagamento `n` do reembolso e o seu estorno. */
export const splitReimbursementCashTransactionIdFor = (
  workspaceId: string,
  reimbursementId: string,
  effect: "payment" | "reversal",
  sequence: number,
) => `srcash_${hash40(
  `${workspaceId}:${reimbursementId}:${effect}:${sequence}`)}`;

// ------------------------------------------------------------ validadores

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const isNullableText = (value: unknown): value is string | null =>
  value === null || isText(value);
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isNonNegativeCents = (value: unknown): value is number =>
  isMoneyCents(value) && (value as number) >= 0;
const isPositiveCents = (value: unknown): value is number =>
  isMoneyCents(value) && (value as number) > 0 &&
  (value as number) <= SPLIT_MAX_CENTS;
const isTimestamp = (value: unknown): value is Timestamp =>
  value instanceof Timestamp;
const isOneOf = <T extends string>(values: readonly T[], value: unknown):
  value is T => typeof value === "string" &&
  (values as readonly string[]).includes(value);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const isDayKey = (value: unknown): value is string =>
  typeof value === "string" && DAY_KEY.test(value);

// ------------------------------------------------------------------ grupo

export interface SplitVisual {
  color: string;
  icon: string;
  emoji: string | null;
}

export interface SplitGroupCounters {
  participantCount: number;
  activeParticipantCount: number;
  billCount: number;
  openBillCount: number;
  openShareCount: number;
  openReimbursementCount: number;
}

export interface SplitGroupTotals {
  /** Σ valores dos títulos não anulados. */
  billedCents: number;
  /** Σ do que falta quitar nos rateios em aberto (fora a parte do pagador). */
  openCents: number;
  /** Σ por categoria dos títulos não anulados (≤ 50 chaves + "Outras"). */
  categoryTotals: Record<string, number>;
  /** Σ dos reembolsos solicitados, aprovados e pagos (não rejeitados). */
  reimbursementTotalCents: number;
  /** Σ dos reembolsos `requested` e `approved`. */
  reimbursementPendingCents: number;
  /** Σ dos reembolsos `paid`. */
  reimbursementPaidCents: number;
}

export interface AuthoritativeSplitGroup {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  groupType: SplitGroupType;
  businessMode: SplitBusinessMode;
  status: SplitGroupStatus;
  createdBy: string;
  ownerParticipantId: string;
  ownerUserId: string;
  visual: SplitVisual;
  counters: SplitGroupCounters;
  totals: SplitGroupTotals;
  revision: number;
  updatedAt: Timestamp;
}

export const EMPTY_GROUP_COUNTERS: SplitGroupCounters = {
  participantCount: 0,
  activeParticipantCount: 0,
  billCount: 0,
  openBillCount: 0,
  openShareCount: 0,
  openReimbursementCount: 0,
};

export const EMPTY_GROUP_TOTALS: SplitGroupTotals = {
  billedCents: 0,
  openCents: 0,
  categoryTotals: {},
  reimbursementTotalCents: 0,
  reimbursementPendingCents: 0,
  reimbursementPaidCents: 0,
};

const readVisual = (value: unknown): SplitVisual | null => {
  if (typeof value !== "object" || value === null) return null;
  const visual = value as Record<string, unknown>;
  if (
    typeof visual.color !== "string" ||
    !SPLIT_COLOR_PATTERN.test(visual.color) ||
    typeof visual.icon !== "string" ||
    !SPLIT_ICON_PATTERN.test(visual.icon) ||
    !isNullableText(visual.emoji)
  ) {
    return null;
  }
  return {color: visual.color, icon: visual.icon, emoji: visual.emoji};
};

const readCounters = (value: unknown): SplitGroupCounters | null => {
  if (typeof value !== "object" || value === null) return null;
  const counters = value as Record<string, unknown>;
  const keys = Object.keys(EMPTY_GROUP_COUNTERS) as
    (keyof SplitGroupCounters)[];
  if (!keys.every((key) => isCount(counters[key]))) return null;
  const result = Object.fromEntries(keys.map((key) => [key, counters[key]])) as
    unknown as SplitGroupCounters;
  if (
    result.activeParticipantCount > result.participantCount ||
    result.openBillCount > result.billCount
  ) {
    return null;
  }
  return result;
};

const readTotals = (value: unknown): SplitGroupTotals | null => {
  if (typeof value !== "object" || value === null) return null;
  const totals = value as Record<string, unknown>;
  const scalar = ["billedCents", "openCents", "reimbursementTotalCents",
    "reimbursementPendingCents", "reimbursementPaidCents"] as const;
  if (!scalar.every((key) => isNonNegativeCents(totals[key]))) return null;
  const categories = totals.categoryTotals;
  if (typeof categories !== "object" || categories === null) return null;
  const entries = Object.entries(categories as Record<string, unknown>);
  if (
    entries.length > SPLIT_LIMITS.categoryTotalsKeys + 1 ||
    !entries.every(([key, cents]) => key.length > 0 &&
      isNonNegativeCents(cents))
  ) {
    return null;
  }
  return {
    billedCents: totals.billedCents as number,
    openCents: totals.openCents as number,
    categoryTotals: Object.fromEntries(entries) as Record<string, number>,
    reimbursementTotalCents: totals.reimbursementTotalCents as number,
    reimbursementPendingCents: totals.reimbursementPendingCents as number,
    reimbursementPaidCents: totals.reimbursementPaidCents as number,
  };
};

export const readAuthoritativeGroup = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeSplitGroup | null => {
  if (!data) return null;
  const visual = readVisual(data.visual);
  const counters = readCounters(data.counters);
  const totals = readTotals(data.totals);
  if (
    data.schemaVersion !== SPLIT_SCHEMA_VERSION ||
    data.id !== id ||
    data.workspaceId !== workspaceId ||
    !isText(data.name) ||
    !isNullableText(data.description) ||
    !isOneOf(SPLIT_GROUP_TYPES, data.groupType) ||
    !isOneOf(SPLIT_BUSINESS_MODES, data.businessMode) ||
    (data.status !== "active" && data.status !== "archived") ||
    !isText(data.createdBy) ||
    !isText(data.ownerParticipantId) ||
    !isText(data.ownerUserId) ||
    !visual || !counters || !totals ||
    !isCount(data.revision) || data.revision < 1 ||
    !isTimestamp(data.updatedAt)
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    name: data.name,
    description: data.description,
    groupType: data.groupType,
    businessMode: data.businessMode,
    status: data.status,
    createdBy: data.createdBy,
    ownerParticipantId: data.ownerParticipantId,
    ownerUserId: data.ownerUserId,
    visual,
    counters,
    totals,
    revision: data.revision,
    updatedAt: data.updatedAt,
  };
};

/** Recorte do grupo para a auditoria: só estado, contadores e centavos. */
export const groupSnapshot = (group: Pick<AuthoritativeSplitGroup,
  "status" | "businessMode" | "groupType" | "revision" | "counters" |
  "totals">) => ({
  status: group.status,
  businessMode: group.businessMode,
  groupType: group.groupType,
  revision: group.revision,
  activeParticipantCount: group.counters.activeParticipantCount,
  openBillCount: group.counters.openBillCount,
  openShareCount: group.counters.openShareCount,
  openReimbursementCount: group.counters.openReimbursementCount,
  billedCents: group.totals.billedCents,
  openCents: group.totals.openCents,
});

// ----------------------------------------------------------- participante

export interface SplitParticipantBalances {
  /** Σ devido nos rateios não anulados (inclui a parte como pagador). */
  dueCents: number;
  /** Σ dos títulos não anulados que este participante pagou. */
  paidCents: number;
  /** O que ainda deve (rateios em aberto; a parte do pagador não conta). */
  owesOpenCents: number;
  /** O que os outros ainda devem a este participante como pagador. */
  receivableOpenCents: number;
}

export const EMPTY_BALANCES: SplitParticipantBalances = {
  dueCents: 0,
  paidCents: 0,
  owesOpenCents: 0,
  receivableOpenCents: 0,
};

export interface AuthoritativeSplitParticipant {
  id: string;
  workspaceId: string;
  groupId: string;
  kind: SplitParticipantKind;
  userId: string | null;
  displayName: string | null;
  role: SplitGroupRole;
  status: SplitParticipantStatus;
  color: string;
  balances: SplitParticipantBalances;
  openShareCount: number;
  openReceivableCount: number;
  openReimbursementCount: number;
  revision: number;
  updatedAt: Timestamp;
}

const readBalances = (value: unknown): SplitParticipantBalances | null => {
  if (typeof value !== "object" || value === null) return null;
  const balances = value as Record<string, unknown>;
  const keys = Object.keys(EMPTY_BALANCES) as
    (keyof SplitParticipantBalances)[];
  if (!keys.every((key) => isNonNegativeCents(balances[key]))) return null;
  return Object.fromEntries(keys.map((key) => [key, balances[key]])) as
    unknown as SplitParticipantBalances;
};

export const readAuthoritativeParticipant = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeSplitParticipant | null => {
  if (!data) return null;
  const balances = readBalances(data.balances);
  const member = data.kind === "workspace_member";
  if (
    data.schemaVersion !== SPLIT_SCHEMA_VERSION ||
    data.id !== id ||
    data.workspaceId !== workspaceId ||
    !isText(data.groupId) ||
    !isOneOf(SPLIT_PARTICIPANT_KINDS, data.kind) ||
    // Membro tem `userId`; externo nunca tem.
    (member ? !isText(data.userId) : data.userId !== null) ||
    !isNullableText(data.displayName) ||
    // Externo precisa de nome (é tudo o que se guarda dele).
    (!member && !isText(data.displayName)) ||
    !isOneOf(SPLIT_GROUP_ROLES, data.role) ||
    // Externo nunca é dono nem visualizador: não tem acesso ao sistema.
    (!member && data.role !== "participant") ||
    (data.status !== "active" && data.status !== "inactive") ||
    typeof data.color !== "string" || !SPLIT_COLOR_PATTERN.test(data.color) ||
    !balances ||
    !isCount(data.openShareCount) ||
    !isCount(data.openReceivableCount) ||
    !isCount(data.openReimbursementCount) ||
    !isCount(data.revision) || data.revision < 1 ||
    !isTimestamp(data.updatedAt)
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    groupId: data.groupId,
    kind: data.kind,
    userId: data.userId,
    displayName: data.displayName,
    role: data.role,
    status: data.status,
    color: data.color,
    balances,
    openShareCount: data.openShareCount,
    openReceivableCount: data.openReceivableCount,
    openReimbursementCount: data.openReimbursementCount,
    revision: data.revision,
    updatedAt: data.updatedAt,
  };
};

/** Cores de identidade dos participantes, atribuídas em sequência. */
export const SPLIT_PARTICIPANT_COLORS = [
  "#6366f1", "#0ea5e9", "#22c55e", "#f97316", "#ec4899", "#8b5cf6",
  "#14b8a6", "#eab308", "#64748b", "#ef4444",
] as const;

export const participantColorFor = (index: number): string =>
  SPLIT_PARTICIPANT_COLORS[index % SPLIT_PARTICIPANT_COLORS.length];

export const participantDocument = (input: {
  id: string;
  workspaceId: string;
  groupId: string;
  kind: SplitParticipantKind;
  userId: string | null;
  displayName: string | null;
  role: SplitGroupRole;
  color: string;
  addedVia: "creation" | "invite" | "direct";
  actorUid: string;
}): admin.firestore.DocumentData => ({
  id: input.id,
  schemaVersion: SPLIT_SCHEMA_VERSION,
  workspaceId: input.workspaceId,
  groupId: input.groupId,
  kind: input.kind,
  userId: input.userId,
  displayName: input.displayName,
  role: input.role,
  status: "active",
  color: input.color,
  balances: {...EMPTY_BALANCES},
  openShareCount: 0,
  openReceivableCount: 0,
  openReimbursementCount: 0,
  addedVia: input.addedVia,
  revision: 1,
  createdBy: input.actorUid,
  updatedBy: input.actorUid,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
  deactivatedAt: null,
  deactivatedBy: null,
});

// ---------------------------------------------------------------- convite

export interface AuthoritativeSplitInvite {
  id: string;
  workspaceId: string;
  groupId: string;
  role: SplitAssignableRole;
  status: SplitInviteStatus;
  expiresAt: Timestamp;
  createdBy: string;
}

export const readAuthoritativeInvite = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeSplitInvite | null => {
  if (!data) return null;
  if (
    data.schemaVersion !== SPLIT_SCHEMA_VERSION ||
    data.id !== id ||
    data.workspaceId !== workspaceId ||
    !isText(data.groupId) ||
    !isOneOf(SPLIT_ASSIGNABLE_ROLES, data.role) ||
    !["pending", "accepted", "revoked"].includes(data.status) ||
    !isTimestamp(data.expiresAt) ||
    !isText(data.createdBy)
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    groupId: data.groupId,
    role: data.role,
    status: data.status,
    expiresAt: data.expiresAt,
    createdBy: data.createdBy,
  };
};

// ----------------------------------------------------------------- título

export interface AuthoritativeSplitBill {
  id: string;
  workspaceId: string;
  groupId: string;
  description: string;
  category: string;
  /** Chave de `totals.categoryTotals` em que o valor foi somado. */
  categoryBucket: string;
  amountCents: number;
  expenseDate: string;
  payerParticipantId: string;
  payerUserId: string | null;
  allocationMethod: SplitAllocationMethod;
  participantIds: string[];
  financialIntegration: SplitFinancialIntegration;
  cashAccountId: string | null;
  cardId: string | null;
  installmentsCount: number | null;
  cashTransactionId: string | null;
  purchaseId: string | null;
  status: SplitBillStatus;
  shareCount: number;
  openShareCount: number;
  /** Rateios quitados por terceiro ou perdoados (travam os termos). */
  resolvedShareCount: number;
  /** Σ do que falta quitar nos rateios em aberto. */
  outstandingCents: number;
  termsRevision: number;
  createdBy: string;
  revision: number;
  updatedAt: Timestamp;
}

/** Fato financeiro existe: termos travados. */
export const hasFinancialFact = (bill: Pick<AuthoritativeSplitBill,
  "cashTransactionId" | "purchaseId">): boolean =>
  bill.cashTransactionId !== null || bill.purchaseId !== null;

/** Termos financeiros imutáveis (§19): fato, quitação ou perdão. */
export const areTermsLocked = (bill: Pick<AuthoritativeSplitBill,
  "cashTransactionId" | "purchaseId" | "resolvedShareCount">): boolean =>
  hasFinancialFact(bill) || bill.resolvedShareCount > 0;

export const readAuthoritativeBill = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeSplitBill | null => {
  if (!data) return null;
  const integration = data.financialIntegration;
  const participantIds = data.participantIds;
  const validIds = Array.isArray(participantIds) &&
    participantIds.length >= 1 &&
    participantIds.length <= SPLIT_LIMITS.sharesPerBill &&
    participantIds.every(isText) &&
    new Set(participantIds).size === participantIds.length;
  if (
    data.schemaVersion !== SPLIT_SCHEMA_VERSION ||
    data.id !== id ||
    data.workspaceId !== workspaceId ||
    !isText(data.groupId) ||
    !isText(data.description) ||
    !isText(data.category) ||
    !isText(data.categoryBucket) ||
    (data.categoryBucket !== data.category &&
      data.categoryBucket !== SPLIT_OTHER_CATEGORY) ||
    !isPositiveCents(data.amountCents) ||
    data.currency !== MONEY_CURRENCY ||
    !isDayKey(data.expenseDate) ||
    !isText(data.payerParticipantId) ||
    !isNullableText(data.payerUserId) ||
    !isOneOf(SPLIT_ALLOCATION_METHODS, data.allocationMethod) ||
    !validIds ||
    !isOneOf(SPLIT_FINANCIAL_INTEGRATIONS, integration) ||
    // Destino coerente com a integração.
    (integration === "cash" ?
      !isText(data.cashAccountId) || data.cardId !== null ||
        data.purchaseId !== null || !isText(data.cashTransactionId) :
      integration === "card" ?
        !isText(data.cardId) || data.cashAccountId !== null ||
          data.cashTransactionId !== null || !isText(data.purchaseId) ||
          !isCount(data.installmentsCount) || data.installmentsCount < 1 ||
          data.installmentsCount > SPLIT_LIMITS.cardInstallments :
        data.cashAccountId !== null || data.cardId !== null ||
          data.cashTransactionId !== null || data.purchaseId !== null) ||
    (integration !== "card" && data.installmentsCount !== null) ||
    // Integração financeira só com pagador membro do workspace.
    (integration !== "none" && !isText(data.payerUserId)) ||
    !["open", "settled", "voided"].includes(data.status) ||
    !isCount(data.shareCount) || data.shareCount !== participantIds.length ||
    !isCount(data.openShareCount) || data.openShareCount > data.shareCount ||
    !isCount(data.resolvedShareCount) ||
    !isNonNegativeCents(data.outstandingCents) ||
    data.outstandingCents > data.amountCents ||
    // Estado derivado dos rateios não anulados: em aberto ⇔ há rateio em
    // aberto; rateio em aberto sempre tem saldo (quitação é integral).
    (data.status === "open") !== (data.openShareCount > 0) ||
    (data.openShareCount === 0) !== (data.outstandingCents === 0) ||
    !isCount(data.termsRevision) || data.termsRevision < 1 ||
    !isText(data.createdBy) ||
    !isCount(data.revision) || data.revision < 1 ||
    !isTimestamp(data.updatedAt)
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    groupId: data.groupId,
    description: data.description,
    category: data.category,
    categoryBucket: data.categoryBucket,
    amountCents: data.amountCents,
    expenseDate: data.expenseDate,
    payerParticipantId: data.payerParticipantId,
    payerUserId: data.payerUserId,
    allocationMethod: data.allocationMethod,
    participantIds: [...participantIds],
    financialIntegration: integration,
    cashAccountId: data.cashAccountId,
    cardId: data.cardId,
    installmentsCount: data.installmentsCount,
    cashTransactionId: data.cashTransactionId,
    purchaseId: data.purchaseId,
    status: data.status,
    shareCount: data.shareCount,
    openShareCount: data.openShareCount,
    resolvedShareCount: data.resolvedShareCount,
    outstandingCents: data.outstandingCents,
    termsRevision: data.termsRevision,
    createdBy: data.createdBy,
    revision: data.revision,
    updatedAt: data.updatedAt,
  };
};

export const billSnapshot = (bill: Pick<AuthoritativeSplitBill,
  "status" | "amountCents" | "allocationMethod" | "financialIntegration" |
  "shareCount" | "openShareCount" | "resolvedShareCount" |
  "outstandingCents" | "termsRevision">) => ({
  status: bill.status,
  amountCents: bill.amountCents,
  allocationMethod: bill.allocationMethod,
  financialIntegration: bill.financialIntegration,
  shareCount: bill.shareCount,
  openShareCount: bill.openShareCount,
  resolvedShareCount: bill.resolvedShareCount,
  outstandingCents: bill.outstandingCents,
  termsRevision: bill.termsRevision,
});

// ----------------------------------------------------------------- rateio

export interface AuthoritativeSplitShare {
  id: string;
  workspaceId: string;
  groupId: string;
  billId: string;
  participantId: string;
  isPayerShare: boolean;
  weightBps: number | null;
  amountDueCents: number;
  amountSettledCents: number;
  status: SplitShareStatus;
  settledVia: SplitShareSettledVia | null;
  termsRevision: number;
  revision: number;
  updatedAt: Timestamp;
}

/** O que falta quitar num rateio em aberto (0 nos demais estados). */
export const remainingOf = (share: Pick<AuthoritativeSplitShare,
  "status" | "amountDueCents" | "amountSettledCents">): number =>
  share.status === "open" ?
    share.amountDueCents - share.amountSettledCents : 0;

export const readAuthoritativeShare = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeSplitShare | null => {
  if (!data) return null;
  const status = data.status;
  const due = data.amountDueCents;
  const settled = data.amountSettledCents;
  if (
    data.schemaVersion !== SPLIT_SCHEMA_VERSION ||
    data.id !== id ||
    data.workspaceId !== workspaceId ||
    !isText(data.groupId) ||
    !isText(data.billId) ||
    !isText(data.participantId) ||
    typeof data.isPayerShare !== "boolean" ||
    !(data.weightBps === null ||
      (isCount(data.weightBps) && data.weightBps > 0 &&
        data.weightBps <= SPLIT_BPS_TOTAL)) ||
    !isNonNegativeCents(due) || due > SPLIT_MAX_CENTS ||
    !isNonNegativeCents(settled) ||
    !["open", "settled", "forgiven", "voided"].includes(status) ||
    !(data.settledVia === null ||
      ["payer_self", "settlement", "zero"].includes(data.settledVia)) ||
    // Coerência de estado × valores.
    (status === "open" && (settled !== 0 || due === 0 ||
      data.isPayerShare || data.settledVia !== null)) ||
    (status === "settled" && (settled !== due || data.settledVia === null ||
      (data.settledVia === "payer_self") !== data.isPayerShare ||
      (data.settledVia === "zero") !== (due === 0 && !data.isPayerShare))) ||
    (status === "forgiven" && (settled !== 0 || data.isPayerShare ||
      data.settledVia !== null)) ||
    !isCount(data.termsRevision) || data.termsRevision < 1 ||
    !isCount(data.revision) || data.revision < 1 ||
    !isTimestamp(data.updatedAt)
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    groupId: data.groupId,
    billId: data.billId,
    participantId: data.participantId,
    isPayerShare: data.isPayerShare,
    weightBps: data.weightBps,
    amountDueCents: due,
    amountSettledCents: settled,
    status,
    settledVia: data.settledVia,
    termsRevision: data.termsRevision,
    revision: data.revision,
    updatedAt: data.updatedAt,
  };
};

// -------------------------------------------------------------- reembolso

export interface AuthoritativeSplitReimbursement {
  id: string;
  workspaceId: string;
  groupId: string;
  requesterParticipantId: string;
  requesterUserId: string | null;
  description: string;
  category: string;
  amountCents: number;
  expenseDate: string;
  status: SplitReimbursementStatus;
  createdBy: string;
  cashAccountId: string | null;
  cashTransactionId: string | null;
  paymentDate: string | null;
  paymentSequence: number;
  revision: number;
  updatedAt: Timestamp;
}

export const readAuthoritativeReimbursement = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeSplitReimbursement | null => {
  if (!data) return null;
  const paid = data.status === "paid";
  if (
    data.schemaVersion !== SPLIT_SCHEMA_VERSION ||
    data.id !== id ||
    data.workspaceId !== workspaceId ||
    !isText(data.groupId) ||
    !isText(data.requesterParticipantId) ||
    !isNullableText(data.requesterUserId) ||
    !isText(data.description) ||
    !isText(data.category) ||
    !isPositiveCents(data.amountCents) ||
    data.currency !== MONEY_CURRENCY ||
    !isDayKey(data.expenseDate) ||
    !isOneOf(SPLIT_REIMBURSEMENT_STATUSES, data.status) ||
    !isText(data.createdBy) ||
    // Pago ⇔ conta, lançamento e data do pagamento em vigor.
    (paid ?
      !isText(data.cashAccountId) || !isText(data.cashTransactionId) ||
        !isDayKey(data.paymentDate) :
      data.cashTransactionId !== null || data.paymentDate !== null) ||
    !isCount(data.paymentSequence) ||
    (paid && data.paymentSequence < 1) ||
    !isCount(data.revision) || data.revision < 1 ||
    !isTimestamp(data.updatedAt)
  ) {
    return null;
  }
  return {
    id,
    workspaceId,
    groupId: data.groupId,
    requesterParticipantId: data.requesterParticipantId,
    requesterUserId: data.requesterUserId,
    description: data.description,
    category: data.category,
    amountCents: data.amountCents,
    expenseDate: data.expenseDate,
    status: data.status,
    createdBy: data.createdBy,
    cashAccountId: data.cashAccountId ?? null,
    cashTransactionId: data.cashTransactionId,
    paymentDate: data.paymentDate,
    paymentSequence: data.paymentSequence,
    revision: data.revision,
    updatedAt: data.updatedAt,
  };
};

export const reimbursementSnapshot = (item: Pick<
  AuthoritativeSplitReimbursement, "status" | "amountCents" |
  "paymentSequence">) => ({
  status: item.status,
  amountCents: item.amountCents,
  paymentSequence: item.paymentSequence,
});

/** Reembolso que ainda é compromisso aberto do grupo. */
export const isOpenReimbursement = (status: SplitReimbursementStatus) =>
  status === "requested" || status === "approved";

// ---------------------------------------------------------------- eventos

export type SplitEventOperation =
  | "split.group_created"
  | "split.group_updated"
  | "split.group_archived"
  | "split.group_reactivated"
  | "split.invite_created"
  | "split.invite_revoked"
  | "split.invite_accepted"
  | "split.participant_added"
  | "split.participant_deactivated"
  | "split.bill_created"
  | "split.bill_updated"
  | "split.bill_voided"
  | "split.share_settled"
  | "split.share_settlement_reversed"
  | "split.share_forgiven"
  | "split.reimbursement_requested"
  | "split.reimbursement_approved"
  | "split.reimbursement_rejected"
  | "split.reimbursement_cancelled"
  | "split.reimbursement_paid"
  | "split.reimbursement_payment_reversed";

export const splitEventIdFor = (
  operation: SplitEventOperation,
  targetKey: string,
) => `sev_${hash40(`${operation}:${targetKey}`)}`;

export const splitEventRef = (
  workspaceId: string,
  operation: SplitEventOperation,
  targetKey: string,
) => splitEventsRef(workspaceId).doc(splitEventIdFor(operation, targetKey));

type AuditValue = string | number | boolean | null;

export interface SplitEventInput {
  workspaceId: string;
  operation: SplitEventOperation;
  /** Chave do ID determinístico: a intenção do ator. */
  targetKey: string;
  groupId: string;
  billId?: string | null;
  shareId?: string | null;
  participantId?: string | null;
  reimbursementId?: string | null;
  inviteId?: string | null;
  actorId: string;
  actorRole: WorkspaceRole;
  intentId: string;
  requestHash: string;
  requestId: string;
  correlationId: string | null;
  amountCents?: number | null;
  /** Só nomes de campos alterados: nunca os textos livres. */
  changedFields?: string[];
  before?: Record<string, AuditValue> | null;
  after?: Record<string, AuditValue> | null;
}

/** Evento append-only (`transaction.create`): a âncora durável da intenção. */
export const appendSplitEvent = (
  transaction: admin.firestore.Transaction,
  input: SplitEventInput,
): string => {
  const ref = splitEventRef(input.workspaceId, input.operation,
    input.targetKey);
  transaction.create(ref, {
    id: ref.id,
    schemaVersion: SPLIT_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    operation: input.operation,
    groupId: input.groupId,
    billId: input.billId ?? null,
    shareId: input.shareId ?? null,
    participantId: input.participantId ?? null,
    reimbursementId: input.reimbursementId ?? null,
    inviteId: input.inviteId ?? null,
    actorId: input.actorId,
    actorRole: input.actorRole,
    intentId: input.intentId,
    requestHash: input.requestHash,
    requestId: input.requestId,
    correlationId: input.correlationId,
    amountCents: input.amountCents ?? null,
    changedFields: input.changedFields ?? [],
    before: input.before ?? null,
    after: input.after ?? null,
    occurredAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
};
