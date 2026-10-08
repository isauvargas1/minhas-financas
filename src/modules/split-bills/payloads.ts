import { parseDecimalAmountToCents } from '../transactions/cashEntry.ts';
import type {
  SplitAllocationMethod,
  SplitAssignableRole,
  SplitBusinessMode,
  SplitFinancialIntegration,
  SplitGroupType,
  SplitShare,
  SplitVisual,
} from './types.ts';

/**
 * Formulários da Divisão de contas → contrato das callables (P4-C). Módulo
 * puro.
 *
 * Valor digitado em reais vira centavos inteiros e percentual vira basis
 * points (100% = 10.000) por aritmética de texto, nunca por `parseFloat`.
 * O rateio exibido no formulário é só prévia (mesma regra do backend: maior
 * resto, participantes ordenados pelo ID); quem decide é o servidor. Sem
 * tolerância: a soma tem de fechar exatamente. O payload não leva nada
 * autoritativo — nem dono, nem estado, nem valores dos rateios no modo
 * igual/percentual, nem vínculo financeiro.
 */
export class SplitInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitInputError';
  }
}

export const SPLIT_TEXT_LIMITS = {
  groupName: 80,
  groupDescription: 300,
  externalName: 60,
  billDescription: 120,
  category: 80,
  emoji: 16,
  reason: 140,
} as const;

export const SPLIT_BPS_TOTAL = 10_000;
export const SPLIT_MAX_SHARES = 50;
export const SPLIT_MAX_INSTALLMENTS = 60;
export const INVITE_CODE_LENGTH = 10;
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Categoria usada quando o catálogo do espaço não tem nenhuma de despesa. */
export const SPLIT_FALLBACK_CATEGORY = 'Sem categoria';

/** Valor digitado (`1234.56`) → centavos, ou `null`. */
export const amountInputToCents = (input: string): number | null => {
  const text = (input ?? '').trim();
  if (!text) return null;
  return parseDecimalAmountToCents(text);
};

/** Centavos → valor do `input type="number"` (`1234.56`), sem ponto flutuante. */
export const centsToAmountInput = (cents: number): string => {
  if (!Number.isSafeInteger(cents) || cents <= 0) return '';
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
};

/** Percentual digitado (`33.33`) → basis points (`3333`), ou `null`. */
export const percentInputToBps = (input: string): number | null => {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec((input ?? '').trim());
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps > 0 && bps <= SPLIT_BPS_TOTAL ? bps : null;
};

/** Basis points → percentual do campo (`3333` → `33.33`). */
export const bpsToPercentInput = (bps: number): string => {
  if (!Number.isSafeInteger(bps) || bps <= 0) return '';
  const cents = bps % 100;
  return cents === 0 ? String(bps / 100) : `${Math.floor(bps / 100)}.${String(cents).padStart(2, '0')}`;
};

/** Código do convite como o backend o normaliza (sem espaços e hífens, maiúsculo). */
export const normalizeInviteCode = (input: string): string =>
  (input ?? '').replace(/[\s-]/g, '').toUpperCase();

export const isValidInviteCode = (code: string): boolean =>
  code.length === INVITE_CODE_LENGTH &&
  [...code].every((char) => INVITE_CODE_ALPHABET.includes(char));

// ----------------------------------------------------------------- rateio

export interface AllocationInput {
  participantId: string;
  weightBps?: number | null;
  amountCents?: number | null;
}

/** Ordem do backend: comparação de texto pelo ID do participante. */
const byParticipantId = (left: AllocationInput, right: AllocationInput) =>
  left.participantId < right.participantId ? -1 : left.participantId > right.participantId ? 1 : 0;

