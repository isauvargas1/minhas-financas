import type { DocumentData } from 'firebase/firestore';

import type { Transaction } from '../../types.ts';
import { isDayKey } from '../loans/money.ts';
import { CASH_ENTRY_MAX_CENTS } from './cashEntry.ts';

const TRANSACTION_TYPES: ReadonlySet<string> = new Set(['receita', 'despesa', 'investimento']);

/** Marcas de domínio de receita/despesa (empréstimo, fatura, recebível, divisão). */
const OPERATIONAL_MARKERS = ['loanEntry', 'creditCardPaymentEntry', 'receivableEntry', 'splitEntry'] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/**
 * Tipo, marca e valor coerentes, com as mesmas regras do leitor do backend
 * (`functions/src/cash/periods.ts`): `investimento` só com `investmentEntry`
 * e com o valor da marca; a marca de investimento só em `investimento`;
 * receita e despesa até o teto da entrada de caixa.
 */
const isCoherent = (data: DocumentData): boolean => {
  if (data.type === 'investimento') {
    if (!isObject(data.investmentEntry)) return false;
    if (OPERATIONAL_MARKERS.some((marker) => data[marker] !== undefined)) return false;
    return data.investmentEntry.amountCents === data.valueCents;
  }
  if (data.investmentEntry !== undefined) return false;
  return data.valueCents <= CASH_ENTRY_MAX_CENTS;
};

/** Campos que não fazem mais parte do contrato do documento: nunca são lidos. */
const LEGACY_FIELDS = ['value', 'transactionDate', 'installments', 'currentInstallment'] as const;

/**
 * Monta a transação a partir do contrato do documento (`valueCents` inteiro
 * seguro ≥ 0, `date` AAAA-MM-DD válido, `type` receita/despesa/investimento
 * coerente com a marca de domínio). Documento fora do contrato devolve
 * `null`: nunca vira R$ 0,00 nem é reinterpretado por campo legado. O
 * documento anulado (`voidedAt`) segue a mesma regra para ser exibido.
 */
export const normalizeTransactionData = (
  id: string,
  data: DocumentData,
  parentWorkspaceId?: string,
): Transaction | null => {
  if (
    typeof data.valueCents !== 'number' ||
    !Number.isSafeInteger(data.valueCents) ||
    data.valueCents < 0
  ) return null;
  if (!isDayKey(data.date)) return null;
  if (typeof data.type !== 'string' || !TRANSACTION_TYPES.has(data.type)) return null;
  if (!isCoherent(data)) return null;

  const known: DocumentData = { ...data };
  for (const legacy of LEGACY_FIELDS) delete known[legacy];

  return {
    ...(known as Omit<Transaction, 'id'>),
    id,
    type: data.type as Transaction['type'],
    valueCents: data.valueCents,
    date: data.date,
    cardId: data.cardId ? String(data.cardId) : undefined,
    workspaceId: data.workspaceId ?? parentWorkspaceId,
  };
};
