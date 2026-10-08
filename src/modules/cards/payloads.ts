import { parseDecimalAmountToCents } from '../transactions/cashEntry.ts';
import { firstOpenCompetence, naturalCompetenceOf, addMonthsToMonthKey, dueDateOf } from './cycle.ts';
import { CardInputError } from './presentation.ts';
import type { CardInvoice, CreditCard, CreditCardBrand, CreditCardVisual } from './types.ts';

/**
 * Payloads das callables de cartões (P4-A), sem a chave de idempotência.
 * Módulo puro: valores digitados viram centavos inteiros por leitura de
 * texto, nunca por ponto flutuante; nada autoritativo (limite usado,
 * faturas, parcelas, origem da compra, autoria) é enviado.
 */
export const CARD_MAX_INSTALLMENTS = 60;
export const CARD_MAX_CENTS = 100_000_000_000;

export const CARD_TEXT_LIMITS = {
  name: 80,
  observations: 500,
  responsiblePerson: 80,
  recommendedUse: 200,
  costCenter: 80,
  description: 140,
  category: 80,
  supplier: 80,
  reason: 300,
} as const;

/**
 * Valor de campo de dinheiro → centavos. Todos os campos de valor de cartão
 * são `input type="number"`, que entrega sempre ponto decimal (`1234.5`):
 * `12.345` é três casas (recusado), nunca milhar brasileiro. Nada passa por
 * `parseFloat`.
 */
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
  const text = (value ?? '').trim();
  if (!text) throw new CardInputError(`Informe ${label}.`);
  if (text.length > max) {
    throw new CardInputError(`${label[0].toUpperCase()}${label.slice(1)}: até ${max} caracteres.`);
  }
  return text;
};

const optionalText = (value: string | undefined, label: string, max: number): string | null => {
  const text = (value ?? '').trim();
  if (!text) return null;
  if (text.length > max) throw new CardInputError(`${label}: até ${max} caracteres.`);
  return text;
};

const dayOf = (value: string | number | undefined, label: string): number => {
  const day = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isSafeInteger(day) || day < 1 || day > 31) {
    throw new CardInputError(`${label}: use um dia entre 1 e 31.`);
  }
  return day;
};

/** Formulário do cartão (o mesmo da tela), em texto. */
export interface CreditCardFormValues {
  name: string;
  brand: CreditCardBrand;
  limitTotal: string;
  closingDay: string;
  dueDay: string;
  bestDay: string;
  observations: string;
  responsiblePerson?: string;
  recommendedUse?: string;
  defaultCostCenter?: string;
  visual: CreditCardVisual;
}

const visualPayload = (visual: CreditCardVisual): Record<string, unknown> => ({
  bgType: visual.bgType,
  bgColor: visual.bgColor,
  bgGradientColor: visual.bgType === 'gradient' && visual.bgGradientColor
    ? visual.bgGradientColor
    : null,
  bgImage: visual.bgType === 'image' && visual.bgImage ? visual.bgImage : null,
  textColor: visual.textColor,
  showName: visual.showName,
  showBrand: visual.showBrand,
  showLogo: visual.showLogo,
});

const profilePayload = (form: CreditCardFormValues): Record<string, unknown> => {
  const limitTotalCents = amountInputToCents(form.limitTotal);
  if (limitTotalCents === null || limitTotalCents <= 0 || limitTotalCents > CARD_MAX_CENTS) {
    throw new CardInputError('Limite total: informe um valor maior que zero, com até duas casas decimais.');
  }
  return {
    name: requiredText(form.name, 'o apelido do cartão', CARD_TEXT_LIMITS.name),
    brand: form.brand,
    closingDay: dayOf(form.closingDay, 'Dia de fechamento'),
    dueDay: dayOf(form.dueDay, 'Dia de vencimento'),
    bestDay: form.bestDay?.trim() ? dayOf(form.bestDay, 'Melhor dia') : null,
    observations: optionalText(form.observations, 'Observações', CARD_TEXT_LIMITS.observations),
    responsiblePerson: optionalText(form.responsiblePerson, 'Responsável', CARD_TEXT_LIMITS.responsiblePerson),
    recommendedUse: optionalText(form.recommendedUse, 'Uso recomendado', CARD_TEXT_LIMITS.recommendedUse),
    defaultCostCenter: optionalText(form.defaultCostCenter, 'Centro de custo', CARD_TEXT_LIMITS.costCenter),
    visual: visualPayload(form.visual),
    limitTotalCents,
  };
};

