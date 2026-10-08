import {z} from "zod";

import {isIsoInstant} from "../shared/commitTime";
import {
  correlationIdSchema,
  hasControlCharacter,
  idempotencyKeySchema,
  settingsCatalogItemIdSchema,
  workspaceIdSchema,
} from "../shared/ids";
import {
  CATALOG_COLOR_PATTERN,
  CATALOG_ICON_PATTERN,
  CATEGORY_TRANSACTION_SUBTYPES,
  SETTINGS_CATALOG_GROUPS,
  SETTINGS_CATALOG_NAME_MAX_LENGTH,
  SETTINGS_CATALOG_SORT_ORDER_MAX,
  SETTINGS_CATALOG_STROKE_MAX,
  SETTINGS_CATALOG_STROKE_MIN,
  isCatalogStroke,
} from "./model";

/**
 * Contratos das callables do catálogo (D-23, P4-E).
 *
 * Todos `.strict()`: campo desconhecido é recusado. Nada que é autoritativo
 * vem do cliente — escopo PF/PJ, nome normalizado, chave de unicidade,
 * autoria, timestamps e IDs. O grupo e o subtipo da categoria só existem na
 * criação; depois são imutáveis (o renomear troca só o nome).
 */
const nameSchema = z.string()
  .transform((value) => value.trim())
  .pipe(z.string()
    .min(1, "Nome do cadastro: valor obrigatório.")
    .max(SETTINGS_CATALOG_NAME_MAX_LENGTH,
      `Nome do cadastro: até ${SETTINGS_CATALOG_NAME_MAX_LENGTH} caracteres.`)
    .refine((value) => !hasControlCharacter(value),
      "Nome do cadastro: inválido."));

const groupSchema = z.enum(SETTINGS_CATALOG_GROUPS, {
  message: "Grupo do cadastro: inválido.",
});

const transactionSubtypeSchema = z.enum(CATEGORY_TRANSACTION_SUBTYPES, {
  message: "Tipo de transação: use receita, despesa ou investimento.",
});

const iconSchema = z.string()
  .max(80, "Ícone: inválido.")
  .regex(CATALOG_ICON_PATTERN, "Ícone: inválido.");

const colorSchema = z.string()
  .max(7, "Cor: use o formato #RGB ou #RRGGBB.")
  .regex(CATALOG_COLOR_PATTERN, "Cor: use o formato #RGB ou #RRGGBB.");

const strokeSchema = z.number()
  .refine(isCatalogStroke,
    `Espessura do ícone: de ${SETTINGS_CATALOG_STROKE_MIN} a ` +
    `${SETTINGS_CATALOG_STROKE_MAX}, em passos de 0,5.`);

const sortOrderSchema = z.number()
  .int("Ordenação: número inteiro.")
  .min(0, "Ordenação: não pode ser negativa.")
  .max(SETTINGS_CATALOG_SORT_ORDER_MAX, "Ordenação: acima do máximo.");

const statusSchema = z.enum(["active", "inactive"], {
  message: "Status: inválido.",
});

/** Versão lida pelo cliente: `updatedAt`, ISO-8601 com nanossegundos. */
const versionSchema = z.string()
  .max(40, "Versão do cadastro: formato inválido.")
  .refine(isIsoInstant, "Versão do cadastro: formato inválido.");

const baseFields = {
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
  correlationId: correlationIdSchema.optional(),
};

export const createSettingsCatalogItemPayloadSchema = z.object({
  ...baseFields,
  group: groupSchema,
  name: nameSchema,
  transactionSubtype: transactionSubtypeSchema.optional(),
  icon: iconSchema.optional(),
  color: colorSchema.optional(),
  stroke: strokeSchema.optional(),
  sortOrder: sortOrderSchema.optional(),
  /** O formulário permite cadastrar já inativo; o padrão é ativo. */
  status: statusSchema.optional(),
}).strict().superRefine((payload, context) => {
  const isCategory = payload.group === "category";
  if (isCategory && payload.transactionSubtype === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transactionSubtype"],
      message: "Tipo de transação: obrigatório para categorias.",
    });
  }
  if (!isCategory && payload.transactionSubtype !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transactionSubtype"],
      message: "Tipo de transação: só categorias têm tipo.",
    });
  }
  if (
    payload.icon === undefined &&
    (payload.color !== undefined || payload.stroke !== undefined)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["icon"],
      message: "Cor e espessura: só com um ícone escolhido.",
    });
  }
});

export type CreateSettingsCatalogItemPayload =
  z.infer<typeof createSettingsCatalogItemPayloadSchema>;

const itemMutationFields = {
  ...baseFields,
  itemId: settingsCatalogItemIdSchema,
  expectedUpdatedAt: versionSchema,
};

/**
 * Edição: nome (renomear), aparência, ordenação e status (inativar ou
 * reativar). `null` limpa o ícone, a cor ou a espessura; sem ícone, cor e
 * espessura saem junto. Grupo, subtipo e escopo não são editáveis.
 */
export const updateSettingsCatalogItemPayloadSchema = z.object({
  ...itemMutationFields,
  changes: z.object({
    name: nameSchema.optional(),
    icon: iconSchema.nullable().optional(),
    color: colorSchema.nullable().optional(),
    stroke: strokeSchema.nullable().optional(),
    sortOrder: sortOrderSchema.optional(),
    status: statusSchema.optional(),
  }).strict().refine(
    (changes) => Object.keys(changes).length > 0,
    "Informe ao menos um campo para alterar.",
  ),
}).strict();

export type UpdateSettingsCatalogItemPayload =
  z.infer<typeof updateSettingsCatalogItemPayloadSchema>;

export const archiveSettingsCatalogItemPayloadSchema = z.object({
  ...itemMutationFields,
}).strict();

export type ArchiveSettingsCatalogItemPayload =
  z.infer<typeof archiveSettingsCatalogItemPayloadSchema>;

// --------------------------------------------------------------- resultados

export interface SettingsCatalogMutationResult extends Record<string, unknown> {
  itemId: string;
  status: "active" | "inactive";
  changed?: boolean;
  replayed: boolean;
}
