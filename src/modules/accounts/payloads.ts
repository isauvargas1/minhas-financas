import { isDayKey, parseBrlToCents, saoPauloToday } from '../loans/money.ts';
import { AccountInputError } from './presentation.ts';
import type { CashAccount, CashAccountType, CashTransfer } from './types.ts';

/**
 * Payloads das callables de contas e transferências (D-30, P3-J), sem a
 * chave de idempotência. Módulo puro: valores digitados viram centavos
 * inteiros por leitura de texto, sem ponto flutuante; nada autoritativo
 * (saldo, estado, autoria) é enviado.
 */
export const ACCOUNT_TEXT_LIMITS = {
  name: 80,
  description: 200,
  reason: 300,
} as const;

const requiredText = (value: string, label: string, max: number): string => {
  const text = value.trim();
  if (!text) throw new AccountInputError(`Informe ${label}.`);
  if (text.length > max) {
    throw new AccountInputError(`${label[0].toUpperCase()}${label.slice(1)}: até ${max} caracteres.`);
  }
  return text;
};

/**
 * Saldo inicial digitado (formato brasileiro), com sinal opcional: `-150,00`
 * é conta que já começa devedora. Vazio é zero.
 */
export const parseOpeningBalance = (input: string): number | null => {
  const text = input.trim();
  if (!text) return 0;
  const negative = text.startsWith('-');
  const cents = parseBrlToCents(negative ? text.slice(1) : text, { allowZero: true });
  if (cents === null) return null;
  return negative ? -cents || 0 : cents;
};

export interface CashAccountForm {
  name: string;
  accountType: CashAccountType;
  /** Só na criação. */
  openingBalance?: string;
}

export const toCreateCashAccountPayload = (
  form: CashAccountForm,
  workspaceId: string,
): Record<string, unknown> => {
  const openingBalanceCents = parseOpeningBalance(form.openingBalance ?? '');
  if (openingBalanceCents === null) {
    throw new AccountInputError(
      'Saldo inicial: use o formato 1.234,56 (com - na frente para saldo negativo).',
    );
  }
  return {
    workspaceId,
    name: requiredText(form.name, 'o nome da conta', ACCOUNT_TEXT_LIMITS.name),
    accountType: form.accountType,
    ...(openingBalanceCents !== 0 ? { openingBalanceCents } : {}),
  };
};

/** Só o que mudou; nada mudou é erro de preenchimento. */
export const toUpdateCashAccountPayload = (
  form: CashAccountForm,
  account: CashAccount,
  workspaceId: string,
): Record<string, unknown> => {
  const name = requiredText(form.name, 'o nome da conta', ACCOUNT_TEXT_LIMITS.name);
  const changes: Record<string, unknown> = {};
  if (name !== account.name) changes.name = name;
  if (form.accountType !== account.accountType) changes.accountType = form.accountType;
  if (Object.keys(changes).length === 0) {
    throw new AccountInputError('Nenhum dado foi alterado.');
  }
  return {
    workspaceId,
    accountId: account.id,
    expectedUpdatedAt: account.version,
    changes,
  };
};

export const toAccountStatusPayload = (
  account: CashAccount,
  workspaceId: string,
): Record<string, unknown> => ({
  workspaceId,
  accountId: account.id,
  expectedUpdatedAt: account.version,
});

export interface CashTransferForm {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: string;
  date: string;
  description: string;
}

export const toCreateCashTransferPayload = (
  form: CashTransferForm,
  workspaceId: string,
  today: string = saoPauloToday(),
): Record<string, unknown> => {
  if (!form.sourceAccountId) throw new AccountInputError('Escolha a conta de origem.');
  if (!form.destinationAccountId) throw new AccountInputError('Escolha a conta de destino.');
  if (form.sourceAccountId === form.destinationAccountId) {
    throw new AccountInputError('A conta de destino precisa ser diferente da origem.');
  }
  const amountCents = parseBrlToCents(form.amount);
  if (amountCents === null) {
    throw new AccountInputError('Informe um valor maior que zero no formato 1.234,56.');
  }
  if (!isDayKey(form.date)) throw new AccountInputError('Informe uma data válida.');
  if (form.date > today) {
    throw new AccountInputError('A transferência não pode ter data futura.');
  }
  const description = form.description.trim();
  if (description.length > ACCOUNT_TEXT_LIMITS.description) {
    throw new AccountInputError(
      `Descrição: até ${ACCOUNT_TEXT_LIMITS.description} caracteres.`,
    );
  }
  return {
    workspaceId,
    sourceAccountId: form.sourceAccountId,
    destinationAccountId: form.destinationAccountId,
    amountCents,
    date: form.date,
    ...(description ? { description } : {}),
  };
};

export const toReverseCashTransferPayload = (
  transfer: CashTransfer,
  reason: string,
  workspaceId: string,
): Record<string, unknown> => ({
  workspaceId,
  transferId: transfer.id,
  expectedUpdatedAt: transfer.version,
  reason: requiredText(reason, 'o motivo do estorno', ACCOUNT_TEXT_LIMITS.reason),
});
