/**
 * Contrato cliente das callables de caixa (P3-E).
 *
 * Módulo puro: não importa o SDK. `cashApi.ts` o liga ao `httpsCallable`; os
 * testes o ligam a um `invoke` falso. A chave de idempotência chega pronta:
 * é decidida por intenção no formulário (`resolveIntentKey`), para que o
 * reenvio do mesmo conteúdo use a mesma chave e uma intenção nova use outra.
 */
export const CASH_CALLABLES = [
  'createCashTransaction',
  'updateCashTransaction',
  'confirmCashTransaction',
  'voidCashTransaction',
] as const;

export type CashCallableName = (typeof CASH_CALLABLES)[number];

export type CashInvoke = <TResult>(
  name: CashCallableName,
  payload: Record<string, unknown>,
) => Promise<TResult>;

export interface CashCreateResult {
  transactionId: string;
  replayed: boolean;
}

export interface CashUpdateResult {
  transactionId: string;
  replayed: boolean;
  changed: boolean;
  revision: number;
}

export interface CashConfirmResult {
  transactionId: string;
  replayed: boolean;
  revision: number;
}

export interface CashVoidResult {
  transactionId: string;
  replayed: boolean;
  revision: number;
}

export const createCashCallables = (invoke: CashInvoke) => ({
  createCashTransaction: (
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ) => invoke<CashCreateResult>('createCashTransaction', {
    ...payload,
    idempotencyKey,
  }),

  updateCashTransaction: (
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ) => invoke<CashUpdateResult>('updateCashTransaction', {
    ...payload,
    idempotencyKey,
  }),

  confirmCashTransaction: (
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ) => invoke<CashConfirmResult>('confirmCashTransaction', {
    ...payload,
    idempotencyKey,
  }),

  voidCashTransaction: (
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ) => invoke<CashVoidResult>('voidCashTransaction', {
    ...payload,
    idempotencyKey,
  }),
} satisfies Record<CashCallableName, (...args: never[]) => Promise<unknown>>);
