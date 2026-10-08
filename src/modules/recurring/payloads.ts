import { parseDecimalAmountToCents } from '../transactions/cashEntry.ts';
import { isCivilDayKey, usesBillingDay } from './schedule.ts';
import type {
  RecurringBusinessDetails,
  RecurringBusinessType,
  RecurringExecutionMode,
  RecurringExpense,
  RecurringFrequency,
  RecurringPaymentMethod,
  RecurringType,
} from './types.ts';

/**
 * Formulário de Recorrentes → contrato das callables (P4-B). Módulo puro.
 *
 * Valor digitado em reais vira centavos inteiros por aritmética de texto
 * (`parseDecimalAmountToCents`), nunca por `parseFloat`. O payload não leva
 * nada autoritativo: nem estado, nem próximo vencimento, nem origem dos
 * fatos — só o contrato. O modo de execução é sempre explícito.
 */
export class RecurringInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurringInputError';
  }
}

export const RECURRING_TEXT_LIMITS = {
  name: 80,
  description: 300,
  category: 80,
  supplier: 80,
  costCenter: 80,
  responsible: 80,
  commitment: 120,
  emoji: 16,
  reason: 140,
} as const;

/** Categoria padrão do formulário ("Padrão (Recorrentes)"). */
export const DEFAULT_RECURRING_CATEGORY = 'Recorrentes';

export interface RecurringFormState {
  name: string;
  type: RecurringType;
  description: string;
  amount: string;
  frequency: RecurringFrequency;
  billingDay: string;
  startDate: string;
  endDate: string;
  paymentMethod: RecurringPaymentMethod;
  executionMode: RecurringExecutionMode;
  cardId: string;
  cashAccountId: string;
  category: string;
  color: string;
  icon: string;
  emoji: string;
  supplier: string;
  businessType: RecurringBusinessType;
  costCenter: string;
  responsible: string;
  adjustmentDate: string;
  commitment: string;
}

/** Valor digitado (`1234.56`) → centavos, ou `null`. */
export const amountInputToCents = (input: string): number | null => {
  const text = (input ?? '').trim();
  if (!text) return null;
  return parseDecimalAmountToCents(text);
};

/** Centavos → valor do `input type="number"` (`1234.56`), sem ponto flutuante. */
export const centsToNumberInput = (cents: number): string => {
  if (!Number.isSafeInteger(cents) || cents <= 0) return '';
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
};

const requiredText = (value: string, label: string, max: number): string => {
  const text = value.trim();
  if (!text) throw new RecurringInputError(`${label}: valor obrigatório.`);
  if (text.length > max) throw new RecurringInputError(`${label}: até ${max} caracteres.`);
  return text;
};

const optionalText = (value: string, label: string, max: number): string | null => {
  const text = value.trim();
  if (!text) return null;
  if (text.length > max) throw new RecurringInputError(`${label}: até ${max} caracteres.`);
  return text;
};

const optionalDay = (value: string, label: string): string | null => {
  const text = value.trim();
  if (!text) return null;
  if (!isCivilDayKey(text)) throw new RecurringInputError(`${label}: informe uma data válida.`);
  return text;
};

export interface RecurringContractFields {
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
  category: string;
  visual: { color: string; icon: string; emoji: string | null };
  business: RecurringBusinessDetails | null;
}

/** Contrato completo validado a partir do formulário. */
export const toContractFields = (
  form: RecurringFormState,
  isPJ: boolean,
): RecurringContractFields => {
  const name = requiredText(form.name, 'Nome', RECURRING_TEXT_LIMITS.name);
  const amountCents = amountInputToCents(form.amount);
  if (amountCents === null) {
    throw new RecurringInputError('Valor previsto: informe um valor maior que zero, com até duas casas decimais.');
  }
  let billingDay: number | null = null;
  if (usesBillingDay(form.frequency)) {
    const day = /^\d{1,2}$/.test(form.billingDay.trim()) ? Number(form.billingDay.trim()) : NaN;
    if (!Number.isSafeInteger(day) || day < 1 || day > 31) {
      throw new RecurringInputError('Dia do vencimento: use um dia entre 1 e 31.');
    }
    billingDay = day;
  }
  if (!isCivilDayKey(form.startDate)) {
    throw new RecurringInputError('Início: informe uma data válida.');
  }
  const endDate = optionalDay(form.endDate, 'Término');
  if (endDate !== null && endDate < form.startDate) {
    throw new RecurringInputError('Término: não pode ser anterior ao início.');
  }
  const card = form.paymentMethod === 'credit_card';
  if (card && !form.cardId) {
    throw new RecurringInputError('Selecione o cartão de crédito da recorrência.');
  }
  if (!card && !form.cashAccountId) {
    throw new RecurringInputError('Selecione a conta da recorrência.');
  }
  return {
    name,
    type: form.type,
    description: optionalText(form.description, 'Notas adicionais', RECURRING_TEXT_LIMITS.description),
    amountCents,
    frequency: form.frequency,
    billingDay,
    startDate: form.startDate,
    endDate,
    paymentMethod: form.paymentMethod,
    executionMode: form.executionMode,
    cardId: card ? form.cardId : null,
    cashAccountId: card ? null : form.cashAccountId,
    category: requiredText(form.category || DEFAULT_RECURRING_CATEGORY, 'Categoria',
      RECURRING_TEXT_LIMITS.category),
    visual: {
      color: form.color,
      icon: form.icon,
      emoji: optionalText(form.emoji, 'Emoji', RECURRING_TEXT_LIMITS.emoji),
    },
    business: isPJ ? {
      supplier: optionalText(form.supplier, 'Fornecedor', RECURRING_TEXT_LIMITS.supplier),
      businessType: form.businessType,
      costCenter: optionalText(form.costCenter, 'Centro de custo', RECURRING_TEXT_LIMITS.costCenter),
      responsible: optionalText(form.responsible, 'Responsável', RECURRING_TEXT_LIMITS.responsible),
      adjustmentDate: optionalDay(form.adjustmentDate, 'Próximo reajuste'),
      commitment: optionalText(form.commitment, 'Fidelidade', RECURRING_TEXT_LIMITS.commitment),
    } : null,
  };
};

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/**
 * Edição: só os campos que mudaram em relação ao contrato lido. Sem
 * alteração, recusa (o backend também recusa).
 */
