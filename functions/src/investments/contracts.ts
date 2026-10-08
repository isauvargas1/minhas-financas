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
const isoTimestampSchema = z.string().datetime({offset: true});
const descriptionSchema = z.string().trim().min(1).max(240);
const reasonSchema = z.string().trim().min(3).max(500);
/** Referência a item do catálogo do workspace (`settings_catalog`). */
const investmentCatalogRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(hasNoPathSeparator, DOCUMENT_ID_ERROR);

const v2BaseShape = {
  workspaceId: investmentWorkspaceIdSchema,
  idempotencyKey: investmentIdempotencyKeySchema,
  correlationId: investmentCorrelationIdSchema,
};

/**
 * Conta do Caixa (`cash_accounts`, D-30) que o fato liquidado movimenta
 * (P4-D). É sempre escolhida pelo usuário — de onde o aporte saiu, para onde
 * a retirada foi — e conferida no backend: existe no workspace e está ativa.
 * Fato pendente não movimenta conta, então não a recebe: ela é informada na
 * confirmação. O estorno não a recebe nunca: compensa na conta do original.
 */
const cashAccountIdSchema = investmentDocumentIdSchema;

export const CONTRIBUTION_ACCOUNT_REQUIRED_MESSAGE =
  "Escolha a conta de origem do aporte depositado.";
export const WITHDRAWAL_ACCOUNT_REQUIRED_MESSAGE =
  "Escolha a conta de destino da retirada recebida.";
export const PENDING_ACCOUNT_FORBIDDEN_MESSAGE =
  "Lançamento pendente não movimenta conta: a conta é escolhida na " +
  "confirmação.";

/** Fato liquidado exige a conta; pendente a recusa. */
const refineCashAccount = (
  settled: boolean,
  cashAccountId: string | undefined,
  requiredMessage: string,
  context: z.RefinementCtx,
): void => {
  if (settled && !cashAccountId) {
    context.addIssue({
      code: "custom",
      path: ["cashAccountId"],
      message: requiredMessage,
    });
  }
  if (!settled && cashAccountId !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["cashAccountId"],
      message: PENDING_ACCOUNT_FORBIDDEN_MESSAGE,
    });
  }
};

/**
 * Liquidação de um aporte pendente.
 *
 * Não recebe valores: o aporte pendente já fixou principal, taxas, imposto e
 * quantidade na criação, e alterá-los na liquidação seria editar um fato
 * financeiro por uma porta lateral. O que a liquidação acrescenta é a data em
 * que o dinheiro efetivamente saiu e a conta de onde ele saiu.
 */
export const settleInvestmentContributionPayloadSchema = z
  .object({
    ...v2BaseShape,
    movementId: investmentDocumentIdSchema,
    settledAt: isoTimestampSchema,
    cashAccountId: cashAccountIdSchema,
  })
  .strict();

/**
 * Novo investimento no modo simples.
 *
 * Carteira, instituição e categoria vêm do catálogo do workspace por ID; a
 * conta e o ativo técnicos são criados pelo backend, na mesma transação do
 * aporte. Nada de quantidade, preço unitário ou enum técnico de ativo. O
 * aporte depositado (`settled`) exige a conta de origem (`cashAccountId`).
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
    cashAccountId: cashAccountIdSchema.optional(),
    /**
     * Aporte **pendente** que este lançamento substitui (correção do §11).
     *
     * Editar um pendente é cancelar a intenção anterior e abrir outra. Fazê-lo
     * em duas callables deixava a substituição sem atomicidade: o cancelamento
     * respondia, a criação era recusada — categoria inativada no cadastro
     * depois do lançamento, por exemplo — e o usuário perdia o pendente por
     * ter tentado corrigir outro campo. Declarado aqui, o par cancelar/criar
     * acontece na mesma transação: ou os dois valem, ou nenhum.
     *
     * É também o único contexto em que a categoria já vinculada ao pendente
     * pode ser preservada mesmo inativa — nunca a escolha de outra.
     */
    replacesMovementId: investmentDocumentIdSchema.optional(),
  })
  .strict()
  .superRefine((values, context) => {
    refineCashAccount(values.settled, values.cashAccountId,
      CONTRIBUTION_ACCOUNT_REQUIRED_MESSAGE, context);
  });

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
 *   ganho realizado (resultado financeiro, nunca receita operacional). A conta
 *   de destino recebe o total.
 *
 * Taxas e imposto não fazem parte do produto e **não** são inventados. A
 * retirada recebida (`received`) exige a conta de destino (`cashAccountId`).
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
    cashAccountId: cashAccountIdSchema.optional(),
  })
  .strict()
  .superRefine((values, context) => {
    refineCashAccount(values.received, values.cashAccountId,
      WITHDRAWAL_ACCOUNT_REQUIRED_MESSAGE, context);
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
 * dinheiro entrou e a conta em que ele entrou. Os componentes são revalidados
 * contra a posição no instante em que os efeitos são aplicados.
 */
export const settleSimpleWithdrawalPayloadSchema = z
  .object({
    ...v2BaseShape,
    movementId: investmentDocumentIdSchema,
    settledAt: isoTimestampSchema,
    cashAccountId: cashAccountIdSchema,
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

export const cancelInvestmentMovementPayloadSchema = z
  .object({
    ...v2BaseShape,
    movementId: investmentDocumentIdSchema,
    occurredAt: isoTimestampSchema,
    reason: reasonSchema,
  })
  .strict();

/**
 * Payloads com os campos de default marcados como opcionais.
 *
 * `z.infer` devolve o tipo de **saída** do schema, em que um campo com default
 * é obrigatório. A callable sempre entrega o payload já parseado e satisfaz
 * isso; os testes de integração chamam o executor direto e não deveriam ser
 * obrigados a repetir o default — o executor lê `payload.settled !== false` e
 * `payload.received !== false`.
 */
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
export type CancelInvestmentMovementPayload = z.infer<
  typeof cancelInvestmentMovementPayloadSchema
>;
