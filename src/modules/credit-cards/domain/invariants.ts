import type {
  CardLimitLedger,
  CardLimitLedgerDirection,
  CreditCardInstallment,
  CreditCardInstallmentStatus,
  CreditCardInvoice,
  CreditCardInvoicePayment,
  CreditCardInvoicePaymentStatus,
  CreditCardInvoiceStatus,
  CreditCardLimitSnapshot,
  CreditCardPurchase,
  CreditCardPurchaseStatus,
  MoneyAmount,
} from './types.ts';

export type DomainValidationSeverity = 'error' | 'warning';

export interface DomainValidationIssue {
  code: string;
  message: string;
  field?: string;
  severity: DomainValidationSeverity;
}

export interface DomainValidationResult {
  valid: boolean;
  issues: DomainValidationIssue[];
}

export const MONEY_DECIMAL_PLACES = 2;
export const MONEY_TOLERANCE = 0.01;

const buildValidationResult = (issues: DomainValidationIssue[]): DomainValidationResult => ({
  valid: !issues.some((issue) => issue.severity === 'error'),
  issues,
});

const buildError = (
  code: string,
  message: string,
  field?: string
): DomainValidationIssue => ({
  code,
  message,
  field,
  severity: 'error',
});

const buildWarning = (
  code: string,
  message: string,
  field?: string
): DomainValidationIssue => ({
  code,
  message,
  field,
  severity: 'warning',
});

export const normalizeMoneyAmount = (amount: MoneyAmount): MoneyAmount => {
  if (!Number.isFinite(amount)) return amount;

  const factor = 10 ** MONEY_DECIMAL_PLACES;
  return Math.round((amount + Number.EPSILON) * factor) / factor;
};

export const sumMoneyAmounts = (amounts: MoneyAmount[]): MoneyAmount =>
  normalizeMoneyAmount(amounts.reduce((total, amount) => total + amount, 0));

export const areMoneyAmountsEqual = (
  left: MoneyAmount,
  right: MoneyAmount
): boolean => Math.abs(normalizeMoneyAmount(left) - normalizeMoneyAmount(right)) <= MONEY_TOLERANCE;

export const isPositiveMoneyAmount = (amount: MoneyAmount): boolean =>
  Number.isFinite(amount) && amount > 0;

export const isNonNegativeMoneyAmount = (amount: MoneyAmount): boolean =>
  Number.isFinite(amount) && amount >= 0;

export const isValidCompetenceMonth = (competenceMonth: string): boolean =>
  /^\d{4}-(0[1-9]|1[0-2])$/.test(competenceMonth);

export const isValidIsoDateString = (date: string): boolean =>
  typeof date === 'string' && date.trim().length > 0 && !Number.isNaN(Date.parse(date));

export const calculateInvoiceRemainingAmount = (
  totalAmount: MoneyAmount,
  paidAmount: MoneyAmount
): MoneyAmount => normalizeMoneyAmount(Math.max(totalAmount - paidAmount, 0));

export const deriveInvoicePaymentStatus = (
  totalAmount: MoneyAmount,
  paidAmount: MoneyAmount
): CreditCardInvoice['paymentStatusDerived'] => {
  const normalizedTotal = normalizeMoneyAmount(totalAmount);
  const normalizedPaid = normalizeMoneyAmount(paidAmount);

  if (normalizedTotal <= 0) return 'paid';
  if (normalizedPaid <= 0) return 'unpaid';
  if (normalizedPaid < normalizedTotal) return 'partial';
  if (areMoneyAmountsEqual(normalizedPaid, normalizedTotal)) return 'paid';

  return 'overpaid';
};

export const calculateLimitAvailable = (
  limitTotal: MoneyAmount,
  limitUsed: MoneyAmount
): MoneyAmount => normalizeMoneyAmount(limitTotal - limitUsed);

