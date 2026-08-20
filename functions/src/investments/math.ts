import {CreditCardApplicationError} from "../creditCards/errors";

const runtimeBigInt = (
  globalThis as unknown as {
    BigInt: (value: number) => bigint;
  }
).BigInt;
const UNIT_SCALE = runtimeBigInt(1_000_000);
const CURRENCY_MICROS_TO_CENTS = runtimeBigInt(100);
const POSITION_VALUE_DIVISOR =
  (UNIT_SCALE * UNIT_SCALE) / CURRENCY_MICROS_TO_CENTS;

export const assertSafeInteger = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value)) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `O campo ${field} excede a representação monetária permitida.`,
    );
  }
  return value;
};

export const addExact = (left: number, right: number, field: string): number =>
  assertSafeInteger(left + right, field);

export const negateExact = (value: number, field: string): number =>
  assertSafeInteger(-value, field);

export const positionValueCents = (
  quantityMicros: number,
  unitPriceMicros: number,
): number => {
  assertSafeInteger(quantityMicros, "quantityMicros");
  assertSafeInteger(unitPriceMicros, "unitPriceMicros");
  const product =
    runtimeBigInt(quantityMicros) * runtimeBigInt(unitPriceMicros);
  const rounded =
    (product + POSITION_VALUE_DIVISOR / runtimeBigInt(2)) /
    POSITION_VALUE_DIVISOR;
  const result = Number(rounded);
  return assertSafeInteger(result, "currentValueCents");
};

export const currentValueForPosition = (
  quantityMicros: number,
  principalCents: number,
  unitPriceMicros?: number,
): number =>
  unitPriceMicros === undefined ?
    principalCents :
    positionValueCents(quantityMicros, unitPriceMicros);
