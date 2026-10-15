import {z} from "zod";

import {CASH_ENTRY_MIN_DAY} from "../cash/contracts";
import {HEX_COLOR_PATTERN} from "../cards/model";
import {isIsoInstant} from "../shared/commitTime";
import {saoPauloDayKey} from "../shared/dateKeys";
import {
  categoryIdSchema,
  cashAccountIdSchema,
  correlationIdSchema,
  creditCardIdSchema,
  hasControlCharacter,
  idempotencyKeySchema,
  recurringExpenseIdSchema,
  recurringOccurrenceIdSchema,
  workspaceIdSchema,
} from "../shared/ids";
import {isMoneyCents} from "../shared/money";
import {
  RECURRING_BUSINESS_TYPES,
  RECURRING_EXECUTION_MODES,
  RECURRING_ICON_PATTERN,
  RECURRING_MAX_CENTS,
  RECURRING_PAYMENT_METHODS,
  RECURRING_TYPES,
} from "./model";
import {
  RECURRING_FREQUENCIES,
  isCivilDayKey,
  usesBillingDay,
  type RecurringFrequency,
} from "./schedule";

/**
 * Contratos das callables de despesas recorrentes (P4-B, D-12).
 *
 * Todos `.strict()`: campo desconhecido é recusado. Nada autoritativo vem
 * do cliente — estado, próximo vencimento, ocorrências, origem dos fatos
 * (`source = recurring` só o backend grava), autoria e timestamps. Valores
 * em centavos inteiros BRL; datas civis `YYYY-MM-DD` em `America/Sao_Paulo`.
 * O modo de execução é sempre explícito: não há padrão no servidor.
 */
export const RECURRING_TEXT_LIMITS = {
  name: 80,
  description: 300,
  category: 80,
  supplier: 80,
  costCenter: 80,
  responsible: 80,
  commitment: 120,
  emoji: 16,
  reason: 140,
} as const;

/** Início até 10 anos à frente de hoje (São Paulo). */
export const RECURRING_MAX_START_YEARS = 10;

const checkedText = (label: string, maxLength: number) =>
  z.string()
    .min(1, `${label}: valor obrigatório.`)
    .max(maxLength, `${label}: até ${maxLength} caracteres.`)
    .refine((value) => !hasControlCharacter(value), `${label}: inválido.`);

const textSchema = (label: string, maxLength: number) =>
  z.string()
    .transform((value) => value.trim())
    .pipe(checkedText(label, maxLength));

/** Texto opcional: vazio (ou só espaços) vale `null`. */
const optionalTextSchema = (label: string, maxLength: number) =>
  z.union([z.string(), z.null()])
    .transform((value) => (value === null ? null : value.trim() || null))
    .pipe(z.union([checkedText(label, maxLength), z.null()]));

const amountSchema = (label: string) => z.number()
  .refine(isMoneyCents, `${label}: centavos inteiros.`)
  .refine((value) => value > 0, `${label}: deve ser maior que zero.`)
  .refine((value) => value <= RECURRING_MAX_CENTS,
    `${label}: acima do máximo permitido.`);

const maxStartDay = (): string => {
  const today = saoPauloDayKey();
  return `${Number(today.slice(0, 4)) + RECURRING_MAX_START_YEARS}` +
    today.slice(4);
};

const civilDaySchema = (label: string) => z.string()
  .refine(isCivilDayKey, `${label}: use AAAA-MM-DD com uma data existente.`)
  .refine((value) => value >= CASH_ENTRY_MIN_DAY, `${label}: anterior a 2000.`);

const startDateSchema = civilDaySchema("Data de início")
  .refine((value) => value <= maxStartDay(),
    `Data de início: no máximo ${RECURRING_MAX_START_YEARS} anos à frente.`);

const billingDaySchema = z.number()
  .refine((value) => Number.isSafeInteger(value) && value >= 1 && value <= 31,
    "Dia de cobrança: use um dia entre 1 e 31.");

const visualSchema = z.object({
  color: z.string().regex(HEX_COLOR_PATTERN, "Cor: inválida."),
  icon: z.string().regex(RECURRING_ICON_PATTERN, "Ícone: inválido."),
  emoji: optionalTextSchema("Emoji", RECURRING_TEXT_LIMITS.emoji),
}).strict();

/** Dados de empresa: só em workspace PJ (o tipo persistido decide). */
const businessSchema = z.object({
  supplier: optionalTextSchema("Fornecedor", RECURRING_TEXT_LIMITS.supplier),
  businessType: z.enum(RECURRING_BUSINESS_TYPES,
    {message: "Tipo de contrato: inválido."}).nullable(),
  costCenter: optionalTextSchema("Centro de custo",
    RECURRING_TEXT_LIMITS.costCenter),
  responsible: optionalTextSchema("Responsável",
    RECURRING_TEXT_LIMITS.responsible),
  adjustmentDate: civilDaySchema("Data de reajuste").nullable(),
  commitment: optionalTextSchema("Fidelidade",
    RECURRING_TEXT_LIMITS.commitment),
}).strict();

