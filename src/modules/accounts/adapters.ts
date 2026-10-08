import { isDayKey } from '../loans/money.ts';
import { versionOf } from '../clients/adapters.ts';
import type {
  CashAccount,
  CashAccountMovement,
  CashAccountMovementKind,
  CashAccountSourceDomain,
  CashAccountType,
  CashTransfer,
} from './types.ts';

/**
 * Leitura dos documentos de contas, movimentos e transferências gravados pelo
 * backend (D-30, P3-J). Módulo puro.
 *
 * Um único formato é aceito — o autoritativo `schemaVersion: 1`. Documento
 * fora dele (marca ausente, saldo que não é centavo inteiro, tipo ou estado
 * desconhecido) devolve `null`: a interface não o exibe nem o soma, em vez de
 * "consertar" números na tela.
 */
export const ACCOUNTS_SCHEMA_VERSION = 1;

export const CASH_ACCOUNT_TYPES: readonly CashAccountType[] =
  ['cash', 'checking', 'savings', 'digital', 'other'];

const MOVEMENT_KINDS: readonly CashAccountMovementKind[] = [
  'opening_balance', 'cash_transaction', 'loan', 'receivable',
  'credit_card_payment', 'split', 'investment', 'transfer_in', 'transfer_out',
  'reversal',
];

const SOURCE_DOMAINS: readonly CashAccountSourceDomain[] =
  ['account', 'cash', 'loan', 'receivable', 'credit_card', 'split', 'investment', 'transfer'];

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const isSignedCents = (value: unknown): value is number =>
  Number.isSafeInteger(value);

/** Conta autoritativa, ou `null`. */
export const toCashAccount = (
  id: string,
  data: Record<string, unknown> | undefined,
): CashAccount | null => {
  if (!data || data.schemaVersion !== ACCOUNTS_SCHEMA_VERSION) return null;
  const version = versionOf(data.updatedAt);
  if (
    data.id !== id ||
    !isText(data.name) ||
    !CASH_ACCOUNT_TYPES.includes(data.accountType as CashAccountType) ||
    (data.status !== 'active' && data.status !== 'archived') ||
    !isSignedCents(data.balanceCents) ||
    data.currency !== 'BRL' ||
    !version
  ) {
    return null;
  }
  return {
    id,
    name: data.name,
    accountType: data.accountType as CashAccountType,
    status: data.status,
    // `|| 0` normaliza `-0`.
    balanceCents: (data.balanceCents as number) || 0,
    version,
  };
};

/** Movimento do livro-razão da conta, ou `null`. */
export const toCashAccountMovement = (
  id: string,
  data: Record<string, unknown> | undefined,
): CashAccountMovement | null => {
  if (!data || data.schemaVersion !== ACCOUNTS_SCHEMA_VERSION) return null;
  if (
    data.id !== id ||
    !isText(data.accountId) ||
    !MOVEMENT_KINDS.includes(data.kind as CashAccountMovementKind) ||
    !isSignedCents(data.amountCents) ||
    data.amountCents === 0 ||
    !isDayKey(data.effectiveDate) ||
    !SOURCE_DOMAINS.includes(data.sourceDomain as CashAccountSourceDomain) ||
    !isText(data.sourceId) ||
    (data.reversalOf !== null && !isText(data.reversalOf))
  ) {
    return null;
  }
  return {
    id,
    accountId: data.accountId,
    kind: data.kind as CashAccountMovementKind,
    amountCents: data.amountCents as number,
    effectiveDate: data.effectiveDate as string,
    sourceDomain: data.sourceDomain as CashAccountSourceDomain,
    sourceId: data.sourceId,
    reversalOf: (data.reversalOf as string | null) ?? null,
  };
};

/** Transferência, ou `null`. */
export const toCashTransfer = (
  id: string,
  data: Record<string, unknown> | undefined,
): CashTransfer | null => {
  if (!data || data.schemaVersion !== ACCOUNTS_SCHEMA_VERSION) return null;
  const version = versionOf(data.updatedAt);
  if (
    data.id !== id ||
    !isText(data.sourceAccountId) ||
    !isText(data.destinationAccountId) ||
    data.sourceAccountId === data.destinationAccountId ||
    !Number.isSafeInteger(data.amountCents) ||
    (data.amountCents as number) <= 0 ||
    !isDayKey(data.date) ||
    (data.status !== 'completed' && data.status !== 'reversed') ||
    !isText(data.createdBy) ||
    !version
  ) {
    return null;
  }
  const reversal = data.reversal as { reason?: unknown } | null | undefined;
  return {
    id,
    sourceAccountId: data.sourceAccountId,
    destinationAccountId: data.destinationAccountId,
    amountCents: data.amountCents as number,
    date: data.date as string,
    ...(isText(data.description) ? { description: data.description } : {}),
    status: data.status,
    createdBy: data.createdBy,
    version,
    ...(reversal && isText(reversal.reason) ? { reversalReason: reversal.reason } : {}),
  };
};
