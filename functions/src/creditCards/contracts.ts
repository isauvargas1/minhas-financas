import {z} from "zod";

export const workspaceIdSchema = z.string().min(1, "Workspace obrigatório.");
export const idempotencyKeySchema = z.string().min(16, "Chave de idempotência inválida.");
export const correlationIdSchema = z.string().min(8).optional();

export const isoDateStringSchema = z
  .string()
  .min(10, "Data obrigatória.")
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Data inválida.",
  });

export const competenceMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Competência deve usar o formato YYYY-MM.");

export const moneyAmountSchema = z
  .number()
  .finite()
  .positive("Valor deve ser maior que zero.");

export const nonNegativeMoneyAmountSchema = z
  .number()
  .finite()
  .nonnegative("Valor não pode ser negativo.");

export const creditCardPurchaseAmountTypeSchema = z.enum([
  "total",
  "installment",
]);

export const creditCardPurchaseSourceSchema = z.enum([
  "manual",
  "recurring",
  "split",
  "migration",
]);

export const cancelCreditCardPurchasePolicySchema = z.enum([
  "only_if_all_installments_open",
  "allow_reversal_entries",
  "block_if_invoice_paid",
]);

export const reopenCreditCardInvoicePolicySchema = z.enum([
  "only_if_unpaid",
  "allow_if_partial_paid_with_audit",
  "block_if_paid",
]);

export const invoicePaymentMethodSchema = z.enum([
  "wallet",
  "cash_account",
  "manual_adjustment",
  "external",
]);

export const categorySnapshotSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1, "Categoria obrigatória."),
  normalizedLabel: z.string().optional(),
  icon: z.string().optional(),
  color: z.string().optional(),
});

export const creditCardCallableBasePayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
  correlationId: correlationIdSchema,
});

export const createCreditCardPurchasePayloadSchema =
  creditCardCallableBasePayloadSchema.extend({
    cardId: z.string().min(1, "Cartão obrigatório."),

    description: z.string().min(1, "Descrição obrigatória."),
    categoryId: z.string().optional(),
    categorySnapshot: categorySnapshotSchema.optional(),

    supplier: z.string().optional(),
    costCenter: z.string().optional(),

    purchaseDate: isoDateStringSchema,
    totalAmount: moneyAmountSchema,
    installmentsCount: z
      .number()
      .int()
      .min(1, "A compra precisa ter pelo menos uma parcela."),

    amountType: creditCardPurchaseAmountTypeSchema,
    source: creditCardPurchaseSourceSchema.default("manual"),
  });

export const updateCreditCardPurchasePayloadSchema =
  creditCardCallableBasePayloadSchema.extend({
    purchaseId: z.string().min(1, "Compra obrigatória."),
    cardId: z.string().min(1, "Cartão obrigatório."),

    description: z.string().min(1).optional(),
    categoryId: z.string().optional(),
    categorySnapshot: categorySnapshotSchema.optional(),

    supplier: z.string().optional(),
    costCenter: z.string().optional(),

    purchaseDate: isoDateStringSchema.optional(),
    totalAmount: moneyAmountSchema.optional(),
    installmentsCount: z.number().int().min(1).optional(),
    amountType: creditCardPurchaseAmountTypeSchema.optional(),

    reason: z.string().min(1, "Motivo obrigatório."),
    rebuildInstallments: z.boolean().default(true),
  });

export const cancelCreditCardPurchasePayloadSchema =
  creditCardCallableBasePayloadSchema.extend({
    purchaseId: z.string().min(1, "Compra obrigatória."),
    cardId: z.string().min(1, "Cartão obrigatório."),
    reason: z.string().min(1, "Motivo obrigatório."),
    policy: cancelCreditCardPurchasePolicySchema.default("block_if_invoice_paid"),
  });

export const closeCreditCardInvoicePayloadSchema =
  creditCardCallableBasePayloadSchema.extend({
    invoiceId: z.string().min(1, "Fatura obrigatória."),
    cardId: z.string().min(1, "Cartão obrigatório."),
    closedAt: isoDateStringSchema,
  });