export const toCreateCreditCardPayload = (
  form: CreditCardFormValues,
  workspaceId: string,
): Record<string, unknown> => ({ workspaceId, ...profilePayload(form) });

const sameValue = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/** Só o que mudou em relação ao cartão lido; nada muda → erro de preenchimento. */
export const toUpdateCreditCardPayload = (
  card: CreditCard,
  form: CreditCardFormValues,
  workspaceId: string,
): Record<string, unknown> => {
  const next = profilePayload(form);
  const current: Record<string, unknown> = {
    name: card.name,
    brand: card.brand,
    closingDay: card.closingDay,
    dueDay: card.dueDay,
    bestDay: card.bestDay ?? null,
    observations: card.observations ?? null,
    responsiblePerson: card.responsiblePerson ?? null,
    recommendedUse: card.recommendedUse ?? null,
    defaultCostCenter: card.defaultCostCenter ?? null,
    visual: visualPayload(card.visual),
    limitTotalCents: card.limitTotalCents,
  };
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (!sameValue(value, current[key])) changes[key] = value;
  }
  if (Object.keys(changes).length === 0) {
    throw new CardInputError('Nenhuma alteração para salvar.');
  }
  return { workspaceId, cardId: card.id, expectedUpdatedAt: card.version, changes };
};

export const toCardStatusPayload = (
  card: CreditCard,
  workspaceId: string,
): Record<string, unknown> => ({ workspaceId, cardId: card.id, expectedUpdatedAt: card.version });

/** Compra manual: o valor total vai em centavos; parcelas e origem são do backend. */
export interface CardPurchaseFormValues {
  cardId: string;
  description: string;
  category: string;
  supplier?: string;
  costCenter?: string;
  purchaseDate: string;
  value: string;
  installments: string;
  valueType: 'total' | 'installment';
}

export const purchaseTotalCents = (
  value: string,
  installments: string,
  valueType: 'total' | 'installment',
): { totalCents: number; installmentsCount: number } | null => {
  const amount = amountInputToCents(value);
  const installmentsCount = Number.parseInt(installments, 10);
  if (
    amount === null || amount <= 0 ||
    !Number.isSafeInteger(installmentsCount) ||
    installmentsCount < 1 || installmentsCount > CARD_MAX_INSTALLMENTS
  ) {
    return null;
  }
  // "Valor da parcela": total exato = parcela × quantidade (inteiros).
  const totalCents = valueType === 'total' ? amount : amount * installmentsCount;
  if (!Number.isSafeInteger(totalCents) || totalCents > CARD_MAX_CENTS) return null;
  if (totalCents < installmentsCount) return null;
  return { totalCents, installmentsCount };
};

export const toCreateCardPurchasePayload = (
  form: CardPurchaseFormValues,
  workspaceId: string,
): Record<string, unknown> => {
  if (!form.cardId) throw new CardInputError('Selecione um cartão.');
  const amounts = purchaseTotalCents(form.value, form.installments, form.valueType);
  if (!amounts) {
    throw new CardInputError(
      `Informe um valor válido e de 1 a ${CARD_MAX_INSTALLMENTS} parcelas (cada parcela com ao menos R$ 0,01).`,
    );
  }
  return {
    workspaceId,
    cardId: form.cardId,
    description: requiredText(form.description, 'a descrição', CARD_TEXT_LIMITS.description),
    category: requiredText(form.category || 'Sem categoria', 'a categoria', CARD_TEXT_LIMITS.category),
    ...(form.supplier?.trim()
      ? { supplier: optionalText(form.supplier, 'Fornecedor', CARD_TEXT_LIMITS.supplier) }
      : {}),
    ...(form.costCenter?.trim()
      ? { costCenter: optionalText(form.costCenter, 'Centro de custo', CARD_TEXT_LIMITS.costCenter) }
      : {}),
    purchaseDate: form.purchaseDate,
    totalCents: amounts.totalCents,
    installmentsCount: amounts.installmentsCount,
  };
};

/** Divisão pelo maior resto (a mesma do backend), só para a prévia. */
export const splitCentsEvenly = (totalCents: number, count: number): number[] => {
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
};