/** Maior resto em inteiros (mesma regra de `allocateCents`, D-34). */
const largestRemainder = (total: number, weights: readonly number[]): number[] => {
  const totalBig = BigInt(total);
  const weightSum = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);
  const shares = weights.map((weight, index) => ({
    index,
    quotient: (totalBig * BigInt(weight)) / weightSum,
    remainder: (totalBig * BigInt(weight)) % weightSum,
  }));
  let leftover = totalBig - shares.reduce((sum, share) => sum + share.quotient, 0n);
  const order = [...shares].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (const share of order) {
    if (leftover === 0n) break;
    share.quotient += 1n;
    leftover -= 1n;
  }
  return shares.map((share) => Number(share.quotient));
};

export type AllocationPreview =
  | { ok: true; shares: Record<string, number>; differenceCents: number; differenceBps: number }
  | { ok: false; shares: Record<string, number>; differenceCents: number; differenceBps: number;
      message: string };

/**
 * Prévia exata do rateio. Igual: maior resto. Percentual: pesos em basis
 * points somando 10.000. Fixo: valores somando o total. `difference*` é o
 * que falta (positivo) ou sobra (negativo) para fechar.
 */
export const previewAllocation = (input: {
  amountCents: number | null;
  method: SplitAllocationMethod;
  participants: readonly AllocationInput[];
}): AllocationPreview => {
  const ordered = [...input.participants].sort(byParticipantId);
  const empty = { shares: {} as Record<string, number>, differenceCents: 0, differenceBps: 0 };
  if (ordered.length === 0) {
    return { ok: false, ...empty, message: 'Escolha pelo menos um participante.' };
  }
  if (ordered.length > SPLIT_MAX_SHARES) {
    return { ok: false, ...empty, message: `No máximo ${SPLIT_MAX_SHARES} participantes por despesa.` };
  }
  const total = input.amountCents;
  if (input.method === 'fixed') {
    const amounts = ordered.map((item) => item.amountCents ?? null);
    const known = amounts.reduce<number>((sum, cents) => sum + (cents ?? 0), 0);
    const shares = Object.fromEntries(ordered.map((item, index) => [item.participantId, amounts[index] ?? 0]));
    const differenceCents = (total ?? 0) - known;
    if (total === null) return { ok: false, shares, differenceCents, differenceBps: 0, message: 'Informe o valor total.' };
    if (amounts.some((cents) => cents === null || cents <= 0)) {
      return { ok: false, shares, differenceCents, differenceBps: 0,
        message: 'Informe um valor maior que zero para cada participante.' };
    }
    if (differenceCents !== 0) {
      return { ok: false, shares, differenceCents, differenceBps: 0,
        message: 'A soma dos valores precisa ser exatamente o valor total.' };
    }
    return { ok: true, shares, differenceCents: 0, differenceBps: 0 };
  }
  if (input.method === 'percentage') {
    const weights = ordered.map((item) => item.weightBps ?? null);
    const sum = weights.reduce<number>((total, weight) => total + (weight ?? 0), 0);
    const differenceBps = SPLIT_BPS_TOTAL - sum;
    const complete = weights.every((weight) => weight !== null && weight > 0);
    const parts = total !== null && complete && sum > 0 ?
      largestRemainder(total, weights as number[]) : null;
    const shares: Record<string, number> = parts ?
      Object.fromEntries(ordered.map((item, index) => [item.participantId, parts[index]])) : {};
    if (total === null) return { ok: false, shares, differenceCents: 0, differenceBps, message: 'Informe o valor total.' };
    if (!complete) {
      return { ok: false, shares, differenceCents: 0, differenceBps,
        message: 'Informe um percentual maior que zero para cada participante.' };
    }
    if (differenceBps !== 0) {
      return { ok: false, shares, differenceCents: 0, differenceBps,
        message: 'Os percentuais precisam somar exatamente 100%.' };
    }
    return { ok: true, shares, differenceCents: 0, differenceBps: 0 };
  }
  if (total === null) return { ok: false, ...empty, message: 'Informe o valor total.' };
  const parts = largestRemainder(total, ordered.map(() => 1));
  return {
    ok: true,
    shares: Object.fromEntries(ordered.map((item, index) => [item.participantId, parts[index]])),
    differenceCents: 0,
    differenceBps: 0,
  };
};

