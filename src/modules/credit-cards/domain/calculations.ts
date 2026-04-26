import type {
  CardLimitLedger,
  CardLimitLedgerDirection,
  CompetenceMonth,
  CreditCardInstallment,
  CreditCardInvoice,
  CreditCardInvoicePayment,
  CreditCardLimitSnapshot,
  CreditCardPurchase,
  IsoDateString,
  MoneyAmount,
} from './types.ts';

import {
  areMoneyAmountsEqual,
  calculateInvoiceRemainingAmount,
  deriveInvoicePaymentStatus,
  isPositiveMoneyAmount,
  isValidCompetenceMonth,
  normalizeMoneyAmount,
  sumMoneyAmounts,
} from './invariants.ts';

export interface CreditCardBillingRules {
  closingDay: number;
  dueDay: number;
  bestDay?: number;
}

export interface CreditCardInvoicePeriod {
  competenceMonth: CompetenceMonth;
  closingDate: IsoDateString;
  dueDate: IsoDateString;
}

export interface GenerateCreditCardInstallmentsInput {
  purchase: CreditCardPurchase;
  billingRules: CreditCardBillingRules;
}

export interface BuildCreditCardInvoiceInput {
  workspaceId: string;
  cardId: string;
  competenceMonth: CompetenceMonth;
  billingRules: CreditCardBillingRules;
  installments: CreditCardInstallment[];
  status?: CreditCardInvoice['status'];
}

export interface AttachInstallmentsToInvoicesCalculationInput {
  installments: CreditCardInstallment[];
  billingRules: CreditCardBillingRules;
}

export interface AttachInstallmentsToInvoicesCalculationOutput {
  invoices: CreditCardInvoice[];
  installments: CreditCardInstallment[];
}

export interface RecalculateCreditCardInvoiceInput {
  invoice: CreditCardInvoice;
  installments: CreditCardInstallment[];
  payments: CreditCardInvoicePayment[];
  referenceDate?: IsoDateString;
}

export interface CalculateCardLimitSnapshotFromLedgerInput {
  workspaceId: string;
  cardId: string;
  limitTotal: MoneyAmount;
  ledgerEntries: CardLimitLedger[];
  updatedAt: unknown;
}

export interface CardLimitImpact {
  direction: CardLimitLedgerDirection;
  amount: MoneyAmount;
  limitUsedDelta: MoneyAmount;
  limitAvailableDelta: MoneyAmount;
}

export class CreditCardCalculationError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'CreditCardCalculationError';
    this.code = code;
    this.details = details;
  }
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

const assertValidBillingRules = (billingRules: CreditCardBillingRules): void => {
  const { closingDay, dueDay, bestDay } = billingRules;

  if (!Number.isInteger(closingDay) || closingDay < 1 || closingDay > 31) {
    throw new CreditCardCalculationError(
      'invalid_closing_day',
      'O dia de fechamento do cartão precisa ser um inteiro entre 1 e 31.',
      { closingDay }
    );
  }

  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    throw new CreditCardCalculationError(
      'invalid_due_day',
      'O dia de vencimento do cartão precisa ser um inteiro entre 1 e 31.',
      { dueDay }
    );
  }

  if (bestDay !== undefined && (!Number.isInteger(bestDay) || bestDay < 1 || bestDay > 31)) {
    throw new CreditCardCalculationError(
      'invalid_best_day',
      'O melhor dia de compra do cartão precisa ser um inteiro entre 1 e 31.',
      { bestDay }
    );
  }
};

const getLastDayOfMonth = (year: number, monthIndex: number): number =>
  new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();

const clampDayToMonth = (year: number, monthIndex: number, day: number): number =>
  Math.min(day, getLastDayOfMonth(year, monthIndex));

const padNumber = (value: number): string => String(value).padStart(2, '0');

const formatIsoDateFromParts = (
  year: number,
  monthIndex: number,
  day: number
): IsoDateString => {
  const safeDay = clampDayToMonth(year, monthIndex, day);
  return `${year}-${padNumber(monthIndex + 1)}-${padNumber(safeDay)}`;
};

