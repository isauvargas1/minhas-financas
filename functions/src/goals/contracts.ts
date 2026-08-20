import {z} from "zod";

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");
const idempotencyKeySchema = z.string().min(16, "Chave de idempotência inválida.");
const workspaceIdSchema = z.string().min(1, "Workspace obrigatório.");
const documentIdSchema = z.string().min(1).max(1500).refine(
  (value) => !value.includes("/"),
  "Identificador inválido.",
);

export const progressBasisSchema = z.enum([
  "net_contributions",
  "current_value",
]);

export const goalDataSchema = z.object({
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
  status: z.enum(["em_andamento", "alcancada", "pausada", "cancelada"]),
  priority: z.enum(["baixa", "media", "alta"]),
  targetAmount: z.number().finite().positive(),
  startDate: dateOnlySchema,
  deadline: dateOnlySchema,
  horizon: z.enum(["curto", "medio", "longo"]),
  businessType: z.enum([
    "caixa_minimo",
    "faturamento",
    "lucro",
    "margem",
    "reducao_custos",
    "investimento",
  ]).optional(),
  period: z.enum([
    "mensal",
    "trimestral",
    "semestral",
    "anual",
    "custom",
  ]).optional(),
  costCenter: z.string().trim().max(120).optional(),
  isAutomatic: z.boolean().optional(),
  progressBasis: progressBasisSchema.default("net_contributions"),
  currentValue: z.number().finite().nonnegative().optional(),
  visual: z.object({
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    icon: z.string().min(1).max(80),
    emoji: z.string().max(16).optional(),
    coverImage: z.string().max(2048).optional(),
    progressBarType: z.enum(["linear", "circular"]),
  }).strict(),
  profileId: z.string().max(1500).optional(),
}).strict().superRefine((goal, context) => {
  if (goal.deadline < goal.startDate) {
    context.addIssue({
      code: "custom",
      path: ["deadline"],
      message: "A data limite deve ser igual ou posterior à data inicial.",
    });
  }
  if (goal.progressBasis === "current_value" && goal.currentValue === undefined) {
    context.addIssue({
      code: "custom",
      path: ["currentValue"],
      message: "Valor atual obrigatório para esta base de progresso.",
    });
  }
});

const baseSchema = z.object({
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
});

export const createGoalPayloadSchema = baseSchema.extend({
  goal: goalDataSchema,
}).strict();

export const updateGoalPayloadSchema = baseSchema.extend({
  goalId: documentIdSchema,
  goal: goalDataSchema,
}).strict();

export const setGoalLinksPayloadSchema = baseSchema.extend({
  goalId: documentIdSchema,
  transactionIds: z.array(documentIdSchema).max(400),
}).strict();

export const archiveGoalPayloadSchema = baseSchema.extend({
  goalId: documentIdSchema,
  reason: z.string().trim().min(3).max(500),
}).strict();

export const rebuildGoalProgressPayloadSchema = baseSchema.extend({
  goalId: documentIdSchema,
  reason: z.string().trim().min(3).max(500),
}).strict();

const transactionSnapshotSchema = z.object({
  group: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  normalizedLabel: z.string().min(1).max(120),
  icon: z.string().max(80).optional(),
  color: z.string().max(20).optional(),
  stroke: z.number().finite().optional(),
  transactionSubtype: z.string().max(40).optional(),
}).strict();

export const saveGoalContributionPayloadSchema = baseSchema.extend({
  transactionId: documentIdSchema.optional(),
  contribution: z.object({
    goalId: documentIdSchema,
    description: z.string().trim().min(1).max(240),
    category: z.string().trim().min(1).max(120),
    value: z.number().finite().positive(),
    date: dateOnlySchema,
    walletId: z.union([z.string(), z.number()]).transform(String).optional(),
    isPaid: z.boolean(),
    supplier: z.string().trim().max(240).optional(),
    costCenter: z.string().trim().max(120).optional(),
    displaySnapshots: z.object({
      categorySnapshot: transactionSnapshotSchema.optional(),
      walletSnapshot: transactionSnapshotSchema.optional(),
    }).strict().optional(),
  }).strict(),
}).strict();

export const seedLegacyCatalogPayloadSchema = baseSchema.strict();

export type CreateGoalPayload = z.infer<typeof createGoalPayloadSchema>;
export type UpdateGoalPayload = z.infer<typeof updateGoalPayloadSchema>;
export type SetGoalLinksPayload = z.infer<typeof setGoalLinksPayloadSchema>;
export type ArchiveGoalPayload = z.infer<typeof archiveGoalPayloadSchema>;
export type RebuildGoalProgressPayload = z.infer<typeof rebuildGoalProgressPayloadSchema>;
export type SaveGoalContributionPayload = z.infer<typeof saveGoalContributionPayloadSchema>;
export type SeedLegacyCatalogPayload = z.infer<typeof seedLegacyCatalogPayloadSchema>;
