import {HttpsError} from "firebase-functions/v2/https";
import {z} from "zod";

import {CreditCardApplicationError} from "../creditCards/errors";

export const toInvestmentHttpsError = (error: unknown): HttpsError => {
  if (error instanceof HttpsError) return error;
  if (error instanceof z.ZodError) {
    return new HttpsError("invalid-argument", "Payload inválido.", {
      issues: error.issues,
    });
  }
  if (error instanceof CreditCardApplicationError) {
    if (error.code === "unauthenticated") {
      return new HttpsError("unauthenticated", error.message, error.details);
    }
    if (
      error.code === "permission_denied" ||
      error.code === "workspace_membership_required" ||
      error.code === "workspace_role_denied"
    ) {
      return new HttpsError("permission-denied", error.message, error.details);
    }
    if (error.code === "not_found" || error.code === "workspace_not_found") {
      return new HttpsError("not-found", error.message, error.details);
    }
    if (error.code === "invalid_payload") {
      return new HttpsError("invalid-argument", error.message, error.details);
    }
    if (
      error.code === "idempotency_conflict" ||
      error.code === "domain_precondition_failed"
    ) {
      return new HttpsError(
        "failed-precondition",
        error.message,
        error.details,
      );
    }
  }
  return new HttpsError(
    "internal",
    "Erro interno ao processar operação de investimento.",
  );
};
