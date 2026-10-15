import * as admin from "firebase-admin";
import {FieldValue, Timestamp} from "firebase-admin/firestore";

import {CASH_ENTRY_MAX_CENTS} from "../cash/contracts";
import {sha256} from "../shared/hashing";
import {MONEY_CURRENCY} from "../shared/money";
import {workspaceRef, type WorkspaceRole} from "../shared/workspaceAuth";
import {
  RECURRING_FREQUENCIES,
  isCivilDayKey,
  usesBillingDay,
  type RecurringFrequency,
  type ScheduleRule,
} from "./schedule";

/**
 * Modelo autoritativo das despesas recorrentes (P4-B, D-12).
 *
 * Três coleções por workspace, todas escritas só pelo backend (Admin SDK):
 *
 * - `recurring_expenses/{id}` — o contrato: valor em centavos, frequência,
 *   dia de cobrança, início/término, forma de pagamento, modo de execução,
 *   destino (cartão ou conta), estado e o próximo vencimento a processar;
 * - `recurring_occurrences/{id}` — o fato de um vencimento já alcançado:
 *   aguardando confirmação, gerado (com o ID do fato no Caixa ou no Cartão),
 *   ignorado ou exigindo atenção. O futuro não é materializado: a tela
 *   projeta os próximos vencimentos com a agenda pura;
 * - `recurring_events/{id}` — trilha append-only das operações, de onde sai
 *   também o histórico de valores (não existe mais `adjustments` em reais).
 *
 * A ocorrência é identificada por `workspaceId + recurringExpenseId +
 * dueDate` (data civil completa), não pela competência.
 */
export const RECURRING_SCHEMA_VERSION = 1;
export const RECURRING_EXPENSES_COLLECTION = "recurring_expenses";
export const RECURRING_OCCURRENCES_COLLECTION = "recurring_occurrences";
export const RECURRING_EVENTS_COLLECTION = "recurring_events";

/** Autor das gerações automáticas do agendador. */
export const RECURRING_SYSTEM_ACTOR = "system:recurring-expenses";

export const RECURRING_MAX_CENTS = CASH_ENTRY_MAX_CENTS;
/** Teto operacional de contratos por workspace (todos os estados). */
export const RECURRING_LIMIT_PER_WORKSPACE = 500;

export const RECURRING_TYPES =
  ["subscription", "fixed_bill", "service", "other"] as const;
export type RecurringType = typeof RECURRING_TYPES[number];

export const RECURRING_PAYMENT_METHODS =
  ["credit_card", "pix", "boleto", "debit", "cash", "other"] as const;
export type RecurringPaymentMethod = typeof RECURRING_PAYMENT_METHODS[number];

export const RECURRING_EXECUTION_MODES =
  ["automatic", "confirmation_required"] as const;
export type RecurringExecutionMode = typeof RECURRING_EXECUTION_MODES[number];

export const RECURRING_STATUSES =
  ["active", "paused", "ended", "cancelled"] as const;
export type RecurringStatus = typeof RECURRING_STATUSES[number];

export const RECURRING_BUSINESS_TYPES = [
  "saas", "rent", "internet", "energy", "water", "accounting", "taxes",
  "services", "other",
] as const;
export type RecurringBusinessType = typeof RECURRING_BUSINESS_TYPES[number];

/** Nome de ícone do catálogo da interface (ex.: `Bolt`, `FileInvoice`). */
export const RECURRING_ICON_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;

export const OCCURRENCE_STATUSES = [
  "awaiting_confirmation", "generated", "ignored", "attention_required",
] as const;
export type OccurrenceStatus = typeof OCCURRENCE_STATUSES[number];

export type OccurrenceTargetDomain = "cash" | "card";

/**
 * Impedimentos de domínio na geração automática. Só o código fica na
 * ocorrência — nenhum texto do erro, nenhum dado de outro domínio.
 */
export const ATTENTION_CODES = [
  "card_unavailable",
  "card_archived",
  "limit_insufficient",
  "account_unavailable",
  "account_archived",
  "workspace_unavailable",
] as const;
export type AttentionCode = typeof ATTENTION_CODES[number];

/** Forma de pagamento → domínio do fato. */
export const targetDomainOf = (
  method: RecurringPaymentMethod,
): OccurrenceTargetDomain => (method === "credit_card" ? "card" : "cash");

