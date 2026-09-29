import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { db, functions } from '../../lib/firebase';
import { createWorkspaceCallables, type Invoke } from './callables';
import type {
  Workspace,
  WorkspaceAlertPreferences,
  WorkspaceMember,
  WorkspaceRole,
} from './types';

export {
  newIdempotencyKey,
  type AcceptWorkspaceInviteResult,
  type BootstrapAccountResult,
  type CreateWorkspaceInput,
  type InvitableRole,
  type WorkspaceSettingsInput,
} from './callables';

/**
 * Acesso a conta, workspaces e membros (P1).
 *
 * Toda escrita passa pelas callables do kernel; o cliente não grava
 * `workspaces`, `members`, convites nem o índice do usuário (as Rules negam).
 * A leitura segue a mesma autoridade do backend:
 *
 * - a lista de workspaces vem do índice `users/{uid}/workspaces`, gravado só
 *   pelo backend e com os dados de exibição — paginada por cursor, sob demanda;
 * - o papel vem **só** de `workspaces/{id}/members/{uid}` ativo; o índice não
 *   tem papel e `ownerId` não autoriza nada.
 */

/** Tamanho da página de workspaces (o teto das Rules do índice). */
export const WORKSPACE_LIST_LIMIT = 50;

/** Tamanho da página de membros (o teto das Rules de `members`). */
export const MEMBER_LIST_LIMIT = 200;

export interface Page<T> {
  items: T[];
  /** Último documento lido; `null` quando não há próxima página. */
  nextCursor: QueryDocumentSnapshot | null;
}

/**
 * Uma página da consulta: uma única leitura com `limit` (o teto das Rules),
 * continuando depois do último documento da página anterior. O cursor é o
 * próprio snapshot, então a ordem é estável mesmo com `joinedAt` empatado — o
 * Firestore desempata pelo ID do documento.
 *
 * As listas são carregadas página a página, sob demanda: o custo de abrir o
 * seletor de espaços ou a tela de membros é constante (uma página), e nada
 * além da página é descartado — a interface oferece a próxima quando existe.
 */
const readPage = async (
  base: Query,
  pageSize: number,
  cursor: QueryDocumentSnapshot | null,
): Promise<Page<QueryDocumentSnapshot>> => {
  const snapshot = await getDocs(cursor
    ? query(base, startAfter(cursor), limit(pageSize))
    : query(base, limit(pageSize)));
  const items = snapshot.docs;
  return {
    items,
    nextCursor: items.length === pageSize ? items[items.length - 1] : null,
  };
};

const invoke: Invoke = async <TResult>(name: string, payload: Record<string, unknown>) =>
  (await httpsCallable<Record<string, unknown>, TResult>(functions, name)(payload)).data;

/** Callables de P1 (contrato em `callables.ts`), ligadas ao SDK. */
export const {
  bootstrapAccount,
  createWorkspace,
  updateWorkspaceSettings,
  archiveWorkspace,
  inviteWorkspaceMember,
  acceptWorkspaceInvite,
  revokeWorkspaceInvite,
  changeWorkspaceMemberRole,
  removeWorkspaceMember,
  leaveWorkspace,
  transferWorkspaceOwnership,
} = createWorkspaceCallables(invoke);

const toIso = (value: unknown): string => {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === 'string' ? value : '';
};

const isRole = (value: unknown): value is WorkspaceRole =>
  value === 'owner' || value === 'admin' || value === 'member' || value === 'viewer';

const workspaceIndexQuery = (userId: string): Query => query(
  collection(db, 'users', userId, 'workspaces'),
  where('status', '==', 'active'),
  where('workspaceStatus', '==', 'active'),
  orderBy('joinedAt', 'asc'),
);

const toWorkspaceEntry = (entry: QueryDocumentSnapshot): Workspace => {
  const data = entry.data();
  return {
    id: entry.id,
    name: typeof data.name === 'string' ? data.name : '',
    type: data.type === 'PJ' ? 'PJ' : 'PF',
    createdAt: toIso(data.joinedAt),
    updatedAt: toIso(data.updatedAt),
  };
};

/** Uma página de workspaces ativos do usuário, pelo índice do backend. */
export const listWorkspacesPage = async (
  userId: string,
  cursor: QueryDocumentSnapshot | null = null,
): Promise<Page<Workspace>> => {
  const page = await readPage(workspaceIndexQuery(userId), WORKSPACE_LIST_LIMIT, cursor);
  return { items: page.items.map(toWorkspaceEntry), nextCursor: page.nextCursor };
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

const activeMembersQuery = (workspaceId: string): Query => query(
  collection(db, 'workspaces', workspaceId, 'members'),
  where('status', '==', 'active'),
  orderBy('joinedAt', 'asc'),
);

const toMembers = (docs: QueryDocumentSnapshot[]): WorkspaceMember[] =>
  docs.flatMap((entry) => {
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

/** Uma página de membros ativos, em ordem de entrada. */
export const listWorkspaceMembersPage = async (
  workspaceId: string,
  cursor: QueryDocumentSnapshot | null = null,
): Promise<Page<WorkspaceMember>> => {
  const page = await readPage(activeMembersQuery(workspaceId), MEMBER_LIST_LIMIT, cursor);
  return { items: toMembers(page.items), nextCursor: page.nextCursor };
};

