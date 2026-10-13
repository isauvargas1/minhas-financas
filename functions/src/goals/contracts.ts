import {z} from "zod";

/**
 * Contratos das metas (P5-B, D-31).
 *
 * Toda meta tem **uma** fonte de progresso, declarada em `progressSource`:
 *
 * - `manual`: valor informado pelo usuário (`manualProgressCents`), validado
 *   no servidor e alterado só por `updateGoalManualProgress`. Não cria
 *   lançamento, não move conta, não aporta em investimento, não consome
 *   quota.
 * - `investment`: progresso publicado pelo domínio patrimonial a partir das
 *   posições vinculadas (`investmentProgressCents`), na base escolhida em
 *   `progressBasis` (`net_contributions`: aportes líquidos; `current_value`:
 *   valor atual das posições). Ninguém sobrescreve à mão.
 * - `business_kpi` (só PJ): indicador calculado no servidor sobre fontes
 *   oficiais (`getGoalKpiProgress`). Nada é persistido como progresso.
 *
 * Valores monetários em centavos inteiros; margem em pontos-base inteiros
 * (10.000 = 100%). Datas civis `AAAA-MM-DD` (America/Sao_Paulo).
 */

/** Teto de valores de meta: R$ 100 bilhões, bem dentro dos inteiros seguros. */
export const MAX_GOAL_CENTS = 10_000_000_000_000;
/** Margem-alvo: de 0,01% a 100%. */
export const MAX_GOAL_BASIS_POINTS = 10_000;
/** Metas por chamada de indicador PJ (uma página do painel). */
export const MAX_KPI_GOALS_PER_CALL = 25;

const isCivilDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  if (year < 1900 || year > 2999 || month < 1 || month > 12) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
};

export const civilDateSchema = z.string().refine(isCivilDate, "Data inválida.");
const idempotencyKeySchema = z.string()
  .min(16, "Chave de idempotência inválida.")
  .max(200);
const workspaceIdSchema = z.string().min(1, "Workspace obrigatório.").max(1500);
const documentIdSchema = z.string().min(1).max(1500).refine(
  (value) => !value.includes("/") && value !== "." && value !== ".." &&
    !/^__.*__$/.test(value),
  "Identificador inválido.",
);

const positiveCentsSchema = z.number().int("Valor em centavos inválido.")
  .positive("O valor deve ser maior que zero.")
  .max(MAX_GOAL_CENTS, "Valor acima do limite permitido.");
export const nonNegativeCentsSchema = z.number()
  .int("Valor em centavos inválido.")
  .nonnegative("O valor não pode ser negativo.")
  .max(MAX_GOAL_CENTS, "Valor acima do limite permitido.");
const basisPointsTargetSchema = z.number().int("Percentual inválido.")
  .positive("O percentual deve ser maior que zero.")
  .max(MAX_GOAL_BASIS_POINTS, "O percentual não pode passar de 100%.");
const revisionSchema = z.number().int().positive();

export const progressSourceSchema = z.enum([
  "manual",
  "investment",
  "business_kpi",
]);

export const progressBasisSchema = z.enum([
  "net_contributions",
  "current_value",
]);

/**
 * Indicadores PJ. Os identificadores são internos e estáveis; o significado
 * (e o rótulo na interface) é o do regime de caixa realizado:
 *
 * - `faturamento`: recebimentos operacionais realizados no período;
 * - `lucro`: resultado operacional de caixa (recebimentos − despesas
 *   operacionais realizadas) — não é lucro contábil;
 * - `margem`: margem operacional de caixa, em pontos-base;
 * - `caixa_minimo`: saldo disponível em contas (saldo atual, não fluxo);
 * - `reducao_custos`: limite de despesas operacionais no período (consumo do
 *   limite), sem alegar redução percentual.
 */
export const businessKpiTypeSchema = z.enum([
  "faturamento",
  "lucro",
  "margem",
  "caixa_minimo",
  "reducao_custos",
]);

export const businessTypeSchema = z.enum([
  "faturamento",
  "lucro",
  "margem",
  "caixa_minimo",
  "reducao_custos",
  "investimento",
]);

export const goalPeriodSchema = z.enum([
  "mensal",
  "trimestral",
  "semestral",
  "anual",
  "custom",
]);

export const goalStatusSchema = z.enum([
  "em_andamento",
  "alcancada",
  "pausada",
  "cancelada",
]);

const visualSchema = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  icon: z.string().min(1).max(80),
  emoji: z.string().max(16).optional(),
  coverImage: z.string().max(2048).optional(),
  progressBarType: z.enum(["linear", "circular"]),
}).strict();

/**
 * Definição editável da meta. Não carrega status (só `setGoalStatus`), nem
 * progresso manual (criação, troca para manual e `updateGoalManualProgress`),
 * nem campos publicados pelo domínio patrimonial.
 */
