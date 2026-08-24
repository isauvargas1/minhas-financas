import {FieldValue, Timestamp} from "firebase-admin/firestore";
import {z} from "zod";

import {CreditCardApplicationError} from "../creditCards/errors";
import {
  INVESTMENT_CALCULATION_VERSION,
  INVESTMENT_DOMAIN_VERSION,
} from "./domain";

/**
 * Contratos Zod de **documento** (não de payload).
 *
 * Até o M3 o domínio só validava a entrada da callable: os documentos eram
 * montados como literais sem tipo e gravados sem nenhuma verificação, de modo
 * que um documento fora do contrato — e portanto ilegível pelas Rules, que
 * validam no `get` — podia ser persistido silenciosamente. Estes contratos são
 * aplicados imediatamente antes da escrita e reproduzem as mesmas invariantes
 * de `firestore.rules`, para que backend e Rules não possam divergir.
 *
 * Dinheiro é inteiro em centavos e quantidade/preço são inteiros em micros;
 * nenhum campo autoritativo aceita float.
 */

/** Aceita `Timestamp` já materializado ou o sentinel de `serverTimestamp()`. */
const timestampLike = z.custom<Timestamp | FieldValue>(
  (value) => value instanceof Timestamp || value instanceof FieldValue,
  "Instante precisa ser Timestamp ou serverTimestamp().",
);

const materializedTimestamp = z.custom<Timestamp>(
  (value) => value instanceof Timestamp,
  "Instante precisa ser Timestamp.",
);

const investmentString = (max: number) => z.string().min(1).max(max);
const MAX_SAFE_CENTS = 9_007_199_254_740_991;
const safeInt = z
  .number()
  .int()
  .min(-MAX_SAFE_CENTS)
  .max(MAX_SAFE_CENTS);
const nonNegativeInt = safeInt.nonnegative();
const profileType = z.enum(["PF", "PJ"]);
const currency = z.literal("BRL");
const lifecycleStatus = z.enum(["active", "archived"]);
const allocationPurpose = z.enum([
  "unassigned",
  "retirement",
  "goal",
  "reserve",
  "financial_application",
  "reinvestment",
  "fixed_asset",
]);

const identity = {
  id: investmentString(240),
  workspaceId: investmentString(240),
  profileType,
};

export const investmentAccountDocumentSchema = z
  .object({
    ...identity,
    name: investmentString(160),
    institutionName: investmentString(160),
    currency,
    status: lifecycleStatus,
    createdBy: investmentString(128),
    createdAt: timestampLike,
    updatedBy: investmentString(128),
    updatedAt: timestampLike,
    archivedBy: investmentString(128).optional(),
    archivedAt: timestampLike.optional(),
    archiveReason: z.string().max(500).optional(),
  })
  .strict();

export const investmentAssetDocumentSchema = z
  .object({
    ...identity,
    name: investmentString(160),
    symbol: z.string().max(24).optional(),
    assetType: investmentString(64),
    // Obrigatório no documento: antes do M3 o onboarding não gravava o campo e
    // a finalidade só existia pelo default defensivo do leitor.
    allocationPurpose,
    currency,
    status: lifecycleStatus,
    createdBy: investmentString(128),
    createdAt: timestampLike,
    updatedBy: investmentString(128),
    updatedAt: timestampLike,
    archivedBy: investmentString(128).optional(),
    archivedAt: timestampLike.optional(),
    archiveReason: z.string().max(500).optional(),
  })
  .strict();

export const investmentPositionDocumentSchema = z
  .object({
    ...identity,
    accountId: investmentString(128),
    assetId: investmentString(128),
    currency,
    status: lifecycleStatus,
    goalId: investmentString(128).optional(),
    quantityMicros: nonNegativeInt,
    principalCents: nonNegativeInt,
    realizedGainCents: nonNegativeInt,
    feesCents: nonNegativeInt,
    taxCents: nonNegativeInt,
    currentValueCents: nonNegativeInt,
    unrealizedAppreciationCents: safeInt,
    valuationId: investmentString(240).optional(),
    valuationUnitPriceMicros: nonNegativeInt.optional(),
    valuationEffectiveAt: timestampLike.optional(),
    calculationVersion: z.literal(INVESTMENT_CALCULATION_VERSION),
    version: nonNegativeInt,
    lastMovementId: investmentString(240).optional(),
    lastMovementAt: timestampLike.optional(),
    createdAt: timestampLike,
    updatedAt: timestampLike,
    updatedBy: investmentString(128),
  })
  .strict();