// ------------------------------------------------------------------ grupo

export interface SplitGroupFormState {
  name: string;
  description: string;
  groupType: SplitGroupType;
  businessMode: SplitBusinessMode;
  color: string;
  icon: string;
  emoji: string;
}

const clean = (value: string) => (value ?? '').trim().replace(/\s+/g, ' ');

const requireText = (value: string, label: string, max: number): string => {
  const text = clean(value);
  if (!text) throw new SplitInputError(`${label}: valor obrigatório.`);
  if (text.length > max) throw new SplitInputError(`${label}: até ${max} caracteres.`);
  return text;
};

const optionalText = (value: string, label: string, max: number): string | null => {
  const text = clean(value);
  if (!text) return null;
  if (text.length > max) throw new SplitInputError(`${label}: até ${max} caracteres.`);
  return text;
};

const visualOf = (form: SplitGroupFormState): SplitVisual => ({
  color: form.color,
  icon: form.icon,
  emoji: optionalText(form.emoji, 'Emoji', SPLIT_TEXT_LIMITS.emoji),
});

export const toCreateGroupPayload = (form: SplitGroupFormState) => ({
  name: requireText(form.name, 'Nome do grupo', SPLIT_TEXT_LIMITS.groupName),
  description: optionalText(form.description, 'Descrição', SPLIT_TEXT_LIMITS.groupDescription),
  groupType: form.groupType,
  businessMode: form.businessMode,
  visual: visualOf(form),
});

/** Só os campos alterados (o modo do grupo não muda depois de criado). */
export const toGroupChanges = (
  form: SplitGroupFormState,
  current: { name: string; description: string | null; groupType: SplitGroupType; visual: SplitVisual },
): Record<string, unknown> => {
  const next = toCreateGroupPayload(form);
  const changes: Record<string, unknown> = {};
  if (next.name !== current.name) changes.name = next.name;
  if (next.description !== current.description) changes.description = next.description;
  if (next.groupType !== current.groupType) changes.groupType = next.groupType;
  if (
    next.visual.color !== current.visual.color || next.visual.icon !== current.visual.icon ||
    next.visual.emoji !== current.visual.emoji
  ) {
    changes.visual = next.visual;
  }
  return changes;
};

export const toExternalParticipantPayload = (groupId: string, displayName: string) => ({
  groupId,
  displayName: requireText(displayName, 'Nome do participante', SPLIT_TEXT_LIMITS.externalName),
});

export const toWorkspaceParticipantPayload = (
  groupId: string,
  userId: string,
  role: SplitAssignableRole,
) => {
  if (!userId) throw new SplitInputError('Escolha o membro do espaço.');
  return { groupId, userId, role };
};

// ----------------------------------------------------------------- título

export interface SplitBillFormState {
  description: string;
  category: string;
  amount: string;
  expenseDate: string;
  payerParticipantId: string;
  method: SplitAllocationMethod;
  participantIds: string[];
  /** Por participante: percentual (`33.33`) ou valor (`12.50`) digitado. */
  inputs: Record<string, string>;
  integrate: boolean;
  /** `cash`: dinheiro/pix (conta do Caixa); `card`: cartão de crédito. */
  paymentKind: 'cash' | 'card';
  cashAccountId: string;
  cardId: string;
  installments: string;
}

