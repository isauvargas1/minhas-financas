import { clientsErrorView, type ClientsErrorView } from '../clients/presentation.ts';
import { formatCents } from '../loans/money.ts';
import { SplitInputError } from './payloads.ts';
import type {
  SplitBill,
  SplitGroup,
  SplitGroupRole,
  SplitParticipant,
  SplitReimbursement,
  SplitReimbursementStatus,
  SplitShare,
} from './types.ts';

/**
 * Textos, permissões e erros da Divisão de contas (P4-C). Módulo puro; tudo
 * que aparece ao usuário em pt-BR. A identidade é sempre o `uid` ligado ao
 * participante (`userId`), nunca o nome de exibição. As permissões espelham
 * a matriz do backend — que decide de novo em cada operação: aqui elas só
 * escondem o que seria recusado.
 */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface SplitViewer {
  uid: string | null | undefined;
  role: WorkspaceRole | null | undefined;
}

export const isWorkspaceAdmin = (role: WorkspaceRole | null | undefined): boolean =>
  role === 'owner' || role === 'admin';

/** Owner, admin e member criam grupos (o viewer do espaço só lê). */
export const canCreateSplitGroup = (role: WorkspaceRole | null | undefined): boolean =>
  role === 'owner' || role === 'admin' || role === 'member';

/** Registro do próprio usuário no grupo (pelo `uid`). */
export const myParticipantOf = (
  participants: readonly SplitParticipant[] | undefined,
  uid: string | null | undefined,
): SplitParticipant | null =>
  (uid && participants?.find((participant) => participant.userId === uid)) || null;

export interface SplitGroupPermissions {
  /** Papel ativo do usuário no grupo (null se não participa). */
  groupRole: SplitGroupRole | null;
  /** Editar e arquivar o grupo, convidar, incluir e remover participantes. */
  canManage: boolean;
  /** Lançar despesas e pedidos de reembolso. */
  canWrite: boolean;
  /** Aprovar, rejeitar, pagar e estornar reembolsos. */
  canAdministerReimbursements: boolean;
}

export const groupPermissions = (
  viewer: SplitViewer,
  group: Pick<SplitGroup, 'status'> | null | undefined,
  me: SplitParticipant | null,
): SplitGroupPermissions => {
  const admin = isWorkspaceAdmin(viewer.role);
  const actor = canCreateSplitGroup(viewer.role);
  const groupRole = me?.status === 'active' ? me.role : null;
  const active = group?.status === 'active';
  return {
    groupRole,
    canManage: actor && (admin || groupRole === 'owner'),
    canWrite: actor && active && (admin || groupRole === 'owner' || groupRole === 'participant'),
    canAdministerReimbursements: admin && active,
  };
};

/** Editar a despesa (e anular sem lançamento financeiro). */
export const canEditBill = (
  viewer: SplitViewer,
  permissions: SplitGroupPermissions,
  bill: Pick<SplitBill, 'createdBy' | 'payerUserId' | 'status'>,
): boolean => {
  if (bill.status === 'voided' || !canCreateSplitGroup(viewer.role)) return false;
  if (isWorkspaceAdmin(viewer.role) || permissions.groupRole === 'owner') return true;
  return permissions.groupRole === 'participant' && Boolean(viewer.uid) &&
    (bill.createdBy === viewer.uid || bill.payerUserId === viewer.uid);
};

export const hasFinancialFact = (bill: Pick<SplitBill, 'cashTransactionId' | 'purchaseId'>): boolean =>
  bill.cashTransactionId !== null || bill.purchaseId !== null;

/** Termos (valor, data, pagador, rateio) só antes de quitação, perdão ou fato. */
export const areTermsLocked = (bill: Pick<SplitBill, 'cashTransactionId' | 'purchaseId' | 'resolvedShareCount'>) =>
  hasFinancialFact(bill) || bill.resolvedShareCount > 0;

export const canVoidBill = (
  viewer: SplitViewer,
  permissions: SplitGroupPermissions,
  bill: SplitBill,
): boolean => {
  if (bill.status === 'voided' || !canCreateSplitGroup(viewer.role)) return false;
  if (!hasFinancialFact(bill)) return canEditBill(viewer, permissions, bill);
  if (isWorkspaceAdmin(viewer.role)) return true;
  return (permissions.groupRole === 'owner' || permissions.groupRole === 'participant') &&
    Boolean(viewer.uid) && bill.payerUserId === viewer.uid;
};