const movementBase = z
  .object({
    ...identity,
    domainVersion: z.literal(INVESTMENT_DOMAIN_VERSION),
    calculationVersion: z.literal(INVESTMENT_CALCULATION_VERSION),
    accountId: investmentString(128),
    assetId: investmentString(128),
    positionId: investmentString(240),
    operation: z.enum([
      "contribution",
      "redemption",
      "reversal",
      "goal_link",
      "goal_unlink",
    ]),
    status: z.enum(["pending", "settled", "cancelled"]),
    currency,
    description: investmentString(500),
    principalCents: nonNegativeInt,
    gainCents: nonNegativeInt,
    feesCents: nonNegativeInt,
    taxCents: nonNegativeInt,
    quantityMicros: nonNegativeInt,
    cashDeltaCents: safeInt,
    principalDeltaCents: safeInt,
    realizedGainDeltaCents: safeInt,
    feesDeltaCents: safeInt,
    taxDeltaCents: safeInt,
    quantityDeltaMicros: safeInt,
    goalNetContributionDeltaCents: safeInt,
    goalCurrentValueDeltaCents: safeInt,
    currentValueDeltaCents: safeInt.optional(),
    goalId: investmentString(128).optional(),
    walletId: investmentString(128).optional(),
    transactionId: investmentString(240).optional(),
    reversedMovementId: investmentString(240).optional(),
    reversalOfOperation: z
      .enum(["contribution", "redemption", "reversal", "goal_link", "goal_unlink"])
      .optional(),
    reversedByMovementId: investmentString(240).optional(),
    reversalReason: z.string().max(500).optional(),
    reversedAt: timestampLike.optional(),
    reversedBy: investmentString(128).optional(),
    reversalCorrelationId: investmentString(200).optional(),
    cancelledAt: timestampLike.optional(),
    cancelledBy: investmentString(128).optional(),
    cancellationReason: z.string().max(500).optional(),
    cancellationCorrelationId: investmentString(200).optional(),
    importBatchId: investmentString(240).optional(),
    // Procedência da migração do legado: aponta para a transação de origem e
    // para o lote que a trouxe.
    migratedFromTransactionId: investmentString(240).optional(),
    migrationId: investmentString(240).optional(),
    correlationId: investmentString(200),
    idempotencyKeyHash: investmentString(128),
    occurredAt: materializedTimestamp,
    expectedSettlementAt: materializedTimestamp.optional(),
    settlementAt: materializedTimestamp.optional(),
    settlementCorrelationId: investmentString(200).optional(),
    createdBy: investmentString(128),
    createdAt: timestampLike,
    settledBy: investmentString(128).optional(),
    settledAt: timestampLike.optional(),
    updatedAt: timestampLike.optional(),
  })
  .strict();

const zeroDeltaFields = [
  "cashDeltaCents",
  "principalDeltaCents",
  "realizedGainDeltaCents",
  "feesDeltaCents",
  "taxDeltaCents",
  "quantityDeltaMicros",
  "goalNetContributionDeltaCents",
  "goalCurrentValueDeltaCents",
  "currentValueDeltaCents",
] as const;

