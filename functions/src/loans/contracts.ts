import {z} from "zod";

import {
  CASH_ENTRY_MAX_CENTS,
  CASH_ENTRY_MIN_DAY,
  maxDueDayKey,
} from "../cash/contracts";
import {isIsoInstant} from "../shared/commitTime";
import {isDayKey, saoPauloDayKey} from "../shared/dateKeys";
import {
  cashAccountIdSchema,
  correlationIdSchema,
  hasControlCharacter,
  idempotencyKeySchema,
  loanIdSchema,
  loanMovementIdSchema,
  workspaceIdSchema,
} from "../shared/ids";
import {isMoneyCents} from "../shared/money";
import {LOAN_MAX_INSTALLMENTS, LOAN_MAX_RATE_PPM} from "./schedule";

/**
 * Contratos das callables de empréstimos (D-13, P3-G).
 *
 * Todos `.strict()`: campo desconhecido é recusado. Nada que é autoritativo
 * vem do cliente — saldo, acumulados, status, cronograma, autoria
 * (`createdBy`), papel, PF/PJ, IDs de movimento de caixa e a marca de
 * origem. Os valores são centavos inteiros (D-34) e a taxa é inteiro em
 * partes por milhão (1% = 10.000), nunca ponto flutuante. Datas civis são
 * `YYYY-MM-DD` em `America/Sao_Paulo` (D-17).
 *
 * Campos exclusivos de PJ (`counterpartyType`, `cnpjCpf`, `classification`,
 * `costCenter`) passam pelo schema, mas a operação os recusa quando o
 * workspace persistido é PF: o tipo do espaço vem do servidor, não do
 * cliente. A classificação PJ é metadado gerencial e não muda a fórmula.
 */

const textSchema = (label: string, maxLength: number) => z.string()
  .transform((value) => value.trim())
  .pipe(z.string()
    .min(1, `${label}: valor obrigatório.`)
    .max(maxLength, `${label}: até ${maxLength} caracteres.`)
    .refine((value) => !hasControlCharacter(value), `${label}: inválido.`));

const dayKeySchema = (label: string) => z.string()
  .refine(isDayKey, `${label}: use AAAA-MM-DD com uma data existente.`)
  .refine((value) => value >= CASH_ENTRY_MIN_DAY, `${label}: anterior a 2000.`);

/** Data de fato já ocorrido: até hoje em São Paulo. */
const pastDaySchema = (label: string) => dayKeySchema(label)
  .refine(
    (value) => value <= saoPauloDayKey(),
    `${label}: não pode ser futura.`,
  );

const positiveCentsSchema = (label: string) => z.number()
  .refine(isMoneyCents, `${label}: centavos inteiros.`)
  .refine((value) => value > 0, `${label}: deve ser maior que zero.`)
  .refine(
    (value) => value <= CASH_ENTRY_MAX_CENTS,
    `${label}: acima do máximo permitido.`,
  );

const nonNegativeCentsSchema = (label: string) => z.number()
  .refine(isMoneyCents, `${label}: centavos inteiros.`)
  .refine((value) => value >= 0, `${label}: não pode ser negativo.`)
  .refine(
    (value) => value <= CASH_ENTRY_MAX_CENTS,
    `${label}: acima do máximo permitido.`,
  );

/** Versão lida pelo cliente: `updatedAt` do contrato, ISO-8601 com nanos. */
export const loanVersionSchema = z.string()
  .max(40, "Versão do empréstimo: formato inválido.")
  .refine(isIsoInstant, "Versão do empréstimo: formato inválido.");

export const LOAN_TYPES = ["borrow", "lend"] as const;
export const PJ_COUNTERPARTY_TYPES = [
  "banco", "socio", "colaborador", "fornecedor", "cliente", "terceiro",
] as const;
export const PJ_LOAN_CLASSIFICATIONS = [
  "dividas_financeiras", "antecipacoes", "emprestimos_colaboradores",
  "capital_giro", "outro",
] as const;