const baseFields = {
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
  correlationId: correlationIdSchema.optional(),
};

/** Campos do contrato, iguais na criação e (parciais) na edição. */
const contractFields = {
  name: textSchema("Nome", RECURRING_TEXT_LIMITS.name),
  type: z.enum(RECURRING_TYPES, {message: "Tipo: inválido."}),
  description: optionalTextSchema("Descrição",
    RECURRING_TEXT_LIMITS.description),
  amountCents: amountSchema("Valor"),
  frequency: z.enum(RECURRING_FREQUENCIES,
    {message: "Frequência: inválida."}),
  billingDay: billingDaySchema.nullable(),
  startDate: startDateSchema,
  endDate: civilDaySchema("Data de término").nullable(),
  paymentMethod: z.enum(RECURRING_PAYMENT_METHODS,
    {message: "Forma de pagamento: inválida."}),
  executionMode: z.enum(RECURRING_EXECUTION_MODES,
    {message: "Modo de execução: escolha Automático ou Confirmar antes."}),
  cardId: creditCardIdSchema.nullable(),
  cashAccountId: cashAccountIdSchema.nullable(),
  /**
   * Categoria de despesa do catálogo (P5-C1, D-37.8): ID estável, conferido
   * pelo backend; o nome gravado no contrato é o retrato do catálogo.
   */
  categoryId: categoryIdSchema,
  visual: visualSchema,
  business: businessSchema.nullable(),
};

export interface ContractShape {
  frequency: RecurringFrequency;
  billingDay: number | null;
  startDate: string;
  endDate: string | null;
  paymentMethod: typeof RECURRING_PAYMENT_METHODS[number];
  cardId: string | null;
  cashAccountId: string | null;
}

export const BILLING_DAY_REQUIRED_MESSAGE =
  "Dia de cobrança: obrigatório nas frequências mensal, bimestral, " +
  "trimestral, semestral e anual.";
export const BILLING_DAY_FORBIDDEN_MESSAGE =
  "Dia de cobrança: não se aplica às frequências semanal e quinzenal.";
export const END_BEFORE_START_MESSAGE =
  "Data de término: não pode ser anterior à data de início.";
export const CARD_REQUIRED_MESSAGE =
  "Cartão: obrigatório quando a forma de pagamento é cartão de crédito.";
export const CARD_FORBIDDEN_MESSAGE =
  "Cartão: só se aplica à forma de pagamento cartão de crédito.";
export const ACCOUNT_REQUIRED_MESSAGE =
  "Conta: obrigatória para as formas de pagamento fora do cartão.";
export const ACCOUNT_FORBIDDEN_MESSAGE =
  "Conta: não se aplica à forma de pagamento cartão de crédito.";

/**
 * Coerência do contrato completo (na criação e depois de aplicar a edição):
 * dia de cobrança só nas frequências mensais, término não anterior ao
 * início, cartão só no cartão de crédito e conta só fora dele.
 */
export const contractIssues = (
  contract: ContractShape,
): {path: string; message: string}[] => {
  const issues: {path: string; message: string}[] = [];
  if (usesBillingDay(contract.frequency)) {
    if (contract.billingDay === null) {
      issues.push({path: "billingDay", message: BILLING_DAY_REQUIRED_MESSAGE});
    }
  } else if (contract.billingDay !== null) {
    issues.push({path: "billingDay", message: BILLING_DAY_FORBIDDEN_MESSAGE});
  }
  if (contract.endDate !== null && contract.endDate < contract.startDate) {
    issues.push({path: "endDate", message: END_BEFORE_START_MESSAGE});
  }
  if (contract.paymentMethod === "credit_card") {
    if (contract.cardId === null) {
      issues.push({path: "cardId", message: CARD_REQUIRED_MESSAGE});
    }
    if (contract.cashAccountId !== null) {
      issues.push({path: "cashAccountId", message: ACCOUNT_FORBIDDEN_MESSAGE});
    }
  } else {
    if (contract.cashAccountId === null) {
      issues.push({path: "cashAccountId", message: ACCOUNT_REQUIRED_MESSAGE});
    }
    if (contract.cardId !== null) {
      issues.push({path: "cardId", message: CARD_FORBIDDEN_MESSAGE});
    }
  }
  return issues;
};

