import type {
  WorkspaceAlertPreferences,
  WorkspaceRole,
  WorkspaceType,
} from './types';

/**
 * Contrato cliente das callables de conta, workspace e membership (P1).
 *
 * Módulo puro: não importa o SDK. `api.ts` o liga ao `httpsCallable`; os
 * testes o ligam a um `invoke` falso e conferem nome e payload de cada
 * chamada. Nenhum wrapper envia papel do próprio usuário, `ownerId`, UID do
 * convidado ou qualquer dado que o backend deriva do token.
 */
export const P1_CALLABLES = [
  'bootstrapAccount',
  'createWorkspace',
  'updateWorkspaceSettings',
  'archiveWorkspace',
  'inviteWorkspaceMember',
  'acceptWorkspaceInvite',
  'revokeWorkspaceInvite',
  'changeWorkspaceMemberRole',
  'removeWorkspaceMember',
  'leaveWorkspace',
  'transferWorkspaceOwnership',
] as const;

export type P1CallableName = (typeof P1_CALLABLES)[number];

export type Invoke = <TResult>(
  name: P1CallableName,
  payload: Record<string, unknown>,
) => Promise<TResult>;

/** Chave de idempotência de uma intenção do usuário. */
export const newIdempotencyKey = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Campo ausente não vai no payload: os schemas do backend são estritos. */
const compact = (input: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));

export interface BootstrapAccountResult {
  created: boolean;
  workspaceId: string | null;
}

export interface CreateWorkspaceInput {
  type: WorkspaceType;
  name: string;
  cnpj?: string | null;
  themeColor?: string;
}

export interface WorkspaceSettingsInput {
  name?: string;
  cnpj?: string | null;
  themeColor?: string;
  alertPreferences?: WorkspaceAlertPreferences;
}

export type InvitableRole = Exclude<WorkspaceRole, 'owner'>;

export interface AcceptWorkspaceInviteResult {
  workspaceId: string;
  role: WorkspaceRole | null;
  /** `true` quando o mesmo aceite já tinha sido concluído (retry). */
  replay: boolean;
}

export const createWorkspaceCallables = (invoke: Invoke) => {
  const call = <TResult>(name: P1CallableName, payload: Record<string, unknown>) =>
    invoke<TResult>(name, compact(payload));

  return {
    /** Garante perfil e ao menos um workspace ativo (idempotente). */
    bootstrapAccount: () =>
      call<BootstrapAccountResult>('bootstrapAccount', {}),

    /** O backend devolve o workspace já provisionado com os cadastros padrão. */
    createWorkspace: (input: CreateWorkspaceInput, idempotencyKey = newIdempotencyKey()) =>
      call<{ workspaceId: string }>('createWorkspace', {
        type: input.type,
        name: input.name,
        cnpj: input.cnpj || undefined,
        themeColor: input.themeColor,
        idempotencyKey,
      }),

    updateWorkspaceSettings: (workspaceId: string, settings: WorkspaceSettingsInput) =>
      call<{ updated: boolean }>('updateWorkspaceSettings', { workspaceId, ...settings }),

    /** Arquivamento lógico, só pelo owner e com login recente. */
    archiveWorkspace: (workspaceId: string) =>
      call<{ status: 'archived'; alreadyArchived: boolean }>('archiveWorkspace', { workspaceId }),

    inviteWorkspaceMember: (
      workspaceId: string,
      email: string,
      role: InvitableRole,
      idempotencyKey = newIdempotencyKey(),
    ) =>
      call<{ inviteId: string; expiresAt: string }>('inviteWorkspaceMember', {
        workspaceId,
        email,
        role,
        idempotencyKey,
      }),

    /** O workspace e o papel vêm do convite resolvido pelo token, não do cliente. */
    acceptWorkspaceInvite: (token: string) =>
      call<AcceptWorkspaceInviteResult>('acceptWorkspaceInvite', { token }),

    revokeWorkspaceInvite: (workspaceId: string, inviteId: string) =>
      call<{ status: 'revoked'; changed: boolean }>('revokeWorkspaceInvite', {
        workspaceId,
        inviteId,
      }),

    changeWorkspaceMemberRole: (workspaceId: string, memberId: string, role: InvitableRole) =>
      call<{ role: InvitableRole; changed: boolean }>('changeWorkspaceMemberRole', {
        workspaceId,
        memberId,
        role,
      }),

    removeWorkspaceMember: (workspaceId: string, memberId: string) =>
      call<{ status: 'removed'; changed: boolean }>('removeWorkspaceMember', {
        workspaceId,
        memberId,
      }),

    /** Saída voluntária; o owner precisa transferir a titularidade antes. */
    leaveWorkspace: (workspaceId: string) =>
      call<{ status: 'removed'; changed: boolean }>('leaveWorkspace', { workspaceId }),

    transferWorkspaceOwnership: (
      workspaceId: string,
      newOwnerId: string,
      idempotencyKey = newIdempotencyKey(),
    ) =>
      call<{ ownerId: string }>('transferWorkspaceOwnership', {
        workspaceId,
        newOwnerId,
        idempotencyKey,
      }),
  } satisfies Record<P1CallableName, (...args: never[]) => Promise<unknown>>;
};
