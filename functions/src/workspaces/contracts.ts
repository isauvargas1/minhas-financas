import {z} from "zod";

import {
  idempotencyKeySchema,
  inviteIdSchema,
  memberIdSchema,
  workspaceIdSchema,
} from "../shared/ids";
import {INVITE_TOKEN_PATTERN} from "./inviteTokens";

/**
 * Contratos das callables de conta, workspace e membership (P1).
 *
 * Todos são `.strict()`: campo desconhecido é recusado, não ignorado. Nenhum
 * contrato aceita `ownerId`, `role` do próprio ator, `uid` de quem chama,
 * `status` ou campos de cobrança — a identidade vem do token e o papel do
 * membership persistido.
 */
const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
};

export const workspaceNameSchema = z.string()
  .transform((value) => value.trim())
  .pipe(z.string()
    .min(1, "Informe o nome do espaço.")
    .max(120, "O nome do espaço pode ter até 120 caracteres.")
    .refine((value) => !hasControlCharacter(value), "Nome inválido."));

export const workspaceTypeSchema = z.enum(["PF", "PJ"]);

export const themeColorSchema = z.string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida.")
  .transform((value) => value.toLowerCase());

export const alertPreferencesSchema = z.object({
  billing: z.boolean(),
  accountsPayable: z.boolean(),
  delinquency: z.boolean(),
  lowMargin: z.boolean(),
}).strict();

/** CNPJ bruto; a validação de dígitos é feita no domínio (`normalizeCnpj`). */
const cnpjInputSchema = z.string().max(32);

export const inviteRoleSchema = z.enum(["admin", "member", "viewer"]);

export const emailSchema = z.string()
  .transform((value) => value.trim())
  .pipe(z.string()
    .min(3)
    .max(320)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "E-mail inválido."));

export const bootstrapAccountPayloadSchema = z.object({}).strict();

export const createWorkspacePayloadSchema = z.object({
  type: workspaceTypeSchema,
  name: workspaceNameSchema,
  cnpj: cnpjInputSchema.nullable().optional(),
  themeColor: themeColorSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const updateWorkspaceSettingsPayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  name: workspaceNameSchema.optional(),
  cnpj: cnpjInputSchema.nullable().optional(),
  themeColor: themeColorSchema.optional(),
  alertPreferences: alertPreferencesSchema.optional(),
}).strict();

export const archiveWorkspacePayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
}).strict();

export const inviteWorkspaceMemberPayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  email: emailSchema,
  role: inviteRoleSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const acceptWorkspaceInvitePayloadSchema = z.object({
  token: z.string().regex(INVITE_TOKEN_PATTERN, "Convite inválido."),
}).strict();

export const revokeWorkspaceInvitePayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  inviteId: inviteIdSchema,
}).strict();

export const changeWorkspaceMemberRolePayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  memberId: memberIdSchema,
  role: inviteRoleSchema,
}).strict();

export const removeWorkspaceMemberPayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  memberId: memberIdSchema,
}).strict();

export const leaveWorkspacePayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
}).strict();

export const transferWorkspaceOwnershipPayloadSchema = z.object({
  workspaceId: workspaceIdSchema,
  newOwnerId: memberIdSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export type CreateWorkspacePayload =
  z.infer<typeof createWorkspacePayloadSchema>;
export type UpdateWorkspaceSettingsPayload =
  z.infer<typeof updateWorkspaceSettingsPayloadSchema>;
export type InviteWorkspaceMemberPayload =
  z.infer<typeof inviteWorkspaceMemberPayloadSchema>;
export type TransferWorkspaceOwnershipPayload =
  z.infer<typeof transferWorkspaceOwnershipPayloadSchema>;
