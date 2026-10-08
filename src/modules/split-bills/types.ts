/**
 * Divisão de contas (P4-C, D-14) — modelo lido pelo frontend.
 *
 * Espelha os documentos autoritativos do backend (`split_*`), já validados
 * pelos adaptadores. Valores sempre em centavos inteiros; datas civis
 * `AAAA-MM-DD`; nenhuma regra financeira é decidida aqui.
 */
export type SplitGroupType = 'fixed' | 'temporary';
export type SplitBusinessMode = 'split' | 'reimbursement';
export type SplitGroupStatus = 'active' | 'archived';
export type SplitParticipantKind = 'workspace_member' | 'external';
export type SplitGroupRole = 'owner' | 'participant' | 'viewer';
export type SplitAssignableRole = 'participant' | 'viewer';
export type SplitParticipantStatus = 'active' | 'inactive';
export type SplitAllocationMethod = 'equal' | 'percentage' | 'fixed';
export type SplitFinancialIntegration = 'none' | 'cash' | 'card';
export type SplitBillStatus = 'open' | 'settled' | 'voided';
export type SplitShareStatus = 'open' | 'settled' | 'forgiven' | 'voided';
export type SplitShareSettledVia = 'payer_self' | 'settlement' | 'zero';
export type SplitReimbursementStatus =
  | 'requested'
  | 'approved'
  | 'paid'
  | 'rejected'
  | 'cancelled';

export interface SplitVisual {
  color: string;
  icon: string;
  emoji: string | null;
}

export interface SplitGroupCounters {
  participantCount: number;
  activeParticipantCount: number;
  billCount: number;
  openBillCount: number;
  openShareCount: number;
  openReimbursementCount: number;
}

export interface SplitGroupTotals {
  billedCents: number;
  openCents: number;
  categoryTotals: Record<string, number>;
  reimbursementTotalCents: number;
  reimbursementPendingCents: number;
  reimbursementPaidCents: number;
}

export interface SplitGroup {
  id: string;
  name: string;
  description: string | null;
  groupType: SplitGroupType;
  businessMode: SplitBusinessMode;
  status: SplitGroupStatus;
  ownerParticipantId: string;
  ownerUserId: string;
  createdBy: string;
  visual: SplitVisual;
  counters: SplitGroupCounters;
  totals: SplitGroupTotals;
  /** Versão (`updatedAt`) para editar, arquivar e reativar. */
  version: string;
}

export interface SplitParticipantBalances {
  dueCents: number;
  paidCents: number;
  owesOpenCents: number;
  receivableOpenCents: number;
}

export interface SplitParticipant {
  id: string;
  groupId: string;
  kind: SplitParticipantKind;
  /** Só para `workspace_member`. */
  userId: string | null;
  /** Só para `external` (o nome do membro vem do cadastro do espaço). */
  displayName: string | null;
  role: SplitGroupRole;
  status: SplitParticipantStatus;
  color: string;
  balances: SplitParticipantBalances;
  openShareCount: number;
  openReceivableCount: number;
  openReimbursementCount: number;
  version: string;
}

export interface SplitInvite {
  id: string;
  groupId: string;
  role: SplitAssignableRole;
  /** Últimos 3 caracteres do código (o código não é gravado). */
  codeHint: string;
  /** Instante ISO da expiração. */
  expiresAt: string;
  createdBy: string;
}

export interface SplitBill {
  id: string;
  groupId: string;
  description: string;
  category: string;
  amountCents: number;
  expenseDate: string;
  payerParticipantId: string;
  payerUserId: string | null;
  allocationMethod: SplitAllocationMethod;
  participantIds: string[];
  financialIntegration: SplitFinancialIntegration;
  cashAccountId: string | null;
  cardId: string | null;
  installmentsCount: number | null;
  cashTransactionId: string | null;
  purchaseId: string | null;
  status: SplitBillStatus;
  shareCount: number;
  openShareCount: number;
  resolvedShareCount: number;
  outstandingCents: number;
  createdBy: string;
  version: string;
}

export interface SplitShare {
  id: string;
  billId: string;
  participantId: string;
  isPayerShare: boolean;
  weightBps: number | null;
  amountDueCents: number;
  amountSettledCents: number;
  status: SplitShareStatus;
  settledVia: SplitShareSettledVia | null;
  version: string;
}

export interface SplitReimbursement {
  id: string;
  groupId: string;
  requesterParticipantId: string;
  requesterUserId: string | null;
  description: string;
  category: string;
  amountCents: number;
  expenseDate: string;
  status: SplitReimbursementStatus;
  createdBy: string;
  cashAccountId: string | null;
  paymentDate: string | null;
  version: string;
}

/** Página lida com teto: `truncated` avisa que há mais do que o exibido. */
export interface SplitPage<T> {
  items: T[];
  truncated: boolean;
}