export const calculateLimitBalanceAfter = (
  previousBalanceAvailable: MoneyAmount,
  direction: CardLimitLedgerDirection,
  amount: MoneyAmount
): MoneyAmount => {
  const normalizedPrevious = normalizeMoneyAmount(previousBalanceAvailable);
  const normalizedAmount = normalizeMoneyAmount(amount);

  return direction === 'consume'
    ? normalizeMoneyAmount(normalizedPrevious - normalizedAmount)
    : normalizeMoneyAmount(normalizedPrevious + normalizedAmount);
};

export const CREDIT_CARD_PURCHASE_STATUS_TRANSITIONS: Record<
  CreditCardPurchaseStatus,
  readonly CreditCardPurchaseStatus[]
> = {
  active: ['cancelled', 'partially_reversed', 'fully_reversed'],
  cancelled: [],
  partially_reversed: ['cancelled', 'fully_reversed'],
  fully_reversed: [],
};

export const CREDIT_CARD_INSTALLMENT_STATUS_TRANSITIONS: Record<
  CreditCardInstallmentStatus,
  readonly CreditCardInstallmentStatus[]
> = {
  projected: ['invoiced', 'cancelled', 'reversed'],
  invoiced: ['paid', 'cancelled', 'reversed'],
  paid: ['reversed'],
  cancelled: [],
  reversed: [],
};

export const CREDIT_CARD_INVOICE_STATUS_TRANSITIONS: Record<
  CreditCardInvoiceStatus,
  readonly CreditCardInvoiceStatus[]
> = {
  open: ['closed', 'partial_paid', 'paid', 'overdue', 'cancelled'],
  closed: ['open', 'partial_paid', 'paid', 'overdue', 'cancelled'],
  partial_paid: ['paid', 'overdue', 'cancelled'],
  paid: [],
  overdue: ['partial_paid', 'paid', 'cancelled'],
  cancelled: [],
};

export const CREDIT_CARD_INVOICE_PAYMENT_STATUS_TRANSITIONS: Record<
  CreditCardInvoicePaymentStatus,
  readonly CreditCardInvoicePaymentStatus[]
> = {
  posted: ['reversed'],
  reversed: [],
};

const canTransition = <Status extends string>(
  transitions: Record<Status, readonly Status[]>,
  from: Status,
  to: Status
): boolean => from === to || transitions[from]?.includes(to) === true;

export const canTransitionPurchaseStatus = (
  from: CreditCardPurchaseStatus,
  to: CreditCardPurchaseStatus
): boolean => canTransition(CREDIT_CARD_PURCHASE_STATUS_TRANSITIONS, from, to);

export const canTransitionInstallmentStatus = (
  from: CreditCardInstallmentStatus,
  to: CreditCardInstallmentStatus
): boolean => canTransition(CREDIT_CARD_INSTALLMENT_STATUS_TRANSITIONS, from, to);

export const canTransitionInvoiceStatus = (
  from: CreditCardInvoiceStatus,
  to: CreditCardInvoiceStatus
): boolean => canTransition(CREDIT_CARD_INVOICE_STATUS_TRANSITIONS, from, to);

export const canTransitionInvoicePaymentStatus = (
  from: CreditCardInvoicePaymentStatus,
  to: CreditCardInvoicePaymentStatus
): boolean => canTransition(CREDIT_CARD_INVOICE_PAYMENT_STATUS_TRANSITIONS, from, to);

