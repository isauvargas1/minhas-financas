import {z} from "zod";

import {CASH_ENTRY_MAX_CENTS, CASH_ENTRY_MIN_DAY} from "../cash/contracts";
import {isIsoInstant} from "../shared/commitTime";
import {isDayKey, saoPauloDayKey} from "../shared/dateKeys";
import {
  cashAccountIdSchema,
  cashTransferIdSchema,
  correlationIdSchema,
  hasControlCharacter,
  idempotencyKeySchema,
  workspaceIdSchema,
} from "../shared/ids";
import {isMoneyCents} from "../shared/money";
import {CASH_ACCOUNT_TYPES} from "./model";

/**
 * Contratos das callables de contas/carteiras e transferências (D-30, P3-J).
 *
 * Todos `.strict()`: campo desconhecido é recusado. Nada que é autoritativo
 * vem do cliente — saldo, estado, autoria, timestamps, IDs de movimento e a
 * origem de um movimento. O saldo só muda por movimento explícito; não há
 * contrato que o edite. Valores são centavos inteiros BRL; datas civis são
 * `YYYY-MM-DD` em `America/Sao_Paulo`.
 */
export const CASH_ACCOUNT_TEXT_LIMITS = {
  name: 80,
  description: 200,
  reason: 300,
} as const;

const textSchema = (label: string, maxLength: number) => z.string()
  .transform((value) => value.trim())
  .pipe(z.string()
    .min(1, `${label}: valor obrigatório.`)
    .max(maxLength, `${label}: até ${maxLength} caracteres.`)
    .refine((value) => !hasControlCharacter(value), `${label}: inválido.`));

const accountTypeSchema = z.enum(CASH_ACCOUNT_TYPES, {
  message: "Tipo da conta: inválido.",
});

/** Versão lida pelo cliente: `updatedAt`, ISO-8601 com nanossegundos. */
const versionSchema = z.string()
  .max(40, "Versão da conta: formato inválido.")
  .refine(isIsoInstant, "Versão da conta: formato inválido.");

const baseFields = {
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
  correlationId: correlationIdSchema.optional(),
};

/**
 * Saldo inicial opcional, em centavos com sinal: positivo, zero ou negativo
 * (conta já devedora), até o teto do lançamento manual. Zero não gera
 * movimento.
 */
export const openingBalanceSchema = z.number()
  .refine(isMoneyCents, "Saldo inicial: centavos inteiros.")
  .refine((value) => Math.abs(value) <= CASH_ENTRY_MAX_CENTS,
    "Saldo inicial: acima do máximo permitido.");

/** Data de fato já ocorrido: até hoje em São Paulo, a partir de 2000. */
const pastDaySchema = (label: string) => z.string()
  .refine(isDayKey, `${label}: use AAAA-MM-DD com uma data existente.`)
  .refine((value) => value >= CASH_ENTRY_MIN_DAY, `${label}: anterior a 2000.`)
  .refine((value) => value <= saoPauloDayKey(),
    `${label}: não pode ser futura.`);

export const createCashAccountPayloadSchema = z.object({
  ...baseFields,
  name: textSchema("Nome da conta", CASH_ACCOUNT_TEXT_LIMITS.name),
  accountType: accountTypeSchema,
  openingBalanceCents: openingBalanceSchema.optional(),
  /** Data do saldo inicial; omitida, vale hoje (São Paulo). */
  openingBalanceDate: pastDaySchema("Data do saldo inicial").optional(),
}).strict().superRefine((payload, context) => {
  if (
    payload.openingBalanceDate !== undefined &&
    (payload.openingBalanceCents ?? 0) === 0
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["openingBalanceDate"],
      message: "Data do saldo inicial: só com saldo inicial diferente de " +
        "zero.",
    });
  }
});

export type CreateCashAccountPayload =
  z.infer<typeof createCashAccountPayloadSchema>;

const accountMutationFields = {
  ...baseFields,
  accountId: cashAccountIdSchema,
  expectedUpdatedAt: versionSchema,
};

/** Só nome e tipo; o saldo nunca é editável. */
export const updateCashAccountPayloadSchema = z.object({
  ...accountMutationFields,
  changes: z.object({
    name: textSchema("Nome da conta", CASH_ACCOUNT_TEXT_LIMITS.name)
      .optional(),
    accountType: accountTypeSchema.optional(),
  }).strict().refine(
    (changes) => Object.keys(changes).length > 0,
    "Informe ao menos um campo para alterar.",
  ),
}).strict();

export type UpdateCashAccountPayload =
  z.infer<typeof updateCashAccountPayloadSchema>;

export const archiveCashAccountPayloadSchema = z.object({
  ...accountMutationFields,
}).strict();

export type ArchiveCashAccountPayload =
  z.infer<typeof archiveCashAccountPayloadSchema>;

export const reactivateCashAccountPayloadSchema = z.object({
  ...accountMutationFields,
}).strict();

export type ReactivateCashAccountPayload =
  z.infer<typeof reactivateCashAccountPayloadSchema>;

const positiveCentsSchema = (label: string) => z.number()
  .refine(isMoneyCents, `${label}: centavos inteiros.`)
  .refine((value) => value > 0, `${label}: deve ser maior que zero.`)
  .refine((value) => value <= CASH_ENTRY_MAX_CENTS,
    `${label}: acima do máximo permitido.`);

/**
 * Transferência entre duas contas do mesmo workspace: valor positivo, data
 * até hoje (transferência é fato ocorrido; não há agendamento) e descrição
 * opcional. Nunca é receita nem despesa.
 */
export const createCashTransferPayloadSchema = z.object({
  ...baseFields,
  sourceAccountId: cashAccountIdSchema,
  destinationAccountId: cashAccountIdSchema,
  amountCents: positiveCentsSchema("Valor"),
  date: pastDaySchema("Data da transferência"),
  description: textSchema("Descrição", CASH_ACCOUNT_TEXT_LIMITS.description)
    .optional(),
}).strict().superRefine((payload, context) => {
  if (payload.sourceAccountId === payload.destinationAccountId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["destinationAccountId"],
      message: "Destino: escolha uma conta diferente da origem.",
    });
  }
});

export type CreateCashTransferPayload =
  z.infer<typeof createCashTransferPayloadSchema>;

export const reverseCashTransferPayloadSchema = z.object({
  ...baseFields,
  transferId: cashTransferIdSchema,
  expectedUpdatedAt: z.string()
    .max(40, "Versão da transferência: formato inválido.")
    .refine(isIsoInstant, "Versão da transferência: formato inválido."),
  reason: textSchema("Motivo", CASH_ACCOUNT_TEXT_LIMITS.reason),
}).strict();

export type ReverseCashTransferPayload =
  z.infer<typeof reverseCashTransferPayloadSchema>;

// --------------------------------------------------------------- resultados

export interface CashAccountMutationResult extends Record<string, unknown> {
  accountId: string;
  status?: "active" | "archived";
  balanceCents?: number;
  changed?: boolean;
  replayed: boolean;
}

export interface CashTransferResult extends Record<string, unknown> {
  transferId: string;
  status: "completed" | "reversed";
  replayed: boolean;
}