/** Termos financeiros do formulário (lança com a mensagem da primeira falha). */
export const toBillTerms = (form: SplitBillFormState) => {
  const amountCents = amountInputToCents(form.amount);
  if (amountCents === null) {
    throw new SplitInputError('Valor total: informe um valor maior que zero, com até duas casas decimais.');
  }
  if (!form.expenseDate) throw new SplitInputError('Informe a data da despesa.');
  if (!form.payerParticipantId) throw new SplitInputError('Escolha quem pagou.');
  const participants: AllocationInput[] = form.participantIds.map((participantId) => {
    if (form.method === 'percentage') {
      return { participantId, weightBps: percentInputToBps(form.inputs[participantId] ?? '') };
    }
    if (form.method === 'fixed') {
      return { participantId, amountCents: amountInputToCents(form.inputs[participantId] ?? '') };
    }
    return { participantId };
  });
  const preview = previewAllocation({ amountCents, method: form.method, participants });
  if ('message' in preview) throw new SplitInputError(preview.message);
  let financialIntegration: SplitFinancialIntegration = 'none';
  let cashAccountId: string | null = null;
  let cardId: string | null = null;
  let installmentsCount: number | null = null;
  if (form.integrate) {
    if (form.paymentKind === 'card') {
      financialIntegration = 'card';
      if (!form.cardId) throw new SplitInputError('Escolha o cartão da compra.');
      cardId = form.cardId;
      const count = Number(form.installments);
      if (!Number.isSafeInteger(count) || count < 1 || count > SPLIT_MAX_INSTALLMENTS) {
        throw new SplitInputError(`Parcelas: de 1 a ${SPLIT_MAX_INSTALLMENTS}.`);
      }
      installmentsCount = count;
    } else {
      financialIntegration = 'cash';
      if (!form.cashAccountId) throw new SplitInputError('Escolha a conta de onde saiu o pagamento.');
      cashAccountId = form.cashAccountId;
    }
  }
  return {
    amountCents,
    expenseDate: form.expenseDate,
    payerParticipantId: form.payerParticipantId,
    allocationMethod: form.method,
    participants: participants.map((item) =>
      form.method === 'percentage' ? { participantId: item.participantId, weightBps: item.weightBps } :
        form.method === 'fixed' ? { participantId: item.participantId, amountCents: item.amountCents } :
          { participantId: item.participantId }),
    financialIntegration,
    cashAccountId,
    cardId,
    installmentsCount,
  };
};

export const billMetadataOf = (form: SplitBillFormState) => ({
  description: requireText(form.description, 'Descrição', SPLIT_TEXT_LIMITS.billDescription),
  category: requireText(form.category || SPLIT_FALLBACK_CATEGORY, 'Categoria', SPLIT_TEXT_LIMITS.category),
});

export const toCreateBillPayload = (groupId: string, form: SplitBillFormState) => ({
  groupId,
  ...billMetadataOf(form),
  ...toBillTerms(form),
});

/** Entradas do formulário a partir dos rateios gravados (edição preserva o método). */
export const inputsFromShares = (
  method: SplitAllocationMethod,
  shares: readonly SplitShare[],
): Record<string, string> => Object.fromEntries(shares
  .filter((share) => share.status !== 'voided')
  .map((share) => [
    share.participantId,
    method === 'percentage' ? bpsToPercentInput(share.weightBps ?? 0) :
      method === 'fixed' ? centsToAmountInput(share.amountDueCents) : '',
  ]));

// -------------------------------------------------------------- reembolso

export interface SplitReimbursementFormState {
  description: string;
  category: string;
  amount: string;
  expenseDate: string;
  requesterParticipantId: string;
}

export const toCreateReimbursementPayload = (groupId: string, form: SplitReimbursementFormState) => {
  const amountCents = amountInputToCents(form.amount);
  if (amountCents === null) {
    throw new SplitInputError('Valor: informe um valor maior que zero, com até duas casas decimais.');
  }
  if (!form.expenseDate) throw new SplitInputError('Informe a data da despesa.');
  if (!form.requesterParticipantId) throw new SplitInputError('Escolha quem pede o reembolso.');
  return {
    groupId,
    requesterParticipantId: form.requesterParticipantId,
    description: requireText(form.description, 'Descrição', SPLIT_TEXT_LIMITS.billDescription),
    category: requireText(form.category || SPLIT_FALLBACK_CATEGORY, 'Categoria', SPLIT_TEXT_LIMITS.category),
    amountCents,
    expenseDate: form.expenseDate,
  };
};

export const requireReason = (reason: string): string =>
  requireText(reason, 'Motivo', SPLIT_TEXT_LIMITS.reason);
