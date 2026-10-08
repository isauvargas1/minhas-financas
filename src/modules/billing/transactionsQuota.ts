import type { WorkspaceEntitlement } from './types';

/**
 * Indicador da quota mensal de lançamentos na interface (P3-E, D-40).
 *
 * A fonte é o contador do backend (`getWorkspaceEntitlement`), e não uma
 * contagem dos lançamentos carregados pela data financeira. É só ajuda de
 * UX: com a quota esgotada a interface desabilita a criação; com o estado
 * desconhecido (ainda carregando, espaço sem contador ou estado incoerente)
 * ela não bloqueia nem mostra uso — o backend decide de novo em cada
 * operação.
 */
export interface TransactionsQuotaView {
  /** `false` só quando o backend informou que o mês atingiu o limite. */
  canCreate: boolean;
  limit: number | null;
}

export const transactionsQuotaView = (
  entitlement: WorkspaceEntitlement | null,
): TransactionsQuotaView => {
  const quota = entitlement?.transactionsQuota;
  if (!quota || quota.status !== 'available' || quota.exhausted === null) {
    return { canCreate: true, limit: quota?.limit ?? null };
  }
  return { canCreate: !quota.exhausted, limit: quota.limit };
};

/**
 * Indicador da quota de grupos de divisão ativos (P4-C, `splitGroups`). Mesma
 * política: só bloqueia a criação quando o backend informou o limite
 * atingido; uso desconhecido não bloqueia — a callable decide de novo.
 */
export const splitGroupsQuotaView = (
  entitlement: WorkspaceEntitlement | null,
): TransactionsQuotaView => {
  const quota = entitlement?.splitGroupsQuota;
  if (!quota || quota.status !== 'available' || quota.exhausted === null) {
    return { canCreate: true, limit: quota?.limit ?? entitlement?.limits.splitGroups ?? null };
  }
  return { canCreate: !quota.exhausted, limit: quota.limit };
};