export const validateCreditCardPurchase = (
  purchase: CreditCardPurchase
): DomainValidationResult => {
  const issues: DomainValidationIssue[] = [];

  if (!purchase.workspaceId) {
    issues.push(buildError('purchase_workspace_required', 'A compra precisa estar vinculada a um workspace.', 'workspaceId'));
  }

  if (!purchase.cardId) {
    issues.push(buildError('purchase_card_required', 'A compra precisa estar vinculada a um cartão.', 'cardId'));
  }

  if (!purchase.description.trim()) {
    issues.push(buildError('purchase_description_required', 'A descrição da compra é obrigatória.', 'description'));
  }

  if (!isValidIsoDateString(purchase.purchaseDate)) {
    issues.push(buildError('purchase_date_invalid', 'A data da compra precisa ser uma data válida.', 'purchaseDate'));
  }

  if (!isPositiveMoneyAmount(purchase.totalAmount)) {
    issues.push(buildError('purchase_total_amount_invalid', 'O valor total da compra precisa ser maior que zero.', 'totalAmount'));
  }

  if (!Number.isInteger(purchase.installmentsCount) || purchase.installmentsCount < 1) {
    issues.push(buildError('purchase_installments_count_invalid', 'A quantidade de parcelas precisa ser um inteiro maior ou igual a 1.', 'installmentsCount'));
  }

  if (!isValidCompetenceMonth(purchase.firstInvoiceCompetence)) {
    issues.push(buildError('purchase_first_invoice_competence_invalid', 'A competência da primeira fatura deve usar o formato YYYY-MM.', 'firstInvoiceCompetence'));
  }

  if (!purchase.createdBy) {
    issues.push(buildError('purchase_created_by_required', 'A compra precisa registrar o usuário responsável pela criação.', 'createdBy'));
  }

  return buildValidationResult(issues);
};

export const validateCreditCardInstallment = (
  installment: CreditCardInstallment
): DomainValidationResult => {
  const issues: DomainValidationIssue[] = [];

  if (!installment.workspaceId) {
    issues.push(buildError('installment_workspace_required', 'A parcela precisa estar vinculada a um workspace.', 'workspaceId'));
  }

  if (!installment.purchaseId) {
    issues.push(buildError('installment_purchase_required', 'A parcela precisa estar vinculada a uma compra.', 'purchaseId'));
  }

  if (!installment.cardId) {
    issues.push(buildError('installment_card_required', 'A parcela precisa estar vinculada a um cartão.', 'cardId'));
  }

  if (!Number.isInteger(installment.installmentNumber) || installment.installmentNumber < 1) {
    issues.push(buildError('installment_number_invalid', 'O número da parcela precisa ser um inteiro maior ou igual a 1.', 'installmentNumber'));
  }

  if (!Number.isInteger(installment.installmentsCount) || installment.installmentsCount < 1) {
    issues.push(buildError('installment_count_invalid', 'A quantidade total de parcelas precisa ser um inteiro maior ou igual a 1.', 'installmentsCount'));
  }

  if (installment.installmentNumber > installment.installmentsCount) {
    issues.push(buildError('installment_number_exceeds_count', 'O número da parcela não pode ser maior que a quantidade total de parcelas.', 'installmentNumber'));
  }

  if (!isPositiveMoneyAmount(installment.amount)) {
    issues.push(buildError('installment_amount_invalid', 'O valor da parcela precisa ser maior que zero.', 'amount'));
  }

  if (!isValidCompetenceMonth(installment.competenceMonth)) {
    issues.push(buildError('installment_competence_invalid', 'A competência da parcela deve usar o formato YYYY-MM.', 'competenceMonth'));
  }

  if (!isValidIsoDateString(installment.dueDate)) {
    issues.push(buildError('installment_due_date_invalid', 'A data de vencimento da parcela precisa ser uma data válida.', 'dueDate'));
  }

  if (!isNonNegativeMoneyAmount(installment.paidAmount)) {
    issues.push(buildError('installment_paid_amount_invalid', 'O valor pago da parcela não pode ser negativo.', 'paidAmount'));
  }

  if (installment.paidAmount > installment.amount) {
    issues.push(buildError('installment_paid_amount_exceeds_amount', 'O valor pago da parcela não pode exceder o valor da parcela.', 'paidAmount'));
  }

  return buildValidationResult(issues);
};

