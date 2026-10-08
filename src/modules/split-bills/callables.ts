/**
 * Contrato cliente das callables da Divisão de contas (P4-C, D-14).
 *
 * Módulo puro: não importa o SDK. `api.ts` o liga ao `httpsCallable`; os
 * testes, a um `invoke` falso. A chave de idempotência chega pronta,
 * decidida por intenção no diálogo. As callables são o único caminho de
 * escrita — as Rules negam toda escrita do cliente nas coleções `split_*`.
 */
export const SPLIT_CALLABLES = [
  'createSplitGroup',
  'updateSplitGroup',
  'archiveSplitGroup',
  'reactivateSplitGroup',
  'createSplitGroupInvite',
  'revokeSplitGroupInvite',
  'acceptSplitGroupInvite',
  'addWorkspaceSplitParticipant',
  'addExternalSplitParticipant',
  'deactivateSplitParticipant',
  'createSplitBill',
  'updateSplitBill',
  'voidSplitBill',
  'settleSplitShare',
  'reverseSplitShareSettlement',
  'forgiveSplitShare',
  'createSplitReimbursement',
  'approveSplitReimbursement',
  'rejectSplitReimbursement',
  'cancelSplitReimbursement',
  'paySplitReimbursement',
  'reverseReimbursementPayment',
] as const;

export type SplitCallableName = (typeof SPLIT_CALLABLES)[number];

export type SplitInvoke = <TResult>(
  name: SplitCallableName,
  payload: Record<string, unknown>,
) => Promise<TResult>;

/** Resultado de toda mutação: só identificadores (mais o código do convite). */
export interface SplitMutationResult {
  groupId: string;
  billId: string | null;
  shareId: string | null;
  participantId: string | null;
  reimbursementId: string | null;
  inviteId: string | null;
  replayed: boolean;
}

export interface SplitInviteResult extends SplitMutationResult {
  /** Mostrado uma vez; num replay vem `null` (o código não é gravado). */
  code: string | null;
  expiresAt: string;
}

const bind = <TResult>(invoke: SplitInvoke, name: SplitCallableName) =>
  (payload: Record<string, unknown>, idempotencyKey: string) =>
    invoke<TResult>(name, { ...payload, idempotencyKey });

export const createSplitCallables = (invoke: SplitInvoke) => ({
  createSplitGroup: bind<SplitMutationResult>(invoke, 'createSplitGroup'),
  updateSplitGroup: bind<SplitMutationResult>(invoke, 'updateSplitGroup'),
  archiveSplitGroup: bind<SplitMutationResult>(invoke, 'archiveSplitGroup'),
  reactivateSplitGroup: bind<SplitMutationResult>(invoke, 'reactivateSplitGroup'),
  createSplitGroupInvite: bind<SplitInviteResult>(invoke, 'createSplitGroupInvite'),
  revokeSplitGroupInvite: bind<SplitMutationResult>(invoke, 'revokeSplitGroupInvite'),
  acceptSplitGroupInvite: bind<SplitMutationResult>(invoke, 'acceptSplitGroupInvite'),
  addWorkspaceSplitParticipant: bind<SplitMutationResult>(invoke, 'addWorkspaceSplitParticipant'),
  addExternalSplitParticipant: bind<SplitMutationResult>(invoke, 'addExternalSplitParticipant'),
  deactivateSplitParticipant: bind<SplitMutationResult>(invoke, 'deactivateSplitParticipant'),
  createSplitBill: bind<SplitMutationResult>(invoke, 'createSplitBill'),
  updateSplitBill: bind<SplitMutationResult>(invoke, 'updateSplitBill'),
  voidSplitBill: bind<SplitMutationResult>(invoke, 'voidSplitBill'),
  settleSplitShare: bind<SplitMutationResult>(invoke, 'settleSplitShare'),
  reverseSplitShareSettlement: bind<SplitMutationResult>(invoke, 'reverseSplitShareSettlement'),
  forgiveSplitShare: bind<SplitMutationResult>(invoke, 'forgiveSplitShare'),
  createSplitReimbursement: bind<SplitMutationResult>(invoke, 'createSplitReimbursement'),
  approveSplitReimbursement: bind<SplitMutationResult>(invoke, 'approveSplitReimbursement'),
  rejectSplitReimbursement: bind<SplitMutationResult>(invoke, 'rejectSplitReimbursement'),
  cancelSplitReimbursement: bind<SplitMutationResult>(invoke, 'cancelSplitReimbursement'),
  paySplitReimbursement: bind<SplitMutationResult>(invoke, 'paySplitReimbursement'),
  reverseReimbursementPayment: bind<SplitMutationResult>(invoke, 'reverseReimbursementPayment'),
} satisfies Record<SplitCallableName, (...args: never[]) => Promise<unknown>>);

export type SplitCallables = ReturnType<typeof createSplitCallables>;
