import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../lib/firebase';
import type {
  Workspace,
  WorkspaceAlertPreferences,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceType,
} from './types';

/**
 * Acesso a conta, workspaces e membros (P1).
 *
 * Toda escrita passa pelas callables do kernel; o cliente não grava
 * `workspaces`, `members`, convites nem o índice do usuário (as Rules negam).
 * A leitura segue a mesma autoridade do backend:
 *
 * - a lista de workspaces vem do índice `users/{uid}/workspaces`, gravado só
 *   pelo backend e com os dados de exibição — uma consulta, com `limit`;
 * - o papel vem **só** de `workspaces/{id}/members/{uid}` ativo; o índice não
 *   tem papel e `ownerId` não autoriza nada.
 */

/** Teto de workspaces listados (o mesmo das Rules do índice). */
export const WORKSPACE_LIST_LIMIT = 50;

/** Teto de membros listados por página (o mesmo das Rules de `members`). */
export const MEMBER_LIST_LIMIT = 200;

const call = async <TInput extends Record<string, unknown>, TResult>(
  name: string,
  input: TInput,
): Promise<TResult> => {
  const callable = httpsCallable<TInput, TResult>(functions, name);
  const payload = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as TInput;
  return (await callable(payload)).data;
};

/** Chave de idempotência de uma intenção do usuário. */
export const newIdempotencyKey = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const toIso = (value: unknown): string => {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === 'string' ? value : '';
};

const isRole = (value: unknown): value is WorkspaceRole =>
  value === 'owner' || value === 'admin' || value === 'member' || value === 'viewer';

export interface BootstrapAccountResult {
  created: boolean;
  workspaceId: string | null;
}

/** Garante perfil e ao menos um workspace ativo (idempotente). */
export const bootstrapAccount = (): Promise<BootstrapAccountResult> =>
  call<Record<string, never>, BootstrapAccountResult>('bootstrapAccount', {});

/** Workspaces ativos do usuário, pelo índice mantido no backend. */
export const listWorkspaces = async (userId: string): Promise<Workspace[]> => {
  const snapshot = await getDocs(query(
    collection(db, 'users', userId, 'workspaces'),
    where('status', '==', 'active'),
    where('workspaceStatus', '==', 'active'),
    orderBy('joinedAt', 'asc'),
    limit(WORKSPACE_LIST_LIMIT),
  ));
  return snapshot.docs.map((entry) => {
    const data = entry.data();
    return {
      id: entry.id,
      name: typeof data.name === 'string' ? data.name : '',
      type: data.type === 'PJ' ? 'PJ' : 'PF',
      createdAt: toIso(data.joinedAt),
      updatedAt: toIso(data.updatedAt),
    };
  });
};

/**
 * Documento completo do workspace com o papel do usuário, lido do membership
 * ativo. Sem membership ativo, o workspace não é aberto.
 */
export const loadWorkspace = async (
  workspaceId: string,
  userId: string,
): Promise<Workspace> => {
  const membership = await getDoc(doc(db, 'workspaces', workspaceId, 'members', userId));
  const role = membership.data()?.role;
  if (!membership.exists() || membership.data()?.status !== 'active' || !isRole(role)) {
    throw new Error('workspace-access-lost');
  }
  const snapshot = await getDoc(doc(db, 'workspaces', workspaceId));
  const data = snapshot.data();
  if (!data || data.status === 'archived') throw new Error('workspace-access-lost');
  return {
    id: snapshot.id,
    ownerId: typeof data.ownerId === 'string' ? data.ownerId : undefined,
    type: data.type === 'PJ' ? 'PJ' : 'PF',
    name: typeof data.name === 'string' ? data.name : '',
    cnpj: typeof data.cnpj === 'string' ? data.cnpj : null,
    themeColor: typeof data.themeColor === 'string' ? data.themeColor : undefined,
    alertPreferences: data.alertPreferences as WorkspaceAlertPreferences | undefined,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    myRole: role,
  };
};

export interface CreateWorkspaceInput {
  type: WorkspaceType;
  name: string;
  cnpj?: string | null;
  themeColor?: string;
}

export const createWorkspace = async (
  input: CreateWorkspaceInput,
  idempotencyKey = newIdempotencyKey(),
): Promise<{ workspaceId: string }> =>
  call('createWorkspace', {
    type: input.type,
    name: input.name,
    cnpj: input.cnpj || undefined,
    themeColor: input.themeColor,
    idempotencyKey,
  });

export interface WorkspaceSettingsInput {
  name?: string;
  cnpj?: string | null;
  themeColor?: string;
  alertPreferences?: WorkspaceAlertPreferences;
}

export const updateWorkspaceSettings = async (
  workspaceId: string,
  settings: WorkspaceSettingsInput,
): Promise<{ updated: boolean }> =>
  call('updateWorkspaceSettings', { workspaceId, ...settings });

/** Membros ativos, em ordem de entrada, com teto por página. */
export const listWorkspaceMembers = async (workspaceId: string): Promise<WorkspaceMember[]> => {
  const snapshot = await getDocs(query(
    collection(db, 'workspaces', workspaceId, 'members'),
    where('status', '==', 'active'),
    orderBy('joinedAt', 'asc'),
    limit(MEMBER_LIST_LIMIT),
  ));
  return snapshot.docs.flatMap((entry) => {
    const data = entry.data();
    if (!isRole(data.role)) return [];
    return [{
      uid: entry.id,
      email: typeof data.email === 'string' ? data.email : '',
      displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
      role: data.role,
      joinedAt: toIso(data.joinedAt),
    }];
  });
};

export type InvitableRole = Exclude<WorkspaceRole, 'owner'>;

export const inviteWorkspaceMember = async (
  workspaceId: string,
  email: string,
  role: InvitableRole,
  idempotencyKey = newIdempotencyKey(),
): Promise<{ inviteId: string; expiresAt: string }> =>
  call('inviteWorkspaceMember', { workspaceId, email, role, idempotencyKey });

export const changeWorkspaceMemberRole = async (
  workspaceId: string,
  memberId: string,
  role: InvitableRole,
): Promise<{ role: InvitableRole; changed: boolean }> =>
  call('changeWorkspaceMemberRole', { workspaceId, memberId, role });

export const removeWorkspaceMember = async (
  workspaceId: string,
  memberId: string,
): Promise<{ status: 'removed'; changed: boolean }> =>
  call('removeWorkspaceMember', { workspaceId, memberId });

export const transferWorkspaceOwnership = async (
  workspaceId: string,
  newOwnerId: string,
  idempotencyKey = newIdempotencyKey(),
): Promise<{ ownerId: string }> =>
  call('transferWorkspaceOwnership', { workspaceId, newOwnerId, idempotencyKey });
