import { versionOf } from '../clients/adapters.ts';
import { isCivilDayKey } from '../recurring/schedule.ts';
import type {
  SplitAllocationMethod,
  SplitAssignableRole,
  SplitBill,
  SplitBillStatus,
  SplitBusinessMode,
  SplitFinancialIntegration,
  SplitGroup,
  SplitGroupCounters,
  SplitGroupRole,
  SplitGroupTotals,
  SplitGroupType,
  SplitInvite,
  SplitParticipant,
  SplitParticipantBalances,
  SplitParticipantKind,
  SplitReimbursement,
  SplitReimbursementStatus,
  SplitShare,
  SplitShareSettledVia,
  SplitShareStatus,
  SplitVisual,
} from './types.ts';

/**
 * Leitura dos documentos da Divisão de contas gravados pelo backend (P4-C).
 * Módulo puro.
 *
 * Um único formato é aceito — o autoritativo `schemaVersion: 1`, em
 * centavos inteiros e datas civis. Documento fora dele devolve `null`: a
 * interface não o exibe nem o soma. Não há leitor do formato anterior
 * (`nome`, `valorReal`, `papel`, `nomeExibicao`, `statusPagamento`).
 */
export const SPLIT_SCHEMA_VERSION = 1;

const GROUP_TYPES: readonly SplitGroupType[] = ['fixed', 'temporary'];
const BUSINESS_MODES: readonly SplitBusinessMode[] = ['split', 'reimbursement'];
const PARTICIPANT_KINDS: readonly SplitParticipantKind[] = ['workspace_member', 'external'];
const GROUP_ROLES: readonly SplitGroupRole[] = ['owner', 'participant', 'viewer'];
const ASSIGNABLE_ROLES: readonly SplitAssignableRole[] = ['participant', 'viewer'];
const ALLOCATION_METHODS: readonly SplitAllocationMethod[] = ['equal', 'percentage', 'fixed'];
const INTEGRATIONS: readonly SplitFinancialIntegration[] = ['none', 'cash', 'card'];
const BILL_STATUSES: readonly SplitBillStatus[] = ['open', 'settled', 'voided'];
const SHARE_STATUSES: readonly SplitShareStatus[] = ['open', 'settled', 'forgiven', 'voided'];
const SETTLED_VIA: readonly SplitShareSettledVia[] = ['payer_self', 'settlement', 'zero'];
const REIMBURSEMENT_STATUSES: readonly SplitReimbursementStatus[] =
  ['requested', 'approved', 'paid', 'rejected', 'cancelled'];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

type Data = Record<string, unknown>;

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const isNullableText = (value: unknown): value is string | null =>
  value === null || isText(value);
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isPositiveCents = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);
const isObject = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null;

const baseOk = (id: string, data: Data): boolean =>
  data.schemaVersion === SPLIT_SCHEMA_VERSION && data.id === id;

const toVisual = (value: unknown): SplitVisual | null => {
  if (!isObject(value)) return null;
  if (
    typeof value.color !== 'string' || !HEX_COLOR.test(value.color) ||
    !isText(value.icon) || !isNullableText(value.emoji)
  ) {
    return null;
  }
  return { color: value.color, icon: value.icon, emoji: value.emoji };
};

const COUNTER_KEYS: (keyof SplitGroupCounters)[] = [
  'participantCount', 'activeParticipantCount', 'billCount', 'openBillCount',
  'openShareCount', 'openReimbursementCount',
];

const toCounters = (value: unknown): SplitGroupCounters | null => {
  if (!isObject(value) || !COUNTER_KEYS.every((key) => isCount(value[key]))) return null;
  return Object.fromEntries(COUNTER_KEYS.map((key) => [key, value[key]])) as unknown as
    SplitGroupCounters;
};

const TOTAL_KEYS = [
  'billedCents', 'openCents', 'reimbursementTotalCents', 'reimbursementPendingCents',
  'reimbursementPaidCents',
] as const;

