export interface AmountItem {
  amount: number;
}

export interface InvoicePaymentConsistencyItem {
  amount: number;
  status: "posted" | "reversed" | string;
}

export interface LimitLedgerConsistencyItem {
  amount: number;
  direction: "consume" | "restore" | string;
}

export const normalizeMoney = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export const sumAmounts = (items: AmountItem[]): number =>
  normalizeMoney(items.reduce((sum, item) => sum + Number(item.amount || 0), 0));

export const calculatePostedPaymentsAmount = (
  payments: InvoicePaymentConsistencyItem[],
): number =>
  normalizeMoney(
    payments
      .filter((payment) => payment.status === "posted")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
  );

export const calculateNetLimitConsumption = (
  ledgerEntries: LimitLedgerConsistencyItem[],
): number =>
  normalizeMoney(
    ledgerEntries.reduce((sum, entry) => {
      if (entry.direction === "consume") {
        return sum + Number(entry.amount || 0);
      }

      if (entry.direction === "restore") {
        return sum - Number(entry.amount || 0);
      }

      return sum;
    }, 0),
  );

export const calculateAvailableLimit = (
  limitTotal: number,
  ledgerEntries: LimitLedgerConsistencyItem[],
): number =>
  normalizeMoney(limitTotal - calculateNetLimitConsumption(ledgerEntries));

export const assertMoneyEquals = (
  actual: number,
  expected: number,
  message: string,
): void => {
  const normalizedActual = normalizeMoney(actual);
  const normalizedExpected = normalizeMoney(expected);

  if (normalizedActual !== normalizedExpected) {
    throw new Error(
      `${message}. Esperado ${normalizedExpected}, recebido ${normalizedActual}.`,
    );
  }
};
