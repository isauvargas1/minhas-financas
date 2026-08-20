import {z} from "zod";

export const investmentDocumentIdSchema = z
  .string()
  .min(1)
  .max(240)
  .refine((value) => !value.includes("/"), "Identificador inválido.");
const documentIdSchema = investmentDocumentIdSchema;
export const investmentWorkspaceIdSchema = investmentDocumentIdSchema;
const workspaceIdSchema = investmentWorkspaceIdSchema;
export const investmentIdempotencyKeySchema = z.string().min(16).max(200);
const idempotencyKeySchema = investmentIdempotencyKeySchema;
export const investmentCorrelationIdSchema = z.string().min(8).max(200);
const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00.000Z`);
    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Data inválida.");
const moneySchema = z.number().finite().nonnegative().max(90_000_000_000_000);
const centsSchema = z
  .number()
  .int()
  .safe()
  .nonnegative()
  .max(9_000_000_000_000);
const positiveCentsSchema = centsSchema.positive();
const quantityMicrosSchema = z
  .number()
  .int()
  .safe()
  .positive()
  .max(9_000_000_000_000);
const isoTimestampSchema = z.string().datetime({offset: true});
const descriptionSchema = z.string().trim().min(1).max(240);
const reasonSchema = z.string().trim().min(3).max(500);
const entityNameSchema = z.string().trim().min(2).max(120);

const baseSchema = z.object({
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
});

const v2BaseShape = {
  workspaceId: investmentWorkspaceIdSchema,
  idempotencyKey: investmentIdempotencyKeySchema,
  correlationId: investmentCorrelationIdSchema,
};

const financialAmountsSchema = z
  .object({
    principalCents: positiveCentsSchema,
    quantityMicros: quantityMicrosSchema,
    gainCents: centsSchema.default(0),
    feesCents: centsSchema.default(0),
    taxCents: centsSchema.default(0),
  })
  .strict()
  .superRefine((values, context) => {
    if (values.taxCents > values.gainCents) {
      context.addIssue({
        code: "custom",
        path: ["taxCents"],
        message: "O imposto não pode superar o ganho realizado.",
      });
    }
    if (
      values.feesCents + values.taxCents >=
      values.principalCents + values.gainCents
    ) {
      context.addIssue({
        code: "custom",
        path: ["feesCents"],
        message: "Taxas e impostos devem ser menores que o valor bruto.",
      });
    }
  });

export const createInvestmentContributionPayloadSchema = z
  .object({
    ...v2BaseShape,
    accountId: investmentDocumentIdSchema,
    assetId: investmentDocumentIdSchema,
    goalId: investmentDocumentIdSchema.optional(),
    walletId: investmentDocumentIdSchema.optional(),
    description: descriptionSchema,
    principalCents: positiveCentsSchema,
    quantityMicros: quantityMicrosSchema,
    feesCents: centsSchema.default(0),
    taxCents: centsSchema.default(0),
    occurredAt: isoTimestampSchema,
  })
  .strict();

export const createInvestmentRedemptionPayloadSchema = z
  .object({
    ...v2BaseShape,
    accountId: investmentDocumentIdSchema,
    assetId: investmentDocumentIdSchema,
    walletId: investmentDocumentIdSchema.optional(),
    description: descriptionSchema,
    requestedPrincipalCents: positiveCentsSchema,
    requestedQuantityMicros: quantityMicrosSchema,
    requestedAt: isoTimestampSchema,
    expectedSettlementAt: isoTimestampSchema.optional(),
  })
  .strict();

export const settleInvestmentRedemptionPayloadSchema = z
  .object({
    ...v2BaseShape,
    movementId: investmentDocumentIdSchema,
    settlement: financialAmountsSchema,
    settledAt: isoTimestampSchema,
  })
  .strict();

export const reverseInvestmentMovementPayloadSchema = z
  .object({
    ...v2BaseShape,
    movementId: investmentDocumentIdSchema,
    reversedAt: isoTimestampSchema,
    reason: reasonSchema,
  })
  .strict();

export const linkInvestmentToGoalPayloadSchema = z
  .object({
    ...v2BaseShape,
    accountId: investmentDocumentIdSchema,
    assetId: investmentDocumentIdSchema,
    goalId: investmentDocumentIdSchema,
    occurredAt: isoTimestampSchema,
    reason: reasonSchema,
  })
  .strict();

export const unlinkInvestmentFromGoalPayloadSchema = z
  .object({
    ...v2BaseShape,
    accountId: investmentDocumentIdSchema,
    assetId: investmentDocumentIdSchema,
    goalId: investmentDocumentIdSchema,
    occurredAt: isoTimestampSchema,
    reason: reasonSchema,
  })
  .strict();

const rebuildSchema = z
  .object({
    ...v2BaseShape,
    rebuildId: investmentDocumentIdSchema.optional(),
    pageSize: z.number().int().min(1).max(100).default(50),
    reason: reasonSchema,
  })
  .strict();

export const recalculateInvestmentPositionPayloadSchema = rebuildSchema
  .extend({
    accountId: investmentDocumentIdSchema,
    assetId: investmentDocumentIdSchema,
  })
  .strict();

export const recalculateGoalInvestmentProgressPayloadSchema = rebuildSchema
  .extend({
    goalId: investmentDocumentIdSchema,
  })
  .strict();

export const archiveInvestmentAccountPayloadSchema = z
  .object({
    ...v2BaseShape,
    accountId: investmentDocumentIdSchema,
    reason: reasonSchema,
  })
  .strict();

export const archiveInvestmentAssetPayloadSchema = z
  .object({
    ...v2BaseShape,
    assetId: investmentDocumentIdSchema,
    reason: reasonSchema,
  })
  .strict();

export const saveInvestmentAccountPayloadSchema = z
  .object({
    ...v2BaseShape,
    accountId: investmentDocumentIdSchema.optional(),
    name: entityNameSchema,
    institutionName: entityNameSchema,
  })
  .strict();

export const saveInvestmentAssetPayloadSchema = z
  .object({
    ...v2BaseShape,
    assetId: investmentDocumentIdSchema.optional(),
    name: entityNameSchema,
    symbol: z.string().trim().min(1).max(24).optional(),
    assetType: z.enum([
      "fixed_income",
      "fund",
      "stock",
      "etf",
      "crypto",
      "other",
    ]),
  })
  .strict();

export const onboardInvestmentWorkspacePayloadSchema = z
  .object(v2BaseShape)
  .strict();

export const saveInvestmentRedemptionPayloadSchema = baseSchema
  .extend({
    transactionId: documentIdSchema.optional(),
    redemption: z
      .object({
        sourceMovementId: documentIdSchema,
        description: z.string().trim().min(1).max(240),
        principal: moneySchema.positive(),
        gain: moneySchema,
        fees: moneySchema,
        tax: moneySchema,
        settlementDate: dateOnlySchema,
        status: z.enum(["pending", "settled"]),
      })
      .strict(),
  })
  .strict()
  .superRefine((payload, context) => {
    const {principal, gain, fees, tax} = payload.redemption;
    if (tax > gain) {
      context.addIssue({
        code: "custom",
        path: ["redemption", "tax"],
        message: "O imposto não pode superar o ganho realizado.",
      });
    }
    if (fees + tax >= principal + gain) {
      context.addIssue({
        code: "custom",
        path: ["redemption", "fees"],
        message:
          "Taxas e impostos devem ser menores que o valor bruto do resgate.",
      });
    }
  });

export const cancelInvestmentRedemptionPayloadSchema = baseSchema
  .extend({
    transactionId: documentIdSchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export const reverseInvestmentRedemptionPayloadSchema = baseSchema
  .extend({
    transactionId: documentIdSchema,
    reversalDate: dateOnlySchema,
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

export type SaveInvestmentRedemptionPayload = z.infer<
  typeof saveInvestmentRedemptionPayloadSchema
>;
export type CancelInvestmentRedemptionPayload = z.infer<
  typeof cancelInvestmentRedemptionPayloadSchema
>;
export type ReverseInvestmentRedemptionPayload = z.infer<
  typeof reverseInvestmentRedemptionPayloadSchema
>;
export type CreateInvestmentContributionPayload = z.infer<
  typeof createInvestmentContributionPayloadSchema
>;
export type CreateInvestmentRedemptionV2Payload = z.infer<
  typeof createInvestmentRedemptionPayloadSchema
>;
export type SettleInvestmentRedemptionPayload = z.infer<
  typeof settleInvestmentRedemptionPayloadSchema
>;
export type ReverseInvestmentMovementPayload = z.infer<
  typeof reverseInvestmentMovementPayloadSchema
>;
export type LinkInvestmentToGoalPayload = z.infer<
  typeof linkInvestmentToGoalPayloadSchema
>;
export type UnlinkInvestmentFromGoalPayload = z.infer<
  typeof unlinkInvestmentFromGoalPayloadSchema
>;
export type RecalculateInvestmentPositionPayload = z.infer<
  typeof recalculateInvestmentPositionPayloadSchema
>;
export type RecalculateGoalInvestmentProgressPayload = z.infer<
  typeof recalculateGoalInvestmentProgressPayloadSchema
>;
export type ArchiveInvestmentAccountPayload = z.infer<
  typeof archiveInvestmentAccountPayloadSchema
>;
export type ArchiveInvestmentAssetPayload = z.infer<
  typeof archiveInvestmentAssetPayloadSchema
>;
export type SaveInvestmentAccountPayload = z.infer<
  typeof saveInvestmentAccountPayloadSchema
>;
export type SaveInvestmentAssetPayload = z.infer<
  typeof saveInvestmentAssetPayloadSchema
>;
export type OnboardInvestmentWorkspacePayload = z.infer<
  typeof onboardInvestmentWorkspacePayloadSchema
>;