const digitsOf = (value: string): number[] =>
  value.split("").map((digit) => Number(digit));

const cpfIsValid = (digits: number[]): boolean => {
  const check = (length: number): number => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += digits[index] * (length + 1 - index);
    }
    return ((sum * 10) % 11) % 10;
  };
  return check(9) === digits[9] && check(10) === digits[10];
};

const cnpjIsValid = (digits: number[]): boolean => {
  const check = (weights: number[]): number => {
    const sum = weights.reduce(
      (total, weight, index) => total + weight * digits[index], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === digits[12] &&
    check([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === digits[13];
};

/**
 * CPF (11 dígitos) ou CNPJ (14), com dígitos verificadores. Pontuação comum
 * (`.`, `-`, `/`, espaço) é removida; o valor gravado é só dígitos.
 */
export const cnpjCpfSchema = z.string()
  .max(32, "CNPJ/CPF: inválido.")
  .transform((value) => value.replace(/[.\-/\s]/g, ""))
  .pipe(z.string()
    .regex(/^(\d{11}|\d{14})$/, "CNPJ/CPF: informe 11 ou 14 dígitos.")
    .refine((value) => !/^(\d)\1+$/.test(value), "CNPJ/CPF: inválido.")
    .refine((value) => value.length === 11 ?
      cpfIsValid(digitsOf(value)) :
      cnpjIsValid(digitsOf(value)), "CNPJ/CPF: dígito verificador inválido."));

export const LOAN_TEXT_LIMITS = {
  personName: 120,
  personContact: 200,
  description: 300,
  costCenter: 200,
  reason: 300,
} as const;

const interestSchema = z.discriminatedUnion("type", [
  z.object({type: z.literal("none")}).strict(),
  z.object({
    type: z.literal("fixed"),
    totalInterestCents: positiveCentsSchema("Juros fixos"),
  }).strict(),
  z.object({
    type: z.literal("percentage"),
    ratePpm: z.number()
      .int("Taxa: inteiro em partes por milhão (1% = 10.000).")
      .min(1, "Taxa: deve ser maior que zero.")
      .max(LOAN_MAX_RATE_PPM, "Taxa: até 100% ao período."),
    ratePeriod: z.enum(["monthly", "annual"]),
    amortization: z.enum(["price", "sac", "simple"]),
  }).strict(),
]);

const pjFields = {
  counterpartyType: z.enum(PJ_COUNTERPARTY_TYPES).optional(),
  cnpjCpf: cnpjCpfSchema.optional(),
  classification: z.enum(PJ_LOAN_CLASSIFICATIONS).optional(),
  costCenter: textSchema("Centro de custo", LOAN_TEXT_LIMITS.costCenter)
    .optional(),
};

export const PJ_ONLY_LOAN_FIELDS = [
  "counterpartyType", "cnpjCpf", "classification", "costCenter",
] as const;

export const createLoanPayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
  correlationId: correlationIdSchema.optional(),
  type: z.enum(LOAN_TYPES),
  personName: textSchema("Contraparte", LOAN_TEXT_LIMITS.personName),
  personContact: textSchema("Contato", LOAN_TEXT_LIMITS.personContact)
    .optional(),
  description: textSchema("Descrição", LOAN_TEXT_LIMITS.description)
    .optional(),
  principalCents: positiveCentsSchema("Principal"),
  /**
   * Conta/carteira do principal (D-30, P3-J): tomado entra, concedido sai,
   * no commit da contratação.
   */
  cashAccountId: cashAccountIdSchema,
  /** Contratação já ocorrida (esta versão não agenda contratos). */
  startDate: pastDaySchema("Data da contratação"),
  firstDueDate: dayKeySchema("Primeiro vencimento")
    .refine(
      (value) => value <= maxDueDayKey(),
      "Primeiro vencimento: até 10 anos à frente.",
    ),
  installments: z.number()
    .int("Parcelas: número inteiro.")
    .min(1, "Parcelas: ao menos 1.")
    .max(LOAN_MAX_INSTALLMENTS, `Parcelas: até ${LOAN_MAX_INSTALLMENTS}.`),
  interest: interestSchema,
  ...pjFields,
}).strict().superRefine((payload, context) => {
  if (payload.principalCents < payload.installments) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["installments"],
      message: "Parcelas: o principal precisa de ao menos 1 centavo por " +
        "parcela.",
    });
  }
  if (payload.firstDueDate < payload.startDate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["firstDueDate"],
      message: "Primeiro vencimento: não pode ser anterior à contratação.",
    });
  }
});

