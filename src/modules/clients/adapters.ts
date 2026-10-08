import { isDayKey } from '../loans/money.ts';
import type {
  Client,
  ClientPrivate,
  Receivable,
  ReceivableMovement,
} from './types.ts';

/**
 * Leitura dos documentos de clientes e recebíveis gravados pelo backend
 * (P3-I). Módulo puro.
 *
 * Um único formato é aceito — o autoritativo `schemaVersion: 1`. Documento
 * fora dele (marca ausente, valor que não é centavo inteiro, saldo que não
 * fecha, status do modelo substituído como `pending`, `paid` ou `overdue`)
 * devolve `null`: a interface não o exibe nem tenta operá-lo, em vez de
 * "consertar" números na tela.
 */
export const CLIENTS_SCHEMA_VERSION = 1;

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const isCents = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const optionalText = (value: unknown): string | undefined =>
  isText(value) ? value : undefined;

/** Versão lida (`updatedAt`) em ISO com nanossegundos, ou `null`. */
export const versionOf = (updatedAt: unknown): string | null => {
  const value = updatedAt as { seconds?: unknown; nanoseconds?: unknown } | null;
  if (
    !value ||
    typeof value.seconds !== 'number' ||
    typeof value.nanoseconds !== 'number' ||
    !Number.isSafeInteger(value.seconds) ||
    !Number.isInteger(value.nanoseconds) ||
    value.nanoseconds < 0 ||
    value.nanoseconds > 999_999_999
  ) {
    return null;
  }
  const base = new Date(value.seconds * 1000).toISOString().slice(0, 19);
  return `${base}.${String(value.nanoseconds).padStart(9, '0')}Z`;
};

/** Cadastro compartilhado, ou `null` se o documento não for autoritativo. */
export const toClient = (id: string, data: Record<string, unknown> | undefined): Client | null => {
  if (!data || data.schemaVersion !== CLIENTS_SCHEMA_VERSION) return null;
  const version = versionOf(data.updatedAt);
  if (
    data.clientId !== id ||
    !isText(data.name) ||
    (data.status !== 'active' && data.status !== 'archived') ||
    !isText(data.createdBy) ||
    !version
  ) {
    return null;
  }
  return { id, name: data.name, status: data.status, createdBy: data.createdBy, version };
};

/** Dados pessoais do cliente (só owner/admin chegam a ler o documento). */
export const toClientPrivate = (
  id: string,
  data: Record<string, unknown> | undefined,
): ClientPrivate | null => {
  if (!data || data.schemaVersion !== CLIENTS_SCHEMA_VERSION || data.clientId !== id) return null;
  return {
    clientId: id,
    document: optionalText(data.document),
    email: optionalText(data.email),
    phone: optionalText(data.phone),
    address: optionalText(data.address),
    notes: optionalText(data.notes),
  };
};

/** Invariantes D-39 do documento lido; o mesmo critério do backend. */
const isConsistentReceivable = (data: Record<string, unknown>): boolean => {
  if (
    !isCents(data.amountCents) || data.amountCents === 0 ||
    !isCents(data.principalReceivedCents) ||
    !isCents(data.discountGrantedCents) ||
    !isCents(data.interestReceivedCents) ||
    !isCents(data.penaltyReceivedCents) ||
    !isCents(data.balanceCents) ||
    !isCents(data.activeReceiptCount) ||
    data.balanceCents !==
      data.amountCents - data.principalReceivedCents - data.discountGrantedCents
  ) {
    return false;
  }
  if (data.status === 'cancelled') return data.activeReceiptCount === 0;
  if (data.status === 'received') return data.balanceCents === 0;
  if (data.status === 'open') return data.balanceCents > 0;
  return false;
};

/** Recebível autoritativo, ou `null`. */
export const toReceivable = (
  id: string,
  data: Record<string, unknown> | undefined,
): Receivable | null => {
  if (!data || data.schemaVersion !== CLIENTS_SCHEMA_VERSION) return null;
  const version = versionOf(data.updatedAt);
  if (
    data.id !== id ||
    !isText(data.clientId) ||
    !isText(data.description) ||
    !isDayKey(data.dueDate) ||
    !isText(data.createdBy) ||
    !version ||
    !isConsistentReceivable(data)
  ) {
    return null;
  }
  return {
    id,
    clientId: data.clientId,
    description: data.description,
    category: optionalText(data.category),
    amountCents: data.amountCents as number,
    principalReceivedCents: data.principalReceivedCents as number,
    discountGrantedCents: data.discountGrantedCents as number,
    interestReceivedCents: data.interestReceivedCents as number,
    penaltyReceivedCents: data.penaltyReceivedCents as number,
    balanceCents: data.balanceCents as number,
    activeReceiptCount: data.activeReceiptCount as number,
    dueDate: data.dueDate,
    status: data.status as Receivable['status'],
    createdBy: data.createdBy,
    cancelReason: optionalText(data.cancelReason),
    version,
  };
};

/** Movimento autoritativo (recebimento ou estorno), ou `null`. */
export const toReceivableMovement = (
  id: string,
  data: Record<string, unknown> | undefined,
): ReceivableMovement | null => {
  if (
    !data ||
    data.schemaVersion !== CLIENTS_SCHEMA_VERSION ||
    !isText(data.receivableId) ||
    (data.kind !== 'receipt' && data.kind !== 'reversal') ||
    !isCents(data.principalCents) ||
    !isCents(data.interestCents) ||
    !isCents(data.penaltyCents) ||
    !isCents(data.discountCents) ||
    !isCents(data.cashCents) ||
    data.cashCents !== data.principalCents + data.interestCents + data.penaltyCents ||
    data.cashCents + data.discountCents === 0 ||
    !isDayKey(data.date) ||
    !isText(data.createdBy) ||
    (data.kind === 'reversal' && !isText(data.reversalOf))
  ) {
    return null;
  }
  return {
    id,
    receivableId: data.receivableId,
    kind: data.kind,
    principalCents: data.principalCents,
    interestCents: data.interestCents,
    penaltyCents: data.penaltyCents,
    discountCents: data.discountCents,
    cashCents: data.cashCents,
    date: data.date,
    reversalOf: isText(data.reversalOf) ? data.reversalOf : null,
    reversedBy: isText(data.reversedBy) ? data.reversedBy : null,
    reason: isText(data.reason) ? data.reason : null,
    createdBy: data.createdBy,
  };
};