export const investmentMovementDocumentSchema = movementBase.superRefine(
  (movement, ctx) => {
    if (movement.status === "pending" || movement.status === "cancelled") {
      for (const field of zeroDeltaFields) {
        // `currentValueDeltaCents` é opcional em documentos históricos;
        // ausente equivale a zero para efeito da invariante.
        if ((movement[field] ?? 0) !== 0) {
          ctx.addIssue({
            code: "custom",
            path: [field],
            message:
              `Movimento ${movement.status} precisa ter todos os deltas em ` +
              "zero: não altera posição, meta nem caixa.",
          });
        }
      }
      if (movement.settledAt !== undefined || movement.settledBy !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["settledAt"],
          message: `Movimento ${movement.status} não pode ter liquidação.`,
        });
      }
    }
    if (movement.status === "settled") {
      if (
        movement.settlementAt === undefined ||
        movement.settledAt === undefined ||
        movement.settledBy === undefined
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["settlementAt"],
          message: "Movimento liquidado precisa de evidência de liquidação.",
        });
      }
    }
    if (movement.status === "cancelled") {
      if (
        movement.cancelledAt === undefined ||
        movement.cancelledBy === undefined
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["cancelledAt"],
          message: "Movimento cancelado precisa registrar autor e instante.",
        });
      }
    }
    if (movement.operation === "reversal" && !movement.reversedMovementId) {
      ctx.addIssue({
        code: "custom",
        path: ["reversedMovementId"],
        message: "Estorno precisa apontar para o movimento original.",
      });
    }
  },
);

export const investmentValuationDocumentSchema = z
  .object({
    ...identity,
    accountId: investmentString(128),
    assetId: investmentString(128),
    currency,
    unitPriceMicros: nonNegativeInt.positive(),
    source: z.enum(["manual", "provider", "import"]),
    effectiveAt: materializedTimestamp,
    correlationId: investmentString(200),
    createdBy: investmentString(128),
    createdAt: timestampLike,
  })
  .strict();

export const investmentImportBatchDocumentSchema = z
  .object({
    ...identity,
    status: z.enum(["pending", "running", "completed", "failed"]),
    source: investmentString(160),
    processedCount: nonNegativeInt,
    failedCount: nonNegativeInt,
    correlationId: investmentString(200),
    createdBy: investmentString(128),
    createdAt: timestampLike,
    updatedAt: timestampLike,
    completedAt: timestampLike.optional(),
  })
  .strict();

type InvestmentDocumentKind =
  | "account"
  | "asset"
  | "movement"
  | "position"
  | "valuation"
  | "importBatch";

const SCHEMAS: Record<InvestmentDocumentKind, z.ZodTypeAny> = {
  account: investmentAccountDocumentSchema,
  asset: investmentAssetDocumentSchema,
  movement: investmentMovementDocumentSchema,
  position: investmentPositionDocumentSchema,
  valuation: investmentValuationDocumentSchema,
  importBatch: investmentImportBatchDocumentSchema,
};

const LABELS: Record<InvestmentDocumentKind, string> = {
  account: "conta de investimento",
  asset: "ativo de investimento",
  movement: "movimento de investimento",
  position: "posição de investimento",
  valuation: "valoração de investimento",
  importBatch: "lote de importação de investimento",
};

/**
 * Valida o documento antes da escrita e devolve o próprio objeto, para uso
 * inline em `transaction.set(ref, assertInvestmentDocument("movement", doc))`.
 *
 * Falha vira `domain_precondition_failed`: é defeito de backend, não payload
 * inválido de cliente — o payload já passou pelo contrato da callable.
 */
export const assertInvestmentDocument = <T extends Record<string, unknown>>(
  kind: InvestmentDocumentKind,
  document: T,
  expectedWorkspaceId?: string,
): T => {
  // Coerência entre o campo `workspaceId` e o path do documento. As Rules não
  // conseguem impor isso numa listagem — regras não são filtros e um predicado
  // sobre `resource.data` em `list` é inavaliável —, então a garantia vive
  // aqui, na escrita, que é a única camada capaz de compará-los.
  if (
    expectedWorkspaceId !== undefined &&
    document.workspaceId !== expectedWorkspaceId
  ) {
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `Documento de ${LABELS[kind]} declara workspace divergente do caminho.`,
      {expected: expectedWorkspaceId, received: String(document.workspaceId)},
    );
  }
  const result = SCHEMAS[kind].safeParse(document);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`)
      .join("; ");
    throw new CreditCardApplicationError(
      "domain_precondition_failed",
      `Documento de ${LABELS[kind]} fora do contrato: ${issues}`,
      {issues},
    );
  }
  return document;
};