export const toUpdateChanges = (
  original: RecurringExpense,
  form: RecurringFormState,
  isPJ: boolean,
): Partial<RecurringContractFields> => {
  const next = toContractFields(form, isPJ);
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof RecurringContractFields)[]) {
    if (!sameValue(next[key], original[key])) changes[key] = next[key];
  }
  if (Object.keys(changes).length === 0) {
    throw new RecurringInputError('Nenhuma alteração para salvar.');
  }
  return changes as Partial<RecurringContractFields>;
};

/** Formulário de um contrato existente. */
export const formFromExpense = (expense: RecurringExpense): RecurringFormState => ({
  name: expense.name,
  type: expense.type,
  description: expense.description ?? '',
  amount: centsToNumberInput(expense.amountCents),
  frequency: expense.frequency,
  billingDay: expense.billingDay === null ? '' : String(expense.billingDay),
  startDate: expense.startDate,
  endDate: expense.endDate ?? '',
  paymentMethod: expense.paymentMethod,
  executionMode: expense.executionMode,
  cardId: expense.cardId ?? '',
  cashAccountId: expense.cashAccountId ?? '',
  category: expense.category,
  color: expense.visual.color,
  icon: expense.visual.icon,
  emoji: expense.visual.emoji ?? '',
  supplier: expense.business?.supplier ?? '',
  businessType: expense.business?.businessType ?? 'saas',
  costCenter: expense.business?.costCenter ?? '',
  responsible: expense.business?.responsible ?? '',
  adjustmentDate: expense.business?.adjustmentDate ?? '',
  commitment: expense.business?.commitment ?? '',
});

/** Formulário vazio: Automático por padrão, início hoje, vencimento no dia de hoje. */
export const emptyForm = (isPJ: boolean, today: string, defaults: {
  color: string;
  icon: string;
}): RecurringFormState => ({
  name: '',
  type: 'subscription',
  description: '',
  amount: '',
  frequency: 'monthly',
  billingDay: String(Number(today.slice(8, 10))),
  startDate: today,
  endDate: '',
  paymentMethod: isPJ ? 'boleto' : 'credit_card',
  executionMode: 'automatic',
  cardId: '',
  cashAccountId: '',
  category: DEFAULT_RECURRING_CATEGORY,
  color: defaults.color,
  icon: defaults.icon,
  emoji: '',
  supplier: '',
  businessType: 'saas',
  costCenter: '',
  responsible: '',
  adjustmentDate: '',
  commitment: '',
});

/**
 * Custo mensal estimado de um contrato, em centavos inteiros, para o resumo
 * da tela: semanal × 4, quinzenal × 2, bimestral ÷ 2, trimestral ÷ 3,
 * semestral ÷ 6, anual ÷ 12, arredondado ao centavo. É estimativa de
 * exibição, nunca valor autoritativo.
 */
export const monthlyEstimateCents = (expense: Pick<RecurringExpense, 'amountCents' | 'frequency'>): number => {
  const factor: Record<RecurringFrequency, [number, number]> = {
    weekly: [4, 1],
    biweekly: [2, 1],
    monthly: [1, 1],
    bimonthly: [1, 2],
    quarterly: [1, 3],
    semiannual: [1, 6],
    annual: [1, 12],
  };
  const [numerator, denominator] = factor[expense.frequency];
  return Math.round((expense.amountCents * numerator) / denominator);
};

/** Confirmação de ocorrência: valor real opcional em centavos. */
export const actualAmountToCents = (input: string): number => {
  const cents = amountInputToCents(input);
  if (cents === null) {
    throw new RecurringInputError('Valor real: informe um valor maior que zero, com até duas casas decimais.');
  }
  return cents;
};