export const validateCreditCardInstallmentsForPurchase = (
  purchase: CreditCardPurchase,
  installments: CreditCardInstallment[]
): DomainValidationResult => {
  const issues: DomainValidationIssue[] = [];

  if (installments.length !== purchase.installmentsCount) {
    issues.push(buildError('installments_count_mismatch', 'A quantidade de parcelas geradas não corresponde à quantidade definida na compra.', 'installmentsCount'));
  }

  const installmentNumbers = new Set<number>();

  installments.forEach((installment) => {
    const installmentResult = validateCreditCardInstallment(installment);
    issues.push(...installmentResult.issues);

    if (installment.workspaceId !== purchase.workspaceId) {
      issues.push(buildError('installment_workspace_mismatch', 'A parcela precisa pertencer ao mesmo workspace da compra.', 'workspaceId'));
    }

    if (installment.cardId !== purchase.cardId) {
      issues.push(buildError('installment_card_mismatch', 'A parcela precisa pertencer ao mesmo cartão da compra.', 'cardId'));
    }

    if (installment.purchaseId !== purchase.id) {
      issues.push(buildError('installment_purchase_mismatch', 'A parcela precisa estar vinculada à compra correta.', 'purchaseId'));
    }

    if (installment.installmentsCount !== purchase.installmentsCount) {
      issues.push(buildError('installment_total_count_mismatch', 'A parcela precisa carregar a mesma quantidade total de parcelas da compra.', 'installmentsCount'));
    }

    if (installmentNumbers.has(installment.installmentNumber)) {
      issues.push(buildError('installment_number_duplicated', 'Não pode haver parcelas duplicadas para a mesma compra.', 'installmentNumber'));
    }

    installmentNumbers.add(installment.installmentNumber);
  });

  const installmentsTotal = sumMoneyAmounts(installments.map((installment) => installment.amount));

  if (!areMoneyAmountsEqual(installmentsTotal, purchase.totalAmount)) {
    issues.push(buildError('installments_total_mismatch', 'A soma das parcelas precisa fechar com o valor total da compra.', 'totalAmount'));
  }

  return buildValidationResult(issues);
};

export const validateCreditCardInvoice = (
  invoice: CreditCardInvoice
): DomainValidationResult => {
  const issues: DomainValidationIssue[] = [];

  if (!invoice.workspaceId) {
    issues.push(buildError('invoice_workspace_required', 'A fatura precisa estar vinculada a um workspace.', 'workspaceId'));
  }

  if (!invoice.cardId) {
    issues.push(buildError('invoice_card_required', 'A fatura precisa estar vinculada a um cartão.', 'cardId'));
  }

  if (!isValidCompetenceMonth(invoice.competenceMonth)) {
    issues.push(buildError('invoice_competence_invalid', 'A competência da fatura deve usar o formato YYYY-MM.', 'competenceMonth'));
  }

  if (!isValidIsoDateString(invoice.closingDate)) {
    issues.push(buildError('invoice_closing_date_invalid', 'A data de fechamento da fatura precisa ser uma data válida.', 'closingDate'));
  }

  if (!isValidIsoDateString(invoice.dueDate)) {
    issues.push(buildError('invoice_due_date_invalid', 'A data de vencimento da fatura precisa ser uma data válida.', 'dueDate'));
  }

  if (!isNonNegativeMoneyAmount(invoice.totalAmount)) {
    issues.push(buildError('invoice_total_amount_invalid', 'O valor total da fatura não pode ser negativo.', 'totalAmount'));
  }

  if (!isNonNegativeMoneyAmount(invoice.paidAmount)) {
    issues.push(buildError('invoice_paid_amount_invalid', 'O valor pago da fatura não pode ser negativo.', 'paidAmount'));
  }

  if (!isNonNegativeMoneyAmount(invoice.remainingAmount)) {
    issues.push(buildError('invoice_remaining_amount_invalid', 'O saldo restante da fatura não pode ser negativo.', 'remainingAmount'));
  }

  const expectedRemainingAmount = calculateInvoiceRemainingAmount(invoice.totalAmount, invoice.paidAmount);

  if (!areMoneyAmountsEqual(invoice.remainingAmount, expectedRemainingAmount)) {
    issues.push(buildError('invoice_remaining_amount_mismatch', 'O saldo restante da fatura precisa ser igual ao total menos o valor pago.', 'remainingAmount'));
  }

  const expectedPaymentStatus = deriveInvoicePaymentStatus(invoice.totalAmount, invoice.paidAmount);

  if (invoice.paymentStatusDerived !== expectedPaymentStatus) {
    issues.push(buildError('invoice_payment_status_mismatch', 'O status derivado de pagamento da fatura não corresponde aos valores financeiros.', 'paymentStatusDerived'));
  }

  if (!Number.isInteger(invoice.itemsCount) || invoice.itemsCount < 0) {
    issues.push(buildError('invoice_items_count_invalid', 'A quantidade de itens da fatura precisa ser um inteiro não negativo.', 'itemsCount'));
  }

  if (invoice.totalAmount > 0 && invoice.itemsCount === 0) {
    issues.push(buildWarning('invoice_positive_amount_without_items', 'A fatura possui valor positivo sem itens vinculados.', 'itemsCount'));
  }

  return buildValidationResult(issues);
};

