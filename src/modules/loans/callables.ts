/**
 * Contrato cliente das callables de empréstimos (P3-H).
 *
 * Módulo puro: não importa o SDK. `api.ts` o liga ao `httpsCallable`; os
 * testes, a um `invoke` falso. A chave de idempotência chega pronta, decidida
 * por intenção no diálogo (`resolveIntentKey`): o reenvio do mesmo conteúdo
 * usa a mesma chave; conteúdo novo, chave nova. As callables são o único
 * caminho de escrita de empréstimos — as Rules negam toda escrita do cliente
 * em `loans` e `loan_movements`.
 */
export const LOAN_CALLABLES = [
  'createLoan',
  'registerLoanPayment',
  'reverseLoanMovement',
  'cancelLoan',
  'updateLoanMetadata',
] as const;

export type LoanCallableName = (typeof LOAN_CALLABLES)[number];

export type LoanInvoke = <TResult>(
  name: LoanCallableName,
  payload: Record<string, unknown>,
) => Promise<TResult>;

export interface CreateLoanResult {
  loanId: string;
  movementId: string;
  cashTransactionId: string;
  replayed: boolean;
}

export interface LoanMutationResult {
  loanId: string;
  movementId?: string;
  cashTransactionId?: string;
  status?: string;
  balanceCents?: number;
  changed?: boolean;
  replayed: boolean;
}

const bind = <TResult>(invoke: LoanInvoke, name: LoanCallableName) =>
  (payload: Record<string, unknown>, idempotencyKey: string) =>
    invoke<TResult>(name, { ...payload, idempotencyKey });

export const createLoanCallables = (invoke: LoanInvoke) => ({
  createLoan: bind<CreateLoanResult>(invoke, 'createLoan'),
  registerLoanPayment: bind<LoanMutationResult>(invoke, 'registerLoanPayment'),
  reverseLoanMovement: bind<LoanMutationResult>(invoke, 'reverseLoanMovement'),
  cancelLoan: bind<LoanMutationResult>(invoke, 'cancelLoan'),
  updateLoanMetadata: bind<LoanMutationResult>(invoke, 'updateLoanMetadata'),
} satisfies Record<LoanCallableName, (...args: never[]) => Promise<unknown>>);

export type LoanCallables = ReturnType<typeof createLoanCallables>;
