import {
  LOAN_MAX_INSTALLMENTS,
  addMonthsToDayKey,
  isDayKey,
  parseBrlToCents,
  parsePercentToRatePpm,
} from './money.ts';
import type {
  Loan,
  LoanAmortization,
  LoanInterestType,
  LoanMovement,
  LoanProfileType,
  LoanRatePeriod,
  LoanType,
  PJCounterpartyType,
  PJLoanClassification,
} from './types.ts';

/**
 * Formulários de empréstimo → payloads das callables (P3-H).
 *
 * Módulo puro. O frontend nunca envia saldo, status, cronograma, autoria nem
 * PF/PJ como autoridade: só os termos digitados (centavos e taxa inteira) e,
 * nas mutações, a versão lida (`expectedUpdatedAt`). As checagens daqui são
 * para dar o erro em pt-BR antes de chamar o backend; a decisão continua
 * sendo dele (datas, saldo, versão, papel, status, concorrência).
 */

/** Erro de preenchimento detectado antes de chamar o backend. */
export class LoanInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoanInputError';
  }
}

export const LOAN_TEXT_LIMITS = {
  personName: 120,
  personContact: 200,
  description: 300,
  costCenter: 200,
  reason: 300,
} as const;

export const PJ_ONLY_FIELDS = [
  'counterpartyType', 'cnpjCpf', 'classification', 'costCenter',
] as const;

export const AMOUNT_HINT = 'use vírgula para os centavos, como 1.234,56';

const text = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const limited = (value: string | undefined, label: string, max: number): string | undefined => {
  const trimmed = text(value);
  if (trimmed && trimmed.length > max) {
    throw new LoanInputError(`${label}: até ${max} caracteres.`);
  }
  return trimmed;
};

const digitsOf = (value: string): number[] => value.split('').map(Number);

const cpfIsValid = (digits: number[]): boolean => {
  const check = (length: number): number => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += digits[index] * (length + 1 - index);
    }
    return ((sum * 10) % 11) % 10;
  };
  return check(9) === digits[9] && check(10) === digits[10];
};