export const validateCreditCardInvoicePaymentAgainstInvoice = (
  payment: CreditCardInvoicePayment,
  invoice: CreditCardInvoice
): DomainValidationResult => {
  const issues: DomainValidationIssue[] = [];

  if (!payment.workspaceId) {
    issues.push(buildError('payment_workspace_required', 'O pagamento precisa estar vinculado a um workspace.', 'workspaceId'));
  }

  if (!payment.cardId) {
    issues.push(buildError('payment_card_required', 'O pagamento precisa estar vinculado a um cartão.', 'cardId'));
  }

  if (!payment.invoiceId) {
    issues.push(buildError('payment_invoice_required', 'O pagamento precisa estar vinculado a uma fatura.', 'invoiceId'));
  }

  if (payment.workspaceId !== invoice.workspaceId) {
    issues.push(buildError('payment_workspace_mismatch', 'O pagamento precisa pertencer ao mesmo workspace da fatura.', 'workspaceId'));
  }

  if (payment.cardId !== invoice.cardId) {
    issues.push(buildError('payment_card_mismatch', 'O pagamento precisa pertencer ao mesmo cartão da fatura.', 'cardId'));
  }

  if (payment.invoiceId !== invoice.id) {
    issues.push(buildError('payment_invoice_mismatch', 'O pagamento precisa estar vinculado à fatura correta.', 'invoiceId'));
  }

  if (!isValidIsoDateString(payment.paymentDate)) {
    issues.push(buildError('payment_date_invalid', 'A data do pagamento precisa ser uma data válida.', 'paymentDate'));
  }

  if (!isPositiveMoneyAmount(payment.amount)) {
    issues.push(buildError('payment_amount_invalid', 'O valor do pagamento precisa ser maior que zero.', 'amount'));
  }

  if (!payment.idempotencyKey) {
    issues.push(buildError('payment_idempotency_key_required', 'O pagamento precisa de uma chave de idempotência.', 'idempotencyKey'));
  }

  if (!payment.createdBy) {
    issues.push(buildError('payment_created_by_required', 'O pagamento precisa registrar o usuário responsável pela criação.', 'createdBy'));
  }

  if (payment.status === 'posted' && invoice.status === 'cancelled') {
    issues.push(buildError('payment_invoice_cancelled', 'Não é permitido registrar pagamento em fatura cancelada.', 'invoiceId'));
  }

  if (payment.status === 'posted' && payment.amount > invoice.remainingAmount) {
    issues.push(buildWarning('payment_amount_exceeds_remaining', 'O pagamento informado excede o saldo restante da fatura.', 'amount'));
  }

  if (payment.status === 'reversed' && !payment.reversedBy) {
    issues.push(buildError('payment_reversed_by_required', 'Pagamento estornado precisa registrar o usuário responsável pelo estorno.', 'reversedBy'));
  }

  if (payment.status === 'reversed' && !payment.reversalReason?.trim()) {
    issues.push(buildError('payment_reversal_reason_required', 'Pagamento estornado precisa registrar o motivo do estorno.', 'reversalReason'));
  }

  return buildValidationResult(issues);
};

