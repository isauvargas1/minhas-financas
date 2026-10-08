import {ApplicationError} from "../shared/errors";

export const assertSafeInteger = (value: number, field: string): number => {
  if (!Number.isSafeInteger(value)) {
    throw new ApplicationError(
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
