import { clientsErrorView, type ClientsErrorView } from '../clients/presentation.ts';
import { RecurringInputError } from './payloads.ts';
import type {
  AttentionCode,
  GeneratedFactState,
  OccurrenceStatus,
  RecurringBusinessType,
  RecurringExecutionMode,
  RecurringExpense,
  RecurringFrequency,
  RecurringOccurrence,
  RecurringPaymentMethod,
  RecurringStatus,
  RecurringType,
} from './types.ts';

/**
 * Textos, permissões e erros de Recorrentes (P4-B). Módulo puro; tudo que
 * aparece ao usuário em pt-BR. Os identificadores internos (`active`,
 * `weekly`, `credit_card`) nunca são exibidos.
 */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface RecurringPermissions {
  /** Criar recorrência. */
  canCreate: boolean;
  /** Editar, pausar, retomar, cancelar e agir nas ocorrências desta recorrência. */
  canManage: boolean;
}

/**
 * Mesma matriz do backend: owner/admin administram tudo; member cria e
 * administra só as que criou; viewer só lê.
 */
export const recurringPermissions = (
  role: WorkspaceRole | null | undefined,
  uid: string | null | undefined,
  expense?: Pick<RecurringExpense, 'createdBy'> | null,
): RecurringPermissions => {
  const admin = role === 'owner' || role === 'admin';
  const member = role === 'member';
  return {
    canCreate: admin || member,
    canManage: admin || (member && Boolean(uid) && expense?.createdBy === uid),
  };
};

export const RECURRING_STATUS_LABELS: Record<RecurringStatus, string> = {
  active: 'Ativo',
  paused: 'Pausado',
  ended: 'Encerrado',
  cancelled: 'Cancelado',
};

export const RECURRING_STATUS_BADGE: Record<RecurringStatus, string> = {
  active: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  paused: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  ended: 'bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

export const RECURRING_TYPE_LABELS: Record<RecurringType, string> = {
  subscription: 'Assinatura',
  fixed_bill: 'Conta fixa',
  service: 'Serviço',
  other: 'Outro',
};

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: 'Semanal',
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
  bimonthly: 'Bimestral',
  quarterly: 'Trimestral',
  semiannual: 'Semestral',
  annual: 'Anual',
};

/** Sufixo do valor no cartão da recorrência (ex.: "/mês"). */
export const FREQUENCY_SUFFIX: Record<RecurringFrequency, string> = {
  weekly: '/semana',
  biweekly: '/15 dias',
  monthly: '/mês',
  bimonthly: '/2 meses',
  quarterly: '/3 meses',
  semiannual: '/6 meses',
  annual: '/ano',
};

export const PAYMENT_METHOD_LABELS: Record<RecurringPaymentMethod, string> = {
  credit_card: 'Cartão de crédito',
  pix: 'Pix / Transferência',
  boleto: 'Boleto',
  debit: 'Débito automático',
  cash: 'Dinheiro',
  other: 'Outro',
};

export const BUSINESS_TYPE_LABELS: Record<RecurringBusinessType, string> = {
  saas: 'SaaS',
  rent: 'Aluguel',
  internet: 'Internet',
  energy: 'Energia',
  water: 'Água',
  accounting: 'Contabilidade',
  taxes: 'Impostos',
  services: 'Serviços',
  other: 'Outro',
};

export const EXECUTION_MODE_LABELS: Record<RecurringExecutionMode, string> = {
  automatic: 'Automático',
  confirmation_required: 'Confirmar antes',
};

/** O que cada modo faz, por destino — mostrado no formulário. */
export const executionModeExplanation = (
  mode: RecurringExecutionMode,
  method: RecurringPaymentMethod,
): string => {
  if (mode === 'confirmation_required') {
    return 'No vencimento, a ocorrência fica aguardando a sua confirmação; nada é lançado antes disso.';
  }
  return method === 'credit_card'
    ? 'No vencimento, o sistema cria a compra no cartão escolhido, à vista, na fatura correspondente.'
    : 'No vencimento, o sistema gera uma despesa pendente no Caixa. Isso não é pagamento: a conta só é movimentada quando você confirmar o pagamento.';
};

export const OCCURRENCE_STATUS_LABELS: Record<OccurrenceStatus, string> = {
  awaiting_confirmation: 'Aguardando confirmação',
  generated: 'Gerada',
  ignored: 'Ignorada',
  attention_required: 'Requer atenção',
};

/** Motivo seguro de uma ocorrência que exigiu atenção, e o que fazer. */
export const ATTENTION_MESSAGES: Record<AttentionCode, string> = {
  card_unavailable: 'O cartão desta recorrência não foi encontrado. Escolha outro cartão e tente de novo.',
  card_archived: 'O cartão desta recorrência está arquivado. Reative-o ou escolha outro cartão e tente de novo.',
  limit_insufficient: 'O limite disponível do cartão não cobria o valor. Libere limite e tente de novo.',
  account_unavailable: 'A conta desta recorrência não foi encontrada. Escolha outra conta e tente de novo.',
  account_archived: 'A conta desta recorrência está arquivada. Reative-a ou escolha outra conta e tente de novo.',
  workspace_unavailable: 'O espaço de trabalho estava indisponível no vencimento. Tente de novo.',
};

export const TARGET_LABELS: Record<RecurringOccurrence['targetDomain'], string> = {
  cash: 'Caixa',
  card: 'Cartão',
};

/** Situação atual do fato gerado, como o domínio de destino a mostra. */
export const factStateLabel = (fact: GeneratedFactState | undefined): string => {
  if (!fact) return 'Fato gerado';
  if (fact.domain === 'cash') {
    if (fact.status === 'pending') return 'Despesa pendente no Caixa';
    if (fact.status === 'confirmed') return 'Paga no Caixa';
    return 'Lançamento anulado no Caixa';
  }
  if (fact.status === 'active') return 'Compra no cartão';
  if (fact.status === 'cancelled') return 'Compra cancelada';
  return 'Compra estornada';
};

export const recurringErrorView = (error: unknown): ClientsErrorView => {
  if (error instanceof RecurringInputError) {
    return { kind: 'validation', message: error.message, refresh: false };
  }
  return clientsErrorView(error);
};

const SHORT_DAY = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const LONG_DAY = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const MONTH_SHORT = new Intl.DateTimeFormat('pt-BR', { month: 'short', timeZone: 'UTC' });

/** Data civil como instante neutro (meio-dia UTC), só para formatar. */
const civilInstant = (dayKey: string): Date => {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
};

/** `2026-10-06` → `6 de out.` (sem fuso: a data é civil). */
export const formatDayShort = (dayKey: string | null | undefined): string =>
  dayKey ? SHORT_DAY.format(civilInstant(dayKey)) : '-';

/** `2026-10-06` → `6 de out. de 2026`. */
export const formatDayLong = (dayKey: string | null | undefined): string =>
  dayKey ? LONG_DAY.format(civilInstant(dayKey)) : '-';

/** Dia do mês e mês abreviado sem ponto, para o selo do vencimento. */
export const dayBadgeParts = (dayKey: string): { day: number; month: string } => ({
  day: Number(dayKey.slice(8, 10)),
  month: MONTH_SHORT.format(civilInstant(dayKey)).replace('.', ''),
});