export const validateCreditCardLimitSnapshot = (
  snapshot: CreditCardLimitSnapshot
): DomainValidationResult => {
  const issues: DomainValidationIssue[] = [];

  if (!snapshot.workspaceId) {
    issues.push(buildError('limit_snapshot_workspace_required', 'O snapshot de limite precisa estar vinculado a um workspace.', 'workspaceId'));
  }

  if (!snapshot.cardId) {
    issues.push(buildError('limit_snapshot_card_required', 'O snapshot de limite precisa estar vinculado a um cartão.', 'cardId'));
  }

  if (!isPositiveMoneyAmount(snapshot.limitTotal)) {
    issues.push(buildError('limit_total_invalid', 'O limite total do cartão precisa ser maior que zero.', 'limitTotal'));
  }

  if (!isNonNegativeMoneyAmount(snapshot.limitUsed)) {
    issues.push(buildError('limit_used_invalid', 'O limite usado não pode ser negativo.', 'limitUsed'));
  }

  if (!isNonNegativeMoneyAmount(snapshot.limitAvailable)) {
    issues.push(buildError('limit_available_invalid', 'O limite disponível não pode ser negativo.', 'limitAvailable'));
  }

  const expectedAvailable = calculateLimitAvailable(snapshot.limitTotal, snapshot.limitUsed);

  if (!areMoneyAmountsEqual(snapshot.limitAvailable, expectedAvailable)) {
    issues.push(buildError('limit_available_mismatch', 'O limite disponível precisa ser igual ao limite total menos o limite usado.', 'limitAvailable'));
  }

  if (snapshot.limitUsed > snapshot.limitTotal) {
    issues.push(buildError('limit_used_exceeds_total', 'O limite usado não pode exceder o limite total do cartão.', 'limitUsed'));
  }

  return buildValidationResult(issues);
};

export const validateCardLimitLedgerEntry = (
  entry: CardLimitLedger,
  previousBalanceAvailable?: MoneyAmount
): DomainValidationResult => {
  const issues: DomainValidationIssue[] = [];

  if (!entry.workspaceId) {
    issues.push(buildError('ledger_workspace_required', 'O movimento de limite precisa estar vinculado a um workspace.', 'workspaceId'));
  }

  if (!entry.cardId) {
    issues.push(buildError('ledger_card_required', 'O movimento de limite precisa estar vinculado a um cartão.', 'cardId'));
  }

  if (!entry.sourceId) {
    issues.push(buildError('ledger_source_required', 'O movimento de limite precisa estar vinculado a uma origem.', 'sourceId'));
  }

  if (!isPositiveMoneyAmount(entry.amount)) {
    issues.push(buildError('ledger_amount_invalid', 'O valor do movimento de limite precisa ser maior que zero.', 'amount'));
  }

  if (!isNonNegativeMoneyAmount(entry.balanceAfter)) {
    issues.push(buildError('ledger_balance_after_invalid', 'O saldo de limite após o movimento não pode ser negativo.', 'balanceAfter'));
  }

  if (!entry.actorId) {
    issues.push(buildError('ledger_actor_required', 'O movimento de limite precisa registrar o usuário ou processo responsável.', 'actorId'));
  }

  if (previousBalanceAvailable !== undefined) {
    const expectedBalanceAfter = calculateLimitBalanceAfter(
      previousBalanceAvailable,
      entry.direction,
      entry.amount
    );

    if (!areMoneyAmountsEqual(entry.balanceAfter, expectedBalanceAfter)) {
      issues.push(buildError('ledger_balance_after_mismatch', 'O saldo após o movimento não corresponde ao saldo anterior aplicado à direção do lançamento.', 'balanceAfter'));
    }
  }

  return buildValidationResult(issues);
};