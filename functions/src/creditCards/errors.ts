import {HttpsError} from "firebase-functions/v2/https";
import {z} from "zod";

export type CreditCardErrorCode =
  | "invalid_payload"
  | "unauthenticated"
  | "permission_denied"
  | "workspace_not_found"
  | "workspace_membership_required"
  | "workspace_role_denied"
  | "idempotency_conflict"
  | "idempotency_replay"
  | "domain_precondition_failed"
  | "not_found"
  | "internal";

export class CreditCardApplicationError extends Error {
  readonly code: CreditCardErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: CreditCardErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "CreditCardApplicationError";
    this.code = code;
    this.details = details;
  }
}

export const toHttpsError = (error: unknown): HttpsError => {
  if (error instanceof HttpsError) {
    return error;
  }

  if (error instanceof z.ZodError) {
    return new HttpsError(
      "invalid-argument",
      "Payload inválido.",
      {issues: error.issues}
    );
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

    if (
      error.code === "idempotency_conflict" ||
      error.code === "domain_precondition_failed"
    ) {
      return new HttpsError(
        "failed-precondition",
        error.message,
        error.details
      );
    }

    if (error.code === "invalid_payload") {
      return new HttpsError("invalid-argument", error.message, error.details);
    }

    return new HttpsError("internal", error.message, error.details);
  }

  return new HttpsError(
    "internal",
    "Erro interno ao processar operação de cartão."
  );
};