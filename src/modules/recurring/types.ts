import type { RecurringFrequency } from './schedule.ts';

/**
 * Modelo de leitura das despesas recorrentes (P4-B, D-12).
 *
 * Espelha os documentos autoritativos gravados só pelo backend:
 * `recurring_expenses` (contrato), `recurring_occurrences` (vencimentos já
 * alcançados) e `recurring_events` (trilha; dela sai o histórico de valores).
 * Valores em centavos inteiros; datas civis `YYYY-MM-DD`. Nada aqui é
 * escrito pelo cliente — as Rules negam toda escrita.
 */
export type { RecurringFrequency } from './schedule.ts';

export type RecurringType = 'subscription' | 'fixed_bill' | 'service' | 'other';
export type RecurringPaymentMethod = 'credit_card' | 'pix' | 'boleto' | 'debit' | 'cash' | 'other';
export type RecurringExecutionMode = 'automatic' | 'confirmation_required';
export type RecurringStatus = 'active' | 'paused' | 'ended' | 'cancelled';
export type RecurringBusinessType =
  | 'saas' | 'rent' | 'internet' | 'energy' | 'water' | 'accounting' | 'taxes'
  | 'services' | 'other';

export interface RecurringVisual {
  color: string;
  icon: string;
  emoji: string | null;
}

export interface RecurringBusinessDetails {
  supplier: string | null;
  businessType: RecurringBusinessType | null;
  costCenter: string | null;
  responsible: string | null;
  adjustmentDate: string | null;
  commitment: string | null;
}

export interface RecurringExpense {
  id: string;
  name: string;
  type: RecurringType;
  description: string | null;
  amountCents: number;
  frequency: RecurringFrequency;
  billingDay: number | null;
  startDate: string;
  endDate: string | null;
  paymentMethod: RecurringPaymentMethod;
  executionMode: RecurringExecutionMode;
  cardId: string | null;
  cashAccountId: string | null;
  /** ID estável da categoria de despesa do catálogo (D-37.8). */
  categoryId: string;
  /** Retrato do nome da categoria, gravado pelo backend. */
  category: string;
  status: RecurringStatus;
  nextDueDate: string | null;
  lastProcessedDueDate: string | null;
  /** Ocorrências aguardando confirmação ou exigindo atenção. */
  openOccurrenceCount: number;
  visual: RecurringVisual;
  business: RecurringBusinessDetails | null;
  createdBy: string;
  revision: number;
  /** Versão lida (`updatedAt`) em ISO com nanossegundos, para `expectedUpdatedAt`. */
  version: string;
}

export type OccurrenceStatus =
  | 'awaiting_confirmation'
  | 'generated'
  | 'ignored'
  | 'attention_required';

export type AttentionCode =
  | 'card_unavailable'
  | 'card_archived'
  | 'limit_insufficient'
  | 'account_unavailable'
  | 'account_archived'
  | 'workspace_unavailable';

export interface RecurringOccurrence {
  id: string;
  recurringExpenseId: string;
  dueDate: string;
  competenceMonth: string;
  plannedAmountCents: number;
  actualAmountCents: number | null;
  status: OccurrenceStatus;
  targetDomain: 'cash' | 'card';
  executionMode: RecurringExecutionMode;
  cardId: string | null;
  cashAccountId: string | null;
  cashTransactionId: string | null;
  cardPurchaseId: string | null;
  attentionCode: AttentionCode | null;
  settlement: 'pending' | 'paid' | null;
}

/** Uma alteração de valor da trilha (criação ou reajuste). */
export interface RecurringAmountChange {
  id: string;
  /** Data civil do evento em São Paulo. */
  date: string;
  previousCents: number | null;
  nextCents: number;
  reason: string | null;
}

/** Estado atual do fato gerado por uma ocorrência, lido do domínio de destino. */
export type GeneratedFactState =
  | { domain: 'cash'; status: 'pending' | 'confirmed' | 'voided'; amountCents: number }
  | { domain: 'card'; status: 'active' | 'cancelled' | 'refunded'; amountCents: number };
