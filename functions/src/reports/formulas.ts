import {ApplicationError} from "../shared/errors";

/**
 * Fórmulas puras compartilhadas entre o relatório financeiro (P5-C1) e os
 * indicadores das metas PJ (P5-B, D-31): uma definição para cada indicador.
 *
 * Tudo em centavos inteiros; razões em pontos-base (1% = 100) calculadas em
 * BigInt e arredondadas meio-para-longe-do-zero. Denominador zero ou
 * negativo devolve `null` ("indisponível"), nunca `0`, `Infinity` ou `NaN`.
 */

/** Soma inteira com conferência de faixa segura. */
export const addExact = (left: number, right: number): number => {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) {
    throw new ApplicationError(
      "internal",
      "Valor fora dos limites de cálculo do indicador.",
    );
  }
  return sum;
};

/** Subtração inteira com conferência de faixa segura. */
export const subtractExact = (left: number, right: number): number =>
  addExact(left, -right);

/**
 * Razão em pontos-base: `numerator × 10.000 ÷ denominator`, arredondada
 * meio-para-longe-do-zero. Numerador negativo é permitido e não há teto
 * (uma taxa pode passar de 100%). Denominador ≤ 0 → `null`.
 */
export const ratioBasisPoints = (
  numerator: number,
  denominator: number,
): number | null => {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    return null;
  }
  if (denominator <= 0) return null;
  const zero = BigInt(0);
  const two = BigInt(2);
  const scaled = BigInt(numerator) * BigInt(10_000);
  const divisor = BigInt(denominator);
  const negative = scaled < zero;
  const absolute = negative ? -scaled : scaled;
  const rounded = (absolute * two + divisor) / (two * divisor);
  return Number(negative ? -rounded : rounded);
};

/**
 * Margem operacional de caixa (D-37.4): resultado ÷ recebimentos
 * operacionais realizados, em pontos-base. Recebimentos ≤ 0 → indisponível.
 */
export const marginBasisPoints = (
  resultCents: number,
  receiptsCents: number,
): number | null => ratioBasisPoints(resultCents, receiptsCents);

/**
 * Taxa de aportes líquidos (D-37.5): (aportes − retiradas de principal) ÷
 * recebimentos operacionais realizados, na mesma janela. Pode ser negativa
 * e passar de 100%; recebimentos ≤ 0 → indisponível.
 */
export const netContributionRateBasisPoints = (
  contributionsCents: number,
  redemptionsPrincipalCents: number,
  receiptsCents: number,
): number | null => ratioBasisPoints(
  subtractExact(contributionsCents, redemptionsPrincipalCents),
  receiptsCents,
);

export interface PeriodTotals {
  incomeCents: number;
  expenseCents: number;
}

/** Recebimentos e pagamentos operacionais somados dos meses informados. */
export const sumPeriods = (
  months: readonly string[],
  periods: ReadonlyMap<string, PeriodTotals>,
): {receiptsCents: number; expensesCents: number} => {
  let receiptsCents = 0;
  let expensesCents = 0;
  for (const month of months) {
    const period = periods.get(month);
    if (!period) continue;
    receiptsCents = addExact(receiptsCents, period.incomeCents);
    expensesCents = addExact(expensesCents, period.expenseCents);
  }
  return {receiptsCents, expensesCents};
};
