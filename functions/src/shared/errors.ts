import {HttpsError} from "firebase-functions/v2/https";
import type {FunctionsErrorCode} from "firebase-functions/v2/https";
import {z} from "zod";

/**
 * Códigos fechados de erro de aplicação (P1, kernel §2.1).
 *
 * Todos os domínios lançam `ApplicationError` com um destes códigos; o
 * mapeamento para `HttpsError` é único (`toHttpsError`). Antes existiam dois
 * mapeadores quase idênticos — cartões e investimentos — e o erro de cartão
 * era a classe usada por todos os outros domínios.
 */
export type ApplicationErrorCode =
  | "invalid_payload"
  | "unauthenticated"
  | "permission_denied"
  | "email_not_verified"
  | "recent_login_required"
  | "account_suspended"
  | "account_not_initialized"
  | "workspace_not_found"
  | "workspace_archived"
  | "workspace_membership_required"
  | "workspace_role_denied"
  | "idempotency_conflict"
  | "idempotency_replay"
  | "domain_precondition_failed"
  | "quota_exceeded"
  | "not_found"
  | "already_exists"
  | "internal";

const HTTPS_CODE_BY_APPLICATION_CODE: Record<
  ApplicationErrorCode,
  FunctionsErrorCode
> = {
  invalid_payload: "invalid-argument",
  unauthenticated: "unauthenticated",
  permission_denied: "permission-denied",
  email_not_verified: "permission-denied",
  recent_login_required: "failed-precondition",
  account_suspended: "permission-denied",
  account_not_initialized: "failed-precondition",
  workspace_not_found: "not-found",
  workspace_archived: "failed-precondition",
  workspace_membership_required: "permission-denied",
  workspace_role_denied: "permission-denied",
  idempotency_conflict: "failed-precondition",
  idempotency_replay: "internal",
  domain_precondition_failed: "failed-precondition",
  // Limite do plano (P2B). Distinto de `domain_precondition_failed`: o
  // cliente oferece upgrade, e os detalhes públicos são só recurso, plano,
  // limite, uso e período (`billing/quota.ts`).
  quota_exceeded: "resource-exhausted",
  not_found: "not-found",
  already_exists: "already-exists",
  internal: "internal",
};

/**
 * Motivo legível por máquina que o cliente usa para decidir a próxima ação
 * (por exemplo, reautenticar com o Google). Nunca carrega dado sensível.
 */
const PUBLIC_REASON_BY_CODE: Partial<Record<ApplicationErrorCode, string>> = {
  email_not_verified: "email_not_verified",
  recent_login_required: "recent_login_required",
  account_suspended: "account_suspended",
  account_not_initialized: "account_not_initialized",
  workspace_archived: "workspace_archived",
};

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ApplicationErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApplicationError";
    this.code = code;
    this.details = details;
  }
}

export const isApplicationError = (
  error: unknown,
): error is ApplicationError => error instanceof ApplicationError;

export interface SanitizedIssue {
  path: Array<string | number>;
  code: string;
  message: string;
}

/**
 * Reduz os issues do Zod ao contrato público: caminho, código e mensagem.
 *
 * O issue bruto pode carregar o valor recebido (`input`) e metadados do
 * schema. Devolvê-lo ecoaria para o cliente — e para qualquer log do cliente —
 * o conteúdo do payload, inclusive e-mail ou token de convite.
 */
export const sanitizeZodIssues = (error: z.ZodError): SanitizedIssue[] =>
  error.issues.slice(0, 20).map((issue) => ({
    path: issue.path
      .filter((part): part is string | number =>
        typeof part === "string" || typeof part === "number")
      .slice(0, 8),
    code: String(issue.code),
    message: issue.message.slice(0, 200),
  }));

/** `ALREADY_EXISTS` (gRPC 6) devolvido por `transaction.create`. */
export const isAlreadyExistsError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as {code?: unknown}).code;
  return code === 6 || code === "already-exists";
};

export interface ToHttpsErrorOptions {
  /** Mensagem pt-BR do domínio para erro inesperado. */
  internalMessage?: string;
  /** Identificador do servidor, devolvido só em erro interno. */
  requestId?: string;
}

/** Mensagem de payload inválido: texto de produto, sem jargão técnico. */
export const INVALID_PAYLOAD_MESSAGE =
  "Dados inválidos. Verifique as informações e tente novamente.";

const DEFAULT_INTERNAL_MESSAGE =
  "Não foi possível concluir a operação. Tente novamente em instantes.";

/**
 * Mapeador único de erro para a resposta da callable.
 *
 * - Zod → `invalid-argument` com issues sanitizados.
 * - `ApplicationError` → código HTTPS fixo por código de aplicação, com a
 *   mensagem pt-BR escrita no ponto do lançamento.
 * - `ALREADY_EXISTS` da reserva de idempotência → `failed-precondition`.
 * - Qualquer outra coisa → `internal` com mensagem genérica e `requestId`,
 *   sem stack, payload, e-mail ou token.
 */
export const toHttpsError = (
  error: unknown,
  options: ToHttpsErrorOptions = {},
): HttpsError => {
  if (error instanceof HttpsError) return error;
  if (error instanceof z.ZodError) {
    return new HttpsError("invalid-argument", INVALID_PAYLOAD_MESSAGE, {
      issues: sanitizeZodIssues(error),
    });
  }
  if (error instanceof ApplicationError) {
    const httpsCode = HTTPS_CODE_BY_APPLICATION_CODE[error.code];
    const reason = PUBLIC_REASON_BY_CODE[error.code];
    const details = {
      ...(error.details ?? {}),
      ...(reason ? {reason} : {}),
      ...(httpsCode === "internal" && options.requestId ?
        {requestId: options.requestId} :
        {}),
    };
    return new HttpsError(
      httpsCode,
      error.message,
      Object.keys(details).length > 0 ? details : undefined,
    );
  }
  if (isAlreadyExistsError(error)) {
    // Duas execuções concorrentes da mesma chave: a perdedora falha ao criar a
    // reserva de idempotência. É conflito de idempotência, não erro interno.
    return new HttpsError(
      "failed-precondition",
      "Esta solicitação já está em processamento.",
    );
  }
  return new HttpsError(
    "internal",
    options.internalMessage ?? DEFAULT_INTERNAL_MESSAGE,
    options.requestId ? {requestId: options.requestId} : undefined,
  );
};

/** Código estável para log e métrica, sem mensagem nem detalhe. */
export const errorCodeOf = (error: unknown): string => {
  if (error instanceof ApplicationError) return error.code;
  if (error instanceof z.ZodError) return "invalid_payload";
  if (error instanceof HttpsError) return error.code;
  if (isAlreadyExistsError(error)) return "idempotency_conflict";
  return "internal";
};
