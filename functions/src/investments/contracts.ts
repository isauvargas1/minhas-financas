import {z} from "zod";

/**
 * Um identificador de documento não pode conter "/": a barra transformaria o
 * valor num caminho e faria a referência apontar para fora da coleção
 * pretendida — ou quebrar com erro de infraestrutura em vez de erro de
 * domínio, quando o número de segmentos fica ímpar.
 */
const DOCUMENT_ID_ERROR = "Identificador inválido.";
const hasNoPathSeparator = (value: string): boolean => !value.includes("/");

export const investmentDocumentIdSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(hasNoPathSeparator, DOCUMENT_ID_ERROR);
export const investmentWorkspaceIdSchema = investmentDocumentIdSchema;
export const investmentIdempotencyKeySchema = z.string().min(16).max(200);
export const investmentCorrelationIdSchema = z.string().min(8).max(200);
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
/** Referência a item do catálogo do workspace (`settings_catalog`). */
const investmentCatalogRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(hasNoPathSeparator, DOCUMENT_ID_ERROR);
const catalogLabelSchema = z.string().trim().min(1).max(160);

const v2BaseShape = {
  workspaceId: investmentWorkspaceIdSchema,
  idempotencyKey: investmentIdempotencyKeySchema,
  correlationId: investmentCorrelationIdSchema,
};

/**
 * Valores de uma liquidação de resgate.
 *
 * ## Perda realizada (INV-P1-009)
 *
 * `gainCents` continua não-negativo e ganha um irmão explícito, `lossCents`.
 * A alternativa considerada foi transformar `gainCents` num
 * `realizedResultCents` com sinal; ela foi descartada porque mudaria o
 * significado de um campo **já persistido** em movimentos, posições, períodos,
 * validadores das Rules, trilha legada e migração — e, depois da mudança, um
 * `0` histórico seria indistinguível entre "sem ganho" e "campo ainda não
 * existia". Com o campo adicional, todo documento antigo continua significando
 * exatamente o que significava, e o resultado com sinal é derivado onde for
 * preciso: `realizedResult = realizedGain − realizedLoss`.
 *
 * Semântica dos campos numa liquidação:
 *
 * - `principalCents` — custo de aquisição **retirado da posição**;
 * - `gainCents` — resultado positivo, acima do custo;
 * - `lossCents` — resultado negativo, abaixo do custo;
 * - caixa recebido = `principal + ganho − perda − taxas − imposto`.
 *
 * Antes desta correção, um resgate integral abaixo do custo só podia ser
 * lançado reduzindo o `principalCents` da liquidação — o que zerava a
 * quantidade e deixava principal fantasma permanente na posição, somado ao
 * patrimônio e às 8 faixas de alocação, irrecuperável por reconstrução.
 */
const financialAmountsSchema = z
  .object({
    principalCents: positiveCentsSchema,
    quantityMicros: quantityMicrosSchema,
    gainCents: centsSchema.default(0),
    lossCents: centsSchema.default(0),
    feesCents: centsSchema.default(0),
    taxCents: centsSchema.default(0),
  })
  .strict()
  .superRefine((values, context) => {
    // Ganho e perda são mutuamente exclusivos: o resultado realizado de uma
    // liquidação tem um sinal só. Aceitar os dois permitiria compensá-los e
    // esconder a magnitude real de cada um no relatório.
    if (values.gainCents > 0 && values.lossCents > 0) {
      context.addIssue({
        code: "custom",
        path: ["lossCents"],
        message:
          "Uma liquidação tem ganho ou perda realizada, nunca os dois.",
      });
    }
    if (values.lossCents > values.principalCents) {
      context.addIssue({
        code: "custom",
        path: ["lossCents"],
        message: "A perda realizada não pode superar o custo resgatado.",
      });
    }
    if (values.taxCents > values.gainCents) {
      context.addIssue({
        code: "custom",
        path: ["taxCents"],
        message: "O imposto não pode superar o ganho realizado.",
      });
    }
    if (
      values.feesCents + values.taxCents >
      values.principalCents + values.gainCents - values.lossCents
    ) {
      context.addIssue({
        code: "custom",
        path: ["feesCents"],
        message: "Taxas e impostos devem ser menores que o valor bruto.",
      });
    }
  });

