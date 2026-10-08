import {z} from "zod";

import {
  CASH_ENTRY_MAX_CENTS,
  CASH_ENTRY_MIN_DAY,
  maxDueDayKey,
} from "../cash/contracts";
import {cnpjCpfSchema} from "../loans/contracts";
import {isIsoInstant} from "../shared/commitTime";
import {isDayKey, saoPauloDayKey} from "../shared/dateKeys";
import {
  cashAccountIdSchema,
  clientIdSchema,
  correlationIdSchema,
  hasControlCharacter,
  idempotencyKeySchema,
  receivableIdSchema,
  receivableMovementIdSchema,
  workspaceIdSchema,
} from "../shared/ids";
import {isMoneyCents} from "../shared/money";

/**
 * Contratos das callables de clientes e recebíveis (D-24, D-39, P3-I).
 *
 * Todos `.strict()`: campo desconhecido é recusado. Nada que é autoritativo
 * vem do cliente — workspace autoritativo (o `workspaceId` só escolhe o
 * espaço e é relido no servidor), autoria, papel, timestamps, status, saldo,
 * acumulados, IDs de movimento e de lançamento. Valores são centavos inteiros
 * BRL; datas civis são `YYYY-MM-DD` em `America/Sao_Paulo`.
 *
 * Dados pessoais do cliente (documento, e-mail, telefone, endereço e
 * observações) só entram por `createClient`/`updateClient` e vão para o
 * documento privado (`client_private`), nunca para o recebível, o espelho de
 * caixa, os eventos ou os logs.
 */
export const CLIENT_TEXT_LIMITS = {
  name: 120,
  email: 254,
  phone: 30,
  address: 300,
  notes: 1000,
} as const;

export const RECEIVABLE_TEXT_LIMITS = {
  description: 200,
  category: 60,
  reason: 300,
} as const;

const textSchema = (label: string, maxLength: number) => z.string()
  .transform((value) => value.trim())
  .pipe(z.string()
    .min(1, `${label}: valor obrigatório.`)
    .max(maxLength, `${label}: até ${maxLength} caracteres.`)
    .refine((value) => !hasControlCharacter(value), `${label}: inválido.`));

/** Texto livre com quebras de linha permitidas (observações). */
const multilineSchema = (label: string, maxLength: number) => z.string()
  .transform((value) => value.trim())
  .pipe(z.string()
    .min(1, `${label}: valor obrigatório.`)
    .max(maxLength, `${label}: até ${maxLength} caracteres.`)
    .refine(
      // eslint-disable-next-line no-control-regex
      (value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value),
      `${label}: inválido.`,
    ));

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailSchema = z.string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.string()
    .min(3, "E-mail: valor obrigatório.")
    .max(CLIENT_TEXT_LIMITS.email,
      `E-mail: até ${CLIENT_TEXT_LIMITS.email} caracteres.`)
    .refine((value) => EMAIL_PATTERN.test(value), "E-mail: inválido."));

const phoneSchema = z.string()
  .transform((value) => value.trim())
  .pipe(z.string()
    .min(8, "Telefone: informe ao menos 8 caracteres.")
    .max(CLIENT_TEXT_LIMITS.phone,
      `Telefone: até ${CLIENT_TEXT_LIMITS.phone} caracteres.`)
    .refine((value) => /^[0-9+()\-.\s]+$/.test(value),
      "Telefone: use só números, espaços e + ( ) - .")
    .refine((value) => (value.match(/\d/g) ?? []).length >= 8,
      "Telefone: informe ao menos 8 dígitos."));

const dayKeySchema = (label: string) => z.string()
  .refine(isDayKey, `${label}: use AAAA-MM-DD com uma data existente.`)
  .refine((value) => value >= CASH_ENTRY_MIN_DAY, `${label}: anterior a 2000.`);

/** Data de fato já ocorrido: até hoje em São Paulo. */
const pastDaySchema = (label: string) => dayKeySchema(label)
  .refine((value) => value <= saoPauloDayKey(),
    `${label}: não pode ser futura.`);