/** Registrar/estornar recebimento: pagador (no grupo), dono ou admin; nunca o devedor. */
export const canSettleShare = (
  viewer: SplitViewer,
  permissions: SplitGroupPermissions,
  bill: Pick<SplitBill, 'payerUserId'>,
  debtor: Pick<SplitParticipant, 'userId'> | undefined,
): boolean => {
  if (!canCreateSplitGroup(viewer.role)) return false;
  if (debtor?.userId && debtor.userId === viewer.uid) return false;
  if (isWorkspaceAdmin(viewer.role) || permissions.groupRole === 'owner') return true;
  return permissions.groupRole === 'participant' && Boolean(viewer.uid) &&
    bill.payerUserId === viewer.uid;
};

/** Perdoar: dono do grupo ou owner/admin; nunca o devedor. */
export const canForgiveShare = (
  viewer: SplitViewer,
  permissions: SplitGroupPermissions,
  debtor: Pick<SplitParticipant, 'userId'> | undefined,
): boolean => {
  if (!canCreateSplitGroup(viewer.role)) return false;
  if (debtor?.userId && debtor.userId === viewer.uid) return false;
  return isWorkspaceAdmin(viewer.role) || permissions.groupRole === 'owner';
};

/** Cancelar o pedido: o solicitante (aguardando aprovação) ou owner/admin. */
export const canCancelReimbursement = (
  viewer: SplitViewer,
  me: SplitParticipant | null,
  item: Pick<SplitReimbursement, 'status' | 'requesterParticipantId'>,
): boolean => {
  if (item.status !== 'requested' && item.status !== 'approved') return false;
  if (isWorkspaceAdmin(viewer.role)) return true;
  return canCreateSplitGroup(viewer.role) && item.status === 'requested' &&
    me?.id === item.requesterParticipantId;
};

// ------------------------------------------------------------------ textos

export const GROUP_ROLE_LABELS: Record<SplitGroupRole, string> = {
  owner: 'Dono',
  participant: 'Participante',
  viewer: 'Visualizador',
};

export const REIMBURSEMENT_STATUS_LABELS: Record<SplitReimbursementStatus, string> = {
  requested: 'Solicitado',
  approved: 'Aprovado',
  paid: 'Pago',
  rejected: 'Rejeitado',
  cancelled: 'Cancelado',
};

export const REIMBURSEMENT_STATUS_BADGE: Record<SplitReimbursementStatus, string> = {
  requested: 'bg-orange-100 text-orange-700',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-600',
};

/** Situação de um rateio, do ponto de vista de quem vê. */
export const shareStatusText = (share: SplitShare, isMe: boolean): string => {
  if (share.status === 'settled') {
    if (share.settledVia === 'payer_self') return 'Pagou a conta';
    if (share.settledVia === 'zero') return 'Sem valor a pagar';
    return 'Recebimento registrado';
  }
  if (share.status === 'forgiven') return 'Perdoado';
  if (share.status === 'voided') return 'Anulado';
  return isMe ? 'Você deve' : 'Pendente';
};

/** Membro do espaço como aparece na lista de membros (nome ou e-mail). */
export interface WorkspaceMemberName {
  uid: string;
  displayName?: string;
  email?: string;
}

/**
 * Nome exibido do participante: o externo pelo nome cadastrado; o membro
 * pelo cadastro do espaço (nunca por um nome gravado no grupo).
 */
export const participantName = (
  participant: Pick<SplitParticipant, 'kind' | 'displayName' | 'userId'> | undefined,
  members: ReadonlyMap<string, WorkspaceMemberName>,
): string => {
  if (!participant) return 'Participante';
  if (participant.kind === 'external') return participant.displayName ?? 'Participante externo';
  const member = participant.userId ? members.get(participant.userId) : undefined;
  return member?.displayName || member?.email || 'Membro do espaço';
};

export const participantInitial = (name: string): string =>
  (name.trim().charAt(0) || '?').toUpperCase();

export const splitErrorView = (error: unknown): ClientsErrorView => {
  if (error instanceof SplitInputError) {
    return { kind: 'validation', message: error.message, refresh: false };
  }
  return clientsErrorView(error);
};

/** Centavos → `R$ 1.234,56` (só exibição). */
export const formatSplitCents = formatCents;

/** Basis points → `33,33%` (casas finais zeradas omitidas). */
export const formatBps = (bps: number): string => {
  const sign = bps < 0 ? '-' : '';
  const value = Math.abs(bps);
  const decimals = String(value % 100).padStart(2, '0').replace(/0+$/, '');
  return `${sign}${Math.floor(value / 100)}${decimals ? `,${decimals}` : ''}%`;
};