export interface PurchasePreview {
  totalCents: number;
  installmentsCount: number;
  firstInstallmentCents: number;
  otherInstallmentCents: number;
  firstCompetence: string;
  firstDueDate: string;
  /** Competência onde caem as parcelas de ciclo já fechado (D-36), se houver. */
  retroactiveTarget: string | null;
  availableCents: number;
  availableAfterCents: number;
  insufficientLimit: boolean;
}

/** Prévia da compra em centavos, com a regra de publicação retroativa. */
export const purchasePreview = (input: {
  card: CreditCard;
  value: string;
  installments: string;
  valueType: 'total' | 'installment';
  purchaseDate: string;
  today: string;
}): PurchasePreview | null => {
  const amounts = purchaseTotalCents(input.value, input.installments, input.valueType);
  if (!amounts || !/^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate)) return null;
  const parts = splitCentsEvenly(amounts.totalCents, amounts.installmentsCount);
  const natural = naturalCompetenceOf(input.purchaseDate, input.card.closingDay);
  const open = firstOpenCompetence(input.today, input.card.closingDay);
  const first = natural < open ? open : natural;
  return {
    totalCents: amounts.totalCents,
    installmentsCount: amounts.installmentsCount,
    firstInstallmentCents: parts[0],
    otherInstallmentCents: parts[parts.length - 1],
    firstCompetence: first,
    firstDueDate: dueDateOf(first, input.card.closingDay, input.card.dueDay),
    retroactiveTarget: natural < open ? open : null,
    availableCents: input.card.limitAvailableCents,
    availableAfterCents: input.card.limitAvailableCents - amounts.totalCents,
    insufficientLimit: amounts.totalCents > input.card.limitAvailableCents,
  };
};

export const toInvoicePaymentPayload = (input: {
  workspaceId: string;
  invoice: CardInvoice;
  cashAccountId: string;
  amount: string;
  paymentDate: string;
}): Record<string, unknown> => {
  if (!input.cashAccountId) throw new CardInputError('Selecione a conta de onde sai o pagamento.');
  const amountCents = amountInputToCents(input.amount);
  if (amountCents === null || amountCents <= 0) {
    throw new CardInputError('Valor do pagamento: informe um valor maior que zero, com até duas casas decimais.');
  }
  return {
    workspaceId: input.workspaceId,
    cardId: input.invoice.cardId,
    invoiceId: input.invoice.id,
    cashAccountId: input.cashAccountId,
    amountCents,
    paymentDate: input.paymentDate,
    expectedUpdatedAt: input.invoice.version,
  };
};

export const toReversePaymentPayload = (input: {
  workspaceId: string;
  invoice: CardInvoice;
  paymentId: string;
}): Record<string, unknown> => ({
  workspaceId: input.workspaceId,
  paymentId: input.paymentId,
  expectedUpdatedAt: input.invoice.version,
});

export const toAdjustmentPayload = (input: {
  workspaceId: string;
  cardId: string;
  competenceMonth: string;
  amount: string;
  direction: 'debit' | 'credit';
  reason: string;
}): Record<string, unknown> => {
  const cents = amountInputToCents(input.amount);
  if (cents === null || cents <= 0) {
    throw new CardInputError('Valor do ajuste: informe um valor maior que zero, com até duas casas decimais.');
  }
  const reason = requiredText(input.reason, 'o motivo do ajuste', CARD_TEXT_LIMITS.reason);
  if (reason.length < 3) throw new CardInputError('Motivo do ajuste: mínimo de 3 caracteres.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.competenceMonth)) {
    throw new CardInputError('Escolha a competência da fatura.');
  }
  return {
    workspaceId: input.workspaceId,
    cardId: input.cardId,
    competenceMonth: input.competenceMonth,
    amountCents: input.direction === 'credit' ? -cents : cents,
    reason,
  };
};

export const toPurchaseMutationPayload = (input: {
  workspaceId: string;
  purchaseId: string;
  version: string;
}): Record<string, unknown> => ({
  workspaceId: input.workspaceId,
  purchaseId: input.purchaseId,
  expectedUpdatedAt: input.version,
});

/** Competências oferecidas no ajuste: algumas passadas, a aberta e próximas. */
export const adjustmentCompetences = (today: string, closingDay: number): string[] => {
  const open = firstOpenCompetence(today, closingDay);
  return Array.from({ length: 8 }, (_, index) => addMonthsToMonthKey(open, index - 3));
};