/** Vencimento: passado, hoje ou futuro, até 10 anos à frente. */
const dueDaySchema = (label: string) => dayKeySchema(label)
  .refine((value) => value <= maxDueDayKey(),
    `${label}: até 10 anos à frente.`);

const positiveCentsSchema = (label: string) => z.number()
  .refine(isMoneyCents, `${label}: centavos inteiros.`)
  .refine((value) => value > 0, `${label}: deve ser maior que zero.`)
  .refine((value) => value <= CASH_ENTRY_MAX_CENTS,
    `${label}: acima do máximo permitido.`);

const nonNegativeCentsSchema = (label: string) => z.number()
  .refine(isMoneyCents, `${label}: centavos inteiros.`)
  .refine((value) => value >= 0, `${label}: não pode ser negativo.`)
  .refine((value) => value <= CASH_ENTRY_MAX_CENTS,
    `${label}: acima do máximo permitido.`);

/** Versão lida pelo cliente: `updatedAt`, ISO-8601 com nanossegundos. */
export const versionSchema = (label: string) => z.string()
  .max(40, `${label}: formato inválido.`)
  .refine(isIsoInstant, `${label}: formato inválido.`);

/** `null` remove um campo opcional; ausente mantém. */
const clearable = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullable().optional();

const baseFields = {
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
  correlationId: correlationIdSchema.optional(),
};

// ----------------------------------------------------------------- clientes

/** Campos privados (D-24): só owner/admin, só em `client_private`. */
export const CLIENT_PRIVATE_FIELDS = [
  "document", "email", "phone", "address", "notes",
] as const;
export type ClientPrivateField = (typeof CLIENT_PRIVATE_FIELDS)[number];

const privateFields = {
  document: cnpjCpfSchema,
  email: emailSchema,
  phone: phoneSchema,
  address: textSchema("Endereço", CLIENT_TEXT_LIMITS.address),
  notes: multilineSchema("Observações", CLIENT_TEXT_LIMITS.notes),
};

export const createClientPayloadSchema = z.object({
  ...baseFields,
  name: textSchema("Nome", CLIENT_TEXT_LIMITS.name),
  document: privateFields.document.optional(),
  email: privateFields.email.optional(),
  phone: privateFields.phone.optional(),
  address: privateFields.address.optional(),
  notes: privateFields.notes.optional(),
}).strict();

export type CreateClientPayload = z.infer<typeof createClientPayloadSchema>;

const clientMutationFields = {
  ...baseFields,
  clientId: clientIdSchema,
  expectedUpdatedAt: versionSchema("Versão do cliente"),
};

export const updateClientPayloadSchema = z.object({
  ...clientMutationFields,
  changes: z.object({
    name: textSchema("Nome", CLIENT_TEXT_LIMITS.name).optional(),
    document: clearable(privateFields.document),
    email: clearable(privateFields.email),
    phone: clearable(privateFields.phone),
    address: clearable(privateFields.address),
    notes: clearable(privateFields.notes),
  }).strict().refine(
    (changes) => Object.keys(changes).length > 0,
    "Alterações: informe ao menos um campo.",
  ),
}).strict();

export type UpdateClientPayload = z.infer<typeof updateClientPayloadSchema>;

export const archiveClientPayloadSchema = z.object({
  ...clientMutationFields,
}).strict();

export type ArchiveClientPayload = z.infer<typeof archiveClientPayloadSchema>;

// --------------------------------------------------------------- recebíveis

export const createReceivablePayloadSchema = z.object({
  ...baseFields,
  clientId: clientIdSchema,
  description: textSchema("Descrição", RECEIVABLE_TEXT_LIMITS.description),
  category: textSchema("Categoria", RECEIVABLE_TEXT_LIMITS.category)
    .optional(),
  amountCents: positiveCentsSchema("Valor"),
  dueDate: dueDaySchema("Vencimento"),
}).strict();

