/**
 * Chaves de consulta do billing. Toda chave leva o uid: dados de outra
 * sessão nunca são reaproveitados depois de logout/login.
 */
export const billingKeys = {
  catalog: (uid: string | null) => ['billing', 'catalog', uid] as const,
  accountUsagePrefix: ['billing', 'accountUsage'] as const,
  accountUsage: (uid: string | null) => ['billing', 'accountUsage', uid] as const,
  workspaceEntitlementPrefix: ['billing', 'workspaceEntitlement'] as const,
  workspaceEntitlement: (uid: string | null, workspaceId: string | null) =>
    ['billing', 'workspaceEntitlement', uid, workspaceId] as const,
};
