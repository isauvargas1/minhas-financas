import {
  PJ_COUNTERPARTY_TYPES,
  PJ_LOAN_CLASSIFICATIONS,
  type Loan,
  type LoanInstallment,
  type LoanInterest,
  type LoanMovement,
} from './types.ts';
import { isDayKey } from './money.ts';

/**
 * Leitura dos documentos de empréstimo gravados pelo backend (P3-H).
 *
 * Módulo puro. Um único formato é aceito — o contrato autoritativo
 * `schemaVersion: 1`. Documento que não o respeita (marca ausente, valor que
 * não é centavo inteiro, saldo que não fecha com o principal, cronograma
 * incompleto) devolve `null`: a interface não o exibe nem tenta operá-lo, em
 * vez de "consertar" números na tela.
 */
export const LOAN_SCHEMA_VERSION = 1;

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const isCents = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const optionalText = (value: unknown): string | undefined =>
  isText(value) ? value : undefined;

/** Versão lida (`updatedAt`) em ISO com nanossegundos, ou `null`. */
export const loanVersionOf = (updatedAt: unknown): string | null => {
  const value = updatedAt as { seconds?: unknown; nanoseconds?: unknown } | null;
  if (
    !value ||
    typeof value.seconds !== 'number' ||
    typeof value.nanoseconds !== 'number' ||
    !Number.isSafeInteger(value.seconds) ||
    !Number.isInteger(value.nanoseconds) ||
    value.nanoseconds < 0 ||
    value.nanoseconds > 999_999_999
  ) {
    return null;
  }
  const base = new Date(value.seconds * 1000).toISOString().slice(0, 19);
  return `${base}.${String(value.nanoseconds).padStart(9, '0')}Z`;
};

const readInterest = (value: unknown): LoanInterest | null => {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data !== 'object') return null;
  if (data.type === 'none') return { type: 'none' };
  if (data.type === 'fixed' && isCents(data.totalInterestCents) &&
    data.totalInterestCents > 0) {
    return { type: 'fixed', totalInterestCents: data.totalInterestCents };
  }
  if (
    data.type === 'percentage' &&
    Number.isSafeInteger(data.ratePpm) && (data.ratePpm as number) > 0 &&
    (data.ratePeriod === 'monthly' || data.ratePeriod === 'annual') &&
    (data.amortization === 'price' || data.amortization === 'sac' ||
      data.amortization === 'simple')
  ) {
    return {
      type: 'percentage',
      ratePpm: data.ratePpm as number,
      ratePeriod: data.ratePeriod,
      amortization: data.amortization,
    };
  }
  return null;
};

const readInstallment = (value: unknown): LoanInstallment | null => {
  const data = value as Record<string, unknown> | null;
  if (
    !data ||
    !Number.isSafeInteger(data.number) ||
    !isDayKey(data.dueDate) ||
    !isCents(data.principalCents) ||
    !isCents(data.interestCents) ||
    !isCents(data.totalCents) ||
    data.principalCents + data.interestCents !== data.totalCents
  ) {
    return null;
  }
  return {
    number: data.number as number,
    dueDate: data.dueDate,
    principalCents: data.principalCents,
    interestCents: data.interestCents,
    totalCents: data.totalCents,
  };
};

const LOAN_STATUSES = new Set(['active', 'overdue', 'paid', 'cancelled']);

