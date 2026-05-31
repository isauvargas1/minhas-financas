export type PaymentLifecycleInvoiceStatus =
  | "open"
  | "closed"
  | "partial_paid"
  | "paid"
  | "overdue"
  | "cancelled";

export interface PaymentLifecycleInvoiceState {
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: PaymentLifecycleInvoiceStatus;
}

export interface PaymentLifecycleLimitSnapshot {
  limitTotal: number;
  limitUsed: number;
  limitAvailable: number;
}

export const normalizeMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const assertPositiveAmount = (amount: number): void => {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Valor inválido para operação financeira.");
  }
};

export const applyInvoicePaymentState = (
  invoice: PaymentLifecycleInvoiceState,
  amount: number,
): PaymentLifecycleInvoiceState => {
  assertPositiveAmount(amount);

  if (invoice.status === "paid" || invoice.status === "cancelled") {
    throw new Error("Fatura não aceita novo pagamento neste estado.");
  }

  if (normalizeMoney(amount) > normalizeMoney(invoice.remainingAmount)) {
    throw new Error("Pagamento maior que o saldo da fatura.");
  }

  const paidAmount = normalizeMoney(invoice.paidAmount + amount);
  const remainingAmount = normalizeMoney(invoice.totalAmount - paidAmount);

  return {
    ...invoice,
    paidAmount,
    remainingAmount,
    status: remainingAmount <= 0 ? "paid" : "partial_paid",
  };
};

export const reverseInvoicePaymentState = (
  invoice: PaymentLifecycleInvoiceState,
  amount: number,
): PaymentLifecycleInvoiceState => {
  assertPositiveAmount(amount);

  if (normalizeMoney(amount) > normalizeMoney(invoice.paidAmount)) {
    throw new Error("Estorno maior que o valor pago da fatura.");
  }

  const paidAmount = normalizeMoney(invoice.paidAmount - amount);
  const remainingAmount = normalizeMoney(invoice.totalAmount - paidAmount);

  return {
    ...invoice,
    paidAmount,
    remainingAmount,
    status: remainingAmount <= 0
      ? "paid"
      : paidAmount > 0
        ? "partial_paid"
        : "open",
  };
};

export const applyPaymentLimitRestore = (
  snapshot: PaymentLifecycleLimitSnapshot,
  amount: number,
): PaymentLifecycleLimitSnapshot => {
  assertPositiveAmount(amount);

  const limitUsed = normalizeMoney(Math.max(snapshot.limitUsed - amount, 0));

  return {
    limitTotal: snapshot.limitTotal,
    limitUsed,
    limitAvailable: normalizeMoney(Math.min(snapshot.limitTotal - limitUsed, snapshot.limitTotal)),
  };
};

export const applyPaymentReversalLimitConsume = (
  snapshot: PaymentLifecycleLimitSnapshot,
  amount: number,
): PaymentLifecycleLimitSnapshot => {
  assertPositiveAmount(amount);

  const limitUsed = normalizeMoney(Math.min(snapshot.limitUsed + amount, snapshot.limitTotal));

  return {
    limitTotal: snapshot.limitTotal,
    limitUsed,
    limitAvailable: normalizeMoney(Math.max(snapshot.limitTotal - limitUsed, 0)),
  };
};