export type CreateLoanPayload = z.infer<typeof createLoanPayloadSchema>;

const mutationFields = {
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
  correlationId: correlationIdSchema.optional(),
  loanId: loanIdSchema,
  expectedUpdatedAt: loanVersionSchema,
};

export const registerLoanPaymentPayloadSchema = z.object({
  ...mutationFields,
  /**
   * Conta/carteira da liquidação (D-30, P3-J): tomado paga principal + juros
   * (sai), concedido recebe principal + juros (entra).
   */
  cashAccountId: cashAccountIdSchema,
  date: pastDaySchema("Data do pagamento"),
  principalCents: nonNegativeCentsSchema("Principal"),
  interestCents: nonNegativeCentsSchema("Juros"),
}).strict().superRefine((payload, context) => {
  if (payload.principalCents + payload.interestCents <= 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["principalCents"],
      message: "Valor: informe principal ou juros maior que zero.",
    });
  } else if (
    payload.principalCents + payload.interestCents > CASH_ENTRY_MAX_CENTS
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["interestCents"],
      message: "Valor: acima do máximo permitido.",
    });
  }
});

export type RegisterLoanPaymentPayload =
  z.infer<typeof registerLoanPaymentPayloadSchema>;

export const reverseLoanMovementPayloadSchema = z.object({
  ...mutationFields,
  movementId: loanMovementIdSchema,
  reason: textSchema("Motivo", LOAN_TEXT_LIMITS.reason),
}).strict();

export type ReverseLoanMovementPayload =
  z.infer<typeof reverseLoanMovementPayloadSchema>;

export const cancelLoanPayloadSchema = z.object({
  ...mutationFields,
  reason: textSchema("Motivo", LOAN_TEXT_LIMITS.reason),
}).strict();

export type CancelLoanPayload = z.infer<typeof cancelLoanPayloadSchema>;

/** `null` remove um campo opcional; ausente mantém. */
const clearable = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullable().optional();

export const LOAN_METADATA_FIELDS = [
  "personName", "personContact", "description", ...PJ_ONLY_LOAN_FIELDS,
] as const;

export const updateLoanMetadataPayloadSchema = z.object({
  ...mutationFields,
  changes: z.object({
    personName: textSchema("Contraparte", LOAN_TEXT_LIMITS.personName)
      .optional(),
    personContact: clearable(
      textSchema("Contato", LOAN_TEXT_LIMITS.personContact)),
    description: clearable(
      textSchema("Descrição", LOAN_TEXT_LIMITS.description)),
    counterpartyType: clearable(z.enum(PJ_COUNTERPARTY_TYPES)),
    cnpjCpf: clearable(cnpjCpfSchema),
    classification: clearable(z.enum(PJ_LOAN_CLASSIFICATIONS)),
    costCenter: clearable(
      textSchema("Centro de custo", LOAN_TEXT_LIMITS.costCenter)),
  }).strict().refine(
    (changes) => Object.keys(changes).length > 0,
    "Alterações: informe ao menos um campo.",
  ),
}).strict();

export type UpdateLoanMetadataPayload =
  z.infer<typeof updateLoanMetadataPayloadSchema>;

export interface CreateLoanResult {
  loanId: string;
  movementId: string;
  cashTransactionId: string;
  replayed: boolean;
}

export interface LoanMutationResult {
  loanId: string;
  movementId?: string;
  cashTransactionId?: string;
  status?: string;
  balanceCents?: number;
  changed?: boolean;
  replayed: boolean;
}
