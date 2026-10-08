import {z} from "zod";

import {CASH_ENTRY_MIN_DAY} from "../cash/contracts";
import {isIsoInstant} from "../shared/commitTime";
import {isDayKey, saoPauloDayKey} from "../shared/dateKeys";
import {
  cashAccountIdSchema,
  correlationIdSchema,
  creditCardIdSchema,
  creditCardInvoiceIdSchema,
  creditCardPaymentIdSchema,
  creditCardPurchaseIdSchema,
  hasControlCharacter,
  idempotencyKeySchema,
  workspaceIdSchema,
} from "../shared/ids";
import {isMoneyCents} from "../shared/money";
import {
  CARD_BRANDS,
  CARD_IMAGE_URL_PATTERN,
  CARD_MAX_CENTS,
  CARD_MAX_INSTALLMENTS,
  CARD_VISUAL_BG_TYPES,
  CARD_VISUAL_TEXT_COLORS,
  HEX_COLOR_PATTERN,
  isMonthKey,
} from "./model";

/**
 * Contratos das callables de cartões de crédito (P4-A, D-36).
 *
 * Todos `.strict()`: campo desconhecido é recusado. Nada que é autoritativo
 * vem do cliente — limite usado/disponível, estado, faturas, parcelas,
 * origem da compra (`source` é sempre `manual` na compra manual), autoria e
 * timestamps. Valores são centavos inteiros BRL (nunca ponto flutuante);
 * datas civis são `YYYY-MM-DD` e competências `YYYY-MM` em
 * `America/Sao_Paulo`.
 */
export const CARD_TEXT_LIMITS = {
  name: 80,
  observations: 500,
  responsiblePerson: 80,
  recommendedUse: 200,
  costCenter: 80,
  description: 140,
  category: 80,
  supplier: 80,
  reason: 300,
} as const;

const checkedText = (label: string, maxLength: number, minLength = 1) =>
  z.string()
    .min(minLength, minLength > 1 ?
      `${label}: mínimo de ${minLength} caracteres.` :
      `${label}: valor obrigatório.`)
    .max(maxLength, `${label}: até ${maxLength} caracteres.`)
    .refine((value) => !hasControlCharacter(value), `${label}: inválido.`);

const textSchema = (label: string, maxLength: number, minLength = 1) =>
  z.string()
    .transform((value) => value.trim())
    .pipe(checkedText(label, maxLength, minLength));

/** Texto opcional: vazio (ou só espaços) vale `null`. */
const optionalTextSchema = (label: string, maxLength: number) =>
  z.union([z.string(), z.null()])
    .transform((value) => (value === null ? null : value.trim() || null))
    .pipe(z.union([checkedText(label, maxLength), z.null()]));

const daySchema = (label: string) => z.number()
  .refine((value) => Number.isSafeInteger(value) && value >= 1 && value <= 31,
    `${label}: use um dia entre 1 e 31.`);

const positiveCentsSchema = (label: string) => z.number()
  .refine(isMoneyCents, `${label}: centavos inteiros.`)
  .refine((value) => value > 0, `${label}: deve ser maior que zero.`)
  .refine((value) => value <= CARD_MAX_CENTS,
    `${label}: acima do máximo permitido.`);

/** Versão lida pelo cliente: `updatedAt`, ISO-8601 com nanossegundos. */
const versionSchema = (label: string) => z.string()
  .max(40, `${label}: formato inválido.`)
  .refine(isIsoInstant, `${label}: formato inválido.`);

/** Data de fato já ocorrido: até hoje em São Paulo, a partir de 2000. */
const pastDaySchema = (label: string) => z.string()
  .refine(isDayKey, `${label}: use AAAA-MM-DD com uma data existente.`)
  .refine((value) => value >= CASH_ENTRY_MIN_DAY, `${label}: anterior a 2000.`)
  .refine((value) => value <= saoPauloDayKey(),
    `${label}: não pode ser futura.`);

const baseFields = {
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
  correlationId: correlationIdSchema.optional(),
};

const visualSchema = z.object({
  bgType: z.enum(CARD_VISUAL_BG_TYPES, {message: "Tipo de fundo: inválido."}),
  bgColor: z.string().regex(HEX_COLOR_PATTERN, "Cor principal: inválida."),
  bgGradientColor: z.string()
    .regex(HEX_COLOR_PATTERN, "Cor de transição: inválida.")
    .nullable()
    .optional(),
  bgImage: z.string()
    .regex(CARD_IMAGE_URL_PATTERN,
      "Imagem do cartão: use um endereço https:// válido.")
    .nullable()
    .optional(),
  textColor: z.enum(CARD_VISUAL_TEXT_COLORS,
    {message: "Cor do texto: inválida."}),
  showName: z.boolean(),
  showBrand: z.boolean(),
  showLogo: z.boolean(),
}).strict();

export type CardVisualInput = z.infer<typeof visualSchema>;

