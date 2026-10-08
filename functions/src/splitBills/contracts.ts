import {z} from "zod";

import {CASH_ENTRY_MIN_DAY} from "../cash/contracts";
import {isIsoInstant} from "../shared/commitTime";
import {
  cashAccountIdSchema,
  correlationIdSchema,
  creditCardIdSchema,
  hasControlCharacter,
  idempotencyKeySchema,
  memberIdSchema,
  splitBillIdSchema,
  splitGroupIdSchema,
  splitInviteIdSchema,
  splitParticipantIdSchema,
  splitReimbursementIdSchema,
  splitShareIdSchema,
  workspaceIdSchema,
} from "../shared/ids";
import {isMoneyCents} from "../shared/money";
import {allocationIssue} from "./allocation";
import {
  SPLIT_ALLOCATION_METHODS,
  SPLIT_ASSIGNABLE_ROLES,
  SPLIT_BUSINESS_MODES,
  SPLIT_COLOR_PATTERN,
  SPLIT_FINANCIAL_INTEGRATIONS,
  SPLIT_GROUP_TYPES,
  SPLIT_ICON_PATTERN,
  SPLIT_LIMITS,
  SPLIT_MAX_CENTS,
} from "./model";

/**
 * Contratos das callables da Divisão de contas (P4-C, D-14).
 *
 * Estritos: nenhum campo autoritativo vem do cliente — dono, papel `owner`,
 * `createdBy`, estado, valores dos rateios, `purchaseId`, `transactionId`,
 * `userId` como autoridade ou `userName`. Valores em centavos inteiros;
 * percentuais em basis points; datas civis `AAAA-MM-DD`.
 */
export const SPLIT_TEXT_LIMITS = {
  groupName: 80,
  groupDescription: 300,
  externalName: 60,
  billDescription: 120,
  category: 80,
  emoji: 16,
  reason: 140,
} as const;