const toTotals = (value: unknown): SplitGroupTotals | null => {
  if (!isObject(value) || !TOTAL_KEYS.every((key) => isCount(value[key]))) return null;
  if (!isObject(value.categoryTotals)) return null;
  const categories = Object.entries(value.categoryTotals);
  if (!categories.every(([key, cents]) => key.length > 0 && isCount(cents))) return null;
  return {
    billedCents: value.billedCents as number,
    openCents: value.openCents as number,
    categoryTotals: Object.fromEntries(categories) as Record<string, number>,
    reimbursementTotalCents: value.reimbursementTotalCents as number,
    reimbursementPendingCents: value.reimbursementPendingCents as number,
    reimbursementPaidCents: value.reimbursementPaidCents as number,
  };
};

export const toSplitGroup = (id: string, data: Data): SplitGroup | null => {
  const visual = toVisual(data.visual);
  const counters = toCounters(data.counters);
  const totals = toTotals(data.totals);
  const version = versionOf(data.updatedAt);
  if (
    !baseOk(id, data) || !isText(data.name) || !isNullableText(data.description) ||
    !isOneOf(GROUP_TYPES, data.groupType) || !isOneOf(BUSINESS_MODES, data.businessMode) ||
    (data.status !== 'active' && data.status !== 'archived') ||
    !isText(data.ownerParticipantId) || !isText(data.ownerUserId) || !isText(data.createdBy) ||
    !visual || !counters || !totals || !version
  ) {
    return null;
  }
  return {
    id,
    name: data.name,
    description: data.description,
    groupType: data.groupType,
    businessMode: data.businessMode,
    status: data.status,
    ownerParticipantId: data.ownerParticipantId,
    ownerUserId: data.ownerUserId,
    createdBy: data.createdBy,
    visual,
    counters,
    totals,
    version,
  };
};

const BALANCE_KEYS: (keyof SplitParticipantBalances)[] =
  ['dueCents', 'paidCents', 'owesOpenCents', 'receivableOpenCents'];

export const toSplitParticipant = (id: string, data: Data): SplitParticipant | null => {
  const balances = isObject(data.balances) &&
    BALANCE_KEYS.every((key) => isCount((data.balances as Data)[key])) ?
    Object.fromEntries(BALANCE_KEYS.map((key) => [key, (data.balances as Data)[key]])) as
      unknown as SplitParticipantBalances :
    null;
  const version = versionOf(data.updatedAt);
  const member = data.kind === 'workspace_member';
  if (
    !baseOk(id, data) || !isText(data.groupId) || !isOneOf(PARTICIPANT_KINDS, data.kind) ||
    (member ? !isText(data.userId) : data.userId !== null) ||
    !isNullableText(data.displayName) || (!member && !isText(data.displayName)) ||
    !isOneOf(GROUP_ROLES, data.role) || (!member && data.role !== 'participant') ||
    (data.status !== 'active' && data.status !== 'inactive') ||
    typeof data.color !== 'string' || !HEX_COLOR.test(data.color) ||
    !balances || !isCount(data.openShareCount) || !isCount(data.openReceivableCount) ||
    !isCount(data.openReimbursementCount) || !version
  ) {
    return null;
  }
  return {
    id,
    groupId: data.groupId,
    kind: data.kind,
    userId: data.userId as string | null,
    displayName: data.displayName,
    role: data.role,
    status: data.status,
    color: data.color,
    balances,
    openShareCount: data.openShareCount,
    openReceivableCount: data.openReceivableCount,
    openReimbursementCount: data.openReimbursementCount,
    version,
  };
};