export const recurringExpensesRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(RECURRING_EXPENSES_COLLECTION);
export const recurringOccurrencesRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(RECURRING_OCCURRENCES_COLLECTION);
export const recurringEventsRef = (workspaceId: string) =>
  workspaceRef(workspaceId).collection(RECURRING_EVENTS_COLLECTION);

const hash40 = (value: string): string => sha256(value).slice(0, 40);

/** Intenção do ator: `(uid, chave)`. */
export const recurringIntentIdFor = (uid: string, idempotencyKey: string) =>
  sha256(`${uid}:${idempotencyKey}`).slice(0, 32);

/** Contrato: hash de `(workspace, ator, chave)`, a própria âncora durável. */
export const recurringExpenseIdFor = (
  workspaceId: string,
  uid: string,
  idempotencyKey: string,
) => `rec_${hash40(`${workspaceId}:${uid}:${idempotencyKey}`)}`;

/** Ocorrência: hash determinístico de `workspace:contrato:vencimento`. */
export const recurringOccurrenceIdFor = (
  workspaceId: string,
  recurringExpenseId: string,
  dueDate: string,
) => `rocc_${hash40(`${workspaceId}:${recurringExpenseId}:${dueDate}`)}`;

/** Lançamento de caixa gerado por uma ocorrência (no máximo um). */
export const recurringCashTransactionIdFor = (
  workspaceId: string,
  occurrenceId: string,
) => `cash_${hash40(`recurring:${workspaceId}:${occurrenceId}`)}`;

/** Compra de cartão gerada por uma ocorrência (no máximo uma). */
export const recurringCardPurchaseIdFor = (
  workspaceId: string,
  occurrenceId: string,
) => `ccp_${hash40(`recurring:${workspaceId}:${occurrenceId}`)}`;

export interface RecurringVisual {
  color: string;
  icon: string;
  emoji: string | null;
}

export interface RecurringBusinessDetails {
  supplier: string | null;
  businessType: RecurringBusinessType | null;
  costCenter: string | null;
  responsible: string | null;
  adjustmentDate: string | null;
  commitment: string | null;
}