/** Alfabeto sem caracteres ambíguos; o código é ditado e digitado à mão. */
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 10;
const INVITE_CODE_PATTERN = new RegExp(
  `^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

const checkedText = (label: string, maxLength: number) =>
  z.string()
    .min(1, `${label}: valor obrigatório.`)
    .max(maxLength, `${label}: até ${maxLength} caracteres.`)
    .refine((value) => !hasControlCharacter(value), `${label}: inválido.`);

const textSchema = (label: string, maxLength: number) =>
  z.string()
    .transform((value) => value.trim().replace(/\s+/g, " "))
    .pipe(checkedText(label, maxLength));

/** Texto opcional: vazio (ou só espaços) vale `null`. */
const optionalTextSchema = (label: string, maxLength: number) =>
  z.union([z.string(), z.null()])
    .transform((value) => (value === null ? null :
      value.trim().replace(/\s+/g, " ") || null))
    .pipe(z.union([checkedText(label, maxLength), z.null()]));

const amountSchema = (label: string) => z.number()
  .refine(isMoneyCents, `${label}: centavos inteiros.`)
  .refine((value) => value > 0, `${label}: deve ser maior que zero.`)
  .refine((value) => value <= SPLIT_MAX_CENTS,
    `${label}: acima do máximo permitido.`);

const DAY_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isExistingDay = (value: string): boolean => {
  if (!DAY_KEY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
};

/**
 * Data civil existente, desde 2000. "Não futura" é conferida no servidor
 * contra o relógio de São Paulo (as operações recebem o relógio injetável).
 */
const civilDaySchema = (label: string) => z.string()
  .refine(isExistingDay, `${label}: use AAAA-MM-DD com uma data existente.`)
  .refine((value) => value >= CASH_ENTRY_MIN_DAY, `${label}: anterior a 2000.`);

const versionSchema = z.string()
  .refine(isIsoInstant, "Versão: formato inválido.");

const visualSchema = z.object({
  color: z.string().regex(SPLIT_COLOR_PATTERN, "Cor: inválida."),
  icon: z.string().regex(SPLIT_ICON_PATTERN, "Ícone: inválido."),
  emoji: optionalTextSchema("Emoji", SPLIT_TEXT_LIMITS.emoji),
}).strict();

const baseFields = {
  workspaceId: workspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
  correlationId: correlationIdSchema.optional(),
};

// ------------------------------------------------------------------ grupo

export const createSplitGroupPayloadSchema = z.object({
  ...baseFields,
  name: textSchema("Nome do grupo", SPLIT_TEXT_LIMITS.groupName),
  description: optionalTextSchema("Descrição",
    SPLIT_TEXT_LIMITS.groupDescription),
  groupType: z.enum(SPLIT_GROUP_TYPES,
    {message: "Tipo do grupo: escolha fixo ou temporário."}),
  businessMode: z.enum(SPLIT_BUSINESS_MODES,
    {message: "Modo do grupo: escolha rateio ou reembolso."}),
  visual: visualSchema,
}).strict();
export type CreateSplitGroupPayload =
  z.infer<typeof createSplitGroupPayloadSchema>;

export const updateSplitGroupPayloadSchema = z.object({
  ...baseFields,
  groupId: splitGroupIdSchema,
  expectedUpdatedAt: versionSchema,
  changes: z.object({
    name: textSchema("Nome do grupo", SPLIT_TEXT_LIMITS.groupName).optional(),
    description: optionalTextSchema("Descrição",
      SPLIT_TEXT_LIMITS.groupDescription).optional(),
    groupType: z.enum(SPLIT_GROUP_TYPES,
      {message: "Tipo do grupo: escolha fixo ou temporário."}).optional(),
    visual: visualSchema.optional(),
  }).strict().refine((changes) => Object.keys(changes).length > 0,
    "Nenhuma alteração para salvar."),
}).strict();
export type UpdateSplitGroupPayload =
  z.infer<typeof updateSplitGroupPayloadSchema>;

export const groupLifecyclePayloadSchema = z.object({
  ...baseFields,
  groupId: splitGroupIdSchema,
  expectedUpdatedAt: versionSchema,
}).strict();
export type GroupLifecyclePayload = z.infer<typeof groupLifecyclePayloadSchema>;

// ---------------------------------------------------- convite e participantes

export const createSplitInvitePayloadSchema = z.object({
  ...baseFields,
  groupId: splitGroupIdSchema,
  role: z.enum(SPLIT_ASSIGNABLE_ROLES,
    {message: "Papel do convite: participante ou visualizador."}),
}).strict();
export type CreateSplitInvitePayload =
  z.infer<typeof createSplitInvitePayloadSchema>;

export const revokeSplitInvitePayloadSchema = z.object({
  ...baseFields,
  groupId: splitGroupIdSchema,
  inviteId: splitInviteIdSchema,
}).strict();
export type RevokeSplitInvitePayload =
  z.infer<typeof revokeSplitInvitePayloadSchema>;

/** Aceite: só o código. O nome nunca vem do payload (PR-SPLIT-04). */
export const acceptSplitInvitePayloadSchema = z.object({
  ...baseFields,
  code: z.string()
    .transform((value) => value.replace(/[\s-]/g, "").toUpperCase())
    .pipe(z.string().regex(INVITE_CODE_PATTERN, "Código do convite inválido.")),
}).strict();
export type AcceptSplitInvitePayload =
  z.infer<typeof acceptSplitInvitePayloadSchema>;

export const addWorkspaceParticipantPayloadSchema = z.object({
  ...baseFields,
  groupId: splitGroupIdSchema,
  userId: memberIdSchema,
  role: z.enum(SPLIT_ASSIGNABLE_ROLES,
    {message: "Papel no grupo: participante ou visualizador."}),
}).strict();
export type AddWorkspaceParticipantPayload =
  z.infer<typeof addWorkspaceParticipantPayloadSchema>;

export const addExternalParticipantPayloadSchema = z.object({
  ...baseFields,
  groupId: splitGroupIdSchema,
  displayName: textSchema("Nome do participante",
    SPLIT_TEXT_LIMITS.externalName),
}).strict();
export type AddExternalParticipantPayload =
  z.infer<typeof addExternalParticipantPayloadSchema>;

export const deactivateParticipantPayloadSchema = z.object({
  ...baseFields,
  groupId: splitGroupIdSchema,
  participantId: splitParticipantIdSchema,
  expectedUpdatedAt: versionSchema,
}).strict();
export type DeactivateParticipantPayload =
  z.infer<typeof deactivateParticipantPayloadSchema>;

// ----------------------------------------------------------------- título

const shareInputSchema = z.object({
  participantId: splitParticipantIdSchema,
  weightBps: z.number().nullable().optional(),
  amountCents: z.number().nullable().optional(),
}).strict();

const termsFields = {
  amountCents: amountSchema("Valor"),
  expenseDate: civilDaySchema("Data"),
  payerParticipantId: splitParticipantIdSchema,
  allocationMethod: z.enum(SPLIT_ALLOCATION_METHODS,
    {message: "Método de divisão: igual, percentual ou valor fixo."}),
  participants: z.array(shareInputSchema)
    .min(1, "Escolha pelo menos um participante.")
    .max(SPLIT_LIMITS.sharesPerBill,
      `No máximo ${SPLIT_LIMITS.sharesPerBill} participantes por título.`),
  financialIntegration: z.enum(SPLIT_FINANCIAL_INTEGRATIONS,
    {message: "Integração: nenhuma, Caixa ou Cartão."}),
  cashAccountId: cashAccountIdSchema.nullable(),
  cardId: creditCardIdSchema.nullable(),
  installmentsCount: z.number().nullable(),
};

type TermsShape = {
  amountCents: number;
  allocationMethod: (typeof SPLIT_ALLOCATION_METHODS)[number];
  participants: {participantId: string; weightBps?: number | null;
    amountCents?: number | null}[];
  financialIntegration: (typeof SPLIT_FINANCIAL_INTEGRATIONS)[number];
  cashAccountId: string | null;
  cardId: string | null;
  installmentsCount: number | null;
};

/** Coerência dos termos financeiros: rateio exato e destino da integração. */
export const termsIssues = (
  terms: TermsShape,
): {path: string; message: string}[] => {
  const issues: {path: string; message: string}[] = [];
  const allocation = allocationIssue({
    amountCents: terms.amountCents,
    method: terms.allocationMethod,
    participants: terms.participants,
  });
  if (allocation) issues.push({path: "participants", message: allocation});
  if (terms.financialIntegration === "cash") {
    if (!terms.cashAccountId) {
      issues.push({path: "cashAccountId",
        message: "Escolha a conta de onde saiu o pagamento."});
    }
    if (terms.cardId !== null || terms.installmentsCount !== null) {
      issues.push({path: "cardId",
        message: "Pagamento pelo Caixa não leva cartão nem parcelas."});
    }
  } else if (terms.financialIntegration === "card") {
    if (!terms.cardId) {
      issues.push({path: "cardId", message: "Escolha o cartão da compra."});
    }
    if (terms.cashAccountId !== null) {
      issues.push({path: "cashAccountId",
        message: "Compra no cartão não leva conta."});
    }
    const count = terms.installmentsCount;
    if (
      typeof count !== "number" || !Number.isSafeInteger(count) ||
      count < 1 || count > SPLIT_LIMITS.cardInstallments
    ) {
      issues.push({path: "installmentsCount",
        message: `Parcelas: de 1 a ${SPLIT_LIMITS.cardInstallments}.`});
    }
  } else if (
    terms.cashAccountId !== null || terms.cardId !== null ||
    terms.installmentsCount !== null
  ) {
    issues.push({path: "financialIntegration",
      message: "Sem integração financeira não há conta, cartão nem parcelas."});
  }
  return issues;
};

const refineTerms = <T extends TermsShape>(
  terms: T,
  context: z.RefinementCtx,
  prefix: (string | number)[] = [],
) => {
  for (const issue of termsIssues(terms)) {
    context.addIssue({code: "custom", path: [...prefix, issue.path],
      message: issue.message});
  }
};

export const createSplitBillPayloadSchema = z.object({
  ...baseFields,
  groupId: splitGroupIdSchema,
  description: textSchema("Descrição", SPLIT_TEXT_LIMITS.billDescription),
  category: textSchema("Categoria", SPLIT_TEXT_LIMITS.category),
  ...termsFields,
}).strict().superRefine((payload, context) => refineTerms(payload, context));
export type CreateSplitBillPayload =
  z.infer<typeof createSplitBillPayloadSchema>;

export const splitBillTermsSchema = z.object(termsFields).strict()
  .superRefine((terms, context) => refineTerms(terms, context));
export type SplitBillTerms = z.infer<typeof splitBillTermsSchema>;

/**
 * Edição (PR-SPLIT-06): metadados (descrição, categoria) e/ou a troca
 * completa dos termos financeiros — esta só antes de qualquer quitação,
 * perdão ou fato financeiro; o servidor decide.
 */
export const updateSplitBillPayloadSchema = z.object({
  ...baseFields,
  billId: splitBillIdSchema,
  expectedUpdatedAt: versionSchema,
  metadata: z.object({
    description: textSchema("Descrição",
      SPLIT_TEXT_LIMITS.billDescription).optional(),
    category: textSchema("Categoria", SPLIT_TEXT_LIMITS.category).optional(),
  }).strict().optional(),
  terms: splitBillTermsSchema.optional(),
}).strict().refine((payload) =>
  (payload.metadata !== undefined &&
    Object.keys(payload.metadata).length > 0) || payload.terms !== undefined,
"Nenhuma alteração para salvar.");
export type UpdateSplitBillPayload =
  z.infer<typeof updateSplitBillPayloadSchema>;

export const voidSplitBillPayloadSchema = z.object({
  ...baseFields,
  billId: splitBillIdSchema,
  expectedUpdatedAt: versionSchema,
}).strict();
export type VoidSplitBillPayload = z.infer<typeof voidSplitBillPayloadSchema>;

// ----------------------------------------------------------------- rateio

export const shareActionPayloadSchema = z.object({
  ...baseFields,
  shareId: splitShareIdSchema,
  expectedUpdatedAt: versionSchema,
}).strict();
export type ShareActionPayload = z.infer<typeof shareActionPayloadSchema>;

export const forgiveSplitSharePayloadSchema = z.object({
  ...baseFields,
  shareId: splitShareIdSchema,
  expectedUpdatedAt: versionSchema,
  reason: textSchema("Motivo", SPLIT_TEXT_LIMITS.reason),
}).strict();
export type ForgiveSplitSharePayload =
  z.infer<typeof forgiveSplitSharePayloadSchema>;

// -------------------------------------------------------------- reembolso

export const createSplitReimbursementPayloadSchema = z.object({
  ...baseFields,
  groupId: splitGroupIdSchema,
  requesterParticipantId: splitParticipantIdSchema,
  description: textSchema("Descrição", SPLIT_TEXT_LIMITS.billDescription),
  category: textSchema("Categoria", SPLIT_TEXT_LIMITS.category),
  amountCents: amountSchema("Valor"),
  expenseDate: civilDaySchema("Data da despesa"),
}).strict();
export type CreateSplitReimbursementPayload =
  z.infer<typeof createSplitReimbursementPayloadSchema>;

export const reimbursementActionPayloadSchema = z.object({
  ...baseFields,
  reimbursementId: splitReimbursementIdSchema,
  expectedUpdatedAt: versionSchema,
}).strict();
export type ReimbursementActionPayload =
  z.infer<typeof reimbursementActionPayloadSchema>;

export const rejectSplitReimbursementPayloadSchema = z.object({
  ...baseFields,
  reimbursementId: splitReimbursementIdSchema,
  expectedUpdatedAt: versionSchema,
  reason: optionalTextSchema("Motivo", SPLIT_TEXT_LIMITS.reason).optional(),
}).strict();
export type RejectSplitReimbursementPayload =
  z.infer<typeof rejectSplitReimbursementPayloadSchema>;

export const paySplitReimbursementPayloadSchema = z.object({
  ...baseFields,
  reimbursementId: splitReimbursementIdSchema,
  expectedUpdatedAt: versionSchema,
  cashAccountId: cashAccountIdSchema,
  paymentDate: civilDaySchema("Data do pagamento"),
}).strict();
export type PaySplitReimbursementPayload =
  z.infer<typeof paySplitReimbursementPayloadSchema>;