const isoOf = (value: unknown): string | null => {
  const instant = value as { toDate?: () => Date } | null;
  if (!instant || typeof instant.toDate !== 'function') return null;
  const date = instant.toDate();
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const toSplitInvite = (id: string, data: Data): SplitInvite | null => {
  const expiresAt = isoOf(data.expiresAt);
  if (
    !baseOk(id, data) || !isText(data.groupId) || !isOneOf(ASSIGNABLE_ROLES, data.role) ||
    data.status !== 'pending' || !isText(data.codeHint) || !expiresAt || !isText(data.createdBy)
  ) {
    return null;
  }
  return {
    id,
    groupId: data.groupId,
    role: data.role,
    codeHint: data.codeHint,
    expiresAt,
    createdBy: data.createdBy,
  };
};

export const toSplitBill = (id: string, data: Data): SplitBill | null => {
  const version = versionOf(data.updatedAt);
  const participantIds = Array.isArray(data.participantIds) &&
    data.participantIds.length > 0 && data.participantIds.every(isText) ?
    [...data.participantIds] as string[] : null;
  if (
    !baseOk(id, data) || !isText(data.groupId) || !isText(data.description) ||
    !isText(data.category) || !isPositiveCents(data.amountCents) || data.currency !== 'BRL' ||
    !isCivilDayKey(data.expenseDate) || !isText(data.payerParticipantId) ||
    !isNullableText(data.payerUserId) || !isOneOf(ALLOCATION_METHODS, data.allocationMethod) ||
    !participantIds || !isOneOf(INTEGRATIONS, data.financialIntegration) ||
    !isNullableText(data.cashAccountId) || !isNullableText(data.cardId) ||
    !(data.installmentsCount === null || isPositiveCents(data.installmentsCount)) ||
    !isNullableText(data.cashTransactionId) || !isNullableText(data.purchaseId) ||
    !isOneOf(BILL_STATUSES, data.status) || !isCount(data.shareCount) ||
    !isCount(data.openShareCount) || !isCount(data.resolvedShareCount) ||
    !isCount(data.outstandingCents) || !isText(data.createdBy) || !version
  ) {
    return null;
  }
  return {
    id,
    groupId: data.groupId,
    description: data.description,
    category: data.category,
    amountCents: data.amountCents,
    expenseDate: data.expenseDate,
    payerParticipantId: data.payerParticipantId,
    payerUserId: data.payerUserId,
    allocationMethod: data.allocationMethod,
    participantIds,
    financialIntegration: data.financialIntegration,
    cashAccountId: data.cashAccountId,
    cardId: data.cardId,
    installmentsCount: data.installmentsCount as number | null,
    cashTransactionId: data.cashTransactionId,
    purchaseId: data.purchaseId,
    status: data.status,
    shareCount: data.shareCount,
    openShareCount: data.openShareCount,
    resolvedShareCount: data.resolvedShareCount,
    outstandingCents: data.outstandingCents,
    createdBy: data.createdBy,
    version,
  };
};

export const toSplitShare = (id: string, data: Data): SplitShare | null => {
  const version = versionOf(data.updatedAt);
  if (
    !baseOk(id, data) || !isText(data.billId) || !isText(data.participantId) ||
    typeof data.isPayerShare !== 'boolean' ||
    !(data.weightBps === null || isPositiveCents(data.weightBps)) ||
    !isCount(data.amountDueCents) || !isCount(data.amountSettledCents) ||
    !isOneOf(SHARE_STATUSES, data.status) ||
    !(data.settledVia === null || isOneOf(SETTLED_VIA, data.settledVia)) || !version
  ) {
    return null;
  }
  return {
    id,
    billId: data.billId,
    participantId: data.participantId,
    isPayerShare: data.isPayerShare,
    weightBps: data.weightBps as number | null,
    amountDueCents: data.amountDueCents,
    amountSettledCents: data.amountSettledCents,
    status: data.status,
    settledVia: data.settledVia as SplitShareSettledVia | null,
    version,
  };
};

export const toSplitReimbursement = (id: string, data: Data): SplitReimbursement | null => {
  const version = versionOf(data.updatedAt);
  if (
    !baseOk(id, data) || !isText(data.groupId) || !isText(data.requesterParticipantId) ||
    !isNullableText(data.requesterUserId) || !isText(data.description) ||
    !isText(data.category) || !isPositiveCents(data.amountCents) || data.currency !== 'BRL' ||
    !isCivilDayKey(data.expenseDate) || !isOneOf(REIMBURSEMENT_STATUSES, data.status) ||
    !isText(data.createdBy) || !isNullableText(data.cashAccountId ?? null) ||
    !(data.paymentDate === null || isCivilDayKey(data.paymentDate)) || !version
  ) {
    return null;
  }
  return {
    id,
    groupId: data.groupId,
    requesterParticipantId: data.requesterParticipantId,
    requesterUserId: data.requesterUserId,
    description: data.description,
    category: data.category,
    amountCents: data.amountCents,
    expenseDate: data.expenseDate,
    status: data.status,
    createdBy: data.createdBy,
    cashAccountId: (data.cashAccountId ?? null) as string | null,
    paymentDate: data.paymentDate as string | null,
    version,
  };
};