const profileFields = {
  name: textSchema("Nome do cartão", CARD_TEXT_LIMITS.name),
  brand: z.enum(CARD_BRANDS, {message: "Bandeira: inválida."}),
  closingDay: daySchema("Dia de fechamento"),
  dueDay: daySchema("Dia de vencimento"),
  bestDay: daySchema("Melhor dia").nullable(),
  observations: optionalTextSchema("Observações",
    CARD_TEXT_LIMITS.observations),
  responsiblePerson: optionalTextSchema("Responsável",
    CARD_TEXT_LIMITS.responsiblePerson),
  recommendedUse: optionalTextSchema("Uso recomendado",
    CARD_TEXT_LIMITS.recommendedUse),
  defaultCostCenter: optionalTextSchema("Centro de custo",
    CARD_TEXT_LIMITS.costCenter),
  visual: visualSchema,
};

export const createCreditCardPayloadSchema = z.object({
  ...baseFields,
  ...profileFields,
  bestDay: profileFields.bestDay.optional(),
  observations: profileFields.observations.optional(),
  responsiblePerson: profileFields.responsiblePerson.optional(),
  recommendedUse: profileFields.recommendedUse.optional(),
  defaultCostCenter: profileFields.defaultCostCenter.optional(),
  limitTotalCents: positiveCentsSchema("Limite total"),
}).strict();

export type CreateCreditCardPayload =
  z.infer<typeof createCreditCardPayloadSchema>;

const cardMutationFields = {
  ...baseFields,
  cardId: creditCardIdSchema,
  expectedUpdatedAt: versionSchema("Versão do cartão"),
};

/** Cadastro e limite total; o limite usado nunca é editável. */
export const updateCreditCardPayloadSchema = z.object({
  ...cardMutationFields,
  changes: z.object({
    name: profileFields.name.optional(),
    brand: profileFields.brand.optional(),
    closingDay: profileFields.closingDay.optional(),
    dueDay: profileFields.dueDay.optional(),
    bestDay: profileFields.bestDay.optional(),
    observations: profileFields.observations.optional(),
    responsiblePerson: profileFields.responsiblePerson.optional(),
    recommendedUse: profileFields.recommendedUse.optional(),
    defaultCostCenter: profileFields.defaultCostCenter.optional(),
    visual: visualSchema.optional(),
    limitTotalCents: positiveCentsSchema("Limite total").optional(),
  }).strict().refine(
    (changes) => Object.keys(changes).length > 0,
    "Informe ao menos um campo para alterar.",
  ),
}).strict();

export type UpdateCreditCardPayload =
  z.infer<typeof updateCreditCardPayloadSchema>;

export const archiveCreditCardPayloadSchema = z.object({
  ...cardMutationFields,
}).strict();

export type ArchiveCreditCardPayload =
  z.infer<typeof archiveCreditCardPayloadSchema>;

export const reactivateCreditCardPayloadSchema = z.object({
  ...cardMutationFields,
}).strict();

export type ReactivateCreditCardPayload =
  z.infer<typeof reactivateCreditCardPayloadSchema>;

const installmentsCountSchema = z.number()
  .refine((value) => Number.isSafeInteger(value) && value >= 1,
    "Parcelas: informe um número inteiro a partir de 1.")
  .refine((value) => value <= CARD_MAX_INSTALLMENTS,
    `Parcelas: até ${CARD_MAX_INSTALLMENTS}.`);

const INSTALLMENT_FLOOR_MESSAGE =
  "Valor da compra: cada parcela precisa ter ao menos R$ 0,01.";

/**
 * Compra manual: o cliente informa o valor **total** em centavos, a
 * quantidade de parcelas, a data, o cartão e a descrição. A distribuição das
 * parcelas, as faturas e a origem (`manual`) são do backend.
 */
export const createCreditCardPurchasePayloadSchema = z.object({
  ...baseFields,
  cardId: creditCardIdSchema,
  description: textSchema("Descrição", CARD_TEXT_LIMITS.description),
  category: textSchema("Categoria", CARD_TEXT_LIMITS.category),
  supplier: optionalTextSchema("Fornecedor", CARD_TEXT_LIMITS.supplier)
    .optional(),
  costCenter: optionalTextSchema("Centro de custo", CARD_TEXT_LIMITS.costCenter)
    .optional(),
  purchaseDate: pastDaySchema("Data da compra"),
  totalCents: positiveCentsSchema("Valor da compra"),
  installmentsCount: installmentsCountSchema,
}).strict().superRefine((payload, context) => {
  if (payload.totalCents < payload.installmentsCount) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["totalCents"],
      message: INSTALLMENT_FLOOR_MESSAGE,
    });
  }
});

export type CreateCreditCardPurchasePayload =
  z.infer<typeof createCreditCardPurchasePayloadSchema>;

const purchaseMutationFields = {
  ...baseFields,
  purchaseId: creditCardPurchaseIdSchema,
  expectedUpdatedAt: versionSchema("Versão da compra"),
};

/**
 * Edição da compra: descritivos a qualquer momento da compra ativa;
 * financeiros (data, valor, parcelas) só com todas as parcelas em faturas
 * abertas — o backend decide sobre o estado relido.
 */