/** Contrato autoritativo, ou `null` se o documento não for um. */
export const toLoan = (id: string, data: Record<string, unknown> | undefined): Loan | null => {
  if (!data || data.schemaVersion !== LOAN_SCHEMA_VERSION) return null;
  const interest = readInterest(data.interest);
  const version = loanVersionOf(data.updatedAt);
  const schedule = Array.isArray(data.schedule)
    ? data.schedule.map(readInstallment)
    : null;
  if (
    !isText(data.workspaceId) ||
    (data.profileType !== 'PF' && data.profileType !== 'PJ') ||
    (data.type !== 'borrow' && data.type !== 'lend') ||
    !isText(data.personName) ||
    !isCents(data.principalCents) || data.principalCents === 0 ||
    !isCents(data.balanceCents) ||
    !isCents(data.totalPrincipalSettledCents) ||
    !isCents(data.totalInterestSettledCents) ||
    !isCents(data.activePaymentCount) ||
    data.balanceCents + data.totalPrincipalSettledCents !== data.principalCents ||
    !LOAN_STATUSES.has(data.status as string) ||
    !(data.overdueFrom === null || data.overdueFrom === undefined || isDayKey(data.overdueFrom)) ||
    !interest ||
    !isDayKey(data.startDate) ||
    !isDayKey(data.firstDueDate) ||
    !isDayKey(data.maturityDate) ||
    !Number.isSafeInteger(data.installmentsCount) ||
    !schedule || schedule.length !== data.installmentsCount ||
    schedule.some((installment) => installment === null) ||
    !isCents(data.scheduledInterestCents) ||
    !isText(data.createdBy) ||
    !version ||
    !Number.isSafeInteger(data.revision)
  ) {
    return null;
  }
  const isPJ = data.profileType === 'PJ';
  const counterpartyType = PJ_COUNTERPARTY_TYPES.find((value) => value === data.counterpartyType);
  const classification = PJ_LOAN_CLASSIFICATIONS.find((value) => value === data.classification);
  return {
    id,
    workspaceId: data.workspaceId,
    profileType: data.profileType,
    type: data.type,
    personName: data.personName,
    personContact: optionalText(data.personContact),
    description: optionalText(data.description),
    counterpartyType: isPJ ? counterpartyType : undefined,
    cnpjCpf: isPJ ? optionalText(data.cnpjCpf) : undefined,
    classification: isPJ ? classification : undefined,
    costCenter: isPJ ? optionalText(data.costCenter) : undefined,
    principalCents: data.principalCents,
    balanceCents: data.balanceCents,
    totalPrincipalSettledCents: data.totalPrincipalSettledCents,
    totalInterestSettledCents: data.totalInterestSettledCents,
    activePaymentCount: data.activePaymentCount,
    status: data.status as Loan['status'],
    overdueFrom: isDayKey(data.overdueFrom) ? data.overdueFrom : null,
    interest,
    startDate: data.startDate,
    firstDueDate: data.firstDueDate,
    installmentsCount: data.installmentsCount as number,
    schedule: schedule as LoanInstallment[],
    scheduledInterestCents: data.scheduledInterestCents,
    maturityDate: data.maturityDate,
    createdBy: data.createdBy,
    updatedBy: optionalText(data.updatedBy),
    version,
    revision: data.revision as number,
  };
};

/** Movimento autoritativo do contrato, ou `null`. */
export const toLoanMovement = (
  id: string,
  data: Record<string, unknown> | undefined,
): LoanMovement | null => {
  if (
    !data ||
    data.schemaVersion !== LOAN_SCHEMA_VERSION ||
    !isText(data.loanId) ||
    (data.kind !== 'disbursement' && data.kind !== 'payment' && data.kind !== 'reversal') ||
    !isCents(data.principalCents) ||
    !isCents(data.interestCents) ||
    !isCents(data.totalCents) ||
    data.principalCents + data.interestCents !== data.totalCents ||
    !isDayKey(data.date) ||
    (data.cashDirection !== 'in' && data.cashDirection !== 'out') ||
    !isText(data.cashTransactionId) ||
    !isText(data.createdBy) ||
    (data.kind === 'reversal' && !isText(data.reversalOf))
  ) {
    return null;
  }
  return {
    id,
    loanId: data.loanId,
    kind: data.kind,
    originalKind: data.originalKind === 'disbursement' || data.originalKind === 'payment'
      ? data.originalKind
      : undefined,
    principalCents: data.principalCents,
    interestCents: data.interestCents,
    totalCents: data.totalCents,
    date: data.date,
    cashDirection: data.cashDirection,
    cashTransactionId: data.cashTransactionId,
    reversalOf: isText(data.reversalOf) ? data.reversalOf : null,
    reversedBy: isText(data.reversedBy) ? data.reversedBy : null,
    reason: isText(data.reason) ? data.reason : null,
    createdBy: data.createdBy,
  };
};
