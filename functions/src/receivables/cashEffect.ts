import {isMoneyCents} from "../shared/money";

/**
 * Efeito de caixa do espelho de recebimento (D-39, P3-I).
 *
 * O espelho em `transactions` carrega a marca backend-only `receivableEntry`
 * (as Rules negam a chave ao cliente). É ela, e não `type`/`value`, que
 * decide a classificação na projeção mensal e na reconstrução:
 *
 * | componente | projeção                          | caixa (`netCents`) |
 * | ---------- | --------------------------------- | ------------------ |
 * | principal  | receita operacional (`income`)    | entra              |
 * | juros      | receita financeira                | entra              |
 * | multa      | receita financeira                | entra              |
 * | desconto   | nada (reduz o saldo do recebível) | não entra          |
 *
 * O estorno (`reversal: true`) aplica o mesmo efeito com sinal oposto: fato +
 * estorno somam zero em todos os campos. Recebimento só de desconto não tem
 * espelho (não há dinheiro).
 */
export const RECEIVABLE_CASH_ENTRY_VERSION = 1;

export interface ReceivableCashEntry {
  domainVersion: number;
  receivableId: string;
  receivableMovementId: string;
  clientId: string;
  kind: "receipt";
  reversal: boolean;
  principalCents: number;
  interestCents: number;
  penaltyCents: number;
  /** Informativo: o desconto não move caixa. */
  discountCents: number;
  currency: "BRL";
  /** No estorno: o movimento original. */
  reversalOf?: string;
}

export interface ReceivableCashEffect {
  incomeCents: number;
  financialIncomeCents: number;
  netCents: number;
}

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isNonNegativeCents = (value: unknown): value is number =>
  isMoneyCents(value) && (value as number) >= 0;

/** Dinheiro do recebimento: principal + juros + multa (sem desconto). */
export const receiptCashCents = (input: {
  principalCents: number;
  interestCents: number;
  penaltyCents: number;
}): number => input.principalCents + input.interestCents + input.penaltyCents;

/** Marca válida ou `null`. Nada de coerção: forma inesperada não conta. */
export const readReceivableCashEntry = (
  value: unknown,
): ReceivableCashEntry | null => {
  if (typeof value !== "object" || value === null) return null;
  const entry = value as Record<string, unknown>;
  if (
    entry.domainVersion !== RECEIVABLE_CASH_ENTRY_VERSION ||
    !isText(entry.receivableId) ||
    !isText(entry.receivableMovementId) ||
    !isText(entry.clientId) ||
    entry.kind !== "receipt" ||
    typeof entry.reversal !== "boolean" ||
    entry.currency !== "BRL" ||
    !isNonNegativeCents(entry.principalCents) ||
    !isNonNegativeCents(entry.interestCents) ||
    !isNonNegativeCents(entry.penaltyCents) ||
    !isNonNegativeCents(entry.discountCents)
  ) {
    return null;
  }
  if (receiptCashCents(entry as unknown as ReceivableCashEntry) <= 0) {
    return null;
  }
  if (entry.reversal && !isText(entry.reversalOf)) return null;
  return entry as unknown as ReceivableCashEntry;
};

// `|| 0` normaliza `-0`.
const signed = (value: number, sign: number): number => value * sign || 0;

export const receivableCashEffect = (
  entry: ReceivableCashEntry,
): ReceivableCashEffect => {
  const sign = entry.reversal ? -1 : 1;
  const financial = entry.interestCents + entry.penaltyCents;
  return {
    incomeCents: signed(entry.principalCents, sign),
    financialIncomeCents: signed(financial, sign),
    netCents: signed(entry.principalCents + financial, sign),
  };
};