export const updateCreditCardPurchasePayloadSchema = z.object({
  ...purchaseMutationFields,
  changes: z.object({
    description: textSchema("Descrição", CARD_TEXT_LIMITS.description)
      .optional(),
    category: textSchema("Categoria", CARD_TEXT_LIMITS.category).optional(),
    supplier: optionalTextSchema("Fornecedor", CARD_TEXT_LIMITS.supplier)
      .optional(),
    costCenter: optionalTextSchema("Centro de custo",
      CARD_TEXT_LIMITS.costCenter).optional(),
    purchaseDate: pastDaySchema("Data da compra").optional(),
    totalCents: positiveCentsSchema("Valor da compra").optional(),
    installmentsCount: installmentsCountSchema.optional(),
  }).strict().refine(
    (changes) => Object.keys(changes).length > 0,
    "Informe ao menos um campo para alterar.",
  ),
}).strict();

export type UpdateCreditCardPurchasePayload =
  z.infer<typeof updateCreditCardPurchasePayloadSchema>;

export const cancelCreditCardPurchasePayloadSchema = z.object({
  ...purchaseMutationFields,
}).strict();

export type CancelCreditCardPurchasePayload =
  z.infer<typeof cancelCreditCardPurchasePayloadSchema>;

export const refundCreditCardPurchasePayloadSchema = z.object({
  ...purchaseMutationFields,
}).strict();

export type RefundCreditCardPurchasePayload =
  z.infer<typeof refundCreditCardPurchasePayloadSchema>;

const competenceSchema = z.string()
  .refine(isMonthKey, "Competência: use AAAA-MM.");

/**
 * Ajuste manual (owner/admin): valor com sinal, motivo obrigatório. Nunca é
 * pagamento. Em competência fechada, o backend publica a compensação na
 * primeira fatura aberta.
 */
export const createCreditCardInvoiceAdjustmentPayloadSchema = z.object({
  ...baseFields,
  cardId: creditCardIdSchema,
  competenceMonth: competenceSchema,
  amountCents: z.number()
    .refine(isMoneyCents, "Valor do ajuste: centavos inteiros.")
    .refine((value) => value !== 0, "Valor do ajuste: diferente de zero.")
    .refine((value) => Math.abs(value) <= CARD_MAX_CENTS,
      "Valor do ajuste: acima do máximo permitido."),
  reason: textSchema("Motivo", CARD_TEXT_LIMITS.reason, 3),
}).strict();

export type CreateCreditCardInvoiceAdjustmentPayload =
  z.infer<typeof createCreditCardInvoiceAdjustmentPayloadSchema>;

/**
 * Pagamento de fatura fechada, total ou parcial, a partir de uma conta ativa
 * (D-30). `expectedUpdatedAt` é a versão da fatura lida pelo cliente.
 */
export const registerInvoicePaymentPayloadSchema = z.object({
  ...baseFields,
  cardId: creditCardIdSchema,
  invoiceId: creditCardInvoiceIdSchema,
  cashAccountId: cashAccountIdSchema,
  amountCents: positiveCentsSchema("Valor do pagamento"),
  paymentDate: pastDaySchema("Data do pagamento"),
  expectedUpdatedAt: versionSchema("Versão da fatura"),
}).strict();

export type RegisterInvoicePaymentPayload =
  z.infer<typeof registerInvoicePaymentPayloadSchema>;

/**
 * Estorno de pagamento: a conta é sempre a do pagamento original (o cliente
 * não a escolhe). `expectedUpdatedAt` é a versão da fatura lida pelo cliente.
 */
export const reverseInvoicePaymentPayloadSchema = z.object({
  ...baseFields,
  paymentId: creditCardPaymentIdSchema,
  expectedUpdatedAt: versionSchema("Versão da fatura"),
}).strict();

export type ReverseInvoicePaymentPayload =
  z.infer<typeof reverseInvoicePaymentPayloadSchema>;

/** Reconciliação do limite: relê as fontes e só repara o campo derivado. */
export const recalculateCardLimitPayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  cardId: creditCardIdSchema,
  correlationId: correlationIdSchema.optional(),
}).strict();

export type RecalculateCardLimitPayload =
  z.infer<typeof recalculateCardLimitPayloadSchema>;

export const REBUILD_INVOICES_MAX_PAGE_SIZE = 50;

/** Reconstrução paginada dos totais das faturas de um cartão. */
export const rebuildCardInvoicesPayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  cardId: creditCardIdSchema,
  /** Última competência já processada (exclusiva); omitida, do início. */
  cursor: competenceSchema.optional(),
  pageSize: z.number()
    .refine((value) => Number.isSafeInteger(value) && value >= 1 &&
      value <= REBUILD_INVOICES_MAX_PAGE_SIZE,
    `Tamanho da página: de 1 a ${REBUILD_INVOICES_MAX_PAGE_SIZE}.`)
    .optional(),
  correlationId: correlationIdSchema.optional(),
}).strict();

export type RebuildCardInvoicesPayload =
  z.infer<typeof rebuildCardInvoicesPayloadSchema>;

// ----------------------------------------------------------------- resultados

export interface CardMutationResult {
  cardId: string;
  replayed: boolean;
  [key: string]: unknown;
}