export const goalDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  category: z.enum([
    "reserva_emergencia",
    "viagem",
    "veiculo",
    "imovel",
    "eletronicos",
    "educacao",
    "patrimonio",
    "outro",
  ]),
  priority: z.enum(["baixa", "media", "alta"]),
  startDate: civilDateSchema,
  deadline: civilDateSchema,
  horizon: z.enum(["curto", "medio", "longo"]),
  progressSource: progressSourceSchema,
  progressBasis: progressBasisSchema.optional(),
  businessType: businessTypeSchema.optional(),
  period: goalPeriodSchema.optional(),
  costCenter: z.string().trim().max(120).optional(),
  targetAmountCents: positiveCentsSchema.optional(),
  targetBasisPoints: basisPointsTargetSchema.optional(),
  visual: visualSchema,
}).strict().superRefine((goal, context) => {
  const issue = (path: string, message: string) =>
    context.addIssue({code: "custom", path: [path], message});
  if (goal.deadline < goal.startDate) {
    issue(
      "deadline",
      "A data limite deve ser igual ou posterior à data inicial.",
    );
  }
  const isMargin = goal.progressSource === "business_kpi" &&
    goal.businessType === "margem";
  if (isMargin) {
    if (goal.targetBasisPoints === undefined) {
      issue("targetBasisPoints", "Informe a margem-alvo.");
    }
    if (goal.targetAmountCents !== undefined) {
      issue("targetAmountCents", "Meta de margem usa percentual, não valor.");
    }
  } else {
    if (goal.targetAmountCents === undefined) {
      issue("targetAmountCents", "Informe o valor-alvo.");
    }
    if (goal.targetBasisPoints !== undefined) {
      issue("targetBasisPoints", "Percentual só vale para meta de margem.");
    }
  }
  switch (goal.progressSource) {
  case "manual":
    if (goal.progressBasis !== undefined) {
      issue("progressBasis", "Meta manual não usa base de investimentos.");
    }
    if (goal.businessType !== undefined) {
      issue("businessType", "Meta manual não tem indicador automático.");
    }
    if (goal.period !== undefined) {
      issue("period", "Meta manual não tem período de indicador.");
    }
    break;
  case "investment":
    if (goal.progressBasis === undefined) {
      issue(
        "progressBasis",
        "Escolha como medir o progresso dos investimentos.",
      );
    }
    if (
      goal.businessType !== undefined &&
      goal.businessType !== "investimento"
    ) {
      issue(
        "businessType",
        "Meta de investimentos só aceita o tipo investimento.",
      );
    }
    if (goal.period !== undefined) {
      issue("period", "Meta de investimentos não tem período de indicador.");
    }
    break;
  case "business_kpi":
    if (goal.progressBasis !== undefined) {
      issue(
        "progressBasis",
        "Indicador empresarial não usa base de investimentos.",
      );
    }
    if (!goal.businessType || goal.businessType === "investimento") {
      issue("businessType", "Escolha o indicador empresarial.");
    } else if (goal.businessType === "caixa_minimo") {
      if (goal.period !== undefined) {
        issue("period", "Saldo em contas é medido no momento, sem período.");
      }
    } else if (goal.period === undefined) {
      issue("period", "Escolha o período do indicador.");
    }
    break;
  }
});

const baseSchema = z.object({
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const createGoalPayloadSchema = baseSchema.extend({
  goal: goalDefinitionSchema,
  status: goalStatusSchema.default("em_andamento"),
  /** Obrigatório se, e só se, a meta for manual. */
  manualProgressCents: nonNegativeCentsSchema.optional(),
}).strict().superRefine((payload, context) => {
  const manual = payload.goal.progressSource === "manual";
  if (manual && payload.manualProgressCents === undefined) {
    context.addIssue({
      code: "custom",
      path: ["manualProgressCents"],
      message: "Informe o valor já acumulado (pode ser zero).",
    });
  }
  if (!manual && payload.manualProgressCents !== undefined) {
    context.addIssue({
      code: "custom",
      path: ["manualProgressCents"],
      message: "Só metas manuais recebem valor informado.",
    });
  }
});

export const updateGoalPayloadSchema = baseSchema.extend({
  goalId: documentIdSchema,
  expectedRevision: revisionSchema,
  goal: goalDefinitionSchema,
  /**
   * Só na troca de outra fonte para `manual`: o valor inicial da fonte nova.
   * O progresso da fonte anterior nunca é reaproveitado. Fora dessa troca, é
   * recusado (o progresso manual muda por `updateGoalManualProgress`).
   */
  manualProgressCents: nonNegativeCentsSchema.optional(),
}).strict();

export const updateGoalManualProgressPayloadSchema = baseSchema.extend({
  goalId: documentIdSchema,
  expectedRevision: revisionSchema,
  manualProgressCents: nonNegativeCentsSchema,
}).strict();

export const setGoalStatusPayloadSchema = baseSchema.extend({
  goalId: documentIdSchema,
  status: goalStatusSchema,
}).strict();

export const archiveGoalPayloadSchema = baseSchema.extend({
  goalId: documentIdSchema,
  reason: z.string().trim().min(3).max(500),
}).strict();

export const getGoalsOverviewPayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
}).strict();

export const getGoalKpiProgressPayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  goalIds: z.array(documentIdSchema).min(1).max(MAX_KPI_GOALS_PER_CALL)
    .refine((ids) => new Set(ids).size === ids.length, "Metas repetidas."),
}).strict();

export type GoalDefinition = z.infer<typeof goalDefinitionSchema>;
export type GoalStatus = z.infer<typeof goalStatusSchema>;
export type GoalProgressSource = z.infer<typeof progressSourceSchema>;
export type BusinessKpiType = z.infer<typeof businessKpiTypeSchema>;
export type GoalPeriod = z.infer<typeof goalPeriodSchema>;
export type CreateGoalPayload = z.infer<typeof createGoalPayloadSchema>;
export type UpdateGoalPayload = z.infer<typeof updateGoalPayloadSchema>;
export type UpdateGoalManualProgressPayload =
  z.infer<typeof updateGoalManualProgressPayloadSchema>;
export type SetGoalStatusPayload = z.infer<typeof setGoalStatusPayloadSchema>;
export type ArchiveGoalPayload = z.infer<typeof archiveGoalPayloadSchema>;
export type GetGoalsOverviewPayload =
  z.infer<typeof getGoalsOverviewPayloadSchema>;
export type GetGoalKpiProgressPayload =
  z.infer<typeof getGoalKpiProgressPayloadSchema>;