export interface AuthoritativeRecurringExpense extends ScheduleRule {
  id: string;
  workspaceId: string;
  name: string;
  type: RecurringType;
  description: string | null;
  amountCents: number;
  paymentMethod: RecurringPaymentMethod;
  executionMode: RecurringExecutionMode;
  cardId: string | null;
  cashAccountId: string | null;
  /** ID estável da categoria de despesa do catálogo (D-37.8). */
  categoryId: string;
  /** Retrato do nome da categoria (lido do catálogo pelo backend). */
  category: string;
  status: RecurringStatus;
  nextDueDate: string | null;
  lastProcessedDueDate: string | null;
  openOccurrenceCount: number;
  visual: RecurringVisual;
  business: RecurringBusinessDetails | null;
  createdBy: string;
  revision: number;
  requestHash: string;
  updatedAt: Timestamp;
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const isNullableText = (value: unknown): value is string | null =>
  value === null || isText(value);
const isPositiveInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isNonNegativeInt = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isNullableDay = (value: unknown): value is string | null =>
  value === null || isCivilDayKey(value);
const isOneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => (values as readonly unknown[]).includes(value);

const readVisual = (value: unknown): RecurringVisual | null => {
  if (typeof value !== "object" || value === null) return null;
  const visual = value as Record<string, unknown>;
  if (!isText(visual.color) || !isText(visual.icon) ||
    !isNullableText(visual.emoji)) {
    return null;
  }
  return {color: visual.color, icon: visual.icon, emoji: visual.emoji};
};

const readBusiness = (
  value: unknown,
): RecurringBusinessDetails | null | undefined => {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const business = value as Record<string, unknown>;
  if (
    !isNullableText(business.supplier) ||
    !(business.businessType === null ||
      isOneOf(RECURRING_BUSINESS_TYPES, business.businessType)) ||
    !isNullableText(business.costCenter) ||
    !isNullableText(business.responsible) ||
    !isNullableDay(business.adjustmentDate) ||
    !isNullableText(business.commitment)
  ) {
    return undefined;
  }
  return {
    supplier: business.supplier,
    businessType: business.businessType as RecurringBusinessType | null,
    costCenter: business.costCenter,
    responsible: business.responsible,
    adjustmentDate: business.adjustmentDate,
    commitment: business.commitment,
  };
};

/**
 * Contrato no schema autoritativo, ou `null`. Confere as invariantes que as
 * operações pressupõem: destino coerente com a forma de pagamento (cartão
 * só com `credit_card`, conta só fora dele), dia de cobrança só nas
 * frequências mensais, término não anterior ao início e próximo vencimento
 * presente exatamente nos contratos ativos.
 */
export const readAuthoritativeRecurringExpense = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeRecurringExpense | null => {
  if (!data || data.schemaVersion !== RECURRING_SCHEMA_VERSION) return null;
  const visual = readVisual(data.visual);
  const business = readBusiness(data.business);
  if (
    data.workspaceId !== workspaceId ||
    !isText(data.name) ||
    !isOneOf(RECURRING_TYPES, data.type) ||
    !isNullableText(data.description) ||
    !isPositiveInt(data.amountCents) ||
    data.amountCents > RECURRING_MAX_CENTS ||
    data.currency !== MONEY_CURRENCY ||
    !isOneOf(RECURRING_FREQUENCIES, data.frequency) ||
    !isCivilDayKey(data.startDate) ||
    !isNullableDay(data.endDate) ||
    (data.endDate !== null && data.endDate < data.startDate) ||
    !isOneOf(RECURRING_PAYMENT_METHODS, data.paymentMethod) ||
    !isOneOf(RECURRING_EXECUTION_MODES, data.executionMode) ||
    !isNullableText(data.cardId) ||
    !isNullableText(data.cashAccountId) ||
    !isText(data.categoryId) ||
    !isText(data.category) ||
    !isOneOf(RECURRING_STATUSES, data.status) ||
    !isNullableDay(data.nextDueDate) ||
    !isNullableDay(data.lastProcessedDueDate) ||
    !isNonNegativeInt(data.openOccurrenceCount) ||
    !visual ||
    business === undefined ||
    !isText(data.createdBy) ||
    !isPositiveInt(data.revision) ||
    !isText(data.requestHash) ||
    !(data.updatedAt instanceof Timestamp)
  ) {
    return null;
  }
  const frequency = data.frequency as RecurringFrequency;
  const monthly = usesBillingDay(frequency);
  if (
    monthly ?
      !(Number.isSafeInteger(data.billingDay) &&
        data.billingDay >= 1 && data.billingDay <= 31) :
      data.billingDay !== null
  ) {
    return null;
  }
  const card = data.paymentMethod === "credit_card";
  if (
    card ?
      !isText(data.cardId) || data.cashAccountId !== null :
      data.cardId !== null || !isText(data.cashAccountId)
  ) {
    return null;
  }
  if ((data.status === "active") !== (data.nextDueDate !== null)) return null;
  return {
    id,
    workspaceId,
    name: data.name,
    type: data.type,
    description: data.description,
    amountCents: data.amountCents,
    frequency,
    billingDay: monthly ? data.billingDay : null,
    startDate: data.startDate,
    endDate: data.endDate,
    paymentMethod: data.paymentMethod,
    executionMode: data.executionMode,
    cardId: data.cardId,
    cashAccountId: data.cashAccountId,
    categoryId: data.categoryId,
    category: data.category,
    status: data.status,
    nextDueDate: data.nextDueDate,
    lastProcessedDueDate: data.lastProcessedDueDate,
    openOccurrenceCount: data.openOccurrenceCount,
    visual,
    business,
    createdBy: data.createdBy,
    revision: data.revision,
    requestHash: data.requestHash,
    updatedAt: data.updatedAt,
  };
};

export interface AuthoritativeOccurrence {
  id: string;
  workspaceId: string;
  recurringExpenseId: string;
  dueDate: string;
  competenceMonth: string;
  plannedAmountCents: number;
  actualAmountCents: number | null;
  status: OccurrenceStatus;
  targetDomain: OccurrenceTargetDomain;
  executionMode: RecurringExecutionMode;
  cardId: string | null;
  cashAccountId: string | null;
  cashTransactionId: string | null;
  cardPurchaseId: string | null;
  attentionCode: AttentionCode | null;
  revision: number;
  updatedAt: Timestamp;
}

/**
 * Ocorrência no schema autoritativo, ou `null`. Gerada tem exatamente um
 * fato, do domínio de destino; nenhum outro estado tem fato; atenção tem
 * código e só ela tem código.
 */
export const readAuthoritativeOccurrence = (
  id: string,
  data: admin.firestore.DocumentData | undefined,
  workspaceId: string,
): AuthoritativeOccurrence | null => {
  if (!data || data.schemaVersion !== RECURRING_SCHEMA_VERSION) return null;
  if (
    data.workspaceId !== workspaceId ||
    !isText(data.recurringExpenseId) ||
    !isCivilDayKey(data.dueDate) ||
    data.competenceMonth !== data.dueDate.slice(0, 7) ||
    !isPositiveInt(data.plannedAmountCents) ||
    !(data.actualAmountCents === null ||
      isPositiveInt(data.actualAmountCents)) ||
    data.currency !== MONEY_CURRENCY ||
    !isOneOf(OCCURRENCE_STATUSES, data.status) ||
    (data.targetDomain !== "cash" && data.targetDomain !== "card") ||
    !isOneOf(RECURRING_EXECUTION_MODES, data.executionMode) ||
    !isNullableText(data.cardId) ||
    !isNullableText(data.cashAccountId) ||
    !isNullableText(data.cashTransactionId) ||
    !isNullableText(data.cardPurchaseId) ||
    !(data.attentionCode === null ||
      isOneOf(ATTENTION_CODES, data.attentionCode)) ||
    !isPositiveInt(data.revision) ||
    !(data.updatedAt instanceof Timestamp)
  ) {
    return null;
  }
  const card = data.targetDomain === "card";
  if (card ? !isText(data.cardId) : !isText(data.cashAccountId)) return null;
  const generated = data.status === "generated";
  const fact = card ? data.cardPurchaseId : data.cashTransactionId;
  const otherFact = card ? data.cashTransactionId : data.cardPurchaseId;
  if (otherFact !== null || (generated ? !isText(fact) : fact !== null)) {
    return null;
  }
  const attention = data.status === "attention_required";
  if (attention !== (data.attentionCode !== null)) return null;
  return {
    id,
    workspaceId,
    recurringExpenseId: data.recurringExpenseId,
    dueDate: data.dueDate,
    competenceMonth: data.competenceMonth,
    plannedAmountCents: data.plannedAmountCents,
    actualAmountCents: data.actualAmountCents,
    status: data.status,
    targetDomain: data.targetDomain,
    executionMode: data.executionMode,
    cardId: data.cardId,
    cashAccountId: data.cashAccountId,
    cashTransactionId: data.cashTransactionId,
    cardPurchaseId: data.cardPurchaseId,
    attentionCode: data.attentionCode,
    revision: data.revision,
    updatedAt: data.updatedAt,
  };
};

/** Ocorrência que ainda pede uma ação do usuário. */
export const isOpenOccurrenceStatus = (status: OccurrenceStatus): boolean =>
  status === "awaiting_confirmation" || status === "attention_required";

export const occurrenceDocument = (input: {
  id: string;
  workspaceId: string;
  contract: AuthoritativeRecurringExpense;
  dueDate: string;
  status: OccurrenceStatus;
  actualAmountCents: number | null;
  cashTransactionId: string | null;
  cardPurchaseId: string | null;
  attentionCode: AttentionCode | null;
  settlement: "pending" | "paid" | null;
  actorId: string;
  requestId: string;
}): admin.firestore.DocumentData => ({
  id: input.id,
  schemaVersion: RECURRING_SCHEMA_VERSION,
  workspaceId: input.workspaceId,
  recurringExpenseId: input.contract.id,
  dueDate: input.dueDate,
  competenceMonth: input.dueDate.slice(0, 7),
  plannedAmountCents: input.contract.amountCents,
  actualAmountCents: input.actualAmountCents,
  currency: MONEY_CURRENCY,
  status: input.status,
  targetDomain: targetDomainOf(input.contract.paymentMethod),
  executionMode: input.contract.executionMode,
  paymentMethod: input.contract.paymentMethod,
  cardId: input.contract.cardId,
  cashAccountId: input.contract.cashAccountId,
  cashTransactionId: input.cashTransactionId,
  cardPurchaseId: input.cardPurchaseId,
  attentionCode: input.attentionCode,
  settlement: input.settlement,
  contractRevision: input.contract.revision,
  createdBy: input.actorId,
  updatedBy: input.actorId,
  resolvedBy: input.status === "generated" || input.status === "ignored" ?
    input.actorId : null,
  lastRequestId: input.requestId,
  revision: 1,
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
});

// ------------------------------------------------------------------ eventos

export type RecurringEventOperation =
  | "recurring.created"
  | "recurring.updated"
  | "recurring.paused"
  | "recurring.resumed"
  | "recurring.cancelled"
  | "recurring.ended"
  | "recurring.occurrence_generated"
  | "recurring.occurrence_awaiting"
  | "recurring.occurrence_attention"
  | "recurring.occurrence_confirmed"
  | "recurring.occurrence_ignored"
  | "recurring.occurrence_retried";

export const recurringEventIdFor = (
  operation: RecurringEventOperation,
  targetKey: string,
): string => `${operation.replace(".", "_")}_${
  sha256(`${operation}:${targetKey}`).slice(0, 32)}`;

export type RecurringEventSnapshot = Record<string, number | string | null>;

export interface RecurringEventInput {
  workspaceId: string;
  recurringExpenseId: string;
  occurrenceId: string | null;
  operation: RecurringEventOperation;
  /** Chave do ID determinístico: intenção do ator ou ocorrência. */
  targetKey: string;
  actorId: string;
  actorRole: WorkspaceRole | null;
  intentId: string | null;
  requestHash: string | null;
  requestId: string;
  correlationId: string | null;
  /** Só números, estados, datas e IDs: nenhum texto livre. */
  before: RecurringEventSnapshot | null;
  after: RecurringEventSnapshot | null;
  changedFields?: string[];
  /** Motivo informado pelo usuário numa alteração (ex.: reajuste). */
  reason?: string | null;
}

export const recurringEventRef = (
  workspaceId: string,
  operation: RecurringEventOperation,
  targetKey: string,
) => recurringEventsRef(workspaceId)
  .doc(recurringEventIdFor(operation, targetKey));

/**
 * Evento append-only (`transaction.create`). `amountChanged` indexa o
 * histórico de valores do contrato (criação e cada alteração de valor).
 */
export const appendRecurringEvent = (
  transaction: admin.firestore.Transaction,
  input: RecurringEventInput,
): string => {
  const ref = recurringEventRef(input.workspaceId, input.operation,
    input.targetKey);
  const changedFields = input.changedFields ?? [];
  transaction.create(ref, {
    id: ref.id,
    schemaVersion: RECURRING_SCHEMA_VERSION,
    workspaceId: input.workspaceId,
    recurringExpenseId: input.recurringExpenseId,
    occurrenceId: input.occurrenceId,
    operation: input.operation,
    actorId: input.actorId,
    actorRole: input.actorRole,
    intentId: input.intentId,
    requestHash: input.requestHash,
    requestId: input.requestId,
    correlationId: input.correlationId,
    before: input.before,
    after: input.after,
    changedFields,
    reason: input.reason ?? null,
    amountChanged: input.operation === "recurring.created" ||
      changedFields.includes("amountCents"),
    occurredAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
};

/** Retrato financeiro e de agenda do contrato, para a trilha. */
export const contractSnapshot = (contract: {
  status: RecurringStatus;
  amountCents: number;
  frequency: RecurringFrequency;
  billingDay: number | null;
  startDate: string;
  endDate: string | null;
  paymentMethod: RecurringPaymentMethod;
  executionMode: RecurringExecutionMode;
  cardId: string | null;
  cashAccountId: string | null;
  nextDueDate: string | null;
}): RecurringEventSnapshot => ({
  status: contract.status,
  amountCents: contract.amountCents,
  frequency: contract.frequency,
  billingDay: contract.billingDay,
  startDate: contract.startDate,
  endDate: contract.endDate,
  paymentMethod: contract.paymentMethod,
  executionMode: contract.executionMode,
  cardId: contract.cardId,
  cashAccountId: contract.cashAccountId,
  nextDueDate: contract.nextDueDate,
});

export const occurrenceSnapshot = (occurrence: {
  status: OccurrenceStatus;
  dueDate: string;
  plannedAmountCents: number;
  actualAmountCents: number | null;
  cashTransactionId: string | null;
  cardPurchaseId: string | null;
  attentionCode: AttentionCode | null;
}): RecurringEventSnapshot => ({
  status: occurrence.status,
  dueDate: occurrence.dueDate,
  plannedAmountCents: occurrence.plannedAmountCents,
  actualAmountCents: occurrence.actualAmountCents,
  cashTransactionId: occurrence.cashTransactionId,
  cardPurchaseId: occurrence.cardPurchaseId,
  attentionCode: occurrence.attentionCode,
});