const parseIsoDateToParts = (
  date: IsoDateString
): { year: number; monthIndex: number; day: number } => {
  const match = ISO_DATE_PATTERN.exec(date);

  if (!match) {
    throw new CreditCardCalculationError(
      'invalid_iso_date',
      'A data precisa estar em formato ISO compatível com YYYY-MM-DD.',
      { date }
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthIndex = month - 1;
  const lastDayOfMonth = getLastDayOfMonth(year, monthIndex);

  if (month < 1 || month > 12 || day < 1 || day > lastDayOfMonth) {
    throw new CreditCardCalculationError(
      'invalid_iso_date_parts',
      'A data possui ano, mês ou dia inválido.',
      { date }
    );
  }

  return { year, monthIndex, day };
};

const parseCompetenceMonthToParts = (
  competenceMonth: CompetenceMonth
): { year: number; monthIndex: number } => {
  if (!isValidCompetenceMonth(competenceMonth)) {
    throw new CreditCardCalculationError(
      'invalid_competence_month',
      'A competência precisa estar no formato YYYY-MM.',
      { competenceMonth }
    );
  }

  const [year, month] = competenceMonth.split('-').map(Number);

  return {
    year,
    monthIndex: month - 1,
  };
};

export const formatCompetenceMonthFromParts = (
  year: number,
  monthIndex: number
): CompetenceMonth => {
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return `${date.getUTCFullYear()}-${padNumber(date.getUTCMonth() + 1)}`;
};

export const addMonthsToCompetenceMonth = (
  competenceMonth: CompetenceMonth,
  monthsToAdd: number
): CompetenceMonth => {
  const { year, monthIndex } = parseCompetenceMonthToParts(competenceMonth);
  return formatCompetenceMonthFromParts(year, monthIndex + monthsToAdd);
};

export const calculateFirstInvoiceCompetence = (
  purchaseDate: IsoDateString,
  billingRules: CreditCardBillingRules
): CompetenceMonth => {
  assertValidBillingRules(billingRules);

  const { year, monthIndex, day } = parseIsoDateToParts(purchaseDate);
  const purchaseCompetence = formatCompetenceMonthFromParts(year, monthIndex);
  const monthOffset = day > billingRules.closingDay ? 1 : 0;

  return addMonthsToCompetenceMonth(purchaseCompetence, monthOffset);
};

export const calculateInvoiceClosingDate = (
  competenceMonth: CompetenceMonth,
  billingRules: CreditCardBillingRules
): IsoDateString => {
  assertValidBillingRules(billingRules);

  const { year, monthIndex } = parseCompetenceMonthToParts(competenceMonth);

  return formatIsoDateFromParts(year, monthIndex, billingRules.closingDay);
};

export const calculateInvoiceDueDate = (
  competenceMonth: CompetenceMonth,
  billingRules: CreditCardBillingRules
): IsoDateString => {
  assertValidBillingRules(billingRules);

  const { year, monthIndex } = parseCompetenceMonthToParts(competenceMonth);

  return formatIsoDateFromParts(year, monthIndex, billingRules.dueDay);
};

export const calculateInvoicePeriod = (
  competenceMonth: CompetenceMonth,
  billingRules: CreditCardBillingRules
): CreditCardInvoicePeriod => ({
  competenceMonth,
  closingDate: calculateInvoiceClosingDate(competenceMonth, billingRules),
  dueDate: calculateInvoiceDueDate(competenceMonth, billingRules),
});

export const calculateInstallmentAmounts = (
  totalAmount: MoneyAmount,
  installmentsCount: number
): MoneyAmount[] => {
  const normalizedTotal = normalizeMoneyAmount(totalAmount);

  if (!isPositiveMoneyAmount(normalizedTotal)) {
    throw new CreditCardCalculationError(
      'invalid_total_amount',
      'O valor total precisa ser maior que zero.',
      { totalAmount }
    );
  }

  if (!Number.isInteger(installmentsCount) || installmentsCount < 1) {
    throw new CreditCardCalculationError(
      'invalid_installments_count',
      'A quantidade de parcelas precisa ser um inteiro maior ou igual a 1.',
      { installmentsCount }
    );
  }

  const baseAmount = normalizeMoneyAmount(normalizedTotal / installmentsCount);
  const amounts: MoneyAmount[] = [];
  let accumulated = 0;

  for (let index = 0; index < installmentsCount; index += 1) {
    const isLastInstallment = index === installmentsCount - 1;
    const amount = isLastInstallment
      ? normalizeMoneyAmount(normalizedTotal - accumulated)
      : baseAmount;

    amounts.push(amount);
    accumulated = normalizeMoneyAmount(accumulated + amount);
  }

  const calculatedTotal = sumMoneyAmounts(amounts);

  if (!areMoneyAmountsEqual(calculatedTotal, normalizedTotal)) {
    throw new CreditCardCalculationError(
      'installment_amounts_total_mismatch',
      'A soma das parcelas calculadas precisa fechar com o valor total.',
      { totalAmount, installmentsCount, calculatedTotal }
    );
  }

  return amounts;
};

export const buildCreditCardInstallmentId = (
  purchaseId: string,
  installmentNumber: number
): string => `${purchaseId}_installment_${String(installmentNumber).padStart(3, '0')}`;

export const buildCreditCardInvoiceId = (
  cardId: string,
  competenceMonth: CompetenceMonth
): string => `${cardId}_${competenceMonth}`;

export const generateCreditCardInstallmentsFromPurchase = (
  input: GenerateCreditCardInstallmentsInput
): CreditCardInstallment[] => {
  const { purchase, billingRules } = input;

  assertValidBillingRules(billingRules);

  if (!isValidCompetenceMonth(purchase.firstInvoiceCompetence)) {
    throw new CreditCardCalculationError(
      'invalid_first_invoice_competence',
      'A competência da primeira fatura da compra precisa estar no formato YYYY-MM.',
      { firstInvoiceCompetence: purchase.firstInvoiceCompetence }
    );
  }

  const amounts = calculateInstallmentAmounts(
    purchase.totalAmount,
    purchase.installmentsCount
  );

  return amounts.map((amount, index) => {
    const installmentNumber = index + 1;
    const competenceMonth = addMonthsToCompetenceMonth(
      purchase.firstInvoiceCompetence,
      index
    );

    return {
      id: buildCreditCardInstallmentId(purchase.id, installmentNumber),
      workspaceId: purchase.workspaceId,
      purchaseId: purchase.id,
      cardId: purchase.cardId,
      installmentNumber,
      installmentsCount: purchase.installmentsCount,
      amount,
      competenceMonth,
      dueDate: calculateInvoiceDueDate(competenceMonth, billingRules),
      status: 'projected',
      paidAmount: 0,
    };
  });
};

export const isBillableInstallment = (
  installment: CreditCardInstallment
): boolean =>
  installment.status !== 'cancelled' && installment.status !== 'reversed';

export const groupInstallmentsByCompetenceMonth = (
  installments: CreditCardInstallment[]
): Record<CompetenceMonth, CreditCardInstallment[]> =>
  installments.reduce<Record<CompetenceMonth, CreditCardInstallment[]>>(
    (groups, installment) => {
      if (!isBillableInstallment(installment)) return groups;

      if (!groups[installment.competenceMonth]) {
        groups[installment.competenceMonth] = [];
      }

      groups[installment.competenceMonth].push(installment);

      return groups;
    },
    {}
  );

export const calculateInvoiceTotalsFromInstallments = (
  installments: CreditCardInstallment[]
): Pick<
  CreditCardInvoice,
  'totalAmount' | 'paidAmount' | 'remainingAmount' | 'itemsCount' | 'paymentStatusDerived'
> => {
  const billableInstallments = installments.filter(isBillableInstallment);
  const totalAmount = sumMoneyAmounts(
    billableInstallments.map((installment) => installment.amount)
  );
  const paidAmount = sumMoneyAmounts(
    billableInstallments.map((installment) => installment.paidAmount)
  );
  const remainingAmount = calculateInvoiceRemainingAmount(totalAmount, paidAmount);

  return {
    totalAmount,
    paidAmount,
    remainingAmount,
    itemsCount: billableInstallments.length,
    paymentStatusDerived: deriveInvoicePaymentStatus(totalAmount, paidAmount),
  };
};

export const deriveInvoiceStatusFromAmounts = (
  totalAmount: MoneyAmount,
  paidAmount: MoneyAmount,
  currentStatus: CreditCardInvoice['status'] = 'open',
  dueDate?: IsoDateString,
  referenceDate?: IsoDateString
): CreditCardInvoice['status'] => {
  if (currentStatus === 'cancelled') return 'cancelled';

  const normalizedTotal = normalizeMoneyAmount(totalAmount);
  const normalizedPaid = normalizeMoneyAmount(paidAmount);
  const remainingAmount = calculateInvoiceRemainingAmount(normalizedTotal, normalizedPaid);

  if (normalizedTotal === 0) return currentStatus === 'closed' ? 'closed' : 'open';
  if (remainingAmount === 0) return 'paid';
  if (normalizedPaid > 0) return 'partial_paid';

  if (dueDate && referenceDate && dueDate < referenceDate) {
    return 'overdue';
  }

  return currentStatus === 'closed' ? 'closed' : 'open';
};

export const buildCreditCardInvoiceFromInstallments = (
  input: BuildCreditCardInvoiceInput
): CreditCardInvoice => {
  const { workspaceId, cardId, competenceMonth, billingRules, installments, status } = input;
  const period = calculateInvoicePeriod(competenceMonth, billingRules);
  const totals = calculateInvoiceTotalsFromInstallments(installments);
  const invoiceStatus = status ?? deriveInvoiceStatusFromAmounts(
    totals.totalAmount,
    totals.paidAmount,
    'open',
    period.dueDate
  );

  return {
    id: buildCreditCardInvoiceId(cardId, competenceMonth),
    workspaceId,
    cardId,
    competenceMonth,
    closingDate: period.closingDate,
    dueDate: period.dueDate,
    status: invoiceStatus,
    totalAmount: totals.totalAmount,
    paidAmount: totals.paidAmount,
    remainingAmount: totals.remainingAmount,
    itemsCount: totals.itemsCount,
    paymentStatusDerived: totals.paymentStatusDerived,
  };
};

export const attachInstallmentsToInvoicesCalculation = (
  input: AttachInstallmentsToInvoicesCalculationInput
): AttachInstallmentsToInvoicesCalculationOutput => {
  const { installments, billingRules } = input;

  assertValidBillingRules(billingRules);

  if (installments.length === 0) {
    return {
      invoices: [],
      installments: [],
    };
  }

  const firstInstallment = installments[0];
  const workspaceId = firstInstallment.workspaceId;
  const cardId = firstInstallment.cardId;

  const invalidScope = installments.some(
    (installment) => installment.workspaceId !== workspaceId || installment.cardId !== cardId
  );

  if (invalidScope) {
    throw new CreditCardCalculationError(
      'installments_scope_mismatch',
      'Todas as parcelas precisam pertencer ao mesmo workspace e cartão para anexação em faturas.',
      { workspaceId, cardId }
    );
  }

  const grouped = groupInstallmentsByCompetenceMonth(installments);
  const competenceMonths = Object.keys(grouped).sort();

  const invoices = competenceMonths.map((competenceMonth) =>
    buildCreditCardInvoiceFromInstallments({
      workspaceId,
      cardId,
      competenceMonth,
      billingRules,
      installments: grouped[competenceMonth],
    })
  );

  const invoiceIdByCompetence = invoices.reduce<Record<string, string>>(
    (map, invoice) => ({
      ...map,
      [invoice.competenceMonth]: invoice.id,
    }),
    {}
  );

  const attachedInstallments = installments.map((installment) => ({
    ...installment,
    invoiceId: isBillableInstallment(installment)
      ? invoiceIdByCompetence[installment.competenceMonth]
      : installment.invoiceId,
    status: installment.status === 'projected' && isBillableInstallment(installment)
      ? 'invoiced'
      : installment.status,
  }));

  return {
    invoices,
    installments: attachedInstallments,
  };
};

export const recalculateCreditCardInvoice = (
  input: RecalculateCreditCardInvoiceInput
): CreditCardInvoice => {
  const { invoice, installments, payments, referenceDate } = input;

  const billableInstallments = installments.filter(
    (installment) =>
      isBillableInstallment(installment) &&
      installment.workspaceId === invoice.workspaceId &&
      installment.cardId === invoice.cardId &&
      (installment.invoiceId === invoice.id || installment.competenceMonth === invoice.competenceMonth)
  );

  const postedPayments = payments.filter(
    (payment) =>
      payment.status === 'posted' &&
      payment.workspaceId === invoice.workspaceId &&
      payment.cardId === invoice.cardId &&
      payment.invoiceId === invoice.id
  );

  const totalAmount = sumMoneyAmounts(
    billableInstallments.map((installment) => installment.amount)
  );
  const paidAmount = sumMoneyAmounts(
    postedPayments.map((payment) => payment.amount)
  );
  const remainingAmount = calculateInvoiceRemainingAmount(totalAmount, paidAmount);
  const paymentStatusDerived = deriveInvoicePaymentStatus(totalAmount, paidAmount);
  const status = deriveInvoiceStatusFromAmounts(
    totalAmount,
    paidAmount,
    invoice.status,
    invoice.dueDate,
    referenceDate
  );

  return {
    ...invoice,
    status,
    totalAmount,
    paidAmount,
    remainingAmount,
    itemsCount: billableInstallments.length,
    paymentStatusDerived,
  };
};

export const calculatePurchaseLimitImpact = (
  purchase: CreditCardPurchase
): CardLimitImpact => ({
  direction: 'consume',
  amount: normalizeMoneyAmount(purchase.totalAmount),
  limitUsedDelta: normalizeMoneyAmount(purchase.totalAmount),
  limitAvailableDelta: normalizeMoneyAmount(-purchase.totalAmount),
});

export const calculateInvoicePaymentLimitImpact = (
  paymentAmount: MoneyAmount
): CardLimitImpact => {
  const amount = normalizeMoneyAmount(paymentAmount);

  if (!isPositiveMoneyAmount(amount)) {
    throw new CreditCardCalculationError(
      'invalid_payment_limit_impact_amount',
      'O valor usado para recompor limite precisa ser maior que zero.',
      { paymentAmount }
    );
  }

  return {
    direction: 'restore',
    amount,
    limitUsedDelta: normalizeMoneyAmount(-amount),
    limitAvailableDelta: amount,
  };
};

export const calculateLimitImpactByDirection = (
  direction: CardLimitLedgerDirection,
  amount: MoneyAmount
): CardLimitImpact => {
  const normalizedAmount = normalizeMoneyAmount(amount);

  if (!isPositiveMoneyAmount(normalizedAmount)) {
    throw new CreditCardCalculationError(
      'invalid_limit_impact_amount',
      'O valor do impacto de limite precisa ser maior que zero.',
      { amount }
    );
  }

  return direction === 'consume'
    ? {
        direction,
        amount: normalizedAmount,
        limitUsedDelta: normalizedAmount,
        limitAvailableDelta: normalizeMoneyAmount(-normalizedAmount),
      }
    : {
        direction,
        amount: normalizedAmount,
        limitUsedDelta: normalizeMoneyAmount(-normalizedAmount),
        limitAvailableDelta: normalizedAmount,
      };
};

export const calculateCardLimitSnapshotFromLedger = (
  input: CalculateCardLimitSnapshotFromLedgerInput
): CreditCardLimitSnapshot => {
  const { workspaceId, cardId, limitTotal, ledgerEntries, updatedAt } = input;
  const scopedLedgerEntries = ledgerEntries.filter(
    (entry) => entry.workspaceId === workspaceId && entry.cardId === cardId
  );

  const consumedAmount = sumMoneyAmounts(
    scopedLedgerEntries
      .filter((entry) => entry.direction === 'consume')
      .map((entry) => entry.amount)
  );

  const restoredAmount = sumMoneyAmounts(
    scopedLedgerEntries
      .filter((entry) => entry.direction === 'restore')
      .map((entry) => entry.amount)
  );

  const limitUsed = normalizeMoneyAmount(consumedAmount - restoredAmount);
  const limitAvailable = normalizeMoneyAmount(limitTotal - limitUsed);

  return {
    workspaceId,
    cardId,
    limitTotal: normalizeMoneyAmount(limitTotal),
    limitUsed,
    limitAvailable,
    updatedAt,
  };
};