export const createRecurringExpensePayloadSchema = z.object({
  ...baseFields,
  ...contractFields,
}).strict().superRefine((value, context) => {
  for (const issue of contractIssues(value)) {
    context.addIssue({code: "custom", path: [issue.path],
      message: issue.message});
  }
});
export type CreateRecurringExpensePayload = z.infer<
  typeof createRecurringExpensePayloadSchema
>;

/** Versão lida pelo cliente: `updatedAt`, ISO-8601 com nanossegundos. */
const versionSchema = z.string()
  .max(40, "Versão da recorrência: formato inválido.")
  .refine(isIsoInstant, "Versão da recorrência: formato inválido.");

const contractTargetFields = {
  ...baseFields,
  recurringExpenseId: recurringExpenseIdSchema,
  expectedUpdatedAt: versionSchema,
};

/**
 * Edição: só os campos alterados, com a versão lida. A coerência é
 * conferida no servidor sobre o contrato resultante.
 */
export const updateRecurringExpensePayloadSchema = z.object({
  ...contractTargetFields,
  changes: z.object(contractFields).partial().strict()
    .refine((changes) => Object.keys(changes).length > 0,
      "Informe ao menos um campo para alterar."),
  /** Motivo opcional (ex.: reajuste), guardado na trilha da alteração. */
  reason: optionalTextSchema("Motivo", RECURRING_TEXT_LIMITS.reason)
    .optional(),
}).strict();
export type UpdateRecurringExpensePayload = z.infer<
  typeof updateRecurringExpensePayloadSchema
>;
export type RecurringContractChanges = UpdateRecurringExpensePayload["changes"];

export const pauseRecurringExpensePayloadSchema =
  z.object(contractTargetFields).strict();
export const resumeRecurringExpensePayloadSchema =
  z.object(contractTargetFields).strict();
export const cancelRecurringExpensePayloadSchema =
  z.object(contractTargetFields).strict();
export type RecurringLifecyclePayload = z.infer<
  typeof pauseRecurringExpensePayloadSchema
>;

const occurrenceTargetFields = {
  ...baseFields,
  occurrenceId: recurringOccurrenceIdSchema,
};

/** Data efetiva do pagamento: até hoje em São Paulo. */
const paidDateSchema = civilDaySchema("Data do pagamento")
  .refine((value) => value <= saoPauloDayKey(),
    "Data do pagamento: não pode ser futura.");

/**
 * Confirmação de uma ocorrência aguardando o usuário.
 *
 * - Cartão: cria a compra (valor real opcional; padrão, o planejado).
 * - Fora do cartão: `settlement` escolhe entre gerar o lançamento pendente
 *   (`pending`) ou registrá-lo como pago agora (`paid`, com a data efetiva);
 *   a conta pode ser outra que a padrão do contrato.
 *
 * Campos que não se aplicam ao destino da ocorrência são recusados no
 * servidor, que conhece o destino.
 */
export const confirmRecurringOccurrencePayloadSchema = z.object({
  ...occurrenceTargetFields,
  amountCents: amountSchema("Valor real").optional(),
  settlement: z.enum(["pending", "paid"],
    {message: "Registro: escolha pendente ou pago."}).optional(),
  cashAccountId: cashAccountIdSchema.optional(),
  paidDate: paidDateSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.settlement === "paid" && value.paidDate === undefined) {
    context.addIssue({code: "custom", path: ["paidDate"],
      message: "Data do pagamento: obrigatória para registrar como pago."});
  }
  if (value.settlement !== "paid" && value.paidDate !== undefined) {
    context.addIssue({code: "custom", path: ["paidDate"],
      message: "Data do pagamento: só ao registrar como pago."});
  }
});
export type ConfirmRecurringOccurrencePayload = z.infer<
  typeof confirmRecurringOccurrencePayloadSchema
>;

export const ignoreRecurringOccurrencePayloadSchema =
  z.object(occurrenceTargetFields).strict();
export type IgnoreRecurringOccurrencePayload = z.infer<
  typeof ignoreRecurringOccurrencePayloadSchema
>;

/**
 * Nova tentativa de uma ocorrência que exigiu atenção, depois da correção
 * (cartão reativado, limite, conta reativada). Pode apontar outro cartão ou
 * outra conta do mesmo destino.
 */
export const retryRecurringOccurrencePayloadSchema = z.object({
  ...occurrenceTargetFields,
  cardId: creditCardIdSchema.optional(),
  cashAccountId: cashAccountIdSchema.optional(),
}).strict().refine(
  (value) => value.cardId === undefined || value.cashAccountId === undefined,
  {message: "Informe um cartão ou uma conta, não os dois.",
    path: ["cashAccountId"]},
);
export type RetryRecurringOccurrencePayload = z.infer<
  typeof retryRecurringOccurrencePayloadSchema
>;
