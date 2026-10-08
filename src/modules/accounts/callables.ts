/**
 * Contrato cliente das callables de contas/carteiras e transferências
 * (D-30, P3-J).
 *
 * Módulo puro: não importa o SDK. `api.ts` o liga ao `httpsCallable`; os
 * testes, a um `invoke` falso. A chave de idempotência chega pronta, decidida
 * por intenção no diálogo. As callables são o único caminho de escrita — as
 * Rules negam toda escrita do cliente em `cash_accounts`,
 * `cash_account_movements`, `cash_transfers` e na auditoria.
 */
export const ACCOUNTS_CALLABLES = [
  'createCashAccount',
  'updateCashAccount',
  'archiveCashAccount',
  'reactivateCashAccount',
  'createCashTransfer',
  'reverseCashTransfer',
] as const;

export type AccountsCallableName = (typeof ACCOUNTS_CALLABLES)[number];

export type AccountsInvoke = <TResult>(
  name: AccountsCallableName,
  payload: Record<string, unknown>,
) => Promise<TResult>;

export interface CashAccountMutationResult {
  accountId: string;
  status?: 'active' | 'archived';
  balanceCents?: number;
  changed?: boolean;
  replayed: boolean;
}

export interface CashTransferResult {
  transferId: string;
  status: 'completed' | 'reversed';
  replayed: boolean;
}

const bind = <TResult>(invoke: AccountsInvoke, name: AccountsCallableName) =>
  (payload: Record<string, unknown>, idempotencyKey: string) =>
    invoke<TResult>(name, { ...payload, idempotencyKey });

export const createAccountsCallables = (invoke: AccountsInvoke) => ({
  createCashAccount: bind<CashAccountMutationResult>(invoke, 'createCashAccount'),
  updateCashAccount: bind<CashAccountMutationResult>(invoke, 'updateCashAccount'),
  archiveCashAccount: bind<CashAccountMutationResult>(invoke, 'archiveCashAccount'),
  reactivateCashAccount: bind<CashAccountMutationResult>(invoke, 'reactivateCashAccount'),
  createCashTransfer: bind<CashTransferResult>(invoke, 'createCashTransfer'),
  reverseCashTransfer: bind<CashTransferResult>(invoke, 'reverseCashTransfer'),
} satisfies Record<AccountsCallableName, (...args: never[]) => Promise<unknown>>);

export type AccountsCallables = ReturnType<typeof createAccountsCallables>;