const cnpjIsValid = (digits: number[]): boolean => {
  const check = (weights: number[]): number => {
    const sum = weights.reduce((total, weight, index) => total + weight * digits[index], 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === digits[12] &&
    check([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === digits[13];
};

/**
 * CPF (11 dígitos) ou CNPJ (14) com dígitos verificadores; devolve só os
 * dígitos, como o backend grava. Mesma regra do backend, para o erro aparecer
 * no campo antes da chamada.
 */
export const normalizeCnpjCpf = (value: string): string => {
  const digits = value.replace(/[.\-/\s]/g, '');
  if (!/^(\d{11}|\d{14})$/.test(digits)) {
    throw new LoanInputError('CNPJ/CPF: informe 11 dígitos (CPF) ou 14 dígitos (CNPJ).');
  }
  const valid = !/^(\d)\1+$/.test(digits) && (digits.length === 11
    ? cpfIsValid(digitsOf(digits))
    : cnpjIsValid(digitsOf(digits)));
  if (!valid) throw new LoanInputError('CNPJ/CPF: número inválido (dígito verificador).');
  return digits;
};

export interface LoanCreateForm {
  type: LoanType;
  personName: string;
  personContact: string;
  description: string;
  /** Texto em reais (`1.234,56`). */
  principal: string;
  /** Conta/carteira do principal (D-30, P3-J). */
  cashAccountId: string;
  startDate: string;
  firstDueDate: string;
  installments: string;
  interestType: LoanInterestType;
  /** Juros fixos totais, em reais. */
  fixedInterest: string;
  /** Taxa em %, como digitada. */
  rate: string;
  ratePeriod: LoanRatePeriod;
  amortization: LoanAmortization | '';
  counterpartyType?: PJCounterpartyType | '';
  cnpjCpf?: string;
  classification?: PJLoanClassification | '';
  costCenter?: string;
}

/** Valores iniciais: contratação hoje, primeiro vencimento em um mês. */
export const emptyLoanCreateForm = (
  type: LoanType,
  today: string,
): LoanCreateForm => ({
  type,
  personName: '',
  personContact: '',
  description: '',
  principal: '',
  cashAccountId: '',
  startDate: today,
  firstDueDate: addMonthsToDayKey(today, 1),
  installments: '1',
  interestType: 'none',
  fixedInterest: '',
  rate: '',
  ratePeriod: 'monthly',
  amortization: '',
  counterpartyType: '',
  cnpjCpf: '',
  classification: '',
  costCenter: '',
});

const interestOf = (form: LoanCreateForm): Record<string, unknown> => {
  if (form.interestType === 'none') return { type: 'none' };
  if (form.interestType === 'fixed') {
    const totalInterestCents = parseBrlToCents(form.fixedInterest);
    if (totalInterestCents === null) {
      throw new LoanInputError(
        `Juros fixos: informe o valor total maior que zero (${AMOUNT_HINT}).`,
      );
    }
    return { type: 'fixed', totalInterestCents };
  }
  const ratePpm = parsePercentToRatePpm(form.rate);
  if (ratePpm === null) {
    throw new LoanInputError(
      'Taxa: informe um percentual maior que zero e até 100, com no máximo 4 casas decimais (ex.: 1,99).',
    );
  }
  if (form.ratePeriod !== 'monthly' && form.ratePeriod !== 'annual') {
    throw new LoanInputError('Taxa: escolha se é ao mês ou ao ano.');
  }
  if (form.amortization !== 'price' && form.amortization !== 'sac' &&
    form.amortization !== 'simple') {
    throw new LoanInputError('Amortização: escolha Tabela Price, SAC ou juros simples.');
  }
  return {
    type: 'percentage',
    ratePpm,
    ratePeriod: form.ratePeriod,
    amortization: form.amortization,
  };
};

/** Payload de `createLoan`, sem a chave de idempotência. */
export const toCreateLoanPayload = (
  form: LoanCreateForm,
  context: { workspaceId: string; profileType: LoanProfileType; today: string },
): Record<string, unknown> => {
  if (form.type !== 'borrow' && form.type !== 'lend') {
    throw new LoanInputError('Natureza: escolha se pegou emprestado ou emprestou.');
  }
  const personName = limited(form.personName, 'Contraparte', LOAN_TEXT_LIMITS.personName);
  if (!personName) throw new LoanInputError('Contraparte: informe o nome.');
  const principalCents = parseBrlToCents(form.principal);
  if (principalCents === null) {
    throw new LoanInputError(`Principal: informe um valor maior que zero (${AMOUNT_HINT}).`);
  }
  const cashAccountId = text(form.cashAccountId);
  if (!cashAccountId) {
    throw new LoanInputError('Conta/carteira: escolha a conta do principal.');
  }
  if (!isDayKey(form.startDate)) {
    throw new LoanInputError('Data da contratação: informe uma data válida.');
  }
  if (form.startDate > context.today) {
    throw new LoanInputError('Data da contratação: não pode ser futura.');
  }
  if (!isDayKey(form.firstDueDate)) {
    throw new LoanInputError('Primeiro vencimento: informe uma data válida.');
  }
  if (form.firstDueDate < form.startDate) {
    throw new LoanInputError('Primeiro vencimento: não pode ser anterior à contratação.');
  }
  const installments = /^\d{1,3}$/.test(form.installments.trim())
    ? Number(form.installments.trim())
    : NaN;
  if (!Number.isInteger(installments) || installments < 1 || installments > LOAN_MAX_INSTALLMENTS) {
    throw new LoanInputError(`Parcelas: informe um número inteiro de 1 a ${LOAN_MAX_INSTALLMENTS}.`);
  }
  if (principalCents < installments) {
    throw new LoanInputError('Parcelas: o principal precisa de ao menos 1 centavo por parcela.');
  }

  const optional: Record<string, unknown> = {
    personContact: limited(form.personContact, 'Contato', LOAN_TEXT_LIMITS.personContact),
    description: limited(form.description, 'Descrição', LOAN_TEXT_LIMITS.description),
  };
  const pjValues = {
    counterpartyType: text(form.counterpartyType ?? ''),
    cnpjCpf: text(form.cnpjCpf ?? ''),
    classification: text(form.classification ?? ''),
    costCenter: limited(form.costCenter, 'Centro de custo', LOAN_TEXT_LIMITS.costCenter),
  };
  if (context.profileType === 'PJ') {
    optional.counterpartyType = pjValues.counterpartyType;
    optional.cnpjCpf = pjValues.cnpjCpf ? normalizeCnpjCpf(pjValues.cnpjCpf) : undefined;
    optional.classification = pjValues.classification;
    optional.costCenter = pjValues.costCenter;
  } else if (Object.values(pjValues).some((value) => value !== undefined)) {
    throw new LoanInputError(
      'Tipo da contraparte, CNPJ/CPF, classificação e centro de custo são exclusivos de espaço PJ.',
    );
  }

  return {
    workspaceId: context.workspaceId,
    type: form.type,
    personName,
    principalCents,
    cashAccountId,
    startDate: form.startDate,
    firstDueDate: form.firstDueDate,
    installments,
    interest: interestOf(form),
    ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
  };
};

export interface LoanPaymentForm {
  /** Principal liquidado, em reais (pode ser zero se houver juros). */
  principal: string;
  /** Juros, em reais (pode ser zero). */
  interest: string;
  date: string;
  /** Conta/carteira da liquidação (D-30, P3-J). */
  cashAccountId: string;
}

/** Payload de `registerLoanPayment`, sem a chave. */
export const toPaymentPayload = (
  form: LoanPaymentForm,
  context: { workspaceId: string; loan: Loan; today: string },
): Record<string, unknown> => {
  const principalCents = form.principal.trim() === ''
    ? 0
    : parseBrlToCents(form.principal, { allowZero: true });
  const interestCents = form.interest.trim() === ''
    ? 0
    : parseBrlToCents(form.interest, { allowZero: true });
  if (principalCents === null) {
    throw new LoanInputError(`Principal: valor inválido (${AMOUNT_HINT}).`);
  }
  if (interestCents === null) {
    throw new LoanInputError(`Juros: valor inválido (${AMOUNT_HINT}).`);
  }
  if (principalCents + interestCents <= 0) {
    throw new LoanInputError('Informe o principal, os juros ou ambos, maior que zero.');
  }
  if (principalCents > context.loan.balanceCents) {
    throw new LoanInputError('O principal informado é maior que o saldo do empréstimo.');
  }
  if (!isDayKey(form.date)) throw new LoanInputError('Data: informe uma data válida.');
  if (form.date > context.today) throw new LoanInputError('Data: não pode ser futura.');
  if (form.date < context.loan.startDate) {
    throw new LoanInputError('Data: não pode ser anterior à contratação.');
  }
  const cashAccountId = text(form.cashAccountId);
  if (!cashAccountId) {
    throw new LoanInputError('Conta/carteira: escolha a conta da liquidação.');
  }
  return {
    workspaceId: context.workspaceId,
    loanId: context.loan.id,
    expectedUpdatedAt: context.loan.version,
    cashAccountId,
    date: form.date,
    principalCents,
    interestCents,
  };
};

const reasonOf = (reason: string): string => {
  const trimmed = reason.trim();
  if (!trimmed) throw new LoanInputError('Informe o motivo.');
  if (trimmed.length > LOAN_TEXT_LIMITS.reason) {
    throw new LoanInputError(`Motivo: até ${LOAN_TEXT_LIMITS.reason} caracteres.`);
  }
  return trimmed;
};

/** Payload de `reverseLoanMovement`, sem a chave. */
export const toReversePayload = (context: {
  workspaceId: string;
  loan: Loan;
  movement: LoanMovement;
  reason: string;
}): Record<string, unknown> => ({
  workspaceId: context.workspaceId,
  loanId: context.loan.id,
  movementId: context.movement.id,
  expectedUpdatedAt: context.loan.version,
  reason: reasonOf(context.reason),
});

/** Payload de `cancelLoan`, sem a chave. */
export const toCancelPayload = (context: {
  workspaceId: string;
  loan: Loan;
  reason: string;
}): Record<string, unknown> => ({
  workspaceId: context.workspaceId,
  loanId: context.loan.id,
  expectedUpdatedAt: context.loan.version,
  reason: reasonOf(context.reason),
});

export interface LoanMetadataForm {
  personName: string;
  personContact: string;
  description: string;
  counterpartyType?: PJCounterpartyType | '';
  cnpjCpf?: string;
  classification?: PJLoanClassification | '';
  costCenter?: string;
}

export const metadataFormOf = (loan: Loan): LoanMetadataForm => ({
  personName: loan.personName,
  personContact: loan.personContact ?? '',
  description: loan.description ?? '',
  counterpartyType: loan.counterpartyType ?? '',
  cnpjCpf: loan.cnpjCpf ?? '',
  classification: loan.classification ?? '',
  costCenter: loan.costCenter ?? '',
});

export const METADATA_UNCHANGED_MESSAGE = 'Altere ao menos um campo para salvar.';

/**
 * Payload de `updateLoanMetadata`, sem a chave: só os campos não financeiros
 * que mudaram (`null` remove um opcional). Principal, natureza, juros,
 * cronograma, saldo, acumulados e status não existem neste formulário.
 */
export const toMetadataPayload = (
  form: LoanMetadataForm,
  context: { workspaceId: string; loan: Loan },
): Record<string, unknown> => {
  const { loan } = context;
  const personName = limited(form.personName, 'Contraparte', LOAN_TEXT_LIMITS.personName);
  if (!personName) throw new LoanInputError('Contraparte: informe o nome.');
  const next: Record<string, string | undefined> = {
    personName,
    personContact: limited(form.personContact, 'Contato', LOAN_TEXT_LIMITS.personContact),
    description: limited(form.description, 'Descrição', LOAN_TEXT_LIMITS.description),
  };
  if (loan.profileType === 'PJ') {
    const cnpjCpf = text(form.cnpjCpf ?? '');
    next.counterpartyType = text(form.counterpartyType ?? '');
    next.cnpjCpf = cnpjCpf ? normalizeCnpjCpf(cnpjCpf) : undefined;
    next.classification = text(form.classification ?? '');
    next.costCenter = limited(form.costCenter, 'Centro de custo', LOAN_TEXT_LIMITS.costCenter);
  }
  const current = loan as unknown as Record<string, string | undefined>;
  const changes: Record<string, string | null> = {};
  for (const [field, value] of Object.entries(next)) {
    if (value === current[field]) continue;
    changes[field] = value === undefined ? null : value;
  }
  if (Object.keys(changes).length === 0) {
    throw new LoanInputError(METADATA_UNCHANGED_MESSAGE);
  }
  return {
    workspaceId: context.workspaceId,
    loanId: loan.id,
    expectedUpdatedAt: loan.version,
    changes,
  };
};