/**
 * Aporte em um investimento **já existente**.
 *
 * Etapa 1 acrescentou três coisas, todas retrocompatíveis:
 *
 * - **alvo por `positionId`**: a interface simples identifica o investimento
 *   por um identificador opaco só dele, sem precisar entender que por baixo
 *   existem uma conta e um ativo técnicos. O par `accountId`/`assetId`
 *   continua aceito e é o que todo chamador existente usa.
 * - **`quantityMicros` opcional**: obrigatório no regime por quantidade,
 *   derivado do custo no regime por valor. Quem já informava continua
 *   informando.
 * - **`settled`**: `false` cria o aporte pendente, sem nenhum efeito
 *   financeiro. O default é `true`, que é o comportamento anterior.
 */
export const createInvestmentContributionPayloadSchema = z
  .object({
    ...v2BaseShape,
    accountId: investmentDocumentIdSchema.optional(),
    assetId: investmentDocumentIdSchema.optional(),
    positionId: investmentDocumentIdSchema.optional(),
    goalId: investmentDocumentIdSchema.optional(),
    walletId: investmentDocumentIdSchema.optional(),
    // Procedência: vincula o aporte a um lote de importação aberto.
    importBatchId: investmentDocumentIdSchema.optional(),
    description: descriptionSchema,
    principalCents: positiveCentsSchema,
    quantityMicros: quantityMicrosSchema.optional(),
    feesCents: centsSchema.default(0),
    taxCents: centsSchema.default(0),
    settled: z.boolean().default(true),
    occurredAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((values, context) => {
    const hasPair = Boolean(values.accountId && values.assetId);
    const hasPosition = Boolean(values.positionId);
    if (hasPair === hasPosition) {
      context.addIssue({
        code: "custom",
        path: ["positionId"],
        message:
          "Informe o investimento por positionId ou pelo par " +
          "accountId/assetId, nunca pelos dois nem por nenhum.",
      });
    }
    if (!hasPair && (values.accountId || values.assetId)) {
      context.addIssue({
        code: "custom",
        path: ["assetId"],
        message: "accountId e assetId precisam ser informados juntos.",
      });
    }
  });

/**
 * Liquidação de um aporte pendente.
 *
 * Não recebe valores: o aporte pendente já fixou principal, taxas, imposto e
 * quantidade na criação, e alterá-los na liquidação seria editar um fato
 * financeiro por uma porta lateral. O que a liquidação acrescenta é a data em
 * que o dinheiro efetivamente saiu.
 */
export const settleInvestmentContributionPayloadSchema = z
  .object({
    ...v2BaseShape,
    movementId: investmentDocumentIdSchema,
    settledAt: isoTimestampSchema,
  })
  .strict();

/**
 * Novo investimento no modo simples.
 *
 * Carteira, instituição e categoria vêm do catálogo do workspace por ID; a
 * conta e o ativo técnicos são criados pelo backend, na mesma transação do
 * aporte. Nada de quantidade, preço unitário ou enum técnico de ativo.
 */
export const createSimpleInvestmentPayloadSchema = z
  .object({
    ...v2BaseShape,
    institutionId: investmentCatalogRefSchema,
    classId: investmentCatalogRefSchema,
    typeId: investmentCatalogRefSchema,
    description: descriptionSchema,
    valueCents: positiveCentsSchema,
    settled: z.boolean().default(true),
    occurredAt: isoTimestampSchema,
    goalId: investmentDocumentIdSchema.optional(),
    walletId: investmentDocumentIdSchema.optional(),
  })
  .strict();

/**
 * Retirada no modo simples.
 *
 * O usuário informa sempre o **valor total retirado**, a data e se o dinheiro
 * já foi recebido. `gainCents` é a única informação opcional: quanto desse
 * total é rendimento.
 *
 * - **Sem `gainCents`** — comportamento conservador: o total inteiro é
 *   principal, e uma retirada acima do capital aplicado é recusada. O sistema
 *   não adivinha rendimento.
 * - **Com `gainCents`** — `principalCents = valueCents − gainCents`. Só o
 *   componente de principal reduz o capital investido; o rendimento entra no
 *   ganho realizado, que é a semântica que o domínio já usa em
 *   `settleInvestmentRedemption`. O caixa recebe o total.
 *
 * Taxas e imposto continuam fora da UX simples e **não** são inventados: quem
 * precisa lançá-los usa o resgate detalhado.
 */
export const withdrawSimpleInvestmentPayloadSchema = z
  .object({
    ...v2BaseShape,
    positionId: investmentDocumentIdSchema,
    valueCents: positiveCentsSchema,
    /** Parcela do total retirado que é rendimento. Zero quando ausente. */
    gainCents: centsSchema.optional(),
    received: z.boolean().default(true),
    occurredAt: isoTimestampSchema,
    description: descriptionSchema.optional(),
    walletId: investmentDocumentIdSchema.optional(),
  })
  .strict()
  .superRefine((values, context) => {
    if ((values.gainCents ?? 0) > values.valueCents) {
      context.addIssue({
        code: "custom",
        path: ["gainCents"],
        message:
          "O rendimento informado não pode superar o valor total retirado.",
      });
    }
  });

/**
 * Liquidação de uma retirada simples pendente.
 *
 * Como na liquidação do aporte, não recebe valores: total e rendimento já
 * foram fixados no pedido. O que a liquidação acrescenta é a data em que o
 * dinheiro entrou. Os componentes são revalidados contra a posição no instante
 * em que os efeitos são aplicados.
 */
export const settleSimpleWithdrawalPayloadSchema = z
  .object({
    ...v2BaseShape,
    movementId: investmentDocumentIdSchema,
    settledAt: isoTimestampSchema,
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

/**
 * Troca de meta de uma posição (INV-P2-028).
 *
 * Existe como operação própria, e não como duas chamadas do cliente, porque
 * desvincular e vincular precisam ser **atômicos**: uma falha entre as duas
 * etapas deixaria a posição sem meta e o progresso das duas metas errado, sem
 * nenhuma trilha explicando o estado.
 */
export const changeInvestmentGoalPayloadSchema = z
  .object({
    ...v2BaseShape,
    accountId: investmentDocumentIdSchema,
    assetId: investmentDocumentIdSchema,
    goalId: investmentDocumentIdSchema,
    previousGoalId: investmentDocumentIdSchema,
    occurredAt: isoTimestampSchema,
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

export const rebuildInvestmentProjectionsPayloadSchema = rebuildSchema.strict();

export const backfillInvestmentWorkspacePayloadSchema = z
  .object({
    ...v2BaseShape,
    backfillId: investmentDocumentIdSchema.optional(),
    pageSize: z.number().int().min(1).max(100).default(20),
    reason: reasonSchema,
  })
  .strict();

export const cancelInvestmentMovementPayloadSchema = z
  .object({
    ...v2BaseShape,
    movementId: investmentDocumentIdSchema,
    occurredAt: isoTimestampSchema,
    reason: reasonSchema,
  })
  .strict();

export const recordInvestmentValuationPayloadSchema = z
  .object({
    ...v2BaseShape,
    assetId: investmentDocumentIdSchema,
    accountId: investmentDocumentIdSchema,
    unitPriceMicros: quantityMicrosSchema,
    source: z.enum(["manual", "provider", "import"]).default("manual"),
    effectiveAt: isoTimestampSchema,
    reason: reasonSchema,
  })
  .strict();

export const registerInvestmentImportBatchPayloadSchema = z
  .object({
    ...v2BaseShape,
    batchId: investmentDocumentIdSchema.optional(),
    source: z.string().trim().min(2).max(160),
    status: z
      .enum(["pending", "running", "completed", "failed"])
      .default("pending"),
    processedCount: centsSchema.default(0),
    failedCount: centsSchema.default(0),
    reason: reasonSchema,
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
    // Vínculo estável com o item de catálogo da instituição (Etapa 1).
    institutionId: investmentCatalogRefSchema.optional(),
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
    allocationPurpose: z.enum([
      "unassigned",
      "retirement",
      "goal",
      "reserve",
      "financial_application",
      "reinvestment",
      "fixed_asset",
    ]).optional(),
    // INV-P2-026 — classe, risco, liquidez e indexador.
    //
    // As quatro dimensões existiam em `allocationDescriptors` e no catálogo
    // semeado pelo onboarding, mas nenhum ativo podia referenciá-las: os
    // painéis correspondentes ficavam permanentemente vazios, com a faixa
    // "Não informado" concentrando 100% do patrimônio.
    //
    // O par `id`/`name` é gravado junto: o ID vincula ao item de catálogo e o
    // nome é fotografado no ativo, para que renomear ou inativar um item do
    // catálogo não apague o rótulo histórico da faixa de alocação.
    classId: investmentCatalogRefSchema.optional(),
    className: catalogLabelSchema.optional(),
    riskId: investmentCatalogRefSchema.optional(),
    riskName: catalogLabelSchema.optional(),
    liquidityId: investmentCatalogRefSchema.optional(),
    liquidityName: catalogLabelSchema.optional(),
    indexerId: investmentCatalogRefSchema.optional(),
    indexerName: catalogLabelSchema.optional(),
    // Etapa 1 — categoria por catálogo (`investment_type`) e regime de
    // acompanhamento. `trackingMode` ausente permanece `"quantity"`.
    typeId: investmentCatalogRefSchema.optional(),
    typeName: catalogLabelSchema.optional(),
    trackingMode: z.enum(["value", "quantity"]).optional(),
  })
  .strict();

export const onboardInvestmentWorkspacePayloadSchema = z
  .object(v2BaseShape)
  .strict();

/**
 * Payload do aporte com os campos de default marcados como opcionais.
 *
 * `z.infer` devolve o tipo de **saída** do schema, em que um campo com default
 * é obrigatório. A callable sempre entrega o payload já parseado e satisfaz
 * isso; os testes de integração e os caminhos operacionais chamam o executor
 * direto e não deveriam ser obrigados a repetir o default. Marcar `settled`
 * como opcional aqui mantém as duas portas de entrada com o mesmo
 * comportamento — o executor lê `payload.settled !== false`.
 */
export type CreateInvestmentContributionPayload = Omit<
  z.infer<typeof createInvestmentContributionPayloadSchema>,
  "settled"
> & {settled?: boolean};
export type SettleInvestmentContributionPayload = z.infer<
  typeof settleInvestmentContributionPayloadSchema
>;
export type CreateSimpleInvestmentPayload = Omit<
  z.infer<typeof createSimpleInvestmentPayloadSchema>,
  "settled"
> & {settled?: boolean};
export type WithdrawSimpleInvestmentPayload = Omit<
  z.infer<typeof withdrawSimpleInvestmentPayloadSchema>,
  "received"
> & {received?: boolean};
export type SettleSimpleWithdrawalPayload = z.infer<
  typeof settleSimpleWithdrawalPayloadSchema
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
export type ChangeInvestmentGoalPayload = z.infer<
  typeof changeInvestmentGoalPayloadSchema
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

export type CancelInvestmentMovementPayload = z.infer<
  typeof cancelInvestmentMovementPayloadSchema
>;
export type RecordInvestmentValuationPayload = z.infer<
  typeof recordInvestmentValuationPayloadSchema
>;
export type RegisterInvestmentImportBatchPayload = z.infer<
  typeof registerInvestmentImportBatchPayloadSchema
>;
export type RebuildInvestmentProjectionsPayload = z.infer<
  typeof rebuildInvestmentProjectionsPayloadSchema
>;
export type BackfillInvestmentWorkspacePayload = z.infer<
  typeof backfillInvestmentWorkspacePayloadSchema
>;