export type CreateReceivablePayload =
  z.infer<typeof createReceivablePayloadSchema>;

const receivableMutationFields = {
  ...baseFields,
  receivableId: receivableIdSchema,
  expectedUpdatedAt: versionSchema("Versão do recebível"),
};

export const updateReceivablePayloadSchema = z.object({
  ...receivableMutationFields,
  changes: z.object({
    description: textSchema("Descrição", RECEIVABLE_TEXT_LIMITS.description)
      .optional(),
    category: clearable(
      textSchema("Categoria", RECEIVABLE_TEXT_LIMITS.category)),
    dueDate: dueDaySchema("Vencimento").optional(),
    amountCents: positiveCentsSchema("Valor").optional(),
  }).strict().refine(
    (changes) => Object.keys(changes).length > 0,
    "Alterações: informe ao menos um campo.",
  ),
}).strict();

export type UpdateReceivablePayload =
  z.infer<typeof updateReceivablePayloadSchema>;

/**
 * Recebimento (D-39). Principal, juros, multa e desconto explícitos: juros e
 * multa não reduzem o saldo; o desconto reduz o saldo e não é dinheiro. O
 * caixa recebe `principal + juros + multa`.
 */
export const receiveReceivablePayloadSchema = z.object({
  ...receivableMutationFields,
  principalCents: nonNegativeCentsSchema("Principal"),
  interestCents: nonNegativeCentsSchema("Juros"),
  penaltyCents: nonNegativeCentsSchema("Multa"),
  discountCents: nonNegativeCentsSchema("Desconto"),
  paymentDate: pastDaySchema("Data do recebimento"),
  /**
   * Conta/carteira que recebe o dinheiro (D-30, P3-J): principal + juros +
   * multa. Obrigatória quando há dinheiro; recebimento só com desconto não
   * move conta e não a informa.
   */
  cashAccountId: cashAccountIdSchema.optional(),
}).strict().superRefine((payload, context) => {
  const effect = payload.principalCents + payload.interestCents +
    payload.penaltyCents + payload.discountCents;
  const cash = payload.principalCents + payload.interestCents +
    payload.penaltyCents;
  if (effect <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["principalCents"],
      message: "Valor: informe principal, juros, multa ou desconto maior " +
        "que zero.",
    });
  } else if (cash > CASH_ENTRY_MAX_CENTS) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["principalCents"],
      message: "Valor: acima do máximo permitido.",
    });
  }
  if (cash > 0 && payload.cashAccountId === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cashAccountId"],
      message: "Conta: informe a conta que recebe o dinheiro.",
    });
  }
  if (cash === 0 && payload.cashAccountId !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cashAccountId"],
      message: "Conta: recebimento só com desconto não movimenta conta.",
    });
  }
});

export type ReceiveReceivablePayload =
  z.infer<typeof receiveReceivablePayloadSchema>;

export const reverseReceivableReceiptPayloadSchema = z.object({
  ...receivableMutationFields,
  movementId: receivableMovementIdSchema,
  reason: textSchema("Motivo", RECEIVABLE_TEXT_LIMITS.reason),
}).strict();

export type ReverseReceivableReceiptPayload =
  z.infer<typeof reverseReceivableReceiptPayloadSchema>;

export const cancelReceivablePayloadSchema = z.object({
  ...receivableMutationFields,
  reason: textSchema("Motivo", RECEIVABLE_TEXT_LIMITS.reason),
}).strict();

export type CancelReceivablePayload =
  z.infer<typeof cancelReceivablePayloadSchema>;

// ---------------------------------------------------------------- resultados

export interface ClientMutationResult {
  clientId: string;
  changed?: boolean;
  status?: string;
  replayed: boolean;
}

export interface ReceivableMutationResult {
  receivableId: string;
  movementId?: string;
  cashTransactionId?: string | null;
  status?: string;
  balanceCents?: number;
  changed?: boolean;
  replayed: boolean;
}
