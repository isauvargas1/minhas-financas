import * as functionsLogger from "firebase-functions/logger";

/**
 * Contrato de log estruturado do kernel (P1, §2.5).
 *
 * Um evento por início, fim e falha de cada callable do kernel, com campos
 * fixos para correlação: `operation`, `requestId`, `workspaceId`, `actorId`,
 * `actorRole`, `durationMs`, `errorCode` e o trace do Cloud Logging.
 *
 * Nunca vão para log: token (de sessão ou de convite), payload financeiro,
 * comprovante, transcrição, CPF/CNPJ, e-mail completo e segredo. A defesa é
 * dupla: quem chama só passa campos escalares, e `sanitizeLogFields` descarta
 * qualquer chave com nome sensível — um campo novo com nome errado some do
 * log em vez de vazar.
 *
 * A observabilidade antiga de cada domínio continua onde está; a migração é
 * trabalho de P7.
 */
export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

const SENSITIVE_KEY = new RegExp([
  "token", "secret", "password", "senha", "e-?mail", "cpf", "cnpj",
  "payload", "receipt", "comprovante", "transcri", "authorization",
  "cookie", "key$",
].join("|"), "i");

const MAX_STRING_LENGTH = 256;

export const sanitizeLogFields = (fields: LogFields = {}): LogFields => {
  const sanitized: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === undefined) continue;
    if (typeof value === "string") {
      sanitized[key] = value.slice(0, MAX_STRING_LENGTH);
      continue;
    }
    if (
      value === null ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

/**
 * E-mail mascarado para diagnóstico: primeira letra do usuário e o domínio.
 * O e-mail completo nunca é registrado.
 */
export const maskEmail = (email: string | undefined): string | undefined => {
  if (!email) return undefined;
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  return `${email[0]}***@${email.slice(at + 1)}`;
};

/**
 * Stack sanitizado: nome da classe e os frames, sem a linha de mensagem.
 *
 * A mensagem de um erro inesperado pode conter qualquer coisa que o código de
 * terceiros tenha interpolado — inclusive o documento lido. Os frames bastam
 * para localizar o defeito.
 */
export const sanitizedStack = (error: unknown): string | undefined => {
  if (!(error instanceof Error) || typeof error.stack !== "string") {
    return undefined;
  }
  const frames = error.stack
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .slice(0, 12)
    .map((line) => line.trim());
  return [error.name, ...frames].join("\n");
};

/** Converte `X-Cloud-Trace-Context` no campo que o Cloud Logging agrupa. */
export const traceFieldFromHeader = (
  header: string | undefined,
): LogFields => {
  if (!header) return {};
  const traceId = header.split("/")[0];
  const project = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  if (!traceId || !/^[0-9a-f]{16,32}$/i.test(traceId) || !project) return {};
  return {
    "logging.googleapis.com/trace": `projects/${project}/traces/${traceId}`,
  };
};

export interface OperationLogger {
  readonly context: LogFields;
  with(fields: LogFields): OperationLogger;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, error: unknown, fields?: LogFields): void;
}

const SEVERITY_BY_LEVEL = {
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
} as const;

export const createOperationLogger = (
  context: LogFields,
): OperationLogger => {
  const base = sanitizeLogFields(context);
  const emit = (
    level: "info" | "warn" | "error",
    event: string,
    fields: LogFields = {},
    extra: Record<string, unknown> = {},
  ) => {
    functionsLogger.write({
      severity: SEVERITY_BY_LEVEL[level],
      message: event,
      event,
      ...base,
      ...sanitizeLogFields(fields),
      ...extra,
    });
  };
  return {
    context: base,
    with: (fields) => createOperationLogger({...base, ...fields}),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, error, fields) =>
      emit("error", event, fields, {stack: sanitizedStack(error)}),
  };
};