export const reopenCreditCardInvoicePayloadSchema =
  creditCardCallableBasePayloadSchema.extend({
    invoiceId: z.string().min(1, "Fatura obrigatória."),
    cardId: z.string().min(1, "Cartão obrigatório."),
    reason: z.string().min(1, "Motivo obrigatório."),
    policy: reopenCreditCardInvoicePolicySchema.default("block_if_paid"),
  });

export const registerCreditCardInvoicePaymentPayloadSchema =
  creditCardCallableBasePayloadSchema
    .extend({
      invoiceId: z.string().min(1, "Fatura obrigatória."),
      cardId: z.string().min(1, "Cartão obrigatório."),

      paymentDate: isoDateStringSchema,
      amount: moneyAmountSchema,

      walletId: z.string().optional(),
      cashAccountId: z.string().optional(),
      paymentMethod: invoicePaymentMethodSchema,
    })
    .refine(
      (payload) =>
        payload.paymentMethod === "manual_adjustment" ||
        payload.paymentMethod === "external" ||
        Boolean(payload.walletId || payload.cashAccountId),
      {
        message: "Pagamento por carteira ou conta precisa informar walletId ou cashAccountId.",
        path: ["paymentMethod"],
      }
    );

export const reverseCreditCardInvoicePaymentPayloadSchema =
  creditCardCallableBasePayloadSchema.extend({
    paymentId: z.string().min(1, "Pagamento obrigatório."),
    invoiceId: z.string().min(1, "Fatura obrigatória."),
    cardId: z.string().min(1, "Cartão obrigatório."),

    reason: z.string().min(1, "Motivo obrigatório."),
    reversedAt: isoDateStringSchema,
  });

export const recalculateCardLimitPayloadSchema =
  creditCardCallableBasePayloadSchema.extend({
    cardId: z.string().min(1, "Cartão obrigatório."),
    reason: z.string().min(1, "Motivo obrigatório."),
  });

export const rebuildCardInvoicesForCardPayloadSchema =
  creditCardCallableBasePayloadSchema.extend({
    cardId: z.string().min(1, "Cartão obrigatório."),
    fromCompetenceMonth: competenceMonthSchema.optional(),
    toCompetenceMonth: competenceMonthSchema.optional(),
    reason: z.string().min(1, "Motivo obrigatório."),
  });

export const migrateLegacyInstallmentsPayloadSchema =
  creditCardCallableBasePayloadSchema.extend({
    cardId: z.string().optional(),
    transactionIds: z.array(z.string().min(1)).optional(),
    dryRun: z.boolean().default(true),
    migrationBatchId: z.string().min(1, "Lote de migração obrigatório."),
  });

export type CreateCreditCardPurchasePayload = z.infer<
  typeof createCreditCardPurchasePayloadSchema
>;

export type UpdateCreditCardPurchasePayload = z.infer<
  typeof updateCreditCardPurchasePayloadSchema
>;

export type CancelCreditCardPurchasePayload = z.infer<
  typeof cancelCreditCardPurchasePayloadSchema
>;

export type CloseCreditCardInvoicePayload = z.infer<
  typeof closeCreditCardInvoicePayloadSchema
>;

export type ReopenCreditCardInvoicePayload = z.infer<
  typeof reopenCreditCardInvoicePayloadSchema
>;

export type RegisterCreditCardInvoicePaymentPayload = z.infer<
  typeof registerCreditCardInvoicePaymentPayloadSchema
>;

export type ReverseCreditCardInvoicePaymentPayload = z.infer<
  typeof reverseCreditCardInvoicePaymentPayloadSchema
>;

export type RecalculateCardLimitPayload = z.infer<
  typeof recalculateCardLimitPayloadSchema
>;

export type RebuildCardInvoicesForCardPayload = z.infer<
  typeof rebuildCardInvoicesForCardPayloadSchema
>;

export type MigrateLegacyInstallmentsPayload = z.infer<
  typeof migrateLegacyInstallmentsPayloadSchema
>;