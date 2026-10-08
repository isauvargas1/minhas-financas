/**
 * Contrato cliente das callables de despesas recorrentes (P4-B, D-12).
 *
 * Módulo puro: não importa o SDK. `api.ts` o liga ao `httpsCallable`; os
 * testes, a um `invoke` falso. A chave de idempotência chega pronta,
 * decidida por intenção no diálogo. As callables são o único caminho de
 * escrita — as Rules negam toda escrita do cliente em `recurring_expenses`,
 * `recurring_occurrences` e `recurring_events`.
 */
export const RECURRING_CALLABLES = [
  'createRecurringExpense',
  'updateRecurringExpense',
  'pauseRecurringExpense',
  'resumeRecurringExpense',
  'cancelRecurringExpense',
  'confirmRecurringOccurrence',
  'ignoreRecurringOccurrence',
  'retryRecurringOccurrence',
] as const;

export type RecurringCallableName = (typeof RECURRING_CALLABLES)[number];

export type RecurringInvoke = <TResult>(
  name: RecurringCallableName,
  payload: Record<string, unknown>,
) => Promise<TResult>;

export interface RecurringMutationResult {
  recurringExpenseId: string;
  status?: 'active' | 'paused' | 'ended' | 'cancelled';
  nextDueDate?: string | null;
  replayed: boolean;
}

export interface OccurrenceMutationResult {
  occurrenceId: string;
  recurringExpenseId: string;
  status?: 'generated' | 'ignored';
  cashTransactionId?: string | null;
  cardPurchaseId?: string | null;
  replayed: boolean;
}

const bind = <TResult>(invoke: RecurringInvoke, name: RecurringCallableName) =>
  (payload: Record<string, unknown>, idempotencyKey: string) =>
    invoke<TResult>(name, { ...payload, idempotencyKey });

export const createRecurringCallables = (invoke: RecurringInvoke) => ({
  createRecurringExpense: bind<RecurringMutationResult>(invoke, 'createRecurringExpense'),
  updateRecurringExpense: bind<RecurringMutationResult>(invoke, 'updateRecurringExpense'),
  pauseRecurringExpense: bind<RecurringMutationResult>(invoke, 'pauseRecurringExpense'),
  resumeRecurringExpense: bind<RecurringMutationResult>(invoke, 'resumeRecurringExpense'),
  cancelRecurringExpense: bind<RecurringMutationResult>(invoke, 'cancelRecurringExpense'),
  confirmRecurringOccurrence: bind<OccurrenceMutationResult>(invoke, 'confirmRecurringOccurrence'),
  ignoreRecurringOccurrence: bind<OccurrenceMutationResult>(invoke, 'ignoreRecurringOccurrence'),
  retryRecurringOccurrence: bind<OccurrenceMutationResult>(invoke, 'retryRecurringOccurrence'),
} satisfies Record<RecurringCallableName, (...args: never[]) => Promise<unknown>>);

export type RecurringCallables = ReturnType<typeof createRecurringCallables>;
