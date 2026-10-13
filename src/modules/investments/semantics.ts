import type {Transaction, TransactionInvestmentEntry} from '../../types';

/*
 * Semântica de caixa dos lançamentos em `transactions`.
 *
 * Investimentos (D-15, P4-D): o patrimônio vive em `investment_movements` e
 * nas projeções dele (`investment_positions`, `investment_summaries`,
 * `investment_report_periods`). O espelho em `transactions` é **só** o efeito
 * de caixa, classificado pela marca backend-only `investmentEntry` — a mesma
 * regra de `investmentCashEffect` no backend:
 *
 * - aporte liquidado → saída para investimento;
 * - retirada recebida → entrada do principal mais o rendimento (resultado
 *   financeiro), nunca receita operacional;
 * - pendente e cancelado → zero;
 * - estorno → o efeito do original com sinal oposto.
 *
 * Documento `investimento` sem marca válida está fora do contrato e não tem
 * efeito: não há leitura de `value`, de metadado antigo nem do tipo sozinho.
 * Nada aqui alimenta patrimônio nem meta.
 */

const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isCents = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Marca do espelho de investimento, validada; `null` fora do contrato. */
export const investmentEntryOf = (
  transaction: Transaction,
): TransactionInvestmentEntry | null => {
  if (transaction.type !== 'investimento') return null;
  const entry = transaction.investmentEntry as unknown;
  if (typeof entry !== 'object' || entry === null) return null;
  const value = entry as Record<string, unknown>;
  if (
    value.domainVersion !== 1 ||
    !isText(value.movementId) ||
    (value.operation !== 'contribution' && value.operation !== 'redemption') ||
    typeof value.reversal !== 'boolean' ||
    (value.reversal ? !isText(value.reversalOf) : value.reversalOf !== null) ||
    (value.status !== 'pending' && value.status !== 'settled' && value.status !== 'cancelled') ||
    (value.reversal && value.status !== 'settled') ||
    !isCents(value.principalCents) || !isCents(value.gainCents) ||
    (value.operation === 'contribution' && value.gainCents !== 0) ||
    !isCents(value.amountCents) || value.amountCents === 0 ||
    value.amountCents !== (value.principalCents as number) + (value.gainCents as number) ||
    value.currency !== 'BRL'
  ) {
    return null;
  }
  return value as unknown as TransactionInvestmentEntry;
};

export interface InvestmentCashEffect {
  investmentOutflowCents: number;
  investmentInflowCents: number;
  financialIncomeCents: number;
  netCents: number;
}

const ZERO_INVESTMENT_EFFECT: InvestmentCashEffect = Object.freeze({
  investmentOutflowCents: 0,
  investmentInflowCents: 0,
  financialIncomeCents: 0,
  netCents: 0,
});

// `|| 0` normaliza `-0`.
const signed = (value: number, sign: number): number => value * sign || 0;

/** Efeito de caixa do espelho de investimento; zero fora do contrato. */
export const investmentCashEffectOf = (transaction: Transaction): InvestmentCashEffect => {
  const entry = investmentEntryOf(transaction);
  if (!entry || entry.status !== 'settled') return ZERO_INVESTMENT_EFFECT;
  const sign = entry.reversal ? -1 : 1;
  if (entry.operation === 'contribution') {
    return {
      ...ZERO_INVESTMENT_EFFECT,
      investmentOutflowCents: signed(entry.amountCents, sign),
      netCents: signed(entry.amountCents, -sign),
    };
  }
  return {
    ...ZERO_INVESTMENT_EFFECT,
    investmentInflowCents: signed(entry.principalCents, sign),
    financialIncomeCents: signed(entry.gainCents, sign),
    netCents: signed(entry.amountCents, sign),
  };
};

/** Retirada de investimento (o fato, não o estorno dela). */
export const isInvestmentRedemption = (transaction: Transaction): boolean => {
  const entry = investmentEntryOf(transaction);
  return entry !== null && entry.operation === 'redemption' && !entry.reversal;
};

/**
 * Receita ou despesa ainda não liquidada (D-29, P3-F): pendente, agendada ou
 * vencida sem confirmação (`isPaid: false`). Não move o caixa realizado.
 * Mesma regra de `isUnsettledCashEntry` na projeção do backend.
 */
export const isUnsettledEntry = (transaction: Transaction): boolean =>
  (transaction.type === 'receita' || transaction.type === 'despesa') &&
  transaction.isPaid === false;

export const transactionCashImpactCents = (transaction: Transaction): number => {
  if (transaction.type === 'investimento') return investmentCashEffectOf(transaction).netCents;
  const { valueCents } = transaction;

  if (isUnsettledEntry(transaction)) return 0;
  if (transaction.type === 'receita') return valueCents;
  if (transaction.type === 'despesa') return -valueCents;
  return 0;
};

/**
 * Espelho de caixa do pagamento de fatura de cartão (P4-A): liquidação do
 * cartão. Move o saldo (o pagamento sai, o estorno volta), mas nunca é
 * despesa nem receita operacional — a despesa de consumo é a compra, no
 * domínio de cartões. Mesma regra da projeção do backend
 * (`creditCardPaymentCents`).
 */
export const isCreditCardPaymentCashMirror = (transaction: Transaction): boolean =>
  typeof transaction.creditCardPaymentEntry === 'object' &&
  transaction.creditCardPaymentEntry !== null;
